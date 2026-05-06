"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { DropZone } from "@/app/components/DropZone";
import { MoneyInput } from "@/app/components/MoneyInput";

interface Field<T = unknown> {
  value: T | null;
  confidence?: number;
}

interface Extraction {
  effectiveDate?: Field<string>;
  purchasePrice?: Field<number>;
  earnestMoneyAmount?: Field<number>;
  earnestMoneyDueDate?: Field<string>;
  closingDate?: Field<string>;
  possessionDate?: Field<string>;
  inspectionDeadline?: Field<string>;
  inspectionObjectionDeadline?: Field<string>;
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
  contractStage?: Field<string>;
  notes?: string | null;
  _path?: string;
}

interface FormState {
  address: string;
  buyerName: string;
  sellerName: string;
  effectiveDate: string;
  closingDate: string;
  possessionDate: string;
  inspectionDeadline: string;
  inspectionObjectionDeadline: string;
  titleCommitmentDeadline: string;
  titleObjectionDeadline: string;
  financingDeadline: string;
  walkthroughDate: string;
  earnestMoneyDueDate: string;
  earnestMoneyAmount: string;
  purchasePrice: string;
  sellerSideCommissionPct: string;
  sellerSideCommissionAmount: string;
  buyerSideCommissionPct: string;
  buyerSideCommissionAmount: string;
  titleCompany: string;
  lenderName: string;
}

const EMPTY_FORM: FormState = {
  address: "",
  buyerName: "",
  sellerName: "",
  effectiveDate: "",
  closingDate: "",
  possessionDate: "",
  inspectionDeadline: "",
  inspectionObjectionDeadline: "",
  titleCommitmentDeadline: "",
  titleObjectionDeadline: "",
  financingDeadline: "",
  walkthroughDate: "",
  earnestMoneyDueDate: "",
  earnestMoneyAmount: "",
  purchasePrice: "",
  sellerSideCommissionPct: "",
  sellerSideCommissionAmount: "",
  buyerSideCommissionPct: "",
  buyerSideCommissionAmount: "",
  titleCompany: "",
  lenderName: "",
};

function iso(s: string | null | undefined): string {
  if (!s) return "";
  return s.slice(0, 10);
}
function num(n: number | null | undefined): string {
  return n != null ? String(n) : "";
}
function firstOf(a: string[] | null | undefined): string {
  return Array.isArray(a) ? (a[0] ?? "") : "";
}

/**
 * Manual "drop a contract PDF → creates a transaction" flow.
 * Captures every field the extractor returns so the new transaction
 * lands with a full timeline (dates, commission, parties, etc.).
 */
