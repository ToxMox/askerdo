/* Tracks: a named line of work
   in a workstream, its tasks in track_items, leases (one session per track, one
   track per session), junctions, promote and fold back. A track's state is
   derived when read, never stored: only park, finish, drop and fold are written. */
import { tx } from '../db.mjs';
import { KEY_ORDERS, actorOf, addNote, clockOf, getMeta, kebab, labelOf, logVerb, mintKey, pcOfCall, putHandoff, putRecord, sessionWords } from '../records.mjs';
import { pickLabel, refsFor, strList } from './labels.mjs';
import { sharesProject, wakeLinked } from './questions.mjs';
import { createRecord, editRecord } from './work.mjs';
import { RUN_BY_HINT, runByOf, stepAt } from '../handoff-text.mjs';
import { holderWords } from '../web/feed.mjs';
import { foundSummary, isReview, placeRefusal, suggestTrack } from './found.mjs';
import { afterTask, finishGate, reviewHead, trackReview } from './coverage.mjs';
import { countsText } from '../web/draw.mjs';
import { BY as UPKEEP, afterLeaseDrop, unparkWhenOf, unparkWords, whenText } from './upkeep.mjs';
import {
  ENDED_TASK, TASK_KEYS, TrackRefusal, addEdge, bumpVersion, checkVersion, headOf, itemsOf, keyOf,
  loadRecord, logLine, needText, pathBetween, readTx, recordOf, sideOf, trackGraph, writeFront,
  writeItems,
} from './graph.mjs';

/* A new kind: its own key order, written by these verbs alone. */
export const TRACK_KEYS = KEY_ORDERS.track;
export const TRACK_STATUS = Object.freeze(['open', 'parked', 'done', 'dropped', 'folded']);
const CLOSED = ['done', 'dropped', 'folded'];
const LIVE_HANDOFF = ['waiting', 'parked'];
/* server/tracks-import.mjs IMPORT_REASON: the old order the import made into edges */
const IMPORTED = 'from import';
export const MOVES = Object.freeze(['splinter', 'take over', 'read only']);

/* Settings in meta, read when drawn: no timers. */
const setting = (db, name, dflt) => {
  const n = Number(getMeta(db, name));
  return Number.isFinite(n) && n > 0 ? n : dflt;
};
export const stallDays = (db) => setting(db, 'tracks.stallDays', 3);
export const foldMax = (db) => setting(db, 'tracks.foldMax', 10);
export const quietHours = (db) => setting(db, 'tracks.quietHours', 12);

const trackRec = (db, ref) => recordOf(db, ref, 'track');
const ctx = (actor) => actorOf(actor);
const sessionOf = (input, actor) => (input && typeof input.session === 'string' && input.session.trim()) || actorOf(actor).session || '';
const pcOf = (input, actor) => pcOfCall(input, actorOf(actor));

export function makeTrack(db, { name, workstream, goal, origin, note, labels = [], refs = [] }, c) {
  const id = pickLabel(db, 'track', c.day);
  const key = mintKey(db);
  const fields = { id, key, name, workstream, status: 'open' };
  if (goal) fields.goal = goal;
  if (origin) fields.origin = origin;
  Object.assign(fields, { created: c.at, updated: c.at, labels, refs, labelHistory: [id + ' ' + c.at.slice(0, 10)] });
  putRecord(db, { key, kind: 'track', slug: kebab(name, 'track'), fields, body: '\n## Description\n\n' + (goal || name) + '\n\n' });
  const changes = { workstream: [null, workstream], status: [null, 'open'] };
  if (goal) changes.goal = [null, goal];
  if (origin) changes.origin = [null, origin];
  logLine(db, { at: c.at, verb: 'create', kind: 'track', rec: { id, key, name }, changes, by: c.by, pc: c.pc, note });
  return loadRecord(db, key);
}

const junctionRow = (db, side, to, at) => db.stmt('INSERT OR IGNORE INTO links ("from", "to", type, added) VALUES (?, ?, \'junction\', ?)').run(side, to, at);

/* ---- derived state -------------------------------------------------------- */

const leaseOf = (db, trackKey) => db.stmt('SELECT track, session, pc, since, seen FROM leases WHERE track = ?').get(trackKey);
const leaseOfSession = (db, session) => (session ? db.stmt('SELECT track, session, pc, since, seen FROM leases WHERE session = ?').get(session) : null);

const everHeld = (db, key) => Boolean(db.stmt(`SELECT 1 FROM activity WHERE record = ?
  AND json_extract(line, '$.changes.session') IS NOT NULL LIMIT 1`).get(key));

/* Active: a lease. Waiting: no lease and a live handoff, or held before. New:
   never held. Parked, done, dropped and folded are the written ones. */
export function stateOf(db, rec) {
  const st = rec.fields.status;
  if (st !== 'open') return st;
  if (leaseOf(db, rec.key)) return 'active';
  const h = lastHandoff(db, rec.key);
  if (h && LIVE_HANDOFF.includes(h.status)) return 'waiting';
  return h || everHeld(db, rec.key) ? 'waiting' : 'new';
}

/* A track's handoffs in chain order (the m of TR-n.m), never by date: the import
   keeps each handoff's created as it was, out of order or not. */
export const CHAIN_NO = "CAST(substr(label, instr(label, '.') + 1) AS INTEGER)";
export const NEWEST_FIRST = CHAIN_NO + ' DESC, id DESC';
const lastHandoff = (db, key) => db.stmt('SELECT status FROM handoffs WHERE track = ? ORDER BY ' + NEWEST_FIRST + ' LIMIT 1').get(key);

/* Waiting with no live handoff (held, then let go): views and kickoff say "no handoff yet". */
export function noHandoff(db, key, state) {
  if (state !== 'waiting') return false;
  const h = lastHandoff(db, key);
  return !(h && LIVE_HANDOFF.includes(h.status));
}

/* A display rule: open items and no movement for the stall setting's days. */
export function isStalled(db, rec, state, nowMs) {
  if (!['active', 'waiting', 'parked'].includes(state)) return false;
  const moved = trackMoved(db, rec);
  return moved !== null && nowMs - moved > stallDays(db) * 86400000;
}

/* A line's last movement in ms, or null with no open items; a band Keep and the
   board's own upkeep are no movement. */
export function trackMoved(db, rec) {
  const open = db.stmt(`SELECT count(*) AS n FROM track_items ti JOIN records r ON r.key = ti.task
    WHERE ti.track = ? AND coalesce(r.status, '') NOT IN ('completed', 'dropped')`).get(rec.key).n;
  if (!open) return null;
  const last = db.stmt(`SELECT at FROM activity WHERE record IN (SELECT ? UNION ALL SELECT task FROM track_items WHERE track = ?)
    AND json_extract(line, '$.changes.kept') IS NULL AND actor IS NOT ? ORDER BY seq DESC LIMIT 1`).get(rec.key, rec.key, UPKEEP);
  const lease = leaseOf(db, rec.key);
  return Math.max(last ? Date.parse(last.at) || 0 : 0, lease ? Date.parse(lease.seen) || 0 : 0, Date.parse(rec.fields.updated) || 0);
}

/* A display rule on the lease's last seen: past the quiet setting the track is
   still held, but reads "held, quiet since" and the shelf offers take over. */
export function quietSince(db, trackKey, nowMs) {
  const lease = leaseOf(db, trackKey);
  const seen = lease ? Date.parse(lease.seen || lease.since) : NaN;
  return Number.isFinite(seen) && nowMs - seen > quietHours(db) * 3600000 ? lease.seen || lease.since : null;
}

/* The inbox turns amber as a track stalls: open tasks and no activity for the stall setting's days. */
const INBOX = `r.kind = 'task' AND r.workstream = ? AND coalesce(r.status, '') NOT IN ('completed', 'dropped')
  AND NOT EXISTS (SELECT 1 FROM track_items ti WHERE ti.task = r.key)`;
export function inboxStalled(db, wsKey, nowMs) {
  const moved = inboxMoved(db, wsKey);
  return moved !== null && nowMs - moved > stallDays(db) * 86400000;
}

