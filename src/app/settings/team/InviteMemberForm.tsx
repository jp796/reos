"use client";

/**
 * InviteMemberForm — owner-only "invite a TC / agent" form on the
 * Team settings page. Posts to /api/account/members; on success, the
 * email row appears in the members list (existing users get instant
 * access; new emails auto-accept on first Google sign-in).
 *
 * Replaces the "edit AUTH_ALLOWED_EMAILS" friction — owner can self-
 * serve invites without redeploying.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, UserPlus } from "lucide-react";
import { useToast } from "@/app/ToastProvider";

export function InviteMemberForm() {
  const router = useRouter();
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"coordinator" | "agent">("coordinator");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    try {
      const res = await fetch("/api/account/members", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase(), role }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "invite failed");
      toast.success(
        "Invite sent",
        `${email} can now sign in and pick this workspace.`,
      );
      setEmail("");
      router.refresh();
    } catch (e) {
      toast.error("Invite failed", e instanceof Error ? e.message : "unknown");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-md border border-border bg-surface p-4"
    >
      <div className="mb-1 text-sm font-medium">Invite a TC or agent</div>
      <p className="mb-3 text-xs text-text-muted">
        They'll get access on their next Google sign-in. They can flip
        between this workspace and their own using the workspace
        switcher in the sidebar.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="email@example.com"
          required
          className="flex-1 rounded border border-border bg-surface-2 px-3 py-1.5 text-sm text-text placeholder:text-text-subtle focus:border-brand-500 focus:outline-none"
        />
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as "coordinator" | "agent")}
          className="rounded border border-border bg-surface-2 px-2 py-1.5 text-sm text-text"
        >
          <option value="coordinator">Coordinator (TC)</option>
          <option value="agent">Agent (read)</option>
        </select>
        <button
          type="submit"
          disabled={busy || !email.trim()}
          className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <UserPlus className="h-3.5 w-3.5" strokeWidth={2} />
          )}
          Invite
        </button>
      </div>
    </form>
  );
}
