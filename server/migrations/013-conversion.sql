-- each project's conversion map, so a second onboard or doctor run, from any PC,
-- repeats no work and asks no answered question. Keyed by source: a repo file, a folder (its path
-- with a trailing slash), a call (call:<id>) or a run (run:<id>); project is the shared name.
CREATE TABLE conversion (
  project TEXT NOT NULL,
  source TEXT NOT NULL,
  kind TEXT NOT NULL,
  hash TEXT,
  sha TEXT,
  records TEXT NOT NULL DEFAULT '[]',
  fate TEXT,
  why TEXT,
  answer TEXT,
  detail TEXT NOT NULL DEFAULT '{}',
  run TEXT NOT NULL,
  at TEXT NOT NULL,
  PRIMARY KEY (project, source)
) WITHOUT ROWID;
CREATE INDEX conversion_run ON conversion (project, run);
