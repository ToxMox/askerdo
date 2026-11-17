/* Procedure cards on the board server: a scan's cards from the
 * PC's parsed files, runs, and a card scanned on another PC staying one card.
 * The parse, staleness and matching cases stay in test/procedures.test.mjs; this
 * stands in for its scan and run cases. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { freshBoard } from './helpers/board-db.mjs';
import { frontText } from '../server/frontmatter.mjs';
import { resolveRecord as recordByLabel } from '../server/verbs/labels.mjs';
import { badgeOf, cardView, cardsAt } from '../server/verbs/proc-cards.mjs';
import * as pv from '../server/verbs/procedures.mjs';
import { parseProcedure } from '../lib/procedures.mjs';
import { matchCall } from '../lib/proc-match.mjs';
import { inTodaysOrder } from './helpers/old-store.mjs';
import { createRecord, editRecord } from '../server/verbs/work.mjs';
import { addNote } from '../server/records.mjs';
import { runVerb } from '../server/verbs/index.mjs';

const actor = { by: 'cli', now: () => new Date(2026, 9, 20, 10, 0, 0) };
const DIR = 'C:/repos/demo';
const REPO = 'github.com/example/demo';

const DEMO = `---
name: demo
title: Build the demo
summary: "Run the build with \`--check\` and read the symbol."
triggers:
  words: [build the demo, demo build]
  commands: ['scripts/build.mjs']
  files:
    - lib/*.mjs
    - glob: 'conf/**/*.json'
      contains: DEMO_KEY
repos: {}
---

# Build the demo

## Trigger

Someone asks for the demo build.

## Preconditions

- None.

## Steps

### 1. Build

\`\`\`sh
node scripts/build.mjs --check
\`\`\`

## Verify

\`\`\`sh
node scripts/build.mjs
\`\`\`

- expect: exit 0.

## References

- \`lib/a.mjs::SYMBOL\`: the symbol the build reads.
- \`scripts/build.mjs\`: the build.
- \`T-239\`: the procedure system.
`;

/* What the PC half hands the board: each file parsed, judged and linted there. */
const file = (text = DEMO, extra = {}) => {
  const r = parseProcedure(text, 'demo.md');
  return r.ok ? { name: 'demo.md', proc: r.proc, stale: [], warnings: [], ...extra } : { name: 'demo.md', errors: r.errors };
};
const scan = (db, files, more = {}) => pv.scanProject(db, { project: DIR, repo: REPO, head: 'abc1234def', files, ...more }, actor);
const notes = (db, key) => db.prepare('SELECT body FROM notes WHERE record = ? ORDER BY position').all(key).map((n) => n.body);

