/* The placement question: found work the board does not
   file at once is asked of the user in the filing call itself; the item rides the question whole. */
import { KEY_ORDERS } from '../records.mjs';
import { TrackRefusal, loadRecord, writeFront } from './graph.mjs';
import { resolveRecord } from './labels.mjs';
import { BOARD_ASKS, PLACEMENT_LABEL } from './placement-seam.mjs';
import { register } from './questions.mjs';

const one = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const cut = (s, n) => (s.length > n ? s.slice(0, n - 3).trimEnd() + '...' : s);
const given = (v) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length);
const firstSentence = (t) => {
  const s = one(t);
  const m = /^(.+?[.!?])(?:\s|$)/.exec(s);
  return cut(m ? m[1] : s, 240);
};

/* The reason the question shows: last's line, else the why-elsewhere line, else an inbox's unplaced. */
export const reasonOf = (asked = {}) => [asked.last, asked.whyElsewhere, asked.unplaced].map((v) => (typeof v === 'string' ? one(v) : '')).find(Boolean) || '';

/* What an asked filing lacks, in words, or null: the reason, and new work's description,
   which the user's press creates it with (`draft` null for an existing task). No `here` says nothing on the held track waits. */
export function placementLacks(asked, heldId, draft = null) {
  const miss = [];
  if (!reasonOf(asked)) miss.push('the reason the question shows (last with why nothing on ' + heldId + ' needs it sooner, or whyElsewhere with why ' + heldId + ' does not cover it)');
  if (draft && !one(draft.description)) miss.push("a description, the job the new task holds and what done looks like, which the user's press creates it with (on the CLI --description)");
  return miss.length ? 'This filing is asked of the user, and it lacks ' + miss.join(', and ') : null;
}

const taskWords = (db, ids) => ids.map((id) => {
  const e = resolveRecord(db, id, { kinds: ['task'] });
  return id + (e ? ' (' + cut(one(e.front.name), 60) + ')' : '');
}).join(', ');

function hereWords(db, held, here) {
  const parts = [];
  if (here.before.length) parts.push('before ' + taskWords(db, here.before));
  if (here.after.length) parts.push('after ' + taskWords(db, here.after));
  return 'on ' + held + (parts.length ? ', ' + parts.join(', ') : ', the next thing taken');
}

/* `lastAt`: where a last on the held track lands now ({ after, before }), so the row names what it will wait on */
function askedWords(db, held, a, lastAt = null) {
  if (a.onto) return 'as a step of ' + taskWords(db, [a.onto]);
  const later = /^\s*next-session\s*$/i.test(String(a.wake || '')) ? ', for a later session' : '';
  if (a.unparkWhen) return 'on a new parked track' + (a.newTrack ? ' "' + one(a.newTrack) + '"' : '') + ' that opens at ' + one(a.unparkWhen);
  if (a.track && a.track !== held) return 'on ' + a.track + later + (a.before && a.before.length ? ', before ' + taskWords(db, [].concat(a.before)) : '');
  if (a.wake && !later) return 'in the inbox' + (a.workstream ? ' of ' + a.workstream : '') + ', waking ' + one(typeof a.wake === 'object' ? a.wake.kind + ' ' + a.wake.on : a.wake);
  if (later) return 'on ' + held + later;
  const at = lastAt || {};
  const after = [].concat(at.after || []);
  return 'last on ' + held + (after.length ? ', after ' + taskWords(db, after) : '')
    + (at.before ? ', before ' + taskWords(db, [at.before]) + ', the closing review' : '')
    + (a.before && a.before.length ? ', before ' + taskWords(db, [].concat(a.before)) : '');
}

/* The project the question files under, as the third-wake ask finds it. */
function repoOf(db, wsKey) {
  const ws = wsKey ? loadRecord(db, wsKey) : null;
  return { ws, repo: ws ? ([].concat(ws.fields.projectRepos || [])[0] || [].concat(ws.fields.projects || [])[0] || ws.fields.name) : 'askerdo' };
}

