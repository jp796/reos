# Investor Module — Build Status & Gap Analysis

Living tracker for the investor-module build. Spec: `docs/INVESTOR_MODULE_SPEC.md`.
Tag legend: ✅ exists · 🔧 partial · 🔴 missing. Update as phases land.

> **Prime directive (from spec §0–1): enhance, don't rebuild.** One account,
> shared core. The investor module is an *entitlement* on the existing account —
> same login, same 9,800+ contact graph, same comms/scan/Drive/risk engines.
> Do NOT fork the data or stand up a second app.

---

## Current state vs. spec (as of 2026-06-14, pre–Phase 0)

### §2 Core data model — the spine

| Spec entity | Status | Reality in `prisma/schema.prisma` |
|-------------|--------|-----------------------------------|
| **Asset (Deal)** — top-level spine | 🔴 | No model. `Transaction` is currently top-level. |
| **Transaction** as *child* of Asset | 🔴 | Exists but is the spine itself (`accountId` + `contactId` parents). Needs `assetId`. |
| **Project** (rehab/PM episode) | 🔴 | No model. |
| **Stage** (task template w/ auto-advance) | 🔴 | No template engine. `stageName`/`pipelineName` are free-text strings on Transaction. |
| **Task** | 🔧 | Exists, parented to `transactionId`+`milestoneId`. No `stageId`, no `recurrence`. |
| **Milestone** | ✅ | Exists; close cousin of Stage tasks. Reusable. |
| **DrawSchedule / Draw** | 🔴 | No model. |
| **CapitalStackEntry** | 🔴 | No model. |
| **CommsEvent** | 🔧 | `CommunicationEvent` exists (Gmail). No Google Chat source. |
| **RiskScore** | 🔧 | `riskScore` float on Transaction + `RiskScoringService`. No per-strategy signal sets. |
| **Document / DriveFolder** | 🔧 | `Document` + SmartFolder (Gmail label) exist. No per-Asset Drive tree scaffold. |
| **ChatSpace** | 🔴 | No Google Chat integration. |

### §1 Account & entitlement model

| Item | Status | Reality |
|------|--------|---------|
| `entitlements: [retail_tc, investor]` | 🔴 | `Account` has `subscriptionTier` (free/solo/team/brokerage) but no entitlement array. |
| Retail / Investment / All filter | 🔴 | Not built. |
| Hybrid deal (principal + agency component) | 🔴 | No representation flag to hang it on. |

### §3–4 Representation & title-path

| Field | Status | Reality |
|-------|--------|---------|
| `representation` (agency \| principal) | 🔴 | `transactionType` string hints at it (`// ...investor, wholesale...`) but unused. |
| `title_path` (takes_title \| assignment \| double_close \| contract_rights) | 🔴 | Missing. |
| `strategy` (retail \| flip \| wholesale \| rental_brrrr \| creative) | 🔴 | Missing. |
| `creative_substructure` | 🔴 | Missing. |

### §5 Auto-detect (classification at intake)

| Item | Status | Reality |
|------|--------|---------|
| Voice intake | ✅ | `VoiceIntakeService` exists. |
| Gmail contract scan | ✅ | `AcceptedContractScanService` + `ContractExtractionService`. |
| Manual PDF upload | ✅ | Contract upload/extract/apply flow. |
| Classifier → strategy/representation/title_path | 🔴 | Extraction pulls fields but does not classify deal *type*. |

### §6 Strategy templates · §7 shared engines · §8 automation

| Engine | Status | Reality |
|--------|--------|---------|
| Stage templates + auto-advance | 🔴 | Free-text stages only; no template → task instantiation. |
| Contacts roles[] (PML, contractor, cash_buyer, tenant, partner) | 🔴 | `Contact` has no roles array; `TransactionParticipant` has per-deal roles only. |
| Cash-buyers saved segment | 🔴 | No saved segments. |
| Comms recency / silent-deal risk | ✅ | `lastMeaningfulTouchAt` + Silent-7D logic exists (Gmail only). |
| Drive auto-scaffold / move / archive | 🔧 | Gmail SmartFolder only; no Google Drive folder tree. |
| Google Chat deal space | 🔴 | Missing. |
| Draw engine (lien-waiver gate, retainage) | 🔴 | Missing. |
| Recurring-task engine (hold/servicing) | 🔴 | Missing. |
| Holding-cost meter | 🔴 | Missing. |

### §9–10 Economics & risk

| Item | Status | Reality |
|------|--------|---------|
| Per-strategy economics object | 🔧 | `TransactionFinancials` covers retail commission only. |
| Unified Production (commission + P&L) | 🔧 | Production view exists, retail-only. |
| Per-strategy risk signals | 🔧 | One generic `RiskScoringService`; no flip/wholesale/BRRRR/creative sets. |

