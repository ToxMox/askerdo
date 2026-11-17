/* the conversion plan from the proposal: order and refs, original dates and the import label,
 * what is left out or still waits, the calls' answers, and the write in one process. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { buildPlan, recordGo, staleFacts, WaitingError, withFacts } from '../skills/onboard/plan.mjs';
import { applyPlan, asApproved, cliRunner, quietWrite, runCoverage } from '../skills/onboard/apply.mjs';
import { cardRow, cardText } from '../skills/onboard/cards.mjs';
import { blobsOf, clauseId, markMap } from '../skills/onboard/map.mjs';
import { recordReader } from '../skills/onboard/coverage.mjs';
import { tempDir } from './helpers/sandbox.mjs';

const AT1 = '2026-02-01T10:00:00+00:00';
const AT2 = '2026-03-01T10:00:00+00:00';
const src = (file, line, end) => ({ file, line, ...(end ? { end } : {}), commit: null });
const proposal = {
  version: 1,
  project: { dir: 'C:/work/proj', slug: 'proj', remote: 'github.com/someone/proj' },
  workstream: {},
  /* a profile named like the project, held by another one */
  board: { profiles: [{ profile: 'proj', records: ['C:/work/other'], elsewhere: true, rules: [] }] },
  items: [
    { id: 'track:a', kind: 'track', title: 'Line A', text: 'Ship line A.', fields: { name: 'Line A', state: 'waiting', history: [{ path: 'HANDOFF.md', commit: 'c1', at: AT1 }] }, source: src('HANDOFF.md') },
    { id: 'handoff:a', kind: 'handoff', title: 'Where line A stands', text: '## State\n\nHalf done.', fields: { track: 'track:a' }, source: src('HANDOFF.md') },
    { id: 'task:done', kind: 'task', title: 'Done thing', text: 'Done thing.', fields: { status: 'completed', track: 'track:a', date: '2026-02-03' }, source: src('TODO.md', 3) },
    { id: 'task:open', kind: 'task', title: 'Open thing', text: 'Open thing.', fields: { status: 'open', track: 'track:a', date: '2026-02-04' }, source: src('TODO.md', 4) },
    { id: 'decision:d1', kind: 'decision', title: 'Use X', text: 'Use X.', fields: { date: '2026-01-15', supersedes: ['decision:d0'], entry: 'D2' }, source: src('docs/decisions.md', 10) },
    { id: 'decision:d0', kind: 'decision', title: 'Use W', text: 'Use W.', fields: { date: '2026-01-10', entry: 'D1' }, source: src('docs/decisions.md', 4) },
    { id: 'question:q1', kind: 'question', title: 'Q1 which way', fields: { ask: 'Which way (a) or (b), the one Q1 left open in Q1-which.md?', date: '2026-01-18' }, source: src('.claude/questions/s/Q1-which.md') },
    { id: 'rule:r1', kind: 'rule', title: 'Keep it short', text: 'Keep it short.', fields: { slug: 'keep-it-short', date: '2026-01-19' }, source: src('CLAUDE.md', 5) },
    { id: 'rule:lanes', kind: 'rule', title: 'Lanes', text: 'Size lanes by read surface.', fields: { slug: 'lanes', for: 'agents', detail: 'Size lanes by read surface. '.repeat(20) }, source: src('handoff/README.md', 7) },
    { id: 'fact:a', kind: 'knowledge', title: 'Pool size', text: 'The pool holds four workers.', fields: { date: '2026-01-20' }, source: src('docs/facts.md', 3) },
    { id: 'card:build', kind: 'card', title: 'Build the app', fields: { slug: 'build', steps: [{ text: 'Build it', run: 'npm run build' }], verify: 'it exits 0' }, source: src('docs/howto.md', 2) },
    { id: 'fact:cut', kind: 'knowledge', title: 'An old fact', text: 'Old.', cut: true, source: src('docs/facts.md', 9) },
    { id: 'rule:held', kind: 'rule', title: 'Already there', text: 'Test first.', covered: 'proj/test-first', source: src('CLAUDE.md', 8) },
  ],
  folders: [{ path: 'runs/', role: 'machinery', end: 'delete', why: 'run logs', evidence: { lastTouch: '2026-01-02', commits: 4, untracked: 0, openItems: 0, liveCites: [], codeReaders: [] } }],
  calls: [],
  claude: [{ file: 'CLAUDE.md', line: 5, clause: 'Keep it short.', fate: 'rule', item: 'rule:r1', why: 'a working rule' }],
};
const plain = () => JSON.parse(JSON.stringify(proposal));

