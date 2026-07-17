/**
 * /private-money — the account's private-money capital-partner directory.
 * Manage partners once (name, company, contact, typical amount, notes); attach
 * them to deals from each deal's Private money panel. Feeds the weekly
 * partner-update email.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import { redirect } from "next/navigation";
import { PrivateMoneyDirectory } from "./PrivateMoneyDirectory";

export const dynamic = "force-dynamic";
export const metadata = { title: "Private money · REOS" };

export default async function PrivateMoneyPage() {
  const actor = await requireSession();
  if (actor instanceof NextResponse) redirect("/login");

  const partners = await prisma.privateMoneyPartner.findMany({
    where: { accountId: actor.accountId },
    orderBy: { name: "asc" },
    include: {
      fundings: {
        include: { transaction: { select: { id: true, propertyAddress: true, status: true } } },
      },
    },
  });

  const rows = partners.map((p) => ({
    id: p.id,
    name: p.name,
    company: p.company,
    email: p.email,
    phone: p.phone,
    typicalAmount: p.typicalAmount,
    notes: p.notes,
    deals: p.fundings.map((f) => ({
      transactionId: f.transaction.id,
      property: f.transaction.propertyAddress ?? "(no address)",
      status: f.transaction.status,
      amount: f.amount,
    })),
  }));

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4">
        <h1 className="font-display text-xl font-semibold">Private money partners</h1>
        <p className="text-sm text-text-muted">
          Your capital partners. Attach them to deals from each deal&rsquo;s Private money panel.
        </p>
      </div>
      <PrivateMoneyDirectory initial={rows} />
    </div>
  );
}
