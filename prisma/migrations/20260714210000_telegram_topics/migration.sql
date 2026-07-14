-- Telegram Forum Topics: per-account team space + per-deal topic
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "telegram_forum_chat_id" TEXT;
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "telegram_topic_id" TEXT;
