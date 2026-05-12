/**
 * PrivacyBody — the actual policy content. Drafted to satisfy both
 * Meta + LinkedIn OAuth-app-review requirements (covers what we
 * collect, how it's used, who sees it, deletion process, contact).
 * Plain English, not legalese.
 *
 * Update the LAST_UPDATED constant when material content changes.
 */

const LAST_UPDATED = "May 12, 2026";

export function PrivacyBody() {
  return (
    <div className="space-y-5 text-sm leading-relaxed text-text">
      <p className="text-xs text-text-muted">
        Last updated: <span className="font-medium">{LAST_UPDATED}</span>
      </p>

      <Section title="Who we are">
        Real Estate OS (&ldquo;REOS&rdquo;) is a transaction-coordination tool
        for real-estate agents and brokerages, operated by{" "}
        <span className="font-medium">JP Fluellen</span>. Contact us at{" "}
        <a className="text-brand-700 underline" href="mailto:jp@titanreteam.com">
          jp@titanreteam.com
        </a>
        .
      </Section>

      <Section title="What we collect">
        We only collect what we need to run the product:
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            <span className="font-medium">Account info</span> — your name, email,
            and the brokerage profile you sign up under.
          </li>
          <li>
            <span className="font-medium">Transaction data</span> — addresses,
            parties, dates, documents, and notes you enter or upload.
          </li>
          <li>
            <span className="font-medium">Connected-account data</span> — when you
            connect Google, Meta (Facebook / Instagram), or LinkedIn, we receive
            the access tokens those services issue so we can read your inbox,
            send drafts, post on your behalf, or sync calendar events. We never
            see your password for any of those services.
          </li>
          <li>
            <span className="font-medium">Usage data</span> — basic logs of which
            pages you visit and which actions you take, used for debugging and
            improving the product.
          </li>
        </ul>
      </Section>

      <Section title="How we use it">
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>To run the features you ask for — compliance audits, AI drafts, calendar sync, social posts, file uploads.</li>
          <li>To send you notifications about your own transactions.</li>
          <li>To diagnose bugs and improve performance.</li>
          <li>
            <span className="font-medium">We do not sell your data. We do not
            use it to train external AI models. We do not share it with
            advertisers.</span>
          </li>
        </ul>
      </Section>

      <Section title="Who sees it">
        Your data is visible to you and any teammates inside your own brokerage
        account. The REOS operators may access it for support or to fix bugs you
        report. We use the following sub-processors to operate the service:
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Google Cloud (hosting, Gmail / Calendar APIs)</li>
          <li>Neon (Postgres database)</li>
          <li>OpenAI &amp; Anthropic (AI features — text only, never your full inbox)</li>
          <li>Meta / LinkedIn (only when you connect them, only for posts you trigger)</li>
          <li>Stripe (billing, if you&rsquo;re a paid customer)</li>
        </ul>
        Each of these handles your data under their own privacy terms, which
        you can read on their sites.
      </Section>

      <Section title="How long we keep it">
        We keep your data while your account is active. If you delete your
        account or request deletion, we remove your personal data within
        30 days, except where we&rsquo;re legally required to retain a record
        (e.g. financial transactions for tax purposes — kept for 7 years per
        IRS guidance).
      </Section>

      <Section title="How to delete your data">
        Two ways:
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            Inside the app: <span className="font-medium">Settings → Account → Delete account</span> (coming soon).
          </li>
          <li>
            By email: send a request to{" "}
            <a className="text-brand-700 underline" href="mailto:jp@titanreteam.com">
              jp@titanreteam.com
            </a>{" "}
            from the email address on your account. We&rsquo;ll confirm and
            complete the deletion within 30 days.
          </li>
        </ul>
        See also the{" "}
        <a className="text-brand-700 underline" href="/data-deletion">
          Data Deletion Instructions
        </a>{" "}
        page.
      </Section>

      <Section title="Your rights">
        Depending on where you live (e.g. EU/UK under GDPR, California under
        CCPA), you have rights to access, correct, port, or delete your data.
        You can exercise any of these by emailing{" "}
        <a className="text-brand-700 underline" href="mailto:jp@titanreteam.com">
          jp@titanreteam.com
        </a>
        .
      </Section>

      <Section title="Security">
        We encrypt connected-account tokens at rest (AES-256). All traffic
        between your browser and REOS is TLS-encrypted. We follow standard
        practices for password storage and access control. No system is
        perfect — if you suspect a security issue, please email us promptly.
      </Section>

      <Section title="Changes to this policy">
        If we change this policy in a way that materially affects your data,
        we&rsquo;ll update the &ldquo;Last updated&rdquo; date above and notify
        active users by email.
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="font-display text-base font-semibold">{title}</h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}
