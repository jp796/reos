# REOS — ListedKit-Parity Vision & Gap Targets

> Captured 2026-06-19 from JP's competitive teardown of ListedKit (their AI
> assistant = "Ava"; ours = "Atlas"). Goal: a clean, logical, AI-driven
> transaction create + manage flow that is "next-level flawless with no
> mistakes." This is the source of truth for the parity roadmap. JP was still
> adding ("I have more") — append as more arrives.

## North star
JP: clean UI, "not so no-logical." Atlas does the heavy lifting; the user
watches and approves. From contract upload → emails out → managed deal in
minutes, not hours. Confirm-before-write everywhere (approval gates).

---

## A. Guided transaction CREATION (the intake wizard)
ListedKit flow, step by step (what we're matching):

1. **Upload screen** — "Upload a Purchase Contract or Listing Agreement."
   Multi-file uploader ("Add more files"): purchase agreement + ALL related
   docs (disclosures, lead-based paint, addenda, leases). Works for a listing
   too (upload listing agreement). Shows the file list with size + delete.
2. **"Which side do you represent?"** — Listing Side / Both Sides / Buyer Side.
3. **Atlas reads in real time** — visible step-by-step extraction log
   ("Identifying the Buyer as…", "Confirming the loan type as…", "Identifying
   the Closing Date as…"). Pulls parties, financing, terms, dates.
4. **Review extracted data** (editable tables, with pencil/delete/search per row):
   - **Property Details**: street, city, state, zip, HOA, tenant-occupied,
     county, legal description, parcel/APN. ("Add Property Detail.")
   - **Parties**: name, company, role badge (BUYER/SELLER/agent/lender/title),
     phone, email, address. ("Add party.")
   - **Terms / Contingencies**: financing, appraisal, inspection/option,
     survey, title review, HOA disclosure, lead-based paint, seller repair,
     post-closing possession, earnest-money deadline — each with the clause
     text + a date. (Applies / N/A.)
5. **Confirm effective date** — click to see WHERE it was pulled from (source
   citation); "looks good" → generates the whole timeline.
6. **Timeline auto-generated** — all relative dates computed; business days /
   calendar days / state holidays accounted for by state.
7. **Pick a compliance template** (the doc checklist for the deal) — search,
   preview docs, "Apply This Template." If none matches: "Generate with Ava"
   (and if you have zero templates, Ava builds one by default). Already-uploaded
   docs auto-marked uploaded.
8. **Pick a task template** — same pattern; "Generate with Ava" fallback.
   Tasks get due dates with relative-date logic ("1 day after Under Contract",
   "3 days after Under Contract"). Some tasks flagged **Auto-Email**.
9. **Smart "Save as a new template?"** — detects deltas ("your template is for
   New Jersey and without HOA; want me to save a Texas + HOA version for next
   time?").
10. **Open file** → the deal workspace.

## B. The deal WORKSPACE (tabbed, with center AI chat)
Top tabs: **Timeline · Tasks · Details · Compliance · Email**. Header shows
address, assignees, % tasks completed, "+ New".

- **Center chat with Atlas** — input: "Ask a question, use / for commands,
  @ for mentions, # for references." Atlas capability ladder:
  - **Q&A over all deal docs** ("find the lockbox number on page 3") with
    source citations (which file/where).
  - **Act on tasks** — move/rename/re-due tasks in the right rail by chat.
  - **Calendar** — connect Google/Outlook; "add the timeline to my calendar"
    → creates events (name, description, location, invitees, color, reminder),
    held for **approve**. Can put closing on client's / other side's calendar,
    sent as the user.
  - **Email** — connect Gmail/Outlook; draft + send from the USER's address
    (not the app's). Attach docs; "Include Transaction Summary" (branded PDF:
    address, timeline, parties, logo, customizable). **Schedule send later**
    (tomorrow AM/PM, custom). 
  - **Inbox monitoring** — "check my inbox for updates": finds relevant emails
    (titles + source shown), downloads attachments into the deal's files,
    drafts replies (e.g. confirm closing date), marks deadlines complete. All
    held for review in Outbox.
  - **Compliance scan** — "is that EMD compliant?" → full document scan, lists
    missing signatures / missing info; click an issue → highlights where.
  - **SMS** — verify a phone number; then chat with Atlas by text across all
    deals (great for on-the-go / agents). Reads calendar + email.
- **Timeline tab** — Deadlines list (offer expiration, EMD, title objection,
  loan commitment, inspection period, closing, etc.), each editable; "+ New".
- **Tasks tab** — checkbox list, assignee, due date, search, sort, "+ New",
  Auto-Email badge, drag handles.
- **Details tab** — the Property Details / Parties / Terms tables (editable).
- **Compliance tab** — two sub-views:
  - **Checklist** — required docs with statuses: **Pending · Uploaded · Has
    Issues · Fully Executed**, each with its trigger deadline (e.g. "CLOSING
    DATE", "INSPECTION PERIOD DEADLINE"), upload affordance, NEEDS REVIEW flag.
  - **Files** — running file library (view / download / delete), upload date.
- **Email tab** — per-deal email surface.

## C. Cross-cutting
- **Templates engine** — user-defined compliance templates + task templates,
  per state / representation; AI-generate when missing; smart save-as-new.
- **Relative-date engine** — business vs calendar days, state holidays. (REOS
  already has `business-days` lib + state walkthrough rules — extend.)
- **Source citations** — every extracted field / answer cites its document
  location (trust). 
- **Approval gates** — nothing sends/changes without a yes (we already do this
  in Atlas Telegram; bring same to in-app chat).

---

## Immediate UX asks (JP, this session)
1. **Transactions tab is cluttered** — too many "Scan for X / Scan for Y"
   buttons at the top. Clean it up; make it user-friendly.
2. **"Add a new transaction" must be top-of-page**, obvious.
3. **Atlas as the AI assistant in the create-transaction flow** (the guided
   wizard above), not just a separate page.
4. **Any user can set up Telegram** — DONE (Settings → Notifications, shared
   bot, per-user routing).

---

## D. Settings information architecture (ListedKit — clean Personal/Admin split)
REOS today scatters ~12 settings links shown unconditionally. ListedKit groups:

**Personal Settings**
- Account — profile, password, sessions, display prefs
- Email — templates, signature, email automation rules
- Reminders — when/how you're notified of deadlines, tasks, updates
- Task Templates — reusable task checklists auto-applied at intake
- Compliance Templates — document-request checklists per compliance reqs
- Intake Preferences — configure how the AI extracts/processes uploaded contracts
- Atlas Approvals (their "Ava Approvals") — which actions Atlas does WITHOUT asking
- Atlas SMS — text Atlas from your phone (transactions, deadlines, tasks)
- Integrations — calendar, email, CRM
- Summary Design — transaction-summary PDF look: logo, colors, font, sections

**Admin Settings** (owner/admin only)
- Users — invite, roles/permissions, access
- Billing — credit balance, purchase credits, payment history
- Company — name, address, timezone, org details

Action: restructure REOS Settings into this Personal/Admin grouping; map our
existing pages (Brokerage, Vendors, Activity, Notifications→Reminders,
Telegram→Atlas SMS) into it; add the missing ones (Task Templates, Compliance
Templates, Intake Preferences, Atlas Approvals, Summary Design).

## Gap analysis — REOS HAS vs MISSING (audited 2026-06-19)

### Where REOS is ALREADY AHEAD of ListedKit (our moat — protect + lean in)
- **Investor deals** — Asset spine, strategies (flip/wholesale/rental/creative),
  stage board, deal economics (profit/ROI/cap rate/DSCR), Production P&L.
  ListedKit has NONE of this. This is the differentiator.
- **Rezen/Real compliance push** — mirrors Rezen checklists (34 txn / 14 listing),
  ZIP export with renamed PDFs, signature scan, push to Rezen.
- **Risk scoring**, **wire-fraud verification**, **eSign**, **contract version
  history/diffs**, per-deal visibility + multi-user roles, FUB CRM sync.

### MISSING / PARTIAL vs ListedKit (the work)
| Gap | State | Notes |
|-----|-------|-------|
| Prominent "+ New Transaction" CTA | MISSING | creation hidden inside scan panels |
| Transactions list clutter (4 scan buttons + 5 panels) | PARTIAL | consolidate into one Tools menu |
| Tabbed deal workspace (Timeline/Tasks/Details/Compliance/Email/Files) | MISSING | today: one long scroll of ~22 panels |
| Guided intake WIZARD | MISSING | today: flat form, not step-by-step |
| Multi-file upload at intake | MISSING | single PDF only |
| "Which side?" buyer/listing/both/INVESTOR picker | PARTIAL | heuristic; no explicit picker |
| Editable Property/Parties/Terms review BEFORE create | MISSING | extraction reviewed only post-create |
| In-app Atlas chat on the deal | MISSING | Atlas is Telegram-only; in-app = prose summary |
| Schedule-send email | MISSING | direct send only |
| "Check my inbox" proactive monitoring + draft replies | PARTIAL | SmartFolder + AI draft reply exist; no inbox sweep |
| Richer doc statuses (Pending/Uploaded/Has Issues/Fully Executed) | PARTIAL | today: present/missing + eSign status |
| User-defined compliance templates | MISSING | hardcoded per-brokerage |
| AI-generated templates ("Generate with Atlas") | MISSING | manual edit only |
| Smart "save as new template" (state/HOA delta) | MISSING | — |
| Summary Design (branded PDF) settings | MISSING | summary exists; no design settings |
| State holidays in business-day math | PARTIAL | weekends only today |
| Settings IA (Personal/Admin grouping) | MISSING | ~12 links shown flat |

---

## ROADMAP (pretty → powerful → better; investor edge woven throughout)

**Phase 1 — Pretty & logical (fast, high visible impact)**
- Transactions list: collapse the 4 scan buttons + scan panels into one "Scan
  / Tools" menu; add a bold **"+ New Transaction"** top-right.
- **Tabbed deal workspace** — wrap existing ~22 panels into tabs: Timeline ·
  Tasks · Details · Compliance · Files · Email. (Reuses panels; big polish win.)
- Settings → Personal/Admin regroup (low risk).

**Phase 2 — Guided Atlas intake wizard (headline "powerful")**
- Multi-file upload → **side picker incl. Investor** → live extraction log →
  editable Property/Parties/Terms review → apply compliance + task templates →
  generate timeline → create → open workspace. Investor side routes to strategy
  templates + Asset (our edge, built into the flow).

**Phase 3 — In-app Atlas chat on the deal** (reuse AtlasTools + AtlasChatService
from Telegram; deal-scoped center chat; confirm-before-write).

**Phase 4 — Email/calendar/inbox power-ups** — schedule-send; "check my inbox"
sweep w/ draft replies; calendar create-with-approval (finish the partials).

**Phase 5 — Templates & compliance depth** — user-defined + AI-generated
compliance/task templates; smart save-as-new; richer doc statuses; Summary
Design PDF; state holidays.
