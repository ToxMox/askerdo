-- The task shape, one migration
-- for the whole build; each part below stands on its own so a later part adds
-- its statements after the last.

-- Steps: a number given when the step is added, never moved and never reused,
-- an order shown of its own, and a state with a word and when. Today's rows are
-- numbered by their place; a strike was "<at> struck: <why>" inside done_at.
CREATE TABLE steps (
  task TEXT NOT NULL REFERENCES records (key) ON DELETE CASCADE,
  n INTEGER NOT NULL CHECK (n > 0),
  position REAL NOT NULL,
  text TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'done', 'struck')),
  word TEXT,
  at TEXT,
  PRIMARY KEY (task, n)
) WITHOUT ROWID;
CREATE INDEX steps_order ON steps (task, position);

-- The highest number each task has given, so a number stays spent when its row goes.
CREATE TABLE step_tops (
  task TEXT PRIMARY KEY REFERENCES records (key) ON DELETE CASCADE,
  top INTEGER NOT NULL
) WITHOUT ROWID;

INSERT INTO steps (task, n, position, text, state, word, at)
SELECT task, rn, rn, text,
  CASE WHEN done = 0 THEN 'open' WHEN cut > 0 THEN 'struck' ELSE 'done' END,
  CASE WHEN done = 1 AND cut > 0 THEN substr(done_at, cut + 9) END,
  CASE WHEN done = 0 THEN NULL WHEN cut > 0 THEN nullif(substr(done_at, 1, cut - 1), '') ELSE done_at END
FROM (SELECT task, text, done, done_at, instr(coalesce(done_at, ''), ' struck: ') AS cut,
  row_number() OVER (PARTITION BY task ORDER BY position) AS rn FROM checklist);

INSERT INTO step_tops (task, top) SELECT task, max(n) FROM steps GROUP BY task;

DROP TABLE checklist;

-- A task's stored ending is done, where it was completed; json_set keeps the key's place.
UPDATE records SET fields = json_set(fields, '$.status', 'done')
WHERE kind = 'task' AND json_extract(fields, '$.status') = 'completed';

-- Runs: one worker's go at one task or several. How it ended is
-- one stored word; an open run has neither ended nor how.
CREATE TABLE runs (
  id INTEGER PRIMARY KEY,
  worker TEXT NOT NULL CHECK (worker IN ('agent', 'session')),
  agent_id TEXT,
  job TEXT,
  session TEXT,
  pc TEXT,
  repo TEXT,
  branch TEXT,
  start_commit TEXT,
  state_note TEXT,
  started TEXT NOT NULL,
  heard TEXT NOT NULL,
  ended TEXT,
  how TEXT CHECK (how IN ('finished', 'handed_on', 'failed', 'taken_over', 'closed_idle')),
  report TEXT,
  continue_line TEXT,
  landed TEXT,
  handoff TEXT,
  CHECK ((ended IS NULL) = (how IS NULL))
);
CREATE INDEX runs_open_session ON runs (session) WHERE ended IS NULL;
CREATE INDEX runs_open_agent ON runs (agent_id) WHERE ended IS NULL AND agent_id IS NOT NULL;

CREATE TABLE run_tasks (
  run INTEGER NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
  task TEXT NOT NULL REFERENCES records (key) ON DELETE CASCADE,
  PRIMARY KEY (run, task)
) WITHOUT ROWID;
CREATE INDEX run_tasks_task ON run_tasks (task, run);

