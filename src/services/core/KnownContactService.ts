/**
 * KnownContactService — REOS's contact memory. Every lender, title company,
 * and co-op agent REOS sees is remembered as a role-tagged account Contact, so
 * it (a) populates the Vendors directory, and (b) can be RECALLED to fill gaps
 * on future deals instead of re-extracting the same people over and over.
 *
 * "Gets smarter, not harder": the more deals flow through, the more REOS already
 * knows — so it reuses instead of re-processing.
 */

import type { PrismaClient } from "@prisma/client";

export type ContactRole =
  | "buyer_agent"
  | "listing_agent"
  | "title_co"
  | "lender"
  | "inspector"
  | "attorney";

const clean = (s: string | null | undefined): string | null => {
  const t = s?.trim();
  return t && t.length > 0 ? t : null;
};

/** Read a Contact's rolesJson array defensively. */
function readRoles(json: unknown): string[] {
  return Array.isArray(json) ? json.filter((r): r is string => typeof r === "string") : [];
}

export interface RememberInput {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  role: ContactRole;
}

export interface RememberResult {
  id: string;
  reused: boolean; // true = matched an existing contact
}

/**
 * Upsert a role-tagged contact into the account directory. Match by email
 * first (strongest identity), then by name. Enrich-only on email/phone; the
 * role is added to rolesJson if missing. Returns null when there's no usable
 * name or email to key on.
 */
export async function rememberContact(
  db: PrismaClient,
  accountId: string,
  input: RememberInput,
): Promise<RememberResult | null> {
  const name = clean(input.name);
  const email = clean(input.email)?.toLowerCase() ?? null;
  const phone = clean(input.phone);
  if (!name && !email) return null;

  const existing = email
    ? await db.contact.findFirst({
        where: { accountId, primaryEmail: { equals: email, mode: "insensitive" } },
        select: { id: true, primaryEmail: true, primaryPhone: true, rolesJson: true },
      })
    : name
      ? await db.contact.findFirst({
          where: { accountId, fullName: { equals: name, mode: "insensitive" } },
          select: { id: true, primaryEmail: true, primaryPhone: true, rolesJson: true },
        })
      : null;

  if (existing) {
    const roles = readRoles(existing.rolesJson);
    const data: Record<string, unknown> = {};
    if (email && !existing.primaryEmail) data.primaryEmail = email;
    if (phone && !existing.primaryPhone) data.primaryPhone = phone;
    if (!roles.includes(input.role)) data.rolesJson = [...roles, input.role];
    if (Object.keys(data).length > 0) {
      await db.contact.update({ where: { id: existing.id }, data });
    }
    return { id: existing.id, reused: true };
  }

  const created = await db.contact.create({
    data: {
      accountId,
      fullName: (name ?? email ?? "Unknown").slice(0, 160),
      primaryEmail: email,
      primaryPhone: phone,
      rolesJson: [input.role],
    },
    select: { id: true },
  });
  return { id: created.id, reused: false };
}

export interface Recalled {
  name: string | null;
  email: string | null;
  phone: string | null;
}

/**
 * Recall what REOS already knows about a contact by email or name — used to
 * fill a deal's gaps from memory instead of re-extracting. Email match wins.
 */
export async function recallContact(
  db: PrismaClient,
  accountId: string,
  key: { name?: string | null; email?: string | null; role?: ContactRole },
): Promise<Recalled | null> {
  const email = clean(key.email)?.toLowerCase() ?? null;
  const name = clean(key.name);
  if (!email && !name) return null;

  const c =
    (email
      ? await db.contact.findFirst({
          where: { accountId, primaryEmail: { equals: email, mode: "insensitive" } },
          select: { fullName: true, primaryEmail: true, primaryPhone: true },
        })
      : null) ??
    (name
      ? await db.contact.findFirst({
          where: { accountId, fullName: { equals: name, mode: "insensitive" } },
          select: { fullName: true, primaryEmail: true, primaryPhone: true },
        })
      : null);

  if (!c) return null;
  return { name: c.fullName ?? null, email: c.primaryEmail ?? null, phone: c.primaryPhone ?? null };
}
