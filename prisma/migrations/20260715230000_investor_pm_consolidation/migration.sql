-- AlterTable
ALTER TABLE "draw_schedules" ADD COLUMN     "project_id" TEXT;

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "funding_source_json" JSONB;

-- CreateIndex
CREATE INDEX "draw_schedules_project_id_idx" ON "draw_schedules"("project_id");

-- AddForeignKey
ALTER TABLE "draw_schedules" ADD CONSTRAINT "draw_schedules_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

