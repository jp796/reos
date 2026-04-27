/**
 * GET  /api/settings/brokerage  — load the broker metadata
 * POST /api/settings/brokerage  — save (owner-only)
 *
 * Body schema: BrokerSettings (all fields optional). Stored inside
 * Account.settingsJson.broker — flexible, doesn't need a schema
 * migration when we add / rename fields.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { requireOwner } from "@/lib/require-session";
import type { BrokerSettings } from "@/services/core/CdaGeneratorService";

export async function GET() {
  const actor = await requireOwner();
  if (actor instanceof NextResponse) return actor;

  const account = await prisma.account.findUnique({
    where: { id: actor.accountId },
    select: { settingsJson: true, businessName: true },
  });
  const settings = (account?.settingsJson ?? {}) as Record<string, unknown>;
  const broker = (settings.broker ?? {}) as BrokerSettings;
  const tcSendersRaw = settings.trustedTcSenders;
  const trustedTcSenders = Array.isArray(tcSendersRaw)
    ? (tcSendersRaw as unknown[]).filter((x): x is string => typeof x === "string")
    : [];
  return NextResponse.json({
    brokerage: broker,
    fallbackBusinessName: account?.businessName ?? null,
    complianceAuditEnabled: settings.complianceAuditEnabled !== false,
    trustedTcSenders,
  });
}

export async function POST(req: NextRequest) {
  const actor = await requireOwner();
  if (actor instanceof NextResponse) return actor;

  const body = (await req.json().catch(() => null)) as
    | (BrokerSettings & {
        complianceAuditEnabled?: boolean;
        trustedTcSenders?: string[];
      })
    | null;
  if (!body) return NextResponse.json({ error: "bad JSON" }, { status: 400 });

  // Length-cap every string — prevent accidental-paste garbage
  const clean: BrokerSettings = {};
  const keys: Array<keyof BrokerSettings> = [
    "brokerageName",
    "brokerageAddress",
    "brokerageLicense",
    "brokeragePhone",
    "brokerageEmail",
    "brokerageEin",
    "designatedBrokerName",
    "designatedBrokerLicense",
    "agentName",
    "agentLicense",
  ];
  for (const k of keys) {
    const v = (body as Record<string, unknown>)[k];
    if (typeof v === "string") clean[k] = v.trim().slice(0, 200) || undefined;
  }

  // Merge with existing settingsJson so we don't clobber non-broker keys
  const account = await prisma.account.findUnique({
    where: { id: actor.accountId },
    select: { settingsJson: true },
  });
  const existing = (account?.settingsJson ?? {}) as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...existing, broker: clean };
  if (typeof body.complianceAuditEnabled === "boolean") {
    merged.complianceAuditEnabled = body.complianceAuditEnabled;
  }
  if (Array.isArray(body.trustedTcSenders)) {
    // Sanitize: lowercase, valid-shape emails or domains, dedupe, cap.
    const seen = new Set<string>();
    const cleaned: string[] = [];
    for (const raw of body.trustedTcSenders) {
      if (typeof raw !== "string") continue;
      const v = raw.trim().toLowerCase().slice(0, 200);
      if (!v) continue;
      const ok =
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ||
        /^@?[^\s@]+\.[^\s@]+$/.test(v); // bare domain or @domain
      if (!ok) continue;
      const key = v.startsWith("@") ? v : v;
      if (seen.has(key)) continue;
      seen.add(key);
      cleaned.push(v);
      if (cleaned.length >= 50) break;
    }
    merged.trustedTcSenders = cleaned;
  }

  await prisma.account.update({
    where: { id: actor.accountId },
    data: { settingsJson: merged as unknown as Prisma.InputJsonValue },
  });

  return NextResponse.json({ ok: true, brokerage: clean });
}
