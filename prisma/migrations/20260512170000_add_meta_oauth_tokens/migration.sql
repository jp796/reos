-- AddColumn: Meta OAuth token payload (encrypted JSON, nullable)
-- Stores user token + per-page tokens + IG business accounts for the
-- Facebook + Instagram social-posting flow.
ALTER TABLE "accounts"
  ADD COLUMN "meta_oauth_tokens_encrypted" TEXT;
