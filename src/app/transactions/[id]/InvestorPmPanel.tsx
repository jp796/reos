"use client";

/**
 * InvestorPmPanel — the transaction↔project state machine on the deal page.
 *
 * Shows the deal's workflow type (with a non-destructive reclassify control),
 * and, for flip / wholetail / rental deals:
 *   - a "Convert to Project" action once the acquisition transaction is closed
 *     (creates the make-ready/rehab/lease-up timeline);
 *   - the project timeline (phases + tasks + due dates, flagging any that fall
 *     outside the holding window);
 *   - a "Revert to transaction" action (non-destructive);
 *   - the disposition transaction + its dual-income ledger once the project
 *     completes.
 *
 * Data comes from GET /api/assets/:id/project; actions hit the POST routes.
 */

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "../../ToastProvider";

interface Task {
  id: string;
  title: string;
  stageKey: string | null;
  dueAt: string | null;
  completedAt: string | null;
  isListItTask: boolean;
  dueDateOutOfWindow: boolean;
  priority: string;
}
interface ProjectState {
  strategy: string;
  titlePath: string | null;
  representation: string;
  workflowLabel: string;
  hasProjectPhase: boolean;
  acquisitionClosed: boolean;
  project: {
    id: string;
    type: string;
    status: string;
    projectTemplateKey: string | null;
    startedAt: string | null;
    targetCompletionAt: string | null;
    completedAt: string | null;
    dispositionTransactionId: string | null;
    fundingSourceJson: Record<string, unknown> | null;
    tasks: Task[];
    drawSchedules: {
      id: string;
      totalBudget: number | null;
      retainagePercent: number | null;
      status: string;
      draws: { id: string; amount: number; status: string }[];
    }[];
  } | null;
  dispositionTransaction: {
    id: string;
    status: string;
    pipelineName: string | null;
    stageName: string | null;
    dispositionIncomeJson: Record<string, unknown> | null;
  } | null;
}

const STRATEGY_OPTIONS: { value: string; label: string }[] = [
  { value: "flip", label: "Flip" },
  { value: "wholetail", label: "Wholetail" },
  { value: "rental_brrrr", label: "Rental / BRRRR" },
  { value: "wholesale", label: "Wholesale (assignment)" },
  { value: "creative", label: "Creative finance" },
  { value: "retail", label: "Retail (agency)" },
];

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function fmtMoney(v: unknown): string {
  return typeof v === "number" ? `$${v.toLocaleString()}` : "—";
}

