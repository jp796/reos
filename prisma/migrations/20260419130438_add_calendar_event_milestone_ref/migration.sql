-- AlterTable
ALTER TABLE "calendar_events" ADD COLUMN     "milestone_id" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'active';

-- CreateIndex
CREATE INDEX "calendar_events_milestone_id_idx" ON "calendar_events"("milestone_id");
