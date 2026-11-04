/* The board server's work verbs and label resolution, over an in-memory board. The
   rendered files are read as the old reader split them, their fronts against the key
   order frozen from the old writers. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { freshBoard } from './helpers/board-db.mjs';
import { tempDir } from './helpers/sandbox.mjs';
import { frontText } from '../server/frontmatter.mjs';
import { fileParts, inTodaysOrder } from './helpers/old-store.mjs';

const w = await import('../server/verbs/work.mjs');
const L = await import('../server/verbs/labels.mjs');
const { decide, decisionsFor } = await import('../server/verbs/decisions.mjs');
const { recordHistory } = await import('../server/verbs/history.mjs');
const { putRecord } = await import('../server/records.mjs');
const { renderRecord } = await import('../server/render.mjs');
const u = await import('../server/verbs/upkeep.mjs');
const tr = await import('../server/verbs/tracks.mjs');
const { writeHandoff, resumeTrack } = await import('../server/verbs/handoffs.mjs');
const qv = await import('../server/verbs/questions.mjs');
const pf = await import('../server/verbs/profiles.mjs');
const pv = await import('../server/verbs/procedures.mjs');
const pr = await import('../server/verbs/projects.mjs');

/* noon on a day, as a session acting then */
const on = (day, session = 's1') => {
  const [y, m, d] = day.split('-').map(Number);
  return { session, now: new Date(y, m - 1, d, 12, 0, 0) };
};

/* The record's file as the export writes it. */
function fileOf(db, key) {
  const r = db.prepare('SELECT kind, fields, body, layout FROM records WHERE key = ?').get(key);
  const notes = db.prepare('SELECT at, body FROM notes WHERE record = ? ORDER BY position').all(key);
  return renderRecord({ kind: r.kind, fields: JSON.parse(r.fields), body: r.body, layout: r.layout ? JSON.parse(r.layout) : null }, notes);
}

const lines = (db) => db.prepare('SELECT line FROM activity ORDER BY seq').all().map((r) => JSON.parse(r.line));

/* An archived label is reused after its rest and a reopen after archive relabels;
   labels from before the cutover and ids from the old knowledge store resolve through
   their maps. */
