/**
 * Flip Evaluation Calculator — standalone deal analyzer.
 *
 * A native port of JP's flip spreadsheet: analyze ANY address across four
 * exit strategies (Fix & Flip · Wholetail · DSCR Rental · Owner Finance),
 * driven by a comps→ARV engine. Computes live in the browser; a run can be
 * saved and attached to a REOS deal.
 */

import { NextResponse } from "next/server";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import { FlipCalculator } from "./FlipCalculator";

export const dynamic = "force-dynamic";
export const metadata = { title: "Flip Calculator · REOS" };

export default async function FlipCalculatorPage({
  searchParams,
}: {
  searchParams: Promise<{ deal?: string }>;
}) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return notFound();

  const [deals, sp] = await Promise.all([
    prisma.transaction.findMany({
      where: { accountId: actor.accountId, isDemo: false, status: { notIn: ["dead", "terminated"] } },
      select: { id: true, propertyAddress: true },
      orderBy: { updatedAt: "desc" },
      take: 300,
    }),
    searchParams,
  ]);

  const prefill = sp.deal
    ? deals.find((d) => d.id === sp.deal)
    : undefined;

  return (
    <FlipCalculator
      deals={deals.map((d) => ({ id: d.id, address: d.propertyAddress ?? "(no address)" }))}
      prefillDealId={prefill?.id ?? null}
      prefillAddress={prefill?.propertyAddress ?? ""}
    />
  );
}
