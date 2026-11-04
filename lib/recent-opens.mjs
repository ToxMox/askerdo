/* The server's own touch stamp: the files a record's opener actually
   opened, written on a dispatched open and never on the record, because the CLI
   stays the only writer of records. board/ is untracked, so no path is kept. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeAtomic } from './store-io.mjs';

/* Twenty stored and five on the tray menu: the file is a short history and
   the menu shows a shorter one. */
export const RECENT_MAX = 20;
export const RECENT_MENU = 5;

/* The wire bound the tray object already keeps for a question name, by CODE
   POINT: a non-BMP character astride the cap would put a lone surrogate on the
   wire and the exe would drop the whole frame. */
export const RECENT_NAME_MAX = 120;

export function recentPath(root) {
  return join(root, 'board', 'recent.json');
}

/* An index is a list position, in the closed shape the f/ routes take. */
function indexOf(v) {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 9999) return null;
  return v;
}

function entryOf(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const id = typeof raw.id === 'string' ? raw.id : '';
  const index = indexOf(raw.index);
  const path = typeof raw.path === 'string' ? raw.path : '';
  if (!id || index === null || !path) return null;
  return {
    id,
    index,
    path,
    kind: typeof raw.kind === 'string' ? raw.kind : '',
    at: typeof raw.at === 'string' ? raw.at : '',
  };
}

/* A malformed or absent file reads as empty and is never a throw a caller has to
   catch, which is loadView's own posture. */
export function loadRecent(root) {
  let raw;
  try {
    raw = readFileSync(recentPath(root), 'utf8');
  } catch {
    return [];
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
  const list = Array.isArray(parsed.opens) ? parsed.opens : [];
  const out = [];
  for (const row of list) {
    const e = entryOf(row);
    if (e) out.push(e);
    if (out.length === RECENT_MAX) break;
  }
  return out;
}

/* THE RE-RESOLUTION EVERY READER RUNS: an entry is shown only while the record's
   own list still names that file at that position, which keeps the refs list the
   only path authority even for a list of paths. */
export function keepResolved(list, resolved) {
  const out = [];
  for (const e of list || []) {
    let still;
    try {
      still = resolved(e);
    } catch {
      still = '';
    }
    if (still && still === e.path) out.push(e);
  }
  return out;
}

/* Newest first, capped, and an entry already in the list MOVES to the top rather
   than adding a row: an id plus an index is the one identity here. */
export function mergeRecent(list, entry) {
  const e = entryOf(entry);
  if (!e) return (list || []).slice(0, RECENT_MAX);
  const rest = (list || []).filter((row) => !(row.id === e.id && row.index === e.index));
  return [e, ...rest].slice(0, RECENT_MAX);
}

/* Merged over what is on disk NOW and written atomically at 0600, saveView's own
   posture. No store lock is taken: this file is not a record. The sweep is the
   caller's resolver, so a stale entry leaves on the next write. */
export function noteOpen(root, entry, resolved) {
  const on = loadRecent(root);
  const kept = typeof resolved === 'function' ? keepResolved(on, resolved) : on;
  const next = mergeRecent(kept, entry);
  writeAtomic(recentPath(root), JSON.stringify({ opens: next }, null, 2) + '\n', 0o600);
  return next;
}
