/**
 * /admin/accounts/[id] — per-account detail view for REOS operators.
 *
 * Surfaces the per-tenant snapshot we'd want before answering a
 * support ticket or investigating a complaint:
 *   - Subscription state, Stripe ids, billing dates
 *   - User list with roles
 *   - Tenant data counts (txns, contacts, docs)
 *   - Recent audit log entries
 *   - Integration health (Gmail / Meta / LinkedIn / FUB connected?)
 *
 * Read-only in v1. v2 adds impersonate-as-customer + manual
 * subscription edits.
 */

import Link from "next/link";
import { NextResponse } from "next/server";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/require-admin";

export const dynamic = "force-dynamic";

function fmt(d: Date | null | undefined) {
  if (!d) return "—";
  return d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

export default async function AdminAccountDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const op = await requireAdmin();
  if (op instanceof NextResponse) return notFound();
  const { id } = await params;

  const account = await prisma.account.findUnique({
    where: { id },
    select: {
      id: true,
      businessName: true,
      subscriptionTier: true,
      subscriptionStatus: true,
      subscriptionRenewsAt: true,
      stripeCustomerId: true,
      stripeSubscriptionId: true,
      deletionRequestedAt: true,
      createdAt: true,
      updatedAt: true,
      ownerUserId: true,
      googleOauthTokensEncrypted: true,
      metaOauthTokensEncrypted: true,
      linkedinOauthTokensEncrypted: true,
      followUpBossApiKeyEncrypted: true,
      _count: {
        select: {
          users: true,
          contacts: true,
          transactions: true,
          esignRequests: true,
          calendarEvents: true,
          automationAuditLogs: true,
        },
      },
    },
  });
  if (!account) return notFound();

  const [users, recentAudit, memberships, documentsCount] = await Promise.all([
    prisma.user.findMany({
      where: { accountId: id },
      select: { id: true, email: true, name: true, role: true, createdAt: true, termsAcceptedAt: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.automationAuditLog.findMany({
      where: { accountId: id },
      select: { id: true, createdAt: true, ruleName: true, actionType: true, decision: true, entityType: true },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    prisma.accountMembership.findMany({
      where: { accountId: id },
      select: { id: true, email: true, role: true, acceptedAt: true, revokedAt: true, invitedAt: true },
      orderBy: { invitedAt: "desc" },
    }),
    // Documents live under Transaction, not directly on Account, so
    // count them through the relation.
    prisma.document.count({ where: { transaction: { accountId: id } } }),
  ]);

  const integrations = [
    { name: "Gmail", connected: !!account.googleOauthTokensEncrypted },
    { name: "Meta (FB/IG)", connected: !!account.metaOauthTokensEncrypted },
    { name: "LinkedIn", connected: !!account.linkedinOauthTokensEncrypted },
    { name: "Follow Up Boss", connected: !!account.followUpBossApiKeyEncrypted },
  ];

  return (
    <main className="mx-auto max-w-6xl space-y-8">
      <header>
        <Link href="/admin" className="text-xs text-brand-700 underline">
          ← All accounts
        </Link>
        <h1 className="mt-2 font-display text-display-lg font-semibold">{account.businessName}</h1>
        <p className="mt-1 font-mono text-xs text-text-muted">{account.id}</p>
      </header>

      {account.deletionRequestedAt && (
        <div className="rounded-lg border border-amber-400/40 bg-amber-50/60 p-4 text-sm text-amber-900">
          <strong>Scheduled for deletion</strong> on {fmt(new Date(account.deletionRequestedAt.getTime() + 30 * 24 * 60 * 60 * 1000))}{" "}
          (requested {fmt(account.deletionRequestedAt)}).
        </div>
      )}

      <section className="grid grid-cols-2 gap-4 md:grid-cols-3">
        <Kv label="Subscription tier" value={account.subscriptionTier ?? "—"} />
        <Kv label="Subscription status" value={account.subscriptionStatus ?? "—"} />
        <Kv label="Renews at" value={fmt(account.subscriptionRenewsAt)} />
        <Kv label="Stripe customer" value={account.stripeCustomerId ?? "—"} mono />
        <Kv label="Stripe subscription" value={account.stripeSubscriptionId ?? "—"} mono />
        <Kv label="Account created" value={fmt(account.createdAt)} />
      </section>

      <section>
        <h2 className="font-display text-h2 font-semibold">Tenant data</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Users" value={account._count.users} />
          <Stat label="Transactions" value={account._count.transactions} />
          <Stat label="Contacts" value={account._count.contacts} />
          <Stat label="Documents" value={documentsCount} />
          <Stat label="eSign requests" value={account._count.esignRequests} />
          <Stat label="Calendar events" value={account._count.calendarEvents} />
          <Stat label="Audit log entries" value={account._count.automationAuditLogs} />
        </div>
      </section>

      <section>
        <h2 className="font-display text-h2 font-semibold">Integrations</h2>
        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
          {integrations.map((i) => (
            <div key={i.name} className="flex items-center justify-between rounded-md border border-border bg-surface px-3 py-2 text-sm">
              <span>{i.name}</span>
              <span className={`text-xs font-medium ${i.connected ? "text-emerald-700" : "text-text-muted"}`}>
                {i.connected ? "connected" : "—"}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="font-display text-h2 font-semibold">Users on this account</h2>
        <div className="mt-3 overflow-hidden rounded-lg border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-left text-xs uppercase tracking-wide text-text-muted">
              <tr>
                <th className="px-3 py-2">Email</th>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Role</th>
                <th className="px-3 py-2">Joined</th>
                <th className="px-3 py-2">ToU</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="px-3 py-2">{u.email}</td>
                  <td className="px-3 py-2 text-text-muted">{u.name ?? "—"}</td>
                  <td className="px-3 py-2 capitalize">{u.role ?? "—"}</td>
                  <td className="px-3 py-2 text-text-muted">{fmt(u.createdAt)}</td>
                  <td className="px-3 py-2 text-xs text-text-muted">{u.termsAcceptedAt ? fmt(u.termsAcceptedAt) : "not accepted"}</td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-5 text-center text-text-muted">
                    No users.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {memberships.length > 0 && (
        <section>
          <h2 className="font-display text-h2 font-semibold">Account memberships</h2>
          <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-surface text-sm">
            {memberships.map((m) => (
              <li key={m.id} className="flex items-center justify-between px-3 py-2">
                <span>{m.email} <span className="text-text-muted">· {m.role}</span></span>
                <span className="text-xs text-text-muted">
                  {m.revokedAt ? `revoked ${fmt(m.revokedAt)}` : m.acceptedAt ? `accepted ${fmt(m.acceptedAt)}` : `invited ${fmt(m.invitedAt)}`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="font-display text-h2 font-semibold">Audit log · last 30</h2>
        <div className="mt-3 overflow-hidden rounded-lg border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-left text-xs uppercase tracking-wide text-text-muted">
              <tr>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Rule</th>
                <th className="px-3 py-2">Action</th>
                <th className="px-3 py-2">Entity</th>
                <th className="px-3 py-2">Decision</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {recentAudit.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2 text-xs text-text-muted">{fmt(r.createdAt)}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.ruleName}</td>
                  <td className="px-3 py-2">{r.actionType}</td>
                  <td className="px-3 py-2 text-text-muted">{r.entityType}</td>
                  <td className="px-3 py-2 text-xs">{r.decision}</td>
                </tr>
              ))}
              {recentAudit.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-5 text-center text-text-muted">
                    No audit entries.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function Kv({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2">
      <div className="text-xs uppercase tracking-wide text-text-muted">{label}</div>
      <div className={`mt-0.5 truncate ${mono ? "font-mono text-xs" : "text-sm"}`}>{value}</div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2">
      <div className="text-xs uppercase tracking-wide text-text-muted">{label}</div>
      <div className="mt-0.5 font-display text-h3 font-semibold tabular-nums">{value.toLocaleString()}</div>
    </div>
  );
}
