/**
 * RealApiService — client for Real Broker's (Rezen's) backend APIs.
 *
 * Maps to two of Real's public Spring services:
 *   - keymaker.therealbrokerage.com — auth (username/password → JWT)
 *   - sherlock.therealbrokerage.com — checklists + checklist documents
 *
 * Auth model: HTTP bearer JWT. We sign in once with the agent's Real
 * credentials, store the JWT (encrypted) on the Account, and send it
 * as `Authorization: Bearer <jwt>` to sherlock. Tokens are long-lived
 * but DO expire — callers should catch 401 and prompt a reconnect.
 *
 * Document-push flow (see RezenPushService):
 *   1. signIn() → { accessToken, userId }
 *   2. searchChecklist(rezenTransactionId, "TRANSACTION") → checklistId
 *   3. getChecklistItems(checklistId) → ItemResponse[]
 *   4. uploadDocumentToItem(itemId, { file, name, uploaderId,
 *      transactionId }) per matched doc
 *
 * This integrates the agent's OWN Real account with their OWN
 * transactions — the exact workflow the API exists for.
 */

const KEYMAKER = "https://keymaker.therealbrokerage.com";
const SHERLOCK = "https://sherlock.therealbrokerage.com";

export interface RealSignInResult {
  accessToken: string;
  userId: string;
  email: string | null;
  mfaType: string | null;
  forceMfa: boolean;
  errorMessage: string | null;
}

export interface RealChecklistItem {
  id: string;
  name: string;
  checklistId: string;
  required: boolean;
  status: string;
  complete: boolean;
  documents: unknown[];
}

export class RealApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public needsReconnect = false,
  ) {
    super(message);
    this.name = "RealApiError";
  }
}

/**
 * Sign in to keymaker. Returns the JWT + userId on success. When the
 * account requires MFA, forceMfa is true and accessToken is empty —
 * the caller surfaces an "MFA not supported yet" message (Real's MFA
 * flow needs a second round trip we don't wire in v1).
 */
export async function signIn(
  usernameOrEmail: string,
  password: string,
): Promise<RealSignInResult> {
  const res = await fetch(`${KEYMAKER}/api/v1/auth/signin`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ usernameOrEmail, password }),
  });
  if (!res.ok) {
    let msg = `Real sign-in failed (${res.status})`;
    try {
      const body = (await res.json()) as { errorMessage?: string; message?: string };
      msg = body.errorMessage ?? body.message ?? msg;
    } catch {
      /* keep default */
    }
    throw new RealApiError(msg, res.status, res.status === 401);
  }
  const data = (await res.json()) as {
    accessToken?: string;
    userId?: string;
    email?: string;
    mfaType?: string;
    forceMfa?: boolean;
    errorMessage?: string;
  };
  return {
    accessToken: data.accessToken ?? "",
    userId: data.userId ?? "",
    email: data.email ?? null,
    mfaType: data.mfaType ?? null,
    forceMfa: !!data.forceMfa,
    errorMessage: data.errorMessage ?? null,
  };
}

function authHeaders(jwt: string): Record<string, string> {
  return { Authorization: `Bearer ${jwt}`, Accept: "application/json" };
}

