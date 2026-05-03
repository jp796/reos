/**
 * POST /api/voice/intake
 *
 * Multipart audio → transcript → structured deal → draft Transaction.
 * Returns the new transaction id for the client to redirect to.
 *
 * Uses an existing primary contact (looks up by email) or creates a
 * fresh one. Status defaults to "listing" when side=sell, else "active"
 * (under contract).
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { requireSession } from "@/lib/require-session";
import {
  transcribeAudio,
  extractDealFromTranscript,
} from "@/services/ai/VoiceIntakeService";
import { logError } from "@/lib/log";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  if (!env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY not configured" },
      { status: 500 },
    );
  }

  let audio: Buffer;
  try {
    const form = await req.formData();
    const file = form.get("audio") as File | null;
    if (!file) {
      return NextResponse.json(
        { error: "audio file required" },
        { status: 400 },
      );
    }
    audio = Buffer.from(await file.arrayBuffer());
    if (audio.length > 25 * 1024 * 1024) {
      return NextResponse.json(
        { error: "audio too large (max 25MB)" },
        { status: 400 },
      );
    }
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "form parse failed" },
      { status: 400 },
    );
  }

  try {
    const transcript = await transcribeAudio(audio, env.OPENAI_API_KEY);
    if (!transcript || transcript.length < 5) {
      return NextResponse.json(
        { error: "transcription empty — try recording again" },
        { status: 400 },
      );
    }

    const deal = await extractDealFromTranscript(
      transcript,
      env.OPENAI_API_KEY,
    );

    if (
      !deal.propertyAddress &&
      deal.buyers.length === 0 &&
      deal.sellers.length === 0
    ) {
      return NextResponse.json(
        {
          error:
            "Couldn't extract a deal from that recording. Try saying property address + buyer/seller names + price + closing date.",
          transcript,
        },
        { status: 422 },
      );
    }

    // Pick primary contact — prefer first buyer when side=buy/both,
    // else first seller.
    const primary =
      deal.side === "sell"
        ? deal.sellers[0] ?? deal.buyers[0]
        : deal.buyers[0] ?? deal.sellers[0];
    if (!primary?.name) {
      return NextResponse.json(
        {
          error:
            "Couldn't identify a primary contact. Please name the buyer or seller.",
          transcript,
        },
        { status: 422 },
      );
    }

    // Find or create the contact
    let contact = primary.email
      ? await prisma.contact.findFirst({
          where: {
            accountId: actor.accountId,
            primaryEmail: { equals: primary.email, mode: "insensitive" },
          },
          select: { id: true },
        })
      : null;
    if (!contact) {
      contact = await prisma.contact.create({
        data: {
          accountId: actor.accountId,
          fullName: primary.name.slice(0, 200),
          primaryEmail: primary.email ?? null,
          primaryPhone: primary.phone ?? null,
          sourceName: "voice-intake",
        },
        select: { id: true },
      });
    }

    const status =
      deal.status ??
      (deal.side === "sell" && !deal.contractDate ? "listing" : "active");

    const txn = await prisma.transaction.create({
      data: {
        accountId: actor.accountId,
        contactId: contact.id,
        assignedUserId: actor.userId,
        status,
        side: deal.side ?? "buy",
        transactionType:
          deal.side === "sell"
            ? "seller"
            : deal.side === "both"
              ? "buyer"
              : "buyer",
        propertyAddress: deal.propertyAddress?.slice(0, 240) ?? null,
        city: deal.city?.slice(0, 80) ?? null,
        state: deal.state?.toUpperCase()?.slice(0, 8) ?? null,
        zip: deal.zip?.slice(0, 12) ?? null,
        listPrice: deal.listPrice ?? null,
        contractDate: deal.contractDate ? new Date(deal.contractDate) : null,
        closingDate: deal.closingDate ? new Date(deal.closingDate) : null,
        listDate: status === "listing" ? new Date() : null,
        lenderName: deal.lender?.slice(0, 200) ?? null,
        titleCompanyName: deal.titleCompany?.slice(0, 200) ?? null,
        notesSummary: deal.notes?.slice(0, 1000) ?? null,
      },
      select: { id: true },
    });

    // Co-buyers / co-sellers
    const coParties = [
      ...deal.buyers.slice(1).map((p) => ({ ...p, role: "co_buyer" as const })),
      ...deal.sellers
        .slice(deal.side === "sell" ? 1 : 0)
        .map((p) => ({ ...p, role: "co_seller" as const })),
    ];
    for (const cp of coParties) {
      if (!cp.name) continue;
      const c = await prisma.contact.create({
        data: {
          accountId: actor.accountId,
          fullName: cp.name.slice(0, 200),
          primaryEmail: cp.email ?? null,
          primaryPhone: cp.phone ?? null,
          sourceName: "voice-intake",
        },
        select: { id: true },
      });
      await prisma.transactionParticipant.create({
        data: {
          transactionId: txn.id,
          contactId: c.id,
          role: cp.role,
          notes: "Added via voice intake",
        },
      });
    }

    if (deal.salePrice) {
      await prisma.transactionFinancials.create({
        data: { transactionId: txn.id, salePrice: deal.salePrice },
      });
    }

    return NextResponse.json({
      ok: true,
      transactionId: txn.id,
      transcript,
      extracted: deal,
    });
  } catch (e) {
    logError(e, {
      route: "/api/voice/intake",
      accountId: actor.accountId,
      userId: actor.userId,
    });
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "voice intake failed" },
      { status: 500 },
    );
  }
}
