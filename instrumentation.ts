// Next.js 15 instrumentation hook — runs once per worker on cold start.
// Sentry's Next plugin reads sentry.{edge,server}.config.ts here.

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}
