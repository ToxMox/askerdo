/* The work verbs over SQLite: tasks, workstreams (with outcomes
   and `serves`), notes and knowledge. A write is `verb(db, input, actor)` in one
   transaction with its activity rows; a read is `verb(db, input)`. Tracks replace
   plans, steps and threads, and subscriptions are derived, never written. */
import { tx } from '../db.mjs';
import {
  KEY_ORDERS, QUIET_LISTS, actorOf, addNote, changesOf, clockOf, guardHeadings, isKey, kebab, labelOf, logRow, mintKey, pcOfCall, putRecord, sessionWords, unguardHeadings,
} from '../records.mjs';
import {
  UsageError, LABEL_KINDS, endingStamps, historyItem, loadEntry, pickLabel, refsFor, relabelIfArchived, resolveRecord, shownFront, strList,
} from './labels.mjs';
import { knowledgeInProject, knowledgeInWs, reopenQuestion, wakeLinked } from './questions.mjs';
import { APPROVED } from './placement-seam.mjs';
import { bypassFor } from './bypass.mjs';
import { TrackRefusal, addItem, itemsOf, loadRecord, readiness, settleChecks, shownWorkers } from './graph.mjs';
import { decisionsFor } from './decisions.mjs';
import { addHistory, historyRef, inUseRefusal, noteRead, usedBy } from './history.mjs';
import { closeChanges, editClose, isNextSession, wakeOf, wakeWords } from './upkeep.mjs';
import { RUN_BY_HINT, copiedFrom, routedTo, runByOf } from '../handoff-text.mjs';
import { holderWords } from '../web/feed.mjs';
import { askFiling, inboxLacks, ladderPlace, landPlace, landedTier, openTrack, ownTrackLacks, placeCreated, placeTask, policedHeld, settlePlace, settleTalk, talkOf, waitNextSession } from './tracks.mjs';
import { layLeftovers, leaveOnClose } from './leftovers.mjs';
import { placeRefusal, suggestTrack } from './found.mjs';
import { afterTask, reviewScopeOf } from './coverage.mjs';
import { isReview } from './found.mjs';
import { blockOf } from './task-block.mjs';
import { SETTLED, afterEnding, gateEnding } from './ending.mjs';
import { closeHeldRefusal, endSessionRuns, endTaskRuns, openRun, openRunsOn, othersRuns, withWorkers } from './runs.mjs';

export { UsageError };
/* the record moved since the caller read it */
export class ConflictError extends Error {}

/* ---- the kinds this file writes (key order is the old store's WORK_KINDS) ---- */

/* a project's shared name as given (a remote), or a folder named by its own path */
export const projectName = (v) => {
  const t = String(v).trim();
  return /^([A-Za-z]:)?[\\/]/.test(t) ? t.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '') : t;
};

export const WORK_KINDS = Object.freeze({
  workstream: {
    kind: 'workstream', verb: 'ws',
    keys: KEY_ORDERS.workstream,
    arrays: ['projects', 'projectRepos', 'labels', 'refs', 'profiles', 'profileDrops', 'subscribers', 'labelHistory'],
    maps: ['outcomes'], statuses: ['open', 'closed'],
  },
  task: {
    kind: 'task', verb: 'task',
    keys: KEY_ORDERS.task,
    arrays: ['labels', 'refs', 'profiles', 'profileDrops', 'serves', 'subscribers', 'claimants', 'labelHistory'],
    maps: [], statuses: ['open', 'dropped', 'done'],
  },
  knowledge: {
    kind: 'knowledge', verb: 'knowledge',
    keys: KEY_ORDERS.knowledge,
    arrays: ['projects', 'projectRepos', 'labels', 'refs', 'workstreams', 'tracks', 'tasks', 'files', 'commands', 'labelHistory'],
    maps: ['source'], statuses: ['active', 'superseded', 'withdrawn', 'retired'],
  },
});

const TERMINAL = { workstream: ['closed'], task: ['dropped', 'done'], knowledge: ['superseded', 'withdrawn', 'retired'] };

/* a fact an import wrote carries the import's label and its onboard ref from its
   creation (no verb adds a label to a knowledge record later), so the undo's withdraw takes it */
export const isImportFact = (front) => Boolean(front) && front.type !== 'decision'
  && (front.labels || []).some((l) => /^import:\S/.test(String(l))) && (front.refs || []).some((r) => /^onboard:\S/.test(String(r)));
/* why a withdrawn record ended: a ruling never made, or a fact whose import was undone */
export const withdrawnWhy = (front) => (front && front.type !== 'decision' ? 'its import was undone' : 'never ruled');

/* In progress is read from an open run, never set; a status word naming it gets the call that starts one. */
const IN_PROGRESS = 'in_progress';
function statusWord(kind, word, flag) {
  if (kind === 'task' && word === IN_PROGRESS) {
    throw new UsageError(flag + ' takes no in_progress: a task reads in progress while a run is open on it. Start one by taking it in hand with your session'
      + ' (inHand on task_update, --in-hand --session <own-id> on the CLI) or by dispatching an agent that names it');
  }
  return word;
}
const PRIORITIES = ['high', 'medium', 'low'];
/* imported tasks carry an ordinal; a new one sorts on today's default rung */
const DEFAULT_ORDINAL = 1000;
export const KNOWLEDGE_TYPES = Object.freeze(['gotcha', 'decision']);
const LEGACY_KNOWLEDGE_RE = /^[a-z0-9][a-z0-9-]*:[GD]-\d{4}$/;

const refusal = {
  plan: 'a plan has no verbs on the board: its steps are tasks on a track',
  thread: 'a thread has no verbs on the board: it is a track now',
  knowledge: 'a knowledge record has its own verbs: knowledge new, knowledge edit (while no other session has used it), knowledge amend, knowledge supersede, or knowledge retire with --reason for a fact that stops being true',
  procedure: 'a procedure card has no generic verb: proc scan or proc ran',
  question: 'a question has its own verbs: answer, drop, snooze, wake',
};

/* ---- fronts ---- */

/* Today's key order for the kind, empty quiet lists and empty maps dropped,
   unknown keys after the known ones in their own order. */
export function orderFront(k, front) {
  const out = {};
  for (const key of k.keys) {
    const v = front[key];
    if (v === undefined || v === null) continue;
    if (k.arrays.includes(key)) {
      if (!Array.isArray(v)) throw new UsageError(key + ' must be a list');
      if (QUIET_LISTS.includes(key) && !v.length) continue;
      out[key] = v;
    } else if (k.maps.includes(key)) {
      if (typeof v !== 'object' || Array.isArray(v)) throw new UsageError(key + ' must be a map');
      const entries = Object.entries(v).filter(([, x]) => x !== undefined && x !== null);
      if (entries.length) out[key] = Object.fromEntries(entries);
    } else out[key] = v;
  }
  for (const [key, v] of Object.entries(front)) if (!k.keys.includes(key) && v !== undefined && v !== null) out[key] = v;
  return out;
}

/* The lenient reader stores a bare `key:` as []; on a scalar key it is '' (parseWorkFile). */
export function normalize(k, front) {
  for (const key of k.keys) {
    const v = front[key];
    if (k.arrays.includes(key)) { if (v === '[]') front[key] = []; } else if (Array.isArray(v) && !v.length) front[key] = '';
  }
  return front;
}

const listOf = (front, key) => (Array.isArray(front[key]) ? front[key].slice() : []);
const snap = (front) => Object.fromEntries(Object.entries(front || {}).map(([k, v]) => [k, Array.isArray(v) ? v.slice() : v]));
const writeLine = logRow;

/* ---- bodies and sections ---- */

/* The body above `## Journal`, as the importer stores it. */
function workBody(kind, p) {
  let out = '\n## Description\n\n' + guardHeadings(p.description) + '\n\n';
  if (kind === 'task') out += '## Intent\n\n' + (p.intent ? guardHeadings(p.intent) + '\n\n' : '');
  if (kind === 'knowledge') out += '## Body\n\n' + (p.body ? guardHeadings(p.body) + '\n\n' : '');
  return out;
}

export function sectionsOf(body) {
  const lines = String(body).split('\n');
  const heads = [];
  lines.forEach((l, i) => { if (l.startsWith('## ')) heads.push({ name: l.slice(3).trim(), i }); });
  const out = {};
  heads.forEach((h, j) => { out[h.name] = lines.slice(h.i + 1, j + 1 < heads.length ? heads[j + 1].i : lines.length).join('\n').trim(); });
  return out;
}

/* The sections as a reader gets them: each field as it was written, guard spaces off. */
export const shownSectionsOf = (body) => Object.fromEntries(Object.entries(sectionsOf(body)).map(([k, v]) => [k, unguardHeadings(v)]));

/* One section's text replaced in place (a missing one added at the end); the rest keeps its bytes. */
export function withSection(body, name, text) {
  const lines = String(body).split('\n');
  const i = lines.indexOf('## ' + name);
  if (i < 0) {
    const base = String(body).replace(/\n*$/, '');
    return (base ? base + '\n\n' : '\n') + '## ' + name + '\n\n' + (text ? text + '\n\n' : '');
  }
  let j = lines.findIndex((l, n) => n > i && l.startsWith('## '));
  const seg = text ? ['', ...String(text).split('\n'), ''] : [''];
  if (j < 0) { j = lines.length; seg.push(''); }
  return [...lines.slice(0, i + 1), ...seg, ...lines.slice(j)].join('\n');
}

/* "by a session on <PC>", "by the user", else "by the command line on <PC>", as an amend's
   paragraph names who wrote it: never the raw actor */
function whoOf(db, c, input) {
  if (/^user(:|$)/.test(c.by)) return 'the user';
  if (/^session:/.test(c.by)) return sessionWords(db, c.by.slice(8), c);
  const pc = pcOfCall(input, c);
  return 'the command line' + (pc ? ' on ' + pc : '');
}

function journalOf(db, key) {
  return db.stmt('SELECT at, body FROM notes WHERE record = ? ORDER BY position').all(key)
    .map((n) => (n.at ? n.at + ': ' : '') + unguardHeadings(n.body)).join('\n\n');
}

/* ---- writing a record row ---- */

function save(db, e, fields, body) {
  putRecord(db, { key: e.key, kind: e.kind, slug: e.slug, fields, body: body ?? e.body, layout: e.layout, track: e.track });
}

function checkVersion(e, input) {
  if (input.version !== undefined && input.version !== null && Number(input.version) !== e.version) {
    throw new ConflictError(e.label + ' moved since you read it (version ' + input.version + ', now ' + e.version + '); read it again');
  }
}

/* The record a write names, of one of `kinds`; another kind is refused by name. */
function target(db, id, kinds, day, verb) {
  const raw = String(id ?? '').trim();
  if (!raw) throw new UsageError(verb + ' needs a record id');
  const e = resolveRecord(db, raw, { day });
  if (!e || e.kind === 'profile' || e.kind === 'handoff') throw new UsageError('unknown record id: ' + raw);
  if (!kinds.includes(e.kind)) throw new UsageError(refusal[e.kind] || ('a ' + e.kind + ' takes no ' + verb));
  return e;
}

/* A reference that must exist and be of `kind`; stored as its key. */
function refTo(db, token, kind, day) {
  const e = resolveRecord(db, token, { day });
  if (!e || e.kind !== kind) throw new UsageError('unknown ' + kind + ' id: ' + token);
  return e.key;
}

/* ---- outcomes: a workstream's in the user's words, the ones a task serves ---- */

const OUTCOME_ID = /^o[1-9]\d{0,5}$/;
const outcomeMap = (f) => (f && f.outcomes && typeof f.outcomes === 'object' && !Array.isArray(f.outcomes) ? f.outcomes : {});
const outcomesText = (f) => Object.entries(outcomeMap(f)).map(([id, t]) => id + ' ' + t).join(', ');

function outcomeLines(list, what) {
  return (Array.isArray(list) ? list : [list]).map((s) => {
    const t = String(s ?? '').replace(/[\r\n\u2028\u2029]+/g, ' ').trim();
    if (!t) throw new UsageError(what + ' needs a line of text');
    return t;
  });
}

function outcomeIds(raw, what) {
  const list = (Array.isArray(raw) ? raw : [raw]).flatMap((v) => String(v ?? '').split(/[\s,]+/)).map((s) => s.trim().toLowerCase()).filter(Boolean);
  for (const id of list) if (!OUTCOME_ID.test(id)) throw new UsageError(what + ' takes outcome ids like o2: ' + id);
  return [...new Set(list)];
}

