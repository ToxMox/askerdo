/* Loose files, this PC's half: a track handoff's snapshot of each listed
   repo, the dispositions of its untracked files, worktrees and merged branches, the lists kept in the data dir,
   and the line of kept ones the track's next kickoff prints. The one removal here is removeAgentPlans:
   merged, clean agent worktrees and merged agent branches, then a prune; nothing else deletes, commits, prunes or edits an ignore list. */
import { execFile } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { writeAtomic } from './store-io.mjs';

export const DISPOSITIONS = Object.freeze(['commit', 'ignore', 'delete', 'keep', 'undecided']);
export const ACTIONS = Object.freeze(['commit', 'ignore', 'delete']);
export const REVIEW_DAYS = 7;
export const KEPT_DIR = 'kept';
/* a snapshot is a check, not an inventory: past this many paths it stops listing */
const SNAP_MAX = 200;
const OWN_STATE = /^\.claude\/questions\//;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/* ---- git, off the event loop -------------------------------------------- */

const gitEnv = () => ({ ...process.env, GIT_OPTIONAL_LOCKS: '0' });

/* The local server runs handoffs, resume and the shelf, so git never blocks it. */
function runAsync(dir, args) {
  return new Promise((ok) => {
    try {
      execFile('git', ['-C', dir, ...args], {
        encoding: 'utf8', timeout: 5000, windowsHide: true, maxBuffer: 16 * 1024 * 1024, env: gitEnv(),
      }, (err, stdout) => {
        if (err && typeof err.code !== 'number') return ok({ status: -1, out: '' });
        ok({ status: err ? err.code : 0, out: String(stdout || '') });
      });
    } catch {
      ok({ status: -1, out: '' });
    }
  });
}

/* one call's git reads, each run once per folder and arguments; made per handoff, update or
   resume and dropped with it, since the tree moves between calls. Never handed a git write. */
export function gitReads() {
  const seen = new Map();
  const once = (dir, args) => {
    const k = placeKey(dir) + '\0' + args.join('\0');
    if (!seen.has(k)) seen.set(k, runAsync(dir, args));
    return seen.get(k);
  };
  return (dir, args) => {
    const i = args[0] === 'rev-parse' ? FACTS.indexOf(args.slice(1).join(' ')) : -1;
    if (i < 0) return once(dir, args);
    /* the four a handoff asks of each folder in one rev-parse; an unborn HEAD or no repo asks alone */
    return once(dir, FACTS_ARGS).then((r) => {
      const lines = r.out.split(/\r?\n/);
      return r.status === 0 && lines.length > FACTS.length ? { status: 0, out: lines[i] + '\n' } : once(dir, args);
    });
  };
}
const FACTS = ['--show-toplevel', '--show-prefix', 'HEAD', '--abbrev-ref HEAD'];
const FACTS_ARGS = ['rev-parse', ...FACTS.join(' ').split(' ')];

/* Each git check below is written as steps yielding [dir, args]; `run` is runAsync or a call's gitReads. */
async function driveAsync(steps, run = runAsync) {
  let r = steps.next();
  while (!r.done) r = steps.next(await run(...r.value));
  return r.value;
}
function* gitStep(dir, args) { return yield [dir, args]; }
function* outStep(dir, args) { const r = yield [dir, args]; return r.status === 0 ? r.out.trim() : null; }

/* One git read off the loop: its trimmed output, or null. */
export const gitAsync = (dir, args, run = runAsync) => driveAsync(outStep(dir, args), run);
export const slashed = (p) => String(p || '').replace(/\\/g, '/');
/* a path is the entry or inside it, a folder named with or without its slash (the
   handoff's ownedByOthers and the resume's checks read it alike) */
export const under = (p, dirs) => dirs.some((d) => d === p || p.startsWith(d.endsWith('/') ? d : d + '/'));

/* A wholly untracked .claude/ shows as one entry; open it so the queue's own
   working state stays out and the rest is still seen. */
function openOwnDir(top, p) {
  if (p !== '.claude/') return [p];
  let names = [];
  try { names = readdirSync(join(top, '.claude'), { withFileTypes: true }); } catch { return []; }
  return names.filter((d) => d.name !== 'questions').map((d) => '.claude/' + d.name + (d.isDirectory() ? '/' : ''));
}

/* Tracked paths that differ from HEAD, and untracked entries (a wholly
   untracked directory is one entry ending in a slash). */
function* statusOf(top) {
  const r = yield* gitStep(top, ['status', '--porcelain', '-z', '--untracked-files=normal']);
  if (r.status !== 0) return null;
  const toks = r.out.split('\0');
  const tracked = [];
  const untracked = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.length < 4) continue;
    const xy = t.slice(0, 2);
    const p = slashed(t.slice(3));
    /* a rename or copy carries its source as the next token */
    if (xy[0] === 'R' || xy[0] === 'C') i++;
    if (xy === '!!' || OWN_STATE.test(p)) continue;
    if (xy === '??') untracked.push(...openOwnDir(top, p));
    else tracked.push(p);
  }
  return { tracked: tracked.sort(), untracked: untracked.sort() };
}

/* Working-tree blob hashes, as git would store them; a missing path is 'deleted'. */
function* workHashes(top, paths) {
  const res = {};
  const files = [];
  for (const p of paths) {
    let st = null;
    try { st = statSync(join(top, p)); } catch {}
    if (!st) res[p] = 'deleted';
    else if (!st.isFile()) res[p] = 'other';
    else files.push(p);
  }
  if (files.length) {
    const r = yield* outStep(top, ['hash-object', '--', ...files]);
    const lines = r === null ? [] : r.split('\n');
    for (let i = 0; i < files.length; i++) {
      const p = files[i];
      res[p] = lines.length === files.length ? lines[i].trim() : ((yield* outStep(top, ['hash-object', '--', p])) || 'unreadable');
    }
  }
  return res;
}

/* Blob hashes at a commit; a path the commit does not hold is absent. */
function* blobsAt(top, commit, paths) {
  const res = {};
  if (!paths.length) return res;
  const r = yield* gitStep(top, ['ls-tree', '-r', '-z', commit, '--', ...paths]);
  if (r.status !== 0) return res;
  for (const row of r.out.split('\0')) {
    const m = /^\S+ blob (\S+)\t(.+)$/.exec(row);
    if (m) res[slashed(m[2])] = m[1];
  }
  return res;
}

/* ---- the snapshot ------------------------------------------------------- */

/* What a repo looks like at handoff: its commit, each dirty tracked file's
   content hash, and its untracked entries. Null when it is not a repo. */
