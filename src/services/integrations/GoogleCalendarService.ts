/**
 * GoogleCalendarService
 *
 * Phase 2 Week 5 — Google Calendar integration.
 * - Uses makeSafeCalendar (see src/lib/calendar-guard.ts). Destructive
 *   methods throw at call time; only list/get/insert/patch/update work.
 * - Private-ops calendar is the user's primary calendar unless they
 *   configure a separate Google calendar for internal reminders in
 *   account settings.
 * - Milestone-to-event sync is idempotent: each Milestone row stores the
 *   googleEventId via a linked CalendarEvent row, so re-running doesn't
 *   duplicate.
 */

import type { calendar_v3 } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import type { PrismaClient, Prisma, Milestone, Transaction } from "@prisma/client";
import type { CalendarType, CalendarSource } from "@/types";
import { makeSafeCalendar } from "@/lib/calendar-guard";

export interface GoogleCalendarConfig {
  primaryCalendarId: string;
  privateOpsCalendarId?: string;
  /** How much lead-time (minutes) to add as an "all-day" default for
   *  reminder events that don't have a natural duration. */
  defaultReminderDurationMinutes?: number;
}

export interface CreateCalendarEventInput {
  accountId: string;
  transactionId?: string;
  milestoneId?: string;
  calendarType: CalendarType;
  title: string;
  startAt: Date;
  endAt: Date;
  location?: string;
  description?: string;
  attendees?: Array<{ email: string; displayName?: string }>;
  source?: CalendarSource;
  /** Mark as private so it won't be visible to anyone the calendar is shared with. */
  visibility?: "default" | "private" | "public";
}

export interface MilestoneSyncResult {
  transactionId: string;
  attempted: number;
  created: number;
  alreadyLinked: number;
  skipped: number;
  errors: Array<{ milestoneId: string; error: string }>;
  details: Array<{
    milestoneId: string;
    milestoneLabel: string;
    dueAt: string | null;
    status: "created" | "already-linked" | "skipped" | "error";
    googleEventId?: string;
  }>;
}

export class GoogleCalendarService {
  private readonly calendar: calendar_v3.Calendar;

  constructor(
    auth: OAuth2Client,
    private readonly config: GoogleCalendarConfig,
    private readonly db: PrismaClient,
  ) {
    this.calendar = makeSafeCalendar(auth);
  }

  private calendarIdFor(type: CalendarType): string {
    if (type === "private_ops" && this.config.privateOpsCalendarId) {
      return this.config.privateOpsCalendarId;
    }
    return this.config.primaryCalendarId;
  }

  // --------------------------------------------------
  // Public API
  // --------------------------------------------------

  async listEvents(window: {
    from: Date;
    to: Date;
    calendarId?: string;
  }): Promise<calendar_v3.Schema$Event[]> {
    const res = await this.calendar.events.list({
      calendarId: window.calendarId ?? this.config.primaryCalendarId,
      timeMin: window.from.toISOString(),
      timeMax: window.to.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 500,
    });
    return res.data.items ?? [];
  }

  async createEvent(input: CreateCalendarEventInput) {
    const calendarId = this.calendarIdFor(input.calendarType);
    const res = await this.calendar.events.insert({
      calendarId,
      requestBody: {
        summary: input.title,
        description: input.description,
        location: input.location,
        start: { dateTime: input.startAt.toISOString() },
        end: { dateTime: input.endAt.toISOString() },
        attendees: input.attendees,
        visibility: input.visibility ?? "private",
        transparency: "opaque",
        source: { title: "Real Estate OS", url: "http://localhost:3000" },
      },
    });
    const gEvent = res.data;
    if (!gEvent.id) {
      throw new Error("Google Calendar did not return an event ID");
    }

    const row = await this.db.calendarEvent.create({
      data: {
        accountId: input.accountId,
        transactionId: input.transactionId ?? null,
        milestoneId: input.milestoneId ?? null,
        googleEventId: gEvent.id,
        calendarType: input.calendarType,
        title: input.title,
        startAt: input.startAt,
        endAt: input.endAt,
        location: input.location ?? null,
        description: input.description ?? null,
        attendeesJson: (input.attendees ?? []) as Prisma.InputJsonValue,
        createdByApp: true,
        source: input.source ?? null,
        rawPayloadJson: gEvent as unknown as Prisma.InputJsonValue,
      },
    });

    return { googleEvent: gEvent, localEvent: row };
  }

  // --------------------------------------------------
  // Milestone sync
  // --------------------------------------------------

