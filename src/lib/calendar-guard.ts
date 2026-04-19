/**
 * Google Calendar API runtime kill-switch.
 *
 * Per the SafeIntegrationGuard pattern: block every destructive method
 * on the Calendar client at call time, regardless of what the app code
 * tries to do. Layer 2 on top of OAuth scope minimization.
 *
 * We intentionally block `events.delete` and `calendars.delete` even
 * though our code only creates events — a future bug or refactor must
 * not be able to remove events or entire calendars. Applying labels and
 * creating events are allowed.
 */

import { google, type calendar_v3 } from "googleapis";
import type { OAuth2Client } from "google-auth-library";

/**
 * Dot-paths into the Calendar v3 client that must never execute.
 * See https://developers.google.com/calendar/api/v3/reference for the full
 * surface area.
 */
const BLOCKED_PATHS: readonly string[] = [
  // events
  "events.delete",
  "events.move", // transfers an event to a different calendar
  // calendars
  "calendars.delete",
  "calendars.clear", // wipes ALL events on a calendar
  // calendarList
  "calendarList.delete",
  // acl (sharing permissions)
  "acl.delete",
  "acl.insert", // creates a new sharing permission — not needed, safer to block
  "acl.patch",
  "acl.update",
] as const;

export class CalendarGuardError extends Error {
  constructor(methodPath: string) {
    super(
      `CalendarGuard: blocked destructive Calendar API call "${methodPath}". ` +
        `Allowed: list, get, insert (events), patch (events non-destructive fields).`,
    );
    this.name = "CalendarGuardError";
  }
}

function installGuards(client: calendar_v3.Calendar): void {
  for (const path of BLOCKED_PATHS) {
    const segments = path.split(".");
    let obj: unknown = client;
    for (let i = 0; i < segments.length - 1; i++) {
      if (!obj || typeof obj !== "object") break;
      obj = (obj as Record<string, unknown>)[segments[i]];
    }
    if (!obj || typeof obj !== "object") continue;
    const parent = obj as Record<string, unknown>;
    const method = segments[segments.length - 1];
    if (typeof parent[method] !== "function") continue;

    Object.defineProperty(parent, method, {
      value: () => {
        throw new CalendarGuardError(path);
      },
      writable: false,
      configurable: true,
      enumerable: false,
    });
  }
}

/**
 * Create a Calendar v3 client that is provably unable to delete events /
 * calendars / permissions. Use this instead of `google.calendar(...)`.
 */
export function makeSafeCalendar(auth: OAuth2Client): calendar_v3.Calendar {
  const client = google.calendar({ version: "v3", auth });
  installGuards(client);
  return client;
}

export const _BLOCKED_PATHS = BLOCKED_PATHS;
