/* Labels by date over the labels table: every id the user types
   resolves, the pre-cutover map and the old brain ids included, and a reused
   label resolves by the day it is cited at. Also the pick of a new label (a label is freed 14 days after its record ends, rests 30, then is reused). */
import {
  DAY_RE, STAMP_RE, addDays, dayOf, getMeta, isKey, labelOf, setMeta, stampDay,
} from '../records.mjs';
import { shortName } from '../web/graph.mjs';

export class UsageError extends Error {}

export const ARCHIVE_DAYS = 14;
export const REST_DAYS = 30;

/* Each kind's label shape and the statuses that end it; plan and thread are the
   raw import's kinds, read until the track merge makes them tracks. */
export const LABEL_KINDS = Object.freeze({
  question: { prefix: 'Q', sep: '', ended: ['answered', 'dropped'] },
  workstream: { prefix: 'WS', sep: '-', ended: ['closed'] },
  plan: { prefix: 'P', sep: '-', ended: ['closed'] },
  task: { prefix: 'T', sep: '-', ended: ['dropped', 'completed'] },
  thread: { prefix: 'TH', sep: '-', ended: ['done', 'dropped'] },
  knowledge: { prefix: 'K', sep: '-', ended: ['superseded', 'withdrawn'] },
  procedure: { prefix: 'PR', sep: '-', ended: ['retired'] },
  track: { prefix: 'TR', sep: '-', ended: ['done', 'dropped', 'folded'] },
});
export const ENDED = Object.freeze(Object.fromEntries(Object.entries(LABEL_KINDS).map(([k, v]) => [k, v.ended])));

/* ---- spans (the old record-ids, over a record's fields) ---- */

/* The day a record ended, or '' while it runs; an old record without `closed`
   falls back to its last movement. */
export function closedDay(kind, f) {
  const k = LABEL_KINDS[kind];
  if (!f || !k || !k.ended.includes(f.status)) return '';
  const v = kind === 'question' ? f.answered : (f.closed || f.updated);
  return stampDay(v) || stampDay(f.updated) || stampDay(f.created) || '';
}

export function archiveDay(kind, f) {
  const c = closedDay(kind, f);
  return c ? addDays(c, ARCHIVE_DAYS) : '';
}

export const isArchived = (kind, f, day) => {
  const a = archiveDay(kind, f);
  return Boolean(a) && a <= day;
};

export function parseHistory(list) {
  const out = [];
  for (const item of Array.isArray(list) ? list : []) {
    const m = /^(\S+) (\d{4}-\d{2}-\d{2})(?: (\d{4}-\d{2}-\d{2}))?$/.exec(String(item).trim());
    if (m) out.push({ label: m[1], from: m[2], to: m[3] || '' });
  }
  return out;
}

export const historyItem = (h) => h.label + ' ' + h.from + (h.to ? ' ' + h.to : '');

/* Every span a record held a label, the current one ending at its archive day. */
export function heldSpans(kind, f) {
  const hist = parseHistory(f.labelHistory);
  const arch = archiveDay(kind, f);
  if (!hist.length && f.id) hist.push({ label: String(f.id), from: stampDay(f.created) || '0000-01-01', to: '' });
  return hist.map((h) => ({ ...h, to: h.to || (h.label === f.id ? arch : '') }));
}

const NUMBER_RE = /^[1-9]\d{0,14}$/;
function labelNumber(label, prefix, sep) {
  const s = String(label || '');
  const head = prefix + sep;
  return s.startsWith(head) && NUMBER_RE.test(s.slice(head.length)) ? Number(s.slice(head.length)) : null;
}

/* ---- tokens ---- */

/* A typed token in its stored label form: `Q12` (a bare `12` too), `WS-3`, `TH-3.2`, `TR-7.4`. */
export function canonLabel(token) {
  const t = String(token ?? '').trim();
  if (/^[Qq]?\d{1,15}$/.test(t)) return 'Q' + Number(t.replace(/^[Qq]/, ''));
  let m = /^(ws|pr|p|th|tr|t|k)-([1-9]\d{0,14})$/i.exec(t);
  if (m) return m[1].toUpperCase() + '-' + Number(m[2]);
  m = /^(th|tr)-([1-9]\d{0,14})\.([1-9]\d{0,14})$/i.exec(t);
  if (m) return m[1].toUpperCase() + '-' + Number(m[2]) + '.' + Number(m[3]);
  return null;
}

