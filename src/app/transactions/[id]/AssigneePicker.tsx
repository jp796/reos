"use client";

/**
 * AssigneePicker — inline dropdown on the transaction header to
 * assign the coordinator (TC). Drives the "my queue" filter on
 * /today and /transactions.
 *
 * Saves via the existing PATCH /api/transactions/:id/edit endpoint.
 * Optimistic update + toast; reverts on error.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UserCircle2 } from "lucide-react";
import { useToast } from "@/app/ToastProvider";
import { cn } from "@/lib/cn";

interface TeamMember {
  id: string;
  name: string | null;
  email: string;
  role: string;
}

export function AssigneePicker({
  transactionId,
  value,
  team,
}: {
  transactionId: string;
  value: string | null;
  team: TeamMember[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [current, setCurrent] = useState<string | null>(value);
  const [pending, startTransition] = useTransition();

  async function assign(next: string | null) {
    if (next === current) return;
    const prev = current;
    setCurrent(next);
    startTransition(async () => {
      try {
        const res = await fetch(
          `/api/transactions/${transactionId}/edit`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ assignedUserId: next }),
          },
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? res.statusText);
        const who = team.find((t) => t.id === next);
        toast.success(
          next ? `Assigned to ${who?.name ?? who?.email ?? "member"}` : "Unassigned",
        );
        router.refresh();
      } catch (e) {
        setCurrent(prev);
        toast.error(
          "Couldn't update assignment",
          e instanceof Error ? e.message : "unknown",
        );
      }
    });
  }

  const currentUser = current ? team.find((t) => t.id === current) : null;

  return (
    <label
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1 text-xs transition-colors",
        current ? "text-text" : "text-text-muted",
        pending && "opacity-70",
      )}
      title="Who's coordinating this transaction"
    >
      <UserCircle2 className="h-3.5 w-3.5" strokeWidth={1.8} />
      <select
        value={current ?? ""}
        disabled={pending}
        onChange={(e) => assign(e.target.value || null)}
        className="bg-transparent pr-1 text-xs focus:outline-none"
      >
        <option value="">— Unassigned —</option>
        {team.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name ?? m.email}
            {m.role !== "owner" && m.role !== "coordinator"
              ? ` (${m.role})`
              : ""}
          </option>
        ))}
      </select>
      {currentUser && (
        <span className="hidden text-text-subtle sm:inline">
          ·{" "}
          {currentUser.role.charAt(0).toUpperCase() +
            currentUser.role.slice(1)}
        </span>
      )}
    </label>
  );
}
