/**
 * AtlasTools — the deterministic action layer for the Atlas agent.
 *
 * THE "NO MISTAKES" CONTRACT: the LLM can only act through these typed
 * tools. Each tool (1) validates its args with a strict schema, (2)
 * resolves + tenancy/visibility/role-checks the target deal, (3) calls
 * an existing deterministic engine, (4) writes an audit row, and (5)
 * returns the ACTUAL new state. A hallucinated value can't land, because
 * every write goes through validation + a real engine — never free text.
 *
 * Tiers drive the confirmation UX (the chat/Telegram layer reads these):
 *   read      → auto-run, no confirmation
 *   write     → reversible; confirm before executing
 *   sensitive → irreversible / outward-facing; double-confirm
 *
 * This module performs NO LLM calls and renders NO UI — it's the engine
 * the conversational layer drives. Pure-ish + unit-tested.
 */

import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { isDealVisible } from "@/lib/deal-visibility";
import { rescanDeal } from "@/services/core/RescanDealService";
import { synthesizeDeal } from "@/services/core/DocumentSynthesisService";
import { generateDealTasks } from "@/services/core/GenerateDealTasksService";
import { learnTaskTemplates } from "@/services/core/TaskTemplateLearnService";
import { gmailForAccount } from "@/services/integrations/gmailForAccount";
import { syncDealCalendar } from "@/services/core/syncDealCalendar";
import {
  draftReplyForDeal,
  draftNewEmailForDeal,
  DraftReplyError,
} from "@/services/core/draftEmailReply";
import { advanceStage, setStage } from "@/services/core/StageEngine";
import { stageByKey, getStrategyTemplate } from "@/services/core/strategyTemplates";
import type { Strategy } from "@/services/core/DealClassifierService";
import {
  createDealFromExtraction,
  type DealFields,
} from "@/services/core/createDealFromExtraction";

export type ToolTier = "read" | "write" | "sensitive";

export interface AtlasActor {
  userId: string;
  accountId: string;
  role: string;
}

export type ToolResult =
  | { ok: true; summary: string; data?: unknown }
  | { ok: false; error: string; reason?: "not_found" | "ambiguous" | "forbidden" | "invalid" };

interface ToolDef {
  tier: ToolTier;
  description: string;
  schema: z.ZodTypeAny;
  run: (db: PrismaClient, actor: AtlasActor, args: unknown) => Promise<ToolResult>;
}

// Map a friendly deadline kind → the Transaction date column it sets.
const DEADLINE_FIELDS: Record<string, string> = {
  contract: "contractDate",
  closing: "closingDate",
  possession: "possessionDate",
  inspection: "inspectionDate",
  inspection_objection: "inspectionObjectionDate",
  title_commitment: "titleDeadline",
  title_objection: "titleObjectionDate",
  financing: "financingDeadline",
  appraisal: "appraisalDate",
  walkthrough: "walkthroughDate",
  earnest_money: "earnestMoneyDueDate",
};

// ── Audit ─────────────────────────────────────────────────────────────
async function audit(
  db: PrismaClient,
  actor: AtlasActor,
  opts: {
    transactionId?: string | null;
    entityType: string;
    entityId?: string | null;
    action: string;
    decision: "applied" | "failed";
  },
) {
  await db.automationAuditLog.create({
    data: {
      accountId: actor.accountId,
      transactionId: opts.transactionId ?? null,
      entityType: opts.entityType,
      entityId: opts.entityId ?? null,
      ruleName: `atlas:${opts.action} (by ${actor.userId})`,
      actionType: opts.action.startsWith("complete") ? "update" : "create",
      sourceType: "manual",
      confidenceScore: 1.0,
      decision: opts.decision,
    },
  });
}

// ── Deal resolution (tenancy + visibility enforced) ───────────────────
interface ResolvedDeal {
  id: string;
  address: string | null;
  assetId: string | null;
  strategy: Strategy | null;
  currentStageName: string | null;
  restrictedToAssignee: boolean;
  assignedUserId: string | null;
}

/**
 * Resolve a deal by id or fuzzy address. Returns at most one — if the
 * query matches several open deals it returns an "ambiguous" miss so the
 * agent asks rather than guesses. Hidden deals are never returned.
 */