function nextSerial(ids, prefix) {
  const top = ids.reduce((m, id) => {
    const n = String(id).startsWith(prefix) ? Number(String(id).slice(prefix.length)) : 0;
    return Number.isSafeInteger(n) && n > m ? n : m;
  }, 0);
  return prefix + (top + 1);
}

/* The workstream a task sits under (the migration gave every task on a track one). */
function wsOfTask(db, workstream) {
  const e = workstream ? loadEntry(db, workstream) : null;
  return e ? normalize(WORK_KINDS.workstream, e.front) : null;
}

function checkServes(serves, ws, who) {
  if (!serves.length) return;
  if (!ws) throw new UsageError((who || 'a task') + ' has no workstream, so it serves no outcome');
  const have = Object.keys(outcomeMap(ws));
  const bad = serves.filter((id) => !have.includes(id));
  if (bad.length) {
    throw new UsageError(ws.id + ' has no outcome ' + bad.join(', ') + (have.length ? '; its outcomes: ' + outcomesText(ws)
      : '; it has none yet (ws edit ' + ws.id + ' --add-outcome "<line>")'));
  }
}

function tasksUnder(db, wsKey) {
  return db.stmt(`SELECT label, status, json_extract(fields, '$.serves') AS serves FROM records WHERE kind = 'task' AND workstream = ?`)
    .all(wsKey).map((r) => ({ id: r.label, status: r.status, serves: r.serves ? JSON.parse(r.serves) : [] }));
}

/* Adds mint past every id the workstream or one of its tasks holds, so a removed id is never given new words. */
function editOutcomes(db, e, front, c, changed, warnings) {
  if (!c.addOutcome.length && !c.removeOutcome.length) return;
  const map = { ...outcomeMap(front) };
  for (const id of c.removeOutcome) {
    if (!Object.hasOwn(map, id)) throw new UsageError(front.id + ' has no outcome ' + id + (Object.keys(map).length ? '; its outcomes: ' + outcomesText(front) : ''));
  }
  const tasks = tasksUnder(db, e.key);
  const taken = [...Object.keys(map), ...tasks.flatMap((t) => t.serves)];
  for (const line of c.addOutcome) { const id = nextSerial(taken, 'o'); map[id] = line; taken.push(id); }
  for (const id of c.removeOutcome) {
    delete map[id];
    const open = tasks.filter((t) => !TERMINAL.task.includes(t.status) && t.serves.includes(id)).map((t) => t.id);
    if (open.length) warnings.push(front.id + ' ' + id + ' removed while ' + open.join(', ') + (open.length === 1 ? ' serves' : ' serve') + ' it: they keep the id and show it as removed');
  }
  if (Object.keys(map).length) front.outcomes = map; else delete front.outcomes;
  changed.push('outcomes');
}

/* --serves / --clear-serves, and a move into another workstream, which has to say what the task serves there. */
function editServes(db, front, before, c, changed) {
  const naming = c.serves !== undefined || c.clearServes;
  const moved = String(before.workstream || '') !== String(front.workstream || '');
  if (!naming && !moved) return;
  const ws = wsOfTask(db, front.workstream);
  const held = listOf(front, 'serves');
  if (!naming) {
    if (!held.length) return;
    const was = wsOfTask(db, before.workstream);
    if (was && ws && was.key === ws.key) return;
    throw new UsageError(front.id + ' serves ' + held.join(', ') + (was ? ' of ' + was.id : '') + '; moving it '
      + (ws ? 'to ' + ws.id : 'out of its workstream') + ' needs --serves'
      + (ws && Object.keys(outcomeMap(ws)).length ? ' (' + ws.id + "'s outcomes: " + outcomesText(ws) + ')' : '') + ' or --clear-serves');
  }
  const next = c.clearServes ? [] : c.serves;
  checkServes(next, ws, front.id);
  if (next.length === held.length && next.every((v, i) => v === held[i])) return;
  if (next.length) front.serves = next; else delete front.serves;
  changed.push('serves');
}

/* ---- endings ---- */

/* ---- create ---- */

function validateWorkPayload(kind, raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new UsageError(kind + ' payload must be a JSON object');
  const k = WORK_KINDS[kind];
  const need = (key) => {
    if (typeof raw[key] !== 'string' || !raw[key].trim()) throw new UsageError(kind + ' payload needs a non-empty ' + key + ' string');
    return raw[key].trim();
  };
  const optStr = (key) => {
    if (raw[key] === undefined) return undefined;
    if (typeof raw[key] !== 'string') throw new UsageError(key + ' must be a string');
    return raw[key];
  };
  const strArray = (key) => {
    if (raw[key] === undefined) return [];
    if (!Array.isArray(raw[key]) || raw[key].some((s) => typeof s !== 'string')) throw new UsageError(key + ' must be an array of strings');
    return raw[key];
  };
  for (const key of ['plan', 'ordinal']) {
    if (raw[key] !== undefined) throw new UsageError('a task has no ' + key + ' on the board: its track and place are the track verbs');
  }
  const p = { name: need('name'), description: need('description') };
  p.status = raw.status === undefined ? 'open' : statusWord(kind, String(raw.status), 'status');
  if (!k.statuses.includes(p.status)) throw new UsageError(kind + ' status must be one of ' + k.statuses.join(', '));
  if (kind !== 'task' && p.status !== 'open') throw new UsageError('a ' + kind + ' is created open; closing it is the close verb');
  p.labels = strArray('labels');
  p.refs = strArray('refs');
  if (raw.created !== undefined) {
    if (typeof raw.created !== 'string' || !/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2})?$/.test(raw.created)) {
      throw new UsageError('created must be YYYY-MM-DD or a full local timestamp (YYYY-MM-DDTHH:MM:SS+HH:MM)');
    }
    p.created = raw.created;
  }
  if (raw.outcomes !== undefined && kind !== 'workstream') throw new UsageError('only a workstream carries outcomes');
  if (raw.serves !== undefined && kind !== 'task') throw new UsageError('only a task serves outcomes');
  if (raw.handoff !== undefined && kind !== 'workstream') throw new UsageError('only a workstream carries a handoff folder');
  if (kind === 'workstream') {
    /* shared names from the PC that reads the folders' git; a bare folder is named by its path */
    const repos = strArray('projectRepos');
    p.projectRepos = repos.length ? repos : [...new Set(strArray('projects').map(projectName))];
    p.outcomes = outcomeLines(strArray('outcomes'), 'outcomes');
    p.handoff = handoffPath(raw.handoff, 'handoff');
  } else {
    p.origin = optStr('origin');
    p.workstream = optStr('workstream');
    p.priority = raw.priority === undefined ? 'medium' : String(raw.priority);
    if (!PRIORITIES.includes(p.priority)) throw new UsageError('priority must be one of ' + PRIORITIES.join(', '));
    p.intent = optStr('intent') || '';
    p.serves = outcomeIds(strArray('serves'), 'serves');
    /* a review reads its track (the default, stored as no key) or the whole project;
       a review is known by its label, so a review scope labels the task */
    if (raw.reviewScope !== undefined) {
      if (reviewScopeOf(raw.reviewScope) === 'project') p.reviewScope = 'project';
      if (!isReview(p)) p.labels = p.labels.concat('review');
    }
  }
  return p;
}

function handoffPath(v, flag) {
  if (v === undefined) return undefined;
  if (typeof v !== 'string' || !v.trim()) throw new UsageError(flag + ' needs a folder path');
  return v.trim().replace(/\\/g, '/').replace(/(.)\/+$/, '$1');
}

/* THE CONTRACT the track verbs rely on: today's task input (name, description,
   intent, workstream, priority, labels, refs, serves), `kind` defaulting to task,
   returning { id, key, kind, name } (plus any warnings). */
export function createRecord(db, input = {}, actor) {
  const kind = input && input.kind !== undefined ? String(input.kind) : 'task';
  if (!WORK_KINDS[kind] || kind === 'knowledge') throw new UsageError(refusal[kind] || 'unknown record kind: ' + kind);
  const { kind: _k, track: trackRef, before, after, unplaced, wake, ...raw } = input || {};
  if (trackRef !== undefined && (kind !== 'task' || typeof trackRef !== 'string' || !trackRef.trim())) {
    throw new UsageError('track names a TR-n id, and only a task goes on one');
  }
  /* unplaced is the reason a task waits on no track, which the found list shows */
  if (unplaced !== undefined && (kind !== 'task' || typeof unplaced !== 'string' || !unplaced.trim())) {
    throw new UsageError('unplaced is the reason a task waits on no track, a line of text');
  }
  if ((unplaced !== undefined || wake !== undefined) && trackRef !== undefined) throw new UsageError('a task goes on a track or stays unplaced with its wake, not both');
  if (wake !== undefined && kind !== 'task') throw new UsageError('only a task in the inbox carries a wake');
  if ((before !== undefined || after !== undefined) && trackRef === undefined) throw new UsageError('before and after place a task among the steps of the track it names');
  const p = validateWorkPayload(kind, raw);
  const ctx = actorOf(actor);
  return tx(db, () => {
    const line = trackRef ? openTrack(db, trackRef.trim()) : null;
    if (p.workstream) p.workstream = refTo(db, p.workstream, 'workstream', ctx.day);
    if (line && p.workstream && p.workstream !== line.fields.workstream) {
      throw new UsageError(line.fields.id + ' is in another workstream than the one this task names');
    }
    if (line) p.workstream = line.fields.workstream;
    p.refs = refsFor(db, p.refs, ctx.day);
    const ws = kind === 'task' ? wsOfTask(db, p.workstream) : null;
    if (kind === 'task') checkServes(p.serves, ws, '');
    /* an inbox task carries its wake; the filing verb (fileRecord) refuses one with none */
    const why = unplaced === undefined ? undefined : unplaced.replace(/\s+/g, ' ').trim();
    const woke = wakeOf(db, wake, ctx.day, null, 'create');
    const key = mintKey(db);
    const id = pickLabel(db, kind, ctx.day);
    const created = p.created || ctx.at;
    const labelHistory = [historyItem({ label: id, from: ctx.day })];
    const front = kind === 'workstream'
      ? {
        id, key, name: p.name, status: p.status, outcome: '',
        projectRepos: p.projectRepos.length ? p.projectRepos : undefined, created, updated: ctx.at, closed: '',
        labels: p.labels, refs: p.refs,
        outcomes: p.outcomes.length ? Object.fromEntries(p.outcomes.map((t, i) => ['o' + (i + 1), t])) : undefined,
        handoff: p.handoff, labelHistory,
      }
      : {
        id, key, name: p.name, workstream: p.workstream, status: p.status, priority: p.priority,
        labels: p.labels, refs: p.refs, created, updated: ctx.at, closed: TERMINAL.task.includes(p.status) ? ctx.at : undefined,
        origin: p.origin, serves: p.serves, reviewScope: p.reviewScope, labelHistory, unplaced: why, wake: woke,
      };
    const fields = orderFront(WORK_KINDS[kind], front);
    putRecord(db, { key, kind, slug: kebab(p.name, kind), fields, body: workBody(kind, p) });
    /* a caller that makes records on its own (the board picture) names its cause */
    const note = typeof raw.note === 'string' && raw.note.trim() ? raw.note.trim() : undefined;
    writeLine(db, ctx, { verb: 'create', kind, front: fields, changes: changesOf({}, fields), note });
    if (line) placeCreated(db, key, line, ctx);
    if (line && (before !== undefined || after !== undefined)) placeTask(db, key, { before, after }, actor);
    /* created done, it runs the shared check as a completion would */
    if (kind === 'task' && fields.status === 'done') afterTask(db, key, { done: true }, actor);
    const warnings = ws && !p.serves.length && Object.keys(outcomeMap(ws)).length
      ? [id + ' serves none of ' + ws.id + "'s outcomes (" + outcomesText(ws) + '): name one with task edit ' + id
        + ' --serves ' + Object.keys(outcomeMap(ws))[0]] : [];
    return { id, key, kind, name: p.name, ...(line ? { track: line.fields.id } : {}), ...(fields.unplaced ? { unplaced: fields.unplaced } : {}), ...(woke ? { wake: wakeWords(db, woke) } : {}),
      ...(warnings.length ? { warnings } : {}) };
  });
}

/* the board's createRecord verb (server/verbs/index.mjs). A session's task names its
   place, a track or unplaced with a reason, else it is refused with both ways; the board's
   hint of the best-fitting track rides the refusal and the result, never applied for it. */
