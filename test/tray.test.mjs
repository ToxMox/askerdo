/* The tray, tested with no tray in sight: the spawner, the platform and the exe
 * path are injected in every case, so this file runs on CI and on a desktop
 * alike and NEVER starts the real exe. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { spawn as nodeSpawn } from 'node:child_process';
import { join } from 'node:path';
import {
  TRAY_ATTACH_WAIT_MS, TRAY_EXE, TRAY_EXIT_GONE,
  TRAY_RESTART_MIN_MS, TRAY_STOP_MS,
  createTray, trayArgs, trayExePath, trayRecordPath,
} from '../lib/tray.mjs';
import { pluginRoot } from '../lib/node-helpers.mjs';
import { pauseLabel, pauseUntil } from '../lib/notify.mjs';
import { tempDir } from './helpers/sandbox.mjs';

const SECRET = 'a1b2c3d4'.repeat(4);
const PORT = 4321;
const BASE = 'http://127.0.0.1:' + PORT + '/' + SECRET + '/';
const INSTANCE = 'inst01';
const VERSION = '9.9.9';
/* THE MENU'S TWO LINKS, off the same base the board URL comes from: the
   exe is handed absolute loopback URLs because a relative path is exit 2 at its
   own argv parser. */
const SETTINGS_URL = BASE + 'notifications';
/* and the ROUTE the pause verb is posted to, which is NOT the page above it:
   measured 2026-09-09, a POST to the settings page is a 404, since the route
   table gates the method */
const NOTIFY_URL = BASE + 'api/notify';
/* the Add a PC page */
const ADD_PC_URL = BASE + 'add-pc';

function fakeSpawn() {
  const calls = [];
  const fn = (exe, args, options) => {
    const child = {
      pid: 4242,
      listeners: {},
      killed: false,
      /* the exe is spawned with a stdin pipe and stopped by ending it, so the
         fake child carries one that records what was done to it */
      stdin: { ended: false, end() { child.stdin.ended = true; }, on() { return child.stdin; } },
      on(name, handler) { child.listeners[name] = handler; return child; },
      unref() { child.unrefs = (child.unrefs || 0) + 1; return child; },
      kill() { child.killed = true; return true; },
    };
    calls.push({ exe, args, options, child });
    return child;
  };
  fn.calls = calls;
  return fn;
}

/* The two clocks this module has, held rather than run: nothing here waits for
   an attach window to close or a kill to be due, the case fires the one it is
   about. */
function fakeTimers() {
  const armed = [];
  return {
    armed,
    setTimeout(fn, ms) {
      const t = { fn, ms, cleared: false, fired: false };
      armed.push(t);
      return t;
    },
    clearTimeout(t) { if (t) t.cleared = true; },
    fire(ms) {
      let ran = 0;
      for (const t of [...armed]) {
        if (t.ms !== ms || t.cleared || t.fired) continue;
        t.fired = true;
        ran += 1;
        t.fn();
      }
      return ran;
    },
  };
}

function fakeLog() {
  const lines = [];
  const fn = (line) => lines.push(line);
  fn.lines = lines;
  return fn;
}

/* An exe file that exists and is never run: every case that only reads the
   argv, the record or a handler wants the exe path taken, not a process. */
function paperExe() {
  const exe = join(tempDir('nd-tray-exe-'), 'paper-tray.exe');
  writeFileSync(exe, 'not a real binary\n');
  return exe;
}

function tray(over = {}) {
  const root = over.root || tempDir('nd-tray-');
  mkdirSync(join(root, 'board'), { recursive: true });
  const spawn = over.spawn || fakeSpawn();
  const log = over.log || fakeLog();
  const timers = over.timers || fakeTimers();
  /* the clock a case can move: gone() reads it against the last start, and the
     floor under the crash restart is the only thing it decides */
  const clock = { at: over.at === undefined ? 1000000 : over.at };
  const t = createTray({
    root,
    port: PORT,
    secret: SECRET,
    instance: over.instance || INSTANCE,
    spawn,
    platform: over.platform || 'win32',
    /* an exe that IS on disk by default, since there is nothing else to be:
       the paper file is never executed, only spawned through the fake */
    exe: over.exe === undefined ? paperExe() : over.exe,
    version: over.version || VERSION,
    env: over.env || {},
    timers,
    restartMinMs: over.restartMinMs,
    attachWaitMs: over.attachWaitMs,
    now: () => new Date(clock.at),
    log,
  });
  return { t, root, spawn, log, timers, clock, record: trayRecordPath(root) };
}

const ON = { enabled: true, woken: true, closed: true, sound: true, tray: true };

/* The guard on the committed artifacts over all SIX faces: the FORM the
   tray's loader can actually read, pinned here rather than through the
   manifest. It reads files and never loads an icon. */
test('the six committed tray faces are five classic DIB frames each, and all six differ', () => {
  const names = [
    'tray-waiting.ico', 'tray-quiet.ico', 'tray-blocking.ico',
    'tray-light-waiting.ico', 'tray-light-quiet.ico', 'tray-light-blocking.ico',
  ];

  for (const name of names) {
    const ico = readFileSync(join(pluginRoot, 'assets', name));
    assert.equal(ico.readUInt16LE(0), 0, name);
    assert.equal(ico.readUInt16LE(2), 1, name + ' is an icon');
    assert.equal(ico.readUInt16LE(4), 5, name + ' carries five entries');
    assert.deepEqual([0, 1, 2, 3, 4].map((i) => ico[6 + 16 * i]), [16, 20, 24, 32, 48],
      name + ' is 16, 20, 24, 32 and 48');

    /* every entry must open with a 40 byte BITMAPINFOHEADER rather than with a
       PNG signature: the exe's own parser (tray/src/icon.rs) reads classic DIB
       entries, and a PNG payload would leave it with no frame to draw */
    for (let i = 0; i < ico.readUInt16LE(4); i++) {
      const at = ico.readUInt32LE(6 + 16 * i + 12);
      assert.equal(ico.readUInt32LE(at), 40, name + ' entry ' + i + ' opens with a DIB header');
      assert.equal(ico.readUInt16LE(at + 14), 32, name + ' entry ' + i + ' is 32 bit');
      assert.notDeepEqual([...ico.subarray(at, at + 4)], [0x89, 0x50, 0x4e, 0x47],
        name + ' entry ' + i + ' is a PNG payload, which the tray loader cannot rasterize');
    }
  }

  /* six distinct faces, all the same length: one design, one container, and
     only the check's colour and the marker changing between them */
  const bytes = names.map((name) => readFileSync(join(pluginRoot, 'assets', name)));
  assert.equal(new Set(bytes.map((b) => b.toString('base64'))).size, 6, 'six distinct faces');
  assert.equal(new Set(bytes.map((b) => b.length)).size, 1, 'one design, one container');

  /* the app identity is the OTHER shape: it keeps its 256 PNG frame, which is
     what Explorer wants and what the tray parser deliberately skips */
  const app = readFileSync(join(pluginRoot, 'assets', 'app.ico'));
  assert.equal(app.readUInt16LE(4), 7, 'app.ico carries seven entries');
  const last = app.readUInt32LE(6 + 16 * 6 + 12);
  assert.deepEqual([...app.subarray(last, last + 4)], [0x89, 0x50, 0x4e, 0x47],
    'app.ico ends on the 256 PNG frame');

  /* and no icon generator is in the tree */
  assert.equal(existsSync(join(pluginRoot, 'scripts', 'make-icon.mjs')), false);
});