/* ---- rows ---- */

const ROW = 'SELECT key, kind, slug, fields, body, layout, track, version FROM records';

/* A record row with its front parsed; `front` and `fields` are one object. */
export function entryOf(r) {
  if (!r) return null;
  const fields = JSON.parse(r.fields);
  return { ...r, fields, front: fields, layout: r.layout ? JSON.parse(r.layout) : null, label: String(fields.id ?? ''), ref: r.key };
}

export function loadEntry(db, key) {
  return entryOf(db.stmt(ROW + ' WHERE key = ?').get(key));
}

function handoffEntry(h) {
  if (!h) return null;
  const fields = JSON.parse(h.fields);
  return { key: h.key, kind: 'handoff', fields, front: fields, label: String(fields.id ?? ''), ref: h.key, track: h.track };
}

const spanFrom = (e) => {
  const cur = heldSpans(e.kind, e.front).filter((s) => s.label === e.label);
  return cur.length ? cur[cur.length - 1].from : '';
};
const earliest = (list) => list.slice().sort((a, b) => (spanFrom(a) < spanFrom(b) ? -1 : spanFrom(a) > spanFrom(b) ? 1 : 0)
  || (a.key < b.key ? -1 : 1))[0];
const latest = (list) => list.slice().sort((a, b) => (archiveDay(b.kind, b.front) > archiveDay(a.kind, a.front) ? 1 : -1))[0];

/* TR-n.m (an old TH-n.m too) is handoff m in the chain of the track TR-n names. */
function handoffHolder(db, label, day) {
  const parent = resolveRecord(db, label.replace(/\.\d+$/, ''), { day });
  const all = db.stmt('SELECT key, fields, track FROM handoffs WHERE label = ? ORDER BY id').all(label).map(handoffEntry);
  if (!all.length) return null;
  /* a handoff names its thread until the track merge (the migration's label snapshot reads it) */
  const own = parent ? all.filter((h) => h.front.thread === parent.key || h.track === parent.key) : [];
  if (own.length) return own[0];
  /* that holder's own handoff or none; an old TH-n.m whose thread is gone still reads */
  return parent || /^TR-/.test(label) ? null : all[0];
}

/* THE ONE RESOLVER: a key, a label or a legacy id to the record it names, or
   null. A label names its live holder on `day`, else the record that last held it. */
export function resolveRecord(db, token, { kinds, day } = {}) {
  const t = String(token ?? '').trim();
  const ok = (e) => Boolean(e) && (!kinds || kinds.includes(e.kind));
  if (isKey(t)) {
    const e = loadEntry(db, t);
    if (e) return ok(e) ? e : null;
    const h = handoffEntry(db.stmt('SELECT key, fields, track FROM handoffs WHERE key = ?').get(t));
    return ok(h) ? h : null;
  }
  const label = canonLabel(t);
  if (!label) return null;
  const now = day || dayOf(new Date());
  if (/\.\d+$/.test(label)) {
    const h = handoffHolder(db, label, now);
    return ok(h) ? h : null;
  }
  const holders = db.stmt(ROW + ' WHERE label = ?').all(label).map(entryOf).filter(ok);
  const live = holders.filter((e) => !isArchived(e.kind, e.front, now));
  if (live.length) return earliest(live);
  if (holders.length) return latest(holders);
  const legacy = db.stmt(ROW + " WHERE json_extract(fields, '$.legacyId') = ? ORDER BY id").all(label).map(entryOf).filter(ok);
  if (legacy.length) return legacy[0];
  const earlier = db.stmt(ROW + " WHERE key IN (SELECT key FROM labels WHERE label = ? AND origin = 'history')").all(label)
    .map(entryOf).filter(ok);
  return earlier.length ? latest(earlier) : null;
}

/* Every item of a refs list that names a record stored as its key. */
export function refsFor(db, list, day) {
  return (list || []).map((v) => {
    const s = String(v).trim();
    if (!canonLabel(s) || /^\d+$/.test(s)) return v;
    const e = resolveRecord(db, s, { day });
    return e ? e.key : v;
  });
}

export function strList(raw, key) {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.some((s) => typeof s !== 'string' || !s.trim())) throw new UsageError(key + ' must be an array of non-empty strings');
  return [...new Set(raw.map((s) => s.trim()))];
}

