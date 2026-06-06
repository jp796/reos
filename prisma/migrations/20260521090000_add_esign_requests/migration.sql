CREATE TABLE "esign_requests" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'documenso',
    "provider_envelope_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "title" TEXT NOT NULL,
    "recipients_json" JSONB NOT NULL,
    "signing_links_json" JSONB,
    "provider_response_json" JSONB,
    "error_message" TEXT,
    "sent_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "esign_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "esign_requests_account_id_status_idx" ON "esign_requests"("account_id", "status");
CREATE INDEX "esign_requests_transaction_id_created_at_idx" ON "esign_requests"("transaction_id", "created_at");
CREATE INDEX "esign_requests_document_id_idx" ON "esign_requests"("document_id");

ALTER TABLE "esign_requests" ADD CONSTRAINT "esign_requests_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "esign_requests" ADD CONSTRAINT "esign_requests_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "esign_requests" ADD CONSTRAINT "esign_requests_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
