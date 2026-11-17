/* A project's identity on every machine: its git remote, normalised
   to host/owner/repo, so one repo at two paths on two PCs is one project. A folder
   with no remote keeps its path as its identity. */
import { promises as fsp, readFileSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { normDir, normRemote } from './repo-name.mjs';

export { normDir, normRemote };

const readText = (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } };
/* a missing path is no exception: a throw costs more than the stat */
const statOf = (p) => { try { return statSync(p, { throwIfNoEntry: false }) || null; } catch { return null; } };

/* What a walk's answer rests on: a .git folder by kind alone, a .git or commondir file by
   its time, size and id, an absent one by ''. */
const sigOf = (st) => (!st ? '' : st.isDirectory() ? 'dir' : st.mtimeMs + ':' + st.size + ':' + st.ino);

/* each walk's answer is kept with the stats it rests on; a call stats them again
   (no reads) and walks afresh only when one moved, so a stale answer is never served */
const gitMemo = new Map();

/* The walk up from a folder, as steps a driver runs sync or off the loop: ['stat', p] or
   ['read', p] answered by the stat or the text; its return is the answer and its checks. */
function* walk(start) {
  const hit = gitMemo.get(start);
  if (hit) {
    let same = true;
    for (const [p, s] of hit.checks) if (sigOf(yield ['stat', p]) !== s) { same = false; break; }
    if (same) return hit.g && { ...hit.g };
  }
  const checks = [];
  const keep = (g) => {
    if (gitMemo.size > 500) gitMemo.clear();
    gitMemo.set(start, { g, checks });
    return g && { ...g };
  };
  let d = start;
  for (;;) {
    const dot = join(d, '.git');
    const st = yield ['stat', dot];
    checks.push([dot, sigOf(st)]);
    let gd = '';
    if (st && st.isDirectory()) gd = dot;
    else if (st && st.isFile()) {
      const m = /^gitdir:\s*(.+?)\s*$/m.exec((yield ['read', dot]) || '');
      if (m) gd = resolve(d, m[1]);
    }
    if (gd) {
      const cd = join(gd, 'commondir');
      const cst = yield ['stat', cd];
      checks.push([cd, sigOf(cst)]);
      const common = cst ? ((yield ['read', cd]) || '').trim() : '';
      return keep({ top: d, common: common ? resolve(gd, common) : gd });
    }
    const up = dirname(d);
    if (up === d) return keep(null);
    d = up;
  }
}

/* The checkout a folder sits in and its shared git dir: a worktree's or
   submodule's .git file names its own dir, whose commondir names the shared one. */
export function gitOf(dir) {
  const w = walk(resolve(dir));
  for (let s = w.next(); ; ) {
    if (s.done) return s.value;
    s = w.next(s.value[0] === 'stat' ? statOf(s.value[1]) : readText(s.value[1]));
  }
}

/* gitOf with its stats and reads in the thread pool, so a server's loop never waits on them */
const statLater = (p) => fsp.stat(p).catch(() => null);
const readLater = (p) => fsp.readFile(p, 'utf8').catch(() => null);
export async function gitOfLater(dir) {
  const w = walk(resolve(dir));
  for (let s = w.next(); ; ) {
    if (s.done) return s.value;
    s = w.next(await (s.value[0] === 'stat' ? statLater(s.value[1]) : readLater(s.value[1])));
  }
}

function configOf(dir) {
  const g = gitOf(dir);
  return g ? readText(join(g.common, 'config')) || '' : '';
}

const slashed = (p) => String(p).replace(/\\/g, '/').replace(/(.)\/+$/, '$1');

/* the main checkout of the repo an absolute folder sits in (a worktree's
   is the folder holding the shared .git, as git rev-parse --git-common-dir names
   it), else the folder itself; forward slashes, its own casing. */
