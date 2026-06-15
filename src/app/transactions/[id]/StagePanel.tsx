"use client";

/**
 * StagePanel — investor strategy lifecycle for a deal (spec §6).
 * Renders only for deals whose Asset has a stage template (wholesale,
 * etc.). Shows the ordered stages with the current one highlighted and
 * an "Advance" control that instantiates the next stage's tasks (which
 * appear in the Tasks panel below). Retail deals never render this.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Boxes } from "lucide-react";
import { useToast } from "@/app/ToastProvider";

interface Stage {
  key: string;
  name: string;
}

export function StagePanel({
  assetId,
  strategyLabel,
  stages,
  currentStageKey,
}: {
  assetId: string;
  strategyLabel: string;
  stages: Stage[];
  currentStageKey: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  const currentIdx = currentStageKey
    ? stages.findIndex((s) => s.key === currentStageKey)
    : -1;
  const atEnd = currentIdx >= 0 && currentIdx === stages.length - 1;
  const notStarted = currentIdx === -1;

  async function advance() {
    setBusy(true);
    try {
      const res = await fetch(`/api/assets/${assetId}/advance-stage`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error("Advance failed", data.error ?? res.statusText);
        return;
      }
      if (data.done) {
        toast.success("Final stage", "This deal is at its last stage.");
      } else {
        toast.success(
          "Stage advanced",
          `Now: ${stages.find((s) => s.key === data.to)?.name ?? data.to} · ${data.created} task(s) added`,
        );
      }
      startTransition(() => router.refresh());
    } catch (e) {
      toast.error("Advance failed", e instanceof Error ? e.message : "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-8 rounded-md border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Boxes className="h-4 w-4 text-brand-700" strokeWidth={1.8} />
          <h2 className="text-sm font-medium">
            Strategy lifecycle ·{" "}
            <span className="text-brand-700">{strategyLabel}</span>
          </h2>
        </div>
        <button
          type="button"
          onClick={advance}
          disabled={busy || atEnd}
          className="inline-flex items-center gap-1 rounded-md bg-brand-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-500 disabled:opacity-50"
          title={
            notStarted
              ? "Seed the first stage"
              : atEnd
                ? "Already at the final stage"
                : "Advance to the next stage"
          }
        >
          {notStarted ? "Start lifecycle" : atEnd ? "Final stage" : "Advance stage"}
          {!atEnd && <ArrowRight className="h-3 w-3" strokeWidth={2} />}
        </button>
      </div>

      <ol className="flex flex-wrap gap-1.5">
        {stages.map((s, i) => {
          const done = currentIdx >= 0 && i < currentIdx;
          const active = i === currentIdx;
          return (
            <li
              key={s.key}
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs ${
                active
                  ? "border-brand-500 bg-brand-50 font-medium text-brand-700"
                  : done
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-border bg-surface text-text-muted"
              }`}
            >
              {done && <Check className="h-3 w-3" strokeWidth={2.5} />}
              <span className="tabular-nums opacity-60">{i + 1}.</span>
              {s.name}
            </li>
          );
        })}
      </ol>
      <p className="mt-2 text-xs text-text-muted">
        Advancing instantiates the next stage&rsquo;s tasks — they appear in
        the Tasks panel below.
      </p>
    </section>
  );
}
