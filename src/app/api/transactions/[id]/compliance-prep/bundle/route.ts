/**
 * GET /api/transactions/:id/compliance-prep/bundle
 *
 * Streams a ZIP of every present compliance doc, renamed to the
 * Rezen filename convention ("01 Purchase Contract.pdf", etc.) and
 * with a top-level COMPLIANCE_REPORT.txt that lists what's present
 * and what's missing.
 *
 * Used by the human or future Playwright bot as the canonical
 * "submit to Rezen" payload.
 */

import { NextResponse } from "next/server";
import JSZip from "jszip";
import { prisma } from "@/lib/db";
import { requireSession, assertSameAccount } from "@/lib/require-session";
import { buildRezenPrepReport } from "@/services/core/RezenCompliancePrep";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const { id } = await ctx.params;
  const txn = await prisma.transaction.findUnique({
    where: { id },
    select: {
      id: true,
      accountId: true,
      side: true,
      state: true,
      propertyAddress: true,
    },
  });
  if (!txn) return NextResponse.json({ error: "not found" }, { status: 404 });
  const guard = assertSameAccount(actor, txn.accountId);
  if (guard) return guard;

  const documents = await prisma.document.findMany({
    where: { transactionId: id },
    select: {
      id: true,
      fileName: true,
      category: true,
      extractedText: true,
      source: true,
      rawBytes: true,
      mimeType: true,
    },
  });

  const report = buildRezenPrepReport({
    side: txn.side,
    state: txn.state,
    documents: documents.map(({ rawBytes: _r, mimeType: _m, ...d }) => d),
  });

  // Build the zip
  const zip = new JSZip();

  // Top-level human-readable report (drives any reviewer's eye to
  // what's missing without opening every PDF).
  const txt = [
    `Rezen Compliance Prep — ${txn.propertyAddress ?? "(no address)"}`,
    `Coverage: ${report.presentCount}/${
      report.presentCount + report.missingCount
    }  (${Math.round(report.coverage * 100)}%)`,
    "",
    "PRESENT:",
    ...report.items
      .filter((i) => i.status === "present")
      .map(
        (i) =>
          `  ✓ ${i.rezenFilename ?? "(unfiled)"}  ←  ${
            i.matches[0]?.fileName ?? ""
          }`,
      ),
    "",
    "MISSING:",
    ...report.items
      .filter((i) => i.status === "missing")
      .map((i) => `  ✗ ${i.requirement.label}`),
    "",
    `Generated ${new Date().toISOString()}`,
  ].join("\n");
  zip.file("COMPLIANCE_REPORT.txt", txt);

  // Each present doc, renamed.
  const docsById = new Map(documents.map((d) => [d.id, d]));
  for (const item of report.items) {
    if (item.status !== "present") continue;
    const matchId = item.matches[0]?.id;
    if (!matchId) continue;
    const doc = docsById.get(matchId);
    if (!doc?.rawBytes || !item.rezenFilename) continue;
    zip.file(item.rezenFilename, doc.rawBytes);
  }

  const buf = await zip.generateAsync({ type: "nodebuffer" });
  const safeName = (txn.propertyAddress ?? "transaction")
    .replace(/[^a-z0-9 ]/gi, "")
    .trim()
    .slice(0, 60)
    .replace(/\s+/g, "_") || "transaction";

  return new NextResponse(buf as unknown as BodyInit, {
    status: 200,
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="REZEN_${safeName}.zip"`,
    },
  });
}
