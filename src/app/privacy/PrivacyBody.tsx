/**
 * PrivacyBody — the actual policy content. Originally drafted to
 * satisfy Meta + LinkedIn OAuth-app-review requirements; refreshed
 * for SaaS launch (multi-tenant, paid signups, expanded subprocessor
 * list). Plain English, not legalese.
 *
 * Update LAST_UPDATED when material content changes. Bumping this
 * does NOT currently force re-acceptance the way TERMS_LAST_UPDATED
 * does — Privacy Policy is informational, not contractual. Bump
 * TERMS_LAST_UPDATED in parallel if the change is significant
 * enough that re-acceptance is the right call.
 */

const LAST_UPDATED = "June 6, 2026";

export function PrivacyBody() {
  return (
    <div className="space-y-5 text-sm leading-relaxed text-text">
      <p className="text-xs text-text-muted">
        Last updated: <span className="font-medium">{LAST_UPDATED}</span>
      </p>

      <Section title="Who we are">
        Real Estate OS (&ldquo;REOS&rdquo;) is a hosted software service
        for real-estate transaction coordination, operated by{" "}
        <span className="font-medium">Titan RE Team LLC</span>, a Wyoming
        limited liability company headquartered in Cheyenne, Wyoming.
        Contact us at{" "}
        <a className="text-brand-700 underline" href="mailto:jp@titanreteam.com">
          jp@titanreteam.com
        </a>
        .
      </Section>

      <Section title="Our role">
        For data you put into your REOS account — your contacts,
        transactions, documents, notes, and the like — REOS is a{" "}
        <span className="font-medium">processor</span>. You (or the
        brokerage that owns the account) are the{" "}
        <span className="font-medium">controller</span> and remain
        responsible for the legal basis to process that data under your
        local privacy law.
      </Section>

      <Section title="What we collect">
        Only what we need to run the product:
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            <span className="font-medium">Account info</span> — your
            name, email, business name, and the tier you signed up for.
          </li>
          <li>
            <span className="font-medium">Billing info</span> — Stripe
            collects and stores your payment method on our behalf. We
            receive only a customer id, subscription id, and the status
            of your subscription. We never see your full card number.
          </li>
          <li>
            <span className="font-medium">Transaction data</span> —
            addresses, parties, dates, documents, financials, and notes
            you enter or upload to your account.
          </li>
          <li>
            <span className="font-medium">Connected-account data</span>{" "}
            — when you connect Google, Meta (Facebook / Instagram),
            LinkedIn, Follow Up Boss, or any other integration, we
            receive the OAuth tokens or API keys those services issue
            so we can read your inbox, send drafts, post on your
            behalf, or sync calendar events. We never see your password
            for any of those services. Tokens are encrypted at rest
            (AES-256).
          </li>
          <li>
            <span className="font-medium">Usage data</span> — basic
            logs of which pages you visit and which actions you take,
            used for debugging, audit, and improving the product.
          </li>
        </ul>
      </Section>

      <Section title="How we use it">
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>To provide the features you ask for — compliance audits, AI drafts, calendar sync, social posts, e-signatures, file uploads.</li>
          <li>To bill your subscription via Stripe and notify you of billing events.</li>
          <li>To send service notifications (morning briefs, password / security alerts, important account changes).</li>
          <li>To diagnose bugs, monitor performance, and improve reliability.</li>
          <li>
            <span className="font-medium">We do not sell your data. We do not use it to train external AI models. We do not share it with advertisers.</span>
          </li>
        </ul>
      </Section>

      <Section title="Who sees it">
        Your data is visible to you and any teammates inside your own
        REOS account. REOS operators may access your data only to fix
        a bug you report, investigate a security event, or respond to
        a lawful request. We use the following sub-processors to
        operate the service:
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li><span className="font-medium">Google Cloud</span> — hosting (Cloud Run), database hosting partner network, OAuth callbacks, Gmail / Calendar / Drive APIs</li>
          <li><span className="font-medium">Neon</span> — Postgres database (your tenant data lives here, encrypted at rest)</li>
          <li><span className="font-medium">Stripe</span> — billing, subscription management, invoicing</li>
          <li><span className="font-medium">OpenAI</span> — AI features (contract extraction, document classification, email drafts, summaries)</li>
          <li><span className="font-medium">Anthropic</span> — AI features (parallel provider for select features)</li>
          <li><span className="font-medium">Meta &amp; LinkedIn</span> — only when you connect them, only for posts and pages you trigger</li>
          <li><span className="font-medium">Follow Up Boss</span> — only when you connect it, for CRM sync</li>
          <li><span className="font-medium">Apify</span> — public-record real-estate photo lookup (no personal data leaves REOS to Apify)</li>
          <li><span className="font-medium">Documenso</span> — e-signature requests for contracts you choose to send</li>
          <li><span className="font-medium">Telegram</span> — only when you opt in for morning briefs and chat-based alerts</li>
        </ul>
        Each sub-processor handles your data under its own privacy
        terms, available on their respective websites.
      </Section>

      <Section title="AI providers — what we send and what we don't">
        When you use an AI feature (e.g. asking REOS to draft a reply
        to a Gmail thread, or to extract milestones from a contract),
        the relevant content from your account is sent to OpenAI or
        Anthropic via their API for processing. Their API terms do not
        use your content for model training by default. We send only
        the content the specific feature needs — typically one email
        thread, one document, or a short summary — not your full
        inbox or contact list.
      </Section>

      <Section title="How long we keep it">
        We keep your data while your account is active. If you cancel
        your subscription, we keep your data for 30 days so you can
        re-activate without loss. After that we delete it on a normal
        purge cycle, except where we&rsquo;re legally required to
        retain a record (e.g. financial transactions for tax purposes,
        kept up to 7 years per IRS guidance) or to defend against legal
        claims.
      </Section>

      <Section title="How to delete your data">
        Two ways:
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            Inside the app: <span className="font-medium">Settings → Account → Delete account</span>.
          </li>
          <li>
            By email: send a request to{" "}
            <a className="text-brand-700 underline" href="mailto:jp@titanreteam.com">
              jp@titanreteam.com
            </a>{" "}
            from the email address on your account. We&rsquo;ll confirm
            and complete the deletion within 30 days.
          </li>
        </ul>
        See also the{" "}
        <a className="text-brand-700 underline" href="/data-deletion">
          Data Deletion Instructions
        </a>{" "}
        page.
      </Section>

      <Section title="Your rights">
        Depending on where you live (EU/UK under GDPR, California under
        CCPA, and similar laws elsewhere), you have rights to access,
        correct, port, or delete your data, and to object to or
        restrict certain processing. You can exercise any of these by
        emailing{" "}
        <a className="text-brand-700 underline" href="mailto:jp@titanreteam.com">
          jp@titanreteam.com
        </a>
        . We respond within 30 days.
      </Section>

      <Section title="International data transfers">
        REOS is hosted on Google Cloud in the United States. If you
        access REOS from outside the US, your data will be transferred
        to and processed in the US. By using REOS you consent to that
        transfer.
      </Section>

      <Section title="Security">
        We encrypt connected-account tokens at rest (AES-256). All
        traffic between your browser and REOS is TLS-encrypted. Tenant
        data is logically isolated by account id and the boundary is
        enforced at every API and server-rendered page. We follow
        standard practices for password storage and access control,
        and we log every meaningful change to support audit. No system
        is perfect — if you suspect a security issue, please email us
        promptly at the contact above.
      </Section>

      <Section title="Children">
        REOS is not directed to children. You must be at least 18 to
        sign up. We do not knowingly collect personal data from anyone
        under 18; if we discover that we have, we will delete it.
      </Section>

      <Section title="Changes to this policy">
        If we change this policy in a way that materially affects your
        data, we&rsquo;ll update the &ldquo;Last updated&rdquo; date
        above and notify active users by email or in-app message.
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
