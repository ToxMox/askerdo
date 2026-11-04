/* The CLI's help: one table drives the index and every verb's --help.
 * test/server-questions.test.mjs covers the question verbs. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { childEnv, tempDir } from './helpers/sandbox.mjs';
import { runCli } from './helpers/cli.mjs';

test('help lists every verb, and --help prints each one from the same table', async () => {
  /* help reaches no board, so a bare home is enough */
  const home = tempDir('askerdo-qfix-cli-');
  const run = (args) => runCli(args, { env: { ...childEnv(), HOME: home, USERPROFILE: home } });
  const index = await run(['help']);
  assert.equal(index.code, 0, index.err);
  const verbs = index.out.split('\n').filter((l) => l.startsWith('  ')).map((l) => l.trim().split(':')[0]);
  assert.ok(verbs.length > 30 && verbs.includes('note') && verbs.includes('question edit'), index.out);
  /* the user's name fills every {user}, in the index and each verb's help alike */
  assert.ok(!index.out.includes('{user}'), index.out);
  for (const v of verbs) {
    const r = await run([...v.split(' '), '--help']);
    assert.equal(r.code, 0, v + ': ' + r.err);
    assert.ok(r.out.startsWith('askerdo ' + v), v + ': ' + r.out);
    assert.ok(!r.out.includes('{user}'), v + ': ' + r.out);
    if (v !== 'help') assert.ok(r.out.includes('--json'), v);
  }
  const note = (await run(['help', 'note'])).out;
  assert.ok(note.startsWith('askerdo note') && note.includes('--body') && note.includes('stdin'), note);
  assert.ok((await run(['question', 'edit', '--help'])).out.includes('--add-gate'));
  assert.match((await run(['ws', '--help'])).out, /^askerdo ws create\n[\s\S]*askerdo ws close/);
  assert.equal((await run(['help', 'nope'])).code, 1);
});
