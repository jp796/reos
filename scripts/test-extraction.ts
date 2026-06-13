/**
 * scripts/test-extraction.ts
 *
 * Regression harness for the AI contract-extraction pipeline. Runs
 * every fixture PDF in test/fixtures/contracts/ through
 * ContractExtractionService and asserts the expected fields came out.
 *
 * Prints a per-field pass/fail matrix. Exits non-zero on any
 * regression — wire it into CI / pre-deploy to stop a prompt or
 * routing change from silently breaking date extraction.
 *
 * Fixtures (gitignored — they hold real PII):
 *   test/fixtures/contracts/<name>.pdf
 *   test/fixtures/contracts/<name>.expected.json
 *     { "closingDate": "2026-06-16", "inspectionDeadline": "2026-05-20",
 *       "purchasePrice": 450000, ... }   // only the fields you assert
 *
 * Usage:
 *   OPENAI_API_KEY=... bun run scripts/test-extraction.ts
 *   OPENAI_API_KEY=... bun run scripts/test-extraction.ts --only war
 *
 * The harness pulls the key from OPENAI_API_KEY (or GCP Secret
 * Manager if you export it first). No DB needed — pure extraction.
 */

import { readdir, readFile } from "fs/promises";
import path from "path";
import { ContractExtractionService } from "../src/services/ai/ContractExtractionService";

const FIX_DIR = path.join(process.cwd(), "test", "fixtures", "contracts");

interface ExpectedMap {
  [field: string]: string | number | boolean | null;
}

function fieldValue(extraction: Record<string, unknown>, key: string): unknown {
  const f = extraction[key];
  if (f && typeof f === "object" && "value" in (f as object)) {
    return (f as { value: unknown }).value;
  }
  return f ?? null;
}

async function main() {
  const onlyArg = process.argv.indexOf("--only");
  const onlyFilter = onlyArg >= 0 ? process.argv[onlyArg + 1]?.toLowerCase() : null;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error(
      "OPENAI_API_KEY not set. Export it (or pull from Secret Manager):\n" +
        "  export OPENAI_API_KEY=$(gcloud secrets versions access latest --secret=OPENAI_API_KEY)",
    );
    process.exit(2);
  }

  let entries: string[];
  try {
    entries = await readdir(FIX_DIR);
  } catch {
    console.error(
      `No fixtures dir at ${FIX_DIR}.\n` +
        "Create it and drop <name>.pdf + <name>.expected.json pairs.\n" +
        "(Fixtures are gitignored — they contain real contract PII.)",
    );
    process.exit(2);
  }

  const pdfs = entries
    .filter((f) => f.endsWith(".pdf"))
    .filter((f) => !onlyFilter || f.toLowerCase().includes(onlyFilter));

  if (pdfs.length === 0) {
    console.error("No matching .pdf fixtures found.");
    process.exit(2);
  }

  const svc = new ContractExtractionService(apiKey);
  let totalAsserts = 0;
  let totalFails = 0;
  const failedFixtures: string[] = [];

  for (const pdf of pdfs) {
    const base = pdf.replace(/\.pdf$/, "");
    const expectedPath = path.join(FIX_DIR, `${base}.expected.json`);
    let expected: ExpectedMap;
    try {
      expected = JSON.parse(await readFile(expectedPath, "utf8"));
    } catch {
      console.log(`\n⚠  ${pdf} — no ${base}.expected.json, skipping asserts`);
      continue;
    }

    const buf = await readFile(path.join(FIX_DIR, pdf));
    process.stdout.write(`\n▶ ${pdf} … `);
    let extraction: Record<string, unknown> & { _path?: string };
    try {
      extraction = (await svc.extract(buf)) as unknown as typeof extraction;
    } catch (e) {
      console.log(`EXTRACTION THREW: ${e instanceof Error ? e.message : e}`);
      totalFails++;
      failedFixtures.push(pdf);
      continue;
    }
    console.log(`(path: ${extraction._path})`);

    let fixtureFails = 0;
    for (const [field, want] of Object.entries(expected)) {
      totalAsserts++;
      const got = fieldValue(extraction, field);
      const ok =
        want === null
          ? got == null
          : Array.isArray(want)
            ? JSON.stringify(got) === JSON.stringify(want)
            : String(got) === String(want);
      const mark = ok ? "✓" : "✗";
      const detail = ok ? "" : `  want=${JSON.stringify(want)} got=${JSON.stringify(got)}`;
      console.log(`    ${mark} ${field}${detail}`);
      if (!ok) {
        fixtureFails++;
        totalFails++;
      }
    }
    if (fixtureFails > 0) failedFixtures.push(pdf);
  }

  console.log(
    `\n${"─".repeat(50)}\n` +
      `${totalAsserts - totalFails}/${totalAsserts} field assertions passed across ${pdfs.length} fixture(s).`,
  );
  if (totalFails > 0) {
    console.log(`✗ REGRESSIONS in: ${failedFixtures.join(", ")}`);
    process.exit(1);
  }
  console.log("✓ All extraction fixtures pass.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
