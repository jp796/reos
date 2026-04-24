/**
 * /settings/intake — pending lead-intake queue.
 *
 * Lists every LeadIntake row for the account. The TC can click
 * "Promote" to turn a qualified lead into a Contact + Transaction,
 * "Mark contacted" to track outreach status, or "Dismiss" to move
 * spam / not-ready leads out of the default view.
 *
 * History is preserved even on dismiss — no hard delete surface.
 */

import { requireSession } from "@/lib/require-session";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { LeadIntakeList } from "./LeadIntakeList";

export const dynamic = "force-dynamic";

export default async function IntakePage() {
  const actor = await requireSession();
  if (actor instanceof Response) redirect("/settings");

  const rows = await prisma.leadIntake.findMany({
    where: { accountId: actor.accountId },
    orderBy: { submittedAt: "desc" },
    take: 200,
  });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const publicIntakeUrl = appUrl ? `${appUrl}/intake` : "/intake";

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="font-display text-h1 font-semibold">Lead intake</h1>
      <p className="mt-1 text-sm text-text-muted">
        Submissions from the public{" "}
        <a
          href="/intake"
          target="_blank"
          rel="noreferrer"
          className="text-brand-700 underline"
        >
          intake form
        </a>
        . Share the link on your bio, business card, or in a reply-to
        email: <code className="rounded bg-surface-2 px-1.5 py-0.5 text-xs">{publicIntakeUrl}</code>
      </p>
      <div className="mt-6">
        <LeadIntakeList
          initial={rows.map((r) => ({
            id: r.id,
            side: r.side,
            fullName: r.fullName,
            email: r.email,
            phone: r.phone,
            propertyAddress: r.propertyAddress,
            areaOfInterest: r.areaOfInterest,
            budget: r.budget,
            timeline: r.timeline,
            financingStatus: r.financingStatus,
            source: r.source,
            notes: r.notes,
            status: r.status,
            submittedAt: r.submittedAt.toISOString(),
            convertedTransactionId: r.convertedTransactionId,
          }))}
        />
      </div>
    </div>
  );
}
