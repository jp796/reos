/**
 * E-sign management — native first-party engine (provider: "native").
 *
 * POST creates a signature request with placed fields and emails each
 * signer a unique tokenized link (/sign/[token]). No third-party
 * esign API. The legacy Documenso integration remains in the repo
 * (DocumensoService) but is dormant — native is the only send path.
 */
import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import { createAndSendNative } from "@/services/esign/NativeEsignService";

export const runtime = "nodejs";

const recipientSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(255),
});

const fieldSchema = z.object({
  type: z.enum(["SIGNATURE", "INITIALS", "DATE_SIGNED", "TEXT"]),
  page: z.number().int().min(1).max(500),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().min(0.005).max(1),
  height: z.number().min(0.005).max(1),
  recipientIndex: z.number().int().min(0).max(7),
  required: z.boolean().optional(),
});

const postSchema = z.object({
  documentId: z.string().min(1),
  recipients: z.array(recipientSchema).min(1).max(8),
  fields: z.array(fieldSchema).min(1).max(200),
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
      recipients: {
        orderBy: { signingOrder: "asc" },
        select: {
          id: true,
          name: true,
          email: true,
          status: true,
          consentAt: true,
          signedAt: true,
          viewedAt: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    provider: "native",
    configured: true,
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

  // Every field must point at a recipient that exists in this payload.
  const badField = body.data.fields.find(
    (f) => f.recipientIndex >= body.data.recipients.length,
  );
  if (badField) {
    return NextResponse.json(
      { error: "field references a missing recipient" },
      { status: 400 },
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

  try {
    const result = await createAndSendNative({
      actor: {
        accountId: actor.accountId,
        userId: actor.userId,
        email: actor.email,
      },
      transactionId: txn.id,
      documentId: doc.id,
      title,
      recipients: body.data.recipients.map((r) => ({
        name: r.name,
        email: r.email.toLowerCase(),
      })),
      fields: body.data.fields,
      message: body.data.message,
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
          summary: `Sent ${doc.fileName} for native e-signature`,
          esignRequestId: result.id,
          recipientCount: body.data.recipients.length,
          fieldCount: body.data.fields.length,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    return NextResponse.json({ ok: true, id: result.id, links: result.links });
  } catch (e) {
    const message = e instanceof Error ? e.message : "e-sign send failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
