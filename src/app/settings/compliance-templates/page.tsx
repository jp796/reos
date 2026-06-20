/**
 * /settings/compliance-templates — manage reusable + AI-generated
 * document checklists. Apply one to a deal from its Compliance tab.
 */

import { redirect } from "next/navigation";
import { requireSession } from "@/lib/require-session";
import { ComplianceTemplatesManager } from "./ComplianceTemplatesManager";

export const dynamic = "force-dynamic";

export default async function ComplianceTemplatesPage() {
  const actor = await requireSession();
  if (actor instanceof Response) redirect("/login");
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="font-display text-h1 font-semibold">Compliance templates</h1>
      <p className="mt-1 text-sm text-text-muted">
        Define the documents you track for a deal. Generate one with Atlas or
        build your own, then apply it to a deal from its Compliance tab — it
        becomes that deal&rsquo;s required-doc audit, matched against uploads.
      </p>
      <div className="mt-6">
        <ComplianceTemplatesManager />
      </div>
    </div>
  );
}
