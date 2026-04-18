-- CreateTable
CREATE TABLE "pending_email_matches" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "from_email" TEXT NOT NULL,
    "matched_domain" TEXT,
    "confidence_score" DOUBLE PRECISION NOT NULL,
    "reasons_json" JSONB,
    "extracted_buyer" TEXT,
    "extracted_seller" TEXT,
    "extracted_address" TEXT,
    "extracted_file_number" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "resolved_contact_id" TEXT,
    "resolved_transaction_id" TEXT,
    "resolved_at" TIMESTAMP(3),
    "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pending_email_matches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pending_email_matches_thread_id_key" ON "pending_email_matches"("thread_id");

-- CreateIndex
CREATE INDEX "pending_email_matches_account_id_status_idx" ON "pending_email_matches"("account_id", "status");

-- CreateIndex
CREATE INDEX "pending_email_matches_detected_at_idx" ON "pending_email_matches"("detected_at");

-- AddForeignKey
ALTER TABLE "pending_email_matches" ADD CONSTRAINT "pending_email_matches_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
