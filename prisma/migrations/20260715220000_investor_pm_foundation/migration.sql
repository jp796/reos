-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "completed_at" TIMESTAMP(3),
ADD COLUMN     "disposition_transaction_id" TEXT,
ADD COLUMN     "project_template_key" TEXT,
ADD COLUMN     "source_transaction_id" TEXT,
ADD COLUMN     "started_at" TIMESTAMP(3),
ADD COLUMN     "target_completion_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "due_date_out_of_window" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "is_list_it_task" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "project_id" TEXT;

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "asset_role" TEXT,
ADD COLUMN     "disposition_income_json" JSONB;

-- CreateIndex
CREATE INDEX "idx_projects_asset_status" ON "projects"("asset_id", "status");

-- CreateIndex
CREATE INDEX "tasks_project_id_idx" ON "tasks"("project_id");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

