/**
 * Shared helper: render a PDF buffer to PNG page images via pdftoppm.
 *
 * Used by both ContractExtractionService and DocumentExtractionService
 * for their GPT-4o Vision fallbacks. We shell out to `pdftoppm`
 * instead of using an npm pdfjs-wrapper so we don't collide with the
 * pdfjs-dist bundled inside pdf-parse v2 (global worker-version
 * conflict — see dev notes in ContractExtractionService).
 *
 * Requires `pdftoppm` on the PATH. macOS: `brew install poppler`.
 * Most Linux distros ship it.
 */

import { spawn } from "child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";

export async function renderPdfForVision(
  buffer: Buffer,
  maxPages: number,
): Promise<Buffer[]> {
  const dir = await mkdtemp(path.join(tmpdir(), "reos-pdf-"));
  const pdfPath = path.join(dir, "in.pdf");
  const outPrefix = path.join(dir, "page");
  try {
    await writeFile(pdfPath, buffer);
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(
        "pdftoppm",
        ["-png", "-r", "150", "-l", String(maxPages), pdfPath, outPrefix],
        { stdio: "ignore" },
      );
      proc.on("error", reject);
      proc.on("exit", (code) =>
        code === 0
          ? resolve()
          : reject(new Error(`pdftoppm exited with code ${code}`)),
      );
    });
    const files = (await readdir(dir))
      .filter((f) => f.startsWith("page-") && f.endsWith(".png"))
      .sort();
    const out: Buffer[] = [];
    for (const f of files.slice(0, maxPages)) {
      out.push(await readFile(path.join(dir, f)));
    }
    return out;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
