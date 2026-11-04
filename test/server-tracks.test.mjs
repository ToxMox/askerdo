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
const { reviewPlan } = await import('../server/web/draw.mjs');
const { runVerb } = await import('../server/verbs/index.mjs');

function board() {
  const db = freshBoard();
  putRecord(db, { key: 'ws000001', kind: 'workstream', fields: { id: 'WS-1', key: 'ws000001', name: 'Board', status: 'open', labelHistory: ['WS-1 2026-10-25'] }, body: '' });
  return db;
}
const task = (db, track, name) => t.capture(db, { track, name }, 'cli');
const complete = (db, key) => db.prepare("UPDATE records SET fields = json_set(fields, '$.status', 'completed') WHERE key = ?").run(key);
const lastLine = (db, key) => JSON.parse(db.prepare('SELECT line FROM activity WHERE record = ? ORDER BY seq DESC LIMIT 1').get(key).line);

test('splinter parks the parent with its junction, moves the lease, and finishing hands the junction back', () => {
  const db = board();
  const parent = t.newTrack(db, { name: 'Main line', workstream: 'WS-1', session: 's1' }, { session: 's1' });
  const at = task(db, parent.id, 'Where the idea came');
  g.startTask(db, { task: at.id }, { session: 's1' });
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

  /* a branch keeps the parent open with its lease, and the side's first task waits on the junction */
  const main = t.newTrack(db, { name: 'Second line', workstream: 'WS-1', session: 's2' }, { session: 's2' });
  const junction = task(db, main.id, 'Where the area splits');
  const [first, next] = ['Area first', 'Area next'].map((n) => task(db, main.id, n));
  g.addEdge(db, { task: next.id, on: first.id, reason: 'in order' }, 'cli');
  const area = t.splinter(db, { from: main.id, name: 'An area', at: junction.id, tasks: [first.id, next.id], park: false }, { session: 's2' });
  assert.deepEqual([t.trackSummary(db, { track: main.id }).state, t.trackSummary(db, { track: area.id }).state], ['active', 'new']);
  assert.deepEqual(area.tied, [first.id], 'only the first station waits on the junction');
  assert.equal(g.readiness(db, first.key).ready, false);
  complete(db, junction.key);
  assert.equal(g.readiness(db, first.key).ready, true);

  /* a closed parent takes no resume; a close lists the inbox it leaves */
  const loose = t.capture(db, { workstream: 'WS-1', name: 'Unplaced idea' }, 'cli');
  t.finishTrack(db, { track: main.id }, { session: 's2' });
  const closed = t.finishTrack(db, { track: area.id, leftovers: 'inbox' }, { session: 's2' });
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
  assert.equal(t.acquireLease(db, { track: tr.id }, { session: 's1', pc: 'pc1' }).acquired, true);
  const second = t.acquireLease(db, { track: tr.id }, { session: 's2' });
  assert.equal(second.acquired, false);
  assert.equal(second.holder.session, 's1');
  assert.equal(second.holder.pc, 'pc1');
  assert.deepEqual([...second.moves].sort(), ['read only', 'splinter', 'take over']);

  t.takeOver(db, { track: tr.id }, { session: 's2' });
  assert.deepEqual(lastLine(db, tr.key).changes.session, ['s1', 's2'], 'the row the first session hears it from');
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
  assert.throws(() => g.startTask(db, { task: b.id }, 'cli'), (e) => e instanceof g.TrackRefusal && e.message.includes(a.id + ' A'));
  assert.throws(() => w.editRecord(db, { id: b.id, status: 'in_progress' }, 'cli'), w.UsageError, 'a status edit asks the graph too');
  assert.throws(() => w.taskUpdate(db, { id: b.id, agent: 'implementer', reason: 'loose', priority: 'urgent' }, 'cli'), /priority/);
  assert.equal(g.readiness(db, b.key).status, 'open', 'a refused update writes none of its parts, the start included');
  assert.throws(() => w.editRecord(db, { id: b.id, inHand: true }, { session: 's1' }), /not ready/, 'taking it in hand asks the graph too');
  w.editRecord(db, { id: b.id, inHand: true, reason: 'pairing on it' }, { session: 's1' });
  assert.match(lastLine(db, b.key).note, /pairing on it/);
  g.startTask(db, { task: b.id, agent: 'implementer', reason: 'the edge is loose' }, 'cli');
  assert.deepEqual(g.trackGraph(db, tr.key).now.map((x) => [x.id, x.agent]), [[b.id, 'implementer']]);
  /* a started task no live hand backs is not running in the view every surface reads */
  const tv = (opts) => t.trackView(db, { track: tr.id }, opts);
  assert.deepEqual([tv().running, tv().stale.map((x) => x.id)], [0, [b.id]], 's1 holds no lease');
  assert.equal(graphOf([tv()], Date.now(), viewLook()).D.tasks[b.id].kind, 'left', 'the picture draws it as nobody on it');
  assert.equal(tv({ reader: 's1' }).running, 1, 'its own hand is live to its reader');
  t.newTrack(db, { name: 'Elsewhere', workstream: 'WS-1', session: 's1' }, { session: 's1' });
  assert.deepEqual([tv().running, tv().stale.length], [1, 0], 'a hand that holds a lease is live');
  w.editRecord(db, { id: b.id, priority: 'high' }, 'cli');
  const keys = Object.keys(JSON.parse(db.prepare('SELECT fields FROM records WHERE key = ?').get(b.key).fields));
  assert.ok(keys.includes('agent') && keys.indexOf('agent') < keys.indexOf('labelHistory'), 'an edit keeps agent in its place');
});

