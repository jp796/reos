"use client";

/**
 * GuidedIntakeWizard — the 5-step initial-setup flow (parallel build).
 *
 * Lives at /transactions/new/guided so it can be developed without
 * disturbing the live /transactions/new create flow. Swaps in once all
 * five steps are complete. Spec: docs/VISION_GUIDED_INTAKE.md.
 *
 *   1 Upload  → 2 Review details → 3 Timeline → 4 Compliance → 5 Tasks
 *   → create deal → open the transaction file
 *
 * Between steps, an AtlasWorking interstitial plays while the AI builds
 * the next step's data. This file owns the step state machine + the
 * interstitial transitions; each step's body is a child component
 * (built incrementally — placeholders below until each lands).
 */

import { useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { StepProgress } from "@/app/components/StepProgress";
import { AtlasWorking } from "@/app/components/AtlasWorking";

const STEP_LABELS = ["Upload", "Details", "Timeline", "Compliance", "Tasks"];

/** Label shown in the AtlasWorking interstitial entering each step. */
const ENTER_LABEL: Record<number, string> = {
  2: "Reading your contract",
  3: "Building your timeline",
  4: "Creating your compliance checklist",
  5: "Generating tasks",
};

export function GuidedIntakeWizard() {
  const [step, setStep] = useState(1);
  // When set, an AtlasWorking interstitial is showing before `target`.
  const [working, setWorking] = useState<{ label: string; target: number } | null>(
    null,
  );

  // Advance with an interstitial "Atlas is building…" beat. The real
  // version will await the actual generation (extraction / timeline /
  // compliance / tasks) instead of a timer; the state shape is the same.
  function advanceTo(target: number) {
    const label = ENTER_LABEL[target];
    if (!label) {
      setStep(target);
      return;
    }
    setWorking({ label, target });
    // Placeholder beat until the real async generation is wired per step.
    window.setTimeout(() => {
      setStep(target);
      setWorking(null);
    }, 1400);
  }

  if (working) {
    return (
      <div className="py-8">
        <StepProgress current={working.target} total={5} labels={STEP_LABELS} />
        <AtlasWorking label={working.label} />
      </div>
    );
  }

  return (
    <div className="py-6">
      <StepProgress current={step} total={5} labels={STEP_LABELS} />

      <div className="mt-8 min-h-[320px]">
        {step === 1 && <StepPlaceholder title="Upload a contract" hint="Drop the purchase contract (+ related docs). Atlas reads it." />}
        {step === 2 && <StepPlaceholder title="Review transaction details" hint="Split-screen: extracted fields (left) + the contract PDF (right). Every field editable." />}
        {step === 3 && <StepPlaceholder title="Review your timeline" hint="Computed deadlines — edit, flag key milestones, add your own." />}
        {step === 4 && <StepPlaceholder title="Confirm your compliance checklist" hint="AI-suggested documents — edit, remove, add, apply templates." />}
        {step === 5 && <StepPlaceholder title="Review tasks" hint="Context-aware tasks with auto-draft emails — edit before finishing." />}
      </div>

      <div className="mt-8 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setStep((s) => Math.max(1, s - 1))}
          disabled={step === 1}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-muted hover:border-border-strong hover:text-text disabled:opacity-40"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </button>
        <button
          type="button"
          onClick={() => (step < 5 ? advanceTo(step + 1) : undefined)}
          className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500"
        >
          {step < 5 ? "Continue" : "Create & open deal"}
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

/** Temporary per-step placeholder until each real step body lands. */
function StepPlaceholder({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-surface-2 p-8 text-center">
      <h1 className="font-display text-2xl font-semibold">{title}</h1>
      <p className="mx-auto mt-2 max-w-md text-sm text-text-muted">{hint}</p>
      <p className="mt-4 text-xs text-text-subtle">
        Building this step next — see docs/VISION_GUIDED_INTAKE.md
      </p>
    </div>
  );
}