-- A schema 14 board's facts as runs. Who, where and since come from
-- the activity row that wrote the fact, else the task's own times.
CREATE TEMP TABLE run_seed AS
WITH t AS (
  SELECT key, status, nullif(json_extract(fields, '$.agent'), '') AS agent,
    json_extract(fields, '$.agentEnd.job') AS end_job, json_extract(fields, '$.agentEnd.how') AS end_how,
    json_extract(fields, '$.agentEnd.at') AS end_at, nullif(json_extract(fields, '$.inHand'), '') AS hand,
    json_extract(fields, '$.inHandSince') AS hand_since, coalesce(updated, created, '') AS touched, closed
  FROM records WHERE kind = 'task'
), f AS (
  SELECT t.*, coalesce(agent IS NOT NULL AND end_job = agent AND end_how IN ('finished', 'stopped'), 0) AS marked,
    (SELECT seq FROM activity a WHERE a.record = t.key AND json_extract(a.line, '$.changes.agent[1]') = t.agent ORDER BY seq DESC LIMIT 1) AS agent_row,
    (SELECT seq FROM activity a WHERE a.record = t.key AND json_extract(a.line, '$.changes.inHand[1]') = t.hand ORDER BY seq DESC LIMIT 1) AS hand_row,
    (SELECT seq FROM activity a WHERE a.record = t.key AND json_extract(a.line, '$.changes.status[1]') = 'in_progress' ORDER BY seq DESC LIMIT 1) AS start_row
  FROM t
), kinds AS (
  SELECT key, 'agent' AS worker, agent AS job, coalesce(agent_row, start_row) AS row, NULL AS since,
    coalesce(end_at, touched) AS ended, CASE end_how WHEN 'finished' THEN 'finished' ELSE 'handed_on' END AS how, NULL AS heard, NULL AS hand
  FROM f WHERE marked
  UNION ALL
  SELECT key, 'agent', agent, coalesce(agent_row, start_row), NULL, NULL, NULL, touched, NULL
  FROM f WHERE status = 'in_progress' AND agent IS NOT NULL AND NOT marked
  UNION ALL
  SELECT key, 'session', NULL, hand_row, hand_since, NULL, NULL, (SELECT seen FROM leases WHERE session = f.hand), hand
  FROM f WHERE hand IS NOT NULL AND coalesce(status, '') NOT IN ('done', 'dropped')
  UNION ALL
  SELECT key, 'session', NULL, start_row, NULL, touched, 'handed_on', NULL, NULL
  FROM f WHERE status = 'in_progress' AND agent IS NULL AND hand IS NULL
  UNION ALL
  -- an ended task's agent from before end marks: its go, ended when the task was
  SELECT key, 'agent', agent, coalesce(agent_row, start_row), NULL, coalesce(closed, touched),
    CASE status WHEN 'done' THEN 'finished' ELSE 'handed_on' END, NULL, NULL
  FROM f WHERE status IN ('done', 'dropped') AND agent IS NOT NULL AND NOT marked
), placed AS (
  SELECT k.key AS task, k.worker, k.job, k.ended, k.how,
    coalesce(k.hand, CASE WHEN a.actor LIKE 'session:_%' THEN substr(a.actor, 9) WHEN a.actor LIKE 'user:_%' THEN substr(a.actor, 6) END) AS session,
    a.pc AS pc, coalesce(k.since, a.at, (SELECT touched FROM t WHERE t.key = k.key)) AS started, k.heard
  FROM kinds k LEFT JOIN activity a ON a.seq = k.row
)
SELECT row_number() OVER (ORDER BY started, task, worker) AS id, task, worker, job, session, pc, started,
  coalesce(ended, heard, started) AS heard, ended, how FROM placed;

INSERT INTO runs (id, worker, job, session, pc, started, heard, ended, how)
SELECT id, worker, job, session, pc, started, heard, ended, how FROM run_seed;
INSERT INTO run_tasks (run, task) SELECT id, task FROM run_seed;
DROP TABLE run_seed;

-- Who is on a task is its runs now: the four fields leave every task, and the hand's index goes.
DROP INDEX IF EXISTS records_in_hand;
UPDATE records SET fields = json_remove(fields, '$.inHand', '$.inHandSince', '$.agent', '$.agentEnd')
WHERE kind = 'task' AND (json_type(fields, '$.inHand') IS NOT NULL OR json_type(fields, '$.inHandSince') IS NOT NULL
  OR json_type(fields, '$.agent') IS NOT NULL OR json_type(fields, '$.agentEnd') IS NOT NULL);

-- A task stores open, done or dropped: in progress is read from an open run, made
-- above. A blocked task keeps its notes and gets one line its holder hears at the PC's next
-- catch-up; a deferred one keeps its wake. The line's stamp is local time with its offset.
INSERT INTO activity (line)
SELECT json_object('ts', strftime('%Y-%m-%dT%H:%M:%S', 'now', 'localtime')
    || (SELECT CASE WHEN o < 0 THEN '-' ELSE '+' END || printf('%02d:%02d', abs(o) / 60, abs(o) % 60)
        FROM (SELECT CAST(round((julianday('now', 'localtime') - julianday('now')) * 1440) AS INTEGER) AS o)),
  'verb', 'edit', 'kind', 'task', 'id', coalesce(label, ''), 'key', key, 'name', coalesce(title, ''),
  'changes', json_object('status', json_array('blocked', 'open')), 'by', 'board:migration',
  'note', 'it was blocked, which is no stored status now: its last note says on what')
FROM records WHERE kind = 'task' AND status = 'blocked' ORDER BY id;

UPDATE records SET fields = json_set(fields, '$.status', 'open')
WHERE kind = 'task' AND json_extract(fields, '$.status') IN ('in_progress', 'blocked', 'deferred');
