"use client";

/**
 * Inline role selector for a team member. Owner-only (the parent
 * page only renders this for owners looking at other members).
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

const ROLES = ["owner", "coordinator"] as const;

export function TeamRoleForm({
  userId,
  currentRole,
}: {
  userId: string;
  currentRole: string;
}) {
  const [role, setRole] = useState(currentRole);
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();

  async function change(next: string) {
    if (next === role) return;
    setErr(null);
    const prev = role;
    setRole(next); // optimistic
    startTransition(async () => {
      try {
        const res = await fetch(`/api/team/${userId}/role`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ role: next }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error ?? `HTTP ${res.status}`);
        }
        router.refresh();
      } catch (e) {
        setRole(prev);
        setErr(e instanceof Error ? e.message : "failed");
      }
    });
  }

  return (
    <div className="flex items-center gap-2">
      <select
        value={role}
        disabled={pending}
        onChange={(e) => change(e.target.value)}
        className="rounded-md border border-border bg-surface px-2 py-1 text-xs capitalize focus:border-brand-500 focus:outline-none disabled:opacity-60"
      >
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
      {err && (
        <span className="text-[11px] text-red-600" title={err}>
          failed
        </span>
      )}
    </div>
  );
}
