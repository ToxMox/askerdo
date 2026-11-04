/* Automatic upkeep: each rule runs inside the write that meets
   its condition (no timers) while the board's `upkeep` setting is on, logged with
   its cause as board:upkeep. Band calls are computed when read. */
import { tx } from '../db.mjs';
import { WEB } from '../paths.mjs';
import { KEY_ORDERS, actorOf, addNote, clockOf, getMeta, isKey, labelOf, sessionWords, setMeta, stampNow, logVerb } from '../records.mjs';
import { ENDED_TASK, TASK_KEYS, TrackRefusal, headOf, loadRecord, logLine, readTx, recordOf, sideOf, writeFront } from './graph.mjs';
import { UsageError, lineName, namedLabel, resolveRecord } from './labels.mjs';
import { INBOX_LABEL, wakeLinked } from './questions.mjs';
import { NEWEST_FIRST, holderPlain, inboxMoved, quietHours, quietSince, stallDays, stateOf, trackMoved } from './tracks.mjs';
import { atWords } from '../web/feed.mjs';
import { waitingOf } from '../handoff-text.mjs';
import { overrideCalls } from './override.mjs';
import { afterTask, trackReview } from './coverage.mjs';

export const BY = 'board:upkeep';
const SETTING = 'upkeep';
export const upkeepOn = (db) => getMeta(db, SETTING) === 'on';

const ENDS = { track: ['done', 'dropped', 'folded'], task: ['completed', 'dropped'], question: ['answered', 'dropped'] };
const UNPARK = { 'track-ends': 'track', 'task-completes': 'task', 'question-answered': 'question' };
const kindOf = (db, key) => (db.stmt('SELECT kind FROM records WHERE key = ?').get(key) || {}).kind;

/* ---- the two conditions: stored by key, read by label ----------------------- */

export function closeText(db, v) {
  if (!v || typeof v !== 'object') return v ?? null;
  if (v.kind === 'with') return 'with ' + namedLabel(db, v.on);
  if (v.kind === 'when') return 'when ' + v.fact;
  return v.kind === 'look' ? 'after the look' : String(v.kind);
}

export const whenText = (db, v) => (v && typeof v === 'object' ? v.kind + ' ' + (UNPARK[v.kind] === 'track' ? lineName(db, v.on) : labelOf(db, v.on)) : v ?? null);

/* what opens a parked track again in plain words, every surface's one wording */
export function unparkWords(db, v) {
  if (!v || typeof v !== 'object' || !v.on) return null;
  if (UNPARK[v.kind] === 'track') return 'when ' + lineName(db, v.on) + ' ends';
  return 'when ' + namedLabel(db, v.on) + (v.kind === 'question-answered' ? ' is answered' : ' completes');
}

/* "with T-5", "look" or "when <fact>"; an API caller may pass the object
   ({ kind: "with", on | task }). */
export function closeOf(db, raw, self, day) {
  let kind;
  let ref;
  let fact;
  if (raw && typeof raw === 'object') {
    kind = raw.kind;
    fact = raw.fact;
    ref = raw.on ?? raw.task;
  } else {
    const s = String(raw ?? '').replace(/\s+/g, ' ').trim();
    const m = /^(with|when) (.+)$/i.exec(s);
    if (/^look$/i.test(s)) kind = 'look';
    else if (m) { kind = m[1].toLowerCase(); if (kind === 'with') ref = m[2]; else fact = m[2]; }
  }
  if (kind === 'look') return { kind };
  if (kind === 'when') {
    if (typeof fact !== 'string' || !fact.trim()) throw new UsageError('--close when needs the fact that closes it: when <a checkable fact>');
    return { kind, fact: fact.replace(/\s+/g, ' ').trim() };
  }
  if (kind !== 'with') throw new UsageError('--close takes "with T-n", "look" or "when <a checkable fact>"');
  /* a plan step ("P-10 s5") names the one task the import made from it */
  const step = /^(P-\d+)[ /](s\d+)$/.exec(String(ref ?? '').trim());
  const hits = step ? db.stmt(`SELECT key FROM records WHERE kind = 'task' AND json_extract(fields, '$.fromStep') = ?`).all(step[1] + '/' + step[2]) : [];
  const e = step ? (hits.length === 1 ? resolveRecord(db, hits[0].key) : null) : ref ? resolveRecord(db, String(ref).trim(), { day }) : null;
  if (!e || e.kind !== 'task') throw new UsageError('--close with names a task: no task ' + (ref || '(none given)') + (hits.length > 1 ? ' (' + hits.length + ' tasks claim that step)' : ''));
  if (e.key === self) throw new UsageError('a task cannot close with itself');
  const st = e.front.status;
  if (ENDED_TASK.includes(st)) throw new UsageError(e.label + ' is already ' + st + (st === 'completed' ? ': complete this task now instead' : ', so it never completes'));
  return { kind, on: e.key };
}

