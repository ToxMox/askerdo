/* The board database: one SQLite file opened only by the board server, through
   node:sqlite (synchronous, FTS5 built in, no native module to install). */
import { DatabaseSync } from 'node:sqlite';

export class TxError extends Error {}

/* WAL with synchronous=NORMAL commits without an fsync per write; a crash can
   lose the last commits, never corrupt the file. */
export function openDb(path = ':memory:') {
  const db = new DatabaseSync(path);
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
  const cache = new Map();
  db.stmt = (sql) => {
    let s = cache.get(sql);
    if (!s) { s = db.prepare(sql); cache.set(sql, s); }
    return s;
  };
  return db;
}

const isThenable = (v) => v !== null && (typeof v === 'object' || typeof v === 'function') && typeof v.then === 'function';

/* One synchronous write transaction. An async callback is refused before it
   runs, and a callback that hands back a promise is rolled back, so no verb
   can await while it holds the write. A tx inside a tx joins the outer one. */
export function tx(db, fn) {
  if (typeof fn !== 'function') throw new TypeError('tx needs a function');
  if (fn.constructor && fn.constructor.name === 'AsyncFunction') {
    throw new TxError('a write transaction cannot await: pass a synchronous function');
  }
  if (db.isTransaction) {
    const out = fn(db);
    if (isThenable(out)) throw new TxError('a write transaction cannot await: the callback returned a promise');
    return out;
  }
  db.exec('BEGIN IMMEDIATE');
  let out;
  try {
    out = fn(db);
    if (isThenable(out)) {
      Promise.resolve(out).catch(() => {});
      throw new TxError('a write transaction cannot await: the callback returned a promise');
    }
  } catch (e) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw e;
  }
  /* a failed COMMIT (a full disk) must not leave a transaction every later tx joins */
  try { db.exec('COMMIT'); } catch (e) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw e;
  }
  return out;
}

/* Several reads as one snapshot; inside a write it joins the write. */
export function readTx(db, fn) {
  if (db.isTransaction) return fn(db);
  db.exec('BEGIN');
  try {
    const out = fn(db);
    db.exec('COMMIT');
    return out;
  } catch (e) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw e;
  }
}