async function resolveDeal(
  db: PrismaClient,
  actor: AtlasActor,
  query: string,
): Promise<{ deal: ResolvedDeal } | { error: ToolResult }> {
  const q = query.trim();
  // Tokenize the query (drop tiny words + filler) and match a deal when
  // ALL significant tokens appear in its address or contact name — so
  // "3453 Willard" finds "3453 N Farm Road 83, Willard, MO".
  const STOP = new Set(["the", "at", "on", "for", "deal", "st", "rd", "ave", "dr"]);
  const tokens = q
    .toLowerCase()
    .split(/[\s,]+/)
    .filter((t) => t.length >= 2 && !STOP.has(t));
  const select = {
    id: true,
    propertyAddress: true,
    assetId: true,
    restrictedToAssignee: true,
    assignedUserId: true,
    status: true,
    contact: { select: { fullName: true } },
    asset: { select: { strategy: true, currentStageName: true } },
  } as const;

  const orTerms: Record<string, unknown>[] = [{ id: q }];
  const probe = tokens.length > 0 ? tokens : [q.toLowerCase()];
  for (const t of probe) {
    orTerms.push({ propertyAddress: { contains: t, mode: "insensitive" } });
    orTerms.push({ contact: { fullName: { contains: t, mode: "insensitive" } } });
  }

  const rows = await db.transaction.findMany({
    where: { accountId: actor.accountId, OR: orTerms },
    select,
    take: 25,
    orderBy: { updatedAt: "desc" },
  });

  const visible = rows.filter((r) =>
    isDealVisible(actor, {
      restrictedToAssignee: r.restrictedToAssignee,
      assignedUserId: r.assignedUserId,
    }),
  );
  if (visible.length === 0) {
    return { error: { ok: false, error: `No deal found matching "${q}".`, reason: "not_found" } };
  }

  // Exact id wins outright.
  const idHit = visible.find((r) => r.id === q);
  let pool = visible;
  if (!idHit) {
    // Score by how many query tokens appear in address + contact name;
    // keep the best-matching set.
    const scored = visible.map((r) => {
      const hay = `${r.propertyAddress ?? ""} ${r.contact?.fullName ?? ""}`.toLowerCase();
      return { r, matched: probe.filter((t) => hay.includes(t)).length };
    });
    const best = Math.max(...scored.map((s) => s.matched));
    pool = scored.filter((s) => s.matched === best).map((s) => s.r);
    // Prefer open deals within the best-matching set.
    const open = pool.filter((r) => !["closed", "dead"].includes(r.status));
    if (open.length > 0) pool = open;
  } else {
    pool = [idHit];
  }

  if (pool.length > 1) {
    const list = pool.slice(0, 5).map((r) => r.propertyAddress ?? r.id).join("; ");
    return {
      error: {
        ok: false,
        error: `"${q}" matches ${pool.length} deals: ${list}. Which one?`,
        reason: "ambiguous",
      },
    };
  }
  const r = pool[0];
  return {
    deal: {
      id: r.id,
      address: r.propertyAddress,
      assetId: r.assetId,
      strategy: (r.asset?.strategy as Strategy) ?? null,
      currentStageName: r.asset?.currentStageName ?? null,
      restrictedToAssignee: r.restrictedToAssignee,
      assignedUserId: r.assignedUserId,
    },
  };
}

