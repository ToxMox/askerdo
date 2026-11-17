/* the run-tests procedure in one step. Runs node --test (or the plugin
 * tests) with the store seams unset and HOME at a fresh throwaway folder, then
 * fails the run when the tests left anything in that home. The full output goes
 * to a log file; the console gets each failing test and the counts.
 *
 * Usage: node scripts/run-tests.mjs [--verbose] [test files...]
 *        node scripts/run-tests.mjs [--verbose] --plugin [plugin test files...]
 */
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/* the suite's own seams (test/helpers/sandbox.mjs SEAM_VARS), the board and data dir a
   spawned CLI honours over the throwaway home, and the nested runner's context, which
   turns a child node --test into a silent subtest stream */
const DROP = ['ASKERDO_ROOT', 'ASKERDO_SANDBOX_HOME', 'ASKERDO_MOD', 'CLAUDE_CODE_SESSION_ID',
  'ASKERDO_BOARD_URL', 'ASKERDO_BOARD_TOKEN', 'CLAUDE_PLUGIN_DATA', 'CLAUDE_CONFIG_DIR', 'NODE_TEST_CONTEXT'];
/* claude.exe writes its own state file into HOME on every run */
const PLUGIN_LEAVES = ['.claude.json'];
const LOGS = join(resolve(tmpdir()), 'askerdo-test-logs');
const LOG_DAYS = 7;
/* the lines of one failure's message and of its stack the console shows */
const MESSAGE_LINES = 20;
const STACK_LINES = 3;
/* the PC's queue of runs, shared by every checkout; a runner sets TURN_ENV for its
   child, so a runner a test spawns runs inside its parent's turn */
const TURNS = join(resolve(tmpdir()), 'askerdo-test-turns');
const TURN_ENV = 'ASKERDO_RUN_TESTS_TURN';
const BEAT_MS = 10000;
const STALE_MS = 60000;

const say = (s) => process.stdout.write('run-tests: ' + s + '\n');
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

/* A plugin run waits for every run queued before it, a node run for the plugin
   runs before it, and a full node run for the full node runs before it: the plugin
   set's 5 s limit per test fails on a CPU the node suite loads, and two full node
   suites push each other's server and git children past their limits. A node run naming
   files passes node runs; a plugin run naming files is a plugin run, its cases on the
   same 5 s limit. A file whose pid is gone or whose beat stopped (a killed runner) is
   dropped, the beat covering a pid Windows has handed to another process. */
export async function takeTurn(kind, { full = false, dir = TURNS, pid = process.pid, cwd = REPO, pollMs = 500, onWait = () => {} } = {}) {
  mkdirSync(dir, { recursive: true });
  const at = Date.now();
  const mine = at + '-' + pid + '-' + kind;
  const file = join(dir, mine);
  writeFileSync(file, JSON.stringify({ pid, kind, cwd, full }));
  const beat = setInterval(() => { try { const now = new Date(); utimesSync(file, now, now); } catch { /* released */ } }, BEAT_MS);
  beat.unref();
  const release = () => { clearInterval(beat); rmSync(file, { force: true }); };
  let told = '';
  for (;;) {
    const ahead = [];
    for (const name of readdirSync(dir)) {
      const m = /^(\d+)-(\d+)-(node|plugin)$/.exec(name);
      if (!m || name === mine) continue;
      const t = Number(m[1]), p = Number(m[2]), k = m[3];
      if (t > at || (t === at && p > pid) || (kind === 'node' && k === 'node' && !full)) continue;
      const path = join(dir, name);
      let st, info = {};
      try { st = statSync(path); info = JSON.parse(readFileSync(path, 'utf8')); } catch { continue; }
      if (!alive(p) || Date.now() - st.mtimeMs > STALE_MS) { rmSync(path, { force: true }); continue; }
      if (kind === 'node' && k === 'node' && !info.full) continue;
      ahead.push({ pid: p, kind: k, full: !!info.full, cwd: info.cwd || '', since: t });
    }
    if (!ahead.length) return release;
    const key = ahead.map((a) => a.pid).join(',');
    if (key !== told) { told = key; onWait(ahead); }
    await sleep(pollMs);
  }
}

const vparts = (v) => v.split('.').map((n) => parseInt(n, 10) || 0);
const vcmp = (a, b) => {
  const x = vparts(a), y = vparts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  return 0;
};
const dirs = (p) => { try { return readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return []; } };

/* The folders the desktop app keeps its engines in: one per profile under
   %LOCALAPPDATA%/Claude-Data, or %APPDATA%/Claude on a PC whose app keeps its data there. */
