/**
 * /settings/notifications — opt into Web Push for the morning brief
 * and ad-hoc alerts. Works on iOS 16.4+, Android, desktop Chrome /
 * Edge / Firefox / Brave / Safari 16+.
 *
 * Subscriptions live in the PushSubscription table per (user, device).
 * Removing the toggle deletes the row AND tells the OS to release the
 * push grant. No data is left behind.
 */

import { requireSession } from "@/lib/require-session";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { isWebPushConfigured } from "@/services/integrations/WebPushService";
import { NotificationsPanel } from "./NotificationsPanel";

export const dynamic = "force-dynamic";

export default async function NotificationsSettingsPage() {
  const actor = await requireSession();
  if (actor instanceof Response) redirect("/login");

  const subs = await prisma.pushSubscription.findMany({
    where: { userId: actor.userId, disabledAt: null },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      endpoint: true,
      userAgent: true,
      createdAt: true,
      lastUsedAt: true,
    },
  });

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="font-display text-h1 font-semibold">Notifications</h1>
      <p className="mt-1 text-sm text-text-muted">
        Get the morning brief, deadline reminders, and earnest-money
        confirmations as native push notifications — no Telegram needed.
        Works on phone (Add to Home Screen first) + desktop browsers.
      </p>

      <div className="mt-6">
        <NotificationsPanel
          publicKey={env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ""}
          configured={isWebPushConfigured()}
          subscriptions={subs.map((s) => ({
            id: s.id,
            endpoint: s.endpoint,
            userAgent: s.userAgent,
            createdAt: s.createdAt.toISOString(),
            lastUsedAt: s.lastUsedAt?.toISOString() ?? null,
          }))}
        />
      </div>
    </div>
  );
}
