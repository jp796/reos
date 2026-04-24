/**
 * /settings/brokerage — owner-configured broker metadata that auto-
 * fills every CDA PDF. Small set of fields, no schema migration
 * required (stored in Account.settingsJson.broker).
 */

import { requireOwner } from "@/lib/require-session";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { BrokerageForm } from "./BrokerageForm";
import type { BrokerSettings } from "@/services/core/CdaGeneratorService";

export const dynamic = "force-dynamic";

export default async function BrokerageSettingsPage() {
  const actor = await requireOwner();
  if (actor instanceof Response) redirect("/settings");

  const account = await prisma.account.findUnique({
    where: { id: actor.accountId },
    select: { businessName: true, settingsJson: true },
  });
  const settings = (account?.settingsJson ?? {}) as Record<string, unknown>;
  const broker = (settings.broker ?? {}) as BrokerSettings;

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="font-display text-h1 font-semibold">Brokerage</h1>
      <p className="mt-1 text-sm text-text-muted">
        This info prints at the top of every{" "}
        <strong>Commission Disbursement Authorization</strong> (CDA) PDF
        REOS generates, and identifies the brokerage on any future
        compliance-submission packet. Fill it once.
      </p>
      <div className="mt-6">
        <BrokerageForm
          initial={broker}
          fallbackBusinessName={account?.businessName ?? ""}
        />
      </div>
    </div>
  );
}
