-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "contract_applied_at" TIMESTAMP(3),
ADD COLUMN     "contract_extracted_at" TIMESTAMP(3),
ADD COLUMN     "pending_contract_json" JSONB;
