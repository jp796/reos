"use client";

/**
 * Public signing experience — consent gate → document with field
 * overlays → signature capture → done. Mobile-first: signers open
 * these links on their phones.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, FileSignature, Loader2 } from "lucide-react";
import { SignatureModal } from "./SignatureModal";

interface SignerField {
  id: string;
  type: "SIGNATURE" | "INITIALS" | "DATE_SIGNED" | "TEXT";
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  required: boolean;
  value: string | null;
}

interface SignerView {
  title: string;
  fileName: string;
  status: string;
  pageCount: number;
  consentText: string;
  consentTextVersion: string;
  recipient: { name: string; status: string; consented: boolean; signed: boolean };
  fields: SignerField[];
}

type Phase = "loading" | "error" | "consent" | "signing" | "submitting" | "done";

const FIELD_LABEL: Record<SignerField["type"], string> = {
  SIGNATURE: "Sign",
  INITIALS: "Initials",
  DATE_SIGNED: "Date (auto)",
  TEXT: "Fill in",
};

export function SignClient({ token }: { token: string }) {
  const [view, setView] = useState<SignerView | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [consentChecked, setConsentChecked] = useState(false);
  const [signature, setSignature] = useState<string | null>(null);
  const [textValues, setTextValues] = useState<Record<string, string>>({});
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/sign/${token}`);
        if (!res.ok) throw new Error(res.status === 429 ? "Too many requests — wait a minute and refresh." : "This signing link is invalid, expired, or already closed.");
        const data = (await res.json()) as SignerView;
        if (cancelled) return;
        setView(data);
        if (data.recipient.signed || data.status === "completed") setPhase("done");
        else if (data.recipient.consented) setPhase("signing");
        else setPhase("consent");
      } catch (e) {
        if (cancelled) return;
        setErrorMsg(e instanceof Error ? e.message : "Something went wrong.");
        setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const requiredDone = useMemo(() => {
    if (!view) return false;
    const needsSignature = view.fields.some(
      (f) => f.type === "SIGNATURE" || f.type === "INITIALS",
    );
    if (needsSignature && !signature) return false;
    return view.fields
      .filter((f) => f.type === "TEXT" && f.required)
      .every((f) => (textValues[f.id] ?? "").trim().length > 0);
  }, [view, signature, textValues]);

  const consent = useCallback(async () => {
    const res = await fetch(`/api/sign/${token}/consent`, { method: "POST" });
    if (res.ok) setPhase("signing");
  }, [token]);

  const submit = useCallback(async () => {
    if (!signature) return;
    setPhase("submitting");
    try {
      const res = await fetch(`/api/sign/${token}/complete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ signatureImage: signature, values: textValues }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Signing failed");
      setPhase("done");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Signing failed");
      setPhase("signing");
    }
  }, [token, signature, textValues]);

  if (phase === "loading") {
    return (
      <Shell>
        <div className="flex items-center justify-center gap-2 py-24 text-sm text-neutral-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading document…
        </div>
      </Shell>
    );
  }

  if (phase === "error" || !view) {
    return (
      <Shell>
        <div className="mx-auto max-w-md py-24 text-center">
          <p className="text-sm text-neutral-600">{errorMsg || "This signing link is invalid."}</p>
        </div>
      </Shell>
    );
  }

  if (phase === "done") {
    return (
      <Shell>
        <div className="mx-auto max-w-md py-24 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" />
          <h1 className="mt-4 text-lg font-semibold">You&apos;re all set</h1>
          <p className="mt-2 text-sm text-neutral-600">
            Your signature on &ldquo;{view.title}&rdquo; has been recorded. Once all
            parties have signed, you&apos;ll receive the completed document by email.
          </p>
        </div>
      </Shell>
    );
  }

  if (phase === "consent") {
    return (
      <Shell>
        <div className="mx-auto max-w-lg py-16">
          <h1 className="text-lg font-semibold">{view.title}</h1>
          <p className="mt-1 text-sm text-neutral-600">
            {view.recipient.name}, you&apos;ve been asked to sign this document
            ({view.pageCount} page{view.pageCount === 1 ? "" : "s"}).
          </p>
          <div className="mt-6 rounded-md border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-700">
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={consentChecked}
                onChange={(e) => setConsentChecked(e.target.checked)}
                className="mt-1 h-4 w-4"
              />
              <span>{view.consentText}</span>
            </label>
          </div>
          <button
            type="button"
            disabled={!consentChecked}
            onClick={consent}
            className="mt-4 w-full rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Agree &amp; review document
          </button>
        </div>
      </Shell>
    );
  }

  // signing / submitting
  return (
    <Shell>
      <div className="mx-auto max-w-3xl pb-32">
        <div className="sticky top-0 z-10 -mx-4 border-b border-neutral-200 bg-white/95 px-4 py-3 backdrop-blur">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{view.title}</div>
              <div className="text-xs text-neutral-500">
                {signature ? "Signature captured" : "Tap a highlighted box to sign"}
              </div>
            </div>
            <button
              type="button"
              onClick={submit}
              disabled={!requiredDone || phase === "submitting"}
              className="shrink-0 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {phase === "submitting" ? "Finishing…" : "Finish signing"}
            </button>
          </div>
          {errorMsg && (
            <div className="mt-2 text-xs text-red-600">{errorMsg}</div>
          )}
        </div>

        <div className="mt-4 space-y-6">
          {Array.from({ length: view.pageCount }, (_, i) => i + 1).map((p) => (
            <DocPage
              key={p}
              token={token}
              page={p}
              fields={view.fields.filter((f) => f.page === p)}
              signature={signature}
              textValues={textValues}
              onFieldTap={(f) => {
                if (f.type === "SIGNATURE" || f.type === "INITIALS") setModalOpen(true);
              }}
              onTextChange={(id, v) =>
                setTextValues((curr) => ({ ...curr, [id]: v }))
              }
            />
          ))}
        </div>
      </div>

      {modalOpen && (
        <SignatureModal
          signerName={view.recipient.name}
          onCancel={() => setModalOpen(false)}
          onApply={(dataUrl) => {
            setSignature(dataUrl);
            setModalOpen(false);
          }}
        />
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-neutral-100 px-4 text-neutral-900">
      <div className="mx-auto flex max-w-3xl items-center gap-2 py-4 text-sm font-semibold text-neutral-700">
        <FileSignature className="h-4 w-4 text-blue-600" /> REOS e-sign
      </div>
      {children}
    </div>
  );
}

function DocPage({
  token,
  page,
  fields,
  signature,
  textValues,
  onFieldTap,
  onTextChange,
}: {
  token: string;
  page: number;
  fields: SignerField[];
  signature: string | null;
  textValues: Record<string, string>;
  onFieldTap: (f: SignerField) => void;
  onTextChange: (id: string, v: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);

  return (
    <div
      ref={ref}
      className="relative overflow-hidden rounded-md border border-neutral-300 bg-white shadow-sm"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/sign/${token}/page/${page}`}
        alt={`Page ${page}`}
        className="block w-full"
        onLoad={() => setLoaded(true)}
      />
      {loaded &&
        fields.map((f) => {
          const style = {
            left: `${f.x * 100}%`,
            top: `${f.y * 100}%`,
            width: `${f.width * 100}%`,
            height: `${f.height * 100}%`,
          } as const;
          if (f.type === "TEXT") {
            return (
              <input
                key={f.id}
                style={style}
                value={textValues[f.id] ?? ""}
                onChange={(e) => onTextChange(f.id, e.target.value)}
                placeholder={f.required ? "Required" : "Optional"}
                className="absolute rounded border-2 border-blue-400 bg-blue-50/70 px-1 text-xs text-neutral-900 outline-none focus:border-blue-600"
              />
            );
          }
          const filled =
            (f.type === "SIGNATURE" || f.type === "INITIALS") && signature;
          return (
            <button
              key={f.id}
              type="button"
              style={style}
              onClick={() => onFieldTap(f)}
              className={
                "absolute flex items-center justify-center overflow-hidden rounded border-2 text-[11px] font-medium " +
                (filled
                  ? "border-emerald-500 bg-white"
                  : f.type === "DATE_SIGNED"
                    ? "border-neutral-300 bg-neutral-50/80 text-neutral-500"
                    : "border-amber-400 bg-amber-50/80 text-amber-800")
              }
            >
              {filled ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={signature}
                  alt="Your signature"
                  className="max-h-full max-w-full object-contain"
                />
              ) : (
                FIELD_LABEL[f.type]
              )}
            </button>
          );
        })}
    </div>
  );
}
