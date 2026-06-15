-- Investor Module — Phase 2: Draw engine + Capital stack (spec §2, §7).
-- Additive: three new tables + FKs. No changes to existing tables.

CREATE TABLE "draw_schedules" (
    "id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "retainage_percent" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "total_budget" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "draw_schedules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "draws" (
    "id" TEXT NOT NULL,
    "draw_schedule_id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "milestone" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "lien_waiver_doc_id" TEXT,
    "verify_photos_json" JSONB,
    "retainage_held" DOUBLE PRECISION,
    "lender_release_ref" TEXT,
    "requested_at" TIMESTAMP(3),
    "verified_at" TIMESTAMP(3),
    "released_at" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "draws_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "capital_stack_entries" (
    "id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "lender_contact_id" TEXT,
    "type" TEXT NOT NULL,
    "principal" DOUBLE PRECISION,
    "rate" DOUBLE PRECISION,
    "balloon_date" TIMESTAMP(3),
    "payoff_balance" DOUBLE PRECISION,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "capital_stack_entries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "draw_schedules_asset_id_idx" ON "draw_schedules"("asset_id");
CREATE INDEX "draw_schedules_account_id_idx" ON "draw_schedules"("account_id");
CREATE INDEX "draws_draw_schedule_id_idx" ON "draws"("draw_schedule_id");
CREATE INDEX "draws_asset_id_idx" ON "draws"("asset_id");
CREATE INDEX "capital_stack_entries_asset_id_idx" ON "capital_stack_entries"("asset_id");
CREATE INDEX "capital_stack_entries_account_id_idx" ON "capital_stack_entries"("account_id");

ALTER TABLE "draw_schedules" ADD CONSTRAINT "draw_schedules_asset_id_fkey"
    FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "draw_schedules" ADD CONSTRAINT "draw_schedules_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "draws" ADD CONSTRAINT "draws_draw_schedule_id_fkey"
    FOREIGN KEY ("draw_schedule_id") REFERENCES "draw_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "draws" ADD CONSTRAINT "draws_asset_id_fkey"
    FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "capital_stack_entries" ADD CONSTRAINT "capital_stack_entries_asset_id_fkey"
    FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "capital_stack_entries" ADD CONSTRAINT "capital_stack_entries_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "capital_stack_entries" ADD CONSTRAINT "capital_stack_entries_lender_contact_id_fkey"
    FOREIGN KEY ("lender_contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
