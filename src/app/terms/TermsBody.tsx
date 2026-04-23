/**
 * Canonical Terms-of-Use body. Bumping this == users need to accept
 * again. Keep as a pure component so it can render inside both the
 * standalone /terms page and the first-login acceptance modal.
 *
 * Tone target: direct, non-boilerplate, written for a real-estate TC
 * collaborating with the owning agent. Not a substitute for
 * Anthropic-drafted or attorney-drafted ToU — Jp should have counsel
 * review before we share this externally.
 */

export const TERMS_LAST_UPDATED = "2026-04-22";

export function TermsBody() {
  return (
    <div className="space-y-4 text-sm leading-relaxed text-text [&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:font-display [&_h2]:text-base [&_h2]:font-semibold [&_h2:first-of-type]:mt-2 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5 [&_ul_li]:marker:text-text-muted [&_p]:text-text [&_strong]:font-semibold">
      <p className="text-xs uppercase tracking-wide text-text-muted">
        Last updated: {TERMS_LAST_UPDATED}
      </p>

      <h2>1. What REOS is</h2>
      <p>
        Real Estate OS (&ldquo;REOS&rdquo;) is a private workspace built and
        operated by Jp Fluellen (Real Broker LLC, Cheyenne, WY) to manage
        active real-estate transactions. Access is by invitation only. There
        is no public signup.
      </p>

      <h2>2. Who you are</h2>
      <p>
        You are here because Jp explicitly added your email to the access
        list. Your role in REOS is either <strong>owner</strong> (Jp) or
        <strong> coordinator</strong> (everyone else — transaction
        coordinators, assistants, and other invited collaborators).
      </p>

      <h2>3. What you can do</h2>
      <ul>
        <li>
          View contacts, transactions, emails, documents, financials, and
          automations attached to this workspace.
        </li>
        <li>
          Create and edit transactions, milestones, and participants as
          needed to do your job.
        </li>
        <li>
          Trigger scans (Gmail, contracts, earnest money, etc.) when you
          have a reason to.
        </li>
        <li>
          Request access to anything else via the owner — REOS is under
          active development.
        </li>
      </ul>

      <h2>4. What you must not do</h2>
      <ul>
        <li>
          Share your sign-in link, session cookie, or screen-recordings of
          REOS with anyone outside the workspace.
        </li>
        <li>
          Export client data, email contents, or documents for any purpose
          other than servicing the transaction they relate to.
        </li>
        <li>
          Sign into REOS from a device that is not under your exclusive
          control, or from a public / shared machine you can&rsquo;t wipe.
        </li>
        <li>
          Reuse REOS workflows, scripts, or rule logic for a competing
          product. The code, rules, and automation logic belong to Jp /
          Titan RE Team.
        </li>
      </ul>

      <h2>5. Data you&rsquo;ll see</h2>
      <p>
        REOS surfaces information from Jp&rsquo;s Gmail, Google Drive, Follow
        Up Boss, and contract PDFs. This includes private financial and
        contact data about real clients. Treat everything you see as
        confidential under the same standard you&rsquo;d apply as a
        licensed TC representing those clients directly.
      </p>

      <h2>6. Audit logging</h2>
      <p>
        Every change you make in REOS is recorded with your user id,
        timestamp, and before/after state in an audit log the owner can
        review at any time. This is for reconstructing what happened if a
        client asks, not for surveillance — but it exists, and you should
        behave accordingly.
      </p>

      <h2>7. AI usage</h2>
      <p>
        REOS invokes third-party AI providers (currently OpenAI and
        Anthropic) on content from this workspace — contract text, email
        bodies, summaries. Do not paste anything into REOS that can&rsquo;t
        leave the workspace under those providers&rsquo; terms. Do not
        paste Social Security numbers, bank account / routing numbers, or
        driver&rsquo;s-license numbers; those are never needed for any
        automation.
      </p>

      <h2>8. Revocation</h2>
      <p>
        Jp can revoke your access at any time by removing your email from
        the access list. On revocation, your session ends, any open tabs
        lose access on the next request, and your audit trail remains in
        place. If you stop coordinating transactions for Jp&rsquo;s
        business, you must immediately stop using REOS.
      </p>

      <h2>9. No warranty</h2>
      <p>
        REOS is provided as-is for internal use. Jp offers no warranty of
        fitness, accuracy, or availability. Always verify dates, dollar
        amounts, and contract terms against the original source documents
        before relying on them with clients or vendors.
      </p>

      <h2>10. Changes</h2>
      <p>
        These terms can change. If they materially change, you&rsquo;ll be
        asked to re-accept before you can continue using REOS.
      </p>

      <p className="mt-6 text-xs text-text-muted">
        Questions: jp@titanreteam.com
      </p>
    </div>
  );
}
