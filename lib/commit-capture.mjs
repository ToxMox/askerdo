/* which task a commit finished and what source it counted, the PC half of
   review coverage. No host access: git runs
   through the caller's `git(dir, args)` runner, { status, out }, so the mod's
   $.process.run and the backfill's execFile share one reader. */
import { normDir, normRemote } from './repo-name.mjs';

/* the board verb `commit link` */
export const LINK_VERB = 'commitLink';

const US = String.fromCharCode(31);
const RS = String.fromCharCode(30);
const slashed = (p) => String(p || '').replace(/\\/g, '/');

/* The T-n ids in a message's subject line. */
export function subjectIds(message) {
  const first = String(message || '').split(/\r?\n/)[0];
  return [...new Set(first.match(/\bT-\d+\b/g) || [])];
}

/* The sha the tool's record carries (gitOperation, unmeasured), else git's own
   `[branch abc1234]` line; '' when neither says. */
export function shaHint(result) {
  const r = result && typeof result === 'object' ? result : {};
  const c = r.gitOperation && r.gitOperation.commit;
  if (c && /^[0-9a-f]{7,64}$/i.test(String(c.sha || ''))) return { sha: String(c.sha), kind: String(c.kind || '') };
  const m = /^\[[^\]\n]*?\s([0-9a-f]{7,64})\]/m.exec(String(r.stdout || ''));
  return { sha: m ? m[1] : '', kind: '' };
}

