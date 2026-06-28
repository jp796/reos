/**
 * DocumentSynthesisService — read the WHOLE document set on a deal and
 * synthesize the current state (not just the original contract).
 *
 * Stages:
 *  1. Classify + extract every attached PDF (GPT-4o direct PDF input).
 *  2. Baseline from the purchase contract (deep ContractExtraction).
 *  3. Merge: amendments override changed fields (newest effective date
 *     wins); inspection/title/etc. notices flip the contingency status
 *     (applies → objected → resolved/satisfied/waived). Doc categories
 *     are updated, and amended transaction dates are written back.
 *
 * Returns a synthesis report. Stage 4 (rebuild the dynamic timeline +
 * tasks from this merged state) consumes the report.
 */

import type { PrismaClient } from "@prisma/client";
import {
  ContractExtractionService,
  computeRelativeDeadlines,
} from "@/services/ai/ContractExtractionService";
import { env } from "@/lib/env";

export interface DocAnalysis {
  docId: string;
  fileName: string;
  docType: string;
  effectiveDate: string | null;
  amendsContract: boolean;
  fieldChanges: Record<string, unknown>;
  contingencyUpdates: Array<{
    name: string;
    status: string;
    date: string | null;
    detail?: string;
  }>;
  summary: string;
}

export interface SynthesizedContingency {
  name: string;
  status: string; // applies | objected | resolved | satisfied | waived | removed
  date: string | null;
  source: string; // "contract" or the amending doc's fileName
  description: string;
}

export interface SynthesisResult {
  transactionId: string;
  address: string;
  docCount: number;
  analyzedCount: number;
  docs: DocAnalysis[];
  mergedDates: Record<string, string | null>;
  contingencies: SynthesizedContingency[];
  changesApplied: string[];
  summary: string;
}

const ANALYZE_PROMPT = `You are a real-estate transaction analyst. Classify this document and extract anything that DEFINES or CHANGES the transaction state. Return ONLY JSON:
{
  "docType": "purchase_contract|addendum|amendment|inspection_objection_notice|inspection_resolution_notice|title_objection_notice|disclosure|loan_estimate|agency_agreement|post_occupancy_agreement|bill_of_sale|wire_fraud_notice|commission_disclosure|other",
  "effectiveDate": "YYYY-MM-DD or null",
  "amendsContract": true or false,
  "fieldChanges": { "closingDate":"YYYY-MM-DD|null", "possessionDate":"YYYY-MM-DD|null", "purchasePrice": number|null, "earnestMoney": number|null },
  "contingencyUpdates": [ { "name":"inspection|appraisal|financing|title|insurance", "status":"objected|satisfied|resolved|waived|removed", "date":"YYYY-MM-DD|null", "detail":"short" } ],
  "summary": "one sentence: what this document is and its effect on the deal"
}
Only include fieldChanges/contingencyUpdates that THIS specific document actually establishes; leave the rest null/empty. A purchase contract is the baseline (amendsContract=false). An addendum/amendment that changes a date or price sets amendsContract=true and the changed fields. An inspection contingency notice updates the inspection contingency status.`;

const TYPE_TO_CATEGORY: Record<string, string> = {
  purchase_contract: "contract",
  addendum: "addendum",
  amendment: "addendum",
  inspection_objection_notice: "inspection",
  inspection_resolution_notice: "inspection",
  title_objection_notice: "title",
  disclosure: "disclosure",
  loan_estimate: "financing",
  agency_agreement: "agency",
  post_occupancy_agreement: "possession",
  bill_of_sale: "closing",
  wire_fraud_notice: "other",
  commission_disclosure: "commission",
  other: "other",
};

