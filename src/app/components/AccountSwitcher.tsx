"use client";

/**
 * AccountSwitcher — dropdown in the sidebar user card. Lists every
 * workspace the user has access to (home + accepted memberships) and
 * lets them flip between them. Backed by /api/account/switch which
 * sets a server-side cookie; we hard-reload on switch so server
 * components re-render under the new accountId.
 */

import { useEffect, useRef, useState } from "react";
import { Building2, Check, ChevronsUpDown, Loader2 } from "lucide-react";

interface Workspace {
  accountId: string;
  businessName: string;
  role: string;
  isHome: boolean;
}

export function AccountSwitcher() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/account/switch");
        const data = await res.json();
        if (data.ok) {
          setWorkspaces(data.workspaces ?? []);
          setActiveId(data.activeAccountId ?? null);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  async function switchTo(accountId: string) {
    if (accountId === activeId) {
      setOpen(false);
      return;
    }
    setBusyId(accountId);
    try {
      const res = await fetch("/api/account/switch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accountId }),
      });
      if (!res.ok) {
        const d = await res.json();
        alert(d.error ?? "switch failed");
        return;
      }
      // Reload — server components need to re-fetch under the new cookie
      window.location.reload();
    } finally {
      setBusyId(null);
    }
  }

  // Hide entirely when there's only one workspace (the common case
  // for solo agents); the home brokerage name is already in the user
  // card below.
  if (loading || workspaces.length <= 1) return null;

  const active = workspaces.find((w) => w.accountId === activeId);

  return (
    <div ref={ref} className="relative mb-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 rounded-md border border-border bg-surface px-2.5 py-2 text-left text-xs hover:border-brand-500"
      >
        <div className="flex min-w-0 items-center gap-2">
          <Building2
            className="h-3.5 w-3.5 shrink-0 text-text-muted"
            strokeWidth={1.8}
          />
          <span className="truncate font-medium text-text">
            {active?.businessName ?? "Workspace"}
          </span>
        </div>
        <ChevronsUpDown
          className="h-3.5 w-3.5 shrink-0 text-text-muted"
          strokeWidth={1.8}
        />
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 rounded-md border border-border bg-surface p-1 shadow-md">
          {workspaces.map((w) => {
            const isActive = w.accountId === activeId;
            return (
              <button
                key={w.accountId}
                type="button"
                onClick={() => switchTo(w.accountId)}
                disabled={busyId === w.accountId}
                className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors ${
                  isActive
                    ? "bg-brand-50 text-brand-700"
                    : "hover:bg-surface-2"
                } disabled:opacity-50`}
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">
                    {w.businessName}
                  </div>
                  <div className="text-[10px] uppercase tracking-wide text-text-muted">
                    {w.isHome ? "Home" : w.role}
                  </div>
                </div>
                {busyId === w.accountId ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  isActive && (
                    <Check className="h-3.5 w-3.5" strokeWidth={2} />
                  )
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
