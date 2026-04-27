"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/app/ToastProvider";
import type { BrokerSettings } from "@/services/core/CdaGeneratorService";

export function BrokerageForm({
  initial,
  fallbackBusinessName,
  complianceAuditEnabled: initialComplianceAuditEnabled,
  trustedTcSenders: initialTrustedTcSenders,
}: {
  initial: BrokerSettings;
  fallbackBusinessName: string;
  complianceAuditEnabled: boolean;
  trustedTcSenders: string[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  const [form, setForm] = useState<BrokerSettings>({
    brokerageName: initial.brokerageName ?? fallbackBusinessName ?? "",
    brokerageAddress: initial.brokerageAddress ?? "",
    brokerageLicense: initial.brokerageLicense ?? "",
    brokeragePhone: initial.brokeragePhone ?? "",
    brokerageEmail: initial.brokerageEmail ?? "",
    brokerageEin: initial.brokerageEin ?? "",
    designatedBrokerName: initial.designatedBrokerName ?? "",
    designatedBrokerLicense: initial.designatedBrokerLicense ?? "",
    agentName: initial.agentName ?? "",
    agentLicense: initial.agentLicense ?? "",
  });
  const [complianceAuditEnabled, setComplianceAuditEnabled] = useState(
    initialComplianceAuditEnabled,
  );
  const [trustedTcSenders, setTrustedTcSenders] = useState<string[]>(
    initialTrustedTcSenders,
  );
  const [newSender, setNewSender] = useState("");
  function addSender() {
    const v = newSender.trim().toLowerCase();
    if (!v) return;
    if (trustedTcSenders.includes(v)) {
      setNewSender("");
      return;
    }
    setTrustedTcSenders((cur) => [...cur, v]);
    setNewSender("");
  }
  function removeSender(s: string) {
    setTrustedTcSenders((cur) => cur.filter((x) => x !== s));
  }

  function field<K extends keyof BrokerSettings>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        const res = await fetch("/api/settings/brokerage", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...form,
            complianceAuditEnabled,
            trustedTcSenders,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? res.statusText);
        toast.success("Brokerage saved");
        router.refresh();
      } catch (e) {
        toast.error(
          "Save failed",
          e instanceof Error ? e.message : "unknown",
        );
      }
    });
  }

  return (
    <form
      onSubmit={save}
      className="space-y-5 rounded-lg border border-border bg-surface p-5"
    >
      <Section title="Brokerage">
        <Input
          label="Brokerage name"
          value={form.brokerageName ?? ""}
          onChange={(v) => field("brokerageName", v)}
          placeholder="Real Broker LLC"
          required
          cols="sm:col-span-2"
        />
        <Input
          label="Address"
          value={form.brokerageAddress ?? ""}
          onChange={(v) => field("brokerageAddress", v)}
          placeholder="100 Example St, Cheyenne, WY 82001"
          cols="sm:col-span-2"
        />
        <Input
          label="Phone"
          value={form.brokeragePhone ?? ""}
          onChange={(v) => field("brokeragePhone", v)}
          placeholder="(307) 555-5555"
        />
        <Input
          label="Email"
          value={form.brokerageEmail ?? ""}
          onChange={(v) => field("brokerageEmail", v)}
          placeholder="billing@brokerage.com"
        />
        <Input
          label="Brokerage license #"
          value={form.brokerageLicense ?? ""}
          onChange={(v) => field("brokerageLicense", v)}
          placeholder="WY-12345"
        />
        <Input
          label="EIN"
          value={form.brokerageEin ?? ""}
          onChange={(v) => field("brokerageEin", v)}
          placeholder="XX-XXXXXXX"
        />
      </Section>

      <Section title="Designated broker (signs CDA)">
        <Input
          label="Name"
          value={form.designatedBrokerName ?? ""}
          onChange={(v) => field("designatedBrokerName", v)}
          placeholder="John Doe"
        />
        <Input
          label="License #"
          value={form.designatedBrokerLicense ?? ""}
          onChange={(v) => field("designatedBrokerLicense", v)}
          placeholder="WY-67890"
        />
      </Section>

      <Section title="Default agent (you)">
        <Input
          label="Name"
          value={form.agentName ?? ""}
          onChange={(v) => field("agentName", v)}
          placeholder="JP Fluellen"
        />
        <Input
          label="License #"
          value={form.agentLicense ?? ""}
          onChange={(v) => field("agentLicense", v)}
          placeholder="WY-11223"
        />
      </Section>

      <div>
        <div className="reos-label mb-2">Trusted transaction-coordinator senders</div>
        <p className="mb-2 text-xs text-text-muted">
          Email addresses or domains for outside TCs you work with often
          (e.g. <code>coordinator@417realestate.com</code> or{" "}
          <code>@417realestate.com</code>). The contract scanner widens its
          Gmail query to include any thread from these senders so deals they
          send you get auto-flagged for import.
        </p>
        <div className="space-y-1.5">
          {trustedTcSenders.length === 0 && (
            <div className="rounded border border-dashed border-border bg-surface-2/40 px-3 py-2 text-xs text-text-muted">
              No trusted TC senders yet.
            </div>
          )}
          {trustedTcSenders.map((s) => (
            <div
              key={s}
              className="flex items-center justify-between rounded border border-border bg-surface-2 px-3 py-1.5 text-sm"
            >
              <span className="font-mono text-xs">{s}</span>
              <button
                type="button"
                onClick={() => removeSender(s)}
                className="rounded p-1 text-text-subtle hover:bg-surface hover:text-danger"
                title="Remove"
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <input
            type="text"
            value={newSender}
            onChange={(e) => setNewSender(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addSender();
              }
            }}
            placeholder="coordinator@example.com or @example.com"
            className="flex-1 rounded border border-border bg-surface-2 px-2.5 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={addSender}
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm hover:border-brand-500"
          >
            Add
          </button>
        </div>
      </div>

      <div>
        <div className="reos-label mb-2">Compliance audit</div>
        <label className="flex items-start gap-3 rounded-md border border-border bg-surface-2 px-3 py-2.5">
          <input
            type="checkbox"
            checked={complianceAuditEnabled}
            onChange={(e) => setComplianceAuditEnabled(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-brand-600"
          />
          <span className="text-sm">
            <span className="font-medium">
              Show REOS&rsquo;s per-state document checklist on each transaction
            </span>
            <span className="mt-0.5 block text-xs text-text-muted">
              Turn this OFF if your brokerage already runs its own audit
              (e.g. Rezen, Lone Wolf, Skyslope). When off, the Compliance
              panel and the post-close &ldquo;Submit compliance file&rdquo;
              auto-task are hidden.
            </span>
          </span>
        </label>
      </div>

      <div className="flex items-center justify-end">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="reos-label mb-2">{title}</div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{children}</div>
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
  placeholder,
  required,
  cols,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  cols?: string;
}) {
  return (
    <label className={`block ${cols ?? ""}`}>
      <span className="text-xs font-medium text-text-muted">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className="mt-1 w-full rounded border border-border bg-surface-2 px-2.5 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
      />
    </label>
  );
}
