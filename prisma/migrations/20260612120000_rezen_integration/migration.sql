-- Real Broker (Rezen) integration: account-level encrypted token +
-- per-transaction Rezen UUID and last-push tracking.
ALTER TABLE "accounts" ADD COLUMN "real_api_tokens_encrypted" TEXT;
ALTER TABLE "transactions" ADD COLUMN "rezen_transaction_id" TEXT;
ALTER TABLE "transactions" ADD COLUMN "rezen_last_push_at" TIMESTAMP(3);
ALTER TABLE "transactions" ADD COLUMN "rezen_last_push_json" JSONB;
