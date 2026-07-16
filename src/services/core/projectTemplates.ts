/**
 * projectTemplates — the PROJECT-phase timelines per investor strategy
 * (spec §6, refined by JP's Stage-3 decisions). A project is the work that
 * happens between the acquisition transaction (closed) and the disposition
 * transaction (relist/sell or lease-up).
 *
 * Pure data, no DB — ProjectEngine maps these onto a Project + Task rows,
 * anchoring each task's due date to the project start (the acquisition
 * closing date) and BOUNDING it to the holding window (spec decision 3).
 *
 * Durations (JP/Sheri, verbatim):
 *   WHOLETAIL — 2 weeks work + 1 week make-ready         (21 days)
 *   FLIP      — 60 days reno   + 1 week make-ready        (67 days)
 *   RENTAL    — 2 weeks work   + 30 days lease-up         (44 days)
 *
 * The terminal "List it" task is NOT in the template — it is auto-generated
 * by the engine only after every other project task is complete; completing
 * it advances the deal to the disposition transaction (decision 1).
 */

import type { Strategy } from "./DealClassifierService";
import type { OwnerRole } from "./strategyTemplates";

export interface ProjectTaskTemplate {
  /** Stable key within the phase — dedupes re-instantiation. */
  key: string;
  name: string;
  ownerRole: OwnerRole;
  /** Days after project start when this task is due (bounded to the window). */
  dueOffsetDays: number;
}

export interface ProjectPhaseTemplate {
  key: string;
  name: string;
  startOffsetDays: number;
  durationDays: number;
  tasks: ProjectTaskTemplate[];
}

export interface ProjectTemplate {
  /** Registry key, e.g. "flip_rehab". */
  key: string;
  strategy: Strategy;
  /** Value written to Project.type. */
  projectType: string;
  totalDays: number;
  /** How the completed project puts the asset back on market. */
  returnsToMarketAs: "sale" | "lease";
  /** Label of the auto-generated terminal task. */
  listItTaskName: string;
  phases: ProjectPhaseTemplate[];
}

const WHOLETAIL_MAKEREADY: ProjectTemplate = {
  key: "wholetail_make_ready",
  strategy: "wholetail",
  projectType: "make_ready",
  totalDays: 21,
  returnsToMarketAs: "sale",
  listItTaskName: "List it — start disposition (relist / sell)",
  phases: [
    {
      key: "makeready_work",
      name: "Make-Ready Work",
      startOffsetDays: 0,
      durationDays: 14,
      tasks: [
        { key: "clean_out", name: "Clean-out & haul-off", ownerRole: "contractor", dueOffsetDays: 3 },
        { key: "minor_repairs", name: "Minor repairs / cosmetic touch-ups", ownerRole: "contractor", dueOffsetDays: 10 },
        { key: "deep_clean", name: "Deep clean", ownerRole: "contractor", dueOffsetDays: 13 },
      ],
    },
    {
      key: "prep_to_list",
      name: "Prep to List",
      startOffsetDays: 14,
      durationDays: 7,
      tasks: [
        { key: "photos", name: "Professional photos", ownerRole: "agent", dueOffsetDays: 17 },
        { key: "pricing", name: "Set list price / net sheet", ownerRole: "agent", dueOffsetDays: 19 },
        { key: "listing_prep", name: "Prep MLS listing details", ownerRole: "agent", dueOffsetDays: 20 },
      ],
    },
  ],
};

const FLIP_REHAB: ProjectTemplate = {
  key: "flip_rehab",
  strategy: "flip",
  projectType: "rehab",
  totalDays: 67,
  returnsToMarketAs: "sale",
  listItTaskName: "List it — start disposition (relist / sell)",
  phases: [
    {
      key: "renovation",
      name: "Renovation",
      startOffsetDays: 0,
      durationDays: 60,
      tasks: [
        { key: "reno_kickoff", name: "Renovation kickoff — SOW + draw schedule", ownerRole: "contractor", dueOffsetDays: 2 },
        { key: "contractor_lockbox", name: "Contractor lockbox + access set up", ownerRole: "contractor", dueOffsetDays: 3 },
        { key: "draw_cycle", name: "Manage draw cycle (request → verify → lien waiver → release)", ownerRole: "contractor", dueOffsetDays: 30 },
        { key: "weekly_updates", name: "Weekly photos + contractor update", ownerRole: "contractor", dueOffsetDays: 30 },
        { key: "punch_list", name: "Punch-list walkthrough", ownerRole: "contractor", dueOffsetDays: 58 },
      ],
    },
    {
      key: "make_ready",
      name: "Make-Ready / Prep to List",
      startOffsetDays: 60,
      durationDays: 7,
      tasks: [
        { key: "clean_stage", name: "Professional clean + soft staging", ownerRole: "contractor", dueOffsetDays: 62 },
        { key: "photos", name: "Professional photos", ownerRole: "agent", dueOffsetDays: 64 },
        { key: "pricing", name: "Set list price / net sheet", ownerRole: "agent", dueOffsetDays: 66 },
      ],
    },
  ],
};

