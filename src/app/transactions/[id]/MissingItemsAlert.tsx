/**
 * MissingItemsAlert
 *
 * One-glance compliance status: red banner if any required docs are
 * missing, green pill when the file is complete. Lives directly above
 * AISummaryPanel so a TC sees the alert without scrolling.
 *
 * The full audit (per-row coverage with matched filenames) lives in
 * CompliancePanel further down the page — this component links into
 * it via #compliance-audit. We deliberately don't repeat the full
 * grid here; the alert exists to draw attention, not duplicate UI.
 *
 * Server-rendered: parent page calls auditTransactionCompliance() and
 * passes the result in. No client fetch, no spinner — the alert is
 * accurate the moment the page loads.
 *
 * Hidden when total === 0 (rare — brokerage profile has no required
 * items for this side+state combination).
 */

import { AlertCircle, CheckCircle2 } from "lucide-react";

const STAGE_LABELS: Record<string, string> = {
  before_contract: "Before contract",
  under_contract: "Under contract",
  before_close: "Before close",
  post_close: "Post close",
};

interface MissingItem {
  /** Stable key from ComplianceRequirement — used for React list key. */
  key: string;
  /** Human-readable label, e.g. "Lead-based paint disclosure". */
  label: string;
  /** Optional stage tag (e.g. "before_close") — surfaces urgency. */
  stage?: string;
}

export function MissingItemsAlert({
  missing,
  total,
  topMissing,
}: {
  missing: number;
  total: number;
  /** Up to 3 highest-urgency missing items. The full list lives in
   * CompliancePanel — we cap at 3 here so the alert stays scannable. */
  topMissing: MissingItem[];
}) {
  if (total === 0) return null;

  // Empty-state — green completion pill. Subtle, doesn't compete for
  // attention with anything else on the page.
  if (missing === 0) {
    return (
      <section className="mt-6 flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
        <CheckCircle2 className="h-4 w-4 flex-none" aria-hidden="true" />
        <span>
          <span className="font-medium">Compliance audit complete</span>
          <span className="ml-1 opacity-70">
            · {total}/{total} items present
          </span>
        </span>
      </section>
    );
  }

  // Missing-state — red banner. The visual weight matches the risk
  // panel further down so it reads as "actionable alert" not chrome.
  return (
    <section className="mt-6 rounded-md border border-red-300 bg-red-50 p-4">
      <div className="flex items-start gap-3">
        <AlertCircle
          className="mt-0.5 h-5 w-5 flex-none text-red-600"
          aria-hidden="true"
        />
        <div className="flex-1">
          <div className="flex items-center justify-between">
            <div className="font-display text-sm font-semibold text-red-900">
              {missing} {missing === 1 ? "item" : "items"} missing for
              compliance
            </div>
            <a
              href="#compliance-audit"
              className="text-xs font-medium text-red-700 underline hover:text-red-800"
            >
              View full audit ↓
            </a>
          </div>
          <ul className="mt-2 space-y-1 text-sm text-red-800">
            {topMissing.slice(0, 3).map((it) => (
              <li key={it.key} className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 flex-none rounded-full bg-red-500" />
                <span>{it.label}</span>
                {it.stage && STAGE_LABELS[it.stage] && (
                  <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-red-700">
                    {STAGE_LABELS[it.stage]}
                  </span>
                )}
              </li>
            ))}
            {missing > 3 && (
              <li className="pl-3.5 text-xs text-red-700">
                + {missing - 3} more
              </li>
            )}
          </ul>
        </div>
      </div>
    </section>
  );
}
