/**
 * UserComplianceTemplates — normalize user/AI compliance template items
 * into ComplianceRequirement[] (the shape the audit consumes). Applying
 * a template stores these on Transaction.complianceTemplateJson; the
 * audit prefers them over the brokerage default for that deal.
 */

import type { ComplianceRequirement } from "./ComplianceChecklist";

export function normalizeComplianceItems(raw: unknown): ComplianceRequirement[] {
  if (!Array.isArray(raw)) return [];
  const out: ComplianceRequirement[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const label = typeof o.label === "string" ? o.label.trim().slice(0, 120) : "";
    if (!label) continue;
    const key =
      (typeof o.key === "string" && o.key.trim()) ||
      label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 60);
    if (seen.has(key)) continue;
    seen.add(key);
    const keywords = Array.isArray(o.keywords)
      ? (o.keywords as unknown[])
          .filter((k): k is string => typeof k === "string" && k.trim().length > 0)
          .map((k) => k.trim().slice(0, 60))
          .slice(0, 12)
      : [];
    const sidesRaw = Array.isArray(o.sides) ? (o.sides as unknown[]) : [];
    const sides = sidesRaw.filter(
      (s): s is "buy" | "sell" | "both" => s === "buy" || s === "sell" || s === "both",
    );
    out.push({
      key,
      label,
      keywords: keywords.length > 0 ? keywords : [label],
      sides: sides.length > 0 ? sides : undefined,
      detail: typeof o.detail === "string" ? o.detail.slice(0, 160) : undefined,
    });
  }
  return out.slice(0, 60);
}
