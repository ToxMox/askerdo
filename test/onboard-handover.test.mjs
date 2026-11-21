/* coverage gates the handover; the instruction files are rewritten from their ledgers; the
 * handover lands in one commit that one git revert takes back, holding back what it must not delete; the rehearsal
 * proves the undo. The git cases copy one fixture repo built once for the file. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { clausesOf, coverage, covers } from '../skills/onboard/coverage.mjs';
import { cardRow, cardText } from '../skills/onboard/cards.mjs';
import { applyPlan, claudeText, cliRunner, gatesOf, handover, keptBack, rehearse, runCoverage, undoImport } from '../skills/onboard/apply.mjs';
import { claudeLedger } from '../skills/onboard/survey.mjs';
import { buildPlan, withFacts } from '../skills/onboard/plan.mjs';
import { boardRecords, evidenceOf } from '../skills/onboard/map.mjs';
import { keptPath, readKept, settleFiles } from '../lib/loose-files.mjs';
import { boardCall } from '../lib/board-call.mjs';
import { dataDir } from '../lib/node-helpers.mjs';
import { tempDir } from './helpers/sandbox.mjs';

const CLI = join(import.meta.dirname, '..', 'bin', 'askerdo.mjs');
const gitAt = (dir) => (args) => execFileSync('git', ['-c', 'core.autocrlf=false', ...args], { cwd: dir, encoding: 'utf8' });

/* the fixture: an old workflow beside the project it ran, committed once */
const FIXTURE = join(tempDir('onboard-handover-'), 'proj');
const BASE = (() => {
  const files = {
    'runs/2026-01/run-0.md': 'Run 0.\n', 'runs/2026-01/run-1.md': 'Run 1.\n', 'DECISIONS.md': '# Decisions\n',
    'tools/data/a.json': '{}\n', 'tools/read.mjs': "readFileSync('tools/data/a.json');\n", 'tools/fmt.mjs': '// formats\n',
    /* a document and a skill citing a run that goes: the document stays as written, the skill a session reads is repointed */
    'docs/notes.md': 'The last run is in runs/2026-01/run-1.md.\n', 'docs/style.md': 'Runs live in runs/2026-01/run-1.md.\n',
    '.claude/skills/check/SKILL.md': '---\nname: check\ndescription: Use when checking.\n---\n\nThe last run is in runs/2026-01/run-1.md.\n',
    'CLAUDE.md': '# Proj\n\nBuild with `npm run build`.\n\n## Rules\n\n- Keep commits small.\n',
    'AGENTS.md': '# Proj\n\n- The Viewer never runs node logic and hosts WebSockets on port 5000.\n- Keep commits small.\n',
    '.claude/settings.json': JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'node .claude/hooks/load.mjs' }] }],
      PostToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'node tools/fmt.mjs' }] }] } }, null, 2) + '\n',
    '.claude/hooks/load.mjs': "process.stdout.write(readFileSync('rules/a.md', 'utf8'));\n", 'rules/a.md': 'Test first.\n', '.gitignore': '*.log\n!/rules/\n!keep.log\nAGENTS.override*.md\n',
    '.agents/skills/build/SKILL.md': '---\nname: build\ndescription: Use when building.\n---\n\n# Build\n\n1. Run `npm run build`.\n', '.agents/skills/build/notes.md': 'Old notes.\n', 'docs/procedures/build.md': '# Build\n',
    'plans/old/a.md': 'Done.\n',
  };
  for (const [f, text] of Object.entries(files)) { mkdirSync(join(FIXTURE, f, '..'), { recursive: true }); writeFileSync(join(FIXTURE, f), text); }
  const git = gitAt(FIXTURE);
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.name', 't']); git(['config', 'user.email', 't@example.invalid']); git(['config', 'core.autocrlf', 'false']);
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'work']);
  return git(['rev-parse', 'HEAD']).trim();
})();

