/**
 * AtlasWelcome — the warm, animated front door for the New Transaction
 * wizard's setup step. Left panel of the split layout (upload card sits
 * on the right). Pure CSS animation, no JS / no deps:
 *   - the avatar gently floats ("breathing") with radar pulse rings
 *   - Atlas blinks, with sparkles twinkling around it
 *   - a status ticker cycles "Reading your contract…" etc.
 *   - benefit bullets stagger-rise on mount
 * Everything collapses to static under prefers-reduced-motion.
 */

import { Sparkles, Globe, FileStack, Building2, Gift } from "lucide-react";

const BULLETS: Array<{
  icon: typeof Globe;
  title: string;
  hint: string;
}> = [
  {
    icon: Globe,
    title: "Reads contracts from all 50 states",
    hint: "Dates, parties, deadlines — pulled in seconds.",
  },
  {
    icon: FileStack,
    title: "Counter-offers & addenda",
    hint: "Drop them all — I read them together.",
  },
  {
    icon: Building2,
    title: "Investor deals too",
    hint: "Flips, wholesale, BRRRR, creative finance.",
  },
  {
    icon: Gift,
    title: "Your first deal's on us",
    hint: "Take the whole thing for a spin, free.",
  },
];

export function AtlasWelcome() {
  return (
    <div className="atlasw">
      <style>{`
        @keyframes atlasw-float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-6px)} }
        @keyframes atlasw-ping { 0%{transform:scale(.75);opacity:.55} 80%,100%{transform:scale(1.7);opacity:0} }
        @keyframes atlasw-blink { 0%,92%,100%{transform:scaleY(1)} 96%{transform:scaleY(.1)} }
        @keyframes atlasw-twinkle { 0%,100%{opacity:.25;transform:scale(.8)} 50%{opacity:1;transform:scale(1.15)} }
        @keyframes atlasw-roll { 0%,28%{transform:translateY(0)} 33%,61%{transform:translateY(-22px)} 66%,94%{transform:translateY(-44px)} 100%{transform:translateY(-66px)} }
        @keyframes atlasw-rise { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
        .atlasw-avatar{animation:atlasw-float 3.4s ease-in-out infinite}
        .atlasw-ping{animation:atlasw-ping 2.6s ease-out infinite}
        .atlasw-ping2{animation-delay:1.3s}
        .atlasw-eyes span{animation:atlasw-blink 4.2s ease-in-out infinite;transform-origin:center}
        .atlasw-spark{animation:atlasw-twinkle 2.1s ease-in-out infinite}
        .atlasw-spark2{animation-delay:.7s}
        .atlasw-spark3{animation-delay:1.3s}
        .atlasw-roll{animation:atlasw-roll 9s ease-in-out infinite}
        .atlasw-rise{opacity:0;animation:atlasw-rise .5s ease-out forwards}
        @media (prefers-reduced-motion: reduce){
          .atlasw-avatar,.atlasw-ping,.atlasw-eyes span,.atlasw-spark,.atlasw-roll,.atlasw-rise{animation:none!important;opacity:1!important}
        }
      `}</style>

      <div className="rounded-2xl border border-border bg-gradient-to-b from-brand-50/70 to-surface p-6 dark:from-brand-950/30">
        {/* Animated Atlas avatar */}
        <div className="relative mb-5 h-[88px] w-[88px]">
          <span className="atlasw-ping absolute inset-0 rounded-full border-2 border-brand-400/50" />
          <span className="atlasw-ping atlasw-ping2 absolute inset-0 rounded-full border-2 border-brand-400/40" />
          <div className="atlasw-avatar absolute inset-1 flex flex-col items-center justify-center rounded-full bg-brand-600 shadow-lg">
            <div className="atlasw-eyes flex gap-2.5">
              <span className="block h-2.5 w-2.5 rounded-full bg-white" />
              <span className="block h-2.5 w-2.5 rounded-full bg-white" />
            </div>
            <div className="mt-1.5 h-2.5 w-5 rounded-b-full border-b-[3px] border-white/95" />
          </div>
          <Sparkles className="atlasw-spark absolute -right-1 -top-1 h-4 w-4 text-amber-400" />
          <Sparkles className="atlasw-spark atlasw-spark2 absolute -left-2 top-6 h-3 w-3 text-brand-400" />
          <Sparkles className="atlasw-spark atlasw-spark3 absolute -bottom-1 right-3 h-3 w-3 text-amber-300" />
        </div>

        <h2 className="font-display text-2xl font-semibold leading-tight">
          Hi, I&rsquo;m Atlas
        </h2>
        <p className="mt-0.5 text-sm text-text-muted">
          your AI transaction coordinator
        </p>

        {/* Status ticker */}
        <div className="mt-3 h-[22px] overflow-hidden text-sm font-medium text-brand-600 dark:text-brand-300">
          <ul className="atlasw-roll m-0 list-none p-0">
            <li className="flex h-[22px] items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5" /> Reading your contract&hellip;
            </li>
            <li className="flex h-[22px] items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5" /> Pulling every deadline&hellip;
            </li>
            <li className="flex h-[22px] items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5" /> Building your timeline&hellip;
            </li>
            <li className="flex h-[22px] items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5" /> Reading your contract&hellip;
            </li>
          </ul>
        </div>

        {/* Benefits */}
        <ul className="mt-5 space-y-3.5">
          {BULLETS.map((b, i) => {
            const Icon = b.icon;
            return (
              <li
                key={b.title}
                className="atlasw-rise flex items-start gap-3"
                style={{ animationDelay: `${0.15 + i * 0.12}s` }}
              >
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 ring-1 ring-brand-100 dark:bg-brand-950/40 dark:ring-brand-900/40">
                  <Icon className="h-4 w-4" />
                </span>
                <span>
                  <span className="block text-sm font-semibold text-text">
                    {b.title}
                  </span>
                  <span className="block text-xs text-text-muted">
                    {b.hint}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
