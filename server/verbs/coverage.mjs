/* Review coverage: the commits each task finished
   with, the reviews that read them, the due signal, and the review station as the gate:
   a completed review reopens when work it reads changes, and a track's finish waits. */
import { readTx, tx } from '../db.mjs';
import { actorOf, addNote, labelOf } from '../records.mjs';
import { UsageError, resolveRecord } from './labels.mjs';
import { TASK_KEYS, TrackRefusal, headOf, loadRecord, logLine, needText, writeFront } from './graph.mjs';
import { isReview } from './found.mjs';
import { chainOver, parseRecordWith, resolveChain } from './profile-rules.mjs';
import { loadProfiles } from './profiles.mjs';
import { lookupFor } from './labels.mjs';
import { sharesProject } from './questions.mjs';

const ms = (s) => { const n = Date.parse(String(s ?? '')); return Number.isFinite(n) ? n : null; };
const VIA = ['message', 'agent', 'in-hand', 'guess', 'manual'];
const SHA = /^[0-9a-f]{7,64}$/;
export const REVIEW_SCOPES = Object.freeze(['track', 'project']);

/* a review task reads its own track (the default) or the whole project. */
export function reviewScopeOf(v, what = 'review scope') {
  const s = String(v ?? '').trim().toLowerCase();
  if (REVIEW_SCOPES.includes(s)) return s;
  throw new UsageError(what + ' is track or project');
}
const scopeOf = (f) => (f && f.reviewScope === 'project' ? 'project' : 'track');

const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const count = (v, what) => {
  if (v === undefined || v === null) return 0;
  if (!Number.isInteger(v) || v < 0) throw new UsageError(what + ' is a whole number of lines, 0 or more');
  return v;
};

function taskOf(db, ref) {
  const e = resolveRecord(db, String(ref).trim(), { kinds: ['task'] });
  if (!e) throw new UsageError('no such task: ' + String(ref).trim());
  return loadRecord(db, e.key);
}

function filesOf(v) {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new UsageError('files is a list of { path, added, removed, counted }');
  return v.map((f) => {
    if (!f || typeof f !== 'object' || !text(f.path)) throw new UsageError('each file names its path');
    return { path: f.path.trim(), added: count(f.added, 'a file\'s added'), removed: count(f.removed, 'a file\'s removed'), counted: f.counted !== false };
  });
}

const shortSha = (sha) => sha.slice(0, 7);
/* covers in id order, `T-2` before `T-10` */
const idNo = (id) => { const m = /(\d+)$/.exec(String(id)); return m ? Number(m[1]) : Infinity; };
const byId = (a, b) => idNo(a.id) - idNo(b.id) || String(a.id).localeCompare(String(b.id));
const commitWords = (repo, sha) => shortSha(sha) + ' in ' + repo;

/* The PC's write: one commit linked to one task (or to none). Idempotent on
   (repo, sha, task), since the PC retries; only a new row is logged. */
export function commitLink(db, input = {}, actor) {
  const repo = text(input.repo);
  if (!repo) throw new UsageError('commit link needs the repo');
  const sha = String(input.sha ?? '').trim().toLowerCase();
  if (!SHA.test(sha)) throw new UsageError('commit link needs the sha, hex');
  if (ms(input.at) === null) throw new UsageError('commit link needs at, the commit time (ISO)');
  const owned = text(input.task);
  const via = owned ? String(input.via ?? '') : 'none';
  if (owned && !VIA.includes(via)) throw new UsageError('via is one of ' + VIA.join(', '));
  const files = filesOf(input.files);
  const added = count(input.added, 'added');
  const removed = count(input.removed, 'removed');
  const c = actorOf(actor);
  return tx(db, () => {
    const t = owned ? taskOf(db, owned) : null;
    const task = t ? t.key : '';
    /* an owned row supersedes the unowned one; an unowned link never shadows an owned commit */
    if (!t && db.stmt("SELECT 1 FROM commits WHERE repo = ? AND sha = ? AND task <> ''").get(repo, sha)) {
      return { repo, sha, task: '', created: false };
    }
    const had = db.stmt('SELECT 1 FROM commits WHERE repo = ? AND sha = ? AND task = ?').get(repo, sha, task);
    db.stmt(`INSERT INTO commits (repo, sha, task, at, via, session, agent_job, files, added, removed, linked)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (repo, sha, task) DO UPDATE SET at = excluded.at, via = excluded.via, session = excluded.session,
      agent_job = excluded.agent_job, files = excluded.files, added = excluded.added, removed = excluded.removed`)
      .run(repo, sha, task, String(input.at).trim(), via, text(input.session), text(input.agent_job), JSON.stringify(files), added, removed, c.at);
    if (t) db.stmt("DELETE FROM commits WHERE repo = ? AND sha = ? AND task = ''").run(repo, sha);
    if (!had) {
      logLine(db, { at: c.at, verb: 'commit', kind: t ? 'task' : 'commit', rec: t ? headOf(t) : { id: '', name: '' },
        changes: { commit: [null, commitWords(repo, sha)] }, by: c.by, pc: c.pc, note: 'via ' + via });
    }
    const reopened = t && added + removed > 0 ? afterTask(db, t.key, { commit: { sha, at: String(input.at).trim() } }, actor).reopened : [];
    return { repo, sha, task: t ? t.fields.id : '', created: !had, ...(reopened.length ? { reopened } : {}) };
  });
}

