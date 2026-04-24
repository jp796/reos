/**
 * /intake — public lead-capture form. Jp shares this URL with
 * prospective buyers / sellers who've shown interest but aren't
 * under contract yet. Submissions land in /settings/intake for
 * review + promotion.
 *
 * Standalone chrome (handled via AppShell's public-routes branch).
 */

import { IntakeForm } from "./IntakeForm";

export const metadata = { title: "Work with us · Real Estate OS" };

export default function IntakePage() {
  return (
    <div className="mx-auto max-w-xl py-8">
      <h1 className="font-display text-2xl font-semibold tracking-tight">
        Let&rsquo;s talk about your next move
      </h1>
      <p className="mt-2 text-sm text-text-muted">
        A few quick details and we&rsquo;ll be in touch within a business day.
        Nothing you share here is final — this is just so we can prep for our
        first call.
      </p>
      <div className="mt-6">
        <IntakeForm />
      </div>
    </div>
  );
}
