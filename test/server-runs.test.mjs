/* Runs: the writers the run verbs build on. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { freshBoard } from './helpers/board-db.mjs';

const { putRecord, stampNow } = await import('../server/records.mjs');
const t = await import('../server/verbs/tracks.mjs');
const { runVerb } = await import('../server/verbs/index.mjs');
const { openRunSql } = await import('../server/verbs/runs.mjs');
const k = await import('../server/verbs/kickoff.mjs');

function board() {
  const db = freshBoard();
  putRecord(db, { key: 'ws000001', kind: 'workstream', fields: { id: 'WS-1', key: 'ws000001', name: 'Board', status: 'open', labelHistory: ['WS-1 2026-10-25'] }, body: '' });
  const tr = t.newTrack(db, { name: 'Line', workstream: 'WS-1' }, 'cli');
  const [a, b] = ['First', 'Second'].map((name) => t.capture(db, { track: tr.id, name }, 'cli'));
  return { db, a, b, tr };
}
const S1 = { session: 's1', pc: 'PC-A' };
const open = (db, key, sql = openRunSql(), ...args) => !!db.prepare(`SELECT ${sql} AS x FROM records WHERE key = ?`).get(...args, key).x;

test('an agent run on two tasks opens, renews, ends with its report, and reads back by session and by task', () => {
  const { db, a, b } = board();
  const r = runVerb(db, 'openRun', { tasks: [a.id, b.id], agentId: 'eng-1', job: 'lane-a', branch: 'lane-a', startCommit: 'abc1234' }, S1);
  assert.equal(r.opened, true);
  assert.deepEqual(r.run.tasks.map((x) => x.id), [a.id, b.id], 'one run serves both tasks');
  assert.deepEqual([open(db, a.key), open(db, b.key, openRunSql('key', { session: true, worker: 'agent' }), 's1'), open(db, a.key, openRunSql('key', { session: true }), 's2')],
    [true, true, false]);
  assert.equal(runVerb(db, 'openRun', { tasks: [a.id], agentId: 'eng-1', job: 'lane-a' }, S1).opened, false, 'a retried open gives back its run');
  assert.throws(() => runVerb(db, 'openRun', { tasks: [a.id], worker: 'agent' }, S1), /job/, 'an agent run needs its job');
  const later = { ...S1, now: new Date(Date.now() + 60000) };
  const renewed = runVerb(db, 'renewRuns', { agentIds: ['eng-1'] }, later);
  assert.deepEqual([renewed.runs.length, renewed.runs[0].agentId, renewed.runs[0].heard > renewed.runs[0].started], [1, 'eng-1', true]);
  assert.equal(db.prepare("SELECT count(*) AS n FROM activity WHERE verb = 'run'").get().n, 2, 'an open writes one line per task; a renewal none');
  const end = runVerb(db, 'endRun', { agentId: 'eng-1', how: 'finished', report: 'landed', continueLine: 'CONTINUE: none' }, S1);
  assert.deepEqual([end.ended, end.run.how, open(db, a.key)], [true, 'finished', false]);
  const again = runVerb(db, 'endRun', { run: end.run.run, how: 'failed', landed: 'def5678' }, S1);
  assert.deepEqual([again.ended, again.run.how, again.run.ended, again.run.landed], [false, 'finished', end.run.ended, 'def5678'], 'an ended run only takes what it lacked');
  assert.deepEqual(runVerb(db, 'sessionRuns', { session: 's1' }).runs, []);
  assert.deepEqual(runVerb(db, 'taskRuns', { task: b.id }).runs.map((x) => [x.run, x.report, x.continueLine]), [[end.run.run, 'landed', 'CONTINUE: none']]);
});

test('a lease renewal hears only the session\'s own runs and its live agents; an agent id resumes its tasks', () => {
  const { db, a, b, tr } = board();
  const own = runVerb(db, 'openRun', { tasks: [a.id] }, S1).run;
  const bare = runVerb(db, 'openRun', { tasks: [b.id], agentId: 'eng-2', job: 'lane-b' }, S1).run;
  const dead = runVerb(db, 'openRun', { tasks: [a.id], agentId: 'eng-3', job: 'lane-c' }, S1).run;
  const later = { ...S1, now: new Date(Date.now() + 60000) };
  const lease = runVerb(db, 'renewLease', { agentIds: ['eng-2'] }, later);
  const heard = new Map(lease.runs.map((r) => [r.run, r.heard > r.started]));
  assert.deepEqual([heard.get(own.run), heard.get(bare.run), heard.get(dead.run)], [true, true, false], 'an unlisted agent goes unheard');
  runVerb(db, 'endRun', { agentId: 'eng-2', how: 'handed_on' }, S1);
  const resumed = runVerb(db, 'openRun', { agentId: 'eng-2' }, S1);
  assert.deepEqual([resumed.opened, resumed.run.job, resumed.run.tasks.map((x) => x.id)], [true, 'lane-b', [b.id]], 'a resumed agent serves its last run\'s tasks');
  assert.throws(() => runVerb(db, 'openRun', { agentId: 'eng-9' }, S1), /eng-9/, 'an unknown agent id with no tasks is refused');
  /* a split task shows the lane still open after a later one ends */
  runVerb(db, 'openRun', { tasks: [a.id], agentId: 'eng-4', job: 'lane-d' }, later);
  runVerb(db, 'endRun', { agentId: 'eng-4', how: 'finished' }, later);
  assert.equal(runVerb(db, 'readRecord', a.id, S1).agent, 'lane-c');
  /* a move off the track lets go of the session's own runs there; its agents' stay */
  t.acquireLease(db, { track: tr.id }, S1);
  t.acquireLease(db, { track: t.newTrack(db, { name: 'Elsewhere', workstream: 'WS-1' }, 'cli').id }, S1);
  const how = new Map(runVerb(db, 'taskRuns', { task: a.id }).runs.map((r) => [r.run, r.ended ? r.how : 'open']));
  assert.deepEqual([how.get(own.run), how.get(dead.run)], ['handed_on', 'open']);
});

