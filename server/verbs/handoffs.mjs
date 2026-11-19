/* Handoffs on tracks: a handoff is a
   checkpoint TR-n.m on its track. Writing one supersedes the live one before it
   and lets the session's lease go, so the track reads waiting (or parked);
   resuming takes the lease back and marks it resumed. The board keeps only each
   repo's verify-first summary: the loose-file, worktree and branch lists stay on the PC. */
import { tx, readTx } from '../db.mjs';
import { actorOf, clockOf, isFullStamp, kebab, logVerb, mintKey, pcOfCall, putHandoff, unguardHeadings } from '../records.mjs';
import { TrackRefusal, loadRecord, recordOf, trackGraph } from './graph.mjs';
import { resolveRecord } from './labels.mjs';
import {
  CHAIN_NO, NEWEST_FIRST, acquireLease, chainOf, holderPlain, isStalled, noHandoff, openLeaves, parkTrack, projectInbox, quietSince, releaseLease, splinter, stateOf, takeOver, unparkOf, MOVES,
} from './tracks.mjs';
import { CLI, UNTAKEN_MAX, ageText, checkpointOf, goalNote, growthLines, kickoffInput, kickoffText, mentions, untakenTracks, workstreamHead } from './kickoff.mjs';
import { foundWork, inboxOffers } from './found.mjs';
import { reviewHead, trackReview } from './coverage.mjs';
import { handKeys, letGoHand, noteRecord, restateGoal } from './work.mjs';
import { applyOps, cutLines, opsProblems, staleToolsLine, stateProblems, waitingOf, whereProblems } from '../handoff-text.mjs';
import { layLeftovers } from './leftovers.mjs';
import { workersOf } from './runs.mjs';
import { boardVersion } from '../version.mjs';

/* Today's budgets (lib/handoff-payload.mjs). A focus, state or whereWeWere over its
   budget is stored as sent and the PC's result asks for a patch; the request body bounds them. */
export const FOCUS_MAX = 400;
export const LINE_MAX = 400;
export const STATE_BYTES = 10240;
export const WHERE_BYTES = 4096;
export const GOAL_MAX = 600;
const LIVE = ['waiting', 'parked'];
const CLOSED = ['done', 'dropped', 'folded'];
/* inHand: the session's tasks in hand at the handoff, as keys, newest first */
/* silentInHand: those of them with nothing written on them that leg */
export const HANDOFF_KEYS = Object.freeze(['id', 'key', 'track', 'pc', 'status', 'focus', 'waitingOnUser', 'rulings', 'fromSession', 'inHand', 'silentInHand',
  'depthAtHandoff', 'growth', 'chain', 'parkReason', 'nextPc', 'resumedBy', 'resumed', 'supersededBy', 'created', 'updated', 'goal', 'goalWas']);
/* the summary a repo carries on the board; files and snapshots are refused */
/* remote: the repo's shared name, so a PC that holds it at another path finds it */
const VERIFY_KEYS = ['path', 'remote', 'branch', 'worktree', 'commit', 'ok', 'problems'];

/* blank lines and the end trimmed, never a line's leading space: the PC's heading guard is one */
const NL = String.fromCharCode(10);
export const edgeTrim = (s) => { const ls = String(s).trimEnd().split(NL); while (ls.length && !ls[0].trim()) ls.shift(); return ls.join(NL); };
const text = (v) => typeof v === 'string' && v.trim() !== '';
const oneLine = (v) => text(v) && !/[\r\n]/.test(v) && v.trim().length <= LINE_MAX;

/* "R3: text" or "R3 (registered Q61): text", and back (lib/handoff-payload.mjs). */
export const rulingLine = (r) => r.id + (r.registered ? ' (registered ' + r.registered + ')' : '') + ': ' + r.text;
export function parseRuling(line) {
  const m = /^(R[1-9]\d{0,5})(?: \(registered ([^()]*)\))?: ([\s\S]*)$/.exec(String(line || ''));
  return m ? { id: m[1], text: m[3], ...(m[2] ? { registered: m[2] } : {}) } : null;
}

function ordered(fields) {
  const out = {};
  for (const k of HANDOFF_KEYS) if (fields[k] !== undefined && fields[k] !== null && fields[k] !== '') out[k] = fields[k];
  return out;
}

function checkVerify(list) {
  if (!Array.isArray(list) || !list.length) throw new TrackRefusal('a handoff needs its verify-first summary: one entry per repo with its path');
  return list.map((e, i) => {
    const at = 'verify[' + i + ']';
    if (!e || typeof e !== 'object' || Array.isArray(e)) throw new TrackRefusal(at + ' must be an object');
    for (const k of Object.keys(e)) {
      if (!VERIFY_KEYS.includes(k)) throw new TrackRefusal(at + ' does not take ' + k + ': the board keeps ' + VERIFY_KEYS.join(', ') + ', the loose-file, worktree and branch lists stay on the PC');
    }
    if (!text(e.path)) throw new TrackRefusal(at + '.path is required: the repo directory');
    const out = { path: e.path.trim() };
    for (const k of ['remote', 'branch', 'worktree', 'commit']) if (text(e[k])) out[k] = e[k].trim();
    out.ok = e.ok !== false;
    if (Array.isArray(e.problems) && e.problems.length) out.problems = e.problems.map((p) => String(p).replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 10);
    return out;
  });
}

/* the repo half the PC counted; the board counts the tasks itself. */
const REPO_GROWTH = ['repos', 'testsAdded', 'testsRemoved', 'linesAdded', 'linesRemoved', 'noBaseline', 'notCounted'];
function repoHalf(g) {
  if (g === undefined || g === null) return {};
  if (typeof g !== 'object' || Array.isArray(g)) throw new TrackRefusal('handoff write: growth must be an object');
  const out = {};
  for (const [k, v] of Object.entries(g)) {
    if (!REPO_GROWTH.includes(k)) throw new TrackRefusal('handoff write: growth takes ' + REPO_GROWTH.join(', ') + ', not ' + k);
    if (v === undefined || v === null) continue;
    if (!Number.isSafeInteger(v) || v < 0) throw new TrackRefusal('handoff write: growth.' + k + ' is a whole number of at least 0');
    out[k] = v;
  }
  return out;
}

