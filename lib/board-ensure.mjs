/* The permanent identity port sits inside every minted link. The task starts
 * the board, never a spawn here; no fallback, and
 * every refusal lands before the stale stop. */
/* Outcomes are RETURNED, never thrown, and callers read them; only a StoreError
 * propagates. */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { TASK_NAME, actionMatches, parseAction, taskXml, wantedAction } from './board-task.mjs';
import { startLocalServer } from './board-host.mjs';
import { withLock } from './local-inbox.mjs';
import { STORE_SLUG, envSeam, pluginVersion, replacedCopy } from './node-helpers.mjs';
import { appendLog, writeAtomic } from './store-io.mjs';

const STEP_MS = 150;

/* Cleanup after the rename: the task the releases before AskerDo
 * registered. It drops in a follow-on release, once no machine can still be
 * carrying one. */
export const LEGACY_TASK_NAME = 't.ask&ding board';

/* U+FEFF, spelled rather than typed: an invisible literal in a source file
   is a thing no reviewer can see and no editor is guaranteed to keep. */
const BOM = String.fromCharCode(0xfeff);

/* Fresh-read per call where the server bakes its own at boot: bake this one too
 * and the takeover compare goes vacuous. */
function version() {
  return envSeam('BOARD_VERSION') || pluginVersion();
}

export class StoreError extends Error {}

/* ---- the PC's identity: the secret and port every minted link carries ---------- */

const DEFAULT_PORT = 17435;
const INBOX_SWEEP_MS = 30 * 24 * 3600 * 1000;
const DEBRIS_SWEEP_MS = 24 * 3600 * 1000;
const validSecret = (s) => typeof s === 'string' && /^[0-9a-f]{32}$/.test(s);
const validPort = (p) => Number.isInteger(p) && p >= 1 && p <= 65535;

function readIdent(file) {
  try { return readFileSync(file, 'utf8').trim(); } catch { return null; }
}

/* The fixed default port once, at the root's first ensure; if something else
   owns it, an OS-assigned port is kept forever instead. */
export function probePort(preferred = DEFAULT_PORT) {
  return new Promise((done, reject) => {
    const first = createNetServer();
    first.unref();
    first.once('error', (e) => {
      /* EACCES: Windows winnat port-range exclusions refuse the bind the same way */
      if (!e || (e.code !== 'EADDRINUSE' && e.code !== 'EACCES')) return reject(new StoreError('port probe failed: ' + (e && e.message)));
      const fallback = createNetServer();
      fallback.unref();
      fallback.once('error', (e2) => reject(new StoreError('port probe failed: ' + (e2 && e2.message))));
      fallback.listen(0, '127.0.0.1', () => {
        const p = fallback.address().port;
        fallback.close(() => done(p));
      });
    });
    first.listen(preferred, '127.0.0.1', () => first.close(() => done(preferred)));
  });
}

export function boardIdentity(root) {
  let secret, port;
  try {
    secret = readFileSync(join(root, 'board', 'secret'), 'utf8').trim();
    port = Number(readFileSync(join(root, 'board', 'port'), 'utf8').trim());
  } catch (e) {
    throw new StoreError('board identity unreadable: ' + (e && e.message));
  }
  if (!validSecret(secret) || !validPort(port)) {
    throw new StoreError('board identity is corrupt; remove board/ to re-mint (old links will break)');
  }
  return { secret, port };
}

/* new links carry the askerdo host; the server's guard still answers
   the older names, so every link ever minted reaches the same socket. */
export function boardUrl(root, kind, id, ident) {
  const { secret, port } = ident || boardIdentity(root);
  const base = 'http://askerdo.localhost:' + port + '/' + secret + '/';
  if (kind === 'root') return base;
  if (kind === 'q') return base + 'q/' + id;
  if (kind === 'w') return base + 'w/' + id;
  if (kind === 'r') return base + 'r/' + id;
  throw new StoreError('unknown board url kind: ' + kind);
}

function agedFiles(dir, match, ms) {
  const out = [];
  const cutoff = Date.now() - ms;
  let names = [];
  try { names = readdirSync(dir); } catch { return out; }
  for (const n of names) {
    if (!match(n)) continue;
    const f = join(dir, n);
    try { if (statSync(f).mtimeMs < cutoff) out.push(f); } catch {}
  }
  return out;
}

/* inbox files a month untouched, and day-old debris: renamed-away stale locks and
   temp files whose rename never landed */
