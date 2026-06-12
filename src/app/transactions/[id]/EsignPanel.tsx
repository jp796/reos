"use client";

/**
 * E-sign panel — native first-party signing (no third-party API).
 * Flow: pick PDF → pick recipients → place fields on rendered pages
 * → send. Each signer gets a unique tokenized /sign link by email.
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileSignature, ExternalLink, MapPin } from "lucide-react";
import { useToast } from "@/app/ToastProvider";
import {
  FieldPlacementEditor,
  type PlacedField,
} from "./FieldPlacementEditor";

interface DocOption {
  id: string;
  fileName: string;
  mimeType: string;
}

interface SignerOption {
  name: string;
  email: string;
  role: string;
}

interface EsignRecipientRow {
  name: string;
  email: string;
  status: string;
  signedAt: Date | null;
}

interface EsignRequestRow {
  id: string;
  title: string;
  status: string;
  signingLinksJson: unknown;
  errorMessage: string | null;
  createdAt: Date;
  sentAt: Date | null;
  recipients: EsignRecipientRow[];
}

const RECIPIENT_STATUS_STYLE: Record<string, string> = {
  pending: "bg-surface-2 text-text-muted ring-border",
  viewed: "bg-sky-50 text-sky-700 ring-sky-200",
  consented: "bg-amber-50 text-amber-800 ring-amber-200",
  signed: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  declined: "bg-red-50 text-red-700 ring-red-200",
};

export function EsignPanel({
  transactionId,
  documents,
  signerOptions,
  requests,
}: {
  transactionId: string;
  documents: DocOption[];
  signerOptions: SignerOption[];
  requests: EsignRequestRow[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const pdfDocs = documents.filter((d) => d.mimeType === "application/pdf");
  const [documentId, setDocumentId] = useState(pdfDocs[0]?.id ?? "");
  const [selectedEmails, setSelectedEmails] = useState<string[]>(
    signerOptions.slice(0, 2).map((s) => s.email),
  );
  const [placing, setPlacing] = useState(false);
  const [pageCount, setPageCount] = useState(0);
  const [fields, setFields] = useState<PlacedField[]>([]);
  const [message, setMessage] = useState("");

  const selectedRecipients = useMemo(
    () => signerOptions.filter((s) => selectedEmails.includes(s.email)),
    [selectedEmails, signerOptions],
  );

  function toggle(email: string) {
    setSelectedEmails((curr) =>
      curr.includes(email) ? curr.filter((x) => x !== email) : [...curr, email],
    );
    // Recipient set changes invalidate field→recipient index mapping.
    setFields([]);
    setPlacing(false);
  }

  function startPlacement() {
    startTransition(async () => {
      try {
        const res = await fetch(
          `/api/transactions/${transactionId}/esign/pages?documentId=${encodeURIComponent(documentId)}&meta=1`,
        );
        const data = (await res.json().catch(() => ({}))) as {
          pageCount?: number;
          error?: string;
        };
        if (!res.ok || !data.pageCount) {
          throw new Error(data.error ?? "could not load document pages");
        }
        setPageCount(data.pageCount);
        setFields([]);
        setPlacing(true);
      } catch (e) {
        toast.error(
          "Could not open field editor",
          e instanceof Error ? e.message : "unknown error",
        );
      }
    });
  }

  function send() {
    startTransition(async () => {
      try {
        const res = await fetch(`/api/transactions/${transactionId}/esign`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            documentId,
            recipients: selectedRecipients.map((s) => ({
              name: s.name,
              email: s.email,
            })),
            fields: fields.map((f) => ({
              type: f.type,
              page: f.page,
              x: f.x,
              y: f.y,
              width: f.width,
              height: f.height,
              recipientIndex: f.recipientIndex,
            })),
            message: message.trim() || undefined,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? res.statusText);
        toast.success("Signature request sent");
        setPlacing(false);
        setFields([]);
        setMessage("");
        router.refresh();
      } catch (e) {
        toast.error(
          "E-sign failed",
          e instanceof Error ? e.message : "unknown error",
        );
      }
    });
  }

  const canPlace = !!documentId && selectedRecipients.length > 0 && !pending;
  const canSend = canPlace && placing && fields.length > 0;

  return (
    <section className="mt-8 rounded-md border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <FileSignature className="h-4 w-4 text-brand-600" />
            <h2 className="text-lg font-medium">E-sign</h2>
          </div>
          <p className="mt-1 text-xs text-text-muted">
            Built-in signatures with consent + audit trail. No per-envelope
            fees, no third-party API.
          </p>
        </div>
        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
          Native
        </span>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-[1fr_1.2fr_auto] md:items-end">
        <label className="block">
          <span className="reos-label">PDF document</span>
          <select
            value={documentId}
            onChange={(e) => {
              setDocumentId(e.target.value);
              setFields([]);
              setPlacing(false);
            }}
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
          >
            {pdfDocs.length === 0 ? (
              <option value="">No PDFs uploaded</option>
            ) : (
              pdfDocs.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.fileName}
                </option>
              ))
            )}
          </select>
        </label>

        <div>
          <div className="reos-label">Recipients</div>
          <div className="mt-1 flex flex-wrap gap-2">
            {signerOptions.length === 0 ? (
              <span className="text-xs text-text-muted">
                Add participants with email addresses first.
              </span>
            ) : (
              signerOptions.map((s) => (
                <button
                  key={s.email}
                  type="button"
                  onClick={() => toggle(s.email)}
                  className={
                    "rounded-full px-2.5 py-1 text-xs ring-1 " +
                    (selectedEmails.includes(s.email)
                      ? "bg-brand-50 text-brand-700 ring-brand-200"
                      : "bg-surface-2 text-text-muted ring-border")
                  }
                >
                  {s.name} · {s.role}
                </button>
              ))
            )}
          </div>
        </div>

        {!placing ? (
          <button
            type="button"
            onClick={startPlacement}
            disabled={!canPlace}
            className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <MapPin className="h-3.5 w-3.5" />
            {pending ? "Loading…" : "Place fields"}
          </button>
        ) : (
          <button
            type="button"
            onClick={send}
            disabled={!canSend}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? "Sending…" : `Send (${fields.length} field${fields.length === 1 ? "" : "s"})`}
          </button>
        )}
      </div>

      {placing && pageCount > 0 && (
        <div className="mt-4 space-y-3">
          <FieldPlacementEditor
            pageCount={pageCount}
            pageImageUrl={(page) =>
              `/api/transactions/${transactionId}/esign/pages?documentId=${encodeURIComponent(documentId)}&page=${page}`
            }
            recipients={selectedRecipients.map((r) => ({
              name: r.name,
              email: r.email,
            }))}
            fields={fields}
            onChange={setFields}
          />
          <label className="block">
            <span className="reos-label">Message to signers (optional)</span>
            <input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={1000}
              placeholder="e.g. Please sign by Friday so we can stay on schedule."
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
            />
          </label>
        </div>
      )}

      {requests.length > 0 && (
        <div className="mt-5 space-y-2">
          <div className="reos-label">History</div>
          {requests.map((r) => (
            <div
              key={r.id}
              className="rounded-md border border-border bg-surface-2 px-3 py-2 text-sm"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-medium">{r.title}</div>
                  <div className="text-xs text-text-muted">
                    {r.status} · {new Date(r.createdAt).toLocaleDateString()}
                  </div>
                </div>
                <SigningLinks raw={r.signingLinksJson} />
              </div>
              {r.recipients.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {r.recipients.map((rec) => (
                    <span
                      key={rec.email}
                      className={
                        "rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 " +
                        (RECIPIENT_STATUS_STYLE[rec.status] ??
                          RECIPIENT_STATUS_STYLE.pending)
                      }
                    >
                      {rec.name}: {rec.status}
                      {rec.signedAt
                        ? ` ${new Date(rec.signedAt).toLocaleDateString()}`
                        : ""}
                    </span>
                  ))}
                </div>
              )}
              {r.errorMessage && (
                <div className="mt-1 text-xs text-danger">{r.errorMessage}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function SigningLinks({ raw }: { raw: unknown }) {
  const links = Array.isArray(raw)
    ? raw
        .map((r) =>
          r && typeof r === "object"
            ? (r as { email?: unknown; signingUrl?: unknown })
            : null,
        )
        .filter(
          (r): r is { email?: string; signingUrl: string } =>
            typeof r?.signingUrl === "string",
        )
    : [];
  if (links.length === 0) return null;
  return (
    <div className="flex flex-wrap justify-end gap-2">
      {links.map((l) => (
        <a
          key={l.signingUrl}
          href={l.signingUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-xs font-medium text-brand-700 hover:border-brand-300"
        >
          {l.email ?? "Open"} <ExternalLink className="h-3 w-3" />
        </a>
      ))}
    </div>
  );
}
