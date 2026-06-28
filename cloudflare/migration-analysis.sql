-- Migration B: skept-analysis
-- (1) quota_usage: add quota_limit, topup_credits, topup_expires_at columns.
-- (2) analysis_history: add 'lite' to tier_at_creation CHECK via CREATE/INSERT/DROP/RENAME.

-- Part 1: quota_usage — ALTER TABLE ADD COLUMN (safe; no constraint change needed)
ALTER TABLE quota_usage ADD COLUMN quota_limit     INTEGER NOT NULL DEFAULT 5;
ALTER TABLE quota_usage ADD COLUMN topup_credits   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE quota_usage ADD COLUMN topup_expires_at INTEGER;

-- Part 2: analysis_history — full cycle to change tier_at_creation CHECK

CREATE TABLE analysis_history_new (
  id                   TEXT    PRIMARY KEY,
  user_id              TEXT    NOT NULL,
  clip_url             TEXT,
  verdict_state        TEXT    CHECK (verdict_state IN ('likely_authentic', 'inconclusive', 'likely_manipulated')),
  score                REAL,
  tier_at_creation     TEXT    NOT NULL DEFAULT 'free'
                                 CHECK (tier_at_creation IN ('free', 'lite', 'plus', 'pro', 'max')),
  run_depth            TEXT    NOT NULL DEFAULT '6s'
                                 CHECK (run_depth IN ('6s', '12s', '18s')),
  trimmed              INTEGER NOT NULL DEFAULT 0,
  original_duration_s  INTEGER,
  created_at           INTEGER NOT NULL,
  r2_key               TEXT,
  priority_queue       INTEGER NOT NULL DEFAULT 0,
  permalink_uuid       TEXT,
  platform             TEXT    NOT NULL DEFAULT 'unknown',
  thumbnail_r2_key     TEXT,
  strongest_signal     TEXT,
  model_version        TEXT,
  evidence_json        TEXT,
  conflict_flags       TEXT,
  reanalysis_of        TEXT,
  purge_after          INTEGER NOT NULL DEFAULT 0
);

INSERT INTO analysis_history_new SELECT * FROM analysis_history;

DROP TABLE analysis_history;
ALTER TABLE analysis_history_new RENAME TO analysis_history;

CREATE INDEX idx_analysis_history_created_at ON analysis_history (created_at);
CREATE INDEX idx_analysis_history_user_id    ON analysis_history (user_id);
