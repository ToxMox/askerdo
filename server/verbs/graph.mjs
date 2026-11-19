/* The task graph: "depends on" edges, now, ready, waits on, the
   critical path and checklists, plus the helpers the track verbs share. What is
   derived is computed from the tables when read and never stored. */
import { readTx, tx } from '../db.mjs';
import { KEY_ORDERS, actorOf, dayOf, isKey, labelOf, logVerb, putRecord } from '../records.mjs';
import { labelGates, resolveRecord } from './labels.mjs';
import { shortName } from '../web/graph.mjs';
import { byNumber } from '../web/picture-model.mjs';
import { HEARD_MS, leadRun, workersOf } from './runs.mjs';
/* read at call time only: upkeep.mjs imports this module */
import { enteredInbox, isNextSession, wakeState } from './upkeep.mjs';

export class TrackRefusal extends Error {
  constructor(message, data) {
    super(message);
    this.name = 'TrackRefusal';
    if (data) this.data = data;
  }
}

/* ---- shared helpers ------------------------------------------------------- */

export const ENDED_TASK = Object.freeze(['done', 'dropped']);
const ENDED_QUESTION = ['answered', 'dropped'];

export const TASK_KEYS = KEY_ORDERS.task;

/* `field`, when given, names what to fill in, for a caller that is not this PC's CLI */
export function needText(v, what, field) {
  if (typeof v !== 'string' || !v.trim()) throw new TrackRefusal(what + ' needs ' + (field ? 'a ' + field + ': ' : '') + 'a line of text');
  return v.replace(/\s+/g, ' ').trim();
}

/* One activity row (records.mjs logVerb); `rec` is the record's head. */
export const logLine = (db, { at, verb, kind, rec, changes = {}, by, pc, note, for: actedFor }) => logVerb(db, {
  ts: at, verb, kind, id: rec.id || '', key: rec.key, name: rec.name || '', changes, by, pc, note, for: actedFor,
});

export function loadRecord(db, key) {
  const r = db.stmt('SELECT key, kind, slug, fields, body, layout, track, version FROM records WHERE key = ?').get(key);
  if (!r) return null;
  return { ...r, fields: JSON.parse(r.fields), layout: r.layout === null ? null : JSON.parse(r.layout) };
}

export const headOf = (rec) => ({ id: rec.fields.id, key: rec.key, name: rec.fields.name });

/* `changes` applied in the kind's key order: a key already there keeps its
   place, a new one lands where the order puts it, undefined removes it. */
export function withFields(front, changes, order) {
  const keys = Object.keys(front).filter((k) => !(Object.hasOwn(changes, k) && changes[k] === undefined));
  const rank = (k) => { const i = order.indexOf(k); return i < 0 ? Infinity : i; };
  for (const k of Object.keys(changes)) {
    if (changes[k] === undefined || keys.includes(k)) continue;
    let at = keys.findIndex((x) => rank(x) > rank(k));
    if (at < 0) at = keys.length;
    keys.splice(at, 0, k);
  }
  const out = {};
  for (const k of keys) out[k] = Object.hasOwn(changes, k) ? changes[k] : front[k];
  return out;
}

/* Writes the changed front back and returns the line's changes map. */
export function writeFront(db, rec, changes, order) {
  const before = rec.fields;
  const after = withFields(before, changes, order);
  putRecord(db, { key: rec.key, kind: rec.kind, slug: rec.slug, fields: after, body: rec.body, layout: rec.layout, track: rec.track });
  rec.fields = after;
  const diff = {};
  for (const k of Object.keys(changes)) {
    if (k === 'updated' || k === 'closed') continue;
    const a = before[k] === undefined || before[k] === '' ? null : before[k];
    const b = after[k] === undefined || after[k] === '' ? null : after[k];
    if (JSON.stringify(a) !== JSON.stringify(b)) diff[k] = [a, b];
  }
  return diff;
}

/* Lists and checklists move without touching the front; the version still moves
   so a reorder that read an older one is refused. */
export const bumpVersion = (db, key) => db.stmt('UPDATE records SET version = version + 1 WHERE key = ?').run(key);

export function checkVersion(rec, version) {
  if (version === undefined || version === null) return;
  if (Number(version) !== rec.version) {
    throw new TrackRefusal(rec.fields.id + ' moved since you read it (version ' + version + ', now ' + rec.version + '); read it again', { version: rec.version });
  }
}

/* A key, or a label resolved (labels.mjs) to the record holding it now. */
export function keyOf(db, ref, kind) {
  const s = String(ref ?? '').trim();
  const e = s ? resolveRecord(db, s, kind ? { kinds: [kind] } : {}) : null;
  if (e && e.kind !== 'handoff') return e.key;
  throw new TrackRefusal('no ' + (kind || 'record') + ' ' + (s || '(none given)'));
}

