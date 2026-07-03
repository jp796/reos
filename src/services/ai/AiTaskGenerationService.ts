/**
 * AiTaskGenerationService — generates a transaction-coordinator task
 * list tailored to ONE specific deal, from its extracted terms.
 *
 * Unlike the static TaskTemplates (a fixed checklist), this reads the
 * actual contract facts — side, cash vs financed, the real deadline
 * dates, every contingency, and any custom/unusual provision — and
 * writes a task list that fits THIS deal: one task per real deadline
 * (anchored to its date), one per applicable contingency, standard TC
 * tasks for the side, and a task for anything non-standard the contract
 * contains. A deterministic safety net guarantees the compliance-critical
 * deadline tasks are always present even if the model omits one.
 */

const MODEL = "gpt-4o-mini";

export type TaskOwner =
  | "tc" | "buyer_agent" | "listing_agent" | "client" | "lender" | "title";
export type TaskPriority = "low" | "normal" | "high" | "urgent";

export interface GeneratedTask {
  title: string;
  description: string | null;
  dueDate: string | null; // ISO YYYY-MM-DD
  owner: TaskOwner;
  priority: TaskPriority;
  category: string;
}

export interface TaskGenInput {
  side: "buyer" | "listing" | "both" | "investor" | null;
  strategy?: string | null;
  propertyAddress?: string | null;
  purchasePrice?: number | null;
  financingType?: string | null; // "Cash" | "Conventional" | ...
  hoa?: boolean | null;
  titleCompany?: string | null;
  lender?: string | null;
  buyers?: string[] | null;
  sellers?: string[] | null;
  dates: Record<string, string | null>; // effectiveDate, closingDate, …
  contingencies?: Array<{ name: string; status?: string; description?: string }>;
  /** Recurring task titles from similar past deals (learned templates) —
   *  the model is told to fold these in. See TaskTemplateLearnService. */
  learnedTaskTitles?: string[];
}

/**
 * Build a TaskGenInput from a ContractExtraction (fields are {value}
 * objects). Used by the live stream + create flow so the same engine
 * runs on the fresh extraction and on the persisted deal.
 */
export function buildTaskGenInputFromExtraction(
  ex: Record<string, unknown>,
  opts?: { side?: TaskGenInput["side"]; strategy?: string | null; learnedTaskTitles?: string[] },
): TaskGenInput {
  const fv = (k: string): unknown => {
    const f = ex[k] as { value?: unknown } | undefined;
    return f && typeof f === "object" ? f.value : undefined;
  };
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  const num = (v: unknown) => (typeof v === "number" ? v : null);
  const rawConts = fv("contingencies");
  const contingencies = Array.isArray(rawConts)
    ? rawConts
        .map((c) => {
          const o = (c ?? {}) as Record<string, unknown>;
          return {
            name: String(o.name ?? ""),
            status: o.status ? String(o.status) : undefined,
            description: o.description ? String(o.description) : undefined,
          };
        })
        .filter((c) => c.name)
    : [];
  return {
    side: opts?.side ?? null,
    strategy: opts?.strategy ?? null,
    propertyAddress: str(fv("propertyAddress")),
    purchasePrice: num(fv("purchasePrice")),
    financingType: str(fv("financingType")),
    titleCompany: str(fv("titleCompanyName")),
    lender: str(fv("lenderName")),
    buyers: Array.isArray(fv("buyers")) ? (fv("buyers") as string[]) : null,
    sellers: Array.isArray(fv("sellers")) ? (fv("sellers") as string[]) : null,
    dates: {
      effectiveDate: str(fv("effectiveDate")),
      earnestMoneyDueDate: str(fv("earnestMoneyDueDate")),
      inspectionDeadline: str(fv("inspectionDeadline")),
      inspectionObjectionDeadline: str(fv("inspectionObjectionDeadline")),
      titleCommitmentDeadline: str(fv("titleCommitmentDeadline")),
      titleObjectionDeadline: str(fv("titleObjectionDeadline")),
      financingDeadline: str(fv("financingDeadline")),
      walkthroughDate: str(fv("walkthroughDate")),
      closingDate: str(fv("closingDate")),
      possessionDate: str(fv("possessionDate")),
    },
    contingencies,
    learnedTaskTitles: opts?.learnedTaskTitles,
  };
}

