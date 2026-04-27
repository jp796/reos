-- Add a flag to hide a transaction from Production / Digest / Sources
-- rollups without deleting it. Useful when a migrated deal has the
-- wrong closing date or is intentionally non-production.
ALTER TABLE "transactions"
  ADD COLUMN "exclude_from_production" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "transactions_exclude_from_production_idx"
  ON "transactions" ("exclude_from_production");
