/**
 * DealContactEnrichmentService — writes the co-op (other-side) agent and title
 * company contact info onto a transaction as STRUCTURED flat fields, instead of
 * flattening it into a notes string and losing it.
 *
 * "Enrich, never clobber": a field is only filled when it's currently empty, so
 * a human edit or an earlier better value is never overwritten. This is what
 * lets the deal record update dynamically as new docs/emails arrive without
 * fighting the user.
 */

import type { PrismaClient } from "@prisma/client";

export interface ExtractedAgent {
  name?: string | null;
  role?: string | null;
  email?: string | null;
  phone?: string | null;
  brokerage?: string | null;
  license?: string | null;
}

export type DealSide = "buy" | "sell" | "both";

const clean = (s: string | null | undefined): string | null => {
  const t = s?.trim();
  return t && t.length > 0 ? t : null;
};

/** Our side of the deal — explicit `side`, else inferred from the deal type. */
export function ourSide(txn: {
  side?: string | null;
  transactionType?: string | null;
}): DealSide | null {
  if (txn.side === "buy" || txn.side === "sell" || txn.side === "both") return txn.side;
  if (txn.transactionType === "buyer") return "buy";
  if (txn.transactionType === "seller" || txn.transactionType === "listing") return "sell";
  return null;
}

const isListingRole = (r: string | null | undefined) => /list|sell/.test((r ?? "").toLowerCase());
const isBuyerRole = (r: string | null | undefined) => /buy/.test((r ?? "").toLowerCase());

/**
 * The co-op agent = the agent on the OPPOSITE side from us. Buy-side → the
 * listing agent; sell-side → the buyer's agent. Dual / unknown side has no
 * single "other" agent, so returns null (we don't guess).
 */
export function pickCoAgent(agents: ExtractedAgent[], side: DealSide | null): ExtractedAgent | null {
  if (side === "buy") return agents.find((a) => isListingRole(a.role) && clean(a.name)) ?? null;
  if (side === "sell") return agents.find((a) => isBuyerRole(a.role) && clean(a.name)) ?? null;
  return null;
}

export interface EnrichInput {
  agents: ExtractedAgent[];
  titleCompanyName?: string | null;
  /** Optional title contact details (usually from an inbound title email). */
  titleCompanyContact?: string | null;
  titleCompanyPhone?: string | null;
  titleCompanyEmail?: string | null;
  /** Lender contact — loan officer name + their company / phone / email. */
  lenderName?: string | null;
  lenderCompany?: string | null;
  lenderPhone?: string | null;
  lenderEmail?: string | null;
}

/** Which flat columns to set, given the deal's current values (enrich-only). */
export function computeContactPatch(
  current: {
    coAgentName: string | null;
    coAgentBrokerage: string | null;
    coAgentPhone: string | null;
    coAgentEmail: string | null;
    coAgentLicense: string | null;
    titleCompanyName: string | null;
    titleCompanyContact: string | null;
    titleCompanyPhone: string | null;
    titleCompanyEmail: string | null;
    lenderName: string | null;
    lenderCompany: string | null;
    lenderPhone: string | null;
    lenderEmail: string | null;
  },
  side: DealSide | null,
  input: EnrichInput,
): Record<string, string> {
  const patch: Record<string, string> = {};
  const fill = (key: keyof typeof current, value: string | null) => {
    const v = clean(value);
    if (v && !current[key]) patch[key] = v;
  };

  const co = pickCoAgent(input.agents, side);
  if (co) {
    fill("coAgentName", co.name ?? null);
    fill("coAgentBrokerage", co.brokerage ?? null);
    fill("coAgentPhone", co.phone ?? null);
    fill("coAgentEmail", co.email ?? null);
    fill("coAgentLicense", co.license ?? null);
  }

  fill("titleCompanyName", input.titleCompanyName ?? null);
  fill("titleCompanyContact", input.titleCompanyContact ?? null);
  fill("titleCompanyPhone", input.titleCompanyPhone ?? null);
  fill("titleCompanyEmail", input.titleCompanyEmail ?? null);

  fill("lenderName", input.lenderName ?? null);
  fill("lenderCompany", input.lenderCompany ?? null);
  fill("lenderPhone", input.lenderPhone ?? null);
  fill("lenderEmail", input.lenderEmail ?? null);

  return patch;
}

