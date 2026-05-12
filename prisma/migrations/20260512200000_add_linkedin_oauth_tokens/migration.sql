-- AddColumn: LinkedIn OAuth token payload (encrypted JSON, nullable)
-- Mirrors the Meta pattern. Stores access_token + refresh_token + the
-- LinkedIn member URN used for the UGC Posts API.
ALTER TABLE "accounts"
  ADD COLUMN "linkedin_oauth_tokens_encrypted" TEXT;
