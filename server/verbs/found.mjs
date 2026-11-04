/* found work never goes quiet. The tasks a track's arc made, each
   with where it went, and the board's hint of the track a new task fits best. Reads
   only; the place itself is written by tracks.mjs placeTask. */
import { labelOf } from '../records.mjs';
import { loadRecord, readTx, recordOf } from './graph.mjs';
import { CLI } from '../handoff-text.mjs';

const ms = (s) => { const n = Date.parse(String(s || '')); return Number.isFinite(n) ? n : null; };
const flat = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const CLOSED_TRACK = ['done', 'dropped', 'folded'];
const ENDED = ['completed', 'dropped'];
const DAY = 864e5;

/* A release task: its name starts with Release, or it carries the label release. */
export const isRelease = (f) => Boolean(f) && (/^release\b/i.test(flat(f.name))
  || (Array.isArray(f.labels) && f.labels.some((l) => String(l).toLowerCase() === 'release')));

/* a review task, by the same pattern: its name starts with Review, or it carries the label review. */
export const isReview = (f) => Boolean(f) && (/^review\b/i.test(flat(f.name))
  || (Array.isArray(f.labels) && f.labels.some((l) => String(l).toLowerCase() === 'review')));

/* The sessions that held the track: every lease taken on it, and the one holding it now. */
export function trackSessions(db, trackKey) {
  const out = new Set(db.stmt(`SELECT DISTINCT json_extract(line, '$.changes.session[1]') AS s FROM activity
    WHERE record = ? AND json_extract(line, '$.changes.session[1]') IS NOT NULL`).all(trackKey).map((r) => r.s));
  const held = db.stmt('SELECT session FROM leases WHERE track = ?').get(trackKey);
  if (held) out.add(held.session);
  return [...out].filter(Boolean);
}

/* The session whose filing made the task, else null. */
export function creatorOf(db, key) {
  const r = db.stmt("SELECT actor FROM activity WHERE record = ? AND verb = 'create' ORDER BY seq LIMIT 1").get(key);
  const m = r && /^session:(.+)$/.exec(r.actor || '');
  return m ? m[1] : null;
}

/* Where a task sits: a track with the steps of that track it comes before and after,
   unplaced with its reason, or on no track with none given. */
export function placeOf(db, rec) {
  const row = db.stmt('SELECT track FROM track_items WHERE task = ?').get(rec.key);
  if (row) {
    const same = (sql) => db.stmt(sql).all(rec.key, row.track).map((r) => labelOf(db, r.k));
    return {
      kind: 'track', track: labelOf(db, row.track), trackName: (db.stmt('SELECT title FROM records WHERE key = ?').get(row.track) || {}).title || '',
      before: same('SELECT d.task AS k FROM depends d JOIN track_items ti ON ti.task = d.task WHERE d."on" = ? AND ti.track = ?'),
      after: same('SELECT d."on" AS k FROM depends d JOIN track_items ti ON ti.task = d."on" WHERE d.task = ? AND ti.track = ?'),
    };
  }
  const why = flat(rec.fields.unplaced);
  return why ? { kind: 'unplaced', reason: why } : { kind: 'none' };
}

/* The tasks made in a track's arc (since `since`, else the track's start, up to `until`):
   the ones on the track, and the ones its sessions filed anywhere, each with its place. */
export function foundWork(db, trackKey, { since, until } = {}) {
  const rec = loadRecord(db, trackKey);
  /* a handoff's window opens after it; the arc opens with the track, so a task filed in its first second counts */
  const from = ms(since) ?? ms(rec.fields.created);
  const open = ms(since) === null || ms(since) === ms(rec.fields.created);
  const to = ms(until);
  const inside = (s) => { const t = ms(s); return t !== null && (from === null || t > from || (open && t === from)) && (to === null || t <= to); };
  const keys = new Set(db.stmt(`SELECT r.key, json_extract(r.fields, '$.created') AS c FROM track_items ti JOIN records r ON r.key = ti.task
    WHERE ti.track = ?`).all(trackKey).filter((r) => inside(r.c)).map((r) => r.key));
  const sessions = new Set(trackSessions(db, trackKey));
  if (sessions.size) {
    /* a day's slack before the string compare, so an offset never drops one */
    const day = from === null ? '' : new Date(from - DAY).toISOString().slice(0, 10);
    for (const r of db.stmt(`SELECT key, json_extract(fields, '$.created') AS c FROM records WHERE kind = 'task'
      AND coalesce(json_extract(fields, '$.created'), '') >= ?`).all(day)) {
      if (!keys.has(r.key) && inside(r.c) && sessions.has(creatorOf(db, r.key))) keys.add(r.key);
    }
  }
  const tasks = [...keys].map((k) => loadRecord(db, k))
    .sort((a, b) => (ms(a.fields.created) ?? 0) - (ms(b.fields.created) ?? 0) || String(a.fields.id).localeCompare(String(b.fields.id), 'en', { numeric: true }))
    .map((t) => ({ id: t.fields.id, key: t.key, name: t.fields.name, status: t.fields.status, created: t.fields.created, where: placeOf(db, t) }));
  const id = rec.fields.id;
  const of = (f) => tasks.filter(f).length;
  return {
    track: id, key: trackKey, name: rec.fields.name, since: since || rec.fields.created || null, tasks,
    counts: {
      total: tasks.length, here: of((t) => t.where.kind === 'track' && t.where.track === id),
      elsewhere: of((t) => t.where.kind === 'track' && t.where.track !== id), unplaced: of((t) => t.where.kind !== 'track'),
    },
  };
}

