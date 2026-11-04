/* Handoffs, resume and the kickoff on tracks, through boardCall
   on memory:, one behaviour per test. memory: is one database per process, so
   each test makes its own workstream and its own session names. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { childEnv, tempDir } from './helpers/sandbox.mjs';
import { cliRoute, runCli } from './helpers/cli.mjs';

process.removeAllListeners('warning');
process.env.ASKERDO_SANDBOX_HOME = tempDir('askerdo-handoffs-');
process.env.ASKERDO_BOARD_URL = 'memory:';
const { boardCall } = await import('../lib/board-call.mjs');
const pc = await import('../lib/tracks-session.mjs');
const { dataDir } = await import('../lib/node-helpers.mjs');
const { growthLine } = await import('../server/verbs/outcomes.mjs');
const { kickoffText } = await import('../server/verbs/kickoff.mjs');
const { proseOrder } = await import('../lib/handoff-payload.mjs');
const { entryDrift, forgetInMap, learnProjects, readMap, scanProjects } = await import('../lib/project-map.mjs');

let n = 0;
async function line(session, goal) {
  n += 1;
  const ws = await boardCall('createRecord', { kind: 'workstream', name: 'Handoffs ' + n, description: 'One line of work.' });
  return { ...(await boardCall('newTrack', { name: 'Line ' + n, workstream: ws.id, session, goal }, { session, pc: 'pc1' })), ws: ws.id };
}
const handoff = (track, session, over = {}) => boardCall('writeHandoff',
  { track, focus: 'Go on.', state: 'The state of ' + track + '.', verify: [{ path: 'C:/repo' }], session, ...over }, { session, pc: 'pc1' });
const resume = (track, session, over = {}) => boardCall('resumeTrack', { track, session, ...over }, { session, pc: 'pc1' });
const shelfRow = async (track) => (await boardCall('shelf', {})).rows.find((r) => r.track === track);

test('a handoff lets the lease go and the track waits; parked, its handoff parks too; resume takes it back with the kickoff and the tasks in hand', async () => {
  const tr = await line('a1', 'Ship the line.');
  const wsName = 'Handoffs ' + n;
  await assert.rejects(boardCall('parkTrack', { track: tr.id, reason: 'not mine' }, { session: 'a9' }), /held by a session on pc1/, 'a live lease parks only by its holder');
  for (const name of ['first', 'second']) await boardCall('capture', { track: tr.id, name });
  const first = (await boardCall('trackView', { track: tr.id })).tasks[0];
  await boardCall('taskUpdate', { id: first.id, status: 'completed' });
  const tasks = [];
  for (const name of ['wire', 'test', 'ship']) tasks.push((await boardCall('createRecord', { kind: 'task', name, description: 'd' })).id);
  /* a ruling made before the leg began stays out of the kickoff, one made since is listed; the held track fills the links */
  const ruling = (title, opts = {}) => boardCall('decide', { title, tasks: [tasks[0]], projects: ['C:/repo'] }, { session: 'a1', ...opts });
  const before = await ruling('Cards first', { now: new Date(Date.now() - 3600e3) });
  const since = await ruling('Rows first');
  assert.deepEqual(since.tracks, [tr.id]);
  const took = [];
  for (const id of tasks) took.push(await boardCall('taskUpdate', { id, inHand: true }, { session: 'a1' }));
  /* taking a task in hand hands over its rulings */
  assert.deepEqual(took[0].decisions.map((d) => d.id), [since.id, before.id]);
  /* the waiting lines go by waitingOnUser in, stored and out */
  const h = await handoff(tr.id, 'a1', { waitingOnUser: ['the deploy key'] });
  assert.equal(h.released, true);
  /* the handoff carries every task in hand; another session takes one meanwhile */
  assert.deepEqual([...h.inHand].sort(), [...tasks].sort());
  assert.deepEqual(await boardCall('heldTask', { session: 'a1' }), []);
  await boardCall('taskUpdate', { id: tasks[2], inHand: true }, { session: 'a3' });
  assert.equal((await boardCall('trackSummary', { track: tr.id })).state, 'waiting');

  await boardCall('parkTrack', { track: tr.id, reason: 'waits on the API lane' });
  const parked = await boardCall('readHandoff', { id: h.id });
  assert.deepEqual([parked.status, parked.parkReason], ['parked', 'waits on the API lane'], 'the handoff parks with its track');
  const row = await shelfRow(tr.id);
  assert.deepEqual([row.state, row.handoffStatus], ['parked', 'parked'], 'the shelf reads the same');
  /* the Tracks tab's tile names the workstream, says the goal and draws the bar */
  assert.deepEqual([row.workstreamName, row.goal, row.done, row.total], [wsName, 'Ship the line.', 1, 2]);

  /* talk after the handoff patches it in place, keeping its id; a section named again is replaced */
  const patch = (id, ops) => boardCall('updateHandoff', { id, ops }, { session: 'a1', pc: 'pc1' });
  await patch(tr.id, [{ op: 'state', heading: '## Tests', text: 'All pass.' }]);
  const up = await patch(h.id, [{ op: 'state', heading: '## Tests', text: 'One fails.' }, { op: 'waitingOnUser', add: 'a second key' }]);
  assert.deepEqual([up.waitingOnUser, Object.keys(up.changed)], [['the deploy key', 'a second key'], ['state', 'waitingOnUser']]);
  assert.deepEqual([up.id, up.status, up.state.split('## Tests').length], [h.id, 'parked', 2]);
  assert.ok(up.state.startsWith('The state of ' + tr.id) && up.state.includes('One fails.') && !up.state.includes('All pass.'), up.state);

  /* the kickoff waits on the track's own questions and a trackless one on its workstream, never another track's */
  const other = await boardCall('newTrack', { name: 'Side line', workstream: tr.ws, session: 'a8' }, { session: 'a8', pc: 'pc1' });
  const ask = (name, scope) => boardCall('register', { name, gist: 'g', blocking: false, ask: 'One (a, my pick) or two (b)?', pick: 'a',
    options: ['a', 'b'].map((type) => ({ type, option: type, getsYou: 'x', costsYou: '' })), workstream: tr.ws, session: 'a9', projectDir: 'C:/repo', ...scope });
  const asked = [await ask('ours', { track: tr.id }), await ask('theirs', { track: other.id }), await ask('unplaced', {})];
  const r = await resume(tr.id, 'a2');
  assert.deepEqual([r.acquired, r.state], [true, 'active']);
  const waiting = r.kickoff.split('\n').find((l) => l.startsWith('Waiting on the user: ')) || '';
  assert.deepEqual(asked.map((q) => waiting.includes(' ' + q.id + ' ')), [true, false, true], waiting);
  assert.equal((await boardCall('readHandoff', { id: h.id })).status, 'resumed');
  assert.ok(r.kickoff.includes('The state of ' + tr.id + '.'), 'the kickoff carries the handoff');
  assert.deepEqual((await boardCall('heldTask', { session: 'a2' })).map((t) => t.id).sort(), tasks.slice(0, 2).sort());
  assert.match(r.kickoff, new RegExp(tasks[2] + ' stays'), 'the one taken meanwhile stays, and the kickoff says so');
  const has = (id) => new RegExp('^- ' + id + ' ', 'm').test(r.kickoff);
  assert.deepEqual([has(since.id), has(before.id)], [true, false], r.kickoff);
  /* the head says when the leg began and a ruling its local time, its clock alone on that day */
  const head = r.kickoff.split('\n').find((l) => l.startsWith('Decisions since'));
  const made = r.kickoff.split('\n').find((l) => l.startsWith('- ' + since.id + ' '));
  assert.ok(/\d:\d\d/.test(head) && /\(\d{1,2}:\d\d\)$/.test(made), head + ' / ' + made);
  await assert.rejects(patch(tr.id, [{ op: 'whereWeWere', line: 'One more thing.' }]),
    (e) => /a session on (this PC|pc1)/.test(e.message) && e.message.includes('note ' + tr.id), 'after the resume the update names the holder and the note');
});

