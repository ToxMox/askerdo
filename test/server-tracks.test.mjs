/* Tracks and the task graph on the board server: one test per
   behaviour a mistake would break for the user. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { freshBoard } from './helpers/board-db.mjs';

const { putRecord, addNote } = await import('../server/records.mjs');
const g = await import('../server/verbs/graph.mjs');
const t = await import('../server/verbs/tracks.mjs');
const w = await import('../server/verbs/work.mjs');
const { importStore } = await import('../server/import.mjs');
const { exportStore, storeFiles } = await import('../server/render.mjs');
const { tempDir } = await import('./helpers/sandbox.mjs');
const u = await import('../server/verbs/upkeep.mjs');
const q = await import('../server/verbs/questions.mjs');
const { graphOf, viewLook } = await import('../server/web/graph.mjs');
const { runVerb } = await import('../server/verbs/index.mjs');
const { reviewLine } = await import('../server/handoff-text.mjs');
const k = await import('../server/verbs/kickoff.mjs');
const { endRun, openRun, taskRuns } = await import('../server/verbs/runs.mjs');
const { decide } = await import('../server/verbs/decisions.mjs');
const { APPROVED } = await import('../server/verbs/placement-seam.mjs');

function board() {
  const db = freshBoard();
  putRecord(db, { key: 'ws000001', kind: 'workstream', fields: { id: 'WS-1', key: 'ws000001', name: 'Board', status: 'open', labelHistory: ['WS-1 2026-10-25'] }, body: '' });
  return db;
}
const task = (db, track, name) => t.capture(db, { track, name }, 'cli');
const complete = (db, key) => db.prepare("UPDATE records SET fields = json_set(fields, '$.status', 'done') WHERE key = ?").run(key);
const lastLine = (db, key) => JSON.parse(db.prepare('SELECT line FROM activity WHERE record = ? ORDER BY seq DESC LIMIT 1').get(key).line);
/* every inbox filing names its wake */
const LATER = '2099-01-01';

test('splinter parks the parent with its junction, moves the lease, and finishing hands the junction back', () => {
  const db = board();
  const parent = t.newTrack(db, { name: 'Main line', workstream: 'WS-1', session: 's1' }, { session: 's1' });
  const at = task(db, parent.id, 'Where the idea came');
  w.taskUpdate(db, { id: at.id, inHand: true }, { session: 's1' });
  const side = t.splinter(db, { from: parent.id, name: 'The new idea' }, { session: 's1' });

  assert.equal(side.at, at.id, 'the task it left from defaults to the one running');
  const p = t.trackSummary(db, { track: parent.id });
  assert.equal(p.state, 'parked');
  assert.ok(p.parkReason.includes(side.id) && p.parkReason.includes(at.id), 'the reason names the side track and the task');
  assert.equal(t.trackSummary(db, { track: side.id }).state, 'active', 'the lease moved with the session');
  const chain = t.chainOf(db, side.key);
  assert.deepEqual(chain.tracks, [side.id, parent.id]);
  assert.equal(chain.parked, 1);

  const done = t.finishTrack(db, { track: side.id }, { session: 's1' });
  assert.equal(done.junction.track.id, parent.id);
  assert.equal(done.junction.task.id, at.id);
  assert.ok(!done.junction.closed, 'a parked parent is a way back');
  assert.ok(done.sweep.includes(side.id), "a finish offers a sweep of the track's sessions");

  /* a branch keeps the parent open with its lease, and the side's first task waits on the junction */
  const main = t.newTrack(db, { name: 'Second line', workstream: 'WS-1', session: 's2' }, { session: 's2' });
  const junction = task(db, main.id, 'Where the area splits');
  const [first, next] = ['Area first', 'Area next'].map((n) => task(db, main.id, n));
  g.addEdge(db, { task: next.id, on: first.id, reason: 'in order' }, 'cli');
  /* carrying tasks off the held track is the user's own command; a session's call is refused naming the place call */
  assert.throws(() => t.splinter(db, { from: main.id, name: 'An area', tasks: [first.id] }, { session: 's2' }), (e) => e.data.tasks[0] === first.id && /task edit/.test(e.message));
  const area = t.splinter(db, { from: main.id, name: 'An area', at: junction.id, tasks: [first.id, next.id], park: false }, { session: 's2', user: 's2' });
  assert.deepEqual([t.trackSummary(db, { track: main.id }).state, t.trackSummary(db, { track: area.id }).state], ['active', 'new']);
  assert.deepEqual(area.tied, [first.id], 'only the first station waits on the junction');
  assert.equal(g.readiness(db, first.key).ready, false);
  complete(db, junction.key);
  assert.equal(g.readiness(db, first.key).ready, true);

  /* a closed parent takes no resume; a close lists the inbox it leaves */
  const loose = t.capture(db, { workstream: 'WS-1', name: 'Unplaced idea', wake: LATER }, 'cli');
  t.finishTrack(db, { track: main.id }, { session: 's2' });
  assert.throws(() => t.finishTrack(db, { track: area.id, leftovers: 'inbox', wake: LATER }, { session: 's2' }), /leftovers inbox/);
  const closed = t.finishTrack(db, { track: area.id, leftovers: 'inbox', wake: LATER }, { session: 's2', user: 's2' });
  assert.equal(closed.junction.track.id, main.id);
  assert.ok(closed.junction.closed);
  assert.deepEqual(closed.junction.open.map((x) => x.id), [parent.id], 'the open tracks stand in for the resume');
  assert.deepEqual(closed.inbox.map((x) => x.id).sort(), [loose.id, first.id, next.id].sort());
});

test('a second session is refused a held track and told who holds it; a take over tells the first', () => {
  const db = board();
  /* an import's track: its label and row ref from birth, and no lease taken */
  const tr = t.newTrack(db, { name: 'Held line', workstream: 'WS-1', labels: ['import:demo'], refs: ['onboard:track:a'] }, 'cli');
  const listed = t.listTracks(db, { workstream: 'WS-1' }).tracks[0];
  assert.deepEqual([listed.labels, listed.refs, listed.state], [['import:demo'], ['onboard:track:a'], 'new']);
  assert.equal(t.acquireLease(db, { track: tr.id }, { session: 's1', pc: 'pc1', now: '2026-01-01T00:00:00Z' }).acquired, true);
  const second = t.acquireLease(db, { track: tr.id }, { session: 's2' });
  assert.equal(second.acquired, false);
  assert.equal(second.holder.session, 's1');
  assert.equal(second.holder.pc, 'pc1');
  assert.deepEqual([...second.moves].sort(), ['read only', 'splinter', 'take over']);

  /* the view says the user's hold made since the take, and one made before a later take no longer holds */
  decide(db, { title: 'Hold the line', words: 'hold it', labels: ['hold'], tracks: [tr.id], global: true }, { session: 's1', now: '2026-01-02T00:00:00Z' });
  assert.ok(t.trackView(db, { track: tr.id }).hold, 'a hold since the take sets the field');
  /* a /clear's take continues the holder's own earlier id: the same session goes on, so the hold still counts */
  t.takeOver(db, { track: tr.id, continues: 's1' }, { session: 's1b', now: '2026-01-02T12:00:00Z' });
  assert.deepEqual([t.trackView(db, { track: tr.id }).holder.session, Boolean(t.trackView(db, { track: tr.id }).hold)], ['s1b', true]);
  /* naming an id that is not the holder's changes nothing */
  t.takeOver(db, { track: tr.id, continues: 's1' }, { session: 's2', now: '2026-01-03T00:00:00Z' });
  assert.deepEqual(lastLine(db, tr.key).changes.session, ['s1b', 's2'], 'the row the first session hears it from');
  assert.equal(t.trackView(db, { track: tr.id }).hold, undefined, 'a hold made before the take does not');
});

test('a dependency loop is refused at write and nothing is written', () => {
  const db = board();
  const tr = t.newTrack(db, { name: 'Loop line', workstream: 'WS-1' }, 'cli');
  const [a, b, c] = ['A', 'B', 'C'].map((n) => task(db, tr.id, n));
  g.addEdge(db, { task: b.id, on: a.id, reason: 'b needs a' }, 'cli');
  g.addEdge(db, { task: c.id, on: b.id, reason: 'c needs b' }, 'cli');
  assert.throws(() => g.addEdge(db, { task: a.id, on: c.id, reason: 'wrong' }, 'cli'),
    (e) => e instanceof g.TrackRefusal && e.data.loop.includes(b.id));
  assert.equal(db.prepare('SELECT count(*) AS n FROM depends').get().n, 2);
  assert.throws(() => g.addEdge(db, { task: b.id, on: c.id }, 'cli'), (e) => e instanceof g.TrackRefusal && /reason/.test(e.message), 'an edge needs a reason, and says so');

  /* a layout's after numbers are edges, a name already open on the track is that task, and a loop writes nothing */
  const laid = t.layOut(db, { track: tr.id, steps: [{ name: 'D' }, { name: '  c ', after: [1] }, { name: 'E', after: [2, a.id] }] }, 'cli');
  assert.deepEqual(laid.steps.map((s) => [s.created, s.edges.map((e) => e.on)]), [[true, []], [false, [laid.steps[0].id]], [true, [c.id, a.id]]]);
  assert.equal(laid.steps[1].id, c.id, 'no second task named C');
  const count = (q) => db.prepare(q).get().n;
  const before = [count('SELECT count(*) AS n FROM depends'), count("SELECT count(*) AS n FROM records WHERE kind = 'task'")];
  /* the refusal names the step by its number and name, not by the id the rollback frees */
  assert.throws(() => t.layOut(db, { track: tr.id, steps: [{ name: 'F', after: [c.id] }, { name: 'A', after: [1] }] }, 'cli'),
    (e) => e instanceof g.TrackRefusal && e.data.loop.includes(b.id) && /^step 2\b/.test(e.message) && e.message.includes('"A"'));
  assert.deepEqual([count('SELECT count(*) AS n FROM depends'), count("SELECT count(*) AS n FROM records WHERE kind = 'task'")], before, 'F was not written either');

  /* a step's before makes each task named wait on it; a before that closes a loop refuses as after does */
  const lead = t.layOut(db, { track: tr.id, steps: [{ name: 'G', before: [b.id] }] }, 'cli').steps[0];
  assert.ok(g.readiness(db, b.key).waitsOn.some((x) => x.includes(lead.id)));
  assert.throws(() => t.layOut(db, { track: tr.id, steps: [{ name: 'H', after: [c.id], before: [a.id] }] }, 'cli'),
    (e) => e instanceof g.TrackRefusal && e.data.loop.includes(b.id));
});

