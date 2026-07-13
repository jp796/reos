"use client";

/**
 * Trace runner (REOS_05 prototype). Reveals a sequence of facts one at a time
 * so each source→result transformation reads as a discrete, causal step.
 *
 * Truthfulness: this is a PROTOTYPE driver over sample data. It never claims
 * to be live backend progress. Under prefers-reduced-motion it commits every
 * fact immediately (no scan/flying motion) — provenance persists either way,
 * so reduced-motion users get equivalent information.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { MOTION_TOTAL } from "./traceTokens";

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

export interface TraceRunner {
  /** number of facts committed (fully landed, provenance visible) */
  revealed: number;
  /** the fact index currently animating, or -1 when idle/done */
  active: number;
  running: boolean;
  done: boolean;
  reducedMotion: boolean;
  play: () => void;
  pause: () => void;
  /** commit everything now (Skip animation / Show all results) */
  showAll: () => void;
  replay: () => void;
  /** the most recently committed fact index, for a live-region announcement */
  lastCommitted: number;
}

export function useTraceRunner(
  total: number,
  opts?: { perFactMs?: number; autostart?: boolean },
): TraceRunner {
  const reducedMotion = usePrefersReducedMotion();
  const perFact = opts?.perFactMs ?? Math.max(520, MOTION_TOTAL * 0.5);
  const [revealed, setRevealed] = useState(0);
  const [active, setActive] = useState(-1);
  const [running, setRunning] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const step = useCallback(
    (i: number) => {
      if (i >= total) {
        setActive(-1);
        setRunning(false);
        return;
      }
      setActive(i);
      timer.current = setTimeout(() => {
        setRevealed(i + 1);
        setActive(-1);
        step(i + 1);
      }, perFact);
    },
    [total, perFact],
  );

  const play = useCallback(() => {
    if (reducedMotion) {
      setRevealed(total);
      setActive(-1);
      setRunning(false);
      return;
    }
    if (revealed >= total) return;
    setRunning(true);
    step(revealed);
  }, [reducedMotion, revealed, total, step]);

  const pause = useCallback(() => {
    clear();
    setRunning(false);
    setActive(-1);
  }, []);

  const showAll = useCallback(() => {
    clear();
    setRevealed(total);
    setActive(-1);
    setRunning(false);
  }, [total]);

  const replay = useCallback(() => {
    clear();
    setRevealed(0);
    setActive(-1);
    if (reducedMotion) {
      setRevealed(total);
      return;
    }
    setRunning(true);
    // let state flush, then start from 0
    timer.current = setTimeout(() => step(0), 60);
  }, [reducedMotion, total, step]);

  // Autostart once (respecting reduced motion).
  useEffect(() => {
    if (!opts?.autostart) return;
    if (reducedMotion) {
      setRevealed(total);
      return;
    }
    setRunning(true);
    step(0);
    return clear;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducedMotion]);

  useEffect(() => clear, []);

  return {
    revealed,
    active,
    running,
    done: revealed >= total,
    reducedMotion,
    play,
    pause,
    showAll,
    replay,
    lastCommitted: revealed - 1,
  };
}