const RENTAL_RENT_READY: ProjectTemplate = {
  key: "rental_rent_ready",
  strategy: "rental_brrrr",
  projectType: "renovation_rent_ready",
  // 2 weeks work + 30 days lease-up + a cash-out refinance STEP inside the
  // project (FLAG 3 — the refi is not a separate transaction; nothing sells).
  // Refi window = 14 days (default; JP can tune). 14 + 30 + 14 = 58.
  totalDays: 58,
  returnsToMarketAs: "lease",
  listItTaskName: "Rent-ready & refinanced — move to Under Management (hold)",
  phases: [
    {
      key: "rent_ready_work",
      name: "Rent-Ready Work",
      startOffsetDays: 0,
      durationDays: 14,
      tasks: [
        { key: "reno_kickoff", name: "Rehab kickoff — SOW + draw schedule", ownerRole: "contractor", dueOffsetDays: 2 },
        { key: "make_ready", name: "Make-ready to rent-ready spec", ownerRole: "contractor", dueOffsetDays: 10 },
        { key: "punch_list", name: "Punch-list", ownerRole: "contractor", dueOffsetDays: 13 },
      ],
    },
    {
      key: "lease_up",
      name: "Lease-Up",
      startOffsetDays: 14,
      durationDays: 30,
      tasks: [
        { key: "insurance_switch", name: "Switch to landlord / dwelling insurance", ownerRole: "client", dueOffsetDays: 15 },
        { key: "set_rent", name: "Set rent + create listing", ownerRole: "agent", dueOffsetDays: 16 },
        { key: "market_show", name: "Market + schedule showings", ownerRole: "agent", dueOffsetDays: 22 },
        { key: "screen_tenant", name: "Tenant screening (app, credit, income, references)", ownerRole: "agent", dueOffsetDays: 35 },
        { key: "execute_lease", name: "Execute lease + collect deposit + first month", ownerRole: "agent", dueOffsetDays: 42 },
      ],
    },
    {
      // FLAG 3: BRRRR cash-out refinance — a STEP inside the project, not a
      // separate transaction. Pulls capital back out against the leased,
      // rehabbed asset before it goes to hold.
      key: "cash_out_refinance",
      name: "Cash-Out Refinance",
      startOffsetDays: 44,
      durationDays: 14,
      tasks: [
        { key: "order_appraisal", name: "Order refinance appraisal", ownerRole: "lender", dueOffsetDays: 45 },
        { key: "submit_dscr", name: "Submit DSCR refi application (with lease + rent roll)", ownerRole: "lender", dueOffsetDays: 47 },
        { key: "refi_closing", name: "Refi title / closing", ownerRole: "title", dueOffsetDays: 54 },
        { key: "payoff_acquisition", name: "Pay off acquisition loan + private lender", ownerRole: "agent", dueOffsetDays: 55 },
        { key: "reconcile_capital", name: "Reconcile capital recovered vs invested + notify partners", ownerRole: "agent", dueOffsetDays: 57 },
      ],
    },
  ],
};

const REGISTRY: Partial<Record<Strategy, ProjectTemplate>> = {
  wholetail: WHOLETAIL_MAKEREADY,
  flip: FLIP_REHAB,
  rental_brrrr: RENTAL_RENT_READY,
};

/** The project template for a strategy, or null for strategies with no
 *  project phase (retail, wholesale/double-close, creative). */
export function getProjectTemplate(strategy: Strategy): ProjectTemplate | null {
  return REGISTRY[strategy] ?? null;
}

/** Flattened project tasks with their phase key (for instantiation). */
export function projectTasks(
  tpl: ProjectTemplate,
): Array<ProjectTaskTemplate & { phaseKey: string; phaseName: string }> {
  return tpl.phases.flatMap((p) =>
    p.tasks.map((t) => ({ ...t, phaseKey: p.key, phaseName: p.name })),
  );
}
