/**
 * TransactionService
 *
 * Phase 1 Week 3 core: create transactions from contacts, apply milestone
 * templates, infer transaction type from FUB data, idempotency guards.
 *
 * Deliberately NOT in this file:
 *   - FUB sync logic (lives in FollowUpBossService — it calls into here)
 *   - Risk scoring / AI summaries (Phase 4+)
 *   - Task generation (TaskService, later)
 */

import type { PrismaClient, Prisma, Transaction } from "@prisma/client";
import type {
  TransactionType,
  TransactionSide,
  CreateTransactionInput,
  MilestoneSource,
} from "@/types";
import {
  MILESTONE_TEMPLATES,
  computeDueAt,
  type MilestoneTemplate,
} from "./MilestoneTemplates";

export class TransactionService {
  constructor(private readonly db: PrismaClient) {}

  /**
   * Create a transaction for a contact and apply the appropriate milestone
   * template. Idempotent: if the contact already has any transaction, returns
   * the existing one rather than creating a duplicate.
   */
  async createFromContact(
    input: CreateTransactionInput & {
      idempotent?: boolean;
      /** Override default 'active' — e.g. 'closed' for historical deals. */
      status?: "active" | "pending" | "closed" | "dead";
    },
  ): Promise<{ transaction: Transaction; created: boolean }> {
    // Idempotency: one transaction per (contact, propertyAddress, side).
    // A single contact can be on multiple deals (buyer of 4808 Rock
    // Springs AND seller of 4769 Windmill), so we only dedupe when the
    // property or side matches. If no propertyAddress provided, fall
    // back to contact-level dedup (legacy).
    if (input.idempotent !== false) {
      const where: Prisma.TransactionWhereInput = input.propertyAddress
        ? {
            contactId: input.contactId,
            propertyAddress: {
              equals: input.propertyAddress,
              mode: "insensitive",
            },
          }
        : {
            contactId: input.contactId,
            side: input.side ?? null,
            propertyAddress: null,
          };
      const existing = await this.db.transaction.findFirst({
        where,
        orderBy: { createdAt: "desc" },
      });
      if (existing) return { transaction: existing, created: false };
    }

    const transaction = await this.db.transaction.create({
      data: {
        accountId: input.accountId,
        contactId: input.contactId,
        fubPersonId: input.fubPersonId,
        fubDealId: input.fubDealId,
        propertyAddress: input.propertyAddress,
        city: input.city,
        state: input.state,
        zip: input.zip,
        transactionType: input.transactionType,
        side: input.side,
        status: input.status ?? "active",
        contractDate: input.contractDate,
        closingDate: input.closingDate,
        listDate: input.listDate,
        lenderName: input.lenderName,
        titleCompanyName: input.titleCompanyName,
      },
    });

    await this.applyMilestoneTemplate(
      transaction.id,
      input.transactionType,
      input.contractDate ?? null,
      "manual",
    );

    if (input.salePrice) {
      await this.db.transactionFinancials.create({
        data: {
          transactionId: transaction.id,
          salePrice: input.salePrice,
        },
      });
    }

    if (input.sourceChannelId) {
      await this.db.transactionAttribution.create({
        data: {
          transactionId: transaction.id,
          sourceChannelId: input.sourceChannelId,
          attributionType: "primary",
          weight: 1.0,
        },
      });
    }

    return { transaction, created: true };
  }

  /**
   * Write every milestone from the template for a transaction type.
   * Safe to call multiple times — skips types that already exist for the txn.
   */
  async applyMilestoneTemplate(
    transactionId: string,
    type: TransactionType,
    contractDate: Date | null,
    source: MilestoneSource = "manual",
  ): Promise<{ created: number; skipped: number }> {
    const template = MILESTONE_TEMPLATES[type];
    if (!template) return { created: 0, skipped: 0 };

    const existing = await this.db.milestone.findMany({
      where: { transactionId },
      select: { type: true },
    });
    const have = new Set(existing.map((m) => m.type));

    let created = 0;
    let skipped = 0;
    for (const t of template) {
      if (have.has(t.type)) {
        skipped++;
        continue;
      }
      // All template milestones now land with dueAt=null unless
      // computeDueAt opts in (currently only `closing`). No more
      // "instantly overdue" negative-offset rows, no more "skip
      // pre-contract" pruning needed. Calendar sync filters null.
      await this.createMilestoneFromTemplate(transactionId, t, contractDate, source);
      created++;
    }
    return { created, skipped };
  }

  private async createMilestoneFromTemplate(
    transactionId: string,
    t: MilestoneTemplate,
    contractDate: Date | null,
    source: MilestoneSource,
  ) {
    await this.db.milestone.create({
      data: {
        transactionId,
        type: t.type,
        label: t.label,
        dueAt: computeDueAt(t, contractDate),
        ownerRole: t.ownerRole,
        source,
      },
    });
  }
}

// ==================================================
// FUB → transaction type/side inference
// ==================================================

/**
 * Infer the right transaction type for a FUB person row.
 * FUB exposes a top-level `type` field (e.g. "Seller", "Buyer") plus tags.
 * Falls back to tag scan, then to "other".
 */
