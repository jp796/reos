"use client";

/**
 * DemoGuard — wraps every page under /demo with a fetch interceptor
 * + helper hook that converts every "save / mutate" gesture into a
 * friendly "Sign up to save changes" toast. NEVER posts to /api.
 *
 * Two layers of safety:
 *   1. Component code can call `useDemoBlocker()` and call its
 *      `block()` function from any onClick / onSubmit handler.
 *   2. Belt-and-suspenders: we monkey-patch window.fetch so that any
 *      stray /api/* call from third-party demo code gets short-
 *      circuited with a stubbed JSON response (status 200, empty
 *      payload) and a single toast. This protects against forgotten
 *      handlers in copy-pasted UI components and lets prospects
 *      click anywhere without breaking the visual demo.
 *
 * Scoped to /demo only — the patch installs on mount and reverts on
 * unmount, so the rest of the app is untouched.
 */

import { createContext, useContext, useEffect, useMemo } from "react";
import { useToast } from "@/app/ToastProvider";

interface DemoBlockerAPI {
  /** Call from any save/add/delete/toggle handler. Always returns true
   * (the handler should return early). */
  block: (action?: string) => true;
}

const Ctx = createContext<DemoBlockerAPI | null>(null);

export function useDemoBlocker(): DemoBlockerAPI {
  const api = useContext(Ctx);
  if (api) return api;
  // Outside the provider — fail closed (never silently mutate).
  return {
    block: () => true,
  };
}

export function DemoGuard({ children }: { children: React.ReactNode }) {
  const toast = useToast();

  const api = useMemo<DemoBlockerAPI>(
    () => ({
      block: (action) => {
        toast.info(
          "Sign up to save changes",
          action
            ? `Demo mode — "${action}" is read-only here.`
            : "This is a sandbox. Sign up to save your work.",
        );
        return true;
      },
    }),
    [toast],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const realFetch = window.fetch.bind(window);

    const patched: typeof window.fetch = async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      const method = (init?.method ?? "GET").toUpperCase();
      const isApi = url.startsWith("/api/") || url.includes("/api/");
      const isMutation = method !== "GET" && method !== "HEAD";

      if (isApi && isMutation) {
        // Show a single toast and short-circuit. We return a 200 with
        // a stub body so the calling component's success path runs
        // (no thrown errors, no broken UI), but no real mutation
        // ever leaves the browser.
        toast.info(
          "Sign up to save changes",
          "Demo mode — your edits aren't persisted.",
        );
        return new Response(JSON.stringify({ ok: true, demo: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Reads are also blocked — the demo doesn't need /api/* at all,
      // and any GET that does fire would return 401 from middleware
      // anyway. Stub a 200 with an empty array/object so loaders
      // resolve gracefully instead of erroring.
      if (isApi) {
        return new Response(JSON.stringify({ ok: true, demo: true, data: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return realFetch(input as RequestInfo, init);
    };

    window.fetch = patched;
    return () => {
      window.fetch = realFetch;
    };
  }, [toast]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