export function fileRecord(db, input = {}, actor) {
  const kind = input && input.kind !== undefined ? String(input.kind) : 'task';
  if (kind !== 'task') return createRecord(db, input, actor);
  const c = actorOf(actor);
  const { tier, ladder: _ladder, whyMark: _mark, newTrack, unparkWhen, whyElsewhere: _why, last: _last, here: _here, question, words, ...rest } = input || {};
  const said = (v) => typeof v === 'string' && v.trim();
  const ended = ['done', 'dropped'].includes(String(input.status || ''));
  return tx(db, () => {
    const talk = talkOf(db, question, words, c);
    /* a session's filing names its tier and is placed by the ladder; a task filed ended has no place */
    const lad = ended ? null : ladderPlace(db, input, c, { via: 'create', marked: Boolean(policedHeld(db, c)) && !input[APPROVED], free: Boolean(talk) });
    /* last or off the held track is asked of the user, and nothing is created */
    if (lad && lad.ask) return { asked: askFiling(db, input, c, { draft: input }, { via: 'place' }) };
    if (lad) {
      const { track, before, after, unplaced, wake, ...base } = rest;
      const ws = lad.inbox ? lad.inbox.ws : lad.park ? lad.park.ws : null;
      if (lad.inbox) wakeOf(db, lad.inbox.wake, c.day, null, 'create');
      const r = createRecord(db, lad.track ? { ...base, track: lad.track.fields.id, before, after }
        : { ...base, workstream: labelOf(db, ws), ...(lad.inbox ? { unplaced: lad.inbox.unplaced || 'filed at tier ' + lad.tier + ' into the inbox of ' + labelOf(db, ws) + ' until its wake', wake: lad.inbox.wake } : {}) }, actor);
      const parked = lad.park ? landPlace(db, r.key, lad, actor) : null;
      if (talk) settleTalk(db, talk, r.key, c);
      return { ...r, ...(parked ? { track: parked.track, parked: true, ...(parked.unpark ? { unpark: parked.unpark } : {}) } : {}), ...settlePlace(db, r.key, lad, actor) };
    }
    const ws = said(input.workstream) ? resolveRecord(db, input.workstream.trim(), { day: c.day }) : null;
    const hint = suggestTrack(db, { ...input, workstream: ws && ws.kind === 'workstream' ? ws.key : null }, c.session);
    const at = { via: 'create', workstream: ws && ws.kind === 'workstream' ? ws.label : null };
    if (c.session && !said(input.track) && !said(input.unplaced)) throw new UsageError(placeRefusal(hint, at));
    /* every inbox filing names its wake, whoever files it; a task filed ended is none */
    const no = said(input.track) || ended ? null : inboxLacks(input.unplaced, input.wake, at) || ownTrackLacks(db, input.wake, c.session, at);
    if (no) throw new UsageError(no);
    const r = createRecord(db, rest, actor);
    if (talk) settleTalk(db, talk, r.key, c);
    const out = hint && hint.track !== r.track ? { ...r, suggested: hint } : r;
    return ended ? out : { ...out, ...settlePlace(db, r.key, { tier: landedTier(db, r.key, c.session), approved: Boolean(input[APPROVED] || talk) }, actor) };
  });
}

/* ---- edit ---- */

function applyEdit(k, front, c) {
  const changed = [];
  const setScalar = (key, value) => { if (String(front[key] ?? '') !== String(value)) { front[key] = value; changed.push(key); } };
  const setList = (key, next) => {
    const before = listOf(front, key);
    if (before.length === next.length && before.every((v, i) => v === next[i])) return;
    front[key] = next;
    changed.push(key);
  };
  if (c.name !== undefined) setScalar('name', c.name);
  if (c.status !== undefined) setScalar('status', c.status);
  if (c.priority !== undefined) setScalar('priority', c.priority);
  if (c.clearWorkstream) { if (front.workstream !== undefined && front.workstream !== '') { delete front.workstream; changed.push('workstream'); } }
  else if (c.workstream !== undefined) setScalar('workstream', c.workstream);
  if (c.clearHandoff) { if (front.handoff) { delete front.handoff; changed.push('handoff'); } } else if (c.handoff !== undefined) setScalar('handoff', c.handoff);
  if (c.clearRunBy) { if (front.runBy) { delete front.runBy; changed.push('runBy'); } } else if (c.runBy !== undefined) setScalar('runBy', c.runBy);
  if (c.reviewScope === 'track') { if (front.reviewScope) { delete front.reviewScope; changed.push('reviewScope'); } } else if (c.reviewScope !== undefined) setScalar('reviewScope', c.reviewScope);
  /* setting a review scope marks a review, which is known by its label alone */
  if (c.reviewScope !== undefined && !listOf(front, 'labels').some((l) => String(l).toLowerCase() === 'review')) setList('labels', listOf(front, 'labels').concat('review'));
  /* --add-project and --remove-project edit the shared names */
  const names = (l) => l && l.map(projectName);
  for (const [key, add, remove] of [['labels', c.addLabel, c.removeLabel], ['refs', c.addRef, c.removeRef], ['projectRepos', names(c.addProject), names(c.removeProject)],
    ['files', c.addFile, c.removeFile], ['commands', c.addCommand, c.removeCommand]]) {
    if (!add?.length && !remove?.length) continue;
    if (!k.arrays.includes(key)) throw new UsageError('a ' + k.kind + ' carries no ' + key);
    let next = listOf(front, key);
    for (const v of add || []) if (!next.includes(v)) next.push(v);
    if (remove?.length) next = next.filter((v) => !remove.includes(v));
    setList(key, next);
  }
  if (c.projectRepos !== undefined) setList('projectRepos', c.projectRepos);
  return changed;
}

/* a task in a session's hand is that session's open run, so it
   holds several, each started when taken. A run another session has open on the task (in
   hand or its agent's) moves only by a take-over, which that session hears from the run's
   end line. Gives back the note the take's line carries. */
function settleHand(db, e, front, c, ctx, changed) {
  const ended = TERMINAL.task.includes(front.status);
  if (c.inHand && ended) throw new UsageError(front.id + ' is ' + front.status + '; an ended task is never in hand');
  const open = openRunsOn(db, e.key);
  const mine = open.find((r) => r.worker === 'session' && r.session === ctx.session);
  if (c.inHand && !mine) {
    const notes = [];
    const other = open.find((r) => r.session !== ctx.session);
    if (other && !c.takeOver) throw new UsageError(heldRefusal(front, other, ctx));
    /* a task some run already works has started: a take of it asks no readiness */
    if (front.status === 'open' && !open.length) {
      const r = readiness(db, e.key);
      const reason = typeof c.reason === 'string' ? c.reason.trim() : '';
      if (!r.ready && !reason) {
        throw new UsageError(front.id + ' is not ready (' + r.held + '): give a reason to take it in hand anyway, or remove the edge that is wrong');
      }
      if (!r.ready) notes.push('taken in hand before ready: ' + reason);
    }
    openRun(db, { tasks: [e.key], worker: 'session', takeOver: c.takeOver === true, continues: c.continues, note: notes.join('; ') || undefined }, asActor(ctx));
    changed.push('inHand');
  }
  if (c.letGo && mine) {
    endSessionRuns(db, { tasks: [e.key] }, asActor(ctx));
    changed.push('inHand');
  }
}

/* A verb's read actor back as an actor for a writer, its session `session` when named. */
const asActor = (ctx, session) => ({ by: ctx.by, session: session || ctx.session, pc: ctx.pc, now: ctx.date });

/* An open run as the user hears who holds it: in hand or its agent's, the PC, since, and the run. */
const heldRefusal = (front, r, ctx) => front.id + (r.worker === 'agent' ? ' is run by agent ' + (r.job || 'with no job name') + ' of ' : ' is in hand with ')
  + holderWords({ pc: r.pc, since: r.started, seen: r.heard }, { now: ctx.date.getTime(), pc: ctx.pc }) + ', run ' + r.id
  + ': tell the user who holds it; it moves only by a take-over (takeOver on task_update, or --take-over on the CLI), which that session hears at its next prompt';

const HAND = `SELECT rt.task AS key, max(r.started) AS since FROM runs r JOIN run_tasks rt ON rt.run = r.id
  WHERE r.session = ? AND r.worker = 'session' AND r.ended IS NULL GROUP BY rt.task ORDER BY since DESC, max(r.id) DESC`;

/* the tasks a session has in hand (its open session runs), newest taken first, as keys. */
export const handKeys = (db, session) => (session ? db.stmt(HAND).all(session).map((r) => r.key) : []);

/* A handoff ends the session's runs in hand as handed on, naming the handoff; keys newest first. */
export function letGoHand(db, session, actor, note, handoff) {
  const ctx = actorOf(actor);
  return endSessionRuns(db, { session, handoff, note }, asActor(ctx, session));
}

/* What started a task's work, else null: a session held it, an agent ran it, or
   it was started. A note is no start: the board writes some (an answered gate). */
export function startedBy(db, e) {
  const f = e.front;
  const runs = db.stmt(`SELECT r.worker, r.job, r.session, r.ended FROM run_tasks rt JOIN runs r ON r.id = rt.run WHERE rt.task = ?
    ORDER BY r.ended IS NOT NULL, r.started DESC, r.id DESC`).all(e.key);
  const said = (r, now) => (r.worker === 'session' ? sessionWords(db, r.session) + (now ? ' has it in hand' : ' held it') : 'agent ' + r.job + (now ? ' runs it' : ' ran it'));
  if (runs.length && !runs[0].ended) return said(runs[0], true);
  if (f.status === 'done') return 'it is done';
  if (listOf(f, 'claimants').length) return 'a session claimed it';
  if (runs.length) return said(runs[0], false);
  /* a board from before runs (migration 015) holds its starts in activity rows only */
  const row = db.stmt(`SELECT json_extract(line, '$.changes.inHand[1]') AS hand, json_extract(line, '$.changes.agent[1]') AS agent FROM activity
    WHERE record = ? AND (json_extract(line, '$.changes.inHand[1]') IS NOT NULL OR json_extract(line, '$.changes.agent[1]') IS NOT NULL
    OR json_extract(line, '$.changes.status[1]') = 'in_progress') LIMIT 1`).get(e.key);
  if (!row) return null;
  return row.hand ? sessionWords(db, row.hand) + ' held it' : row.agent ? 'agent ' + row.agent + ' ran it' : 'it was started';
}

/* The sections a rewrite moves: a task's description and intent, a track's goal
   (its Description section and goal field). */
const TEXT_FIELDS = { task: [['description', 'Description'], ['intent', 'Intent']], track: [['goal', 'Description']] };

function movedTexts(e, c) {
  const secs = sectionsOf(e.body);
  let body = e.body;
  const moved = [];
  for (const [field, name] of TEXT_FIELDS[e.kind] || []) {
    if (c[field] === undefined) continue;
    const next = guardHeadings(c[field]);
    const old = secs[name] ?? '';
    if (next === old) continue;
    body = withSection(body, name, next);
    moved.push({ field, old, next });
  }
  return { body, moved };
}

/* a task's intent and description rewrite in place until its work
   starts; after that a note carrying the new text amends them, the note its why. */
function editTexts(db, e, k, c) {
  if (c.intent === undefined && c.description === undefined) return null;
  if (k.kind !== 'task') throw new UsageError("only a task's intent and description are rewritten by edit");
  const { body, moved } = movedTexts(e, c);
  if (!moved.length) return null;
  const why = startedBy(db, e);
  if (why) {
    const flags = moved.map((m) => '--' + m.field + ' "..."').join(' ');
    throw new UsageError(e.front.id + ' has started (' + why + '), so the rewrite is an amend with its why:\n'
      + 'note ' + e.front.id + ' ' + flags + ' --body "why the work changed" (task_update and the note tool take the same fields).');
  }
  return { body, moved };
}

const fieldNamed = (c) => ['name', 'status', 'priority', 'workstream', 'handoff', 'serves', 'projectRepos', 'runBy', 'reviewScope', 'intent', 'description'].some((key) => c[key] !== undefined)
  || c.clearRunBy || c.clearHandoff || c.close !== undefined || c.clearClose || c.clearWorkstream || c.inHand || c.letGo || c.clearServes || c.addOutcome?.length || c.removeOutcome?.length
  || ['addLabel', 'removeLabel', 'addRef', 'removeRef', 'addProject', 'removeProject'].some((key) => c[key]?.length);

/* Field flips, and a task's intent and description while its work has not started.
   `input` is { id, kind?, version?, ...today's change flags }; track (with before
   and after) or unplaced moves a task to the place its filer judged. A close
   carries its leftovers, filed with it in one transaction (leftovers.mjs). */