export function engineHomes(env = process.env) {
  const homes = [];
  const data = env.LOCALAPPDATA ? join(env.LOCALAPPDATA, 'Claude-Data') : null;
  if (data) for (const profile of dirs(data)) homes.push(join(data, profile, 'claude-code'));
  if (env.APPDATA) homes.push(join(env.APPDATA, 'Claude', 'claude-code'));
  return homes;
}

/* The desktop app's newest engine: <engine home>/<version>/<build>/claude.exe. */
export function appEngine(env = process.env) {
  let best = null;
  for (const cc of engineHomes(env)) {
    for (const version of dirs(cc).filter((v) => /^\d+(\.\d+)*$/.test(v))) {
      if (best && vcmp(version, best.version) <= 0) continue;
      const exes = dirs(join(cc, version)).map((b) => join(cc, version, b, 'claude.exe')).filter((p) => existsSync(p));
      exes.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
      best = { version, exe: exes[0] || null };
    }
  }
  return best;
}

function pickEngine() {
  const app = appEngine();
  if (!app) return { why: 'no desktop app engine under %LOCALAPPDATA%/Claude-Data/<profile>/claude-code/ or %APPDATA%/Claude/claude-code/' };
  if (app.exe) return { exe: app.exe, label: "the desktop app's claude.exe " + app.version + ' (' + app.exe + ')' };
  const r = spawnSync('claude', ['--version'], { encoding: 'utf8', windowsHide: true, shell: process.platform === 'win32' });
  const got = ((r.stdout || '').match(/\d+\.\d+\.\d+/) || [])[0];
  if (got === app.version) return { exe: 'claude', shell: process.platform === 'win32', label: 'claude on PATH ' + got + ', the same version as the app\'s newest folder' };
  return { why: "the app's newest folder " + app.version + ' holds no claude.exe, and claude on PATH is ' + (got || 'absent') };
}

