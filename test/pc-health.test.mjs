/* the diagnosis names each problem a person hits after an update, with its fix. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runsInCaller } from '../lib/cli-commands.mjs';
import { checkoutBehind, healthText, pcHealth } from '../lib/pc-health.mjs';
import { runScript } from '../lib/mod-scripts.mjs';
import { statusModel } from '../lib/mod-core.mjs';
import { pluginUpdates, setPluginUpdates } from '../lib/plugin-updates.mjs';
import { PROTOCOL } from '../server/paths.mjs';
import { tempDir } from './helpers/sandbox.mjs';

const healthy = {
  env: { ASKERDO_BOARD_URL: 'http://board.test:8080', ASKERDO_BOARD_TOKEN: 't' }, platform: 'win32',
  root: '/store', config: { queue: 'hub', boardUrl: 'http://board.test:8080' }, version: '0.8.13', replaced: false, device: 'pc-two',
  exists: () => true, identity: () => ({ port: 17435, secret: 's' }), place: () => null,
  health: async () => ({ ok: true, version: '0.8.13' }), token: async () => 'ok',
  ping: async () => ({ listening: true, mine: true, version: '0.8.13', tray: 'up' }), checkout: () => null,
};

test('the diagnosis names each problem with its fix, and none on a healthy PC', async (t) => {
  const rows = [
    { name: 'healthy', over: {}, keys: [] },
    { name: 'no config', over: { env: {}, config: null, exists: () => false }, keys: ['config'], fix: /configure.*join-code --device pc-two/ },
    { name: 'board unreachable', over: { health: async () => null }, keys: ['board'], fix: /reachable/ },
    { name: 'token unknown', over: { token: async () => 'denied' }, keys: ['board'], fix: /join-code --device pc-two/ },
    /* a board on a newer protocol refuses every call: this PC updates, its press copying the command */
    { name: 'board on a newer protocol', over: { health: async () => ({ ok: true, protocol: PROTOCOL + 1, version: '0.8.13' }) }, keys: ['board'], fix: /plugin update/, copy: /plugin update/ },
    /* an update that did not take; an old board with no commit fails nothing */
    { name: 'board on an older shipped commit', over: { shipped: () => [{ commit: '86b0d444' }, { commit: '2c5a27a0' }], health: async () => ({ ok: true, version: '0.8.13', commit: '2c5a27a0' }) }, keys: ['board'], fix: /update again/ },
    { name: 'board with no commit', over: { shipped: () => [{ commit: '86b0d444' }] }, keys: [] },
    { name: 'older local server', over: { ping: async () => ({ listening: true, mine: true, version: undefined }) }, keys: ['server'], command: 'board --restart' },
    { name: 'port held', over: { ping: async () => ({ listening: true, mine: false }) }, keys: ['server'], fix: /port 17435/ },
    /* a server too slow to answer the ping is busy, not another program */
    { name: 'server busy', over: { ping: async () => ({ listening: true, mine: false, busy: true }) }, keys: ['server'], command: 'board --restart' },
    { name: 'tray closed', over: { ping: async () => ({ listening: true, mine: true, version: '0.8.13', tray: 'closed' }) }, keys: ['tray'], command: 'board' },
    { name: 'tray exe missing', over: { exists: (f) => !/tray/.test(f), ping: async () => ({ listening: true, mine: true, version: '0.8.13', tray: 'down' }) }, keys: ['tray'], fix: /plugin update/ },
    { name: 'sandbox seam, no tray', over: { env: { ...healthy.env, ASKERDO_SANDBOX_HOME: '/sb' }, ping: async () => ({ listening: true, mine: true, version: '0.8.13', tray: 'down' }) }, keys: [] },
    { name: 'tray switched off', over: { ping: async () => ({ listening: true, mine: true, version: '0.8.13', tray: 'off' }) }, keys: [] },
    { name: 'older session saved in the old folder', over: { place: () => ({ says: 'saved', fix: 'start a new session' }) }, keys: ['settings'], fix: /new session/ },
    { name: 'checkout behind its upstream', over: { checkout: async () => ({ behind: 2, upstream: 'origin/main', remote: 'origin', branch: 'main', dir: '/repo' }) }, keys: ['checkout'], fix: /pull --ff-only/, copy: /pull --ff-only/ },
    { name: 'replaced copy', over: { replaced: true, ping: async () => ({ listening: true, mine: true, version: '0.8.14' }) }, keys: ['copy'], fix: /new session/ },
  ];
  for (const row of rows) {
    const r = await pcHealth({ ...healthy, ...row.over });
    assert.deepEqual(r.problems.map((p) => p.key), row.keys, row.name);
    assert.equal(r.ok, !row.keys.length, row.name);
    if (row.fix) assert.match(r.problems[0].fix, row.fix, row.name);
    if (row.command) assert.equal(r.problems[0].command, row.command, row.name);
    if (row.copy) assert.match(r.problems[0].copy, row.copy, row.name);
  }
  /* the status row's chip says where the fix is: a refused protocol fixed here reads apart from a board fault */
  const chip = async (over) => statusModel({ health: (await pcHealth({ ...healthy, ...over })).problems[0] }).segments.find((s) => s.key === 'health').pic.label;
  const here = await chip(rows[4].over);
  assert.notEqual(here, await chip(rows[2].over));
  assert.equal(await chip({ health: async () => ({ ok: true, protocol: PROTOCOL - 1, version: '0.8.13' }) }), await chip(rows[2].over));
  /* a session's prompt with no carrier section, as the mod's script marks it, is named until a prompt carries it again */
  const env = { ...healthy.env, ASKERDO_SANDBOX_HOME: tempDir('askerdo-pc-health-', t) };
  assert.equal((await runScript({ argv: ['mod-carrier', 'missing', '--session', 's-1'], env })).code, 0);
  const marked = await pcHealth({ ...healthy, env });
  assert.deepEqual(marked.problems.map((p) => p.key), ['prompt']);
  assert.match(healthText(marked), /context_management.*s-1/);
  /* the prompt hooks off is a note naming the session, no problem, so status exits 0 and the band draws nothing */
  await runScript({ argv: ['mod-carrier', 'off', '--session', 's-3'], env });
  const off = await pcHealth({ ...healthy, env });
  assert.deepEqual([off.ok, off.checks.filter((c) => c.note).map((c) => c.key)], [true, ['prompt']]);
  assert.match(healthText(off), /^NOTE +prompt: .*s-3/m);
  await runScript({ argv: ['mod-carrier', 'seen', '--session', 's-2'], env });
  assert.equal((await pcHealth({ ...healthy, env })).ok, true);
  /* through the local route the copy check would read the server's copy, not the caller's */
  assert.ok(runsInCaller(['status']), 'status runs in the caller');
});

