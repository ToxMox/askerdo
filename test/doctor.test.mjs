/* the doctor's checks over a stubbed board and a scratch repo, and their fixes as proposal items through the plan and the undo. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tempDir } from './helpers/sandbox.mjs';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { callOf, checkCards, checkKnowledge, checkRules, checkShape, doctor, reconcile, scopeHit } from '../skills/doctor/checks.mjs';
import { buildPlan } from '../skills/onboard/plan.mjs';
import { undoArgs } from '../skills/onboard/apply.mjs';

test('a rule line citing a file the repo lacks and a task on no track become checkup rows with their fixes', (t) => {
  const dir = tempDir('doctor-', t);
  const text = 'Read handoff/PLAN.md before any change.';
  const doc = {
    project: { dir, slug: 'ops', shared: dir.toLowerCase() },
    activity: {},
    board: {
      workstreams: [{ id: 'OPS-1', name: 'Ops' }], tasks: [], decisions: [],
      profiles: [{ profile: 'ops', here: true, elsewhere: false, builtIn: false, lines: [{ slug: 'read-plan', text }] }],
      rules: [{ rule: 'read-plan', text, source: 'ops on ' + dir }],
      tracks: [{ id: 'OPS-3', name: 'Release pipeline', state: 'waiting', workstream: 'OPS-1' }],
    },
  };
  const extra = { inbox: [{ id: 'OPS-12', name: 'Fix the flaky upload test', status: 'open' }], files: [], idmap: {} };
  const rows = [...checkRules(doc, extra), ...checkShape(doc, extra)];
  assert.equal(rows.length, 2);
  const [rule, task] = rows;
  assert.deepEqual([rule.kind, rule.fields.fix.op, rule.fields.fix.text, rule.call], ['fix', 'profile rule-add', undefined, undefined], 'a reword the session words, no call');
  assert.equal(task.fields.fix.op, 'task edit');
  /* decisions in the facts' shape: a line differing from one in its numbers is a call with its words, and a line
     in its words is that ruling in force, no finding */
  const ruling = 'Retry a failed upload three times, 5 seconds apart, then stop.';
  const lineOn = (said) => checkRules({ ...doc, board: { ...doc.board, decisions: [{ id: 'K-8', title: 'Upload retries', ruling }], rules: [{ rule: 'retry', text: said, source: 'ops on ' + dir }] } }, extra);
  const [differs] = lineOn(ruling.replace('5 seconds', '10 seconds'));
  assert.deepEqual([differs && differs.call, differs && differs.fields.fix.from, differs && differs.fields.fix.text], [true, 'K-8', ruling]);
  assert.equal(lineOn(ruling).length, 0);

  /* the pick is the user's call, one option per live track and leave; the answer adds the fix with its track,
     which runs after every create and whose undo puts the task back unplaced */
  const call = callOf(task);
  const on = call.options.find((o) => /OPS-3/.test(o.label));
  assert.ok(on && call.options.some((o) => o.effect.drop.includes(task.id) && !o.effect.add), 'a track or leave');
  const create = { id: 'fact:a', kind: 'knowledge', title: 'A fact', text: 'b', fields: { title: 'A fact', body: 'b', labels: [] }, source: { file: 'FACTS.md', line: 3 } };
  const proposal = { project: { dir, slug: 'ops' }, workstream: { use: 'OPS-1' }, items: [rule, task, create], folders: [], calls: [call], claude: [] };
  assert.throws(() => buildPlan(proposal, { readVersion: () => '' }), /wait on the user/);
  call.answer = on.letter;
  const plan = buildPlan(proposal, { readVersion: () => '' });
  assert.deepEqual(plan.pending.map((p) => p.item), [rule.id], 'the reword waits for words');
  const fix = plan.steps.find((s) => s.fix);
  assert.ok(fix.n > plan.steps.find((s) => s.op === 'knowledge new').n);
  assert.deepEqual(undoArgs(fix, fix.target, 'import:ops'), ['task', 'edit', 'OPS-12', '--unplaced', 'undo of the doctor', '--wake', '@{wake}']);

  /* from lines as the import writes them: a source still in the repo is no finding, a gone one is named whole,
     and one an earlier amend placed is not found again */
  mkdirSync(join(dir, 'ops'));
  writeFileSync(join(dir, 'ops', 'REFERENCE.md'), '# Ref\n\nThe pool holds four workers.\n');
  const rec = (id, from, more = '') => ({ id, kind: 'knowledge', status: 'active', name: id, projectRepos: [], global: true,
    sections: { Body: 'The pool holds four workers.\n\nFrom the old system: ' + from + ', 2026-09-10 (commit date).' + more } });
  const records = new Map([['K-1', rec('K-1', 'ops/REFERENCE.md line 3 (commit abc1234)')], ['K-2', rec('K-2', 'ops/PLAN.md line 4')],
    ['K-3', rec('K-3', 'ops/PLAN.md line 4', '\n\nAmended 2026-11-05 by the user: The source ops/PLAN.md line 4 is retired: it is in git.')]]);
  /* the import's own records are its output: a source under a folder the map holds deleted is in git at that
     delete, never a finding, nor are two of them a pair */
  const ownRec = (id, name) => ({ ...rec(id, 'ops/old/STATE.md line 2'), name, labels: ['import:ops'], refs: ['onboard:fact:ops/old/STATE.md#L2'] });
  records.set('K-4', ownRec('K-4', 'Upload pool worker count limit'));
  records.set('K-5', ownRec('K-5', 'Upload pool worker count limits'));
  /* one item written twice (a redo after an undo, which keeps knowledge) is a pair: the older goes */
  const twice = (id) => ({ ...rec(id, 'ops/REFERENCE.md line 3'), name: 'Upload pool holds four workers', projectRepos: [doc.project.shared], labels: ['import:ops'], refs: ['onboard:fact:ops/REFERENCE.md#L3'] });
  records.set('K-10', twice('K-10'));
  records.set('K-11', twice('K-11'));
  const known = { files: ['ops/REFERENCE.md'], records };
  const found = checkKnowledge({ ...doc, conversion: { folders: [{ folder: 'ops/old/', fate: 'delete', at: 'c0ffee1' }] } }, known);
  assert.deepEqual(found.map((r) => r.fields.record), ['K-2', 'K-10']);
  assert.deepEqual(found[1].fields.fix.args, ['knowledge', 'supersede', 'K-10', '--by', 'K-11']);
  assert.match(found[0].fields.fix.body, /ops\/PLAN\.md line 4/);

  /* reconcile: an item the board holds by its title becomes a fix whose amend one source text makes once;
     one whose source the map holds unchanged (an earlier run, on any PC) is no finding */
  const fact = (id, covered, text, file = 'FACTS.md') => ({ id, kind: 'knowledge', title: 'GaugePort resolves its wired source', text, fields: { sourceText: text }, source: { file, line: 1 }, covered });
  const said = 'The GaugePort resolves its wired source within 2 frames.';
  const conv = [fact('fact:a', 'K-7', said), fact('fact:b', 'K-7', said), fact('fact:c', 'K-9', said, 'OLD.md'), fact('fact:d', null, said)];
  const recon = reconcile({ board: { tasks: [] }, conversion: { sources: [{ source: 'OLD.md', records: ['K-9'], state: 'unchanged' }] } }, conv, {
    records: new Map([['K-7', { id: 'K-7', name: 'Gaugeport resolves wired source', sections: { Body: 'A GaugePort resolves its wired source.' } }]]) });
  assert.deepEqual(recon.checkup.map((r) => r.fields.record), ['K-7', 'K-7']);
  assert.deepEqual(recon.checkup.map((r) => r.fields.gaps.length > 0), [true, false], 'the repeated text amends once');
  assert.deepEqual(known.own.inGit.map((x) => [x.id, x.at.slice(0, 7)]), [['K-4', 'c0ffee1'], ['K-5', 'c0ffee1']]);

  /* a record with no project is the project's by a repo path or its name, never a bare word like a top-level folder's */
  const scope = { top: ['tools', 'docs'], has: (p) => p === 'tools/sync.ps1', names: ['Tidewatch'] };
  assert.deepEqual(['Native task tools work again', 'Run tools/sync.ps1 first', 'Reaching the server through Tidewatch\'s scripts'].map((s) => scopeHit(s, scope)), [null, 'tools/', 'Tidewatch']);

  /* the run reads the board from the gathered facts and writes checkup.json, each finding with its fix and the
     calls; the proposal is the session's to write. What earlier runs did comes from the map alone, with an
     empty work folder, as on another PC: a line citing a folder a run deleted, and a parked track left by its call */
  const work = join(dir, 'work');
  const wf = 'Keep the plan in `workflow/` current.';
  const board = { ...doc.board, tracks: [...doc.board.tracks, { id: 'OPS-4', name: 'Old idea', state: 'parked', parkReason: 'someday', workstream: 'OPS-1' }],
    profiles: [{ ...doc.board.profiles[0], lines: [...doc.board.profiles[0].lines, { slug: 'keep-plan', text: wf }] }], rules: [...doc.board.rules, { rule: 'keep-plan', text: wf, source: 'ops on ' + dir }], errors: [] };
  /* from the map, a record whose source changed since, and one the board lost while its source stays */
  const conversion = { last: { at: '2026-11-01T10:00:00Z' }, sources: [{ source: 'ops/REFERENCE.md', records: ['K-1'], state: 'changed' },
    { source: 'ops/PLAN.md', records: ['T-5'], state: 'unchanged', gone: ['T-5'] }, { source: 'ops/STATE.md', records: ['K-4'], state: 'removed', gone: ['K-4'] }],
    folders: [{ folder: 'workflow/', fate: 'delete', at: 'abc1234' }], calls: [{ call: 'checkup:shape:OPS-4', answer: 'b', state: 'unchanged' }],
    /* a keep whose evidence changed, and the setting the last run saw, which reads AGENTS.md too */
    judgments: [{ key: 'folder:tools/', kind: 'folder', subject: 'tools/', fate: 'keep', why: 'the build reads it', state: 'rejudge', because: ['its reader build.mjs is gone'] }],
    instructions: { mode: 'claude-md-or-agents-md', read: ['AGENTS.md', 'CLAUDE.md'], run: '2026-11-01T10:00:00Z' } };
  /* a kept clause citing only paths that are gone is one finding; the setting now reads CLAUDE.md only */
  writeFileSync(join(dir, 'CLAUDE.md'), '# Ops\n\nDeploy with old/deploy.ps1 and old/hosts.json.\n');
  const instr = { instructions: { setting: { mode: 'claude-md' }, files: [{ file: 'CLAUDE.md', read: 'start' }, { file: 'AGENTS.md', read: false }] },
    claude: [{ file: 'CLAUDE.md', line: 3, clause: 'Deploy with old/deploy.ps1 and old/hosts.json.' }] };
  const run = doctor(dir, { work, board: false, gather: () => ({ facts: { project: { path: dir }, board, conversion, ...instr } }) });
  const checkup = JSON.parse(readFileSync(run.checkupFile, 'utf8'));
  assert.deepEqual([checkup.counts.rules.found, checkup.counts.shape.found, checkup.leftLast, checkup.calls.length], [2, 0, 1, 1]);
  const of = (c) => checkup.items.filter((x) => x.fields.check === c);
  assert.deepEqual([of('repo').map((x) => (x.fields.instructions ? 'setting' : x.source.line)), of('kept').map((x) => x.fields.judgment)], [[3, 'setting'], ['folder:tools/']]);
  assert.ok(checkup.items.some((x) => x.id === 'checkup:rules:ops/keep-plan:cites'), 'the line citing the retired folder');
  assert.deepEqual(['source', 'gone'].map((c) => checkup.items.filter((x) => x.fields.check === c).map((x) => x.fields.record)), [['K-1'], ['T-5']]);
  assert.ok(checkup.items.every((x) => x.kind === 'fix' && x.fields.check) && !existsSync(join(work, 'proposal.json')));
  /* a finding an earlier run left with no call, on the map's run row, stays left while its source is unchanged */
  /* a judgment to make again is never left */
  const left = [{ item: 'checkup:rules:ops/keep-plan:cites', state: 'unchanged' }, { item: 'checkup:kept:folder:tools/', state: 'unchanged' }];
  const again = doctor(dir, { work, board: false, gather: () => ({ facts: { project: { path: dir }, board, conversion: { ...conversion, left }, ...instr } }) });
  const c2 = JSON.parse(readFileSync(again.checkupFile, 'utf8'));
  assert.deepEqual([c2.counts.rules.found, c2.leftLast, c2.counts.kept.found], [1, 2, 1]);
});

