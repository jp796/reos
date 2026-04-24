"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/app/ToastProvider";
import type { BrokerSettings } from "@/services/core/CdaGeneratorService";

export function BrokerageForm({
  initial,
  fallbackBusinessName,
}: {
  initial: BrokerSettings;
  fallbackBusinessName: string;
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
          body: JSON.stringify(form),
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
