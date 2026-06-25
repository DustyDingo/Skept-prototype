-- Skept D1 Schema — skept-auth database only
-- Tables: users, auth_tokens, tombstones
--
-- Run against the skept-auth database:
--   wrangler d1 execute skept-auth --file=./skept_d1_schema_auth.sql --config wrangler-auth.toml
--
-- The skept-analysis database (analysis_history, quota_usage, seals, viewed_history)
-- is a separate database and is NOT included here.

PRAGMA foreign_keys = ON;

-- ── users ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id                   TEXT    PRIMARY KEY,
  email_hash           TEXT    NOT NULL UNIQUE,      -- SHA-256 of lowercased email
  email_encrypted      TEXT    NOT NULL,             -- AES-256-GCM; stored as base64(iv + ciphertext)
  display_name         TEXT    NOT NULL DEFAULT '',
  avatar_initials      TEXT    NOT NULL DEFAULT '',  -- max 2 chars
  tier                 TEXT    NOT NULL DEFAULT 'free'
                                 CHECK (tier IN ('free', 'plus', 'pro', 'max')),
  tier_expires_at      INTEGER,                      -- NULL for Free tier
  subscription_source  TEXT
                                 CHECK (subscription_source IN ('stripe', 'revenuecat')
                                        OR subscription_source IS NULL),
  subscription_ref     TEXT,
  theme                TEXT    NOT NULL DEFAULT 'system'
                                 CHECK (theme IN ('system', 'light', 'dark')),
  notif_analysis_done  INTEGER NOT NULL DEFAULT 1,
  notif_origin_found   INTEGER NOT NULL DEFAULT 1,
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_email_hash ON users (email_hash);
CREATE INDEX IF NOT EXISTS idx_users_tier       ON users (tier);

-- ── auth_tokens ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS auth_tokens (
  id           TEXT    PRIMARY KEY,
  user_id      TEXT,                                 -- NULL allowed for pre-registration links
  token_hash   TEXT    NOT NULL UNIQUE,              -- SHA-256 of raw token; raw token never stored
  type         TEXT    NOT NULL CHECK (type IN ('magic_link', 'session_audit')),
  used         INTEGER NOT NULL DEFAULT 0,           -- 1 = consumed
  expires_at   INTEGER NOT NULL,                     -- magic_link = created_at + 900
  ip_hash      TEXT,                                 -- SHA-256(client_ip + IP_SALT)
  created_at   INTEGER NOT NULL,
  used_at      INTEGER,                              -- NULL until consumed
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_auth_tokens_token_hash  ON auth_tokens (token_hash);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_user_id     ON auth_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_expires_at  ON auth_tokens (expires_at);

-- ── tombstones ─────────────────────────────────────────────────────────────
-- Written on account deletion. Checked on every magic link request.
-- Prevents re-registration during cooldown period.

CREATE TABLE IF NOT EXISTS tombstones (
  id                   TEXT    PRIMARY KEY,
  email_hash           TEXT    NOT NULL,             -- SHA-256 of deleted account email
  device_fingerprint   TEXT,                         -- hashed device signal; NULL in Phase 1
  ever_paid            INTEGER NOT NULL DEFAULT 0,   -- 1 = held Plus/Pro/Max at any point
  deletion_timestamp   INTEGER NOT NULL,
  cooldown_expires_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tombstones_email_hash          ON tombstones (email_hash);
CREATE INDEX IF NOT EXISTS idx_tombstones_device_fingerprint  ON tombstones (device_fingerprint);
CREATE INDEX IF NOT EXISTS idx_tombstones_cooldown_expires_at ON tombstones (cooldown_expires_at);
