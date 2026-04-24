/**
 * /settings/vendors — directory of every vendor REOS has seen.
 *
 * Groups by role (title / lender / inspector / attorney), shows
 * deal count + last-used, lets the user spot duplicates and confirm
 * coverage ("who are my three most-used lenders?").
 *
 * No edit UI here yet — rename / merge is handled through the contact
 * edit flow. This is a read-only overview that feeds the VendorPicker.
 */

import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

interface VendorRow {
  contactId: string;
  fullName: string;
  primaryEmail: string | null;
  dealCount: number;
  lastUsedAt: Date;
}

interface VendorGroup {
  role: string;
  label: string;
  vendors: VendorRow[];
}

const ROLE_GROUPS: Array<{ role: string; label: string }> = [
  { role: "title", label: "Title / escrow" },
  { role: "lender", label: "Lenders" },
  { role: "inspector", label: "Inspectors" },
  { role: "attorney", label: "Attorneys" },
];

export default async function VendorsSettingsPage() {
  const actor = await requireSession();
  if (actor instanceof Response) redirect("/settings");

  const parts = await prisma.transactionParticipant.findMany({
    where: {
      transaction: { accountId: actor.accountId },
      role: { in: ROLE_GROUPS.map((r) => r.role) },
    },
    include: {
      contact: {
        select: {
          id: true,
          fullName: true,
          primaryEmail: true,
        },
      },
    },
  });

  // Group by role → by contact
  const byRole = new Map<string, Map<string, VendorRow>>();
  for (const p of parts) {
    const roleMap = byRole.get(p.role) ?? new Map<string, VendorRow>();
    const cur = roleMap.get(p.contactId);
    if (cur) {
      cur.dealCount += 1;
      if (p.createdAt > cur.lastUsedAt) cur.lastUsedAt = p.createdAt;
    } else {
      roleMap.set(p.contactId, {
        contactId: p.contactId,
        fullName: p.contact.fullName,
        primaryEmail: p.contact.primaryEmail,
        dealCount: 1,
        lastUsedAt: p.createdAt,
      });
    }
    byRole.set(p.role, roleMap);
  }

  const groups: VendorGroup[] = ROLE_GROUPS.map((rg) => ({
    role: rg.role,
    label: rg.label,
    vendors: [...(byRole.get(rg.role)?.values() ?? [])].sort((a, b) => {
      if (b.dealCount !== a.dealCount) return b.dealCount - a.dealCount;
      return b.lastUsedAt.getTime() - a.lastUsedAt.getTime();
    }),
  }));

  const total = groups.reduce((n, g) => n + g.vendors.length, 0);

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="font-display text-h1 font-semibold">Vendors</h1>
      <p className="mt-1 text-sm text-text-muted">
        Derived from every <b>TransactionParticipant</b> linked to this
        account. Ranked by deal count — your most-used title companies,
        lenders, inspectors, and attorneys surface first in dropdowns
        when you add a new transaction.
        <span className="ml-2 text-text-subtle">
          ({total} total across {groups.filter((g) => g.vendors.length > 0).length} categories)
        </span>
      </p>

      <div className="mt-6 space-y-6">
        {groups.map((g) => (
          <section key={g.role}>
            <h2 className="mb-2 text-sm font-medium">
              {g.label}{" "}
              <span className="font-normal text-text-muted">
                · {g.vendors.length}
              </span>
            </h2>
            {g.vendors.length === 0 ? (
              <div className="rounded border border-dashed border-border bg-surface-2 px-3 py-2 text-xs text-text-muted">
                No {g.label.toLowerCase()} yet. REOS will auto-add them as
                they appear on your transactions.
              </div>
            ) : (
              <div className="overflow-hidden rounded-lg border border-border bg-surface">
                <table className="w-full text-sm">
                  <thead className="border-b border-border bg-surface-2 text-left text-xs text-text-muted">
                    <tr>
                      <th className="px-4 py-2 font-medium">Name</th>
                      <th className="px-4 py-2 font-medium">Email</th>
                      <th className="px-4 py-2 font-medium">Deals</th>
                      <th className="px-4 py-2 font-medium">Last used</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.vendors.map((v) => (
                      <tr
                        key={v.contactId}
                        className="border-b border-border last:border-0"
                      >
                        <td className="px-4 py-2 font-medium text-text">
                          {v.fullName}
                        </td>
                        <td className="px-4 py-2 text-xs text-text-muted">
                          {v.primaryEmail ?? "—"}
                        </td>
                        <td className="px-4 py-2 text-xs tabular-nums">
                          {v.dealCount}
                        </td>
                        <td className="px-4 py-2 text-xs text-text-muted">
                          {v.lastUsedAt.toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
