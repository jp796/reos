-- Atlas Trace: persisted per-date provenance (snippet/confidence/source)
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "dates_provenance_json" JSONB;