/* The few counts the Tracks tab draws: unplaced first; null when the arc found nothing. */
export function foundSummary(db, trackKey) {
  const f = foundWork(db, trackKey);
  return f.counts.total ? { ...f.counts, unplacedIds: f.tasks.filter((t) => t.where.kind !== 'track').map((t) => t.id) } : null;
}

export function whereWords(where, here) {
  if (where.kind === 'unplaced') return 'unplaced: ' + where.reason;
  if (where.kind === 'none') return 'on no track, no reason given';
  const steps = [where.before.length ? 'before ' + where.before.join(', ') : '', where.after.length ? 'after ' + where.after.join(', ') : ''].filter(Boolean);
  return (where.track === here ? 'on this track' : 'on ' + where.track + (where.trackName ? ' ' + flat(where.trackName) : '')) + (steps.length ? ', ' + steps.join(', ') : '');
}

/* One line per task, with the command that moves it. */
export function foundLines(f, cli = CLI) {
  return f.tasks.map((t) => {
    const move = t.where.kind === 'track' && t.where.track === f.track
      ? cli + ' task edit ' + t.id + ' --track TR-n, or --before T-n or --after T-n on this track'
      : cli + ' task edit ' + t.id + ' --track ' + f.track + ' [--before T-n]';
    return t.id + ' ' + flat(t.name) + (ENDED.includes(t.status) ? ' (' + t.status + ')' : '') + ': ' + whereWords(t.where, f.track) + '. Move: ' + move;
  });
}

/* The release go's line, for the gist of a question gating `rel`: the arc of the
   track the release sits on, the unplaced named with their reasons. */
export function releaseLine(db, rel, trackKey) {
  const f = foundWork(db, trackKey);
  const relKey = rel.key;
  const before = new Set();
  const walk = [relKey];
  while (walk.length) {
    for (const r of db.stmt('SELECT "on" AS k FROM depends WHERE task = ?').all(walk.pop())) if (!before.has(r.k)) { before.add(r.k); walk.push(r.k); }
  }
  const mine = f.tasks.filter((t) => t.key !== relKey && t.where.kind === 'track' && t.where.track === f.track);
  const ahead = mine.filter((t) => before.has(t.key)).length;
  const loose = f.tasks.filter((t) => t.where.kind !== 'track');
  const parts = [ahead + ' on ' + f.track + ' before it'];
  if (mine.length - ahead) parts.push((mine.length - ahead) + ' on ' + f.track + ' not before it');
  parts.push(f.counts.elsewhere + ' on other tracks', loose.length + ' unplaced');
  const named = loose.map((t) => t.id + ' (' + (t.where.reason || 'no reason given') + ')');
  return '**Found this arc:** ' + (f.counts.total - (f.tasks.some((t) => t.key === relKey) ? 1 : 0)) + ' tasks: ' + parts.join(', ')
    + (named.length ? '; unplaced: ' + named.join(', ') : '') + '. `askerdo track found ' + f.track + '` lists each with the command that moves it.';
}

/* ---- the hint: the open track a new task fits best ---- */

const STOP = new Set(('that this with from into have when then than them they each only what which where there their will would should could about after before '
  + 'task tasks track tracks step steps line lines work board session sessions never every none also does done make made show shows name names need needs '
  + 'more some same other here just like still once used uses using it\'s its the and for not but are was were been being').split(' '));
