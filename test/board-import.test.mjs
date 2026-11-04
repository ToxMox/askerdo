/* Importing an old file store: small stores the old writers made (frozen under
   test/fixtures/old-store/), run through the one-command rehearsal into a database
   file, then read back on the board. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readKept as keptOf } from '../lib/loose-files.mjs';
import { tempDir } from './helpers/sandbox.mjs';
import { fixtureRepo, oldStore } from './helpers/old-store.mjs';

process.removeAllListeners('warning');
const { openDb } = await import('../server/db.mjs');
const { rehearse, roundTrip } = await import('../server/rehearse.mjs');
const { storeFiles } = await import('../server/render.mjs');
const { resolveRecord } = await import('../server/verbs/labels.mjs');
const { trackGraph } = await import('../server/verbs/graph.mjs');
const { runVerb } = await import('../server/verbs/index.mjs');
const pc = await import('../lib/tracks-session.mjs');

const PREFIX = 'askerdo-move-';
const store = (name, repo) => oldStore(name, tempDir(PREFIX), repo);

/* The rehearsal writes the file only when every proof passes. */
async function move(t, root, map, extra = {}) {
  const file = join(tempDir(PREFIX), 'board.db');
  const r = await rehearse({ store: root, db: file, map, measure: false, ...extra });
  assert.deepEqual(r.problems, [], 'the rehearsal proves the move');
  const db = openDb(file);
  t.after(() => db.close());
  return { r, db };
}

test('a thread and its plan become one track with the thread\'s number, its handoffs and questions on it and the old labels resolving to it', async (t) => {
  /* TH-1 with P-1 and its T-1, handoffs TH-1.1 and TH-1.2, active at the import: its
     session ends with it */
  const root = store('thread-plan');
  /* the kinds store's Q2, naming P-1 and TH-1 where the old writer placed them */
  const q2 = readFileSync(new URL('./fixtures/old-store/kinds/questions/8k34a9ft-still-open.md', import.meta.url), 'utf8')
    .replace('projectDir: "C:/repos/app"\n', 'projectDir: "C:/repos/app"\nplan: xdmcnnq6\nthread: fh1s2wdp\n');
  /* git keeps no empty folder, so a fresh checkout's copy has none to write into */
  mkdirSync(join(root, 'questions'), { recursive: true });
  writeFileSync(join(root, 'questions', '8k34a9ft-still-open.md'), q2);
  /* the old store's waitingOnUser arrives as waitingOnUser */
  const leg = join(root, 'handoffs', '7rkgw8fz-second-leg.md');
  writeFileSync(leg, readFileSync(leg, 'utf8').replace('waitingOnUser:\n', 'waitingOnUser:\n  - the deploy key\n'));
  const { r, db } = await move(t, root, [{ thread: 'TH-1', plans: ['P-1'] }]);
  const tr = resolveRecord(db, 'TH-1');
  assert.equal(tr.kind, 'track');
  assert.equal(tr.front.id, 'TR-1', "the track keeps the thread's number");
  assert.equal(resolveRecord(db, 'P-1').key, tr.key, 'the plan label resolves to the same track');
  for (const h of ['TH-1.1', 'TH-1.2']) assert.equal(resolveRecord(db, h).track, tr.key, h + ' resolves to a handoff on the track');
  assert.deepEqual(runVerb(db, 'trackHandoffs', { track: tr.key }, {}).handoffs.at(-1).waitingOnUser, ['the deploy key']);
  assert.deepEqual(trackGraph(db, tr.key).tasks.map((x) => x.id), ['T-1'], "the plan's task is on the track");
  const q = resolveRecord(db, 'Q2').front;
  assert.deepEqual([q.track, q.plan, q.thread], [tr.key, undefined, undefined], 'the question names the track in place of its plan and thread');
  /* the folder became the project's shared name (no remote here, so its path) */
  assert.deepEqual([q.projectDir, q.projectRepo], [undefined, 'c:/repos/app'], 'the question carries the shared name, not the folder');
  assert.deepEqual(r.projects.map((f) => [f.dir, f.name]), [['C:/repos/app', 'c:/repos/app']], 'the import names each folder once');
  const s = runVerb(db, 'trackSummary', { track: tr.key }, {});
  assert.deepEqual([s.state, s.noHandoff], ['waiting', false], 'it waits with its last handoff');

  /* a record's old text and the read log ride the export, the proof and the rollback, byte for byte */
  const k = runVerb(db, 'createKnowledge', { type: 'decision', title: 'Tracks replace threads', body: 'one track', global: true }, { session: 's1' });
  runVerb(db, 'amendKnowledge', { id: k.id, body: 'and its plan' }, { session: 's1' });
  runVerb(db, 'read', { ids: [k.id], site: 'brief' }, { session: 's2' });
  assert.ok([...storeFiles(db)].some((f) => f.path === 'history/' + k.key + '.jsonl'), 'the export carries the old text');
  /* a request waiting at the import still waits after it */
  runVerb(db, 'overrideRequest', { kind: 'fix', items: [{ record: k.id, body: 'one track per thread' }], reason: 'an import wrote it', summary: 'Fix K' }, { session: 's1' });
  assert.ok([...storeFiles(db)].some((f) => f.path === 'overrides/pending.jsonl'), 'the export carries the pending request');
  /* automatic upkeep switched on stays on through the export and its import */
  runVerb(db, 'upkeepSwitch', { on: true }, 'cli');
  assert.match([...storeFiles(db)].find((f) => f.path === 'board/settings.json').text, /"upkeep": "on"/);
  assert.deepEqual(roundTrip(db).problems, []);
});