export function editRecord(db, input = {}, actor) {
  const { track, before, after, unplaced, wake, leftovers, tier, ladder: _ladder, whyMark: _mark, newTrack, unparkWhen, whyElsewhere, last, here, question, words, ...rest } = input || {};
  const place = { track, before, after, unplaced, wake };
  /* a move to a new home (not an edge on the track it holds) names its tier */
  const moving = [track, unplaced, wake, tier, newTrack, unparkWhen].some((v) => v !== undefined);
  const placing = moving || Object.values(place).some((v) => v !== undefined);
  /* an empty list is none, as a handoff's is */
  const leaving = Array.isArray(leftovers) ? leftovers.length > 0 : leftovers !== undefined && leftovers !== null;
  if (!placing && !leaving) return editFields(db, rest, actor);
  if (rest.kind !== undefined && rest.kind !== 'task') throw new UsageError(placing ? 'only a task has a place on a track' : 'only a task closes with leftovers');
  if (leaving && !TERMINAL.task.includes(rest.status)) throw new UsageError('leftovers go with closing the task: status done or dropped in the same call');
  if (leaving && !Array.isArray(leftovers)) throw new UsageError('leftovers is a list of steps: { name, runBy }, each on the closing task\'s track, a newTrack or unplaced with its wake');
  return tx(db, () => {
    const out = fieldNamed(rest) ? editFields(db, rest, actor) : null;
    const c = actorOf(actor);
    const e = target(db, rest.id, ['task'], c.day, 'edit');
    /* a wake (with or without its reason) on a task on no track wakes it again, no filing */
    const inbox = !db.stmt('SELECT 1 FROM track_items WHERE task = ?').get(e.key);
    const again = inbox && wake !== undefined && [track, tier, newTrack, unparkWhen, rest.workstream].every((v) => v === undefined);
    const base = () => out || { id: e.front.id, kind: 'task', name: e.front.name };
    const versionNow = () => db.stmt('SELECT version FROM records WHERE key = ?').get(e.key).version;
    const talk = talkOf(db, question, words, c);
    const free = Boolean(input[APPROVED]) || Boolean(talk);
    const f = { ...place, tier, newTrack, unparkWhen, whyElsewhere, last, here, workstream: rest.workstream, ...(input[APPROVED] ? { [APPROVED]: input[APPROVED] } : {}) };
    /* a moved task asked of the user stays where it is; the close and its leftovers still land */
    const askMove = () => {
      const asked = askFiling(db, f, c, { task: e.front.id }, { via: 'place', task: e.front.id }, new Set([e.key]));
      const left = leaving ? leaveOnClose(db, e.key, leftovers, actor) : null;
      return { ...base(), changed: out ? out.changed : [], asked, ...(left ? { leftovers: left, steps: stepsOf(left) } : {}), version: versionNow() };
    };
    /* a next-session wake alone sets the wait on the track the task is on, no filing; on the held track a later session is asked */
    if (isNextSession(wake) && [track, tier, unplaced, newTrack, unparkWhen, before, after, rest.workstream].every((v) => v === undefined)) {
      const heldRec = free ? null : policedHeld(db, c);
      const onHeld = heldRec && db.stmt('SELECT 1 FROM track_items WHERE track = ? AND task = ?').get(heldRec.key, e.key);
      const sw = onHeld ? bypassFor(db, c, heldRec) : null;
      if (onHeld && !sw) return askMove();
      const placed = waitNextSession(db, e.key, actor);
      const left = leaving ? leaveOnClose(db, e.key, leftovers, actor) : null;
      return { ...base(), changed: [...(out ? out.changed : []), 'wake'], placed, ...(left ? { leftovers: left, steps: stepsOf(left) } : {}), version: versionNow() };
    }
    const moves = moving && !again;
    const lad = moves ? ladderPlace(db, { ...f, name: e.front.name, labels: e.front.labels }, c,
      { via: 'edit', task: e.front.id, taskWs: e.front.workstream, unplaced: inbox ? e.front.unplaced : undefined, marked: Boolean(policedHeld(db, c)) && !input[APPROVED], free, skip: new Set([e.key]) }) : null;
    if (lad && lad.ask) return askMove();
    const placed = lad ? landPlace(db, e.key, lad, actor) : placing ? placeTask(db, e.key, place, actor) : null;
    const settled = moves && placed && !placed.asked ? settlePlace(db, e.key, lad || { tier: landedTier(db, e.key, c.session), approved: free }, actor) : null;
    if (talk && placed && !placed.asked) settleTalk(db, talk, e.key, c);
    const left = leaving ? leaveOnClose(db, e.key, leftovers, actor) : null;
    const version = db.stmt('SELECT version FROM records WHERE key = ?').get(e.key).version;
    /* a third wake stores nothing; the user is asked instead */
    return { ...(out || { id: e.front.id, kind: 'task', name: e.front.name }), changed: [...(out ? out.changed : []), ...(placed && !placed.asked ? ['place'] : [])],
      ...(placed ? { placed } : {}), ...(settled || {}), ...(left ? { leftovers: left, steps: stepsOf(left) } : {}), version };
  });
}

/* A bulk call's steps, each filed (id) or asked (the question register returned), by their number from 1. */
export const stepsOf = (list) => list.map((t, i) => (t.asked && !t.id ? { step: i + 1, asked: t.asked } : { step: i + 1, id: t.id }));

function editFields(db, input, actor) {
  const c = { ...input };
  const ctx = actorOf(actor);
  if (c.kind !== undefined && !WORK_KINDS[c.kind]) throw new UsageError(refusal[c.kind] || 'unknown record kind: ' + c.kind);
  if (c.kind === 'knowledge') throw new UsageError(refusal.knowledge);
  for (const key of ['ordinal', 'plan', 'clearPlan']) {
    if (c[key] !== undefined) throw new UsageError('a task has no ' + key.replace('clearPlan', 'plan') + ' on the board: its track and place are the track verbs');
  }
  if (c.landed) throw new UsageError('a task carries no landed mark: a look task ends by asking the user one question gating it (register with gates), and its session closes it once the answer is right');
  if (c.name !== undefined) {
    if (typeof c.name !== 'string' || !c.name.trim()) throw new UsageError('--name needs a non-empty value');
    c.name = c.name.trim();
  }
  if (c.clearWorkstream && c.workstream !== undefined) throw new UsageError('pick one of --workstream and --clear-workstream');
  for (const [flag, value] of [['--add-label', c.addLabel], ['--remove-label', c.removeLabel], ['--add-ref', c.addRef],
    ['--remove-ref', c.removeRef], ['--add-project', c.addProject], ['--remove-project', c.removeProject], ['projectRepos', c.projectRepos]]) {
    if (value === undefined) continue;
    if (!Array.isArray(value) || value.some((s) => typeof s !== 'string' || !s.trim())) throw new UsageError(flag + ' needs non-empty text');
  }
  if (c.inHand && c.letGo) throw new UsageError('pick one of --in-hand and --let-go');
  if (c.takeOver && !c.inHand && !TERMINAL.task.includes(c.status)) throw new UsageError('--take-over goes with --in-hand or --status done or dropped');
  if (c.inHand && !ctx.session) throw new UsageError('--in-hand needs --session <own-id>: the session that has it in hand');
  if (c.serves !== undefined && c.clearServes) throw new UsageError('pick one of --serves and --clear-serves');
  for (const key of ['intent', 'description']) {
    if (c[key] === undefined) continue;
    if (typeof c[key] !== 'string') throw new UsageError('--' + key + ' needs text');
    c[key] = c[key].replace(/\r\n/g, '\n').trim();
  }
  if (c.description === '') throw new UsageError('--description needs text');
  if (c.handoff !== undefined && c.clearHandoff) throw new UsageError('pick one of --handoff and --clear-handoff');
  if (c.handoff !== undefined) c.handoff = handoffPath(c.handoff, '--handoff');
  /* who runs the task, as a handoff's leftover names it */
  if (c.runBy !== undefined && c.clearRunBy) throw new UsageError('pick one of --run-by and --clear-run-by');
  if (c.runBy !== undefined && !(c.runBy = runByOf(c.runBy))) throw new UsageError('--run-by names who runs it: ' + RUN_BY_HINT);
  if (c.reviewScope !== undefined) c.reviewScope = reviewScopeOf(c.reviewScope, '--review-scope');
  c.addOutcome = c.addOutcome?.length ? outcomeLines(c.addOutcome, '--add-outcome') : [];
  c.removeOutcome = c.removeOutcome?.length ? outcomeIds(c.removeOutcome, '--remove-outcome') : [];
  if (c.serves !== undefined) {
    c.serves = outcomeIds(c.serves, '--serves');
    if (!c.serves.length) throw new UsageError('--serves needs outcome ids (o1,o2); --clear-serves empties the list');
  }
  if (!fieldNamed(c)) throw new UsageError('edit needs at least one field flag');

  return tx(db, () => {
    const e = target(db, c.id, c.kind ? [c.kind] : ['workstream', 'task'], ctx.day, 'edit');
    const k = WORK_KINDS[e.kind];
    if (c.status !== undefined) {
      if (k.kind !== 'task') throw new UsageError('a ' + k.kind + ' changes state through ' + k.verb + ' close and reopen, not --status');
      if (!k.statuses.includes(statusWord(k.kind, c.status, '--status'))) throw new UsageError('status must be one of ' + k.statuses.join(', '));
    }
    if (c.priority !== undefined) {
      if (k.kind !== 'task') throw new UsageError('a ' + k.kind + ' carries no priority');
      if (!PRIORITIES.includes(c.priority)) throw new UsageError('priority must be one of ' + PRIORITIES.join(', '));
    }
    if ((c.workstream !== undefined || c.clearWorkstream) && k.kind === 'workstream') {
      throw new UsageError('a workstream never references a workstream (the depth cap, spec section 5)');
    }
    if ((c.inHand || c.letGo) && k.kind !== 'task') throw new UsageError('only a task is taken in hand');
    if ((c.addOutcome.length || c.removeOutcome.length) && k.kind !== 'workstream') throw new UsageError('only a workstream carries outcomes');
    if ((c.serves !== undefined || c.clearServes) && k.kind !== 'task') throw new UsageError('only a task serves outcomes');
    if ((c.handoff !== undefined || c.clearHandoff) && k.kind !== 'workstream') throw new UsageError('only a workstream carries a handoff folder');
    if ((c.runBy !== undefined || c.clearRunBy) && k.kind !== 'task') throw new UsageError('only a task is run by someone');
    if (c.reviewScope !== undefined && k.kind !== 'task') throw new UsageError('only a review task has a review scope');
    checkVersion(e, c);
    const texts = editTexts(db, e, k, c);
    /* the one close (ending.mjs): refused, writing nothing, while a step stays open */
    if (k.kind === 'task' && TERMINAL.task.includes(c.status) && !TERMINAL.task.includes(e.front.status)) {
      gateEnding(db, e.key, e.front.id, c[SETTLED]);
      /* another session's open run moves only by a take-over, a close's too */
      const held = ctx.session ? othersRuns(db, e.key, ctx.session) : [];
      if (held.length && !c.takeOver) throw closeHeldRefusal(db, e.front.id, held, ctx);
    }
    if (c.workstream) c.workstream = refTo(db, c.workstream, 'workstream', ctx.day);
    if (c.addRef) c.addRef = refsFor(db, c.addRef, ctx.day);
    if (c.removeRef) c.removeRef = c.removeRef.concat(refsFor(db, c.removeRef, ctx.day));
    const front = normalize(k, { ...e.front });
    const before = snap(front);
    const changed = applyEdit(k, front, c);
    if (front.reviewScope === 'project' && !isReview(front)) throw new UsageError(front.id + ' has a project review scope, so it keeps the label review (--review-scope track clears the scope)');
    if (texts) changed.push(...texts.moved.map((m) => m.field));
    const warnings = [];
    if (k.kind === 'workstream') editOutcomes(db, e, front, c, changed, warnings);
    if (k.kind === 'task') {
      editServes(db, front, before, c, changed);
      settleHand(db, e, front, c, ctx, changed);
    }
    editClose(db, e, front, c, changed, ctx);
    if (!changed.length) return { id: front.id, kind: k.kind, name: front.name, changed: [], version: e.version };
    /* taking and letting go answer in their own words */
    const hand = changed.includes('inHand') ? (c.inHand ? 'taken' : 'let go') : null;
    /* the hand is the run's, written with its own line: the record itself moves only for the rest */
    if (changed.every((x) => x === 'inHand')) return { id: front.id, kind: k.kind, name: front.name, changed, hand, version: e.version };
    if (changed.includes('status')) endingStamps(db, k.kind, front, before, ctx);
    front.updated = ctx.at;
    const fields = orderFront(k, front);
    save(db, e, fields, texts ? texts.body : undefined);
    const ending = k.kind === 'task' && changed.includes('status') && TERMINAL.task.includes(fields.status) ? fields.status : null;
    let changes = closeChanges(db, changesOf(before, fields), before, fields);
    /* a task's title keeps its old words in the history, as its description does */
    const moved = [...(k.kind === 'task' && before.name !== fields.name ? [{ field: 'name', old: before.name ?? '', next: fields.name }] : []), ...(texts ? texts.moved : [])];
    if (moved.length) {
      const ids = moved.map((m) => addHistory(db, ctx, { key: e.key, field: m.field, old: m.old, next: m.next, why: 'edited in place' }));
      changes = { ...changes, ...Object.fromEntries((texts ? texts.moved : []).map((m) => [m.field, 'edited'])), history: historyRef(ids) };
    }
    writeLine(db, ctx, { verb: 'edit', kind: k.kind, front: fields, changes });
    /* an ending ends the task's open runs (runs.mjs endTaskRuns) */
    if (ending) endTaskRuns(db, e.key, ending, asActor(ctx), { takeOver: c.takeOver === true });
    /* the shared check, a review's default covers */
    const covers = ending ? afterEnding(db, e.key, fields, ending, ctx, actor) : null;
    return { id: fields.id, kind: k.kind, name: fields.name, changed, ...(hand ? { hand } : {}), ...(covers ? { covers } : {}), version: e.version + 1, ...(warnings.length ? { warnings } : {}) };
  });
}

