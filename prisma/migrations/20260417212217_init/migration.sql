-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "business_name" TEXT NOT NULL,
    "owner_user_id" TEXT NOT NULL,
    "follow_up_boss_api_key_encrypted" TEXT,
    "follow_up_boss_system_key_encrypted" TEXT,
    "google_oauth_tokens_encrypted" TEXT,
    "settings_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'owner',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "fub_person_id" TEXT,
    "full_name" TEXT NOT NULL,
    "primary_email" TEXT,
    "primary_phone" TEXT,
    "assigned_agent_name" TEXT,
    "source_name" TEXT,
    "tags_json" JSONB,
    "raw_fub_payload_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "fub_person_id" TEXT,
    "fub_deal_id" TEXT,
    "property_address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zip" TEXT,
    "transaction_type" TEXT NOT NULL DEFAULT 'buyer',
    "side" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "pipeline_name" TEXT,
    "stage_name" TEXT,
    "contract_date" TIMESTAMP(3),
    "closing_date" TIMESTAMP(3),
    "list_date" TIMESTAMP(3),
    "inspection_date" TIMESTAMP(3),
    "appraisal_date" TIMESTAMP(3),
    "financing_deadline" TIMESTAMP(3),
    "title_deadline" TIMESTAMP(3),
    "possession_date" TIMESTAMP(3),
    "earnest_money_due_date" TIMESTAMP(3),
    "walkthrough_date" TIMESTAMP(3),
    "lender_name" TEXT,
    "title_company_name" TEXT,
    "attorney_name" TEXT,
    "notes_summary" TEXT,
    "risk_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "missing_items_json" JSONB,
    "last_meaningful_touch_at" TIMESTAMP(3),
    "last_synced_at" TIMESTAMP(3),
    "raw_source_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "milestones" (
    "id" TEXT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "due_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'pending',
    "owner_role" TEXT NOT NULL DEFAULT 'agent',
    "source" TEXT NOT NULL DEFAULT 'manual',
    "confidence_score" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "milestones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "milestone_id" TEXT,
    "fub_task_id" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "due_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "assigned_to" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "sync_status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "category" TEXT,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "storage_url" TEXT,
    "source" TEXT NOT NULL DEFAULT 'upload',
    "extracted_text" TEXT,
    "upload_origin" TEXT,
    "uploaded_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_extractions" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "extraction_status" TEXT NOT NULL DEFAULT 'pending',
    "extractor_version" TEXT NOT NULL,
    "confidence_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "raw_output_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_extractions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extracted_dates" (
    "id" TEXT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "document_extraction_id" TEXT NOT NULL,
    "date_type" TEXT NOT NULL,
    "extracted_value" TEXT NOT NULL,
    "normalized_value" TIMESTAMP(3) NOT NULL,
    "source_page" INTEGER,
    "source_snippet" TEXT,
    "confidence_score" DOUBLE PRECISION NOT NULL,
    "document_type" TEXT,
    "match_status" TEXT NOT NULL DEFAULT 'pending',
    "sync_status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "extracted_dates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication_events" (
    "id" TEXT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "subject" TEXT,
    "summary" TEXT,
    "happened_at" TIMESTAMP(3) NOT NULL,
    "raw_payload_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "communication_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_events" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "transaction_id" TEXT,
    "google_event_id" TEXT,
    "calendar_type" TEXT NOT NULL DEFAULT 'external',
    "title" TEXT NOT NULL,
    "start_at" TIMESTAMP(3) NOT NULL,
    "end_at" TIMESTAMP(3) NOT NULL,
    "location" TEXT,
    "description" TEXT,
    "attendees_json" JSONB,
    "created_by_app" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT,
    "raw_payload_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_audit_logs" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "transaction_id" TEXT,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "rule_name" TEXT NOT NULL,
    "action_type" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "confidence_score" DOUBLE PRECISION NOT NULL,
    "decision" TEXT NOT NULL,
    "before_json" JSONB,
    "after_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_channels" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "source_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_spends" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "source_channel_id" TEXT NOT NULL,
    "spend_date" TIMESTAMP(3) NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketing_spends_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction_attributions" (
    "id" TEXT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "source_channel_id" TEXT NOT NULL,
    "attribution_type" TEXT NOT NULL DEFAULT 'primary',
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transaction_attributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction_financials" (
    "id" TEXT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "sale_price" DOUBLE PRECISION,
    "commission_percent" DOUBLE PRECISION,
    "gross_commission" DOUBLE PRECISION,
    "referral_fee_percent" DOUBLE PRECISION,
    "referral_fee_amount" DOUBLE PRECISION,
    "brokerage_split_percent" DOUBLE PRECISION,
    "brokerage_split_amount" DOUBLE PRECISION,
    "marketing_cost_allocated" DOUBLE PRECISION,
    "net_commission" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transaction_financials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_account_id_idx" ON "users"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_fub_person_id_key" ON "contacts"("fub_person_id");