/* task edit --close, --clear-close and --landed, inside editRecord's transaction. */
export function editClose(db, e, front, c, changed, ctx) {
  if (c.close === undefined && !c.clearClose && !c.landed) return;
  if (e.kind !== 'task') throw new UsageError('only a task carries a close condition');
  if (c.close !== undefined && c.clearClose) throw new UsageError('pick one of --close and --clear-close');
  const was = JSON.stringify(front.close ?? null);
  if (c.clearClose) delete front.close;
  else if (c.close !== undefined) front.close = closeOf(db, c.close, e.key, ctx.day);
  if (JSON.stringify(front.close ?? null) !== was) changed.push('close');
  const look = front.close && front.close.kind === 'look';
  if (c.landed) {
    if (!look) throw new UsageError('--landed reports a look task\'s work landed; ' + front.id + ' closes ' + (front.close ? closeText(db, front.close) : 'by hand') + ' (--close look first)');
    if (ENDED_TASK.includes(front.status)) throw new UsageError(front.id + ' is already ' + front.status);
    if (!front.landed) { front.landed = ctx.at; changed.push('landed'); }
  } else if (front.landed && !look) { delete front.landed; changed.push('landed'); }
}

/* The activity line shows a close condition as it reads, never as a key map. */
export function closeChanges(db, changes, before, after) {
  if (changes.close) changes.close = [closeText(db, before.close), closeText(db, after.close)];
  return changes;
}

/* track park --unpark-when "track-ends TR-m" | "task-completes T-m" | "question-answered Q-m". */
export function unparkWhenOf(db, raw) {
  if (raw === undefined || raw === null || raw === '') return undefined;
  let kind;
  let ref;
  if (typeof raw === 'object') {
    kind = raw.kind;
    ref = raw.on;
  } else {
    const m = /^\s*(track-ends|task-completes|question-answered)\s+(\S+)\s*$/i.exec(String(raw));
    if (m) [kind, ref] = [m[1].toLowerCase(), m[2]];
  }
  const want = UNPARK[kind];
  if (!want) throw new TrackRefusal('--unpark-when takes "track-ends TR-m", "task-completes T-m" or "question-answered Q-m"');
  const e = ref ? resolveRecord(db, String(ref).trim(), { kinds: [want] }) : null;
  if (!e) throw new TrackRefusal('--unpark-when ' + kind + ' names a ' + want + ': no ' + want + ' ' + (ref || '(none given)'));
  if (ENDS[want].includes(e.front.status)) throw new TrackRefusal(e.label + ' is already ' + e.front.status + ': there is nothing left to wait for');
  return { kind, on: e.key };
}

/* ---- the rules ------------------------------------------------------------- */

/* A status the board fixes leaves `updated` alone, and its line is no movement for the stall rule;
   `for` names the session whose act it follows, so that session is not told its own change */
function setTask(db, t, status, ctx, cause) {
  const diff = writeFront(db, t, { status }, TASK_KEYS);
  logLine(db, { at: ctx.at, verb: 'edit', kind: 'task', rec: headOf(t), changes: diff, by: BY, pc: ctx.pc, note: cause, for: ctx.session || undefined });
  return true;
}

/* In progress follows the hand: taken in hand, an open task starts; let go, an
   unfinished one goes back to open unless an agent works it. A promoted task's
   status follows its side track, so it is left alone. */
export function followHand(db, key, ctx, cause) {
  if (!upkeepOn(db) || sideOf(db, key)) return false;
  const t = loadRecord(db, key);
  const f = t.fields;
  if (f.inHand && f.status === 'open') return setTask(db, t, 'in_progress', ctx, cause || 'taken in hand by ' + sessionWords(db, f.inHand, ctx));
  if (!f.inHand && f.status === 'in_progress' && !f.agent) return setTask(db, t, 'open', ctx, cause || 'let go' + (ctx.session ? ' by ' + sessionWords(db, ctx.session, ctx) : ''));
  return false;
}

