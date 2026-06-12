"use client";

/**
 * FieldPlacementEditor — place e-signature fields on a PDF before sending.
 *
 * Controlled component: the full `fields` array is owned by the parent and
 * passed in via props; every mutation (add / move / delete) calls `onChange`
 * with a brand-new array. The component holds NO field state of its own —
 * only ephemeral UI state (current page, selected recipient, selected type,
 * the in-flight drag, and the rendered page-image size).
 *
 * Coordinates are normalized to 0..1 with a top-left origin, relative to the
 * rendered page image. A ResizeObserver (plus an onLoad fallback) tracks the
 * image's pixel size so clicks and drags map to/from normalized space
 * correctly regardless of zoom, container width, or device pixel ratio.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  PenLine,
  Type as TypeIcon,
  Calendar,
  Hash,
  X,
} from "lucide-react";

// ── Exported types (props contract) ────────────────────────────────────────

export type EsignFieldType = "SIGNATURE" | "INITIALS" | "DATE_SIGNED" | "TEXT";

export interface PlacedField {
  id: string; // client-generated, e.g. crypto.randomUUID()
  type: EsignFieldType;
  page: number; // 1-based
  x: number;
  y: number; // normalized 0..1, top-left origin relative to page image
  width: number;
  height: number; // normalized 0..1
  recipientIndex: number; // index into the recipients prop
}

export interface FieldEditorRecipient {
  name: string;
  email: string;
}

interface FieldPlacementEditorProps {
  pageCount: number;
  /** Returns the image URL for a given 1-based page. */
  pageImageUrl: (page: number) => string;
  recipients: FieldEditorRecipient[];
  fields: PlacedField[];
  onChange: (fields: PlacedField[]) => void;
}

// ── Constants ──────────────────────────────────────────────────────────────

/** Fixed palette; recipients cycle through these by index. */
const RECIPIENT_COLORS: readonly RecipientColor[] = [
  { dot: "#2563eb", tint: "rgba(37, 99, 235, 0.18)", border: "#2563eb" }, // blue
  { dot: "#16a34a", tint: "rgba(22, 163, 74, 0.18)", border: "#16a34a" }, // green
  { dot: "#d97706", tint: "rgba(217, 119, 6, 0.18)", border: "#d97706" }, // amber
  { dot: "#db2777", tint: "rgba(219, 39, 119, 0.18)", border: "#db2777" }, // pink
  { dot: "#7c3aed", tint: "rgba(124, 58, 237, 0.18)", border: "#7c3aed" }, // violet
  { dot: "#0891b2", tint: "rgba(8, 145, 178, 0.18)", border: "#0891b2" }, // cyan
] as const;

interface RecipientColor {
  dot: string;
  tint: string;
  border: string;
}

interface FieldTypeSpec {
  type: EsignFieldType;
  label: string;
  icon: typeof PenLine;
  /** Default normalized size when placed. */
  width: number;
  height: number;
}

const FIELD_TYPES: readonly FieldTypeSpec[] = [
  { type: "SIGNATURE", label: "Signature", icon: PenLine, width: 0.22, height: 0.05 },
  { type: "INITIALS", label: "Initials", icon: Hash, width: 0.08, height: 0.04 },
  { type: "DATE_SIGNED", label: "Date signed", icon: Calendar, width: 0.12, height: 0.035 },
  { type: "TEXT", label: "Text", icon: TypeIcon, width: 0.18, height: 0.035 },
] as const;

// ── Pure helpers ─────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/** Clamp a field's top-left so the whole field stays inside the page (0..1). */
function clampPosition(x: number, y: number, width: number, height: number): { x: number; y: number } {
  return {
    x: clamp(x, 0, Math.max(0, 1 - width)),
    y: clamp(y, 0, Math.max(0, 1 - height)),
  };
}

function colorFor(recipientIndex: number): RecipientColor {
  // Guard against an out-of-range index so a stale field never crashes render.
  const safeIndex = ((recipientIndex % RECIPIENT_COLORS.length) + RECIPIENT_COLORS.length) % RECIPIENT_COLORS.length;
  return RECIPIENT_COLORS[safeIndex]!;
}

function firstName(fullName: string): string {
  const trimmed = fullName.trim();
  if (trimmed.length === 0) return "Recipient";
  return trimmed.split(/\s+/)[0]!;
}

function typeLabel(type: EsignFieldType): string {
  const spec = FIELD_TYPES.find((t) => t.type === type);
  return spec ? spec.label : type;
}

// ── Drag bookkeeping ─────────────────────────────────────────────────────────

interface DragState {
  fieldId: string;
  pointerId: number;
  /** Offset (normalized) from the field's top-left to the grab point. */
  grabDx: number;
  grabDy: number;
}

// ── Component ────────────────────────────────────────────────────────────────

