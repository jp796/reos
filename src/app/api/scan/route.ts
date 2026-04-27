/**
 * POST /api/scan — unified scan dispatcher.
 *
 * Replaces the per-type scan buttons (`scan-accepted-contracts`,
 * `scan-earnest-money`, `scan-invoices`, `scan-title-orders`,
 * `search-gmail`) with one entry point. The page picks intent from
 * a dropdown; this route forwards to the underlying service and
 * stamps a ScanRun row for history.
 *
 * Body:
 *   {
 *     type:    "contract" | "earnest_money" | "invoice" | "title_order"
 *              | "stale_contact" | "search" | "smart"
 *     window?: number   // days look-back, default 90
 *     query?:  string   // free-text (search type) or sender filter
 *   }
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { requireSession } from "@/lib/require-session";
import { getEncryptionService } from "@/lib/encryption";
import {
  GoogleOAuthService,
  DEFAULT_SCOPES,
} from "@/services/integrations/GoogleOAuthService";
import {
  GmailService,
  EmailTransactionMatchingService,
} from "@/services/integrations/GmailService";
import { AcceptedContractScanService } from "@/services/automation/AcceptedContractScanService";
import { ContractExtractionService } from "@/services/ai/ContractExtractionService";
import { InvoiceScanService } from "@/services/automation/InvoiceScanService";

export const runtime = "nodejs";
export const maxDuration = 120;

type ScanType =
  | "contract"
  | "earnest_money"
  | "invoice"
  | "title_order"
  | "stale_contact"
  | "search"
  | "smart";

interface Body {
  type: ScanType;
  window?: number;
  query?: string;
}

export async function POST(req: NextRequest) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body?.type) {
    return NextResponse.json({ error: "type required" }, { status: 400 });
  }
  const window = Math.min(Math.max(body.window ?? 90, 7), 1095);
  const query = (body.query ?? "").trim().slice(0, 200);

  const account = await prisma.account.findUnique({
    where: { id: actor.accountId },
    select: {
      id: true,
      googleOauthTokensEncrypted: true,
      settingsJson: true,
    },
  });
  if (!account) {
    return NextResponse.json({ error: "account not found" }, { status: 404 });
  }

  const settings = (account.settingsJson ?? {}) as Record<string, unknown>;
  const trustedSenders = Array.isArray(settings.trustedTcSenders)
    ? (settings.trustedTcSenders as unknown[]).filter(
        (x): x is string => typeof x === "string",
      )
    : [];

  // Stamp the run start so a slow scan still records intent.
  const run = await prisma.scanRun.create({
    data: {
      accountId: account.id,
      scanType: body.type,
      source: "gmail",
      paramsJson: { window, query, trustedSenders } as object,
    },
  });

  async function finish(hits: number, err?: string) {
    await prisma.scanRun.update({
      where: { id: run.id },
      data: {
        finishedAt: new Date(),
        hitsCount: hits,
        errorText: err ?? null,
      },
    });
  }

  // Most scan types need Gmail; resolve once.
  let gmail: GmailService | null = null;
  if (
    body.type !== "stale_contact" &&
    account.googleOauthTokensEncrypted &&
    env.GOOGLE_CLIENT_ID &&
    env.GOOGLE_CLIENT_SECRET &&
    env.GOOGLE_REDIRECT_URI
  ) {
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
    gmail = new GmailService(
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
  }

  try {
    if (body.type === "contract" || body.type === "smart") {
      if (!gmail) {
        await finish(0, "Google not connected");
        return NextResponse.json(
          { error: "Google not connected" },
          { status: 412 },
        );
      }
      if (!env.OPENAI_API_KEY) {
        await finish(0, "OPENAI_API_KEY not configured");
        return NextResponse.json(
          { error: "OPENAI_API_KEY not configured" },
          { status: 500 },
        );
      }
      const svc = new AcceptedContractScanService(
        prisma,
        gmail,
        new ContractExtractionService(env.OPENAI_API_KEY),
      );
      const result = await svc.scan({ days: window, trustedSenders });
      await finish(result.hits.length);
      return NextResponse.json({ ok: true, type: body.type, ...result });
    }

    if (body.type === "invoice") {
      if (!gmail) {
        await finish(0, "Google not connected");
        return NextResponse.json(
          { error: "Google not connected" },
          { status: 412 },
        );
      }
      const svc = new InvoiceScanService(prisma, gmail);
      const result = await svc.scanAll(account.id);
      const hits =
        (result as unknown as { created?: number }).created ??
        (result as unknown as { hits?: number }).hits ??
        0;
      await finish(hits);
      return NextResponse.json({ ok: true, type: body.type, ...result });
    }

    if (body.type === "search") {
      if (!gmail) {
        await finish(0, "Google not connected");
        return NextResponse.json(
          { error: "Google not connected" },
          { status: 412 },
        );
      }
      if (!query) {
        await finish(0, "query required");
        return NextResponse.json(
          { error: "query required for search" },
          { status: 400 },
        );
      }
      const safe = query.replace(/["\\]/g, "");
      const q = `newer_than:${window}d ("${safe}" OR from:"${safe}" OR to:"${safe}" OR subject:"${safe}")`;
      const { threads } = await gmail.searchThreadsPaged({ q, maxTotal: 40 });
      const hits = threads.map((t) => {
        const m = t.messages?.[0];
        const get = (n: string) =>
          m?.payload?.headers?.find((h) => h.name?.toLowerCase() === n)
            ?.value ?? "";
        return {
          threadId: t.id ?? "",
          subject: get("subject").slice(0, 160),
          from: get("from").slice(0, 160),
          date: get("date") || null,
          snippet: t.snippet?.slice(0, 200) ?? null,
          gmailUrl: `https://mail.google.com/mail/u/0/#inbox/${t.id ?? ""}`,
        };
      });
      await finish(hits.length);
      return NextResponse.json({
        ok: true,
        type: body.type,
        query,
        hits,
      });
    }

    // earnest_money / title_order / stale_contact: forward to existing
    // endpoints internally — they already do their own auth, audit,
    // and orchestration. Just count what they returned.
    const passthroughMap: Record<string, string> = {
      earnest_money: "/api/automation/scan-earnest-money",
      title_order: "/api/automation/scan-title-orders",
      stale_contact: "/api/automation/stale-contact-ss-check",
    };
    const path = passthroughMap[body.type];
    if (!path) {
      await finish(0, `unknown type: ${body.type}`);
      return NextResponse.json(
        { error: `unknown type: ${body.type}` },
        { status: 400 },
      );
    }
    const url = new URL(path, req.url);
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: req.headers.get("cookie") ?? "",
      },
      body: JSON.stringify({ days: window }),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const hitsCount =
      typeof data.created === "number"
        ? data.created
        : typeof data.scanned === "number"
          ? data.scanned
          : 0;
    await finish(hitsCount);
    return NextResponse.json({ ok: res.ok, type: body.type, ...data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await finish(0, msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
