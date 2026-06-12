/**
 * RezenPushService — match REOS documents to Rezen checklist items
 * by name, so "Send to Rezen" can drop each file in the right slot.
 *
 * REOS's RezenCompliancePrep slot labels were authored to mirror
 * Rezen's checklist 1:1, so a normalized-name match between our
 * slot label and the live Rezen ItemResponse.name is reliable.
 * We also fall back to matching on the document's assignedRezenSlot
 * key when a human pinned it.
 *
 * Pure functions — the route does the I/O.
 */

import type { RealChecklistItem } from "@/services/integrations/RealApiService";

export interface ReosDocForPush {
  id: string;
  fileName: string;
  /** Rezen filename REOS would use (from the prep report). */
  rezenFilename: string | null;
  /** The slot label this doc fills (Rezen checklist item name). */
  slotLabel: string;
  /** Slot key — used as a secondary match signal. */
  slotKey: string;
  /** signature scan status — gate unsigned docs out of the push. */
  signatureStatus: string | null;
}

export interface PushMatch {
  doc: ReosDocForPush;
  item: RealChecklistItem | null;
  reason: "matched" | "no_rezen_item" | "unsigned_blocked";
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ") // drop parentheticals
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b(the|a|an|of|and|for|to)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(s: string): Set<string> {
  return new Set(norm(s).split(" ").filter((t) => t.length >= 3));
}

/** Jaccard overlap of significant tokens. */
function similarity(a: string, b: string): number {
  const ta = tokenSet(a);
  const tb = tokenSet(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

/**
 * Match each doc to the best Rezen checklist item.
 *
 * @param requireSigned when true, docs that scanned "unsigned" are
 *        blocked from the push (partial / no_signature_blocks / null
 *        pass — the user gates on those manually).
 */
export function matchDocsToItems(
  docs: ReosDocForPush[],
  items: RealChecklistItem[],
  requireSigned: boolean,
): PushMatch[] {
  const used = new Set<string>(); // one doc per item per push
  return docs.map((doc) => {
    if (requireSigned && doc.signatureStatus === "unsigned") {
      return { doc, item: null, reason: "unsigned_blocked" as const };
    }
    let best: RealChecklistItem | null = null;
    let bestScore = 0;
    for (const item of items) {
      if (used.has(item.id)) continue;
      const score = similarity(doc.slotLabel, item.name);
      if (score > bestScore) {
        bestScore = score;
        best = item;
      }
    }
    // Require a meaningful overlap so we don't drop a doc in a random
    // slot. 0.34 ≈ at least a third of significant tokens shared.
    if (best && bestScore >= 0.34) {
      used.add(best.id);
      return { doc, item: best, reason: "matched" as const };
    }
    return { doc, item: null, reason: "no_rezen_item" as const };
  });
}