  /**
   * Push every milestone on a transaction into the private-ops calendar
   * as a 30-minute reminder event. Idempotent per milestone — if a
   * milestone already has a linked CalendarEvent row, skip.
   */
  async syncTransactionMilestones(
    transaction: Transaction & { milestones: Milestone[]; contact?: { fullName: string } | null },
    options: { calendarType?: CalendarType } = {},
  ): Promise<MilestoneSyncResult> {
    const result: MilestoneSyncResult = {
      transactionId: transaction.id,
      attempted: 0,
      created: 0,
      alreadyLinked: 0,
      skipped: 0,
      errors: [],
      details: [],
    };

    const calendarType = options.calendarType ?? "private_ops";
    const durationMin = this.config.defaultReminderDurationMinutes ?? 30;

    // Dedup by milestoneId when available; fall back to (transactionId,
    // startAt) match for legacy rows created before milestoneId existed,
    // and backfill the milestoneId while we're at it.
    const linked = await this.db.calendarEvent.findMany({
      where: {
        accountId: transaction.accountId,
        transactionId: transaction.id,
        source: "milestone_auto",
        status: "active",
      },
      select: { id: true, milestoneId: true, startAt: true, title: true },
    });

    const linkedMilestoneIds = new Set(
      linked.map((e) => e.milestoneId).filter((x): x is string => !!x),
    );

    // Backfill: any active milestone_auto row without a milestoneId gets
    // matched by (startAt ISO + milestone.label substring in title).
    const unlinkedLegacy = linked.filter((e) => !e.milestoneId);
    if (unlinkedLegacy.length > 0) {
      for (const ms of transaction.milestones) {
        if (linkedMilestoneIds.has(ms.id)) continue;
        if (!ms.dueAt) continue; // undated milestones have no calendar row to match
        const msDueIso = ms.dueAt.toISOString();
        const candidate = unlinkedLegacy.find(
          (e) =>
            e.startAt.toISOString() === msDueIso &&
            e.title.includes(ms.label),
        );
        if (candidate) {
          await this.db.calendarEvent.update({
            where: { id: candidate.id },
            data: { milestoneId: ms.id },
          });
          linkedMilestoneIds.add(ms.id);
        }
      }
    }

    for (const ms of transaction.milestones) {
      result.attempted++;

      // Skip milestones with no scheduled date — they're checklist
      // placeholders that shouldn't create calendar entries until a
      // real date is set.
      if (!ms.dueAt) {
        result.skipped++;
        result.details.push({
          milestoneId: ms.id,
          milestoneLabel: ms.label,
          dueAt: null,
          status: "skipped",
        });
        continue;
      }

      if (linkedMilestoneIds.has(ms.id)) {
        result.alreadyLinked++;
        result.details.push({
          milestoneId: ms.id,
          milestoneLabel: ms.label,
          dueAt: ms.dueAt.toISOString(),
          status: "already-linked",
        });
        continue;
      }

      // Skip milestones already completed
      if (ms.completedAt) {
        result.skipped++;
        result.details.push({
          milestoneId: ms.id,
          milestoneLabel: ms.label,
          dueAt: ms.dueAt.toISOString(),
          status: "skipped",
        });
        continue;
      }

      const contactName = transaction.contact?.fullName ?? "";
      const propAddress = transaction.propertyAddress ?? "";
      const title = [
        "[REOS]",
        ms.label,
        contactName && `— ${contactName}`,
        propAddress && `· ${propAddress}`,
      ]
        .filter(Boolean)
        .join(" ")
        .trim();

      const startAt = new Date(ms.dueAt);
      const endAt = new Date(startAt.getTime() + durationMin * 60 * 1000);

      try {
        const { googleEvent } = await this.createEvent({
          accountId: transaction.accountId,
          transactionId: transaction.id,
          milestoneId: ms.id,
          calendarType,
          title,
          startAt,
          endAt,
          description: [
            `Real Estate OS milestone: ${ms.label}`,
            `Transaction: ${transaction.id}`,
            ms.ownerRole && `Owner: ${ms.ownerRole}`,
            `Due: ${ms.dueAt.toISOString()}`,
          ]
            .filter(Boolean)
            .join("\n"),
          source: "milestone_auto",
          visibility: "private",
        });
        result.created++;
        result.details.push({
          milestoneId: ms.id,
          milestoneLabel: ms.label,
          dueAt: ms.dueAt.toISOString(),
          status: "created",
          googleEventId: googleEvent.id ?? undefined,
        });
      } catch (err) {
        result.errors.push({
          milestoneId: ms.id,
          error: err instanceof Error ? err.message : String(err),
        });
        result.details.push({
          milestoneId: ms.id,
          milestoneLabel: ms.label,
          dueAt: ms.dueAt.toISOString(),
          status: "error",
        });
      }
    }

    return result;
  }

  /**
   * Clean up duplicate milestone events. Groups active milestone_auto
   * events by (transactionId, startAt, title) — for any group with more
   * than one event, keeps the most recent and cancels the older ones
   * via events.patch (events.delete is blocked by calendar-guard).
   * Idempotent — running twice is safe.
   */
  async cleanupMilestoneDuplicates(accountId: string): Promise<{
    groups: number;
    cancelled: number;
    errors: Array<{ eventId: string; error: string }>;
  }> {
    const rows = await this.db.calendarEvent.findMany({
      where: {
        accountId,
        source: "milestone_auto",
        status: "active",
        googleEventId: { not: null },
      },
      orderBy: { createdAt: "asc" },
    });

    // Group by (transactionId, startAt-iso, title)
    const groups = new Map<string, typeof rows>();
    for (const r of rows) {
      const key = `${r.transactionId ?? "_"}|${r.startAt.toISOString()}|${r.title}`;
      const list = groups.get(key) ?? [];
      list.push(r);
      groups.set(key, list);
    }

    const result = { groups: 0, cancelled: 0, errors: [] as { eventId: string; error: string }[] };

    for (const [, members] of groups) {
      if (members.length <= 1) continue;
      result.groups++;
      // Keep the NEWEST row (last one), cancel the rest. Prefer rows
      // that already have milestoneId set as the keeper if any exist.
      const withMs = members.filter((m) => m.milestoneId);
      const keeper =
        withMs.length > 0 ? withMs[withMs.length - 1] : members[members.length - 1];
      for (const m of members) {
        if (m.id === keeper.id) continue;
        try {
          if (m.googleEventId) {
            await this.calendar.events.patch({
              calendarId: this.config.primaryCalendarId,
              eventId: m.googleEventId,
              requestBody: { status: "cancelled" },
            });
          }
          await this.db.calendarEvent.update({
            where: { id: m.id },
            data: { status: "cancelled" },
          });
          result.cancelled++;
        } catch (err) {
          result.errors.push({
            eventId: m.googleEventId ?? m.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    return result;
  }
}