/* The lease's drop: the line's running tasks no session holds in hand go back to open. */
export function afterLeaseDrop(db, trackKey, session, ctx, why) {
  if (!upkeepOn(db)) return;
  const rows = db.stmt(`SELECT r.key FROM track_items ti JOIN records r ON r.key = ti.task WHERE ti.track = ? AND r.status = 'in_progress'
    AND json_extract(r.fields, '$.inHand') IS NULL AND json_extract(r.fields, '$.agent') IS NULL`).all(trackKey);
  for (const r of rows) {
    if (sideOf(db, r.key)) continue;
    setTask(db, loadRecord(db, r.key), 'open', ctx, sessionWords(db, session, ctx) + ' let go of ' + lineName(db, trackKey) + (why ? ' (' + why + ')' : ''));
  }
}

/* A woken line's stall clock starts at the wake (its `updated`), or it would draw a stall call at once. */
function unpark(db, rec, ctx, cause) {
  const was = rec.fields.unparkWhen;
  const diff = writeFront(db, rec, { status: 'open', parkReason: undefined, unparkWhen: undefined, updated: ctx.at }, KEY_ORDERS.track);
  if (diff.unparkWhen) diff.unparkWhen = [whenText(db, was), null];
  logLine(db, { at: ctx.at, verb: 'edit', kind: 'track', rec: headOf(rec), changes: diff, by: BY, pc: ctx.pc, note: 'unparked: ' + cause });
}

function closeOne(db, t, ctx, cause) {
  if (ENDED_TASK.includes(t.fields.status) || sideOf(db, t.key)) return;
  const diff = writeFront(db, t, { status: 'completed', closed: ctx.at, inHand: undefined, inHandSince: undefined }, TASK_KEYS);
  logLine(db, { at: ctx.at, verb: 'edit', kind: 'task', rec: headOf(t), changes: diff, by: BY, pc: ctx.pc, note: 'closed with ' + cause });
  /* the shared check, as every completion runs it */
  afterTask(db, t.key, { completed: true }, { by: BY, pc: ctx.pc, now: ctx.date });
  wakeLinked(db, { ...t.fields, key: t.key }, 'completed', { at: ctx.at, by: BY, pc: ctx.pc });
}

/* Every ending (questions.mjs wakeLinked): the parked lines waiting on it
   unpark, and a completed task closes the tasks that close with it. */
export function onEnding(db, ended, ending, ctx) {
  if (!upkeepOn(db)) return;
  const key = isKey(ended.key) ? ended.key : (resolveRecord(db, String(ended.id || '')) || {}).key;
  const kind = key && kindOf(db, key);
  const unparkKind = Object.keys(UNPARK).find((k) => UNPARK[k] === kind);
  if (!unparkKind) return;
  const word = String(ending).split(' ')[0];
  const cause = (kind === 'track' ? lineName(db, key) : ended.id || labelOf(db, key)) + ' ' + word;
  for (const r of db.stmt("SELECT key FROM records WHERE kind = 'track' AND json_extract(fields, '$.unparkWhen.on') = ?").all(key)) {
    const rec = loadRecord(db, r.key);
    if (rec.fields.status === 'parked' && rec.fields.unparkWhen.kind === unparkKind) unpark(db, rec, ctx, cause);
  }
  if (kind !== 'task' || word !== 'completed') return;
  for (const r of db.stmt("SELECT key FROM records WHERE kind = 'task' AND json_extract(fields, '$.close.kind') = 'with' AND json_extract(fields, '$.close.on') = ?").all(key)) {
    closeOne(db, loadRecord(db, r.key), ctx, cause);
  }
}

/* ---- the switch, the catch-up and the dry run -------------------------------- */

const lastSeq = (db) => db.stmt('SELECT coalesce(max(seq), 0) AS n FROM activity').get().n;

function actOf(line) {
  const st = (line.changes || {}).status;
  if (line.verb === 'wake') return 'wake';
  if (line.kind === 'track') return 'unpark';
  if (st && st[1] === 'completed') return 'close';
  if (st && st[1] === 'open') return 'back to open';
  return st && st[1] === 'in_progress' ? 'in progress' : line.verb;
}

/* What switching on does to the board as it stands: the rules applied to data
   written while they were off, the endings cascading as they would live. */