/* The track's tasks created and closed since the previous handoff (else the
   track's start) up to this one, the added ones as keys in created order. */
function taskGrowth(db, trackKey, since, until) {
  const t0 = Date.parse(since || '');
  const t1 = Date.parse(until || '');
  const inside = (s) => {
    const t = Date.parse(s || '');
    return Number.isFinite(t) && (!Number.isFinite(t0) || t > t0) && (!Number.isFinite(t1) || t <= t1);
  };
  const rows = db.stmt(`SELECT r.key, r.id, json_extract(r.fields, '$.created') AS created, json_extract(r.fields, '$.closed') AS closed
    FROM track_items ti JOIN records r ON r.key = ti.task WHERE ti.track = ?`).all(trackKey);
  const added = rows.filter((r) => inside(r.created)).sort((a, b) => Date.parse(a.created) - Date.parse(b.created) || a.id - b.id);
  /* the tasks the track's sessions filed off this track, so the handoff says where they went */
  const here = new Set(rows.map((r) => r.key));
  const found = foundWork(db, trackKey, { since: since || undefined, until: until || undefined }).tasks.filter((t) => !here.has(t.key)).map((t) => t.key);
  return { tasksAdded: added.length, tasksClosed: rows.filter((r) => inside(r.closed)).length, added: added.map((r) => r.key).join(' ') || undefined,
    found: found.join(' ') || undefined };
}

/* The payload as the PC's check left it; refusals name the field. */
/* the keys a current caller sends; an older session's renamed key is refused, never dropped */
const WRITE_KEYS = ['track', 'focus', 'state', 'whereWeWere', 'rulings', 'waitingOnUser', 'verify', 'depth', 'session', 'pc', 'status', 'parkReason', 'created', 'growth', 'leftovers', 'taskNotes', 'nextPc', 'goal'];

/* the board never learns the caller's version, so a name a release stopped
   sending is what says the caller is older: name, first release without it */
const RETIRED_KEYS = { waitingOnUser: '0.8.13' };

function checkPayload(input) {
  const e = [];
  const odd = Object.keys(input).filter((k) => !WRITE_KEYS.includes(k));
  const before = odd.map((k) => RETIRED_KEYS[k]).find(Boolean);
  if (odd.length) e.push(odd.map((k) => 'unknown field "' + k + '"').join('; ') + '; ' + staleToolsLine(boardVersion(), before));
  if (!text(input.focus) || /[\r\n]/.test(input.focus)) e.push('focus is one line');
  if (!text(input.state)) e.push('state is required');
  if (input.whereWeWere !== undefined && input.whereWeWere !== null && input.whereWeWere !== '' && !text(input.whereWeWere)) e.push('whereWeWere is text');
  const waiting = input.waitingOnUser === undefined ? [] : input.waitingOnUser;
  const dropOf = (w) => (w && typeof w === 'object' && !Array.isArray(w) && Object.keys(w).length === 1 ? w.drop : undefined);
  if (!Array.isArray(waiting) || !waiting.every((w) => oneLine(w) || oneLine(dropOf(w)))) e.push('waitingOnUser is a list of lines of at most ' + LINE_MAX + ', or { drop: a carried line }');
  const status = input.status === undefined ? 'waiting' : input.status;
  if (!LIVE.includes(status)) e.push('a new handoff is waiting or parked');
  if (status === 'parked' && !text(input.parkReason)) e.push('a parked handoff needs a parkReason');
  if (status === 'waiting' && input.parkReason) e.push('parkReason belongs to a parked handoff');
  if (input.created !== undefined && !isFullStamp(input.created)) e.push('created is a full local stamp');
  if (input.taskNotes !== undefined && !(Array.isArray(input.taskNotes) && input.taskNotes.every(taskNoteOk))) e.push(TASK_NOTES);
  if (input.goal !== undefined && input.goal !== null && (!text(input.goal) || input.goal.trim().length > GOAL_MAX)) e.push('goal is what the track is doing now, text of at most ' + GOAL_MAX + ' characters');
  if (e.length) throw new TrackRefusal('handoff write: ' + e.join('; '));
  return { status, waiting: waiting.filter((w) => typeof w === 'string').map((w) => w.trim()), drops: waiting.filter((w) => typeof w !== 'string').map((w) => w.drop.trim()) };
}

/* a task in hand gets its note (and a new description or intent) in the handoff's own call */
const TASK_NOTES = 'taskNotes is a list of { id: T-n, note, description?, intent? }';
const NOTE_KEYS = ['id', 'note', 'description', 'intent'];
const taskNoteOk = (t) => !!t && typeof t === 'object' && !Array.isArray(t) && Object.keys(t).every((k) => NOTE_KEYS.includes(k))
  && typeof t.id === 'string' && /^T-\d+$/i.test(t.id.trim()) && text(t.note) && ['description', 'intent'].every((k) => t[k] === undefined || text(t[k]));

/* The tasks in hand with nothing written on them since `since` (the session's lease on the
   track, else each task's own time in hand): a note or a rewrite, which comes with a note. */
function silentInHand(db, session, since) {
  const who = workersOf(db, handKeys(db, session));
  return [...who.keys()].filter((key) => {
    const t0 = Date.parse(since || who.get(key).inHandSince || '');
    if (!Number.isFinite(t0)) return false;
    return !db.stmt('SELECT at FROM notes WHERE record = ?').all(key).some((n) => Date.parse(n.at) >= t0);
  });
}

/* The latest handoff's waits carry into the next until the writer drops each, as rulings
   carry until registered; a line given again is not doubled. */
