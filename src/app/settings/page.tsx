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
} from "lucide-react";

export const dynamic = "force-dynamic";

const SECTIONS = [
  {
    href: "/settings/team",
    title: "Team",
    desc: "Members, roles, and invited emails",
    icon: Users,
  },
  {
    href: "/settings/brokerage",
    title: "Brokerage",
    desc: "Broker name, license, EIN — printed on every CDA",
    icon: Building2,
  },
  {
    href: "/settings/templates",
    title: "Email templates",
    desc: "Canned messages with mail-merge variables",
    icon: Mail,
  },
  {
    href: "/settings/vendors",
    title: "Vendors",
    desc: "Title, lenders, inspectors — ranked by past deals",
    icon: Briefcase,
  },
  {
    href: "/settings/intake",
    title: "Lead intake",
    desc: "Public form submissions — promote qualified leads",
    icon: Inbox,
  },
  {
    href: "/settings/activity",
    title: "Activity",
    desc: "Recent changes across the workspace",
    icon: ScrollText,
  },
  {
    href: "/settings/integrations",
    title: "Integrations",
    desc: "MLS photo sources + social posters (Buffer, Direct, Cowork)",
    icon: Briefcase,
  },
  {
    href: "/settings/billing",
    title: "Billing",
    desc: "Subscription tier, payment method, invoices",
    icon: CreditCard,
  },
  {
    href: "/settings/demo-data",
    title: "Demo data",
    desc: "Generate / wipe sample transactions — never affects analytics",
    icon: ScrollText,
  },
];

export default async function SettingsIndexPage() {
  const actor = await requireSession();
  if (actor instanceof Response) redirect("/login");

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="font-display text-h1 font-semibold">Settings</h1>
      <p className="mt-1 text-sm text-text-muted">
        Signed in as <span className="font-medium text-text">{actor.email}</span>{" "}
        · Role: <span className="capitalize">{actor.role}</span>
      </p>

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {SECTIONS.map((s) => (
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
        ))}
      </div>
    </div>
  );
}
