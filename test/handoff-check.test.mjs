/* Tests for the shared handoff template and the marker check. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { budgetsOf, checkHandoffDir, checkHandoffFiles } from '../lib/handoff-check.mjs';
import { childEnv, tempDir } from './helpers/sandbox.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const tpl = join(here, '..', 'templates', 'handoff');
const script = join(here, '..', 'scripts', 'check-handoff.mjs');
const read = (n) => readFileSync(join(tpl, n), 'utf8');
const files = () => Object.fromEntries(['README.md', 'now.md', 'rules.md', 'map.md'].map((n) => [n, read(n)]));

test('the template passes its own check, within its budgets', () => {
  const r = checkHandoffDir(tpl);
  assert.deepEqual(r.missing, []);
  assert.deepEqual(r.warnings, []);
  assert.ok(r.ok);
  assert.deepEqual(budgetsOf(read('README.md')), { 'now.md': 10240, 'rules.md': 11264, 'map.md': 16384, 'README.md': 5120 });
});

test('the template marker step is a no-op when the mod writes the marker', () => {
  const resume = read('README.md');
  assert.match(resume, /mod runs in this session it writes the marker itself/);
  assert.match(resume, /Writing the same content again changes nothing/);
  assert.match(read('now.md'), /already there when the AskerDo mod runs, otherwise written now/);
  for (const n of ['README.md', 'now.md', 'rules.md', 'map.md']) assert.ok(!/[\u2013\u2014]/.test(read(n)), n);
});

test('the check names each missing marker step', () => {
  const f = files();
  f['README.md'] = f['README.md'].replace(/Before anything else[\s\S]*?shallow session\.\n/, '');
  let r = checkHandoffFiles(f);
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ['README.md Resume has no depth-guard marker step']);
  f['now.md'] = f['now.md'].replace(/- Depth-guard marker[^\n]*\n/, '');
  f['README.md'] = f['README.md'].replace(/5\. Keep the depth-guard[^\n]*\n/, '5. Commit.\n');
  r = checkHandoffFiles(f);
  assert.deepEqual(r.missing, [
    'README.md Resume has no depth-guard marker step',
    'README.md "Writing a handoff" does not say to keep the marker step',
    'now.md Verify first has no depth-guard marker step',
  ]);
  assert.deepEqual(checkHandoffFiles({}).missing, ['README.md is missing', 'now.md is missing']);
  /* a folder whose handoffs live on a thread is asked for neither */
  assert.ok(checkHandoffFiles({ 'rules.md': read('rules.md') }, { onThread: true }).ok);
});

test('the verify-first script run with -SessionId counts as the marker step, past a heading inside a fence', () => {
  const now = '# Now\n\n## Verify first\n\n```md\n## not a heading\n```\n\n- `pwsh -File gates/verify-first.ps1 -ExpectedBuild abc -SessionId <session id>` passes.\n';
  const r = checkHandoffFiles({ 'README.md': '# H\n\n## Resume\n\nwrite depth-guard.json first\n', 'now.md': now });
  assert.ok(r.ok, r.missing.join('; '));
});

test('budgets and long lines are warnings, not failures', () => {
  const f = files();
  f['now.md'] += 'x'.repeat(10000) + '\n';
  const r = checkHandoffFiles(f);
  assert.ok(r.ok);
  assert.deepEqual(r.warnings, [
    'now.md is ' + Buffer.byteLength(f['now.md']) + ' bytes; its budget is 10240',
    'now.md has 1 line over 400 characters',
  ]);
});

test('the script exits 1 and names the miss for a folder without the step', () => {
  const dir = tempDir('ttd-handoff-check-');
  writeFileSync(join(dir, 'README.md'), '# H\n\n## Resume\n\n1. now.md\n');
  writeFileSync(join(dir, 'now.md'), '# Now\n\n## Verify first\n\n- git status\n');
  const r = spawnSync(process.execPath, [script, dir, tpl], { encoding: 'utf8', env: childEnv() });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /FAIL .*\n  missing: README\.md Resume has no depth-guard marker step\n  missing: now\.md Verify first has no depth-guard marker step\nPASS /);
});
