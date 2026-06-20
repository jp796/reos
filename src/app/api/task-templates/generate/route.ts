/**
 * POST /api/task-templates/generate — "Generate with Atlas".
 *
 * Body: { prompt: string }  (e.g. "buyer-side cash purchase in Texas")
 * Returns a DRAFT { name, items[] } — NOT saved. The client reviews /
 * edits, then POSTs to /api/task-templates to persist.
 */

import { NextResponse, type NextRequest } from "next/server";
import { requireSession } from "@/lib/require-session";
import { normalizeItems } from "@/services/core/UserTaskTemplates";
import { logError } from "@/lib/log";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = process.env.OPENAI_CHAT_MODEL ?? "gpt-4o-mini";

const MILESTONES = [
  "contract_effective",
  "earnest_money",
  "inspection",
  "inspection_objection",
  "title_commitment",
  "title_objection",
  "financing_approval",
  "walkthrough",
  "closing",
  "possession",
];

const SYSTEM = `You build transaction-coordinator TASK CHECKLISTS for a real estate deal.
Return STRICT JSON: { "name": string, "items": Item[] }.
Item = {
  "title": string (imperative, < 80 chars),
  "description": string (1 sentence, optional),
  "assignedTo": one of "coordinator" | "agent" | "client" | "lender" | "title" | "inspector",
  "priority": one of "low" | "normal" | "high" | "urgent",
  "relatesToMilestone": one of [${MILESTONES.join(", ")}] OR null,
  "offsetFromMilestoneDays": integer (positive = days BEFORE the milestone, negative = days AFTER) OR null,
  "sideFilter": "buy" | "sell" | "both" | null
}
Rules:
- 8-16 items covering the deal lifecycle (open escrow → earnest money → inspection → title → financing → walkthrough → closing → post-close).
- Tie time-sensitive tasks to a milestone via relatesToMilestone + offset so due dates derive automatically. Leave relatesToMilestone null for anytime tasks.
- Most tasks are assignedTo "coordinator". Use the real estate norms for the rest.
- Name the template after the workflow described.`;

export async function POST(req: NextRequest) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return NextResponse.json({ error: "AI not configured" }, { status: 400 });
  }
  let prompt = "";
  try {
    prompt = String(((await req.json()) as { prompt?: string }).prompt ?? "").trim();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  if (!prompt) return NextResponse.json({ error: "describe the workflow" }, { status: 400 });

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: MODEL,
        response_format: { type: "json_object" },
        temperature: 0.4,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: prompt.slice(0, 500) },
        ],
      }),
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `AI error ${res.status}` },
        { status: 502 },
      );
    }
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const raw = json.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw) as { name?: string; items?: unknown };
    const items = normalizeItems(parsed.items);
    if (items.length === 0) {
      return NextResponse.json({ error: "AI returned no usable tasks" }, { status: 502 });
    }
    return NextResponse.json({
      ok: true,
      name: (parsed.name || prompt).slice(0, 120),
      items,
    });
  } catch (e) {
    logError(e, { route: "POST /api/task-templates/generate", accountId: actor.accountId });
    return NextResponse.json({ error: "generation failed" }, { status: 500 });
  }
}
