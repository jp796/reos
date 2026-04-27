"use client";

/**
 * Rezen compliance prep panel.
 *
 * Shows the per-slot status (Purchase Contract, Agency Disclosure,
 * Settlement Statement, …), what REOS document fills each slot,
 * and the suggested filename for upload to Rezen. A "Download
 * Rezen package" button streams a ZIP of every present doc with
 * the right filenames + a coverage report — drag-drop into the
 * Rezen file UI and it's done.
 *
 * This is Layer 1 of the Rezen-bridge plan. Layer 2 (Playwright
 * bot) will reuse the same prep report to drive uploads.
 */

import { useEffect, useState } from "react";
import {
  Check,
  Download,
  FileWarning,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { Hint } from "@/app/components/Hint";

interface Item {
  requirement: { key: string; label: string; detail?: string; stage?: string };
  status: "present" | "missing";
  matches: Array<{ id: string; fileName: string; source: string }>;
  rezenFilename: string | null;
  order: number;
}

interface Report {
  items: Item[];
  presentCount: number;
  missingCount: number;
  coverage: number;
}

export function RezenCompliancePrepPanel({
  transactionId,
}: {
  transactionId: string;
}) {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let done = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/transactions/${transactionId}/compliance-prep`,
        );
        const data = await res.json();
        if (!done) {
          if (!res.ok) setErr(data.error ?? res.statusText);
          else setReport(data);
        }
      } catch (e) {
        if (!done) setErr(e instanceof Error ? e.message : "load failed");
      } finally {
        if (!done) setLoading(false);
      }
    })();
    return () => {
      done = true;
    };
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
      <section className="mt-6 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Couldn&rsquo;t load Rezen prep: {err}
      </section>
    );
  }
  if (!report) return null;

  const pct = Math.round(report.coverage * 100);
  const allPresent = report.missingCount === 0;

  return (
    <section className="mt-6 rounded-md border border-border bg-surface p-4">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-medium">
          <ShieldCheck className="h-4 w-4 text-text-muted" strokeWidth={1.8} />
          Rezen prep
          <span className="ml-2 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-normal text-text-muted">
            {report.presentCount}/{report.presentCount + report.missingCount} ·{" "}
            {pct}%
          </span>
        </h2>
        <Hint label="Download a ZIP of every present doc, renamed to Rezen's filename convention. Drag into Rezen's file area to upload all at once.">
          <a
            href={`/api/transactions/${transactionId}/compliance-prep/bundle`}
            className={
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium " +
              (allPresent
                ? "bg-brand-600 text-white hover:bg-brand-500"
                : "border border-border bg-surface text-text hover:border-brand-500")
            }
          >
            <Download className="h-3.5 w-3.5" strokeWidth={2} />
            Download Rezen package
          </a>
        </Hint>
      </header>

      {/* Progress bar */}
      <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
        <div
          className={
            "h-full transition-all " +
            (allPresent ? "bg-emerald-500" : pct >= 60 ? "bg-amber-500" : "bg-red-500")
          }
          style={{ width: `${pct}%` }}
        />
      </div>

      <ul className="space-y-1.5 text-sm">
        {report.items.map((item) => (
          <li
            key={item.requirement.key}
            className={
              "flex items-start gap-2 rounded-md border px-3 py-2 " +
              (item.status === "present"
                ? "border-emerald-200 bg-emerald-50/40 dark:border-emerald-900 dark:bg-emerald-950/30"
                : "border-amber-200 bg-amber-50/40 dark:border-amber-900 dark:bg-amber-950/30")
            }
          >
            {item.status === "present" ? (
              <Check
                className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600"
                strokeWidth={2}
              />
            ) : (
              <FileWarning
                className="mt-0.5 h-4 w-4 shrink-0 text-amber-600"
                strokeWidth={2}
              />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-medium text-text">
                  {item.requirement.label}
                </span>
                {item.rezenFilename && (
                  <span className="font-mono text-[11px] text-text-muted">
                    → {item.rezenFilename}
                  </span>
                )}
              </div>
              {item.status === "present" && item.matches[0] && (
                <div className="mt-0.5 truncate text-xs text-text-muted">
                  matched: <span className="font-mono">{item.matches[0].fileName}</span>{" "}
                  · {item.matches[0].source}
                </div>
              )}
              {item.status === "missing" && item.requirement.detail && (
                <div className="mt-0.5 text-xs text-text-muted">
                  {item.requirement.detail}
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
