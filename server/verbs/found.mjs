/* found work never goes quiet. The tasks a track's arc made, each
   with where it went, and the board's hint of the track a new task fits best. Reads
   only; the place itself is written by tracks.mjs placeTask. */
import { labelOf } from '../records.mjs';
import { loadRecord, readTx, recordOf } from './graph.mjs';
import { CLI, inboxRefusal } from '../handoff-text.mjs';
import { taskWake } from './tracks.mjs';

const ms = (s) => { const n = Date.parse(String(s || '')); return Number.isFinite(n) ? n : null; };
const flat = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const CLOSED_TRACK = ['done', 'dropped', 'folded'];
const ENDED = ['done', 'dropped'];
const DAY = 864e5;

/* A release task: its name starts with Release, or it carries the label release. */
export const isRelease = (f) => Boolean(f) && (/^release\b/i.test(flat(f.name))
  || (Array.isArray(f.labels) && f.labels.some((l) => String(l).toLowerCase() === 'release')));

/* a review task carries the label review; its name never makes it one, since a
   build task named "Review ..." became a station twice. */
export const isReview = (f) => Boolean(f) && Array.isArray(f.labels) && f.labels.some((l) => String(l).toLowerCase() === 'review');

/* The sessions that held the track: every lease taken on it, and the one holding it now. */
export function trackSessions(db, trackKey) {
  const out = new Set(db.stmt(`SELECT DISTINCT json_extract(line, '$.changes.session[1]') AS s FROM activity
    WHERE record = ? AND json_extract(line, '$.changes.session[1]') IS NOT NULL`).all(trackKey).map((r) => r.s));
  const held = db.stmt('SELECT session FROM leases WHERE track = ?').get(trackKey);
  if (held) out.add(held.session);
  return [...out].filter(Boolean);
}

/* Where a task sits: a track with the steps of that track it comes before and after,
   unplaced with its reason, or on no track with none given. `steps: false` names the track only. */
export function placeOf(db, rec, { steps = true } = {}) {
  const row = db.stmt('SELECT track FROM track_items WHERE task = ?').get(rec.key);
  /* the tier its filing named, or the board derived */
  const tier = { ...(Number.isInteger(rec.fields.tier) ? { tier: rec.fields.tier } : {}), ...(flat(rec.fields.whyElsewhere) ? { whyElsewhere: flat(rec.fields.whyElsewhere) } : {}) };
  if (row && !steps) return { ...tier, kind: 'track', track: labelOf(db, row.track) };
  if (row) {
    const same = (sql) => db.stmt(sql).all(rec.key, row.track).map((r) => labelOf(db, r.k));
    return {
      ...tier, kind: 'track', track: labelOf(db, row.track), trackName: (db.stmt('SELECT title FROM records WHERE key = ?').get(row.track) || {}).title || '',
      before: same('SELECT d.task AS k FROM depends d JOIN track_items ti ON ti.task = d.task WHERE d."on" = ? AND ti.track = ?'),
      after: same('SELECT d."on" AS k FROM depends d JOIN track_items ti ON ti.task = d."on" WHERE d.task = ? AND ti.track = ?'),
    };
  }
  const why = flat(rec.fields.unplaced);
  return why ? { ...tier, kind: 'unplaced', reason: why } : { ...tier, kind: 'none' };
}

/* The tasks made in a track's arc (since `since`, else the track's start, up to `until`):
   the ones on the track, and the ones its sessions filed anywhere, each with its place
   (`steps: false`, its track without the steps it comes before and after). */