test('a scan makes one card per procedure, writes nothing when nothing moved, follows edits, retires and brings back', () => {
  const db = freshBoard();
  assert.deepEqual(scan(db, [file()]).created, ['PR-1']);
  const card = recordByLabel(db, 'PR-1');
  assert.deepEqual([card.fields.slug, card.fields.doc, card.fields.projectRepo], ['demo', 'docs/procedures/demo.md', REPO]);
  assert.deepEqual(card.fields.files, ['lib/*.mjs', 'conf/**/*.json | DEMO_KEY']);
  assert.deepEqual(card.fields.paths, ['lib/a.mjs::SYMBOL', 'scripts/build.mjs']);
  assert.ok(inTodaysOrder('procedure', Object.keys(card.fields)), 'today\'s key order, so the export keeps its bytes:\n' + frontText(card.fields));
  assert.match(notes(db, card.key)[0], /docs\/procedures\/demo\.md at abc1234/);
  const again = scan(db, [file()]);
  assert.deepEqual([again.created, again.updated, again.unchanged], [[], [], ['PR-1']]);
  assert.equal(recordByLabel(db, 'PR-1').version, card.version, 'an unchanged scan writes nothing');

  const edited = file(DEMO.replace('words: [build the demo, demo build]', 'words: [build the demo]'));
  assert.deepEqual(scan(db, [edited]).updated, ['PR-1']);
  assert.deepEqual(recordByLabel(db, 'PR-1').fields.words, ['build the demo']);
  const bad = scan(db, [edited, { name: 'broken.md', errors: ['no frontmatter: the file starts with ---'] }]);
  assert.deepEqual([bad.unparseable.length, bad.created], [1, []]);

  assert.deepEqual(scan(db, []).retired, ['PR-1']);
  assert.deepEqual([recordByLabel(db, 'PR-1').fields.status, typeof recordByLabel(db, 'PR-1').fields.closed], ['retired', 'string']);
  assert.deepEqual(scan(db, [edited]).updated, ['PR-1']);
  const back = recordByLabel(db, 'PR-1');
  assert.deepEqual([back.fields.status, back.fields.closed], ['active', undefined]);
  assert.equal(notes(db, back.key).length, 3, 'made, retired and back each leave a note');
  const verbs = db.prepare("SELECT verb FROM activity WHERE kind = 'procedure'").all().map((r) => r.verb);
  assert.deepEqual(verbs, ['create', 'edit', 'edit', 'edit'], 'every change is an activity row, the no-op scans none');
  /* a card that opts in to the mod's own run record says so to the watcher */
  assert.equal(cardView(recordByLabel(db, 'PR-1').fields).record, undefined);
  scan(db, [file(DEMO.replace('repos: {}', 'repos: {}\nrecord: command'))]);
  assert.equal(cardView(recordByLabel(db, 'PR-1').fields).record, 'command');
});