export function recordOf(db, ref, kind) {
  return loadRecord(db, keyOf(db, ref, kind));
}

export { readTx };

/* ---- loading the graph ---------------------------------------------------- */

const IN = 'SELECT value FROM json_each(?)';

/* The seeds and everything upstream that is still open, by "depends on" edges. */
function closure(db, seeds) {
  return db.stmt(`WITH RECURSIVE c(k) AS (
      ${IN}
      UNION
      SELECT d."on" FROM c JOIN records r ON r.key = c.k JOIN depends d ON d.task = c.k
        WHERE coalesce(r.status, '') NOT IN ('done', 'dropped')
    ) SELECT k FROM c`).all(JSON.stringify(seeds)).map((r) => r.k);
}

/* Everything the views need, in a handful of indexed reads. */
export function loadGraph(db, seeds) {
  const keys = closure(db, seeds);
  const J = JSON.stringify(keys);
  const nodes = new Map();
  /* who is on each task is read from its runs here once; every reader takes it from the node */
  const who = workersOf(db, keys);
  for (const r of db.stmt(`SELECT r.key, r.label, r.title, r.status, ti.track, ti.position, json_extract(r.fields, '$.created') AS created,
      json_extract(r.fields, '$.closed') AS closed, json_extract(r.fields, '$.wake') AS wake
      FROM records r LEFT JOIN track_items ti ON ti.task = r.key WHERE r.key IN (${IN}) AND r.kind = 'task'`).all(J)) {
    const w = who.get(r.key);
    let wake = null;
    try { wake = r.wake ? JSON.parse(r.wake) : null; } catch { /* an unreadable wake reads as none */ }
    nodes.set(r.key, {
      key: r.key, id: r.label, name: r.title, status: r.status, agent: w.agent, inHand: w.inHand, open: w.open, last: w.last,
      created: r.created || null, closed: r.closed || null, wake: wake && typeof wake === 'object' ? wake : null,
      track: r.track || null, position: r.position ?? Infinity, deps: [], gates: [], checklist: null,
    });
  }
  for (const e of db.stmt(`SELECT task, "on" FROM depends WHERE task IN (${IN})`).all(J)) {
    const n = nodes.get(e.task);
    if (n && nodes.has(e.on)) n.deps.push(e.on);
  }
  for (const q of db.stmt(`SELECT x.task, q.label FROM (SELECT t.value AS task, l."from" AS q FROM json_each(?) t
      JOIN links l ON l.type = 'gates' AND l."to" = t.value
      UNION SELECT json_extract(o.value, '$.task'), json_extract(o.value, '$.from') FROM json_each(?) o) x
      JOIN records q ON q.key = x.q AND q.kind = 'question'
      WHERE coalesce(q.status, '') NOT IN (${ENDED_QUESTION.map((s) => "'" + s + "'").join(', ')})`).all(J, JSON.stringify(labelGates(db, keys)))) {
    const n = nodes.get(q.task);
    if (n && !n.gates.includes(q.label)) n.gates.push(q.label);
  }
  /* a struck step is no work, so it counts in neither side */
  for (const c of db.stmt(`SELECT task, sum(state <> 'struck') AS total, sum(state = 'done') AS done FROM steps WHERE task IN (${IN}) GROUP BY task`).all(J)) {
    const n = nodes.get(c.task);
    if (n && c.total) n.checklist = { done: c.done, total: c.total };
  }
  const trackKeys = [...new Set([...nodes.values()].map((n) => n.track).filter(Boolean))];
  const TJ = JSON.stringify(trackKeys);
  const tracks = new Map();
  for (const t of db.stmt(`SELECT key, label, title, status FROM records WHERE key IN (${IN})`).all(TJ)) {
    tracks.set(t.key, { key: t.key, id: t.label, name: t.title, status: t.status, holder: null });
  }
  for (const l of db.stmt(`SELECT track, session FROM leases WHERE track IN (${IN})`).all(TJ)) {
    if (tracks.has(l.track)) tracks.get(l.track).holder = l.session;
  }
  return { nodes, tracks, db };
}

/* ---- what the graph says -------------------------------------------------- */

export const isEnded = (n) => ENDED_TASK.includes(n.status);

export function isReady(g, n) {
  if (n.status !== 'open' || n.gates.length) return false;
  return n.deps.every((k) => isEnded(g.nodes.get(k)));
}

const trackLabel = (g, key) => (g.tracks.get(key) || {}).id || key;

