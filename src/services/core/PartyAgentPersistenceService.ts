/**
 * PartyAgentPersistenceService (Layer 1 — "persist everything Atlas read").
 *
 * The extraction already captures EVERY party (buyers/sellers with email +
 * phone) and EVERY agent (name, email, phone, brokerage, license) on both
 * sides. The create/apply flow used to keep only the primary contact + ONE
 * co-party and throw the rest away — so 2-seller deals lost a seller and the
 * other side's agent contact info never landed.
 *
 * This service persists the full picture, idempotently and tenant-scoped:
 *   - every additional buyer  → co_buyer participant
 *   - every additional seller → co_seller participant
 *   - every agent             → buyers_agent / co_buyers_agent /
 *                               listing_agent / co_listing_agent participant,
 *                               with the brokerage + license in the notes
 *
 * ENRICH, never clobber: an existing contact's email/phone is only filled
 * when currently empty. Safe to run repeatedly (upsert on the participant
 * unique key) — which is exactly what the backfill needs.
 */

import type { PrismaClient } from "@prisma/client";

/** Minimal shape of the extraction fields we read. Works for both the live
 *  ContractExtraction and a stored analysisJson.baseline (both wrap values
 *  as `{ value }`). Also tolerates already-unwrapped arrays. */
interface Field<T> {
  value?: T | null;
}
type MaybeField<T> = Field<T> | T | null | undefined;

export interface ExtractionLike {
  buyers?: MaybeField<string[]>;
  sellers?: MaybeField<string[]>;
  partyDetails?: MaybeField<
    Array<{ name?: string | null; role?: string | null; email?: string | null; phone?: string | null }>
  >;
  agents?: MaybeField<
    Array<{
      name?: string | null;
      role?: string | null;
      email?: string | null;
      phone?: string | null;
      brokerage?: string | null;
      license?: string | null;
    }>
  >;
  titleCompanyName?: MaybeField<string>;
}

export interface PersistResult {
  coBuyersAdded: number;
  coSellersAdded: number;
  agentsAdded: number;
  contactsEnriched: number;
}

const ZERO: PersistResult = { coBuyersAdded: 0, coSellersAdded: 0, agentsAdded: 0, contactsEnriched: 0 };

function unwrap<T>(f: MaybeField<T>): T | null {
  if (f == null) return null;
  if (typeof f === "object" && !Array.isArray(f) && "value" in (f as object)) {
    return ((f as Field<T>).value ?? null) as T | null;
  }
  return f as T;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const clean = (s: string | null | undefined) => {
  const t = s?.trim();
  return t && t.length > 0 ? t : null;
};

export async function persistPartiesAndAgents(
  db: PrismaClient,
  accountId: string,
  transactionId: string,
  ex: ExtractionLike,
): Promise<PersistResult> {
  const txn = await db.transaction.findFirst({
    where: { id: transactionId, accountId },
    select: { id: true, contactId: true, contact: { select: { fullName: true } } },
  });
  if (!txn) return { ...ZERO };
  const primaryName = norm(txn.contact?.fullName ?? "");

  const parties = unwrap(ex.partyDetails) ?? [];
  const buyers = unwrap(ex.buyers) ?? [];
  const sellers = unwrap(ex.sellers) ?? [];
  const agents = unwrap(ex.agents) ?? [];

  // name → contact info, from the richer partyDetails (for enrichment).
  const partyInfo = new Map<string, { email: string | null; phone: string | null }>();
  for (const p of parties) {
    const n = clean(p?.name);
    if (n) partyInfo.set(norm(n), { email: clean(p?.email), phone: clean(p?.phone) });
  }

  const buyerNames = dedupeNames([
    ...parties.filter((p) => (p?.role ?? "").toLowerCase().includes("buy")).map((p) => p?.name),
    ...buyers,
  ]);
  const sellerNames = dedupeNames([
    ...parties.filter((p) => (p?.role ?? "").toLowerCase().includes("sell")).map((p) => p?.name),
    ...sellers,
  ]);

  const result: PersistResult = { ...ZERO };

  for (const name of buyerNames) {
    if (norm(name) === primaryName) continue;
    const added = await upsertParty(db, accountId, txn.id, name, "co_buyer", partyInfo, result);
    if (added) result.coBuyersAdded++;
  }
  for (const name of sellerNames) {
    if (norm(name) === primaryName) continue;
    const added = await upsertParty(db, accountId, txn.id, name, "co_seller", partyInfo, result);
    if (added) result.coSellersAdded++;
  }

  // Agents — map the free-text role to a per-deal participant role, tracking
  // ordinals so a 2nd same-side agent becomes a co-agent.
  const counts = { buyer: 0, listing: 0 };
  for (const a of agents) {
    const name = clean(a?.name);
    if (!name) continue;
    const role = mapAgentRole(a?.role, counts);
    if (!role) continue; // skip coordinators / unknown roles for now
    const notes = [clean(a?.brokerage), clean(a?.license) ? `Lic ${clean(a?.license)}` : null]
      .filter(Boolean)
      .join(" · ") || null;
    const added = await upsertAgent(db, accountId, txn.id, name, role, clean(a?.email), clean(a?.phone), notes, result);
    if (added) result.agentsAdded++;
  }

  // Write the co-op (other-side) agent + title company onto the deal's flat
  // fields — structured, at-a-glance, and queryable — instead of leaving that
  // info stranded in participant notes. Enrich-only; best-effort.
  try {
    const { enrichFlatDealContacts } = await import(
      "@/services/core/DealContactEnrichmentService"
    );
    await enrichFlatDealContacts(db, txn.id, {
      agents: agents.map((a) => ({
        name: clean(a?.name),
        role: a?.role ?? null,
        email: clean(a?.email),
        phone: clean(a?.phone),
        brokerage: clean(a?.brokerage),
        license: clean(a?.license),
      })),
      titleCompanyName: unwrap(ex.titleCompanyName) ?? null,
    });
  } catch {
    /* never block party persistence on flat-field enrichment */
  }

  return result;
}

function mapAgentRole(roleText: string | null | undefined, counts: { buyer: number; listing: number }): string | null {
  const r = (roleText ?? "").toLowerCase();
  if (/buy/.test(r)) return counts.buyer++ === 0 ? "buyers_agent" : "co_buyers_agent";
  if (/list|sell/.test(r)) return counts.listing++ === 0 ? "listing_agent" : "co_listing_agent";
  return null;
}

function dedupeNames(names: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const n = clean(raw);
    if (!n) continue;
    const k = norm(n);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(n);
  }
  return out;
}

