/**
 * /settings/activity — recent audit-log viewer.
 *
 * Shows the last N AutomationAuditLog entries in the current account,
 * joined to the acting user so Jp can see which actions were Vicki's
 * vs his own vs the system (cron / webhook).
 */

import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const LIMIT = 100;

function timeAgo(d: Date): string {
  const diff = Date.now() - d.getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString();
}

export default async function ActivityPage() {
  const actor = await requireSession();
  if (actor instanceof Response) redirect("/login");

  const logs = await prisma.automationAuditLog.findMany({
    where: { accountId: actor.accountId },
    orderBy: { createdAt: "desc" },
    take: LIMIT,
    include: {
      actor: { select: { id: true, name: true, email: true, image: true } },
      transaction: {
        select: { id: true, propertyAddress: true },
      },
    },
  });

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="font-display text-h1 font-semibold">Activity</h1>
      <p className="mt-1 text-sm text-text-muted">
        The last {LIMIT} changes in this workspace — manual edits,
        automations, and cron/webhook updates.
      </p>

      <div className="mt-6 overflow-hidden rounded-lg border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-surface-2 text-left text-xs text-text-muted">
            <tr>
              <th className="px-4 py-2.5 font-medium">When</th>
              <th className="px-4 py-2.5 font-medium">Who</th>
              <th className="px-4 py-2.5 font-medium">What</th>
              <th className="px-4 py-2.5 font-medium">Target</th>
              <th className="px-4 py-2.5 font-medium">Decision</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id} className="border-b border-border last:border-0">
                <td
                  className="px-4 py-2.5 text-xs text-text-muted"
                  title={l.createdAt.toLocaleString()}
                >
                  {timeAgo(l.createdAt)}
                </td>
                <td className="px-4 py-2.5">
                  {l.actor ? (
                    <div className="flex items-center gap-2">
                      {l.actor.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={l.actor.image}
                          alt=""
                          className="h-5 w-5 rounded-full border border-border"
                        />
                      ) : (
                        <div className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-500 text-[10px] font-semibold text-white">
                          {(l.actor.name ?? l.actor.email)
                            .slice(0, 1)
                            .toUpperCase()}
                        </div>
                      )}
                      <span className="text-xs text-text">
                        {l.actor.name ?? l.actor.email}
                      </span>
                    </div>
                  ) : (
                    <span className="text-xs text-text-muted italic">
                      system
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <div className="text-xs font-medium text-text">
                    {l.ruleName.replaceAll("_", " ")}
                  </div>
                  <div className="text-[11px] text-text-muted">
                    {l.entityType} · {l.actionType}
                  </div>
                </td>
                <td className="px-4 py-2.5 text-xs">
                  {l.transaction ? (
                    <Link
                      href={`/transactions/${l.transaction.id}`}
                      className="text-brand-700 hover:underline"
                    >
                      {l.transaction.propertyAddress ?? "transaction"}
                    </Link>
                  ) : l.entityId ? (
                    <span className="text-text-muted">
                      {l.entityType}:{l.entityId.slice(0, 8)}…
                    </span>
                  ) : (
                    <span className="text-text-muted">—</span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <span
                    className={
                      "inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium " +
                      decisionStyle(l.decision)
                    }
                  >
                    {l.decision}
                  </span>
                </td>
              </tr>
            ))}
            {logs.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-8 text-center text-sm text-text-muted"
                >
                  No activity yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function decisionStyle(decision: string): string {
  switch (decision) {
    case "applied":
      return "bg-emerald-50 text-emerald-700";
    case "suggested":
      return "bg-amber-50 text-amber-700";
    case "rejected":
      return "bg-gray-100 text-text-muted";
    case "failed":
      return "bg-red-50 text-red-700";
    default:
      return "bg-surface-2 text-text-muted";
  }
}
