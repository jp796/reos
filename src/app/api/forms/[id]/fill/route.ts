/**
 * POST /api/forms/:id/fill
 * Body: { transactionId }
 *
 * Fill this blank form with the deal's data (AI maps the deal facts onto
 * the form's fields) and save the result as a document on the deal —
 * ready to send for e-signature via the existing e-sign flow.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { requireSession, assertSameAccount } from "@/lib/require-session";
import { aiFillForm } from "@/services/ai/FormFillService";
import { overlayTextOnPdf } from "@/services/ai/FormOverlayService";
import { FIELD_CATALOG, formatFieldValue } from "@/services/ai/FormFieldCatalog";

interface MappedField { field: string; page: number; xPt: number; yPt: number; size?: number }

export const runtime = "nodejs";
export const maxDuration = 90;

const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

const CATEGORY_MAP: Record<string, string> = {
  offer: "contract",
  counter: "contract",
  addendum: "addendum",
  disclosure: "disclosure",
};

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  if (!env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "OPENAI_API_KEY not configured" }, { status: 500 });
  }

  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { transactionId?: string };
  if (!body.transactionId) {
    return NextResponse.json({ error: "transactionId required" }, { status: 400 });
  }

  const form = await prisma.formTemplate.findFirst({
    where: { id, accountId: actor.accountId },
  });
  if (!form) return NextResponse.json({ error: "form not found" }, { status: 404 });

  const txn = await prisma.transaction.findFirst({
    where: { id: body.transactionId, accountId: actor.accountId },
    include: {
      contact: { select: { fullName: true, primaryEmail: true, primaryPhone: true } },
      financials: { select: { salePrice: true, commissionPercent: true, grossCommission: true } },
      participants: {
        include: { contact: { select: { fullName: true, primaryEmail: true } } },
      },
    },
  });
  if (!txn) return NextResponse.json({ error: "deal not found" }, { status: 404 });
  const guard = assertSameAccount(actor, txn.accountId);
  if (guard) return guard;

  if (form.isXfa) {
    return NextResponse.json({
      ok: false,
      reason: "xfa",
      error: "This form is unflattened XFA. Re-upload it so REOS can flatten it first.",
    });
  }
  const placements = (form.placementsJson as unknown as MappedField[] | null) ?? [];
  if (form.isFlat && placements.length === 0) {
    return NextResponse.json({
      ok: false,
      reason: "map_needed",
      error: "Map this form's fields first (open it in the field mapper), then fill.",
    });
  }

  // Build the deal facts.
  const buyers: string[] = [];
  const sellers: string[] = [];
  const primaryIsBuyer = txn.side === "buy" || txn.side === "both" || txn.side === "buyer";
  if (txn.contact.fullName) (primaryIsBuyer ? buyers : sellers).push(txn.contact.fullName);
  for (const p of txn.participants) {
    if (!p.contact.fullName) continue;
    if (p.role === "co_buyer" || p.role === "buyer") buyers.push(p.contact.fullName);
    else if (p.role === "co_seller" || p.role === "seller") sellers.push(p.contact.fullName);
  }

  const facts: Record<string, unknown> = {
    propertyAddress: txn.propertyAddress,
    buyers, sellers,
    buyerNames: buyers.join(", "),
    sellerNames: sellers.join(", "),
    purchasePrice: txn.financials?.salePrice ?? null,
    earnestMoney: null,
    effectiveDate: iso(txn.contractDate),
    closingDate: iso(txn.closingDate),
    possessionDate: iso(txn.possessionDate),
    inspectionDeadline: iso(txn.inspectionDate),
    inspectionObjectionDeadline: iso(txn.inspectionObjectionDate),
    titleCommitmentDeadline: iso(txn.titleDeadline),
    titleObjectionDeadline: iso(txn.titleObjectionDate),
    financingDeadline: iso(txn.financingDeadline),
    walkthroughDate: iso(txn.walkthroughDate),
    earnestMoneyDueDate: iso(txn.earnestMoneyDueDate),
    titleCompany: txn.titleCompanyName,
    lender: txn.lenderName,
    commissionPercent: txn.financials?.commissionPercent ?? null,
    grossCommission: txn.financials?.grossCommission ?? null,
    primaryContactEmail: txn.contact.primaryEmail,
    primaryContactPhone: txn.contact.primaryPhone,
  };

  let filledBytes: Uint8Array;
  let filled = 0;
  let total = 0;
  try {
    if (!form.isFlat) {
      // Fillable AcroForm — AI maps facts onto the form fields.
      const r = await aiFillForm(env.OPENAI_API_KEY, new Uint8Array(form.rawBytes), facts, {
        flatten: false,
      });
      filledBytes = r.bytes;
      filled = r.filled;
      total = r.fields.length;
    } else {
      // Flat form — stamp values at the mapped coordinates.
      const overlays = placements
        .map((p) => {
          const cat = FIELD_CATALOG.find((c) => c.key === p.field);
          const text = formatFieldValue(cat?.kind ?? "text", facts[p.field]);
          return { page: p.page, x: p.xPt, y: p.yPt, text, size: p.size ?? 10 };
        })
        .filter((o) => o.text);
      const r = await overlayTextOnPdf(new Uint8Array(form.rawBytes), overlays);
      filledBytes = r.bytes;
      filled = r.drawn;
      total = placements.length;
    }
  } catch (err) {
    return NextResponse.json(
      { error: `fill failed: ${err instanceof Error ? err.message.slice(0, 160) : "error"}` },
      { status: 502 },
    );
  }

  const category = (form.category && CATEGORY_MAP[form.category]) || "other";
  const outName = `${form.name} — ${txn.propertyAddress ?? "deal"}.pdf`;
  const doc = await prisma.document.create({
    data: {
      transactionId: txn.id,
      category,
      fileName: outName,
      mimeType: "application/pdf",
      rawBytes: Buffer.from(filledBytes),
      source: "form_fill",
      uploadOrigin: `form:${form.id}`,
      uploadedAt: new Date(),
    },
    select: { id: true, fileName: true },
  });

  return NextResponse.json({
    ok: true,
    documentId: doc.id,
    fileName: doc.fileName,
    filled,
    totalFields: total,
    summary: `Filled ${filled} of ${total} field(s) on "${form.name}" for ${txn.propertyAddress ?? "the deal"}. Saved to the deal's documents — ready to e-sign.`,
  });
}