/* a case's own copy of the fixture, a work folder, and a scratch board and home behind the seams */
function fixture(t) {
  const base = tempDir('onboard-handover-', t);
  const dir = join(base, 'proj');
  cpSync(FIXTURE, dir, { recursive: true });
  mkdirSync(join(dir, 'scratch'));
  writeFileSync(join(dir, 'scratch', 'loose.md'), 'Not in git.\n');
  const work = join(base, 'work');
  mkdirSync(work);
  const seams = { ASKERDO_BOARD_URL: 'file:' + join(base, 'board.db').replace(/\\/g, '/'), ASKERDO_SANDBOX_HOME: join(base, 'home') };
  mkdirSync(seams.ASKERDO_SANDBOX_HOME);
  const was = Object.fromEntries(Object.keys(seams).map((k) => [k, process.env[k]]));
  Object.assign(process.env, seams);
  t.after(() => { for (const [k, v] of Object.entries(was)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
  const put = (f, v) => writeFileSync(join(work, f), JSON.stringify(v));
  const manifest = (steps = []) => put('manifest.json', { label: 'import:proj', imports: [{ plan: 'p1', at: '2026-01-01T00:00:00Z', done: '2026-01-01T00:01:00Z', steps }], left: [] });
  const clean = () => put('coverage.json', { made: new Date().toISOString(), sources: [], claude: [] });
  return { base, dir, work, git: gitAt(dir), put, manifest, clean };
}
const changedIn = (git, sha) => git(['show', '--name-only', '--format=', sha]).trim().split('\n').sort();

test('coverage reads each converted source against its record: a lost flag is a gap, a cut item is a gap, an answered drop is backed', () => {
  const file = 'handoff/REFERENCE.md';
  const items = [
    { id: 'fact:gate', kind: 'knowledge', text: 'Run the sweep at most 30 s with `--each 10` unless the gate is red.', source: { file, line: 3 } },
    { id: 'fact:cut', kind: 'knowledge', text: 'A cut nobody answered.', cut: true, source: { file, line: 5 } },
    { id: 'fact:dropped', kind: 'knowledge', text: 'An old plan step.', cut: true, dropped: 'dormant-plans', source: { file, line: 6 } },
    { id: 'fact:held', kind: 'knowledge', text: 'Already there.', covered: 'K-4', source: { file, line: 7 } },
    /* a copy word for word is covered, a bracket or code span after a condition word included */
    { id: 'fact:copy', kind: 'knowledge', text: 'Play mode only (idle floor) and never `+=`; join `Config.ExpectedKeys`.', source: { file, line: 8 } },
    { id: 'fact:old', kind: 'decision', title: 'Rows (superseded by "Columns")', text: 'Rows.', cut: true, source: { file, line: 9 } },
    /* a split clause's rule is read with the fact words its file keeps */
    { id: 'rule:node', kind: 'rule', text: 'The Viewer is frontend-only and never runs node logic; it hosts WebSockets on port 5000.', source: { file: 'CLAUDE.md', line: 4 } },
    /* a clause a card carries: the handover writes the card after this pass */
    { id: 'card:build', kind: 'card', target: 'docs/procedures/build.md', text: 'Build with the build card.', source: { file: 'CLAUDE.md', line: 5 } },
    /* a clause whose fact is its own item and whose rule is a body's item is read against both records */
    { id: 'fact:port', kind: 'knowledge', text: 'The API never runs jobs; it listens on port 8080.', source: { file: 'CLAUDE.md', line: 6 } },
    { id: 'decision:jobs', kind: 'decision', text: 'The API never runs jobs.', source: { file: 'rules/api.md', line: 2 } },
  ];
  const manifest = { imports: [{ steps: [{ row: 'fact:gate', id: 'K-1' }, { row: 'fact:copy', id: 'K-2' }, { row: 'rule:node', id: 'proj/node' }, { row: 'fact:port', id: 'K-6' }, { row: 'decision:jobs', id: 'K-7' }] }] };
  const ledger = [{ path: 'CLAUDE.md', clauses: [{ text: 'Old rule.', line: 2, fate: 'dropped' }, { text: 'Kept.', line: 3, fate: 'kept' },
    { text: items.at(-4).text, line: 4, fate: 'split', kept: 'The Viewer is frontend-only and hosts WebSockets on port 5000.', item: 'rule:node' },
    { text: 'Build with the build card.', line: 5, fate: 'carried', item: 'card:build' }, { text: items.at(-2).text, line: 6, fate: 'carried', item: 'decision:jobs' }] }];
  const records = { 'fact:gate': 'Run the sweep at most 30s with 10 per pass, unless the gate is red.', 'fact:copy': 'Play mode only (idle floor), never `+=`; join `Config.ExpectedKeys`.',
    'rule:node': 'The Viewer never runs node logic.', 'card:build': 'Build with the build card.', 'fact:port': 'The API listens on port 8080.', 'decision:jobs': 'The API never runs jobs.' };
  const cov = coverage(items, { manifest, ledger, readRecord: (r) => records[r.id] });
  const s = cov.sources.find((x) => x.file === file);
  /* a table row's pipes are no part of its words, and a cut the run's sources mark out of force elsewhere is backed */
  const files = { 'log/topic.md': '|D10 Scoped work|No new task unless requested.|\n|Q168 trial|Let it convert.|\n|D22 Wind-down|Retired|Old rule.|\n',
    'log/INDEX.md': '|Q168|trial|[topic]|superseded by Q212|\n|Q169|other|[topic]|in force|\n' };
  const log = [
    { id: 'row:d10', kind: 'decision', title: 'D10 Scoped work', source: { file: 'log/topic.md', line: 1 } },
    { id: 'row:q168', kind: 'decision', title: 'Q168 trial', cut: true, source: { file: 'log/topic.md', line: 2 } },
    { id: 'row:d22', kind: 'decision', title: 'D22 Wind-down', cut: true, source: { file: 'log/topic.md', line: 3 } },
    { id: 'row:index', kind: 'decision', covered: 'Q169', source: { file: 'log/INDEX.md', line: 2 } },
  ];
  const t2 = coverage(log, { manifest: { imports: [{ steps: [{ row: 'row:d10', id: 'K-3' }] }] }, readFile: (f) => files[f], readRecord: () => 'D10 Scoped work: No new task unless requested.' });
  const topic = t2.sources.find((x) => x.file === 'log/topic.md');
  assert.deepEqual([topic.gaps, topic.backed], [[], 2]);
  /* a line edit's words are a gap unless an item names their line; a replace whose new words carry them takes nothing out */
  const le = coverage(log, { manifest: { imports: [{ steps: [{ row: 'row:d10', id: 'K-3' }] }] }, readFile: (f) => files[f], readRecord: () => 'D10 Scoped work: No new task unless requested.', lineEdits: [
    { file: 'log/topic.md', kind: 'strike', line: 1, words: 'No new task unless requested.', struck: 'No new task unless requested.' },
    { file: 'log/topic.md', kind: 'delete', line: 4, end: 5, struck: 'Keep the logs 30 days.\n' },
    { file: 'log/INDEX.md', kind: 'replace', line: 1, words: 'trial', with: 'the trial', struck: 'trial' }] });
  assert.deepEqual(le.sources.flatMap((x) => x.gaps.map((g) => g.item)), ['lineEdit:log/topic.md#L4']);
  assert.deepEqual(s.gaps.filter((g) => g.item === 'fact:gate' || g.item === 'fact:copy').map((g) => g.missing), [['--each']]);
  assert.ok(s.gaps.some((g) => g.item === 'fact:cut'), 'a cut item is a gap');
  assert.deepEqual(s.drops.map((d) => d.item), ['fact:dropped', 'fact:held', 'fact:old'], 'a cut its source marks superseded is backed');
  assert.equal(s.blocked, true);
  assert.deepEqual(cov.claude[0].gaps.map((g) => g.line), [2], 'a dropped clause needs its reason');
  assert.deepEqual(cov.sources.find((x) => x.file === 'CLAUDE.md').gaps, [], 'the rule and the kept words cover the split clause, a body\'s record the clause beside it');
  assert.deepEqual(clausesOf('## 3. Hard stops\n\nStop. Ask.'), ['3. Hard stops', 'Stop.', 'Ask.'], 'a heading keeps its number with its words');
  assert.ok(covers('K-3 holds the hard stops.', '3. Hard stops').length, 'a record id does not stand for the number it carries');
  /* a private value the record left out is no gap; a changed value beside it still is */
  assert.deepEqual(covers('Sign in as `[address left out]` (port 5050) on `[host left out]`.', 'Sign in as `a1@example.test` (port 5050) on `box-7`.'), []);
  assert.deepEqual(covers('Sign in as `[address left out]` (port 5050).', 'Sign in as `a1@example.test` (port 5051).'), ['5051']);
  assert.ok(covers('Ask [team left out] first.', 'Ask the desk at `ops-desk` on port 5050 first.').length, 'a marker stands for one value, never a phrase');

  /* a stale rule cut with evidence that holds is backed; a clause that became a rule and a fact is read against
     both; a card keeps its step with no command; a line of a rule file that goes no item names is a gap */
  const db = '.claude/rules/db.md';
  const ruleText = '---\npaths: ["src/db/**"]\n---\n\n# Database\n\n- Lint the schema with tools/old-lint.mjs before a commit.\n'
    + '- Never call the payments API from the worker; it runs at most 2 jobs.\n- Back up first: run `npm run backup`.\n- Tell the team when the backup is done.\n- Never drop the ledger table.\n';
  const card = { id: 'card:backup', kind: 'card', title: 'Back up', target: 'docs/procedures/back-up.md', source: { file: db, line: 9, end: 10 },
    fields: { steps: [{ text: 'Back up first', run: 'npm run backup' }, { text: 'Tell the team when the backup is done' }] } };
  const ruleItems = [{ id: 'rule:lint', kind: 'rule', title: 'Lint', cut: true, source: { file: db, line: 7 } },
    { id: 'rule:pay', kind: 'rule', text: 'Never call the payments API from the worker.', source: { file: db, line: 8 } },
    { id: 'fact:pay', kind: 'knowledge', text: 'The worker runs at most 2 jobs.', source: { file: db, line: 8 } }, card];
  const written = (cardRecord, evidence = { gone: ['tools/old-lint.mjs'] }, records = null, shape = 'stale') => coverage(ruleItems, { manifest: { imports: [{ steps: [{ row: 'rule:pay', id: 'proj/no-pay' }, { row: 'fact:pay', id: 'K-5' }] }] },
    readFile: (f) => (f === db ? ruleText : null), whole: [db], exists: (p) => p !== 'tools/old-lint.mjs', records,
    judged: [{ key: 'item:rule:lint', kind: 'item', fate: 'drop', shape, why: 'its tool left', evidence }],
    readRecord: (r) => (r.kind === 'card' ? cardRecord : r.text) }).sources[0];
  const made = cardText(cardRow(card, card.target)).text;
  const rf = written(made);
  assert.deepEqual([rf.gaps.map((g) => g.item), rf.drops.map((d) => d.item), rf.covered], [['line 11'], ['rule:lint'], 3]);
  assert.deepEqual(written(made.replace(/.*Tell the team.*\n/g, '')).gaps.filter((g) => /step 2/.test(g.why)).map((g) => g.item), ['card:backup'], 'coverage reads the card as written');

  /* a cut's own file, or the folder holding it, is no evidence; a board record named holds by its status */
  const cut = (evidence, shape) => written(made, evidenceOf(evidence), boardRecords({ openTasks: [{ id: 'T-7', status: 'open' }], closedTasks: [{ id: 'T-6', key: 'abcdefgh', status: 'done' }] }), shape);
  assert.ok(cut({ cites: [db, '.claude/rules'] }).gaps.some((g) => g.item === 'rule:lint' && /own file/.test(g.why)), 'evidence naming only its own file backs nothing');
  assert.ok(cut({ cites: [db] }, 'history').drops.some((d) => d.item === 'rule:lint'), 'a history cut is judged by its own text, so its own file backs it');
  assert.deepEqual(['T-6@abcdefgh', 'T-7'].map((id) => cut({ cites: [db], records: [id] }).drops.some((d) => d.item === 'rule:lint')), [true, false], 'a closed task backs the cut, an open one does not');
});

test('the instruction file is rewritten from its ledger: a carried clause and its rules heading go, the title stays, a table is one clause, and a loader or import stays while a gap holds what it loads', () => {
  assert.match(claudeText('# Proj\n\n- Keep commits small.\n', { path: 'CLAUDE.md', clauses: [{ text: 'Keep commits small.', line: 3, end: 3, fate: 'carried' }] }, {}), /^# Proj\n\n## AskerDo/);
  /* a table is one clause of the ledger, so a menu of rule folders leaves with its dropped clause */
  const menu = '# Proj\n\nRules by folder:\n\n| Dir | Covers |\n|-|-|\n| `rules/a/` | A |\n\nBuild with npm.\n';
  const row = claudeLedger({ texts: new Map([['CLAUDE.md', menu]]), opened: [] }).find((c) => c.line === 5);
  assert.ok(row && /rules\/a/.test(row.clause), 'the table is a clause');
  const left = claudeText(menu, { path: 'CLAUDE.md', clauses: [{ text: row.clause, line: 5, fate: 'dropped' }] }, null);
  assert.ok(!left.includes('rules/a') && left.includes('Build with npm.'), 'a dropped table goes, the paragraph after it stays');
  const split = claudeText(menu, { path: 'CLAUDE.md', clauses: [{ text: row.clause, line: 5, fate: 'split', item: 'rule:a', kept: '| Dir | Covers |\n|-|-|\n| `rules/b/` | B |' }] }, null);
  assert.ok(split.includes('|-|-|\n| `rules/b/` | B |\n') && !split.includes('rules/a'), 'a split table keeps its rows');
  /* a loader stays while a coverage gap holds what it loads, so the held rules still reach a session */
  const gates = (blocked) => gatesOf({ folders: [{ path: 'rules/', end: 'delete' }, { path: '.claude/hooks/load.mjs', end: 'retire' }], loaders: { 'rules/a.md': ['.claude/hooks/load.mjs'] } },
    { sources: [{ file: 'rules/a.md', blocked, gaps: [{}] }] }, { tracked: new Set(['rules/a.md', '.claude/hooks/load.mjs']), untracked: [], changed: new Set(), runs: [] });
  assert.deepEqual([gates(false)[1].go, gates(true)[1].go, /rules\/a\.md/.test(gates(true)[1].why)], [true, false, true]);
  /* so does an instruction file's import of them, dropped once the gap is gone */
  const imports = { path: 'CLAUDE.md', clauses: [{ text: '@rules/a.md', line: 3, end: 3, fate: 'dropped', why: 'a loader', loads: ['rules/a.md'] }] };
  const rewritten = (blocked) => claudeText('# Proj\n\n@rules/a.md\n', keptBack(imports, gates(blocked)).ledger, null);
  assert.deepEqual([rewritten(true).includes('@rules/a.md'), rewritten(false).includes('@rules/a.md')], [true, false]);
});

test('the handover lands in one commit holding every edit, keeps the folders it must not delete, puts everything back when the commit is refused, and one git revert takes it back', async (t) => {
  const p = fixture(t);
  /* a working copy checked out CRLF under core.autocrlf=true is clean, so the rewrite lands on it; a later
     mtime makes git read the content, as a fresh clone's racy index does */
  p.git(['config', 'core.autocrlf', 'true']);
  rmSync(join(p.dir, 'CLAUDE.md'));
  execFileSync('git', ['checkout', '--', 'CLAUDE.md'], { cwd: p.dir });
  const later = new Date(Date.now() + 60000);
  utimesSync(join(p.dir, 'CLAUDE.md'), later, later);
  const card = { id: 'card:check', kind: 'card', title: 'Check', source: { file: '.claude/skills/check/SKILL.md', line: 6 }, fields: { steps: [{ text: 'Read the last run' }] } };
  /* docs/style.md: a file the facts know a session loads (a CLAUDE.md import, say) */
  p.put('plan.json', { made: 'p1', project: { dir: p.dir }, label: 'import:proj', steps: [], items: [card, { id: 'rule:small', kind: 'rule', source: { file: 'CLAUDE.md', line: 7 } }], sessionReads: ['docs/style.md'],
    cards: [{ item: 'card:check', target: 'docs/procedures/check.md' }],
    folders: [
      { path: 'runs/', end: 'delete', why: 'run logs' },
      { path: 'DECISIONS.md', end: 'delete', why: 'a decision log, converted' },
      { path: 'scratch/', end: 'delete', why: 'notes' },
      { path: 'tools/data/', end: 'delete', why: 'fixtures', evidence: { codeReaders: ['tools/read.mjs'] } },
      /* the loader retires in the run its folder goes, so it never holds that folder */
      { path: 'rules/', end: 'delete', why: 'rule bodies, converted', evidence: { codeReaders: { files: 1, from: ['.claude/hooks/load.mjs:1'] } } },
      { path: '.claude/hooks/load.mjs', end: 'retire', why: 'it loads rules/' },
      /* a Codex skill kept as a pointer at its card */
      { path: '.agents/skills/build/', end: 'point', to: 'docs/procedures/build.md', description: 'Use when building or shipping.', why: 'its steps are the build card' },
      { path: 'plans/old/', end: 'delete', why: 'finished plans' },
    ],
    claude: [{ path: 'CLAUDE.md', clauses: [{ text: 'Build with `npm run build`.', line: 3, end: 3, fate: 'kept' }, { text: 'Keep commits small.', line: 7, end: 7, item: 'rule:small', fate: 'carried', by: 'keep-commits-small' }] }] });
  p.manifest([{ step: 'workstream', row: null, op: 'ws create', kind: 'workstream', id: 'WS-9' }, { step: 'track:a', row: 'track:a', op: 'track new', kind: 'track', id: 'TR-5' },
    { step: 'rule:small', row: 'rule:small', op: 'profile rule-add', kind: 'rule line', id: 'proj/keep-commits-small' }]);
  p.clean();
  mkdirSync(join(p.dir, 'scratch', 'deep'));
  writeFileSync(join(p.dir, 'scratch', 'deep', 'more.md'), 'Nor this.\n');

  /* a refused commit puts every edit back, the card it wrote and the settings entry it took out included */
  const hook = join(p.dir, '.git', 'hooks', 'pre-commit');
  writeFileSync(hook, '#!/bin/sh\necho refused by the hook >&2\nexit 1\n');
  chmodSync(hook, 0o755);
  const no = await handover(p.work, { cli: CLI, log: () => {} });
  assert.match(no.stopped.why, /refused by the hook/);
  /* read with the repo's own line-ending settings, which the put-back checks out under */
  const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: p.dir, encoding: 'utf8' });
  assert.deepEqual([p.git(['rev-parse', 'HEAD']).trim(), status, existsSync(join(p.dir, 'docs/procedures/check.md'))], [BASE, '', false], 'nothing lands and the tree is as it was');
  rmSync(hook);

  const h = await handover(p.work, { cli: CLI, log: () => {} });
  assert.equal(p.git(['rev-parse', 'HEAD~1']).trim(), BASE, 'one commit');
  assert.deepEqual(changedIn(p.git, h.commit), ['.agents/skills/build/SKILL.md', '.agents/skills/build/notes.md', '.claude/hooks/load.mjs', '.claude/settings.json', '.claude/skills/check/SKILL.md', '.gitignore',
    'CLAUDE.md', 'DECISIONS.md', 'docs/procedures/check.md', 'docs/style.md', 'plans/old/a.md', 'rules/a.md', 'runs/2026-01/run-0.md', 'runs/2026-01/run-1.md']);
  const settings = readFileSync(join(p.dir, '.claude/settings.json'), 'utf8');
  assert.ok(!settings.includes('load.mjs') && settings.includes('tools/fmt.mjs') && readFileSync(join(p.dir, '.gitignore'), 'utf8') === '*.log\n!keep.log\nAGENTS.override*.md\n', 'the loader leaves with its hook entry, the folder with its un-ignore line');
  const skill = readFileSync(join(p.dir, '.agents/skills/build/SKILL.md'), 'utf8');
  assert.ok(/name: build\r?\ndescription: "Use when building or shipping\."/.test(skill) && skill.includes('docs/procedures/build.md') && !skill.includes('npm run build'), skill);
  assert.deepEqual(h.held.map((x) => [x.path, /untracked|tools\/read\.mjs/.test(x.why)]).sort(), [['scratch', true], ['tools/data', true]], 'git has no copy of one, code reads the other: both stay, named');
  /* the kept folder keeps every file, and a handoff after the run keeps them too, a delete given for them included */
  assert.equal(p.git(['status', '--porcelain', '--untracked-files=all', '--', 'scratch']).trim().split('\n').length, 2);
  const loose = settleFiles({ path: p.dir, snapshot: { untracked: ['scratch/'] } }, [{ path: 'scratch', disposition: 'delete' }], readKept(dataDir(), p.dir), '2026-01-01', Date.now());
  assert.deepEqual([loose.files.map((f) => [f.path, f.disposition]), loose.held], [[['scratch/', 'keep']], ['scratch/']]);
  assert.match(loose.files[0].reason, /conversion keeps scratch: .*untracked/);
  /* a PC whose list predates the conversion's keeps takes them from the project's map at its next handoff */
  rmSync(keptPath(dataDir(), p.dir));
  const pc = await import('../lib/tracks-session.mjs');
  const asked = pc.validateHandoffPayload({ focus: 'f', state: 's', verifyFirst: [{ path: p.dir, files: [{ path: 'scratch', disposition: 'delete' }] }] }).verifyFirst;
  const v = await pc.runVerifyFirst(asked, { dir: dataDir(), call: boardCall });
  assert.deepEqual([v.entries[0].files.filter((f) => f.path === 'scratch/').map((f) => f.disposition), v.due.length], [['keep'], 0]);
  assert.match(v.keptLine, /scratch/);
  /* a skill a session reads is repointed to git; a document keeps its cite as written */
  assert.match(readFileSync(join(p.dir, '.claude/skills/check/SKILL.md'), 'utf8'), new RegExp('runs/2026-01/run-1\\.md \\(in git at ' + BASE.slice(0, 10) + '\\)'));
  assert.equal(readFileSync(join(p.dir, 'docs/notes.md'), 'utf8'), 'The last run is in runs/2026-01/run-1.md.\n');
  const md = readFileSync(join(p.dir, 'CLAUDE.md'), 'utf8');
  assert.ok(md.includes('\r\n') && md.includes('Build with `npm run build`.') && !md.includes('Keep commits small') && !/^## Rules/m.test(md), 'kept clause stays, carried one and its heading go');
  assert.match(md, /## AskerDo[\s\S]*WS-9[\s\S]*TR-5[\s\S]*`proj`/);
  assert.match(readFileSync(join(p.work, 'report.md'), 'utf8'), new RegExp('git revert ' + h.commit));
  const said = [];
  await undoImport(p.work, { log: (s) => said.push(s) });
  assert.match(said.join('\n'), new RegExp('git revert ' + h.commit));
  /* with the repo's own core.autocrlf=true, as the user runs it: forced false, a racily clean CRLF file reads as changed */
  execFileSync('git', ['revert', '--no-edit', h.commit], { cwd: p.dir, stdio: 'pipe' });
  assert.equal(spawnSync('git', ['diff', '--quiet', BASE, 'HEAD'], { cwd: p.dir }).status, 0, 'one revert gives back the tree as it was');
});

test('a coverage gap holds back the delete of its folder and the line edits of its file; the rest lands', async (t) => {
  const p = fixture(t);
  const lineEdits = [{ file: 'docs/notes.md', kind: 'strike', line: 1, words: ' in runs/2026-01/run-1.md', why: 'w', struck: ' in runs/2026-01/run-1.md' }];
  p.put('plan.json', { made: 'p1', project: { dir: p.dir }, label: 'import:proj', steps: [], items: [], lineEdits,
    folders: [{ path: 'runs/', end: 'delete', why: 'run logs' }, { path: 'plans/old/', end: 'delete', why: 'finished plans' }, { path: 'docs/', end: 'keep', why: 'docs', lineEdits }] });
  p.manifest();
  const gap = (file, item) => ({ file, blocked: true, gaps: [{ item, why: 'w' }] });
  p.put('coverage.json', { made: new Date().toISOString(), sources: [gap('runs/2026-01/run-0.md', 'line 1'), gap('docs/notes.md', 'lineEdit:docs/notes.md#L1')], claude: [] });
  const h = await handover(p.work, { cli: CLI, log: () => {} });
  assert.deepEqual([h.held.map((x) => x.path), h.skipped.map((x) => x.path), changedIn(p.git, h.commit)], [['runs'], ['docs/notes.md'], ['plans/old/a.md']]);
  assert.match(h.held[0].why, /coverage gaps/);
});

/* the section goes into the instruction file the plan names; a split clause keeps its words;
   Codex's override is written from the rewritten file and the board's rules, and the undo writes it again */
test('the section goes into AGENTS.md, a split clause keeps its words, and the Codex override follows the rewrite and the undo', async (t) => {
  const p = fixture(t);
  const SPLIT = 'The Viewer never runs node logic and hosts WebSockets on port 5000.';
  p.put('plan.json', { made: 'p1', project: { dir: p.dir }, label: 'import:proj', steps: [], items: [], folders: [], section: 'AGENTS.md',
    claude: [{ path: 'AGENTS.md', clauses: [{ text: SPLIT, line: 3, end: 3, fate: 'split', kept: 'The Viewer hosts WebSockets on port 5000.', item: 'rule:node', by: 'no-node-logic' },
      { text: 'Keep commits small.', line: 4, end: 4, fate: 'carried', item: 'rule:small', by: 'keep-commits-small' }] }] });
  p.manifest([{ step: 'rule:node', row: 'rule:node', op: 'profile rule-add', kind: 'rule line', id: 'proj/no-node-logic' }]);
  p.clean();
  const ag = await handover(p.work, { cli: CLI, log: () => {} });
  const agents = readFileSync(join(p.dir, 'AGENTS.md'), 'utf8');
  assert.ok(agents.includes('- The Viewer hosts WebSockets on port 5000.\n') && !agents.includes('node logic') && !agents.includes('Keep commits'), agents);
  assert.match(agents, /\n## AskerDo\n[\s\S]*`proj`/);
  assert.equal(ag.override.did, 'wrote', JSON.stringify(ag.override));
  const codex = readFileSync(join(p.dir, 'AGENTS.override.md'), 'utf8');
  assert.ok(codex.includes('port 5000') && !codex.includes('## AskerDo\n') && codex.includes('Rules in force'), codex);
  /* the undo writes it from AGENTS.md as the printed revert brings it back: git ignores it, so no revert touches it */
  const m = JSON.parse(readFileSync(join(p.work, 'manifest.json'), 'utf8'));
  writeFileSync(join(p.work, 'manifest.json'), JSON.stringify({ ...m, project: { dir: p.dir } }));
  /* a group undo prints no revert, so the override keeps AGENTS.md as converted */
  const plan = JSON.parse(readFileSync(join(p.work, 'plan.json'), 'utf8'));
  p.put('plan.json', { ...plan, items: [{ id: 'rule:node', kind: 'rule', dropped: 'g' }] });
  await undoImport(p.work, { board: 'live', cli: CLI, session: 's1', group: 'g', log: () => {} });
  assert.ok(!readFileSync(join(p.dir, 'AGENTS.override.md'), 'utf8').includes('Keep commits small'), 'a group undo keeps the converted AGENTS.md');
  await undoImport(p.work, { board: 'live', cli: CLI, session: 's1', log: () => {} });
  assert.ok(readFileSync(join(p.dir, 'AGENTS.override.md'), 'utf8').includes('Keep commits small'));
});

test('a fixture project rehearses (the undo runs with its one press and takes back what the write made), then the go hands over in one commit', async (t) => {
  const p = fixture(t);
  const label = 'import:fx';
  const steps = [
    { id: 'ws', item: 'ws', op: 'ws create', args: ['ws', 'create'], stdin: { name: 'Fixture', description: 'fixture', projects: [p.dir], labels: [label], refs: ['onboard:workstream'] } },
    { id: 'task:x', item: 'task:x', op: 'task create', args: ['task', 'create'], stdin: { unplaced: 'imported', wake: '@{wake}', name: 'Switch', description: 'd', workstream: '@{ws}', labels: [label], refs: ['onboard:task:x'] } },
    { id: 'decision:a', item: 'decision:a', op: 'decide', args: ['decide'], stdin: { title: 'Rows first', body: 'b', projects: [p.dir], labels: [label], workstreams: ['@{ws}'], refs: ['onboard:decision:a'] } },
    { id: 'knowledge:a', item: 'knowledge:a', op: 'knowledge new', args: ['knowledge', 'new', '--type', 'gotcha', '--title', 'A fact', '--project', p.dir, '--label', label, '--ref', 'onboard:knowledge:a'], body: 'A fact.' },
  ];
  /* the history pointer as the plan writes it for what leaves */
  const folders = [{ path: 'DECISIONS.md', end: 'delete', why: 'a decision log, converted' }];
  const hist = buildPlan(withFacts({ items: [], folders, claude: [], calls: [] }, { project: { dir: p.dir, slug: 'fx', head: BASE } }), { readVersion: () => '', readFile: () => '' });
  steps.push(hist.steps.find((s) => s.id === 'history:fx'));
  p.put('plan.json', { made: '2026-11-18T00:00:00Z', go: { session: 's1' }, project: { dir: p.dir }, label, steps: steps.map((s, i) => ({ ...s, n: i + 1 })), pending: [], left: [],
    items: [{ id: 'decision:a', kind: 'decision', source: { file: 'DECISIONS.md', line: 1 } }, hist.items.find((x) => x.id === 'history:fx')], folders, answers: [] });
  const scratch = 'file:' + join(p.base, 'scratch.db').replace(/\\/g, '/');
  const r = await rehearse(p.work, { board: scratch, cli: CLI, log: () => {} });
  assert.deepEqual([r.refusals, r.written, r.undone, r.left], [[], 5, 5, []], 'the undo took back every record the write made, the history pointer with them');
  const env = { ...process.env, ASKERDO_BOARD_URL: scratch };
  const made = JSON.parse(readFileSync(join(p.work, 'rehearsal', 'scratch.db-manifest.json'), 'utf8')).imports[0].steps;
  assert.match(made.find((s) => s.row === 'history:fx').id, /^K-\d+$/);
  assert.deepEqual((await Promise.all(made.map((s) => cliRunner(CLI)(['show', s.id], { env })))).map((x) => x.ok), [false, false, false, false, false], 'purged from the scratch board');
  assert.match(readFileSync(join(p.work, 'rehearsal.md'), 'utf8'), /took back 5 of the 5 records/);
  /* the go: the live write, coverage, the handover in one commit */
  assert.deepEqual((await applyPlan(p.work, { board: 'live', cli: CLI, log: () => {} })).refusals, []);
  await runCoverage(p.work, { cli: CLI, log: () => {} });
  const h = await handover(p.work, { cli: CLI, log: () => {} });
  assert.deepEqual([p.git(['rev-parse', 'HEAD~1']).trim(), changedIn(p.git, h.commit)], [BASE, ['DECISIONS.md']]);
  /* a later run amends the pointer with the folder it retires, and the undo in place leaves the pointer as it was */
  const k = JSON.parse(readFileSync(join(p.work, 'manifest.json'), 'utf8')).imports[0].steps.find((s) => s.row === 'history:fx').id;
  const live = { ...process.env, CLAUDE_CODE_SESSION_ID: '' };
  const look = async () => { const r = (await cliRunner(CLI)(['show', k], { env: live })).out; return { body: r.sections.Body, files: r.files, amended: r.amended }; };
  const was = await look();
  const more = [...folders, { path: 'plans/old', end: 'delete', why: 'finished plans' }];
  const held = { project: { dir: p.dir, slug: 'fx', head: BASE }, board: { imported: [{ id: k, refs: ['onboard:history:fx'] }], knowledge: [{ id: k, files: was.files }] } };
  const again = buildPlan(withFacts({ items: [], folders: more, claude: [], calls: [] }, held), { readVersion: () => '', readFile: () => '' });
  p.put('plan.json', { made: '2026-11-18T01:00:00Z', go: { session: 's1' }, project: { dir: p.dir }, label, steps: again.steps, pending: [], left: [], items: again.items, folders: more, answers: [] });
  assert.deepEqual((await applyPlan(p.work, { board: 'live', cli: CLI, log: () => {} })).refusals, []);
  const amended = await look();
  assert.ok(amended.amended && amended.files.includes('(read) plans/old/**') && /`plans\/old`: finished plans/.test(amended.body), amended.body);
  await undoImport(p.work, { board: 'live', cli: CLI, session: 's1', log: () => {} });
  assert.deepEqual(await look(), was, 'the text, triggers and stamp read as before the amend');
});
