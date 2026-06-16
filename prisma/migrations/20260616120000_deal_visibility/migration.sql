-- Per-deal visibility lock (spec: restrict a deal to its assigned TC +
-- owners/admins). Additive: one nullable-defaulted boolean. Existing
-- deals default to false = account-wide visible, so nothing changes.
ALTER TABLE "transactions" ADD COLUMN "restricted_to_assignee" BOOLEAN NOT NULL DEFAULT false;
