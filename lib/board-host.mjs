/* The board on this PC: the board server run from the current
 * plugin folder, its database and backups under the store root, since the plugin
 * folder is replaced on every update. The local server starts and watches it. */
import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { boardIdentity, ensureBoardServer, isLiveRoot, probe, probePort } from './board-ensure.mjs';
import { dataDir, envSeam, pluginRoot } from './node-helpers.mjs';
import { appendLog, writeAtomic } from './store-io.mjs';

export const HOST_DIR = 'board-host';
/* the board server's own default; another is kept when it is taken */
export const HOST_PORT = 17480;
const MAX_DELAY_MS = 60000;

export const hostDir = (root) => join(root, HOST_DIR);
const hostFile = (root) => join(hostDir(root), 'host.json');
const runningFile = (root) => join(hostDir(root), 'running.json');
export const hostLog = (root) => join(hostDir(root), 'board.log');
const holdFile = (root) => join(hostDir(root), 'hold.json');

/* null when this PC hosts no board */
export function readHost(root) {
  try {
    const h = JSON.parse(readFileSync(hostFile(root), 'utf8'));
    if (!Number.isInteger(h.port)) return null;
    return { port: h.port, db: h.db || join(hostDir(root), 'askerdo.db'), dir: hostDir(root), url: 'http://127.0.0.1:' + h.port };
  } catch { return null; }
}

/* The board on this PC listens on 127.0.0.1 alone, so a join code for it would name
   an address no other PC reaches: the refusal names the move instead. */
export const HOST_ONLY = 'the board on this PC answers this PC alone (127.0.0.1), so no other PC can join it:'
  + ' askerdo board move <address> puts it on a Docker or Node server first, and join-code there lets the next PC on';

export function hostedHere(root, url) {
  const host = readHost(root);
  if (!host || !url) return false;
  try {
    const u = new URL(url);
    const name = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    return (name === 'localhost' || name === '::1' || /^127\./.test(name)) && Number(u.port) === host.port;
  } catch { return false; }
}

const MOVED_FILES = ['askerdo.db', 'askerdo.db-wal', 'askerdo.db-shm', 'moved.json', 'running.json', 'last-backup.json'];

/* The port is chosen once and kept: every PC's config names it. `db` names a database
   file to host in place, a sandbox's file: board. */
export async function prepareHost(root, db = '') {
  const had = readHost(root);
  if (had) return had;
  mkdirSync(hostDir(root), { recursive: true });
  /* a board moved away keeps its last database, set aside so a new board never reuses it */
  if (existsSync(join(hostDir(root), 'moved.json'))) {
    const aside = join(hostDir(root), 'moved', new Date().toISOString().replace(/[:.]/g, '-'));
    mkdirSync(aside, { recursive: true });
    for (const n of MOVED_FILES) if (existsSync(join(hostDir(root), n))) renameSync(join(hostDir(root), n), join(aside, n));
  }
  /* a store other than the live one never takes the live default */
  const port = await probePort(isLiveRoot(root, homedir) ? HOST_PORT : 0);
  writeAtomic(hostFile(root), JSON.stringify({ port, db: db || join(hostDir(root), 'askerdo.db'), created: new Date().toISOString() }, null, 2) + '\n');
  return readHost(root);
}

/* The board needs node:sqlite (Node 24); null when this Node has it. */
export async function hostProblem() {
  try { await import('node:sqlite'); return null; } catch {
    return 'the board needs Node 24 or later, for node:sqlite, and this PC runs Node ' + process.versions.node;
  }
}

/* The board server from the plugin folder this code runs from, so a local
   server from a new release starts the new board. */
export function hostStart(root, plugin = pluginRoot, host = readHost(root)) {
  /* the config is read at each backup, so a boardBackups change reaches a running board */
  const dir = dataDir();
  return {
    command: process.execPath,
    args: [join(plugin, 'server', 'cli.mjs'), 'serve', '--db', host.db, '--port', String(host.port), '--host', '127.0.0.1',
      ...(dir ? ['--settings', join(dir, 'config.json')] : [])],
    cwd: host.dir,
  };
}

/* the env names the server reads would override nothing passed as flags but these */
export function hostEnv() {
  const env = { ...process.env };
  for (const k of ['ASKERDO_DB', 'ASKERDO_PORT', 'ASKERDO_HOST', 'ASKERDO_BACKUPS', 'ASKERDO_ARCHIVE']) delete env[k];
  return env;
}

export function boardAnswers(port, timeout = 1500) {
  return new Promise((done) => {
    const req = request({ host: '127.0.0.1', port, path: '/health', timeout }, (res) => {
      res.resume();
      done(res.statusCode === 200);
    });
    req.on('timeout', () => { req.destroy(); done(false); });
    req.on('error', () => done(false));
    req.end();
  });
}

/* macOS and Linux have no scheduled task, and a store root other than the live one
   never names it: a detached child of the caller outlives it. It logs what it did. */
