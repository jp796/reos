/**
 * POST /api/automation/extract-contracts-stream
 *
 * Server-Sent Events version of upload-contracts-to-create. Streams the
 * extraction LIVE — status messages and each field the instant it's read
 * — so the UI can show the document being read in real time (left: the
 * read log; right: fields + timeline building). Multi-document: streams
 * each doc, then emits the merged result.
 *
 * Event stream (each line: `data: <json>\n\n`):
 *   { type: "doc", name, index, total }        — starting a document
 *   { type: "status", message }                — progress narration
 *   { type: "field", key, value, confidence, snippet, page, source }  — a field was read
 *   { type: "done", extraction }               — one document finished
 *   { type: "merged", extraction, missingCritical } — final merged result
 *   { type: "error", message }
 */

import { type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import { logWorkflowEvent } from "@/lib/instrumentation";
import {
  ContractExtractionService,
  computeRelativeDeadlines,
  mergeExtractionsByRecency,
  deriveWalkthrough,
  type ContractExtraction,
  type ExtractStreamEvent,
} from "@/services/ai/ContractExtractionService";
import {
  generateAiTasks,
  buildTaskGenInputFromExtraction,
  type TaskGenInput,
} from "@/services/ai/AiTaskGenerationService";
import { learnedTitlesForDeal } from "@/services/core/TaskTemplateLearnService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 300;

const CRITICAL: Array<keyof ContractExtraction> = [
  "closingDate",
  "inspectionDeadline",
  "inspectionObjectionDeadline",
  "earnestMoneyDueDate",
  "purchasePrice",
];

export async function POST(req: NextRequest) {
  const actor = await requireSession();
  if (actor instanceof Response) return actor;

  if (!env.OPENAI_API_KEY) {
    return new Response(JSON.stringify({ error: "OPENAI_API_KEY not configured" }), {
      status: 500,
    });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return new Response(JSON.stringify({ error: "multipart required" }), { status: 400 });
  }
  const files = form.getAll("file").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return new Response(JSON.stringify({ error: "at least one file field required" }), {
      status: 400,
    });
  }
  const rawSide = String(form.get("side") ?? "");
  const side: TaskGenInput["side"] =
    rawSide === "buyer" || rawSide === "listing" || rawSide === "both" || rawSide === "investor"
      ? rawSide
      : null;
  const strategy = String(form.get("strategy") ?? "") || null;
  const accountId = actor.accountId;
  const apiKey = env.OPENAI_API_KEY; // narrowed to string by the guard above

  // Funnel entry (upload path): the deal doesn't exist yet, so these are
  // account-scoped with a null transaction. `intake_started` opens the
  // funnel; `attachment_received` counts the files (scalars only). The
  // per-document `extraction_started/completed` events are emitted inside
  // the stream as each doc is read.
  await logWorkflowEvent(prisma, {
    accountId,
    event: "intake_started",
    actorUserId: actor.userId,
    meta: { files: files.length, origin: "live_extraction", ...(strategy ? { strategy } : {}) },
  });
  await logWorkflowEvent(prisma, {
    accountId,
    event: "attachment_received",
    actorUserId: actor.userId,
    meta: { count: files.length, origin: "live_extraction" },
  });

  // Layer 2 — the deal doesn't exist yet (no state known), so inject every
  // active learned rule for the account.
  const { getActiveRules } = await import("@/services/core/ExtractionLearningService");
  const learnedRules = await getActiveRules(prisma, { accountId, state: null, anyState: true });
  const svc = new ContractExtractionService(apiKey).setLearnedRules(learnedRules);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (ev: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
      };
      // 2KB padding comment defeats proxy/gzip byte-threshold buffering
      // so early events actually reach the browser as they're sent.
      controller.enqueue(encoder.encode(`:${" ".repeat(2048)}\n\n`));
      try {
        const extractions: ContractExtraction[] = [];
        for (let i = 0; i < files.length; i++) {
          const f = files[i];
          send({ type: "doc", name: f.name, index: i + 1, total: files.length });
          if (f.type && !f.type.includes("pdf")) {
            send({ type: "status", message: `Skipping ${f.name} (not a PDF).` });
            continue;
          }
          const buffer = Buffer.from(await f.arrayBuffer());
          try {
            const ex = await svc.extractStream(buffer, (e: ExtractStreamEvent) => send(e));
            extractions.push(ex);
          } catch (err) {
            send({
              type: "status",
              message: `Couldn't read ${f.name}: ${err instanceof Error ? err.message.slice(0, 100) : "error"}`,
            });
          }
        }

        if (extractions.length === 0) {
          send({ type: "error", message: "Extraction failed on all documents." });
          controller.close();
          return;
        }

        send({ type: "status", message: "Merging the documents (newest terms win)…" });
        let merged = mergeExtractionsByRecency(extractions);
        merged = computeRelativeDeadlines(merged);
        merged = deriveWalkthrough(merged);

        const missing = CRITICAL.filter((k) => {
          const v = (merged[k] as { value?: unknown } | undefined)?.value;
          return v === null || v === undefined || v === "";
        });

        // Phase 1 + 2 done (deal terms + contingencies). NOT terminal —
        // the client keeps the reading screen and moves to phase 3.
        send({
          type: "merged",
          extraction: merged,
          documentCount: extractions.length,
          missingCritical: missing,
        });

        // ── Phase 3: the REAL AI task list ──
        send({ type: "status", message: "Building the task list from the contract…" });
        let tasks: Awaited<ReturnType<typeof generateAiTasks>> = [];
        try {
          const learnedTaskTitles = await learnedTitlesForDeal(accountId, {
            side,
            strategy,
            financingType:
              (merged.financingType?.value as string | null) ?? null,
          });
          const input = buildTaskGenInputFromExtraction(
            merged as unknown as Record<string, unknown>,
            { side, strategy, learnedTaskTitles },
          );
          tasks = await generateAiTasks(apiKey, input);
          // Reveal one at a time so the list visibly builds. The tasks are
          // 100% real (one model call); only the reveal is sequential.
          for (const task of tasks) {
            send({ type: "task", task });
            await new Promise((r) => setTimeout(r, 90));
          }
        } catch (err) {
          send({
            type: "status",
            message: `Task list unavailable (${err instanceof Error ? err.message.slice(0, 80) : "error"}).`,
          });
        }

        send({
          type: "done",
          extraction: merged,
          documentCount: extractions.length,
          missingCritical: missing,
          tasks,
        });
      } catch (err) {
        send({
          type: "error",
          message: err instanceof Error ? err.message.slice(0, 200) : "stream failed",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
