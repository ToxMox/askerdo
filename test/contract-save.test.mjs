/* The contract save the settings verb runs, at the library, with the real
 * sync in a throwaway home and data dir. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pluginRoot } from '../lib/node-helpers.mjs';
import { saveContract } from '../lib/contract-save.mjs';
import { boardCall } from '../lib/board-call.mjs';
import { childEnv, tempDir } from './helpers/sandbox.mjs';

const OPTIONS = {
  name: 'Probe',
  weather: true, forecast: false, tasks: true, docs: true, fold: true,
  decision: true, diff: true, emdash: true, visual: true, interactive: true,
  ids: false, dlg: 'free', queue: 'text',
  custom: ['Name the branch.  ', '   ', 'Link the PR.'],
  alias: 'ad',
};

function sandbox(t, saved) {
  const home = tempDir('ttd-home-', t);
  /* the options live in this PC's folder, which the save finds in-process through the sandbox seam */
  const data = join(home, '.claude', 'askerdo', 'pc');
  mkdirSync(data, { recursive: true });
  if (saved) writeFileSync(join(data, 'config.json'), JSON.stringify(saved));
  /* ASKERDO_NO_BOARD: the sync's board ensure would otherwise start a board */
  const env = childEnv({ ASKERDO_SANDBOX_HOME: home, ASKERDO_NO_BOARD: '1' });
  const runSync = (args) => {
    const r = spawnSync(process.execPath, [join(pluginRoot, 'hooks', 'sync.mjs'), ...args], { env, encoding: 'utf8' });
    return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
  };
  return {
    env, data,
    save: (raw) => saveContract(raw, { env, runSync }),
    saved: () => JSON.parse(readFileSync(join(data, 'config.json'), 'utf8')),
    style: join(home, '.claude', 'output-styles', 'askerdo.md'),
  };
}

test('a save with no board writes config.json and regenerates the style', async (t) => {
  /* a config saved before serial and agents were retired still saves */
  const sb = sandbox(t, { name: 'Old', serial: true, agents: true });
  const r = await sb.save(OPTIONS);
  assert.equal(r.error, undefined, r.error);
  assert.equal(r.changed, true);
  const saved = sb.saved();
  assert.deepEqual([saved.name, saved.forecast, saved.alias], [undefined, false, 'ad']);
  assert.deepEqual(saved.custom, ['Name the branch.', 'Link the PR.']);
  assert.ok(!('serial' in saved), 'the retired keys go at the save');
  assert.ok(!readFileSync(sb.style, 'utf8').includes('Probe'), 'a retired name never reaches the style (K-844)');
  assert.equal((await sb.save(OPTIONS)).changed, false, 'an identical save writes nothing new');
});

test("a board user's save lands on the default profile and keeps the board link; an unreachable board saves nothing", async (t) => {
  const token = { boardToken: 'device-token-4242' };
  const sb = sandbox(t, { name: 'Old', boardUrl: 'http://127.0.0.1:9/', ...token });
  const refused = await sb.save(OPTIONS);
  assert.match(refused.error, /nothing was saved/);
  assert.equal(sb.saved().name, 'Old', 'the PC copy is untouched');
  assert.equal(existsSync(sb.style), false, 'no sync ran');

  const fileBoard = 'file:' + join(tempDir('askerdo-store-', t), 'board.db').replace(/\\/g, '/');
  writeFileSync(join(sb.data, 'config.json'), JSON.stringify({ name: 'Old', queue: 'hub', boardUrl: fileBoard, ...token }));
  /* queue text, as a reset form sends it: the PC stays on the board */
  const r = await sb.save(OPTIONS);
  assert.equal(r.error, undefined, r.error);
  const saved = sb.saved();
  assert.deepEqual([saved.name, saved.boardUrl, saved.boardToken, saved.queue], [undefined, fileBoard, token.boardToken, 'hub']);
  const list = await boardCall('profileList', {}, { env: { ASKERDO_BOARD_URL: fileBoard } });
  const home = list.profiles.find((p) => (list.subscriptions.default || { add: [] }).add.includes(p.profile));
  assert.equal(home.profile, r.profile);
  assert.deepEqual([home.settings['contract.name'], home.settings['contract.forecast']], [undefined, false]);
});
