/* show on a board: the brief form by default, an id from the old knowledge store read
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
test('on a board show is brief by default and names its cut, search finds a note, and an old knowledge-store id reads through the legacy map', async () => {
  const { runCommand } = await import('../lib/cli-commands.mjs');
  const { boardCall } = await import('../lib/board-call.mjs');
  const { openDb } = await import('../server/db.mjs');
  const home = tempDir('askerdo-brief-cli-');
  /* a file: board, so the case can write the legacy map's rows beside the CLI */
  const file = join(home, 'board.db').replace(/\\/g, '/');
  const env = { ...childEnv(), HOME: home, USERPROFILE: home, ASKERDO_BOARD_URL: 'file:' + file };
  const ws = await boardCall('createRecord', { kind: 'workstream', name: 'Board reads', description: 'One board.' }, { env });
  const t = await boardCall('createRecord', { kind: 'task', name: 'Read levels', workstream: ws.id, description: DESCRIPTION, intent: INTENT }, { env });
  for (const text of NOTES) await boardCall('noteRecord', { id: t.id, text }, { env });
  const cli = (...argv) => runCommand({ argv, cwd: home, env });
  const show = async (...more) => {
    const r = await cli('show', t.id, ...more);
    assert.equal(r.code, 0, r.stderr);
    return { out: r.stdout, last: r.stdout.trimEnd().split('\n').pop() };
  };

  const brief = await show();
  assert.ok(brief.out.includes(INTENT) && !NOTES.some((n) => brief.out.includes(n)), 'the default is the brief form, journal left out');
  assert.ok(/journal/.test(brief.last) && brief.last.includes('3') && brief.last.includes('--full'), brief.last);
  const tail = await show('--journal-tail', '1');
  assert.ok(tail.out.includes(NOTES[2]) && !tail.out.includes(NOTES[0]));
  assert.ok(/2 of 3/.test(tail.last) && tail.last.includes('--full'), 'a cut journal says how much it cut: ' + tail.last);
  const full = await show('--full');
  assert.ok(NOTES.every((n) => full.out.includes(n)) && !full.out.includes('--full'), 'full leaves nothing out and names no cut');
  assert.ok(JSON.parse((await show('--json')).out).journal.includes(NOTES[0]), '--json alone stays the whole record scripts read');
  /* a plain show logs its read under the session Claude Code names in the shell */
  const named = await runCommand({ argv: ['show', t.id], cwd: home, env: { ...env, CLAUDE_CODE_SESSION_ID: 'reader-1' } });
  assert.equal(named.code, 0, named.stderr);

  /* a question's head names its track and its pick, as --full does */
  const tr = await boardCall('newTrack', { name: 'Line', workstream: ws.id }, { env });
  const q = await boardCall('register', { name: 'sample name length', gist: 'One length.', blocking: false, ask: 'Short (a, my pick) or long (b)?',
    pick: 'a', options: ['a', 'b'].map((type) => ({ type, option: type, getsYou: 'x', costsYou: '' })), workstream: ws.id, track: tr.id,
    session: 's1', projectDir: home }, { env });
  const head = await cli('show', q.id, '--head');
  assert.equal(head.code, 0, head.stderr);
  const line = head.stdout.split('\n')[0];
  assert.ok(line.includes(ws.id) && line.includes(tr.id) && line.includes('pick ' + q.id.slice(1) + 'a'), line);

  /* the board has no other search case: a note's word finds the task and prints the line */
  const found = await cli('search', 'formatter');
  assert.equal(found.code, 0, found.stderr);
  assert.ok(found.stdout.includes(t.id) && found.stdout.includes(NOTES[1]), found.stdout);

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
