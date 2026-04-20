-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "smart_folder_backfill_count" INTEGER,
ADD COLUMN     "smart_folder_filter_id" TEXT,
ADD COLUMN     "smart_folder_label_id" TEXT,
ADD COLUMN     "smart_folder_setup_at" TIMESTAMP(3);
