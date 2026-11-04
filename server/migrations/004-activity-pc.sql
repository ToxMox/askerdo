-- The PC an activity row came from, beside its line: the line keeps
-- today's `by` exactly, so a month still renders as today's writer wrote it.
ALTER TABLE activity ADD COLUMN pc TEXT;
