# REOS Handoff Playbook

Complete inventory + transfer runbook for handing REOS to a new owner
(individual, brokerage, or acquirer). Written so the new owner can
take over without losing access, secrets, or running services.

---

## 1. Architecture (one-page mental model)

```
                       ┌──────────────────────────┐
                       │   myrealestateos.com     │
                       │   (GoDaddy DNS)          │
                       └──────────────┬───────────┘
                                      │
                       ┌──────────────▼───────────┐
                       │   Google Cloud Run       │
                       │   region: us-central1    │
                       │   service: reos          │
                       │   project: real-estate-  │
                       │            os-493719     │
                       └──┬───────────────────┬───┘
                          │                   │
                ┌─────────▼────────┐ ┌────────▼─────────┐
                │  Neon Postgres   │ │ Google Secret    │
                │  neondb          │ │ Manager (15+)    │
                └──────────────────┘ └──────────────────┘
                          │
                ┌─────────▼────────────────────────┐
                │  Cloud Scheduler                 │
                │   - reos-morning-tick (8am CT)   │
                │   - reos-utility-connect-tick    │
                │   - reos-postclose-tick (7am MT) │
                └──────────────────────────────────┘
```

---

## 2. Asset inventory

### Code

| Item | Location | Action on transfer |
|---|---|---|
| Source repo | (push to GitHub today — see §6) | GitHub `Transfer ownership` |
| Branch | `main` | New owner clones + redeploys |
| Build pipeline | `cloudbuild.yaml` (Cloud Build) | Migrates with GCP project |

### Infrastructure (Google Cloud)

| Service | ID / name | Notes |
|---|---|---|
| GCP project | `real-estate-os-493719` | Project number `445962667828` |
| Cloud Run service | `reos` (region `us-central1`) | `https://reos-wirr7eey4q-uc.a.run.app` |
| Custom domain | `myrealestateos.com` | DNS via GoDaddy → Cloud Run domain mapping |
| Artifact Registry | `reos` repo (us-central1) | Container images |
| Cloud Build | trigger fires from `gcloud builds submit .` | Manual deploys today; can be Git-trigger-based |
| Cloud Scheduler | `reos-morning-tick`, `reos-utility-connect-tick`, `reos-postclose-tick` | All in us-central1 |
| Cloud Logging | "reos" service logs | Default 30-day retention |
| Error Reporting | Auto-detects from Cloud Logging | Configured |
| Uptime check | `reos-health-RiGlwWwa49g` (every 5 min) | Alerts → email |
| Notification channel | jp@titanreteam.com | Update on transfer |

### Database

| Item | Where | Notes |
|---|---|---|
| Neon Postgres | Neon org under `jp@titanreteam.com` | Pooled URL in `DATABASE_URL` secret |
| Database name | `neondb` | All app data here |
| Branches | `main` (production) | Add `staging` branch for safe migrations |
| Backups | Neon point-in-time recovery (7-day default) | Verify retention on transfer |
| Migrations | `prisma/migrations/` | Run via `npx prisma migrate deploy` |

### Third-party accounts (NOT inside GCP)

| Provider | What it powers | Account owner | Transfer method |
|---|---|---|---|
| **GoDaddy** | `myrealestateos.com` domain | jp@titanreteam.com | GoDaddy domain transfer |
| **OpenAI** | gpt-4o-mini (Atlas chat, classifier, summarizer) | jp@titanreteam.com | Buyer creates own key, swap secret |
| **Telegram** `@REOSAtlasBot` | Daily brief + 2-way chat | Jp's Telegram | `/transferbot` to BotFather |
| **Utility Connect** | Buyer utility auto-enroll | Partner code `real` | UC support; buyer re-credentials |
| **Follow Up Boss** (optional) | CRM sync | Customer's own FUB | Buyer wires their FUB key |
| **Anthropic** (optional) | Future Claude usage | Currently `unset` | Mint when needed |
| **Gemini** (placeholder) | Currently `unset` | — | Skip if staying on OpenAI |

### Secrets in Google Secret Manager

All bound to Cloud Run via `cloudbuild.yaml --set-secrets`. Migrate
with GCP project. Buyer should rotate every secret post-transfer
(see §5).

```
DATABASE_URL                  Neon connection string
AUTH_SECRET                   NextAuth session encryption (32+ chars)
AUTH_URL                      https://myrealestateos.com
AUTH_ALLOWED_EMAILS           Comma list of allowlisted Google accounts
AUTH_GOOGLE_ID                NextAuth OAuth client id
AUTH_GOOGLE_SECRET            NextAuth OAuth client secret
GOOGLE_CLIENT_ID              Gmail integration OAuth client id
GOOGLE_CLIENT_SECRET          Gmail integration OAuth client secret
GOOGLE_REDIRECT_URI           Gmail OAuth callback
ENCRYPTION_KEY                AES-256 hex (encrypts Gmail tokens) — DO NOT ROTATE
                              (rotation invalidates every stored OAuth token)
NEXT_PUBLIC_APP_URL           https://myrealestateos.com
OWNER_EMAIL_ALIASES           Owner emails excluded from SmartFolder search
SCAN_SCHEDULE_SECRET          Bearer token for cron endpoints
OPENAI_API_KEY                OpenAI; rotate on transfer
ANTHROPIC_API_KEY             "unset" placeholder; mint if used
GEMINI_API_KEY                "unset" placeholder
UC_USER / UC_PASS / UC_PARTNER_CODE / UC_BASE_URL   Utility Connect creds
TELEGRAM_BOT_TOKEN            BotFather token
TELEGRAM_CHAT_ID              Recipient chat id
TELEGRAM_WEBHOOK_SECRET       32-hex shared secret on Telegram webhook
```

