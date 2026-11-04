/* The board on this PC's copies: one at the first session start of
 * each day, into a folder the user can point at a synced drive, with backup, restore
 * and the move to a board on a server. The server's own maint code does the file work. */
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { request } from 'node:http';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { ADMIN_HEADER, ADMIN_SECRET_FILE } from '../server/paths.mjs';
import { heldBy, holdBoard, hostDir, readHost, releaseBoard, stopHostedBoard, waitForBoard } from './board-host.mjs';
import { appendLog, writeAtomic } from './store-io.mjs';

export const KEEP = 30;
const LOCK_STALE_MS = 10 * 60000;

/* the boardBackups setting, else the folder beside the database */
export const backupsOf = (root, cfg) => resolve((cfg && typeof cfg.boardBackups === 'string' && cfg.boardBackups.trim()) || join(hostDir(root), 'backups'));
/* a schema change's copy always lands beside the database, so a restore lists both */
export const copyDirs = (root, cfg) => [...new Set([backupsOf(root, cfg), resolve(hostDir(root), 'backups')])];

const dayOf = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const message = (e) => (e && e.message) || String(e);

/* Why a folder cannot take the copies, or null: settings set refuses on it. */
export function backupsFolderProblem(dir) {
  const d = String(dir || '').trim();
  if (!isAbsolute(d)) return 'is a full folder path, such as a folder in OneDrive or Dropbox or a NAS share';
  const probe = join(d, '.askerdo-write-check-' + process.pid);
  try {
    mkdirSync(d, { recursive: true });
    writeFileSync(probe, '');
    rmSync(probe, { force: true });
    return null;
  } catch (e) {
    return 'must be a folder this PC can write, and ' + d + ' is not (' + (e.code || message(e)) + ')';
  }
}

/* The board's loopback admin route, with the secret the board wrote beside its
   database at its start: its answer, or null when nothing listens. */
function admin(host, cmd, body, timeout = 120000) {
  const text = JSON.stringify(body);
  let secret = '';
  try { secret = readFileSync(join(host.dir, ADMIN_SECRET_FILE), 'utf8').trim(); } catch {}
  const headers = { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text), [ADMIN_HEADER]: secret };
  return new Promise((ok, fail) => {
    const req = request({ host: '127.0.0.1', port: host.port, path: '/admin/' + cmd, method: 'POST', timeout, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        let r = null;
        try { r = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {}
        if (res.statusCode === 200 && r) ok(r.result);
        else fail(new Error((r && (r.error && (r.error.message || r.error))) || 'the board answered ' + res.statusCode));
      });
    });
    req.on('timeout', () => req.destroy(new Error('the board took over ' + Math.round(timeout / 1000) + 's')));
    req.on('error', (e) => (e.code === 'ECONNREFUSED' ? ok(null) : fail(e)));
    req.end(text);
  });
}

/* One copy now, named for `now`'s day: through the running board, else from the file
   itself as the server's own backup does with no server up. Null when no board is here. */
export async function backupNow(root, { cfg, now = new Date() } = {}) {
  const host = readHost(root);
  if (!host) return null;
  /* a running board writes its own configured folder, which it reads from the settings file */
  let dir = backupsOf(root, cfg);
  let out = await admin(host, 'backup', { keep: KEEP, at: now.toISOString() });
  if (out) dir = dirname(out.file);
  else {
    if (!existsSync(host.db)) throw new Error('the board database ' + host.db + ' is not there');
    const { openDb } = await import('../server/db.mjs');
    const maint = await import('../server/maint.mjs');
    const db = openDb(host.db);
    try { out = maint.backup(db, dir, KEEP, now); } finally { db.close(); }
  }
  return { ...out, dir, bytes: statSync(out.file).size };
}

/* One of a session start's three or four concurrent hooks makes the copy. */
function takeLock(file) {
  for (let i = 0; i < 2; i++) {
    try { closeSync(openSync(file, 'wx')); return true; } catch (e) {
      if (e.code !== 'EEXIST') return false;
      try { if (Date.now() - statSync(file).mtimeMs < LOCK_STALE_MS) return false; rmSync(file, { force: true }); } catch { return false; }
    }
  }
  return false;
}

