-- User-defined / AI-generated task templates.
CREATE TABLE IF NOT EXISTS "task_templates" (
  "id"                 TEXT NOT NULL,
  "account_id"         TEXT NOT NULL,
  "name"               TEXT NOT NULL,
  "description"        TEXT,
  "items_json"         JSONB NOT NULL,
  "source"             TEXT NOT NULL DEFAULT 'manual',
  "created_by_user_id" TEXT,
  "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "task_templates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "task_templates_account_id_idx" ON "task_templates"("account_id");

ALTER TABLE "task_templates"
  ADD CONSTRAINT "task_templates_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
