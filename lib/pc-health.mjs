/* what is wrong with AskerDo on this PC, in one pass: the store, the config and
   board join, the board, this PC's local server and tray, and a copy an update replaced.
   Never throws; each check is bounded by a short wait, and each problem carries its fix. */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { boardHealth, boardRequest, boardToken, boardUrl, deviceName } from './board-call.mjs';
import { boardIdentity, probe } from './board-ensure.mjs';
import { aimRef } from './branch-aim.mjs';
import { hostedHere } from './board-host.mjs';
import { dataDir, envSeam, loadConfig, oldDirEdits, pcDir, pluginRoot, pluginVersion, replacedCopy, sandboxHome, shippedCommits, storeRoot } from './node-helpers.mjs';
import { commitWords, versionWords } from './mod-core.mjs';
import { CARRIER_FILE } from './mod-scripts.mjs';
import { pluginUpdates } from './plugin-updates.mjs';
import { trayExePath } from './tray.mjs';
import { API, PROTOCOL, protocolWords } from '../server/paths.mjs';

const WAIT_MS = 2000;
const isHttp = (u) => /^https?:/i.test(String(u || ''));

/* 'ok', 'denied' (the board does not know this token) or 'unreachable' */
async function tokenCheck(url, token, timeoutMs) {
  try {
    await boardRequest('GET', API + '/timings', undefined, { url, token, timeoutMs });
    return 'ok';
  } catch (e) {
    return e && e.status === 401 ? 'denied' : e && e.status > 0 ? 'ok' : 'unreachable';
  }
}

const safe = (f, fallback) => { try { return f(); } catch { return fallback; } };

/* settings a plugin remove can still delete, or a save an older session made
   where this copy no longer reads; null when neither. */
function settingsPlace(env) {
  const data = dataDir(env);
  const pc = pcDir(env);
  if (data && pc && data !== pc) {
    return { says: "this PC's settings are still in the plugin data folder " + data + ', which a plugin remove deletes', fix: 'start a new session: its start moves them to ' + pc + '; if this stays, read sync.log in ' + data };
  }
  const e = oldDirEdits(env);
  if (e) return { says: 'a session on an older AskerDo saved ' + e.keys.join(', ') + ' in ' + e.from + ', where this copy does not read', fix: 'start a new session: its start takes them into ' + pc };
  return null;
}

/* the mod's mark of a session whose main prompt had no carrier section, or null */
function promptMark(env) {
  const dir = dataDir(env);
  if (!dir) return null;
  try {
    const m = JSON.parse(readFileSync(join(dir, CARRIER_FILE), 'utf8'));
    return m && typeof m === 'object' ? m : null;
  } catch { return null; }
}

const seenIn = (m) => [m.session ? 'session ' + m.session : '', stampOf(m.at)].filter(Boolean).join(', ');

/* the mod's mark that its prompt hooks did not run, as status and the doctor say it */
export function promptOffWords(m) {
  const seen = seenIn(m);
  return "AskerDo's prompt hooks do not run on this PC" + (seen ? ' (first seen in ' + seen + ')' : '')
    + ": where an organization manages Claude Code (managed settings, or a Team or Enterprise login), Claude Code's built-in guard keeps a user-installed mod's prompt hooks from running."
    + ' AskerDo\'s rules and sections ride each session\'s prompts as notes instead of its system prompt; the band, the pane, the askerdo CLI and the output style work as usual.'
    + ' Only an administrator can change it, by installing AskerDo as the organization\'s own plugin in managed settings.';
}

/* the words when this PC's mark says the prompt hooks are off, else '' */
export function promptOffNote(env = process.env) {
  const m = promptMark(env);
  return m && m.off ? promptOffWords(m) : '';
}

const FETCH_MS = 3000;

/* Resolves on the fetch's exit or the wait, whichever first: a credential helper or a
   remote helper left running must never hold status. */
function fetchBounded(dir, ms) {
  return new Promise((done) => {
    const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' };
    if (!env.GIT_SSH_COMMAND) env.GIT_SSH_COMMAND = 'ssh -o BatchMode=yes';
    let child;
    try {
      child = spawn('git', ['-C', dir, 'fetch', '--quiet', '--no-tags', '--no-recurse-submodules'], { stdio: 'ignore', windowsHide: true, env });
    } catch { done(false); return; }
    const timer = setTimeout(() => { try { child.kill(); } catch {} done(false); }, ms);
    timer.unref();
    child.on('error', () => { clearTimeout(timer); done(false); });
    child.on('exit', (code) => { clearTimeout(timer); done(code === 0); });
  });
}

