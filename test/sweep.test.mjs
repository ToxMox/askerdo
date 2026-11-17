/* The session sweep: the digest of this PC's transcripts and the board scan. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { freshBoard } from './helpers/board-db.mjs';
import { tempDir } from './helpers/sandbox.mjs';

const { candidatesOf, digestSession, boardScan } = await import('../lib/sweep.mjs');
const { putRecord } = await import('../server/records.mjs');
const t = await import('../server/verbs/tracks.mjs');
const w = await import('../server/verbs/work.mjs');
const { runVerb } = await import('../server/verbs/index.mjs');

const line = (o) => JSON.stringify({ parentUuid: null, isSidechain: false, cwd: 'C:/work/app', ...o });
const said = (session, uuid, at, text) => line({ type: 'user', sessionId: session, uuid, timestamp: at, origin: { kind: 'human' }, message: { role: 'user', content: text } });
const reply = (session, uuid, at, text) => line({ type: 'assistant', sessionId: session, uuid, timestamp: at, message: { role: 'assistant', content: [{ type: 'text', text }] } });

test("a digest keeps the user's words and the session's own turns, skipping sidechains and turns copied from another session", async (t) => {
  const dir = tempDir('askerdo-sweep-', t);
  const a = join(dir, 'aaaa1111.jsonl');
  const b = join(dir, 'bbbb2222.jsonl');
  writeFileSync(a, [
    JSON.stringify({ type: 'custom-title', customTitle: 'Fix the band', sessionId: 'aaaa1111' }),
    said('aaaa1111', 'u1', '2026-11-07T10:00:00Z', 'The band clips at 238 px, and the tray icon looks wrong'),
    line({ type: 'user', isSidechain: true, sessionId: 'aaaa1111', uuid: 'x1', timestamp: '2026-11-07T10:00:30Z', message: { role: 'user', content: 'an agent prompt nobody typed' } }),
    reply('aaaa1111', 'r1', '2026-11-07T10:01:00Z', 'Fixed the clip.\nThe tray icon is not measured yet.\nTwo minutes later the band redrew.\nI will check the pane later.'),
  ].join('\n') + '\n');
  /* a side question copies its parent's history, which keeps the parent's ids */
  writeFileSync(b, [
    said('aaaa1111', 'u1', '2026-11-07T10:00:00Z', 'The band clips at 238 px, and the tray icon looks wrong'),
    said('bbbb2222', 'u2', '2026-11-07T11:00:00Z', 'Side question: does the pane clip too?'),
  ].join('\n') + '\n');

  const seen = new Set();
  const da = await digestSession({ id: 'aaaa1111', file: a, seen });
  const db = await digestSession({ id: 'bbbb2222', file: b, seen });
  assert.ok(da.text.includes('tray icon looks wrong') && da.title === 'Fix the band');
  assert.ok(!da.text.includes('nobody typed'), 'a sidechain stays out');
  assert.ok(db.text.includes('does the pane clip') && !db.text.includes('tray icon looks wrong'), 'the copied turn is left out of the second session');

  const c = candidatesOf([da, db]);
  assert.equal(c.user.length, 2, 'every message the user typed is kept');
  const lines = c.lines.map((l) => l.text);
  assert.ok(lines.some((l) => l.includes('not measured')) && lines.some((l) => l.includes('check the pane later')));
  assert.ok(!lines.some((l) => l.includes('Fixed the clip') || l.includes('minutes later')), 'a done line and a later that is no plan pass');
});

test('the board scan picks a closed task whose last note names something left and passes one that does not', async () => {
  const db = freshBoard();
  putRecord(db, { key: 'ws000001', kind: 'workstream', fields: { id: 'WS-1', key: 'ws000001', name: 'Board', status: 'open', projectRepos: ['github.com/u/app'], labelHistory: ['WS-1 2026-10-25'] }, body: '' });
  const s1 = { session: 's1' };
  const track = t.newTrack(db, { name: 'Draw the views', workstream: 'WS-1', session: 's1' }, s1);
  /* the user's own captures, which the board never asks about */
  const left = t.capture(db, { track: track.id, name: 'Draw the band' }, 'cli');
  const done = t.capture(db, { track: track.id, name: 'Draw the pane' }, 'cli');
  w.taskUpdate(db, { id: left.id, status: 'done', note: 'Drawn at 900 px; 238 px is not measured, left for the next pass.' }, s1);
  w.taskUpdate(db, { id: done.id, status: 'done', note: 'Drawn and checked at all four widths.' }, s1);
  /* a close that filed what it left passes, whatever its note says */
  const filed = t.capture(db, { track: track.id, name: 'Draw the tile' }, 'cli');
  w.taskUpdate(db, { id: filed.id, status: 'done', note: '238 px is not measured.', leftovers: [{ name: 'Measure the tile', description: 'At 238 px.', runBy: 'fork', tier: 2, last: 'nothing else is open on the track' }] }, s1);

  const call = async (name, input) => JSON.parse(JSON.stringify(runVerb(db, name, input, 'cli')));
  const scan = await boardScan(call, { track: track.id, sessions: [{ id: 's1', from: null, to: null }] });
  assert.equal(scan.checked, 3);
  assert.deepEqual(scan.closed.map((c) => c.id), [left.id]);
});
