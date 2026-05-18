/**
 * Stable public base URL for redirects.
 *
 * Why this exists: inside a Cloud Run container, `req.url` (and any
 * URL constructed from it) reflects the internal bind address —
 * `http://0.0.0.0:8080/...` — not the public hostname. Redirecting
 * the browser there bricks the OAuth-completion flow (the browser
 * sees ERR_CONNECTION_REFUSED).
 *
 * Use this helper anywhere you need to build a Location header
 * pointing at OUR OWN domain. It prefers env.NEXT_PUBLIC_APP_URL
 * (set at deploy time, always points at https://myrealestateos.com)
 * and falls back to req.url for local dev / unit tests where the
 * env isn't populated.
 *
 * For redirects to THIRD-PARTY URLs (Google, Meta, Stripe, LinkedIn)
 * keep using whichever string the upstream provider returned —
 * those don't go through this helper.
 */

import { env } from "@/lib/env";

/**
 * Build an absolute URL on our own domain.
 *
 * @param path - path + optional query string (e.g. "/settings/integrations?meta=connected")
 * @param req - the incoming request, used as a fallback when the env var isn't set (dev/test)
 */
export function appUrl(
  path: string,
  req: { url: string } | undefined = undefined,
): URL {
  const base = env.NEXT_PUBLIC_APP_URL ?? req?.url ?? "http://localhost:3000";
  return new URL(path, base);
}
