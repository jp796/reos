/**
 * /settings/summary-design — brand the transaction-summary page
 * (logo, accent color, tagline).
 */

import { redirect } from "next/navigation";
import { requireSession } from "@/lib/require-session";
import { SummaryDesignForm } from "./SummaryDesignForm";

export const dynamic = "force-dynamic";

export default async function SummaryDesignPage() {
  const actor = await requireSession();
  if (actor instanceof Response) redirect("/login");
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="font-display text-h1 font-semibold">Summary design</h1>
      <p className="mt-1 text-sm text-text-muted">
        Brand the transaction-summary page your clients see (logo, color,
        tagline). Open any deal &rarr; <b>Summary</b> to preview, then Print /
        Save as PDF.
      </p>
      <div className="mt-6">
        <SummaryDesignForm />
      </div>
    </div>
  );
}
