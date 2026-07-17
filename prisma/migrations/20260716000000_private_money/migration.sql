-- Private money partner directory + per-deal funding links
CREATE TABLE IF NOT EXISTS "private_money_partners" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "account_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "company" TEXT,
  "email" TEXT,
  "phone" TEXT,
  "typical_amount" DOUBLE PRECISION,
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "private_money_partners_account_id_idx" ON "private_money_partners"("account_id");

CREATE TABLE IF NOT EXISTS "deal_fundings" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "transaction_id" TEXT NOT NULL,
  "partner_id" TEXT NOT NULL,
  "amount" DOUBLE PRECISION,
  "note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "deal_fundings_transaction_id_idx" ON "deal_fundings"("transaction_id");
CREATE INDEX IF NOT EXISTS "deal_fundings_partner_id_idx" ON "deal_fundings"("partner_id");

DO $$ BEGIN
  ALTER TABLE "private_money_partners" ADD CONSTRAINT "private_money_partners_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "deal_fundings" ADD CONSTRAINT "deal_fundings_transaction_id_fkey"
    FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "deal_fundings" ADD CONSTRAINT "deal_fundings_partner_id_fkey"
    FOREIGN KEY ("partner_id") REFERENCES "private_money_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
