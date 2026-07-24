/**
 * RescanDealService — re-read the contract attached to a deal and rebuild
 * its timeline + tasks. Productizes the one-off North Ridge pipeline.
 *
 * Behavior (safe to re-run):
 *  - No contract on file → returns { noContract: true } with a clear ask.
 *  - Fills MISSING transaction dates/fields (never overwrites existing).
 *  - Adds milestones for dates that don't already have one (idempotent by label).
 *  - Generates the full TC task workflow only when the deal has 0 tasks.
 *  - Fills financials (sale price / commission) when missing.
 */

import type { PrismaClient } from "@prisma/client";
import { getDocumentBytes } from "@/services/storage/DocumentStorage";
import {
  ContractExtractionService,
  computeRelativeDeadlines,
} from "@/services/ai/ContractExtractionService";
import { env } from "@/lib/env";
import { buildDatesProvenance } from "@/services/core/extractionProvenance";

export interface RescanResult {
  noContract: boolean;
  summary: string;
  datesFilled: string[];
  milestonesAdded: number;
  tasksAdded: number;
}

const toDate = (v: unknown) =>
  typeof v === "string" && v ? new Date(`${v}T12:00:00Z`) : null;
const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

function none(summary: string): RescanResult {
  return { noContract: true, summary, datesFilled: [], milestonesAdded: 0, tasksAdded: 0 };
}

export async function rescanDeal(
  db: PrismaClient,
  accountId: string,
  transactionId: string,
): Promise<RescanResult> {
  const txn = await db.transaction.findFirst({
    where: { id: transactionId, accountId },
    select: {
      id: true, propertyAddress: true,
      contractDate: true, closingDate: true, possessionDate: true,
      earnestMoneyDueDate: true, inspectionDate: true, inspectionObjectionDate: true,
      financingDeadline: true, titleDeadline: true, titleObjectionDate: true,
      walkthroughDate: true, lenderName: true, titleCompanyName: true,
    },
  });
  if (!txn) return none("Deal not found.");
  const label = txn.propertyAddress ?? "this deal";

  // ── Find the contract document ──
  const docs = await db.document.findMany({
    where: { transactionId },
    select: { id: true, fileName: true },
    orderBy: { createdAt: "desc" },
  });
  if (docs.length === 0) {
    return none(`No contract is attached to ${label}. Upload the purchase contract and rescan, and I'll build the timeline + tasks.`);
  }
  const pick =
    docs.find((d) => /contract|offer|purchase|agreement/i.test(d.fileName)) ?? docs[0];
  const full = await db.document.findUnique({
    where: { id: pick.id },
    select: { rawBytes: true, gcsPath: true },
  });
  const docBytes = await getDocumentBytes(full);
  if (!docBytes) {
    return none(`The document on file (${pick.fileName}) has no stored file to scan — re-upload the contract and rescan.`);
  }

  // ── Re-extract ──
  if (!env.OPENAI_API_KEY) return none("Extraction isn't configured (no OpenAI key).");
  const svc = new ContractExtractionService(env.OPENAI_API_KEY);
  const ex = computeRelativeDeadlines(await svc.extract(docBytes));
  const f = ex as unknown as Record<string, { value: unknown } | undefined>;
  const v = (k: string) => f[k]?.value ?? null;

  // ── Fill MISSING transaction fields (don't overwrite user data) ──
  const fieldMap: Array<[keyof typeof txn, string, "date" | "str"]> = [
    ["contractDate", "effectiveDate", "date"],
    ["closingDate", "closingDate", "date"],
    ["possessionDate", "possessionDate", "date"],
    ["earnestMoneyDueDate", "earnestMoneyDueDate", "date"],
    ["inspectionDate", "inspectionDeadline", "date"],
    ["inspectionObjectionDate", "inspectionObjectionDeadline", "date"],
    ["financingDeadline", "financingDeadline", "date"],
    ["titleDeadline", "titleCommitmentDeadline", "date"],
    ["titleObjectionDate", "titleObjectionDeadline", "date"],
    ["walkthroughDate", "walkthroughDate", "date"],
    ["lenderName", "lenderName", "str"],
    ["titleCompanyName", "titleCompanyName", "str"],
  ];
  const update: Record<string, unknown> = {};
  const datesFilled: string[] = [];
  for (const [tf, ek, kind] of fieldMap) {
    if (txn[tf] != null) continue;
    const raw = v(ek);
    if (raw == null || raw === "") continue;
    update[tf as string] = kind === "date" ? toDate(raw) : String(raw);
    datesFilled.push(String(tf));
  }
  // Persist Atlas Trace provenance (per-date snippet + confidence) from this
  // fresh read — survives after pendingContractJson is cleared, so the timeline
  // badge works on every deal that's been re-synced.
  const prov = buildDatesProvenance(ex);
  if (prov) update.datesProvenanceJson = prov;

  if (Object.keys(update).length > 0) {
    await db.transaction.update({ where: { id: transactionId }, data: update });
  }

  // ── Financials (fill missing) ──
  const price = typeof v("purchasePrice") === "number" ? (v("purchasePrice") as number) : null;
  const commPct =
    (typeof v("sellerSideCommissionPct") === "number" ? (v("sellerSideCommissionPct") as number) : null) ??
    (typeof v("buyerSideCommissionPct") === "number" ? (v("buyerSideCommissionPct") as number) : null);
  if (price != null) {
    const fin = await db.transactionFinancials.findUnique({
      where: { transactionId }, select: { salePrice: true },
    });
    if (!fin) {
      await db.transactionFinancials.create({
        data: {
          transactionId, salePrice: price,
          commissionPercent: commPct ?? null,
          grossCommission: commPct != null ? Math.round(price * commPct) : null,
        },
      });
    } else if (fin.salePrice == null) {
      await db.transactionFinancials.update({
        where: { transactionId },
        data: { salePrice: price, commissionPercent: commPct ?? undefined },
      });
    }
  }

  // ── Milestones (idempotent by label) ──
  const existing = await db.milestone.findMany({
    where: { transactionId }, select: { label: true },
  });
  const have = new Set(existing.map((m) => m.label));
  const msDefs: Array<[string, string, unknown]> = [
    ["contract", "Effective Date", v("effectiveDate")],
    ["earnest_money", "Earnest Money Due", v("earnestMoneyDueDate")],
    ["inspection", "Inspection Deadline", v("inspectionDeadline")],
    ["inspection", "Inspection Objection Deadline", v("inspectionObjectionDeadline")],
    ["financing", "Financing Deadline", v("financingDeadline")],
    ["title", "Title Commitment Deadline", v("titleCommitmentDeadline")],
    ["title", "Title Objection Deadline", v("titleObjectionDeadline")],
    ["closing", "Closing Date", v("closingDate")],
    ["walkthrough", "Final Walkthrough", v("walkthroughDate")],
    ["possession", "Possession Date", v("possessionDate")],
  ];
  let milestonesAdded = 0;
  for (const [type, lbl, d] of msDefs) {
    const due = toDate(d);
    if (!due || have.has(lbl)) continue;
    await db.milestone.create({
      data: { transactionId, type, label: lbl, dueAt: due, source: "extracted", confidenceScore: 1 },
    });
    milestonesAdded++;
  }

  // ── Tasks (only when the deal has none) ──
  let tasksAdded = 0;
  const taskCount = await db.task.count({ where: { transactionId } });
  if (taskCount === 0) {
    const tasks = await generateTaskWorkflow(ex);
    for (const t of tasks) {
      await db.task.create({
        data: {
          transactionId, title: t.title,
          description: t.description ?? null,
          dueAt: t.dueDate ? toDate(t.dueDate) : null,
          priority: "normal",
        },
      });
      tasksAdded++;
    }
  }

  const parts: string[] = [];
  if (datesFilled.length) parts.push(`filled ${datesFilled.length} date(s)`);
  if (milestonesAdded) parts.push(`added ${milestonesAdded} milestone(s)`);
  if (tasksAdded) parts.push(`generated ${tasksAdded} task(s)`);
  if (price != null) parts.push(`sale price ${usd(price)}`);
  const summary = parts.length
    ? `Rescanned ${label} from ${pick.fileName}: ${parts.join(", ")}.`
    : `Rescanned ${label} from ${pick.fileName} — no gaps to fill, it was already current.`;
  return { noContract: false, summary, datesFilled, milestonesAdded, tasksAdded };
}

