-- History of scan runs from /scan
CREATE TABLE "scan_runs" (
  "id" TEXT NOT NULL,
  "account_id" TEXT NOT NULL,
  "scan_type" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'gmail',
  "params_json" JSONB,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finished_at" TIMESTAMP(3),
  "hits_count" INTEGER NOT NULL DEFAULT 0,
  "error_text" TEXT,

  CONSTRAINT "scan_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "scan_runs_account_id_started_at_idx"
  ON "scan_runs" ("account_id", "started_at");

ALTER TABLE "scan_runs"
  ADD CONSTRAINT "scan_runs_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "accounts"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
