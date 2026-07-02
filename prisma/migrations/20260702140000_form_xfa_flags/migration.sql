-- Classify uploaded forms: Adobe-only XFA vs usable flat-with-text (idempotent).
ALTER TABLE "form_templates" ADD COLUMN IF NOT EXISTS "is_xfa" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "form_templates" ADD COLUMN IF NOT EXISTS "has_text" BOOLEAN NOT NULL DEFAULT false;
