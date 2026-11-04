/* The tray is the committed exe and nothing else: no script, no
 * shell. With no exe on disk there is no tray and every alert is logged and
 * dropped; board/tray.json is for diagnosis, never a kill. */
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawn as nodeSpawn } from 'node:child_process';
import { appendLog, writeAtomic } from './store-io.mjs';
import { envSeam, pluginRoot, pluginVersion } from './node-helpers.mjs';

/* Not a served asset and never in lib/board-assets.mjs: the tray reads it off
 * disk, and the whitelist is not a directory listing. */
export const TRAY_EXE = 'askerdo-tray.exe';

/* Long enough for a cold start to reach the stream, short enough that a verb
 * and a route stay immediate. Past it the alert is dropped rather than queued:
 * a late notification is noise. */
export const TRAY_ATTACH_WAIT_MS = 500;

/* The exe removes its icon on EOF, which a kill does not, so this wait is the
 * difference between a tidy notification area and a ghost until the next
 * hover. */
export const TRAY_STOP_MS = 1000;

/* The floor under the crash restart: a crash loop costs one start a minute,
 * which is a diagnosable trickle rather than a fork bomb. Injectable, so no
 * test sits through it. */
export const TRAY_RESTART_MIN_MS = 60000;

/* The exe's self-reap after two unanswered pings is a crash, not an Exit: a
 * server that recovers puts its tray back rather than reading its own reaped
 * exe as a choice. */
export const TRAY_EXIT_GONE = 6;

export function trayExePath() {
  return join(pluginRoot, 'assets', TRAY_EXE);
}

export function trayRecordPath(root) {
  return join(root, 'board', 'tray.json');
}

function fileExists(p) {
  try { return existsSync(p); } catch { return false; }
}

/* The names are the dot states lib/board-state.mjs returns, and the ping header
 * carries exactly one. */
export const TRAY_FACES = ['waiting', 'quiet', 'blocking'];

/* The face a caller asked for, or the one the tray wore before it had any
   others. */
function faceOf(dot) {
  return TRAY_FACES.includes(dot) ? dot : 'waiting';
}

/* A count is a count: anything that is not a whole number of blocking
   questions is zero, which is what the tooltip says nothing about. */
