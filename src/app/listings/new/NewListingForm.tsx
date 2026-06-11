"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { useToast } from "@/app/ToastProvider";
import { DropZone } from "@/app/components/DropZone";

type ListingExtraction = Record<
  string,
  { value: string | number | null; confidence: number; snippet: string | null }
> & { _path?: string; notes?: string | null };

export function NewListingForm() {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [extraction, setExtraction] = useState<ListingExtraction | null>(null);
  // After a failed submit we mark each missing required field so it
  // renders with a red border + helper text. Clears whenever the user
  // edits the field. Solves the "Create button does nothing" trap
  // where HTML5 form validation was scrolling silently to a field
  // off-screen above the button.
  const [missing, setMissing] = useState<Set<string>>(new Set());
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
    if (missing.has(k as string)) {
      // Clear the red highlight once the user fills it in.
      setMissing((cur) => {
        const next = new Set(cur);
        next.delete(k as string);
        return next;
      });
    }
  }

  /** Drop a listing-agreement PDF → AI fills the form. */
  async function uploadAgreement(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/listings/extract", {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "extract failed");
      const ex: ListingExtraction = data.extraction ?? {};
      setExtraction(ex);

      const get = (k: string) => {
        const v = ex[k]?.value;
        return v == null ? "" : String(v);
      };
      const isoDate = (k: string) => {
        const v = ex[k]?.value;
        if (!v) return "";
        const d = new Date(String(v));
        return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
      };

      // Populate every field that came back; keep existing values
      // when the AI didn't find anything (so the user's typed input
      // doesn't get clobbered).
      const filled = [
        get("sellerName"),
        get("sellerEmail"),
        get("sellerPhone"),
        get("propertyAddress"),
        get("city"),
        get("state"),
        get("zip"),
        get("listPrice"),
        isoDate("listDate"),
        isoDate("listingExpirationDate"),
      ].filter(Boolean).length;

      setForm((f) => ({
        ...f,
        sellerName: get("sellerName") || f.sellerName,
        sellerEmail: get("sellerEmail") || f.sellerEmail,
        sellerPhone: get("sellerPhone") || f.sellerPhone,
        propertyAddress: get("propertyAddress") || f.propertyAddress,
        city: get("city") || f.city,
        state: get("state") || f.state,
        zip: get("zip") || f.zip,
        listPrice: get("listPrice") || f.listPrice,
        listDate: isoDate("listDate") || f.listDate,
        listingExpirationDate:
          isoDate("listingExpirationDate") || f.listingExpirationDate,
      }));

      // Tell the truth about what happened. The old code always said
      // "Form filled" even when the extraction came back all-null,
      // which left users staring at an empty form under a success
      // toast.
      if (filled === 0) {
        toast.error(
          "Couldn't read any fields",
          "The PDF parsed but no usable values came back. If it's a scan or photo, try a clearer copy — or fill the form manually.",
        );
      } else {
        toast.success(
          "Listing read",
          `${filled} field${filled === 1 ? "" : "s"} filled — review the dotted fields and create.`,
        );
      }
    } catch (e) {
      toast.error(
        "Couldn't read agreement",
        e instanceof Error ? e.message : "unknown",
      );
    } finally {
      setUploading(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();

    // Explicit validation with a toast naming what's missing — the
    // browser-default `required` path scrolls to the offending field
    // silently and can leave the user staring at a "dead" Create
    // button if the field is above the fold.
    const missingFields: string[] = [];
    if (!form.sellerName.trim()) missingFields.push("sellerName");
    if (!form.propertyAddress.trim()) missingFields.push("propertyAddress");
    if (missingFields.length > 0) {
      setMissing(new Set(missingFields));
      const friendly = missingFields
        .map((k) => (k === "sellerName" ? "Seller name" : "Property address"))
        .join(" and ");
      toast.error(
        "Can't create yet",
        `${friendly} ${missingFields.length === 1 ? "is" : "are"} required. ${
          extraction
            ? "AI didn't find them in the document — type them in."
            : "Drop a listing agreement above, or type them in."
        }`,
      );
      // Scroll the first missing field into view.
      const firstId = missingFields[0];
      const el = document.querySelector(`[data-field="${firstId}"]`);
      if (el && el instanceof HTMLElement) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.querySelector("input")?.focus();
      }
      return;
    }

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
    <div className="space-y-5">
      {/* AI drop zone — sits ABOVE the manual form */}
      <section className="rounded-lg border border-border bg-surface p-5">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-brand-600" strokeWidth={2} />
            <h2 className="text-sm font-semibold">Drop the listing agreement</h2>
          </div>
          <span className="text-xs text-text-muted">
            Optional · ~10s · ~$0.01 of OpenAI
          </span>
        </div>
        <DropZone
          onFile={uploadAgreement}
          disabled={uploading}
          kind="listing agreement PDF"
          maxMb={20}
          explainer="REOS reads the listing agreement with AI and pre-fills seller, address, list price, list date, and expiration. You confirm the values, then create. Same fields carry through automatically when the listing turns into an active transaction."
        />
        {uploading && (
          <div className="mt-2 flex items-center gap-2 text-xs text-text-muted">
            <Loader2 className="h-3 w-3 animate-spin" />
            Extracting fields with AI…
          </div>
        )}
        {extraction?._path && (
          <div className="mt-2 text-xs text-text-muted">
            Extracted via <b>{extraction._path}</b>
            {extraction.notes && (
              <>
                {" · "}
                <span className="italic">AI note: {extraction.notes}</span>
              </>
            )}
          </div>
        )}
      </section>

      {/* Manual / confirm form */}
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
            confidence={extraction?.sellerName?.confidence}
            fieldKey="sellerName"
            missing={missing.has("sellerName")}
          />
          <Input
            label="Email"
            value={form.sellerEmail}
            onChange={(v) => field("sellerEmail", v)}
            placeholder="seller@example.com"
            confidence={extraction?.sellerEmail?.confidence}
            fieldKey="sellerEmail"
          />
          <Input
            label="Phone"
            value={form.sellerPhone}
            onChange={(v) => field("sellerPhone", v)}
            placeholder="307-555-1234"
            confidence={extraction?.sellerPhone?.confidence}
            fieldKey="sellerPhone"
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
            confidence={extraction?.propertyAddress?.confidence}
            fieldKey="propertyAddress"
            missing={missing.has("propertyAddress")}
          />
          <Input
            label="City"
            value={form.city}
            onChange={(v) => field("city", v)}
            placeholder="Cheyenne"
            confidence={extraction?.city?.confidence}
          />
          <Input
            label="State"
            value={form.state}
            onChange={(v) => field("state", v.toUpperCase().slice(0, 2))}
            placeholder="WY"
            confidence={extraction?.state?.confidence}
          />
          <Input
            label="Zip"
            value={form.zip}
            onChange={(v) => field("zip", v)}
            placeholder="82001"
            confidence={extraction?.zip?.confidence}
          />
        </Section>

        <Section title="Listing">
          <Input
            label="List price"
            value={form.listPrice}
            onChange={(v) => field("listPrice", v.replace(/[^0-9.]/g, ""))}
            placeholder="450000"
            confidence={extraction?.listPrice?.confidence}
          />
          <Input
            label="List date"
            type="date"
            value={form.listDate}
            onChange={(v) => field("listDate", v)}
            confidence={extraction?.listDate?.confidence}
          />
          <Input
            label="Expiration"
            type="date"
            value={form.listingExpirationDate}
            onChange={(v) => field("listingExpirationDate", v)}
            confidence={extraction?.listingExpirationDate?.confidence}
          />
        </Section>

        <div className="flex items-center justify-between">
          <p className="text-xs text-text-muted">
            All listing data ports over automatically when this listing
            converts to a transaction.
          </p>
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create listing"}
          </button>
        </div>
      </form>
    </div>
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
  confidence,
  fieldKey,
  missing,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  cols?: string;
  type?: string;
  confidence?: number | null;
  fieldKey?: string;
  missing?: boolean;
}) {
  // Light visual hint when the AI filled this field — green dot for
  // high confidence, amber for low. Helps the user spot what to verify.
  const dot =
    confidence == null || confidence === 0
      ? null
      : confidence >= 0.8
        ? "bg-emerald-500"
        : confidence >= 0.5
          ? "bg-amber-400"
          : "bg-red-400";
  return (
    <label className={`block ${cols ?? ""}`} data-field={fieldKey}>
      <span className="flex items-center gap-1.5 text-xs font-medium text-text-muted">
        {label}
        {required && <span className="text-red-500">*</span>}
        {dot && <span className={`inline-block h-1.5 w-1.5 rounded-full ${dot}`} />}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-invalid={missing ? true : undefined}
        className={`mt-1 w-full rounded border px-2.5 py-1.5 text-sm text-text placeholder:text-text-subtle focus:outline-none ${
          missing
            ? "border-red-400 bg-red-50 focus:border-red-500"
            : "border-border bg-surface-2 focus:border-brand-500"
        }`}
      />
      {missing && (
        <span className="mt-1 block text-[11px] text-red-700">
          Required — please fill before creating.
        </span>
      )}
    </label>
  );
}
