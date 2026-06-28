/**
 * /transactions/board — Monday.com-style deal board.
 *
 * The transactions list reimagined as a grouped board: rows grouped by
 * status, a colored editable Status column, and key columns (owner,
 * close date, value, GCI). Inline status edits persist through the
 * existing PATCH /api/transactions/[id]/status endpoint.
 */

import { redirect } from "next/navigation";
import { requireSession } from "@/lib/require-session";
import { prisma } from "@/lib/db";
import { dealVisibilityWhere } from "@/lib/deal-visibility";
import { DealBoard, type BoardRow } from "./DealBoard";

export const dynamic = "force-dynamic";

export default async function DealBoardPage() {
  const actor = await requireSession();
  if (actor instanceof Response) redirect("/login");

  const txns = await prisma.transaction.findMany({
    where: { accountId: actor.accountId, ...dealVisibilityWhere(actor) },
    select: {
      id: true,
      propertyAddress: true,
      status: true,
      closingDate: true,
      contact: { select: { fullName: true } },
      assignedUser: { select: { name: true } },
      financials: { select: { salePrice: true, grossCommission: true } },
    },
    orderBy: [{ closingDate: "asc" }, { updatedAt: "desc" }],
  });

  const rows: BoardRow[] = txns.map((t) => ({
    id: t.id,
    address: t.propertyAddress?.trim() || "Untitled deal",
    status: t.status,
    closingDate: t.closingDate ? t.closingDate.toISOString().slice(0, 10) : null,
    owner: t.assignedUser?.name ?? t.contact?.fullName ?? null,
    salePrice: t.financials?.salePrice ?? null,
    gci: t.financials?.grossCommission ?? null,
  }));

  return (
    <main className="mx-auto max-w-7xl">
      <DealBoard initial={rows} />
    </main>
  );
}
