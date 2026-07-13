---
name: resync-deal
description: >
  Re-sync a REOS transaction from its sources — re-read the attached
  contract, reconcile the whole document set, and pull the deal's Gmail
  smart-folder threads — then verify the result is correct. This is the
  reliable, repeatable path for "the deal data looks stale/wrong; re-read
  the contract and add the Gmail emails and update the transaction."

  USE WHEN: a deal is missing parties/dates/fields that are in the
  contract; a user says "re-read the contract", "re-sync this deal",
  "pull the Gmail emails onto this deal", "update the transaction from
  sources", or reports stale/incomplete deal data. Also use after a
  contract or addendum is (re)uploaded.
---

# Re-sync a deal from its sources

One deal in, three sources reconciled, verified. **Never claim a step
happened that didn't** — report exactly what each source did.

## The three sources

1. **Contract** — re-read the attached PDF; fill MISSING dates + add
   milestones + generate tasks. Never overwrites a human edit
   (`RescanDealService`, gated by `manuallyEditedAt`).
2. **Documents** — reconcile the whole set (contract + addenda + notices)
   into the current timeline + contingency status (`synthesizeDeal`).
3. **Gmail** — pull the deal's smart-folder threads via
   `SmartFolderService.rebackfill` (searches by the deal's current address
   + party emails; idempotent).

## Preferred path — the in-app action (does all three, with Gmail OAuth)

The transaction page has a **"Re-sync from sources"** button
(`ResyncButton` → `POST /api/transactions/:id/resync`). It runs all three
best-effort and returns a per-step summary. Gmail requires the account's
Google OAuth, which only the app has — so this is the only path that
includes Gmail.

To trigger it as ATLAS, open the deal in the real browser (Interceptor,
JP's session) and click **Re-sync from sources**, then read the toast:

```
interceptor open "https://www.myrealestateos.com/transactions/<ID>"
interceptor find "Re-sync from sources"   # then: interceptor click <ref>
interceptor read --text-only              # read the per-step result toast
```

## Data-level path — contract + reconcile only (no Gmail)

When the app isn't reachable, run the contract + reconcile steps directly
against prod (Gmail needs the app's OAuth, so skip it and say so). Place a
bun script at the repo root so Prisma + `@/` resolve:

```ts
import { PrismaClient } from "@prisma/client";
import { rescanDeal } from "./src/services/core/RescanDealService";
import { synthesizeDeal } from "./src/services/core/DocumentSynthesisService";
const prisma = new PrismaClient();
const TXN = "<deal id>";
async function main() {
  const t = await prisma.transaction.findUnique({ where: { id: TXN }, select: { accountId: true } });
  console.log("contract:", (await rescanDeal(prisma, t!.accountId, TXN)).summary);
  const s = await synthesizeDeal(prisma, t!.accountId, TXN, false);
  console.log("reconcile:", s ? `reconciled ${s.analyzedCount}/${s.docCount} docs` : "nothing");
}
main().then(() => process.exit(0));
```

Run with prod secrets (never print them):

```
export DATABASE_URL="$(gcloud secrets versions access latest --secret=DATABASE_URL 2>/dev/null)"
export OPENAI_API_KEY="$(gcloud secrets versions access latest --secret=OPENAI_API_KEY 2>/dev/null)"
bun run ./resync.ts; rm -f ./resync.ts
```

## Fixing WRONG data (rescan only fills MISSING)

`rescanDeal` never overwrites existing values — so it will NOT correct a
wrong address or add a missing party. For those:

- **Wrong address / city** → set it explicitly (in-app address pencil on
  the H1, Atlas chat `update_deal field=address`, or a scoped Prisma
  update). If the contract lacks a city, do NOT invent one — leave it
  blank or ask.
- **Missing co-buyer / co-seller** → the contract's `buyers`/`sellers`
  extraction lists everyone; add the missing party as a `co_buyer` /
  `co_seller` `transactionParticipant` (create the contact if needed),
  scoped by `accountId`.

## Verify — always (this must be error-free)

After re-syncing, re-read the deal and confirm the change actually
landed. Compare the transaction fields + participants against the
contract's extracted `analysisJson.baseline`. State exactly what changed
and what still needs a human decision (e.g. a city the contract doesn't
contain). Never report success on a step that failed — the endpoint and
the scripts both return per-source results; relay them faithfully.

## Guardrails

- Every query scoped by `accountId` (tenant isolation).
- Prod secrets only via `gcloud secrets` — never printed.
- §16: no silent bulk rewrites; a single deal, reported step-by-step.
- Respect `manuallyEditedAt` — human edits win over a re-read.
