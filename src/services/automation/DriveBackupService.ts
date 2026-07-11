/**
 * DriveBackupService — redundantly save an uploaded document to the deal's
 * Google Drive folder so nothing is lost if REOS storage fails.
 *
 * Ensures a per-deal Drive folder exists (creating one on demand for ANY
 * deal, not just investor deals), then uploads the file bytes into it and
 * records the Drive file id on the Document.
 *
 * Best-effort + non-blocking by contract: any failure — most often a
 * missing `drive.file` scope until the user re-consents to Google — returns
 * a structured reason and NEVER throws into the caller. Callers should fire
 * this after the Document row is committed and ignore the result.
 *
 * Requires the `drive.file` scope in DEFAULT_SCOPES (added) + a Google
 * re-connect by the user to grant it. Kill switch: DRIVE_BACKUP_ENABLED=0.
 */

import type { PrismaClient } from "@prisma/client";
import { Readable } from "stream";
import { google } from "googleapis";
import { env } from "@/lib/env";
import { getEncryptionService } from "@/lib/encryption";
import {
  GoogleOAuthService,
  DEFAULT_SCOPES,
} from "@/services/integrations/GoogleOAuthService";

type Db = PrismaClient;

export interface DriveBackupResult {
  ok: boolean;
  fileId?: string;
  folderId?: string;
  reason?: string;
}

export async function backupDocumentToDrive(
  db: Db,
  opts: {
    transactionId: string;
    fileName: string;
    mimeType?: string | null;
    bytes: Buffer;
    documentId?: string;
  },
): Promise<DriveBackupResult> {
  if (process.env.DRIVE_BACKUP_ENABLED === "0") return { ok: false, reason: "disabled" };
  if (!opts.bytes || opts.bytes.length === 0) return { ok: false, reason: "empty" };
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REDIRECT_URI) {
    return { ok: false, reason: "google_env_missing" };
  }

  const txn = await db.transaction.findUnique({
    where: { id: opts.transactionId },
    select: {
      accountId: true,
      propertyAddress: true,
      assetId: true,
      asset: { select: { id: true, driveFolderId: true, address: true } },
    },
  });
  if (!txn) return { ok: false, reason: "txn_not_found" };

  const account = await db.account.findUnique({
    where: { id: txn.accountId },
    select: { googleOauthTokensEncrypted: true },
  });
  if (!account?.googleOauthTokensEncrypted) return { ok: false, reason: "google_not_connected" };

  try {
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
    const auth = await oauth.createAuthenticatedClient(txn.accountId);
    const drive = google.drive({ version: "v3", auth });

    // Ensure a per-deal Drive folder. Reuse the Asset's driveFolderId; make
    // one on demand if missing (works for retail deals too).
    let folderId = txn.asset?.driveFolderId ?? null;
    if (!folderId) {
      const name = `REOS — ${txn.asset?.address ?? txn.propertyAddress ?? opts.transactionId}`.slice(0, 200);
      const folder = await drive.files.create({
        requestBody: { name, mimeType: "application/vnd.google-apps.folder" },
        fields: "id",
      });
      folderId = folder.data.id ?? null;
      if (folderId && txn.asset?.id) {
        await db.asset.update({ where: { id: txn.asset.id }, data: { driveFolderId: folderId } });
      }
    }
    if (!folderId) return { ok: false, reason: "no_folder" };

    const uploaded = await drive.files.create({
      requestBody: { name: opts.fileName.slice(0, 240) || "document", parents: [folderId] },
      media: {
        mimeType: opts.mimeType ?? "application/octet-stream",
        body: Readable.from(opts.bytes),
      },
      fields: "id",
    });
    const fileId = uploaded.data.id ?? undefined;
    if (fileId && opts.documentId) {
      await db.document
        .update({ where: { id: opts.documentId }, data: { driveFileId: fileId } })
        .catch(() => {});
    }
    return { ok: true, fileId, folderId };
  } catch (err) {
    // Most common: token lacks drive.file scope (needs Google re-consent).
    return {
      ok: false,
      reason: err instanceof Error ? `drive_error: ${err.message.slice(0, 140)}` : "drive_error",
    };
  }
}
