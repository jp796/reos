-- Multi-tenant abstraction: BrokerageProfile + BrokerageChecklist
-- + BrokerageStateConfig. Lets us sell REOS to KW / eXp / Compass /
-- indies, not just Real Broker.

CREATE TABLE "brokerage_profiles" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "complianceSystem" TEXT NOT NULL,
  "agent_email_domains" TEXT[] NOT NULL DEFAULT '{}',
  "cda_template_key" TEXT,
  "config_json" JSONB,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "brokerage_profiles_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "brokerage_profiles_slug_key" ON "brokerage_profiles" ("slug");

CREATE TABLE "brokerage_checklists" (
  "id" TEXT NOT NULL,
  "profile_id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "slot_number" INTEGER NOT NULL,
  "slot_key" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "required" TEXT NOT NULL,
  "tag" TEXT,
  "required_for" TEXT,
  "keywords_json" JSONB NOT NULL,
  "state_code" TEXT,

  CONSTRAINT "brokerage_checklists_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "uniq_brokerage_checklist_slot"
  ON "brokerage_checklists" ("profile_id", "kind", "slot_key", "state_code");
CREATE INDEX "brokerage_checklists_profile_id_kind_idx"
  ON "brokerage_checklists" ("profile_id", "kind");
ALTER TABLE "brokerage_checklists"
  ADD CONSTRAINT "brokerage_checklists_profile_id_fkey"
  FOREIGN KEY ("profile_id") REFERENCES "brokerage_profiles"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "brokerage_state_configs" (
  "id" TEXT NOT NULL,
  "profile_id" TEXT NOT NULL,
  "state_code" TEXT NOT NULL,
  "rules_json" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "brokerage_state_configs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "uniq_brokerage_state"
  ON "brokerage_state_configs" ("profile_id", "state_code");
ALTER TABLE "brokerage_state_configs"
  ADD CONSTRAINT "brokerage_state_configs_profile_id_fkey"
  FOREIGN KEY ("profile_id") REFERENCES "brokerage_profiles"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "accounts"
  ADD COLUMN "brokerage_profile_id" TEXT;
ALTER TABLE "accounts"
  ADD CONSTRAINT "accounts_brokerage_profile_id_fkey"
  FOREIGN KEY ("brokerage_profile_id") REFERENCES "brokerage_profiles"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
