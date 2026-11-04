/* The task graph: "depends on" edges, now, ready, waits on, the
   critical path and checklists, plus the helpers the track verbs share. What is
   derived is computed from the tables when read and never stored. */
import { readTx, tx } from '../db.mjs';
import { KEY_ORDERS, actorOf, isKey, labelOf, logVerb, putRecord } from '../records.mjs';
import { resolveRecord } from './labels.mjs';
import { shortName } from '../web/graph.mjs';

export class TrackRefusal extends Error {
  constructor(message, data) {
    super(message);
    this.name = 'TrackRefusal';
    if (data) this.data = data;
  }
}

/* ---- shared helpers ------------------------------------------------------- */

export const ENDED_TASK = Object.freeze(['completed', 'dropped']);
const ENDED_QUESTION = ['answered', 'dropped'];
const ACTIVE_SIDE = ['open', 'parked'];

/* Today's task key order: `inHandSince` and `agent`, the now set's tag, after inHand. */
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
    if (k === 'updated' || k === 'closed' || k === 'inHandSince') continue;
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

/* A task's promoted side track in one of `statuses`, or undefined. */
export function sideOf(db, taskKey, statuses = ACTIVE_SIDE) {
  return db.stmt(`SELECT s.key, s.label, s.status FROM links l JOIN records s ON s.key = l."from" AND s.kind = 'track'
    AND json_extract(s.fields, '$.origin') = 'promote' AND s.status IN (SELECT value FROM json_each(?))
    WHERE l."to" = ? AND l.type = 'junction'`).get(JSON.stringify(statuses), taskKey);
}

/* ---- loading the graph ---------------------------------------------------- */

const IN = 'SELECT value FROM json_each(?)';

/* The seeds and everything upstream that is still open: "depends on" edges,
   and a promoted task's side track, whose tasks its done waits on. */
function closure(db, seeds) {
  return db.stmt(`WITH RECURSIVE c(k) AS (
      ${IN}
      UNION
      SELECT d."on" FROM c JOIN records r ON r.key = c.k JOIN depends d ON d.task = c.k
        WHERE coalesce(r.status, '') NOT IN ('completed', 'dropped')
      UNION
      SELECT ti.task FROM c JOIN links l ON l."to" = c.k AND l.type = 'junction'
        JOIN records s ON s.key = l."from" AND s.kind = 'track' AND json_extract(s.fields, '$.origin') = 'promote'
          AND s.status IN ('open', 'parked')
        JOIN track_items ti ON ti.track = s.key
    ) SELECT k FROM c`).all(JSON.stringify(seeds)).map((r) => r.k);
}

