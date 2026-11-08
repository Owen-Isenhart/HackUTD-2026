ALTER TABLE hackutd_finance.confirmed_memory
  ADD COLUMN IF NOT EXISTS reserve_cents bigint CHECK (reserve_cents BETWEEN 0 AND 9007199254740991);
