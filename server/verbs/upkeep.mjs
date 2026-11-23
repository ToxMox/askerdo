/* Automatic upkeep: each rule runs inside the write that meets
   its condition (no timers) while the board's `upkeep` setting is on, logged with
   its cause as board:upkeep. Band calls are computed when read. */
import { tx } from '../db.mjs';
import { WEB } from '../paths.mjs';
import { DAY_RE, KEY_ORDERS, actorOf, addDays, addNote, clockOf, getMeta, isKey, labelOf, setMeta, stampNow, logVerb } from '../records.mjs';
import { ENDED_TASK, TrackRefusal, headOf, loadRecord, logLine, readTx, recordOf, writeFront } from './graph.mjs';
import { UsageError, lineName, namedLabel, resolveRecord } from './labels.mjs';
import { INBOX_LABEL, drop as dropQuestion, register as askQuestion } from './questions.mjs';
import { NEWEST_FIRST, holderPlain, inboxMoved, quietHours, quietSince, stallDays, stateOf, trackMoved } from './tracks.mjs';
import { atWords } from '../web/feed.mjs';
import { CLI, WAKE_DAYS, WAKE_FORMS, waitingOf } from '../handoff-text.mjs';
import { overrideCalls } from './override.mjs';
import { trackReview } from './coverage.mjs';
import { endTask, openSteps, runsHolding, stepsRefusal } from './ending.mjs';
import { heldWords, openRunSql } from './runs.mjs';

export const BY = 'board:upkeep';
const SETTING = 'upkeep';
export const upkeepOn = (db) => getMeta(db, SETTING) === 'on';

const ENDS = { track: ['done', 'dropped', 'folded'], task: ['done', 'dropped'], question: ['answered', 'dropped'] };
const UNPARK = { 'track-ends': 'track', 'task-completes': 'task', 'question-answered': 'question' };
const kindOf = (db, key) => (db.stmt('SELECT kind FROM records WHERE key = ?').get(key) || {}).kind;

/* ---- the two conditions: stored by key, read by label ----------------------- */

export function closeText(db, v) {
  if (!v || typeof v !== 'object') return v ?? null;
  if (v.kind === 'with') return 'with ' + namedLabel(db, v.on);
  return String(v.kind);
}

export const whenText = (db, v) => (v && typeof v === 'object' ? v.kind + ' ' + (UNPARK[v.kind] === 'track' ? lineName(db, v.on) : labelOf(db, v.on)) : v ?? null);

/* what opens a parked track again in plain words, every surface's one wording */
export function unparkWords(db, v) {
  if (!v || typeof v !== 'object' || !v.on) return null;
  if (UNPARK[v.kind] === 'track') return 'when ' + lineName(db, v.on) + ' ends';
  return 'when ' + namedLabel(db, v.on) + (v.kind === 'question-answered' ? ' is answered' : ' completes');
}

/* "with T-n"; an API caller may pass the object ({ kind: "with", on | task }). A look or a
   when fact is refused with its way out; old records keep theirs for the doctor. */
export function closeOf(db, raw, self, day) {
  let kind;
  let ref;
  if (raw && typeof raw === 'object') {
    kind = raw.kind;
    ref = raw.on ?? raw.task;
  } else {
    const s = String(raw ?? '').replace(/\s+/g, ' ').trim();
    const m = /^(with|when) (.+)$/i.exec(s);
    if (/^look$/i.test(s)) kind = 'look';
    else if (m) { kind = m[1].toLowerCase(); ref = m[2]; }
  }
  if (kind === 'look') {
    throw new UsageError('a task does not close at the look: a look is a task labelled look (--add-label look) that its session runs and ends by asking the user one question gating it, and the session closes it once the answer is right');
  }
  if (kind === 'when') {
    throw new UsageError('a task does not close when a fact holds: write the checkable fact into its description as its done clause (--description), and its session closes it once the fact holds');
  }
  if (kind !== 'with') throw new UsageError('--close takes "with T-n"');
  /* a plan step ("P-10 s5") names the one task the import made from it */
  const step = /^(P-\d+)[ /](s\d+)$/.exec(String(ref ?? '').trim());
  const hits = step ? db.stmt(`SELECT key FROM records WHERE kind = 'task' AND json_extract(fields, '$.fromStep') = ?`).all(step[1] + '/' + step[2]) : [];
  const e = step ? (hits.length === 1 ? resolveRecord(db, hits[0].key) : null) : ref ? resolveRecord(db, String(ref).trim(), { day }) : null;
  if (!e || e.kind !== 'task') throw new UsageError('--close with names a task: no task ' + (ref || '(none given)') + (hits.length > 1 ? ' (' + hits.length + ' tasks claim that step)' : ''));
  if (e.key === self) throw new UsageError('a task cannot close with itself');
  const st = e.front.status;
  if (ENDED_TASK.includes(st)) throw new UsageError(e.label + ' is already ' + st + (st === 'done' ? ': complete this task now instead' : ', so it never completes'));
  return { kind, on: e.key };
}