/* how far a git checkout install lags its remote branch (lib/branch-aim.mjs) after a
   short fetch, or null: a released install (no .git), no remote branch, or none behind.
   A failed fetch still reports the lag the last fetch learned, marked stale. */
export async function checkoutBehind(dir = pluginRoot, { ms = FETCH_MS } = {}) {
  if (!dir || !existsSync(join(dir, '.git'))) return null;
  const git = (args) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', windowsHide: true, timeout: 2000 });
  const head = git(['symbolic-ref', '-q', 'HEAD']);
  if (head.status !== 0 || !git(['remote']).stdout.trim()) return null;
  const fetched = await fetchBounded(dir, ms);
  const aim = aimRef(dir);
  if (!aim) return null;
  const [ahead, behind] = git(['rev-list', '--left-right', '--count', 'HEAD...' + aim.ref]).stdout.trim().split(/\s+/).map(Number);
  return behind > 0 ? { behind, ahead: ahead || 0, upstream: aim.ref, remote: aim.remote, branch: aim.branch, dir, stale: !fetched } : null;
}

const stampOf = (ms) => {
  const d = new Date(Number(ms));
  const p = (n) => String(n).padStart(2, '0');
  return Number.isNaN(d.getTime()) ? '' : d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
};

/* Real seams by default; a test hands in fakes. Returns { ok, checks, problems }, each
   check { key, ok, says } and each problem { key, says, fix, command?, copy? }, `command` being
   the askerdo verb that fixes it here, `copy` a command to run elsewhere. */
