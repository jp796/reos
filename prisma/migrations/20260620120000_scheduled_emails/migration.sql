-- User-authored emails queued to send later (Gmail-style "send later").
CREATE TABLE IF NOT EXISTS "scheduled_emails" (
  "id"                 TEXT NOT NULL,
  "account_id"         TEXT NOT NULL,
  "transaction_id"     TEXT NOT NULL,
  "created_by_user_id" TEXT,
  "from_email"         TEXT NOT NULL,
  "to_json"            JSONB NOT NULL,
  "cc_json"            JSONB,
  "subject"            TEXT NOT NULL,
  "body"               TEXT NOT NULL,
  "send_at"            TIMESTAMP(3) NOT NULL,
  "status"             TEXT NOT NULL DEFAULT 'pending',
  "attempts"           INTEGER NOT NULL DEFAULT 0,
  "last_error"         TEXT,
  "sent_at"            TIMESTAMP(3),
  "gmail_message_id"   TEXT,
  "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "scheduled_emails_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "scheduled_emails_status_send_at_idx" ON "scheduled_emails"("status", "send_at");
CREATE INDEX IF NOT EXISTS "scheduled_emails_transaction_id_idx" ON "scheduled_emails"("transaction_id");