test('the old order arrives as edges and only the old next task reads ready', async (t) => {
  /* T-1 (ordinal 30), T-2 (10, completed), T-3 (20), and the step "the schema" over T-4 (40) and T-5 (50); T-6 on no plan */
  const root = store('order');
  const [last, mid, a, b, stray] = ['T-1', 'T-3', 'T-4', 'T-5', 'T-6'].map((id) => ({ id }));
  const { db } = await move(t, root, []);
  const tr = resolveRecord(db, 'P-1');
  const g = trackGraph(db, tr.key);
  const ids = g.tasks.map((x) => x.id);
  /* the step's tasks first, the step itself as a task after them, then the rest by ordinal */
  assert.deepEqual(ids.filter((id) => id !== ids[2]), [a.id, b.id, mid.id, last.id]);
  assert.equal(g.tasks[2].name, 'the schema');
  assert.match(resolveRecord(db, ids[2]).front.fromStep, /^P-1\/s\d+$/, 'the step it came from, which the board picture names it by');
  assert.deepEqual(g.edges.map((e) => [e.task, e.on]), ids.slice(1).map((id, i) => [id, ids[i]]), 'each open task waits on the one before');
  assert.deepEqual(g.ready.map((x) => x.id), [a.id], 'only the old next task is ready');
  /* the import's order is corrected afterwards with track reorder: its chain follows */
  runVerb(db, 'reorder', { task: last.id, position: 1, reason: 'the user wants it first' }, 'cli');
  assert.deepEqual(trackGraph(db, tr.key).ready.map((x) => x.id), [last.id], 'a reorder moves the imported chain with it');
  assert.equal(g.done, 1, 'the finished task is on the track too');
  const inbox = db.prepare('SELECT r.workstream, (SELECT count(*) FROM track_items ti WHERE ti.task = r.key) AS placed FROM records r WHERE r.label = ?').get(stray.id);
  assert.deepEqual([inbox.workstream, inbox.placed], [resolveRecord(db, 'WS-1').key, 0], 'a task with no plan stays in its workstream\'s inbox');
});

test('a live handoff\'s loose-file lists land on this PC and resuming still catches a tracked file changed since', async (t) => {
  /* TH-1's handoff TH-1.1 names the repo, rebuilt to its snapshot commit, with notes.txt loose */
  const repo = fixtureRepo(tempDir(PREFIX));
  const root = store('loose', repo);
  const dir = tempDir(PREFIX);

  const { db } = await move(t, root, [], { kept: dir, pc: 'pc1' });
  const kept = pc.readKept(dir, 'TH-1.1', resolveRecord(db, 'TH-1.1').key);
  assert.ok(kept && kept.repos[0].snapshot && kept.repos[0].files.some((f) => f.path.endsWith('notes.txt')), 'the lists are kept here');
  /* the user's per-file dispositions come along, so aging goes on from them */
  const dispositions = keptOf(root, repo);
  assert.ok(dispositions.some((f) => f.path === 'notes.txt'));
  assert.deepEqual(keptOf(dir, repo), dispositions, "the store's kept dispositions reach this PC");

  const track = resolveRecord(db, 'TH-1').key;
  const opts = { dir, pc: 'pc1', call: (n, i, a) => runVerb(db, n, i, a) };
  const look = await pc.resumeTrackSession(track, { session: 's1', move: 'read only' }, opts);
  assert.deepEqual([look.verify.lists, look.verify.ok], ['here', true], 'nothing changed yet');
  writeFileSync(join(repo, 'a.txt'), 'changed\n');
  const r = await pc.resumeTrackSession(track, { session: 's1' }, opts);
  assert.deepEqual([r.verify.lists, r.verify.ok], ['here', false], 'a tracked file changed since the handoff');
});
