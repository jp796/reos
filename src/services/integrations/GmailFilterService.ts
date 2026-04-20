/**
 * GmailFilterService
 *
 * Creates Gmail filters that auto-apply a label to future messages
 * matching a query. Used by SmartFolder to keep a transaction's
 * folder filled automatically as new emails arrive.
 *
 * Uses `users.settings.filters` API — requires the
 * `gmail.settings.basic` OAuth scope (added to DEFAULT_SCOPES). If the
 * account hasn't re-auth'd since the scope was added, create() will
 * throw an insufficient-scope error; caller is responsible for
 * surfacing the re-connect flow.
 *
 * Gmail's filter `criteria.query` uses the same search operator syntax
 * as the search box (from:, to:, subject:, OR, quoted phrases, etc.).
 * Gmail limits a single filter's query to ~1500 chars.
 */

import { google, type gmail_v1 } from "googleapis";
import type { OAuth2Client } from "google-auth-library";

const MAX_QUERY_CHARS = 1400;

export interface CreateFilterArgs {
  /** Gmail search query that selects matching threads (e.g. `from:(a@x OR b@y) OR subject:"4567 Oak Dr"`) */
  query: string;
  /** Label ID to apply when a message matches */
  labelId: string;
}

export class GmailFilterService {
  private gmail: gmail_v1.Gmail;

  constructor(auth: OAuth2Client) {
    // Filters use settings namespace which is NOT guarded (guard only
    // covers destructive paths). Using the raw client here intentionally.
    this.gmail = google.gmail({ version: "v1", auth });
  }

  /**
   * Create a filter that auto-applies labelId to messages matching query.
   * Returns filter ID.
   *
   * Idempotent: if Gmail returns "Filter already exists" (409), we fall
   * back to listing filters and returning the ID of the existing match.
   * This handles duplicate transactions for the same contact + address
   * sharing an identical query.
   */
  async createFilter(args: CreateFilterArgs): Promise<string> {
    if (args.query.length > MAX_QUERY_CHARS) {
      throw new Error(
        `filter query is ${args.query.length} chars; Gmail limit ~${MAX_QUERY_CHARS}`,
      );
    }
    try {
      const res = await this.gmail.users.settings.filters.create({
        userId: "me",
        requestBody: {
          criteria: { query: args.query },
          action: { addLabelIds: [args.labelId] },
        },
      });
      const id = res.data.id;
      if (!id) throw new Error("filter created without an ID");
      return id;
    } catch (err) {
      if (this.isAlreadyExists(err)) {
        const existing = await this.findFilterByQuery(args.query);
        if (existing) return existing;
      }
      throw err;
    }
  }

  private isAlreadyExists(err: unknown): boolean {
    if (typeof err !== "object" || err === null) return false;
    const e = err as {
      code?: number;
      message?: string;
      response?: { status?: number };
    };
    if (e.code === 409 || e.response?.status === 409) return true;
    if (typeof e.message === "string" && /filter already exists/i.test(e.message))
      return true;
    return false;
  }

  /** Find an existing filter whose criteria.query matches exactly. */
  private async findFilterByQuery(query: string): Promise<string | null> {
    const filters = await this.listFilters();
    for (const f of filters) {
      if (f.criteria?.query === query && f.id) return f.id;
    }
    return null;
  }

  async listFilters(): Promise<gmail_v1.Schema$Filter[]> {
    const res = await this.gmail.users.settings.filters.list({ userId: "me" });
    return res.data.filter ?? [];
  }

  /**
   * Delete a filter by ID. Safe: does NOT delete any labels or messages,
   * only stops future auto-labeling.
   */
  async deleteFilter(filterId: string): Promise<void> {
    await this.gmail.users.settings.filters.delete({
      userId: "me",
      id: filterId,
    });
  }

  /**
   * Build a search query that matches messages involving any of the
   * given email addresses OR containing an address/subject phrase.
   * Returns null if no useful criteria could be built.
   */
  static buildQuery(opts: {
    emails?: string[];
    subjectPhrases?: string[];
  }): string | null {
    const emails = [...new Set((opts.emails ?? []).filter((e) => e.includes("@")))];
    const phrases = [...new Set((opts.subjectPhrases ?? []).filter(Boolean))];
    const parts: string[] = [];

    if (emails.length > 0) {
      const addr = emails.map((e) => e.trim()).join(" OR ");
      parts.push(`(from:(${addr}) OR to:(${addr}) OR cc:(${addr}))`);
    }
    for (const p of phrases) {
      // escape double quotes in the phrase
      const safe = p.replace(/"/g, "").trim();
      if (safe.length >= 4) parts.push(`subject:"${safe}"`);
    }
    if (parts.length === 0) return null;
    return parts.join(" OR ");
  }
}