/* task update: the field edit, the steps and the note in one transaction, so a
   refusal part way through leaves nothing written. An agent's run opens at its dispatch. */
export function taskUpdate(db, input = {}, actor) {
  const { id, reason, status, note, name, priority, addLabel, removeLabel, leftovers, description, intent } = input || {};
  if (status !== undefined) statusWord('task', status, '--status');
  if ((description !== undefined || intent !== undefined) && note === undefined) throw new UsageError('a new description or intent rides --note: why the work changed');
  /* a new title with a note is an amend like the description, the note its why */
  const retitle = note !== undefined && name !== undefined ? name : undefined;
  const edit = { name: retitle === undefined ? name : undefined, priority, inHand: input.inHand === true, letGo: input.letGo === true, takeOver: input.takeOver === true && (input.inHand === true || status !== undefined), addLabel, removeLabel, reason,
    ...(input.takeOver === true && input.inHand === true && typeof input.continues === 'string' && input.continues.trim() ? { continues: input.continues.trim() } : {}),
    ...(status !== undefined ? { status } : {}), ...(leftovers !== undefined ? { leftovers } : {}) };
  const editing = edit.name !== undefined || priority !== undefined || edit.inHand || edit.letGo || edit.status !== undefined
    || Boolean(addLabel?.length) || Boolean(removeLabel?.length) || leftovers !== undefined;
  const { checks, moveSteps: moves } = input || {};
  if (moves !== undefined && leftovers !== undefined) throw new UsageError('moveSteps and leftovers go in two calls: move the steps first, then close with its leftovers');
  if (!editing && note === undefined && checks === undefined && moves === undefined) throw new UsageError('task update needs --status, --priority, --name, --in-hand, --let-go, a label, a check, a step to move or --note');
  return tx(db, () => {
    const out = {};
    if (checks !== undefined) out.checks = settleChecks(db, id, checks, actor);
    if (moves !== undefined) Object.assign(out, moveSteps(db, id, moves, actor));
    const left = stepsLeft(db, id, edit.leftovers, actor);
    /* the steps its leftovers file count as settled at the close; they are struck once filed */
    if (left) { edit.leftovers = left.steps; edit[SETTLED] = left.taken; }
    if (editing) out.edit = editRecord(db, { id, kind: 'task', ...edit }, actor);
    /* the reply names the checklist's change, so an edit that changed nothing else never reads unchanged */
    if (out.edit && out.checks && out.checks.did) out.edit.checklist = out.checks.did;
    if (out.edit && out.edit.hand) out.hand = out.edit.hand;
    if (out.edit && out.edit.leftovers) Object.assign(out, { leftovers: out.edit.leftovers, steps: out.edit.steps });
    if (left && left.taken.length && out.leftovers) {
      const strike = left.taken.map((n, i) => ({ step: n, why: leftWhy(out.leftovers[left.at[i]]) }));
      out.checks = settleChecks(db, id, { strike }, actor);
    }
    if (note !== undefined) out.note = noteRecord(db, { id, text: note, name: retitle, description, intent }, actor);
    /* taking a task in hand hands the session the rulings linked to it */
    if (edit.inHand) {
      const ds = decisionsFor(db, { task: out.edit.id }).map((d) => ({ id: d.id, name: d.name }));
      if (ds.length) out.decisions = ds;
    }
    /* a take hands the worker what the task holds now, not its name alone */
    if (edit.inHand) out.block = blockOf(db, resolveRecord(db, String(id).trim(), { kinds: ['task'], day: actorOf(actor).day }).key, { now: clockOf(actor).getTime(), reader: actorOf(actor).session || null }).text;
    return out;
  });
}

/* A close's leftover may name an open checklist step by its number (check) in place of a
   name: it files with the step's text, and the step is struck as left once it lands. */
function stepsLeft(db, id, steps, actor) {
  if (!Array.isArray(steps) || !steps.some((s) => s && typeof s === 'object' && s.check !== undefined)) return null;
  const e = target(db, id, ['task'], actorOf(actor).day, 'edit');
  const items = itemsOf(db, e.key);
  const taken = [], at = [];
  const out = steps.map((s, i) => {
    if (!s || typeof s !== 'object' || s.check === undefined) return s;
    const { check, ...rest } = s;
    const n = Number(check);
    const where = 'leftovers[' + i + ']: ';
    const step = items.find((s) => s.n === n);
    if (!step) throw new UsageError(where + 'check names ' + JSON.stringify(check) + ', and ' + e.front.id + "'s steps are " + (items.map((s) => s.n).join(', ') || 'none'));
    if (step.done) throw new UsageError(where + 'check ' + n + ' is already ' + (step.struck ? 'struck' : 'done'));
    if (rest.task !== undefined) throw new UsageError(where + 'check files the step as a new task, so it takes no task');
    if (taken.includes(n)) throw new UsageError(where + 'check ' + n + ' is named twice');
    taken.push(n);
    at.push(i);
    return { ...rest, name: rest.name ?? step.text, description: rest.description ?? stepShort(e.front.id, n, step.text) };
  });
  return { steps: out, taken, at };
}

/* A step filed as its own task says where it came from: its number, its task and its text.
   skills/doctor/checks.mjs STEP_SHORT mirrors this form, so the doctor counts it as a done clause. */
export const stepShort = (id, n, text) => 'Step ' + n + ' of ' + id + ': ' + text;
/* a closing step left as a task, or asked of the user */
const leftWhy = (t) => (t.asked && !t.id ? 'asked as ' + t.asked.id : 'left as ' + t.id);

const MOVES_HINT = 'moveSteps is a list of moves, each naming its step by number (check) and one destination: { check, onto: "T-n" } (a step of that task),'
  + ' { check, question: "Q-n" } (a question already asked), or { check, runBy, tier, ... } (a new task, placed as a leftover is)';

/* a step its worker will not do moves onto another open task, into a new task by the
   leftover ladder, or to an open question; each is struck with where it went, in one line on the task. */
function moveSteps(db, id, moves, actor) {
  if (!Array.isArray(moves) || !moves.length) throw new UsageError(MOVES_HINT);
  const c = actorOf(actor);
  const e = target(db, id, ['task'], c.day, 'edit');
  const items = itemsOf(db, e.key);
  const seen = [];
  const plan = moves.map((m, i) => {
    const where = 'moveSteps[' + i + ']: ';
    if (!m || typeof m !== 'object' || Array.isArray(m)) throw new UsageError(where + MOVES_HINT);
    const { check, onto, question, here, whyElsewhere, ...place } = m;
    /* a move onto a task on another track is asked, so it carries here and its reason */
    if (onto === undefined && here !== undefined) place.here = here;
    if (onto === undefined && whyElsewhere !== undefined) place.whyElsewhere = whyElsewhere;
    const n = Number(check);
    const step = items.find((s) => s.n === n);
    if (!step) throw new UsageError(where + 'check names ' + JSON.stringify(check) + ', and ' + e.front.id + "'s steps are " + (items.map((s) => s.n).join(', ') || 'none'));
    if (step.done) throw new UsageError(where + 'check ' + n + ' is already ' + (step.struck ? 'struck' : 'done'));
    if (seen.includes(n)) throw new UsageError(where + 'check ' + n + ' is named twice');
    seen.push(n);
    if (onto !== undefined && question !== undefined) throw new UsageError(where + 'a step moves to one place: onto a task or to a question');
    if ((onto !== undefined || question !== undefined) && Object.keys(place).length) {
      throw new UsageError(where + 'a move ' + (onto !== undefined ? 'onto a task' : 'to a question') + ' takes no ' + Object.keys(place).join(', '));
    }
    if (onto !== undefined) {
      const t = resolveRecord(db, String(onto).trim(), { kinds: ['task'], day: c.day });
      if (!t) throw new UsageError(where + 'onto names a task: no task ' + onto);
      if (t.key === e.key) throw new UsageError(where + 'onto names ' + e.front.id + ' itself');
      if (TERMINAL.task.includes(t.front.status)) throw new UsageError(where + t.label + ' is ' + t.front.status + ': a step moves onto an open task');
      return { n, step, onto: t, here, whyElsewhere };
    }
    if (question !== undefined) {
      const q = resolveRecord(db, String(question).trim(), { kinds: ['question'], day: c.day });
      if (!q) throw new UsageError(where + 'question names a question: no question ' + question + ' (ask it first through your own tool)');
      if (q.front.status !== 'open') throw new UsageError(where + q.label + ' is ' + q.front.status + ': a step moves to an open question');
      return { n, step, question: q };
    }
    return { n, step, place: { ...place, name: place.name ?? step.text, description: place.description ?? stepShort(e.front.id, n, step.text) } };
  });
  const filed = plan.filter((p) => p.place);
  let laid = [];
  if (filed.length) {
    const row = db.stmt('SELECT track FROM track_items WHERE task = ?').get(e.key);
    const track = row ? loadRecord(db, row.track) : null;
    try {
      laid = layLeftovers(db, { track, workstream: e.front.workstream || (track && track.fields.workstream) || null, from: e.front.id,
        why: 'work moved from ' + e.front.id, inbox: true, session: c.session, follows: null, closing: e.key }, filed.map((p) => p.place), actor).steps;
    } catch (err) {
      /* the layout counts the new tasks alone; the refusal names the move by its own place in the list */
      const m = /^leftovers step (\d+)/.exec(String(err.message));
      if (m) err.message = 'moveSteps[' + plan.indexOf(filed[Number(m[1]) - 1]) + ']' + String(err.message).slice(m[0].length);
      throw err;
    }
  }
  const heldRec = policedHeld(db, c);
  const offHeld = (t) => heldRec && !db.stmt('SELECT 1 FROM track_items WHERE track = ? AND task = ?').get(heldRec.key, t.key);
  const out = plan.map((p, i) => {
    if (p.onto && offHeld(p.onto)) {
      if (bypassFor(db, c, heldRec)) return { check: p.n, to: p.onto.label, step: addItem(db, { task: p.onto.key, text: p.step.text }, actor).n };
      const draft ={ name: p.step.text, description: stepShort(e.front.id, p.n, p.step.text) };
      try {
        return { check: p.n, asked: askFiling(db, { onto: p.onto.label, here: p.here, whyElsewhere: p.whyElsewhere }, c, { draft }, { via: 'moveSteps', task: e.front.id, step: p.n }, new Set([e.key])) };
      } catch (err) {
        if (err instanceof TrackRefusal) err.message = 'moveSteps[' + i + ']: ' + err.message;
        throw err;
      }
    }
    if (p.onto) return { check: p.n, to: p.onto.label, step: addItem(db, { task: p.onto.key, text: p.step.text }, actor).n };
    if (p.question) return { check: p.n, to: p.question.label };
    const t = laid[filed.indexOf(p)];
    if (t.asked && !t.id) return { check: p.n, asked: t.asked };
    return { check: p.n, to: t.id, ...(t.track ? { track: t.track } : {}), ...(t.inbox ? { inbox: true } : {}) };
  });
  const why = (o, p) => (o.asked ? 'asked as ' + o.asked.id : p.question ? 'asked as ' + o.to : 'moved to ' + o.to + (o.step ? ' step ' + o.step : ''));
  const checks = settleChecks(db, e.front.id, { strike: out.map((o, i) => ({ step: o.check, why: why(o, plan[i]) })) }, actor);
  return { moves: out, steps: out.map((o) => (o.asked ? { step: o.check, asked: o.asked } : { step: o.check, id: o.to })), checks };
}


