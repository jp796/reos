"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/app/ToastProvider";

export function NewListingForm() {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    sellerName: "",
    sellerEmail: "",
    sellerPhone: "",
    propertyAddress: "",
    city: "",
    state: "WY",
    zip: "",
    listPrice: "",
    listDate: new Date().toISOString().slice(0, 10),
    listingExpirationDate: "",
  });

  function field<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch("/api/listings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...form,
          listPrice: form.listPrice ? parseFloat(form.listPrice) : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? res.statusText);
      toast.success("Listing created");
      router.push(`/transactions/${data.id}`);
    } catch (e) {
      toast.error("Create failed", e instanceof Error ? e.message : "unknown");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-5 rounded-lg border border-border bg-surface p-5"
    >
      <Section title="Seller">
        <Input
          label="Name"
          required
          value={form.sellerName}
          onChange={(v) => field("sellerName", v)}
          placeholder="John & Jane Smith"
          cols="sm:col-span-2"
        />
        <Input
          label="Email"
          value={form.sellerEmail}
          onChange={(v) => field("sellerEmail", v)}
          placeholder="seller@example.com"
        />
        <Input
          label="Phone"
          value={form.sellerPhone}
          onChange={(v) => field("sellerPhone", v)}
          placeholder="307-555-1234"
        />
      </Section>

      <Section title="Property">
        <Input
          label="Address"
          required
          value={form.propertyAddress}
          onChange={(v) => field("propertyAddress", v)}
          placeholder="509 Bent Avenue"
          cols="sm:col-span-2"
        />
        <Input
          label="City"
          value={form.city}
          onChange={(v) => field("city", v)}
          placeholder="Cheyenne"
        />
        <Input
          label="State"
          value={form.state}
          onChange={(v) => field("state", v.toUpperCase().slice(0, 2))}
          placeholder="WY"
        />
        <Input
          label="Zip"
          value={form.zip}
          onChange={(v) => field("zip", v)}
          placeholder="82001"
        />
      </Section>

      <Section title="Listing">
        <Input
          label="List price"
          value={form.listPrice}
          onChange={(v) => field("listPrice", v.replace(/[^0-9.]/g, ""))}
          placeholder="450000"
        />
        <Input
          label="List date"
          type="date"
          value={form.listDate}
          onChange={(v) => field("listDate", v)}
        />
        <Input
          label="Expiration"
          type="date"
          value={form.listingExpirationDate}
          onChange={(v) => field("listingExpirationDate", v)}
        />
      </Section>

      <div className="flex items-center justify-end">
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
        >
          {busy ? "Creating…" : "Create listing"}
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
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  cols?: string;
  type?: string;
}) {
  return (
    <label className={`block ${cols ?? ""}`}>
      <span className="text-xs font-medium text-text-muted">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className="mt-1 w-full rounded border border-border bg-surface-2 px-2.5 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
      />
    </label>
  );
}
