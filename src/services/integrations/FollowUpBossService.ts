/**
 * FollowUpBossService
 *
 * Ported from architecture artifact with fixes:
 *  - Auth is HTTP Basic (apiKey + empty password), NOT Bearer
 *    (the original artifact used `Authorization: Bearer` which 401s against
 *    the real FUB API)
 *  - PrismaClient imported properly
 *  - Error narrowing for `error.message` / `error.code` done safely
 *  - JSON-typed `customFields` / tags properly cast for Prisma
 *
 * Reference: https://docs.followupboss.com/reference
 */

import { EventEmitter } from "node:events";
import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import type {
  FUBContact,
  FUBDeal,
  FUBTask,
  FUBNote,
  FUBPerson,
  FUBCustomField,
  FUBWebhookPayload,
} from "@/types/integrations";
import { IntegrationError } from "@/types";

// ==================================================
// CONFIG
// ==================================================

export interface FUBApiConfig {
  apiKey: string;
  systemKey: string;
  baseUrl?: string;
  webhookSecret?: string;
  rateLimitDelayMs?: number;
}

export interface FUBSyncResult {
  peopleProcessed: number;
  dealsProcessed: number;
  tasksProcessed: number;
  notesProcessed: number;
  errors: Array<{ type: string; entity: string; id: string; error: string }>;
  lastSyncTimestamp: string;
}

// ==================================================
// AUDIT
// ==================================================

export interface AuditLogInput {
  accountId: string;
  transactionId: string | null;
  entityType: string;
  entityId: string | null;
  ruleName: string;
  actionType: string;
  sourceType: string;
  confidenceScore: number;
  decision: "applied" | "suggested" | "rejected" | "failed";
  beforeJson: Prisma.InputJsonValue | null;
  afterJson: Prisma.InputJsonValue | null;
}

export class AutomationAuditService {
  constructor(private readonly db: PrismaClient) {}

  async logAction(log: AuditLogInput): Promise<void> {
    await this.db.automationAuditLog.create({
      data: {
        accountId: log.accountId,
        transactionId: log.transactionId,
        entityType: log.entityType,
        entityId: log.entityId,
        ruleName: log.ruleName,
        actionType: log.actionType,
        sourceType: log.sourceType,
        confidenceScore: log.confidenceScore,
        decision: log.decision,
        beforeJson: log.beforeJson ?? Prisma.JsonNull,
        afterJson: log.afterJson ?? Prisma.JsonNull,
      },
    });
  }
}

// ==================================================
// SERVICE
// ==================================================

const DEFAULT_BASE_URL = "https://api.followupboss.com/v1";
const DEFAULT_RATE_LIMIT_MS = 100;

export class FollowUpBossService extends EventEmitter {
  private readonly baseUrl: string;
  private readonly rateLimitDelayMs: number;
  private lastSyncTimestamp?: string;

  constructor(
    private readonly accountId: string,
    private readonly config: FUBApiConfig,
    private readonly db: PrismaClient,
    private readonly auditService: AutomationAuditService,
  ) {
    super();
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.rateLimitDelayMs = config.rateLimitDelayMs ?? DEFAULT_RATE_LIMIT_MS;
  }

  // --------------------------------------------------
  // HTTP
  // --------------------------------------------------

  /**
   * FUB auth: HTTP Basic with apiKey as the username and an empty password.
   * `X-System` identifies the integration.
   */
  private authHeader(): string {
    const token = Buffer.from(`${this.config.apiKey}:`).toString("base64");
    return `Basic ${token}`;
  }

