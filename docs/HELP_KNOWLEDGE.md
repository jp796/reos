# REOS Help — feature reference

This file is the source-of-truth knowledge base for the AI Help
assistant. Every feature ships with an entry here. The HelpDocsKeeper
skill (`.claude/skills/help-docs-keeper/SKILL.md`) updates this file
on every push.

---

## Daily workflow

### Today (`/today`)
The chief-of-staff dashboard. Ranks the things that need attention
RIGHT NOW: overdue milestones, deadlines this week, silent deals,
transactions closing in 30 days, pending review queue.

### Atlas — daily brief (Telegram)
Every morning at 8am Central, REOS Telegram-bots Jp's chat with
that day's brief: what was scanned overnight, AI-classified docs,
top deals with required-missing slots. Set up via Settings →
Brokerage. Bot username: @REOSAtlasBot.

### Atlas — two-way chat (Telegram)
Ask `@REOSAtlasBot` anything about open deals.
Examples:
- "what's closing this week?"
- "which deals are missing earnest money?"
- "status of 509 Bent"
- "show me the last 5 closings"

---

## Listings (`/listings`)

A listing = `Transaction` with `status='listing'` (pre-contract).
Click "+ New listing" → enter seller + property + list price + dates.
Once an offer is accepted, click **Convert to Transaction** on the
listing detail page → status flips to `active`, contractDate is
stamped, all milestone scans + AI classifiers start firing.

Listings appear in the morning brief, get auto-linked senders
(title cos, photographers, lender), and benefit from every other
automation REOS runs against active deals.

---

## Transactions (`/transactions`, `/transactions/[id]`)

The deal page. Top-of-fold shows: address, sale price, side, commission,
closing date, buyer/seller party rows. Below that:

- **Convert button** — only when status='listing' (flips to active)
- **Parties quick-edit** — buyer 1/2, seller 1/2, primary edit
- **Editable participants list** with drag-up/down + roles
- **Timeline** — milestones with overdue / today / soon / future tones
- **Documents** with AI-classified Rezen slot
- **Email forwarding** — connect Gmail to auto-route
- **Send from template** — merge variables for the deal
- **Compliance / Rezen prep** — every required slot status + ZIP download
- **Wire-fraud verification** log
- **CDA generator** — PDF of the commission disbursement

### Voice intake (`/voice`)
Press-to-record. Dictate the deal facts. Whisper transcribes →
GPT-4o-mini extracts → Transaction created with all parties +
financials + dates. Best for fast intake on a brand-new deal.

### Scan (`/scan`)
Unified scanner. Pulls inbound contracts, earnest-money receipts,
invoices, title orders, stale contacts. AI auto-classifies. Surfaces
candidates for one-click attach.

---

## Rezen prep panel

On every transaction detail page. Mirrors Real Broker's actual
checklists 1:1 — Transaction (34 slots) for buy/dual deals,
Listing (14 slots) for sell. Each slot:
- Shows ✓ green when REOS has a doc that matches
- Shows ✗ red for required-missing
- Names the doc to its Rezen filename ("01 Purchase Contract.pdf")
- Click **Download Rezen package** → ZIP with all renamed PDFs

When you sell to other brokerages, swap their checklist via
`BrokerageProfile` (see Settings → Brokerage).

---

## Pipeline funnel + Production

`/production` shows YTD closings, volume, GCI, net commission, avg
days to close, and a per-source pipeline funnel: leads → active →
closed YTD → conversion % → avg days. `/sources` adds CAC and ROI
math against `/marketing` spend.

---

## Auto social posts

On each transaction page, the Social Posts panel generates IG / FB /
LinkedIn captions for the three milestone events:
- Just Listed
- Under Contract
- Just Sold

Click a copy button per platform. Buffer / Direct Meta / Direct
LinkedIn / Cowork posters available as adapters; configure in
Settings → Integrations.

---

## Utility Connect

Auto-enrolls the buyer 7-10 days before close into utility setup
(water, electricity, cable). Runs daily at 7:30am MT. Use
`{{utility_connect_url}}` in welcome emails to share the link.

---

## Calendar invites

Every milestone with a date pushes a Google Calendar event. The
Calendar Sync button on each deal lets you add deadlines to your
Google Calendar one-click. Onboarding wizard collects a default
share-list (TC, brokerage compliance) so future events auto-invite.

---

## Settings → Brokerage

- Brokerage details (name, license, EIN, designated broker)
- Trusted TC senders (auto-classifier knows their roles)
- Compliance audit toggle (skip when Rezen / Skyslope owns it)

## Settings → Integrations
Pluggable adapters for listing photos + social posters.

## Settings → Demo data
Generate / wipe sample transactions — never affects rollups.

## Settings → Templates
Email templates with `{{variable}}` mail-merge.

## Settings → Vendors
Title cos, lenders, inspectors — ranked by past deals.

