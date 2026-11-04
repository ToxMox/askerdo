/* Profiles from this PC's CLI, on a memory: board through the local route.
   test/server-profiles.test.mjs covers define, resolution, add, remove and the guard;
   test/mod-switch.test.mjs the markers. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { childEnv, tempDir } from './helpers/sandbox.mjs';
import { cliRoute, runCli } from './helpers/cli.mjs';

const APP = 'C:/repos/app';

test('the CLI on a board: profile define, add, the refused pair, show-effective, guard, list and remove; the home gets nothing', async () => {
  const home = tempDir('askerdo-prof-cli-');
  const root = join(tempDir('askerdo-prof-cli-'), 'askerdo');
  const env = childEnv({ HOME: home, USERPROFILE: home, ASKERDO_ROOT: root, ASKERDO_BOARD_URL: 'memory:profiles-cli' });
  const route = await cliRoute(root, env);
  const run = async (args, code = 0, input) => {
    const r = await runCli(args, { env, input });
    assert.equal(r.code, code, args.join(' ') + ': ' + r.err + r.out);
    return r;
  };
  const json = async (args, input) => JSON.parse((await run([...args, '--json'], 0, input)).out);
  try {
    const ws = (await json(['ws', 'create'], JSON.stringify({ name: 'ws', description: 'd', projects: [APP] }))).id;
    assert.equal((await json(['profile', 'define', 'deep-code', '--set', 'agent.soft=400k', '--set', 'agent.hard=500k', '--description', 'deep'])).created, true);
    assert.equal((await json(['profile', 'add', ws, 'deep-code'])).added, true);
    await run(['profile', 'add', ws], 1);
    await run(['profile', 'define', 'docs', '--set', 'agent.soft=300k']);
    assert.match((await run(['profile', 'add', ws, 'docs'], 1)).err, /agent\.soft/, 'two profiles on one record may not set the same key');
    const soft = (await json(['profile', 'show-effective', ws])).settings['agent.soft'];
    assert.deepEqual([soft.value, soft.profile, soft.record], [400000, 'deep-code', ws]);
    /* a record that does not exist is refused, not resolved */
    assert.match((await run(['profile', 'show-effective', 'WS-999'], 1)).err, /WS-999/);
    assert.equal((await json(['profile', 'guard', 'on', '--project', APP])).effective.settings['agent.on'].value, true);
    await run(['profile', 'guard', 'on'], 1);
    const listed = (await json(['profile', 'list'])).profiles.find((p) => p.profile === 'deep-code');
    assert.ok(JSON.stringify(listed.held).includes(ws), 'the list names where it is held');
    await run(['profile', 'remove', ws, 'deep-code']);
    assert.notEqual((await json(['profile', 'show-effective', ws])).settings['agent.soft'].profile, 'deep-code');
    assert.match((await run(['help', 'profile'])).out, /profile add/);
  } finally { await route.close(); }
  assert.deepEqual(readdirSync(home), [], 'the real home gets nothing');
});
