-- Persist the last document-set synthesis so the deal's current-state
-- panel renders without re-running synthesis (idempotent).
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "synthesis_json" JSONB;
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "synthesized_at" TIMESTAMP(3);