const sweepable = (root) => [
  ...agedFiles(join(root, 'inbox'), () => true, INBOX_SWEEP_MS),
  ...agedFiles(root, (n) => n.startsWith('.lock-stale-') || /\.tmp-/.test(n), DEBRIS_SWEEP_MS),
  ...agedFiles(join(root, 'board'), (n) => /\.tmp-/.test(n), DEBRIS_SWEEP_MS),
];

/* Idempotent: the identity is minted here, not at server start, so a link is
   permanent from the first; a torn identity heals like an absent one, and the
   lock is taken only when there is work. */
export async function ensureRoot(root, opts = {}) {
  for (const d of ['inbox', 'board']) {
    try {
      mkdirSync(join(root, d), { recursive: true });
    } catch (e) {
      throw new StoreError('could not create ' + d + '/ in ' + root + ': ' + (e && e.message));
    }
  }
  const secretFile = join(root, 'board', 'secret');
  const portFile = join(root, 'board', 'port');
  const ok = validSecret(readIdent(secretFile)) && validPort(Number(readIdent(portFile) ?? NaN));
  if (ok && !sweepable(root).length) return;
  await withLock(root, opts, async () => {
    /* re-checked under the lock: a contender may have minted or healed first */
    const s = readIdent(secretFile);
    if (!validSecret(s)) {
      if (s !== null) appendLog(root, 'healed corrupt board secret (was invalid, re-minted)');
      writeAtomic(secretFile, randomBytes(16).toString('hex') + '\n', 0o600);
    }
    const p = readIdent(portFile);
    if (!validPort(Number(p ?? NaN))) {
      if (p !== null) appendLog(root, 'healed corrupt board port (was invalid, re-minted)');
      writeAtomic(portFile, String(await probePort()) + '\n', 0o600);
    }
    for (const f of sweepable(root)) { try { rmSync(f, { recursive: true, force: true }); } catch {} }
  });
}

/* a live update stops the board and fast-forwards the checkout, and any
 * open session's band read would start it again in between. The hold expires on
 * its own, so a crashed update frees the board. */
export const HOLD_FILE = 'live-update-hold.json';

export function boardHeld(root, now = Date.now()) {
  try {
    const h = JSON.parse(readFileSync(join(root, 'board', HOLD_FILE), 'utf8'));
    return Number.isFinite(h.until) && h.until > now ? h : null;
  } catch { return null; }
}

/* The real ones are the defaults and every test hands in fakes, so no suite run
 * registers a task, asks the machine who it is, or moves the home. */
export async function ensureBoardServer(
  root, { waitMs = 3000, run = realRun, sid = realSid, home = homedir, platform = process.platform, start = startLocalServer, endPid = realEndPid, restart = false } = {},
) {
  /* only Windows has the task; elsewhere the session start starts it detached */
  const viaTask = platform === 'win32';
  await ensureRoot(root);
  const { secret, port } = boardIdentity(root);
  const urls = () => {
    const url = boardUrl(root, 'root');
    const alt = new URL(url);
    alt.hostname = '127.0.0.1';
    return { url, altUrl: alt.href };
  };

  /* a copy an update replaced adopts any board of ours and runs the task as it stands,
     so an old session never takes the board and the task back to a folder due for deletion */
  const replaced = replacedCopy();
  /* off Windows its restart would start its own old server */
  if (restart && replaced) {
    return { status: 'refused', port, detail: 'this copy was replaced by an update: start a new session, which runs the installed copy, then run it again' };
  }
  const p = await probe(port, secret);
  /* restart (askerdo board --restart) takes the replace path whatever the version */
  if (p.mine && (p.version === version() || replaced) && !restart) {
    /* a session start brings back a tray the person closed */
    await postRoute(port, secret, 'api/tray');
    return { status: 'running', ...urls(), port };
  }
  /* a stranger is refused before anything is planned, registered or run */
  if (p.listening && !p.mine) {
    return { status: 'foreign', port, ...(p.busy ? { busy: true, detail: 'port ' + port + ' did not answer within the wait' } : { detail: 'not an AskerDo board' }) };
  }
  if (boardHeld(root)) {
    return { status: 'failed', port, detail: 'a live update holds the board until it finishes' };
  }

  /* Plan, prove, register, and only then stop: neither half touches the
   * running instance, so a refusal is read with the board still serving. */
  const plan = replaced || !viaTask ? { ok: true, xml: null } : planTask(root, run, sid, home);
  if (!plan.ok) return { status: 'failed', port, detail: plan.detail };
  if (plan.xml) {
    dropLegacyTask(root, run);
    const wrote = registerTask(plan.xml, run);
    if (!wrote.ok) return { status: 'failed', port, detail: wrote.detail };
  }

  const replacing = p.mine === true;
  if (replacing) {
    const gone = await stopOld(root, port, secret, waitMs, endPid, restart ? undefined : p.version || 'none');
    if (!gone.ok) return { status: 'failed', port, detail: gone.detail };
    if (gone.adopted) return { status: 'running', ...urls(), port };
  }
  const go = viaTask ? runTask(run) : start(root);
  if (!go.ok) return { status: 'failed', port, detail: go.detail };
  const up = await waitFor(() => probe(port, secret).then((x) => x.mine), waitMs);
  if (up) return { status: !replacing ? 'started' : restart ? 'restarted' : 'replaced', ...urls(), port };
  return {
    status: 'failed',
    port,
    detail: replacing ? 'the replacement server did not answer'
      : 'the server did not answer within ' + waitMs + 'ms',
  };
}

