/**
 * Demo fixture — purely in-memory mock data for the public /demo
 * sandbox. Shapes loosely match the Prisma models (Transaction +
 * relations) so the demo pages can render with the same visual
 * language as the real authed app, without ever touching the DB.
 *
 * SCRAPER GUARDRAILS — every value here is fabricated. Names, phone
 * numbers, emails, and addresses are illustrative only. Nothing in
 * this file maps to a real customer, agent, or property; therefore
 * enumerating /demo/transactions/<id> exposes zero PII or business
 * data. We still gate /demo with a banner + CTAs so the surface
 * stays clearly marketing-flavored, not user-data-flavored.
 *
 * Dates are computed at module load relative to `new Date()` so
 * the demo always feels current — never hardcoded calendar years.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function offsetDays(days: number): Date {
  return new Date(Date.now() + days * DAY_MS);
}

export interface DemoMilestone {
  id: string;
  type: string;
  label: string;
  dueAt: Date | null;
  completedAt: Date | null;
  status: "pending" | "completed";
  ownerRole: "agent" | "lender" | "title" | "inspector" | "client";
}

export interface DemoTask {
  id: string;
  title: string;
  description?: string;
  dueAt: Date | null;
  completedAt: Date | null;
  assignedTo?: string;
}

export interface DemoNote {
  id: string;
  authorName: string;
  body: string;
  createdAt: Date;
}

export interface DemoInspection {
  id: string;
  kind: "general" | "pest" | "radon" | "sewer" | "chimney" | "other";
  label: string;
  scheduledAt: Date | null;
  vendorName: string | null;
  vendorNote: string | null;
  completedAt: Date | null;
}

export interface DemoDocument {
  id: string;
  name: string;
  category: string;
  uploadedAt: Date;
}

export interface DemoContact {
  id: string;
  fullName: string;
  primaryEmail: string | null;
  primaryPhone: string | null;
  sourceName: string | null;
}

export interface DemoTransaction {
  id: string;
  contact: DemoContact;
  propertyAddress: string;
  city: string;
  state: string;
  zip: string;
  transactionType: "buyer" | "seller";
  side: "buy" | "sell" | "both";
  status: "active" | "pending" | "closed";
  contractStage: "offer" | "counter" | "executed" | null;
  contractDate: Date | null;
  closingDate: Date | null;
  listPrice: number | null;
  earnestMoneyDueDate: Date | null;
  inspectionDate: Date | null;
  appraisalDate: Date | null;
  financingDeadline: Date | null;
  titleDeadline: Date | null;
  lenderName: string | null;
  titleCompanyName: string | null;
  aiSummary: string | null;
  aiSummaryUpdatedAt: Date | null;
  assignedAgentName: string | null;
  milestones: DemoMilestone[];
  tasks: DemoTask[];
  notes: DemoNote[];
  inspections: DemoInspection[];
  documents: DemoDocument[];
  updatedAt: Date;
}

// ─────────────────────────────────────────────────────────────────
// Hero deal — the one we drive prospects toward. Mid-flight
// transaction with a populated AI summary, mixed milestone states,
// inspections + notes + tasks. Springfield MO.
// ─────────────────────────────────────────────────────────────────
const HERO: DemoTransaction = {
  id: "demo-txn-hero-springfield",
  contact: {
    id: "demo-contact-1",
    fullName: "Megan & Tyler Brooks",
    primaryEmail: "megan.brooks@example.com",
    primaryPhone: "(417) 555-0142",
    sourceName: "Zillow inbound",
  },
  propertyAddress: "1428 S Glenstone Ave",
  city: "Springfield",
  state: "MO",
  zip: "65804",
  transactionType: "buyer",
  side: "buy",
  status: "active",
  contractStage: "executed",
  contractDate: offsetDays(-9),
  closingDate: offsetDays(21),
  listPrice: 389_000,
  earnestMoneyDueDate: offsetDays(-7),
  inspectionDate: offsetDays(-3),
  appraisalDate: offsetDays(7),
  financingDeadline: offsetDays(14),
  titleDeadline: offsetDays(10),
  lenderName: "Flat Branch Home Loans",
  titleCompanyName: "Greene County Title",
  aiSummary:
    "Buyer-side deal under contract on 1428 S Glenstone, Springfield MO. Inspection completed 3 days ago — minor punch list (HVAC servicing + GFCI outlet). Earnest money confirmed received by Greene County Title. Appraisal scheduled in 7 days with Flat Branch. Financing deadline in 2 weeks; lender flagged underwriting income re-verification this week. No blockers, but the title commitment is still outstanding (deadline in 10 days). Recommended next move: nudge title for the commitment + line up the post-inspection objection response by tomorrow EOD.",
  aiSummaryUpdatedAt: offsetDays(-1),
  assignedAgentName: "Jp Fluellen",
  milestones: [
    {
      id: "demo-ms-1",
      type: "contract",
      label: "Contract executed",
      dueAt: offsetDays(-9),
      completedAt: offsetDays(-9),
      status: "completed",
      ownerRole: "agent",
    },
    {
      id: "demo-ms-2",
      type: "earnest",
      label: "Earnest money received",
      dueAt: offsetDays(-7),
      completedAt: offsetDays(-7),
      status: "completed",
      ownerRole: "title",
    },
    {
      id: "demo-ms-3",
      type: "inspection",
      label: "General inspection",
      dueAt: offsetDays(-3),
      completedAt: offsetDays(-3),
      status: "completed",
      ownerRole: "inspector",
    },
    {
      id: "demo-ms-4",
      type: "inspection-objection",
      label: "Inspection objection deadline",
      dueAt: offsetDays(-1), // overdue — still pending
      completedAt: null,
      status: "pending",
      ownerRole: "agent",
    },
    {
      id: "demo-ms-5",
      type: "appraisal",
      label: "Appraisal",
      dueAt: offsetDays(7),
      completedAt: null,
      status: "pending",
      ownerRole: "lender",
    },
    {
      id: "demo-ms-6",
      type: "title",
      label: "Title commitment",
      dueAt: offsetDays(10),
      completedAt: null,
      status: "pending",
      ownerRole: "title",
    },
    {
      id: "demo-ms-7",
      type: "financing",
      label: "Financing deadline",
      dueAt: offsetDays(14),
      completedAt: null,
      status: "pending",
      ownerRole: "lender",
    },
    {
      id: "demo-ms-8",
      type: "closing",
      label: "Closing",
      dueAt: offsetDays(21),
      completedAt: null,
      status: "pending",
      ownerRole: "title",
    },
  ],
  tasks: [
    {
      id: "demo-task-1",
      title: "Send inspection objection response to seller's agent",
      description:
        "Buyer wants HVAC service receipt + GFCI outlet repair. No price reduction.",
      dueAt: offsetDays(0),
      completedAt: null,
      assignedTo: "Jp",
    },
    {
      id: "demo-task-2",
      title: "Nudge Greene County Title for commitment",
      description: "Email Sarah at Greene County — commitment due in 10 days.",
      dueAt: offsetDays(2),
      completedAt: null,
      assignedTo: "Jp",
    },
    {
      id: "demo-task-3",
      title: "Confirm appraisal time with Flat Branch",
      dueAt: offsetDays(5),
      completedAt: null,
      assignedTo: "Jp",
    },
    {
      id: "demo-task-4",
      title: "Order home warranty quote",
      dueAt: offsetDays(-4),
      completedAt: offsetDays(-4),
      assignedTo: "Jp",
    },
  ],
  notes: [
    {
      id: "demo-note-1",
      authorName: "Jp Fluellen",
      body: "Sellers are motivated — relocation, hard close-by date. They're flexible on the inspection items if we move quickly. Recommend resolving objection by EOD tomorrow.",
      createdAt: offsetDays(-2),
    },
    {
      id: "demo-note-2",
      authorName: "Jp Fluellen",
      body: "Megan asked about the home warranty options. Forwarded the AHS + 2-10 quotes. She's leaning toward 2-10 ($639/yr).",
      createdAt: offsetDays(-1),
    },
  ],
  inspections: [
    {
      id: "demo-insp-1",
      kind: "general",
      label: "General home inspection",
      scheduledAt: offsetDays(-3),
      vendorName: "Pillar To Post — Springfield",
      vendorNote: "(417) 555-0188 · Inspector: Mike Albers",
      completedAt: offsetDays(-3),
    },
    {
      id: "demo-insp-2",
      kind: "radon",
      label: "Radon test (48 hr)",
      scheduledAt: offsetDays(-3),
      vendorName: "Ozarks Radon Pros",
      vendorNote: "Test placed during general inspection — pickup +2 days",
      completedAt: offsetDays(-1),
    },
  ],
  documents: [
    {
      id: "demo-doc-1",
      name: "Executed Purchase Agreement.pdf",
      category: "Contract",
      uploadedAt: offsetDays(-9),
    },
    {
      id: "demo-doc-2",
      name: "Earnest Money Receipt - Greene County Title.pdf",
      category: "Earnest Money",
      uploadedAt: offsetDays(-7),
    },
    {
      id: "demo-doc-3",
      name: "Pillar To Post Inspection Report.pdf",
      category: "Inspection",
      uploadedAt: offsetDays(-3),
    },
  ],
  updatedAt: offsetDays(0),
};

// ─────────────────────────────────────────────────────────────────
// Supporting deals for the list view — varied stages, sides, cities.
// Light data — no need for full timelines on these.
// ─────────────────────────────────────────────────────────────────
const SUPPORTING: DemoTransaction[] = [
  {
    id: "demo-txn-cheyenne-listing",
    contact: {
      id: "demo-contact-2",
      fullName: "Robert & Jeanette Holloway",
      primaryEmail: "rholloway@example.com",
      primaryPhone: "(307) 555-0211",
      sourceName: "Repeat client",
    },
    propertyAddress: "3217 Carey Ave",
    city: "Cheyenne",
    state: "WY",
    zip: "82001",
    transactionType: "seller",
    side: "sell",
    status: "active",
    contractStage: null,
    contractDate: null,
    closingDate: null,
    listPrice: 524_900,
    earnestMoneyDueDate: null,
    inspectionDate: null,
    appraisalDate: null,
    financingDeadline: null,
    titleDeadline: null,
    lenderName: null,
    titleCompanyName: null,
    aiSummary: null,
    aiSummaryUpdatedAt: null,
    assignedAgentName: "Jp Fluellen",
    milestones: [
      {
        id: "demo-ms-c1",
        type: "list",
        label: "Listing live",
        dueAt: offsetDays(-12),
        completedAt: offsetDays(-12),
        status: "completed",
        ownerRole: "agent",
      },
      {
        id: "demo-ms-c2",
        type: "showing-window",
        label: "Open house",
        dueAt: offsetDays(3),
        completedAt: null,
        status: "pending",
        ownerRole: "agent",
      },
    ],
    tasks: [],
    notes: [],
    inspections: [],
    documents: [],
    updatedAt: offsetDays(-1),
  },
  {
    id: "demo-txn-republic-pending",
    contact: {
      id: "demo-contact-3",
      fullName: "Olivia Chen",
      primaryEmail: "olivia.chen@example.com",
      primaryPhone: "(417) 555-0367",
      sourceName: "Sphere referral",
    },
    propertyAddress: "1109 W Hines St",
    city: "Republic",
    state: "MO",
    zip: "65738",
    transactionType: "buyer",
    side: "buy",
    status: "pending",
    contractStage: "executed",
    contractDate: offsetDays(-18),
    closingDate: offsetDays(5),
    listPrice: 274_500,
    earnestMoneyDueDate: offsetDays(-15),
    inspectionDate: offsetDays(-12),
    appraisalDate: offsetDays(-3),
    financingDeadline: offsetDays(2),
    titleDeadline: offsetDays(-1),
    lenderName: "Guild Mortgage",
    titleCompanyName: "Christian County Abstract",
    aiSummary: null,
    aiSummaryUpdatedAt: null,
    assignedAgentName: "Jp Fluellen",
    milestones: [
      {
        id: "demo-ms-r1",
        type: "appraisal",
        label: "Appraisal",
        dueAt: offsetDays(-3),
        completedAt: offsetDays(-3),
        status: "completed",
        ownerRole: "lender",
      },
      {
        id: "demo-ms-r2",
        type: "title",
        label: "Title commitment",
        dueAt: offsetDays(-1),
        completedAt: null,
        status: "pending",
        ownerRole: "title",
      },
      {
        id: "demo-ms-r3",
        type: "financing",
        label: "Clear to close",
        dueAt: offsetDays(2),
        completedAt: null,
        status: "pending",
        ownerRole: "lender",
      },
      {
        id: "demo-ms-r4",
        type: "closing",
        label: "Closing",
        dueAt: offsetDays(5),
        completedAt: null,
        status: "pending",
        ownerRole: "title",
      },
    ],
    tasks: [],
    notes: [],
    inspections: [],
    documents: [],
    updatedAt: offsetDays(-1),
  },
  {
    id: "demo-txn-laramie-dual",
    contact: {
      id: "demo-contact-4",
      fullName: "Daniel Vargas",
      primaryEmail: "dvargas@example.com",
      primaryPhone: "(307) 555-0489",
      sourceName: "Past client referral",
    },
    propertyAddress: "812 Foothills Blvd",
    city: "Cheyenne",
    state: "WY",
    zip: "82009",
    transactionType: "buyer",
    side: "both",
    status: "active",
    contractStage: "counter",
    contractDate: null,
    closingDate: offsetDays(38),
    listPrice: 445_000,
    earnestMoneyDueDate: null,
    inspectionDate: null,
    appraisalDate: null,
    financingDeadline: null,
    titleDeadline: null,
    lenderName: null,
    titleCompanyName: null,
    aiSummary: null,
    aiSummaryUpdatedAt: null,
    assignedAgentName: "Jp Fluellen",
    milestones: [
      {
        id: "demo-ms-l1",
        type: "offer",
        label: "Counter delivered to seller",
        dueAt: offsetDays(-1),
        completedAt: offsetDays(-1),
        status: "completed",
        ownerRole: "agent",
      },
    ],
    tasks: [],
    notes: [],
    inspections: [],
    documents: [],
    updatedAt: offsetDays(0),
  },
  {
    id: "demo-txn-nixa-closed",
    contact: {
      id: "demo-contact-5",
      fullName: "Priya & Anand Mehta",
      primaryEmail: "priya.mehta@example.com",
      primaryPhone: "(417) 555-0598",
      sourceName: "Google PPC",
    },
    propertyAddress: "2204 N Eastgate Ave",
    city: "Nixa",
    state: "MO",
    zip: "65714",
    transactionType: "buyer",
    side: "buy",
    status: "closed",
    contractStage: "executed",
    contractDate: offsetDays(-44),
    closingDate: offsetDays(-2),
    listPrice: 312_000,
    earnestMoneyDueDate: offsetDays(-41),
    inspectionDate: offsetDays(-38),
    appraisalDate: offsetDays(-25),
    financingDeadline: offsetDays(-9),
    titleDeadline: offsetDays(-12),
    lenderName: "USAA",
    titleCompanyName: "Christian County Abstract",
    aiSummary: null,
    aiSummaryUpdatedAt: null,
    assignedAgentName: "Jp Fluellen",
    milestones: [
      {
        id: "demo-ms-n1",
        type: "closing",
        label: "Closing",
        dueAt: offsetDays(-2),
        completedAt: offsetDays(-2),
        status: "completed",
        ownerRole: "title",
      },
    ],
    tasks: [],
    notes: [],
    inspections: [],
    documents: [],
    updatedAt: offsetDays(-2),
  },
];

export const DEMO_TRANSACTIONS: DemoTransaction[] = [HERO, ...SUPPORTING];

export function getDemoTransactionById(id: string): DemoTransaction | null {
  return DEMO_TRANSACTIONS.find((t) => t.id === id) ?? null;
}

export const DEMO_HERO_ID = HERO.id;

// ─────────────────────────────────────────────────────────────────
// Today-page rollups — derived live so the dates always match the
// list view above.
// ─────────────────────────────────────────────────────────────────
export interface TodayRollupItem {
  transactionId: string;
  contactName: string;
  propertyAddress: string;
  label: string;
  dueAt: Date;
}

export function getTodayOverdue(): TodayRollupItem[] {
  const out: TodayRollupItem[] = [];
  for (const txn of DEMO_TRANSACTIONS) {
    if (txn.status === "closed") continue;
    for (const ms of txn.milestones) {
      if (ms.completedAt) continue;
      if (!ms.dueAt) continue;
      if (ms.dueAt > new Date()) continue;
      out.push({
        transactionId: txn.id,
        contactName: txn.contact.fullName,
        propertyAddress: txn.propertyAddress,
        label: ms.label,
        dueAt: ms.dueAt,
      });
    }
  }
  return out
    .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())
    .slice(0, 3);
}

export function getTodayClosingThisWeek(): TodayRollupItem[] {
  const week = offsetDays(7);
  const out: TodayRollupItem[] = [];
  for (const txn of DEMO_TRANSACTIONS) {
    if (!txn.closingDate) continue;
    if (txn.status === "closed") continue;
    if (txn.closingDate > week) continue;
    if (txn.closingDate < new Date()) continue;
    out.push({
      transactionId: txn.id,
      contactName: txn.contact.fullName,
      propertyAddress: txn.propertyAddress,
      label: "Closing",
      dueAt: txn.closingDate,
    });
  }
  return out
    .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())
    .slice(0, 2);
}

export function getTodayNeedsAttention(): TodayRollupItem[] {
  // The hero deal has an outstanding inspection objection — perfect
  // "needs attention" call-out.
  const hero = HERO;
  return [
    {
      transactionId: hero.id,
      contactName: hero.contact.fullName,
      propertyAddress: hero.propertyAddress,
      label: "Inspection objection — response not sent",
      dueAt: hero.milestones.find((m) => m.type === "inspection-objection")
        ?.dueAt ?? offsetDays(-1),
    },
  ];
}
