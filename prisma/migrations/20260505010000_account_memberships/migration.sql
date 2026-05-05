-- CreateTable
CREATE TABLE IF NOT EXISTS "account_memberships" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "email" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'coordinator',
    "invited_by_id" TEXT,
    "invited_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accepted_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "account_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_membership_account_email" ON "account_memberships"("account_id", "email");
CREATE INDEX IF NOT EXISTS "account_memberships_user_id_idx" ON "account_memberships"("user_id");
CREATE INDEX IF NOT EXISTS "account_memberships_email_idx" ON "account_memberships"("email");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'account_memberships_user_id_fkey') THEN
    ALTER TABLE "account_memberships" ADD CONSTRAINT "account_memberships_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'account_memberships_account_id_fkey') THEN
    ALTER TABLE "account_memberships" ADD CONSTRAINT "account_memberships_account_id_fkey"
      FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
