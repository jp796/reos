"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileSignature, ExternalLink } from "lucide-react";
import { useToast } from "@/app/ToastProvider";

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

interface EsignRequestRow {
  id: string;
  title: string;
  status: string;
  providerEnvelopeId: string | null;
  signingLinksJson: unknown;
  errorMessage: string | null;
  createdAt: Date;
  sentAt: Date | null;
}

export function EsignPanel({
  transactionId,
  configured,
  documents,
  signerOptions,
  requests,
}: {
  transactionId: string;
  configured: boolean;
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

  const selectedRecipients = useMemo(
    () => signerOptions.filter((s) => selectedEmails.includes(s.email)),
    [selectedEmails, signerOptions],
  );

  function toggle(email: string) {
    setSelectedEmails((curr) =>
      curr.includes(email) ? curr.filter((x) => x !== email) : [...curr, email],
    );
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
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? res.statusText);
        toast.success("Signature request sent");
        router.refresh();
      } catch (e) {
        toast.error(
          "E-sign failed",
          e instanceof Error ? e.message : "unknown error",
        );
      }
    });
  }

  const canSend =
    configured && !!documentId && selectedRecipients.length > 0 && !pending;

  return (
    <section className="mt-8 rounded-md border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <FileSignature className="h-4 w-4 text-brand-600" />
            <h2 className="text-lg font-medium">E-sign</h2>
          </div>
          <p className="mt-1 text-xs text-text-muted">
            Documenso-backed signature requests with signer audit trail.
          </p>
        </div>
        <span
          className={
            "rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 " +
            (configured
              ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
              : "bg-amber-50 text-amber-800 ring-amber-200")
          }
        >
          {configured ? "Configured" : "Needs API key"}
        </span>
      </div>

      {!configured && (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Add `DOCUMENSO_API_URL` and `DOCUMENSO_API_KEY` to enable sending.
          Self-hosted Documenso is the free path; hosted Documenso also works.
        </div>
      )}

      <div className="mt-4 grid gap-3 md:grid-cols-[1fr_1.2fr_auto] md:items-end">
        <label className="block">
          <span className="reos-label">PDF document</span>
          <select
            value={documentId}
            onChange={(e) => setDocumentId(e.target.value)}
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

        <button
          type="button"
          onClick={send}
          disabled={!canSend}
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Sending..." : "Send"}
        </button>
      </div>

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
