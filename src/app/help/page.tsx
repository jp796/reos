/**
 * /help — AI-powered Help. Ask a question, the assistant answers
 * from the bundled knowledge base.
 */

import { HelpChat } from "./HelpChat";

export const dynamic = "force-dynamic";

const SUGGESTED = [
  "How do I convert a listing to a transaction?",
  "Why isn't earnest money auto-completing on my deal?",
  "How does the Rezen package download work?",
  "Where do I add a buyer's agent?",
  "How do I generate sample deals for testing?",
  "What's the difference between Today and Digest?",
];

export default function HelpPage() {
  return (
    <main className="mx-auto max-w-2xl">
      <h1 className="font-display text-h1 font-semibold">Help</h1>
      <p className="mt-1 text-sm text-text-muted">
        Ask anything about how REOS works. The assistant draws from the
        bundled feature reference — answers in seconds, no support
        ticket needed.
      </p>
      <div className="mt-6">
        <HelpChat suggested={SUGGESTED} />
      </div>
    </main>
  );
}
