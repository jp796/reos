-- Saved Flip Evaluation Calculator runs (inputs stored as JSON; outputs recomputed)
CREATE TABLE IF NOT EXISTS "flip_analyses" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "transaction_id" TEXT,
    "label" TEXT NOT NULL,
    "inputs_json" JSONB NOT NULL,
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "flip_analyses_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "flip_analyses_account_id_idx" ON "flip_analyses"("account_id");
CREATE INDEX IF NOT EXISTS "flip_analyses_transaction_id_idx" ON "flip_analyses"("transaction_id");
ALTER TABLE "flip_analyses" ADD CONSTRAINT "flip_analyses_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "flip_analyses" ADD CONSTRAINT "flip_analyses_transaction_id_fkey"
    FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