/* Everything the views need, in a handful of indexed reads. */
export function loadGraph(db, seeds) {
  const keys = closure(db, seeds);
  const J = JSON.stringify(keys);
  const nodes = new Map();
  for (const r of db.stmt(`SELECT r.key, r.label, r.title, r.status, json_extract(r.fields, '$.agent') AS agent,
      json_extract(r.fields, '$.inHand') AS inHand, ti.track, ti.position
      FROM records r LEFT JOIN track_items ti ON ti.task = r.key WHERE r.key IN (${IN}) AND r.kind = 'task'`).all(J)) {
    nodes.set(r.key, {
      key: r.key, id: r.label, name: r.title, status: r.status, agent: r.agent || null, inHand: r.inHand || null,
      track: r.track || null, position: r.position ?? Infinity, deps: [], side: null, sideDone: false, gates: [], checklist: null, progress: null,
    });
  }
  for (const e of db.stmt(`SELECT task, "on" FROM depends WHERE task IN (${IN})`).all(J)) {
    const n = nodes.get(e.task);
    if (n && nodes.has(e.on)) n.deps.push(e.on);
  }
  for (const p of db.stmt(`SELECT l."to" AS task, s.key, s.status,
      (SELECT count(*) FROM track_items ti JOIN records t ON t.key = ti.task WHERE ti.track = s.key AND t.status <> 'dropped') AS total,
      (SELECT count(*) FROM track_items ti JOIN records t ON t.key = ti.task WHERE ti.track = s.key AND t.status = 'completed') AS done
      FROM links l JOIN records s ON s.key = l."from" AND s.kind = 'track' AND json_extract(s.fields, '$.origin') = 'promote'
      WHERE l.type = 'junction' AND l."to" IN (${IN})`).all(J)) {
    const n = nodes.get(p.task);
    if (!n) continue;
    if (ACTIVE_SIDE.includes(p.status)) n.side = p.key;
    if (p.status === 'done') n.sideDone = true;
    if (ACTIVE_SIDE.includes(p.status) || p.status === 'done') n.progress = { done: p.done, total: p.total, track: p.key };
  }
  for (const q of db.stmt(`SELECT t.value AS task, q.label FROM json_each(?) t
      JOIN links l ON l.type = 'gates' AND (l."to" = t.value OR l."to" IN (SELECT label FROM labels WHERE key = t.value))
      JOIN records q ON q.key = l."from" AND q.kind = 'question'
      WHERE coalesce(q.status, '') NOT IN (${ENDED_QUESTION.map((s) => "'" + s + "'").join(', ')})`).all(J)) {
    const n = nodes.get(q.task);
    if (n && !n.gates.includes(q.label)) n.gates.push(q.label);
  }
  for (const c of db.stmt(`SELECT task, count(*) AS total, sum(done) AS done FROM checklist WHERE task IN (${IN}) GROUP BY task`).all(J)) {
    const n = nodes.get(c.task);
    if (n) n.checklist = { done: c.done, total: c.total };
  }
  const trackKeys = [...new Set([...nodes.values()].flatMap((n) => [n.track, n.side]).filter(Boolean))];
  const TJ = JSON.stringify(trackKeys);
  const tracks = new Map();
  for (const t of db.stmt(`SELECT key, label, title, status FROM records WHERE key IN (${IN})`).all(TJ)) {
    tracks.set(t.key, { key: t.key, id: t.label, name: t.title, status: t.status, holder: null });
  }
  for (const l of db.stmt(`SELECT track, session FROM leases WHERE track IN (${IN})`).all(TJ)) {
    if (tracks.has(l.track)) tracks.get(l.track).holder = l.session;
  }
  return { nodes, tracks };
}

/* ---- what the graph says -------------------------------------------------- */

export const statusOf = (n) => (n.sideDone ? 'completed' : n.status);
export const isEnded = (n) => ENDED_TASK.includes(statusOf(n));

/* A promoted task waits on every task of its side track. */
function depsOf(g, n) {
  if (!n.side) return n.deps;
  const side = [...g.nodes.values()].filter((m) => m.track === n.side).map((m) => m.key);
  return n.deps.concat(side.filter((k) => !n.deps.includes(k)));
}

export function isReady(g, n) {
  if (statusOf(n) !== 'open' || n.side || n.gates.length) return false;
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
  if (n.side) out.push('after ' + trackLabel(g, n.side));
  for (const q of n.gates) out.push('after ' + q);
  return out;
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
  if (n.side) out.push('its side track ' + named(trackLabel(g, n.side), (g.tracks.get(n.side) || {}).name));
  const title = db.stmt("SELECT title FROM records WHERE kind = 'question' AND label = ? ORDER BY id DESC LIMIT 1");
  for (const q of n.gates) out.push(named(q, (title.get(q) || {}).title));
  return out.length ? 'after ' + out.join('; ') : '';
}

/* The longest chain of open tasks ending at `key`; a promoted task adds no
   length of its own, its side track's tasks are the work. */
function chainTo(g, key, memo, path = new Set()) {
  if (memo.has(key)) return memo.get(key);
  const n = g.nodes.get(key);
  if (!n || isEnded(n)) return { length: 0, path: [] };
  if (path.has(key)) throw new TrackRefusal('the graph holds a loop through ' + n.id);
  path.add(key);
  let best = { length: 0, path: [] };
  for (const k of depsOf(g, n)) {
    const r = chainTo(g, k, memo, path);
    if (r.length > best.length) best = r;
  }
  path.delete(key);
  const own = n.side ? 0 : 1;
  const out = { length: best.length + own, path: own ? best.path.concat(key) : best.path };
  memo.set(key, out);
  return out;
}

/* Columns by dependency depth: every open task sits right of what it waits on. */
function columnOf(g, key, memo) {
  if (memo.has(key)) return memo.get(key);
  memo.set(key, 0);
  const n = g.nodes.get(key);
  let c = 0;
  for (const k of depsOf(g, n)) if (!isEnded(g.nodes.get(k))) c = Math.max(c, columnOf(g, k, memo) + 1);
  memo.set(key, c);
  return c;
}