## Settings → Activity
Recent automation actions across the workspace.

---

## How automations run

| Cron | When | Endpoint |
|---|---|---|
| Morning tick | 8:00am Central daily | `/api/automation/morning-tick` |
| Utility Connect tick | 7:30am MT daily | `/api/automation/utility-connect/tick` |
| Post-close tick | hourly | `/api/automation/post-close/tick` |

Each is authed via the `SCAN_SCHEDULE_SECRET` bearer header set by
Cloud Scheduler.

---

## Common questions

### Why didn't earnest money auto-complete on my deal?
Possible causes: (1) the title coordinator isn't yet a participant on
the deal, (2) their email subject doesn't contain the property
street + number, (3) no PDF attached and no "received / receipt /
deposit / wire" in the subject. Fix: add them as a participant
manually OR wait — the auto-link pass on the next morning tick
typically picks them up.

### Why is my Rezen prep showing 0/34 even though I have docs?
Run "Classify with AI" on the transaction. Files with generic
filenames (e.g. "Document.pdf") need AI classification to map to
slots. Confidence ≥ 0.5 = match.

### Can I add Gmail draft mode?
Sends go through your own Gmail (not a "from REOS" no-reply), so
replies land in your inbox naturally. We don't touch your draft
folder.

### How do I exclude a deal from Production?
On the transaction detail page, Production Toggle section → "Exclude
from production rollups." Use for migrated deals with wrong dates
or referrals out.

### Where's my data?
Neon Postgres us-east-1 + Cloud Run us-central1. Encrypted at rest.
Gmail OAuth tokens encrypted with a per-tenant ENCRYPTION_KEY.

### Can I bulk-add deals?
Voice intake (`/voice`) for fast one-off. Scan (`/scan`) pulls from
Gmail in bulk. CSV import not yet built.

## E-sign (native, built-in)

REOS has a built-in e-signature engine — no DocuSign/Documenso account,
API key, or per-envelope fee. Find it on any transaction page in the
"E-sign" panel.

### How do I send a document for signature?
Transaction page → E-sign panel → pick a PDF → tap recipient chips →
"Place fields" → click on the page to drop Signature / Initials /
Date signed / Text boxes per recipient (each recipient gets a color)
→ Send. Each signer gets an email with their own private signing link.
Requires Gmail connected (Settings → Integrations) since signing
invitations send from your own Gmail.

### What do signers see?
A public /sign/[link] page: an ESIGN/UETA consent step, the document
with their highlighted fields, and a draw-or-type signature pad. Works
on phones. Links expire after 30 days and are unique per signer — they
never see other signers' info.

### What happens when everyone signs?
REOS burns the signatures into the PDF, appends a Signature Certificate
page (signers, consent record, timestamps, IPs, SHA-256 document hash),
saves "<name> (signed).pdf" back onto the transaction's documents, and
emails the completed file to all parties.

