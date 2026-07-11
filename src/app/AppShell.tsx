"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Home as HomeIcon,
  CalendarDays,
  LayoutDashboard,
  Newspaper,
  Radar,
  Signpost,
  FolderCheck,
  FileSignature,
  KanbanSquare,
  TrendingUp,
  Filter,
  Megaphone,
  Mic,
  HelpCircle,
  UsersRound,
  Sun,
  Moon,
  SunMoon,
  LogOut,
  Settings as SettingsIcon,
  Menu,
  X,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { useTheme } from "./ThemeProvider";
import { cn } from "@/lib/cn";
import { GlobalSearch } from "./components/GlobalSearch";
import { Logo } from "./components/Logo";
import { AccountSwitcher } from "./components/AccountSwitcher";

// Navigation compressed to 6 primary groups (§12). Every prior route is
// preserved as an item under a group — nothing is removed, just organized
// by user goal rather than by internal capability.
type NavItem = { href: string; label: string; icon: typeof HomeIcon; investorOnly?: boolean };
const NAV_GROUPS: Array<{ label: string | null; items: NavItem[] }> = [
  { label: null, items: [{ href: "/today", label: "Today", icon: CalendarDays }] },
  {
    label: "Deals",
    items: [
      { href: "/transactions", label: "Transactions", icon: FolderCheck },
      { href: "/listings", label: "Listings", icon: Signpost },
      { href: "/board", label: "Board", icon: KanbanSquare, investorOnly: true },
    ],
  },
  { label: "Contacts", items: [{ href: "/contacts", label: "Contacts", icon: UsersRound }] },
  {
    label: "Intelligence",
    items: [
      { href: "/insights", label: "Insights", icon: LayoutDashboard },
      { href: "/production", label: "Production", icon: TrendingUp },
      { href: "/digest", label: "Digest", icon: Newspaper },
      { href: "/sources", label: "Sources", icon: Filter },
    ],
  },
  {
    label: "Automations",
    items: [
      { href: "/scan", label: "Scan", icon: Radar },
      { href: "/voice", label: "Voice intake", icon: Mic },
      { href: "/forms", label: "Forms", icon: FileSignature },
      { href: "/marketing", label: "Marketing", icon: Megaphone },
    ],
  },
  {
    label: "Settings",
    items: [
      { href: "/settings", label: "Settings", icon: SettingsIcon },
      { href: "/help", label: "Help", icon: HelpCircle },
    ],
  },
];

function greet(now = new Date()): string {
  const h = now.getHours();
  if (h < 5) return "Up late";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 21) return "Good evening";
  return "Still at it";
}

interface ShellUser {
  name: string | null;
  email: string | null;
  image: string | null;
  role: string | null;
  /** Investor module entitlement — gates the Board nav item. */
  investor?: boolean;
}

export type NavDealGroup =
  | "active_listing"
  | "under_contract"
  | "closed"
  | "terminated"
  | "void";
export interface NavDeal { id: string; address: string; group: NavDealGroup }

const DEAL_GROUPS: Array<{ key: NavDealGroup; label: string }> = [
  { key: "active_listing", label: "Active Listing" },
  { key: "under_contract", label: "Under Contract" },
  { key: "closed", label: "Closed" },
  { key: "terminated", label: "Terminated" },
  { key: "void", label: "Void" },
];

