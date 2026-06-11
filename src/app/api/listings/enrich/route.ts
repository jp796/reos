/**
 * POST /api/listings/enrich
 * Body: { sellerName: string, propertyAddress?: string }
 *
 * "Pull remaining info from Gmail" — given a seller name (and
 * optionally the property address) from the new-listing form,
 * search the connected Gmail for correspondence with that person
 * and return their email + phone so the form can fill the fields
 * the listing agreement didn't carry.
 *
 * Deterministic, no AI call:
 *   email — parse From/To/Cc headers across matching threads,
 *           keep addresses whose display name shares tokens with
 *           the seller name, rank by (token hits, From > To, count)
 *   phone — regex over the matched sender's message bodies +
 *           snippets (signatures are where phones live)
 *
 * Excludes the owner's own aliases and no-reply addresses so JP's
 * own outbound mail never wins the ranking.
 */

import { NextResponse, type NextRequest } from "next/server";
import type { gmail_v1 } from "googleapis";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { getEncryptionService } from "@/lib/encryption";
import { requireSession } from "@/lib/require-session";
import {
  GoogleOAuthService,
  DEFAULT_SCOPES,
} from "@/services/integrations/GoogleOAuthService";
import {
  GmailService,
  EmailTransactionMatchingService,
} from "@/services/integrations/GmailService";
import { logError } from "@/lib/log";

export const runtime = "nodejs";
export const maxDuration = 60;

const PHONE_RE =
  /(?:\+?1[\s.-]?)?\(?\b(\d{3})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})\b/g;

interface Candidate {
  email: string;
  name: string;
  tokenHits: number;
  fromCount: number;
  toCount: number;
}

function parseAddressList(header: string): Array<{ name: string; email: string }> {
  // Handles: `Jane Doe <jane@x.com>, "Doe, John" <john@x.com>, bare@x.com`
  const out: Array<{ name: string; email: string }> = [];
  const re = /(?:"?([^"<>,]*)"?\s*)?<([^<>\s]+@[^<>\s]+)>|([^\s,<>]+@[^\s,<>]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(header)) !== null) {
    const email = (m[2] ?? m[3] ?? "").toLowerCase().trim();
    if (!email) continue;
    out.push({ name: (m[1] ?? "").trim(), email });
  }
  return out;
}

function nameTokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && t !== "and" && t !== "the");
}

function decodeBody(payload: gmail_v1.Schema$MessagePart | undefined): string {
  if (!payload) return "";
  let text = "";
  if (payload.mimeType?.startsWith("text/") && payload.body?.data) {
    try {
      text += Buffer.from(payload.body.data, "base64url").toString("utf8");
    } catch {
      /* skip undecodable part */
    }
  }
  for (const part of payload.parts ?? []) {
    text += "\n" + decodeBody(part);
  }
  return text;
}