test('the proposal becomes the plan: refs in order, old dates and the label carried, cut and covered items held out', async (t) => {
  const plan = buildPlan(plain(), { readVersion: (v) => 'state at ' + v.commit, readFile: () => '', session: 's1' });
  assert.deepEqual(plan.steps.map((s) => s.op), ['ws create', 'task create', 'task create', 'track new', 'handoff write', 'handoff write', 'decide', 'decide', 'knowledge new',
    'register', 'profile rule-add', 'knowledge new', 'profile rule-add', 'profile add']);
  /* the superseded entry is written first, so its superseder's decide can mark it */
  const [old, later] = plan.steps.filter((s) => s.op === 'decide');
  assert.deepEqual([old.item, later.item, later.stdin.supersedes], ['decision:d0', 'decision:d1', ['@{decision:d0}']]);
  const track = plan.steps.find((s) => s.op === 'track new');
  assert.deepEqual(track.args.filter((a, i) => track.args[i - 1] === '--task'), ['@{task:done}', '@{task:open}']);
  assert.deepEqual(['--workstream', '--label', '--ref'].map((f) => track.args[track.args.indexOf(f) + 1]), ['@{workstream}', 'import:proj', 'onboard:track:a']);
  /* an old version first, with its own date, then the live handoff as the newest */
  const handoffs = plan.steps.filter((s) => s.op === 'handoff write');
  assert.deepEqual(handoffs.map((s) => s.item), ['track:a', 'handoff:a']);
  assert.ok(handoffs[0].stdin.created === AT1 && /state at c1/.test(handoffs[0].stdin.state) && /Half done/.test(handoffs[1].stdin.state));
  /* the session names who wrote each record, but never holds the tracks or hands its own tasks over */
  for (const s of [track, ...handoffs]) assert.ok(!s.args.includes('--session') && !(s.stdin && s.stdin.session), s.op + ' runs with no session');
  for (const s of plan.steps.filter((x) => x.stdin && x.stdin.refs && x.item)) {
    const item = proposal.items.find((r) => r.id === s.item);
    assert.ok(s.stdin.labels.includes('import:proj') && s.stdin.refs.includes('onboard:' + s.item), s.item + ' carries the label and its ref');
    if (item.fields.date) assert.ok(s.stdin.created === item.fields.date && (s.stdin.description || s.stdin.body || s.stdin.gist).includes(item.fields.date), s.item + ' keeps its old date');
  }
  /* the board reads a bare Q-and-number token in prose as its own record, so the old label becomes the title */
  const asked = plan.steps.find((s) => s.op === 'register').stdin;
  for (const k of ['name', 'ask']) assert.doesNotMatch(asked[k], /(^|[^/.\w])Q\d+\b(?!-[a-z])/, k + ' carries no old label');
  assert.equal(asked.track, null, "T-943: never the onboarding session's held track");
  /* the long rule's detail goes to a record made first, which its line points at; the profile is renamed */
  const lanes = plan.steps.find((s) => s.id === 'rule:lanes');
  assert.ok(plan.steps.find((s) => s.id === 'rule:lanes@detail').n < lanes.n);
  assert.match(lanes.args[lanes.args.indexOf('--text') + 1], /@\{rule:lanes@detail\}/);
  assert.equal(lanes.args[2], 'proj-2');
  assert.deepEqual(plan.steps.find((s) => s.op === 'profile add').args.slice(2, 4), ['C:/work/proj', 'proj-2']);
  assert.deepEqual([plan.left, plan.covered.map((c) => c.item), plan.pending], [['fact:cut'], ['rule:held'], []]);
  assert.deepEqual(plan.cards.map((c) => c.target), ['docs/procedures/build.md']);
  assert.deepEqual(plan.idmap['docs/decisions.md#D2'], { kind: 'decision', step: 'decision:d1', item: 'decision:d1', id: null });
  assert.deepEqual(plan.claude[0].clauses[0].fate, 'carried');
  assert.equal(plan.folders[0].end, 'delete');

  /* a workstream already on the board takes the import; a rule citing a folder that goes waits for new words */
  const p = plain();
  p.workstream = { use: 'WS-4' };
  p.items.push({ id: 'rule:cites', kind: 'rule', title: 'Logs', text: 'Read runs/latest.md first.', fields: {}, source: src('CLAUDE.md', 9) });
  const into = buildPlan(p, { readVersion: () => '', readFile: () => '' });
  assert.ok(!into.steps.some((s) => s.op === 'ws create'));
  assert.equal(into.steps.find((s) => s.op === 'track new').args[3], 'WS-4');
  assert.match(into.pending.find((x) => x.item === 'rule:cites').why, /runs/);

  /* an item goes to the workstream it names or its board track's, and a task named onto a board track is placed there;
     a new record on the subject of one the board holds waits until the session judges it */
  const w = plain();
  w.board = { ...w.board, workstreams: [{ id: 'WS-4' }, { id: 'WS-5' }], tracks: [{ id: 'TR-3', name: 'Accounts', workstream: 'WS-5' }],
    knowledge: [{ id: 'K-40', name: 'The upload pool holds four workers', status: 'active' }] };
  w.workstream = { use: 'WS-4' };
  w.items.push({ id: 'task:acct', kind: 'task', title: 'Switch accounts', fields: { status: 'open', track: 'TR-3' }, source: src('acct/NOW.md', 2) },
    { id: 'decision:acct', kind: 'decision', title: 'Drop the old payer', text: 'Drop it.', fields: { workstream: 'WS-5' }, source: src('acct/DECISIONS.md', 3) },
    { id: 'fact:pool', kind: 'knowledge', title: 'Upload pool holds four workers', text: 'Four.', fields: {}, source: src('docs/facts.md', 7) });
  const split = buildPlan(w, { readVersion: () => '', readFile: () => '' });
  assert.equal(split.steps.find((x) => x.id === 'task:acct').stdin.workstream, 'WS-5');
  assert.deepEqual(split.steps.find((x) => x.id === 'task:acct@place').args.slice(3, 5), ['--track', 'TR-3']);
  assert.deepEqual(split.steps.find((x) => x.id === 'decision:acct').stdin.workstreams, ['WS-5']);
  assert.match(split.pending.find((x) => x.item === 'fact:pool').why, /K-40/);
  /* a redo after the undo: K-40 and the rule's detail K-41 are this import's own records, which the undo left standing,
     and K-40 carries the ref of a reconcile whose amend stood, so neither the detail nor the amend is written twice */
  const fixed = { id: 'checkup:reconcile:fact:a', kind: 'fix', fields: { already: 'K-40', gaps: ['Four workers.'], fix: { op: 'knowledge edit', args: ['knowledge', 'edit', 'K-40', '--add-ref', 'onboard:fact:a'], target: 'K-40' } } };
  const redoOf = (refs) => buildPlan({ ...w, items: [...w.items, fixed], board: { ...w.board, knowledge: [{ ...w.board.knowledge[0], refs }],
    imported: [{ id: 'K-40', refs: ['onboard:fact:old-pool'] }, { id: 'K-41', refs: ['onboard:rule:lanes@detail'] }] } }, { readVersion: () => '', readFile: () => '' });
  const redo = redoOf(['onboard:fact:a']);
  const lanesAgain = redo.steps.find((x) => x.id === 'rule:lanes');
  assert.ok(redo.steps.some((x) => x.id === 'fact:pool') && !redo.steps.some((x) => x.id === 'rule:lanes@detail'));
  assert.ok(lanesAgain.args[lanesAgain.args.indexOf('--text') + 1].includes('K-41'));
  /* coverage reads the held detail as the rule's record, so the source it backs reads no gap */
  const read = recordReader({ manifest: { imports: [] }, show: async (ids) => ids.map((id) => ({ id, body: 'the detail ' + id })), rules: [{ rule: 'lanes', text: 'Size lanes.' }] });
  const heldLanes = redo.items.find((x) => x.id === 'rule:lanes');
  await read.prefetch([heldLanes]);
  assert.match(read(heldLanes), /the detail K-41/);
  assert.deepEqual([redo.steps.some((x) => x.item === fixed.id), redoOf([]).steps.filter((x) => x.item === fixed.id).map((x) => x.op)], [false, ['knowledge edit', 'knowledge amend']]);
  w.items.at(-1).fields.apart = ['K-40'];
  assert.ok(buildPlan(w, { readVersion: () => '', readFile: () => '' }).steps.some((x) => x.id === 'fact:pool'));

  /* where Claude reads AGENTS.md alone its ledger takes the section and a clause naming no file, never a new CLAUDE.md;
     a split clause needs its kept words; a fact from a `paths:` menu carries the menu's globs, and one the board holds gains them */
  const a = plain();
  a.claude = [
    { file: 'AGENTS.md', line: 3, clause: 'The Viewer never runs node logic; it hosts WebSockets on port 5000.', fate: 'split', item: 'rule:r1', kept: 'The Viewer hosts WebSockets on port 5000.' },
    { line: 5, clause: 'Old note.', fate: 'drop', why: 'the tool it names is gone' },
    { file: 'AGENTS.md', line: 7, clause: 'Shaders build on import, so never edit them by hand.', fate: 'split', item: 'rule:r1' },
  ];
  a.items.push({ id: 'fact:menu', kind: 'knowledge', title: 'Shaders build on import', text: 'Shaders build on import.', fields: {}, source: src('.claude/rules/shaders.md', 4) },
    { id: 'fact:there', kind: 'knowledge', title: 'Shader cache', covered: 'K-41', fields: {}, source: src('.claude/rules/shaders.md', 6) });
  const globs = ['Assets/Shaders/**', '*.shader'];
  const facts = { instructions: { files: [{ file: 'AGENTS.md', read: 'start' }] }, ruleFiles: [{ file: '.claude/rules/shaders.md', loads: [{ by: 'rules', paths: globs }] }] };
  const menuRule = (kind, fields = {}, id = 'rule:menu') => ({ id, kind, title: 'Never hand-edit shaders', text: 'Never hand-edit shaders.', fields, source: src('.claude/rules/shaders.md', 8) });
  a.items.push(menuRule('rule'));
  const ag = buildPlan(withFacts(a, facts), { readVersion: () => '', readFile: () => '' });
  assert.deepEqual([ag.section, ag.claude.map((l) => [l.path, l.clauses.map((c) => c.line)])], ['AGENTS.md', [['AGENTS.md', [3, 5]]]]);
  assert.equal(ag.claude[0].clauses[0].kept, 'The Viewer hosts WebSockets on port 5000.');
  assert.match(ag.pending.find((x) => /never edit them/.test(x.title)).why, /kept/, 'a split with no kept words waits');
  const flags = (s, f) => s.args.filter((x, i) => s.args[i - 1] === f);
  /* a `paths:` rule loads on a read too, so its record's globs carry the (read) marker */
  const links = globs.map((g) => '(edit read) ' + g);
  assert.deepEqual(flags(ag.steps.find((s) => s.id === 'fact:menu'), '--file'), links);
  const edit = ag.steps.find((s) => s.id === 'fact:there@files');
  assert.deepEqual([edit.op, edit.fix, edit.args[2], flags(edit, '--add-file')], ['knowledge edit', true, 'K-41', links]);
  /* a rerun adds only the globs the record lacks, and nothing once it holds them all */
  const again = (files) => buildPlan(withFacts({ ...a, board: { ...a.board, knowledge: [{ id: 'K-41', name: 'Shader cache', status: 'active', files }] } }, facts), { readVersion: () => '', readFile: () => '' })
    .steps.find((s) => s.id === 'fact:there@files');
  assert.deepEqual([flags(again([links[0]]), '--add-file'), again(links)], [[links[1]], undefined]);
  /* a menu whose lines name globs scopes each body to its own line's; a slash list names each word's
     entry, and a line naming only an intent takes none, never the entries no line names */
  const proj = tempDir('onboard-handover-', t);
  mkdirSync(join(proj, '.claude', 'rules'), { recursive: true });
  const menuPaths = ['Game/**', '**/*.shader', '**/TideHub*', '**/ChartUpdater*', '**/*.uss'];
  writeFileSync(join(proj, '.claude/rules/unity.md'), '---\npaths: ' + JSON.stringify(menuPaths) + '\n---\n- Scripts (`Game/**/*.cs`): bodies/scripts.md\n- Shaders, editing .shader files: bodies/shaders.md\n'
    + '- Tide hub/updater wiring: bodies/hub.md\n- Orientation: bodies/overview.md\n');
  const bodies = ['scripts', 'shaders', 'hub', 'overview'];
  const onMenu = (n) => ({ file: 'bodies/' + bodies[n - 4] + '.md', loads: [{ by: 'menu', from: '.claude/rules/unity.md:' + n, paths: menuPaths }] });
  const menuScopes = withFacts(plain(), { project: { dir: proj }, ruleFiles: [{ file: '.claude/rules/unity.md', loads: [{ by: 'rules', paths: menuPaths }] }, ...[4, 5, 6, 7].map(onMenu)] }).scopes;
  assert.deepEqual(bodies.map((b) => menuScopes['bodies/' + b + '.md']), [['Game/**/*.cs'], ['**/*.shader'], ['**/TideHub*', '**/ChartUpdater*'], undefined]);
  /* a clause of the facts' ledger the proposal leaves out waits and joins its ledger with no fate, so coverage
     holds the rewrite; one an earlier run kept on evidence that still holds stands */
  const kept = 'The API listens on port 8080.';
  const left = buildPlan(withFacts(a, { ...facts, claude: [{ file: 'AGENTS.md', line: 3, clause: a.claude[0].clause }, { file: 'AGENTS.md', line: 11, clause: 'Always run the linter.' },
    { file: 'AGENTS.md', line: 12, clause: kept }], conversion: { judgments: [{ key: clauseId('AGENTS.md', kept), kind: 'clause', fate: 'keep', state: 'holds' }] } }), { readVersion: () => '', readFile: () => '' });
  assert.deepEqual([left.pending.filter((x) => x.item.startsWith('clause:')).map((x) => x.item), left.claude[0].clauses.filter((c) => !c.fate).map((c) => c.line)], [['clause:AGENTS.md#L11'], [11]]);

  /* a rule from the menu keeps its scope: written as a flat line it waits (unless it holds everywhere);
     as a decision it governs the globs and its commands, its detail record triggering on the globs; as a card they are its triggers */
  assert.match(ag.pending.find((x) => x.item === 'rule:menu').why, /Assets\/Shaders/);
  const sc = JSON.parse(JSON.stringify(a));
  sc.items.splice(-1, 1, menuRule('rule', { everywhere: 'it is taste for all code' }), menuRule('decision', { detail: 'The importer rebuilds them.', commands: ['node tools/shade.mjs'] }, 'decision:menu'),
    menuRule('card', { steps: [{ text: 'Rebuild', run: 'node tools/shade.mjs' }] }, 'card:menu'));
  const sg = buildPlan(withFacts(sc, facts), { readVersion: () => '', readFile: () => '' });
  assert.ok(sg.steps.some((s) => s.id === 'rule:menu') && !sg.pending.some((x) => /menu/.test(x.item)), 'a rule that holds everywhere is a line');
  const dec = sg.steps.find((s) => s.id === 'decision:menu');
  const det = sg.steps.find((s) => s.id === 'decision:menu@detail');
  assert.deepEqual([dec.stdin.files, dec.stdin.commands, flags(det, '--file'), det.n < dec.n, dec.stdin.body.includes('@{decision:menu@detail}')], [links, ['node tools/shade.mjs'], links, true, true]);
  /* a card stays on edits and commands */
  const card = cardText(cardRow(sg.items.find((x) => x.id === 'card:menu'), 'docs/procedures/menu.md')).text;
  assert.match(/^---\n([\s\S]*?)\n---/.exec(card)[1], /files: \[.*Assets\/Shaders\/\*\*.*\*\.shader/);
  assert.ok(!card.includes('(edit read)'));

  /* a command loading a rule file whose folder goes waits until it retires in the same run */
  facts.ruleFiles[0].loads.push({ by: 'command', from: '.claude/commands/shaders.md:2' });
  a.folders.push({ path: '.claude/rules/', end: 'delete', why: 'converted' });
  const loaders = (x) => buildPlan(withFacts(x, facts), { readVersion: () => '', readFile: () => '' }).pending.filter((p) => p.item.startsWith('loader:')).map((p) => p.item);
  assert.deepEqual(loaders(a), ['loader:.claude/commands/shaders.md']);
  /* or it stays with `repoint: true`, and its cite of the whole file names what that file became */
  const rp = buildPlan(withFacts({ ...a, folders: [...a.folders, { path: '.claude/commands/', end: 'keep', shape: 'outside-reader', repoint: true }] }, facts), { readVersion: () => '', readFile: () => '' });
  assert.deepEqual([loaders({ ...a, folders: [...a.folders, { path: '.claude/commands/', end: 'keep', repoint: true }] }), rp.repointed, rp.idmap['.claude/rules/shaders.md'].steps],
    [[], [{ loader: '.claude/commands/shaders.md', files: ['.claude/rules/shaders.md'] }], ['fact:menu']]);
  a.folders.push({ path: '.claude/commands/shaders.md', end: 'retire', why: 'it loads the shader rules' });
  assert.deepEqual(loaders(a), []);
  /* the other way, the command retiring while the rules file it loads stays: the harness still loads that file */
  a.folders = a.folders.filter((f) => f.path !== '.claude/rules/');
  assert.deepEqual(buildPlan(withFacts(a, facts), { readVersion: () => '', readFile: () => '' }).unloaded.map((u) => [u.file, u.why]), [['.claude/rules/shaders.md', 'the harness loads it']]);
  /* a loader retires while a file it loads stays as the project, when the file still reaches a session (the pointer
     whose clause stays) or is kept with its shape: the file stays, its load goes; a hook that loads nothing may enforce,
     so it never leaves unseen with its folder */
  facts.ruleFiles.push({ file: 'docs/DESIGN.md', loads: [{ by: 'pointer', from: 'AGENTS.md:9' }, { by: 'hook', from: '.claude/hooks/inject.mjs:3' }] },
    { file: '.claude/hooks/inject.mjs', loads: [{ by: 'hook', event: 'SessionStart', from: '.claude/settings.json' }] },
    { file: '.claude/hooks/fmt.mjs', loads: [{ by: 'hook', event: 'PostToolUse', from: '.claude/settings.json' }] });
  facts.ruleFiles[0].loads.push({ by: 'hook', from: '.claude/hooks/inject.mjs:2' });
  a.folders = [{ path: '.claude/rules/', end: 'delete' }, { path: '.claude/commands/shaders.md', end: 'retire' }, { path: '.claude/hooks/', end: 'retire' }];
  const waits = () => { const pl = buildPlan(withFacts(a, facts), { readVersion: () => '', readFile: () => '' }); return [pl.pending.map((x) => x.item).filter((x) => /^(loader|retire|hook):/.test(x)), pl.unloaded]; };
  let [w1, un] = waits();
  assert.deepEqual([w1, un.map((u) => [u.file, u.why])], [['hook:.claude/hooks/fmt.mjs'], [['docs/DESIGN.md', 'still loaded by AGENTS.md:9']]]);
  a.folders.push({ path: '.claude/hooks/fmt.mjs', end: 'retire' });
  a.claude.push({ file: 'AGENTS.md', line: 9, clause: 'The design is in docs/DESIGN.md.', fate: 'drop', why: 'a pointer' });
  assert.deepEqual(waits()[0], ['retire:.claude/hooks/inject.mjs'], 'its pointer gone, the doc has no load left');
  /* the dropped pointer names what it loads, so the handover keeps it while that is held */
  assert.deepEqual(buildPlan(withFacts(a, facts), { readVersion: () => '', readFile: () => '' }).claude[0].clauses.find((c) => c.line === 9).loads, ['docs/DESIGN.md']);
  a.folders.push({ path: 'docs/DESIGN.md', end: 'keep', shape: 'for-people', why: 'the design spec' });
  [w1, un] = waits();
  assert.deepEqual([w1, un.map((u) => u.why)], [[], ['kept (for-people)']]);
  /* a rule file whose load the survey missed is read whole when its unit goes, and so is a file the
     `loaders` correction names, so an omitted rule in either is a coverage gap */
  facts.ruleFiles.push({ file: '.claude/rule-bodies/session.md', loads: [] });
  a.folders.push({ path: '.claude/rule-bodies/', end: 'delete' }, { path: 'notes/', end: 'delete' });
  const whole = (x) => buildPlan(withFacts(x, facts), { readVersion: () => '', readFile: () => '' }).readWhole || [];
  assert.ok(whole(a).includes('.claude/rule-bodies/session.md'));
  assert.ok(whole({ ...a, loaders: { 'notes/body.md': ['.claude/hooks/inject.mjs'] } }).includes('notes/body.md'));
});

test('the plan refuses while a call waits; an answer applies its effect to items and folders; the go is recorded', () => {
  const p = plain();
  p.items.push({ id: 'task:dormant', kind: 'task', title: 'Old plan step', text: 'Old plan step.', cut: true, fields: { status: 'open' }, source: src('docs/plans/x/PLAN.md', 4) },
    { id: 'task:wanted', kind: 'task', title: 'Wanted step', text: 'Wanted step.', cut: true, fields: { status: 'open', track: 'track:y' }, source: src('docs/plans/y/PLAN.md', 4) });
  p.folders.push({ path: 'docs/plans/', role: 'machinery', end: 'delete', why: 'plans', evidence: { openItems: 2 } });
  p.calls.push({ id: 'dormant-plans', ask: 'Which old plans are still wanted?', pick: 'a', answer: null, options: [
    { letter: 'a', label: 'only y', effect: { keep: ['task:wanted'], drop: ['task:dormant'], add: [{ id: 'track:y', kind: 'track', title: 'Plan y', fields: { name: 'Plan y' }, source: src('docs/plans/y/PLAN.md') }] } },
    { letter: 'b', label: 'none, keep the folder', effect: { drop: ['task:dormant', 'task:wanted'], folders: { 'docs/plans/': 'keep' } } }] });
  /* one answer keeping the folder and another converting what it holds is the card's to settle, answered or not */
  p.calls[0].answer = 'b';
  assert.throws(() => buildPlan(p, { readFile: () => '' }), (e) => e instanceof WaitingError && e.waiting[0].notACall && /docs\/plans\//.test(e.waiting[0].why));
  p.calls[0].options[1] = { letter: 'b', label: 'none; plan x stays as the roadmap for people', effect: { drop: ['task:dormant', 'task:wanted'], folders: { 'docs/plans/x/': 'keep' } } };
  p.calls[0].answer = null;
  assert.throws(() => buildPlan(p, { readFile: () => '' }), (e) => e instanceof WaitingError && e.waiting[0].call === 'dormant-plans' && !e.waiting[0].notACall);
  p.calls[0].answer = 'a';
  const plan = buildPlan(p, { readVersion: () => '', readFile: () => '' });
  assert.ok(plan.steps.some((s) => s.item === 'task:wanted') && !plan.steps.some((s) => s.item === 'task:dormant'));
  assert.equal(plan.items.find((x) => x.id === 'task:dormant').dropped, 'dormant-plans');
  assert.equal(plan.folders.find((f) => f.path === 'docs/plans/').answeredBy, 'dormant-plans', 'the answer settles the folder\'s open items');
  /* a second run from another session, its items named its own way and its call unanswered: the map holds every
     source unchanged and the call answered with its subjects unchanged, so it writes nothing and asks nothing */
  const files = [...new Set(p.items.concat(p.calls[0].options[0].effect.add).map((x) => x.source && x.source.file).filter(Boolean))];
  const conversion = (changed = []) => ({ sources: files.map((f) => ({ source: f, records: ['T-1'], state: changed.includes(f) ? 'changed' : 'unchanged' })),
    calls: [{ call: 'dormant-plans', answer: 'a', state: 'unchanged' }] });
  const second = () => {
    const q = JSON.parse(JSON.stringify(p).replace(/"(track:y|task:wanted|task:dormant|fact:a)"/g, '"$1-again"'));
    q.calls[0].answer = null;
    q.board = { ...q.board, imported: [{ id: 'WS-3', refs: ['onboard:workstream'] }] };
    return q;
  };
  /* an instruction file's items are held by their records, never by its hash, so a re-judged clause is written */
  const ledgerOnly = buildPlan(withFacts(second(), { conversion: conversion() }), { readVersion: () => '', readFile: () => '' });
  assert.deepEqual(ledgerOnly.steps.filter((s) => s.item).map((s) => s.item), ['rule:r1']);
  const inForce = second();
  inForce.board.rules = [{ rule: 'keep-it-short', text: 'Keep it short.', source: 'proj on C:/work/proj' }];
  const again = buildPlan(withFacts(inForce, { conversion: conversion() }), { readVersion: () => '', readFile: () => '' });
  assert.deepEqual(again.steps.filter((s) => s.item || s.op === 'ws create'), [], 'nothing written twice');
  assert.ok(again.covered.some((c) => c.item === 'track:y-again' && c.rerun) && again.answers[0].before, 'the call is answered from the map');
  assert.deepEqual([again.left, again.covered.some((c) => /^(fact:cut|task:dormant)/.test(c.item))], [['fact:cut', 'task:dormant-again'], false], 'cut and answer-dropped items of an unchanged source are left out, not written');
  /* a changed source is the only one whose items are written */
  const changed = buildPlan(withFacts(inForce, { conversion: conversion(['docs/facts.md']) }), { readVersion: () => '', readFile: () => '' });
  assert.deepEqual(changed.steps.filter((s) => s.item).map((s) => s.item), ['fact:a-again']);
  /* the facts give the project and the board; a board record's onboard: ref holds its item too */
  const bare = { ...plain(), project: undefined, board: undefined };
  const facts = { project: { path: 'C:/work/proj', remote: 'github.com/someone/proj' }, board: { imported: [{ id: 'T-9', refs: ['onboard:task:open'] }, { id: 'TR-5', refs: ['onboard:track:a'] }] } };
  const fromFacts = buildPlan(withFacts(bare, facts), { readVersion: () => '', readFile: () => '' });
  assert.equal(fromFacts.project.slug, 'proj');
  assert.deepEqual(fromFacts.covered.find((c) => c.item === 'task:open'), { item: 'task:open', by: 'T-9', rerun: true });
  assert.equal(fromFacts.covered.find((c) => c.item === 'handoff:a').by, 'TR-5', 'a handoff went with its track');
  /* after an undo the records it dropped hold nothing, so the rerun writes their items again */
  const undone = { ...facts, board: { imported: facts.board.imported.map((r) => ({ ...r, status: 'dropped' })) } };
  const rerun = buildPlan(withFacts({ ...plain(), project: undefined, board: undefined }, undone), { readVersion: () => '', readFile: () => '' });
  assert.ok(['task:open', 'handoff:a'].every((id) => !rerun.covered.some((c) => c.item === id) && rerun.steps.some((s) => s.item === id)));
  /* a file an earlier import's track only names holds its work, not the rulings in it */
  const seeded = { sources: [{ source: 'docs/decisions.md', records: ['TR-9'], kinds: ['track'], state: 'seeded' }] };
  const seededPlan = buildPlan(withFacts(plain(), { conversion: seeded }), { readVersion: () => '', readFile: () => '' });
  assert.ok(['decision:d0', 'decision:d1'].every((id) => seededPlan.steps.some((s) => s.item === id)));
  /* facts gathered before the work folder's last write or undo would write it again: the plan refuses them */
  const manifest = { imports: [{ at: '2026-11-01T10:00:00.000Z', done: '2026-11-01T10:01:00.000Z', undone: '2026-11-02T09:00:00.000Z', steps: [] }] };
  assert.ok(staleFacts({ made: '2026-11-01T09:00:00.000Z' }, manifest));
  assert.equal(staleFacts({ made: '2026-11-02T10:00:00.000Z' }, manifest), null);
  p.calls[0].answer = { letter: 'b' };
  assert.equal(buildPlan(p, { readVersion: () => '', readFile: () => '' }).folders.find((f) => f.path === 'docs/plans/x/').end, 'keep');
  assert.equal(recordGo(p, { session: 's1' }).go.from, 'chat');
  assert.throws(() => recordGo(p, {}));
});

test("a task's after and runBy become the track's layout; a question is tied to its track and gates; a parked track waits on a task", () => {
  const items = [
    { id: 'track:a', kind: 'track', title: 'Line A', fields: { name: 'Line A' }, source: src('STATE.md') },
    { id: 'task:fix', kind: 'task', title: 'Fix it', fields: { status: 'open', track: 'track:a', steps: ['find the cause', 'write the fix'] }, source: src('STATE.md', 3) },
    { id: 'task:deploy', kind: 'task', title: 'Deploy it', fields: { status: 'open', track: 'track:a', after: ['task:fix'], runBy: 'agent:opus' }, source: src('STATE.md', 4) },
    { id: 'question:go', kind: 'question', title: 'Ship it?', fields: { track: 'track:a', gates: ['task:deploy', 'T-7'] }, source: src('STATE.md', 6) },
    { id: 'track:mixer', kind: 'track', title: 'Mixer', fields: { name: 'Mixer', state: 'parked', unparkWhen: 'task:fix' }, source: src('PLAN.md', 9) },
  ];
  const plan = buildPlan({ ...plain(), items, claude: [] }, { readVersion: () => '', readFile: () => '' });
  const ops = plan.steps.map((s) => s.op);
  assert.equal(ops[ops.indexOf('track new') + 1], 'track layout', 'the layout follows the track it lays out');
  assert.deepEqual(plan.steps.find((s) => s.op === 'track layout').stdin.steps, [{ task: '@{task:fix}' }, { task: '@{task:deploy}', after: ['@{task:fix}'], runBy: 'agent:opus' }]);
  const scope = plan.steps.find((s) => s.op === 'question edit');
  assert.equal(scope.args[scope.args.indexOf('--track') + 1], '@{track:a}');
  assert.deepEqual(scope.args.filter((a, i) => scope.args[i - 1] === '--add-gate'), ['@{task:deploy}', 'T-7']);
  const park = plan.steps.find((s) => s.op === 'track park');
  assert.equal(park.args[park.args.indexOf('--unpark-when') + 1], 'task-completes @{task:fix}');
  /* a task's steps follow its create; a step the user owes holds the item until it is a question */
  const steps = plan.steps.find((s) => s.id === 'task:fix@steps');
  assert.ok(steps.n > plan.steps.find((s) => s.id === 'task:fix').n && steps.args.filter((a) => a === '--check-add').length === 2);
  items[1].fields.steps.push('the user looks at the fix in the app');
  const held = buildPlan({ ...plain(), items, claude: [] }, { readVersion: () => '', readFile: () => '' });
  assert.ok(held.pending.some((p) => p.item === 'task:fix'));
});

test('one line in force: a kept rule replaces a line on a profile only this project holds, clears one others hold, and switches off a setting', () => {
  const board = { profiles: [...proposal.board.profiles, { profile: 'team', records: ['C:/work/proj'], rules: ['x'] }, { profile: 'shared', records: ['C:/work/proj', 'C:/work/other'], rules: ['y'] }],
    rules: [{ rule: 'x', text: 'X old.', source: 'team on C:/work/proj' }, { rule: 'y', text: 'Y old.', source: 'shared on C:/work/proj' },
      { rule: 'dispatch.outputRule', text: 'Final response under 2000 characters.', source: 'built in' }] };
  const kept = (id, w) => ({ id, kind: 'rule', title: id, text: 'Mine.', fields: { slug: id.slice(5), replaces: w }, source: src('README.md', 2) });
  const plan = buildPlan({ ...plain(), board, items: [kept('rule:a', 'x'), kept('rule:b', 'y'), kept('rule:c', 'dispatch.outputRule')], claude: [] }, { readFile: () => '' });
  const at = (id) => plan.steps.filter((s) => s.id.startsWith(id));
  assert.deepEqual(at('rule:a').map((s) => s.args.slice(1, 4)), [['rule-add', 'team', 'x']]);
  assert.equal(at('rule:a')[0].restore.text, 'X old.', 'the undo puts the old words back');
  assert.deepEqual(at('rule:b').map((s) => s.args.slice(1, 3)), [['rule-add', 'proj-2'], ['rule-clear', 'shared']]);
  assert.ok(at('rule:c')[1].args.includes('dispatch.outputRule=false'));
});

test('the write runs every step in this one process through the CLI\'s own code, and the read-back reads records in batches', async (t) => {
  const base = tempDir('onboard-handover-', t);
  /* a launcher that exits 9 if anything spawns it, beside a lib that counts the calls made in process */
  mkdirSync(join(base, 'cli', 'bin'), { recursive: true });
  mkdirSync(join(base, 'cli', 'lib'));
  writeFileSync(join(base, 'cli', 'bin', 'askerdo.mjs'), 'process.exit(9);\n');
  const real = pathToFileURL(join(import.meta.dirname, '..', 'lib', 'cli-commands.mjs')).href;
  writeFileSync(join(base, 'cli', 'lib', 'cli-commands.mjs'), 'import { runCommand as real } from ' + JSON.stringify(real) + ';\n'
    + 'export async function runCommand(c) { (globalThis.onboardCalls ||= []).push(c.argv[0]); return real(c); }\n');
  const work = join(base, 'work');
  mkdirSync(work);
  const p = plain();
  p.project.dir = base.replace(/\\/g, '/');
  p.items = p.items.filter((x) => ['task:open', 'decision:d0', 'fact:a', 'rule:r1'].includes(x.id)).map((x) => ({ ...x, fields: { ...x.fields, track: undefined } }));
  /* the task names the real board's WS-2, whose stand-in takes scratch WS-1, so the run's own workstream is scratch WS-2 */
  p.items.find((x) => x.id === 'task:open').fields.workstream = 'WS-2';
  /* a kept folder and a kept clause, each with the evidence the next run re-checks */
  p.folders.push({ path: 'tools', end: 'keep', why: 'the build scripts', shape: 'the project\'s product', evidence: { codeReaders: ['package.json:3'], commits: 4 } });
  p.claude = [{ file: 'CLAUDE.md', line: 2, clause: 'The build runs on Node 22.', fate: 'keep', why: 'a fact about the project', evidence: { cites: ['package.json'] } }];
  const built = buildPlan(p, { readFile: () => '' });
  /* a placement on a real board track runs on a stand-in track, never as an empty edit */
  built.steps.push({ n: built.steps.length + 1, id: 'task:open@place', item: 'task:open', op: 'task edit', args: ['task', 'edit', '@{task:open}', '--track', 'TR-7'] });
  writeFileSync(join(work, 'plan.json'), JSON.stringify(built));
  const was = process.env.ASKERDO_SANDBOX_HOME;
  process.env.ASKERDO_SANDBOX_HOME = join(base, 'home');
  t.after(() => { if (was === undefined) delete process.env.ASKERDO_SANDBOX_HOME; else process.env.ASKERDO_SANDBOX_HOME = was; });
  await assert.rejects(applyPlan(work, { board: 'live', cli: join(base, 'cli', 'bin', 'askerdo.mjs'), log: () => {} }), /no go/, 'the live write waits on the go');
  const board = 'file:' + join(base, 'board.db').replace(/\\/g, '/');
  const r = await applyPlan(work, { board, cli: join(base, 'cli', 'bin', 'askerdo.mjs'), log: () => {} });
  assert.deepEqual(r.refusals, []);
  assert.deepEqual([r.timing.steps, r.scratch], [7, []], 'the placement ran on the stand-in track, nothing left out');
  /* the approved plan files whole, so a placement step carries the user's mark the board never asks about */
  assert.deepEqual(asApproved(['task', 'edit', 'T-1', '--track', 'TR-7', '--tier', '3', '--session', 's1'], 'go').slice(-2), ['--user', 'go']);
  assert.ok(!asApproved(['ws', 'create', '--session', 's1'], 'go').includes('--user'), 'only a filing step');
  /* the decision goes to the workstream the run made, never to the stand-in holding the same id on the real board */
  const onWs = (await cliRunner(join(base, 'cli', 'bin', 'askerdo.mjs'))(['decisions', '--workstream', 'WS-2', '--json'], { env: { ...process.env, ASKERDO_BOARD_URL: board } })).out;
  assert.deepEqual(onWs.map((d) => d.name), ['Use W']);
  /* the write maps each source to the records it became, and the run */
  const map = (await cliRunner(join(base, 'cli', 'bin', 'askerdo.mjs'))(['conversion', '--project', p.project.dir], { env: { ...process.env, ASKERDO_BOARD_URL: board } })).out;
  assert.deepEqual(map.rows.filter((x) => x.kind === 'file').map((x) => [x.source, x.records.length > 0]).sort(), [['CLAUDE.md', true], ['TODO.md', true], ['docs/decisions.md', true], ['docs/facts.md', true]]);
  assert.ok(map.last && map.last.source.startsWith('run:'));
  const judged = map.rows.find((x) => x.kind === 'run').detail.judged;
  assert.deepEqual(judged.map((j) => [j.kind, j.subject, j.evidence]), [['folder', 'tools/', { readers: ['package.json'] }], ['clause', 'CLAUDE.md', { cites: ['package.json'] }]]);
  globalThis.onboardCalls = [];
  const cov = await runCoverage(work, { board, cli: join(base, 'cli', 'bin', 'askerdo.mjs'), log: () => {} });
  assert.ok(cov.sources.every((s) => !s.blocked), 'each record read back covers its source');
  assert.equal(globalThis.onboardCalls.filter((c) => c === 'show').length, 1, 'three records, one show');

  /* a gap holds the folder at the first write; the item added for it is written on the next run and read
     back from the board, since the source's map row holds only the line coverage passed */
  const body = 'bodies/x.md';
  mkdirSync(join(base, 'bodies'));
  writeFileSync(join(base, body), '# X\n\n- Ask the user before a schema migration.\n- Never deploy on a Friday.\n');
  const xRule = (n, slug, text) => ({ id: 'rule:x#L' + n, kind: 'rule', title: text, text, fields: { text, slug }, source: src(body, n) });
  const fx = { version: 1, project: { dir: p.project.dir, slug: 'fx' }, workstream: {}, calls: [], claude: [], folders: [{ path: 'bodies/', end: 'delete', why: 'converted' }], textFiles: [body],
    items: [xRule(3, 'ask-before-migration', 'Ask the user before a schema migration.')] };
  const work2 = join(base, 'work2');
  mkdirSync(work2);
  const cli = join(base, 'cli', 'bin', 'askerdo.mjs');
  const rehearse = async (x) => { const pl = buildPlan(x, { readFile: () => '' }); writeFileSync(join(work2, 'plan.json'), JSON.stringify(pl)); assert.deepEqual((await applyPlan(work2, { board, cli, log: () => {} })).refusals, []); return pl; };
  await rehearse(fx);
  const gapAt = (c) => c.sources.find((s) => s.file === body).gaps.map((g) => g.line || g.item);
  assert.deepEqual(gapAt(await runCoverage(work2, { board, cli, log: () => {} })), [4]);
  const rows = (await cliRunner(cli)(['conversion', '--project', p.project.dir], { env: { ...process.env, ASKERDO_BOARD_URL: board } })).out.rows;
  const marked = markMap({ rows }, { hashOf: (f) => blobsOf(base, [f]).get(f), exists: (f) => existsSync(join(base, f)), sigOf: () => null });
  const fixed = await rehearse({ ...fx, map: { sources: marked.sources }, items: [...fx.items, xRule(4, 'no-friday-deploys', 'Never deploy on a Friday.')] });
  assert.deepEqual([fixed.steps.filter((s) => s.op === 'profile rule-add').map((s) => s.item), fixed.covered.map((c) => c.item)], [['rule:x#L4'], ['rule:x#L3']]);
  const again = await runCoverage(work2, { board, cli, log: () => {} });
  assert.deepEqual([gapAt(again), again.sources.find((s) => s.file === body).covered], [[], 2], 'the added rule is read back from its line on the board');
});

test('the live write pauses notifications and lifts its own pause after a long async write', async () => {
  const server = { pausedUntil: '' };
  let dropNext = false;
  const call = async (body) => {
    if (dropNext) { dropNext = false; return null; }
    if (body) server.pausedUntil = body.pause === 'hour' ? '2026-11-02 12:00 +00:00' : '';
    return { pausedUntil: server.pausedUntil, pauseLabel: server.pausedUntil ? 'until 12:00' : '' };
  };
  const out = await quietWrite(async () => {
    await new Promise((r) => setTimeout(r, 30));
    assert.ok(server.pausedUntil, 'paused while the write runs');
    dropNext = true;
    return 'written';
  }, { log: () => {}, call, retryMs: 1 });
  assert.equal(out, 'written');
  assert.equal(server.pausedUntil, '', 'notifications are on again');

  /* a write longer than the pause renews it while it runs; a pause the user changes meanwhile stays theirs */
  let renewed = 0;
  const clock = async (body) => {
    if (body && body.pause === 'hour') { renewed++; server.pausedUntil = 'until ' + renewed; }
    else if (body) server.pausedUntil = '';
    return { pausedUntil: server.pausedUntil, pauseLabel: server.pausedUntil };
  };
  /* the write runs until three renewals land, not a fixed time a loaded CPU stretches */
  const untilRenewed = async () => { for (let i = 0; i < 1000 && renewed <= 2; i++) await new Promise((r) => setTimeout(r, 5)); };
  await quietWrite(untilRenewed, { log: () => {}, call: clock, retryMs: 1, renewMs: 10 });
  assert.ok(renewed > 2, 'renewed while the write ran');
  assert.equal(server.pausedUntil, '');
  renewed = 0;
  await quietWrite(async () => {
    await new Promise((r) => setTimeout(r, 25));
    server.pausedUntil = 'the user\'s own';
    await new Promise((r) => setTimeout(r, 40));
  }, { log: () => {}, call: clock, retryMs: 1, renewMs: 10 });
  assert.equal(server.pausedUntil, 'the user\'s own');
});
