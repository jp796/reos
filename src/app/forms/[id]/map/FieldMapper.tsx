"use client";

/**
 * FieldMapper — the "auto-place + nudge" editor for a flat form.
 * Shows the rendered form pages; each field is a draggable chip you drop
 * onto the right blank. Auto-placed from label anchors on load; you nudge
 * what's off and Save. The saved coordinate map fills the form exactly on
 * every future deal (DocuSign-style "set up once, reuse").
 *
 * Coordinates are stored in PDF points (origin bottom-left). Display
 * conversion per page: left = xPt/wPt*W, top = (hPt-yPt)/hPt*H.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/app/ToastProvider";

const PAGE_W = 680; // display width per page, px

interface PageInfo { index: number; widthPt: number; heightPt: number; png: string }
interface CatalogItem { key: string; label: string; kind: string }
interface Placement { field: string; page: number; xPt: number; yPt: number; size?: number }

export function FieldMapper({ formId, formName }: { formId: string; formName: string }) {
  const router = useRouter();
  const toast = useToast();
  const [pages, setPages] = useState<PageInfo[]>([]);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [drag, setDrag] = useState<string | null>(null); // field key being dragged
  const pageRefs = useRef<Record<number, HTMLDivElement | null>>({});

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`/api/forms/${formId}/pages`);
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "load failed");
        setPages(d.pages ?? []);
        setCatalog(d.catalog ?? []);
        setPlacements(d.placements ?? []);
      } catch (e) {
        toast.error("Couldn't load form", e instanceof Error ? e.message : "unknown");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formId]);

  const labelFor = (key: string) => catalog.find((c) => c.key === key)?.label ?? key;
  const placedKeys = new Set(placements.map((p) => p.field));
  const unplaced = catalog.filter((c) => !placedKeys.has(c.key));

  // Drag a marker within its page → convert mouse to PDF coords.
  useEffect(() => {
    if (!drag) return;
    const pl = placements.find((p) => p.field === drag);
    if (!pl) return;
    const page = pages[pl.page];
    const el = pageRefs.current[pl.page];
    if (!page || !el) return;

    function onMove(e: MouseEvent) {
      const rect = el!.getBoundingClientRect();
      const W = rect.width;
      const H = rect.height;
      const ox = Math.min(Math.max(e.clientX - rect.left, 0), W);
      const oy = Math.min(Math.max(e.clientY - rect.top, 0), H);
      const xPt = (ox / W) * page!.widthPt;
      const yPt = page!.heightPt - (oy / H) * page!.heightPt;
      setPlacements((prev) => prev.map((p) => (p.field === drag ? { ...p, xPt, yPt } : p)));
    }
    function onUp() { setDrag(null); }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [drag, placements, pages]);

  function addField(key: string) {
    // Place new fields near the top of page 0 so they're easy to grab.
    const p0 = pages[0];
    if (!p0) return;
    setPlacements((prev) => [
      ...prev,
      { field: key, page: 0, xPt: p0.widthPt * 0.2, yPt: p0.heightPt * 0.9 },
    ]);
  }
  function removeField(key: string) {
    setPlacements((prev) => prev.filter((p) => p.field !== key));
  }

  async function save() {
    setSaving(true);
    try {
      const r = await fetch(`/api/forms/${formId}/placements`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ placements }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "save failed");
      toast.success("Field map saved", `${d.saved} field(s). This form now fills exactly for any deal.`);
      router.push("/forms");
    } catch (e) {
      toast.error("Save failed", e instanceof Error ? e.message : "unknown");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-sm text-text-muted">Loading the form…</p>;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_220px] lg:items-start">
      {/* Pages with draggable markers */}
      <div className="space-y-4">
        {pages.map((pg) => {
          const H = (PAGE_W * pg.heightPt) / pg.widthPt;
          return (
            <div
              key={pg.index}
              ref={(el) => { pageRefs.current[pg.index] = el; }}
              className="relative mx-auto border border-border shadow-sm"
              style={{ width: PAGE_W, height: H }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={pg.png} alt={`page ${pg.index + 1}`} className="block h-full w-full select-none" draggable={false} />
              {placements
                .filter((p) => p.page === pg.index)
                .map((p) => {
                  const left = (p.xPt / pg.widthPt) * PAGE_W;
                  const top = ((pg.heightPt - p.yPt) / pg.heightPt) * H;
                  return (
                    <div
                      key={p.field}
                      onMouseDown={(e) => { e.preventDefault(); setDrag(p.field); }}
                      className={`absolute -translate-y-1/2 cursor-move whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold shadow ${
                        drag === p.field ? "bg-brand-600 text-white ring-2 ring-brand-300" : "bg-brand-500/90 text-white"
                      }`}
                      style={{ left, top }}
                      title="Drag onto the blank"
                    >
                      {labelFor(p.field)}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); removeField(p.field); }}
                        className="ml-1 opacity-70 hover:opacity-100"
                      >×</button>
                    </div>
                  );
                })}
            </div>
          );
        })}
      </div>

      {/* Sidebar: unplaced fields + save */}
      <aside className="sticky top-4 space-y-3 rounded-lg border border-border bg-surface p-3">
        <div>
          <div className="text-sm font-medium">{formName}</div>
          <div className="text-xs text-text-muted">
            Drag each chip onto its blank. Auto-placed on load — nudge what&apos;s off.
          </div>
        </div>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="w-full rounded-md bg-brand-500 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save field map"}
        </button>
        {unplaced.length > 0 && (
          <div>
            <div className="reos-label mb-1 opacity-70">Add a field</div>
            <div className="flex flex-wrap gap-1">
              {unplaced.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => addField(c.key)}
                  className="rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[11px] text-text-muted hover:border-brand-400 hover:text-brand-700"
                >
                  + {c.label}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="text-[11px] text-text-muted">
          Placed: {placements.length} · Pages: {pages.length}
        </div>
      </aside>
    </div>
  );
}
