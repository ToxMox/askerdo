-- Closing tasks: an open or parked promoted side track's
-- pointer becomes a plain task with an edge on each of its parts, the track loses its
-- origin and keeps its junction links, so it reads as a side line as a splinter does.
-- A closed promoted track needs nothing: its pointer is done, or plain again with its note.
CREATE TEMP TABLE closing AS
SELECT s.key AS side, s.label AS side_label, p.key AS pointer, p.label AS pointer_label, coalesce(p.title, '') AS pointer_name,
  strftime('%Y-%m-%dT%H:%M:%S', 'now', 'localtime')
    || (SELECT CASE WHEN o < 0 THEN '-' ELSE '+' END || printf('%02d:%02d', abs(o) / 60, abs(o) % 60)
        FROM (SELECT CAST(round((julianday('now', 'localtime') - julianday('now')) * 1440) AS INTEGER) AS o)) AS at
FROM records s
JOIN links l ON l."from" = s.key AND l.type = 'junction'
JOIN records p ON p.key = l."to" AND p.kind = 'task'
WHERE s.kind = 'track' AND json_extract(s.fields, '$.origin') = 'promote' AND s.status IN ('open', 'parked');

-- An edge that would close a loop (a part already waiting on its pointer) is left out.
INSERT OR IGNORE INTO depends (task, "on", reason, added, actor)
SELECT c.pointer, ti.task, 'a part of this outcome, promoted to ' || c.side_label || ' before', c.at, 'board:migration'
FROM closing c
JOIN track_items ti ON ti.track = c.side
JOIN records t ON t.key = ti.task AND coalesce(t.status, '') <> 'dropped'
WHERE ti.task <> c.pointer AND NOT EXISTS (
  WITH RECURSIVE up(k) AS (SELECT ti.task UNION SELECT d."on" FROM up JOIN depends d ON d.task = up.k)
  SELECT 1 FROM up WHERE k = c.pointer);

INSERT INTO activity (line)
SELECT json_object('ts', c.at, 'verb', 'edit', 'kind', 'task', 'id', coalesce(c.pointer_label, ''), 'key', c.pointer, 'name', c.pointer_name,
  'changes', json_object('dependsOn', json_array(NULL, (SELECT json_group_array(d."on") FROM depends d WHERE d.task = c.pointer AND d.actor = 'board:migration' AND d.added = c.at))),
  'by', 'board:migration',
  'note', 'promoted to ' || c.side_label || ', which is gone as a way of working: its parts are its edges now, so it closes once they end')
FROM closing c ORDER BY c.pointer_label;

UPDATE records SET fields = json_remove(fields, '$.origin')
WHERE key IN (SELECT side FROM closing);

DROP TABLE closing;
