/**
 * EmailMergeService
 *
 * Resolves {{variable}} tokens in a subject/body string against a
 * transaction's actual data. Missing variables render as empty string
 * (never leave a half-merged "{{closing_date}}" in a client's inbox).
 *
 * Supported variables — keep this list tight and documented. Anything
 * outside this set is a typo.
 *
 *   Property
 *     {{property_address}}     e.g. "509 Bent Avenue"
 *     {{property_city}}
 *     {{property_state}}
 *     {{property_zip}}
 *     {{property_full}}        "509 Bent Avenue, Cheyenne, WY 82007"
 *
 *   Dates (long form by default: "April 30, 2026")
 *     {{effective_date}}
 *     {{closing_date}}
 *     {{possession_date}}
 *     {{inspection_deadline}}
 *     {{inspection_objection_deadline}}
 *     {{title_commitment_deadline}}
 *     {{title_objection_deadline}}
 *     {{financing_deadline}}
 *     {{walkthrough_date}}
 *     {{earnest_money_due_date}}
 *
 *   People
 *     {{buyer_name}}           primary if side=buy, else first co_buyer
 *     {{buyer_first_name}}
 *     {{buyer_email}}
 *     {{seller_name}}
 *     {{seller_first_name}}
 *     {{seller_email}}
 *     {{client_name}}          primary-contact full name (whichever side we rep)
 *     {{client_first_name}}
 *     {{client_email}}
 *     {{agent_name}}           from brokerage settings or acting user
 *     {{agent_email}}
 *     {{brokerage_name}}
 *     {{title_company}}
 *     {{lender_name}}
 *
 *   Money (formatted with $ + commas, no decimals unless sub-dollar)
 *     {{sale_price}}
 *     {{earnest_money_amount}}
 *     {{gross_commission}}
 *     {{commission_percent}}
 *
 *   Misc
 *     {{today}}                today's date, long form
 */

import type {
  Transaction,
  Contact,
  TransactionFinancials,
  TransactionParticipant,
} from "@prisma/client";

export interface MergeInput {
  txn: Transaction;
  contact: Contact;
  financials: TransactionFinancials | null;
  participants: Array<TransactionParticipant & { contact: Contact }>;
  /** Agent/brokerage overrides (from Account.settingsJson.broker) */
  brokerageName?: string;
  agentName?: string;
  agentEmail?: string;
}

export interface MergeResult {
  /** The fully rendered subject. */
  subject: string;
  /** The fully rendered body. */
  body: string;
  /** Variables that were in the template but had no value to merge
   * (rendered empty). Surface in the UI so the user knows what's
   * missing before they send. */
  unresolved: string[];
  /** Variables that resolved to a non-empty value. Useful for
   * preview diff / QA. */
  resolved: string[];
}

function fmtDate(d: Date | null | undefined): string {
  if (!d) return "";
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}
function fmtMoney(n: number | null | undefined): string {
  if (n == null) return "";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: n < 1 ? 2 : 0,
  }).format(n);
}
function firstName(full: string | null | undefined): string {
  if (!full) return "";
  return full.trim().split(/\s+/)[0] ?? "";
}

/**
 * Build the variable map for a transaction. Any variable with no
 * data gets an empty string — tokens referencing it render blank.
 */
