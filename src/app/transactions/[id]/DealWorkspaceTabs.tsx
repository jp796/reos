"use client";

/**
 * DealWorkspaceTabs — turns the deal page from one long scroll into a
 * clean tabbed workspace (Timeline · Tasks · Details · Compliance ·
 * Files · Email). Each tab's content is server-rendered on the page and
 * passed in as a ReactNode slot; this client shell just shows the active
 * one. The active tab is remembered in the URL hash so a refresh / back
 * keeps your place and links can deep-link a tab.
 */

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";

export interface DealTab {
  id: string;
  label: string;
  badge?: number | null;
  content: React.ReactNode;
}

export function DealWorkspaceTabs({ tabs }: { tabs: DealTab[] }) {
  const [active, setActive] = useState(tabs[0]?.id ?? "");

  // Honor a #tab deep-link on mount.
  useEffect(() => {
    const h = window.location.hash.replace(/^#/, "");
    if (h && tabs.some((t) => t.id === h)) setActive(h);
  }, [tabs]);

  function select(id: string) {
    setActive(id);
    if (typeof window !== "undefined") {
      history.replaceState(null, "", `#${id}`);
    }
  }

  const current = tabs.find((t) => t.id === active) ?? tabs[0];

  return (
    <div className="mt-6">
      <div className="sticky top-0 z-10 -mx-1 flex flex-wrap gap-0.5 border-b border-border bg-bg/80 px-1 backdrop-blur">
        {tabs.map((t) => {
          const on = current?.id === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => select(t.id)}
              className={cn(
                "relative -mb-px inline-flex items-center gap-1.5 border-b-2 px-3.5 py-2.5 text-sm font-medium transition-colors",
                on
                  ? "border-brand-500 text-text"
                  : "border-transparent text-text-muted hover:text-text",
              )}
            >
              {t.label}
              {t.badge != null && t.badge > 0 && (
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
                    on ? "bg-brand-100 text-brand-700" : "bg-surface-2 text-text-muted",
                  )}
                >
                  {t.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className="mt-5">{current?.content}</div>
    </div>
  );
}
