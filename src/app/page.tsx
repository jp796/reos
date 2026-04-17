export default function HomePage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-4xl font-semibold tracking-tight">
        Real Estate OS
      </h1>
      <p className="mt-4 text-neutral-600">
        Private AI transaction chief of staff. Scaffold running; dashboards
        ship in Phase 2.
      </p>

      <section className="mt-10 rounded-lg border border-neutral-200 bg-white p-6">
        <h2 className="text-lg font-medium">Foundation status</h2>
        <ul className="mt-4 space-y-2 text-sm text-neutral-700">
          <li>
            <code className="rounded bg-neutral-100 px-1.5 py-0.5">
              /api/health
            </code>{" "}
            — service liveness
          </li>
          <li>
            <code className="rounded bg-neutral-100 px-1.5 py-0.5">
              /api/auth/google
            </code>{" "}
            — initiate Google OAuth (Gmail + Calendar)
          </li>
          <li>
            <code className="rounded bg-neutral-100 px-1.5 py-0.5">
              /api/integrations/fub/webhook
            </code>{" "}
            — Follow Up Boss webhook receiver
          </li>
        </ul>
      </section>

      <section className="mt-6 rounded-lg border border-neutral-200 bg-white p-6">
        <h2 className="text-lg font-medium">Next steps</h2>
        <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-neutral-700">
          <li>
            <code>cp .env.example .env.local</code> and fill in
            <code className="mx-1">ENCRYPTION_KEY</code>,
            <code className="mx-1">GOOGLE_*</code>,
            <code className="mx-1">FUB_API_KEY</code>.
          </li>
          <li>
            <code>docker compose up -d</code> to start local Postgres.
          </li>
          <li>
            <code>pnpm db:migrate</code> to create the schema.
          </li>
          <li>
            <code>pnpm db:seed</code> to create your account row.
          </li>
          <li>Connect Google, then Follow Up Boss, from Settings (Phase 2 UI).</li>
        </ol>
      </section>
    </main>
  );
}