/* What holds a task, in plain words: "after T-41 on TR-5", "after Q93". */
export function waitsOn(g, n) {
  const out = [];
  for (const k of n.deps) {
    const d = g.nodes.get(k);
    if (isEnded(d)) continue;
    out.push('after ' + d.id + (d.track === n.track ? '' : d.track ? ' on ' + trackLabel(g, d.track) : ' in the inbox'));
  }
  for (const q of n.gates) out.push('after ' + q);
  return out;
}

/* ---- a task's word --------------------------------------------------------- */

const msOf = (s) => { const t = Date.parse(s || ''); return Number.isFinite(t) ? t : -Infinity; };
/* the later of two stamps or days, by the time they name */
function later(a, b) { return !b ? a || null : !a ? b : msOf(b) > msOf(a) ? b : a; }

/* What dates a task's opening, read once per graph for every node: its last line that moved
   its status, track, edges or wake (and the last reopen), and the ends of the gates it had. */
function openingsOf(g) {
  if (g.openings) return g.openings;
  const out = new Map();
  const J = JSON.stringify([...g.nodes.keys()]);
  const at = (k) => { if (!out.has(k)) out.set(k, { moved: null, reopened: null, gateEnded: null }); return out.get(k); };
  for (const r of g.db.stmt(`SELECT record, at, json_extract(diff, '$.status[0]') AS was FROM activity WHERE record IN (${IN})
      AND (json_type(diff, '$.status') = 'array' OR json_type(diff, '$.track') = 'array' OR json_type(diff, '$.dependsOn') = 'array'
        OR json_type(diff, '$.wake') = 'array') ORDER BY seq`).all(J)) {
    const o = at(r.record);
    o.moved = later(o.moved, r.at);
    if (['done', 'dropped', 'completed'].includes(r.was)) o.reopened = later(o.reopened, r.at);
  }
  for (const q of g.db.stmt(`SELECT x.task, json_extract(q.fields, '$.closed') AS closed FROM (SELECT t.value AS task, l."from" AS q FROM json_each(?) t
      JOIN links l ON l.type = 'gates' AND l."to" = t.value
      UNION SELECT json_extract(o.value, '$.task'), json_extract(o.value, '$.from') FROM json_each(?) o) x
      JOIN records q ON q.key = x.q AND q.kind = 'question' WHERE q.status IN (${ENDED_QUESTION.map((s) => "'" + s + "'").join(', ')})`)
    .all(J, JSON.stringify(labelGates(g.db, [...g.nodes.keys()])))) at(q.task).gateEnded = later(at(q.task).gateEnded, q.closed);
  g.openings = out;
  return out;
}

/* An inbox task's wake on the clock's day: { due, on, came }, `came` the day or the stamp it came. */
function wakeOfNode(g, n, nowMs) {
  const day = dayOf(new Date(nowMs));
  const w = n.wake;
  const s = wakeState(g.db, w, day, w ? null : enteredInbox(g.db, n.key, n.created));
  if (s.due && w && w.on) {
    const e = g.db.stmt("SELECT json_extract(fields, '$.closed') AS closed FROM records WHERE key = ?").get(w.on);
    return { due: true, came: (e && e.closed) || null };
  }
  return { due: s.due, on: s.due ? null : w && w.on ? s.wake : 'until ' + s.wake, came: s.due ? s.wake : null };
}

/* a task on a track waiting for the next session is due from the first take of its track by a
   session other than its filer, at or after the filing; a take that continues an id of the filer's chain
   (a /clear) joins the chain instead. The takes are read once per graph. */
function nextOfNode(g, n) {
  if (!n.track || !isNextSession(n.wake)) return null;
  if (!g.takes) {
    g.takes = new Map();
    const tracks = [...new Set([...g.nodes.values()].filter((x) => x.track && isNextSession(x.wake)).map((x) => x.track))];
    for (const r of g.db.stmt(`SELECT record, at, json_extract(diff, '$.session[1]') AS session, json_extract(diff, '$.continues[1]') AS continues FROM activity WHERE record IN (${IN})
        AND json_type(diff, '$.session') = 'array' AND json_extract(diff, '$.session[1]') IS NOT NULL ORDER BY seq`).all(JSON.stringify(tracks))) {
      if (!g.takes.has(r.record)) g.takes.set(r.record, []);
      g.takes.get(r.record).push(r);
    }
  }
  const chain = new Set([n.wake.session]);
  for (const t of g.takes.get(n.track) || []) {
    if (t.continues && chain.has(t.continues)) { chain.add(t.session); continue; }
    if (!chain.has(t.session) && msOf(t.at) >= msOf(n.wake.at)) return { due: true, came: t.at };
  }
  return { due: false, on: 'until the next session' };
}

