/* show on a board: a task's block or the brief form by default, an id from the old knowledge store read
 * through the legacy map, and a search. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { childEnv, tempDir } from './helpers/sandbox.mjs';

const DESCRIPTION = 'A task with all three sections.';
const INTENT = 'Goal: a record read once. Acceptance: nothing prints twice.';
const NOTES = ['picked this up', 'the formatter landed', 'measured on the live store'];

/* On a board a read is below full by default, and its last line says what it cut and
   how to get it back. */
test('on a board show prints a task block or the brief form by default and names its cut, search finds a note, and an old knowledge-store id reads through the legacy map', async () => {
  const { runCommand } = await import('../lib/cli-commands.mjs');
  const { boardCall } = await import('../lib/board-call.mjs');
  const { openDb } = await import('../server/db.mjs');
  const home = tempDir('askerdo-brief-cli-');
  /* a file: board, so the case can write the legacy map's rows beside the CLI */
  const file = join(home, 'board.db').replace(/\\/g, '/');
  const env = { ...childEnv(), HOME: home, USERPROFILE: home, ASKERDO_BOARD_URL: 'file:' + file };
  const ws = await boardCall('createRecord', { kind: 'workstream', name: 'Board reads', description: 'One board.' }, { env });
  const t = await boardCall('createRecord', { kind: 'task', name: 'Read levels', workstream: ws.id, description: DESCRIPTION, intent: INTENT, wake: '2099-01-01' }, { env });
  for (const text of NOTES) await boardCall('noteRecord', { id: t.id, text }, { env });
  for (const text of ['draft the levels', 'cut the journal']) await boardCall('addItem', { task: t.id, text }, { env });
  await boardCall('checkItem', { task: t.id, item: 1, done: true }, { env });
  const cli = (...argv) => runCommand({ argv, cwd: home, env });
  const show = async (...more) => {
    const r = await cli('show', t.id, ...more);
    assert.equal(r.code, 0, r.stderr);
    return { out: r.stdout, last: r.stdout.trimEnd().split('\n').pop() };
  };

  /* a task's default is its block: every typed note since its last rewrite, and the cut named */
  const block = await show();
  assert.ok(block.out.includes(INTENT) && NOTES.every((n) => block.out.includes(n)) && block.out.includes('cut the journal') && !block.out.includes('draft the levels'), block.out);
  assert.ok(block.last.includes('--journal') && block.last.includes('--full'), block.last);
  const brief = await show('--brief');
  assert.ok(brief.out.includes(INTENT) && !NOTES.some((n) => brief.out.includes(n)), 'the brief form leaves the journal out');
  assert.ok(/journal/.test(brief.last) && brief.last.includes('3') && brief.last.includes('--full'), brief.last);
  const tail = await show('--journal-tail', '1');
  assert.ok(tail.out.includes(NOTES[2]) && !tail.out.includes(NOTES[0]));
  assert.ok(/2 of 3/.test(tail.last) && tail.last.includes('--full'), 'a cut journal says how much it cut: ' + tail.last);
  const full = await show('--full');
  assert.ok(NOTES.every((n) => full.out.includes(n)) && !full.out.includes('--full'), 'full leaves nothing out and names no cut');
  const whole = JSON.parse((await show('--json')).out);
  assert.ok(whole.journal.includes(NOTES[0]), '--json alone stays the whole record scripts read');
  /* the checklist reads in every form, each step with its index and done mark */
  assert.deepEqual(whole.checklist.map((c) => [c.n, c.done]), [[1, true], [2, false]]);
  for (const out of [brief.out, full.out, (await show('--section', 'checklist')).out]) {
    assert.ok(/1 \[x\] draft the levels/.test(out) && /2 \[ \] cut the journal/.test(out), out);
  }
  /* task block reads several tasks in one call, a block each */
  const t2 = await boardCall('createRecord', { kind: 'task', name: 'Second read', workstream: ws.id, description: 'Two.', wake: '2099-01-01' }, { env });
  const two = await cli('task', 'block', t.id, t2.id, '--json');
  assert.deepEqual(JSON.parse(two.stdout).map((b) => b.id), [t.id, t2.id], two.stderr);
  /* a task with an open run reads its word, as track show does, never the stored open */
  await boardCall('taskUpdate', { id: t2.id, inHand: true }, { env, session: 'w1' });
  const heads = [(await cli('show', t2.id)).stdout.split('\n')[1], (await cli('task', 'block', t2.id)).stdout.split('\n')[0], (await cli('show', t2.id, '--brief')).stdout.split('\n')[0]];
  assert.ok(heads.every((l) => /running/.test(l) && !/\bopen\b/.test(l)), heads.join('\n'));
  /* the session reading its own run: show takes it from the shell, task block only from --session,
     since a dispatched agent reads the block through the session's shell */
  const own = { ...env, CLAUDE_CODE_SESSION_ID: 'w1' };
  const mine = [(await runCommand({ argv: ['show', t2.id], cwd: home, env: own })).stdout.split('\n')[1],
    (await runCommand({ argv: ['show', t2.id, '--brief'], cwd: home, env: own })).stdout.split('\n')[0],
    (await cli('task', 'block', t2.id, '--session', 'w1')).stdout.split('\n')[0]];
  assert.ok(mine.every((l) => l.includes('this session')), mine.join('\n'));
  const agent = (await runCommand({ argv: ['task', 'block', t2.id], cwd: home, env: own })).stdout.split('\n')[0];
  assert.ok(!agent.includes('this session') && heads.every((l) => !l.includes('this session')), agent);
  /* a plain show logs its read under the session Claude Code names in the shell; an id copied
     from the desktop pane carries a word joiner after its hyphen, which the CLI reads past */
  const named = await runCommand({ argv: ['show', t.id.replace('-', '-' + String.fromCharCode(0x2060))], cwd: home, env: { ...env, CLAUDE_CODE_SESSION_ID: 'reader-1' } });
  assert.equal(named.code, 0, named.stderr);

  /* a question's head names its track and its pick, as --full does */
  const tr = await boardCall('newTrack', { name: 'Line', workstream: ws.id }, { env });
  const q = await boardCall('register', { name: 'sample levels length', gist: 'One length.', blocking: false, ask: 'Short (a, my pick) or long (b)?',
    pick: 'a', options: ['a', 'b'].map((type) => ({ type, option: type, getsYou: 'x', costsYou: '' })), workstream: ws.id, track: tr.id,
    session: 's1', projectDir: home, gates: [t.id] }, { env });
  const head = await cli('show', q.id, '--head');
  assert.equal(head.code, 0, head.stderr);
  const line = head.stdout.split('\n')[0];
  assert.ok(line.includes(ws.id) && line.includes(tr.id) && line.includes('pick ' + q.id.slice(1) + 'a'), line);
  /* the gated task's waiting word names the question once, in the head line and the brief head */
  for (const more of [['--head'], ['--brief']]) {
    const gated = (await cli('show', t.id, ...more)).stdout.split('\n')[0];
    assert.equal(gated.split(q.id).length, 2, gated);
  }
  /* answered against the recommendation, the head names the answer, never the pick */
  await boardCall('answer', { id: q.id, pick: 'b' }, { env });
  for (const more of [['--head'], ['--brief']]) {
    const answered = (await cli('show', q.id, ...more)).stdout.split('\n')[0];
    assert.ok(answered.includes(q.id.slice(1) + 'b') && !answered.includes(q.id.slice(1) + 'a'), answered);
  }
  /* the whole record form carries the answer as chosen beside the stored pick */
  const wholeQ = JSON.parse((await cli('show', q.id, '--json')).stdout);
  assert.deepEqual([wholeQ.chosen, wholeQ.pick], ['b', 'a']);

  /* the board has no other search case: a note's word finds the task and prints the line */
  const found = await cli('search', 'formatter');
  assert.equal(found.code, 0, found.stderr);
  assert.ok(found.stdout.includes(t.id) && found.stdout.includes(NOTES[1]), found.stdout);
  /* the tab filters before the count, which the board does in one statement */
  const tabbed = async (...f) => { const r = JSON.parse((await cli('search', 'levels', '--json', ...f)).stdout); return [r.total, r.hits.map((h) => h.id)]; };
  assert.deepEqual([await tabbed('--tab', 'questions'), await tabbed('--tab', 'work'), (await tabbed())[0]], [[1, [q.id]], [1, [t.id]], 2]);
  /* knowledge new's near check (uncounted searches) still names the close record */
  const k1r = await runCommand({ argv: ['knowledge', 'new', '--type', 'gotcha', '--title', 'Formatter levels drift', '--global', '--json'], cwd: home, env, stdin: 'one' });
  assert.equal(k1r.code, 0, k1r.stderr);
  const k1 = JSON.parse(k1r.stdout);
  const k2 = await runCommand({ argv: ['knowledge', 'new', '--type', 'gotcha', '--title', 'Formatter levels again', '--global', '--json'], cwd: home, env, stdin: 'two' });
  assert.ok(k2.code === 0 && k2.stderr.includes('close to ' + k1.id), k2.stderr);
  /* a knowledge search is the caller's project's and the global records unless it names every project */
  const k3r = await runCommand({ argv: ['knowledge', 'new', '--type', 'gotcha', '--title', 'Drift elsewhere', '--project', join(home, 'elsewhere'), '--json'], cwd: home, env, stdin: 'three' });
  const k3 = JSON.parse(k3r.stdout);
  const drift = async (cwd, ...f) => JSON.parse((await runCommand({ argv: ['search', 'drift', '--kind', 'knowledge', '--json', ...f], cwd, env })).stdout).hits.map((h) => h.id).sort();
  assert.deepEqual([await drift(home), await drift(join(home, 'elsewhere')), await drift(home, '--all-projects')], [[k1.id], [k1.id, k3.id].sort(), [k1.id, k3.id].sort()]);

  /* an old knowledge-store id held by two projects: one became the task, the other
     only an archive */
  const db = openDb(file);
  assert.deepEqual(db.prepare('SELECT session FROM reads WHERE record = ?').all(t.key).map((r) => r.session), ['reader-1']);
  const add = db.prepare('INSERT INTO labels (label, key, kind, "from", "to", origin, position, extra) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  add.run('one:G-0004', t.key, null, null, null, 'brain', 0, JSON.stringify({ to: t.key }));
  add.run('two:G-0004', null, null, null, null, 'brain', 1, JSON.stringify({ archive: 'archive/brain/two/x.md' }));
  db.close();
  const both = await cli('legacy', 'G-0004');
  assert.equal(both.code, 1);
  assert.ok(both.stderr.includes('one:G-0004') && both.stderr.includes('two:G-0004'), 'an unqualified id names every project holding it: ' + both.stderr);
  const one = await cli('legacy', 'G-0004', '--project', 'one');
  assert.ok(one.code === 0 && one.stdout.includes(t.id), one.stderr || one.stdout);
  const mapped = await cli('show', 'one:G-0004');
  assert.equal(mapped.code, 0, mapped.stderr);
  const lines = mapped.stdout.split('\n');
  assert.ok(lines[0].includes('one:G-0004') && lines[0].includes(t.id) && mapped.stdout.includes(INTENT), 'the mapping line above the brief: ' + mapped.stdout);
  const archived = await cli('show', 'two:G-0004');
  assert.ok(archived.code === 0 && archived.stdout.includes('archive/brain/two/x.md'), archived.stderr || archived.stdout);
});