function* snapshotSteps(path, seen = () => {}) {
  const top = yield* outStep(path, ['rev-parse', '--show-toplevel']);
  if (top === null) return null;
  seen(top);
  const commit = yield* outStep(path, ['rev-parse', 'HEAD']);
  const st = yield* statusOf(top);
  if (!st) return null;
  const tracked = st.tracked.slice(0, SNAP_MAX);
  const snap = { commit: commit || undefined, dirty: yield* workHashes(top, tracked), untracked: st.untracked.slice(0, SNAP_MAX) };
  if (st.tracked.length > SNAP_MAX || st.untracked.length > SNAP_MAX) snap.cut = true;
  return snap;
}
/* `owned`, `nowMs` and `skip` (a repo's agentRemovals) judge the worktrees: see worktreesAsync */
/* `groupsAt`: where the worktrees are judged when not at `path` (the entry's own path for a build in a worktree), null for none */
/* `run`: the call's gitReads, which the worktree judging shares */
export async function snapshotRepoAsync(path, opts = {}) {
  let top = null;
  const run = opts.run || gitReads();
  const snap = await driveAsync(snapshotSteps(path, (t) => { top = t; }), run);
  if (!snap) return null;
  const at = opts.groupsAt === undefined ? path : opts.groupsAt;
  const wt = at === null ? null : await worktreesAsync(at, { ...opts, run, top: at === path ? top : undefined });
  if (wt) snap.worktrees = wt;
  return snap;
}

/* ---- worktrees and merged branches ------------------------------------- */

export const WORKTREE_DISPOSITIONS = Object.freeze(['remove', 'keep', 'undecided']);
export const WORKTREE_GROUPS = Object.freeze(['merged', 'branches']);
/* a worktree this new with no commit made in it may be one the session is still setting up */
const FRESH_MS = 12 * 3600000;
/* one git status per worktree is the cost; process starts dominate it on Windows, so they overlap */
const STATUS_POOL = Math.max(4, Math.min(16, availableParallelism()));
/* a long-lived or published branch is never a leftover, merged or not */
const LONG_LIVED = /^(main|master|trunk)$/;
const ABS_RE = /^([A-Za-z]:)?\//;
const placeKey = (p) => { const s = slashed(p).replace(/(.)\/+$/, '$1'); return process.platform === 'win32' ? s.toLowerCase() : s; };
const fullPath = (top, p) => (ABS_RE.test(slashed(p)) ? slashed(p) : slashed(top).replace(/\/+$/, '') + '/' + slashed(p).replace(/^\.\//, ''));
/* inside the checkout a worktree is named relative to it, a sibling checkout by its full path */
function shownPath(top, p) {
  const t = placeKey(top) + '/';
  return placeKey(p).startsWith(t) ? slashed(p).slice(t.length).replace(/\/+$/, '') : slashed(p).replace(/(.)\/+$/, '$1');
}

function parseWorktrees(out) {
  const list = [];
  let cur = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) list.push(cur = { path: slashed(line.slice(9).trim()) });
    else if (!cur) continue;
    else if (line.startsWith('HEAD ')) cur.head = line.slice(5).trim();
    else if (line.startsWith('branch ')) cur.branch = line.slice(7).trim().replace(/^refs\/heads\//, '');
    else if (line === 'bare') cur.bare = true;
    else if (line === 'locked' || line.startsWith('locked ')) cur.locked = true;
    else if (line === 'prunable' || line.startsWith('prunable ')) cur.prunable = true;
  }
  return list;
}

async function pooled(items, fn) {
  const out = new Array(items.length);
  let next = 0;
  const lane = async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i]); } };
  await Promise.all(Array.from({ length: Math.min(STATUS_POOL, items.length) }, lane));
  return out;
}

/* The worktree's own HEAD log: its first line is when it was made, and a line past
   placing it (a commit, a merge) means work was done in it. */
function freshWorktree(path, nowMs) {
  try {
    const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(join(path, '.git'), 'utf8'));
    if (!m) return false;
    const admin = isAbsolute(m[1].trim()) ? m[1].trim() : resolve(path, m[1].trim());
    const lines = readFileSync(join(admin, 'logs', 'HEAD'), 'utf8').split('\n').filter(Boolean);
    if (!lines.length || lines.some((l) => !/\t(reset: moving to|checkout: moving from|branch: Created|$)|^[^\t]*$/.test(l))) return false;
    const t = /> (\d+) [+-]\d{4}/.exec(lines[0]);
    return !!t && nowMs - Number(t[1]) * 1000 < FRESH_MS;
  } catch {
    return false;
  }
}

/* Every other worktree of the repo and every local branch merged into the checkout's,
   judged: merged and clean, holding work, or merged with no worktree. Never judged: the
   checkout and the main one, a locked worktree (the Agent tool locks a running agent's),
   one under `owned`, and one just made with no commit in it. Read only. */
export async function worktreesAsync(path, { owned = [], nowMs = Date.now(), top: known, skip, run = gitReads() } = {}) {
  const top = known || await gitAsync(path, ['rev-parse', '--show-toplevel'], run);
  if (top === null) return null;
  const [list, merged, here] = await Promise.all([
    gitAsync(top, ['worktree', 'list', '--porcelain'], run),
    gitAsync(top, ['for-each-ref', '--merged=HEAD', '--format=%(refname:short)%09%(upstream)', 'refs/heads'], run),
    gitAsync(top, ['rev-parse', '--abbrev-ref', 'HEAD'], run),
  ]);
  if (list === null || merged === null) return null;
  const all = parseWorktrees(list);
  const mergedUp = new Map(merged.split('\n').filter(Boolean).map((l) => { const [b, up = ''] = l.split('\t'); return [b, up]; }));
  const ownedKeys = owned.map((o) => placeKey(fullPath(top, o)));
  /* what the write removes after the board write is neither asked about nor kept */
  const gone = skip && placeKey(skip.top) === placeKey(top) ? skip : { trees: [], branches: [] };
  const goneKeys = gone.trees.map((t) => placeKey(t.full));
  const left = { locked: 0, owned: 0, fresh: 0 };
  const judged = all.filter((w, i) => {
    if (w.bare || i === 0 || placeKey(w.path) === placeKey(top) || goneKeys.includes(placeKey(w.path))) return false;
    if (w.locked) { left.locked++; return false; }
    if (under(placeKey(w.path), ownedKeys)) { left.owned++; return false; }
    return true;
  });
  const facts = await pooled(judged, async (w) => {
    const isMerged = w.branch ? mergedUp.has(w.branch)
      : !!w.head && (await run(top, ['merge-base', '--is-ancestor', w.head, 'HEAD'])).status === 0;
    const st = w.prunable ? null : await driveAsync(statusOf(w.path), run);
    const ahead = isMerged ? 0 : Number(await gitAsync(top, ['rev-list', '--count', 'HEAD..' + (w.branch ? 'refs/heads/' + w.branch : w.head)], run)) || 0;
    return { w, isMerged, st, ahead };
  });
  const clean = [];
  const holding = [];
  for (const { w, isMerged, st, ahead } of facts) {
    const at = { path: shownPath(top, w.path), ...(w.branch ? { branch: w.branch } : {}) };
    if (isMerged && (w.prunable || (st && !st.tracked.length && !st.untracked.length))) {
      if (!w.prunable && freshWorktree(w.path, nowMs)) left.fresh++;
      else clean.push(at);
      continue;
    }
    holding.push({ ...at, ...(ahead ? { ahead } : {}), ...(w.prunable ? { gone: true } : !st ? { unreadable: true } : {}),
      ...(st ? { changed: st.tracked.length, untracked: st.untracked.length, files: [...st.tracked, ...st.untracked].slice(0, 3) } : {}) });
  }
  for (const l of [clean, holding]) l.sort((a, b) => (a.path < b.path ? -1 : 1));
  const checkedOut = new Set(all.map((w) => w.branch).filter(Boolean));
  const branches = [...mergedUp].filter(([b, up]) => b !== here && !checkedOut.has(b) && !up && !LONG_LIVED.test(b) && !gone.branches.includes(b) && !laneStub(b, all)).map(([b]) => b).sort();
  return {
    against: here || 'HEAD',
    nested: all.slice(1).map((w) => shownPath(top, w.path)).filter((p) => !ABS_RE.test(p)).slice(0, SNAP_MAX),
    merged: clean.slice(0, SNAP_MAX), mergedCount: clean.length, holding: holding.slice(0, SNAP_MAX),
    branches: branches.slice(0, SNAP_MAX), branchCount: branches.length,
    ...(left.locked || left.owned || left.fresh ? { left } : {}),
    ...(clean.length > SNAP_MAX || holding.length > SNAP_MAX || branches.length > SNAP_MAX ? { cut: true } : {}),
  };
}