const flatWait = (s) => String(s).replace(/\s+/g, ' ').trim();
/* a carried line is settled once every question it names is answered or dropped, by the kickoff's test */
function settledWait(db, w) {
  const ids = [...new Set([...w.matchAll(/\bQ-?(\d+)\b/gi)].map((m) => 'Q' + Number(m[1])))].filter((id) => mentions(w, id));
  /* a label is reused once its old holder rests, so read the holder it names today */
  return ids.length > 0 && ids.every((id) => ['answered', 'dropped'].includes((resolveRecord(db, id, { kinds: ['question'] }) || { fields: {} }).fields.status));
}
function carryWaits(db, prev, given, drops) {
  const was = prev ? waitingOf(prev.fields).map(flatWait) : [];
  const gone = drops.map(flatWait);
  const stray = gone.filter((d) => !was.includes(d));
  if (stray.length) {
    throw new TrackRefusal('waitingOnUser: ' + stray.map((d) => '"' + d + '"').join(', ') + (stray.length === 1 ? ' is' : ' are') + ' not a wait the latest handoff carries'
      + (was.length ? '; its waits: ' + was.map((w) => '"' + w + '"').join(', ') : '; it carries none'));
  }
  const left = was.filter((w) => !gone.includes(w));
  const settled = left.filter((w) => settledWait(db, w));
  const kept = left.filter((w) => !settled.includes(w));
  const fresh = given.map(flatWait).filter((w, i, all) => !kept.includes(w) && all.indexOf(w) === i);
  return { waiting: [...kept, ...fresh], carried: kept.filter((w) => !given.map(flatWait).includes(w)), settled };
}

/* the latest handoff's unregistered rulings carry into the next until the
   writer marks each registered; a new one takes the next R number. */
function carryRulings(chain, given) {
  const read = (h) => (h.fields.rulings || []).map(parseRuling).filter(Boolean);
  let top = chain.flatMap(read).reduce((n, r) => Math.max(n, Number(r.id.slice(1))), 0);
  const prev = chain.length ? read(chain[chain.length - 1]).filter((r) => !r.registered) : [];
  const list = Array.isArray(given) ? given : [];
  const norm = list.map((g) => (typeof g === 'string' ? { text: g.trim() } : g && typeof g === 'object' ? g : null));
  if (norm.some((g) => !g || (!text(g.id) && !text(g.text)))) throw new TrackRefusal('rulings: a string, or { id, registered }, or { text, registered }');
  const marks = new Map(norm.filter((g) => g.id).map((g) => [g.id.trim(), text(g.registered) ? g.registered.trim() : '']));
  for (const [id, reg] of marks) {
    if (!prev.some((r) => r.id === id)) throw new TrackRefusal('rulings: ' + id + ' is not an unregistered ruling of the latest handoff');
    if (!reg) throw new TrackRefusal('rulings: ' + id + ' needs where it was registered');
  }
  const out = prev.map((r) => (marks.has(r.id) ? { ...r, registered: marks.get(r.id) } : r));
  for (const g of norm.filter((x) => !x.id)) {
    const t = g.text.trim();
    const same = out.find((r) => r.text === t);
    if (same) { if (text(g.registered) && !same.registered) same.registered = g.registered.trim(); continue; }
    top += 1;
    out.push({ id: 'R' + top, text: t, ...(text(g.registered) ? { registered: g.registered.trim() } : {}) });
  }
  return out;
}

const ROW = 'SELECT key, slug, fields, state, where_we_were, verify, track, pc FROM handoffs';
const rowOf = (r) => (r ? { ...r, fields: JSON.parse(r.fields), verify: JSON.parse(r.verify) } : null);
const chainRows = (db, trackKey) => db.stmt(ROW + ' WHERE track = ? ORDER BY ' + CHAIN_NO + ', id').all(trackKey).map(rowOf);
const liveOf = (db, trackKey) => rowOf(db.stmt(ROW + " WHERE track = ? AND json_extract(fields, '$.status') IN ('waiting', 'parked') ORDER BY " + NEWEST_FIRST + ' LIMIT 1').get(trackKey));
const save = (db, h) => putHandoff(db, { key: h.key, slug: h.slug, fields: h.fields, state: h.state, whereWeWere: h.where_we_were, verify: h.verify });

function line(db, c, verb, h, changes, note) {
  logVerb(db, { ts: c.at, verb, kind: 'handoff', id: h.fields.id, key: h.key, name: h.fields.focus, changes, by: c.by, pc: c.pc, note });
}

/* A handoff as a reader gets it: labels, not keys, and rulings parsed. */
export function handoffPayload(db, h) {
  const f = h.fields;
  const lab = (k) => (k ? (loadRecord(db, k) || { fields: { id: k } }).fields.id : undefined);
  const sup = f.supersededBy ? db.stmt('SELECT label FROM handoffs WHERE key = ?').get(f.supersededBy) : null;
  return {
    ...f, kind: 'handoff', track: lab(f.track) || h.track, ...(sup ? { supersededBy: sup.label } : {}),
    ...(Array.isArray(f.inHand) ? { inHand: f.inHand.map((k) => lab(k) || k) } : {}),
    /* one written on since the handoff is no longer silent */
    ...(Array.isArray(f.silentInHand) ? { silentInHand: f.silentInHand.filter((k) => !db.stmt('SELECT at FROM notes WHERE record = ?').all(k).some((n) => Date.parse(n.at) >= Date.parse(f.created)))
      .map((k) => { const r = loadRecord(db, k); return { id: r ? r.fields.id : k, name: r ? r.fields.name || '' : '' }; }) } : {}),
    ...(f.growth ? { growth: { ...f.growth, since: f.growth.since ? handoffLabel(db, f.growth.since) : undefined } } : {}),
    waitingOnUser: waitingOf(f), rulings: (f.rulings || []).map(parseRuling).filter(Boolean),
    state: h.state, ...(h.where_we_were ? { whereWeWere: unguardHeadings(h.where_we_were) } : {}), verify: h.verify,
  };
}

const handoffLabel = (db, key) => (db.stmt('SELECT label FROM handoffs WHERE key = ?').get(key) || { label: key }).label;