// ── Tool registry ─────────────────────────────────────────────────────
export const ATLAS_TOOLS: Record<string, ToolDef> = {
  find_deal: {
    tier: "read",
    description:
      "Find a deal by address or contact name and return a status summary INCLUDING a completeness check — whether a contract document is attached, whether the contract/effective date is set, how many milestones/tasks exist, and an explicit list of what's missing. Use this before claiming a deal is complete; never say 'no missing data' without checking these signals.",
    schema: z.object({ deal: z.string().min(1) }),
    run: async (db, actor, args) => {
      const { deal } = args as { deal: string };
      const r = await resolveDeal(db, actor, deal);
      if ("error" in r) return r.error;
      const d = r.deal;
      const [open, totalTasks, milestones, docs, txn] = await Promise.all([
        db.task.count({ where: { transactionId: d.id, completedAt: null } }),
        db.task.count({ where: { transactionId: d.id } }),
        db.milestone.count({ where: { transactionId: d.id } }),
        db.document.count({ where: { transactionId: d.id } }),
        db.transaction.findUnique({
          where: { id: d.id },
          select: { contractDate: true, closingDate: true, status: true },
        }),
      ]);
      const missing: string[] = [];
      if (docs === 0) missing.push("no contract document attached (nothing to rescan)");
      if (!txn?.contractDate) missing.push("no contract/effective date");
      if (milestones <= 1) missing.push(`timeline not built (only ${milestones} milestone)`);
      if (totalTasks === 0) missing.push("no tasks generated");
      const verdict =
        missing.length > 0
          ? `INCOMPLETE — ${missing.join("; ")}.`
          : "Looks complete.";
      return {
        ok: true,
        summary: `${d.address ?? d.id} · ${d.strategy ?? "retail"} · ${txn?.status ?? "active"}${d.currentStageName ? ` · stage ${d.currentStageName}` : ""} · ${open}/${totalTasks} open tasks · ${milestones} milestone(s) · ${docs} contract doc(s). ${verdict}`,
        data: {
          id: d.id,
          assetId: d.assetId,
          strategy: d.strategy,
          stage: d.currentStageName,
          hasContract: docs > 0,
          milestones,
          tasks: totalTasks,
          contractDate: txn?.contractDate ?? null,
          missing,
        },
      };
    },
  },

  rescan_deal: {
    // Sensitive: re-extracts the contract and writes dates/milestones/tasks.
    tier: "sensitive",
    description:
      "Re-read the contract attached to a deal and rebuild its timeline (fill MISSING dates + add milestones) and generate the task list. Use whenever asked to rescan, re-check the contract, update or rebuild the timeline, or fill missing data on a deal. Only fills missing fields (never overwrites existing edits) and only generates tasks when the deal has none. If no contract is attached it says so and asks for an upload — do NOT claim a rescan happened in that case.",
    schema: z.object({ deal: z.string().min(1) }),
    run: async (db, actor, args) => {
      const { deal } = args as { deal: string };
      const r = await resolveDeal(db, actor, deal);
      if ("error" in r) return r.error;
      const res = await rescanDeal(db, actor.accountId, r.deal.id);
      await audit(db, actor, {
        transactionId: r.deal.id,
        entityType: "transaction",
        entityId: r.deal.id,
        action: "rescan_deal",
        decision: "applied",
      });
      return { ok: true, summary: res.summary, data: { ...res, transactionId: r.deal.id } };
    },
  },

  synthesize_deal: {
    // Sensitive: reads EVERY document on the deal (not just the contract),
    // merges amendments/notices, and rebuilds the current timeline + status.
    tier: "sensitive",
    description:
      "Read ALL documents on a deal together — contract plus every addendum, amendment, inspection notice, and disclosure — and rebuild the deal's CURRENT state: merged timeline dates, contingency statuses (e.g. inspection removed/resolved), and auto-completing the milestones/tasks those resolved contingencies cover. Use whenever asked what changed, what's current, to reconcile multiple documents, or after several files were uploaded. Unlike rescan (contract-only), this synthesizes the whole document set. Reuses cached per-document reads, so it's fast and consistent. Pass force only when explicitly asked to re-read everything from scratch.",
    schema: z.object({ deal: z.string().min(1), force: z.boolean().optional() }),
    run: async (db, actor, args) => {
      const { deal, force } = args as { deal: string; force?: boolean };
      const r = await resolveDeal(db, actor, deal);
      if ("error" in r) return r.error;
      const res = await synthesizeDeal(db, actor.accountId, r.deal.id, force ?? false);
      if (!res)
        return { ok: false, error: `Couldn't synthesize ${deal} — deal not found.`, reason: "not_found" };
      await audit(db, actor, {
        transactionId: r.deal.id,
        entityType: "transaction",
        entityId: r.deal.id,
        action: "synthesize_deal",
        decision: "applied",
      });
      return { ok: true, summary: res.summary, data: { ...res, transactionId: r.deal.id } };
    },
  },

  generate_tasks: {
    // Sensitive: writes new Task rows onto the deal.
    tier: "sensitive",
    description:
      "Generate an AI task list tailored to a deal from its actual terms — the real deadline dates, every contingency, the side represented, and cash-vs-financed — and add the new tasks to the deal (deduped against existing ones, so it's safe to re-run). Use when asked to build/generate/create a task list or checklist for a deal, or 'what do I need to do on this deal'. Smarter than a fixed template: it skips lender tasks on cash deals, anchors each task to the contract's dates, and adds a task for any unusual provision.",
    schema: z.object({ deal: z.string().min(1) }),
    run: async (db, actor, args) => {
      const { deal } = args as { deal: string };
      const r = await resolveDeal(db, actor, deal);
      if ("error" in r) return r.error;
      const res = await generateDealTasks(db, actor.accountId, r.deal.id);
      if (!res)
        return { ok: false, error: `Couldn't generate tasks for ${deal} — deal not found.`, reason: "not_found" };
      await audit(db, actor, {
        transactionId: r.deal.id,
        entityType: "transaction",
        entityId: r.deal.id,
        action: "generate_tasks",
        decision: "applied",
      });
      return { ok: true, summary: res.summary, data: { ...res, transactionId: r.deal.id } };
    },
  },

  learn_task_templates: {
    // Sensitive: rewrites the account's learned task templates.
    tier: "sensitive",
    description:
      "Learn reusable task templates from history — mine the account's CLOSED deals, group them by type (side, cash-vs-financed, strategy, state), find the tasks that recur across most deals of each type, and save them as learned templates that then augment the AI task list for new deals of the same type. Account-level (no specific deal). Use when asked to learn/refresh task templates from past deals, or 'build templates from my history'. Idempotent — safe to re-run.",
    schema: z.object({}),
    run: async (db, actor) => {
      const res = await learnTaskTemplates(db, actor.accountId);
      await audit(db, actor, {
        entityType: "account",
        entityId: actor.accountId,
        action: "learn_task_templates",
        decision: "applied",
      });
      const summary =
        res.templatesWritten > 0
          ? `Learned ${res.templatesWritten} template(s) from ${res.scannedDeals} closed deal(s): ${res.detail.map((d) => `${d.name} (${d.tasks} tasks)`).join(", ")}.`
          : `Scanned ${res.scannedDeals} closed deal(s) — not enough recurring history yet (need ≥3 similar deals).`;
      return { ok: true, summary, data: res };
    },
  },

  check_inbox: {
    tier: "read",
    description:
      "Check the connected Gmail inbox for recent (last 30 days) emails about a deal, by property address. Read-only — surfaces matching threads (subject, sender, date) so you can report what's new.",
    schema: z.object({ deal: z.string().min(1) }),
    run: async (db, actor, args) => {
      const { deal } = args as { deal: string };
      const r = await resolveDeal(db, actor, deal);
      if ("error" in r) return r.error;
      const d = r.deal;
      if (!d.address) {
        return { ok: true, summary: `No property address on ${deal} to search the inbox with.` };
      }
      const gmail = await gmailForAccount(db, actor.accountId);
      if (!gmail) {
        return {
          ok: true,
          summary:
            "Gmail isn't connected for this workspace — connect it in Settings → Integrations and I can scan the inbox.",
        };
      }
      const term = `"${d.address.replace(/["\\]/g, "")}"`;
      const q = `newer_than:30d (${term})`;
      let threads;
      try {
        ({ threads } = await gmail.searchThreadsPaged({ q, maxTotal: 8 }));
      } catch {
        return { ok: false, error: "Couldn't reach Gmail just now — try again shortly.", reason: "invalid" };
      }
      if (!threads || threads.length === 0) {
        return {
          ok: true,
          summary: `No inbox emails in the last 30 days mentioning ${d.address}.`,
          data: { threads: [] },
        };
      }
      const items = threads.map((t) => {
        const first = t.messages?.[0];
        const hdr = (n: string) =>
          first?.payload?.headers?.find((x) => x.name?.toLowerCase() === n)?.value ?? "";
        return {
          subject: (hdr("subject") || "(no subject)").slice(0, 160),
          from: hdr("from").slice(0, 120),
          date: hdr("date") || null,
          snippet: t.snippet?.slice(0, 160) ?? null,
          url: `https://mail.google.com/mail/u/0/#inbox/${t.id ?? ""}`,
        };
      });
      const summary =
        `Found ${items.length} recent email(s) for ${d.address}:\n` +
        items.map((i, n) => `${n + 1}. "${i.subject}" — ${i.from}`).join("\n");
      return { ok: true, summary, data: { threads: items } };
    },
  },

  sync_calendar: {
    // Sensitive: writes events to the user's external Google Calendar.
    tier: "sensitive",
    description:
      "Add the deal's milestone timeline to the connected Google Calendar (one event per dated milestone). Idempotent — already-created events are skipped.",
    schema: z.object({ deal: z.string().min(1) }),
    run: async (db, actor, args) => {
      const { deal } = args as { deal: string };
      const r = await resolveDeal(db, actor, deal);
      if ("error" in r) return r.error;
      const d = r.deal;
      const res = await syncDealCalendar(db, actor.accountId, d.id);
      if (!res.connected) {
        return {
          ok: true,
          summary:
            "Google Calendar isn't connected — connect it in Settings → Integrations and I can add the timeline.",
        };
      }
      await audit(db, actor, {
        transactionId: d.id,
        entityType: "transaction",
        entityId: d.id,
        action: "sync_calendar",
        decision: "applied",
      });
      return {
        ok: true,
        summary: `Added ${res.created} event(s) to your calendar for ${d.address ?? deal}${res.alreadyLinked ? `, ${res.alreadyLinked} already there` : ""}.`,
        data: { created: res.created, alreadyLinked: res.alreadyLinked },
      };
    },
  },

  draft_reply: {
    // Write: saves a Gmail draft on the user's account (never sends).
    tier: "write",
    description:
      "Draft an AI reply to the most recent inbound email on a deal and SAVE it as a Gmail draft (never sends — the user reviews + sends in Gmail).",
    schema: z.object({ deal: z.string().min(1) }),
    run: async (db, actor, args) => {
      const { deal } = args as { deal: string };
      const r = await resolveDeal(db, actor, deal);
      if ("error" in r) return r.error;
      const d = r.deal;
      const u = await db.user.findUnique({
        where: { id: actor.userId },
        select: { email: true },
      });
      if (!u?.email) {
        return { ok: false, error: "Couldn't resolve your email.", reason: "invalid" };
      }
      try {
        const res = await draftReplyForDeal(db, { accountId: actor.accountId, email: u.email }, d.id);
        await audit(db, actor, {
          transactionId: d.id,
          entityType: "email_draft",
          entityId: res.draftId,
          action: "draft_reply",
          decision: "applied",
        });
        return {
          ok: true,
          summary: `Drafted a reply to ${res.to} ("${res.subject}") on ${d.address ?? deal} — review + send in Gmail.`,
          data: { draftId: res.draftId },
        };
      } catch (e) {
        if (e instanceof DraftReplyError) {
          return { ok: false, error: e.message, reason: "invalid" };
        }
        throw e;
      }
    },
  },

  draft_email: {
    // Write: composes a NEW email + saves a Gmail draft (never sends).
    tier: "write",
    description:
      "Compose a NEW email for a deal to a party (by role, name, or email address) about a topic, and SAVE it as a Gmail draft (never sends). Use for fresh emails like EMD instructions or a status update; use draft_reply to answer an inbound email.",
    schema: z.object({
      deal: z.string().min(1),
      to: z.string().min(1),
      about: z.string().min(1),
    }),
    run: async (db, actor, args) => {
      const { deal, to, about } = args as { deal: string; to: string; about: string };
      const r = await resolveDeal(db, actor, deal);
      if ("error" in r) return r.error;
      const d = r.deal;
      const u = await db.user.findUnique({
        where: { id: actor.userId },
        select: { email: true },
      });
      if (!u?.email) {
        return { ok: false, error: "Couldn't resolve your email.", reason: "invalid" };
      }
      try {
        const res = await draftNewEmailForDeal(
          db,
          { accountId: actor.accountId, email: u.email },
          d.id,
          { to, about },
        );
        await audit(db, actor, {
          transactionId: d.id,
          entityType: "email_draft",
          entityId: res.draftId,
          action: "draft_email",
          decision: "applied",
        });
        return {
          ok: true,
          summary: `Drafted an email to ${res.to} ("${res.subject}") on ${d.address ?? deal} — review + send in Gmail.`,
          data: { draftId: res.draftId },
        };
      } catch (e) {
        if (e instanceof DraftReplyError) {
          return { ok: false, error: e.message, reason: "invalid" };
        }
        throw e;
      }
    },
  },

  add_task: {
    tier: "write",
    description: "Add a task to a deal. Optional due date (YYYY-MM-DD) and assignee role.",
    schema: z.object({
      deal: z.string().min(1),
      title: z.string().min(1).max(200),
      dueDate: z.string().optional(),
      priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
    }),
    run: async (db, actor, args) => {
      const a = args as { deal: string; title: string; dueDate?: string; priority?: string };
      const r = await resolveDeal(db, actor, a.deal);
      if ("error" in r) return r.error;
      const due = a.dueDate ? new Date(a.dueDate) : null;
      if (a.dueDate && Number.isNaN(due!.getTime())) {
        return { ok: false, error: `Invalid due date "${a.dueDate}".`, reason: "invalid" };
      }
      const task = await db.task.create({
        data: {
          transactionId: r.deal.id,
          title: a.title,
          dueAt: due,
          priority: a.priority ?? "normal",
        },
      });
      await audit(db, actor, { transactionId: r.deal.id, entityType: "task", entityId: task.id, action: "add_task", decision: "applied" });
      return { ok: true, summary: `Added task "${a.title}"${due ? ` due ${a.dueDate}` : ""} to ${r.deal.address}.`, data: { taskId: task.id } };
    },
  },

  complete_task: {
    tier: "write",
    description: "Mark a task complete on a deal, matched by title.",
    schema: z.object({ deal: z.string().min(1), title: z.string().min(1) }),
    run: async (db, actor, args) => {
      const a = args as { deal: string; title: string };
      const r = await resolveDeal(db, actor, a.deal);
      if ("error" in r) return r.error;
      const matches = await db.task.findMany({
        where: { transactionId: r.deal.id, completedAt: null, title: { contains: a.title, mode: "insensitive" } },
        select: { id: true, title: true },
        take: 5,
      });
      if (matches.length === 0) return { ok: false, error: `No open task matching "${a.title}".`, reason: "not_found" };
      if (matches.length > 1) {
        return { ok: false, error: `"${a.title}" matches ${matches.length} tasks: ${matches.map((m) => m.title).join("; ")}. Be specific.`, reason: "ambiguous" };
      }
      await db.task.update({ where: { id: matches[0].id }, data: { completedAt: new Date() } });
      await audit(db, actor, { transactionId: r.deal.id, entityType: "task", entityId: matches[0].id, action: "complete_task", decision: "applied" });
      return { ok: true, summary: `Completed "${matches[0].title}" on ${r.deal.address}.` };
    },
  },

  set_deadline: {
    tier: "write",
    description: `Set a deadline/date on a deal. kind is one of: ${Object.keys(DEADLINE_FIELDS).join(", ")}. date is YYYY-MM-DD.`,
    schema: z.object({
      deal: z.string().min(1),
      kind: z.enum(Object.keys(DEADLINE_FIELDS) as [string, ...string[]]),
      date: z.string().min(1),
    }),
    run: async (db, actor, args) => {
      const a = args as { deal: string; kind: string; date: string };
      const r = await resolveDeal(db, actor, a.deal);
      if ("error" in r) return r.error;
      const field = DEADLINE_FIELDS[a.kind];
      const d = new Date(a.date);
      if (Number.isNaN(d.getTime())) return { ok: false, error: `Invalid date "${a.date}".`, reason: "invalid" };
      await db.transaction.update({ where: { id: r.deal.id }, data: { [field]: d } });
      await audit(db, actor, { transactionId: r.deal.id, entityType: "transaction", entityId: r.deal.id, action: "set_deadline", decision: "applied" });
      return { ok: true, summary: `Set ${a.kind.replace(/_/g, " ")} = ${a.date} on ${r.deal.address}.` };
    },
  },

  advance_stage: {
    tier: "write",
    description: "Advance an investor deal to the next stage of its lifecycle (seeds that stage's tasks).",
    schema: z.object({ deal: z.string().min(1) }),
    run: async (db, actor, args) => {
      const a = args as { deal: string };
      const r = await resolveDeal(db, actor, a.deal);
      if ("error" in r) return r.error;
      if (!r.deal.assetId || !r.deal.strategy) return { ok: false, error: `${r.deal.address} isn't an investor deal.`, reason: "invalid" };
      const res = await advanceStage(db, { assetId: r.deal.assetId });
      await audit(db, actor, { transactionId: r.deal.id, entityType: "transaction", entityId: r.deal.assetId, action: "advance_stage", decision: "applied" });
      if (res.done) return { ok: true, summary: `${r.deal.address} is already at the final stage.` };
      return { ok: true, summary: `Advanced ${r.deal.address} → ${res.to} · ${res.created} task(s) added.` };
    },
  },

  set_stage: {
    tier: "write",
    description: "Move an investor deal to a specific stage (by stage name or key).",
    schema: z.object({ deal: z.string().min(1), stage: z.string().min(1) }),
    run: async (db, actor, args) => {
      const a = args as { deal: string; stage: string };
      const r = await resolveDeal(db, actor, a.deal);
      if ("error" in r) return r.error;
      if (!r.deal.assetId || !r.deal.strategy) return { ok: false, error: `${r.deal.address} isn't an investor deal.`, reason: "invalid" };
      // Match the stage by key, else by case-insensitive name contains.
      const stages = getStrategyTemplate(r.deal.strategy);
      const hit =
        stageByKey(r.deal.strategy, a.stage) ??
        stages.find((s) => s.name.toLowerCase().includes(a.stage.toLowerCase()));
      if (!hit) {
        return { ok: false, error: `No stage "${a.stage}" for ${r.deal.strategy}. Stages: ${stages.map((s) => s.name).join(", ")}.`, reason: "not_found" };
      }
      const res = await setStage(db, { assetId: r.deal.assetId, stageKey: hit.key });
      if (!res.ok) return { ok: false, error: `Couldn't move ${r.deal.address} to ${hit.name}.`, reason: "invalid" };
      await audit(db, actor, { transactionId: r.deal.id, entityType: "transaction", entityId: r.deal.assetId, action: "set_stage", decision: "applied" });
      return { ok: true, summary: `Moved ${r.deal.address} → ${hit.name} · ${res.created} task(s) added.` };
    },
  },

  add_note: {
    tier: "write",
    description: "Add a note to a deal's log.",
    schema: z.object({ deal: z.string().min(1), body: z.string().min(1).max(2000) }),
    run: async (db, actor, args) => {
      const a = args as { deal: string; body: string };
      const r = await resolveDeal(db, actor, a.deal);
      if ("error" in r) return r.error;
      const note = await db.transactionNote.create({
        data: { transactionId: r.deal.id, authorUserId: actor.userId, body: a.body },
      });
      await audit(db, actor, { transactionId: r.deal.id, entityType: "transaction", entityId: note.id, action: "add_note", decision: "applied" });
      return { ok: true, summary: `Noted on ${r.deal.address}: "${a.body.slice(0, 80)}".` };
    },
  },

  create_deal: {
    // Sensitive: creating a deal is significant — always confirmed. The
    // Telegram upload flow extracts a contract, then proposes this with
    // the extracted fields; "yes" runs it.
    tier: "sensitive",
    description: "Create a new deal from extracted/entered fields. Requires at least an address.",
    schema: z.object({ address: z.string().min(1) }).passthrough(),
    run: async (db, actor, args) => {
      const fields = args as DealFields;
      const r = await createDealFromExtraction(
        db,
        { accountId: actor.accountId, actingUserId: actor.userId },
        fields,
      );
      await audit(db, actor, {
        transactionId: r.transactionId,
        entityType: "transaction",
        entityId: r.transactionId,
        action: "create_deal",
        decision: "applied",
      });
      const verb = r.created ? "Created" : "Found existing";
      return {
        ok: true,
        summary: `${verb} ${r.strategy} deal at ${fields.address} (${r.milestonesCreated} milestone(s)). Open: /transactions/${r.transactionId}`,
        data: { transactionId: r.transactionId, assetId: r.assetId, created: r.created },
      };
    },
  },
};

