/**
 * /settings/team — owner-only team roster + role management.
 *
 * Lists every user attached to the REOS account with their role,
 * last-seen session, and (for owners) a role toggle. Coordinators
 * see a read-only roster.
 */

import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import { redirect } from "next/navigation";
import { TeamRoleForm } from "./TeamRoleForm";
import { InviteMemberForm } from "./InviteMemberForm";

export const dynamic = "force-dynamic";

interface RowUser {
  id: string;
  name: string | null;
  email: string;
  role: string;
  image: string | null;
  createdAt: Date;
  lastSeenAt: Date | null;
}

export default async function TeamSettingsPage() {
  const actor = await requireSession();
  if (actor instanceof Response) redirect("/login");

  // Every user on the same account
  const users = await prisma.user.findMany({
    where: { accountId: actor.accountId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      image: true,
      createdAt: true,
      sessions: {
        select: { expires: true },
        orderBy: { expires: "desc" },
        take: 1,
      },
    },
    orderBy: { createdAt: "asc" },
  });
  const rows: RowUser[] = users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    image: u.image,
    createdAt: u.createdAt,
    lastSeenAt: u.sessions[0]?.expires ?? null,
  }));

  const allow = (process.env.AUTH_ALLOWED_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const existingEmails = new Set(rows.map((r) => r.email.toLowerCase()));
  const pending = allow.filter((e) => !existingEmails.has(e));

  const isOwner = actor.role === "owner";

  // Cross-tenant memberships (TCs invited from outside this account
  // who can switch into this workspace via AccountMembership).
  const memberships = await prisma.accountMembership.findMany({
    where: { accountId: actor.accountId, revokedAt: null },
    orderBy: { invitedAt: "desc" },
    include: {
      user: { select: { id: true, name: true, email: true, image: true } },
    },
  });

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="font-display text-h1 font-semibold">Team</h1>
      <p className="mt-1 text-sm text-text-muted">
        Everyone who can sign into this REOS workspace. Members are
        invited by adding their email to <code>AUTH_ALLOWED_EMAILS</code>.
        {isOwner
          ? " As the owner, you can change anyone's role."
          : " Only the owner can change roles."}
      </p>

      <div className="mt-6 overflow-hidden rounded-lg border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-surface-2 text-left text-xs text-text-muted">
            <tr>
              <th className="px-4 py-2.5 font-medium">Member</th>
              <th className="px-4 py-2.5 font-medium">Role</th>
              <th className="px-4 py-2.5 font-medium">Joined</th>
              <th className="px-4 py-2.5 font-medium">Last session</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    {u.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={u.image}
                        alt=""
                        className="h-8 w-8 rounded-full border border-border"
                      />
                    ) : (
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-500 text-xs font-semibold text-white">
                        {(u.name ?? u.email).slice(0, 1).toUpperCase()}
                      </div>
                    )}
                    <div>
                      <div className="font-medium text-text">
                        {u.name ?? "—"}
                      </div>
                      <div className="text-xs text-text-muted">{u.email}</div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  {isOwner && u.id !== actor.userId ? (
                    <TeamRoleForm userId={u.id} currentRole={u.role} />
                  ) : (
                    <span className="inline-flex items-center rounded-md bg-surface-2 px-2 py-0.5 text-xs font-medium capitalize text-text">
                      {u.role}
                      {u.id === actor.userId ? " (you)" : ""}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-text-muted">
                  {u.createdAt.toLocaleDateString()}
                </td>
                <td className="px-4 py-3 text-xs text-text-muted">
                  {u.lastSeenAt
                    ? u.lastSeenAt.toLocaleDateString() +
                      " " +
                      u.lastSeenAt.toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : "Never"}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={4}
                  className="px-4 py-6 text-center text-sm text-text-muted"
                >
                  No members yet. First sign-in will create the owner row.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pending.length > 0 && (
        <div className="mt-4 rounded-lg border border-border bg-surface p-4 text-sm">
          <div className="mb-1 font-medium text-text">
            Invited, not yet signed in
          </div>
          <div className="text-xs text-text-muted">
            These emails are on the allow-list but haven't used
            &ldquo;Sign in with Google&rdquo; yet:
          </div>
          <ul className="mt-2 space-y-1 text-sm">
            {pending.map((e) => (
              <li
                key={e}
                className="flex items-center gap-2 text-text-muted"
              >
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400" />
                {e}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Cross-tenant collaborators (TCs from another workspace) */}
      {isOwner && (
        <section className="mt-8">
          <h2 className="font-display text-lg font-semibold">Collaborators</h2>
          <p className="mt-1 text-sm text-text-muted">
            Transaction coordinators (or agents) from outside this brokerage.
            They keep their own workspace and switch into yours when working
            on your deals.
          </p>
          <div className="mt-4">
            <InviteMemberForm />
          </div>
          {memberships.length > 0 && (
            <div className="mt-4 overflow-hidden rounded-lg border border-border bg-surface">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-surface-2 text-left text-xs text-text-muted">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Email</th>
                    <th className="px-4 py-2.5 font-medium">Role</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                    <th className="px-4 py-2.5 font-medium">Invited</th>
                  </tr>
                </thead>
                <tbody>
                  {memberships.map((m) => (
                    <tr
                      key={m.id}
                      className="border-b border-border last:border-0"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          {m.user?.image ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={m.user.image}
                              alt=""
                              className="h-7 w-7 rounded-full border border-border"
                            />
                          ) : (
                            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-2 text-[11px] font-semibold text-text-muted">
                              {(m.user?.name ?? m.email).slice(0, 1).toUpperCase()}
                            </div>
                          )}
                          <div>
                            <div className="font-medium text-text">
                              {m.user?.name ?? m.email}
                            </div>
                            {m.user?.name && (
                              <div className="text-xs text-text-muted">
                                {m.email}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center rounded-md bg-surface-2 px-2 py-0.5 text-xs font-medium capitalize text-text">
                          {m.role}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {m.acceptedAt ? (
                          <span className="text-emerald-600">Active</span>
                        ) : (
                          <span className="text-amber-500">Pending sign-in</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-text-muted">
                        {m.invitedAt.toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
