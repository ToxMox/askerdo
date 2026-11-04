/* Loose files and the gentler repo check, this PC's half: a track
 * handoff's snapshot and stop rules, dispositions kept in the data dir and
 * printed, and the due ones the next kickoff lists. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fixtureCopy, tempDir } from './helpers/sandbox.mjs';

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
async function handOff(dir, path, files, at) {
  const p = pc.validateHandoffPayload({ focus: 'Go on.', state: 'Work.', verifyFirst: [{ path, ...(files ? { files } : {}) }] });
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
});

test('dispositions: the payload\'s are kept here, a file left out is undecided with what was seen, and the kickoff names undecided then due first', async () => {
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
  const lines = lf.filesKickoff(w.entries, '2026-10-19');
  assert.match(lines[0], /mystery\.bin.*run\.log.*new\.mjs.*due.*scratch\/.*due/, 'undecided first, then the proposals, due at once');
  assert.match(lines[1], /ask tool/, 'K-651: the session asks in its own reply');
  assert.ok(lines[2].includes('notes.md') && !lines[0].includes('notes.md'), 'a kept file is not due yet');
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
  /* past its review day the kept file is listed to judge, marked due; a file gone since is left out */
  rmSync(join(rp.dir, 'run.log'));
  const due = lf.filesKickoff(w2.entries, '2026-10-26')[0];
  assert.match(due, /notes\.md \([^)]*due\)/);
  assert.ok(!due.includes('run.log'));
  assert.equal(lf.dueFiles(w2.entries, '2026-10-26').length, 4, 'the pane counts the same');
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
  const base = { focus: 'f', state: 's', verifyFirst: [{ path: 'C:/src/repo', files: [{ path: 'a.md', disposition: 'keep', reason: 'r' }] }] };
  assert.ok(mc.validateHandoff(base).payload);
  assert.match(mc.validateHandoff({ ...base, verifyFirst: [{ path: 'C:/src/repo', files: [{ path: 'a.md', disposition: 'burn' }] }] }).error,
    /verifyFirst\[0\]\.files is a list of \{ path, disposition \}/);
  assert.match(mc.handoffPrompt('TH-1'), /then a quick look at the file, then one Sonnet agent when about five or more are still unknown/);
  assert.match(mc.handoffFilesNote({ undecided: [{ path: 'x.bin' }] }), /x\.bin/);
  assert.equal(mc.handoffFilesNote({}), '');
});
