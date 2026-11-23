/* the doctor's checks over a stubbed board and a scratch repo, and their fixes as proposal items through the plan and the undo. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tempDir } from './helpers/sandbox.mjs';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { callOf, checkCards, checkKnowledge, checkRepo, checkRules, checkShape, checkTasks, doctor, heldOnce, reconcile, scopeHit } from '../skills/doctor/checks.mjs';
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
  assert.deepEqual(task.fields.group.members.map((m) => m.id), ['OPS-12']);
  /* an inbox task with a wake waits there on purpose: no finding */
  assert.equal(checkShape(doc, { ...extra, inbox: [{ ...extra.inbox[0], wake: '2026-12-15' }] }).length, 0);
  /* the long-asleep questions are one call, whose wake and drop options carry a fix per question */
  const asleep = checkShape({ ...doc, activity: { since: '2026-10-01' } }, { inbox: [], snoozed: ['Q1', 'Q2'].map((id) => ({ id, name: id, created: '2026-08-01T10:00:00Z', snooze: { trigger: 'later' } })) });
  assert.deepEqual(callOf(asleep[0]).options.map((o) => (o.effect.add || []).map((x) => x.fields.fix.args.slice(0, 2).join(' '))), [['wake Q1', 'wake Q2'], ['drop Q1', 'drop Q2'], []]);
  /* decisions in the facts' shape: a line differing from one in its numbers is a call with its words, and a line
     in its words is that ruling in force, no finding */
  const ruling = 'Retry a failed upload three times, 5 seconds apart, then stop.';
  const lineOn = (said) => checkRules({ ...doc, board: { ...doc.board, decisions: [{ id: 'K-8', title: 'Upload retries', ruling }], rules: [{ rule: 'retry', text: said, source: 'ops on ' + dir }] } }, extra);
  const [differs] = lineOn(ruling.replace('5 seconds', '10 seconds'));
  assert.deepEqual([differs && differs.call, differs && differs.fields.fix.from, differs && differs.fields.fix.text], [true, 'K-8', ruling]);
  assert.equal(lineOn(ruling).length, 0);
  /* a file kept by its own entry inside a deleted folder is no cite of it; a gone sibling is */
  const ended = { folders: [{ folder: 'ops/old/', fate: 'delete', at: 'c0ffee1' }, { folder: 'ops/old/KEEP.md', fate: 'keep' }] };
  const citing = (path) => checkRules({ ...doc, conversion: ended, board: { ...doc.board, rules: [{ rule: 'read-plan', text: 'Read ' + path + ' first.', source: 'ops on ' + dir }] } }, { ...extra, files: ['ops/old/KEEP.md'] });
  assert.deepEqual([citing('ops/old/KEEP.md').length, citing('ops/old/STATE.md').map((r) => r.fields.evidence.includes('ops/old'))], [0, [true]]);

  /* the group's pick is the user's call, one option per live track and leave; the answer adds a fix per task with
     its track, which runs after every create and whose undo puts the task back unplaced */
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
  /* a question the group call woke or dropped goes back asleep on the trigger it had */
  const asleepCall = callOf(asleep[0]);
  const undid = asleepCall.options.slice(0, 2).map((o) => {
    asleepCall.answer = o.letter;
    const p = buildPlan({ ...proposal, items: [asleep[0]], calls: [asleepCall] }, { readVersion: () => '' });
    return p.steps.filter((s) => s.fix).map((s) => undoArgs(s, s.target, 'import:ops'));
  });
  assert.deepEqual(undid, [['Q1', 'Q2'].map((id) => ['snooze', id, '--trigger', 'later']), ['Q1', 'Q2'].map((id) => ['reopen', id, '--trigger', 'later'])]);

  /* one row per kind of old-shape task, each with its fix (an unconfirmed run is told, never fixed);
     a recent unconfirmed run is no row, and none reads as a shape row */
  const doneSaid = 'Done when the upload ships to every user on the list.';
  const tk = (id, more = {}) => ({ id, name: id, status: 'open', word: { is: 'ready' }, created: '2026-01-01', wake: { date: '2099-01-01' }, ...more });
  const blk = (id, more = {}) => [id, { id, status: 'open', labels: [], steps: [], notes: [], description: doneSaid, track: null, ...more }];
  const tdoc = { ...doc, board: { ...doc.board, tasks: [tk('T-1'), tk('T-2', { close: { kind: 'look' }, landed: '2026-11-10T10:00' }), tk('T-3', { close: { kind: 'when', fact: 'the docs build' } }),
    tk('T-4'), tk('T-5', { word: { is: 'unconfirmed', since: '2026-11-12T10:00:00Z', session: 's1' } }), tk('T-6', { created: null, wake: null }),
    tk('T-7', { word: { is: 'unconfirmed', since: '2026-11-14T11:00:00Z', session: 's2' } }), tk('T-8'), tk('T-9'), tk('T-10')] } };
  const textra = { now: Date.parse('2026-11-14T12:00:00Z'), who: 'Sam', inbox: [{ id: 'T-6' }], parked: new Map([['T-4', 'blocked']]), blocks: new Map([
    blk('T-1', { steps: [{ n: 1, text: 'write the parser' }, { n: 2, text: 'Sam looks at the band' }, { n: 3, text: 'check the band in the next session' }], track: { id: 'TR-4', name: 'Band' } }), blk('T-2'), blk('T-3'), blk('T-4', { notes: [{ body: 'on the vendor' }] }),
    blk('T-5'), blk('T-6'), blk('T-7'), blk('T-8', { description: 'Write the parser.' }),
    /* a moved step's short form carries its done clause, so T-9 gets no rewrite row */
    blk('T-9', { description: 'Step 3 of T-1: check the band in the next session' }),
    /* the why note of the doctor's own rewrite shares its stamp, so the next run asks no rewrite */
    blk('T-10', { rewrittenAt: '2026-11-14T10:00:00Z', notes: [{ at: '2026-11-14T10:00:00Z', body: 'The doctor moved its when close into its done clause, so the fact reads in the description.' }] })]) };
  const shaped = checkTasks(tdoc, { ...textra, depth: true });
  /* a rewrite is asked for with depth */
  assert.ok(!checkTasks(tdoc, textra).some((r) => /:rewrite$/.test(r.id)));
  assert.deepEqual(shaped.map((r) => [r.id.split(':').slice(2).join(':'), r.fields.info ? 'info' : r.fields.fix.op]), [['T-1:steps', 'task update'], ['T-2:look', 'task edit'],
    ['T-3:when', 'task update'], ['T-3:when-close', 'task edit'], ['T-4:waits', 'edge add'], ['T-5:unconfirmed', 'info'], ['T-8:rewrite', 'task update'], ['T-6:nowake', 'task edit']]);
  assert.deepEqual(shaped[0].fields.steps.map((s) => s.n), [2, 3]);
  /* a later session's check moves with the next-session wake onto its track */
  assert.deepEqual(shaped[0].fields.moves.map((m) => [m.check, m.track, m.wake]), [[3, 'TR-4', 'next-session']]);
  /* from a session holding that track the ladder takes it at tier 2 */
  assert.equal(checkTasks(tdoc, { ...textra, held: 'TR-4' })[0].fields.moves[0].tier, 2);
  /* a look task's steps are the look, and a step judged wrong stays judged while its words are the same */
  const flagged = (over, more = {}) => checkTasks(tdoc, { ...textra, ...more, blocks: new Map([...textra.blocks].map(([k, b]) => [k, k === 'T-1' ? { ...b, ...over } : b])) }).some((r) => r.id.endsWith('T-1:steps'));
  const judgedSteps = new Set(shaped[0].fields.steps.map((s) => s.key));
  assert.deepEqual([flagged({ labels: ['look'] }), flagged({}, { judgedSteps }), flagged({ steps: [{ n: 2, text: 'Sam looks at the band again' }] }, { judgedSteps })], [false, false, true]);
  assert.ok(!checkShape(tdoc, { inbox: [] }).some((r) => /T-5/.test(r.id)));
  const look = shaped[1].fields.fix;
  assert.deepEqual(undoArgs({ fix: true, op: look.op, args: look.args, target: look.target }), ['task', 'edit', 'T-2', '--remove-label', 'look']);
  /* a cleared handoff folder undoes to the folder it named, unseeded so the printed git revert can restore it */
  assert.deepEqual(undoArgs({ fix: true, op: 'ws edit', args: ['ws', 'edit', 'WS-7', '--clear-handoff'], target: 'WS-7', was: { handoff: 'docs/h' } }), ['ws', 'edit', 'WS-7', '--handoff', 'docs/h', '--no-seed']);

  /* at depth, knowledge: a source still in the repo saying no more is no finding, the import's own records are never
     a pair, and one item written twice (a redo after an undo, which keeps knowledge) is one group whose newer holds the older */
  mkdirSync(join(dir, 'ops'));
  writeFileSync(join(dir, 'ops', 'REFERENCE.md'), '# Ref\n\nThe pool holds four workers.\n');
  const rec = (id, from) => ({ id, kind: 'knowledge', status: 'active', name: id, projectRepos: [], global: true,
    sections: { Body: 'The pool holds four workers.\n\nFrom the old system: ' + from + ', 2026-09-10 (commit date).' } });
  const records = new Map([['K-1', rec('K-1', 'ops/REFERENCE.md line 3 (commit abc1234)')]]);
  const ownRec = (id, name, item) => ({ ...rec(id, 'ops/old/STATE.md line 2'), name, projectRepos: [doc.project.shared], labels: ['import:ops'], refs: ['onboard:' + item] });
  records.set('K-4', ownRec('K-4', 'Upload pool worker count limit', 'fact:a'));
  records.set('K-5', ownRec('K-5', 'Upload pool worker count limits', 'fact:b'));
  const twice = (id) => ({ ...rec(id, 'ops/REFERENCE.md line 3'), name: 'Upload pool holds four workers', projectRepos: [doc.project.shared], labels: ['import:ops'], refs: ['onboard:fact:ops/REFERENCE.md#L3'] });
  records.set('K-10', twice('K-10'));
  records.set('K-11', twice('K-11'));
  const found = checkKnowledge(doc, { files: ['ops/REFERENCE.md'], records });
  assert.deepEqual(found.map((r) => r.fields.group && r.fields.group.members.map((m) => m.id)), [['K-10']]);
  assert.deepEqual(callOf(found[0]).options[0].effect.add[0].fields.fix.args, ['knowledge', 'supersede', 'K-10', '--by', 'K-11']);

  /* reconcile: an item the board holds by its title becomes a fix whose amend one source text makes once;
     one whose source the map holds unchanged (an earlier run, on any PC) is no finding */
  const fact = (id, covered, text, file = 'FACTS.md') => ({ id, kind: 'knowledge', title: 'GaugePort resolves its wired source', text, fields: { sourceText: text }, source: { file, line: 1 }, covered });
  const said = 'The GaugePort resolves its wired source within 2 frames.';
  const conv = [fact('fact:a', 'K-7', said), fact('fact:b', 'K-7', said), fact('fact:c', 'K-9', said, 'OLD.md'), fact('fact:d', null, said)];
  const rdoc = { board: { tasks: [] }, conversion: { sources: [{ source: 'OLD.md', records: ['K-9'], state: 'unchanged' }] } };
  const recon = reconcile(rdoc, conv, { depth: true, records: new Map([['K-7', { id: 'K-7', name: 'Gaugeport resolves wired source', sections: { Body: 'A GaugePort resolves its wired source.' } }]]) });
  assert.deepEqual(recon.checkup.map((r) => r.fields.record), ['K-7', 'K-7']);
  assert.deepEqual(recon.checkup.map((r) => r.fields.gaps.length > 0), [true, false], 'the repeated text amends once');
  /* by default a covered item is skipped and named, with no ref or amend */
  const named = reconcile(rdoc, conv, {});
  assert.deepEqual([named.checkup.length, named.covered.map((x) => x.item + ' ' + x.record)], [0, ['fact:a K-7', 'fact:b K-7']]);

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
  /* from the map, a record whose source changed since; the setting the last run saw, which reads AGENTS.md too */
  const conversion = { last: { at: '2026-11-01T10:00:00Z' }, sources: [{ source: 'ops/REFERENCE.md', records: ['K-1'], state: 'changed' }],
    folders: [{ folder: 'workflow/', fate: 'delete', at: 'abc1234' }], calls: [{ call: 'checkup:shape:OPS-4', answer: 'b', state: 'unchanged' }],
    instructions: { mode: 'claude-md-or-agents-md', read: ['AGENTS.md', 'CLAUDE.md'], run: '2026-11-01T10:00:00Z' } };
  /* a kept clause citing only paths that are gone is one finding, a rule file citing a gone path another; the setting
     now reads CLAUDE.md only */
  /* a cite the handover repointed to git is history, no gone path */
  writeFileSync(join(dir, 'CLAUDE.md'), '# Ops\n\nDeploy with old/deploy.ps1 and old/hosts.json.\n\nThe last run is in `runs/r.md` (in git at abc1234).\n');
  const instr = { instructions: { setting: { mode: 'claude-md' }, files: [{ file: 'CLAUDE.md', read: 'start' }, { file: 'AGENTS.md', read: false }] },
    claude: [{ file: 'CLAUDE.md', line: 3, clause: 'Deploy with old/deploy.ps1 and old/hosts.json.' }, { file: 'CLAUDE.md', line: 5, clause: 'The last run is in `runs/r.md` (in git at abc1234).' }], ruleFiles: [{ file: '.claude/rules/deploy.md', cites: { gone: [{ path: 'old/deploy.ps1' }], ok: false } }] };
  const run = doctor(dir, { work, board: false, gather: () => ({ facts: { project: { path: dir }, board, conversion, ...instr } }) });
  const checkup = JSON.parse(readFileSync(run.checkupFile, 'utf8'));
  assert.deepEqual([checkup.counts.rules.found, checkup.counts.shape.found, checkup.leftLast, checkup.calls.length, 'knowledge' in checkup.counts], [2, 0, 1, 0, false]);
  const of = (c) => checkup.items.filter((x) => x.fields.check === c);
  assert.deepEqual(of('repo').map((x) => (x.fields.instructions ? 'setting' : x.source.line || x.source.file)), [3, '.claude/rules/deploy.md', 'setting']);
  assert.ok(checkup.items.some((x) => x.id === 'checkup:rules:ops/keep-plan:cites'), 'the line citing the retired folder');
  assert.deepEqual(of('source').map((x) => x.fields.record), ['K-1']);
  assert.ok(checkup.items.every((x) => x.kind === 'fix' && x.fields.check) && !existsSync(join(work, 'proposal.json')));
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
  assert.match(r.stdout, /reconcile not read/);
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
  const [row] = checkCards(doc, cards(2));
  assert.deepEqual([checkCards(doc, cards(2)).length, row.fields.fix.op], [1, 'proc read'], 'a changed path is a read of the card, one row a card');
  /* a template and a path git never held are no gone files; one a commit deleted is */
  writeFileSync(join(repo, 'old.json'), '{}\n');
  git('add', 'old.json');
  git('commit', '-q', '-m', 'add');
  git('rm', '-q', 'old.json');
  git('commit', '-q', '-m', 'remove');
  const said = (text, decisions = []) => checkRules({ ...doc, board: { profiles: [{ profile: 'ops', here: true, lines: [] }], decisions, rules: [{ rule: 'l', text, source: 'ops on ' + repo }] } }, { files: [] });
  assert.equal(said('Keep `notes/<package>-state.md` and the phone file `files/play.json`.').length, 0);
  assert.equal(said('Read `old.json` first.').length, 1);
  /* a folder a commit deleted and a file moved under a new parent were held; a folder git never had was not */
  for (const f of ['gone/a.md', 'notes/plan.md']) { mkdirSync(join(repo, f, '..'), { recursive: true }); writeFileSync(join(repo, f), 'one\ntwo\nthree\n'); }
  git('add', 'gone', 'notes');
  git('commit', '-q', '-m', 'add the two');
  git('rm', '-q', '-r', 'gone');
  mkdirSync(join(repo, 'archive'));
  git('mv', 'notes', 'archive/notes');
  git('commit', '-q', '-m', 'delete one, move the other');
  const once = heldOnce(repo);
  assert.deepEqual(['gone/', 'gone', 'notes/plan.md', 'phone/files'].map(once), [true, true, true, false]);
  /* a file stating the board by a closed track is a finding; by a live one it is not */
  const states = (id, head = 'On the board, WS-3.') => { writeFileSync(join(repo, 'CLAUDE.md'), head + ' Resume with `/askerdo resume ' + id + '`.\n'); return checkRepo({ ...doc, board: { tracks: [{ id: 'TR-1', state: 'done', workstream: 'WS-3' }, { id: 'TR-2', state: 'waiting', workstream: 'WS-3' }] } }, { files: ['CLAUDE.md'] }).filter((x) => x.id.includes('closed-resume')); };
  assert.deepEqual([states('TR-1').length, states('TR-2').length, states('TR-1', '## AskerDo\n\n-').length], [1, 0, 1]);
  /* an outside document's section numbers are no difference from a ruling on another subject */
  const r3 = [{ id: 'K-9', title: 'R3', ruling: 'It must work on any Google Home or Nest speaker, not one model.' }];
  assert.equal(said('Before advice on a Google Home or Nest speaker, read the Cast terms 3.2 and 3.4.2.', r3).length, 0);
});
