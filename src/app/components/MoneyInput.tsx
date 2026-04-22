"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";

interface Props {
  /** Raw value as a string of numeric digits (+optional decimal). */
  value: string;
  /** Called with the sanitized numeric string (no $, no commas). */
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  inputClassName?: string;
  /** Decimal places to show when blurred (default 2) */
  decimals?: number;
}

/**
 * Money input that shows `$315,000.00` when blurred and raw digits
 * (with optional decimal) when focused for easy editing. Stores a
 * sanitized numeric string via onChange.
 */
export function MoneyInput({
  value,
  onChange,
  label,
  placeholder = "0.00",
  required,
  disabled,
  className,
  inputClassName,
  decimals = 2,
}: Props) {
  const [focused, setFocused] = useState(false);

  // What the user sees in the text box
  const display = focused
    ? value
    : value !== ""
      ? formatWithCommas(value, decimals)
      : "";

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    // Strip $, commas, spaces — keep digits and one decimal
    const raw = e.target.value
      .replace(/[$,\s]/g, "")
      .replace(/[^0-9.]/g, "")
      // Collapse multiple decimals to just the first one
      .replace(/(\..*?)\./g, "$1");
    onChange(raw);
  }

  function handleBlur() {
    setFocused(false);
    // Normalize trailing dot ("315." → "315")
    if (value.endsWith(".")) onChange(value.slice(0, -1));
  }

  return (
    <label className={cn("block", className)}>
      {label && <span className="reos-label">{label}</span>}
      <div className="relative mt-1">
        <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-sm text-text-muted">
          $
        </span>
        <input
          type="text"
          inputMode="decimal"
          value={display}
          onChange={handleChange}
          onFocus={() => setFocused(true)}
          onBlur={handleBlur}
          placeholder={placeholder}
          required={required}
          disabled={disabled}
          className={cn(
            "w-full rounded border border-border bg-surface-2 py-1.5 pl-6 pr-2 text-sm tabular-nums placeholder:text-text-subtle disabled:opacity-50",
            inputClassName,
          )}
        />
      </div>
    </label>
  );
}

function formatWithCommas(raw: string, decimals: number): string {
  if (!raw) return "";
  const n = parseFloat(raw);
  if (!Number.isFinite(n)) return raw;
  return n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}
