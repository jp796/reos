# Atlas Trace — Prototype Handoff & Artifacts

> **Version:** 1.0 · **Date:** 2026-07-12 · **Status:** Prototype-first, awaiting approval
> **Source brief:** `REOS_05_Atlas_Trace_Design_System_Handoff_v1.0_2026-07-12.md`
> **Isolated route:** `/prototypes/atlas-trace` (chrome-less, no production wiring)
> **Rule honored:** no production workflow modified. This is a design review; stop here for approval before any production rollout.

---

## 0. What was built

Three isolated, interactive prototypes + a reusable primitive system + this
handoff. All under `src/app/prototypes/atlas-trace/` — nothing imports it back
into production. AppShell gained a one-line chrome-less guard for
`/prototypes/*` (routing only, reversible).

| Deliverable | Where |
|---|---|
| 1. Desktop contract-extraction prototype | `/prototypes/atlas-trace/contract-extraction` |
| 2. Reduced-motion variant | same route with OS "reduce motion" on |
| 3. Addendum-reconciliation prototype | `/prototypes/atlas-trace/addendum-reconciliation` |
| 4. Email-to-milestone prototype | `/prototypes/atlas-trace/email-to-milestone` |
| 5. Event-contract audit | §2 below |
| 6. Reusable component proposal | §3 + `components/primitives.tsx` |
| 7. Token + motion spec | §4 + `lib/traceTokens.ts` + `lib/trace.css` |
| 8. Accessibility notes | §5 |
| 9. Screenshots | `docs/reos05-evidence/` |
| 10. Production-integration sequence | §6 |

---

## 1. The pattern

`Source → recognition → transfer → structured result → provenance.` Five
semantic layers per trace (Source, Recognition, Interpretation, Consequence,
Provenance) and one shared state vocabulary (Searching, Found, Connecting,
Proposed, Applied, Needs review, Verified). Intensity scales to the work:
Ambient · Micro · Focused · Cinematic. It is a **truthful work trace**, not
chain-of-thought.

---

## 2. Event-contract audit (the key finding)

**The extraction pipeline already streams granular, fact-level progress over
SSE.** `POST /api/automation/extract-contracts-stream` emits, per document:

| Current event | Payload | Maps to target vocab |
|---|---|---|
| `doc` | `{name, index, total}` | `document_started` |
| `status` | `{message}` | (narration) |
| **`field`** | **`{key, value, confidence, snippet, source}`** | **`fact_found`** ✅ |
| `task` | `{task}` | `tasks_created` |
| `done` | `{extraction}` (per doc) | (doc complete) |
| `merged` | `{extraction, missingCritical}` | `complete` + `review_required` |
| `error` | `{message}` | `failed` |

The `field` event already carries the four things Atlas Trace needs for a
truthful trace: **normalized value, model confidence, a source-text anchor
(`snippet`), and the read method (`text | vision | computed`)**. Extraction is
driven by `ContractExtractionService.extractStream(buffer, emit)`.

**Gaps to close before production integration (documented, not faked):**

1. **Page number + optional bounding box** — the `field` event has `snippet`
   but no `page`/`bbox`. The extraction prompt already reads page context; add
   `page` (and, where safely available, a text-anchor/bbox) to the `field`
   payload so the trace can highlight the *exact* clause on the real PDF.
2. **Document id on `field`** — add `documentId` so multi-doc traces attribute
   each fact to its source file.
3. **Explicit semantic events** — `contingency_found`, `conflict_found`,
   `timeline_created`, `review_required` are currently *implicit* (folded into
   `field`/`status`/`merged`). Promote them to first-class events so the UI
   doesn't re-derive intent.
4. **No arbitrary progress %.** Keep it — the pipeline emits discrete facts, not
   a percentage. The prototypes render counts and confidence, never a fake bar.

Prefer SSE (already in use) for this predominantly server→client progress. No
timer-driven fake progress anywhere.

---

## 3. Reusable component proposal

One vocabulary, in `components/primitives.tsx` + `lib/`:

