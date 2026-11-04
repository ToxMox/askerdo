-- a record's old text is kept, and a read by another session is logged.
-- One history row per text change; its id rides the activity line, never the text.
CREATE TABLE history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record TEXT NOT NULL,
  at TEXT NOT NULL,
  actor TEXT,
  field TEXT NOT NULL,
  old TEXT,
  new TEXT,
  why TEXT
);
CREATE INDEX history_record ON history (record, id);

-- One row per record and reading session, outside the activity feed and the stream.
CREATE TABLE reads (
  record TEXT NOT NULL,
  session TEXT NOT NULL,
  site TEXT NOT NULL,
  at TEXT NOT NULL,
  PRIMARY KEY (record, session)
) WITHOUT ROWID;

-- A board with records already counts every one of them used: no read was logged before now.
INSERT INTO meta (name, value) SELECT 'reads.since', strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now')
  WHERE EXISTS (SELECT 1 FROM records);
