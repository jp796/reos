/**
 * Public read-only timeline view. Routed by unguessable share token.
 * Anyone with the link sees the property address, key dates, and
 * milestone progress. No contact info, no financials, no emails —
 * just the dates the buyer / seller / lender / title need to see.
 *
 * Bypasses the AppShell (which has nav + theme toggle for the agent)
 * via route-level layout reset.
 */

import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

function fmtDate(d: Date | null | undefined): string {
  if (!d) return "—";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

type Tone = "complete" | "overdue" | "today" | "soon" | "future";
function toneFor(due: Date, completedAt: Date | null): Tone {
  if (completedAt) return "complete";
  const now = new Date();
  const d = Math.floor(daysBetween(now, due));
  if (d < 0) return "overdue";
  if (d === 0) return "today";
  if (d <= 7) return "soon";
  return "future";
}

const toneStyle: Record<Tone, { dot: string; label: string; text: string }> = {
  complete: {
    dot: "bg-emerald-500 border-emerald-600",
    label: "Complete",
    text: "text-emerald-700",
  },
  overdue: {
    dot: "bg-red-500 border-red-600",
    label: "Overdue",
    text: "text-red-600",
  },
  today: {
    dot: "bg-amber-500 border-amber-600",
    label: "Due today",
    text: "text-amber-700",
  },
  soon: {
    dot: "bg-amber-300 border-amber-500",
    label: "Due soon",
    text: "text-amber-600",
  },
  future: {
    dot: "bg-white border-neutral-300",
    label: "Upcoming",
    text: "text-neutral-500",
  },
};

export default async function PublicTimelinePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!token) return notFound();

  const txn = await prisma.transaction.findUnique({
    where: { shareToken: token },
    include: {
      milestones: { orderBy: { dueAt: "asc" } },
      contact: { select: { fullName: true } },
    },
  });
  if (!txn) return notFound();

  // Expired?
  if (txn.shareExpiresAt && txn.shareExpiresAt < new Date()) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-20 text-center">
        <h1 className="font-display text-2xl font-semibold">
          This share link has expired
        </h1>
        <p className="mt-3 text-sm text-neutral-600">
          Ask the agent to send you a fresh link.
        </p>
      </main>
    );
  }

  const keyDates: Array<{ label: string; d: Date | null }> = [
    { label: "Listed", d: txn.listDate },
    { label: "Under contract", d: txn.contractDate },
    { label: "Inspection deadline", d: txn.inspectionDate },
    { label: "Appraisal deadline", d: txn.appraisalDate },
    { label: "Financing deadline", d: txn.financingDeadline },
    { label: "Earnest money due", d: txn.earnestMoneyDueDate },
    { label: "Final walkthrough", d: txn.walkthroughDate },
    { label: "Estimated closing", d: txn.closingDate },
    { label: "Possession", d: txn.possessionDate },
  ];
  const completed = txn.milestones.filter((m) => m.completedAt).length;
  const total = txn.milestones.length;

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      <main className="mx-auto max-w-3xl px-6 py-10">
        <header className="mb-10 border-b border-stone-200 pb-6">
          <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
            Transaction Timeline
          </div>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">
            {txn.propertyAddress ?? "Transaction"}
          </h1>
          {(txn.city || txn.state) && (
            <p className="mt-1 text-sm text-stone-600">
              {[txn.city, txn.state, txn.zip].filter(Boolean).join(" ")}
            </p>
          )}
          {total > 0 && (
            <p className="mt-3 text-sm text-stone-600">
              <span className="font-medium text-stone-900 tabular-nums">
                {completed}
              </span>{" "}
              of{" "}
              <span className="tabular-nums">{total}</span> milestones
              complete
              {txn.closingDate && (
                <>
                  {" · "}Closing{" "}
                  <span className="font-medium text-emerald-700">
                    {fmtDate(txn.closingDate)}
                  </span>
                </>
              )}
            </p>
          )}
        </header>

        {/* Key dates grid */}
        <section className="mb-10 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {keyDates.map(
            (kd) =>
              kd.d && (
                <div
                  key={kd.label}
                  className="rounded-lg border border-stone-200 bg-white p-4"
                >
                  <div className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                    {kd.label}
                  </div>
                  <div className="mt-1 font-display text-xl font-semibold text-stone-900">
                    {fmtDate(kd.d)}
                  </div>
                </div>
              ),
          )}
        </section>

        {/* Milestone timeline */}
        {total > 0 && (
          <section className="mb-10">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-stone-500">
              Milestones
            </h2>
            <div className="relative">
              <div className="absolute left-[11px] top-2 bottom-2 w-px bg-stone-200" />
              <ul className="space-y-2">
                {txn.milestones.map((m) => {
                  const tone = toneFor(m.dueAt, m.completedAt);
                  const style = toneStyle[tone];
                  return (
                    <li
                      key={m.id}
                      className="relative flex items-start gap-3"
                    >
                      <span
                        className={`relative z-10 mt-2 h-3.5 w-3.5 shrink-0 rounded-full border-2 ${style.dot}`}
                      />
                      <div className="flex-1 rounded-lg border border-stone-200 bg-white px-4 py-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <div className="font-medium text-stone-900">
                              {m.label}
                            </div>
                            <div className={`mt-0.5 text-xs ${style.text}`}>
                              {style.label}
                              {m.completedAt && (
                                <>
                                  {" · "}
                                  {fmtDate(m.completedAt)}
                                </>
                              )}
                            </div>
                          </div>
                          <div className="text-right text-sm text-stone-700 tabular-nums">
                            {fmtDate(m.dueAt)}
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </section>
        )}

        <footer className="mt-12 border-t border-stone-200 pt-4 text-center text-xs text-stone-500">
          Shared by{" "}
          <span className="font-medium text-stone-700">
            Jp Fluellen · Real Broker LLC
          </span>{" "}
          · Cheyenne, WY
          <div className="mt-1">
            This timeline is view-only. Dates may change if the contract is
            amended.
          </div>
        </footer>
      </main>
    </div>
  );
}