| Primitive | Role | Status |
|---|---|---|
| `useTraceRunner` / `usePrefersReducedMotion` (`lib/useTrace.ts`) | AtlasTraceProvider — drives reveal + reduced-motion + controls | built |
| `SourcePane` (in P1) | SourceDocument / SourceHighlight — the real PDF + clause highlight | built (PDF is representative in the prototype; real PDF in prod) |
| `TraceConnector` | thin ink-blue connector, organic curve | built |
| `RecognitionLabel` | restrained "what Atlas saw" | built |
| `ExtractedValue` / `DestinationField` | value in transit + where it lands + settle | built |
| `ProvenanceBadge` | persistent, clickable page/clause + snippet | built |
| `ConfidenceMarker` | 0–1 indicator, never a fake % | built |
| `ConflictComparison` | original vs superseding, both shown | built |
| `AtlasReceipt` | action · evidence · confidence · applied · view/correct | built |
| `TraceSummary` | completion counts + "Review the deal" | built |
| `TraceStateChip` | the shared state vocabulary | built |
| `PrototypeTag` | marks every screen as prototype | built |

Rule: no product surface may invent a separate version of the pattern — all
consume these primitives.

---

## 4. Token + motion spec (`lib/traceTokens.ts`, `lib/trace.css`)

- **Color:** the only active-trace color is **REOS ink blue = `brand-500`
  (#2563EB)**, referenced through the app's existing CSS variables so light/dark
  stay in sync. Paper/ink neutrals = `surface` / `surface-2` / `border` /
  `text`. **No gradients, glows, orbs, sparkles, particles, neon, or fake code.**
- **Line weight:** 1–2px paths; restrained source highlights; borders over
  decorative shadows.
- **Motion grammar (ms):** source highlight 150 · recognition label 200 ·
  connector draw 300 · value transfer 400 · destination settle 200 · provenance
  appear 150. Easing `cubic-bezier(0.22,0.61,0.36,1)` — short settle, slightly
  organic, not bouncy. One trace animates at a time; motion always communicates
  causality and never masks latency.
- **Confidence < 0.7 ⇒ "Needs review"** rather than silent apply.

---

## 5. Accessibility notes

Under `prefers-reduced-motion: reduce` (handled in `trace.css` + `useTrace.ts`):

- No scan motion, no flying values, no connector draw — the final,
  fully-provenanced state renders immediately.
- A static relationship indicator persists (source highlight + destination +
  the clickable provenance badge).
- Extracted facts are announced through an `aria-live="polite"` region
  (recognition + value + page + confidence).
- Full keyboard access; provenance badges are real buttons.
- Bidirectional navigation: from a field → its source (provenance badge → snippet);
  the extraction log lists every fact ↔ page.

Controls provided on Prototype 1: **Pause · Skip animation · Show all results ·
Replay trace · Extraction log** (and per-fact "Needs review" surfacing). The
trace stays fully useful with all motion disabled because provenance persists.

---

## 6. Recommended production-integration sequence

Ship in this order; each step is independently valuable and low-blast-radius:

1. **Ambient provenance first.** Add `ProvenanceBadge` (page/clause + snippet +
   confidence) to already-extracted fields on the transaction Details/Timeline.
   Pure read; no pipeline change. This alone delivers "where did this come from".
2. **Extend the `field` event** with `page` + `documentId` (audit gap 1–2). No UI
   motion yet — just richer data.
3. **Micro Trace on live upload.** Wire `useTraceRunner` to the real SSE stream
   on the contract-upload panel: each `field` event commits a real fact with a
   real source anchor. Cinematic intensity reserved for first ingestion only.
4. **Addendum reconciliation (Focused).** Use `ConflictComparison` +
   downstream-impact preview in the existing addendum-apply flow — proposed
   before applied, both sources shown.
5. **Atlas Receipts (Micro).** Emit an `AtlasReceipt` for each consequential
   automated action (email→milestone, auto-completions), stored + inspectable.
6. **Bidirectional causality graph.** Once facts carry stable ids +
   source anchors, enable "from a task: why?", "from a risk: what evidence?",
   "from a metric: which deals?".

Rarity preserves impact — Cinematic only for initial contract ingestion.

---

## 7. Truthfulness guarantees honored

No fabricated source text presented as a specific customer document (sample
data is clearly labeled); no result animated before it exists (the runner
commits a fact, then reveals it); every screen carries a **PROTOTYPE** tag;
low-confidence facts are surfaced for review, not silently applied; competing
sources (addendum vs contract) are both shown; no model chain-of-thought; no
motion used to disguise latency; no arbitrary progress percentages.

---

## 8. Stop point

Per the brief: **prototypes are presented for approval.** Motion, density,
provenance, accessibility, and the event contract need sign-off before any
rollout across production screens. Nothing here touches a production workflow.
