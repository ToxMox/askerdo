-- Device tokens, web sessions and login links. Only a sha256 of
-- each secret is stored, so a copy of the file or a backup hands out no access.

-- One live token per device: minting a new one revokes the old.
CREATE TABLE tokens (
  id INTEGER PRIMARY KEY,
  device TEXT NOT NULL,
  hash TEXT NOT NULL UNIQUE,
  created TEXT NOT NULL,
  revoked TEXT
);
CREATE INDEX tokens_device ON tokens (device, revoked);

-- A login link opens once, within minutes, and sets a web session's cookie.
CREATE TABLE login_links (
  hash TEXT PRIMARY KEY,
  device TEXT NOT NULL,
  next TEXT NOT NULL,
  expires TEXT NOT NULL
) WITHOUT ROWID;

CREATE TABLE web_sessions (
  hash TEXT PRIMARY KEY,
  device TEXT NOT NULL,
  created TEXT NOT NULL,
  expires TEXT NOT NULL
) WITHOUT ROWID;
