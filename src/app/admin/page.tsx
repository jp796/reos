/**
 * /admin — REOS operator dashboard (currently just JP).
 *
 * Lists every Account in the database with its subscription state,
 * owner email, user count, tenant data counts, and a link to the
 * per-account detail view. Bypasses the per-tenant scoping that
 * every other server page enforces — this is the only place that
 * legitimately reads across tenants.
 *
 * v1 scope: list + counts. Defers:
 *   - Impersonate-as-customer
 *   - Force cancel / refund
 *   - Edit any field
 * Those land in v2 once we have a real customer who needs support.
 */

import Link from "next/link";
import { NextResponse } from "next/server";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/require-admin";

export const dynamic = "force-dynamic";

function fmtDate(d: Date | null | undefined) {
  if (!d) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function statusBadge(status: string | null, deletionRequestedAt: Date | null) {
  if (deletionRequestedAt) {
    return (
      <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 ring-1 ring-amber-300">
        scheduled-delete
      </span>
    );
  }
  const map: Record<string, string> = {
    active: "bg-emerald-100 text-emerald-900 ring-emerald-300",
    trialing: "bg-blue-100 text-blue-900 ring-blue-300",
    past_due: "bg-red-100 text-red-900 ring-red-300",
    canceled: "bg-surface-2 text-text-muted ring-border",
  };
  const cls = map[status ?? ""] ?? "bg-surface-2 text-text-muted ring-border";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${cls}`}>
      {status ?? "—"}
    </span>
  );
}

export default async function AdminPage() {
  const op = await requireAdmin();
  if (op instanceof NextResponse) return notFound();

  const accounts = await prisma.account.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      businessName: true,
      subscriptionTier: true,
      subscriptionStatus: true,
      subscriptionRenewsAt: true,
      stripeCustomerId: true,
      deletionRequestedAt: true,
      createdAt: true,
      ownerUserId: true,
      _count: {
        select: {
          users: true,
          contacts: true,
          transactions: true,
        },
      },
    },
  });

  const ownerIds = accounts.map((a) => a.ownerUserId).filter((id): id is string => !!id);
  const owners = ownerIds.length
    ? await prisma.user.findMany({
        where: { id: { in: ownerIds } },
        select: { id: true, email: true },
      })
    : [];
  const ownerEmailById = new Map(owners.map((u) => [u.id, u.email] as const));

  const totalAccounts = accounts.length;
  const activeAccounts = accounts.filter((a) => a.subscriptionStatus === "active").length;
  const scheduledDelete = accounts.filter((a) => a.deletionRequestedAt !== null).length;

  return (
    <main className="mx-auto max-w-6xl">
      <header className="flex items-end justify-between gap-4">
        <div>
          <div className="reos-label">REOS operator dashboard</div>
          <h1 className="mt-1 font-display text-display-lg font-semibold">Admin</h1>
          <p className="mt-1 text-sm text-text-muted">
            Signed in as <span className="font-medium text-text">{op.email}</span>. This view bypasses tenant scoping; every other page in REOS is locked to a single account.
          </p>
        </div>
      </header>

      <section className="mt-6 grid grid-cols-3 gap-3">
        <Stat label="Accounts" value={totalAccounts.toLocaleString()} />
        <Stat label="Active subscriptions" value={activeAccounts.toLocaleString()} />
        <Stat label="Scheduled for deletion" value={scheduledDelete.toLocaleString()} />
      </section>

      <section className="mt-8 overflow-hidden rounded-lg border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-left text-xs uppercase tracking-wide text-text-muted">
            <tr>
              <th className="px-4 py-2.5">Account</th>
              <th className="px-4 py-2.5">Owner</th>
              <th className="px-4 py-2.5">Tier · Status</th>
              <th className="px-4 py-2.5 text-right">Users</th>
              <th className="px-4 py-2.5 text-right">Txns</th>
              <th className="px-4 py-2.5 text-right">Contacts</th>
              <th className="px-4 py-2.5">Created</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {accounts.map((a) => (
              <tr key={a.id} className="transition-colors hover:bg-surface-2">
                <td className="px-4 py-2.5">
                  <div className="font-medium text-text">{a.businessName}</div>
                  <div className="font-mono text-[10px] text-text-muted">{a.id}</div>
                </td>
                <td className="px-4 py-2.5 text-text-muted">
                  {ownerEmailById.get(a.ownerUserId) ?? "—"}
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="capitalize">{a.subscriptionTier ?? "—"}</span>
                    {statusBadge(a.subscriptionStatus, a.deletionRequestedAt)}
                  </div>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">{a._count.users}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{a._count.transactions}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{a._count.contacts}</td>
                <td className="px-4 py-2.5 text-text-muted">{fmtDate(a.createdAt)}</td>
                <td className="px-4 py-2.5">
                  <Link href={`/admin/accounts/${a.id}`} className="text-brand-700 underline">
                    Open →
                  </Link>
                </td>
              </tr>
            ))}
            {accounts.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-text-muted">
                  No accounts in the system yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="text-xs uppercase tracking-wide text-text-muted">{label}</div>
      <div className="mt-1 font-display text-h2 font-semibold tabular-nums">{value}</div>
    </div>
  );
}
