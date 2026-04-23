/**
 * /terms — full Terms-of-Use page. Accessible to anyone signed in
 * (so Vicki can re-read them after accepting). Not public — users
 * who aren't on the allow list have no reason to read these.
 */

import { TermsBody } from "./TermsBody";

export const metadata = { title: "Terms of Use · REOS" };

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-2xl py-6">
      <h1 className="font-display text-h1 font-semibold">Terms of Use</h1>
      <p className="mt-1 text-sm text-text-muted">
        The rules of the road for using this workspace.
      </p>
      <div className="mt-6">
        <TermsBody />
      </div>
    </div>
  );
}
