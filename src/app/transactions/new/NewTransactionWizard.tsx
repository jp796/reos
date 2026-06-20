"use client";

/**
 * NewTransactionWizard — guided intake. Step 1: pick your side + drop
 * the contract (and related docs). Atlas reads the primary contract.
 * Step 2: review extracted parties/dates/money, then create. Reuses the
 * proven endpoints (/upload-contract-to-create to extract, /create-from-
 * scan to create) so a wizard-created deal is identical to the old flow.
 */

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Upload,
  FileText,
  X,
  Sparkles,
  Plus,
  ArrowLeft,
  Home,
  Users,
  User,
  Building2,
} from "lucide-react";
import { MoneyInput } from "@/app/components/MoneyInput";
import { toDateInputValue } from "@/lib/dates";

type Side = "buyer" | "listing" | "both" | "investor";
type Strategy = "flip" | "wholesale" | "rental" | "creative";

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
  address: "", buyerName: "", sellerName: "", effectiveDate: "", closingDate: "",
  possessionDate: "", inspectionDeadline: "", inspectionObjectionDeadline: "",
  titleCommitmentDeadline: "", titleObjectionDeadline: "", financingDeadline: "",
  walkthroughDate: "", earnestMoneyDueDate: "", earnestMoneyAmount: "",
  purchasePrice: "", sellerSideCommissionPct: "", sellerSideCommissionAmount: "",
  buyerSideCommissionPct: "", buyerSideCommissionAmount: "", titleCompany: "",
  lenderName: "",
};

const iso = (s: string | null | undefined) => toDateInputValue(s);
const num = (n: number | null | undefined) => (n != null ? String(n) : "");
const firstOf = (a: string[] | null | undefined) => (Array.isArray(a) ? (a[0] ?? "") : "");
function parseNum(s: string): number | null {
  if (!s) return null;
  const n = parseFloat(s.replace(/[,$\s%]/g, ""));
  return Number.isFinite(n) ? n : null;
}

const SIDES: Array<{ id: Side; label: string; hint: string; icon: typeof Home }> = [
  { id: "buyer", label: "Buyer Side", hint: "Representing the buyer", icon: User },
  { id: "listing", label: "Listing Side", hint: "Representing the seller", icon: Home },
  { id: "both", label: "Both Sides", hint: "Dual representation", icon: Users },
  { id: "investor", label: "Investor Deal", hint: "You're the principal", icon: Building2 },
];
const STRATEGIES: Array<{ id: Strategy; label: string }> = [
  { id: "flip", label: "Fix & Flip" },
  { id: "wholesale", label: "Wholesale" },
  { id: "rental", label: "Rental / BRRRR" },
  { id: "creative", label: "Creative Finance" },
];

/** Investor strategy → classifier signals create-from-scan understands. */
function investorSignals(strategy: Strategy): Record<string, boolean> {
  switch (strategy) {
    case "flip": return { resaleIntent: true, rehabBudget: true };
    case "wholesale": return { assignmentClause: true, cashBuyerDisposition: true, resaleIntent: true };
    case "rental": return { rentEstimate: true };
    case "creative": return { twoClosingIntent: true, refinanceIntent: true };
  }
}

