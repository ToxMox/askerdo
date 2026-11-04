/* The sync's sandbox seam: a session started with ASKERDO_ROOT or
 * ASKERDO_SANDBOX_HOME set writes its output style, settings, data dir and
 * launchers under the sandbox and not one byte under the home it was handed. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { pluginRoot } from '../lib/node-helpers.mjs';
import { childEnv, tempDir } from './helpers/sandbox.mjs';

const syncScript = join(pluginRoot, 'hooks', 'sync.mjs');
const STYLE = join('.claude', 'output-styles', 'askerdo.md');
const DATA = join('.claude', 'plugins', 'data', 'askerdo-askerdo');
const STALE_LAUNCHER = '/* AskerDo launcher, maintained by the AskerDo sync; edits are overwritten */\n'
  + 'await import("file:///C:/nowhere/bin/askerdo.mjs");\n';

/* A fake home with every file the sync would touch at the real one: a stale
   style, a settings file that selects nothing, a hub config, and the store
   root holding a launcher that points nowhere. */
function fakeHome() {
  const home = tempDir('ttd-sbx-home-');
  const put = (rel, text) => {
    mkdirSync(join(home, rel, '..'), { recursive: true });
    writeFileSync(join(home, rel), text);
  };
  put(join(DATA, 'config.json'), JSON.stringify({ name: 'Probe', queue: 'hub' }));
  put(STYLE, 'stale style\n');
  put(join('.claude', 'settings.json'), '{ "theme": "dark" }\n');
  put(join('.claude', 'askerdo', 'cli.mjs'), STALE_LAUNCHER);
  return home;
}

/* Every file and directory under a tree, with its bytes and mtime: equal
   snapshots mean nothing was created, removed, or written. */
function snapshot(dir) {
  const out = {};
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      const st = statSync(p);
      const rel = relative(dir, p);
      if (st.isDirectory()) { out[rel + '/'] = st.mtimeMs; walk(p); } else out[rel] = readFileSync(p, 'utf8') + '@' + st.mtimeMs;
    }
  };
  walk(dir);
  return out;
}

/* The runner's own seam variables are stripped first, so the case decides them. */
function runSync(home, extra, flags = [], input) {
  const env = { ...childEnv() };
  for (const k of ['ASKERDO_ROOT', 'ASKERDO_SANDBOX_HOME', 'ASKERDO_NO_BOARD']) delete env[k];
  return execFileSync(process.execPath, [syncScript, ...flags], {
    env: {
      ...env, HOME: home, USERPROFILE: home,
      /* the harness hands a session the REAL data dir; the seam must not trust it */
      CLAUDE_PLUGIN_DATA: join(home, DATA),
      /* never a real scheduler, even if the ensure were reached */
      ASKERDO_SCHTASKS: join(home, 'no-such-scheduler.exe'),
      ASKERDO_SID: 'S-1-5-21-4242-4242-4242-1001',
      ...extra,
    },
    encoding: 'utf8',
    input: JSON.stringify(input || { session_id: 'sess-sbx', cwd: 'C:/repos/proj-a', source: 'startup' }),
  });
}

test('THE SANDBOX SEAM: with ASKERDO_ROOT set the home gets no writes and the sandbox gets them all', () => {
  const home = fakeHome();
  const before = snapshot(home);
  const sandbox = tempDir('ttd-sbx-seam-');
  const rig = join(sandbox, 'askerdo');
  mkdirSync(rig);
  /* a clone of the live store holds a launcher another (newer) copy owns; the sandbox's root is still ours */
  const other = join(sandbox, 'live-copy');
  mkdirSync(join(other, 'bin'), { recursive: true });
  mkdirSync(join(other, '.claude-plugin'));
  writeFileSync(join(other, 'bin', 'askerdo.mjs'), '');
  writeFileSync(join(other, '.claude-plugin', 'plugin.json'), JSON.stringify({ version: '99.0.0' }));
  writeFileSync(join(rig, 'cli.mjs'), '/* AskerDo launcher, maintained by the AskerDo sync; edits are overwritten */\n'
    + 'await import(' + JSON.stringify(pathToFileURL(join(other, 'bin', 'askerdo.mjs')).href) + ');\n');
  const sbxHome = join(sandbox, 'askerdo-home');

  const out = runSync(home, { ASKERDO_ROOT: rig });
  runSync(home, { ASKERDO_ROOT: rig }, ['--install']);

  assert.deepEqual(snapshot(home), before, 'the handed home was not written');
  assert.ok(out.includes('output style regenerated'), out);
  /* no nag that the sandbox's own empty settings do not select the style */
  assert.ok(!out.includes('does not select it'), out);
  const style = readFileSync(join(sbxHome, STYLE), 'utf8');
  assert.ok(style.includes('--names-line'), 'the style was built from the saved config (queue hub), read only');
  assert.equal(JSON.parse(readFileSync(join(sbxHome, '.claude', 'settings.json'), 'utf8')).outputStyle,
    'askerdo', '--install selects the style in the sandbox settings');
  const launcher = readFileSync(join(rig, 'cli.mjs'), 'utf8');
  assert.ok(launcher.includes(pathToFileURL(join(pluginRoot, 'bin', 'askerdo.mjs')).href), launcher);
  /* the contract names that launcher, so the model's CLI calls run this copy's code */
  assert.ok(style.includes('node ' + join(rig, 'cli.mjs').replace(/\\/g, '/') + ' register'), 'the style names the sandbox launcher');
  assert.ok(!style.includes('~/.claude/askerdo/cli.mjs register'), 'and not the live one');
  assert.ok(existsSync(join(sbxHome, DATA, 'sync.log')), 'the sync log lands in the sandbox data dir');
  /* the /askerdo command file lands in the sandbox home too (the home's snapshot above holds none) */
  assert.match(readFileSync(join(sbxHome, '.claude', 'commands', 'askerdo.md'), 'utf8'), /^---\ndescription: /);
  /* the board ensure is skipped by name: it registers the one machine-wide task */
  assert.match(readFileSync(join(rig, 'log'), 'utf8'), /board ensure skipped: sandbox/);
});

