# Guided Deal Intake — Build Spec (ListedKit-grade, uniquely REOS)

> North star for the multi-step "New Transaction" wizard. Source of truth
> for phasing; update status here as phases land. Reference: JP's
> ListedKit screenshots (2026-06-25 session).

## Principle

AI-driven, **editable as you go**, clean and uncluttered. Every AI
generation step shows the `AtlasWorking` animation. Atlas **asks**
(confirm-as-you-go) instead of dumping a form — this doubles as a trust
feature (verify, don't blindly trust the AI).

## The flow — 5-step INITIAL SETUP wizard

This whole flow is the deal's **initial setup**, shown with a `Step N of 5`
progress bar. After Step 5 the deal is **created and the user lands on the
Transaction file** (deal detail page). The `AtlasWorking` animations and the
inline anchor-date confirm are interstitials *within* steps — NOT numbered steps.

```
Step 1 — Upload contract (+ related docs)
   ⟳ Reading your contract
Step 2 — Review Transaction Details   (split-screen: sectioned fields | contract PDF)
            inline confirm anchor: "Does this Effective Date look right?"
   ⟳ Building your timeline
Step 3 — Review Your Timeline         (deadlines: edit / flag / delete / find, + Add Deadline)
   ⟳ Creating your compliance checklist
Step 4 — Confirm Compliance Checklist (AI docs: edit / remove / add, templates, right-rail timeline)
   ⟳ Generating tasks
Step 5 — Review Tasks                 (context-aware tasks w/ auto-email, edit / remove)
   → Create deal → OPEN the Transaction file
```

## Per-step detail

### Review details (split-screen)
- Left: sectioned editable cards — **Property** · **Parties** (buyers/sellers, each w/ email+phone) · **Agents** · **Brokerages** · **Financing Summary** · **Terms** (every contingency, full text).
- Right: the actual contract **PDF** (page thumbnails + zoom).
- Per field: edit (inline ✓/✗) · delete · **find-in-document** (jump to source).
- **"N missing items"** banner; "I couldn't find this — click to add."

### Review Timeline
- Computed deadlines w/ relative derivation shown ("3 business days after Effective Date").
- Per item: **flag** (mark key milestone — e.g. Closing), edit, delete, find. **+ Add Deadline.**

### Confirm Compliance Checklist
- AI-suggested required docs (✨), each w/ description, edit/remove. Search, **+ Add Document.**
- **Upload a template** / build-your-own (from your own docs). Right-rail mini Transaction Timeline.

### Review Tasks
- AI tasks reference **real extracted parties/agents by name**.
- Per task: **Auto-Email** badge, due date (often relative), edit/remove.
- **Edit Task modal:** title · due date · **auto-draft email toggle** · email template (optional; AI picks if empty) · relative-date config (days · before/after · relative to **Deadline | Task | Document** · related item) · **"Tell Atlas what to do"** (NL instruction for the draft) · notes · **related compliance item**.

## Data model (additions needed)

- **Extraction** — ✅ DONE (Phase 1): ContractParty/Agent/Brokerage/Contingency + property/financing scalars.
- **TimelineItem** — {name, date, anchor?, offsetDays?, unit?, isMilestone(flag), source span?}.
- **ComplianceItem** — {name, description, source: ai|template|manual, required}.
- **Task (rich)** — {title, dueDate|relative{days,direction,relativeTo,relatedId}, autoDraftEmail, emailTemplateId?, instruction("tell Atlas"), notes, relatedComplianceItemId?, relatedParties[]}.

## Assets we already own (reuse, don't rebuild)

- Relative-deadline engine (business-days, holiday-aware) → `computeRelativeDeadlines`, `src/lib/business-days.ts`.
- Task templates + `apply-task-template`; Compliance templates + `apply-compliance-template`.
- `ScheduledEmailService`, `draftEmailReply`, Atlas `draft_email` tool.
- `AtlasWorking` loader (every AI step). ✅
- Deep extraction schema. ✅

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | Deep extraction schema + AI-working loader | ✅ shipped (reos-00219) |
| 1v | Verify extraction on a real contract (1650 North Ridge Dr) | ⏳ needs PDF |
| 2 | Split-screen review UI (fields \| PDF, per-field edit/find, missing-items) | next |
| 3 | Atlas-asks: inline ✓/✗, confirm-anchor-date step | next |
| 4 | Review Timeline step (flags, add, relative display) | next |
| 5 | Compliance checklist step (AI docs, templates, right-rail timeline) | next |
| 6 | Tasks step + rich Edit Task modal (auto-email, relative sched, compliance link) | next |
| 7 | Create mapping (rich intake → Transaction/Asset + tasks + compliance) | next |

## Mascot system (decided)

- **Full Atlas character** → hero/welcome/marketing (wizard front door ✅).
- **Simple Atlas mark** → chat avatar + ✨ Ask Atlas button (TODO, avoids cheesy repeating-human-head).
