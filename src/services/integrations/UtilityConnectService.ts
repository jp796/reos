/**
 * UtilityConnectService
 *
 * Thin wrapper around Utility Connect's partner API.
 *   POST /lead       — create a buyer-side utility enrollment lead
 *   POST /customers  — (planned) push enriched customer record
 *
 * Auth = HTTP Basic over the partner_code-scoped username + password
 * supplied by Utility Connect. Credentials live in env (Secret
 * Manager → Cloud Run env). When unset, every method throws so the
 * caller's catch path keeps the rest of REOS working.
 *
 * Idempotency: callers MUST check Transaction.utilityConnectLeadId
 * before invoking createLead — the API doesn't dedupe and a re-fire
 * creates a fresh lead row in UC.
 */

import { env } from "@/lib/env";

export interface UCLeadInput {
  firstname: string;
  lastname: string;
  primary_phone: string;
  address1: string;
  city: string;
  zipcode: string;
  state: string;

  // Optional — populated when we have it
  email?: string;
  secondary_phone?: string;
  address2?: string;
  /** MM-DD-YYYY per UC's spec. */
  move_in_date?: string;
  transaction_type?: "buyer" | "seller";
  /** Comma-separated: "Water,Electricity,Cable". */
  services?: string;
  agent_email?: string;
}

export interface UCLeadResponse {
  customer_id: number;
  lead_id: string;
  reference_code: string;
}

export class UtilityConnectService {
  private readonly baseUrl: string;
  private readonly authHeader: string;
  private readonly partnerCode: string;

  constructor() {
    if (!env.UC_USER || !env.UC_PASS || !env.UC_PARTNER_CODE) {
      throw new Error(
        "Utility Connect credentials not configured (UC_USER / UC_PASS / UC_PARTNER_CODE)",
      );
    }
    this.baseUrl = env.UC_BASE_URL ?? "https://api.utilityconnect.net";
    this.partnerCode = env.UC_PARTNER_CODE;
    this.authHeader =
      "Basic " +
      Buffer.from(`${env.UC_USER}:${env.UC_PASS}`).toString("base64");
  }

  static isConfigured(): boolean {
    return !!(env.UC_USER && env.UC_PASS && env.UC_PARTNER_CODE);
  }

  /** Sanity-check the partner credentials. Returns true on 200. */
  async partnerCheck(): Promise<boolean> {
    const res = await fetch(`${this.baseUrl}/partner_check`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: this.authHeader,
      },
      body: JSON.stringify({ partner_code: this.partnerCode }),
    });
    return res.ok;
  }

  /** Create a UC lead. Throws on non-2xx so the caller can audit. */
  async createLead(input: UCLeadInput): Promise<UCLeadResponse> {
    const body: Record<string, unknown> = {
      ...input,
      partner_code: this.partnerCode,
    };
    const res = await fetch(`${this.baseUrl}/lead`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: this.authHeader,
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(
        `UC /lead ${res.status}: ${text.slice(0, 300) || "(no body)"}`,
      );
    }
    let parsed: UCLeadResponse;
    try {
      parsed = JSON.parse(text) as UCLeadResponse;
    } catch {
      throw new Error(`UC /lead returned non-JSON: ${text.slice(0, 200)}`);
    }
    if (!parsed.customer_id || !parsed.lead_id) {
      throw new Error(`UC /lead missing ids in response: ${text.slice(0, 200)}`);
    }
    return parsed;
  }

  /**
   * Build the public enrollment URL the buyer can click. UC encodes
   * the lead inside `reference_code` so this becomes a direct link
   * into the buyer-facing flow.
   *
   * NOTE: UC has not published the canonical URL pattern. The most
   * common pattern is `/start/<reference_code>`. If the actual
   * pattern differs, edit here — every call site uses this method.
   */
  enrollmentUrl(referenceCode: string): string {
    const host = this.baseUrl.replace(/\/+$/, "").replace(
      /^https?:\/\/(api|dev)\./,
      "https://",
    );
    return `${host}/start/${encodeURIComponent(referenceCode)}`;
  }
}
