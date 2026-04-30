/**
 * MilestoneRecomputeService
 *
 * When `closingDate` or `contractDate` shifts on a transaction,
 * re-derive the deadlines that depend on them — and persist both
 * the Transaction column update AND the matching Milestone row.
 *
 * Rules implemented today:
 *   - closing changes → closing milestone moves
 *   - closing changes → walkthrough recomputes via state rule
 *     (Wyoming: closing − 1 calendar day)
 *   - contract changes → earnest_money recomputes (+3 biz days)
 *   - contract changes → contract_effective milestone moves
 *
 * Inspection / financing / title deadlines are NOT auto-shifted —
 * those are typically negotiated, so we leave them and let the
 * user extend them explicitly via the timeline UI.
 *
 * Idempotent: if the new derived date already matches the
 * persisted date, the row isn't touched.
 */

import type { PrismaClient, Transaction } from "@prisma/client";
import { addBusinessDays, defaultWalkthroughForState } from "@/lib/business-days";

export interface RecomputeResult {
  /** Names of fields that changed, e.g. "walkthrough_date" */
  fieldsUpdated: string[];
  /** Number of milestone rows touched. */
  milestonesUpdated: number;
}

interface ChangeShape {
  closingDate?: Date | null;
  contractDate?: Date | null;
}

export async function recomputeOnDateShift(
  db: PrismaClient,
  transactionId: string,
  changes: ChangeShape,
): Promise<RecomputeResult> {
  const txn = await db.transaction.findUnique({
    where: { id: transactionId },
    select: {
      id: true,
      contractDate: true,
      closingDate: true,
      walkthroughDate: true,
      earnestMoneyDueDate: true,
      state: true,
      propertyAddress: true,
    },
  });
  if (!txn) return { fieldsUpdated: [], milestonesUpdated: 0 };

  const fields: string[] = [];
  let milestonesUpdated = 0;
  const txnUpdate: Record<string, Date | null> = {};

  // Resolve final dates after the change. Caller may pass null to
  // explicitly clear, undefined to leave alone.
  const newClosing =
    changes.closingDate === undefined ? txn.closingDate : changes.closingDate;
  const newContract =
    changes.contractDate === undefined ? txn.contractDate : changes.contractDate;

  /* -----------------------------------------------------------
   * closingDate change → walkthrough + closing milestone
   * ----------------------------------------------------------- */
  if (changes.closingDate !== undefined) {
    // Recompute walkthrough via state rule
    if (newClosing) {
      const stateSource = txn.state ?? txn.propertyAddress;
      const derived = defaultWalkthroughForState(newClosing, stateSource);
      if (derived && (!txn.walkthroughDate || +txn.walkthroughDate !== +derived)) {
        txnUpdate.walkthroughDate = derived;
        fields.push("walkthroughDate");
      }
    } else {
      // closing cleared → also clear walkthrough
      if (txn.walkthroughDate) {
        txnUpdate.walkthroughDate = null;
        fields.push("walkthroughDate");
      }
    }

    // Closing milestone
    const closingMs = await db.milestone.findFirst({
      where: { transactionId, type: "closing" },
    });
    if (closingMs) {
      const before = closingMs.dueAt?.getTime() ?? null;
      const after = newClosing?.getTime() ?? null;
      if (before !== after) {
        await db.milestone.update({
          where: { id: closingMs.id },
          data: { dueAt: newClosing },
        });
        milestonesUpdated++;
      }
    } else if (newClosing) {
      await db.milestone.create({
        data: {
          transactionId,
          type: "closing",
          label: "Closing",
          dueAt: newClosing,
          ownerRole: "title",
          source: "auto_recompute",
          status: "pending",
        },
      });
      milestonesUpdated++;
    }

    // Walkthrough milestone — refresh dueAt from the recomputed
    // walkthroughDate if we updated it.
    if ("walkthroughDate" in txnUpdate) {
      const walkMs = await db.milestone.findFirst({
        where: { transactionId, type: "walkthrough" },
      });
      const newWalk = txnUpdate.walkthroughDate;
      if (walkMs) {
        if ((walkMs.dueAt?.getTime() ?? null) !== (newWalk?.getTime() ?? null)) {
          await db.milestone.update({
            where: { id: walkMs.id },
            data: { dueAt: newWalk },
          });
          milestonesUpdated++;
        }
      } else if (newWalk) {
        await db.milestone.create({
          data: {
            transactionId,
            type: "walkthrough",
            label: "Final walkthrough",
            dueAt: newWalk,
            ownerRole: "agent",
            source: "auto_recompute",
            status: "pending",
          },
        });
        milestonesUpdated++;
      }
    }
  }

  /* -----------------------------------------------------------
   * contractDate change → earnest_money + contract_effective
   * ----------------------------------------------------------- */
  if (changes.contractDate !== undefined) {
    // Earnest money: 3 biz days from contract (state-default).
    if (newContract) {
      const derivedEM = addBusinessDays(newContract, 3);
      if (
        !txn.earnestMoneyDueDate ||
        +txn.earnestMoneyDueDate !== +derivedEM
      ) {
        txnUpdate.earnestMoneyDueDate = derivedEM;
        fields.push("earnestMoneyDueDate");
      }
    } else if (txn.earnestMoneyDueDate) {
      txnUpdate.earnestMoneyDueDate = null;
      fields.push("earnestMoneyDueDate");
    }

    // contract_effective milestone moves with the contract date
    const effMs = await db.milestone.findFirst({
      where: { transactionId, type: "contract_effective" },
    });
    if (effMs) {
      if ((effMs.dueAt?.getTime() ?? null) !== (newContract?.getTime() ?? null)) {
        await db.milestone.update({
          where: { id: effMs.id },
          data: { dueAt: newContract },
        });
        milestonesUpdated++;
      }
    }

    // earnest_money milestone moves with the recomputed EM date
    if ("earnestMoneyDueDate" in txnUpdate) {
      const emMs = await db.milestone.findFirst({
        where: { transactionId, type: "earnest_money" },
      });
      const newEM = txnUpdate.earnestMoneyDueDate;
      if (emMs) {
        if ((emMs.dueAt?.getTime() ?? null) !== (newEM?.getTime() ?? null)) {
          await db.milestone.update({
            where: { id: emMs.id },
            data: { dueAt: newEM },
          });
          milestonesUpdated++;
        }
      } else if (newEM) {
        await db.milestone.create({
          data: {
            transactionId,
            type: "earnest_money",
            label: "Earnest money due (3 biz days rule)",
            dueAt: newEM,
            ownerRole: "client",
            source: "auto_recompute",
            status: "pending",
          },
        });
        milestonesUpdated++;
      }
    }
  }

  // Persist any txn column changes
  if (fields.length > 0) {
    await db.transaction.update({
      where: { id: transactionId },
      data: txnUpdate,
    });
  }

  return { fieldsUpdated: fields, milestonesUpdated };
}