/* A commit relinked by hand: from one task (or from no task) to another, with the reason. */
export function commitMove(db, input = {}, actor) {
  const reason = needText(input.reason, 'moving a commit', 'reason');
  const want = String(input.sha ?? '').trim().toLowerCase();
  if (!SHA.test(want)) throw new UsageError('commit move needs the sha, hex, 7 characters or more');
  if (!text(input.to)) throw new UsageError('commit move needs --to, the task it belongs to');
  const c = actorOf(actor);
  return tx(db, () => {
    const repo = text(input.repo);
    const from = text(input.from) ? taskOf(db, input.from) : null;
    let rows = db.stmt('SELECT * FROM commits WHERE substr(sha, 1, ?) = ?' + (repo ? ' AND repo = ?' : '')).all(want.length, want, ...(repo ? [repo] : []));
    if (from) rows = rows.filter((r) => r.task === from.key);
    const shas = new Set(rows.map((r) => r.repo + ' ' + r.sha));
    if (!rows.length) throw new TrackRefusal('no linked commit ' + want + (repo ? ' in ' + repo : '') + (from ? ' on ' + from.fields.id : ''));
    if (shas.size > 1) throw new TrackRefusal(want + ' names more than one commit: give the full sha or --repo');
    if (rows.length > 1) throw new TrackRefusal(want + ' is linked to ' + rows.map((r) => labelOf(db, r.task)).join(' and ') + ': name the one with --from');
    const row = rows[0];
    const to = taskOf(db, input.to);
    if (to.key === row.task) return { repo: row.repo, sha: row.sha, from: to.fields.id, to: to.fields.id, moved: false };
    db.stmt('DELETE FROM commits WHERE repo = ? AND sha = ? AND task = ?').run(row.repo, row.sha, row.task);
    db.stmt(`INSERT INTO commits (repo, sha, task, at, via, session, agent_job, files, added, removed, linked)
      VALUES (?, ?, ?, ?, 'manual', ?, ?, ?, ?, ?, ?) ON CONFLICT (repo, sha, task) DO UPDATE SET via = 'manual'`)
      .run(row.repo, row.sha, to.key, row.at, row.session, row.agent_job, row.files, row.added, row.removed, c.at);
    logLine(db, { at: c.at, verb: 'commit', kind: 'task', rec: headOf(to), changes: { commit: [row.task || null, to.key] }, by: c.by, pc: c.pc,
      note: commitWords(row.repo, row.sha) + ' moved: ' + reason });
    /* the moved commit is new work on its task: it uncovers it and reopens what read it */
    const reopened = row.added + row.removed > 0 ? afterTask(db, to.key, { commit: { sha: row.sha, at: row.at } }, actor).reopened : [];
    return { repo: row.repo, sha: row.sha, from: row.task ? labelOf(db, row.task) : '', to: to.fields.id, moved: true, ...(reopened.length ? { reopened } : {}) };
  });
}

/* lib/proc-match.mjs globRe: `*` within a segment, `**` across them, `?` one character */
const slashed = (p) => p.split(String.fromCharCode(92)).join('/');
function globRe(glob) {
  let out = '';
  const g = slashed(String(glob).trim()).replace(/^(\.\/)+/, '');
  for (let i = 0; i < g.length; i++) {
    const ch = g[i];
    if (ch === '*' && g[i + 1] === '*') {
      if (g[i + 2] === '/') { out += '(?:.*/)?'; i += 2; } else { out += '.*'; i += 1; }
    } else if (ch === '*') out += '[^/]*';
    else if (ch === '?') out += '[^/]';
    else out += /[.+^${}()|[\]\\]/.test(ch) ? '\\' + ch : ch;
  }
  return new RegExp('^' + out + '$', 'i');
}

