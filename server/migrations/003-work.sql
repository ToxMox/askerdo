-- The label pick (server/verbs/labels.mjs) reads every label row of a kind with
-- its record's life; these covering indexes keep that read off the JSON
-- (6.4 ms to 1.0 ms over a board of real questions).
CREATE INDEX labels_pick ON labels (kind, origin, label, key, "to");
CREATE INDEX records_life ON records (kind, key, label, status, closed, updated, created);
-- Taking a task in hand lets go of the session's other one: found by index, not a scan.
CREATE INDEX records_in_hand ON records (json_extract(fields, '$.inHand')) WHERE kind = 'task';
