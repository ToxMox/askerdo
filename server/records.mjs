/* The write primitives every verb and the import share. A record's front is
   `fields` (JSON in file order); its labels and links rows are an index of it,
   rewritten here in the same transaction so they cannot drift. */
import { randomBytes } from 'node:crypto';

export const KEY_RE = /^[0-9a-hjkmnp-tv-z]{8}$/;
export const isKey = (s) => typeof s === 'string' && KEY_RE.test(s);

const HISTORY_RE = /^(\S+) (\d{4}-\d{2}-\d{2})(?: (\d{4}-\d{2}-\d{2}))?$/;
const LINK_TYPES = ['gates', 'cites', 'revisits'];

const json = (v) => (v === undefined || v === null ? null : JSON.stringify(v));
const day = (s) => (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null);

export function setMeta(db, name, value) {
  db.stmt('INSERT INTO meta (name, value) VALUES (?, ?) ON CONFLICT (name) DO UPDATE SET value = excluded.value')
    .run(name, typeof value === 'string' ? value : JSON.stringify(value));
}

export function getMeta(db, name) {
  const row = db.stmt('SELECT value FROM meta WHERE name = ?').get(name);
  return row ? row.value : null;
}

/* Insert or replace by key; a replace bumps `version` for compare-and-write. */
export function putRecord(db, rec) {
  if (!isKey(rec.key)) throw new Error('a record needs an 8-character key: ' + rec.key);
  db.stmt(`INSERT INTO records (key, kind, slug, fields, body, layout, track) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (key) DO UPDATE SET kind = excluded.kind, slug = excluded.slug, fields = excluded.fields,
    body = excluded.body, layout = excluded.layout, track = excluded.track, version = version + 1`)
    .run(rec.key, rec.kind, rec.slug ?? null, JSON.stringify(rec.fields), rec.body ?? '', json(rec.layout), rec.track ?? null);
  indexRecord(db, rec.key, rec.kind, rec.fields);
}

function indexRecord(db, key, kind, f) {
  db.stmt("DELETE FROM labels WHERE key = ? AND origin = 'history'").run(key);
  const hist = (Array.isArray(f.labelHistory) ? f.labelHistory : [])
    .map((x) => HISTORY_RE.exec(String(x).trim())).filter(Boolean);
  const add = db.stmt(`INSERT INTO labels (label, key, kind, "from", "to", origin, position) VALUES (?, ?, ?, ?, ?, 'history', ?)`);
  /* no history: the record held its label from the day it was made */
  if (!hist.length && typeof f.id === 'string' && f.id) add.run(f.id, key, kind, day(f.created), null, 0);
  hist.forEach((m, i) => add.run(m[1], key, kind, m[2], m[3] || null, i));
  db.stmt(`DELETE FROM links WHERE "from" = ? AND type IN ('gates', 'cites', 'revisits')`).run(key);
  const link = db.stmt('INSERT OR IGNORE INTO links ("from", "to", type) VALUES (?, ?, ?)');
  for (const type of LINK_TYPES) {
    for (const to of Array.isArray(f[type]) ? f[type] : []) if (to !== '' && to !== null) link.run(key, String(to), type);
  }
}

/* The import's form: a record's whole note list, in order. */
export function putNotes(db, key, notes) {
  db.stmt('DELETE FROM notes WHERE record = ?').run(key);
  const add = db.stmt('INSERT INTO notes (record, position, at, actor, body) VALUES (?, ?, ?, ?, ?)');
  notes.forEach((n, i) => add.run(key, i, n.at ?? null, n.actor ?? null, n.body));
}

/* The verbs' form: one note at the end. */
export function addNote(db, key, { at, actor, body }) {
  const row = db.stmt('SELECT coalesce(max(position) + 1, 0) AS n FROM notes WHERE record = ?').get(key);
  db.stmt('INSERT INTO notes (record, position, at, actor, body) VALUES (?, ?, ?, ?, ?)')
    .run(key, row.n, at ?? null, actor ?? null, body);
  return row.n;
}

/* A handoff's track and PC live in its front, so the export and import carry
   them; the columns are filled from the front. */