function catchUp(db, ctx) {
  const from = lastSeq(db);
  setMeta(db, SETTING, 'on');
  for (const r of db.stmt("SELECT key FROM records WHERE kind = 'task' AND status = 'open' AND json_extract(fields, '$.inHand') IS NOT NULL").all()) {
    followHand(db, r.key, ctx);
  }
  /* a task on a held line is the holder's to run, as the line's now set reads it */
  for (const r of db.stmt(`SELECT r.key FROM records r WHERE r.kind = 'task' AND r.status = 'in_progress'
      AND json_extract(r.fields, '$.inHand') IS NULL AND json_extract(r.fields, '$.agent') IS NULL
      AND NOT EXISTS (SELECT 1 FROM track_items ti JOIN leases l ON l.track = ti.track WHERE ti.task = r.key)`).all()) {
    if (!sideOf(db, r.key)) setTask(db, loadRecord(db, r.key), 'open', ctx, 'no session holds it in hand and no agent works it');
  }
  for (const r of db.stmt(`SELECT t.key, o.label FROM records t JOIN records o ON o.key = json_extract(t.fields, '$.close.on')
      WHERE t.kind = 'task' AND json_extract(t.fields, '$.close.kind') = 'with' AND o.status = 'completed'`).all()) {
    closeOne(db, loadRecord(db, r.key), ctx, r.label + ' completed');
  }
  for (const r of db.stmt(`SELECT t.key, o.key AS onKey, o.kind, o.status, o.label FROM records t JOIN records o ON o.key = json_extract(t.fields, '$.unparkWhen.on')
      WHERE t.kind = 'track' AND t.status = 'parked'`).all()) {
    const rec = loadRecord(db, r.key);
    if (rec.fields.status !== 'parked' || UNPARK[rec.fields.unparkWhen.kind] !== r.kind || !ENDS[r.kind].includes(r.status)) continue;
    unpark(db, rec, ctx, (r.kind === 'track' ? lineName(db, r.onKey) : r.label) + ' ' + r.status);
  }
  return db.stmt('SELECT line FROM activity WHERE seq > ? AND actor = ? ORDER BY seq').all(from, BY).map((row) => {
    const l = JSON.parse(row.line);
    return { act: actOf(l), kind: l.kind, id: l.id, key: l.key, name: l.name, cause: l.note || '', changes: l.changes };
  });
}

class DryRun {
  constructor(out) { this.out = out; }
}

/* upkeep --dry-run: the catch-up and the band calls switching on would raise,
   run in a transaction that is rolled back, so the list is exactly what
   `upkeep on` applies and nothing is written. */
export function upkeepDryRun(db, input, actor, opts) {
  const ctx = actorOf(actor, opts);
  const on = upkeepOn(db);
  try {
    tx(db, () => {
      const changes = catchUp(db, ctx);
      throw new DryRun({ on, changes, bandCalls: allCalls(db, null, ctx.date.getTime(), null) });
    });
  } catch (e) {
    if (e instanceof DryRun) return e.out;
    throw e;
  }
  return null;
}

/* upkeep on | off: on applies the catch-up once, in the switch's transaction. */
export function upkeepSwitch(db, input = {}, actor, opts) {
  const on = input.on === true || input.on === 'on';
  return tx(db, () => {
    const ctx = actorOf(actor, opts);
    const was = upkeepOn(db);
    if (on === was) return { on, was, changes: [] };
    const changes = on ? catchUp(db, ctx) : [];
    if (!on) setMeta(db, SETTING, 'off');
    logVerb(db, { ts: ctx.at, verb: 'edit', kind: 'board', id: 'upkeep', name: 'Automatic upkeep', changes: { upkeep: [was ? 'on' : 'off', on ? 'on' : 'off'] },
      by: ctx.by, pc: ctx.pc, note: on ? changes.length + ' catch-up change' + (changes.length === 1 ? '' : 's') : 'the rules stop' });
    return { on, was, changes };
  });
}

/* ---- band calls -------------------------------------------------------------- */

const normDir = (d) => String(d || '').replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
const listIn = (v) => { try { const a = JSON.parse(v); return Array.isArray(a) ? a : []; } catch { return []; } };

/* The session's own workstreams and tracks, as the names line scopes questions (its
   held line, its tasks in hand or subscribed, its workstreams, its questions'), plus
   its project's open workstreams, so a session holding nothing still sees its calls. */
