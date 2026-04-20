/**
 * Extract structured fields from a contract / rider PDF via GPT-4o-mini.
 * Usage: node --env-file=.env --import tsx scripts/test-contract-extract.ts <path>
 */

import { readFileSync } from "fs";
import { ContractExtractionService } from "../src/services/ai/ContractExtractionService";

async function main() {
  const p = process.argv[2];
  if (!p) throw new Error("pass a PDF path");
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not set");

  const buf = readFileSync(p);
  const svc = new ContractExtractionService(process.env.OPENAI_API_KEY);
  const forceVision = process.argv.includes("--vision");
  const started = Date.now();
  const r = forceVision
    ? { ...(await svc.extractWithVision(buf)), _path: "vision" as const }
    : await svc.extract(buf);
  const ms = Date.now() - started;
  console.log(`Extracted in ${ms}ms via path=${r._path}\n`);

  const rows: Array<[string, string]> = [];
  const fmt = (v: unknown) =>
    v === null || v === undefined ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v);
  for (const [k, v] of Object.entries(r)) {
    if (k === "notes") continue;
    if (!v || typeof v !== "object") continue;
    const f = v as { value: unknown; confidence: number; snippet: string | null };
    rows.push([
      k,
      `${fmt(f.value).padEnd(40)}  [${(f.confidence * 100).toFixed(0)}%]  ${f.snippet ? "· " + f.snippet.slice(0, 80) : ""}`,
    ]);
  }
  const width = Math.max(...rows.map(([k]) => k.length));
  for (const [k, v] of rows) console.log(`${k.padEnd(width)}  ${v}`);
  if (r.notes) console.log(`\nNOTES: ${r.notes}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