export function putHandoff(db, h) {
  if (!isKey(h.key)) throw new Error('a handoff needs an 8-character key: ' + h.key);
  const fields = { ...h.fields };
  for (const k of ['track', 'pc']) if (fields[k] === undefined && h[k] !== undefined && h[k] !== null) fields[k] = h[k];
  const col = (v) => (typeof v === 'string' && v ? v : null);
  db.stmt(`INSERT INTO handoffs (key, slug, fields, state, where_we_were, verify, track, pc) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (key) DO UPDATE SET slug = excluded.slug, fields = excluded.fields, state = excluded.state,
    where_we_were = excluded.where_we_were, verify = excluded.verify, track = excluded.track, pc = excluded.pc`)
    .run(h.key, h.slug ?? null, JSON.stringify(fields), h.state, h.whereWeWere || null, JSON.stringify(h.verify), col(fields.track), col(fields.pc));
}

/* One audit row; `raw` keeps an imported line's own text, `pc` sits beside the
   line so a month still renders as today's writer wrote it. Returns the sequence. */
export function addActivity(db, line, raw, pc) {
  const r = db.stmt('INSERT INTO activity (line, pc) VALUES (?, ?)').run(raw ?? JSON.stringify(line), pc ?? null);
  return Number(r.lastInsertRowid);
}

/* The highest number each label prefix has reached, current labels, history and
   legacy ids alike: the floor a new label is minted above when none is free. */
export function labelTops(db) {
  const tops = {};
  const seen = (label) => {
    const m = /^(Q|WS-|P-|T-|TH-|TR-|K-|PR-)([1-9]\d{0,14})$/.exec(String(label || ''));
    if (m) tops[m[1]] = Math.max(tops[m[1]] || 0, Number(m[2]));
  };
  for (const r of db.stmt("SELECT label FROM labels WHERE origin IN ('history', 'id-map')").all()) seen(r.label);
  for (const r of db.stmt("SELECT json_extract(fields, '$.legacyId') AS l FROM records").all()) seen(r.l);
  for (const [p, n] of Object.entries(tops)) setMeta(db, 'label.top.' + p.replace(/-$/, ''), String(n));
  return tops;
}

/* ---- the clock, stamps and days ---- */

export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export const STAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/;
export const isFullStamp = (s) => STAMP_RE.test(String(s ?? ''));
const pad2 = (n) => String(Math.abs(n)).padStart(2, '0');

/* lib/stamps.mjs stampNow: local time with its offset, never Z. */
export function stampNow(date = new Date()) {
  const tz = date.getTimezoneOffset();
  const off = tz === 0 ? 0 : -tz;
  const d = new Date(date.getTime() + off * 60000);
  return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate())
    + 'T' + pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()) + ':' + pad2(d.getUTCSeconds())
    + (off < 0 ? '-' : '+') + pad2(Math.floor(Math.abs(off) / 60)) + ':' + pad2(Math.abs(off) % 60);
}

export function dayOf(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

/* The day part of a day or a full stamp, else ''. */
export function stampDay(s) {
  const t = typeof s === 'string' ? s.trim() : '';
  return DAY_RE.test(t) || STAMP_RE.test(t) ? t.slice(0, 10) : '';
}

/* Calendar arithmetic in UTC lands on the same day and skips the zone lookup. */
const dayMemo = new Map();
export function addDays(day, n) {
  const at = day + '|' + n;
  let out = dayMemo.get(at);
  if (out === undefined) {
    const [y, m, d] = String(day).split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d + n));
    out = t.getUTCFullYear() + '-' + pad2(t.getUTCMonth() + 1) + '-' + pad2(t.getUTCDate());
    if (dayMemo.size < 5000) dayMemo.set(at, out);
  }
  return out;
}

/* The clock rides on the actor (`now`: a Date, a stamp or a function), else on
   opts.now, so a test can set it; otherwise the server's own. */
export function clockOf(actor, opts) {
  const pick = (o) => (o && typeof o === 'object' ? o.now : undefined);
  let v = pick(actor);
  if (v === undefined || v === null) v = pick(opts);
  if (typeof v === 'function') v = v();
  if (v === undefined || v === null) return new Date();
  const d = v instanceof Date ? v : new Date(v);
  if (!Number.isFinite(d.getTime())) throw new TypeError('the clock (now) is not a time');
  return d;
}

/* ---- the actor ---- */

