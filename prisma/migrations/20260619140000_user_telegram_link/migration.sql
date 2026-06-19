-- Per-user Telegram linking: each user can connect their own private
-- chat with the bot. Inbound messages route to the matching user.
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "telegram_chat_id"   TEXT,
  ADD COLUMN IF NOT EXISTS "telegram_link_code" TEXT,
  ADD COLUMN IF NOT EXISTS "telegram_linked_at" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "users_telegram_chat_id_key"   ON "users"("telegram_chat_id");
CREATE UNIQUE INDEX IF NOT EXISTS "users_telegram_link_code_key" ON "users"("telegram_link_code");
