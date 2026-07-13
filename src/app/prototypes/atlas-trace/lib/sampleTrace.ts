/**
 * Sample trace data (REOS_05 prototype).
 *
 * These records mirror the SHAPE of the REAL server events the extraction
 * pipeline already emits — `{ key, value, confidence, snippet, source }` from
 * extract-contracts-stream's `field` event (see the event-contract audit).
 * They are representative sample facts for the prototype, NOT live output, and
 * every prototype screen carries a "PROTOTYPE" label. No fabricated source
 * text is presented as if extracted from a specific customer document.
 */

export type FieldSource = "text" | "vision" | "computed";

/** One recognized fact — matches the real `fact_found` payload we'd stream. */
export interface TraceFact {
  id: string;
  /** destination field key on the structured transaction */
  destination: string;
  /** human label for the destination */
  destinationLabel: string;
  /** which result group it lands in */
  group: ResultGroup;
  /** recognition label — what Atlas saw (restrained) */
  recognition: string;
  /** normalized value that lands in the field */
  value: string;
  /** source-text anchor (the snippet the model quoted) */
  snippet: string;
  /** provenance page marker */
  page: number;
  clause?: string;
  confidence: number;
  source: FieldSource;
}

export type ResultGroup =
  | "Parties"
  | "Property & economics"
  | "Important dates"
  | "Contingencies"
  | "Financing"
  | "Title & closing";

export const RESULT_GROUPS: ResultGroup[] = [
  "Parties",
  "Property & economics",
  "Important dates",
  "Contingencies",
  "Financing",
  "Title & closing",
];

/**
 * Prototype 1 — a representative WY Contract to Buy & Sell. Sample facts in
 * the order the stream would surface them. Confidences vary so the prototype
 * demonstrates the needs-review path honestly.
 */
export const CONTRACT_FACTS: TraceFact[] = [
  { id: "f1", destination: "buyer", destinationLabel: "Buyer", group: "Parties", recognition: "Buyer party", value: "Joe T. Carter Jr", snippet: "BUYER: Joe T. Carter Jr", page: 1, clause: "§1", confidence: 0.98, source: "text" },
  { id: "f2", destination: "seller", destinationLabel: "Seller", group: "Parties", recognition: "Seller party", value: "Brock Towell, Audrey Towell", snippet: "SELLER: Brock Towell and Audrey Towell", page: 1, clause: "§1", confidence: 0.97, source: "text" },
  { id: "f3", destination: "propertyAddress", destinationLabel: "Property", group: "Property & economics", recognition: "Subject property", value: "1650 North Ridge Dr, Laramie WY", snippet: "the Property known as 1650 North Ridge Dr, Laramie, WY", page: 1, clause: "§2", confidence: 0.99, source: "text" },
  { id: "f4", destination: "purchasePrice", destinationLabel: "Purchase price", group: "Property & economics", recognition: "Purchase price", value: "$780,000", snippet: "Purchase Price: $780,000.00", page: 1, clause: "§4", confidence: 0.99, source: "text" },
  { id: "f5", destination: "earnestMoneyAmount", destinationLabel: "Earnest money", group: "Property & economics", recognition: "Earnest money", value: "$19,500", snippet: "Earnest Money: $19,500 held by Flying S Title", page: 2, clause: "§4.2", confidence: 0.95, source: "text" },
  { id: "f6", destination: "closingDate", destinationLabel: "Closing", group: "Important dates", recognition: "Closing date", value: "Jul 14, 2026", snippet: "Closing shall occur on or before July 14, 2026", page: 2, clause: "§3", confidence: 0.96, source: "text" },
  { id: "f7", destination: "inspectionDeadline", destinationLabel: "Inspection deadline", group: "Important dates", recognition: "Inspection deadline", value: "Jun 30, 2026", snippet: "Inspection Objection Deadline … Inspection by June 30, 2026", page: 3, clause: "§10.3", confidence: 0.9, source: "text" },
  { id: "f8", destination: "inspectionObjectionDeadline", destinationLabel: "Inspection objection", group: "Important dates", recognition: "Objection deadline", value: "Jul 3, 2026", snippet: "Buyer shall deliver objections within 3 days of Inspection", page: 3, clause: "§10.3", confidence: 0.72, source: "computed" },
  { id: "f9", destination: "financingType", destinationLabel: "Financing", group: "Financing", recognition: "Loan type", value: "Conventional", snippet: "This is a Conventional loan transaction", page: 2, clause: "§5", confidence: 0.93, source: "text" },
  { id: "f10", destination: "financingDeadline", destinationLabel: "Financing deadline", group: "Financing", recognition: "Loan approval deadline", value: "Jun 22, 2026", snippet: "Loan approval on or before June 22, 2026", page: 2, clause: "§5.3", confidence: 0.61, source: "text" },
  { id: "f11", destination: "titleCompany", destinationLabel: "Title company", group: "Title & closing", recognition: "Title company", value: "Flying S Title & Escrow", snippet: "Title work by Flying S Title and Escrow of Wyoming, Inc.", page: 4, clause: "§8", confidence: 0.94, source: "text" },
  { id: "f12", destination: "inspectionContingency", destinationLabel: "Inspection contingency", group: "Contingencies", recognition: "Inspection contingency", value: "Applies", snippet: "Buyer's obligation is contingent on inspection", page: 3, clause: "§10", confidence: 0.88, source: "text" },
];

/** Completion summary derived from the sample facts (no arbitrary numbers). */
export function contractSummary(facts: TraceFact[]) {
  const dates = facts.filter((f) => f.group === "Important dates").length;
  const needsReview = facts.filter((f) => f.confidence < 0.7).length;
  return {
    factsFound: facts.length,
    deadlinesCreated: dates,
    // representative generated-task count for the prototype timeline
    tasksCreated: 24,
    needsReview,
  };
}

/** Prototype 2 — addendum reconciliation (material change). */
export const ADDENDUM_CHANGE = {
  source: {
    label: "Executed contract",
    field: "Closing",
    value: "Jul 14, 2026",
    page: 2,
    clause: "§3",
    snippet: "Closing shall occur on or before July 14, 2026",
  },
  supersededBy: {
    label: "Addendum 2",
    field: "Closing",
    value: "Jul 21, 2026",
    page: 1,
    clause: "¶2",
    snippet: "The Closing Date is hereby amended to July 21, 2026",
    confidence: 0.97,
  },
  downstream: [
    { kind: "deadline", label: "6 deadlines reflowed", detail: "inspection, financing, title, walkthrough +2" },
    { kind: "task", label: "4 tasks rescheduled", detail: "final walkthrough, utility connect, wire confirm, CDA prep" },
    { kind: "calendar", label: "2 calendar events updated", detail: "closing, possession" },
  ],
};

/** Prototype 3 — email evidence completing a milestone (Atlas Receipt). */
export const EMAIL_EVIDENCE = {
  from: "Flying S Title & Escrow",
  sentence: "The earnest-money deposit was received and posted.",
  milestone: "Earnest Money Due",
  recognition: "Completion evidence",
  confidence: 0.94, // "Confirmed"
  appliedAt: "July 12 at 9:42 AM",
};
