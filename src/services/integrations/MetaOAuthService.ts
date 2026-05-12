/**
 * MetaOAuthService
 *
 * Mirrors GoogleOAuthService's shape for the Facebook / Instagram
 * (Meta Graph API) OAuth flow.
 *
 * Key differences from Google:
 *   - Meta gives a SHORT-LIVED user token from the code exchange.
 *     We immediately exchange it for a LONG-LIVED user token (60d).
 *   - The long-lived USER token isn't what we use to post to a Page.
 *     We use it to fetch the user's Pages, each of which has its
 *     own PAGE-SCOPED long-lived token. Those page tokens are what
 *     we use for actual posting.
 *   - Instagram Business accounts are linked to Pages. After we have
 *     the page list, we probe each Page for a linked IG Business
 *     account and store the IG account id alongside the page.
 *
 * Storage: one encrypted JSON blob on Account.metaOauthTokensEncrypted.
 * The blob is StoredMetaTokens (below). Same pattern as Google.
 */

import type { PrismaClient } from "@prisma/client";
import type { EncryptionService } from "@/lib/encryption";

const GRAPH_API_VERSION = "v18.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
const AUTH_BASE = `https://www.facebook.com/${GRAPH_API_VERSION}/dialog/oauth`;

/**
 * Default scopes — minimal set that works without app-dashboard
 * configuration. As you enable additional scopes in
 * developers.facebook.com → App Review → Permissions and Features
 * (or via the use-case customization), uncomment them below and
 * redeploy.
 *
 * The OAuth dialog rejects ("Invalid Scopes") any scope that isn't
 * declared on the app. Starting minimal lets the round-trip succeed
 * end-to-end on day one; we expand as the dashboard catches up.
 */
export const DEFAULT_META_SCOPES = [
  "public_profile",
  // "email",                       // enable in Use Cases → Authenticate → Customize → Permissions
  // "pages_show_list",             // enable in Use Cases → Manage Pages, or App Review for prod
  // "pages_manage_posts",          // App Review (Advanced Access)
  // "pages_read_engagement",       // App Review (Advanced Access)
  // "instagram_basic",             // enable in Use Cases → Instagram, or App Review
  // "instagram_content_publish",   // App Review (Advanced Access)
];

// =================================================================
// CONFIG & TOKEN TYPES
// =================================================================

export interface MetaOAuthConfig {
  appId: string;
  appSecret: string;
  redirectUri: string;
  scopes: string[];
}

export interface ConnectedPage {
  id: string;
  name: string;
  /** Page-scoped long-lived access token. */
  accessToken: string;
  /** Linked Instagram Business account, if any. */
  instagramBusinessAccountId?: string;
  instagramBusinessAccountUsername?: string;
}

export interface StoredMetaTokens {
  /** Long-lived user token (60d). */
  userToken: string;
  /** Meta user id (`me` resolved). */
  userId: string;
  /** Email from the FB profile if the user granted the `email` scope. */
  userEmail: string | null;
  /** All Pages the user granted us access to. */
  pages: ConnectedPage[];
  scopes: string[];
  connectedAt: string;
}

export interface MetaOAuthState {
  accountId: string;
  nonce: string;
  ts: number;
}

// =================================================================
// SERVICE
// =================================================================

export class MetaOAuthService {
  constructor(
    private readonly config: MetaOAuthConfig,
    private readonly db: PrismaClient,
    private readonly encryption: EncryptionService,
  ) {}

  /** Build the dialog URL the browser is redirected to for consent. */
  generateAuthUrl(accountId: string, nonce: string): string {
    const state: MetaOAuthState = { accountId, nonce, ts: Date.now() };
    const params = new URLSearchParams({
      client_id: this.config.appId,
      redirect_uri: this.config.redirectUri,
      scope: this.config.scopes.join(","),
      response_type: "code",
      state: Buffer.from(JSON.stringify(state)).toString("base64url"),
      auth_type: "rerequest", // force consent screen on re-auth
    });
    return `${AUTH_BASE}?${params.toString()}`;
  }

  static parseState(raw: string): MetaOAuthState {
    const json = Buffer.from(raw, "base64url").toString("utf8");
    const parsed = JSON.parse(json) as Partial<MetaOAuthState>;
    if (
      typeof parsed.accountId !== "string" ||
      typeof parsed.nonce !== "string" ||
      typeof parsed.ts !== "number"
    ) {
      throw new Error("Invalid Meta OAuth state payload");
    }
    return parsed as MetaOAuthState;
  }

