"use client";

/**
 * FormsLibrary — upload blank forms, see their fillable-field count, and
 * fill any of them for a deal (AI maps the deal's data onto the form).
 * The filled PDF lands in that deal's documents, ready to e-sign.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DropZone } from "@/app/components/DropZone";
import { useToast } from "@/app/ToastProvider";

interface FormRow {
  id: string;
  name: string;
  category: string | null;
  fileName: string;
  fieldCount: number;
  isFlat: boolean;
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

  async function upload(files: File[]) {
    const file = files[0];
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("category", category);
      const res = await fetch("/api/forms", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "upload failed");
      toast.success(
        "Form added",
        data.form.isFlat
          ? "Heads up: no fillable fields detected (flat PDF)."
          : `${data.form.fieldCount} fillable fields detected.`,
      );
      startTransition(() => router.refresh());
      // Optimistic add so it shows immediately.
      setForms((f) => [
        {
          id: data.form.id, name: data.form.name, category: data.form.category,
          fileName: file.name, fieldCount: data.form.fieldCount,
          isFlat: data.form.isFlat, createdAt: new Date().toISOString(),
        },
        ...f,
      ]);
    } catch (e) {
      toast.error("Upload failed", e instanceof Error ? e.message : "unknown");
    } finally {
      setBusy(false);
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
          onFiles={upload}
          disabled={busy}
          kind="blank form PDF"
          explainer="Upload a blank fillable form (offer, counter, addendum, disclosure). Atlas reads its fields so it can fill them for any deal. Fillable (AcroForm) PDFs work best."
        />
      </section>

      {/* Library */}
      <section className="mt-8">
        <h2 className="mb-3 text-lg font-medium">Your forms ({forms.length})</h2>
        {forms.length === 0 ? (
          <p className="text-sm text-text-muted">No forms yet — drop one above.</p>
        ) : (
          <ul className="space-y-2">
            {forms.map((f) => (
              <li key={f.id} className="rounded-lg border border-border bg-surface p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-medium">{f.name}</div>
                    <div className="text-xs text-text-muted">
                      {f.category ? `${f.category} · ` : ""}
                      {f.isFlat ? (
                        <span className="text-amber-600">flat PDF — no fillable fields</span>
                      ) : (
                        `${f.fieldCount} fillable fields`
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={fillFor[f.id] ?? ""}
                      onChange={(e) => setFillFor((m) => ({ ...m, [f.id]: e.target.value }))}
                      disabled={f.isFlat}
                      className="max-w-[14rem] rounded border border-border bg-surface-2 px-2 py-1 text-xs disabled:opacity-50"
                    >
                      <option value="">Fill for deal…</option>
                      {deals.map((d) => (
                        <option key={d.id} value={d.id}>{d.address}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => fill(f.id)}
                      disabled={f.isFlat || filling === f.id}
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