test('runs: clean moves the verified commit, a deviation says its outcome and files nothing, three clean in a row suggest a script', () => {
  const db = freshBoard();
  scan(db, [file()]);
  assert.throws(() => pv.recordRun(db, { name: 'nope', result: 'clean', project: DIR, repo: REPO }, actor), /no procedure named nope/);
  assert.throws(() => pv.recordRun(db, { name: 'demo', result: 'deviated', project: DIR }, actor), /needs --note/);
  assert.throws(() => pv.recordRun(db, { name: 'demo', result: 'maybe' }, actor), /clean or deviated/);
  const head = 'a'.repeat(40);
  const one = pv.recordRun(db, { name: 'demo', result: 'clean', project: DIR, repo: REPO, heads: { self: head } }, actor);
  assert.deepEqual([one.id, one.runs, one.cleanRuns, one.verified.self], ['PR-1', 1, 1, head]);
  /* a deviated run with no outcome is refused, naming the three, and writes nothing */
  const tasks = () => db.prepare("SELECT count(*) AS n FROM records WHERE kind = 'task'").get().n;
  const card = () => recordByLabel(db, 'PR-1');
  const before = [card().fields.runs, notes(db, card().key).length, tasks()];
  assert.throws(() => pv.recordRun(db, { name: 'PR-1', result: 'deviated', note: 'the build needed --force', project: DIR }, actor), /--fixed.*--one-off.*--filed/);
  assert.deepEqual([card().fields.runs, notes(db, card().key).length, tasks()], before);
  /* a one-off records its why and files no task; the same step a one-off again is the card to fix */
  const off = pv.recordRun(db, { name: 'PR-1', result: 'deviated', note: 'Step 3 needed --force.', oneOff: 'the cache was cold', project: DIR }, actor);
  assert.deepEqual([off.flag, off.cleanRuns, off.verified.self, off.outcome.kind, tasks()], ['', 0, head, 'one-off', before[2]]);
  assert.match(notes(db, card().key).at(-1), /the cache was cold/);
  assert.throws(() => pv.recordRun(db, { name: 'demo', result: 'deviated', note: 'step 3 needed it again', oneOff: 'cold again', project: DIR }, actor), /card should be fixed/);
  assert.throws(() => pv.recordRun(db, { name: 'demo', result: 'deviated', note: 'x', fixed: 'not a sha', project: DIR }, actor), /sha/);
  /* filed names an open task the session placed; an unplaced one is refused */
  const ws = createRecord(db, { kind: 'workstream', name: 'Demo', description: 'd' }, actor);
  const loose = createRecord(db, { kind: 'task', name: 'Loose', description: 'd', workstream: ws.id }, actor);
  assert.throws(() => pv.recordRun(db, { name: 'demo', result: 'deviated', note: 'x', filed: loose.id, project: DIR }, actor), /no track and in no inbox/);
  const line = runVerb(db, 'newTrack', { name: 'Demo line', workstream: ws.id }, 'cli');
  const work = createRecord(db, { kind: 'task', name: 'Make the build take --force', description: 'd', track: line.id }, actor);
  const dev = pv.recordRun(db, { name: 'PR-1', result: 'deviated', note: 'the build needed --force', filed: work.id, project: DIR }, actor);
  assert.deepEqual([dev.flag, dev.outcome.kind, dev.openTasks], ['the build needed --force', 'filed', [work.id]]);
  assert.equal(badgeOf(card().fields).badge, 'flagged');
  /* a task's refs name the card with its badge, and the card lists the open tasks citing it */
  const [citing, closed] = ['Run the demo build', 'An old demo run'].map((name) => createRecord(db, { kind: 'task', name, description: 'd', workstream: ws.id, refs: ['PR-1'] }, actor));
  editRecord(db, { id: closed.id, status: 'dropped', note: 'gone' }, actor);
  assert.deepEqual(pv.cardsCited(db, recordByLabel(db, citing.id).fields.refs).map((c) => c.id + ' ' + c.badge), ['PR-1 flagged']);
  assert.deepEqual(pv.tasksCiting(db, card()).map((t) => t.label), [citing.id]);
  /* a ref stored as a bare string names the card in the kickoff too, as the card's list counts it */
  const bare = createRecord(db, { kind: 'task', name: 'A bare ref', description: 'd', track: line.id }, actor);
  db.prepare("UPDATE records SET fields = json_set(fields, '$.refs', 'PR-1') WHERE key = ?").run(recordByLabel(db, bare.id).key);
  assert.ok(pv.tasksCiting(db, card()).some((t) => t.label === bare.id));
  const ready = runVerb(db, 'trackKickoff', { track: line.id }, 'cli').kickoff.split('\n').find((l) => l.startsWith('Ready'));
  assert.match(ready, new RegExp(bare.id + ' [^;]*PR-1'));
  // a run report as the note leaves the flag its lead, the journal the whole once
  const report = 'step 2 ran the build twice.\n' + 'The report goes on at length. '.repeat(40);
  const long = pv.recordRun(db, { name: 'demo', result: 'deviated', note: report, filed: work.id, project: DIR }, actor);
  assert.equal(long.flag, 'step 2 ran the build twice');
  assert.equal(notes(db, card().key).at(-1).split('at length').length - 1, 40);
  assert.equal(tasks(), 5, 'no run filed a task');
  /* a clean run leaves the flag while the filed task is open; closing it lets the next one clear it */
  for (let i = 0; i < 2; i++) pv.recordRun(db, { name: 'demo', result: 'clean', project: DIR, heads: { self: 'b'.repeat(40) } }, actor);
  const three = pv.recordRun(db, { name: 'demo', result: 'clean', project: DIR, stale: [] }, actor);
  assert.deepEqual([three.cleanRuns, three.flag, three.verified.self, three.openTasks], [3, 'step 2 ran the build twice', 'b'.repeat(40), [work.id]]);
  assert.ok(three.suggestScript);
  editRecord(db, { id: work.id, status: 'done' }, actor);
  assert.equal(pv.recordRun(db, { name: 'demo', result: 'clean', project: DIR }, actor).flag, '');
  assert.equal(pv.triggerCards(db)[0].badge, 'fresh');
});

