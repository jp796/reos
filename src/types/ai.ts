/**
 * AI service types.
 */

import type { DateType, DocumentCategory, ExtractionStatus } from "./index";

export interface AIDocumentAnalysis {
  documentType?: DocumentCategory;
  confidence: number;
  extractedDates: Array<{
    type: DateType;
    value: string;
    normalizedValue: Date;
    confidence: number;
    snippet: string;
    page?: number;
  }>;
  keyPeople?: Array<{
    name: string;
    role: string;
    email?: string;
    phone?: string;
  }>;
  propertyAddress?: string;
  salePrice?: number;
  summary?: string;
}

export interface AIEmailSummary {
  subject: string;
  participants: string[];
  sentiment: "positive" | "neutral" | "negative" | "urgent";
  keyPoints: string[];
  actionItems: Array<{
    task: string;
    assignee?: string;
    dueDate?: Date;
  }>;
  relatedProperty?: string;
  confidence: number;
}

export interface AITransactionSummary {
  status: string;
  health: "good" | "caution" | "risk" | "critical";
  nextDeadline?: {
    type: string;
    date: Date;
    daysUntil: number;
  };
  overdueTasks: number;
  missingDocuments: string[];
  recentActivity: Array<{
    type: string;
    description: string;
    date: Date;
  }>;
  riskFactors: Array<{
    type: string;
    description: string;
    severity: "low" | "medium" | "high";
  }>;
  suggestedActions: Array<{
    priority: "low" | "medium" | "high";
    action: string;
    reason: string;
  }>;
}

export interface DocumentExtractionResult {
  status: ExtractionStatus;
  confidence: number;
  documentType?: DocumentCategory;
  extractedDates: Array<{
    type: DateType;
    value: string;
    normalizedValue: Date;
    snippet: string;
    page?: number;
    confidence: number;
  }>;
  keyEntities: Array<{
    type: string;
    value: string;
    confidence: number;
  }>;
  summary?: string;
}

export interface TransactionRisk {
  score: number;
  factors: Array<{
    type: string;
    description: string;
    impact: number;
    severity: "low" | "medium" | "high";
  }>;
  recommendation: string;
}
