-- Atlas Trace §4b: persisted addendum reconciliations (original -> superseding per term)
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "dates_conflicts_json" JSONB;