async function analyzeDoc(
  docId: string,
  fileName: string,
  buffer: Buffer,
): Promise<DocAnalysis> {
  const fallback: DocAnalysis = {
    docId, fileName, docType: "other", effectiveDate: null,
    amendsContract: false, fieldChanges: {}, contingencyUpdates: [],
    summary: "(could not analyze)",
  };
  try {
    const b64 = buffer.toString("base64");
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        response_format: { type: "json_object" },
        max_tokens: 1500,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: ANALYZE_PROMPT },
              {
                type: "file",
                file: {
                  filename: fileName,
                  file_data: `data:application/pdf;base64,${b64}`,
                },
              },
            ],
          },
        ],
      }),
    });
    const data = (await resp.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    if (!resp.ok) return fallback;
    const p = JSON.parse(data.choices?.[0]?.message?.content ?? "{}");
    return {
      docId,
      fileName,
      docType: typeof p.docType === "string" ? p.docType : "other",
      effectiveDate: typeof p.effectiveDate === "string" ? p.effectiveDate : null,
      amendsContract: !!p.amendsContract,
      fieldChanges:
        p.fieldChanges && typeof p.fieldChanges === "object" ? p.fieldChanges : {},
      contingencyUpdates: Array.isArray(p.contingencyUpdates)
        ? p.contingencyUpdates
        : [],
      summary: typeof p.summary === "string" ? p.summary : "",
    };
  } catch {
    return fallback;
  }
}

const CONCURRENCY = 4;

