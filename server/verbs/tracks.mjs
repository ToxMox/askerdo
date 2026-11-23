/* Tracks: a named line of work
   in a workstream, its tasks in track_items, leases (one session per track, one
   track per session) and junctions. A track's state is derived when read, never
   stored: only park, finish and drop are written (folded stays on old tracks). */
import { tx } from '../db.mjs';
import { KEY_ORDERS, actorOf, addNote, clockOf, dayOf, getMeta, kebab, labelOf, logVerb, mintKey, pcOfCall, putHandoff, putRecord, sessionWords, unguardHeadings } from '../records.mjs';
import { namedLabel, pickLabel, refsFor, resolveRecord, strList } from './labels.mjs';
import { sharesProject, wakeLinked } from './questions.mjs';
import { createRecord, editRecord } from './work.mjs';
import { CLI, RUN_BY_HINT, WAKE_FORMS, inboxRefusal, offerLines, runByOf, stepAt } from '../handoff-text.mjs';
import { holderWords } from '../web/feed.mjs';
import { foundSummary, heldOffers, inboxOffers, isReview, offerOf, offersOfHint, placeRefusal, suggestTrack, withOffers, wordsOf } from './found.mjs';
import { finishGate, reviewHead, trackReview } from './coverage.mjs';
import { countsText, holdOn } from '../web/draw.mjs';
import { BY as UPKEEP, NEXT_SESSION, enteredInbox, isNextSession, nextSessionWake, settleWakeAsk, thirdWake, unparkWhenOf, unparkWords, wakeOf, wakeState, wakeWords, whenText } from './upkeep.mjs';
import {
  ENDED_TASK, TASK_KEYS, TrackRefusal, addEdge, bumpVersion, checkVersion, headOf, keyOf,
  loadRecord, logLine, needText, pathBetween, readTx, recordOf, trackGraph, writeFront,
} from './graph.mjs';
import { endTask, openSteps, runsHolding } from './ending.mjs';
import { endSessionRuns, heldWords, openRunSql, renewRuns } from './runs.mjs';
import { APPROVED, GO_PATH, PLACEMENT_LABEL } from './placement-seam.mjs';
import { askPlacement, draftOf, placementLacks } from './placement-ask.mjs';
import { bypassFor } from './bypass.mjs';

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

/* ---- the placement rule: found work is free only at a real place on the held track ---- */

/* The user's own command (--user) is never asked. */
export const isUserCall = (c) => /^user(?::|$)/.test(String((c && c.by) || ''));
/* The lease the rule polices a session by: the one it holds, else (an implementation choice) the
   newest track it held that is still open, so parking or handing the track on is no way round; null if none is open. */
function policedLease(db, session) {
  const l = leaseOfSession(db, session);
  if (l || !session) return l;
  /* a fresh track taken and finished frees nothing */
  const row = db.stmt(`SELECT a.record FROM activity a JOIN records r ON r.key = a.record WHERE r.kind = 'track'
    AND coalesce(r.status, '') NOT IN (${CLOSED.map(() => '?').join(', ')}) AND json_extract(a.diff, '$.session[1]') = ? ORDER BY a.seq DESC LIMIT 1`).get(...CLOSED, session);
  return row ? { track: row.record, session, released: true } : null;
}
/* The track a session's own call is policed against; null for the user, no session or no track held. */
export function policedHeld(db, c) {
  if (!c || !c.session || isUserCall(c)) return null;
  const l = policedLease(db, c.session);
  return l ? lastHeld(loadRecord(db, l.track), l) : null;
}
/* a track the session let go is marked, so a refusal names it as the one it last held */
const lastHeld = (rec, lease) => (rec && lease && lease.released ? Object.defineProperty(rec, 'released', { value: true }) : rec);
const youHold = (held) => (held && held.released ? 'the track you last held' : 'the track you hold');
const openOn = (db, trackKey) => db.stmt(`SELECT ti.task AS key, r.label AS id, r.fields FROM track_items ti JOIN records r ON r.key = ti.task WHERE ti.track = ?
  AND coalesce(r.status, '') NOT IN ('done', 'dropped') ORDER BY ti.position`).all(trackKey).map((r) => ({ key: r.key, id: r.id, f: JSON.parse(r.fields) }));
/* the closing review: an open review no other open review waits on */
function closingKeys(db, open) {
  const reviews = open.filter((r) => isReview(r.f));
  return new Set(reviews.filter((r) => !reviews.some((o) => o !== r && pathBetween(db, o.key, r.key))).map((r) => r.key));
}
/* Nothing else open: no open task on the track but those skipped (the one closing, the call's own) and the closing review. */
export function nothingElseOpen(db, trackKey, skip = new Set()) {
  const open = openOn(db, trackKey);
  const closing = closingKeys(db, open);
  return !open.some((r) => !closing.has(r.key) && !skip.has(r.key));
}
/* a step that waits (through `seeds`, task keys) on open work on the track with nothing there but the closing
   review sitting after that work is the track's end: there is no order to be last in, so it files at once. */
export function endOfTrack(db, trackKey, seeds, skip = new Set()) {
  const all = openOn(db, trackKey);
  const closing = closingKeys(db, all);
  const open = all.filter((r) => !skip.has(r.key));
  const reached = open.filter((r) => seeds.some((s) => pathBetween(db, s, r.key)));
  const front = reached.filter((r) => !reached.some((o) => o !== r && pathBetween(db, o.key, r.key)));
  return front.length > 0 && !open.some((o) => !reached.includes(o) && !closing.has(o.key) && front.some((f) => pathBetween(db, o.key, f.key)));
}
const taskKeysOf = (db, ids) => [].concat(ids ?? []).filter((a) => typeof a === 'string' && a.trim())
  .map((a) => resolveRecord(db, a.trim(), { kinds: ['task'] })).filter(Boolean).map((e) => e.key);
/* Before names an open task on the held track other than its closing review; a wrong id is refused by name. */
export function realBefore(db, heldRec, before, after, strict = true) {
  const open = openOn(db, heldRec.key);
  const closing = closingKeys(db, open);
  let real = false;
  for (const id of [].concat(before ?? []).map((s) => String(s).trim()).filter(Boolean)) {
    const hit = open.find((r) => r.id === id);
    if (!hit) {
      if (strict) throw new TrackRefusal('before names ' + id + ', which is not an open task on ' + heldRec.fields.id + ', ' + youHold(heldRec));
      continue;
    }
    if (!closing.has(hit.key)) real = true;
  }
  if (strict) {
    for (const id of [].concat(after ?? []).filter((a) => typeof a === 'string').map((s) => s.trim()).filter(Boolean)) {
      if (!resolveRecord(db, id, { kinds: ['task'] })) throw new TrackRefusal('after names ' + id + ', and no task ' + id + ' exists');
    }
  }
  return real;
}
/* `here` checked as a real place on the held track (an end only when nothing else is open there);
   null when nothing on it waits on the work, so the question offers no do-it-here press. */
function hereOf(db, here, heldRec, skip) {
  if (here !== undefined && here !== null && (typeof here !== 'object' || Array.isArray(here))) throw new TrackRefusal('here is { after, before }, each a list of T-n ids on ' + heldRec.fields.id);
  const list = (v, what) => {
    if (v === undefined || v === null) return [];
    const l = (Array.isArray(v) ? v : [v]).map((s) => String(s ?? '').trim()).filter(Boolean);
    for (const s of l) if (!TASK_ID.test(s)) throw new TrackRefusal('here.' + what + ' names T-n ids: ' + s);
    return l;
  };
  const out = { after: list((here || {}).after, 'after'), before: list((here || {}).before, 'before') };
  try {
    if (realBefore(db, heldRec, out.before, out.after) || nothingElseOpen(db, heldRec.key, skip)) return out;
  } catch (e) {
    if (e instanceof TrackRefusal) throw new TrackRefusal('here: ' + e.message);
    throw e;
  }
  return null;
}
const ASKED_KEYS = ['tier', 'track', 'workstream', 'newTrack', 'unparkWhen', 'wake', 'unplaced', 'last', 'whyElsewhere', 'after', 'before', 'onto'];
/* An asked filing: the place asked, `here` and the item registered as the placement question; nothing is created.
   `item`: { draft } or { task: 'T-n' }; `from`: via, task, step; `skip`: what nothing-else-open leaves out. */
export function askFiling(db, f, c, item, from, skip = new Set()) {
  const heldRec = policedHeld(db, c);
  const asked = {};
  for (const k of ASKED_KEYS) if (isGiven(f[k])) asked[k] = f[k];
  if (Number(asked.tier) === 2 && !asked.track && !asked.onto) asked.track = heldRec.fields.id;
  /* the answer files as a session that may hold no track by then, so a new parked track keeps the held one's workstream */
  if (asked.unparkWhen && !asked.workstream) asked.workstream = labelOf(db, heldRec.fields.workstream);
  const lacks = placementLacks(asked, heldRec.fields.id, item.task ? null : item.draft || {});
  if (lacks) throw new TrackRefusal(lacks + '. Nothing was filed.');
  const here = hereOf(db, f.here, heldRec, skip);
  /* a last on the held track names the tasks it will wait on, read now */
  const moved = item.task ? resolveRecord(db, String(item.task).trim(), { kinds: ['task'] }) : null;
  const lastAt = isGiven(asked.last) && asked.track === heldRec.fields.id && !isNextSession(asked.wake) ? lastPlace(db, heldRec.key, moved ? moved.key : null) : null;
  const lastWords = lastAt ? { after: lastAt.ends.map((e) => e.id), ...(lastAt.tail ? { before: lastAt.tail.id } : {}) } : null;
  return { ...askPlacement(db, { track: heldRec.fields.id, ...(item.task ? { task: item.task } : { draft: draftOf(item.draft) }), here, asked, from, ...(lastWords ? { lastAt: lastWords } : {}) }, c), path: GO_PATH };
}
/* The talk filing: a filing naming a placement question settled in talk, with the user's words, is let
   through once; null when none is named. Refused for any other question. */
export function talkOf(db, question, words, c) {
  if (question === undefined || question === null || question === '') return null;
  const q = resolveRecord(db, String(question).trim(), { kinds: ['question'] });
  if (!q) throw new TrackRefusal('question names ' + question + ', and no such question exists');
  const p = q.front.placement;
  if (!(q.front.labels || []).includes(PLACEMENT_LABEL) || !p) throw new TrackRefusal(q.label + ' is not a placement question, so it lets no filing through');
  /* the talk was with the session that asked, or with whoever holds (or last held) the question's track */
  const filer = c && c.session && !isUserCall(c) ? c.session : null;
  const lease = filer ? policedLease(db, filer) : null;
  if (!isUserCall(c) && !(filer && (filer === p.session || (lease && lease.track === q.front.track)))) {
    throw new TrackRefusal(q.label + ' was asked by another session on ' + labelOf(db, q.front.track) + ': only that session, or the one holding ' + labelOf(db, q.front.track) + ', files what the talk settled');
  }
  if (typeof words !== 'string' || !words.trim()) throw new TrackRefusal('a filing settled in talk carries the user\'s settling words (words, or --words)');
  if (q.front.status !== 'answered') throw new TrackRefusal(q.label + ' is ' + q.front.status + ': only an answer to talk lets a filing through');
  if (p.created) throw new TrackRefusal(q.label + ' already created ' + p.created + ': move or drop that task instead');
  const chosen = (db.stmt(`SELECT json_extract(diff, '$.chosen[1]') AS pick FROM activity WHERE record = ? AND verb IN ('answer', 'amend') ORDER BY seq DESC LIMIT 1`).get(q.key) || {}).pick || null;
  const talked = ['talk', 'stale'].includes(p.outcome) || (!p.outcome && (chosen === null || chosen === 'c'));
  if (!talked) throw new TrackRefusal(q.label + ' was answered ' + (p.outcome || chosen) + ', not talk: it lets no filing through');
  return { key: q.key, id: q.label, words: words.trim() };
}
/* After the talk filing lands: created set on its question, and the task's journal names both. */
export function settleTalk(db, talk, taskKey, c) {
  const q = loadRecord(db, talk.key);
  const task = loadRecord(db, taskKey);
  writeFront(db, q, { placement: { ...q.fields.placement, created: task.fields.id } }, KEY_ORDERS.question);
  addNote(db, taskKey, { at: c.at, actor: c.by, body: 'Filed as settled in talk on ' + talk.id + ': "' + talk.words + '"' });
}
/* Open placement questions of a track, which stop its finish or drop. */
const placementsOpen = (db, trackKey) => db.stmt(`SELECT label FROM records WHERE kind = 'question' AND status IN ('open', 'snoozed')
  AND json_extract(fields, '$.track') = ? AND EXISTS (SELECT 1 FROM json_each(fields, '$.labels') WHERE value = ?) ORDER BY label`).all(trackKey, PLACEMENT_LABEL).map((r) => r.label);

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
const lastHandoff = (db, key) => db.stmt('SELECT status, label FROM handoffs WHERE track = ? ORDER BY ' + NEWEST_FIRST + ' LIMIT 1').get(key);

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
    WHERE ti.track = ? AND coalesce(r.status, '') NOT IN ('done', 'dropped')`).get(rec.key).n;
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
const INBOX = `r.kind = 'task' AND r.workstream = ? AND coalesce(r.status, '') NOT IN ('done', 'dropped')
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