const whoOf = (r) => {
  const out = { run: r.run, worker: r.worker };
  for (const k of ['job', 'agentId', 'session', 'pc']) if (r[k]) out[k] = r[k];
  return out;
};

/* A task's word from its records, the first row of the word table that applies, with the
   clock passed in (ms): done or dropped; running or unconfirmed by its open runs' last heard;
   waiting on an edge, a gate or a wake; else ready to start, continue or settle. */
export function wordOf(g, n, nowMs) {
  const st = n.status;
  if (ENDED_TASK.includes(st)) return { is: st, ...(n.closed ? { since: n.closed } : {}) };
  const lead = leadRun(n.open);
  if (lead) {
    const heard = nowMs - msOf(lead.heard) <= HEARD_MS;
    return heard ? { is: 'running', ...whoOf(lead), since: lead.started, heard: lead.heard }
      : { is: 'unconfirmed', ...whoOf(lead), since: lead.heard, started: lead.started };
  }
  const on = waitsOn(g, n);
  const wake = n.track ? nextOfNode(g, n) : wakeOfNode(g, n, nowMs);
  if (wake && wake.on) on.push(wake.on);
  if (on.length) return { is: 'waiting', on };
  const o = openingsOf(g).get(n.key) || {};
  let since = later(n.created, o.moved);
  if (n.last) since = later(since, n.last.ended);
  for (const k of n.deps) { const d = g.nodes.get(k); if (d && isEnded(d)) since = later(since, d.closed); }
  since = later(since, o.gateEnded);
  if (wake) since = later(since, wake.came);
  const last = n.last;
  /* a reopen after the last run's end leaves work to continue, never a finish to settle */
  const next = !last ? 'start' : last.how === 'finished' && !(o.reopened && msOf(o.reopened) > msOf(last.ended)) ? 'settle' : 'continue';
  return { is: 'ready', next, ...(since ? { since } : {}), ...(last ? { ...whoOf(last), how: last.how, ended: last.ended } : {}) };
}

/* The word of each task at `keys`, for shown and sent records: Map key -> word. */
export function wordsOf(db, keys, nowMs) {
  const want = [...new Set(keys)].filter(Boolean);
  const out = new Map();
  if (!want.length) return out;
  const g = loadGraph(db, want);
  for (const k of want) { const n = g.nodes.get(k); if (n) out.set(k, wordOf(g, n, nowMs)); }
  return out;
}

/* Who is on each task with its word, for a shown or sent record's front (runs.mjs withWorkers). */
export function shownWorkers(db, keys, nowMs) {
  const who = workersOf(db, keys);
  const words = wordsOf(db, keys, nowMs);
  for (const [k, w] of who) w.word = words.get(k) || null;
  return who;
}

/* the same waits for a refusal, each id with its short name: "after T-84 The move on TR-5; Q12 Which glass" */
function waitsNamed(db, g, n) {
  const named = (id, name) => { const s = shortName(name || ''); return s ? id + ' ' + s : id; };
  const out = [];
  for (const k of n.deps) {
    const d = g.nodes.get(k);
    if (isEnded(d)) continue;
    out.push(named(d.id, d.name) + (d.track === n.track ? '' : d.track ? ' on ' + trackLabel(g, d.track) : ' in the inbox'));
  }
  /* a gate is an open question, so an ended record that once held its label never names it */
  const title = (q) => { const e = resolveRecord(db, q, { kinds: ['question'] }); return e && !ENDED_QUESTION.includes(e.fields.status) ? e.fields.name : ''; };
  for (const q of n.gates) out.push(named(q, title(q)));
  return out.length ? 'after ' + out.join('; ') : '';
}

/* The longest chain of open tasks ending at `key`. Equal chains go to the
   lower task number (byNumber), as the picture's critOf breaks them. */
const byTaskNumber = (g) => (a, b) => byNumber(g.nodes.get(a).id, g.nodes.get(b).id);
function chainTo(g, key, memo, path = new Set()) {
  if (memo.has(key)) return memo.get(key);
  const n = g.nodes.get(key);
  if (!n || isEnded(n)) return { length: 0, path: [] };
  if (path.has(key)) throw new TrackRefusal('the graph holds a loop through ' + n.id);
  path.add(key);
  let best = { length: 0, path: [] };
  for (const k of [...n.deps].sort(byTaskNumber(g))) {
    const r = chainTo(g, k, memo, path);
    if (r.length > best.length) best = r;
  }
  path.delete(key);
  const out = { length: best.length + 1, path: best.path.concat(key) };
  memo.set(key, out);
  return out;
}

