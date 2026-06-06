/**
 * Cross-app banner shown to every signed-in user whose account is
 * scheduled for deletion. Stays visible from the moment they click
 * Delete Account until either the grace window expires or they
 * restore. Links to /settings/account where Restore lives.
 *
 * Pure server component — receives the scheduledAt ISO from
 * layout.tsx and renders the countdown. Owner can act from
 * /settings/account.
 */

import Link from "next/link";

const GRACE_DAYS = 30;

export function PendingDeletionBanner({
  scheduledAt,
}: {
  scheduledAt: string;
}) {
  const scheduled = new Date(scheduledAt);
  const purgeAt = new Date(scheduled.getTime() + GRACE_DAYS * 24 * 60 * 60 * 1000);
  const daysLeft = Math.max(
    0,
    Math.ceil((purgeAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000)),
  );

  return (
    <div className="border-b border-amber-400/40 bg-amber-50/80 px-4 py-2 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-200">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
        <p>
          This workspace is scheduled for deletion on{" "}
          <span className="font-semibold">
            {purgeAt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
          </span>{" "}
          ({daysLeft} day{daysLeft === 1 ? "" : "s"} left).
        </p>
        <Link
          href="/settings/account"
          className="shrink-0 rounded-md bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700"
        >
          Restore
        </Link>
      </div>
    </div>
  );
}