/* The `by`: an explicit by, the user's press ('user:<session>' or 'user'), 'session:<id>', else 'cli'. */
export function byOf(actor) {
  if (typeof actor === 'string' && actor.trim()) return actor.trim();
  const a = actor && typeof actor === 'object' ? actor : {};
  if (typeof a.by === 'string' && a.by.trim()) return a.by.trim();
  const u = a.user;
  if (u) return typeof u === 'string' && u.trim() ? 'user:' + u.trim() : 'user';
  if (typeof a.session === 'string' && a.session.trim()) return 'session:' + a.session.trim();
  return 'cli';
}

/* Who, from where and when, read once per verb. The PC goes in the activity
   row's own column, never in the line. */
export function actorOf(actor, opts) {
  const a = typeof actor === 'string' ? { by: actor } : actor && typeof actor === 'object' ? actor : {};
  const by = byOf(a);
  const named = typeof a.session === 'string' && a.session.trim() ? a.session.trim() : null;
  const session = named || (/^session:(.+)$/.exec(by) || [])[1] || null;
  const date = clockOf(a, opts);
  const at = stampNow(date);
  return { by, session, pc: a.pc ? String(a.pc) : null, date, at, day: at.slice(0, 10) };
}

/* a PC is named by the caller's device (the token's, server/api.mjs) wherever
   it has one; the input's pc only where none exists (an in-process board with no token). */
export function pcOfCall(input, c) {
  const named = input && typeof input.pc === 'string' && input.pc.trim() ? input.pc.trim() : null;
  return (c && c.pc) || named || null;
}

/* a session as the board knows it, never its id: "a session on
   <PC>" by the caller's own PC, its lease or the last row it wrote, else "a session". */
export function sessionWords(db, session, c = {}) {
  const s = typeof session === 'string' ? session.trim() : '';
  const pc = !s ? null : (c.session === s && c.pc) || (db.stmt('SELECT pc FROM leases WHERE session = ?').get(s) || {}).pc
    || (db.stmt('SELECT pc FROM activity WHERE actor = ? AND pc IS NOT NULL ORDER BY seq DESC LIMIT 1').get('session:' + s) || {}).pc;
  return 'a session' + (pc ? ' on ' + pc : '');
}

/* ---- keys and the labels a line shows ---- */

const KEY_ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';

/* A fresh hidden key no record or handoff holds (lib/record-ids.mjs isKey reads its shape). */
export function mintKey(db) {
  for (;;) {
    let k = '';
    for (const b of randomBytes(8)) k += KEY_ALPHABET[b & 31];
    if (!db.stmt('SELECT 1 FROM records WHERE key = ? UNION ALL SELECT 1 FROM handoffs WHERE key = ?').get(k, k)) return k;
  }
}

/* A stored reference as it is shown: a key becomes its record's (or handoff's) label. */
export function labelOf(db, ref, memo) {
  if (!isKey(ref)) return ref;
  if (memo && memo.has(ref)) return memo.get(ref);
  const r = db.stmt('SELECT label FROM records WHERE key = ?').get(ref)
    || db.stmt('SELECT label FROM handoffs WHERE key = ?').get(ref);
  const out = r && r.label ? r.label : ref;
  if (memo) memo.set(ref, out);
  return out;
}

/* A key the board knows, inside a line's text, becomes its record's label. */
export function labelText(db, s, memo) {
  return String(s).replace(/\b[0-9a-z]{8}\b/g, (k) => (isKey(k) ? labelOf(db, k, memo) : k));
}

/* ---- key order: each kind's front in today's file order ---- */

