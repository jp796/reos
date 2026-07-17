/**
 * POST /api/private-money/partners/[id]/update-email
 *   {}                      → generate the draft (subject + body) for review
 *   { send:true, subject, body } → send it to the partner (user's explicit action)
 *
 * The email always originates from a user click — REOS never sends a partner
 * update on its own.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import { logError } from "@/lib/log";
import { sendAccountGmail } from "@/services/integrations/GmailSendService";
import { buildPartnerUpdateDraft } from "@/services/core/PartnerUpdateEmail";

export const runtime = "nodejs";

const body = z.object({
  send: z.boolean().optional(),
  subject: z.string().trim().max(300).optional(),
  body: z.string().trim().max(20000).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  const { id } = await params;

  const partner = await prisma.privateMoneyPartner.findFirst({
    where: { id, accountId: actor.accountId },
    include: {
      fundings: {
        include: {
          transaction: { select: { propertyAddress: true, status: true, closingDate: true } },
        },
      },
    },
  });
  if (!partner) return NextResponse.json({ error: "not found" }, { status: 404 });

  const input = body.parse(await req.json().catch(() => ({})));
  const deals = partner.fundings.map((f) => ({
    property: f.transaction.propertyAddress ?? "(no address)",
    status: f.transaction.status,
    closingDate: f.transaction.closingDate,
    amount: f.amount,
  }));
  const draft = buildPartnerUpdateDraft({ name: partner.name }, deals, actor.name ?? "House Needs Love");

  if (!input.send) {
    return NextResponse.json({ ok: true, draft, partnerEmail: partner.email });
  }

  // Sending — requires an explicit click AND a partner email on file.
  if (!partner.email) {
    return NextResponse.json({ error: "This partner has no email on file." }, { status: 400 });
  }
  try {
    const sent = await sendAccountGmail({
      accountId: actor.accountId,
      fromEmail: actor.email,
      recipients: [partner.email],
      subject: input.subject?.trim() || draft.subject,
      text: input.body?.trim() || draft.body,
    });
    if (!sent) return NextResponse.json({ error: "Gmail not connected — connect it in Settings." }, { status: 400 });
    return NextResponse.json({ ok: true, sent: true });
  } catch (e) {
    logError(e, { route: "POST /api/private-money/partners/[id]/update-email", accountId: actor.accountId });
    return NextResponse.json({ error: "send failed" }, { status: 500 });
  }
}