test('a promoted task is done when its side track is, and counts its side track on the critical path', () => {
  const db = board();
  const tr = t.newTrack(db, { name: 'Parent', workstream: 'WS-1' }, 'cli');
  const big = task(db, tr.id, 'Big task');
  const after = task(db, tr.id, 'After the big one');
  g.addEdge(db, { task: after.id, on: big.id, reason: 'needs it' }, 'cli');
  for (const s of ['one', 'two', 'three']) g.addItem(db, { task: big.id, text: s }, 'cli');
  g.checkItem(db, { task: big.id, item: 1 }, 'cli');

  const side = t.promoteTask(db, { task: big.id }, 'cli');
  assert.equal(side.state, 'new');
  assert.throws(() => w.editRecord(db, { id: big.id, status: 'completed' }, 'cli'), w.UsageError, 'its done follows its side track');
  assert.throws(() => t.dropTrack(db, { track: tr.id, reason: 'scrapped', leftovers: 'drop' }, 'cli'),
    (e) => e instanceof g.TrackRefusal && e.data.promoted[0].task === big.id, 'a parent closing under drop never drops it while its side track is open');  assert.equal(side.tasks.length, 3);
  assert.equal(g.progressOf(db, big.key).done, 1);
  assert.equal(g.readiness(db, after.key).ready, false);
  assert.equal(t.trackSummary(db, { track: tr.id }).toGo, 2, 'the open steps carry no edges, so they run side by side');
  g.addEdge(db, { task: side.tasks[2], on: side.tasks[1], reason: 'three needs two' }, 'cli');
  assert.equal(t.trackSummary(db, { track: tr.id }).toGo, 3, 'two steps in a row on the side track, then the task after');

  for (const id of side.tasks.slice(1)) complete(db, g.keyOf(db, id, 'task'));
  t.finishTrack(db, { track: side.id }, 'cli');
  assert.equal(g.readiness(db, big.key).status, 'completed');
  assert.equal(g.readiness(db, after.key).ready, true);
  assert.throws(() => w.editRecord(db, { id: big.id, status: 'open' }, 'cli'), w.UsageError, 'a done side track still owns its status');

  /* the longest chain ends on one side track, so only its promoted task is the end; the other is listed */
  const [p1, p2] = [task(db, tr.id, 'Promoted one'), task(db, tr.id, 'Promoted two')];
  for (const p of [p1, p2]) for (const s of ['a', 'b']) g.addItem(db, { task: p.id, text: s }, 'cli');
  const s1 = t.promoteTask(db, { task: p1.id }, 'cli');
  t.promoteTask(db, { task: p2.id }, 'cli');
  g.addEdge(db, { task: s1.tasks[1], on: s1.tasks[0], reason: 'b needs a' }, 'cli');
  assert.deepEqual(t.openLeaves(db, tr.key).map((x) => x.id).sort(), [after.id, p2.id].sort());
});

