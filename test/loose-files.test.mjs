/* Loose files and the gentler repo check, this PC's half: a track
 * handoff's snapshot and stop rules, dispositions kept in the data dir and
 * printed, the kept line a kickoff prints, and the merged agent worktrees a write removes. */
import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fixtureCopy, tempDir } from './helpers/sandbox.mjs';
import { slicer } from './helpers/shard.mjs';

/* run as two files: the worktree case and the snapshot case each take a quarter minute in a loaded suite */
const mine = slicer(2);
const test = (...args) => (mine() ? nodeTest(...args) : undefined);

process.removeAllListeners('warning');
process.env.ASKERDO_SANDBOX_HOME = tempDir('askerdo-loose-');
const lf = await import('../lib/loose-files.mjs');
const pc = await import('../lib/tracks-session.mjs');

const FIXED = new Date(2026, 9, 19, 10, 0, 0);
const atDay = (days, minutes = 0) => new Date(FIXED.getTime() + days * 86400000 + minutes * 60000);
const dayOf = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

function repo() {
  /* built once per file and copied */
  const dir = fixtureCopy('askerdo-loose-repo-', '', (d) => {
    const g = (...args) => execFileSync('git', ['-C', d, ...args], { encoding: 'utf8' }).trim();
    g('init', '-q', '-b', 'main');
    g('config', 'user.email', 't@example.com');
    g('config', 'user.name', 't');
    g('config', 'commit.gpgsign', 'false');
    g('config', 'core.autocrlf', 'false');
    writeFileSync(join(d, 'a.txt'), 'a\n');
    writeFileSync(join(d, 'b.txt'), 'b\n');
    g('add', 'a.txt', 'b.txt');
    g('commit', '-q', '-m', 'one');
  });
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
  return { dir: dir.replace(/\\/g, '/'), git, put: (p, t) => { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), t); } };
}

/* What a track handoff does on this PC (tracks-session writeTrackHandoff), less the board's handoff record. */
async function handOff(dir, path, files, at, worktrees) {
  const p = pc.validateHandoffPayload({ focus: 'Go on.', state: 'Work.', verifyFirst: [{ path, ...(files ? { files } : {}), ...(worktrees ? { worktrees } : {}) }] });
  const v = await pc.runVerifyFirst(p.verifyFirst, { dir, now: at });
  lf.storeHandoffFiles(dir, v.entries, 'handoff-key', dayOf(at));
  return v;
}

test('the snapshot: a dirty file left as it was passes, new commits on top pass, and each stop rule stops', async () => {
  const rp = repo();
  rp.put('a.txt', 'work in progress\n');
  const snap = await lf.snapshotRepoAsync(rp.dir);
  assert.equal(snap.commit, rp.git('rev-parse', 'HEAD'));
  assert.deepEqual(Object.keys(snap.dirty), ['a.txt'], 'nobody typed expectedDirty: the snapshot took it');
  const problems = async (over = {}) => (await lf.checkSnapshotAsync({ path: rp.dir, branch: 'main', snapshot: snap, ...over })).problems;
  assert.deepEqual(await problems(), []);
  assert.ok((await problems({ worktree: rp.dir + '/no-such-tree' })).some((p) => p.includes('no-such-tree')), 'a missing worktree stops the leg');
  rp.git('add', 'a.txt');
  rp.git('commit', '-q', '-m', 'two');
  assert.deepEqual(await problems(), [], 'the dirty file committed as it was, on top of the snapshot');
  rp.put('a.txt', 'changed again\n');
  assert.match((await problems()).join('; '), /changed.*a\.txt/);
  rp.git('checkout', '-q', '--', 'a.txt');
  rp.put('b.txt', 'b moved\n');
  assert.match((await problems()).join('; '), /changed.*b\.txt/, 'a file clean at the snapshot is compared with the snapshot commit');
  rp.git('checkout', '-q', '--', 'b.txt');
  rp.git('reset', '-q', '--hard', 'HEAD~1');
  rp.git('commit', '-q', '--amend', '-m', 'one, rewritten');
  const gone = await problems();
  assert.ok(gone[0].includes(snap.commit.slice(0, 12)), gone[0]);
  assert.match(gone[1], /a\.txt/, 'the reset also threw the dirty work away');
  /* a build whose branch lives in a worktree is checked there while the main checkout stays on its own branch */
  const tree = rp.dir + '-build';
  rp.git('worktree', 'add', '-q', tree, '-b', 'build');
  const [e] = (await pc.runVerifyFirst(pc.validateHandoffPayload({ focus: 'f', state: 's', verifyFirst: [{ path: rp.dir, branch: 'build', worktree: tree }] }).verifyFirst, {})).entries;
  assert.equal(e.commit, rp.git('rev-parse', 'build'));
  assert.deepEqual((await lf.checkSnapshotAsync(e)).problems, []);
  /* a branch and commit the caller gives that git disagrees with are git's in the record, and the result says so */
  const told = await pc.runVerifyFirst(pc.validateHandoffPayload({ focus: 'f', state: 's', verifyFirst: [{ path: rp.dir, branch: 'gone-lane', commit: 'abcdef1', worktree: tree }] }).verifyFirst, {});
  assert.equal(told.entries[0].branch, 'build');
  assert.equal(told.entries[0].commit, rp.git('rev-parse', 'build'));
  assert.equal(told.summary[0].ok, true);
  assert.ok(told.gitLine && told.gitLine.includes('gone-lane') && told.gitLine.includes('abcdef1'), told.gitLine);
  assert.deepEqual((await lf.checkSnapshotAsync(told.entries[0])).problems, [], 'the resume checks git\'s branch against git\'s snapshot');
  /* a worktree that is not there is named as missing, the given branch still kept out */
  const lost = await pc.runVerifyFirst(pc.validateHandoffPayload({ focus: 'f', state: 's', verifyFirst: [{ path: rp.dir, branch: 'gone-lane', worktree: tree + '-gone' }] }).verifyFirst, {});
  assert.ok(lost.gitLine.includes(tree + '-gone') && !lost.gitLine.includes('readable') && !lost.entries[0].branch, lost.gitLine);
  execFileSync('git', ['-C', tree, 'checkout', '-q', '-b', 'elsewhere']);
  const off = (await lf.checkSnapshotAsync(e)).problems.join('; ');
  assert.ok(off.includes(tree) && off.includes('elsewhere'), off);
});

