-- AlterTable
ALTER TABLE "transaction_inspections"
  ADD COLUMN IF NOT EXISTS "vendor_name" TEXT;

-- Index for autocomplete queries (DISTINCT vendor_name within an account
-- via join to transactions). The (transaction_id) index already exists;
-- this one helps the autocomplete query in particular.
CREATE INDEX IF NOT EXISTS "transaction_inspections_vendor_name_idx"
  ON "transaction_inspections" ("vendor_name") WHERE "vendor_name" IS NOT NULL;
