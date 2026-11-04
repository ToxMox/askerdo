/* what is wrong with AskerDo on this PC, in one pass: the store, the config and
   board join, the board, this PC's local server and tray, and a copy an update replaced.
   Never throws; each check is bounded by a short wait, and each problem carries its fix. */
import { existsSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { boardHealth, boardRequest, boardToken, boardUrl, deviceName } from './board-call.mjs';
import { boardIdentity, probe } from './board-ensure.mjs';
import { dataDir, envSeam, loadConfig, oldDirEdits, pcDir, pluginVersion, replacedCopy, sandboxHome, storeRoot } from './node-helpers.mjs';
import { versionWords } from './mod-core.mjs';
import { pluginUpdates } from './plugin-updates.mjs';
import { trayExePath } from './tray.mjs';
import { API } from '../server/paths.mjs';

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

/* Real seams by default; a test hands in fakes. Returns { ok, checks, problems }, each
   check { key, ok, says } and each problem { key, says, fix, command?, copy? }, `command` being
   the askerdo verb that fixes it here, `copy` a command to run elsewhere. */
export async function pcHealth({
  env = process.env, platform = process.platform, timeoutMs = WAIT_MS,
  root = safe(() => storeRoot(undefined, env), ''), config = safe(() => loadConfig(env), null),
  version = safe(() => envSeam('BOARD_VERSION', env) || pluginVersion(), ''), replaced = replacedCopy(),
  device = deviceName(hostname()), health = boardHealth, token = tokenCheck, ping = probe,
  identity = boardIdentity, exists = existsSync, trayExe = trayExePath, place = () => settingsPlace(env), updates = () => pluginUpdates({ env }),
} = {}) {
  const checks = [];
  const problems = [];
  const pass = (key, says) => checks.push({ key, ok: true, says });
  const fail = (key, says, fix, command, copy) => {
    checks.push({ key, ok: false, says });
    problems.push({ key, says, fix, ...(command ? { command } : {}), ...(copy ? { copy } : {}) });
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
    else if (t === 'denied') fail('board', 'the board at ' + url + ' does not know this PC\'s token, so the join is gone', rejoin, '', joinCode);
    else {
      const behind = versionWords(version, h.version).behind;
      if (behind) fail('board', behind, 'update AskerDo where the board runs');
      else pass('board', 'the board answers' + (typeof h.version === 'string' ? ' and runs ' + h.version : ''));
    }
  } else if (url) pass('board', 'the board runs in process (' + url.split(':')[0] + ':)');

  /* the local server and the tray serve the board; with none there is nothing to check */
  if (!url) return { ok: !problems.length, checks, problems };
  let ident = null;
  try { ident = identity(root); } catch {}
  if (!ident) {
    fail('server', 'this PC\'s local server has never started here (the store holds no board identity)', 'run askerdo board', 'board');
    return { ok: !problems.length, checks, problems };
  }
  const p = await Promise.resolve(ping(ident.port, ident.secret)).catch(() => ({ listening: false, mine: false }));
  if (!p.listening) fail('server', 'this PC\'s local server is not running (nothing on port ' + ident.port + ')', 'run askerdo board', 'board');
  else if (p.busy) fail('server', 'the local server is busy (it did not answer within the wait on port ' + ident.port + ')', 'run askerdo status again; if it stays busy, run askerdo board --restart', 'board --restart');
  else if (!p.mine) fail('server', 'another program holds port ' + ident.port + ', where this PC\'s local server belongs', 'stop the program on port ' + ident.port + ', then run askerdo board');
  else if (!replaced && p.version !== version) {
    fail('server', 'this PC\'s local server runs ' + (p.version ? 'AskerDo ' + p.version : 'an older AskerDo') + ' and this plugin is ' + version, 'run askerdo board --restart', 'board --restart');
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
  return { ok: !problems.length, checks, problems };
}

/* One line per check, the problem's fix under it. */
export function healthText(r) {
  const lines = [];
  for (const c of r.checks) {
    lines.push((c.ok ? 'ok      ' : 'PROBLEM ') + c.key + ': ' + c.says);
    const p = !c.ok && r.problems.find((x) => x.key === c.key && x.says === c.says);
    if (p) lines.push('        fix: ' + p.fix);
  }
  lines.push(r.ok ? 'nothing is wrong with AskerDo on this PC' : r.problems.length + ' problem' + (r.problems.length === 1 ? '' : 's') + ': the first fix listed comes first');
  return lines.join('\n');
}
