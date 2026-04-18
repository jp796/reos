/**
 * Gmail API runtime kill-switch.
 *
 * The OAuth scope (`gmail.modify`) already forbids permanent delete, but
 * this adds a code-level guarantee that no future bug, refactor, or
 * LLM-generated patch can accidentally call something like
 * `messages.trash` or `drafts.send`.
 *
 * Implementation: after building a Gmail client, we walk a known list of
 * destructive API paths and replace each leaf method with a throwing stub.
 * We use direct replacement (not a Proxy) because googleapis uses lazy
 * getters for nested resources which Proxies interact with unreliably.
 *
 * If the Gmail API grows a new destructive method, add its dot-path here.
 */

import { google, type gmail_v1 } from "googleapis";
import type { OAuth2Client } from "google-auth-library";

/**
 * Exact dot-paths into the Gmail v1 client that must never execute.
 * Format: "users.<resource>.<method>".
 */
const BLOCKED_PATHS: readonly string[] = [
  // messages
  "users.messages.delete",
  "users.messages.batchDelete",
  "users.messages.batchModify",
  "users.messages.trash",
  "users.messages.untrash",
  "users.messages.send",
  "users.messages.import",
  "users.messages.insert",
  // threads
  "users.threads.delete",
  "users.threads.trash",
  "users.threads.untrash",
  // drafts (never created, but protected against future code)
  "users.drafts.create",
  "users.drafts.update",
  "users.drafts.delete",
  "users.drafts.send",
  // labels (we don't remove labels; belt & suspenders)
  "users.labels.delete",
] as const;

export class GmailGuardError extends Error {
  constructor(methodPath: string) {
    super(
      `GmailGuard: blocked destructive Gmail API call "${methodPath}". ` +
        `Allowed: list, get, create (labels only), modify threads for label apply.`,
    );
    this.name = "GmailGuardError";
  }
}

/**
 * Walk to the parent resource for each blocked path and replace the leaf
 * method with a throwing stub. Accessing nested segments triggers
 * googleapis' lazy getters so by the time we patch, the real method
 * reference is in place.
 */
function installGuards(client: gmail_v1.Gmail): void {
  for (const path of BLOCKED_PATHS) {
    const segments = path.split(".");
    // Walk to the parent of the leaf method.
    let obj: unknown = client;
    for (let i = 0; i < segments.length - 1; i++) {
      if (!obj || typeof obj !== "object") break;
      obj = (obj as Record<string, unknown>)[segments[i]];
    }
    if (!obj || typeof obj !== "object") continue;
    const parent = obj as Record<string, unknown>;
    const method = segments[segments.length - 1];

    // Only replace if the method actually exists — skips future / removed APIs.
    if (typeof parent[method] !== "function") continue;

    Object.defineProperty(parent, method, {
      value: () => {
        throw new GmailGuardError(path);
      },
      writable: false,
      configurable: true,
      enumerable: false,
    });
  }
}

/**
 * Create a Gmail v1 client that is provably unable to delete/trash/send/
 * import messages. Use this instead of `google.gmail(...)` everywhere in
 * the app.
 */
export function makeSafeGmail(auth: OAuth2Client): gmail_v1.Gmail {
  const client = google.gmail({ version: "v1", auth });
  installGuards(client);
  return client;
}

// Exported for tests.
export const _BLOCKED_PATHS = BLOCKED_PATHS;
