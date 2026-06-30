-- Cache for DocumentSynthesisService per-document analysis (idempotent).
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "analysis_json" JSONB;
