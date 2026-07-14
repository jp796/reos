"use client";

/**
 * SellerIntelPanel — motivated-seller contact + intel pulled from GHL onto an
 * investment deal. Shows all phones/emails + motivation / condition / timeline
 * / lead tier, with a one-click "Pull from GHL" (matches by seller + property).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Phone, Mail, Home } from "lucide-react";
import { useToast } from "@/app/ToastProvider";

export interface SellerIntel {
  ghlContactId: string;
  name: string | null;
  phones: string[];
  emails: string[];
  propertyAddress: string | null;
  motivationSignal: string | null;
  reasonForSelling: string | null;
  occupiedBy: string | null;
  propertyCondition: string | null;
  timelineToSell: string | null;
  leadTier: string | null;
  pulledAt: string;
}

export function SellerIntelPanel({
  transactionId,
  intel,
}: {
  transactionId: string;
  intel: SellerIntel | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function pull() {
    setBusy(true);
    try {
      const res = await fetch(`/api/transactions/${transactionId}/pull-seller`, { method: "POST" });
      const data = await res.json();
      if (res.status === 412) {
        toast.error("GHL not connected", data.error ?? "Add your GHL key in Settings.");
        return;
      }
      if (res.status === 404) {
        toast.info("No match in GHL", data.error ?? "No seller lead matched this deal.");
        return;
      }
      if (!res.ok) {
        toast.error("Pull failed", data.error ?? res.statusText);
        return;
      }
      toast.success("Seller pulled from GHL", data.summary ?? "Updated.");
      router.refresh();
    } catch (e) {
      toast.error("Pull failed", e instanceof Error ? e.message : "unknown");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-6 rounded-md border border-border bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-display text-base font-semibold">
          <Home className="h-4 w-4 text-text-muted" strokeWidth={1.8} />
          Seller intel
          {intel?.leadTier && (
            <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700 ring-1 ring-brand-200">
              Tier {intel.leadTier}
            </span>
          )}
        </h2>
        <button
          type="button"
          onClick={pull}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-text-muted transition-colors hover:border-brand-400 hover:text-brand-700 disabled:opacity-60"
          title="Match this deal's seller in GHL and pull their contact info + intel"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} strokeWidth={2} />
          {busy ? "Pulling…" : intel ? "Re-pull from GHL" : "Pull seller from GHL"}
        </button>
      </div>

      {!intel ? (
        <p className="text-sm text-text-muted">
          No seller intel yet. Click <span className="font-medium">Pull seller from GHL</span> to
          fetch the seller&apos;s phones, emails, and situation from your GoHighLevel lead.
        </p>
      ) : (
        <div className="space-y-3 text-sm">
          {intel.name && <div className="font-medium text-text">{intel.name}</div>}

          <div className="grid gap-3 sm:grid-cols-2">
            {intel.phones.length > 0 && (
              <div>
                <div className="reos-label text-text-subtle">Phones</div>
                <ul className="mt-1 space-y-0.5">
                  {intel.phones.map((p) => (
                    <li key={p} className="flex items-center gap-1.5">
                      <Phone className="h-3 w-3 text-text-muted" strokeWidth={2} />
                      <a href={`tel:${p}`} className="text-brand-700 hover:underline">{p}</a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {intel.emails.length > 0 && (
              <div>
                <div className="reos-label text-text-subtle">Emails</div>
                <ul className="mt-1 space-y-0.5">
                  {intel.emails.map((e) => (
                    <li key={e} className="flex items-center gap-1.5">
                      <Mail className="h-3 w-3 text-text-muted" strokeWidth={2} />
                      <a href={`mailto:${e}`} className="text-brand-700 hover:underline break-all">{e}</a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            <Intel label="Motivation" value={intel.motivationSignal} highlight />
            <Intel label="Reason for selling" value={intel.reasonForSelling} />
            <Intel label="Occupied by" value={intel.occupiedBy} />
            <Intel label="Condition" value={intel.propertyCondition} />
            <Intel label="Timeline to sell" value={intel.timelineToSell} />
            {intel.propertyAddress && <Intel label="GHL property" value={intel.propertyAddress} />}
          </div>

          <div className="text-[11px] text-text-subtle">
            Pulled {new Date(intel.pulledAt).toLocaleString()}
          </div>
        </div>
      )}
    </section>
  );
}

function Intel({ label, value, highlight }: { label: string; value: string | null; highlight?: boolean }) {
  if (!value) return null;
  return (
    <div>
      <div className="reos-label text-text-subtle">{label}</div>
      <div className={`mt-0.5 ${highlight ? "font-medium text-amber-700 dark:text-amber-400" : "text-text"}`}>
        {value}
      </div>
    </div>
  );
}