/* task edit --close and --clear-close, inside editRecord's transaction; a clear takes an old
   look's landed mark with it, so no dead field stays. */
export function editClose(db, e, front, c, changed, ctx) {
  if (c.close === undefined && !c.clearClose) return;
  if (e.kind !== 'task') throw new UsageError('only a task carries a close condition');
  if (c.close !== undefined && c.clearClose) throw new UsageError('pick one of --close and --clear-close');
  const was = JSON.stringify(front.close ?? null);
  if (c.clearClose) delete front.close;
  else if (c.close !== undefined) front.close = closeOf(db, c.close, e.key, ctx.day);
  if (JSON.stringify(front.close ?? null) !== was) changed.push('close');
  if (front.landed) { delete front.landed; changed.push('landed'); }
}

/* The activity line shows a close condition as it reads, never as a key map. */
export function closeChanges(db, changes, before, after) {
  if (changes.close) changes.close = [closeText(db, before.close), closeText(db, after.close)];
  return changes;
}

/* track park --unpark-when "track-ends TR-m" | "task-completes T-m" | "question-answered Q-m". */
export function unparkWhenOf(db, raw, flag = '--unpark-when', also = '') {
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
  if (!want) throw new TrackRefusal(flag + ' takes "track-ends TR-m", "task-completes T-m" or "question-answered Q-m"' + also);
  const e = ref ? resolveRecord(db, String(ref).trim(), { kinds: [want] }) : null;
  if (!e) throw new TrackRefusal(flag + ' ' + kind + ' names a ' + want + ': no ' + want + ' ' + (ref || '(none given)'));
  if (ENDS[want].includes(e.front.status)) throw new TrackRefusal(e.label + ' is already ' + e.front.status + ': there is nothing left to wait for');
  return { kind, on: e.key };
}

/* an unplaced task's wake, the park vocabulary or a day; none given, none
   (the filing verbs refuse a filing with none). A fired wake is refused with the way out: a refused
   filing (`via` create, capture) or close (finish, drop, with `track`) moved nothing, so the way out runs it again;
   a closing task's leftover (`via` leftover) names its step's fields instead of a flag; `via` ladder gives the cause alone. */
