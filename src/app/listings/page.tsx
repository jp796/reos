/**
 * /listings — properties on the market, pre-contract.
 *
 * A listing IS a Transaction with status='listing' under the hood —
 * keeping one model means every existing scan, auto-link, AI doc
 * classifier, and Atlas-chat works for listings without rework.
 *
 * The "Convert to Transaction" button on each row flips status to
 * 'active' and stamps a contract date.
 */

import Link from "next/link";
import { prisma } from "@/lib/db";
import { Home, Plus } from "lucide-react";

export const dynamic = "force-dynamic";

function fmtDate(d: Date | null | undefined): string {
  if (!d) return "—";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtMoney(n: number | null | undefined): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

export default async function ListingsPage() {
  const listings = await prisma.transaction.findMany({
    where: { status: "listing" },
    include: {
      contact: true,
      financials: { select: { salePrice: true } },
    },
    orderBy: { listDate: "desc" },
  });

  return (
    <main className="mx-auto max-w-6xl">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="reos-label">Listings</div>
          <h1 className="mt-1 font-display text-display-lg font-semibold tabular-nums">
            <span className="text-text">{listings.length}</span>
            <span className="ml-2 text-base font-normal text-text-muted">
              active
            </span>
          </h1>
          <p className="mt-1 text-sm text-text-muted">
            Properties on the market — pre-contract. Convert to a transaction
            when an offer is accepted.
          </p>
        </div>
        <Link
          href="/listings/new"
          className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-500"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2} />
          New listing
        </Link>
      </header>

      {listings.length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed border-border bg-surface-2/40 p-8 text-center text-sm text-text-muted">
          <Home className="mx-auto mb-2 h-6 w-6" strokeWidth={1.5} />
          No active listings. Click <span className="font-medium">New listing</span>{" "}
          to add a property you're representing on the seller side.
        </div>
      ) : (
        <ul className="mt-6 space-y-2">
          {listings.map((l) => (
            <li
              key={l.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-surface p-4"
            >
              <div className="min-w-0 flex-1">
                <Link
                  href={`/transactions/${l.id}`}
                  className="font-display text-base font-semibold hover:underline"
                >
                  {l.propertyAddress ?? "(no address)"}
                </Link>
                <div className="mt-0.5 text-xs text-text-muted">
                  {l.contact.fullName}
                  {l.city && ` · ${l.city}, ${l.state}`}
                </div>
              </div>
              <div className="flex items-center gap-4 text-right text-sm">
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-text-subtle">
                    List price
                  </div>
                  <div className="font-medium text-text">
                    {fmtMoney(l.listPrice ?? l.financials?.salePrice)}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-text-subtle">
                    Listed
                  </div>
                  <div className="font-medium text-text">
                    {fmtDate(l.listDate)}
                  </div>
                </div>
                {l.listingExpirationDate && (
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-text-subtle">
                      Expires
                    </div>
                    <div className="font-medium text-text">
                      {fmtDate(l.listingExpirationDate)}
                    </div>
                  </div>
                )}
                <Link
                  href={`/transactions/${l.id}#convert`}
                  className="inline-flex items-center gap-1 rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-500"
                >
                  Convert to Transaction →
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
