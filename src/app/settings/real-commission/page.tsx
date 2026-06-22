/**
 * /settings/real-commission — connect a Real (ReZEN) API key so REOS can
 * pull commission/GCI straight into deal financials.
 */

import { redirect } from "next/navigation";
import { requireSession } from "@/lib/require-session";
import { RealKeyForm } from "./RealKeyForm";

export const dynamic = "force-dynamic";

export default async function RealCommissionPage() {
  const actor = await requireSession();
  if (actor instanceof Response) redirect("/login");
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="font-display text-h1 font-semibold">Real commission</h1>
      <p className="mt-1 text-sm text-text-muted">
        Connect your Real (ReZEN) API key to pull gross commission, sale price,
        and rate straight from Real into a deal&rsquo;s financials — no manual
        re-keying. Read-only; compliance push is separate.
      </p>
      <div className="mt-6">
        <RealKeyForm />
      </div>
    </div>
  );
}
