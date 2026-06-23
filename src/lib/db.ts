/**
 * Prisma client singleton — with transparent connection-retry.
 *
 * In Next.js dev, hot-reload re-imports modules — without the globalThis
 * cache you leak a connection every edit.
 *
 * RETRY: Neon autosuspends an idle compute (~5 min). The first request
 * after a suspend lands on a cold endpoint and the very first connection
 * attempt can fail with `P1001 Can't reach database server` before Neon
 * has finished waking it (wake takes ~1-3s). A server component with no
 * error boundary turns that single transient failure into the raw
 * "Application error" page — which is exactly what infrequent users
 * (e.g. a new teammate opening the dashboard cold) were hitting.
 *
 * We wrap every operation in a `$allOperations` extension that retries
 * connection-class errors with short backoff. By the second or third
 * attempt Neon has woken and the query succeeds. Logic / constraint
 * errors are NOT retried — only connectivity failures.
 */

import { PrismaClient, Prisma } from "@prisma/client";

// Prisma error codes that mean "couldn't talk to the DB", not "your
// query was wrong". Safe to retry — the operation never ran.
//   P1001 — can't reach database server (cold Neon / network blip)
//   P1002 — server reached but timed out
//   P1008 — operation timed out
//   P1017 — server closed the connection
const RETRYABLE_CODES = new Set(["P1001", "P1002", "P1008", "P1017"]);

// Backoff schedule between attempts (ms). 4 total tries over ~2.3s —
// comfortably longer than a Neon cold-wake, short enough to stay under
// the request budget.
const RETRY_DELAYS_MS = [200, 600, 1500];

function isRetryable(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientInitializationError) return true;
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    return RETRYABLE_CODES.has(err.code);
  }
  // Some connection failures surface as a rejection without a Prisma
  // error class (e.g. the underlying socket error). Match on message.
  const msg = err instanceof Error ? err.message : String(err);
  return /can't reach database server|connection refused|econnrefused|terminating connection|closed the connection|connection terminated/i.test(
    msg,
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function makeClient() {
  const base = new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["warn", "error"]
        : ["error"],
  });

  return base.$extends({
    query: {
      async $allOperations({ args, query }) {
        let lastErr: unknown;
        for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
          try {
            return await query(args);
          } catch (err) {
            lastErr = err;
            const canRetry =
              attempt < RETRY_DELAYS_MS.length && isRetryable(err);
            if (!canRetry) throw err;
            await sleep(RETRY_DELAYS_MS[attempt]);
          }
        }
        throw lastErr;
      },
    },
  });
}

// The `$extends` call returns a client whose static type drops `$on` /
// `$use` and adds extension generics. We add no new model/result types
// here — only transparent query retry — so the runtime shape is a strict
// superset of PrismaClient (all model delegates + `$transaction` exist).
// Cast back to PrismaClient so the hundreds of existing call sites that
// accept `db: PrismaClient` keep type-checking unchanged.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma: PrismaClient =
  globalForPrisma.prisma ?? (makeClient() as unknown as PrismaClient);

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export type { PrismaClient } from "@prisma/client";
