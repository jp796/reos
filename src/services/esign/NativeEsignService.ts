/**
 * Native esign orchestration — REOS's first-party signing engine.
 * No third-party esign API: tokens, consent, events, and finalize
 * all live here. Email goes out through the account's existing
 * Gmail OAuth connection (same path as transaction emails).
 *
 * Legal frame (ESIGN/UETA evidence captured per signer):
 *   intent       — deliberate sign action on the signing page
 *   consent      — affirmative checkbox, text version recorded
 *   attribution  — unique crypto token delivered to the email +
 *                  IP / user-agent at consent and signing
 *   integrity    — EsignEvent audit trail, original + final SHA-256,
 *                  certificate page burned into the finalized PDF
 */

import { randomBytes } from "crypto";
import { google } from "googleapis";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { appUrl } from "@/lib/app-url";
import { getEncryptionService } from "@/lib/encryption";
import {
  GoogleOAuthService,
  DEFAULT_SCOPES,
} from "@/services/integrations/GoogleOAuthService";
import { pdfPageCount } from "@/services/ai/PdfRender";
import {
  finalizeSignedPdf,
  renderPdfPage,
  type FinalizeRecipient,
} from "./EsignPdfService";

export const CONSENT_TEXT_VERSION = "native-v1-2026-06";
export const CONSENT_TEXT =
  "I agree to use electronic records and signatures for this transaction, " +
  "and I intend my electronic signature to be the legal equivalent of my " +
  "handwritten signature under the U.S. ESIGN Act and UETA. I confirm I can " +
  "access and retain a copy of the signed document.";
export const SIGNING_LINK_TTL_DAYS = 30;

export interface NativeFieldInput {
  type: "SIGNATURE" | "INITIALS" | "DATE_SIGNED" | "TEXT";
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  recipientIndex: number;
  required?: boolean;
}

export interface NativeRecipientInput {
  name: string;
  email: string;
}

const ACTIVE_STATUSES = new Set(["sent"]);

function newToken(): string {
  return randomBytes(48).toString("base64url");
}

function linkExpired(sentAt: Date | null): boolean {
  if (!sentAt) return false;
  const ageMs = Date.now() - sentAt.getTime();
  return ageMs > SIGNING_LINK_TTL_DAYS * 24 * 60 * 60 * 1000;
}

// ----------------------------------------------------------------
// Gmail (reuses the account's OAuth connection, same as email route)
// ----------------------------------------------------------------

async function buildGmail(accountId: string) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REDIRECT_URI) {
    throw new Error("Google OAuth not configured");
  }
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { googleOauthTokensEncrypted: true },
  });
  if (!account?.googleOauthTokensEncrypted) {
    throw new Error(
      "Google is not connected — connect Gmail in Settings → Integrations to send signature requests",
    );
  }
  const oauth = new GoogleOAuthService(
    {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      redirectUri: env.GOOGLE_REDIRECT_URI,
      scopes: DEFAULT_SCOPES,
    },
    prisma,
    getEncryptionService(),
  );
  const gAuth = await oauth.createAuthenticatedClient(accountId);
  return google.gmail({ version: "v1", auth: gAuth });
}

function toBase64Url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function sendGmail(input: {
  accountId: string;
  fromEmail: string;
  to: string[];
  subject: string;
  text: string;
  attachment?: { fileName: string; bytes: Buffer };
}): Promise<void> {
  const gmail = await buildGmail(input.accountId);
  const subject = input.subject.replace(/[\r\n]/g, " ");

  let message: string;
  if (input.attachment) {
    const boundary = "reos-" + randomBytes(8).toString("hex");
    message =
      [
        `From: ${input.fromEmail}`,
        `To: ${input.to.join(", ")}`,
        `Subject: ${subject}`,
        "MIME-Version: 1.0",
        `Content-Type: multipart/mixed; boundary="${boundary}"`,
      ].join("\r\n") +
      "\r\n\r\n" +
      `--${boundary}\r\n` +
      'Content-Type: text/plain; charset="UTF-8"\r\n' +
      "Content-Transfer-Encoding: 7bit\r\n\r\n" +
      input.text +
      "\r\n" +
      `--${boundary}\r\n` +
      `Content-Type: application/pdf; name="${input.attachment.fileName}"\r\n` +
      `Content-Disposition: attachment; filename="${input.attachment.fileName}"\r\n` +
      "Content-Transfer-Encoding: base64\r\n\r\n" +
      input.attachment.bytes.toString("base64").replace(/(.{76})/g, "$1\r\n") +
      `\r\n--${boundary}--`;
  } else {
    message =
      [
        `From: ${input.fromEmail}`,
        `To: ${input.to.join(", ")}`,
        `Subject: ${subject}`,
        "MIME-Version: 1.0",
        'Content-Type: text/plain; charset="UTF-8"',
        "Content-Transfer-Encoding: 7bit",
      ].join("\r\n") +
      "\r\n\r\n" +
      input.text;
  }

  await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw: toBase64Url(Buffer.from(message)) },
  });
}