export function scopeOf(db, session, project) {
  if (!session) return null;
  const ws = new Set();
  const tracks = new Set();
  const want = normDir(project);
  if (want) {
    for (const r of db.stmt(`SELECT key, json_extract(fields, '$.projectRepos') AS repos, json_extract(fields, '$.projects') AS dirs
        FROM records WHERE kind = 'workstream' AND status = 'open'`).all()) {
      if (listIn(r.repos).concat(listIn(r.dirs)).some((n) => normDir(n) === want)) ws.add(r.key);
    }
  }
  const held = db.stmt('SELECT track FROM leases WHERE session = ?').get(session);
  if (held) tracks.add(held.track);
  for (const r of db.stmt(`SELECT r.key, r.kind, r.workstream, ti.track FROM records r LEFT JOIN track_items ti ON ti.task = r.key
      WHERE r.kind IN ('workstream', 'task') AND (json_extract(r.fields, '$.inHand') = ?
        OR EXISTS (SELECT 1 FROM json_each(r.fields, '$.subscribers') WHERE value = ?))`).all(session, session)) {
    if (r.kind === 'workstream') ws.add(r.key);
    if (r.workstream) ws.add(r.workstream);
    if (r.track) tracks.add(r.track);
  }
  for (const r of db.stmt(`SELECT json_extract(fields, '$.workstream') AS ws, json_extract(fields, '$.track') AS track FROM records WHERE kind = 'question'
      AND (json_extract(fields, '$.session') = ? OR EXISTS (SELECT 1 FROM json_each(fields, '$.subscribers') WHERE value = ?))`).all(session, session)) {
    if (r.ws) ws.add(r.ws);
    if (r.track) tracks.add(r.track);
  }
  for (const k of tracks) { const w = db.stmt('SELECT workstream FROM records WHERE key = ?').get(k); if (w && w.workstream) ws.add(w.workstream); }
  return { ws, tracks };
}

export const inScope = (scope, ws, track) => !scope || (ws && scope.ws.has(ws)) || (track && scope.tracks.has(track));
/* `does`: what the press does, said on the band's tooltip */
const keep = (key, since) => ({ label: 'Keep', verb: 'bandKeep', input: { record: key, since }, does: 'hides this call until its fact changes; nothing on the board moves' });

function lookRows(db, scope, session) {
  const rows = [];
  for (const r of db.stmt(`SELECT r.key, r.label, r.title, r.workstream, ti.track, json_extract(r.fields, '$.landed') AS landed,
      json_extract(r.fields, '$.inHand') AS inHand, (SELECT l.session FROM leases l WHERE l.track = ti.track) AS holder
      FROM records r LEFT JOIN track_items ti ON ti.task = r.key WHERE r.kind = 'task' AND json_extract(r.fields, '$.close.kind') = 'look'
      AND json_extract(r.fields, '$.landed') IS NOT NULL AND coalesce(r.status, '') NOT IN ('completed', 'dropped') ORDER BY landed`).all()) {
    if (!inScope(scope, r.workstream, r.track)) continue;
    rows.push({
      kind: 'look', record: r.key, id: r.label, name: r.title, text: r.label + ' ' + r.title + ': its work landed, and it closes at your look', since: r.landed,
      why: 'Its close condition is your look, and its work landed on ' + String(r.landed).slice(0, 10),
      presses: [
        { label: 'Close', verb: 'editRecord', input: { id: r.key, kind: 'task', status: 'completed' }, does: 'closes ' + r.label + ' as done' },
        { label: 'Not yet', verb: 'lookNotYet', input: { task: r.key }, does: r.label + ' stays open and its session hears it' },
      ],
      /* the session holding the task hears the press as a turn */
      ...(session && (r.inHand === session || r.holder === session) ? { mine: true } : {}),
    });
  }
  return rows;
}

const stampOf = (ms) => stampNow(new Date(ms));