test('resuming a track another session holds returns the holder and the three moves, and moves only when asked', async () => {
  const tr = await line('b1');
  const r = await resume(tr.id, 'b2');
  assert.equal(r.acquired, false);
  assert.equal(r.holder.session, 'b1');
  assert.deepEqual([...r.moves].sort(), ['read only', 'splinter', 'take over']);
  assert.equal((await boardCall('trackView', { track: tr.id })).holder.session, 'b1', 'asking changed nothing');

  const over = await resume(tr.id, 'b2', { move: 'take over' });
  assert.equal(over.takenOverFrom.session, 'b1');
});

test('a track let go with no handoff reads waiting and its kickoff says there is no handoff yet', async () => {
  const tr = await line('c1');
  await boardCall('releaseLease', { session: 'c1' }, { session: 'c1' });
  const row = await shelfRow(tr.id);
  assert.deepEqual([row.state, row.noHandoff], ['waiting', true]);
  assert.match((await boardCall('trackKickoff', { track: tr.id })).kickoff, /no handoff yet/i);

  const r = await resume(tr.id, 'c1');
  assert.deepEqual([r.acquired, r.noHandoff], [true, true]);
  assert.match(r.kickoff, /no handoff yet/i);

  /* track show words the asking session's own running task as this session's */
  await boardCall('capture', { track: tr.id, name: 'mine' });
  const mine = (await boardCall('trackView', { track: tr.id })).tasks[0];
  await boardCall('taskUpdate', { id: mine.id, inHand: true, status: 'in_progress' }, { session: 'c1' });
  const nowOf = async (s) => (await boardCall('trackKickoff', { track: tr.id, session: s })).kickoff.split('\n').find((l) => l.startsWith('Now: '));
  const [own, other] = [await nowOf('c1'), await nowOf('c9')];
  assert.ok(own.includes(mine.id) && own.includes('this session') && !other.includes('this session'), own + ' / ' + other);
});

