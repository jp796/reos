import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { appUrl } from "@/lib/app-url";
import { requireSession } from "@/lib/require-session";
import { DocumensoService } from "@/services/integrations/DocumensoService";

export const runtime = "nodejs";

const recipientSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(255),
});

const postSchema = z.object({
  documentId: z.string().min(1),
  recipients: z.array(recipientSchema).min(1).max(8),
  subject: z.string().trim().max(180).optional(),
  message: z.string().trim().max(1000).optional(),
});

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  const { id } = await ctx.params;

  const txn = await prisma.transaction.findFirst({
    where: { id, accountId: actor.accountId },
    select: { id: true },
  });
  if (!txn) return NextResponse.json({ error: "not found" }, { status: 404 });

  const requests = await prisma.esignRequest.findMany({
    where: { transactionId: id, accountId: actor.accountId },
    include: {
      document: {
        select: { id: true, fileName: true, mimeType: true, uploadedAt: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    provider: "documenso",
    configured: DocumensoService.isConfigured(),
    providerUrl: env.DOCUMENSO_API_URL ?? null,
    requests,
  });
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  if (actor.role !== "owner" && actor.role !== "coordinator") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const body = postSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json(
      { error: "invalid request", details: body.error.flatten() },
      { status: 400 },
    );
  }

  if (!DocumensoService.isConfigured()) {
    return NextResponse.json(
      { error: "Documenso is not configured" },
      { status: 409 },
    );
  }

  const txn = await prisma.transaction.findFirst({
    where: { id, accountId: actor.accountId },
    include: {
      contact: { select: { fullName: true } },
      documents: {
        where: { id: body.data.documentId },
        select: {
          id: true,
          fileName: true,
          mimeType: true,
          rawBytes: true,
          transactionId: true,
        },
      },
    },
  });
  if (!txn) return NextResponse.json({ error: "not found" }, { status: 404 });

  const doc = txn.documents[0];
  if (!doc) {
    return NextResponse.json({ error: "document not found" }, { status: 404 });
  }
  if (doc.mimeType !== "application/pdf") {
    return NextResponse.json(
      { error: "only PDF documents can be sent for e-signature" },
      { status: 400 },
    );
  }
  if (!doc.rawBytes || doc.rawBytes.length === 0) {
    return NextResponse.json(
      {
        error:
          "this document has no stored PDF bytes; re-upload or rescan it first",
      },
      { status: 400 },
    );
  }

  const title = `${txn.contact.fullName} — ${doc.fileName}`;
  const recipients = body.data.recipients.map((r) => ({
    name: r.name,
    email: r.email.toLowerCase(),
  }));
  const subject =
    body.data.subject ?? `Signature requested: ${txn.contact.fullName}`;
  const message =
    body.data.message ??
    "Please review and sign this document. REOS will track the signing request on the transaction.";

  const request = await prisma.esignRequest.create({
    data: {
      accountId: actor.accountId,
      transactionId: txn.id,
      documentId: doc.id,
      title,
      status: "draft",
      recipientsJson: recipients as unknown as Prisma.InputJsonValue,
      createdByUserId: actor.userId,
    },
  });

  try {
    const result = await new DocumensoService().createAndSend({
      title,
      externalId: `reos:${request.id}`,
      fileName: doc.fileName,
      fileBytes: doc.rawBytes,
      recipients,
      subject,
      message,
      redirectUrl: appUrl(`/transactions/${txn.id}`).toString(),
    });

    const updated = await prisma.esignRequest.update({
      where: { id: request.id },
      data: {
        status: "sent",
        providerEnvelopeId: result.envelopeId,
        signingLinksJson:
          result.recipients as unknown as Prisma.InputJsonValue,
        providerResponseJson: {
          create: result.rawCreate,
          distribute: result.rawDistribute,
        } as unknown as Prisma.InputJsonValue,
        sentAt: new Date(),
      },
    });

    await prisma.automationAuditLog.create({
      data: {
        accountId: actor.accountId,
        transactionId: txn.id,
        entityType: "transaction",
        entityId: txn.id,
        ruleName: "esign_request_sent",
        actionType: "send",
        sourceType: "manual",
        confidenceScore: 1,
        decision: "applied",
        actorUserId: actor.userId,
        afterJson: {
          summary: `Sent ${doc.fileName} for Documenso signature`,
          esignRequestId: updated.id,
          providerEnvelopeId: result.envelopeId,
          recipientCount: recipients.length,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    return NextResponse.json({ ok: true, request: updated });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Documenso send failed";
    const failed = await prisma.esignRequest.update({
      where: { id: request.id },
      data: { status: "failed", errorMessage: message },
    });
    return NextResponse.json(
      { error: message, request: failed },
      { status: 502 },
    );
  }
}
