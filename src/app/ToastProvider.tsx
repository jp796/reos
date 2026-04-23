"use client";

/**
 * App-wide toast provider. Drop-in replacement for window.alert() and
 * console.error() that actually tells the user what happened.
 *
 * Usage:
 *   const toast = useToast();
 *   toast.success("Saved");
 *   toast.error("Couldn't save", err.message);
 *   toast.info("Scanning Gmail…");
 *
 * Design: stacks 3 visible at a time, auto-dismisses after 4s
 * (success/info) or 7s (error), newest on top-right. Each toast
 * can render a small description underneath the title.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { X, CheckCircle2, AlertTriangle, Info } from "lucide-react";

type Kind = "success" | "error" | "info";

interface Toast {
  id: string;
  kind: Kind;
  title: string;
  desc?: string;
  expiresAt: number;
}

interface ToastAPI {
  success: (title: string, desc?: string) => void;
  error: (title: string, desc?: string) => void;
  info: (title: string, desc?: string) => void;
}

const Ctx = createContext<ToastAPI | null>(null);

export function useToast(): ToastAPI {
  const api = useContext(Ctx);
  if (!api) {
    // Fallback for server-render / components outside the provider:
    // swallow silently rather than blow up the render.
    return {
      success: () => {},
      error: () => {},
      info: () => {},
    };
  }
  return api;
}

const DEFAULT_MS = {
  success: 4000,
  info: 4000,
  error: 7000,
};

let seq = 0;
function newId(): string {
  seq += 1;
  return `t${Date.now()}_${seq}`;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((kind: Kind, title: string, desc?: string) => {
    const t: Toast = {
      id: newId(),
      kind,
      title,
      desc,
      expiresAt: Date.now() + DEFAULT_MS[kind],
    };
    setToasts((prev) => [t, ...prev].slice(0, 5)); // cap visible stack
  }, []);

  const api: ToastAPI = {
    success: (title, desc) => push("success", title, desc),
    error: (title, desc) => push("error", title, desc),
    info: (title, desc) => push("info", title, desc),
  };

  // Reaper — removes expired toasts on a 1s tick.
  useEffect(() => {
    if (toasts.length === 0) return;
    const h = setInterval(() => {
      const now = Date.now();
      setToasts((prev) => prev.filter((t) => t.expiresAt > now));
    }, 1000);
    return () => clearInterval(h);
  }, [toasts.length]);

  function dismiss(id: string) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  return (
    <Ctx.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed right-4 top-4 z-[100] flex w-full max-w-sm flex-col gap-2"
      >
        {toasts.map((t) => (
          <ToastCard key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </Ctx.Provider>
  );
}

function ToastCard({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: () => void;
}) {
  const Icon =
    toast.kind === "success"
      ? CheckCircle2
      : toast.kind === "error"
        ? AlertTriangle
        : Info;

  const color =
    toast.kind === "success"
      ? "text-emerald-600"
      : toast.kind === "error"
        ? "text-red-600"
        : "text-brand-600";

  return (
    <div
      role="status"
      className="pointer-events-auto flex items-start gap-2.5 rounded-lg border border-border bg-surface px-3.5 py-2.5 shadow-lg animate-in slide-in-from-right-5 duration-200"
    >
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${color}`} strokeWidth={2} />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-text">{toast.title}</div>
        {toast.desc && (
          <div className="mt-0.5 text-xs text-text-muted">{toast.desc}</div>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="ml-1 text-text-subtle hover:text-text"
        aria-label="Dismiss"
      >
        <X className="h-3.5 w-3.5" strokeWidth={2} />
      </button>
    </div>
  );
}
