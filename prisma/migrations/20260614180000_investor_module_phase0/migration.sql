-- Investor Module — Phase 0: core extensions (spec §1–4, §12)
-- Fully ADDITIVE and non-breaking: all new columns are nullable or
-- defaulted, no data is rewritten, no existing column changes. Existing
-- retail transactions run unchanged (asset_id = NULL, shadow spine).

-- ── Account: investor entitlements (spec §1) ──────────────────────────
ALTER TABLE "accounts" ADD COLUMN "entitlements_json" JSONB;

-- ── Contact: account-wide role set (spec §2, §7) ─────────────────────
ALTER TABLE "contacts" ADD COLUMN "roles_json" JSONB;

-- ── Transaction: nullable Asset parent (shadow reparenting, spec §2) ──
ALTER TABLE "transactions" ADD COLUMN "asset_id" TEXT;

-- ── Asset (Deal) — the investor spine (spec §2) ──────────────────────
CREATE TABLE "assets" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "owner_user_id" TEXT,
    "address" TEXT,
    "representation" TEXT NOT NULL DEFAULT 'agency',
    "title_path" TEXT,
    "strategy" TEXT NOT NULL DEFAULT 'retail',
    "creative_substructure" TEXT,
    "current_stage_name" TEXT,
    "risk_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "economics_json" JSONB,
    "agency_component_json" JSONB,
    "drive_folder_id" TEXT,
    "chat_space_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- ── Project — a PM work episode on an Asset (spec §2) ────────────────
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "budget" DOUBLE PRECISION,
    "actual" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- ── Indexes ──────────────────────────────────────────────────────────
CREATE INDEX "idx_transactions_asset" ON "transactions"("asset_id");
CREATE INDEX "assets_account_id_idx" ON "assets"("account_id");
CREATE INDEX "idx_assets_account_strategy" ON "assets"("account_id", "strategy");
CREATE INDEX "idx_assets_account_representation" ON "assets"("account_id", "representation");
CREATE INDEX "projects_asset_id_idx" ON "projects"("asset_id");
CREATE INDEX "projects_account_id_idx" ON "projects"("account_id");

-- ── Foreign keys ─────────────────────────────────────────────────────
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_asset_id_fkey"
    FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "assets" ADD CONSTRAINT "assets_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "projects" ADD CONSTRAINT "projects_asset_id_fkey"
    FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "projects" ADD CONSTRAINT "projects_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