export function ManualContractUploadPanel() {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [, startTransition] = useTransition();

  const [extraction, setExtraction] = useState<Extraction | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

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
        buyerName: firstOf(ex.buyers?.value as string[] | null),
        sellerName: firstOf(ex.sellers?.value as string[] | null),
        effectiveDate: iso(ex.effectiveDate?.value as string),
        closingDate: iso(ex.closingDate?.value as string),
        possessionDate: iso(ex.possessionDate?.value as string),
        inspectionDeadline: iso(ex.inspectionDeadline?.value as string),
        inspectionObjectionDeadline: iso(
          ex.inspectionObjectionDeadline?.value as string,
        ),
        titleCommitmentDeadline: iso(ex.titleCommitmentDeadline?.value as string),
        titleObjectionDeadline: iso(ex.titleObjectionDeadline?.value as string),
        financingDeadline: iso(ex.financingDeadline?.value as string),
        walkthroughDate: iso(ex.walkthroughDate?.value as string),
        earnestMoneyDueDate: iso(ex.earnestMoneyDueDate?.value as string),
        earnestMoneyAmount: num(ex.earnestMoneyAmount?.value as number),
        purchasePrice: num(ex.purchasePrice?.value as number),
        sellerSideCommissionPct: num(
          ex.sellerSideCommissionPct?.value as number,
        ),
        sellerSideCommissionAmount: num(
          ex.sellerSideCommissionAmount?.value as number,
        ),
        buyerSideCommissionPct: num(
          ex.buyerSideCommissionPct?.value as number,
        ),
        buyerSideCommissionAmount: num(
          ex.buyerSideCommissionAmount?.value as number,
        ),
        titleCompany: (ex.titleCompanyName?.value as string) ?? "",
        lenderName: (ex.lenderName?.value as string) ?? "",
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
          effectiveDate: form.effectiveDate || null,
          closingDate: form.closingDate || null,
          possessionDate: form.possessionDate || null,
          inspectionDeadline: form.inspectionDeadline || null,
          inspectionObjectionDeadline: form.inspectionObjectionDeadline || null,
          titleCommitmentDeadline: form.titleCommitmentDeadline || null,
          titleObjectionDeadline: form.titleObjectionDeadline || null,
          financingDeadline: form.financingDeadline || null,
          walkthroughDate: form.walkthroughDate || null,
          earnestMoneyDueDate: form.earnestMoneyDueDate || null,
          earnestMoneyAmount: parseNum(form.earnestMoneyAmount),
          purchasePrice: parseNum(form.purchasePrice),
          sellerSideCommissionPct: parseNum(form.sellerSideCommissionPct),
          sellerSideCommissionAmount: parseNum(form.sellerSideCommissionAmount),
          buyerSideCommissionPct: parseNum(form.buyerSideCommissionPct),
          buyerSideCommissionAmount: parseNum(form.buyerSideCommissionAmount),
          titleCompany: form.titleCompany.trim() || null,
          lenderName: form.lenderName.trim() || null,
          contractStage: extraction?.contractStage?.value ?? null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error ?? res.statusText);
        return;
      }
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
    setForm(EMPTY_FORM);
    setErr(null);
  }

  const stage = extraction?.contractStage?.value;
  const rider = extraction?.compensationOnSeparateRider?.value;

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
            explainer="REOS reads the contract with AI, extracts every deadline (effective, inspection, EM, financing, walkthrough, closing), parties, price + commissions, then drafts a new transaction with a full timeline. Drop a SIGNED purchase contract — not a flyer or random PDF. ~15-40s, ~$0.02 of OpenAI."
          />
          {uploading && (
            <div className="text-center text-xs text-text-muted">
              Extracting with AI · ~15-40 seconds · cost ~$0.02
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 rounded border border-border bg-surface-2 px-3 py-2 text-xs text-text-muted">
            <span>
              Extracted via <b>{extraction._path ?? "?"}</b>
            </span>
            {stage && (
              <span
                className={`rounded-full px-2 py-0.5 font-medium ${
                  stage === "executed"
                    ? "bg-brand-50 text-brand-700 ring-1 ring-brand-200"
                    : "bg-accent-100 text-accent-600 ring-1 ring-accent-200"
                }`}
              >
                stage: {stage}
              </span>
            )}
            {rider && (
              <span className="rounded-full bg-accent-100 px-2 py-0.5 font-medium text-accent-600 ring-1 ring-accent-200">
                compensation on separate rider
              </span>
            )}
            <span className="ml-auto">
              Fields below are editable — empty = not extracted.
            </span>
          </div>

          <div className="space-y-3">
            <Section title="Property + parties">
              <Input
                label="Property address *"
                value={form.address}
                onChange={(v) => setForm({ ...form, address: v })}
                required
                className="sm:col-span-2"
              />
              <Input
                label="Buyer"
                value={form.buyerName}
                onChange={(v) => setForm({ ...form, buyerName: v })}
              />
              <Input
                label="Seller"
                value={form.sellerName}
                onChange={(v) => setForm({ ...form, sellerName: v })}
              />
              <Input
                label="Title company"
                value={form.titleCompany}
                onChange={(v) => setForm({ ...form, titleCompany: v })}
              />
              <Input
                label="Lender"
                value={form.lenderName}
                onChange={(v) => setForm({ ...form, lenderName: v })}
              />
            </Section>

            <Section title="Timeline">
              <Input
                label="Effective date"
                type="date"
                value={form.effectiveDate}
                onChange={(v) => setForm({ ...form, effectiveDate: v })}
              />
              <Input
                label="Earnest money due"
                type="date"
                value={form.earnestMoneyDueDate}
                onChange={(v) =>
                  setForm({ ...form, earnestMoneyDueDate: v })
                }
              />
              <Input
                label="Inspection deadline"
                type="date"
                value={form.inspectionDeadline}
                onChange={(v) => setForm({ ...form, inspectionDeadline: v })}
              />
              <Input
                label="Inspection objection"
                type="date"
                value={form.inspectionObjectionDeadline}
                onChange={(v) =>
                  setForm({ ...form, inspectionObjectionDeadline: v })
                }
              />
              <Input
                label="Title commitment deadline"
                type="date"
                value={form.titleCommitmentDeadline}
                onChange={(v) =>
                  setForm({ ...form, titleCommitmentDeadline: v })
                }
              />
              <Input
                label="Title objection deadline"
                type="date"
                value={form.titleObjectionDeadline}
                onChange={(v) =>
                  setForm({ ...form, titleObjectionDeadline: v })
                }
              />
              <Input
                label="Financing deadline"
                type="date"
                value={form.financingDeadline}
                onChange={(v) => setForm({ ...form, financingDeadline: v })}
              />
              <Input
                label="Final walkthrough"
                type="date"
                value={form.walkthroughDate}
                onChange={(v) => setForm({ ...form, walkthroughDate: v })}
              />
              <Input
                label="Estimated closing"
                type="date"
                value={form.closingDate}
                onChange={(v) => setForm({ ...form, closingDate: v })}
              />
              <Input
                label="Possession"
                type="date"
                value={form.possessionDate}
                onChange={(v) => setForm({ ...form, possessionDate: v })}
              />
            </Section>

            <Section title="Money">
              <MoneyInput
                label="Purchase price"
                value={form.purchasePrice}
                onChange={(v) => setForm({ ...form, purchasePrice: v })}
              />
              <MoneyInput
                label="Earnest money amount"
                value={form.earnestMoneyAmount}
                onChange={(v) => setForm({ ...form, earnestMoneyAmount: v })}
              />
              <Input
                label="Seller-side commission %"
                value={form.sellerSideCommissionPct}
                placeholder="e.g. 0.03 for 3%"
                onChange={(v) =>
                  setForm({ ...form, sellerSideCommissionPct: v })
                }
              />
              <MoneyInput
                label="Seller-side commission $"
                value={form.sellerSideCommissionAmount}
                onChange={(v) =>
                  setForm({ ...form, sellerSideCommissionAmount: v })
                }
              />
              <Input
                label="Buyer-side commission %"
                value={form.buyerSideCommissionPct}
                placeholder="e.g. 0.025 for 2.5%"
                onChange={(v) =>
                  setForm({ ...form, buyerSideCommissionPct: v })
                }
              />
              <MoneyInput
                label="Buyer-side commission $"
                value={form.buyerSideCommissionAmount}
                onChange={(v) =>
                  setForm({ ...form, buyerSideCommissionAmount: v })
                }
              />
            </Section>
          </div>

          {extraction.notes && (
            <div className="rounded border border-border bg-surface-2 px-3 py-2 text-xs italic text-text-muted">
              AI note: {extraction.notes}
            </div>
          )}

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
        <div className="mt-3 rounded border border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-950/40 px-3 py-2 text-xs text-red-700 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200">
          {err}
        </div>
      )}
    </section>
  );
}

function parseNum(s: string): number | null {
  if (!s) return null;
  const n = parseFloat(s.replace(/[,$\s%]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
        {title}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {children}
      </div>
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
  type = "text",
  required,
  placeholder,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: "text" | "date" | "number";
  required?: boolean;
  placeholder?: string;
  className?: string;
}) {
  return (
    <label className={`block ${className ?? ""}`}>
      <span className="reos-label">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        placeholder={placeholder}
        className="mt-1 w-full rounded border border-border bg-surface-2 px-2 py-1.5 text-sm text-text placeholder:text-text-subtle focus:border-brand-500 focus:outline-none"
      />
    </label>
  );
}
