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

const NAV = [
  { href: "/", label: "Home", icon: HomeIcon },
  { href: "/today", label: "Today", icon: CalendarDays },
  { href: "/insights", label: "Insights", icon: LayoutDashboard },
  { href: "/digest", label: "Digest", icon: Newspaper },
  { href: "/scan", label: "Scan", icon: Radar },
  { href: "/voice", label: "Voice intake", icon: Mic },
  { href: "/listings", label: "Listings", icon: Signpost },
  { href: "/transactions", label: "Transactions", icon: FolderCheck },
  { href: "/forms", label: "Forms", icon: FileSignature },
  { href: "/board", label: "Board", icon: KanbanSquare, investorOnly: true },
  { href: "/production", label: "Production", icon: TrendingUp },
  { href: "/sources", label: "Sources", icon: Filter },
  { href: "/marketing", label: "Marketing", icon: Megaphone },
  { href: "/contacts", label: "Contacts", icon: UsersRound },
  { href: "/help", label: "Help", icon: HelpCircle },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
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

export function AppShell({
  children,
  user,
  signOutAction,
}: {
  children: React.ReactNode;
  user: ShellUser | null;
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
  signOutAction,
  collapsed,
  onToggle,
}: {
  pathname: string;
  user: ShellUser | null;
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
        {NAV.filter(
          (item) => !("investorOnly" in item && item.investorOnly) || user?.investor,
        ).map((item) => {
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
      </nav>

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
