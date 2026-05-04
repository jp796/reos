"use client";

import { useEffect, useState } from "react";
import {
  Bell,
  BellOff,
  Loader2,
  Send,
  Smartphone,
  AlertCircle,
} from "lucide-react";
import { useToast } from "@/app/ToastProvider";

interface SubRow {
  id: string;
  endpoint: string;
  userAgent: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

export function NotificationsPanel({
  publicKey,
  configured,
  subscriptions: initial,
}: {
  publicKey: string;
  configured: boolean;
  subscriptions: SubRow[];
}) {
  const toast = useToast();
  const [supported, setSupported] = useState<boolean | null>(null);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [subs, setSubs] = useState<SubRow[]>(initial);

  useEffect(() => {
    const ok =
      typeof window !== "undefined" &&
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window;
    setSupported(ok);
    if (!ok) return;
    setPermission(Notification.permission);
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setSubscribed(!!sub))
      .catch(() => {});
  }, []);

  async function enable() {
    setBusy("enable");
    try {
      const reg = await navigator.serviceWorker.ready;
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== "granted") throw new Error("Permission denied");

      // PushManager's TS types want ArrayBuffer; modern Uint8Array
      // typings expose a possibly-shared backing buffer. Pass a fresh
      // ArrayBuffer slice to satisfy both runtime + types.
      const keyBytes = urlBase64ToUint8Array(publicKey);
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes.buffer.slice(
          keyBytes.byteOffset,
          keyBytes.byteOffset + keyBytes.byteLength,
        ) as ArrayBuffer,
      });
      const json = sub.toJSON() as {
        endpoint?: string;
        keys?: { p256dh?: string; auth?: string };
      };

      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(json),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "subscribe failed");
      setSubscribed(true);
      toast.success("Notifications on", "We'll start sending the brief here.");
    } catch (e) {
      toast.error("Couldn't enable", e instanceof Error ? e.message : "unknown");
    } finally {
      setBusy(null);
    }
  }

  async function disable() {
    setBusy("disable");
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setSubscribed(false);
      toast.success("Notifications off", "This device won't receive pushes.");
    } catch (e) {
      toast.error("Couldn't disable", e instanceof Error ? e.message : "unknown");
    } finally {
      setBusy(null);
    }
  }

  async function sendTest() {
    setBusy("test");
    try {
      const res = await fetch("/api/push/test", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "test failed");
      toast.success(
        "Test sent",
        `${data.result?.delivered ?? 0} delivered · ${data.result?.errors ?? 0} errored`,
      );
    } catch (e) {
      toast.error("Test failed", e instanceof Error ? e.message : "unknown");
    } finally {
      setBusy(null);
    }
  }

  async function removeRow(id: string, endpoint: string) {
    setBusy(`remove-${id}`);
    try {
      const res = await fetch("/api/push/unsubscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ endpoint }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error ?? "remove failed");
      }
      setSubs((prev) => prev.filter((s) => s.id !== id));
    } catch (e) {
      toast.error("Couldn't remove", e instanceof Error ? e.message : "unknown");
    } finally {
      setBusy(null);
    }
  }

  if (!configured) {
    return (
      <div className="rounded-md border border-dashed border-border bg-surface-2/40 p-4 text-sm">
        <div className="flex items-start gap-2">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" />
          <div>
            <div className="font-medium text-text">Setup pending</div>
            <div className="mt-1 text-xs text-text-muted">
              Web Push isn't enabled on the server yet. Once VAPID keys
              are deployed, the toggle below will activate.
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (supported === false) {
    return (
      <div className="rounded-md border border-border bg-surface p-4 text-sm">
        <div className="flex items-start gap-2">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-accent-600" />
          <div>
            <div className="font-medium text-text">
              This browser doesn't support Web Push
            </div>
            <div className="mt-1 text-xs text-text-muted">
              Use a modern Chrome, Edge, Firefox, Brave, or Safari 16+.
              On iPhone, install REOS as a Home Screen app first.
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border bg-surface p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {subscribed ? (
              <Bell className="h-5 w-5 text-brand-600" strokeWidth={1.8} />
            ) : (
              <BellOff className="h-5 w-5 text-text-muted" strokeWidth={1.8} />
            )}
            <div>
              <div className="text-sm font-medium">
                {subscribed
                  ? "Notifications enabled on this device"
                  : "Notifications off on this device"}
              </div>
              <div className="text-xs text-text-muted">
                {permission === "denied"
                  ? "Permission denied — re-enable in your browser's site settings."
                  : subscribed
                    ? "Morning brief + alerts will arrive here."
                    : "Tap enable to start receiving pushes."}
              </div>
            </div>
          </div>
          {subscribed ? (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={sendTest}
                disabled={busy === "test"}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-sm hover:border-brand-500"
              >
                {busy === "test" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Send className="h-3.5 w-3.5" strokeWidth={2} />
                )}
                Test
              </button>
              <button
                type="button"
                onClick={disable}
                disabled={busy === "disable"}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-sm hover:border-danger hover:text-danger"
              >
                {busy === "disable" && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                )}
                Disable
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={enable}
              disabled={busy === "enable" || permission === "denied"}
              className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
            >
              {busy === "enable" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Bell className="h-3.5 w-3.5" strokeWidth={2} />
              )}
              Enable
            </button>
          )}
        </div>
      </div>

      {subs.length > 0 && (
        <div>
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">
            Your devices
          </div>
          <div className="space-y-1.5">
            {subs.map((s) => (
              <div
                key={s.id}
                className="flex items-center gap-3 rounded border border-border bg-surface px-3 py-2 text-xs"
              >
                <Smartphone
                  className="h-3.5 w-3.5 shrink-0 text-text-muted"
                  strokeWidth={1.8}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-text">
                    {labelForUserAgent(s.userAgent)}
                  </div>
                  <div className="text-[11px] text-text-muted">
                    Added {new Date(s.createdAt).toLocaleDateString()}
                    {s.lastUsedAt &&
                      ` · last used ${new Date(s.lastUsedAt).toLocaleDateString()}`}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => removeRow(s.id, s.endpoint)}
                  disabled={busy === `remove-${s.id}`}
                  className="rounded px-2 py-1 text-text-muted hover:bg-surface-2 hover:text-danger"
                >
                  {busy === `remove-${s.id}` ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    "Remove"
                  )}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Best-effort label for the user-agent string so the device list
 * shows "iPhone Safari" instead of a 400-char UA. */
function labelForUserAgent(ua: string | null): string {
  if (!ua) return "Unknown device";
  if (/iPhone|iPad/.test(ua)) return /CriOS/.test(ua) ? "iPhone Chrome" : "iPhone Safari";
  if (/Android/.test(ua))
    return /Chrome/.test(ua) ? "Android Chrome" : "Android browser";
  if (/Edg\//.test(ua)) return "Desktop Edge";
  if (/Chrome\//.test(ua)) return "Desktop Chrome";
  if (/Firefox\//.test(ua)) return "Desktop Firefox";
  if (/Safari\//.test(ua)) return "Desktop Safari";
  return ua.slice(0, 40);
}

/** VAPID public keys are URL-safe base64; PushManager wants a Uint8Array. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const cleaned = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(cleaned);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}
