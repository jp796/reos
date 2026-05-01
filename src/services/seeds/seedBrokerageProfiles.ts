/**
 * Seed brokerage profiles + checklists.
 *
 * Currently seeds:
 *   - "real-broker" — Real Broker LLC + Rezen 34/14 slot lists
 *
 * Idempotent: re-running upserts based on stable slug + slot_key.
 *
 * Future seed packs (Skyslope / Dotloop / KW Command / generic
 * indie) plug into the same shape — copy the function template
 * below, swap the slot list, change the slug.
 */

import type { PrismaClient } from "@prisma/client";
import {
  TRANSACTION_SLOTS,
  LISTING_SLOTS,
  type RezenSlot,
} from "@/services/core/RezenCompliancePrep";

async function upsertProfile(
  db: PrismaClient,
  args: {
    slug: string;
    name: string;
    complianceSystem: string;
    agentEmailDomains?: string[];
    cdaTemplateKey?: string;
    transactionSlots: RezenSlot[];
    listingSlots: RezenSlot[];
  },
): Promise<string> {
  const profile = await db.brokerageProfile.upsert({
    where: { slug: args.slug },
    create: {
      slug: args.slug,
      name: args.name,
      complianceSystem: args.complianceSystem,
      agentEmailDomains: args.agentEmailDomains ?? [],
      cdaTemplateKey: args.cdaTemplateKey ?? null,
    },
    update: {
      name: args.name,
      complianceSystem: args.complianceSystem,
      agentEmailDomains: args.agentEmailDomains ?? [],
      cdaTemplateKey: args.cdaTemplateKey ?? null,
    },
  });

  for (const kind of ["transaction", "listing"] as const) {
    const slots = kind === "transaction" ? args.transactionSlots : args.listingSlots;
    for (const slot of slots) {
      // findFirst + create-or-update — `null` in the unique index
      // makes Prisma's `where: { uniq_… }` shape awkward; manual
      // path is clearer.
      const existing = await db.brokerageChecklist.findFirst({
        where: {
          profileId: profile.id,
          kind,
          slotKey: slot.key,
          stateCode: null,
        },
      });
      if (existing) {
        await db.brokerageChecklist.update({
          where: { id: existing.id },
          data: {
            slotNumber: slot.number,
            label: slot.label,
            required: slot.required,
            tag: slot.tag ?? null,
            requiredFor: slot.requiredFor ?? null,
            keywordsJson: slot.keywords,
          },
        });
      } else {
        await db.brokerageChecklist.create({
          data: {
            profileId: profile.id,
            kind,
            slotNumber: slot.number,
            slotKey: slot.key,
            label: slot.label,
            required: slot.required,
            tag: slot.tag ?? null,
            requiredFor: slot.requiredFor ?? null,
            keywordsJson: slot.keywords,
            stateCode: null,
          },
        });
      }
    }
  }

  return profile.id;
}

export async function seedBrokerageProfiles(db: PrismaClient): Promise<{
  seeded: string[];
}> {
  const seeded: string[] = [];

  // Real Broker (Rezen) — the canonical profile, populated from the
  // existing hard-coded slot constants.
  await upsertProfile(db, {
    slug: "real-broker",
    name: "Real Broker LLC",
    complianceSystem: "rezen",
    agentEmailDomains: ["realbrokerllc.com"],
    cdaTemplateKey: "real-broker-cda-v1",
    transactionSlots: TRANSACTION_SLOTS,
    listingSlots: LISTING_SLOTS,
  });
  seeded.push("real-broker");

  // Generic indie placeholder — reuses the same checklist for now;
  // brokerage owners customize after onboarding.
  await upsertProfile(db, {
    slug: "indie-default",
    name: "Independent (default)",
    complianceSystem: "inhouse",
    agentEmailDomains: [],
    transactionSlots: TRANSACTION_SLOTS,
    listingSlots: LISTING_SLOTS,
  });
  seeded.push("indie-default");

  return { seeded };
}
