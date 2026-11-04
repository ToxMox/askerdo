/* The work verbs over SQLite: tasks, workstreams (with outcomes
   and `serves`), notes and knowledge. A write is `verb(db, input, actor)` in one
   transaction with its activity rows; a read is `verb(db, input)`. Tracks replace
   plans, steps and threads, and subscriptions are derived, never written. */
import { tx } from '../db.mjs';
import {
  KEY_ORDERS, QUIET_LISTS, actorOf, addNote, changesOf, guardHeadings, isKey, kebab, labelOf, logRow, mintKey, pcOfCall, putRecord, sessionWords,
} from '../records.mjs';
import {
  UsageError, LABEL_KINDS, endingStamps, historyItem, loadEntry, pickLabel, refsFor, relabelIfArchived, resolveRecord, shownFront, strList,
} from './labels.mjs';
import { wakeLinked } from './questions.mjs';
import { readiness, sideOf, startTask } from './graph.mjs';
import { decisionsFor } from './decisions.mjs';
import { addHistory, historyRef, inUseRefusal, noteRead, usedBy } from './history.mjs';
import { closeChanges, editClose, followHand } from './upkeep.mjs';
import { RUN_BY_HINT, runByOf } from '../handoff-text.mjs';
import { holderWords } from '../web/feed.mjs';
import { openTrack, placeCreated, placeTask } from './tracks.mjs';
import { placeRefusal, suggestTrack } from './found.mjs';
import { afterTask, reviewScopeOf } from './coverage.mjs';
import { isReview } from './found.mjs';

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
    maps: [], statuses: ['open', 'in_progress', 'blocked', 'deferred', 'dropped', 'completed'],
  },
  knowledge: {
    kind: 'knowledge', verb: 'knowledge',
    keys: KEY_ORDERS.knowledge,
    arrays: ['projects', 'projectRepos', 'labels', 'refs', 'workstreams', 'tracks', 'tasks', 'files', 'commands', 'labelHistory'],
    maps: ['source'], statuses: ['active', 'superseded', 'withdrawn'],
  },
});

const TERMINAL = { workstream: ['closed'], task: ['dropped', 'completed'], knowledge: ['superseded', 'withdrawn'] };
const PRIORITIES = ['high', 'medium', 'low'];
/* imported tasks carry an ordinal; a new one sorts on today's default rung */
const DEFAULT_ORDINAL = 1000;
export const KNOWLEDGE_TYPES = Object.freeze(['gotcha', 'decision']);
const LEGACY_KNOWLEDGE_RE = /^[a-z0-9][a-z0-9-]*:[GD]-\d{4}$/;

