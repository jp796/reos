/**
 * Rescan the North Ridge contract: full financials + every contingency,
 * then generate the complete TC task list from the extraction.
 *   DATABASE_URL=<prod> bun run scripts/rescan-northridge.ts
 */
import { prisma } from "@/lib/db";
import { ContractExtractionService } from "@/services/ai/ContractExtractionService";

const DOC_ID = process.argv[2] ?? "cmqube38g00159lk4i6nysvx6";
type F = { value: unknown } | undefined;

const doc = await prisma.document.findUnique({
  where: { id: DOC_ID },
  select: { rawBytes: true, fileName: true },
});
if (!doc?.rawBytes) {
  console.error("no raw bytes for", DOC_ID);
  process.exit(1);
}
console.log(`Rescanning: ${doc.fileName}\n`);

const svc = new ContractExtractionService(process.env.OPENAI_API_KEY!);
const ex = (await svc.extract(Buffer.from(doc.rawBytes))) as unknown as Record<
  string,
  F
>;
const val = (k: string) => (ex[k] as F)?.value ?? "—";
const arr = (k: string) =>
  (((ex[k] as F)?.value as unknown[]) ?? []) as Array<Record<string, unknown>>;

console.log("══ FINANCIALS ══");
for (const [label, k] of [
  ["Purchase price", "purchasePrice"],
  ["Earnest money", "earnestMoneyAmount"],
  ["Loan amount", "loanAmount"],
  ["Balance due at closing", "balanceDueAtClosing"],
  ["Amortization (yrs)", "loanAmortizationYears"],
  ["Interest rate", "interestRate"],
  ["Monthly payment", "monthlyPayment"],
  ["Financing type", "financingType"],
  ["Seller comm %", "sellerSideCommissionPct"],
  ["Buyer comm %", "buyerSideCommissionPct"],
] as const) {
  console.log(`  ${label}: ${val(k)}`);
}

console.log("\n══ KEY DATES ══");
for (const [label, k] of [
  ["Effective", "effectiveDate"],
  ["Closing", "closingDate"],
  ["Possession", "possessionDate"],
  ["Earnest money due", "earnestMoneyDueDate"],
  ["Inspection", "inspectionDeadline"],
  ["Inspection objection", "inspectionObjectionDeadline"],
  ["Title commitment", "titleCommitmentDeadline"],
  ["Title objection", "titleObjectionDeadline"],
  ["Financing", "financingDeadline"],
  ["Walkthrough", "walkthroughDate"],
] as const) {
  console.log(`  ${label}: ${val(k)}`);
}

const cont = arr("contingencies");
console.log(`\n══ CONTINGENCIES (${cont.length}) ══`);
for (const c of cont) {
  console.log(
    `  • ${c.name} [${c.status}]${c.deadline ? ` — due ${c.deadline}` : ""}\n      ${c.description}`,
  );
}

console.log("\n══ PARTIES ══");
for (const p of arr("partyDetails"))
  console.log(`  • ${p.name} (${p.role})${p.email ? ` <${p.email}>` : ""}`);
console.log("══ AGENTS ══");
for (const a of arr("agents"))
  console.log(
    `  • ${a.name} — ${a.role}${a.brokerage ? ` @ ${a.brokerage}` : ""}`,
  );

console.log("\n══ GENERATING COMPLETE TASK LIST ══");
const payload = {
  effectiveDate: val("effectiveDate"),
  closingDate: val("closingDate"),
  dates: {
    earnestMoneyDue: val("earnestMoneyDueDate"),
    inspection: val("inspectionDeadline"),
    inspectionObjection: val("inspectionObjectionDeadline"),
    titleCommitment: val("titleCommitmentDeadline"),
    titleObjection: val("titleObjectionDeadline"),
    financing: val("financingDeadline"),
    walkthrough: val("walkthroughDate"),
    possession: val("possessionDate"),
  },
  parties: arr("partyDetails"),
  agents: arr("agents"),
  financing: {
    purchasePrice: val("purchasePrice"),
    earnestMoney: val("earnestMoneyAmount"),
    loanAmount: val("loanAmount"),
    type: val("financingType"),
  },
  contingencies: cont,
};
const prompt = `You are an expert real-estate transaction coordinator (buyer side). Given the extracted contract data below, produce the COMPLETE, ordered task list to coordinate this transaction from contract to close. Cover EVERY contingency, deadline, and obligation in the data — leave nothing out. For each task return: title, dueDate (ISO YYYY-MM-DD if derivable from the dates, else null), keyedTo (which deadline/event it keys off, or null), autoEmail (true when the task is primarily sending an email to a party/agent), and a one-sentence description that references the ACTUAL parties/agents by name. Order by due date. A financed residential purchase typically yields 15-25 tasks. Return JSON: {"tasks":[{"title","dueDate","keyedTo","autoEmail","description"}]}.

EXTRACTED CONTRACT:
${JSON.stringify(payload, null, 2)}`;

const resp = await fetch("https://api.openai.com/v1/chat/completions", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
  },
  body: JSON.stringify({
    model: "gpt-4o",
    response_format: { type: "json_object" },
    max_tokens: 4000,
    messages: [{ role: "user", content: prompt }],
  }),
});
const data = (await resp.json()) as {
  choices?: Array<{ message?: { content?: string } }>;
};
const content = data.choices?.[0]?.message?.content ?? "{}";
const tasks = (JSON.parse(content).tasks ?? []) as Array<{
  title: string;
  dueDate?: string;
  keyedTo?: string;
  autoEmail?: boolean;
  description?: string;
}>;
console.log(`Generated ${tasks.length} tasks:\n`);
tasks.forEach((t, i) => {
  console.log(
    `  ${String(i + 1).padStart(2)}. ${t.title}${t.autoEmail ? "  ✉ auto-email" : ""}`,
  );
  console.log(
    `      due ${t.dueDate ?? "—"}${t.keyedTo ? ` (keyed to ${t.keyedTo})` : ""}`,
  );
  console.log(`      ${t.description ?? ""}`);
});
process.exit(0);