const ending = (c) => (c ? Number((/\.(\d+)$/.exec(String(c.fields.id || '')) || [])[1]) || 0 : 0);

/* the board's no to a handoff leads with this, so the mod's handoff_write tells
   the session to fix what it names and send it again, never to carry it as unwritten. */
export const REFUSED = 'the board refused this handoff and wrote nothing';
const isRefusal = (e) => !!e && (e.name === 'TrackRefusal' || (e.constructor && e.constructor.name === 'UsageError'));

/* the PCs the board knows by name: live device tokens, and the PCs its leases,
   handoffs and project maps name (a board with no tokens knows its PCs that way). */
function pcsKnown(db, caller) {
  const names = new Set();
  const add = (v) => { if (typeof v === 'string' && v.trim()) names.add(v.trim()); };
  for (const r of db.stmt('SELECT DISTINCT device FROM tokens WHERE revoked IS NULL').all()) add(r.device);
  for (const t of ['leases', 'handoffs']) for (const r of db.stmt('SELECT DISTINCT pc FROM ' + t).all()) add(r.pc);
  for (const r of db.stmt("SELECT name FROM meta WHERE name LIKE 'pc.map.%'").all()) add(r.name.slice('pc.map.'.length));
  add(caller);
  return [...names].sort((a, b) => a.localeCompare(b));
}

/* a name as the board spells it, any case; one it does not know is refused with those it does */
function knownPc(db, name, caller) {
  const want = String(name).trim();
  const all = pcsKnown(db, caller);
  const hit = all.find((n) => n.toLowerCase() === want.toLowerCase());
  if (!hit) throw new TrackRefusal('nextPc names ' + want + ', a PC the board does not know; it knows ' + (all.length ? all.join(', ') : 'none yet'));
  return hit;
}

/* writeHandoff(db, { track, focus, state, whereWeWere, rulings, waitingOnUser,
   verify, depth, session, pc, status, parkReason, created, leftovers }, actor). */
export function writeHandoff(db, input = {}, actor) {
  try {
    return writeOn(db, input, actor);
  } catch (e) {
    if (isRefusal(e)) throw new TrackRefusal(REFUSED + ': ' + e.message, e.data);
    throw e;
  }
}

