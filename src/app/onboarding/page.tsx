/**
 * /onboarding — guided setup after first sign-in.
 *
 * Five steps:
 *   1. Brokerage profile
 *   2. Primary state
 *   3. Calendar share-list
 *   4. Integration picks (photo source + social poster)
 *   5. Review + finish → /today
 *
 * Client-rendered for the multi-step flow; server-rendered shell
 * just provides initial bootstrap data.
 */

import { OnboardingWizard } from "./OnboardingWizard";
import { Logo } from "@/app/components/Logo";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  return (
    <div className="min-h-screen bg-bg text-text">
      <header className="border-b border-border bg-surface px-4 py-3">
        <div className="mx-auto flex max-w-3xl items-center gap-2">
          <Logo size={28} />
          <span className="font-display text-lg font-bold">
            RE<span className="text-gradient-brand">OS</span>
          </span>
          <span className="ml-2 text-sm text-text-muted">setup</span>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8">
        <OnboardingWizard />
      </main>
    </div>
  );
}
