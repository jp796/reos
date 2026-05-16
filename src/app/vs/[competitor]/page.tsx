/**
 * /vs/[competitor] — programmatic SEO comparison pages.
 *
 * Each competitor in src/app/vs/competitors.ts gets a dedicated
 * page that targets the "{competitor} alternative" search intent.
 * Structure is identical per page (template + data) so we can ship
 * 5+ pages from one route and one data file.
 *
 * Public route — added to PUBLIC_PREFIXES in middleware.ts.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, XCircle, AlertCircle, ArrowRight } from "lucide-react";
import { Logo } from "@/app/components/Logo";
import {
  getCompetitor,
  allCompetitors,
  type Competitor,
} from "../competitors";

interface PageProps {
  params: Promise<{ competitor: string }>;
}

// Static-generation for every known competitor — instant page loads,
// max Core Web Vitals score, ideal for Google's ranking signals.
export async function generateStaticParams() {
  return allCompetitors().map((c) => ({ competitor: c.slug }));
}

export async function generateMetadata({ params }: PageProps) {
  const { competitor } = await params;
  const c = getCompetitor(competitor);
  if (!c) return { title: "Not found" };
  const url = `https://myrealestateos.com/vs/${c.slug}`;
  return {
    title: `REOS vs ${c.name} · AI Transaction Coordinator Software Comparison`,
    description: `Compare REOS and ${c.name} side-by-side. AI contract reading, automated compliance audit, social-post generation, and editable templates — what ${c.name} doesn't do.`,
    keywords: c.searchPhrases.concat([
      "transaction coordinator software",
      "real estate AI",
    ]),
    alternates: { canonical: url },
    openGraph: {
      title: `REOS vs ${c.name}`,
      description: `AI transaction coordinator software vs ${c.name}.`,
      url,
      type: "website",
    },
  };
}

export default async function VsPage({ params }: PageProps) {
  const { competitor } = await params;
  const c = getCompetitor(competitor);
  if (!c) notFound();

  return (
    <div className="min-h-screen bg-bg text-text">
      <ComparisonJsonLd competitor={c} />

      {/* Header */}
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link href="/" className="flex items-center gap-2">
            <Logo size={28} />
            <span className="font-display text-sm font-bold">
              <span>RE</span>
              <span className="text-gradient-brand">OS</span>
            </span>
          </Link>
          <Link
            href="/signup?tier=solo"
            className="inline-flex items-center gap-1 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-500"
          >
            Start free trial
            <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.5} />
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-4xl px-4 pb-10 pt-12 text-center">
        <span className="inline-block rounded-full bg-accent-50 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-accent-700 ring-1 ring-accent-200">
          Looking for a {c.name} alternative?
        </span>
        <h1 className="mx-auto mt-5 max-w-3xl font-display text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
          REOS vs <span className="text-gradient-brand">{c.name}</span>
        </h1>
        <h2 className="mx-auto mt-3 max-w-2xl text-lg text-text-muted sm:text-xl">
          AI transaction coordinator software — what REOS does that {c.name}{" "}
          doesn&rsquo;t.
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-sm text-text-muted">
          {c.name}: {c.tagline} {c.ownership}
        </p>
      </section>

      {/* Feature matrix */}
      <section className="border-t border-border bg-surface-2/40 py-12">
        <div className="mx-auto max-w-4xl px-4">
          <h2 className="font-display text-2xl font-bold tracking-tight">
            Feature comparison
          </h2>
          <p className="mt-2 text-sm text-text-muted">
            Sourced from {c.name}&rsquo;s public marketing pages. Last audited
            May 2026.
          </p>
          <div className="mt-6 overflow-hidden rounded-lg border border-border bg-surface">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-2/50 text-left text-xs uppercase tracking-wider text-text-muted">
                  <th className="px-4 py-3">Feature</th>
                  <th className="px-4 py-3 text-center">REOS</th>
                  <th className="px-4 py-3 text-center">{c.name}</th>
                </tr>
              </thead>
              <tbody>
                {c.features.map((row) => (
                  <tr
                    key={row.feature}
                    className="border-b border-border last:border-b-0"
                  >
                    <td className="px-4 py-3">{row.feature}</td>
                    <td className="px-4 py-3 text-center">
                      <CheckCircle2
                        className="mx-auto h-5 w-5 text-emerald-600"
                        strokeWidth={2}
                      />
                    </td>
                    <td className="px-4 py-3 text-center" title={row.note}>
                      {row.state === "yes" && (
                        <CheckCircle2
                          className="mx-auto h-5 w-5 text-emerald-600"
                          strokeWidth={2}
                        />
                      )}
                      {row.state === "limited" && (
                        <AlertCircle
                          className="mx-auto h-5 w-5 text-amber-600"
                          strokeWidth={2}
                        />
                      )}
                      {row.state === "no" && (
                        <XCircle
                          className="mx-auto h-5 w-5 text-red-500"
                          strokeWidth={2}
                        />
                      )}
                      {row.note && (
                        <div className="mt-1 text-[10px] text-text-muted">
                          {row.note}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex flex-wrap gap-4 text-xs text-text-muted">
            <span className="flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> Available
            </span>
            <span className="flex items-center gap-1">
              <AlertCircle className="h-3.5 w-3.5 text-amber-600" /> Partial /
              limited
            </span>
            <span className="flex items-center gap-1">
              <XCircle className="h-3.5 w-3.5 text-red-500" /> Not available
            </span>
          </div>
        </div>
      </section>

      {/* Where REOS wins */}
      <section className="py-12">
        <div className="mx-auto max-w-4xl px-4">
          <h2 className="font-display text-2xl font-bold tracking-tight">
            Where REOS wins
          </h2>
          <ul className="mt-6 space-y-4">
            {c.wins.map((w, i) => (
              <li key={i} className="flex items-start gap-3">
                <CheckCircle2
                  className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600"
                  strokeWidth={2}
                />
                <span className="text-base text-text">{w}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Honest concessions */}
      <section className="border-t border-border bg-surface-2/40 py-12">
        <div className="mx-auto max-w-4xl px-4">
          <h2 className="font-display text-2xl font-bold tracking-tight">
            Where {c.name} wins (we&rsquo;re not pretending)
          </h2>
          <p className="mt-2 text-sm text-text-muted">
            Honest comparisons close more deals than dishonest ones.
          </p>
          <ul className="mt-6 space-y-4">
            {c.concessions.map((w, i) => (
              <li key={i} className="flex items-start gap-3">
                <AlertCircle
                  className="mt-0.5 h-5 w-5 shrink-0 text-amber-600"
                  strokeWidth={2}
                />
                <span className="text-base text-text">{w}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Pricing comparison */}
      <section className="py-12">
        <div className="mx-auto max-w-4xl px-4">
          <h2 className="font-display text-2xl font-bold tracking-tight">
            Pricing at a glance
          </h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border-2 border-brand-500 bg-brand-50/30 p-5">
              <div className="text-xs font-semibold uppercase tracking-wider text-brand-700">
                REOS
              </div>
              <div className="mt-2 font-display text-3xl font-bold tabular-nums">
                $97<span className="text-base font-normal text-text-muted">/mo</span>
              </div>
              <div className="mt-1 text-xs text-text-muted">
                Solo tier · all AI features included. Team $297 / Brokerage $997.
              </div>
              <ul className="mt-3 space-y-1 text-xs">
                <li>✓ Self-serve signup</li>
                <li>✓ 60-day money-back guarantee</li>
                <li>✓ Cancel anytime</li>
              </ul>
            </div>
            <div className="rounded-lg border border-border bg-surface p-5">
              <div className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                {c.name}
              </div>
              <div className="mt-2 font-display text-lg font-bold">
                {c.pricingNote}
              </div>
              <div className="mt-3 text-xs text-text-muted">
                Pricing per {c.name}&rsquo;s public marketing. May vary by
                contract and market.
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="border-t border-border bg-gradient-to-b from-surface-2/40 to-bg py-16">
        <div className="mx-auto max-w-3xl px-4 text-center">
          <h2 className="font-display text-3xl font-bold tracking-tight">
            Try REOS on your next deal.
          </h2>
          <p className="mt-3 text-lg text-text-muted">
            Connect your Gmail. Drop in a contract. Watch the AI scaffold the
            entire file. 60-day money-back if it doesn&rsquo;t save you 5 hours
            per deal.
          </p>
          <Link
            href="/signup?tier=solo"
            className="mt-8 inline-flex items-center gap-2 rounded-md bg-brand-600 px-8 py-4 text-base font-semibold text-white hover:bg-brand-500"
          >
            Start free trial
            <ArrowRight className="h-5 w-5" strokeWidth={2.5} />
          </Link>
          <p className="mt-4 text-xs text-text-muted">
            Other comparisons:{" "}
            {allCompetitors()
              .filter((x) => x.slug !== c.slug)
              .map((x) => (
                <Link
                  key={x.slug}
                  href={`/vs/${x.slug}`}
                  className="mx-2 underline hover:text-text"
                >
                  vs {x.name}
                </Link>
              ))}
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-2 px-4 text-center text-xs text-text-muted">
          <span>
            © {new Date().getFullYear()} REOS · Real Estate OS. Not affiliated
            with {c.name}.
          </span>
          <span>
            <Link href="/privacy" className="hover:text-text underline">
              Privacy
            </Link>
            {" · "}
            <Link href="/terms" className="hover:text-text underline">
              Terms
            </Link>
          </span>
        </div>
      </footer>
    </div>
  );
}

/**
 * JSON-LD for the comparison page — `WebPage` with `mainEntity`
 * pointing at a `SoftwareApplication` (REOS). Helps Google index
 * this as a product-comparison rather than a generic landing.
 */
function ComparisonJsonLd({ competitor }: { competitor: Competitor }) {
  const data = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: `REOS vs ${competitor.name}`,
    url: `https://myrealestateos.com/vs/${competitor.slug}`,
    description: `Compare REOS and ${competitor.name} side-by-side. AI transaction coordinator software comparison.`,
    mainEntity: {
      "@type": "SoftwareApplication",
      name: "REOS — Real Estate OS",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      offers: {
        "@type": "Offer",
        price: "97",
        priceCurrency: "USD",
      },
    },
  };
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
