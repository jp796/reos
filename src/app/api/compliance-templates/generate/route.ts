/**
 * POST /api/compliance-templates/generate — "Generate with Atlas".
 *
 * Body: { prompt }  → DRAFT { name, items[] } document checklist, NOT
 * saved. Client reviews then POSTs to /api/compliance-templates.
 */

import { NextResponse, type NextRequest } from "next/server";
import { requireSession } from "@/lib/require-session";
import { normalizeComplianceItems } from "@/services/core/UserComplianceTemplates";
import { logError } from "@/lib/log";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = process.env.OPENAI_CHAT_MODEL ?? "gpt-4o-mini";

const SYSTEM = `You build COMPLIANCE DOCUMENT CHECKLISTS for a real estate transaction —
the documents a transaction coordinator must collect to close.
Return STRICT JSON: { "name": string, "items": Item[] }.
Item = {
  "key": string (snake_case id, e.g. "purchase_agreement"),
  "label": string (human name, e.g. "Fully Executed Purchase Agreement"),
  "keywords": string[] (terms found in a matching file's name/text, e.g. ["purchase agreement","contract"]),
  "sides": array subset of ["buy","sell","both"] (omit or ["both"] if it applies to either side),
  "detail": string (short why/when note, optional)
}
Rules:
- 8-16 items spanning the deal: executed contract, addenda, disclosures, earnest money receipt, title commitment, lender/loan docs, inspection, appraisal, insurance, closing disclosure / settlement statement, wire authorization.
- Strong keyword lists drive auto-matching against uploaded files — include common filename phrasings.
- Tailor to the workflow described (state, side, financing, HOA, etc.).
- Name the checklist after the workflow.`;

export async function POST(req: NextRequest) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  const key = process.env.OPENAI_API_KEY;
  if (!key) return NextResponse.json({ error: "AI not configured" }, { status: 400 });

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
        temperature: 0.3,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: prompt.slice(0, 500) },
        ],
      }),
    });
    if (!res.ok) return NextResponse.json({ error: `AI error ${res.status}` }, { status: 502 });
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = json.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw) as { name?: string; items?: unknown };
    const items = normalizeComplianceItems(parsed.items);
    if (items.length === 0) {
      return NextResponse.json({ error: "AI returned no usable items" }, { status: 502 });
    }
    return NextResponse.json({ ok: true, name: (parsed.name || prompt).slice(0, 120), items });
  } catch (e) {
    logError(e, { route: "POST /api/compliance-templates/generate", accountId: actor.accountId });
    return NextResponse.json({ error: "generation failed" }, { status: 500 });
  }
}
