/**
 * /voice — voice-note intake page.
 *
 * Press-to-record flow: agent dictates the deal facts ("Got a
 * contract on 509 Bent Avenue, sale price 450k, closing June 15,
 * buyers John and Paula Hamilton at jp@example.com"), REOS
 * transcribes via Whisper, extracts via GPT, and creates a draft
 * transaction. Redirects to the new deal on success.
 */

import { VoiceIntakeRecorder } from "./VoiceIntakeRecorder";

export const dynamic = "force-dynamic";

export default function VoiceIntakePage() {
  return (
    <main className="mx-auto max-w-2xl">
      <h1 className="font-display text-h1 font-semibold">Voice intake</h1>
      <p className="mt-1 text-sm text-text-muted">
        Dictate the deal — REOS scaffolds the transaction. Try saying:
        <br />
        <em>
          &ldquo;Got a contract on 509 Bent Avenue in Cheyenne, sale price 450k,
          closing June 15. Buyers are John and Paula Hamilton, primary email
          jp@example.com. Lender is Freedom Mortgage.&rdquo;
        </em>
      </p>
      <div className="mt-6">
        <VoiceIntakeRecorder />
      </div>
    </main>
  );
}