test('a task\'s word comes from its records and the clock alone, one row of the word table each', () => {
  const db = freshBoard();
  putRecord(db, { key: 'ws000001', kind: 'workstream', fields: { id: 'WS-1', key: 'ws000001', name: 'Board', status: 'open', labelHistory: ['WS-1 2026-10-25'] }, body: '' });
  const T0 = Date.parse('2026-11-14T12:00:00Z');
  const at = (min, more = {}) => ({ by: 'cli', session: 's1', pc: 'PC-A', now: new Date(T0 + min * 60000), ...more });
  const stamp = (min) => stampNow(new Date(T0 + min * 60000));
  const tr = t.newTrack(db, { name: 'Words', workstream: 'WS-1' }, at(0));
  const [run, quiet, edge, gate, start, cont, settle, done, dropped] = ['Run', 'Quiet', 'Edge', 'Gate', 'Start', 'Continue', 'Settle', 'Done', 'Dropped']
    .map((name) => t.capture(db, { track: tr.id, name }, at(0, { session: undefined })));
  const inbox = runVerb(db, 'createRecord', { kind: 'task', name: 'Inbox', description: 'd', workstream: 'WS-1', unplaced: 'no plan reaches it', wake: '2099-01-01' }, at(0, { session: undefined }));
  runVerb(db, 'openRun', { tasks: [run.id], agentId: 'eng-1', job: 'lane-r' }, at(0));
  runVerb(db, 'renewRuns', { agentIds: ['eng-1'] }, at(9));
  const quietRun = runVerb(db, 'openRun', { tasks: [quiet.id] }, at(0)).run;
  runVerb(db, 'renewRuns', { runs: [quietRun.run] }, at(6));
  runVerb(db, 'addEdge', { task: edge.id, on: run.id, reason: 'after the run' }, at(0));
  const q = (n, status, gates, closed = '') => putRecord(db, { key: 'q00000' + n, kind: 'question',
    fields: { id: 'Q' + n, key: 'q00000' + n, name: 'Which ' + n, status, gates, closed }, body: '' });
  q(91, 'open', [gate.key]);
  q(92, 'answered', [start.key], stamp(5));
  const c = runVerb(db, 'openRun', { tasks: [cont.id] }, at(0)).run;
  runVerb(db, 'endRun', { run: c.run, how: 'handed_on' }, at(2));
  runVerb(db, 'openRun', { tasks: [settle.id], agentId: 'eng-2', job: 'lane-z' }, at(0));
  runVerb(db, 'endRun', { agentId: 'eng-2', how: 'finished' }, at(3));
  runVerb(db, 'editRecord', { id: done.id, status: 'done' }, at(1));
  runVerb(db, 'editRecord', { id: dropped.id, status: 'dropped', reason: 'not needed' }, at(1));
  const word = (x) => runVerb(db, 'readRecord', x.id, at(10)).word;
  const pick = (x, ...keys) => { const v = word(x); return Object.fromEntries(['is', ...keys].map((k) => [k, v[k]])); };
  assert.deepEqual([pick(done), pick(dropped)], [{ is: 'done' }, { is: 'dropped' }]);
  assert.deepEqual(pick(run, 'worker', 'job', 'pc', 'since'), { is: 'running', worker: 'agent', job: 'lane-r', pc: 'PC-A', since: stamp(0) }, 'heard a minute ago');
  assert.deepEqual(pick(quiet, 'worker', 'session', 'pc', 'since'), { is: 'unconfirmed', worker: 'session', session: 's1', pc: 'PC-A', since: stamp(6) }, 'heard four minutes ago');
  assert.deepEqual([edge, gate, inbox].map((x) => { const v = word(x); return [v.is, v.on.join()]; }).map(([is, on], i) => [is, on.includes([run.id, 'Q91', '2099-01-01'][i])]),
    [['waiting', true], ['waiting', true], ['waiting', true]], 'on an edge, a gate and a wake');
  assert.deepEqual([pick(start, 'next', 'since'), pick(cont, 'next', 'since', 'session'), pick(settle, 'next', 'since', 'job')], [
    { is: 'ready', next: 'start', since: stamp(5) }, { is: 'ready', next: 'continue', since: stamp(2), session: 's1' },
    { is: 'ready', next: 'settle', since: stamp(3), job: 'lane-z' }], 'since its gate was answered, since its last run ended');
  const view = t.trackView(db, { track: tr.id }, at(10));
  assert.deepEqual([view.now.map((x) => x.id), view.readySet.map((x) => x.id), view.running, view.unconfirmed],
    [[run.id, quiet.id], [start.id, cont.id, settle.id], 1, 1], 'now and ready read the word, each task listed once');
  /* the picture's reads: the Overview counts the views' running and unconfirmed, a far task draws its word */
  const ov = runVerb(db, 'pictureOverview', {}, at(10)).ws.find((w) => w.id === 'WS-1');
  runVerb(db, 'openRun', { tasks: [inbox.id] }, at(10));
  runVerb(db, 'addEdge', { task: gate.id, on: inbox.id, reason: 'after the inbox task' }, at(10));
  const far = runVerb(db, 'pictureView', { workstream: 'WS-1' }, at(10)).far[inbox.id];
  assert.deepEqual([ov.running, ov.unconfirmed, 'landing' in ov, far.st, far.word.is], [1, 1, false, 'now', 'running']);
  /* no new run ends closed_idle, and a stored one still reads ready to continue, closed by the app */
  const idle = t.capture(db, { track: tr.id, name: 'Idle' }, at(10, { session: undefined }));
  const S3 = (min) => at(min, { session: 's3' });
  const idleRun = runVerb(db, 'openRun', { tasks: [idle.id] }, S3(10)).run;
  assert.throws(() => runVerb(db, 'endRun', { run: idleRun.run, how: 'closed_idle' }, S3(11)), /handed_on/);
  db.prepare("UPDATE runs SET ended = ?, how = 'closed_idle' WHERE id = ?").run(stamp(12), idleRun.run);
  assert.deepEqual(pick(idle, 'next', 'how', 'session'), { is: 'ready', next: 'continue', how: 'closed_idle', session: 's3' });
  const kick = k.kickoffText(k.kickoffInput(db, tr.key, null, at(13)));
  const left = kick.match(new RegExp(idle.id + ' Idle \\(([^)]*)\\)'));
  assert.ok(left && /closed by the app/.test(left[1]) && !/idle/.test(left[1]), kick);
});