/* The parent track and the task a side track left from. */
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

/* The session lets go of the track, so its own runs on the track's tasks (or on
   `tasks`, read before a close moved them) end handed on with the drop's note; its agents' end
   with the agent. */
function dropLease(db, lease, c, note, tasks) {
  endLeaseRuns(db, lease, c, 'handed_on', note, tasks);
  db.stmt('DELETE FROM leases WHERE track = ?').run(lease.track);
  const rec = loadRecord(db, lease.track);
  logLine(db, { at: c.at, verb: 'edit', kind: 'track', rec: headOf(rec), changes: { session: [lease.session, null] }, by: c.by, pc: c.pc, note });
  return rec.fields.id;
}

const trackTasks = (db, track) => db.stmt('SELECT task FROM track_items WHERE track = ?').all(track).map((r) => r.task);

function endLeaseRuns(db, lease, c, how, note, tasks) {
  const keys = tasks || trackTasks(db, lease.track);
  if (keys.length) endSessionRuns(db, { session: lease.session, tasks: keys, how, note: note || undefined }, { by: c.by, session: lease.session, pc: c.pc, now: c.date });
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

/* Last seen, no activity row, on the lease, the session's own runs and the agent runs whose
   engine ids the input lists, so a dead agent's run goes unheard; a session that
   lost its lease learns it here, with its open runs. */
export function renewLease(db, input, actor) {
  const session = needSession(input, actor, 'renewing a lease');
  return tx(db, () => {
    const c = actorOf(actor);
    const at = c.at;
    const { runs, at: heard } = renewRuns(db, { sessionRuns: true, agentIds: input && input.agentIds }, { by: c.by, session, pc: c.pc, now: c.date });
    const r = db.stmt('UPDATE leases SET seen = ? WHERE session = ?').run(at, session);
    const l = r.changes ? leaseOfSession(db, session) : null;
    return { held: Boolean(l), track: l ? labelOf(db, l.track) : null, runs, at: heard };
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
    /* the resume's take-over is the user's word: the old holder's own runs here end taken over */
    endLeaseRuns(db, held, c, 'taken_over', 'taken over with ' + rec.fields.id + (input.reason ? ': ' + input.reason : ''));
    /* a /clear goes on as the same session: a take that continues the holder's own earlier id keeps
       the lease's since, so a hold made before the /clear still counts */
    const goesOn = typeof input.continues === 'string' && input.continues.trim() === held.session;
    db.stmt('UPDATE leases SET session = ?, pc = ?, since = ?, seen = ? WHERE track = ?').run(session, pcOf(input, actor), goesOn ? held.since : c.at, c.at, rec.key);
    /* `continues` on the row says the new id goes on from the old one, so a next-session wait reads it as the same session */
    logLine(db, { at: c.at, verb: 'edit', kind: 'track', rec: headOf(rec), changes: { session: [held.session, session], ...(goesOn ? { continues: [null, held.session] } : {}) }, by: c.by, pc: c.pc,
      note: (goesOn ? 'the same session goes on from its earlier id' : 'taken over from ' + was) + (input.reason ? ': ' + input.reason : '') });
    return { track: rec.fields.id, key: rec.key, from: holderOf(held), released, unparked: false, ...(goesOn ? { continued: true } : {}) };
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
  db.stmt('DELETE FROM track_items WHERE task = ?').run(task.key);
  db.stmt('INSERT INTO track_items (track, task, position) VALUES (?, ?, ?)').run(trackRec_.key, task.key, endOf(db, trackRec_.key));
  bumpVersion(db, trackRec_.key);
  if (was) bumpVersion(db, was.track);
  const changes = { track: [was ? was.track : null, trackRec_.key] };
  /* a task takes the workstream of the track it lands on, and a placed task is unplaced no more */
  const ws = trackRec_.fields.workstream;
  const front = { ...(ws && task.fields.workstream !== ws ? { workstream: ws } : {}), ...(task.fields.unplaced !== undefined ? { unplaced: undefined } : {}),
    ...(task.fields.wake !== undefined ? { wake: undefined } : {}) };
  const woke = task.fields.wake;
  if (Object.keys(front).length) Object.assign(changes, writeFront(db, task, { ...front, updated: c.at }, TASK_KEYS));
  if (changes.wake) changes.wake = [wakeWords(db, woke), null];
  logLine(db, { at: c.at, verb: 'edit', kind: 'task', rec: headOf(task), changes, by: c.by, pc: c.pc, note });
  dropImported(db, task, trackRec_, c);
  /* placed, the user's open question about its home is moot */
  settleWakeAsk(db, task.key, task.fields.id + ' went on ' + trackRec_.fields.id, c);
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

/* work that starts later goes on a parked track that opens on its own event,
   so an unplaced reason saying no track carries it is refused with the commands that make one. */
const NO_TRACK = [
  /\bno (?:\w+ )?(?:track|line of work)s? (?:yet|carr(?:y|ies)|holds?|takes?|covers?|has|have|exists?|is open|for (?:it|this|them)|to (?:put|carry|hold|take))\b/i,
  /\bnot (?:yet )?on (?:a|any) (?:track|line of work)\b/i, /\bwithout (?:a|any) track\b/i,
  /\bneeds? (?:a|its own|a new|a separate) (?:new )?track\b/i, /\bwait(?:s|ing)? (?:for|on) (?:a|its|a new|no) (?:new )?track\b/i, /\bno home\b/i,
];
export const saysNoTrack = (why) => NO_TRACK.some((re) => re.test(String(why || '')));
/* an inbox filing names its wake, whoever files it; what it lacks is the one
   refusal (handoff-text.mjs inboxRefusal), null when it is whole. `at`: via, task, track, workstream. */
export function inboxLacks(why, wake, at = {}) {
  const said = typeof why === 'string' ? why.replace(/\s+/g, ' ').trim() : '';
  if (said && saysNoTrack(said)) {
    return inboxRefusal({ ...at, cause: 'unplaced "' + said + '" says no track carries this work, and work that starts later goes on a parked track that opens on its own event' });
  }
  if (wake === undefined || wake === null || wake === '') return inboxRefusal({ ...at, cause: (at.task || (at.via === 'leftover' ? 'the step' : 'this task')) + ' goes to the inbox with no wake' });
  return null;
}

/* Work that waits for the end of the track the filing session holds is a step on that
   track, never an inbox task; null for no session, no track held, or another track's end. */
export function ownTrackLacks(db, wake, session, at = {}) {
  const id = ownEndOf(db, wake, session);
  if (!id) return null;
  const way = at.via === 'leftover'
    ? (at.track === id ? 'leave out unplaced and wake, and the step goes on ' + id + ' (after or before names the step it follows)'
      : 'file it on ' + id + ' itself (`' + CLI + ' task create --track ' + id + '`, with --after or --before the step it follows) and leave it out of these leftovers')
    : at.task ? 'place it there with `' + CLI + ' task edit ' + at.task + ' --track ' + id + '`, and --after or --before the step it follows'
      : at.via === 'capture' ? 'capture it again with --track ' + id + ' in place of --workstream, --unplaced and --wake'
        : at.open ? 'move ' + at.open.join(', ') + ' onto ' + id + ' first (`' + CLI + ' task edit ' + (at.open.length === 1 ? at.open[0] : '<T-n>') + ' --track ' + id
          + '`, with --after or --before the step it follows), then ' + at.via + ' ' + at.track + ' again'
        : 'file it again with --track ' + id + ' and --after or --before the step it follows, in place of the unplaced reason and the wake';
  return ownEndCause(id) + ': ' + way + '.';
}
/* the held track's id when `wake` is its end */
function ownEndOf(db, wake, session) {
  const held = leaseOfSession(db, session);
  const m = typeof wake === 'string' ? /^\s*track-ends\s+(\S+)\s*$/i.exec(wake) : null;
  const ref = m ? m[1] : wake && typeof wake === 'object' && wake.kind === 'track-ends' ? wake.on : null;
  const e = held && ref ? resolveRecord(db, String(ref).trim(), { kinds: ['track'] }) : null;
  return e && e.key === held.track ? e.label : null;
}
const ownEndCause = (id) => id + ' is the track you hold, so work that waits for its end is a step on it, not an inbox task';

/* a task's place as its filer judged it: a track, with the steps it comes before or
   after laid as track layout lays them, or unplaced with the reason the found list shows.
   an unplaced task carries a wake (wakeOf); a wake alone wakes an inbox task again. */
export function placeTask(db, taskKey, place, actor) {
  const c = ctx(actor);
  const before = idList(place.before, 'before');
  const after = idList(place.after, 'after');
  const hasWhy = place.unplaced !== undefined && place.unplaced !== null;
  const hasWake = place.wake !== undefined && place.wake !== null && place.wake !== '';
  if (place.track && (hasWhy || hasWake)) throw new TrackRefusal('a task goes on a track or stays unplaced with its wake, not both');
  let task = loadRecord(db, taskKey);
  const row = () => db.stmt('SELECT track FROM track_items WHERE task = ?').get(taskKey);
  if (hasWhy || hasWake) {
    if (before.length || after.length) throw new TrackRefusal('before and after place a task on a track; an unplaced one has no steps around it');
    const was = row();
    if (!hasWhy && was) throw new TrackRefusal(task.fields.id + ' is on ' + labelOf(db, was.track) + ': a wake is for a task on no track, so name --unplaced "<why>" with it');
    const why = hasWhy ? needText(place.unplaced, 'unplaced', 'reason') : task.fields.unplaced;
    const at = { via: 'edit', task: task.fields.id, workstream: task.fields.workstream ? labelOf(db, task.fields.workstream) : null };
    const no = inboxLacks(hasWhy ? why : '', place.wake, at) || ownTrackLacks(db, place.wake, c.session, at);
    if (no) throw new TrackRefusal(no);
    const wake = wakeOf(db, place.wake, c.day, task.fields.id);
    /* a third wake this inbox stay is stored as none: the user is asked where it goes;
       under a bypass the wake named lands */
    const held = was ? null : thirdWake(db, task, c, why, Boolean(bypassFor(db, c, policedHeld(db, c))));
    if (held) return { ...held, wake: wakeWords(db, task.fields.wake) || null };
    if (was) {
      db.stmt('DELETE FROM track_items WHERE task = ?').run(taskKey);
      bumpVersion(db, was.track);
    }
    const old = task.fields.wake;
    const diff = writeFront(db, task, { ...(hasWhy ? { unplaced: why } : {}), wake, updated: c.at }, TASK_KEYS);
    if (diff.wake) diff.wake = [old ? wakeWords(db, old) : null, wakeWords(db, wake)];
    const note = (why ? 'unplaced: ' + why + '; ' : '') + 'wakes ' + wakeWords(db, wake);
    logLine(db, { at: c.at, verb: 'edit', kind: 'task', rec: headOf(task), changes: { ...diff, ...(was ? { track: [was.track, null] } : {}) }, by: c.by, pc: c.pc, note });
    return { ...(why ? { unplaced: why } : {}), wake: wakeWords(db, wake) };
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

/* ---- the tier ladder --------------------------------------------------- */

/* A filing names the nearest tier that holds the work and that tier's answer; the board fills what it
   can compute and refuses a tier that does not fit with the call that does, as data. Nothing lands by default. */
const TIER_CALL = {
  0: ['fix', 'tier 0 is a plain defect in the work in hand with one right fix: fix it this turn and file nothing'],
  1: ['check', 'tier 1 is a step on the task whose worker will do it, in hand or not (`' + CLI + ' check add T-n --text "<the step>"`)'],
  5: ['ask', "tier 5 is the user's call: a question (ask, with gates naming the task when one exists), and the turn that gets the answer places the work"],
};
const TIER_RUNGS = '2 the track you hold, 3 another track in the workstream or a parked one an event opens, 4 another workstream or project';
const DAY_WAKE = /^\s*\d{4}-\d{2}-\d{2}\s*$/;
const UNPARK_FORMS = '<track-ends TR-n | task-completes T-n | question-answered Q-n>';
const isGiven = (v) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length);
const oneLineOf = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
/* an offer names only what its verb takes: words that are no park event (next-session, a day) offer the event forms */
const PARK_EVENT = /^(?:track-ends|task-completes|question-answered) \S+$/i;
const eventLine = (v) => (typeof v === 'string' && PARK_EVENT.test(oneLineOf(v)) ? oneLineOf(v) : UNPARK_FORMS);
const inboxWakeLine = (v) => (typeof v === 'string' && DAY_WAKE.test(v) ? v.trim() : eventLine(v) !== UNPARK_FORMS ? oneLineOf(v) : '<' + WAKE_FORMS + '>');
/* next-session waits on a track: the held one at tier 2, another at tier 3 */
/* the held track's pair for a next-session filing keeps the wake, so the offer sent as printed still waits */
const heldNext = (id, wake) => heldOffers(id).map((o) => (isNextSession(wake) ? { ...o, wake: NEXT_SESSION } : o));
const nextOffers = (heldRec) => [...(heldRec ? heldOffers(heldRec.fields.id).map((o) => ({ ...o, wake: NEXT_SESSION })) : []), { call: 'place', tier: 3, track: 'TR-n', wake: NEXT_SESSION }];
/* an offer's line sent as written still holds its <...> template, which says nothing about the work */
const unfilled = (line) => line.split(';').some((s) => /^<[^<>]*>$/.test(s.trim()));
const TEMPLATE_WORDS = "; the line you sent is the offer's template in angle brackets, so say it in your own words";

/* a leftover or a layout step sends the offer as its own fields, never as flags */
const fieldWords = (o) => ['tier ' + o.tier, ...['track', 'workstream', 'unparkWhen', 'wake'].filter((k) => o[k]).map((k) => k + ' "' + o[k] + '"'),
  ...(o.before ? ['before ["' + o.before + '"]'] : []), ...(o.last ? ['last "' + o.last + '"'] : []), ...(o.whyElsewhere ? ['whyElsewhere "' + o.whyElsewhere + '"'] : [])].join(', ');
const offerWords = (o) => (o.call === 'ask' ? "ask the user, since no open track here shares the work's words"
  : 'tier ' + o.tier + (o.track ? ' with track ' + o.track : '') + (o.workstream && !o.track ? ' in ' + o.workstream : '') + (o.unparkWhen ? ' with unparkWhen ' + o.unparkWhen : '')
    + (o.wake ? ' with wake ' + o.wake : '') + (o.before ? ' with before ' + o.before : '') + (o.last ? ' with last, a last resort' : '') + (o.whyElsewhere ? ' with the line on why the held track does not cover it' : '') + ' (' + (o.step ? "the step's fields: " + fieldWords(o) : o.flags) + ')');
function ladderRefusal(cause, offers, step = false, tail = '') {
  const list = offers.map((o) => offerOf(step && o.call === 'place' ? { ...o, step: true } : o));
  return new TrackRefusal(cause + ". The board's answer: " + list.map(offerWords).join('; or ') + '.' + (tail ? ' ' + tail : ''), { offer: list[0], offers: list, ...(tail ? { path: tail } : {}) });
}

/* The board's hint as the call that fits (found.mjs offersOfHint). */
function hintOffers(db, f, c, heldRec, wsKey) {
  const s = suggestTrack(db, { name: f.name, description: f.description, intent: f.intent, labels: f.labels, workstream: wsKey || null }, c.session);
  const offers = offersOfHint(db, s, { held: heldRec ? heldRec.key : null, ownWs: heldRec ? heldRec.fields.workstream : null });
  /* a parked track goes in a workstream: name the one known, else the offer is only ask */
  return offers.flatMap((o) => (heldRec || o.call !== 'place' || o.track || o.workstream || !o.unparkWhen ? [o] : wsKey ? [{ ...o, workstream: labelOf(db, wsKey) }] : []));
}

/* The tier a filing's own answer points at, for the refusal of a session's filing that names none. */
function answerOffers(db, f, c, heldRec, wsKey) {
  if (isGiven(f.track)) {
    const t = recordOf(db, String(f.track).trim(), 'track');
    const next = isNextSession(f.wake) ? { wake: NEXT_SESSION } : {};
    if (heldRec && t.key === heldRec.key) return heldOffers(heldRec.fields.id).map((o) => ({ ...o, ...next }));
    const away = heldRec && t.fields.workstream !== heldRec.fields.workstream;
    return [{ call: 'place', tier: away ? 4 : 3, track: t.fields.id, ...(away ? { workstream: labelOf(db, t.fields.workstream) } : {}), ...next }];
  }
  if (isGiven(f.unparkWhen)) return [{ call: 'place', tier: 3, unparkWhen: eventLine(f.unparkWhen) }];
  if (isGiven(f.wake)) {
    const own = heldRec && (!wsKey || wsKey === heldRec.fields.workstream);
    if (isNextSession(f.wake)) return nextOffers(own ? heldRec : null);
    if (own && DAY_WAKE.test(String(f.wake))) return [{ call: 'place', tier: 2, wake: String(f.wake).trim() }];
    /* in the held track's workstream an event is a parked track it opens, or a step on the held track it ends */
    if (own) return ownTrackLacks(db, f.wake, c.session) ? heldOffers(heldRec.fields.id) : [{ call: 'place', tier: 3, unparkWhen: eventLine(f.wake) }];
    return [{ call: 'place', tier: 4, workstream: wsKey ? labelOf(db, wsKey) : 'WS-n', wake: inboxWakeLine(f.wake) }];
  }
  return heldRec ? heldOffers(heldRec.fields.id) : hintOffers(db, f, c, heldRec, wsKey);
}

/* An inbox filing that lacks its reason or wake: the ladder's calls, the held pair first, each line past the held track asked for */
function inboxWays(db, heldRec, wsKey, wake, at) {
  const why = heldRec ? { whyElsewhere: '<why ' + heldRec.fields.id + ' does not cover it>' } : {};
  const given = typeof wake === 'string' && wake ? wake : null;
  /* the held track's own workstream takes inbox work at tier 2, with a date wake only */
  const inbox = heldRec && heldRec.fields.workstream === wsKey ? { call: 'place', tier: 2, wake: given && DAY_WAKE.test(given) ? given.trim() : '<YYYY-MM-DD>' }
    : { call: 'place', tier: 4, workstream: labelOf(db, wsKey), wake: inboxWakeLine(given), ...why };
  return [...(heldRec ? heldOffers(heldRec.fields.id) : []), { call: 'place', tier: 3, track: 'TR-n', ...why }, { call: 'place', tier: 3, unparkWhen: UNPARK_FORMS, ...why }, inbox];
}

/* The ladder's place for a filing `f`(tier and its answer: track, workstream, before, after, unplaced, wake, newTrack,
   unparkWhen; name and words for the hint). `at`: via, task (an existing T-n), taskWs, unplaced (an inbox task's reason), marked (a filing
   that names its tier or is refused), free (let through: the talk filing), skip (keys nothing-else-open leaves out), laterReal (a later
   step of the same call with a real place waits on it), chain (the T-n ids a step waits through, its earlier steps' included).
   Null when no tier is named and none is owed; else { tier, track | inbox | park, before, after, filled, tell, whyElsewhere, ask }.
   `ask` marks a filing the board asks the user about rather than files ({ reason }). */
export function ladderPlace(db, f, c, at = {}) {
  const lad = ladderRung(db, f, c, at);
  const heldRec = lad ? policedHeld(db, c) : null;
  if (!lad || !heldRec) return lad;
  const id = heldRec.fields.id;
  const given = isGiven(f.whyElsewhere) ? oneLineOf(f.whyElsewhere) : '';
  const stub = Boolean(given) && unfilled(given);
  const line = stub ? '' : given;
  const free = Boolean(f[APPROVED]) || Boolean(at.free);
  /* read only where a question would be asked */
  const switched = () => (free ? null : bypassFor(db, c, heldRec));
  const onHeld = lad.track && lad.track.key === heldRec.key && !lad.nextSession;
  /* a move inside the held track is no filing */
  if (onHeld && at.task) {
    const e = resolveRecord(db, String(at.task).trim(), { kinds: ['task'] });
    if (e && db.stmt('SELECT 1 FROM track_items WHERE track = ? AND task = ?').get(heldRec.key, e.key)) return lad;
  }
  if (onHeld) {
    const real = realBefore(db, heldRec, f.before, f.after) || Boolean(at.laterReal);
    if (free) return { ...lad, approved: true };
    /* a last the caller sends stays its ask of the user, at the end too */
    if (real || nothingElseOpen(db, heldRec.key, at.skip) || (!isGiven(f.last) && endOfTrack(db, heldRec.key, taskKeysOf(db, at.chain || f.after), at.skip))) return lad;
    const held = switched();
    if (held) return { ...lad, approved: true, bypass: true };
    const said = typeof f.last === 'string' ? oneLineOf(f.last) : '';
    if (said && !unfilled(said)) return { ...lad, ask: { reason: said } };
    /* a blank before and blank last stays refused; a before of the closing review alone is last */
    throw ladderRefusal((isGiven(f.last) ? 'last says in one line why nothing on ' + id + ' needs the task sooner' + (said ? TEMPLATE_WORDS : '')
      : isGiven(f.before) ? 'before names only the closing review of ' + id + ', which is last: say last with why nothing on ' + id + ' needs it sooner'
        : 'A step on ' + id + ', ' + youHold(heldRec) + ', names before: the tasks on it that must not finish without this one (a step after the work at its end, which nothing there follows, needs none)')
      + '. Only when nothing on ' + id + ' needs it sooner does it say last, with that line, and last is asked of the user with here, the real place it would otherwise take when a task there waits on it',
    heldNext(id, undefined), at.via === 'leftover');
  }
  if (free) return { ...lad, approved: true, ...(line ? { whyElsewhere: line } : {}) };
  const off = switched();
  if (off) return { ...lad, approved: true, bypass: true, ...(line ? { whyElsewhere: line } : {}) };
  /* a later session on the held track is asked; its reason is last's line or the why line, and a blank keeps the pair */
  if (lad.nextSession && lad.track && lad.track.key === heldRec.key) {
    const said = typeof f.last === 'string' ? oneLineOf(f.last) : '';
    const reason = said && !unfilled(said) ? said : line;
    if (reason) return { ...lad, ...(line ? { whyElsewhere: line } : {}), ask: { reason } };
    throw ladderRefusal('A step for a later session on ' + id + ', ' + youHold(heldRec) + ', says last with why nothing on ' + id + ' needs it sooner' + (said || stub ? TEMPLATE_WORDS : '')
      + ', and it is asked of the user with here, the real place it would otherwise take when a task there waits on it', heldNext(id, f.wake), at.via === 'leftover');
  }
  /* the same filing sent again with its line, beside the held track's pair; each surface words it */
  const again = (why) => ({ call: 'place', tier: lad.tier, ...Object.fromEntries(['track', 'workstream', 'unparkWhen', 'wake'].filter((k) => isGiven(f[k])).map((k) => [k, oneLineOf(f[k])])), whyElsewhere: why });
  const fits = (why) => [...heldNext(id, f.wake), again(why)];
  /* work put past the held track says why that track does not cover it; the reason the question shows */
  const reason = line || (lad.inbox && lad.tier === 2 ? oneLineOf(lad.inbox.unplaced) : '');
  if (!reason) {
    throw ladderRefusal(id + ' is ' + youHold(heldRec) + ', and a filing past it' + (lad.tier >= 3 ? ' at tier ' + lad.tier : '') + ' says in one line why ' + id
      + ' does not cover the work' + (stub ? TEMPLATE_WORDS : '') + '; work ' + id + ' covers goes on it', fits('<why ' + id + ' does not cover it>'), at.via === 'leftover', GO_PATH);
  }
  const when = lad.park ? lad.park.when : lad.inbox && !DAY_WAKE.test(String(lad.inbox.wake)) ? lad.inbox.wake : null;
  const own = when ? ownEvent(db, when, heldRec, at) : null;
  /* the second part follows a semicolon, so one stored line carries both */
  if (own && line.split(';').map((s) => s.trim()).filter(Boolean).length < 2) {
    throw ladderRefusal('This waits on ' + own + ', so its line also says why the work cannot start sooner, after a semicolon; work that can start now goes on ' + id,
      fits('<why ' + id + ' does not cover it>; <why it cannot start sooner>'), at.via === 'leftover');
  }
  return { ...lad, ...(line ? { whyElsewhere: line } : {}), ask: { reason } };
}

/* The held track's own event a filing waits on, in words: its end, one of its tasks done, one of its questions
   answered (its track, or a task of it gated). A leftover's "task-completes 2" is its step 2, own at tier 2. */
function ownEvent(db, when, heldRec, at) {
  const m = /^\s*(track-ends|task-completes|question-answered)\s+(\S+)\s*$/i.exec(String(typeof when === 'object' && when ? when.kind + ' ' + when.on : when));
  if (!m) return null;
  const kind = m[1].toLowerCase();
  const id = heldRec.fields.id;
  if (kind === 'task-completes' && /^\d+$/.test(m[2])) {
    const s = Array.isArray(at.steps) ? at.steps[Number(m[2]) - 1] : null;
    return s && Number(s.tier) === 2 && !isGiven(s.wake) ? 'step ' + m[2] + ' of these leftovers, on ' + id : null;
  }
  const e = resolveRecord(db, m[2].trim(), { kinds: [{ 'track-ends': 'track', 'task-completes': 'task', 'question-answered': 'question' }[kind]] });
  if (!e) return null;
  if (kind === 'track-ends') return e.key === heldRec.key ? 'the end of ' + id : null;
  const onHeld = (k) => Boolean(db.stmt('SELECT 1 FROM track_items WHERE track = ? AND task = ?').get(heldRec.key, k));
  if (kind === 'task-completes') return onHeld(e.key) ? e.label + ', a task of ' + id : null;
  const gates = Array.isArray(e.front.gates) ? e.front.gates : [];
  return e.front.track === heldRec.key || gates.some(onHeld) ? e.label + ', a question of ' + id : null;
}

function ladderRung(db, f, c, at = {}) {
  const heldLease = c.session ? policedLease(db, c.session) : null;
  const heldRec = heldLease ? lastHeld(loadRecord(db, heldLease.track), heldLease) : null;
  /* an offer past the held track carries its why line (the filing's own, else the template), so it costs no extra round */
  const sent = isGiven(f.whyElsewhere) ? oneLineOf(f.whyElsewhere) : '';
  const whyLine = heldRec && !isUserCall(c) ? (sent && !unfilled(sent) ? sent : '<why ' + heldRec.fields.id + ' does not cover it>') : '';
  const past = (o) => (whyLine && o.call === 'place' && o.tier >= 3 && !o.whyElsewhere ? { ...o, whyElsewhere: whyLine } : o);
  const refuse = (cause, offers) => ladderRefusal(cause, offers.map(past), at.via === 'leftover');
  /* a next-session filing's offers keep its wake on the track they name */
  const nextOn = (o) => (isNextSession(f.wake) && o.call === 'place' && o.track ? { ...o, wake: NEXT_SESSION } : o);
  const wsRef = isGiven(f.workstream) ? resolveRecord(db, String(f.workstream).trim(), { kinds: ['workstream'] }) : null;
  if (isGiven(f.workstream) && !wsRef) throw new TrackRefusal('no workstream ' + f.workstream);
  const wsKey = wsRef ? wsRef.key : at.taskWs || null;
  if (!isGiven(f.tier)) {
    if (!(at.marked && c.session) || isUserCall(c)) return null;
    /* a named track is a place call's tier: the held one 2, another 3, another workstream's 4 */
    const named = heldRec && isGiven(f.track) ? openTrack(db, String(f.track).trim()) : null;
    if (named) return ladderRung(db, { ...f, tier: named.key === heldRec.key ? 2 : named.fields.workstream === heldRec.fields.workstream ? 3 : 4 }, c, at);
    throw refuse("A session's filing names its tier, the nearest rung of the ladder that holds the work (" + TIER_RUNGS
      + '); work for a task\'s own worker is a step on that task, and what only the user can decide or do is a question', answerOffers(db, f, c, heldRec, wsKey));
  }
  const tier = Number(f.tier);
  if (!Number.isInteger(tier) || tier < 0 || tier > 5) throw new TrackRefusal('tier is a rung of the ladder: ' + TIER_RUNGS);
  if (TIER_CALL[tier]) throw new TrackRefusal(TIER_CALL[tier][1], { tier, offer: { call: TIER_CALL[tier][0] }, offers: [{ call: TIER_CALL[tier][0] }] });
  const T = isGiven(f.track) ? openTrack(db, String(f.track).trim()) : null;
  const wake = isGiven(f.wake) ? (typeof f.wake === 'string' ? f.wake.trim() : f.wake) : undefined;
  const dated = wake !== undefined && DAY_WAKE.test(String(wake));
  /* an inbox task's wake edit keeps the reason it holds (`at.unplaced`) when the call names none */
  const why = isGiven(f.unplaced) ? oneLineOf(f.unplaced) : wake !== undefined && isGiven(at.unplaced) ? oneLineOf(at.unplaced) : undefined;
  const edges = isGiven(f.before) || isGiven(f.after);
  const later = isGiven(f.newTrack) || isGiven(f.unparkWhen);
  const out = { tier, named: true, existing: isGiven(at.task), before: f.before, after: f.after, last: f.last, filled: [] };
  const own = heldRec ? heldRec.fields.workstream : null;
  const inbox = (ws) => {
    if (edges) throw new TrackRefusal('before and after order steps on a track, and an inbox task has none around it');
    const ways = (keep = true) => inboxWays(db, heldRec, ws, keep ? wake : undefined, at);
    if (dated && !why) throw refuse('A date wake says why that day in unplaced; work that waits on an event names the event instead', ways());
    const where = { via: at.via, task: at.task || null, workstream: labelOf(db, ws), tier };
    const lacks = inboxLacks(why || 'filed at tier ' + tier, wake, where);
    if (lacks) throw refuse(lacks, ways());
    const end = ownEndOf(db, wake, c.session);
    if (end) throw refuse(ownEndCause(end), heldOffers(end));
    /* a wake that has fired or names nothing is refused here, so its way out rides the offers */
    try { wakeOf(db, wake, c.day, null, 'ladder'); } catch (e) {
      if (e instanceof TrackRefusal) throw refuse(e.message.replace(/[.\s]+$/, ''), ways(false));
      throw e;
    }
    return { ...out, inbox: { ws, unplaced: why, wake } };
  };
  if (tier === 2) {
    if (later) throw refuse('newTrack and unparkWhen make a parked track, which is tier 3', [{ call: 'place', tier: 3, unparkWhen: eventLine(f.unparkWhen) }]);
    /* an approved placement names the track it was asked for, which the filing session may hold no more */
    if (!heldRec && c.session && !(f[APPROVED] && T)) {
      const hints = hintOffers(db, f, c, null, wsKey);
      /* a next-session step keeps its wake on the track it goes to */
      const offers = !isNextSession(wake) ? hints : [...hints.filter((o) => o.tier === 3 && o.track).map((o) => ({ ...o, wake: NEXT_SESSION })), ...nextOffers(null)];
      throw refuse('Tier 2 is a step on the track you hold, and this session holds none', offers);
    }
    if (heldRec && T && T.key !== heldRec.key) {
      throw refuse(T.fields.id + ' is not ' + youHold(heldRec) + ' (' + heldRec.fields.id + ')', [nextOn({ call: 'place', tier: T.fields.workstream === own ? 3 : 4, track: T.fields.id }), ...heldNext(heldRec.fields.id, wake)]);
    }
    const home = heldRec || T;
    /* a step that waits for the next session stays on the track, waiting until another session takes it */
    if (isNextSession(wake)) {
      if (!c.session) throw new TrackRefusal('wake next-session waits for a session other than the one that files it, and this call names no session: file it with --session <own id>, or with no wake');
      if (why) throw new TrackRefusal('wake next-session keeps the step on ' + (home ? home.fields.id : 'its track') + ', and unplaced is for the inbox: leave out unplaced');
      return { ...out, track: home, filled: T ? [] : ['track'], nextSession: true };
    }
    if (wake !== undefined) {
      if (!dated) {
        throw refuse('Tier 2 is a step on ' + youHold(heldRec) + ', and an event is no place on it: the step waits on the event\'s task with after, or work that starts after the event is tier 3',
          [{ call: 'place', tier: 3, unparkWhen: eventLine(wake) }, ...(heldRec ? heldOffers(heldRec.fields.id) : [{ call: 'place', tier: 2 }])]);
      }
      const ws = home ? home.fields.workstream : wsKey;
      if (!ws) throw new TrackRefusal('a tier 2 inbox task goes in the workstream of ' + youHold(heldRec) + ', and this call names none');
      return inbox(ws);
    }
    if (why) throw new TrackRefusal('unplaced goes with a date wake on tier 2 (the inbox, due on that day); with no wake the step goes on the track' + (home ? ' ' + home.fields.id : ''));
    if (!home) throw new TrackRefusal('tier 2 is a step on the track the filing session holds, and this call carries no session: name the track it goes on (--track TR-n)');
    return { ...out, track: home, filled: T ? [] : ['track'] };
  }
  if (tier === 3) {
    /* next-session onto another track waits there as on the held one, due at another session's take */
    const next = isNextSession(wake);
    if (next && why) throw new TrackRefusal('wake next-session keeps the step on its track, and unplaced is for the inbox: leave out unplaced');
    if ((wake !== undefined && !next) || why) {
      throw refuse('Tier 3 goes on a track or on a parked one an event opens, never the inbox', [{ call: 'place', tier: 3, unparkWhen: eventLine(wake) }]);
    }
    if (next && later) {
      throw refuse('A parked track waits on its own event (unparkWhen) and opens when it comes, so it takes no wake: leave out wake, or put the work on an open track with wake next-session',
        [{ call: 'place', tier: 3, unparkWhen: eventLine(f.unparkWhen) }, ...nextOffers(heldRec)]);
    }
    if (next && !T) throw refuse('wake next-session waits on a track, and this filing names none', nextOffers(heldRec));
    if (T) {
      if (later) throw new TrackRefusal('tier 3 names a track or the event that opens a parked one, not both');
      if (heldRec && T.key === heldRec.key) throw refuse(T.fields.id + ' is ' + youHold(heldRec) + ', so the step is tier 2', next ? nextOffers(heldRec).filter((o) => o.tier === 2) : heldOffers(T.fields.id));
      const mine = own || (wsRef && wsRef.key);
      if (mine && T.fields.workstream !== mine) {
        throw refuse(T.fields.id + ' is in ' + labelOf(db, T.fields.workstream) + ', another workstream, so it is tier 4', [nextOn({ call: 'place', tier: 4, track: T.fields.id, workstream: labelOf(db, T.fields.workstream) })]);
      }
      if (next && !c.session) throw new TrackRefusal('wake next-session waits for a session other than the one that files it, and this call names no session: file it with --session <own id>, or with no wake');
      return { ...out, track: T, tell: true, ...(next ? { nextSession: true } : {}) };
    }
    if (isGiven(f.unparkWhen)) {
      if (edges) throw new TrackRefusal('before and after order steps on a track: a new parked track holds this step alone');
      const ws = own || wsKey;
      const when = typeof f.unparkWhen === 'string' ? f.unparkWhen.trim() : f.unparkWhen;
      if (!ws) throw refuse('A parked track goes in a workstream, and this filing names none', [{ call: 'place', tier: 3, unparkWhen: eventLine(when), workstream: 'WS-n' }]);
      /* a leftover's "task-completes 2" names a step of its own call, read once every step is laid */
      if (!(at.via === 'leftover' && /^\s*task-completes\s+\d+\s*$/i.test(String(when)))) unparkWhenOf(db, when);
      return { ...out, park: { ws, name: isGiven(f.newTrack) ? oneLineOf(f.newTrack) : null, when }, filled: isGiven(f.newTrack) ? [] : ['newTrack'] };
    }
    if (isGiven(f.newTrack)) throw new TrackRefusal('newTrack names a parked track, and unparkWhen is the event that opens it: name both');
    throw refuse('Tier 3 names the track (track) or the event that opens a parked one (unparkWhen), and this filing names neither', hintOffers(db, f, c, heldRec, own || wsKey));
  }
  /* tier 4 */
  const W = wsRef || (T ? resolveRecord(db, T.fields.workstream, { kinds: ['workstream'] }) : null);
  if (!W) throw refuse('Tier 4 names the workstream the work goes to', hintOffers(db, f, c, heldRec, null));
  if (T && T.fields.workstream !== W.key) throw new TrackRefusal(T.fields.id + ' is in ' + labelOf(db, T.fields.workstream) + ', not ' + W.label);
  if (W.front.status !== 'open') throw refuse(W.label + ' is ' + W.front.status + ', and no kickoff lists a closed workstream\'s inbox', [{ call: 'ask' }]);
  if (own && W.key === own) {
    const held = isNextSession(wake) ? nextOffers(heldRec).filter((o) => o.tier === 2) : heldOffers(heldRec.fields.id);
    throw refuse(W.label + ' is the workstream of ' + youHold(heldRec) + ', so the work is tier 2 or 3', [...held, ...(T ? [nextOn({ call: 'place', tier: 3, track: T.fields.id })] : [])]);
  }
  if (later) throw refuse('A parked track for another workstream is filed there; from here tier 4 names its track or the event that wakes it in its inbox', [{ call: 'place', tier: 4, workstream: W.label, wake: eventLine(f.unparkWhen) }]);
  /* next-session waits on another workstream's track as at tiers 2 and 3 (an implementation choice, no ruling); the inbox still refuses it */
  const next = isNextSession(wake);
  if (next && why) throw new TrackRefusal('wake next-session keeps the step on its track, and unplaced is for the inbox: leave out unplaced');
  if (T && ((wake !== undefined && !next) || why)) throw new TrackRefusal('tier 4 names a track in ' + W.label + ' or the wake for its inbox, not both');
  if (T) {
    if (next && !c.session) throw new TrackRefusal('wake next-session waits for a session other than the one that files it, and this call names no session: file it with --session <own id>, or with no wake');
    return { ...out, track: T, tell: true, ...(next ? { nextSession: true } : {}) };
  }
  if (next) {
    throw refuse('wake next-session waits on a track, and this filing names none in ' + W.label,
      [...hintOffers(db, f, c, heldRec, W.key).filter((o) => o.track).map(nextOn), { call: 'place', tier: 4, workstream: W.label, track: 'TR-n', wake: NEXT_SESSION }]);
  }
  if (wake !== undefined) return inbox(W.key);
  throw refuse('Tier 4 names a track in ' + W.label + ' or the event that wakes the work in its inbox (wake), and this filing names neither',
    [...hintOffers(db, f, c, heldRec, W.key).filter((o) => o.track), { call: 'place', tier: 4, workstream: W.label, wake: UNPARK_FORMS }]);
}

/* The tier a filing that named none took, from where it landed: the held track 2, another track 3 (4 in
   another workstream than the held track's), the inbox 2 in the held track's workstream and 4 elsewhere. */
export function landedTier(db, taskKey, session) {
  const held = session ? policedLease(db, session) : null;
  const heldWs = held ? (loadRecord(db, held.track) || { fields: {} }).fields.workstream : null;
  const row = db.stmt('SELECT track FROM track_items WHERE task = ?').get(taskKey);
  if (row && held && row.track === held.track) return 2;
  const ws = row ? (loadRecord(db, row.track) || { fields: {} }).fields.workstream : (loadRecord(db, taskKey) || { fields: {} }).fields.workstream;
  if (row) return heldWs && ws !== heldWs ? 4 : 3;
  return heldWs && ws === heldWs ? 2 : 4;
}

/* The ladder's place onto a task that exists: a track with its edges, a workstream's inbox with its wake,
   or a new track parked until its event. */
export function landPlace(db, taskKey, lad, actor) {
  const c = ctx(actor);
  if (lad.track) return placeTask(db, taskKey, { track: lad.track.fields.id, before: lad.before, after: lad.after }, actor);
  let task = loadRecord(db, taskKey);
  if (lad.inbox) {
    if (task.fields.workstream !== lad.inbox.ws) {
      const diff = writeFront(db, task, { workstream: lad.inbox.ws, updated: c.at }, TASK_KEYS);
      logLine(db, { at: c.at, verb: 'edit', kind: 'task', rec: headOf(task), changes: diff, by: c.by, pc: c.pc, note: 'to the inbox of ' + labelOf(db, lad.inbox.ws) + ' at tier ' + lad.tier });
    }
    const onTrack = db.stmt('SELECT 1 FROM track_items WHERE task = ?').get(taskKey);
    /* a task leaving a track takes a reason with its wake; tier 4 asks none, so the board says what it is */
    const why = lad.inbox.unplaced || (onTrack || !task.fields.unplaced ? 'filed at tier ' + lad.tier + ' into the inbox of ' + labelOf(db, lad.inbox.ws) + ' until its wake' : undefined);
    return placeTask(db, taskKey, { ...(why ? { unplaced: why } : {}), wake: lad.inbox.wake }, actor);
  }
  const rec = makeTrack(db, { name: lad.park.name || task.fields.name, workstream: lad.park.ws }, c);
  putOnTrack(db, task, rec, c);
  const r = parkTrack(db, { track: rec.key, reason: 'work that starts later, filed at tier ' + lad.tier, unparkWhen: lad.park.when }, actor);
  return { track: rec.fields.id, parked: true, unpark: r.unpark || r.unparkWhen || null };
}

/* The new track a leftover names, made once per name in the workstream it was left in; made
   with no lease, so the session keeps the track it holds. */
export function laterTrack(db, workstream, fresh, named, when, at, actor) {
  if (typeof named !== 'string' || !named.trim() || /[\r\n]/.test(named)) throw new TrackRefusal(at + 'newTrack is the new track\'s name, one line');
  const k = named.replace(/\s+/g, ' ').trim().toLowerCase();
  const had = fresh.get(k);
  const said = typeof when === 'string' && when.trim() ? when.trim() : null;
  if (had) {
    if (said && said !== had.when) throw new TrackRefusal(at + 'unparkWhen differs from the one ' + had.rec.fields.id + ' takes (' + had.when + ')');
    return had.rec;
  }
  if (!said) throw new TrackRefusal(at + 'a new parked track needs its unparkWhen: "track-ends TR-n", "task-completes T-n" (or a leftover\'s number) or "question-answered Q-n"');
  if (!workstream) throw new TrackRefusal(at + 'a new track goes in a workstream, and this one names none');
  const rec = makeTrack(db, { name: named.replace(/\s+/g, ' ').trim(), workstream }, actorOf(actor));
  fresh.set(k, { rec, when: said, at });
  return rec;
}

/* a session's filing onto the track it holds names its before, or says last with why nothing on
   the track needs it sooner, so a blank never parks work behind everything else. The line, or null when not asked. */
function lastLine(db, trackKey, ask, actor, taskKey) {
  const c = ctx(actor);
  const line = typeof ask.last === 'string' ? oneLineOf(ask.last) : '';
  /* an approved placement or a talk filing was asked already: the user chose its place, and its line is kept */
  if (ask.approved) return line && !unfilled(line) ? line : null;
  const held = c.session && !isUserCall(c) ? policedLease(db, c.session) : null;
  if (!held || held.track !== trackKey) return null;
  if (line && !unfilled(line)) return line;
  /* with nothing else open there is no order to be last in */
  const skip = new Set([taskKey, ...(ask.skip || [])]);
  if (!isGiven(ask.last) && (nothingElseOpen(db, trackKey, skip) || endOfTrack(db, trackKey, [taskKey], skip))) return null;
  const id = labelOf(db, trackKey);
  throw ladderRefusal((isGiven(ask.last) ? 'last says in one line why nothing on ' + id + ' needs the task sooner' + (line ? TEMPLATE_WORDS : '') : 'A step on ' + id + ', ' + youHold(held) + ', names before: the tasks on it that must not finish without this one (a step after the work at its end, which nothing there follows, needs none)')
    + '. Only when nothing on ' + id + ' needs it sooner does it say last, with that line; last is a last resort, since a task filed last waits until the track runs out of other work',
  heldNext(id, ask.nextSession ? NEXT_SESSION : undefined), ask.step);
}

/* The default before (tier 2's answer is at least the closing review): the open review no other
   open review waits on, or once it has started or the step waits on it, the first open step after it. A wave's
   review holds it up like any step. None for a step an open task already waits on; `end` when nothing is left.
   `ask`: last (its line) and nextSession, which lastLine reads; a last goes behind the chain's ends (fileLast). */
export function defaultBefore(db, trackKey, taskKey, actor, ask = {}) {
  const task = loadRecord(db, taskKey);
  if (db.stmt(`SELECT 1 FROM depends d JOIN records r ON r.key = d.task WHERE d."on" = ? AND coalesce(r.status, '') NOT IN ('done', 'dropped') LIMIT 1`).get(taskKey)) return null;
  const said = lastLine(db, trackKey, ask, actor, taskKey);
  /* a later session's line is the reason it was asked, not a place: it keeps the default before */
  if (said && !ask.nextSession) return fileLast(db, trackKey, task, said, actor);
  const lastOf = said ? { last: said } : {};
  const { open, closing, stations, waits } = closingOf(db, trackKey, taskKey);
  if (!closing) return { end: true, ...lastOf };
  const target = closing.running || waits(taskKey, closing.key)
    ? open.find((o) => o !== closing && waits(o.key, closing.key) && !waits(o.key, taskKey) && !waits(taskKey, o.key)) : closing;
  if (!target) return { end: true, closing: closing.id, stations, ...lastOf };
  addEdge(db, { task: target.id, on: task.fields.id, reason: (said ? 'filed last (' + said + '): ' : 'the default before: ') + (target === closing ? 'the closing review' : 'the first step after the closing review ' + closing.id) }, actor);
  return { before: target.id, closing: closing.id, stations, ...lastOf };
}

/* The open tasks on a track but `taskKey`, its closing review (the open review no other open review waits on;
   a station the task comes after is never it while another is left) and the other reviews. */
function closingOf(db, trackKey, taskKey) {
  const open = db.stmt(`SELECT ti.task AS key, r.label AS id, ${openRunSql('r.key')} AS running, r.fields FROM track_items ti JOIN records r ON r.key = ti.task WHERE ti.track = ?
    AND ti.task <> ? AND coalesce(r.status, '') NOT IN ('done', 'dropped') ORDER BY ti.position`).all(trackKey, taskKey || '').map((r) => ({ ...r, f: JSON.parse(r.fields) }));
  const reviews = open.filter((r) => isReview(r.f));
  const waits = (a, b) => Boolean(a && b && pathBetween(db, a, b));
  const last = reviews.filter((r) => !reviews.some((o) => o !== r && pathBetween(db, o.key, r.key)));
  const closing = last.filter((r) => !waits(taskKey, r.key)).pop() || last.pop() || null;
  return { open, closing, stations: closing ? reviews.filter((r) => r !== closing).map((r) => r.id) : [], waits };
}

/* last is after every open task on the track nothing else there waits on (the chain's ends), and the
   closing review waits on it only when that review is itself the chain's end and not started. Read only;
   `taskKey` null for work not made yet. */
export function lastPlace(db, trackKey, taskKey = null) {
  const { open, closing, stations, waits } = closingOf(db, trackKey, taskKey);
  const keys = new Set(open.map((o) => o.key));
  const waiters = (k) => db.stmt('SELECT task FROM depends WHERE "on" = ?').all(k).map((r) => r.task).filter((t) => keys.has(t));
  const tail = closing && !closing.running && !waiters(closing.key).length && !waits(taskKey, closing.key) ? closing : null;
  const ends = open.filter((o) => o !== tail && !waiters(o.key).some((t) => !tail || t !== tail.key) && !waits(o.key, taskKey));
  return { closing, tail, ends, stations };
}

function fileLast(db, trackKey, task, said, actor) {
  const p = lastPlace(db, trackKey, task.key);
  const why = 'filed last (' + said + '): ';
  for (const e of p.ends) addEdge(db, { task: task.fields.id, on: e.id, reason: why + 'after the end of the chain' }, actor);
  /* an end that reaches the review off the track would make a loop: the review then stays where it is */
  const tail = p.tail && !pathBetween(db, task.key, p.tail.key) ? p.tail : null;
  if (tail) addEdge(db, { task: tail.id, on: task.fields.id, reason: why + 'the closing review' }, actor);
  return {
    ...(p.ends.length ? { after: p.ends.map((e) => e.id) } : {}), ...(tail ? { before: tail.id } : { end: true }),
    ...(p.closing ? { closing: p.closing.id } : {}), stations: p.stations, last: said,
  };
}

/* Up to three open tasks in the workstream sharing the new task's words, from the search index, so one that
   already covers it takes a note and the new one is dropped. */
function lookAlikes(db, task) {
  const words = [...wordsOf(task.fields.name)].slice(0, 8);
  if (!words.length) return [];
  const out = [];
  try {
    let seen = 0;
    for (const { key } of db.stmt('SELECT key FROM search WHERE search MATCH ? ORDER BY rank').iterate(words.map((w) => '"' + w + '"').join(' OR '))) {
      if (++seen > 60 || out.length >= 3) break;
      if (key === task.key || out.some((o) => o.key === key)) continue;
      const r = db.stmt('SELECT key, label, title, status, workstream, kind FROM records WHERE key = ?').get(key);
      if (r && r.kind === 'task' && r.workstream === (task.fields.workstream || null) && !ENDED_TASK.includes(r.status)) out.push({ key, id: r.label, name: r.title });
    }
  } catch { return []; }
  return out.map(({ key, ...o }) => o);
}

/* task edit --wake next-session alone: a task on a track waits until a session other than this one takes it. */
export function waitNextSession(db, taskKey, actor) {
  const c = ctx(actor);
  const task = loadRecord(db, taskKey);
  const row = db.stmt('SELECT track FROM track_items WHERE task = ?').get(taskKey);
  if (!row) throw new TrackRefusal('--wake next-session waits on a track, and ' + task.fields.id + ' is on none: place it first (`' + CLI + ' task edit ' + task.fields.id + ' --track TR-n`), or give the inbox a wake still to come (' + WAKE_FORMS + ')');
  if (!c.session) throw new TrackRefusal('--wake next-session waits for a session other than the one that sets it, and this call names no session: set it with --session <own id>');
  const wake = nextSessionWake(c);
  const old = task.fields.wake;
  const diff = writeFront(db, task, { wake, updated: c.at }, TASK_KEYS);
  diff.wake = [old ? wakeWords(db, old) : null, wakeWords(db, wake)];
  logLine(db, { at: c.at, verb: 'edit', kind: 'task', rec: headOf(task), changes: diff, by: c.by, pc: c.pc, note: 'waits on ' + labelOf(db, row.track) + ' for the next session' });
  return { wake: wakeWords(db, wake) };
}

/* After the place lands: the default before on a track, the note that tells the target track's holder (tiers 3
   and 4), and the tier stored with the activity line saying where it went. `opts.defaulted`: the layout already
   filled the before. Returns { tier, ladder } for the result. */
export function settlePlace(db, taskKey, lad, actor, opts = {}) {
  const c = ctx(actor);
  const task = loadRecord(db, taskKey);
  const row = db.stmt('SELECT track FROM track_items WHERE task = ?').get(taskKey);
  const tr = row ? loadRecord(db, row.track) : null;
  const d = !tr ? null : opts.defaulted !== undefined ? opts.defaulted : !isGiven(lad.before) && (lad.named || c.session) ? defaultBefore(db, tr.key, taskKey, actor, lad) : null;
  const filled = [...(lad.filled || []), ...(d && d.after ? ['after'] : []), ...(d && d.before ? ['before'] : [])];
  let told = null;
  if (tr && lad.tell) {
    const who = c.session ? sessionWords(db, c.session) : c.by;
    addNote(db, tr.key, { at: c.at, actor: c.by, body: task.fields.id + ' ' + oneLineOf(task.fields.name) + ' was filed here at tier ' + lad.tier + ' by ' + who + (d && d.before ? ', before ' + d.before : '') + '.' });
    told = tr.fields.id;
  }
  const where = tr ? 'on ' + tr.fields.id + (tr.fields.status === 'parked' ? ' (parked)' : '') + (d && d.after ? ', after ' + d.after.join(', ') : '') + (d && d.before ? ', before ' + d.before + (d.before === d.closing ? ', the closing review' : '') : d && d.end ? ', an end' + (isReview(task.fields) ? ', so the closing review' : '') : '') + (lad.nextSession ? ', waiting for the next session' : '')
    : 'in the inbox of ' + labelOf(db, task.fields.workstream) + (task.fields.wake ? ', wakes ' + wakeWords(db, task.fields.wake) : '');
  /* a tier is the filing session's rung: one derived never overwrites a stored tier, and none is derived with no session */
  const had = isGiven(task.fields.tier) ? task.fields.tier : undefined;
  const derive = !lad.named && c.session && had === undefined;
  const tier = lad.named || derive ? lad.tier : had;
  /* a later filing that needs no line clears the one an earlier outward filing left */
  const why = lad.named ? lad.whyElsewhere || undefined : task.fields.whyElsewhere;
  /* the line given with last is kept on the task, since an end has no edge to carry it; a later named filing clears it */
  const lastWhy = d && d.last ? { filedLast: d.last } : lad.named && task.fields.filedLast !== undefined ? { filedLast: undefined } : {};
  const next = lad.nextSession && tr ? { wake: nextSessionWake(c) } : {};
  const diff = lad.named || derive || d?.last || next.wake ? writeFront(db, task, { tier, ...(lad.named ? { whyElsewhere: why } : {}), ...lastWhy, ...next, updated: c.at }, TASK_KEYS) : {};
  if (diff.wake) diff.wake = [null, wakeWords(db, next.wake)];
  if (diff.tier || diff.whyElsewhere || diff.filedLast || diff.wake) logLine(db, { at: c.at, verb: 'edit', kind: 'task', rec: headOf(task), changes: diff, by: c.by, pc: c.pc, note: 'tier ' + tier + (lad.named ? '' : ' (derived from where it landed)') + ': ' + where });
  const ladder = {
    ...(tier !== undefined ? { tier } : {}), ...(derive ? { derived: true } : {}), ...(why ? { whyElsewhere: why } : {}), ...(tr ? { track: tr.fields.id, ...(tr.fields.goal ? { goal: tr.fields.goal } : {}) } : { inbox: labelOf(db, task.fields.workstream) }),
    ...(d && d.after ? { after: d.after } : {}), ...(d && d.before ? { before: d.before } : {}), ...(d && d.closing ? { closing: d.closing } : {}), ...(d && d.end ? { end: true } : {}), ...(d && d.last ? { last: d.last } : {}), ...(d && d.stations && d.stations.length ? { stations: d.stations } : {}),
    ...(filled.length ? { filled } : {}), ...(told ? { told } : {}), where,
  };
  /* look-alikes are for new work only: an existing task placed is not a duplicate to drop */
  if (lad.named && !lad.existing) {
    const alike = lookAlikes(db, task);
    if (alike.length) ladder.lookAlikes = alike;
  }
  return { ...(tier !== undefined ? { tier } : {}), ladder };
}

export function openTrack(db, ref) {
  const rec = trackRec(db, ref);
  if (CLOSED.includes(rec.fields.status)) throw new TrackRefusal(rec.fields.id + ' is ' + rec.fields.status);
  return rec;
}

/* a session's call that carries tasks off its held track is refused, naming the place call that asks for each. */
function carriesOff(db, tasks, c, verb) {
  const heldRec = policedHeld(db, c);
  if (!heldRec || !Array.isArray(tasks) || !tasks.length) return;
  const off = tasks.map((t) => recordOf(db, t, 'task')).filter((t) => db.stmt('SELECT 1 FROM track_items WHERE track = ? AND task = ?').get(heldRec.key, t.key));
  if (!off.length) return;
  if (bypassFor(db, c, heldRec)) return;
  const id = heldRec.fields.id;
  throw new TrackRefusal(verb + ' would carry ' + off.map((t) => t.fields.id).join(', ') + ' off ' + id + ', ' + youHold(heldRec) + ', and work leaves it only by the user\'s answer: make the track without --task, then place each, which asks the user ('
    + off.map((t) => '`' + CLI + ' task edit ' + t.fields.id + ' --tier 3 --track <the new TR-n> --why-elsewhere "<why ' + id + ' does not cover it>" --here-before <T-n on ' + id + '>`').join('; ') + '). ' + GO_PATH,
  { tasks: off.map((t) => t.fields.id) });
}

/* A new line of work; with a session, the session takes it. Labels and refs
   come at birth only (an import's label and row ref), as a task's do. */
export function newTrack(db, input, actor) {
  const name = needText(input && input.name, 'a track');
  const labels = strList(input.labels, 'labels');
  const refs = strList(input.refs, 'refs');
  return tx(db, () => {
    const c = ctx(actor);
    carriesOff(db, input.tasks, c, 'track new');
    const rec = makeTrack(db, {
      name, workstream: workstreamOf(db, input.workstream), goal: input.goal ? needText(input.goal, 'a goal') : undefined, labels, refs: refsFor(db, refs, c.day),
    }, c);
    for (const t of input.tasks || []) putOnTrack(db, recordOf(db, t, 'task'), rec, c);
    /* hold: false, the CLI with no --session: the call's session is policed but takes no lease */
    const session = input.hold === false ? '' : sessionOf(input, actor);
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
    carriesOff(db, input.tasks, c, 'track splinter');
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
    const session = input.hold === false ? '' : sessionOf(input, actor);
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
    AND coalesce(r.status, '') NOT IN ('done', 'dropped') ORDER BY ti.position`).all(sideKey).map((r) => r.task);
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
      name: input.name, description: input.description || 'Captured on ' + (track ? track.fields.id : labelOf(db, ws)) + '.', intent: input.intent, workstream: ws,
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
    /* a capture that names its tier is placed by the ladder */
    const had = input.task ? recordOf(db, input.task, 'task') : null;
    const talk = talkOf(db, input.question, input.words, c);
    /* a session holding a track names the tier of what it captures, so the board can ask */
    const skip = new Set(had ? [had.key] : []);
    const lad = ladderPlace(db, { ...input, ...(had ? { name: had.fields.name, labels: had.fields.labels } : {}) }, c,
      { via: input.task ? 'edit' : 'capture', task: had ? had.fields.id : null, taskWs: had ? had.fields.workstream : null, marked: isGiven(input.tier) || Boolean(policedHeld(db, c)), free: Boolean(talk), skip });
    if (lad && lad.ask) return { asked: askFiling(db, input, c, had ? { task: had.fields.id } : { draft: input }, { via: 'place', ...(had ? { task: had.fields.id } : {}) }, skip) };
    if (lad) {
      const home = lad.track ? null : labelOf(db, (lad.inbox || lad.park).ws);
      if (!had && lad.inbox) wakeOf(db, lad.inbox.wake, c.day, null, 'capture');
      const r = captureOn(db, lad.track || null, { ...input, workstream: home || input.workstream }, actor, c);
      const placed = landPlace(db, r.key, lad, actor);
      if (placed && placed.asked) return { ...r, ...placed };
      if (talk) settleTalk(db, talk, r.key, c);
      return { ...r, ...placed, track: placed.track || r.track, ...settlePlace(db, r.key, lad, actor) };
    }
    const track = input.track ? openTrack(db, input.track) : null;
    const why = typeof input.unplaced === 'string' && input.unplaced.trim() ? input.unplaced : null;
    const wake = input.wake === undefined || input.wake === null || input.wake === '' ? undefined : input.wake;
    if (track && (why || wake !== undefined)) throw new TrackRefusal('a capture goes on a track or stays unplaced with its wake, not both');
    const at = { via: input.task ? 'edit' : 'capture', task: input.task || null, workstream: input.workstream || null };
    if (!track && !why && c.session) {
      const ws = input.workstream ? workstreamOf(db, input.workstream) : null;
      throw new TrackRefusal(placeRefusal(input.task ? null : suggestTrack(db, { ...input, workstream: ws }, c.session), at));
    }
    const no = track ? null : inboxLacks(why, wake, at) || ownTrackLacks(db, wake, c.session, at);
    if (no) throw new TrackRefusal(no);
    /* a new capture's fired wake is refused before the task is made, so the way out names no id */
    if (!track && !input.task) wakeOf(db, wake, c.day, null, 'capture');
    const r = captureOn(db, track, input, actor, c);
    const placed = track ? null : placeTask(db, r.key, { ...(why ? { unplaced: why } : {}), wake }, actor);
    if (placed && placed.asked) return { ...r, ...placed };
    return { ...(placed ? { ...r, ...placed } : r), ...settlePlace(db, r.key, { tier: landedTier(db, r.key, c.session) }, actor) };
  });
}

/* a line of work's steps, in its words; the PC's check (lib/handoff-payload.mjs
   stepProblems) runs first, so these refusals only meet a caller that skipped it. */
const STEP_KEYS = ['name', 'task', 'after', 'before', 'last', 'description', 'priority', 'runBy', 'reviewScope', 'here', 'whyElsewhere'];
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
    WHERE ti.track = ? AND coalesce(r.status, '') NOT IN ('done', 'dropped') ORDER BY ti.position`).all(trackKey)
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
    const { asked, bypass } = placeLayout(db, track, steps, input, c);
    const laidFree = Boolean(input[LAID] && input[LAID].bypass);
    const out = [];
    const landed = [];
    steps.forEach((s, i) => stepped(i, s, () => {
      if (asked[i]) {
        out.push({ step: i + 1, name: s.name || s.task, asked: asked[i] });
        return;
      }
      const named = s.task === undefined ? openNamed(db, track.key, s.name) : null;
      const prior = named || s.task !== undefined ? db.stmt('SELECT track FROM track_items WHERE task = ?').get(named || keyOf(db, s.task.trim(), 'task')) : null;
      landed[i] = !prior || prior.track !== track.key;
      const r = captureOn(db, track, named ? { task: named } : s.task !== undefined ? { task: s.task.trim() }
        : { name: s.name.trim(), description: s.description, priority: s.priority }, actor, c);
      /* the step's runBy lands on its task, a matched one too, logged with the old value */
      const runBy = runByOf(s.runBy);
      if (runBy) editRecord(db, { id: r.key, kind: 'task', runBy }, actor);
      /* a review step's scope lands the same way */
      if (s.reviewScope !== undefined) editRecord(db, { id: r.key, kind: 'task', reviewScope: s.reviewScope }, actor);
      out.push({ step: i + 1, id: r.id, key: r.key, name: r.name, created: r.created, ...(runBy ? { runBy } : {}), ...(s.reviewScope !== undefined ? { reviewScope: s.reviewScope } : {}), edges: [] });
    }));
    steps.forEach((s, i) => stepped(i, s, () => {
      if (asked[i]) return;
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
    /* the default before, once the call's own edges are laid, for each step this call put on the track */
    if (c.session) {
      steps.forEach((s, i) => stepped(i, s, () => {
        const d = landed[i] && !(s.before || []).length ? defaultBefore(db, track.key, out[i].key, actor, { last: s.last, step: true, approved: laidFree || Boolean(bypass[i]), nextSession: Boolean(input.nextSession), skip: [...((input[LAID] && input.skip) || []), ...out.filter((o) => o && o.key).map((o) => o.key)] }) : null;
        if (d) out[i].default = d;
        if (!d || !d.last) return;
        const task = loadRecord(db, out[i].key);
        const diff = writeFront(db, task, { filedLast: d.last, updated: c.at }, TASK_KEYS);
        /* logged as settlePlace logs it, so the activity export carries the line too */
        if (diff.filedLast) logLine(db, { at: c.at, verb: 'edit', kind: 'task', rec: headOf(task), changes: diff, by: c.by, pc: c.pc, note: 'laid out on ' + track.fields.id + ', last' });
      }));
    }
    return { track: track.fields.id, key: track.key, steps: out };
  });
}

/* A layout from layLeftovers, which classified its one step already: never a request body's.
   Its value is { bypass }: whether a switch let that step through. */
export const LAID = Symbol('laid by leftovers');

/* For a layout: onto the held track with nothing else open it is laid whole; with work open there a step that
   lands is free at a real place and asked when last; onto another track each such step is asked. The questions by
   step index; a later step that waits on an asked one is refused, since nothing is made for it.
   `bypass`: whether a switch let a step through, by step index. */
function placeLayout(db, track, steps, input, c) {
  const none = { asked: [], bypass: [] };
  const heldRec = input[LAID] ? null : policedHeld(db, c);
  if (!heldRec) return none;
  const held = heldRec.key === track.key;
  if (held && nothingElseOpen(db, track.key)) return none;
  const keyOfStep = (s) => (s.task !== undefined ? keyOf(db, s.task.trim(), 'task') : openNamed(db, track.key, s.name));
  const lands = steps.map((s) => {
    const k = keyOfStep(s);
    const prior = k ? db.stmt('SELECT track FROM track_items WHERE task = ?').get(k) : null;
    return !prior || prior.track !== track.key;
  });
  const open = openOn(db, track.key);
  const closing = closingKeys(db, open);
  const waiting = (k) => open.some((r) => r.key === k) && !closing.has(k);
  const real = [];
  for (let i = steps.length - 1; i >= 0; i--) {
    const s = steps[i];
    real[i] = held && (lands[i] ? realBefore(db, heldRec, s.before, null, false) || steps.some((o, j) => j > i && (o.after || []).includes(i + 1) && real[j]) : waiting(keyOfStep(s)));
  }
  const tier = held ? 2 : track.fields.workstream === heldRec.fields.workstream ? 3 : 4;
  /* a step's after chain through the earlier steps it names by number, none of them made yet */
  const chain = [];
  steps.forEach((s, i) => { chain[i] = (s.after || []).flatMap((a) => (typeof a === 'string' ? [a] : Number.isInteger(a) && a >= 1 && a <= i ? chain[a - 1] : [])); });
  const asked = [];
  const bypass = [];
  steps.forEach((s, i) => stepped(i, s, () => {
    for (const a of s.after || []) if (Number.isInteger(a) && asked[a - 1]) throw new TrackRefusal('after names step ' + a + ', which is asked of the user (' + asked[a - 1].id + '), so nothing is made for it yet');
    if (!lands[i]) return;
    const f = { ...s, tier, track: track.fields.id, after: (s.after || []).filter((a) => typeof a === 'string') };
    const lad = ladderPlace(db, f, c, { via: 'layout', laterReal: real[i], chain: chain[i], ...(s.task !== undefined ? { task: s.task.trim() } : {}) });
    if (lad && lad.ask) asked[i] = askFiling(db, f, c, s.task !== undefined ? { task: s.task.trim() } : { draft: s }, { via: 'layout', step: i + 1 });
    else if (lad && lad.bypass) bypass[i] = true;
  }));
  return { asked, bypass };
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
    AND coalesce(r.status, '') NOT IN ('done', 'dropped') ORDER BY ti.position`).all(trackKey).map((r) => r.task);
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

/* A drop that would end a task with a step open is refused whole, naming each task and step. */
function stepsStop(db, tasks, what) {
  const held = tasks.map((t) => ({ id: t.id, steps: openSteps(db, t.key) })).filter((t) => t.steps.length);
  if (!held.length) return;
  throw new TrackRefusal('cannot ' + what + ': ' + held.map((t) => t.id + ' has open steps ' + t.steps.map((s) => s.n + '. ' + s.text).join('; ')).join(', and ')
    + '. Settle each step first (task update with checks.done or checks.strike), or place the task elsewhere', { openSteps: held });
}

/* a drop over another session's open run is refused whole, naming each run. */
function runsStop(db, tasks, what, c) {
  const held = tasks.map((t) => ({ id: t.id, runs: runsHolding(db, t.key, c.session) })).filter((t) => t.runs.length);
  if (!held.length) return;
  throw new TrackRefusal('cannot ' + what + ': ' + held.map((t) => heldWords(t.id, t.runs, c)).join(', and ')
    + '. Tell the user who runs it: that session finishes or lets it go, or the task is placed elsewhere first', { runs: held.map((t) => ({ id: t.id, runs: t.runs.map((r) => r.id) })) });
}

/* Open tasks stop a close unless they go to the inbox with a wake or are dropped with it. */
function settleLeftovers(db, rec, leftovers, c, why, status, wakeRaw) {
  const g = trackGraph(db, rec.key);
  if (!g.tasks.length) return [];
  if (leftovers !== 'inbox' && leftovers !== 'drop') {
    /* each open task with the board's call: another track, a parked one an event opens, or a question */
    const rows = withOffers(db, g.tasks.map((t) => ({ id: t.id, key: t.key, name: t.name })), { ownWs: rec.fields.workstream, exclude: rec.key });
    const lines = offerLines(rows);
    throw new TrackRefusal(rec.fields.id + ' still has ' + g.tasks.map((t) => t.id).join(', ') + ' open: finish them, place each elsewhere'
      + (lines.length ? " by the board's call below" : '') + ', or pass leftovers inbox (with a wake) or drop' + (lines.length ? ':\n' + lines.join('\n') : ''),
      { open: g.tasks.map((t) => t.id), offers: rows.filter((r) => r.offers).map((r) => ({ id: r.id, ...(r.line ? { line: r.line } : {}), offers: r.offers })) });
  }
  const at = { via: status === 'dropped' ? 'drop' : 'finish', track: rec.fields.id, workstream: rec.fields.workstream ? labelOf(db, rec.fields.workstream) : null };
  if (leftovers === 'inbox' && (wakeRaw === undefined || wakeRaw === null || wakeRaw === '')) {
    throw new TrackRefusal(inboxRefusal({ ...at, cause: g.tasks.map((t) => t.id).join(', ') + (g.tasks.length === 1 ? ' goes' : ' go') + ' to the inbox with no wake' }));
  }
  const wake = leftovers === 'inbox' ? wakeOf(db, wakeRaw, c.day, null, at.via, rec.fields.id) : undefined;
  const own = leftovers === 'inbox' ? ownTrackLacks(db, wakeRaw, c.session, { ...at, open: g.tasks.map((t) => t.id) }) : null;
  if (own) throw new TrackRefusal(own);
  if (leftovers === 'drop') stepsStop(db, g.tasks, 'drop ' + rec.fields.id + ' with its tasks');
  if (leftovers === 'drop') runsStop(db, g.tasks, 'drop ' + rec.fields.id + ' with its tasks', c);
  for (const t of g.tasks) {
    const task = loadRecord(db, t.key);
    if (leftovers === 'inbox') {
      db.stmt('DELETE FROM track_items WHERE task = ?').run(t.key);
      const old = task.fields.wake;
      const diff = writeFront(db, task, { wake, updated: c.at }, TASK_KEYS);
      if (diff.wake) diff.wake = [old ? wakeWords(db, old) : null, wakeWords(db, wake)];
      logLine(db, { at: c.at, verb: 'edit', kind: 'task', rec: headOf(task), changes: { track: [rec.key, null], ...diff }, by: c.by, pc: c.pc,
        note: 'to the inbox as ' + rec.fields.id + ' closed; wakes ' + wakeWords(db, wake) });
    } else {
      endTask(db, task, 'dropped', c, { changes: { updated: c.at }, note: why });
    }
  }
  return g.tasks.map((t) => t.id);
}

function closeTrack(db, input, actor, status) {
  const c = ctx(actor);
  const rec = trackRec(db, input.track);
  if (CLOSED.includes(rec.fields.status)) throw new TrackRefusal(rec.fields.id + ' is already ' + rec.fields.status);
  /* a track is not finished while a placement of its work waits on the user */
  const waits = placementsOpen(db, rec.key);
  if (waits.length) {
    throw new TrackRefusal(rec.fields.id + ' still waits on the user about where its work goes: ' + waits.join(', ') + (waits.length === 1 ? ' is' : ' are')
      + ' open. Leave the track open until ' + (waits.length === 1 ? 'it is' : 'they are') + ' answered', { placements: waits });
  }
  const sw = input.leftovers === 'inbox' && c.session && !isUserCall(c) ? bypassFor(db, c, policedHeld(db, c) || rec) : null;
  if (input.leftovers === 'inbox' && c.session && !isUserCall(c) && !sw) {
    throw new TrackRefusal("leftovers inbox moves every open task off the track, which is the user's own command: finish, drop or place each open task (a place off "
      + rec.fields.id + ' is asked of the user), then ' + (status === 'dropped' ? 'drop' : 'finish') + ' it. ' + GO_PATH);
  }
  const why = status === 'dropped' ? needText(input.reason, 'dropping a track') : input.outcome ? needText(input.outcome, 'an outcome') : undefined;
  /* at full depth a finish waits for a review of its finished code, or a waiver */
  const waived = status === 'done' ? finishGate(db, rec, input, c) : null;
  const keys = trackTasks(db, rec.key);
  const left = settleLeftovers(db, rec, input.leftovers, c, why || rec.fields.id + ' finished', status, input.wake);
  const held = leaseOf(db, rec.key);
  if (held) dropLease(db, held, c, status, keys);
  setStatus(db, rec, status, why ? { outcome: why } : {}, c, status === 'dropped' ? 'drop' : 'close', [why, waived].filter(Boolean).join('; ') || undefined);
  wakeLinked(db, { ...rec.fields, key: rec.key }, status, c);
  /* the inbox the kickoff listed, so the reply places, carries or asks about each.
     A sweep of the track's sessions is offered, never run: the user decides */
  /* each due item owed here carries the board's call, never the closed track */
  const inbox = inboxOffers(db, projectInbox(db, rec.fields.workstream, c.day), { wsKey: rec.fields.workstream, exclude: rec.key });
  return { id: rec.fields.id, key: rec.key, state: status, leftovers: left, junction: junctionBack(db, rec), inbox,
    workstream: rec.fields.workstream ? labelOf(db, rec.fields.workstream) : null, ...(waived ? { waived } : {}),
    sweep: 'Offer the user a sweep of ' + rec.fields.id + "'s sessions for anything left behind: /askerdo:sweep " + rec.fields.id + '.' };
}

export const finishTrack = (db, input, actor) => tx(db, () => closeTrack(db, input || {}, actor, 'done'));
export const dropTrack = (db, input, actor) => tx(db, () => closeTrack(db, input || {}, actor, 'dropped'));

/* ---- reads ---------------------------------------------------------------- */

const nowMsOf = (opts) => clockOf(opts).getTime();

/* a parked track's row says what opens it again; absent otherwise */
export function unparkOf(db, rec, state) {
  const u = state === 'parked' ? unparkWords(db, rec.fields.unparkWhen) : null;
  return u ? { unpark: u } : {};
}

/* The band's track row and the kickoff's head, from the tables in one read: now (its open runs,
   each with its word), the running, unconfirmed and ready counts and the critical path's length. */
function summarize(db, input, opts) {
  const rec = trackRec(db, input && input.track);
  const state = stateOf(db, rec);
  const g = trackGraph(db, rec.key, nowMsOf(opts));
  const count = (w) => g.now.filter((n) => n.word.is === w).length;
  const running = count('running');
  const unconfirmed = count('unconfirmed');
  const hold = holdOf(db, rec);
  const summary = {
    id: rec.fields.id, key: rec.key, name: rec.fields.name, goal: rec.fields.goal || null, state, stalled: isStalled(db, rec, state, nowMsOf(opts)),
    quietSince: state === 'active' ? quietSince(db, rec.key, nowMsOf(opts)) : null,
    noHandoff: noHandoff(db, rec.key, state), parkReason: rec.fields.parkReason || null, ...unparkOf(db, rec, state), chain: chainOf(db, rec.key).text, now: g.now,
    running, unconfirmed, ready: g.ready.length, toGo: g.critical.length,
    text: countsText({ running, open: g.tasks.length, unconfirmed, ready: g.ready.length, chain: g.critical.length }),
    ...(hold ? { hold } : {}), goalRestated: goalRestatedOf(db, rec),
  };
  return { summary, g };
}

/* the goal the track's last handoff restated, while it stands: { handoff, at, was }, else null */
export function goalRestatedOf(db, rec) {
  const row = db.stmt('SELECT label, fields FROM handoffs WHERE track = ? ORDER BY ' + NEWEST_FIRST + ' LIMIT 1').get(rec.key);
  const f = row ? JSON.parse(row.fields) : null;
  if (!f || !f.goalWas) return null;
  const flat = (x) => String(x ?? '').replace(/\s+/g, ' ').trim();
  /* a note that restated it since says the newer goal itself */
  if (f.goal && flat(f.goal) !== flat(rec.fields.goal)) return null;
  return { handoff: row.label, at: f.created || null, was: unguardHeadings(f.goalWas) };
}

/* the user's hold on the track, by draw.mjs's one test over its active hold decisions since the take;
   the newest such decision's id and when ride with it */
function holdOf(db, rec) {
  const rows = db.stmt(`SELECT label, fields FROM records WHERE kind = 'knowledge' AND status = 'active'
    AND json_extract(fields, '$.type') = 'decision' AND EXISTS (SELECT 1 FROM json_each(fields, '$.labels') WHERE value = 'hold')
    AND EXISTS (SELECT 1 FROM json_each(fields, '$.tracks') WHERE value = ?)`).all(rec.key);
  if (!rows.length) return null;
  const lease = leaseOf(db, rec.key);
  const since = lease ? lease.since : '';
  const ds = rows.map((r) => { const f = JSON.parse(r.fields); return { id: r.label || f.id, labels: f.labels, tracks: f.tracks, created: f.created, amended: f.amended }; });
  if (!holdOn(ds, rec.key, since)) return null;
  const d = ds.filter((x) => holdOn([x], rec.key, since)).sort((a, b) => String(b.created || '').localeCompare(String(a.created || '')))[0];
  return { on: true, id: d.id, at: d.created || d.amended || null };
}

export const trackSummary = (db, input, opts) => readTx(db, () => summarize(db, input, opts).summary);

/* The kickoff's full view: the summary plus the ready set, the critical path,
   the open tasks in dependency order, the junction and the side tracks. */
export function trackView(db, input, opts) {
  return readTx(db, () => {
    const { summary: s, g } = summarize(db, input, opts);
    const lease = leaseOf(db, s.key);
    /* ties break by the track position */
    const pos = new Map(db.stmt('SELECT task, position FROM track_items WHERE track = ?').all(s.key).map((r) => [r.task, r.position]));
    const r = trackReview(db, s.key);
    /* an open review station says so and what it reads */
    const scopeOf = new Map(db.stmt(`SELECT key, fields FROM records WHERE key IN (SELECT value FROM json_each(?))`).all(JSON.stringify(g.tasks.map((t) => t.key)))
      .map((x) => [x.key, JSON.parse(x.fields)]));
    const tasks = g.tasks.map((t) => {
      const f = scopeOf.get(t.key);
      /* a review back open after it completed draws as reopened */
      const again = f && isReview(f) && !!db.stmt(`SELECT 1 FROM activity WHERE record = ? AND json_extract(line, '$.changes.status[0]') IN ('done', 'completed') LIMIT 1`).get(t.key);
      return { ...t, position: pos.get(t.key) ?? null, ...(f && isReview(f) ? { review: true, reviewScope: f.reviewScope === 'project' ? 'project' : 'track', ...(again ? { reopened: true } : {}) } : {}) };
    });
    return {
      ...s, holder: lease ? holderOf(lease) : null, readySet: g.ready, critical: g.critical, tasks, edges: g.edges, names: g.names,
      done: g.done, total: g.total, junction: junctionOf(db, s.key),
      sideTracks: sideTracksOf(db, s.key).map((t) => ({ id: t.label, key: t.key, state: stateOf(db, loadRecord(db, t.key)) })),
      /* what its arc found, for the Tracks tab's row; the Overview, which draws no such row, passes found: false */
      found: opts && opts.found === false ? null : foundSummary(db, s.key),
      /* the review readout and, apart from the open stations, the finished code tasks and the reviews, for the station map */
      review: reviewHead(r), finished: r ? [...r.finished, ...r.reviews.filter((v) => v.status === 'done')].sort((a, b) => a.position - b.position) : [],
    };
  });
}

/* An unplaced task's wake in words and whether it is due, as projectInbox reads them. */
export function taskWake(db, rec, day = dayOf(new Date())) {
  const w = rec.fields.wake && typeof rec.fields.wake === 'object' ? rec.fields.wake : null;
  const s = wakeState(db, w, day, w ? null : enteredInbox(db, rec.key, rec.fields.created));
  return { wake: s.wake, due: s.due };
}

/* an inbox row's wake for the lists (draw.mjs wakeText words it): its day, or the record it waits on */
function inboxWake(db, r, day) {
  const w = r.wake ? JSON.parse(r.wake) : null;
  const s = wakeState(db, w, day, w ? null : enteredInbox(db, r.key, r.created));
  const on = w && w.on ? db.stmt('SELECT label, status FROM records WHERE key = ?').get(w.on) : null;
  const wake = !w || !w.on ? { date: s.wake } : { kind: w.kind, key: w.on, ...(on ? { id: on.label, named: namedLabel(db, w.on), status: on.status } : { gone: true }) };
  return { ...r, wake, due: s.due };
}

/* the open tasks on no track in every open workstream sharing a
   project with this one, its own included, oldest first, so a task filed in the wrong one shows too.
   each with its wake and whether it is due, on `day` (today by default). */
export function projectInbox(db, wsKey, day = dayOf(new Date())) {
  const own = wsKey ? loadRecord(db, wsKey) : null;
  if (!own) return [];
  const out = [];
  /* an open question gating a task, beside it: the user is asked, so it owes nothing more */
  const asked = new Map(db.stmt(`SELECT g.value AS task, r.label FROM records r, json_each(r.fields, '$.gates') g WHERE r.kind = 'question' AND r.status IN ('open', 'snoozed')`)
    .all().map((x) => [x.task, x.label]));
  for (const w of db.stmt("SELECT key, label, fields FROM records WHERE kind = 'workstream' AND (status = 'open' OR key = ?) ORDER BY id").all(wsKey)) {
    const f = JSON.parse(w.fields);
    if (w.key !== wsKey && !sharesProject(own.fields, f)) continue;
    for (const r of db.stmt(`SELECT r.key, r.label, r.title, r.id AS n, json_extract(r.fields, '$.created') AS created, json_extract(r.fields, '$.wake') AS wake
        FROM records r WHERE ${INBOX}`).all(w.key)) {
      const s = wakeState(db, r.wake ? JSON.parse(r.wake) : null, day, r.wake ? null : enteredInbox(db, r.key, r.created));
      out.push({ id: r.label, key: r.key, name: r.title, workstream: { id: w.label, name: f.name || '' }, created: r.created || '', n: r.n, wake: s.wake, due: s.due,
        ...(asked.has(r.key) ? { asked: asked.get(r.key) } : {}) });
    }
  }
  return out.sort((a, b) => (Date.parse(a.created) || 0) - (Date.parse(b.created) || 0) || a.n - b.n)
    .map(({ created, n, ...t }) => t);
}

/* the track's open tasks no open task waits on (one on another track counts), apart
   from the end of its longest chain; `g` is its graph or view. */
export function openLeaves(db, trackKey, g = trackGraph(db, trackKey)) {
  const rec = loadRecord(db, trackKey);
  if (!rec || !g.tasks.length) return [];
  const end = g.critical.path[g.critical.path.length - 1];
  const isEnd = (t) => t.id === end;
  const waited = new Set(db.stmt(`SELECT DISTINCT d."on" AS k FROM depends d JOIN records r ON r.key = d.task
    WHERE d."on" IN (SELECT value FROM json_each(?)) AND coalesce(r.status, '') NOT IN ('done', 'dropped')`)
    .all(JSON.stringify(g.tasks.map((t) => t.key))).map((r) => r.k));
  /* a task filed last already said why nothing needs it sooner, so asking again changes nothing */
  const filedLast = new Set(db.stmt(`SELECT key FROM records WHERE key IN (SELECT value FROM json_each(?)) AND json_extract(fields, '$.filedLast') IS NOT NULL`)
    .all(JSON.stringify(g.tasks.map((t) => t.key))).map((r) => r.key));
  return g.tasks.filter((t) => !isEnd(t) && !waited.has(t.key) && !filedLast.has(t.key)).map((t) => ({ id: t.id, name: t.name }));
}

/* the new, active and waiting tracks everywhere (one workstream's when named), each with
   its newest handoff's verify-first entries, so a dev PC's setup reads the board once. */
function openTracks(db, input) {
  const ws = input.workstream ? workstreamOf(db, input.workstream) : null;
  const tracks = [];
  for (const r of db.stmt("SELECT key FROM records WHERE kind = 'track' AND status = 'open'" + (ws ? ' AND workstream = ?' : '') + ' ORDER BY id').all(...(ws ? [ws] : []))) {
    const rec = loadRecord(db, r.key);
    const h = db.stmt('SELECT label, fields, verify FROM handoffs WHERE track = ? ORDER BY ' + NEWEST_FIRST + ' LIMIT 1').get(rec.key);
    tracks.push({
      id: rec.fields.id, key: rec.key, name: rec.fields.name, state: stateOf(db, rec), workstream: rec.fields.workstream ? labelOf(db, rec.fields.workstream) : null,
      handoff: h ? h.label : null, created: h ? JSON.parse(h.fields).created || '' : '', verify: h ? JSON.parse(h.verify || '[]') : [],
    });
  }
  return { open: true, tracks };
}

/* A workstream's tracks with their state, stalls marked; closed ones on request. */
export function listTracks(db, input, opts) {
  if (input && input.open) return readTx(db, () => openTracks(db, input));
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
        /* the newest handoff's label (TR-n.m): a judgment kept until a track's next handoff watches it */
        handoff: (lastHandoff(db, rec.key) || {}).label || null,
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
    /* the inbox's tasks, oldest first as the board's panel lists them, and the stall setting its words name;
       each with its wake, the due first */
    const day = dayOf(new Date(nowMsOf(opts)));
    const inboxList = db.stmt(`SELECT r.key, r.label AS id, r.title AS name, r.status, r.created, json_extract(r.fields, '$.wake') AS wake
      FROM records r WHERE ${INBOX} ORDER BY r.created, r.label`).all(workstreamOf(db, input && input.workstream))
      .map((r) => inboxWake(db, r, day)).sort((a, b) => b.due - a.due);
    return { workstream: ls.workstream, inbox: ls.inbox, inboxStalled: ls.inboxStalled, inboxList, stallDays: stallDays(db), tracks };
  });
}