export function FieldPlacementEditor({
  pageCount,
  pageImageUrl,
  recipients,
  fields,
  onChange,
}: FieldPlacementEditorProps): JSX.Element {
  // pageCount can arrive as 0 (no document) — clamp the working count to >= 1
  // for navigation math, but render an explicit empty state below.
  const totalPages = Math.max(1, Math.floor(pageCount) || 1);

  const [page, setPage] = useState(1);
  const [recipientIndex, setRecipientIndex] = useState(0);
  const [activeType, setActiveType] = useState<EsignFieldType>("SIGNATURE");

  // Rendered pixel size of the page image; drives normalized <-> pixel mapping.
  const [imageSize, setImageSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });

  const imageRef = useRef<HTMLImageElement | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const dragRef = useRef<DragState | null>(null);

  const hasDocument = pageCount >= 1 && recipients.length > 0;
  const safeRecipientIndex = recipients.length > 0 ? clamp(recipientIndex, 0, recipients.length - 1) : 0;

  // Callback ref: wires a ResizeObserver to whichever <img> React mounts, and
  // tears the previous one down. No useEffect, so no dependency-loop hazard.
  const setImageNode = useCallback((node: HTMLImageElement | null) => {
    imageRef.current = node;

    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }

    if (!node) {
      setImageSize({ width: 0, height: 0 });
      return;
    }

    const measure = () => {
      const rect = node.getBoundingClientRect();
      setImageSize((prev) =>
        prev.width === rect.width && prev.height === rect.height
          ? prev
          : { width: rect.width, height: rect.height },
      );
    };

    measure();

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(measure);
      observer.observe(node);
      observerRef.current = observer;
    }
  }, []);

  // Fields belonging to the page currently shown.
  const pageFields = useMemo(() => fields.filter((f) => f.page === page), [fields, page]);

  // ── Mutations (always emit a fresh array) ──────────────────────────────────

  function addField(normX: number, normY: number) {
    if (recipients.length === 0) return;
    const spec = FIELD_TYPES.find((t) => t.type === activeType);
    if (!spec) return;

    // Center the field on the click point, then clamp inside the page.
    const { x, y } = clampPosition(
      normX - spec.width / 2,
      normY - spec.height / 2,
      spec.width,
      spec.height,
    );

    const next: PlacedField = {
      id: newId(),
      type: activeType,
      page,
      x,
      y,
      width: spec.width,
      height: spec.height,
      recipientIndex: safeRecipientIndex,
    };
    onChange([...fields, next]);
  }

  function moveField(fieldId: string, normX: number, normY: number) {
    onChange(
      fields.map((f) => {
        if (f.id !== fieldId) return f;
        const { x, y } = clampPosition(normX, normY, f.width, f.height);
        return { ...f, x, y };
      }),
    );
  }

  function deleteField(fieldId: string) {
    onChange(fields.filter((f) => f.id !== fieldId));
  }

  // ── Pointer geometry ───────────────────────────────────────────────────────

  /** Convert a client pointer position to normalized page coords (clamped 0..1). */
  function clientToNormalized(clientX: number, clientY: number): { x: number; y: number } | null {
    const node = imageRef.current;
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    return {
      x: clamp((clientX - rect.left) / rect.width, 0, 1),
      y: clamp((clientY - rect.top) / rect.height, 0, 1),
    };
  }

  function handlePagePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    // Ignore clicks that originated on a field overlay (those handle themselves)
    // or while a drag is in progress.
    if (dragRef.current) return;
    if (e.button !== 0 && e.pointerType === "mouse") return;
    const point = clientToNormalized(e.clientX, e.clientY);
    if (!point) return;
    addField(point.x, point.y);
  }

  function handleFieldPointerDown(e: React.PointerEvent<HTMLDivElement>, field: PlacedField) {
    // Start a drag. Stop propagation so the page surface doesn't also place a
    // new field, and capture the pointer so we keep receiving move/up events
    // (works for both mouse and touch).
    e.stopPropagation();
    if (e.button !== 0 && e.pointerType === "mouse") return;
    const point = clientToNormalized(e.clientX, e.clientY);
    if (!point) return;

    dragRef.current = {
      fieldId: field.id,
      pointerId: e.pointerId,
      grabDx: point.x - field.x,
      grabDy: point.y - field.y,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handleFieldPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    e.preventDefault();
    const point = clientToNormalized(e.clientX, e.clientY);
    if (!point) return;
    moveField(drag.fieldId, point.x - drag.grabDx, point.y - drag.grabDy);
  }

  function endDrag(e: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-3 text-sm">
      {/* Toolbar: recipient chips + field-type palette */}
      <div className="flex flex-col gap-3 rounded-md border bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
            Recipient
          </span>
          <div className="flex flex-wrap gap-2">
            {recipients.length === 0 ? (
              <span className="text-xs text-neutral-500 dark:text-neutral-400">
                Add recipients with email addresses first.
              </span>
            ) : (
              recipients.map((r, i) => {
                const color = colorFor(i);
                const selected = i === safeRecipientIndex;
                return (
                  <button
                    key={`${r.email}-${i}`}
                    type="button"
                    onClick={() => setRecipientIndex(i)}
                    className={
                      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors " +
                      (selected
                        ? "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900"
                        : "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800")
                    }
                    title={r.email}
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: color.dot }}
                      aria-hidden="true"
                    />
                    {firstName(r.name)}
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
            Field type
          </span>
          <div className="flex flex-wrap gap-2">
            {FIELD_TYPES.map((spec) => {
              const Icon = spec.icon;
              const selected = spec.type === activeType;
              return (
                <button
                  key={spec.type}
                  type="button"
                  onClick={() => setActiveType(spec.type)}
                  aria-pressed={selected}
                  className={
                    "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors " +
                    (selected
                      ? "border-blue-600 bg-blue-50 text-blue-700 dark:border-blue-500 dark:bg-blue-950 dark:text-blue-300"
                      : "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800")
                  }
                >
                  <Icon className="h-3.5 w-3.5" strokeWidth={1.8} />
                  {spec.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Page navigation */}
      <div className="flex items-center justify-between rounded-md border bg-white px-3 py-2 dark:border-neutral-800 dark:bg-neutral-900">
        <button
          type="button"
          onClick={() => setPage((p) => clamp(p - 1, 1, totalPages))}
          disabled={page <= 1}
          className="inline-flex items-center gap-1 rounded-md border border-neutral-200 px-2 py-1 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Prev
        </button>
        <span className="text-xs font-medium text-neutral-600 dark:text-neutral-300">
          Page {Math.min(page, totalPages)} of {totalPages}
        </span>
        <button
          type="button"
          onClick={() => setPage((p) => clamp(p + 1, 1, totalPages))}
          disabled={page >= totalPages}
          className="inline-flex items-center gap-1 rounded-md border border-neutral-200 px-2 py-1 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
        >
          Next
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Page surface */}
      {!hasDocument ? (
        <div className="flex min-h-[200px] items-center justify-center rounded-md border border-dashed bg-white p-6 text-center text-xs text-neutral-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400">
          {pageCount < 1
            ? "No document pages to place fields on."
            : "Add recipients with email addresses first."}
        </div>
      ) : (
        <div className="relative overflow-hidden rounded-md border bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-950">
          <div
            className="relative w-full cursor-crosshair select-none"
            onPointerDown={handlePagePointerDown}
            role="application"
            aria-label={`Page ${page} of ${totalPages} — click to place a ${typeLabel(activeType)} field`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={setImageNode}
              src={pageImageUrl(Math.min(page, totalPages))}
              alt={`Document page ${Math.min(page, totalPages)}`}
              draggable={false}
              onLoad={() => {
                // Fallback for environments without ResizeObserver, and to catch
                // the natural-size settle after the image decodes.
                const node = imageRef.current;
                if (!node) return;
                const rect = node.getBoundingClientRect();
                setImageSize((prev) =>
                  prev.width === rect.width && prev.height === rect.height
                    ? prev
                    : { width: rect.width, height: rect.height },
                );
              }}
              className="block h-auto w-full"
            />

            {/* Field overlays (only when we know the rendered size) */}
            {imageSize.width > 0 &&
              imageSize.height > 0 &&
              pageFields.map((field) => {
                const color = colorFor(field.recipientIndex);
                const recipient = recipients[field.recipientIndex];
                const name = recipient ? firstName(recipient.name) : "—";
                return (
                  <div
                    key={field.id}
                    onPointerDown={(e) => handleFieldPointerDown(e, field)}
                    onPointerMove={handleFieldPointerMove}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                    className="group absolute flex cursor-grab touch-none items-center justify-between gap-1 rounded-sm border-2 px-1 text-[10px] leading-none active:cursor-grabbing"
                    style={{
                      left: `${field.x * 100}%`,
                      top: `${field.y * 100}%`,
                      width: `${field.width * 100}%`,
                      height: `${field.height * 100}%`,
                      backgroundColor: color.tint,
                      borderColor: color.border,
                    }}
                    title={`${typeLabel(field.type)} · ${name}`}
                  >
                    <span
                      className="pointer-events-none truncate font-medium"
                      style={{ color: color.border }}
                    >
                      {typeLabel(field.type)} · {name}
                    </span>
                    <button
                      type="button"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteField(field.id);
                      }}
                      aria-label={`Delete ${typeLabel(field.type)} field for ${name}`}
                      className="pointer-events-auto flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-white/80 text-neutral-700 opacity-0 transition-opacity hover:bg-white group-hover:opacity-100"
                    >
                      <X className="h-2.5 w-2.5" strokeWidth={2.5} />
                    </button>
                  </div>
                );
              })}
          </div>

          {/* Empty-state hint overlaid at the top when nothing is placed yet */}
          {pageFields.length === 0 && (
            <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center p-2">
              <span className="rounded-full bg-neutral-900/80 px-3 py-1 text-[11px] font-medium text-white shadow-sm">
                Select a recipient and field type, then click on the page.
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** crypto.randomUUID when available, with a deterministic-enough fallback. */
function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `field-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
