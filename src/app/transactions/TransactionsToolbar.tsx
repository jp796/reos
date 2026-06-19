"use client";

/**
 * TransactionsToolbar — the cleaned-up top-right of the Transactions
 * page. One bold "+ New Transaction" CTA (→ the guided intake wizard)
 * plus a single "Tools" menu that collapses the maintenance scans that
 * used to clutter the header (title orders, earnest money, invoices,
 * stale contacts). One space, many things.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Plus, Wrench, ChevronDown } from "lucide-react";
import { ScanButton } from "./ScanButton";
import { EarnestMoneyScanButton } from "./EarnestMoneyScanButton";
import { InvoiceScanButton } from "./InvoiceScanButton";
import { StaleContactCheckButton } from "./StaleContactCheckButton";

export function TransactionsToolbar() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <div className="flex items-center gap-2">
      <Link
        href="/transactions/new"
        className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-500"
      >
        <Plus className="h-4 w-4" strokeWidth={2.5} />
        New Transaction
      </Link>

      <div className="relative" ref={ref}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium text-text-muted hover:border-border-strong hover:text-text"
        >
          <Wrench className="h-3.5 w-3.5" />
          Tools
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
        {open && (
          <div className="absolute right-0 z-20 mt-1 w-72 rounded-lg border border-border bg-surface p-2 shadow-lg">
            <div className="px-2 pb-1.5 pt-1 text-xs font-semibold uppercase tracking-wide text-text-subtle">
              Inbox &amp; maintenance scans
            </div>
            <div className="flex flex-col gap-1.5 [&_button]:w-full [&_button]:justify-start">
              <ScanButton />
              <EarnestMoneyScanButton />
              <InvoiceScanButton />
              <StaleContactCheckButton />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
