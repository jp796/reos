"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home as HomeIcon,
  Sparkles,
  LineChart,
  Users,
  Wallet,
  Receipt,
  Sun,
  Moon,
  SunMoon,
  LogOut,
} from "lucide-react";
import { useTheme } from "./ThemeProvider";
import { cn } from "@/lib/cn";
import { GlobalSearch } from "./components/GlobalSearch";

const NAV = [
  { href: "/", label: "Home", icon: HomeIcon },
  { href: "/today", label: "Today", icon: Sparkles },
  { href: "/transactions", label: "Transactions", icon: Wallet },
  { href: "/production", label: "Production", icon: LineChart },
  { href: "/sources", label: "Sources", icon: Receipt },
  { href: "/marketing", label: "Marketing", icon: Receipt },
  { href: "/contacts", label: "Contacts", icon: Users },
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

  // Public share routes get no chrome (no nav, no greeting, no theme
  // toggle). Let the page render its own minimal presentation.
  if (pathname?.startsWith("/share/")) {
    return <>{children}</>;
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
        {/* Sidebar */}
        <aside className="sticky top-0 hidden h-screen w-[232px] shrink-0 flex-col border-r border-border bg-surface px-3 py-5 md:flex">
          <Link
            href="/"
            className="mb-8 px-2 font-display text-2xl font-semibold tracking-tight"
            aria-label="REOS home"
          >
            RE
            <span className="inline-block h-[0.85em] w-[0.85em] translate-y-[3px] rounded-[3px] bg-brand-500" />
            S
          </Link>
          <nav className="flex flex-col gap-0.5">
            {NAV.map((item) => {
              const active =
                pathname === item.href ||
                (item.href !== "/" && pathname.startsWith(item.href));
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
          <div className="mt-auto rounded-md bg-surface-2 p-2.5 text-xs text-text-muted">
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
                      {(user.name ?? user.email ?? "?")
                        .slice(0, 1)
                        .toUpperCase()}
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
        </aside>

        {/* Main */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Top bar */}
          <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-border bg-bg/95 px-5 py-3 backdrop-blur">
            <div className="min-w-0 shrink-0">
              <div className="text-xs text-text-muted">{dateStr}</div>
              <div className="text-h1 font-semibold tracking-tight">
                {greet(now)}, {user?.name?.split(" ")[0] ?? "Jp"}
              </div>
            </div>
            <div className="flex flex-1 items-center justify-end gap-3">
              <GlobalSearch />
              <ThemeToggle
                mode={mode}
                override={!!override}
                onSet={setMode}
                onClear={clearOverride}
              />
            </div>
          </header>
          <main className="flex-1 px-5 py-6">{children}</main>
        </div>
      </div>
    </div>
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