const DEPTHS = ['off', 'light', 'full'];
const listIn = (v) => { if (Array.isArray(v)) return v; try { const a = JSON.parse(v); return Array.isArray(a) ? a : []; } catch { return []; } };

/* review.depth, review.tasks and review.ignore as a task, track or workstream resolves them. */
export function reviewSettings(db, key) {
  const lookup = lookupFor(db);
  let chain;
  try { chain = chainOver(lookup, parseRecordWith(lookup, key)); } catch (e) { if (!(e instanceof UsageError)) throw e; chain = [{ level: 'default', key: 'default', ref: 'default' }]; }
  const v = resolveChain(loadProfiles(db), chain).settings;
  const depth = DEPTHS.includes(v['review.depth'].value) ? v['review.depth'].value : 'light';
  const n = v['review.tasks'].value;
  const ignore = listIn(v['review.ignore'].value).filter((g) => typeof g === 'string' && g.trim()).map(globRe);
  return { depth, tasks: Number.isInteger(n) && n > 0 ? n : 5, ignore };
}

/* A commit's counted lines: the PC's counted files less review.ignore's globs. */
function linesOf(row, ignore) {
  if (!ignore || !ignore.length) return { added: row.added, removed: row.removed };
  const files = listIn(row.files);
  if (!files.length) return { added: row.added, removed: row.removed };
  const kept = files.filter((f) => f && f.counted !== false && !ignore.some((re) => re.test(slashed(String(f.path || '')))));
  return { added: kept.reduce((n, f) => n + (f.added || 0), 0), removed: kept.reduce((n, f) => n + (f.removed || 0), 0) };
}

/* A task's commits in the coverage rule: only one that changed counted lines makes it code. */
const countedCommits = (db, key, ignore) => db.stmt('SELECT sha, at, via, added, removed, files FROM commits WHERE task = ? AND added + removed > 0').all(key)
  .map((r) => ({ ...r, ...linesOf(r, ignore) })).filter((r) => r.added + r.removed > 0);
const newestOf = (rows) => rows.reduce((best, r) => (best && ms(best.at) >= ms(r.at) ? best : r), null);

/* A review that completed once and was reopened since: its kept covers still count. */
const STOOD = `(r.status = 'completed' OR (r.status <> 'dropped' AND EXISTS (SELECT 1 FROM activity a WHERE a.record = c.review
  AND json_extract(a.line, '$.changes.status[0]') = 'completed')))`;

/* THE COVERAGE RULE: a code task is covered when a completed (or reopened) review's cover
   reaches through_at at or after every one of its counted commits. `ignore` is review.ignore's. */
export function coveredState(db, taskKey, ignore = []) {
  const rows = countedCommits(db, taskKey, ignore);
  const added = rows.reduce((n, r) => n + r.added, 0);
  const removed = rows.reduce((n, r) => n + r.removed, 0);
  const guess = rows.filter((r) => r.via === 'guess').length;
  const base = { code: rows.length > 0, covered: false, by: null, commits: rows.length, added, removed, guess };
  if (!rows.length) return base;
  const last = Math.max(...rows.map((r) => ms(r.at) ?? Infinity));
  const covers = db.stmt(`SELECT c.review, c.through, c.through_at FROM covers c JOIN records r ON r.key = c.review
    WHERE c.task = ? AND ${STOOD}`).all(taskKey).filter((c) => ms(c.through_at) !== null && ms(c.through_at) >= last);
  if (!covers.length) return base;
  const best = covers.reduce((a, b) => (ms(a.through_at) >= ms(b.through_at) ? a : b));
  return { ...base, covered: true, by: labelOf(db, best.review), through: best.through };
}

/* When a task first went in_progress since it last reopened (else since it began),
   from its activity rows, else null. */
function startedAt(db, key) {
  const rows = db.stmt(`SELECT at, json_extract(line, '$.changes.status[0]') AS was, json_extract(line, '$.changes.status[1]') AS now
    FROM activity WHERE record = ? AND json_extract(line, '$.changes.status') IS NOT NULL ORDER BY seq`).all(key);
  let from = null;
  for (const r of rows) if (r.was === 'completed' && r.now !== 'completed') from = ms(r.at);
  const t = rows.filter((r) => r.now === 'in_progress').map((r) => ms(r.at)).filter((n) => n !== null && (from === null || n >= from));
  return t.length ? Math.min(...t) : null;
}