export function NewTransactionWizard() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [, startTransition] = useTransition();

  const [step, setStep] = useState<"setup" | "review">("setup");
  const [side, setSide] = useState<Side | null>(null);
  const [strategy, setStrategy] = useState<Strategy>("flip");
  const [files, setFiles] = useState<File[]>([]);
  const [primaryIdx, setPrimaryIdx] = useState(0);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [extraction, setExtraction] = useState<Extraction | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  function addFiles(list: FileList | null) {
    if (!list) return;
    setFiles((prev) => [...prev, ...Array.from(list)]);
  }
  function removeFile(i: number) {
    setFiles((prev) => prev.filter((_, idx) => idx !== i));
    if (primaryIdx >= files.length - 1) setPrimaryIdx(0);
  }

  function hydrateForm(ex: Extraction) {
    setForm({
      address: (ex.propertyAddress?.value as string) ?? "",
      buyerName: firstOf(ex.buyers?.value as string[] | null),
      sellerName: firstOf(ex.sellers?.value as string[] | null),
      effectiveDate: iso(ex.effectiveDate?.value as string),
      closingDate: iso(ex.closingDate?.value as string),
      possessionDate: iso(ex.possessionDate?.value as string),
      inspectionDeadline: iso(ex.inspectionDeadline?.value as string),
      inspectionObjectionDeadline: iso(ex.inspectionObjectionDeadline?.value as string),
      titleCommitmentDeadline: iso(ex.titleCommitmentDeadline?.value as string),
      titleObjectionDeadline: iso(ex.titleObjectionDeadline?.value as string),
      financingDeadline: iso(ex.financingDeadline?.value as string),
      walkthroughDate: iso(ex.walkthroughDate?.value as string),
      earnestMoneyDueDate: iso(ex.earnestMoneyDueDate?.value as string),
      earnestMoneyAmount: num(ex.earnestMoneyAmount?.value as number),
      purchasePrice: num(ex.purchasePrice?.value as number),
      sellerSideCommissionPct: num(ex.sellerSideCommissionPct?.value as number),
      sellerSideCommissionAmount: num(ex.sellerSideCommissionAmount?.value as number),
      buyerSideCommissionPct: num(ex.buyerSideCommissionPct?.value as number),
      buyerSideCommissionAmount: num(ex.buyerSideCommissionAmount?.value as number),
      titleCompany: (ex.titleCompanyName?.value as string) ?? "",
      lenderName: (ex.lenderName?.value as string) ?? "",
    });
  }

  async function readContract() {
    const primary = files[primaryIdx];
    if (!primary) {
      setErr("Add the contract file first (or skip to enter manually).");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", primary);
      const res = await fetch("/api/automation/upload-contract-to-create", {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error ?? res.statusText);
        return;
      }
      const ex: Extraction = data.extraction ?? {};
      setExtraction(ex);
      hydrateForm(ex);
      setStep("review");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "extraction failed");
    } finally {
      setBusy(false);
    }
  }

  function skipToManual() {
    setExtraction(null);
    setForm(EMPTY_FORM);
    setErr(null);
    setStep("review");
  }

  async function create() {
    if (!form.address.trim()) {
      setErr("Property address is required.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const body: Record<string, unknown> = {
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
      };
      // Investor side → strategy classifier signals route to the
      // investor module (Asset + strategy stages).
      if (side === "investor") Object.assign(body, investorSignals(strategy));

      const res = await fetch("/api/automation/create-from-scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error ?? res.statusText);
        return;
      }
      // Attach every uploaded file (contract + related docs) into the
      // new deal's document library so nothing is lost. Best-effort —
      // a failed attach shouldn't block opening the created deal.
      if (data.transactionId && files.length > 0) {
        try {
          const fd = new FormData();
          files.forEach((f) => fd.append("file", f));
          fd.append("origin", "wizard");
          await fetch(`/api/transactions/${data.transactionId}/documents`, {
            method: "POST",
            body: fd,
          });
        } catch {
          /* non-blocking */
        }
      }
      startTransition(() => router.push(`/transactions/${data.transactionId}`));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "create failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="py-2">
      <div className="reos-label">New deal</div>
      <h1 className="mt-1 font-display text-display-lg font-semibold">
        {step === "setup" ? "Upload a contract" : "Review & create"}
      </h1>
      <p className="mt-1 text-sm text-text-muted">
        {step === "setup"
          ? "Drop the purchase contract or listing agreement (plus related docs). Atlas reads the dates, parties, and deadlines and sets the deal up."
          : "Atlas pulled these from the contract — empty means not found. Edit anything, then create."}
      </p>

      {step === "setup" && (
        <div className="mt-6 space-y-6">
          {/* Side picker */}
          <div>
            <div className="mb-2 text-sm font-medium">Which side do you represent?</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {SIDES.map((s) => {
                const Icon = s.icon;
                const active = side === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSide(s.id)}
                    className={`flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors ${
                      active
                        ? "border-brand-500 bg-brand-50 ring-1 ring-brand-200"
                        : "border-border bg-surface hover:border-border-strong"
                    }`}
                  >
                    <Icon className={`h-4 w-4 ${active ? "text-brand-600" : "text-text-muted"}`} />
                    <span className="text-sm font-medium text-text">{s.label}</span>
                    <span className="text-xs text-text-muted">{s.hint}</span>
                  </button>
                );
              })}
            </div>
            {side === "investor" && (
              <div className="mt-3">
                <div className="mb-1.5 text-xs font-medium text-text-muted">Investment strategy</div>
                <div className="flex flex-wrap gap-1.5">
                  {STRATEGIES.map((st) => (
                    <button
                      key={st.id}
                      type="button"
                      onClick={() => setStrategy(st.id)}
                      className={`rounded-full border px-3 py-1 text-xs font-medium ${
                        strategy === st.id
                          ? "border-accent-400 bg-accent-100 text-accent-600"
                          : "border-border bg-surface text-text-muted hover:text-text"
                      }`}
                    >
                      {st.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Multi-file upload */}
          <div>
            <div className="mb-2 text-sm font-medium">Documents</div>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex w-full flex-col items-center gap-1.5 rounded-lg border border-dashed border-border bg-surface px-4 py-8 text-center hover:border-brand-400"
            >
              <Upload className="h-5 w-5 text-text-muted" />
              <span className="text-sm font-medium text-text">
                {files.length ? "Add more files" : "Add files"}
              </span>
              <span className="text-xs text-text-muted">
                Purchase contract, listing agreement, disclosures, addenda — PDFs or photos
              </span>
            </button>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept="application/pdf,image/*"
              className="hidden"
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = "";
              }}
            />
            {files.length > 0 && (
              <ul className="mt-2 space-y-1.5">
                {files.map((f, i) => (
                  <li
                    key={`${f.name}-${i}`}
                    className="flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm"
                  >
                    <FileText className="h-4 w-4 shrink-0 text-text-muted" />
                    <span className="flex-1 truncate text-text">{f.name}</span>
                    <span className="shrink-0 text-xs text-text-subtle">
                      {(f.size / 1_000_000).toFixed(2)} MB
                    </span>
                    <label className="flex shrink-0 items-center gap-1 text-xs text-text-muted">
                      <input
                        type="radio"
                        name="primary"
                        checked={primaryIdx === i}
                        onChange={() => setPrimaryIdx(i)}
                      />
                      contract
                    </label>
                    <button
                      type="button"
                      onClick={() => removeFile(i)}
                      aria-label="Remove"
                      className="shrink-0 rounded p-0.5 text-text-subtle hover:bg-surface-2 hover:text-red-600"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {files.length > 0 && (
              <p className="mt-1.5 text-xs text-text-subtle">
                Atlas reads the file marked <b>contract</b>; every file is saved to
                the new deal&rsquo;s <b>Files</b> tab.
              </p>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={readContract}
              disabled={busy || !side || files.length === 0}
              className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-50"
            >
              <Sparkles className="h-4 w-4" />
              {busy ? "Atlas is reading…" : "Read with Atlas"}
            </button>
            <button
              type="button"
              onClick={skipToManual}
              disabled={busy || !side}
              className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-muted hover:border-border-strong hover:text-text disabled:opacity-50"
            >
              Skip — enter manually
            </button>
          </div>
          {!side && (
            <p className="-mt-3 text-xs text-text-subtle">Pick a side to continue.</p>
          )}
        </div>
      )}

      {step === "review" && (
        <div className="mt-6 space-y-4">
          {extraction && (
            <div className="flex flex-wrap items-center gap-2 rounded border border-border bg-surface-2 px-3 py-2 text-xs text-text-muted">
              <span>
                Read via <b>{extraction._path ?? "AI"}</b>
              </span>
              {extraction.contractStage?.value && (
                <span className="rounded-full bg-brand-50 px-2 py-0.5 font-medium text-brand-700 ring-1 ring-brand-200">
                  stage: {extraction.contractStage.value}
                </span>
              )}
              <span className="ml-auto">Editable — empty = not found.</span>
            </div>
          )}

          <Section title="Property + parties">
            <Input label="Property address *" value={form.address} onChange={(v) => setForm({ ...form, address: v })} required className="sm:col-span-2" />
            <Input label="Buyer" value={form.buyerName} onChange={(v) => setForm({ ...form, buyerName: v })} />
            <Input label="Seller" value={form.sellerName} onChange={(v) => setForm({ ...form, sellerName: v })} />
            <Input label="Title company" value={form.titleCompany} onChange={(v) => setForm({ ...form, titleCompany: v })} />
            <Input label="Lender" value={form.lenderName} onChange={(v) => setForm({ ...form, lenderName: v })} />
          </Section>

          <Section title="Timeline">
            <Input label="Effective date" type="date" value={form.effectiveDate} onChange={(v) => setForm({ ...form, effectiveDate: v })} />
            <Input label="Earnest money due" type="date" value={form.earnestMoneyDueDate} onChange={(v) => setForm({ ...form, earnestMoneyDueDate: v })} />
            <Input label="Inspection deadline" type="date" value={form.inspectionDeadline} onChange={(v) => setForm({ ...form, inspectionDeadline: v })} />
            <Input label="Inspection objection" type="date" value={form.inspectionObjectionDeadline} onChange={(v) => setForm({ ...form, inspectionObjectionDeadline: v })} />
            <Input label="Title commitment deadline" type="date" value={form.titleCommitmentDeadline} onChange={(v) => setForm({ ...form, titleCommitmentDeadline: v })} />
            <Input label="Title objection deadline" type="date" value={form.titleObjectionDeadline} onChange={(v) => setForm({ ...form, titleObjectionDeadline: v })} />
            <Input label="Financing deadline" type="date" value={form.financingDeadline} onChange={(v) => setForm({ ...form, financingDeadline: v })} />
            <Input label="Final walkthrough" type="date" value={form.walkthroughDate} onChange={(v) => setForm({ ...form, walkthroughDate: v })} />
            <Input label="Estimated closing" type="date" value={form.closingDate} onChange={(v) => setForm({ ...form, closingDate: v })} />
            <Input label="Possession" type="date" value={form.possessionDate} onChange={(v) => setForm({ ...form, possessionDate: v })} />
          </Section>

          <Section title="Money">
            <MoneyInput label="Purchase price" value={form.purchasePrice} onChange={(v) => setForm({ ...form, purchasePrice: v })} />
            <MoneyInput label="Earnest money amount" value={form.earnestMoneyAmount} onChange={(v) => setForm({ ...form, earnestMoneyAmount: v })} />
            <Input label="Seller-side commission %" value={form.sellerSideCommissionPct} placeholder="e.g. 0.03 for 3%" onChange={(v) => setForm({ ...form, sellerSideCommissionPct: v })} />
            <MoneyInput label="Seller-side commission $" value={form.sellerSideCommissionAmount} onChange={(v) => setForm({ ...form, sellerSideCommissionAmount: v })} />
            <Input label="Buyer-side commission %" value={form.buyerSideCommissionPct} placeholder="e.g. 0.025 for 2.5%" onChange={(v) => setForm({ ...form, buyerSideCommissionPct: v })} />
            <MoneyInput label="Buyer-side commission $" value={form.buyerSideCommissionAmount} onChange={(v) => setForm({ ...form, buyerSideCommissionAmount: v })} />
          </Section>

          {extraction?.notes && (
            <div className="rounded border border-border bg-surface-2 px-3 py-2 text-xs italic text-text-muted">
              Atlas note: {extraction.notes}
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={create}
              disabled={busy || !form.address.trim()}
              className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-50"
            >
              <Plus className="h-4 w-4" strokeWidth={2.5} />
              {busy ? "Creating…" : "Create transaction"}
            </button>
            <button
              type="button"
              onClick={() => { setStep("setup"); setErr(null); }}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-muted hover:border-border-strong hover:text-text"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Back
            </button>
          </div>
        </div>
      )}

      {err && (
        <div className="mt-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200">
          {err}
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">{title}</div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </div>
  );
}

function Input({
  label, value, onChange, type = "text", required, placeholder, className,
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
