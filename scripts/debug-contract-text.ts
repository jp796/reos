/**
 * Dump extracted text from a contract PDF + run regex probes so
 * we can tune the contract extractor against real samples.
 *
 * Run:
 *   node --env-file=.env --import tsx scripts/debug-contract-text.ts <path>
 */

import { readFileSync } from "fs";
import { PDFDocument } from "pdf-lib";
import { DocumentExtractionService } from "../src/services/ai/DocumentExtractionService";

async function main() {
  const p = process.argv[2];
  if (!p) throw new Error("pass a PDF path");
  const buf = readFileSync(p);
  const svc = new DocumentExtractionService();
  const text = await svc.extractText(buf);
  console.log(`Extracted ${text.length} chars of text from ${p}`);

  // Also read any AcroForm field values — Missouri Realtors contracts
  // are distributed as fillable PDFs where the answers live here, not
  // in the text layer.
  try {
    const pdf = await PDFDocument.load(new Uint8Array(buf), {
      ignoreEncryption: true,
    });
    const form = pdf.getForm();
    const fields = form.getFields();
    console.log(`Found ${fields.length} form fields\n`);
    console.log("=== Form field values ===");
    for (const f of fields) {
      const name = f.getName();
      let val: string | undefined;
      try {
        const c = f.constructor.name;
        if (c === "PDFTextField") val = (f as unknown as { getText(): string | undefined }).getText();
        else if (c === "PDFCheckBox") val = (f as unknown as { isChecked(): boolean }).isChecked() ? "checked" : "";
        else if (c === "PDFDropdown") val = (f as unknown as { getSelected(): string[] }).getSelected().join(",");
      } catch {
        // skip
      }
      if (val && val.trim()) console.log(`  ${name.slice(0, 50)} = ${val.slice(0, 120)}`);
    }
    console.log();
  } catch (e) {
    console.log("No AcroForm or failed to parse:", e instanceof Error ? e.message : e);
  }

  const probes: Array<[string, RegExp]> = [
    ["purchase_price", /\$\s?[\d,]+(?:\.\d{2})?/g],
    ["earnest_money", /earnest\s+money[^.\n]{0,160}/gi],
    ["closing", /closing[^.\n]{0,160}/gi],
    ["inspection", /inspection[^.\n]{0,160}/gi],
    ["title", /title[^.\n]{0,160}/gi],
    ["financing", /financing|loan\s+(?:deadline|approval|commitment)[^.\n]{0,160}/gi],
    ["possession", /possession[^.\n]{0,160}/gi],
    ["effective", /effective\s+date|offer\s+to\s+purchase|binding\s+agreement[^.\n]{0,160}/gi],
    ["buyer_seller", /\b(?:Buyer|Seller)s?\b[^.\n]{0,100}/g],
    ["dates_numeric", /\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/g],
    ["dates_long", /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}/g],
  ];

  for (const [name, re] of probes) {
    const hits: string[] = [];
    let m: RegExpExecArray | null;
    const seen = new Set<string>();
    const g = new RegExp(re.source, re.flags);
    while ((m = g.exec(text))) {
      const val = m[0].replace(/\s+/g, " ").trim().slice(0, 140);
      if (!seen.has(val)) {
        seen.add(val);
        hits.push(val);
      }
      if (hits.length >= 8) break;
    }
    console.log(`── ${name} (${hits.length})`);
    for (const h of hits) console.log(`  ${h}`);
    console.log();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
