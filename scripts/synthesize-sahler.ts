/**
 * Run the synthesis engine against the SAHLER deal + print the report.
 *   DATABASE_URL=<prod> bun run scripts/synthesize-sahler.ts [transactionId]
 */
import { prisma } from "@/lib/db";
import { synthesizeDeal } from "@/services/core/DocumentSynthesisService";

const ID = process.argv[2] ?? "cmqcnkmj30001wbm174bjgghv";
const force = process.argv.includes("--force");
console.log("Synthesizing deal", ID, force ? "(force re-analyze)" : "(use cache)", "…\n");
const r = await synthesizeDeal(prisma, "owner-account", ID, force);
if (!r) {
  console.error("deal not found");
  process.exit(1);
}

console.log(`══ ${r.address} ══`);
console.log(r.summary, "\n");

console.log("── DOCUMENTS (classified) ──");
for (const d of r.docs) {
  console.log(`  • ${d.fileName}`);
  console.log(`      type: ${d.docType}${d.amendsContract ? " · AMENDS" : ""}${d.effectiveDate ? ` · ${d.effectiveDate}` : ""}`);
  if (Object.values(d.fieldChanges).some((v) => v != null && v !== "")) {
    console.log(`      changes: ${JSON.stringify(d.fieldChanges)}`);
  }
  for (const u of d.contingencyUpdates) {
    console.log(`      contingency: ${u.name} → ${u.status}${u.date ? ` (${u.date})` : ""}`);
  }
}

console.log("\n── MERGED TIMELINE DATES ──");
for (const [k, v] of Object.entries(r.mergedDates)) {
  console.log(`  ${k}: ${v ?? "—"}`);
}

console.log("\n── CONTINGENCIES (current status) ──");
for (const c of r.contingencies) {
  const flag = c.status !== "applies" ? "  ◀ UPDATED" : "";
  console.log(`  • ${c.name}: ${c.status.toUpperCase()}${c.date ? ` (${c.date})` : ""} · src ${c.source}${flag}`);
}

console.log("\n── CHANGES MERGED INTO THE DEAL ──");
if (r.changesApplied.length === 0) console.log("  (none)");
for (const c of r.changesApplied) console.log(`  • ${c}`);
process.exit(0);
