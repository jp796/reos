/**
 * GET /api/integrations/rezen/discover  (owner-only, diagnostic)
 *
 * API-discovery spike: with the account's connected Real token, probe a
 * curated list of Real (rezen) endpoints — read-only GETs — to find
 * where per-transaction COMMISSION / payout / price data lives, so we
 * can pull GCI into REOS financials. Returns, per endpoint: status, the
 * top-level JSON keys, any commission-ish keys found, and a truncated
 * sample. Never mutates. Safe to delete after we've mapped the surface.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireOwner } from "@/lib/require-session";
import { getEncryptionService } from "@/lib/encryption";

export const runtime = "nodejs";
export const maxDuration = 60;

const HOST = {
  keymaker: "https://keymaker.therealbrokerage.com",
  yenta: "https://yenta.therealbrokerage.com",
  arrakis: "https://arrakis.therealbrokerage.com",
  sherlock: "https://sherlock.therealbrokerage.com",
};

const MONEY_RE = /commission|gci|payout|price|gross|net|earn|split|volume|fee/i;

function flagKeys(obj: unknown, prefix = "", out: string[] = [], depth = 0): string[] {
  if (depth > 3 || !obj || typeof obj !== "object") return out;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (MONEY_RE.test(k)) out.push(`${path}${typeof v === "number" ? `=${v}` : ""}`);
    if (v && typeof v === "object") flagKeys(v, path, out, depth + 1);
  }
  return out;
}

async function probe(url: string, jwt: string) {
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${jwt}`, Accept: "application/json" },
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* non-json */
    }
    const topKeys =
      json && typeof json === "object" && !Array.isArray(json)
        ? Object.keys(json as Record<string, unknown>).slice(0, 40)
        : Array.isArray(json)
          ? [`[array len ${(json as unknown[]).length}]`]
          : [];
    return {
      url,
      status: res.status,
      ok: res.ok,
      topKeys,
      moneyFields: json ? flagKeys(json).slice(0, 30) : [],
      sample: text.slice(0, 500),
    };
  } catch (e) {
    return { url, status: 0, ok: false, error: e instanceof Error ? e.message : "fetch failed" };
  }
}

export async function GET() {
  const actor = await requireOwner();
  if (actor instanceof NextResponse) return actor;

  const account = await prisma.account.findUnique({
    where: { id: actor.accountId },
    select: { realApiTokensEncrypted: true },
  });
  if (!account?.realApiTokensEncrypted) {
    return NextResponse.json({ error: "Real not connected" }, { status: 412 });
  }
  let jwt = "";
  let userId = "";
  try {
    const blob = JSON.parse(
      getEncryptionService().decrypt(account.realApiTokensEncrypted),
    ) as { accessToken: string; userId: string };
    jwt = blob.accessToken;
    userId = blob.userId;
  } catch {
    return NextResponse.json({ error: "couldn't decrypt Real token" }, { status: 500 });
  }

  // A rezenTransactionId from any pushed deal (probe transaction detail).
  const pushed = await prisma.transaction.findFirst({
    where: { accountId: actor.accountId, rezenTransactionId: { not: null } },
    select: { rezenTransactionId: true, propertyAddress: true },
  });
  const rtid = pushed?.rezenTransactionId ?? null;

  const candidates: string[] = [
    `${HOST.keymaker}/api/v1/users/${userId}`,
    `${HOST.yenta}/api/v1/users/${userId}`,
    `${HOST.arrakis}/api/v1/transactions/participant/current?page=0&pageSize=5`,
    `${HOST.arrakis}/api/v1/transactions?agentId=${userId}&page=0&pageSize=5`,
  ];
  if (rtid) {
    candidates.push(
      `${HOST.arrakis}/api/v1/transactions/${rtid}`,
      `${HOST.arrakis}/api/v1/transactions/${rtid}/summary`,
      `${HOST.arrakis}/api/v1/transaction-summary/${rtid}`,
      `${HOST.arrakis}/api/v1/transactions/${rtid}/financials`,
    );
  }

  const results = [];
  for (const url of candidates) results.push(await probe(url, jwt));

  return NextResponse.json({
    ok: true,
    userId,
    probedTransaction: rtid ? { id: rtid, address: pushed?.propertyAddress } : null,
    note: rtid
      ? "Probed agent endpoints + transaction detail."
      : "No pushed deal with a rezenTransactionId — probed agent-level endpoints only. Push a deal to Rezen to enable transaction-detail probing.",
    results,
  });
}
