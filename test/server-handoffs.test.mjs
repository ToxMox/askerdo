/* Handoffs, resume and the kickoff on tracks, through boardCall
   on memory:, one behaviour per test. memory: is one database per process, so
   each test makes its own workstream and its own session names. */
import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { childEnv, tempDir } from './helpers/sandbox.mjs';
import { cliRoute, runCli } from './helpers/cli.mjs';
import { slicer } from './helpers/shard.mjs';

/* run as two files: the launcher case and the two-PC case each run a quarter minute of git in a loaded suite */
const mine = slicer(2);
const test = (...args) => (mine() ? nodeTest(...args) : undefined);

process.removeAllListeners('warning');
process.env.ASKERDO_SANDBOX_HOME = tempDir('askerdo-handoffs-');
process.env.ASKERDO_BOARD_URL = 'memory:';
const { boardCall } = await import('../lib/board-call.mjs');
const pc = await import('../lib/tracks-session.mjs');
const { dataDir } = await import('../lib/node-helpers.mjs');
const { growthLine } = await import('../server/verbs/outcomes.mjs');
const { ageText, kickoffText } = await import('../server/verbs/kickoff.mjs');
const { proseOrder } = await import('../lib/handoff-payload.mjs');
const { reviewLine, wakeIn } = await import('../server/handoff-text.mjs');
const { entryDrift, forgetInMap, learnProjects, readMap, scanProjects } = await import('../lib/project-map.mjs');
const { rebasePath } = await import('../lib/project-id.mjs');
const { resumeBlock } = await import('../lib/mod-core.mjs');
const { APPROVED } = await import('../server/verbs/placement-seam.mjs');

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

