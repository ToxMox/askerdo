/* Functional tests for the hub additions to the carrier sync: the stable launcher and
 * the board ensure, spawned against a sandboxed fake home with synthetic paths. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { pluginRoot, pluginVersion } from '../lib/node-helpers.mjs';
import { childEnv, tempDir } from './helpers/sandbox.mjs';

const syncScript = join(pluginRoot, 'hooks', 'sync.mjs');
const boardScript = join(pluginRoot, 'hooks', 'board-server.mjs');

function sandbox(cfg) {
  const home = tempDir('ttd-hub-home-');
  const data = join(home, '.claude', 'plugins', 'data', 'askerdo-askerdo');
  mkdirSync(data, { recursive: true });
  if (cfg) writeFileSync(join(data, 'config.json'), JSON.stringify(cfg));
  /* a fake home is a fresh machine, so the sync resolves the new root */
  const root = join(home, '.claude', 'askerdo');
  return {
    home, data, root,
    launcher: join(root, 'cli.mjs'),
    run: (input, extraEnv = {}) => execFileSync(process.execPath, [syncScript], {
      env: {
        ...childEnv(), HOME: home, USERPROFILE: home, CLAUDE_PLUGIN_DATA: data,
        /* the board ensure is its own test surface (board-server.test.mjs) and
           would spawn a detached server per case here */
        ASKERDO_NO_BOARD: '1',
        /* this copy may itself be a worktree; the cases below name the kind they test */
        ASKERDO_COPY_KIND: 'checkout',
        ...extraEnv,
      },
      encoding: 'utf8',
      input: input === undefined ? undefined : JSON.stringify(input),
    }),
  };
}

/* The identity the board ensure's register is handed, so no case in this file
   asks the machine who it is: a synthetic SID through the env seam, the
   same shape test/board-server.test.mjs injects through the options bag. */
const FAKE_SID = 'S-1-5-21-4242-4242-4242-1001';

const hookInput = (session, cwd) => ({
  session_id: session, cwd, hook_event_name: 'SessionStart', source: 'startup',
});

/* the carrier's own lines share the AskerDo prefix; each names the output style */
const summaryLines = (out) => out.split('\n').filter((l) => l.startsWith('AskerDo:') && !l.includes('output style'));

test('gate off: queue text, off, and widgets write no launcher and print no summary', () => {
  for (const q of ['text', 'off', 'widgets']) {
    const sb = sandbox({ name: 'Probe', queue: q });
    const out = sb.run(hookInput('sess-a', 'C:/repos/proj-a'));
    assert.deepEqual(summaryLines(out), [], 'queue=' + q);
    assert.equal(existsSync(sb.launcher), false, 'no launcher for queue=' + q);
    assert.equal(existsSync(sb.root), false, 'the store root is never seeded for queue=' + q);
    /* the existing sync work is unaffected */
    assert.ok(out.includes('output style regenerated'), out);
    assert.ok(out.includes('does not select it'), out);
  }
});

test('hub mode with an empty store writes the launcher and stays silent', () => {
  const sb = sandbox({ name: 'Probe', queue: 'hub' });
  const out = sb.run(hookInput('sess-a', 'C:/repos/proj-a'));
  assert.deepEqual(summaryLines(out), []);
  assert.ok(out.includes('output style regenerated'), out);
  const content = readFileSync(sb.launcher, 'utf8');
  const target = pathToFileURL(join(pluginRoot, 'bin', 'askerdo.mjs')).href;
  assert.ok(content.includes(target), 'launcher points at this install: ' + content);
  assert.ok(content.includes('bin/askerdo.mjs'), content);
  /* the first line is what a person opening the file reads, so it is the brand */
  assert.ok(content.startsWith('/* AskerDo launcher'), content);
});

test('the launcher write is idempotent: a second run never rewrites it', () => {
  const sb = sandbox({ name: 'Probe', queue: 'hub' });
  sb.run(hookInput('sess-a', 'C:/repos/proj-a'));
  const before = statSync(sb.launcher).mtimeMs;
  sb.run(hookInput('sess-b', 'C:/repos/proj-a'));
  assert.equal(statSync(sb.launcher).mtimeMs, before, 'read-compare found it current');
});

/* the sync is a caller like any other, so a seam moves the launcher
   write and the board ensure together. The scheduler exe is pointed at nothing,
   the shape the cold-seam case below uses, so no board is ever started. */