### Is it legally valid?
It follows the ESIGN Act / UETA evidence model: explicit consent
(recorded with text version), deliberate sign action, attribution
(unique emailed link + IP/user-agent), and a tamper-evident audit
trail. Notarized documents (e.g. deeds) still go through your title
company. (Endpoints: POST /api/transactions/[id]/esign with fields;
public GET/POST under /api/sign/[token]/*.)

## Investor module (beta)

REOS extends beyond retail transaction coordination to real estate
**investing** — flips, wholesale, rentals/BRRRR, and creative finance —
on the same account, same contacts, same engines. It's an entitlement,
not a separate app.

### Turning it on
The account owner enables it at **Settings → Account → Investor module**
(toggle). Your existing retail transactions are unaffected. (Endpoint:
POST /api/account/entitlements { investor: boolean } — owner only.)

### The Retail / Investment / All lens
Once enabled, the Transactions page gets a top **Retail / Investment /
All** filter. It does not split your data — title companies, lenders,
and inspectors stay shared. "Investment" shows principal-owned deals;
"Retail" shows agency deals plus all your existing transactions.

### Deal kinds (auto-detected)
When a deal is created, REOS classifies it — retail, flip, wholesale,
rental/BRRRR, or creative — from the contract + intake signals, and
creates an **Asset** (the deal spine). You can override the
classification.

### Strategy lifecycle (Wholesale shipped first)
Investor deals follow a stage lifecycle (e.g. Wholesale: Lead Analysis →
Under Contract → Disposition → Assignment/Close → Closed). The deal page
shows the current stage and an **Advance stage** button; advancing seeds
that stage's tasks into the Tasks panel. (Endpoint: POST
/api/assets/[id]/advance-stage.)

### Rehab draws & capital stack (investor)
Flip and BRRRR deals get a draw board: request a draw against a milestone,
verify it, attach a lien waiver, then release. REOS holds retainage (default
10%) until punch-list. A draw cannot be released without a lien waiver. The
capital stack tracks funding sources (private money, bridge, DSCR, seller
note, underlying loan) and warns when a balloon is within 90 days. (Endpoints:
/api/assets/[id]/draws, /api/assets/[id]/capital.)

### Cash buyers (wholesale disposition)
Settings → your contacts can be tagged as cash buyers at /contacts/cash-buyers.
Search to add, then "Copy all emails" to blast the segment when a wholesale
deal goes to market.

### Production — revenue type
Investor-entitled accounts see a Revenue type split on /production: agency
GCI (retail commission) vs investment deals closed/active, broken down by
strategy. Investment P&L dollars fill in as deal economics are entered.

### Overriding a deal's classification
If auto-detect picks the wrong deal kind, change strategy / representation /
title path (and record a hybrid agency commission component) via
PATCH /api/assets/[id]. Changing strategy restarts the stage lifecycle.

### Making a deal an investment deal (the front door)
On any transaction page, owners/coordinators with the investor module
enabled see a **Deal type** dropdown in the header. Pick Flip, Wholesale,
Rental/BRRRR, or Creative and the deal becomes a principal (investment)
deal — the stage board, rehab draws, capital stack, and investor risk
appear immediately. Switch back to Retail to hide them. (Backed by
PATCH /api/assets/[id].)

### Gmail scanning on investor deals (off until market)
Investment deals (Flip, Wholesale, BRRRR) keep Gmail/SmartFolder OFF during
acquisition and rehab — no inbox noise while you're not transacting by email.
The SmartFolder activates automatically when the deal reaches its market-entry
stage: Flip → "Prep to List", Wholesale → "Disposition", BRRRR → "Lease-Up".
Until then the deal page shows "SmartFolder · waiting for market" with an
"Activate Gmail now" button if you want it on early. Retail deals are
unaffected — Gmail is on from creation.

### Deal economics (investor profit / ROI / cash flow)
On a principal (investment) deal, the Deal economics panel takes the inputs for
that strategy — Flip: purchase / rehab / holding / sale; Wholesale: assignment
fee / EMD; Rental: rents / opex / debt service / invested / cash-out; Creative:
payments / balloon — and computes the metrics live (profit + ROI + days-to-flip,
cap rate + DSCR + cash flow, spread, etc.). Save to feed the deal into the
unified Production P&L. (Endpoint: PATCH /api/assets/[id]/economics.)

### Production — investment P&L
The /production Revenue type panel now shows Investment P&L alongside Agency GCI:
the summed headline metric (flip profit, wholesale spread, rental/creative cash
flow) across closed investment deals that have economics entered.

### Investment board (Monday.com-style kanban)
Investor-entitled accounts get a Board nav item (/board) — a kanban of investment
(principal) deals as cards in stage columns. Pick a strategy (Flip/Wholesale/
Rental/Creative) via the tabs; columns are that strategy's stages. Drag a card to
a column to move the deal to that stage (it seeds that stage's tasks). Retail
deals never appear here. (Endpoint: POST /api/assets/[id]/set-stage.)

### Talk to Atlas (Telegram) — take actions by chat
Message the Telegram bot to DO things, not just ask. Atlas resolves the deal
(find_deal), then for any change it PROPOSES and waits: "Add task … to 3453
Willard — reply yes to confirm." Reply *yes* to execute, *no* to cancel.
Supported: add/complete task, set a deadline, advance/set stage, add a note.
Reads (status, what's closing) answer immediately. Every action is audited and
runs as the owner with full visibility; writes never fire without a "yes".

### Team members & roles (invite a teammate)
Owners add teammates at Settings → Team (/settings/team). The invite form
(under "Collaborators") takes an email + role and sends access on their next
Google sign-in; they switch between their own workspace and yours via the
sidebar workspace switcher. Roles:
- **Owner** — full account control (billing, team, deletes) + sees everything.
- **Admin** — full DEAL access: sees every deal including ones marked private
  (restricted-to-assignee) and can toggle deal privacy. Does NOT get account
  control — billing and team management stay owner-only. Use for a partner/
  staffer who needs to work all your deals (incl. investment deals).
- **Coordinator (TC)** — sees and works all non-private deals; cannot see
  deals marked private unless assigned to them.
- **Agent** — read access.
Teammates must sign in with a Google-capable email (Google Workspace or Gmail);
auth is Google-only. (API: POST /api/account/members; role change: POST
/api/team/[id]/role.)

### Free / discounted trials (coupons)
Checkout accepts Stripe promotion codes (allow_promotion_codes is on for both
signup and the billing portal). To give someone a free or $1 trial: create a
coupon + promotion code in your Stripe Dashboard (Product catalog → Coupons),
then have them sign up at /signup, pick a tier, and enter the code at checkout.
They land in their OWN isolated workspace. Do not use AUTH_ALLOWED_EMAILS for
external testers — that attaches them to an existing account.