test('a backdated handoff is history on the shelf until a session takes the track and lets it go', async () => {
  const ws = await boardCall('createRecord', { kind: 'workstream', name: 'Imported line', description: 'From an old system.' });
  const tr = await boardCall('newTrack', { name: 'Old line', workstream: ws.id });
  await boardCall('writeHandoff', { track: tr.id, focus: 'From the old system.', state: 'Old.', verify: [{ path: 'C:/repo' }], created: '2026-03-02T10:00:00-05:00' });
  assert.equal((await shelfRow(tr.id)).history, true);
  await resume(tr.id, 'h1');
  await boardCall('releaseLease', { session: 'h1' }, { session: 'h1' });
  const row = await shelfRow(tr.id);
  assert.deepEqual([row.state, row.history], ['waiting', undefined], 'a let-go turns it waiting again, announced');
});

test('the kickoff lists the ready set and the critical path from the tables, never from the handoff prose', async () => {
  const tr = await line('d1');
  const task = (name) => boardCall('capture', { track: tr.id, name }, { session: 'd1' });
  const a = await task('Parse the input');
  const b = await task('Check the parse');
  const c = await task('Write the docs');
  const d = await task('Ship it');
  await boardCall('addEdge', { task: b.id, on: a.id, reason: 'checks the parse' });
  await boardCall('addEdge', { task: d.id, on: b.id, reason: 'ships what was checked' });
  const h = await handoff(tr.id, 'd1', { state: 'Next is ' + a.id + ', then T-9999 Rewrite the parser.' });
  /* the stray task nothing waits on is named, the longest chain's end is not */
  assert.deepEqual(h.leaves.map((x) => x.id), [c.id]);
  /* a finishes after the handoff: the tables move on, the prose does not */
  await boardCall('editRecord', { id: a.id, status: 'completed' });

  const k = (await resume(tr.id, 'd2')).kickoff;
  const head = k.slice(0, k.indexOf('Next is '));
  const lineOf = (word) => head.split('\n').find((l) => new RegExp('^' + word, 'i').test(l)) || '';
  const has = (l, id) => new RegExp('\\b' + id + '\\b').test(l);
  const ready = lineOf('ready');
  assert.ok(has(ready, b.id) && has(ready, c.id) && !has(ready, a.id), ready);
  const critical = lineOf('longest chain');
  assert.ok(has(critical, b.id) && has(critical, d.id) && !has(critical, c.id), critical);
  assert.ok(!head.includes('T-9999'), 'nothing above the handoff text comes from its prose');

  /* the holder's kickoff lists the inbox of a sibling workstream in the project, never another project's */
  const ws = (name, repo) => boardCall('createRecord', { kind: 'workstream', name, description: 'One line of work.', projectRepos: [repo] });
  const [home, sibling, other] = [await ws('Kickoff home', 'example.com/kick'), await ws('Kickoff sibling', 'example.com/kick'), await ws('Kickoff other', 'example.com/other')];
  const held = await boardCall('newTrack', { name: 'Inbox line', workstream: home.id, session: 'd3' }, { session: 'd3', pc: 'pc1' });
  const filed = await boardCall('capture', { workstream: sibling.id, name: 'Filed in the sibling' });
  const away = await boardCall('capture', { workstream: other.id, name: 'Filed in another project' });
  const own = (await resume(held.id, 'd3')).kickoff;
  assert.ok(has(own, filed.id) && !has(own, away.id), own);
  /* the handoff write returns the same set */
  const wrote = await handoff(held.id, 'd3');
  assert.deepEqual(wrote.inbox.map((x) => x.id), [filed.id]);
});

