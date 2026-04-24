/**
 * POST /api/intake
 *
 * Public — no auth. Accepts lead-capture form submissions from
 * /intake and creates a LeadIntake row. Single-tenant for now
 * (uses the first Account), multi-tenant-ready via an optional
 * accountSlug param when we get there.
 *
 * Simple spam guards:
 *   - Honeypot field `website`: if populated, silently accept + drop
 *   - Length caps on every string
 *   - Require at least one contact method (email OR phone)
 *   - IP + user agent captured for abuse review
 *
 * Rate-limiting is not enforced at the app layer — Cloud Run's
 * default throttles + Cloudflare (if added) handle that. For local
 * dev, spam risk is zero.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";

const VALID_SIDES = new Set(["buy", "sell"]);

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "bad JSON" }, { status: 400 });

  // Honeypot — bots fill hidden fields humans don't see.
  if (typeof body.website === "string" && body.website.trim() !== "") {
    // Pretend it worked, drop silently
    return NextResponse.json({ ok: true });
  }

  const side = String(body.side ?? "").trim().toLowerCase();
  if (!VALID_SIDES.has(side)) {
    return NextResponse.json({ error: "side must be buy or sell" }, { status: 400 });
  }
  const fullName = String(body.fullName ?? "").trim();
  if (fullName.length < 2) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }
  const email = String(body.email ?? "").trim();
  const phone = String(body.phone ?? "").trim();
  if (!email && !phone) {
    return NextResponse.json(
      { error: "email or phone required" },
      { status: 400 },
    );
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "invalid email" }, { status: 400 });
  }

  const account = await prisma.account.findFirst({ select: { id: true } });
  if (!account) {
    return NextResponse.json({ error: "no account configured" }, { status: 500 });
  }

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    null;
  const ua = req.headers.get("user-agent") ?? null;

  const row = await prisma.leadIntake.create({
    data: {
      accountId: account.id,
      side,
      fullName: fullName.slice(0, 160),
      email: email.slice(0, 160) || null,
      phone: phone.slice(0, 40) || null,
      propertyAddress:
        typeof body.propertyAddress === "string"
          ? body.propertyAddress.trim().slice(0, 240) || null
          : null,
      areaOfInterest:
        typeof body.areaOfInterest === "string"
          ? body.areaOfInterest.trim().slice(0, 1000) || null
          : null,
      budget:
        typeof body.budget === "string"
          ? body.budget.trim().slice(0, 80) || null
          : null,
      timeline:
        typeof body.timeline === "string"
          ? body.timeline.trim().slice(0, 80) || null
          : null,
      financingStatus:
        typeof body.financingStatus === "string"
          ? body.financingStatus.trim().slice(0, 80) || null
          : null,
      source:
        typeof body.source === "string"
          ? body.source.trim().slice(0, 80) || null
          : null,
      notes:
        typeof body.notes === "string"
          ? body.notes.trim().slice(0, 2000) || null
          : null,
      submittedUserAgent: ua?.slice(0, 500) ?? null,
      submittedIp: ip?.slice(0, 64) ?? null,
    },
  });

  return NextResponse.json({ ok: true, id: row.id });
}
