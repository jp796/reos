/**
 * POST /api/automation/stale-contact-ss-check
 *
 * For every transaction that looks like a stale FUB placeholder —
 * no property address, no contract/closing dates, contact last
 * activity older than STALE_DAYS, status still "active" — search
 * Gmail for any Final Settlement Statement involving that contact.
 * If one is found, apply it: mark the transaction closed using the
 * extracted closing date, cascade milestones to complete.
 *
 * Rule: ONLY closes when SS evidence exists. No SS → leave alone
 * (user fixes in FUB or manually marks closed).
 *
 * Conservative: matches SS PDFs where the Borrower/Buyer/Seller
 * name extracted from the doc contains the contact's full name.
 * If the name doesn't match, we don't assume the SS is theirs.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { getEncryptionService } from "@/lib/encryption";
import {
  GoogleOAuthService,
  DEFAULT_SCOPES,
} from "@/services/integrations/GoogleOAuthService";
import {
  GmailService,
  EmailTransactionMatchingService,
} from "@/services/integrations/GmailService";
import { DocumentExtractionService } from "@/services/ai/DocumentExtractionService";

export const runtime = "nodejs";
export const maxDuration = 180;

const STALE_DAYS = 120;
const MAX_THREADS_PER_CONTACT = 25;

const SS_FILENAME_RES: RegExp[] = [
  /settlement[_\s-]*statement/i,
  /closing[_\s-]*disclosure/i,
  /alta.*settlement/i,
  /hud[-\s]?1/i,
  /final.*cd/i,
  /final.*settlement/i,
];

export async function POST() {
  const account = await prisma.account.findFirst({
    select: { id: true, googleOauthTokensEncrypted: true },
  });
  if (!account?.googleOauthTokensEncrypted) {
    return NextResponse.json(
      { error: "Google not connected" },
      { status: 412 },
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

  const staleThreshold = new Date(
    Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000,
  );

  // Stale placeholder transactions: active, no address, no dates
  const candidates = await prisma.transaction.findMany({
    where: {
      accountId: account.id,
      status: "active",
      propertyAddress: null,
      contractDate: null,
      closingDate: null,
    },
    include: { contact: true },
  });

  // Extra FUB-activity filter (drop ones with recent FUB activity)
  const stale = candidates.filter((t) => {
    const last =
      (t.contact.rawFubPayloadJson as Record<string, unknown> | null)?.[
        "lastActivity"
      ];
    if (typeof last !== "string") return true;
    const d = new Date(last);
    if (Number.isNaN(d.getTime())) return true;
    return d < staleThreshold;
  });

  if (stale.length === 0) {
    return NextResponse.json({
      ok: true,
      inspected: 0,
      closed: 0,
      noSSFound: 0,
      errored: 0,
      details: [],
    });
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
  const gAuth = await oauth.createAuthenticatedClient(account.id);
  const gmail = new GmailService(
    account.id,
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
  const extract = new DocumentExtractionService();

  let closed = 0;
  let noSSFound = 0;
  let errored = 0;
  const details: Array<{
    transactionId: string;
    contactName: string;
    action: "closed" | "no_ss" | "no_match" | "error";
    closingDate?: string;
    reason?: string;
  }> = [];

  for (const txn of stale) {
    try {
      const contact = txn.contact;
      const nameFragments = buildNameFragments(contact.fullName);
      if (nameFragments.length === 0) {
        details.push({
          transactionId: txn.id,
          contactName: contact.fullName,
          action: "no_match",
          reason: "no usable name fragment",
        });
        continue;
      }

      // Build a Gmail query: SS-looking attachments + contact email or
      // name in the thread body or from/to headers.
      const emailTerm = contact.primaryEmail
        ? `from:"${contact.primaryEmail}" OR to:"${contact.primaryEmail}"`
        : null;
      const nameTerm = `"${nameFragments[0]}"`;
      const participantFilter = emailTerm
        ? `(${emailTerm} OR ${nameTerm})`
        : nameTerm;
      const q = `has:attachment (settlement OR closing OR disclosure OR ALTA OR HUD) ${participantFilter}`;

      const { threads } = await gmail.searchThreadsPaged({
        q,
        maxTotal: MAX_THREADS_PER_CONTACT,
      });

      let closingDate: Date | null = null;
      let matchedThread: string | null = null;

      threadLoop: for (const t of threads) {
        if (!t.messages) continue;
        for (const m of t.messages) {
          if (!m.id) continue;
          const atts = await gmail.getMessageAttachments(m.id);
          for (const a of atts) {
            if (!SS_FILENAME_RES.some((re) => re.test(a.filename))) continue;
            try {
              const buf = await gmail.downloadAttachment(
                m.id,
                a.attachmentId,
              );
              // Party check: ensure the SS actually names this contact
              const parties = await extract.extractParties(buf);
              const allNames = [
                ...(parties?.buyers ?? []),
                ...(parties?.sellers ?? []),
              ].map((n) => n.toLowerCase());
              const matches = nameFragments.some((frag) =>
                allNames.some((n) => n.includes(frag.toLowerCase())),
              );
              if (!matches) continue;
              // Closing date extraction
              const ex = await extract.extractClosingDate(buf);
              if (ex?.date) {
                closingDate = ex.date;
                matchedThread = t.id ?? null;
                break threadLoop;
              }
            } catch {
              // skip bad attachment
            }
          }
        }
      }

      if (!closingDate) {
        noSSFound++;
        details.push({
          transactionId: txn.id,
          contactName: contact.fullName,
          action: "no_ss",
        });
        continue;
      }

      // Apply: mark closed, set closing date, cascade milestones
      await prisma.transaction.update({
        where: { id: txn.id },
        data: { status: "closed", closingDate },
      });
      await prisma.milestone.updateMany({
        where: { transactionId: txn.id, completedAt: null },
        data: { completedAt: closingDate, status: "completed" },
      });
      closed++;
      details.push({
        transactionId: txn.id,
        contactName: contact.fullName,
        action: "closed",
        closingDate: closingDate.toISOString(),
        reason: matchedThread ? `ss in thread ${matchedThread}` : undefined,
      });
    } catch (err) {
      errored++;
      details.push({
        transactionId: txn.id,
        contactName: txn.contact.fullName,
        action: "error",
        reason: err instanceof Error ? err.message.slice(0, 120) : String(err),
      });
    }
  }

  return NextResponse.json({
    ok: true,
    inspected: stale.length,
    closed,
    noSSFound,
    errored,
    details,
  });
}

/** Split "Jason R. Fisher" into searchable fragments: full + last name. */
function buildNameFragments(fullName: string): string[] {
  const t = fullName.trim();
  if (t.length < 3) return [];
  const parts = t.split(/\s+/).filter((p) => p.length >= 2);
  const last = parts[parts.length - 1];
  const out = [t];
  if (last && last !== t && last.length >= 3) out.push(last);
  return out;
}
