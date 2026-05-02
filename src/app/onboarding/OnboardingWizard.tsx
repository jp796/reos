"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ArrowLeft, Check, Loader2, Plus, X } from "lucide-react";
import { useToast } from "@/app/ToastProvider";

interface ProfileOption {
  id: string;
  slug: string;
  name: string;
  complianceSystem: string;
}
interface State {
  completedAt: string | null;
  step: number;
  brokerageProfileId: string | null;
  primaryState: string | null;
  calendarShareList: string[];
  listingPhotoProvider: string | null;
  socialPoster: string | null;
}

const STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC",
];

export function OnboardingWizard() {
  const router = useRouter();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [profiles, setProfiles] = useState<ProfileOption[]>([]);
  const [state, setState] = useState<State>({
    completedAt: null,
    step: 0,
    brokerageProfileId: null,
    primaryState: null,
    calendarShareList: [],
    listingPhotoProvider: null,
    socialPoster: null,
  });

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/onboarding");
        const data = await res.json();
        setProfiles(data.profiles);
        setState((s) => ({ ...s, ...data.state }));
        if (data.state.completedAt) router.replace("/today");
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  async function persist(patch: Partial<State> & { complete?: boolean }) {
    const res = await fetch("/api/onboarding", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? res.statusText);
    setState((s) => ({ ...s, ...patch }));
  }

  async function next() {
    try {
      await persist({ step: state.step + 1 });
    } catch (e) {
      toast.error("Save failed", e instanceof Error ? e.message : "unknown");
    }
  }

  async function finish() {
    try {
      await persist({ complete: true });
      toast.success("Setup complete", "Welcome to REOS.");
      router.push("/today");
    } catch (e) {
      toast.error("Save failed", e instanceof Error ? e.message : "unknown");
    }
  }

  if (loading) {
    return (
      <div className="text-center text-sm text-text-muted">
        <Loader2 className="mx-auto h-4 w-4 animate-spin" /> Loading setup…
      </div>
    );
  }

  const totalSteps = 5;
  const pct = Math.round(((state.step + 1) / totalSteps) * 100);

  return (
    <div>
      {/* Progress */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-2xl font-bold">Welcome to REOS</h1>
          <span className="text-xs text-text-muted">
            Step {state.step + 1} of {totalSteps}
          </span>
        </div>
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
          <div
            className="h-full transition-all"
            style={{ width: `${pct}%`, background: "var(--brand-gradient)" }}
          />
        </div>
      </div>

      {/* Steps */}
      {state.step === 0 && (
        <Step
          title="Pick your brokerage"
          sub="Drives compliance checklist, CDA template, and integration defaults. Pick the closest match — you can customize later in Settings."
        >
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {profiles.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => persist({ brokerageProfileId: p.id })}
                className={
                  "rounded-md border px-4 py-3 text-left transition-colors " +
                  (state.brokerageProfileId === p.id
                    ? "border-brand-500 bg-brand-50/40 dark:bg-brand-50/10"
                    : "border-border bg-surface hover:border-border-strong")
                }
              >
                <div className="font-medium">{p.name}</div>
                <div className="text-xs text-text-muted">
                  Compliance: {p.complianceSystem}
                </div>
              </button>
            ))}
          </div>
          <Nav
            onBack={null}
            onNext={state.brokerageProfileId ? next : null}
            nextLabel="Continue"
          />
        </Step>
      )}

      {state.step === 1 && (
        <Step
          title="Primary state"
          sub="Drives default contract rules — walkthrough, earnest-money, inspection windows. You can override per-deal."
        >
          <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-10">
            {STATES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => persist({ primaryState: s })}
                className={
                  "rounded border px-2 py-1.5 text-xs font-medium transition-colors " +
                  (state.primaryState === s
                    ? "border-brand-500 bg-brand-50/40 text-brand-700 dark:bg-brand-50/10"
                    : "border-border bg-surface hover:border-border-strong")
                }
              >
                {s}
              </button>
            ))}
          </div>
          <Nav
            onBack={() => persist({ step: state.step - 1 })}
            onNext={state.primaryState ? next : null}
            nextLabel="Continue"
          />
        </Step>
      )}

      {state.step === 2 && (
        <Step
          title="Calendar share-list"
          sub="Emails to invite on every milestone calendar event — your TC, brokerage compliance, co-agent. Skip if none."
        >
          <CalendarShareInput
            value={state.calendarShareList}
            onChange={(v) => persist({ calendarShareList: v })}
          />
          <Nav
            onBack={() => persist({ step: state.step - 1 })}
            onNext={next}
            nextLabel="Continue"
          />
        </Step>
      )}

      {state.step === 3 && (
        <Step
          title="Integrations"
          sub="Pick where REOS pulls listing photos from + how it publishes social posts. Defaults are fine — change later in Settings → Integrations."
        >
          <div className="space-y-4">
            <div>
              <div className="reos-label mb-1">Listing photos</div>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: "manual_upload", label: "Manual upload" },
                  { id: "reso_web_api", label: "MLS — RESO Web API (later)" },
                ].map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => persist({ listingPhotoProvider: p.id })}
                    className={
                      "rounded border px-3 py-2 text-left text-sm " +
                      (state.listingPhotoProvider === p.id
                        ? "border-brand-500 bg-brand-50/40 dark:bg-brand-50/10"
                        : "border-border bg-surface hover:border-border-strong")
                    }
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="reos-label mb-1">Social posting</div>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: "clipboard", label: "Copy + paste (default)" },
                  { id: "buffer", label: "Buffer (later)" },
                ].map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => persist({ socialPoster: p.id })}
                    className={
                      "rounded border px-3 py-2 text-left text-sm " +
                      (state.socialPoster === p.id
                        ? "border-brand-500 bg-brand-50/40 dark:bg-brand-50/10"
                        : "border-border bg-surface hover:border-border-strong")
                    }
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <Nav
            onBack={() => persist({ step: state.step - 1 })}
            onNext={next}
            nextLabel="Continue"
          />
        </Step>
      )}

      {state.step === 4 && (
        <Step
          title="Ready to roll"
          sub="Review and finish — you'll land on the Today dashboard."
        >
          <div className="rounded-md border border-border bg-surface p-4 text-sm">
            <Row
              label="Brokerage"
              value={
                profiles.find((p) => p.id === state.brokerageProfileId)?.name ??
                "—"
              }
            />
            <Row label="Primary state" value={state.primaryState ?? "—"} />
            <Row
              label="Calendar share"
              value={
                state.calendarShareList.length > 0
                  ? state.calendarShareList.join(", ")
                  : "(none)"
              }
            />
            <Row
              label="Photos"
              value={state.listingPhotoProvider ?? "manual_upload"}
            />
            <Row
              label="Social posting"
              value={state.socialPoster ?? "clipboard"}
            />
          </div>
          <Nav
            onBack={() => persist({ step: state.step - 1 })}
            onNext={finish}
            nextLabel="Finish setup"
            done
          />
        </Step>
      )}
    </div>
  );
}

