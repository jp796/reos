-- Structured co-op agent + title company contact fields (system of record)
ALTER TABLE "transactions"
  ADD COLUMN IF NOT EXISTS "title_company_contact" TEXT,
  ADD COLUMN IF NOT EXISTS "title_company_phone" TEXT,
  ADD COLUMN IF NOT EXISTS "title_company_email" TEXT,
  ADD COLUMN IF NOT EXISTS "co_agent_name" TEXT,
  ADD COLUMN IF NOT EXISTS "co_agent_brokerage" TEXT,
  ADD COLUMN IF NOT EXISTS "co_agent_phone" TEXT,
  ADD COLUMN IF NOT EXISTS "co_agent_email" TEXT,
  ADD COLUMN IF NOT EXISTS "co_agent_license" TEXT;
