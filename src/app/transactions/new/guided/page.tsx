/**
 * /transactions/new/guided — the 5-step guided intake wizard (parallel
 * build alongside the live /transactions/new). Swaps in when complete.
 * Spec: docs/VISION_GUIDED_INTAKE.md.
 */

import { redirect } from "next/navigation";
import { requireSession } from "@/lib/require-session";
import { GuidedIntakeWizard } from "./GuidedIntakeWizard";

export const dynamic = "force-dynamic";

export default async function GuidedIntakePage() {
  const actor = await requireSession();
  if (actor instanceof Response) redirect("/login");
  return (
    <main className="mx-auto max-w-5xl">
      <GuidedIntakeWizard />
    </main>
  );
}
