/**
 * Reconcile Transaction.status with the current FUB stage on the linked
 * contact. Fixes the bug where every auto-created txn defaulted to
 * status='active', regardless of whether the FUB person was actually at
 * a "Closed" stage.
 *
 * Rules:
 *   FUB stage "Closed" (any casing)           -> status=closed
 *   FUB stage "Lead" / "Nurture" / "Attempted contact" / "Unresponsive"
 *                                              -> DELETE the transaction
 *                                                 (it should never have
 *                                                 been created — no milestones
 *                                                 or real data to preserve)
 *   FUB stage "Under Contract" / "Pending" /
 *     "Closing" / "Escrow"                    -> status=active
 *   Anything else                              -> leave as-is
 *
 * Run:
 *   node --env-file=.env --import tsx scripts/backfill-transaction-status.ts
 */

import { PrismaClient } from "@prisma/client";
import { inferTransactionStatus } from "../src/services/core/TransactionService";

async function main() {
  const db = new PrismaClient();

  const rows = await db.transaction.findMany({
    include: { contact: true },
    orderBy: { createdAt: "asc" },
  });

  let updated = 0;
  let deleted = 0;
  let unchanged = 0;
  const changes: Array<{
    id: string;
    contact: string;
    stage: string;
    before: string;
    action: string;
  }> = [];

  for (const t of rows) {
    const raw = t.contact.rawFubPayloadJson;
    const stage =
      raw && typeof raw === "object" && !Array.isArray(raw)
        ? ((raw as Record<string, unknown>).stage as string | undefined)
        : undefined;

    const inferred = inferTransactionStatus(stage);

    if (inferred === null) {
      // Pre-deal stage — delete the transaction + cascade children
      await db.transaction.delete({ where: { id: t.id } });
      deleted++;
      changes.push({
        id: t.id,
        contact: t.contact.fullName,
        stage: stage ?? "—",
        before: t.status,
        action: "DELETED",
      });
      continue;
    }

    if (inferred === t.status) {
      unchanged++;
      continue;
    }

    await db.transaction.update({
      where: { id: t.id },
      data: { status: inferred },
    });
    updated++;
    changes.push({
      id: t.id,
      contact: t.contact.fullName,
      stage: stage ?? "—",
      before: t.status,
      action: `→ ${inferred}`,
    });
  }

  console.log(`\nBackfill summary:`);
  console.log(`  Updated:   ${updated}`);
  console.log(`  Deleted:   ${deleted}`);
  console.log(`  Unchanged: ${unchanged}`);
  console.log(`\nDetails:`);
  for (const c of changes) {
    console.log(
      `  ${c.contact.padEnd(30)} stage="${c.stage}"`.padEnd(65) +
        ` ${c.before.padEnd(8)} ${c.action}`,
    );
  }

  await db.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
