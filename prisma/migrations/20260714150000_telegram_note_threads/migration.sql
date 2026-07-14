-- Maps outbound Telegram deal pings → transaction, so replies thread back as notes
CREATE TABLE IF NOT EXISTS "telegram_note_threads" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "chat_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "telegram_note_threads_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "telegram_note_threads_chat_id_message_id_key" ON "telegram_note_threads"("chat_id", "message_id");
CREATE INDEX IF NOT EXISTS "telegram_note_threads_transaction_id_idx" ON "telegram_note_threads"("transaction_id");