/* The inbox's last movement in ms, or null when it holds no open task; upkeep is no movement. */
export function inboxMoved(db, wsKey) {
  const open = db.stmt(`SELECT r.key, json_extract(r.fields, '$.updated') AS updated FROM records r WHERE ${INBOX}`).all(wsKey);
  if (!open.length) return null;
  const last = db.stmt(`SELECT at FROM activity WHERE record IN (SELECT r.key FROM records r WHERE ${INBOX}) AND actor IS NOT ?
    ORDER BY seq DESC LIMIT 1`).get(wsKey, UPKEEP);
  return Math.max(last ? Date.parse(last.at) || 0 : 0, ...open.map((t) => Date.parse(t.updated) || 0));
}

/* The parent track and the task a side track left from (or was promoted from). */
export function junctionOf(db, key) {
  let track = null;
  let task = null;
  for (const r of db.stmt(`SELECT r.key, r.kind, r.label, r.title, r.status FROM links l JOIN records r ON r.key = l."to"
      WHERE l."from" = ? AND l.type = 'junction'`).all(key)) {
    if (r.kind === 'track') track = { id: r.label, key: r.key, state: stateOf(db, loadRecord(db, r.key)) };
    /* the name draws a finished junction, which no view's open tasks carry */
    if (r.kind === 'task') task = { id: r.label, key: r.key, name: r.title || '' };
  }
  return track || task ? { track, task } : null;
}

/* a closed parent takes no resume, so the way back names the workstream's open tracks
   instead, or its inbox count when none is open. */
function junctionBack(db, rec) {
  const j = junctionOf(db, rec.key);
  if (!j || !j.track || !CLOSED.includes(j.track.state)) return j;
  const ws = rec.fields.workstream;
  const open = [];
  for (const r of db.stmt("SELECT key FROM records WHERE kind = 'track' AND workstream = ? AND key IS NOT ? ORDER BY id").all(ws || null, rec.key)) {
    const t = loadRecord(db, r.key);
    if (!CLOSED.includes(t.fields.status)) open.push({ id: t.fields.id, name: t.fields.name || '', state: stateOf(db, t) });
  }
  const inbox = ws ? db.stmt(`SELECT count(*) AS n FROM records r WHERE ${INBOX}`).get(ws).n : 0;
  return { ...j, closed: true, workstream: ws ? labelOf(db, ws) : null, open, inbox };
}

const parentOf = (db, key) => db.stmt(`SELECT r.key, r.label, r.status FROM links l JOIN records r ON r.key = l."to" AND r.kind = 'track'
  WHERE l."from" = ? AND l.type = 'junction'`).get(key);

/* "TR-7 under TR-5 under TR-2, 2 parked behind this". */
export function chainOf(db, key) {
  const ids = [labelOf(db, key)];
  const seen = new Set([key]);
  let parked = 0;
  for (let p = parentOf(db, key); p && !seen.has(p.key); p = parentOf(db, p.key)) {
    seen.add(p.key);
    ids.push(p.label);
    if (p.status === 'parked') parked += 1;
  }
  return { tracks: ids, parked, text: ids.join(' under ') + (parked ? ', ' + parked + ' parked behind this' : '') };
}

function sideTracksOf(db, key) {
  return db.stmt(`SELECT r.key, r.label, r.status FROM links l JOIN records r ON r.key = l."from" AND r.kind = 'track'
    WHERE l."to" = ? AND l.type = 'junction'`).all(key);
}

/* ---- leases --------------------------------------------------------------- */

function needSession(input, actor, what) {
  const s = sessionOf(input, actor);
  if (!s) throw new TrackRefusal(what + ' needs the session');
  return s;
}

function dropLease(db, lease, c, note) {
  db.stmt('DELETE FROM leases WHERE track = ?').run(lease.track);
  const rec = loadRecord(db, lease.track);
  logLine(db, { at: c.at, verb: 'edit', kind: 'track', rec: headOf(rec), changes: { session: [lease.session, null] }, by: c.by, pc: c.pc, note });
  afterLeaseDrop(db, lease.track, lease.session, c, note);
  return rec.fields.id;
}

export function setStatus(db, rec, status, extra, c, verb, note) {
  const changes = { status, updated: c.at, ...extra };
  const when = rec.fields.unparkWhen;
  if (status === 'open') Object.assign(changes, { parkReason: undefined, unparkWhen: undefined });
  if (CLOSED.includes(status)) changes.closed = c.at;
  const diff = writeFront(db, rec, changes, TRACK_KEYS);
  if (diff.unparkWhen) diff.unparkWhen = [whenText(db, when), whenText(db, rec.fields.unparkWhen)];
  logLine(db, { at: c.at, verb, kind: 'track', rec: headOf(rec), changes: diff, by: c.by, pc: c.pc, note });
  if (status === 'parked') parkHandoff(db, rec.key, extra.parkReason, c);
}

/* A live waiting handoff parks with its track, so the kickoff and the shelf agree;
   parkReason sits before the stamps, as handoffs.mjs orders a handoff's keys. */
function parkHandoff(db, trackKey, reason, c) {
  const h = db.stmt(`SELECT key, slug, fields, state, where_we_were, verify FROM handoffs WHERE track = ?
    AND status IN ('waiting', 'parked') ORDER BY ${NEWEST_FIRST} LIMIT 1`).get(trackKey);
  if (!h || !reason) return;
  const { created, updated, ...rest } = JSON.parse(h.fields);
  if (rest.status !== 'waiting') return;
  const fields = { ...rest, status: 'parked', parkReason: reason, created, updated: c.at };
  putHandoff(db, { key: h.key, slug: h.slug, fields, state: h.state, whereWeWere: h.where_we_were, verify: JSON.parse(h.verify) });
  logVerb(db, { ts: c.at, verb: 'edit', kind: 'handoff', id: fields.id, key: h.key, name: fields.focus,
    changes: { status: ['waiting', 'parked'], parkReason: [null, reason] }, by: c.by, pc: c.pc, note: reason });
}

/* The session's lease lands on `rec`; whatever else it held lets go. Caller
   has checked that no other session holds `rec`. */
function holdLease(db, rec, session, pc, c) {
  const mine = leaseOfSession(db, session);
  if (mine && mine.track === rec.key) {
    db.stmt('UPDATE leases SET seen = ? WHERE track = ?').run(c.at, rec.key);
    return { released: null, unparked: false };
  }
  const released = mine ? dropLease(db, mine, c, 'moved to ' + rec.fields.id) : null;
  const unparked = rec.fields.status === 'parked';
  if (unparked) setStatus(db, rec, 'open', {}, c, 'edit', 'back on track');
  db.stmt('INSERT INTO leases (track, session, pc, since, seen) VALUES (?, ?, ?, ?, ?)').run(rec.key, session, pc, c.at, c.at);
  logLine(db, { at: c.at, verb: 'edit', kind: 'track', rec: headOf(rec), changes: { session: [null, session] }, by: c.by, pc: c.pc });
  return { released, unparked };
}

const holderOf = (l) => ({ session: l.session, pc: l.pc || null, since: l.since, seen: l.seen });
/* a lease's holder as the user reads it, quiet or not; `pc` the asking PC */
export const holderPlain = (db, trackKey, l, { now, pc } = {}) => holderWords({ ...l, quietSince: quietSince(db, trackKey, now) }, { now, pc });

/* A held track is not refused with an error: the second session gets the
   holder and its three moves as data. */
export function acquireLease(db, input, actor) {
  const session = needSession(input, actor, 'a lease');
  return tx(db, () => {
    const c = ctx(actor);
    const rec = trackRec(db, input.track);
    if (CLOSED.includes(rec.fields.status)) throw new TrackRefusal(rec.fields.id + ' is ' + rec.fields.status + '; a closed track takes no session');
    const held = leaseOf(db, rec.key);
    if (held && held.session !== session) {
      return { acquired: false, track: rec.fields.id, key: rec.key, holder: holderOf(held), moves: MOVES.slice() };
    }
    const r = holdLease(db, rec, session, pcOf(input, actor), c);
    return { acquired: true, track: rec.fields.id, key: rec.key, session, ...r, chain: chainOf(db, rec.key).text };
  });
}

/* Last seen, no activity row; a session that lost its lease learns it here. */
export function renewLease(db, input, actor) {
  const session = needSession(input, actor, 'renewing a lease');
  return tx(db, () => {
    const at = actorOf(actor).at;
    const r = db.stmt('UPDATE leases SET seen = ? WHERE session = ?').run(at, session);
    const l = r.changes ? leaseOfSession(db, session) : null;
    return { held: Boolean(l), track: l ? labelOf(db, l.track) : null };
  });
}