/** Find/create a contact by name (tenant-scoped), enrich email/phone from the
 *  party map when missing, and upsert the participant. Returns true if the
 *  participant row was newly created. */
async function upsertParty(
  db: PrismaClient,
  accountId: string,
  transactionId: string,
  name: string,
  role: "co_buyer" | "co_seller",
  partyInfo: Map<string, { email: string | null; phone: string | null }>,
  result: PersistResult,
): Promise<boolean> {
  const info = partyInfo.get(norm(name));
  const contact = await findOrCreateContact(db, accountId, name, info?.email ?? null, info?.phone ?? null, result);
  return upsertParticipant(db, transactionId, contact.id, role, null);
}

async function upsertAgent(
  db: PrismaClient,
  accountId: string,
  transactionId: string,
  name: string,
  role: string,
  email: string | null,
  phone: string | null,
  notes: string | null,
  result: PersistResult,
): Promise<boolean> {
  const contact = await findOrCreateContact(db, accountId, name, email, phone, result);
  return upsertParticipant(db, transactionId, contact.id, role, notes);
}

async function findOrCreateContact(
  db: PrismaClient,
  accountId: string,
  name: string,
  email: string | null,
  phone: string | null,
  result: PersistResult,
): Promise<{ id: string }> {
  const existing = await db.contact.findFirst({
    where: { accountId, fullName: { equals: name, mode: "insensitive" } },
    select: { id: true, primaryEmail: true, primaryPhone: true },
  });
  if (existing) {
    // Enrich only empty fields — never overwrite a human/prior value.
    const data: Record<string, string> = {};
    if (email && !existing.primaryEmail) data.primaryEmail = email;
    if (phone && !existing.primaryPhone) data.primaryPhone = phone;
    if (Object.keys(data).length > 0) {
      await db.contact.update({ where: { id: existing.id }, data });
      result.contactsEnriched++;
    }
    return { id: existing.id };
  }
  const created = await db.contact.create({
    data: {
      accountId,
      fullName: name.slice(0, 160),
      primaryEmail: email,
      primaryPhone: phone,
      sourceName: "Contract (party/agent extraction)",
    },
    select: { id: true },
  });
  return created;
}

/** Upsert on the (transactionId, contactId, role) unique key. Returns true
 *  when a new participant row was created. Fills notes only when empty. */
async function upsertParticipant(
  db: PrismaClient,
  transactionId: string,
  contactId: string,
  role: string,
  notes: string | null,
): Promise<boolean> {
  const existing = await db.transactionParticipant.findUnique({
    where: { transactionId_contactId_role: { transactionId, contactId, role } },
    select: { id: true, notes: true },
  });
  if (existing) {
    if (notes && !existing.notes) {
      await db.transactionParticipant.update({ where: { id: existing.id }, data: { notes } });
    }
    return false;
  }
  await db.transactionParticipant.create({
    data: { transactionId, contactId, role, notes },
  });
  return true;
}