/* What a review reads up to: its start (a fix finished after it started stays
   uncovered), else its completion, else now. */
const cutOf = (db, review, c) => startedAt(db, review.key) ?? ms(review.fields.closed) ?? (c ? c.date.getTime() : Date.now());

/* The newest commit of a task now, any of them: what a cover reads through. */
function throughOf(db, key) {
  const n = newestOf(db.stmt('SELECT sha, at FROM commits WHERE task = ?').all(key));
  return n ? { through: n.sha, through_at: n.at } : { through: null, through_at: null };
}

const wsOf = (db, key) => {
  const r = db.stmt('SELECT workstream FROM records WHERE key = ?').get(key);
  if (r && r.workstream) return r.workstream;
  const t = db.stmt('SELECT r.workstream AS ws FROM track_items ti JOIN records r ON r.key = ti.track WHERE ti.task = ?').get(key);
  return t ? t.ws : null;
};

/* A workstream's project: itself and every workstream sharing a project with it. */
function projectWs(db, wsKey) {
  const own = wsKey ? loadRecord(db, wsKey) : null;
  if (!own) return [];
  return db.stmt("SELECT key, fields FROM records WHERE kind = 'workstream'").all()
    .filter((w) => w.key === wsKey || sharesProject(own.fields, JSON.parse(w.fields))).map((w) => w.key);
}

/* The project's completed project-wide reviews, each with what it read up to. */
function projectReviews(db, wsKeys) {
  return db.stmt(`SELECT key FROM records WHERE kind = 'task' AND status = 'completed' AND json_extract(fields, '$.reviewScope') = 'project'
    AND workstream IN (SELECT value FROM json_each(?))`).all(JSON.stringify(wsKeys))
    .map((r) => { const rec = loadRecord(db, r.key); return { key: r.key, cut: cutOf(db, rec) }; });
}

/* The default list. Track scope: every uncovered code task on the review's track
   completed before the review started. Project scope: every uncovered code
   task in the project completed since the last completed project-wide review. */
function defaultList(db, review, c) {
  const cut = cutOf(db, review, c);
  const { ignore } = reviewSettings(db, review.key);
  const open = (t) => { const s = coveredState(db, t.key, ignore); return s.code && !s.covered; };
  /* new since a read: completed after it, or counted work linked after it (a hotfix) */
  const since = (t, prev) => ms(t.closed) > prev || lastLinked(db, t.key, ignore) > prev;
  if (scopeOf(review.fields) === 'project') {
    const ws = projectWs(db, wsOf(db, review.key));
    const prev = projectReviews(db, ws).filter((r) => r.key !== review.key && r.cut < cut).reduce((m, r) => (m === null || r.cut > m ? r.cut : m), null);
    return db.stmt(`SELECT key, json_extract(fields, '$.closed') AS closed, fields FROM records WHERE kind = 'task' AND status = 'completed' AND key <> ?
      AND workstream IN (SELECT value FROM json_each(?)) ORDER BY created, key`).all(review.key, JSON.stringify(ws))
      .filter((t) => ms(t.closed) !== null && ms(t.closed) <= cut && (prev === null || since(t, prev)) && !isReview(JSON.parse(t.fields)))
      .filter(open).map((t) => t.key);
  }
  const row = db.stmt('SELECT track FROM track_items WHERE task = ?').get(review.key);
  if (!row) return [];
  /* completing again after a reopen: only the work new since it last completed */
  const prev = c && c.again ? readBefore(db, review.key) : null;
  return db.stmt(`SELECT r.key, json_extract(r.fields, '$.closed') AS closed, r.fields FROM track_items ti JOIN records r ON r.key = ti.task
    WHERE ti.track = ? AND r.status = 'completed' AND r.key <> ? ORDER BY ti.position`).all(row.track, review.key)
    .filter((t) => ms(t.closed) !== null && ms(t.closed) <= cut && !isReview(JSON.parse(t.fields)))
    .filter((t) => prev === null || since(t, prev))
    .filter(open)
    .map((t) => t.key);
}