export function releaseLease(db, input, actor) {
  const session = needSession(input, actor, 'releasing a lease');
  return tx(db, () => {
    const l = leaseOfSession(db, session);
    if (!l || (input.track && keyOf(db, input.track, 'track') !== l.track)) return { released: null };
    return { released: dropLease(db, l, ctx(actor), input.reason) };
  });
}

/* The old holder hears it through the row's session change. */
export function takeOver(db, input, actor) {
  const session = needSession(input, actor, 'taking over');
  return tx(db, () => {
    const c = ctx(actor);
    const rec = trackRec(db, input.track);
    if (CLOSED.includes(rec.fields.status)) throw new TrackRefusal(rec.fields.id + ' is ' + rec.fields.status);
    const held = leaseOf(db, rec.key);
    if (!held || held.session === session) {
      const r = holdLease(db, rec, session, pcOf(input, actor), c);
      return { track: rec.fields.id, key: rec.key, from: null, ...r };
    }
    const mine = leaseOfSession(db, session);
    const released = mine ? dropLease(db, mine, c, 'moved to ' + rec.fields.id) : null;
    const was = sessionWords(db, held.session);
    db.stmt('UPDATE leases SET session = ?, pc = ?, since = ?, seen = ? WHERE track = ?').run(session, pcOf(input, actor), c.at, c.at, rec.key);
    logLine(db, { at: c.at, verb: 'edit', kind: 'track', rec: headOf(rec), changes: { session: [held.session, session] }, by: c.by, pc: c.pc,
      note: 'taken over from ' + was + (input.reason ? ': ' + input.reason : '') });
    return { track: rec.fields.id, key: rec.key, from: holderOf(held), released, unparked: false };
  });
}

/* ---- track verbs ---------------------------------------------------------- */

function workstreamOf(db, ref) {
  if (!ref) throw new TrackRefusal('a track needs its workstream');
  return keyOf(db, ref, 'workstream');
}

const endOf = (db, trackKey) => (db.stmt('SELECT max(position) AS p FROM track_items WHERE track = ?').get(trackKey).p ?? 0) + 1;

export function putOnTrack(db, task, trackRec_, c, note) {
  const was = db.stmt('SELECT track FROM track_items WHERE task = ?').get(task.key);
  if (was && was.track === trackRec_.key) return false;
  if (trackRec_.fields.origin === 'promote' && !CLOSED.includes(trackRec_.fields.status)) {
    const pointer = junctionOf(db, trackRec_.key);
    const loop = pointer && pointer.task ? pathBetween(db, task.key, pointer.task.key) : null;
    if (loop) throw new TrackRefusal(task.fields.id + ' waits on ' + pointer.task.id + ', whose done waits on ' + trackRec_.fields.id + '; it cannot go there');
  }
  db.stmt('DELETE FROM track_items WHERE task = ?').run(task.key);
  db.stmt('INSERT INTO track_items (track, task, position) VALUES (?, ?, ?)').run(trackRec_.key, task.key, endOf(db, trackRec_.key));
  bumpVersion(db, trackRec_.key);
  if (was) bumpVersion(db, was.track);
  const changes = { track: [was ? was.track : null, trackRec_.key] };
  /* a task takes the workstream of the track it lands on, and a placed task is unplaced no more */
  const ws = trackRec_.fields.workstream;
  const front = { ...(ws && task.fields.workstream !== ws ? { workstream: ws } : {}), ...(task.fields.unplaced !== undefined ? { unplaced: undefined } : {}) };
  if (Object.keys(front).length) Object.assign(changes, writeFront(db, task, { ...front, updated: c.at }, TASK_KEYS));
  logLine(db, { at: c.at, verb: 'edit', kind: 'task', rec: headOf(task), changes, by: c.by, pc: c.pc, note });
  dropImported(db, task, trackRec_, c);
  return true;
}

/* a moved task leaves the import's old order both ways, rejoining nothing,
   so no chain runs across lines; each waiting task's line says which edge went. */
function dropImported(db, task, trackRec_, c) {
  const rows = db.stmt('SELECT task, "on" FROM depends WHERE (task = ? OR "on" = ?) AND reason = ?').all(task.key, task.key, IMPORTED);
  for (const e of rows) {
    db.stmt('DELETE FROM depends WHERE task = ? AND "on" = ?').run(e.task, e.on);
    const waiting = e.task === task.key ? task : loadRecord(db, e.task);
    bumpVersion(db, waiting.key);
    logLine(db, { at: c.at, verb: 'edit', kind: 'task', rec: headOf(waiting), changes: { dependsOn: [e.on, null] }, by: c.by, pc: c.pc,
      note: "the import's order: " + task.fields.id + ' moved to ' + trackRec_.fields.name + ' (' + trackRec_.fields.id + ')' });
  }
  return rows.length;
}

/* task create's track, placed inside its transaction */
export const placeCreated = (db, key, line, c) => putOnTrack(db, loadRecord(db, key), line, c);

const idList = (v, what) => {
  const list = (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]).map((s) => String(s ?? '').trim()).filter(Boolean);
  for (const s of list) if (!TASK_ID.test(s)) throw new TrackRefusal(what + ' names T-n ids: ' + s);
  return list;
};

/* a task's place as its filer judged it: a track, with the steps it comes before or
   after laid as track layout lays them, or unplaced with the reason the found list shows. */
export function placeTask(db, taskKey, place, actor) {
  const c = ctx(actor);
  const before = idList(place.before, 'before');
  const after = idList(place.after, 'after');
  const hasWhy = place.unplaced !== undefined && place.unplaced !== null;
  if (place.track && hasWhy) throw new TrackRefusal('a task goes on a track or stays unplaced, not both');
  let task = loadRecord(db, taskKey);
  const row = () => db.stmt('SELECT track FROM track_items WHERE task = ?').get(taskKey);
  if (hasWhy) {
    if (before.length || after.length) throw new TrackRefusal('before and after place a task on a track; an unplaced one has no steps around it');
    const why = needText(place.unplaced, 'unplaced', 'reason');
    const was = row();
    if (was) {
      db.stmt('DELETE FROM track_items WHERE task = ?').run(taskKey);
      bumpVersion(db, was.track);
    }
    const diff = writeFront(db, task, { unplaced: why, updated: c.at }, TASK_KEYS);
    logLine(db, { at: c.at, verb: 'edit', kind: 'task', rec: headOf(task), changes: { ...diff, ...(was ? { track: [was.track, null] } : {}) }, by: c.by, pc: c.pc, note: 'unplaced: ' + why });
    return { unplaced: why };
  }
  if (place.track) putOnTrack(db, task, openTrack(db, place.track), c);
  const on = row();
  if ((before.length || after.length) && !on) throw new TrackRefusal(task.fields.id + ' is on no track: name the track it goes on with before and after');
  task = loadRecord(db, taskKey);
  const reason = on ? 'placed on ' + labelOf(db, on.track) : '';
  for (const b of before) addEdge(db, { task: b, on: task.fields.id, reason }, actor);
  for (const a of after) addEdge(db, { task: task.fields.id, on: a, reason }, actor);
  return { ...(on ? { track: labelOf(db, on.track) } : {}), ...(before.length ? { before } : {}), ...(after.length ? { after } : {}) };
}

export function openTrack(db, ref) {
  const rec = trackRec(db, ref);
  if (CLOSED.includes(rec.fields.status)) throw new TrackRefusal(rec.fields.id + ' is ' + rec.fields.status);
  return rec;
}

/* A new line of work; with a session, the session takes it. Labels and refs
   come at birth only (an import's label and row ref), as a task's do. */
export function newTrack(db, input, actor) {
  const name = needText(input && input.name, 'a track');
  const labels = strList(input.labels, 'labels');
  const refs = strList(input.refs, 'refs');
  return tx(db, () => {
    const c = ctx(actor);
    const rec = makeTrack(db, {
      name, workstream: workstreamOf(db, input.workstream), goal: input.goal ? needText(input.goal, 'a goal') : undefined, labels, refs: refsFor(db, refs, c.day),
    }, c);
    for (const t of input.tasks || []) putOnTrack(db, recordOf(db, t, 'task'), rec, c);
    const session = sessionOf(input, actor);
    if (session) holdLease(db, rec, session, pcOf(input, actor), c);
    return { id: rec.fields.id, key: rec.key, kind: 'track', name, state: stateOf(db, rec) };
  });
}

