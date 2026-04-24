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
  return NextResponse.json({
    brokerage: broker,
    fallbackBusinessName: account?.businessName ?? null,
  });
}

export async function POST(req: NextRequest) {
  const actor = await requireOwner();
  if (actor instanceof NextResponse) return actor;

  const body = (await req.json().catch(() => null)) as BrokerSettings | null;
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
  const merged = { ...existing, broker: clean };

  await prisma.account.update({
    where: { id: actor.accountId },
    data: { settingsJson: merged as unknown as Prisma.InputJsonValue },
  });

  return NextResponse.json({ ok: true, brokerage: clean });
}