/* ---- close and reopen (workstreams; a task's statuses carry its life) ---- */

function closeRefusal(kind) {
  if (kind === 'task') return 'a task has no close verb: task edit --status done or dropped';
  return null;
}

/* `input` is { id, kind?, outcome?, version? }. */
export function closeRecord(db, input = {}, actor) {
  const ctx = actorOf(actor);
  const { outcome } = input;
  if (outcome !== undefined && (typeof outcome !== 'string' || !outcome.trim())) throw new UsageError('--outcome needs text');
  if (input.kind !== undefined && input.kind !== 'workstream') throw new UsageError(closeRefusal(input.kind) || refusal[input.kind] || 'unknown record kind: ' + input.kind);
  return tx(db, () => {
    const hit = resolveRecord(db, String(input.id ?? '').trim(), { day: ctx.day });
    if (hit && closeRefusal(hit.kind)) throw new UsageError(closeRefusal(hit.kind));
    const e = target(db, input.id, ['workstream'], ctx.day, 'close');
    checkVersion(e, input);
    const k = WORK_KINDS.workstream;
    const front = normalize(k, { ...e.front });
    if (front.status === 'closed') throw new UsageError(front.id + ' is already closed; closing it again would restamp a date that already happened');
    const before = snap(front);
    front.status = 'closed';
    front.closed = ctx.at;
    front.updated = ctx.at;
    if (outcome !== undefined) front.outcome = outcome.trim();
    const fields = orderFront(k, front);
    save(db, e, fields);
    writeLine(db, ctx, { verb: 'close', kind: 'workstream', front: fields, changes: changesOf(before, fields) });
    wakeLinked(db, { ...fields, key: e.key }, fields.outcome ? 'closed ' + fields.outcome : 'closed', ctx);
    return {
      id: fields.id, kind: 'workstream', name: fields.name, status: 'closed', outcome: fields.outcome, closed: fields.closed,
      refs: listOf(shownFront(db, fields), 'refs'),
    };
  });
}

/* For a premature close or a drop's undo; a workstream reopened past its archive day takes a fresh label. */
export function reopenRecord(db, input = {}, actor, opts) {
  const ctx = actorOf(actor);
  return tx(db, () => {
    const hit = resolveRecord(db, String(input.id ?? '').trim(), { day: ctx.day });
    if (hit && hit.kind === 'question') return reopenQuestion(db, input, actor, opts);
    if (['until', 'trigger', 'wakeOn'].some((k) => input[k] !== undefined)) throw new UsageError('--until, --trigger and --wake-on snooze a reopened question, not a ' + ((hit && hit.kind) || 'record'));
    if (hit && hit.kind === 'task') throw new UsageError('a task reopens through task edit --status, not the reopen verb');
    if (hit && hit.kind === 'knowledge') throw new UsageError('a knowledge record has no reopen verb: a retired one comes back by knowledge reinstate ' + hit.label + ' --reason; a superseded or withdrawn one stays ended');
    const e = target(db, input.id, ['workstream'], ctx.day, 'reopen');
    checkVersion(e, input);
    const k = WORK_KINDS.workstream;
    const front = normalize(k, { ...e.front });
    if (front.status !== 'closed') throw new UsageError(front.id + ' is ' + front.status + ', not closed');
    const before = snap(front);
    front.status = 'open';
    front.closed = '';
    front.outcome = '';
    front.updated = ctx.at;
    relabelIfArchived(db, 'workstream', front, before, ctx.day);
    const fields = orderFront(k, front);
    save(db, e, fields);
    writeLine(db, ctx, { verb: 'reopen', kind: 'workstream', front: fields, changes: changesOf(before, fields) });
    return { id: fields.id, kind: 'workstream', name: fields.name, status: 'open' };
  });
}

/* ---- note: the only journal write path, for every kind that has one ---- */

/* `input` is { id, text, name?, description?, intent?, goal? }. A workstream with no Journal gets
   one with its first note. A new title, description or intent (a task) or goal (a track) is an
   amend: the text replaced in place, the old kept in the history with the note as its why. */
export function noteRecord(db, input = {}, actor) {
  const ctx = actorOf(actor);
  const body = String(input.text ?? '').trim();
  if (!body) throw new UsageError('note needs its body text on stdin');
  const rewrite = {};
  for (const key of ['name', 'description', 'intent', 'goal']) {
    if (input[key] === undefined || input[key] === null) continue;
    if (typeof input[key] !== 'string' || !input[key].trim()) throw new UsageError('--' + key + ' needs text');
    rewrite[key] = input[key].replace(/\r\n/g, '\n').trim();
  }
  return tx(db, () => {
    const raw = String(input.id ?? '').trim();
    const e = resolveRecord(db, raw, { day: ctx.day });
    if (!e || e.kind === 'profile' || e.kind === 'handoff') throw new UsageError('unknown record id: ' + raw);
    /* a question's notes rows hold its answer text */
    if (e.kind === 'question') throw new UsageError(raw + ' is a question, whose notes hold its answer; note takes WS-n, T-n, TR-n or K-n. '
      + 'A remark about ' + raw + ' goes on the decision that answers it (note K-n) or the task it gates (note T-n)');
    const named = Object.keys(rewrite);
    const fits = (TEXT_FIELDS[e.kind] || []).map(([f]) => f).concat(e.kind === 'task' ? ['name'] : []);
    const stray = named.filter((f) => !fits.includes(f));
    if (stray.length) throw new UsageError('a note rewrites a task\'s title, description and intent, or a track\'s goal; ' + raw + ' takes no ' + stray.join(', '));
    const text = guardHeadings(body);
    const { fields, moved } = journalWrite(db, e, text, body, rewrite, named, ctx);
    const routed = routeNote(db, fields.id, text, ctx);
    const out = { id: fields.id, kind: e.kind, name: fields.name, note: ctx.at + ': ' + text, ...routed };
    if (moved.length) return { ...out, amended: moved.map((m) => m.field) };
    /* the text a note that names a scope change may rewrite, so the caller can offer it prefilled */
    const lead = (TEXT_FIELDS[e.kind] || [])[0];
    return lead ? { ...out, current: { field: lead[0], text: shownSectionsOf(e.body)[lead[1]] ?? '' } } : out;
  });
}

/* A handoff's goal through a note's amend, the note its why; the old text when it changed, else null. */
export function restateGoal(db, e, goal, why, ctx) {
  const next = String(goal).replace(/\r\n/g, '\n').trim();
  if (!movedTexts(e, { goal: next }).moved.length) return null;
  return journalWrite(db, e, guardHeadings(why), why, { goal: next }, ['goal'], ctx).moved[0].old;
}

/* The note itself, with its amend, inside the caller's transaction. */
function journalWrite(db, e, text, why, rewrite, named, ctx) {
  const { body: amended, moved } = named.length ? movedTexts(e, rewrite) : { body: e.body, moved: [] };
  addNote(db, e.key, { at: ctx.at, actor: ctx.by, body: text });
  const k = WORK_KINDS[e.kind];
  const front = k ? normalize(k, { ...e.front }) : { ...e.front };
  if (moved.some((m) => m.field === 'goal')) front.goal = rewrite.goal;
  if (rewrite.name !== undefined && rewrite.name !== front.name) {
    moved.unshift({ field: 'name', old: front.name ?? '', next: rewrite.name });
    front.name = rewrite.name;
  }
  front.updated = ctx.at;
  const fields = k ? orderFront(k, front) : front;
  const journalless = e.layout && e.layout.journal === false;
  putRecord(db, {
    key: e.key, kind: e.kind, slug: e.slug, fields, track: e.track,
    body: journalless ? String(amended).replace(/\n*$/, '\n') + '\n' : amended, layout: journalless ? null : e.layout,
  });
  let changes = {};
  if (moved.length) {
    const ids = moved.map((m) => addHistory(db, ctx, { key: e.key, field: m.field, old: m.old, next: m.next, why }));
    changes = { ...Object.fromEntries(moved.map((m) => [m.field, 'amended'])), history: historyRef(ids) };
  }
  writeLine(db, ctx, { verb: 'note', kind: e.kind, front: fields, changes, note: why });
  return { fields, moved };
}

/* A closed task's note is no home: a sentence that hands work to another task ("left for
   T-n") is copied onto it, led by where it came from; a closed or unknown one gets no copy. */
function routeNote(db, from, text, ctx) {
  const copied = [];
  const notCopied = [];
  for (const { ids, sentence } of routedTo(text)) {
    for (const id of ids) {
      if (id === from || copied.includes(id) || notCopied.some((n) => n.id === id)) continue;
      const e = resolveRecord(db, id, { day: ctx.day, kinds: ['task'] });
      if (!e) { notCopied.push({ id, why: 'no such task' }); continue; }
      if (TERMINAL.task.includes(e.front.status)) { notCopied.push({ id, why: id + ' is ' + e.front.status + ', so nothing brings the work back from there' }); continue; }
      const copy = guardHeadings(copiedFrom(from, sentence));
      journalWrite(db, e, copy, copy, {}, [], ctx);
      copied.push(id);
    }
  }
  return { copied, ...(notCopied.length ? { notCopied } : {}) };
}

/* ---- knowledge: a fact, not work ---- */

const KNOWLEDGE_KEYS = ['type', 'title', 'body', 'global', 'projects', 'projectRepos', 'labels', 'refs', 'legacy', 'created', 'source', 'session',
  'workstreams', 'tracks', 'tasks', 'files', 'commands', 'words', 'question'];

