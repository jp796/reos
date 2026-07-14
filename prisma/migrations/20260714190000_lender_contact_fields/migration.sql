-- Lender contact block on the deal (system of record)
ALTER TABLE "transactions"
  ADD COLUMN IF NOT EXISTS "lender_company" TEXT,
  ADD COLUMN IF NOT EXISTS "lender_phone" TEXT,
  ADD COLUMN IF NOT EXISTS "lender_email" TEXT;
