/* the diagnosis names each problem a person hits after an update, with its fix. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runsInCaller } from '../lib/cli-commands.mjs';
import { pcHealth } from '../lib/pc-health.mjs';
import { pluginUpdates, setPluginUpdates } from '../lib/plugin-updates.mjs';
import { tempDir } from './helpers/sandbox.mjs';

const healthy = {
  env: { ASKERDO_BOARD_URL: 'http://board.test:8080', ASKERDO_BOARD_TOKEN: 't' }, platform: 'win32',
  root: '/store', config: { queue: 'hub', boardUrl: 'http://board.test:8080' }, version: '0.8.13', replaced: false, device: 'pc-two',
  exists: () => true, identity: () => ({ port: 17435, secret: 's' }), place: () => null,
  health: async () => ({ ok: true, version: '0.8.13' }), token: async () => 'ok',
  ping: async () => ({ listening: true, mine: true, version: '0.8.13', tray: 'up' }),
};

test('the diagnosis names each problem with its fix, and none on a healthy PC', async () => {
  const rows = [
    { name: 'healthy', over: {}, keys: [] },
    { name: 'no config', over: { env: {}, config: null, exists: () => false }, keys: ['config'], fix: /configure.*join-code --device pc-two/ },
    { name: 'board unreachable', over: { health: async () => null }, keys: ['board'], fix: /reachable/ },
    { name: 'token unknown', over: { token: async () => 'denied' }, keys: ['board'], fix: /join-code --device pc-two/ },
    { name: 'older local server', over: { ping: async () => ({ listening: true, mine: true, version: undefined }) }, keys: ['server'], command: 'board --restart' },
    { name: 'port held', over: { ping: async () => ({ listening: true, mine: false }) }, keys: ['server'], fix: /port 17435/ },
    /* a server too slow to answer the ping is busy, not another program */
    { name: 'server busy', over: { ping: async () => ({ listening: true, mine: false, busy: true }) }, keys: ['server'], command: 'board --restart' },
    { name: 'tray closed', over: { ping: async () => ({ listening: true, mine: true, version: '0.8.13', tray: 'closed' }) }, keys: ['tray'], command: 'board' },
    { name: 'tray exe missing', over: { exists: (f) => !/tray/.test(f), ping: async () => ({ listening: true, mine: true, version: '0.8.13', tray: 'down' }) }, keys: ['tray'], fix: /plugin update/ },
    { name: 'sandbox seam, no tray', over: { env: { ...healthy.env, ASKERDO_SANDBOX_HOME: '/sb' }, ping: async () => ({ listening: true, mine: true, version: '0.8.13', tray: 'down' }) }, keys: [] },
    { name: 'tray switched off', over: { ping: async () => ({ listening: true, mine: true, version: '0.8.13', tray: 'off' }) }, keys: [] },
    { name: 'older session saved in the old folder', over: { place: () => ({ says: 'saved', fix: 'start a new session' }) }, keys: ['settings'], fix: /new session/ },
    { name: 'replaced copy', over: { replaced: true, ping: async () => ({ listening: true, mine: true, version: '0.8.14' }) }, keys: ['copy'], fix: /new session/ },
  ];
  for (const row of rows) {
    const r = await pcHealth({ ...healthy, ...row.over });
    assert.deepEqual(r.problems.map((p) => p.key), row.keys, row.name);
    assert.equal(r.ok, !row.keys.length, row.name);
    if (row.fix) assert.match(r.problems[0].fix, row.fix, row.name);
    if (row.command) assert.equal(r.problems[0].command, row.command, row.name);
  }
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
