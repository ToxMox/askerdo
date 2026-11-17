/* scripts/run-tests.mjs: the process is the subject, so it is spawned.
   A test that writes into HOME fails a green run, and a red run exits with its own status. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { childEnv, tempDir } from './helpers/sandbox.mjs';
import { appEngine, drawPluginReport, fileFault, takeTurn } from '../scripts/run-tests.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'run-tests.mjs');
/* the board and data-dir variables a spawned CLI would honour over the throwaway home */
const OUTSIDE = { ASKERDO_BOARD_URL: 'http://127.0.0.1:9', ASKERDO_BOARD_TOKEN: 'x', CLAUDE_PLUGIN_DATA: 'askerdo-elsewhere' };
const runOn = (file) => spawnSync(process.execPath, [SCRIPT, file], { encoding: 'utf8', env: childEnv(OUTSIDE), windowsHide: true });
const homeOf = (out) => (out.match(/run-tests: home (.+)/) || [])[1]?.trim();
const logOf = (out) => (out.match(/run-tests: log (.+)/) || [])[1]?.trim() || join(tmpdir(), 'no-log');

test('a leftover in the throwaway home fails a passing run, and a failing run keeps its own exit status', (t) => {
  const dir = tempDir('askerdo-run-tests-', t);
  const leaves = join(dir, 'leaves.test.mjs');
  writeFileSync(leaves, "import { test } from 'node:test';\nimport { writeFileSync } from 'node:fs';\nimport { join } from 'node:path';\n"
    + "const seen = " + JSON.stringify(Object.keys(OUTSIDE)) + ".filter((k) => process.env[k] !== undefined);\n"
    + "test('writes home', () => writeFileSync(join(process.env.HOME, seen.length ? 'leaked-' + seen.join('-') : 'stray.txt'), 'x'));\n");
  const fails = join(dir, 'fails.test.mjs');
  writeFileSync(fails, "import { test } from 'node:test';\ntest('quiet-green-case', () => {});\n"
    + "test('loud-red-case', () => { throw new Error('red-mark'); });\n");

  const left = runOn(leaves);
  t.after(() => rmSync(logOf(left.stdout), { force: true }));
  assert.notEqual(left.status, 0, left.stdout);
  assert.match(left.stdout, /stray\.txt/, 'the board and data-dir variables stay out of the child');
  assert.ok(homeOf(left.stdout) && !existsSync(homeOf(left.stdout)), 'the throwaway home is removed');

  const red = runOn(fails);
  assert.equal(red.status, 1, red.stdout);
  assert.doesNotMatch(red.stdout, /proc ran/);
  /* the console names the failure with its message and the counts; a passing test is only in the log */
  assert.ok(['loud-red-case', 'red-mark', '1 pass', '1 fail'].every((w) => red.stdout.includes(w)), red.stdout);
  assert.doesNotMatch(red.stdout, /quiet-green-case/);
  t.after(() => rmSync(logOf(red.stdout), { force: true }));
  assert.match(readFileSync(logOf(red.stdout), 'utf8'), /quiet-green-case/);

  /* a plugin file run refuses a file that is no plugin test before it takes a turn or makes a home */
  const missing = join(dir, 'gone.test.tsx');
  const refused = spawnSync(process.execPath, [SCRIPT, '--plugin', fails, missing], { encoding: 'utf8', env: childEnv(OUTSIDE), windowsHide: true });
  assert.equal(refused.status, 2, refused.stdout);
  assert.ok(refused.stdout.includes('fails.test.mjs') && refused.stdout.includes('gone.test.tsx'), refused.stdout);
  assert.ok(!homeOf(refused.stdout) && !/waiting/.test(refused.stdout), refused.stdout);
});