export function buildVariables(input: MergeInput): Record<string, string> {
  const { txn, contact, financials, participants } = input;

  // Buyer / seller resolution by role
  const coBuyers = participants.filter((p) => p.role === "co_buyer");
  const coSellers = participants.filter((p) => p.role === "co_seller");

  const isPrimaryBuyer = txn.side === "buy" || txn.side === "both";
  const isPrimarySeller = txn.side === "sell" || txn.side === "both";

  const buyerContact = isPrimaryBuyer ? contact : (coBuyers[0]?.contact ?? null);
  const sellerContact = isPrimarySeller ? contact : (coSellers[0]?.contact ?? null);

  const vars: Record<string, string> = {
    // Property
    property_address: txn.propertyAddress ?? "",
    property_city: txn.city ?? "",
    property_state: txn.state ?? "",
    property_zip: txn.zip ?? "",
    property_full: [
      txn.propertyAddress,
      [txn.city, txn.state, txn.zip].filter(Boolean).join(" "),
    ]
      .filter(Boolean)
      .join(", "),

    // Dates
    effective_date: fmtDate(txn.contractDate),
    closing_date: fmtDate(txn.closingDate),
    possession_date: fmtDate(txn.possessionDate),
    inspection_deadline: fmtDate(txn.inspectionDate),
    inspection_objection_deadline: fmtDate(txn.inspectionObjectionDate),
    title_commitment_deadline: fmtDate(txn.titleDeadline),
    title_objection_deadline: fmtDate(txn.titleObjectionDate),
    financing_deadline: fmtDate(txn.financingDeadline),
    walkthrough_date: fmtDate(txn.walkthroughDate),
    earnest_money_due_date: fmtDate(txn.earnestMoneyDueDate),
    today: fmtDate(new Date()),

    // Buyer
    buyer_name: buyerContact?.fullName ?? "",
    buyer_first_name: firstName(buyerContact?.fullName),
    buyer_email: buyerContact?.primaryEmail ?? "",

    // Seller
    seller_name: sellerContact?.fullName ?? "",
    seller_first_name: firstName(sellerContact?.fullName),
    seller_email: sellerContact?.primaryEmail ?? "",

    // Whichever side we represent = "client"
    client_name: contact.fullName,
    client_first_name: firstName(contact.fullName),
    client_email: contact.primaryEmail ?? "",

    // Brokerage / agent
    brokerage_name: input.brokerageName ?? "",
    agent_name: input.agentName ?? "",
    agent_email: input.agentEmail ?? "",

    // Money
    sale_price: fmtMoney(financials?.salePrice ?? null),
    earnest_money_amount: fmtMoney(null), // from extraction if available later
    gross_commission: fmtMoney(financials?.grossCommission ?? null),
    commission_percent:
      financials?.commissionPercent != null
        ? `${financials.commissionPercent}%`
        : "",

    // Services
    title_company: txn.titleCompanyName ?? "",
    lender_name: txn.lenderName ?? "",
    lender_first_name: firstName(txn.lenderName),

    // Effective date / contract date — alias used by some templates
    contract_date: fmtDate(txn.contractDate),

    // Utility Connect — public enrollment URL when the transaction
    // has been auto-enrolled. Otherwise renders empty so the
    // template gracefully degrades.
    utility_connect_url: txn.utilityConnectReferenceCode
      ? `https://utilityconnect.net/start/${encodeURIComponent(txn.utilityConnectReferenceCode)}`
      : "",
  };

  return vars;
}

/**
 * Render a template against a merge input. Returns the merged
 * subject + body plus lists of resolved/unresolved variables.
 */
export function renderTemplate(
  template: { subject: string; body: string },
  input: MergeInput,
): MergeResult {
  const vars = buildVariables(input);
  const resolved = new Set<string>();
  const unresolved = new Set<string>();

  const replace = (str: string): string =>
    str.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_, key: string) => {
      const k = key.toLowerCase();
      const v = vars[k];
      if (v !== undefined && v !== "") {
        resolved.add(k);
        return v;
      }
      unresolved.add(k);
      return "";
    });

  return {
    subject: replace(template.subject),
    body: replace(template.body),
    resolved: [...resolved],
    unresolved: [...unresolved],
  };
}

/**
 * Starter templates seeded on first login. Jp + Vicki get these
 * out of the box; they can edit or add new ones from /settings/templates.
 */
