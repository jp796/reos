/**
 * /transactions/new — the unified "New Transaction" intake.
 *
 * One space, many sources: drop the contract (+ related docs), tell
 * Atlas which side you're on (Buyer / Listing / Both / Investor), let
 * it read the contract, review the extracted parties/dates/money, and
 * create. Replaces the scattered "manual upload" + "scan" panels that
 * used to clutter the Transactions list.
 */

import { redirect } from "next/navigation";
import { requireSession } from "@/lib/require-session";
import { NewTransactionWizard } from "./NewTransactionWizard";

export const dynamic = "force-dynamic";

export default async function NewTransactionPage() {
  const actor = await requireSession();
  if (actor instanceof Response) redirect("/login");
  return (
    <main className="mx-auto max-w-5xl">
      <NewTransactionWizard />
    </main>
  );
}