/* THE POWERSHELL GUARD: Windows PowerShell 5.1 is not resolved, probed, spawned or
   named anywhere the board runs. The scan is over CODE with comments stripped,
   because the modules name the retired path in their headers. */
test('nothing under lib or hooks resolves, probes, spawns or names PowerShell', () => {
  const files = [
    ['lib', 'tray.mjs'], ['lib', 'notify.mjs'], ['lib', 'notify-page.mjs'],
    ['lib', 'board-ensure.mjs'], ['lib', 'board-task.mjs'],
    ['hooks', 'board-server.mjs'], ['hooks', 'sync.mjs'],
  ];
  for (const parts of files) {
    const src = readFileSync(join(pluginRoot, ...parts), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const where = parts.join('/');
    for (const needle of ['powershell', 'pwsh', 'EncodedCommand', 'NotifyIcon', 'WinRT']) {
      assert.ok(!new RegExp(needle, 'i').test(code), where + ' names ' + needle);
    }
  }
  /* the one deliberate survivor, and it is not a shell-out: lib/viewer-page.mjs
     maps a .ps1 extension to the highlighter's powershell grammar, which is
     reading a file rather than running one */
  const viewer = readFileSync(join(pluginRoot, 'lib', 'viewer-page.mjs'), 'utf8');
  assert.ok(/ps1: "powershell"/.test(viewer), 'the viewer still highlights .ps1');
});

/* THE SPAWN GUARD: the server spawns nothing of its own, and the exe is the one
   opener. ONE SURVIVOR AND NO SECOND, asserted by name: lib/tray.mjs's `startExe`. */
test('nothing under lib or hooks spawns a process on an open path, and one survives', async () => {
  const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const code = strip(readFileSync(join(pluginRoot, 'hooks', 'board-server.mjs'), 'utf8'));
  const calls = [...code.matchAll(/\bspawn\s*\(/g)];
  assert.equal(calls.length, 0, 'the server spawns nothing itself');
  assert.ok(!/spawnOpen/.test(code), 'spawnOpen went with the server-side launch');

  /* every lib module, read rather than listed, because the claim is about all of
     them: a module added later is scanned the day it lands */
  const dir = join(pluginRoot, 'lib');
  const named = [];
  let seen = 0;
  for (const file of readdirSync(dir).filter((n) => n.endsWith('.mjs'))) {
    seen += 1;
    if (/\bspawn\s*\(/.test(strip(readFileSync(join(dir, file), 'utf8')))) named.push(file);
  }
  assert.ok(seen >= 25, 'the lib directory was not read: ' + seen + ' files');
  /* askerdo login opens the browser, and the local server sends it back to run in the caller;
     board-host.mjs starts the board this PC hosts, and the local server on macOS and Linux */
  assert.deepEqual(named, ['board-host.mjs', 'cli-commands.mjs', 'tray.mjs'], 'only the tray module, the board host and login start a child');
  const cliCode = strip(readFileSync(join(dir, 'cli-commands.mjs'), 'utf8'));
  const opener = [...cliCode.slice(0, cliCode.search(/\bspawn\s*\(/)).matchAll(/function ([A-Za-z0-9_]+)/g)].pop();
  assert.equal(opener && opener[1], 'openInBrowser');
  assert.ok((await import('../lib/cli-commands.mjs')).runsInCaller(['login']), 'login never runs in the server');
  /* the SYNCHRONOUS survivors, named so another is noticed: git and node, none
     of them on an open path */
  const sync = readdirSync(dir).filter((n) => n.endsWith('.mjs'))
    .filter((n) => /\bspawnSync\s*\(/.test(strip(readFileSync(join(dir, n), 'utf8'))));
  /* procedures.mjs reads a project's git history for staleness;
     cli-commands.mjs finds a new knowledge record's repo root and runs the sync for
     settings set, both in the caller's process */
  assert.deepEqual(sync, ['board-ensure.mjs', 'cli-commands.mjs', 'procedures.mjs']);
  const trayCode = strip(readFileSync(join(dir, 'tray.mjs'), 'utf8'));
  const head = trayCode.slice(0, trayCode.search(/\bspawn\s*\(/));
  const start = [...head.matchAll(/function ([A-Za-z0-9_]+)/g)].pop();
  assert.equal(start && start[1], 'startExe', 'the one lib spawn is the exe start');
});

const nativeArgs = (over = {}) => trayArgs({
  url: BASE,
  events: BASE + 'api/events',
  ping: BASE + 'ping',
  instance: INSTANCE,
  dot: 'waiting',
  blocking: 0,
  version: VERSION,
  /* the two the server always names; a case that means to exercise an
     absent one passes undefined for it in as many words */
  settings: SETTINGS_URL,
  notify: NOTIFY_URL,
  addPc: ADD_PC_URL,
  ...over,
});

test('the argv is the wire contract, in its order and with the loopback form', () => {
  assert.deepEqual(nativeArgs({ dot: 'blocking', blocking: 3 }), [
    '--board', BASE,
    '--events', BASE + 'api/events',
    '--ping', BASE + 'ping',
    '--instance', INSTANCE,
    '--dot', 'blocking',
    '--blocking', '3',
    '--version', VERSION,
    '--settings', SETTINGS_URL,
    '--notify', NOTIFY_URL,
    '--add-pc', ADD_PC_URL,
  ]);
  /* the OS resolver does not know askerdo.localhost: the browsers
     resolve it themselves (Chromium and Firefox, measured 2026-09-15), and the
     exe hands its board URL to ShellExecute */
  for (const v of nativeArgs()) assert.ok(!String(v).includes('askerdo.localhost'), v);

  /* TWO optional flags, and both only when they are asked for. --log rides only
     when the environment names a path; --no-icon rides only when the tray
     switch is off, which hides the ICON and leaves the toasts. */
  assert.ok(!nativeArgs().includes('--log'));
  assert.ok(!nativeArgs().includes('--no-icon'));
  assert.ok(!nativeArgs({ icon: true }).includes('--no-icon'));
  assert.deepEqual(nativeArgs({ log: 'C:/tmp/tray.log' }).slice(-2), ['--log', 'C:/tmp/tray.log']);
  assert.deepEqual(nativeArgs({ icon: false }).slice(-1), ['--no-icon']);
  assert.deepEqual(nativeArgs({ icon: false, log: 'C:/tmp/tray.log' }).slice(-3),
    ['--no-icon', '--log', 'C:/tmp/tray.log'], 'the flag with no value comes first');

  /* an EMPTY version is a placeholder rather than an empty string: the value ends up
     in the exe's user agent, and a header ending in a bare slash is a malformed one */
  for (const bad of ['', undefined, null]) {
    assert.equal(nativeArgs({ version: bad })[13], '0.0.0', String(bad));
  }
  assert.equal(nativeArgs()[13], VERSION, 'and a real version is untouched');

  /* an unknown state starts on the waiting face, and anything that is not a
     count of blocking questions is 0 */
  assert.equal(nativeArgs({ dot: 'nonsense' })[9], 'waiting');
  for (const bad of [undefined, null, -3, 'many', NaN]) {
    assert.equal(nativeArgs({ blocking: bad })[11], '0', String(bad));
  }
  assert.equal(nativeArgs({ blocking: 12 })[11], '12');
});

test('the exe defaults to the committed binary beside the six faces', () => {
  assert.equal(TRAY_EXE, 'askerdo-tray.exe');
  assert.equal(trayExePath(), join(pluginRoot, 'assets', TRAY_EXE));
  /* resolved from the plugin root exactly as the .ico files are, and NOT read
     here: this suite never depends on the binary being present */
  const t = createTray({ root: tempDir('nd-tray-def-'), port: PORT, secret: SECRET, instance: INSTANCE });
  assert.equal(t.exe, join(pluginRoot, 'assets', TRAY_EXE));
});

test('the exe is spawned with a stdin pipe, hidden, undetached, and recorded as native', () => {
  const n = tray();
  const child = n.t.start(ON, 'blocking', { blocking: 2 });
  assert.ok(child);
  assert.equal(n.spawn.calls.length, 1);
  const call = n.spawn.calls[0];
  assert.equal(call.exe, n.t.exe, 'the exe itself, never a shell');
  assert.deepEqual(call.args, nativeArgs({ dot: 'blocking', blocking: 2 }));
  /* stdin is the control channel, so it is a pipe; the other two are ignored.
     NOT detached: the server owns this child, and a broken pipe is what tells
     the exe its server died without running a shutdown path. */
  assert.deepEqual(call.options, { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true, detached: false });
  assert.equal(typeof call.child.listeners.error, 'function');
  assert.equal(typeof call.child.listeners.exit, 'function');

  const rec = JSON.parse(readFileSync(n.record, 'utf8'));
  assert.deepEqual(Object.keys(rec).sort(), ['instance', 'kind', 'pid', 'port', 'started']);
  assert.equal(rec.pid, 4242);
  assert.equal(rec.instance, INSTANCE);
  assert.equal(rec.port, PORT);
  /* ONE kind survives, and the field survives with it: a record that lost a
     key an older reader expects would read as a corrupt one */
  assert.equal(rec.kind, 'native');
  assert.equal(n.t.running(), child);
  /* NO clock is armed by a start: the only waits are a demand's and a stop's */
  assert.deepEqual(n.timers.armed, []);

  /* the log path rides only when the environment names one */
  const logged = tray({ env: { ASKERDO_TRAY_LOG: 'C:/tmp/tray.log' } });
  logged.t.start(ON, 'quiet', { blocking: 0 });
  assert.deepEqual(logged.spawn.calls[0].args.slice(-2), ['--log', 'C:/tmp/tray.log']);

  /* a second start is a no-op: one server, one tray */
  n.t.start(ON);
  assert.equal(n.spawn.calls.length, 1);
});

test('the tray switch is the ICON switch: tray false runs the exe with --no-icon', () => {
  const off = tray();
  const child = off.t.start({ ...ON, tray: false }, 'quiet', { blocking: 0 });
  assert.ok(child, 'the exe still runs: the toasts have nowhere else to go');
  assert.equal(off.spawn.calls.length, 1);
  assert.ok(off.spawn.calls[0].args.includes('--no-icon'));
  assert.equal(JSON.parse(readFileSync(off.record, 'utf8')).kind, 'native');

  /* and the master switch is the one that spawns nothing at all */
  const dead = tray();
  assert.equal(dead.t.start({ ...ON, enabled: false }, 'quiet', { blocking: 0 }), null);
  assert.equal(dead.spawn.calls.length, 0);
  assert.equal(existsSync(dead.record), false, 'and nothing is recorded either');

  /* with no settings at all, nothing starts by accident */
  const bare = tray();
  assert.equal(bare.t.start(undefined), null);
  assert.equal(bare.spawn.calls.length, 0);
});

test('no exe on disk is no tray at all, and no platform without one either', () => {
  const gone = join(tempDir('nd-tray-exe-'), 'no-such-tray.exe');
  const missing = tray({ exe: gone });
  assert.equal(missing.t.available, false, 'there is nothing to fall back to');
  /* AND IT SAYS SO ONCE, at creation: a Windows checkout carrying no exe runs a
     board server with no tray and drops every alert, and the one line naming
     the missing binary is the only place that can be read from */
  assert.equal(missing.log.lines.length, 1);
  assert.ok(missing.log.lines[0].includes(gone));
  assert.equal(missing.t.start(ON), null);
  assert.equal(missing.spawn.calls.length, 0);
  assert.equal(existsSync(missing.record), false);
  /* and a demand cannot conjure one either */
  return missing.t.ensureRunning(ON).then((up) => {
    assert.equal(up, false);
    assert.equal(missing.spawn.calls.length, 0);

    const linux = tray({ platform: 'linux' });
    assert.equal(linux.t.available, false);
    assert.equal(linux.t.start(ON), null);
    assert.equal(linux.spawn.calls.length, 0);
    /* and a platform that never had a tray says nothing at all: that is not
       news about anything */
    assert.deepEqual(linux.log.lines, []);
  });
});

test('stop ends stdin first and kills only when the wait is up', () => {
  const n = tray();
  const child = n.t.start(ON, 'waiting', { blocking: 0 });
  n.t.attached();
  n.t.stop();
  /* the EOF is what removes the icon; a kill does not, so it comes first */
  assert.equal(child.stdin.ended, true);
  assert.equal(child.killed, false, 'the exe is given the whole wait to leave on its own');
  assert.equal(n.timers.fire(TRAY_STOP_MS), 1, 'one kill is armed, at the pinned wait');
  assert.equal(child.killed, true);
  assert.equal(n.t.running(), null);
  assert.equal(existsSync(n.record), false, 'and our record goes with it');
  assert.equal(TRAY_STOP_MS, 1000);
  assert.equal(TRAY_ATTACH_WAIT_MS, 500);
  assert.equal(TRAY_RESTART_MIN_MS, 60000);
  /* stopping twice is harmless: shutdown runs on several paths */
  n.t.stop();
});

test('a second stop inside the wait leaves the kill the first one armed', () => {
  /* the /stop route stops the tray and shutdown() stops it again inside the same 1000
     ms wait: the second call must not clear the timer before it looks at the child
     and leave it unarmed */
  const n = tray();
  const child = n.t.start(ON, 'waiting', { blocking: 0 });
  n.t.attached();
  n.t.stop();
  n.t.stop();
  n.t.stop();
  assert.equal(n.timers.armed.filter((x) => x.ms === TRAY_STOP_MS && !x.cleared).length, 1,
    'one armed kill, still armed');
  assert.equal(n.timers.fire(TRAY_STOP_MS), 1);
  assert.equal(child.killed, true, 'the exe that ignored the EOF is killed all the same');
  assert.equal(existsSync(n.record), false);
});

test('a stale record from another instance is logged and deleted, and its pid is NOT killed', () => {
  const { t, spawn, log, record } = tray();
  writeFileSync(record, JSON.stringify({ pid: 9999, instance: 'older1', port: PORT, started: 'x' }));
  t.start(ON);
  assert.ok(log.lines.includes('tray: stale record from a previous instance, pid 9999'));
  assert.equal(spawn.calls.length, 1, 'the new tray still starts');
  assert.equal(JSON.parse(readFileSync(record, 'utf8')).instance, INSTANCE, 'and the record is ours now');

  /* the refusal is structural, not incidental: a recycled Windows pid would
     make a blind kill reach an unrelated process, and the exe's own self-reap
     already retires the old tray within about 20 seconds */
  const src = readFileSync(join(pluginRoot, 'lib', 'tray.mjs'), 'utf8');
  assert.ok(!/process\.kill/.test(src));
  assert.ok(!/taskkill/.test(src));
});

test('the stale sweep runs even when the channel is switched OFF', () => {
  const { t, spawn, log, record } = tray();
  writeFileSync(record, JSON.stringify({ pid: 9999, instance: 'older1', port: PORT, started: 'x' }));
  assert.equal(t.start({ ...ON, enabled: false }), null);
  /* a record another instance left behind is diagnosis, not a feature: it is
     read, logged, and deleted whether or not THIS server runs a tray */
  assert.ok(log.lines.includes('tray: stale record from a previous instance, pid 9999'));
  assert.equal(existsSync(record), false, 'and the stale record is gone');
  assert.equal(spawn.calls.length, 0, 'only the SPAWN sits behind the switch');

  /* and the sweep is reachable on its own, which is how the SERVER runs it:
     synchronously at channel start, before anything of its own waits on the
     store, with no settings and no spawn anywhere in sight */
  const solo = tray();
  writeFileSync(solo.record, JSON.stringify({ pid: 8888, instance: 'older2', port: PORT, started: 'x' }));
  solo.t.sweep();
  assert.ok(solo.log.lines.includes('tray: stale record from a previous instance, pid 8888'));
  assert.equal(existsSync(solo.record), false);
  assert.equal(solo.spawn.calls.length, 0, 'a sweep is not a start');
  /* running it twice is a no-op: the first run deleted what the second reads */
  solo.t.sweep();
  assert.equal(solo.log.lines.filter((l) => l.includes('pid 8888')).length, 1);
});

test('an unreadable record is swept the same way, without a throw', () => {
  const { t, spawn, log, record } = tray();
  writeFileSync(record, 'not json\n');
  t.start(ON);
  assert.ok(log.lines.includes('tray: stale record from a previous instance, pid unknown'));
  assert.equal(spawn.calls.length, 1);
});

test('a record another instance owns survives a stop that never started a tray', () => {
  const { t, record } = tray();
  writeFileSync(record, JSON.stringify({ pid: 9999, instance: 'older1', port: PORT, started: 'x' }));
  t.stop();
  assert.equal(existsSync(record), true, 'only the instance that wrote a record removes it');
});

/* ---- what every ending means, and what starts a tray again -------- */

test('an exit BEFORE the attach is logged, starts nothing, and drops the record', () => {
  /* exit 3 is the registration failure the protocol names, 5 is the icon slot
     refusing, 2 is a bad argv, and every one of them is a start that failed.
     There is nothing to fall back to, so nothing starts until the next demand. */
  for (const code of [2, 3, 5, 1, null]) {
    const n = tray();
    const child = n.t.start(ON, 'quiet', { blocking: 0 });
    child.listeners.exit(code);
    assert.equal(n.spawn.calls.length, 1, 'code ' + code);
    assert.equal(n.t.running(), null, 'code ' + code);
    assert.equal(n.t.exited(), '', 'code ' + code + ': an ending on the way up is not a decision');
    assert.equal(existsSync(n.record), false, 'code ' + code);
    assert.ok(n.log.lines.includes(
      'tray: the exe exited with code ' + code + ' before it attached'), n.log.lines.join('|'));
  }
});

test('exit 0 and exit 4 after the attach start nothing and set the state the server reads', () => {
  const person = tray();
  const first = person.t.start(ON, 'quiet', { blocking: 0 });
  person.t.attached();
  first.listeners.exit(0);
  assert.equal(person.spawn.calls.length, 1, 'the person chose Exit: nothing puts it back');
  assert.equal(person.t.exited(), 'byPerson');
  assert.equal(person.t.running(), null);
  assert.equal(existsSync(person.record), false);
  assert.ok(person.log.lines.some((l) => l.includes('the person chose Exit')), person.log.lines.join('|'));

  const taken = tray();
  const second = taken.t.start(ON, 'quiet', { blocking: 0 });
  taken.t.attached();
  second.listeners.exit(4);
  assert.equal(taken.spawn.calls.length, 1, 'a replacement took the port');
  assert.equal(taken.t.exited(), 'replaced');
  assert.ok(taken.log.lines.some((l) => l.includes('another instance took the port')));
});

test('a CRASH after the attach starts the exe once, and never inside the floor', () => {
  /* every code that is not 0 or 4, and a signal (exit code null), is a crash,
     and a crash that left no tray at all would otherwise read exactly like the
     person choosing Exit */
  for (const code of [1, 3, 5, -1, null]) {
    const n = tray({ at: 1000000 });
    const child = n.t.start(ON, 'blocking', { blocking: 2 });
    n.t.attached();
    /* past the floor since the start, so the crash is answered with a restart */
    n.clock.at = 1000000 + TRAY_RESTART_MIN_MS;
    child.listeners.exit(code);
    assert.equal(n.spawn.calls.length, 2, 'code ' + code);
    assert.equal(n.spawn.calls[1].exe, n.t.exe, 'code ' + code + ': the same exe, never a shell');
    assert.deepEqual(n.spawn.calls[1].args, nativeArgs({ dot: 'blocking', blocking: 2 }),
      'code ' + code + ': on the face and count it was wearing');
    assert.equal(n.t.exited(), '', 'code ' + code);
    assert.equal(JSON.parse(readFileSync(n.record, 'utf8')).kind, 'native', 'code ' + code);
    assert.ok(n.log.lines.includes('tray: the exe exited with code ' + code
      + ' after it attached: starting it again'), n.log.lines.join('|'));

    /* ONCE: the restart's own child crashing inside the floor starts nothing,
       so a crash loop costs one start a minute and one line, never a fork bomb */
    const born = n.spawn.calls[1].child;
    n.t.attached();
    n.clock.at += 1;
    born.listeners.exit(code);
    assert.equal(n.spawn.calls.length, 2, 'no restart loop, code ' + code);
    assert.ok(n.log.lines.some((l) => l.includes('not starting it again inside 60000 ms')),
      n.log.lines.join('|'));
    assert.equal(existsSync(n.record), false, 'code ' + code);
  }
});

test('the crash floor is injectable, and a crash inside it says so and stops', () => {
  const n = tray({ restartMinMs: 5000, at: 500000 });
  const child = n.t.start(ON, 'waiting', { blocking: 0 });
  n.t.attached();
  n.clock.at = 500000 + 4999;
  child.listeners.exit(7);
  assert.equal(n.spawn.calls.length, 1, 'one millisecond short of the floor is inside it');
  assert.ok(n.log.lines.includes('tray: the exe exited with code 7 after it attached, '
    + '4999 ms after it started: not starting it again inside 5000 ms'), n.log.lines.join('|'));
});

/* THE SELF-REAP IS A CRASH, NOT A DECISION: the exe retires
   itself after two unanswered pings, so it carries its own exit code and the
   wire is pinned on both ends. */
test('exit 6 is the self-reap: a crash the tray comes back from, named as one', () => {
  assert.equal(TRAY_EXIT_GONE, 6);
  const rust = readFileSync(join(pluginRoot, 'tray', 'src', 'main.rs'), 'utf8');
  assert.ok(/pub const EXIT_GONE: i32 = 6;/.test(rust), 'the exe raises another code');
  const net = readFileSync(join(pluginRoot, 'tray', 'src', 'net.rs'), 'utf8');
  assert.ok(/EXIT_GONE, hwnd, "two ping failures/.test(net), 'the reap does not raise it');

  const n = tray({ at: 1000000 });
  const child = n.t.start(ON, 'quiet', { blocking: 0 });
  n.t.attached();
  n.clock.at = 1000000 + TRAY_RESTART_MIN_MS;
  child.listeners.exit(TRAY_EXIT_GONE);
  assert.equal(n.spawn.calls.length, 2, 'a server that stalled and recovered gets its tray back');
  assert.equal(n.t.exited(), '', 'and it is never read as the person choosing Exit');
  assert.ok(n.log.lines.includes('tray: the exe exited with code 6 (the exe reaped itself: '
    + 'two pings went unanswered) after it attached: starting it again'), n.log.lines.join('|'));

  /* inside the floor it is the same crash, refused the same way and named the
     same way: the next DEMAND is what puts the tray back then */
  const soon = tray({ at: 500000, restartMinMs: 5000 });
  const born = soon.t.start(ON, 'quiet', { blocking: 0 });
  soon.t.attached();
  soon.clock.at = 500000 + 10;
  born.listeners.exit(TRAY_EXIT_GONE);
  assert.equal(soon.spawn.calls.length, 1);
  assert.ok(soon.log.lines.includes('tray: the exe exited with code 6 (the exe reaped itself: '
    + 'two pings went unanswered) after it attached, 10 ms after it started: '
    + 'not starting it again inside 5000 ms'), soon.log.lines.join('|'));
});

test('an old exe exiting after a stop and a start starts nothing beside the new one', () => {
  /* the exit and error handlers are bound to their own child: over module state
     alone, a stop and a start inside the wait, followed by the OLD child's exit,
     would act on a perfectly healthy new exe */
  const n = tray();
  const first = n.t.start(ON, 'waiting', { blocking: 0 });
  n.t.attached();
  n.t.stop();
  const second = n.t.start(ON, 'waiting', { blocking: 0 });
  assert.equal(n.spawn.calls.length, 2);
  assert.notEqual(second, first, 'a new child, and the old one is still exiting');

  first.listeners.exit(1);
  first.listeners.error(new Error('and the error behind it'));
  assert.equal(n.spawn.calls.length, 2, 'nothing acted on the old child');
  assert.equal(n.t.running(), second);
  assert.equal(JSON.parse(readFileSync(n.record, 'utf8')).kind, 'native');
});

test('a spawn that throws and an ENOENT reported late are one line each, and no second tray', () => {
  const exe = paperExe();
  /* the SYNCHRONOUS branch: spawn itself throws (a full process table, a
     permission refusal), so there is no child to hear anything from */
  const throwing = () => { throw new Error('spawn EPERM'); };
  throwing.calls = [];
  const n = tray({ exe, spawn: throwing });
  assert.equal(n.t.start(ON, 'waiting', { blocking: 0 }), null, 'nothing else is tried');
  assert.ok(n.log.lines.includes('tray: the exe would not start: spawn EPERM'), n.log.lines.join('|'));
  assert.equal(existsSync(n.record), false);

  /* the ASYNCHRONOUS branch: the spawn returned a child and the ENOENT arrives
     on its error event, which is how node reports a missing executable */
  const late = tray({ exe });
  const born = late.t.start(ON, 'waiting', { blocking: 0 });
  born.listeners.error(Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }));
  assert.equal(late.spawn.calls.length, 1, 'a failed start starts nothing');
  assert.ok(late.log.lines.includes('tray: the exe reported spawn ENOENT'), late.log.lines.join('|'));
  assert.ok(late.log.lines.includes('tray: the exe exited with code -1 before it attached'));
  /* and the exit that follows the error is not a second one */
  born.listeners.exit(-1);
  assert.equal(late.log.lines.filter((l) => l.includes('before it attached')).length, 1);
});

/* ---- the demand seam --------------------------------------------- */

test('ensureRunning starts the exe on demand and answers true on the attach', async () => {
  const n = tray();
  /* nothing has been started at all: the toast is the first demand */
  const answer = n.t.ensureRunning(ON);
  assert.equal(n.spawn.calls.length, 1, 'the demand started it');
  assert.ok(n.spawn.calls[0].args.includes('--board'));
  n.t.attached();
  assert.equal(await answer, true);
  /* and the wait it was holding is disarmed rather than left to fire */
  assert.equal(n.timers.armed.filter((x) => x.ms === TRAY_ATTACH_WAIT_MS && !x.cleared).length, 0);

  /* a second demand while the exe is up spawns nothing new and rides the next
     attach: the exe reconnecting after a dropped stream is that call */
  const again = n.t.ensureRunning(ON);
  assert.equal(n.spawn.calls.length, 1, 'one exe, however many toasts');
  n.t.attached();
  assert.equal(await again, true);
});

test('a demand that never sees an attach answers false when the wait is up', async () => {
  const n = tray({ attachWaitMs: 40 });
  const answer = n.t.ensureRunning(ON);
  assert.equal(n.spawn.calls.length, 1);
  assert.equal(n.timers.armed.filter((x) => x.ms === 40 && !x.cleared).length, 1,
    'one wait, at the injected window');
  assert.equal(n.timers.fire(40), 1);
  assert.equal(await answer, false);
  /* and the exe is LEFT ALONE: it may be a slow starter, and killing it would
     take the icon down over a toast */
  assert.equal(n.spawn.calls[0].child.killed, false);
  assert.equal(n.t.running(), n.spawn.calls[0].child);
});

test('a demand is refused after the person chose Exit, and after enabled went false', async () => {
  const n = tray();
  const child = n.t.start(ON, 'waiting', { blocking: 0 });
  n.t.attached();
  child.listeners.exit(0);
  assert.equal(n.t.exited(), 'byPerson');
  assert.equal(await n.t.ensureRunning(ON), false, 'the decision stands until the server restarts');
  assert.equal(n.spawn.calls.length, 1, 'and no icon goes back over it');

  /* the master switch is read per demand, so a hand edit takes effect at the
     next toast with nothing to restart */
  const off = tray();
  assert.equal(await off.t.ensureRunning({ ...ON, enabled: false }), false);
  assert.equal(off.spawn.calls.length, 0);
  /* and a demand after a stop starts nothing: the server is on its way down */
  const done = tray();
  done.t.start(ON, 'waiting', { blocking: 0 });
  done.t.stop();
  assert.equal(await done.t.ensureRunning(ON), false);
  assert.equal(done.spawn.calls.length, 1);
});

test('a demand that arrives after a replacement took the port still starts one', async () => {
  /* exit 4 is the exe standing down, not a person deciding: only the menu's
     Exit blocks a later demand */
  const n = tray();
  const child = n.t.start(ON, 'waiting', { blocking: 0 });
  n.t.attached();
  child.listeners.exit(4);
  assert.equal(n.t.exited(), 'replaced');
  const answer = n.t.ensureRunning(ON);
  assert.equal(n.spawn.calls.length, 2);
  n.t.attached();
  assert.equal(await answer, true);
  assert.equal(n.t.exited(), '', 'and the attach clears the word');
});

test('a demand carries the icon switch it was handed', async () => {
  const n = tray();
  const answer = n.t.ensureRunning({ ...ON, tray: false });
  assert.ok(n.spawn.calls[0].args.includes('--no-icon'), 'a toast with the icon off still shows');
  n.t.attached();
  assert.equal(await answer, true);
});

test('a start that ends before the attach answers its demands at once', async () => {
  /* the attach a demand was waiting for can never arrive once the start it belonged
     to has ended, so holding the answer open for the rest of the window is a toast
     waiting on nothing */
  const n = tray();
  const answer = n.t.ensureRunning(ON);
  assert.equal(n.spawn.calls.length, 1, 'the demand started the exe');
  n.spawn.calls[0].child.listeners.exit(3);
  assert.equal(await answer, false, 'answered by the ending, not by the wait');
  assert.deepEqual(n.timers.armed.filter((x) => !x.cleared && !x.fired), [],
    'and the wait it was holding is cleared rather than left to run out');
});

test('a stop answers every demand that was waiting on it', async () => {
  const n = tray();
  n.t.start(ON, 'waiting', { blocking: 0 });
  const answer = n.t.ensureRunning(ON);
  n.t.stop();
  assert.equal(await answer, false, 'a server on its way down answers no, it does not hang');
});

/* ---- the open's own demand, gate by gate -------------------------- */

/* THE NOTIFICATION MASTER SWITCH IS NOT AN OPENER SWITCH: a person who
   turned toasts off did not ask to lose opening a file from a card. */
test('an open goes through with enabled false, where a toast would be refused', async () => {
  const off = { ...ON, enabled: false };
  const n = tray();
  const answer = n.t.ensureForOpen(off);
  assert.equal(n.spawn.calls.length, 1, 'the open started the exe');
  n.t.attached();
  assert.equal(await answer, true);
  /* the same settings through the toast's own seam, so the two gates are read
     against each other rather than remembered */
  const toast = tray();
  assert.equal(await toast.t.ensureRunning(off), false);
  assert.equal(toast.spawn.calls.length, 0);
});

/* A CLICK IS A DEMAND FROM THE PERSON, made a moment ago: the Exit rule exists
   so a TOAST cannot put the icon back, and this is not a toast. */
test('an open goes through after the person chose Exit, where a toast would not', async () => {
  const n = tray();
  const child = n.t.start(ON, 'waiting', { blocking: 0 });
  n.t.attached();
  child.listeners.exit(0);
  assert.equal(n.t.exited(), 'byPerson');
  assert.equal(await n.t.ensureRunning(ON), false, 'the toast is still refused');
  assert.equal(n.spawn.calls.length, 1);
  const answer = n.t.ensureForOpen(ON);
  assert.equal(n.spawn.calls.length, 2, 'the click started it again');
  n.t.attached();
  assert.equal(await answer, true);
  assert.equal(n.t.exited(), '', 'and the attach clears the word');
});

/* THE TWO GATES THAT STAY REFUSALS. There is nothing to start: no exe on disk,
   and no platform that has one. */
test('an open is refused when there is no exe and on a platform without one', async () => {
  const gone = join(tempDir('nd-tray-exe-'), 'no-such-tray.exe');
  const missing = tray({ exe: gone });
  assert.equal(missing.t.available, false);
  assert.equal(await missing.t.ensureForOpen(ON), false);
  assert.equal(missing.spawn.calls.length, 0, 'a demand cannot conjure one');

  const linux = tray({ platform: 'linux' });
  assert.equal(await linux.t.ensureForOpen(ON), false);
  assert.equal(linux.spawn.calls.length, 0);
});

test('an open is refused once the tray is stopped, and a waiting one is answered', async () => {
  const n = tray();
  n.t.start(ON, 'waiting', { blocking: 0 });
  n.t.stop();
  assert.equal(await n.t.ensureForOpen(ON), false, 'the server is on its way down');
  assert.equal(n.spawn.calls.length, 1, 'and nothing is started over it');
  /* and a demand already in flight when the stop arrives is answered rather
     than left to run out its window, exactly as the toast's is */
  const going = tray();
  going.t.start(ON, 'waiting', { blocking: 0 });
  const answer = going.t.ensureForOpen(ON);
  going.t.stop();
  assert.equal(await answer, false);
});

test('an open carries the icon switch it was handed and rides one exe', async () => {
  const n = tray();
  const answer = n.t.ensureForOpen({ ...ON, tray: false });
  assert.ok(n.spawn.calls[0].args.includes('--no-icon'), 'the exe holds the stream with no icon');
  n.t.attached();
  assert.equal(await answer, true);
  /* a second open while the exe is up starts nothing new: the demand is for a
     stream to write the frame to, and there is one */
  const again = n.t.ensureForOpen(ON);
  assert.equal(n.spawn.calls.length, 1);
  n.t.attached();
  assert.equal(await again, true);
});

/* ---- the exe as a real child, through a stub ---------------------- */

/* A stub that behaves like the exe without ever being it: this node binary
   running a two-line script under a sandbox temp dir, handed the very argv the
   module built. */
function stubExe(body) {
  const dir = tempDir('nd-tray-stub-');
  const script = join(dir, 'stub.mjs');
  writeFileSync(script, body);
  const exe = join(dir, 'stub-tray.exe');
  writeFileSync(exe, 'not a real binary\n');
  const calls = [];
  const fn = (who, args, options) => {
    calls.push({ who, args, options });
    return nodeSpawn(process.execPath, [script, ...args], options);
  };
  fn.calls = calls;
  return { dir, exe, spawn: fn };
}

/* A log that a case can WAIT on rather than sleep past: the exit lands on the
   far side of a real child's death, and this is the event that says so. */
function waitingLog(needle) {
  const lines = [];
  let seen = null;
  const ready = new Promise((resolve) => { seen = resolve; });
  const fn = (line) => {
    lines.push(line);
    if (line.includes(needle)) seen(line);
  };
  fn.lines = lines;
  fn.ready = ready;
  return fn;
}

test('a stub exe that exits 3 leaves no tray and one line, and starts nothing', async () => {
  const stub = stubExe('process.exit(3);\n');
  const log = waitingLog('before it attached');
  const n = tray({ exe: stub.exe, spawn: stub.spawn, log });
  n.t.start(ON, 'waiting', { blocking: 0 });
  await log.ready;
  assert.equal(stub.spawn.calls.length, 1, 'exactly one spawn, and nothing behind it');
  assert.ok(log.lines.includes('tray: the exe exited with code 3 before it attached'),
    log.lines.join('|'));
  assert.equal(existsSync(n.record), false);
  n.t.stop();
});

test('a stub exe that reads stdin exits on the EOF stop sends', async () => {
  const stub = stubExe('process.stdin.on("end", () => process.exit(0));\nprocess.stdin.resume();\n');
  const n = tray({ exe: stub.exe, spawn: stub.spawn });
  const child = n.t.start(ON, 'waiting', { blocking: 0 });
  n.t.attached();
  const ended = new Promise((resolve) => child.on('exit', resolve));
  n.t.stop();
  assert.equal(await ended, 0, 'stdin EOF is the clean exit that removes the icon');
  assert.equal(stub.spawn.calls.length, 1, 'a stop is not a failure: nothing started again');
  assert.equal(existsSync(n.record), false);
});

/* ---- the menu's two links ---------------------------------------- */

test('each menu URL rides its own flag, in front of --no-icon and --log', () => {
  /* both absent is a valid argv, and the exe reads an absent flag as "omit that
     line"; --lab is never sent */
  const bare = nativeArgs({ settings: undefined, notify: undefined, addPc: undefined });
  for (const flag of ['--settings', '--lab', '--notify', '--add-pc']) assert.ok(!bare.includes(flag), flag);
  assert.equal(bare.length, 14, 'the seven pairs the contract pinned and nothing else');

  /* one without the other, in both directions */
  assert.deepEqual(nativeArgs({ notify: undefined, addPc: undefined }).slice(-2),
    ['--settings', SETTINGS_URL]);
  assert.deepEqual(nativeArgs({ settings: undefined, addPc: undefined }).slice(-2),
    ['--notify', NOTIFY_URL]);
  assert.deepEqual(nativeArgs().slice(-6),
    ['--settings', SETTINGS_URL, '--notify', NOTIFY_URL, '--add-pc', ADD_PC_URL]);

  /* THE TAIL THE OTHER TWO FLAGS ALREADY OWN IS UNTOUCHED: --no-icon and --log
     stay last, in that order, with the two URLs in front of them */
  assert.deepEqual(nativeArgs({ icon: false, log: 'C:/tmp/tray.log' }).slice(-9), [
    '--settings', SETTINGS_URL, '--notify', NOTIFY_URL, '--add-pc', ADD_PC_URL,
    '--no-icon', '--log', 'C:/tmp/tray.log',
  ]);

  /* an empty string is an absent flag, not a flag with an empty value: a URL
     the server could not build must never reach url::parse as '' */
  assert.ok(!nativeArgs({ settings: '' }).includes('--settings'));
  assert.ok(!nativeArgs({ notify: '' }).includes('--notify'));
  assert.ok(!nativeArgs({ addPc: '' }).includes('--add-pc'));
});

/* THE ABSOLUTE FORM IS THE ONE THE EXE CAN TAKE: parse_args puts every URL
   through url::parse and a relative path is exit 2. The exe builds no URL of
   its own, so the server hands both over whole. */
test('the URLs the tray is handed are absolute loopback URLs', () => {
  const n = tray();
  n.t.start(ON, 'waiting', { blocking: 0 });
  const args = n.spawn.calls[0].args;
  const at = (flag) => args[args.indexOf(flag) + 1];
  assert.ok(!args.includes('--lab'), 'the lab page is gone (T-303)');
  for (const flag of ['--settings', '--notify', '--add-pc']) {
    const url = at(flag);
    assert.ok(url.startsWith('http://127.0.0.1:'), flag + ': ' + url);
    assert.ok(!url.includes('askerdo.localhost'), flag);
    assert.doesNotThrow(() => new URL(url), flag);
  }
  assert.equal(at('--settings'), BASE + 'notifications');
  assert.equal(at('--add-pc'), ADD_PC_URL);
  /* THE PAUSE IS POSTED TO THE API ROUTE, never to the page the link opens: a
     POST to `<secret>/notifications` is a 404 (measured 2026-09-09), because
     the route table gates the method */
  assert.equal(at('--notify'), BASE + 'api/notify');
  assert.notEqual(at('--notify'), at('--settings'));
});

/* Pinned against the SERVER'S SOURCE rather than by starting a board server
   just to read one route. */
test('the menu link resolves to a route the server serves', () => {
  const server = readFileSync(join(pluginRoot, 'hooks', 'board-server.mjs'), 'utf8');
  for (const [flag, tail] of [['--settings', 'notifications'], ['--add-pc', 'add-pc']]) {
    /* the route table's own line decides whether the URL answers at all */
    const routed = "rest === '" + tail + "'";
    assert.ok(server.includes(routed), flag + ' names no route: ' + routed);
  }
  /* and the tray builds exactly that tail onto its own base */
  assert.equal(SETTINGS_URL, BASE + 'notifications');
  /* the base itself is the board URL the contract pins, trailing slash and all,
     which is what makes `base + tail` the same address the href resolves to */
  assert.equal(nativeArgs()[1], BASE);
  assert.ok(BASE.endsWith('/'));
});

/* THE SUBMENU ENTRY NAMES THE HOUR IT RESOLVES TO, and the hour is the
   SERVER'S: the exe holds no clock, so the entry and the label the server
   writes live in two languages and this keeps them one string. */
test('the pause submenu entry names the hour the server resolves tomorrow to', () => {
  const rust = readFileSync(join(pluginRoot, 'tray', 'src', 'tray.rs'), 'utf8');
  /* what the server would write for a `tomorrow` posted at any hour of the day */
  for (const at of ['2026-09-09T23:50:00', '2026-09-09T06:00:00', '2026-09-30T13:00:00']) {
    const now = new Date(at);
    const label = pauseLabel(now, pauseUntil(now, 'tomorrow'));
    assert.equal(label, 'until 07:00 tomorrow', at);
  }
  assert.ok(rust.includes('menu_label("Until 07:00 tomorrow")'),
    'the crate entry names the same hour the server resolves to');
  assert.ok(!rust.includes('menu_label("Until tomorrow")'),
    'and the older wording that named no hour is gone');
});
