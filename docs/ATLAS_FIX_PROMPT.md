# ATLAS Fix Prompt — Live Extraction, Contextual Tasks, UI Cleanup

Paste the block below into Claude Code (ATLAS) inside the `reos` repo.

## Key finding (root cause)

The live "watch it read" screen (`src/app/transactions/LiveExtractionView.tsx`) already
has contingency and task sections, **but the task list there is fake** — it's derived from
a hardcoded 8-item `TASK_FOR_DATE` map inside the component, not from the real AI task
engine (`AiTaskGenerationService` / `generateDealTasks`), which only runs *after* the deal
is created. Contingencies also only render if the model finishes streaming that array
before the screen navigates away. That's why the animation shows deal terms but rarely the
contingency framework or a real task list.

---

## Copy-paste prompt

```
Context: REOS (real-estate-os). Next.js App Router, Prisma, bun. The "Reading your
contract" live screen is src/app/transactions/LiveExtractionView.tsx, mounted by
src/app/transactions/new/NewTransactionWizard.tsx, fed by the SSE route
src/app/api/automation/extract-contracts-stream/route.ts, which calls
ContractExtractionService.extractStream() in src/services/ai/ContractExtractionService.ts.
Real AI task generation lives in src/services/ai/AiTaskGenerationService.ts and
src/services/core/GenerateDealTasksService.ts. Templates: prisma model TaskTemplate,
plus src/services/core/TaskTemplates.ts and UserTaskTemplates.ts.

I have THREE problems. Investigate the files above first, then propose a plan before coding.

PROBLEM 1 — The live "watch it read" screen only shows Deal Terms; the contingency
framework and task list barely/never build.
Root causes I've already found (confirm, then fix):
(a) The task list in LiveExtractionView is FAKE — it's derived from the hardcoded
    TASK_FOR_DATE map (8 date→label pairs) in that component. It does NOT use my real
    AI task engine (AiTaskGenerationService/generateDealTasks). Replace it so the live
    screen streams the REAL, contract-contextual task list from the AI engine.
(b) Contingencies only render if the model finishes streaming the `contingencies` array
    before the `merged` event fires and the wizard navigates to review. Fix the ordering
    so the user actually watches the contingency framework build, and don't advance off
    the reading screen until deal terms + contingencies + tasks have all streamed in.
Goal: three phases that visibly stream in sequence on that same screen, like Claude Code
showing its work — (1) Deal Terms, (2) Contingency framework, (3) Task list — each item
animating in as it's derived. The task list must reflect the actual AI-generated tasks,
not a static date map.

PROBLEM 2 — Task lists must be fully AI-driven from contract context, PLUS learn from
history. No hard-coded template.
- Every deal's task list should come from the AI engine reading THAT contract's terms +
  contingencies (this mostly exists in AiTaskGenerationService — surface it in the live
  view and make it the source of truth).
- NEW: build a learning layer. Mine my historic/closed transactions to detect recurring,
  redundant task flows across past deals of the same type (side, financing type, strategy,
  state) and synthesize reusable TaskTemplate rows from them — templates that EMERGE from
  history, not hard-coded. Then use those learned templates to pre-populate/suggest tasks
  for new contracts of the same type, while still adapting to the specific contract.
  Follow the pattern in src/services/automation/SmartFolderLearnService.ts for the
  learn-from-history approach, and persist into the existing TaskTemplate model. Suggest a
  service name like TaskTemplateLearnService and wire it into generateDealTasks so contract-
  context comes first and learned templates augment it.

PROBLEM 3 — Cleaner UI (nav lives in src/app/AppShell.tsx).
Keep current structure, tighten UI/UX. Reference layout I like (ListedKit):
- Left nav: Dashboard, Contacts, Transactions grouped by status (Active Listing, Under
  Contract, Closed, Void) with the property address shown under each status.
- Keep an integrations bar pinned at the bottom.
- Right-side panel with tabs (Timeline, Tasks, Details, Compliance, Email) and a clean
  task list showing task name, due date, and email/calendar icons.
- More whitespace, lighter borders, cleaner typography, less clutter. Use existing
  design tokens (reos-label, surface/border classes, Montserrat).

Constraints: bun/bunx only, TypeScript, every query scoped by actor.accountId, run
`bunx tsc --noEmit` before finishing. Show me the plan and the files you'll touch before
implementing.
```

---

## File reference (already traced)

| Concern | File |
|---|---|
| Live "watch it read" screen | `src/app/transactions/LiveExtractionView.tsx` |
| Wizard mounting it | `src/app/transactions/new/NewTransactionWizard.tsx` |
| SSE stream route | `src/app/api/automation/extract-contracts-stream/route.ts` |
| Streaming extraction | `src/services/ai/ContractExtractionService.ts` (`extractStream`) |
| Incremental JSON parser | `src/services/ai/streamingJson.ts` |
| Real AI task generation | `src/services/ai/AiTaskGenerationService.ts` |
| Deal task orchestration | `src/services/core/GenerateDealTasksService.ts` |
| Built-in task templates | `src/services/core/TaskTemplates.ts` |
| User/AI task templates | `src/services/core/UserTaskTemplates.ts` |
| Learn-from-history precedent | `src/services/automation/SmartFolderLearnService.ts` |
| App nav / shell | `src/app/AppShell.tsx` |
| Task/TaskTemplate models | `prisma/schema.prisma` |