function writeOn(db, input, actor) {
  const { status, waiting: given, drops } = checkPayload(input || {});
  const verify = checkVerify(input.verify);
  const repoGrowth = repoHalf(input.growth);
  return tx(db, () => {
    const c = actorOf(actor);
    const rec = recordOf(db, input.track, 'track');
    if (CLOSED.includes(rec.fields.status)) throw new TrackRefusal(rec.fields.id + ' is ' + rec.fields.status + '; a closed track takes no handoff');
    const session = (text(input.session) && input.session.trim()) || c.session || '';
    const pc = pcOfCall(input, c) || '';
    const nextPc = input.nextPc === undefined || input.nextPc === null || input.nextPc === '' ? undefined : knownPc(db, input.nextPc, pc);
    /* the steps left go on the track before the handoff lands; the state carries the thinking */
    const none = input.leftovers === undefined || input.leftovers === null || (Array.isArray(input.leftovers) && !input.leftovers.length);
    const chain = chainRows(db, rec.key);
    const m = chain.reduce((top, h) => Math.max(top, ending(h)), 0) + 1;
    const lay = none ? null : layLeftovers(db, { track: rec, workstream: rec.fields.workstream, why: 'work for later, laid out by the handoff on ' + rec.fields.id, session, via: 'handoff' }, input.leftovers, actor);
    const laid = lay ? lay.steps : null;
    const rulings = carryRulings(chain, input.rulings);
    const d = input.depth && typeof input.depth === 'object' ? input.depth : null;
    const depth = d && (Number.isFinite(d.tokens) || Number.isFinite(d.percent))
      ? { ...(Number.isFinite(d.tokens) ? { tokens: Math.round(d.tokens) } : {}), ...(Number.isFinite(d.percent) ? { percent: Math.round(d.percent) } : {}) } : undefined;
    const key = mintKey(db);
    const focus = input.focus.trim();
    const created = input.created || c.at;
    const prev = chain.length ? chain[chain.length - 1] : null;
    const { waiting, carried, settled } = carryWaits(db, prev, given, drops);
    const growth = { since: prev ? prev.key : undefined, ...taskGrowth(db, rec.key, prev ? prev.fields.created : rec.fields.created, created), ...repoGrowth };
    /* the handoff carries the session's tasks in hand, read from the board; each lets go for the resume */
    for (const t of input.taskNotes || []) noteRecord(db, { id: t.id.trim(), text: t.note, description: t.description, intent: t.intent }, actor);
    const mineSince = session ? (db.stmt('SELECT since FROM leases WHERE track = ? AND session = ?').get(rec.key, session) || {}).since : null;
    const silent = session ? silentInHand(db, session, mineSince) : [];
    const hand = session ? letGoHand(db, session, actor, 'handed off at ' + rec.fields.id + '.' + m, key) : [];
    /* the session's runs with a branch, ended by this write or still open (its agents'), for the PC's remote check */
    const runs = session ? db.stmt(`SELECT id, worker, job, pc, repo, branch, ended, how FROM runs WHERE session = ? AND branch IS NOT NULL AND branch <> ''
      AND (handoff = ? OR ended IS NULL) ORDER BY id`).all(session, key).map((r) => ({ run: r.id, worker: r.worker, job: r.job, pc: r.pc, repo: r.repo, branch: r.branch, ended: r.ended, how: r.how })) : [];
    /* a goal restated at the handoff amends the track's as a note does, the handoff its why */
    const goal = text(input.goal) ? input.goal.trim() : undefined;
    const amended = goal ? restateGoal(db, resolveRecord(db, rec.fields.id, { kinds: ['track'] }), goal, goalNote(rec.fields.id + '.' + m), c) : null;
    /* a track born with no goal keeps its name in that section, which was never a goal to restate */
    const goalWas = rec.fields.goal ? amended : null;
    const h = {
      key, slug: kebab(focus, 'handoff'), state: input.state.trim(), where_we_were: text(input.whereWeWere) ? edgeTrim(input.whereWeWere) : null, verify,
      fields: ordered({
        id: rec.fields.id + '.' + m, key, track: rec.key, pc, status, focus, waitingOnUser: waiting, rulings: rulings.map(rulingLine),
        fromSession: session, inHand: hand.length ? hand : undefined, silentInHand: silent.length ? silent : undefined, depthAtHandoff: depth, growth, chain: chainOf(db, rec.key).text, parkReason: status === 'parked' ? input.parkReason.trim() : undefined,
        nextPc, created, updated: c.at, goal, goalWas: goalWas ?? undefined,
      }),
    };
    save(db, h);
    line(db, c, 'create', h, { status: [null, status], focus: [null, focus], track: [null, rec.key] });
    const superseded = [];
    for (const old of chain) {
      if (!LIVE.includes(old.fields.status)) continue;
      const was = old.fields.status;
      old.fields = ordered({ ...old.fields, status: 'superseded', supersededBy: key, updated: c.at });
      save(db, old);
      line(db, c, 'edit', old, { status: [was, 'superseded'], supersededBy: [null, key] });
      superseded.push(old.fields.id);
    }
    /* the lease goes with the handoff, so the track reads waiting, or parked */
    const held = db.stmt('SELECT session, pc, since, seen FROM leases WHERE track = ?').get(rec.key);
    const mine = held && session && held.session === session;
    let warning;
    let junction;
    if (held && !mine) {
      warning = rec.fields.id + ' is held by ' + holderPlain(db, rec.key, held, { now: c.date.getTime(), pc: c.pc }) + ', not this session; this handoff still landed'
        + (superseded.length ? ' and replaced ' + superseded.join(', ') : '') + '. Tell the user if that session is still working on it.';
    } else if (status === 'parked') junction = parkTrack(db, { track: rec.key, reason: h.fields.parkReason, session }, actor).junction;
    else if (mine) releaseLease(db, { session, track: rec.key, reason: 'handed off at ' + h.fields.id }, actor);
    const after = loadRecord(db, rec.key);
    const shown = handoffPayload(db, h);
    const ws = after.fields.workstream ? loadRecord(db, after.fields.workstream) : null;
    /* the inbox the kickoff listed; each due item owed here carries the board's call, printed once */
    const inbox = inboxOffers(db, projectInbox(db, after.fields.workstream, c.day), { held: rec.key, wsKey: after.fields.workstream });
    return {
      ...shown, superseded, released: Boolean(mine), ...(runs.length ? { runs } : {}), trackState: stateOf(db, after), ...(carried.length ? { carriedWaits: carried } : {}), ...(settled.length ? { settledWaits: settled } : {}),
      growthLines: growthLines(db, shown.growth, { held: rec.key, day: c.day, inbox, calledAt: 'under the inbox\'s Place each line' }),
      ...(laid ? { laidOut: laid, steps: laid.map((t) => (t.asked && !t.id ? { step: t.step, asked: t.asked } : { step: t.step, id: t.id })) } : {}), ...(lay && lay.parked.length ? { parkedTracks: lay.parked } : {}),
      /* read after the leftovers are laid, so the reply confirms or wires each */
      leaves: openLeaves(db, rec.key),
      /* the review readout, worded by the PC (reviewLine) */
      review: reviewHead(trackReview(db, rec.key)), checkpoint: checkpointOf(db, rec.key),
      workstream: workstreamHead(ws),
      inbox,
      /* the workstream's tracks with ready work no session holds, for the reply to name */
      untaken: untakenTracks(db, after.fields.workstream, rec.key, null, c.date.getTime()),
      resume: '/askerdo resume ' + rec.fields.id,
      next: 'Hand the user this line in a copy block' + (nextPc ? ', to run on ' + nextPc : '') + ': /askerdo resume ' + rec.fields.id,
      ...(warning ? { warning } : {}), ...(junction && junction.track ? { junction } : {}),
    };
  });
}

/* a patch's refusals lead with this, as a write's lead with REFUSED */
export const UPDATE_REFUSED = 'the board refused this update and changed nothing';
const MAX = { state: STATE_BYTES, where: WHERE_BYTES, line: LINE_MAX, focus: FOCUS_MAX };
/* the byte budgets ask for a patch rather than refuse one */
const SOFT = { ...MAX, state: Infinity, where: Infinity };
const HANDOFF_ID = /^TR-\d+\.\d+$/i;
const textProblems = (state, where, held) => [...stateProblems(state || '', SOFT, held), ...(text(where) ? whereProblems(where, SOFT) : [])];

/* updateHandoff(db, { id, session, pc, ops }, actor): the track's last handoff patched in
   place while it waits or is parked, keeping its id and depth (lib/handoff-payload.mjs
   updateProblems names the ops); once resumed, refused naming the track's holder. */
export function updateHandoff(db, input = {}, actor) {
  try {
    return updateOn(db, input || {}, actor);
  } catch (e) {
    if (isRefusal(e)) throw new TrackRefusal(UPDATE_REFUSED + ': ' + e.message, e.data);
    throw e;
  }
}

/* after a resume the news goes in a note on the track, told to its holder */
function noLongerLive(db, rec, h, c) {
  const id = rec.fields.id;
  const lease = db.stmt('SELECT session, pc, since, seen FROM leases WHERE track = ?').get(rec.key);
  return new TrackRefusal(h.fields.id + ' was ' + h.fields.status + ', so it is no longer patched'
    + (lease ? '; ' + holderPlain(db, rec.key, lease, { now: c.date.getTime(), pc: c.pc }) + ' holds ' + id + ' now. Put what changed in a note on ' + id + ' (note ' + id + '), which reaches that session at its next prompt'
      : '. Put what changed in a note on ' + id + ' (note ' + id + '); no session holds it now, so the note waits in its journal') + '.',
  { holder: lease ? { session: lease.session, pc: lease.pc || null } : null, note: id });
}

