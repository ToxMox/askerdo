/* scripts/run-tests.mjs: the process is the subject, so it is spawned.
   A test that writes into HOME fails a green run, and a red run exits with its own status. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { childEnv, tempDir } from './helpers/sandbox.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'run-tests.mjs');
/* the board and data-dir variables a spawned CLI would honour over the throwaway home */
const OUTSIDE = { ASKERDO_BOARD_URL: 'http://127.0.0.1:9', ASKERDO_BOARD_TOKEN: 'x', CLAUDE_PLUGIN_DATA: 'askerdo-elsewhere' };
const runOn = (file) => spawnSync(process.execPath, [SCRIPT, file], { encoding: 'utf8', env: childEnv(OUTSIDE), windowsHide: true });
const homeOf = (out) => (out.match(/run-tests: home (.+)/) || [])[1]?.trim();

test('a leftover in the throwaway home fails a passing run, and a failing run keeps its own exit status', (t) => {
  const dir = tempDir('askerdo-run-tests-', t);
  const leaves = join(dir, 'leaves.test.mjs');
  writeFileSync(leaves, "import { test } from 'node:test';\nimport { writeFileSync } from 'node:fs';\nimport { join } from 'node:path';\n"
    + "const seen = " + JSON.stringify(Object.keys(OUTSIDE)) + ".filter((k) => process.env[k] !== undefined);\n"
    + "test('writes home', () => writeFileSync(join(process.env.HOME, seen.length ? 'leaked-' + seen.join('-') : 'stray.txt'), 'x'));\n");
  const fails = join(dir, 'fails.test.mjs');
  writeFileSync(fails, "import { test } from 'node:test';\ntest('fails', () => { throw new Error('red'); });\n");

  const left = runOn(leaves);
  assert.notEqual(left.status, 0, left.stdout);
  assert.match(left.stdout, /stray\.txt/, 'the board and data-dir variables stay out of the child');
  assert.ok(homeOf(left.stdout) && !existsSync(homeOf(left.stdout)), 'the throwaway home is removed');

  const red = runOn(fails);
  assert.equal(red.status, 1, red.stdout);
  assert.doesNotMatch(red.stdout, /proc ran/);
});