/* The one place schtasks is named: a synchronous call returns its failure
 * rather than emitting it, which keeps the never-throws rule. The exe name is
 * an env test seam, not user API. */
function realRun(args) {
  const exe = envSeam('SCHTASKS') || 'schtasks';
  const r = spawnSync(exe, args, { windowsHide: true, encoding: 'utf8' });
  if (r.error) return { code: -1, stdout: '', stderr: (r.error.message || String(r.error)) };
  return {
    code: typeof r.status === 'number' ? r.status : -1,
    stdout: r.stdout || '',
    stderr: r.stderr || '',
  };
}

/* Read at run time and never stored, and only after the compare says the action
 * is stale, so an ordinary session start asks nothing. The env value is a test
 * seam. */
function realSid() {
  const injected = (envSeam('SID') || '').trim();
  if (injected) return injected;
  const r = spawnSync(whoamiCommand(), ['/user', '/fo', 'csv'], { windowsHide: true, encoding: 'utf8' });
  const hit = /\bS-1-[0-9-]*[0-9]\b/.exec((r && r.stdout) || '');
  return hit ? hit[0] : null;
}

/* whoami by its path, never its name: measured 2026-09-09, Git Bash
 * resolves a bare whoami to MSYS coreutils, which prints no SID. SystemRoot is
 * read rather than written down. */
export function whoamiCommand() {
  const root = process.env.SystemRoot;
  return root ? join(root, 'System32', 'whoami.exe') : 'whoami';
}

function firstLine(r) {
  const text = (r.stderr || '') + (r.stderr && r.stdout ? '\n' : '') + (r.stdout || '');
  const line = text.split(/\r?\n/).map((l) => l.trim()).find((l) => l);
  return line || '';
}

const because = (r) => (firstLine(r) ? ' (' + firstLine(r) + ')' : '');

/* This half touches nothing, so a register is proven before the board it
 * replaces stops. The read-compare spares a task already current, and
 * only the live store may write the register. */
function planTask(root, run, sid, home) {
  const wanted = wantedAction(root);
  const q = run(['/query', '/tn', TASK_NAME, '/xml']);
  const current = q.code === 0 ? parseAction(q.stdout) : null;
  /* nothing is owed: the task already points where it should */
  if (actionMatches(wanted, current)) return { ok: true, xml: null };

  if (!isLiveRoot(root, home)) {
    return { ok: false, detail: 'the scheduled task "' + TASK_NAME
      + '" was not registered: this store root is not the live store root, and only'
      + ' the live store may point the one machine-wide task' };
  }
  const id = sid();
  if (!id) {
    return { ok: false, detail: 'the scheduled task "' + TASK_NAME
      + '" could not be registered: the user SID could not be read' };
  }
  try {
    return { ok: true, xml: taskXml({ sid: id, command: wanted.command, args: wanted.args }) };
  } catch (e) {
    return { ok: false, detail: 'the scheduled task "' + TASK_NAME + '" could not be registered: '
      + ((e && e.message) || e) };
  }
}

/* two logon tasks on one port is a race, and the register is the one moment
 * both names are known. Best effort by design: a refused delete costs one line.
 * a PC that never had the old task logs nothing; the exit code says so,
 * never schtasks' localized text. */