/* One track's view: now with its agents, ready, the critical path, and its
   open tasks in dependency order (position breaks ties). */
export function trackGraph(db, trackKey) {
  return readTx(db, () => {
    const seeds = db.stmt('SELECT task FROM track_items WHERE track = ? ORDER BY position').all(trackKey).map((r) => r.task);
    const g = loadGraph(db, seeds);
    const holder = (g.tracks.get(trackKey) || {}).holder || null;
    const mine = seeds.map((k) => g.nodes.get(k)).filter(Boolean);
    const open = mine.filter((n) => !isEnded(n));
    const brief = (n) => ({ id: n.id, key: n.key, name: n.name });
    const tagOf = (n) => (n.agent ? { agent: n.agent } : n.inHand || holder ? { session: n.inHand || holder } : {});
    /* a promoted task's work is its side track's, so it is not running itself */
    const now = open.filter((n) => statusOf(n) === 'in_progress' && !n.side).map((n) => ({ ...brief(n), ...tagOf(n) }));
    const ready = open.filter((n) => isReady(g, n)).map(brief);
    const memo = new Map();
    let critical = { length: 0, path: [] };
    for (const n of open) {
      const r = chainTo(g, n.key, memo);
      if (r.length > critical.length) critical = r;
    }
    const cols = new Map();
    const tasks = open.map((n) => ({ n, col: columnOf(g, n.key, cols) }))
      .sort((a, b) => a.col - b.col || a.n.position - b.n.position)
      .map(({ n, col }) => {
        const t = { ...brief(n), status: statusOf(n), column: col, ready: isReady(g, n), waitsOn: waitsOn(g, n) };
        if (statusOf(n) === 'in_progress') Object.assign(t, tagOf(n));
        if (n.side || n.progress) t.pointer = trackLabel(g, (n.progress || {}).track || n.side);
        const p = n.progress || n.checklist;
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

/* One task: ready or what holds it. */
export function readiness(db, taskKey) {
  return readTx(db, () => {
    const g = loadGraph(db, [taskKey]);
    const n = g.nodes.get(taskKey);
    if (!n) throw new TrackRefusal('no task ' + taskKey);
    return { id: n.id, status: statusOf(n), ready: isReady(g, n), waitsOn: waitsOn(g, n), held: waitsNamed(db, g, n), pointer: n.side ? trackLabel(g, n.side) : null };
  });
}

/* ---- edges ---------------------------------------------------------------- */

/* Upstream neighbours, every status: a loop through done work is still a loop. */
function upstream(db, key) {
  const out = db.stmt('SELECT "on" AS k FROM depends WHERE task = ?').all(key).map((r) => r.k);
  for (const r of db.stmt(`SELECT ti.task AS k FROM links l JOIN records s ON s.key = l."from" AND s.kind = 'track'
      AND json_extract(s.fields, '$.origin') = 'promote' AND s.status IN ('open', 'parked')
      JOIN track_items ti ON ti.track = s.key WHERE l."to" = ? AND l.type = 'junction'`).all(key)) out.push(r.k);
  return out;
}

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

/* In progress, with the agent working it. A task that is not ready takes a
   reason, logged; when the edge was simply wrong, remove it instead. */
export function startTask(db, input, actor) {
  return tx(db, () => {
    const t = taskRec(db, input && input.task);
    const r = readiness(db, t.key);
    if (r.pointer) throw new TrackRefusal(t.fields.id + ' is promoted: its work is ' + r.pointer + "'s tasks");
    if (ENDED_TASK.includes(r.status)) throw new TrackRefusal(t.fields.id + ' is ' + r.status);
    const reason = typeof input.reason === 'string' && input.reason.trim() ? input.reason.trim() : '';
    if (r.status === 'open' && !r.ready && !reason) {
      throw new TrackRefusal(t.fields.id + ' is not ready (' + r.held + '): give a reason to start it anyway, or remove the edge that is wrong',
        { waitsOn: r.waitsOn });
    }
    const agent = typeof input.agent === 'string' && input.agent.trim() ? input.agent.trim() : undefined;
    const c = actorOf(actor);
    const at = c.at;
    /* a start without an agent drops an old tag */
    const changes = { status: 'in_progress', updated: at, agent };
    /* the starting session follows the task, so its questions inherit the workstream; never in hand */
    const subs = Array.isArray(t.fields.subscribers) ? t.fields.subscribers : [];
    if (c.session && !subs.includes(c.session)) changes.subscribers = [...subs, c.session];
    const diff = writeFront(db, t, changes, TASK_KEYS);
    if (Object.keys(diff).length || reason) {
      logLine(db, { at, verb: 'edit', kind: 'task', rec: headOf(t), changes: diff, by: c.by, pc: c.pc, note: reason ? 'started before ready: ' + reason : undefined });
    }
    return { id: t.fields.id, key: t.key, status: 'in_progress', agent: t.fields.agent || null, ready: r.ready };
  });
}

/* ---- checklists ----------------------------------------------------------- */

export function itemsOf(db, taskKey) {
  return db.stmt('SELECT position, text, done, done_at FROM checklist WHERE task = ? ORDER BY position').all(taskKey)
    .map((r, i) => ({ n: i + 1, text: r.text, done: r.done === 1, doneAt: r.done_at || null }));
}

const progressText = (items) => (items.length ? items.filter((i) => i.done).length + ' of ' + items.length : null);

/* Rewritten whole: positions stay 0..n-1 and a list is a handful of rows. */
export function writeItems(db, taskKey, items) {
  db.stmt('DELETE FROM checklist WHERE task = ?').run(taskKey);
  const add = db.stmt('INSERT INTO checklist (task, position, text, done, done_at) VALUES (?, ?, ?, ?, ?)');
  items.forEach((it, i) => add.run(taskKey, i, it.text, it.done ? 1 : 0, it.done ? it.doneAt || null : null));
}

function checklistTask(db, ref) {
  const t = taskRec(db, ref);
  const side = sideOf(db, t.key);
  if (side) throw new TrackRefusal(t.fields.id + ' is promoted: its steps are ' + side.label + "'s tasks now");
  return t;
}

function itemAt(items, item, id) {
  const n = Number(item);
  if (!Number.isInteger(n) || n < 1 || n > items.length) throw new TrackRefusal(id + ' has no checklist item ' + item + ' (it has ' + items.length + ')');
  return n - 1;
}

function checklistWrite(db, t, before, items, actor, note) {
  const c = actorOf(actor);
  const at = c.at;
  writeItems(db, t.key, items);
  bumpVersion(db, t.key);
  logLine(db, { at, verb: 'edit', kind: 'task', rec: headOf(t), changes: { checklist: [progressText(before), progressText(items)] }, by: c.by, pc: c.pc, note });
  return { id: t.fields.id, items, progress: progressText(items) };
}

export function addItem(db, input, actor) {
  const text = needText(input && input.text, 'a checklist item');
  return tx(db, () => {
    const t = checklistTask(db, input.task);
    const before = itemsOf(db, t.key);
    const items = before.slice();
    const at = input.at === undefined ? items.length : itemAt(items.concat([null]), input.at, t.fields.id);
    items.splice(at, 0, { text, done: false });
    return checklistWrite(db, t, before, items, actor, 'added: ' + text);
  });
}

export function checkItem(db, input, actor) {
  return tx(db, () => {
    const t = checklistTask(db, input && input.task);
    const before = itemsOf(db, t.key);
    const i = itemAt(before, input.item, t.fields.id);
    const done = input.done !== false;
    if (before[i].done === done) return { id: t.fields.id, items: before, progress: progressText(before) };
    const items = before.map((it, j) => (j === i ? { ...it, done, doneAt: done ? actorOf(actor).at : null } : it));
    return checklistWrite(db, t, before, items, actor, (done ? 'checked: ' : 'unchecked: ') + before[i].text);
  });
}

export function moveItem(db, input, actor) {
  return tx(db, () => {
    const t = checklistTask(db, input && input.task);
    checkVersion(t, input.version);
    const before = itemsOf(db, t.key);
    const from = itemAt(before, input.item, t.fields.id);
    const to = itemAt(before, input.to, t.fields.id);
    const items = before.slice();
    const [it] = items.splice(from, 1);
    items.splice(to, 0, it);
    return checklistWrite(db, t, before, items, actor, 'moved to ' + (to + 1) + ': ' + it.text);
  });
}

/* Done of total wherever the task shows; a promoted task shows its side track's. */
export function progressOf(db, taskKey) {
  const g = loadGraph(db, [taskKey]);
  const n = g.nodes.get(taskKey);
  const p = n && (n.progress || n.checklist);
  return p ? { done: p.done, total: p.total, text: p.done + ' of ' + p.total } : null;
}
