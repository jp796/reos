-- Manually-entered expected-income lines for the $ Pipeline dashboard
CREATE TABLE IF NOT EXISTS "pipeline_income_items" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "business" TEXT NOT NULL DEFAULT 'EPS',
    "property" TEXT NOT NULL,
    "disposition" TEXT NOT NULL DEFAULT 'Other',
    "expected_income" DOUBLE PRECISION NOT NULL,
    "expected_date" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'guess',
    "note" TEXT,
    "transaction_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "pipeline_income_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "pipeline_income_items_account_id_idx" ON "pipeline_income_items"("account_id");

ALTER TABLE "pipeline_income_items" ADD CONSTRAINT "pipeline_income_items_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
