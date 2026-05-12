/**
 * /privacy — public privacy policy. Required URL for Meta + LinkedIn
 * OAuth app reviews; also linked from the marketing homepage and from
 * the Login dialog footer.
 *
 * Public route — added to PUBLIC_PREFIXES in middleware.ts so it
 * renders without a session. The actual content lives in
 * PrivacyBody.tsx so the page shell stays light.
 */

import { PrivacyBody } from "./PrivacyBody";

export const metadata = {
  title: "Privacy Policy · REOS",
  description:
    "How Real Estate OS (REOS) collects, uses, and protects your data.",
};

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-2xl py-6">
      <h1 className="font-display text-h1 font-semibold">Privacy Policy</h1>
      <p className="mt-1 text-sm text-text-muted">
        How REOS handles your data. Plain English.
      </p>
      <div className="mt-6">
        <PrivacyBody />
      </div>
    </div>
  );
}