function countOf(n) {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

/* Pure, so a test reads the wire contract's argv with no process in sight.
 * --no-icon hides the icon and not the tray, and an empty version is
 * '0.0.0', since it ends up in a user agent. */
export function trayArgs({
  url, events, ping, instance, dot, blocking, version, icon, log, settings, notify, addPc,
}) {
  const args = [
    '--board', String(url),
    '--events', String(events),
    '--ping', String(ping),
    '--instance', String(instance),
    '--dot', faceOf(dot),
    '--blocking', String(countOf(blocking)),
    '--version', String(version === undefined || version === null ? '' : version) || '0.0.0',
  ];
  /* The menu's two URLs: an absent flag omits that line, and the
   * settings page takes no POST (measured), so the route is its own flag. A
   * rename must not become a silent 404 in a binary. */
  if (settings) args.push('--settings', String(settings));
  if (notify) args.push('--notify', String(notify));
  /* the Add a PC page, which mints a join code through the board */
  if (addPc) args.push('--add-pc', String(addPc));
  if (icon === false) args.push('--no-icon');
  if (log) args.push('--log', String(log));
  return args;
}

export function createTray(deps = {}) {
  const root = deps.root;
  const port = deps.port;
  const secret = deps.secret;
  const instance = deps.instance;
  const spawn = deps.spawn || nodeSpawn;
  const platform = deps.platform || process.platform;
  /* Injectable, so a test hands this module a stub that behaves like the exe
   * and never the real one. */
  const exe = deps.exe === undefined ? trayExePath() : deps.exe;
  const version = deps.version || pluginVersion();
  const env = deps.env || process.env;
  /* the three clocks this module has, all injectable whole, so no test has to
     sit through one: the stop wait, the attach wait, and the floor under the
     crash restart */
  const timers = deps.timers || { setTimeout, clearTimeout };
  const attachWaitMs = Number.isFinite(deps.attachWaitMs) && deps.attachWaitMs > 0
    ? deps.attachWaitMs : TRAY_ATTACH_WAIT_MS;
  const restartMinMs = Number.isFinite(deps.restartMinMs) && deps.restartMinMs >= 0
    ? deps.restartMinMs : TRAY_RESTART_MIN_MS;
  const now = deps.now || (() => new Date());
  const log = deps.log || ((line) => appendLog(root, line));
  const file = trayRecordPath(root);
  const base = 'http://127.0.0.1:' + port + '/' + secret + '/';

  /* Windows and the binary on disk: there is no second answer, so a checkout
   * with no exe wears no tray and says so once. */
  const available = platform === 'win32' && fileExists(exe);
  /* Said once rather than per alert, since the answer cannot change while this
   * server runs; a platform that never had a tray says nothing, which is not
   * news. */
  if (!available && platform === 'win32') {
    log('tray: no exe at ' + (exe || '(no path)') + ': no tray, alerts dropped');
  }
  let child = null;
  let mine = false;
  /* the settings the last start was made under, so a demand that arrives with
     none of its own still knows whether the icon is switched off */
  let held = null;
  /* the state the server computed at spawn, held so a restart puts the tray
     back on the corner it was wearing */
  let face = 'waiting';
  let blocking = 0;
  /* the one bit the server pushes in: the exe reached the stream. Until it is
     true, an exit is a failed start rather than a crash. */
  let attachedYet = false;
  /* 'byPerson' is Exit from the menu and 'replaced' is another instance taking
   * the port; '' while the exe should be running. */
  let exited = '';
  let lastStart = 0;
  let stopTimer = null;
  /* set by stop(), read by every late handler: a server on its way down must
     not start a tray on the way out */
  let stopped = false;
  /* the demands waiting on the next attach, each with the timer that answers it
     no. attached() resolves every one of them at once. */
  const waiting = [];

  const said = (e) => (e && e.message) || e;

  function clearStop() {
    if (!stopTimer) return;
    try { timers.clearTimeout(stopTimer); } catch {}
    stopTimer = null;
  }

  function drop() {
    try { rmSync(file, { force: true }); } catch {}
  }

  function dropMine() {
    if (!mine) return;
    drop();
    mine = false;
  }

  /* Every waiter answered at once, with the same word: true from attached(),
     false from a wait that ran out or from a stop. */
  function settleWaiters(ok) {
    while (waiting.length) {
      const w = waiting.pop();
      try { timers.clearTimeout(w.timer); } catch {}
      try { w.resolve(ok === true); } catch {}
    }
  }

  /* Detection without a blind kill: another instance's record is logged and
   * deleted, its pid untouched. Exported too, so the sweep happens whether or
   * not this server runs a tray. */
  function sweep() {
    let raw;
    try {
      raw = readFileSync(file, 'utf8');
    } catch {
      return;
    }
    let rec = null;
    try { rec = JSON.parse(raw); } catch { rec = null; }
    if (rec && rec.instance === instance) return;
    const pid = rec && rec.pid !== undefined ? rec.pid : 'unknown';
    log('tray: stale record from a previous instance, pid ' + pid);
    drop();
  }

  /* For diagnosis, never for killing. 'kind' keeps its one value: a record that
   * lost a key its reader expects would read as corrupt rather than as a
   * simpler build. */
  function writeRecord() {
    try {
      writeAtomic(file, JSON.stringify({
        pid: child.pid, instance, port, kind: 'native', started: now().toISOString(),
      }, null, 2) + '\n', 0o600);
    } catch (e) {
      log('tray: could not write the record: ' + said(e));
    }
  }

  /* The gate is 'enabled', not 'tray': enabled false spawns no exe at
   * all, where tray false hides the icon and leaves the alerts flowing. */
  function start(settings, dot, extra) {
    if (!available) return null;
    if (child) return child;
    /* Before the gate on purpose: another instance's record is diagnosis
     * whether or not this server runs a tray. Only the spawn sits behind the
     * switch. */
    sweep();
    held = settings || null;
    if (!settings || !settings.enabled) return null;
    face = faceOf(dot);
    blocking = countOf(extra && extra.blocking);
    stopped = false;
    exited = '';
    return startExe();
  }

  /* Stdin is the control channel, so it is a pipe; not detached, because a
   * broken pipe is what tells the exe its server died. */
  function startExe() {
    const args = trayArgs({
      url: base,
      events: base + 'api/events',
      ping: base + 'ping',
      instance,
      dot: face,
      blocking,
      version,
      icon: !held || held.tray !== false,
      log: envSeam('TRAY_LOG', env) || '',
      /* Built off this module's own base: shellOpts' are relative hrefs, and a
       * relative path handed to the exe is exit 2. A test pins the two
       * spellings equal. */
      settings: base + 'notifications',
      /* the ROUTE the pause verb is posted to, which is the api sibling of the
         page above it and not the page itself */
      notify: base + 'api/notify',
      addPc: base + 'add-pc',
    });
    attachedYet = false;
    lastStart = now().getTime();
    let born = null;
    try {
      born = spawn(exe, args, { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true, detached: false });
    } catch (e) {
      log('tray: the exe would not start: ' + said(e));
      born = null;
    }
    if (!born) {
      dropMine();
      return null;
    }
    /* Captured rather than read off module state: an old exe still exiting
     * inside the stop wait would otherwise be read as the new tray dying. */
    const c = born;
    child = c;
    mine = true;
    /* an EventEmitter with no error listener throws out of every caller, the
       lesson lib/board-ensure.mjs records; here the listener also carries the
       ENOENT a spawn reports asynchronously rather than by throwing */
    if (c.on) {
      c.on('error', (e) => {
        if (c !== child) return;
        if (stopped) return;
        log('tray: the exe reported ' + said(e));
        gone(-1, c);
      });
      c.on('exit', (code) => gone(code, c));
    }
    if (c.stdin && c.stdin.on) c.stdin.on('error', () => {});
    writeRecord();
    return child;
  }

  /* Only a crash after the attach ever starts an exe from here, and the floor
   * under it is the whole of the loop protection. */
  function gone(code, c) {
    if (c !== undefined && c !== child) return;
    if (stopped) return;
    clearStop();
    child = null;
    if (!attachedYet) {
      log('tray: the exe exited with code ' + code + ' before it attached');
      dropMine();
      /* The attach this start would have brought cannot arrive, so an alert held
       * open for the rest of the window waits on nothing. */
      settleWaiters(false);
      return;
    }
    if (code === 0 || code === 4) {
      exited = code === 0 ? 'byPerson' : 'replaced';
      log('tray: the exe exited with code ' + code
        + (code === 0 ? ' after it attached: the person chose Exit'
          : ' after it attached: another instance took the port'));
      dropMine();
      return;
    }
    /* the one crash with a name: the exe's own self-reap, which says the
       server stopped answering its pings rather than that the exe broke */
    const why = code === TRAY_EXIT_GONE ? ' (the exe reaped itself: two pings went unanswered)' : '';
    const since = now().getTime() - lastStart;
    if (since < restartMinMs) {
      log('tray: the exe exited with code ' + code + why + ' after it attached, '
        + since + ' ms after it started: not starting it again inside ' + restartMinMs + ' ms');
      dropMine();
      return;
    }
    log('tray: the exe exited with code ' + code + why + ' after it attached: starting it again');
    startExe();
  }

  /* The demand seam: an alert with no tray on the stream starts the exe
   * and waits for the attach. A person who chose Exit is not overruled until
   * this server restarts. */
  function ensureRunning(settings) {
    if (!available || stopped) return Promise.resolve(false);
    const s = settings || held;
    if (settings) held = settings;
    if (!s || !s.enabled) return Promise.resolve(false);
    if (exited === 'byPerson') return Promise.resolve(false);
    return demand();
  }

  /* THE OPEN'S OWN DEMAND, the same body with two of the four gates
   * dropped: a CLICK IS A DEMAND FROM THE PERSON, so neither the notification
   * switch nor an earlier Exit overrules it. */
  function ensureForOpen(settings) {
    if (!available || stopped) return Promise.resolve(false);
    if (settings) held = settings;
    return demand();
  }

  /* The exe if there is none, then the attach inside the one budget. */
  function demand() {
    if (!child) {
      exited = '';
      if (!startExe()) return Promise.resolve(false);
    }
    return new Promise((resolve) => {
      const w = { resolve, timer: null };
      w.timer = timers.setTimeout(() => {
        const at = waiting.indexOf(w);
        if (at >= 0) waiting.splice(at, 1);
        resolve(false);
      }, attachWaitMs);
      if (w.timer && w.timer.unref) w.timer.unref();
      waiting.push(w);
    });
  }

  /* The one polite end: EOF makes the exe remove its icon, and the kill follows
   * for one that did not take the hint. Only arming the next kill cancels
   * one. */
  function easeOut(c) {
    if (!c) return;
    try { if (c.stdin && c.stdin.end) c.stdin.end(); } catch {}
    clearStop();
    stopTimer = timers.setTimeout(() => {
      stopTimer = null;
      try { c.kill(); } catch {}
    }, TRAY_STOP_MS);
    if (stopTimer && stopTimer.unref) stopTimer.unref();
  }

  /* The server's one push: it answers every waiting demand, and a later attach
   * after a dropped stream is the same call and equally harmless. */
  function attached() {
    attachedYet = true;
    exited = '';
    settleWaiters(true);
  }

  /* Stopping twice is a no-op, which /stop then shutdown relies on. The kill is
   * a belt: measured, the exe exits within 216 ms of EOF, so the server's exit
   * reaps it anyway. */
  function stop() {
    stopped = true;
    settleWaiters(false);
    if (!child) {
      dropMine();
      return;
    }
    /* stdin EOF first, which is what removes the icon; the kill is for an exe
       that did not take the hint inside the wait */
    easeOut(child);
    child = null;
    dropMine();
  }

  return {
    available,
    exe,
    file,
    sweep,
    start,
    stop,
    attached,
    ensureRunning,
    ensureForOpen,
    exited: () => exited,
    running: () => child,
  };
}
