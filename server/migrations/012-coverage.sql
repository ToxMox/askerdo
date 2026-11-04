-- the code each task finished with, and the reviews that read it.
-- One row per commit and task; task '' is a commit no task owns, which a project-wide review reads.
CREATE TABLE commits (
  repo TEXT NOT NULL,
  sha TEXT NOT NULL,
  task TEXT NOT NULL DEFAULT '',
  at TEXT NOT NULL,
  via TEXT NOT NULL,
  session TEXT,
  agent_job TEXT,
  files TEXT NOT NULL DEFAULT '[]',
  added INTEGER NOT NULL DEFAULT 0,
  removed INTEGER NOT NULL DEFAULT 0,
  linked TEXT NOT NULL,
  PRIMARY KEY (repo, sha, task)
) WITHOUT ROWID;
CREATE INDEX commits_task ON commits (task);

-- A review's covers list: each task it read, through that task's newest commit then.
CREATE TABLE covers (
  review TEXT NOT NULL,
  task TEXT NOT NULL,
  at TEXT NOT NULL,
  through TEXT,
  through_at TEXT,
  PRIMARY KEY (review, task)
) WITHOUT ROWID;
CREATE INDEX covers_task ON covers (task);
