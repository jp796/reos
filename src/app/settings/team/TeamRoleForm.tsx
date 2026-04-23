"use client";

/**
 * Inline role selector for a team member. Owner-only (the parent
 * page only renders this for owners looking at other members).
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/app/ToastProvider";

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
  const router = useRouter();
  const toast = useToast();

  async function change(next: string) {
    if (next === role) return;
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
        toast.success("Role updated", `Now a ${next}`);
        router.refresh();
      } catch (e) {
        setRole(prev);
        toast.error(
          "Couldn't change role",
          e instanceof Error ? e.message : "unknown error",
        );
      }
    });
  }

  return (
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
  );
}