async function generateTaskWorkflow(
  ex: unknown,
): Promise<Array<{ title: string; dueDate?: string | null; description?: string }>> {
  const f = ex as Record<string, { value: unknown } | undefined>;
  const v = (k: string) => f[k]?.value ?? null;
  const payload = {
    dates: {
      effective: v("effectiveDate"), earnestMoneyDue: v("earnestMoneyDueDate"),
      inspection: v("inspectionDeadline"), inspectionObjection: v("inspectionObjectionDeadline"),
      financing: v("financingDeadline"), titleCommitment: v("titleCommitmentDeadline"),
      titleObjection: v("titleObjectionDeadline"), walkthrough: v("walkthroughDate"),
      closing: v("closingDate"), possession: v("possessionDate"),
    },
    parties: v("partyDetails"), agents: v("agents"), contingencies: v("contingencies"),
    financing: { purchasePrice: v("purchasePrice"), type: v("financingType") },
  };
  const prompt = `You are an expert buyer-side real-estate transaction coordinator. Produce the COMPLETE task list to coordinate this FINANCED residential purchase from contract to close — the full standard TC workflow, not only the extracted contingencies. Include when applicable: send executed contract to all parties; confirm earnest money; request + review the Property Disclosure; remind buyer for pre-qual letter + loan application; order/track appraisal; schedule + complete inspection; send inspection objection/notice; negotiate repairs; order + review title commitment; send title objection if needed; confirm insurance commitment; track financing to clear-to-close; review Closing Disclosure; confirm funds to close; schedule final walkthrough; coordinate closing; confirm possession. Anchor each to the actual dates and reference the actual parties/agents by name. Return JSON {"tasks":[{"title","dueDate","keyedTo","autoEmail","description"}]} (dueDate ISO or null). Aim for 18-24 tasks, ordered by due date.

CONTRACT DATA:
${JSON.stringify(payload, null, 2)}`;
  try {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        response_format: { type: "json_object" },
        max_tokens: 4000,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const data = (await resp.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? "{}");
    return Array.isArray(parsed.tasks) ? parsed.tasks : [];
  } catch {
    return [];
  }
}
