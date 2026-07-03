/**
 * TaskTemplateLearnService — task templates that EMERGE from history.
 *
 * Mines the account's CLOSED transactions, groups them by deal type
 * (side · cash-vs-financed · strategy · state), finds the tasks that
 * recur across most deals in each group, and synthesizes a reusable
 * TaskTemplate row per group (source="learned"). Those learned titles
 * are then fed into the AI task engine for new deals of the same type —
 * contract context still comes first; the learned titles augment it.
 *
 * Mirrors SmartFolderLearnService: minimum occurrence thresholds, and an
 * idempotent delete-then-recreate of the learned rows on each run.
 */

import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

const MIN_DEALS_PER_GROUP = 3;
const MIN_TITLE_SHARE = 0.4; // keep titles present in ≥40% of a group's deals
const KEY_PREFIX = "learnkey:";

type Side = "buy" | "sell";
type Financing = "cash" | "financed";

const STATE_NAMES: Record<string, string> = {
  wyoming: "WY", missouri: "MO", colorado: "CO", kansas: "KS", nebraska: "NE",
  oklahoma: "OK", arkansas: "AR", texas: "TX", montana: "MT", "south dakota": "SD",
  "north dakota": "ND", idaho: "ID", utah: "UT", nevada: "NV", arizona: "AZ",
};

function normSide(side: string | null | undefined): Side {
  const s = (side ?? "").toLowerCase();
  return s === "sell" || s === "listing" || s === "seller" ? "sell" : "buy";
}
function financingBucket(ft: string | null | undefined): Financing {
  return (ft ?? "").toLowerCase().includes("cash") ? "cash" : "financed";
}
function stateFromAddress(addr: string | null | undefined): string {
  if (!addr) return "";
  const m = addr.match(/,\s*([A-Za-z]{2})\s+\d{5}/);
  if (m) return m[1].toUpperCase();
  const low = addr.toLowerCase();
  for (const [name, ab] of Object.entries(STATE_NAMES)) if (low.includes(name)) return ab;
  return "";
}
function normTitle(t: string): string {
  return t.toLowerCase().replace(/\s+/g, " ").replace(/[.:;,]+$/, "").trim();
}
function groupKey(side: Side, fin: Financing, strategy: string, state: string): string {
  return `${side}|${fin}|${strategy || "any"}|${state || "any"}`;
}
function humanName(side: Side, fin: Financing, strategy: string, state: string): string {
  return ["Learned", side, fin, strategy !== "any" ? strategy : null, state !== "any" ? state : null]
    .filter(Boolean)
    .join(" · ");
}

interface LearnedItem { title: string; assignedTo: "coordinator" }

export interface LearnResult {
  scannedDeals: number;
  groups: number;
  templatesWritten: number;
  detail: Array<{ name: string; deals: number; tasks: number }>;
}

/**
 * Re-mine closed deals and rewrite the learned TaskTemplate rows.
 * Idempotent (deletes prior learned rows, recreates from current data).
 */
export async function learnTaskTemplates(
  db: PrismaClient,
  accountId: string,
): Promise<LearnResult> {
  const deals = await db.transaction.findMany({
    where: { accountId, status: "closed" },
    select: {
      side: true,
      propertyAddress: true,
      lenderName: true,
      asset: { select: { strategy: true } },
      tasks: { select: { title: true } },
    },
  });

  // Group deals by type; collect per-deal-unique task titles.
  const groups = new Map<
    string,
    { side: Side; fin: Financing; strategy: string; state: string; dealCount: number; titleCounts: Map<string, { count: number; display: string }> }
  >();

  for (const d of deals) {
    const side = normSide(d.side);
    const fin: Financing = d.lenderName ? "financed" : "cash";
    const strategy = d.asset?.strategy ?? "any";
    const state = stateFromAddress(d.propertyAddress);
    const key = groupKey(side, fin, strategy, state);
    let g = groups.get(key);
    if (!g) {
      g = { side, fin, strategy, state, dealCount: 0, titleCounts: new Map() };
      groups.set(key, g);
    }
    g.dealCount++;
    const seen = new Set<string>();
    for (const t of d.tasks) {
      const n = normTitle(t.title);
      if (!n || seen.has(n)) continue; // count each title once per deal
      seen.add(n);
      const tc = g.titleCounts.get(n) ?? { count: 0, display: t.title.trim() };
      tc.count++;
      g.titleCounts.set(n, tc);
    }
  }

  // Rewrite learned rows: delete then recreate.
  await db.taskTemplate.deleteMany({ where: { accountId, source: "learned" } });

  let written = 0;
  const detail: LearnResult["detail"] = [];
  for (const [key, g] of groups) {
    if (g.dealCount < MIN_DEALS_PER_GROUP) continue;
    const minCount = Math.max(2, Math.ceil(g.dealCount * MIN_TITLE_SHARE));
    const kept = [...g.titleCounts.values()]
      .filter((tc) => tc.count >= minCount)
      .sort((a, b) => b.count - a.count);
    if (kept.length === 0) continue;
    const items: LearnedItem[] = kept.map((tc) => ({ title: tc.display, assignedTo: "coordinator" }));
    const name = humanName(g.side, g.fin, g.strategy, g.state);
    await db.taskTemplate.create({
      data: {
        accountId,
        name,
        description: `${KEY_PREFIX}${key}`,
        source: "learned",
        itemsJson: items as unknown as Prisma.InputJsonValue,
      },
    });
    written++;
    detail.push({ name, deals: g.dealCount, tasks: items.length });
  }

  return { scannedDeals: deals.length, groups: groups.size, templatesWritten: written, detail };
}

/**
 * Learned task titles for a NEW deal of a given type — fed to the AI task
 * engine as "these recur on similar past deals." Progressive fallback:
 * exact strategy+state → strategy → side+financing.
 */
export async function learnedTitlesForDeal(
  accountId: string,
  opts: { side: string | null; strategy: string | null; financingType: string | null },
): Promise<string[]> {
  const side = normSide(opts.side);
  const fin = financingBucket(opts.financingType);
  const strat = opts.strategy || "any";

  const templates = await prisma.taskTemplate.findMany({
    where: { accountId, source: "learned" },
    select: { description: true, itemsJson: true },
  });
  if (templates.length === 0) return [];

  const prefixes = [
    `${KEY_PREFIX}${side}|${fin}|${strat}|`, // any state, this strategy
    `${KEY_PREFIX}${side}|${fin}|any|`,
    `${KEY_PREFIX}${side}|${fin}|`, // any strategy/state
  ];
  for (const pre of prefixes) {
    const hit = templates.find((t) => (t.description ?? "").startsWith(pre));
    if (hit) {
      const items = (hit.itemsJson as Array<{ title?: unknown }> | null) ?? [];
      return items.map((i) => String(i?.title ?? "")).filter(Boolean);
    }
  }
  return [];
}
