/**
 * DocumentStorage — the one place document bytes are read or written.
 *
 * REOS is migrating file bytes out of Postgres (Document.rawBytes, a bytea
 * column) into Google Cloud Storage. Storing multi-MB PDFs in the DB made
 * uploads slow, bloated backups, and put every byte through Cloud Run.
 *
 * Migration is incremental and non-breaking:
 *   - NEW uploads  → GCS; Document.gcsPath set, rawBytes null.
 *   - LEGACY docs  → bytes still in Document.rawBytes, gcsPath null.
 *   - EVERY reader calls getDocumentBytes(), which resolves whichever exists.
 *
 * So nothing breaks while old documents live in the DB, and no caller needs to
 * know where the bytes actually are. When the corpus is fully migrated, the
 * rawBytes fallback (and the column) can be dropped.
 *
 * Auth: on Cloud Run the SDK picks up Application Default Credentials (the
 * runtime service account) — no key file. Locally it uses gcloud ADC.
 */

import { Storage } from "@google-cloud/storage";

/** Bucket holding document bytes. Unset locally → GCS disabled, rawBytes only. */
const BUCKET = process.env.GCS_DOCUMENTS_BUCKET ?? "";

let cached: Storage | null = null;
function storage(): Storage {
  if (!cached) cached = new Storage();
  return cached;
}

/** True when GCS is configured; false → the app runs in rawBytes-only mode. */
export function gcsEnabled(): boolean {
  return BUCKET.length > 0;
}

/** The shape any reader must select to resolve bytes. */
export interface DocumentBytesSource {
  gcsPath?: string | null;
  rawBytes?: Buffer | Uint8Array | null;
}

/**
 * Resolve a document's bytes from wherever they live — GCS first, then the
 * legacy Postgres column. Returns null when the document has no bytes at all.
 * Never throws for a missing object; a GCS miss falls back to rawBytes.
 */
export async function getDocumentBytes(
  doc: DocumentBytesSource | null | undefined,
): Promise<Buffer | null> {
  if (!doc) return null;

  if (doc.gcsPath && gcsEnabled()) {
    try {
      const [buf] = await storage().bucket(BUCKET).file(doc.gcsPath).download();
      return buf;
    } catch {
      // Fall through to rawBytes — a doc mid-migration may have both.
    }
  }
  if (doc.rawBytes) return Buffer.from(doc.rawBytes);
  return null;
}

/** Deterministic object path — tenant-scoped so per-account export/delete is trivial. */
export function documentObjectPath(args: {
  accountId: string;
  transactionId: string;
  documentId: string;
  fileName: string;
}): string {
  const safeName = args.fileName.replace(/[^\w.\-]+/g, "_").slice(0, 120);
  return `accounts/${args.accountId}/transactions/${args.transactionId}/${args.documentId}/${safeName}`;
}

/** Upload bytes to GCS and return the stored object path. */
export async function putDocumentBytes(
  objectPath: string,
  bytes: Buffer | Uint8Array,
  mimeType: string,
): Promise<string> {
  if (!gcsEnabled()) throw new Error("GCS_DOCUMENTS_BUCKET not configured");
  await storage()
    .bucket(BUCKET)
    .file(objectPath)
    .save(Buffer.from(bytes), {
      contentType: mimeType || "application/octet-stream",
      resumable: false,
    });
  return objectPath;
}

/**
 * A short-lived signed URL the BROWSER can PUT directly to, so bytes never
 * transit Cloud Run. This is what makes uploads fast regardless of file size.
 */
export async function createSignedUploadUrl(args: {
  objectPath: string;
  mimeType: string;
  expiresInMs?: number;
}): Promise<string> {
  if (!gcsEnabled()) throw new Error("GCS_DOCUMENTS_BUCKET not configured");
  const [url] = await storage()
    .bucket(BUCKET)
    .file(args.objectPath)
    .getSignedUrl({
      version: "v4",
      action: "write",
      expires: Date.now() + (args.expiresInMs ?? 15 * 60 * 1000),
      contentType: args.mimeType || "application/octet-stream",
    });
  return url;
}

/** A short-lived signed URL for reading/downloading a stored document. */
export async function createSignedDownloadUrl(
  objectPath: string,
  expiresInMs = 15 * 60 * 1000,
): Promise<string | null> {
  if (!gcsEnabled()) return null;
  try {
    const [url] = await storage()
      .bucket(BUCKET)
      .file(objectPath)
      .getSignedUrl({ version: "v4", action: "read", expires: Date.now() + expiresInMs });
    return url;
  } catch {
    return null;
  }
}

/** Best-effort delete (document removal). Never throws. */
export async function deleteDocumentBytes(objectPath: string | null | undefined): Promise<void> {
  if (!objectPath || !gcsEnabled()) return;
  try {
    await storage().bucket(BUCKET).file(objectPath).delete({ ignoreNotFound: true });
  } catch {
    /* best-effort */
  }
}