/* The parent parks with the junction unless another session holds it; the
   splintering session's lease moves to the side track. */
function leaveFor(db, parent, side, atTask, session, pc, c) {
  const held = leaseOf(db, parent.key);
  let parked = false;
  if (!held || held.session === session) {
    const reason = 'splintered to ' + side.fields.id + (atTask ? ' at ' + atTask.fields.id : '');
    if (held) dropLease(db, held, c, reason);
    if (parent.fields.status !== 'parked') {
      setStatus(db, parent, 'parked', { parkReason: reason }, c, 'edit', reason);
      parked = true;
    }
  }
  if (session) holdLease(db, side, session, pc, c);
  return parked;
}

/* With park: false it is a branch: the parent keeps its status
   and lease, the junction is the one named or none, and the side's first tasks
   wait on that junction. */
export function splinter(db, input, actor) {
  const name = needText(input && input.name, 'a side track');
  const branch = input.park === false;
  return tx(db, () => {
    const c = ctx(actor);
    const parent = openTrack(db, input.from ?? input.track);
    let atTask = input.at ? recordOf(db, input.at, 'task') : null;
    if (atTask && !db.stmt('SELECT 1 FROM track_items WHERE track = ? AND task = ?').get(parent.key, atTask.key)) {
      throw new TrackRefusal(atTask.fields.id + ' is not on ' + parent.fields.id);
    }
    if (!atTask && !branch) {
      const running = trackGraph(db, parent.key).now;
      if (running.length === 1) atTask = loadRecord(db, running[0].key);
    }
    const side = makeTrack(db, {
      name, workstream: input.workstream ? workstreamOf(db, input.workstream) : parent.fields.workstream,
      goal: input.goal ? needText(input.goal, 'a goal') : undefined, origin: 'splinter',
      note: typeof input.note === 'string' && input.note.trim() ? input.note.trim() : undefined,
    }, c);
    junctionRow(db, side.key, parent.key, c.at);
    if (atTask) junctionRow(db, side.key, atTask.key, c.at);
    for (const ref of input.tasks || []) {
      const t = recordOf(db, ref, 'task');
      if (!db.stmt('SELECT 1 FROM track_items WHERE track = ? AND task = ?').get(parent.key, t.key)) throw new TrackRefusal(t.fields.id + ' is not on ' + parent.fields.id);
      putOnTrack(db, t, side, c);
    }
    if (branch) {
      const tied = tieToJunction(db, side.key, c);
      return {
        id: side.fields.id, key: side.key, kind: 'track', name, parent: parent.fields.id, at: atTask ? atTask.fields.id : null,
        parked: false, session: null, tied, chain: chainOf(db, side.key).text,
      };
    }
    const session = sessionOf(input, actor);
    const parked = leaveFor(db, loadRecord(db, parent.key), side, atTask, session, pcOf(input, actor), c);
    return {
      id: side.fields.id, key: side.key, kind: 'track', name, parent: parent.fields.id, at: atTask ? atTask.fields.id : null,
      parked, session: session || null, chain: chainOf(db, side.key).text,
    };
  });
}

/* A side line's first open tasks (none waits on another open task of the line)
   wait on its junction task while that is open, so ready reads false till then. */
export const TIE = 'waits on the junction ';
export function junctionWants(db, sideKey) {
  const j = junctionOf(db, sideKey);
  const at = j && j.task ? loadRecord(db, j.task.key) : null;
  if (!at || ENDED_TASK.includes(at.fields.status)) return { at, want: null };
  const open = db.stmt(`SELECT ti.task FROM track_items ti JOIN records r ON r.key = ti.task WHERE ti.track = ?
    AND coalesce(r.status, '') NOT IN ('completed', 'dropped') ORDER BY ti.position`).all(sideKey).map((r) => r.task);
  const onLine = new Set(open);
  const want = open.filter((k) => k !== at.key && !db.stmt('SELECT "on" FROM depends WHERE task = ?').all(k).some((r) => onLine.has(r.on)));
  return { at, want };
}

export function tieToJunction(db, sideKey, c, note) {
  const { at, want } = junctionWants(db, sideKey);
  if (!want) return [];
  const reason = TIE + at.fields.id + ', where its line branches';
  const tied = [];
  for (const k of want) {
    if (db.stmt('SELECT 1 FROM depends WHERE task = ? AND "on" = ?').get(k, at.key)) continue;
    const t = loadRecord(db, k);
    const loop = pathBetween(db, at.key, k);
    if (loop) {
      const ids = loop.map((x) => labelOf(db, x));
      throw new TrackRefusal(at.fields.id + ' already waits on ' + t.fields.id + ' (' + ids.join(' after ') + '), so ' + t.fields.id + ' cannot wait on its junction', { loop: ids });
    }
    db.stmt('INSERT INTO depends (task, "on", reason, added, actor) VALUES (?, ?, ?, ?, ?)').run(k, at.key, reason, c.at, c.by);
    bumpVersion(db, k);
    logLine(db, { at: c.at, verb: 'edit', kind: 'task', rec: headOf(t), changes: { dependsOn: [null, at.key] }, by: c.by, pc: c.pc, note: note || reason });
    tied.push(t.fields.id);
  }
  return tied;
}

/* capture's body, inside the caller's transaction: `track` is an open track's
   record or null for the inbox. */
function captureOn(db, track, input, actor, c) {
  let ws = track ? track.fields.workstream : input.workstream ? workstreamOf(db, input.workstream) : null;
  let task;
  let created = false;
  if (input.task) {
    task = recordOf(db, input.task, 'task');
    if (ENDED_TASK.includes(task.fields.status)) throw new TrackRefusal(task.fields.id + ' is ' + task.fields.status);
    ws = ws || task.fields.workstream || null;
  } else {
    if (!ws) throw new TrackRefusal('a capture needs a track or a workstream');
    const r = createRecord(db, {
      // A capture is a quick idea, so it needs no description of its own.
      name: input.name, description: input.description || 'Captured on ' + (track ? track.fields.id : ws) + '.', intent: input.intent, workstream: ws,
      priority: input.priority, labels: input.labels, refs: input.refs, serves: input.serves,
    }, actor);
    task = loadRecord(db, r.key);
    created = true;
  }
  if (track) putOnTrack(db, task, track, c);
  else {
    if (task.fields.workstream && task.fields.workstream !== ws) throw new TrackRefusal(task.fields.id + ' is in another workstream');
    const was = db.stmt('SELECT track FROM track_items WHERE task = ?').get(task.key);
    if (was) {
      db.stmt('DELETE FROM track_items WHERE task = ?').run(task.key);
      bumpVersion(db, was.track);
      logLine(db, { at: c.at, verb: 'edit', kind: 'task', rec: headOf(task), changes: { track: [was.track, null] }, by: c.by, pc: c.pc, note: 'to the inbox' });
    }
  }
  return { id: task.fields.id, key: task.key, name: task.fields.name, track: track ? track.fields.id : null, created };
}

/* A new idea onto a track, or into the workstream's inbox; an existing task moves. A session's capture into the inbox says why it waits on no track. */
export function capture(db, input, actor) {
  return tx(db, () => {
    const c = ctx(actor);
    const track = input.track ? openTrack(db, input.track) : null;
    const why = typeof input.unplaced === 'string' && input.unplaced.trim() ? input.unplaced : null;
    if (track && why) throw new TrackRefusal('a capture goes on a track or stays unplaced, not both');
    if (!track && !why && c.session) {
      const ws = input.workstream ? workstreamOf(db, input.workstream) : null;
      throw new TrackRefusal(placeRefusal(input.task ? null : suggestTrack(db, { ...input, workstream: ws }, c.session)));
    }
    const r = captureOn(db, track, input, actor, c);
    if (why) placeTask(db, r.key, { unplaced: why }, actor);
    return why ? { ...r, unplaced: why.replace(/\s+/g, ' ').trim() } : r;
  });
}

/* a line of work's steps, in its words; the PC's check (lib/handoff-payload.mjs
   stepProblems) runs first, so these refusals only meet a caller that skipped it. */
const STEP_KEYS = ['name', 'task', 'after', 'before', 'description', 'priority', 'runBy', 'reviewScope'];
const TASK_ID = /^T-\d+$/;
const sameName = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();

