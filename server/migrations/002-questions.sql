-- The question verbs' indexes. The label picker reads every record of
-- a kind and the alone rule one session's questions; both read an index, never
-- the rows, whose bodies spill to overflow pages and cost 9 ms a pass. A derived
-- subscription is a session's surface rows, found by verb and actor.
CREATE INDEX records_label_state ON records (kind, json_extract(fields, '$.id'), json_extract(fields, '$.status'),
  coalesce(json_extract(fields, '$.closed'), json_extract(fields, '$.answered')),
  json_extract(fields, '$.updated'), json_extract(fields, '$.created'));
CREATE INDEX records_question_session ON records (json_extract(fields, '$.session'), json_extract(fields, '$.created'))
  WHERE kind = 'question';
CREATE INDEX activity_verb_actor ON activity (verb, actor);
