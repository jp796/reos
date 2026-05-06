-- AlterTable
ALTER TABLE "transactions"
  ADD COLUMN IF NOT EXISTS "manually_edited_at" TIMESTAMP(3);