export function wakeOf(db, raw, day, task, via, track) {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (isNextSession(raw)) {
    throw new TrackRefusal((via === 'leftover' || via === 'ladder' ? 'wake ' : '--wake ') + 'next-session waits on a track for another session to take it, and the inbox has no track: '
      + (via === 'leftover' ? 'leave out unplaced and the step goes on its track with that wake' : 'file it on a track with that wake (tier 2 on the track you hold, tier 3 on another), or give the inbox a wake still to come (' + WAKE_FORMS + ')'));
  }
  const later = 'a wake still to come (' + WAKE_FORMS + ')';
  const closing = !task && (via === 'finish' || via === 'drop');
  const who = closing ? 'its open tasks' : 'the task';
  const flag = via === 'leftover' || via === 'ladder' ? 'wake ' : '--wake ';
  /* a ladder filing's way out rides its refusal's offers (tracks.mjs ladderRung) */
  const out = via === 'ladder' ? '' : !task && via === 'create' ? ' File it again on a track (`' + CLI + ' task create --track TR-n`, with the same payload), or with ' + later + '.'
    : !task && via === 'capture' ? ' Capture it again on a track (`' + CLI + ' track capture --track TR-n --name "<the work>"`), or with ' + later + '.'
      : via === 'leftover' ? ' Name ' + later + ' in its place, or leave out unplaced and wake so the step goes on a track.'
      : closing ? ' ' + (via === 'drop' ? 'Drop ' : 'Finish ') + (track || 'the track') + ' again with ' + later + ', or drop its open tasks with it (`'
        + CLI + ' track ' + via + ' ' + (track || 'TR-n') + ' --leftovers drop`).'
        : ' Place ' + (task || 'it') + ' now (`' + CLI + ' task edit ' + (task || '<T-n>') + ' --track TR-n`), or name ' + later + '.';
  const d = typeof raw === 'object' ? raw.date : String(raw).trim();
  if (typeof d === 'string' && DAY_RE.test(d)) {
    if (addDays(d, 0) !== d) throw new TrackRefusal(flag + d + ' is no calendar day');
    if (d <= day) throw new TrackRefusal(flag + d + ' has fired: that day ' + (d === day ? 'is today' : 'has passed') + ' (' + day + '), so ' + who + ' would be due at once.' + out);
    return { date: d };
  }
  const m = typeof raw === 'object' ? null : /^\s*(track-ends|task-completes|question-answered)\s+(\S+)\s*$/i.exec(String(raw));
  const want = m && UNPARK[m[1].toLowerCase()];
  const e = want ? resolveRecord(db, m[2], { kinds: [want] }) : null;
  if (e && ENDS[want].includes(e.front.status)) {
    throw new TrackRefusal(flag + m[1].toLowerCase() + ' ' + e.label + ' has fired: ' + e.label + ' is already ' + e.front.status + ', so ' + who + ' would be due at once.' + out);
  }
  /* the close itself ends the track its leftovers would wait on */
  if (e && closing && want === 'track' && e.label === track) {
    throw new TrackRefusal('--wake track-ends ' + e.label + ' fires with this close, so ' + who + ' would be due at once.' + out);
  }
  return unparkWhenOf(db, raw, flag.trim(), ' or a date YYYY-MM-DD');
}

export const wakeWords = (db, w) => (w && w.date ? w.date : isNextSession(w) ? 'the next session' : unparkWords(db, w));

/* a task on a track waits for the next session, a session other than its filer taking the
   track; stored { kind: 'next-session', session, at }, it reads due from that take (graph.mjs). */
export const NEXT_SESSION = 'next-session';
export const isNextSession = (w) => (typeof w === 'string' ? /^\s*next-session\s*$/i.test(w) : Boolean(w) && typeof w === 'object' && w.kind === NEXT_SESSION);
export const nextSessionWake = (c) => ({ kind: NEXT_SESSION, session: c.session, at: c.at });

/* The day a task with no wake stored entered the inbox: its last move off a track or its
   last unplaced reason, else its birth. */
export function enteredInbox(db, key, created) {
  const r = db.stmt(`SELECT at FROM activity WHERE record = ? AND (json_type(diff, '$.unplaced[1]') = 'text'
    OR (json_type(diff, '$.track') = 'array' AND json_type(diff, '$.track[1]') = 'null')) ORDER BY seq DESC LIMIT 1`).get(key);
  return String((r && r.at) || created || '').slice(0, 10) || null;
}

/* Due once its event ended (or its record went) or its day came; a task with no wake
   stored reads as due 14 days after it entered the inbox (`entered`, a day). */
export function wakeState(db, w, day, entered) {
  if (w && w.date) return { wake: w.date, due: w.date <= day };
  if (w && w.on) {
    const on = db.stmt('SELECT kind, status FROM records WHERE key = ?').get(w.on);
    return { wake: unparkWords(db, w) || whenText(db, w), due: !on || (ENDS[on.kind] || []).includes(on.status) };
  }
  const date = addDays(entered || day, WAKE_DAYS);
  return { wake: date, due: date <= day };
}

/* ---- a third wake goes to the user ---------------------- */

export const WAKE_ASK = 'inbox-wake';
const ASK_PLACE = 'a';
const ASK_DROP = 'c';

/* Its current inbox stay starts at its last move off a track, else its birth (seq 0). */
const stayStart = (db, key) => db.stmt(`SELECT max(seq) AS s FROM activity WHERE record = ? AND json_type(diff, '$.track') = 'array'
  AND json_type(diff, '$.track[1]') = 'null'`).get(key).s || 0;

