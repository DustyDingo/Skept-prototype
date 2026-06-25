-- Skept D1 Schema — skept-analysis database
-- Tables: analysis_history, viewed_history, quota_usage, seals
--
-- Run against the skept-analysis database:
--   wrangler d1 execute skept-analysis --remote --file=./skept_d1_schema.sql --config wrangler-analysis.toml
--
-- The skept-auth database (users, auth_tokens, tombstones)
-- is a separate database — see skept_d1_schema_auth.sql.

PRAGMA foreign_keys = ON;

-- ── analysis_history ───────────────────────────────────────────────────────
-- One row per completed analysis job.

CREATE TABLE IF NOT EXISTS analysis_history (
  id                   TEXT    PRIMARY KEY,             -- UUID job ID
  user_id              TEXT    NOT NULL,                -- references skept-auth users.id
  url                  TEXT,                            -- submitted URL (NULL for file uploads)
  verdict              TEXT    CHECK (verdict IN ('likely_authentic', 'inconclusive', 'likely_manipulated')),
  score                REAL,                            -- fusion score 0.0–1.0
  tier_used            TEXT    NOT NULL DEFAULT 'free'
                                 CHECK (tier_used IN ('free', 'plus', 'pro', 'max')),
  depth                TEXT    NOT NULL DEFAULT '6s'
                                 CHECK (depth IN ('6s', '12s', '18s')),
  trimmed              INTEGER NOT NULL DEFAULT 0,      -- 1 = clip was trimmed before Resemble submission
  original_duration_s  INTEGER,                         -- original clip duration in seconds
  created_at           INTEGER NOT NULL,                -- Unix epoch seconds
  r2_key               TEXT,                            -- R2 object key for the full clip file
  priority_queue       INTEGER NOT NULL DEFAULT 0       -- boolean: 1 = Max-tier priority queue job
);

CREATE INDEX IF NOT EXISTS idx_analysis_history_user_id    ON analysis_history (user_id);
CREATE INDEX IF NOT EXISTS idx_analysis_history_created_at ON analysis_history (created_at);

-- ── viewed_history ─────────────────────────────────────────────────────────
-- Records when a user views a result page (for deduplication and history UI).

CREATE TABLE IF NOT EXISTS viewed_history (
  id           TEXT    PRIMARY KEY,                     -- UUID
  user_id      TEXT    NOT NULL,                        -- references skept-auth users.id
  analysis_id  TEXT    NOT NULL,                        -- references analysis_history.id
  viewed_at    INTEGER NOT NULL                         -- Unix epoch seconds
);

CREATE INDEX IF NOT EXISTS idx_viewed_history_user_id    ON viewed_history (user_id);
CREATE INDEX IF NOT EXISTS idx_viewed_history_analysis_id ON viewed_history (analysis_id);

-- ── quota_usage ────────────────────────────────────────────────────────────
-- One row per user. Tracks runs within the current 30-day window.
-- window_start resets every 2592000 seconds (30 days).
-- run_count increments after each successful analysis job.

CREATE TABLE IF NOT EXISTS quota_usage (
  user_id       TEXT    PRIMARY KEY,                    -- references skept-auth users.id
  run_count     INTEGER NOT NULL DEFAULT 0,
  window_start  INTEGER NOT NULL,                       -- Unix epoch seconds; start of 30-day window
  updated_at    INTEGER NOT NULL                        -- Unix epoch seconds
);

-- ── seals ──────────────────────────────────────────────────────────────────
-- Verifiable public certificates linking a URL to a Skept verdict.
-- Public token is shareable and embeddable.

CREATE TABLE IF NOT EXISTS seals (
  id            TEXT    PRIMARY KEY,                    -- UUID
  analysis_id   TEXT    NOT NULL,                       -- references analysis_history.id
  user_id       TEXT    NOT NULL,                       -- references skept-auth users.id
  public_token  TEXT    NOT NULL UNIQUE,                -- URL-safe random token for public lookup
  verdict       TEXT    CHECK (verdict IN ('likely_authentic', 'inconclusive', 'likely_manipulated')),
  score         REAL,                                   -- fusion score at time of sealing
  created_at    INTEGER NOT NULL,                       -- Unix epoch seconds
  expires_at    INTEGER                                 -- NULL = no expiry
);

CREATE INDEX IF NOT EXISTS idx_seals_public_token  ON seals (public_token);
CREATE INDEX IF NOT EXISTS idx_seals_analysis_id   ON seals (analysis_id);
CREATE INDEX IF NOT EXISTS idx_seals_user_id        ON seals (user_id);
