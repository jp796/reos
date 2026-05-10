"use client";

/**
 * DemoButton — drop-in "fake" save/add/delete/toggle button for the
 * /demo sandbox. Renders the same visual styles as the real buttons
 * elsewhere in the app, but every click fires the demo blocker
 * (toast + no-op).
 */

import { cn } from "@/lib/cn";
import { useDemoBlocker } from "./DemoGuard";

interface Props extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Verb shown in the toast — e.g. "Save", "Add task", "Delete". */
  action?: string;
  /** Visual variant — keep parity with the real app. */
  variant?: "primary" | "secondary" | "ghost" | "danger";
}

export function DemoButton({
  action,
  variant = "secondary",
  className,
  children,
  onClick,
  ...rest
}: Props) {
  const { block } = useDemoBlocker();
  const v: Record<NonNullable<Props["variant"]>, string> = {
    primary:
      "bg-brand-600 text-white hover:bg-brand-500",
    secondary:
      "border border-border bg-surface text-text hover:border-brand-500",
    ghost: "text-text-muted hover:text-text",
    danger:
      "border border-red-200 bg-red-50 text-danger hover:border-red-300 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300",
  };
  return (
    <button
      type="button"
      {...rest}
      onClick={(e) => {
        e.preventDefault();
        block(action);
        onClick?.(e);
      }}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
        v[variant],
        className,
      )}
    >
      {children}
    </button>
  );
}
