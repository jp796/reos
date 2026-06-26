"use client";

/**
 * StepProgress — the "Step N of 5" header for the guided intake wizard.
 *
 * A row of connected dots: completed + current steps fill brand-blue,
 * upcoming steps stay muted. Matches the clean progress bar in the
 * guided-setup flow (see docs/VISION_GUIDED_INTAKE.md). Optional labels
 * show under each dot on wider screens.
 */

import { cn } from "@/lib/cn";

export function StepProgress({
  current,
  total,
  labels,
}: {
  /** 1-based index of the current step. */
  current: number;
  total: number;
  /** Optional per-step labels (length should equal `total`). */
  labels?: string[];
}) {
  const steps = Array.from({ length: total }, (_, i) => i + 1);

  return (
    <div className="w-full">
      <div className="text-center text-sm font-medium text-text-muted">
        Step {current} of {total}
      </div>
      <div className="mx-auto mt-3 flex max-w-md items-center">
        {steps.map((n, i) => {
          const done = n < current;
          const active = n === current;
          const reached = n <= current;
          return (
            <div key={n} className="flex flex-1 items-center last:flex-none">
              <div className="flex flex-col items-center">
                <span
                  className={cn(
                    "flex h-3.5 w-3.5 items-center justify-center rounded-full transition-colors",
                    reached ? "bg-brand-600" : "bg-border",
                    active && "ring-4 ring-brand-100 dark:ring-brand-950/50",
                  )}
                  aria-current={active ? "step" : undefined}
                />
                {labels?.[i] ? (
                  <span
                    className={cn(
                      "mt-1.5 hidden whitespace-nowrap text-[11px] sm:block",
                      reached ? "font-medium text-text" : "text-text-subtle",
                    )}
                  >
                    {labels[i]}
                  </span>
                ) : null}
              </div>
              {i < steps.length - 1 ? (
                <span
                  className={cn(
                    "mx-1.5 h-0.5 flex-1 rounded transition-colors",
                    done ? "bg-brand-600" : "bg-border",
                  )}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
