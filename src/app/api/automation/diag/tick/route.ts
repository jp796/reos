/**
 * TEMPORARY diagnostic — GET /api/automation/diag/tick
 * Public (matches the /api/automation/<x>/tick middleware allowlist).
 * Streams 5 timestamped ticks 1s apart to confirm Cloud Run flushes
 * incrementally with these headers/exports. Delete after verifying.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET() {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // 2KB padding comment defeats proxy/gzip byte-threshold buffering.
      controller.enqueue(encoder.encode(`:${" ".repeat(2048)}\n\n`));
      for (let i = 1; i <= 5; i++) {
        controller.enqueue(
          encoder.encode(`data: tick ${i} @ ${new Date().toISOString()}\n\n`),
        );
        await new Promise((r) => setTimeout(r, 1000));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Content-Encoding": "none",
      "X-Accel-Buffering": "no",
    },
  });
}
