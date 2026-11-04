/* the onboarding plan from the user's marks: order and refs, original dates
 * and the import label, and what is left out or still waits on the session. */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildPlan, chatGo } from '../skills/onboard/plan.mjs';
import { quietWrite } from '../skills/onboard/apply.mjs';

const AT1 = '2026-02-01T10:00:00Z';
const AT2 = '2026-03-01T10:00:00Z';
const doc = {
  project: { dir: 'C:/work/proj', slug: 'proj', shared: 'github.com/someone/proj' },
  /* a profile named like the project, held by another one */
  board: { profiles: [{ profile: 'proj', records: ['C:/work/other'], elsewhere: true, rules: [] }] },
  rows: [
    { id: 'ws:main', home: 'workstream', title: 'proj', date: '2026-01-02', where: { file: 'README.md' }, fields: { key: 'main', name: 'proj' } },
    { id: 'track:a', home: 'track', title: 'Line A', date: '2026-02-01', where: { file: 'HANDOFF.md' },
      fields: { name: 'Line A', state: 'waiting', history: [{ path: 'HANDOFF.md', commit: 'c1', at: AT1 }, { path: 'HANDOFF.md', commit: 'c2', at: AT2 }] } },
    { id: 'task:done', home: 'task', title: 'Done thing', date: '2026-02-03', where: { file: 'TODO.md', line: 3 }, fields: { status: 'completed', track: 'track:a' } },
    { id: 'task:open', home: 'task', title: 'Open thing', date: '2026-02-04', where: { file: 'TODO.md', line: 4 }, fields: { status: 'open', track: 'track:a' } },
    { id: 'decision:d1', home: 'decision', title: 'Use X', date: '2026-01-15', where: { file: 'DECISIONS.md', line: 10 }, fields: {} },
    { id: 'question:q1', home: 'question', title: 'Q1 which way', date: '2026-01-18', where: { file: '.claude/questions/s/Q1-which.md' }, fields: { ask: 'Which way (a) or (b), the one Q1 left open in Q1-which.md?' } },
    { id: 'rule:r1', home: 'rule', title: 'Keep it short', date: '2026-01-19', where: { file: 'CLAUDE.md', line: 5 }, fields: { profile: 'proj', slug: 'keep-it-short', text: 'Keep it short.' } },
    { id: 'memo:left', home: 'knowledge', title: 'An old fact', date: '2026-01-20', where: { file: 'memory/fact.md' }, fields: {} },
    { id: 'task:convert', home: 'task', title: 'Reshape me', date: '2026-01-21', where: { file: 'TODO.md', line: 9 }, fields: { status: 'open' } },
  ],
};
const choices = { done: true, items: { 'memo:left': { choice: 'leave' }, 'task:convert': { choice: 'convert', note: 'a decision, not a task' } } };

test('the marks become the plan: refs in order, old dates and the label carried, leaves and unreworked converts held out', () => {
  const plan = buildPlan(doc, choices, { readVersion: (v) => 'state at ' + v.commit, session: 's1' });
  assert.deepEqual(plan.steps.map((s) => s.op),
    ['ws create', 'task create', 'task create', 'track new', 'handoff write', 'handoff write', 'decide', 'register', 'profile rule-add', 'profile add']);

  const track = plan.steps.find((s) => s.op === 'track new');
  assert.equal(track.args[track.args.indexOf('--workstream') + 1], '@{ws:main}');
  assert.deepEqual(track.args.filter((a, i) => track.args[i - 1] === '--task'), ['@{task:done}', '@{task:open}']);
  assert.deepEqual(['--label', '--ref'].map((f) => track.args[track.args.indexOf(f) + 1]), ['import:proj', 'onboard:track:a'], 'K-654: the track carries the label');

  const handoffs = plan.steps.filter((s) => s.op === 'handoff write');
  assert.deepEqual(handoffs.map((s) => s.args[2]), ['@{track:a}', '@{track:a}']);
  assert.deepEqual(handoffs.map((s) => s.stdin.created), [AT1, AT2], 'oldest first, each with its commit stamp');
  assert.match(handoffs[0].stdin.state, /state at c1/);

  /* the session names who wrote each record, but never holds the tracks or hands its own tasks over */
  for (const s of [track, ...handoffs]) assert.ok(!s.args.includes('--session') && !(s.stdin && s.stdin.session), s.op + ' runs with no session');
  assert.equal(plan.steps[0].stdin.session, 's1');

  for (const s of plan.steps.filter((x) => x.stdin && x.op !== 'handoff write')) {
    const row = doc.rows.find((r) => r.id === s.row);
    assert.equal(s.stdin.created, row.date, s.row + ' keeps its old created');
    assert.ok(s.stdin.labels.includes('import:proj') && s.stdin.refs.includes('onboard:' + s.row), s.row + ' carries the label and its ref');
    assert.ok((s.stdin.description || s.stdin.body || s.stdin.gist).includes(row.date), s.row + ' says its old date in its text');
  }
  assert.deepEqual(plan.steps.filter((s) => s.op === 'task create').map((s) => s.stdin.status), ['completed', 'open']);
  const asked = plan.steps.find((s) => s.op === 'register').stdin;
  assert.ok(asked.workstream === '@{ws:main}' && asked.gist.includes('.claude/questions/s/Q1-which.md'), 'a question lands in the import\'s workstream, naming its old file');
  /* the board reads a bare Q-and-number token in prose as its own record, so the old label becomes the title */
  for (const k of ['name', 'ask']) assert.doesNotMatch(asked[k], /(^|[^/.\w])Q\d+\b(?!-[a-z])/, k + ' carries no old label');
  assert.match(asked.ask, /which way.* Q1-which\.md/, 'the old question is named by its title, its file name kept');

  /* the project's profile name is another project's on the board: a free one, reported */
  assert.equal(plan.steps.find((s) => s.op === 'profile rule-add').args[2], 'proj-2');
  assert.deepEqual(plan.steps.find((s) => s.op === 'profile add').args.slice(2, 4), ['C:/work/proj', 'proj-2']);
  assert.deepEqual(plan.profiles.map((p) => [p.asked, p.profile]), [['proj', 'proj-2']]);

  assert.deepEqual(plan.left, ['memo:left']);
  assert.deepEqual(plan.pending.map((p) => p.row), ['task:convert']);
  assert.equal(plan.marked, true);
});

