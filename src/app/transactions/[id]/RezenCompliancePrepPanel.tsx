"use client";

/**
 * Rezen compliance prep panel.
 *
 * Mirrors Rezen's actual checklists 1:1 (Transaction = 34 items,
 * Listing = 14 items). Renders one or both depending on the
 * transaction side:
 *   - buy / null   → Transaction only
 *   - sell         → Listing only
 *   - both (dual)  → Both, side by side
 *
 * "Download Rezen package" streams a ZIP with renamed PDFs (and
 * Transaction/ + Listing/ subfolders when both apply) plus a
 * COMPLIANCE_REPORT.txt — drag into Rezen and slots line up.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  Download,
  FileWarning,
  Loader2,
  PenLine,
  Pin,
  Send,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useToast } from "@/app/ToastProvider";
import { Hint } from "@/app/components/Hint";

interface SlotItem {
  slot: {
    number: number;
    key: string;
    label: string;
    required: "required" | "if_applicable";
    tag?: "cda" | "closing_docs" | "termination";
    requiredFor?: string;
  };
  status: "present" | "missing";
  matches: Array<{
    id: string;
    fileName: string;
    source: string;
    pinned: boolean;
    signatureStatus: string | null;
    signatureNotes: string | null;
  }>;
  rezenFilename: string | null;
}

interface Report {
  kind: "transaction" | "listing";
  items: SlotItem[];
  presentCount: number;
  totalCount: number;
  requiredMissing: number;
  coverage: number;
}

interface ApiResponse {
  transaction: Report | null;
  listing: Report | null;
}

interface RezenPlanRow {
  fileName: string;
  slotLabel: string;
  rezenItem: string | null;
  rezenItemId: string | null;
  signatureStatus: string | null;
  willPush: boolean;
  reason: string;
}

export function RezenCompliancePrepPanel({
  transactionId,
  rezenTransactionId,
  rezenConnected,
}: {
  transactionId: string;
  rezenTransactionId?: string | null;
  rezenConnected?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [classifying, setClassifying] = useState(false);
  const [sigScanning, setSigScanning] = useState(false);
  const [rezenId, setRezenId] = useState(rezenTransactionId ?? "");
  const [savingId, setSavingId] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [plan, setPlan] = useState<RezenPlanRow[] | null>(null);
  const [markComplete, setMarkComplete] = useState(false);

  async function saveRezenId() {
    setSavingId(true);
    try {
      const res = await fetch(`/api/transactions/${transactionId}/edit`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rezenTransactionId: rezenId.trim() || null }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        toast.error("Couldn't save", (b as { error?: string }).error ?? res.statusText);
        return;
      }
      toast.success("Rezen ID saved");
      router.refresh();
    } catch (e) {
      toast.error("Save errored", e instanceof Error ? e.message : "unknown");
    } finally {
      setSavingId(false);
    }
  }

  /** Dry-run: ask the server what it WOULD push, show the plan. */
  async function previewPush() {
    setPushing(true);
    setPlan(null);
    try {
      const res = await fetch(`/api/transactions/${transactionId}/send-to-rezen`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dryRun: true, requireSigned: true }),
      });
      const b = (await res.json()) as {
        ok?: boolean;
        plan?: RezenPlanRow[];
        rezenItemCount?: number;
        error?: string;
      };
      if (!res.ok || !b.ok) {
        toast.error("Couldn't build plan", b.error ?? res.statusText);
        return;
      }
      setPlan(b.plan ?? []);
      toast.info(
        "Push plan ready",
        `${(b.plan ?? []).filter((p) => p.willPush).length} of ${b.plan?.length ?? 0} docs match a Rezen item.`,
      );
    } catch (e) {
      toast.error("Plan errored", e instanceof Error ? e.message : "unknown");
    } finally {
      setPushing(false);
    }
  }

  /** Live push of everything in the plan that willPush. */
  async function confirmPush() {
    setPushing(true);
    try {
      const res = await fetch(`/api/transactions/${transactionId}/send-to-rezen`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dryRun: false, requireSigned: true, markComplete }),
      });
      const b = (await res.json()) as {
        ok?: boolean;
        pushed?: number;
        skipped?: number;
        errored?: number;
        error?: string;
        needsReconnect?: boolean;
      };
      if (!res.ok || !b.ok) {
        toast.error(
          b.needsReconnect ? "Reconnect Real" : "Push failed",
          b.error ?? res.statusText,
        );
        return;
      }
      toast.success(
        "Sent to Rezen",
        `${b.pushed ?? 0} pushed · ${b.skipped ?? 0} skipped · ${b.errored ?? 0} errored`,
      );
      setPlan(null);
      router.refresh();
    } catch (e) {
      toast.error("Push errored", e instanceof Error ? e.message : "unknown");
    } finally {
      setPushing(false);
    }
  }

  /** "Scanned for signatures" tracker — runs the GPT-4o vision scan
   *  over every unscanned PDF (loops while the server reports more).
   *  force=true re-scans everything (e.g. after re-signing). */
  async function scanSignaturesAll(force: boolean) {
    setSigScanning(true);
    try {
      let scanned = 0;
      let safety = 10;
      while (safety-- > 0) {
        const res = await fetch(
          `/api/transactions/${transactionId}/scan-signatures`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ force: force && safety === 9 ? true : false }),
          },
        );
        const bodyJson = (await res.json()) as {
          ok?: boolean;
          scanned: number;
          remaining: number;
          error?: string;
        };
        if (!res.ok || !bodyJson.ok) {
          toast.error("Signature scan failed", bodyJson.error ?? res.statusText);
          return;
        }
        scanned += bodyJson.scanned;
        if (!bodyJson.remaining) break;
      }
      toast.success(
        "Signature scan done",
        scanned === 0
          ? "All PDFs already scanned — use force-rescan after re-signing."
          : `${scanned} document${scanned === 1 ? "" : "s"} checked.`,
      );
      await reload();
    } catch (e) {
      toast.error(
        "Signature scan errored",
        e instanceof Error ? e.message : "unknown",
      );
    } finally {
      setSigScanning(false);
    }
  }

  async function reload() {
    const res = await fetch(`/api/transactions/${transactionId}/compliance-prep`);
    const body = await res.json();
    if (!res.ok) setErr(body.error ?? res.statusText);
    else {
      setErr(null);
      setData(body);
    }
  }

  async function classifyAll(force: boolean) {
    setClassifying(true);
    try {
      let total = { classified: 0, nullified: 0, errored: 0 };
      let safety = 10;
      // Loop while the server says hasMore — paginates ~25 docs/call.
      // Cap at 10 iterations (250 docs) so a runaway can't burn budget.
      while (safety-- > 0) {
        const res = await fetch(
          `/api/transactions/${transactionId}/classify-docs`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ force }),
          },
        );
        const body = (await res.json()) as {
          ok?: boolean;
          classified: number;
          nullified: number;
          errored: number;
          hasMore: boolean;
          error?: string;
        };
        if (!res.ok || !body.ok) {
          toast.error(
            "Classification failed",
            body.error ?? res.statusText,
          );
          return;
        }
        total.classified += body.classified;
        total.nullified += body.nullified;
        total.errored += body.errored;
        if (!body.hasMore) break;
      }
      toast.success(
        "AI classification done",
        `${total.classified} matched · ${total.nullified} unrelated · ${total.errored} errored`,
      );
      await reload();
    } catch (e) {
      toast.error(
        "Classification failed",
        e instanceof Error ? e.message : "unknown",
      );
    } finally {
      setClassifying(false);
    }
  }

  useEffect(() => {
    let done = false;
    (async () => {
      try {
        await reload();
      } catch (e) {
        if (!done) setErr(e instanceof Error ? e.message : "load failed");
      } finally {
        if (!done) setLoading(false);
      }
    })();
    return () => {
      done = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactionId]);

  if (loading) {
    return (
      <section className="mt-6 rounded-md border border-border bg-surface p-4 text-sm text-text-muted">
        <Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin" />
        Reading compliance coverage…
      </section>
    );
  }
  if (err) {
    return (
      <section className="mt-6 rounded-md border border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-950/40 p-4 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200">
        Couldn&rsquo;t load Rezen prep: {err}
      </section>
    );
  }
  if (!data || (!data.transaction && !data.listing)) return null;

  const reports: Report[] = [];
  if (data.transaction) reports.push(data.transaction);
  if (data.listing) reports.push(data.listing);

  // Aggregate stats across whichever checklists apply.
  const totalRequiredMissing = reports.reduce(
    (s, r) => s + r.requiredMissing,
    0,
  );

  return (
    <section className="mt-6 rounded-md border border-border bg-surface p-4">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-medium">
          <ShieldCheck className="h-4 w-4 text-text-muted" strokeWidth={1.8} />
          Rezen prep
          {totalRequiredMissing > 0 && (
            <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700 dark:bg-red-950 dark:text-red-200">
              {totalRequiredMissing} required missing
            </span>
          )}
        </h2>
        <div className="flex items-center gap-1.5">
          <Hint label="Run AI on each PDF to classify which Rezen slot it fills. Catches docs whose filenames don't match keywords (e.g. 'Document_2026.pdf' that's actually an Earnest Money Receipt).">
            <button
              type="button"
              onClick={() => classifyAll(false)}
              disabled={classifying}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium text-text hover:border-brand-500 disabled:opacity-50"
            >
              <Sparkles className="h-3.5 w-3.5" strokeWidth={2} />
              {classifying ? "Classifying…" : "Classify with AI"}
            </button>
          </Hint>
          <Hint label="AI vision pass over the LAST pages of every PDF — where signature blocks live. Marks each doc Signed / Partial / Unsigned so you know what's executed before it goes to Rezen. ~2¢/doc.">
            <button
              type="button"
              onClick={() => scanSignaturesAll(false)}
              disabled={sigScanning}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium text-text hover:border-brand-500 disabled:opacity-50"
            >
              <PenLine className="h-3.5 w-3.5" strokeWidth={2} />
              {sigScanning ? "Scanning…" : "Scan for signatures"}
            </button>
          </Hint>
          <Hint label="Download a ZIP of every present doc, renamed to Rezen's filename convention. Drag each subfolder into Rezen's file area to upload all at once.">
            <a
              href={`/api/transactions/${transactionId}/compliance-prep/bundle`}
              className={
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium " +
                (totalRequiredMissing === 0
                  ? "bg-brand-600 text-white hover:bg-brand-500"
                  : "border border-border bg-surface text-text hover:border-brand-500")
              }
            >
              <Download className="h-3.5 w-3.5" strokeWidth={2} />
              Download Rezen package
            </a>
          </Hint>
          <Hint label="Push present, signed documents straight into the matching Rezen checklist items. Shows a preview plan first — nothing uploads until you confirm.">
            <button
              type="button"
              onClick={previewPush}
              disabled={pushing || !rezenConnected || !rezenTransactionId}
              className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-500 disabled:opacity-50"
              title={
                !rezenConnected
                  ? "Connect Real in Settings → Integrations first"
                  : !rezenTransactionId
                    ? "Paste the Rezen transaction ID below first"
                    : "Preview the push into Rezen"
              }
            >
              <Send className="h-3.5 w-3.5" strokeWidth={2} />
              {pushing ? "Working…" : "Send to Rezen"}
            </button>
          </Hint>
        </div>
      </header>

      {/* Rezen link + connection status row */}
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-dashed border-border bg-surface-2/40 px-3 py-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-text-muted">
          Rezen link
        </span>
        <input
          value={rezenId}
          onChange={(e) => setRezenId(e.target.value)}
          placeholder="Paste Rezen transaction ID or Bolt URL"
          className="min-w-0 flex-1 rounded border border-border bg-surface px-2 py-1 text-xs"
        />
        <button
          type="button"
          onClick={saveRezenId}
          disabled={savingId || rezenId.trim() === (rezenTransactionId ?? "")}
          className="rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-medium text-text hover:border-brand-500 disabled:opacity-50"
        >
          {savingId ? "Saving…" : "Save"}
        </button>
        <span
          className={
            "text-[11px] " +
            (rezenConnected ? "text-emerald-700" : "text-text-subtle")
          }
        >
          {rezenConnected ? "● Real connected" : "○ Real not connected"}
        </span>
      </div>

      {/* Push plan (dry-run result) */}
      {plan && (
        <div className="mb-3 rounded-md border border-brand-200 bg-brand-50/40 p-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold text-text">
              Push plan — {plan.filter((p) => p.willPush).length} of {plan.length} will upload
            </h3>
            <button
              type="button"
              onClick={() => setPlan(null)}
              className="text-xs text-text-muted hover:text-text"
            >
              Cancel
            </button>
          </div>
          <ul className="space-y-1 text-xs">
            {plan.map((p, i) => (
              <li key={i} className="flex items-center gap-2">
                {p.willPush ? (
                  <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" strokeWidth={2} />
                ) : (
                  <FileWarning className="h-3.5 w-3.5 shrink-0 text-text-subtle" strokeWidth={2} />
                )}
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{p.slotLabel}</span>
                  <span className="ml-1 text-text-subtle">← {p.fileName}</span>
                </span>
                <span className="shrink-0 text-text-muted">
                  {p.willPush
                    ? `→ ${p.rezenItem}`
                    : p.reason === "unsigned_blocked"
                      ? "unsigned — blocked"
                      : "no Rezen item"}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex items-center justify-between gap-3">
            <label className="flex items-center gap-1.5 text-xs text-text-muted">
              <input
                type="checkbox"
                checked={markComplete}
                onChange={(e) => setMarkComplete(e.target.checked)}
              />
              Mark items complete after upload
            </label>
            <button
              type="button"
              onClick={confirmPush}
              disabled={pushing || plan.filter((p) => p.willPush).length === 0}
              className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-500 disabled:opacity-50"
            >
              <Send className="h-3.5 w-3.5" strokeWidth={2} />
              {pushing
                ? "Pushing…"
                : `Confirm push (${plan.filter((p) => p.willPush).length})`}
            </button>
          </div>
        </div>
      )}

      <div className={reports.length > 1 ? "grid gap-4 md:grid-cols-2" : ""}>
        {reports.map((report) => (
          <ChecklistColumn key={report.kind} report={report} />
        ))}
      </div>
    </section>
  );
}

function ChecklistColumn({ report }: { report: Report }) {
  const pct = Math.round(report.coverage * 100);
  const allDone = report.requiredMissing === 0;
  const heading =
    report.kind === "listing" ? "Listing checklist" : "Transaction checklist";

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
          {heading}
        </h3>
        <span className="text-[11px] text-text-muted">
          {report.presentCount}/{report.totalCount} · {pct}%
        </span>
      </div>
      <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
        <div
          className={
            "h-full transition-all " +
            (allDone
              ? "bg-emerald-500"
              : pct >= 60
                ? "bg-amber-500"
                : "bg-red-500")
          }
          style={{ width: `${pct}%` }}
        />
      </div>
      <ul className="space-y-1.5 text-sm">
        {report.items.map((item) => (
          <SlotRow key={item.slot.key} item={item} />
        ))}
      </ul>
    </div>
  );
}

function SlotRow({ item }: { item: SlotItem }) {
  const isRequired = item.slot.required === "required";
  const tone =
    item.status === "present"
      ? "border-emerald-200 bg-emerald-50/40 dark:border-emerald-900 dark:bg-emerald-950/30"
      : isRequired
        ? "border-red-200 bg-red-50/40 dark:border-red-900 dark:bg-red-950/30"
        : "border-border bg-surface-2/40";
  return (
    <li className={"flex items-start gap-2 rounded-md border px-3 py-2 " + tone}>
      {item.status === "present" ? (
        <Check
          className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600"
          strokeWidth={2}
        />
      ) : (
        <FileWarning
          className={
            "mt-0.5 h-4 w-4 shrink-0 " +
            (isRequired ? "text-red-600" : "text-text-subtle")
          }
          strokeWidth={2}
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-1.5">
          <span className="text-[11px] font-mono text-text-subtle">
            {item.slot.number}.
          </span>
          <span className="font-medium text-text">{item.slot.label}</span>
          {item.slot.tag && (
            <span className="rounded bg-surface px-1.5 py-0.5 text-[10px] font-medium uppercase text-text-muted ring-1 ring-border">
              {item.slot.tag.replace(/_/g, " ")}
            </span>
          )}
          {!isRequired && item.status === "missing" && (
            <span className="text-[10px] text-text-subtle">if applic.</span>
          )}
          {isRequired && item.status === "missing" && (
            <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-red-700 dark:bg-red-950 dark:text-red-200">
              required
            </span>
          )}
        </div>
        {item.status === "present" && item.matches[0] && (
          <div className="mt-0.5 text-xs text-text-muted">
            <div className="truncate">
              <span className="font-mono">→ {item.rezenFilename}</span>
              <span className="ml-2 text-text-subtle">
                from {item.matches[0].fileName} · {item.matches[0].source}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {item.matches[0].pinned && (
                <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-1.5 py-0.5 text-[10px] font-medium text-brand-700 ring-1 ring-brand-200">
                  <Pin className="h-2.5 w-2.5" strokeWidth={2.5} />
                  pinned
                </span>
              )}
              <SignatureBadge
                status={item.matches[0].signatureStatus}
                notes={item.matches[0].signatureNotes}
              />
            </div>
          </div>
        )}
        {item.slot.requiredFor && (
          <div className="mt-0.5 text-[11px] text-text-subtle">
            required for: {item.slot.requiredFor}
          </div>
        )}
      </div>
    </li>
  );
}

/** Signed / Partial / Unsigned / no-blocks / not-scanned chip. The
 *  "Scanned for signatures" tracker readout — answers "is this doc
 *  executed?" at a glance, per checklist item. */
function SignatureBadge({
  status,
  notes,
}: {
  status: string | null;
  notes: string | null;
}) {
  if (!status) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-surface px-1.5 py-0.5 text-[10px] text-text-subtle ring-1 ring-border">
        <PenLine className="h-2.5 w-2.5" strokeWidth={2} />
        not scanned
      </span>
    );
  }
  const map: Record<string, { label: string; cls: string }> = {
    signed: {
      label: "✓ signed",
      cls: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-200 dark:ring-emerald-900",
    },
    partial: {
      label: "partial signatures",
      cls: "bg-amber-50 text-amber-800 ring-amber-300 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-900",
    },
    unsigned: {
      label: "✗ unsigned",
      cls: "bg-red-50 text-red-700 ring-red-200 dark:bg-red-950 dark:text-red-200 dark:ring-red-900",
    },
    no_signature_blocks: {
      label: "no signature lines",
      cls: "bg-surface text-text-subtle ring-border",
    },
  };
  const m = map[status] ?? map.no_signature_blocks;
  const chip = (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ring-1 ${m.cls}`}
    >
      <PenLine className="h-2.5 w-2.5" strokeWidth={2} />
      {m.label}
    </span>
  );
  return notes ? <Hint label={notes}>{chip}</Hint> : chip;
}
