-- CreateTable
CREATE TABLE "extraction_learnings" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "state" TEXT,
    "doc_type" TEXT NOT NULL DEFAULT 'purchase_contract',
    "field" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'correction',
    "extracted" TEXT,
    "corrected" TEXT,
    "rule_text" TEXT,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "extraction_learnings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "extraction_learnings_account_id_state_doc_type_field_idx" ON "extraction_learnings"("account_id", "state", "doc_type", "field");

-- CreateIndex
CREATE INDEX "extraction_learnings_account_id_active_idx" ON "extraction_learnings"("account_id", "active");
