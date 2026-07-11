-- Google Drive backup file id per document (redundant backup copy).
-- Additive + nullable — safe on existing rows.
ALTER TABLE "documents" ADD COLUMN "drive_file_id" TEXT;
