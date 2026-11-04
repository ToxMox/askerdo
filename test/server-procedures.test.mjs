/* Procedure cards on the board server: a scan's cards from the
 * PC's parsed files, runs, and a card scanned on another PC staying one card.
 * The parse, staleness and matching cases stay in test/procedures.test.mjs; this
 * stands in for its scan and run cases. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { freshBoard } from './helpers/board-db.mjs';
import { frontText } from '../server/frontmatter.mjs';
import { resolveRecord as recordByLabel } from '../server/verbs/labels.mjs';
import { badgeOf, cardsAt } from '../server/verbs/proc-cards.mjs';
import * as pv from '../server/verbs/procedures.mjs';
import { parseProcedure } from '../lib/procedures.mjs';
import { matchCall } from '../lib/proc-match.mjs';
import { inTodaysOrder } from './helpers/old-store.mjs';

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
});

test('runs: clean moves the verified commit, deviated flags and drafts, three clean in a row suggest a script', () => {
  const db = freshBoard();
  scan(db, [file()]);
  assert.throws(() => pv.recordRun(db, { name: 'nope', result: 'clean', project: DIR, repo: REPO }, actor), /no procedure named nope/);
  assert.throws(() => pv.recordRun(db, { name: 'demo', result: 'deviated', project: DIR }, actor), /needs --note/);
  assert.throws(() => pv.recordRun(db, { name: 'demo', result: 'maybe' }, actor), /clean or deviated/);
  const head = 'a'.repeat(40);
  const one = pv.recordRun(db, { name: 'demo', result: 'clean', project: DIR, repo: REPO, heads: { self: head } }, actor);
  assert.deepEqual([one.id, one.runs, one.cleanRuns, one.verified.self], ['PR-1', 1, 1, head]);
  const dev = pv.recordRun(db, { name: 'PR-1', result: 'deviated', note: 'the build needed --force', project: DIR }, actor);
  assert.deepEqual([dev.flag, dev.cleanRuns, dev.verified.self], ['the build needed --force', 0, head]);
  assert.ok(dev.draft.includes('docs/procedures/demo.md'));
  assert.equal(badgeOf(recordByLabel(db, 'PR-1').fields).badge, 'flagged');
  // a run report as the note leaves the draft and the flag its lead, the journal the whole once
  const report = 'step 2 ran the build twice.\n' + 'The report goes on at length. '.repeat(40);
  const long = pv.recordRun(db, { name: 'demo', result: 'deviated', note: report, project: DIR }, actor);
  assert.equal(long.flag, 'step 2 ran the build twice');
  assert.ok(long.draft.includes('step 2 ran the build twice') && long.draft.length < 400 && !long.draft.includes('at length'));
  assert.equal(notes(db, recordByLabel(db, 'PR-1').key).at(-1).split('at length').length - 1, 40);
  for (let i = 0; i < 2; i++) pv.recordRun(db, { name: 'demo', result: 'clean', project: DIR, heads: { self: 'b'.repeat(40) } }, actor);
  const three = pv.recordRun(db, { name: 'demo', result: 'clean', project: DIR, stale: [] }, actor);
  assert.deepEqual([three.runs, three.cleanRuns, three.flag, three.verified.self], [6, 3, '', 'b'.repeat(40)]);
  assert.ok(three.suggestScript);
  assert.equal(pv.triggerCards(db)[0].badge, 'fresh');
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