// ── Public surface ────────────────────────────────────────────────────

export function toolNames(): string[] {
  return Object.keys(ATLAS_TOOLS);
}

/** Tier lookup; unknown tools are treated as sensitive (deny-by-default). */
export function toolTier(name: string): ToolTier {
  return ATLAS_TOOLS[name]?.tier ?? "sensitive";
}

/** A write/sensitive tool must be confirmed before it runs. */
export function requiresConfirmation(name: string): boolean {
  return toolTier(name) !== "read";
}

/** Human-readable one-liner for a proposed action (the confirmation
 *  prompt shown before a write runs). */
export function previewAction(name: string, args: Record<string, unknown>): string {
  const deal = String(args.deal ?? "the deal");
  switch (name) {
    case "add_task":
      return `Add task "${args.title}"${args.dueDate ? ` (due ${args.dueDate})` : ""} to ${deal}`;
    case "complete_task":
      return `Complete task "${args.title}" on ${deal}`;
    case "set_deadline":
      return `Set ${String(args.kind).replace(/_/g, " ")} = ${args.date} on ${deal}`;
    case "advance_stage":
      return `Advance ${deal} to the next stage`;
    case "set_stage":
      return `Move ${deal} to stage "${args.stage}"`;
    case "add_note":
      return `Add note to ${deal}: "${String(args.body).slice(0, 60)}"`;
    case "sync_calendar":
      return `Add ${deal}'s timeline to your Google Calendar`;
    case "draft_reply":
      return `Draft a Gmail reply to the latest email on ${deal} (saved as a draft)`;
    case "draft_email":
      return `Draft an email to ${args.to} about "${String(args.about).slice(0, 50)}" on ${deal} (saved as a Gmail draft)`;
    case "create_deal":
      return `Create deal at ${args.address}${args.purchasePrice ? ` ($${Number(args.purchasePrice).toLocaleString()})` : ""}`;
    case "rescan_deal":
      return `Rescan the contract on ${deal} and rebuild its timeline + tasks`;
    case "synthesize_deal":
      return `Read all documents on ${deal} and rebuild its current timeline + contingency status`;
    case "generate_tasks":
      return `Generate an AI task list for ${deal} from its contract terms`;
    case "learn_task_templates":
      return `Learn reusable task templates from your closed deals`;
    default:
      return `${name} ${JSON.stringify(args)}`;
  }
}