async function sherlockJson<T>(
  jwt: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${SHERLOCK}${path}`, {
    ...init,
    headers: { ...authHeaders(jwt), ...(init?.headers ?? {}) },
  });
  if (res.status === 401 || res.status === 403) {
    throw new RealApiError(
      "Real session expired — reconnect your account in Settings → Integrations.",
      res.status,
      true,
    );
  }
  if (!res.ok) {
    throw new RealApiError(
      `Sherlock ${path} → ${res.status}: ${(await res.text()).slice(0, 200)}`,
      res.status,
    );
  }
  return (await res.json()) as T;
}

/**
 * Find the checklist for a Rezen transaction (or listing).
 * GET /api/v1/checklists/search?parentId=&parentType=
 * Returns the first checklist id, or null when the deal has none.
 */
export async function searchChecklist(
  jwt: string,
  parentId: string,
  parentType: "TRANSACTION" | "LISTING" = "TRANSACTION",
): Promise<{ checklistId: string | null; raw: unknown }> {
  const qs = new URLSearchParams({
    parentId,
    parentType,
    page: "0",
    size: "20",
  });
  const data = await sherlockJson<unknown>(
    jwt,
    `/api/v1/checklists/search?${qs.toString()}`,
  );
  // The search response is a Spring Page<...>; the checklist id can be
  // on the page content rows or be the row id directly. Be liberal.
  const rows = extractRows(data);
  const first = rows[0] as Record<string, unknown> | undefined;
  const checklistId =
    (first?.id as string) ??
    (first?.checklistId as string) ??
    null;
  return { checklistId, raw: data };
}

function extractRows(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    if (Array.isArray(o.content)) return o.content;
    if (Array.isArray(o.results)) return o.results;
    if (Array.isArray(o.items)) return o.items;
  }
  return [];
}

/** GET /api/v1/checklists/{checklistId}/items → ItemResponse[] */
export async function getChecklistItems(
  jwt: string,
  checklistId: string,
): Promise<RealChecklistItem[]> {
  const data = await sherlockJson<unknown>(
    jwt,
    `/api/v1/checklists/${checklistId}/items`,
  );
  const rows = extractRows(data).length ? extractRows(data) : (Array.isArray(data) ? data : []);
  return (rows as Record<string, unknown>[]).map((r) => ({
    id: String(r.id ?? ""),
    name: String(r.name ?? ""),
    checklistId: String(r.checklistId ?? checklistId),
    required: !!r.required,
    status: String(r.status ?? ""),
    complete: !!r.complete,
    documents: Array.isArray(r.documents) ? r.documents : [],
  }));
}

/**
 * POST /api/v1/checklists/checklist-items/{checklistItemId}/documents
 * multipart/form-data: VersionUploadRequest
 *   { name, description?, uploaderId, file, transactionId }
 */
export async function uploadDocumentToItem(
  jwt: string,
  checklistItemId: string,
  args: {
    fileBytes: Uint8Array;
    fileName: string;
    mimeType: string;
    name: string;
    uploaderId: string;
    transactionId: string;
    description?: string;
  },
): Promise<{ ok: true; raw: unknown }> {
  const form = new FormData();
  form.append("name", args.name);
  if (args.description) form.append("description", args.description);
  form.append("uploaderId", args.uploaderId);
  form.append("transactionId", args.transactionId);
  // Copy into a fresh ArrayBuffer-backed view so the Blob type checks
  // (the incoming Uint8Array may be SharedArrayBuffer-backed).
  const bytes = new Uint8Array(args.fileBytes.byteLength);
  bytes.set(args.fileBytes);
  form.append(
    "file",
    new Blob([bytes], { type: args.mimeType || "application/pdf" }),
    args.fileName,
  );

  const res = await fetch(
    `${SHERLOCK}/api/v1/checklists/checklist-items/${checklistItemId}/documents`,
    { method: "POST", headers: authHeaders(jwt), body: form },
  );
  if (res.status === 401 || res.status === 403) {
    throw new RealApiError(
      "Real session expired during upload — reconnect and retry.",
      res.status,
      true,
    );
  }
  if (!res.ok) {
    throw new RealApiError(
      `Upload to item ${checklistItemId} → ${res.status}: ${(await res.text()).slice(0, 200)}`,
      res.status,
    );
  }
  let raw: unknown = null;
  try {
    raw = await res.json();
  } catch {
    /* some endpoints 204 */
  }
  return { ok: true, raw };
}

/** PUT /api/v1/checklists/checklist-items/{checklistItemId}/complete */
export async function markItemComplete(
  jwt: string,
  checklistItemId: string,
): Promise<void> {
  await sherlockJson(
    jwt,
    `/api/v1/checklists/checklist-items/${checklistItemId}/complete`,
    { method: "PUT" },
  );
}