/* Columns by dependency depth: every open task sits right of what it waits on. */
function columnOf(g, key, memo) {
  if (memo.has(key)) return memo.get(key);
  memo.set(key, 0);
  const n = g.nodes.get(key);
  let c = 0;
  for (const k of n.deps) if (!isEnded(g.nodes.get(k))) c = Math.max(c, columnOf(g, k, memo) + 1);
  memo.set(key, c);
  return c;
}

/* One track's view: now with its agents, ready, the critical path, and its
   open tasks in dependency order (position breaks ties). */
export function trackGraph(db, trackKey, nowMs = Date.now()) {
  return readTx(db, () => {
    const seeds = db.stmt('SELECT task FROM track_items WHERE track = ? ORDER BY position').all(trackKey).map((r) => r.task);
    const g = loadGraph(db, seeds);
    const mine = seeds.map((k) => g.nodes.get(k)).filter(Boolean);
    const open = mine.filter((n) => !isEnded(n));
    const words = new Map(open.map((n) => [n.key, wordOf(g, n, nowMs)]));
    const brief = (n) => ({ id: n.id, key: n.key, name: n.name, word: words.get(n.key) });
    /* who a row names: the open run's agent or session; for ready work to continue or settle, the last run's */
    const tagOf = (n) => {
      const w = words.get(n.key);
      if (!w.worker) return {};
      return w.worker === 'agent' ? { agent: w.job } : w.session ? { session: w.session } : {};
    };
    /* its own checklist rides its row, so the row says what holds it open */
    const stepsOf = (n) => (n.checklist ? { progress: { done: n.checklist.done, total: n.checklist.total, text: n.checklist.done + ' of ' + n.checklist.total } } : {});
    const is = (n, ...w) => w.includes(words.get(n.key).is);
    const now = open.filter((n) => is(n, 'running', 'unconfirmed')).map((n) => ({ ...brief(n), ...tagOf(n), ...stepsOf(n) }));
    const ready = open.filter((n) => is(n, 'ready')).map((n) => ({ ...brief(n), ...tagOf(n), ...stepsOf(n) }));
    const memo = new Map();
    let critical = { length: 0, path: [] };
    for (const n of [...open].sort((a, b) => byNumber(a.id, b.id))) {
      const r = chainTo(g, n.key, memo);
      if (r.length > critical.length) critical = r;
    }
    const cols = new Map();
    const tasks = open.map((n) => ({ n, col: columnOf(g, n.key, cols) }))
      .sort((a, b) => a.col - b.col || a.n.position - b.n.position)
      .map(({ n, col }) => {
        const t = { ...brief(n), status: n.status, column: col, ready: is(n, 'ready'), waitsOn: waitsOn(g, n), ...tagOf(n) };
        const p = n.checklist;
        if (p) t.progress = { done: p.done, total: p.total, text: p.done + ' of ' + p.total };
        return t;
      });
    const edges = [];
    for (const n of open) for (const k of n.deps) edges.push({ task: n.id, on: g.nodes.get(k).id, done: isEnded(g.nodes.get(k)) });
    /* the names of the tasks it mentions off this track (a wait, the critical path), so each id carries one */
    const own = new Set(open.map((n) => n.key));
    const names = {};
    for (const k of [...open.flatMap((n) => n.deps), ...critical.path]) {
      const d = g.nodes.get(k);
      if (d && !own.has(k) && !isEnded(d)) names[d.id] = d.name;
    }
    return {
      now, ready, tasks, edges, names,
      critical: { length: critical.length, path: critical.path.map((k) => g.nodes.get(k).id) },
      done: mine.length - open.length, total: mine.length,
    };
  });
}

/* One task: its stored status, its word, and ready or what holds it by an edge or a
   gate (a start or a take refuses on these, never on an inbox wake). */
export function readiness(db, taskKey, nowMs = Date.now()) {
  return readTx(db, () => {
    const g = loadGraph(db, [taskKey]);
    const n = g.nodes.get(taskKey);
    if (!n) throw new TrackRefusal('no task ' + taskKey);
    return { id: n.id, status: n.status, word: wordOf(g, n, nowMs), ready: isReady(g, n), waitsOn: waitsOn(g, n), held: waitsNamed(db, g, n) };
  });
}

/* ---- edges ---------------------------------------------------------------- */

/* Upstream neighbours, every status: a loop through done work is still a loop. */
const upstream = (db, key) => db.stmt('SELECT "on" AS k FROM depends WHERE task = ?').all(key).map((r) => r.k);

