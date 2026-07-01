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
 *   { type: "field", key, value, source }      — a field was read
 *   { type: "done", extraction }               — one document finished
 *   { type: "merged", extraction, missingCritical } — final merged result
 *   { type: "error", message }
 */

import { type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { requireSession } from "@/lib/require-session";
import {
  ContractExtractionService,
  computeRelativeDeadlines,
  mergeExtractionsByRecency,
  deriveWalkthrough,
  type ContractExtraction,
  type ExtractStreamEvent,
} from "@/services/ai/ContractExtractionService";

export const runtime = "nodejs";
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

  const svc = new ContractExtractionService(env.OPENAI_API_KEY);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (ev: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
      };
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

        send({
          type: "merged",
          extraction: merged,
          documentCount: extractions.length,
          missingCritical: missing,
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