### §11 Google Chat · §13 legal

| Item | Status | Reality |
|------|--------|---------|
| Google Chat deal space + bot | 🔴 | Missing. |
| Creative-finance: track/checklist/service, never generate instruments | 🔴 | Phase 4; gated behind legal review. |

---

## Build sequence (spec §12) — checklist

- [~] **Phase 0 — core extensions.** *Data foundation landed 2026-06-14 (schema + migration + entitlements lib + backfill script, all verified). Remaining: entitlements-setting UI, Retail/Investment/All dashboard filter, and the auto-detect classifier writing strategy/representation/title_path.*
  - [x] `Asset` model + `Project` model (the spine)
  - [x] `Transaction.assetId` nullable parent (shadow reparenting)
  - [x] `representation` / `title_path` / `strategy` / `creative_substructure` fields (on Asset)
  - [x] `Account.entitlementsJson` + `src/lib/entitlements.ts` helper
  - [x] `Contact.rolesJson` field
  - [x] `scripts/backfill-assets.ts` (dry-run-safe, idempotent)
  - [x] Settings UI to grant the `investor` entitlement (owner-only toggle, Settings → Account) + `POST/GET /api/account/entitlements`
  - [x] Retail / Investment / All lens on `/transactions` (gated by entitlement; investment = Asset.representation principal, retail = agency + legacy null-asset)
  - [x] Auto-detect classifier (§5) — `classifyDeal()` (12 tests) **wired into `create-from-scan`**: every new deal now creates a parent Asset with classified `strategy`/`representation`/`title_path`. Retail scans → agency/retail degenerate Asset (invisible to retail UI). Optional investor signals accepted in the body for richer intake paths.

- [x] **Phase 1 — Wholesale wedge** (§6.2): 5-stage template, StageEngine
  (apply/advance/complete), migration `20260614210000`, intake seeding,
  `advance-stage` API + StagePanel, **auto-advance on task completion** (§8.1),
  **cash-buyers segment** (`/contacts/cash-buyers`), **Drive/Chat scaffold**
  (`DealWorkspaceService`, flag-gated — see boundary note).
- [x] **Phase 2 — Flip + Draw engine + Holding-cost meter**: Flip 7-stage (§6.1);
  `DrawEngine` (lien-waiver gate + retainage), migration `20260614223000`
  (DrawSchedule/Draw), draw APIs + `DrawCapitalPanel`; `HoldingCostMeter` (§7);
  `CapitalStackEntry` + API + UI.
- [x] **Phase 3 — Rental/BRRRR**: 6-stage (§6.3) incl. Lease-Up + Refinance;
  recurring-task engine (`generateRecurringTasks` + `/api/assets/recurring/generate`).
- [x] **Phase 4 — Creative Finance**: 6-stage (§6.4) incl. recurring Loan-Servicing;
  risk signals incl. underlying-payment-late (top severity) + balloon alerts (§10).
  ⚠️ §13 — tracks/checklists/services only; never generates legal instruments. Confirm with counsel before scaling.
- [x] **Phase 5 — Hybrid + unified Production**: per-strategy economics
  (`DealEconomicsService`, §9) + `reconcile()`; Production revenue-split
  (agency GCI vs investment); hybrid + classification override via `PATCH /api/assets/[id]`.

### Integration boundary (honest status)

`DealWorkspaceService` (Drive folder tree + Google Chat space, §7/§11) is
**built + wired but feature-flagged OFF** (`INVESTOR_DRIVE_ENABLED`,
`INVESTOR_CHAT_ENABLED`). Going live needs the Drive scope added to
`DEFAULT_SCOPES` + user re-consent, and the Google Chat API + scopes
provisioned. Until then it's a safe no-op. Everything else is live.

### Engines & tests (all green)

`DealClassifierService` (12) · `strategyTemplates` (14) · `DealEconomicsService` (7)
· `HoldingCostMeter` (4) · `DrawEngine` (7) · `InvestorRiskService` (9) = **53 unit tests**.

---

## Resolved decisions (2026-06-14, JP delegated → ATLAS chose)

1. **Asset reparenting → INCREMENTAL / SHADOW.** `assetId` is nullable on
   Transaction; no forced bulk reparent. Existing retail queries are untouched
   (run with `assetId=null`); new investor code reads through Asset. Optional
   backfill via `scripts/backfill-assets.ts`. Safest on the live 9,800+ contact DB.
2. **Entitlement → SEPARATE ARRAY.** `Account.entitlementsJson`, orthogonal to
   `subscriptionTier`. `null` normalizes to `["retail_tc"]` so the whole existing
   base is unchanged. An agent-investor holds both. See `src/lib/entitlements.ts`.
3. **First template → WHOLESALE** (spec §12 Phase 1) — built after Phase 0 UI lands.
