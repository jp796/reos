/**
 * POST /api/transactions/:id/contract/apply
 *
 * Body: { extraction: ContractExtraction-shaped object, with any
 *         user-edited values }
 *
 * Writes confirmed fields from the pending extraction onto the
 * Transaction (dates, address, title co, lender), upserts any
 * compensation into TransactionFinancials, and creates/updates
 * Milestones for each deadline. All values remain editable via
 * existing forms on the txn detail page.
 *
 * After a successful apply, clears pendingContractJson and stamps
 * contractAppliedAt.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import {
  addBusinessDays,
  defaultWalkthroughForState,
} from "@/lib/business-days";
import { env } from "@/lib/env";
import { getEncryptionService } from "@/lib/encryption";
import {
  GoogleOAuthService,
  DEFAULT_SCOPES,
} from "@/services/integrations/GoogleOAuthService";
import {
  GmailService,
  EmailTransactionMatchingService,
} from "@/services/integrations/GmailService";
import { AutomationAuditService } from "@/services/integrations/FollowUpBossService";
import { SmartFolderService } from "@/services/automation/SmartFolderService";

type Field<T = unknown> = {
  value: T | null;
  confidence?: number;
  snippet?: string | null;
};

interface ApplyBody {
  extraction?: Record<string, unknown>;
}

function toDate(v: unknown): Date | null {
  if (typeof v !== "string") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
function toNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v.replace(/[,$\s]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
function toStr(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}
function fieldVal<T = unknown>(o: unknown, key: string): T | null {
  if (!o || typeof o !== "object") return null;
  const f = (o as Record<string, unknown>)[key] as Field<T> | undefined;
  if (!f || typeof f !== "object") return null;
  return (f.value ?? null) as T | null;
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const txn = await prisma.transaction.findUnique({
    where: { id },
    include: { financials: true },
  });
  if (!txn) return NextResponse.json({ error: "not found" }, { status: 404 });

  let body: ApplyBody;
  try {
    body = (await req.json()) as ApplyBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const ext = body.extraction ?? txn.pendingContractJson;
  if (!ext || typeof ext !== "object") {
    return NextResponse.json(
      { error: "no extraction to apply" },
      { status: 400 },
    );
  }

  // Anti-overwrite policy: when the user has manually edited the
  // transaction (manuallyEditedAt is set), we ONLY fill fields that
  // are currently null. Any field the human filled by hand is
  // preserved — the extraction's value goes into the response as a
  // "preserved" hint but is NOT applied to the row. The user can
  // explicitly opt back into a full re-apply by clicking
  // "Discard my edits and re-apply" on the panel (which clears
  // manuallyEditedAt before this route runs).
  const preserveManual = !!txn.manuallyEditedAt;
  const preserved: string[] = [];
  function setIfFree<K extends keyof Prisma.TransactionUpdateInput>(
    data: Prisma.TransactionUpdateInput,
    key: K,
    incoming: Prisma.TransactionUpdateInput[K] | null | undefined,
    fieldName: string,
    currentValue: unknown,
  ): void {
    if (incoming == null) return;
    if (preserveManual && currentValue != null) {
      preserved.push(fieldName);
      return;
    }
    data[key] = incoming;
  }

  // --- Transaction field updates (skip nulls; never clobber existing values
  // except when the extraction gives us a better one)
  const data: Prisma.TransactionUpdateInput = {};
  const closingDate = toDate(fieldVal(ext, "closingDate"));
  setIfFree(data, "closingDate", closingDate, "closingDate", txn.closingDate);
  const possessionDate = toDate(fieldVal(ext, "possessionDate"));
  setIfFree(data, "possessionDate", possessionDate, "possessionDate", txn.possessionDate);
  const inspectionDeadline = toDate(fieldVal(ext, "inspectionDeadline"));
  setIfFree(data, "inspectionDate", inspectionDeadline, "inspectionDate", txn.inspectionDate);
  const inspectionObjectionDeadline = toDate(
    fieldVal(ext, "inspectionObjectionDeadline"),
  );
  setIfFree(
    data,
    "inspectionObjectionDate",
    inspectionObjectionDeadline,
    "inspectionObjectionDate",
    txn.inspectionObjectionDate,
  );
  const financingDeadline = toDate(fieldVal(ext, "financingDeadline"));
  setIfFree(data, "financingDeadline", financingDeadline, "financingDeadline", txn.financingDeadline);
  const titleDeadline = toDate(fieldVal(ext, "titleCommitmentDeadline"));
  setIfFree(data, "titleDeadline", titleDeadline, "titleDeadline", txn.titleDeadline);
  const titleObjectionDeadline = toDate(fieldVal(ext, "titleObjectionDeadline"));
  setIfFree(data, "titleObjectionDate", titleObjectionDeadline, "titleObjectionDate", txn.titleObjectionDate);
  const effectiveDate = toDate(fieldVal(ext, "effectiveDate"));
  setIfFree(data, "contractDate", effectiveDate, "contractDate", txn.contractDate);
  // Earnest money due: prefer the explicit date on the contract; if
  // absent, most state forms default to "3 business days after mutual
  // acceptance" — compute from effectiveDate + 3 biz days.
  let earnestDue = toDate(fieldVal(ext, "earnestMoneyDueDate"));
  let earnestDueDerived = false;
  if (!earnestDue && effectiveDate) {
    earnestDue = addBusinessDays(effectiveDate, 3);
    earnestDueDerived = true;
  }
  setIfFree(data, "earnestMoneyDueDate", earnestDue, "earnestMoneyDueDate", txn.earnestMoneyDueDate);
  // Walkthrough: prefer the explicit date on the contract. If absent,
  // apply state-default rules (e.g. Wyoming = closing − 1 calendar
  // day). State is sourced from the existing txn or from the extracted
  // property-address trailing "... WY 82009".
  let walkthrough = toDate(fieldVal(ext, "walkthroughDate"));
  let walkthroughDerived = false;
  if (!walkthrough && closingDate) {
    const stateSource =
      txn.state ?? (fieldVal(ext, "propertyAddress") as string | null);
    const derived = defaultWalkthroughForState(closingDate, stateSource);
    if (derived) {
      walkthrough = derived;
      walkthroughDerived = true;
    }
  }
  setIfFree(data, "walkthroughDate", walkthrough, "walkthroughDate", txn.walkthroughDate);
  const propertyAddress = toStr(fieldVal(ext, "propertyAddress"));
  if (propertyAddress && !txn.propertyAddress) data.propertyAddress = propertyAddress;
  const titleCo = toStr(fieldVal(ext, "titleCompanyName"));
  setIfFree(data, "titleCompanyName", titleCo, "titleCompanyName", txn.titleCompanyName);
  const lender = toStr(fieldVal(ext, "lenderName"));
  setIfFree(data, "lenderName", lender, "lenderName", txn.lenderName);

  // Contract lifecycle stage + signature dates
  const stage = toStr(fieldVal(ext, "contractStage"));
  if (stage && ["offer", "counter", "executed", "unknown"].includes(stage)) {
    data.contractStage = stage;
  }
  const buyerSignedAt = toDate(fieldVal(ext, "buyerSignedAt"));
  if (buyerSignedAt) data.buyerSignedAt = buyerSignedAt;
  const sellerSignedAt = toDate(fieldVal(ext, "sellerSignedAt"));
  if (sellerSignedAt) data.sellerSignedAt = sellerSignedAt;

  data.contractAppliedAt = new Date();
  data.pendingContractJson = Prisma.DbNull;

  await prisma.transaction.update({ where: { id: txn.id }, data });

  // --- Milestones: upsert one per extracted deadline.
  // Keyed by (transactionId, type) + source="contract_extraction" so a
  // re-apply updates instead of duplicates.
  const mileStoneSpec: Array<{ type: string; label: string; dueAt: Date | null; ownerRole: string }> = [
    { type: "contract_effective", label: "Under contract", dueAt: effectiveDate, ownerRole: "agent" },
    {
      type: "earnest_money",
      label: earnestDueDerived
        ? "Earnest money due (3 biz days rule)"
        : "Earnest money due",
      dueAt: earnestDue,
      ownerRole: "client",
    },
    { type: "inspection", label: "Inspection deadline", dueAt: inspectionDeadline, ownerRole: "inspector" },
    { type: "inspection_objection", label: "Inspection objection deadline", dueAt: inspectionObjectionDeadline, ownerRole: "client" },
    { type: "title_commitment", label: "Title commitment due", dueAt: titleDeadline, ownerRole: "title" },
    { type: "title_objection", label: "Title objection deadline", dueAt: titleObjectionDeadline, ownerRole: "client" },
    { type: "financing_approval", label: "Financing approval deadline", dueAt: financingDeadline, ownerRole: "lender" },
    {
      type: "walkthrough",
      label: walkthroughDerived
        ? "Final walkthrough (WY rule: close - 1d)"
        : "Final walkthrough",
      dueAt: walkthrough,
      ownerRole: "agent",
    },
    { type: "closing", label: "Closing", dueAt: closingDate, ownerRole: "title" },
    { type: "possession", label: "Possession", dueAt: possessionDate, ownerRole: "client" },
  ];

  let milestonesUpserted = 0;
  for (const spec of mileStoneSpec) {
    if (!spec.dueAt) continue;
    const existing = await prisma.milestone.findFirst({
      where: { transactionId: txn.id, type: spec.type },
    });
    if (existing) {
      await prisma.milestone.update({
        where: { id: existing.id },
        data: {
          dueAt: spec.dueAt,
          label: spec.label,
          source: "extracted",
          confidenceScore: 0.9,
        },
      });
    } else {
      await prisma.milestone.create({
        data: {
          transactionId: txn.id,
          type: spec.type,
          label: spec.label,
          dueAt: spec.dueAt,
          ownerRole: spec.ownerRole,
          source: "extracted",
          confidenceScore: 0.9,
        },
      });
    }
    milestonesUpserted++;
  }

  // --- Compensation → TransactionFinancials (editable later by user)
  const purchasePrice = toNum(fieldVal<number>(ext, "purchasePrice"));
  const sellerPct = toNum(fieldVal<number>(ext, "sellerSideCommissionPct"));
  const sellerAmt = toNum(fieldVal<number>(ext, "sellerSideCommissionAmount"));
  const buyerPct = toNum(fieldVal<number>(ext, "buyerSideCommissionPct"));
  const buyerAmt = toNum(fieldVal<number>(ext, "buyerSideCommissionAmount"));

  const side = (txn.side ?? txn.transactionType ?? "").toLowerCase();
  // Figure out which commission line matches this transaction's side.
  const myPct = side === "sell" || side === "seller" || side === "listing"
    ? sellerPct
    : buyerPct;
  const myAmt = side === "sell" || side === "seller" || side === "listing"
    ? sellerAmt
    : buyerAmt;

  let computedGross: number | null = null;
  if (myAmt !== null && myAmt > 0) {
    computedGross = myAmt;
  } else if (myPct !== null && myPct > 0 && purchasePrice !== null && purchasePrice > 0) {
    // sellerSideCommissionPct is stored as decimal (0.03), not 3
    const pct = myPct > 1 ? myPct / 100 : myPct;
    computedGross = Math.round(purchasePrice * pct);
  }

  if (purchasePrice !== null || computedGross !== null) {
    await prisma.transactionFinancials.upsert({
      where: { transactionId: txn.id },
      create: {
        transactionId: txn.id,
        salePrice: purchasePrice ?? null,
        grossCommission: computedGross,
      },
      update: {
        ...(purchasePrice !== null
          ? { salePrice: purchasePrice }
          : {}),
        ...(computedGross !== null && !txn.financials?.grossCommission
          ? { grossCommission: computedGross }
          : {}),
      },
    });
  }

  // SKILL: Contract = Folder
  // Any time a contract is applied to a transaction (manual upload,
  // accepted-contract scan create, title-order orchestrator, etc.),
  // auto-create a SmartFolder. SmartFolderService.setupForTransaction
  // is idempotent + gated — safe to call even if one already exists.
  let smartFolder: unknown = null;
  if (
    env.GOOGLE_CLIENT_ID &&
    env.GOOGLE_CLIENT_SECRET &&
    env.GOOGLE_REDIRECT_URI
  ) {
    try {
      const acct = await prisma.account.findUnique({
        where: { id: txn.accountId },
        select: { id: true, googleOauthTokensEncrypted: true },
      });
      if (acct?.googleOauthTokensEncrypted) {
        const oauth = new GoogleOAuthService(
          {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
            redirectUri: env.GOOGLE_REDIRECT_URI,
            scopes: DEFAULT_SCOPES,
          },
          prisma,
          getEncryptionService(),
        );
        const gAuth = await oauth.createAuthenticatedClient(acct.id);
        const gmail = new GmailService(
          acct.id,
          gAuth,
          {
            labelPrefix: "REOS/",
            autoOrganizeThreads: false,
            extractAttachments: false,
            batchSize: 10,
            rateLimitDelayMs: 100,
          },
          prisma,
          new EmailTransactionMatchingService(),
        );
        const audit = new AutomationAuditService(prisma);
        const svc = new SmartFolderService({
          db: prisma,
          auth: gAuth,
          gmail,
          audit,
        });
        smartFolder = await svc.setupForTransaction(txn.id);
      }
    } catch (err) {
      console.warn(
        "SmartFolder setup on contract apply failed (non-blocking):",
        err instanceof Error ? err.message : err,
      );
    }
  }

  // Sync participants from the extraction's buyer + seller arrays
  // so every party on the contract shows up in the ParticipantsPanel.
  // Skips the primary contact (already on the txn) and any name we
  // already have as a participant.
  const participantsCreated = await syncParticipantsFromExtraction(
    txn.id,
    txn.accountId,
    txn.contactId,
    ext,
    txn.side,
  );

  return NextResponse.json({
    ok: true,
    milestonesUpserted,
    participantsCreated,
    appliedFields: Object.keys(data).filter(
      (k) => !["contractAppliedAt", "pendingContractJson"].includes(k),
    ),
    /** Fields that the extraction WOULD have written, but we
     * preserved the human-edited value because manuallyEditedAt was
     * set. Surfaced so the UI can prompt "X fields preserved — review
     * + force-apply if needed". */
    preservedFields: preserved,
    manuallyEditedAtPreserved: preserveManual,
    financials: {
      salePrice: purchasePrice,
      grossCommission: computedGross,
    },
    smartFolder,
  });
}