export const KEY_ORDERS = Object.freeze({
  question: ['id', 'key', 'name', 'ask', 'topic', 'status', 'blocking', 'created', 'updated', 'asked', 'pick', 'crux',
    'project', 'projectDir', 'projectRepo', 'workstream', 'track', 'gates', 'revisits', 'cites', 'labels', 'refs', 'mission', 'session',
    'pc', 'subscribers', 'snooze', 'wokeBy', 'legacy', 'evidence', 'answered', 'legacyId', 'labelHistory'],
  workstream: ['id', 'key', 'name', 'status', 'outcome', 'projects', 'projectRepos', 'created', 'updated', 'closed', 'labels', 'refs',
    'profiles', 'profileDrops', 'outcomes', 'handoff', 'subscribers', 'legacyId', 'labelHistory'],
  /* plans, threads and a task's plan and ordinal: the raw import reads them until the track merge */
  plan: ['id', 'key', 'name', 'workstream', 'status', 'outcome', 'created', 'updated', 'closed', 'labels', 'refs', 'origin', 'profiles',
    'profileDrops', 'steps', 'stepTasks', 'stepCloses', 'subscribers', 'legacyId', 'labelHistory'],
  /* `inHandSince`, when the session took it (newest first), and `agent`, the now set's tag, after inHand */
  task: ['id', 'key', 'name', 'workstream', 'plan', 'status', 'priority', 'ordinal', 'labels', 'refs', 'created', 'updated', 'closed',
    'origin', 'profiles', 'profileDrops', 'serves', 'subscribers', 'claimants', 'inHand', 'inHandSince', 'agent', 'legacyId', 'labelHistory'],
  thread: ['id', 'key', 'name', 'status', 'goal', 'links', 'session', 'step', 'created', 'updated', 'closed', 'labels', 'refs',
    'profiles', 'profileDrops', 'subscribers', 'legacyId', 'labelHistory'],
  /* a decision's links (the work it governs, the user's words, the question it answers) after refs */
  knowledge: ['id', 'key', 'name', 'type', 'status', 'supersededBy', 'amended', 'corrected', 'scope', 'projects', 'projectRepos', 'labels', 'refs',
    'workstreams', 'tracks', 'tasks', 'question', 'words', 'files', 'commands', 'legacy', 'source',
    'created', 'updated', 'closed', 'legacyId', 'labelHistory'],
  procedure: ['id', 'key', 'name', 'status', 'slug', 'project', 'projectRepo', 'doc', 'summary', 'words', 'commands', 'files', 'repos',
    'paths', 'stale', 'flag', 'verified', 'verifiedAt', 'runs', 'cleanRuns', 'lastRun', 'created', 'updated', 'closed',
    'labels', 'refs', 'legacyId', 'labelHistory'],
  track: ['id', 'key', 'name', 'workstream', 'status', 'goal', 'origin', 'parkReason', 'outcome', 'created', 'updated', 'closed',
    'labels', 'refs', 'profiles', 'profileDrops', 'legacyId', 'labelHistory'],
});
export const KEY_MAPS = Object.freeze({ workstream: ['outcomes'], plan: ['steps', 'stepTasks', 'stepCloses'], procedure: ['repos', 'verified'], knowledge: ['source'] });
/* Each kind's list keys (the old store's WORK_KINDS arrays, a question's FRONT_LISTS);
   the plan and thread rows here and in KEY_MAPS serve the raw import until the merge. */
export const KEY_LISTS = Object.freeze({
  question: ['subscribers', 'evidence', 'gates', 'revisits', 'cites', 'labels', 'refs', 'labelHistory'],
  workstream: ['projects', 'projectRepos', 'labels', 'refs', 'profiles', 'profileDrops', 'subscribers', 'labelHistory'],
  plan: ['labels', 'refs', 'profiles', 'profileDrops', 'subscribers', 'labelHistory'],
  task: ['labels', 'refs', 'profiles', 'profileDrops', 'serves', 'subscribers', 'claimants', 'labelHistory'],
  thread: ['links', 'labels', 'refs', 'profiles', 'profileDrops', 'subscribers', 'labelHistory'],
  knowledge: ['projects', 'projectRepos', 'labels', 'refs', 'workstreams', 'tracks', 'tasks', 'files', 'commands', 'labelHistory'],
  procedure: ['words', 'commands', 'files', 'paths', 'stale', 'labels', 'refs', 'labelHistory'],
  track: ['labels', 'refs', 'profiles', 'profileDrops', 'labelHistory'],
});
/* written only when they hold something (the old store's QUIET_LISTS) */
export const QUIET_LISTS = Object.freeze(['subscribers', 'profiles', 'profileDrops', 'serves']);

/* A front in its kind's order, then any other key it carried; an empty quiet
   list or an empty map is left out, as today's writer leaves it out. */
export function orderFields(kind, fields) {
  const keys = KEY_ORDERS[kind] || [];
  const maps = KEY_MAPS[kind] || [];
  const keep = (k, v) => {
    if (v === undefined || v === null) return false;
    if (QUIET_LISTS.includes(k) && Array.isArray(v) && !v.length) return false;
    if (maps.includes(k) && typeof v === 'object' && !Array.isArray(v)) return Object.values(v).some((x) => x !== undefined && x !== null);
    return true;
  };
  const out = {};
  for (const k of keys) if (keep(k, fields[k])) out[k] = fields[k];
  for (const [k, v] of Object.entries(fields)) if (!keys.includes(k) && keep(k, v)) out[k] = v;
  return out;
}

