import { readFileSync } from "fs";
import { DocumentExtractionService } from "../src/services/ai/DocumentExtractionService";

async function main() {
  const p = process.argv[2];
  const side = (process.argv[3] as "buy" | "sell") ?? "sell";
  if (!p) throw new Error("pass path + side");
  const buf = readFileSync(p);
  const svc = new DocumentExtractionService();
  const r = await svc.extractFinancials(buf, side, {
    openaiApiKey: process.env.OPENAI_API_KEY,
  });
  console.log(JSON.stringify(r, null, 2));
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
