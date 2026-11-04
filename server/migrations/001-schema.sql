-- The board's tables. Front values live in
-- `fields` as JSON in file order; the columns a query filters on are generated
-- from it, so a column can never disagree with the record it describes.

CREATE TABLE meta (
  name TEXT PRIMARY KEY,
  value TEXT NOT NULL
) WITHOUT ROWID;

CREATE TABLE records (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  slug TEXT,
  fields TEXT NOT NULL CHECK (json_valid(fields)),
  body TEXT NOT NULL DEFAULT '',
  layout TEXT CHECK (layout IS NULL OR json_valid(layout)),
  track TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  label TEXT GENERATED ALWAYS AS (json_extract(fields, '$.id')) VIRTUAL,
  status TEXT GENERATED ALWAYS AS (json_extract(fields, '$.status')) VIRTUAL,
  title TEXT GENERATED ALWAYS AS (json_extract(fields, '$.name')) VIRTUAL,
  workstream TEXT GENERATED ALWAYS AS (json_extract(fields, '$.workstream')) VIRTUAL,
  created TEXT GENERATED ALWAYS AS (json_extract(fields, '$.created')) VIRTUAL,
  updated TEXT GENERATED ALWAYS AS (json_extract(fields, '$.updated')) VIRTUAL,
  closed TEXT GENERATED ALWAYS AS (coalesce(json_extract(fields, '$.closed'), json_extract(fields, '$.answered'))) VIRTUAL
);
CREATE INDEX records_kind_status ON records (kind, status);
CREATE INDEX records_label ON records (label);
CREATE INDEX records_workstream ON records (workstream);
CREATE INDEX records_track ON records (track);

-- Every label a record has held, by day, so a reused label resolves by date.
-- origin: 'history' (a record's labelHistory), 'id-map' (pre-cutover labels),
-- 'brain' (old brain ids; key is null where the id names an archive path).
CREATE TABLE labels (
  id INTEGER PRIMARY KEY,
  label TEXT NOT NULL,
  key TEXT,
  kind TEXT,
  "from" TEXT,
  "to" TEXT,
  origin TEXT NOT NULL,
  position INTEGER NOT NULL,
  extra TEXT CHECK (extra IS NULL OR json_valid(extra))
);
CREATE INDEX labels_label ON labels (label, "from");
CREATE INDEX labels_key ON labels (key);

CREATE TABLE notes (
  id INTEGER PRIMARY KEY,
  record TEXT NOT NULL REFERENCES records (key) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  at TEXT,
  actor TEXT,
  body TEXT NOT NULL,
  UNIQUE (record, position)
);

CREATE TABLE handoffs (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  slug TEXT,
  fields TEXT NOT NULL CHECK (json_valid(fields)),
  state TEXT NOT NULL,
  where_we_were TEXT,
  verify TEXT NOT NULL CHECK (json_valid(verify)),
  track TEXT,
  pc TEXT,
  label TEXT GENERATED ALWAYS AS (json_extract(fields, '$.id')) VIRTUAL,
  thread TEXT GENERATED ALWAYS AS (json_extract(fields, '$.thread')) VIRTUAL,
  status TEXT GENERATED ALWAYS AS (json_extract(fields, '$.status')) VIRTUAL,
  focus TEXT GENERATED ALWAYS AS (json_extract(fields, '$.focus')) VIRTUAL,
  session TEXT GENERATED ALWAYS AS (json_extract(fields, '$.fromSession')) VIRTUAL,
  created TEXT GENERATED ALWAYS AS (json_extract(fields, '$.created')) VIRTUAL
);
CREATE INDEX handoffs_label ON handoffs (label);
CREATE INDEX handoffs_thread ON handoffs (thread);
CREATE INDEX handoffs_track ON handoffs (track);

-- A task's track and its tie-break order live only here.
CREATE TABLE track_items (
  track TEXT NOT NULL REFERENCES records (key) ON DELETE CASCADE,
  task TEXT NOT NULL UNIQUE REFERENCES records (key) ON DELETE CASCADE,
  position REAL NOT NULL,
  PRIMARY KEY (track, task)
) WITHOUT ROWID;
CREATE INDEX track_items_order ON track_items (track, position);

-- "Depends on" edges; the verb that adds one refuses a cycle.
CREATE TABLE depends (
  task TEXT NOT NULL REFERENCES records (key) ON DELETE CASCADE,
  "on" TEXT NOT NULL REFERENCES records (key) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  added TEXT NOT NULL,
  actor TEXT,
  PRIMARY KEY (task, "on"),
  CHECK (task <> "on")
) WITHOUT ROWID;
CREATE INDEX depends_on ON depends ("on");

CREATE TABLE checklist (
  task TEXT NOT NULL REFERENCES records (key) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  text TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1)),
  done_at TEXT,
  PRIMARY KEY (task, position)
) WITHOUT ROWID;

