"use client";

/**
 * FormsLibrary — upload blank forms, see their fillable-field count, and
 * fill any of them for a deal (AI maps the deal's data onto the form).
 * The filled PDF lands in that deal's documents, ready to e-sign.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DropZone } from "@/app/components/DropZone";
import { classifyForm } from "@/lib/capabilities";
import { useToast } from "@/app/ToastProvider";

interface FormRow {
  id: string;
  name: string;
  category: string | null;
  fileName: string;
  fieldCount: number;
  isFlat: boolean;
  isXfa: boolean;
  hasText: boolean;
  createdAt: string;
}
interface Deal { id: string; address: string; }

const CATEGORIES = ["offer", "counter", "addendum", "disclosure", "other"];

export function FormsLibrary({
  initialForms,
  deals,
}: {
  initialForms: FormRow[];
  deals: Deal[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [, startTransition] = useTransition();
  const [forms, setForms] = useState(initialForms);
  const [busy, setBusy] = useState(false);
  const [category, setCategory] = useState("offer");
  const [fillFor, setFillFor] = useState<Record<string, string>>({});
  const [filling, setFilling] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  async function upload(files: File[]) {
    if (files.length === 0) return;
    setBusy(true);
    let added = 0;
    let fillable = 0;
    let flatReady = 0;
    let xfa = 0;
    let failed = 0;
    for (const file of files) {
      try {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("category", category);
        const res = await fetch("/api/forms", { method: "POST", body: fd });
        const data = await res.json();
        if (!res.ok) {
          failed++;
          continue;
        }
        added++;
        if (data.form.isXfa) xfa++;
        else if (data.form.isFlat) flatReady++;
        else fillable++;
        setForms((f) => [
          {
            id: data.form.id, name: data.form.name, category: data.form.category,
            fileName: file.name, fieldCount: data.form.fieldCount,
            isFlat: data.form.isFlat, isXfa: data.form.isXfa, hasText: data.form.hasText,
            createdAt: new Date().toISOString(),
          },
          ...f,
        ]);
      } catch {
        failed++;
      }
    }
    setBusy(false);
    startTransition(() => router.refresh());
    if (added > 0) {
      const bits = [
        `${fillable} fillable`,
        flatReady ? `${flatReady} flat` : "",
        xfa ? `${xfa} XFA (flatten first)` : "",
        failed ? `${failed} failed` : "",
      ].filter(Boolean);
      toast.success(`Added ${added} form${added === 1 ? "" : "s"}`, bits.join(" · "));
    } else {
      toast.error("Upload failed", `${failed} file${failed === 1 ? "" : "s"} couldn't be added.`);
    }
  }

  async function fill(formId: string) {
    const transactionId = fillFor[formId];
    if (!transactionId) {
      toast.error("Pick a deal", "Choose which deal to fill this form for.");
      return;
    }
    setFilling(formId);
    try {
      const res = await fetch(`/api/forms/${formId}/fill`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ transactionId }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.error ?? "fill failed");
      toast.success("Form filled", data.summary ?? "Saved to the deal's documents.");
    } catch (e) {
      toast.error("Couldn't fill", e instanceof Error ? e.message : "unknown");
    } finally {
      setFilling(null);
    }
  }

  const q = query.trim().toLowerCase();
  const shown = q
    ? forms.filter((f) =>
        [f.name, f.category ?? "", f.fileName].some((s) => s.toLowerCase().includes(q)),
      )
    : forms;

  return (
    <div>
      <div className="mb-1 reos-label">Forms Library</div>
      <h1 className="font-display text-display-md font-semibold">Forms</h1>
      <p className="mt-1 text-sm text-text-muted">
        Load blank forms once. Atlas fills any of them with a deal&apos;s data,
        then you send it for e-signature.
      </p>

      {/* Upload */}
      <section className="mt-6">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-sm font-medium">Add a form</span>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="rounded border border-border bg-surface px-2 py-1 text-xs"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <DropZone
          multiple
          onFiles={upload}
          disabled={busy}
          kind="blank form PDF(s)"
          explainer="Drop one or several blank forms at once (offer, counter, addendum, disclosure). Atlas reads each form's fields so it can fill them for any deal. Fillable (AcroForm) PDFs work best — flat PDFs get flagged."
        />
      </section>

      {/* Library */}
      <section className="mt-8">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-medium">Your forms ({shown.length})</h2>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search forms…"
            className="w-full max-w-xs rounded-md border border-border bg-surface-2 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
          />
        </div>
        {forms.length === 0 ? (
          <p className="text-sm text-text-muted">No forms yet — drop one above.</p>
        ) : shown.length === 0 ? (
          <p className="text-sm text-text-muted">No forms match &ldquo;{query}&rdquo;.</p>
        ) : (
          <ul className="space-y-2">
            {shown.map((f) => (
              <li key={f.id} className="rounded-lg border border-border bg-surface p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{f.name}</span>
                      {(() => {
                        // Compatibility claim sourced from the canonical
                        // capability registry (§13 documented source of truth).
                        const kind = f.isXfa
                          ? "xfa"
                          : !f.isFlat
                            ? "fillable_pdf"
                            : "flat_pdf";
                        const c = classifyForm(kind);
                        return (
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                              c.atlasFillable
                                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                                : "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300"
                            }`}
                            title={c.workflow}
                          >
                            {c.atlasFillable ? "Atlas-fillable" : "Needs conversion"}
                          </span>
                        );
                      })()}
                    </div>
                    <div className="text-xs text-text-muted">
                      {f.category ? `${f.category} · ` : ""}
                      {!f.isFlat ? (
                        <span className="text-emerald-600">
                          {f.fieldCount} fillable fields — ready to fill
                        </span>
                      ) : f.isXfa ? (
                        <span className="text-red-600">
                          ⚠ Adobe-only XFA — flatten first (open in Adobe → Print → Save as PDF), then re-upload
                        </span>
                      ) : f.hasText ? (
                        <span className="text-amber-600">
                          flat PDF with text layer — ready for the mapper (next build)
                        </span>
                      ) : (
                        <span className="text-amber-600">
                          flat scan — no text layer; the mapper will handle it (next build)
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {f.isFlat && !f.isXfa && (
                      <a
                        href={`/forms/${f.id}/map`}
                        className="rounded border border-border bg-surface px-2.5 py-1 text-xs font-medium text-text-muted hover:border-brand-400 hover:text-brand-700"
                      >
                        Map fields
                      </a>
                    )}
                    <select
                      value={fillFor[f.id] ?? ""}
                      onChange={(e) => setFillFor((m) => ({ ...m, [f.id]: e.target.value }))}
                      disabled={f.isXfa}
                      className="max-w-[12rem] rounded border border-border bg-surface-2 px-2 py-1 text-xs disabled:opacity-50"
                    >
                      <option value="">Fill for deal…</option>
                      {deals.map((d) => (
                        <option key={d.id} value={d.id}>{d.address}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => fill(f.id)}
                      disabled={f.isXfa || filling === f.id}
                      className="rounded-md bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-600 disabled:opacity-50"
                    >
                      {filling === f.id ? "Filling…" : "Fill + save"}
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