test('the seam moves the launcher and the ensure to the copy', () => {
  const sb = sandbox({ name: 'Probe', queue: 'hub' });
  const parent = tempDir('ttd-hub-home-');
  const rig = join(parent, 'rig-copy');
  mkdirSync(rig, { recursive: true });
  const out = execFileSync(process.execPath, [syncScript], {
    env: {
      ...childEnv(), HOME: sb.home, USERPROFILE: sb.home, CLAUDE_PLUGIN_DATA: sb.data,
      ASKERDO_ROOT: rig,
      ASKERDO_SCHTASKS: join(sb.home, 'no-such-scheduler.exe'),
      ASKERDO_SID: FAKE_SID,
    },
    encoding: 'utf8',
    input: JSON.stringify(hookInput('sess-a', 'C:/repos/proj-a')),
  });
  assert.ok(out.includes('output style regenerated'), out);
  assert.ok(readFileSync(join(rig, 'cli.mjs'), 'utf8').includes('bin/askerdo.mjs'));
  assert.equal(existsSync(sb.root), false, 'the home store was written to anyway');
  /* a seam is a sandbox, so the ensure is skipped by name rather than handed the root
     and refused (the root guard still refuses it if reached) */
  const log = readFileSync(join(rig, 'log'), 'utf8');
  assert.match(log, /board ensure skipped: sandbox seam/, log);
  /* nothing beside the copy but the sandbox home the style went to */
  assert.deepEqual(readdirSync(parent), ['rig-copy', 'rig-copy-home']);
  assert.ok(existsSync(join(parent, 'rig-copy-home', '.claude', 'output-styles', 'askerdo.md')));
});

test('fail open: a file where the store root should be leaves sync intact', () => {
  const sb = sandbox({ name: 'Probe', queue: 'hub' });
  writeFileSync(sb.root, 'not a directory');
  const out = sb.run(hookInput('sess-a', 'C:/repos/proj-a'));
  assert.ok(out.includes('output style regenerated'), out);
  assert.deepEqual(summaryLines(out), []);
  assert.equal(readFileSync(sb.root, 'utf8'), 'not a directory');
});

/* ---- the board ensure at the seam --------------------------------------- */

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer(() => {});
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/* The identity the store would have minted, written by hand, so a sync run in
   this sandbox ensures a board WE control instead of touching the real one. */
async function mintIdentity(root) {
  const secret = randomBytes(16).toString('hex');
  const port = await freePort();
  mkdirSync(join(root, 'board'), { recursive: true });
  writeFileSync(join(root, 'board', 'secret'), secret + '\n');
  writeFileSync(join(root, 'board', 'port'), String(port) + '\n');
  /* the notification channel off, as in test/board-server.test.mjs: a board
     started here is a REAL server process and would otherwise raise real toasts
     on a Windows desktop */
  writeFileSync(join(root, 'board', 'notify.json'), JSON.stringify({
    enabled: false, woken: false, closed: false, sound: false, tray: false,
  }) + '\n');
  return { secret, port, base: 'http://127.0.0.1:' + port + '/' + secret };
}

test('the seam adopts a live board: no twin, no replace, and not a word about it',
  { timeout: 20000 }, async (t) => {
    const sb = sandbox({ name: 'Probe', queue: 'hub' });
    mkdirSync(sb.root, { recursive: true });
    const id = await mintIdentity(sb.root);
    const board = spawn(process.execPath, [boardScript, '--root', sb.root], { env: childEnv() });
    t.after(async () => {
      try { await fetch(id.base + '/stop', { method: 'POST' }); } catch {}
      try { board.kill(); } catch {}
    });
    board.stdout.setEncoding('utf8');
    await new Promise((resolve, reject) => {
      board.stdout.on('data', (d) => { if (d.includes('\n')) resolve(); });
      board.on('error', reject);
      board.on('close', resolve);
    });

    /* NO_BOARD deliberately unset: this is the one case that exercises the seam */
    const out = execFileSync(process.execPath, [syncScript], {
      env: {
        ...childEnv(),
        HOME: sb.home,
        USERPROFILE: sb.home,
        CLAUDE_PLUGIN_DATA: sb.data,
        ASKERDO_SID: FAKE_SID,
      },
      encoding: 'utf8',
      input: JSON.stringify(hookInput('sess-a', 'C:/repos/proj-a')),
    });
    assert.ok(out.includes('output style regenerated'), out);
    assert.ok(!/board/i.test(out), 'the ensure is silent on every outcome: ' + out);

    const ping = await fetch(id.base + '/ping', { method: 'POST' });
    assert.equal(ping.status, 204);
    assert.equal(ping.headers.get('x-askerdo-board'), pluginVersion());
    assert.equal(board.exitCode, null, 'the running board was adopted, not replaced');
  });