// Explicit JSON-schema params so the model knows exactly what each tool
// takes. Args are STILL re-validated by the zod schema in executeTool —
// this is the model's guide, the zod schema is the gate.
const PARAM_SCHEMAS: Record<string, Record<string, unknown>> = {
  find_deal: {
    type: "object",
    required: ["deal"],
    properties: { deal: { type: "string", description: "property address or contact name" } },
  },
  check_inbox: {
    type: "object",
    required: ["deal"],
    properties: { deal: { type: "string", description: "property address or contact name" } },
  },
  rescan_deal: {
    type: "object",
    required: ["deal"],
    properties: { deal: { type: "string", description: "property address or contact name" } },
  },
  synthesize_deal: {
    type: "object",
    required: ["deal"],
    properties: {
      deal: { type: "string", description: "property address or contact name" },
      force: {
        type: "boolean",
        description: "re-read every document from scratch (ignore cache); only when explicitly asked",
      },
    },
  },
  learn_task_templates: {
    type: "object",
    properties: {},
  },
  generate_tasks: {
    type: "object",
    required: ["deal"],
    properties: { deal: { type: "string", description: "property address or contact name" } },
  },
  sync_calendar: {
    type: "object",
    required: ["deal"],
    properties: { deal: { type: "string", description: "property address or contact name" } },
  },
  draft_reply: {
    type: "object",
    required: ["deal"],
    properties: { deal: { type: "string", description: "property address or contact name" } },
  },
  draft_email: {
    type: "object",
    required: ["deal", "to", "about"],
    properties: {
      deal: { type: "string", description: "property address or contact name" },
      to: { type: "string", description: "recipient: a party role (buyer/seller/title/lender), a name, or an email address" },
      about: { type: "string", description: "what the email should say / its purpose" },
    },
  },
  add_task: {
    type: "object",
    required: ["deal", "title"],
    properties: {
      deal: { type: "string", description: "address or contact name" },
      title: { type: "string" },
      dueDate: { type: "string", description: "YYYY-MM-DD" },
      priority: { type: "string", enum: ["low", "normal", "high", "urgent"] },
    },
  },
  complete_task: {
    type: "object",
    required: ["deal", "title"],
    properties: {
      deal: { type: "string" },
      title: { type: "string", description: "task title or a distinctive part of it" },
    },
  },
  set_deadline: {
    type: "object",
    required: ["deal", "kind", "date"],
    properties: {
      deal: { type: "string" },
      kind: { type: "string", enum: Object.keys(DEADLINE_FIELDS) },
      date: { type: "string", description: "YYYY-MM-DD" },
    },
  },
  advance_stage: {
    type: "object",
    required: ["deal"],
    properties: { deal: { type: "string" } },
  },
  set_stage: {
    type: "object",
    required: ["deal", "stage"],
    properties: {
      deal: { type: "string" },
      stage: { type: "string", description: "stage name or key (e.g. 'Rehab')" },
    },
  },
  add_note: {
    type: "object",
    required: ["deal", "body"],
    properties: { deal: { type: "string" }, body: { type: "string" } },
  },
  create_deal: {
    type: "object",
    required: ["address"],
    properties: {
      address: { type: "string" },
      buyerName: { type: "string" },
      sellerName: { type: "string" },
      purchasePrice: { type: "number" },
      closingDate: { type: "string", description: "YYYY-MM-DD" },
    },
  },
};