function checkSteps(steps) {
  if (!Array.isArray(steps) || !steps.length) throw new TrackRefusal('a layout needs its steps: a list of { name, task, after }');
  steps.forEach((s, i) => {
    const at = 'step ' + (i + 1);
    if (!s || typeof s !== 'object' || Array.isArray(s)) throw new TrackRefusal(at + ' is an object: { name, task, after }');
    for (const k of Object.keys(s)) if (!STEP_KEYS.includes(k)) throw new TrackRefusal(at + ' does not take ' + k + ' (it takes ' + STEP_KEYS.join(', ') + ')');
    if (s.task !== undefined && !(typeof s.task === 'string' && TASK_ID.test(s.task.trim()))) throw new TrackRefusal(at + '.task is a T-n id');
    if (s.task === undefined && (typeof s.name !== 'string' || !s.name.trim() || /[\r\n]/.test(s.name))) throw new TrackRefusal(at + ' needs a name of one line, or a task');
    if (s.after !== undefined && !Array.isArray(s.after)) throw new TrackRefusal(at + '.after is a list of T-n ids and earlier step numbers');
    if (s.runBy !== undefined && !runByOf(s.runBy)) throw new TrackRefusal(at + '.runBy names who runs it: ' + RUN_BY_HINT);
    if (s.reviewScope !== undefined && !['track', 'project'].includes(String(s.reviewScope).trim().toLowerCase())) {
      throw new TrackRefusal(at + '.reviewScope is track or project');
    }
    for (const a of s.after || []) {
      const ok = (typeof a === 'string' && TASK_ID.test(a.trim())) || (Number.isInteger(a) && a >= 1 && a <= i);
      if (!ok) throw new TrackRefusal(at + '.after names ' + JSON.stringify(a) + ': a T-n id, or the number of an earlier step (1 to ' + i + ')');
    }
    if (s.before !== undefined && !(Array.isArray(s.before) && s.before.every((b) => typeof b === 'string' && TASK_ID.test(b.trim())))) {
      throw new TrackRefusal(at + '.before is a list of T-n ids, the tasks that wait on this step (a later step waits on it through its own after)');
    }
  });
  return steps;
}

/* An open task on the track whose name reads the same, case and spacing aside. */
function openNamed(db, trackKey, name) {
  const want = sameName(name);
  const row = db.stmt(`SELECT r.key, json_extract(r.fields, '$.name') AS name FROM track_items ti JOIN records r ON r.key = ti.task
    WHERE ti.track = ? AND coalesce(r.status, '') NOT IN ('completed', 'dropped') ORDER BY ti.position`).all(trackKey)
    .find((r) => sameName(r.name) === want);
  return row ? row.key : null;
}

/* a line of work's steps onto its track in one go, each a task (an open
   one of the same name is that task) and each `after` a "depends on" edge, so
   the next task comes from the ready set; each `before` an edge the other
   way. A loop refuses the whole layout. */
export function layOut(db, input, actor) {
  const steps = checkSteps(input && input.steps);
  return tx(db, () => {
    const c = ctx(actor);
    const track = openTrack(db, input.track);
    const out = [];
    steps.forEach((s, i) => stepped(i, s, () => {
      const named = s.task === undefined ? openNamed(db, track.key, s.name) : null;
      const r = captureOn(db, track, named ? { task: named } : s.task !== undefined ? { task: s.task.trim() }
        : { name: s.name.trim(), description: s.description, priority: s.priority }, actor, c);
      /* the step's runBy lands on its task, a matched one too, logged with the old value */
      const runBy = runByOf(s.runBy);
      if (runBy) editRecord(db, { id: r.key, kind: 'task', runBy }, actor);
      /* a review step's scope lands the same way */
      if (s.reviewScope !== undefined) editRecord(db, { id: r.key, kind: 'task', reviewScope: s.reviewScope }, actor);
      out.push({ id: r.id, key: r.key, name: r.name, created: r.created, ...(runBy ? { runBy } : {}), ...(s.reviewScope !== undefined ? { reviewScope: s.reviewScope } : {}), edges: [] });
    }));
    steps.forEach((s, i) => stepped(i, s, () => {
      for (const a of s.after || []) {
        const on = typeof a === 'string' ? a.trim() : out[a - 1].id;
        const e = addEdge(db, { task: out[i].id, on, reason: 'laid out on ' + track.fields.id }, actor);
        out[i].edges.push({ on: e.on, added: e.added });
      }
      for (const b of s.before || []) {
        const e = addEdge(db, { task: b.trim(), on: out[i].id, reason: 'laid out on ' + track.fields.id }, actor);
        (out[i].before ||= []).push({ task: e.task, added: e.added });
      }
    }));
    return { track: track.fields.id, key: track.key, steps: out };
  });
}

/* a refusal names its step by number and name, never by an id the rollback frees */
function stepped(i, s, f) {
  try {
    return f();
  } catch (e) {
    if (!(e instanceof TrackRefusal)) throw e;
    throw new TrackRefusal(stepAt('steps', i, s) + ': ' + e.message, e.data);
  }
}

/* Position only breaks ties between tasks no edge orders; the reason is logged. */
/* The import made the old order into "depends on" edges with its own reason
   (server/tracks-import.mjs IMPORT_REASON): a reorder re-threads that chain
   around the moved task, so the ready set follows the new order. Edges a
   person added are never touched. */
function rethread(db, trackKey, taskKey, c) {
  const del = db.stmt('DELETE FROM depends WHERE task = ? AND "on" = ? AND reason = ?');
  const add = (task, on) => {
    if (task === on || pathBetween(db, on, task)) return;
    db.stmt('INSERT OR IGNORE INTO depends (task, "on", reason, added, actor) VALUES (?, ?, ?, ?, ?)').run(task, on, IMPORTED, c.at, c.by);
  };
  const was = db.stmt('SELECT "on" FROM depends WHERE task = ? AND reason = ?').all(taskKey, IMPORTED).map((r) => r.on);
  const led = db.stmt('SELECT task FROM depends WHERE "on" = ? AND reason = ?').all(taskKey, IMPORTED).map((r) => r.task);
  if (!was.length && !led.length) return false;
  for (const p of was) del.run(taskKey, p, IMPORTED);
  for (const n of led) del.run(n, taskKey, IMPORTED);
  for (const n of led) for (const p of was) add(n, p);
  const open = db.stmt(`SELECT ti.task FROM track_items ti JOIN records r ON r.key = ti.task WHERE ti.track = ?
    AND coalesce(r.status, '') NOT IN ('completed', 'dropped') ORDER BY ti.position`).all(trackKey).map((r) => r.task);
  const i = open.indexOf(taskKey);
  const prev = i > 0 ? open[i - 1] : null;
  const next = i >= 0 && i < open.length - 1 ? open[i + 1] : null;
  if (prev && next) del.run(next, prev, IMPORTED);
  if (prev) add(taskKey, prev);
  if (next) add(next, taskKey);
  return true;
}

export function reorder(db, input, actor) {
  const reason = needText(input && input.reason, 'a reorder');
  return tx(db, () => {
    const c = ctx(actor);
    const task = recordOf(db, input.task, 'task');
    const row = db.stmt('SELECT track FROM track_items WHERE task = ?').get(task.key);
    if (!row) throw new TrackRefusal(task.fields.id + ' is on no track');
    const track = loadRecord(db, row.track);
    checkVersion(track, input.version);
    const list = db.stmt('SELECT task, position FROM track_items WHERE track = ? ORDER BY position').all(track.key);
    const from = list.findIndex((r) => r.task === task.key);
    const rest = list.filter((r) => r.task !== task.key);
    let to;
    if (input.before || input.after) {
      const other = keyOf(db, input.before || input.after, 'task');
      const i = rest.findIndex((r) => r.task === other);
      if (i < 0) throw new TrackRefusal(labelOf(db, other) + ' is not on ' + track.fields.id);
      to = input.before ? i : i + 1;
    } else {
      const n = Number(input.position);
      if (!Number.isInteger(n) || n < 1 || n > list.length) throw new TrackRefusal('position runs 1 to ' + list.length);
      to = n - 1;
    }
    const lo = to > 0 ? rest[to - 1].position : null;
    const hi = to < rest.length ? rest[to].position : null;
    let pos = lo === null && hi === null ? 1 : lo === null ? hi - 1 : hi === null ? lo + 1 : (lo + hi) / 2;
    if (lo !== null && hi !== null && !(pos > lo && pos < hi)) {
      rest.splice(to, 0, { task: task.key });
      rest.forEach((r, i) => db.stmt('UPDATE track_items SET position = ? WHERE task = ?').run(i + 1, r.task));
      pos = to + 1;
    } else db.stmt('UPDATE track_items SET position = ? WHERE task = ?').run(pos, task.key);
    const rethreaded = rethread(db, track.key, task.key, c);
    bumpVersion(db, track.key);
    logLine(db, { at: c.at, verb: 'edit', kind: 'track', rec: headOf(track),
      changes: { order: [task.fields.id + ' at ' + (from + 1), task.fields.id + ' at ' + (to + 1)] }, by: c.by, pc: c.pc,
      note: reason + (rethreaded ? '; the imported order edges follow it' : '') });
    return { track: track.fields.id, task: task.fields.id, from: from + 1, to: to + 1, version: track.version + 1, rethreaded };
  });
}

