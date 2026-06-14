# REOS Investor Module — Build Specification

**Status:** canonical build doc · **Audience:** Claude Code / engineering · **Source:** consolidated from product design sessions

---

## 0\. Overview & scope

REOS today is a transaction-coordination platform for **retail real estate agents** (contract-to-close, risk scoring, Gmail-based contract scanning, a Today dashboard). This spec extends REOS to a **second ICP: the real estate investor** who needs transaction coordination **and** project management.

Mental model: the TC discipline of an AFrame-style platform \+ the flexible board/PM power of Monday.com \+ a rehab/draws layer — pointed at investors instead of agents.

The investor module ships as a **paid entitlement on the existing REOS account**, not a separate app. Same login, same contact graph, same engines.

---

## 1\. Account & entitlement model

- **One account, shared core.** The investor module is an entitlement flag on the account.  
- Entitlements: `retail_tc` and/or `investor`.  
  - Pure agent → `retail_tc` only.  
  - Pure investor → `investor` only.  
  - **Agent-investor → both**, on one unified board.  
- The home dashboard exposes a **Retail / Investment / All** filter. Do **not** split the data — splitting fragments the 9,800+ contact graph (title cos, lenders, inspectors are shared across both) and breaks unified production reporting.  
- **Hybrid deal support is required:** a deal can be Principal (you own the asset) *and* carry an Agency commission component (e.g. you list your own flip and earn the listing side). Two-account designs cannot represent this — single account with deal-level flags can.

---

## 2\. Core data model

### The spine

The top-level object is the **Asset (Deal)**, not the Transaction. A property persists through many episodes — acquired (transaction 1), rehabbed (project 1), refinanced (transaction 2), rented (recurring ops), sold (transaction 3). Transactions and Projects are **children** of the Asset.

For retail/agency deals the Asset is degenerate: one Asset → one Transaction, dies at close. The same model serves both.

### Entities (key fields)

**Account**

- `id`, `name`, `entitlements: [retail_tc, investor]`, billing refs

**User** — `id`, `name`, `email`, `role`, `account_id` (e.g. JP, Heather, Sherri)

**Contact** — `id`, `name(first,last)`, `emails[]`, `phones[]`, `additional_names[]`, `roles[]` (buyer, seller, buyer\_agent, lender, private\_money\_lender, contractor, title\_co, inspector, cash\_buyer, tenant, partner …), `account_id`. *One contact, many deals.*

**Asset (Deal)** — the spine

- `id`, `address`, `account_id`, `owner_user_id`  
- `representation: enum(agency | principal)`  
- `title_path: enum(takes_title | assignment | double_close | contract_rights)`  
- `strategy: enum(retail | flip | wholesale | rental_brrrr | creative)`  
- `creative_substructure: enum(subject_to | seller_finance | lease_option | wrap) | null`  
- `current_stage_id`, `risk_score`, `economics{}` (see §9), `drive_folder_id`, `chat_space_id`  
- `agency_component{}` (nullable — for hybrid principal+commission deals)

**Transaction** — a closing event on an Asset (acquire, refi, sell, assignment, double-close legs). `id`, `asset_id`, `type`, `settlement_statement_doc_id`, `close_date`, `drive_subfolder_id`. **An Asset has 1..n.**

**Project** — a PM work episode on an Asset (rehab, lease-up, etc.). `id`, `asset_id`, `type`, `budget`, `actual`, `draw_schedule_id`.

**Stage** — a scoped task template within a strategy lifecycle. `id`, `strategy`, `order`, `name`, `task_templates[]`, `is_recurring: bool`.

**Task** — `id`, `asset_id`, `stage_id`, `name`, `owner_user_id`, `status`, `due_date`, `files[]`, `priority`, `recurrence: {cadence} | null`.

**DrawSchedule / Draw** — `draw_schedule_id`, `asset_id`, milestones\[\]; each `Draw`: `amount`, `milestone`, `status`, `lien_waiver_doc_id`, `verify_photos[]`, `retainage_held`, `lender_release_ref`.

**CapitalStackEntry** — `asset_id`, `lender_contact_id`, `type` (private\_money | bridge | dscr | seller\_note | underlying\_loan), `principal`, `rate`, `balloon_date`, `payoff_balance`.

