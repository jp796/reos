/**
 * WebPushService — server-side dispatcher for browser push.
 *
 * Subscriptions live in the PushSubscription table (one per device).
 * MorningTick + ad-hoc alerts call sendToAccount() / sendToUser() to
 * fan out a payload to every active endpoint owned by that scope.
 *
 * Failures are categorized:
 *   - 404 / 410 = endpoint gone for good → mark disabledAt
 *   - everything else = transient, logged but row stays active
 */

import webpush from "web-push";
import { env } from "@/lib/env";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/log";

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  icon?: string;
}

export function isWebPushConfigured(): boolean {
  return !!(
    env.NEXT_PUBLIC_VAPID_PUBLIC_KEY &&
    env.VAPID_PRIVATE_KEY &&
    env.VAPID_SUBJECT &&
    env.VAPID_PRIVATE_KEY !== "unset"
  );
}

let _initialized = false;
function init() {
  if (_initialized) return;
  if (!isWebPushConfigured()) return;
  webpush.setVapidDetails(
    env.VAPID_SUBJECT!,
    env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    env.VAPID_PRIVATE_KEY!,
  );
  _initialized = true;
}

interface DispatchResult {
  attempted: number;
  delivered: number;
  disabled: number;
  errors: number;
}

async function dispatch(
  subs: Array<{
    id: string;
    endpoint: string;
    p256dh: string;
    auth: string;
  }>,
  payload: PushPayload,
): Promise<DispatchResult> {
  const out: DispatchResult = {
    attempted: subs.length,
    delivered: 0,
    disabled: 0,
    errors: 0,
  };
  if (!isWebPushConfigured() || subs.length === 0) return out;
  init();

  const body = JSON.stringify(payload);

  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
          { TTL: 60 * 60 * 12 }, // hold for 12h on the push provider
        );
        out.delivered++;
        await prisma.pushSubscription.update({
          where: { id: s.id },
          data: { lastUsedAt: new Date() },
        });
      } catch (err) {
        const status =
          (err as { statusCode?: number })?.statusCode ?? 0;
        if (status === 404 || status === 410) {
          out.disabled++;
          await prisma.pushSubscription
            .update({
              where: { id: s.id },
              data: { disabledAt: new Date() },
            })
            .catch(() => {});
        } else {
          out.errors++;
          logError(err, {
            route: "WebPushService.dispatch",
            meta: { endpoint: s.endpoint.slice(0, 60) },
          });
        }
      }
    }),
  );
  return out;
}

/** Send a payload to every active subscription on an account.
 * Use for account-wide notifications (the morning brief belongs here). */
export async function sendToAccount(
  accountId: string,
  payload: PushPayload,
): Promise<DispatchResult> {
  const subs = await prisma.pushSubscription.findMany({
    where: { accountId, disabledAt: null },
    select: { id: true, endpoint: true, p256dh: true, auth: true },
  });
  return dispatch(subs, payload);
}

/** Send to a specific user across all their devices. Use for
 * personal mentions / @-style alerts. */
export async function sendToUser(
  userId: string,
  payload: PushPayload,
): Promise<DispatchResult> {
  const subs = await prisma.pushSubscription.findMany({
    where: { userId, disabledAt: null },
    select: { id: true, endpoint: true, p256dh: true, auth: true },
  });
  return dispatch(subs, payload);
}
