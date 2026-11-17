/* a folder's checkout is kept between calls, never past a change of the .git files it rests on. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tempDir } from './helpers/sandbox.mjs';
import { checkoutOf, checkoutOfLater } from '../lib/project-id.mjs';

test('a kept checkout follows a worktree made, removed and a repo started inside it', async () => {
  const root = tempDir('askerdo-handoffs-').replace(/\\/g, '/');
  const main = root + '/demo';
  const lane = root + '/lane';
  mkdirSync(main + '/.git/worktrees/lane', { recursive: true });
  writeFileSync(main + '/.git/worktrees/lane/commondir', '../..\n');
  mkdirSync(lane + '/sub', { recursive: true });
  const both = async (dir) => { const a = checkoutOf(dir); assert.equal(await checkoutOfLater(dir), a); return a; };
  assert.equal(await both(lane + '/sub'), lane + '/sub', 'no repo: the folder itself');
  writeFileSync(lane + '/.git', 'gitdir: ' + main + '/.git/worktrees/lane\n');
  assert.equal(await both(lane + '/sub'), main, 'a worktree made since: its main checkout');
  mkdirSync(lane + '/sub/.git');
  assert.equal(await both(lane + '/sub'), lane + '/sub', 'a repo started inside it');
  rmSync(lane + '/sub/.git', { recursive: true });
  rmSync(lane + '/.git');
  assert.equal(await both(lane + '/sub'), lane + '/sub', 'the worktree gone');
});
