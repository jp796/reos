"use client";

/**
 * DocumentLibraryPanel
 *
 * Rich inventory for every document attached to a transaction.
 * Replaces the bare <li> list that used to render on the txn
 * detail page. Surfaces everything the DB already knows:
 *   - Source provenance (Gmail attachment / manual upload / FUB)
 *   - Manual category (contract / addendum / inspection / etc.)
 *   - AI classification result (Rezen slot suggestion + confidence)
 *   - Linked eSign request state (none / sent / completed)
 *   - Flags ("Needs signature", "Ready for Rezen")
 *   - Actions: Download · Re-classify · Open in Gmail · Delete
 *
 * Sending for signature itself lives in the existing EsignPanel
 * below this one — we just surface the *status* and link the user
 * over there. Avoids duplicating the modal/recipient picker.
 *
 * Server props (passed from page.tsx) are intentionally flat
 * primitives — easier to memoize, no Date/Buffer/JSONB hydration
 * concerns crossing the client boundary.
 */

import { type DragEvent, useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  Download,
  Trash2,
  Sparkles,
  ExternalLink,
  Mail,
  Upload as UploadIcon,
  FileText,
  HardDrive,
  X,
} from "lucide-react";
import { useToast } from "../../ToastProvider";

interface DocumentRow {
  id: string;
  fileName: string;
  mimeType: string;
  category: string | null;
  source: string; // "upload" | "gmail_attachment" | "fub_attachment"
  uploadOrigin: string | null;
  uploadedAt: string; // ISO
  suggestedRezenSlot: string | null;
  suggestedRezenConfidence: number | null;
  classifiedAt: string | null; // ISO
  hasRawBytes: boolean;
  hasExtractedText: boolean;
  // eSign state (rolled up from EsignRequest[])
  esignStatus: "none" | "draft" | "sent" | "completed" | "voided" | "error";
  esignSummary: string | null;
}

interface Props {
  transactionId: string;
  documents: DocumentRow[];
}

const CATEGORY_PILL: Record<string, { bg: string; text: string; border: string }> = {
  contract:   { bg: "#EEEDFE", text: "#3C3489", border: "#AFA9EC" },
  addendum:   { bg: "#E6F1FB", text: "#0C447C", border: "#85B7EB" },
  inspection: { bg: "#FAEEDA", text: "#633806", border: "#EF9F27" },
  appraisal:  { bg: "#FAEEDA", text: "#633806", border: "#EF9F27" },
  title:      { bg: "#EAF3DE", text: "#27500A", border: "#97C459" },
  closing:    { bg: "#EAF3DE", text: "#27500A", border: "#97C459" },
  other:      { bg: "#F1EFE8", text: "#444441", border: "#B4B2A9" },
};

const SOURCE_LABEL: Record<string, { label: string; Icon: typeof Mail }> = {
  upload:            { label: "Upload",   Icon: UploadIcon },
  gmail_attachment:  { label: "Gmail",    Icon: Mail },
  fub_attachment:    { label: "Follow Up Boss", Icon: Mail },
};

const CATEGORIES = [
  "contract",
  "addendum",
  "inspection",
  "appraisal",
  "title",
  "closing",
  "other",
] as const;

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtConfidence(c: number | null): string {
  if (c == null) return "—";
  return `${Math.round(c * 100)}%`;
}

/**
 * UploadDocsControl — drop ANY file(s) into this transaction's library.
 * Posts to POST /api/transactions/:id/documents, then refreshes so the
 * new docs appear here (and in the E-sign PDF picker + compliance audit).
 */