/* When a task's counted work last reached the board: the later of each commit's time and its link. */
function lastLinked(db, key, ignore) {
  return db.stmt('SELECT at, linked, added, removed, files FROM commits WHERE task = ? AND added + removed > 0').all(key)
    .filter((r) => { const n = linesOf(r, ignore); return n.added + n.removed > 0; })
    .reduce((m, r) => Math.max(m, ms(r.at) ?? -Infinity, ms(r.linked) ?? -Infinity), -Infinity);
}

/* When a reopened review last completed before its latest reopen, else null. */
function readBefore(db, key) {
  const r = db.stmt(`SELECT at FROM activity WHERE record = ? AND json_extract(line, '$.changes.status[1]') = 'completed'
    AND seq < (SELECT max(seq) FROM activity WHERE record = ? AND json_extract(line, '$.changes.status[0]') = 'completed') ORDER BY seq DESC LIMIT 1`).get(key, key);
  return r ? ms(r.at) : null;
}

function writeCovers(db, review, keys, c) {
  const before = db.stmt('SELECT task, through FROM covers WHERE review = ? ORDER BY task').all(review.key);
  db.stmt('DELETE FROM covers WHERE review = ?').run(review.key);
  const add = db.stmt('INSERT INTO covers (review, task, at, through, through_at) VALUES (?, ?, ?, ?, ?)');
  const out = [];
  for (const k of keys) {
    const t = throughOf(db, k);
    add.run(review.key, k, c.at, t.through, t.through_at);
    out.push({ id: labelOf(db, k), through: t.through, throughAt: t.through_at });
  }
  const after = db.stmt('SELECT task, through FROM covers WHERE review = ? ORDER BY task').all(review.key);
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    logLine(db, { at: c.at, verb: 'covers', kind: 'task', rec: headOf(review), changes: { covers: [before.map((r) => r.task), after.map((r) => r.task)] }, by: c.by, pc: c.pc });
  }
  return out;
}

/* Sets (or narrows) a review's covers list; with no list, the default as of now. */
export function reviewCovers(db, input = {}, actor) {
  const c = actorOf(actor);
  const list = input.tasks === undefined || input.tasks === null ? null : [].concat(input.tasks);
  if (list && list.some((t) => !text(t))) throw new UsageError('review covers names T-n ids');
  return tx(db, () => {
    const review = taskOf(db, input.review ?? input.id ?? '');
    if (!isReview(review.fields)) throw new UsageError(review.fields.id + ' is not a review task: label it review, or name it "Review ..."');
    const keys = list ? [...new Set(list.map((t) => taskOf(db, t).key))] : defaultList(db, review, c);
    if (keys.includes(review.key)) throw new UsageError('a review never covers itself');
    return { review: review.fields.id, covers: writeCovers(db, review, keys, c), default: !list };
  });
}

/* A review task completing with no covers list takes the default; one completing again
   after a reopen keeps the covers its reopen left and adds the work new since it last
   completed. Answers the covered ids, or null when it wrote none. */
export function reviewDone(db, key, actor) {
  const review = loadRecord(db, key);
  if (!review || !isReview(review.fields)) return null;
  const kept = db.stmt('SELECT task FROM covers WHERE review = ? ORDER BY task').all(key).map((r) => r.task);
  const again = !!db.stmt(`SELECT 1 FROM activity WHERE record = ? AND json_extract(line, '$.changes.status[0]') = 'completed' LIMIT 1`).get(key);
  if (kept.length && !again) return null;
  const c = { ...actorOf(actor), again };
  const keys = [...new Set([...kept, ...defaultList(db, review, c)])];
  return keys.length ? writeCovers(db, review, keys, c).map((x) => x.id) : null;
}

/* the review station's own act, said as the board's */
export const REVIEW_BY = 'board:review';

/* a completed review goes back to open with a journal note naming the task. It drops
   the covers that change outdated and keeps the rest, so its next completion reads only the
   new work; what waits on it waits again. */
function reopen(db, review, task, why, c) {
  const diff = writeFront(db, review, { status: 'open', closed: undefined, updated: c.at }, TASK_KEYS);
  const { ignore } = reviewSettings(db, review.key);
  for (const cv of db.stmt('SELECT task, through_at FROM covers WHERE review = ?').all(review.key)) {
    const last = newestOf(countedCommits(db, cv.task, ignore));
    if (cv.task === task || ms(cv.through_at) === null || (last && ms(last.at) > ms(cv.through_at))) {
      db.stmt('DELETE FROM covers WHERE review = ? AND task = ?').run(review.key, cv.task);
    }
  }
  const body = 'Reopened: ' + why + '. It covers that work when it completes again.';
  addNote(db, review.key, { at: c.at, actor: REVIEW_BY, body });
  logLine(db, { at: c.at, verb: 'edit', kind: 'task', rec: headOf(review), changes: diff, by: REVIEW_BY, pc: c.pc, note: body });
  return review.fields.id;
}

