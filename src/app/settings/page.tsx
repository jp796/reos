/**
 * /settings — lightweight index page linking to the various settings
 * sub-pages. Today: Team + Activity. Easy to extend.
 */

import Link from "next/link";
import { requireSession } from "@/lib/require-session";
import { redirect } from "next/navigation";
import {
  Users,
  ScrollText,
  Building2,
  Mail,
  Briefcase,
  Inbox,
  CreditCard,
  Bell,
  Shield,
  Lock,
  ListChecks,
  FileText,
} from "lucide-react";

export const dynamic = "force-dynamic";

interface Section {
  href: string;
  title: string;
  desc: string;
  icon: typeof Users;
  /** Owner-only page (server-enforced). Shown grayed + locked to non-owners. */
  ownerOnly?: boolean;
}

// Personal & workspace tools — available to any signed-in member (unless flagged).
const PERSONAL: Section[] = [
  { href: "/settings/notifications", title: "Notifications", desc: "Web Push + the morning brief and deadline alerts", icon: Bell },
  { href: "/settings/templates", title: "Email templates", desc: "Canned messages with mail-merge variables", icon: Mail },
  { href: "/settings/task-templates", title: "Task templates", desc: "Reusable + AI-generated task checklists — apply to any deal", icon: ListChecks },
  { href: "/settings/compliance-templates", title: "Compliance templates", desc: "Reusable + AI-generated document checklists per deal", icon: Shield },
  { href: "/settings/vendors", title: "Vendors", desc: "Title, lenders, inspectors — ranked by past deals", icon: Briefcase },
  { href: "/settings/intake", title: "Lead intake", desc: "Public form submissions — promote qualified leads", icon: Inbox },
  { href: "/settings/integrations", title: "Integrations", desc: "MLS photo sources + social posters (Buffer, Direct, Cowork)", icon: Briefcase, ownerOnly: true },
  { href: "/settings/summary-design", title: "Summary design", desc: "Brand the client transaction-summary PDF (logo, color, tagline)", icon: FileText },
  { href: "/settings/activity", title: "Activity", desc: "Recent changes across the workspace", icon: ScrollText },
];

// Admin / account controls — owner-gated pages (server-enforced via requireOwner).
const ADMIN: Section[] = [
  { href: "/settings/team", title: "Team", desc: "Members, roles, and invited emails", icon: Users, ownerOnly: true },
  { href: "/settings/brokerage", title: "Brokerage", desc: "Broker name, license, EIN — printed on every CDA", icon: Building2, ownerOnly: true },
  { href: "/settings/billing", title: "Billing", desc: "Subscription tier, payment method, invoices", icon: CreditCard, ownerOnly: true },
  { href: "/settings/account", title: "Account", desc: "Subscription overview · delete this workspace", icon: Shield, ownerOnly: true },
  { href: "/settings/demo-data", title: "Demo data", desc: "Generate / wipe sample transactions — never affects analytics", icon: ScrollText, ownerOnly: true },
];

function SectionGrid({ sections, isOwner }: { sections: Section[]; isOwner: boolean }) {
  return (
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      {sections.map((s) => {
        const locked = s.ownerOnly && !isOwner;
        if (locked) {
          return (
            <div
              key={s.href}
              title="Owner only — ask your workspace owner for access."
              aria-disabled="true"
              className="flex cursor-not-allowed items-start gap-3 rounded-lg border border-border bg-surface p-4 opacity-55"
            >
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface-2 text-text-subtle">
                <Lock className="h-4 w-4" strokeWidth={1.8} />
              </div>
              <div>
                <div className="flex items-center gap-1.5 font-medium text-text-muted">
                  {s.title}
                  <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-text-subtle">
                    Owner only
                  </span>
                </div>
                <div className="mt-0.5 text-xs text-text-subtle">{s.desc}</div>
              </div>
            </div>
          );
        }
        return (
          <Link
            key={s.href}
            href={s.href}
            className="flex items-start gap-3 rounded-lg border border-border bg-surface p-4 transition-colors hover:border-brand-500"
          >
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-50 text-brand-700">
              <s.icon className="h-4 w-4" strokeWidth={1.8} />
            </div>
            <div>
              <div className="font-medium text-text">{s.title}</div>
              <div className="mt-0.5 text-xs text-text-muted">{s.desc}</div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

export default async function SettingsIndexPage() {
  const actor = await requireSession();
  if (actor instanceof Response) redirect("/login");

  const isOwner = actor.role === "owner";

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="font-display text-h1 font-semibold">Settings</h1>
      <p className="mt-1 text-sm text-text-muted">
        Signed in as <span className="font-medium text-text">{actor.email}</span>{" "}
        · Role: <span className="capitalize">{actor.role}</span>
      </p>

      <section className="mt-6">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-text-subtle">
          Personal &amp; workspace
        </h2>
        <SectionGrid sections={PERSONAL} isOwner={isOwner} />
      </section>

      {/* Account controls are owner-only (server-enforced). Non-owners don't
          see the section at all — nothing here they can open. */}
      {isOwner && (
        <section className="mt-8">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-text-subtle">
            Admin
          </h2>
          <SectionGrid sections={ADMIN} isOwner={isOwner} />
        </section>
      )}
    </div>
  );
}
