"use client";

/**
 * DemoShell — visual chrome for the public /demo sandbox. Matches
 * the real AppShell sidebar+header visually so prospects feel the
 * actual product, but:
 *   - Nav links stay scoped to /demo/* (no escaping into /login).
 *   - "Sign up" + "Sign in" CTAs in the top bar drive conversion.
 *   - A persistent banner at the very top reminds the visitor this
 *     is a sandbox.
 *
 * Pure client component — no auth, no DB, safe to render unauth.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Home as HomeIcon,
  CalendarDays,
  FolderCheck,
  Sparkles,
  ArrowRight,
  Menu,
  X,
} from "lucide-react";
import { useTheme } from "@/app/ThemeProvider";
import { cn } from "@/lib/cn";
import { Logo } from "@/app/components/Logo";
import { Sun, Moon, SunMoon } from "lucide-react";

const DEMO_NAV = [
  { href: "/demo", label: "Transactions", icon: FolderCheck },
  { href: "/demo/today", label: "Today", icon: CalendarDays },
];

export function DemoShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { mode, setMode, clearOverride, override } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen bg-bg text-text">
      {/* ─── Persistent demo banner ──────────────────────────── */}
      <div className="sticky top-0 z-40 border-b border-amber-300/60 bg-amber-100 px-3 py-2 text-amber-950 dark:border-amber-700/50 dark:bg-amber-900/30 dark:text-amber-100">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-2 text-sm">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 shrink-0" strokeWidth={2} />
            <span className="font-medium">DEMO MODE</span>
            <span className="hidden text-amber-800 sm:inline dark:text-amber-200">
              — sign up to save your work.
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/login"
              className="rounded-md border border-amber-700/40 bg-transparent px-2.5 py-1 text-xs font-medium text-amber-950 hover:bg-amber-200 dark:border-amber-600/40 dark:text-amber-100 dark:hover:bg-amber-900/60"
            >
              Sign in
            </Link>
            <Link
              href="/login?signup=1"
              className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1 text-xs font-semibold text-white hover:bg-brand-500"
            >
              Sign up — free
              <ArrowRight className="h-3 w-3" strokeWidth={2.5} />
            </Link>
          </div>
        </div>
      </div>

      <div className="mx-auto flex max-w-[1400px]">
        {/* Desktop sidebar */}
        <aside className="sticky top-[41px] hidden h-[calc(100vh-41px)] w-[232px] shrink-0 flex-col border-r border-border bg-surface px-3 py-5 md:flex">
          <SidebarContents pathname={pathname} />
        </aside>

        {/* Mobile drawer */}
        {mobileOpen && (
          <>
            <div
              role="button"
              tabIndex={-1}
              aria-label="Close menu"
              onClick={() => setMobileOpen(false)}
              className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm md:hidden animate-in fade-in duration-150"
            />
            <aside className="fixed inset-y-0 left-0 z-50 flex h-full w-[260px] flex-col border-r border-border bg-surface px-3 py-4 md:hidden animate-in slide-in-from-left duration-200">
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="mb-2 ml-auto flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:bg-surface-2 hover:text-text"
                aria-label="Close menu"
              >
                <X className="h-4 w-4" strokeWidth={2} />
              </button>
              <SidebarContents pathname={pathname} />
            </aside>
          </>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Top bar */}
          <header className="sticky top-[41px] z-10 flex items-center justify-between gap-2 border-b border-border bg-bg/95 px-3 py-3 backdrop-blur sm:gap-4 sm:px-5">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-text-muted transition-colors hover:text-text md:hidden"
              aria-label="Open menu"
            >
              <Menu className="h-4 w-4" strokeWidth={2} />
            </button>

            <div className="min-w-0 flex-1 shrink md:flex-none">
              <div className="truncate text-xs text-text-muted">
                Welcome to REOS
              </div>
              <div className="truncate text-base font-semibold tracking-tight sm:text-h1">
                You&rsquo;re inside the live product.
              </div>
            </div>
            <div className="flex shrink-0 items-center justify-end gap-2 sm:gap-3 md:flex-1">
              <Link
                href="/login?signup=1"
                className="hidden items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-500 sm:inline-flex"
              >
                Sign up — free
                <ArrowRight className="h-3 w-3" strokeWidth={2.5} />
              </Link>
              <ThemeToggle
                mode={mode}
                override={!!override}
                onSet={setMode}
                onClear={clearOverride}
              />
            </div>
          </header>
          <main className="flex-1 px-3 py-5 sm:px-5 sm:py-6">{children}</main>
        </div>
      </div>
    </div>
  );
}