  /**
   * Full code-for-tokens exchange: short-lived user token → long-lived
   * user token → user identity → user's pages → per-page IG accounts.
   * Returns the fully-populated StoredMetaTokens (not yet persisted).
   */
  async exchangeCodeForTokens(code: string): Promise<StoredMetaTokens> {
    // 1. Short-lived user token
    const shortLived = await this.fetchJSON(
      `${GRAPH_BASE}/oauth/access_token?` +
        new URLSearchParams({
          client_id: this.config.appId,
          client_secret: this.config.appSecret,
          redirect_uri: this.config.redirectUri,
          code,
        }).toString(),
    );
    const shortToken = (shortLived as { access_token?: string }).access_token;
    if (!shortToken) {
      throw new Error("Meta returned no access_token from code exchange");
    }

    // 2. Long-lived user token (60d)
    const longLived = await this.fetchJSON(
      `${GRAPH_BASE}/oauth/access_token?` +
        new URLSearchParams({
          grant_type: "fb_exchange_token",
          client_id: this.config.appId,
          client_secret: this.config.appSecret,
          fb_exchange_token: shortToken,
        }).toString(),
    );
    const userToken = (longLived as { access_token?: string }).access_token;
    if (!userToken) {
      throw new Error("Meta returned no long-lived access_token");
    }

    // 3. User identity (id + email if scope granted)
    const me = (await this.fetchJSON(
      `${GRAPH_BASE}/me?fields=id,email&access_token=${encodeURIComponent(userToken)}`,
    )) as { id?: string; email?: string };
    if (!me.id) throw new Error("Meta /me returned no id");

    // 4. User's Pages — each comes back with its own page-scoped token
    const pages = await this.fetchPages(userToken);

    return {
      userToken,
      userId: me.id,
      userEmail: me.email ?? null,
      pages,
      scopes: this.config.scopes,
      connectedAt: new Date().toISOString(),
    };
  }

  /** Pull pages + linked Instagram Business account for each. */
  private async fetchPages(userToken: string): Promise<ConnectedPage[]> {
    const result = (await this.fetchJSON(
      `${GRAPH_BASE}/me/accounts?` +
        new URLSearchParams({
          fields: "id,name,access_token,instagram_business_account",
          access_token: userToken,
        }).toString(),
    )) as {
      data?: Array<{
        id: string;
        name: string;
        access_token: string;
        instagram_business_account?: { id: string };
      }>;
    };
    const rows = result.data ?? [];

    // For each Page with a linked IG Business account, resolve the
    // IG username so the connection-status UI can label it.
    const pages: ConnectedPage[] = [];
    for (const r of rows) {
      let igUsername: string | undefined;
      if (r.instagram_business_account?.id) {
        try {
          const ig = (await this.fetchJSON(
            `${GRAPH_BASE}/${r.instagram_business_account.id}?fields=username&access_token=${encodeURIComponent(r.access_token)}`,
          )) as { username?: string };
          igUsername = ig.username;
        } catch (e) {
          console.warn(
            `[MetaOAuth] failed to fetch IG username for page ${r.id}:`,
            e,
          );
        }
      }
      pages.push({
        id: r.id,
        name: r.name,
        accessToken: r.access_token,
        instagramBusinessAccountId: r.instagram_business_account?.id,
        instagramBusinessAccountUsername: igUsername,
      });
    }
    return pages;
  }

  async storeTokens(
    accountId: string,
    payload: StoredMetaTokens,
  ): Promise<void> {
    const encrypted = this.encryption.encrypt(JSON.stringify(payload));
    await this.db.account.update({
      where: { id: accountId },
      data: { metaOauthTokensEncrypted: encrypted },
    });
  }

  async getStoredTokens(accountId: string): Promise<StoredMetaTokens | null> {
    const account = await this.db.account.findUnique({
      where: { id: accountId },
      select: { metaOauthTokensEncrypted: true },
    });
    if (!account?.metaOauthTokensEncrypted) return null;
    try {
      const decrypted = this.encryption.decrypt(
        account.metaOauthTokensEncrypted,
      );
      return JSON.parse(decrypted) as StoredMetaTokens;
    } catch (err) {
      console.error("Failed to decrypt Meta tokens:", err);
      return null;
    }
  }

  async disconnect(accountId: string): Promise<void> {
    // Best-effort revocation with Meta. We send DELETE on /me/permissions
    // so the user's consent is cleanly removed on their side too.
    const stored = await this.getStoredTokens(accountId);
    if (stored?.userToken) {
      try {
        await fetch(
          `${GRAPH_BASE}/me/permissions?access_token=${encodeURIComponent(stored.userToken)}`,
          { method: "DELETE" },
        );
      } catch (err) {
        console.warn("[MetaOAuth] permissions DELETE failed:", err);
      }
    }
    await this.db.account.update({
      where: { id: accountId },
      data: { metaOauthTokensEncrypted: null },
    });
  }

  // ---------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------

  private async fetchJSON(url: string): Promise<unknown> {
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Meta API ${res.status}: ${body.slice(0, 300)}`);
    }
    return res.json();
  }
}
