-- AddTable: SocialPostTemplate
-- Per-account caption templates for the Just-Listed / Under-Contract /
-- Just-Sold social-post flow. When a row exists for (event, platform),
-- SocialPostService renders it with variable substitution instead of
-- calling OpenAI for that slot.
CREATE TABLE "social_post_templates" (
  "id"            TEXT NOT NULL,
  "account_id"    TEXT NOT NULL,
  "event"         TEXT NOT NULL,
  "platform"      TEXT NOT NULL,
  "body"          TEXT NOT NULL,
  "is_starter"    BOOLEAN NOT NULL DEFAULT false,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL,

  CONSTRAINT "social_post_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uniq_social_post_template_slot"
  ON "social_post_templates"("account_id", "event", "platform");

CREATE INDEX "social_post_templates_account_id_idx"
  ON "social_post_templates"("account_id");

ALTER TABLE "social_post_templates"
  ADD CONSTRAINT "social_post_templates_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "accounts"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
