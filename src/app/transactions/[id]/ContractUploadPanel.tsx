"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface Field<T = unknown> {
  value: T | null;
  confidence?: number;
  snippet?: string | null;
}

interface Extraction {
  effectiveDate?: Field<string>;
  purchasePrice?: Field<number>;
  earnestMoneyAmount?: Field<number>;
  earnestMoneyDueDate?: Field<string>;
  closingDate?: Field<string>;
  possessionDate?: Field<string>;
  inspectionDeadline?: Field<string>;
  titleObjectionDeadline?: Field<string>;
  titleCommitmentDeadline?: Field<string>;
  financingDeadline?: Field<string>;
  walkthroughDate?: Field<string>;
  propertyAddress?: Field<string>;
  buyers?: Field<string[]>;
  sellers?: Field<string[]>;
  titleCompanyName?: Field<string>;
  lenderName?: Field<string>;
  sellerSideCommissionPct?: Field<number>;
  sellerSideCommissionAmount?: Field<number>;
  buyerSideCommissionPct?: Field<number>;
  buyerSideCommissionAmount?: Field<number>;
  compensationOnSeparateRider?: Field<boolean>;
  notes?: string | null;
  _path?: string;
}

const FIELD_ROWS: Array<{
  key: keyof Extraction;
  label: string;
  kind: "date" | "money" | "text" | "pct" | "names";
}> = [
  { key: "effectiveDate", label: "Effective date", kind: "date" },
  { key: "purchasePrice", label: "Purchase price", kind: "money" },
  { key: "earnestMoneyAmount", label: "Earnest money amount", kind: "money" },
  { key: "earnestMoneyDueDate", label: "Earnest money due", kind: "date" },
  { key: "closingDate", label: "Closing", kind: "date" },
  { key: "possessionDate", label: "Possession", kind: "date" },
  { key: "inspectionDeadline", label: "Inspection deadline", kind: "date" },
  { key: "titleCommitmentDeadline", label: "Title commitment", kind: "date" },
  { key: "titleObjectionDeadline", label: "Title objection", kind: "date" },
  { key: "financingDeadline", label: "Financing deadline", kind: "date" },
  { key: "walkthroughDate", label: "Walkthrough", kind: "date" },
  { key: "propertyAddress", label: "Property address", kind: "text" },
  { key: "titleCompanyName", label: "Title company", kind: "text" },
  { key: "lenderName", label: "Lender", kind: "text" },
  { key: "buyers", label: "Buyers", kind: "names" },
  { key: "sellers", label: "Sellers", kind: "names" },
  { key: "sellerSideCommissionPct", label: "Seller-side commission %", kind: "pct" },
  { key: "sellerSideCommissionAmount", label: "Seller-side commission $", kind: "money" },
  { key: "buyerSideCommissionPct", label: "Buyer-side commission %", kind: "pct" },
  { key: "buyerSideCommissionAmount", label: "Buyer-side commission $", kind: "money" },
];

