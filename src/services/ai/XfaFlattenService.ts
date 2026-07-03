/**
 * XfaFlattenService — render an Adobe-only XFA form into a normal, flat
 * PDF everything can read + fill.
 *
 * XFA forms render as an "install Adobe" dummy page in poppler/Preview/
 * Chromium's own viewer. The ONLY faithful renderer we can run headless
 * is pdfjs's XFA layer — so we load pdfjs's viewer in headless Chromium
 * (Playwright), point it at the form with enableXfa + the standard font
 * / cMap data (without which the top of the form renders as a black
 * box), let it lay the form out, and print the result to PDF. The output
 * is a flat PDF with a real text layer, so the mapper can anchor to it.
 *
 * Verified faithful on the WY WAR contract. Requires Chromium in the
 * deploy image (see Dockerfile).
 */

import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const PDFJS_ROOT = join(process.cwd(), "node_modules", "pdfjs-dist");

const MIME: Record<string, string> = {
  ".mjs": "text/javascript",
  ".js": "text/javascript",
  ".css": "text/css",
  ".pdf": "application/pdf",
  ".html": "text/html",
  ".map": "application/json",
  ".bcmap": "application/octet-stream",
  ".pfb": "application/octet-stream",
  ".ttf": "font/ttf",
};

const VIEWER_HTML = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="/web/pdf_viewer.css">
<style>
  html,body{margin:0;background:#fff}
  #viewerContainer{position:absolute;inset:0;overflow:auto;background:#fff}
  .pdfViewer .page{border:0;margin:0 auto}
  @media print { #viewerContainer{position:static;overflow:visible} }
</style></head><body>
<div id="viewerContainer"><div id="viewer" class="pdfViewer"></div></div>
<script type="module">
  import * as pdfjs from "/build/pdf.mjs";
  import { PDFViewer, EventBus, PDFLinkService } from "/web/pdf_viewer.mjs";
  pdfjs.GlobalWorkerOptions.workerSrc = "/build/pdf.worker.mjs";
  const eventBus = new EventBus();
  const linkService = new PDFLinkService({ eventBus });
  const viewer = new PDFViewer({
    container: document.getElementById("viewerContainer"),
    viewer: document.getElementById("viewer"),
    eventBus, linkService, enableXfa: true, textLayerMode: 1,
  });
  linkService.setViewer(viewer);
  eventBus.on("pagesloaded", () => { setTimeout(() => { window.__done = true; }, 1200); });
  try {
    const doc = await pdfjs.getDocument({
      url: "/form.pdf", enableXfa: true,
      standardFontDataUrl: "/standard_fonts/", cMapUrl: "/cmaps/", cMapPacked: true,
    }).promise;
    viewer.setDocument(doc); linkService.setDocument(doc, null);
  } catch (e) { window.__err = String(e); window.__done = true; }
</script></body></html>`;

/** Render an XFA PDF into a flat, text-bearing PDF. */
export async function flattenXfaToPdf(xfaBytes: Uint8Array): Promise<Uint8Array> {
  // Lazy import so the app doesn't require Playwright unless a flatten
  // runs. playwright-core (no bundled browsers) + the system Chromium via
  // CHROMIUM_PATH on Alpine; the full `playwright` bundle locally.
  const mod = await import("playwright-core").catch(() => import("playwright"));
  const { chromium } = mod as typeof import("playwright-core");
  const executablePath = process.env.CHROMIUM_PATH || undefined;

  const server: Server = createServer(async (req, res) => {
    try {
      const url = (req.url || "/").split("?")[0];
      if (url === "/viewer.html") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end(VIEWER_HTML);
        return;
      }
      if (url === "/form.pdf") {
        res.writeHead(200, { "content-type": "application/pdf" });
        res.end(Buffer.from(xfaBytes));
        return;
      }
      const buf = await readFile(join(PDFJS_ROOT, url));
      const ext = "." + url.split(".").pop();
      res.writeHead(200, { "content-type": MIME[ext] ?? "application/octet-stream" });
      res.end(buf);
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  });
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;

  const browser = await chromium.launch({
    executablePath,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 1200 } });
    await page.goto(`http://localhost:${port}/viewer.html`, { waitUntil: "load", timeout: 45000 });
    await page.waitForFunction(() => (window as unknown as { __done?: boolean }).__done === true, {
      timeout: 45000,
    });
    const err = await page.evaluate(() => (window as unknown as { __err?: string }).__err);
    if (err) throw new Error(`pdfjs render failed: ${err}`);
    const pdf = await page.pdf({
      printBackground: true,
      format: "Letter",
      margin: { top: "0", bottom: "0", left: "0", right: "0" },
    });
    return new Uint8Array(pdf);
  } finally {
    await browser.close();
    server.close();
  }
}
