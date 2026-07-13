import Link from "next/link";
import "./lib/trace.css";

export const metadata = { title: "Atlas Trace · REOS prototype" };

/**
 * Isolated shell for the Atlas Trace prototypes (REOS_05). No production
 * imports; chrome-less (see AppShell guard). Every screen is clearly a
 * prototype over sample data.
 */
export default function AtlasTraceLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-bg text-text">
      <header className="sticky top-0 z-20 border-b border-border bg-bg/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <Link href="/prototypes/atlas-trace" className="font-display text-lg font-bold tracking-tight">
              Atlas <span className="text-brand-600">Trace</span>
            </Link>
            <span className="rounded-full border border-dashed border-border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-text-subtle">
              Prototype · sample data
            </span>
          </div>
          <nav className="flex items-center gap-1 text-sm">
            <TabLink href="/prototypes/atlas-trace/contract-extraction">1 · Contract extraction</TabLink>
            <TabLink href="/prototypes/atlas-trace/addendum-reconciliation">2 · Addendum</TabLink>
            <TabLink href="/prototypes/atlas-trace/email-to-milestone">3 · Email → milestone</TabLink>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
      <footer className="mx-auto max-w-6xl px-4 pb-10 pt-6 text-xs text-text-subtle">
        REOS makes invisible transaction causality visible. Prototype for design review — no production workflow is modified. Sample data; no live customer documents shown.
      </footer>
    </div>
  );
}

function TabLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-md px-2.5 py-1.5 font-medium text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
    >
      {children}
    </Link>
  );
}