### People + access

| Email | Role | Access |
|---|---|---|
| jp@titanreteam.com | Owner (REOS account + GCP) | Everything |
| elkcitytc@gmail.com | Coordinator (REOS app) | Vicki — TC |

---

## 3. How to deploy from scratch (new-owner runbook)

Assuming buyer has the repo + has been added to the GCP project:

```bash
# One-time setup
gcloud config set project real-estate-os-493719
gcloud auth login

# Deploy
cd <repo>
gcloud builds submit --config cloudbuild.yaml .
```

Cloud Build builds the container, pushes to Artifact Registry,
deploys to Cloud Run with secrets bound. ~3 min end-to-end.

Custom-domain DNS lives in GoDaddy. The Cloud Run domain mapping is
already provisioned for `myrealestateos.com`.

---

## 4. Cron schedule (so the new owner knows what runs when)

| Job | Schedule | Endpoint |
|---|---|---|
| Morning tick | 8:00am Central daily | `POST /api/automation/morning-tick` |
| Utility Connect tick | 7:30am MT daily | `POST /api/automation/utility-connect/tick` |
| Post-close tick | hourly (or daily) | `POST /api/automation/post-close/tick` |

All authenticated via `Bearer SCAN_SCHEDULE_SECRET` header set by
Cloud Scheduler.

---

## 5. Transfer playbook (zero-loss order)

Do these IN ORDER. Don't revoke your access until step 7.

1. **GitHub** — `Settings → Transfer ownership` to buyer's account
2. **GoDaddy domain** — initiate transfer to buyer's GoDaddy (5-7 day window)
3. **Neon Postgres** — `Project settings → Transfer to organization` → buyer's org
4. **GCP project** — Console → IAM → add buyer as Owner. Buyer enables billing on their billing account; switch project to their billing account
5. **Telegram bot** — In BotFather, `/transferbot` → `@REOSAtlasBot` → buyer's Telegram
6. **Buyer rotates secrets** (see §6) — does NOT rotate `ENCRYPTION_KEY`
7. **You step down** — remove yourself from GCP IAM, Neon, GitHub. Verify buyer can deploy + serve traffic.

---

## 6. Secret rotation checklist (post-transfer)

Buyer should rotate immediately:

- [ ] `AUTH_SECRET` — `openssl rand -base64 48`
- [ ] `SCAN_SCHEDULE_SECRET` — `openssl rand -hex 32`
- [ ] `OPENAI_API_KEY` — mint at platform.openai.com
- [ ] `TELEGRAM_BOT_TOKEN` — re-issue via BotFather `/revoke`
- [ ] `TELEGRAM_WEBHOOK_SECRET` — `openssl rand -hex 32` + re-register webhook
- [ ] `UC_USER` / `UC_PASS` — UC issues new credentials
- [ ] `AUTH_GOOGLE_SECRET` / `GOOGLE_CLIENT_SECRET` — rotate in Google Cloud OAuth console

DO NOT rotate:

- `ENCRYPTION_KEY` — rotation invalidates every stored encrypted Gmail
  OAuth token. Users would have to reconnect Gmail. Only rotate if
  there's a known compromise + you're prepared to ask everyone to
  reconnect.

---

## 7. Documentation index

| Doc | Path | What it covers |
|---|---|---|
| README | `README.md` | Local dev setup |
| Deploy runbook | `deploy/CLOUD_RUN_RUNBOOK.md` | Step-by-step deploy + troubleshooting |
| Handoff | `deploy/HANDOFF.md` (this file) | Asset inventory + transfer playbook |
| Architecture | (in this doc, §1) | One-page mental model |

---

## 8. Valuation reference (informational)

A pre-revenue vertical SaaS at this build maturity — ~6 weeks of
senior dev work, full real-estate-vertical features, multi-tenant
abstraction, Russell-Brunson-style funnel — typically sells in the
**$25k–$75k tech-only band** (no MRR).

With paying agents the math changes:

| ARR | Comparable multiple | Sale band |
|---|---|---|
| $50k ARR (40-50 agents) | 3-5× | $150k-$250k |
| $200k ARR (~170 agents) | 4-6× | $800k-$1.2M |
| $500k+ ARR | 5-8× | $2.5M-$4M+ |

For acquirers in the proptech space (e.g. brokerage holding cos,
existing TC-platform players consolidating): expect higher
multiples on top of these.

---

*Last updated: 2026-05-01 · Maintained alongside deploy/CLOUD_RUN_RUNBOOK.md*
