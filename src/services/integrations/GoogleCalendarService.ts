/**
 * GoogleCalendarService
 *
 * Scaffolded foundation (Phase 2 build-out).
 * Supports:
 *   - listing events in a window
 *   - creating client-safe and private-ops events
 *   - syncing events to local CalendarEvent rows tied to a transaction
 *
 * Private-ops vs client-safe is driven by which calendar the event is
 * written to (settings hold privateOpsCalendarId / primaryCalendarId).
 */

import { google, type calendar_v3 } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import type { PrismaClient, Prisma } from "@prisma/client";
import type { CalendarType, CalendarSource } from "@/types";

export interface GoogleCalendarConfig {
  primaryCalendarId: string;
  privateOpsCalendarId?: string;
}

export interface CreateCalendarEventInput {
  accountId: string;
  transactionId?: string;
  calendarType: CalendarType;
  title: string;
  startAt: Date;
  endAt: Date;
  location?: string;
  description?: string;
  attendees?: Array<{ email: string; displayName?: string }>;
  source?: CalendarSource;
}

export class GoogleCalendarService {
  private readonly calendar: calendar_v3.Calendar;

  constructor(
    auth: OAuth2Client,
    private readonly config: GoogleCalendarConfig,
    private readonly db: PrismaClient,
  ) {
    this.calendar = google.calendar({ version: "v3", auth });
  }

  private calendarIdFor(type: CalendarType): string {
    if (type === "private_ops" && this.config.privateOpsCalendarId) {
      return this.config.privateOpsCalendarId;
    }
    return this.config.primaryCalendarId;
  }

  async listEvents(window: { from: Date; to: Date; calendarId?: string }) {
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
}