test('another session\'s start on a running task is refused naming the run, and a take-over ends it as taken over', () => {
  const { db, a, b } = board();
  const first = runVerb(db, 'openRun', { tasks: [a.id] }, S1).run;
  assert.equal(runVerb(db, 'openRun', { tasks: [a.id] }, S1).run.run, first.run, 'the same session\'s second session run gives back the first');
  const S2 = { session: 's2', pc: 'PC-B' };
  assert.throws(() => runVerb(db, 'openRun', { tasks: [a.id], job: 'lane-b' }, S2), (e) => /PC-A/.test(e.message) && e.data.runs[0].run === first.run);
  const took = runVerb(db, 'openRun', { tasks: [a.id], job: 'lane-b', takeOver: true }, S2);
  assert.deepEqual([took.opened, took.ended.map((x) => [x.run, x.how])], [true, [[first.run, 'taken_over']]]);
  assert.deepEqual(runVerb(db, 'taskRuns', { task: a.id }).runs.map((x) => [x.session, x.ended ? x.how : 'open']), [['s2', 'open'], ['s1', 'taken_over']]);
  /* a close over that run is a take-over too: refused without the user's word */
  assert.throws(() => runVerb(db, 'taskUpdate', { id: a.id, status: 'done' }, S1), (e) => /take-over/.test(e.message) && e.data.runs[0].run === took.run.run);
  assert.equal(runVerb(db, 'readRecord', a.id, S1).status, 'open');
  runVerb(db, 'taskUpdate', { id: a.id, status: 'done', takeOver: true }, S1);
  assert.equal(runVerb(db, 'taskRuns', { task: a.id }).runs[0].how, 'taken_over');

  /* a /clear: the take that continues the earlier id moves its session run and leaves its agent's run open */
  runVerb(db, 'taskUpdate', { id: b.id, inHand: true }, S1);
  runVerb(db, 'openRun', { tasks: [b.id], agentId: 'ag-1', job: 'lane-c' }, S1);
  const S1b = { session: 's1b', pc: 'PC-A' };
  runVerb(db, 'taskUpdate', { id: b.id, inHand: true, takeOver: true, continues: 's1' }, S1b);
  const runsOf = () => runVerb(db, 'taskRuns', { task: b.id }).runs.map((x) => [x.worker, x.session, x.ended ? x.how : 'open']).sort();
  assert.deepEqual(runsOf(), [['agent', 's1', 'open'], ['session', 's1', 'taken_over'], ['session', 's1b', 'open']]);
  const rows = db.prepare("SELECT diff FROM activity WHERE verb = 'run' ORDER BY seq DESC").all().map((r) => JSON.parse(r.diff));
  for (const row of [rows.find((d) => d.how), rows.find((d) => !d.how)]) assert.deepEqual(row.continues, [null, 's1'], 'the end and the open both say the same session goes on');
  /* a plain take-over ends every other session's run, the agent's included */
  runVerb(db, 'taskUpdate', { id: b.id, inHand: true, takeOver: true }, { session: 's3', pc: 'PC-B' });
  assert.deepEqual(runsOf().filter((r) => r[2] === 'open'), [['session', 's3', 'open']]);
});
