/* The CLI through the local server's route, on a memory: board;
 * test/server-questions.test.mjs covers the verbs themselves. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { childEnv, tempDir } from './helpers/sandbox.mjs';
import { cliRoute, runCli } from './helpers/cli.mjs';

const payload = (over = {}) => JSON.stringify({
  name: 'store shape',
  ask: 'A single file (a) or a file per question (b, my pick)?',
  gist: 'How should the store be shaped?',
  blocking: true,
  projectDir: 'C:/repos/my-app',
  session: 'sess-a',
  options: [
    { type: 'a', option: 'single file', getsYou: 'simple', costsYou: 'contention' },
    { type: 'b', option: 'file per question', getsYou: 'isolation', costsYou: 'more files' },
  ],
  ...over,
});

test('through the local route: two folders at once each see their own, a git-reading verb runs in the caller, and a dead route runs it here', async () => {
  const home = tempDir('askerdo-cli-');
  const root = join(home, '.claude', 'askerdo');
  mkdirSync(root, { recursive: true });
  /* the seam pins the root: this process's own home is not the caller's */
  const env = { ...childEnv(), HOME: home, USERPROFILE: home, ASKERDO_ROOT: root, ASKERDO_BOARD_URL: 'memory:hub-cli-route' };
  const route = await cliRoute(root, env);
  const dirA = tempDir('askerdo-cli-');
  const dirB = tempDir('askerdo-cli-');
  try {
    for (const [dir, name] of [[dirA, 'in folder a'], [dirB, 'in folder b']]) {
      const r = await runCli(['register', '--json'], { env, input: payload({ name, projectDir: dir }) });
      assert.equal(r.code, 0, r.err);
    }
    /* each register posts twice: the server asks for stdin, then runs it */
    assert.ok(route.answered.length && route.answered.every((a) => a.status === 200), 'a board write runs in the server: ' + JSON.stringify(route.answered));

    /* a scan reads each repo's git log, which would hold the server's loop */
    const scan = await route.post({ argv: ['proc', 'scan'], cwd: dirA, env });
    assert.equal(scan.status, 409, JSON.stringify(scan.body));

    /* the server reads neither its own cwd nor the other call's */
    const names = ['list', '--names-line'];
    const [a, b] = await Promise.all([route.post({ argv: names, cwd: dirA, env }), route.post({ argv: names, cwd: dirB, env })]);
    for (const [r, mine, other] of [[a, 'in folder a', 'in folder b'], [b, 'in folder b', 'in folder a']]) {
      assert.equal(r.status, 200, r.body.error);
      assert.equal(r.body.code, 0, r.body.stderr);
      assert.ok(r.body.stdout.includes(mine) && !r.body.stdout.includes(other), r.body.stdout);
    }
    const read = await runCli(names, { env, cwd: dirA });
    assert.ok(read.code === 0 && read.out.includes('in folder a'), read.err);
    assert.equal(route.answered.at(-1).status, 200, 'a read through the launcher runs in the server');

    /* a server started from another copy (a worktree beside the install) may run other code under the same version */
    const local = join(root, 'board', 'local.json');
    const saved = readFileSync(local, 'utf8');
    writeFileSync(local, JSON.stringify({ ...JSON.parse(saved), code: 'file:///elsewhere/askerdo/' }));
    const before = route.answered.length;
    const other = await runCli(names, { env, cwd: dirA });
    assert.ok(other.code === 0 && other.out.includes('in folder a'), other.err);
    assert.equal(route.answered.length, before, 'the call ran in the caller');
    writeFileSync(local, saved);

    /* local.json outlives a server that stopped: nothing answers, so the command runs here */
    await route.close();
    const n = route.answered.length;
    const here = await runCli(names, { env, cwd: dirB });
    assert.equal(here.code, 0, here.err);
    assert.ok(here.out.includes('in folder b'), here.out);
    assert.equal(route.answered.length, n);
  } finally { await route.close(); }
});