/* an agent's worktree, by its agent- folder under .claude/worktrees/ or its branch's name;
   any other worktree there (a session's merge worktree) is never removed by a write */
const AGENT_DIR = /\/\.claude\/worktrees\/agent-[^/]+$/i;
const AGENT_BRANCH = /^worktree-agent-/;
const isAgent = (w) => AGENT_DIR.test(slashed(w.path).replace(/\/+$/, '')) || AGENT_BRANCH.test(w.branch || '');
/* the Agent tool's stub branch whose agent folder still stands as a worktree (on any branch) is that lane's */
const laneOf = (p) => { const m = /\/\.claude\/worktrees\/(agent-[^/]+)$/i.exec(slashed(p).replace(/\/+$/, '')); return m ? m[1].toLowerCase() : ''; };
const laneStub = (b, all) => AGENT_BRANCH.test(b) && all.some((w) => laneOf(w.path) === b.replace(/^worktree-/, '').toLowerCase());

/* a removal outlives whoever started it (a call's limit, a killed CLI), so git never
   leaves half a folder; its exit is read while the starter still waits. */
function runDetached(dir, args) {
  let c = null;
  const done = new Promise((ok) => {
    try {
      c = execFile('git', ['-C', dir, ...args], { encoding: 'utf8', detached: true, windowsHide: true, env: gitEnv() },
        (err, stdout, stderr) => ok({ status: err ? (typeof err.code === 'number' ? err.code : -1) : 0, err: String(stderr || '') }));
    } catch {
      ok({ status: -1, err: '' });
    }
  });
  /* left to git: the caller's process no longer waits on it */
  const leave = () => { for (const h of c ? [c, c.stdout, c.stderr] : []) if (h && typeof h.unref === 'function') h.unref(); };
  return { done, leave };
}

/* each agent worktree still left whose tip is in the checkout's branch and whose status is
   clean, and each merged agent branch with no worktree. Never the main or this checkout, `self` (the
   session's own), one under `owned`, a locked, gone or just-made one. Read only: the snapshot leaves these out. */
/* `run`: the call's gitReads; the removals themselves never go through it */
export async function agentRemovals(path, { self = [], owned = [], nowMs = Date.now(), run = gitReads() } = {}) {
  const top = await gitAsync(path, ['rev-parse', '--show-toplevel'], run);
  if (top === null) return null;
  const [here, list, merged] = await Promise.all([
    gitAsync(top, ['rev-parse', '--abbrev-ref', 'HEAD'], run),
    gitAsync(top, ['worktree', 'list', '--porcelain'], run),
    /* the snapshot's own read of the merged branches, which the memo then answers */
    gitAsync(top, ['for-each-ref', '--merged=HEAD', '--format=%(refname:short)%09%(upstream)', 'refs/heads'], run),
  ]);
  if (list === null || !here || here === 'HEAD') return null;
  const selfKeys = [top, ...self].map((o) => placeKey(fullPath(top, o)));
  const ownedKeys = owned.map((o) => placeKey(fullPath(top, o)));
  const all = parseWorktrees(list);
  const inHead = new Set((merged || '').split('\n').map((l) => l.split('\t')[0]).filter(Boolean));
  const asked = all.filter((w, i) => !(i === 0 || w.bare || w.locked || w.prunable || !isAgent(w) || selfKeys.includes(placeKey(w.path)) || under(placeKey(w.path), ownedKeys)));
  /* a branch's tip is in HEAD when the merged list names it; a detached one asks merge-base */
  const clean = await pooled(asked, async (w) => {
    if (!(w.branch ? inHead.has(w.branch) : !!w.head && (await run(top, ['merge-base', '--is-ancestor', w.head, 'HEAD'])).status === 0)) return false;
    const st = await driveAsync(statusOf(w.path), run);
    return !!st && !st.tracked.length && !st.untracked.length && !freshWorktree(w.path, nowMs);
  });
  const trees = asked.filter((w, i) => clean[i]).map((w) => ({ full: w.path, path: shownPath(top, w.path), ...(w.branch ? { branch: w.branch } : {}) }));
  const out = new Set(all.map((w) => w.branch).filter(Boolean));
  const branches = [...inHead].filter((b) => b !== here && !out.has(b) && AGENT_BRANCH.test(b) && !laneStub(b, all));
  return { repo: slashed(top), top, trees, branches };
}

/* a keep on the merged group or on a worktree's own path holds that worktree, one on the
   branches group every branch; the payload's, else the one kept here. Each kept one rides `kept`,
   named in the write's result with its reason */
