-- Add nullable deletion_requested_at to accounts.
-- Null = active account. Non-null = scheduled for 30-day soft-delete
-- with restore window. Cron purge route hard-deletes after 30 days.
ALTER TABLE "accounts" ADD COLUMN "deletion_requested_at" TIMESTAMP(3);
CREATE INDEX "idx_accounts_deletion_requested_at" ON "accounts" ("deletion_requested_at") WHERE "deletion_requested_at" IS NOT NULL;
