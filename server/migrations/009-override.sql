-- the user's override of a used record. One row per pending request,
-- gone once the user decides; the export and the import carry it.
CREATE TABLE overrides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('fix', 'withdraw', 'scrub')),
  summary TEXT NOT NULL,
  reason TEXT NOT NULL,
  session TEXT NOT NULL,
  at TEXT NOT NULL,
  reversal INTEGER NOT NULL DEFAULT 0 CHECK (reversal IN (0, 1)),
  measure TEXT NOT NULL CHECK (json_valid(measure)),
  changed TEXT
);

-- One pending request per record: the primary key refuses a second.
CREATE TABLE override_items (
  record TEXT PRIMARY KEY,
  request INTEGER NOT NULL REFERENCES overrides (id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  proposed TEXT NOT NULL CHECK (json_valid(proposed)),
  hash TEXT NOT NULL
) WITHOUT ROWID;
CREATE INDEX override_items_request ON override_items (request, position);

-- A scrub's originals, sealed until `until`, then purged by the nightly backup.
-- The export never writes this table.
CREATE TABLE seals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record TEXT NOT NULL,
  request INTEGER NOT NULL,
  at TEXT NOT NULL,
  until TEXT NOT NULL,
  rows TEXT NOT NULL CHECK (json_valid(rows))
);
CREATE INDEX seals_record ON seals (record);