function UploadDocsControl({ transactionId }: { transactionId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [, startTransition] = useTransition();

  // Dismiss the modal on Escape (unless an upload is in flight).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy]);

  // After files land, reconcile the WHOLE document set so a new
  // notice/addendum's effect (amended dates, resolved contingencies,
  // completed tasks) shows up immediately. Cached per-doc reads mean
  // this only analyzes the new file(s), so it's fast. Non-blocking —
  // the upload already succeeded.
  async function syncFromDocuments() {
    try {
      const sr = await fetch(`/api/transactions/${transactionId}/synthesize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!sr.ok) return;
      const data = await sr.json();
      const changes = Array.isArray(data.changesApplied)
        ? data.changesApplied.length
        : 0;
      if (changes > 0) {
        toast.success(
          `Updated the deal from ${data.docCount ?? "the"} documents`,
          data.summary ?? `${changes} change(s) applied.`,
        );
      }
    } catch {
      /* non-blocking */
    }
  }

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    // A fresh single-PDF contract goes through the review/apply flow, so
    // we don't auto-synthesize over it. Everything else (added notices,
    // addenda, multi-file drops) gets reconciled automatically.
    let reviewFlow = false;
    try {
      const only = files.length === 1 ? files[0] : null;
      const isPdf =
        !!only && (only.type.includes("pdf") || /\.pdf$/i.test(only.name));

      if (only && isPdf) {
        // A single PDF: the contract endpoint BOTH stores it as a document
        // AND extracts it — so call ONLY that. (Calling /documents too
        // would save the file twice.) If it isn't a readable contract the
        // endpoint errors; fall back to a plain library store so the file
        // is never lost.
        const efd = new FormData();
        efd.append("file", only);
        const er = await fetch(
          `/api/transactions/${transactionId}/contract/extract`,
          { method: "POST", body: efd },
        );
        if (er.ok) {
          reviewFlow = true;
          toast.success(
            "Saved + read the contract",
            "Review the extracted fields below, then Apply.",
          );
        } else {
          const fd = new FormData();
          fd.append("file", only);
          const res = await fetch(
            `/api/transactions/${transactionId}/documents`,
            { method: "POST", body: fd },
          );
          const data = await res.json();
          if (!res.ok) throw new Error(data.error ?? "upload failed");
          toast.success(
            "Added 1 file",
            "Couldn't read it as a contract — it's in the library.",
          );
        }
      } else {
        // Non-PDF, or multiple files: store in the document library.
        const fd = new FormData();
        Array.from(files).forEach((f) => fd.append("file", f));
        const res = await fetch(`/api/transactions/${transactionId}/documents`, {
          method: "POST",
          body: fd,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "upload failed");
        toast.success(
          `Added ${data.count} file${data.count === 1 ? "" : "s"}`,
          "They're in the library now.",
        );
      }
      if (!reviewFlow) await syncFromDocuments();
      startTransition(() => router.refresh());
      setOpen(false); // reached only on success — dismiss the modal
    } catch (e) {
      toast.error("Upload failed", e instanceof Error ? e.message : "unknown");
    } finally {
      setBusy(false);
    }
  }

  const drag = {
    onDragOver: (e: DragEvent<HTMLElement>) => {
      e.preventDefault();
      if (!dragging) setDragging(true);
    },
    onDragLeave: (e: DragEvent<HTMLElement>) => {
      e.preventDefault();
      setDragging(false);
    },
    onDrop: (e: DragEvent<HTMLElement>) => {
      e.preventDefault();
      setDragging(false);
      upload(e.dataTransfer.files);
    },
  };

  // A stable input id so <label htmlFor> opens the picker NATIVELY (both
  // the drop zone and the "My local device" button) — programmatic
  // inputRef.current.click() was unreliable for "click to add".
  const inputId = `reos-upload-${transactionId}`;
  const fileInput = (
    <input
      id={inputId}
      ref={inputRef}
      type="file"
      multiple
      className="hidden"
      disabled={busy}
      onChange={(e) => {
        upload(e.target.files);
        e.target.value = "";
      }}
    />
  );

  return (
    <>
      {/* Minimalist trigger — the drop zone lives in the modal. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700"
      >
        <UploadIcon className="h-4 w-4" strokeWidth={2} />
        Upload files
      </button>

      {open &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Upload files"
            onClick={() => !busy && setOpen(false)}
            className="fixed inset-0 z-[95] flex items-center justify-center bg-black/60 px-4 py-8 backdrop-blur-sm"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-2xl overflow-hidden rounded-xl border border-border bg-surface shadow-2xl"
            >
              <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
                <h3 className="text-base font-semibold text-text">Upload files</h3>
                <button
                  type="button"
                  onClick={() => !busy && setOpen(false)}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-surface-2 hover:text-text"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="p-5">
                {/* Drop zone — a <label htmlFor> opens the picker natively
                    on click; drag handlers cover drop; keyboard via ref. */}
                <label
                  htmlFor={inputId}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      inputRef.current?.click();
                    }
                  }}
                  {...drag}
                  className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-14 text-center transition-colors ${
                    dragging
                      ? "border-brand-500 bg-brand-50 dark:bg-brand-950/30"
                      : "border-border bg-surface-2/30 hover:border-brand-400"
                  }`}
                >
                  <UploadIcon className="h-6 w-6 text-text-muted" />
                  <span className="text-base font-medium text-text">
                    {busy
                      ? "Uploading…"
                      : dragging
                        ? "Drop to add"
                        : "Drag & drop your files here"}
                  </span>
                  <span className="text-xs text-text-muted">
                    Any file lands in the library — a PDF contract is auto-read too
                  </span>
                </label>

                {/* Locations */}
                <div className="my-4 flex items-center gap-3 text-xs text-text-muted">
                  <span className="h-px flex-1 bg-border" />
                  or select from
                  <span className="h-px flex-1 bg-border" />
                </div>
                <div className="flex justify-center">
                  <label
                    htmlFor={inputId}
                    className={`inline-flex cursor-pointer items-center gap-2 rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium text-text transition-colors hover:border-brand-500 ${
                      busy ? "pointer-events-none opacity-50" : ""
                    }`}
                  >
                    <HardDrive className="h-4 w-4" strokeWidth={2} />
                    My local device
                  </label>
                </div>
              </div>
              {fileInput}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

export function DocumentLibraryPanel({ transactionId, documents }: Props) {
  if (documents.length === 0) {
    return (
      <section className="mt-8 rounded-lg border border-dashed border-border bg-surface-2/30 px-4 py-10 text-center">
        <div className="flex flex-col items-center gap-3">
          <p className="text-sm text-text-muted">
            No documents yet. Upload a contract to auto-extract, or drop any file
            for the library (auto-classified for Rezen + selectable in E-sign).
          </p>
          <UploadDocsControl transactionId={transactionId} />
        </div>
      </section>
    );
  }

  return (
    <section className="mt-8">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h2 className="text-lg font-medium">Document library</h2>
          <span className="text-xs text-text-muted">
            {documents.length} file{documents.length === 1 ? "" : "s"} · Ready for Rezen prep
          </span>
        </div>
        {/* Minimalist trigger — opens a modal drop zone. Drop a new/updated
            contract here and Atlas re-reads it (dates, earnest, contingencies)
            for review + apply. */}
        <UploadDocsControl transactionId={transactionId} />
      </div>
      <ul className="space-y-2">
        {documents.map((d) => (
          <DocumentCard key={d.id} doc={d} transactionId={transactionId} />
        ))}
      </ul>
    </section>
  );
}

function DocumentCard({
  doc,
  transactionId,
}: {
  doc: DocumentRow;
  transactionId: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<null | "delete" | "classify" | "category">(null);
  const [localCategory, setLocalCategory] = useState(doc.category ?? "");

  const flags: Array<{ key: string; label: string; tone: "red" | "green" | "amber" }> = [];
  if (doc.category === "contract" && doc.esignStatus !== "completed") {
    flags.push({ key: "needs-sig", label: "Needs signature", tone: "red" });
  }
  if (doc.classifiedAt && doc.suggestedRezenSlot) {
    flags.push({ key: "rezen-ready", label: "Ready for Rezen", tone: "green" });
  }
  if (!doc.hasExtractedText && doc.mimeType === "application/pdf") {
    flags.push({ key: "needs-extract", label: "Needs extraction", tone: "amber" });
  }

  async function downloadDoc() {
    if (!doc.hasRawBytes) {
      toast.error("File bytes not stored for this doc");
      return;
    }
    // Same-origin GET; browser handles the file download/preview.
    window.open(
      `/api/transactions/${transactionId}/documents/${doc.id}`,
      "_blank",
      "noopener,noreferrer",
    );
  }

  async function classifyNow() {
    setBusy("classify");
    try {
      const res = await fetch(
        `/api/transactions/${transactionId}/documents/${doc.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ runClassifier: true }),
        },
      );
      const data = (await res.json()) as {
        ok?: boolean;
        document?: { suggestedRezenSlot?: string | null };
        classifyError?: string | null;
      };
      if (!res.ok) {
        toast.error(data.classifyError ?? "Classification failed");
      } else if (data.classifyError) {
        toast.info(data.classifyError);
      } else if (data.document?.suggestedRezenSlot) {
        toast.success(`Classified as ${data.document.suggestedRezenSlot}`);
      } else {
        toast.info("No slot matched — set the category manually");
      }
      startTransition(() => router.refresh());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusy(null);
    }
  }

  async function changeCategory(next: string) {
    const previous = localCategory;
    setLocalCategory(next);
    setBusy("category");
    try {
      const res = await fetch(
        `/api/transactions/${transactionId}/documents/${doc.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ category: next || null }),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(
          (data as { error?: string }).error ?? "Could not update category",
        );
        setLocalCategory(previous);
        return;
      }
      startTransition(() => router.refresh());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Network error");
      setLocalCategory(previous);
    } finally {
      setBusy(null);
    }
  }

  async function deleteDoc() {
    if (!confirm(`Delete "${doc.fileName}"? This can't be undone.`)) return;
    setBusy("delete");
    try {
      const res = await fetch(
        `/api/transactions/${transactionId}/documents/${doc.id}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error((data as { error?: string }).error ?? "Delete failed");
        return;
      }
      toast.success("Document deleted");
      startTransition(() => router.refresh());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusy(null);
    }
  }

  const catColor = doc.category ? CATEGORY_PILL[doc.category] : null;
  const sourceMeta = SOURCE_LABEL[doc.source] ?? SOURCE_LABEL.upload;
  const SourceIcon = sourceMeta.Icon;
  const cardLoading = busy !== null || pending;

  return (
    <li
      className={`rounded-lg border border-border bg-surface p-4 transition ${
        cardLoading ? "opacity-70" : ""
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-brand-50 text-brand-700">
          <FileText className="h-4 w-4" strokeWidth={1.8} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium text-text">
              {doc.fileName}
            </span>
            {catColor && (
              <Pill bg={catColor.bg} text={catColor.text} border={catColor.border}>
                {doc.category}
              </Pill>
            )}
            <Pill bg="#F1EFE8" text="#444441" border="#B4B2A9">
              <SourceIcon className="mr-1 h-3 w-3" strokeWidth={2} />
              {sourceMeta.label}
            </Pill>
            {flags.map((f) => (
              <Pill
                key={f.key}
                bg={f.tone === "red" ? "#FCEBEB" : f.tone === "green" ? "#EAF3DE" : "#FAEEDA"}
                text={f.tone === "red" ? "#791F1F" : f.tone === "green" ? "#27500A" : "#633806"}
                border={f.tone === "red" ? "#F09595" : f.tone === "green" ? "#97C459" : "#EF9F27"}
              >
                {f.label}
              </Pill>
            ))}
          </div>

          <div className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-text-muted sm:grid-cols-4">
            <div>
              <span className="uppercase tracking-wide">Uploaded</span>
              <div className="mt-0.5 text-text">{fmtDate(doc.uploadedAt)}</div>
            </div>
            <div>
              <span className="uppercase tracking-wide">Rezen slot</span>
              <div className="mt-0.5 text-text">
                {doc.suggestedRezenSlot ?? <span className="text-text-muted">—</span>}
              </div>
            </div>
            <div>
              <span className="uppercase tracking-wide">Confidence</span>
              <div className="mt-0.5 text-text tabular-nums">
                {fmtConfidence(doc.suggestedRezenConfidence)}
              </div>
            </div>
            <div>
              <span className="uppercase tracking-wide">Signature</span>
              <div className="mt-0.5 text-text">
                {doc.esignSummary ?? (
                  <span className="text-text-muted">
                    {doc.esignStatus === "none" ? "Not requested" : doc.esignStatus}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <select
              value={localCategory}
              onChange={(e) => changeCategory(e.target.value)}
              disabled={cardLoading}
              className="rounded-md border border-border bg-surface px-2 py-1 text-xs"
              aria-label="Document category"
            >
              <option value="">— Set category —</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={downloadDoc}
              disabled={cardLoading || !doc.hasRawBytes}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2.5 py-1 text-xs text-text hover:border-brand-500 disabled:opacity-50"
              title={doc.hasRawBytes ? "Open / download" : "File bytes not stored"}
            >
              <Download className="h-3 w-3" strokeWidth={2} />
              Download
            </button>

            <button
              type="button"
              onClick={classifyNow}
              disabled={cardLoading || !doc.hasExtractedText}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2.5 py-1 text-xs text-text hover:border-brand-500 disabled:opacity-50"
              title={
                doc.hasExtractedText
                  ? "Run the AI classifier to (re-)suggest a Rezen slot"
                  : "Document has no extracted text"
              }
            >
              <Sparkles className="h-3 w-3" strokeWidth={2} />
              {busy === "classify" ? "Classifying…" : "Classify"}
            </button>

            {doc.uploadOrigin && doc.source === "gmail_attachment" && (
              <a
                href={doc.uploadOrigin}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2.5 py-1 text-xs text-text hover:border-brand-500"
              >
                <ExternalLink className="h-3 w-3" strokeWidth={2} />
                Open in Gmail
              </a>
            )}

            <span className="flex-1" />

            <button
              type="button"
              onClick={deleteDoc}
              disabled={cardLoading}
              className="inline-flex items-center gap-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-xs text-text-muted hover:border-red-300 hover:text-red-700 disabled:opacity-50"
            >
              <Trash2 className="h-3 w-3" strokeWidth={2} />
              {busy === "delete" ? "Deleting…" : "Delete"}
            </button>
          </div>
        </div>
      </div>
    </li>
  );
}

function Pill({
  bg,
  text,
  border,
  children,
}: {
  bg: string;
  text: string;
  border: string;
  children: React.ReactNode;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        background: bg,
        color: text,
        border: `0.5px solid ${border}`,
        borderRadius: 999,
        padding: "1px 7px",
        fontSize: 10,
        fontWeight: 500,
        letterSpacing: "0.02em",
        textTransform: "capitalize",
        lineHeight: 1.4,
      }}
    >
      {children}
    </span>
  );
}
