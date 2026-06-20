"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useToast } from "@/app/ToastProvider";

export function SummaryDesignForm() {
  const toast = useToast();
  const [logoUrl, setLogoUrl] = useState("");
  const [accentColor, setAccentColor] = useState("#4F46E5");
  const [tagline, setTagline] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/settings/summary-design")
      .then((r) => r.json())
      .then((d) => {
        if (d.design) {
          setLogoUrl(d.design.logoUrl ?? "");
          setAccentColor(d.design.accentColor ?? "#4F46E5");
          setTagline(d.design.tagline ?? "");
        }
      })
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/summary-design", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ logoUrl, accentColor, tagline }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "save failed");
      toast.success("Saved", "Your summary branding is updated.");
    } catch (e) {
      toast.error("Couldn't save", e instanceof Error ? e.message : "unknown");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="text-sm text-text-muted">
        <Loader2 className="inline h-3.5 w-3.5 animate-spin" /> Loading…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="reos-label">Logo URL</span>
        <input
          value={logoUrl}
          onChange={(e) => setLogoUrl(e.target.value)}
          placeholder="https://…/logo.png"
          className="mt-1 w-full rounded border border-border bg-surface-2 px-3 py-1.5 text-sm text-text placeholder:text-text-subtle focus:border-brand-500 focus:outline-none"
        />
        <span className="mt-1 block text-xs text-text-subtle">
          Shown top-right of the summary. Leave blank to show your business name.
        </span>
      </label>

      <label className="block">
        <span className="reos-label">Accent color</span>
        <div className="mt-1 flex items-center gap-2">
          <input
            type="color"
            value={accentColor}
            onChange={(e) => setAccentColor(e.target.value)}
            className="h-9 w-12 cursor-pointer rounded border border-border bg-surface-2"
          />
          <input
            value={accentColor}
            onChange={(e) => setAccentColor(e.target.value)}
            className="w-32 rounded border border-border bg-surface-2 px-3 py-1.5 text-sm text-text focus:border-brand-500 focus:outline-none"
          />
        </div>
      </label>

      <label className="block">
        <span className="reos-label">Tagline</span>
        <input
          value={tagline}
          onChange={(e) => setTagline(e.target.value)}
          placeholder="e.g. House Needs Love · Springfield + Cheyenne"
          className="mt-1 w-full rounded border border-border bg-surface-2 px-3 py-1.5 text-sm text-text placeholder:text-text-subtle focus:border-brand-500 focus:outline-none"
        />
      </label>

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save branding"}
        </button>
        <span className="text-xs text-text-muted">
          Preview it on any deal → <b>Summary</b>.
        </span>
      </div>
    </div>
  );
}