**CommsEvent** — `asset_id`, `source: enum(gmail | google_chat)`, `contact_id`, `timestamp`, `direction`. Drives recency.

**RiskScore** — `asset_id`, `score`, `signals[]` (see §10).

**Document / DriveFolder**, **ChatSpace** — integration handles (see §7, §11).

### Relationships (summary)

Account 1—n User · Account 1—n Contact · Account 1—n Asset · Asset 1—n Transaction · Asset 1—n Project · Asset 1—n Task · Asset 1—1 DrawSchedule (when rehab) · Asset 1—n CapitalStackEntry · Asset 1—n CommsEvent · Asset 1—1 DriveFolder · Asset 1—1 ChatSpace · Contact n—n Asset (via roles).

---

## 3\. Representation model (Agency vs Principal)

The `representation` flag forks four things and nothing else — everything below the line in §7 is shared:

|  | Agency (retail) | Principal (investment) |
| :---- | :---- | :---- |
| Lifecycle | retail contract-to-close | strategy template (§6) |
| "Client" party | third-party buyer/seller | your own entity |
| Economics | commission / GCI | profit / spread / cash flow |
| Default comms cadence | client status updates | lender \+ contractor cadences |

---

## 4\. Title-path model

| `title_path` | Used by | Implications |
| :---- | :---- | :---- |
| `takes_title` | flip, rental\_brrrr, sub-to, seller-finance | ownership \+ loan record; holding-cost meter runs |
| `assignment` | wholesale (assign) | **no title**, no holding costs; the "asset" is the contract; end buyer closes |
| `double_close` | wholesale (double) | two same-day closings; brief title; needs transactional/gap funding |
| `contract_rights` | lease-option | option/contract position; no title record until exercised |

`title_path` is set by auto-detect (§5) and governs whether an ownership record and holding-cost meter are created and how many closings are coordinated.

---

## 5\. Auto-detect (classification at intake)

Intake sources: **voice intake**, **Gmail contract scan**, **manual PDF upload**. The classifier sets `strategy`, `representation`, `title_path`, `creative_substructure`, then loads the matching template (§6).

Signal → classification rules:

- **Retail (agency):** representing a client (client party present), single contract-to-close, commission expectation → `representation=agency`, `strategy=retail`.  
- **Flip:** purchase \+ **rehab budget** \+ intended **resale** \+ no rent/refi/tenant signals → `principal`, `flip`, `takes_title`.  
- **Wholesale:** **assignment clause present** \+ **no rehab budget** \+ cash-buyer disposition language → `principal`, `wholesale`, `title_path = assignment` (or `double_close` if no assignment clause but two-closing intent).  
- **Rental / BRRRR:** purchase \+ rehab budget \+ **rent estimate / DSCR** \+ **refinance intent**, no resale listing → `principal`, `rental_brrrr`, `takes_title`.  
- **Creative:** contract terms include "subject to existing mortgage," "owner carry / seller financing," "lease option," or "wrap"; takeover of existing loan; note/option instrument; balloon date → `principal`, `creative`, set `creative_substructure`, set `title_path` per substructure (sub-to/seller-finance \= takes\_title; lease-option \= contract\_rights).

Auto-detect runs at intake and is re-checked when the executed contract is scanned.

---

## 6\. Strategy templates (stages → tasks)

A **Stage** is a scoped task template. Completing a stage **auto-advances** the Asset and instantiates the next stage's tasks (this replaces all manual "Move Property to X" / "Move folder to X" tasks in the legacy boards). `(auto)` marks system actions, not human tasks.

### 6.1 Flip — 7 stages