export async function synthesizeDeal(
  db: PrismaClient,
  accountId: string,
  transactionId: string,
): Promise<SynthesisResult | null> {
  const txn = await db.transaction.findFirst({
    where: { id: transactionId, accountId },
    select: {
      id: true, propertyAddress: true, contractDate: true, closingDate: true,
      possessionDate: true,
    },
  });
  if (!txn) return null;

  const docRows = await db.document.findMany({
    where: { transactionId },
    select: { id: true, fileName: true },
    orderBy: { createdAt: "asc" },
  });

  // ── Stage 1: classify + extract every doc (capped concurrency) ──
  const analyses: DocAnalysis[] = [];
  for (let i = 0; i < docRows.length; i += CONCURRENCY) {
    const batch = docRows.slice(i, i + CONCURRENCY);
    const out = await Promise.all(
      batch.map(async (d) => {
        const full = await db.document.findUnique({
          where: { id: d.id },
          select: { rawBytes: true },
        });
        if (!full?.rawBytes) return null;
        return analyzeDoc(d.id, d.fileName, Buffer.from(full.rawBytes));
      }),
    );
    for (const a of out) if (a) analyses.push(a);
  }

  // Update each doc's category from its classification.
  for (const a of analyses) {
    await db.document
      .update({
        where: { id: a.docId },
        data: {
          category: TYPE_TO_CATEGORY[a.docType] ?? "other",
          classifiedAt: new Date(),
        },
      })
      .catch(() => {});
  }

  // ── Stage 2: baseline from the purchase contract ──
  const contractDoc = analyses.find((a) => a.docType === "purchase_contract");
  let baseline: Record<string, { value: unknown } | undefined> | null = null;
  if (contractDoc && env.OPENAI_API_KEY) {
    const full = await db.document.findUnique({
      where: { id: contractDoc.docId },
      select: { rawBytes: true },
    });
    if (full?.rawBytes) {
      const svc = new ContractExtractionService(env.OPENAI_API_KEY);
      baseline = computeRelativeDeadlines(
        await svc.extract(Buffer.from(full.rawBytes)),
      ) as unknown as Record<string, { value: unknown } | undefined>;
    }
  }
  const bv = (k: string) => (baseline?.[k]?.value ?? null) as string | null;

  // ── Stage 3a: merge dates (amendments override, newest wins) ──
  const mergedDates: Record<string, string | null> = {
    effectiveDate: bv("effectiveDate"),
    closingDate: bv("closingDate"),
    possessionDate: bv("possessionDate"),
    inspectionDeadline: bv("inspectionDeadline"),
    inspectionObjectionDeadline: bv("inspectionObjectionDeadline"),
    financingDeadline: bv("financingDeadline"),
    titleCommitmentDeadline: bv("titleCommitmentDeadline"),
    earnestMoneyDueDate: bv("earnestMoneyDueDate"),
  };
  const changesApplied: string[] = [];
  const amendments = analyses
    .filter((a) => a.amendsContract && a.fieldChanges)
    .sort((a, b) => (a.effectiveDate ?? "").localeCompare(b.effectiveDate ?? ""));
  for (const am of amendments) {
    for (const [k, v] of Object.entries(am.fieldChanges)) {
      if (v == null || v === "") continue;
      if (k in mergedDates && typeof v === "string" && mergedDates[k] !== v) {
        mergedDates[k] = v;
        changesApplied.push(`${k} → ${v} (per ${am.fileName})`);
      }
    }
  }

  // ── Stage 3b: contingency statuses (notices flip them) ──
  const baseConts =
    (baseline?.contingencies?.value as
      | Array<{ name: string; description?: string }>
      | undefined) ?? [];
  const contingencies: SynthesizedContingency[] = baseConts.map((c) => ({
    name: c.name,
    status: "applies",
    date: null,
    source: "contract",
    description: c.description ?? "",
  }));
  const allUpdates = analyses
    .flatMap((a) => a.contingencyUpdates.map((u) => ({ ...u, source: a.fileName })))
    // oldest → newest so the NEWEST notice is authoritative (applied last)
    .sort((x, y) => (x.date ?? "").localeCompare(y.date ?? ""));
  for (const u of allUpdates) {
    const key = (u.name ?? "").toLowerCase().trim();
    if (!key) continue;
    // Prefer a primary match (name starts with the key) over a broad
    // includes — so an "inspection" notice doesn't also flip "Roof
    // Inspection". Fall back to a non-roof includes, then create-new.
    const match =
      contingencies.find((c) => c.name.toLowerCase().startsWith(key)) ??
      contingencies.find(
        (c) =>
          c.name.toLowerCase().includes(key) &&
          !c.name.toLowerCase().includes("roof"),
      );
    if (match) {
      match.status = u.status || match.status;
      match.date = u.date ?? match.date;
      match.source = u.source;
    } else {
      contingencies.push({
        name: u.name,
        status: u.status || "applies",
        date: u.date ?? null,
        source: u.source,
        description: u.detail ?? "",
      });
    }
  }
  for (const c of contingencies) {
    if (c.status !== "applies") {
      changesApplied.push(
        `${c.name} → ${c.status}${c.date ? ` (${c.date})` : ""} (per ${c.source})`,
      );
    }
  }

  // ── Write back amended dates to the transaction ──
  const dateUpdate: Record<string, unknown> = {};
  const toDate = (v: string | null) =>
    v ? new Date(`${v}T12:00:00Z`) : null;
  if (mergedDates.effectiveDate) dateUpdate.contractDate = toDate(mergedDates.effectiveDate);
  if (mergedDates.closingDate) dateUpdate.closingDate = toDate(mergedDates.closingDate);
  if (mergedDates.possessionDate) dateUpdate.possessionDate = toDate(mergedDates.possessionDate);
  if (mergedDates.inspectionDeadline) dateUpdate.inspectionDate = toDate(mergedDates.inspectionDeadline);
  if (mergedDates.inspectionObjectionDeadline) dateUpdate.inspectionObjectionDate = toDate(mergedDates.inspectionObjectionDeadline);
  if (mergedDates.financingDeadline) dateUpdate.financingDeadline = toDate(mergedDates.financingDeadline);
  if (mergedDates.titleCommitmentDeadline) dateUpdate.titleDeadline = toDate(mergedDates.titleCommitmentDeadline);
  if (mergedDates.earnestMoneyDueDate) dateUpdate.earnestMoneyDueDate = toDate(mergedDates.earnestMoneyDueDate);
  if (Object.keys(dateUpdate).length > 0) {
    await db.transaction.update({ where: { id: transactionId }, data: dateUpdate });
  }

  const resolvedConts = contingencies.filter((c) => c.status !== "applies");
  const summary =
    `Read ${analyses.length}/${docRows.length} docs. ` +
    `${contingencies.length} contingencies (${resolvedConts.length} updated by notices/addenda). ` +
    `${changesApplied.length} change(s) merged into the deal.`;

  return {
    transactionId,
    address: txn.propertyAddress ?? "the deal",
    docCount: docRows.length,
    analyzedCount: analyses.length,
    docs: analyses,
    mergedDates,
    contingencies,
    changesApplied,
    summary,
  };
}
