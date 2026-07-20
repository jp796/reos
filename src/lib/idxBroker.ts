/**
 * Minimal IDX Broker API client (TypeScript / REOS).
 *
 * Auth & conventions (per IDX Broker developer docs):
 *   - Base URL:  https://api.idxbroker.com
 *   - Required headers:
 *       accesskey:     <your 22-char key>   (from process.env, never hard-coded)
 *       Content-Type:  application/x-www-form-urlencoded
 *   - Optional headers: outputtype (json), apiversion
 *   - Rate limit: hourly, per access key. Response header
 *       `Hourly-Access-Key-Usage` reports usage; exceeding the cap -> HTTP 412,
 *       surfaced here as RateLimitError.
 *
 * The key lives ONLY in the environment (.env.local for Next.js, git-ignored).
 * Docs: https://developers.idxbroker.com/idx-broker-api/
 */

const BASE_URL = "https://api.idxbroker.com";

export class IDXBrokerError extends Error {}
export class RateLimitError extends IDXBrokerError {}

const SOLD_STATUSES = new Set(["sold", "closed", "s", "c"]);
const PENDING_STATUSES = new Set(["pending", "under contract", "p", "u"]);

export interface IDXBrokerConfig {
  apiKey?: string;
  output?: string;
  apiVersion?: string;
  timeoutMs?: number;
}

type Json = Record<string, unknown> | unknown[];

export class IDXBrokerClient {
  private apiKey: string;
  private output: string;
  private apiVersion: string;
  private timeoutMs: number;
  /** Usage reported by the last response's Hourly-Access-Key-Usage header. */
  lastHourlyUsage: string | null = null;

  constructor(cfg: IDXBrokerConfig = {}) {
    const key = cfg.apiKey ?? process.env.IDX_BROKER_API_KEY ?? "";
    if (!key) {
      throw new IDXBrokerError(
        "IDX_BROKER_API_KEY is not set. Add it to .env.local (git-ignored); " +
          "never hard-code the key or paste it into source.",
      );
    }
    this.apiKey = key;
    this.output = cfg.output ?? process.env.IDX_BROKER_OUTPUT ?? "json";
    this.apiVersion = cfg.apiVersion ?? process.env.IDX_BROKER_API_VERSION ?? "1.8.0";
    this.timeoutMs = cfg.timeoutMs ?? 30_000;
  }

  /** GET a component/method, e.g. get("clients/apiversion"). Returns parsed JSON. */
  async get(path: string): Promise<Json> {
    const url = `${BASE_URL}/${path.replace(/^\/+/, "")}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    let resp: Response;
    try {
      resp = await fetch(url, {
        method: "GET",
        headers: {
          accesskey: this.apiKey,
          outputtype: this.output,
          apiversion: this.apiVersion,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    this.lastHourlyUsage = resp.headers.get("Hourly-Access-Key-Usage");

    if (resp.status === 412) {
      throw new RateLimitError(
        `Hourly access-key limit exceeded (usage=${this.lastHourlyUsage}). ` +
          "Back off and retry next hour.",
      );
    }
    if (resp.status === 401) {
      throw new IDXBrokerError("401 Unauthorized — check IDX_BROKER_API_KEY.");
    }
    if (!resp.ok) {
      const body = (await resp.text()).slice(0, 200);
      throw new IDXBrokerError(`${resp.status} ${resp.statusText}: ${body}`);
    }

    const text = await resp.text();
    if (text.trim() === "" || text.trim() === "[]") return [];
    return JSON.parse(text) as Json;
  }

  /** Cheapest call — verifies the key works. */
  apiVersionInfo() {
    return this.get("clients/apiversion");
  }

  /** MLS(es) this account is approved to pull — confirms SOMO coverage. */
  approvedMls() {
    return this.get("mls/approvedmls");
  }

  featuredListings() {
    return this.get("clients/featured");
  }

  /**
   * Fetch listings and return only sold (optionally pending) records.
   * Returns [] cleanly when the endpoint/MLS provides no solds — that empty
   * result is itself the signal that solds must come from a direct RESO feed.
   *
   * `endpoint` is overridable because the method carrying solds varies by
   * account/MLS (candidates: clients/soldpending, clients/featured, clients/supplemental).
   */
  async pullSolds(
    endpoint = "clients/soldpending",
    opts: { includePending?: boolean } = {},
  ): Promise<Record<string, unknown>[]> {
    const wanted = new Set(SOLD_STATUSES);
    if (opts.includePending) for (const s of PENDING_STATUSES) wanted.add(s);

    let data: Json;
    try {
      data = await this.get(endpoint);
    } catch (e) {
      if (e instanceof IDXBrokerError) {
        throw new IDXBrokerError(
          `pullSolds failed on '${endpoint}'. If this is a 'method not found' ` +
            `error, your account uses a different listing endpoint — try ` +
            `'clients/featured' or 'clients/supplemental'. Original: ${e.message}`,
        );
      }
      throw e;
    }

    const listings: unknown[] = Array.isArray(data) ? data : Object.values(data);
    return listings.filter(
      (l): l is Record<string, unknown> =>
        typeof l === "object" && l !== null && wanted.has(statusOf(l as Record<string, unknown>)),
    );
  }
}

/** Pull a status string from a listing across known field names. */
function statusOf(listing: Record<string, unknown>): string {
  for (const key of ["propStatus", "idxStatus", "status", "listingStatus"]) {
    const v = listing[key];
    if (v) return String(v).trim().toLowerCase();
  }
  return "";
}
