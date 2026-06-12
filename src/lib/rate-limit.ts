/**
 * In-memory fixed-window rate limiter — the "last resort" layer from
 * the scraper-guardrails skill. Per-instance only (resets on deploy,
 * not shared across Cloud Run instances). Good enough for the public
 * esign signer endpoints at current scale; upgrade path is Cloudflare
 * rules or Upstash Redis when REOS scales out.
 */

const buckets = new Map<string, { count: number; resetAt: number }>();
const MAX_BUCKETS = 10_000;

export function rateLimit(
  key: string,
  max: number,
  windowMs: number,
): { ok: boolean; retryAfterS: number } {
  const now = Date.now();

  // Lazy cleanup so the map can't grow unbounded under enumeration.
  if (buckets.size > MAX_BUCKETS) {
    for (const [k, v] of buckets) {
      if (v.resetAt <= now) buckets.delete(k);
    }
  }

  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterS: 0 };
  }
  b.count += 1;
  if (b.count > max) {
    return { ok: false, retryAfterS: Math.max(1, Math.ceil((b.resetAt - now) / 1000)) };
  }
  return { ok: true, retryAfterS: 0 };
}

/** First hop of x-forwarded-for (Cloud Run sets it), else "unknown". */
export function clientIp(req: Request): string {
  const xf = req.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0]!.trim();
  return "unknown";
}
