/* The answer side of the placement rule:
   the user's press on a placement question creates the task, as the session that filed it,
   inside the answer's own transaction, with no model turn. */
import { addNote, byOf, guardHeadings, logVerb } from '../records.mjs';
import { UsageError, resolveRecord } from './labels.mjs';
import { TrackRefusal, addItem } from './graph.mjs';
import { editRecord, fileRecord } from './work.mjs';
import { APPROVED, PLACEMENT_LABEL } from './placement-seam.mjs';

const ENDED_TASK = ['done', 'dropped'];
const CLOSED_TRACK = ['done', 'dropped', 'folded'];
const OUTCOME = { a: 'here', b: 'asked', c: 'talk', d: 'drop' };
const DRAFT_KEYS = ['name', 'description', 'intent', 'priority', 'labels'];
const ASKED_KEYS = ['tier', 'track', 'workstream', 'newTrack', 'unparkWhen', 'wake', 'unplaced', 'last', 'whyElsewhere', 'after', 'before', 'onto'];

export const isPlacement = (front) => Boolean(front && front.placement && typeof front.placement === 'object'
  && Array.isArray(front.labels) && front.labels.some((l) => String(l).toLowerCase() === PLACEMENT_LABEL));

const idList = (v) => (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v]).map((s) => String(s).trim()).filter(Boolean);
const given = (v) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length);

function openTask(db, ref) {
  const e = resolveRecord(db, ref, { kinds: ['task'] });
  return e && !ENDED_TASK.includes(e.front.status) ? e.label : null;
}

/* The pressed place with closed tasks left out, or why nothing is left to place it at (the stale place). */
function livePlace(db, place) {
  const out = { ...place };
  if (given(place.track)) {
    const t = resolveRecord(db, String(place.track), { kinds: ['track'] });
    if (!t) return { why: 'track ' + place.track + ' is gone' };
    if (CLOSED_TRACK.includes(t.front.status)) return { why: t.label + ' is ' + t.front.status };
    out.track = t.label;
  }
  for (const k of ['before', 'after']) if (given(place[k])) out[k] = idList(place[k]).map((r) => openTask(db, r)).filter(Boolean);
  if (idList(place.before).length && !out.before.length) return { why: 'no open task is left to wait on it (' + idList(place.before).join(', ') + ' closed)' };
  return { place: out };
}

/* A filing's refusal rolls back only the creation: the answer stands and the outcome is stale. */
function attempt(db, fn) {
  db.exec('SAVEPOINT placement_answer');
  try {
    const out = fn();
    db.exec('RELEASE placement_answer');
    return { out };
  } catch (e) {
    db.exec('ROLLBACK TO placement_answer');
    db.exec('RELEASE placement_answer');
    if (e instanceof UsageError || e instanceof TrackRefusal || (e && e.name === 'UsageError')) return { why: e.message };
    throw e;
  }
}

/* Where the task sits now, by labels: its track, the open tasks waiting on it and the ones it waits on. */
function placeOf(db, key) {
  const label = (k) => (db.stmt('SELECT label FROM records WHERE key = ?').get(k) || {}).label || k;
  const row = db.stmt('SELECT track FROM track_items WHERE task = ?').get(key);
  const before = db.stmt('SELECT task FROM depends WHERE "on" = ?').all(key).map((r) => label(r.task));
  const after = db.stmt('SELECT "on" FROM depends WHERE task = ?').all(key).map((r) => label(r.on));
  return { track: row ? label(row.track) : null, before, after };
}

function create(db, q, p, place, filer) {
  const approved = { [APPROVED]: q.front.id };
  /* a step asked onto another track's task becomes a step of that task */
  if (given(place.onto)) {
    const t = resolveRecord(db, String(place.onto), { kinds: ['task'] });
    if (!t || ENDED_TASK.includes(t.front.status)) throw new UsageError(place.onto + ' is no longer an open task');
    addItem(db, { task: t.key, text: (p.draft || {}).name }, filer);
    return t.key;
  }
  if (given(p.task)) {
    const r = editRecord(db, { id: p.task, ...place, ...approved }, filer);
    return r.id;
  }
  const d = p.draft || {};
  const draft = Object.fromEntries(DRAFT_KEYS.filter((k) => given(d[k])).map((k) => [k, d[k]]));
  const r = fileRecord(db, { ...draft, ...place, ...approved }, filer);
  if (given(d.runBy)) editRecord(db, { id: r.id, runBy: d.runBy }, filer);
  return r.id;
}

/* What a session hears for a placement question it tried to settle. */
export function userAnswersIt(id) {
  const n = String(id).replace(/^Q/, '');
  return id + ' asks the user where found work goes, so only the user answers it: by pressing its card or the band, or typing its token ('
    + n + 'a, ' + n + 'b and on) in chat';
}

/* placementAnswered(db, q, answer, c): q the loaded question (its front), answer { pick, note, line,
   amend, drop }, c { at, actor, pc, now }. Null for any other question; else it sets the front's
   placement outcome (and created) and returns { outcome, created?, why?, changes } for the answer's row. */
export function placementAnswered(db, q, answer, c) {
  const front = q.front;
  if (!isPlacement(front)) return null;
  const p = front.placement;
  /* only the user's own act answers it, the user mark or a call naming no session */
  if (/^session:/.test(byOf(c.actor))) throw new UsageError(userAnswersIt(front.id) + '; nothing was written');
  if (given(p.created)) {
    throw new UsageError(front.id + ' already created ' + p.created + ' at the place pressed, so its answer stands: move or drop '
      + p.created + ' itself (task edit, or task update --status dropped)');
  }
  const pick = answer.drop ? null : answer.pick ? String(answer.pick).trim() : null;
  let outcome = answer.drop ? 'drop' : OUTCOME[pick] || 'talk';
  let made = null;
  let why = null;
  if (outcome === 'here' || outcome === 'asked') {
    const sent = outcome === 'here'
      ? { track: p.track, before: (p.here || {}).before, after: (p.here || {}).after }
      : Object.fromEntries(ASKED_KEYS.filter((k) => given((p.asked || {})[k])).map((k) => [k, p.asked[k]]));
    const live = livePlace(db, sent);
    const filer = { session: p.session, pc: c.pc, now: c.now };
    const tried = live.why ? live : attempt(db, () => create(db, q, p, live.place, filer));
    if (tried.why) {
      why = tried.why;
      outcome = 'stale';
    } else {
      const e = resolveRecord(db, tried.out, { kinds: ['task'] });
      made = { id: e.label, ...placeOf(db, e.key) };
      const text = front.id + ' (' + front.name + ') was answered: ' + (answer.line || pick) + ' ' + e.label
        + ' was ' + (given(p.task) ? 'placed' : 'created') + ' by that press, as the session that found it filed it'
        + (made.track ? ', on ' + made.track : '') + (made.before.length ? ' before ' + made.before.join(', ') : '') + '.';
      addNote(db, e.key, { at: c.at, actor: byOf(c.actor), body: guardHeadings(text) });
      logVerb(db, { ts: c.at, verb: 'note', kind: 'task', id: e.label, key: e.key, name: e.front.name, changes: {}, by: byOf(c.actor), pc: c.pc, note: text });
    }
  }
  front.placement = { ...p, outcome, ...(made ? { created: made.id } : {}) };
  return {
    outcome, ...(made ? { created: made } : {}), ...(why ? { why } : {}),
    changes: { outcome: [p.outcome || null, outcome], ...(made ? { created: [null, made] } : {}), ...(why ? { why: [null, why] } : {}) },
  };
}