/* configure's yes sets the app's switch, keeping everything else in both files */
test('turning on auto-update merges into the app files and keeps every other key', (t) => {
  const claude = tempDir('askerdo-pc-health-', t);
  mkdirSync(join(claude, 'plugins'));
  const known = join(claude, 'plugins', 'known_marketplaces.json');
  const settings = join(claude, 'settings.json');
  writeFileSync(known, JSON.stringify({ askerdo: { source: { source: 'github', repo: 'ToxMox/askerdo' }, installLocation: 'x' }, other: { autoUpdate: false } }));
  writeFileSync(settings, JSON.stringify({ outputStyle: 'askerdo', extraKnownMarketplaces: { askerdo: { source: { source: 'github', repo: 'ToxMox/askerdo' }, autoUpdate: false } } }));
  const opts = { env: {}, claude, name: 'askerdo' };
  assert.equal(pluginUpdates(opts).on, false);
  assert.equal(setPluginUpdates(true, opts).ok, true);
  assert.equal(pluginUpdates(opts).on, true);
  /* a PC whose app config lives in CLAUDE_CONFIG_DIR is read there */
  assert.equal(pluginUpdates({ env: { CLAUDE_CONFIG_DIR: claude }, name: 'askerdo' }).on, true);
  const k = JSON.parse(readFileSync(known, 'utf8'));
  assert.deepEqual(k.other, { autoUpdate: false });
  assert.equal(k.askerdo.installLocation, 'x');
  const s = JSON.parse(readFileSync(settings, 'utf8'));
  assert.equal(s.outputStyle, 'askerdo');
  assert.equal(s.extraKnownMarketplaces.askerdo.source.repo, 'ToxMox/askerdo');
  assert.equal(s.extraKnownMarketplaces.askerdo.autoUpdate, true);
});

/* a checkout install learns it is behind from a short fetch; a released copy and a branch
   with no remote branch say nothing. Where dev tracks origin/main, the lag is
   counted against origin/dev, and an unreachable remote keeps the lag the last fetch learned. */
test('a checkout install is behind its remote branch of the same name after the remote moved, offline too', async (t) => {
  const dir = tempDir('askerdo-pc-health-', t);
  const git = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8', windowsHide: true }).trim();
  const ident = ['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-c', 'commit.gpgsign=false'];
  const origin = join(dir, 'origin');
  execFileSync('git', ['init', '-q', '-b', 'main', origin]);
  git(origin, ...ident, 'commit', '-q', '--allow-empty', '-m', 'one');
  git(origin, 'branch', 'dev');
  const copy = join(dir, 'copy');
  execFileSync('git', ['clone', '-q', origin, copy]);
  git(copy, 'checkout', '-q', '-b', 'dev', '--track', 'origin/main');
  assert.equal(await checkoutBehind(copy), null, 'up to date');
  git(origin, 'checkout', '-q', 'dev');
  git(origin, ...ident, 'commit', '-q', '--allow-empty', '-m', 'two');
  const b = await checkoutBehind(copy);
  assert.equal(b.behind, 1);
  assert.equal(b.upstream, 'origin/dev');
  /* the fix is live-update for the main checkout and a pull for a linked worktree, which live-update never moves */
  const lane = join(dir, 'lane');
  git(copy, 'worktree', 'add', '-q', '-b', 'lane', lane);
  for (const at of [copy, lane]) { mkdirSync(join(at, 'scripts')); writeFileSync(join(at, 'scripts', 'live-update.mjs'), ''); }
  const fixOf = async (at) => (await pcHealth({ ...healthy, checkout: async () => ({ ...b, dir: at }) })).problems.find((p) => p.key === 'checkout').copy;
  assert.match(await fixOf(copy), /live-update/);
  assert.match(await fixOf(lane), /pull --ff-only/);
  git(copy, 'remote', 'set-url', 'origin', join(dir, 'gone'));
  const known = await checkoutBehind(copy);
  assert.equal(known.behind, 1, 'unreachable remote keeps the known lag');
  assert.equal(known.stale, true);
  git(copy, 'checkout', '-q', '-b', 'local');
  assert.equal(await checkoutBehind(copy), null, 'no remote branch');
  assert.equal(await checkoutBehind(join(dir, 'released')), null, 'no git checkout');
});
