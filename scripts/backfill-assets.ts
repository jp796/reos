/**
 * scripts/backfill-assets.ts
 *
 * Investor Module Phase 0 — lazy/incremental Asset backfill (spec §2,
 * §12). Creates one degenerate Asset per existing Transaction that has
 * no parent yet, then links the Transaction to it. Retail deals get a
 * 1:1 Asset (representation=agency, strategy=retail) — the spec's
 * "degenerate Asset, dies at close" case.
 *
 * This is OPTIONAL. The shadow design means existing retail queries run
 * fine with asset_id=NULL; run this only when you want every legacy deal
 * represented on the unified Asset board. Safe to run repeatedly —
 * idempotent (skips any Transaction that already has an assetId).
 *
 * SAFETY: dry-run by default. Prints what it WOULD do and changes
 * nothing. Pass --apply to actually write. Scope to one tenant with
 * --account=<accountId>.
 *
 * Run:
 *   node --env-file=.env --import tsx scripts/backfill-assets.ts            # dry run, all tenants
 *   node --env-file=.env --import tsx scripts/backfill-assets.ts --apply    # write
 *   node --env-file=.env --import tsx scripts/backfill-assets.ts --apply --account=<id>
 */

import { PrismaClient } from "@prisma/client";

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const accountArg = args.find((a) => a.startsWith("--account="));
  const accountId = accountArg ? accountArg.split("=")[1] : null;

  const db = new PrismaClient();

  const rows = await db.transaction.findMany({
    where: {
      assetId: null,
      ...(accountId ? { accountId } : {}),
    },
    select: {
      id: true,
      accountId: true,
      assignedUserId: true,
      propertyAddress: true,
      riskScore: true,
    },
    orderBy: { createdAt: "asc" },
  });

  console.log(
    `\nInvestor Module — Asset backfill ${apply ? "(APPLY)" : "(dry run)"}`,
  );
  console.log(
    `  ${rows.length} transaction(s) with no parent Asset` +
      (accountId ? ` in account ${accountId}` : " across all tenants") +
      `\n`,
  );

  let created = 0;
  for (const t of rows) {
    if (!apply) {
      created++;
      continue;
    }
    // Create the degenerate retail Asset + link the txn in one txn so a
    // crash can't leave a parentless Asset or an unlinked transaction.
    await db.$transaction(async (tx) => {
      const asset = await tx.asset.create({
        data: {
          accountId: t.accountId,
          ownerUserId: t.assignedUserId,
          address: t.propertyAddress,
          representation: "agency",
          strategy: "retail",
          riskScore: t.riskScore,
        },
      });
      await tx.transaction.update({
        where: { id: t.id },
        data: { assetId: asset.id },
      });
    });
    created++;
  }

  console.log(
    apply
      ? `  ✓ Created + linked ${created} Asset(s).`
      : `  Would create ${created} Asset(s). Re-run with --apply to write.`,
  );

  await db.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
