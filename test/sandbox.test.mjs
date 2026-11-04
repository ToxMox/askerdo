/* The guard on test/helpers/sandbox.mjs: every mint site must go through
 * the helper and every prefix must be in its one table, asserted over the
 * suite's own source so a new file cannot quietly leak. */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SANDBOX_PREFIXES, dropTempDir, isSandboxName, tempDir } from './helpers/sandbox.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SELF = 'sandbox.test.mjs';
const suite = readdirSync(here).filter((n) => n.endsWith('.test.mjs'));
const sourceOf = (name) => readFileSync(join(here, name), 'utf8');

/* assembled rather than written out, so this file can name the call it bans
   without tripping its own scan; the stem alone, so every spelling node offers
   (the sync call, the callback form, the promise) trips it */
const RAW_MINT = 'mkd' + 'temp';

test('no test file mints a sandbox behind the helper', () => {
  const direct = suite.filter((name) => sourceOf(name).includes(RAW_MINT));
  assert.deepEqual(direct, [],
    'these files mint a temp directory themselves: route them through tempDir()'
    + ' in test/helpers/sandbox.mjs, so the removal and the guard know about them');
});

test('every registered prefix is one the suite actually mints', () => {
  /* this file's own source is read separately and only for the prefixes it
     MINTS, since it also names other prefixes as matcher fixtures below */
  const others = suite.filter((n) => n !== SELF).map(sourceOf).join('\n');
  const mine = sourceOf(SELF);
  const unused = SANDBOX_PREFIXES.filter((p) => !others.includes("'" + p + "'")
    && !mine.includes("tempDir('" + p + "'"));
  assert.deepEqual(unused, [],
    'these prefixes are in the table but nothing mints them any more');
});

test('an unregistered prefix is refused at the mint', () => {
  assert.throws(() => tempDir('nd-not-in-the-table-'), /unregistered sandbox prefix/);
});

test('a sandbox name is a registered prefix plus six characters, and nothing else', () => {
  assert.equal(isSandboxName('nd-board-Ab12cD'), true);
  assert.equal(isSandboxName('askerdo-loose-repo-000000'), true);
  assert.equal(isSandboxName('nd-board-'), false, 'a bare prefix is not a sandbox');
  assert.equal(isSandboxName('nd-board-abcd'), false, 'four characters is not the suffix');
  assert.equal(isSandboxName('nd-board-abcdefg'), false, 'seven characters is not the suffix');
  assert.equal(isSandboxName('nd-board-ab.123'), false, 'the suffix is alphanumeric');
  assert.equal(isSandboxName('claude'), false, 'the app scratch dir is out of range');
  assert.equal(isSandboxName('askerdo'), false, 'a real store name is out of range');
});

test('a sandbox handed a test context is removed when that test ends', (t) => {
  const inner = tempDir('nd-sandbox-', t);
  /* registered AFTER the mint on purpose: node runs these in the order they
     were added, which is the very reason a sandbox holding a spawned child
     does not take this path */
  t.after(() => {
    assert.equal(existsSync(inner), false, 'the per-test removal ran');
  });
  writeFileSync(join(inner, 'file.txt'), 'contents\n');
  assert.equal(existsSync(inner), true);
});

test('a removal refusal is never what fails a case', () => {
  const dir = tempDir('nd-sandbox-');
  dropTempDir(dir);
  assert.equal(existsSync(dir), false);
  /* twice, and on a path that was never a sandbox at all: both are silent */
  assert.doesNotThrow(() => dropTempDir(dir));
  assert.doesNotThrow(() => dropTempDir(join(dir, 'never', 'existed')));
});

/* The file-end path, proven by ordering: the helper registers its root hook
   when this file imports it, on the first import line, and node runs root
   hooks in the order they were added, so the one below runs after it. */
let leftForTheFileEnd = null;
after(() => {
  assert.equal(existsSync(leftForTheFileEnd), false,
    'a sandbox minted with no test context is removed at the end of the file');
});

test('a sandbox minted with no test context survives its own test', () => {
  leftForTheFileEnd = tempDir('nd-sandbox-');
  writeFileSync(join(leftForTheFileEnd, 'file.txt'), 'contents\n');
  assert.equal(existsSync(leftForTheFileEnd), true);
});