test('the worktrees and merged branches are grouped and named at the write; the write removes only merged, clean agent ones', async () => {
  const dir = tempDir('askerdo-loose-');
  const rp = repo();
  const wt = (name) => rp.dir + '/.claude/worktrees/' + name;
  const inWt = (name, ...args) => execFileSync('git', ['-C', wt(name), ...args], { encoding: 'utf8' });
  for (const name of ['done', 'ahead', 'notes', 'running']) rp.git('worktree', 'add', '-q', wt(name), '-b', (name === 'done' ? 'worktree-agent-' : 'w-') + name);
  writeFileSync(join(wt('done'), 'c.txt'), 'c\n');
  inWt('done', 'add', 'c.txt');
  inWt('done', 'commit', '-q', '-m', 'done work');
  rp.git('merge', '-q', '--ff-only', 'worktree-agent-done');
  writeFileSync(join(wt('ahead'), 'd.txt'), 'd\n');
  inWt('ahead', 'add', 'd.txt');
  inWt('ahead', 'commit', '-q', '-m', 'unmerged work');
  writeFileSync(join(wt('notes'), 'notes.md'), 'n\n');
  rp.git('worktree', 'lock', wt('running'), '--reason', 'an agent runs here');
  rp.git('branch', 'old-lane');
  rp.put('stray.log', 'stray');
  const w = await handOff(dir, rp.dir, [{ path: 'stray.log', disposition: 'delete' }], new Date());
  const e = w.entries[0];
  const s = e.snapshot.worktrees;
  assert.deepEqual(s.merged.map((m) => m.path), ['.claude/worktrees/done']);
  assert.deepEqual(s.holding.map((h) => [h.path, h.ahead || 0, h.untracked]), [['.claude/worktrees/ahead', 1, 0], ['.claude/worktrees/notes', 0, 1]]);
  assert.deepEqual(s.branches, ['old-lane'], 'the checkout\'s branch and those checked out in a worktree are not in it');
  assert.equal(s.left.locked, 1, 'a locked worktree is never proposed');
  assert.deepEqual(e.files.map((f) => f.path), ['stray.log'], 'a worktree inside the checkout is no loose file');
  assert.deepEqual(e.worktrees.map((d) => [d.group || d.path, d.disposition]), [
    ['merged', 'remove'], ['.claude/worktrees/ahead', 'undecided'], ['.claude/worktrees/notes', 'undecided'], ['branches', 'remove'],
  ]);
  const day = dayOf(new Date());
  const lines = w.worktreeLines.join('\n');
  for (const p of ['done', 'ahead', 'notes']) assert.ok(lines.includes('.claude/worktrees/' + p), p);
  assert.ok(lines.includes('old-lane') && !lines.includes('running'));
  assert.match(lines, /ahead \([^)]*due\)[\s\S]*notes \([^)]*due\)/, 'each worktree holding work is named at the write, for its reply to ask');
  assert.deepEqual(lf.keptKickoff(w.entries, day), [], 'nothing kept, so the resume says nothing');
  /* the Tracks tile counts what the kickoff asks about: the proposed file, each group once, each worktree holding work */
  assert.deepEqual([lf.dueFiles(w.entries, day).length, lf.dueWorktrees(w.entries, day).map((d) => d.group || d.path)],
    [1, ['merged', '.claude/worktrees/ahead', '.claude/worktrees/notes', 'branches']]);
  /* the local server's count, its checks off the loop, is the same */
  const later = await lf.dueLater(w.entries, day);
  assert.deepEqual([later.files.length, later.worktrees.map((d) => d.group || d.path)], [1, ['merged', '.claude/worktrees/ahead', '.claude/worktrees/notes', 'branches']]);
  /* a kept group carries to the next handoff and is not due before its review day */
  const w2 = await handOff(dir, rp.dir, null, new Date(), [{ group: 'merged', disposition: 'keep', reason: 'the user looks Friday' }]);
  const w3 = await handOff(dir, rp.dir, null, new Date());
  const kept = w3.entries[0].worktrees.find((d) => d.group === 'merged');
  assert.equal(kept.disposition, 'keep');
  assert.equal(kept.review, w2.entries[0].worktrees[0].review);
  assert.ok(!lf.worktreeDue(kept, day) && lf.worktreeDue(kept, kept.review));
  assert.ok(!w3.worktreeLines.join('\n').includes('merged and clean') && w3.worktreeLines.join('\n').includes('old-lane'), 'the write names only what is due');
  assert.match(lf.keptKickoff(w3.entries, day)[0], /merged worktrees \(the user looks Friday\)/);
  /* the merged, clean agent worktree goes with its branch, and a merged agent branch; unmerged, dirty and locked ones stay */
  rp.git('branch', 'worktree-agent-old');
  const plan = await lf.agentRemovals(rp.dir);
  assert.deepEqual([plan.trees.map((t) => t.path), plan.branches], [['.claude/worktrees/done'], ['worktree-agent-old']]);
  /* the snapshot leaves out what the write removes after the board write */
  const skipped = (await lf.snapshotRepoAsync(rp.dir, { skip: plan })).worktrees;
  assert.deepEqual([skipped.merged, skipped.branches], [[], ['old-lane']]);
  /* past its start time nothing is removed and each is left for the next write; then the removal runs */
  const late = await lf.removeAgentPlans([plan], { startBy: Date.now() - 1 });
  assert.deepEqual(late.map((x) => [x.path || x.branch, x.left || 'removed']), [['.claude/worktrees/done', 'next'], ['worktree-agent-old', 'removed']]);
  assert.match((await import('../lib/mod-core.mjs')).removedLine(late), /Left for the next handoff write to remove[^:]*: \.claude\/worktrees\/done/);
  /* a merged, clean worktree no agent made (a session's merge worktree) is not the write's to remove */
  rp.git('worktree', 'add', '-q', wt('merge'), '-b', 'keep-merge');
  const rm = await lf.removeAgentPlans([await lf.agentRemovals(rp.dir)]);
  assert.deepEqual(rm.map(({ repo, ...x }) => x), [{ path: '.claude/worktrees/done', branch: 'worktree-agent-done' }]);
  assert.deepEqual(['done', 'ahead', 'notes', 'running', 'merge'].map((n) => existsSync(wt(n))), [false, true, true, true, true]);
  assert.ok(rp.git('branch', '--list', 'old-lane'), 'a branch no agent made stays for the ask');
  /* a stub branch whose agent worktree still stands on another branch is that lane's, and a kept branches group deletes none */
  rp.git('branch', 'worktree-agent-spare');
  rp.git('branch', 'worktree-agent-lane');
  rp.git('worktree', 'add', '-q', wt('agent-lane'), '-b', 'tr-lane');
  const plan2 = await lf.agentRemovals(rp.dir);
  assert.deepEqual(plan2.branches, ['worktree-agent-spare']);
  const keptRm = await lf.removeAgentPlans([lf.keptPlan(plan2, [{ group: 'branches', disposition: 'keep', reason: 'other lanes run here' }], [])]);
  assert.deepEqual(keptRm.map((x) => [x.branch, x.left]), [['worktree-agent-spare', 'kept']]);
  assert.ok(rp.git('branch', '--list', 'worktree-agent-spare') && rp.git('branch', '--list', 'worktree-agent-lane'));
  assert.match((await import('../lib/mod-core.mjs')).removedLine(keptRm), /worktree-agent-spare[^.]*other lanes run here/);
  /* a write naming a folder inside the repo removes and groups nothing of it; one naming its top removes as before */
  const call = async (verb) => (verb === 'trackHandoffs' ? { handoffs: [] } : { id: 'TR-1.1', key: 'k', track: 'TR-1' });
  const write = (path) => pc.writeTrackHandoff('TR-1', { focus: 'f', state: 's', verifyFirst: [{ path }] }, { dir, pc: 'pc1', call, cwd: rp.dir });
  rp.put('sub/x.txt', 'x\n');
  const inner = await write(rp.dir + '/sub');
  assert.ok(!inner.removed && !inner.worktreeLines, JSON.stringify(inner.removed || inner.worktreeLines));
  assert.ok(rp.git('branch', '--list', 'worktree-agent-spare'));
  const outer = await write(rp.dir);
  assert.ok(outer.removed.some((x) => x.branch === 'worktree-agent-spare') && !rp.git('branch', '--list', 'worktree-agent-spare'));
});

