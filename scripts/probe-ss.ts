import { readFileSync } from "fs";
import { DocumentExtractionService } from "../src/services/ai/DocumentExtractionService";

async function main() {
  const p = process.argv[2];
  const side = (process.argv[3] as "buy" | "sell") ?? "sell";
  if (!p) throw new Error("pass path + side");
  const buf = readFileSync(p);
  const svc = new DocumentExtractionService();
  const text = await svc.extractText(buf);
  console.log(`len=${text.length} side=${side}`);
  // eslint-disable-next-line no-control-regex
  const cleaned = text.replace(/\u0000/g, "").replace(/[\u0001-\u001F]/g, " ");
  const idx = cleaned.indexOf("Agent Commission");
  if (idx > 0) {
    console.log("cleaned neighborhood:", JSON.stringify(cleaned.slice(idx - 20, idx + 60)));
  }

  for (const anchor of ["Sale Price", "Commission", "Referral", "Broker Compensation", "Real Estate Broker"]) {
    const re = new RegExp(anchor, "gi");
    let m: RegExpExecArray | null;
    let c = 0;
    while ((m = re.exec(text)) && c < 4) {
      const start = Math.max(0, m.index - 30);
      const end = Math.min(text.length, m.index + 140);
      console.log(`  [${anchor}] …${text.slice(start, end).replace(/\s+/g, " ")}…`);
      c++;
    }
  }
  console.log("\n=== extraction ===");
  const f = svc.financialsFromText(text, side);
  console.log(JSON.stringify(f, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