/* the PC's queue: a plugin run started beside a node run waits for it */
test('a plugin run waits for a live run queued before it; a dead runner\'s turn is dropped; a full node run waits for a full one, a node run naming files for none but a plugin run', async (t) => {
  const dir = tempDir('askerdo-run-tests-', t);
  const before = Date.now() - 1000;
  const dead = spawnSync(process.execPath, ['-e', '']).pid;
  const live = join(dir, before + '-' + process.pid + '-node');
  writeFileSync(live, JSON.stringify({ full: true }));
  writeFileSync(join(dir, before + '-' + dead + '-plugin'), '{}');

  (await takeTurn('node', { dir, pollMs: 10 }))();
  assert.deepEqual(readdirSync(dir), [basename(live)], 'the dead plugin turn is gone and the node turn did not wait');

  const queue = (kind, opts) => {
    const q = { told: [], done: false };
    q.turn = takeTurn(kind, { dir, pollMs: 10, ...opts, onWait: (ahead) => q.told.push(ahead.map((a) => a.pid)) }).then((r) => { q.done = true; return r; });
    return q;
  };
  /* the parent's pid stands for a second live runner */
  const full = queue('node', { full: true, pid: process.ppid });
  await new Promise((ok) => setTimeout(ok, 150));
  assert.deepEqual([full.done, full.told], [false, [[process.pid]]], 'the full node run waits for the live full one');
  const plugin = queue('plugin');
  await new Promise((ok) => setTimeout(ok, 150));
  assert.deepEqual([plugin.done, plugin.told], [false, [[process.pid, process.ppid]]], 'the plugin run waits for both node runs');
  rmSync(live);
  (await full.turn)();
  (await plugin.turn)();
  assert.deepEqual(readdirSync(dir), []);

  /* a plugin run naming files holds the plugin turn: a node run naming files waits for it */
  const files = await takeTurn('plugin', { dir, pollMs: 10 });
  const look = queue('node', { pid: process.ppid });
  await new Promise((ok) => setTimeout(ok, 150));
  assert.deepEqual([look.done, look.told], [false, [[process.pid]]], 'the node look waits for the plugin file run');
  files();
  (await look.turn)();
  assert.deepEqual(readdirSync(dir), []);
});

/* an app install that keeps its engines under Roaming, where the pick found none */
test('the plugin run takes the newest engine from either folder the app keeps engines in, and a file run reads the report of its child, failing one that ran no case', (t) => {
  const dir = tempDir('askerdo-run-tests-', t);
  const engine = (...parts) => { const d = join(dir, ...parts); mkdirSync(d, { recursive: true }); writeFileSync(join(d, 'claude.exe'), ''); return join(d, 'claude.exe'); };
  const env = { LOCALAPPDATA: join(dir, 'Local'), APPDATA: join(dir, 'Roaming') };
  assert.equal(appEngine(env), null);
  const roaming = engine('Roaming', 'Claude', 'claude-code', '2.1.9', 'b1');
  assert.deepEqual(appEngine(env), { version: '2.1.9', exe: roaming });
  const local = engine('Local', 'Claude-Data', 'p1', 'claude-code', '2.1.10', 'b2');
  assert.deepEqual(appEngine(env), { version: '2.1.10', exe: local });

  /* a file run reads the engine child's report line; output with none counts as no report */
  const line = 'claude-plugin-test-report ' + JSON.stringify({ file: 'x.test.tsx', results: [
    { title: 'green-case', ms: 12, failure: null }, { title: 'red-case', ms: 5000, failure: { message: 'red-mark' } }] });
  const nl = String.fromCharCode(10);
  const d = drawPluginReport(['noise', line, ''].join(nl));
  assert.deepEqual([d.pass, d.fail, d.reports], [1, 1, 1]);
  assert.ok(d.lines.some((l) => l.includes('red-case')) && d.lines.some((l) => l.includes('red-mark')), d.lines.join(nl));
  assert.equal(drawPluginReport('(pass) looks green' + nl).reports, 0);
  /* a file whose report holds no case fails, as one with no report does */
  const none = drawPluginReport('claude-plugin-test-report ' + JSON.stringify({ file: 'x.test.tsx', results: [] }) + nl);
  assert.deepEqual([none.reports, /ran no case/.test(fileFault(none, 'x.test.tsx')), !!fileFault(drawPluginReport(''), 'x'), fileFault(d, 'x')], [1, true, true, '']);
});