test('dispositions: the payload\'s are kept here, a file left out is undecided with what was seen, and the kickoff names only what is kept, asking nothing', async () => {
  const dir = tempDir('askerdo-loose-');
  const rp = repo();
  rp.put('notes.md', 'first line\nsecond line\n');
  rp.put('run.log', 'x\n');
  rp.put('scratch/a.txt', 'a\n');
  rp.put('new.mjs', 'export {};\n');
  rp.put('mystery.bin', 'abc');
  const w = await handOff(dir, rp.dir, [
    { path: 'notes.md', disposition: 'keep', reason: 'the user reads it Monday' },
    { path: 'scratch', disposition: 'delete' },
    { path: 'new.mjs', disposition: 'commit' },
    { path: 'gone.txt', disposition: 'ignore' },
  ], atDay(0));
  const files = w.entries[0].files;
  assert.deepEqual(files.map((f) => [f.path, f.disposition]), [
    ['mystery.bin', 'undecided'], ['new.mjs', 'commit'], ['notes.md', 'keep'], ['run.log', 'undecided'], ['scratch/', 'delete'],
  ]);
  assert.equal(files.find((f) => f.path === 'notes.md').review, '2026-10-26', 'a kept file is reviewed in 7 days by default');
  const log = files.find((f) => f.path === 'run.log');
  assert.equal(log.suggest, 'delete');
  assert.match(log.note, /^run\.log: 2 bytes, .*"x"$/);
  assert.deepEqual(w.undecided.map((u) => u.path), ['mystery.bin', 'run.log'], 'the write names what it left undecided');
  assert.deepEqual(w.unmatched, [rp.dir + ': gone.txt']);
  assert.equal(w.due.find((f) => f.path === 'scratch/').count, '1', 'a proposed delete carries the count it removes');
  /* a resume asks nothing; its one line names what is kept and why */
  const lines = lf.keptKickoff(w.entries, '2026-10-19');
  assert.equal(lines.length, 1);
  assert.ok(lines[0].includes('notes.md (the user reads it Monday)') && !/mystery|new\.mjs|ask tool/.test(lines[0]));
  const kept = lf.readKept(dir, rp.dir);
  assert.deepEqual(kept.map((k) => [k.path, k.disposition, k.review]), [
    ['mystery.bin', 'undecided', '2026-10-26'], ['new.mjs', 'commit', '2026-10-19'], ['notes.md', 'keep', '2026-10-26'],
    ['run.log', 'undecided', '2026-10-26'], ['scratch/', 'delete', '2026-10-19'],
  ]);
  assert.equal(kept[2].reason, 'the user reads it Monday');
  assert.equal(kept[4].suggest, 'delete');
  /* the next handoff carries the kept decisions and keeps the review date */
  const w2 = await handOff(dir, rp.dir, [{ path: 'notes.md', disposition: 'keep', reason: 'still' }], atDay(2));
  const next = Object.fromEntries(w2.entries[0].files.map((f) => [f.path, f]));
  assert.equal(next['notes.md'].review, '2026-10-26');
  assert.equal(next['mystery.bin'].disposition, 'undecided');
  assert.equal(next['new.mjs'].disposition, 'commit', 'a proposal carries until answered');
  /* past its review day the kept file is marked for the next handoff to ask about; a file gone since is left out */
  rmSync(join(rp.dir, 'run.log'));
  const due = lf.keptKickoff(w2.entries, '2026-10-26')[0];
  assert.match(due, /notes\.md \(still; [^)]*next handoff/);
  assert.equal(lf.dueFiles(w2.entries, '2026-10-26').length, 4, 'the pane counts the same');
  /* a handoff past the review day names the due keep and the proposals, carried with their reasons; kept again, it takes a new date */
  const w3 = await handOff(dir, rp.dir, null, atDay(8));
  assert.deepEqual(w3.due.map((f) => [f.path, f.disposition, f.reason || '']), [['new.mjs', 'commit', ''], ['notes.md', 'keep', 'still'], ['scratch/', 'delete', '']]);
  const w4 = await handOff(dir, rp.dir, [{ path: 'notes.md', disposition: 'keep', reason: 'still' }], atDay(8));
  assert.equal(w4.entries[0].files.find((f) => f.path === 'notes.md').review, '2026-11-03');
  assert.ok(!w4.due.some((f) => f.path === 'notes.md'), 'kept again, it is not due');
});

