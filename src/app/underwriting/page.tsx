/**
 * /underwriting — the deal underwriting pipeline. Every flip analysis not yet
 * tied to a transaction is a candidate you're underwriting. Track them here,
 * then "flip" the ones that go live into real REOS deals. Analyses that are
 * already married to a transaction live on that deal's page instead.
 */

import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import { computeFlip, type FlipInputs } from "@/services/core/FlipCalcModel";
import { UnderwritingBoard, type Candidate } from "./UnderwritingBoard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Underwriting · REOS" };

function bestExit(r: ReturnType<typeof computeFlip>) {
  const exits = [
    { name: "Fix & Flip", value: r.fixFlip.profit },
    { name: "Wholetail", value: r.wholetail.profit },
    { name: "Rental", value: r.rental.totalProfit3yr },
    { name: "Owner Finance", value: r.ownerFinance.totalProfit3yr },
  ];
  return exits.reduce((a, b) => (b.value > a.value ? b : a));
}

export default async function UnderwritingPage() {
  const actor = await requireSession();
  if (actor instanceof NextResponse) redirect("/login");

  const analyses = await prisma.flipAnalysis.findMany({
    where: { accountId: actor.accountId, transactionId: null },
    orderBy: { updatedAt: "desc" },
    select: { id: true, label: true, inputsJson: true, updatedAt: true },
  });

  const candidates: Candidate[] = analyses.map((a) => {
    const inputs = a.inputsJson as unknown as FlipInputs;
    let profit = 0,
      arv = 0,
      maxOffer = 0,
      offer = 0,
      rehab = 0,
      exit = "Fix & Flip";
    try {
      const r = computeFlip(inputs);
      const be = bestExit(r);
      profit = be.value;
      exit = be.name;
      arv = r.fixFlip.arv;
      maxOffer = r.fixFlip.maxOfferForProfit;
      offer = inputs.offerPrice ?? 0;
      rehab = inputs.flipRehabBudget ?? 0;
    } catch {
      /* leave zeros for a malformed analysis */
    }
    return {
      id: a.id,
      address: a.label,
      profit,
      exit,
      arv,
      maxOffer,
      offer,
      rehab,
      updatedAt: a.updatedAt.toISOString(),
    };
  });

  return <UnderwritingBoard candidates={candidates} />;
}