// ----------------------------------------------------------------
// Create + send
// ----------------------------------------------------------------

export async function createAndSendNative(input: {
  actor: { accountId: string; userId: string; email: string };
  transactionId: string;
  documentId: string;
  title: string;
  recipients: NativeRecipientInput[];
  fields: NativeFieldInput[];
  message?: string;
}) {
  const tokens = input.recipients.map(() => newToken());
  const links = input.recipients.map((r, i) => ({
    name: r.name,
    email: r.email,
    signingUrl: appUrl(`/sign/${tokens[i]}`),
  }));

  const request = await prisma.esignRequest.create({
    data: {
      accountId: input.actor.accountId,
      transactionId: input.transactionId,
      documentId: input.documentId,
      provider: "native",
      status: "sent",
      title: input.title,
      sentAt: new Date(),
      createdByUserId: input.actor.userId,
      recipientsJson: input.recipients as object[],
      signingLinksJson: links as object[],
      recipients: {
        create: input.recipients.map((r, i) => ({
          name: r.name,
          email: r.email,
          signingOrder: i + 1,
          token: tokens[i]!,
        })),
      },
    },
    include: { recipients: { orderBy: { signingOrder: "asc" } } },
  });

  await prisma.esignField.createMany({
    data: input.fields.map((f) => ({
      esignRequestId: request.id,
      recipientId: request.recipients[f.recipientIndex]!.id,
      type: f.type,
      page: f.page,
      x: f.x,
      y: f.y,
      width: f.width,
      height: f.height,
      required: f.required ?? true,
    })),
  });

  await prisma.esignEvent.createMany({
    data: [
      {
        esignRequestId: request.id,
        type: "created",
        metaJson: { by: input.actor.email },
      },
      ...request.recipients.map((r) => ({
        esignRequestId: request.id,
        recipientId: r.id,
        type: "sent",
        metaJson: { email: r.email },
      })),
    ],
  });

  // Email each signer their unique link. A send failure marks the
  // request failed loudly — a silently unsendable request looks
  // identical to "they just haven't signed yet" and wastes days.
  try {
    for (const [i, r] of request.recipients.entries()) {
      await sendGmail({
        accountId: input.actor.accountId,
        fromEmail: input.actor.email,
        to: [r.email],
        subject: `Signature requested: ${input.title}`,
        text:
          `${r.name},\n\n` +
          `${input.actor.email} has requested your signature on "${input.title}".\n\n` +
          `Review and sign here:\n${links[i]!.signingUrl}\n\n` +
          (input.message ? `${input.message}\n\n` : "") +
          `This link is unique to you — do not forward it. It expires in ${SIGNING_LINK_TTL_DAYS} days.\n\n` +
          `Sent via REOS e-sign.`,
      });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "email send failed";
    await prisma.esignRequest.update({
      where: { id: request.id },
      data: { status: "failed", errorMessage: msg },
    });
    throw new Error(`Signature request created but email failed: ${msg}`);
  }

  return { id: request.id, links };
}

// ----------------------------------------------------------------
// Signer-side (public, token-addressed)
// ----------------------------------------------------------------

/** Resolve a token to its recipient+request or null. Generic-404 material. */
async function resolveToken(token: string) {
  if (!token || token.length < 32 || token.length > 128) return null;
  const recipient = await prisma.esignRecipient.findUnique({
    where: { token },
    include: {
      fields: true,
      esignRequest: {
        select: {
          id: true,
          status: true,
          provider: true,
          title: true,
          sentAt: true,
          accountId: true,
          documentId: true,
          createdByUserId: true,
          transactionId: true,
        },
      },
    },
  });
  if (!recipient) return null;
  if (recipient.esignRequest.provider !== "native") return null;
  if (linkExpired(recipient.esignRequest.sentAt)) return null;
  return recipient;
}

export async function getSignerView(token: string, ip: string, userAgent: string) {
  const recipient = await resolveToken(token);
  if (!recipient) return null;
  const req = recipient.esignRequest;
  if (!ACTIVE_STATUSES.has(req.status) && req.status !== "completed") return null;

  const doc = await prisma.document.findUnique({
    where: { id: req.documentId },
    select: { fileName: true, rawBytes: true },
  });
  if (!doc?.rawBytes) return null;
  const pageCount =
    (await pdfPageCount(Buffer.from(doc.rawBytes))) ?? 1;

  if (!recipient.viewedAt) {
    await prisma.$transaction([
      prisma.esignRecipient.update({
        where: { id: recipient.id },
        data: { viewedAt: new Date(), ip, userAgent, status: recipient.status === "pending" ? "viewed" : recipient.status },
      }),
      prisma.esignEvent.create({
        data: {
          esignRequestId: req.id,
          recipientId: recipient.id,
          type: "viewed",
          ip,
          userAgent,
        },
      }),
    ]);
  }

  // Field-minimized response: the signer sees ONLY their own fields
  // and identity — never other recipients' names, emails, or tokens.
  return {
    title: req.title,
    fileName: doc.fileName,
    status: req.status,
    pageCount,
    consentText: CONSENT_TEXT,
    consentTextVersion: CONSENT_TEXT_VERSION,
    recipient: {
      name: recipient.name,
      status: recipient.status,
      consented: !!recipient.consentAt,
      signed: !!recipient.signedAt,
    },
    fields: recipient.fields.map((f) => ({
      id: f.id,
      type: f.type,
      page: f.page,
      x: f.x,
      y: f.y,
      width: f.width,
      height: f.height,
      required: f.required,
      value: f.value,
    })),
  };
}

export async function getSignerPagePng(token: string, page: number) {
  const recipient = await resolveToken(token);
  if (!recipient) return null;
  const doc = await prisma.document.findUnique({
    where: { id: recipient.esignRequest.documentId },
    select: { rawBytes: true },
  });
  if (!doc?.rawBytes) return null;
  return renderPdfPage(Buffer.from(doc.rawBytes), page);
}

export async function recordConsent(token: string, ip: string, userAgent: string) {
  const recipient = await resolveToken(token);
  if (!recipient) return null;
  if (!ACTIVE_STATUSES.has(recipient.esignRequest.status)) return null;
  if (recipient.consentAt) return { ok: true };

  await prisma.$transaction([
    prisma.esignRecipient.update({
      where: { id: recipient.id },
      data: {
        consentAt: new Date(),
        consentTextVersion: CONSENT_TEXT_VERSION,
        status: "consented",
        ip,
        userAgent,
      },
    }),
    prisma.esignEvent.create({
      data: {
        esignRequestId: recipient.esignRequest.id,
        recipientId: recipient.id,
        type: "consented",
        ip,
        userAgent,
        metaJson: { consentTextVersion: CONSENT_TEXT_VERSION },
      },
    }),
  ]);
  return { ok: true };
}

export async function completeSigning(
  token: string,
  payload: { signatureImage: string; values: Record<string, string> },
  ip: string,
  userAgent: string,
): Promise<
  | { ok: true; completed: boolean }
  | { ok: false; status: number; error: string }
> {
  const recipient = await resolveToken(token);
  if (!recipient) return { ok: false, status: 404, error: "not found" };
  const req = recipient.esignRequest;

  if (!ACTIVE_STATUSES.has(req.status)) {
    return { ok: false, status: 409, error: "this request is no longer open for signing" };
  }
  if (recipient.signedAt) {
    return { ok: false, status: 409, error: "already signed" };
  }
  if (!recipient.consentAt) {
    return { ok: false, status: 412, error: "consent required before signing" };
  }
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(payload.signatureImage)) {
    return { ok: false, status: 400, error: "signature image must be a PNG data URL" };
  }
  if (payload.signatureImage.length > 400_000) {
    return { ok: false, status: 400, error: "signature image too large" };
  }
  for (const f of recipient.fields) {
    if (f.type === "TEXT" && f.required && !payload.values[f.id]?.trim()) {
      return { ok: false, status: 400, error: "required field missing" };
    }
  }

  const now = new Date();
  await prisma.$transaction([
    ...recipient.fields
      .filter((f) => f.type === "TEXT" && payload.values[f.id])
      .map((f) =>
        prisma.esignField.update({
          where: { id: f.id },
          data: { value: payload.values[f.id]!.slice(0, 500) },
        }),
      ),
    prisma.esignRecipient.update({
      where: { id: recipient.id },
      data: {
        status: "signed",
        signedAt: now,
        signatureImage: payload.signatureImage,
        ip,
        userAgent,
      },
    }),
    prisma.esignEvent.create({
      data: {
        esignRequestId: req.id,
        recipientId: recipient.id,
        type: "signed",
        ip,
        userAgent,
      },
    }),
  ]);

  const unsigned = await prisma.esignRecipient.count({
    where: { esignRequestId: req.id, signedAt: null },
  });
  if (unsigned > 0) return { ok: true, completed: false };

  await finalizeRequest(req.id);
  return { ok: true, completed: true };
}

