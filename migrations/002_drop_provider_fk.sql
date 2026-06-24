-- 002_drop_provider_fk.sql
--
-- The api_usage_logs.provider_code column stores an implementation label
-- (e.g. 'direct_dhl', 'direct_fedex') which is conceptually a *provider*,
-- not a *carrier*. The 001 migration incorrectly made it a foreign key to
-- carriers(carrier_code), so inserting 'direct_dhl' violates the FK because
-- only carrier codes (e.g. 'dhl_express') exist in carriers.
--
-- Fix: drop the FK constraint so provider_code can hold the provider label
-- freely. carrier_code keeps its FK to carriers (data integrity for the
-- carrier dimension is preserved).
--
-- Idempotent: IF EXISTS makes re-runs safe.

ALTER TABLE api_usage_logs
  DROP CONSTRAINT IF EXISTS api_usage_logs_provider_code_fkey;