test('a handoff lays its leftovers out on the track with their edges, each naming who runs it; a Next list in the state is refused before anything is written', async () => {
  const tr = await line('g1');
  const h = await handoff(tr.id, 'g1', { leftovers: [{ name: 'Review the wave', runBy: 'agent:opus' }, { name: 'Fix what it finds', after: [1], runBy: 'fork' }] });
  const [review, fixes] = h.laidOut;
  assert.deepEqual([review.edges, fixes.edges.map((e) => e.on)], [[], [review.id]]);
  const kickoff = (await resume(tr.id, 'g2')).kickoff.split('\n');
  const ready = kickoff.find((l) => /^ready/i.test(l));
  const has = (id) => new RegExp('\\b' + id + '\\b').test(ready);
  assert.ok(has(review.id) && !has(fixes.id), ready);
  /* the kickoff says who runs each step, in the ready set and the rest of the order */
  assert.match(ready, /opus/i);
  assert.match(kickoff.find((l) => l.startsWith('- ' + fixes.id + ' ')) || '', /fork/);

  const state = 'The lanes landed.\n\nNext steps:\n1. Review the wave\n2. Fix what it finds';
  await assert.rejects(pc.writeTrackHandoff(tr.id, { focus: 'Go on.', state, session: 'g2', verifyFirst: [{ path: 'C:/repo' }] }, { pc: 'pc1' }),
    (e) => /leftovers/.test(e.message) && e.message.includes('Fix what it finds'));
  /* a lead-in line before the list is still an order; a step's sub-bullets are not steps */
  assert.equal(proseOrder('## Next\n\nIn this order:\n1. Review the wave\n2. Fix what it finds', 'state').length, 1);
  assert.deepEqual(proseOrder('## Next\n1. Review the wave\n   - check the band\n   - check the CLI', 'state'), []);

  /* a leftover the board refuses names its step and writes nothing, so the session fixes it and sends again */
  await assert.rejects(handoff(tr.id, 'g2', { leftovers: [{ name: 'Ship it', runBy: 'orchestrator' }, { name: 'Tell the user', after: [1, 'T-99999'], runBy: 'orchestrator' }] }),
    (e) => /step 2/.test(e.message) && /T-99999/.test(e.message) && /nothing/.test(e.message));
  await assert.rejects(handoff(tr.id, 'g2', { leftovers: [{ name: 'Ship it', runBy: 'orchestrator' }, { name: 'Tell the user' }] }),
    (e) => /step 2/.test(e.message) && /runBy/.test(e.message), 'a leftover naming nobody to run it is refused');
  assert.equal((await boardCall('trackHandoffs', { track: tr.id })).handoffs.length, 1, 'only the first handoff is on the board');
  assert.ok(!(await boardCall('trackView', { track: tr.id })).tasks.some((t) => t.name === 'Ship it'), 'no leftover was laid out');
});