/* askPlacement(db, placement, c): `placement` is the question's placement key less outcome and created;
   the held track by id; `lastAt` (not stored) words where a last lands. Registers through the third wake's register and returns its result. */
export function askPlacement(db, placement, c) {
  const p = placement || {};
  const heldRec = p.track ? resolveRecord(db, String(p.track), { kinds: ['track'] }) : null;
  if (!heldRec) throw new TrackRefusal('a placement question names the track the filing session holds');
  const held = heldRec.label;
  const lacks = placementLacks(p.asked, held, p.task ? null : p.draft || {});
  if (lacks) throw new TrackRefusal(lacks + '. Nothing was filed.');
  /* no here, nothing on the held track waits on the work, so no do-it-here press */
  const here = p.here ? { after: [].concat(p.here.after || []), before: [].concat(p.here.before || []) } : null;
  const asked = Object.fromEntries(Object.entries(p.asked || {}).filter(([, v]) => given(v)));
  const item = p.task ? resolveRecord(db, String(p.task), { kinds: ['task'] }) : null;
  const name = cut(one(item ? item.front.name : p.draft && p.draft.name) || 'Found work', 120);
  const what = item ? item.label + ': ' + name : firstSentence(p.draft && p.draft.description) || name;
  const reason = reasonOf(asked);
  const at = here ? hereWords(db, held, here) : 'nothing on ' + held + ' needs it sooner';
  const there = askedWords(db, held, asked, p.lastAt);
  /* a last's Asked words name lastAt.after already */
  const named = new Set([].concat((p.lastAt || {}).after || []).map(String));
  const after = [].concat(asked.after || []).map(String).filter((id) => !named.has(id));
  const waits = after.length ? ', after ' + taskWords(db, after) : '';
  const rows = [
    ...(here ? [{ option: 'Do it on this track', getsYou: 'it is created ' + at }] : []),
    { option: 'Put it where asked', getsYou: 'it is created ' + there + ', as the session asks', pick: true },
    { option: "Let's talk where it fits", getsYou: 'nothing is created; the session lays out the places and files the one you settle' },
    { option: 'Drop it', getsYou: 'nothing is created; your word stays in the answer' },
  ].map((o, i) => ({ type: 'abcd'[i], ...o }));
  const pick = rows.find((o) => o.pick).type;
  const ask = cut('Where does "' + cut(name, 80) + '" go: ' + (here ? cut(at, 110) + ' (a), ' : '') + cut(there, 110) + ' (' + pick + ', my pick), let\'s talk where it fits ('
    + rows[rows.length - 2].type + '), or drop it (' + rows[rows.length - 1].type + ')', 395) + '?';
  const gist = [
    '**Found:** ' + what,
    '**Why move it:** ' + reason,
    '**On this track:** ' + at,
    '**Asked:** ' + there + waits,
  ].join('\n');
  const { ws, repo } = repoOf(db, heldRec.front.workstream);
  const r = register(db, {
    name, ask, gist, blocking: false, pick, session: c.session, projectRepo: repo, workstream: ws ? ws.fields.id : undefined,
    track: held, labels: [PLACEMENT_LABEL], [BOARD_ASKS]: true,
    options: rows.map(({ pick: _, ...o }) => o),
  }, { by: c.by, pc: c.pc, ...(c.session ? { session: c.session } : {}), ...(c.date ? { now: c.date } : {}) });
  const stored = {
    session: c.session, track: held, ...(item ? { task: item.label } : { draft: draftOf(p.draft) }), here, asked,
    from: Object.fromEntries(Object.entries(p.from || { via: 'place' }).filter(([, v]) => given(v))),
  };
  writeFront(db, loadRecord(db, r.key), { placement: stored }, KEY_ORDERS.question);
  return r;
}

/* The item whole, in the draft's own keys. */
export function draftOf(f = {}) {
  const out = {};
  for (const k of ['name', 'description', 'intent', 'runBy', 'priority', 'labels']) if (given(f[k])) out[k] = f[k];
  return out;
}
