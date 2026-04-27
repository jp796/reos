/**
 * Structured logger that pairs with Google Cloud Error Reporting.
 *
 * Cloud Run pipes stderr → Cloud Logging → Error Reporting. ER picks
 * up entries that include a stack trace AND severity=ERROR. Emit
 * JSON in the format Cloud Logging recognizes so each error becomes
 * a single grouped issue with stack frames.
 *
 *   import { logError } from "@/lib/log";
 *   try { … } catch (e) { logError(e, { route: "/api/scan", actor }); throw; }
 */

import * as Sentry from "@sentry/nextjs";

interface LogCtx {
  /** Route or function name where the error fired. */
  route?: string;
  /** Account / user / transaction ids — anything that helps find the row. */
  accountId?: string;
  userId?: string;
  transactionId?: string;
  /** Free-form extra. */
  meta?: Record<string, unknown>;
}

/**
 * Log an error to stderr in Cloud-Logging-friendly JSON. The
 * `serviceContext` block tells Cloud Error Reporting to group these
 * under `reos` so dashboards stay clean across revisions.
 */
export function logError(err: unknown, ctx: LogCtx = {}): void {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;

  const entry = {
    severity: "ERROR",
    "@type":
      "type.googleapis.com/google.devtools.clouderrorreporting.v1beta1.ReportedErrorEvent",
    serviceContext: {
      service: "reos",
      version: process.env.K_REVISION ?? "dev",
    },
    message: stack ?? message,
    context: {
      route: ctx.route,
      accountId: ctx.accountId,
      userId: ctx.userId,
      transactionId: ctx.transactionId,
      meta: ctx.meta,
    },
  };

  console.error(JSON.stringify(entry));

  // Also forward to Sentry when its DSN is set (no-op otherwise).
  if (process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN) {
    try {
      Sentry.captureException(err, { extra: ctx as Record<string, unknown> });
    } catch {
      // never let logging itself throw
    }
  }
}

/** Thin wrapper for non-error info that shows up in Cloud Logging. */
export function logInfo(message: string, meta?: Record<string, unknown>): void {
  console.log(JSON.stringify({ severity: "INFO", message, meta }));
}
