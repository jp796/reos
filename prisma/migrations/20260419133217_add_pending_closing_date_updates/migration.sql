-- CreateTable
CREATE TABLE "pending_closing_date_updates" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "thread_id" TEXT,
    "attachment_id" TEXT,
    "document_type" TEXT NOT NULL,
    "anchor" TEXT NOT NULL,
    "extracted_date" TIMESTAMP(3) NOT NULL,
    "previous_date" TIMESTAMP(3),
    "confidence" DOUBLE PRECISION NOT NULL,
    "snippet" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "applied_at" TIMESTAMP(3),
    "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pending_closing_date_updates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pending_closing_date_updates_account_id_status_idx" ON "pending_closing_date_updates"("account_id", "status");

-- CreateIndex
CREATE INDEX "pending_closing_date_updates_detected_at_idx" ON "pending_closing_date_updates"("detected_at");

-- CreateIndex
CREATE UNIQUE INDEX "pending_closing_date_updates_transaction_id_extracted_date_key" ON "pending_closing_date_updates"("transaction_id", "extracted_date");

-- AddForeignKey
ALTER TABLE "pending_closing_date_updates" ADD CONSTRAINT "pending_closing_date_updates_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