/**
 * Enrich a transaction's flat co-op-agent + title-company fields from an
 * extraction (or an inbound email). Returns the number of fields filled.
 */
export async function enrichFlatDealContacts(
  db: PrismaClient,
  transactionId: string,
  input: EnrichInput,
): Promise<number> {
  const txn = await db.transaction.findUnique({
    where: { id: transactionId },
    select: {
      accountId: true,
      side: true,
      transactionType: true,
      coAgentName: true,
      coAgentBrokerage: true,
      coAgentPhone: true,
      coAgentEmail: true,
      coAgentLicense: true,
      titleCompanyName: true,
      titleCompanyContact: true,
      titleCompanyPhone: true,
      titleCompanyEmail: true,
      lenderName: true,
      lenderCompany: true,
      lenderPhone: true,
      lenderEmail: true,
    },
  });
  if (!txn) return 0;

  const side = ourSide(txn);
  const co = pickCoAgent(input.agents, side);

  // RECALL — fill gaps from what REOS already knows (fewer re-extractions).
  // If we have a name but no email/phone, borrow them from the directory.
  const { recallContact } = await import("@/services/core/KnownContactService");
  const enriched: EnrichInput = { ...input };
  if (co?.name && (!co.email || !co.phone)) {
    const r = await recallContact(db, txn.accountId, { name: co.name, email: co.email });
    if (r) {
      co.email = co.email ?? r.email;
      co.phone = co.phone ?? r.phone;
    }
  }
  if (enriched.lenderName && (!enriched.lenderEmail || !enriched.lenderPhone)) {
    const r = await recallContact(db, txn.accountId, { name: enriched.lenderName, email: enriched.lenderEmail });
    if (r) {
      enriched.lenderEmail = enriched.lenderEmail ?? r.email;
      enriched.lenderPhone = enriched.lenderPhone ?? r.phone;
    }
  }

  const patch = computeContactPatch(txn, side, enriched);
  const keys = Object.keys(patch);

  if (keys.length > 0) {
    await db.transaction.update({ where: { id: transactionId }, data: patch });
  }

  // REMEMBER — role-tag every contact we now know into the account directory,
  // so it feeds Vendors and can be recalled on future deals. Best-effort.
  try {
    const { rememberContact } = await import("@/services/core/KnownContactService");
    const acct = txn.accountId;
    if (co?.name) {
      await rememberContact(db, acct, {
        name: co.name,
        email: co.email ?? patch.coAgentEmail ?? txn.coAgentEmail,
        phone: co.phone ?? patch.coAgentPhone ?? txn.coAgentPhone,
        role: side === "buy" ? "listing_agent" : "buyer_agent",
      });
    }
    const titleName = patch.titleCompanyName ?? txn.titleCompanyName;
    const titleEmail = patch.titleCompanyEmail ?? txn.titleCompanyEmail;
    if (titleName || titleEmail) {
      await rememberContact(db, acct, {
        name: patch.titleCompanyContact ?? txn.titleCompanyContact ?? titleName,
        email: titleEmail,
        phone: patch.titleCompanyPhone ?? txn.titleCompanyPhone,
        role: "title_co",
      });
    }
    const lenderName = patch.lenderName ?? txn.lenderName;
    const lenderEmail = patch.lenderEmail ?? txn.lenderEmail;
    if (lenderName || lenderEmail) {
      await rememberContact(db, acct, {
        name: lenderName ?? patch.lenderCompany ?? txn.lenderCompany,
        email: lenderEmail,
        phone: patch.lenderPhone ?? txn.lenderPhone,
        role: "lender",
      });
    }
  } catch {
    /* directory memory is best-effort — never block the deal update */
  }

  return keys.length;
}
