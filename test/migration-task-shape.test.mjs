import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { tempDir } from './helpers/sandbox.mjs';

const { openDb } = await import('../server/db.mjs');
const { migrate, migrations } = await import('../server/migrate.mjs');
const { insertStep, itemsOf } = await import('../server/verbs/graph.mjs');
const { taskRuns } = await import('../server/verbs/runs.mjs');
const { readRecord } = await import('../server/verbs/work.mjs');

test('migration 015 numbers a schema 14 board\'s steps by place, keeps their marks, renames completed to done and writes its runs', () => {
  const dir = tempDir('askerdo-store-');
  for (const m of migrations().filter((x) => x.n <= 14)) copyFileSync(m.file, join(dir, basename(m.file)));
  const old = openDb(':memory:');
  migrate(old, { dir });
  const ins = (sql, ...v) => old.prepare(sql).run(...v);
  ins('INSERT INTO records (key, kind, fields) VALUES (?, ?, ?)', 'aaaaaaaa', 'task', JSON.stringify({ id: 'T-1', name: 'a', status: 'open' }));
  ins('INSERT INTO records (key, kind, fields) VALUES (?, ?, ?)', 'bbbbbbbb', 'task', JSON.stringify({ id: 'T-2', name: 'b', status: 'completed', priority: 'low', closed: '2026-11-01T12:00:00+00:00', agent: 'lane-old' }));
  /* positions with a gap, as a deleted row once left them */
  ins("INSERT INTO checklist (task, position, text, done, done_at) VALUES ('aaaaaaaa', 0, 'open one', 0, NULL), ('aaaaaaaa', 2, 'done one', 1, '2026-11-01T10:00:00+00:00'), ('aaaaaaaa', 5, 'struck one', 1, '2026-11-02T10:00:00+00:00 struck: not needed')");
  /* the four kinds of run, one task carrying an agent and a hand */
  const task = (key, id, f) => ins('INSERT INTO records (key, kind, fields) VALUES (?, ?, ?)', key, 'task', JSON.stringify({ id, name: id, status: 'in_progress', ...f }));
  const row = (key, changes, by, pc, ts) => ins('INSERT INTO activity (line, pc) VALUES (?, ?)', JSON.stringify({ ts, verb: 'edit', kind: 'task', key, changes, by }), pc);
  task('cccccccc', 'T-3', { agent: 'lane-x', agentEnd: { job: 'lane-x', how: 'stopped', at: '2026-11-03T10:00:00+00:00' }, updated: '2026-11-03T10:00:00+00:00' });
  row('cccccccc', { status: ['open', 'in_progress'], agent: [null, 'lane-x'] }, 'session:s9', 'PC-A', '2026-11-02T09:00:00+00:00');
  task('dddddddd', 'T-4', { agent: 'lane-y', inHand: 's1', inHandSince: '2026-11-04T08:00:00+00:00', updated: '2026-11-04T09:00:00+00:00' });
  ins('INSERT INTO records (key, kind, fields) VALUES (?, ?, ?)', 'eeeeeeee', 'track', JSON.stringify({ id: 'TR-1', name: 'line', status: 'open' }));
  ins("INSERT INTO leases (track, session, pc, since, seen) VALUES ('eeeeeeee', 's1', 'PC-B', '2026-11-04T08:00:00+00:00', '2026-11-05T12:00:00+00:00')");
  task('ffffffff', 'T-5', { updated: '2026-11-06T10:00:00+00:00' });
  /* an ended task's agent from before end marks keeps its go as an ended run */
  row('bbbbbbbb', { agent: [null, 'lane-old'] }, 'session:s5', 'PC-C', '2026-10-31T09:00:00+00:00');
  row('ffffffff', { status: ['open', 'in_progress'] }, 'session:s7', null, '2026-11-06T09:00:00+00:00');
  /* blocked keeps its note and gets a line its holder hears; deferred keeps its wake */
  task('gggggggg', 'T-6', { status: 'blocked' });
  ins("INSERT INTO notes (record, position, at, actor, body) VALUES ('gggggggg', 0, '2026-11-07T09:00:00+00:00', 'session:s2', 'waits on the vendor')");
  task('hhhhhhhh', 'T-7', { status: 'deferred', wake: { date: '2026-12-01' } });
  /* an open promoted side track of two tasks, one done, and its pointer on TR-1 */
  ins('INSERT INTO records (key, kind, fields) VALUES (?, ?, ?)', 'pppppppp', 'task', JSON.stringify({ id: 'T-8', name: 'big', status: 'open' }));
  ins('INSERT INTO records (key, kind, fields) VALUES (?, ?, ?)', 'ssssssss', 'track', JSON.stringify({ id: 'TR-2', name: 'big side', status: 'open', origin: 'promote', goal: 'g' }));
  task('qqqqqqqq', 'T-9', { status: 'completed' });
  task('rrrrrrrr', 'T-10', { status: 'open' });
  ins("INSERT INTO track_items (track, task, position) VALUES ('eeeeeeee', 'pppppppp', 1), ('ssssssss', 'qqqqqqqq', 1), ('ssssssss', 'rrrrrrrr', 2)");
  ins("INSERT INTO links (\"from\", \"to\", type, added) VALUES ('ssssssss', 'eeeeeeee', 'junction', '2026-11-01'), ('ssssssss', 'pppppppp', 'junction', '2026-11-01')");
  migrate(old);
  const pointer = readRecord(old, 'T-8').word;
  assert.deepEqual([pointer.is, pointer.on], ['waiting', ['after T-10 on TR-2']], 'the pointer is a closing task waiting on its open part');
  assert.deepEqual(old.prepare("SELECT \"on\" FROM depends WHERE task = 'pppppppp' ORDER BY \"on\"").all().map((r) => r.on), ['qqqqqqqq', 'rrrrrrrr']);
  assert.equal(JSON.parse(old.prepare("SELECT fields FROM records WHERE key = 'ssssssss'").get().fields).origin, undefined);
  assert.equal(old.prepare("SELECT count(*) AS n FROM links WHERE \"from\" = 'ssssssss' AND type = 'junction'").get().n, 2, 'the junction links stay');
  const stored = old.prepare("SELECT count(*) AS n FROM records WHERE kind = 'task' AND status NOT IN ('open', 'done', 'dropped')").get().n;
  assert.equal(stored, 0, 'a task stores open, done or dropped only');
  assert.deepEqual(['T-3', 'T-4', 'T-5', 'T-6', 'T-7'].map((id) => { const r = readRecord(old, id); return r.status + ' ' + ['running', 'unconfirmed'].includes(r.word.is); }),
    ['open false', 'open true', 'open false', 'open false', 'open false'], 'a run reads open only where one is');
  assert.equal(old.prepare("SELECT count(*) AS n FROM notes WHERE record = 'gggggggg'").get().n, 1);
  const blocked = old.prepare("SELECT line FROM activity WHERE record = 'gggggggg'").all().map((r) => JSON.parse(r.line));
  assert.equal(blocked.length, 1);
  assert.deepEqual([blocked[0].verb, blocked[0].changes.status, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/.test(blocked[0].ts)], ['edit', ['blocked', 'open'], true]);
  const waits = readRecord(old, 'T-7', { now: new Date('2026-11-20T12:00:00Z') }).word;
  assert.deepEqual([waits.is, waits.on.join().includes('2026-12-01')], ['waiting', true], 'the deferred task waits on its wake');
  const runs = (key) => taskRuns(old, { task: key }).runs.map((r) => [r.worker, r.job, r.session, r.pc, r.started, r.heard, r.how]);
  assert.deepEqual(runs('cccccccc'), [['agent', 'lane-x', 's9', 'PC-A', '2026-11-02T09:00:00+00:00', '2026-11-03T10:00:00+00:00', 'handed_on']]);
  assert.deepEqual(runs('dddddddd'), [
    ['agent', 'lane-y', null, null, '2026-11-04T09:00:00+00:00', '2026-11-04T09:00:00+00:00', null],
    ['session', null, 's1', null, '2026-11-04T08:00:00+00:00', '2026-11-05T12:00:00+00:00', null],
  ]);
  assert.deepEqual(runs('bbbbbbbb'), [['agent', 'lane-old', 's5', 'PC-C', '2026-10-31T09:00:00+00:00', '2026-11-01T12:00:00+00:00', 'finished']]);
  assert.deepEqual(runs('ffffffff'), [['session', null, 's7', null, '2026-11-06T09:00:00+00:00', '2026-11-06T10:00:00+00:00', 'handed_on']]);
  assert.deepEqual(taskRuns(old, { task: 'aaaaaaaa' }).runs, [], 'an open task with nobody on it has no run');
  assert.deepEqual(itemsOf(old, 'aaaaaaaa').map((s) => [s.n, s.text, s.done, s.doneAt, s.struck ?? null]), [
    [1, 'open one', false, null, null],
    [2, 'done one', true, '2026-11-01T10:00:00+00:00', null],
    [3, 'struck one', true, '2026-11-02T10:00:00+00:00', 'not needed'],
  ]);
  assert.equal(insertStep(old, 'aaaaaaaa', { text: 'added after' }), 4);
  const f = JSON.parse(old.prepare("SELECT fields FROM records WHERE key = 'bbbbbbbb'").get().fields);
  assert.deepEqual(Object.keys(f), ['id', 'name', 'status', 'priority', 'closed']);
  /* who is on a task leaves its fields and reads from its runs through the verbs */
  const four = old.prepare(`SELECT count(*) AS n FROM records WHERE kind = 'task' AND (json_type(fields, '$.inHand') IS NOT NULL
    OR json_type(fields, '$.inHandSince') IS NOT NULL OR json_type(fields, '$.agent') IS NOT NULL OR json_type(fields, '$.agentEnd') IS NOT NULL)`).get().n;
  assert.equal(four, 0);
  assert.equal(old.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'records_in_hand'").get().n, 0);
  const t4 = readRecord(old, 'T-4');
  assert.deepEqual([t4.inHand, t4.agent, readRecord(old, 'T-3').agent], ['s1', 'lane-y', 'lane-x']);
  assert.equal(old.prepare("SELECT status FROM records WHERE key = 'bbbbbbbb'").get().status, 'done');
  assert.equal(old.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'checklist'").get().n, 0);
});