/* question, workstreams, tracks and tasks: a decision's links */
const REF_SCALARS = ['workstream', 'track', 'supersededBy', 'question'];
const REF_LISTS = ['gates', 'revisits', 'cites', 'refs', 'workstreams', 'tracks', 'tasks'];

/* Lines are named by their names, never by a resting TR-n alone. */
export function lineName(db, key) {
  const r = db.stmt('SELECT label, title FROM records WHERE key = ?').get(key);
  return r ? (r.title ? r.title + ' (' + r.label + ')' : r.label) : key;
}

/* a record's label with its short name beside it ("T-5 The move"), the way a list names it */
export function namedLabel(db, ref) {
  const r = isKey(ref) ? db.stmt('SELECT label, title FROM records WHERE key = ?').get(ref) : null;
  if (!r) return labelOf(db, ref);
  const n = shortName(r.title || '');
  return n ? r.label + ' ' + n : r.label;
}

/* A front with every cross-reference shown as a label: the output boundary. */
export function shownFront(db, front, memo = new Map()) {
  if (!front || typeof front !== 'object') return front;
  const out = { ...front };
  const lab = (v) => labelOf(db, v, memo);
  for (const k of REF_SCALARS) if (typeof out[k] === 'string' && out[k]) out[k] = lab(out[k]);
  for (const k of REF_LISTS) if (Array.isArray(out[k])) out[k] = out[k].map((v) => (typeof v === 'string' ? lab(v) : v));
  /* a close or unpark condition names its record by key, shown by label */
  for (const k of ['close', 'unparkWhen']) {
    const v = out[k];
    if (v && typeof v === 'object' && typeof v.on === 'string') out[k] = { ...v, on: v.kind === 'track-ends' && isKey(v.on) ? lineName(db, v.on) : lab(v.on) };
  }
  if (out.snooze && typeof out.snooze === 'object' && typeof out.snooze.wakeOn === 'string') {
    out.snooze = { ...out.snooze, wakeOn: lab(out.snooze.wakeOn) };
  }
  return out;
}

/* ---- resolve by date (askerdo resolve) ---- */

function atDay(at) {
  const s = String(at ?? '').trim();
  if (DAY_RE.test(s)) return s;
  if (STAMP_RE.test(s)) return s.slice(0, 10);
  throw new UsageError('--at takes YYYY-MM-DD or a full stamp: ' + s);
}

/* Which record held a label: with `at`, the holder on that day (before the
   cutover, the pre-cutover map's record); without, the live holder and every
   earlier one. `today` is the clock seam. */
export function resolveLabel(db, token, opts = {}) {
  /* over the wire the input is { label, at }, and the third argument is the actor */
  const named = !!token && typeof token === 'object';
  const at = named ? token.at ?? undefined : opts.at;
  const today = named ? undefined : opts.today;
  if (named) token = token.label;
  const label = canonLabel(token);
  if (!label) throw new UsageError('resolve takes a label such as Q12, T-5 or TH-3.2: ' + token);
  const today0 = today || dayOf(new Date());
  const spans = [];
  if (/\.\d+$/.test(label)) {
    for (const h of db.stmt('SELECT key, fields, track FROM handoffs WHERE label = ? ORDER BY id').all(label).map(handoffEntry)) {
      /* one the merge left off a track (its thread was gone) still names that thread */
      const parentKey = h.track || h.front.thread;
      const p = isKey(parentKey) ? loadEntry(db, parentKey) : null;
      spans.push({ e: h, from: stampDay(h.front.created) || '0000-01-01', to: p ? archiveDay(p.kind, p.front) : '' });
    }
  } else {
    const rows = db.stmt(ROW + " WHERE key IN (SELECT key FROM labels WHERE label = ? AND origin = 'history')").all(label).map(entryOf);
    for (const e of rows) for (const s of heldSpans(e.kind, e.front)) if (s.label === label) spans.push({ e, from: s.from, to: s.to });
  }
  spans.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  const row = (h) => ({
    label, key: h.e.key, kind: h.e.kind, name: String(h.e.front.name || h.e.front.focus || ''),
    now: h.e.label, from: h.from, to: h.to || '',
  });
  if (at === undefined) {
    const live = spans.find((h) => !h.to || today0 < h.to);
    return { label, live: live ? row(live) : null, earlier: spans.filter((h) => h !== live).map(row) };
  }
  const day = atDay(at);
  const cut = db.stmt("SELECT \"to\" AS at FROM labels WHERE origin = 'id-map' ORDER BY position LIMIT 1").get();
  if (cut && cut.at && day < cut.at) {
    const m = db.stmt("SELECT key, extra FROM labels WHERE origin = 'id-map' AND label = ? ORDER BY position LIMIT 1").get(label);
    const e = m && m.key ? loadEntry(db, m.key) : null;
    if (e) {
      const name = (m.extra && JSON.parse(m.extra).name) || '';
      return { label, at: day, record: { label, key: e.key, kind: e.kind, name, now: e.label, from: '', to: cut.at } };
    }
  }
  const hit = spans.filter((h) => h.from <= day && (!h.to || day < h.to)).pop();
  return { label, at: day, record: hit ? row(hit) : null };
}