/* ---- text ---- */

/* the old store's kebab: a record's file slug from its name */
export function kebab(name, fallback) {
  const s = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
  return s || fallback;
}

/* A line starting with # gets one leading space, so it never reads as a section. */
export const guardHeadings = (text) => String(text).split('\n').map((l) => (/^#/.test(l) ? ' ' + l : l)).join('\n');

/* the old activity log's excerpt: a note is cut at 200 characters. */
export function excerpt(text) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  return s.length <= 200 ? s : s.slice(0, 197).trimEnd() + '...';
}

/* ---- the activity row ---- */

/* inHandSince moves with inHand, whose change carries the event */
const CHANGE_SKIP = ['id', 'key', 'name', 'updated', 'answered', 'closed', 'subscribers', 'claimants', 'evidence', 'legacyId', 'labelHistory', 'inHandSince'];

export function snoozeFlat(v) {
  if (!v || typeof v !== 'object') return null;
  const out = [];
  if (v.until) out.push('until ' + v.until);
  if (v.trigger) out.push('trigger: ' + v.trigger);
  if (v.wakeOn) out.push('wake on ' + v.wakeOn + (v.wakeStatus ? ' ' + v.wakeStatus : ''));
  return out.length ? out.join(', ') : null;
}

function fieldValue(key, v) {
  if (v === undefined || v === '') return null;
  if (key === 'snooze' && v && typeof v === 'object') return snoozeFlat(v);
  if (Array.isArray(v)) return v.length ? v.slice() : null;
  if (v && typeof v === 'object') return Object.entries(v).map(([k, x]) => k + ' ' + x).join(', ') || null;
  return v;
}

const sameValue = (a, b) => a === b || (a !== null && b !== null && typeof a === 'object' && typeof b === 'object'
  && JSON.stringify(a) === JSON.stringify(b));

/* the old store's changesOf: every field that moved, as field to [from, to]. */
export function changesOf(before, after) {
  const out = {};
  for (const key of new Set([...Object.keys(before || {}), ...Object.keys(after || {})])) {
    if (CHANGE_SKIP.includes(key)) continue;
    const from = fieldValue(key, before ? before[key] : undefined);
    const to = fieldValue(key, after ? after[key] : undefined);
    if (!sameValue(from, to)) out[key] = [from ?? null, to ?? null];
  }
  return out;
}

/* One verb's activity row in today's line shape (the old activity log's activityLine):
   keys inside the changed values show as labels, as commitVerb showed them. */
export function logVerb(db, l) {
  const ts = l.ts ?? l.at;
  if (!isFullStamp(ts)) throw new TypeError('an activity line needs a full local stamp: ' + ts);
  const memo = new Map();
  const lab = (v) => (typeof v === 'string' ? labelText(db, v, memo) : v);
  const changes = {};
  for (const [k, v] of Object.entries(l.changes || {})) {
    const pair = Array.isArray(v) ? [v[0] ?? null, v[1] ?? null] : [null, v ?? null];
    changes[k] = pair.map((x) => (Array.isArray(x) ? x.map(lab) : lab(x)));
  }
  const line = {
    ts, verb: String(l.verb ?? ''), kind: String(l.kind ?? ''), id: String(l.id ?? ''),
    ...(isKey(l.key) ? { key: l.key } : {}), name: String(l.name ?? ''), changes, by: String(l.by || 'cli'),
  };
  const note = excerpt(l.note);
  if (note) line.note = note;
  /* a row the board writes for a session's act names that session */
  if (typeof l.for === 'string' && l.for) line.for = l.for;
  return addActivity(db, line, undefined, l.pc);
}

/* The common call: a verb's context (actorOf) and the record's front or head. */
export function logRow(db, ctx, { verb, kind, front, changes, note }) {
  const f = front || {};
  return logVerb(db, { ts: ctx.at, verb, kind, id: f.id || '', key: f.key, name: f.name || '', changes, by: ctx.by, pc: ctx.pc, note });
}
