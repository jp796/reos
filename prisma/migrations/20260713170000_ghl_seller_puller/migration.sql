-- AlterTable: GHL credential on the account
ALTER TABLE "accounts" ADD COLUMN "ghl_api_key_encrypted" TEXT;
ALTER TABLE "accounts" ADD COLUMN "ghl_location_id" TEXT;

-- AlterTable: seller intel pulled from GHL onto a deal
ALTER TABLE "transactions" ADD COLUMN "seller_intel_json" JSONB;
