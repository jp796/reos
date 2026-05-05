-- CreateTable
CREATE TABLE IF NOT EXISTS "transaction_inspections" (
    "id" TEXT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'other',
    "label" TEXT NOT NULL,
    "scheduled_at" TIMESTAMP(3),
    "vendor_note" TEXT,
    "calendar_event_id" TEXT,
    "remind_on_telegram" BOOLEAN NOT NULL DEFAULT true,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transaction_inspections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "transaction_inspections_transaction_id_scheduled_at_idx" ON "transaction_inspections"("transaction_id", "scheduled_at");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'transaction_inspections_transaction_id_fkey'
  ) THEN
    ALTER TABLE "transaction_inspections" ADD CONSTRAINT "transaction_inspections_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'transaction_inspections_calendar_event_id_fkey'
  ) THEN
    ALTER TABLE "transaction_inspections" ADD CONSTRAINT "transaction_inspections_calendar_event_id_fkey" FOREIGN KEY ("calendar_event_id") REFERENCES "calendar_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
