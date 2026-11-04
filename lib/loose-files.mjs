/* Loose files, this PC's half: a track handoff's snapshot of each listed
   repo, the dispositions of its untracked files, the lists kept in the data dir,
   and the due ones the track's next kickoff lists. Nothing here deletes, commits or edits an ignore list. */
import { execFile } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
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

/* Each git check below is written as steps yielding [dir, args]. */
async function driveAsync(steps) {
  let r = steps.next();
  while (!r.done) r = steps.next(await runAsync(...r.value));
  return r.value;
}
function* gitStep(dir, args) { return yield [dir, args]; }
function* outStep(dir, args) { const r = yield [dir, args]; return r.status === 0 ? r.out.trim() : null; }

/* One git read off the loop: its trimmed output, or null. */
export const gitAsync = (dir, args) => driveAsync(outStep(dir, args));
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
function* snapshotSteps(path) {
  const top = yield* outStep(path, ['rev-parse', '--show-toplevel']);
  if (top === null) return null;
  const commit = yield* outStep(path, ['rev-parse', 'HEAD']);
  const st = yield* statusOf(top);
  if (!st) return null;
  const tracked = st.tracked.slice(0, SNAP_MAX);
  const snap = { commit: commit || undefined, dirty: yield* workHashes(top, tracked), untracked: st.untracked.slice(0, SNAP_MAX) };
  if (st.tracked.length > SNAP_MAX || st.untracked.length > SNAP_MAX) snap.cut = true;
  return snap;
}
export const snapshotRepoAsync = (path) => driveAsync(snapshotSteps(path));

/* The gentle check against a snapshot: a leg stops on the wrong branch, a
   missing worktree, the snapshot commit gone, or a tracked file changed since;
   new untracked files are reported with a suggestion and never stop it. */