function dropLegacyTask(root, run) {
  try {
    if (run(['/query', '/tn', LEGACY_TASK_NAME]).code !== 0) return;
    const r = run(['/delete', '/tn', LEGACY_TASK_NAME, '/f']);
    if (r.code === 0) appendLog(root, 'the scheduled task "' + LEGACY_TASK_NAME + '" was removed');
    else appendLog(root, 'the scheduled task "' + LEGACY_TASK_NAME + '" was not removed:'
      + ' schtasks /delete exited ' + r.code + because(r));
  } catch (e) {
    appendLog(root, 'the scheduled task "' + LEGACY_TASK_NAME + '" was not removed: '
      + ((e && e.message) || e));
  }
}

/* The only half that writes, and it writes the register, not the running board,
 * which is what makes it safe ahead of the stop. The document carries the SID,
 * so it dies in a finally. */
function registerTask(xml, run) {
  let dir = null;
  try {
    dir = mkdtempSync(join(tmpdir(), 'nd-board-task-'));
    const file = join(dir, 'board-task.xml');
    /* schtasks reads the file as Unicode; a UTF-8 document is refused as
       malformed, and the BOM is what the reader keys on. */
    writeFileSync(file, BOM + xml, 'utf16le');
    const created = run(['/create', '/tn', TASK_NAME, '/xml', file, '/f']);
    if (created.code !== 0) {
      return { ok: false, detail: 'the scheduled task "' + TASK_NAME + '" could not be registered:'
        + ' schtasks /create exited ' + created.code + because(created) };
    }
    return { ok: true, registered: true };
  } catch (e) {
    return { ok: false, detail: 'the scheduled task "' + TASK_NAME + '" could not be registered: '
      + ((e && e.message) || e) };
  } finally {
    if (dir) { try { rmSync(dir, { recursive: true, force: true }); } catch {} }
  }
}

/* Resolved on both sides and compared without case: a Windows path is
 * case-insensitive and takes either separator, so such a difference is the same
 * directory. */
/* by exact compare and never through realpathSync, since an extra fs
 * call is a new way for this to fail. Exported for its own test. */
export function isLiveRoot(root, home) {
  const norm = (p) => resolve(String(p)).toLowerCase();
  const here = norm(root);
  return here === norm(join(home(), '.claude', STORE_SLUG));
}

/* The only step that must wait for the stop, and deliberately the smallest
 * left: the window in which a failure leaves no board is one schtasks call
 * wide. */
function runTask(run) {
  const started = run(['/run', '/tn', TASK_NAME]);
  if (started.code !== 0) {
    return { ok: false, detail: 'the scheduled task "' + TASK_NAME + '" could not be run:'
      + ' schtasks /run exited ' + started.code + because(started) };
  }
  return { ok: true };
}

/* Exported rather than copied, so the code has one loopback ping and not two
 * that can drift on the rule they read. */
export function pingBoard(port, secret) {
  return probe(port, secret).then((p) => p.mine === true, () => false);
}

/* the secret path is the identity, since every version reads the same
   board/secret; a 204 there is an AskerDo server of this store whatever header
   it sends, and its version is unknown (so older) without x-askerdo-board.
   Always dials 127.0.0.1: the OS resolver does not know *.localhost. */
export function probe(port, secret) {
  return new Promise((done) => {
    let settled = false;
    const finish = (v) => { if (!settled) { settled = true; done(v); } };
    const req = httpRequest({
      host: '127.0.0.1', port, method: 'POST', path: '/' + secret + '/ping', timeout: 1500,
    }, (res) => {
      res.resume();
      const header = res.headers['x-askerdo-board'];
      finish({
        listening: true,
        mine: res.statusCode === 204,
        version: typeof header === 'string' ? header : undefined,
        tray: typeof res.headers['x-askerdo-tray-state'] === 'string' ? res.headers['x-askerdo-tray-state'] : undefined,
      });
    });
    /* no answer in time is a busy server or a stranger, so it is never treated as ours */
    req.on('timeout', () => { req.destroy(); finish({ listening: true, mine: false, busy: true, version: undefined }); });
    req.on('error', () => finish({ listening: false, mine: false, version: undefined }));
    req.end();
  });
}

/* answers the status code, 0 when nothing answered */
function postRoute(port, secret, route, headers = {}) {
  return new Promise((done) => {
    const req = httpRequest({
      host: '127.0.0.1', port, method: 'POST', path: '/' + secret + '/' + route, timeout: 1500, headers,
    }, (res) => { res.resume(); res.on('end', () => done(res.statusCode)); });
    req.on('timeout', () => { req.destroy(); done(0); });
    req.on('error', () => done(0));
    req.end();
  });
}

