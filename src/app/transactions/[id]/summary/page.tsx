/**
 * /transactions/[id]/summary — a clean, branded transaction summary.
 *
 * Print-friendly (browser Print → Save as PDF). Branding (logo, accent,
 * tagline) comes from Settings → Summary design (Account.settingsJson
 * .summaryDesign). Shows the deal's address, timeline, parties, and money.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import { isDealVisible } from "@/lib/deal-visibility";
import { PrintButton } from "./PrintButton";

export const dynamic = "force-dynamic";

function fmtDate(d: Date | null | undefined) {
  if (!d) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function fmtMoney(n: number | null | undefined) {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}
const ROLE_LABEL: Record<string, string> = {
  co_buyer: "Buyer", co_seller: "Seller", buyer_agent: "Buyer's agent",
  seller_agent: "Seller's agent", lender: "Lender", title: "Title",
  inspector: "Inspector", primary: "Client",
};

export default async function SummaryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireSession();
  if (actor instanceof NextResponse) return notFound();

  const txn = await prisma.transaction.findFirst({
    where: { id, accountId: actor.accountId },
    include: {
      contact: true,
      milestones: { orderBy: { dueAt: "asc" } },
      participants: { include: { contact: { select: { fullName: true, primaryEmail: true } } } },
      financials: true,
    },
  });
  if (!txn || !isDealVisible(actor, txn)) return notFound();

  const account = await prisma.account.findUnique({
    where: { id: txn.accountId },
    select: { businessName: true, settingsJson: true },
  });
  const settings = (account?.settingsJson ?? {}) as Record<string, unknown>;
  const design = (settings.summaryDesign ?? {}) as { logoUrl?: string; accentColor?: string; tagline?: string };
  const accent = typeof design.accentColor === "string" ? design.accentColor : "#4F46E5";
  const logoUrl = typeof design.logoUrl === "string" ? design.logoUrl : "";
  const tagline = typeof design.tagline === "string" && design.tagline ? design.tagline : (account?.businessName ?? "");

  const parties = [
    { role: txn.side === "sell" ? "co_seller" : "co_buyer", name: txn.contact.fullName, email: txn.contact.primaryEmail },
    ...txn.participants.map((p) => ({ role: p.role, name: p.contact.fullName, email: p.contact.primaryEmail })),
  ];
  const datedMilestones = txn.milestones.filter((m) => m.dueAt);

  return (
    <main className="mx-auto max-w-3xl px-2 py-4">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link href={`/transactions/${txn.id}`} className="text-sm text-text-muted hover:text-text">
          ← Back to deal
        </Link>
        <PrintButton accent={accent} />
      </div>

      <div className="rounded-lg border border-border bg-white p-8 text-slate-800 shadow-sm print:border-0 print:shadow-none">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b-2 pb-4" style={{ borderColor: accent }}>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: accent }}>
              Transaction Summary
            </div>
            <h1 className="mt-1 text-2xl font-bold text-slate-900">
              {txn.propertyAddress || txn.contact.fullName}
            </h1>
            {(txn.city || txn.state) && (
              <div className="text-sm text-slate-500">
                {[txn.city, txn.state, txn.zip].filter(Boolean).join(", ")}
              </div>
            )}
          </div>
          <div className="text-right">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="" className="ml-auto max-h-12 object-contain" />
            ) : (
              <div className="text-lg font-bold" style={{ color: accent }}>
                {account?.businessName}
              </div>
            )}
            {tagline && <div className="mt-0.5 text-xs text-slate-500">{tagline}</div>}
          </div>
        </div>

        {/* Key facts */}
        <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Fact label="Status" value={txn.status} />
          <Fact label="Side" value={txn.side === "buy" ? "Buyer" : txn.side === "sell" ? "Seller" : "Dual"} />
          <Fact label="Contract" value={fmtDate(txn.contractDate)} />
          <Fact label="Closing" value={fmtDate(txn.closingDate)} />
          <Fact label="Sale price" value={fmtMoney(txn.financials?.salePrice)} />
          <Fact label="Lender" value={txn.lenderName ?? "—"} />
          <Fact label="Title co." value={txn.titleCompanyName ?? "—"} />
          <Fact label="Inspection" value={fmtDate(txn.inspectionDate)} />
        </div>

        {/* Timeline */}
        {datedMilestones.length > 0 && (
          <section className="mt-6">
            <h2 className="mb-2 text-sm font-bold uppercase tracking-wide" style={{ color: accent }}>
              Timeline
            </h2>
            <ul className="divide-y divide-slate-100">
              {datedMilestones.map((m) => (
                <li key={m.id} className="flex items-center justify-between py-1.5 text-sm">
                  <span className="text-slate-700">
                    {m.label}
                    {m.completedAt && <span className="ml-2 text-xs text-emerald-600">✓ done</span>}
                  </span>
                  <span className="font-medium tabular-nums text-slate-900">{fmtDate(m.dueAt)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Parties */}
        {parties.length > 0 && (
          <section className="mt-6">
            <h2 className="mb-2 text-sm font-bold uppercase tracking-wide" style={{ color: accent }}>
              Parties
            </h2>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {parties.map((p, i) => (
                <div key={i} className="rounded border border-slate-100 bg-slate-50 px-3 py-2 text-sm">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    {ROLE_LABEL[p.role] ?? p.role.replace(/_/g, " ")}
                  </div>
                  <div className="font-medium text-slate-900">{p.name}</div>
                  {p.email && <div className="text-xs text-slate-500">{p.email}</div>}
                </div>
              ))}
            </div>
          </section>
        )}

        <div className="mt-8 border-t border-slate-100 pt-3 text-center text-[10px] text-slate-400">
          Generated by {account?.businessName ?? "REOS"} · {fmtDate(new Date())}
        </div>
      </div>
    </main>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-0.5 text-sm font-medium capitalize text-slate-900">{value}</div>
    </div>
  );
}
