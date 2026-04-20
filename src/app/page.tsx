import Link from "next/link";
import {
  Sparkles,
  LineChart,
  Wallet,
  Receipt,
  Users,
  ArrowRight,
} from "lucide-react";

const TILES: Array<{
  href: string;
  label: string;
  hint: string;
  icon: typeof Sparkles;
}> = [
  {
    href: "/today",
    label: "Today",
    hint: "What needs your attention right now",
    icon: Sparkles,
  },
  {
    href: "/transactions",
    label: "Transactions",
    hint: "Active deals, milestones, timeline",
    icon: Wallet,
  },
  {
    href: "/production",
    label: "Production",
    hint: "YTD closings, volume, GCI, net",
    icon: LineChart,
  },
  {
    href: "/sources",
    label: "Sources",
    hint: "CAC, ROI, conversion per channel",
    icon: Receipt,
  },
  {
    href: "/marketing",
    label: "Marketing",
    hint: "Log spend per source channel",
    icon: Receipt,
  },
  {
    href: "/contacts",
    label: "Contacts",
    hint: "All contacts synced from FUB",
    icon: Users,
  },
];

export default function HomePage() {
  return (
    <main className="mx-auto max-w-6xl">
      <header className="mb-10">
        <div className="reos-label">Welcome back</div>
        <h1 className="mt-1 font-display text-display-lg font-semibold">
          Real Estate OS
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-text-muted">
          Your private AI chief of staff. FUB + Gmail + Calendar + document
          intelligence — one surface, every deal.
        </p>
      </header>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {TILES.map(({ href, label, hint, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="group flex items-start justify-between rounded-md border border-border bg-surface p-5 shadow-sm transition-colors hover:border-brand-500"
          >
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-brand-50 text-brand-700">
                <Icon className="h-4.5 w-4.5" strokeWidth={1.8} />
              </span>
              <div>
                <div className="font-medium text-text">{label}</div>
                <div className="mt-0.5 text-xs text-text-muted">{hint}</div>
              </div>
            </div>
            <ArrowRight
              className="mt-1 h-4 w-4 text-text-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-brand-600"
              strokeWidth={1.8}
            />
          </Link>
        ))}
      </section>
    </main>
  );
}
