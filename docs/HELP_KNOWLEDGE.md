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