export function checkoutOf(dir) {
  if (!dir || !isAbsolute(String(dir))) return '';
  return checkoutFrom(dir, gitOf(String(dir)));
}
const checkoutFrom = (dir, g) => (!g ? slashed(resolve(String(dir)))
  : slashed(/^\.git$/i.test(basename(g.common)) ? dirname(g.common) : g.top));

/* checkoutOf off the loop (gitOfLater) */
export async function checkoutOfLater(dir) {
  if (!dir || !isAbsolute(String(dir))) return '';
  return checkoutFrom(dir, await gitOfLater(String(dir)));
}

/* The checkout's own top: a worktree's own folder, not its main checkout. */
export function topOf(dir) {
  const g = dir && isAbsolute(String(dir)) ? gitOf(String(dir)) : null;
  return g ? slashed(g.top) : '';
}

/* the name a project is known by on every PC: its normalised remote,
   else its main checkout's path (only its own PC resolves that one). */
export function sharedName(dir) {
  if (!dir || !isAbsolute(String(dir))) return '';
  return repoOf(dir) || normDir(checkoutOf(dir));
}

/* A shared name that is a folder path, not a remote. */
export const isPathName = (name) => /^([a-z]:)?\//i.test(String(name || ''));

/* A shared name as a person reads it: the repo's or folder's last part. */
export const shortName = (name) => String(name || '').split('/').filter(Boolean).pop() || '';

/* origin's url, else the first remote's */
function remoteUrl(config) {
  const urls = new Map();
  let remote = null;
  for (const line of config.split(/\r?\n/)) {
    const head = /^\s*\[\s*([^\]\s"]+)(?:\s+"([^"]*)")?\s*\]/.exec(line);
    if (head) { remote = head[1].toLowerCase() === 'remote' ? head[2] || '' : null; continue; }
    const kv = remote !== null && /^\s*url\s*=\s*(.+?)\s*$/i.exec(line);
    if (kv && !urls.has(remote)) urls.set(remote, kv[1]);
  }
  return urls.get('origin') || urls.values().next().value || '';
}

/* kept a short while, not a server's life: a remote added later is seen */
const MEMO_MS = 30000;
const memo = new Map();

/* The normalised remote of the checkout an absolute folder sits in, '' without one. */
export function repoOf(dir) {
  if (!dir || !isAbsolute(String(dir))) return '';
  const k = normDir(dir);
  const hit = memo.get(k);
  if (hit && Date.now() - hit.at < MEMO_MS) return hit.repo;
  const repo = normRemote(remoteUrl(configOf(String(dir))));
  if (memo.size > 500) memo.clear();
  memo.set(k, { at: Date.now(), repo });
  return repo;
}

/* What a project filter compares: the folder's path and its remote. */
export function projectScope(dir) {
  return dir ? { dir: normDir(dir), repo: repoOf(dir) } : null;
}

/* A record's place matches the scope by remote when both carry one, else by path,
   so a record written before the remote was stored still matches where it was. */
export function inProject(scope, dir, repo) {
  if (!scope) return true;
  if (scope.repo && repo) return scope.repo === repo;
  return !!dir && normDir(dir) === scope.dir;
}

/* A path named on another machine, moved onto this machine's checkout of the
   same remote. `places` are { dir, repo } pairs the store knows; the path comes
   back as given when it exists here or no checkout here matches. */
export function rebasePath(path, places) {
  const p = String(path || '');
  if (!p || statOf(p)) return p;
  const want = normDir(p);
  const from = (places || []).filter((x) => x && x.dir && x.repo
    && (want === normDir(x.dir) || want.startsWith(normDir(x.dir) + '/')))
    .sort((a, b) => normDir(b.dir).length - normDir(a.dir).length)[0];
  if (!from) return p;
  const here = (places || []).find((x) => x && x.dir && x.repo === from.repo && statOf(x.dir) && repoOf(x.dir) === from.repo);
  if (!here) return p;
  const rest = p.replace(/\\/g, '/').slice(normDir(from.dir).length);
  return here.dir.replace(/\\/g, '/').replace(/\/+$/, '') + rest;
}