1. **Potential (Ready to Offer):** run disposition analyses · visit property · reno estimates from contractor · ARV from realtors · lock ARV \+ MAO · identify/confirm contractor · identify/confirm private lender · get completed inspections · identify closing fees · document comps · identify/confirm agent · verify analysis with JP · offer · accepted offer details.  
2. **Under Contract → Purchase:** notice of interest filed · closing date to purchase · *(auto)* Drive folder \+ Chat space · inspections · due diligence · private lender agreement · contractor agreement · review title docs · repairs · schedule utilities · property/builder's-risk insurance · choose+email title co · wire EMD · SOW \+ design walkthrough · upload purchase agreement · *(auto)* advance to Rehab.  
3. **Rehab (Renovations):** closing docs · renovation timeline · contractor lockbox · change orders · record mortgage · **draw cycle** (request → verify/photos → lien waiver → release → log; retainage held) · weekly pictures/video · weekly contractor update · bi-weekly private lender email · punch-list walkthrough · monthly expense update · *(auto)* advance to Prep.  
4. **Prep to List:** professional cleaning · soft staging · professional photos · list property · invoices to Drive \+ net sheet · home warranty · walk-through video · schedule open house · listing details · monthly expense update.  
5. **On Market:** *(auto)* Drive folder · 1st open house · open-house schedule · email private lender (new status) · re-evaluate for price drop · bi-weekly lender emails · monthly expense update.  
6. **Pending:** closing date · buyer repair request · remove soft staging after appraisal · finalized bills to title · update seller net sheet · finalize private lender payoff · approve settlement statement · update MLS to pending · send contract to title · home-warranty buyer-name update · final expense updates.  
7. **Sold:** notify PML of sale · upload closing docs to Drive · settlement statement to insurance \+ bookkeeper · update MLS to sold · pay profit splits · **profit reconciliation (actual ROI vs locked projection) \+ post-mortem to Production** · release retainage to contractor · remove sign \+ lockbox · *(auto)* archive Drive \+ board.

### 6.2 Wholesale — 5 stages

1. **Lead Gen & Deal Analysis:** research property (title, liens) · estimate ARV · drive-by/visit · calculate MAO · estimate repair costs · identify motivated-seller situation · verify analysis with JP · make offer · accepted offer details.  
2. **Under Contract:** execute PSA · submit EMD · notice of interest filed · order title search · review title docs · *(auto)* Drive folder \+ Chat · upload contract docs · **confirm assignment clause** · schedule inspection (if needed) · set contingency deadlines · upload photos · choose+email title co.  
3. **Marketing to Buyers / Disposition:** upload photos to marketing · blast cash buyers list · post on wholesale platforms/FB · schedule buyer showings · collect proof of funds · **negotiate assignment fee** · select end buyer.  
4. **Assignment / Double Close:** **execute assignment agreement (or double close)** · collect buyer's EMD · send assignment/contract to title · confirm title has all docs · schedule closing · coordinate seller \+ buyer for closing · review \+ approve settlement statement.  
5. **Deal Closed:** upload closing docs to Drive · settlement statement to bookkeeper · *(auto)* update Production/CRM · follow-up thank-you to seller · follow-up with buyer for future deals (strengthens cash-buyers list) · *(auto)* archive Drive \+ board.

### 6.3 Rental / BRRRR — 6 stages

1. **Lead Gen & Deal Analysis:** research property · estimate ARV (for refi appraisal) · estimate market rent · estimate repairs · MAO (purchase+rehab+holding ≤ \~75% ARV) · run BRRRR/DSCR model (capital-left-in) · visit · verify with JP · offer · accepted offer details.  
2. **Under Contract (Purchase):** execute PSA · EMD · title search/review · inspections/DD · acquisition/bridge financing · builder's risk · contractor agreement \+ SOW · *(auto)* Drive \+ Chat · upload docs · choose+email title · wire EMD · close (deed+mortgage) · *(auto)* advance to Renovations.  
3. **Renovations (rent-ready spec):** rehab kickoff (SOW \+ draw schedule) · **draw cycle** (lien waiver \+ retainage) · weekly photos \+ contractor update · bi-weekly lender update · holding-cost tracking · punch-list · *(auto)* advance to Lease-Up.  
4. **Lease-Up (Tenant Placement):** make-ready/clean · switch to landlord/dwelling insurance · set rent \+ create listing · market \+ schedule showings · tenant screening (app, credit/background, income, references) · select tenant · execute lease · collect deposit \+ first month · move-in inspection (photos) · set up rent collection · transfer utilities.  
5. **Refinance (cash-out — 2nd closing):** order appraisal · submit refi app (DSCR) · provide lease \+ rent roll · refi title/closing · pay off acquisition loan \+ private lender · receive cash-out · **reconcile capital recovered vs invested** · update capital stack/notify partners · *(auto)* advance to Under Management.  
6. **Under Management (recurring — does not terminate):** monthly rent collection · monthly P\&L update · maintenance handling · periodic inspections · lease renewal/annual rent review · tax+insurance escrow tracking · year-end Schedule E · recurring partner/lender updates.

