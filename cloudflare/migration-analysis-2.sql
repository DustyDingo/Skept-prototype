-- Migration 2 (skept-analysis): Fix verdict_state and run_depth CHECK constraints.
-- verdict_state: ('likely_authentic','inconclusive','likely_manipulated') → ('authentic','ambiguous','suspicious','manipulated')
-- run_depth:     ('6s','12s','18s') DEFAULT '6s'                         → ('5s','10s','15s') DEFAULT '5s'
-- Table confirmed 0 rows at time of migration; INSERT ... SELECT is a safe no-op.

CREATE TABLE analysis_history_new (
  id                   TEXT    PRIMARY KEY,
  user_id              TEXT    NOT NULL,
  clip_url             TEXT,
  verdict_state        TEXT    CHECK (verdict_state IN ('authentic', 'ambiguous', 'suspicious', 'manipulated')),
  score                REAL,
  tier_at_creation     TEXT    NOT NULL DEFAULT 'free'
                                 CHECK (tier_at_creation IN ('free', 'lite', 'plus', 'pro', 'max')),
  run_depth            TEXT    NOT NULL DEFAULT '5s'
                                 CHECK (run_depth IN ('5s', '10s', '15s')),
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
