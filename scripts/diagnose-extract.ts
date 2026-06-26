/**
 * One-off: pull the real 1650 contract from the DB and run the live
 * ContractExtractionService against it, printing exactly what it gets
 * vs misses (dates, contingencies, commission). Diagnostic only.
 *   bun run scripts/diagnose-extract.ts
 */
import { prisma } from "@/lib/db";
import { ContractExtractionService } from "@/services/ai/ContractExtractionService";

const DOC_ID = process.argv[2] ?? "cmqube38g00159lk4i6nysvx6";

const doc = await prisma.document.findUnique({
  where: { id: DOC_ID },
  select: { rawBytes: true, fileName: true },
});
if (!doc?.rawBytes) {
  console.error("no raw bytes for", DOC_ID);
  process.exit(1);
}
const buffer = Buffer.from(doc.rawBytes);
console.log(`PDF: ${doc.fileName} (${buffer.length} bytes)\n`);

const svc = new ContractExtractionService(process.env.OPENAI_API_KEY!);
const ex = (await svc.extract(buffer)) as unknown as Record<
  string,
  { value: unknown; confidence?: number } | unknown
>;
const v = (k: string) => {
  const f = ex[k] as { value?: unknown; confidence?: number } | undefined;
  return f && typeof f === "object" && "value" in f
    ? `${JSON.stringify(f.value)} (conf ${f.confidence ?? "?"})`
    : "—";
};

console.log("── DATES ──");
for (const k of [
  "effectiveDate",
  "closingDate",
  "possessionDate",
  "inspectionDeadline",
  "inspectionObjectionDeadline",
  "titleCommitmentDeadline",
  "titleObjectionDeadline",
  "financingDeadline",
  "walkthroughDate",
  "earnestMoneyDueDate",
]) {
  console.log(`  ${k}: ${v(k)}`);
}
console.log("── RELATIVE OFFSETS ──");
for (const k of [
  "earnestMoneyDueDays",
  "inspectionPeriodDays",
  "inspectionObjectionDays",
  "financingDeadlineDays",
  "titleObjectionDays",
]) {
  console.log(`  ${k}: ${v(k)}`);
}
console.log("── MONEY ──");
for (const k of [
  "purchasePrice",
  "earnestMoneyAmount",
  "loanAmount",
  "sellerSideCommissionPct",
  "buyerSideCommissionPct",
]) {
  console.log(`  ${k}: ${v(k)}`);
}

const cont = (ex.contingencies as { value?: Array<{ name: string; status: string }> })?.value ?? [];
console.log(`── CONTINGENCIES (${cont.length}) ──`);
for (const c of cont) console.log(`  • ${c.name} [${c.status}]`);

const agents = (ex.agents as { value?: Array<{ name: string; role: string }> })?.value ?? [];
console.log(`── AGENTS (${agents.length}) ──`);
for (const a of agents) console.log(`  • ${a.name} [${a.role}]`);

console.log("── NOTES ──");
console.log(" ", (ex.notes as unknown) ?? "—");
const path = (ex as Record<string, unknown>)._path;
if (path) console.log("path:", path);
process.exit(0);