### 6.4 Creative Finance — 6 stages (compliance-heavy, see §13)

1. **Lead Gen & Deal Analysis (term-driven):** identify seller situation/motivation · pull existing loan details (balance, rate, payment, escrow, due-on-sale) · determine structure · calculate entry cost \+ monthly cash flow \+ exit/balloon · **attorney review of structure** · visit · verify with JP · offer (with terms) · accepted offer details.  
2. **Under Contract / Structuring:** execute attorney-drafted instruments (note+DOT / lease+option / wrap-AITD / sub-to docs) · title search \+ title insurance (confirm underlying loan/liens) · set up third-party loan servicing · establish underlying-mortgage payment method · confirm seller's loan current · insurance transfer/add insured · record deed (sub-to) or note · due-on-sale risk plan · *(auto)* Drive \+ Chat · upload all executed docs.  
3. **Stabilization (optional):** light rehab (reuse draw cycle) · tenant placement (reuse Lease-Up) · or occupy/hold as-is.  
4. **Loan Servicing & Hold (recurring — core):** **pay underlying mortgage on time** (top-severity recurring) · collect tenant/buyer payment · monthly payment reconciliation · monitor underlying loan · monitor due-on-sale exposure · track balloon/exit date (lead-time alerts) · send periodic statements · annual 1098 (if lender) · insurance renewal tracking.  
5. **Exit / Payoff:** trigger exit plan (refi/sell/seller-finance/option exercised) · order payoff statement · coordinate exit closing · satisfy/release note or DOT · notify seller of payoff (clears liability) · final reconciliation \+ return calc.  
6. **Deal Closed:** upload closing docs · settlement statement to bookkeeper · *(auto)* update Production/CRM · *(auto)* archive Drive \+ board.

---

## 7\. Shared engines & investor extensions

Everything here is shared across retail and investor; only the template \+ economics fork.

- **Contacts / CRM:** add investor roles (private\_money\_lender, contractor, cash\_buyer, tenant, partner). The **cash-buyers list** is a saved segment used as a wholesale disposition channel. **Capital stack** lenders are contacts with CapitalStackEntry records.  
- **Comms engine \+ recency:** Gmail **and Google Chat** are both comms sources. Inbound message on a deal resets recency. Silence beyond threshold → risk signal (the existing Silent-7D+ logic, generalized).  
- **Scan:** Gmail contract detection → auto-create Asset or auto-advance to Under Contract; feeds auto-detect (§5).  
- **Drive:** **auto-scaffold** a folder tree per Asset and per Transaction; auto-move/auto-archive on stage change (replaces manual "Create Drive folder" / "Move folder to Sold/Closed" tasks).  
- **Chat (Google Chat):** auto-create a deal space per Asset; cadence updates post in; replies feed recency. See §11.  
- **Risk engine:** existing milestone-overdue \+ comms-silence, **extended** with budget overrun, schedule slip, and cash-flow/payment signals. Per-strategy signal sets in §10.  
- **Draw engine (flip \+ BRRRR rehab):** draw schedule tied to milestones; **lien-waiver gate** before release; **retainage** (\~10%) held to punch-list; lender-release reference logged; each draw logs to the expense sheet.  
- **Recurring-task engine (hold/servicing stages):** Stage with `is_recurring=true` generates a repeating monthly task set; missed cadence is a risk signal (same mechanism as a silent contractor). Used by Rental Under-Management and Creative Loan-Servicing.  
- **Holding-cost meter:** runs for `takes_title` assets — interest, taxes, insurance, utilities accrue daily and feed the profit projection.

---

## 8\. Automation rules

