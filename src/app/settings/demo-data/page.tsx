/**
 * /settings/demo-data — owner-only sandbox controls.
 * "Generate sample deals" + "Wipe demo data" buttons.
 */

import { requireOwner } from "@/lib/require-session";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { DemoDataPanel } from "./DemoDataPanel";

export const dynamic = "force-dynamic";

export default async function DemoDataSettingsPage() {
  const actor = await requireOwner();
  if (actor instanceof Response) redirect("/settings");

  const demoCount = await prisma.transaction.count({
    where: { accountId: actor.accountId, isDemo: true },
  });

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="font-display text-h1 font-semibold">Demo data</h1>
      <p className="mt-1 text-sm text-text-muted">
        Generate fake transactions to test features without polluting your
        production rollups. Demo deals are excluded from Production /
        Sources / Digest / Pipeline. Wipe anytime.
      </p>
      <div className="mt-6">
        <DemoDataPanel demoCount={demoCount} />
      </div>
    </div>
  );
}
