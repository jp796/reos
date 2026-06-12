/**
 * Native esign PDF engine — first-party replacement for the signing
 * half of Documenso/DocuSign. Two jobs:
 *
 *   1. renderPdfPage — rasterize one page to PNG (pdftoppm, same
 *      poppler dependency PdfRender.ts already relies on) for the
 *      field-placement editor and the public signing page.
 *
 *   2. finalizeSignedPdf — burn captured signatures / dates / text
 *      into the PDF via pdf-lib and append a signature-certificate
 *      page (signers, consent, timestamps, IPs, document hashes).
 *      This page + the EsignEvent rows are the ESIGN/UETA evidence
 *      package.
 *
 * Coordinate contract: EsignField stores normalized 0..1 coords with
 * TOP-LEFT origin (UI convention). pdf-lib draws from BOTTOM-LEFT, so
 * y converts as: pdfY = pageH - (y * pageH) - boxH.
 */

import { spawn } from "child_process";
import { createHash } from "crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";

export interface FinalizeField {
  type: string; // SIGNATURE, INITIALS, DATE_SIGNED, TEXT
  page: number; // 1-based
  x: number;
  y: number;
  width: number;
  height: number;
  value: string | null;
}

export interface FinalizeRecipient {
  name: string;
  email: string;
  consentAt: Date | null;
  consentTextVersion: string | null;
  signedAt: Date | null;
  ip: string | null;
  userAgent: string | null;
  signatureImage: string | null; // PNG data URL
  fields: FinalizeField[];
}

export interface FinalizeEventLine {
  type: string;
  occurredAt: Date;
  who: string | null;
  ip: string | null;
}

export async function renderPdfPage(
  buffer: Buffer,
  page: number,
  dpi = 130,
): Promise<Buffer | null> {
  const dir = await mkdtemp(path.join(tmpdir(), "reos-esign-pg-"));
  const pdfPath = path.join(dir, "in.pdf");
  const outPrefix = path.join(dir, "page");
  try {
    await writeFile(pdfPath, buffer);
    await new Promise<void>((resolve, reject) => {
      const proc = spawn("pdftoppm", [
        "-png",
        "-r",
        String(dpi),
        "-f",
        String(page),
        "-l",
        String(page),
        pdfPath,
        outPrefix,
      ]);
      proc.on("error", reject);
      proc.on("exit", (code) =>
        code === 0 ? resolve() : reject(new Error(`pdftoppm exit ${code}`)),
      );
    });
    const files = (await readdir(dir)).filter(
      (f) => f.startsWith("page") && f.endsWith(".png"),
    );
    if (files.length === 0) return null;
    return await readFile(path.join(dir, files[0]!));
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function dataUrlToPngBytes(dataUrl: string): Uint8Array | null {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) return null;
  return new Uint8Array(Buffer.from(m[1]!, "base64"));
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "America/Chicago",
  });
}

function fmtDateTime(d: Date): string {
  return (
    d.toLocaleString("en-US", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZone: "America/Chicago",
      hour12: false,
    }) + " CT"
  );
}

function drawTextInBox(
  page: PDFPage,
  font: PDFFont,
  text: string,
  box: { x: number; y: number; w: number; h: number },
): void {
  let size = Math.min(12, box.h * 0.7);
  while (size > 5 && font.widthOfTextAtSize(text, size) > box.w) size -= 0.5;
  page.drawText(text, {
    x: box.x + 2,
    y: box.y + (box.h - size) / 2,
    size,
    font,
    color: rgb(0.05, 0.05, 0.2),
  });
}

export async function finalizeSignedPdf(input: {
  pdfBytes: Buffer;
  title: string;
  requestId: string;
  recipients: FinalizeRecipient[];
  events: FinalizeEventLine[];
}): Promise<{ bytes: Buffer; sha256: string; originalSha256: string }> {
  const originalSha256 = createHash("sha256")
    .update(input.pdfBytes)
    .digest("hex");

  const doc = await PDFDocument.load(input.pdfBytes, {
    ignoreEncryption: true,
  });
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const helvBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const pages = doc.getPages();

  // ---- 1. Burn fields into the document pages -------------------
  for (const r of input.recipients) {
    const sigBytes = r.signatureImage
      ? dataUrlToPngBytes(r.signatureImage)
      : null;
    const sigImage = sigBytes ? await doc.embedPng(sigBytes) : null;

    for (const f of r.fields) {
      const page = pages[f.page - 1];
      if (!page) continue;
      const pw = page.getWidth();
      const ph = page.getHeight();
      const box = {
        x: f.x * pw,
        w: f.width * pw,
        h: f.height * ph,
        y: ph - f.y * ph - f.height * ph, // top-left → bottom-left origin
      };

      if ((f.type === "SIGNATURE" || f.type === "INITIALS") && sigImage) {
        const scale = Math.min(
          box.w / sigImage.width,
          box.h / sigImage.height,
        );
        const w = sigImage.width * scale;
        const h = sigImage.height * scale;
        page.drawImage(sigImage, {
          x: box.x + (box.w - w) / 2,
          y: box.y + (box.h - h) / 2,
          width: w,
          height: h,
        });
      } else if (f.type === "DATE_SIGNED" && r.signedAt) {
        drawTextInBox(page, helv, fmtDate(r.signedAt), box);
      } else if (f.type === "TEXT" && f.value) {
        drawTextInBox(page, helv, f.value, box);
      }
    }
  }

  // ---- 2. Append the signature-certificate page -----------------
  const cert = doc.addPage([612, 792]); // US Letter
  const margin = 54;
  let y = 792 - margin;
  const line = (
    text: string,
    opts: { bold?: boolean; size?: number; indent?: number } = {},
  ) => {
    const size = opts.size ?? 9;
    if (y < margin) return; // certificate overflow guard — events are capped below
    cert.drawText(text.slice(0, 110), {
      x: margin + (opts.indent ?? 0),
      y,
      size,
      font: opts.bold ? helvBold : helv,
      color: rgb(0.1, 0.1, 0.15),
    });
    y -= size + 5;
  };

  line("Signature Certificate", { bold: true, size: 16 });
  y -= 6;
  line(`Document: ${input.title}`, { size: 10 });
  line(`Reference: ${input.requestId}`);
  line(`Original document SHA-256: ${originalSha256}`);
  line(
    "Signed electronically via REOS in accordance with the U.S. ESIGN Act and UETA.",
  );
  y -= 10;

  for (const r of input.recipients) {
    line(`Signer: ${r.name} <${r.email}>`, { bold: true, size: 10 });
    if (r.consentAt) {
      line(
        `Consented to electronic records & signatures: ${fmtDateTime(r.consentAt)} (${r.consentTextVersion ?? "v1"})`,
        { indent: 12 },
      );
    }
    if (r.signedAt) {
      line(`Signed: ${fmtDateTime(r.signedAt)}`, { indent: 12 });
    }
    if (r.ip) {
      line(
        `IP: ${r.ip}${r.userAgent ? ` — ${r.userAgent.slice(0, 70)}` : ""}`,
        { indent: 12 },
      );
    }
    y -= 6;
  }

  y -= 6;
  line("Audit trail", { bold: true, size: 10 });
  for (const e of input.events.slice(0, 28)) {
    line(
      `${fmtDateTime(e.occurredAt)} — ${e.type}${e.who ? ` — ${e.who}` : ""}${e.ip ? ` (${e.ip})` : ""}`,
      { indent: 12 },
    );
  }

  const bytes = Buffer.from(await doc.save());
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return { bytes, sha256, originalSha256 };
}
