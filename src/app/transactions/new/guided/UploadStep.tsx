"use client";

/**
 * UploadStep — Step 1 of the guided intake. AtlasWelcome on the left,
 * a real working drag-and-drop on the right (+ a side picker). Files are
 * held here for now; when live extraction is wired, the primary file
 * feeds ContractExtractionService and advances into Step 2.
 *
 * Uses the same drag/drop handler pattern proven in NewTransactionWizard
 * (preventDefault on dragover AND drop so the browser doesn't just open
 * the file).
 */

import { useRef, useState } from "react";
import { Upload, FileText, X, Home, Users, User, Building2 } from "lucide-react";
import { AtlasWelcome } from "../AtlasWelcome";

type Side = "buyer" | "listing" | "both" | "investor";

const SIDES: Array<{ id: Side; label: string; hint: string; icon: typeof Home }> = [
  { id: "buyer", label: "Buyer side", hint: "Representing the buyer", icon: User },
  { id: "listing", label: "Listing side", hint: "Representing the seller", icon: Home },
  { id: "both", label: "Both sides", hint: "Dual representation", icon: Users },
  { id: "investor", label: "Investor deal", hint: "You're the principal", icon: Building2 },
];

export function UploadStep({
  files,
  setFiles,
  side,
  setSide,
}: {
  files: File[];
  setFiles: (f: File[]) => void;
  side: Side | null;
  setSide: (s: Side) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function addFiles(list: FileList | null) {
    if (!list) return;
    setFiles([...files, ...Array.from(list)]);
  }
  function removeFile(i: number) {
    setFiles(files.filter((_, idx) => idx !== i));
  }

  return (
    <div className="grid gap-8 lg:grid-cols-2 lg:items-start">
      <AtlasWelcome />

      <div className="space-y-5">
        <div>
          <div className="reos-label">New deal</div>
          <h1 className="mt-1 font-display text-2xl font-semibold">
            Upload a contract
          </h1>
          <p className="mt-1 text-sm text-text-muted">
            Drop the purchase contract or listing agreement (plus related
            docs) — Atlas reads the rest.
          </p>
        </div>

        {/* Side picker */}
        <div>
          <div className="mb-2 text-sm font-medium">
            Which side do you represent?
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {SIDES.map((s) => {
              const Icon = s.icon;
              const active = side === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSide(s.id)}
                  className={`flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors ${
                    active
                      ? "border-brand-500 bg-brand-50 ring-1 ring-brand-200 dark:bg-brand-950/30"
                      : "border-border bg-surface hover:border-border-strong"
                  }`}
                >
                  <Icon
                    className={`h-4 w-4 ${active ? "text-brand-600" : "text-text-muted"}`}
                  />
                  <span className="text-sm font-medium text-text">{s.label}</span>
                  <span className="text-xs text-text-muted">{s.hint}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Working dropzone */}
        <div>
          <div className="mb-2 text-sm font-medium">Documents</div>
          <div
            role="button"
            tabIndex={0}
            onClick={() => fileRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                fileRef.current?.click();
              }
            }}
            onDragOver={(e) => {
              e.preventDefault();
              if (!dragging) setDragging(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              setDragging(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              addFiles(e.dataTransfer.files);
            }}
            className={`flex w-full cursor-pointer flex-col items-center gap-1.5 rounded-lg border border-dashed px-4 py-9 text-center transition-colors ${
              dragging
                ? "border-brand-500 bg-brand-50 dark:bg-brand-950/30"
                : "border-border bg-surface hover:border-brand-400"
            }`}
          >
            <Upload className="h-5 w-5 text-text-muted" />
            <span className="text-sm font-medium text-text">
              {dragging
                ? "Drop to add"
                : files.length
                  ? "Drop more, or click to add"
                  : "Drag & drop files here, or click to browse"}
            </span>
            <span className="text-xs text-text-muted">
              Purchase contract, listing agreement, disclosures, addenda — PDFs
              or photos
            </span>
          </div>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept="application/pdf,image/*"
            className="hidden"
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = "";
            }}
          />

          {files.length > 0 && (
            <ul className="mt-2 space-y-1.5">
              {files.map((f, i) => (
                <li
                  key={`${f.name}-${i}`}
                  className="flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm"
                >
                  <FileText className="h-4 w-4 shrink-0 text-text-muted" />
                  <span className="flex-1 truncate text-text">{f.name}</span>
                  <span className="shrink-0 text-xs text-text-subtle">
                    {(f.size / 1_000_000).toFixed(2)} MB
                  </span>
                  <button
                    type="button"
                    onClick={() => removeFile(i)}
                    aria-label="Remove"
                    className="shrink-0 rounded p-0.5 text-text-subtle hover:bg-surface-2 hover:text-red-600"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {!side && (
            <p className="mt-2 text-xs text-text-subtle">
              Pick a side and add the contract, then hit Continue.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export type { Side };
