import Link from "next/link";

export default function AtlasTraceIndex() {
  return (
    <div className="space-y-8">
      <section>
        <h1 className="font-display text-3xl font-bold tracking-tight">
          Watch the file organize itself.
        </h1>
        <p className="mt-2 max-w-2xl text-text-muted">
          Atlas doesn&apos;t just give answers — it shows its work through evidence.
          Whenever Atlas turns source material into useful work, the causal
          relationship becomes visible and inspectable:
        </p>
        <p className="mt-3 font-mono text-sm text-brand-700">
          Source → recognition → transfer → structured result → provenance
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        <Card
          href="/prototypes/atlas-trace/contract-extraction"
          n="1"
          title="Contract extraction"
          intensity="Cinematic"
          body="A real PDF on the left, the structured deal on the right, and a live ink bridge carrying each fact to its field — with a persistent, clickable source marker."
        />
        <Card
          href="/prototypes/atlas-trace/addendum-reconciliation"
          n="2"
          title="Addendum reconciliation"
          intensity="Focused"
          body="Not a silent overwrite — the original term, the superseding clause, the proposed value, and the downstream deadlines/tasks it reflows, shown before applying."
        />
        <Card
          href="/prototypes/atlas-trace/email-to-milestone"
          n="3"
          title="Email → milestone"
          intensity="Micro"
          body="One sentence from a title company becomes a completed milestone, with an Atlas Receipt: action, evidence, confidence, time, and a correction path."
        />
      </section>

      <section className="rounded-lg border border-border bg-surface p-4 text-sm">
        <h2 className="font-medium">What these prototypes are</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-text-muted">
          <li>Isolated screens for design review — no production workflow is touched.</li>
          <li>Driven by <span className="font-medium text-text">sample data shaped like the real events</span> the extraction pipeline already streams (<code className="text-xs">field → &#123;key, value, confidence, snippet, source&#125;</code>).</li>
          <li>Motion communicates causality; provenance persists after motion ends.</li>
          <li>Reduced-motion users get the same information without any movement.</li>
        </ul>
        <p className="mt-3 text-text-subtle">
          Turn on your OS &ldquo;reduce motion&rdquo; setting to see the equivalent static experience on Prototype 1.
        </p>
      </section>
    </div>
  );
}

function Card({ href, n, title, intensity, body }: { href: string; n: string; title: string; intensity: string; body: string }) {
  return (
    <Link
      href={href}
      className="group rounded-lg border border-border bg-surface p-4 transition-colors hover:border-brand-300"
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs text-text-subtle">{n}</span>
        <span className="rounded-full border border-dashed border-border px-2 py-0.5 text-[10px] uppercase tracking-wider text-text-subtle">
          {intensity}
        </span>
      </div>
      <h3 className="mt-2 font-display text-lg font-semibold group-hover:text-brand-700">{title}</h3>
      <p className="mt-1 text-sm text-text-muted">{body}</p>
    </Link>
  );
}
