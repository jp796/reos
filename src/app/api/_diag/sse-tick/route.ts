/**
 * TEMPORARY diagnostic — GET /api/_diag/sse-tick
 * Emits 5 timestamped SSE ticks 1s apart so we can confirm Cloud Run
 * flushes a streaming response incrementally (vs buffering to the end).
 * Public + trivial; delete after verifying the live-extraction stream.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
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
      "X-Accel-Buffering": "no",
    },
  });
}