function Step({
  title,
  sub,
  children,
}: {
  title: string;
  sub: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="font-display text-xl font-bold">{title}</h2>
      <p className="mt-1 text-sm text-text-muted">{sub}</p>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function Nav({
  onBack,
  onNext,
  nextLabel,
  done,
}: {
  onBack: (() => void) | null;
  onNext: (() => void) | null;
  nextLabel: string;
  done?: boolean;
}) {
  return (
    <div className="mt-8 flex items-center justify-between">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm hover:border-border-strong"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} /> Back
        </button>
      ) : (
        <span />
      )}
      <button
        type="button"
        onClick={onNext ?? undefined}
        disabled={!onNext}
        className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
      >
        {done ? <Check className="h-3.5 w-3.5" strokeWidth={2} /> : null}
        {nextLabel}
        {!done ? <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} /> : null}
      </button>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-sm">
      <span className="text-text-muted">{label}</span>
      <span className="font-medium text-text">{value}</span>
    </div>
  );
}

function CalendarShareInput({
  value,
  onChange,
}: {
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const [pending, setPending] = useState("");
  function add() {
    const v = pending.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return;
    if (value.includes(v)) {
      setPending("");
      return;
    }
    onChange([...value, v]);
    setPending("");
  }
  function remove(e: string) {
    onChange(value.filter((x) => x !== e));
  }
  return (
    <div>
      <div className="space-y-1.5">
        {value.length === 0 && (
          <div className="rounded border border-dashed border-border bg-surface-2/40 px-3 py-2 text-xs text-text-muted">
            No emails added — milestone calendar events will only invite the
            transaction's owner.
          </div>
        )}
        {value.map((e) => (
          <div
            key={e}
            className="flex items-center justify-between rounded border border-border bg-surface-2 px-3 py-1.5 text-sm"
          >
            <span className="font-mono text-xs">{e}</span>
            <button
              type="button"
              onClick={() => remove(e)}
              className="rounded p-1 text-text-subtle hover:bg-surface hover:text-danger"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <input
          type="email"
          value={pending}
          onChange={(e) => setPending(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="coordinator@example.com"
          className="flex-1 rounded border border-border bg-surface-2 px-2.5 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
        />
        <button
          type="button"
          onClick={add}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-3 py-1.5 text-sm hover:border-brand-500"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2} /> Add
        </button>
      </div>
    </div>
  );
}
