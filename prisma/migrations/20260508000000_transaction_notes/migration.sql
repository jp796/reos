-- CreateTable
CREATE TABLE IF NOT EXISTS "transaction_notes" (
    "id" TEXT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "author_user_id" TEXT,
    "body" TEXT NOT NULL,
    "read_by_json" JSONB NOT NULL DEFAULT '[]',
    "notify_email" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transaction_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "transaction_notes_transaction_id_created_at_idx"
  ON "transaction_notes" ("transaction_id", "created_at");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'transaction_notes_transaction_id_fkey') THEN
    ALTER TABLE "transaction_notes"
      ADD CONSTRAINT "transaction_notes_transaction_id_fkey"
      FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'transaction_notes_author_user_id_fkey') THEN
    ALTER TABLE "transaction_notes"
      ADD CONSTRAINT "transaction_notes_author_user_id_fkey"
      FOREIGN KEY ("author_user_id") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