/* ---- old brain ids (the legacy map, over the labels table's brain rows) ---- */

const BARE_RE = /^([GDT])-(\d{4})$/i;
const QUAL_RE = /^([a-z0-9][a-z0-9-]*):(.+)$/i;

function bareId(s) {
  const m = BARE_RE.exec(s);
  if (!m) return null;
  if (m[1].toUpperCase() === 'T' && !m[2].startsWith('0')) return null;
  return m[1].toUpperCase() + '-' + m[2];
}

/* { slug, id } for an old id (G-0001, slug:D-0003, slug:mission:x), or null. */
export function parseLegacyToken(text) {
  const raw = String(text ?? '').trim();
  const b = bareId(raw);
  if (b) return { slug: null, id: b };
  const q = QUAL_RE.exec(raw);
  if (!q) return null;
  const slug = q[1].toLowerCase();
  const qb = bareId(q[2]);
  if (qb) return { slug, id: qb };
  if (/^(mission|handoff):[^\s:]+$/i.test(q[2])) {
    const cut = q[2].indexOf(':');
    return { slug, id: q[2].slice(0, cut).toLowerCase() + q[2].slice(cut) };
  }
  return null;
}

const normDir = (p) => String(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

/* --project, then the cwd's repo through the map's roots, then the one holder;
   else a usage error naming every candidate. `entry.label` is the record's label now. */
export function resolveLegacy(db, text, { project, cwd } = {}) {
  const t = parseLegacyToken(text);
  if (!t) throw new UsageError('not an old brain id: ' + text);
  const hit = (slug) => {
    const r = db.stmt("SELECT label, extra FROM labels WHERE origin = 'brain' AND label = ?").get(slug + ':' + t.id);
    return r ? { key: r.label, entry: JSON.parse(r.extra) } : null;
  };
  let found = null;
  if (t.slug || project !== undefined) {
    const slug = t.slug || String(project).trim().toLowerCase();
    found = hit(slug);
    if (!found) throw new UsageError(slug + ':' + t.id + ' is not in the legacy map');
  } else {
    const head = JSON.parse(getMeta(db, 'legacy.brain') || '{}');
    if (cwd) {
      const here = normDir(cwd);
      let best = null;
      for (const [dir, slug] of Object.entries(head.roots || {})) {
        const d = normDir(dir);
        if ((here === d || here.startsWith(d + '/')) && (!best || d.length > best.len)) best = { slug, len: d.length };
      }
      if (best) found = hit(best.slug);
    }
    if (!found) {
      const holders = db.stmt("SELECT label, extra FROM labels WHERE origin = 'brain' AND label LIKE ? ORDER BY position").all('%:' + t.id);
      if (!holders.length) throw new UsageError(t.id + ' is not in the legacy map');
      if (holders.length > 1) {
        throw new UsageError(t.id + ' exists in ' + holders.length + ' projects: ' + holders.map((h) => h.label).join(', ')
          + '; qualify it or pass --project <slug>');
      }
      found = { key: holders[0].label, entry: JSON.parse(holders[0].extra) };
    }
  }
  const to = found.entry.to;
  if (!isKey(to)) return found;
  /* its label now, or the key once that label names another record */
  const label = labelOf(db, to);
  const holder = label === to ? null : resolveRecord(db, label);
  return { ...found, entry: { ...found.entry, label: holder && holder.key === to ? label : to } };
}

/* ---- endings ---- */

/* A record reopened after its archive day gave its label up: it takes a fresh one
   and its history closes the old span. */
export function relabelIfArchived(db, kind, front, before, day) {
  if (!isKey(front.key) || !isArchived(kind, before, day)) return;
  const hist = heldSpans(kind, before).map((h) => ({ label: h.label, from: h.from, to: h.to }));
  const next = pickLabel(db, kind, day);
  hist.push({ label: next, from: day, to: '' });
  front.id = next;
  front.labelHistory = hist.map(historyItem);
}

/* Moving into an ending stamps `closed`; moving out clears it (the old store's
   endingStamps). `ctx` is the verb's { at, day }. */
export function endingStamps(db, kind, front, before, ctx) {
  const ended = (f) => (ENDED[kind] || []).includes(f.status);
  if (ended(front) && !ended(before)) front.closed = ctx.at;
  else if (!ended(front) && ended(before)) {
    relabelIfArchived(db, kind, front, before, ctx.day);
    delete front.closed;
  }
}

/* The rules chain's lookup: a key or a label to its record row, or null; a
   task carries the track it sits on (`onTrack`), which lives in track_items. */
export const lookupFor = (db) => (ref) => {
  const e = String(ref ?? '').trim() ? resolveRecord(db, ref) : null;
  if (e && e.kind === 'task') {
    const t = db.stmt('SELECT track FROM track_items WHERE task = ?').get(e.key);
    if (t) e.onTrack = t.track;
  }
  return e;
};

/* ---- minting ---- */

/* The expressions of migration 002's records_label_state, word for word, so the
   read stays on that index: generated columns would read every record row. */
const F = (k) => `json_extract(fields, '$.${k}')`;
const STATUS = F('status');
const CLOSED = `coalesce(${F('closed')}, ${F('answered')})`;
/* closedDay in SQL: the ending stamp, else the last movement, as a day */
const DAY_OF = (col) => `CASE WHEN ${col} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*' THEN substr(${col}, 1, 10) END`;
const CLOSED_DAY = `coalesce(${DAY_OF(`nullif(${CLOSED}, '')`)}, ${DAY_OF(F('updated'))}, ${DAY_OF(F('created'))})`;
const HELD_SQL = `SELECT ${F('id')} AS label FROM records INDEXED BY records_label_state WHERE kind = ?1
  AND (${STATUS} IS NULL OR ${STATUS} NOT IN (SELECT value FROM json_each(?2)) OR ${CLOSED_DAY} IS NULL
    OR date(${CLOSED_DAY}, '+44 days') > ?3)`;
const RESTING_SQL = `SELECT label FROM labels INDEXED BY labels_pick WHERE kind = ? AND origin = 'history'
  AND "to" IS NOT NULL AND date("to", '+30 days') > ?`;
const TOP_SQL = `SELECT max(CAST(substr(label, ?1) AS INTEGER)) AS top FROM labels INDEXED BY labels_pick
  WHERE kind = ?2 AND origin = 'history' AND label GLOB ?3 AND substr(label, ?1) NOT GLOB '*[^0-9]*'`;

/* THE PICK, inside the caller's transaction: the lowest label no live
   record holds and no freed one rests on; a held label is free from its closed
   day plus 44 (14 to archive, 30 at rest), a given-up one from its end plus 30.
   When none is free, one above both the top held and the meta floor. */
export function pickLabel(db, kind, day) {
  const k = LABEL_KINDS[kind];
  if (!k) throw new UsageError('no label shape for a ' + kind);
  const head = k.prefix + k.sep;
  const top = Number(db.stmt(TOP_SQL).get(head.length + 1, kind, head + '[1-9]*').top) || 0;
  const blocked = new Set();
  for (const r of db.stmt(HELD_SQL).all(kind, JSON.stringify(k.ended), day)) blocked.add(labelNumber(r.label, k.prefix, k.sep));
  for (const r of db.stmt(RESTING_SQL).all(kind, day)) blocked.add(labelNumber(r.label, k.prefix, k.sep));
  for (let n = 1; n <= top; n++) if (!blocked.has(n)) return head + n;
  const meta = 'label.top.' + k.prefix;
  const next = Math.max(top, Number(getMeta(db, meta)) || 0) + 1;
  setMeta(db, meta, String(next));
  return head + next;
}
