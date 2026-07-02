-- Account-level forms library (idempotent).
CREATE TABLE IF NOT EXISTS "form_templates" (
  "id"          TEXT NOT NULL,
  "account_id"  TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "category"    TEXT,
  "file_name"   TEXT NOT NULL,
  "raw_bytes"   BYTEA NOT NULL,
  "fields_json" JSONB,
  "field_count" INTEGER NOT NULL DEFAULT 0,
  "is_flat"     BOOLEAN NOT NULL DEFAULT false,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "form_templates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "form_templates_account_id_idx" ON "form_templates" ("account_id");

DO $$ BEGIN
  ALTER TABLE "form_templates" ADD CONSTRAINT "form_templates_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