/* A cold sync must START a board, which means registering and running the TASK. NO
   SUITE RUN MAY REGISTER A REAL TASK, so the runner's exe points at a file that is
   not there. */
test('a cold seam starts the board through the task, and says so when it cannot',
  { timeout: 20000 }, async (t) => {
    const sb = sandbox({ name: 'Probe', queue: 'hub' });
    mkdirSync(sb.root, { recursive: true });
    const id = await mintIdentity(sb.root);
    t.after(async () => { try { await fetch(id.base + '/stop', { method: 'POST' }); } catch {} });

    /* NO_BOARD deliberately unset: this is the one case that exercises the
       cold arm of the seam */
    const out = execFileSync(process.execPath, [syncScript], {
      env: {
        ...childEnv(),
        HOME: sb.home,
        USERPROFILE: sb.home,
        CLAUDE_PLUGIN_DATA: sb.data,
        ASKERDO_SCHTASKS: join(sb.home, 'no-such-scheduler.exe'),
        ASKERDO_SID: FAKE_SID,
      },
      encoding: 'utf8',
      input: JSON.stringify(hookInput('sess-a', 'C:/repos/proj-a')),
    });
    /* the hook itself says nothing about the board, whatever happened */
    assert.ok(out.includes('output style regenerated'), out);
    assert.ok(!/board/i.test(out), 'the ensure is silent on every outcome: ' + out);

    const log = readFileSync(join(sb.root, 'log'), 'utf8');
    assert.match(log, /board ensure: failed/, log);
    assert.match(log, /could not be registered/, log);
    assert.match(log, /AskerDo board/, log);
    /* AND NOTHING WAS STARTED BEHIND IT: the identity port is still
       quiet, so no fallback spawn survives anywhere on this path */
    await assert.rejects(fetch(id.base + '/ping', { method: 'POST' }),
      'a board came up without the task');
  });

test('the ASKERDO_NO_BOARD seam skips the ensure entirely', () => {
  const sb = sandbox({ name: 'Probe', queue: 'hub' });
  const out = sb.run(hookInput('sess-a', 'C:/repos/proj-a'));
  assert.ok(out.includes('output style regenerated'), out);
  assert.ok(existsSync(sb.launcher), 'the launcher still lands');
  /* ensureStore would have minted board identity on its way to starting one */
  assert.equal(existsSync(join(sb.root, 'board')), false, 'no identity minted, so nothing ensured');
});

/* ---- a launcher another copy owns ------------------- */

/* A plugin copy at another root, as the launcher sees it: a plugin.json with
   the given version and the entry the launcher imports. */
function otherCopy(version) {
  const root = join(tempDir('ttd-hub-home-'), 'plugin');
  mkdirSync(join(root, '.claude-plugin'), { recursive: true });
  mkdirSync(join(root, 'bin'), { recursive: true });
  if (version !== null) {
    writeFileSync(join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'askerdo', version }));
  }
  writeFileSync(join(root, 'bin', 'askerdo.mjs'), '// another copy\n');
  return root;
}

const launcherFor = (root) => '/* AskerDo launcher, maintained by the AskerDo sync; edits are overwritten */\n'
  + 'await import(' + JSON.stringify(pathToFileURL(join(root, 'bin', 'askerdo.mjs')).href) + ');\n';

/* this copy's version moved by one in the given place, so a case never pins it */
function bump(delta) {
  const parts = pluginVersion().split('.').map(Number);
  parts[2] += delta;
  if (parts[2] < 0) { parts[1] -= 1; parts[2] = 99; }
  return parts.join('.');
}

