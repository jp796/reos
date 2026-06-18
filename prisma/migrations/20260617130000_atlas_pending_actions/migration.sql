-- Atlas agent pending confirmations (confirm-before-write over Telegram).
CREATE TABLE "atlas_pending_actions" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'telegram',
    "actions_json" JSONB NOT NULL,
    "summary" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "atlas_pending_actions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "atlas_pending_actions_account_id_user_id_channel_key" ON "atlas_pending_actions"("account_id", "user_id", "channel");