1. **Auto-advance:** completing a stage advances the Asset and instantiates the next stage's tasks. Eliminates every manual "Move Property to X" task.  
2. **Auto Drive:** scaffold folder tree on Asset/Transaction creation; move \+ archive on stage change.  
3. **Auto Chat:** create deal space on Asset creation.  
4. **Auto CRM/Production update** on close (replaces "Update Deal Tracker / CRM").  
5. **Cadence generation \+ silence detection:** recurring cadences (contractor weekly, lender bi-weekly, etc.) auto-create and are watched for silence → risk.

---

## 9\. Economics & reporting

Per-strategy economics object:

- **Retail:** commission / GCI.  
- **Flip:** purchase \+ rehab \+ holding → sale → profit, ROI, days-to-flip; actual vs locked projection.  
- **Wholesale:** assignment fee (spread), EMD exposure, days-to-assign.  
- **Rental/BRRRR:** cash flow, cap rate, DSCR, **capital-left-in** after refi.  
- **Creative:** monthly cash flow, entry/exit spread, balloon horizon.

**Unified Production view** rolls commission income (retail) and investment P\&L (investment) into one business view, tagged by revenue type. **Profit reconciliation \+ post-mortem** (actual vs projected, by contractor and neighborhood) feeds Production so the investor learns what performs.

---

## 10\. Risk-engine signal catalog (by strategy)

- **Retail:** overdue milestones · comms silence · contingency deadlines.  
- **Flip:** rehab over budget · schedule slip · holding costs accruing · no buyer near completion · comms silence.  
- **Wholesale:** contingency/assignment window closing with no end buyer · buyer's EMD not collected while committed to seller · EMD exposure.  
- **Rental/BRRRR:** rehab over budget (erodes 75% rule) · appraisal low (capital stranded) · lease-up days-on-market · DSCR below threshold · (hold) late rent · deferred maintenance · lease expiring without renewal · negative cash flow.  
- **Creative:** **underlying-loan payment missed/late (top severity)** · balloon approaching with no exit funded · due-on-sale called · escrow shortfall raising payment · insurance lapse · seller bankruptcy clouding title.

---

## 11\. Google Chat integration

- **Deal space per Asset**, members \= team (JP, Heather, Sherri) \+ relevant contacts (contractor, lender).  
- **Outbound:** REOS posts events (milestone hit, draw approved, inspection scheduled, status change).  
- **Inbound:** replies are captured as CommsEvents and **reset recency** (extends the silent-deal detector).  
- **Bot/slash:** e.g. `/status 124 Main` returns a deal summary; turn a message into a task.

---

## 12\. Recommended build sequence

1. **Phase 0 — core extensions:** Asset object \+ reparenting (Transactions/Projects as children); `representation` / `title_path` / `strategy` fields; entitlement flag \+ Retail/Investment filter; extend Contacts roles. Reuses existing comms/scan/Drive/risk.  
2. **Phase 1 — wedge template: Wholesale.** Lightest lift (mostly TC you already have, no rehab/PM), fastest to ship, validates auto-detect \+ auto-advance \+ Chat \+ cash-buyers list.  
3. **Phase 2 — Flip \+ Draw engine \+ Holding-cost meter.** The full TC+PM showcase; introduces the draw cycle, lien-waiver gate, retainage, recurring cadences.  
4. **Phase 3 — Rental/BRRRR.** Adds Lease-Up, the Refinance second-closing, and the **recurring-task engine** (Under Management).  
5. **Phase 4 — Creative Finance.** Servicing engine, balloon/payment alerts, substructure handling. Ship after legal review (§13).  
6. **Phase 5 — Hybrid deals \+ unified Production/reconciliation.**

---

## 13\. Legal & compliance caveats

Creative-finance instruments are **attorney- and state-specific**. Structures such as seller-financing to owner-occupants carry regulatory exposure (e.g. Dodd-Frank / SAFE Act) and **due-on-sale** risk. REOS must **track, checklist, and service** these — deadlines, payments, alerts, document storage — and must **not generate the legal instruments**. Keep instruments attorney-provided and uploaded. (This is an engineering/product flag, not legal advice; confirm with counsel before shipping Phase 4.)  