export function InvestorPmPanel({ assetId }: { assetId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [state, setState] = useState<ProjectState | null>(null);
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  async function load() {
    try {
      const res = await fetch(`/api/assets/${assetId}/project`);
      if (res.ok) setState(await res.json());
    } catch {
      /* ignore */
    }
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetId]);

  async function act(path: string, body: unknown, okMsg: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/assets/${assetId}/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "failed");
      toast.success(okMsg);
      await load();
      startTransition(() => router.refresh());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  if (!state || state.representation !== "principal") return null;

  const p = state.project;
  const projectActive = p?.status === "active";
  const canConvert = state.hasProjectPhase && state.acquisitionClosed && !projectActive && !state.dispositionTransaction;
  const flaggedCount = p?.tasks.filter((t) => t.dueDateOutOfWindow).length ?? 0;

  // Group project tasks by phase (stageKey), list-it last.
  const phases = new Map<string, Task[]>();
  for (const t of p?.tasks ?? []) {
    const k = t.isListItTask ? "__list_it__" : t.stageKey ?? "other";
    if (!phases.has(k)) phases.set(k, []);
    phases.get(k)!.push(t);
  }

  return (
    <section className="mt-8 rounded-lg border border-border bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-medium text-text">Investor lifecycle</h2>
          <p className="mt-0.5 text-sm text-text-muted">
            {state.workflowLabel}
            {" · "}
            {projectActive ? "Project phase" : state.dispositionTransaction ? "Disposition" : "Transaction phase"}
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs text-text-muted">
          Deal type
          <select
            value={state.strategy}
            disabled={busy}
            onChange={(e) =>
              act("reclassify", { strategy: e.target.value }, `Reclassified to ${e.target.value} (nothing lost)`)
            }
            className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-text"
          >
            {STRATEGY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
      </div>

      {/* Convert / revert controls */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {canConvert && (
          <button
            type="button"
            disabled={busy}
            onClick={() => act("convert-to-project", {}, "Converted to a project — timeline created")}
            className="rounded-md bg-brand-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            Convert to Project
          </button>
        )}
        {projectActive && (
          <button
            type="button"
            disabled={busy}
            onClick={() => act("revert-project", {}, "Reverted to transaction (project archived, nothing deleted)")}
            className="rounded-md border border-border bg-surface px-3.5 py-2 text-sm text-text hover:border-brand-500 disabled:opacity-50"
          >
            Revert to transaction
          </button>
        )}
        {state.hasProjectPhase && !state.acquisitionClosed && !projectActive && (
          <span className="text-xs text-text-muted">Converts to a project automatically once you can confirm after the acquisition closes.</span>
        )}
        {!state.hasProjectPhase && (
          <span className="text-xs text-text-muted">This workflow keeps its disposition work inside the single transaction (no separate project).</span>
        )}
      </div>

      {/* Project timeline */}
      {p && p.tasks.length > 0 && (
        <div className="mt-5">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <h3 className="text-sm font-semibold text-text">Project timeline</h3>
            <span className="text-xs text-text-muted">
              {fmtDate(p.startedAt)} → {fmtDate(p.targetCompletionAt)}
              {flaggedCount > 0 && (
                <span className="ml-2 text-amber-600">⚠ {flaggedCount} outside window</span>
              )}
            </span>
          </div>
          <ul className="space-y-1.5">
            {[...phases.entries()].map(([phaseKey, tasks]) => (
              <li key={phaseKey}>
                <div className="mt-2 text-[11px] font-medium uppercase tracking-wide text-text-muted">
                  {phaseKey === "__list_it__" ? "Disposition trigger" : phaseKey.replace(/_/g, " ")}
                </div>
                {tasks.map((t) => (
                  <div key={t.id} className="flex items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-1.5 text-sm">
                    <span className={`truncate ${t.completedAt ? "text-text-muted line-through" : "text-text"}`}>
                      {t.isListItTask ? "🏁 " : ""}{t.title}
                    </span>
                    <span className={`shrink-0 text-xs ${t.dueDateOutOfWindow ? "text-amber-600" : "text-text-muted"}`}>
                      {t.completedAt ? "done" : fmtDate(t.dueAt)}
                      {t.dueDateOutOfWindow ? " ⚠" : ""}
                    </span>
                  </div>
                ))}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Funding source + draws (FLAG 4) */}
      {p && (p.fundingSourceJson || p.drawSchedules.length > 0) && (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {p.fundingSourceJson && (
            <div className="rounded-md border border-border/60 p-3">
              <div className="text-[11px] uppercase tracking-wide text-text-muted">Project funding source</div>
              <div className="mt-0.5 text-sm text-text">
                {String(p.fundingSourceJson.type ?? "—").replace(/_/g, " ")}
                {typeof p.fundingSourceJson.amount === "number" ? ` · ${fmtMoney(p.fundingSourceJson.amount)}` : ""}
                {typeof p.fundingSourceJson.rate === "number" ? ` · ${p.fundingSourceJson.rate}%` : ""}
              </div>
            </div>
          )}
          {p.drawSchedules.length > 0 && (
            <div className="rounded-md border border-border/60 p-3">
              <div className="text-[11px] uppercase tracking-wide text-text-muted">Rehab draws</div>
              <div className="mt-0.5 text-sm text-text">
                {p.drawSchedules.reduce((n, s) => n + s.draws.length, 0)} draw(s)
                {p.drawSchedules[0]?.totalBudget != null ? ` · budget ${fmtMoney(p.drawSchedules[0].totalBudget)}` : ""}
                {p.drawSchedules[0]?.retainagePercent != null ? ` · ${p.drawSchedules[0].retainagePercent}% retainage` : ""}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Disposition — dual income pipeline */}
      {state.dispositionTransaction && (
        <div className="mt-5 rounded-md border border-brand-200 bg-brand-50 p-4 dark:bg-brand-950/30">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-text">Disposition pipeline</h3>
            <a href={`/transactions/${state.dispositionTransaction.id}`} className="text-xs font-medium text-brand-700 hover:underline">
              Open disposition deal →
            </a>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-text-muted">Investment return</div>
              <div className="text-text">{fmtMoney(state.dispositionTransaction.dispositionIncomeJson?.investmentReturn)}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-text-muted">Realtor commission</div>
              <div className="text-text">{fmtMoney(state.dispositionTransaction.dispositionIncomeJson?.realtorCommission)}</div>
            </div>
          </div>
          <p className="mt-2 text-xs text-text-muted">
            {state.dispositionTransaction.stageName ?? state.dispositionTransaction.status} · investment P&amp;L and agency commission tracked separately.
          </p>
        </div>
      )}
    </section>
  );
}