/* Finishing or parking a side track hands back its junction, so the reply can
   ask the user whether to go back on track there. */
export function parkTrack(db, input, actor) {
  const reason = needText(input && input.reason, 'parking');
  return tx(db, () => {
    const c = ctx(actor);
    const rec = openTrack(db, input.track);
    const unparkWhen = unparkWhenOf(db, input.unparkWhen);
    const held = leaseOf(db, rec.key);
    /* a live lease is its holder's to park; a quiet one parks as before */
    if (held && held.session !== sessionOf(input, actor) && !quietSince(db, rec.key, c.date.getTime())) {
      throw new TrackRefusal(rec.fields.id + ' is held by ' + holderPlain(db, rec.key, held, { now: c.date.getTime(), pc: pcOf(input, actor) })
        + ': only that session parks it, or take it over first', { holder: holderOf(held) });
    }
    if (held) dropLease(db, held, c, 'parked: ' + reason);
    setStatus(db, rec, 'parked', { parkReason: reason, ...(unparkWhen ? { unparkWhen } : {}) }, c, 'edit', reason);
    return { id: rec.fields.id, key: rec.key, state: 'parked', ...(unparkWhen ? { unparkWhen: whenText(db, unparkWhen), unpark: unparkWords(db, unparkWhen) } : {}), junction: junctionBack(db, rec) };
  });
}

/* Open tasks stop a close unless they go to the inbox or are dropped with it. */
function settleLeftovers(db, rec, leftovers, c, why) {
  const g = trackGraph(db, rec.key);
  if (!g.tasks.length) return [];
  if (leftovers !== 'inbox' && leftovers !== 'drop') {
    throw new TrackRefusal(rec.fields.id + ' still has ' + g.tasks.map((t) => t.id).join(', ') + ' open: finish them, or pass leftovers inbox or drop',
      { open: g.tasks.map((t) => t.id) });
  }
  /* a promoted task's done follows its side track, so a close never drops it under one */
  const promoted = leftovers === 'drop' ? g.tasks.map((t) => ({ id: t.id, side: sideOf(db, t.key) })).filter((p) => p.side) : [];
  if (promoted.length) {
    throw new TrackRefusal(rec.fields.id + ' cannot drop ' + promoted.map((p) => p.id + ' (promoted to ' + p.side.label + ', still ' + p.side.status + ')').join(', ')
      + ': finish, drop or fold the side track first, or pass leftovers inbox', { promoted: promoted.map((p) => ({ task: p.id, track: p.side.label })) });
  }
  for (const t of g.tasks) {
    const task = loadRecord(db, t.key);
    if (leftovers === 'inbox') {
      db.stmt('DELETE FROM track_items WHERE task = ?').run(t.key);
      logLine(db, { at: c.at, verb: 'edit', kind: 'task', rec: headOf(task), changes: { track: [rec.key, null] }, by: c.by, pc: c.pc, note: 'to the inbox as ' + rec.fields.id + ' closed' });
    } else {
      const diff = writeFront(db, task, { status: 'dropped', updated: c.at, closed: c.at, inHand: undefined, inHandSince: undefined }, TASK_KEYS);
      logLine(db, { at: c.at, verb: 'drop', kind: 'task', rec: headOf(task), changes: diff, by: c.by, pc: c.pc, note: why });
      wakeLinked(db, { ...task.fields, key: task.key }, 'dropped', c);
    }
  }
  return g.tasks.map((t) => t.id);
}

function closeTrack(db, input, actor, status) {
  const c = ctx(actor);
  const rec = trackRec(db, input.track);
  if (CLOSED.includes(rec.fields.status)) throw new TrackRefusal(rec.fields.id + ' is already ' + rec.fields.status);
  const why = status === 'dropped' ? needText(input.reason, 'dropping a track') : input.outcome ? needText(input.outcome, 'an outcome') : undefined;
  /* at full depth a finish waits for a review of its finished code, or a waiver */
  const waived = status === 'done' ? finishGate(db, rec, input, c) : null;
  const left = settleLeftovers(db, rec, input.leftovers, c, why || rec.fields.id + ' finished');
  const held = leaseOf(db, rec.key);
  if (held) dropLease(db, held, c, status);
  setStatus(db, rec, status, why ? { outcome: why } : {}, c, status === 'dropped' ? 'drop' : 'close', [why, waived].filter(Boolean).join('; ') || undefined);
  wakeLinked(db, { ...rec.fields, key: rec.key }, status, c);
  const j = junctionOf(db, rec.key);
  /* a promoted task's done follows its side track; the stored status is kept in step */
  if (rec.fields.origin === 'promote' && j && j.task) {
    const pointer = loadRecord(db, j.task.key);
    if (status === 'done' && !ENDED_TASK.includes(pointer.fields.status)) {
      const diff = writeFront(db, pointer, { status: 'completed', updated: c.at, closed: c.at, inHand: undefined, inHandSince: undefined }, TASK_KEYS);
      logLine(db, { at: c.at, verb: 'edit', kind: 'task', rec: headOf(pointer), changes: diff, by: c.by, pc: c.pc, note: 'done as ' + rec.fields.id + ' finished' });
      afterTask(db, pointer.key, { completed: true }, actor);
      wakeLinked(db, { ...pointer.fields, key: pointer.key }, 'completed', c);
    }
    if (status === 'dropped') addNote(db, pointer.key, { at: c.at, actor: c.by, body: rec.fields.id + ' was dropped: ' + why + '. ' + pointer.fields.id + ' is a plain task again.' });
  }
  /* the inbox the kickoff listed, so the reply places, carries or asks about each */
  return { id: rec.fields.id, key: rec.key, state: status, leftovers: left, junction: junctionBack(db, rec), inbox: projectInbox(db, rec.fields.workstream), ...(waived ? { waived } : {}) };
}

export const finishTrack = (db, input, actor) => tx(db, () => closeTrack(db, input || {}, actor, 'done'));
export const dropTrack = (db, input, actor) => tx(db, () => closeTrack(db, input || {}, actor, 'dropped'));

/* ---- promote and fold back ------------------------------------------------ */

/* The checklist becomes a side track's tasks in order, with no edges; the task
   stays as the pointer. With move, the session goes there as a splinter does. */
