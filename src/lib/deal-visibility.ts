/**
 * Per-deal visibility (deal privacy).
 *
 * A transaction with `restrictedToAssignee = true` is visible ONLY to:
 *   - its assigned user (assignedUserId), and
 *   - account owners / admins (the privileged roles).
 * Every other team member (coordinator/tc/assistant/agent) cannot see,
 * open, search, or roll it up. Non-restricted deals stay account-wide
 * visible, exactly as before.
 *
 * This module is the SINGLE source of truth. Discovery/view surfaces
 * AND the work to enforce it into Prisma queries both go through here so
 * a restricted deal can't leak via one forgotten path.
 *
 * NOTE: system automations (MorningTick, PostClose, etc.) run as the
 * platform, not as a user — they intentionally see all deals so they can
 * notify the assignee. They do NOT use these helpers.
 */

const PRIVILEGED_ROLES = new Set(["owner", "admin"]);

export interface VisibilityActor {
  userId: string;
  role: string;
}

/** Owners/admins see every deal regardless of the restriction flag. */
export function canSeeAllDeals(role: string | null | undefined): boolean {
  return PRIVILEGED_ROLES.has((role ?? "").toLowerCase());
}

/** Only owners/admins may toggle a deal's restriction (it's an access
 *  decision, not routine editing). */
export function canToggleRestriction(role: string | null | undefined): boolean {
  return canSeeAllDeals(role);
}

/**
 * Prisma `where` fragment to AND into any transaction list/count query.
 * Owners/admins → no extra filter. Everyone else → only non-restricted
 * deals plus restricted deals they're assigned to.
 */
export function dealVisibilityWhere(
  actor: VisibilityActor,
): Record<string, unknown> {
  if (canSeeAllDeals(actor.role)) return {};
  return {
    OR: [{ restrictedToAssignee: false }, { assignedUserId: actor.userId }],
  };
}

/** Detail-page / by-id guard: can this actor view this specific deal? */
export function isDealVisible(
  actor: VisibilityActor,
  deal: { restrictedToAssignee: boolean; assignedUserId: string | null },
): boolean {
  if (!deal.restrictedToAssignee) return true;
  if (canSeeAllDeals(actor.role)) return true;
  return deal.assignedUserId === actor.userId;
}