/* The chain by which `from` already waits on `to`, or null. */
export function pathBetween(db, from, to) {
  const back = new Map([[from, null]]);
  const queue = [from];
  while (queue.length) {
    const k = queue.shift();
    if (k === to) {
      const path = [];
      for (let x = k; x !== null; x = back.get(x)) path.unshift(x);
      return path;
    }
    for (const u of upstream(db, k)) if (!back.has(u)) { back.set(u, k); queue.push(u); }
  }
  return null;
}

const taskRec = (db, ref) => recordOf(db, ref, 'task');

/* `task` depends on `on`. A loop is refused at write, with the chain that closes it. */
export function addEdge(db, input, actor) {
  const reason = needText(input && input.reason, 'an edge', 'reason');
  return tx(db, () => {
    const t = taskRec(db, input.task);
    const o = taskRec(db, input.on);
    if (t.key === o.key) throw new TrackRefusal(t.fields.id + ' cannot depend on itself');
    if (db.stmt('SELECT 1 FROM depends WHERE task = ? AND "on" = ?').get(t.key, o.key)) {
      return { task: t.fields.id, on: o.fields.id, added: false };
    }
    const loop = pathBetween(db, o.key, t.key);
    if (loop) {
      const ids = loop.map((k) => labelOf(db, k));
      throw new TrackRefusal(o.fields.id + ' already waits on ' + t.fields.id + ' (' + ids.join(' after ') + '), so this edge would make a loop',
        { loop: ids });
    }
    const c = actorOf(actor);
    const at = c.at;
    db.stmt('INSERT INTO depends (task, "on", reason, added, actor) VALUES (?, ?, ?, ?, ?)').run(t.key, o.key, reason, at, c.by);
    bumpVersion(db, t.key);
    logLine(db, { at, verb: 'edit', kind: 'task', rec: headOf(t), changes: { dependsOn: [null, o.key] }, by: c.by, pc: c.pc, note: reason });
    return { task: t.fields.id, on: o.fields.id, added: true };
  });
}

export function removeEdge(db, input, actor) {
  const reason = needText(input && input.reason, 'removing an edge', 'reason');
  return tx(db, () => {
    const t = taskRec(db, input.task);
    const o = taskRec(db, input.on);
    const r = db.stmt('DELETE FROM depends WHERE task = ? AND "on" = ?').run(t.key, o.key);
    if (!r.changes) throw new TrackRefusal(t.fields.id + ' does not depend on ' + o.fields.id);
    const c = actorOf(actor);
    const at = c.at;
    bumpVersion(db, t.key);
    logLine(db, { at, verb: 'edit', kind: 'task', rec: headOf(t), changes: { dependsOn: [o.key, null] }, by: c.by, pc: c.pc, note: reason });
    return { task: t.fields.id, on: o.fields.id, removed: true };
  });
}

/* ---- checklists ----------------------------------------------------------- */

/* A step (migration 015): its number is given when it is added, never moves and is never
   reused (step_tops keeps the highest given, so a row that goes leaves its number spent);
   the order shown is its own column; a done or struck step carries a word and when. */
const STEP_STATES = ['open', 'done', 'struck'];

const stepOf = (r) => {
  const out = { n: r.n, text: r.text, done: r.state !== 'open', doneAt: r.at || null };
  if (r.state === 'struck') out.struck = r.word || '';
  else if (r.word) out.word = r.word;
  return out;
};

/* in the order shown; `n` is the step's own number, never its place */
export function itemsOf(db, taskKey) {
  return db.stmt('SELECT n, text, state, word, at FROM steps WHERE task = ? ORDER BY position, n').all(taskKey).map(stepOf);
}

/* a struck step is no work, so it counts in neither side of done of total */
export const progressText = (items) => {
  const live = items.filter((i) => !i.struck);
  return live.length ? live.filter((i) => i.done).length + ' of ' + live.length : null;
};

function nextNumber(db, taskKey) {
  const r = db.stmt('SELECT top FROM step_tops WHERE task = ?').get(taskKey);
  const top = Math.max(r ? r.top : 0, db.stmt('SELECT coalesce(max(n), 0) AS n FROM steps WHERE task = ?').get(taskKey).n) + 1;
  db.stmt('INSERT INTO step_tops (task, top) VALUES (?, ?) ON CONFLICT (task) DO UPDATE SET top = excluded.top').run(taskKey, top);
  return top;
}

/* An order value for place `index` (0 first) among the task's steps, `skip` aside; the
   neighbours' midpoint, so only the row placed is written. */