export async function POST(req: NextRequest) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  let body: { sellerName?: string; propertyAddress?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const sellerName = body.sellerName?.trim() ?? "";
  if (sellerName.length < 3) {
    return NextResponse.json(
      { error: "sellerName required (fill the Name field first)" },
      { status: 400 },
    );
  }

  const account = await prisma.account.findUnique({
    where: { id: actor.accountId },
    select: { id: true, googleOauthTokensEncrypted: true },
  });
  if (!account?.googleOauthTokensEncrypted) {
    return NextResponse.json(
      { error: "Gmail not connected — connect it in Settings → Integrations" },
      { status: 412 },
    );
  }
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REDIRECT_URI) {
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

  try {
    const gAuth = await oauth.createAuthenticatedClient(account.id);
    const gmail = new GmailService(
      account.id,
      gAuth,
      {
        labelPrefix: "REOS/",
        autoOrganizeThreads: false,
        extractAttachments: false,
        batchSize: 10,
        rateLimitDelayMs: 100,
      },
      prisma,
      new EmailTransactionMatchingService(),
    );

    // Search by seller name; widen with the street line of the
    // address when provided (first comma-segment, quotes stripped).
    const safeName = sellerName.replace(/["\\]/g, "").trim();
    const street = (body.propertyAddress ?? "").split(",")[0].replace(/["\\]/g, "").trim();
    const terms = [`"${safeName}"`, `from:"${safeName}"`, `to:"${safeName}"`];
    if (street.length >= 5) terms.push(`"${street}"`);
    const q = `newer_than:730d (${terms.join(" OR ")})`;

    const { threads } = await gmail.searchThreads({ q, maxResults: 15 });

    // Owner aliases + connected address never count as the seller.
    const ownEmails = new Set(
      (env.OWNER_EMAIL_ALIASES ?? "")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    );

    const tokens = nameTokens(sellerName);
    const candidates = new Map<string, Candidate>();
    const bodiesByEmail = new Map<string, string[]>();

    for (const t of threads) {
      for (const msg of t.messages ?? []) {
        const headers = msg.payload?.headers ?? [];
        const hv = (n: string) =>
          headers.find((h) => h.name?.toLowerCase() === n)?.value ?? "";
        const fromList = parseAddressList(hv("from"));
        const toList = [
          ...parseAddressList(hv("to")),
          ...parseAddressList(hv("cc")),
        ];

        const consider = (
          entry: { name: string; email: string },
          dir: "from" | "to",
        ) => {
          const email = entry.email;
          if (ownEmails.has(email)) return;
          if (/no-?reply|notifications?@|mailer|donotreply/i.test(email)) return;
          const hayTokens = nameTokens(`${entry.name} ${email.split("@")[0]}`);
          const hits = tokens.filter((tk) =>
            hayTokens.some((h) => h.includes(tk) || tk.includes(h)),
          ).length;
          if (hits === 0) return;
          const cur =
            candidates.get(email) ??
            ({ email, name: entry.name, tokenHits: 0, fromCount: 0, toCount: 0 } as Candidate);
          cur.tokenHits = Math.max(cur.tokenHits, hits);
          if (dir === "from") cur.fromCount++;
          else cur.toCount++;
          if (entry.name && !cur.name) cur.name = entry.name;
          candidates.set(email, cur);
        };

        fromList.forEach((e) => consider(e, "from"));
        toList.forEach((e) => consider(e, "to"));

        // Stash bodies keyed by the From address for the phone pass.
        const fromEmail = fromList[0]?.email;
        if (fromEmail && !ownEmails.has(fromEmail)) {
          const text =
            decodeBody(msg.payload ?? undefined) + "\n" + (msg.snippet ?? "");
          const arr = bodiesByEmail.get(fromEmail) ?? [];
          if (arr.length < 5) arr.push(text.slice(0, 8000));
          bodiesByEmail.set(fromEmail, arr);
        }
      }
    }

    const ranked = Array.from(candidates.values()).sort(
      (a, b) =>
        b.tokenHits - a.tokenHits ||
        b.fromCount - a.fromCount ||
        b.toCount - a.toCount,
    );
    const best = ranked[0] ?? null;

    // Phone: scan the chosen sender's bodies; fall back to scanning
    // everything that matched if their own messages carry no number.
    let phone: string | null = null;
    const scanForPhone = (texts: string[]) => {
      for (const text of texts) {
        PHONE_RE.lastIndex = 0;
        const m = PHONE_RE.exec(text);
        if (m) return `(${m[1]}) ${m[2]}-${m[3]}`;
      }
      return null;
    };
    if (best) {
      phone = scanForPhone(bodiesByEmail.get(best.email) ?? []);
    }
    if (!phone && best) {
      phone = scanForPhone(
        Array.from(bodiesByEmail.values()).flat(),
      );
    }

    return NextResponse.json({
      ok: true,
      threadsScanned: threads.length,
      sellerEmail: best?.email ?? null,
      sellerEmailName: best?.name ?? null,
      sellerPhone: phone,
      otherCandidates: ranked.slice(1, 4).map((c) => c.email),
    });
  } catch (e) {
    logError(e, {
      route: "/api/listings/enrich",
      accountId: actor.accountId,
      userId: actor.userId,
    });
    const msg = e instanceof Error ? e.message : "enrich failed";
    return NextResponse.json(
      { error: `Gmail lookup failed: ${msg.slice(0, 200)}` },
      { status: 502 },
    );
  }
}
