/* The store root's resolution, read over fake homes under the OS temp dir: the
   real user store is never touched and nothing here creates a store. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { seamRootProblem, storeRoot } from '../lib/node-helpers.mjs';
import { tempDir } from './helpers/sandbox.mjs';

const NEW = 'askerdo';

/* Each case gets its own home. */
function home(...slugs) {
  const dir = tempDir('askerdo-root-');
  for (const slug of slugs) mkdirSync(join(dir, '.claude', slug), { recursive: true });
  return dir;
}

test('the new root is taken when it is the only one', () => {
  const h = home(NEW);
  assert.equal(storeRoot(h, {}), join(h, '.claude', NEW));
});

test('neither root: the new path is answered and nothing is created', () => {
  const h = home();
  assert.equal(storeRoot(h, {}), join(h, '.claude', NEW));
  assert.equal(existsSync(join(h, '.claude', NEW)), false);
});

/* ---- the ASKERDO_ROOT seam, read before the default ------------- */

/* The env is HANDED IN everywhere above and below, so no case can inherit a
   variable from the runner and no case mutates the runner's environment. */
const seamDir = () => tempDir('askerdo-root-');
const logOf = (root) => {
  try { return readFileSync(join(root, 'log'), 'utf8').trim().split('\n'); } catch { return []; }
};

test('a seam naming an existing directory wins over the default', () => {
  const h = home(NEW);
  const rig = seamDir();
  assert.equal(storeRoot(h, { ASKERDO_ROOT: rig }), rig);
  assert.deepEqual(logOf(join(h, '.claude', NEW)), []);
  const log = logOf(rig);
  assert.equal(log.length, 1, log.join(' | '));
  assert.ok(log[0].includes('ASKERDO_ROOT'), log[0]);
  assert.ok(log[0].includes(rig), log[0]);
});

/* The harmless direction: a seam naming the live root answers the string the
   candidates would, so every guard keyed on it downstream behaves identically. */
test('a seam naming the root the candidates would have picked changes nothing', () => {
  const h = home(NEW);
  const same = join(h, '.claude', NEW);
  assert.equal(storeRoot(h, { ASKERDO_ROOT: same }), storeRoot(h, {}));
  assert.equal(storeRoot(h, { ASKERDO_ROOT: same }), same);
  /* a scheduled caller names the live store this way */
  assert.deepEqual(logOf(same), []);
});

test('a seam naming a path that does not exist falls through and creates nothing', () => {
  const h = home(NEW);
  const missing = join(seamDir(), 'never-made');
  const picked = storeRoot(h, { ASKERDO_ROOT: missing });
  assert.equal(picked, join(h, '.claude', NEW));
  assert.equal(existsSync(missing), false, 'the seam path was materialized');
  const log = logOf(picked);
  assert.equal(log.length, 1, log.join(' | '));
  assert.ok(log[0].includes('a path that does not exist'), log[0]);
  assert.ok(log[0].includes(missing), log[0]);
});

test('a seam naming a file falls through', () => {
  const h = home(NEW);
  const file = join(seamDir(), 'not-a-store');
  writeFileSync(file, 'x');
  const picked = storeRoot(h, { ASKERDO_ROOT: file });
  assert.equal(picked, join(h, '.claude', NEW));
  const log = logOf(picked);
  assert.equal(log.length, 1, log.join(' | '));
  assert.ok(log[0].includes('not a directory'), log[0]);
});

/* rootValue's own reason, one layer down: a root that silently became the
   current directory would materialize a live store wherever a caller stood. */
test('a relative seam falls through rather than resolving against the cwd', () => {
  const h = home(NEW);
  const picked = storeRoot(h, { ASKERDO_ROOT: 'rig/copy' });
  assert.equal(picked, join(h, '.claude', NEW));
  assert.equal(existsSync(join(process.cwd(), 'rig')), false);
  const log = logOf(picked);
  assert.equal(log.length, 1, log.join(' | '));
  assert.ok(log[0].includes('a relative path'), log[0]);
});

test('an empty or whitespace-only seam is the same as unset, and says nothing', () => {
  for (const v of ['', '   ']) {
    const h = home(NEW);
    assert.equal(storeRoot(h, { ASKERDO_ROOT: v }), join(h, '.claude', NEW),
      'value ' + JSON.stringify(v));
    assert.deepEqual(logOf(join(h, '.claude', NEW)), []);
  }
});

/* The line is worth saying once, not once per call: a hook resolves the root
   three times in one process and would otherwise write three of them. */
test('the fall-through line is written once per verdict, not once per call', () => {
  const h = home(NEW);
  const missing = join(seamDir(), 'gone');
  const picked = storeRoot(h, { ASKERDO_ROOT: missing });
  storeRoot(h, { ASKERDO_ROOT: missing });
  storeRoot(h, { ASKERDO_ROOT: missing });
  assert.equal(logOf(picked).length, 1, logOf(picked).join(' | '));
});

test('two seam values in one process answer differently, and neither moves the unset answer', () => {
  const h = home(NEW);
  const first = seamDir();
  const second = seamDir();
  assert.equal(storeRoot(h, { ASKERDO_ROOT: first }), first);
  assert.equal(storeRoot(h, { ASKERDO_ROOT: second }), second);
  assert.equal(storeRoot(h, {}), join(h, '.claude', NEW));
});

/* the sentence the two entry points refuse with. Four reasons and its null,
   with no environment mutation anywhere, because the env is an argument. */
test('the refusal helper names the value and the reason, and is null when there is nothing to say', () => {
  const rig = seamDir();
  const file = join(rig, 'a-file');
  writeFileSync(file, 'x');
  assert.equal(seamRootProblem({}), null, 'unset');
  assert.equal(seamRootProblem({ ASKERDO_ROOT: rig }), null, 'an existing directory');
  for (const [value, why] of [
    ['', 'set but empty'],
    ['   ', 'set but empty'],
    ['rig/copy', 'a relative path'],
    [file, 'not a directory'],
    [join(rig, 'never-made'), 'a path that does not exist'],
  ]) {
    const said = seamRootProblem({ ASKERDO_ROOT: value });
    assert.ok(said, 'no sentence for ' + JSON.stringify(value));
    assert.ok(said.includes(why), said);
    assert.ok(said.includes('ASKERDO_ROOT'), said);
    if (value.trim()) assert.ok(said.includes(value.trim()), said);
  }
});
