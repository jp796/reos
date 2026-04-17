/**
 * External-service integration types.
 * Re-exported from src/types/index.ts.
 */

// ==================================================
// FOLLOW UP BOSS
// ==================================================

export interface FUBContact {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  tags: string[];
  source?: string;
  assignedAgent?: string;
  customFields: Record<string, unknown>;
}

export interface FUBDeal {
  id: string;
  personId: string;
  stage: string;
  pipeline: string;
  value?: number;
  customFields: Record<string, unknown>;
}

export interface FUBTask {
  id: string;
  personId?: string;
  dealId?: string;
  title: string;
  description?: string;
  dueDate?: string;
  completed: boolean;
  assignedTo?: string;
}

export interface FUBNote {
  id: string;
  personId?: string;
  dealId?: string;
  content: string;
  createdAt: string;
  createdBy?: string;
}

export interface FUBPerson {
  id: string;
  name: string;
  firstName?: string;
  lastName?: string;
  emails: Array<{ value: string; type?: string; primary?: boolean }>;
  phones: Array<{ value: string; type?: string; primary?: boolean }>;
  addresses: Array<{
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
    type?: string;
  }>;
  tags: string[];
  source?: string;
  assignedTo?: string;
  stage?: string;
  created: string;
  updated: string;
  customFields: Record<string, unknown>;
  score?: number;
  avatar?: string;
  company?: string;
}

export interface FUBCustomField {
  id: string;
  name: string;
  type: "text" | "number" | "date" | "select" | "multi_select" | "boolean";
  label: string;
  required: boolean;
  options?: string[];
  category: "person" | "deal" | "company";
}

export interface FUBWebhookPayload {
  id: string;
  type: string;
  data: {
    person?: FUBContact;
    deal?: FUBDeal;
    task?: FUBTask;
    note?: FUBNote;
  };
  timestamp: string;
}

// ==================================================
// GMAIL
// ==================================================

export interface GmailThread {
  id: string;
  historyId: string;
  messages: GmailMessage[];
}

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  payload: {
    partId: string;
    mimeType: string;
    filename: string;
    headers: Array<{ name: string; value: string }>;
    body: { attachmentId?: string; size: number; data?: string };
    parts?: Array<{
      partId?: string;
      mimeType?: string;
      filename?: string;
      headers?: Array<{ name: string; value: string }>;
      body?: { attachmentId?: string; size?: number; data?: string };
      parts?: unknown[];
    }>;
  };
  sizeEstimate: number;
  historyId: string;
  internalDate: string;
}

export interface GmailAttachment {
  attachmentId: string;
  size: number;
  data: string;
}

// ==================================================
// GOOGLE CALENDAR
// ==================================================

export interface GoogleCalendarEvent {
  id: string;
  status: string;
  htmlLink: string;
  created: string;
  updated: string;
  summary: string;
  description?: string;
  location?: string;
  start: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  end: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  attendees?: Array<{
    email: string;
    displayName?: string;
    responseStatus: string;
  }>;
  recurrence?: string[];
}

// ==================================================
// ACCOUNT SETTINGS (JSON blob on Account.settingsJson)
// ==================================================

export interface AccountSettings {
  followUpBoss?: {
    webhookUrl?: string;
    fieldMappings: {
      contractDate?: string;
      closingDate?: string;
      listDate?: string;
      inspectionDate?: string;
      appraisalDate?: string;
      lenderName?: string;
      titleCompany?: string;
      salePrice?: string;
      transactionType?: string;
    };
    automation: {
      autoUpdateStages: boolean;
      autoUpdateTags: boolean;
      confidenceThreshold: number;
      safeMode: boolean;
    };
  };
  gmail?: {
    labelPrefix?: string;
    autoOrganizeThreads: boolean;
    extractAttachments: boolean;
  };
  googleCalendar?: {
    primaryCalendarId?: string;
    privateOpsCalendarId?: string;
    autoCreateReminders: boolean;
    bufferTimeMinutes: number;
  };
  ai?: {
    documentExtractionEnabled: boolean;
    emailSummaryEnabled: boolean;
    riskScoringEnabled: boolean;
    confidenceThresholds: {
      documentExtraction: number;
      emailAnalysis: number;
      autoSync: number;
    };
  };
  notifications?: {
    dailyDigest: boolean;
    riskAlerts: boolean;
    deadlineReminders: boolean;
    emailFrequency: "real_time" | "daily" | "weekly";
  };
}