test('a check whose reads failed prints no count and no clean Checkup line, and the run exits non-zero', (t) => {
  const dir = tempDir('doctor-', t);
  const repo = join(dir, 'ops');
  mkdirSync(repo);
  for (const a of [['init', '-q', '-b', 'main'], ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'start']]) spawnSync('git', a, { cwd: repo });
  /* a board whose knowledge list fails, as the PC's older local server refused the batched show; only the
     conversion map names the project, as after a run on another PC */
  const cli = join(dir, 'cli.mjs');
  writeFileSync(cli, `const a = process.argv.slice(2);
if (a[0] === 'list' && a.includes('knowledge')) { console.error('AskerDo: show needs exactly one record id'); process.exit(1); }
const o = { profile: { profiles: [], rows: [] }, projects: { projects: [] }, track: { tracks: [] }, proc: { files: [] }, conversion: { rows: [{ source: 'run:r1', kind: 'run', run: 'r1', at: '2026-11-01T10:00:00Z', detail: {} }], last: null } }[a[0]];
console.log(JSON.stringify(o || (a.includes('--project') ? { questions: [] } : [])));`);
  const r = spawnSync(process.execPath, [join(import.meta.dirname, '..', 'skills', 'doctor', 'checks.mjs'), repo, '--work', join(dir, 'work'), '--cli', cli], { encoding: 'utf8' });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stdout, /knowledge not read/);
  assert.doesNotMatch(r.stdout, /^Checkup:/m);

  /* a card's path changed only by the conversion's own commits is no finding; another commit is */
  const git = (...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: repo, encoding: 'utf8' }).stdout.trim();
  const base = git('rev-parse', 'HEAD');
  writeFileSync(join(repo, 'CLAUDE.md'), '# Ops\n');
  git('add', 'CLAUDE.md');
  git('commit', '-q', '-m', 'import:ops: CLAUDE.md points at the board');
  const cards = (n) => ({ cards: { files: [{ name: 'deploy.md', errors: [], warnings: ['changed since ' + base.slice(0, 7) + ': CLAUDE.md (' + n + ' commit' + (n > 1 ? 's' : '') + ')'] }] } });
  const doc = { project: { dir: repo, slug: 'ops' } };
  assert.equal(checkCards(doc, cards(1)).length, 0);
  writeFileSync(join(repo, 'CLAUDE.md'), '# Ops, by hand\n');
  git('commit', '-q', '-am', 'a hand edit');
  assert.equal(checkCards(doc, cards(2)).length, 1);
});