export function keptPlan(plan, given, stored) {
  const keep = (same) => { const x = (given || []).find(same) || (stored || []).find(same); return x && x.disposition === 'keep' ? x : null; };
  const merged = keep((x) => x.group === 'merged');
  const branches = keep((x) => x.group === 'branches');
  const kept = [];
  const trees = [];
  for (const t of plan.trees) {
    const k = keep((x) => !!x.path && placeKey(fullPath(plan.top, x.path)) === placeKey(t.full)) || merged;
    if (k) kept.push({ repo: plan.repo, path: t.path, ...(t.branch ? { branch: t.branch } : {}), left: 'kept', why: k.reason });
    else if (branches && t.branch) {
      trees.push({ ...t, keepBranch: true });
      kept.push({ repo: plan.repo, branch: t.branch, left: 'kept', why: branches.reason });
    } else trees.push(t);
  }
  if (branches) for (const b of plan.branches) kept.push({ repo: plan.repo, branch: b, left: 'kept', why: branches.reason });
  return { ...plan, trees, branches: branches ? [] : plan.branches, kept };
}

/* the write's removals, after the board write: none starts past `startBy`, and the result is in
   by `waitTo`, the removal in flight then left to git to finish and the rest to the next write; git's own
   remove and `branch -d` refuse anything dirty or unmerged as a second check, and a repo with nothing in
   flight is pruned. Each entry: removed (a path, a branch or both), or `left` running, next or refused. */
export async function removeAgentPlans(plans, { startBy = Infinity, waitTo = Infinity } = {}) {
  const out = [];
  for (const p of plans || []) {
    out.push(...(p.kept || []));
    let running = false;
    for (const t of p.trees) {
      if (running || Date.now() >= startBy) { out.push({ repo: p.repo, path: t.path, ...(t.branch ? { branch: t.branch } : {}), left: 'next' }); continue; }
      const job = runDetached(p.top, ['worktree', 'remove', t.full]);
      let timer;
      const r = !Number.isFinite(waitTo) ? await job.done
        : await Promise.race([job.done, new Promise((ok) => { timer = setTimeout(() => ok(null), Math.max(0, waitTo - Date.now())); })]);
      clearTimeout(timer);
      if (!r) { job.leave(); running = true; out.push({ repo: p.repo, path: t.path, left: 'running' }); continue; }
      if (r.status !== 0) { out.push({ repo: p.repo, path: t.path, left: 'refused', why: firstLine(r.err) || 'git exited ' + r.status }); continue; }
      const gone = t.branch && !t.keepBranch && (await runAsync(p.top, ['branch', '-d', t.branch])).status === 0;
      out.push({ repo: p.repo, path: t.path, ...(gone ? { branch: t.branch } : {}) });
    }
    for (const b of p.branches) if ((await runAsync(p.top, ['branch', '-d', b])).status === 0) out.push({ repo: p.repo, branch: b });
    if (!running) await runAsync(p.top, ['worktree', 'prune']);
  }
  return out;
}
const firstLine = (s) => String(s || '').replace(/^(fatal|error): /gm, '').trim().split(/\r?\n/)[0];

/* A worktree inside the checkout shows there as untracked; it is judged as a worktree,
   so neither it nor a folder holding only worktrees is a loose file. */
function worktreeHome(top, p, wt) {
  const nested = wt && Array.isArray(wt.nested) ? wt.nested : [];
  if (!nested.length) return false;
  if (nested.includes(p.replace(/\/$/, ''))) return true;
  if (!p.endsWith('/') || !nested.some((n) => n.startsWith(p))) return false;
  try { return readdirSync(join(top, p)).every((n) => nested.includes(p + n)); } catch { return false; }
}

/* an entry naming a worktree (absolute, this PC's) has its build there, so the branch,
   commit and dirty checks run in it and a failure names it */
export const checkPlace = (e) => (e.worktree && ABS_RE.test(e.worktree) ? e.worktree : e.path);
export const placeName = (e) => (checkPlace(e) !== e.path ? 'worktree ' + checkPlace(e) + ' ' : '');
/* a place that is not there is named as missing, never as an unreadable repo */
export const missingPlace = (e) => (existsSync(checkPlace(e)) ? '' : (checkPlace(e) !== e.path ? 'worktree ' : 'folder ') + checkPlace(e) + ' is missing');

/* The gentle check against a snapshot: a leg stops on the wrong branch, a
   missing worktree, the snapshot commit gone, or a tracked file changed since;
   new untracked files are reported with a suggestion and never stop it. */
function* checkSteps(e) {
  const problems = [];
  const at = checkPlace(e);
  if (missingPlace(e)) return { problems: [missingPlace(e)], newFiles: [] };
  const top = yield* outStep(at, ['rev-parse', '--show-toplevel']);
  if (top === null) return { problems: [placeName(e) + 'not a readable git repo'], newFiles: [] };
  const branch = yield* outStep(at, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (e.branch && branch !== e.branch) problems.push(placeName(e) + 'on branch ' + (branch || 'unknown') + ', the handoff says ' + e.branch);
  const s = e.snapshot;
  if (s.commit) {
    const tip = e.branch || 'HEAD';
    const r = yield* gitStep(top, ['merge-base', '--is-ancestor', s.commit, tip]);
    if (r.status !== 0) problems.push('the snapshot commit ' + String(s.commit).slice(0, 12) + ' is gone from ' + tip);
  }
  const st = yield* statusOf(top);
  if (!st) return { problems: problems.concat(['git status could not be read']), newFiles: [] };
  const others = (e.ownedByOthers || []).map(slashed);
  const was = s.dirty && typeof s.dirty === 'object' ? s.dirty : {};
  const before = Object.keys(was).filter((p) => !under(p, others));
  /* a cut snapshot did not list every dirty file, so an unlisted one proves nothing */
  const listedAll = !(s.cut && Object.keys(was).length >= SNAP_MAX);
  const fresh = listedAll ? st.tracked.filter((p) => !(p in was) && !under(p, others)) : [];
  const now = yield* workHashes(top, [...before, ...fresh]);
  const atSnap = s.commit ? yield* blobsAt(top, s.commit, fresh) : {};
  const changed = [
    ...before.filter((p) => now[p] !== was[p]),
    /* clean at the snapshot, so it then matched the snapshot commit */
    ...fresh.filter((p) => now[p] !== (atSnap[p] || 'deleted')),
  ].sort();
  if (changed.length) {
    problems.push('tracked files changed since the snapshot: ' + changed.slice(0, 5).join(', ')
      + (changed.length > 5 ? ' and ' + (changed.length - 5) + ' more' : ''));
  }
  const known = Array.isArray(s.untracked) ? s.untracked.map(slashed) : [];
  const newFiles = st.untracked.filter((p) => !under(p, known) && !under(p, others))
    .map((p) => ({ path: p, ...suggestFor(p) }));
  return { problems, newFiles };
}
export const checkSnapshotAsync = (e, run = gitReads()) => driveAsync(checkSteps(e), run);

/* ---- suggestions and what was seen ------------------------------------- */

const DELETE_RE = /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini)$|\.(log|tmp|temp|bak|orig|rej|swp)$|~$/i;
const IGNORE_RE = /(^|\/)(node_modules|dist|build|out|coverage|\.cache|__pycache__|\.venv|venv|\.next|target)\/$|\.(pyc|pyo|o|obj)$/i;