/* The newest wake question about the task this stay, with how it ended: open, or the seq and pick that ended it. */
export function wakeAsk(db, key, from = stayStart(db, key)) {
  const q = db.stmt(`SELECT r.key, r.label, r.status, (SELECT min(seq) FROM activity WHERE record = r.key) AS born FROM records r WHERE r.kind = 'question'
    AND EXISTS (SELECT 1 FROM json_each(r.fields, '$.gates') WHERE value = ?) AND EXISTS (SELECT 1 FROM json_each(r.fields, '$.labels') WHERE value = ?)
    ORDER BY born DESC LIMIT 1`).get(key, WAKE_ASK);
  if (!q || (q.born || 0) < from) return null;
  if (q.status === 'open' || q.status === 'snoozed') return { id: q.label, key: q.key, open: true };
  const end = db.stmt(`SELECT seq, json_extract(diff, '$.chosen[1]') AS pick FROM activity WHERE record = ? AND verb IN ('answer', 'amend', 'drop')
    ORDER BY seq DESC LIMIT 1`).get(q.key) || {};
  return { id: q.label, key: q.key, open: false, seq: end.seq || 0, pick: q.status === 'answered' ? end.pick || null : null };
}

/* The wakes set on the task this stay (its filing's is the first), after the user's last answer about it. */
export function wakesInStay(db, key) {
  const from = stayStart(db, key);
  const ask = wakeAsk(db, key, from);
  const after = ask && !ask.open ? ask.seq : 0;
  const n = db.stmt(`SELECT count(*) AS n FROM activity WHERE record = ? AND seq >= ? AND seq > ? AND json_type(diff, '$.wake[1]') IN ('text', 'object')`)
    .get(key, from, after).n;
  return { n, ask };
}

/* A task placed or ended: the user's open question about its home is dropped, saying why. */
export function settleWakeAsk(db, key, why, c) {
  if (!isKey(key)) return;
  for (const q of db.stmt(`SELECT r.label FROM records r WHERE r.kind = 'question' AND r.status IN ('open', 'snoozed')
    AND EXISTS (SELECT 1 FROM json_each(r.fields, '$.gates') WHERE value = ?) AND EXISTS (SELECT 1 FROM json_each(r.fields, '$.labels') WHERE value = ?)`).all(key, WAKE_ASK)) {
    dropQuestion(db, { id: q.label, note: why + ', so it needs no answer' }, { by: c.by, pc: c.pc });
  }
}

/* A re-wake of an inbox task: null when it may be stored; else the board stores none, and says why.
   Open question: it waits on it. The user said place or drop: refused with that. Two wakes this stay: the user is asked.
   `bypass` asks nothing and waits on nothing; the user's own answer still stands. */
export function thirdWake(db, task, c, why, bypass = false) {
  const { n, ask } = wakesInStay(db, task.key);
  const id = task.fields.id;
  /* asked is the question as register returns it, the same shape as a placement's */
  if (ask && ask.open && !bypass) {
    const f = loadRecord(db, ask.key).fields;
    return { asked: { id: ask.id, key: ask.key, name: f.name, ask: f.ask }, waits: true };
  }
  if (ask && (ask.pick === ASK_PLACE || ask.pick === ASK_DROP)) {
    throw new TrackRefusal('the user answered ' + ask.id + ': ' + (ask.pick === ASK_PLACE ? 'put ' + id + ' on a track (`' + CLI + ' task edit ' + id + ' --track TR-n`)'
      : 'drop ' + id + ' (`' + CLI + ' task update ' + id + ' --status dropped --note "<the user\'s words>"`)') + ', so it takes no new wake');
  }
  if (bypass || n < 2) return null;
  const ws = task.fields.workstream ? loadRecord(db, task.fields.workstream) : null;
  const repo = ws ? ([].concat(ws.fields.projectRepos || [])[0] || [].concat(ws.fields.projects || [])[0] || ws.fields.name) : 'askerdo';
  const name = String(task.fields.name || '').replace(/\s+/g, ' ').trim();
  const q = askQuestion(db, {
    name: 'A home for ' + id, blocking: false, pick: null, session: c.session || c.by, projectRepo: repo, workstream: ws ? ws.fields.id : undefined, gates: [id], labels: [WAKE_ASK],
    ask: id + ' has been woken twice in the inbox: put it on a track (a), keep it there with a reason and a new wake (b), or drop it (c)?',
    gist: '**' + id + ':** ' + name.slice(0, 160) + '\n**Why it waits:** ' + (why || task.fields.unplaced || 'no reason given') + '\n**Two wakes this stay:** a session set a third, which the board did not store',
    options: [
      { type: 'a', option: 'Put it on a track', getsYou: 'a session places it, on a new parked track when the work starts later' },
      { type: 'b', option: 'Keep it in the inbox', getsYou: 'a session files it again with a reason and a new wake, and the count starts over' },
      { type: 'c', option: 'Drop it', getsYou: 'it leaves the inbox for good' },
    ],
  }, { by: c.by, pc: c.pc, ...(c.session ? { session: c.session } : {}) });
  return { asked: q };
}