/* The completed reviews a change to task `t` reopens, at full depth: one covering it that a
   newer commit outdates, and a track review after it on its track that it completed or
   gained a commit after. */
function reopens(db, t, ev, c) {
  const out = new Map();
  const sha = ev.commit ? shortSha(ev.commit.sha) : '';
  const at = ev.commit ? ms(ev.commit.at) : ms(t.fields.closed) ?? c.date.getTime();
  const words = (key) => t.fields.id + ' ' + (ev.commit ? 'gained commit ' + sha : 'completed') + ' after ' + labelOf(db, key) + ' completed';
  const ended = db.stmt(`SELECT 1 FROM track_items ti JOIN records tr ON tr.key = ti.track WHERE ti.task = ? AND tr.status IN ('done', 'dropped', 'folded')`);
  const add = (key) => {
    /* a finished track's review stays done: the work reads uncovered for a project-wide review */
    if (out.has(key) || ended.get(key)) return;
    const s = reviewSettings(db, key);
    if (s.depth !== 'full' || !coveredState(db, t.key, s.ignore).code) return;
    out.set(key, words(key));
  };
  if (ev.commit) {
    for (const cv of db.stmt(`SELECT c.review, c.through_at FROM covers c JOIN records r ON r.key = c.review
        WHERE c.task = ? AND r.status = 'completed'`).all(t.key)) {
      if (ms(cv.through_at) === null || at > ms(cv.through_at)) add(cv.review);
    }
  }
  const pos = db.stmt('SELECT track, position FROM track_items WHERE task = ?').get(t.key);
  if (pos && t.fields.status === 'completed') {
    for (const r of db.stmt(`SELECT r.key, json_extract(r.fields, '$.closed') AS closed FROM track_items ti JOIN records r ON r.key = ti.task
        WHERE ti.track = ? AND ti.position > ? AND r.status = 'completed'`).all(pos.track, pos.position)) {
      const rec = loadRecord(db, r.key);
      if (!isReview(rec.fields) || scopeOf(rec.fields) !== 'track' || ms(r.closed) === null || at <= ms(r.closed)) continue;
      if (db.stmt('SELECT 1 FROM covers WHERE review = ? AND task = ?').get(r.key, t.key) && !ev.commit) continue;
      add(r.key);
    }
  }
  return [...out].map(([key, why]) => ({ rec: loadRecord(db, key), why }));
}

/* THE SHARED CHECK, on every path a task completes or gains a commit (editRecord,
   upkeep's own completion, the band's look press, track finish, the picture, commit link):
   a review completing takes its default covers; work a completed review read reopens it. */
export function afterTask(db, key, ev = {}, actor) {
  const t = loadRecord(db, key);
  if (!t) return { covers: null, reopened: [] };
  const c = actorOf(actor);
  const covers = ev.completed ? reviewDone(db, key, actor) : null;
  const reopened = isReview(t.fields) ? [] : reopens(db, t, ev, c).map((r) => reopen(db, r.rec, key, r.why, c));
  return { covers, reopened };
}

/* what holds a track's finish at full depth: a completed code task on it left
   uncovered after its last completed review (after its place or its start), or any at all
   with no review. */
export function finishHeld(db, trackKey, s = reviewSettings(db, trackKey)) {
  if (s.depth !== 'full') return [];
  const rows = db.stmt('SELECT task, position FROM track_items WHERE track = ? ORDER BY position').all(trackKey).map((r) => ({ ...r, rec: loadRecord(db, r.task) })).filter((r) => r.rec);
  let last = null;
  for (const r of rows) {
    if (r.rec.fields.status !== 'completed' || !isReview(r.rec.fields)) continue;
    const cut = cutOf(db, r.rec);
    if (!last || r.position > last.position) last = { position: r.position, cut };
  }
  return rows.filter((r) => r.rec.fields.status === 'completed' && !isReview(r.rec.fields))
    .filter((r) => !last || r.position > last.position || (ms(r.rec.fields.closed) ?? 0) > last.cut)
    .filter((r) => { const st = coveredState(db, r.task, s.ignore); return st.code && !st.covered; })
    .map((r) => ({ id: r.rec.fields.id, name: r.rec.fields.name }));
}

