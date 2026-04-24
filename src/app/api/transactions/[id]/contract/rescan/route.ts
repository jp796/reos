/**
 * POST /api/transactions/:id/contract/rescan
 * Body: { side: "buy" | "sell" | "both" }
 *
 * Re-scan the transaction's Gmail SmartFolder for the latest contract
 * PDF (or compensation rider) belonging to the chosen side, then
 * re-run ContractExtractionService on it and stash the result as
 * `pendingContractJson` for user review + apply.
 *
 * Scoping:
 *   - Restricted to the transaction's SmartFolder Gmail label (if set).
 *     Without a SmartFolder we fall back to a broader address-scoped
 *     query so the feature still works on pre-SmartFolder transactions.
 *   - Among matching PDFs, we prefer filenames that LOOK like contracts
 *     (contract/purchase/agreement/addendum/rider/psa/cbs/offer) over
 *     random attachments.
 *   - `side` filters by which party's email addresses / names appear
 *     on the thread. Dual ("both") allows either side.
 *
 * The request is idempotent — running it repeatedly replaces the
 * pending extraction. To commit the result, the user still hits
 * the existing Apply flow in ContractUploadPanel.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { env } from "@/lib/env";
import { getEncryptionService } from "@/lib/encryption";
import { requireSession, assertSameAccount } from "@/lib/require-session";
import {
  GoogleOAuthService,
  DEFAULT_SCOPES,
} from "@/services/integrations/GoogleOAuthService";
import {
  GmailService,
  EmailTransactionMatchingService,
} from "@/services/integrations/GmailService";
import { ContractExtractionService } from "@/services/ai/ContractExtractionService";

export const runtime = "nodejs";
export const maxDuration = 90;

const CONTRACT_FILENAME_RE =
  /(contract|purchase|agreement|addendum|rider|psa|cbs|offer|counter|amend)/i;

type Side = "buy" | "sell" | "both";

interface Body {
  side?: string;
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const { id } = await ctx.params;
  const txn = await prisma.transaction.findUnique({
    where: { id },
    include: {
      contact: { select: { fullName: true, primaryEmail: true } },
      participants: {
        include: {
          contact: { select: { fullName: true, primaryEmail: true } },
        },
      },
    },
  });
  if (!txn) return NextResponse.json({ error: "not found" }, { status: 404 });
  const acctGuard = assertSameAccount(actor, txn.accountId);
  if (acctGuard) return acctGuard;

  const body = (await req.json().catch(() => ({}))) as Body;
  const side: Side =
    body.side === "buy" || body.side === "sell" || body.side === "both"
      ? (body.side as Side)
      : // fall back to whatever representation is on the transaction
        txn.side === "buy" || txn.side === "sell" || txn.side === "both"
        ? (txn.side as Side)
        : "both";

  if (!env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY not configured" },
      { status: 500 },
    );
  }
  if (
    !env.GOOGLE_CLIENT_ID ||
    !env.GOOGLE_CLIENT_SECRET ||
    !env.GOOGLE_REDIRECT_URI
  ) {
    return NextResponse.json(
      { error: "Google OAuth env not configured" },
      { status: 500 },
    );
  }

  // Build the party-identity match set for this side. primary contact
  // is treated as buyer when the deal's side is "buy", seller when
  // "sell", and either when "both". Participants with role co_buyer /
  // co_seller add to whichever bucket matches.
  const primaryIsBuyer = txn.side === "buy" || txn.side === "both";
  const primaryIsSeller = txn.side === "sell" || txn.side === "both";

  const buyerIdentities: string[] = [];
  const sellerIdentities: string[] = [];
  if (primaryIsBuyer && txn.contact.fullName) buyerIdentities.push(txn.contact.fullName);
  if (primaryIsBuyer && txn.contact.primaryEmail) buyerIdentities.push(txn.contact.primaryEmail);
  if (primaryIsSeller && txn.contact.fullName) sellerIdentities.push(txn.contact.fullName);
  if (primaryIsSeller && txn.contact.primaryEmail) sellerIdentities.push(txn.contact.primaryEmail);

  for (const p of txn.participants) {
    const name = p.contact.fullName;
    const email = p.contact.primaryEmail;
    if (p.role === "co_buyer") {
      if (name) buyerIdentities.push(name);
      if (email) buyerIdentities.push(email);
    }
    if (p.role === "co_seller") {
      if (name) sellerIdentities.push(name);
      if (email) sellerIdentities.push(email);
    }
  }

  const wanted =
    side === "buy"
      ? buyerIdentities
      : side === "sell"
        ? sellerIdentities
        : [...buyerIdentities, ...sellerIdentities];

  // Gmail client
  const acct = await prisma.account.findUnique({
    where: { id: actor.accountId },
    select: { googleOauthTokensEncrypted: true },
  });
  if (!acct?.googleOauthTokensEncrypted) {
    return NextResponse.json(
      { error: "Google not connected" },
      { status: 400 },
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
  const gAuth = await oauth.createAuthenticatedClient(actor.accountId);
  const gmail = new GmailService(
    actor.accountId,
    gAuth,
    {
      labelPrefix: "REOS/",
      autoOrganizeThreads: false,
      extractAttachments: true,
      batchSize: 10,
      rateLimitDelayMs: 100,
    },
    prisma,
    new EmailTransactionMatchingService(),
  );

  // Build search query. Prefer the SmartFolder label if set — that's
  // the most targeted scope. Otherwise fall back to the address.
  const addressToken = txn.propertyAddress
    ? `"${txn.propertyAddress.replace(/"/g, '')}"`
    : null;
  const labelId = txn.smartFolderLabelId;
  const baseQ = labelId
    ? `has:attachment filename:pdf`
    : addressToken
      ? `has:attachment filename:pdf (${addressToken})`
      : `has:attachment filename:pdf`;

  let threads;
  try {
    const r = await gmail.searchThreads({
      q: baseQ,
      labelIds: labelId ? [labelId] : undefined,
      maxResults: 25,
    });
    threads = r.threads;
  } catch (err) {
    return NextResponse.json(
      {
        error: "gmail search failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }

  // Walk the threads, collect candidate attachments that match the
  // side's identities + look like contracts. Track the latest by
  // internalDate (threads are already roughly newest-first).
  interface Candidate {
    messageId: string;
    attachmentId: string;
    filename: string;
    size: number;
    internalDate: number;
    sideHit: "buy" | "sell" | "either";
  }
  const candidates: Candidate[] = [];

  for (const thread of threads) {
    for (const msg of thread.messages ?? []) {
      if (!msg.id) continue;
      const headers = msg.payload?.headers ?? [];
      const h = (name: string): string =>
        (headers.find((x) => x.name?.toLowerCase() === name.toLowerCase())
          ?.value ?? "").toLowerCase();
      const blob = [h("from"), h("to"), h("cc")].join(" ");

      const buyHit = buyerIdentities.some((x) =>
        blob.includes(x.toLowerCase()),
      );
      const sellHit = sellerIdentities.some((x) =>
        blob.includes(x.toLowerCase()),
      );

      let sideHit: "buy" | "sell" | "either";
      if (side === "buy") {
        if (!buyHit) continue;
        sideHit = "buy";
      } else if (side === "sell") {
        if (!sellHit) continue;
        sideHit = "sell";
      } else {
        // both — accept if either side matches, OR if no identities
        // are available at all (edge case: no parties yet).
        if (wanted.length > 0 && !buyHit && !sellHit) continue;
        sideHit = buyHit ? "buy" : sellHit ? "sell" : "either";
      }

      const attachments = await gmail.getMessageAttachments(msg.id);
      const internalDate = parseInt(msg.internalDate ?? "0", 10);
      for (const a of attachments) {
        if (!/\.pdf$/i.test(a.filename)) continue;
        if (!CONTRACT_FILENAME_RE.test(a.filename)) continue;
        if (a.size > 20 * 1024 * 1024) continue; // skip >20MB
        candidates.push({
          messageId: msg.id,
          attachmentId: a.attachmentId,
          filename: a.filename,
          size: a.size,
          internalDate,
          sideHit,
        });
      }
    }
  }

  // Find the newest stored Document (from a prior upload or rescan).
  // If Gmail has nothing or Gmail's newest is older than our stored
  // copy, we fall back to the stored PDF — so an uploaded-only contract
  // can still be rescanned after a schema/extractor upgrade.
  const storedDoc = await prisma.document.findFirst({
    where: {
      transactionId: txn.id,
      category: "contract",
      rawBytes: { not: null },
    },
    orderBy: [
      { sourceDate: "desc" },
      { uploadedAt: "desc" },
    ],
  });
  const storedTs = (storedDoc?.sourceDate ?? storedDoc?.uploadedAt)?.getTime() ?? 0;

  // Pick the newest source — Gmail or stored — by timestamp
  candidates.sort((a, b) => b.internalDate - a.internalDate);
  const gmailNewest = candidates[0];
  const useStored =
    storedDoc && storedDoc.rawBytes && storedTs >= (gmailNewest?.internalDate ?? 0);

  if (!useStored && candidates.length === 0) {
    return NextResponse.json({
      ok: false,
      reason: "no_matching_pdfs_found",
      searched: threads.length,
      side,
      hint: labelId
        ? "No contract PDFs found for this side in Gmail or in stored uploads. Try widening the side (Dual) or upload a contract directly."
        : "No SmartFolder and no stored uploads. Either upload the contract or create a SmartFolder first.",
    });
  }

  let buffer: Buffer;
  let pickedFilename: string;
  let pickedSource: "gmail" | "stored_upload";
  if (useStored && storedDoc?.rawBytes) {
    buffer = Buffer.from(storedDoc.rawBytes);
    pickedFilename = storedDoc.fileName;
    pickedSource = "stored_upload";
  } else {
    const pick = gmailNewest;
    try {
      buffer = await gmail.downloadAttachment(pick.messageId, pick.attachmentId);
    } catch (err) {
      return NextResponse.json(
        {
          error: "download failed",
          detail: err instanceof Error ? err.message : String(err),
        },
        { status: 502 },
      );
    }
    pickedFilename = pick.filename;
    pickedSource = "gmail";

    // Persist the Gmail-sourced PDF as a Document too, so we can
    // rescan again offline + have a permanent record of what we saw.
    try {
      await prisma.document.create({
        data: {
          transactionId: txn.id,
          category: "contract",
          fileName: pick.filename,
          mimeType: "application/pdf",
          rawBytes: buffer,
          source: "gmail_attachment",
          uploadOrigin: `rescan:${side}`,
          uploadedAt: new Date(),
          sourceDate: new Date(pick.internalDate),
        },
      });
    } catch (err) {
      console.warn(
        "[contract/rescan] saving Gmail PDF as Document failed (non-blocking):",
        err instanceof Error ? err.message : err,
      );
    }
  }

  const svc = new ContractExtractionService(env.OPENAI_API_KEY);
  let extraction;
  try {
    extraction = await svc.extract(buffer);
  } catch (err) {
    return NextResponse.json(
      {
        error: "extraction failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }

  // Merge over any existing pending extraction — NEWEST WINS (this
  // rescan is explicitly the "fresh version of the truth").
  const prior = (txn.pendingContractJson ?? null) as Prisma.JsonValue | null;

  // Snapshot the prior extraction before the merge so the diff
  // viewer can compare addendum vs original.
  if (prior) {
    try {
      await prisma.contractExtractionVersion.create({
        data: {
          transactionId: txn.id,
          extractionJson: prior as Prisma.InputJsonValue,
          source:
            pickedSource === "gmail" ? "rescan_gmail" : "rescan_stored",
          filename: pickedFilename,
          sourceDate: txn.contractExtractedAt ?? new Date(),
        },
      });
    } catch (err) {
      console.warn(
        "[contract/rescan] snapshot prior version failed (non-blocking):",
        err instanceof Error ? err.message : err,
      );
    }
  }

  const merged = mergePending(prior, extraction as unknown as Record<string, unknown>);
  (merged as Record<string, unknown>)._rescan = {
    side,
    filename: pickedFilename,
    source: pickedSource,
    pickedAt: new Date().toISOString(),
    candidatesConsidered: candidates.length,
    storedFallback: pickedSource === "stored_upload",
  };

  await prisma.transaction.update({
    where: { id: txn.id },
    data: {
      pendingContractJson: merged as Prisma.InputJsonValue,
      contractExtractedAt: new Date(),
    },
  });

  return NextResponse.json({
    ok: true,
    side,
    pickedFilename,
    pickedSource, // "gmail" | "stored_upload"
    candidatesConsidered: candidates.length,
    extraction: merged,
  });
}

/**
 * Newest-wins merge. New extraction authoritative whenever it has a
 * non-null value; only fall back to prior when the new extraction
 * dropped the field entirely. Matches the same policy used in the
 * upload/extract path. See src/app/api/transactions/[id]/contract/
 * extract/route.ts for rationale.
 */
function mergePending(
  prior: Prisma.JsonValue | null,
  next: Record<string, unknown>,
): Record<string, unknown> {
  if (!prior || typeof prior !== "object" || Array.isArray(prior)) return next;
  const p = prior as Record<string, unknown>;
  const out: Record<string, unknown> = { ...next };
  for (const [k, v] of Object.entries(p)) {
    if (k === "notes" || k === "_path" || k === "_rescan") {
      out[k] = (next as Record<string, unknown>)[k] ?? v;
      continue;
    }
    const n = (next as Record<string, unknown>)[k];
    if (!isField(n) && isField(v)) {
      out[k] = v;
      continue;
    }
    if (isField(n) && isField(v)) {
      const nVal = (n as { value?: unknown }).value;
      if (nVal === null || nVal === undefined) {
        out[k] = v;
      }
      // else: new wins (already in out via {...next})
    }
  }
  return out;
}

function isField(x: unknown): boolean {
  return (
    !!x &&
    typeof x === "object" &&
    !Array.isArray(x) &&
    "value" in (x as object) &&
    "confidence" in (x as object)
  );
}
