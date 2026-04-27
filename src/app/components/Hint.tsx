"use client";

/**
 * Hint — minimal tooltip wrapper.
 *
 *   <Hint label="Mark this milestone complete">
 *     <button>…</button>
 *   </Hint>
 *
 * Built on Radix Tooltip so we get a11y + keyboard support for free.
 * Styled to match the REOS surface tokens. Default delay 400ms so
 * it doesn't pop on every passing hover.
 */

import * as React from "react";
import * as Tooltip from "@radix-ui/react-tooltip";

interface HintProps {
  /** The trigger node — usually a button or icon. */
  children: React.ReactNode;
  /** Tooltip text. */
  label: string;
  /** Side to show on. Default: top. */
  side?: "top" | "right" | "bottom" | "left";
  /** Delay before show, ms. Default 400. */
  delayMs?: number;
  /** When false, render children only — useful for disabled-by-flag UIs. */
  enabled?: boolean;
}

export function Hint({
  children,
  label,
  side = "top",
  delayMs = 400,
  enabled = true,
}: HintProps) {
  if (!enabled) return <>{children}</>;
  return (
    <Tooltip.Provider delayDuration={delayMs} skipDelayDuration={150}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side={side}
            sideOffset={6}
            className="z-50 max-w-xs rounded-md border border-border bg-surface px-2 py-1 text-xs text-text shadow-md data-[state=closed]:animate-out data-[state=delayed-open]:animate-in data-[state=closed]:fade-out-0 data-[state=delayed-open]:fade-in-0"
          >
            {label}
            <Tooltip.Arrow className="fill-border" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
