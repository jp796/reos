"use client";

/**
 * AtlasWorking — the "Atlas is building something" loader.
 *
 * Shown on every step where the AI is generating: reading the contract,
 * building the timeline, creating the compliance checklist, generating
 * tasks. A calm brand-blue radar pulse + a labeled status, so the user
 * always sees Atlas working rather than a frozen screen.
 *
 * Pure CSS animation, no deps. Respects prefers-reduced-motion.
 */

export function AtlasWorking({
  label,
  sublabel,
}: {
  label: string;
  sublabel?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-5 py-20 text-center">
      <style>{`
        @keyframes atw-radar { 0%{transform:scale(.85);opacity:.6} 80%,100%{transform:scale(1.45);opacity:0} }
        @keyframes atw-breathe { 0%,100%{transform:scale(1)} 50%{transform:scale(1.06)} }
        @keyframes atw-dot { 0%,100%{transform:scale(.9);opacity:.7} 50%{transform:scale(1.1);opacity:1} }
        @keyframes atw-ell { 0%{opacity:.2} 50%{opacity:1} 100%{opacity:.2} }
        .atw-radar{animation:atw-radar 2.2s ease-out infinite}
        .atw-radar2{animation-delay:1.1s}
        .atw-mid{animation:atw-breathe 2.2s ease-in-out infinite}
        .atw-core{animation:atw-dot 2.2s ease-in-out infinite}
        .atw-e{animation:atw-ell 1.4s ease-in-out infinite}
        .atw-e2{animation-delay:.2s}
        .atw-e3{animation-delay:.4s}
        @media (prefers-reduced-motion: reduce){
          .atw-radar,.atw-mid,.atw-core,.atw-e{animation:none!important}
        }
      `}</style>

      <div className="relative h-24 w-24">
        {/* expanding radar rings */}
        <span className="atw-radar absolute inset-0 rounded-full border-2 border-brand-400/60" />
        <span className="atw-radar atw-radar2 absolute inset-0 rounded-full border-2 border-brand-400/50" />
        {/* steady breathing mid ring */}
        <span className="atw-mid absolute inset-[18px] rounded-full border-[3px] border-brand-500" />
        {/* pulsing core */}
        <span className="atw-core absolute left-1/2 top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-600" />
      </div>

      <div>
        <div className="text-base font-medium text-text">
          {label}
          <span className="atw-e">.</span>
          <span className="atw-e atw-e2">.</span>
          <span className="atw-e atw-e3">.</span>
        </div>
        {sublabel ? (
          <div className="mt-1 text-sm text-text-muted">{sublabel}</div>
        ) : null}
      </div>
    </div>
  );
}