/**
 * Upsert a TransactionParticipant for every name in the extraction's
 * buyers[] and sellers[] arrays that isn't already:
 *   - the primary contact on the transaction, OR
 *   - already linked as a participant
 *
 * Role is chosen by which array the name came from:
 *   buyers[] → co_buyer, sellers[] → co_seller
 *
 * Returns the count of NEW participant rows created. Never throws —
 * the contract-apply path must not fail because we couldn't enrich.
 */
async function syncParticipantsFromExtraction(
  transactionId: string,
  accountId: string,
  primaryContactId: string,
  ext: unknown,
  side: string | null,
): Promise<number> {
  if (!ext || typeof ext !== "object") return 0;
  const e = ext as Record<string, unknown>;

  // fieldVal normalizes { value, confidence, snippet } wrappers
  const buyerNames = asNameArr(e["buyers"]);
  const sellerNames = asNameArr(e["sellers"]);
  if (buyerNames.length === 0 && sellerNames.length === 0) return 0;

  // Load everything we need to dedupe
  const [primary, existing] = await Promise.all([
    prisma.contact.findUnique({
      where: { id: primaryContactId },
      select: { fullName: true },
    }),
    prisma.transactionParticipant.findMany({
      where: { transactionId },
      include: { contact: { select: { fullName: true, primaryEmail: true } } },
    }),
  ]);
  const primaryNameLc = primary?.fullName?.toLowerCase() ?? "";
  const takenNames = new Set<string>([
    ...(primaryNameLc ? [primaryNameLc] : []),
    ...existing.map((p) => p.contact.fullName.toLowerCase()),
  ]);

  let created = 0;
  const todo: Array<{ name: string; role: "co_buyer" | "co_seller" }> = [];
  for (const n of buyerNames) todo.push({ name: n, role: "co_buyer" });
  for (const n of sellerNames) todo.push({ name: n, role: "co_seller" });

  for (const { name, role } of todo) {
    const key = name.toLowerCase();
    if (takenNames.has(key)) continue;
    takenNames.add(key);

    // Prefer reusing an existing contact in this account by exact name
    let contact = await prisma.contact.findFirst({
      where: {
        accountId,
        fullName: { equals: name, mode: "insensitive" },
      },
      select: { id: true },
    });
    if (!contact) {
      contact = await prisma.contact.create({
        data: {
          accountId,
          fullName: name,
          sourceName: "Contract extraction participant sync",
        },
        select: { id: true },
      });
    }

    try {
      await prisma.transactionParticipant.create({
        data: {
          transactionId,
          contactId: contact.id,
          role,
          notes: `From contract extraction (${role === "co_buyer" ? "buyer" : "seller"} list)${
            side === "both" ? " · dual agency" : ""
          }`,
        },
      });
      created++;
    } catch {
      // unique violation = already linked, skip silently
    }
  }
  return created;
}

/** Extract a name-array from an extraction field. The field can be:
 *   { value: ["Jane Doe", "John Doe"], confidence, ... }   ← normal
 *   { value: "Jane Doe, John Doe" }                        ← string form
 *   ["Jane Doe", "John Doe"]                               ← raw array
 *   null / undefined                                       ← empty
 */
function asNameArr(v: unknown): string[] {
  if (!v) return [];
  let src: unknown = v;
  if (typeof v === "object" && !Array.isArray(v) && v && "value" in v) {
    src = (v as { value?: unknown }).value;
  }
  if (Array.isArray(src)) {
    return src
      .map((x) => (typeof x === "string" ? x.trim() : ""))
      .filter((x) => x.length >= 2)
      .slice(0, 6); // safety cap
  }
  if (typeof src === "string") {
    return src
      .split(/[,;]|\band\b/i)
      .map((s) => s.trim())
      .filter((s) => s.length >= 2)
      .slice(0, 6);
  }
  return [];
}