test('fold back puts the side track into the checklist and keeps its label resolving', () => {
  const db = board();
  const tr = t.newTrack(db, { name: 'Parent', workstream: 'WS-1' }, 'cli');
  const big = task(db, tr.id, 'Turned out small');
  for (const s of ['one', 'two']) g.addItem(db, { task: big.id, text: s }, 'cli');
  const side = t.promoteTask(db, { task: big.id }, 'cli');
  const [first] = side.tasks.map((id) => g.keyOf(db, id, 'task'));
  complete(db, first);
  addNote(db, first, { at: '2026-10-25', body: 'what step one found' });

  t.acquireLease(db, { track: side.id }, { session: 's1' });
  assert.throws(() => t.foldBack(db, { track: side.id }, 'cli'), g.TrackRefusal, 'not while a session holds it');
  t.releaseLease(db, {}, { session: 's1' });
  const letGo = t.trackSummary(db, { track: side.id });
  assert.deepEqual([letGo.state, letGo.noHandoff], ['waiting', true], 'held once, let go with no handoff');

  const r = t.foldBack(db, { track: side.id }, 'cli');
  assert.equal(r.state, 'folded');
  assert.equal(g.keyOf(db, side.id, 'track'), side.key);
  assert.equal(t.trackSummary(db, { track: side.id }).state, 'folded');
  assert.deepEqual(g.itemsOf(db, big.key).map((i) => [i.text, i.done]), [['one', true], ['two', false]]);
  assert.ok(db.prepare('SELECT body FROM notes WHERE record = ?').all(big.key).some((n) => n.body.includes('what step one found')));
  assert.equal(g.readiness(db, big.key).pointer, null, 'a plain task again');
});

/* The weekly export is the rollback: a track's tasks, edges, checklists and
   junction come back from its file, and the files come back byte for byte. */
test('a track file carries its tasks, edges, checklists and junction through an export and an import', (tt) => {
  const db = board();
  const tr = t.newTrack(db, { name: 'Main line', workstream: 'WS-1', session: 's1' }, { session: 's1' });
  const a = task(db, tr.id, 'First');
  const b = task(db, tr.id, 'Second');
  const loose = t.capture(db, { workstream: 'WS-1', name: 'In the inbox' }, 'cli');
  g.addEdge(db, { task: b.id, on: a.id, reason: 'b needs a' }, 'cli');
  g.addEdge(db, { task: loose.id, on: b.id, reason: 'after the line' }, 'cli');
  for (const s of ['one', 'two']) g.addItem(db, { task: a.id, text: s }, 'cli');
  g.addItem(db, { task: loose.id, text: 'inbox step' }, 'cli');
  g.checkItem(db, { task: a.id, item: 1 }, 'cli');
  const side = t.splinter(db, { from: tr.id, name: 'Side idea', at: a.id }, { session: 's1' });

  const dir = join(tempDir('askerdo-store-', tt), 'export');
  exportStore(db, dir);
  const back = freshBoard();
  importStore(back, dir);
  const rows = (d) => ['SELECT track, task, position FROM track_items ORDER BY task', 'SELECT task, "on", reason, added, actor FROM depends ORDER BY task, "on"',
    'SELECT task, position, text, done, done_at FROM checklist ORDER BY task, position', 'SELECT "from", "to", type, added FROM links ORDER BY "from", "to", type']
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
  const mine = t.newTrack(db, { workstream: 'WS-1', name: 'Release lane', session: 's9' }, S);
  const rel = runVerb(db, 'createRecord', { name: 'Release 1.0', description: 'd', track: mine.id }, S);
  assert.throws(() => runVerb(db, 'createRecord', { name: 'Fix the release notes', description: 'd', workstream: 'WS-1' }, S),
    (e) => e.message.includes('unplaced') && e.message.includes(mine.id));
  const before = runVerb(db, 'createRecord', { name: 'Notes', description: 'd', track: mine.id, before: [rel.id] }, S);
  const there = runVerb(db, 'createRecord', { name: 'Elsewhere', description: 'd', track: line.id }, S);
  const loose = runVerb(db, 'createRecord', { name: 'Someday', description: 'd', workstream: 'WS-1', unplaced: 'waits on the next design pass' }, S);
  const f = runVerb(db, 'trackFound', { track: mine.id }, null);
  const at = (id) => f.tasks.find((x) => x.id === id).where;
  assert.deepEqual([at(before.id).track, at(before.id).before], [mine.id, [rel.id]]);
  assert.equal(at(there.id).track, line.id);
  assert.equal(at(loose.id).reason, 'waits on the next design pass');
  const go = q.register(db, { name: 'release go', gist: 'Ready?', projectDir: 'C:/repo', session: 's9', blocking: true, ask: 'Ship (a) or wait (b)?', gates: [rel.id],
    options: [{ type: 'a', option: 'ship' }, { type: 'b', option: 'wait' }] }, null);
  assert.match(q.show(db, { id: go.id }).gist, new RegExp('Found this arc.*' + loose.id));
});