function* checkSteps(e) {
  const problems = [];
  const top = yield* outStep(e.path, ['rev-parse', '--show-toplevel']);
  if (top === null) return { problems: ['not a readable git repo'], newFiles: [] };
  const branch = yield* outStep(e.path, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (e.branch && branch !== e.branch) problems.push('on branch ' + (branch || 'unknown') + ', the handoff says ' + e.branch);
  if (e.worktree && /^([A-Za-z]:)?\//.test(e.worktree) && !existsSync(e.worktree)) problems.push('worktree ' + e.worktree + ' is missing');
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
export const checkSnapshotAsync = (e) => driveAsync(checkSteps(e));

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

/* An undecided file's note: name, size, age, and its first lines. */
export function seenNote(top, path, nowMs = Date.now()) {
  const full = join(top, path);
  let st;
  try { st = statSync(full); } catch { return path + ': gone'; }
  const age = ageText(nowMs - st.mtimeMs) + ' old';
  if (st.isDirectory()) {
    let n = 0;
    try { n = readdirSync(full).length; } catch {}
    return path + ': a directory of ' + n + ' entries, ' + age;
  }
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

/* Every untracked entry of the snapshot gets a disposition: the payload's,
   else what the store kept for it, else undecided with a note of what was seen.
   `top` is the checkout's root, which the caller has read. */
export function settleFiles(e, given, stored, day, nowMs, top = e.path) {
  const snap = e.snapshot;
  const files = [];
  const used = new Set();
  for (const p of snap.untracked) {
    const g = (given || []).find((f) => sameEntry(p, f.path));
    if (g) used.add(g.path);
    const s = stored.find((k) => k.path === p);
    let f;
    if (g) {
      f = { ...g, path: p };
      /* keeping a kept file again keeps its review date, so the next kickoff lists it due */
      if (!f.review && s && s.disposition === f.disposition) f.review = s.review;
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
  return { files, unmatched };
}

function pick(o, keys) {
  const r = {};
  for (const k of keys) if (o[k] !== undefined) r[k] = o[k];
  return r;
}

/* ---- the lists kept in the data dir ------------------------------------ */

export const normDir = (d) => slashed(d).replace(/\/+$/, '');
export const slugOf = (dir) => normDir(dir).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'root';
export const keptPath = (root, dir) => join(root, KEPT_DIR, slugOf(dir) + '.json');

export function readKept(root, dir) {
  try {
    const j = JSON.parse(readFileSync(keptPath(root, dir), 'utf8'));
    return Array.isArray(j.files) ? j.files.filter((f) => f && typeof f.path === 'string') : [];
  } catch {
    return [];
  }
}

/* One entry per line, sorted by path, so a diff reads entry by entry. */
function serializeKept(dir, files) {
  const rows = files.slice().sort((a, b) => (a.path < b.path ? -1 : 1)).map((f) => '    ' + JSON.stringify(f));
  return '{\n  "project": ' + JSON.stringify(normDir(dir)) + ',\n  "files": [' + (rows.length ? '\n' + rows.join(',\n') + '\n  ' : '') + ']\n}\n';
}

function writeKept(root, dir, files) {
  const path = keptPath(root, dir);
  const text = serializeKept(dir, files);
  let old = null;
  try { old = readFileSync(path, 'utf8'); } catch {}
  if (old === text || (old === null && !files.length)) return false;
  mkdirSync(join(root, KEPT_DIR), { recursive: true });
  writeAtomic(path, text);
  return true;
}

/* A handoff's files replace the project's entries, a commit, ignore or delete
   stored as its own suggestion. */
export function storeHandoffFiles(root, verifyFirst, handoffKey, day) {
  const changed = [];
  for (const e of verifyFirst) {
    if (!e.snapshot || !Array.isArray(e.files)) continue;
    const old = readKept(root, e.path);
    const next = e.files.filter((f) => DISPOSITIONS.includes(f.disposition)).map((f) => {
      const was = old.find((k) => k.path === f.path);
      const same = was && was.disposition === f.disposition && was.review === f.review;
      return {
        ...pick(f, ['path', 'disposition', 'reason', 'note', 'suggest', 'review']),
        ...(ACTIONS.includes(f.disposition) ? { suggest: f.disposition } : {}),
        handoff: same && was.handoff ? was.handoff : handoffKey, set: same && was.set ? was.set : day,
      };
    });
    if (writeKept(root, e.path, next)) changed.push(normDir(e.path));
  }
  return changed;
}

/* ---- words ------------------------------------------------------------- */

const repoName = (dir) => normDir(dir).split('/').filter(Boolean).pop() || dir;
const capped = (list, n = 8) => list.slice(0, n).join(', ') + (list.length > n ? ' and ' + (list.length - n) + ' more' : '');

/* a proposal is due at once, a kept or undecided file on its review day */
export const isDue = (f, day) => ACTIONS.includes(f.disposition) || (typeof f.review === 'string' && typeof day === 'string' && f.review <= day);
const there = (e, f) => existsSync(join(e.path, f.path.replace(/\/$/, '')));

/* A handoff's due files that are still there, each with its repo; the pane counts them. */
export function dueFiles(repos, day) {
  return (Array.isArray(repos) ? repos : []).flatMap((e) => (e && Array.isArray(e.files) ? e.files : [])
    .filter((f) => isDue(f, day) && there(e, f)).map((f) => ({ repo: e.path, ...f })));
}

/* The kickoff's loose-file lines: the files to judge first, undecided then due, each
   marked, with the ask a due one takes; then the kept files not due yet. A file gone since is left out. */
export function filesKickoff(verifyFirst, day) {
  const repos = (Array.isArray(verifyFirst) ? verifyFirst : []).filter((e) => e && Array.isArray(e.files) && e.files.length);
  if (!repos.length) return [];
  const many = repos.length > 1;
  const of = (pick) => repos.flatMap((e) => e.files.filter((f) => there(e, f) && pick(f)).map((f) => ({ f, name: (many ? repoName(e.path) + '/' : '') + f.path })));
  const what = (f) => (f.disposition === 'keep' ? 'kept' : f.disposition === 'undecided' ? 'undecided' : 'proposed ' + f.disposition);
  const judge = [...of((f) => f.disposition === 'undecided'), ...of((f) => f.disposition !== 'undecided' && isDue(f, day))]
    .map(({ f, name }) => name + ' (' + what(f) + (isDue(f, day) ? ', due' : '') + ')');
  const kept = of((f) => f.disposition === 'keep' && !isDue(f, day)).map((x) => x.name);
  const lines = [];
  if (judge.length) lines.push('Loose files to judge first: ' + capped(judge) + '.');
  if (judge.some((l) => l.endsWith(', due)'))) {
    lines.push('Ask in your own reply about each due one, a proposal per file through the ask tool; act on none before the answer,'
      + ' and give a file kept again a new review day in your next handoff.');
  }
  if (kept.length) lines.push('Kept loose files, not due yet: ' + capped(kept) + '.');
  return lines;
}

/* The leg's first message: new untracked files since the snapshot. */
export function newFilesText(repos) {
  const rows = (Array.isArray(repos) ? repos : []).flatMap((r) => (Array.isArray(r.newFiles) ? r.newFiles : [])
    .map((f) => f.path + ' in ' + repoName(r.path) + ' (suggest ' + f.suggest + (f.why ? ': ' + f.why : '') + ')'));
  return rows.length ? 'New untracked files since the handoff: ' + capped(rows, 10) + '. Give each a disposition in the next handoff.' : '';
}