/* /stop first; a server still up after the wait is ended by the pid its
   local.json names, once that pid checks out as the local server. The stop names
   the version seen, and a current server found instead is adopted: the session starts
   the harness runs side by side replace the old server once, not each other's. */
async function stopOld(root, port, secret, waitMs, endPid, seen) {
  const down = () => probe(port, secret).then((x) => !x.listening);
  const current = () => probe(port, secret).then((x) => x.mine && x.version === version());
  const adopted = () => {
    appendLog(root, 'board ensure: another session start had already replaced the old local server');
    return { ok: true, adopted: true };
  };
  const code = await postRoute(port, secret, 'stop', seen === undefined ? {} : { 'x-askerdo-if-version': seen });
  if (code === 409 && await current()) return adopted();
  if (await waitFor(down, waitMs)) {
    appendLog(root, 'board ensure: the old local server stopped through /stop');
    return { ok: true };
  }
  if (seen !== undefined && await current()) return adopted();
  let pid = null;
  try { pid = JSON.parse(readFileSync(join(root, 'board', 'local.json'), 'utf8')).pid; } catch {}
  if (!Number.isInteger(pid) || pid <= 0) {
    return { ok: false, detail: 'the old local server did not stop through /stop, and board/local.json names no pid to end' };
  }
  let ended;
  try { ended = await endPid(pid, port); } catch (e) { ended = { ok: false, detail: (e && e.message) || String(e) }; }
  if (!ended || !ended.ok) {
    return { ok: false, detail: 'the old local server did not stop through /stop, and pid ' + pid + ' was not ended: '
      + ((ended && ended.detail) || 'no reason given') };
  }
  if (!await waitFor(down, waitMs)) {
    return { ok: false, detail: 'the old local server still answers after pid ' + pid + ' was ended' };
  }
  appendLog(root, 'board ensure: the old local server ignored /stop and was ended by pid ' + pid);
  return { ok: true };
}

/* A command line that is node running the local server, read through ps. */
export function isBoardServerCommand(line) {
  const text = String(line || '').replace(/[\\]/g, '/');
  const exe = (/^\s*"([^"]+)"/.exec(text) || /^\s*(\S+)/.exec(text) || [])[1] || '';
  return /(^|\/)node(\.exe)?$/i.test(exe) && /(^|[\s"/])board-server\.mjs(\s|"|$)/.test(text);
}

/* Windows tools by path, as whoami is: the image name, and the pids whose
   local address is the identity port (the state word is localized, so not read). */
const system32 = (exe) => (process.env.SystemRoot ? join(process.env.SystemRoot, 'System32', exe) : exe);

export function portHolders(netstat, port) {
  const at = new RegExp('^\\s*TCP\\s+127\\.0\\.0\\.1:' + port + '\\s+\\S+\\s+(?:\\S+\\s+)?(\\d+)\\s*$', 'i');
  const pids = new Set();
  for (const line of String(netstat || '').split(/\r?\n/)) {
    const m = at.exec(line);
    if (m && m[1] !== '0') pids.add(Number(m[1]));
  }
  return pids;
}

/* Ends the pid only when it is the node process holding this store's port
   (Windows) or a node running board-server.mjs (elsewhere): a reused pid is left alone. */
function realEndPid(pid, port) {
  if (process.platform === 'win32') {
    const opts = { encoding: 'utf8', windowsHide: true };
    const image = spawnSync(system32('tasklist.exe'), ['/FI', 'PID eq ' + pid, '/FO', 'CSV', '/NH'], opts);
    const name = (/^"([^"]*)"/.exec(String(image.stdout || '').trim()) || [])[1] || '';
    if (name.toLowerCase() !== 'node.exe') return { ok: false, detail: 'pid ' + pid + ' is not a node process' };
    const net = spawnSync(system32('NETSTAT.EXE'), ['-ano', '-p', 'tcp'], opts);
    if (!portHolders(net.stdout, port).has(pid)) return { ok: false, detail: 'pid ' + pid + ' does not hold port ' + port };
  } else {
    const r = spawnSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' });
    if (!isBoardServerCommand((r.stdout || '').trim())) {
      return { ok: false, detail: 'pid ' + pid + ' is not a node process running board-server.mjs' };
    }
  }
  process.kill(pid);
  return { ok: true };
}

async function waitFor(check, capMs) {
  const deadline = Date.now() + capMs;
  for (;;) {
    if (await check()) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, STEP_MS));
  }
}
