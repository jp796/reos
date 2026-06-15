/**
 * DealWorkspaceService — auto-scaffold a per-Asset Google Drive folder
 * tree and Google Chat deal space (spec §7, §11). This is the single
 * call site for the `(auto) scaffold_drive_chat` stage step.
 *
 * ── INTEGRATION BOUNDARY (read before enabling) ──────────────────────
 * Drive folder creation reuses the existing Google OAuth client, but
 * needs the Drive scope (`drive.file`) added to DEFAULT_SCOPES and a
 * re-consent — REOS currently requests Gmail scopes only. Google Chat
 * space creation needs the Chat API + space-management scopes, which
 * are not provisioned. Until those are granted and verified against the
 * live APIs, this service is gated OFF by env flags and is a safe no-op
 * (returns a structured "disabled" result, never throws into the caller).
 *
 *   INVESTOR_DRIVE_ENABLED=1  → attempt Drive folder scaffold
 *   INVESTOR_CHAT_ENABLED=1   → attempt Chat space creation
 *
 * Everything below the flag is real, wired logic — flip the flag once
 * scopes are granted and you've verified one deal end-to-end.
 */

import type { PrismaClient } from "@prisma/client";
import { google } from "googleapis";
import { env } from "@/lib/env";
import { getEncryptionService } from "@/lib/encryption";
import {
  GoogleOAuthService,
  DEFAULT_SCOPES,
} from "@/services/integrations/GoogleOAuthService";

type Db = PrismaClient;

export interface WorkspaceResult {
  drive: { enabled: boolean; folderId?: string | null; reason?: string };
  chat: { enabled: boolean; spaceId?: string | null; reason?: string };
}

function driveEnabled() {
  return process.env.INVESTOR_DRIVE_ENABLED === "1";
}
function chatEnabled() {
  return process.env.INVESTOR_CHAT_ENABLED === "1";
}

/**
 * Scaffold the deal workspace for an Asset. Non-blocking by contract:
 * any failure is captured in the result, never thrown — a stage advance
 * must not fail because Drive was unreachable.
 */
export async function scaffoldDealWorkspace(
  db: Db,
  opts: { assetId: string },
): Promise<WorkspaceResult> {
  const result: WorkspaceResult = {
    drive: { enabled: driveEnabled() },
    chat: { enabled: chatEnabled() },
  };

  const asset = await db.asset.findUnique({
    where: { id: opts.assetId },
    select: {
      id: true,
      accountId: true,
      address: true,
      driveFolderId: true,
      chatSpaceId: true,
    },
  });
  if (!asset) {
    result.drive.reason = "asset_not_found";
    result.chat.reason = "asset_not_found";
    return result;
  }

  // ── Drive folder tree ──
  if (!driveEnabled()) {
    result.drive.reason = "flag_off";
  } else if (asset.driveFolderId) {
    result.drive.folderId = asset.driveFolderId;
    result.drive.reason = "already_scaffolded";
  } else if (
    env.GOOGLE_CLIENT_ID &&
    env.GOOGLE_CLIENT_SECRET &&
    env.GOOGLE_REDIRECT_URI
  ) {
    try {
      const account = await db.account.findUnique({
        where: { id: asset.accountId },
        select: { googleOauthTokensEncrypted: true },
      });
      if (!account?.googleOauthTokensEncrypted) {
        result.drive.reason = "google_not_connected";
      } else {
        const oauth = new GoogleOAuthService(
          {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
            redirectUri: env.GOOGLE_REDIRECT_URI,
            scopes: DEFAULT_SCOPES,
          },
          db,
          getEncryptionService(),
        );
        const auth = await oauth.createAuthenticatedClient(asset.accountId);
        const drive = google.drive({ version: "v3", auth });
        const name = asset.address
          ? `REOS — ${asset.address}`.slice(0, 200)
          : `REOS Asset ${asset.id}`;
        const folder = await drive.files.create({
          requestBody: {
            name,
            mimeType: "application/vnd.google-apps.folder",
          },
          fields: "id",
        });
        const folderId = folder.data.id ?? null;
        if (folderId) {
          // Standard sub-tree per Asset.
          for (const sub of ["01 - Contract", "02 - Rehab", "03 - Closing"]) {
            await drive.files.create({
              requestBody: {
                name: sub,
                mimeType: "application/vnd.google-apps.folder",
                parents: [folderId],
              },
              fields: "id",
            });
          }
          await db.asset.update({
            where: { id: asset.id },
            data: { driveFolderId: folderId },
          });
          result.drive.folderId = folderId;
        }
      }
    } catch (err) {
      // Most likely: missing Drive scope on the token (needs re-consent).
      result.drive.reason =
        err instanceof Error ? `drive_error: ${err.message.slice(0, 120)}` : "drive_error";
    }
  } else {
    result.drive.reason = "google_env_missing";
  }

  // ── Google Chat space ──
  // Chat space + membership management needs the Chat API and scopes
  // REOS doesn't yet request. Left as a guarded no-op until provisioned.
  if (!chatEnabled()) {
    result.chat.reason = "flag_off";
  } else if (asset.chatSpaceId) {
    result.chat.spaceId = asset.chatSpaceId;
    result.chat.reason = "already_scaffolded";
  } else {
    result.chat.reason = "chat_api_not_provisioned";
  }

  return result;
}