test('a handoff written through the launcher keeps its loose-file lists on the PC; the board gets each repo summary and no question', async () => {
  const repo = tempDir('askerdo-handoffs-');
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  for (const [k, v] of [['user.email', 't@example.com'], ['user.name', 't'], ['commit.gpgsign', 'false'], ['core.autocrlf', 'false']]) git('config', k, v);
  writeFileSync(join(repo, 'a.txt'), 'a\n');
  git('add', 'a.txt');
  git('commit', '-q', '-m', 'one');
  writeFileSync(join(repo, 'notes.txt'), 'loose\n');
  writeFileSync(join(repo, 'what.txt'), 'hm\n');
  /* a folder other work owns is no loose file of this handoff */
  mkdirSync(join(repo, 'theirs'));
  writeFileSync(join(repo, 'theirs', 'x.md'), 'x\n');
  const owned = { ownedByOthers: ['theirs/'] };
  /* the CLI as a session calls it, through this PC's local server */
  const env = childEnv({ ASKERDO_ROOT: join(tempDir('askerdo-handoffs-'), 'store'), ASKERDO_SANDBOX_HOME: process.env.ASKERDO_SANDBOX_HOME });
  const dir = dataDir(env);
  const route = await cliRoute(env.ASKERDO_ROOT, env);

  const tr = await line('e1');
  const ids = [];
  for (const name of ['Write the code', 'Write the docs']) ids.push((await boardCall('capture', { track: tr.id, name }, { session: 'e1' })).id);
  const asked = async () => (await boardCall('list', {})).length + (await boardCall('list', { snoozed: true })).length;
  const before = await asked();
  let h;
  try {
    const input = JSON.stringify({ focus: 'Go on.', state: 'Work.', session: 'e1', verifyFirst: [{ path: repo, files: [{ path: 'notes.txt', disposition: 'commit' }], ...owned }] });
    const w = await runCli(['handoff', 'write', tr.id, '--json'], { env, input });
    assert.equal(w.code, 0, w.err);
    h = JSON.parse(w.out);
    assert.ok(route.answered.length && route.answered.every((a) => a.status === 200), 'the local server ran it');
    /* the leaves ask names this sandbox's launcher, never the live one, and its command runs as printed */
    const launcher = pc.launcherHere(env);
    const cmd = (h.leavesLine.match(/`([^`]+)`/) || [])[1] || '';
    assert.ok(cmd.startsWith(launcher + ' edge add '), cmd);
    const leaf = h.leaves[0].id;
    const later = ids.find((id) => id !== leaf);
    const argv = cmd.slice(launcher.length).replace('<the later task>', later).replace('<this one>', leaf).replace('<why>', 'the docs follow the code')
      .match(/"[^"]*"|\S+/g).map((a) => a.replace(/^"|"$/g, ''));
    /* with no reason the CLI refuses before the call and names the flag */
    const bare = argv.slice(0, argv.indexOf('--reason'));
    const no = await runCli(bare, { env });
    assert.ok(no.code !== 0 && no.err.includes('--reason'), no.err);
    const e = await runCli(argv, { env });
    assert.equal(e.code, 0, e.err);
    assert.ok((await boardCall('trackView', { track: tr.id })).edges.some((x) => x.task === later && x.on === leaf), 'the edge landed');
  } finally { await route.close(); }
  const v = (await boardCall('readHandoff', { id: h.id })).verify[0];
  assert.equal(v.commit, git('rev-parse', 'HEAD'));
  assert.ok(!('files' in v) && !('snapshot' in v), 'the board holds the summary alone');
  const kept = pc.readKept(dir, h.id, h.key);
  assert.ok(kept.repos[0].snapshot && kept.repos[0].files.some((f) => f.path.endsWith('notes.txt')), 'the lists are kept here');
  assert.deepEqual(h.undecided.map((u) => u.path), ['what.txt'], 'the write names a file given no disposition');
  /* a proposal is due at once, and still no question: the next kickoff lists it */
  assert.equal(await asked(), before);

  /* the next handoff counts the repo's growth since this one, and the kickoff prints it */
  writeFileSync(join(repo, 'b.test.mjs'), "test('one', () => {});\ntest('two', () => {});\n");
  git('add', 'b.test.mjs', 'theirs/x.md');
  git('commit', '-q', '-m', 'two');
  /* the folder named without its slash is owned on the resume's checks too */
  const next = await pc.writeTrackHandoff(tr.id, { focus: 'Go on.', state: 'More work.', session: 'e1', verifyFirst: [{ path: repo, ownedByOthers: ['theirs'] }] }, { dir, pc: 'pc1' });
  const grown = (await boardCall('readHandoff', { id: next.id })).growth;
  assert.deepEqual([grown.since, grown.repos, grown.testsAdded], [h.id, 1, 2], 'the stored handoff carries the growth since the last one');

  writeFileSync(join(repo, 'a.txt'), 'changed\n');
  writeFileSync(join(repo, 'later.tmp'), 't\n');
  writeFileSync(join(repo, 'theirs', 'x.md'), 'theirs changed\n');
  const r = await pc.resumeTrackSession(tr.id, { session: 'e2' }, { dir, pc: 'pc1' });
  assert.deepEqual([r.verify.lists, r.verify.ok], ['here', false], 'a tracked file changed since the handoff');
  assert.deepEqual(r.verify.repos[0].problems.filter((p) => p.includes('theirs')), [], 'owned work is not a change to check');
  assert.match(r.verify.report, /later\.tmp/, 'the leg names a file new since the handoff');
  assert.ok(r.kickoff.includes(growthLine(grown)), 'the kickoff prints the growth line');
  const theirs = r.kickoff.split('\n').filter((l) => l.includes('theirs'));
  assert.ok(theirs.length === 1 && /owned/i.test(theirs[0]) && !/undecided/i.test(theirs[0]), 'the kickoff names owned work apart: ' + theirs);

  await assert.rejects(boardCall('writeHandoff', { track: tr.id, focus: 'x', state: 'y', verify: [{ path: repo, files: [] }] }),
    (e) => e.message.includes('files'), 'the board refuses the lists');
});

test('the kickoff reads the handoff folder through this PC\'s map: a worktree maps its main checkout, the session\'s own checkout comes first, an unmapped project says so', async () => {
  const root = tempDir('askerdo-handoffs-').replace(/\\/g, '/');
  const main = root + '/demo';
  const lane = root + '/demo-lane';
  mkdirSync(main + '/.git/worktrees/lane', { recursive: true });
  writeFileSync(main + '/.git/config', '[remote "origin"]\n\turl = https://github.com/example/map-demo.git\n');
  writeFileSync(main + '/.git/worktrees/lane/commondir', '../..\n');
  mkdirSync(lane);
  writeFileSync(lane + '/.git', 'gitdir: ' + main + '/.git/worktrees/lane\n');
  const data = root + '/data';
  learnProjects(data, [lane]);

  const kickoffOf = async (projectRepos, s) => {
    const ws = await boardCall('createRecord', { kind: 'workstream', name: 'Mapped ' + s, description: 'd', projectRepos, handoff: 'docs/handoff' });
    const tr = await boardCall('newTrack', { name: 'Mapped ' + s, workstream: ws.id, session: s }, { session: s, pc: 'pc1' });
    return boardCall('trackKickoff', { track: tr.id });
  };
  const readOf = (k) => k.kickoff.split('\n').find((l) => l.startsWith('Read: ')) || '';
  const k = await kickoffOf(['github.com/example/map-demo'], 'f1');
  assert.ok(readOf(await pc.kickoffHere(k, { cwd: root, dir: data })).includes(main + '/docs/handoff/rules.md'), 'the map names the main checkout');
  assert.ok(readOf(await pc.kickoffHere(k, { cwd: lane, dir: data })).includes(lane + '/docs/handoff/rules.md'), 'the session\'s worktree first');

  const away = await pc.kickoffHere(await kickoffOf(['github.com/example/elsewhere'], 'f2'), { cwd: lane, dir: data });
  assert.deepEqual([away.workstream.handoffDir, away.workstream.unmapped], [null, 'github.com/example/elsewhere']);
  assert.ok(readOf(away).includes('github.com/example/elsewhere') && !readOf(away).includes(root), readOf(away));

  /* a parent scan with clones of one repo maps the one named for it, not the last, and never moves a mapped folder */
  for (const n of ['map-demo', 'map-demo-old']) {
    mkdirSync(root + '/' + n + '/.git', { recursive: true });
    writeFileSync(root + '/' + n + '/.git/config', '[remote "origin"]\n\turl = https://github.com/example/map-demo.git\n');
  }
  /* a repo two folders down is found; one inside node_modules is not */
  for (const [d, repo] of [['/group/nested', 'nested'], ['/tool/node_modules/dep', 'dep']]) {
    mkdirSync(root + d + '/.git', { recursive: true });
    writeFileSync(root + d + '/.git/config', '[remote "origin"]\n\turl = https://github.com/example/' + repo + '.git\n');
  }
  const fresh = tempDir('askerdo-handoffs-');
  const scan = scanProjects(fresh, [root]);
  assert.equal(readMap(fresh)['github.com/example/nested'], root + '/group/nested');
  assert.equal(readMap(fresh)['github.com/example/dep'], undefined);
  assert.equal(readMap(fresh)['github.com/example/map-demo'], root + '/map-demo');
  assert.deepEqual(scan.others.map((o) => o.dir).sort(), [main, root + '/map-demo-old']);
  scanProjects(data, [root]);
  assert.equal(readMap(data)['github.com/example/map-demo'], main, 'a mapped folder that exists stays');

  /* a desktop-app scratch workspace is never learned; a stale entry is marked, and forgotten only when asked */
  const scratch = root + '/AppData/Roaming/Claude/scratch-workspaces/abc';
  mkdirSync(scratch + '/.git', { recursive: true });
  assert.equal(learnProjects(data, [scratch.replace(/\//g, '\\')]).added.length, 0);
  learnProjects(data, [root + '/map-demo-old'], { replace: true });
  rmSync(root + '/map-demo-old', { recursive: true });
  assert.ok(entryDrift('github.com/example/map-demo', readMap(data)['github.com/example/map-demo']).gone);
  assert.ok(forgetInMap(data, 'github.com/example/map-demo').dropped);
  assert.equal(readMap(data)['github.com/example/map-demo'], undefined);
});

test('a question still open is listed once, though the handoff carried it too', () => {
  const view = { id: 'TR-1', name: 'Line', chain: 'TR-1', text: 'on its way', done: 0, total: 0, now: [], readySet: [], critical: { length: 0, path: [] }, tasks: [], sideTracks: [] };
  const k = { view, handoff: { id: 'TR-1.2', focus: 'Go on.', state: 's', waitingOnUser: ['Q6 Sample name length', 'the deploy key'] },
    waits: [{ id: 'Q6', name: 'Sample name length' }], answers: [], stalls: [] };
  const wait = kickoffText(k).split('\n').find((l) => l.startsWith('Waiting on the user: '));
  assert.equal(wait.split('Q6').length - 1, 1, wait);
  assert.match(wait, /the deploy key/, 'what only the handoff carried stays');
  /* the line after the waits says to check what only the handoff carried, and is not there with none */
  const after = (kk) => { const ls = kickoffText(kk).split('\n'); return ls[ls.findIndex((l) => l.startsWith('Waiting on the user: ')) + 1] || ''; };
  assert.match(after(k), /\bcheck\b/i);
  assert.doesNotMatch(after({ ...k, handoff: { ...k.handoff, waitingOnUser: ['Q6 Sample name length'] } }), /\bcheck\b/i);
});

test('the kickoff lists a stale task as nobody on it; a session is named as this one or a session; ids carry their names', () => {
  const t = (id, more = {}) => ({ id, name: 'step ' + id + ': the detail', waitsOn: [], ...more });
  const many = ['T-1', 'T-2', 'T-4', 'T-5', 'T-6', 'T-7'];
  const view = { id: 'TR-11', name: 'Line', chain: 'TR-11 under TR-4', text: '3 open', done: 0, total: 3, readySet: [],
    now: [{ id: 'T-1', name: 'step T-1', session: 'me' }], stale: [{ id: 'T-2', name: 'step T-2' }], names: { 'T-4': 'far step: x' },
    critical: { length: 3, path: ['T-1', 'T-2', 'T-3'] }, sideTracks: [], junction: { track: { id: 'TR-4' }, task: null },
    tasks: [t('T-1'), t('T-2'), t('T-3', { waitsOn: many.map((id) => 'after ' + id + (id === 'T-4' ? ' on TR-5' : '')) })] };
  const text = kickoffText({ view, waits: [], answers: [], stalls: [], runBy: {}, reader: 'me' }, { mode: 'resumed' });
  const now = text.split('\n').find((l) => l.startsWith('Now: '));
  assert.ok(now.includes('T-1') && now.includes('this session') && !now.includes('T-2'), now);
  assert.ok(/- T-2 .*nobody on it/.test(text), text);
  assert.ok(!/run by|It left|to go/.test(text), text);
  const chain = text.split('\n').find((l) => /longest chain/i.test(l));
  assert.ok(['T-1 step T-1', 'T-2 step T-2', 'T-3 step T-3'].every((x) => chain.includes(x)), chain);
  const waits = text.split('\n').find((l) => l.startsWith('- T-3'));
  assert.ok(waits.includes('T-4 far step on TR-5') && /3 more/.test(waits) && !waits.includes('T-7'), 'the first few named, the rest counted: ' + waits);
});
