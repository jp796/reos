/**
 * POST /api/integrations/fub/webhook
 *
 * Follow Up Boss webhook receiver. Validates the webhook secret, then hands
 * off to FollowUpBossService.handleWebhook.
 *
 * FUB webhook configuration:
 *   - Settings → Integrations → Webhooks → create webhook
 *   - Set URL to https://<your-domain>/api/integrations/fub/webhook
 *   - Copy secret to FUB_WEBHOOK_SECRET in .env.local
 *
 * Note: FUB's actual signature verification varies by account plan. This
 * route currently supports a shared-secret header check. Upgrade to HMAC
 * when FUB confirms signature format for your account.
 */

import { NextResponse, type NextRequest } from "next/server";
import type { FUBWebhookPayload } from "@/types/integrations";
import { prisma } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { env } from "@/lib/env";
import {
  FollowUpBossService,
  AutomationAuditService,
} from "@/services/integrations/FollowUpBossService";

export async function POST(req: NextRequest) {
  if (!env.FUB_WEBHOOK_SECRET) {
    return NextResponse.json(
      { error: "FUB_WEBHOOK_SECRET not configured" },
      { status: 500 },
    );
  }

  const provided =
    req.headers.get("x-fub-secret") ?? req.headers.get("x-webhook-secret");
  if (
    !provided ||
    !EncryptionService.constantTimeEqual(provided, env.FUB_WEBHOOK_SECRET)
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Resolve the account — MVP assumes a single account. Multi-tenant setups
  // should encode accountId in the webhook path or header.
  const account = await prisma.account.findFirst({
    select: { id: true, followUpBossApiKeyEncrypted: true },
  });
  if (!account) {
    return NextResponse.json({ error: "No account" }, { status: 400 });
  }
  if (!account.followUpBossApiKeyEncrypted) {
    return NextResponse.json(
      { error: "FUB not connected for this account" },
      { status: 400 },
    );
  }

  let payload: FUBWebhookPayload;
  try {
    payload = (await req.json()) as FUBWebhookPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const apiKey = env.FUB_API_KEY ?? "";
  const svc = new FollowUpBossService(
    account.id,
    {
      apiKey,
      systemKey: env.FUB_SYSTEM_KEY,
      webhookSecret: env.FUB_WEBHOOK_SECRET,
    },
    prisma,
    new AutomationAuditService(prisma),
  );

  try {
    await svc.handleWebhook(payload);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("FUB webhook handler error:", err);
    return NextResponse.json({ error: "handler_error" }, { status: 500 });
  }
}
