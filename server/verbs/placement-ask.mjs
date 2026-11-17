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

/* What an asked filing lacks, in words, or null: `here`, the reason, and new work's description,
   which the user's press creates it with (`draft` null for an existing task). */
export function placementLacks(here, asked, heldId, draft = null) {
  const miss = [];
  if (!here || typeof here !== 'object' || Array.isArray(here)) {
    miss.push('here, the real place on ' + heldId + ' the work would otherwise take ({ after, before }; on the CLI --here-before and --here-after)');
  }
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

function askedWords(db, held, a) {
  if (a.onto) return 'as a step of ' + taskWords(db, [a.onto]);
  const later = /^\s*next-session\s*$/i.test(String(a.wake || '')) ? ', for a later session' : '';
  if (a.unparkWhen) return 'on a new parked track' + (a.newTrack ? ' "' + one(a.newTrack) + '"' : '') + ' that opens at ' + one(a.unparkWhen);
  if (a.track && a.track !== held) return 'on ' + a.track + later + (a.before && a.before.length ? ', before ' + taskWords(db, [].concat(a.before)) : '');
  if (a.wake && !later) return 'in the inbox' + (a.workstream ? ' of ' + a.workstream : '') + ', waking ' + one(typeof a.wake === 'object' ? a.wake.kind + ' ' + a.wake.on : a.wake);
  if (later) return 'on ' + held + later;
  return 'last on ' + held + (a.before && a.before.length ? ', before ' + taskWords(db, [].concat(a.before)) : '');
}

/* The project the question files under, as the third-wake ask finds it. */
function repoOf(db, wsKey) {
  const ws = wsKey ? loadRecord(db, wsKey) : null;
  return { ws, repo: ws ? ([].concat(ws.fields.projectRepos || [])[0] || [].concat(ws.fields.projects || [])[0] || ws.fields.name) : 'askerdo' };
}

/* askPlacement(db, placement, c): `placement` is the question's placement key less outcome and created;
   the held track by id. Registers through the third wake's register and returns its result. */
export function askPlacement(db, placement, c) {
  const p = placement || {};
  const heldRec = p.track ? resolveRecord(db, String(p.track), { kinds: ['track'] }) : null;
  if (!heldRec) throw new TrackRefusal('a placement question names the track the filing session holds');
  const held = heldRec.label;
  const lacks = placementLacks(p.here, p.asked, held, p.task ? null : p.draft || {});
  if (lacks) throw new TrackRefusal(lacks + '. Nothing was filed.');
  const here = { after: [].concat(p.here.after || []), before: [].concat(p.here.before || []) };
  const asked = Object.fromEntries(Object.entries(p.asked || {}).filter(([, v]) => given(v)));
  const item = p.task ? resolveRecord(db, String(p.task), { kinds: ['task'] }) : null;
  const name = cut(one(item ? item.front.name : p.draft && p.draft.name) || 'Found work', 120);
  const what = item ? item.label + ': ' + name : firstSentence(p.draft && p.draft.description) || name;
  const reason = reasonOf(asked);
  const at = hereWords(db, held, here);
  const there = askedWords(db, held, asked);
  const waits = asked.after && [].concat(asked.after).length ? ', after ' + taskWords(db, [].concat(asked.after).map(String)) : '';
  const ask = cut('Where does "' + cut(name, 80) + '" go: ' + cut(at, 110) + ' (a), ' + cut(there, 110) + ' (b, my pick), let\'s talk where it fits (c), or drop it (d)', 395) + '?';
  const gist = [
    '**Found:** ' + what,
    '**Why move it:** ' + reason,
    '**On this track:** ' + at,
    '**Asked:** ' + there + waits,
  ].join('\n');
  const { ws, repo } = repoOf(db, heldRec.front.workstream);
  const r = register(db, {
    name, ask, gist, blocking: false, pick: 'b', session: c.session, projectRepo: repo, workstream: ws ? ws.fields.id : undefined,
    track: held, labels: [PLACEMENT_LABEL], [BOARD_ASKS]: true,
    options: [
      { type: 'a', option: 'Do it on this track', getsYou: 'it is created ' + at },
      { type: 'b', option: 'Put it where asked', getsYou: 'it is created ' + there + ', as the session asks' },
      { type: 'c', option: "Let's talk where it fits", getsYou: 'nothing is created; the session lays out the places and files the one you settle' },
      { type: 'd', option: 'Drop it', getsYou: 'nothing is created; your word stays in the answer' },
    ],
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
