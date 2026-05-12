/**
 * /data-deletion-status?id=<confirmation_code>
 *
 * Public status page that the Meta data-deletion callback returns
 * in its JSON response. When a user revokes the REOS app from their
 * Facebook account, Meta directs them here so they can see proof
 * the deletion was queued.
 *
 * For now this is a static "we got your request" page — once we have
 * a deletion queue, we'll look up the confirmation code and show
 * real status (queued / processing / complete / failed).
 */

interface PageProps {
  searchParams: Promise<{ id?: string }>;
}

export const metadata = {
  title: "Data Deletion Status · REOS",
  description: "Status of your REOS data-deletion request.",
};

export default async function DataDeletionStatusPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const confirmationCode = params.id ?? "—";
  return (
    <div className="mx-auto max-w-2xl py-6">
      <h1 className="font-display text-h1 font-semibold">
        Deletion Request Received
      </h1>
      <p className="mt-1 text-sm text-text-muted">
        Your REOS data-deletion request has been queued.
      </p>

      <div className="mt-6 space-y-5 text-sm leading-relaxed text-text">
        <p>
          We&rsquo;ll process your request within 30 days. The confirmation
          code below identifies your request — keep it if you want to
          reference it in a support email.
        </p>

        <div className="rounded-md border border-border bg-surface-2 p-4">
          <div className="text-xs text-text-muted">Confirmation code</div>
          <div className="mt-1 font-mono text-base text-text">
            {confirmationCode}
          </div>
        </div>

        <p>
          Need to follow up? Email{" "}
          <a
            className="text-brand-700 underline"
            href={`mailto:jp@titanreteam.com?subject=Data%20deletion%20status%20${encodeURIComponent(confirmationCode)}`}
          >
            jp@titanreteam.com
          </a>{" "}
          with the confirmation code.
        </p>

        <p className="text-xs text-text-muted">
          See also our{" "}
          <a className="text-brand-700 underline" href="/data-deletion">
            data-deletion instructions
          </a>{" "}
          and{" "}
          <a className="text-brand-700 underline" href="/privacy">
            privacy policy
          </a>
          .
        </p>
      </div>
    </div>
  );
}
