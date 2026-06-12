-- Manual Rezen-slot assignment + signature-scan tracking on documents.
ALTER TABLE "documents" ADD COLUMN "assigned_rezen_slot" TEXT;
ALTER TABLE "documents" ADD COLUMN "signature_scan_status" TEXT;
ALTER TABLE "documents" ADD COLUMN "signature_scan_notes" TEXT;
ALTER TABLE "documents" ADD COLUMN "signature_scanned_at" TIMESTAMP(3);
