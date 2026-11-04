/* The mod's switch and the scripts the mod runs: the
 * depth-guard marker, resolved on the board, and the session inbox the local
 * server fills. Both run in process here, as the local server runs them. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { modRunning } from '../lib/node-helpers.mjs';
import { boardCall } from '../lib/board-call.mjs';
import { runScript } from '../lib/mod-scripts.mjs';
import { appendInbox } from '../lib/local-inbox.mjs';
import { childEnv, tempDir } from './helpers/sandbox.mjs';

process.removeAllListeners('warning');

test('modRunning reads the one switch value and nothing else', () => {
  assert.equal(modRunning({ ASKERDO_MOD: '1' }), true);
  for (const v of [undefined, '', '0', 'true', 'yes']) assert.equal(modRunning({ ASKERDO_MOD: v }), false, String(v));
});

const MY_APP = 'C:\\src\\my.app';

/* a sandbox home for the markers and a file: board beside it */
function markerHomes(board = 'file:') {
  const sandboxHome = tempDir('ttd-modsw-sandbox-');
  const base = join(sandboxHome, '.claude', 'projects', 'C--src-my-app');
  const env = { ...childEnv(), ASKERDO_SANDBOX_HOME: sandboxHome,
    ASKERDO_BOARD_URL: board === 'file:' ? 'file:' + join(sandboxHome, 'board.db').replace(/\\/g, '/') : board };
  const run = async (...args) => {
    const r = await runScript({ argv: ['depth-marker', '--cwd', MY_APP, ...args, '--json'], env });
    assert.equal(r.code, 0, r.stderr);
    return JSON.parse(r.stdout);
  };
  const call = (name, input) => boardCall(name, input, { env });
  return { sandboxHome, base, env, run, call };
}

const OFF = { on: false, source: null, guard: { soft: 350000, hard: 450000, remind: 25000, hardDeny: false },
  main: { on: true, window: 30, wrap: 40 }, sources: {}, path: null, written: [], removed: [] };

test('no profile anywhere: the guard is off, the meter at 30 and 40, and no marker is written', async () => {
  const h = markerHomes();
  assert.deepEqual(await h.run('--session', 'sess-1', '--track', 'abcdefgh', '--write'), OFF);
  assert.equal(existsSync(join(h.sandboxHome, '.claude')), false, 'no marker was made');
});

test('/askerdo guard on puts guard-on on the project on the board; a track session inherits it and gets its own marker', async () => {
  const h = markerHomes();
  const ws = await h.call('createRecord', { kind: 'workstream', name: 'app', description: 'd', projects: ['C:/src/my.app'] });
  const tr = await h.call('newTrack', { name: 'the build', workstream: ws.id });
  const on = await h.run('--session', 'sess-1', '--project', 'on');
  assert.equal(on.on, true);
  assert.deepEqual(on.source, { profile: 'guard-on', record: 'C:/src/my.app', level: 'project' });
  const projectMarker = join(h.base, 'depth-guard.json');
  assert.ok(on.written.includes(projectMarker));
  const m = JSON.parse(readFileSync(projectMarker, 'utf8'));
  assert.deepEqual([m.by, m.projectDir, m.thread, m.agent.on], ['askerdo profiles', 'C:/src/my.app', null, true]);
  assert.ok((await h.call('profileList', {})).profiles.find((p) => p.profile === 'guard-on').records.includes('C:/src/my.app'), 'the board holds it');
  const held = await h.run('--session', 'sess-2', '--track', tr.key);
  const trackMarker = join(h.base, tr.key, 'depth-guard.json');
  assert.deepEqual([held.on, held.written], [true, [trackMarker]]);
  assert.equal(JSON.parse(readFileSync(trackMarker, 'utf8')).thread, tr.id);
  const off = await h.run('--session', 'sess-1', '--track', tr.key, '--project', 'off');
  assert.equal(off.on, false);
  assert.deepEqual(off.removed.sort(), [trackMarker, projectMarker].sort(), 'nothing sets anything now, so both markers go');
});

test('a hand-written marker no longer opts in and is never rewritten or removed', async () => {
  const h = markerHomes();
  mkdirSync(join(h.base, 'sess-1'), { recursive: true });
  const hand = '{"soft":300000,"hard":400000,"remind":25000}\n';
  writeFileSync(join(h.base, 'sess-1', 'depth-guard.json'), hand);
  writeFileSync(join(h.base, 'depth-guard.json'), hand);
  assert.equal((await h.run('--session', 'sess-1')).on, false);
  await h.run('--session', 'sess-1', '--project', 'on');
  assert.equal(JSON.parse(readFileSync(join(h.base, 'depth-guard.json'), 'utf8')).by, 'askerdo profiles',
    'the project slot belongs to the profiles once one sets something there');
  await h.run('--session', 'sess-1', '--project', 'off');
  assert.equal(existsSync(join(h.base, 'depth-guard.json')), false);
  assert.equal(readFileSync(join(h.base, 'sess-1', 'depth-guard.json'), 'utf8'), hand, 'the session marker is never touched');
});

