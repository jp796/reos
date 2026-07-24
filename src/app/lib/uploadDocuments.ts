"use client";

/**
 * Direct-to-GCS document upload.
 *
 * Old path: browser → Cloud Run → Postgres (bytea), with AI analysis + a Drive
 * backup awaited inline. A few files could take 45–60s.
 *
 * New path: ask the server for signed URLs → PUT the bytes STRAIGHT to the
 * bucket (in parallel, with real progress) → confirm (fast) → kick analysis in
 * the background. Bytes never touch the app server, so upload time is just the
 * network.
 *
 * Falls back to the legacy multipart route when GCS isn't configured (the
 * upload-url endpoint answers 501), so this is safe to call everywhere.
 */

export interface UploadResult {
  ok: boolean;
  count: number;
  /** True when we used the legacy multipart route. */
  legacy: boolean;
  error?: string;
}

/** PUT one file to a signed URL with byte-level progress. */
function putToSignedUrl(
  url: string,
  file: File,
  onProgress: (loaded: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded);
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`upload failed (${xhr.status})`));
    xhr.onerror = () => reject(new Error("network error during upload"));
    xhr.send(file);
  });
}

export async function uploadDocuments(
  transactionId: string,
  files: File[],
  opts: {
    category?: string | null;
    origin?: string | null;
    /** 0–100 aggregate across all files. */
    onProgress?: (pct: number) => void;
  } = {},
): Promise<UploadResult> {
  if (files.length === 0) return { ok: true, count: 0, legacy: false };

  const totalBytes = files.reduce((s, f) => s + f.size, 0) || 1;
  const loadedPer = new Array(files.length).fill(0);
  const report = () => {
    const loaded = loadedPer.reduce((a, b) => a + b, 0);
    opts.onProgress?.(Math.min(99, Math.round((loaded / totalBytes) * 100)));
  };

  // 1. Ask for signed URLs.
  const prep = await fetch(`/api/transactions/${transactionId}/documents/upload-url`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      files: files.map((f) => ({ fileName: f.name, mimeType: f.type, size: f.size })),
      category: opts.category ?? null,
      origin: opts.origin ?? null,
    }),
  });

  // GCS not configured → caller-transparent fallback to the legacy route.
  if (prep.status === 501) {
    return uploadLegacy(transactionId, files, opts);
  }
  if (!prep.ok) {
    const msg = (await prep.json().catch(() => null))?.error ?? "could not start upload";
    return { ok: false, count: 0, legacy: false, error: msg };
  }
  const { uploads } = (await prep.json()) as {
    uploads: Array<{ documentId: string; fileName: string; uploadUrl: string }>;
  };

  // 2. PUT every file straight to the bucket, in parallel.
  try {
    await Promise.all(
      uploads.map((u, i) =>
        putToSignedUrl(u.uploadUrl, files[i], (loaded) => {
          loadedPer[i] = loaded;
          report();
        }),
      ),
    );
  } catch (e) {
    return {
      ok: false,
      count: 0,
      legacy: false,
      error: e instanceof Error ? e.message : "upload failed",
    };
  }

  // 3. Confirm (fast — no AI, no Drive backup on the critical path).
  const confirm = await fetch(`/api/transactions/${transactionId}/documents/confirm`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ documentIds: uploads.map((u) => u.documentId) }),
  });
  opts.onProgress?.(100);
  if (!confirm.ok) {
    return { ok: false, count: 0, legacy: false, error: "upload stored but confirm failed" };
  }

  // 4. Kick analysis in the background — deliberately NOT awaited, so the user
  //    is free immediately. The request keeps the instance alive to finish.
  void fetch(`/api/transactions/${transactionId}/documents/analyze`, { method: "POST" }).catch(
    () => {},
  );

  return { ok: true, count: uploads.length, legacy: false };
}

/** Legacy multipart upload (bytes through the server into Postgres). */
async function uploadLegacy(
  transactionId: string,
  files: File[],
  opts: { category?: string | null; origin?: string | null; onProgress?: (pct: number) => void },
): Promise<UploadResult> {
  const fd = new FormData();
  files.forEach((f) => fd.append("file", f));
  if (opts.category) fd.append("category", opts.category);
  if (opts.origin) fd.append("origin", opts.origin);

  const res = await new Promise<{ ok: boolean; status: number }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/transactions/${transactionId}/documents`, true);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) opts.onProgress?.(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status });
    xhr.onerror = () => reject(new Error("network error during upload"));
    xhr.send(fd);
  });

  return res.ok
    ? { ok: true, count: files.length, legacy: true }
    : { ok: false, count: 0, legacy: true, error: `upload failed (${res.status})` };
}