function normProject(v) {
  if (typeof v !== 'string' || !v.trim()) throw new UsageError('a project is a directory path');
  const dir = v.trim().replace(/\\/g, '/').replace(/(.)\/+$/, '$1');
  if (/^[A-Za-z]:\//.test(dir) || dir.startsWith('/')) return projectName(dir);
  throw new UsageError('a project is an absolute directory: ' + v);
}


/* A knowledge record's file links are repo-relative globs, as a procedure card's are; a
   leading (read), (search) or (edit read search) names the calls that point (lib/decision-match.mjs). */
const OCCASIONS = ['edit', 'read', 'search'];
function globList(raw) {
  return strList(raw, 'files').map((g) => {
    const m = /^\s*\(([^)]*)\)\s*(.*)$/.exec(g);
    const on = m ? m[1].toLowerCase().split(/[\s,]+/).filter(Boolean) : [];
    if (m && (!on.length || on.some((w) => !OCCASIONS.includes(w)))) throw new UsageError('a file link\'s marker names edit, read or search: ' + g);
    const s = (m ? m[2] : g).replace(/\\/g, '/').replace(/^(\.\/)+/, '');
    if (!s.trim()) throw new UsageError('a file link names a glob: ' + g);
    if (/^([A-Za-z]:)?\//.test(s)) throw new UsageError('files are globs relative to the repo root, not absolute: ' + g);
    return m ? '(' + OCCASIONS.filter((w) => on.includes(w)).join(' ') + ') ' + s : s;
  });
}

/* `inherit` is the superseded record: its type and scope stand unless named;
   its links never carry over. */
export function knowledgePayload(raw, inherit) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new UsageError('knowledge payload must be an object');
  for (const key of Object.keys(raw)) if (!KNOWLEDGE_KEYS.includes(key)) throw new UsageError('knowledge does not take ' + key);
  const p = {};
  p.type = raw.type === undefined && inherit ? inherit.type : raw.type;
  if (!KNOWLEDGE_TYPES.includes(p.type)) throw new UsageError('--type must be one of ' + KNOWLEDGE_TYPES.join(', '));
  if (typeof raw.title !== 'string' || !raw.title.trim()) throw new UsageError('knowledge needs a non-empty --title');
  p.title = raw.title.replace(/\s*\r?\n\s*/g, ' ').trim();
  if (raw.body !== undefined && typeof raw.body !== 'string') throw new UsageError('body must be text');
  p.body = String(raw.body ?? '').replace(/\r\n/g, '\n').trim();
  /* the shared names the PC sends, else a folder named by its path */
  const repos = strList(raw.projectRepos, 'projectRepos');
  const projects = repos.length ? repos : [...new Set(strList(raw.projects, 'projects').map(normProject))];
  if (raw.global === true && projects.length) throw new UsageError('pick one of --global and --project');
  if (raw.global === true) { p.scope = 'global'; p.projectRepos = []; }
  else if (projects.length) { p.scope = 'project'; p.projectRepos = projects; }
  else if (inherit) { p.scope = inherit.scope; p.projectRepos = [...new Set(listOf(inherit, 'projectRepos').concat(listOf(inherit, 'projects').map(projectName)))]; }
  else throw new UsageError('knowledge needs --project <dir> or --global');
  p.labels = strList(raw.labels, 'labels');
  p.refs = strList(raw.refs, 'refs');
  for (const key of ['workstreams', 'tracks', 'tasks', 'commands']) p[key] = strList(raw[key], key);
  p.files = globList(raw.files);
  if (raw.words !== undefined) {
    if (typeof raw.words !== 'string') throw new UsageError('words must be text: the user\'s words, quoted');
    p.words = raw.words.replace(/\s+/g, ' ').trim() || undefined;
  }
  if (raw.question !== undefined) {
    if (typeof raw.question !== 'string' || !raw.question.trim()) throw new UsageError('question takes the Q-n the ruling answers');
    p.question = raw.question.trim();
  }
  if (raw.legacy !== undefined) {
    if (typeof raw.legacy !== 'string' || !LEGACY_KNOWLEDGE_RE.test(raw.legacy.trim())) {
      throw new UsageError('--legacy takes <slug>:<G-or-D id>, for example tidewatch:G-0001');
    }
    p.legacy = raw.legacy.trim();
  }
  if (raw.created !== undefined) {
    if (typeof raw.created !== 'string' || !/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2})?$/.test(raw.created)) {
      throw new UsageError('--created must be YYYY-MM-DD or a full local timestamp');
    }
    p.created = raw.created;
  }
  if (raw.source !== undefined) {
    const s = raw.source;
    if (!s || typeof s !== 'object' || Array.isArray(s)) throw new UsageError('source must be an object');
    for (const key of Object.keys(s)) {
      if (!['session', 'commit'].includes(key)) throw new UsageError('source takes session and commit only');
      if (s[key] !== null && s[key] !== undefined && typeof s[key] !== 'string') throw new UsageError('source.' + key + ' must be text');
    }
    p.source = { session: s.session || undefined, commit: s.commit || undefined };
  }
  if (raw.session !== undefined) {
    if (typeof raw.session !== 'string' || !raw.session.trim()) throw new UsageError('--session needs a non-empty value');
    if (!p.source) p.source = { session: raw.session.trim() };
  }
  return p;
}

export function mintKnowledge(db, p, ctx) {
  if (p.legacy) {
    const held = db.stmt("SELECT label FROM records WHERE kind = 'knowledge' AND json_extract(fields, '$.legacy') = ?").get(p.legacy);
    if (held) throw new UsageError(p.legacy + ' is already ' + held.label);
  }
  /* a link names a record that exists, stored as its key; an empty one is left out, so old fronts read unchanged */
  const links = (list, kind) => {
    const keys = [...new Set((list || []).map((t) => refTo(db, t, kind, ctx.day)))];
    return keys.length ? keys : undefined;
  };
  const key = mintKey(db);
  const id = pickLabel(db, 'knowledge', ctx.day);
  const fields = orderFront(WORK_KINDS.knowledge, {
    id, key, name: p.title, type: p.type, status: 'active', scope: p.scope, projectRepos: p.projectRepos,
    labels: p.labels, refs: refsFor(db, p.refs, ctx.day),
    workstreams: links(p.workstreams, 'workstream'), tracks: links(p.tracks, 'track'), tasks: links(p.tasks, 'task'),
    question: p.question ? refTo(db, p.question, 'question', ctx.day) : undefined, words: p.words,
    files: p.files && p.files.length ? p.files : undefined, commands: p.commands && p.commands.length ? p.commands : undefined,
    legacy: p.legacy, source: p.source,
    created: p.created || ctx.at, updated: ctx.at, labelHistory: [historyItem({ label: id, from: ctx.day })],
  });
  putRecord(db, { key, kind: 'knowledge', slug: kebab(p.title, 'knowledge'), fields, body: workBody('knowledge', { description: p.title, body: p.body }) });
  return { fields, line: { verb: 'create', kind: 'knowledge', front: fields, changes: changesOf({}, fields) } };
}

export function createKnowledge(db, input = {}, actor) {
  const p = knowledgePayload(input);
  const ctx = actorOf(actor);
  return tx(db, () => {
    /* as decide fills it, a record naming no workstream or track takes the one the session's track is in */
    if (p.scope === 'project' && !p.workstreams.length && !p.tracks.length) {
      const lease = ctx.session ? db.stmt('SELECT track FROM leases WHERE session = ?').get(ctx.session) : null;
      const t = lease ? loadEntry(db, lease.track) : null;
      const ws = t && t.front.workstream ? resolveRecord(db, t.front.workstream, { kinds: ['workstream'], day: ctx.day }) : null;
      /* never another project's workstream: a track held elsewhere says nothing of where this fact belongs */
      const repos = ws ? [...listOf(ws.front, 'projectRepos'), ...listOf(ws.front, 'projects').map(projectName)] : [];
      if (ws && (!repos.length || repos.some((r) => p.projectRepos.includes(r)))) {
        p.workstreams = [ws.key];
        if (ws.label && !p.labels.includes(ws.label)) p.labels.push(ws.label);
      }
    }
    const m = mintKnowledge(db, p, ctx);
    writeLine(db, ctx, m.line);
    return { id: m.fields.id, key: m.fields.key, kind: 'knowledge', name: m.fields.name, legacy: m.fields.legacy || '' };
  });
}

/* `input` is { id, by } to link an existing record as the replacement, or { id,
   ...payload } to mint it; the superseded record keeps its type and scope by default. */
export function supersedeKnowledge(db, input = {}, actor) {
  const ctx = actorOf(actor);
  const { id: oldId, version, by: byRaw, ...payload } = input || {};
  const raw = String(oldId ?? '').trim();
  if (!isKey(raw) && !/^k-\d+$/i.test(raw)) throw new UsageError('expected a knowledge id (K-n): ' + oldId);
  if (byRaw !== undefined) {
    const rest = Object.keys(payload).filter((k) => k !== 'session' && payload[k] !== undefined);
    if (rest.length) throw new UsageError('--by links an existing record; it takes no ' + rest.join(', '));
  }
  return tx(db, () => {
    const old = resolveRecord(db, raw, { kinds: ['knowledge'], day: ctx.day });
    if (!old) throw new UsageError('unknown knowledge id: ' + raw);
    checkVersion(old, { version });
    const front = normalize(WORK_KINDS.knowledge, { ...old.front });
    if (front.status === 'superseded') {
      throw new UsageError(front.id + ' is already superseded' + (front.supersededBy ? ' by ' + labelOf(db, front.supersededBy) : ''));
    }
    const lines = [];
    let created = null;
    let byKey;
    let byLabel;
    if (byRaw !== undefined) {
      const linked = resolveRecord(db, String(byRaw).trim(), { kinds: ['knowledge'], day: ctx.day });
      if (!linked) throw new UsageError('unknown knowledge id: ' + String(byRaw).trim());
      if (linked.key === old.key) throw new UsageError(front.id + ' cannot supersede itself');
      byKey = linked.key;
      byLabel = linked.label;
    } else {
      const m = mintKnowledge(db, knowledgePayload(payload, front), ctx);
      created = { id: m.fields.id, name: m.fields.name };
      byKey = m.fields.key;
      byLabel = m.fields.id;
      lines.push(m.line);
    }
    const s = markSuperseded(db, old, byKey, ctx);
    lines.push(s.line);
    for (const l of lines) writeLine(db, ctx, l);
    return { id: s.fields.id, kind: 'knowledge', name: s.fields.name, supersededBy: byLabel, created };
  });
}

/* The old record superseded by `byKey`, saved; the caller writes its line after the create's. */
export function markSuperseded(db, old, byKey, ctx) {
  const front = normalize(WORK_KINDS.knowledge, { ...old.front });
  if (front.status === 'superseded') {
    throw new UsageError(front.id + ' is already superseded' + (front.supersededBy ? ' by ' + labelOf(db, front.supersededBy) : ''));
  }
  if (front.status === 'withdrawn') throw new UsageError(front.id + ' is withdrawn: ' + withdrawnWhy(front) + ', so nothing supersedes it');
  if (front.status === 'retired') throw new UsageError(front.id + ' is retired: knowledge reinstate ' + front.id + ' first, or leave it ended');
  const before = snap(front);
  front.status = 'superseded';
  front.supersededBy = byKey;
  front.updated = ctx.at;
  front.closed = ctx.at;
  const fields = orderFront(WORK_KINDS.knowledge, front);
  save(db, old, fields);
  return { fields, line: { verb: 'edit', kind: 'knowledge', front: fields, changes: changesOf(before, fields) } };
}

/* ---- amend and edit in place ---- */

function knowledgeTarget(db, id, day, verb) {
  const raw = String(id ?? '').trim();
  if (!raw) throw new UsageError('knowledge ' + verb + ' needs a K-n id');
  const e = resolveRecord(db, raw, { kinds: ['knowledge'], day });
  if (!e) throw new UsageError('unknown knowledge id: ' + raw);
  return e;
}

function liveKnowledge(db, front, verb) {
  if (front.status === 'withdrawn') throw new UsageError(front.id + ' is withdrawn: ' + withdrawnWhy(front));
  if (front.status === 'retired') throw new UsageError(front.id + ' is retired: knowledge reinstate ' + front.id + ' --reason first, then ' + verb + ' it');
  if (front.status !== 'superseded') return;
  throw new UsageError(front.id + ' is superseded' + (front.supersededBy ? ' by ' + labelOf(db, front.supersededBy) + '; ' + verb + ' that one' : ''));
}

/* knowledge amend: a dated paragraph appended to the body, the number kept, the
   old text in the history; nothing is lost, so a used record takes one too. */
export function amendKnowledge(db, input = {}, actor) {
  const ctx = actorOf(actor);
  const text = String(input.body ?? input.text ?? '').replace(/\r\n/g, '\n').trim();
  if (!text) throw new UsageError('knowledge amend needs --body: what it adds, in words');
  return tx(db, () => {
    const e = knowledgeTarget(db, input.id, ctx.day, 'amend');
    checkVersion(e, input);
    const front = normalize(WORK_KINDS.knowledge, { ...e.front });
    liveKnowledge(db, front, 'amend');
    const before = snap(front);
    const old = sectionsOf(e.body).Body ?? '';
    const para = 'Amended ' + ctx.day + ' by ' + whoOf(db, ctx, input) + ': ' + guardHeadings(text);
    const body = withSection(e.body, 'Body', old ? old + '\n\n' + para : para);
    front.amended = ctx.at;
    front.updated = ctx.at;
    const fields = orderFront(WORK_KINDS.knowledge, front);
    save(db, e, fields, body);
    const h = addHistory(db, ctx, { key: e.key, field: 'body', old, next: sectionsOf(body).Body ?? '', why: 'amended' });
    writeLine(db, ctx, { verb: 'edit', kind: 'knowledge', front: fields, changes: { ...changesOf(before, fields), body: 'amended', history: historyRef([h]) } });
    return { id: fields.id, kind: 'knowledge', name: fields.name, amended: fields.amended, history: h, version: e.version + 1 };
  });
}

/* a Body rewritten whole keeps the amended stamp only while it keeps an amendment paragraph */
export const keepsAmendment = (body) => /^Amended \d{4}-\d{2}-\d{2} by /m.test(String(body ?? ''));

/* The stamp a rewritten Body keeps: the time of the newest amend that left exactly this
   text (a later amend undone), else the stamp it had, or none once no amendment stays. */
export function amendedStampFor(db, key, text, stamp) {
  if (!stamp || !keepsAmendment(text)) return null;
  const row = db.stmt("SELECT at FROM history WHERE record = ? AND field = 'body' AND why = 'amended' AND new = ? ORDER BY id DESC LIMIT 1").get(key, String(text));
  return row ? row.at : stamp;
}

/* knowledge edit: name and body rewritten in place only while no other session
   has used the record; the old text goes to the history either way. Its refs, projects
   and files change at any time: they alter no text a reader relied on. */
