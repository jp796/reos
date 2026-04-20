/**
 * Show text windows around specific anchor strings so we can see
 * exactly how the filled values are laid out relative to labels.
 * Lets us build precise anchor-distance regexes.
 */

import { readFileSync } from "fs";
import { DocumentExtractionService } from "../src/services/ai/DocumentExtractionService";

async function main() {
  const p = process.argv[2];
  if (!p) throw new Error("pass a PDF path");
  const text = await new DocumentExtractionService().extractText(readFileSync(p));

  const anchors = [
    "OFFER TO PURCHASE",
    "Purchase Price",
    "Earnest Money",
    "EARNEST MONEY",
    "commonly known as",
    "Address",
    "Closing Date",
    "Closing will be",
    "on or before",
    "Inspection",
    "Title Insurance",
    "title insurance commitment",
    "Possession",
    "Effective Date",
    "Buyer",
    "Seller",
  ];

  for (const a of anchors) {
    const re = new RegExp(a, "gi");
    let m: RegExpExecArray | null;
    let hits = 0;
    while ((m = re.exec(text)) && hits < 3) {
      const start = Math.max(0, m.index - 60);
      const end = Math.min(text.length, m.index + a.length + 200);
      const window = text.slice(start, end).replace(/\s+/g, " ");
      console.log(`▸ [${a}]  …${window}…\n`);
      hits++;
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
