/**
 * GoogleOAuthService
 *
 * Ported from the architecture artifact with fixes:
 *  - PrismaClient, EncryptionService imports wired
 *  - State now carries accountId + a nonce for CSRF protection
 *  - Token storage path extracted from OAuth logic for testability
 */

import { google } from "googleapis";
import type { OAuth2Client, Credentials } from "google-auth-library";
import type { PrismaClient } from "@prisma/client";
import { EncryptionService } from "@/lib/encryption";

// ==================================================
// SCOPES
// ==================================================

export const GOOGLE_SCOPES = {
  GMAIL_READONLY: "https://www.googleapis.com/auth/gmail.readonly",
  GMAIL_MODIFY: "https://www.googleapis.com/auth/gmail.modify",
  GMAIL_COMPOSE: "https://www.googleapis.com/auth/gmail.compose",
  GMAIL_SETTINGS_BASIC: "https://www.googleapis.com/auth/gmail.settings.basic",
  CALENDAR_READONLY: "https://www.googleapis.com/auth/calendar.readonly",
  CALENDAR_MODIFY: "https://www.googleapis.com/auth/calendar",
  DRIVE_READONLY: "https://www.googleapis.com/auth/drive.readonly",
  DRIVE_FILE: "https://www.googleapis.com/auth/drive.file",
  USER_INFO_EMAIL: "https://www.googleapis.com/auth/userinfo.email",
  USER_INFO_PROFILE: "https://www.googleapis.com/auth/userinfo.profile",
} as const;

export const DEFAULT_SCOPES: string[] = [
  GOOGLE_SCOPES.GMAIL_READONLY,
  GOOGLE_SCOPES.GMAIL_MODIFY,
  GOOGLE_SCOPES.GMAIL_SETTINGS_BASIC, // SmartFolder — create Gmail filters
  GOOGLE_SCOPES.CALENDAR_MODIFY,
  GOOGLE_SCOPES.USER_INFO_EMAIL,
  GOOGLE_SCOPES.USER_INFO_PROFILE,
];

// ==================================================
// CONFIG & TOKEN TYPES
// ==================================================

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
}

export interface StoredGoogleTokens {
  tokens: Credentials;
  userEmail: string;
  connectedAt: string;
  lastRefreshedAt?: string;
  scopes: string[];
}

export interface OAuthState {
  accountId: string;
  nonce: string;
  ts: number;
}

// ==================================================
// SERVICE
// ==================================================

export class GoogleOAuthService {
  constructor(
    private readonly config: GoogleOAuthConfig,
    private readonly db: PrismaClient,
    private readonly encryption: EncryptionService,
  ) {}

  private newClient(): OAuth2Client {
    return new google.auth.OAuth2(
      this.config.clientId,
      this.config.clientSecret,
      this.config.redirectUri,
    );
  }

  /**
   * Authorization URL with CSRF-safe state.
   */
  generateAuthUrl(accountId: string, nonce: string): string {
    const state: OAuthState = { accountId, nonce, ts: Date.now() };
    return this.newClient().generateAuthUrl({
      access_type: "offline",
      scope: this.config.scopes,
      prompt: "consent", // force refresh_token on re-auth
      include_granted_scopes: true,
      state: Buffer.from(JSON.stringify(state)).toString("base64url"),
    });
  }

  static parseState(raw: string): OAuthState {
    const json = Buffer.from(raw, "base64url").toString("utf8");
    const parsed = JSON.parse(json) as Partial<OAuthState>;
    if (
      typeof parsed.accountId !== "string" ||
      typeof parsed.nonce !== "string" ||
      typeof parsed.ts !== "number"
    ) {
      throw new Error("Invalid OAuth state payload");
    }
    return parsed as OAuthState;
  }