  private async apiRequest<T = unknown>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    body?: unknown,
    query?: Record<string, string | number | boolean | undefined>,
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined) url.searchParams.set(k, String(v));
      }
    }

    const res = await fetch(url.toString(), {
      method,
      headers: {
        Authorization: this.authHeader(),
        "X-System": this.config.systemKey,
        "Content-Type": "application/json",
        "User-Agent": "real-estate-os/0.1",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new IntegrationError(
        "FollowUpBoss",
        `${method} ${path}`,
        `HTTP ${res.status}: ${text}`,
      );
    }

    return (await res.json()) as T;
  }

  // --------------------------------------------------
  // Connection
  // --------------------------------------------------

  async validateConnection(): Promise<boolean> {
    try {
      await this.apiRequest("GET", "/people", undefined, { limit: 1 });
      return true;
    } catch (err) {
      console.error("FUB connection validation failed:", err);
      return false;
    }
  }

  // --------------------------------------------------
  // Custom fields
  // --------------------------------------------------

  async getCustomFields(): Promise<FUBCustomField[]> {
    const res = await this.apiRequest<{ customFields?: FUBCustomField[] }>(
      "GET",
      "/customFields",
    );
    return res.customFields ?? [];
  }

  // --------------------------------------------------
  // People
  // --------------------------------------------------

  async searchPeople(query: {
    name?: string;
    email?: string;
    phone?: string;
    tag?: string;
    source?: string;
    assignedTo?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ people: FUBPerson[]; total: number; hasMore: boolean }> {
    const res = await this.apiRequest<{
      people?: FUBPerson[];
      total?: number;
      hasMore?: boolean;
    }>("GET", "/people", undefined, {
      limit: query.limit ?? 50,
      offset: query.offset ?? 0,
      name: query.name,
      email: query.email,
      phone: query.phone,
      tag: query.tag,
      source: query.source,
      assignedTo: query.assignedTo,
    });
    return {
      people: res.people ?? [],
      total: res.total ?? 0,
      hasMore: res.hasMore ?? false,
    };
  }

  async getPerson(personId: string): Promise<FUBPerson | null> {
    try {
      const res = await this.apiRequest<{ person?: FUBPerson }>(
        "GET",
        `/people/${personId}`,
      );
      return res.person ?? null;
    } catch (err) {
      if (err instanceof IntegrationError && err.message.includes("404")) {
        return null;
      }
      throw err;
    }
  }

  async updatePersonTags(personId: string, tags: string[]): Promise<void> {
    await this.auditService.logAction({
      accountId: this.accountId,
      transactionId: null,
      entityType: "fub_tag",
      entityId: personId,
      ruleName: "manual_tag_update",
      actionType: "update",
      sourceType: "manual",
      confidenceScore: 1.0,
      decision: "applied",
      beforeJson: null,
      afterJson: { tags } as Prisma.InputJsonValue,
    });
    await this.apiRequest("PUT", `/people/${personId}`, { tags });
  }

  async addPersonTag(personId: string, tag: string): Promise<void> {
    const person = await this.getPerson(personId);
    if (!person) throw new IntegrationError("FollowUpBoss", "addPersonTag", `Person ${personId} not found`);
    const current = person.tags ?? [];
    if (!current.includes(tag)) {
      await this.updatePersonTags(personId, [...current, tag]);
    }
  }

  async removePersonTag(personId: string, tag: string): Promise<void> {
    const person = await this.getPerson(personId);
    if (!person) throw new IntegrationError("FollowUpBoss", "removePersonTag", `Person ${personId} not found`);
    const current = person.tags ?? [];
    const next = current.filter((t) => t !== tag);
    if (next.length !== current.length) {
      await this.updatePersonTags(personId, next);
    }
  }

  // --------------------------------------------------
  // Notes
  // --------------------------------------------------

  async createNote(input: {
    personId?: string;
    dealId?: string;
    content: string;
    isPrivate?: boolean;
  }): Promise<FUBNote> {
    const body = {
      body: input.content,
      type: "note",
      private: input.isPrivate ?? false,
    };
    const endpoint = input.dealId
      ? `/deals/${input.dealId}/notes`
      : `/people/${input.personId}/notes`;
    const res = await this.apiRequest<{ note: FUBNote }>(
      "POST",
      endpoint,
      body,
    );
    return res.note;
  }

  // --------------------------------------------------
  // Tasks
  // --------------------------------------------------

  async createTask(input: {
    personId: string;
    dealId?: string;
    title: string;
    description?: string;
    dueDate?: Date;
    assignedTo?: string;
    priority?: string;
  }): Promise<FUBTask> {
    const body: Record<string, unknown> = {
      title: input.title,
      description: input.description,
      assignedTo: input.assignedTo,
      priority: input.priority,
    };
    if (input.dueDate) body.dueDate = input.dueDate.toISOString();
    const endpoint = input.dealId
      ? `/deals/${input.dealId}/tasks`
      : `/people/${input.personId}/tasks`;
    const res = await this.apiRequest<{ task: FUBTask }>(
      "POST",
      endpoint,
      body,
    );
    return res.task;
  }

  // --------------------------------------------------
  // Sync
  // --------------------------------------------------

  async syncAllData(): Promise<FUBSyncResult> {
    const startedAt = new Date().toISOString();
    const result: FUBSyncResult = {
      peopleProcessed: 0,
      dealsProcessed: 0,
      tasksProcessed: 0,
      notesProcessed: 0,
      errors: [],
      lastSyncTimestamp: startedAt,
    };
    try {
      const people = await this.syncPeople();
      result.peopleProcessed = people.processed;
      result.errors.push(...people.errors);
      this.lastSyncTimestamp = startedAt;
      this.emit("syncComplete", result);
      return result;
    } catch (err) {
      this.emit("syncError", err);
      throw err;
    }
  }

  private async syncPeople(): Promise<{
    processed: number;
    errors: FUBSyncResult["errors"];
  }> {
    let processed = 0;
    const errors: FUBSyncResult["errors"] = [];
    let offset = 0;
    const limit = 100;

    while (true) {
      const { people, hasMore } = await this.searchPeople({ limit, offset });
      if (people.length === 0) break;
      for (const person of people) {
        try {
          await this.upsertPerson(person);
          processed++;
        } catch (err) {
          errors.push({
            type: "person_sync",
            entity: "person",
            id: person.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      if (!hasMore) break;
      offset += limit;
      await new Promise((r) => setTimeout(r, this.rateLimitDelayMs));
    }
    return { processed, errors };
  }

  private async upsertPerson(person: FUBPerson): Promise<void> {
    const primaryEmail =
      person.emails.find((e) => e.primary)?.value ?? person.emails[0]?.value;
    const primaryPhone =
      person.phones.find((p) => p.primary)?.value ?? person.phones[0]?.value;

    await this.db.contact.upsert({
      where: { fubPersonId: person.id },
      update: {
        fullName: person.name,
        primaryEmail,
        primaryPhone,
        assignedAgentName: person.assignedTo,
        sourceName: person.source,
        tagsJson: (person.tags ?? []) as Prisma.InputJsonValue,
        rawFubPayloadJson: person as unknown as Prisma.InputJsonValue,
      },
      create: {
        accountId: this.accountId,
        fubPersonId: person.id,
        fullName: person.name,
        primaryEmail,
        primaryPhone,
        assignedAgentName: person.assignedTo,
        sourceName: person.source,
        tagsJson: (person.tags ?? []) as Prisma.InputJsonValue,
        rawFubPayloadJson: person as unknown as Prisma.InputJsonValue,
      },
    });
  }

  // --------------------------------------------------
  // Webhook
  // --------------------------------------------------

  async handleWebhook(payload: FUBWebhookPayload): Promise<void> {
    this.emit("webhookReceived", payload);
    try {
      switch (payload.type) {
        case "person.created":
        case "person.updated":
          if (payload.data.person) {
            // Note: webhook payload uses FUBContact shape, which is a thinner
            // view than FUBPerson. For completeness, refetch by ID.
            const full = await this.getPerson(payload.data.person.id);
            if (full) await this.upsertPerson(full);
            this.emit("personSynced", payload.data.person);
          }
          break;

        case "deal.created":
        case "deal.updated":
          if (payload.data.deal) {
            await this.handleDealWebhook(payload.data.deal);
            this.emit("dealSynced", payload.data.deal);
          }
          break;

        case "task.created":
        case "task.updated":
          if (payload.data.task) {
            await this.handleTaskWebhook(payload.data.task);
            this.emit("taskSynced", payload.data.task);
          }
          break;

        default:
          console.log(`Unhandled FUB webhook type: ${payload.type}`);
      }
    } catch (err) {
      console.error("FUB webhook handling error:", err);
      this.emit("webhookError", { payload, error: err });
    }
  }

  private async handleDealWebhook(deal: FUBDeal): Promise<void> {
    const contact = await this.db.contact.findUnique({
      where: { fubPersonId: deal.personId },
    });
    if (!contact) return;

    const txn = await this.db.transaction.findFirst({
      where: { contactId: contact.id },
    });
    if (!txn) return;

    await this.db.transaction.update({
      where: { id: txn.id },
      data: {
        fubDealId: deal.id,
        pipelineName: deal.pipeline,
        stageName: deal.stage,
        lastSyncedAt: new Date(),
      },
    });
  }

  private async handleTaskWebhook(task: FUBTask): Promise<void> {
    if (!task.personId) return;
    const contact = await this.db.contact.findUnique({
      where: { fubPersonId: task.personId },
    });
    if (!contact) return;
    const txn = await this.db.transaction.findFirst({
      where: { contactId: contact.id },
    });
    if (!txn) return;

    await this.db.task.upsert({
      where: { fubTaskId: task.id },
      update: {
        title: task.title,
        description: task.description,
        dueAt: task.dueDate ? new Date(task.dueDate) : null,
        completedAt: task.completed ? new Date() : null,
        assignedTo: task.assignedTo,
        syncStatus: "synced",
      },
      create: {
        transactionId: txn.id,
        fubTaskId: task.id,
        title: task.title,
        description: task.description,
        dueAt: task.dueDate ? new Date(task.dueDate) : null,
        completedAt: task.completed ? new Date() : null,
        assignedTo: task.assignedTo,
        syncStatus: "synced",
      },
    });
  }
}
