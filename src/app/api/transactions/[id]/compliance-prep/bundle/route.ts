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
import {
  buildRezenPrepReport,
  loadSlotsForProfile,
} from "@/services/core/RezenCompliancePrep";

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
      account: { select: { brokerageProfileId: true } },
    },
  });
  if (!txn) return NextResponse.json({ error: "not found" }, { status: 404 });
  const guard = assertSameAccount(actor, txn.accountId);
  if (guard) return guard;

  const profileId = txn.account.brokerageProfileId;
  const [transactionSlots, listingSlots] = await Promise.all([
    loadSlotsForProfile(prisma, profileId, "transaction", txn.state),
    loadSlotsForProfile(prisma, profileId, "listing", txn.state),
  ]);

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
      suggestedRezenSlot: true,
      suggestedRezenConfidence: true,
    },
  });

  const showTransaction = txn.side !== "sell";
  const showListing = txn.side === "sell" || txn.side === "both";
  const cleanDocs = documents.map(
    ({ rawBytes: _r, mimeType: _m, ...d }) => d,
  );
  const reports: Array<{
    folder: string;
    report: ReturnType<typeof buildRezenPrepReport>;
  }> = [];
  if (showTransaction) {
    reports.push({
      folder: showListing ? "Transaction" : "",
      report: buildRezenPrepReport({
        side: txn.side,
        documents: cleanDocs,
        kind: "transaction",
        slots: transactionSlots,
      }),
    });
  }
  if (showListing) {
    reports.push({
      folder: showTransaction ? "Listing" : "",
      report: buildRezenPrepReport({
        side: txn.side,
        documents: cleanDocs,
        kind: "listing",
        slots: listingSlots,
      }),
    });
  }

  // Build the zip
  const zip = new JSZip();

  // Top-level human-readable report (drives any reviewer's eye to
  // what's missing without opening every PDF).
  const txtLines: string[] = [
    `Rezen Compliance Prep — ${txn.propertyAddress ?? "(no address)"}`,
    "",
  ];
  for (const { folder, report } of reports) {
    const heading =
      folder ||
      (report.kind === "listing" ? "LISTING" : "TRANSACTION");
    txtLines.push(`=== ${heading.toUpperCase()} CHECKLIST ===`);
    txtLines.push(
      `Coverage: ${report.presentCount}/${report.totalCount}  (${Math.round(
        report.coverage * 100,
      )}%) — ${report.requiredMissing} required missing`,
    );
    txtLines.push("");
    txtLines.push("PRESENT:");
    for (const i of report.items.filter((x) => x.status === "present")) {
      txtLines.push(
        `  ✓ ${i.rezenFilename ?? "(unfiled)"}  ←  ${i.matches[0]?.fileName ?? ""}`,
      );
    }
    txtLines.push("");
    txtLines.push("MISSING:");
    for (const i of report.items.filter((x) => x.status === "missing")) {
      const req = i.slot.required === "required" ? "[REQUIRED]" : "[if applic]";
      txtLines.push(`  ✗ ${req} ${i.slot.label}`);
    }
    txtLines.push("");
  }
  txtLines.push(`Generated ${new Date().toISOString()}`);
  zip.file("COMPLIANCE_REPORT.txt", txtLines.join("\n"));

  // Each present doc, renamed; folder-prefix when both checklists
  // are present so the user can drag each subfolder separately.
  const docsById = new Map(documents.map((d) => [d.id, d]));
  for (const { folder, report } of reports) {
    for (const item of report.items) {
      if (item.status !== "present") continue;
      const matchId = item.matches[0]?.id;
      if (!matchId) continue;
      const doc = docsById.get(matchId);
      if (!doc?.rawBytes || !item.rezenFilename) continue;
      const path = folder
        ? `${folder}/${item.rezenFilename}`
        : item.rezenFilename;
      zip.file(path, doc.rawBytes);
    }
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
