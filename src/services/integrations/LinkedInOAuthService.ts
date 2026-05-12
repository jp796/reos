/**
 * LinkedInOAuthService
 *
 * Mirrors MetaOAuthService for LinkedIn. Implements the "Sign In with
 * LinkedIn using OpenID Connect" + "Share on LinkedIn" OAuth 2.0 flow.
 *
 * Posting (in LinkedInPostService) uses the UGC Posts API with the
 * stored member URN as the author. The token is a member access
 * token — no Page-scoped tokens, no per-account-list to manage.
 *
 * Storage: one encrypted JSON blob on Account.linkedinOauthTokensEncrypted
 * with the StoredLinkedInTokens shape below.
 */

import type { PrismaClient } from "@prisma/client";
import type { EncryptionService } from "@/lib/encryption";

const AUTH_BASE = "https://www.linkedin.com/oauth/v2/authorization";
const TOKEN_ENDPOINT = "https://www.linkedin.com/oauth/v2/accessToken";
const USERINFO_ENDPOINT = "https://api.linkedin.com/v2/userinfo";

/**
 * Default scopes. All four are self-service (no app review needed)
 * under LinkedIn's "Sign In with LinkedIn using OpenID Connect" +
 * "Share on LinkedIn" product set. The combination gives us identity
 * + email + the ability to post on the member's behalf.
 *
 * Posting to a Company Page requires `w_organization_social`, which
 * IS app-review-gated — out of scope until JP has a Page he runs
 * through REOS.
 */
export const DEFAULT_LINKEDIN_SCOPES = [
  "openid",
  "profile",
  "email",
  "w_member_social",
];

// =================================================================
// CONFIG & TOKEN TYPES
// =================================================================

export interface LinkedInOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
}

export interface StoredLinkedInTokens {
  accessToken: string;
  /** LinkedIn issues these tokens; usually 60 days. */
  expiresAt: string;
  /** Refresh tokens are only issued to apps that requested them at
   * app-product setup time — many older apps don't get them. We store
   * if present, fall back to "force reconnect after expiry" otherwise. */
  refreshToken?: string;
  /** Member URN — used as `author` field in UGC posts. Format:
   * "urn:li:person:<id>". */
  memberUrn: string;
  /** OpenID `sub` — the LinkedIn member id. */
  memberId: string;
  /** Display name (preferred + family). */
  name: string | null;
  email: string | null;
  scopes: string[];
  connectedAt: string;
}

export interface LinkedInOAuthState {
  accountId: string;
  nonce: string;
  ts: number;
}

// =================================================================
// SERVICE
// =================================================================

export class LinkedInOAuthService {
  constructor(
    private readonly config: LinkedInOAuthConfig,
    private readonly db: PrismaClient,
    private readonly encryption: EncryptionService,
  ) {}

  generateAuthUrl(accountId: string, nonce: string): string {
    const state: LinkedInOAuthState = { accountId, nonce, ts: Date.now() };
    const params = new URLSearchParams({
      response_type: "code",
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      scope: this.config.scopes.join(" "),
      state: Buffer.from(JSON.stringify(state)).toString("base64url"),
    });
    return `${AUTH_BASE}?${params.toString()}`;
  }

  static parseState(raw: string): LinkedInOAuthState {
    const json = Buffer.from(raw, "base64url").toString("utf8");
    const parsed = JSON.parse(json) as Partial<LinkedInOAuthState>;
    if (
      typeof parsed.accountId !== "string" ||
      typeof parsed.nonce !== "string" ||
      typeof parsed.ts !== "number"
    ) {
      throw new Error("Invalid LinkedIn OAuth state payload");
    }
    return parsed as LinkedInOAuthState;
  }

  /** Full code-for-tokens exchange + userinfo lookup. */
  async exchangeCodeForTokens(code: string): Promise<StoredLinkedInTokens> {
    // 1. Token exchange (form-urlencoded body, per LinkedIn spec).
    const tokenRes = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        redirect_uri: this.config.redirectUri,
      }).toString(),
    });
    if (!tokenRes.ok) {
      const body = await tokenRes.text().catch(() => "");
      throw new Error(`LinkedIn token exchange ${tokenRes.status}: ${body.slice(0, 300)}`);
    }
    const tokenJson = (await tokenRes.json()) as {
      access_token?: string;
      expires_in?: number;
      refresh_token?: string;
    };
    if (!tokenJson.access_token) {
      throw new Error("LinkedIn returned no access_token");
    }
    const expiresAt = new Date(
      Date.now() + (tokenJson.expires_in ?? 60 * 24 * 3600) * 1000,
    ).toISOString();

    // 2. Userinfo (OpenID Connect endpoint — works for openid scope).
    const userRes = await fetch(USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    });
    if (!userRes.ok) {
      const body = await userRes.text().catch(() => "");
      throw new Error(`LinkedIn userinfo ${userRes.status}: ${body.slice(0, 300)}`);
    }
    const user = (await userRes.json()) as {
      sub?: string;
      name?: string;
      email?: string;
    };
    if (!user.sub) throw new Error("LinkedIn userinfo returned no sub");

    return {
      accessToken: tokenJson.access_token,
      expiresAt,
      refreshToken: tokenJson.refresh_token,
      memberUrn: `urn:li:person:${user.sub}`,
      memberId: user.sub,
      name: user.name ?? null,
      email: user.email ?? null,
      scopes: this.config.scopes,
      connectedAt: new Date().toISOString(),
    };
  }

  async storeTokens(
    accountId: string,
    payload: StoredLinkedInTokens,
  ): Promise<void> {
    const encrypted = this.encryption.encrypt(JSON.stringify(payload));
    await this.db.account.update({
      where: { id: accountId },
      data: { linkedinOauthTokensEncrypted: encrypted },
    });
  }

  async getStoredTokens(
    accountId: string,
  ): Promise<StoredLinkedInTokens | null> {
    const account = await this.db.account.findUnique({
      where: { id: accountId },
      select: { linkedinOauthTokensEncrypted: true },
    });
    if (!account?.linkedinOauthTokensEncrypted) return null;
    try {
      const decrypted = this.encryption.decrypt(
        account.linkedinOauthTokensEncrypted,
      );
      return JSON.parse(decrypted) as StoredLinkedInTokens;
    } catch (err) {
      console.error("Failed to decrypt LinkedIn tokens:", err);
      return null;
    }
  }

  async disconnect(accountId: string): Promise<void> {
    // LinkedIn doesn't offer a revoke endpoint we can call here — the
    // user can revoke from linkedin.com/psettings/permissions. We
    // clear the local blob; future reconnect requires fresh consent.
    await this.db.account.update({
      where: { id: accountId },
      data: { linkedinOauthTokensEncrypted: null },
    });
  }
}
