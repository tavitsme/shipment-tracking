-- 001_init.sql — Shipment Tracking System: full DDL + seed
-- PostgreSQL-flavor. Every CREATE uses IF NOT EXISTS so re-runs are safe.
-- File is UTF-8 (Thai carrier names are stored as UTF-8 TEXT).
-- Multi-statement; the JS runner executes the whole file in one pool.query.

-- ===========================================================================
-- Bookkeeping table for the migration runner. Kept as its own statement so the
-- runner can track it cleanly (NOT bundled into a data transaction).
-- ===========================================================================
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename    TEXT PRIMARY KEY,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===========================================================================
-- 1) carriers — canonical carrier registry (seeded below)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS carriers (
  carrier_code    TEXT PRIMARY KEY,
  carrier_name_en TEXT NOT NULL,
  carrier_name_th TEXT NOT NULL,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===========================================================================
-- 2) tracking_shipments — one row per tracked tracking number (PII-safe)
--    tracking_number_masked: display-safe, e.g. 1234****7890
--    tracking_number_hash:   sha256(salt+number) hex (64 chars), lookup key
-- ===========================================================================
CREATE TABLE IF NOT EXISTS tracking_shipments (
  id                           BIGSERIAL PRIMARY KEY,
  tracking_number_masked       TEXT NOT NULL,
  tracking_number_hash         TEXT NOT NULL,
  carrier_code                 TEXT NOT NULL REFERENCES carriers(carrier_code),
  detected_carrier_code        TEXT,
  current_status_category      TEXT NOT NULL DEFAULT 'unknown',
  current_status_text_original TEXT,
  current_status_text_thai     TEXT,
  last_update_time             TIMESTAMPTZ,
  last_checked_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  provider_used                TEXT,
  raw_response_json            JSONB,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_shipments_hash    ON tracking_shipments(tracking_number_hash);
CREATE INDEX IF NOT EXISTS idx_shipments_carrier ON tracking_shipments(carrier_code);
CREATE INDEX IF NOT EXISTS idx_shipments_status  ON tracking_shipments(current_status_category);

-- ===========================================================================
-- 3) tracking_requests — coarse request audit (no raw PII; only hashes)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS tracking_requests (
  id                BIGSERIAL PRIMARY KEY,
  request_id        TEXT,
  requested_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  client_ip_hash    TEXT,
  user_agent_hash   TEXT,
  carrier_requested TEXT,
  selected_carrier  TEXT,
  numbers_count     INTEGER NOT NULL,
  success           BOOLEAN NOT NULL,
  error_message     TEXT
);
CREATE INDEX IF NOT EXISTS idx_requests_requested ON tracking_requests(requested_at);

-- ===========================================================================
-- 4) tracking_events — per-shipment event timeline (normalized cache)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS tracking_events (
  id                   BIGSERIAL PRIMARY KEY,
  shipment_id          BIGINT NOT NULL REFERENCES tracking_shipments(id) ON DELETE CASCADE,
  event_time           TIMESTAMPTZ,
  location             TEXT,
  status_category      TEXT NOT NULL DEFAULT 'unknown',
  status_text_original TEXT,
  status_text_thai     TEXT,
  raw_event_json       JSONB,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_events_shipment ON tracking_events(shipment_id);
CREATE INDEX IF NOT EXISTS idx_events_status   ON tracking_events(status_category);

-- ===========================================================================
-- 5) api_usage_logs — provider call observability
-- ===========================================================================
CREATE TABLE IF NOT EXISTS api_usage_logs (
  id               BIGSERIAL PRIMARY KEY,
  provider_code    TEXT NOT NULL REFERENCES carriers(carrier_code),
  carrier_code     TEXT NOT NULL REFERENCES carriers(carrier_code),
  request_id       TEXT,
  api_call_status  TEXT,
  response_time_ms INTEGER,
  error_code       TEXT,
  error_message    TEXT,
  logged_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_usage_carrier ON api_usage_logs(carrier_code);
CREATE INDEX IF NOT EXISTS idx_usage_logged  ON api_usage_logs(logged_at);

-- ===========================================================================
-- SEED — 6 carriers. Thai names MUST match CARRIER_NAMES in server/contracts.js
-- exactly. Idempotent via ON CONFLICT DO NOTHING.
-- ===========================================================================
INSERT INTO carriers (carrier_code, carrier_name_en, carrier_name_th, is_active) VALUES
  ('thailand_post',  'Thailand Post',  'ไปรษณีย์ไทย',                 TRUE),
  ('dhl_express',    'DHL Express',    'ดีเอชแอล เอ็กซ์เพรส',        TRUE),
  ('fedex_express',  'FedEx Express',  'เฟดเอ็กซ์ เอ็กซ์เพรส',       TRUE),
  ('ups_express',    'UPS Express',    'ยูพีเอส เอ็กซ์เพรส',         TRUE),
  ('aramex_express', 'Aramex Express', 'อาราเม็กซ์ เอ็กซ์เพรส',      TRUE),
  ('sf_express',     'SF Express',     'เอสเอฟ เอ็กซ์เพรส',          TRUE)
ON CONFLICT (carrier_code) DO NOTHING;