/* A track's finish through the gate: refused naming the work, or a waiver recorded on the
   track's journal; answers the activity note, or null when nothing held it. */
export function finishGate(db, rec, input, c) {
  const held = finishHeld(db, rec.key);
  if (!held.length) return null;
  const ids = held.map((t) => t.id);
  const waive = text(input && input.waive);
  if (!waive) {
    throw new TrackRefusal(rec.fields.id + ' has finished code no review read: ' + held.map((t) => t.id + ' ' + t.name).join('; ')
      + '. Put a review task on it that covers them, or finish with --waive "<reason>"', { uncovered: ids });
  }
  const body = 'Finished with unreviewed code (' + ids.join(', ') + '), waived: ' + waive;
  addNote(db, rec.key, { at: c.at, actor: c.by, body });
  return body;
}

/* A track's review readout: its finished code tasks with their coverage, its
   review tasks with what each covered, due once review.tasks of them wait uncovered, and
   at full whether its finish is held. Null at depth off, which computes and shows nothing. */
export function trackReview(db, trackKey, s = reviewSettings(db, trackKey)) {
  if (s.depth === 'off') return null;
  const finished = [];
  const reviews = [];
  const folded = new Set();
  const named = db.stmt('SELECT label, title FROM records WHERE key = ?');
  const once = db.stmt(`SELECT 1 FROM activity WHERE record = ? AND json_extract(line, '$.changes.status[0]') = 'completed' LIMIT 1`);
  for (const { task, position } of db.stmt('SELECT task, position FROM track_items WHERE track = ? ORDER BY position').all(trackKey)) {
    const t = loadRecord(db, task);
    if (!t) continue;
    const f = t.fields;
    const head = { id: f.id, key: task, name: f.name, position, status: f.status, closed: f.status === 'completed' ? f.closed || null : null };
    if (isReview(f)) {
      const all = db.stmt('SELECT task, through FROM covers WHERE review = ?').all(task).map((r) => {
        const n = named.get(r.task) || {};
        const st = coveredState(db, r.task, s.ignore);
        return { id: n.label || r.task, key: r.task, name: n.title || '', through: r.through, added: st.added, removed: st.removed, now: st.covered && st.by === f.id };
      }).sort(byId);
      /* a review that stood complete shows and folds only what it still covers; the rest are beads again */
      const stood = f.status === 'completed' || (f.status !== 'dropped' && !!once.get(task));
      const covers = (stood ? all.filter((cv) => cv.now) : all).map(({ now, ...cv }) => cv);
      if (stood) for (const cv of covers) folded.add(cv.key);
      reviews.push({ ...head, review: true, reviewScope: scopeOf(f), covers });
      continue;
    }
    if (f.status !== 'completed') continue;
    const st = coveredState(db, task, s.ignore);
    if (!st.code) continue;
    finished.push({ ...head, covered: st.covered, by: st.by, commits: st.commits, added: st.added, removed: st.removed, ...(st.guess ? { guess: st.guess } : {}) });
  }
  const open = finished.filter((t) => !t.covered);
  const due = open.length >= s.tasks;
  const since = open.reduce((m, t) => (ms(t.closed) !== null && (m === null || ms(t.closed) > ms(m)) ? t.closed : m), null);
  const held = finishHeld(db, trackKey, s);
  /* the open review placed after all the waiting work (held at full, else uncovered): it reads them when it completes */
  const waiting = new Set((held.length ? held : open).map((t) => t.id));
  const last = finished.filter((t) => waiting.has(t.id)).reduce((m, t) => Math.max(m, t.position), -Infinity);
  const next = waiting.size ? reviews.find((r) => r.status !== 'completed' && r.status !== 'dropped' && r.position > last) : null;
  return {
    depth: s.depth, due, ...(due ? { why: 'size' } : {}), size: s.tasks, since,
    uncovered: open.map((t) => ({ id: t.id, name: t.name })), lines: open.reduce((n, t) => n + t.added + t.removed, 0),
    locked: held.length > 0, held: held.map((t) => t.id), planned: next ? next.id : null,
    /* a completed review on this track folds what it covered; the rest stay beads */
    finished: finished.filter((t) => !folded.has(t.key)), reviews,
  };
}

/* The readout without its lists, as the kickoff, the handoff and the summary carry it. */
export const reviewHead = (r) => (r ? { depth: r.depth, due: r.due, ...(r.why ? { why: r.why } : {}), size: r.size, since: r.since, uncovered: r.uncovered, lines: r.lines, locked: r.locked, held: r.held, planned: r.planned } : null);

