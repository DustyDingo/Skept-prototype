-- Migration A: skept-auth users table
-- Adds 'lite' to tier CHECK; adds stripe_customer_id column; recreates indexes.
-- D1 does not support ALTER COLUMN — full CREATE/INSERT/DROP/RENAME cycle required.

PRAGMA foreign_keys = OFF;

CREATE TABLE users_new (
  id                   TEXT    PRIMARY KEY,
  email_hash           TEXT    NOT NULL UNIQUE,
  email_encrypted      TEXT    NOT NULL,
  display_name         TEXT    NOT NULL DEFAULT '',
  avatar_initials      TEXT    NOT NULL DEFAULT '',
  tier                 TEXT    NOT NULL DEFAULT 'free'
                                 CHECK (tier IN ('free', 'lite', 'plus', 'pro', 'max')),
  tier_expires_at      INTEGER,
  subscription_source  TEXT
                                 CHECK (subscription_source IN ('stripe', 'revenuecat')
                                        OR subscription_source IS NULL),
  subscription_ref     TEXT,
  stripe_customer_id   TEXT,
  theme                TEXT    NOT NULL DEFAULT 'system'
                                 CHECK (theme IN ('system', 'light', 'dark')),
  notif_analysis_done  INTEGER NOT NULL DEFAULT 1,
  notif_origin_found   INTEGER NOT NULL DEFAULT 1,
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL
);

INSERT INTO users_new (
  id, email_hash, email_encrypted, display_name, avatar_initials,
  tier, tier_expires_at, subscription_source, subscription_ref,
  theme, notif_analysis_done, notif_origin_found, created_at, updated_at
)
SELECT
  id, email_hash, email_encrypted, display_name, avatar_initials,
  tier, tier_expires_at, subscription_source, subscription_ref,
  theme, notif_analysis_done, notif_origin_found, created_at, updated_at
FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

CREATE INDEX idx_users_email_hash ON users(email_hash);
CREATE INDEX idx_users_tier ON users(tier);
CREATE UNIQUE INDEX idx_users_stripe_customer_id ON users(stripe_customer_id);

PRAGMA foreign_keys = ON;