export function foundWork(db, trackKey, { since, until, steps = true } = {}) {
  const rec = loadRecord(db, trackKey);
  /* a handoff's window opens after it; the arc opens with the track, so a task filed in its first second counts */
  const from = ms(since) ?? ms(rec.fields.created);
  const open = ms(since) === null || ms(since) === ms(rec.fields.created);
  const to = ms(until);
  const inside = (s) => { const t = ms(s); return t !== null && (from === null || t > from || (open && t === from)) && (to === null || t <= to); };
  const keys = new Set(db.stmt(`SELECT r.key, json_extract(r.fields, '$.created') AS c FROM track_items ti JOIN records r ON r.key = ti.task
    WHERE ti.track = ?`).all(trackKey).filter((r) => inside(r.c)).map((r) => r.key));
  const sessions = trackSessions(db, trackKey);
  if (sessions.length) {
    /* a day's slack before the string compare, so an offset never drops one; the tasks whose first
       create row a track session wrote. CROSS JOIN keeps activity first, on its (verb, actor) index,
       so the cost follows the sessions' filings and not every task on the board */
    const day = from === null ? '' : new Date(from - DAY).toISOString().slice(0, 10);
    for (const r of db.stmt(`SELECT DISTINCT r.key, json_extract(r.fields, '$.created') AS c FROM activity a CROSS JOIN records r ON r.key = a.record
      WHERE a.verb = 'create' AND a.actor IN (SELECT 'session:' || value FROM json_each(?)) AND r.kind = 'task'
      AND coalesce(json_extract(r.fields, '$.created'), '') >= ?
      AND NOT EXISTS (SELECT 1 FROM activity b WHERE b.record = a.record AND b.verb = 'create' AND b.seq < a.seq)`).all(JSON.stringify(sessions), day)) {
      if (inside(r.c)) keys.add(r.key);
    }
  }
  const tasks = [...keys].map((k) => loadRecord(db, k))
    .sort((a, b) => (ms(a.fields.created) ?? 0) - (ms(b.fields.created) ?? 0) || String(a.fields.id).localeCompare(String(b.fields.id), 'en', { numeric: true }))
    .map((t) => ({ id: t.fields.id, key: t.key, name: t.fields.name, status: t.fields.status, created: t.fields.created, where: placeOf(db, t, { steps }) }));
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

/* The few counts the Tracks tab draws: unplaced first; null when the arc found nothing.
   each found task's track is all it needs, so no step reads. */
export function foundSummary(db, trackKey) {
  const f = foundWork(db, trackKey, { steps: false });
  return f.counts.total ? { ...f.counts, unplacedIds: f.tasks.filter((t) => t.where.kind !== 'track').map((t) => t.id) } : null;
}

/* the filer's line on why the track it held does not cover the work, quoted so its own
   semicolons never read as the list's separator */
export const pastWords = (line) => (line ? ' (past the held track: "' + String(line).replace(/"/g, "'") + '")' : '');

export function whereWords(where, here) {
  const tier = where.tier !== undefined ? 'tier ' + where.tier + ', ' : '';
  const why = pastWords(where.whyElsewhere);
  if (where.kind === 'unplaced') return tier + 'unplaced: ' + where.reason + why;
  if (where.kind === 'none') return tier + 'on no track, no reason given' + why;
  return tier + trackWords(where, here) + why;
}
function trackWords(where, here) {
  const steps = [where.before.length ? 'before ' + where.before.join(', ') : '', where.after.length ? 'after ' + where.after.join(', ') : ''].filter(Boolean);
  return (where.track === here ? 'on this track' : 'on ' + where.track + (where.trackName ? ' ' + flat(where.trackName) : '')) + (steps.length ? ', ' + steps.join(', ') : '');
}

/* One line per task, with the command that moves it. An open unplaced task whose wake has not
   come owes nothing; a due one, or one with no reason, prints the board's call (trackFound adds `offers`). */
export function foundLines(f, cli = CLI) {
  return f.tasks.map((t) => {
    const head = t.id + ' ' + flat(t.name) + (ENDED.includes(t.status) ? ' (' + t.status + ')' : '') + ': ' + whereWords(t.where, f.track);
    const loose = t.where.kind !== 'track' && !ENDED.includes(t.status);
    if (loose && Array.isArray(t.offers)) {
      return head + (t.due ? '; due (its wake: ' + flat(t.wake) + ')' : t.wake ? '; wakes ' + flat(t.wake) : '') + (t.line ? '; "' + t.line + '"' : '') + ". The board's call: "
        + t.offers.map((o) => (o.call === 'ask' ? 'ask the user (ask, with gates ' + t.id + ')' : '`' + cli + ' task edit ' + t.id + ' ' + o.flags + ' --session <own-id>`'
          + (o.hint ? ' (' + o.hint.track + ' ' + flat(o.hint.name) + ')' : ''))).join(', or ');
    }
    if (loose && t.away) return head + (t.due ? '; due in ' + t.away + ', which places it' : '; wakes ' + flat(t.wake) + ', and owes nothing until then');
    if (loose && t.wake && !t.due && t.where.kind !== 'none') return head + '; wakes ' + flat(t.wake) + ', and owes nothing until then';
    const move = t.where.kind === 'track' && t.where.track === f.track
      ? cli + ' task edit ' + t.id + ' --track TR-n, or --before T-n or --after T-n on this track'
      : cli + ' task edit ' + t.id + ' --track ' + f.track + ' [--before T-n]';
    return head + '. Move: ' + move;
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
export const wordsOf = (s) => new Set(String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !STOP.has(w)));
const filesOf = (s) => new Set((String(s || '').match(FILE_RE) || []).map((f) => f.toLowerCase()));
const base = (f) => f.split('/').pop();

/* the open track a task fits best by its labels, the files it names and the words it
   shares with the track's name, goal, last focus and task names; the session's own track
   first among ties. A hint beside the filer's own judgment, never a default. */
export const suggestTrack = (db, task, session) => trackHinter(db, session)(task);

/* The hint for many tasks in one call: each open track's words are loaded once. `exclude`: a
   track key never offered (a closing track). */
export function trackHinter(db, session, { exclude } = {}) {
  const own = session ? (db.stmt('SELECT track FROM leases WHERE session = ?').get(session) || {}).track : null;
  const tracks = [];
  for (const r of db.stmt("SELECT key, label, title, workstream, fields FROM records WHERE kind = 'track'").all()) {
    const f = JSON.parse(r.fields);
    if (CLOSED_TRACK.includes(f.status) || r.key === exclude) continue;
    const items = db.stmt(`SELECT r.title, json_extract(r.fields, '$.labels') AS labels FROM track_items ti JOIN records r ON r.key = ti.task
      WHERE ti.track = ? AND coalesce(r.status, '') NOT IN ('done', 'dropped')`).all(r.key);
    const focus = (db.stmt("SELECT json_extract(fields, '$.focus') AS f FROM handoffs WHERE track = ? ORDER BY id DESC LIMIT 1").get(r.key) || {}).f || '';
    const hay = [r.title, f.goal, focus, ...items.map((i) => i.title)].map(flat).join(' ').toLowerCase();
    const labels = new Set([...(f.labels || []), ...items.flatMap((i) => (i.labels ? JSON.parse(i.labels) : []))].map((l) => String(l).toLowerCase()));
    tracks.push({ key: r.key, label: r.label, title: r.title, workstream: r.workstream, hay, labels, words: wordsOf(hay) });
  }
  return (task) => {
    const text = flat(task.name) + ' ' + flat(task.description) + ' ' + flat(task.intent);
    const words = wordsOf(text);
    const files = filesOf(text);
    const labels = new Set((Array.isArray(task.labels) ? task.labels : []).map((l) => String(l).toLowerCase()));
    const wsKey = task.workstream || null;
    let best = null;
    for (const t of tracks) {
      if (wsKey && t.workstream !== wsKey) continue;
      const why = {
        labels: [...labels].filter((l) => t.labels.has(l)),
        files: [...files].filter((x) => t.hay.includes(x) || t.hay.includes(base(x))),
        words: [...words].filter((w) => t.words.has(w)),
      };
      const score = 3 * why.labels.length + 3 * why.files.length + why.words.length;
      if (!score) continue;
      const mine = t.key === own;
      if (!best || score > best.score || (score === best.score && mine && !best.mine)) best = { id: t.label, name: t.title, score, mine, why };
    }
    if (!best) return null;
    const w = best.why;
    const reasons = [w.labels.length ? 'labels ' + w.labels.join(', ') : '', w.files.length ? 'files ' + w.files.join(', ') : '',
      w.words.length ? 'words ' + w.words.slice(0, 6).join(', ') : ''].filter(Boolean);
    return { track: best.id, name: best.name, why: 'shares ' + reasons.join('; ') + (best.mine ? '; it is this session\'s track' : '') };
  };
}

/* ---- the board's call for a listed item (the tier ladder) ---- */

const UNPARK_FORMS = '<track-ends TR-n | task-completes T-n | question-answered Q-n>';
const OFFERS_MAX = 10;

/* An offer as data, with the flags that send it (a leftover sends the same names as fields). */
export function offerOf(o) {
  if (o.call !== 'place') return o;
  const flags = ['--tier ' + o.tier, ...(o.track ? ['--track ' + o.track] : []), ...(o.workstream ? ['--workstream ' + o.workstream] : []),
    ...(o.unparkWhen ? ['--unpark-when "' + o.unparkWhen + '"'] : []), ...(o.wake ? ['--wake "' + o.wake + '"'] : []),
    ...(o.before ? ['--before ' + o.before] : []), ...(o.last ? ['--last "' + o.last + '"'] : []),
    ...(o.whyElsewhere ? ['--why-elsewhere "' + o.whyElsewhere + '"'] : [])];
  return { ...o, flags: flags.join(' ') };
}

/* a tier 2 step on the held track (`id`) names before, or last with why nothing there needs it
   sooner, so the board never offers a bare tier 2 it refuses. `hint` rides the first. */
export const heldOffers = (id, hint) => [{ call: 'place', tier: 2, before: 'T-n', ...(hint ? { hint } : {}) },
  { call: 'place', tier: 2, last: '<why nothing on ' + (id || 'TR-n') + ' needs it sooner>' }];

/* The hint as the call that fits: the held track (key `held`) is tier 2, another in `ownWs` tier 3,
   any other tier 4; with no hint, a parked track an event opens, or a question. A held track in the
   task's workstream (`taskWs`) offers tier 2 first, the nearest rung. */
export function offersOfHint(db, s, { held = null, ownWs = null, taskWs = null } = {}) {
  const step = held && (!taskWs || !ownWs || taskWs === ownWs) ? heldOffers(labelOf(db, held)) : [];
  if (!s) return [...step, { call: 'place', tier: 3, unparkWhen: UNPARK_FORMS }, { call: 'ask' }];
  const t = recordOf(db, s.track, 'track');
  if (held && t.key === held) return heldOffers(s.track, s);
  const away = ownWs && t.fields.workstream !== ownWs;
  return [...step, { call: 'place', tier: away ? 4 : 3, track: s.track, ...(away ? { workstream: labelOf(db, t.fields.workstream) } : {}), hint: s }];
}

/* A task's description, its first line, for a list. */
const section = (rec, name) => {
  const m = new RegExp('(?:^|\\n)## ' + name + '[ \\t]*\\n([\\s\\S]*?)(?=\\n## |$)').exec(String((rec && rec.body) || ''));
  return m ? m[1] : '';
};
export function descLine(rec) {
  const first = section(rec, 'Description').split('\n').map((l) => l.trim()).find(Boolean) || '';
  return first.length > 200 ? first.slice(0, 197).trimEnd() + '...' : first;
}

/* Each owed item a list names (at most ten) with its unplaced reason, its description's first line and
   the board's call (`offers`, each with flags); the hinter loads each open track's words once.
   `owed(t)` picks them; `held` and `ownWs` are keys; `exclude`, a track never offered. */
export function withOffers(db, items, { owed = () => true, held = null, ownWs = null, exclude = null, session = null } = {}) {
  const list = Array.isArray(items) ? items : [];
  const pick = new Set(list.filter((t) => t && owed(t)).slice(0, OFFERS_MAX));
  if (!pick.size) return list;
  const hint = trackHinter(db, session, { exclude });
  return list.map((t) => {
    if (!pick.has(t)) return t;
    const rec = loadRecord(db, t.key || recordOf(db, t.id, 'task').key);
    if (!rec) return t;
    const f = rec.fields;
    const line = descLine(rec);
    const s = hint({ name: f.name, description: section(rec, 'Description'), intent: section(rec, 'Intent'), labels: f.labels, workstream: f.workstream || null });
    return { ...t, ...(flat(f.unplaced) ? { reason: flat(f.unplaced) } : {}), ...(line ? { line } : {}), offers: offersOfHint(db, s, { held, ownWs, taskWs: f.workstream || null }).map(offerOf) };
  });
}

/* the inbox rows a close or kickoff owes (due, not with the user, in `wsKey`'s workstream), with their calls. */
export function inboxOffers(db, rows, { held = null, wsKey = null, exclude = null } = {}) {
  const own = wsKey ? labelOf(db, wsKey) : null;
  return withOffers(db, rows, { owed: (t) => t.due && !t.asked && (!own || !t.workstream || t.workstream.id === own), held, ownWs: wsKey, exclude });
}

export const hintWords = (s) => (s ? s.track + ' ' + flat(s.name) + ' (' + s.why + ')' : 'none (no open track shares its labels, files or words)');

/* The refusal a session's filing with no place meets: both ways, and the hint as one input;
   worded as every inbox refusal is (handoff-text.mjs inboxRefusal). */
export const placeRefusal = (s, at = {}) => inboxRefusal({ ...at, cause: 'a session files a task with its place, judged from what the work is and what it blocks:'
  + ' a track (TR-n: this track or another, with before or after the steps it comes before or after, the release among them)'
  + ' or unplaced with the reason no plan reaches it and its wake',
hint: 'The board\'s hint, one input beside that judgment: ' + hintWords(s) });

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
    /* the open unplaced ones with their wake; the owed (due, or no reason given) with the board's call, this track as tier 2 */
    const loose = f.tasks.map((t) => {
      if (t.where.kind === 'track' || ENDED.includes(t.status)) return t;
      const r = loadRecord(db, t.key);
      /* another workstream's due task is placed there, so only named here */
      const away = Boolean(r.fields.workstream && rec.fields.workstream && r.fields.workstream !== rec.fields.workstream);
      return { ...t, ...taskWake(db, r), ...(away ? { away: labelOf(db, r.fields.workstream) } : {}) };
    });
    const open = !CLOSED_TRACK.includes(rec.fields.status);
    const tasks = withOffers(db, loose, { owed: (t) => t.where.kind !== 'track' && !ENDED.includes(t.status) && !t.away && (t.due || t.where.kind === 'none'),
      held: open ? rec.key : null, ownWs: rec.fields.workstream || null, exclude: open ? null : rec.key });
    const out = { ...f, tasks };
    return { ...out, lines: foundLines(out) };
  });
}