export function ContractUploadPanel({
  transactionId,
  initialExtraction,
}: {
  transactionId: string;
  initialExtraction: Extraction | null;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [, startTransition] = useTransition();
  const [extraction, setExtraction] = useState<Extraction | null>(
    initialExtraction,
  );
  const [edits, setEdits] = useState<Record<string, string>>(() =>
    initialExtraction ? editsFromExtraction(initialExtraction) : {},
  );
  const [uploading, setUploading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function onUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = fileRef.current?.files?.[0];
    if (!f) return;
    setUploading(true);
    setErr(null);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const res = await fetch(
        `/api/transactions/${transactionId}/contract/extract`,
        { method: "POST", body: fd },
      );
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error ?? res.statusText);
        return;
      }
      setExtraction(data.extraction);
      setEdits(editsFromExtraction(data.extraction));
      setMsg(
        `Extracted via ${data.extraction._path ?? "?"}. Review below, then Apply.`,
      );
      if (fileRef.current) fileRef.current.value = "";
    } catch (e) {
      setErr(e instanceof Error ? e.message : "upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function onApply() {
    if (!extraction) return;
    setApplying(true);
    setErr(null);
    setMsg(null);
    try {
      const merged = applyEdits(extraction, edits);
      const res = await fetch(
        `/api/transactions/${transactionId}/contract/apply`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ extraction: merged }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error ?? res.statusText);
        return;
      }
      setMsg(
        `Applied · ${data.milestonesUpserted} milestones · ${data.appliedFields?.length ?? 0} fields`,
      );
      setExtraction(null);
      setEdits({});
      startTransition(() => router.refresh());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "apply failed");
    } finally {
      setApplying(false);
    }
  }

  async function onDiscard() {
    if (!window.confirm("Drop this extraction without applying?")) return;
    try {
      await fetch(`/api/transactions/${transactionId}/contract/discard`, {
        method: "POST",
      });
      setExtraction(null);
      setEdits({});
      setMsg("Discarded.");
      startTransition(() => router.refresh());
    } catch {
      setErr("discard failed");
    }
  }

  return (
    <section className="mt-6 rounded-lg border border-neutral-200 bg-white p-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium">Contract extraction</h2>
        <span className="text-xs text-neutral-500">
          Upload the purchase contract + any compensation rider. AI
          reads them, you review + apply.
        </span>
      </div>

      {!extraction && (
        <form
          onSubmit={onUpload}
          className="flex flex-wrap items-center gap-3"
        >
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,.pdf"
            className="text-sm"
            required
          />
          <button
            type="submit"
            disabled={uploading}
            className="rounded bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            {uploading ? "Extracting…" : "Upload + Extract"}
          </button>
          <span className="text-xs text-neutral-500">
            PDF only · usually 15-40 seconds · cost ~$0.02/doc
          </span>
        </form>
      )}

      {extraction && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="text-neutral-600">
              Extracted via <b>{extraction._path}</b>
              {extraction.compensationOnSeparateRider?.value && (
                <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">
                  This appears to be / came with a compensation rider
                </span>
              )}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onApply}
                disabled={applying}
                className="rounded bg-neutral-900 px-3 py-1 font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
              >
                {applying ? "Applying…" : "Apply to transaction"}
              </button>
              <button
                type="button"
                onClick={onDiscard}
                className="rounded border border-neutral-300 bg-white px-3 py-1 hover:border-neutral-500"
              >
                Discard
              </button>
            </div>
          </div>

          <div className="overflow-x-auto rounded border border-neutral-200">
            <table className="w-full text-xs">
              <thead className="bg-neutral-50 text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">Field</th>
                  <th className="px-3 py-2 font-medium">Extracted value</th>
                  <th className="px-3 py-2 font-medium">Confidence</th>
                  <th className="px-3 py-2 font-medium">Source snippet</th>
                </tr>
              </thead>
              <tbody>
                {FIELD_ROWS.map((row) => {
                  const f = extraction[row.key] as Field<unknown> | undefined;
                  const val = edits[row.key] ?? "";
                  const conf = f?.confidence ?? 0;
                  return (
                    <tr
                      key={row.key}
                      className="border-t border-neutral-100"
                    >
                      <td className="px-3 py-1.5 font-medium">{row.label}</td>
                      <td className="px-3 py-1.5">
                        <input
                          type={row.kind === "date" ? "date" : "text"}
                          value={val}
                          onChange={(e) =>
                            setEdits({ ...edits, [row.key]: e.target.value })
                          }
                          placeholder={placeholderFor(row.kind)}
                          className="w-full rounded border border-neutral-200 px-1.5 py-0.5"
                        />
                      </td>
                      <td className="px-3 py-1.5 text-neutral-500">
                        {conf > 0 ? `${(conf * 100).toFixed(0)}%` : "—"}
                      </td>
                      <td className="max-w-[360px] truncate px-3 py-1.5 text-neutral-500">
                        {f?.snippet ?? "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {extraction.notes && (
            <div className="rounded border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs italic text-neutral-700">
              AI note: {extraction.notes}
            </div>
          )}
        </div>
      )}

      {err && (
        <div className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {err}
        </div>
      )}
      {msg && (
        <div className="mt-3 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          {msg}
        </div>
      )}
    </section>
  );
}

function placeholderFor(kind: "date" | "money" | "text" | "pct" | "names"): string {
  switch (kind) {
    case "date":
      return "YYYY-MM-DD";
    case "money":
      return "0";
    case "pct":
      return "0.03";
    case "names":
      return "Name 1, Name 2";
    default:
      return "";
  }
}

function editsFromExtraction(e: Extraction): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of FIELD_ROWS) {
    const f = e[row.key] as Field<unknown> | undefined;
    const v = f?.value;
    if (v === null || v === undefined) {
      out[row.key] = "";
      continue;
    }
    if (Array.isArray(v)) out[row.key] = v.join(", ");
    else if (typeof v === "number") out[row.key] = String(v);
    else out[row.key] = String(v);
  }
  return out;
}

function applyEdits(e: Extraction, edits: Record<string, string>): Extraction {
  const out: Record<string, unknown> = { ...e };
  for (const row of FIELD_ROWS) {
    const raw = (edits[row.key] ?? "").trim();
    const prev = (e[row.key] as Field<unknown> | undefined) ?? {
      value: null,
      confidence: 0,
      snippet: null,
    };
    if (!raw) {
      out[row.key] = { ...prev, value: null };
      continue;
    }
    let value: unknown = raw;
    if (row.kind === "money" || row.kind === "pct") {
      value = parseFloat(raw.replace(/[,$\s%]/g, ""));
      if (!Number.isFinite(value)) value = null;
    }
    if (row.kind === "names") {
      value = raw.split(",").map((s) => s.trim()).filter(Boolean);
    }
    out[row.key] = { ...prev, value, confidence: Math.max(prev.confidence ?? 0, 0.99) };
  }
  return out as Extraction;
}
