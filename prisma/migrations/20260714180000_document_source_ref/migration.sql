-- De-dup key for auto-ingested Gmail attachments
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "source_ref" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "documents_source_ref_key" ON "documents"("source_ref");
