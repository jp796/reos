/**
 * POST /api/automation/search-gmail
 *
 * Ad-hoc Gmail scan scoped by user-provided criteria (name, address,
 * file number, etc.) and an optional doc-type filter. Returns
 * matching threads with subject / from / date / matching-attachment
 * filenames so the user can click through to take action.
 *
 * Purposely light-touch: does NOT auto-apply or create pending
 * queue rows. Just surfaces evidence.
 *
 * Body:
 *   {
 *     query:  string,                 // free text — name, address, file #
 *     type?:  "ss"|"em"|"invoice"|"contract"|"any"  (default "any")
 *     days?:  number                  // look-back window, default 365
 *     max?:   number                  // max threads, default 40
 *   }
 */

import { NextResponse, type NextRequest } from "next/server";
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

export const runtime = "nodejs";
export const maxDuration = 60;

const DOC_KEYWORDS: Record<string, string> = {
  ss: "(settlement OR \"closing disclosure\" OR ALTA OR HUD)",
  em: "(\"earnest money\" OR \"deposit received\" OR \"wire confirmation\")",
  invoice: "(invoice OR bill OR statement OR receipt)",
  contract: "(contract OR \"purchase agreement\" OR \"offer to purchase\")",
  any: "",
};

interface SearchBody {
  query?: string;
  type?: keyof typeof DOC_KEYWORDS;
  days?: number;
  max?: number;
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as SearchBody | null;
  const query = body?.query?.trim() ?? "";
  if (!query) {
    return NextResponse.json(
      { error: "query string required" },
      { status: 400 },
    );
  }
  if (query.length > 200) {
    return NextResponse.json(
      { error: "query too long (max 200 chars)" },
      { status: 400 },
    );
  }
  const type = body?.type ?? "any";
  const days = Math.min(Math.max(body?.days ?? 365, 7), 1095);
  const max = Math.min(Math.max(body?.max ?? 40, 1), 100);

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

  // Build Gmail query. Wrap query in quotes so multi-word names
  // match as phrases. Also search subject / from / to in parallel by
  // concatenating with OR.
  const safe = query.replace(/["\\]/g, "").trim();
  const userTerm = `("${safe}" OR from:"${safe}" OR to:"${safe}" OR subject:"${safe}")`;
  const kw = DOC_KEYWORDS[type] ?? "";
  const q = `newer_than:${days}d ${userTerm}${kw ? " " + kw : ""}`;

  const { threads } = await gmail.searchThreadsPaged({ q, maxTotal: max });

  const results: Array<{
    threadId: string;
    subject: string;
    from: string;
    date: string | null;
    snippet: string | null;
    attachments: string[];
    gmailUrl: string;
  }> = [];

  for (const t of threads) {
    const first = t.messages?.[0];
    if (!first?.id) continue;
    const subject =
      first.payload?.headers?.find((h) => h.name?.toLowerCase() === "subject")
        ?.value ?? "(no subject)";
    const from =
      first.payload?.headers?.find((h) => h.name?.toLowerCase() === "from")
        ?.value ?? "";
    const dateStr =
      first.payload?.headers?.find((h) => h.name?.toLowerCase() === "date")
        ?.value ?? null;
    const attNames: string[] = [];
    for (const m of t.messages ?? []) {
      if (!m.id) continue;
      try {
        const atts = await gmail.getMessageAttachments(m.id);
        for (const a of atts) {
          if (a.filename && !attNames.includes(a.filename))
            attNames.push(a.filename);
        }
      } catch {
        // skip
      }
    }
    results.push({
      threadId: t.id ?? "",
      subject: subject.slice(0, 160),
      from: from.slice(0, 160),
      date: dateStr,
      snippet: t.snippet?.slice(0, 200) ?? null,
      attachments: attNames.slice(0, 6),
      gmailUrl: `https://mail.google.com/mail/u/0/#inbox/${t.id ?? ""}`,
    });
  }

  return NextResponse.json({
    ok: true,
    query: safe,
    type,
    days,
    total: results.length,
    results,
  });
}