-- gates, cites, revisits, junction, related. "to" holds what the record
-- stores: a key, or a label from before the cutover.
CREATE TABLE links (
  "from" TEXT NOT NULL REFERENCES records (key) ON DELETE CASCADE,
  "to" TEXT NOT NULL,
  type TEXT NOT NULL,
  added TEXT,
  PRIMARY KEY ("from", "to", type)
) WITHOUT ROWID;
CREATE INDEX links_to ON links ("to", type);

-- One live lease per track and one track per session.
CREATE TABLE leases (
  track TEXT PRIMARY KEY REFERENCES records (key) ON DELETE CASCADE,
  session TEXT NOT NULL UNIQUE,
  pc TEXT,
  since TEXT NOT NULL,
  seen TEXT NOT NULL
) WITHOUT ROWID;

-- The audit trail and the stream's resume point. `line` is the row as the
-- stream and the export carry it; the columns are read from it.
CREATE TABLE activity (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  line TEXT NOT NULL CHECK (json_valid(line) AND json_extract(line, '$.ts') IS NOT NULL),
  at TEXT GENERATED ALWAYS AS (json_extract(line, '$.ts')) VIRTUAL,
  actor TEXT GENERATED ALWAYS AS (json_extract(line, '$.by')) VIRTUAL,
  verb TEXT GENERATED ALWAYS AS (json_extract(line, '$.verb')) VIRTUAL,
  kind TEXT GENERATED ALWAYS AS (json_extract(line, '$.kind')) VIRTUAL,
  record TEXT GENERATED ALWAYS AS (json_extract(line, '$.key')) VIRTUAL,
  label TEXT GENERATED ALWAYS AS (json_extract(line, '$.id')) VIRTUAL,
  diff TEXT GENERATED ALWAYS AS (json_extract(line, '$.changes')) VIRTUAL
);
CREATE INDEX activity_record ON activity (record);
CREATE INDEX activity_at ON activity (at);

-- Titles, bodies and notes. rowid = source id * 4 + 0 record, 1 note, 2 handoff.
-- Contentless: the text stays in its own table, only key and src are kept here.
CREATE VIRTUAL TABLE search USING fts5 (title, body, key UNINDEXED, src UNINDEXED,
  content = '', contentless_delete = 1, contentless_unindexed = 1, tokenize = 'unicode61');

CREATE TRIGGER records_search_insert AFTER INSERT ON records BEGIN
  INSERT INTO search (rowid, title, body, key, src) VALUES (new.id * 4, coalesce(new.title, ''), new.body, new.key, new.kind);
END;
CREATE TRIGGER records_search_update AFTER UPDATE OF fields, body ON records BEGIN
  DELETE FROM search WHERE rowid = old.id * 4;
  INSERT INTO search (rowid, title, body, key, src) VALUES (new.id * 4, coalesce(new.title, ''), new.body, new.key, new.kind);
END;
CREATE TRIGGER records_search_delete AFTER DELETE ON records BEGIN
  DELETE FROM search WHERE rowid = old.id * 4;
END;

CREATE TRIGGER notes_search_insert AFTER INSERT ON notes BEGIN
  INSERT INTO search (rowid, title, body, key, src) VALUES (new.id * 4 + 1, '', new.body, new.record, 'note');
END;
CREATE TRIGGER notes_search_update AFTER UPDATE OF body ON notes BEGIN
  DELETE FROM search WHERE rowid = old.id * 4 + 1;
  INSERT INTO search (rowid, title, body, key, src) VALUES (new.id * 4 + 1, '', new.body, new.record, 'note');
END;
CREATE TRIGGER notes_search_delete AFTER DELETE ON notes BEGIN
  DELETE FROM search WHERE rowid = old.id * 4 + 1;
END;

CREATE TRIGGER handoffs_search_insert AFTER INSERT ON handoffs BEGIN
  INSERT INTO search (rowid, title, body, key, src)
  VALUES (new.id * 4 + 2, coalesce(new.focus, ''), new.state || char(10) || coalesce(new.where_we_were, ''), new.key, 'handoff');
END;
CREATE TRIGGER handoffs_search_update AFTER UPDATE OF fields, state, where_we_were ON handoffs BEGIN
  DELETE FROM search WHERE rowid = old.id * 4 + 2;
  INSERT INTO search (rowid, title, body, key, src)
  VALUES (new.id * 4 + 2, coalesce(new.focus, ''), new.state || char(10) || coalesce(new.where_we_were, ''), new.key, 'handoff');
END;
CREATE TRIGGER handoffs_search_delete AFTER DELETE ON handoffs BEGIN
  DELETE FROM search WHERE rowid = old.id * 4 + 2;
END;
