/* The PC's file primitives: the atomic write and the diagnostics line. The write
   is more than one rename: Windows refuses to replace an open file. */
import {
  appendFileSync, chmodSync, renameSync, unlinkSync, utimesSync, writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

/* The codes Windows refuses a replace with. A sharing violation surfaces as
   EPERM through libuv, EACCES and EBUSY are the neighbouring spellings; any
   other failure is a real one and is raised as it always was. */
const REFUSED = new Set(['EPERM', 'EACCES', 'EBUSY']);

/* Tries for the whole write. The second and third exist for the case the swap
   cannot help with: a scanner holding the TEMP file this call just wrote, which
   only a fresh temp name gets past. */
const TRIES = 3;
const RETRY_MS = 4;
/* A restore that fails is strictly worse than a write that fails (the target's
   name stays absent with its bytes under the aside), so the restore carries a
   budget of its own, well past the write's. */
const RESTORE_TRIES = 10;

const TEMP = '.tmp-';
/* '.tmp-' inside it on purpose: the root's day-old debris sweep (board-ensure)
   matches that substring, so an aside nothing got to delete is already covered. */
const ASIDE = '.tmp-aside-';

const suffix = () => process.pid + '-' + randomBytes(4).toString('hex');

/* A synchronous pause, because everything here is synchronous: a caller may hold
   the root's lock and cannot yield. */
const CLOCK = new Int32Array(new SharedArrayBuffer(4));
function pause(ms) {
  try { Atomics.wait(CLOCK, 0, 0, ms); } catch { /* no wait available: try again at once */ }
}

function refused(e) {
  return !!e && REFUSED.has(e.code);
}

function drop(paths) {
  for (const p of paths) {
    try { unlinkSync(p); } catch { /* the root's debris sweep gets it */ }
  }
}

/* Put the old name back after a swap that could not complete, so a refused write
   leaves the file where it found it. A restore that truly cannot happen is
   reported by NAME, since the bytes are on disk under it. */
function restore(aside, file, cause) {
  for (let attempt = 1; ; attempt++) {
    try {
      renameSync(aside, file);
      return;
    } catch (e) {
      if (attempt >= RESTORE_TRIES) {
        const err = new Error('writeAtomic could not put ' + file + ' back after a refused swap;'
          + ' its contents are at ' + aside + ' (' + ((e && e.message) || e) + ')');
        err.code = (cause && cause.code) || (e && e.code);
        throw err;
      }
      pause(RETRY_MS);
    }
  }
}

/* The fallback: swap the names instead of replacing one over the other. True when
   the new bytes are in place under the target's name; false means the caller
   should try again with a fresh temp, since renaming the target cannot help. */
function swapIn(file, tmp) {
  const aside = file + ASIDE + suffix();
  /* A rename keeps a file's mtime and the root's day-old debris sweep judges by
     mtime, so an aside minted from an old record would be born looking old and a
     sweep in another process could take it. Stamped now, it is born young. */
  try { const now = new Date(); utimesSync(file, now, now); } catch { /* the rename below decides */ }
  try {
    renameSync(file, aside);
  } catch {
    return false;
  }
  /* the target's name is absent from here to the next rename */
  try {
    renameSync(tmp, file);
  } catch (e) {
    restore(aside, file, e);
    return false;
  }
  try { unlinkSync(aside); } catch { /* the root's day-old debris sweep takes it */ }
  return true;
}

/* mode lands after the write, best effort; 0600 is inert on Windows */
function settle(file, mode) {
  if (mode !== undefined) { try { chmodSync(file, mode); } catch {} }
}

export function writeAtomic(file, text, mode) {
  /* every temp name this call minted and did not consume, deleted before the
     return and before the throw: a refused write leaves no debris behind */
  const stale = [];
  let refusal = null;
  for (let attempt = 1; attempt <= TRIES; attempt++) {
    const tmp = file + TEMP + suffix();
    let wrote = false;
    try {
      writeFileSync(tmp, text, 'utf8');
      wrote = true;
      /* the fast path: for a file nobody holds, one rename is the whole write */
      renameSync(tmp, file);
      drop(stale);
      settle(file, mode);
      return;
    } catch (e) {
      if (!refused(e)) {
        if (wrote) stale.push(tmp);
        drop(stale);
        throw e;
      }
      refusal = e;
    }
    if (wrote) {
      let landed = false;
      try {
        landed = swapIn(file, tmp);
      } catch (e) {
        stale.push(tmp);
        drop(stale);
        throw e;
      }
      if (landed) {
        drop(stale);
        settle(file, mode);
        return;
      }
      stale.push(tmp);
    }
    if (attempt < TRIES) pause(RETRY_MS);
  }
  drop(stale);
  throw refusal;
}

/* Fail-open by definition: diagnostics must never take a caller down. */
export function appendLog(root, line) {
  try {
    appendFileSync(join(root, 'log'), new Date().toISOString() + ' ' + line + '\n');
  } catch {}
}
