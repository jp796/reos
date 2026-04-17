# Real Estate OS

Private AI transaction chief of staff + business intelligence dashboard.
Integrates Follow Up Boss, Gmail, and Google Calendar; extracts dates from
PDFs; tracks transactions, milestones, deadlines, and commission/CAC/ROI.

## Stack

- Next.js 15 (App Router) + TypeScript (strict)
- Prisma 5 + PostgreSQL 16
- `googleapis` / `google-auth-library` for Gmail + Calendar
- Follow Up Boss v1 REST API (HTTP Basic auth)
- Tailwind CSS 3
- AES-256-GCM token encryption (scrypt KDF)
- zod env validation

## Local dev — first run

```bash
# 1. install
pnpm install

# 2. env
cp .env.example .env.local
# Generate an ENCRYPTION_KEY and paste into .env.local:
openssl rand -hex 32

# 3. start local Postgres
docker compose up -d

# 4. migrate + seed
pnpm db:migrate
pnpm db:seed

# 5. verify encryption round-trip
pnpm crypto:test

# 6. run
pnpm dev
# → http://localhost:3000
# → health: http://localhost:3000/api/health
```

## Scripts

| Script            | What it does                                |
| ----------------- | ------------------------------------------- |
| `pnpm dev`        | Next dev server                             |
| `pnpm build`      | Production build                            |
| `pnpm typecheck`  | `tsc --noEmit`                              |
| `pnpm db:migrate` | Create + apply a Prisma migration           |
| `pnpm db:reset`   | Drop + recreate local DB                    |
| `pnpm db:studio`  | Prisma Studio UI                            |
| `pnpm db:validate`| Validate `prisma/schema.prisma`             |
| `pnpm db:seed`    | Seed owner account + source channels        |
| `pnpm crypto:test`| Round-trip + tamper-detection smoke test    |

## Directory layout

```
real-estate-os/
├── prisma/
│   ├── schema.prisma        # 15 models, fixes applied over architecture artifact
│   └── seed.ts
├── src/
│   ├── app/                 # Next 15 App Router
│   │   ├── page.tsx
│   │   ├── layout.tsx
│   │   ├── globals.css
│   │   └── api/
│   │       ├── health/route.ts
│   │       ├── auth/google/route.ts
│   │       ├── auth/google/callback/route.ts
│   │       └── integrations/fub/webhook/route.ts
│   ├── lib/
│   │   ├── db.ts            # Prisma singleton (dev hot-reload safe)
│   │   ├── env.ts           # Zod-validated env
│   │   ├── encryption.ts    # AES-256-GCM + scrypt (rewritten)
│   │   └── encryption.test.ts
│   ├── services/
│   │   ├── integrations/
│   │   │   ├── GoogleOAuthService.ts
│   │   │   ├── GoogleCalendarService.ts
│   │   │   ├── GmailService.ts
│   │   │   └── FollowUpBossService.ts
│   │   ├── core/            # Phase 1 week 3+: TransactionService, MilestoneService…
│   │   ├── ai/              # Phase 4: document extraction, summaries
│   │   ├── automation/      # Phase 6: rule engine
│   │   ├── background/      # BullMQ jobs
│   │   └── shared/
│   └── types/
│       ├── index.ts
│       ├── integrations.ts
│       └── ai.ts
├── docker-compose.yml       # Postgres 16 on port 5433
├── next.config.mjs
├── tailwind.config.ts
├── postcss.config.mjs
├── tsconfig.json
├── package.json
├── .env.example
└── .gitignore
```

## Bug fixes applied from the architecture artifacts

| # | Where                         | Before                                               | After                                                          |
|---|-------------------------------|------------------------------------------------------|----------------------------------------------------------------|
| 1 | `lib/encryption.ts`           | `createCipher` + unused IV, `setAAD` on non-AEAD     | `createCipheriv` + AES-256-GCM + per-call salt/IV + scrypt KDF |
| 2 | `schema.prisma` CalendarEvent | Missing `accountId`, relations both on `transactionId`| `accountId` added, relations split correctly                   |
| 3 | `schema.prisma` AutomationLog | Missing `accountId`, same double-relation bug         | `accountId` added, relations split correctly                   |
| 4 | `schema.prisma`               | Orphan `@@index` block at file bottom                 | Moved into owning models                                       |
| 5 | FUB service                   | `Authorization: Bearer <apiKey>` (wrong)              | HTTP Basic `apiKey:` (empty password) per FUB docs             |
| 6 | All ported services           | Implicit `PrismaClient` / `NextApiRequest` references | Real imports + `instanceof`-narrowed error handling            |

## Connecting services

### Google (Gmail + Calendar)

1. Create OAuth client at https://console.cloud.google.com/apis/credentials
   - Authorized redirect URI: `http://localhost:3000/api/auth/google/callback`
2. Paste `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` into `.env.local`.
3. Visit `http://localhost:3000/api/auth/google?accountId=owner-account`.

Tokens are stored encrypted on `Account.googleOauthTokensEncrypted`.

### Follow Up Boss

1. Generate API key: FUB Settings → API.
2. Paste `FUB_API_KEY` + `FUB_WEBHOOK_SECRET` into `.env.local`.
3. Configure webhook in FUB to POST `https://<domain>/api/integrations/fub/webhook`
   with header `X-FUB-Secret: <your webhook secret>`.

FUB auth is HTTP Basic: `apiKey` as username, empty password.

## What ships next (roadmap pointers)

Foundation done; open paths:

- **Phase 1 Week 3** — TransactionService + MilestoneService + templates
- **Phase 1 Week 4** — Task engine + FUB sync + Today dashboard
- **Phase 3** — Gmail AI summaries + transaction matching UI
- **Phase 4** — PDF extraction pipeline
- **Phase 5** — YTD + source performance dashboards
- **Phase 6** — FUB automation rule engine

## Notes on philosophy

This is a private tool — prefer shipping working pieces to your own daily
workflow over elegance. Where the tradeoff is "more abstraction" vs "you
using it tomorrow," choose tomorrow.