function updateOn(db, input, actor) {
  const shape = opsProblems(input.ops, MAX);
  if (shape.length) throw new TrackRefusal(shape.join('; '));
  /* a repo's summary alone, as on a write; the loose-file, worktree and branch lists stay on the PC */
  const ops = input.ops.map(({ op, ...rest }) => (op === 'verifyFirst' ? { op, ...checkVerify([rest])[0] } : { op, ...rest }));
  return tx(db, () => {
    const c = actorOf(actor);
    const ref = String(input.id ?? '').trim();
    let named = null;
    if (HANDOFF_ID.test(ref)) {
      const e = resolveRecord(db, ref, { kinds: ['handoff'] });
      if (!e) throw new TrackRefusal('no handoff ' + ref);
      named = e.key;
    }
    const rec = recordOf(db, named ? db.stmt('SELECT track FROM handoffs WHERE key = ?').get(named).track : ref, 'track');
    const id = rec.fields.id;
    if (CLOSED.includes(rec.fields.status)) throw new TrackRefusal(id + ' is ' + rec.fields.status + '; a closed track takes no handoff');
    const chain = chainRows(db, rec.key);
    const h = chain.length ? chain[chain.length - 1] : null;
    if (!h) throw new TrackRefusal(id + ' has no handoff yet; write one with handoff write ' + id);
    if (named && named !== h.key) throw new TrackRefusal(ref.toUpperCase() + ' is not the last handoff of ' + id + '; only ' + h.fields.id + ' is patched');
    if (!LIVE.includes(h.fields.status)) throw noLongerLive(db, rec, h, c);
    const pc = pcOfCall(input, c) || '';
    if (h.fields.pc && pc && pc !== h.fields.pc && ops.some((o) => o.op === 'verifyFirst')) {
      throw new TrackRefusal('the loose-file, worktree and branch lists of ' + h.fields.id + ' stay on ' + h.fields.pc + ', so its verifyFirst is refreshed there');
    }
    const p = applyOps({ focus: h.fields.focus, state: h.state, whereWeWere: h.where_we_were, waitingOnUser: waitingOf(h.fields), verify: h.verify }, ops);
    if (p.problems.length) throw new TrackRefusal(p.problems.join('; '));
    /* the write's budgets and prose-order check on the patched text; what was there already stands,
       a stored line by its text, since a patch above it moves its number */
    const was = textProblems(h.state, h.where_we_were);
    const fresh = textProblems(p.state, p.whereWeWere, new Set(cutLines(h.state || '', LINE_MAX).map(([, l]) => l))).filter((x) => !was.includes(x));
    if (fresh.length) throw new TrackRefusal(fresh.join('; '));
    h.state = p.state.trim();
    h.where_we_were = text(p.whereWeWere) ? edgeTrim(p.whereWeWere) : null;
    h.verify = p.verify;
    /* the last nextPc op wins; '' clears it */
    const setPc = ops.filter((o) => o.op === 'nextPc').pop();
    const nextPc = !setPc ? h.fields.nextPc : setPc.pc.trim() ? knownPc(db, setPc.pc, pc) : undefined;
    h.fields = ordered({ ...h.fields, focus: p.focus, nextPc, waitingOnUser: p.waitingOnUser, updated: c.at });
    save(db, h);
    line(db, c, 'edit', h, Object.fromEntries(Object.entries(p.changes).map(([k, v]) => [k, [null, v]])));
    return { ...handoffPayload(db, h), changed: p.changes, trackState: stateOf(db, loadRecord(db, rec.key)) };
  });
}

const MOVE_WORDS = { 'take over': 'take over', 'take-over': 'take over', takeover: 'take over', splinter: 'splinter', 'read only': 'read only', 'read-only': 'read only', readonly: 'read only' };

function moveOf(input) {
  if (input.move === undefined || input.move === null || input.move === '') return null;
  const m = MOVE_WORDS[String(input.move).toLowerCase().replace(/_/g, ' ').trim()];
  if (!m) throw new TrackRefusal('a move is one of ' + MOVES.join(', '));
  return m;
}

const holderText = (id, words) => id + ' is held by ' + words;

function movesNext(id) {
  return 'Tell the user who holds it and offer the three moves: splinter from it (`' + CLI + ' resume ' + id + ' --splinter "<name>" --session <own-id>`),'
    + ' take it over (`--take-over`, the other session hears so at its next prompt), or read only (`--read-only`).';
}

/* resumeTrack(db, { track, session, pc, move, name, goal, reason }, actor): takes
   the lease and marks the live handoff resumed, returning the kickoff. On a
   track another session holds it returns the holder and the three moves, and
   takes over or splinters only when `move` says so. */