test('a handoff lets the lease go and the track waits; parked, its handoff parks too; resume takes it back with the kickoff, its tasks to continue', async () => {
  const tr = await line('a1', 'Ship the line.');
  const wsName = 'Handoffs ' + n;
  await assert.rejects(boardCall('parkTrack', { track: tr.id, reason: 'not mine' }, { session: 'a9' }), /held by a session on pc1/, 'a live lease parks only by its holder');
  for (const name of ['first', 'second']) await boardCall('capture', { track: tr.id, name });
  const first = (await boardCall('trackView', { track: tr.id })).tasks[0];
  await boardCall('taskUpdate', { id: first.id, status: 'done' });
  const tasks = [];
  for (const name of ['wire', 'test', 'ship']) tasks.push((await boardCall('createRecord', { kind: 'task', name, description: 'd', track: tr.id })).id);
  /* a ruling made before the leg began stays out of the kickoff, one made since is listed; the held track fills the links */
  const ruling = (title, opts = {}) => boardCall('decide', { title, tasks: [tasks[0]], projects: ['C:/repo'] }, { session: 'a1', ...opts });
  const before = await ruling('Cards first', { now: new Date(Date.now() - 3600e3) });
  const since = await ruling('Rows first');
  assert.deepEqual(since.tracks, [tr.id]);
  /* an older ruling amended this leg is listed and marked */
  const older = await boardCall('decide', { title: 'Tabs last', body: 'Tabs wait for the pane. More later.', tasks: [tasks[0]], projects: ['C:/repo'] }, { session: 'a1', now: new Date(Date.now() - 3600e3) });
  await boardCall('amendKnowledge', { id: older.id, body: 'Steps go on the checklist.' }, { session: 'a1' });
  const took = [];
  for (const id of tasks) took.push(await boardCall('taskUpdate', { id, inHand: true }, { session: 'a1' }));
  /* taking a task in hand hands over its rulings */
  assert.deepEqual(took[0].decisions.map((d) => d.id), [since.id, older.id, before.id]);
  await boardCall('noteRecord', { id: tr.id, text: 'Said before the handoff.' }, { session: 'a1', now: new Date(Date.now() - 3600e3) });
  /* one read gives every open track with its newest handoff's verify-first entries; a parked one is left out */
  const openRow = async () => (await boardCall('listTracks', { open: true })).tracks.find((x) => x.id === tr.id);
  assert.deepEqual([(await openRow()).state, (await openRow()).handoff], ['active', null]);
  /* the runs end in the write's own transaction, so a refused write leaves them open */
  await assert.rejects(handoff(tr.id, 'a1', { nextPc: 'no-such-pc' }), /nextPc/);
  assert.equal((await boardCall('heldTask', { session: 'a1' })).length, tasks.length);
  /* the waiting lines go by waitingOnUser in, stored and out */
  /* a goal said again as it stands changes nothing */
  const h = await handoff(tr.id, 'a1', { waitingOnUser: ['the deploy key'], goal: 'Ship the line.' });
  assert.deepEqual([h.goalWas, (await boardCall('trackSummary', { track: tr.id })).goalRestated], [undefined, null]);
  /* a track born with no goal gets its first one set, never restated from its name */
  const bare = await line('a0');
  const set = await handoff(bare.id, 'a0', { goal: 'Ship the bare line.' });
  assert.deepEqual([set.goalWas, (await boardCall('trackSummary', { track: bare.id })).goalRestated, (await boardCall('trackSummary', { track: bare.id })).goal], [undefined, null, 'Ship the bare line.']);
  const waitingRow = await openRow();
  assert.deepEqual([waitingRow.state, waitingRow.handoff, waitingRow.workstream, waitingRow.verify.map((v) => v.path)], ['waiting', h.id, tr.ws, ['C:/repo']]);
  assert.equal(h.released, true);
  /* the handoff carries every task in hand; another session takes one meanwhile */
  assert.deepEqual([...h.inHand].sort(), [...tasks].sort());
  assert.deepEqual(h.silentInHand.map((t) => t.id).sort(), [...tasks].sort(), 'none was written on, so each is named');
  assert.deepEqual(await boardCall('heldTask', { session: 'a1' }), []);
  await boardCall('taskUpdate', { id: tasks[2], inHand: true }, { session: 'a3' });
  assert.equal((await boardCall('trackSummary', { track: tr.id })).state, 'waiting');

  await boardCall('parkTrack', { track: tr.id, reason: 'waits on the API lane' });
  const parked = await boardCall('readHandoff', { id: h.id });
  assert.deepEqual([parked.status, parked.parkReason], ['parked', 'waits on the API lane'], 'the handoff parks with its track');
  assert.equal(await openRow(), undefined, 'a parked track is not where work runs');
  /* a parked track's tasks read ready by the table alone, so its index says it is parked */
  const shownParked = (await boardCall('trackKickoff', { track: tr.id })).kickoff.split('\n');
  assert.ok(shownParked.findIndex((l) => l.startsWith('Parked:')) < shownParked.findIndex((l) => l.startsWith('To continue')), shownParked.join('\n'));
  assert.ok(shownParked.some((l) => l.startsWith('Parked:')), shownParked.join('\n'));
  const row = await shelfRow(tr.id);
  assert.deepEqual([row.state, row.handoffStatus], ['parked', 'parked'], 'the shelf reads the same');
  /* the Tracks tab's tile names the workstream, says the goal and draws the bar */
  assert.deepEqual([row.workstreamName, row.goal, row.done, row.total], [wsName, 'Ship the line.', 1, 5]);

  /* talk after the handoff patches it in place, keeping its id; a section named again is replaced */
  const patch = (id, ops) => boardCall('updateHandoff', { id, ops }, { session: 'a1', pc: 'pc1' });
  await patch(tr.id, [{ op: 'state', heading: '## Tests', text: 'All pass.' }]);
  const up = await patch(h.id, [{ op: 'state', heading: '## Tests', text: 'One fails.' }, { op: 'waitingOnUser', add: 'a second key' }]);
  assert.deepEqual([up.waitingOnUser, Object.keys(up.changed)], [['the deploy key', 'a second key'], ['state', 'waitingOnUser']]);
  assert.deepEqual([up.id, up.status, up.state.split('## Tests').length], [h.id, 'parked', 2]);
  assert.ok(up.state.startsWith('The state of ' + tr.id) && up.state.includes('One fails.') && !up.state.includes('All pass.'), up.state);
  /* a long line the wrap passes whole (fenced) stands, and a patch above it that moves it goes through;
     a long prose line a patch adds is still refused */
  const wide = 'word '.repeat(96).trimEnd() + '.';
  await patch(h.id, [{ op: 'state', heading: '## Log', text: '```\n' + wide + '\n```' }]);
  const below = await patch(h.id, [{ op: 'state', heading: '## Tests', text: 'One fails.\nThen two pass.\nThen all pass.' }]);
  assert.ok(below.state.includes(wide) && below.state.includes('Then all pass.'), below.state);
  await assert.rejects(patch(h.id, [{ op: 'state', heading: '## Notes', text: wide }]), (e) => /400/.test(e.message));

  /* the kickoff waits on the track's own questions and a trackless one on its workstream, never another track's */
  const other = await boardCall('newTrack', { name: 'Side line', workstream: tr.ws, session: 'a8' }, { session: 'a8', pc: 'pc1' });
  const ask = (name, scope) => boardCall('register', { name, gist: 'g', blocking: false, ask: 'One (a, my pick) or two (b)?', pick: 'a',
    options: ['a', 'b'].map((type) => ({ type, option: type, getsYou: 'x', costsYou: '' })), workstream: tr.ws, session: 'a9', projectDir: 'C:/repo', ...scope });
  /* an answered question's label rests and is reused, so a wait on the open holder is not settled by the old one */
  const ago = new Date(Date.now() - 60 * 86400e3);
  const gone = await boardCall('register', { name: 'old colour', gist: 'g', blocking: false, ask: 'Red (a, my pick) or blue (b)?', pick: 'a',
    options: ['a', 'b'].map((type) => ({ type, option: type, getsYou: 'x', costsYou: '' })), workstream: tr.ws, session: 'a9', projectDir: 'C:/repo' }, { now: ago });
  await boardCall('answer', { id: gone.id, pick: 'a' }, { now: ago });
  const reused = await ask('colour', { track: tr.id });
  assert.equal(reused.id, gone.id, 'the rested label was reused');
  const asked = [await ask('ours', { track: tr.id }), await ask('theirs', { track: other.id }), await ask('unplaced', {})];
  const both = 'the format, ' + asked[0].id + ' and ' + asked[2].id;
  const colour = 'the colour, ' + reused.id;
  await patch(h.id, [{ op: 'waitingOnUser', add: 'which port, ' + asked[0].id }, { op: 'waitingOnUser', add: both }, { op: 'waitingOnUser', add: colour }]);
  await boardCall('noteRecord', { id: tr.id, text: 'Said while it waited.' }, { session: 'a7', now: new Date(Date.now() + 1000) });
  const r = await resume(tr.id, 'a2');
  /* the kickoff says what the track is for and what was said on it since its handoff */
  assert.deepEqual(['Ship the line', 'Said while it waited', 'Said before the handoff'].map((s) => r.kickoff.includes(s)), [true, true, false], r.kickoff);
  assert.deepEqual([r.acquired, r.state], [true, 'active']);
  const waiting = r.kickoff.split('\n').find((l) => l.startsWith('Waiting on the user: ')) || '';
  assert.deepEqual(asked.map((q) => waiting.includes(' ' + q.id + ' ')), [true, false, true], waiting);
  assert.equal((await boardCall('readHandoff', { id: h.id })).status, 'resumed');
  assert.ok(r.kickoff.includes('The state of ' + tr.id + '.'), 'the kickoff carries the handoff');
  /* nothing comes back in hand; the handed on tasks read to continue, the one taken meanwhile runs under its session */
  assert.deepEqual(await boardCall('heldTask', { session: 'a2' }), []);
  const words = await Promise.all(tasks.map(async (id) => (await boardCall('readRecord', { id })).word));
  assert.deepEqual(words.map((w) => w.next || w.is), ['continue', 'continue', 'running']);
  const setOf = (id) => (r.kickoff.split('\n').find((l) => /^[A-Z][a-z ]+ \(\d+[,)]/.test(l) && new RegExp('\\b' + id + '\\b').test(l)) || '').split(' (')[0];
  assert.deepEqual(tasks.map(setOf), ['To continue', 'To continue', 'Running'], r.kickoff);
  /* the leg's list, not a task block above it, which holds every decision on its task */
  const leg = r.kickoff.slice(r.kickoff.indexOf('Decisions made or amended since'));
  const has = (id) => new RegExp('^- ' + id + ' ', 'm').test(leg);
  assert.deepEqual([has(since.id), has(before.id), has(older.id)], [true, false, true], r.kickoff);
  assert.match(leg.split('\n').find((l) => l.startsWith('- ' + older.id + ' ')), /amended/);
  /* the head says when the leg began and a ruling its local time, its clock alone on that day */
  const head = r.kickoff.split('\n').find((l) => l.startsWith('Decisions made or amended since'));
  const made = leg.split('\n').find((l) => l.startsWith('- ' + since.id + ' '));
  assert.ok(/\d:\d\d/.test(head) && /\(\d{1,2}:\d\d\)$/.test(made), head + ' / ' + made);
  await assert.rejects(patch(tr.id, [{ op: 'whereWeWere', line: 'One more thing.' }]),
    (e) => /a session on (this PC|pc1)/.test(e.message) && e.message.includes('note ' + tr.id), 'after the resume the update names the holder and the note');
  /* the waits stay on the held track's show, and carry into the next handoff until one drops them */
  const shown = (await boardCall('trackKickoff', { track: tr.id })).kickoff.split('\n').find((l) => l.startsWith('Waiting on the user: '));
  assert.ok(shown.includes('the deploy key') && shown.includes('a second key'), shown);
  await assert.rejects(handoff(tr.id, 'a2', { waitingOnUser: [{ drop: 'no such wait' }] }), /the deploy key/, 'a drop names a carried wait');
  /* the write takes a task's note in the same call and names the task in hand left silent; the next kickoff names it too */
  /* a carried wait whose question was answered since is settled, not carried on; one naming an open question too stays */
  await boardCall('answer', { id: asked[0].id, pick: 'a' });
  for (const id of tasks.slice(0, 2)) await boardCall('taskUpdate', { id, inHand: true }, { session: 'a2' });
  const next = await handoff(tr.id, 'a2', { waitingOnUser: [{ drop: 'a second key' }, 'a third'], taskNotes: [{ id: tasks[0], note: 'Wired it.' }], goal: 'Ship the line and its docs.' });
  /* a goal restated at the handoff amends the track's, the old text in its history with the handoff as its why */
  const was = (await boardCall('recordHistory', { id: tr.id })).rows.filter((x) => x.field === 'goal');
  assert.ok(was.length === 1 && was[0].old === 'Ship the line.' && was[0].why.includes(next.id), JSON.stringify(was));
  assert.deepEqual((await boardCall('trackSummary', { track: tr.id })).goalRestated, { handoff: next.id, at: next.created, was: 'Ship the line.' });
  assert.deepEqual([next.waitingOnUser, next.carriedWaits, next.settledWaits], [['the deploy key', both, colour, 'a third'], ['the deploy key', both, colour], ['which port, ' + asked[0].id]]);
  assert.deepEqual(next.silentInHand.map((t) => t.id), [tasks[1]]);
  assert.ok(JSON.stringify(await boardCall('readRecord', { id: tasks[0] })).includes('Wired it.'));
  const back = (await resume(tr.id, 'a4')).kickoff.split('\n');
  const told = back.find((l) => l.includes(tasks[1]) && /nothing written/.test(l));
  assert.ok(told && !told.includes(tasks[0]), told);
  /* one line says the goal was restated and what it was; the handoff's own note is not listed again */
  const goals = back.filter((l) => l.includes('its docs'));
  assert.ok(goals.length === 1 && goals[0].includes(next.id) && goals[0].includes('Ship the line.') && !back.some((l) => /^- .*restated/.test(l)), back.join('\n'));
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
  await boardCall('taskUpdate', { id: mine.id, inHand: true }, { session: 'c1' });
  const nowOf = async (s) => (await boardCall('trackKickoff', { track: tr.id, session: s })).kickoff.split('\n').find((l) => l.startsWith('Running ('));
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
  /* the test's own layout, not a session's found work */
  const task = (name) => boardCall('capture', { track: tr.id, name });
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
  await boardCall('editRecord', { id: a.id, status: 'done' });
  /* one task of each set the index leads with, each with a run behind it */
  const ago = (min) => ({ now: new Date(Date.now() - min * 60e3) });
  const [lost, left, handed] = [await task('Taken elsewhere'), await task('Finished by an agent'), await task('Handed on')];
  await boardCall('taskUpdate', { id: lost.id, inHand: true }, { session: 'd9', pc: 'pc2', ...ago(4) });
  await boardCall('addItem', { task: left.id, text: 'the secret step text' });
  await boardCall('openRun', { tasks: [left.id], worker: 'agent', agentId: 'ag-d', job: 'lane-d' }, { session: 'd1', ...ago(300) });
  await boardCall('endRun', { agentId: 'ag-d', how: 'finished' }, { session: 'd1', ...ago(180) });
  await boardCall('taskUpdate', { id: handed.id, inHand: true }, { session: 'd1', ...ago(200) });
  await boardCall('taskUpdate', { id: handed.id, letGo: true }, { session: 'd1', ...ago(120) });

  const k = (await resume(tr.id, 'd2')).kickoff;
  const at = (id) => k.split('\n').findIndex((l) => /^[A-Z][a-z ]+ \(\d+[,)]/.test(l) && new RegExp('\\b' + id + '\\b').test(l));
  const order = [lost, left, handed, b].map((t) => at(t.id));
  assert.ok(order.every((i, j) => i >= 0 && (j === 0 || i > order[j - 1])), k);
  assert.ok(['Unconfirmed', 'To settle', 'To continue', 'Ready to start'].every((s, j) => k.split('\n')[order[j]].startsWith(s)), k);
  for (const t of [left, handed]) {
    const since = Date.parse((await boardCall('readRecord', { id: t.id })).word.since);
    assert.ok(k.split('\n')[at(t.id)].includes('ready ' + ageText(Date.now() - since)), k);
  }
  assert.ok(!k.includes('the secret step text'), 'the index carries counts, never a step text');
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
  const filed = await boardCall('capture', { workstream: sibling.id, name: 'Filed in the sibling', wake: wakeIn() });
  const away = await boardCall('capture', { workstream: other.id, name: 'Filed in another project', wake: wakeIn() });
  /* a due task of any workstream on the project leads the kickoff, ahead of the inbox list, naming its workstream */
  const then = new Date(Date.now() - 20 * 86400e3);
  const stale = await boardCall('capture', { workstream: sibling.id, name: 'Filed long ago', wake: wakeIn(1, then) }, { now: then });
  /* a due task in the held track's workstream is offered as a step on it first */
  const homeDue = await boardCall('capture', { workstream: home.id, name: 'Owed at home', wake: wakeIn(1, then) }, { now: then });
  const own = (await resume(held.id, 'd3')).kickoff;
  const homeCall = own.split('\n').find((l) => l.startsWith('- ' + homeDue.id + ' ')) || '';
  assert.ok(/task edit \S+ --tier 2 --before /.test(homeCall.split(', or ')[0]), homeCall);
  assert.ok(has(own, filed.id) && !has(own, away.id), own);
  const rows = own.split('\n');
  const dueAt = rows.findIndex((l) => l.startsWith('Due for a home') && has(l, stale.id) && has(l, sibling.id) && !has(l, filed.id));
  assert.ok(dueAt >= 0 && dueAt < rows.findIndex((l) => l.startsWith('Inbox (')), own);
  /* the inbox's place line owes this track's workstream its due tasks, and only names another's; the lead agrees */
  const place = rows.find((l) => l.startsWith('Place each:')) || '';
  assert.ok(place.includes(stale.id + ' (' + sibling.id + ')'), place);
  assert.ok(rows[dueAt].includes(stale.id + ' (' + sibling.id + ')') && !rows[dueAt].includes('<T-n> --track'), rows[dueAt]);
  /* the handoff write returns the same set */
  const wrote = await handoff(held.id, 'd3');
  assert.deepEqual(wrote.inbox.map((x) => x.id + ' ' + x.due).sort(), [stale.id + ' true', filed.id + ' false', homeDue.id + ' true'].sort());
});

