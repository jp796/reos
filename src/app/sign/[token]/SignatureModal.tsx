"use client";

/**
 * Signature capture — draw with finger/mouse on canvas, or type and
 * render in a script font. Either way the output is a PNG data URL,
 * so the server only ever deals with one signature format.
 */

import { useCallback, useEffect, useRef, useState } from "react";

const CANVAS_W = 600;
const CANVAS_H = 200;

export function SignatureModal({
  signerName,
  onApply,
  onCancel,
}: {
  signerName: string;
  onApply: (pngDataUrl: string) => void;
  onCancel: () => void;
}) {
  const [tab, setTab] = useState<"draw" | "type">("draw");
  const [typed, setTyped] = useState(signerName);
  const [hasInk, setHasInk] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#1e2a5a";
  }, [tab]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * CANVAS_W,
      y: ((e.clientY - rect.top) / rect.height) * CANVAS_H,
    };
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    last.current = point(e);
  };

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || !last.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const p = point(e);
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    setHasInk(true);
  };

  const onUp = () => {
    drawing.current = false;
    last.current = null;
  };

  const clear = () => {
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    setHasInk(false);
  };

  const apply = useCallback(() => {
    if (tab === "draw") {
      const canvas = canvasRef.current;
      if (!canvas || !hasInk) return;
      onApply(canvas.toDataURL("image/png"));
      return;
    }
    // Type: render the typed name to an offscreen canvas in a script font.
    const text = typed.trim();
    if (!text) return;
    const canvas = document.createElement("canvas");
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let size = 72;
    const font = (s: number) =>
      `${s}px "Brush Script MT", "Snell Roundhand", "Segoe Script", cursive`;
    ctx.font = font(size);
    while (size > 18 && ctx.measureText(text).width > CANVAS_W - 60) {
      size -= 4;
      ctx.font = font(size);
    }
    ctx.fillStyle = "#1e2a5a";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, CANVAS_W / 2, CANVAS_H / 2);
    onApply(canvas.toDataURL("image/png"));
  }, [tab, typed, hasInk, onApply]);

  const canApply = tab === "draw" ? hasInk : typed.trim().length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center">
      <div className="w-full max-w-lg rounded-lg bg-white p-4 shadow-xl">
        <h2 className="text-sm font-semibold text-neutral-800">
          Add your signature
        </h2>

        <div className="mt-3 flex gap-1 rounded-md bg-neutral-100 p-1 text-sm">
          {(["draw", "type"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={
                "flex-1 rounded px-3 py-1.5 font-medium capitalize " +
                (tab === t ? "bg-white shadow-sm" : "text-neutral-500")
              }
            >
              {t}
            </button>
          ))}
        </div>

        {tab === "draw" ? (
          <div className="mt-3">
            <canvas
              ref={canvasRef}
              width={CANVAS_W}
              height={CANVAS_H}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerLeave={onUp}
              className="h-40 w-full touch-none rounded-md border border-dashed border-neutral-300 bg-neutral-50"
            />
            <div className="mt-1 flex justify-between text-xs text-neutral-500">
              <span>Sign above with your finger or mouse</span>
              <button type="button" onClick={clear} className="underline">
                Clear
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-3">
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              maxLength={60}
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
              placeholder="Type your full name"
            />
            <div
              className="mt-2 flex h-24 items-center justify-center rounded-md border border-dashed border-neutral-300 bg-neutral-50 text-4xl text-[#1e2a5a]"
              style={{
                fontFamily:
                  '"Brush Script MT", "Snell Roundhand", "Segoe Script", cursive',
              }}
            >
              {typed.trim() || " "}
            </div>
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-neutral-300 px-4 py-2 text-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={apply}
            disabled={!canApply}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Apply signature
          </button>
        </div>
      </div>
    </div>
  );
}
