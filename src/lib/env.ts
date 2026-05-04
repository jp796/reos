/**
 * Typed, validated env var access.
 * Import `env` instead of reading `process.env` directly — missing/bad values
 * fail loudly at startup rather than silently at the worst possible moment.
 */

import { z } from "zod";

const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),

  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().optional(),

  ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, "ENCRYPTION_KEY must be 64 hex chars"),

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().url().optional(),

  // NextAuth v5 — these gate multi-user sign-in. Marked optional so
  // the app can still boot in single-user dev without auth wired up,
  // but `src/auth.ts` warns on startup if any are missing in prod.
  AUTH_SECRET: z
    .string()
    .min(32, "AUTH_SECRET must be at least 32 chars (openssl rand -base64 32)")
    .optional(),
  AUTH_TRUST_HOST: z.string().optional(),
  AUTH_ALLOWED_EMAILS: z.string().optional(),
  AUTH_GOOGLE_ID: z.string().optional(),
  AUTH_GOOGLE_SECRET: z.string().optional(),
  // Additional email aliases that belong to the account owner but
  // aren't allowed to sign in (e.g. a personal gmail). Any email
  // listed here is excluded from SmartFolder queries + enrichment
  // so the filter doesn't match every message to/from the owner.
  OWNER_EMAIL_ALIASES: z.string().optional(),

  FUB_API_KEY: z.string().optional(),
  FUB_SYSTEM_KEY: z.string().default("real-estate-os"),
  FUB_WEBHOOK_SECRET: z.string().optional(),

  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),

  // Shared secret for scheduled / external scan invocations. If unset,
  // the scan endpoint rejects external calls entirely (same-origin UI
  // calls still work).
  SCAN_SCHEDULE_SECRET: z.string().optional(),

  // Sentry — optional. When set, both client + server SDKs initialize
  // and uncaught errors / 5xx responses are captured.
  NEXT_PUBLIC_SENTRY_DSN: z.string().optional(),
  SENTRY_DSN: z.string().optional(),

  // Utility Connect — partner-side credentials for buyer-utility
  // enrollment. Optional so non-UC accounts run unaffected; the
  // enrollment endpoints fail closed when missing.
  UC_USER: z.string().optional(),
  UC_PASS: z.string().optional(),
  UC_PARTNER_CODE: z.string().optional(),
  UC_BASE_URL: z.string().url().optional(),

  // Telegram bot for morning brief delivery. Both required to fire;
  // when either is missing the morning tick still runs but skips the
  // notification step.
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
  /** Shared secret used as `X-Telegram-Bot-Api-Secret-Token` header
   * when Telegram POSTs to our webhook — proves the request really
   * came from Telegram (set via setWebhook). */
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),

  /** Google AI Studio (Gemini) API key — used by AtlasChatService.
   * Free tier covers a single-user chat workload comfortably. */
  GEMINI_API_KEY: z.string().optional(),

  /** Stripe — billing. All optional so the app boots even before the
   * Stripe account is wired. Tier gating becomes active when keys
   * are present. */
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_ID_SOLO: z.string().optional(),
  STRIPE_PRICE_ID_TEAM: z.string().optional(),
  STRIPE_PRICE_ID_BROKERAGE: z.string().optional(),

  /** Web Push (VAPID). When all three are set, the in-app
   * "Notifications" toggle subscribes the browser; MorningTick fans
   * out to every active subscription. Public key is exposed to the
   * client; private + subject stay server-only. */
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  /** mailto:address — required by RFC 8292 so push providers can
   * contact us about abusive subscriptions. */
  VAPID_SUBJECT: z.string().optional(),
});

// Skip validation during `next build` — Cloud Run injects secrets
// at runtime, not build time. Build-phase imports get a permissive
// passthrough; runtime validation still fires loudly.
const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";
const parsed = schema.safeParse(process.env);

if (!parsed.success && !isBuildPhase) {
  console.error(
    "❌ Invalid environment variables:",
    parsed.error.flatten().fieldErrors,
  );
  throw new Error("Environment validation failed (see src/lib/env.ts)");
}

export const env = parsed.success
  ? parsed.data
  : (process.env as unknown as z.infer<typeof schema>);
export type Env = typeof env;