const refusal = {
  plan: 'a plan has no verbs on the board: its steps are tasks on a track',
  thread: 'a thread has no verbs on the board: it is a track now',
  knowledge: 'a knowledge record has its own verbs: knowledge edit (while no other session has used it), knowledge amend or knowledge supersede',
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
    .map((n) => (n.at ? n.at + ': ' : '') + n.body).join('\n\n');
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
  p.status = raw.status === undefined ? 'open' : String(raw.status);
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
    /* a review reads its track (the default, stored as no key) or the whole project */
    if (raw.reviewScope !== undefined && reviewScopeOf(raw.reviewScope) === 'project') {
      if (!isReview(p)) throw new UsageError('only a review task has a review scope: label it review, or name it "Review ..."');
      p.reviewScope = 'project';
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
  const { kind: _k, track: trackRef, before, after, unplaced, ...raw } = input || {};
  if (trackRef !== undefined && (kind !== 'task' || typeof trackRef !== 'string' || !trackRef.trim())) {
    throw new UsageError('track names a TR-n id, and only a task goes on one');
  }
  /* unplaced is the reason a task waits on no track, which the found list shows */
  if (unplaced !== undefined && (kind !== 'task' || typeof unplaced !== 'string' || !unplaced.trim())) {
    throw new UsageError('unplaced is the reason a task waits on no track, a line of text');
  }
  if (unplaced !== undefined && trackRef !== undefined) throw new UsageError('a task goes on a track or stays unplaced, not both');
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
        origin: p.origin, serves: p.serves, reviewScope: p.reviewScope, labelHistory, unplaced: unplaced === undefined ? undefined : unplaced.replace(/\s+/g, ' ').trim(),
      };
    const fields = orderFront(WORK_KINDS[kind], front);
    putRecord(db, { key, kind, slug: kebab(p.name, kind), fields, body: workBody(kind, p) });
    /* a caller that makes records on its own (the board picture) names its cause */
    const note = typeof raw.note === 'string' && raw.note.trim() ? raw.note.trim() : undefined;
    writeLine(db, ctx, { verb: 'create', kind, front: fields, changes: changesOf({}, fields), note });
    if (line) placeCreated(db, key, line, ctx);
    if (line && (before !== undefined || after !== undefined)) placeTask(db, key, { before, after }, actor);
    /* created done, it runs the shared check as a completion would */
    if (kind === 'task' && fields.status === 'completed') afterTask(db, key, { completed: true }, actor);
    const warnings = ws && !p.serves.length && Object.keys(outcomeMap(ws)).length
      ? [id + ' serves none of ' + ws.id + "'s outcomes (" + outcomesText(ws) + '): name one with task edit ' + id
        + ' --serves ' + Object.keys(outcomeMap(ws))[0]] : [];
    return { id, key, kind, name: p.name, ...(line ? { track: line.fields.id } : {}), ...(fields.unplaced ? { unplaced: fields.unplaced } : {}),
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
  const said = (v) => typeof v === 'string' && v.trim();
  const ws = said(input.workstream) ? resolveRecord(db, input.workstream.trim(), { day: c.day }) : null;
  const hint = suggestTrack(db, { ...input, workstream: ws && ws.kind === 'workstream' ? ws.key : null }, c.session);
  if (c.session && !said(input.track) && !said(input.unplaced)) throw new UsageError(placeRefusal(hint));
  const r = createRecord(db, input, actor);
  return hint && hint.track !== r.track ? { ...r, suggested: hint } : r;
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
  if (c.handoff !== undefined) setScalar('handoff', c.handoff);
  if (c.clearRunBy) { if (front.runBy) { delete front.runBy; changed.push('runBy'); } } else if (c.runBy !== undefined) setScalar('runBy', c.runBy);
  if (c.reviewScope === 'track') { if (front.reviewScope) { delete front.reviewScope; changed.push('reviewScope'); } } else if (c.reviewScope !== undefined) setScalar('reviewScope', c.reviewScope);
  /* --add-project and --remove-project edit the shared names */
  const names = (l) => l && l.map(projectName);
  for (const [key, add, remove] of [['labels', c.addLabel, c.removeLabel], ['refs', c.addRef, c.removeRef], ['projectRepos', names(c.addProject), names(c.removeProject)]]) {
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

/* a session holds several tasks in hand, each stamped when
   taken so the newest is known. One another session holds moves only by a
   take-over, which that session hears from the row's inHand change. */
function settleHand(db, e, front, c, ctx, changed) {
  const ended = TERMINAL.task.includes(front.status);
  if (c.inHand && ended) throw new UsageError(front.id + ' is ' + front.status + '; an ended task is never in hand');
  if (c.inHand && front.inHand !== ctx.session) {
    const notes = [];
    if (front.inHand && !c.takeOver) throw new UsageError(heldRefusal(front, handHolder(db, e.key, front), ctx));
    if (front.inHand) notes.push('taken over from ' + sessionWords(db, front.inHand));
    if (front.status === 'open') {
      const r = readiness(db, e.key);
      const reason = typeof c.reason === 'string' ? c.reason.trim() : '';
      if (!r.ready && !reason) {
        throw new UsageError(front.id + ' is not ready (' + r.held + '): give a reason to take it in hand anyway, or remove the edge that is wrong');
      }
      if (!r.ready) notes.push('taken in hand before ready: ' + reason);
    }
    front.inHand = ctx.session;
    front.inHandSince = ctx.at;
    changed.push('inHand');
    return notes.join('; ') || undefined;
  }
  if ((c.letGo || ended) && front.inHand) { delete front.inHand; delete front.inHandSince; changed.push('inHand'); }
  return undefined;
}

/* The holder as a held track names its own: session, PC (from the row that
   took it) and since. */
function handHolder(db, key, front) {
  const row = db.stmt(`SELECT pc, at FROM activity WHERE record = ? AND json_extract(line, '$.changes.inHand[1]') = ?
    ORDER BY seq DESC LIMIT 1`).get(key, front.inHand);
  return { session: front.inHand, pc: (row && row.pc) || null, since: front.inHandSince || (row && row.at) || null };
}

const heldRefusal = (front, h, ctx) => front.id + ' is in hand with ' + holderWords(h, { now: ctx.date.getTime(), pc: ctx.pc })
  + ': tell the user who holds it; it moves only by a take-over (takeOver on task_update, or --take-over on the CLI), which that session hears at its next prompt';

const HAND = `SELECT key FROM records WHERE kind = 'task' AND json_extract(fields, '$.inHand') = ? AND coalesce(status, '') NOT IN ('completed', 'dropped')
  ORDER BY json_extract(fields, '$.inHandSince') DESC, id DESC`;

/* the tasks a session has in hand, newest taken first, as keys. */
export const handKeys = (db, session) => (session ? db.stmt(HAND).all(session).map((r) => r.key) : []);

function moveHand(db, key, session, ctx, note) {
  const o = loadEntry(db, key);
  const before = snap(o.front);
  const f = normalize(WORK_KINDS.task, { ...o.front });
  if (session) { f.inHand = session; f.inHandSince = ctx.at; } else { delete f.inHand; delete f.inHandSince; }
  f.updated = ctx.at;
  const fields = orderFront(WORK_KINDS.task, f);
  save(db, o, fields);
  writeLine(db, ctx, { verb: 'edit', kind: 'task', front: fields, changes: changesOf(before, fields), note });
  followHand(db, key, ctx, note);
  return fields;
}

/* A handoff carries the session's tasks in hand: each lets go, keys newest first. */
export function letGoHand(db, session, actor, note) {
  const ctx = actorOf(actor);
  const keys = handKeys(db, session);
  for (const key of keys) moveHand(db, key, null, ctx, note);
  return keys;
}

/* Resume gives each back unless it ended or another session took it meanwhile;
   it never takes one over. */
export function giveHand(db, keys, session, actor, note) {
  const ctx = actorOf(actor);
  const given = [];
  const kept = [];
  /* an imported handoff's inHand is the old store's single label: not a list, nothing to give */
  for (const key of Array.isArray(keys) ? keys : []) {
    const o = loadEntry(db, key);
    if (!o || o.kind !== 'task' || TERMINAL.task.includes(o.front.status)) continue;
    const head = { id: o.front.id, name: o.front.name };
    if (o.front.inHand && o.front.inHand !== session) kept.push({ ...head, holder: handHolder(db, key, o.front) });
    else {
      if (o.front.inHand !== session) moveHand(db, key, session, ctx, note);
      given.push(head);
    }
  }
  return { given, kept };
}

/* The graph's word on a status flip: a promoted pointer is refused, and a task
   that is not ready starts only with a reason, which the edit's line carries. */
function statusGate(db, e, c) {
  /* a done side track still owns its pointer's status: no flip back by hand */
  const side = sideOf(db, e.key, ['open', 'parked', 'done']);
  if (side) throw new UsageError(e.front.id + ' is promoted: its done follows ' + side.label + ', never a status edit');
  const r = readiness(db, e.key);
  if (c.status !== 'in_progress' || r.status !== 'open' || r.ready) return undefined;
  const reason = typeof c.reason === 'string' ? c.reason.trim() : '';
  if (!reason) throw new UsageError(e.front.id + ' is not ready (' + r.held + '): give a reason to start it anyway, or remove the edge that is wrong');
  return 'started before ready: ' + reason;
}

/* What started a task's work, else null: a session held it, an agent ran it,
   it was started, or its journal has a note. */
export function startedBy(db, e) {
  const f = e.front;
  if (f.inHand) return sessionWords(db, f.inHand) + ' has it in hand';
  if (f.agent) return 'agent ' + f.agent + ' runs it';
  if (['in_progress', 'completed'].includes(f.status)) return 'it is ' + f.status;
  if (listOf(f, 'claimants').length) return 'a session claimed it';
  if (db.stmt('SELECT 1 FROM notes WHERE record = ? LIMIT 1').get(e.key)) return 'its journal has a note';
  const row = db.stmt(`SELECT json_extract(line, '$.changes.inHand[1]') AS hand, json_extract(line, '$.changes.agent[1]') AS agent FROM activity
    WHERE record = ? AND (json_extract(line, '$.changes.inHand[1]') IS NOT NULL OR json_extract(line, '$.changes.agent[1]') IS NOT NULL
    OR json_extract(line, '$.changes.status[1]') = 'in_progress') LIMIT 1`).get(e.key);
  if (!row) return null;
  return row.hand ? sessionWords(db, row.hand) + ' held it' : row.agent ? 'agent ' + row.agent + ' ran it' : 'it was started';
}

/* a task's intent and description rewrite in place until its work
   starts; after that a journal note amends them. */
function editTexts(db, e, k, c) {
  if (c.intent === undefined && c.description === undefined) return null;
  if (k.kind !== 'task') throw new UsageError("only a task's intent and description are rewritten by edit");
  const secs = sectionsOf(e.body);
  let body = e.body;
  const moved = [];
  for (const [field, name] of [['description', 'Description'], ['intent', 'Intent']]) {
    if (c[field] === undefined) continue;
    const next = guardHeadings(c[field]);
    const old = secs[name] ?? '';
    if (next === old) continue;
    body = withSection(body, name, next);
    moved.push({ field, old, next });
  }
  if (!moved.length) return null;
  const why = startedBy(db, e);
  if (why) {
    throw new UsageError(e.front.id + ' has started (' + why + '): its intent and description stay as written.\n'
      + 'Add what changed with note ' + e.front.id + ' --body "...", which amends it.');
  }
  return { body, moved };
}

const fieldNamed = (c) => ['name', 'status', 'priority', 'workstream', 'handoff', 'serves', 'projectRepos', 'runBy', 'reviewScope', 'intent', 'description'].some((key) => c[key] !== undefined)
  || c.clearRunBy || c.close !== undefined || c.clearClose || c.landed || c.clearWorkstream || c.inHand || c.letGo || c.clearServes || c.addOutcome?.length || c.removeOutcome?.length
  || ['addLabel', 'removeLabel', 'addRef', 'removeRef', 'addProject', 'removeProject'].some((key) => c[key]?.length);

/* Field flips, and a task's intent and description while its work has not started.
   `input` is { id, kind?, version?, ...today's change flags }; track (with before
   and after) or unplaced moves a task to the place its filer judged. */
export function editRecord(db, input = {}, actor) {
  const { track, before, after, unplaced, ...rest } = input || {};
  const place = { track, before, after, unplaced };
  if (Object.values(place).every((v) => v === undefined)) return editFields(db, rest, actor);
  if (rest.kind !== undefined && rest.kind !== 'task') throw new UsageError('only a task has a place on a track');
  return tx(db, () => {
    const out = fieldNamed(rest) ? editFields(db, rest, actor) : null;
    const e = target(db, rest.id, ['task'], actorOf(actor).day, 'edit');
    const placed = placeTask(db, e.key, place, actor);
    const version = db.stmt('SELECT version FROM records WHERE key = ?').get(e.key).version;
    return { ...(out || { id: e.front.id, kind: 'task', name: e.front.name }), changed: [...(out ? out.changed : []), 'place'], placed, version };
  });
}

function editFields(db, input, actor) {
  const c = { ...input };
  const ctx = actorOf(actor);
  if (c.kind !== undefined && !WORK_KINDS[c.kind]) throw new UsageError(refusal[c.kind] || 'unknown record kind: ' + c.kind);
  if (c.kind === 'knowledge') throw new UsageError(refusal.knowledge);
  for (const key of ['ordinal', 'plan', 'clearPlan']) {
    if (c[key] !== undefined) throw new UsageError('a task has no ' + key.replace('clearPlan', 'plan') + ' on the board: its track and place are the track verbs');
  }
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
  if (c.takeOver && !c.inHand) throw new UsageError('--take-over goes with --in-hand');
  if (c.inHand && !ctx.session) throw new UsageError('--in-hand needs --session <own-id>: the session that has it in hand');
  if (c.serves !== undefined && c.clearServes) throw new UsageError('pick one of --serves and --clear-serves');
  for (const key of ['intent', 'description']) {
    if (c[key] === undefined) continue;
    if (typeof c[key] !== 'string') throw new UsageError('--' + key + ' needs text');
    c[key] = c[key].replace(/\r\n/g, '\n').trim();
  }
  if (c.description === '') throw new UsageError('--description needs text');
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
      if (!k.statuses.includes(c.status)) throw new UsageError('status must be one of ' + k.statuses.join(', '));
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
    if (c.handoff !== undefined && k.kind !== 'workstream') throw new UsageError('only a workstream carries a handoff folder');
    if ((c.runBy !== undefined || c.clearRunBy) && k.kind !== 'task') throw new UsageError('only a task is run by someone');
    if (c.reviewScope !== undefined && k.kind !== 'task') throw new UsageError('only a review task has a review scope');
    checkVersion(e, c);
    const texts = editTexts(db, e, k, c);
    const early = k.kind === 'task' && c.status !== undefined && c.status !== e.front.status ? statusGate(db, e, c) : undefined;
    if (c.workstream) c.workstream = refTo(db, c.workstream, 'workstream', ctx.day);
    if (c.addRef) c.addRef = refsFor(db, c.addRef, ctx.day);
    if (c.removeRef) c.removeRef = c.removeRef.concat(refsFor(db, c.removeRef, ctx.day));
    const front = normalize(k, { ...e.front });
    const before = snap(front);
    const changed = applyEdit(k, front, c);
    if (c.reviewScope === 'project' && !isReview(front)) throw new UsageError(front.id + ' is not a review task: only a review has a review scope (label it review, or name it "Review ...")');
    if (texts) changed.push(...texts.moved.map((m) => m.field));
    const warnings = [];
    let handNote;
    if (k.kind === 'workstream') editOutcomes(db, e, front, c, changed, warnings);
    if (k.kind === 'task') {
      editServes(db, front, before, c, changed);
      handNote = settleHand(db, e, front, c, ctx, changed);
    }
    editClose(db, e, front, c, changed, ctx);
    if (!changed.length) return { id: front.id, kind: k.kind, name: front.name, changed: [], version: e.version };
    if (changed.includes('status')) endingStamps(db, k.kind, front, before, ctx);
    front.updated = ctx.at;
    const fields = orderFront(k, front);
    save(db, e, fields, texts ? texts.body : undefined);
    const ending = k.kind === 'task' && changed.includes('status') && TERMINAL.task.includes(fields.status) ? fields.status : null;
    const note = [early, handNote].filter(Boolean).join('; ') || undefined;
    let changes = closeChanges(db, changesOf(before, fields), before, fields);
    if (texts) {
      const ids = texts.moved.map((m) => addHistory(db, ctx, { key: e.key, field: m.field, old: m.old, next: m.next, why: 'edited in place' }));
      changes = { ...changes, ...Object.fromEntries(texts.moved.map((m) => [m.field, 'edited'])), history: historyRef(ids) };
    }
    writeLine(db, ctx, { verb: 'edit', kind: k.kind, front: fields, changes, note });
    /* in progress follows the hand, unless this edit named a status */
    const followed = changed.includes('inHand') && c.status === undefined && followHand(db, e.key, ctx);
    if (ending) wakeLinked(db, { ...fields, key: e.key }, ending, ctx);
    /* the shared check, a review's default covers and the reviews its work reopens */
    const after = ending === 'completed' ? afterTask(db, e.key, { completed: true }, actor) : null;
    const covers = after && after.covers;
    /* taking and letting go answer in their own words; an ending that lets go is no hand move asked */
    const hand = changed.includes('inHand') && (c.inHand || c.letGo) ? (fields.inHand ? 'taken' : 'let go') : null;
    return { id: fields.id, kind: k.kind, name: fields.name, changed, ...(hand ? { hand } : {}), ...(covers ? { covers } : {}), ...(after && after.reopened.length ? { reopened: after.reopened } : {}), version: e.version + (followed ? 2 : 1), ...(warnings.length ? { warnings } : {}) };
  });
}

/* task update: the start, the field edit and the note in one transaction,
   so a refusal part way through leaves nothing written. */
export function taskUpdate(db, input = {}, actor) {
  const { id, agent, reason, status, note, name, priority, addLabel, removeLabel } = input || {};
  if (agent !== undefined && status !== undefined && status !== 'in_progress') throw new UsageError('--agent tags a running task; it takes no --status ' + status);
  const start = agent !== undefined || status === 'in_progress';
  const edit = { name, priority, inHand: input.inHand === true, letGo: input.letGo === true, takeOver: input.takeOver === true, addLabel, removeLabel, reason,
    ...(status !== undefined && status !== 'in_progress' ? { status } : {}) };
  const editing = name !== undefined || priority !== undefined || edit.inHand || edit.letGo || edit.status !== undefined
    || Boolean(addLabel?.length) || Boolean(removeLabel?.length);
  if (!start && !editing && note === undefined) throw new UsageError('task update needs --agent, --status, --priority, --name, --in-hand, --let-go, a label or --note');
  return tx(db, () => {
    const out = {};
    if (start) out.start = startTask(db, { task: id, agent, reason }, actor);
    if (editing) out.edit = editRecord(db, { id, kind: 'task', ...edit }, actor);
    if (out.edit && out.edit.hand) out.hand = out.edit.hand;
    if (note !== undefined) out.note = noteRecord(db, { id, text: note }, actor);
    /* taking a task in hand hands the session the rulings linked to it */
    if (edit.inHand) {
      const ds = decisionsFor(db, { task: out.edit.id }).map((d) => ({ id: d.id, name: d.name }));
      if (ds.length) out.decisions = ds;
    }
    return out;
  });
}

/* ---- close and reopen (workstreams; a task's statuses carry its life) ---- */

function closeRefusal(kind) {
  if (kind === 'task') return 'a task has no close verb: task edit --status completed or dropped';
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

/* For a premature close only; a workstream reopened past its archive day takes a fresh label. */
export function reopenRecord(db, input = {}, actor) {
  const ctx = actorOf(actor);
  return tx(db, () => {
    const hit = resolveRecord(db, String(input.id ?? '').trim(), { day: ctx.day });
    if (hit && hit.kind === 'task') throw new UsageError('a task reopens through task edit --status, not the reopen verb');
    if (hit && hit.kind === 'knowledge') throw new UsageError('a knowledge record has no reopen verb: a superseded fact stays superseded');
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

/* `input` is { id, text }. A workstream with no Journal gets one with its first note. */
export function noteRecord(db, input = {}, actor) {
  const ctx = actorOf(actor);
  const body = String(input.text ?? '').trim();
  if (!body) throw new UsageError('note needs its body text on stdin');
  return tx(db, () => {
    const raw = String(input.id ?? '').trim();
    const e = resolveRecord(db, raw, { day: ctx.day });
    if (!e || e.kind === 'profile' || e.kind === 'handoff') throw new UsageError('unknown record id: ' + raw);
    if (e.kind === 'question') throw new UsageError(raw + ' is a question; note takes a work record (WS-n, T-n, K-n, TR-n)');
    const text = guardHeadings(body);
    addNote(db, e.key, { at: ctx.at, actor: ctx.by, body: text });
    const k = WORK_KINDS[e.kind];
    const front = k ? normalize(k, { ...e.front }) : { ...e.front };
    front.updated = ctx.at;
    const fields = k ? orderFront(k, front) : front;
    const journalless = e.layout && e.layout.journal === false;
    putRecord(db, {
      key: e.key, kind: e.kind, slug: e.slug, fields, track: e.track,
      body: journalless ? String(e.body).replace(/\n*$/, '\n') + '\n' : e.body, layout: journalless ? null : e.layout,
    });
    writeLine(db, ctx, { verb: 'note', kind: e.kind, front: fields, changes: {}, note: body });
    return { id: fields.id, kind: e.kind, name: fields.name, note: ctx.at + ': ' + text };
  });
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


/* A decision's file links are repo-relative globs, as a procedure card's are. */
function globList(raw) {
  return strList(raw, 'files').map((g) => {
    const s = g.replace(/\\/g, '/').replace(/^(\.\/)+/, '');
    if (/^([A-Za-z]:)?\//.test(s)) throw new UsageError('files are globs relative to the repo root, not absolute: ' + g);
    return s;
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
  if (front.status === 'withdrawn') throw new UsageError(front.id + ' is withdrawn: never ruled, so nothing supersedes it');
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
  if (front.status === 'withdrawn') throw new UsageError(front.id + ' is withdrawn: never ruled');
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

/* knowledge edit: name and body rewritten in place only while no other session
   has used the record; the old text goes to the history either way. */
export function editKnowledge(db, input = {}, actor) {
  const ctx = actorOf(actor);
  const name = input.name === undefined ? undefined : String(input.name).replace(/\s*\r?\n\s*/g, ' ').trim();
  if (name !== undefined && !name) throw new UsageError('--name needs a non-empty value');
  const text = input.body === undefined ? undefined : guardHeadings(String(input.body).replace(/\r\n/g, '\n').trim());
  if (name === undefined && text === undefined) throw new UsageError('knowledge edit needs --name or --body');
  return tx(db, () => {
    const e = knowledgeTarget(db, input.id, ctx.day, 'edit');
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
    }
    if (!moved.length) return { id: front.id, kind: 'knowledge', name: front.name, changed: [], version: e.version };
    const why = usedBy(db, e);
    if (why) throw new UsageError(inUseRefusal(front.id, why));
    front.updated = ctx.at;
    const fields = orderFront(WORK_KINDS.knowledge, front);
    save(db, e, fields, body);
    const ids = moved.map((m) => addHistory(db, ctx, { key: e.key, field: m.field, old: m.old, next: m.next, why: 'edited in place' }));
    const changes = { ...changesOf(before, fields), ...Object.fromEntries(moved.map((m) => [m.field, 'edited'])), history: historyRef(ids) };
    writeLine(db, ctx, { verb: 'edit', kind: 'knowledge', front: fields, changes });
    return { id: fields.id, kind: 'knowledge', name: fields.name, changed: moved.map((m) => m.field), history: ids, version: e.version + 1 };
  });
}

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
  const sections = sectionsOf(e.body);
  const journal = journalOf(db, e.key);
  if (!(e.layout && e.layout.journal === false) || journal) sections.Journal = journal;
  const out = {
    ...shownFront(db, k ? normalize(k, { ...e.front }) : e.front), kind: e.kind, description: sections.Description ?? '',
    journal, sections, version: e.version,
  };
  if (e.kind === 'task') out.intent = sections.Intent ?? '';
  return out;
}

const terminalOf = (kind) => TERMINAL[kind] || LABEL_KINDS[kind]?.ended || [];

/* Open work by default; `all` or a named status brings the rest. Tasks order by
   ordinal then label inside the listed scope. */
export function listWork(db, filters = {}) {
  const kind = String(filters.kind ?? '');
  const k = WORK_KINDS[kind];
  if (!k) throw new UsageError(refusal[kind] || 'list takes --kind workstream, task or knowledge: ' + kind);
  if (filters.workstream !== undefined && kind === 'workstream') {
    throw new UsageError('a workstream never references a workstream; --workstream filters tasks and questions');
  }
  if (filters.priority !== undefined && kind !== 'task') throw new UsageError('a ' + kind + ' carries no priority');
  if (filters.priority !== undefined && !PRIORITIES.includes(filters.priority)) throw new UsageError('--priority must be one of ' + PRIORITIES.join(', '));
  if (filters.status !== undefined && !k.statuses.includes(filters.status)) {
    throw new UsageError('--status for a ' + kind + ' must be one of ' + k.statuses.join(', '));
  }
  if (filters.open && filters.status !== undefined) throw new UsageError('--open and --status name different sets; pick one');
  let ws;
  if (filters.workstream !== undefined) {
    const e = resolveRecord(db, filters.workstream);
    ws = e ? e.key : String(filters.workstream);
  }
  const ended = terminalOf(kind);
  const memo = new Map();
  const rows = [];
  for (const r of db.stmt('SELECT key, fields, body FROM records WHERE kind = ? ORDER BY id').all(kind)) {
    const f = normalize(k, JSON.parse(r.fields));
    if (filters.status !== undefined) { if (f.status !== filters.status) continue; }
    else if (!filters.all && ended.includes(f.status)) continue;
    if (ws !== undefined && f.workstream !== ws) continue;
    if (filters.priority !== undefined && f.priority !== filters.priority) continue;
    if (filters.label !== undefined && !listOf(f, 'labels').includes(filters.label)) continue;
    rows.push({ ...shownFront(db, f, memo), kind, description: sectionsOf(r.body).Description ?? '' });
  }
  const num = (r) => Number(String(r.id).split('-')[1]);
  rows.sort((a, b) => (kind === 'task' ? (a.ordinal ?? DEFAULT_ORDINAL) - (b.ordinal ?? DEFAULT_ORDINAL) : 0) || num(a) - num(b));
  return rows;
}

/* Every task a session has in hand, newest taken first (list --json's inHand, the status line). */
export function heldTask(db, input = {}) {
  const s = String(input.session ?? '').trim();
  const memo = new Map();
  return handKeys(db, s).map((key) => {
    const f = shownFront(db, loadEntry(db, key).front, memo);
    return { id: f.id, name: f.name, status: f.status, workstream: f.workstream || '', since: f.inHandSince || null };
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

