"use client";

/**
 * ReviewDetailsStep — Step 2 of the guided intake (split-screen review).
 *
 * Left: the extracted contract organized into sections of editable
 * fields + entity cards (parties / agents / brokerages / contingencies),
 * each field inline-editable (✓ / ✗), with a "missing item" affordance
 * and a count banner. Right: the contract itself.
 *
 * Built against the real 1650 North Ridge Dr fixture (reviewModel.ts).
 * `find-in-document` (jump to the source snippet in the PDF) lands once
 * the real PDF + extraction `snippet`s are wired — omitted here rather
 * than shipping a dead button.
 */

import { useEffect, useMemo, useState } from "react";
import { Pencil, Check, X, Plus, FileText, AlertCircle } from "lucide-react";
import {
  type ReviewModel,
  type ReviewField,
  countMissing,
} from "./reviewModel";

export function ReviewDetailsStep({
  initial,
  pdfUrl,
  onChange,
}: {
  initial: ReviewModel;
  pdfUrl?: string;
  /** Mirror edits up so the wizard can build the create payload from the
   *  user's corrected values, not just the raw extraction. */
  onChange?: (m: ReviewModel) => void;
}) {
  const [model, setModel] = useState<ReviewModel>(initial);
  const missing = useMemo(() => countMissing(model), [model]);

  useEffect(() => {
    onChange?.(model);
  }, [model, onChange]);

  function saveField(
    sectionId: string,
    entityId: string | null,
    fieldId: string,
    value: string,
  ) {
    setModel((m) => ({
      ...m,
      sections: m.sections.map((s) => {
        if (s.id !== sectionId) return s;
        if (s.kind === "fields") {
          return {
            ...s,
            fields: s.fields.map((f) =>
              f.id === fieldId ? { ...f, value, missing: false } : f,
            ),
          };
        }
        return {
          ...s,
          entities: s.entities.map((e) =>
            e.id !== entityId
              ? e
              : {
                  ...e,
                  fields: e.fields.map((f) =>
                    f.id === fieldId ? { ...f, value, missing: false } : f,
                  ),
                },
          ),
        };
      }),
    }));
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold">
            Review transaction details
          </h1>
          <p className="mt-1 text-sm text-text-muted">
            Atlas pulled these from your contract. Tap any value to edit —
            confirm what&rsquo;s right and fill anything it missed.
          </p>
        </div>
        {missing > 0 ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900/40">
            <AlertCircle className="h-3.5 w-3.5" />
            {missing} item{missing === 1 ? "" : "s"} to confirm
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-50 px-3 py-1 text-xs font-semibold text-accent-700 ring-1 ring-accent-200">
            <Check className="h-3.5 w-3.5" />
            All set
          </span>
        )}
      </div>

      <div className="mt-5 grid gap-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-start">
        {/* Left — editable sections */}
        <div className="space-y-5">
          {model.sections.map((section) => (
            <section
              key={section.id}
              className="rounded-xl border border-border bg-surface p-4"
            >
              <h2 className="reos-label mb-3">{section.title}</h2>

              {section.kind === "fields" ? (
                <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                  {section.fields.map((f) => (
                    <FieldRow
                      key={f.id}
                      field={f}
                      onSave={(v) => saveField(section.id, null, f.id, v)}
                      className={f.multiline ? "sm:col-span-2" : undefined}
                    />
                  ))}
                </div>
              ) : (
                <div className="space-y-2.5">
                  {section.entities.map((e) => (
                    <div
                      key={e.id}
                      className="rounded-lg border border-border bg-surface-2 p-3"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-text">
                          {e.name}
                        </span>
                        {e.badge ? (
                          <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700 ring-1 ring-brand-100 dark:bg-brand-950/40 dark:text-brand-200 dark:ring-brand-900/40">
                            {e.badge}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-2 grid gap-x-6 gap-y-2">
                        {e.fields.map((f) => (
                          <FieldRow
                            key={f.id}
                            field={f}
                            onSave={(v) => saveField(section.id, e.id, f.id, v)}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>

        {/* Right — the contract */}
        <div className="lg:sticky lg:top-4">
          <ContractPane address={model.address} pdfUrl={pdfUrl} />
        </div>
      </div>
    </div>
  );
}

function FieldRow({
  field,
  onSave,
  className,
}: {
  field: ReviewField;
  onSave: (v: string) => void;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(field.value);

  function commit() {
    onSave(draft.trim());
    setEditing(false);
  }
  function cancel() {
    setDraft(field.value);
    setEditing(false);
  }

  return (
    <div className={className}>
      {field.label ? (
        <div className="text-[11px] font-medium uppercase tracking-wide text-text-subtle">
          {field.label}
        </div>
      ) : null}

      {editing ? (
        <div className="mt-0.5 flex items-start gap-1.5">
          {field.multiline ? (
            <textarea
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={3}
              className="flex-1 rounded-md border border-brand-400 bg-surface px-2 py-1.5 text-sm text-text focus:outline-none focus:ring-2 focus:ring-brand-200"
            />
          ) : (
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commit();
                if (e.key === "Escape") cancel();
              }}
              className="flex-1 rounded-md border border-brand-400 bg-surface px-2 py-1.5 text-sm text-text focus:outline-none focus:ring-2 focus:ring-brand-200"
            />
          )}
          <button
            type="button"
            onClick={commit}
            aria-label="Save"
            className="mt-0.5 rounded-md bg-accent-600 p-1.5 text-white hover:bg-accent-500"
          >
            <Check className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={cancel}
            aria-label="Cancel"
            className="mt-0.5 rounded-md border border-border bg-surface p-1.5 text-text-muted hover:text-text"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : field.missing ? (
        <button
          type="button"
          onClick={() => {
            setDraft("");
            setEditing(true);
          }}
          className="group mt-0.5 inline-flex items-center gap-1.5 rounded-md border border-dashed border-red-300 px-2 py-1 text-sm text-red-600 hover:border-red-400 hover:bg-red-50 dark:border-red-900/50 dark:text-red-300 dark:hover:bg-red-950/30"
        >
          <Plus className="h-3.5 w-3.5" />
          Add {field.label?.toLowerCase() || "value"}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => {
            setDraft(field.value);
            setEditing(true);
          }}
          className="group mt-0.5 flex w-full items-start gap-1.5 rounded-md px-1 py-0.5 text-left text-sm text-text hover:bg-surface-2"
        >
          <span className="flex-1 whitespace-pre-wrap">{field.value}</span>
          <Pencil className="mt-0.5 h-3 w-3 shrink-0 text-text-subtle opacity-0 transition-opacity group-hover:opacity-100" />
        </button>
      )}
    </div>
  );
}

function ContractPane({
  address,
  pdfUrl,
}: {
  address: string;
  pdfUrl?: string;
}) {
  return (
    <div className="flex h-[640px] flex-col overflow-hidden rounded-xl border border-border bg-surface-2">
      <div className="flex items-center gap-2 border-b border-border bg-surface px-3 py-2">
        <FileText className="h-4 w-4 text-text-muted" />
        <span className="truncate text-sm font-medium text-text">
          {address} — contract
        </span>
      </div>
      {pdfUrl ? (
        <iframe
          src={pdfUrl}
          title="Contract preview"
          className="h-full w-full bg-white"
        />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
          <FileText className="h-8 w-8 text-text-subtle" />
          <p className="text-sm font-medium text-text">Contract preview</p>
          <p className="max-w-[240px] text-xs text-text-muted">
            The uploaded contract renders here, page by page, so you can
            check every field against the source.
          </p>
        </div>
      )}
    </div>
  );
}