test('the ready set leaves out a task an open question gates, and starting a task that is not ready takes a reason', () => {
  const db = board();
  const tr = t.newTrack(db, { name: 'Ready line', workstream: 'WS-1' }, 'cli');
  const [a, b, c] = ['A', 'B', 'C'].map((n) => task(db, tr.id, n));
  g.addEdge(db, { task: b.id, on: a.id, reason: 'b needs a' }, 'cli');
  const q = { key: 'q0000093', kind: 'question', fields: { id: 'Q93', key: 'q0000093', name: 'Which way', status: 'open', gates: [c.key] }, body: '' };
  putRecord(db, q);

  const view = g.trackGraph(db, tr.key);
  assert.deepEqual(view.ready.map((x) => x.id), [a.id]);
  assert.ok(view.tasks.find((x) => x.id === c.id).waitsOn.some((w) => w.includes('Q93')));
  assert.ok(view.tasks.find((x) => x.id === b.id).waitsOn.some((w) => w.includes(a.id)));
  const s = t.trackSummary(db, { track: tr.id });
  assert.deepEqual([s.running, s.ready, s.toGo], [0, 1, 2]);

  putRecord(db, { ...q, fields: { ...q.fields, status: 'answered' } });
  assert.deepEqual(g.trackGraph(db, tr.key).ready.map((x) => x.id), [a.id, c.id]);
  t.reorder(db, { task: c.id, before: a.id, reason: 'the user wants it first' }, 'cli');
  assert.deepEqual(g.trackGraph(db, tr.key).ready.map((x) => x.id), [c.id, a.id], 'a reorder moves it in the track order');

  /* the refusal names each wait with its short name */
  assert.throws(() => w.taskUpdate(db, { id: b.id, inHand: true }, { session: 's1' }), (e) => /not ready/.test(e.message) && e.message.includes(a.id + ' A'));
  /* in progress is no stored status; the refusal names the calls that start a run */
  for (const call of [() => w.editRecord(db, { id: b.id, status: 'in_progress' }, 'cli'), () => w.taskUpdate(db, { id: b.id, status: 'in_progress' }, { session: 's1' })]) {
    assert.throws(call, (e) => e instanceof w.UsageError && /in hand/.test(e.message) && /agent/.test(e.message));
  }
  assert.throws(() => w.taskUpdate(db, { id: b.id, inHand: true, reason: 'loose', priority: 'urgent' }, { session: 's1' }), /priority/);
  assert.equal(g.readiness(db, b.key).status, 'open', 'a refused update writes none of its parts, the start included');
  assert.throws(() => w.editRecord(db, { id: b.id, inHand: true }, { session: 's1' }), /not ready/, 'taking it in hand asks the graph too');
  w.editRecord(db, { id: b.id, inHand: true, reason: 'pairing on it' }, { session: 's1' });
  assert.match(lastLine(db, b.key).note, /pairing on it/);
  assert.deepEqual([w.readRecord(db, b.id).word.is, w.readRecord(db, b.id).status, g.loadRecord(db, b.key).fields.status], ['running', 'open', 'open'],
    'a take reads running and stores no status');
  /* a dispatch onto another session's run is refused naming the run; a take-over ends that run */
  const dispatch = (input, session) => openRun(db, { worker: 'agent', ...input }, { session });
  assert.throws(() => dispatch({ tasks: [b.id], agentId: 'a-1', job: 'implementer' }, 's2'),
    (e) => /another session's open run \d+/.test(e.message) && e.data.runs[0].session === 's1');
  dispatch({ tasks: [b.id], agentId: 'a-1', job: 'implementer', takeOver: true }, 's2');
  assert.deepEqual(taskRuns(db, { task: b.id }).runs.map((r) => [r.worker, r.session, r.how]), [['agent', 's2', null], ['session', 's1', 'taken_over']]);
  w.taskUpdate(db, { id: b.id, inHand: true, takeOver: true }, { session: 's1' });
  dispatch({ tasks: [b.id], agentId: 'a-2', job: 'implementer' }, 's1');
  assert.deepEqual(g.trackGraph(db, tr.key).now.map((x) => [x.id, x.agent]), [[b.id, 'implementer']]);
  /* an open run not heard inside the window reads unconfirmed, by the clock alone */
  const tv = (opts) => t.trackView(db, { track: tr.id }, opts);
  const late = { now: new Date(Date.now() + 4 * 60000) };
  assert.deepEqual([tv().running, tv(late).running, tv(late).unconfirmed, tv(late).now.map((x) => x.word.is)], [1, 0, 1, ['unconfirmed']]);
  assert.equal(graphOf([tv(late)], Date.now(), viewLook()).D.tasks[b.id].kind, 'left', 'the picture draws it as unconfirmed');
  w.editRecord(db, { id: b.id, priority: 'high' }, 'cli');
  const keys = Object.keys(JSON.parse(db.prepare('SELECT fields FROM records WHERE key = ?').get(b.key).fields));
  assert.ok(!keys.some((x) => ['inHand', 'inHandSince', 'agent', 'agentEnd'].includes(x)), 'who is on it is its runs, never a field');
  /* the dispatching session ends its agent's run; another session cannot; a stopped agent leaves it ready to continue */
  g.removeEdge(db, { task: b.id, on: a.id, reason: 'the edge was loose' }, 'cli');
  w.editRecord(db, { id: b.id, letGo: true }, { session: 's1' });
  assert.throws(() => endRun(db, { agentId: 'a-2', how: 'handed_on' }, { session: 's2' }), /no run of this session/);
  endRun(db, { agentId: 'a-2', how: 'handed_on' }, { session: 's1' });
  const stopped = tv();
  assert.deepEqual([stopped.now.length, stopped.tasks.find((x) => x.id === b.id).word.next, stopped.tasks.find((x) => x.id === b.id).agent], [0, 'continue', 'implementer'],
    'a task whose agent stopped is not in now: it is ready to continue');
  dispatch({ agentId: 'a-2' }, 's1');
  assert.deepEqual(g.trackGraph(db, tr.key).now.map((x) => [x.word.is, x.agent]), [['running', 'implementer']], 'the agent resumed runs again');
  /* an agent done with a step open leaves ready work for the track's session */
  g.addItem(db, { task: b.id, text: 'wire the pane' }, 'cli');
  endRun(db, { agentId: 'a-2', how: 'finished' }, { session: 's1' });
  /* an isolated agent's worktree, known only from its result, reaches its ended run */
  const placed = endRun(db, { agentId: 'a-2', place: { repo: '/wt/a-2', branch: 'worktree-a-2' } }, { session: 's1' }).run;
  assert.deepEqual([placed.repo, placed.branch, placed.how], ['/wt/a-2', 'worktree-a-2', 'finished']);
  const left = tv();
  assert.deepEqual([left.readySet.some((x) => x.id === b.id), /finished/.test(left.text), graphOf([left], Date.now(), viewLook()).D.tasks[b.id].kind],
    [true, false, 'ready'], left.text);
  assert.ok(!left.now.some((x) => x.id === b.id), 'sent as ready alone, so an older plugin never reads it as landing');
  /* taken in hand again, the agent's mark goes: the open run is the session's, its step open */
  w.editRecord(db, { id: b.id, inHand: true }, { session: 's1' });
  const own = g.trackGraph(db, tr.key).now.find((x) => x.id === b.id);
  assert.deepEqual([own.agent, own.session, own.word.is], [undefined, 's1', 'running']);
  dispatch({ tasks: [b.id], agentId: 'a-3', job: 'implementer-2' }, 's1');
  assert.equal(g.trackGraph(db, tr.key).now[0].agent, 'implementer-2', 'its agent before its session on a tie');
  /* the Overview's agents running leaves out a task the session itself holds */
  w.editRecord(db, { id: c.id, inHand: true }, { session: 's1' });
  const counts = graphOf([tv()], Date.now(), viewLook()).D.tracks[tv().id];
  assert.deepEqual([counts.running, counts.agents], [2, 1]);
});

/* The weekly export is the rollback: a track's tasks, edges, checklists and
   junction come back from its file, and the files come back byte for byte. */
test('a track file carries its tasks, edges, checklists and junction through an export and an import', (tt) => {
  const db = board();
  const tr = t.newTrack(db, { name: 'Main line', workstream: 'WS-1', session: 's1' }, { session: 's1' });
  const a = task(db, tr.id, 'First');
  const b = task(db, tr.id, 'Second');
  const loose = t.capture(db, { workstream: 'WS-1', name: 'In the inbox', wake: LATER }, 'cli');
  g.addEdge(db, { task: b.id, on: a.id, reason: 'b needs a' }, 'cli');
  g.addEdge(db, { task: loose.id, on: b.id, reason: 'after the line' }, 'cli');
  for (const s of ['one', 'two']) g.addItem(db, { task: a.id, text: s }, 'cli');
  g.addItem(db, { task: loose.id, text: 'inbox step' }, 'cli');
  /* a step keeps its number through an add in front and a move, and a tick by number hits that step */
  g.addItem(db, { task: a.id, text: 'zero', at: 1 }, 'cli');
  g.moveItem(db, { task: a.id, item: 2, to: 1 }, 'cli');
  g.checkItem(db, { task: a.id, item: 1 }, 'cli');
  g.settleChecks(db, a.id, { done: [{ step: 2, word: 'measured' }], strike: [{ step: 3, why: 'not needed' }] }, 'cli');
  assert.deepEqual(g.itemsOf(db, a.key).map((s) => [s.n, s.text, s.done, s.word || s.struck || null]),
    [[2, 'two', true, 'measured'], [3, 'zero', true, 'not needed'], [1, 'one', true, null]]);
  /* a checklist write moves the task's updated time, and an edit that changed nothing else names the checklist */
  const later = { by: 'cli', now: new Date(Date.now() + 86400e3) };
  const same = runVerb(db, 'taskUpdate', { id: b.id, priority: 'high', checks: { add: ['three'] } }, 'cli');
  const again = runVerb(db, 'taskUpdate', { id: b.id, priority: 'high', checks: { add: ['four'] } }, later);
  assert.deepEqual([same.edit.changed.length > 0, again.edit.changed, again.edit.checklist, Math.abs(Date.parse(runVerb(db, 'readRecord', b.id, null).updated) - later.now.getTime()) < 1000],
    [true, [], 'added 1', true]);
  const side = t.splinter(db, { from: tr.id, name: 'Side idea', at: a.id }, { session: 's1' });
  /* a run on two tasks, one in the inbox, is exported once and keeps its number */
  const run = runVerb(db, 'openRun', { tasks: [b.id, loose.id], job: 'lane-a', agentId: 'eng-1' }, { session: 's1' }).run.run;
  runVerb(db, 'endRun', { run, how: 'handed_on', continueLine: 'CONTINUE: the next step' }, { session: 's1' });

  const dir = join(tempDir('askerdo-store-', tt), 'export');
  exportStore(db, dir);
  const back = freshBoard();
  importStore(back, dir);
  const rows = (d) => ['SELECT track, task, position FROM track_items ORDER BY task', 'SELECT task, "on", reason, added, actor FROM depends ORDER BY task, "on"',
    'SELECT task, n, position, text, state, word, at FROM steps ORDER BY task, n', 'SELECT task, top FROM step_tops ORDER BY task', 'SELECT "from", "to", type, added FROM links ORDER BY "from", "to", type', 'SELECT * FROM runs ORDER BY id', 'SELECT run, task FROM run_tasks ORDER BY run, task']
    .map((q) => d.prepare(q).all().map((r) => ({ ...r })));
  assert.deepEqual(rows(back), rows(db));
  assert.equal(t.trackSummary(back, { track: side.id }).chain, t.trackSummary(db, { track: side.id }).chain);
  const files = (d) => [...storeFiles(d)].sort((x, y) => (x.path < y.path ? -1 : 1));
  assert.deepEqual(files(back), files(db));
});


/* a park condition is data the ending writes act on. */
test('a parked line unparks when the line or the question its condition names ends, and stays parked with upkeep off', () => {
  const db = board();
  const line = (name) => t.newTrack(db, { name, workstream: 'WS-1' }, 'cli');
  u.upkeepSwitch(db, { on: true }, 'cli');
  const [api, docks, asked] = ['API lane', 'Docks', 'Waits on an answer'].map(line);
  t.parkTrack(db, { track: docks.id, reason: 'after the API lane', unparkWhen: 'track-ends ' + api.id }, 'cli');
  const ask = q.register(db, { name: 'which shape', gist: 'One or two?', projectDir: 'C:/repo', session: 's1', blocking: false, ask: 'One (a) or two (b)?',
    options: [{ type: 'a', option: 'one' }, { type: 'b', option: 'two' }] }, null);
  t.parkTrack(db, { track: asked.id, reason: 'waits on the answer', unparkWhen: { kind: 'question-answered', on: ask.key } }, 'cli');
  assert.throws(() => t.parkTrack(db, { track: asked.id, reason: 'x', unparkWhen: 'task-completes ' + api.id }, 'cli'), /task/, 'the condition names a record of its kind');
  /* the rows the board hands out say what opens a parked line again, by name */
  const rows = t.listTracks(db, { workstream: 'WS-1' }).tracks;
  const unpark = (id) => rows.find((r) => r.id === id).unpark;
  assert.ok(unpark(asked.id).includes(ask.id + ' which shape') && t.trackView(db, { track: docks.id }).unpark.includes('API lane'), unpark(asked.id));
  assert.equal(unpark(api.id), undefined, 'absent on a line that is not parked');

  t.finishTrack(db, { track: api.id }, 'cli');
  const back = t.trackSummary(db, { track: docks.id });
  assert.deepEqual([back.state === 'parked', back.parkReason], [false, null]);
  const why = lastLine(db, docks.key);
  assert.equal(why.by, 'board:upkeep');
  assert.ok(why.note.includes('API lane') && why.changes.unparkWhen[0].includes(api.id), 'the cause names the line that ended, and the old condition is logged');
  q.answer(db, { id: ask.id, pick: 'a' }, { session: 's1' });
  assert.notEqual(t.trackSummary(db, { track: asked.id }).state, 'parked');

  u.upkeepSwitch(db, { on: false }, 'cli');
  const [m2, l3] = ['Second lane', 'Third'].map(line);
  t.parkTrack(db, { track: l3.id, reason: 'after the second lane', unparkWhen: 'track-ends ' + m2.id }, 'cli');
  t.finishTrack(db, { track: m2.id }, 'cli');
  assert.equal(t.trackSummary(db, { track: l3.id }).state, 'parked');
});

test('task create with a track puts the task on that track, never in the inbox', () => {
  const db = board();
  const line = t.newTrack(db, { workstream: 'WS-1', name: 'Line' }, 'cli');
  const made = w.createRecord(db, { name: 'Filed for the line', description: 'd', track: line.id }, 'cli');
  assert.equal(made.track, line.id);
  const row = db.prepare('SELECT track FROM track_items WHERE task = ?').get(made.key);
  assert.equal(row && row.track, line.key);
  assert.throws(() => w.createRecord(db, { name: 'x', description: 'd', track: 'TR-99' }, 'cli'));

  /* a session's filing names its place; the hint rides the refusal; the found list and a release gate say where each went */
  const S = { session: 's9' };
  /* the user's own command (--user), which the ruling never asks about */
  const U = { session: 's9', user: 's9' };
  const mine = t.newTrack(db, { workstream: 'WS-1', name: 'Release lane', session: 's9' }, S);
  const rel = runVerb(db, 'createRecord', { name: 'Release 1.0', description: 'd', track: mine.id }, S);
  assert.throws(() => runVerb(db, 'createRecord', { name: 'Fix the release notes', description: 'd', workstream: 'WS-1' }, S),
    (e) => /tier/.test(e.message) && e.data.offers.length > 0);
  const before = runVerb(db, 'createRecord', { name: 'Notes', description: 'd', track: mine.id, before: [rel.id] }, S);
  /* off the held track a session's filing is asked; what the user's press files */
  const approved = { [APPROVED]: 'Q-1' };
  const there = runVerb(db, 'createRecord', { name: 'Elsewhere', description: 'd', track: line.id, ...approved }, S);
  /* an inbox filing with no wake is refused, a session's or code's alike, with both ways out in one message */
  const bothWays = (e) => e.message.includes('--wake') && e.message.includes('--track TR-n') && e.message.includes('track park');
  assert.throws(() => runVerb(db, 'createRecord', { name: 'Someday', description: 'd', workstream: 'WS-1', unplaced: 'waits on the next design pass' }, { session: 's7' }), bothWays);
  assert.throws(() => t.capture(db, { workstream: 'WS-1', name: 'A loose idea' }, 'cli'), bothWays);
  const loose = runVerb(db, 'createRecord', { name: 'Someday', description: 'd', tier: 2, unplaced: 'waits on the next design pass', wake: LATER, ...approved }, S);
  const theirs = runVerb(db, 'createRecord', { name: 'Not this arc', description: 'd', track: line.id }, { session: 's8' });
  const f = runVerb(db, 'trackFound', { track: mine.id }, null);
  assert.ok(!f.tasks.some((x) => x.id === theirs.id), "another session's filing is not this track's found work");
  const at = (id) => f.tasks.find((x) => x.id === id).where;
  assert.deepEqual([at(before.id).track, at(before.id).before], [mine.id, [rel.id]]);
  assert.equal(at(there.id).track, line.id);
  assert.equal(at(loose.id).reason, 'waits on the next design pass');
  /* the track view's summary, read without the step reads, still sorts each by its track */
  const sum = t.trackView(db, { track: mine.id }).found;
  assert.deepEqual([sum.here, sum.elsewhere, sum.unplaced, sum.unplacedIds], [f.counts.here, 1, 1, [loose.id]]);
  const go = q.register(db, { name: 'release go', gist: 'Ready?', projectDir: 'C:/repo', session: 's9', blocking: true, ask: 'Ship (a) or wait (b)?', gates: [rel.id],
    options: [{ type: 'a', option: 'ship' }, { type: 'b', option: 'wait' }] }, null);
  assert.match(q.show(db, { id: go.id }).gist, new RegExp('Found this arc.*' + loose.id));

  /* a reason that no track carries it is refused with the parked-track commands, the same one message;
     it is due once its event ends, and one stored with no wake once 14 days in the inbox pass */
  const inboxRow = (id) => t.projectInbox(db, 'ws000001').find((x) => x.id === id);
  const due = () => Object.fromEntries(t.projectInbox(db, 'ws000001').map((x) => [x.id, x.due]));
  assert.equal(loose.wake, LATER);
  assert.throws(() => runVerb(db, 'createRecord', { name: 'Later', description: 'd', workstream: 'WS-1', unplaced: 'after release 0.8.16; no track carries it yet', wake: LATER }, U),
    (e) => bothWays(e) && e.message.includes('--unpark-when'));
  const gate = runVerb(db, 'createRecord', { name: 'Gate', description: 'd', track: line.id }, 'cli');
  /* a wake that has fired is refused, naming what fired and the place command */
  const today = new Date().toLocaleDateString('sv');
  assert.throws(() => runVerb(db, 'editRecord', { id: loose.id, wake: today }, S), (e) => e.message.includes(today) && e.message.includes('task edit ' + loose.id + ' --track'));
  /* a refused filing made no task, so its way out files it again rather than naming an id */
  const refiled = (e) => e.message.includes(today) && e.message.includes('--track TR-n') && !e.message.includes('<T-n>');
  assert.throws(() => runVerb(db, 'createRecord', { name: 'Late', description: 'd', workstream: 'WS-1', unplaced: 'waits on the user', wake: today }, U), refiled);
  assert.throws(() => t.capture(db, { workstream: 'WS-1', name: 'Late idea', unplaced: 'waits on the user', wake: today }, U), refiled);
  /* a refused close moved nothing either, so its way out closes the track again */
  assert.throws(() => t.finishTrack(db, { track: line.id, leftovers: 'inbox', wake: today }, U),
    (e) => e.message.includes(today) && e.message.includes(line.id + ' --leftovers drop') && !e.message.includes('<T-n>'));
  /* work waiting for the end of the track the session holds is a step on it, in every filing verb; with no session,
     or waiting on another track's end, it files as before; a close's leftovers waiting on that track's own end have fired */
  const own = { unplaced: 'after the release lane', wake: 'track-ends ' + mine.id };
  for (const [verb, input] of [['createRecord', { name: 'After the lane', description: 'd', workstream: 'WS-1' }], ['editRecord', { id: there.id }],
    ['capture', { workstream: 'WS-1', name: 'After the lane' }]]) {
    assert.throws(() => runVerb(db, verb, { ...input, ...own }, U), (e) => e.message.includes('--track ' + mine.id), verb);
  }
  assert.ok(runVerb(db, 'createRecord', { name: 'After the lane', description: 'd', workstream: 'WS-1', ...own }, 'cli').wake);
  assert.ok(runVerb(db, 'capture', { workstream: 'WS-1', name: 'After the line', ...own, wake: 'track-ends ' + line.id }, U).wake);
  assert.throws(() => t.finishTrack(db, { track: line.id, leftovers: 'inbox', wake: 'track-ends ' + line.id }, U), (e) => e.message.includes(line.id + ' --leftovers drop'));
  /* so do another track's leftovers sent to wait for the end of the one the session holds; nothing moves */
  assert.throws(() => t.finishTrack(db, { track: line.id, leftovers: 'inbox', wake: 'track-ends ' + mine.id }, U), (e) => e.message.includes('--track ' + mine.id));
  assert.deepEqual([t.trackSummary(db, { track: line.id }).state, db.prepare('SELECT track FROM track_items WHERE task = ?').get(there.key).track], ['new', line.key]);
  runVerb(db, 'editRecord', { id: loose.id, wake: 'task-completes ' + gate.id }, S);
  const old = w.createRecord(db, { name: 'Filed long ago', description: 'd', workstream: 'WS-1' }, { by: 'cli', now: new Date(Date.now() - 20 * 86400e3) });
  assert.deepEqual([due()[loose.id], due()[old.id]], [false, true]);
  runVerb(db, 'editRecord', { id: gate.id, status: 'done' }, 'cli');
  assert.equal(due()[loose.id], true, 'its event ended');
  assert.throws(() => runVerb(db, 'editRecord', { id: loose.id, wake: 'task-completes ' + gate.id }, S), (e) => e.message.includes(gate.id + ' is already done'));

  /* a third wake in one inbox stay stores none: the board asks the user on the band, in the task's workstream, the
     asker subscribed; the inbox row names the question; a keep answer starts the count over; placing the task drops one still open */
  const third = { asked: runVerb(db, 'editRecord', { id: loose.id, wake: '2099-02-01' }, S).placed.asked.id };
  const ask = q.show(db, { id: third.asked });
  assert.deepEqual([ask.status, ask.blocking, ask.session, ask.workstream], ['open', false, 's9', 'WS-1']);
  assert.deepEqual([inboxRow(loose.id).due, inboxRow(loose.id).asked], [true, third.asked], 'no new wake stored; the row names the question');
  q.answer(db, { id: third.asked, pick: 'b' }, { user: 'user' });
  for (const day of ['2099-03-01', '2099-04-01']) assert.equal(runVerb(db, 'editRecord', { id: loose.id, wake: day }, S).placed.asked, undefined);
  const again = runVerb(db, 'editRecord', { id: loose.id, wake: '2099-05-01' }, S).placed.asked.id;
  assert.ok(again && again !== third.asked);
  runVerb(db, 'editRecord', { id: loose.id, track: line.id }, U);
  assert.equal(q.show(db, { id: again }).status, 'dropped');
});

/* a filing names its tier and the board places it; a tier that does not fit, or a marked
   session filing with none, writes nothing and carries the call that fits */
test('a filing lands where its tier says, before the closing review, and a tier that does not fit writes nothing and offers the one that does', () => {
  const db = board();
  putRecord(db, { key: 'ws000002', kind: 'workstream', fields: { id: 'WS-2', key: 'ws000002', name: 'Elsewhere', status: 'open', labelHistory: ['WS-2 2026-10-25'] }, body: '' });
  const S = { session: 's1' };
  const line = t.newTrack(db, { workstream: 'WS-1', name: 'Held line', session: 's1' }, S);
  const other = t.newTrack(db, { workstream: 'WS-1', name: 'Other line' }, 'cli');
  const away = t.newTrack(db, { workstream: 'WS-2', name: 'Away line' }, 'cli');
  const review = runVerb(db, 'createRecord', { name: 'Check the line', description: 'd', track: line.id, labels: ['review'] }, 'cli');
  const file = (p) => runVerb(db, 'createRecord', { name: 'Found ' + p.tier, description: 'd', ...p }, S);
  /* what an answered placement question files: the place the user pressed, as the session that asked */
  const land = (p) => file({ ...p, [APPROVED]: 'Q-1' });
  const last = 'nothing on the line needs it sooner';
  /* with nothing else open on the held track, last is free */
  const two = file({ tier: 2, last });
  assert.deepEqual([two.tier, two.ladder.track, two.ladder.before, two.ladder.last], [2, line.id, review.id, last], 'last: the held track, before its closing review');
  assert.equal(runVerb(db, 'readRecord', two.id, null).filedLast, last, 'the line is kept on the task');
  assert.ok(g.readiness(db, review.key).waitsOn.some((x) => x.includes(two.id)));
  /* a step after a later review station, filed last, still goes before the closing review */
  const station = runVerb(db, 'createRecord', { name: 'Check the wave', description: 'd', track: line.id, labels: ['review'] }, 'cli');
  const behind = land({ tier: 2, after: [station.id], last });
  assert.equal(behind.ladder.before, review.id);
  /* a wave's review filed last holds up the closing review like any step */
  const wave = land({ tier: 2, after: [two.id, behind.id], labels: ['review'], last });
  assert.deepEqual([wave.ladder.before, wave.ladder.closing], [review.id, review.id]);
  assert.ok(g.readiness(db, review.key).waitsOn.some((x) => x.includes(wave.id)));
  /* last goes behind the chain's end; a started review mid-track with work after it is no closing review to sit
     before. The asked row names the end it will wait on, and the press files it there with nothing waiting on it */
  {
    const db = board();
    const S5 = { session: 's5' };
    const mid = t.newTrack(db, { workstream: 'WS-1', name: 'Mid line', session: 's5' }, S5);
    const mk = (name, p = {}) => runVerb(db, 'createRecord', { name, description: 'd', track: mid.id, ...p }, 'cli');
    const station = mk('Review the wave', { labels: ['review'] });
    const fix = mk('Fix the findings', { after: [station.id] });
    const live = mk('The live run', { after: [fix.id] });
    const look = mk('The look', { after: [live.id] });
    w.taskUpdate(db, { id: station.id, inHand: true }, S5);
    const asked = runVerb(db, 'createRecord', { name: 'Tidy later', description: 'd', tier: 2, last, here: { before: [fix.id] } }, S5).asked;
    assert.ok(q.show(db, asked.id, null).options.find((o) => o.type === 'b').getsYou.includes(look.id), 'the row names the end it waits on');
    const made = q.answer(db, { id: asked.id, pick: 'b' }, { user: 's5' }).placement.created;
    assert.deepEqual([made.after, made.before], [[look.id], []]);
  }
  /* on the held track a marked blank (no before, no last line) is refused on every filing path, writing nothing, with both calls */
  const count = () => db.prepare("SELECT count(*) AS n FROM records WHERE kind = 'task'").get().n;
  const edges = () => db.prepare('SELECT count(*) AS n FROM depends').get().n;
  const blank = (f) => {
    const had = [count(), edges()];
    assert.throws(f, (e) => e.data.offers.some((o) => o.tier === 2 && o.before) && e.data.offers.some((o) => o.tier === 2 && o.last), 'refused');
    assert.deepEqual([count(), edges()], had, 'a refusal writes nothing');
  };
  const homeless = runVerb(db, 'createRecord', { name: 'Waiting work', description: 'd', workstream: 'WS-1', unplaced: 'no plan yet', wake: '2099-01-01' }, 'cli');
  const open = runVerb(db, 'createRecord', { name: 'Work in hand', description: 'd', track: line.id, before: [review.id] }, 'cli');
  const mark = {};
  const paths = {
    create: (p) => file({ tier: 2, ...p }),
    edit: (p) => runVerb(db, 'editRecord', { id: homeless.id, tier: 2, ...mark, ...p }, S),
    capture: (p) => runVerb(db, 'capture', { name: 'Captured', description: 'd', tier: 2, ...mark, ...p }, S),
    layout: (p) => runVerb(db, 'layOut', { track: line.id, steps: [{ name: 'Laid out', description: 'd', ...p }], session: 's1' }, S).steps[0],
    close: (p) => runVerb(db, 'taskUpdate', { id: open.id, status: 'done', ...mark, leftovers: [{ name: 'Left over', description: 'd', runBy: 'fork', tier: 2, ...p }] }, S).steps[0],
  };
  for (const [via, go] of Object.entries(paths)) {
    blank(() => go({}));
    blank(() => go({ last: ' ' }));
    /* the offer's own template sent as written is no line */
    blank(() => go({ last: '<why nothing on ' + line.id + ' needs it sooner>' }));
    /* a batch whose later step is blank writes none of it */
    if (via === 'close') blank(() => runVerb(db, 'taskUpdate', { id: open.id, status: 'done', ...mark, leftovers: [{ name: 'Good', description: 'd', runBy: 'fork', tier: 2, last, here: { before: [two.id] } }, { name: 'Left over', description: 'd', runBy: 'fork', tier: 2 }] }, S));
    /* last with other work open is asked of the user, with here, and every path creates nothing */
    /* with no here nothing on the held track waits, so the question offers the place asked, talk and drop, no do-it-here press */
    const bare = q.show(db, go({ last }).asked.id, null);
    assert.deepEqual([bare.options.map((o) => o.type).join(''), bare.pick, bare.placement.here, bare.options.some((o) => /this track/i.test(o.option))], ['abc', 'a', null, false], via);
    if (via === 'create') assert.throws(() => q.answer(db, { id: bare.id, pick: 'd' }, { user: 's1' }), (e) => /no option d/.test(e.message), 'a letter the question lacks is refused, never read as talk');
    if (via === 'create') assert.equal(q.answer(db, { id: bare.id, pick: 'a' }, { user: 's1' }).placement.created.track, line.id, 'its a creates it where asked');
    const had = count();
    const r = go({ last, here: { before: [two.id] } });
    assert.ok(r.asked && r.asked.id && (via === 'edit' || !r.id), via + ' ' + JSON.stringify(r));
    assert.equal(count(), had, via + ' creates nothing');
    assert.equal(q.show(db, r.asked.id, null).placement.here.before[0], two.id);
  }
  /* new work asked of the user carries the description its press creates it with, else nothing is asked */
  const questions = () => db.prepare("SELECT count(*) AS n FROM records WHERE kind = 'question'").get().n;
  const asks = questions();
  assert.throws(() => paths.capture({ description: ' ', last, here: { before: [two.id] } }), (e) => /description/.test(e.message));
  assert.equal(questions(), asks, 'no question is created');
  /* past the held track a filing says why that track does not cover it; refused without, naming tier 2 */
  assert.throws(() => file({ tier: 3, track: other.id }), (e) => e.data.offer.tier === 2 && e.data.offers.some((o) => o.tier === 3 && o.track === other.id && o.whyElsewhere));
  const why = 'the held line ships the pane; this is the tray';
  /* off the held track is asked, nothing created; the press files it where asked */
  const tasksNow = db.prepare("SELECT count(*) AS n FROM records WHERE kind = 'task'").get().n;
  const offAsk = file({ tier: 3, track: other.id, whyElsewhere: why, here: { before: [two.id] } }).asked;
  assert.equal(db.prepare("SELECT count(*) AS n FROM records WHERE kind = 'task'").get().n, tasksNow);
  /* only the user's own act settles it: a session's answer, drop or ruling writes nothing */
  assert.throws(() => q.answer(db, { id: offAsk.id, pick: 'b' }, S), (e) => e.message.includes('only the user answers it'));
  assert.throws(() => q.drop(db, { id: offAsk.id }, S), (e) => e.message.includes('only the user answers it'));
  const ruled = decide(db, { title: 'Put it where asked', words: offAsk.id + 'b', question: offAsk.id, global: true }, S);
  assert.ok(!ruled.answered && ruled.warning.includes(offAsk.id), JSON.stringify(ruled));
  assert.equal(q.show(db, offAsk.id, null).status, 'open');
  /* the answer a creates it at here, on the held track, as the session that asked */
  const atHere = q.answer(db, { id: offAsk.id, pick: 'a' }, { user: 's1' }).placement.created;
  assert.deepEqual([atHere.track, atHere.before], [line.id, [two.id]]);
  /* the user's own command is never asked */
  assert.equal(runVerb(db, 'createRecord', { name: 'User put', description: 'd', tier: 3, track: other.id }, { session: 's1', user: 's1' }).track, other.id);
  const three = land({ tier: 3, track: other.id, whyElsewhere: why });
  assert.deepEqual([three.track, three.ladder.told, three.ladder.whyElsewhere], [other.id, other.id, why]);
  assert.ok(db.prepare('SELECT body FROM notes WHERE record = ?').all(other.key).some((n) => n.body.includes(three.id)), 'the note tells the track');
  /* the talk filing passes for the session that asked (or the track's holder) alone; another session is refused */
  const talked = file({ tier: 3, track: other.id, whyElsewhere: why, here: { before: [two.id] } }).asked.id;
  q.answer(db, { id: talked, pick: 'c' }, { user: 's1' });
  const talk = { name: 'Settled', description: 'd', tier: 3, track: other.id, question: talked, words: 'put it on the other line' };
  assert.throws(() => runVerb(db, 'createRecord', talk, { session: 's7' }), (e) => e.message.includes(talked));
  assert.equal(runVerb(db, 'createRecord', talk, S).track, other.id);
  /* an implementation choice inside the ruling: a session that parked its track is still policed against it, so park, file, resume is no way round */
  t.parkTrack(db, { track: line.id, reason: 'a break' }, S);
  assert.ok(file({ tier: 3, track: other.id, whyElsewhere: why, here: { before: [two.id] } }).asked, 'asked after a park');
  runVerb(db, 'acquireLease', { track: line.id, session: 's1' }, S);
  /* nor is a fresh track taken and finished: the newest track it held that is still open polices it */
  const own = t.newTrack(db, { name: 'Own', workstream: 'WS-1', session: 's1' }, S);
  t.finishTrack(db, { track: own.id }, S);
  assert.ok(file({ tier: 3, track: other.id, whyElsewhere: why, here: { before: [two.id] } }).asked, 'asked after a fresh track finished');
  runVerb(db, 'acquireLease', { track: line.id, session: 's1' }, S);
  /* parked on the held track's own end, the line also says why it cannot start sooner */
  const before = db.prepare("SELECT count(*) AS n FROM records WHERE kind = 'task'").get().n;
  assert.throws(() => file({ tier: 3, unparkWhen: 'track-ends ' + line.id, whyElsewhere: 'not the line goal' }), (e) => e.data.offer.tier === 2 && e.data.offers.some((o) => o.unparkWhen && o.whyElsewhere.includes(';')));
  assert.equal(db.prepare("SELECT count(*) AS n FROM records WHERE kind = 'task'").get().n, before, 'a refusal writes nothing');
  const later = land({ tier: 3, unparkWhen: 'track-ends ' + line.id, whyElsewhere: 'not the line goal; it reads the shipped pane' });
  assert.equal(t.trackSummary(db, { track: later.track }).state, 'parked', 'a parked track the end of the held one opens');
  assert.throws(() => file({ tier: 4, workstream: 'WS-2', wake: 'track-ends ' + away.id }), (e) => e.data.offer.tier === 2);
  const four = land({ tier: 4, workstream: 'WS-2', wake: 'track-ends ' + away.id, whyElsewhere: 'another workstream board' });
  /* the line shows on the task's record and where the next kickoff lists filed work */
  assert.equal(runVerb(db, 'readRecord', three.id, null).whyElsewhere, why);
  const went = k.growthLines(db, { added: [three.key, later.key, four.key].join(' ') }, { held: line.key });
  /* the line is quoted, so its own semicolon never reads as the list's separator */
  assert.ok(went.find((l) => l.startsWith('Where they went')).includes('"' + why + '"') && went.find((l) => l.startsWith('Unplaced')).includes('"another workstream board"'), went.join(' | '));
  assert.ok(t.projectInbox(db, 'ws000002').some((x) => x.id === four.id));
  assert.equal(JSON.parse(db.prepare('SELECT fields FROM records WHERE key = ?').get(four.key).fields).tier, 4, 'the tier is stored');
  const tasks = () => db.prepare("SELECT count(*) AS n FROM records WHERE kind = 'task'").get().n;
  const had = tasks();
  /* an offer onto the held track names before or last, never a bare tier 2 the board refuses */
  assert.throws(() => file({ tier: 3, track: line.id }), (e) => e.data.offers.length === 2 && e.data.offers.every((o) => o.tier === 2 && (o.before || o.last)));
  /* a named track is the place call's tier, so another track with no line is refused as tier 3 */
  assert.throws(() => file({ track: other.id }), (e) => e.data.offers.some((o) => o.tier === 3 && o.track === other.id && o.whyElsewhere));
  /* an inbox filing that lacks its reason carries the ladder's calls as offers, as every ladder refusal does */
  assert.throws(() => file({ tier: 4, workstream: 'WS-2', wake: '2099-02-01', unplaced: 'no track carries this yet', whyElsewhere: 'another board' }),
    (e) => e.data.offers.some((o) => o.tier === 2 && o.before) && e.data.offers.some((o) => o.tier === 4 && o.workstream === 'WS-2' && o.wake === '2099-02-01'));
  assert.throws(() => file({ tier: 4, workstream: 'WS-2', wake: 'track-ends ' + line.id, unplaced: 'after the held line', whyElsewhere: 'another board' }),
    (e) => e.data.offers.length === 2 && e.data.offers.every((o) => o.tier === 2 && (o.before || o.last)));
  assert.equal(tasks(), had, 'a refusal writes nothing');
  /* a marked session's wake alone on an inbox task wakes it again, no filing; the third still asks */
  const inboxed = land({ tier: 2, unplaced: 'waits on the vendor reply', wake: '2099-01-01' });
  const woke = runVerb(db, 'editRecord', { id: inboxed.id, wake: '2099-02-01' }, S);
  assert.deepEqual([woke.placed.wake, woke.tier], ['2099-02-01', undefined]);
  assert.ok(runVerb(db, 'editRecord', { id: inboxed.id, wake: '2099-03-01' }, S).placed.asked.id, 'the third wake asks; asked is the question as register returns it');
  /* any open question gating a due inbox task marks it asked, so it owes nothing more */
  const owed = w.createRecord(db, { name: 'Filed long ago', description: 'd', workstream: 'WS-1' }, { by: 'cli', now: new Date(Date.now() - 20 * 86400e3) });
  const gating = q.register(db, { name: 'where', gist: 'Where?', projectDir: 'C:/repo', session: 's1', blocking: false, ask: 'Here (a) or there (b)?', gates: [owed.id],
    options: [{ type: 'a', option: 'here' }, { type: 'b', option: 'there' }] }, null);
  const row = t.projectInbox(db, 'ws000001').find((x) => x.id === owed.id);
  assert.deepEqual([row.due, row.asked], [true, gating.id]);
  /* a step for the next session waits on the held track through the filer's renewals, ready once another session takes it */
  const nextOne = land({ tier: 2, wake: 'next-session', last });
  const word = () => runVerb(db, 'readRecord', nextOne.id, null).word;
  assert.deepEqual([nextOne.track, word().is, word().on], [line.id, 'waiting', ['until the next session']]);
  t.renewLease(db, { session: 's1' }, S);
  assert.equal(word().is, 'waiting');
  assert.throws(() => file({ tier: 2, wake: 'next-session', unplaced: 'later', last }), /unplaced/);
  /* every refusal that offers the held pair keeps the wake on it (the on create and leftover, the line's, another track named), so sent as printed it still waits */
  const pair = (e) => e.data.offers.filter((o) => o.tier === 2);
  const keeps = (e) => pair(e).length === 2 && pair(e).every((o) => o.wake === 'next-session');
  let printed;
  assert.throws(() => file({ tier: 2, wake: 'next-session' }), (e) => keeps(e) && Boolean(printed = pair(e).find((o) => o.last)));
  assert.throws(() => file({ tier: 2, track: other.id, wake: 'next-session' }), keeps);
  assert.throws(() => file({ tier: 3, track: other.id, wake: 'next-session' }), keeps);
  const closer = land({ tier: 2, last });
  assert.throws(() => runVerb(db, 'taskUpdate', { id: closer.id, status: 'done', ...mark, leftovers: [{ name: 'Check later', description: 'd', runBy: 'fork', tier: 2, wake: 'next-session' }] }, S), keeps);
  const { call: _sent, flags: _shown, ...asPrinted } = printed;
  assert.equal(runVerb(db, 'readRecord', land({ ...asPrinted, last }).id, null).word.is, 'waiting');
  /* an offer names only what a verb takes, and next-session is no park event */
  assert.throws(() => file({ tier: 3, wake: 'next-session', whyElsewhere: why }), (e) => e.data.offers.length && e.data.offers.every((o) => !/next-session/.test(o.unparkWhen || '')));
  /* a parked track's event is its wait, so it takes no next-session; an open track does, at tier 3 */
  assert.throws(() => file({ tier: 3, newTrack: 'Later line', unparkWhen: 'track-ends ' + line.id, wake: 'next-session', whyElsewhere: why }),
    (e) => e.data.offers.some((o) => o.tier === 3 && o.track && o.wake === 'next-session'));
  const away3 = land({ tier: 3, track: other.id, wake: 'next-session', whyElsewhere: why });
  const word3 = () => runVerb(db, 'readRecord', away3.id, null).word.is;
  assert.deepEqual([away3.track, word3()], [other.id, 'waiting']);
  /* next-session reaches another workstream's track at tier 4; the offer keeps the wake and the why line, so sent as given it lands */
  let offer;
  assert.throws(() => file({ tier: 3, track: away.id, wake: 'next-session', whyElsewhere: why }), (e) => (offer = e.data.offer).tier === 4);
  assert.deepEqual([offer.track, offer.wake, offer.whyElsewhere], [away.id, 'next-session', why]);
  const { call: _call, flags: _flags, ...sent } = offer;
  const away4 = land(sent);
  const word4 = () => runVerb(db, 'readRecord', away4.id, null).word.is;
  assert.deepEqual([away4.track, word4()], [away.id, 'waiting']);
  /* a filing with no line gets the template there, the one part left to fill */
  assert.throws(() => file({ tier: 3, track: away.id, wake: 'next-session' }), (e) => e.data.offer.wake === 'next-session' && /^<why/.test(e.data.offer.whyElsewhere));
  runVerb(db, 'releaseLease', { session: 's1' }, S);
  runVerb(db, 'acquireLease', { track: line.id, session: 's1' }, S);
  assert.equal(word().is, 'waiting', 'the filer taking it again is not the next session');
  /* a /clear's take continuing the filer's id (and one continuing that) is the same session going on */
  runVerb(db, 'takeOver', { track: line.id, session: 's1b', continues: 's1' }, { session: 's1b' });
  runVerb(db, 'takeOver', { track: line.id, session: 's1c', continues: 's1b' }, { session: 's1c' });
  assert.equal(word().is, 'waiting', 'a continuing take is not the next session');
  runVerb(db, 'takeOver', { track: line.id, session: 's2', continues: 's1' }, { session: 's2' });
  assert.equal(word().is, 'ready');
  /* the tier 3 one waits on its own track the same way: the filer's take leaves it waiting, another's makes it ready */
  runVerb(db, 'acquireLease', { track: other.id, session: 's1' }, S);
  assert.equal(word3(), 'waiting');
  runVerb(db, 'releaseLease', { session: 's1' }, S);
  runVerb(db, 'acquireLease', { track: other.id, session: 's3' }, { session: 's3' });
  assert.equal(word3(), 'ready');
  assert.equal(word4(), 'waiting');
  runVerb(db, 'acquireLease', { track: away.id, session: 's4' }, { session: 's4' });
  assert.equal(word4(), 'ready');
});

test('closing a task files its leftovers at a real place and asks the rest of the user, landing in one call; the answer files each; a refused step closes nothing', () => {
  const db = board();
  const S = { session: 's1' };
  const line = t.newTrack(db, { workstream: 'WS-1', name: 'Line', session: 's1' }, S);
  const other = t.newTrack(db, { workstream: 'WS-1', name: 'Other' }, 'cli');
  const [work, next] = ['The work', 'Next work'].map((n) => task(db, line.id, n));
  const here = { before: [next.id] };
  const steps = [{ name: 'A bug it found', description: 'The pane lock races the redraw; done when it holds.', runBy: 'orchestrator', tier: 2, before: [next.id] },
    { name: 'Docs for later', description: 'd', runBy: 'agent:opus', tier: 3, newTrack: 'Docs', unparkWhen: 'task-completes 1', whyElsewhere: 'the docs are their own line; they follow the fix', here }];
  const tasks = () => db.prepare("SELECT count(*) AS n FROM records WHERE kind = 'task'").get().n;
  const questions = () => db.prepare("SELECT count(*) AS n FROM records WHERE kind = 'question'").get().n;
  const had = tasks();
  /* a step waiting on the end of the track the session holds is refused, and the close with it */
  assert.throws(() => runVerb(db, 'taskUpdate', { id: work.id, status: 'done', leftovers: [...steps, { name: 'Own end', description: 'd', runBy: 'fork', tier: 3, unparkWhen: 'track-ends ' + line.id, whyElsewhere: 'after this line', here }] }, S),
    (e) => /step 3/.test(e.message) && e.message.includes(line.id));
  assert.equal(questions(), 0, 'a refused close asks nothing');
  /* a step past the held track carries why that track does not cover it, refused naming tier 2 */
  const tray = { name: 'Tray bit', description: 'd', runBy: 'fork', tier: 3, track: other.id };
  assert.throws(() => runVerb(db, 'taskUpdate', { id: work.id, status: 'done', leftovers: [tray] }, S), (e) => /step 1/.test(e.message) && e.data.offer.tier === 2);
  assert.deepEqual([runVerb(db, 'readRecord', work.id, null).status, tasks()], ['open', had]);
  /* a close that would lose open steps names each; a check, a strike or a leftover naming the step settles it */
  for (const s of ['measure at 238', 'drop the old path', 'write the guide page']) g.addItem(db, { task: work.id, text: s }, 'cli');
  /* an edit's ending goes through the same close, whoever calls */
  assert.throws(() => runVerb(db, 'editRecord', { id: work.id, status: 'dropped' }, S), (e) => e.data.openSteps.length === 3);
  assert.throws(() => runVerb(db, 'taskUpdate', { id: work.id, status: 'done', checks: { done: [1] } }, S),
    (e) => e.data.openSteps.map((s) => s.n).join() === '2,3' && e.message.includes('drop the old path'));
  assert.equal(runVerb(db, 'readRecord', work.id, null).status, 'open');
  /* a step with no description of its own is refused by its number, and nothing is written */
  assert.throws(() => runVerb(db, 'taskUpdate', { id: work.id, status: 'done', note: 'the pane lock races the redraw', checks: { done: [1], strike: [{ step: 2, why: 'superseded' }] },
    leftovers: [{ check: 3, runBy: 'agent:opus', tier: 2, before: [next.id] }, { name: 'Bare', runBy: 'fork', tier: 2, before: [next.id] }] }, S), (e) => /step 2/.test(e.message) && /description/.test(e.message));
  assert.deepEqual([runVerb(db, 'readRecord', work.id, null).status, runVerb(db, 'taskBlock', { id: work.id }, null).steps.length, tasks()], ['open', 3, had]);
  const close = runVerb(db, 'taskUpdate', { id: work.id, status: 'done', note: 'the pane lock races the redraw',
    checks: { done: [1], strike: [{ step: 2, why: 'superseded' }] }, leftovers: [...steps, { check: 3, runBy: 'agent:opus', tier: 2, before: [next.id] }, { ...tray, whyElsewhere: 'the tray, not this line', here }] }, S);
  /* the steps at a real place are filed, each other one is its own question, and the close lands */
  const [bug, docs, guide, tray2] = close.leftovers;
  assert.deepEqual(close.steps.map((x) => [x.step, Boolean(x.id), Boolean(x.asked)]), [[1, true, false], [2, false, true], [3, true, false], [4, false, true]]);
  assert.deepEqual([tasks(), questions()], [had + 2, 2]);
  assert.ok(JSON.stringify(runVerb(db, 'readRecord', work.id, null).journal).includes(docs.asked.id), 'the close note names the question');
  /* the answer b files each where it was asked, as the session that left it */
  const user = { user: 's1' };
  const docsMade = q.answer(db, { id: docs.asked.id, pick: 'b' }, user).placement.created;
  const trayed = q.answer(db, { id: tray2.asked.id, pick: 'b' }, user).placement.created;
  assert.equal(runVerb(db, 'readRecord', trayed.id, null).whyElsewhere, 'the tray, not this line');
  assert.equal(runVerb(db, 'readRecord', guide.id, null).name, 'write the guide page');
  const struck = runVerb(db, 'taskBlock', { id: work.id }, null);
  assert.deepEqual([struck.steps, struck.struck.map((s) => s.n)], [[], [2, 3]]);
  assert.ok(struck.text.includes(guide.id), 'the block prints the strike with its why');
  const waits = (a, b) => db.prepare('SELECT count(*) AS n FROM depends d JOIN records x ON x.key = d.task JOIN records y ON y.key = d."on" WHERE x.label = ? AND y.label = ?').get(a, b).n;
  assert.equal(waits(bug.id, work.id), 1, 'a step with no after follows the closing task');
  /* a note handing work to an open task by name lands there; a closed one gets no copy, and the reply says so */
  const handed = runVerb(db, 'noteRecord', { id: next.id, text: 'Pane half moved. The 438 measure is left for ' + bug.id + '. The guide check rides ' + work.id + '.' }, S);
  assert.deepEqual([handed.copied, handed.notCopied.map((n) => n.id)], [[bug.id], [work.id]]);
  assert.match(JSON.stringify(runVerb(db, 'readRecord', bug.id, null).journal), new RegExp(next.id + '[^"]*438 measure'));
  assert.equal(runVerb(db, 'readRecord', work.id, null).status, 'done');
  /* a step filed by its number says where it came from */
  assert.match(runVerb(db, 'readRecord', guide.id, null).description, new RegExp('^Step 3 of ' + work.id + ': write the guide page'));
  assert.deepEqual([bug.track, g.readiness(db, next.key).ready], [line.id, false], 'the step goes on the track, before the step it names');
  const docsTrack = t.trackSummary(db, { track: docsMade.track });
  assert.deepEqual([docsTrack.state, JSON.stringify(docsTrack).includes(bug.id)], ['parked', true], 'the step named by number opens it by id');
  assert.equal(t.trackSummary(db, { track: line.id }).state, 'active', 'the session keeps the track it holds');
  /* a drop of a track with its tasks, one with a step open, is refused whole naming it */
  g.addItem(db, { task: trayed.id, text: 'wire it' }, 'cli');
  assert.throws(() => t.dropTrack(db, { track: other.id, reason: 'scrapped', leftovers: 'drop' }, 'cli'), (e) => e.data.openSteps[0].id === trayed.id && /wire it/.test(e.message));
  /* a step waiting on an open task of the held track that nothing there follows is asked with no here, and the close lands */
  const later = task(db, line.id, 'Later work');
  g.addItem(db, { task: later.id, text: 'review the records once in use' }, 'cli');
  const left = runVerb(db, 'taskUpdate', { id: later.id, status: 'done', leftovers: [{ check: 1, runBy: 'fork', tier: 3, unparkWhen: 'task-completes ' + next.id,
    whyElsewhere: 'it reads the records in use; they exist only once ' + next.id + ' ships' }] }, S);
  const parkedQ = q.show(db, left.leftovers[0].asked.id, null);
  assert.deepEqual([runVerb(db, 'readRecord', later.id, null).status, parkedQ.placement.here, parkedQ.options.length], ['done', null, 3]);
});

test('a step its worker will not do moves onto another task, into a new task or to an open question, struck with where it went; a bad move writes nothing', () => {
  const db = board();
  const S = { session: 's1' };
  const line = t.newTrack(db, { workstream: 'WS-1', name: 'Line', session: 's1' }, S);
  const [work, review] = ['The work', 'The review'].map((n) => task(db, line.id, n));
  for (const s of ['done already', 'a check for the review', 'a bug found', 'the user decides the colour', 'a tray tweak']) g.addItem(db, { task: work.id, text: s }, 'cli');
  g.checkItem(db, { task: work.id, item: 1 }, 'cli');
  const asked = q.register(db, { name: 'colour', gist: 'g', projectDir: 'C:/repos/x', session: 's1', blocking: false, ask: 'Red (a, my pick) or blue (b)?', pick: 'a',
    options: [{ type: 'a', option: 'Red' }, { type: 'b', option: 'Blue' }] }, S);
  const moves = [{ check: 2, onto: review.id }, { check: 3, runBy: 'fork', tier: 2, before: [review.id] }, { check: 4, question: asked.id }];
  const count = () => db.prepare("SELECT count(*) AS n FROM records WHERE kind = 'task'").get().n;
  const had = [count(), g.itemsOf(db, review.key).length];
  assert.throws(() => runVerb(db, 'taskUpdate', { id: work.id, moveSteps: [...moves, { check: 1, onto: review.id }] }, S), (e) => /moveSteps\[3\]/.test(e.message) && /done/.test(e.message));
  /* a move into a new task is a filing, so a tier 2 move with neither before nor last is refused as a create is */
  assert.throws(() => runVerb(db, 'taskUpdate', { id: work.id, moveSteps: [{ check: 3, runBy: 'fork', tier: 2 }] }, S), (e) => / last /.test(e.message));
  assert.deepEqual([count(), g.itemsOf(db, review.key).length, g.itemsOf(db, work.key).filter((s) => !s.done).length], [...had, 4], 'a refused move writes nothing');
  /* a move onto a task on another track is asked, carrying onto in the question; the answer b adds the step there */
  const tray = t.newTrack(db, { workstream: 'WS-1', name: 'Tray' }, 'cli');
  const trayTask = task(db, tray.id, 'The tray');
  const r = runVerb(db, 'taskUpdate', { id: work.id, moveSteps: [...moves, { check: 5, onto: trayTask.id, whyElsewhere: 'the tray owns it', here: { before: [review.id] } }] }, S);
  const sent = r.moves[3].asked;
  assert.deepEqual([r.steps[3].step, r.steps[3].asked.id, q.show(db, sent.id, null).placement.asked.onto, g.itemsOf(db, trayTask.key).length], [5, sent.id, trayTask.id, 0]);
  q.answer(db, { id: sent.id, pick: 'b' }, { user: 's1' });
  assert.deepEqual(g.itemsOf(db, trayTask.key).map((x) => x.text), ['a tray tweak']);
  const [onto, filed, toQ] = r.moves;
  const words = Object.fromEntries(g.itemsOf(db, work.key).filter((s) => s.struck).map((s) => [s.n, s.struck]));
  assert.deepEqual(words, { 2: 'moved to ' + review.id + ' step ' + onto.step, 3: 'moved to ' + filed.to, 4: 'asked as ' + asked.id, 5: 'asked as ' + sent.id });
  assert.equal(g.itemsOf(db, review.key).find((s) => s.n === onto.step).text, 'a check for the review');
  const made = runVerb(db, 'readRecord', filed.to, null);
  assert.ok(made.description.startsWith('Step 3 of ' + work.id + ': a bug found'), made.description);
  assert.ok(g.readiness(db, review.key).waitsOn.some((x) => x.includes(filed.to)), 'the new task goes before the task it names');
  assert.equal(toQ.to, asked.id);
});

test('a review covers the code finished before it started; a fix finished after it, or a commit after its cover, reads uncovered', () => {
  const db = board();
  const at = (h) => ({ session: 's1', now: new Date(2026, 10, 4, h) });
  const line = t.newTrack(db, { workstream: 'WS-1', name: 'Coverage' }, 'cli');
  /* a station is known by its label, which a review scope sets; a "Review ..." name alone is a code task */
  const [one, fix] = ['The schema', 'Review fix for the schema'].map((name) => runVerb(db, 'createRecord', { name, description: 'd', track: line.id }, 'cli'));
  const review = runVerb(db, 'createRecord', { name: 'Check the schema', description: 'd', track: line.id, reviewScope: 'track' }, 'cli');
  assert.deepEqual(runVerb(db, 'readRecord', review.id, null).labels, ['review']);
  const link = (task, sha, h, n = 10) => runVerb(db, 'commitLink', { repo: 'r', sha: sha.repeat(40), task, via: 'message', at: at(h).now.toISOString(), added: n, removed: 0 }, at(h));
  link(one.id, 'a', 9);
  /* the PC retries a link: the row stays one and the log moves once */
  const lines = () => db.prepare("SELECT count(*) AS n FROM activity WHERE verb = 'commit'").get().n;
  assert.equal(link(one.id, 'a', 9).created, false);
  assert.equal(lines(), 1);
  assert.throws(() => link('T-404', 'b', 9), (e) => e.message.startsWith('no such task'));
  runVerb(db, 'editRecord', { id: one.id, status: 'done' }, at(10));
  /* a review reads what each task it covers was for: coverage and the review's block carry intent and decisions */
  runVerb(db, 'decide', { title: 'Keys stay text', words: 'never integers for keys', tasks: [one.id], global: true }, at(10));
  const aim = runVerb(db, 'coverage', { scope: line.id }, null).tasks.find((x) => x.id === one.id);
  assert.deepEqual([aim.intent, aim.decisions.map((d) => d.words)], [null, ['never integers for keys']]);
  const reads = runVerb(db, 'taskBlock', { id: review.id }, null).text;
  assert.ok(reads.includes(one.id) && reads.includes('never integers for keys') && !reads.includes(fix.id), reads);
  runVerb(db, 'editRecord', { id: review.id, inHand: true, reason: 'reads the schema' }, at(11));
  link(fix.id, 'c', 12);
  runVerb(db, 'editRecord', { id: fix.id, status: 'done' }, at(12));
  const done = runVerb(db, 'editRecord', { id: review.id, status: 'done' }, at(13));
  assert.deepEqual(done.covers, [one.id], 'the default covers only what finished before the review started');
  const covered = () => Object.fromEntries(runVerb(db, 'coverage', { scope: line.id }, null).tasks.map((x) => [x.id, x.covered]));
  /* review covers with no list on the closed review keeps what it read, never empties it */
  assert.deepEqual(runVerb(db, 'reviewCovers', { review: review.id }, at(13)).covers.map((x) => x.id), [one.id]);
  assert.deepEqual(covered(), { [one.id]: true, [fix.id]: false });
  link(one.id, 'd', 14);
  assert.equal(covered()[one.id], false, 'a commit after the cover uncovers it');
  /* at light nothing reopens: the map draws it as a bead again and the diamond no longer counts it */
  const v = t.trackView(db, { track: line.id });
  assert.ok(v.finished.some((f) => f.id === one.id && !f.review));
  assert.deepEqual(v.finished.find((f) => f.id === review.id).covers, []);
});

test('a review is due once review.tasks finished code tasks wait on a track; review.ignore files are no code, and off shows nothing', () => {
  const db = board();
  const at = (h) => ({ session: 's1', now: new Date(2026, 10, 4, h) });
  /* an archived task once held T-1, which a task on this track holds now */
  putRecord(db, { key: 'aaaaaaa1', kind: 'task', fields: { id: 'T-1', key: 'aaaaaaa1', name: 'Elsewhere', status: 'done', created: '2026-01-01', closed: '2026-01-02',
    labelHistory: ['T-1 2026-01-01 2026-01-16'] }, body: '' });
  addNote(db, 'aaaaaaa1', { at: '2026-01-02T09:00:00-05:00', actor: 'cli', body: 'Landed in another project.' });
  const line = t.newTrack(db, { workstream: 'WS-1', name: 'Due' }, 'cli');
  const set = (key, value) => runVerb(db, 'settingsSet', { key, value, at: 'track', record: line.id }, 'cli');
  set('review.tasks', 2);
  const reader = runVerb(db, 'createRecord', { name: 'The reader', description: 'd', track: line.id }, 'cli');
  const [a, b] = ['The parser', 'The writer'].map((name, i) => {
    const r = runVerb(db, 'createRecord', { name, description: 'd', track: line.id }, 'cli');
    const path = i ? 'server/version.json' : 'lib/parse.mjs';
    runVerb(db, 'commitLink', { repo: 'r', sha: String(i + 1).repeat(40), task: r.id, via: 'message', at: at(9).now.toISOString(), added: 5, removed: 0,
      files: [{ path, added: 5, removed: 0, counted: true }] }, at(9));
    runVerb(db, 'editRecord', { id: r.id, status: 'done' }, at(10));
    return r;
  });
  const view = () => t.trackView(db, { track: line.id });
  const band = () => u.bandCalls(db, {}, null).rows.filter((r) => r.kind === 'review' && r.id === line.id);
  assert.equal(view().review.due, true);
  assert.deepEqual(view().finished.map((f) => f.id), [a.id, b.id]);
  assert.equal(band().length, 1, 'the band shows the due row, with a press');
  assert.ok(band()[0].presses[0].url);
  const kick = runVerb(db, 'trackKickoff', { track: line.id }, 'cli').kickoff;
  assert.ok(kick.split('\n').some((l) => /due/i.test(l) && l.includes(a.id) && l.includes(b.id)), 'the kickoff names the uncovered tasks');
  assert.ok(reader.id === 'T-1' && kick.includes(reader.id) && !kick.includes('another project'), kick);
  set('review.ignore', ['server/version.json']);
  assert.equal(view().review.due, false, 'a commit of ignored files only is no code');
  assert.deepEqual(view().finished.map((f) => f.id), [a.id]);
  set('review.depth', 'off');
  assert.equal(view().review, null);
  assert.deepEqual(view().finished, []);
  assert.equal(band().length, 0);
});

test('at full depth a commit after a completed review leaves it completed and counts for the next review, upkeep completion included, and a finish waits for one or a waiver', () => {
  const db = board();
  const at = (h) => ({ session: 's1', now: new Date(2026, 10, 4, h) });
  runVerb(db, 'upkeepSwitch', { on: true }, 'cli');
  const line = t.newTrack(db, { workstream: 'WS-1', name: 'Gate' }, 'cli');
  runVerb(db, 'settingsSet', { key: 'review.depth', value: 'full', at: 'track', record: line.id }, 'cli');
  runVerb(db, 'settingsSet', { key: 'review.tasks', value: 1, at: 'track', record: line.id }, 'cli');
  const make = (name) => runVerb(db, 'createRecord', { name, description: 'd', track: line.id, ...(name.startsWith('Review') ? { labels: ['review'] } : {}) }, 'cli');
  const link = (task, sha, h) => runVerb(db, 'commitLink', { repo: 'r', sha: sha.repeat(40), task, via: 'message', at: at(h).now.toISOString(), added: 3, removed: 0 }, at(h));
  const [one, two, three, four, review] = ['The store', 'The reader', 'The index', 'The cache', 'Review the store'].map(make);
  const elsewhere = runVerb(db, 'createRecord', { name: 'Off the track', description: 'd', workstream: 'WS-1', wake: LATER }, 'cli');
  runVerb(db, 'editRecord', { id: two.id, close: 'with ' + elsewhere.id }, at(8));
  link(two.id, 'b', 9);
  for (const [x, sha] of [[one, 'a'], [three, 'e'], [four, 'f']]) {
    link(x.id, sha, 9);
    runVerb(db, 'editRecord', { id: x.id, status: 'done' }, at(10));
  }
  const status = (id) => db.prepare('SELECT status FROM records WHERE label = ?').get(id).status;
  const view = () => t.trackView(db, { track: line.id });
  runVerb(db, 'editRecord', { id: review.id, status: 'done' }, at(11));
  link(one.id, 'c', 12);
  /* the review stays completed; the commit is unreviewed work on the review-due line, and the finish locks on it */
  assert.equal(status(review.id), 'done', 'a commit after its cover leaves the review completed');
  assert.deepEqual([view().review.uncovered.map((x) => x.id), view().review.due, view().review.held], [[one.id], true, [one.id]]);
  const kick = runVerb(db, 'trackKickoff', { track: line.id }, 'cli').kickoff;
  assert.ok(kick.split('\n').some((l) => /due/i.test(l) && l.includes(one.id)), kick);
  /* upkeep closes the task that closes with another, past editRecord: finished after the review, it waits for the next one too */
  runVerb(db, 'editRecord', { id: elsewhere.id, status: 'done' }, at(14));
  assert.deepEqual([status(two.id), status(review.id), view().review.held], ['done', 'done', [one.id, two.id]]);
  /* a review the board reopened before the ruling is listed for the session to close, and closing it reads nothing new */
  runVerb(db, 'editRecord', { id: review.id, status: 'open' }, { by: 'board:review', now: at(14).now });
  assert.deepEqual([view().review.leftOpen.map((x) => x.id), view().review.planned], [[review.id], null]);
  assert.ok(runVerb(db, 'trackKickoff', { track: line.id }, 'cli').kickoff.includes('task edit ' + review.id + ' --status done'));
  runVerb(db, 'editRecord', { id: review.id, status: 'done' }, at(15));
  assert.deepEqual([view().review.held, view().review.leftOpen], [[one.id, two.id], undefined]);
  /* the next station reads them */
  const next = make('Review the fixes');
  runVerb(db, 'editRecord', { id: next.id, status: 'done' }, at(15));
  assert.deepEqual(view().review.held, []);
  const late = make('A late fix');
  link(late.id, 'd', 16);
  runVerb(db, 'editRecord', { id: late.id, status: 'done' }, at(16));
  assert.throws(() => runVerb(db, 'finishTrack', { track: line.id }, at(17)), (e) => e.message.includes(late.id) && !e.message.includes(one.id));
  const done = runVerb(db, 'finishTrack', { track: line.id, waive: 'a one-line fix' }, at(17));
  assert.equal(done.state, 'done');
  assert.match(lastLine(db, db.prepare('SELECT key FROM records WHERE label = ?').get(line.id).key).note, /waived: a one-line fix/);
});

test('a completed review stays completed for a later wave, work outside its given list or work an open review waits on, and a row from a record no longer a review counts for nothing', () => {
  const db = board();
  const at = (h) => ({ session: 's1', now: new Date(2026, 10, 4, h) });
  const line = t.newTrack(db, { workstream: 'WS-1', name: 'Waves' }, 'cli');
  runVerb(db, 'settingsSet', { key: 'review.depth', value: 'full', at: 'track', record: line.id }, 'cli');
  const make = (name, labels) => runVerb(db, 'createRecord', { name, description: 'd', track: line.id, ...(labels ? { labels } : {}) }, 'cli');
  const link = (task, sha, h) => runVerb(db, 'commitLink', { repo: 'r', sha: sha.repeat(40), task, via: 'message', at: at(h).now.toISOString(), added: 3, removed: 0 }, at(h));
  const [one, early, first, second] = ['Wave one', 'Filed early', 'Review wave one', 'Review wave two'].map((n) => make(n, n.startsWith('Review') ? ['review'] : undefined));
  const row = make('The review row', ['review']);
  const status = (id) => db.prepare('SELECT status FROM records WHERE label = ?').get(id).status;
  const covers = (id) => runVerb(db, 'coverage', { scope: line.id }, null).reviews.find((r) => r.id === id).covers.map((c) => c.id);
  const covered = (id) => runVerb(db, 'coverage', { scope: line.id }, null).tasks.find((x) => x.id === id).covered;
  link(one.id, 'a', 9);
  runVerb(db, 'editRecord', { id: one.id, status: 'done' }, at(10));
  runVerb(db, 'editRecord', { id: first.id, status: 'done' }, at(11));
  /* filed before the first review, begun and finished after it, with the next review open after it */
  runVerb(db, 'editRecord', { id: early.id, inHand: true, reason: 'wave two' }, at(12));
  link(early.id, 'b', 12);
  runVerb(db, 'editRecord', { id: early.id, status: 'done' }, at(13));
  assert.equal(status(first.id), 'done', 'the open review after it reads it');
  link(one.id, 'c', 14);
  assert.equal(status(first.id), 'done', 'a commit after its cover leaves it completed');
  /* a session's own reopen reads the new work again, and no work begun after its first cut */
  runVerb(db, 'editRecord', { id: first.id, status: 'open' }, at(14));
  runVerb(db, 'editRecord', { id: first.id, status: 'done' }, at(15));
  assert.deepEqual([covers(first.id), covered(one.id)], [[one.id], true], 'completing again takes no work begun after its first cut');
  /* a descriptive review label takes covers; once it comes off, its rows count for nothing */
  runVerb(db, 'editRecord', { id: row.id, status: 'done' }, at(16));
  assert.equal(covered(early.id), true);
  runVerb(db, 'editRecord', { id: row.id, removeLabel: ['review'] }, at(16));
  assert.equal(covered(early.id), false);
  runVerb(db, 'reviewCovers', { review: second.id, tasks: [early.id] }, at(17));
  assert.deepEqual(runVerb(db, 'reviewCovers', { review: second.id, none: true }, at(17)).covers, [], 'none clears the list');
  assert.deepEqual(covers(second.id), []);
  /* a list given by hand reads only its tasks, and an open review waiting on a task by edge
     is its station though filed before it; an umbrella in progress before both reviews completes after them */
  const tr = t.newTrack(db, { workstream: 'WS-1', name: 'Umbrella' }, 'cli');
  runVerb(db, 'settingsSet', { key: 'review.depth', value: 'full', at: 'track', record: tr.id }, 'cli');
  const put = (name) => runVerb(db, 'createRecord', { name, description: 'd', track: tr.id, ...(name.startsWith('Review') ? { labels: ['review'] } : {}) }, 'cli');
  const [a, b, release, umbrella, lane, given, picture] = ['Lane a', 'Lane b', 'Review the release', 'The umbrella', 'A late lane',
    'Review the conversion', 'Review the picture'].map(put);
  g.addEdge(db, { task: release.id, on: umbrella.id, reason: 'ships it' }, 'cli');
  for (const x of [umbrella, lane]) runVerb(db, 'editRecord', { id: x.id, inHand: true }, at(8));
  for (const [x, sha] of [[a, '1'], [b, '2']]) { link(x.id, sha, 9); runVerb(db, 'editRecord', { id: x.id, status: 'done' }, at(10)); }
  runVerb(db, 'reviewCovers', { review: given.id, tasks: [a.id, b.id] }, at(10));
  for (const x of [given, picture]) runVerb(db, 'editRecord', { id: x.id, status: 'done' }, at(11));
  /* rows from before the flag: the log says the list came from review covers, not the completion */
  db.prepare('UPDATE covers SET given = NULL WHERE review = (SELECT key FROM records WHERE label = ?)').run(given.id);
  link(umbrella.id, '3', 12);
  runVerb(db, 'editRecord', { id: umbrella.id, status: 'done' }, at(13));
  assert.deepEqual([status(given.id), status(picture.id)], ['done', 'done'], 'the release review waiting on it reads it');
  assert.equal(t.trackView(db, { track: tr.id }).review.planned, release.id);
  link(lane.id, '4', 13);
  runVerb(db, 'editRecord', { id: lane.id, status: 'done' }, at(14));
  assert.deepEqual([status(given.id), status(picture.id)], ['done', 'done'], 'late work waits for the next review');
  /* a running review whose given list holds late work is named as reading it; the planned one covers the rest */
  const reader = put('Review the lane');
  runVerb(db, 'reviewCovers', { review: reader.id, tasks: [lane.id] }, at(14));
  runVerb(db, 'editRecord', { id: reader.id, inHand: true }, at(14));
  const rv = t.trackView(db, { track: tr.id }).review;
  assert.deepEqual([rv.planned, rv.reading], [release.id, [{ id: reader.id, tasks: [lane.id] }]]);
  const said = reviewLine({ ...rv, due: true }, tr.id);
  assert.ok(said.includes(reader.id) && said.includes(release.id) && !said.includes('track layout'), said);
  link(a.id, '5', 15);
  const read = runVerb(db, 'coverage', { scope: tr.id }, null).reviews.find((r) => r.id === given.id);
  assert.deepEqual([status(given.id), read.covers.map((c) => c.id), read.given], ['done', [a.id, b.id], true], 'a given list stays completed and stands');
});

/* the conversion map, keyed by source per project: a put replaces a source's row, the read flags
   a record the board no longer holds, the undo drops its run's rows, and an export and import carry it. */
test('the conversion map keeps one row per source, flags a gone record, drops a run, and survives an export', (tt) => {
  const db = board();
  const kept = runVerb(db, 'createRecord', { name: 'Kept', description: 'd', workstream: 'WS-1', unplaced: 'a test', wake: LATER }, 'cli');
  const P = 'github.com/someone/project';
  runVerb(db, 'conversionPut', { project: P, run: 'r1', rows: [
    { source: 'docs/rules.md', kind: 'file', hash: 'aaa', sha: 'c1', records: [kept.id, 'T-99'] },
    { source: 'docs/plans/', kind: 'folder', fate: 'delete', sha: 'c1', why: 'history' },
    { source: 'run:r1', kind: 'run', sha: 'c1', detail: { folders: { 'docs/': 't1' } } },
  ] }, 'cli');
  runVerb(db, 'conversionPut', { project: P, run: 'r2', rows: [{ source: 'docs/rules.md', kind: 'file', hash: 'bbb', sha: 'c2', records: [kept.id] }, { source: 'call:dormant', kind: 'call', answer: 'b' }] }, 'cli');
  assert.throws(() => runVerb(db, 'conversionPut', { project: P, run: 'r3', rows: [{ source: 'x', kind: 'nope' }] }, 'cli'), /kind/);
  const map = runVerb(db, 'conversionMap', { project: P.toUpperCase() });
  const at = (s) => map.rows.find((r) => r.source === s);
  assert.deepEqual([at('docs/rules.md').hash, at('docs/rules.md').records, at('docs/rules.md').gone], ['bbb', [kept.id], undefined]);
  assert.equal(map.last.source, 'run:r1');
  const dir = join(tempDir('askerdo-store-', tt), 'export');
  exportStore(db, dir);
  const back = freshBoard();
  importStore(back, dir);
  assert.deepEqual(runVerb(back, 'conversionMap', { project: P }).rows.map((r) => r.source), map.rows.map((r) => r.source));
  /* undoing the later run gives the earlier run's row back; a folder end named in keep stays */
  const r2 = runVerb(db, 'conversionDrop', { project: P, run: 'r2' });
  assert.deepEqual([r2.dropped, r2.restored], [1, 1]);
  const after = runVerb(db, 'conversionMap', { project: P }).rows.find((r) => r.source === 'docs/rules.md');
  assert.deepEqual([after.hash, after.run], ['aaa', 'r1']);
  assert.equal(runVerb(db, 'conversionDrop', { project: P, run: 'r1', keep: 'docs/plans/' }).dropped, 2);
  assert.deepEqual(runVerb(db, 'conversionMap', { project: P }).rows.map((r) => r.source), ['docs/plans/']);
  /* a handoff and a rule line are checked too */
  runVerb(db, 'conversionPut', { project: P, run: 'r4', rows: [{ source: 'docs/x.md', kind: 'file', records: ['T-99', 'TR-77.1', 'nobody/no-such-line'] }] }, 'cli');
  assert.deepEqual(runVerb(db, 'conversionMap', { project: P }).rows.find((r) => r.source === 'docs/x.md').gone, ['T-99', 'TR-77.1', 'nobody/no-such-line'], 'a record the board lacks is gone');
});
