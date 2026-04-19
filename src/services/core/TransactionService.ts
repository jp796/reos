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
    input: CreateTransactionInput & { idempotent?: boolean },
  ): Promise<{ transaction: Transaction; created: boolean }> {
    // Idempotency: one transaction per contact by default.
    if (input.idempotent !== false) {
      const existing = await this.db.transaction.findFirst({
        where: { contactId: input.contactId },
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
      // When no contract date is known, skip pre-contract milestones
      // (offsetDays < 0) — they'd otherwise default to new Date() + (-n)
      // and show as instantly overdue. The rest (contract-day and
      // forward-looking) still land with reasonable `now + offset` dates.
      // When contract_date is set later, applyMilestoneTemplate can be
      // re-run and it'll fill in the skipped pre-contract items.
      if (contractDate === null && t.offsetDays < 0) {
        skipped++;
        continue;
      }
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
  stages: [
    "Under Contract",
    "Pending",
    "Closing",
    "Closed",
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
