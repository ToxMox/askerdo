/* the handover after the live write. A converted source is gated by clause
 * coverage, a history folder by its evidence; a folder that passes leaves in one commit of its own, and what
 * cites it from a file that stays is repointed to its record or to git. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { clausesOf, coverage, covers } from '../skills/onboard/coverage.mjs';
import { cardRow, cardText } from '../skills/onboard/cards.mjs';
import { applyPlan, claudeText, cliRunner, gatesOf, handover, keptBack, rehearseHandover, repoint, undoImport } from '../skills/onboard/apply.mjs';
import { buildPlan, undoWaits } from '../skills/onboard/plan.mjs';
import { claudeLedger } from '../skills/onboard/survey.mjs';
import { tempDir } from './helpers/sandbox.mjs';

function project(t) {
  const base = tempDir('onboard-handover-', t);
  const dir = join(base, 'proj');
  mkdirSync(dir);
  const git = (args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'core.autocrlf=false', ...args], {
    cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_DATE: '2026-01-01T12:00:00Z', GIT_COMMITTER_DATE: '2026-01-01T12:00:00Z' },
  });
  git(['init', '-q', '-b', 'main']);
  /* the handover commits with the repo's own identity */
  git(['config', 'user.name', 't']); git(['config', 'user.email', 't@example.invalid']);
  const write = (files) => { for (const [f, text] of Object.entries(files)) { mkdirSync(join(dir, f, '..'), { recursive: true }); writeFileSync(join(dir, f), text); } };
  const commit = (files, msg = 'work') => {
    write(files);
    git(['add', '--', ...Object.keys(files)]);
    git(['commit', '-q', '-m', msg]);
    return git(['rev-parse', 'HEAD']).trim();
  };
  const work = join(base, 'work');
  mkdirSync(work);
  const put = (f, v) => writeFileSync(join(work, f), JSON.stringify(v));
  const manifest = (steps = []) => put('manifest.json', { label: 'import:proj', imports: [{ plan: 'p1', at: '2026-01-01T00:00:00Z', done: '2026-01-01T00:01:00Z', steps }], left: [] });
  return { base, dir, git, write, commit, work, put, manifest };
}

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
  assert.deepEqual(s.gaps.filter((g) => g.item === 'fact:gate' || g.item === 'fact:copy').map((g) => g.missing), [['--each']]);
  assert.ok(s.gaps.some((g) => g.item === 'fact:cut'), 'a cut item is a gap');
  assert.deepEqual(s.drops.map((d) => d.item), ['fact:dropped', 'fact:held', 'fact:old'], 'a cut its source marks superseded is backed');
  assert.equal(s.blocked, true);
  assert.deepEqual(cov.claude[0].gaps.map((g) => g.line), [2], 'a dropped clause needs its reason');
  assert.deepEqual(cov.sources.find((x) => x.file === 'CLAUDE.md').gaps, [], 'the rule and the kept words cover the split clause, a body\'s record the clause beside it');
  assert.deepEqual(clausesOf('## 3. Hard stops\n\nStop. Ask.'), ['3. Hard stops', 'Stop.', 'Ask.'], 'a heading keeps its number with its words');
  assert.ok(covers('K-3 holds the hard stops.', '3. Hard stops').length, 'a record id does not stand for the number it carries');

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
  const written = (cardRecord) => coverage(ruleItems, { manifest: { imports: [{ steps: [{ row: 'rule:pay', id: 'proj/no-pay' }, { row: 'fact:pay', id: 'K-5' }] }] },
    readFile: (f) => (f === db ? ruleText : null), whole: [db], exists: (p) => p !== 'tools/old-lint.mjs',
    judged: [{ key: 'item:rule:lint', kind: 'item', fate: 'drop', shape: 'stale', why: 'its tool left', evidence: { gone: ['tools/old-lint.mjs'] } }],
    readRecord: (r) => (r.kind === 'card' ? cardRecord : r.text) }).sources[0];
  const made = cardText(cardRow(card, card.target)).text;
  const rf = written(made);
  assert.deepEqual([rf.gaps.map((g) => g.item), rf.drops.map((d) => d.item), rf.covered], [['line 11'], ['rule:lint'], 3]);
  assert.deepEqual(written(made.replace(/.*Tell the team.*\n/g, '')).gaps.filter((g) => /step 2/.test(g.why)).map((g) => g.item), ['card:backup'], 'coverage reads the card as written');
});

