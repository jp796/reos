/**
 * POST /api/automation/scan-title-orders
 *
 * Body/query params (all optional):
 *   ?days=7                  — how far back to scan (default 7)
 *   ?max=50                  — max threads to scan (default 50)
 *   ?threshold=0.7           — confidence cutoff for auto-apply
 *   ?pendingStage=Pending    — FUB stage name to transition to
 *
 * Runs the TitleOrderOrchestrator and returns the scan result.
 *
 * Requires:
 *   - Google OAuth connected (for Gmail access + label write)
 *   - FUB_API_KEY set (for stage update)
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { getEncryptionService } from "@/lib/encryption";
import {
  GoogleOAuthService,
  GoogleServiceFactory,
  DEFAULT_SCOPES,
} from "@/services/integrations/GoogleOAuthService";
import { GmailService } from "@/services/integrations/GmailService";
import { GmailLabelService } from "@/services/integrations/GmailLabelService";
import { EmailTransactionMatchingService } from "@/services/integrations/GmailService";
import {
  FollowUpBossService,
  AutomationAuditService,
} from "@/services/integrations/FollowUpBossService";
import { TransactionService } from "@/services/core/TransactionService";
import {
  TitleOrderOrchestrator,
  resolveOrchestratorConfig,
} from "@/services/automation/TitleOrderOrchestrator";

export async function POST(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const daysBack = clampInt(p.get("days"), 1, 90, 7);
  const maxThreads = clampInt(p.get("max"), 1, 500, 50);
  const threshold = clampFloat(p.get("threshold"), 0, 1, undefined);
  const pendingStage = p.get("pendingStage") ?? undefined;

  // Scheduled invocations must carry the secret; browser-initiated calls
  // (from the in-app button) are allowed. Distinguish by presence of a
  // same-origin Referer/Origin header matching our own app URL.
  const scheduledSecret = process.env.SCAN_SCHEDULE_SECRET;
  const provided = req.headers.get("x-reos-schedule-secret") ?? "";
  const origin = req.headers.get("origin") ?? req.headers.get("referer") ?? "";
  const isFromApp = origin.startsWith(env.NEXT_PUBLIC_APP_URL);
  if (!isFromApp) {
    // External call — require secret if one is configured.
    if (!scheduledSecret || provided !== scheduledSecret) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  if (!env.FUB_API_KEY) {
    return NextResponse.json(
      { error: "FUB_API_KEY not configured" },
      { status: 500 },
    );
  }
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REDIRECT_URI) {
    return NextResponse.json(
      { error: "GOOGLE_* env vars not configured" },
      { status: 500 },
    );
  }

  const account = await prisma.account.findFirst({
    select: { id: true, settingsJson: true, googleOauthTokensEncrypted: true },
  });
  if (!account) {
    return NextResponse.json(
      { error: "No account — run `npm run db:seed`" },
      { status: 500 },
    );
  }
  if (!account.googleOauthTokensEncrypted) {
    return NextResponse.json(
      {
        error: "Google not connected",
        connectUrl: `/api/auth/google?accountId=${account.id}`,
      },
      { status: 412 },
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

  const startedAt = Date.now();
  try {
    const gAuth = await oauth.createAuthenticatedClient(account.id);

    const audit = new AutomationAuditService(prisma);
    const fub = new FollowUpBossService(
      account.id,
      {
        apiKey: env.FUB_API_KEY,
        systemKey: env.FUB_SYSTEM_KEY,
        webhookSecret: env.FUB_WEBHOOK_SECRET,
      },
      prisma,
      audit,
    );
    const gmail = new GmailService(
      account.id,
      gAuth,
      {
        labelPrefix: "REOS/",
        autoOrganizeThreads: true,
        extractAttachments: true,
        batchSize: 50,
        rateLimitDelayMs: 100,
      },
      prisma,
      new EmailTransactionMatchingService(),
    );
    const labels = new GmailLabelService(gAuth);
    const txnSvc = new TransactionService(prisma);

    // Load Google-connected user email so we can exclude self-matches.
    const stored = await oauth.getStoredTokens(account.id);
    const ownerEmail = stored?.userEmail?.toLowerCase();
    const selfEmailsBase: string[] = ownerEmail ? [ownerEmail] : [];

    const config = resolveOrchestratorConfig(account.settingsJson, {
      daysBack,
      maxThreads,
      confidenceThreshold: threshold,
      pendingStage,
      selfEmails: selfEmailsBase,
    });

    const orchestrator = new TitleOrderOrchestrator(
      account.id,
      prisma,
      gmail,
      labels,
      fub,
      audit,
      txnSvc,
      config,
    );

    const result = await orchestrator.scan();
    return NextResponse.json({
      ok: true,
      durationMs: Date.now() - startedAt,
      result,
    });
  } catch (err) {
    console.error("Title-order scan failed:", err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "scan failed",
        durationMs: Date.now() - startedAt,
      },
      { status: 500 },
    );
  }
}

// ==================================================
// helpers
// ==================================================

function clampInt(raw: string | null, min: number, max: number, fallback: number): number {
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

function clampFloat(
  raw: string | null,
  min: number,
  max: number,
  fallback: number | undefined,
): number | undefined {
  if (!raw) return fallback;
  const n = parseFloat(raw);
  if (Number.isNaN(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}