test("a task row's after and runBy become the track's layout; a Convert reworked to leave is left; a question is tied to its track and gates", () => {
  const rows = [
    doc.rows[0],
    { ...doc.rows[1], fields: { name: 'Line A', state: 'waiting', history: [] } },
    { id: 'task:fix', home: 'task', title: 'Fix it', where: { file: 'STATE.md' }, fields: { status: 'open', track: 'track:a' } },
    { id: 'task:deploy', home: 'task', title: 'Deploy it', where: { file: 'STATE.md' }, fields: { status: 'open', track: 'track:a', after: ['task:fix'], runBy: 'agent:opus' } },
    /* a question that blocks imported tasks names its track and the tasks it gates */
    { id: 'question:go', home: 'question', title: 'Ship it?', where: { file: 'STATE.md' }, fields: { track: 'track:a', gates: ['task:deploy', 'T-7'] } },
    { id: 'task:stale', home: 'none', title: 'Stale brief', where: { file: 'BRIEF.md' }, choice: 'leave', converted: true, fields: {} },
  ];
  const marks = { done: true, items: { 'task:stale': { choice: 'convert', note: 'is this stale?' } } };
  const plan = buildPlan({ ...doc, rows }, marks, { readVersion: () => '' });
  const ops = plan.steps.map((s) => s.op);
  assert.equal(ops[ops.indexOf('track new') + 1], 'track layout', 'the layout follows the track it lays out');
  const layout = plan.steps.find((s) => s.op === 'track layout');
  assert.equal(layout.args[2], '@{track:a}');
  assert.deepEqual(layout.stdin.steps, [{ task: '@{task:fix}' }, { task: '@{task:deploy}', after: ['@{task:fix}'], runBy: 'agent:opus' }]);
  const scope = plan.steps.find((s) => s.op === 'question edit');
  const at = (op, row) => plan.steps.find((s) => s.op === op && s.row === row).n;
  assert.ok(scope.n > Math.max(at('register', 'question:go'), at('track new', 'track:a'), at('task create', 'task:deploy')), 'the edit runs once its question, track and tasks exist');
  assert.equal(scope.args[2], '@{question:go}');
  assert.equal(scope.args[scope.args.indexOf('--track') + 1], '@{track:a}');
  assert.deepEqual(scope.args.filter((a, i) => scope.args[i - 1] === '--add-gate'), ['@{task:deploy}', 'T-7']);
  /* left from overrides, with the user's own mark untouched */
  assert.deepEqual(plan.left, ['task:stale']);
  assert.deepEqual(plan.pending, []);
  assert.equal(marks.items['task:stale'].choice, 'convert');
});

/* the write blocks for minutes, so the first call after it can fail; the pause it set is still lifted */
test('with no calls left, the go in chat marks the plan done with no page marks; an open call refuses it', () => {
  const plan = buildPlan(doc, chatGo(doc, null), { readVersion: () => '' });
  assert.equal(plan.marked, true);
  assert.ok(plan.steps.length > 0 && !plan.pending.length);
  const withCall = { ...doc, rows: [...doc.rows, { id: 'task:call', home: 'task', title: 'Which way', call: true, fields: {} }] };
  assert.throws(() => chatGo(withCall, null));
  assert.equal(chatGo(withCall, { items: { 'task:call': { choice: 'leave' } } }).done, true, 'a call marked on the page counts as settled');
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
});
