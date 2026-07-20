-- Reconciliation migration: captures schema that reached the DB via 'prisma db push'
-- without a migration file (NextAuth tables, SaaS tables, transaction-sharing
-- columns, etc.). On PROD these objects ALREADY EXIST — mark this migration applied
-- with 'prisma migrate resolve --applied 20260720023415_reconcile_schema_drift' so the
-- DDL below is NOT re-run. On a fresh/blank DB it builds them for real.

-- DropIndex
DROP INDEX "documents_suggested_rezen_slot_idx";

-- DropIndex
DROP INDEX "transactions_exclude_from_production_idx";

-- DropIndex
DROP INDEX "transactions_is_demo_idx";

-- AlterTable
ALTER TABLE "automation_audit_logs" ADD COLUMN     "actor_user_id" TEXT;

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "raw_bytes" BYTEA,
ADD COLUMN     "source_date" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "milestones" ALTER COLUMN "due_at" DROP NOT NULL;

-- AlterTable
ALTER TABLE "private_money_partners" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "assigned_user_id" TEXT,
ADD COLUMN     "inspection_objection_date" TIMESTAMP(3),
ADD COLUMN     "share_created_at" TIMESTAMP(3),
ADD COLUMN     "share_expires_at" TIMESTAMP(3),
ADD COLUMN     "share_token" TEXT,
ADD COLUMN     "title_objection_date" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "email_verified" TIMESTAMP(3),
ADD COLUMN     "image" TEXT,
ADD COLUMN     "terms_accepted_at" TIMESTAMP(3),
ALTER COLUMN "account_id" DROP NOT NULL,
ALTER COLUMN "name" DROP NOT NULL;

-- CreateTable
CREATE TABLE "auth_accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_account_id" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "auth_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "session_token" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_tokens" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "email_templates" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "category" TEXT,
    "default_to" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_starter" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_intakes" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "property_address" TEXT,
    "area_of_interest" TEXT,
    "budget" TEXT,
    "timeline" TEXT,
    "financing_status" TEXT,
    "notes" TEXT,
    "source" TEXT,
    "submitted_user_agent" TEXT,
    "submitted_ip" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "converted_transaction_id" TEXT,
    "converted_contact_id" TEXT,
    "converted_at" TIMESTAMP(3),
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_intakes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_extraction_versions" (
    "id" TEXT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "extraction_json" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "filename" TEXT,
    "source_date" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_extraction_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wire_verifications" (
    "id" TEXT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "verified_at" TIMESTAMP(3) NOT NULL,
    "verified_by_user_id" TEXT,
    "title_agent_name" TEXT,
    "phone_called" TEXT,
    "instructions_summary" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wire_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction_participants" (
    "id" TEXT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transaction_participants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "auth_accounts_provider_provider_account_id_key" ON "auth_accounts"("provider", "provider_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_session_token_key" ON "sessions"("session_token");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_token_key" ON "verification_tokens"("token");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_identifier_token_key" ON "verification_tokens"("identifier", "token");

-- CreateIndex
CREATE INDEX "email_templates_account_id_category_idx" ON "email_templates"("account_id", "category");

-- CreateIndex
CREATE INDEX "lead_intakes_account_id_status_submitted_at_idx" ON "lead_intakes"("account_id", "status", "submitted_at" DESC);

-- CreateIndex
CREATE INDEX "contract_extraction_versions_transaction_id_created_at_idx" ON "contract_extraction_versions"("transaction_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "wire_verifications_transaction_id_verified_at_idx" ON "wire_verifications"("transaction_id", "verified_at" DESC);

-- CreateIndex
CREATE INDEX "transaction_participants_transaction_id_idx" ON "transaction_participants"("transaction_id");

-- CreateIndex
CREATE INDEX "transaction_participants_contact_id_idx" ON "transaction_participants"("contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "uniq_txn_participant" ON "transaction_participants"("transaction_id", "contact_id", "role");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_share_token_key" ON "transactions"("share_token");

-- AddForeignKey
ALTER TABLE "auth_accounts" ADD CONSTRAINT "auth_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_assigned_user_id_fkey" FOREIGN KEY ("assigned_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_audit_logs" ADD CONSTRAINT "automation_audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_intakes" ADD CONSTRAINT "lead_intakes_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_extraction_versions" ADD CONSTRAINT "contract_extraction_versions_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wire_verifications" ADD CONSTRAINT "wire_verifications_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_participants" ADD CONSTRAINT "transaction_participants_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_participants" ADD CONSTRAINT "transaction_participants_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

