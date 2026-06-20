-- User-defined / AI-generated compliance (document checklist) templates.
CREATE TABLE IF NOT EXISTS "compliance_templates" (
  "id"                 TEXT NOT NULL,
  "account_id"         TEXT NOT NULL,
  "name"               TEXT NOT NULL,
  "description"        TEXT,
  "items_json"         JSONB NOT NULL,
  "source"             TEXT NOT NULL DEFAULT 'manual',
  "created_by_user_id" TEXT,
  "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "compliance_templates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "compliance_templates_account_id_idx" ON "compliance_templates"("account_id");

ALTER TABLE "compliance_templates"
  ADD CONSTRAINT "compliance_templates_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Per-deal applied checklist (overrides brokerage default for that deal).
ALTER TABLE "transactions"
  ADD COLUMN IF NOT EXISTS "compliance_template_json" JSONB,
  ADD COLUMN IF NOT EXISTS "compliance_template_name" TEXT;
