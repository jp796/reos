/**
 * POST /api/transactions/:id/classify-docs
 *
 * Body (optional): { force?: boolean }
 *   force=true reclassifies every Document on the transaction.
 *   Otherwise only Documents with a null suggestedRezenSlot run.
 *
 * Runs DocumentClassifierService against every (matching) Document
 * on the transaction, stores the result + an automation audit row.
 *
 * Bounded by maxDuration; clamps to ~25 docs per call so the
 * request finishes inside Cloud Run's 300s budget.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { requireSession, assertSameAccount } from "@/lib/require-session";
import { classifyDocument } from "@/services/ai/DocumentClassifierService";
import {
  TRANSACTION_SLOTS,
  LISTING_SLOTS,
} from "@/services/core/RezenCompliancePrep";
import { logError } from "@/lib/log";

/** Build a clean filename from the AI-classified slot + the
 * transaction's primary contact name. Skips the rename when:
 * - confidence is too low to commit
 * - current filename already starts with the slot prefix
 */
async function maybeRename(args: {
  slotKey: string | null;
  confidence: number;
  currentName: string;
  transactionId: string;
  prisma: typeof prisma;
}): Promise<{ fileName?: string }> {
  if (!args.slotKey || args.confidence < 0.7) return {};
  const slot =
    [...TRANSACTION_SLOTS, ...LISTING_SLOTS].find((s) => s.key === args.slotKey);
  if (!slot) return {};

  // Slot prefix used in the renamed file, e.g. "09 Settlement Statement"
  const pad = slot.number < 10 ? `0${slot.number}` : String(slot.number);
  const labelClean = slot.label
    .replace(/\([^)]*\)/g, "")
    .replace(/[^A-Za-z0-9 \-&]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 60);
  const slotPrefix = `${pad} ${labelClean}`;

  // Skip if the file is already named with this slot prefix
  if (args.currentName.toLowerCase().startsWith(`${pad} `)) return {};

  // Pull primary contact full name for the suffix
  const txn = await args.prisma.transaction.findUnique({
    where: { id: args.transactionId },
    select: { contact: { select: { fullName: true } } },
  });
  const lastName = txn?.contact.fullName.split(/\s+/).pop() ?? "";
  const ext = args.currentName.match(/\.[a-z0-9]+$/i)?.[0] ?? ".pdf";
  const newName = lastName
    ? `${slotPrefix} - ${lastName}${ext}`
    : `${slotPrefix}${ext}`;
  return { fileName: newName.slice(0, 200) };
}

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_PER_CALL = 25;

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const { id } = await ctx.params;
  const txn = await prisma.transaction.findUnique({
    where: { id },
    select: { id: true, accountId: true },
  });
  if (!txn) return NextResponse.json({ error: "not found" }, { status: 404 });
  const guard = assertSameAccount(actor, txn.accountId);
  if (guard) return guard;

  if (!env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY not configured" },
      { status: 500 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as { force?: boolean };
  const force = !!body.force;

  const docs = await prisma.document.findMany({
    where: {
      transactionId: id,
      ...(force ? {} : { suggestedRezenSlot: null }),
    },
    select: {
      id: true,
      fileName: true,
      extractedText: true,
    },
    orderBy: { uploadedAt: "desc" },
    take: MAX_PER_CALL,
  });

  let classified = 0;
  let nullified = 0;
  let errored = 0;

  for (const doc of docs) {
    try {
      const result = await classifyDocument({
        filename: doc.fileName,
        extractedText: doc.extractedText,
        openaiApiKey: env.OPENAI_API_KEY,
      });
      // Auto-rename: if classification confidence is high enough,
      // normalize the filename to "<slot> - <client>.<ext>" so the
      // Documents tab + Rezen bundle stay tidy. Only renames when
      // the current name doesn't already start with the slot label
      // (so re-classifies don't churn the file name).
      const renamePatch = await maybeRename({
        slotKey: result.slotKey,
        confidence: result.confidence,
        currentName: doc.fileName,
        transactionId: id,
        prisma,
      });

      await prisma.document.update({
        where: { id: doc.id },
        data: {
          suggestedRezenSlot: result.slotKey,
          suggestedRezenConfidence: result.confidence,
          classifiedAt: new Date(),
          ...renamePatch,
        },
      });
      // Light audit so we can audit how the AI did over time.
      try {
        await prisma.automationAuditLog.create({
          data: {
            accountId: txn.accountId,
            transactionId: id,
            entityType: "document",
            entityId: doc.id,
            ruleName: "rezen_doc_classifier",
            actionType: "classify",
            sourceType: "ai",
            confidenceScore: result.confidence,
            decision: result.slotKey ? "applied" : "skipped",
            beforeJson: { fileName: doc.fileName },
            afterJson: {
              slotKey: result.slotKey,
              confidence: result.confidence,
              reason: result.reason,
            },
            actorUserId: actor.userId,
          },
        });
      } catch {
        // audit failure shouldn't block classification
      }
      if (result.slotKey) classified++;
      else nullified++;
    } catch (err) {
      errored++;
      logError(err, {
        route: "/api/transactions/:id/classify-docs",
        accountId: txn.accountId,
        userId: actor.userId,
        transactionId: id,
        meta: { docId: doc.id, fileName: doc.fileName },
      });
    }
  }

  return NextResponse.json({
    ok: true,
    scanned: docs.length,
    classified,
    nullified,
    errored,
    /** When true, more documents remain — UI can call again. */
    hasMore: docs.length === MAX_PER_CALL,
  });
}
