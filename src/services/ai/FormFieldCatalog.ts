/**
 * FormFieldCatalog — the set of deal facts the flat-form mapper can place
 * onto a form, how to format each for overlay, and label anchors used to
 * AUTO-PLACE a first draft (the mapper then lets the user nudge).
 *
 * Legal note: these are FACTUAL fields only (names, dates, money, checks).
 * The mapper never generates legal or clause language — it only places
 * data a human supplied. See memory: forms-no-upl.
 */

export type FieldKind = "text" | "date" | "money" | "pct" | "check";

export interface CatalogField {
  key: string;
  label: string;
  kind: FieldKind;
  /** Line phrases to locate the field's blank on the form. */
  find: string[];
  /** "after" = blank follows the phrase; "lineStart" = blank begins the line. */
  mode: "after" | "lineStart";
}

// Keys align with the deal-facts object the fill route builds. `find`
// phrases + mode are tuned against the WY WAR contract's line-layout.
export const FIELD_CATALOG: CatalogField[] = [
  { key: "effectiveDate", label: "Effective date", kind: "date", find: ["dated "], mode: "after" },
  { key: "buyerNames", label: "Buyer(s)", kind: "text", find: [", from ", "from "], mode: "after" },
  { key: "sellerNames", label: "Seller(s)", kind: "text", find: ['("Seller")', "(“Seller”)"], mode: "lineStart" },
  { key: "propertyAddress", label: "Property address", kind: "text", find: ["commonly known as: ", "commonly known as"], mode: "after" },
  { key: "purchasePrice", label: "Purchase price", kind: "money", find: ["Dollars payable"], mode: "lineStart" },
  { key: "earnestMoney", label: "Earnest money", kind: "money", find: ["Buyer delivers $"], mode: "after" },
  { key: "earnestMoneyDueDate", label: "Earnest money due", kind: "date", find: ["No later than "], mode: "after" },
  { key: "closingDate", label: "Closing date", kind: "date", find: ["Closing shall occur on "], mode: "after" },
  { key: "possessionDate", label: "Possession date", kind: "date", find: ["Possession shall be delivered to Buyer on, ", "Possession shall be delivered to Buyer on"], mode: "after" },
  { key: "titleCommitmentDeadline", label: "Title commitment", kind: "date", find: ["title insurance commitment to Buyer no later than "], mode: "after" },
  { key: "titleObjectionDeadline", label: "Title objection", kind: "date", find: ["Business Days of receipt of the title", "object to title"], mode: "after" },
  { key: "financingDeadline", label: "Financing deadline", kind: "date", find: ["application to Lender within ", "pre-qualification letter"], mode: "after" },
  { key: "inspectionDeadline", label: "Inspection deadline", kind: "date", find: ["Buyer shall have", "Business Days after the Effective Date to inspect"], mode: "after" },
  { key: "inspectionObjectionDeadline", label: "Inspection objection", kind: "date", find: ["Objection Deadline"], mode: "after" },
  { key: "walkthroughDate", label: "Final walkthrough", kind: "date", find: ["Walkthrough(s). Seller grants"], mode: "lineStart" },
  { key: "titleCompany", label: "Title company", kind: "text", find: ["escrow account with ", "Funds Holder"], mode: "after" },
  { key: "lender", label: "Lender", kind: "text", find: ["application to Lender within "], mode: "after" },
];

/** Format a deal-fact value for stamping onto a form. */
export function formatFieldValue(kind: FieldKind, raw: unknown): string {
  if (raw === null || raw === undefined || raw === "") return "";
  // No leading "$" — these blanks already print a "$" before them.
  if (kind === "money") return Number(raw).toLocaleString();
  if (kind === "pct") return `${(Number(raw) * 100).toFixed(2)}%`;
  if (kind === "date") {
    const s = String(raw);
    const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T12:00:00` : s);
    return Number.isNaN(d.getTime())
      ? s
      : d.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" });
  }
  return String(raw);
}