export function AppShell({
  children,
  user,
  navDeals = [],
  signOutAction,
}: {
  children: React.ReactNode;
  user: ShellUser | null;
  navDeals?: NavDeal[];
  signOutAction: () => Promise<void>;
}) {
  const pathname = usePathname();
  const { mode, setMode, clearOverride, override } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);
  // Desktop sidebar collapse (icon-only). Persisted so it survives
  // navigation + reloads.
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    setCollapsed(localStorage.getItem("reos_nav_collapsed") === "1");
  }, []);

  function toggleCollapsed() {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem("reos_nav_collapsed", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  // Close the mobile drawer whenever the route changes
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Lock body scroll while the drawer is open (prevents background
  // page scroll on iOS where the drawer covers the viewport)
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  // Public share routes, sign-in page, intake form, and anon-reachable
  // /terms get no chrome (no nav, no greeting, no theme toggle). Let
  // the page render its own minimal presentation. Authenticated users
  // viewing /terms from inside the app still get the chrome (we only
  // strip it when there's no user context).
  if (
    pathname?.startsWith("/share/") ||
    pathname?.startsWith("/demo") ||
    pathname === "/login" ||
    pathname === "/"
  ) {
    return <>{children}</>;
  }
  if (pathname === "/intake") {
    return (
      <main className="min-h-screen bg-bg px-4 py-6 text-text">{children}</main>
    );
  }
  if (pathname === "/terms" && !user) {
    return (
      <main className="min-h-screen bg-bg px-4 py-6 text-text">{children}</main>
    );
  }

  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="min-h-screen bg-bg text-text">
      <div className="mx-auto flex max-w-[1400px]">
        {/* Desktop sidebar — hidden on mobile; collapses to icons */}
        <aside
          className={cn(
            "sticky top-0 hidden h-screen shrink-0 flex-col border-r border-border bg-surface py-5 transition-[width] duration-200 md:flex",
            collapsed ? "w-[68px] px-2" : "w-[232px] px-3",
          )}
        >
          <SidebarContents
            pathname={pathname}
            user={user}
            navDeals={navDeals}
            signOutAction={signOutAction}
            collapsed={collapsed}
            onToggle={toggleCollapsed}
          />
        </aside>

        {/* Mobile drawer — slide-out sheet + backdrop */}
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
              <SidebarContents
                pathname={pathname}
                user={user}
                navDeals={navDeals}
                signOutAction={signOutAction}
                collapsed={false}
              />
            </aside>
          </>
        )}

        {/* Main */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Top bar */}
          <header className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-border bg-bg/95 px-3 py-3 backdrop-blur sm:gap-4 sm:px-5">
            {/* Mobile menu button */}
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-text-muted transition-colors hover:text-text md:hidden"
              aria-label="Open menu"
            >
              <Menu className="h-4 w-4" strokeWidth={2} />
            </button>

            <div className="min-w-0 flex-1 shrink md:flex-none">
              <div className="truncate text-xs text-text-muted">{dateStr}</div>
              <div className="truncate text-base font-semibold tracking-tight sm:text-h1">
                {greet(now)}, {user?.name?.split(" ")[0] ?? "Jp"}
              </div>
            </div>
            <div className="flex shrink-0 items-center justify-end gap-2 sm:gap-3 md:flex-1">
              <GlobalSearch />
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

/** Shared nav body — renders inside both the desktop sidebar and the
 * mobile drawer. Kept in one component so the items + user card stay
 * identical across breakpoints. */
function SidebarContents({
  pathname,
  user,
  navDeals,
  signOutAction,
  collapsed,
  onToggle,
}: {
  pathname: string;
  user: ShellUser | null;
  navDeals: NavDeal[];
  signOutAction: () => Promise<void>;
  collapsed: boolean;
  onToggle?: () => void;
}) {
  return (
    <>
      <div
        className={cn(
          "mb-6 flex items-center",
          collapsed ? "flex-col gap-2" : "justify-between",
        )}
      >
        <Link
          href="/"
          aria-label="REOS home"
          className={cn(
            "flex items-center font-display text-2xl font-bold tracking-tight",
            collapsed ? "justify-center" : "gap-2 px-2",
          )}
        >
          <Logo size={collapsed ? 28 : 32} />
          {!collapsed && (
            <span>
              <span>RE</span>
              <span className="text-gradient-brand">OS</span>
            </span>
          )}
        </Link>
        {onToggle && (
          <button
            type="button"
            onClick={onToggle}
            title={collapsed ? "Expand menu" : "Collapse menu"}
            aria-label={collapsed ? "Expand menu" : "Collapse menu"}
            className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:bg-surface-2 hover:text-text"
          >
            {collapsed ? (
              <PanelLeftOpen className="h-4 w-4" strokeWidth={1.8} />
            ) : (
              <PanelLeftClose className="h-4 w-4" strokeWidth={1.8} />
            )}
          </button>
        )}
      </div>
      <nav className="flex flex-col gap-0.5">
        {NAV_GROUPS.map((group, gi) => {
          const items = group.items.filter(
            (item) => !item.investorOnly || user?.investor,
          );
          if (items.length === 0) return null;
          return (
            <div key={group.label ?? `g${gi}`} className={cn(gi > 0 && !collapsed && "mt-3")}>
              {group.label && !collapsed && (
                <div className="reos-label mb-0.5 px-2.5 opacity-50">{group.label}</div>
              )}
              {items.map((item) => {
                const active =
                  pathname === item.href ||
                  (item.href !== "/" && pathname.startsWith(item.href));
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={collapsed ? item.label : undefined}
                    className={cn(
                      "flex items-center rounded-md py-2 text-sm transition-colors",
                      collapsed ? "justify-center px-2" : "gap-2.5 px-2.5",
                      active
                        ? "bg-brand-50 font-medium text-brand-700"
                        : "text-text-muted hover:bg-surface-2 hover:text-text",
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" strokeWidth={1.8} />
                    {!collapsed && item.label}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>

      {/* Transactions grouped by status — property address under each. */}
      {!collapsed && navDeals.length > 0 && (
        <div className="mt-4 space-y-3 overflow-y-auto">
          {DEAL_GROUPS.map((g) => {
            const items = navDeals.filter((d) => d.group === g.key);
            if (items.length === 0) return null;
            const shown = items.slice(0, 8);
            return (
              <div key={g.key}>
                <div className="reos-label mb-1 flex items-center justify-between px-2 opacity-60">
                  <span>{g.label}</span>
                  <span className="tabular-nums">{items.length}</span>
                </div>
                <div className="flex flex-col gap-0.5">
                  {shown.map((d) => {
                    const active = pathname === `/transactions/${d.id}`;
                    return (
                      <Link
                        key={d.id}
                        href={`/transactions/${d.id}`}
                        title={d.address}
                        className={cn(
                          "truncate rounded px-2 py-1 text-xs transition-colors",
                          active
                            ? "bg-brand-50 font-medium text-brand-700"
                            : "text-text-muted hover:bg-surface-2 hover:text-text",
                        )}
                      >
                        {d.address}
                      </Link>
                    );
                  })}
                  {items.length > shown.length && (
                    <Link
                      href="/transactions"
                      className="px-2 py-1 text-xs text-text-subtle hover:text-text"
                    >
                      +{items.length - shown.length} more
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {collapsed ? (
        <div className="mt-auto flex flex-col items-center gap-1.5">
          {user?.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.image}
              alt=""
              className="h-7 w-7 rounded-full border border-border"
            />
          ) : (
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-500 text-[11px] font-semibold text-white">
              {(user?.name ?? user?.email ?? "?").slice(0, 1).toUpperCase()}
            </div>
          )}
          {user && (
            <form action={signOutAction}>
              <button
                type="submit"
                title="Sign out"
                aria-label="Sign out"
                className="flex h-7 w-7 items-center justify-center rounded border border-border bg-surface text-text-muted hover:text-text"
              >
                <LogOut className="h-3 w-3" strokeWidth={2} />
              </button>
            </form>
          )}
        </div>
      ) : (
        <div className="mt-auto rounded-md bg-surface-2 p-2.5 text-xs text-text-muted">
          <AccountSwitcher />
        {user ? (
          <>
            <div className="flex items-center gap-2">
              {user.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={user.image}
                  alt=""
                  className="h-7 w-7 shrink-0 rounded-full border border-border"
                />
              ) : (
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-500 text-[11px] font-semibold text-white">
                  {(user.name ?? user.email ?? "?").slice(0, 1).toUpperCase()}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-text">
                  {user.name ?? user.email ?? "Signed in"}
                </div>
                <div className="truncate">
                  {user.role
                    ? user.role.charAt(0).toUpperCase() + user.role.slice(1)
                    : "Team member"}
                </div>
              </div>
            </div>
            <form action={signOutAction} className="mt-2">
              <button
                type="submit"
                className="flex w-full items-center justify-center gap-1.5 rounded border border-border bg-surface px-2 py-1.5 text-[11px] font-medium text-text-muted transition-colors hover:border-brand-500 hover:text-text"
              >
                <LogOut className="h-3 w-3" strokeWidth={2} />
                Sign out
              </button>
            </form>
          </>
        ) : (
          <>
            <div className="font-medium text-text">Jp Fluellen</div>
            <div>Real Broker LLC · Cheyenne, WY</div>
          </>
        )}
        </div>
      )}
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
          title="Clear override — return to auto by sunrise/sunset"
        >
          <SunMoon className="h-4 w-4" strokeWidth={1.8} />
        </button>
      )}
    </div>
  );
}