/** OpenAI function-calling specs for the conversational layer. */
export function openAiToolSpecs(): Array<{
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}> {
  return Object.entries(ATLAS_TOOLS).map(([name, def]) => ({
    type: "function",
    function: {
      name,
      description: def.description,
      parameters: PARAM_SCHEMAS[name] ?? { type: "object", additionalProperties: true },
    },
  }));
}

/**
 * Execute a tool by name with raw args. Validates args, runs the
 * deterministic executor (which enforces tenancy/visibility + audits),
 * and never throws into the caller — failures come back as ToolResult.
 */
export async function executeTool(
  db: PrismaClient,
  actor: AtlasActor,
  name: string,
  rawArgs: unknown,
): Promise<ToolResult> {
  const def = ATLAS_TOOLS[name];
  if (!def) return { ok: false, error: `Unknown tool "${name}".`, reason: "invalid" };
  const parsed = def.schema.safeParse(rawArgs);
  if (!parsed.success) {
    return { ok: false, error: `Invalid arguments for ${name}: ${parsed.error.issues.map((i) => i.message).join("; ")}`, reason: "invalid" };
  }
  try {
    return await def.run(db, actor, parsed.data);
  } catch (e) {
    try {
      await audit(db, actor, { entityType: "transaction", action: name, decision: "failed" });
    } catch {
      /* audit best-effort */
    }
    return { ok: false, error: e instanceof Error ? e.message : "tool failed" };
  }
}
