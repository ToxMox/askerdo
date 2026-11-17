/* The remote branch a git checkout catches up to, shared by askerdo status and the live update. */
import { spawnSync } from 'node:child_process';

const run = (dir, args) => {
  const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
  return r.status === 0 ? (r.stdout || '').trim() : '';
};

/* <remote>/<current branch> when that ref exists, since a dev branch made by hand may track
   main; else the configured upstream. { ref, remote, branch } or null (detached, or neither). */
export function aimRef(dir) {
  const branch = run(dir, ['symbolic-ref', '-q', '--short', 'HEAD']);
  if (!branch) return null;
  const set = run(dir, ['config', '--get', 'branch.' + branch + '.remote']);
  const remote = set && set !== '.' ? set : 'origin';
  if (run(dir, ['rev-parse', '--verify', '-q', 'refs/remotes/' + remote + '/' + branch])) return { ref: remote + '/' + branch, remote, branch };
  const up = run(dir, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
  const merge = run(dir, ['config', '--get', 'branch.' + branch + '.merge']).replace(/^refs\/heads\//, '');
  if (!up || !set || set === '.' || !merge) return null;
  return { ref: up, remote: set, branch: merge };
}