export function resumeTrack(db, input = {}, actor) {
  const move = moveOf(input);
  return tx(db, () => {
    const c = actorOf(actor);
    const opts = { now: c.date };
    const rec = recordOf(db, input.track, 'track');
    const id = rec.fields.id;
    const session = (text(input.session) && input.session.trim()) || c.session || '';
    if (session) opts.reader = session;
    const pc = pcOfCall(input, c);
    const lease = db.stmt('SELECT session, pc, since, seen FROM leases WHERE track = ?').get(rec.key);
    const nowMs = c.date.getTime();
    const holder = lease ? { session: lease.session, pc: lease.pc || null, since: lease.since, seen: lease.seen, quietSince: quietSince(db, rec.key, nowMs) } : null;
    const who = holder ? holderPlain(db, rec.key, holder, { now: nowMs, pc }) : '';
    if (move === 'read only') {
      const live = liveOf(db, rec.key);
      const h = live ? handoffPayload(db, live) : null;
      const k = kickoffInput(db, rec.key, h, opts);
      return {
        acquired: false, readOnly: true, track: id, key: rec.key, holder, handoff: h, workstream: k.workstream,
        kickoff: kickoffText(k, { mode: holder && holder.session !== session ? 'read only' : 'show', holder, who }),
      };
    }
    if (!session) throw new TrackRefusal('resume needs the session');
    if (CLOSED.includes(rec.fields.status)) throw new TrackRefusal(id + ' is ' + rec.fields.status + '; a closed track takes no session');
    const heldByOther = holder && holder.session !== session;
    /* a handoff that names the PC its next leg runs on is taken elsewhere only once the user says so */
    const named = !move && !heldByOther ? liveOf(db, rec.key) : null;
    const away = named && named.fields.nextPc && pc && named.fields.nextPc.toLowerCase() !== String(pc).toLowerCase() ? named.fields.nextPc : null;
    if (away && !input.here) {
      return {
        acquired: false, elsewhere: true, track: id, key: rec.key, pc, nextPc: away, handoff: named.fields.id,
        next: 'Not taken: handoff ' + named.fields.id + ' says the next leg of ' + id + ' runs on ' + away + ', and this is ' + pc + '. Resume it there with /askerdo resume ' + id
          + ', or take it here anyway with /askerdo resume ' + id + ' --here.',
      };
    }
    if (move === 'splinter') {
      const s = splinter(db, { from: rec.key, name: input.name, goal: input.goal, session, pc }, actor);
      const k = kickoffInput(db, s.key, null, opts);
      return {
        acquired: true, splintered: true, track: s.id, key: s.key, parent: id, session, handoff: null, chain: s.chain, parked: s.parked,
        workstream: k.workstream, kickoff: kickoffText(k, { mode: 'resumed' }),
        next: 'Tell the user: ' + s.chain + (s.parked ? '; ' + id + ' is parked behind this, and /askerdo resume ' + id + ' goes back' : '') + '.',
      };
    }
    let from = null;
    if (heldByOther) {
      if (move !== 'take over') {
        return { acquired: false, track: id, key: rec.key, holder, pc, moves: MOVES.slice(), chain: chainOf(db, rec.key).text, next: holderText(id, who) + '. ' + movesNext(id) };
      }
      const took = takeOver(db, { track: rec.key, session, pc, reason: input.reason, ...(text(input.continues) ? { continues: input.continues.trim() } : {}) }, actor);
      /* the same session going on after a /clear is no take from another, so no one is told */
      if (!took.continued) from = took.from;
    } else {
      const a = acquireLease(db, { track: rec.key, session, pc }, actor);
      if (!a.acquired) throw new TrackRefusal(holderText(id, holderPlain(db, rec.key, a.holder, { now: nowMs, pc })));
    }
    /* the handoff ended its tasks' runs, so they read to continue; nothing comes back in hand */
    const live = liveOf(db, rec.key);
    if (live) {
      const was = live.fields.status;
      live.fields = ordered({ ...live.fields, status: 'resumed', resumedBy: session, resumed: c.at, updated: c.at });
      save(db, live);
      line(db, c, 'edit', live, { status: [was, 'resumed'], resumedBy: [null, session] });
    }
    const h = live ? handoffPayload(db, live) : null;
    const k = kickoffInput(db, rec.key, h, opts);
    const after = loadRecord(db, rec.key);
    return {
      acquired: true, track: id, key: rec.key, session, pc, ...(from ? { takenOverFrom: from } : {}), handoff: h,
      noHandoff: !h, state: stateOf(db, after), chain: k.view.chain, answersSince: k.answers, workstream: k.workstream,
      kickoff: kickoffText(k, { mode: 'resumed', away: away ? { pc, nextPc: away } : null }),
      ...(from ? { next: id + ' was taken from ' + holderPlain(db, rec.key, from, { now: nowMs, pc }) + '; that session hears so at its next prompt.' } : {}),
    };
  });
}

/* A track's kickoff without taking it: what `track show` prints. The asking session
   (input.session, else the actor's) reads its own task as this session's; nothing is marked read. */
export function trackKickoff(db, input = {}, actor, opts) {
  return readTx(db, () => {
    const c = actorOf(actor, opts);
    const viewer = (text(input.session) && input.session.trim()) || c.session || null;
    const rec = recordOf(db, input.track, 'track');
    const live = liveOf(db, rec.key);
    const h = live ? handoffPayload(db, live) : null;
    const lease = db.stmt('SELECT session, pc, since, seen FROM leases WHERE track = ?').get(rec.key);
    const k = kickoffInput(db, rec.key, h, { ...opts, now: c.date, ...(viewer ? { viewer } : {}) });
    /* the inbox too, which the mod reads again at the end of a turn that closed this track */
    return { track: rec.fields.id, key: rec.key, handoff: h, holder: lease || null, workstream: k.workstream, inbox: k.inbox, kickoff: kickoffText(k, { mode: 'show' }) };
  });
}

/* A track's handoffs, oldest first. */
export function trackHandoffs(db, input = {}) {
  return readTx(db, () => {
    const rec = recordOf(db, input.track, 'track');
    return {
      track: rec.fields.id, key: rec.key,
      handoffs: chainRows(db, rec.key).map((h) => ({
        id: h.fields.id, key: h.key, status: h.fields.status, focus: h.fields.focus, created: h.fields.created, pc: h.fields.pc || null,
        fromSession: h.fields.fromSession || null, ...(h.fields.parkReason ? { parkReason: h.fields.parkReason } : {}),
        resumed: h.fields.resumed || null, waitingOnUser: waitingOf(h.fields),
        verify: h.verify.map((v) => ({ path: v.path, ...(v.remote ? { remote: v.remote } : {}), ok: v.ok !== false, ...(v.commit ? { commit: v.commit } : {}) })),
      })),
    };
  });
}

/* Where show --since-resume cuts a journal: the latest resume of the record's
   track (a track's own, a task's track, any of a workstream's tracks). */
