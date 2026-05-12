/**
 * /data-deletion — public data-deletion instructions page. Required
 * by Meta's app-review checklist (and a generally good user-rights
 * practice). Linked from /privacy and from the Meta app dashboard.
 *
 * Public route — added to PUBLIC_PREFIXES in middleware.ts.
 *
 * Meta accepts either an instructions URL (this page) OR a programmatic
 * callback endpoint. The instructions-URL route is simpler and is what
 * most small apps use; if we ever need the callback, we'll add
 * /api/data-deletion as a POST handler.
 */

export const metadata = {
  title: "Data Deletion · REOS",
  description: "How to request deletion of your REOS account and data.",
};

export default function DataDeletionPage() {
  return (
    <div className="mx-auto max-w-2xl py-6">
      <h1 className="font-display text-h1 font-semibold">Data Deletion</h1>
      <p className="mt-1 text-sm text-text-muted">
        How to ask us to delete your REOS account and the data we hold for
        you.
      </p>

      <div className="mt-6 space-y-5 text-sm leading-relaxed text-text">
        <section>
          <h2 className="font-display text-base font-semibold">
            From inside the app
          </h2>
          <p className="mt-2">
            Open <span className="font-medium">Settings → Account → Delete account</span>{" "}
            (rolling out — if you don&rsquo;t see it yet, use the email path
            below). We delete your data within 30 days. Connected-account
            tokens (Google, Meta, LinkedIn) are revoked immediately.
          </p>
        </section>

        <section>
          <h2 className="font-display text-base font-semibold">By email</h2>
          <p className="mt-2">
            Email{" "}
            <a
              className="text-brand-700 underline"
              href="mailto:jp@titanreteam.com?subject=REOS%20data%20deletion%20request"
            >
              jp@titanreteam.com
            </a>{" "}
            from the address on your REOS account, with subject{" "}
            <code className="rounded bg-surface-2 px-1.5 py-0.5 text-xs">
              REOS data deletion request
            </code>
            . We&rsquo;ll reply within 3 business days to confirm we
            received it and complete the deletion within 30 days.
          </p>
        </section>

        <section>
          <h2 className="font-display text-base font-semibold">
            What gets deleted
          </h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Your account record (name, email, profile settings)</li>
            <li>All transactions, contacts, documents, and notes you uploaded</li>
            <li>
              Connected-account tokens (Google, Meta, LinkedIn) — we revoke
              them with the upstream provider where the API supports it
            </li>
            <li>AI-generated summaries and drafts tied to your account</li>
            <li>Audit-log entries that contain your personal data</li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-base font-semibold">
            What we&rsquo;re legally required to retain
          </h2>
          <p className="mt-2">
            If you used a paid subscription, we&rsquo;re required by U.S. tax
            and accounting law to keep certain financial records for up to 7
            years (invoices, payment events, refund history). These records
            do not include the contents of your transactions, documents, or
            messages — only billing data.
          </p>
        </section>

        <section>
          <h2 className="font-display text-base font-semibold">
            Revoking a connected account without deleting your REOS account
          </h2>
          <p className="mt-2">
            If you only want to disconnect a Google / Meta / LinkedIn account
            but keep your REOS account active, go to{" "}
            <span className="font-medium">
              Settings → Integrations → Disconnect
            </span>
            . That revokes the OAuth token on your side AND with the upstream
            provider.
          </p>
        </section>

        <p className="text-xs text-text-muted">
          See also our{" "}
          <a className="text-brand-700 underline" href="/privacy">
            Privacy Policy
          </a>
          .
        </p>
      </div>
    </div>
  );
}
