-- CreateTable
CREATE TABLE "invoice_entries" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "transaction_id" TEXT,
    "thread_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "attachment_id" TEXT,
    "filename" TEXT,
    "from_email" TEXT,
    "subject" TEXT,
    "vendor_name" TEXT,
    "amount" DOUBLE PRECISION,
    "invoice_date" TIMESTAMP(3),
    "category" TEXT,
    "snippet" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "invoice_entries_account_id_status_idx" ON "invoice_entries"("account_id", "status");

-- CreateIndex
CREATE INDEX "invoice_entries_transaction_id_idx" ON "invoice_entries"("transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "uniq_invoice_msg_att" ON "invoice_entries"("account_id", "message_id", "attachment_id");

-- AddForeignKey
ALTER TABLE "invoice_entries" ADD CONSTRAINT "invoice_entries_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_entries" ADD CONSTRAINT "invoice_entries_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