function orderAt(db, taskKey, index, skip) {
  const rows = () => db.stmt('SELECT n, position FROM steps WHERE task = ? ORDER BY position, n').all(taskKey).filter((r) => r.n !== skip);
  let ps = rows().map((r) => r.position);
  if (!ps.length) return 1;
  if (index >= ps.length) return ps[ps.length - 1] + 1;
  if (index <= 0) return ps[0] - 1;
  let mid = (ps[index - 1] + ps[index]) / 2;
  if (mid === ps[index - 1] || mid === ps[index]) {
    /* worn thin by many moves: space the order out again, numbers untouched */
    const set = db.stmt('UPDATE steps SET position = ? WHERE task = ? AND n = ?');
    rows().forEach((r, i) => set.run(i + 1, taskKey, r.n));
    ps = rows().map((r) => r.position);
    mid = (ps[index - 1] + ps[index]) / 2;
  }
  return mid;
}

/* Adds one step at place `index` (end when undefined) and returns its new number. */
export function insertStep(db, taskKey, { text, index, state = 'open', word = null, at = null }) {
  if (!STEP_STATES.includes(state)) throw new TrackRefusal('a step is open, done or struck, not ' + state);
  const n = nextNumber(db, taskKey);
  const count = db.stmt('SELECT count(*) AS c FROM steps WHERE task = ?').get(taskKey).c;
  db.stmt('INSERT INTO steps (task, n, position, text, state, word, at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(taskKey, n, orderAt(db, taskKey, index === undefined ? count : index), text, state, word, at);
  return n;
}

const setStep = (db, taskKey, n, state, word, at) => db.stmt('UPDATE steps SET state = ?, word = ?, at = ? WHERE task = ? AND n = ?')
  .run(state, word ?? null, at ?? null, taskKey, n);

/* Promote's move of the list onto a side track: the rows go, their numbers stay spent. */
export function clearSteps(db, taskKey) {
  db.stmt(`INSERT INTO step_tops (task, top) SELECT ?, coalesce(max(n), 0) FROM steps WHERE task = ?
    ON CONFLICT (task) DO UPDATE SET top = max(top, excluded.top)`).run(taskKey, taskKey);
  db.stmt('DELETE FROM steps WHERE task = ?').run(taskKey);
}

const checklistTask = (db, ref) => taskRec(db, ref);

/* A step named by its own number. */
function stepNumbered(items, item, id) {
  const n = Number(item);
  const i = Number.isInteger(n) ? items.findIndex((s) => s.n === n) : -1;
  if (i < 0) throw new TrackRefusal(id + ' has no step ' + item + (items.length ? ' (its steps are ' + items.map((s) => s.n).join(', ') + ')' : ' (it has no steps)'));
  return i;
}

/* A place in the order shown, 1 first, up to `max`. */
function placeOf(items, place, id, max) {
  const p = Number(place);
  if (!Number.isInteger(p) || p < 1 || p > max) throw new TrackRefusal(id + ' has no place ' + place + ' in its steps (1 to ' + max + ')');
  return p - 1;
}

function checklistWrite(db, t, before, actor, note) {
  const c = actorOf(actor);
  const items = itemsOf(db, t.key);
  /* a checklist write is a change to the task, so its updated time moves (writeFront bumps the version) */
  writeFront(db, t, { updated: c.at }, TASK_KEYS);
  logLine(db, { at: c.at, verb: 'edit', kind: 'task', rec: headOf(t), changes: { checklist: [progressText(before), progressText(items)] }, by: c.by, pc: c.pc, note });
  return { id: t.fields.id, items, progress: progressText(items), did: checklistDid(before, items) };
}

/* What a checklist write did, counted ("added 3, checked 1"), for a reply that has no other change to name. */
function checklistDid(before, items) {
  const was = new Map(before.map((s) => [s.n, s]));
  const n = { added: 0, checked: 0, unchecked: 0, struck: 0 };
  for (const s of items) {
    const b = was.get(s.n);
    if (!b) n.added++;
    else if (s.struck !== undefined && b.struck === undefined) n.struck++;
    else if (s.done && (!b.done || b.struck !== undefined)) n.checked++;
    else if (!s.done && b.done) n.unchecked++;
  }
  return Object.entries(n).filter(([, v]) => v).map(([k, v]) => k + ' ' + v).join(', ');
}

export function addItem(db, input, actor) {
  const text = needText(input && input.text, 'a checklist item');
  return tx(db, () => {
    const t = checklistTask(db, input.task);
    const before = itemsOf(db, t.key);
    const index = input.at === undefined ? before.length : placeOf(before, input.at, t.fields.id, before.length + 1);
    const n = insertStep(db, t.key, { text, index });
    return { ...checklistWrite(db, t, before, actor, 'added ' + n + ': ' + text), n };
  });
}

export function checkItem(db, input, actor) {
  return tx(db, () => {
    const t = checklistTask(db, input && input.task);
    const before = itemsOf(db, t.key);
    const s = before[stepNumbered(before, input.item, t.fields.id)];
    const done = input.done !== false;
    if (s.done === done && !s.struck) return { id: t.fields.id, items: before, progress: progressText(before) };
    /* checking or unchecking a struck step lifts the strike */
    setStep(db, t.key, s.n, done ? 'done' : 'open', null, done ? actorOf(actor).at : null);
    return checklistWrite(db, t, before, actor, (done ? 'checked ' : 'unchecked ') + s.n + ': ' + s.text);
  });
}

/* A step that will not be done, with a word why: settled, never shown as open. */
export function strikeItem(db, input, actor) {
  const why = needText(input && input.why, 'striking a step', 'why');
  return tx(db, () => {
    const t = checklistTask(db, input.task);
    const before = itemsOf(db, t.key);
    const s = before[stepNumbered(before, input.item, t.fields.id)];
    setStep(db, t.key, s.n, 'struck', why, actorOf(actor).at);
    return checklistWrite(db, t, before, actor, 'struck ' + s.n + ': ' + s.text + ' (' + why + ')');
  });
}

/* checks.done names a step by number, or { step, word } for a done step with a word */
const doneEntry = (d) => (d && typeof d === 'object' && !Array.isArray(d) ? { step: d.step, word: d.word } : { step: d });

/* task_update's checks in one write: strike and done by the steps' own numbers, then add. */
export function settleChecks(db, taskRef, checks, actor) {
  const p = checks && typeof checks === 'object' && !Array.isArray(checks) ? checks : null;
  if (!p) throw new TrackRefusal('checks is { add: [step texts], done: [numbers, or { step, word }], strike: [{ step, why }] }');
  const stray = Object.keys(p).filter((k) => !['add', 'done', 'strike'].includes(k));
  if (stray.length) throw new TrackRefusal('checks takes add, done and strike, not ' + stray.join(', '));
  const list = (k) => (p[k] === undefined ? [] : Array.isArray(p[k]) ? p[k] : [p[k]]);
  const t = checklistTask(db, taskRef);
  const at = actorOf(actor).at;
  const before = itemsOf(db, t.key);
  const said = [];
  for (const d of list('done').map(doneEntry)) {
    const s = before[stepNumbered(before, d.step, t.fields.id)];
    const word = d.word === undefined ? null : needText(d.word, 'the word on step ' + d.step, 'word');
    if (s.done && !s.struck && (word === null || word === s.word)) continue;
    setStep(db, t.key, s.n, 'done', word, at);
    said.push('checked ' + s.n + ': ' + s.text + (word ? ' (' + word + ')' : ''));
  }
  for (const x of list('strike')) {
    if (!x || typeof x !== 'object') throw new TrackRefusal('checks.strike is a list of { step, why }: the step\'s number and a word why');
    const s = before[stepNumbered(before, x.step, t.fields.id)];
    const why = needText(x.why, 'striking step ' + x.step, 'why');
    setStep(db, t.key, s.n, 'struck', why, at);
    said.push('struck ' + s.n + ': ' + s.text + ' (' + why + ')');
  }
  for (const text of list('add')) {
    const line = needText(text, 'a checklist item');
    said.push('added ' + insertStep(db, t.key, { text: line }) + ': ' + line);
  }
  if (!said.length) return { id: t.fields.id, items: before, progress: progressText(before) };
  return checklistWrite(db, t, before, actor, said.join('; '));
}

/* `item` is the step's number; `to` is a place in the order shown. */
export function moveItem(db, input, actor) {
  return tx(db, () => {
    const t = checklistTask(db, input && input.task);
    checkVersion(t, input.version);
    const before = itemsOf(db, t.key);
    const s = before[stepNumbered(before, input.item, t.fields.id)];
    const to = placeOf(before, input.to, t.fields.id, before.length);
    db.stmt('UPDATE steps SET position = ? WHERE task = ? AND n = ?').run(orderAt(db, t.key, to, s.n), t.key, s.n);
    return checklistWrite(db, t, before, actor, 'moved ' + s.n + ' to place ' + (to + 1) + ': ' + s.text);
  });
}

/* Done of total wherever the task shows. */
export function progressOf(db, taskKey) {
  const g = loadGraph(db, [taskKey]);
  const n = g.nodes.get(taskKey);
  const p = n && n.checklist;
  return p ? { done: p.done, total: p.total, text: p.done + ' of ' + p.total } : null;
}