// Deadline safety net — guarantees a task for each present deadline, and
// `covered` decides (precisely, to avoid dupes) whether the AI already
// wrote one for it.
const DEADLINE_TASKS: Array<{
  key: string;
  title: string;
  owner: TaskOwner;
  priority: TaskPriority;
  covered: (t: string) => boolean;
}> = [
  { key: "earnestMoneyDueDate", title: "Deliver + verify earnest money", owner: "tc", priority: "high",
    covered: (t) => t.includes("earnest") },
  { key: "inspectionDeadline", title: "Complete property inspection", owner: "buyer_agent", priority: "high",
    covered: (t) => t.includes("inspection") && !t.includes("objection") },
  { key: "inspectionObjectionDeadline", title: "Submit inspection objection / resolution", owner: "buyer_agent", priority: "urgent",
    covered: (t) => t.includes("inspection") && t.includes("objection") },
  { key: "titleCommitmentDeadline", title: "Receive + review title commitment", owner: "title", priority: "normal",
    covered: (t) => t.includes("title") && !t.includes("objection") },
  { key: "titleObjectionDeadline", title: "Submit title objection (if needed)", owner: "tc", priority: "high",
    covered: (t) => t.includes("title") && t.includes("objection") },
  { key: "financingDeadline", title: "Confirm loan approval / clear-to-close", owner: "lender", priority: "high",
    covered: (t) => t.includes("financ") || t.includes("loan") || t.includes("clear") || t.includes("appraisal") },
  { key: "walkthroughDate", title: "Complete final walkthrough", owner: "buyer_agent", priority: "high",
    covered: (t) => t.includes("walk") },
  { key: "closingDate", title: "Close + disburse", owner: "tc", priority: "urgent",
    covered: (t) => (t.includes("clos") && !t.includes("disclos")) || t.includes("disburse") },
];

const SYSTEM = `You are an elite real-estate transaction coordinator building the task list for ONE specific deal. You are precise, exhaustive, and practical. You never invent deadlines — you anchor tasks to the dates you're given.`;

function buildUserPrompt(input: TaskGenInput): string {
  const cash = (input.financingType ?? "").toLowerCase().includes("cash");
  const dateLines = Object.entries(input.dates)
    .filter(([, v]) => v)
    .map(([k, v]) => `  - ${k}: ${v}`)
    .join("\n");
  const contLines = (input.contingencies ?? [])
    .map((c) => `  - ${c.name}${c.status ? ` [${c.status}]` : ""}${c.description ? `: ${c.description}` : ""}`)
    .join("\n");
  const learned = (input.learnedTaskTitles ?? []).slice(0, 25);
  const learnedBlock = learned.length
    ? `\nRECURRING ON SIMILAR PAST DEALS (fold in any that fit THIS contract; don't add ones that don't apply)\n${learned.map((t) => `  - ${t}`).join("\n")}\n`
    : "";

  return `Build the complete TC task list for this deal.

DEAL FACTS
  side represented: ${input.side ?? "unknown"}${input.strategy ? ` (strategy: ${input.strategy})` : ""}
  property: ${input.propertyAddress ?? "n/a"}
  price: ${input.purchasePrice ? `$${input.purchasePrice.toLocaleString()}` : "n/a"}
  financing: ${cash ? "CASH (skip lender/appraisal tasks)" : input.financingType ?? "financed"}
  HOA: ${input.hoa ? "yes" : "no/unknown"}
  title company: ${input.titleCompany ?? "n/a"}
  lender: ${input.lender ?? "n/a"}

KEY DATES (anchor deadline tasks to these — do NOT invent dates)
${dateLines || "  (none extracted)"}

CONTINGENCIES / PROVISIONS
${contLines || "  (none)"}
${learnedBlock}
RULES
- One task per real DEADLINE above, dueDate = that date. Prep tasks may be dated a few days earlier.
- One task per APPLICABLE contingency (satisfy or remove it before its deadline). Skip contingencies marked waived/removed/n/a.
- Standard TC tasks for the side: open escrow/title, welcome the client, disclosures, wire-fraud voice verification, closing logistics, submit to broker compliance, post-close review.
- If financing is CASH, DO NOT add lender, loan, or appraisal tasks.
- For any UNUSUAL or custom provision in the contract, add a task to handle it — don't drop it.
- Keep titles short + actionable (imperative). No duplicates.

Return ONLY JSON:
{ "tasks": [ { "title": "…", "dueDate": "YYYY-MM-DD or null", "owner": "tc|buyer_agent|listing_agent|client|lender|title", "priority": "low|normal|high|urgent", "category": "short group e.g. inspection/title/financing/closing/compliance", "note": "optional 1-line context or null" } ] }`;
}

