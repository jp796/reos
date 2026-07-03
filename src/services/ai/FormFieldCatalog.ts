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
  /** Text labels to search for on the form to seed an auto-placement. */
  anchors: string[];
}

// Keys align with the deal-facts object the fill route builds.
export const FIELD_CATALOG: CatalogField[] = [
  { key: "propertyAddress", label: "Property address", kind: "text", anchors: ["commonly known as", "Property address", "situated in the"] },
  { key: "buyerNames", label: "Buyer(s)", kind: "text", anchors: ["from", "(“Buyer”)", "Buyer:"] },
  { key: "sellerNames", label: "Seller(s)", kind: "text", anchors: ["(“Seller”)", "to", "Seller:"] },
  { key: "purchasePrice", label: "Purchase price", kind: "money", anchors: ["purchase price", "Dollars payable", "price of"] },
  { key: "earnestMoney", label: "Earnest money", kind: "money", anchors: ["Buyer delivers $", "earnest money deposit", "Earnest Money"] },
  { key: "effectiveDate", label: "Effective date", kind: "date", anchors: ["OFFER TO PURCHASE dated", "dated", "Effective Date"] },
  { key: "closingDate", label: "Closing date", kind: "date", anchors: ["Closing shall occur on", "Closing Date", "Closing"] },
  { key: "possessionDate", label: "Possession date", kind: "date", anchors: ["Possession shall be delivered", "Possession"] },
  { key: "inspectionDeadline", label: "Inspection deadline", kind: "date", anchors: ["Inspection", "inspect"] },
  { key: "inspectionObjectionDeadline", label: "Inspection objection", kind: "date", anchors: ["Objection Deadline", "Inspection Objection"] },
  { key: "titleCommitmentDeadline", label: "Title commitment", kind: "date", anchors: ["title commitment", "title insurance commitment"] },
  { key: "titleObjectionDeadline", label: "Title objection", kind: "date", anchors: ["Title Objection", "object to title"] },
  { key: "financingDeadline", label: "Financing deadline", kind: "date", anchors: ["Financing", "loan"] },
  { key: "walkthroughDate", label: "Final walkthrough", kind: "date", anchors: ["Walkthrough", "walk-through"] },
  { key: "earnestMoneyDueDate", label: "Earnest money due", kind: "date", anchors: ["Business Days after", "delivered"] },
  { key: "titleCompany", label: "Title company", kind: "text", anchors: ["Closing Agent", "title company", "Funds Holder"] },
  { key: "lender", label: "Lender", kind: "text", anchors: ["Lender", "lender"] },
];

/** Format a deal-fact value for stamping onto a form. */
export function formatFieldValue(kind: FieldKind, raw: unknown): string {
  if (raw === null || raw === undefined || raw === "") return "";
  if (kind === "money") return `$${Number(raw).toLocaleString()}`;
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
