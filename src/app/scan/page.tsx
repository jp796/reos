/**
 * /scan — unified scan page.
 *
 * One UI replaces the per-type scan buttons scattered across
 * /transactions and /today. Pick a type, set a window, optionally
 * narrow by sender / query, run. Results show inline; recent runs
 * sit underneath as history.
 */

import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import { ScanRunner } from "./ScanRunner";

export const dynamic = "force-dynamic";

export default async function ScanPage() {
  const actor = await requireSession();
  if (actor instanceof Response) return null;

  const [account, recent] = await Promise.all([
    prisma.account.findUnique({
      where: { id: actor.accountId },
      select: { settingsJson: true },
    }),
    prisma.scanRun.findMany({
      where: { accountId: actor.accountId },
      orderBy: { startedAt: "desc" },
      take: 10,
    }),
  ]);

  const settings = (account?.settingsJson ?? {}) as Record<string, unknown>;
  const trustedSenders = Array.isArray(settings.trustedTcSenders)
    ? (settings.trustedTcSenders as unknown[]).filter(
        (x): x is string => typeof x === "string",
      )
    : [];

  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-6">
        <h1 className="font-display text-h1 font-semibold">Scan</h1>
        <p className="mt-1 text-sm text-text-muted">
          One place to pull deals + tasks out of Gmail. Pick a type,
          run, review the hits.
        </p>
      </header>

      <ScanRunner
        trustedSenders={trustedSenders}
        recent={recent.map((r) => ({
          id: r.id,
          scanType: r.scanType,
          startedAt: r.startedAt.toISOString(),
          finishedAt: r.finishedAt?.toISOString() ?? null,
          hitsCount: r.hitsCount,
          errorText: r.errorText,
          paramsJson: (r.paramsJson ?? null) as Record<string, unknown> | null,
        }))}
      />
    </div>
  );
}