export function editKnowledge(db, input = {}, actor) {
  const ctx = actorOf(actor);
  const name = input.name === undefined ? undefined : String(input.name).replace(/\s*\r?\n\s*/g, ' ').trim();
  if (name !== undefined && !name) throw new UsageError('--name needs a non-empty value');
  const text = input.body === undefined ? undefined : guardHeadings(String(input.body).replace(/\r\n/g, '\n').trim());
  const lists = ['addRef', 'removeRef', 'addProject', 'removeProject', 'addFile', 'removeFile', 'addCommand', 'removeCommand'].filter((k) => input[k] && [].concat(input[k]).length);
  const confirming = input.confirmed === true;
  if (name === undefined && text === undefined && !lists.length && !confirming) throw new UsageError('knowledge edit needs --name, --body, --confirmed or a ref, project, file or command to add or remove');
  return tx(db, () => {
    const e = knowledgeTarget(db, input.id, ctx.day, 'edit');
    /* the user confirmed a ruling's title as worded, so it is carried by title and K-n */
    if (confirming && e.front.type !== 'decision') throw new UsageError(e.front.id + ' is a ' + (e.front.type || 'knowledge') + ' record: only a decision is confirmed');
    checkVersion(e, input);
    const front = normalize(WORK_KINDS.knowledge, { ...e.front });
    liveKnowledge(db, front, 'edit');
    const before = snap(front);
    const secs = sectionsOf(e.body);
    const moved = [];
    let body = e.body;
    if (name !== undefined && name !== front.name) {
      moved.push({ field: 'name', old: front.name, next: name });
      /* the Description carries the title when the record was made from one */
      if ((secs.Description ?? '') === front.name) body = withSection(body, 'Description', name);
      front.name = name;
    }
    if (text !== undefined && text !== (secs.Body ?? '')) {
      moved.push({ field: 'body', old: secs.Body ?? '', next: text });
      body = withSection(body, 'Body', text);
      const stamp = amendedStampFor(db, e.key, text, front.amended);
      if (stamp) front.amended = stamp; else delete front.amended;
    }
    if (moved.length) {
      const why = usedBy(db, e);
      if (why) throw new UsageError(inUseRefusal(front.id, why));
    }
    const listed = lists.length ? applyEdit(WORK_KINDS.knowledge, front, {
      addRef: input.addRef && refsFor(db, [].concat(input.addRef), ctx.day),
      removeRef: input.removeRef && [].concat(input.removeRef).concat(refsFor(db, [].concat(input.removeRef), ctx.day)),
      addProject: input.addProject && [].concat(input.addProject), removeProject: input.removeProject && [].concat(input.removeProject),
      addFile: input.addFile && globList([].concat(input.addFile)), removeFile: input.removeFile && globList([].concat(input.removeFile)),
      addCommand: input.addCommand && strList([].concat(input.addCommand), 'addCommand'), removeCommand: input.removeCommand && [].concat(input.removeCommand).map((s) => String(s).trim()),
    }) : [];
    const confirmedNow = confirming && front.confirmed !== true;
    if (confirmedNow) front.confirmed = true;
    if (!moved.length && !listed.length && !confirmedNow) return { id: front.id, kind: 'knowledge', name: front.name, changed: [], version: e.version };
    front.updated = ctx.at;
    const fields = orderFront(WORK_KINDS.knowledge, front);
    save(db, e, fields, body);
    const ids = moved.map((m) => addHistory(db, ctx, { key: e.key, field: m.field, old: m.old, next: m.next, why: 'edited in place' }));
    const changes = { ...changesOf(before, fields), ...Object.fromEntries(moved.map((m) => [m.field, 'edited'])), history: historyRef(ids) };
    writeLine(db, ctx, { verb: 'edit', kind: 'knowledge', front: fields, changes });
    return { id: fields.id, kind: 'knowledge', name: fields.name, changed: [...moved.map((m) => m.field), ...listed, ...(confirmedNow ? ['confirmed'] : [])], history: ids, version: e.version + 1 };
  });
}

/* ---- the plain retire and its return ---- */

/* A fact that stops being true ends with a reason and no replacement, and comes back by
   reinstate; nothing is lost either way, so a session needs no press (the rule holds). */
function retireOrBack(db, input, actor, verb) {
  const ctx = actorOf(actor);
  const reason = String(input.reason ?? '').replace(/\s+/g, ' ').trim();
  if (!reason) throw new UsageError('knowledge ' + verb + ' needs --reason: ' + (verb === 'retire' ? 'why the record stopped being true' : 'why it holds again'));
  return tx(db, () => {
    const e = knowledgeTarget(db, input.id, ctx.day, verb);
    checkVersion(e, input);
    const front = normalize(WORK_KINDS.knowledge, { ...e.front });
    if (front.type === 'decision') {
      throw new UsageError(front.id + ' is a ruling: it changes only by supersede (a decide whose supersedes names ' + front.id + ') or the user\'s withdraw (override request --kind withdraw)');
    }
    const from = verb === 'retire' ? 'active' : 'retired';
    if (front.status !== from) {
      throw new UsageError(front.id + ' is ' + front.status + (front.status === 'withdrawn' ? ': ' + withdrawnWhy(front) : '')
        + (verb === 'retire' ? ': only an active record retires' : ': only a retired record is reinstated'));
    }
    const before = snap(front);
    front.status = verb === 'retire' ? 'retired' : 'active';
    /* stamps closed; back after its archive day, it takes a fresh label */
    endingStamps(db, 'knowledge', front, before, ctx);
    front.updated = ctx.at;
    const fields = orderFront(WORK_KINDS.knowledge, front);
    save(db, e, fields);
    const why = (verb === 'retire' ? 'retired: ' : 'reinstated: ') + reason;
    const h = addHistory(db, ctx, { key: e.key, field: 'status', old: before.status, next: front.status, why });
    writeLine(db, ctx, { verb: 'edit', kind: 'knowledge', front: fields, changes: { ...changesOf(before, fields), history: historyRef([h]) }, note: why });
    return { id: fields.id, kind: 'knowledge', name: fields.name, status: fields.status, ...(fields.id !== before.id ? { was: before.id } : {}), history: h, version: e.version + 1 };
  });
}

export const retireKnowledge = (db, input = {}, actor) => retireOrBack(db, input, actor, 'retire');
export const reinstateKnowledge = (db, input = {}, actor) => retireOrBack(db, input, actor, 'reinstate');

/* ---- reads ---- */

/* A record as a verb hands it out: references shown as labels, its sections and
   journal. `input` is an id, or { id, session } when a session reads it. */
export function readRecord(db, input, actor) {
  const o = input && typeof input === 'object' ? input : { id: input };
  const raw = String(o.id ?? '').trim();
  const e = resolveRecord(db, raw);
  if (!e || e.kind === 'profile' || e.kind === 'handoff' || e.kind === 'question') throw new UsageError('unknown record id: ' + raw);
  const reader = (typeof o.session === 'string' && o.session.trim()) || (actor && typeof actor === 'object' ? actor.session : null);
  if (reader) noteRead(db, e, reader, 'show', actorOf(actor).at);
  const k = WORK_KINDS[e.kind];
  const sections = shownSectionsOf(e.body);
  const journal = journalOf(db, e.key);
  if (!(e.layout && e.layout.journal === false) || journal) sections.Journal = journal;
  const front = shownFront(db, k ? normalize(k, { ...e.front }) : e.front);
  const out = {
    ...(e.kind === 'task' ? withWorkers(front, shownWorkers(db, [e.key], clockOf(actor).getTime()).get(e.key)) : front), kind: e.kind, description: sections.Description ?? '',
    journal, sections, version: e.version,
  };
  if (e.kind === 'task') {
    out.intent = sections.Intent ?? '';
    out.checklist = itemsOf(db, e.key);
  }
  return out;
}

const terminalOf = (kind) => TERMINAL[kind] || LABEL_KINDS[kind]?.ended || [];

/* Open work by default; `all` or a named status brings the rest. Tasks order by
   ordinal then label inside the listed scope. A knowledge record carries no
   workstream: `workstream` and `projectRepo` read its project, and `body`
   adds its text to the row. */
export function listWork(db, filters = {}, actor, opts) {
  const kind = String(filters.kind ?? '');
  const k = WORK_KINDS[kind];
  if (!k) throw new UsageError(refusal[kind] || 'list takes --kind workstream, task or knowledge: ' + kind);
  if (filters.workstream !== undefined && kind === 'workstream') {
    throw new UsageError('a workstream never references a workstream; --workstream filters tasks and questions');
  }
  if (filters.projectRepo !== undefined && kind !== 'knowledge') throw new UsageError('--project lists questions and knowledge only');
  if (filters.priority !== undefined && kind !== 'task') throw new UsageError('a ' + kind + ' carries no priority');
  if (filters.priority !== undefined && !PRIORITIES.includes(filters.priority)) throw new UsageError('--priority must be one of ' + PRIORITIES.join(', '));
  if (kind === 'task' && filters.status === IN_PROGRESS) {
    throw new UsageError('--status names a stored status (' + k.statuses.join(', ') + '); in progress is read from an open run:'
      + ' list --open shows each task with the word, and a track\'s now set (track show) lists its running ones');
  }
  if (filters.status !== undefined && !k.statuses.includes(filters.status)) {
    throw new UsageError('--status for a ' + kind + ' must be one of ' + k.statuses.join(', '));
  }
  if (filters.open && filters.status !== undefined) throw new UsageError('--open and --status name different sets; pick one');
  let ws, inWs;
  if (filters.workstream !== undefined) {
    const e = resolveRecord(db, filters.workstream);
    ws = e ? e.key : String(filters.workstream);
    inWs = kind === 'knowledge' ? (f) => Boolean(e) && e.kind === 'workstream' && knowledgeInWs(f, e.front) : (f) => f.workstream === ws;
  }
  const ended = terminalOf(kind);
  const memo = new Map();
  const rows = [];
  const keys = [];
  for (const r of db.stmt('SELECT key, fields, body FROM records WHERE kind = ? ORDER BY id').all(kind)) {
    const f = normalize(k, JSON.parse(r.fields));
    if (filters.status !== undefined) { if (f.status !== filters.status) continue; }
    else if (!filters.all && ended.includes(f.status)) continue;
    if (inWs && !inWs(f)) continue;
    if (filters.projectRepo !== undefined && !knowledgeInProject(f, filters.projectRepo)) continue;
    if (filters.priority !== undefined && f.priority !== filters.priority) continue;
    if (filters.label !== undefined && !listOf(f, 'labels').includes(filters.label)) continue;
    const s = shownSectionsOf(r.body);
    rows.push({ ...shownFront(db, f, memo), kind, description: s.Description ?? '', ...(kind === 'knowledge' && filters.body ? { body: s.Body ?? '' } : {}) });
    keys.push(r.key);
  }
  if (kind === 'task') {
    const who = shownWorkers(db, keys, clockOf(actor, opts).getTime());
    for (let i = 0; i < rows.length; i++) rows[i] = withWorkers(rows[i], who.get(keys[i]));
  }
  const num = (r) => Number(String(r.id).split('-')[1]);
  rows.sort((a, b) => (kind === 'task' ? (a.ordinal ?? DEFAULT_ORDINAL) - (b.ordinal ?? DEFAULT_ORDINAL) : 0) || num(a) - num(b));
  return rows;
}

/* Every task a session has in hand, newest taken first (list --json's inHand, the status line). */
export function heldTask(db, input = {}) {
  const s = String(input.session ?? '').trim();
  const memo = new Map();
  if (!s) return [];
  return db.stmt(HAND).all(s).map(({ key, since }) => {
    const f = shownFront(db, loadEntry(db, key).front, memo);
    return { id: f.id, name: f.name, status: f.status, workstream: f.workstream || '', since: since || null };
  });
}

/* The still-undecided questions that gate a task, through the links index. */
export function waitsOn(db, id) {
  const hit = resolveRecord(db, id, { kinds: ['task'] });
  const want = hit ? hit.key : String(id).toUpperCase();
  return db.stmt(`SELECT r.label AS id, r.title AS name, r.status, json_extract(r.fields, '$.blocking') AS blocking
    FROM links l JOIN records r ON r.key = l."from" WHERE l.type = 'gates' AND l."to" = ? AND r.kind = 'question'
    AND r.status IN ('open', 'snoozed')`).all(want)
    .map((r) => ({ id: r.id, name: r.name, status: r.status, blocking: r.blocking === 1 }))
    .sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
}

