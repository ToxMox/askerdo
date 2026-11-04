/* Backup, export and check: the serving process runs them behind its
   loopback admin route, so only it opens the file; the CLI runs them itself
   only when no server is up. */
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, rmdirSync, statSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { basename, dirname, join, resolve } from 'node:path';
import { exportStore } from './render.mjs';
import { logCheck } from './timings.mjs';
import { purgeSeals } from './verbs/override.mjs';

export const KEEP = 30;

export const day = (d = new Date()) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

const hasSeals = (db) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'seals'").get());

/* VACUUM INTO a temp name, then rename, so a rerun on the same day replaces its copy.
   a copy never keeps a scrub's sealed original, which would outlive the seal by KEEP days. */
export function vacuumInto(db, dir, name) {
  mkdirSync(dir, { recursive: true });
  const final = join(dir, name);
  const tmp = final + '.tmp-' + process.pid;
  rmSync(tmp, { force: true });
  const strip = hasSeals(db) && db.prepare('SELECT 1 FROM seals LIMIT 1').get();
  db.prepare('VACUUM INTO ?').run(tmp);
  if (strip) {
    const copy = new DatabaseSync(tmp);
    /* the search index keeps a deleted term until it merges */
    try { copy.exec("DELETE FROM seals; INSERT INTO search (search) VALUES ('optimize'); VACUUM;"); } finally { copy.close(); }
  }
  renameSync(tmp, final);
  return final;
}

/* a scrub's seal past its date goes before the night's copy is made */
export function backup(db, dir, keep = KEEP, now = new Date()) {
  if (hasSeals(db)) purgeSeals(db, now);
  const file = vacuumInto(db, dir, 'askerdo-' + day(now) + '.db');
  const dated = readdirSync(dir).filter((n) => /^askerdo-\d{4}-\d{2}-\d{2}\.db$/.test(n)).sort();
  for (const n of dated.slice(0, Math.max(0, dated.length - keep))) rmSync(join(dir, n), { force: true });
  db.exec('PRAGMA optimize');
  return { file, kept: Math.min(dated.length, keep) };
}

/* `log` is <data>/checks.log: the server keeps each result, whoever ran it */
export function check(db, { log } = {}) {
  const rows = db.prepare('PRAGMA integrity_check').all().map((r) => Object.values(r)[0]);
  const fk = db.prepare('PRAGMA foreign_key_check').all();
  const ok = rows.length === 1 && rows[0] === 'ok' && !fk.length;
  const out = { ok, at: new Date().toISOString(), integrity: rows, foreignKeys: fk.length };
  logCheck(log, out);
  return out;
}

/* The dated and pre-schema copies in the folders given, newest first. */
const COPY_RE = /^askerdo-(pre-schema-\d+-)?(\d{4}-\d{2}-\d{2})\.db$/;
export function copies(dirs) {
  const out = [];
  for (const dir of [...new Set(dirs.map((d) => resolve(d)))]) {
    let names = [];
    try { names = readdirSync(dir); } catch { continue; }
    for (const name of names) {
      const m = COPY_RE.exec(name);
      if (!m) continue;
      const st = statSync(join(dir, name));
      out.push({ name, file: join(dir, name), day: m[2], kind: m[1] ? 'pre-schema' : 'dated', bytes: st.size, made: st.mtime.toISOString() });
    }
  }
  return out.sort((a, b) => b.day.localeCompare(a.day) || b.made.localeCompare(a.made));
}

/* A date names that day's dated copy; anything else is a file, or a name in one of the folders. */
export function pickCopy(arg, dirs) {
  const s = String(arg || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const hit = copies(dirs).find((c) => c.kind === 'dated' && c.day === s);
    if (!hit) throw new Error('no copy dated ' + s + ' in ' + dirs.join(' or '));
    return hit.file;
  }
  for (const f of [resolve(s), ...dirs.map((d) => join(d, s))]) if (s && existsSync(f) && statSync(f).isFile()) return f;
  throw new Error('no copy named ' + s + ': a date (YYYY-MM-DD) or a file in ' + dirs.join(' or '));
}

const SIDES = ['', '-wal', '-shm'];
const stampOf = (d) => d.toISOString().replace(/[:.]/g, '-');

/* the one restore of the board on a PC and of a server's. The live file and its
   -wal and -shm go aside into before-restore/<stamp>, the copy comes in, and a copy
   that fails the integrity check is taken out again and the old files put back. */
export function restore(path, source, { now = new Date() } = {}) {
  const db = resolve(path);
  const from = resolve(source);
  if (from === db) throw new Error('that is the live database itself');
  const aside = join(dirname(db), 'before-restore', stampOf(now));
  mkdirSync(aside, { recursive: true });
  const moved = [];
  const putBack = () => {
    for (const s of SIDES) rmSync(db + s, { force: true });
    for (const s of moved) renameSync(join(aside, basename(db) + s), db + s);
    try { rmdirSync(aside); } catch {}
  };
  /* a killed board leaves writes in the WAL: fold them in, so the set-aside main file alone is whole */
  if (existsSync(db)) {
    try { const d = new DatabaseSync(db); try { d.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } finally { d.close(); } } catch {}
  }
  let r;
  try {
    for (const s of SIDES) if (existsSync(db + s)) { renameSync(db + s, join(aside, basename(db) + s)); moved.push(s); }
    copyFileSync(from, db);
    try {
      const d = new DatabaseSync(db);
      try { r = check(d, { log: join(dirname(db), 'checks.log') }); } finally { d.close(); }
    } catch (e) {
      r = { ok: false, at: now.toISOString(), integrity: [(e && e.message) || String(e)], foreignKeys: 0 };
    }
  } catch (e) { putBack(); throw e; }
  if (!r.ok) { putBack(); return { ok: false, from, db, check: r }; }
  if (!moved.length) { try { rmdirSync(aside); } catch {} }
  return { ok: true, from, db, aside: moved.length ? aside : null, check: r };
}

export function exportTo(db, dir) {
  const out = resolve(dir);
  return { dir: out, files: exportStore(db, out) };
}
