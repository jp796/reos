/**
 * Public sales funnel — REOS marketing landing.
 *
 * Russell-Brunson-shaped: hero → problem → solution → stack →
 * demo placeholder → risk reversal → pricing → FAQ → final CTA.
 * Auth-aware — when the visitor is signed in, the top nav swaps
 * the "Sign in" CTA for "Open dashboard."
 */

import Link from "next/link";
import {
  ArrowRight,
  Sparkles,
  ShieldCheck,
  Zap,
  Mail,
  Calendar,
  FileCheck,
  TrendingUp,
  MessageCircle,
  Megaphone,
  CheckCircle2,
  Clock,
  Lock,
} from "lucide-react";
import { auth } from "@/auth";
import { Logo } from "./components/Logo";

export const dynamic = "force-dynamic";

export default async function Landing() {
  const session = await auth();
  const signedIn = !!session?.user;

  return (
    <div className="min-h-screen bg-bg text-text">
      {/* ─── Top nav ─────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 border-b border-border bg-bg/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link
            href="/"
            className="flex items-center gap-2 font-display text-lg font-bold"
          >
            <Logo size={28} />
            <span>
              RE<span className="text-gradient-brand">OS</span>
            </span>
          </Link>
          <nav className="flex items-center gap-2 text-sm">
            <a
              href="#features"
              className="hidden rounded-md px-3 py-1.5 text-text-muted hover:text-text sm:inline-block"
            >
              Features
            </a>
            <a
              href="#pricing"
              className="hidden rounded-md px-3 py-1.5 text-text-muted hover:text-text sm:inline-block"
            >
              Pricing
            </a>
            <a
              href="#faq"
              className="hidden rounded-md px-3 py-1.5 text-text-muted hover:text-text sm:inline-block"
            >
              FAQ
            </a>
            {signedIn ? (
              <Link
                href="/today"
                className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 font-medium text-white hover:bg-brand-500"
              >
                Open dashboard
                <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
              </Link>
            ) : (
              <Link
                href="/login"
                className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 font-medium text-white hover:bg-brand-500"
              >
                Sign in
              </Link>
            )}
          </nav>
        </div>
      </header>

      {/* ─── Hero ────────────────────────────────────────────── */}
      <section className="mx-auto max-w-5xl px-4 pb-12 pt-16 sm:pt-24">
        <div className="text-center">
          <span className="inline-block rounded-full bg-accent-50 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-accent-700 ring-1 ring-accent-200 dark:bg-accent-100 dark:text-accent-700">
            Built for transaction coordinators · agents welcome
          </span>
          <h1 className="mx-auto mt-6 max-w-3xl font-display text-4xl font-bold leading-tight tracking-tight sm:text-6xl">
            Run 50 deals like you run 5.
            <span className="block text-gradient-brand">
              Let Atlas do the paperwork.
            </span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-text-muted sm:text-xl">
            REOS is the{" "}
            <strong className="text-text">AI Transaction Coordinator</strong>{" "}
            for TCs and the agents they support. It reads contracts, builds
            timelines, watches every inbox, preps the compliance file, and
            sends one daily brief — so you scale without burning out.
          </p>

          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href={signedIn ? "/today" : "/login"}
              className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-brand-600 px-6 py-3 text-base font-semibold text-white hover:bg-brand-500 sm:w-auto"
            >
              <Sparkles className="h-4 w-4" strokeWidth={2} />
              {signedIn ? "Open dashboard" : "Start free — 1 deal free"}
              <ArrowRight className="h-4 w-4" strokeWidth={2} />
            </Link>
            <a
              href="#demo"
              className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-border bg-surface px-6 py-3 text-base font-medium text-text hover:border-brand-500 sm:w-auto"
            >
              Watch the demo (90 sec)
            </a>
          </div>
          <p className="mt-3 text-xs text-text-subtle">
            No credit card. Connect Gmail in under a minute.
          </p>

          <div className="mx-auto mt-12 grid max-w-3xl grid-cols-2 gap-4 text-left sm:grid-cols-4">
            {[
              { icon: Clock, kpi: "10×", sub: "deals per TC" },
              { icon: FileCheck, kpi: "60 sec", sub: "AI contract read" },
              { icon: ShieldCheck, kpi: "Any brokerage", sub: "Rezen / Skyslope / Dotloop" },
              { icon: Lock, kpi: "Your Gmail", sub: "no AI branding" },
            ].map((s) => (
              <div
                key={s.kpi}
                className="rounded-md border border-border bg-surface p-3"
              >
                <s.icon className="h-4 w-4 text-brand-600" strokeWidth={2} />
                <div className="mt-2 font-display text-lg font-bold tabular-nums">
                  {s.kpi}
                </div>
                <div className="text-xs text-text-muted">{s.sub}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Problem ─────────────────────────────────────────── */}
      <section className="border-t border-border bg-surface-2/40 py-16">
        <div className="mx-auto max-w-3xl px-4">
          <h2 className="font-display text-3xl font-bold tracking-tight">
            You didn&rsquo;t get into real estate to be a paper-pusher.
          </h2>
          <p className="mt-4 text-lg text-text-muted">
            Every contract that lands in your inbox starts a 30-day fire drill:
          </p>
          <ul className="mt-6 space-y-2 text-base">
            {[
              "Earnest money receipt — chase the title coordinator",
              "Inspection deadline — remember to remind the buyer",
              "Settlement Statement — pray it lands on time",
              "Compliance file — assemble 34 documents named perfectly",
              "Wire fraud advisory — sent? signed? confirmed?",
              "Closing-day utilities — set up before move-in",
            ].map((p) => (
              <li key={p} className="flex items-start gap-2">
                <span className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />
                <span>{p}</span>
              </li>
            ))}
          </ul>
          <p className="mt-6 text-lg text-text">
            <strong>You&rsquo;re losing 8 hours a week</strong> to busywork
            the agent down the street has automated.
          </p>
        </div>
      </section>

      {/* ─── Solution + feature stack ───────────────────────── */}
      <section id="features" className="py-16">
        <div className="mx-auto max-w-5xl px-4">
          <div className="text-center">
            <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
              REOS is your AI Transaction Coordinator.
            </h2>
            <p className="mx-auto mt-3 max-w-2xl text-lg text-text-muted">
              Plugs into your CRM. Reads inbound contracts. Builds your
              timeline. Watches your inbox. Preps your Rezen file. Texts you
              the daily brief. Never sleeps.
            </p>
          </div>

          <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                icon: Zap,
                title: "AI contract reading",
                body: "60-second extraction of dates, parties, price, contingencies. All 50 states, even handwritten/scanned.",
              },
              {
                icon: Calendar,
                title: "Auto-built timeline",
                body: "Closing-date math, business-day rules, state-specific defaults. Move closing → all deadlines reflow automatically.",
              },
              {
                icon: Mail,
                title: "Inbox watcher",
                body: "Detects earnest-money receipts, deposit confirmations, executed contracts — auto-marks milestones complete.",
              },
              {
                icon: ShieldCheck,
                title: "Rezen prep, automated",
                body: "Every required doc placed in its slot, renamed correctly, downloadable as a zip. Drag into Rezen and ship.",
              },
              {
                icon: MessageCircle,
                title: "Atlas, on Telegram",
                body: "8am daily brief. Two-way chat — ask 'status of 509 Bent' from anywhere, get a real answer.",
              },
              {
                icon: TrendingUp,
                title: "Pipeline funnel",
                body: "Leads → active → closed by source, with conversion % and CAC/ROI. Know what's actually working.",
              },
              {
                icon: Megaphone,
                title: "Auto social posts",
                body: "Just Listed / Under Contract / Just Sold captions for IG, FB, LinkedIn — generated and ready to paste.",
              },
              {
                icon: FileCheck,
                title: "Compounding intelligence",
                body: "Every deal teaches REOS your title cos, lenders, and agents. Deal #2 onwards, they auto-attach.",
              },
              {
                icon: CheckCircle2,
                title: "Utility Connect",
                body: "Auto-enrolls your buyer 7-10 days before close. Water, electricity, cable — handled while you sleep.",
              },
            ].map((f) => (
              <div
                key={f.title}
                className="rounded-lg border border-border bg-surface p-5"
              >
                <div className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-brand-50 text-brand-600 dark:bg-brand-100">
                  <f.icon className="h-4 w-4" strokeWidth={2} />
                </div>
                <h3 className="mt-3 font-display text-base font-semibold">
                  {f.title}
                </h3>
                <p className="mt-1.5 text-sm text-text-muted">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Demo video ─────────────────────────────────────── */}
      <section
        id="demo"
        className="border-t border-border bg-surface-2/40 py-16"
      >
        <div className="mx-auto max-w-3xl px-4 text-center">
          <h2 className="font-display text-3xl font-bold tracking-tight">
            See Atlas run a real file in 90 seconds.
          </h2>
          <p className="mt-3 text-lg text-text-muted">
            From contract upload to Rezen-ready package — what normally
            takes an hour, finished while the coffee brews.
          </p>
          <div className="relative mx-auto mt-8 aspect-video w-full overflow-hidden rounded-lg border border-border shadow-md">
            <iframe
              src="https://www.loom.com/embed/9a0e599e98a445f9891cbe26ba1e9057"
              title="REOS demo · contract to Rezen-ready in 90 seconds"
              allowFullScreen
              loading="lazy"
              className="absolute inset-0 h-full w-full"
              style={{ border: 0 }}
            />
          </div>
        </div>
      </section>

      {/* ─── Risk reversal ─────────────────────────────────── */}
      <section className="py-16">
        <div className="mx-auto max-w-3xl px-4 text-center">
          <h2 className="font-display text-3xl font-bold tracking-tight">
            Try your first deal free.
          </h2>
          <p className="mt-3 text-lg text-text-muted">
            No credit card. No setup call. Connect your Gmail, drop in a
            contract, watch REOS scaffold the entire file.
          </p>
          <p className="mt-6 text-base">
            <strong>Our promise:</strong> if Atlas doesn&rsquo;t save you 5
            hours on your next deal, you don&rsquo;t pay.
          </p>
          <Link
            href={signedIn ? "/today" : "/login"}
            className="mt-6 inline-flex items-center gap-2 rounded-md bg-brand-600 px-6 py-3 font-semibold text-white hover:bg-brand-500"
          >
            <Sparkles className="h-4 w-4" strokeWidth={2} />
            Start free
            <ArrowRight className="h-4 w-4" strokeWidth={2} />
          </Link>
        </div>
      </section>

      {/* ─── Pricing ─────────────────────────────────────────── */}
      <section
        id="pricing"
        className="border-t border-border bg-surface-2/40 py-16"
      >
        <div className="mx-auto max-w-5xl px-4">
          <div className="text-center">
            <h2 className="font-display text-3xl font-bold tracking-tight">
              Simple pricing. Pay for closings, not seats.
            </h2>
            <p className="mt-3 text-text-muted">
              Unlimited users. Charge only kicks in when you start a deal.
            </p>
          </div>

          <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-3">
            {[
              {
                name: "Solo",
                price: "$97",
                sub: "/month",
                tag: "Best for individual agents",
                features: [
                  "Unlimited deals",
                  "AI contract reading",
                  "Telegram brief",
                  "Rezen prep + bundle download",
                  "Auto social captions",
                  "Email + Gmail sync",
                ],
              },
              {
                name: "Team",
                price: "$297",
                sub: "/month",
                tag: "Solo agents and small teams",
                features: [
                  "Everything in Solo",
                  "Multi-user (unlimited)",
                  "Per-deal assignment",
                  "Shared calendar invites",
                  "Compliance audit logs",
                  "Priority support",
                ],
                highlight: true,
              },
              {
                name: "Brokerage",
                price: "$997",
                sub: "/month",
                tag: "Brokerage white-label",
                features: [
                  "Everything in Team",
                  "Custom checklist + CDA template",
                  "Brokerage branding (logo, colors)",
                  "Multi-state contract rules",
                  "Onboard agents in bulk",
                  "Dedicated success manager",
                ],
              },
            ].map((tier) => (
              <div
                key={tier.name}
                className={
                  "rounded-lg border p-5 " +
                  (tier.highlight
                    ? "border-brand-500 bg-surface ring-2 ring-brand-500"
                    : "border-border bg-surface")
                }
              >
                {tier.highlight && (
                  <div className="mb-3 inline-block rounded-full bg-brand-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                    Most popular
                  </div>
                )}
                <div className="font-display text-xl font-bold">
                  {tier.name}
                </div>
                <div className="mt-1 text-xs text-text-muted">{tier.tag}</div>
                <div className="mt-4 flex items-baseline gap-1">
                  <span className="font-display text-4xl font-bold tabular-nums">
                    {tier.price}
                  </span>
                  <span className="text-sm text-text-muted">{tier.sub}</span>
                </div>
                <ul className="mt-5 space-y-2 text-sm">
                  {tier.features.map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <CheckCircle2
                        className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600"
                        strokeWidth={2}
                      />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <Link
                  href={signedIn ? "/today" : "/login"}
                  className={
                    "mt-6 block rounded-md px-4 py-2 text-center text-sm font-semibold " +
                    (tier.highlight
                      ? "bg-brand-600 text-white hover:bg-brand-500"
                      : "border border-border bg-surface text-text hover:border-brand-500")
                  }
                >
                  Start free
                </Link>
              </div>
            ))}
          </div>
          <p className="mt-6 text-center text-xs text-text-subtle">
            All prices USD. Cancel anytime. 60-day money-back guarantee.
          </p>
        </div>
      </section>

      {/* ─── FAQ ─────────────────────────────────────────────── */}
      <section id="faq" className="py-16">
        <div className="mx-auto max-w-3xl px-4">
          <h2 className="text-center font-display text-3xl font-bold tracking-tight">
            Honest answers
          </h2>
          <div className="mt-8 space-y-4">
            {[
              {
                q: "Is this a CRM?",
                a: "No. REOS is the Transaction OS that plugs into your existing CRM (Follow Up Boss, Brivity, Lofty, etc.). It handles the file work between contract and close — your CRM keeps doing pipeline + nurture.",
              },
              {
                q: "Does it work with my brokerage's compliance system?",
                a: "Real Broker (Rezen) ships configured out-of-the-box. KW Command, Skyslope, Dotloop, and indie brokerages can configure their own checklists in Settings — full white-label support on the Brokerage tier.",
              },
              {
                q: "How does AI contract reading actually work?",
                a: "Forward the contract PDF to your transaction email or upload it directly. REOS extracts dates, parties, sale price, deadlines, lender, title — everything — in 60 seconds and builds the milestone timeline automatically.",
              },
              {
                q: "What about state-specific contract rules?",
                a: "Each state has its own deadline math — Wyoming walkthrough is closing-1 calendar day, Colorado has resolution-of-objections, etc. REOS knows the major states and you can override per-brokerage.",
              },
              {
                q: "Will it post to Instagram for me?",
                a: "Captions generate today (Just Listed / Under Contract / Just Sold) ready to paste. Buffer integration coming for one-click multi-platform posting. You stay in control of the brand.",
              },
              {
                q: "Is my data safe?",
                a: "Encrypted at rest in Neon Postgres. Gmail OAuth tokens encrypted with a per-tenant key. We never train AI models on your data. SOC 2 Type II in progress.",
              },
            ].map((f) => (
              <details
                key={f.q}
                className="rounded-md border border-border bg-surface p-4 text-sm"
              >
                <summary className="cursor-pointer font-semibold">
                  {f.q}
                </summary>
                <p className="mt-2 text-text-muted">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Final CTA ───────────────────────────────────────── */}
      <section className="border-t border-border bg-bg py-16">
        <div className="mx-auto max-w-3xl px-4 text-center">
          <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
            Your next deal could close itself.
          </h2>
          <p className="mt-3 text-lg text-text-muted">
            Connect your Gmail. Drop in a contract. Watch Atlas go to work.
          </p>
          <Link
            href={signedIn ? "/today" : "/login"}
            className="mt-8 inline-flex items-center gap-2 rounded-md bg-brand-600 px-8 py-4 text-base font-semibold text-white hover:bg-brand-500"
          >
            <Sparkles className="h-5 w-5" strokeWidth={2} />
            Start free — 1 deal free
            <ArrowRight className="h-5 w-5" strokeWidth={2} />
          </Link>
          <p className="mt-4 text-xs text-text-subtle">
            No credit card · 60-day refund · Cancel anytime
          </p>
        </div>
      </section>

      {/* ─── Footer ──────────────────────────────────────────── */}
      <footer className="border-t border-border py-8 text-center text-xs text-text-subtle">
        <div className="mx-auto max-w-5xl px-4">
          REOS · Real Estate Operating System ·{" "}
          <Link href="/terms" className="hover:text-text-muted">
            Terms
          </Link>{" "}
          ·{" "}
          <a
            href="mailto:hello@myrealestateos.com"
            className="hover:text-text-muted"
          >
            hello@myrealestateos.com
          </a>
        </div>
      </footer>
    </div>
  );
}