test('ASKERDO_SANDBOX_HOME alone moves the home, the data dir and the store under it', () => {
  const home = fakeHome();
  const before = snapshot(home);
  const sbxHome = tempDir('ttd-sbx-seam-');

  const out = runSync(home, { ASKERDO_SANDBOX_HOME: sbxHome });

  assert.deepEqual(snapshot(home), before, 'the handed home was not written');
  assert.ok(out.includes('output style regenerated'), out);
  assert.ok(existsSync(join(sbxHome, STYLE)));
  assert.ok(existsSync(join(sbxHome, '.claude', 'askerdo', 'cli.mjs')), 'the store root moved with the home');
  assert.ok(existsSync(join(sbxHome, DATA, 'sync.log')));
});

test('a sandbox seam that cannot be used writes nothing anywhere and says so', () => {
  for (const extra of [
    { ASKERDO_SANDBOX_HOME: 'relative/home' },
    { ASKERDO_SANDBOX_HOME: 'C:/no/such/sandbox/home' },
    { ASKERDO_ROOT: 'C:/no/such/sandbox/askerdo' },
  ]) {
    const home = fakeHome();
    const before = snapshot(home);
    const out = runSync(home, extra);
    assert.deepEqual(snapshot(home), before, JSON.stringify(extra) + ': the handed home was not written');
    assert.match(out, /AskerDo: sandbox seam .* nothing was written/, out);
  }
});

test('a sandbox that resolves inside the handed home is refused', () => {
  const home = fakeHome();
  const before = snapshot(home);
  const out = runSync(home, { ASKERDO_SANDBOX_HOME: home });
  assert.deepEqual(snapshot(home), before);
  assert.match(out, /nothing was written/, out);
  const rigInHome = join(home, '.claude', 'rig');
  mkdirSync(rigInHome);
  const before2 = snapshot(home);
  const out2 = runSync(home, { ASKERDO_ROOT: rigInHome });
  assert.deepEqual(snapshot(home), before2, 'a seam root inside the home would put its sandbox home there');
  assert.match(out2, /nothing was written/, out2);
});

test('a seam naming the live store is no sandbox; the sync runs as usual and says so', () => {
  const home = fakeHome();
  const live = join(home, '.claude', 'askerdo');
  const out = runSync(home, { ASKERDO_ROOT: live, ASKERDO_NO_BOARD: '1' });
  assert.match(out, /ASKERDO_ROOT names the live store \(.*\), so this session is not a sandbox/, out);
  assert.ok(out.includes('output style regenerated'), out);
  assert.notEqual(readFileSync(join(home, STYLE), 'utf8'), 'stale style\n', 'the live style was written');
  assert.ok(!existsSync(live + '-home'), 'no sandbox home beside the live store');
  assert.match(readFileSync(join(home, DATA, 'sync.log'), 'utf8'), /names the live store/);
});

test('a refused seam has no claude home and no data dir, never the real ones', async () => {
  const { claudeHome, dataDir, loadConfig } = await import('../lib/node-helpers.mjs');
  const keep = { ...process.env };
  try {
    delete process.env.ASKERDO_ROOT;
    process.env.ASKERDO_SANDBOX_HOME = 'relative/home';
    assert.equal(claudeHome(), null);
    assert.equal(dataDir(), null);
    assert.equal(loadConfig(), null, 'no config is read from the real home');
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in keep)) delete process.env[k];
    Object.assign(process.env, keep);
  }
});
