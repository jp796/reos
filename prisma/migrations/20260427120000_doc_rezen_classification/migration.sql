-- AI-classified Rezen slot for each Document. Populated by
-- DocumentClassifierService; nullable = not yet classified.
ALTER TABLE "documents"
  ADD COLUMN "suggested_rezen_slot" TEXT,
  ADD COLUMN "suggested_rezen_confidence" DOUBLE PRECISION,
  ADD COLUMN "classified_at" TIMESTAMP(3);

CREATE INDEX "documents_suggested_rezen_slot_idx"
  ON "documents" ("suggested_rezen_slot");
