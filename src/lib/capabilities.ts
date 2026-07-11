/**
 * Capability registry (remediation Phase 7 / §13).
 *
 * ONE source of truth for how each integration + form type is actually
 * supported, so public marketing claims and in-app labels can't diverge
 * ("Rezen prep" messaging while an account is unconnected; social "posting"
 * that's really copy-to-clipboard; forms "Atlas-fill" on XFA docs that need
 * manual flattening).
 */

export type CapabilityState =
  | "operational" // connected + working end-to-end
  | "available" // can be connected, not yet
  | "assisted" // manual / copy-paste / human-in-the-loop
  | "beta"
  | "stub"; // planned, not functional

export interface Capability {
  key: string;
  label: string;
  state: CapabilityState;
  /** Honest one-line note shown next to the capability. */
  note: string;
}

export const CAPABILITY_LABEL: Record<CapabilityState, string> = {
  operational: "Connected",
  available: "Available to connect",
  assisted: "Assisted (manual step)",
  beta: "Beta",
  stub: "Planned",
};

/** Integrations — the truthful state, independent of marketing copy. */
export const INTEGRATIONS: readonly Capability[] = [
  { key: "gmail", label: "Gmail", state: "available", note: "OAuth connect; read + label + send" },
  { key: "gcal", label: "Google Calendar", state: "available", note: "OAuth connect; deadline sync" },
  { key: "gdrive", label: "Google Drive", state: "available", note: "OAuth connect; redundant doc backup" },
  { key: "rezen", label: "Rezen (Real)", state: "available", note: "Encrypted token; MFA accounts not yet supported" },
  { key: "telegram", label: "Telegram", state: "operational", note: "Contract upload + brief" },
  { key: "facebook", label: "Facebook", state: "assisted", note: "Copy-to-clipboard; native posting planned" },
  { key: "instagram", label: "Instagram", state: "assisted", note: "Copy-to-clipboard; native posting planned" },
  { key: "linkedin", label: "LinkedIn", state: "assisted", note: "Copy-to-clipboard" },
  { key: "buffer", label: "Buffer", state: "stub", note: "Planned" },
  { key: "mls", label: "MLS / RESO", state: "stub", note: "Planned" },
];

export function integrationByKey(key: string): Capability | undefined {
  return INTEGRATIONS.find((c) => c.key === key);
}

// ── Forms compatibility (§13) ──────────────────────────────────────────

export type FormCompat =
  | "fillable_pdf" // AcroForm — Atlas can fill
  | "flat_pdf" // flat — overlay supported
  | "xfa" // Adobe XFA — needs flatten/convert, NOT Atlas-fillable as-is
  | "unsupported";

export interface FormClassification {
  compat: FormCompat;
  atlasFillable: boolean;
  workflow: string;
}

/**
 * Classify an uploaded form so we never present an XFA doc as ready for
 * Atlas filling. Producer/heuristic-based; the exact XFA detection happens
 * at ingest (pdf metadata), this maps a detected kind → the honest workflow.
 */
export function classifyForm(kind: FormCompat): FormClassification {
  switch (kind) {
    case "fillable_pdf":
      return { compat: kind, atlasFillable: true, workflow: "Atlas fills the fields directly." };
    case "flat_pdf":
      return { compat: kind, atlasFillable: true, workflow: "Atlas overlays your data on the flat page." };
    case "xfa":
      return {
        compat: kind,
        atlasFillable: false,
        workflow: "Adobe XFA form — flatten/print-to-PDF first, then re-upload for overlay.",
      };
    default:
      return { compat: "unsupported", atlasFillable: false, workflow: "Unsupported or corrupt — replace the file." };
  }
}

/** True for form kinds REOS should NOT advertise as Atlas-fillable. */
export function requiresConversion(kind: FormCompat): boolean {
  return kind === "xfa" || kind === "unsupported";
}
