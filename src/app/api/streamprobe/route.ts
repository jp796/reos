/**
 * TEMPORARY streaming probe — public, no auth. Emits one tick per 500ms
 * for 5 ticks. Used to A/B whether the Cloud Run domain mapping buffers
 * streaming responses vs the raw run.app URL. DELETE after diagnosis.
 */
import { type NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET(_req: NextRequest) {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(enc.encode(`:${" ".repeat(2048)}\n\n`));
      for (let i = 1; i <= 5; i++) {
        controller.enqueue(enc.encode(`data: tick ${i}\n\n`));
        await new Promise((r) => setTimeout(r, 500));
      }
      controller.enqueue(enc.encode(`data: done\n\n`));
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