const unquote = (s) => String(s || '').replace(/^(["'])(.*)\1$/, '$2');
const isAbs = (p) => /^([A-Za-z]:[\\/]|[\\/])/.test(p);
/* Git Bash's /c/x is C:/x where the session's folder has a drive */
const drive = (p, cwd) => (/^[A-Za-z]:/.test(cwd) ? p.replace(/^\/([A-Za-z])(?=\/|$)/, '$1:') : p);
const joined = (base, p) => {
  const q = drive(unquote(p), base);
  return isAbs(q) ? q : slashed(base).replace(/\/+$/, '') + '/' + q;
};

/* The folders a commit may have run in, likeliest first: each `git -C X`, each
   `cd X`, then the loop's own folder; the sha's lookup picks the one that has it. */
export function repoCandidates(command, cwd) {
  const gitDirs = [];
  const cdDirs = [];
  let here = String(cwd || '');
  for (const part of String(command || '').split(/&&|\|\||[;|\r\n]/)) {
    const cd = /^\s*(?:cd|pushd|Set-Location)\s+("[^"]*"|'[^']*'|\S+)\s*$/i.exec(part);
    if (cd && here) { here = joined(here, cd[1]); cdDirs.unshift(here); continue; }
    const g = /\bgit(?:\.exe)?\s+(?:-c\s+\S+\s+)*-C\s+("[^"]*"|'[^']*'|\S+)/i.exec(part);
    if (g && here) gitDirs.unshift(joined(here, g[1]));
  }
  const out = [];
  for (const d of [...gitDirs, ...cdDirs, String(cwd || '')]) if (d && !out.some((x) => normDir(x) === normDir(d))) out.push(d);
  return out;
}

/* The checkout holding a commit: its top, common git dir and full sha; HEAD with no sha. */
export async function findCommit(git, dirs, sha) {
  for (const d of dirs || []) {
    const r = await git(d, ['rev-parse', '--path-format=absolute', '--show-toplevel', '--git-common-dir', (sha || 'HEAD') + '^{commit}']);
    if (r.status !== 0) continue;
    const [top, common, full] = String(r.out).split(/\r?\n/).map((s) => s.trim());
    if (top && common && /^[0-9a-f]{40,64}$/.test(full || '')) return { top: slashed(top), common: slashed(common), sha: full };
  }
  return null;
}

/* The HEAD each folder holds, read at a commit call's start. */
export async function headsOf(git, dirs) {
  const out = [];
  for (const d of dirs || []) {
    const r = await git(d, ['rev-parse', 'HEAD^{commit}']);
    const sha = String(r.out || '').trim();
    if (r.status === 0 && /^[0-9a-f]{40,64}$/.test(sha)) out.push(sha);
  }
  return out;
}

/* The repo's shared name as repoOf and sharedName give it: origin's remote, else
   the first one's, else the main checkout's folder (one for a worktree and its main). */
export function repoName(remotes, top, common) {
  const urls = new Map();
  for (const line of String(remotes || '').split(/\r?\n/)) {
    const m = /^remote\.(.+)\.url\s+(.+)$/.exec(line.trim());
    if (m && !urls.has(m[1])) urls.set(m[1], m[2]);
  }
  const named = normRemote(urls.get('origin') || urls.values().next().value || '');
  if (named) return named;
  const c = slashed(common);
  return normDir(/\/\.git\/?$/i.test(c) ? c.replace(/\/\.git\/?$/i, '') : top);
}

/* a numstat rename, `a/{b => c}/d` or `old => new`, read as its new path */
const renamed = (p) => {
  const q = unquote(p);
  if (!q.includes(' => ')) return q;
  return q.replace(/\{([^{}]*) => ([^{}]*)\}/, '$2').replace(/^.* => /, '').replace(/\/{2,}/g, '/');
};

export const SHOW = ['-c', 'core.quotepath=off', 'show', '--format=%H%x1f%P%x1f%cI%x1f%B%x1e', '--numstat',
  '--no-color', '--no-ext-diff', '--no-textconv', '--diff-merges=first-parent'];

/* SHOW's answer: the sha, parents, time, message and each file's counts. */
export function parseShow(out) {
  const s = String(out || '');
  const end = s.indexOf(RS);
  if (end < 0) return null;
  const [sha, parents = '', at = '', ...msg] = s.slice(0, end).replace(/^\s+/, '').split(US);
  const files = [];
  for (const line of s.slice(end + 1).split(/\r?\n/)) {
    const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line);
    if (!m) continue;
    const binary = m[1] === '-';
    files.push({ path: renamed(m[3]), added: binary ? 0 : Number(m[1]), removed: binary ? 0 : Number(m[2]), binary });
  }
  return { sha: sha.trim(), parents: parents.split(' ').filter(Boolean), at: at.trim(), message: msg.join(US).trim(), files };
}

/* ---- what counts (the design's What counts) ------------------------------------- */

const LOCKFILES = new Set(['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lock', 'bun.lockb',
  'cargo.lock', 'poetry.lock', 'pipfile.lock', 'uv.lock', 'go.sum', 'gemfile.lock', 'composer.lock', 'packages.lock.json',
  'flake.lock', 'mix.lock', 'pubspec.lock', 'podfile.lock', 'gradle.lockfile']);
const TEXT = /\.(md|mdx|markdown|rst|txt|adoc)$/i;
/* docs and fixtures, and the build folders of IGNORE_RE (lib/loose-files.mjs) */
const DIRS = /(^|\/)(docs|fixtures|__snapshots__|golden|testdata|vendor|node_modules|dist|build|out|coverage|\.cache|__pycache__|\.venv|venv|\.next|target)\//i;
const BUILT = /\.(snap|map|pyc|pyo|o|obj)$|\.min\.[a-z]+$|\.generated\.|\.pb\.go$|_pb2\.py$/i;
const isSet = (v) => v === 'set' || v === 'true';

/* Whether a file's lines count as source: tests do; generated, vendored and
   documentation files, lockfiles, prose, fixtures and build output do not. */
export function counts(path, { binary = false, attrs = {}, head = false } = {}) {
  if (binary || head) return false;
  const a = attrs || {};
  if (isSet(a['linguist-generated']) || isSet(a['linguist-vendored']) || isSet(a['linguist-documentation']) || a.diff === 'unset') return false;
  const p = slashed(path);
  const base = p.split('/').pop().toLowerCase();
  if (LOCKFILES.has(base) || base.endsWith('.lock')) return false;
  return !(TEXT.test(base) || DIRS.test(p) || BUILT.test(base));
}

const ATTRS = ['linguist-generated', 'linguist-vendored', 'linguist-documentation', 'diff'];

/* `git check-attr` lines, `path: attr: value`, by path. */
export function parseAttrs(out) {
  const by = new Map();
  for (const line of String(out || '').split(/\r?\n/)) {
    const m = /^(.*): ([^:\s]+): (\S+)$/.exec(line);
    if (!m) continue;
    const path = unquote(m[1]);
    by.set(path, { ...(by.get(path) || {}), [m[2]]: m[3] });
  }
  return by;
}

/* `git grep -n <sha>` lines, `sha:path:line:text`, as the paths marked in their first five lines. */
export function parseHeads(out) {
  const paths = new Set();
  for (const line of String(out || '').split(/\r?\n/)) {
    const m = /^[^:]+:(.*?):(\d+):/.exec(line);
    if (m && Number(m[2]) <= 5) paths.add(m[1]);
  }
  return paths;
}

const HEAD_MARK = '@generated|do not edit';

/* One commit read: SHOW, then the attributes and head marks of the files the
   path rules left; a merge links no files (its parents' commits carry them). */
export async function readCommit(git, top, sha) {
  const r = await git(top, [...SHOW, sha]);
  if (r.status !== 0) return null;
  const c = parseShow(r.out);
  if (!c || !c.sha) return null;
  if (c.parents.length > 1) c.files = [];
  const left = c.files.filter((f) => counts(f.path, f)).map((f) => f.path);
  const attrs = new Map();
  const heads = new Set();
  /* batches keep Windows' command line short */
  for (let i = 0; i < left.length; i += 100) {
    const paths = left.slice(i, i + 100);
    const a = await git(top, ['-c', 'core.quotepath=off', 'check-attr', ...ATTRS, '--', ...paths]);
    if (a.status === 0) for (const [k, v] of parseAttrs(a.out)) attrs.set(k, v);
    const g = await git(top, ['--literal-pathspecs', '-c', 'core.quotepath=off', 'grep', '-n', '-i', '-I', '-E', HEAD_MARK, c.sha, '--', ...paths]);
    if (g.status === 0) for (const p of parseHeads(g.out)) heads.add(p);
  }
  const files = c.files.map((f) => ({ path: f.path, added: f.added, removed: f.removed,
    counted: counts(f.path, { binary: f.binary, attrs: attrs.get(f.path), head: heads.has(f.path) }) }));
  const sum = (k) => files.reduce((n, f) => n + (f.counted ? f[k] : 0), 0);
  return { sha: c.sha, at: c.at, message: c.message, files, added: sum('added'), removed: sum('removed') };
}

/* ---- which task (the design's order, first match wins) -------------------------- */

/* The board's tasks whose free-text agent tag is one of the spawn's names. */
export function taggedTasks(view, names) {
  const want = new Set((names || []).map((n) => String(n || '').trim().toLowerCase()).filter(Boolean));
  const out = [];
  if (!want.size) return out;
  const walk = (v, depth) => {
    if (!v || typeof v !== 'object' || depth > 8) return;
    if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1); return; }
    if (/^T-\d+$/.test(String(v.id || '')) && typeof v.agent === 'string' && want.has(v.agent.trim().toLowerCase()) && !out.includes(v.id)) out.push(v.id);
    for (const k of Object.keys(v)) if (v[k] && typeof v[k] === 'object') walk(v[k], depth + 1);
  };
  walk(view, 0);
  return out;
}

