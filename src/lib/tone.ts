/**
 * Themed tone utility classes.
 *
 * Reusable string constants that bake in dark-mode variants for our
 * common alert/status patterns. Use these instead of raw
 * `bg-red-50 text-red-700` triples — those produce illegible
 * white-on-light rectangles in dark mode.
 *
 *   <div className={toneBox("red")}>Error message</div>
 *
 * Each tone returns: light-bg + light-text in light mode, deep-bg +
 * tinted-text in dark mode, and a neutral border that reads on both.
 */

export type Tone = "red" | "amber" | "emerald" | "blue" | "violet" | "neutral";

const BOX: Record<Tone, string> = {
  red: "border-red-200 bg-red-50 text-red-900 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-100",
  amber:
    "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-100",
  emerald:
    "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-100",
  blue: "border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900/40 dark:bg-blue-950/40 dark:text-blue-100",
  violet:
    "border-violet-200 bg-violet-50 text-violet-900 dark:border-violet-900/40 dark:bg-violet-950/40 dark:text-violet-100",
  neutral:
    "border-border bg-surface text-text",
};

const PILL: Record<Tone, string> = {
  red: "bg-red-100 text-red-800 ring-red-200 dark:bg-red-950/50 dark:text-red-200 dark:ring-red-900/50",
  amber:
    "bg-amber-100 text-amber-800 ring-amber-200 dark:bg-amber-950/50 dark:text-amber-200 dark:ring-amber-900/50",
  emerald:
    "bg-emerald-100 text-emerald-800 ring-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-200 dark:ring-emerald-900/50",
  blue: "bg-blue-100 text-blue-800 ring-blue-200 dark:bg-blue-950/50 dark:text-blue-200 dark:ring-blue-900/50",
  violet:
    "bg-violet-100 text-violet-800 ring-violet-200 dark:bg-violet-950/50 dark:text-violet-200 dark:ring-violet-900/50",
  neutral:
    "bg-surface-2 text-text-muted ring-border",
};

/** Box / card / callout container for a tone. */
export function toneBox(t: Tone): string {
  return BOX[t];
}

/** Small status pill for a tone (badge style with ring). */
export function tonePill(t: Tone): string {
  return PILL[t];
}
