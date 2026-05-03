-- Stripe subscription state on Account. Free tier by default.
-- Stripe webhook flips these as the subscription progresses.
ALTER TABLE "accounts"
  ADD COLUMN "subscription_tier"        TEXT NOT NULL DEFAULT 'free',
  ADD COLUMN "subscription_status"      TEXT,
  ADD COLUMN "stripe_customer_id"       TEXT,
  ADD COLUMN "stripe_subscription_id"   TEXT,
  ADD COLUMN "subscription_renews_at"   TIMESTAMP(3);

CREATE UNIQUE INDEX "accounts_stripe_customer_id_key"
  ON "accounts" ("stripe_customer_id");
CREATE UNIQUE INDEX "accounts_stripe_subscription_id_key"
  ON "accounts" ("stripe_subscription_id");