/* `docker <args>`: { code, out, err }; code is ENOENT when there is no docker. */
export const runDocker = (args, timeout = 180000) => new Promise((ok) => {
  execFile('docker', args, { timeout, windowsHide: true, encoding: 'utf8' }, (e, out, err) => ok({ code: e ? e.code || 1 : 0, out: String(out || ''), err: String(err || (e && e.message) || '') }));
});

/* No docker, no engine, or a stopped or missing container: that day goes without a copy. */
const ENGINE_AWAY = /connect to the docker (daemon|api)|docker daemon|pipe.*docker/i;
const DOCKER_AWAY = /not running|no such container|is paused/i;

/* a Docker board configure set up here gets the board's own backup inside its
   container, into its backups volume, at the same first session start of the day. */
async function dockerDaily(root, { name, now, log, docker }) {
  mkdirSync(hostDir(root), { recursive: true });
  const stamp = join(hostDir(root), 'last-docker-backup.json');
  const today = dayOf(now);
  const done = () => { try { return JSON.parse(readFileSync(stamp, 'utf8')).day === today; } catch { return false; } };
  if (done()) return { skipped: 'made today' };
  const lock = join(hostDir(root), 'docker-backup.lock');
  if (!takeLock(lock)) return { skipped: 'another session start is making it' };
  const mark = (extra) => writeAtomic(stamp, JSON.stringify({ day: today, container: name, at: new Date().toISOString(), ...extra }) + String.fromCharCode(10));
  try {
    if (done()) return { skipped: 'made today' };
    const r = await docker(['exec', name, 'node', '/app/server/cli.mjs', 'backup', '--keep', String(KEEP)]);
    if (r.code === 'ENOENT' || (r.code && (ENGINE_AWAY.test(r.err) || DOCKER_AWAY.test(r.err)))) {
      mark({ skipped: true });
      log('docker board backup skipped today: ' + (r.code === 'ENOENT' ? 'docker is not on this PC' : ENGINE_AWAY.test(r.err) ? "Docker's engine is not running" : 'the container ' + name + ' is not running') + ' (' + r.err.trim().split(/\r?\n/)[0] + ')');
      return { skipped: 'docker away' };
    }
    if (r.code) throw new Error(r.err.trim() || 'docker exec exited ' + r.code);
    let file = '';
    try { file = JSON.parse(r.out).file || ''; } catch {}
    mark({ file });
    log('docker board backup: ' + (file || r.out.trim()) + ' in the container ' + name + ' (the newest ' + KEEP + ' kept in its backups volume)');
    return { made: file || true };
  } catch (e) {
    log('docker board backup failed, and the next session start tries again: ' + message(e));
    return { failed: message(e) };
  } finally {
    rmSync(lock, { force: true });
  }
}

/* The first session start of each day on the PC hosting the board, and for a Docker
   board here. Never throws: a failure is logged, and the next session start tries again. */
export async function dailyBackup(root, { cfg, now = new Date(), log = (s) => appendLog(root, s), docker = runDocker } = {}) {
  const name = cfg && typeof cfg.boardContainer === 'string' ? cfg.boardContainer.trim() : '';
  const container = name ? await dockerDaily(root, { name, now, log, docker }) : null;
  const here = await hostDaily(root, { cfg, now, log });
  return container ? { ...here, container } : here;
}

async function hostDaily(root, { cfg, now, log }) {
  if (!readHost(root)) return { skipped: 'no board here' };
  const stamp = join(hostDir(root), 'last-backup.json');
  const today = dayOf(now);
  const done = () => { try { return JSON.parse(readFileSync(stamp, 'utf8')).day === today; } catch { return false; } };
  if (done() || heldBy(root)) return { skipped: done() ? 'made today' : 'the board is held' };
  const lock = join(hostDir(root), 'backup.lock');
  if (!takeLock(lock)) return { skipped: 'another session start is making it' };
  try {
    if (done()) return { skipped: 'made today' };
    const r = await backupNow(root, { cfg, now });
    writeAtomic(stamp, JSON.stringify({ day: today, file: r.file, at: new Date().toISOString() }) + String.fromCharCode(10));
    log('board backup: ' + r.file + ' (' + r.bytes + ' bytes; the newest ' + KEEP + ' kept in ' + r.dir + ')');
    return { made: r.file };
  } catch (e) {
    log('board backup failed, and the next session start tries again: ' + message(e));
    return { failed: message(e) };
  } finally {
    rmSync(lock, { force: true });
  }
}