test('the handover deletes each folder that passes its gate in one commit, keeps an untracked and a code-read folder, retires a loader with the folder it alone reads, and repoints a cite to git', async (t) => {
  const p = project(t);
  const runs = Object.fromEntries(Array.from({ length: 12 }, (_, i) => ['runs/2026-01/run-' + i + '.md', 'Run ' + i + '.\n']));
  p.commit({ ...runs, 'tools/data/a.json': '{}\n', 'tools/read.mjs': "readFileSync('tools/data/a.json');\n", 'docs/notes.md': 'The last run is in runs/2026-01/run-11.md.\n',
    'CLAUDE.md': '# Proj\n\nBuild with `npm run build`.\n\n## Rules\n\n- Keep commits small.\n', 'DECISIONS.md': '# Decisions\n',
    '.claude/settings.json': JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'node .claude/hooks/load.mjs' }] }],
      PostToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'node tools/fmt.mjs' }] }] } }, null, 2) + '\n',
    '.claude/hooks/load.mjs': "process.stdout.write(readFileSync('rules/a.md', 'utf8'));\n", 'rules/a.md': 'Test first.\n', 'tools/fmt.mjs': '// formats\n', '.gitignore': '*.log\n!/rules/\n!keep.log\n' });
  p.write({ 'scratch/loose.md': 'Not in git.\n' });
  /* a working copy checked out CRLF under core.autocrlf=true is clean, so the rewrite lands on it;
     a later mtime makes git read the content, as a fresh clone's racy index does */
  p.git(['config', 'core.autocrlf', 'true']);
  rmSync(join(p.dir, 'CLAUDE.md'));
  execFileSync('git', ['checkout', '--', 'CLAUDE.md'], { cwd: p.dir });
  const later = new Date(Date.now() + 60000);
  utimesSync(join(p.dir, 'CLAUDE.md'), later, later);
  p.put('plan.json', { project: { dir: p.dir }, label: 'import:proj', steps: [{ op: 'decide', args: ['decide'], stdin: { workstreams: ['WS-4'] } }], cards: [], items: [{ id: 'rule:small', kind: 'rule', source: { file: 'CLAUDE.md', line: 7 } }],
    folders: [
      { path: 'runs/', end: 'delete', why: 'run logs', evidence: { codeReaders: [], liveCites: ['docs/notes.md:1'], openItems: 1 } },
      { path: 'DECISIONS.md', end: 'delete', why: 'a decision log, converted', evidence: {} },
      { path: 'scratch/', end: 'delete', why: 'notes', evidence: {} },
      { path: 'tools/data/', end: 'delete', why: 'fixtures', evidence: { codeReaders: ['tools/read.mjs'] } },
      /* the loader retires in the run its folder goes, so it never holds that folder */
      { path: 'rules/', end: 'delete', why: 'rule bodies, converted', evidence: { codeReaders: { files: 1, from: ['.claude/hooks/load.mjs:1'] } } },
      { path: '.claude/hooks/load.mjs', end: 'retire', why: 'it loads rules/', evidence: {} },
    ],
    claude: [{ path: 'CLAUDE.md', clauses: [{ text: 'Build with `npm run build`.', line: 3, end: 3, fate: 'kept' }, { text: 'Keep commits small.', line: 7, end: 7, item: 'rule:small', fate: 'carried', by: 'keep-commits-small' }] }] });
  p.manifest([{ step: 'workstream', row: null, op: 'ws create', kind: 'workstream', id: 'WS-9' }, { step: 'track:a', row: 'track:a', op: 'track new', kind: 'track', id: 'TR-5' },
    { step: 'rule:small', row: 'rule:small', op: 'profile rule-add', kind: 'rule line', id: 'proj/keep-commits-small' }]);
  p.put('coverage.json', { made: new Date().toISOString(), sources: [], claude: [{ path: 'CLAUDE.md', clauses: 2, gaps: [], blocked: false }] });

  /* a refused commit puts its folder back as it was and stops, with nothing in the manifest */
  const hook = join(p.dir, '.git', 'hooks', 'pre-commit');
  writeFileSync(hook, '#!/bin/sh\ngit diff --cached --diff-filter=D --quiet || { echo refused by the hook >&2; exit 1; }\n');
  chmodSync(hook, 0o755);
  /* the rehearsal's handover on a copy of the working tree; the real repo is untouched */
  mkdirSync(join(p.work, 'rehearsal'));
  for (const f of ['manifest', 'coverage']) writeFileSync(join(p.work, 'rehearsal', 'scratch.db-' + f + '.json'), readFileSync(join(p.work, f + '.json')));
  /* the scratch board's own workstream took WS-4, the real id the plan names, whose stand-in is WS-1: the copy names both */
  const sm = join(p.work, 'rehearsal', 'scratch.db-manifest.json');
  writeFileSync(sm, readFileSync(sm, 'utf8').replace('"WS-9"', '"WS-4"'));
  writeFileSync(join(p.work, 'rehearsal', 'scratch.db-results.json'), JSON.stringify({ 'stand-ins': { map: { 'WS-4': 'WS-1' } } }));
  const home = process.env.ASKERDO_SANDBOX_HOME;
  process.env.ASKERDO_SANDBOX_HOME = join(p.base, 'home');
  const head = p.git(['rev-parse', 'HEAD']);
  const cp = await rehearseHandover(p.work, { board: 'file:' + join(p.base, 'scratch.db'), log: () => {} });
  if (home === undefined) delete process.env.ASKERDO_SANDBOX_HOME; else process.env.ASKERDO_SANDBOX_HOME = home;
  assert.ok(!existsSync(join(cp.dir, 'rules')) && !existsSync(join(cp.dir, '.claude/hooks/load.mjs')) && existsSync(join(cp.dir, 'scratch/loose.md')), 'the copy holds the handed-over tree, untracked files too');
  assert.deepEqual(cp.loads.runs.map((x) => x.command), ['node tools/fmt.mjs'], 'what a session there runs: the formatter, not the loader');
  assert.ok(existsSync(join(p.dir, 'rules/a.md')) && p.git(['rev-parse', 'HEAD']) === head && existsSync(cp.reader));
  const no = await handover(p.work, { log: () => {} });
  assert.match(no.stopped.why, /refused by the hook/);
  /* read with the repo's own line-ending settings, which the put-back checks out under */
  const status = execFileSync('git', ['status', '--porcelain', '--', 'runs'], { cwd: p.dir, encoding: 'utf8' });
  assert.ok(existsSync(join(p.dir, 'runs/2026-01/run-0.md')) && status === '', 'the refused folder is put back');
  assert.match(readFileSync(join(p.dir, '.claude/settings.json'), 'utf8'), /load\.mjs/, 'the unhook goes back with its refused commit');
  /* the real tree unlike the copy the fresh reader read, so it reads again */
  assert.ok(no.diff.rerun && no.diff.here.includes('runs/ (12 files)'), JSON.stringify(no.diff));
  rmSync(hook);

  const h = await handover(p.work, { log: () => {} });
  assert.ok(!existsSync(join(p.dir, 'runs')), 'the history folder is gone');
  const subject = (c) => p.git(['show', '-s', '--format=%s', c.commit]);
  const dels = h.commits.filter((c) => c.batch === 'deletes');
  const del = dels.find((c) => /: runs\//.test(subject(c)));
  const retire = dels.find((c) => /retires/.test(subject(c)));
  assert.deepEqual(p.git(['show', '--name-only', '--format=', retire.commit]).trim().split('\n').sort(), ['.claude/hooks/load.mjs', '.claude/settings.json'], 'the loader leaves with its hook entry');
  const settings = readFileSync(join(p.dir, '.claude/settings.json'), 'utf8');
  assert.ok(!existsSync(join(p.dir, 'rules')) && !settings.includes('load.mjs') && settings.includes('tools/fmt.mjs'), 'the folder its loader alone read goes too');
  /* its un-ignore line leaves in its commit */
  const gone = dels.find((c) => /: rules\//.test(subject(c)));
  assert.ok(p.git(['show', '--name-only', '--format=', gone.commit]).includes('.gitignore') && readFileSync(join(p.dir, '.gitignore'), 'utf8') === '*.log\n!keep.log\n');
  /* a loader stays while a coverage gap holds what it loads, so the held rules still reach a session */
  const gates = (blocked) => gatesOf({ folders: [{ path: 'rules/', end: 'delete' }, { path: '.claude/hooks/load.mjs', end: 'retire' }], loaders: { 'rules/a.md': ['.claude/hooks/load.mjs'] } },
    { sources: [{ file: 'rules/a.md', blocked, gaps: [{}] }] }, { tracked: new Set(['rules/a.md', '.claude/hooks/load.mjs']), untracked: [], changed: new Set(), runs: [] });
  const gate = (blocked) => gates(blocked)[1];
  assert.deepEqual([gate(false).go, gate(true).go, /rules\/a\.md/.test(gate(true).why)], [true, false, true]);
  /* so does an instruction file's import of them, dropped once the gap is gone */
  const imports = { path: 'CLAUDE.md', clauses: [{ text: '@rules/a.md', line: 3, end: 3, fate: 'dropped', why: 'a loader', loads: ['rules/a.md'] }] };
  const rewritten = (blocked) => claudeText('# Proj\n\n@rules/a.md\n', keptBack(imports, gates(blocked)).ledger, null);
  assert.deepEqual([rewritten(true).includes('@rules/a.md'), rewritten(false).includes('@rules/a.md')], [true, false]);
  assert.equal(h.diff.rerun, false, JSON.stringify(h.diff));
  assert.ok(dels.some((c) => /DECISIONS\.md goes/.test(subject(c))) && /runs\/ goes/.test(subject(del)), 'a file unit is named as a file, a folder as a folder');
  assert.deepEqual([...new Set(p.git(['show', '--name-only', '--format=', del.commit]).trim().split('\n').map((f) => f.split('/')[0]))], ['runs'], 'one commit holds the folder');
  assert.ok(existsSync(join(p.dir, 'scratch/loose.md')) && h.held.some((x) => x.path === 'scratch' && /untracked/.test(x.why)), 'git has no copy, so it stays, named');
  assert.ok(existsSync(join(p.dir, 'tools/data/a.json')) && h.held.some((x) => x.path === 'tools/data' && /tools\/read\.mjs/.test(x.why)), 'code reads it, so it stays, named');
  const at = /runs\/2026-01\/run-11\.md \(in git at ([0-9a-f]{10})\)/.exec(readFileSync(join(p.dir, 'docs/notes.md'), 'utf8'));
  assert.ok(at, 'the cite names git');
  assert.equal(p.git(['show', at[1] + ':runs/2026-01/run-11.md']), 'Run 11.\n', 'that commit holds the file');
  const md = readFileSync(join(p.dir, 'CLAUDE.md'), 'utf8');
  assert.ok(md.includes('\r\n') && md.includes('Build with `npm run build`.') && !md.includes('Keep commits small') && !/^## Rules/m.test(md), 'kept clause stays, carried one and its heading go');
  assert.match(md, /## AskerDo[\s\S]*WS-9[\s\S]*WS-4[\s\S]*TR-5[\s\S]*`proj`/, 'every workstream the plan wrote into');
  /* a run in another work folder (a doctor run on another PC) whose manifest names no ids keeps the section's and,
     changing nothing, commits nothing; the private CLAUDE.local.md it never commits is a skip it expects */
  const w2 = join(p.base, 'work-2');
  mkdirSync(w2);
  p.write({ 'CLAUDE.local.md': '# Mine\n\n- Answer in short lines.\n' });
  writeFileSync(join(w2, 'plan.json'), JSON.stringify({ project: { dir: p.dir }, label: 'import:proj', steps: [], cards: [], items: [], folders: [],
    claude: [{ path: 'CLAUDE.md', clauses: [{ text: 'Build with `npm run build`.', line: 3, end: 3, fate: 'kept' }] },
      { path: 'CLAUDE.local.md', clauses: [{ text: 'Answer in short lines.', line: 3, end: 3, item: 'rule:short', fate: 'carried', by: 'short-lines' }] }] }));
  writeFileSync(join(w2, 'manifest.json'), JSON.stringify({ label: 'import:proj', imports: [{ plan: 'p2', at: '2026-01-02T00:00:00Z', done: '2026-01-02T00:01:00Z', steps: [] }], left: [] }));
  writeFileSync(join(w2, 'coverage.json'), JSON.stringify({ made: new Date().toISOString(), sources: [], claude: [] }));
  const before = p.git(['rev-parse', 'HEAD']);
  const other = await handover(w2, { log: () => {} });
  assert.equal(readFileSync(join(p.dir, 'CLAUDE.md'), 'utf8'), md, 'the section keeps its workstreams, track and profile');
  assert.deepEqual([other.stopped, other.commits.length, p.git(['rev-parse', 'HEAD']), other.skipped.map((s) => [s.path, s.expected])], [undefined, 0, before, [['CLAUDE.local.md', true]]]);
  const repo =JSON.parse(readFileSync(join(p.work, 'manifest.json'), 'utf8')).imports[0].repo;
  assert.deepEqual(repo.filter((e) => e.op === 'delete' && e.path === 'runs').map((e) => [e.path, e.files, e.commit]), [['runs', 12, del.commit]]);
  /* the rewrite keeps the file's title when every clause under it goes */
  assert.match(claudeText('# Proj\n\n- Keep commits small.\n', { path: 'CLAUDE.md', clauses: [{ text: 'Keep commits small.', line: 3, end: 3, fate: 'carried' }] }, {}), /^# Proj\n\n## AskerDo/);
  /* a table is one clause of the ledger, so a menu of rule folders leaves with its dropped clause */
  const menu = '# Proj\n\nRules by folder:\n\n| Dir | Covers |\n|-|-|\n| `rules/a/` | A |\n\nBuild with npm.\n';
  const row = claudeLedger({ texts: new Map([['CLAUDE.md', menu]]), opened: [] }).find((c) => c.line === 5);
  assert.ok(row && /rules\/a/.test(row.clause), 'the table is a clause');
  const left = claudeText(menu, { path: 'CLAUDE.md', clauses: [{ text: row.clause, line: 5, fate: 'dropped' }] }, null);
  assert.ok(!left.includes('rules/a') && left.includes('Build with npm.'), 'a dropped table goes, the paragraph after it stays');

  const undo = [];
  await undoImport(p.work, { log: (s) => undo.push(s) });
  assert.match(undo.join('\n'), new RegExp('git revert ' + del.commit));

  /* where Claude reads AGENTS.md alone the section goes there and no CLAUDE.md is made; a split
     clause leaves its kept words in place; Codex's override is written from the rewritten file and the board's rules */
  const q = project(t);
  const SPLIT = 'The Viewer never runs node logic and hosts WebSockets on port 5000.';
  q.commit({ 'AGENTS.md': '# Proj\n\n- ' + SPLIT + '\n- Keep commits small.\n' });
  const seams = { ASKERDO_BOARD_URL: 'file:' + join(q.base, 'board.db'), ASKERDO_SANDBOX_HOME: join(q.base, 'home') };
  mkdirSync(seams.ASKERDO_SANDBOX_HOME);
  const was = Object.fromEntries(Object.keys(seams).map((k) => [k, process.env[k]]));
  Object.assign(process.env, seams);
  t.after(() => { for (const [k, v] of Object.entries(was)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
  q.put('plan.json', { project: { dir: q.dir }, label: 'import:proj', steps: [], cards: [], items: [], folders: [], section: 'AGENTS.md',
    claude: [{ path: 'AGENTS.md', clauses: [{ text: SPLIT, line: 3, end: 3, fate: 'split', kept: 'The Viewer hosts WebSockets on port 5000.', item: 'rule:node', by: 'no-node-logic' },
      { text: 'Keep commits small.', line: 4, end: 4, fate: 'carried', item: 'rule:small', by: 'keep-commits-small' }] }] });
  q.manifest([{ step: 'rule:node', row: 'rule:node', op: 'profile rule-add', kind: 'rule line', id: 'proj/no-node-logic' }]);
  q.put('coverage.json', { made: new Date().toISOString(), sources: [], claude: [{ path: 'AGENTS.md', clauses: 2, gaps: [], blocked: false }] });
  const ag = await handover(q.work, { log: () => {} });
  const agents = readFileSync(join(q.dir, 'AGENTS.md'), 'utf8');
  assert.ok(agents.includes('- The Viewer hosts WebSockets on port 5000.\n') && !agents.includes('node logic') && !agents.includes('Keep commits'), agents);
  assert.match(agents, /\n## AskerDo\n[\s\S]*`proj`/);
  assert.ok(!existsSync(join(q.dir, 'CLAUDE.md')), 'no CLAUDE.md beside the AGENTS.md Claude reads');
  assert.equal(ag.override.did, 'wrote', JSON.stringify(ag.override));
  const codex = readFileSync(join(q.dir, 'AGENTS.override.md'), 'utf8');
  assert.ok(codex.includes('port 5000') && !codex.includes('## AskerDo\n') && codex.includes('Rules in force'), codex);
  /* the undo writes it from AGENTS.md as the printed reverts bring it back: git ignores it, so no revert touches it */
  const m = JSON.parse(readFileSync(join(q.work, 'manifest.json'), 'utf8'));
  writeFileSync(join(q.work, 'manifest.json'), JSON.stringify({ ...m, project: { dir: q.dir } }));
  await undoImport(q.work, { board: 'live', cli: join(import.meta.dirname, '..', 'bin', 'askerdo.mjs'), session: 's1', log: () => {} });
  assert.ok(readFileSync(join(q.dir, 'AGENTS.override.md'), 'utf8').includes('Keep commits small'));
});

test("the repoint rewrites a converted source's entry to its record and a tool's path to git, in one commit, and keeps the code parsing; a bare value waits on the session", (t) => {
  const p = project(t);
  const APP = ['// Per DECISIONS D1, retries stay at three.', "console.log('numbers: handoff/RESULTS.md');", '// the RESULTS hold more.', ''].join('\n');
  /* a git note never goes inside code: after a code span, never in a glob or a fence */
  const HOWTO = ['Read `handoff/RESULTS.md` first.', "Search with `rg --glob '!handoff/**' x`, never `handoff/RES*.md`.", '```', 'cat handoff/RESULTS.md', '```', ''].join('\n');
  /* a kept routine the plan repoints, and a manifest whose path value a test harness reads */
  const MANIFEST = '{\n  "files": [\n    { "path": "handoff/RESULTS.md", "sha256": "ab" }\n  ]\n}\n';
  /* a kept README's running text: a one-word folder that goes beside the word, a cite the session points, a going
     skill cited whole (folder and file), and a wrapped sentence's last line holding only the path */
  const README = ['# Docs', '', 'The old way is in old/how.md.', 'Read `handoff/RESULTS.md` for the numbers.', 'Cut a release as `.claude/skills/ship/` says.',
    'Before a release read .claude/skills/ship/SKILL.md whole.', '', 'Never ship without the numbers. Full list:', '`handoff/RESULTS.md`.', ''].join('\n');
  /* a link whose target goes, relative links read from their folder, and a path git never held; a link
     labelled with its target's name */
  const LINKS = ['The numbers live in [`handoff/RESULTS.md`](handoff/RESULTS.md) for now.', 'See [the results](../handoff/RESULTS.md) and [the ship skill](../.claude/skills/ship/SKILL.md) first.',
    'The old plan was handoff/PLAN.md, never kept.', 'Read [`RESULTS.md`](../handoff/RESULTS.md) for the runs.', ''].join('\n');
  /* a value climbing out of its folder, which the plan reads from there */
  const PATHS = '{\n  "rules": "../../handoff/RESULTS.md"\n}\n';
  p.commit({ 'handoff/DECISIONS.md': '# Decisions\n\n## D1: Retries\n\nThree.\n', 'handoff/RESULTS.md': '# Results\n\n## Run 3\n\n30 s\n', 'src/app.js': APP, 'docs/howto.md': HOWTO,
    '.agents/skills/ship/SKILL.md': 'Read handoff/DECISIONS.md before a release.\n', 'evidence/manifest.json': MANIFEST,
    /* a workflow script, whose top-level return node --check never parses */
    'flows/run.js': "const r = await Promise.resolve(1);\nconsole.log('see handoff/RESULTS.md');\nreturn r;\n",
    'docs/README.md': README, 'docs/links.md': LINKS, 'tools/sync/paths.json': PATHS, 'old/how.md': 'Old.\n', '.claude/skills/ship/SKILL.md': '# Ship\n\n1. Run the tests.\n', 'docs/procedures/ship.md': '# Ship\n',
    /* the negation leaves with its folder's commit, so the repoint lists nothing there */
    '.gitignore': '.claude/*\n!.claude/skills/\n' });
  const proposal = { project: { dir: p.dir, slug: 'proj' }, items: [], calls: [], claude: [], folders: [{ path: 'handoff/', end: 'delete', why: 'old workflow' }] };
  const waits = (cites) => buildPlan({ ...proposal, cites }, { readVersion: () => '', readFile: () => '' }).pending.filter((x) => x.item.startsWith('cite:')).map((x) => x.item);
  const pointed = { file: 'tools/sync/paths.json', of: 'handoff/RESULTS.md', do: 'point', to: 'docs/numbers.md' };
  assert.deepEqual([waits(), waits([{ file: 'evidence/manifest.json', do: 'leave' }, pointed])], [['cite:evidence/manifest.json#L3', 'cite:tools/sync/paths.json#L2'], []]);
  const sha = p.git(['rev-parse', 'HEAD']).trim();
  p.put('plan.json', { project: { dir: p.dir }, label: 'import:proj', steps: [], items: [{ id: 'decision:d1', kind: 'decision', fields: { entry: 'D1' }, source: { file: 'handoff/DECISIONS.md', line: 3 } },
    { id: 'card:ship', kind: 'card', source: { file: '.claude/skills/ship/SKILL.md', line: 3 } }], cards: [{ item: 'card:ship', target: 'docs/procedures/ship.md' }],
    folders: [{ path: 'handoff/', end: 'delete', why: 'old workflow', evidence: {} }, { path: '.claude/skills/', end: 'delete', why: 'a card', evidence: {} }, { path: 'old/', end: 'delete', why: 'history', evidence: {} }],
    repointed: [{ loader: '.agents/skills/ship/SKILL.md', files: ['handoff/DECISIONS.md'] }], cites: [{ file: 'docs/README.md', line: 4, of: 'handoff/RESULTS.md', do: 'point', to: 'docs/numbers.md' }, pointed] });
  p.manifest();
  /* K-9 is a made-up record id for the fixture */
  p.put('idmap.json', { 'handoff/DECISIONS.md#D1': { kind: 'decision', id: 'K-9' }, 'handoff/DECISIONS.md': { kind: 'file', ids: ['K-9'] } });
  p.put('coverage.json', { made: new Date().toISOString(), sources: [], claude: [] });

  const rep = repoint(p.work, { log: () => {} });
  const js = readFileSync(join(p.dir, 'src/app.js'), 'utf8');
  assert.ok(js.includes('D1 (K-9)') && js.includes("'numbers: handoff/RESULTS.md (in git at " + sha.slice(0, 10) + ")'"));
  /* the glob, the negation and the fenced line stay as they were, named as kept as code */
  assert.deepEqual(rep.unresolved.map((u) => [u.form, u.file, u.line]).sort(), [['article', 'src/app.js', 3], ['code', 'docs/howto.md', 2], ['code', 'docs/howto.md', 4],
    ['missing', 'docs/links.md', 3], ['value', 'evidence/manifest.json', 3]]);
  assert.deepEqual([readFileSync(join(p.dir, 'evidence/manifest.json'), 'utf8'), readFileSync(join(p.dir, '.agents/skills/ship/SKILL.md'), 'utf8')], [MANIFEST, 'Read K-9 before a release.\n']);
  execFileSync(process.execPath, ['--check', join(p.dir, 'src/app.js')]);
  const howto = readFileSync(join(p.dir, 'docs/howto.md'), 'utf8').split('\n');
  assert.equal(howto[0], 'Read `handoff/RESULTS.md` (in git at ' + sha.slice(0, 10) + ') first.');
  assert.deepEqual(howto.slice(1), HOWTO.split('\n').slice(1), 'the command, the glob and the fenced line keep their meaning');
  const git = ' (in git at ' + sha.slice(0, 10) + ')';
  assert.deepEqual(readFileSync(join(p.dir, 'docs/README.md'), 'utf8').split('\n').slice(2, 9), ['The old way is in old/how.md' + git + '.', 'Read `docs/numbers.md` for the numbers.',
    'Cut a release as `docs/procedures/ship.md` says.', 'Before a release read docs/procedures/ship.md whole.', '', 'Never ship without the numbers. Full list:', '`handoff/RESULTS.md`' + git + '.']);
  /* the note goes after the link, a relative link is read from its folder (a going skill's card named from there),
     and a path git never held keeps its words, listed above; a name labelling its link stays the label */
  assert.deepEqual(readFileSync(join(p.dir, 'docs/links.md'), 'utf8').split('\n').slice(0, 4), ['The numbers live in [`handoff/RESULTS.md`](handoff/RESULTS.md)' + git + ' for now.',
    'See [the results](../handoff/RESULTS.md)' + git + ' and [the ship skill](procedures/ship.md) first.', 'The old plan was handoff/PLAN.md, never kept.',
    'Read [`RESULTS.md`](../handoff/RESULTS.md)' + git + ' for the runs.']);
  /* the value the plan waited on points where the session said, from its folder */
  assert.equal(JSON.parse(readFileSync(join(p.dir, 'tools/sync/paths.json'), 'utf8')).rules, '../../docs/numbers.md');
  assert.deepEqual(p.git(['show', '--name-only', '--format=', rep.commit]).trim().split('\n').sort(), ['.agents/skills/ship/SKILL.md', 'docs/README.md', 'docs/howto.md', 'docs/links.md', 'flows/run.js', 'src/app.js', 'tools/sync/paths.json']);
  assert.equal(JSON.parse(readFileSync(join(p.work, 'idmap.json'), 'utf8'))['handoff/'].sha, sha, 'the id map names the folder in git');
});

test('the undo takes back a fix that placed a new task and the decisions of the import in one request, reads undone only after the Allow (the plan waits till then), and keeps the map row of a source whose records stand, never its folder ends nor a row on its record that a run in another work folder put; the handover stamps the new hash of a file an earlier run mapped, which the undo gives back', async (t) => {
  const p = project(t);
  const base = p.commit({ 'README.md': 'x\n', 'FACTS.md': 'A fact.\n', 'LOG.md': 'Rows first.\n', 'NOTES.md': 'The old way is in old/how.md.\n', 'old/how.md': 'Old.\n' });
  const blob = (f) => p.git(['rev-parse', 'HEAD:' + f]).trim();
  const notesWas = blob('NOTES.md');
  const cli = join(import.meta.dirname, '..', 'bin', 'askerdo.mjs');
  const seams = { ASKERDO_BOARD_URL: 'file:' + join(p.base, 'board.db'), ASKERDO_SANDBOX_HOME: join(p.base, 'home') };
  mkdirSync(seams.ASKERDO_SANDBOX_HOME);
  const was = Object.fromEntries(Object.keys(seams).map((k) => [k, process.env[k]]));
  Object.assign(process.env, seams);
  t.after(() => { for (const [k, v] of Object.entries(was)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
  const run = cliRunner(cli);
  const call = async (args, stdin) => { const r = await run(args, { stdin: stdin ? JSON.stringify(stdin) : '', env: process.env }); assert.ok(r.ok, args.join(' ') + ': ' + r.why); return r.out; };
  const ws = await call(['ws', 'create'], { name: 'Fixture', description: 'fixture', projects: [p.dir] });
  const tr = await call(['track', 'new', '--workstream', ws.id, '--name', 'Fixture track', '--goal', 'g']);
  const label = 'import:fx';
  const decide = (id, title, more = {}) => ({ id, item: id, op: 'decide', args: ['decide'], stdin: { title, body: 'b', projects: [p.dir], labels: [label], workstreams: [ws.id], ...more } });
  const steps = [
    { id: 'task:x', item: 'task:x', op: 'task create', args: ['task', 'create'], stdin: { unplaced: 'imported', wake: '@{wake}', name: 'Switch', description: 'd', workstream: ws.id, labels: [label] } },
    decide('decision:a', 'Rows first', { refs: ['onboard:decision:a'] }), decide('decision:b', 'Rows then columns', { supersedes: ['@{decision:a}'] }),
    { id: 'fix:place', item: 'fix:place', op: 'task edit', fix: true, target: '@{task:x}', args: ['task', 'edit', '@{task:x}', '--track', tr.id], was: { unplaced: 'imported', workstream: ws.id } },
    { id: 'knowledge:a', item: 'knowledge:a', op: 'knowledge new', args: ['knowledge', 'new', '--type', 'gotcha', '--title', 'A fact', '--project', p.dir, '--label', label, '--ref', 'onboard:knowledge:a'], body: 'A fact.' },
    /* a reconcile: its ref and its amend, which no verb takes back */
    { id: 'fix:rec', item: 'fix:rec', op: 'knowledge edit', fix: true, target: '@{knowledge:a}', args: ['knowledge', 'edit', '@{knowledge:a}', '--add-ref', 'onboard:fact:b'] },
    { id: 'fix:rec@amend', item: 'fix:rec', op: 'knowledge amend', fix: true, target: '@{knowledge:a}', args: ['knowledge', 'amend', '@{knowledge:a}'], body: 'From the old system, missing here: more.' },
  ].map((s, i) => ({ ...s, n: i + 1 }));
  const items = [{ id: 'decision:a', kind: 'decision', source: { file: 'LOG.md', line: 1 } }, { id: 'knowledge:a', kind: 'knowledge', source: { file: 'FACTS.md', line: 1 } }];
  /* an earlier run's row for NOTES.md, whose cite of old/ this run's handover repoints */
  await call(['conversion', 'put', '--project', p.dir], { run: 'p0', rows: [{ source: 'NOTES.md', kind: 'file', hash: notesWas, sha: base, records: [tr.id] }] });
  p.put('plan.json', { made: '2026-11-06T00:00:00Z', go: { session: 's1' }, project: { dir: p.dir }, label, steps, pending: [], left: [], items, folders: [{ path: 'old/', end: 'delete', why: 'old notes', evidence: {} }] });
  assert.deepEqual((await applyPlan(p.work, { board: 'live', cli, log: () => {} })).refusals, []);
  p.put('coverage.json', { made: new Date().toISOString(), sources: [], claude: [] });
  const h = await handover(p.work, { cli, log: () => {} });
  const mapRow = async (f) => (await call(['conversion', '--project', p.dir])).rows.find((r) => r.source === f);
  const notes = await mapRow('NOTES.md');
  assert.ok(h.commits.length === 2 && blob('NOTES.md') !== notesWas, 'the repoint and the delete');
  assert.deepEqual([notes.hash, notes.records], [blob('NOTES.md'), [tr.id]], 'a rerun reads the repointed file unchanged, its records kept');
  const whole = () => JSON.parse(readFileSync(join(p.work, 'manifest.json'), 'utf8'));
  const m0 = whole();
  m0.imports[0].repo.push({ kind: 'repo', op: 'write', path: 'docs/procedures/ship.md', batch: 'cards', commit: base, at: '2026-11-06T00:01:00Z' });
  /* a later run in this work folder (a gap fixed) put LOG.md again, its item held by the first run's decision */
  m0.imports.push({ ...m0.imports[0], plan: '2026-11-06T01:00:00Z', steps: [], repo: [] });
  writeFileSync(join(p.work, 'manifest.json'), JSON.stringify(m0));
  /* a source that became a card, which the printed reverts take back */
  await call(['conversion', 'put', '--project', p.dir], { run: m0.imports[0].plan, rows: [{ source: 'README.md', kind: 'file', sha: base, records: ['docs/procedures/ship.md'] }] });
  await call(['conversion', 'put', '--project', p.dir], { run: m0.imports[1].plan, rows: [{ source: 'LOG.md', kind: 'file', sha: base, records: [m0.imports[0].steps.find((s) => s.step === 'decision:a').id] }] });
  /* an import in another work folder put LOG.md again on the same decision, and is undone first */
  const work2 = join(p.base, 'work2');
  mkdirSync(work2);
  writeFileSync(join(work2, 'manifest.json'), JSON.stringify({ label, project: { dir: p.dir }, imports: [{ plan: 'p-two', at: '2026-11-06T02:00:00Z', done: '2026-11-06T02:01:00Z', steps: [], repo: [] }], left: [] }));
  await call(['conversion', 'put', '--project', p.dir], { run: 'p-two', rows: [{ source: 'LOG.md', kind: 'file', sha: base, records: [m0.imports[0].steps.find((s) => s.step === 'decision:a').id] }] });
  assert.deepEqual((await undoImport(work2, { board: 'live', cli, log: () => {} })).failed, []);
  const u = await undoImport(p.work, { board: 'live', cli, session: 's1', all: true, log: () => {} });
  assert.deepEqual([u.failed, u.filed.length], [[], 1], 'the fix reverses by the id it made, and one request takes both decisions');
  const manifest = () => whole().imports[0];
  const imp = manifest();
  assert.ok(!imp.undone && undoWaits(whole()), 'open while the request waits on the user, and the plan waits with it');
  const again = await undoImport(p.work, { board: 'live', cli, session: 's1', all: true, log: () => {} });
  assert.deepEqual([again.failed, again.filed, again.waiting.length, Boolean(manifest().undone)], [[], [], 1, false], 'a run before the press files nothing and waits');
  /* standing in for the user's one press */
  await call(['override', 'decide', String(imp.steps.find((s) => s.kind === 'decision').withdrawRequest), 'allow', '--user', 's1']);
  const shown = await call(['show', ...imp.steps.filter((s) => s.kind === 'decision').map((s) => s.id)]);
  assert.deepEqual(shown.map((d) => d.status), ['withdrawn', 'withdrawn']);
  assert.deepEqual((await undoImport(p.work, { board: 'live', cli, session: 's1', all: true, log: () => {} })).failed, []);
  assert.ok(manifest().undone && !undoWaits(whole()), 'undone once the press withdrew them');
  const fact = [await call(['show', imp.steps.find((s) => s.step === 'knowledge:a').id])].flat()[0];
  assert.ok(fact.refs.includes('onboard:fact:b'), 'the reconcile ref stays with its amend, so a redo reads the fix as done');
  const rows = (await call(['conversion', '--project', p.dir])).rows.map((r) => r.source);
  assert.ok(rows.includes('FACTS.md') && !rows.includes('LOG.md') && !rows.includes('old/') && !rows.includes('README.md'),
    'the source whose knowledge record stands keeps its row; the folder end, the card the reverts take back and later runs\' rows of a withdrawn decision, one from another work folder, go: ' + rows.join(', '));
  assert.deepEqual([(await mapRow('NOTES.md')).hash, (await mapRow('NOTES.md')).run], [notesWas, 'p0'], 'the earlier run\'s row is back, as the reverts bring its file back');
});