test('proc drafts reads the outcomes of a journal by step and lists the old draft tasks still open', () => {
  const db = freshBoard();
  scan(db, [file()]);
  const card = recordByLabel(db, 'PR-1');
  /* drafts as the runs before the ruling left them: journal notes with no outcome, and one open draft task */
  const old = (text) => addNote(db, card.key, { at: '2026-10-22T10:00:00+00:00', actor: 'cli', body: 'deviated run: ' + text + '. Draft edit for docs/procedures/demo.md: bring the step that differed in line.' });
  for (const t of ['Merged lane 1. Deviation: step 4 names the old build', 'Merged lane 2. Step 4 still names it', 'Ran it all at once']) old(t);
  const ws = createRecord(db, { kind: 'workstream', name: 'Demo', description: 'd' }, actor);
  const draft = createRecord(db, { kind: 'task', name: 'PR-1 demo: apply or decline the draft for step 4', description: 'd', workstream: ws.id }, actor);
  db.prepare("UPDATE records SET fields = json_set(fields, '$.drafts', json(?)) WHERE key = ?").run(JSON.stringify({ 'step 4': recordByLabel(db, draft.id).key }), card.key);
  pv.recordRun(db, { name: 'PR-1', result: 'deviated', note: 'Step 4 named the old build again.', fixed: 'c'.repeat(40), project: DIR }, actor);
  const r = pv.procDrafts(db, { name: 'PR-1' }, actor);
  assert.deepEqual(r.steps.map((s) => [s.step, s.runs, s.last.kind]), [['step 4', 3, 'fixed'], ['', 1, 'none']]);
  assert.deepEqual(r.drafts, [{ step: 'step 4', task: draft.id }], 'the old draft is listed, not deleted');
  assert.deepEqual(pv.triggerCards(db)[0].openTasks, [draft.id]);
});
test('a card names its project, never a folder, so a scan on another PC stays one card and is matched at this checkout', () => {
  const db = freshBoard();
  scan(db, [file()], { project: 'Z:/other-pc/demo' });
  const lane = 'C:/repos/demo-lane';
  const again = scan(db, [file()], { homes: [DIR, lane] });
  assert.deepEqual(again.created, [], 'no second card');
  const card = recordByLabel(db, 'PR-1').fields;
  assert.deepEqual([card.project, card.projectRepo], [undefined, REPO], 'no PC\'s folder is stored');
  const here = cardsAt(pv.triggerCards(db), { project: DIR, repo: REPO, homes: [DIR, lane], here: lane, hasDoc: () => true });
  assert.equal(here[0].path, lane + '/docs/procedures/demo.md');
  assert.equal(matchCall(here, { tool: 'Bash', input: { command: 'node scripts/build.mjs' }, cwd: lane }).length, 1);
  assert.equal(pv.recordRun(db, { name: 'demo', result: 'clean', project: DIR, repo: REPO }, actor).path, DIR + '/docs/procedures/demo.md',
    'the run reads the steps file in this checkout');

  /* the plugin's everywhere card, handed in by another project's scan, fires in this one */
  const serve = parseProcedure(DEMO.replace('name: demo', 'name: serve').replace('repos: {}', 'everywhere: true'), 'serve.md').proc;
  const other = { project: 'C:/repos/other', repo: 'github.com/example/other' };
  const made = scan(db, [], { ...other, everywhere: [{ name: 'serve.md', proc: serve }], pluginVersion: '0.8.0' });
  assert.deepEqual(made.everywhere.created, ['PR-2']);
  scan(db, [file()], { homes: [DIR, lane] });
  /* still live after this project's own scan, which hands in no everywhere list */
  const ours = cardsAt(pv.triggerCards(db), { project: DIR, repo: REPO, homes: [DIR, lane], here: lane, hasDoc: () => true });
  assert.deepEqual(matchCall(ours, { tool: 'Bash', input: { command: 'node scripts/build.mjs' }, cwd: lane }).map((h) => h.card.id), ['PR-1', 'PR-2']);
  /* a PC on an older plugin neither retires nor revives it, a newer one does */
  assert.deepEqual(scan(db, [], { ...other, everywhere: [], pluginVersion: '0.7.0' }).everywhere.retired, []);
  assert.deepEqual(scan(db, [], { ...other, everywhere: [], pluginVersion: '0.10.0' }).everywhere.retired, ['PR-2']);
  assert.deepEqual(scan(db, [], { ...other, everywhere: [{ name: 'serve.md', proc: serve }], pluginVersion: '0.9.0' }).everywhere.updated, []);
});
