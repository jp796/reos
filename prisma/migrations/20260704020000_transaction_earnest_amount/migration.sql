-- Earnest money dollar amount on the transaction. The AI already reads it
-- from contracts but had no column to persist into, so the value was
-- silently dropped. Additive + nullable — safe on existing rows.
ALTER TABLE "transactions" ADD COLUMN "earnest_money_amount" DOUBLE PRECISION;
