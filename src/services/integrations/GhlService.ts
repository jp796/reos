/**
 * GhlService — GoHighLevel (LeadConnector) API v2 client for pulling
 * motivated-seller contact info onto investment deals.
 *
 * Auth: a per-account Private Integration token (bearer) + location id,
 * stored encrypted on the Account (like the Follow Up Boss key). Read-only
 * here — we search the seller lead and read their contact + custom fields.
 */

const BASE = "https://services.leadconnectorhq.com";
const VERSION = "2021-07-28";

/** Custom-field IDs from this GHL location (see get_custom_fields). */
const CF = {
  propertyAddress: "eWIAG9dDoFymEao3OEav",
  propertyUniqueId: "dtnQ8bIA0pwVDvpUHRwn", // full street + zip
  phone2: "SxkUAlf8uFNzLAu5o4jz",
  phone3: "QOIgVl4WyzA32aqLYUlW",
  phone4: "tDWYYX5cyBsWBpsxxvsh",
  phone5: "l6y4zFGiVy1odjPTgmTU",
  email2: "jQZVfE2PML108T4P299B",
  email3: "Iy1vXH5dimSyBDWre73a",
  motivationSignal: "5DJ7iDFUUC96xRFKNkuY",
  reasonForSelling: "RjkGU2qQSH9behUDxaBN",
  occupiedBy: "5NrApFoZMHp4eZYzluvb",
  propertyCondition: "mGuZJZ4XAsF4ywDWfTQD",
  timelineToSell: "QgYmEakceg0KSrpaRLaw",
  leadTier: "grSyrOuTXjJ04yxJ6woD",
} as const;

interface GhlCustomField {
  id: string;
  value?: unknown;
}
interface GhlContact {
  id: string;
  contactName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  customFields?: GhlCustomField[];
}

/** The normalized seller intel we persist onto a REOS deal. */
export interface SellerIntel {
  ghlContactId: string;
  name: string | null;
  phones: string[];
  emails: string[];
  propertyAddress: string | null;
  motivationSignal: string | null;
  reasonForSelling: string | null;
  occupiedBy: string | null;
  propertyCondition: string | null;
  timelineToSell: string | null;
  leadTier: string | null;
  pulledAt: string;
  /** true = the GHL contact's property matched THIS deal (confident); false =
   *  matched by seller name only, property differs → the UI flags it to verify. */
  matchedProperty: boolean;
}

export class GhlService {
  constructor(
    private readonly token: string,
    private readonly locationId: string,
  ) {}

  static isConfigured(token?: string | null, locationId?: string | null): boolean {
    return !!token && !!locationId;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      Version: VERSION,
      Accept: "application/json",
    };
  }

  /** Full-text contact search (name / email / phone). */
  async searchContacts(query: string): Promise<GhlContact[]> {
    const url = `${BASE}/contacts/?locationId=${encodeURIComponent(this.locationId)}&query=${encodeURIComponent(query)}&limit=20`;
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) {
      throw new Error(`GHL search failed (${res.status})`);
    }
    const data = (await res.json()) as { contacts?: GhlContact[] };
    return data.contacts ?? [];
  }

  /**
   * Find the seller lead for a deal and return their intel. Strategy: search
   * by the seller's NAME, then prefer the candidate whose property custom
   * field matches the deal's address; else the sole/first result.
   */
  async pullSeller(input: {
    sellerName?: string | null;
    propertyAddress?: string | null;
  }): Promise<SellerIntel | null> {
    const queries = [input.sellerName, input.propertyAddress].filter(
      (q): q is string => !!q && q.trim().length > 1,
    );
    const seen = new Map<string, GhlContact>();
    for (const q of queries) {
      try {
        for (const c of await this.searchContacts(q)) seen.set(c.id, c);
      } catch {
        /* try the next query */
      }
    }
    const candidates = [...seen.values()];
    if (candidates.length === 0) return null;

    const propMatch = this.propertyMatch(candidates, input.propertyAddress ?? null);
    if (propMatch) return mapSellerIntel(propMatch, true);

    // No property confirmation. Attaching among MULTIPLE same-name leads would
    // guess wrong, so skip. A single candidate is the only person by that name
    // — attach, but flag it name-only so the UI tells the user to verify.
    if (candidates.length === 1) return mapSellerIntel(candidates[0]!, false);
    return null;
  }

  /** A candidate whose property custom field matches the deal address, if any. */
  private propertyMatch(candidates: GhlContact[], address: string | null): GhlContact | null {
    if (!address) return null;
    const key = normAddr(address);
    if (!key) return null;
    return (
      candidates.find((c) => {
        const cfAddr = normAddr(cfVal(c, CF.propertyAddress) ?? "");
        const cfUid = normAddr(cfVal(c, CF.propertyUniqueId) ?? "");
        return (
          (cfAddr && (cfAddr.includes(key) || key.includes(cfAddr))) ||
          (cfUid && (cfUid.includes(key) || key.includes(cfUid)))
        );
      }) ?? null
    );
  }
}

function normAddr(s: string): string {
  return s
    .toLowerCase()
    .replace(/[.,#]/g, " ")
    .replace(/\b(street|st|road|rd|drive|dr|avenue|ave|lane|ln|court|ct|way|blvd|boulevard)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cfVal(c: GhlContact, id: string): string | null {
  const f = c.customFields?.find((x) => x.id === id);
  const v = f?.value;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export function mapSellerIntel(c: GhlContact, matchedProperty = false): SellerIntel {
  const phones = uniq([
    c.phone ?? null,
    cfVal(c, CF.phone2),
    cfVal(c, CF.phone3),
    cfVal(c, CF.phone4),
    cfVal(c, CF.phone5),
  ]);
  const emails = uniq([c.email ?? null, cfVal(c, CF.email2), cfVal(c, CF.email3)]);
  const name =
    c.contactName?.trim() ||
    [c.firstName, c.lastName].filter(Boolean).join(" ").trim() ||
    null;
  return {
    ghlContactId: c.id,
    name,
    phones,
    emails,
    propertyAddress: cfVal(c, CF.propertyAddress),
    motivationSignal: cfVal(c, CF.motivationSignal),
    reasonForSelling: cfVal(c, CF.reasonForSelling),
    occupiedBy: cfVal(c, CF.occupiedBy),
    propertyCondition: cfVal(c, CF.propertyCondition),
    timelineToSell: cfVal(c, CF.timelineToSell),
    leadTier: cfVal(c, CF.leadTier),
    matchedProperty,
    // pulledAt stamped by the caller (Date is injected there to stay testable).
    pulledAt: "",
  };
}

function uniq(vals: Array<string | null>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of vals) {
    const t = v?.trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}
