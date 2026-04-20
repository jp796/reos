-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "forwarding_email" TEXT,
ADD COLUMN     "forwarding_email_provider" TEXT,
ADD COLUMN     "forwarding_last_run_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "forwarded_documents" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "attachment_id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "to_email" TEXT NOT NULL,
    "forwarded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "forwarded_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "forwarded_documents_account_id_forwarded_at_idx" ON "forwarded_documents"("account_id", "forwarded_at");

-- CreateIndex
CREATE UNIQUE INDEX "uniq_forwarded_doc" ON "forwarded_documents"("transaction_id", "message_id", "attachment_id");

-- AddForeignKey
ALTER TABLE "forwarded_documents" ADD CONSTRAINT "forwarded_documents_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forwarded_documents" ADD CONSTRAINT "forwarded_documents_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