/* The copies a restore can take, newest first. */
export async function listCopies(root, cfg) {
  const maint = await import('../server/maint.mjs');
  return maint.copies(copyDirs(root, cfg));
}

/* Restore on the PC hosting the board: hold it, stop it, swap the file through the
   server's own restore (aside, copy, check, put back on a failed check), let it go. */
export async function restoreHere(root, which, { cfg, waitMs = 20000, ensure = async () => {} } = {}) {
  const host = readHost(root);
  if (!host) return null;
  const maint = await import('../server/maint.mjs');
  const from = maint.pickCopy(which, copyDirs(root, cfg));
  const hold = heldBy(root);
  if (hold) throw new Error('the board on this PC is held stopped for ' + hold.why + ', so it takes no restore now');
  holdBoard(root, 'a restore');
  let r;
  try {
    if (!await stopHostedBoard(root)) throw new Error('the board on ' + host.url + ' did not stop, so nothing was restored (its log is ' + join(host.dir, 'board.log') + ')');
    r = maint.restore(host.db, from);
  } finally {
    releaseBoard(root);
  }
  await ensure();
  const end = Date.now() + waitMs;
  const answering = await waitForBoard(host.port, waitMs) && await localSees(root, host.url, end);
  return { ...r, url: host.url, answering };
}

/* The local server's own line to the board, so the next command finds it online;
   true at once when no local server runs for this board. */
async function localSees(root, url, end) {
  for (;;) {
    let l = null;
    try { l = JSON.parse(readFileSync(join(root, 'board', 'local.json'), 'utf8')); } catch {}
    if (!l || typeof l.url !== 'string' || String(l.board || '').replace(/\/+$/, '') !== url) return true;
    const st = await new Promise((done) => {
      const req = request(l.url + '/state', { timeout: 1500 }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => { try { done(JSON.parse(Buffer.concat(chunks).toString('utf8')).result); } catch { done(null); } });
      });
      req.on('timeout', () => { req.destroy(); done(null); });
      req.on('error', () => done(null));
      req.end();
    });
    if (st && st.online) return true;
    if (Date.now() >= end) return false;
    await new Promise((r) => setTimeout(r, 200));
  }
}

/* The move's first half: the board held stopped, so nothing written after the copy is
   left behind, then a fresh copy and its last change number for the second half's check. */
export async function moveCopy(root, url, { cfg, now = new Date() } = {}) {
  const host = readHost(root);
  const held = heldBy(root);
  if (held && held.url === url && held.file && existsSync(held.file)) return held;
  if (held && !held.url) throw new Error('the board on this PC is held stopped for ' + held.why + ': try again once it is done');
  holdBoard(root, 'a move to ' + url, { pid: null, url });
  try {
    if (!await stopHostedBoard(root)) throw new Error('the board on ' + host.url + ' did not stop, so nothing was copied');
    /* a name of its own, so the day's dated copy stays as it was */
    const { openDb } = await import('../server/db.mjs');
    const { vacuumInto } = await import('../server/maint.mjs');
    const { lastSeq } = await import('../server/verbs/snapshot.mjs');
    const name = 'askerdo-move-' + dayOf(now) + '-' + String(now.getHours()).padStart(2, '0') + String(now.getMinutes()).padStart(2, '0') + String(now.getSeconds()).padStart(2, '0') + '.db';
    const live = openDb(host.db);
    let file;
    try { file = vacuumInto(live, backupsOf(root, cfg), name); } finally { live.close(); }
    const db = openDb(file);
    let seq;
    try { seq = lastSeq(db); } finally { db.close(); }
    holdBoard(root, 'a move to ' + url, { pid: null, url, file, seq });
    return heldBy(root);
  } catch (e) {
    releaseBoard(root);
    throw e;
  }
}
