/**
 * Core domain types.
 * Re-exports base Prisma types and layers domain enums + input/output DTOs.
 */

import type { Prisma } from "@prisma/client";

// ==================================================
// BASE ENTITIES (Prisma-generated)
// ==================================================

export type Account = Prisma.AccountGetPayload<object>;
export type User = Prisma.UserGetPayload<object>;
export type Contact = Prisma.ContactGetPayload<object>;
export type Transaction = Prisma.TransactionGetPayload<object>;
export type Milestone = Prisma.MilestoneGetPayload<object>;
export type Task = Prisma.TaskGetPayload<object>;
export type Document = Prisma.DocumentGetPayload<object>;
export type ExtractedDate = Prisma.ExtractedDateGetPayload<object>;
export type CommunicationEvent = Prisma.CommunicationEventGetPayload<object>;
export type CalendarEvent = Prisma.CalendarEventGetPayload<object>;
export type AutomationAuditLog = Prisma.AutomationAuditLogGetPayload<object>;
export type SourceChannel = Prisma.SourceChannelGetPayload<object>;
export type MarketingSpend = Prisma.MarketingSpendGetPayload<object>;
export type TransactionAttribution = Prisma.TransactionAttributionGetPayload<object>;
export type TransactionFinancials = Prisma.TransactionFinancialsGetPayload<object>;

// ==================================================
// ENHANCED / COMPOUND TYPES
// ==================================================

export type TransactionWithRelations = Prisma.TransactionGetPayload<{
  include: {
    contact: true;
    milestones: true;
    tasks: true;
    documents: {
      include: { extractedDates: true };
    };
    communicationEvents: true;
    calendarEvents: true;
    attributions: {
      include: { sourceChannel: true };
    };
    financials: true;
  };
}>;

// ==================================================
// DOMAIN ENUMS (string unions — match Prisma string columns)
// ==================================================

export type TransactionStatus = "active" | "pending" | "closed" | "dead";
export type TransactionType =
  | "buyer"
  | "seller"
  | "investor"
  | "wholesale"
  | "other";
export type TransactionSide = "buy" | "sell" | "both";

export type MilestoneType =
  | "buyer_agreement_signed"
  | "under_contract"
  | "earnest_money_due"
  | "inspections_scheduled"
  | "inspection_objection_deadline"
  | "appraisal_ordered"
  | "financing_approved"
  | "title_commitment_received"
  | "closing_disclosure_review"
  | "final_walkthrough"
  | "closing"
  | "listing_agreement_signed"
  | "property_live"
  | "offer_received"
  | "inspection_response"
  | "appraisal_completed"
  | "title_issues_cleared"
  | "moving_prep"
  | "custom";

export type MilestoneStatus = "pending" | "completed" | "overdue" | "cancelled";
export type MilestoneOwnerRole =
  | "agent"
  | "lender"
  | "title"
  | "inspector"
  | "client"
  | "other";
export type MilestoneSource =
  | "manual"
  | "extracted"
  | "fub_sync"
  | "calendar_sync"
  | "ai_suggestion";

export type DocumentCategory =
  | "contract"
  | "addendum"
  | "amendment"
  | "inspection"
  | "appraisal"
  | "title"
  | "closing"
  | "financing"
  | "walkthrough"
  | "repair"
  | "other";

export type DocumentSource =
  | "upload"
  | "gmail_attachment"
  | "fub_attachment"
  | "drive_sync";

export type ExtractionStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed";

export type DateType =
  | "contract_date"
  | "closing_date"
  | "list_date"
  | "inspection_date"
  | "appraisal_date"
  | "financing_deadline"
  | "title_deadline"
  | "possession_date"
  | "earnest_money_due_date"
  | "walkthrough_date"
  | "repair_deadline"
  | "custom";

export type MatchStatus = "pending" | "matched" | "ignored" | "conflict";
export type SyncStatus = "pending" | "synced" | "rejected" | "failed";

export type CommunicationType = "email" | "call" | "text" | "meeting" | "note";
export type CommunicationSource =
  | "gmail"
  | "fub"
  | "calendar"
  | "manual"
  | "phone_system";

export type CalendarType = "private_ops" | "client_safe" | "external";
export type CalendarSource =
  | "document_extraction"
  | "milestone_auto"
  | "manual"
  | "fub_sync";

export type AutomationEntityType =
  | "transaction"
  | "task"
  | "milestone"
  | "fub_stage"
  | "fub_tag"
  | "calendar_event";
export type AutomationActionType =
  | "create"
  | "update"
  | "sync"
  | "suggest"
  | "delete";
export type AutomationSourceType =
  | "document_extraction"
  | "email_analysis"
  | "calendar_sync"
  | "fub_webhook"
  | "manual"
  | "scheduled_job";
export type AutomationDecision =
  | "applied"
  | "suggested"
  | "rejected"
  | "failed";

export type SourceCategory =
  | "paid"
  | "organic"
  | "referral"
  | "sphere"
  | "direct_mail"
  | "youtube"
  | "ppc"
  | "portal"
  | "open_house"
  | "repeat_client"
  | "other";

export type AttributionType = "primary" | "secondary";

// ==================================================
// INPUT DTOs
// ==================================================

export interface CreateTransactionInput {
  accountId: string;
  contactId: string;
  fubPersonId?: string;
  fubDealId?: string;
  propertyAddress?: string;
  city?: string;
  state?: string;
  zip?: string;
  transactionType: TransactionType;
  side?: TransactionSide;
  contractDate?: Date;
  closingDate?: Date;
  listDate?: Date;
  lenderName?: string;
  titleCompanyName?: string;
  salePrice?: number;
  sourceChannelId?: string;
}

export interface UpdateTransactionInput {
  propertyAddress?: string;
  contractDate?: Date;
  closingDate?: Date;
  status?: TransactionStatus;
  pipelineName?: string;
  stageName?: string;
  lenderName?: string;
  titleCompanyName?: string;
  notesSummary?: string;
}

export interface CreateMilestoneInput {
  transactionId: string;
  type: MilestoneType;
  label: string;
  dueAt: Date;
  ownerRole?: MilestoneOwnerRole;
  source?: MilestoneSource;
  confidenceScore?: number;
}

// ==================================================
// PAGINATION
// ==================================================

export interface PaginationInput {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

// ==================================================
// ERRORS
// ==================================================

export class IntegrationError extends Error {
  constructor(
    public service: string,
    public operation: string,
    message: string,
    public originalError?: unknown,
  ) {
    super(`${service}.${operation}: ${message}`);
    this.name = "IntegrationError";
  }
}

export class ValidationError extends Error {
  constructor(
    public field: string,
    public value: unknown,
    message: string,
  ) {
    super(`Validation error for ${field}: ${message}`);
    this.name = "ValidationError";
  }
}

export class BusinessLogicError extends Error {
  constructor(
    public code: string,
    message: string,
    public context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "BusinessLogicError";
  }
}

// ==================================================
// RE-EXPORTS
// ==================================================

export type {
  FUBContact,
  FUBDeal,
  FUBTask,
  FUBNote,
  FUBWebhookPayload,
  GmailThread,
  GmailMessage,
  GoogleCalendarEvent,
} from "./integrations";

export type {
  AIDocumentAnalysis,
  AIEmailSummary,
  AITransactionSummary,
  DocumentExtractionResult,
  TransactionRisk,
} from "./ai";
