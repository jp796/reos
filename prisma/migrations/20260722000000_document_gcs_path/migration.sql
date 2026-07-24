-- Document bytes move to GCS: gcsPath holds the object path for new uploads.
-- Legacy documents keep raw_bytes; readers fall back to it transparently.
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "gcs_path" TEXT;
