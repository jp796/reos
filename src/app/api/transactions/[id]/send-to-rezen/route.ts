/**
 * POST /api/transactions/:id/send-to-rezen
 * Body: { dryRun?: boolean, requireSigned?: boolean, markComplete?: boolean }
 *
 * The real "Send to Rezen." Pushes this transaction's present
 * documents into the matching Rezen checklist items via sherlock.
 *
 * Flow:
 *   1. Load the account's Real JWT (must be connected).
 *   2. Read the transaction's rezenTransactionId (must be set).
 *   3. searchChecklist(rezenId, TRANSACTION|LISTING) → checklistId.
 *   4. getChecklistItems → live Rezen items.
 *   5. Build the REOS prep report → present docs with slot labels.
 *   6. Match docs → items by name.
 *   7. dryRun → return the match plan (no uploads).
 *      else  → upload each matched doc; optionally markComplete.
 *   8. Stamp rezenLastPushAt + summary on the transaction.
 *
 * Owner + coordinator (whoever works the file). Tenancy-scoped.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import { logWorkflowEvent } from "@/lib/instrumentation";
import { getEncryptionService } from "@/lib/encryption";
import {
  searchChecklist,
  getChecklistItems,
  uploadDocumentToItem,
  markItemComplete,
  RealApiError,
} from "@/services/integrations/RealApiService";
import {
  buildRezenPrepReport,
  loadSlotsForProfile,
} from "@/services/core/RezenCompliancePrep";
import {
  matchDocsToItems,
  type ReosDocForPush,
} from "@/services/core/RezenPushService";
import { logError } from "@/lib/log";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  const { id } = await ctx.params;

  let body: {
    dryRun?: boolean;
    requireSigned?: boolean;
    markComplete?: boolean;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }
  const dryRun = body.dryRun !== false; // default to dry-run for safety
  const requireSigned = body.requireSigned !== false; // default gate on
  const markComplete = body.markComplete === true;

  // ── Tenancy + transaction ──────────────────────────────────────
  const txn = await prisma.transaction.findFirst({
    where: { id, accountId: actor.accountId },
    select: {
      id: true,
      side: true,
      state: true,
      rezenTransactionId: true,
      account: {
        select: { realApiTokensEncrypted: true, brokerageProfileId: true },
      },
    },
  });
  if (!txn) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (!txn.rezenTransactionId) {
    return NextResponse.json(
      {
        error:
          "No Rezen transaction linked. Paste the Rezen transaction ID (from the Bolt URL) on this deal first.",
      },
      { status: 412 },
    );
  }
  if (!txn.account.realApiTokensEncrypted) {
    return NextResponse.json(
      {
        error:
          "Real account not connected — connect it in Settings → Integrations.",
      },
      { status: 412 },
    );
  }

  let jwt: string;
  let uploaderId: string;
  try {
    const blob = JSON.parse(
      getEncryptionService().decrypt(txn.account.realApiTokensEncrypted),
    ) as { accessToken: string; userId: string };
    jwt = blob.accessToken;
    uploaderId = blob.userId;
  } catch {
    return NextResponse.json(
      { error: "Stored Real token is unreadable — reconnect." },
      { status: 412 },
    );
  }

  // ── Build the REOS document set (present docs w/ slot labels) ───
  const profileId = txn.account.brokerageProfileId;
  const parentType = txn.side === "sell" ? "LISTING" : "TRANSACTION";
  const slots = await loadSlotsForProfile(
    prisma,
    profileId,
    parentType === "LISTING" ? "listing" : "transaction",
    txn.state,
  );
  const documents = await prisma.document.findMany({
    where: { transactionId: id, rawBytes: { not: null } },
    select: {
      id: true,
      fileName: true,
      mimeType: true,
      category: true,
      extractedText: true,
      source: true,
      suggestedRezenSlot: true,
      suggestedRezenConfidence: true,
      assignedRezenSlot: true,
      signatureScanStatus: true,
      signatureScanNotes: true,
    },
  });
  const report = buildRezenPrepReport({
    side: txn.side,
    documents,
    slots,
    kind: parentType === "LISTING" ? "listing" : "transaction",
  });

  // Flatten present slots → docs for push.
  const pushDocs: ReosDocForPush[] = [];
  for (const item of report.items) {
    if (item.status !== "present") continue;
    const first = item.matches[0];
    if (!first) continue;
    pushDocs.push({
      id: first.id,
      fileName: first.fileName,
      rezenFilename: item.rezenFilename,
      slotLabel: item.slot.label,
      slotKey: item.slot.key,
      signatureStatus: first.signatureStatus,
    });
  }

  if (pushDocs.length === 0) {
    return NextResponse.json(
      { error: "No present documents to push. Classify / add docs first." },
      { status: 412 },
    );
  }

  // ── Talk to Real ───────────────────────────────────────────────
  try {
    const { checklistId } = await searchChecklist(
      jwt,
      txn.rezenTransactionId,
      parentType,
    );
    if (!checklistId) {
      return NextResponse.json(
        {
          error:
            "Couldn't find a Rezen checklist for that transaction ID. Double-check the ID from the Bolt URL.",
        },
        { status: 404 },
      );
    }
    const items = await getChecklistItems(jwt, checklistId);
    const matches = matchDocsToItems(pushDocs, items, requireSigned);

    // Dry run — return the plan, no uploads.
    if (dryRun) {
      return NextResponse.json({
        ok: true,
        dryRun: true,
        checklistId,
        rezenItemCount: items.length,
        plan: matches.map((m) => ({
          fileName: m.doc.fileName,
          slotLabel: m.doc.slotLabel,
          rezenItem: m.item?.name ?? null,
          rezenItemId: m.item?.id ?? null,
          signatureStatus: m.doc.signatureStatus,
          willPush: m.reason === "matched",
          reason: m.reason,
        })),
      });
    }

    // Live push.
    const results: Array<{
      fileName: string;
      slotLabel: string;
      rezenItem: string | null;
      status: "pushed" | "skipped" | "error";
      detail: string | null;
    }> = [];

    for (const m of matches) {
      if (m.reason !== "matched" || !m.item) {
        results.push({
          fileName: m.doc.fileName,
          slotLabel: m.doc.slotLabel,
          rezenItem: null,
          status: "skipped",
          detail:
            m.reason === "unsigned_blocked"
              ? "blocked — scanned unsigned"
              : "no matching Rezen item",
        });
        continue;
      }
      // Pull the raw bytes for this doc.
      const docRow = await prisma.document.findFirst({
        where: { id: m.doc.id, transactionId: id },
        select: { rawBytes: true, fileName: true, mimeType: true },
      });
      if (!docRow?.rawBytes) {
        results.push({
          fileName: m.doc.fileName,
          slotLabel: m.doc.slotLabel,
          rezenItem: m.item.name,
          status: "error",
          detail: "file bytes missing",
        });
        continue;
      }
      try {
        await uploadDocumentToItem(jwt, m.item.id, {
          fileBytes: new Uint8Array(docRow.rawBytes),
          fileName: m.doc.rezenFilename ?? docRow.fileName,
          mimeType: docRow.mimeType,
          name: m.doc.rezenFilename ?? docRow.fileName,
          uploaderId,
          transactionId: txn.rezenTransactionId,
        });
        if (markComplete) {
          await markItemComplete(jwt, m.item.id).catch(() => {
            /* completing is best-effort; the upload is what matters */
          });
        }
        results.push({
          fileName: m.doc.fileName,
          slotLabel: m.doc.slotLabel,
          rezenItem: m.item.name,
          status: "pushed",
          detail: markComplete ? "uploaded + completed" : "uploaded",
        });
      } catch (err) {
        if (err instanceof RealApiError && err.needsReconnect) throw err;
        results.push({
          fileName: m.doc.fileName,
          slotLabel: m.doc.slotLabel,
          rezenItem: m.item.name,
          status: "error",
          detail: err instanceof Error ? err.message.slice(0, 150) : "upload failed",
        });
      }
    }

    const pushed = results.filter((r) => r.status === "pushed").length;
    const skipped = results.filter((r) => r.status === "skipped").length;
    const errored = results.filter((r) => r.status === "error").length;

    await prisma.transaction.update({
      where: { id },
      data: {
        rezenLastPushAt: new Date(),
        rezenLastPushJson: { pushed, skipped, errored, at: new Date().toISOString() },
      },
    });

    // Funnel: the deal's docs were submitted to the brokerage compliance
    // system — the compliance review is now ready on the Rezen side. Only
    // when at least one doc actually pushed (a no-op push isn't "ready").
    if (pushed > 0) {
      await logWorkflowEvent(prisma, {
        accountId: actor.accountId,
        transactionId: id,
        event: "compliance_review_ready",
        actorUserId: actor.userId,
        meta: { pushed, skipped, errored },
      });
    }

    return NextResponse.json({
      ok: true,
      dryRun: false,
      checklistId,
      pushed,
      skipped,
      errored,
      results,
    });
  } catch (err) {
    if (err instanceof RealApiError) {
      return NextResponse.json(
        { error: err.message, needsReconnect: err.needsReconnect },
        { status: err.needsReconnect ? 401 : 502 },
      );
    }
    logError(err, { route: "send-to-rezen", transactionId: id });
    return NextResponse.json(
      { error: "Send to Rezen failed — try again." },
      { status: 502 },
    );
  }
}
