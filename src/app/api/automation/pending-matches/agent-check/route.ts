/**
 * POST /api/automation/pending-matches/agent-check
 *
 * For every open PendingEmailMatch row, download the SS / contract /
 * CD attachment on its thread, extract listing + selling agent names,
 * and auto-dismiss rows where none of those names match the user's
 * configured agent identities (name + brokerage).
 *
 * Rule:
 *   • match        → keep in queue (you're on this deal)
 *   • no_match     → dismiss with reason="not_my_listing"
 *   • unknown      → keep (no agent data extracted — safer default)
 *
 * Identity source: Account.settingsJson.agentIdentities (array of
 * strings). Falls back to a hardcoded default for the single-
 * account owner so this works out of the box.
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

const PDF_PATTERNS: RegExp[] = [
  /settlement[_\s-]*statement/i,
  /closing[_\s-]*disclosure/i,
  /alta.*settlement/i,
  /\bcd\b.*\.pdf$/i,
  /hud[-\s]?1/i,
  /final.*cd/i,
  /final.*settlement/i,
  /purchase.*agreement/i,
  /contract.*to\s*buy/i,
  /sale.*contract/i,
  /\.pdf$/i, // last-chance catchall since most title-co attachments are PDFs
];

const DEFAULT_IDENTITIES = [
  "James Fluellen",
  "Jp Fluellen",
  "Real Broker LLC",
  "Real Broker, LLC",
  "Real Broker",
];

export const runtime = "nodejs";
export const maxDuration = 90;

export async function POST() {
  const account = await prisma.account.findFirst({
    select: { id: true, settingsJson: true, googleOauthTokensEncrypted: true },
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

  const identities = resolveIdentities(account.settingsJson);

  const rows = await prisma.pendingEmailMatch.findMany({
    where: { status: "pending" },
    orderBy: { detectedAt: "desc" },
    take: 100,
  });
  if (rows.length === 0) {
    return NextResponse.json({
      ok: true,
      inspected: 0,
      dismissed: 0,
      kept: 0,
      unknown: 0,
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

  let dismissed = 0;
  let kept = 0;
  let unknown = 0;
  const details: Array<{
    pendingId: string;
    threadId: string;
    subject: string;
    decision: "match" | "no_match" | "unknown" | "no_pdf" | "error";
    agents?: string[];
  }> = [];

  for (const row of rows) {
    try {
      const thread = await gmail.getThread(row.threadId);
      if (!thread?.messages) {
        details.push({
          pendingId: row.id,
          threadId: row.threadId,
          subject: row.subject,
          decision: "no_pdf",
        });
        continue;
      }

      // Find the first PDF attachment likely to be a settlement /
      // contract doc.
      let buffer: Buffer | null = null;
      outer: for (const m of thread.messages) {
        if (!m.id) continue;
        const atts = await gmail.getMessageAttachments(m.id);
        for (const a of atts) {
          if (PDF_PATTERNS.some((re) => re.test(a.filename))) {
            buffer = await gmail.downloadAttachment(m.id, a.attachmentId);
            break outer;
          }
        }
      }
      if (!buffer) {
        // No PDF found — can't verify; keep it queued for manual review
        unknown++;
        details.push({
          pendingId: row.id,
          threadId: row.threadId,
          subject: row.subject,
          decision: "no_pdf",
        });
        continue;
      }

      const agents = await extract.extractAgentIdentities(buffer);
      const decision = DocumentExtractionService.agentMatchesAny(
        agents,
        identities,
      );

      if (decision === "no_match") {
        await prisma.pendingEmailMatch.update({
          where: { id: row.id },
          data: {
            status: "ignored",
            resolvedAt: new Date(),
          },
        });
        dismissed++;
      } else if (decision === "match") {
        kept++;
      } else {
        unknown++;
      }

      details.push({
        pendingId: row.id,
        threadId: row.threadId,
        subject: row.subject,
        decision,
        agents: [
          agents.listingAgent,
          agents.listingBroker,
          agents.sellingAgent,
          agents.sellingBroker,
        ].filter(Boolean) as string[],
      });
    } catch (err) {
      details.push({
        pendingId: row.id,
        threadId: row.threadId,
        subject: row.subject,
        decision: "error",
        agents: [err instanceof Error ? err.message.slice(0, 120) : String(err)],
      });
    }
  }

  return NextResponse.json({
    ok: true,
    inspected: rows.length,
    dismissed,
    kept,
    unknown,
    details,
  });
}

function resolveIdentities(settings: unknown): string[] {
  if (settings && typeof settings === "object") {
    const s = settings as Record<string, unknown>;
    if (Array.isArray(s.agentIdentities)) {
      const out = s.agentIdentities.filter(
        (x): x is string => typeof x === "string" && x.length > 0,
      );
      if (out.length > 0) return out;
    }
  }
  return DEFAULT_IDENTITIES;
}
