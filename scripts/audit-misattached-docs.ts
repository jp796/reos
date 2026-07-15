/**
 * scripts/audit-misattached-docs.ts
 *
 * Audit (and optionally clean up) documents mis-attached by the pre-fix Gmail
 * auto-attach (sender-only matches from shared vendors/strangers, plus
 * signature-image junk). See DocAttachmentAudit.ts for the classifier.
 *
 * READ-ONLY by default. The delete pass removes ONLY docs classified
 * LIKELY-MIS-ATTACHED — never REVIEW, never LIKELY-CORRECT — and is triple-gated
 * (--delete AND --confirm AND env REOS_ALLOW_DELETE=1). Run it against a Neon
 * BRANCH first, never straight at prod.
 *
 * Reports:
 *   node --env-file=.env --import tsx scripts/audit-misattached-docs.ts --deal="Land Ct"
 *   node --env-file=.env --import tsx scripts/audit-misattached-docs.ts --deal="Land Ct" --out=cleanup-reports/land-ct
 *   node --env-file=.env --import tsx scripts/audit-misattached-docs.ts --all --summary --out=cleanup-reports/all
 *   ... --json                      # print the structured list to stdout
 *
 * Delete (branch only!):
 *   REOS_ALLOW_DELETE=1 DATABASE_URL="<branch-url>" \
 *     node --import tsx scripts/audit-misattached-docs.ts --deal="Land Ct" --delete --confirm --out=cleanup-reports/land-ct-delete
 *
 * Run against PROD read-only: point DATABASE_URL at the Neon connection string.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  classifyDocument,
  type AuditVerdict,
  type AuditResult,
} from "@/services/automation/DocAttachmentAudit";

interface Args {
  deal: string | null;
  all: boolean;
  account: string | null;
  json: boolean;
  summary: boolean;
  out: string | null;
  del: boolean;
  confirm: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (k: string) => {
    const hit = argv.find((a) => a === `--${k}` || a.startsWith(`--${k}=`));
    if (!hit) return null;
    const eq = hit.indexOf("=");
    return eq === -1 ? "" : hit.slice(eq + 1);
  };
  return {
    deal: get("deal"),
    all: argv.includes("--all"),
    account: get("account"),
    json: argv.includes("--json"),
    summary: argv.includes("--summary"),
    out: get("out"),
    del: argv.includes("--delete"),
    confirm: argv.includes("--confirm"),
  };
}

const VERDICT_ORDER: AuditVerdict[] = ["LIKELY-MIS-ATTACHED", "REVIEW", "LIKELY-CORRECT"];
const ICON: Record<AuditVerdict, string> = {
  "LIKELY-MIS-ATTACHED": "🚩",
  REVIEW: "❓",
  "LIKELY-CORRECT": "✅",
};

function fmtDate(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "—";
}

interface DocRow {
  id: string;
  fileName: string;
  mimeType: string;
  source: string;
  uploadOrigin: string | null;
  category: string | null;
  uploadedAt: Date;
  gmailMsgId: string | null;
  res: AuditResult;
}
interface DealReport {
  transactionId: string;
  propertyAddress: string | null;
  status: string;
  counts: { mis: number; review: number; correct: number };
  docs: DocRow[];
}

function csvCell(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function writeOut(prefix: string, kind: "detail" | "summary", payload: unknown, human: string, csv?: string) {
  mkdirSync(dirname(prefix) || ".", { recursive: true });
  writeFileSync(`${prefix}.json`, JSON.stringify(payload, null, 2));
  writeFileSync(`${prefix}.md`, human);
  if (csv) writeFileSync(`${prefix}.csv`, csv);
  const files = [`${prefix}.json`, `${prefix}.md`, ...(csv ? [`${prefix}.csv`] : [])];
  console.log(`\nSaved ${kind} report:\n  ${files.join("\n  ")}`);
}

function detailMarkdown(reports: DealReport[]): string {
  const lines: string[] = [];
  lines.push(`# Mis-attached document audit\n`);
  for (const r of reports) {
    lines.push(`## ${r.propertyAddress ?? "(no address)"}  [${r.status}]`);
    lines.push(`\`${r.transactionId}\` — ${r.docs.length} docs → 🚩 ${r.counts.mis} mis-attached · ❓ ${r.counts.review} review · ✅ ${r.counts.correct} correct\n`);
    for (const v of VERDICT_ORDER) {
      const group = r.docs.filter((d) => d.res.verdict === v);
      if (group.length === 0) continue;
      lines.push(`### ${ICON[v]} ${v} (${group.length})\n`);
      lines.push(`| File | Sender/match | uploadOrigin | MIME | Date | Reason |`);
      lines.push(`|---|---|---|---|---|---|`);
      for (const d of group) {
        lines.push(
          `| ${d.fileName.replace(/\|/g, "\\|")} | ${d.res.signal ?? d.source} | ${d.uploadOrigin ?? "—"} | ${d.mimeType} | ${fmtDate(d.uploadedAt)} | ${d.res.reasons.join("; ").replace(/\|/g, "\\|")} |`,
        );
      }
      lines.push("");
    }
  }
  return lines.join("\n");
}

function detailCsv(reports: DealReport[]): string {
  const rows = ["verdict,file_name,sender_match,upload_origin,mime_type,uploaded_at,category,doc_id,gmail_msg_id,reason"];
  for (const r of reports) {
    for (const d of r.docs) {
      rows.push(
        [
          d.res.verdict,
          d.fileName,
          d.res.signal ?? d.source,
          d.uploadOrigin ?? "",
          d.mimeType,
          fmtDate(d.uploadedAt),
          d.category ?? "",
          d.id,
          d.gmailMsgId ?? "",
          d.res.reasons.join("; "),
        ].map((c) => csvCell(String(c))).join(","),
      );
    }
  }
  return rows.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.deal && !args.all) {
    console.error('Specify a deal or --all. e.g. --deal="Land Ct"  |  --all [--summary]');
    process.exit(2);
  }

  const db = new PrismaClient();

  const txns = await db.transaction.findMany({
    where: {
      ...(args.account ? { accountId: args.account } : {}),
      ...(args.deal ? { propertyAddress: { contains: args.deal, mode: "insensitive" } } : {}),
    },
    select: {
      id: true,
      propertyAddress: true,
      status: true,
      accountId: true,
      documents: {
        orderBy: { uploadedAt: "asc" },
        select: {
          id: true, fileName: true, mimeType: true, source: true,
          uploadOrigin: true, category: true, sourceRef: true, uploadedAt: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  if (txns.length === 0) {
    console.error(args.deal ? `No transaction matched "${args.deal}".` : "No transactions found.");
    await db.$disconnect();
    process.exit(1);
  }

  // Classify everything.
  const reports: DealReport[] = txns.map((t) => {
    const docs: DocRow[] = t.documents.map((d) => ({
      id: d.id,
      fileName: d.fileName,
      mimeType: d.mimeType,
      source: d.source,
      uploadOrigin: d.uploadOrigin,
      category: d.category,
      uploadedAt: d.uploadedAt,
      gmailMsgId: d.sourceRef?.startsWith("gmail:") ? d.sourceRef.split(":")[1] : null,
      res: classifyDocument(d, { dealAddress: t.propertyAddress }),
    }));
    return {
      transactionId: t.id,
      propertyAddress: t.propertyAddress,
      status: t.status,
      counts: {
        mis: docs.filter((d) => d.res.verdict === "LIKELY-MIS-ATTACHED").length,
        review: docs.filter((d) => d.res.verdict === "REVIEW").length,
        correct: docs.filter((d) => d.res.verdict === "LIKELY-CORRECT").length,
      },
      docs,
    };
  });

  const totals = reports.reduce(
    (a, r) => ({
      docs: a.docs + r.docs.length,
      mis: a.mis + r.counts.mis,
      review: a.review + r.counts.review,
      correct: a.correct + r.counts.correct,
    }),
    { docs: 0, mis: 0, review: 0, correct: 0 },
  );

  // ---------- SUMMARY MODE ----------
  if (args.summary) {
    const perDeal = reports
      .map((r) => ({
        transactionId: r.transactionId,
        propertyAddress: r.propertyAddress,
        status: r.status,
        total: r.docs.length,
        ...r.counts,
      }))
      .sort((a, b) => b.mis - a.mis || b.total - a.total);

    console.log("\n" + "═".repeat(70));
    console.log(`ALL-DEALS SUMMARY — ${reports.length} deals, ${totals.docs} docs`);
    console.log(`  🚩 ${totals.mis} mis-attached · ❓ ${totals.review} review · ✅ ${totals.correct} correct`);
    console.log("─".repeat(70));
    console.log("Worst deals by mis-attached count:");
    for (const d of perDeal.filter((d) => d.mis > 0).slice(0, 25)) {
      console.log(`  🚩 ${String(d.mis).padStart(3)}  (${d.total} total)  ${d.propertyAddress ?? d.transactionId}`);
    }

    if (args.out) {
      const md = [
        `# Mis-attached audit — all deals\n`,
        `**${reports.length} deals · ${totals.docs} docs → 🚩 ${totals.mis} mis-attached · ❓ ${totals.review} review · ✅ ${totals.correct} correct**\n`,
        `| Mis | Review | Correct | Total | Deal | Status | txnId |`,
        `|---:|---:|---:|---:|---|---|---|`,
        ...perDeal.map(
          (d) => `| ${d.mis} | ${d.review} | ${d.correct} | ${d.total} | ${(d.propertyAddress ?? "").replace(/\|/g, "\\|")} | ${d.status} | \`${d.transactionId}\` |`,
        ),
      ].join("\n");
      writeOut(args.out, "summary", { totals, deals: perDeal }, md);
    }
    await db.$disconnect();
    return;
  }

  // ---------- JSON MODE ----------
  if (args.json && !args.out) {
    console.log(JSON.stringify(reports, null, 2));
    await db.$disconnect();
    return;
  }

  // ---------- PER-DOC REPORT ----------
  for (const r of reports) {
    console.log("\n" + "═".repeat(90));
    console.log(`DEAL: ${r.propertyAddress ?? "(no address)"}   [${r.status}]   ${r.transactionId}`);
    console.log(`  ${r.docs.length} docs → 🚩 ${r.counts.mis} mis-attached · ❓ ${r.counts.review} review · ✅ ${r.counts.correct} correct`);
    console.log("─".repeat(90));
    const sorted = [...r.docs].sort(
      (a, b) => VERDICT_ORDER.indexOf(a.res.verdict) - VERDICT_ORDER.indexOf(b.res.verdict),
    );
    for (const d of sorted) {
      console.log(`${ICON[d.res.verdict]} ${d.res.verdict.padEnd(19)} ${d.fileName}`);
      console.log(
        `      sender/match: ${d.res.signal ?? d.source}   origin: ${d.uploadOrigin ?? "—"}   mime: ${d.mimeType}   date: ${fmtDate(d.uploadedAt)}` +
          (d.gmailMsgId ? `   gmailMsgId: ${d.gmailMsgId}` : ""),
      );
      console.log(`      reason: ${d.res.reasons.join("; ")}`);
    }
  }
  console.log("\n" + "═".repeat(90));
  console.log(
    `TOTAL across ${reports.length} deal(s): ${totals.docs} docs → 🚩 ${totals.mis} mis-attached · ❓ ${totals.review} review · ✅ ${totals.correct} correct`,
  );

  if (args.out) {
    writeOut(args.out, "detail", reports, detailMarkdown(reports), detailCsv(reports));
  }

  // ---------- DELETE PASS (triple-gated, mis-attached only) ----------
  if (args.del) {
    const misIds = reports.flatMap((r) => r.docs.filter((d) => d.res.verdict === "LIKELY-MIS-ATTACHED").map((d) => d.id));
    const preservedIds = reports.flatMap((r) =>
      r.docs.filter((d) => d.res.verdict !== "LIKELY-MIS-ATTACHED").map((d) => d.id),
    );
    console.log("\n" + "━".repeat(90));
    console.log(`DELETE PASS — would remove ${misIds.length} LIKELY-MIS-ATTACHED doc(s); preserving ${preservedIds.length} (REVIEW + CORRECT).`);

    if (!args.confirm) {
      console.log("Refusing: pass --confirm to actually delete. (dry run)");
      await db.$disconnect();
      return;
    }
    if (process.env.REOS_ALLOW_DELETE !== "1") {
      console.log("Refusing: set REOS_ALLOW_DELETE=1 to enable deletion. (guardrail — use a Neon BRANCH, never prod)");
      await db.$disconnect();
      process.exit(3);
    }
    if (misIds.length === 0) {
      console.log("Nothing to delete.");
      await db.$disconnect();
      return;
    }

    // Safety invariant: never delete anything not classified mis-attached.
    const misSet = new Set(misIds);
    if (preservedIds.some((id) => misSet.has(id))) {
      console.error("ABORT: overlap between delete set and preserve set — refusing.");
      await db.$disconnect();
      process.exit(4);
    }

    const before = await db.document.count({ where: { id: { in: [...misIds, ...preservedIds] } } });
    const del = await db.document.deleteMany({ where: { id: { in: misIds } } });
    const afterPreserved = await db.document.count({ where: { id: { in: preservedIds } } });
    const afterMis = await db.document.count({ where: { id: { in: misIds } } });

    console.log(`Deleted: ${del.count}  (expected ${misIds.length})`);
    console.log(`Before total (mis+preserved): ${before}   After — mis remaining: ${afterMis}   preserved remaining: ${afterPreserved}/${preservedIds.length}`);
    console.log(
      afterMis === 0 && afterPreserved === preservedIds.length && del.count === misIds.length
        ? "✅ Exactly the mis-attached rows were removed; every REVIEW/CORRECT doc untouched."
        : "❌ Mismatch — investigate before touching prod.",
    );

    if (args.out) {
      const log = {
        deletedCount: del.count,
        expectedCount: misIds.length,
        deletedIds: misIds,
        preservedIds,
        afterMisRemaining: afterMis,
        afterPreservedRemaining: afterPreserved,
      };
      writeFileSync(`${args.out}.deletion.json`, JSON.stringify(log, null, 2));
      console.log(`\nSaved deletion log: ${args.out}.deletion.json`);
    }
  }

  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
