-- Provenance for the co-op agent: contract | email_signature | manual
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "co_agent_source" TEXT;
