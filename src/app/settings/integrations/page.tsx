/**
 * /settings/integrations — pick which photo source + social poster
 * REOS uses. Each row shows whether the adapter has its credentials
 * wired (configured) or is a stub waiting for setup.
 */

import { requireOwner } from "@/lib/require-session";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { ALL_PHOTO_SOURCES } from "@/services/integrations/listing-photos/registry";
import { ALL_POSTERS } from "@/services/integrations/social-posters/registry";
import { IntegrationsForm } from "./IntegrationsForm";

export const dynamic = "force-dynamic";

export default async function IntegrationsSettingsPage() {
  const actor = await requireOwner();
  if (actor instanceof Response) redirect("/settings");

  const account = await prisma.account.findUnique({
    where: { id: actor.accountId },
    select: { settingsJson: true },
  });
  const settings = (account?.settingsJson ?? {}) as Record<string, unknown>;

  const photoSources = await Promise.all(
    ALL_PHOTO_SOURCES.map(async (a) => ({
      id: a.id,
      label: a.label,
      configured: await a.isConfigured(actor.accountId),
    })),
  );
  const posters = await Promise.all(
    ALL_POSTERS.map(async (a) => ({
      id: a.id,
      label: a.label,
      supports: a.supports,
      configured: await a.isConfigured(actor.accountId),
    })),
  );

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="font-display text-h1 font-semibold">Integrations</h1>
      <p className="mt-1 text-sm text-text-muted">
        Pick where REOS pulls listing photos from and how it publishes
        social posts. Concrete adapters work today; stubs are wireup
        slots — each one tells you what credentials to drop in.
      </p>
      <div className="mt-6">
        <IntegrationsForm
          activePhotoProvider={
            (settings.listingPhotoProvider as string) ?? "manual_upload"
          }
          activePoster={(settings.socialPoster as string) ?? "clipboard"}
          photoSources={photoSources}
          posters={posters}
        />
      </div>
    </div>
  );
}