/* ---- the rules ------------------------------------------------------------- */

/* A woken line's stall clock starts at the wake (its `updated`), or it would draw a stall call at once. */
function unpark(db, rec, ctx, cause) {
  const was = rec.fields.unparkWhen;
  const diff = writeFront(db, rec, { status: 'open', parkReason: undefined, unparkWhen: undefined, updated: ctx.at }, KEY_ORDERS.track);
  if (diff.unparkWhen) diff.unparkWhen = [whenText(db, was), null];
  logLine(db, { at: ctx.at, verb: 'edit', kind: 'track', rec: headOf(rec), changes: diff, by: BY, pc: ctx.pc, note: 'unparked: ' + cause });
}

/* Inside another record's write, so an open step cannot throw: the task stays open and says why. */
function closeOne(db, t, ctx, cause) {
  if (ENDED_TASK.includes(t.fields.status)) return;
  const open = openSteps(db, t.key);
  const held = runsHolding(db, t.key, ctx.session);
  if (open.length || held.length) {
    const why = 'not closed with ' + cause + ': ' + (open.length ? stepsRefusal(t.fields.id, open).message
      : heldWords(t.fields.id, held, ctx) + ', which only that session or a take-over with the user\'s word ends it');
    addNote(db, t.key, { at: ctx.at, actor: BY, body: why });
    logLine(db, { at: ctx.at, verb: 'note', kind: 'task', rec: headOf(t), changes: {}, by: BY, pc: ctx.pc, note: why });
    return;
  }
  endTask(db, t, 'done', ctx, { by: BY, note: 'closed with ' + cause });
}

/* Every ending (questions.mjs wakeLinked): the parked lines waiting on it
   unpark, and a done task closes the tasks that close with it. */
export function onEnding(db, ended, ending, ctx) {
  /* an ended task's open question about its home goes with it, upkeep or not */
  if (/^(done|dropped)\b/.test(String(ending)) && /^T-\d+$/.test(String(ended.id || ''))) settleWakeAsk(db, ended.key, ended.id + ' was ' + String(ending).split(' ')[0], ctx);
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
  if (kind !== 'task' || word !== 'done') return;
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
  return st && st[1] === 'done' ? 'close' : line.verb;
}

/* What switching on does to the board as it stands: the rules applied to data
   written while they were off, the endings cascading as they would live. */
function catchUp(db, ctx) {
  const from = lastSeq(db);
  setMeta(db, SETTING, 'on');
  for (const r of db.stmt(`SELECT t.key, o.label FROM records t JOIN records o ON o.key = json_extract(t.fields, '$.close.on')
      WHERE t.kind = 'task' AND json_extract(t.fields, '$.close.kind') = 'with' AND o.status = 'done'`).all()) {
    closeOne(db, loadRecord(db, r.key), ctx, r.label + ' done');
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
      WHERE r.kind IN ('workstream', 'task') AND ((r.kind = 'task' AND ${openRunSql('r.key', { session: true, worker: 'session' })})
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
/* `does`: what the press does, said on Home's tooltip */
const keep = (key, since) => ({ label: 'Keep', verb: 'bandKeep', input: { record: key, since }, does: 'hides this call until its fact changes; nothing on the board moves' });

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
  const live = db.stmt(`SELECT count(*) AS n FROM records WHERE workstream = ? AND ((kind = 'task' AND coalesce(status, '') NOT IN ('done', 'dropped'))
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

function callsOf(db, scope, nowMs) {
  const rows = [];
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

/* The judgment rows, then the override requests and the sealed scrubs. */
const allCalls = (db, scope, nowMs, session) => callsOf(db, scope, nowMs).concat(overrideCalls(db, session, scope, nowMs));

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
    logLine(db, { at: c.at, verb: 'edit', kind: rec.kind, rec: headOf(rec), changes: { kept: [was, since] }, by: c.by, pc: c.pc, note: 'kept off Home until it changes' });
    return { id: rec.fields.id, key: rec.key, kept: since };
  });
}
