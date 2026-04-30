-- Listings phase. status='listing' = property listed but pre-contract;
-- flips to 'active' on Convert to Transaction. List price + listing
-- expiration are listing-only fields.
ALTER TABLE "transactions"
  ADD COLUMN "listing_expiration_date" TIMESTAMP(3),
  ADD COLUMN "list_price" DOUBLE PRECISION;
