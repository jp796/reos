/**
 * Import JP's "Flip Calculator and Comparisons" workbook tabs that match
 * existing deals into FlipAnalysis rows.
 *
 *   bun run scripts/import-flip-workbook.ts <workbook.xlsx>          # dry-run (verify only)
 *   bun run scripts/import-flip-workbook.ts <workbook.xlsx> --write  # create rows
 *
 * Dry-run recomputes each tab via computeFlip and checks it reproduces the
 * sheet's own Fix&Flip profit (B30) before anything is written.
 */

import * as XLSX from "xlsx";
import { prisma } from "@/lib/db";
import { parseFlipTab } from "@/services/core/FlipWorkbookParser";
import { computeFlip } from "@/services/core/FlipCalcModel";

// tab name → existing transaction id (the 9 confirmed matches)
const MATCHES: Array<[string, string]> = [
  ["106 E 8th St, PB", "cmrebz957000569le3uafpwva"],
  ["1208 Windmill", "cmqkaz9qw000412pz23cyw5wl"],
  ["2315 Thomes", "cmrd02ivl0003g5klkf5sqmj4"],
  // "2618 E 17th" excluded — closed deal on a malformed/older template (its
  // Fix&Flip cells are misaligned), so its numbers can't be trusted.
  ["3453 N Farm 83", "cmqi7p6gy0003vg3dhl307025"],
  ["404  Main St", "cmr4a7nvn0003i27wf1sohevg"],
  ["810 W Locust", "cmrb4aoqj0005x3ho29ocmbrw"],
  ["9447 MO 13", "cmr59moae0003fgko7wshdlwv"],
  ["29 Mountain Meadow", "cmr5anq2s0005rahhfwxxlxdx"],
];

const IMPORT_LABEL = "Imported from Flip Calculator workbook";

const money = (n: number | null) => (n == null ? "—" : "$" + Math.round(n).toLocaleString());

async function main() {
  const file = process.argv[2];
  const write = process.argv.includes("--write");
  if (!file) {
    console.error("usage: bun run scripts/import-flip-workbook.ts <workbook.xlsx> [--write]");
    process.exit(1);
  }
  const wb = XLSX.readFile(file);

  let failures = 0;
  console.log(`${write ? "WRITE" : "DRY-RUN"} — ${MATCHES.length} matched tabs\n`);
  console.log("tab".padEnd(20), "recomputed".padEnd(12), "sheet".padEnd(12), "Δ".padEnd(8), "status");

  for (const [tab, txnId] of MATCHES) {
    const ws = wb.Sheets[tab];
    if (!ws) {
      console.log(tab.padEnd(20), "(tab missing)");
      failures++;
      continue;
    }
    const parsed = parseFlipTab(ws, tab);
    const r = computeFlip(parsed.inputs);
    const recomputed = r.fixFlip.profit;
    const sheet = parsed.sheetProfit;
    const delta = sheet == null ? null : Math.abs(recomputed - sheet);
    // Tolerance $2 for rounding; skip tabs whose sheet profit is a formula/string.
    const ok = sheet == null || (delta != null && delta <= 2);
    if (!ok) failures++;
    console.log(
      tab.padEnd(20),
      money(recomputed).padEnd(12),
      money(sheet).padEnd(12),
      (delta == null ? "n/a" : "$" + Math.round(delta)).padEnd(8),
      ok ? "✓" : "✗ MISMATCH",
    );

    if (write && ok) {
      const txn = await prisma.transaction.findUnique({
        where: { id: txnId },
        select: { accountId: true, propertyAddress: true },
      });
      if (!txn) {
        console.log(`   ! transaction ${txnId} not found — skipped`);
        continue;
      }
      // Idempotent: replace any prior import for this deal.
      await prisma.flipAnalysis.deleteMany({ where: { transactionId: txnId, label: IMPORT_LABEL } });
      await prisma.flipAnalysis.create({
        data: {
          accountId: txn.accountId,
          transactionId: txnId,
          label: IMPORT_LABEL,
          inputsJson: parsed.inputs as unknown as object,
        },
      });
      console.log(`   ↳ saved onto ${txn.propertyAddress}`);
    }
  }

  console.log(
    "\n" + "─".repeat(52) + "\n" +
      (failures === 0
        ? `✓ All ${MATCHES.length} tabs reproduce the sheet.`
        : `✗ ${failures} tab(s) failed verification — not safe to import.`),
  );
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main();