export function inferTransactionType(fub: {
  type?: string | null;
  tags?: string[] | null;
}): TransactionType {
  const t = (fub.type ?? "").toLowerCase();
  if (t.includes("buyer")) return "buyer";
  if (t.includes("seller")) return "seller";
  if (t.includes("investor")) return "investor";
  if (t.includes("wholesale")) return "wholesale";

  const tags = (fub.tags ?? []).map((x) => x.toLowerCase());
  if (tags.some((x) => x.includes("buyer"))) return "buyer";
  if (tags.some((x) => x.includes("seller"))) return "seller";
  if (tags.some((x) => x.includes("investor"))) return "investor";
  if (tags.some((x) => x.includes("wholesale"))) return "wholesale";
  return "other";
}

export function inferSide(type: TransactionType): TransactionSide | undefined {
  if (type === "buyer") return "buy";
  if (type === "seller") return "sell";
  return undefined;
}

// ==================================================
// Trigger detection (stage / tag match)
// ==================================================

export interface TransactionTriggerConfig {
  stages: string[]; // case-insensitive match against FUB `stage`
  tags: string[]; // case-insensitive substring match against tags
}

export const DEFAULT_TRIGGER_CONFIG: TransactionTriggerConfig = {
  // Stages that warrant opening a transaction workspace. Note that
  // "Closed" is deliberately absent — closed deals are historical and
  // should not auto-create NEW workspaces on sync, only update existing
  // ones' status. "Lead" and "Nurture" stages are also absent — those
  // are pre-contract and don't need workspaces yet.
  stages: [
    "Under Contract",
    "Under contract",
    "Pending",
    "Closing",
    "Active Client",
    "Active Buyer",
    "Active Seller",
  ],
  tags: [
    "under contract",
    "pending",
    "active buyer",
    "active seller",
    "escrow",
    "closing soon",
  ],
};

/**
 * FUB stages that block transaction creation regardless of tag matches.
 * A "Lead" stage with a "buyer" tag should NOT produce a transaction —
 * they haven't committed to anything yet.
 */
const BLOCKING_STAGES = new Set(
  ["lead", "nurture", "attempted contact", "unresponsive", "bad data"].map((s) =>
    s.toLowerCase(),
  ),
);

/**
 * FUB stages that indicate a deal is already done.
 * Transactions created from these stages should be status='closed'.
 */
const CLOSED_STAGES = new Set(
  ["closed", "closed won", "sold", "closed lost"].map((s) => s.toLowerCase()),
);

/**
 * FUB stages that indicate a dead / archived deal.
 */
const DEAD_STAGES = new Set(
  ["dead", "lost", "archive", "archived", "trash"].map((s) => s.toLowerCase()),
);

/**
 * Infer Transaction.status from the FUB stage string. Returns null when
 * the stage indicates a transaction should NOT exist at all (pre-deal
 * stages like Lead / Nurture).
 */
export function inferTransactionStatus(
  fubStage: string | null | undefined,
): "active" | "pending" | "closed" | "dead" | null {
  const s = (fubStage ?? "").trim().toLowerCase();
  if (!s) return "active";
  if (BLOCKING_STAGES.has(s)) return null;
  if (CLOSED_STAGES.has(s)) return "closed";
  if (DEAD_STAGES.has(s)) return "dead";
  if (/under\s*contract|pending|closing|escrow/.test(s)) return "active";
  return "active";
}

/**
 * Decide whether a FUB person should get an auto-created transaction.
 * Checks stage first, then tags.
 */
export function shouldCreateTransactionForPerson(
  person: {
    stage?: string | null;
    tags?: string[] | null;
  },
  config: TransactionTriggerConfig = DEFAULT_TRIGGER_CONFIG,
): { match: true; reason: string } | { match: false } {
  const stage = (person.stage ?? "").trim().toLowerCase();

  // Hard block: pre-deal stages never create a transaction, even if a
  // tag would otherwise match. Prevents "Lead" contacts with an
  // 'active-buyer-nurture' tag from triggering workspace creation.
  if (stage && BLOCKING_STAGES.has(stage)) {
    return { match: false };
  }

  if (stage) {
    const stageHit = config.stages.find(
      (s) => s.trim().toLowerCase() === stage,
    );
    if (stageHit) return { match: true, reason: `stage:${stageHit}` };
  }

  const tags = (person.tags ?? []).map((t) => t.toLowerCase());
  for (const triggerTag of config.tags) {
    if (tags.some((t) => t.includes(triggerTag.toLowerCase()))) {
      return { match: true, reason: `tag:${triggerTag}` };
    }
  }
  return { match: false };
}

export function resolveTriggerConfig(
  settingsJson: Prisma.JsonValue | null,
): TransactionTriggerConfig {
  if (
    settingsJson &&
    typeof settingsJson === "object" &&
    !Array.isArray(settingsJson) &&
    "transactionTriggers" in settingsJson
  ) {
    const raw = (settingsJson as Record<string, unknown>).transactionTriggers;
    if (
      raw &&
      typeof raw === "object" &&
      !Array.isArray(raw) &&
      Array.isArray((raw as Record<string, unknown>).stages) &&
      Array.isArray((raw as Record<string, unknown>).tags)
    ) {
      return raw as TransactionTriggerConfig;
    }
  }
  return DEFAULT_TRIGGER_CONFIG;
}
