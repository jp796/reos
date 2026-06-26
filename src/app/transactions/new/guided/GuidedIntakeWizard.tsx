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
import { ReviewDetailsStep } from "./ReviewDetailsStep";
import { UploadStep, type Side } from "./UploadStep";
import {
  FIXTURE_1650,
  extractionToReviewModel,
  type ReviewModel,
} from "./reviewModel";
import { TimelineStep } from "./TimelineStep";
import { FIXTURE_TIMELINE } from "./timelineModel";
import { ComplianceStep } from "./ComplianceStep";
import { FIXTURE_COMPLIANCE } from "./complianceModel";
import { TasksStep } from "./TasksStep";
import { FIXTURE_TASKS } from "./taskModel";
import { useRouter } from "next/navigation";

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
  const [files, setFiles] = useState<File[]>([]);
  const [side, setSide] = useState<Side | null>(null);
  // When set, an AtlasWorking interstitial is showing before `target`.
  const [working, setWorking] = useState<{ label: string; target: number } | null>(
    null,
  );
  const [reviewModel, setReviewModel] = useState<ReviewModel | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [extractErr, setExtractErr] = useState<string | null>(null);
  const [createErr, setCreateErr] = useState<string | null>(null);
  const router = useRouter();

  // Advance with an interstitial "Atlas is building…" beat. Used for the
  // steps whose real generators aren't wired yet (timeline / compliance /
  // tasks); Step 1→2 uses runExtraction (a real async call) instead.
  function advanceTo(target: number) {
    const label = ENTER_LABEL[target];
    if (!label) {
      setStep(target);
      return;
    }
    setWorking({ label, target });
    window.setTimeout(() => {
      setStep(target);
      setWorking(null);
    }, 1400);
  }

  // Step 1 → 2: POST the contract to the extraction endpoint, adapt the
  // result into the review model, and show the real PDF. The AtlasWorking
  // animation covers the genuine round-trip.
  async function runExtraction() {
    const primary = files[0];
    if (!primary) return;
    setExtractErr(null);
    setWorking({ label: "Reading your contract", target: 2 });
    try {
      const fd = new FormData();
      fd.append("file", primary);
      const res = await fetch("/api/automation/upload-contract-to-create", {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't read the contract");
      setReviewModel(extractionToReviewModel(data.extraction));
      setPdfUrl(URL.createObjectURL(primary));
      setStep(2);
    } catch (e) {
      setExtractErr(
        e instanceof Error ? e.message : "Couldn't read the contract",
      );
    } finally {
      setWorking(null);
    }
  }

  function goNext() {
    if (step === 1) {
      void runExtraction();
      return;
    }
    if (step === 5) {
      void createAndOpen();
      return;
    }
    advanceTo(step + 1);
  }

  // Step 5 → create the real Transaction via the proven create-from-scan
  // pipeline (which computes the deal's own milestones/tasks), attach the
  // uploaded files, then open the deal file.
  async function createAndOpen() {
    const model = reviewModel ?? FIXTURE_1650;
    const address = fieldVal(model, "property", "address") || model.address;
    if (!address) {
      setCreateErr("A property address is required to create the deal.");
      return;
    }
    setCreateErr(null);
    setWorking({ label: "Setting up your deal", target: 5 });
    try {
      const body: Record<string, unknown> = {
        address,
        buyerName: entityName(model, "parties", "buyer"),
        sellerName: entityName(model, "parties", "seller"),
        effectiveDate: model.effectiveDate || null,
        purchasePrice: parseMoney(fieldVal(model, "financing", "price")),
        earnestMoneyAmount: parseMoney(fieldVal(model, "financing", "emd")),
      };
      if (side === "investor") body.resaleIntent = true;
      const res = await fetch("/api/automation/create-from-scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.transactionId) {
        throw new Error(data.error ?? "Couldn't create the deal");
      }
      if (files.length > 0) {
        const fd = new FormData();
        files.forEach((f) => fd.append("file", f));
        fd.append("origin", "guided");
        await fetch(`/api/transactions/${data.transactionId}/documents`, {
          method: "POST",
          body: fd,
        }).catch(() => {});
      }
      router.push(`/transactions/${data.transactionId}`);
    } catch (e) {
      setWorking(null);
      setCreateErr(e instanceof Error ? e.message : "Couldn't create the deal");
    }
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
        {step === 1 && (
          <UploadStep
            files={files}
            setFiles={setFiles}
            side={side}
            setSide={setSide}
          />
        )}
        {step === 2 && (
          <ReviewDetailsStep
            initial={reviewModel ?? FIXTURE_1650}
            pdfUrl={pdfUrl ?? undefined}
            onChange={setReviewModel}
          />
        )}
        {step === 3 && <TimelineStep initial={FIXTURE_TIMELINE} />}
        {step === 4 && <ComplianceStep initial={FIXTURE_COMPLIANCE} />}
        {step === 5 && <TasksStep initial={FIXTURE_TASKS} />}

        {extractErr && step === 1 && (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200">
            {extractErr} — make sure the primary file is a PDF, then try again.
          </div>
        )}
        {createErr && step === 5 && (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200">
            {createErr}
          </div>
        )}
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
          onClick={goNext}
          disabled={step === 1 && (!side || files.length === 0)}
          className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-50"
        >
          {step < 5 ? "Continue" : "Create & open deal"}
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

// ── Pull create-from-scan fields out of the (edited) review model ────
function fieldVal(m: ReviewModel, sectionId: string, fieldId: string): string {
  const s = m.sections.find((x) => x.id === sectionId);
  if (!s || s.kind !== "fields") return "";
  return s.fields.find((f) => f.id === fieldId)?.value ?? "";
}
function entityName(
  m: ReviewModel,
  sectionId: string,
  badgeIncludes: string,
): string | null {
  const s = m.sections.find((x) => x.id === sectionId);
  if (!s || s.kind !== "entities") return null;
  const e = s.entities.find((en) =>
    (en.badge ?? "").toLowerCase().includes(badgeIncludes.toLowerCase()),
  );
  return e?.name ?? null;
}
function parseMoney(s: string): number | null {
  if (!s) return null;
  const n = parseFloat(s.replace(/[,$\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}