const FILE_RE = /(?:[\w.-]+\/)+[\w.-]+|\b[\w-]+\.(?:mjs|cjs|js|ts|tsx|md|json|sql|rs|toml|yml|yaml|ps1|sh)\b/g;
const wordsOf = (s) => new Set(String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !STOP.has(w)));
const filesOf = (s) => new Set((String(s || '').match(FILE_RE) || []).map((f) => f.toLowerCase()));
const base = (f) => f.split('/').pop();

/* the open track a task fits best by its labels, the files it names and the words it
   shares with the track's name, goal, last focus and task names; the session's own track
   first among ties. A hint beside the filer's own judgment, never a default. */
export function suggestTrack(db, task, session) {
  const text = flat(task.name) + ' ' + flat(task.description) + ' ' + flat(task.intent);
  const words = wordsOf(text);
  const files = filesOf(text);
  const labels = new Set((Array.isArray(task.labels) ? task.labels : []).map((l) => String(l).toLowerCase()));
  const own = session ? (db.stmt('SELECT track FROM leases WHERE session = ?').get(session) || {}).track : null;
  const wsKey = task.workstream || null;
  let best = null;
  for (const r of db.stmt("SELECT key, label, title, workstream, fields FROM records WHERE kind = 'track'").all()) {
    const f = JSON.parse(r.fields);
    if (CLOSED_TRACK.includes(f.status)) continue;
    if (wsKey && r.workstream !== wsKey) continue;
    const items = db.stmt(`SELECT r.title, json_extract(r.fields, '$.labels') AS labels FROM track_items ti JOIN records r ON r.key = ti.task
      WHERE ti.track = ? AND coalesce(r.status, '') NOT IN ('completed', 'dropped')`).all(r.key);
    const focus = (db.stmt("SELECT json_extract(fields, '$.focus') AS f FROM handoffs WHERE track = ? ORDER BY id DESC LIMIT 1").get(r.key) || {}).f || '';
    const hay = [r.title, f.goal, focus, ...items.map((i) => i.title)].map(flat).join(' ').toLowerCase();
    const theirLabels = new Set([...(f.labels || []), ...items.flatMap((i) => (i.labels ? JSON.parse(i.labels) : []))].map((l) => String(l).toLowerCase()));
    const theirWords = wordsOf(hay);
    const why = {
      labels: [...labels].filter((l) => theirLabels.has(l)),
      files: [...files].filter((x) => hay.includes(x) || hay.includes(base(x))),
      words: [...words].filter((w) => theirWords.has(w)),
    };
    const score = 3 * why.labels.length + 3 * why.files.length + why.words.length;
    if (!score) continue;
    const mine = r.key === own;
    if (!best || score > best.score || (score === best.score && mine && !best.mine)) best = { id: r.label, name: r.title, score, mine, why };
  }
  if (!best) return null;
  const w = best.why;
  const reasons = [w.labels.length ? 'labels ' + w.labels.join(', ') : '', w.files.length ? 'files ' + w.files.join(', ') : '',
    w.words.length ? 'words ' + w.words.slice(0, 6).join(', ') : ''].filter(Boolean);
  return { track: best.id, name: best.name, why: 'shares ' + reasons.join('; ') + (best.mine ? '; it is this session\'s track' : '') };
}

export const hintWords = (s) => (s ? s.track + ' ' + flat(s.name) + ' (' + s.why + ')' : 'none (no open track shares its labels, files or words)');

/* The refusal a session's filing with no place meets: both ways, and the hint as one input. */
export const placeRefusal = (s) => 'a session files a task with its place, judged from what the work is and what it blocks:'
  + ' track (TR-n: this track or another, with before or after the steps it comes before or after, the release among them)'
  + ' or unplaced with the reason it waits on no track. The board\'s hint, one input beside that judgment: ' + hintWords(s);

/* The track found verb: its arc's tasks with their places and moves; since: "handoff" reads
   from its last handoff, as the handoff view does. */
export function trackFound(db, input = {}) {
  return readTx(db, () => {
    const rec = recordOf(db, input.track, 'track');
    let since = typeof input.since === 'string' && input.since.trim() ? input.since.trim() : undefined;
    if (since === 'handoff') {
      const h = db.stmt("SELECT json_extract(fields, '$.created') AS c FROM handoffs WHERE track = ? ORDER BY id DESC LIMIT 1").get(rec.key);
      since = h ? h.c : undefined;
    }
    const f = foundWork(db, rec.key, { since });
    return { ...f, lines: foundLines(f) };
  });
}