test('labels rest and are reused by date, a reopen after archive relabels, and every old id still resolves', () => {
  const db = freshBoard();
  const a = w.createRecord(db, { kind: 'workstream', name: 'A', description: 'd' }, on('2026-01-01'));
  w.createRecord(db, { kind: 'workstream', name: 'B', description: 'd' }, on('2026-01-01'));
  w.closeRecord(db, { id: 'WS-1', outcome: 'done' }, on('2026-01-02'));
  /* closed 01-02: archived 01-16, resting until 02-15 */
  assert.equal(w.createRecord(db, { kind: 'workstream', name: 'C', description: 'd' }, on('2026-02-14')).id, 'WS-3');
  const d = w.createRecord(db, { kind: 'workstream', name: 'D', description: 'd' }, on('2026-02-15'));
  assert.equal(d.id, 'WS-1');
  assert.equal(L.resolveRecord(db, 'WS-1', { day: '2026-02-20' }).key, d.key);
  assert.equal(w.readRecord(db, a.key).name, 'A', 'the key still names the old record');
  w.reopenRecord(db, { id: a.key }, on('2026-03-01'));
  const back = w.readRecord(db, a.key);
  assert.equal(back.id, 'WS-4');
  assert.deepEqual(back.labelHistory, ['WS-1 2026-01-01 2026-01-16', 'WS-4 2026-03-01']);
  const r = L.resolveLabel(db, 'WS-1', { today: '2026-03-01' });
  assert.equal(r.live.key, d.key);
  assert.deepEqual(r.earlier.map((x) => [x.key, x.from, x.to, x.now]), [[a.key, '2026-01-01', '2026-01-16', 'WS-4']]);
  assert.equal(L.resolveLabel(db, 'WS-1', { at: '2026-01-10' }).record.key, a.key);
  assert.equal(L.resolveLabel(db, 'WS-1', { at: '2026-02-01' }).record, null);
  assert.equal(L.resolveLabel(db, 'WS-1', { at: '2026-02-20T09:00:00-05:00' }).record.key, d.key);

  /* a label from before the cutover names its old record on a day before it */
  const add = db.prepare('INSERT INTO labels (label, key, kind, "from", "to", origin, position, extra) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  add.run('WS-7', a.key, 'workstream', null, '2026-01-05', 'id-map', 0, JSON.stringify({ old: 'WS-7', key: a.key, name: 'A then' }));
  assert.equal(L.resolveLabel(db, 'WS-7', { at: '2026-01-03' }).record.key, a.key);
  /* an id from the old knowledge store names the knowledge record it became, by its
     label now */
  const k = w.createKnowledge(db, { type: 'gotcha', title: 'The cache misses on resize', global: true }, on('2026-03-02'));
  add.run('tidewatch:G-0001', k.key, null, null, null, 'brain', 0, JSON.stringify({ to: k.key }));
  assert.equal(L.resolveLegacy(db, 'G-0001').entry.label, k.id);
  assert.equal(L.resolveRecord(db, 'k-1').key, k.key, 'a typed label in any case');
});

/* A referenced workstream or plan must EXIST, and records match the spec skeletons'
   key order. */
test('a task is created under a workstream that exists, serves its outcomes, and its file reads back in today\'s order', () => {
  const db = freshBoard();
  const ws = w.createRecord(db, { kind: 'workstream', name: 'Board', description: 'One board.', outcomes: ['one board for every machine'] }, on('2026-10-25'));
  assert.throws(() => w.createRecord(db, { name: 'ghost', description: 'd', workstream: 'WS-9' }, on('2026-10-25')), /unknown workstream id: WS-9/);
  assert.throws(() => w.createRecord(db, { name: 'ghost', description: 'd', workstream: ws.id, serves: ['o2'] }, on('2026-10-25')), /no outcome o2/);
  const loose = w.createRecord(db, { name: 'Loose', description: 'd', workstream: ws.id }, on('2026-10-25'));
  assert.match(loose.warnings[0], /serves none of WS-1/, 'T-6: a flag, never a refusal');
  const t = w.createRecord(db, {
    name: 'Work verbs', description: 'Tasks over SQLite.', intent: 'Keep today\'s shapes.', workstream: ws.id,
    priority: 'high', labels: ['board'], refs: ['WS-1'], serves: ['o1'],
  }, on('2026-10-25'));
  assert.deepEqual(Object.keys(t).sort(), ['id', 'key', 'kind', 'name']);
  assert.equal(t.id, 'T-2');
  assert.equal(db.prepare('SELECT count(*) AS n FROM records').get().n, 3, 'a refused create wrote nothing');
  const created = lines(db).at(-1);
  assert.equal(created.verb, 'create');
  assert.deepEqual(created.changes.workstream, [null, 'WS-1'], 'the line shows labels, the record stores keys');
  for (const [kind, key] of [['workstream', ws.key], ['task', t.key]]) {
    const text = fileOf(db, key);
    const rec = fileParts(text);
    assert.ok(text.startsWith('---\n' + frontText(rec.front) + '---\n'), 'the front reads back:\n' + text);
    assert.ok(inTodaysOrder(kind, Object.keys(rec.front)), 'today\'s key order:\n' + text);
  }
  const rec = fileParts(fileOf(db, t.key));
  assert.equal(rec.front.workstream, ws.key);
  assert.equal(rec.sections.Intent, 'Keep today\'s shapes.');
  assert.deepEqual(w.listWork(db, { kind: 'task', workstream: 'WS-1' }).map((x) => x.id), ['T-1', 'T-2']);
});

/* Edit flips exactly the named fields plus updated, and an edit that changes no value
   writes nothing. */
test('an edit moves only what it names, a no-op writes nothing, a stale version is refused, and a session holds several tasks in hand', () => {
  const db = freshBoard();
  const t1 = w.createRecord(db, { name: 'One', description: 'd' }, on('2026-10-25'));
  const t2 = w.createRecord(db, { name: 'Two', description: 'd' }, on('2026-10-25'));
  const before = w.readRecord(db, t1.id);
  const r = w.editRecord(db, { id: t1.id, name: 'One again', status: 'in_progress', addLabel: ['hub', 'hub'], inHand: true }, on('2026-10-26'));
  assert.deepEqual(r.changed, ['name', 'status', 'labels', 'inHand']);
  const after = w.readRecord(db, t1.id);
  assert.equal(after.name, 'One again');
  assert.deepEqual(after.labels, ['hub']);
  assert.equal(after.inHand, 's1');
  assert.equal(after.created, before.created);
  assert.equal(after.description, before.description);
  assert.notEqual(after.updated, before.updated);

  const seq = lines(db).length;
  const same = w.editRecord(db, { id: t1.id, status: 'in_progress', addLabel: ['hub'] }, on('2026-10-27'));
  assert.deepEqual(same.changed, []);
  assert.equal(lines(db).length, seq, 'a no-op leaves no activity row');
  assert.equal(w.readRecord(db, t1.id).version, after.version, 'and no new version');
  assert.throws(() => w.editRecord(db, { id: t1.id, name: 'x', version: after.version - 1 }, on('2026-10-27')), w.ConflictError);
  assert.throws(() => w.editRecord(db, { id: t1.id, ordinal: 5 }, on('2026-10-27')), /track/, 'a task\'s place is its track');

  /* a second take keeps the first, newest first */
  w.editRecord(db, { id: t2.id, inHand: true }, on('2026-10-27'));
  assert.deepEqual(w.heldTask(db, { session: 's1' }).map((t) => t.id), [t2.id, t1.id]);
  /* a held task names its holder and moves only by a take-over */
  assert.throws(() => w.taskUpdate(db, { id: t2.id, inHand: true }, { ...on('2026-10-28', 's2'), pc: 'pc2' }), (e) => /in hand with a session \(took it yesterday/.test(e.message) && !/\bs1\b/.test(e.message));
  /* the answer says which way the hand moved */
  assert.equal(w.taskUpdate(db, { id: t2.id, inHand: true, takeOver: true }, on('2026-10-28', 's2')).hand, 'taken');
  assert.deepEqual(lines(db).at(-1).changes.inHand, ['s1', 's2'], 'the row the first session hears it from');
  assert.deepEqual(w.heldTask(db, { session: 's1' }).map((t) => t.id), [t1.id]);
  assert.equal(w.taskUpdate(db, { id: t2.id, letGo: true }, on('2026-10-28', 's2')).hand, 'let go');

  /* a task's intent rewrites in place before its work starts; after a note, the note is the amend */
  const t3 = w.createRecord(db, { name: 'Three', description: 'd', intent: 'first plan' }, on('2026-10-25'));
  w.editRecord(db, { id: t3.id, intent: 'second plan' }, on('2026-10-25'));
  assert.equal(w.readRecord(db, t3.id).intent, 'second plan');
  w.noteRecord(db, { id: t3.id, text: 'found a snag' }, on('2026-10-26'));
  assert.throws(() => w.editRecord(db, { id: t3.id, intent: 'third plan' }, on('2026-10-26')), /has started[\s\S]*note T-3/);
  assert.equal(w.readRecord(db, t3.id).intent, 'second plan');
});

/* A linked wake lands in the ENDING verb's own write, never a second one. */
test('an ending wakes the questions snoozed on it in the same transaction, and gates read through links', () => {
  const db = freshBoard();
  const t = w.createRecord(db, { name: 'Counter', description: 'd' }, on('2026-10-25'));
  const ask = (key, id, fields) => putRecord(db, { key, kind: 'question', slug: 'q', body: '', fields: { id, key, name: id + ' asks', status: 'snoozed', ...fields } });
  ask('qqqqqqq1', 'Q1', { snooze: { wakeOn: t.key, wakeStatus: 'completed' }, answered: undefined });
  ask('qqqqqqq2', 'Q2', { status: 'open', blocking: true, gates: [t.key] });
  assert.deepEqual(w.waitsOn(db, t.id).map((q) => [q.id, q.blocking]), [['Q2', true]]);

  w.editRecord(db, { id: t.id, status: 'completed' }, { ...on('2026-10-26'), pc: 'pc-1' });
  const q = L.resolveRecord(db, 'Q1').front;
  assert.equal(q.status, 'open');
  assert.equal(q.wokeBy, t.id + ' completed');
  assert.equal(q.snooze, undefined);
  assert.deepEqual(Object.keys(q), ['id', 'key', 'name', 'status', 'wokeBy'], 'the echo sits where the snooze was');
  const [edit, wake] = lines(db).slice(-2);
  assert.deepEqual([edit.verb, wake.verb, wake.id], ['edit', 'wake', 'Q1']);
  assert.equal(edit.ts, wake.ts, 'one instant');
  assert.deepEqual([edit.by, 'pc' in edit], ['session:s1', false], "the line keeps today's by");
  assert.deepEqual(db.prepare('SELECT pc FROM activity ORDER BY seq DESC LIMIT 2').all().map((r) => r.pc), ['pc-1', 'pc-1'], 'the PC sits beside the line');
  const done = w.readRecord(db, t.id);
  assert.match(done.closed, /^2026-10-26T/);
  w.editRecord(db, { id: t.id, status: 'open' }, on('2026-10-27'));
  assert.equal(w.readRecord(db, t.id).closed, undefined, 'moving out of an ending clears closed');
});

/* Note appends one stamped paragraph and creates the optional workstream Journal when
   it is absent. */
test('note appends a stamped note, gives a journal-less workstream its Journal, and takes no question', () => {
  const db = freshBoard();
  putRecord(db, {
    key: 'wwwwwwww', kind: 'workstream', slug: 'bare', layout: { journal: false }, body: '\n## Description\n\nBare.\n',
    fields: { id: 'WS-1', key: 'wwwwwwww', name: 'Bare', status: 'open', created: '2026-10-01', updated: '2026-10-01', labelHistory: ['WS-1 2026-10-01'] },
  });
  assert.equal(fileParts(fileOf(db, 'wwwwwwww')).sections.Journal, undefined);
  const n = w.noteRecord(db, { id: 'WS-1', text: 'the workstream opened\n# not a heading' }, on('2026-10-25'));
  const rec = fileParts(fileOf(db, 'wwwwwwww'));
  assert.deepEqual(Object.keys(rec.sections), ['Description', 'Journal']);
  assert.equal(rec.sections.Journal, n.note);
  assert.equal(rec.front.updated, n.note.slice(0, 25));
  w.noteRecord(db, { id: 'WS-1', text: 'and again' }, on('2026-10-26'));
  assert.match(w.readRecord(db, 'WS-1').journal, /# not a heading\n\n2026-10-26T12:00:00[+-]\d\d:\d\d: and again$/);
  assert.equal(lines(db).at(-1).note, 'and again');
  putRecord(db, { key: 'qqqqqqq1', kind: 'question', slug: 'q', body: '', fields: { id: 'Q1', key: 'qqqqqqq1', name: 'q', status: 'open' } });
  assert.throws(() => w.noteRecord(db, { id: 'Q1', text: 'x' }, on('2026-10-26')), /is a question/);
});

/* Knowledge supersede mints the replacement or links one, and a superseded record
   stays put. */
test('knowledge supersede mints or links the replacement, a superseded fact stays superseded, and the open list leaves it out', () => {
  const db = freshBoard();
  const fact = { type: 'gotcha', title: 'The cache misses on resize', projects: ['C:/repos/app'] };
  w.createKnowledge(db, { ...fact, legacy: 'tidewatch:G-0001' }, on('2026-10-25'));
  assert.throws(() => w.createKnowledge(db, { ...fact, legacy: 'tidewatch:G-0001' }, on('2026-10-25')), /is already K-1/);
  const r = w.supersedeKnowledge(db, { id: 'K-1', title: 'The corrected cause', body: 'It was the stale key.' }, on('2026-10-25'));
  assert.equal(r.supersededBy, 'K-2');
  assert.equal(w.readRecord(db, 'K-1').status, 'superseded');
  assert.equal(w.readRecord(db, 'K-1').supersededBy, 'K-2');
  assert.deepEqual(w.readRecord(db, 'K-2').projectRepos, ['c:/repos/app'], 'the scope is inherited');
  assert.throws(() => w.supersedeKnowledge(db, { id: 'K-1', by: 'K-2' }, on('2026-10-25')), /already superseded by K-2/);
  assert.throws(() => w.reopenRecord(db, { id: 'K-1' }, on('2026-10-25')), /no reopen verb/);
  w.createKnowledge(db, { ...fact, title: 'third' }, on('2026-10-25'));
  assert.equal(w.supersedeKnowledge(db, { id: 'K-3', by: 'K-2' }, on('2026-10-25')).created, null);
  assert.deepEqual(w.listWork(db, { kind: 'knowledge' }).map((e) => e.id), ['K-2']);
  assert.deepEqual(w.listWork(db, { kind: 'knowledge', all: true }).map((e) => e.id), ['K-1', 'K-2', 'K-3']);
  const text = fileOf(db, L.resolveRecord(db, 'K-2').key);
  const rec = fileParts(text);
  assert.ok(text.startsWith('---\n' + frontText(rec.front) + '---\n') && inTodaysOrder('knowledge', Object.keys(rec.front)), text);
  assert.equal(rec.sections.Body, 'It was the stale key.');

  /* one decide call lands the ruling's links and the supersede together */
  const ws = w.createRecord(db, { kind: 'workstream', name: 'Rulings', description: 'd' }, on('2026-10-25'));
  const task = w.createRecord(db, { name: 'Wire the rows', description: 'd', workstream: ws.id }, on('2026-10-25'));
  const was = w.createKnowledge(db, { type: 'decision', title: 'Cards first', tasks: [task.id], projects: ['C:/repos/app'] }, on('2026-10-25'));
  const d = decide(db, {
    title: 'Rows first', words: 'rows, not cards', tasks: [task.id], workstreams: [ws.id], files: ['lib\\*.mjs'], commands: ['npm test'],
    supersedes: was.id, projects: ['C:/repos/app'],
  }, on('2026-10-26'));
  assert.deepEqual([d.superseded, w.readRecord(db, was.id).supersededBy], [[was.id], d.id]);
  const back = w.readRecord(db, d.id);
  assert.deepEqual([back.tasks, back.workstreams, back.labels, back.files], [[task.id], [ws.id], [ws.id], ['lib/*.mjs']]);
  assert.deepEqual(decisionsFor(db, { task: task.id }).map((x) => x.id), [d.id], 'the superseded one is out of force');

  /* rewritten in place until another session reads it; then an amend keeps the number and the old text */
  const k = w.createKnowledge(db, { type: 'decision', title: 'Bands first', body: 'bands', global: true, session: 's1' }, on('2026-10-26'));
  assert.deepEqual(w.editKnowledge(db, { id: k.id, body: 'bands, then rows' }, on('2026-10-26')).changed, ['body']);
  w.readRecord(db, { id: k.id, session: 's1' });
  w.editKnowledge(db, { id: k.id, name: 'Bands come first' }, on('2026-10-26'));
  w.readRecord(db, { id: k.id, session: 's2' });
  assert.throws(() => w.editKnowledge(db, { id: k.id, body: 'rows' }, on('2026-10-27')), (e) => /in use \(.*read it/.test(e.message) && !/\bs2\b/.test(e.message));
  /* the lease names the caller's device, as the amend does, never the hostname its input sent */
  const desk = { ...on('2026-10-27', 's2'), pc: 'DESK' };
  const line = tr.newTrack(db, { name: 'Desk line', workstream: ws.id }, 'cli');
  tr.acquireLease(db, { track: line.id, session: 's2', pc: 'OTHERPC' }, desk);
  w.amendKnowledge(db, { id: k.id, body: 'and cards last' }, desk);
  assert.equal(resumeTrack(db, { track: line.id, session: 's3' }, on('2026-10-27', 's3')).holder.pc, 'DESK');
  const amended = w.readRecord(db, k.id);
  assert.equal(amended.id, k.id, 'the number is kept');
  assert.match(amended.sections.Body, /^bands, then rows\n\nAmended 2026-10-27 .*and cards last$/);
  /* the stored paragraph names the writer's PC by name, never its session id */
  assert.ok(amended.sections.Body.includes('DESK') && !/\bs2\b/.test(amended.sections.Body), amended.sections.Body);
  assert.match(amended.amended, /^2026-10-27T/);
  const rows = recordHistory(db, { id: k.id }).rows;
  assert.deepEqual(rows.filter((r) => r.field === 'body').map((r) => r.old), ['bands', 'bands, then rows'], 'every old text is kept');
  assert.match(lines(db).at(-1).changes.history[1], /^#\d+$/, 'the activity line names the history row, not the text');
  /* an amend that names no session names its writer in words, never the raw actor */
  w.amendKnowledge(db, { id: k.id, body: 'checked from a shell' }, { now: on('2026-10-28').now, pc: 'DESK' });
  const plain = w.readRecord(db, k.id).sections.Body.split('\n\n').at(-1);
  assert.ok(plain.includes('DESK') && !/\bcli\b/.test(plain), plain);
});

/* the board keeps itself current while upkeep is on, each change by board:upkeep with its cause. */
const upkeepBoard = () => {
  const db = freshBoard();
  const ws = w.createRecord(db, { kind: 'workstream', name: 'Upkeep', description: 'd', projectRepos: ['github.com/me/app'] }, on('2026-10-25'));
  return { db, ws };
};
const statusOf = (db, id) => L.resolveRecord(db, id).front.status;

test('with upkeep on a task taken in hand reads in progress, and back to open after a handoff lets it go', () => {
  const { db, ws } = upkeepBoard();
  const line = tr.newTrack(db, { name: 'Hand line', workstream: ws.id, session: 's1' }, { session: 's1' });
  const t = tr.capture(db, { track: line.id, name: 'Wire it' }, 'cli');
  u.upkeepSwitch(db, { on: true }, 'cli');
  w.taskUpdate(db, { id: t.id, inHand: true }, { session: 's1' });
  assert.equal(statusOf(db, t.id), 'in_progress');
  assert.equal(lines(db).at(-1).by, 'board:upkeep');
  const h = writeHandoff(db, { track: line.id, focus: 'Go on.', state: 'Wired half.', verify: [{ path: 'C:/repo' }], session: 's1' }, { session: 's1' });
  assert.deepEqual([statusOf(db, t.id), h.inHand], ['open', [t.id]], 'let go, and the handoff names it');
  assert.ok(lines(db).filter((l) => l.id === t.id).at(-1).note.includes(h.id), 'the cause names the handoff');
  resumeTrack(db, { track: line.id, session: 's2' }, { session: 's2' });
  assert.equal(statusOf(db, t.id), 'in_progress', 'the resume gives it back in hand');
});

test('a task closes when the task its close names completes; a look task never closes on its own and shows as a band call once landed', () => {
  const { db, ws } = upkeepBoard();
  const [first, after, look] = ['First', 'After', 'Looked at'].map((name) => w.createRecord(db, { name, description: 'd', workstream: ws.id }, on('2026-10-25')));
  u.upkeepSwitch(db, { on: true }, 'cli');
  w.editRecord(db, { id: after.id, close: 'with ' + first.id }, on('2026-10-26'));
  const logged = lines(db).at(-1).changes.close;
  assert.ok(logged[0] === null && logged[1].startsWith('with ' + first.id), 'the old and the new condition, by label: ' + logged);
  assert.throws(() => w.editRecord(db, { id: look.id, landed: true }, on('2026-10-26')), /look/, 'landed is for a look task');
  w.editRecord(db, { id: look.id, close: 'look' }, on('2026-10-26'));

  w.editRecord(db, { id: first.id, status: 'completed' }, on('2026-10-27'));
  assert.equal(statusOf(db, after.id), 'completed');
  const closed = lines(db).find((l) => l.id === after.id && l.by === 'board:upkeep');
  assert.ok(closed.note.includes(first.id), closed.note);
  assert.equal(statusOf(db, look.id), 'open');
  assert.deepEqual(u.bandCalls(db, {}, on('2026-10-27')).rows, [], 'no call before it lands');

  w.editRecord(db, { id: look.id, landed: true }, on('2026-10-27'));
  const [row] = u.bandCalls(db, {}, on('2026-10-27')).rows;
  assert.deepEqual([row.kind, row.record, row.presses.map((p) => p.label)], ['look', look.key, ['Close', 'Not yet']]);
  assert.equal(statusOf(db, look.id), 'open', 'landed is not a close');
  const notYet = row.presses[1];
  u[notYet.verb](db, notYet.input, { user: true });
  assert.deepEqual(u.bandCalls(db, {}, on('2026-10-27')).rows, []);
  /* an empty workstream past a stall is a call; an empty inbox never is */
  const empty = w.createRecord(db, { kind: 'workstream', name: 'Empty', description: 'd' }, on('2026-10-01'));
  const inbox = w.createRecord(db, { kind: 'workstream', name: 'app: inbox', description: 'd', labels: ['inbox'] }, on('2026-10-01'));
  const judged = u.bandCalls(db, {}, on('2026-11-30')).rows.filter((x) => x.kind === 'judgment').map((x) => x.record);
  assert.ok(judged.includes(empty.key) && !judged.includes(inbox.key), String(judged));
});

test('the dry run lists the catch-up without writing, upkeep on applies the same list, and its calls reach a session that holds nothing', () => {
  const { db, ws } = upkeepBoard();
  const [stale, held, done, follows] = ['Stale', 'Held', 'Done', 'Follows'].map((name) => w.createRecord(db, { name, description: 'd', workstream: ws.id }, on('2026-10-25')));
  w.editRecord(db, { id: stale.id, status: 'in_progress' }, on('2026-10-25'));
  w.editRecord(db, { id: held.id, inHand: true }, on('2026-10-25'));
  w.editRecord(db, { id: follows.id, close: 'with ' + done.id }, on('2026-10-25'));
  w.editRecord(db, { id: done.id, status: 'completed' }, on('2026-10-25'));
  assert.deepEqual([stale, held, follows].map((t) => statusOf(db, t.id)), ['in_progress', 'open', 'open'], 'off, nothing moves');

  const count = () => db.prepare('SELECT count(*) AS n FROM activity').get().n;
  const before = count();
  const dry = u.upkeepDryRun(db, {}, on('2026-11-01'));
  assert.equal(count(), before, 'the dry run writes nothing');
  assert.equal(u.upkeepOn(db), false);
  const acts = (list) => list.map((c) => c.act + ' ' + c.id + ': ' + c.cause);
  assert.deepEqual(dry.changes.map((c) => c.act + ' ' + c.id).sort(), ['back to open ' + stale.id, 'close ' + follows.id, 'in progress ' + held.id].sort());
  /* the catch-up's own writes are no movement, so the stalled inbox stays a call */
  const inbox = (rows) => rows.filter((x) => x.kind === 'judgment' && x.record === ws.key).map((x) => x.since.slice(0, 10));
  assert.deepEqual(inbox(dry.bandCalls), ['2026-10-25']);
  const r = u.upkeepSwitch(db, { on: true }, on('2026-11-01'));
  assert.deepEqual(acts(r.changes), acts(dry.changes));
  assert.deepEqual([stale, held, follows].map((t) => statusOf(db, t.id)), ['open', 'in_progress', 'completed']);
  /* a fresh session in the workstream's project sees it; one in another project does not */
  const calls = (repo) => inbox(u.bandCalls(db, { session: 'fresh', projectRepo: repo }, on('2026-11-02')).rows);
  assert.deepEqual([calls('github.com/me/app'), calls('github.com/me/other')], [['2026-10-25'], []]);
});

/* the user's override of a record in use, decided by Allow or Keep (the user actor) */
const o = await import('../server/verbs/override.mjs');
const { backup, pickCopy, restore } = await import('../server/maint.mjs');
const { openDb } = await import('../server/db.mjs');
const { migrate } = await import('../server/migrate.mjs');
const { search } = await import('../server/verbs/search.mjs');
const pressed = (day) => ({ ...on(day), user: 's1' });
/* the user's act under its new name */
const user = (day) => ({ ...on(day), by: 'user:s1' });
const ask = (db, kind, items, day, session = 's1') => o.overrideRequest(db, { kind, items, reason: 'an import wrote it wrong', summary: 'Fix what the import wrote' }, on(day, session));

test('an override: Allow fixes a used record and keeps the old text; Keep stops the same ask; a note leaves a waiting request, a changed text voids it', () => {
  const db = freshBoard();
  const k = w.createKnowledge(db, { type: 'gotcha', title: 'The board port', body: 'The port is 1748.', global: true, session: 's1' }, on('2026-10-20'));
  assert.throws(() => ask(db, 'fix', [{ record: k.id, body: 'The port is 17480.' }], '2026-10-21'), /not in use yet: rewrite it in place/);
  w.readRecord(db, { id: k.id, session: 's2' });
  const r = ask(db, 'fix', [{ record: k.id, body: 'The port is 17480.' }], '2026-10-21');
  /* one field fixed carries its words now and as proposed, on the answer and the band row */
  const was = { before: 'The port is 1748.', after: 'The port is 17480.' };
  assert.deepEqual([r.change, u.bandCalls(db, {}, on('2026-10-21')).rows[0].change].map((c) => ({ before: c.before, after: c.after })), [was, was]);
  assert.ok(!/;/.test(r.measured), r.measured);
  assert.throws(() => ask(db, 'fix', [{ record: k.id, name: 'Port' }], '2026-10-21', 's3'), (e) => /override #1 waiting/.test(e.message) && !/\bs1\b/.test(e.message));
  w.noteRecord(db, { id: k.id, text: 'seen on staging' }, on('2026-10-22', 's3'));
  assert.throws(() => o.overrideDecide(db, { request: r.request, decision: 'allow' }, on('2026-10-22')), /the user's own press/);
  o.overrideDecide(db, { request: r.request, decision: 'allow' }, pressed('2026-10-22'));
  const back = w.readRecord(db, k.id);
  assert.equal(back.sections.Body, 'The port is 17480.');
  assert.match(back.corrected, /^2026-10-22T/);
  assert.deepEqual(recordHistory(db, { id: k.id }).rows.map((x) => [x.old, x.new]), [['The port is 1748.', 'The port is 17480.']]);

  const again = ask(db, 'fix', [{ record: k.id, body: 'The port is 9.' }], '2026-10-23');
  o.overrideDecide(db, { request: k.id, decision: 'keep' }, user('2026-10-23'));
  assert.equal(w.readRecord(db, k.id).sections.Body, 'The port is 17480.');
  assert.throws(() => ask(db, 'fix', [{ record: k.id, body: 'The port is 9.' }], '2026-10-24'), /kept it as written/);
  assert.ok(!w.readRecord(db, k.id).journal.includes('The port is 9.'), 'the Keep note carries no proposed text');

  const moved = ask(db, 'fix', [{ record: k.id, body: 'The port is 1.' }], '2026-10-24');
  assert.notEqual(moved.request, again.request);
  w.amendKnowledge(db, { id: k.id, body: 'on the LAN' }, on('2026-10-24', 's2'));
  assert.throws(() => o.overrideDecide(db, { request: moved.request, decision: 'allow' }, pressed('2026-10-25')), /changed since asked/);
  const [row] = u.bandCalls(db, {}, on('2026-10-25')).rows;
  assert.deepEqual([row.kind, row.changed, row.presses.map((p) => p.label)], ['override', true, ['Keep']]);
  assert.match(w.readRecord(db, k.id).sections.Body, /17480.*\n\nAmended/s, 'nothing was applied');

  /* expired unanswered: the band row's Keep is the only press, Allow is refused, the asker hears it */
  o.overrideDecide(db, { request: moved.request, decision: 'keep' }, pressed('2026-10-25'));
  const late = ask(db, 'fix', [{ record: k.id, body: 'The port is 2.' }], '2026-10-25');
  const [stale] = u.bandCalls(db, {}, on('2026-11-30')).rows;
  assert.deepEqual([stale.expired, stale.presses.map((p) => p.label)], [true, ['Keep']]);
  assert.throws(() => o.overrideDecide(db, { request: late.request, decision: 'allow' }, pressed('2026-11-30')), /expired/);
  const drop = lines(db).at(-1).changes;
  assert.deepEqual([drop.dropped[1], drop.asker[1]], ['expired', 's1'], 'the drop names the asker for its inbox');
});

test('an override batch rewrites tasks all or nothing and sets each close; a batch holding a ruling is refused', () => {
  const { db, ws } = upkeepBoard();
  const [a, b, c] = ['Alpha', 'Beta', 'Gamma'].map((name) => w.createRecord(db, { name, description: 'old ' + name, workstream: ws.id }, on('2026-10-25')));
  for (const t of [a, b]) w.noteRecord(db, { id: t.id, text: 'started' }, on('2026-10-25'));
  const ruling = decide(db, { title: 'Rows first', words: 'rows', global: true }, on('2026-10-25'));
  w.readRecord(db, { id: ruling.id, session: 's2' });
  const items = [{ record: a.id, intent: 'Alpha, clean', close: { kind: 'with', task: c.id } }, { record: b.id, description: 'Beta, clean', close: { kind: 'look' } }];
  assert.throws(() => ask(db, 'fix', [...items, { record: ruling.id, name: 'Rows' }], '2026-10-26'), /not rulings: K-\d+ is a ruling/);
  const dry = o.overrideRequest(db, { kind: 'fix', items, reason: 'T-316: one clean intent and close per task', summary: 'Two tasks', dryRun: true }, on('2026-10-26'));
  assert.deepEqual([dry.dryRun, dry.measure.records, db.prepare('SELECT count(*) AS n FROM overrides').get().n], [true, 2, 0], 'a dry run measures and writes nothing');
  const first = ask(db, 'fix', items, '2026-10-26');
  w.editRecord(db, { id: b.id, close: 'when the look is done' }, on('2026-10-26'));
  assert.throws(() => o.overrideDecide(db, { request: first.request, decision: 'allow' }, pressed('2026-10-27')), /changed since asked \(T-\d+\)/);
  assert.equal(w.readRecord(db, a.id).intent, '', 'nothing of the batch applied');

  const r = ask(db, 'fix', items, '2026-10-27');
  assert.notEqual(r.request, first.request, 'asked again from the text as it stands, it replaces the stale request');
  const [row] = u.bandCalls(db, { session: 's1' }, on('2026-10-27')).rows;
  assert.deepEqual([row.kind, row.count, row.mine, row.presses.map((p) => p.label)], ['override', 2, true, ['Allow', 'Keep']], 'the asker sees its own row');
  o[row.presses[0].verb](db, row.presses[0].input, pressed('2026-10-27'));
  assert.deepEqual([w.readRecord(db, a.id).intent, w.readRecord(db, b.id).description], ['Alpha, clean', 'Beta, clean']);
  const closeOf = (id) => L.resolveRecord(db, id).front.close;
  assert.deepEqual([closeOf(a.id), closeOf(b.id)], [{ kind: 'with', on: c.key }, { kind: 'look' }]);
  assert.equal(db.prepare('SELECT count(*) AS n FROM overrides').get().n, 0, 'the row goes');
  assert.equal(lines(db).at(-1).changes.asker[1], 's1', 'the decision names the asking session for its inbox');

  /* a ruling's quoted words an import wrote wrong are fixable, as a reversal */
  const fix = ask(db, 'fix', [{ record: ruling.id, words: 'rows, then  columns' }], '2026-10-27');
  assert.equal(fix.reversal, true);
  const [shown] = o.overrideView(db, { request: fix.request }, on('2026-10-27')).records;
  assert.deepEqual(shown.fields.map((f) => [f.before, f.after]), [['rows', 'rows, then columns']], 'the page shows the old and new words');
  o.overrideDecide(db, { request: fix.request, decision: 'allow' }, pressed('2026-10-27'));
  assert.equal(L.resolveRecord(db, ruling.id).front.words, 'rows, then columns');
  assert.deepEqual(recordHistory(db, { id: ruling.id }).rows.map((x) => [x.field, x.old]), [['words', 'rows']], 'the old words kept');
});

test('a scrub hides the text from the record, search and activity at once; unscrub puts it back inside 7 days; after that it reads as purged', () => {
  const { db, ws } = upkeepBoard();
  const secret = 'tok-hunter2-secret';
  const t = w.createRecord(db, { name: 'Wire the token', description: 'use ' + secret, workstream: ws.id }, on('2026-10-20'));
  w.editRecord(db, { id: t.id, description: 'use the token' }, on('2026-10-20'));
  w.noteRecord(db, { id: t.id, text: 'pasted ' + secret + ' here' }, on('2026-10-20'));
  const holds = () => [JSON.stringify(w.readRecord(db, t.id)).includes(secret), search(db, { text: secret }).total > 0,
    lines(db).some((l) => JSON.stringify(l).includes(secret)), recordHistory(db, { id: t.id }).rows.some((h) => String(h.old).includes(secret))];
  assert.deepEqual(holds(), [true, true, true, true]);
  const scrub = (summary, day) => o.overrideRequest(db, { kind: 'scrub', items: [{ record: t.id, text: secret }], reason: 'a live token', summary }, on(day));
  assert.throws(() => scrub('Remove ' + secret, '2026-10-21'), /never carry the text/);
  const r = scrub('Remove a token from ' + t.id, '2026-10-21');
  assert.ok(!JSON.stringify(o.overrideView(db, { request: r.request })).includes(secret), 'the request page never shows it');
  const done = o.overrideDecide(db, { request: r.request, decision: 'allow' }, pressed('2026-10-21'));
  assert.ok(done.unreached.length, 'it names what it could not reach');
  assert.deepEqual(holds(), [false, false, false, false]);
  const press = u.bandCalls(db, {}, on('2026-10-22')).rows.find((x) => x.kind === 'scrub').presses[0];
  o[press.verb](db, press.input, pressed('2026-10-22'));
  assert.deepEqual(holds().slice(0, 2), [true, true], 'unscrub puts the text and its search back');

  const s = scrub('Remove it again', '2026-10-22');
  o.overrideDecide(db, { request: s.request, decision: 'allow' }, pressed('2026-10-22'));
  /* a night's copy made during the seal never keeps the original */
  const { file } = backup(db, tempDir('askerdo-backup-'), 30, new Date(2026, 9, 23));
  assert.ok(!readFileSync(file).includes('hunter2'), 'the backup holds no trace of the scrubbed text');
  assert.equal(db.prepare('SELECT count(*) AS n FROM seals').get().n, 1, 'the live seal stays for an unscrub');
  assert.deepEqual(u.bandCalls(db, {}, on('2026-10-30')).rows.filter((x) => x.kind === 'scrub'), [], 'past its date it leaves the band');
  assert.throws(() => o.overrideUnscrub(db, { id: t.id }, pressed('2026-10-30')), /purged on 2026-10-29/);
  assert.equal(o.purgeSeals(db, new Date(2026, 9, 30)), 1);
});

/* the one restore the PC's board and a server's share */
test('a restore brings a copy in and keeps the live files aside, the main file alone complete; a copy that fails the check leaves the live files in place', () => {
  const dir = tempDir('askerdo-backup-');
  const count = (f) => { const d = openDb(f); try { return d.prepare('SELECT count(*) AS n FROM records').get().n; } finally { d.close(); } };
  const db = openDb(join(dir, 'board.db'));
  migrate(db);
  w.createKnowledge(db, { type: 'gotcha', title: 'Written before the copy', body: 'Kept.', global: true, session: 's1' }, on('2026-11-01'));
  backup(db, join(dir, 'backups'), 30, new Date(2026, 10, 1));
  w.createKnowledge(db, { type: 'gotcha', title: 'Written after the copy', body: 'Gone.', global: true, session: 's1' }, on('2026-11-02'));
  /* a killed board leaves its last writes in the WAL; its files as they stood then */
  const live = join(dir, 'killed', 'askerdo.db');
  mkdirSync(join(dir, 'killed'));
  for (const s of ['', '-wal']) copyFileSync(join(dir, 'board.db') + s, live + s);
  db.close();
  const r = restore(live, pickCopy('2026-11-01', [join(dir, 'backups')]));
  assert.ok(r.ok, JSON.stringify(r.check));
  const before = count(join(dir, 'board.db'));
  assert.equal(count(live), before - 1, 'the record written after the copy is gone');
  /* the guide's way back restores the set-aside main file alone */
  const alone = join(dir, 'alone.db');
  copyFileSync(join(r.aside, 'askerdo.db'), alone);
  assert.equal(count(alone), before, 'the set-aside file holds every write');
  const broken = join(dir, 'broken.db');
  writeFileSync(broken, 'not a database');
  assert.equal(restore(live, broken).ok, false);
  assert.equal(count(live), before - 1, 'a failed check puts the live file back');
});

/* the new folder's first session scans its procedures before the move, so the card it made there is a twin, not a holder. */
test('projects rename moves every record of a project onto its new name in one go; the dry run counts it and writes nothing; a name in use is refused', () => {
  const { projectsRename } = pr;
  const db = freshBoard();
  const OLD = 'github.com/someone/old-name';
  const NEW = 'github.com/someone/new-name';
  const [MAIN, TREE] = ['C:/repos/old-name', 'C:/repos/old-name-lane'];
  const day = on('2026-10-30');
  const ws = w.createRecord(db, { kind: 'workstream', name: 'Build', description: 'd', projectRepos: [OLD] }, day);
  w.createRecord(db, { kind: 'workstream', name: 'Other', description: 'd', projectRepos: ['github.com/someone/other'] }, day);
  const k = w.createKnowledge(db, { type: 'gotcha', title: 'The cache misses on resize', projectRepos: [OLD] }, day);
  const question = qv.register(db, {
    name: 'where', gist: 'Where?', projectRepo: OLD, project: 'old-name', session: 's1', blocking: false, workstream: ws.id,
    ask: 'Here (a, my pick) or there (b)?', pick: 'a', options: [{ type: 'a', option: 'here' }, { type: 'b', option: 'there' }],
  }, null, day);
  const proc = { slug: 'release', title: 'Release', summary: 'Ship it.', triggers: { words: ['release'], commands: [], files: [] }, repos: {}, refs: [] };
  const card = pv.scanProject(db, { project: MAIN, repo: OLD, files: [{ name: 'release.md', proc }] }, day).created[0];
  const twin = pv.scanProject(db, { project: 'C:/repos/new-name', repo: NEW, files: [{ name: 'release.md', proc }] }, day).created[0];
  pf.profileDefine(db, { name: 'dev', set: ['agent.soft=200k'] }, day);
  pf.profileAdd(db, { record: MAIN, name: 'dev', repo: OLD }, day);
  pf.profileAdd(db, { record: TREE, name: 'guard-on', repo: OLD }, day);

  assert.throws(() => projectsRename(db, { from: OLD, to: 'github.com/someone/other' }, day), /already holds records \(WS-2\)/);
  const rows = db.prepare('SELECT count(*) AS n FROM activity').get().n;
  const dry = projectsRename(db, { from: OLD, to: NEW, folders: [{ from: MAIN, to: 'C:/repos/new-name' }], dryRun: true }, day);
  assert.deepEqual([dry.moved, dry.retired, dry.unmapped], [{ question: 1, workstream: 1, knowledge: 1, procedure: 1, profile: 1 }, [twin], [TREE]]);
  assert.equal(db.prepare('SELECT count(*) AS n FROM activity').get().n, rows, 'the dry run writes nothing');
  assert.equal(L.resolveRecord(db, question.id).fields.projectRepo, OLD);

  const folders = [{ from: MAIN, to: 'C:/repos/new-name' }, { from: TREE, to: 'C:/repos/new-name-lane' }];
  const done = projectsRename(db, { from: OLD, to: NEW, folders }, day);
  assert.deepEqual([done.moved, done.unmapped], [dry.moved, []]);
  const at = (id) => L.resolveRecord(db, id).fields;
  assert.deepEqual([at(question.id).projectRepo, at(question.id).project, at(ws.id).projectRepos, at(k.id).projectRepos, at(card).projectRepo, at(twin).status],
    [NEW, 'new-name', [NEW], [NEW], NEW, 'retired']);
  assert.deepEqual(at('WS-2').projectRepos, ['github.com/someone/other'], 'another project stays');
  const subs = pf.loadProfiles(db).subscriptions;
  assert.deepEqual([subs['repo:' + OLD], subs['repo:' + NEW].dirs], [undefined, ['C:/repos/new-name', 'C:/repos/new-name-lane']]);
  /* the readers find the project by its new name */
  assert.deepEqual(qv.list(db, { projectRepo: NEW }).map((x) => x.id), [question.id]);
  assert.equal(pf.effective(db, { record: 'C:/repos/new-name-lane', repo: NEW }).settings['agent.on'].value, true);
  const row = lines(db).filter((l) => l.kind === 'project');
  assert.deepEqual([row.length, row[0].verb, row[0].changes.project], [1, 'rename', [OLD, NEW]], 'one activity line');
  assert.match(row[0].note, /1 question/);
  assert.deepEqual(projectsRename(db, { from: OLD, to: NEW }, day).activity, null, 'a second run finds nothing to move');
});