/* The last pass and fail counts in the output: node's spec summary or a bun-style footer. */
function counts(out) {
  const text = out.replace(/\x1b\[[0-9;]*m/g, '');
  const last = (re) => { let m, v = null; while ((m = re.exec(text))) v = parseInt(m[1], 10); return v; };
  return {
    pass: last(/^\D{0,3}pass (\d+)\s*$/gm) ?? last(/^\s*(\d+) pass(?:ed)?\b/gim),
    fail: last(/^\D{0,3}fail (\d+)\s*$/gm) ?? last(/^\s*(\d+) fail(?:ed)?\b/gim),
  };
}

/* node --test loads this module as its second reporter: one JSON line per failed
   test, with the names above it, so the runner can print failures alone. */
export default async function* failures(source) {
  const paths = new Map();
  /* a file that dies before its tests run fails with no cause: its stderr says why */
  const stderr = new Map();
  for await (const { type, data } of source) {
    if (type === 'test:start') {
      const path = paths.get(data.file) || [];
      path.length = data.nesting;
      path.push(data.name);
      paths.set(data.file, path);
    }
    const key = data && data.file ? resolve(data.file) : '';
    if (type === 'test:stderr') stderr.set(key, ((stderr.get(key) || '') + data.message).slice(0, 8192));
    if (type !== 'test:fail' || data.todo || data.skip) continue;
    const err = data.details && data.details.error;
    if (err && err.failureType === 'subtestsFailed') continue;
    const cause = (err && err.cause) || err || {};
    const above = (paths.get(data.file) || []).slice(0, data.nesting);
    const message = String(cause.message ?? cause) + (!cause.stack && stderr.get(key) ? '\n' + stderr.get(key) : '');
    yield JSON.stringify({
      name: [...above, data.name].join(' > '), file: data.file, line: data.line, message, stack: String(cause.stack || ''),
    }) + '\n';
  }
}

const relFile = (f) => {
  if (!f) return '';
  const p = f.startsWith('file:') ? fileURLToPath(f) : f;
  const r = relative(REPO, p);
  return (r && !r.startsWith('..') ? r : p).replace(/\\/g, '/');
};
const inner = (l) => /^\s+at /.test(l) && /node:|\(<anonymous>\)/.test(l);
const head = (text, n) => text.split(/\r?\n/).filter((l) => l.trim() && !inner(l)).slice(0, n);

function nodeFailures(file) {
  let text = '';
  try { text = readFileSync(file, 'utf8'); } catch { return []; }
  return text.split('\n').filter(Boolean).map((l) => {
    try {
      const f = JSON.parse(l);
      const at = f.stack.split(/\r?\n/).filter((s) => /^\s+at /.test(s) && !inner(s)).slice(0, STACK_LINES).map((s) => s.trim());
      return { title: relFile(f.file) + (f.line ? ':' + f.line : '') + ' ' + f.name, body: [...head(f.message, MESSAGE_LINES), ...at] };
    } catch { return null; }
  }).filter(Boolean);
}

/* claude plugin test prints "<file>:" over each file's "(pass)" and "(fail)" lines,
   and indents a failure's error under its line */
function pluginFailures(out) {
  const found = [];
  let file = '', cur = null;
  for (const line of out.replace(/\x1b\[[0-9;]*m/g, '').split(/\r?\n/)) {
    const m = /^(\S.*\.test\.tsx?):\s*$/.exec(line);
    if (m) { file = m[1].replace(/\\/g, '/'); cur = null; continue; }
    const f = /^\(fail\) (.*?)(?: \[[\d.]+m?s\])?\s*$/.exec(line);
    if (f) { cur = { title: file + ' ' + f[1], body: [] }; found.push(cur); continue; }
    if (cur && /^\s{2}/.test(line)) { if (line.trim() && cur.body.length < MESSAGE_LINES) cur.body.push(line.trim()); continue; }
    cur = null;
  }
  return found;
}

function pruneLogs() {
  const old = Date.now() - LOG_DAYS * 24 * 3600 * 1000;
  let names = [];
  try { names = readdirSync(LOGS); } catch { return; }
  for (const n of names) {
    try { if (statSync(join(LOGS, n)).mtimeMs < old) rmSync(join(LOGS, n), { force: true }); } catch { /* another run holds it */ }
  }
}

function run(cmd, args, env, shell, log, verbose) {
  return new Promise((done) => {
    let out = '';
    const keep = (b, to) => { out += b; log.write(b); if (verbose) to.write(b); };
    const child = spawn(cmd, args, { cwd: REPO, env, shell, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (b) => keep(b, process.stdout));
    child.stderr.on('data', (b) => keep(b, process.stderr));
    child.on('error', (e) => { keep(String(e.message || e) + '\n', process.stderr); done({ code: 1, out }); });
    child.on('close', (code, signal) => done({ code: code ?? (signal ? 1 : 0), out }));
  });
}

/* The named files that are not plugin test files: missing, outside the repo, or not *.test.ts(x). */
export function notPluginFiles(files, repo = REPO) {
  return files.filter((f) => {
    const p = resolve(f), r = relative(repo, p);
    if (!r || r.startsWith('..') || resolve(repo, r) !== p || !/\.test\.tsx?$/.test(p)) return true;
    try { return !statSync(p).isFile(); } catch { return true; }
  });
}

const REPORT = 'claude-plugin-test-report ';

/* A child's report line (the engine's child to parent protocol) drawn as the parent
   draws a file: "(pass) title [ms]" and "(fail) title [ms]" with the error indented. */
export function drawPluginReport(text) {
  const lines = [];
  let pass = 0, fail = 0, reports = 0;
  for (const l of text.replace(/\x1b\[[0-9;]*m/g, '').split(/\r?\n/)) {
    if (!l.startsWith(REPORT)) continue;
    let rep;
    try { rep = JSON.parse(l.slice(REPORT.length)); } catch { continue; }
    reports++;
    for (const c of rep.results || []) {
      const ms = typeof c.ms === 'number' ? ' [' + c.ms.toFixed(2) + 'ms]' : '';
      lines.push((c.failure == null ? '(pass) ' : '(fail) ') + c.title + ms);
      if (c.failure == null) { pass++; continue; }
      fail++;
      const f = c.failure;
      const msg = typeof f === 'string' ? f : [f.message ?? JSON.stringify(f), f.stack || ''].join('\n');
      for (const m of msg.split(/\r?\n/)) if (m.trim()) lines.push('  ' + m.trim());
    }
  }
  return { lines, pass, fail, reports };
}

/* Why a named file fails whatever its cases say: no report, or a report that ran no case,
   so a file emptied, skipped or misnamed never reads as a clean run. */
export function fileFault(d, file) {
  if (!d.reports) return 'the engine reported no result for ' + file;
  if (!d.pass && !d.fail) return 'the engine ran no case in ' + file;
  return '';
}

/* A file run starts each file the way the engine's whole-set run starts its children,
   one file at a time, so no file pays a cold load beside the others. A child that
   reports no file fails the run: its protocol is the engine's, not a documented one. */
async function runPluginFiles(engine, files, env, log, verbose) {
  let code = 0, out = '', pass = 0, fail = 0;
  for (const f of files) {
    const header = relFile(resolve(f)) + ':\n';
    log.write(header);
    const r = await run(engine.exe, ['plugin', 'test', '--file', resolve(f), REPO], env, engine.shell, log, false);
    const d = drawPluginReport(r.out);
    const drawn = header + d.lines.join('\n') + '\n';
    log.write(drawn);
    if (verbose) process.stdout.write(drawn);
    out += drawn;
    pass += d.pass;
    fail += d.fail;
    const why = fileFault(d, relFile(resolve(f)));
    if (why) {
      say(why + ' (exit ' + r.code + '): read the log');
      code = code || 1;
    }
    if (!code && (r.code !== 0 || d.fail)) code = r.code || 1;
  }
  return { code, out: out + '\n ' + pass + ' pass\n ' + fail + ' fail\n' };
}

async function main(argv) {
  const plugin = argv.includes('--plugin');
  const verbose = argv.includes('--verbose');
  const files = argv.filter((a) => a !== '--plugin' && a !== '--verbose');
  if (plugin && files.length) {
    const bad = notPluginFiles(files);
    if (bad.length) { say('--plugin takes only plugin test files (*.test.ts or *.test.tsx in this repo): ' + bad.join(', ')); return 2; }
  }
  let engine = null;
  if (plugin) {
    engine = pickEngine();
    if (engine.why) { say('no engine: ' + engine.why); return 2; }
  }

  let release = () => {};
  if (!process.env[TURN_ENV]) {
    const began = Date.now();
    let waited = false;
    release = await takeTurn(plugin ? 'plugin' : 'node', {
      full: !files.length,
      onWait: (ahead) => {
        waited = true;
        const why = !plugin && ahead.every((a) => a.kind === 'node')
          ? "two full node runs at once push each other's server and git children past their limits"
          : 'the plugin tests time out on a CPU the node tests load';
        say('waiting for ' + ahead.map((a) => 'the ' + (a.full ? 'full ' : '') + a.kind + ' run of pid ' + a.pid + (a.cwd ? ' in ' + a.cwd : '')).join(', ')
          + ' to end, since ' + why + (plugin ? '' : '; a node run naming test files waits for no node run'));
      },
    });
    if (waited) say('waited ' + Math.round((Date.now() - began) / 1000) + ' s');
    process.once('exit', release);
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(sig, () => { release(); process.exit(130); });
  }

  const home = mkdtempSync(join(resolve(tmpdir()), 'askerdo-test-home-'));
  const env = { ...process.env, HOME: home, USERPROFILE: home, [TURN_ENV]: String(process.pid) };
  for (const k of DROP) delete env[k];
  say('home ' + home);
  mkdirSync(LOGS, { recursive: true });
  pruneLogs();
  const d = new Date(), two = (n) => String(n).padStart(2, '0');
  const stamp = d.getFullYear() + two(d.getMonth() + 1) + two(d.getDate()) + '-' + two(d.getHours()) + two(d.getMinutes()) + two(d.getSeconds());
  const logFile = join(LOGS, (plugin ? 'plugin-' : 'node-') + stamp + '-' + process.pid + '.log');
  const failFile = logFile.replace(/\.log$/, '.fails');
  const log = createWriteStream(logFile);
  say('log ' + logFile);

  let r;
  if (plugin) {
    say('engine ' + engine.label);
    say(files.length ? 'plugin files ' + files.map((f) => relFile(resolve(f))).join(', ') : 'the whole plugin set');
    r = files.length ? await runPluginFiles(engine, files, env, log, verbose)
      : await run(engine.exe, ['plugin', 'test', '.'], env, engine.shell, log, verbose);
  } else {
    r = await run(process.execPath, ['--test', '--test-reporter=spec', '--test-reporter-destination=stdout',
      '--test-reporter=' + import.meta.url, '--test-reporter-destination=' + failFile,
      ...files.map((f) => resolve(f))], env, false, log, verbose);
  }
  release();
  await new Promise((ok) => log.end(ok));

  const allowed = plugin ? PLUGIN_LEAVES : [];
  const left = readdirSync(home).filter((n) => !allowed.includes(n));
  rmSync(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  if (existsSync(home)) say('could not remove ' + home + ': remove it by hand');

  const failed = plugin ? pluginFailures(r.out) : nodeFailures(failFile);
  rmSync(failFile, { force: true });
  for (const f of failed) {
    say('fail ' + f.title);
    for (const l of f.body) process.stdout.write('    ' + l + '\n');
  }
  const c = counts(r.out);
  say((plugin ? 'plugin tests' : 'node tests') + ': ' + (c.pass ?? '?') + ' pass, ' + (c.fail ?? '?') + ' fail, exit ' + r.code);
  if (r.code !== 0 && !failed.length) say('the run failed with no failing test named: read the log');
  if (left.length) say('the tests left files in the throwaway home: ' + left.join(', '));
  if (r.code === 0 && !left.length) say('to record the run: askerdo proc ran run-tests clean');
  return r.code !== 0 ? r.code : left.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; },
    (e) => { say(String((e && e.stack) || e)); process.exitCode = 1; });
}
