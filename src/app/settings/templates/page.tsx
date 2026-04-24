/**
 * /settings/templates — manage email templates with mail-merge variables.
 * Edit / add / delete. First-time visit can seed the starter set.
 */

import { requireSession } from "@/lib/require-session";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { TemplatesManager } from "./TemplatesManager";

export const dynamic = "force-dynamic";

export default async function TemplatesSettingsPage() {
  const actor = await requireSession();
  if (actor instanceof Response) redirect("/settings");

  const rows = await prisma.emailTemplate.findMany({
    where: { accountId: actor.accountId },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="font-display text-h1 font-semibold">Email templates</h1>
      <p className="mt-1 text-sm text-text-muted">
        Canned messages with <code>{`{{variable}}`}</code> tokens that
        resolve from the transaction at send time. These live account-
        wide — Vicki and Jp share the same set.
      </p>
      <TemplatesManager
        initial={rows.map((r) => ({
          id: r.id,
          name: r.name,
          subject: r.subject,
          body: r.body,
          category: r.category,
          defaultTo: r.defaultTo,
          isStarter: r.isStarter,
          sortOrder: r.sortOrder,
        }))}
        canSeed={actor.role === "owner"}
      />
    </div>
  );
}
