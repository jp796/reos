/**
 * GmailLabelService
 *
 * Manages Gmail labels for per-transaction organization. Gmail uses labels
 * (not folders), and a "/" in the name produces nested labels in the UI, so
 *   "REOS/Transactions/4567 Oak Dr, Nixa MO"
 * displays as:
 *   REOS
 *     Transactions
 *       4567 Oak Dr, Nixa MO
 *
 * Caches label IDs to avoid a list call on every apply.
 */

import type { gmail_v1 } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { makeSafeGmail } from "@/lib/gmail-guard";

const DEFAULT_LABEL_PREFIX = "REOS/Transactions";

export interface GmailLabelServiceConfig {
  /** Parent hierarchy — default "REOS/Transactions" */
  labelPrefix?: string;
}

export class GmailLabelService {
  private gmail: gmail_v1.Gmail;
  private prefix: string;
  private idCache = new Map<string, string>(); // name → id

  constructor(auth: OAuth2Client, config: GmailLabelServiceConfig = {}) {
    // Guarded Gmail client — see src/lib/gmail-guard.ts. Blocks delete/
    // trash/send/batchDelete/batchModify even if called by accident.
    this.gmail = makeSafeGmail(auth);
    this.prefix = config.labelPrefix ?? DEFAULT_LABEL_PREFIX;
  }

  /** Full label name for a given transaction title (e.g. an address). */
  labelNameFor(transactionTitle: string): string {
    const clean = transactionTitle.replace(/\//g, "—").trim();
    return `${this.prefix}/${clean}`;
  }

  /**
   * Returns the label ID for `name`, creating the label if needed.
   * Handles creating missing parent labels too ("REOS" and "REOS/Transactions").
   */
  async ensureLabel(name: string): Promise<string> {
    const cached = this.idCache.get(name);
    if (cached) return cached;

    // Seed cache with a one-shot list
    if (this.idCache.size === 0) {
      const res = await this.gmail.users.labels.list({ userId: "me" });
      for (const l of res.data.labels ?? []) {
        if (l.name && l.id) this.idCache.set(l.name, l.id);
      }
      const hit = this.idCache.get(name);
      if (hit) return hit;
    }

    // Ensure every parent in the path exists first so nested labels render right
    const segments = name.split("/");
    for (let i = 1; i < segments.length; i++) {
      const parent = segments.slice(0, i).join("/");
      if (!this.idCache.has(parent)) {
        await this.createLabel(parent);
      }
    }

    return this.createLabel(name);
  }

  private async createLabel(name: string): Promise<string> {
    const cached = this.idCache.get(name);
    if (cached) return cached;
    try {
      const res = await this.gmail.users.labels.create({
        userId: "me",
        requestBody: {
          name,
          labelListVisibility: "labelShow",
          messageListVisibility: "show",
        },
      });
      const id = res.data.id;
      if (!id) throw new Error(`label ${name} created without an ID`);
      this.idCache.set(name, id);
      return id;
    } catch (err: unknown) {
      // 409 = label already exists (race); fall back to a list lookup.
      if (this.isConflict(err)) {
        const res = await this.gmail.users.labels.list({ userId: "me" });
        for (const l of res.data.labels ?? []) {
          if (l.name && l.id) this.idCache.set(l.name, l.id);
        }
        const hit = this.idCache.get(name);
        if (hit) return hit;
      }
      throw err;
    }
  }

  async applyToThread(threadId: string, labelName: string): Promise<void> {
    const id = await this.ensureLabel(labelName);
    await this.gmail.users.threads.modify({
      userId: "me",
      id: threadId,
      requestBody: { addLabelIds: [id] },
    });
  }

  private isConflict(err: unknown): boolean {
    if (typeof err !== "object" || err === null) return false;
    const e = err as { code?: number; response?: { status?: number } };
    return e.code === 409 || e.response?.status === 409;
  }
}