export function promoteTask(db, input, actor) {
  return tx(db, () => {
    const c = ctx(actor);
    const task = recordOf(db, input && input.task, 'task');
    if (ENDED_TASK.includes(task.fields.status)) throw new TrackRefusal(task.fields.id + ' is ' + task.fields.status);
    for (const s of sideTracksOf(db, task.key)) {
      const st = loadRecord(db, s.key);
      if (st.fields.origin === 'promote' && !CLOSED.includes(st.fields.status)) throw new TrackRefusal(task.fields.id + ' is already promoted to ' + s.label);
    }
    const row = db.stmt('SELECT track FROM track_items WHERE task = ?').get(task.key);
    const parent = row ? loadRecord(db, row.track) : null;
    const ws = task.fields.workstream || (parent && parent.fields.workstream);
    const side = makeTrack(db, {
      name: input.name ? needText(input.name, 'a side track') : task.fields.name, workstream: workstreamOf(db, ws),
      goal: input.goal ? needText(input.goal, 'a goal') : undefined, origin: 'promote',
    }, c);
    if (parent) junctionRow(db, side.key, parent.key, c.at);
    junctionRow(db, side.key, task.key, c.at);
    const items = itemsOf(db, task.key);
    const made = [];
    items.forEach((it, i) => {
      const r = createRecord(db, { name: it.text, description: 'Step ' + (i + 1) + ' of ' + task.fields.id + "'s checklist.", workstream: side.fields.workstream }, actor);
      const t = loadRecord(db, r.key);
      if (it.done) {
        const diff = writeFront(db, t, { status: 'completed', closed: it.doneAt || c.at }, TASK_KEYS);
        logLine(db, { at: c.at, verb: 'edit', kind: 'task', rec: headOf(t), changes: diff, by: c.by, pc: c.pc, note: 'checked on ' + task.fields.id + "'s checklist" });
      }
      db.stmt('INSERT INTO track_items (track, task, position) VALUES (?, ?, ?)').run(side.key, r.key, i + 1);
      made.push(r.id);
    });
    writeItems(db, task.key, []);
    bumpVersion(db, task.key);
    const was = items.length ? items.filter((i) => i.done).length + ' of ' + items.length : null;
    logLine(db, { at: c.at, verb: 'edit', kind: 'task', rec: headOf(task), changes: { checklist: [was, null], promoted: [null, side.key] }, by: c.by, pc: c.pc,
      note: 'promoted to ' + side.fields.id });
    let parked = false;
    const session = sessionOf(input, actor);
    if (input.move) {
      if (parent && !CLOSED.includes(parent.fields.status)) parked = leaveFor(db, loadRecord(db, parent.key), side, task, session, pcOf(input, actor), c);
      else if (session) holdLease(db, side, session, pcOf(input, actor), c);
    }
    return {
      id: side.fields.id, key: side.key, kind: 'track', name: side.fields.name, pointer: task.fields.id, tasks: made,
      parked, state: stateOf(db, side), chain: chainOf(db, side.key).text,
    };
  });
}

/* A small promoted track back into its pointer's checklist: done tasks checked,
   notes moved, edges carried by the pointer; it closes as folded so its label
   still resolves. */
export function foldBack(db, input, actor) {
  return tx(db, () => {
    const c = ctx(actor);
    const side = trackRec(db, input && input.track);
    const id = side.fields.id;
    if (side.fields.origin !== 'promote') throw new TrackRefusal(id + ' was not promoted from a task, so it has no checklist to fold into');
    if (CLOSED.includes(side.fields.status)) throw new TrackRefusal(id + ' is ' + side.fields.status);
    const held = leaseOf(db, side.key);
    if (held) {
      throw new TrackRefusal(id + ' is held by ' + holderPlain(db, side.key, held, { now: c.date.getTime(), pc: c.pc }) + '; it folds back only with no lease', { holder: holderOf(held) });
    }
    const subs = sideTracksOf(db, side.key).filter((s) => !['dropped', 'folded'].includes(s.status));
    if (subs.length) throw new TrackRefusal(id + ' has side tracks of its own (' + subs.map((s) => s.label).join(', ') + ')');
    const j = junctionOf(db, side.key);
    const pointer = loadRecord(db, j.task.key);
    const rows = db.stmt(`SELECT ti.task FROM track_items ti JOIN records r ON r.key = ti.task WHERE ti.track = ? AND r.status <> 'dropped'
      ORDER BY ti.position`).all(side.key).map((r) => loadRecord(db, r.task));
    if (rows.length > foldMax(db)) throw new TrackRefusal(id + ' has ' + rows.length + ' tasks; it folds back at ' + foldMax(db) + ' or fewer');
    const before = itemsOf(db, pointer.key);
    const items = before.concat(rows.map((t) => ({ text: t.fields.name, done: t.fields.status === 'completed', doneAt: t.fields.closed || null })));
    writeItems(db, pointer.key, items);
    for (const t of rows) {
      for (const n of db.stmt('SELECT at, actor, body FROM notes WHERE record = ? ORDER BY position').all(t.key)) {
        addNote(db, pointer.key, { at: n.at, actor: n.actor, body: t.fields.id + ': ' + n.body });
      }
      db.stmt('DELETE FROM notes WHERE record = ?').run(t.key);
    }
    /* edges touching the folded tasks move to the pointer; a loop that would make stops the fold */
    const all = db.stmt(`SELECT task, "on", reason FROM depends WHERE task IN (SELECT task FROM track_items WHERE track = ?)
      OR "on" IN (SELECT task FROM track_items WHERE track = ?)`).all(side.key, side.key);
    db.stmt(`DELETE FROM depends WHERE task IN (SELECT task FROM track_items WHERE track = ?)
      OR "on" IN (SELECT task FROM track_items WHERE track = ?)`).run(side.key, side.key);
    const sideKeys = new Set(db.stmt('SELECT task FROM track_items WHERE track = ?').all(side.key).map((r) => r.task));
    const openSide = new Set(rows.filter((t) => t.fields.status !== 'completed').map((t) => t.key));
    setStatus(db, side, 'folded', { outcome: input.reason ? needText(input.reason, 'a reason') : 'folded back into ' + pointer.fields.id }, c, 'close',
      'folded back into ' + pointer.fields.id + "'s checklist");
    wakeLinked(db, { ...side.fields, key: side.key }, 'folded', c);
    for (const e of all) {
      /* an edge at a finished step was met and goes; one at an open step lands on the pointer */
      if ((sideKeys.has(e.task) && !openSide.has(e.task)) || (sideKeys.has(e.on) && !openSide.has(e.on))) continue;
      const task = sideKeys.has(e.task) ? pointer.key : e.task;
      const on = sideKeys.has(e.on) ? pointer.key : e.on;
      if (task === on || db.stmt('SELECT 1 FROM depends WHERE task = ? AND "on" = ?').get(task, on)) continue;
      const loop = pathBetween(db, on, task);
      if (loop) {
        throw new TrackRefusal('folding ' + id + ' would make ' + labelOf(db, task) + ' and ' + labelOf(db, on) + ' wait on each other; remove one of those edges first',
          { loop: loop.map((k) => labelOf(db, k)) });
      }
      db.stmt('INSERT INTO depends (task, "on", reason, added, actor) VALUES (?, ?, ?, ?, ?)').run(task, on, 'folded from ' + id + ': ' + e.reason, c.at, c.by);
    }
    for (const t of rows) {
      if (t.fields.status === 'completed') continue;
      const diff = writeFront(db, t, { status: 'dropped', updated: c.at, closed: c.at, inHand: undefined, inHandSince: undefined }, TASK_KEYS);
      logLine(db, { at: c.at, verb: 'drop', kind: 'task', rec: headOf(t), changes: diff, by: c.by, pc: c.pc, note: 'folded into ' + pointer.fields.id + "'s checklist" });
      wakeLinked(db, { ...t.fields, key: t.key }, 'dropped', c);
    }
    bumpVersion(db, pointer.key);
    const text = (items) => (items.length ? items.filter((i) => i.done).length + ' of ' + items.length : null);
    logLine(db, { at: c.at, verb: 'edit', kind: 'task', rec: headOf(pointer), changes: { checklist: [text(before), text(items)] }, by: c.by, pc: c.pc,
      note: 'folded back from ' + id });
    /* one level of nesting: a side task's own checklist stays on that task, so the reply names it */
    const stepsStayed = rows.filter((t) => itemsOf(db, t.key).length).map((t) => t.fields.id);
    return { id, key: side.key, state: 'folded', pointer: pointer.fields.id, progress: text(items), stepsStayed };
  });
}

/* ---- reads ---------------------------------------------------------------- */

const nowMsOf = (opts) => clockOf(opts).getTime();

/* a parked track's row says what opens it again; absent otherwise */
export function unparkOf(db, rec, state) {
  const u = state === 'parked' ? unparkWords(db, rec.fields.unparkWhen) : null;
  return u ? { unpark: u } : {};
}

/* a started task runs while a live hand backs it: its own hand the reader's or a session
   holding a lease; with no hand of its own, its track's lease. Read here once for every surface. */
function staleOf(db, trackKey, now, opts) {
  const reader = (opts && opts.reader) || null;
  const held = Boolean(leaseOf(db, trackKey));
  return now.filter((n) => {
    const hand = (db.stmt("SELECT json_extract(fields, '$.inHand') AS hand FROM records WHERE key = ?").get(n.key) || {}).hand;
    return hand ? hand !== reader && !db.stmt('SELECT 1 FROM leases WHERE session = ?').get(hand) : !held;
  });
}

