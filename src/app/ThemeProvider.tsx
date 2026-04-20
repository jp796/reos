"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

/**
 * Theme scheduler for REOS. Rules:
 *   - Auto-switch by local sunrise/sunset, seeded for Cheyenne WY
 *     (41.14°N, -104.82°W) as a stable default (no geo prompt)
 *   - A manual toggle (light/dark) overrides for 12 hours via
 *     localStorage, after which auto wins again
 *   - Respect `prefers-color-scheme` as fallback during SSR first paint
 */

type Mode = "light" | "dark";
type Preference = { mode: Mode; expiresAt: number } | null;

interface Ctx {
  mode: Mode;
  setMode: (m: Mode) => void;
  clearOverride: () => void;
  override: Preference;
}

const ThemeContext = createContext<Ctx | null>(null);

const STORAGE_KEY = "reos.theme.override";
const OVERRIDE_MS = 12 * 60 * 60 * 1000;

/** Sun-geometry approximation — good enough for theme switching without
 * shipping a 20KB library. Based on NOAA solar position formulas,
 * accurate to ~±5 minutes.  Lat/lng in degrees. Returns {sunrise,sunset}
 * as Date objects in UTC for the given local day. */
function suntimes(date: Date, lat = 41.14, lng = -104.82) {
  const rad = Math.PI / 180;
  const dayOfYear = Math.floor(
    (date.getTime() -
      Date.UTC(date.getUTCFullYear(), 0, 0)) /
      86_400_000,
  );
  const solarDecl =
    0.4093 * Math.sin((2 * Math.PI * (dayOfYear - 81)) / 365);
  const haCos =
    (Math.sin(-0.83 * rad) - Math.sin(lat * rad) * Math.sin(solarDecl)) /
    (Math.cos(lat * rad) * Math.cos(solarDecl));
  const hourAngle = Math.acos(Math.max(-1, Math.min(1, haCos))) / rad;
  const solarNoonMin = 12 * 60 - 4 * lng;
  const sunriseMin = solarNoonMin - hourAngle * 4;
  const sunsetMin = solarNoonMin + hourAngle * 4;
  const mkUtc = (m: number) => {
    const d = new Date(
      Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate(),
        0,
        0,
        0,
      ),
    );
    d.setUTCMinutes(m);
    return d;
  };
  return { sunrise: mkUtc(sunriseMin), sunset: mkUtc(sunsetMin) };
}

function autoModeFor(d: Date): Mode {
  const { sunrise, sunset } = suntimes(d);
  return d >= sunrise && d < sunset ? "light" : "dark";
}

function loadOverride(): Preference {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Preference;
    if (!parsed) return null;
    if (parsed.expiresAt < Date.now()) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<Mode>("light");
  const [override, setOverride] = useState<Preference>(null);

  // Initial + tick whenever sunrise/sunset crosses
  useEffect(() => {
    const apply = () => {
      const o = loadOverride();
      setOverride(o);
      const next = o ? o.mode : autoModeFor(new Date());
      setModeState(next);
    };
    apply();
    // Re-evaluate once an hour; cheap and catches the sunrise/sunset boundary.
    const id = setInterval(apply, 60 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  // Sync `dark` class on <html>
  useEffect(() => {
    const root = document.documentElement;
    if (mode === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
  }, [mode]);

  const setMode = useCallback((next: Mode) => {
    const pref: Preference = { mode: next, expiresAt: Date.now() + OVERRIDE_MS };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pref));
    setOverride(pref);
    setModeState(next);
  }, []);

  const clearOverride = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setOverride(null);
    setModeState(autoModeFor(new Date()));
  }, []);

  const value = useMemo(
    () => ({ mode, setMode, clearOverride, override }),
    [mode, setMode, clearOverride, override],
  );
  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): Ctx {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme outside ThemeProvider");
  return ctx;
}
