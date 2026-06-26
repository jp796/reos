/**
 * Task model for the guided-intake Step 5 (Tasks review).
 *
 * A UI-friendly shape: the tasks Atlas drafts from the executed contract,
 * each with a due date, an optional human-readable relative-date note, an
 * auto-email flag (the task auto-drafts an email when it comes due), and
 * optional natural-language instruction + related compliance item.
 *
 * The fixture below carries the real 1650 North Ridge Dr tasks — referencing
 * the actual parties by name — so the UI is built against something real,
 * not placeholder text. An adapter (built when the real task generator is
 * wired) maps the generated tasks → GuidedTask[]; until then the fixture is
 * the source.
 */

export interface GuidedTask {
  id: string;
  title: string;
  description: string;
  /** ISO date (YYYY-MM-DD) the task is due. */
  dueDate: string;
  /** Human-readable note, e.g. "1 day after Property Disclosure". */
  relativeNote?: string;
  /** When true, the task auto-drafts an email when it comes due. */
  autoEmail: boolean;
  /** Natural-language instruction Atlas should follow for this task. */
  instruction?: string;
  /** Name of the compliance item this task relates to, if any. */
  relatedCompliance?: string;
}

/** Real 1650 North Ridge Dr tasks (drafted from the executed contract). */
export const FIXTURE_TASKS: GuidedTask[] = [
  {
    id: "t1",
    title: "Send Executed Contract to All Parties",
    description:
      "Distribute the fully executed purchase contract to the client (Joe T. Carter Jr, Sue Ann Carter), seller's agent (Rebecca Hess), lender, and title company to formally initiate the transaction.",
    dueDate: "2026-06-16",
    autoEmail: true,
  },
  {
    id: "t2",
    title: "Request Property Disclosure from Seller's Agent",
    description:
      "Since the Buyer has not received the Property Disclosure at the time of the offer, send a formal request to the seller's agent, Rebecca Hess, to provide the Property Disclosure Statement.",
    dueDate: "2026-06-16",
    autoEmail: true,
    relatedCompliance: "Property Disclosure Statement",
  },
  {
    id: "t3",
    title: "Review Property Disclosure with Client",
    description:
      "Review the disclosed defects/conditions with Joe T. Carter Jr and Sue Ann Carter and document their acknowledgment.",
    dueDate: "2026-06-17",
    relativeNote: "1 day after Property Disclosure",
    autoEmail: false,
  },
  {
    id: "t4",
    title: "Remind Client to Provide Pre-qualification Letter",
    description:
      "Remind Joe T. Carter Jr and Sue Ann Carter to provide the pre-qualification letter to their lender and agent James Fluellen by June 18, 2026.",
    dueDate: "2026-06-18",
    autoEmail: false,
  },
  {
    id: "t5",
    title: "Confirm Earnest Money Deposit",
    description:
      "Confirm the earnest money deposit has been received and recorded by the title company, and notify Joe T. Carter Jr and Sue Ann Carter once it clears.",
    dueDate: "2026-06-22",
    autoEmail: false,
  },
  {
    id: "t6",
    title: "Remind Client to Complete Loan Application",
    description:
      "Remind Joe T. Carter Jr and Sue Ann Carter to complete their loan application with the lender to keep the conventional financing contingency on track.",
    dueDate: "2026-06-22",
    autoEmail: false,
  },
];
