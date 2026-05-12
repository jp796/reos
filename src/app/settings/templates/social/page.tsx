/**
 * /settings/templates/social — editable caption templates for the
 * Just Listed / Under Contract / Just Sold social posts.
 *
 * 3 events × 3 platforms = 9 slots. Each is optional — leave blank
 * and SocialPostService falls back to AI generation for that slot.
 * Fill it in and that exact template (with {{variable}} substitution)
 * gets posted instead.
 */

import { requireSession } from "@/lib/require-session";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { SocialTemplatesManager } from "./SocialTemplatesManager";

export const dynamic = "force-dynamic";

export default async function SocialTemplatesPage() {
  const actor = await requireSession();
  if (actor instanceof Response) redirect("/settings");

  const rows = await prisma.socialPostTemplate.findMany({
    where: { accountId: actor.accountId },
    orderBy: [{ event: "asc" }, { platform: "asc" }],
  });

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="font-display text-h1 font-semibold">Social-post templates</h1>
      <p className="mt-1 text-sm text-text-muted">
        Customize how REOS announces your <span className="font-medium">Just Listed</span>,{" "}
        <span className="font-medium">Under Contract</span>, and{" "}
        <span className="font-medium">Just Sold</span> posts on Instagram,
        Facebook, and LinkedIn. Leave a slot blank to let the AI write
        that one. Fill it in to lock the language.
      </p>
      <p className="mt-2 text-xs text-text-muted">
        Use <code>{"{{variable}}"}</code> tokens — REOS fills them from
        the transaction at post time. Reference below.
      </p>

      <SocialTemplatesManager
        initial={rows.map((r) => ({
          event: r.event,
          platform: r.platform,
          body: r.body,
          updatedAt: r.updatedAt.toISOString(),
        }))}
      />
    </div>
  );
}