export function startLocalServer(root) {
  try {
    const child = spawn(process.execPath, [join(pluginRoot, 'hooks', 'board-server.mjs'), '--root', root], { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', (e) => appendLog(root, 'board: the local server did not start: ' + ((e && e.message) || e)));
    child.unref();
    appendLog(root, 'board: started the local server detached (pid ' + child.pid + ')');
    return { ok: true };
  } catch (e) {
    return { ok: false, detail: 'the local server could not be started: ' + ((e && e.message) || e) };
  }
}

/* The copy's own board --restart, detached, for a local server whose code changed under it:
   it stops that server (which drains its calls first) and starts the current code the usual way,
   trying again with a back off when the new one does not answer (restartForCode). */
export function restartLocalServer(root) {
  const script = 'const [e, r] = process.argv.slice(1);'
    + ' const { restartForCode } = await import(e); await restartForCode(r);';
  try {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script, '--',
      pathToFileURL(join(pluginRoot, 'lib', 'board-host.mjs')).href, root,
    ], { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', (e) => appendLog(root, 'board: the restart for changed code did not start: ' + e.message));
    child.unref();
  } catch (e) { appendLog(root, 'board: the restart for changed code did not start: ' + ((e && e.message) || e)); }
}

export async function waitForBoard(port, ms) {
  const end = Date.now() + ms;
  for (;;) {
    if (await boardAnswers(port)) return true;
    if (Date.now() >= end) return false;
    await new Promise((r) => setTimeout(r, 200));
  }
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

/* a restore or a move holds the board stopped. A hold with a pid lapses with
   that process, so a crashed restore never keeps the board down; a move's has none. */
export function heldBy(root) {
  try {
    const h = JSON.parse(readFileSync(holdFile(root), 'utf8'));
    return h.pid && !alive(h.pid) ? null : h;
  } catch { return null; }
}

export function holdBoard(root, why, { pid = process.pid, ...more } = {}) {
  writeAtomic(holdFile(root), JSON.stringify({ why, ...(pid ? { pid } : {}), ...more, at: new Date().toISOString() }) + '\n');
}

export const releaseBoard = (root) => rmSync(holdFile(root), { force: true });

/* Stops the board this PC's local server started, by its recorded pid; true once
   the port is quiet. The supervisor starts it again unless a hold stands. */
export async function stopHostedBoard(root, ms = 10000) {
  const host = readHost(root);
  if (!host) return true;
  let was = null;
  try { was = JSON.parse(readFileSync(runningFile(root), 'utf8')); } catch {}
  if (was && alive(was.pid)) { try { process.kill(was.pid); } catch {} }
  const end = Date.now() + ms;
  while (await boardAnswers(host.port, 500)) {
    if (Date.now() >= end) return false;
    await new Promise((r) => setTimeout(r, 200));
  }
  return true;
}

/* The move's last step: host.json becomes moved.json, so no local server starts
   this board again; the database folder stays as it is. */
export function retireHost(root, url) {
  const host = readHost(root);
  if (!host) return null;
  const to = join(hostDir(root), 'moved.json');
  renameSync(hostFile(root), to);
  try { writeAtomic(to, JSON.stringify({ ...JSON.parse(readFileSync(to, 'utf8')), movedTo: url, movedAt: new Date().toISOString() }, null, 2) + '\n'); } catch {}
  releaseBoard(root);
  return to;
}

/* The local server's child: started when this PC hosts a board, restarted when it
   exits, stopped with the local server. A board a crashed local server left on
   the port is stopped by its recorded pid, so the new folder's board takes over. */
export function superviseHost(root, { log = () => {}, plugin = pluginRoot } = {}) {
  let child = null;
  let stopped = false;
  let timer = null;
  let delay = 1000;
  let startedAt = 0;
  let holdSaid = false;

  const later = () => {
    if (stopped) return;
    timer = setTimeout(() => { timer = null; start(); }, delay);
    delay = Math.min(delay * 2, MAX_DELAY_MS);
  };

  async function start() {
    if (stopped || child) return;
    const host = readHost(root);
    if (!host) return;
    const hold = heldBy(root);
    if (hold) {
      if (!holdSaid) log('board host: held stopped for ' + hold.why);
      holdSaid = true;
      timer = setTimeout(() => { timer = null; start(); }, 1000);
      return;
    }
    if (holdSaid) { holdSaid = false; delay = 1000; }
    if (await boardAnswers(host.port)) {
      let was = null;
      try { was = JSON.parse(readFileSync(runningFile(root), 'utf8')); } catch {}
      if (!was || !alive(was.pid)) {
        log('board host: port ' + host.port + ' answers, but not a board this server started; it is left as it is');
        return later();
      }
      try { process.kill(was.pid); } catch {}
      log('board host: stopped the board pid ' + was.pid + ' that ran from ' + was.plugin);
      await new Promise((r) => setTimeout(r, 500));
    }
    if (stopped) return;
    const s = hostStart(root, plugin, host);
    let fd = null;
    try {
      fd = openSync(hostLog(root), 'a');
      child = spawn(s.command, s.args, { cwd: s.cwd, env: hostEnv(), stdio: ['ignore', fd, fd], windowsHide: true });
    } catch (e) {
      child = null;
      log('board host: the board did not start: ' + ((e && e.message) || e));
      return later();
    } finally { if (fd !== null) { try { closeSync(fd); } catch {} } }
    startedAt = Date.now();
    const pid = child.pid;
    try { writeAtomic(runningFile(root), JSON.stringify({ pid, plugin, port: host.port }) + '\n'); } catch {}
    log('board host: started the board on 127.0.0.1:' + host.port + ' (pid ' + pid + ', database ' + host.db + ')');
    child.on('error', (e) => log('board host: ' + ((e && e.message) || e)));
    child.on('exit', (code, signal) => {
      child = null;
      if (stopped) return;
      if (heldBy(root)) { delay = 1000; return later(); }
      if (Date.now() - startedAt > MAX_DELAY_MS) delay = 1000;
      log('board host: the board exited (' + (signal || code) + '); starting it again in ' + Math.round(delay / 1000) + 's (its log is ' + hostLog(root) + ')');
      later();
    });
  }

  function stop() {
    stopped = true;
    if (timer) clearTimeout(timer);
    if (!child) return;
    const pid = child.pid;
    try { child.kill(); } catch {}
    try { if (JSON.parse(readFileSync(runningFile(root), 'utf8')).pid === pid) rmSync(runningFile(root), { force: true }); } catch {}
  }

  return { start, stop, running: () => Boolean(child) };
}

/* The server's real entry imported in a child that then exits (--check-load), so the
   old server stops only for code that loads: a file that does not parse or an import
   that fails is caught, and the child's own error names the file. */
export function codeLoads(root, plugin = pluginRoot, timeoutMs = 30000) {
  return new Promise((done) => {
    let err = '';
    let child;
    try {
      child = spawn(process.execPath, [join(plugin, 'hooks', 'board-server.mjs'), '--check-load', '--root', root],
        { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    } catch (e) { return done({ ok: false, why: 'the load check did not start: ' + ((e && e.message) || e) }); }
    const timer = setTimeout(() => { try { child.kill(); } catch {} }, timeoutMs);
    child.stderr.on('data', (d) => { if (err.length < 8192) err += d; });
    child.on('error', (e) => { clearTimeout(timer); done({ ok: false, why: 'the load check did not start: ' + e.message }); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) return done({ ok: true });
      done({ ok: false, why: loadError(err, plugin) || 'the load check ended with ' + (code === null ? 'a timeout' : 'exit ' + code) });
    });
  });
}

/* node prints the failing file's URL and line first and the error on its own line */
function loadError(text, plugin) {
  const lines = String(text).split(/\r?\n/);
  const at = lines.map((l) => /^(file:\/\/\/\S+?):(\d+)$/.exec(l.trim())).find(Boolean);
  const error = lines.find((l) => /^[A-Za-z]*Error\b.*?:/.test(l.trim()));
  let file = '';
  if (at) {
    try { file = fileURLToPath(at[1]); } catch { file = at[1]; }
    const rel = relative(plugin, file);
    if (rel && !rel.startsWith('..')) file = rel.split('\\').join('/');
    file += ':' + at[2];
  }
  return [file, error ? error.trim() : ''].filter(Boolean).join(': ');
}

/* The tries after a restart left no server: something else (an ensure) may start one first */
export const RESTART_WAITS = [2000, 5000, 10000, 20000, 40000, 60000, 60000, 60000, 60000, 60000];

/* The detached helper's whole job: the old server is gone once a restart fails past its stop,
   so this helper is what is still alive to bring one back; each try is logged. */
export async function restartForCode(root, {
  ensure = ensureBoardServer, waits = RESTART_WAITS, log = (s) => appendLog(root, s),
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)), ping = probe,
  platform = envSeam('RESTART_DETACHED') ? 'detached' : process.platform,
  every = 60000, entry = join(pluginRoot, 'hooks', 'board-server.mjs'),
} = {}) {
  const say = (o, n) => log('board: restart for changed code' + (n ? ', try ' + n : '') + ': ' + o.status + (o.detail ? ' (' + o.detail + ')' : ''));
  const answers = async () => {
    let ident = null;
    try { ident = boardIdentity(root); } catch {}
    return Boolean(ident && (await ping(ident.port, ident.secret)).listening);
  };
  let o = await ensure(root, { restart: true, platform });
  say(o, 0);
  if (o.status !== 'failed') return o;
  for (let i = 0; i < waits.length; i++) {
    /* the old server still answering means the stop never happened: it asks again itself */
    if (await answers()) return o;
    await sleep(waits[i]);
    o = await ensure(root, { platform });
    say(o, i + 1);
    if (o.status !== 'failed') return o;
  }
  /* a PC is never left with no local server: code that starts and throws is tried each minute
     until it is repaired or another start (a session's, a Start press) answers; gone code ends it */
  log('board: the restart for changed code failed ' + waits.length + ' tries; trying once a minute while no local server answers');
  for (let n = waits.length + 1; existsSync(entry); n++) {
    if (await answers()) return o;
    await sleep(every);
    o = await ensure(root, { platform });
    if (o.status !== 'failed') { say(o, n); return o; }
  }
  log('board: the restart for changed code stopped: ' + entry + ' is gone');
  return o;
}
