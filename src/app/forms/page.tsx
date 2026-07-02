/**
 * /forms — the account's Forms Library.
 *
 * Load blank forms (offer, counter, addendum, disclosure…). Atlas fills
 * any fillable form with a deal's data, saves it to that deal's
 * documents, and it's ready to send for e-signature.
 */

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import { FormsLibrary } from "./FormsLibrary";

export const dynamic = "force-dynamic";

export default async function FormsPage() {
  const actor = await requireSession();
  if (actor instanceof Response) redirect("/login");

  const [forms, deals] = await Promise.all([
    prisma.formTemplate.findMany({
      where: { accountId: actor.accountId },
      select: {
        id: true, name: true, category: true, fileName: true,
        fieldCount: true, isFlat: true, isXfa: true, hasText: true, createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.transaction.findMany({
      where: { accountId: actor.accountId, status: "active" },
      select: { id: true, propertyAddress: true },
      orderBy: { updatedAt: "desc" },
      take: 200,
    }),
  ]);

  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      <FormsLibrary
        initialForms={forms.map((f) => ({ ...f, createdAt: f.createdAt.toISOString() }))}
        deals={deals.map((d) => ({ id: d.id, address: d.propertyAddress ?? "(no address)" }))}
      />
    </main>
  );
}
