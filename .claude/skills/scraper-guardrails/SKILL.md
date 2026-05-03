---
name: ScraperGuardrails
description: |
  Hardens REOS against data scrapers and unauthorized automated access.
  Use when adding any new public endpoint, marketing surface, or page
  that touches user data — the skill enforces rate limits, auth gates,
  bot-detection, and compliant headers so adversarial scraping can't
  extract user transactions, contacts, leads, financials, or personal
  data via brute force, enumeration, or replay.

  USE WHEN: adding a public route; adding a public API; building a
  signup form / lead capture; exposing a `/share/*` link; opening any
  endpoint to unauthenticated traffic; reviewing security posture
  before a brokerage onboards; auditing potential PII leaks.
---

# ScraperGuardrails

Defense layers (apply ALL — defense in depth):

## Layer 1 — Authentication on every data path

Every route that returns user data MUST gate via `requireSession()` or
`requireOwner()` from `@/lib/require-session`. The middleware whitelist
in `src/middleware.ts` is the only allowed bypass; new entries require
explicit per-route bearer-secret or signature checks.

**Forbidden patterns:**
- Public routes that return `Contact`, `Transaction`, `Document`, or
  `User` data without auth.
- Predictable IDs (incrementing integers) on share-tokens. Use cuid /
  random tokens.
- "share by link" tokens without expiration.

**Required patterns:**
- `requireSession()` at the top of every API handler that reads or
  writes user-scoped data.
- `assertSameAccount(actor, row.accountId)` immediately after the row
  fetch — never trust client-supplied accountId or ID alone.

## Layer 2 — Rate limits

Every PUBLIC endpoint (no session required) must be rate-limited.
The order of preference:
1. Cloudflare in front of myrealestateos.com (set up rate-limit rules
   per path).
2. Upstash Redis token bucket (per IP, per endpoint).
3. Last resort: in-memory per-instance limiter (won't survive
   multi-instance scale-out).

Sensitive limits:
- `/api/intake` (public lead capture): 5 req / 5 min / IP
- `/api/auth/*`: NextAuth defaults
- Marketing landing `/`: 60 req / min / IP
- Any future signup: 3 req / hour / IP

## Layer 3 — Bot detection

- hCaptcha or Cloudflare Turnstile on every public form (intake,
  signup, contact).
- Honeypot fields (hidden `<input name="website">` that humans don't
  fill) — auto-reject submissions that include it.
- Submission velocity check (form-load → submit < 1.5 sec = bot).

## Layer 4 — Headers + CSP

`next.config.mjs` already sets:
- `Strict-Transport-Security` (HSTS preload-eligible)
- `X-Frame-Options: DENY` (no clickjacking)
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy` (camera/geolocation/payment locked down)
- `Cross-Origin-Opener-Policy: same-origin`

When adding public routes that embed third-party scripts, also set a
**nonce-based CSP** via `src/middleware.ts` — generate a per-request
nonce, attach to inline scripts, set `Content-Security-Policy` header.

## Layer 5 — robots.txt + AI-scraper opt-out

`public/robots.txt` disallows GPTBot, ClaudeBot, anthropic-ai, CCBot,
Google-Extended from training. Update this list whenever a new
crawler shows up in CommonCrawl / your access logs.

## Layer 6 — Field-level minimization

When returning JSON to the client:
- NEVER return `Contact.tagsJson` raw if it's used internally only.
- NEVER expose `Account.googleOauthTokensEncrypted` even encrypted.
- NEVER return `User.role` to a peer-user — only to the logged-in user
  about themselves.
- Strip `account.settingsJson` before any API response unless the
  field is whitelisted.

Audit pattern: every Prisma `findMany` / `findUnique` should use a
narrow `select: {...}` — never `include: { everything: true }` —
especially on routes that respond to non-admin clients.

## Layer 7 — Audit logging

`AutomationAuditLog` rows already capture every automation action.
Extend to capture:
- Failed auth attempts (route, ip, user-agent, timestamp).
- Out-of-account access attempts (assertSameAccount throws).
- Bulk-fetch patterns (a single user fetching > 100 rows / minute is
  worth a flag).

Build a `/settings/security` admin page later that exposes these.

## Layer 8 — Secret hygiene

Already enforced:
- All secrets in Google Secret Manager bound at deploy time
- `.env*` excluded from git via `.gitignore`
- `ENCRYPTION_KEY` per-tenant (Gmail tokens encrypted at rest)
- Webhook secrets (Stripe, Telegram) for inbound calls
- `SCAN_SCHEDULE_SECRET` for cron-only endpoints

Whenever a new third-party API is added (the SafeIntegrationGuard
skill handles this), also:
- Mint per-tenant credentials (not shared)
- Rotate every 90 days
- Document in `deploy/HANDOFF.md` under the secrets list

## Layer 9 — PII isolation

- Contacts table contains real-estate buyer/seller PII. Never log row
  contents to stdout — log IDs only.
- Stripe events log `customer_id` only, never email/name.
- Telegram brief includes deal addresses but never client phone /
  email.
- Atlas-chat context includes contact emails (necessary for the
  assistant to answer) — but the OpenAI request goes from the server,
  never client-side, and OpenAI's "no training" data policy applies
  to API calls.

## Layer 10 — Multi-tenant isolation (when v1.0 ships)

Before opening REOS to a 2nd brokerage:
1. Add row-level security on Postgres for `account_id` — every query
   must filter by the actor's accountId.
2. Audit every endpoint for accountId scoping.
3. Add an automated test that creates Account A + Account B, signs
   in as User A, attempts to read User B's transactions — must 404.

## Quick action checklist when this skill fires

When adding a new endpoint or surface, walk through:

- [ ] Auth gate (requireSession / requireOwner / bearer secret)?
- [ ] `assertSameAccount(actor, row.accountId)` after row fetch?
- [ ] Rate limit?
- [ ] Bot-detection on any public form?
- [ ] `select: {...}` narrow vs `include: everything`?
- [ ] Audit-log row written?
- [ ] No PII in console / stdout / Sentry?
- [ ] robots.txt + headers cover the path?
- [ ] If multi-tenant: tested cross-account access returns 404?

This list is the bar. Skipping any of it = security regression.