-- CreateIndex
CREATE INDEX "contacts_account_id_idx" ON "contacts"("account_id");

-- CreateIndex
CREATE INDEX "idx_contacts_fub_person" ON "contacts"("fub_person_id");

-- CreateIndex
CREATE INDEX "transactions_account_id_idx" ON "transactions"("account_id");

-- CreateIndex
CREATE INDEX "idx_transactions_contact_status" ON "transactions"("contact_id", "status");

-- CreateIndex
CREATE INDEX "idx_transactions_status_closing" ON "transactions"("status", "closing_date");

-- CreateIndex
CREATE INDEX "idx_milestones_transaction_type" ON "milestones"("transaction_id", "type");

-- CreateIndex
CREATE INDEX "idx_milestones_transaction_due" ON "milestones"("transaction_id", "due_at");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_fub_task_id_key" ON "tasks"("fub_task_id");

-- CreateIndex
CREATE INDEX "tasks_transaction_id_idx" ON "tasks"("transaction_id");

-- CreateIndex
CREATE INDEX "tasks_milestone_id_idx" ON "tasks"("milestone_id");

-- CreateIndex
CREATE INDEX "tasks_due_at_completed_at_idx" ON "tasks"("due_at", "completed_at");

-- CreateIndex
CREATE INDEX "documents_transaction_id_idx" ON "documents"("transaction_id");

-- CreateIndex
CREATE INDEX "document_extractions_document_id_idx" ON "document_extractions"("document_id");

-- CreateIndex
CREATE INDEX "idx_extracted_dates_transaction_type" ON "extracted_dates"("transaction_id", "date_type");

-- CreateIndex
CREATE INDEX "extracted_dates_match_status_idx" ON "extracted_dates"("match_status");

-- CreateIndex
CREATE INDEX "communication_events_transaction_id_happened_at_idx" ON "communication_events"("transaction_id", "happened_at");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_events_google_event_id_key" ON "calendar_events"("google_event_id");

-- CreateIndex
CREATE INDEX "calendar_events_account_id_idx" ON "calendar_events"("account_id");

-- CreateIndex
CREATE INDEX "calendar_events_transaction_id_idx" ON "calendar_events"("transaction_id");

-- CreateIndex
CREATE INDEX "calendar_events_start_at_idx" ON "calendar_events"("start_at");

-- CreateIndex
CREATE INDEX "automation_audit_logs_account_id_created_at_idx" ON "automation_audit_logs"("account_id", "created_at");

-- CreateIndex
CREATE INDEX "automation_audit_logs_transaction_id_idx" ON "automation_audit_logs"("transaction_id");

-- CreateIndex
CREATE INDEX "source_channels_account_id_idx" ON "source_channels"("account_id");

-- CreateIndex
CREATE INDEX "idx_marketing_spends_channel_date" ON "marketing_spends"("source_channel_id", "spend_date");

-- CreateIndex
CREATE INDEX "marketing_spends_account_id_idx" ON "marketing_spends"("account_id");

-- CreateIndex
CREATE INDEX "transaction_attributions_transaction_id_idx" ON "transaction_attributions"("transaction_id");

-- CreateIndex
CREATE INDEX "transaction_attributions_source_channel_id_idx" ON "transaction_attributions"("source_channel_id");

-- CreateIndex
CREATE UNIQUE INDEX "transaction_financials_transaction_id_key" ON "transaction_financials"("transaction_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_milestone_id_fkey" FOREIGN KEY ("milestone_id") REFERENCES "milestones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_extractions" ADD CONSTRAINT "document_extractions_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extracted_dates" ADD CONSTRAINT "extracted_dates_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extracted_dates" ADD CONSTRAINT "extracted_dates_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extracted_dates" ADD CONSTRAINT "extracted_dates_document_extraction_id_fkey" FOREIGN KEY ("document_extraction_id") REFERENCES "document_extractions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_events" ADD CONSTRAINT "communication_events_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_audit_logs" ADD CONSTRAINT "automation_audit_logs_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_audit_logs" ADD CONSTRAINT "automation_audit_logs_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_channels" ADD CONSTRAINT "source_channels_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_spends" ADD CONSTRAINT "marketing_spends_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_spends" ADD CONSTRAINT "marketing_spends_source_channel_id_fkey" FOREIGN KEY ("source_channel_id") REFERENCES "source_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_attributions" ADD CONSTRAINT "transaction_attributions_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_attributions" ADD CONSTRAINT "transaction_attributions_source_channel_id_fkey" FOREIGN KEY ("source_channel_id") REFERENCES "source_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_financials" ADD CONSTRAINT "transaction_financials_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
