-- Saved per-field coordinate map for flat forms (idempotent).
ALTER TABLE "form_templates" ADD COLUMN IF NOT EXISTS "placements_json" JSONB;