const OWNERS = new Set<TaskOwner>(["tc", "buyer_agent", "listing_agent", "client", "lender", "title"]);
const PRIORITIES = new Set<TaskPriority>(["low", "normal", "high", "urgent"]);

function coerceTask(raw: unknown): GeneratedTask | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const title = typeof o.title === "string" ? o.title.trim() : "";
  if (!title) return null;
  const dueDate =
    typeof o.dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.dueDate)
      ? o.dueDate
      : null;
  const owner = OWNERS.has(o.owner as TaskOwner) ? (o.owner as TaskOwner) : "tc";
  const priority = PRIORITIES.has(o.priority as TaskPriority)
    ? (o.priority as TaskPriority)
    : "normal";
  const note = typeof o.note === "string" && o.note.trim() ? o.note.trim() : null;
  const category = typeof o.category === "string" ? o.category.trim() : "general";
  return { title, description: note, dueDate, owner, priority, category };
}

/**
 * Generate the tailored task list. Returns the AI list merged with a
 * deterministic safety net: every present deadline date is guaranteed a
 * task even if the model missed it.
 */
export async function generateAiTasks(
  apiKey: string,
  input: TaskGenInput,
): Promise<GeneratedTask[]> {
  let aiTasks: GeneratedTask[] = [];
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        response_format: { type: "json_object" },
        max_tokens: 2500,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: buildUserPrompt(input) },
        ],
      }),
    });
    if (res.ok) {
      const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const raw = data.choices?.[0]?.message?.content ?? "{}";
      const parsed = JSON.parse(raw) as { tasks?: unknown };
      if (Array.isArray(parsed.tasks)) {
        aiTasks = parsed.tasks.map(coerceTask).filter((t): t is GeneratedTask => t !== null);
      }
    }
  } catch {
    /* fall through to the deterministic safety net */
  }

  // Safety net: guarantee a task for every present deadline the model
  // may have skipped — `covered` matches precisely to avoid duplicates.
  const cash = (input.financingType ?? "").toLowerCase().includes("cash");
  const titles = aiTasks.map((t) => t.title.toLowerCase());
  for (const d of DEADLINE_TASKS) {
    const date = input.dates[d.key];
    if (!date) continue;
    if (cash && d.key === "financingDeadline") continue;
    if (titles.some(d.covered)) continue;
    aiTasks.push({
      title: d.title,
      description: null,
      dueDate: date,
      owner: d.owner,
      priority: d.priority,
      category: "deadline",
    });
  }

  // Sort: dated first (chronological), then undated.
  aiTasks.sort((a, b) => {
    if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
    if (a.dueDate) return -1;
    if (b.dueDate) return 1;
    return 0;
  });
  return aiTasks;
}