test('dispositions are refused when malformed', () => {
  const bad = (files, re) => assert.throws(() => pc.validateHandoffPayload({ focus: 'f', state: 's', verifyFirst: [{ path: 'C:/repo', files }] }), re);
  bad([{ path: 'x', disposition: 'keep' }], /reason/);
  bad([{ path: 'x', disposition: 'burn' }], /disposition/);
  bad([{ path: 'x', disposition: 'delete', review: '2026-11-01' }], /review/);
  bad([{ path: 'x', disposition: 'keep', reason: 'r', review: 'soon' }], /review/);
  bad([{ path: 'x', disposition: 'keep', reason: 'r', suggest: 'keep' }], /suggest/);
  bad([{ path: 'x', disposition: 'undecided' }, { path: './x', disposition: 'undecided' }], /twice/);
  bad([{ path: 'x', disposition: 'undecided', snapshot: 1 }], /snapshot/);
});

test('a snapshot cut at its cap does not stop the leg on the dirty files it left out', async () => {
  const rp = repo();
  for (let i = 0; i <= 200; i++) rp.put('many/f' + i + '.txt', 'v1\n');
  rp.git('add', 'many');
  rp.git('commit', '-q', '-m', 'many');
  for (let i = 0; i <= 200; i++) rp.put('many/f' + i + '.txt', 'v2\n');
  const snap = await lf.snapshotRepoAsync(rp.dir);
  assert.equal(snap.cut, true);
  assert.deepEqual((await lf.checkSnapshotAsync({ path: rp.dir, branch: 'main', snapshot: snap })).problems, []);
});

