/**
 * Timeline model for the guided-intake Step 3.
 *
 * The computed deadline list. Built from the extraction's dates +
 * relative-deadline engine when wired; carries the real 1650 North Ridge
 * Dr timeline as a fixture until then. `milestone` drives the flag (a key
 * date like Closing) shown green in the UI.
 */

export interface TimelineItem {
  id: string;
  name: string;
  /** ISO YYYY-MM-DD. */
  date: string;
  /** e.g. "3 business days after Effective Date". */
  relativeNote?: string;
  milestone?: boolean;
}

export const FIXTURE_TIMELINE: TimelineItem[] = [
  { id: "offer", name: "Offer to Purchase Date", date: "2026-06-12" },
  { id: "effective", name: "Effective Date", date: "2026-06-16" },
  { id: "offer-exp", name: "Offer Expiration Deadline", date: "2026-06-16" },
  { id: "prequal", name: "Pre-qualification Letter Deadline", date: "2026-06-18" },
  {
    id: "emd",
    name: "Earnest Money Deposit Deadline",
    date: "2026-06-22",
    relativeNote: "3 business days after Effective Date",
  },
  {
    id: "loan-app",
    name: "Loan Application Deadline",
    date: "2026-06-22",
    relativeNote: "3 business days after Effective Date",
  },
  {
    id: "title-commit",
    name: "Title Insurance Commitment Delivery Deadline",
    date: "2026-06-24",
    relativeNote: "5 business days after Effective Date",
  },
  { id: "insp-obj", name: "Inspection Objection Deadline", date: "2026-06-30" },
  {
    id: "title-defect",
    name: "Title Defect Notice Deadline",
    date: "2026-07-01",
    relativeNote: "5 business days after Title Insurance Commitment Delivery",
  },
  { id: "insp-res", name: "Inspection Resolution Deadline", date: "2026-07-03" },
  { id: "closing", name: "Closing Date", date: "2026-07-14", milestone: true },
  {
    id: "possession",
    name: "Possession Date",
    date: "2026-07-14",
    relativeNote: "0 business days after Closing Date",
  },
];

/** "Tue, Jun 16, 2026" — friendly long format from an ISO date. */
export function fmtTimelineDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
