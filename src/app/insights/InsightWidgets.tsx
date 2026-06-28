/**
 * Insights — presentational widgets.
 *
 * Pure, server-renderable components fed entirely by props from
 * src/app/insights/page.tsx. No data fetching, no client state, no
 * tenant logic lives here — the page owns every query (all of which
 * are scoped by accountId + dealVisibilityWhere) and hands these
 * components already-shaped, already-formatted data.
 *
 * Visual language matches ReviewDetailsStep.tsx / today/page.tsx:
 *   - section cards: rounded-xl border border-border bg-surface p-4
 *   - metric cards:  rounded-md bg-surface-2 p-4
 *   - brand-600 (REOS blue) for primary accents
 *   - text-text / text-text-muted / text-text-subtle for type
 *
 * Charts are plain CSS bars (div widths by %) — no charting library.
 */

import Link from "next/link";
import type { LucideIcon } from "lucide-react";

// --------------------------------------------------
// Shared prop shapes — the page builds these, the widgets render them.
// --------------------------------------------------

export interface StageDatum {
  /** Raw status key: listing | active | pending | closed | dead. */
  key: string;
  /** Human label for the row. */
  label: string;
  /** Count of transactions in this stage (already an integer). */
  count: number;
}

export interface MonthDatum {
  /** "Jul", "Aug", … — short month label for the axis. */
  label: string;
  /** Summed gross commission for deals closing that month (dollars). */
  amount: number;
}

export interface DeadlineDatum {
  id: string;
  /** Milestone label, e.g. "Inspection objection". */
  label: string;
  /** Deal address (or fallback) for context. */
  dealAddress: string;
  transactionId: string;
  /** Pre-formatted "Mon DD" date string. */
  dateLabel: string;
}

export interface TaskDatum {
  id: string;
  /** Task title. */
  title: string;
  /** Deal address (or fallback) for context. */
  dealAddress: string;
  transactionId: string;
  /** Pre-formatted "Mon DD" date string. */
  dateLabel: string;
}

// --------------------------------------------------
// MetricCard — one number in the top KPI row.
// --------------------------------------------------

export function MetricCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  /** Already formatted by the page (currency string or integer string). */
  value: string;
  icon: LucideIcon;
}) {
  return (
    <div className="rounded-md bg-surface-2 p-4">
      <div className="flex items-center gap-1.5 text-[13px] text-text-muted">
        <Icon className="h-3.5 w-3.5 text-text-subtle" />
        <span>{label}</span>
      </div>
      <div className="mt-2 text-[24px] font-medium tabular-nums text-text">
        {value}
      </div>
    </div>
  );
}

// --------------------------------------------------
// WidgetCard — section shell shared by every widget below.
// --------------------------------------------------

function WidgetCard({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="reos-label">{title}</h2>
        {hint ? (
          <span className="text-[11px] text-text-subtle">{hint}</span>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function EmptyRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-border p-4 text-center text-sm text-text-muted">
      {children}
    </div>
  );
}

/** Width % for a bar, guarding against divide-by-zero and clamping 0–100. */
function barPct(value: number, max: number): number {
  if (max <= 0) return 0;
  const pct = (value / max) * 100;
  if (!Number.isFinite(pct)) return 0;
  return Math.min(100, Math.max(0, pct));
}

// --------------------------------------------------
// StageBar — deals grouped by status, horizontal CSS bars.
// --------------------------------------------------

export function StageBar({ data }: { data: StageDatum[] }) {
  const max = data.reduce((m, d) => Math.max(m, d.count), 0);
  const hasAny = data.some((d) => d.count > 0);
  return (
    <WidgetCard title="Deals by stage" hint="all open + closed">
      {!hasAny ? (
        <EmptyRow>No transactions yet.</EmptyRow>
      ) : (
        <ul className="space-y-2.5">
          {data.map((d) => (
            <li key={d.key}>
              <div className="mb-1 flex items-baseline justify-between text-sm">
                <span className="text-text">{d.label}</span>
                <span className="tabular-nums text-text-muted">{d.count}</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full rounded-full bg-brand-600 transition-[width]"
                  style={{ width: `${barPct(d.count, max)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}

// --------------------------------------------------
// GciBar — pipeline GCI by closing month, CSS bars + currency labels.
// --------------------------------------------------

export function GciBar({
  data,
  formatCurrency,
}: {
  data: MonthDatum[];
  /** Page-supplied currency formatter (Intl.NumberFormat-backed). */
  formatCurrency: (n: number) => string;
}) {
  const max = data.reduce((m, d) => Math.max(m, d.amount), 0);
  const hasAny = data.some((d) => d.amount > 0);
  return (
    <WidgetCard title="GCI by closing month" hint="next 6 months">
      {!hasAny ? (
        <EmptyRow>No commission scheduled in the next 6 months.</EmptyRow>
      ) : (
        <ul className="space-y-2.5">
          {data.map((d) => (
            <li key={d.label}>
              <div className="mb-1 flex items-baseline justify-between text-sm">
                <span className="text-text">{d.label}</span>
                <span className="tabular-nums text-text-muted">
                  {formatCurrency(d.amount)}
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full rounded-full bg-brand-600 transition-[width]"
                  style={{ width: `${barPct(d.amount, max)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}

// --------------------------------------------------
// DeadlineList — upcoming milestone deadlines (next 14 days).
// --------------------------------------------------

export function DeadlineList({ items }: { items: DeadlineDatum[] }) {
  return (
    <WidgetCard title="Upcoming deadlines" hint="next 14 days">
      {items.length === 0 ? (
        <EmptyRow>Nothing due in the next 14 days.</EmptyRow>
      ) : (
        <ul className="space-y-2">
          {items.map((d) => (
            <li
              key={d.id}
              className="flex items-center justify-between gap-3 rounded-md bg-surface-2 p-3"
            >
              <div className="min-w-0">
                <Link
                  href={`/transactions/${d.transactionId}`}
                  className="block truncate text-sm font-medium text-text hover:underline"
                >
                  {d.label}
                </Link>
                <div className="truncate text-xs text-text-muted">
                  {d.dealAddress}
                </div>
              </div>
              <span className="shrink-0 text-xs tabular-nums text-text-subtle">
                {d.dateLabel}
              </span>
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}

// --------------------------------------------------
// TaskList — overdue tasks.
// --------------------------------------------------

export function TaskList({ items }: { items: TaskDatum[] }) {
  return (
    <WidgetCard title="Overdue tasks" hint="past due, open">
      {items.length === 0 ? (
        <EmptyRow>No overdue tasks. Clean board.</EmptyRow>
      ) : (
        <ul className="space-y-2">
          {items.map((t) => (
            <li
              key={t.id}
              className="flex items-center justify-between gap-3 rounded-md bg-surface-2 p-3"
            >
              <div className="min-w-0">
                <Link
                  href={`/transactions/${t.transactionId}`}
                  className="block truncate text-sm font-medium text-text hover:underline"
                >
                  {t.title}
                </Link>
                <div className="truncate text-xs text-text-muted">
                  {t.dealAddress}
                </div>
              </div>
              <span className="shrink-0 text-xs tabular-nums text-danger">
                {t.dateLabel}
              </span>
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}