export const STARTER_TEMPLATES: Array<{
  name: string;
  category: string;
  subject: string;
  body: string;
  defaultTo: string[];
  sortOrder: number;
}> = [
  {
    name: "Welcome — new client under contract",
    category: "welcome",
    sortOrder: 10,
    subject: "Welcome — {{property_address}} is under contract!",
    body: `Hi {{client_first_name}},

Congratulations — we're officially under contract on {{property_address}}! Here's what to expect over the next 30 days:

- Inspection by: {{inspection_deadline}}
- Title commitment expected: {{title_commitment_deadline}}
- Financing deadline: {{financing_deadline}}
- Closing: {{closing_date}}

I'll handle coordination with the title company, lender, and the other side. Save my number in your phone so you can reach me fast.

Talk soon,
{{agent_name}}
{{brokerage_name}}`,
    defaultTo: ["primary_contact"],
  },
  {
    name: "Inspection scheduled — expectations",
    category: "inspection",
    sortOrder: 20,
    subject: "Inspection expectations — {{property_address}}",
    body: `Hi {{client_first_name}},

The inspection is lined up. A few things to keep in mind:

- The inspector will spend 2-4 hours on site. You're welcome to attend the last 30 min to walk through findings.
- The report will include minor cosmetic items in addition to anything material. That's normal.
- After the report, we have until {{inspection_objection_deadline}} to deliver written objections to the seller.

I'll send the full report the moment it lands. Let me know if you have questions before then.

{{agent_name}}`,
    defaultTo: ["primary_contact"],
  },
  {
    name: "Send executed contract to title",
    category: "title",
    sortOrder: 30,
    subject: "Executed contract — {{property_address}}",
    body: `Hi {{title_company}},

Please find the executed purchase contract for {{property_address}}.

- Closing: {{closing_date}}
- Buyer(s): {{buyer_name}}
- Seller(s): {{seller_name}}

Please confirm escrow is open and let me know what else you need.

Thanks,
{{agent_name}}
{{brokerage_name}}`,
    defaultTo: ["title"],
  },
  {
    name: "Clear to close — logistics to client",
    category: "clear_to_close",
    sortOrder: 40,
    subject: "Clear to close — closing logistics for {{property_address}}",
    body: `Hi {{client_first_name}},

We are clear to close. Here's what to expect on closing day:

- Date: {{closing_date}}
- Location: {{title_company}}
- Bring: government-issued photo ID + your phone (for wire confirmation).
- Wire funds BEFORE closing — I will only send wire instructions to you after verifying them directly with {{title_company}} by phone. If you receive wire instructions from ANY other source, do not act on them and call me immediately.
- Final walkthrough: {{walkthrough_date}}

Let me know if anything is unclear. Excited for you!

{{agent_name}}`,
    defaultTo: ["primary_contact"],
  },
  {
    name: "Request lending estimate from lender",
    category: "title",
    sortOrder: 35,
    subject: "Updated lender estimate needed — {{property_address}}",
    body: `Hi {{lender_first_name}},

To keep our transaction file compliant and complete, we need an updated lender estimate / loan estimate for the file on the following transaction:

Borrower: {{buyer_name}}
Property Address: {{property_address}}
Contract Date: {{contract_date}}

Please send over the most current lender estimate / loan estimate at your earliest convenience so we can update our records accordingly.

Let me know if you need anything further from our side.

Thank you,

{{agent_name}}
{{brokerage_name}}`,
    defaultTo: ["lender"],
  },
  {
    name: "Post-close — review request",
    category: "post_close",
    sortOrder: 50,
    subject: "Congratulations again on {{property_address}}!",
    body: `Hi {{client_first_name}},

Hope you're settling in. Working with you was a pleasure — honestly.

If you have a quick minute, would you mind leaving a review on Google or Zillow? Most of my business comes from referrals, and a short note from you makes a real difference for the next family I get to help.

Google: https://g.page/r/EXAMPLE
Zillow: https://www.zillow.com/profile/EXAMPLE

And if anyone you know is thinking about buying or selling — keep me in mind. I'd love to help them the same way.

Thanks again,
{{agent_name}}`,
    defaultTo: ["primary_contact"],
  },
];
