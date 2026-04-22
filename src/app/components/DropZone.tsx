"use client";

import { useRef, useState } from "react";
import { Upload, FileText } from "lucide-react";
import { cn } from "@/lib/cn";

interface Props {
  /** Called when the user drops or picks a valid file. */
  onFile: (file: File) => void;
  /** MIME type constraint — default "application/pdf" */
  accept?: string;
  /** Friendly extension label for the prompt — default "PDF" */
  kind?: string;
  /** Max size in MB — default 20 */
  maxMb?: number;
  /** Currently-selected file's name, to show in the zone */
  selectedName?: string | null;
  /** Disables interaction */
  disabled?: boolean;
  /** Extra classes for the outer zone */
  className?: string;
}

/**
 * Reusable drag-and-drop file zone. Clicking anywhere opens the
 * native file picker; dragging a file over it highlights + accepts
 * on drop. Size + MIME validation inline. No library dependency.
 */
export function DropZone({
  onFile,
  accept = "application/pdf,.pdf",
  kind = "PDF",
  maxMb = 20,
  selectedName,
  disabled,
  className,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [hover, setHover] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function validate(f: File): string | null {
    if (
      accept &&
      accept !== "*/*" &&
      // Accept matches either by mime or by extension
      !accept
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .some((pat) => {
          const n = f.name.toLowerCase();
          if (pat.startsWith(".")) return n.endsWith(pat);
          if (pat.includes("/")) {
            if (pat.endsWith("/*")) {
              return f.type.startsWith(pat.replace("/*", "/"));
            }
            return f.type === pat;
          }
          return false;
        })
    ) {
      return `${kind} required`;
    }
    if (f.size > maxMb * 1024 * 1024) {
      return `File too large (max ${maxMb} MB)`;
    }
    return null;
  }

  function accept1(f: File) {
    const bad = validate(f);
    if (bad) {
      setErr(bad);
      return;
    }
    setErr(null);
    onFile(f);
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) accept1(f);
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setHover(false);
    if (disabled) return;
    const f = e.dataTransfer.files?.[0];
    if (f) accept1(f);
  }

  function onDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (disabled) return;
    if (!hover) setHover(true);
  }

  function onDragLeave(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setHover(false);
  }

  return (
    <div className={cn("w-full", className)}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed p-6 text-center transition-colors",
          hover
            ? "border-brand-500 bg-brand-50 text-brand-700"
            : "border-border bg-surface-2 text-text-muted hover:border-border-strong hover:bg-surface",
          disabled && "cursor-not-allowed opacity-50",
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          onChange={onInputChange}
          disabled={disabled}
          className="sr-only"
        />
        {selectedName ? (
          <>
            <FileText
              className="h-8 w-8 text-brand-600"
              strokeWidth={1.6}
            />
            <div className="text-sm font-medium text-text">{selectedName}</div>
            <div className="text-xs text-text-muted">
              Click to choose a different file
            </div>
          </>
        ) : (
          <>
            <Upload className="h-8 w-8" strokeWidth={1.6} />
            <div className="text-sm">
              <span className="font-medium text-text">Drag & drop</span> your{" "}
              {kind} here
            </div>
            <div className="text-xs">
              or <span className="underline">click to browse</span> · max{" "}
              {maxMb} MB
            </div>
          </>
        )}
      </div>
      {err && (
        <div className="mt-2 rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700">
          {err}
        </div>
      )}
    </div>
  );
}