// ----------------------------------------------------------------
// Finalize — burn signatures, attach certificate, store, distribute
// ----------------------------------------------------------------

export async function finalizeRequest(requestId: string): Promise<void> {
  const req = await prisma.esignRequest.findUnique({
    where: { id: requestId },
    include: {
      document: { select: { id: true, fileName: true, rawBytes: true, category: true } },
      recipients: { include: { fields: true }, orderBy: { signingOrder: "asc" } },
      events: { orderBy: { occurredAt: "asc" } },
    },
  });
  if (!req?.document?.rawBytes) {
    throw new Error("finalize: source document bytes missing");
  }

  const recipientById = new Map(req.recipients.map((r) => [r.id, r] as const));
  const finalized = await finalizeSignedPdf({
    pdfBytes: Buffer.from(req.document.rawBytes),
    title: req.title,
    requestId: req.id,
    recipients: req.recipients.map(
      (r): FinalizeRecipient => ({
        name: r.name,
        email: r.email,
        consentAt: r.consentAt,
        consentTextVersion: r.consentTextVersion,
        signedAt: r.signedAt,
        ip: r.ip,
        userAgent: r.userAgent,
        signatureImage: r.signatureImage,
        fields: r.fields,
      }),
    ),
    events: req.events.map((e) => ({
      type: e.type,
      occurredAt: e.occurredAt,
      who: e.recipientId
        ? (recipientById.get(e.recipientId)?.email ?? null)
        : null,
      ip: e.ip,
    })),
  });

  const baseName = req.document.fileName.replace(/\.pdf$/i, "");
  const signedDoc = await prisma.document.create({
    data: {
      transactionId: req.transactionId,
      category: req.document.category ?? "contract",
      fileName: `${baseName} (signed).pdf`,
      mimeType: "application/pdf",
      rawBytes: finalized.bytes,
      source: "upload",
      uploadOrigin: "esign_native",
      uploadedAt: new Date(),
    },
  });

  await prisma.$transaction([
    prisma.esignRequest.update({
      where: { id: req.id },
      data: {
        status: "completed",
        completedAt: new Date(),
        finalHash: finalized.sha256,
        finalDocumentId: signedDoc.id,
      },
    }),
    prisma.esignEvent.create({
      data: {
        esignRequestId: req.id,
        type: "completed",
        metaJson: {
          finalHash: finalized.sha256,
          originalHash: finalized.originalSha256,
          finalDocumentId: signedDoc.id,
        },
      },
    }),
  ]);

  // Retention copy to every party (ESIGN: signers must be able to
  // retain the record). Email failure must not un-complete the
  // request — record it as an event instead.
  try {
    const sender = req.createdByUserId
      ? await prisma.user.findUnique({
          where: { id: req.createdByUserId },
          select: { email: true },
        })
      : null;
    const fromEmail =
      sender?.email ??
      (
        await prisma.user.findFirst({
          where: { accountId: req.accountId, role: "owner" },
          select: { email: true },
        })
      )?.email;
    if (!fromEmail) throw new Error("no sender email available");

    await sendGmail({
      accountId: req.accountId,
      fromEmail,
      to: [fromEmail, ...req.recipients.map((r) => r.email)],
      subject: `Completed: ${req.title}`,
      text:
        `All parties have signed "${req.title}".\n\n` +
        `The completed document is attached, including the signature certificate.\n` +
        `Document SHA-256: ${finalized.sha256}\n\n` +
        `Please retain a copy for your records.\n\nSent via REOS e-sign.`,
      attachment: {
        fileName: `${baseName} (signed).pdf`,
        bytes: finalized.bytes,
      },
    });
  } catch (e) {
    await prisma.esignEvent.create({
      data: {
        esignRequestId: req.id,
        type: "completion_email_failed",
        metaJson: { error: e instanceof Error ? e.message : "unknown" },
      },
    });
  }
}