/* A first guess from the name alone; anything else is for the session to judge. */
export function suggestFor(path) {
  const p = slashed(path);
  if (DELETE_RE.test(p)) return { suggest: 'delete', why: 'a temp, log or backup file' };
  if (IGNORE_RE.test(p)) return { suggest: 'ignore', why: 'build output or a dependency folder' };
  return { suggest: 'undecided', why: 'not judged yet' };
}

function ageText(ms) {
  const m = Math.max(0, Math.floor(ms / 60000));
  if (m < 60) return m + 'm';
  const h = Math.floor(m / 60);
  return h < 48 ? h + 'h' : Math.floor(h / 24) + 'd';
}

/* the files a delete of this untracked folder would remove, as a dry run counts them */
const COUNT_MAX = 5000;
function filesUnder(full) {
  let n = 0;
  const stack = [full];
  while (stack.length && n < COUNT_MAX) {
    const at = stack.pop();
    let names = [];
    try { names = readdirSync(at, { withFileTypes: true }); } catch { continue; }
    for (const d of names) {
      if (d.isDirectory()) stack.push(join(at, d.name)); else n++;
    }
  }
  return n >= COUNT_MAX ? COUNT_MAX + '+' : String(n);
}

/* what a delete of this untracked entry removes, as a count; '' when it is gone */
export function removesCount(top, path) {
  const full = join(top, path);
  let st;
  try { st = statSync(full); } catch { return ''; }
  return st.isDirectory() ? filesUnder(full) : '1';
}