test('a board that cannot be read leaves the markers as they are and reports what they hold, with the problem', async () => {
  const h = markerHomes();
  await h.run('--session', 'sess-1', '--project', 'on');
  const projectMarker = join(h.base, 'depth-guard.json');
  const before = readFileSync(projectMarker, 'utf8');
  const gone = { ...h, env: { ...h.env, ASKERDO_BOARD_URL: 'gopher://nowhere' } };
  const run = async (...args) => JSON.parse((await runScript({ argv: ['depth-marker', '--cwd', MY_APP, ...args, '--json'], env: gone.env })).stdout);
  const r = await run('--session', 'sess-1');
  assert.equal(readFileSync(projectMarker, 'utf8'), before, 'the marker is never synced to the built-ins');
  assert.deepEqual([r.on, r.guard.soft, r.source.level, r.path, r.written, r.removed], [true, 350000, 'marker', projectMarker, [], []]);
  assert.match(r.problem, /the board/);
  const none = await run('--session', 'sess-1', '--track', 'abcdefgh');
  assert.deepEqual([none.on, none.path, existsSync(join(h.base, 'abcdefgh'))], [false, null, false]);
  assert.match(none.problem, /the board/);
});

test('the marker script refuses a bad seam, session or track and writes nothing', async () => {
  const run = (env, args) => runScript({ argv: ['depth-marker', ...args], env: { ...childEnv(), ...env } });
  const bad = await run({ ASKERDO_SANDBOX_HOME: 'relative/dir' }, ['--session', 's', '--cwd', 'C:/x', '--project', 'on']);
  assert.equal(bad.code, 1);
  assert.match(bad.stderr, /nothing was written/);
  assert.equal((await run({}, ['--session', '../x', '--cwd', 'C:/x'])).code, 1);
  assert.equal((await run({}, ['--track', 'TR-3', '--cwd', 'C:/x'])).code, 1);
  assert.equal((await run({}, ['--project', 'maybe', '--cwd', 'C:/x'])).code, 1);
});

test('mod-inbox: take tells this session the board\'s answer line, once; put and --id move one back and out; peek takes nothing', async () => {
  const home = tempDir('ttd-modsw-home-');
  const data = join(home, '.claude', 'plugins', 'data', 'askerdo-askerdo');
  mkdirSync(data, { recursive: true });
  writeFileSync(join(data, 'config.json'), JSON.stringify({ name: 'Probe', queue: 'hub' }));
  const inbox = join(home, '.claude', 'askerdo', 'inbox');
  /* the line the local server writes for a board answer row (lib/local-inbox.mjs) */
  appendInbox(inbox, 'sess-a', { at: '2026-10-25T09:00:00+00:00', kind: 'answer', id: 'Q1', key: 'qqqqqqq1', name: 'store shape',
    by: 'session:sess-b', seq: 7, pick: 'b', note: 'files are the truth' });
  const env = { ...childEnv(), ASKERDO_SANDBOX_HOME: home, CLAUDE_PLUGIN_DATA: data };
  const boxes = () => readdirSync(inbox).sort();
  const run = async (args, stdin) => {
    const r = await runScript({ argv: ['mod-inbox', ...args, '--json'], env, stdin });
    assert.equal(r.code, 0, r.stderr);
    return JSON.parse(r.stdout);
  };
  const took = await run(['take', '--session', 'sess-a']);
  assert.equal(took.events.length, 1);
  assert.ok(['Q1', '1b', 'files are the truth'].every((s) => took.events[0].line.includes(s)), took.events[0].line);
  assert.equal(took.events[0].raw.id, 'Q1');
  /* what a take answered comes back until a later take acks its key */
  assert.deepEqual((await run(['take', '--session', 'sess-a'])).events.map((e) => e.key), [took.events[0].key]);
  assert.deepEqual((await run(['take', '--session', 'sess-a', '--ack'], JSON.stringify({ 'sess-a': [took.events[0].key] }))).events, []);
  assert.deepEqual(boxes(), []);
  assert.deepEqual(await run(['put', '--session', 'sess-a'], JSON.stringify(took.events)), { put: 1 });
  assert.deepEqual(boxes(), ['sess-a.jsonl']);
  /* peek counts what waits and takes nothing */
  assert.equal((await run(['peek', '--session', 'sess-a'])).events[0].key, took.events[0].key);
  assert.deepEqual(boxes(), ['sess-a.jsonl']);
  assert.deepEqual((await run(['take', '--session', 'sess-a', '--id', 'Q2'])).events, []);
  assert.deepEqual(boxes(), ['sess-a.jsonl']);
  assert.equal((await run(['take', '--session', 'sess-a', '--id', 'Q1'])).events[0].key, took.events[0].key);
  assert.deepEqual(boxes(), []);
  /* take looks for its file by the inbox's own name */
  assert.deepEqual(await run(['put', '--session', 'sess a/1'], JSON.stringify(took.events)), { put: 1 });
  assert.equal((await run(['take', '--session', 'sess a/1'])).events.length, 1);
});