test('a handoff lays its leftovers out on the track with their edges, each naming who runs it; a Next list in the state is refused before anything is written', async () => {
  const tr = await line('g1');
  /* with nothing else open on the held track, the steps go on it free */
  const h = await handoff(tr.id, 'g1', { leftovers: [{ name: 'Review the wave', description: 'Done when Review the wave is done.', runBy: 'agent:opus', tier: 2 }, { name: 'Fix what it finds', description: 'Done when its findings are fixed.', after: [1], runBy: 'fork', tier: 2 }] });
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
  const ship = { name: 'Ship it', description: 'Done when Ship it is done.', runBy: 'orchestrator', tier: 2, before: [fixes.id] };
  await assert.rejects(handoff(tr.id, 'g2', { leftovers: [ship, { name: 'Tell the user', description: 'Done when told.', after: [1, 'T-99999'], runBy: 'orchestrator', tier: 2, before: [fixes.id] }] }),
    (e) => /step 2/.test(e.message) && /T-99999/.test(e.message) && /nothing/.test(e.message));
  await assert.rejects(handoff(tr.id, 'g2', { leftovers: [ship, { name: 'Tell the user', description: 'Done when told.' }] }),
    (e) => /step 2/.test(e.message) && /runBy/.test(e.message), 'a leftover naming nobody to run it is refused');
  assert.equal((await boardCall('trackHandoffs', { track: tr.id })).handoffs.length, 1, 'only the first handoff is on the board');
  assert.ok(!(await boardCall('trackView', { track: tr.id })).tasks.some((t) => t.name === 'Ship it'), 'no leftover was laid out');
  /* this PC marks a handoff's leftovers, so an untiered one is refused with the call that fits */
  const untiered = { focus: 'Go on.', state: 'Shipping.', session: 'g2', verifyFirst: [{ path: 'C:/repo' }], leftovers: [{ name: 'Ship it', description: 'Done when Ship it is done.', runBy: 'orchestrator' }] };
  await assert.rejects(pc.writeTrackHandoff(tr.id, untiered, { pc: 'pc1' }), (e) => /tier/.test(e.message));

  /* a leftover for a new parked track is asked of the user and the handoff lands; the answer b makes the track,
     parked until the step it named by number, now named by id */
  const later = await handoff(tr.id, 'g2', { leftovers: [{ name: 'Cut the release', description: 'Done when Cut the release is done.', runBy: 'orchestrator', tier: 2, before: [fixes.id] },
    { name: 'Port the docs', description: 'Done when Port the docs is done.', runBy: 'agent:opus', tier: 3, newTrack: 'Docs port', unparkWhen: 'task-completes 1',
      whyElsewhere: 'the docs port is its own line; it starts once the release is cut', here: { before: [fixes.id] } }] });
  const [release] = later.laidOut;
  const asked = later.steps[1].asked;
  assert.deepEqual([later.steps[0].id, later.steps[1].step, typeof asked.id, later.parkedTracks], [release.id, 2, 'string', undefined]);
  assert.ok(!(await boardCall('trackView', { track: tr.id })).tasks.some((t) => t.name === 'Port the docs'), 'nothing is created while the user decides');
  const placed = (await boardCall('answer', { id: asked.id, pick: 'b' }, { user: 'g2' })).placement;
  assert.ok(placed.created, JSON.stringify(placed));
  const docs = await boardCall('trackSummary', { track: placed.created.track });
  assert.deepEqual([placed.outcome, docs.name, docs.state], ['asked', 'Docs port', 'parked']);
  assert.ok(JSON.stringify(docs).includes(release.id), JSON.stringify(docs));

  /* this PC marks a tier 2 leftover, so on the held track a blank is refused and nothing written; last lands with its line */
  await resume(tr.id, 'g4');
  const tiered = (p) => ({ focus: 'Go on.', state: 'Shipping.', session: 'g4', verifyFirst: [{ path: 'C:/repo' }], leftovers: [{ name: 'Tag the release', description: 'Done when Tag the release is done.', runBy: 'orchestrator', tier: 2, ...p }] });
  const before = (await boardCall('trackHandoffs', { track: tr.id })).handoffs.length;
  await assert.rejects(pc.writeTrackHandoff(tr.id, tiered({}), { pc: 'pc1' }), (e) => e.data.offers.some((o) => o.before) && e.data.offers.some((o) => o.last));
  assert.equal((await boardCall('trackHandoffs', { track: tr.id })).handoffs.length, before, 'nothing written');
  /* last, with other work open, is asked of the user with the real place it would otherwise take; nothing is laid out */
  const tagged = await pc.writeTrackHandoff(tr.id, tiered({ last: 'the release tag is the last thing the line does', after: [fixes.id], here: { before: [fixes.id] } }), { pc: 'pc1' });
  assert.ok(tagged.steps[0].asked.id && !tagged.steps[0].id, JSON.stringify(tagged.steps));
  /* a last that names after says it once */
  const askedLine = (await boardCall('show', { id: tagged.steps[0].asked.id })).gist.split(/\n/).find((l) => l.startsWith('**Asked:**'));
  assert.equal(askedLine.split(fixes.id).length, 2, askedLine);
  assert.ok(!(await boardCall('trackView', { track: tr.id })).tasks.some((t) => t.name === 'Tag the release'));

  /* a track with no handoff yet prints its newest notes and points at the rest */
  const fresh = await line('g3');
  for (let i = 1; i <= 12; i++) await boardCall('noteRecord', { id: fresh.id, text: 'Note number ' + i + '.' }, { session: 'g3' });
  const k = (await resume(fresh.id, 'g3')).kickoff;
  assert.deepEqual(['Note number 2.', 'Note number 3.', 'Note number 12.', fresh.id + ' --journal'].map((s) => k.includes(s)), [false, true, true, true], k);
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
  /* a task filed last already said why nothing needs it sooner, so the leaves line leaves it out; on a track with nothing else open it is free */
  const lastOne = (await boardCall('layOut', { track: tr.id, steps: [{ name: 'Write the changelog', last: 'nothing on the line needs the changelog sooner' }], session: 'e1' }, { session: 'e1' })).steps[0].id;
  for (const name of ['Write the code', 'Write the docs']) ids.push((await boardCall('capture', { track: tr.id, name })).id);
  /* filed off the track this arc, as an answered placement question files it, so the growth lines name the place command */
  const inbox = { kind: 'task', description: 'd', tier: 2, unplaced: 'waits on the user', wake: wakeIn(), [APPROVED]: 'Q-1' };
  await boardCall('createRecord', { ...inbox, name: 'Ask about the logo' }, { session: 'e1' });
  /* one dropped before the handoff is asked no place */
  const gone = await boardCall('createRecord', { ...inbox, name: 'Ask about the font' }, { session: 'e1' });
  await boardCall('editRecord', { id: gone.id, status: 'dropped' });
  const asked = async () => (await boardCall('list', {})).length + (await boardCall('list', { snoozed: true })).length;
  const before = await asked();
  /* an agent run on a branch with no remote is named by the write, and the PC says it is not pushed */
  const lane = (await boardCall('openRun', { tasks: [ids[1]], worker: 'agent', agentId: 'ag-e', job: 'lane-e', repo, branch: 'main' }, { session: 'e1' })).run;
  let h;
  try {
    const input = JSON.stringify({ focus: 'Go on.', state: 'Work.', session: 'e1', verifyFirst: [{ path: repo, files: [{ path: 'notes.txt', disposition: 'commit' }], ...owned }] });
    const w = await runCli(['handoff', 'write', tr.id, '--json'], { env, input });
    assert.equal(w.code, 0, w.err);
    h = JSON.parse(w.out);
    assert.ok(route.answered.length && route.answered.every((a) => a.status === 200), 'the local server ran it: ' + JSON.stringify([route.answered, route.refused]) + ' ' + w.err);
    assert.deepEqual(h.runs.map((x) => [x.run, x.branch, x.remote]), [[lane.run, 'main', 'unpushed']]);
    assert.ok(h.unpushedLine.includes('run ' + lane.run), h.unpushedLine);
    /* the leaves ask names this sandbox's launcher, never the live one, and its command runs as printed */
    const launcher = pc.launcherHere(env);
    const cmds = [...h.leavesLine.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    assert.ok(cmds.length === 2 && cmds[1].startsWith(launcher + ' task edit ') && cmds[1].includes('--tier 2'), h.leavesLine);
    const cmd = cmds[0];
    assert.ok(cmd.startsWith(launcher + ' edge add '), cmd);
    /* the found task whose wake has not come is listed and owes nothing */
    const placeEach = h.growthLines.find((l) => l.startsWith('Unplaced: ')) || '';
    assert.ok(/owes? (?:nothing|anything)/.test(placeEach) && !h.growthLines.some((l) => l.includes('.claude/askerdo/cli.mjs')) && !placeEach.includes(gone.id), placeEach);
    assert.ok(!h.leaves.some((x) => x.id === lastOne), JSON.stringify(h.leaves));
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
  /* a where-we-were line starting # or a space then # reads back exactly */
  const where = ' # a spaced one\n# a heading line\nplain';
  const next = await pc.writeTrackHandoff(tr.id, { focus: 'Go on.', state: 'More work.', whereWeWere: where, session: 'e1', verifyFirst: [{ path: repo, ownedByOthers: ['theirs'] }] }, { dir, pc: 'pc1' });
  const back = await boardCall('readHandoff', { id: next.id });
  assert.equal(back.whereWeWere, where);
  const grown = back.growth;
  assert.deepEqual([grown.since, grown.repos, grown.testsAdded], [h.id, 1, 2], 'the stored handoff carries the growth since the last one');

  writeFileSync(join(repo, 'a.txt'), 'changed\n');
  writeFileSync(join(repo, 'later.tmp'), 't\n');
  writeFileSync(join(repo, 'theirs', 'x.md'), 'theirs changed\n');
  const r = await pc.resumeTrackSession(tr.id, { session: 'e2' }, { dir, pc: 'pc1' });
  assert.deepEqual([r.verify.lists, r.verify.ok], ['here', false], 'a tracked file changed since the handoff');
  assert.deepEqual(r.verify.repos[0].problems.filter((p) => p.includes('theirs')), [], 'owned work is not a change to check');
  assert.match(r.verify.report, /later\.tmp/, 'the leg names a file new since the handoff');
  assert.ok(r.kickoff.includes(growthLine(grown)), 'the kickoff prints the growth line');
  assert.ok(!/No handoff yet/.test(r.kickoff), 'a kickoff that carries a handoff never says there is none');
  const theirs = r.kickoff.split('\n').filter((l) => l.includes('theirs'));
  assert.ok(theirs.length === 1 && /owned/i.test(theirs[0]) && !/undecided/i.test(theirs[0]), 'the kickoff names owned work apart: ' + theirs);

  await assert.rejects(boardCall('writeHandoff', { track: tr.id, focus: 'x', state: 'y', verify: [{ path: repo, files: [] }] }),
    (e) => e.message.includes('files'), 'the board refuses the lists');
});

test('a handoff written on one PC resumes on another: each repo verified at its checkout there, the handoff folder found there, a repo it lacks named as not here; one naming its next leg\'s PC is taken elsewhere only with --here; an untaken track with ready work is named at both', async () => {
  const root = tempDir('askerdo-handoffs-').replace(/\\/g, '/');
  const run = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
  const repoAt = (dir, url) => {
    mkdirSync(dir, { recursive: true });
    run(dir, 'init', '-q', '-b', 'main');
    for (const [k, v] of [['user.email', 't@example.com'], ['user.name', 't'], ['commit.gpgsign', 'false'], ['core.autocrlf', 'false'], ['remote.origin.url', url]]) run(dir, 'config', k, v);
  };
  const one = root + '/one/proj';
  repoAt(one, 'https://github.com/example/two-pc.git');
  mkdirSync(one + '/docs/handoff', { recursive: true });
  for (const f of ['rules.md', 'map.md']) writeFileSync(one + '/docs/handoff/' + f, '# ' + f + '\n');
  run(one, 'add', '.');
  run(one, 'commit', '-q', '-m', 'one');
  const only = root + '/one/only';
  repoAt(only, 'https://github.com/example/only-one.git');
  writeFileSync(only + '/a.txt', 'a\n');
  run(only, 'add', '.');
  run(only, 'commit', '-q', '-m', 'one');
  const two = root + '/two/deep/proj-dev';
  execFileSync('git', ['clone', '-q', one, two]);
  run(two, 'config', 'remote.origin.url', 'git@github.com:example/two-pc.git');
  const [d1, d2] = [root + '/data1', root + '/data2'];
  learnProjects(d1, [one, only]);
  learnProjects(d2, [two]);

  const ws = await boardCall('createRecord', { kind: 'workstream', name: 'Two PCs', description: 'd', projectRepos: ['github.com/example/two-pc'], handoff: one + '/docs/handoff' });
  const tr = await boardCall('newTrack', { name: 'Two PCs', workstream: ws.id, session: 'p1' }, { session: 'p1', pc: 'pc1' });
  await boardCall('capture', { track: tr.id, name: 'Go on' }, { session: 'p1' });
  await pc.writeTrackHandoff(tr.id, { focus: 'Go on.', state: 'Work.', session: 'p1', verifyFirst: [{ path: one }, { path: only }] }, { dir: d1, pc: 'pc1', cwd: one });
  /* one PC's folders are gone from this machine, as they are from another PC */
  renameSync(root + '/one', root + '/away');
  const r = await pc.resumeTrackSession(tr.id, { session: 'p2' }, { dir: d2, pc: 'pc2', cwd: root });
  const [proj, lone] = r.verify.repos;
  assert.deepEqual([proj.here, proj.ok, lone.absent, r.verify.ok], [two, true, true, true], JSON.stringify(r.verify));
  assert.equal(r.workstream.handoffDir, two + '/docs/handoff');
  assert.ok(!r.handoffChecks, JSON.stringify(r.handoffChecks));
  /* an older workstream's bare folder is found by a tail of two segments or more, never its last name alone */
  mkdirSync(two + '/handoff', { recursive: true });
  const bare = (abs) => pc.handoffDirHere({ handoffDir: abs, projectRepos: ['github.com/example/two-pc'] }, root, d2);
  assert.deepEqual([bare(root + '/gone/x/docs/handoff'), bare(root + '/gone/x/docs/ws-9/handoff')], [two + '/docs/handoff', root + '/gone/x/docs/ws-9/handoff']);

  /* a handoff written before the shared name rode along: its bare path moves through the writing PC's map on the board */
  await boardCall('pcMap', { map: { 'github.com/example/two-pc': one } }, { pc: 'pc1' });
  await boardCall('writeHandoff', { track: tr.id, focus: 'Old.', state: 'Old.', verify: [{ path: one }], session: 'p2' }, { session: 'p2', pc: 'pc1' });
  const old = await pc.resumeTrackSession(tr.id, { session: 'p3' }, { dir: d2, pc: 'pc2', cwd: root });
  assert.deepEqual([old.verify.repos[0].here, old.verify.repos[0].ok], [two, true], JSON.stringify(old.verify));

  /* a track of the workstream with ready work and no session is named at the handoff and the kickoff */
  const side = await boardCall('newTrack', { name: 'Side line', workstream: ws.id }, { pc: 'pc1' });
  await boardCall('capture', { track: side.id, name: 'Start it' });

  /* a handoff names the PC its next leg runs on; a resume elsewhere takes nothing until the user says --here */
  await assert.rejects(pc.writeTrackHandoff(tr.id, { focus: 'Next.', state: 'S.', session: 'p3', nextPc: 'pc9', verifyFirst: [{ path: two }] }, { dir: d2, pc: 'pc2' }),
    (e) => /pc9/.test(e.message) && /pc1/.test(e.message) && /pc2/.test(e.message), 'an unknown PC is refused with the names the board knows');
  const named = await pc.writeTrackHandoff(tr.id, { focus: 'Next.', state: 'S.', session: 'p3', nextPc: 'PC1', verifyFirst: [{ path: two }] }, { dir: d2, pc: 'pc2' });
  assert.ok(named.nextPc === 'pc1' && resumeBlock(tr.id, named.nextPc).includes('on pc1'), named.nextPc);
  assert.ok((named.untakenLine || '').includes(side.id) && !named.untakenLine.includes(tr.id + ' '), named.untakenLine);
  /* the shelf lists it too, after the waiting track, with its ready count */
  const rows = (await boardCall('shelf', {})).rows.filter((x) => x.workstream === ws.id);
  assert.deepEqual(rows.map((x) => [x.track, x.state, x.ready]), [[tr.id, 'waiting', undefined], [side.id, 'new', 1]], JSON.stringify(rows));
  const no = await pc.resumeTrackSession(tr.id, { session: 'p4' }, { dir: d2, pc: 'pc2' });
  assert.ok(!no.acquired && no.elsewhere && /--here/.test(no.next), JSON.stringify(no));
  assert.equal((await boardCall('trackSummary', { track: tr.id })).state, 'waiting', 'the lease stays where it was');
  const yes = await pc.resumeTrackSession(tr.id, { session: 'p4', here: true }, { dir: d2, pc: 'pc2' });
  assert.ok(yes.acquired && yes.kickoff.split('\n')[1].includes('pc1'), yes.kickoff.split('\n').slice(0, 2).join('\n'));
  assert.ok(yes.kickoff.split('\n').some((l) => l.startsWith('Untaken') && l.includes(side.id)), yes.kickoff);
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
  /* a converted protocol leaves no pointer at its folder */
  await boardCall('editRecord', { id: away.workstream.id, clearHandoff: true });
  assert.ok(!(await boardCall('readRecord', { id: away.workstream.id })).handoff);

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

  /* the board keeps each PC's map, so a path written on a PC whose folders differ opens here */
  const away2 = 'Q:/pc-b/work/map-demo';
  await boardCall('pcMap', { map: { 'github.com/example/map-demo': away2 } }, { pc: 'pc-b' });
  const { maps } = await boardCall('pcMap', { map: readMap(data) }, { pc: 'pc-a' });
  const placesOf = (list) => list.flatMap((m) => Object.entries(m.map).map(([repo, dir]) => ({ dir, repo })));
  assert.equal(rebasePath(away2 + '/docs/x.md', placesOf(maps)), main + '/docs/x.md');
  assert.equal(rebasePath(away2 + '/docs/x.md', placesOf(maps.filter((m) => m.pc === 'pc-a'))), away2 + '/docs/x.md', 'no map from the other PC, the path as written');

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

test('a due review line carries its review step, and the step as printed lays a review task out after the work and before the checkpoint', async () => {
  const tr = await line('r1');
  const work = [];
  for (const name of ['wire', 'test']) work.push(await boardCall('capture', { track: tr.id, name }));
  const look = await boardCall('capture', { track: tr.id, name: 'the look' });
  /* a task labelled look is the track's checkpoint, as the kickoff and the handoff write read it */
  await boardCall('taskUpdate', { id: look.id, addLabel: ['look'] }, { session: 'r1' });
  assert.equal((await handoff(tr.id, 'r1')).checkpoint, look.id);
  await resume(tr.id, 'r1');
  const due ={ due: true, uncovered: work.map((t) => ({ id: t.id, name: t.name })), lines: 40, locked: false };
  const text = reviewLine(due, tr.id, { before: look.id });
  const steps = JSON.parse(/echo '(.*)' \|/.exec(text)[1]).steps;
  const laid = await boardCall('layOut', { track: tr.id, steps, session: 'r1' }, { session: 'r1' });
  const made = await boardCall('readRecord', { id: laid.steps[0].id });
  const tasks = (await boardCall('trackView', { track: tr.id })).tasks;
  const waitsOf = (id) => tasks.find((t) => t.id === id).waitsOn.join(' ');
  assert.ok(made.labels.includes('review') && work.every((t) => waitsOf(made.id).includes(t.id)) && waitsOf(look.id).includes(made.id),
    JSON.stringify({ labels: made.labels, review: waitsOf(made.id), look: waitsOf(look.id) }));
  assert.doesNotMatch(reviewLine({ ...due, planned: made.id }, tr.id), /track layout/, 'a planned review keeps its words');
  /* the handoff write names the same checkpoint the kickoff's step goes before */
  assert.equal((await handoff(tr.id, 'r1')).checkpoint, made.id);
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

test('the kickoff names a session as this one or a session; ids carry their names', () => {
  const t = (id, more = {}) => ({ id, name: 'step ' + id + ': the detail', waitsOn: [], ...more });
  const many = ['T-1', 'T-2', 'T-4', 'T-5', 'T-6', 'T-7'];
  const view = { id: 'TR-11', name: 'Line', chain: 'TR-11 under TR-4', text: '3 open', done: 0, total: 3, readySet: [],
    now: [{ id: 'T-1', name: 'step T-1', session: 'me', word: { is: 'running', worker: 'session', session: 'me' } }], names: { 'T-4': 'far step: x' },
    critical: { length: 3, path: ['T-1', 'T-2', 'T-3'] }, sideTracks: [], junction: { track: { id: 'TR-4' }, task: null },
    tasks: [t('T-1'), t('T-2'), t('T-3', { waitsOn: many.map((id) => 'after ' + id + (id === 'T-4' ? ' on TR-5' : '')) })] };
  const text = kickoffText({ view, waits: [], answers: [], stalls: [], runBy: {}, reader: 'me' }, { mode: 'resumed' });
  const now = text.split('\n').find((l) => l.startsWith('Running ('));
  assert.ok(now.includes('T-1') && now.includes('this session') && !now.includes('T-2'), now);
  assert.ok(!/run by|It left|to go/.test(text), text);
  const chain = text.split('\n').find((l) => /longest chain/i.test(l));
  assert.ok(['T-1 step T-1', 'T-2 step T-2', 'T-3 step T-3'].every((x) => chain.includes(x)), chain);
  const waits = text.split('\n').find((l) => l.startsWith('- T-3'));
  assert.ok(waits.includes('T-4 far step on TR-5') && /3 more/.test(waits) && !waits.includes('T-7'), 'the first few named, the rest counted: ' + waits);
});