test('a launcher owned by an equal or newer copy at another root is left alone, and the skip is logged', () => {
  for (const version of [pluginVersion(), bump(1)]) {
    const sb = sandbox({ name: 'Probe', queue: 'hub' });
    const other = otherCopy(version);
    mkdirSync(sb.root, { recursive: true });
    writeFileSync(sb.launcher, launcherFor(other));
    sb.run(hookInput('sess-a', 'C:/repos/proj-a'));
    assert.equal(readFileSync(sb.launcher, 'utf8'), launcherFor(other), version + ': the launcher kept its copy');
    const sync = readFileSync(join(sb.data, 'sync.log'), 'utf8');
    assert.match(sync, /launcher left at .* points at version /, sync);
  }
});

test('a worktree copy never takes a launcher a live copy owns, even when newer; dead ones it may', () => {
  const ours = launcherFor(pluginRoot);
  for (const version of [bump(-1), pluginVersion(), bump(1)]) {
    const sb = sandbox({ name: 'Probe', queue: 'hub' });
    const other = otherCopy(version);
    mkdirSync(sb.root, { recursive: true });
    writeFileSync(sb.launcher, launcherFor(other));
    sb.run(hookInput('sess-a', 'C:/repos/proj-a'), { ASKERDO_COPY_KIND: 'worktree' });
    assert.equal(readFileSync(sb.launcher, 'utf8'), launcherFor(other), version + ': the live copy keeps its launcher');
    assert.match(readFileSync(join(sb.data, 'sync.log'), 'utf8'), /is a git worktree, which never takes it/);
  }
  const sb = sandbox({ name: 'Probe', queue: 'hub' });
  mkdirSync(sb.root, { recursive: true });
  writeFileSync(sb.launcher, launcherFor(join(sb.home, 'gone')));
  sb.run(hookInput('sess-a', 'C:/repos/proj-a'), { ASKERDO_COPY_KIND: 'worktree' });
  assert.equal(readFileSync(sb.launcher, 'utf8'), ours, 'a launcher whose copy is gone is repointed');
});

test('this copy repoints a launcher whose copy is older, missing, unreadable, replaced, or not ours', () => {
  const ours = launcherFor(pluginRoot);
  const cases = [
    ['older', (sb) => launcherFor(otherCopy(bump(-1)))],
    ['missing target', (sb) => launcherFor(join(sb.home, 'gone'))],
    ['unreadable version', (sb) => launcherFor(otherCopy(null))],
    /* a rollback leaves the newer copy in the cache, marked replaced */
    ['replaced', () => {
      const newer = otherCopy(bump(1));
      writeFileSync(join(newer, '.orphaned_at'), String(Date.now()));
      return launcherFor(newer);
    }],
    ['not ours', () => '// hand written\nawait import("file:///C:/x/bin/askerdo.mjs");\n'],
  ];
  for (const [label, make] of cases) {
    const sb = sandbox({ name: 'Probe', queue: 'hub' });
    mkdirSync(sb.root, { recursive: true });
    writeFileSync(sb.launcher, make(sb));
    sb.run(hookInput('sess-a', 'C:/repos/proj-a'));
    assert.equal(readFileSync(sb.launcher, 'utf8'), ours, label + ': repointed at this copy');
  }
});

/* Claude Code marks the cache copy an update replaced; a session still on it
   (its next /clear) must not put the old style and launcher back */
test('a replaced copy syncs nothing and says so', () => {
  const copy = join(tempDir('ttd-hub-home-'), 'plugin');
  for (const name of ['lib', 'hooks', '.claude-plugin']) cpSync(join(pluginRoot, name), join(copy, name), { recursive: true });
  writeFileSync(join(copy, '.orphaned_at'), String(Date.now()));
  const sb = sandbox({ name: 'Probe', queue: 'hub' });
  const out = execFileSync(process.execPath, [join(copy, 'hooks', 'sync.mjs')], {
    env: { ...childEnv(), HOME: sb.home, USERPROFILE: sb.home, CLAUDE_PLUGIN_DATA: sb.data, ASKERDO_NO_BOARD: '1', ASKERDO_COPY_KIND: 'checkout' },
    encoding: 'utf8', input: JSON.stringify(hookInput('sess-a', 'C:/repos/proj-a')),
  });
  assert.match(out, /^AskerDo: .*replaced/m, out);
  assert.equal(existsSync(join(sb.home, '.claude', 'output-styles', 'askerdo.md')), false, 'no style written');
  assert.equal(existsSync(sb.launcher), false, 'no launcher written');
});