export async function pcHealth({
  env = process.env, platform = process.platform, timeoutMs = WAIT_MS,
  root = safe(() => storeRoot(undefined, env), ''), config = safe(() => loadConfig(env), null),
  version = safe(() => envSeam('BOARD_VERSION', env) || pluginVersion(), ''), replaced = replacedCopy(),
  device = deviceName(hostname()), health = boardHealth, token = tokenCheck, ping = probe,
  identity = boardIdentity, exists = existsSync, trayExe = trayExePath, place = () => settingsPlace(env), updates = () => pluginUpdates({ env }),
  carrier = () => promptMark(env), shipped = () => shippedCommits(), checkout = () => checkoutBehind(),
} = {}) {
  /* the fetch runs beside the board checks */
  const lag = Promise.resolve().then(checkout).catch(() => null);
  const checks = [];
  const problems = [];
  const pass = (key, says) => checks.push({ key, ok: true, says });
  /* side: 'pc' when a board problem's fix is on this PC, so the status row names that */
  const fail = (key, says, fix, command, copy, side) => {
    checks.push({ key, ok: false, says });
    problems.push({ key, says, fix, ...(command ? { command } : {}), ...(copy ? { copy } : {}), ...(side ? { side } : {}) });
  };
  /* last, since nothing here fixes it: the mod's blocks reach a recorded prompt only at its start */
  const done = async () => {
    const b = await lag;
    if (b) {
      /* a dev checkout updates through live-update, which stops this PC's server and tray first;
         it moves the main checkout, never a linked worktree (its .git is a file) */
      const live = existsSync(join(b.dir, 'scripts', 'live-update.mjs')) && safe(() => statSync(join(b.dir, '.git')).isDirectory(), false);
      const step = live ? 'node "' + join(b.dir, 'scripts', 'live-update.mjs') + '"' : 'git -C "' + b.dir + '" pull --ff-only ' + b.remote + ' ' + b.branch;
      const says = 'this AskerDo copy is a git checkout ' + b.behind + ' commit' + (b.behind === 1 ? '' : 's') + ' behind ' + b.upstream
        + (b.ahead ? ' and ' + b.ahead + ' ahead of it' : '') + (b.stale ? ' (as the last fetch knew: the fetch just now did not finish)' : '');
      if (b.ahead) fail('checkout', says, 'its own commits stop a fast-forward: merge ' + b.upstream + ' into ' + b.dir + ' by hand, then start a new session');
      else fail('checkout', says, 'run ' + step + ', then start a new session', '', step);
    }
    const m = safe(carrier, null);
    /* no fix is the user's, so a note, not a problem the band keeps drawing */
    if (m && m.off) checks.push({ key: 'prompt', ok: true, note: true, says: promptOffWords(m) });
    else if (m) {
      const seen = [m.session ? 'session ' + m.session : '', stampOf(m.at)].filter(Boolean).join(', ');
      fail('prompt', "the engine's prompt has no context_management section" + (seen ? ' (first seen in ' + seen + ')' : '') + ', so rule changes reach open sessions only at their next start',
        'start a new session to pick up a rule change; this clears once a session\'s prompt carries the section again (an AskerDo update that follows the engine)');
    }
    return { ok: !problems.length, checks, problems };
  };

  /* first: an old copy explains every other line it would print */
  if (replaced) fail('copy', 'this session runs AskerDo ' + (version || 'of an unknown version') + ', a copy a plugin update replaced', 'start a new session, which runs the installed version');
  else pass('copy', 'AskerDo ' + (version || 'of an unknown version') + ' is the installed copy');

  const url = safe(() => boardUrl(env), '');
  /* a PC on neither a board nor the hub queue keeps no store, and a session start makes none before setup */
  const usesStore = config ? config.queue === 'hub' || !!url : !!url;
  if (!usesStore) pass('store', config ? 'not used (queue ' + config.queue + ')' : 'not made until AskerDo is set up on this PC');
  else if (!root || !exists(root)) fail('store', 'the AskerDo store folder ' + (root || '(none)') + ' does not exist', 'start a new session: its start makes the store and its launcher');
  else if (!exists(join(root, 'cli.mjs'))) fail('store', 'the store folder ' + root + ' has no launcher (cli.mjs)', 'start a new session: its start writes the launcher');
  else pass('store', 'the store is at ' + root);

  const joinCode = 'askerdo join-code --device ' + device;
  const rejoin = 'on a PC on the board run ' + joinCode + ', then run /askerdo:configure here and join with that code';
  const hub = !config || config.queue === 'hub';
  /* a fresh install and a lost config look the same, so setup leads and the rejoin follows */
  if (!config && !url) fail('config', 'AskerDo has no saved settings on this PC (no config.json in ' + (safe(() => dataDir(env), '') || 'its data folder') + '), so it is not on a board', 'run /askerdo:configure here to set it up; to rejoin a board, first run ' + joinCode + ' on a PC on the board', '', joinCode);
  else if (!url && hub) fail('config', 'the settings name no board, so this PC left the board', rejoin, '', joinCode);
  else if (!url) pass('config', 'not on a board (queue ' + config.queue + ')');
  else pass('config', 'the board is ' + url);
  const stray = config ? safe(place, null) : null;
  if (stray) fail('settings', stray.says, stray.fix);
  /* either answer is fine, so this is never a problem */
  const u = safe(updates, null);
  if (u && u.on !== null) pass('updates', "the Claude app's auto-update for AskerDo is " + (u.on ? 'on' : 'off: askerdo settings set pluginUpdates on turns it on'));

  if (isHttp(url)) {
    const [h, t] = await Promise.all([
      Promise.resolve(health(url, timeoutMs)).catch(() => null),
      Promise.resolve(token(url, safe(() => boardToken(env), ''), timeoutMs)).catch(() => 'unreachable'),
    ]);
    if (!h) fail('board', 'the board at ' + url + ' does not answer', 'check the PC or container the board runs on is up and reachable from here, then run askerdo status again');
    else if (Number.isInteger(h.protocol) && h.protocol !== PROTOCOL) {
      /* the board refuses every call: which side updates; a board this PC runs updates with its local server */
      const w = protocolWords(PROTOCOL, h.protocol);
      if (w.side === 'board' && hostedHere(root, url)) fail('board', w.says, 'run askerdo board --restart, which starts it from the installed plugin', 'board --restart');
      else fail('board', w.says, w.fix, '', w.copy, w.side);
    } else if (t === 'denied') fail('board', 'the board at ' + url + ' does not know this PC\'s token, so the join is gone', rejoin, '', joinCode);
    else {
      const behind = versionWords(version, h.version).behind;
      /* a board on an older shipped commit is an update that did not take */
      const c = commitWords(h.commit, safe(shipped, []));
      if (behind) fail('board', behind, 'update AskerDo where the board runs');
      else if (c.behind) fail('board', c.behind, 'run the board server update again with the commit last shipped, then check askerdo board names it');
      else pass('board', 'the board answers' + (typeof h.version === 'string' ? ' and runs ' + h.version : '') + ', ' + c.commit);
    }
  } else if (url) pass('board', 'the board runs in process (' + url.split(':')[0] + ':)');

  /* the local server and the tray serve the board; with none there is nothing to check */
  if (!url) return done();
  let ident = null;
  try { ident = identity(root); } catch {}
  if (!ident) {
    fail('server', 'this PC\'s local server has never started here (the store holds no board identity)', 'run askerdo board', 'board');
    return done();
  }
  const p = await Promise.resolve(ping(ident.port, ident.secret)).catch(() => ({ listening: false, mine: false }));
  if (!p.listening) fail('server', 'this PC\'s local server is not running (nothing on port ' + ident.port + ')', 'run askerdo board', 'board');
  else if (p.busy) fail('server', 'the local server is busy (it did not answer within the wait on port ' + ident.port + ')', 'run askerdo status again; if it stays busy, run askerdo board --restart', 'board --restart');
  else if (!p.mine) fail('server', 'another program holds port ' + ident.port + ', where this PC\'s local server belongs', 'stop the program on port ' + ident.port + ', then run askerdo board');
  else if (!replaced && p.version !== version) {
    fail('server', 'this PC\'s local server runs ' + (p.version ? 'AskerDo ' + p.version : 'an older AskerDo') + ' and this plugin is ' + version, 'run askerdo board --restart', 'board --restart');
  } else if (!replaced && p.code === 'held') {
    fail('server', 'this PC\'s local server stays on its old code' + (stampOf(Date.parse(p.heldSince)) ? ' since ' + stampOf(Date.parse(p.heldSince)) : '') + ' and keeps serving: ' + (p.held || 'its new code does not load'),
      'fix what it names (or finish the merge); the server moves to the new code by itself once that code loads');
  } else if (!replaced && p.code === 'stale') {
    fail('server', 'this PC\'s local server runs code its copy has since replaced (CLI calls run in their callers until it restarts)', 'run askerdo board --restart', 'board --restart');
  } else pass('server', 'the local server answers on port ' + ident.port + (p.version ? ' and runs ' + p.version : ''));

  /* the tray reports on the ping (Windows only); an older server says nothing, which is no problem */
  if (platform === 'win32' && p.mine) {
    /* a server under the sandbox seam runs no tray (lib/tray.mjs), so its down is no problem */
    if (safe(() => sandboxHome(env), null)) pass('tray', 'no tray runs under the sandbox seam');
    else if (p.tray === 'closed') fail('tray', 'the tray was exited, so alerts and the mark are not shown', 'run askerdo board, which brings the tray back', 'board');
    /* a server cannot start an exe its copy lacks */
    else if (p.tray === 'down' && !exists(trayExe())) fail('tray', 'the tray program is missing from this AskerDo copy (' + trayExe() + ')', 'update AskerDo (claude plugin update askerdo@askerdo) and start a new session');
    else if (p.tray === 'down') fail('tray', 'the tray is not running', 'run askerdo board, which starts it', 'board');
    else if (p.tray === 'up') pass('tray', 'the tray is up');
    else if (p.tray === 'off') pass('tray', 'the tray is switched off in the notification settings');
  }
  return done();
}

/* One line per check, the problem's fix under it. */
export function healthText(r) {
  const lines = [];
  for (const c of r.checks) {
    lines.push((c.note ? 'NOTE    ' : c.ok ? 'ok      ' : 'PROBLEM ') + c.key + ': ' + c.says);
    const p = !c.ok && r.problems.find((x) => x.key === c.key && x.says === c.says);
    if (p) lines.push('        fix: ' + p.fix);
  }
  lines.push(r.ok ? 'nothing is wrong with AskerDo on this PC' + (r.checks.some((c) => c.note) ? ' that it can fix' : '') : r.problems.length + ' problem' + (r.problems.length === 1 ? '' : 's') + ': the first fix listed comes first');
  return lines.join('\n');
}
