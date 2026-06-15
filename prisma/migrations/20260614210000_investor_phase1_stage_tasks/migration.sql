-- Investor Module — Phase 1: stage-template tasks (spec §6).
-- Additive only: new nullable columns on tasks + a FK to assets.
-- Existing retail TC tasks are unaffected (asset_id / stage_key /
-- template_key all NULL).

ALTER TABLE "tasks" ADD COLUMN "asset_id" TEXT;
ALTER TABLE "tasks" ADD COLUMN "stage_key" TEXT;
ALTER TABLE "tasks" ADD COLUMN "template_key" TEXT;

CREATE INDEX "idx_tasks_asset_stage" ON "tasks"("asset_id", "stage_key");

ALTER TABLE "tasks" ADD CONSTRAINT "tasks_asset_id_fkey"
    FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