/* The raw facts for a track or a workstream: its code tasks with their coverage, its
   reviews with what each covered, the unowned commits in its repos since it began (each
   covered once a project-wide review read past it), and per track the due signal. */
export function coverage(db, input = {}) {
  const ref = String((typeof input === 'string' ? input : input.scope ?? input.track ?? input.workstream) ?? '').trim();
  return readTx(db, () => {
    const e = ref ? resolveRecord(db, ref, { kinds: ['track', 'workstream'] }) : null;
    if (!e) throw new UsageError('coverage names a TR-n or WS-n');
    const scope = loadRecord(db, e.key);
    const s = reviewSettings(db, scope.key);
    const keys = scope.kind === 'track'
      ? db.stmt('SELECT task FROM track_items WHERE track = ? ORDER BY position').all(scope.key).map((r) => r.task)
      : db.stmt("SELECT key FROM records WHERE kind = 'task' AND workstream = ? ORDER BY created, key").all(scope.key).map((r) => r.key);
    const trackOf = db.stmt('SELECT track FROM track_items WHERE task = ?');
    const ignoreOf = new Map();
    const ignoreAt = (track) => {
      if (!track) return s.ignore;
      if (!ignoreOf.has(track)) ignoreOf.set(track, reviewSettings(db, track).ignore);
      return ignoreOf.get(track);
    };
    const tasks = [];
    const reviews = [];
    for (const k of keys) {
      const t = loadRecord(db, k);
      const tr = trackOf.get(k);
      const head = { id: t.fields.id, key: k, name: t.fields.name, track: tr ? labelOf(db, tr.track) : null, status: t.fields.status, completed: t.fields.status === 'completed' ? t.fields.closed || null : null };
      if (isReview(t.fields)) {
        const covers = db.stmt('SELECT task, through, through_at FROM covers WHERE review = ?').all(k)
          .map((r) => ({ id: labelOf(db, r.task), through: r.through, throughAt: r.through_at })).sort(byId);
        reviews.push({ ...head, reviewScope: scopeOf(t.fields), covers });
        continue;
      }
      const st = coveredState(db, k, ignoreAt(tr && tr.track));
      if (!st.code) continue;
      tasks.push({ ...head, commits: st.commits, added: st.added, removed: st.removed, covered: st.covered, by: st.by, guess: st.guess });
    }
    const ws = scope.kind === 'workstream' ? scope : scope.fields.workstream ? loadRecord(db, scope.fields.workstream) : null;
    const repos = new Set((ws && Array.isArray(ws.fields.projectRepos) ? ws.fields.projectRepos : []).map(String));
    for (const k of keys) for (const r of db.stmt('SELECT DISTINCT repo FROM commits WHERE task = ?').all(k)) repos.add(r.repo);
    const since = ms(scope.fields.created);
    const read = ws ? projectReviews(db, projectWs(db, ws.key)).reduce((m, r) => Math.max(m, r.cut), -Infinity) : -Infinity;
    const unowned = [];
    for (const repo of [...repos].sort()) {
      for (const r of db.stmt("SELECT repo, sha, at, session, added, removed, files FROM commits WHERE repo = ? AND task = '' ORDER BY at").all(repo)) {
        const n = linesOf(r, s.ignore);
        if (n.added + n.removed > 0 && (since === null || (ms(r.at) ?? 0) >= since)) {
          unowned.push({ repo: r.repo, sha: r.sha, at: r.at, session: r.session, ...n, covered: (ms(r.at) ?? Infinity) <= read });
        }
      }
    }
    const trackKeys = scope.kind === 'track' ? [scope.key]
      : db.stmt("SELECT key FROM records WHERE kind = 'track' AND workstream = ? AND status IN ('open', 'parked') ORDER BY id").all(scope.key).map((r) => r.key);
    const tracks = trackKeys.map((k) => ({ id: labelOf(db, k), ...(reviewHead(trackReview(db, k)) || { depth: 'off', due: false }) }));
    const dueOn = tracks.filter((t) => t.due);
    return {
      scope: { id: scope.fields.id, key: scope.key, kind: scope.kind }, depth: s.depth,
      due: dueOn.length > 0, ...(dueOn.length ? { why: 'size' } : {}), tracks, tasks, reviews, unowned,
    };
  });
}
