/**
 * POST /api/help — ask the AI Help assistant a question.
 * Body: { question: string }
 *
 * Logs every Q→A pair to HelpQuestion so the weekly Telegram
 * digest can surface "what users are stuck on" and we can patch
 * the knowledge base / build features accordingly.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import { askHelpAssistant } from "@/services/ai/HelpAssistantService";
import { logError } from "@/lib/log";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Coarse topic from the question text. Used to group similar
 * questions in the weekly digest. */
function inferTopic(q: string): string {
  const lower = q.toLowerCase();
  const map: Array<[RegExp, string]> = [
    [/\brezen|compliance|checklist/i, "rezen"],
    [/\bmilestone|deadline|timeline|date/i, "timeline"],
    [/\bearnest\s*money|em receipt/i, "earnest_money"],
    [/\binspection/i, "inspection"],
    [/\btitle\b/i, "title"],
    [/\blender|loan|financing/i, "lender"],
    [/\bemail|template|merge/i, "email"],
    [/\bcalendar|invite/i, "calendar"],
    [/\btelegram|atlas/i, "telegram"],
    [/\bsocial|instagram|facebook|linkedin/i, "social"],
    [/\blisting|convert/i, "listing"],
    [/\bdemo|sample|test data/i, "demo_data"],
    [/\bonboard|setup/i, "onboarding"],
    [/\bproduction|sources|funnel|roi|cac/i, "analytics"],
    [/\bscan|gmail/i, "scan"],
    [/\bvoice|whisper|dictat/i, "voice_intake"],
    [/\bbroker(age)?|profile/i, "brokerage"],
    [/\bsubscription|stripe|billing|pay/i, "billing"],
    [/\bsecurity|2fa|encrypt/i, "security"],
  ];
  for (const [re, topic] of map) {
    if (re.test(lower)) return topic;
  }
  return "general";
}

export async function POST(req: NextRequest) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  const body = (await req.json().catch(() => null)) as
    | { question?: string }
    | null;
  const q = body?.question?.trim();
  if (!q)
    return NextResponse.json({ error: "question required" }, { status: 400 });
  try {
    const reply = await askHelpAssistant(q);
    // Fire-and-forget log — don't block the response on an audit write
    void prisma.helpQuestion
      .create({
        data: {
          accountId: actor.accountId,
          userId: actor.userId,
          question: q.slice(0, 1000),
          answerText: reply.text.slice(0, 4000),
          topic: inferTopic(q),
        },
      })
      .catch(() => {});
    return NextResponse.json({ ok: true, ...reply });
  } catch (e) {
    logError(e, { route: "/api/help", userId: actor.userId });
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "help failed" },
      { status: 500 },
    );
  }
}
