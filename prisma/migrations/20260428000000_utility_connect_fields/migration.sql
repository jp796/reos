-- Utility Connect enrollment refs on Transaction. Set after a
-- successful POST /lead; presence of utility_connect_lead_id is
-- the idempotency key for the scheduler.
ALTER TABLE "transactions"
  ADD COLUMN "utility_connect_customer_id" INTEGER,
  ADD COLUMN "utility_connect_lead_id" TEXT,
  ADD COLUMN "utility_connect_reference_code" TEXT,
  ADD COLUMN "utility_connect_enrolled_at" TIMESTAMP(3);