export function resumeCutoff(db, input = {}) {
  return readTx(db, () => {
    const raw = String(input.id ?? '').trim();
    const e = resolveRecord(db, raw);
    if (!e) throw new TrackRefusal('unknown record id: ' + raw);
    const label = e.front.id || raw;
    const keys = e.kind === 'track' ? [e.key]
      : e.kind === 'task' ? db.stmt('SELECT track FROM track_items WHERE task = ?').all(e.key).map((r) => r.track)
        : e.kind === 'workstream' ? db.stmt("SELECT key FROM records WHERE kind = 'track' AND workstream = ?").all(e.key).map((r) => r.key)
          : null;
    if (!keys) throw new TrackRefusal(label + ' has no journal to slice');
    let best = null;
    for (const k of keys) {
      for (const h of db.stmt("SELECT label, json_extract(fields, '$.resumed') AS at FROM handoffs WHERE track = ? AND json_extract(fields, '$.resumed') IS NOT NULL").all(k)) {
        if (!best || Date.parse(h.at) > Date.parse(best.at)) best = h;
      }
    }
    if (!best) throw new TrackRefusal(label + ' has no resumed track behind it; --journal-tail N reads its latest notes');
    return { since: best.at, via: best.label };
  });
}

/* One handoff by TR-n.m (that track's own, or none) or by key. */
export function readHandoff(db, input = {}) {
  const ref = typeof input === 'string' ? input : input.id;
  return readTx(db, () => {
    const e = resolveRecord(db, String(ref ?? '').trim(), { kinds: ['handoff'] });
    if (!e) throw new TrackRefusal('no handoff ' + String(ref ?? '(none given)'));
    const h = handoffPayload(db, rowOf(db.stmt(ROW + ' WHERE key = ?').get(e.key)));
    return { ...h, growthLines: growthLines(db, h.growth) };
  });
}

/* history an import wrote: the handoff was written backdated (its created is not
   its write's stamp) and no lease or status change has moved the track since. */
function historyOf(db, trackKey, h) {
  const w = db.stmt("SELECT seq, at FROM activity WHERE record = ? AND verb = 'create' ORDER BY seq LIMIT 1").get(h.key);
  if (w && w.at === h.fields.created) return false;
  return !db.stmt(`SELECT 1 FROM activity WHERE record = ? AND seq > ? AND (json_extract(line, '$.changes.session') IS NOT NULL
    OR json_extract(line, '$.changes.status') IS NOT NULL) LIMIT 1`).get(trackKey, w ? w.seq : 0);
}

/* Waiting and parked tracks across workstreams, oldest handoff first, stalled
   ones marked, each with its last handoff's focus and age; a held track whose
   lease went quiet is listed too, with take over as its way in. And a track no
   session ever held with ready work, as kickoffs name them (five a workstream), after the rest. */
export function shelf(db, input = {}, opts) {
  return readTx(db, () => {
    const nowMs = clockOf(opts).getTime();
    const untaken = new Map();
    for (const { ws } of db.stmt(`SELECT DISTINCT workstream AS ws FROM records WHERE kind = 'track' AND status = 'open' AND workstream IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM leases WHERE track = records.key)`).all()) {
      untakenTracks(db, ws, null, (rec) => stateOf(db, rec) === 'new', nowMs).map((t) => ({ ...t, rec: recordOf(db, t.id, 'track') }))
        .slice(0, UNTAKEN_MAX).forEach((t) => untaken.set(t.rec.key, t));
    }
    const rows = [];
    for (const r of db.stmt("SELECT key FROM records WHERE kind = 'track' AND status IN ('open', 'parked') ORDER BY id").all()) {
      const rec = loadRecord(db, r.key);
      const state = stateOf(db, rec);
      const quiet = state === 'active' ? quietSince(db, rec.key, nowMs) : null;
      const fresh = untaken.get(rec.key);
      if (state !== 'waiting' && state !== 'parked' && !quiet && !fresh) continue;
      const lease = quiet ? db.stmt('SELECT session, pc FROM leases WHERE track = ?').get(rec.key) : null;
      const last = rowOf(db.stmt(ROW + ' WHERE track = ? ORDER BY ' + NEWEST_FIRST + ' LIMIT 1').get(rec.key));
      const born = last ? Date.parse(last.fields.created) : NaN;
      const ws = rec.fields.workstream ? loadRecord(db, rec.fields.workstream) : null;
      /* the Tracks tab's tile names the workstream and draws the bar */
      const g = fresh || trackGraph(db, rec.key, nowMs);
      rows.push({
        track: rec.fields.id, key: rec.key, name: rec.fields.name, workstream: ws ? ws.fields.id : null,
        workstreamName: ws ? ws.fields.name || '' : '', goal: rec.fields.goal || null, done: g.done, total: g.total, state,
        stalled: isStalled(db, rec, state, nowMs), noHandoff: noHandoff(db, rec.key, state), parkReason: rec.fields.parkReason || null,
        ...unparkOf(db, rec, state), chain: chainOf(db, rec.key).text,
        handoff: last ? last.fields.id : null, handoffStatus: last ? last.fields.status : null, focus: last ? last.fields.focus : null,
        created: last ? last.fields.created : null, ...(last && historyOf(db, rec.key, last) ? { history: true } : {}), ageMs: Number.isFinite(born) ? nowMs - born : null,
        age: Number.isFinite(born) ? ageText(nowMs - born) : '', waitingOnUser: last ? waitingOf(last.fields) : [],
        verify: last ? last.verify : [], resume: '/askerdo resume ' + rec.fields.id + (quiet ? ' --take-over' : ''),
        ...(quiet ? { quietSince: quiet, holder: { session: lease.session, pc: lease.pc || null } } : {}),
        ...(fresh ? { ready: fresh.ready, from: fresh.from } : {}),
      });
    }
    rows.sort((a, b) => (a.created === b.created ? a.track.localeCompare(b.track, 'en', { numeric: true })
      : a.created === null ? 1 : b.created === null ? -1 : Date.parse(a.created) - Date.parse(b.created)));
    return { rows };
  });
}
