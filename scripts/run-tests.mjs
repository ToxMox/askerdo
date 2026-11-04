/* the run-tests procedure in one step. Runs node --test (or the plugin
 * tests) with the store seams unset and HOME at a fresh throwaway folder, then
 * fails the run when the tests left anything in that home.
 *
 * Usage: node scripts/run-tests.mjs [test files...]
 *        node scripts/run-tests.mjs --plugin
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/* the suite's own seams (test/helpers/sandbox.mjs SEAM_VARS), the board and data dir a
   spawned CLI honours over the throwaway home, and the nested runner's context, which
   turns a child node --test into a silent subtest stream */
const DROP = ['ASKERDO_ROOT', 'ASKERDO_SANDBOX_HOME', 'ASKERDO_MOD', 'CLAUDE_CODE_SESSION_ID',
  'ASKERDO_BOARD_URL', 'ASKERDO_BOARD_TOKEN', 'CLAUDE_PLUGIN_DATA', 'CLAUDE_CONFIG_DIR', 'NODE_TEST_CONTEXT'];
/* claude.exe writes its own state file into HOME on every run */
const PLUGIN_LEAVES = ['.claude.json'];

const say = (s) => process.stdout.write('run-tests: ' + s + '\n');

const vparts = (v) => v.split('.').map((n) => parseInt(n, 10) || 0);
const vcmp = (a, b) => {
  const x = vparts(a), y = vparts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  return 0;
};
const dirs = (p) => { try { return readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return []; } };

/* The desktop app's newest engine: %LOCALAPPDATA%/Claude-Data/<profile>/claude-code/<version>/<build>/claude.exe. */
function appEngine(local = process.env.LOCALAPPDATA) {
  if (!local) return null;
  const base = join(local, 'Claude-Data');
  let best = null;
  for (const profile of dirs(base)) {
    const cc = join(base, profile, 'claude-code');
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
  if (!app) return { why: 'no desktop app engine under %LOCALAPPDATA%/Claude-Data/<profile>/claude-code/' };
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

function run(cmd, args, env, shell) {
  return new Promise((done) => {
    let out = '';
    const child = spawn(cmd, args, { cwd: REPO, env, shell, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (b) => { out += b; process.stdout.write(b); });
    child.stderr.on('data', (b) => { out += b; process.stderr.write(b); });
    child.on('error', (e) => { out += String(e.message || e); done({ code: 1, out }); });
    child.on('close', (code, signal) => done({ code: code ?? (signal ? 1 : 0), out }));
  });
}

async function main(argv) {
  const plugin = argv.includes('--plugin');
  const files = argv.filter((a) => a !== '--plugin');
  if (plugin && files.length) { say('--plugin runs the whole plugin set and takes no files'); return 2; }
  let engine = null;
  if (plugin) {
    engine = pickEngine();
    if (engine.why) { say('no engine: ' + engine.why); return 2; }
  }

  const home = mkdtempSync(join(resolve(tmpdir()), 'askerdo-test-home-'));
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  for (const k of DROP) delete env[k];
  say('home ' + home);

  let r;
  if (plugin) {
    say('engine ' + engine.label);
    r = await run(engine.exe, ['plugin', 'test', '.'], env, engine.shell);
  } else {
    r = await run(process.execPath, ['--test', '--test-reporter=spec', ...files.map((f) => resolve(f))], env, false);
  }

  const allowed = plugin ? PLUGIN_LEAVES : [];
  const left = readdirSync(home).filter((n) => !allowed.includes(n));
  rmSync(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  if (existsSync(home)) say('could not remove ' + home + ': remove it by hand');

  const c = counts(r.out);
  say((plugin ? 'plugin tests' : 'node tests') + ': ' + (c.pass ?? '?') + ' pass, ' + (c.fail ?? '?') + ' fail, exit ' + r.code);
  if (left.length) say('the tests left files in the throwaway home: ' + left.join(', '));
  if (r.code === 0 && !left.length) say('to record the run: askerdo proc ran run-tests clean');
  return r.code !== 0 ? r.code : left.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; },
    (e) => { say(String((e && e.stack) || e)); process.exitCode = 1; });
}
