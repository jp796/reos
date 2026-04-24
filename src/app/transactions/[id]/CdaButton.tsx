"use client";

/**
 * One-click Commission Disbursement Authorization download.
 *
 * Opens the CDA PDF in a new tab (so the user can review before
 * downloading / attaching to title email). No server-side state
 * change — the endpoint is idempotent GET.
 *
 * Disabled state when the transaction has no financials yet (can't
 * generate a CDA without at least a gross commission number).
 */

import { FileSignature } from "lucide-react";

export function CdaButton({
  transactionId,
  enabled,
}: {
  transactionId: string;
  /** Usually `!!financials?.grossCommission`. When false, button is
   * shown but disabled with a tooltip explaining why. */
  enabled: boolean;
}) {
  const href = `/api/transactions/${transactionId}/cda`;
  return (
    <a
      href={enabled ? href : undefined}
      target="_blank"
      rel="noreferrer"
      aria-disabled={!enabled}
      onClick={(e) => {
        if (!enabled) e.preventDefault();
      }}
      className={
        "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors " +
        (enabled
          ? "border-border bg-surface text-text hover:border-brand-500 hover:text-brand-700"
          : "cursor-not-allowed border-border bg-surface-2 text-text-subtle")
      }
      title={
        enabled
          ? "Generate Commission Disbursement Authorization PDF (opens in new tab)"
          : "Add gross commission to Financials before generating a CDA"
      }
    >
      <FileSignature className="h-3.5 w-3.5" strokeWidth={1.8} />
      Generate CDA
    </a>
  );
}