test('a review covers the code finished before it started; a fix finished after it, or a commit after its cover, reads uncovered', () => {
  const db = board();
  const at = (h) => ({ session: 's1', now: new Date(2026, 10, 4, h) });
  const line = t.newTrack(db, { workstream: 'WS-1', name: 'Coverage' }, 'cli');
  const [one, fix, review] = ['The schema', 'A fix', 'Review the schema'].map((name) => runVerb(db, 'createRecord', { name, description: 'd', track: line.id }, 'cli'));
  const link = (task, sha, h, n = 10) => runVerb(db, 'commitLink', { repo: 'r', sha: sha.repeat(40), task, via: 'message', at: at(h).now.toISOString(), added: n, removed: 0 }, at(h));
  link(one.id, 'a', 9);
  /* the PC retries a link: the row stays one and the log moves once */
  const lines = () => db.prepare("SELECT count(*) AS n FROM activity WHERE verb = 'commit'").get().n;
  assert.equal(link(one.id, 'a', 9).created, false);
  assert.equal(lines(), 1);
  assert.throws(() => link('T-404', 'b', 9), (e) => e.message.startsWith('no such task'));
  runVerb(db, 'editRecord', { id: one.id, status: 'completed' }, at(10));
  runVerb(db, 'editRecord', { id: review.id, status: 'in_progress', reason: 'reads the schema' }, at(11));
  link(fix.id, 'c', 12);
  runVerb(db, 'editRecord', { id: fix.id, status: 'completed' }, at(12));
  const done = runVerb(db, 'editRecord', { id: review.id, status: 'completed' }, at(13));
  assert.deepEqual(done.covers, [one.id], 'the default covers only what finished before the review started');
  const covered = () => Object.fromEntries(runVerb(db, 'coverage', { scope: line.id }, null).tasks.map((x) => [x.id, x.covered]));
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
  const line = t.newTrack(db, { workstream: 'WS-1', name: 'Due' }, 'cli');
  const set = (key, value) => runVerb(db, 'settingsSet', { key, value, at: 'track', record: line.id }, 'cli');
  set('review.tasks', 2);
  const [a, b] = ['The parser', 'The writer'].map((name, i) => {
    const r = runVerb(db, 'createRecord', { name, description: 'd', track: line.id }, 'cli');
    const path = i ? 'server/version.json' : 'lib/parse.mjs';
    runVerb(db, 'commitLink', { repo: 'r', sha: String(i + 1).repeat(40), task: r.id, via: 'message', at: at(9).now.toISOString(), added: 5, removed: 0,
      files: [{ path, added: 5, removed: 0, counted: true }] }, at(9));
    runVerb(db, 'editRecord', { id: r.id, status: 'completed' }, at(10));
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
  set('review.ignore', ['server/version.json']);
  assert.equal(view().review.due, false, 'a commit of ignored files only is no code');
  assert.deepEqual(view().finished.map((f) => f.id), [a.id]);
  set('review.depth', 'off');
  assert.equal(view().review, null);
  assert.deepEqual(view().finished, []);
  assert.equal(band().length, 0);
});

test('at full depth a review reopens when work it read changes, upkeep completion included, and a finish waits for one or a waiver', () => {
  const db = board();
  const at = (h) => ({ session: 's1', now: new Date(2026, 10, 4, h) });
  runVerb(db, 'upkeepSwitch', { on: true }, 'cli');
  const line = t.newTrack(db, { workstream: 'WS-1', name: 'Gate' }, 'cli');
  runVerb(db, 'settingsSet', { key: 'review.depth', value: 'full', at: 'track', record: line.id }, 'cli');
  const make = (name) => runVerb(db, 'createRecord', { name, description: 'd', track: line.id }, 'cli');
  const link = (task, sha, h) => runVerb(db, 'commitLink', { repo: 'r', sha: sha.repeat(40), task, via: 'message', at: at(h).now.toISOString(), added: 3, removed: 0 }, at(h));
  const [one, two, three, four, review] = ['The store', 'The reader', 'The index', 'The cache', 'Review the store'].map(make);
  const elsewhere = runVerb(db, 'createRecord', { name: 'Off the track', description: 'd', workstream: 'WS-1' }, 'cli');
  runVerb(db, 'editRecord', { id: two.id, close: 'with ' + elsewhere.id }, at(8));
  link(two.id, 'b', 9);
  for (const [x, sha] of [[one, 'a'], [three, 'e'], [four, 'f']]) {
    link(x.id, sha, 9);
    runVerb(db, 'editRecord', { id: x.id, status: 'completed' }, at(10));
  }
  const status = (id) => db.prepare('SELECT status FROM records WHERE label = ?').get(id).status;
  const covers = () => runVerb(db, 'coverage', { scope: line.id }, null).reviews.find((r) => r.id === review.id).covers.map((c) => c.id);
  const view = () => t.trackView(db, { track: line.id });
  runVerb(db, 'editRecord', { id: review.id, status: 'completed' }, at(11));
  link(one.id, 'c', 12);
  assert.equal(status(review.id), 'open', 'a commit after its cover reopens the review');
  /* the reopen drops only the outdated cover: one task to review, and the planned review draws no padlock */
  assert.deepEqual(covers(), [three.id, four.id]);
  assert.deepEqual(view().review.uncovered.map((x) => x.id), [one.id]);
  assert.equal(view().review.planned, review.id);
  const plan = reviewPlan(graphOf([view()], Date.now(), viewLook()).g);
  assert.equal(plan.count[review.id], 1);
  assert.deepEqual(plan.lock, {});
  /* a list narrowed while it is open survives its next completion, which adds the new work */
  runVerb(db, 'reviewCovers', { review: review.id, tasks: [three.id] }, at(12));
  runVerb(db, 'editRecord', { id: review.id, status: 'completed' }, at(13));
  assert.deepEqual(covers(), [one.id, three.id]);
  /* upkeep closes the task that closes with another, past editRecord */
  runVerb(db, 'editRecord', { id: elsewhere.id, status: 'completed' }, at(14));
  assert.equal(status(two.id), 'completed');
  assert.equal(status(review.id), 'open', 'a task before it completing after it reopens it');
  assert.match(db.prepare('SELECT body FROM notes WHERE record = (SELECT key FROM records WHERE label = ?) ORDER BY position DESC LIMIT 1').get(review.id).body, new RegExp(two.id));
  runVerb(db, 'editRecord', { id: review.id, status: 'completed' }, at(15));
  const late = make('A late fix');
  link(late.id, 'd', 16);
  runVerb(db, 'editRecord', { id: late.id, status: 'completed' }, at(16));
  assert.throws(() => runVerb(db, 'finishTrack', { track: line.id }, at(17)), (e) => e.message.includes(late.id) && !e.message.includes(one.id));
  const done = runVerb(db, 'finishTrack', { track: line.id, waive: 'a one-line fix' }, at(17));
  assert.equal(done.state, 'done');
  assert.match(lastLine(db, db.prepare('SELECT key FROM records WHERE label = ?').get(line.id).key).note, /waived: a one-line fix/);
  /* a hotfix on a finished track reopens nothing there */
  link(one.id, '9', 18);
  assert.equal(status(review.id), 'completed');
});
