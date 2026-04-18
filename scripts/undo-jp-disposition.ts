/**
 * Undo the erroneous Jp Fluellen title-order disposition.
 *   1. Restore his FUB stage to "Lead" via FUB API
 *   2. Delete the single local transaction + cascade milestones
 *
 * Run: npx tsx scripts/undo-jp-disposition.ts
 */

// Env is loaded by running this via `node --env-file=.env --import tsx ...`
// (or the wrapper script below). No dotenv dependency required.

import { PrismaClient } from "@prisma/client";
import {
  FollowUpBossService,
  AutomationAuditService,
} from "../src/services/integrations/FollowUpBossService";

const CONTACT_ID_MARKER = "jp@titanreteam.com";
const TARGET_STAGE = "Lead";

async function main() {
  const db = new PrismaClient();
  const audit = new AutomationAuditService(db);

  const apiKey = process.env.FUB_API_KEY;
  const systemKey = process.env.FUB_SYSTEM_KEY ?? "real-estate-os";
  if (!apiKey) throw new Error("FUB_API_KEY not set");

  const account = await db.account.findFirst({ select: { id: true } });
  if (!account) throw new Error("no account");

  const contact = await db.contact.findFirst({
    where: { primaryEmail: CONTACT_ID_MARKER },
  });
  if (!contact) throw new Error(`contact ${CONTACT_ID_MARKER} not found`);
  console.log(`Found contact: ${contact.fullName} (fubPersonId=${contact.fubPersonId}, id=${contact.id})`);

  const txnsForContact = await db.transaction.findMany({
    where: { contactId: contact.id },
    select: { id: true, status: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  console.log(`Local transactions for this contact:`, txnsForContact);

  // --- Step 1: Restore FUB stage
  if (contact.fubPersonId) {
    const fub = new FollowUpBossService(
      account.id,
      { apiKey, systemKey },
      db,
      audit,
    );
    console.log(`\nStep 1: restoring FUB stage for person ${contact.fubPersonId} → "${TARGET_STAGE}"`);
    await fub.updatePersonStage(contact.fubPersonId, TARGET_STAGE, {
      reason: "revert_title_scan_false_positive",
      transactionId: null,
    });
    console.log(`  ✓ FUB stage restored`);
  } else {
    console.log(`\nStep 1: SKIPPED — no fubPersonId on contact`);
  }

  // --- Step 2: Delete the local transactions
  if (txnsForContact.length === 0) {
    console.log(`\nStep 2: SKIPPED — no local transactions`);
  } else {
    console.log(`\nStep 2: deleting ${txnsForContact.length} local transaction(s) + cascade...`);
    for (const t of txnsForContact) {
      const res = await db.transaction.delete({ where: { id: t.id } });
      console.log(`  ✓ deleted transaction ${res.id} (status=${res.status})`);
    }
  }

  await db.$disconnect();
  console.log(`\nDONE.`);
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