  /**
   * Exchange authorization code for tokens + user email.
   */
  async exchangeCodeForTokens(
    code: string,
  ): Promise<{ tokens: Credentials; userEmail: string }> {
    const client = this.newClient();
    const { tokens } = await client.getToken(code);
    if (!tokens.refresh_token) {
      throw new Error(
        "Google returned no refresh_token. Revoke existing consent at " +
          "https://myaccount.google.com/permissions and retry.",
      );
    }
    client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: "v2", auth: client });
    const { data } = await oauth2.userinfo.get();
    if (!data.email) {
      throw new Error("Google did not return a user email");
    }
    return { tokens, userEmail: data.email };
  }

  async storeTokens(
    accountId: string,
    tokens: Credentials,
    userEmail: string,
  ): Promise<void> {
    const payload: StoredGoogleTokens = {
      tokens,
      userEmail,
      connectedAt: new Date().toISOString(),
      scopes: this.config.scopes,
    };
    const encrypted = this.encryption.encrypt(JSON.stringify(payload));
    await this.db.account.update({
      where: { id: accountId },
      data: { googleOauthTokensEncrypted: encrypted },
    });
  }

  async getStoredTokens(
    accountId: string,
  ): Promise<StoredGoogleTokens | null> {
    const account = await this.db.account.findUnique({
      where: { id: accountId },
      select: { googleOauthTokensEncrypted: true },
    });
    if (!account?.googleOauthTokensEncrypted) return null;
    try {
      const decrypted = this.encryption.decrypt(
        account.googleOauthTokensEncrypted,
      );
      return JSON.parse(decrypted) as StoredGoogleTokens;
    } catch (err) {
      console.error("Failed to decrypt Google tokens:", err);
      return null;
    }
  }

  /**
   * Returns an OAuth2Client with credentials set and refreshed if needed.
   */
  async createAuthenticatedClient(accountId: string): Promise<OAuth2Client> {
    const stored = await this.getStoredTokens(accountId);
    if (!stored) {
      throw new Error(
        "No Google tokens stored. Connect Google from the settings page.",
      );
    }
    const client = this.newClient();
    client.setCredentials(stored.tokens);

    if (this.isTokenExpired(stored.tokens)) {
      const { credentials } = await client.refreshAccessToken();
      const merged: Credentials = {
        ...stored.tokens,
        ...credentials,
      };
      client.setCredentials(merged);
      await this.storeTokens(accountId, merged, stored.userEmail);
    }

    return client;
  }

  private isTokenExpired(tokens: Credentials): boolean {
    if (!tokens.expiry_date) return false;
    const bufferMs = 5 * 60 * 1000;
    return Date.now() + bufferMs >= tokens.expiry_date;
  }

  async disconnect(accountId: string): Promise<void> {
    const stored = await this.getStoredTokens(accountId);
    if (stored) {
      try {
        const client = this.newClient();
        client.setCredentials(stored.tokens);
        await client.revokeCredentials();
      } catch (err) {
        console.warn("Failed to revoke Google tokens:", err);
      }
    }
    await this.db.account.update({
      where: { id: accountId },
      data: { googleOauthTokensEncrypted: null },
    });
  }

  async validateConnection(accountId: string): Promise<{
    isValid: boolean;
    userEmail?: string;
    scopes: string[];
    missingScopes: string[];
  }> {
    try {
      const client = await this.createAuthenticatedClient(accountId);
      const stored = await this.getStoredTokens(accountId);
      if (!stored) {
        return {
          isValid: false,
          scopes: [],
          missingScopes: this.config.scopes,
        };
      }
      const oauth2 = google.oauth2({ version: "v2", auth: client });
      const { data } = await oauth2.tokeninfo();
      const current = data.scope?.split(" ") ?? [];
      const missing = this.config.scopes.filter((s) => !current.includes(s));
      return {
        isValid: true,
        userEmail: stored.userEmail,
        scopes: current,
        missingScopes: missing,
      };
    } catch {
      return {
        isValid: false,
        scopes: [],
        missingScopes: this.config.scopes,
      };
    }
  }
}

// ==================================================
// FACTORIES
// ==================================================

export class GoogleServiceFactory {
  constructor(private readonly oauth: GoogleOAuthService) {}

  async gmail(accountId: string) {
    const auth = await this.oauth.createAuthenticatedClient(accountId);
    return google.gmail({ version: "v1", auth });
  }

  async calendar(accountId: string) {
    const auth = await this.oauth.createAuthenticatedClient(accountId);
    return google.calendar({ version: "v3", auth });
  }

  async drive(accountId: string) {
    const auth = await this.oauth.createAuthenticatedClient(accountId);
    return google.drive({ version: "v3", auth });
  }
}
