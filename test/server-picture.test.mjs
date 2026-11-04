/* The board picture's apply step: the proposal files onto a
   board in one go, refused whole when they do not hold together. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { freshBoard } from './helpers/board-db.mjs';

const { putRecord } = await import('../server/records.mjs');
const g = await import('../server/verbs/graph.mjs');
const t = await import('../server/verbs/tracks.mjs');
const { applyPicture } = await import('../server/verbs/picture.mjs');

function board() {
  const db = freshBoard();
  putRecord(db, { key: 'ws000001', kind: 'workstream', fields: { id: 'WS-1', key: 'ws000001', name: 'Board', status: 'open', labelHistory: ['WS-1 2026-10-25'] }, body: '' });
  const tr = t.newTrack(db, { name: 'Old name', workstream: 'WS-1' }, 'cli');
  const [a, b, c, d] = ['A', 'B', 'C', 'D'].map((name) => t.capture(db, { track: tr.id, name }, 'cli'));
  const chain = db.prepare('INSERT INTO depends (task, "on", reason, added, actor) VALUES (?, ?, ?, ?, ?)');
  for (const [x, y] of [[b, a], [c, b], [d, c]]) chain.run(x.key, y.key, 'from import', '2026-10-27T10:00:00+00:00', 'import');
  const set = (key, path, v) => db.prepare('UPDATE records SET fields = json_set(fields, ?, ?) WHERE key = ?').run(path, v, key);
  set(a.key, '$.fromStep', 'P-1/s2');
  set(b.key, '$.status', 'in_progress');
  return { db, tr, a, b, c, d, set };
}
const count = (db) => ['activity', 'depends', 'records', 'track_items'].map((x) => db.prepare('SELECT count(*) AS n FROM ' + x).get().n);

test('the apply refuses files that do not hold together, naming each problem, and writes nothing', () => {
  const { db, tr, b, c, d } = board();
  const L = { name: 'L', kind: 'main', track: tr.id };
  const on = (id, line, waitsOn = []) => ({ id, verdict: 'open', line, waitsOn });
  const rest = [on('P-1 s2', 'L'), on(b.id, 'L')];
  const cases = {
    loop: [{ 'a.json': { lines: [L], tasks: [...rest, on(c.id, 'L', [{ on: d.id, why: 'one' }]), on(d.id, 'L', [{ on: c.id, why: 'two' }])] } }, [/loop/]],
    'unknown id': [{ 'a.json': { lines: [L], tasks: [...rest, on(c.id, 'L'), on(d.id, 'L'), on('T-999', 'L')] } }, [/T-999.*no task/]],
    'open task on no line': [{ 'a.json': { lines: [L], tasks: [...rest, on(c.id, null)] } },
      [new RegExp(c.id + ' is open and left on no line'), new RegExp(d.id + ' open on "L".*no file places')]],
    contradicting: [{
      'a.json': { lines: [L], tasks: [...rest, on(c.id, 'L', [{ on: d.id, why: 'a' }]), on(d.id, 'L')] },
      'b.json': { lines: [{ name: 'M', kind: 'side', parent: tr.id }], tasks: [on(d.id, 'M', [{ on: c.id, why: 'b' }])] },
    }, [/opposite/, /puts .* on "L", b\.json on "M"/]],
  };
  const before = count(db);
  for (const [name, [files, want]] of Object.entries(cases)) {
    assert.throws(() => applyPicture(db, { files, dryRun: false }, 'cli'),
      (e) => e instanceof g.TrackRefusal && want.every((w) => e.data.problems.some((p) => w.test(p))), name);
    assert.deepEqual(count(db), before, name + ' wrote nothing');
  }
});

test('the apply writes the picture: lines, a branch that waits on its junction, the links in place of the import chain; a rerun writes only what the files changed', () => {
  const { db, tr, a, b, c, d, set } = board();
  const picture =(side, dVerdict, dWaits) => ({
    'one.json': {
      lines: [{ name: 'Main line', kind: 'main', track: tr.id }, { name: side, kind: 'side', parent: tr.id, junction: 'P-1 s2' }],
      tasks: [
        { id: 'P-1 s2', verdict: 'open', line: 'Main line', waitsOn: [] },
        { id: b.id, verdict: 'open', line: 'Main line', evidence: 'nobody holds it', waitsOn: [] },
        { id: c.id, verdict: 'open', line: side, waitsOn: [] },
        { id: d.id, verdict: dVerdict, line: side, waitsOn: dWaits },
      ],
      proposedTasks: [{ key: 'the-merge', name: 'Merge it', line: 'Main line', why: 'no record holds it', waitsOn: [{ on: b.id, why: 'after B' }] }],
      questionsForUser: [{ about: 'ignored' }],
    },
  });
  const files = picture('Side area', 'done', [{ on: c.id, why: 'D builds on C' }]);
  const stateAt = '2026-10-20T10:00:00+00:00';
  set(tr.key, '$.updated', stateAt);
  const before = count(db);
  const dry = applyPicture(db, { files }, 'cli');
  assert.ok(dry.dryRun && dry.changes.length > 0);
  assert.deepEqual(count(db), before, 'the dry run rolled back');

  const go = applyPicture(db, { files, dryRun: false }, 'cli');
  assert.deepEqual(go.counts, dry.counts, 'the dry run listed what the write did');
  assert.equal(t.trackSummary(db, { track: tr.id }).name, 'Main line');
  assert.equal(JSON.parse(db.prepare('SELECT fields FROM records WHERE key = ?').get(tr.key).fields).updated, stateAt, 'a rename leaves the state time (T-317)');
  assert.notEqual(t.trackSummary(db, { track: tr.id }).state, 'parked', 'the parent of a branch stays open');
  assert.equal(db.prepare("SELECT count(*) AS n FROM depends WHERE reason = 'from import'").get().n, 0, "the import's chain is gone");
  assert.match(db.prepare('SELECT reason FROM depends WHERE task = ? AND "on" = ?').get(d.key, c.key).reason, /D builds on C/);
  assert.equal(g.readiness(db, d.key).status, 'completed');
  assert.equal(g.readiness(db, b.key).status, 'open', 'a stale in-progress mark nobody holds goes back to open (Q130 130a)');
  const merge = db.prepare("SELECT key FROM records WHERE json_extract(fields, '$.pictureKey') = 'the-merge'").get();
  assert.ok(merge && db.prepare('SELECT 1 FROM depends WHERE task = ? AND "on" = ?').get(merge.key, b.key), 'the proposed task is made and linked');
  const side = db.prepare("SELECT key FROM records WHERE kind = 'track' AND json_extract(fields, '$.name') = 'Side area'").get();
  assert.equal(t.trackView(db, { track: side.key }).junction.task.id, a.id, 'the step reference resolved to the task the import made');
  assert.equal(g.readiness(db, c.key).ready, false, "the side's first task waits on its junction");
  db.prepare("UPDATE records SET fields = json_set(fields, '$.status', 'completed') WHERE key = ?").run(a.key);
  assert.equal(g.readiness(db, c.key).ready, true);
  db.prepare("UPDATE records SET fields = json_set(fields, '$.status', 'open') WHERE key = ?").run(a.key);

  const again = count(db);
  assert.deepEqual(applyPicture(db, { files, dryRun: false }, 'cli').changes, [], 'a rerun finds nothing to change');
  assert.deepEqual(count(db), again);

  /* the corrections land in the files: the side renamed, D not done after all, its link struck */
  const fixed = picture('Side work', 'open', []);
  const tracks = () => db.prepare("SELECT count(*) AS n FROM records WHERE kind = 'track'").get().n;
  const before2 = tracks();
  const dry2 = applyPicture(db, { files: fixed }, 'cli');
  assert.ok(['rename', 'reopen', 'unlink'].every((k) => dry2.counts[k]), 'the dry run lists the corrections');
  applyPicture(db, { files: fixed, dryRun: false }, 'cli');
  assert.equal(tracks(), before2, 'the renamed line is the same track');
  assert.equal(t.trackSummary(db, { track: side.key }).name, 'Side work');
  assert.equal(g.readiness(db, d.key).status, 'open', 'a done the picture set follows the files');
  assert.equal(db.prepare('SELECT 1 FROM depends WHERE task = ? AND "on" = ?').get(d.key, c.key), undefined, 'the struck link is gone');
  assert.deepEqual(applyPicture(db, { files: fixed, dryRun: false }, 'cli').changes, [], 'and a rerun of the corrected files finds nothing');
});