/* The steps to try in order: the subject's ids (each linked), the committing agent's
   dispatch then its board tag, the one task in hand, else the newest taken as a guess. */
export function linkPlan({ message = '', agentTasks = [], tagged = [], hand = [] } = {}) {
  const plan = [];
  const ids = subjectIds(message);
  if (ids.length) plan.push({ via: 'message', tasks: ids, each: true });
  const agent = [...new Set([...(agentTasks || []), ...(tagged || [])])];
  if (agent.length) plan.push({ via: 'agent', tasks: agent });
  const held = (hand || []).map((t, i) => ({ id: t && t.id, since: String((t && t.since) || ''), i }))
    .filter((t) => /^T-\d+$/.test(String(t.id || '')))
    .sort((a, b) => (b.since > a.since ? 1 : b.since < a.since ? -1 : a.i - b.i)).map((t) => t.id);
  if (held.length) plan.push({ via: held.length === 1 ? 'in-hand' : 'guess', tasks: held });
  return plan;
}

const unknownTask = (error) => /\bno such task\b/i.test(String(error || ''));

/* The plan through `send(payload)` ({ ok, error }): a task the board does not know
   falls to the next; any other failure drops the link (the backfill catches it). */
export async function linkCommit(send, plan, payload, { unowned = true } = {}) {
  for (const step of plan) {
    const done = [];
    for (const task of step.tasks) {
      const r = await send({ ...payload, task, via: step.via });
      if (r && r.ok) { done.push(task); if (!step.each) break; }
      else if (!unknownTask(r && r.error)) return { linked: done, via: step.via, error: (r && r.error) || 'no answer' };
    }
    if (done.length) return { linked: done, via: step.via };
  }
  if (!unowned) return { linked: [], via: '' };
  const r = await send({ ...payload, task: '', via: 'none' });
  return r && r.ok ? { linked: [], via: 'none' } : { linked: [], via: 'none', error: (r && r.error) || 'no answer' };
}

/* One commit end to end: found, read, named, linked. null when no folder has it. */
export async function captureCommit(git, send, { dirs, sha = '', was = null, session = '', job = '', agentTasks = [], tagged = [], hand = [], unowned = true } = {}) {
  const at = await findCommit(git, dirs, sha);
  if (!at) return null;
  /* with no sha named, the HEAD the call started on (`was`) is no new commit */
  if (!sha && Array.isArray(was) && was.includes(at.sha)) return null;
  const c = await readCommit(git, at.top, at.sha);
  if (!c) return null;
  const remotes = await git(at.top, ['config', '--get-regexp', '^remote[.].*[.]url$']);
  const repo = repoName(remotes.status === 0 ? remotes.out : '', at.top, at.common);
  const payload = { repo, sha: c.sha, session, agent_job: job, at: c.at, files: c.files, added: c.added, removed: c.removed };
  const plan = linkPlan({ message: c.message, agentTasks, tagged, hand });
  return { sha: c.sha, top: at.top, ...(await linkCommit(send, plan, payload, { unowned })) };
}