test('the mod: handoff_write takes each repo\'s files, the result names what was left', async () => {
  const mc = await import('../lib/mod-core.mjs');
  const base = { focus: 'f', goal: 'g', state: 's', verifyFirst: [{ path: 'C:/src/repo', files: [{ path: 'a.md', disposition: 'keep', reason: 'r' }] }] };
  assert.ok(mc.validateHandoff(base).payload);
  assert.match(mc.validateHandoff({ ...base, verifyFirst: [{ path: 'C:/src/repo', files: [{ path: 'a.md', disposition: 'burn' }] }] }).error,
    /verifyFirst\[0\]\.files is a list of \{ path, disposition \}/);
  assert.match(mc.handoffPrompt('TH-1'), /then a quick look at the file, then one agent when about five or more are still unknown/);
  assert.match(mc.handoffFilesNote({ undecided: [{ path: 'x.bin' }] }), /x\.bin/);
  assert.equal(mc.handoffFilesNote({}), '');
  /* the write lists what it removed and its reply asks about the rest; an update does not ask again */
  const left = { undecided: [{ path: 'x.bin' }], removed: [{ path: '.claude/worktrees/a', branch: 'worktree-agent-a' }] };
  assert.match(mc.handoffFilesNote(left, true), /\.claude\/worktrees\/a[\s\S]*x\.bin[\s\S]*ask tool/);
  assert.doesNotMatch(mc.handoffFilesNote(left), /ask tool/);
});
