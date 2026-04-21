-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "buyer_signed_at" TIMESTAMP(3),
ADD COLUMN     "contract_stage" TEXT,
ADD COLUMN     "seller_signed_at" TIMESTAMP(3);
