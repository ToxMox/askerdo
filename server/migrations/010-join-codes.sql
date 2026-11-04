-- a join code lets a new PC onto the board without a token copied between
-- machines. Only a sha256 of the code is stored; it works once, within minutes.

-- One live code per minting device: minting a new one replaces the old. `device`,
-- when set, is the only name the code takes; `tries` counts the failed joins made
-- while the code was live, the last at `tried`, which is what the guess cap reads.
CREATE TABLE join_codes (
  hash TEXT PRIMARY KEY,
  minted_by TEXT NOT NULL UNIQUE,
  device TEXT,
  created TEXT NOT NULL,
  expires TEXT NOT NULL,
  used TEXT,
  tries INTEGER NOT NULL DEFAULT 0,
  tried TEXT
) WITHOUT ROWID;