function wsRow(db, w, nowMs) {
  const f = w.fields;
  const moved = inboxMoved(db, w.key);
  if (moved !== null) {
    if (nowMs - moved <= stallDays(db) * 86400000) return null;
    const since = stampOf(moved);
    return {
      kind: 'judgment', record: w.key, id: f.id, name: f.name, since, text: 'The inbox of ' + f.name + ' has open tasks and no movement since ' + since.slice(0, 10),
      why: 'Nothing in its inbox moved for more than ' + stallDays(db) + ' days; upkeep never decides what to do with an inbox',
      presses: [{ label: 'Open the inbox', verb: null, input: null, url: WEB.workstream(f.id), does: 'opens the page of ' + f.id + ' on the board' }, keep(w.key, since)],
    };
  }
  /* an inbox is empty by design, and closing it only mints the next one */
  if ((f.labels || []).includes(INBOX_LABEL)) return null;
  const live = db.stmt(`SELECT count(*) AS n FROM records WHERE workstream = ? AND ((kind = 'task' AND coalesce(status, '') NOT IN ('completed', 'dropped'))
    OR (kind = 'track' AND status IN ('open', 'parked')))`).get(w.key);
  if (live.n) return null;
  const last = db.stmt("SELECT max(closed) AS at FROM records WHERE workstream = ? AND kind IN ('task', 'track')").get(w.key).at;
  /* a new workstream with nothing in it yet is not a call until it has waited a stall's days */
  if (!last && nowMs - (Date.parse(f.created) || 0) <= stallDays(db) * 86400000) return null;
  const since = last || f.created || f.updated;
  return {
    kind: 'judgment', record: w.key, id: f.id, name: f.name, since, text: f.name + ' has no open task and no live track',
    why: 'Nothing in it is open since ' + String(since || '').slice(0, 10) + ', and upkeep never closes a workstream on its own',
    presses: [{ label: 'Close it', verb: 'closeRecord', input: { id: w.key, kind: 'workstream' }, does: 'closes ' + f.id + ' on the board' }, keep(w.key, since)],
  };
}

function trackRow(db, t, nowMs) {
  const state = stateOf(db, t);
  if (state !== 'active' && state !== 'waiting') return null;
  const quiet = state === 'active' ? quietSince(db, t.key, nowMs) : null;
  const moved = quiet ? null : trackMoved(db, t);
  if (!quiet && (moved === null || nowMs - moved <= stallDays(db) * 86400000)) return null;
  const since = quiet || stampOf(moved);
  const lease = quiet ? db.stmt('SELECT session, pc, since, seen FROM leases WHERE track = ?').get(t.key) : null;
  const named = 'Track ' + t.fields.id + ' ' + t.fields.name;
  return {
    kind: 'judgment', record: t.key, id: t.fields.id, name: t.fields.name, since, ...(quiet ? { holder: lease.session } : {}),
    text: quiet ? named + ' is held by ' + holderPlain(db, t.key, lease, { now: nowMs }) : named + ' has open tasks and no movement since ' + atWords(since, nowMs),
    why: quiet ? 'The session holding it has been quiet for more than ' + quietHours(db) + ' hours' : 'Nothing on it moved for more than ' + stallDays(db) + ' days',
    presses: [{ label: 'Park it', verb: 'parkTrack', input: { track: t.key, reason: 'quiet since ' + since.slice(0, 10) }, does: 'parks the track, its lease let go, until a session resumes it' }, keep(t.key, since)],
  };
}

/* a track whose unreviewed finished code reached review.tasks, at light
   and full; its press opens the Tracks tab at the track (`pane`, the mod's), else its page. */
function reviewRow(db, t) {
  const r = trackReview(db, t.key);
  if (!r || !r.due) return null;
  const n = r.uncovered.length;
  const ids = r.uncovered.slice(0, 8).map((u) => u.id).join(', ') + (n > 8 ? ' and ' + (n - 8) + ' more' : '');
  return {
    kind: 'review', record: t.key, id: t.fields.id, name: t.fields.name, since: r.since,
    text: 'Review due on ' + t.fields.id + ' ' + t.fields.name + ': ' + n + ' finished code tasks wait for a review',
    why: ids + ' finished with ' + r.lines + ' counted lines no review read, and a review is due at ' + r.size + (r.locked ? '; the track finishes only after one' : ''),
    presses: [{ label: 'Open the track', verb: null, input: null, url: WEB.record(t.fields.id), pane: 'tracks', does: 'opens ' + t.fields.id + ' in the Tracks tab' }],
  };
}