function SidebarContents({ pathname }: { pathname: string }) {
  return (
    <>
      <Link
        href="/demo"
        className="mb-8 flex items-center gap-2 px-2 font-display text-2xl font-bold tracking-tight"
        aria-label="REOS demo"
      >
        <Logo size={32} />
        <span>
          <span>RE</span>
          <span className="text-gradient-brand">OS</span>
        </span>
      </Link>
      <nav className="flex flex-col gap-0.5">
        {DEMO_NAV.map((item) => {
          const active =
            pathname === item.href ||
            (item.href !== "/demo" && pathname.startsWith(item.href)) ||
            (item.href === "/demo" && pathname.startsWith("/demo/transactions"));
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
                active
                  ? "bg-brand-50 font-medium text-brand-700"
                  : "text-text-muted hover:bg-surface-2 hover:text-text",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" strokeWidth={1.8} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-6 rounded-md border border-dashed border-border bg-surface-2/50 p-3 text-xs text-text-muted">
        <div className="mb-1 font-medium text-text">Sandbox tour</div>
        <p className="leading-relaxed">
          Click the <span className="font-medium text-text">1428 S Glenstone</span>{" "}
          deal to see a live transaction with AI summary, timeline, tasks, and
          inspections.
        </p>
      </div>

      <div className="mt-auto rounded-md bg-surface-2 p-2.5 text-xs text-text-muted">
        <div className="font-medium text-text">Like what you see?</div>
        <p className="mt-1 leading-relaxed">
          Connect your own Gmail in under a minute. 1 deal free.
        </p>
        <Link
          href="/login?signup=1"
          className="mt-2 flex w-full items-center justify-center gap-1.5 rounded border border-brand-500 bg-brand-600 px-2 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-brand-500"
        >
          <Sparkles className="h-3 w-3" strokeWidth={2} />
          Start free
        </Link>
      </div>
    </>
  );
}

function ThemeToggle({
  mode,
  override,
  onSet,
  onClear,
}: {
  mode: "light" | "dark";
  override: boolean;
  onSet: (m: "light" | "dark") => void;
  onClear: () => void;
}) {
  return (
    <div className="flex items-center overflow-hidden rounded-md border border-border bg-surface">
      <button
        type="button"
        onClick={() => onSet("light")}
        className={cn(
          "flex h-8 w-8 items-center justify-center text-text-muted transition-colors hover:text-text",
          mode === "light" && "bg-brand-50 text-brand-700",
        )}
        title="Light mode"
      >
        <Sun className="h-4 w-4" strokeWidth={1.8} />
      </button>
      <button
        type="button"
        onClick={() => onSet("dark")}
        className={cn(
          "flex h-8 w-8 items-center justify-center text-text-muted transition-colors hover:text-text",
          mode === "dark" && "bg-brand-50 text-brand-700",
        )}
        title="Dark mode"
      >
        <Moon className="h-4 w-4" strokeWidth={1.8} />
      </button>
      {override && (
        <button
          type="button"
          onClick={onClear}
          className="flex h-8 w-8 items-center justify-center border-l border-border text-text-muted transition-colors hover:text-text"
          title="Clear override"
        >
          <SunMoon className="h-4 w-4" strokeWidth={1.8} />
        </button>
      )}
    </div>
  );
}
