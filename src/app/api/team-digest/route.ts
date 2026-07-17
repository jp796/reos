/**
 * POST /api/team-digest   (owner only)
 *   {}                       → generate this week's feature-spotlight draft
 *   { send:true, subject, body } → send it to the whole team (owner's click)
 *
 * Composes the weekly "get more out of REOS" email. Sending is always an
 * explicit owner action — never automated.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import { logError } from "@/lib/log";
import { sendAccountGmail } from "@/services/integrations/GmailSendService";
import { resolveAccountTeam } from "@/services/automation/TaskReminderService";
import { buildFeatureEmail } from "@/services/core/WeeklyFeatureEmail";

export const runtime = "nodejs";

const body = z.object({
  send: z.boolean().optional(),
  subject: z.string().trim().max(300).optional(),
  body: z.string().trim().max(20000).optional(),
});

export async function POST(req: NextRequest) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  if (actor.role !== "owner") return NextResponse.json({ error: "owner only" }, { status: 403 });

  const input = body.parse(await req.json().catch(() => ({})));
  const draft = buildFeatureEmail(new Date(), actor.name ?? "REOS");

  const team = await resolveAccountTeam(prisma, actor.accountId);
  const recipients = team.map((u) => u.email).filter((e) => e && e !== actor.email);

  if (!input.send) {
    return NextResponse.json({ ok: true, draft, recipientCount: recipients.length, recipients });
  }

  if (recipients.length === 0) {
    return NextResponse.json({ error: "No teammates to email yet." }, { status: 400 });
  }
  try {
    const sent = await sendAccountGmail({
      accountId: actor.accountId,
      fromEmail: actor.email,
      recipients,
      subject: input.subject?.trim() || draft.subject,
      text: input.body?.trim() || draft.body,
    });
    if (!sent) return NextResponse.json({ error: "Gmail not connected — connect it in Settings." }, { status: 400 });
    return NextResponse.json({ ok: true, sent: true, recipientCount: recipients.length });
  } catch (e) {
    logError(e, { route: "POST /api/team-digest", accountId: actor.accountId });
    return NextResponse.json({ error: "send failed" }, { status: 500 });
  }
}
