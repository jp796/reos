/**
 * Canonical Terms-of-Use body. Bumping TERMS_LAST_UPDATED forces all
 * existing users to re-accept on next page load (layout.tsx compares
 * each user's User.termsAcceptedAt against this constant).
 *
 * Tone target: direct, non-boilerplate, written for a real-estate TC
 * or agent reading on a phone between showings — not a wall of
 * legalese. Same voice as the rest of REOS.
 *
 * Clauses marked [ATTORNEY-REVIEW] are placeholders for legal counsel
 * to bless before we promote /signup off the soft-launch surface.
 * Until that review lands, every signup form notes "attorney review
 * pending" so customers know the document is a working draft.
 */

export const TERMS_LAST_UPDATED = "2026-06-06";

export function TermsBody() {
  return (
    <div className="space-y-4 text-sm leading-relaxed text-text [&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:font-display [&_h2]:text-base [&_h2]:font-semibold [&_h2:first-of-type]:mt-2 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5 [&_ul_li]:marker:text-text-muted [&_p]:text-text [&_strong]:font-semibold">
      <p className="text-xs uppercase tracking-wide text-text-muted">
        Last updated: {TERMS_LAST_UPDATED} · Attorney review pending
      </p>

      <h2>1. What REOS is</h2>
      <p>
        Real Estate OS (&ldquo;REOS&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;)
        is a hosted, multi-tenant software service for real-estate
        transaction coordination. It is operated by{" "}
        <strong>Titan RE Team LLC</strong>, a Wyoming limited liability
        company headquartered in Cheyenne, Wyoming, doing business as
        REOS at <a className="text-brand-700 underline" href="https://myrealestateos.com">myrealestateos.com</a>.
      </p>

      <h2>2. Who can sign up</h2>
      <p>
        REOS is for use by real-estate professionals — licensed agents,
        brokerages, transaction coordinators, and the people they
        authorize on their team. You must be at least 18 years old, have
        the legal authority to enter into this agreement on behalf of
        yourself or the business you represent, and provide accurate
        information when you create your account.
      </p>

      <h2>3. Your account and team</h2>
      <p>
        When you sign up you create an <strong>account</strong> (a
        workspace for one brokerage or operator) and a{" "}
        <strong>user</strong> (you, with the &ldquo;owner&rdquo; role).
        Owners can invite teammates as &ldquo;coordinator&rdquo; users.
        You are responsible for what every user on your account does in
        REOS — including invited coordinators — and for keeping your
        sign-in credentials private.
      </p>

      <h2>4. Subscription, billing, and renewal</h2>
      <ul>
        <li>
          REOS is sold as a recurring subscription billed monthly to the
          payment method you provide at checkout. Billing is handled by
          Stripe; REOS never sees or stores your full card number.
        </li>
        <li>
          Your subscription <strong>auto-renews</strong> at the end of
          each billing period at the then-current rate for your tier
          until you cancel.
        </li>
        <li>
          You can change tier (upgrade or downgrade) at any time. Tier
          changes take effect at the next billing cycle; we do not
          prorate.
        </li>
        <li>
          Prices may change. If we raise the price of your tier, we&rsquo;ll
          email you at least 30 days before the new price hits your
          next renewal.
        </li>
      </ul>

      <h2>5. Cancellation and refunds <span className="text-xs font-normal text-text-muted">[ATTORNEY-REVIEW]</span></h2>
      <ul>
        <li>
          You can cancel anytime from Settings → Billing, or by emailing
          us. Cancellation takes effect at the end of the current
          billing period; you keep access until then.
        </li>
        <li>
          We do not offer refunds for partial months or unused features.
          If we shut down a feature you specifically paid for, we&rsquo;ll
          credit your account or refund the pro-rated portion at our
          discretion.
        </li>
        <li>
          Chargebacks initiated without first contacting us may result
          in immediate suspension while we investigate.
        </li>
      </ul>

      <h2>6. Acceptable use</h2>
      <p>You must not:</p>
      <ul>
        <li>
          Use REOS for anything illegal under the law of your
          jurisdiction or ours.
        </li>
        <li>
          Upload, store, or process personal data of people who have
          not consented to their information being in your real-estate
          workflow (your clients, their counterparties, vendors).
        </li>
        <li>
          Reverse-engineer, scrape, or systematically download data
          from REOS outside the export and integration paths we
          provide.
        </li>
        <li>
          Resell REOS access, share a single seat across multiple
          businesses, or repackage REOS as your own product.
        </li>
        <li>
          Use REOS to send spam, run political campaigns, or anything
          else outside the real-estate use case it&rsquo;s built for.
        </li>
        <li>
          Probe, scan, or interfere with our infrastructure or other
          customers&rsquo; tenants.
        </li>
      </ul>

      <h2>7. Your data and what we do with it</h2>
      <ul>
        <li>
          <strong>You own your data.</strong> Contacts, transactions,
          documents, financials, notes, and anything else you put into
          your REOS account belongs to you. We act as a data
          <em> processor</em>; you are the <em>controller</em>.
        </li>
        <li>
          We use your data only to provide REOS to you: running the
          features you ask for, billing your subscription, sending you
          service notifications, and diagnosing problems.
        </li>
        <li>
          <strong>We do not sell your data, share it with advertisers,
          or use it to train AI models for anyone else.</strong>
        </li>
        <li>
          On cancellation we keep your data for 30 days so you can
          re-activate without loss; after that we delete it on a normal
          purge cycle. You can export your data via the in-app export
          tools at any time before that window closes.
        </li>
      </ul>

      <h2>8. AI features and providers</h2>
      <p>
        REOS uses third-party AI providers (currently OpenAI and
        Anthropic) for features like contract extraction, document
        classification, email drafts, and summaries. Content from your
        account that touches an AI feature is sent to that provider for
        processing under their API terms, which by default do not use
        your content for training.
      </p>
      <p>
        <strong>Do not paste the following into REOS</strong> &mdash;
        nothing in our automation needs it, and putting it through an
        AI pipeline creates risk you can avoid: full Social Security
        numbers, bank account or routing numbers, driver&rsquo;s-license
        numbers, or anything similarly sensitive.
      </p>

      <h2>9. Connected third-party accounts</h2>
      <p>
        When you connect Google (Gmail / Calendar / Drive), Meta
        (Facebook / Instagram), LinkedIn, Follow Up Boss, Stripe, or
        any other integration, REOS receives OAuth tokens or API keys
        from those services so we can act on your behalf within the
        scopes you approve. We store these encrypted at rest, never see
        your password for any of those services, and let you revoke
        access from Settings → Integrations at any time.
      </p>

      <h2>10. Audit logging</h2>
      <p>
        Every meaningful change inside your REOS account is recorded
        with the acting user&rsquo;s id, timestamp, and before/after
        state. Owners can review their own account&rsquo;s audit log;
        REOS operators can review it when investigating a support
        request or security event. Coordinators should behave
        accordingly — every action is attributable.
      </p>

      <h2>11. Service availability</h2>
      <p>
        We aim to keep REOS up and fast, but we do not currently offer
        a contractual uptime SLA. We deploy frequently and may run
        maintenance with little notice. If REOS is down when you need
        it, fall back to your existing workflow and email us — we
        respond to reachability issues with priority.
      </p>

      <h2>12. Termination by you</h2>
      <p>
        Cancel anytime via Settings → Billing or by emailing{" "}
        <a className="text-brand-700 underline" href="mailto:jp@titanreteam.com">
          jp@titanreteam.com
        </a>
        . You keep access through the end of your current billing period;
        your data is retained for 30 days after that for re-activation,
        then deleted.
      </p>

      <h2>13. Termination by us</h2>
      <p>
        We can suspend or terminate your account if you violate these
        terms, fail to pay, abuse the service, expose other customers
        to risk, or use REOS for something illegal. For non-payment we
        try to give a 7-day grace period before suspending. For abuse
        or security issues we may act immediately. You can export your
        data during any suspension period that is not a security event.
      </p>

      <h2>14. No warranty</h2>
      <p>
        REOS is provided <strong>as-is</strong> and <strong>as available</strong>.
        We make no warranty that it will be uninterrupted, error-free,
        or fit for any particular purpose. Always verify dates, dollar
        amounts, deadlines, and contract terms against the original
        source documents before relying on REOS&rsquo;s output with
        clients, lenders, title companies, or your brokerage. AI
        outputs are drafts to review, not final compliance work.
      </p>

      <h2>15. Limit of liability <span className="text-xs font-normal text-text-muted">[ATTORNEY-REVIEW]</span></h2>
      <p>
        To the maximum extent allowed by law, our total liability for
        any claim arising out of or related to REOS is capped at the
        total amount you paid us in the twelve (12) months preceding
        the event giving rise to the claim. Neither party is liable for
        indirect, incidental, special, consequential, or punitive
        damages, even if warned they were possible.
      </p>

      <h2>16. Indemnification <span className="text-xs font-normal text-text-muted">[ATTORNEY-REVIEW]</span></h2>
      <p>
        You agree to indemnify and hold harmless Titan RE Team LLC, its
        officers, and contractors from any claim arising out of (a) your
        use of REOS in violation of these terms, (b) data you upload
        that you didn&rsquo;t have the right to process, or (c) the
        real-estate transactions you coordinate using REOS. We&rsquo;ll
        do the same for any claim that REOS itself infringes a
        third-party intellectual-property right, provided you notify
        us promptly and let us control the defense.
      </p>

      <h2>17. Intellectual property</h2>
      <p>
        The REOS application, brand, code, prompts, automation logic,
        and the way features fit together belong to Titan RE Team LLC.
        Your data — and any output an AI feature generates from your
        data, like an email draft or a contract summary — belongs to
        you. You grant us a limited license to host, copy, and process
        your data only to provide the service to you.
      </p>

      <h2>18. Changes to these terms</h2>
      <p>
        We may update these terms. If a change materially affects your
        rights or obligations, we&rsquo;ll bump the &ldquo;Last updated&rdquo;
        date above and prompt you to re-accept the new version on your
        next sign-in. Continued use of REOS after the prompt counts as
        acceptance.
      </p>

      <h2>19. Governing law and disputes <span className="text-xs font-normal text-text-muted">[ATTORNEY-REVIEW]</span></h2>
      <p>
        This agreement is governed by the laws of the State of Wyoming,
        without regard to its conflict-of-laws rules. Any lawsuit
        arising out of REOS must be brought in the state or federal
        courts located in Laramie County, Wyoming, and both parties
        consent to the exclusive jurisdiction of those courts.
      </p>

      <h2>20. Contact</h2>
      <p>
        Questions, billing problems, security reports, or legal notices:{" "}
        <a className="text-brand-700 underline" href="mailto:jp@titanreteam.com">
          jp@titanreteam.com
        </a>
        . Mail: Titan RE Team LLC, Cheyenne, Wyoming.
      </p>
    </div>
  );
}
