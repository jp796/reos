# Atlas Agent — Build Specification

**Status:** spec for review (not yet built) · **Audience:** Claude Code / JP
**Premise:** turn REOS from a system you *operate* into a system you *talk to* —
run any deal by chat / Telegram / voice, and it updates itself — without ever
sacrificing reliability.

---

## 0. What it is

A conversational AI layer ("Atlas") on top of the deterministic engines already
built (stages, tasks, draws, economics, risk, visibility, scan). You describe
what happened in plain language; Atlas figures out the deal, the intent, and the
actions, executes them through the existing engines, and reports back exactly
what changed.

Channels: **in-app chat · Telegram · voice** — all the same agent core.
Scope: **agent (retail) AND investor deals on the same spine**, extensible to
**rental & multifamily** later with zero agent rewrite (it just gains tools).

### Positioning (vs ListedKit, per JP)
- **Reliability is the product.** "Flawless, no mistakes" is an architecture
  choice (below), not a hope. This is the wedge.
- **Flat monthly pricing, not per-deal.** The architecture has ~zero marginal
  cost per deal (it's your infra), so "unlimited deals, one price" is honest and
  undercuts a per-deal model structurally.
- **One system for agent + investor** (most TC AI is agent-only). Investor +
  rental + multifamily on the same brain is the moat.

---

## 1. The core principle (this is how you get "no mistakes")

**The AI interprets. Deterministic code executes and verifies. The AI never
freehands anything that has to be right.**

You can't make an LLM *never* err. You *can* make the **system never execute a
wrong irreversible action** — by forcing every action through a fixed set of
typed tools, each of which:

1. calls an existing deterministic engine/API (the same ones the UI uses),
2. validates inputs against a strict schema (the model can't invent a field),
3. enforces the real rules (the lien-waiver gate, role checks, tenancy, deadline
   math) — the AI **cannot bypass** them,
4. returns the *actual* new state, and Atlas reports what truly changed — never
   what it "intended."

So the model is the **interface**; the engines are the **system of record**.
A hallucinated date never lands as a deadline, because setting a deadline is a
tool with date validation — not free text.

This mirrors REOS's own foundation (and PAI's): *as deterministic as possible,
code before prompts, scaffolding > model.*

---

## 2. The toolbox (what Atlas can actually do)

Each tool = natural-language intent → one deterministic call. Read tools are
free; write tools are gated (see §4).

| Domain | Tools (write unless noted) | Backs onto |
|--------|---------------------------|-----------|
| **Find / context** *(read)* | find deal, summarize deal, list tasks / deadlines / parties / draws, deal status | existing queries + AtlasChatService |
| **Tasks** | add task, complete task, reassign, set due date | Task APIs |
| **Timeline / deadlines** | set / adjust milestone date (inspection, closing, financing, balloon…) | Milestone APIs + business-day math |
| **Stages (investor)** | advance stage / set stage (seeds that stage's tasks) | StageEngine (built) |
| **Parties** | add / update party (buyer, seller, lender, contractor, title, inspector, tenant) | ParticipantsPanel API |
| **Draws (investor)** | request / verify / release draw — **lien-waiver gate stays enforced** | DrawEngine (built) |
| **Economics** | set economics inputs (purchase / rehab / sale / rents…) | DealEconomicsService (built) |
| **Comms** | draft email / message; **send (confirm)**; log call / note | EmailDraft + SendPanel APIs |
| **Calendar** | create / sync calendar events | calendar sync (built) |
| **Access** | assign TC; **restrict deal (owner/admin only)** | visibility + assignment (built) |
| **Scan** | trigger email / contract scan + apply extracted fields | scan + extraction (built) |

New deals: "start a flip at 123 Main, $120k purchase, assigned to Sheri" →
create-from-scan + classify + set economics + assign, in one turn.

---

## 3. Channels (one brain, many doors)

- **In-app chat** — `AtlasChatService` extended with the toolbox.
- **Telegram** — inbound webhook (already exists) → agent → reply. Each Telegram
  chat is **bound to a REOS user** via a one-time link code, so identity +
  permissions are real (not an open bot).
- **Voice intake** — existing recorder → same agent.

All channels resolve to the same agent core → same tools → same guardrails. No
capability exists in one channel that isn't governed identically in the others.

**The experience:**
> *Text the bot:* "Inspection passed on 3453 Willard — move it to rehab, set the
> contractor draw schedule, and remind me to call the lender Monday."
> *Atlas:* "On it — confirm: advance **3453 Willard** to **Rehab**, create a draw
> schedule, and a reminder **Mon 9am** to call the lender? (yes/no)"
> *You:* "yes"
> *Atlas:* "Done. Willard → Rehab, 11 tasks added, draw schedule created,
> reminder set. ✅"

---

## 4. Guardrails — the "flawless" layer (the real differentiator)

1. **Confirmation tiers.**
   - *Auto* — reads, summaries, low-risk logs.
   - *Confirm* — any reversible write (add task, set date, advance stage).
   - *Double-confirm* — irreversible / outward-facing: **send a message,
     record/release money, change visibility, delete**. Especially over
     Telegram, where there's no UI to undo — explicit "yes" required, echoing
     REOS's existing "explicit-permission" posture.
2. **Identity & permission inheritance.** A Telegram/voice message resolves to a
   REOS user; the agent acts **as that user** — bound by the same role checks and
   the per-deal visibility we built. Atlas literally cannot touch a deal the user
   can't see, or restrict a deal unless they're owner/admin.
3. **Tenant isolation.** Agent scoped to the user's account, always.
4. **Ambiguity → ask, never guess.** "Move it" with two open deals → Atlas asks
   which. No silent wrong target.
5. **No-hallucination rule.** Atlas states only facts returned by tools; unknowns
   are "let me check" or "I don't have that," never invented.
6. **Verify-after-action.** Tools return new state; Atlas reports the diff, so a
   silent partial failure can't read as success.
7. **Full audit trail.** Every agent action logged: channel, user, intent, tool,
   before/after — reuse `AutomationAuditLog`. Reversible where the engine allows.
8. **Idempotency.** Repeated/duplicate commands dedupe (no double-advancing a
   stage from a retried Telegram message).

> "No mistakes" = these eight, not a smarter model. The model can misread; the
> *system* still won't do the wrong irreversible thing.

---

## 5. Works for agent + investor — and scales to rental / multifamily

The agent layer is **strategy-agnostic**. A deal's `representation` + `strategy`
just change *which* tools/stages are in play:
- **Agent (retail):** contract-to-close tools, client comms cadence.
- **Investor (flip/wholesale/BRRRR/creative):** + stages, draws, economics.
- **Rental / long-term:** the recurring engine (built) + lease/tenant tools.
- **Multifamily (future):** add a `multifamily` strategy + unit-level
  sub-entities (per-unit leases, rent roll); the agent gains unit tools — the
  brain doesn't change.

This is the payoff of building the structured spine first: **new asset classes =
new tools, not a rewrite.** The agent grows by addition.

---

## 6. Pricing / packaging (business note, not engineering)

Flat **per-seat monthly** (or per-account tier), unlimited deals. The system has
no per-deal marginal cost beyond LLM tokens, which a flat tier absorbs with a
per-account monthly token budget (overage = soft-throttle, not per-deal billing).
Marketing line: *"Run unlimited deals — agent or investor — for one flat price."*

---

## 7. Recommended build sequence

- **Phase A — Atlas write-tools (in-app).** Give `AtlasChatService` the core
  toolset (find, tasks, deadlines, stage, notes, parties) + the confirm tiers +
  audit log. Verify entirely in-app first. *This is the heart; everything else is
  a channel on top.*
- **Phase B — Telegram channel.** User↔Telegram binding (link code), inbound
  webhook → agent → confirm/reply. Outbound already exists.
- **Phase C — Proactive.** Agent watches the email scan + deadlines and *nudges*:
  "Willard's inspection objection is in 2 days and no notice is logged — want me
  to draft it?"
- **Phase D — Money + external tools.** Draws, send-email, calendar — the
  double-confirm tier, shipped last and most carefully.
- **Phase E — Voice + multi-step batch.**

Each phase: deterministic tools + schema tests + the confirm/audit harness. Ship
read-only and reversible tools before money/external ones.

---

## 8. Honest risks

- **LLM tool-calling can still pick the wrong tool/args** → mitigated by strict
  schemas, confirm tiers, verify-after, and ambiguity-asks. The blast radius of a
  misfire is a declined confirmation, not a corrupted deal.
- **Telegram identity binding** must be a real link-code flow, not an open bot.
- **External actions (send email/SMS)** are the highest risk — gated to
  double-confirm and shipped last.
- **Token cost** under flat pricing — needs a per-account budget + cheap-model
  routing for reads.
- **"Flawless" is a process, not a state** — it comes from the harness +
  regression evals on the tool layer, run before every change (like the
  extraction-quality harness already does).