function callsOf(db, scope, nowMs, session) {
  const rows = lookRows(db, scope, session);
  const wsKeys = scope ? [...scope.ws] : db.stmt("SELECT key FROM records WHERE kind = 'workstream' AND status = 'open'").all().map((r) => r.key);
  const trackKeys = new Set(scope ? scope.tracks : []);
  for (const k of wsKeys) {
    const w = loadRecord(db, k);
    if (!w || w.fields.status !== 'open') continue;
    for (const r of db.stmt("SELECT key FROM records WHERE kind = 'track' AND workstream = ? AND status = 'open'").all(k)) trackKeys.add(r.key);
    const row = wsRow(db, w, nowMs);
    if (row && w.fields.kept !== row.since) rows.push(row);
  }
  for (const k of trackKeys) {
    const t = loadRecord(db, k);
    if (!t || t.fields.status !== 'open') continue;
    const row = trackRow(db, t, nowMs);
    if (row && t.fields.kept !== row.since) rows.push(row);
    const due = reviewRow(db, t);
    if (due) rows.push(due);
  }
  return rows;
}

/* The look and judgment rows, then the override requests and the sealed scrubs. */
const allCalls = (db, scope, nowMs, session) => callsOf(db, scope, nowMs, session).concat(overrideCalls(db, session, scope, nowMs));

/* What the live handoffs in scope say waits on the user, one row a line: the band's
   reading and the web's, so /askerdo and the views list the same asks. */
function handoffAsks(db, scope) {
  const out = [];
  for (const t of db.stmt("SELECT key, label, title, workstream FROM records WHERE kind = 'track' AND status IN ('open', 'parked') ORDER BY id").all()) {
    if (!inScope(scope, t.workstream, t.key)) continue;
    const h = db.stmt('SELECT key, label, fields, status, created FROM handoffs WHERE track = ? ORDER BY ' + NEWEST_FIRST + ' LIMIT 1').get(t.key);
    if (!h || !['waiting', 'parked'].includes(h.status)) continue;
    let f = {};
    try { f = JSON.parse(h.fields) || {}; } catch {}
    for (const w of waitingOf(f)) {
      out.push({ track: t.label, trackKey: t.key, name: t.title, workstream: t.workstream, handoff: h.label, handoffKey: h.key, text: String(w), at: h.created });
    }
  }
  return out;
}

/* bandCalls { session, projectRepo | project }: the calls the board never decides,
   in the session's scope (the whole board with no session). */
export function bandCalls(db, input = {}, actor, opts) {
  return readTx(db, () => {
    const session = (input && input.session) || null;
    const scope = scopeOf(db, session, (input && (input.projectRepo || input.project)) || '');
    return { rows: allCalls(db, scope, clockOf(actor, opts).getTime(), session), asks: handoffAsks(db, scope) };
  });
}

/* Keep: the row hides until its fact changes (its since moves). */
export function bandKeep(db, input = {}, actor) {
  return tx(db, () => {
    const c = actorOf(actor);
    const rec = recordOf(db, input.record);
    if (rec.kind !== 'workstream' && rec.kind !== 'track') throw new TrackRefusal('Keep holds a workstream\'s or a track\'s band call, not a ' + rec.kind + '\'s');
    const since = typeof input.since === 'string' ? input.since.trim() : '';
    if (!since) throw new TrackRefusal('Keep needs the since its row showed');
    const was = rec.fields.kept ?? null;
    if (was === since) return { id: rec.fields.id, key: rec.key, kept: since };
    writeFront(db, rec, { kept: since }, KEY_ORDERS[rec.kind]);
    logLine(db, { at: c.at, verb: 'edit', kind: rec.kind, rec: headOf(rec), changes: { kept: [was, since] }, by: c.by, pc: c.pc, note: 'kept on the band until it changes' });
    return { id: rec.fields.id, key: rec.key, kept: since };
  });
}

/* Not yet: the look task's landed mark clears, with a note in its journal. */
export function lookNotYet(db, input = {}, actor) {
  return tx(db, () => {
    const c = actorOf(actor);
    const t = recordOf(db, input.task, 'task');
    const was = t.fields.landed;
    if (!was) return { id: t.fields.id, key: t.key, landed: null };
    writeFront(db, t, { landed: undefined, updated: c.at }, TASK_KEYS);
    const body = 'Not yet at the look' + (typeof input.note === 'string' && input.note.trim() ? ': ' + input.note.trim() : '')
      + '. It shows on the band again once a session reports its work landed.';
    addNote(db, t.key, { at: c.at, actor: c.by, body });
    logLine(db, { at: c.at, verb: 'edit', kind: 'task', rec: headOf(t), changes: { landed: [was, null] }, by: c.by, pc: c.pc, note: body });
    return { id: t.fields.id, key: t.key, landed: null };
  });
}
