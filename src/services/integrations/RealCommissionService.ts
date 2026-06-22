/**
 * RealCommissionService — read commission/GCI data from Real (ReZEN)
 * using an account's API key (X-API-KEY header, NOT Bearer).
 *
 * Endpoints proven during discovery (2026-06-22):
 *   GET yenta /api/v1/agents/me                       → agent { id, ... }
 *   GET arrakis /api/v1/transactions/participant/{agentId}/current
 *                                                     → { openTransactions: [...] }
 *   GET arrakis /api/v1/transactions/{transactionId}  → detail incl.
 *       grossCommission { amount, currency }, price, saleCommissionPercent
 *
 * Separate from RealApiService (compliance push, Bearer JWT) — this is
 * the financial read path, keyed by API key, and stored independently
 * so it never collides with the compliance token.
 */

import { type PrismaClient, Prisma } from "@prisma/client";
import { getEncryptionService } from "@/lib/encryption";

const YENTA = "https://yenta.therealbrokerage.com";
const ARRAKIS = "https://arrakis.therealbrokerage.com";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

export class RealKeyError extends Error {}

function headers(apiKey: string): Record<string, string> {
  return { "X-API-KEY": apiKey, Accept: "application/json", "User-Agent": UA };
}

interface Money {
  amount: number;
  currency?: string;
}
export interface RealTxnLite {
  id: string;
  oneLine: string;
  code: string | null;
  price: number | null;
  saleCommissionPercent: number | null;
}
export interface RealGci {
  transactionId: string;
  oneLine: string;
  grossCommission: number | null;
  salePrice: number | null;
  saleCommissionPercent: number | null;
}

async function getJson(url: string, apiKey: string): Promise<unknown> {
  const res = await fetch(url, { headers: headers(apiKey) });
  if (res.status === 401 || res.status === 403) {
    throw new RealKeyError("Real rejected the API key — check it in Settings → Integrations.");
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = JSON.parse(text);
  } catch {
    /* non-json */
  }
  if (!res.ok) {
    const m =
      (data as { message?: string; detail?: string } | null)?.message ??
      (data as { detail?: string } | null)?.detail ??
      `Real ${res.status}`;
    throw new RealKeyError(m);
  }
  return data;
}

/** Validate a key + return the agent id (used on connect). */
export async function getRealAgentId(apiKey: string): Promise<string> {
  const me = (await getJson(`${YENTA}/api/v1/agents/me`, apiKey)) as { id?: string };
  if (!me?.id) throw new RealKeyError("Couldn't read your Real agent profile with this key.");
  return me.id;
}

/** The agent's active transactions (for deal matching). */
export async function listAgentTransactions(apiKey: string, agentId: string): Promise<RealTxnLite[]> {
  const data = (await getJson(
    `${ARRAKIS}/api/v1/transactions/participant/${agentId}/current`,
    apiKey,
  )) as { openTransactions?: unknown[] };
  const rows = Array.isArray(data?.openTransactions) ? data.openTransactions : [];
  return rows.map((r) => {
    const o = r as Record<string, unknown>;
    const addr = (o.address ?? {}) as Record<string, unknown>;
    const price = (o.price ?? null) as Money | null;
    return {
      id: String(o.id ?? ""),
      oneLine: String(addr.oneLine ?? ""),
      code: (o.code as string) ?? null,
      price: price && typeof price.amount === "number" ? price.amount : null,
      saleCommissionPercent:
        typeof o.saleCommissionPercent === "number" ? o.saleCommissionPercent : null,
    };
  }).filter((t) => t.id);
}

/** Full GCI for a Real transaction id. */
export async function getRealGci(apiKey: string, transactionId: string): Promise<RealGci> {
  const d = (await getJson(`${ARRAKIS}/api/v1/transactions/${transactionId}`, apiKey)) as Record<string, unknown>;
  const gc = (d.grossCommission ?? null) as Money | null;
  const price = (d.price ?? null) as Money | null;
  const addr = (d.address ?? {}) as Record<string, unknown>;
  return {
    transactionId,
    oneLine: String(addr.oneLine ?? ""),
    grossCommission: gc && typeof gc.amount === "number" ? gc.amount : null,
    salePrice: price && typeof price.amount === "number" ? price.amount : null,
    saleCommissionPercent: typeof d.saleCommissionPercent === "number" ? d.saleCommissionPercent : null,
  };
}

// ── Per-account API-key storage (encrypted, in settingsJson — no migration) ──

export async function storeRealApiKey(
  db: PrismaClient,
  accountId: string,
  apiKey: string,
  agentId: string,
): Promise<void> {
  const account = await db.account.findUnique({
    where: { id: accountId },
    select: { settingsJson: true },
  });
  const settings = (account?.settingsJson ?? {}) as Record<string, unknown>;
  settings.realApiKeyEncrypted = getEncryptionService().encrypt(apiKey);
  settings.realAgentId = agentId;
  await db.account.update({
    where: { id: accountId },
    data: { settingsJson: settings as unknown as Prisma.InputJsonValue },
  });
}

export async function loadRealApiKey(
  db: PrismaClient,
  accountId: string,
): Promise<{ apiKey: string; agentId: string } | null> {
  const account = await db.account.findUnique({
    where: { id: accountId },
    select: { settingsJson: true },
  });
  const settings = (account?.settingsJson ?? {}) as Record<string, unknown>;
  const enc = settings.realApiKeyEncrypted;
  const agentId = settings.realAgentId;
  if (typeof enc !== "string" || typeof agentId !== "string") return null;
  try {
    return { apiKey: getEncryptionService().decrypt(enc), agentId };
  } catch {
    return null;
  }
}

export async function clearRealApiKey(db: PrismaClient, accountId: string): Promise<void> {
  const account = await db.account.findUnique({
    where: { id: accountId },
    select: { settingsJson: true },
  });
  const settings = (account?.settingsJson ?? {}) as Record<string, unknown>;
  delete settings.realApiKeyEncrypted;
  delete settings.realAgentId;
  await db.account.update({
    where: { id: accountId },
    data: { settingsJson: settings as unknown as Prisma.InputJsonValue },
  });
}