/* The band's track row and the kickoff's head, from the tables in one read: now (the started
   tasks a live hand backs), stale (the rest), the ready count and the critical path's length. */
function summarize(db, input, opts) {
  const rec = trackRec(db, input && input.track);
  const state = stateOf(db, rec);
  const g = trackGraph(db, rec.key);
  const stale = staleOf(db, rec.key, g.now, opts);
  const now = g.now.filter((n) => !stale.includes(n));
  const running = now.length;
  const summary = {
    id: rec.fields.id, key: rec.key, name: rec.fields.name, goal: rec.fields.goal || null, state, stalled: isStalled(db, rec, state, nowMsOf(opts)),
    quietSince: state === 'active' ? quietSince(db, rec.key, nowMsOf(opts)) : null,
    noHandoff: noHandoff(db, rec.key, state), parkReason: rec.fields.parkReason || null, ...unparkOf(db, rec, state), chain: chainOf(db, rec.key).text, now,
    stale: stale.map((n) => ({ id: n.id, key: n.key, name: n.name })),
    running, ready: g.ready.length, toGo: g.critical.length,
    text: countsText({ open: g.tasks.length, running, left: stale.length, ready: g.ready.length, chain: g.critical.length }),
  };
  return { summary, g };
}

export const trackSummary = (db, input, opts) => readTx(db, () => summarize(db, input, opts).summary);

/* The kickoff's full view: the summary plus the ready set, the critical path,
   the open tasks in dependency order, the junction and the side tracks. */
export function trackView(db, input, opts) {
  return readTx(db, () => {
    const { summary: s, g } = summarize(db, input, opts);
    const lease = leaseOf(db, s.key);
    /* the layout breaks ties by position (server/layout.mjs layoutInput) */
    const pos = new Map(db.stmt('SELECT task, position FROM track_items WHERE track = ?').all(s.key).map((r) => [r.task, r.position]));
    const r = trackReview(db, s.key);
    /* an open review station says so and what it reads */
    const scopeOf = new Map(db.stmt(`SELECT key, fields FROM records WHERE key IN (SELECT value FROM json_each(?))`).all(JSON.stringify(g.tasks.map((t) => t.key)))
      .map((x) => [x.key, JSON.parse(x.fields)]));
    const tasks = g.tasks.map((t) => {
      const f = scopeOf.get(t.key);
      /* a review back open after it completed draws as reopened */
      const again = f && isReview(f) && !!db.stmt(`SELECT 1 FROM activity WHERE record = ? AND json_extract(line, '$.changes.status[0]') = 'completed' LIMIT 1`).get(t.key);
      return { ...t, position: pos.get(t.key) ?? null, ...(f && isReview(f) ? { review: true, reviewScope: f.reviewScope === 'project' ? 'project' : 'track', ...(again ? { reopened: true } : {}) } : {}) };
    });
    return {
      ...s, holder: lease ? holderOf(lease) : null, readySet: g.ready, critical: g.critical, tasks, edges: g.edges, names: g.names,
      done: g.done, total: g.total, junction: junctionOf(db, s.key),
      sideTracks: sideTracksOf(db, s.key).map((t) => ({ id: t.label, key: t.key, state: stateOf(db, loadRecord(db, t.key)) })),
      /* what its arc found, for the Tracks tab's row */
      found: foundSummary(db, s.key),
      /* the review readout and, apart from the open stations, the finished code tasks and the reviews, for the station map */
      review: reviewHead(r), finished: r ? [...r.finished, ...r.reviews.filter((v) => v.status === 'completed')].sort((a, b) => a.position - b.position) : [],
    };
  });
}

/* the open tasks on no track in every open workstream sharing a
   project with this one, its own included, oldest first, so a task filed in the wrong one shows too. */
export function projectInbox(db, wsKey) {
  const own = wsKey ? loadRecord(db, wsKey) : null;
  if (!own) return [];
  const out = [];
  for (const w of db.stmt("SELECT key, label, fields FROM records WHERE kind = 'workstream' AND (status = 'open' OR key = ?) ORDER BY id").all(wsKey)) {
    const f = JSON.parse(w.fields);
    if (w.key !== wsKey && !sharesProject(own.fields, f)) continue;
    for (const r of db.stmt(`SELECT r.key, r.label, r.title, r.id AS n, json_extract(r.fields, '$.created') AS created FROM records r WHERE ${INBOX}`).all(w.key)) {
      out.push({ id: r.label, key: r.key, name: r.title, workstream: { id: w.label, name: f.name || '' }, created: r.created || '', n: r.n });
    }
  }
  return out.sort((a, b) => (Date.parse(a.created) || 0) - (Date.parse(b.created) || 0) || a.n - b.n)
    .map(({ created, n, ...t }) => t);
}

/* the track's open tasks no open task waits on (one on another track counts), apart
   from the end of its longest chain; `g` is its graph or view. A promoted track's tasks are
   all waited on by the task it was promoted from. */
export function openLeaves(db, trackKey, g = trackGraph(db, trackKey)) {
  const rec = loadRecord(db, trackKey);
  if (!rec || rec.fields.origin === 'promote' || !g.tasks.length) return [];
  const last = g.critical.path[g.critical.path.length - 1];
  const end = last && !g.tasks.some((t) => t.id === last) ? promotedEnd(db, trackKey, last) : last;
  const isEnd = (t) => t.id === end;
  const waited = new Set(db.stmt(`SELECT DISTINCT d."on" AS k FROM depends d JOIN records r ON r.key = d.task
    WHERE d."on" IN (SELECT value FROM json_each(?)) AND coalesce(r.status, '') NOT IN ('completed', 'dropped')`)
    .all(JSON.stringify(g.tasks.map((t) => t.key))).map((r) => r.k));
  return g.tasks.filter((t) => !isEnd(t) && !waited.has(t.key)).map((t) => ({ id: t.id, name: t.name }));
}

/* A promoted task adds no length of its own, so a chain ending on a side track ends on the task
   of this track whose side track (or one nested in it) holds the chain's last task. */
function promotedEnd(db, trackKey, last) {
  let at = (db.stmt('SELECT track FROM track_items WHERE task = ?').get(keyOf(db, last, 'task')) || {}).track;
  for (let hop = 0; at && hop < 20; hop++) {
    const j = junctionOf(db, at);
    if (!j || !j.track || !j.task) return null;
    if (j.track.key === trackKey) return j.task.id;
    at = j.track.key;
  }
  return null;
}

/* A workstream's tracks with their state, stalls marked; closed ones on request. */
export function listTracks(db, input, opts) {
  return readTx(db, () => {
    const ws = workstreamOf(db, input && input.workstream);
    const nowMs = nowMsOf(opts);
    const out = [];
    for (const r of db.stmt("SELECT key FROM records WHERE kind = 'track' AND workstream = ? ORDER BY id").all(ws)) {
      const rec = loadRecord(db, r.key);
      if (CLOSED.includes(rec.fields.status) && !(input && input.all)) continue;
      const state = stateOf(db, rec);
      out.push({
        id: rec.fields.id, key: rec.key, name: rec.fields.name, state, stalled: isStalled(db, rec, state, nowMs),
        quietSince: state === 'active' ? quietSince(db, rec.key, nowMs) : null,
        noHandoff: noHandoff(db, rec.key, state), parkReason: rec.fields.parkReason || null, ...unparkOf(db, rec, state),
        labels: rec.fields.labels || [], refs: (rec.fields.refs || []).map((r) => labelOf(db, r)),
      });
    }
    const inbox = db.stmt(`SELECT count(*) AS n FROM records r WHERE ${INBOX}`).get(ws).n;
    return { workstream: labelOf(db, ws), tracks: out, inbox, inboxStalled: inboxStalled(db, ws, nowMs) };
  });
}

/* The workstream's tracks, each as trackView, in listTracks order, in one read:
   what the local server and the web draw the graph from. */
export function workstreamView(db, input, opts) {
  return readTx(db, () => {
    const ls = listTracks(db, input, opts);
    const tracks = ls.tracks.map((t) => trackView(db, { track: t.key }, opts));
    return { workstream: ls.workstream, inbox: ls.inbox, inboxStalled: ls.inboxStalled, tracks };
  });
}
