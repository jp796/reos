"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { DropZone } from "@/app/components/DropZone";

interface Field<T = unknown> {
  value: T | null;
  confidence?: number;
}

interface Extraction {
  effectiveDate?: Field<string>;
  purchasePrice?: Field<number>;
  closingDate?: Field<string>;
  propertyAddress?: Field<string>;
  buyers?: Field<string[]>;
  sellers?: Field<string[]>;
  titleCompanyName?: Field<string>;
  contractStage?: Field<string>;
  _path?: string;
}

function fmtIsoDate(s: string | null | undefined): string {
  if (!s) return "";
  return s.slice(0, 10);
}

/**
 * Manual "drop a contract PDF to create a transaction" flow.
 * Bypasses the Gmail scanner when a deal isn't findable via search
 * (Dotloop link-only contracts, weird filenames, etc.).
 */
export function ManualContractUploadPanel() {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [, startTransition] = useTransition();

  const [extraction, setExtraction] = useState<Extraction | null>(null);
  const [form, setForm] = useState({
    address: "",
    buyerName: "",
    sellerName: "",
    closingDate: "",
    effectiveDate: "",
    purchasePrice: "",
    titleCompany: "",
  });

  async function uploadFile(f: File) {
    setPendingFile(f);
    setUploading(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const res = await fetch(
        "/api/automation/upload-contract-to-create",
        { method: "POST", body: fd },
      );
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error ?? res.statusText);
        return;
      }
      const ex: Extraction = data.extraction ?? {};
      setExtraction(ex);
      setForm({
        address: (ex.propertyAddress?.value as string) ?? "",
        buyerName: Array.isArray(ex.buyers?.value)
          ? ((ex.buyers?.value as string[])[0] ?? "")
          : "",
        sellerName: Array.isArray(ex.sellers?.value)
          ? ((ex.sellers?.value as string[])[0] ?? "")
          : "",
        closingDate: fmtIsoDate(ex.closingDate?.value as string),
        effectiveDate: fmtIsoDate(ex.effectiveDate?.value as string),
        purchasePrice: ex.purchasePrice?.value
          ? String(ex.purchasePrice.value)
          : "",
        titleCompany: (ex.titleCompanyName?.value as string) ?? "",
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function create() {
    if (!form.address.trim()) {
      setErr("address is required");
      return;
    }
    setCreating(true);
    setErr(null);
    try {
      const res = await fetch("/api/automation/create-from-scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          address: form.address.trim(),
          buyerName: form.buyerName.trim() || null,
          sellerName: form.sellerName.trim() || null,
          closingDate: form.closingDate || null,
          effectiveDate: form.effectiveDate || null,
          purchasePrice: form.purchasePrice
            ? parseFloat(form.purchasePrice)
            : null,
          titleCompany: form.titleCompany.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error ?? res.statusText);
        return;
      }
      // Navigate to the new txn
      startTransition(() => router.push(`/transactions/${data.transactionId}`));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "create failed");
    } finally {
      setCreating(false);
    }
  }

  function cancel() {
    setExtraction(null);
    setPendingFile(null);
    setForm({
      address: "",
      buyerName: "",
      sellerName: "",
      closingDate: "",
      effectiveDate: "",
      purchasePrice: "",
      titleCompany: "",
    });
    setErr(null);
  }

  return (
    <section className="mt-8 rounded-md border border-border bg-surface p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium">Upload contract to create</h2>
        <span className="text-xs text-text-muted">
          Drop a PDF — AI fills the form, you confirm, it lands as a new
          transaction
        </span>
      </div>

      {!extraction ? (
        <div className="space-y-2">
          <DropZone
            onFile={uploadFile}
            disabled={uploading}
            selectedName={pendingFile?.name ?? null}
            kind="contract PDF"
          />
          {uploading && (
            <div className="text-center text-xs text-text-muted">
              Extracting with AI · ~15-40 seconds · cost ~$0.02
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="rounded border border-border bg-surface-2 px-3 py-2 text-xs text-text-muted">
            Extracted via <b>{extraction._path ?? "?"}</b> · review below,
            edit anything wrong, then Create
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field
              label="Property address"
              value={form.address}
              onChange={(v) => setForm({ ...form, address: v })}
              required
            />
            <Field
              label="Title company"
              value={form.titleCompany}
              onChange={(v) => setForm({ ...form, titleCompany: v })}
            />
            <Field
              label="Buyer name"
              value={form.buyerName}
              onChange={(v) => setForm({ ...form, buyerName: v })}
            />
            <Field
              label="Seller name"
              value={form.sellerName}
              onChange={(v) => setForm({ ...form, sellerName: v })}
            />
            <Field
              label="Effective date"
              type="date"
              value={form.effectiveDate}
              onChange={(v) => setForm({ ...form, effectiveDate: v })}
            />
            <Field
              label="Estimated closing"
              type="date"
              value={form.closingDate}
              onChange={(v) => setForm({ ...form, closingDate: v })}
            />
            <Field
              label="Purchase price"
              type="number"
              value={form.purchasePrice}
              onChange={(v) => setForm({ ...form, purchasePrice: v })}
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={create}
              disabled={creating || !form.address.trim()}
              className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
            >
              <Plus className="h-4 w-4" strokeWidth={2} />
              {creating ? "Creating…" : "Create transaction"}
            </button>
            <button
              type="button"
              onClick={cancel}
              className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-text-muted hover:border-border-strong hover:text-text"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {err && (
        <div className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {err}
        </div>
      )}
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: "text" | "date" | "number";
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="reos-label">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        className="mt-1 w-full rounded border border-border bg-surface-2 px-2 py-1.5 text-sm"
      />
    </label>
  );
}