/* An undecided file's note: name, size, age, and its first lines. */
export function seenNote(top, path, nowMs = Date.now()) {
  const full = join(top, path);
  let st;
  try { st = statSync(full); } catch { return path + ': gone'; }
  const age = ageText(nowMs - st.mtimeMs) + ' old';
  if (st.isDirectory()) return path + ': a directory of ' + filesUnder(full) + ' files git has no copy of, ' + age;
  let head = '';
  try {
    const fd = openSync(full, 'r');
    const buf = Buffer.alloc(Math.min(st.size, 512));
    try { readSync(fd, buf, 0, buf.length, 0); } finally { closeSync(fd); }
    if (buf.includes(0)) head = 'binary';
    else {
      const lines = buf.toString('utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 3);
      head = lines.length ? 'starts "' + lines.map((l) => l.slice(0, 80)).join(' / ') + '"' : 'empty';
    }
  } catch { head = 'unreadable'; }
  return path + ': ' + st.size + ' bytes, ' + age + ', ' + head;
}

/* ---- days -------------------------------------------------------------- */

export function addDays(day, n) {
  const [y, m, d] = day.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.getUTCFullYear() + '-' + String(t.getUTCMonth() + 1).padStart(2, '0') + '-' + String(t.getUTCDate()).padStart(2, '0');
}

/* ---- dispositions in the payload --------------------------------------- */

const FILE_KEYS = ['path', 'disposition', 'reason', 'review', 'suggest', 'note'];

/* A repo's `files` as the payload gives them; `err` builds the verb's error. */
export function validateFiles(raw, at, err) {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) throw err(at + ' must be a list of { path, disposition }');
  const seen = new Set();
  return raw.map((f, i) => {
    const w = at + '[' + i + ']';
    if (!f || typeof f !== 'object' || Array.isArray(f)) throw err(w + ' must be an object');
    for (const k of Object.keys(f)) if (!FILE_KEYS.includes(k)) throw err(w + ' does not take ' + k + ' (it takes ' + FILE_KEYS.join(', ') + ')');
    for (const k of FILE_KEYS) {
      if (f[k] !== undefined && (typeof f[k] !== 'string' || !f[k].trim())) throw err(w + '.' + k + ' must be a non-empty string');
    }
    if (!f.path) throw err(w + '.path is required: the file, relative to the repo');
    const path = slashed(f.path.trim()).replace(/^\.\//, '');
    if (seen.has(path)) throw err(w + ': ' + path + ' is listed twice');
    seen.add(path);
    if (!DISPOSITIONS.includes(f.disposition)) throw err(w + '.disposition must be one of ' + DISPOSITIONS.join(', '));
    const o = { path, disposition: f.disposition };
    if (f.disposition === 'keep' && !f.reason) throw err(w + ': a kept file needs a reason');
    if (f.reason) o.reason = f.reason.trim();
    if (f.review) {
      if (!['keep', 'undecided'].includes(f.disposition)) throw err(w + '.review belongs to a kept or undecided file');
      if (!DAY_RE.test(f.review.trim())) throw err(w + '.review must be a day, YYYY-MM-DD');
      o.review = f.review.trim();
    }
    if (f.suggest) {
      if (!['keep', 'undecided'].includes(f.disposition)) throw err(w + '.suggest belongs to a kept or undecided file');
      if (!ACTIONS.includes(f.suggest)) throw err(w + '.suggest must be one of ' + ACTIONS.join(', '));
      o.suggest = f.suggest;
    }
    if (f.note) o.note = f.note.trim();
    return o;
  });
}

const sameEntry = (a, b) => a === b || a === b + '/' || a + '/' === b;
/* a folder the conversion map keeps, holding this entry or held by it */
const keptByMap = (p, stored) => stored.find((k) => k.from === 'conversion' && (under(p, [k.path]) || under(k.path, [p])));

/* Every untracked entry of the snapshot gets a disposition: the payload's,
   else what the store kept for it, else undecided with a note of what was seen.
   An entry under a folder the conversion keeps stays kept, a delete given for it too.
   `top` is the checkout's root, which the caller has read. */
export function settleFiles(e, given, stored, day, nowMs, top = e.path) {
  const snap = e.snapshot;
  const files = [];
  const used = new Set();
  const held = [];
  for (const p of snap.untracked) {
    if (worktreeHome(top, p, snap.worktrees)) continue;
    const g = (given || []).find((f) => sameEntry(p, f.path));
    if (g) used.add(g.path);
    const s = stored.find((k) => k.path === p);
    const map = keptByMap(p, stored);
    let f;
    if (map && (!g || g.disposition === 'delete' || g.disposition === 'undecided')) {
      if (g && g.disposition === 'delete') held.push(p);
      files.push({ path: p, disposition: 'keep', reason: map.reason, from: 'conversion' });
      continue;
    }
    if (g) {
      f = { ...g, path: p };
      /* keeping a kept file again keeps its review date until it passes; kept again once due, it takes a new one */
      if (!f.review && s && s.disposition === f.disposition && !(f.disposition === 'keep' && isDue(s, day))) f.review = s.review;
    } else if (s) {
      f = { path: p, disposition: s.disposition, ...pick(s, ['reason', 'review', 'suggest', 'note']) };
    } else {
      const sg = suggestFor(p);
      f = { path: p, disposition: 'undecided', note: seenNote(top, p, nowMs), ...(sg.suggest !== 'undecided' ? { suggest: sg.suggest } : {}) };
    }
    /* a commit, ignore or delete is a proposal: due at once, so the user is asked before anyone acts */
    if (!f.review) f.review = ACTIONS.includes(f.disposition) ? day : addDays(day, REVIEW_DAYS);
    if (f.disposition === 'undecided' && !f.note) f.note = seenNote(top, p, nowMs);
    files.push(f);
  }
  const unmatched = (given || []).filter((f) => !used.has(f.path)).map((f) => f.path);
  return { files, unmatched, held };
}

function pick(o, keys) {
  const r = {};
  for (const k of keys) if (o[k] !== undefined) r[k] = o[k];
  return r;
}

const WORKTREE_KEYS = ['path', 'group', 'disposition', 'reason', 'review'];

/* A repo's `worktrees` as the payload gives them: a worktree holding work by its path,
   or a group (merged, branches), each remove, keep with a reason, or undecided. */
export function validateWorktrees(raw, at, err) {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) throw err(at + ' must be a list of { path or group, disposition }');
  const seen = new Set();
  return raw.map((x, i) => {
    const w = at + '[' + i + ']';
    if (!x || typeof x !== 'object' || Array.isArray(x)) throw err(w + ' must be an object');
    for (const k of Object.keys(x)) if (!WORKTREE_KEYS.includes(k)) throw err(w + ' does not take ' + k + ' (it takes ' + WORKTREE_KEYS.join(', ') + ')');
    for (const k of WORKTREE_KEYS) {
      if (x[k] !== undefined && (typeof x[k] !== 'string' || !x[k].trim())) throw err(w + '.' + k + ' must be a non-empty string');
    }
    if (!x.path === !x.group) throw err(w + ' names one worktree by its path, or a group: ' + WORKTREE_GROUPS.join(' or '));
    if (x.group && !WORKTREE_GROUPS.includes(x.group.trim())) throw err(w + '.group must be one of ' + WORKTREE_GROUPS.join(', '));
    const o = x.group ? { group: x.group.trim() } : { path: slashed(x.path.trim()).replace(/^\.\//, '').replace(/(.)\/+$/, '$1') };
    const id = o.group ? 'group ' + o.group : placeKey(o.path);
    if (seen.has(id)) throw err(w + ': ' + (o.group ? id : o.path) + ' is listed twice');
    seen.add(id);
    if (!WORKTREE_DISPOSITIONS.includes(x.disposition)) throw err(w + '.disposition must be one of ' + WORKTREE_DISPOSITIONS.join(', '));
    o.disposition = x.disposition;
    if (x.disposition === 'keep' && !x.reason) throw err(w + ': a kept one needs a reason');
    if (x.reason) o.reason = x.reason.trim();
    if (x.review) {
      if (x.disposition !== 'keep') throw err(w + '.review belongs to a kept one');
      if (!DAY_RE.test(x.review.trim())) throw err(w + '.review must be a day, YYYY-MM-DD');
      o.review = x.review.trim();
    }
    return o;
  });
}

function holdingNote(h, against) {
  const parts = [];
  if (h.gone) parts.push('its folder is gone');
  if (h.unreadable) parts.push('its status could not be read');
  if (h.ahead) parts.push(h.ahead + (h.ahead === 1 ? ' commit' : ' commits') + ' not in ' + against);
  if (h.changed) parts.push(h.changed + (h.changed === 1 ? ' changed file' : ' changed files'));
  if (h.untracked) parts.push(h.untracked + (h.untracked === 1 ? ' untracked file' : ' untracked files'));
  return parts.join(', ') + (Array.isArray(h.files) && h.files.length ? ': ' + h.files.join(', ') + ((h.changed || 0) + (h.untracked || 0) > h.files.length ? ' and more' : '') : '');
}

/* Each group and each worktree holding work gets a disposition: the payload's, else the one
   kept here, else a proposed removal for a group and undecided for a worktree. A removal,
   a deletion and an undecided worktree are due at once, a kept one on its review day. */
export function settleWorktrees(e, given, stored, day, top = e.path) {
  const wt = e.snapshot && e.snapshot.worktrees;
  if (!wt) return { worktrees: undefined, unmatched: [] };
  const items = [
    ...(wt.mergedCount ? [{ group: 'merged', count: wt.mergedCount }] : []),
    ...wt.holding.map((h) => ({ path: h.path, note: holdingNote(h, wt.against) })),
    ...(wt.branchCount ? [{ group: 'branches', count: wt.branchCount }] : []),
  ];
  const same = (a, b) => (b.group ? a.group === b.group : !!a.path && placeKey(fullPath(top, a.path)) === placeKey(fullPath(top, b.path)));
  const used = new Set();
  const worktrees = items.map((it) => {
    const g = (given || []).find((x) => same(x, it));
    const s = (stored || []).find((x) => same(x, it));
    let d;
    if (g) {
      used.add(g);
      d = { ...it, ...pick(g, ['disposition', 'reason', 'review']) };
      if (!d.review && s && s.disposition === d.disposition && !(d.disposition === 'keep' && worktreeDue(s, day))) d.review = s.review;
    } else if (s) d = { ...it, ...pick(s, ['disposition', 'reason', 'review']) };
    else d = { ...it, disposition: it.group ? 'remove' : 'undecided' };
    if (!d.review || d.disposition !== 'keep') d.review = d.disposition === 'keep' ? addDays(day, REVIEW_DAYS) : day;
    return d;
  });
  return { worktrees, unmatched: (given || []).filter((x) => !used.has(x)).map((x) => x.group ? 'group ' + x.group : x.path) };
}

/* ---- the lists kept in the data dir ------------------------------------ */

export const normDir = (d) => slashed(d).replace(/\/+$/, '');
export const slugOf = (dir) => normDir(dir).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'root';
export const keptPath = (root, dir) => join(root, KEPT_DIR, slugOf(dir) + '.json');

function readKeptFile(root, dir) {
  try { return JSON.parse(readFileSync(keptPath(root, dir), 'utf8')) || {}; } catch { return {}; }
}

/* whether this PC's list took the project's conversion keeps (its stamp, or an entry from them) */
export function conversionKnown(root, dir) {
  const j = readKeptFile(root, dir);
  return !!j.conversion || (Array.isArray(j.files) && j.files.some((f) => f && f.from === 'conversion'));
}

export function readKept(root, dir) {
  const j = readKeptFile(root, dir);
  return Array.isArray(j.files) ? j.files.filter((f) => f && typeof f.path === 'string') : [];
}

/* the dispositions of a repo's worktree groups and worktrees holding work */
export function readKeptWorktrees(root, dir) {
  const j = readKeptFile(root, dir);
  return Array.isArray(j.worktrees) ? j.worktrees.filter((w) => w && (typeof w.path === 'string' || typeof w.group === 'string')) : [];
}

/* One entry per line, sorted by path, so a diff reads entry by entry. */
function serializeKept(dir, files, worktrees, stamp) {
  const list = (xs) => {
    const rows = xs.slice().sort((a, b) => ((a.path || '') < (b.path || '') ? -1 : 1)).map((f) => '    ' + JSON.stringify(f));
    return '[' + (rows.length ? '\n' + rows.join(',\n') + '\n  ' : '') + ']';
  };
  return '{\n  "project": ' + JSON.stringify(normDir(dir)) + (stamp ? ',\n  "conversion": ' + JSON.stringify(stamp) : '') + ',\n  "files": ' + list(files)
    + (worktrees.length ? ',\n  "worktrees": ' + list(worktrees) : '') + '\n}\n';
}

/* `stamp`: the day the list took the conversion map's keeps; left out, the stored one stays */
function writeKept(root, dir, files, worktrees = [], stamp) {
  const path = keptPath(root, dir);
  let old = null;
  try { old = readFileSync(path, 'utf8'); } catch {}
  let was;
  try { was = JSON.parse(old).conversion; } catch {}
  const text = serializeKept(dir, files, worktrees, stamp || was);
  if (old === text || (old === null && !files.length && !worktrees.length && !stamp)) return false;
  mkdirSync(join(root, KEPT_DIR), { recursive: true });
  writeAtomic(path, text);
  return true;
}

/* A handoff's files and worktrees replace the project's entries, a commit, ignore or delete
   stored as its own suggestion; the conversion's kept folders stay. */
export function storeHandoffFiles(root, verifyFirst, handoffKey, day) {
  const changed = [];
  for (const e of verifyFirst) {
    if (!e.snapshot || !(Array.isArray(e.files) || Array.isArray(e.worktrees))) continue;
    const old = readKept(root, e.path);
    const map = old.filter((k) => k.from === 'conversion');
    const next = !Array.isArray(e.files) ? old : map.concat(e.files.filter((f) => DISPOSITIONS.includes(f.disposition) && !map.some((k) => k.path === normDir(f.path))).map((f) => {
      const was = old.find((k) => k.path === f.path);
      const same = was && was.disposition === f.disposition && was.review === f.review;
      return {
        ...pick(f, ['path', 'disposition', 'reason', 'note', 'suggest', 'review']),
        ...(ACTIONS.includes(f.disposition) ? { suggest: f.disposition } : {}),
        handoff: same && was.handoff ? was.handoff : handoffKey, set: same && was.set ? was.set : day,
      };
    }));
    const wts = Array.isArray(e.worktrees) ? e.worktrees : readKeptWorktrees(root, e.path);
    const kept = wts.map((w) => pick(w, ['group', 'path', 'disposition', 'reason', 'review']));
    if (writeKept(root, e.path, next, kept)) changed.push(normDir(e.path));
  }
  return changed;
}

/* the folders a conversion keeps, put in the project's list beside the handoffs' entries, so a handoff
   settles what lies under them as kept; `gone` names the ones a later run moved or deleted, which leave it,
   and `whole` (the map's own keeps) replaces every conversion entry */
export function keepFromConversion(root, dir, folders, day, gone = [], whole = false) {
  if (!root) return false;
  const old = readKept(root, dir);
  const keep = folders.map((f) => ({ path: normDir(f.path), reason: 'the conversion keeps ' + normDir(f.path) + (f.why ? ': ' + f.why : '') }));
  const drop = new Set([...keep.map((k) => k.path), ...gone.map(normDir)]);
  const next = old.filter((k) => k.from !== 'conversion' || (!whole && !drop.has(k.path)))
    .concat(keep.map((k) => ({ path: k.path, disposition: 'keep', reason: k.reason, from: 'conversion', set: day })));
  return writeKept(root, dir, next, readKeptWorktrees(root, dir), day);
}

/* the sources a project's conversion map keeps, as keepFromConversion takes them */
export const mapKeeps = (rows) => (Array.isArray(rows) ? rows : [])
  .filter((r) => r && r.fate === 'keep' && (r.kind === 'folder' || r.kind === 'file') && typeof r.source === 'string')
  .map((r) => ({ path: r.source, why: r.why }));

/* a project converted before this PC kept its conversion's keeps takes them from its map, once;
   `read` answers the map's rows (the board's conversionMap), and a failed read is tried again next time */
export async function fillFromMap(root, dir, read, day) {
  if (!root || conversionKnown(root, dir)) return false;
  let rows;
  try { rows = await read(); } catch { return false; }
  if (!Array.isArray(rows)) return false;
  return keepFromConversion(root, dir, mapKeeps(rows), day, [], true);
}

/* ---- words ------------------------------------------------------------- */

const repoName = (dir) => normDir(dir).split('/').filter(Boolean).pop() || dir;
const capped = (list, n = 8) => list.slice(0, n).join(', ') + (list.length > n ? ' and ' + (list.length - n) + ' more' : '');

/* a proposal is due at once, a kept or undecided file on its review day */
export const isDue = (f, day) => ACTIONS.includes(f.disposition) || (typeof f.review === 'string' && typeof day === 'string' && f.review <= day);
const filePath = (e, f) => join(e.path, f.path.replace(/\/$/, ''));
const there = (e, f) => existsSync(filePath(e, f));

/* A handoff's due files that are still there, each with its repo; the pane counts them.
   `has`: a path test in place of existsSync, as dueLater hands it. */
export function dueFiles(repos, day, has = existsSync) {
  return (Array.isArray(repos) ? repos : []).flatMap((e) => (e && Array.isArray(e.files) ? e.files : [])
    .filter((f) => isDue(f, day) && has(filePath(e, f))).map((f) => ({ repo: e.path, ...f })));
}

/* a group or a worktree holding work is due at once, a kept one on its review day */
export const worktreeDue = (w, day) => w.disposition !== 'keep' || (typeof w.review === 'string' && typeof day === 'string' && w.review <= day);
const firstOf = (names, total, k) => names.slice(0, k).join(', ') + (total > k ? ' and ' + (total - k) + ' more' : '');

const worktreeRepos = (verifyFirst) => (Array.isArray(verifyFirst) ? verifyFirst : [])
  .filter((e) => e && Array.isArray(e.worktrees) && e.worktrees.length && e.snapshot && e.snapshot.worktrees);

/* What a repo still holds of its handoff: the merged group while one of its worktrees is still
   there, each worktree holding work still there, and the branches group. */
function worktreeItems(e, has = existsSync) {
  const s = e.snapshot.worktrees;
  const there = (p) => has(fullPath(e.path, p));
  const g = e.worktrees.find((d) => d.group === 'merged');
  const still = s.merged.filter((m) => there(m.path));
  const n = s.mergedCount - (s.merged.length - still.length);
  return { merged: g && n > 0 ? { d: g, n, still } : null, hold: e.worktrees.filter((d) => d.path && there(d.path)),
    branches: e.worktrees.find((d) => d.group === 'branches') || null };
}

/* `dueOnly`: a handoff's write names only what is due; one kept until later carries unasked */
function worktreeWords(verifyFirst, day, dueOnly = false) {
  const repos = worktreeRepos(verifyFirst);
  const lines = [];
  let due = false;
  for (const e of repos) {
    const s = e.snapshot.worktrees;
    const state = (d, act) => {
      if (worktreeDue(d, day)) due = true;
      return d.disposition === 'keep' ? 'kept' + (worktreeDue(d, day) ? ', due' : ' until ' + d.review) + (d.reason ? ': ' + d.reason : '')
        : d.disposition === 'remove' ? 'proposed ' + act + ', due' : 'undecided, due';
    };
    const at = repos.length > 1 ? ' in ' + repoName(e.path) : '';
    const parts = [];
    const shown = (d) => d && (!dueOnly || worktreeDue(d, day));
    const items = worktreeItems(e);
    const m = items.merged && shown(items.merged.d) ? items.merged : null;
    const hold = items.hold.filter(shown);
    const b = shown(items.branches) ? items.branches : null;
    if (m) parts.push(m.n + ' merged and clean (' + state(m.d, 'removal') + ', with their branches): ' + firstOf(m.still.map((x) => x.path), m.n, 3));
    if (hold.length) parts.push(hold.length + ' holding work: ' + hold.map((d) => d.path + ' (' + [d.note, state(d, 'removal')].filter(Boolean).join('; ') + ')').join(', '));
    const l = s.left || {};
    const alone = [l.locked ? l.locked + ' locked' : '', l.fresh ? l.fresh + ' just made' : ''].filter(Boolean);
    if (parts.length) lines.push('Worktrees' + at + ': ' + parts.join('; ') + (alone.length ? '; left alone: ' + alone.join(', ') : '') + '.');
    if (b) lines.push('Branches' + at + ': ' + b.count + ' merged into ' + s.against + ' with no worktree (' + state(b, 'deletion') + '): ' + firstOf(s.branches, b.count, 5) + '.');
  }
  return { lines, due };
}

/* A handoff's due groups and worktrees holding work, each with its repo; the pane counts them. */
export function dueWorktrees(repos, day, has = existsSync) {
  return worktreeRepos(repos).flatMap((e) => {
    const { merged, hold, branches } = worktreeItems(e, has);
    return [merged && merged.d, ...hold, branches].filter((d) => d && worktreeDue(d, day)).map((d) => ({ repo: e.path, ...d }));
  });
}

/* dueFiles and dueWorktrees with every existence check in the thread pool: a server's loop
   paid about 0.25 ms per path on Windows, 200 ms for a shelf of four 200-file lists */
export async function dueLater(repos, day) {
  const paths = new Set();
  for (const e of Array.isArray(repos) ? repos : []) {
    for (const f of e && Array.isArray(e.files) ? e.files : []) if (isDue(f, day)) paths.add(filePath(e, f));
  }
  for (const e of worktreeRepos(repos)) {
    for (const m of e.snapshot.worktrees.merged || []) paths.add(fullPath(e.path, m.path));
    for (const d of e.worktrees) if (d.path) paths.add(fullPath(e.path, d.path));
  }
  const found = new Set();
  await Promise.all([...paths].map((p) => access(p).then(() => found.add(p), () => {})));
  const has = (p) => found.has(p);
  return { files: dueFiles(repos, day, has), worktrees: dueWorktrees(repos, day, has) };
}

/* What the handoff saw of each repo's worktrees and merged branches, for the write's result. */
export const worktreeLines = (verifyFirst, day, dueOnly = false) => worktreeWords(verifyFirst, day, dueOnly).lines;

/* a resume asks nothing about leftovers; its kickoff prints one line of what is kept and
   why, a keep past its review day marked for the next handoff to ask about. Gone ones are left out. */
export function keptKickoff(verifyFirst, day) {
  const repos = (Array.isArray(verifyFirst) ? verifyFirst : []).filter(Boolean);
  const many = repos.filter((e) => (e.files || []).length || (e.worktrees || []).length).length > 1;
  const items = repos.flatMap((e) => {
    const at = many ? repoName(e.path) + '/' : '';
    const files = (Array.isArray(e.files) ? e.files : []).filter((f) => f.disposition === 'keep' && there(e, f))
      .map((f) => ({ d: f, name: at + f.path, due: isDue(f, day) }));
    const wt = e.snapshot && e.snapshot.worktrees && Array.isArray(e.worktrees) ? worktreeItems(e) : null;
    const where = many ? ' in ' + repoName(e.path) : '';
    const trees = !wt ? [] : [wt.merged && { d: wt.merged.d, name: wt.merged.n + ' merged worktrees' + where },
      ...wt.hold.map((d) => ({ d, name: at + d.path })), wt.branches && { d: wt.branches, name: wt.branches.count + ' merged branches' + where }]
      .filter((x) => x && x.d.disposition === 'keep').map((x) => ({ ...x, due: worktreeDue(x.d, day) }));
    return [...files, ...trees];
  });
  if (!items.length) return [];
  return ['Kept from the last handoff, nothing to ask: ' + capped(items.map((x) => x.name + ' (' + (x.d.reason || 'no reason given')
    + (x.due ? '; its review day passed, so your next handoff asks about it' : '') + ')')) + '.'];
}

/* The leg's first message: new untracked files since the snapshot. */
export function newFilesText(repos) {
  const rows = (Array.isArray(repos) ? repos : []).flatMap((r) => (Array.isArray(r.newFiles) ? r.newFiles : [])
    .map((f) => f.path + ' in ' + repoName(r.path) + ' (suggest ' + f.suggest + (f.why ? ': ' + f.why : '') + ')'));
  return rows.length ? 'New untracked files since the handoff: ' + capped(rows, 10) + '. Give each a disposition in the next handoff.' : '';
}

