-- Automatic upkeep: a write that ends a record finds the parked lines
-- and the close-with tasks that name it by these, never by a scan of records.
CREATE INDEX records_unpark_on ON records (json_extract(fields, '$.unparkWhen.on')) WHERE kind = 'track';
CREATE INDEX records_close_on ON records (json_extract(fields, '$.close.kind'), json_extract(fields, '$.close.on')) WHERE kind = 'task';
