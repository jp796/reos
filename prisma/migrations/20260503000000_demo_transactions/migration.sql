-- Demo / sandbox transaction flag. Filtered out of every analytics
-- rollup (Production / Sources / Digest / Pipeline). Wiped via
-- Settings → Demo data → Reset.
ALTER TABLE "transactions"
  ADD COLUMN "is_demo" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "transactions_is_demo_idx" ON "transactions" ("is_demo");
