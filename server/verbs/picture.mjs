/* The board picture: the proposal files onto a
   board in one transaction, refused whole with nothing written. A dry run rolls back; a rerun
   of corrected files writes only what changed, undoing the picture's own earlier writes. */
import { afterTask } from './coverage.mjs';
import { tx } from '../db.mjs';
import { actorOf, addNote, guardHeadings, isKey, labelOf } from '../records.mjs';
import {
  ENDED_TASK, TASK_KEYS, TrackRefusal, bumpVersion, headOf, loadRecord, logLine, pathBetween, sideOf, writeFront,
} from './graph.mjs';
import { lineName as named, resolveRecord } from './labels.mjs';
import { wakeLinked } from './questions.mjs';
import { TIE, TRACK_KEYS, dropTrack, finishTrack, holderPlain, junctionWants, makeTrack, putOnTrack, setStatus, splinter, tieToJunction } from './tracks.mjs';
import { closeRecord, createRecord, reopenRecord } from './work.mjs';
import { whenText } from './upkeep.mjs';

const IMPORTED = 'from import';
/* every write's note, and the reason of every link the picture draws, so a rerun knows its own */
const CAUSE = 'board picture: ';
const ours = (s) => String(s || '').startsWith(CAUSE);
const WANT = { open: 'open', done: 'completed', drop: 'dropped' };
const OPEN_TRACK = ['open', 'parked'];
const STEP = /^(P-\d+) (s\d+)$/;
const LABEL = /^[A-Z]+-\d+$/;

const one = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const same = (a, b) => one(a).toLowerCase() === one(b).toLowerCase();
/* "T-255 (WS-7)" names `T-255` */
const bare = (s) => one(s).replace(/\s*\([^)]*\)$/, '');
const list = (v) => (Array.isArray(v) ? v : []);
const pairOf = (task, on) => task + '>' + on;

function filesOf(input) {
  const f = input && input.files;
  const named = Array.isArray(f) ? f.map((x) => [x && x.name, x && x.data]) : f && typeof f === 'object' ? Object.entries(f) : [];
  if (!named.length) throw new TrackRefusal('applyPicture needs files: { "<name>.json": <its JSON>, ... }');
  return named.map(([name, data]) => {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new TrackRefusal(String(name) + ' is not a proposal file (a JSON object)');
    return { name: String(name), data };
  });
}

/* ---- reading the files against the board (no writes) ---------------------- */

const byField = (db, field, value) => db.stmt(`SELECT key FROM records WHERE kind = 'task' AND json_extract(fields, '$.' || ?) = ?`)
  .all(field, value).map((r) => r.key);
const trackOf = (db, task) => (db.stmt('SELECT track FROM track_items WHERE task = ?').get(task) || {}).track || null;
const leaseOn = (db, track) => db.stmt('SELECT session, pc, since, seen FROM leases WHERE track = ?').get(track);
const tasksOn = (db, track) => db.stmt('SELECT task FROM track_items WHERE track = ? ORDER BY position').all(track).map((r) => r.task);
const atOf = (db, side) => (db.stmt(`SELECT l."to" AS k FROM links l JOIN records r ON r.key = l."to" AND r.kind = 'task'
  WHERE l."from" = ? AND l.type = 'junction'`).get(side) || {}).k || null;

/* [was, now] of the record's last write of a field, when the picture made that write and
   it was no undo (an undo stands, so a rerun never flips it back) */
const BACK = CAUSE + 'as it was before the picture';
function byPicture(db, key, field) {
  const r = db.stmt(`SELECT json_extract(line, '$.note') AS note, json_extract(line, '$.changes.' || ?) AS ch FROM activity
    WHERE record = ? AND json_extract(line, '$.changes.' || ?) IS NOT NULL ORDER BY seq DESC LIMIT 1`).get(field, key, field);
  return r && ours(r.note) && r.note !== BACK ? JSON.parse(r.ch) : null;
}

/* The open track a line already has: by label, by name where it sits (its workstream,
   or its parent's side tracks), else the one the picture made for a line of this file
   that the files renamed: the untaken one holding most of the line's tasks. */
function lineTrack(db, l, taken) {
  if (l.trackKey) return l.trackKey;
  let rows;
  if (l.kind === 'main') {
    if (!l.wsKey) return null;
    rows = db.stmt("SELECT key FROM records WHERE kind = 'track' AND workstream = ? ORDER BY id").all(l.wsKey);
  } else {
    const parent = l.parentLine ? l.parentLine.found : l.parentKey;
    if (!parent) return null;
    rows = db.stmt(`SELECT l."from" AS key FROM links l JOIN records r ON r.key = l."from" AND r.kind = 'track'
      WHERE l."to" = ? AND l.type = 'junction'`).all(parent);
  }
  const open = rows.map((r) => loadRecord(db, r.key)).filter((r) => OPEN_TRACK.includes(r.fields.status));
  const hit = open.find((r) => same(r.fields.name, l.name));
  if (hit) return hit.key;
  const score = (r) => {
    const on = new Set(tasksOn(db, r.key));
    return l.placed.filter((k) => on.has(k)).length + (l.junctionKey && atOf(db, r.key) === l.junctionKey ? 1 : 0);
  };
  const best = open.filter((r) => r.fields.pictureFile === l.file && !taken(r) && (l.kind === 'side') === (r.fields.origin === 'splinter'))
    .map((r) => [r.key, score(r)]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  return best.length && (best.length === 1 || best[0][1] > best[1][1]) ? best[0][0] : null;
}

function readPicture(db, files) {
  const problems = [];
  const lines = new Map();
  const tasks = new Map();
  const proposed = new Map();
  const edges = new Map();
  const keep = [];
  const wsVerdicts = [];
  const declared = new Map(files.flatMap((f) => list(f.data.proposedTasks).map((p) => [one(p.key), f.name])));

  /* a ref to a task key, 'new:<key>' for a proposal not made yet, or null with a problem */
  const refs = new Map();
  const task = (raw, where) => {
    const ref = bare(raw);
    if (refs.has(ref)) return refs.get(ref);
    let out = null;
    const step = STEP.exec(ref);
    if (step) {
      const hits = byField(db, 'fromStep', step[1] + '/' + step[2]);
      if (hits.length === 1) out = hits[0];
      else problems.push(where + ' names ' + ref + ': ' + (hits.length ? hits.length + ' tasks claim that step' : 'no task the import made from that step'));
    } else if (declared.has(ref)) {
      out = byField(db, 'pictureKey', ref)[0] || 'new:' + ref;
    } else {
      const e = LABEL.test(ref) ? resolveRecord(db, ref, { kinds: ['task'] }) : null;
      if (!e) problems.push(where + ' names ' + ref + ', which resolves to no task');
      else if (e.front.fromStep) problems.push(where + ' names ' + ref + ', which here is the task the import made from ' + e.front.fromStep + '; name the step instead');
      else out = e.key;
    }
    refs.set(ref, out);
    return out;
  };
  const record = (ref, kind, where) => {
    const e = resolveRecord(db, bare(ref), { kinds: [kind] });
    if (!e) problems.push(where + ' names ' + bare(ref) + ', which resolves to no ' + kind);
    return e;
  };

  /* lines */
  for (const f of files) {
    for (const raw of list(f.data.lines)) {
      const name = one(raw.name);
      const where = f.name + ' line "' + name + '"';
      if (!name) { problems.push(f.name + ' has a line with no name'); continue; }
      if (lines.has(name)) { problems.push(where + ' is drawn twice (' + lines.get(name).file + ' too)'); continue; }
      if (!['main', 'side'].includes(raw.kind)) problems.push(where + ' is main or side, not ' + raw.kind);
      const l = {
        name, file: f.name, kind: raw.kind, status: raw.status || null, parkReason: raw.parkReason ? one(raw.parkReason) : null,
        unparkWhen: raw.unparkWhen || null, parentRef: raw.parent || null, junctionRef: raw.junction || null, placed: [],
        wsRef: raw.workstream || null,
      };
      if (raw.track) {
        const t = record(raw.track, 'track', where);
        if (t && !OPEN_TRACK.includes(t.front.status)) problems.push(where + ' names ' + raw.track + ', which is ' + t.front.status);
        if (t) { l.trackKey = t.key; l.wsKey = t.front.workstream; }
      }
      if (raw.kind === 'side' && !raw.parent) problems.push(where + ' is a side line with no parent');
      if (raw.junction) l.junctionKey = task(raw.junction, where + "'s junction");
      lines.set(name, l);
    }
  }
  for (const l of lines.values()) {
    if (!l.parentRef) continue;
    const where = l.file + ' line "' + l.name + '"';
    if (LABEL.test(one(l.parentRef))) {
      const t = record(l.parentRef, 'track', where + "'s parent");
      if (t) {
        l.parentLine = [...lines.values()].find((x) => x.trackKey === t.key) || null;
        if (!l.parentLine) l.parentKey = t.key;
      }
    } else if (lines.has(one(l.parentRef))) l.parentLine = lines.get(one(l.parentRef));
    else problems.push(where + "'s parent " + l.parentRef + ' is no line of the files and no track');
  }

  /* tasks and proposals, in file order */
  const lineOf = (f, name, where, open) => {
    if (name === 'inbox') return 'inbox';
    if (name === null || name === undefined) {
      if (open) problems.push(where + ' is open and left on no line');
      return null;
    }
    const l = lines.get(one(name));
    if (!l || l.file !== f.name) { problems.push(where + ' is put on "' + name + '", which its file does not draw'); return null; }
    return l;
  };
  const wait = (key, on, why, f, where) => {
    if (!key || !on) return;
    if (key === on) { problems.push(where + ' waits on itself'); return; }
    const back = edges.get(pairOf(on, key));
    if (back && back.file !== f.name) {
      problems.push(back.file + ' has ' + label(db, on) + ' waiting on ' + label(db, key) + ', and ' + f.name + ' the opposite');
      back.contradicted = true;
      return;
    }
    if (!edges.has(pairOf(key, on))) edges.set(pairOf(key, on), { task: key, on, why: one(why) || 'drawn in ' + f.name, file: f.name });
  };
  const allPlaced = [];
  for (const f of files) {
    for (const s of Object.keys(f.data.stepRefs || {})) task(s, f.name + ' stepRefs');
    for (const raw of list(f.data.tasks)) {
      const where = f.name + ' ' + one(raw.id);
      const key = task(raw.id, f.name);
      if (!(raw.verdict in WANT)) problems.push(where + "'s verdict is open, done or drop, not " + raw.verdict);
      const line = lineOf(f, raw.line, where, raw.verdict === 'open');
      if (!key) continue;
      for (const w of list(raw.waitsOn)) wait(key, task(w.on, where + ' waitsOn'), w.why, f, where);
      const seen = tasks.get(key);
      if (seen) {
        if (seen.lineName !== (raw.line ?? null)) problems.push(seen.file + ' puts ' + one(raw.id) + ' on "' + seen.lineName + '", ' + f.name + ' on "' + raw.line + '"');
        if (seen.verdict !== raw.verdict) problems.push(seen.file + ' says ' + one(raw.id) + ' is ' + seen.verdict + ', ' + f.name + ' ' + raw.verdict);
        continue;
      }
      tasks.set(key, { key, id: one(raw.id), file: f.name, verdict: raw.verdict, evidence: one(raw.evidence), line, lineName: raw.line ?? null });
      if (line && line !== 'inbox') { line.placed.push(key); allPlaced.push(key); }
    }
    for (const p of list(f.data.proposedTasks)) {
      const pkey = one(p.key);
      const where = f.name + ' proposed ' + pkey;
      if (proposed.has(pkey)) { problems.push(where + ' is proposed twice'); continue; }
      const line = lineOf(f, p.line, where, true);
      const key = task(pkey, where);
      proposed.set(pkey, { pkey, file: f.name, name: one(p.name), why: one(p.why), line });
      if (line && line !== 'inbox' && key) { line.placed.push(key); allPlaced.push(key); }
      for (const w of list(p.waitsOn)) wait(key, task(w.on, where + ' waitsOn'), w.why, f, where);
    }
  }
  for (const f of files) {
    for (const x of list(f.data.crossLinks)) wait(task(x.task, f.name + ' crossLinks'), task(x.on, f.name + ' crossLinks'), x.why, f, f.name + ' crossLinks ' + one(x.task));
    for (const k of list(f.data.importEdges && f.data.importEdges.keepWithReason)) {
      const a = task(k.task, f.name + ' importEdges');
      const b = task(k.on, f.name + ' importEdges');
      if (a && b) keep.push({ task: a, on: b });
    }
    for (const v of list(f.data.workstreamVerdicts)) wsVerdicts.push(verdictOf(db, f, v, problems));
  }

  /* each line's workstream: its parent's, its tracks', or named (the line's, or the file's only one) */
  const fileData = new Map(files.map((f) => [f.name, f.data]));
  const wsOfLine = (l) => {
    if (l.wsKey !== undefined) return l.wsKey;
    const where = l.file + ' line "' + l.name + '"';
    if (l.kind === 'side') l.wsKey = l.parentLine ? wsOfLine(l.parentLine) : l.parentKey ? loadRecord(db, l.parentKey).fields.workstream : null;
    else if (l.wsRef) l.wsKey = (record(l.wsRef, 'workstream', where) || {}).key || null;
    else {
      const ws = new Set(l.placed.filter((k) => !k.startsWith('new:')).map((k) => loadRecord(db, k).fields.workstream).filter(Boolean));
      const only = list(fileData.get(l.file).workstreams);
      if (!ws.size && only.length === 1) ws.add((record(only[0], 'workstream', l.file + ' workstreams') || {}).key);
      if (ws.size !== 1 || ws.has(undefined)) {
        problems.push(where + ' is new and its tasks sit in ' + (ws.size > 1 ? ws.size + ' workstreams' : 'no workstream') + ': give the line a workstream');
      }
      l.wsKey = ws.size === 1 ? [...ws][0] || null : null;
    }
    return l.wsKey;
  };

  /* mains, then sides once their parent is in */
  const all = [...lines.values()];
  const order = all.filter((l) => l.kind === 'main');
  while (order.length < all.length) {
    const next = all.filter((l) => !order.includes(l) && (!l.parentLine || order.includes(l.parentLine)));
    if (!next.length) { problems.push('the side lines ' + all.filter((l) => !order.includes(l)).map((l) => l.name).join(', ') + " are each other's parents"); break; }
    order.push(...next);
  }

  /* each line's track; a track found, or named like a line of the files, is no line's rename */
  const names = new Set(all.map((l) => l.name.toLowerCase()));
  const found = new Set(all.map((l) => l.trackKey).filter(Boolean));
  const taken = (r) => found.has(r.key) || names.has(one(r.fields.name).toLowerCase());
  for (const l of order) {
    wsOfLine(l);
    l.found = lineTrack(db, l, taken);
    if (l.found) found.add(l.found);
  }

  /* what the picture made that the files no longer draw or propose */
  const fileNames = JSON.stringify(files.map((f) => f.name));
  const madeBy = (kind) => db.stmt(`SELECT key FROM records WHERE kind = ? AND json_extract(fields, '$.pictureFile') IN (SELECT value FROM json_each(?))`)
    .all(kind, fileNames).map((r) => loadRecord(db, r.key));
  const orphans = madeBy('track').filter((r) => OPEN_TRACK.includes(r.fields.status) && !found.has(r.key));
  const retired = madeBy('task').filter((r) => !declared.has(r.fields.pictureKey) && r.fields.status === 'open' && !r.fields.inHand && !r.fields.agent);
  const gone = new Set(retired.map((r) => r.key));

  /* what the files leave behind on a line */
  const placed = new Set(allPlaced);
  const leftOn = (key) => db.stmt(`SELECT r.key, r.label FROM track_items ti JOIN records r ON r.key = ti.task WHERE ti.track = ?
    AND coalesce(r.status, '') NOT IN ('completed', 'dropped') ORDER BY ti.position`).all(key).filter((r) => !tasks.has(r.key) && !placed.has(r.key) && !gone.has(r.key));
  const them = (left) => (left.length > 1 ? 'them' : 'it');
  for (const r of orphans) {
    const left = leftOn(r.key);
    if (left.length) problems.push(left.map((x) => x.label).join(', ') + ' open on ' + named(db, r.key) + ', a line the files no longer draw, and no file places ' + them(left));
  }
  for (const l of order) {
    const key = l.found;
    if (key) {
      const left = leftOn(key);
      if (left.length) problems.push(left.map((r) => r.label).join(', ') + ' open on "' + l.name + '" (' + labelOf(db, key) + '), and no file places ' + them(left));
    }
    if (l.junctionKey && l.junctionKey.startsWith('new:')) problems.push(l.file + ' line "' + l.name + '" branches at a proposed task; a junction is a task the board has');
    else if (l.junctionKey) {
      const parentKey = l.parentLine ? l.parentLine.found : l.parentKey;
      const sits = parentKey && trackOf(db, l.junctionKey) === parentKey;
      if (!sits && !(l.parentLine && l.parentLine.placed.includes(l.junctionKey))) {
        problems.push(l.file + ' line "' + l.name + '" branches at ' + label(db, l.junctionKey) + ', which is not on its parent and no file puts it there');
      }
    }
    if (l.unparkWhen) l.unpark = unparkOf(db, l, lines, task, problems);
  }

  /* loops, across the files and with the edges already on the board (the picture's own are redrawn) */
  const graph = new Map();
  const link = (a, b) => (graph.get(a) || graph.set(a, []).get(a)).push(b);
  for (const e of edges.values()) if (!e.contradicted) link(e.task, e.on);
  for (const e of db.stmt('SELECT task, "on" FROM depends WHERE reason <> ? AND substr(reason, 1, ?) <> ?').all(IMPORTED, CAUSE.length, CAUSE)) link(e.task, e.on);
  const drawn = new Set([...edges.values()].map((e) => pairOf(e.task, e.on)));
  for (const loop of loopsOf(graph)) {
    const pairs = loop.map((k, i) => pairOf(k, loop[(i + 1) % loop.length]));
    if (pairs.some((p) => drawn.has(p))) problems.push('a loop: ' + loop.concat(loop[0]).map((k) => label(db, k)).join(' waits on '));
  }

  if (problems.length) {
    const uniq = [...new Set(problems)];
    throw new TrackRefusal('the board picture was refused, nothing written:\n' + uniq.map((p) => '- ' + p).join('\n'), { problems: uniq });
  }
  return { lines, order, tasks, proposed, edges, keep, wsVerdicts, orphans, retired };
}

const label = (db, k) => (String(k).startsWith('new:') ? String(k).slice(4) : labelOf(db, k));

/* Each loop once, as the keys round it. */
function loopsOf(graph) {
  const seen = new Set();
  const out = [];
  const state = new Map();
  const stack = [];
  const visit = (k) => {
    state.set(k, 1);
    stack.push(k);
    for (const n of graph.get(k) || []) {
      if (state.get(n) === 1) {
        const loop = stack.slice(stack.indexOf(n));
        const id = [...loop].sort().join(' ');
        if (!seen.has(id)) { seen.add(id); out.push(loop); }
      } else if (!state.has(n)) visit(n);
    }
    stack.pop();
    state.set(k, 2);
  };
  for (const k of graph.keys()) if (!state.has(k)) visit(k);
  return out;
}

/* { lineEnds: <line>, taskCompletes: <task>, questionAnswered: <Q> } to the stored shape. */
function unparkOf(db, l, lines, task, problems) {
  const u = l.unparkWhen;
  const where = l.file + ' line "' + l.name + '" unparkWhen';
  if (u.lineEnds) {
    const other = lines.get(one(u.lineEnds));
    if (!other) { problems.push(where + ' names line ' + u.lineEnds + ', which no file draws'); return null; }
    return { kind: 'track-ends', line: other };
  }
  if (u.taskCompletes) { const k = task(u.taskCompletes, where); return k ? { kind: 'task-completes', task: k } : null; }
  if (u.questionAnswered) {
    const q = resolveRecord(db, bare(u.questionAnswered), { kinds: ['question'] });
    if (!q) { problems.push(where + ' names ' + u.questionAnswered + ', which resolves to no question'); return null; }
    return { kind: 'question-answered', on: q.key };
  }
  problems.push(where + ' is lineEnds, taskCompletes or questionAnswered');
  return null;
}

/* "WS-1 (work system build), WS-2" names records; a parenthesis picks the one the
   file's workstreams list keys, where two share a label. */
function verdictOf(db, f, v, problems) {
  const text = one(v.verdict).toLowerCase();
  const kind = text === 'close' ? 'close' : text === 'done' ? 'done' : text === 'stay open' ? 'stay open' : text.startsWith('closed') ? 'closed' : null;
  if (!kind) problems.push(f.name + ' workstream verdict ' + v.id + ' is close, done, stay open or closed, not ' + v.verdict);
  const heads = list(f.data.workstreams).map(one);
  const records = [];
  for (const part of one(v.id).split(/,\s*(?=[A-Z]+-\d)/)) {
    const m = /^([A-Z]+-\d+)(?:\s*\(([^)]*)\))?$/.exec(part);
    if (!m) { problems.push(f.name + ' workstream verdict names ' + part); continue; }
    let e = null;
    if (m[2]) {
      const head = heads.find((h) => h.startsWith(m[1] + ' (') && h.slice(m[1].length + 2).toLowerCase().startsWith(m[2].toLowerCase()));
      const key = head && (head.slice(m[1].length).match(/\b[0-9a-z]{8}\b/g) || []).find(isKey);
      e = key ? resolveRecord(db, key, { kinds: ['workstream', 'track'] }) : null;
    } else e = resolveRecord(db, m[1], { kinds: ['workstream', 'track'] });
    if (!e) problems.push(f.name + ' workstream verdict names ' + part + ', which resolves to no workstream or track');
    else records.push({ key: e.key, kind: e.kind, label: m[1] });
  }
  return { kind, why: one(v.why), records, file: f.name };
}

/* ---- the writes ------------------------------------------------------------ */

function heldBy(db, rec) {
  if (rec.fields.inHand) return 'in hand with a session';
  if (rec.fields.agent) return 'run by ' + rec.fields.agent;
  const l = db.stmt('SELECT l.pc FROM track_items ti JOIN leases l ON l.track = ti.track WHERE ti.task = ?').get(rec.key);
  return l ? 'on a track a session' + (l.pc ? ' on ' + l.pc : '') + ' holds' : null;
}

function writePicture(db, pic, actor) {
  const c = actorOf(actor);
  const inner = { by: c.by, pc: c.pc || undefined, now: c.date };
  const changes = [];
  const reports = [];
  const late = [];
  const keys = new Map();
  const real = (k) => (k && k.startsWith('new:') ? keys.get(k) : k);
  const ws = (k) => (k ? labelOf(db, k) : '');
  const add = (kind, wsKey, line, text) => changes.push({ kind, workstream: ws(wsKey), line, text });
  const lineName = (t) => (t.line === 'inbox' ? 'inbox' : t.line ? t.line.name : 'no line');
  const wsOf = (t, rec) => (t.line && t.line !== 'inbox' ? t.line.wsKey : rec.fields.workstream);
  const refused = (e) => { if (e instanceof TrackRefusal) late.push(e.message); else throw e; };

  /* 1. verdicts (a stale in-progress mark nobody holds goes back to open); a
     status the picture itself set follows the files when they change their mind */
  for (const t of pic.tasks.values()) {
    const rec = loadRecord(db, t.key);
    const want = WANT[t.verdict];
    const st = rec.fields.status;
    const id = rec.fields.id;
    if (st === want) continue;
    const report = (why) => reports.push({ workstream: ws(wsOf(t, rec)), line: lineName(t), text: id + ' ' + why });
    const mine = (byPicture(db, rec.key, 'status') || [])[1] === st;
    if (!mine && ENDED_TASK.includes(st)) { report('is ' + st + ' and the file says ' + t.verdict + ': left ' + st); continue; }
    if (!mine && want === 'open' && st !== 'in_progress') { report('is ' + st + ' and the file says open: left ' + st); continue; }
    const held = heldBy(db, rec);
    if (held) { report('is ' + held + ': left ' + st + ' (the file says ' + t.verdict + ')'); continue; }
    if (sideOf(db, rec.key, ['open', 'parked', 'done'])) { report('is promoted, so its status follows its side track: left ' + st); continue; }
    const change = want === 'open' ? { status: want, updated: c.at, closed: undefined }
      : { status: want, updated: c.at, closed: c.at, inHand: undefined, inHandSince: undefined };
    const diff = writeFront(db, rec, change, TASK_KEYS);
    logLine(db, { at: c.at, verb: want === 'dropped' ? 'drop' : 'edit', kind: 'task', rec: headOf(rec), changes: diff, by: c.by, pc: c.pc, note: CAUSE + (t.evidence || t.verdict) });
    if (t.evidence) addNote(db, rec.key, { at: c.at, actor: c.by, body: guardHeadings('Board picture, ' + t.verdict + ': ' + t.evidence) });
    if (want === 'completed') afterTask(db, rec.key, { completed: true }, { by: c.by, pc: c.pc, now: c.date });
    if (want !== 'open') wakeLinked(db, { ...rec.fields, key: rec.key }, want, c);
    add(want === 'open' ? 'reopen' : t.verdict, wsOf(t, rec), lineName(t), id + (want === 'open' ? ' back to open from ' + st : ' ' + want));
  }

  /* 2. lines: mains, then sides once their parent stands; a line the picture makes keeps its file */
  const { order } = pic;
  const touched = new Set();
  const moveOnto = (key, l, why) => {
    const was = trackOf(db, key);
    if (was === l.key) return;
    if (was) touched.add(was);
    const rec = loadRecord(db, key);
    const from = rec.fields.workstream;
    putOnTrack(db, rec, loadRecord(db, l.key), c, CAUSE + why);
    add('move', l.wsKey, l.name, rec.fields.id + ' onto the line from ' + (was ? named(db, was) : 'the inbox') + (from && from !== l.wsKey ? ' (' + ws(from) + ' to ' + ws(l.wsKey) + ')' : ''));
  };
  const stamp = (key, file) => writeFront(db, loadRecord(db, key), { pictureFile: file }, TRACK_KEYS);
  for (const l of order) {
    l.key = l.found;
    if (l.key) {
      const rec = loadRecord(db, l.key);
      if (rec.fields.name !== l.name) {
        const was = rec.fields.name;
        const diff = writeFront(db, rec, { name: l.name }, TRACK_KEYS);
        logLine(db, { at: c.at, verb: 'edit', kind: 'track', rec: headOf(rec), changes: diff, by: c.by, pc: c.pc, note: CAUSE + 'named for its line' });
        add('rename', l.wsKey, l.name, named(db, l.key) + ' named for its line (was "' + was + '")');
      }
    } else if (l.kind === 'main') {
      l.key = makeTrack(db, { name: l.name, workstream: l.wsKey, note: CAUSE + 'a new line' }, c).key;
      stamp(l.key, l.file);
      add('track', l.wsKey, l.name, 'new track ' + named(db, l.key));
    } else {
      const parent = l.parentLine ? l.parentLine.key : l.parentKey;
      if (l.junctionKey && trackOf(db, l.junctionKey) !== parent) moveOnto(l.junctionKey, l.parentLine, 'the junction of "' + l.name + '"');
      const r = splinter(db, { from: parent, name: l.name, at: l.junctionKey || undefined, park: false, note: CAUSE + 'branches from ' + named(db, parent) }, inner);
      l.key = r.key;
      stamp(l.key, l.file);
      add('branch', l.wsKey, l.name, 'side track ' + named(db, r.key) + ' branches from ' + named(db, parent) + (r.at ? ' at ' + r.at : ''));
    }
    touched.add(l.key);
  }

  /* 3. proposed tasks, made once: their key and file stay on the task; one the files no
     longer propose drops, unless someone took it up */
  const homeOf = (k) => { const tr = trackOf(db, k); return tr ? (db.stmt('SELECT title FROM records WHERE key = ?').get(tr) || {}).title : 'inbox'; };
  for (const p of pic.proposed.values()) {
    let key = byField(db, 'pictureKey', p.pkey)[0];
    const lineOfP = p.line && p.line !== 'inbox' ? p.line.name : 'inbox';
    if (!key) {
      const wsKey = p.line && p.line !== 'inbox' ? p.line.wsKey : null;
      const r = createRecord(db, {
        name: p.name, workstream: wsKey || undefined, description: 'Proposed by the board picture (' + p.file + '): ' + (p.why || p.name), note: CAUSE + 'proposed in ' + p.file,
      }, inner);
      writeFront(db, loadRecord(db, r.key), { pictureKey: p.pkey, pictureFile: p.file }, TASK_KEYS);
      key = r.key;
      add('create', wsKey, lineOfP, 'new task ' + r.id + ' "' + p.name + '" (' + p.pkey + ')');
    } else {
      const rec = loadRecord(db, key);
      if (rec.fields.name !== p.name && !ENDED_TASK.includes(rec.fields.status)) {
        const held = heldBy(db, rec);
        if (held || rec.fields.status !== 'open') {
          reports.push({ workstream: ws(rec.fields.workstream), line: lineOfP, text: rec.fields.id + ' is ' + (held || rec.fields.status) + ': its name left (the file says "' + p.name + '")' });
        } else {
          const diff = writeFront(db, rec, { name: p.name, updated: c.at }, TASK_KEYS);
          logLine(db, { at: c.at, verb: 'edit', kind: 'task', rec: headOf(rec), changes: diff, by: c.by, pc: c.pc, note: CAUSE + 'named as ' + p.file + ' proposes' });
          add('rename', rec.fields.workstream, lineOfP, rec.fields.id + ' named "' + p.name + '" (was "' + diff.name[0] + '")');
        }
      }
    }
    keys.set('new:' + p.pkey, key);
  }
  for (const rec of pic.retired) {
    const diff = writeFront(db, rec, { status: 'dropped', updated: c.at, closed: c.at }, TASK_KEYS);
    const why = 'no longer proposed in ' + rec.fields.pictureFile;
    logLine(db, { at: c.at, verb: 'drop', kind: 'task', rec: headOf(rec), changes: diff, by: c.by, pc: c.pc, note: CAUSE + why });
    wakeLinked(db, { ...rec.fields, key: rec.key }, 'dropped', c);
    add('drop', rec.fields.workstream, homeOf(rec.key), rec.fields.id + ' dropped: ' + why + ' (' + rec.fields.pictureKey + ')');
  }

  /* 4. parks and their unpark conditions, now every line and proposal has a key; with no
     status or condition in the files, one the picture set is undone */
  for (const l of order) {
    const rec = loadRecord(db, l.key);
    const id = named(db, l.key);
    const lease = leaseOn(db, l.key);
    const set = !l.status && byPicture(db, l.key, 'status');
    const back = set && set[1] === rec.fields.status && OPEN_TRACK.includes(set[0]) ? set[0] : null;
    const status = l.status || back;
    if (status && status !== rec.fields.status) {
      if (lease) reports.push({ workstream: ws(l.wsKey), line: l.name, text: id + ' is held by ' + holderPlain(db, l.key, lease, { now: c.date.getTime(), pc: c.pc }) + ': left ' + rec.fields.status + ' (the file says ' + status + ')' });
      else if (status === 'parked') {
        const reason = l.parkReason || (back ? 'parked again, as before the picture' : 'parked by the board picture');
        setStatus(db, rec, 'parked', { parkReason: reason }, c, 'edit', back ? BACK : CAUSE + reason);
        add('park', l.wsKey, l.name, id + ' parked: ' + reason);
      } else if (status === 'open' && rec.fields.status === 'parked') {
        setStatus(db, rec, 'open', {}, c, 'edit', back ? BACK : CAUSE + 'open in the files');
        add('unpark', l.wsKey, l.name, id + ' open again' + (back ? ': the files no longer park it' : ''));
      }
    } else if (status === 'parked' && l.parkReason && rec.fields.parkReason !== l.parkReason) {
      const diff = writeFront(db, rec, { parkReason: l.parkReason }, TRACK_KEYS);
      logLine(db, { at: c.at, verb: 'edit', kind: 'track', rec: headOf(rec), changes: diff, by: c.by, pc: c.pc, note: CAUSE + l.parkReason });
      add('park', l.wsKey, l.name, id + ' park reason: ' + l.parkReason);
    }
    if (l.unpark) {
      const u = l.unpark;
      const on = u.line ? u.line.key : u.task ? real(u.task) : u.on;
      const want = { kind: u.kind, on };
      if (JSON.stringify(rec.fields.unparkWhen || null) !== JSON.stringify(want)) {
        const was = rec.fields.unparkWhen;
        const diff = writeFront(db, rec, { unparkWhen: want }, TRACK_KEYS);
        if (diff.unparkWhen) diff.unparkWhen = [whenText(db, was), whenText(db, want)];
        const what = u.line ? '"' + u.line.name + '" ends' : labelOf(db, on) + (u.kind === 'task-completes' ? ' completes' : ' is answered');
        logLine(db, { at: c.at, verb: 'edit', kind: 'track', rec: headOf(rec), changes: diff, by: c.by, pc: c.pc, note: CAUSE + 'unparks when ' + what });
        add('unpark when', l.wsKey, l.name, id + ' unparks when ' + what);
      }
    } else if (rec.fields.unparkWhen && byPicture(db, l.key, 'unparkWhen')) {
      const was = rec.fields.unparkWhen;
      const diff = writeFront(db, rec, { unparkWhen: undefined }, TRACK_KEYS);
      diff.unparkWhen = [whenText(db, was), null];
      logLine(db, { at: c.at, verb: 'edit', kind: 'track', rec: headOf(rec), changes: diff, by: c.by, pc: c.pc, note: BACK });
      add('unpark when', l.wsKey, l.name, id + ' no longer unparks on its own');
    }
  }

  /* 5. tasks onto their lines in file order (a move drops its import edges) */
  for (const t of pic.tasks.values()) {
    if (t.line === 'inbox') {
      const was = trackOf(db, t.key);
      if (!was) continue;
      touched.add(was);
      const rec = loadRecord(db, t.key);
      db.stmt('DELETE FROM track_items WHERE task = ?').run(t.key);
      bumpVersion(db, was);
      logLine(db, { at: c.at, verb: 'edit', kind: 'task', rec: headOf(rec), changes: { track: [was, null] }, by: c.by, pc: c.pc, note: CAUSE + 'to the inbox' });
      add('move', rec.fields.workstream, 'inbox', rec.fields.id + ' to the inbox from ' + named(db, was));
    } else if (t.line) moveOnto(t.key, t.line, 'on "' + t.line.name + '"');
  }
  for (const p of pic.proposed.values()) if (p.line && p.line !== 'inbox') moveOnto(keys.get('new:' + p.pkey), p.line, 'on "' + p.line.name + '"');
  for (const l of order) {
    const want = l.placed.map(real);
    const now = db.stmt('SELECT task FROM track_items WHERE track = ? ORDER BY position').all(l.key).map((r) => r.task);
    const next = want.filter((k) => now.includes(k)).concat(now.filter((k) => !want.includes(k)));
    if (next.every((k, i) => k === now[i])) continue;
    next.forEach((k, i) => db.stmt('UPDATE track_items SET position = ? WHERE task = ?').run(i + 1, k));
    bumpVersion(db, l.key);
    const rec = loadRecord(db, l.key);
    logLine(db, { at: c.at, verb: 'edit', kind: 'track', rec: headOf(rec), changes: {}, by: c.by, pc: c.pc, note: CAUSE + "its tasks in the files' order" });
    add('order', l.wsKey, l.name, named(db, l.key) + "'s tasks in the files' order");
  }

  /* 6. the import's chains go on every touched track, and the picture's own links the files
     no longer draw go wherever they are; the files' links replace them */
  const wanted = new Map();
  for (const e of pic.edges.values()) wanted.set(pairOf(real(e.task), real(e.on)), e);
  for (const k of pic.keep) if (!wanted.has(pairOf(k.task, k.on))) wanted.set(pairOf(k.task, k.on), { task: k.task, on: k.on, why: 'kept from the import' });
  const T = JSON.stringify([...touched]);
  const onTouched = db.stmt(`SELECT task, "on" FROM depends WHERE reason = ? AND (task IN (SELECT task FROM track_items WHERE track IN (SELECT value FROM json_each(?)))
    OR "on" IN (SELECT task FROM track_items WHERE track IN (SELECT value FROM json_each(?))))`).all(IMPORTED, T, T);
  const drawnBefore = db.stmt('SELECT task, "on" FROM depends WHERE substr(reason, 1, ?) = ?').all(CAUSE.length, CAUSE);
  const homes = new Map([...pic.tasks.values()].map((t) => [t.key, t]));
  for (const p of pic.proposed.values()) homes.set(keys.get('new:' + p.pkey), { line: p.line });
  const lineOfTask = (k) => homes.get(k) || { line: null };
  const unlink = (e, why) => {
    db.stmt('DELETE FROM depends WHERE task = ? AND "on" = ?').run(e.task, e.on);
    bumpVersion(db, e.task);
    const rec = loadRecord(db, e.task);
    logLine(db, { at: c.at, verb: 'edit', kind: 'task', rec: headOf(rec), changes: { dependsOn: [e.on, null] }, by: c.by, pc: c.pc, note: CAUSE + why });
    const home = homes.has(e.task) ? [wsOf(lineOfTask(e.task), rec), lineName(lineOfTask(e.task))] : [rec.fields.workstream, homeOf(e.task)];
    add('unlink', ...home, rec.fields.id + ' no longer waits on ' + labelOf(db, e.on) + ' (' + why + ')');
  };
  for (const e of onTouched) if (!wanted.has(pairOf(e.task, e.on))) unlink(e, "the import's order");
  for (const e of drawnBefore) if (!wanted.has(pairOf(e.task, e.on))) unlink(e, 'struck from the files');
  for (const e of wanted.values()) {
    const task = real(e.task);
    const on = real(e.on);
    const rec = loadRecord(db, task);
    const where = [wsOf(lineOfTask(task), rec), lineName(lineOfTask(task))];
    const reason = CAUSE + e.why;
    const had = db.stmt('SELECT reason FROM depends WHERE task = ? AND "on" = ?').get(task, on);
    if (had && (had.reason === reason || (had.reason !== IMPORTED && !ours(had.reason)))) continue;
    if (had) {
      db.stmt('UPDATE depends SET reason = ? WHERE task = ? AND "on" = ?').run(reason, task, on);
      logLine(db, { at: c.at, verb: 'edit', kind: 'task', rec: headOf(rec), changes: {}, by: c.by, pc: c.pc, note: CAUSE + (ours(had.reason) ? 'now for: ' : 'kept: ') + e.why });
      add(ours(had.reason) ? 'reword' : 'keep', ...where, rec.fields.id + ' still waits on ' + labelOf(db, on) + ', now for: ' + e.why);
      continue;
    }
    const loop = pathBetween(db, on, task);
    if (loop) { late.push('a loop: ' + rec.fields.id + ' would wait on ' + loop.map((k) => labelOf(db, k)).join(' after ')); continue; }
    db.stmt('INSERT INTO depends (task, "on", reason, added, actor) VALUES (?, ?, ?, ?, ?)').run(task, on, reason, c.at, c.by);
    bumpVersion(db, task);
    logLine(db, { at: c.at, verb: 'edit', kind: 'task', rec: headOf(rec), changes: { dependsOn: [null, on] }, by: c.by, pc: c.pc, note: reason });
    add('link', ...where, rec.fields.id + ' waits on ' + labelOf(db, on) + ': ' + e.why);
  }

  /* a side line the files branch somewhere else moves its junction (a promoted one keeps its task) */
  for (const l of order) {
    if (l.kind !== 'side' || !l.found) continue;
    const was = atOf(db, l.key);
    const want = l.junctionKey || null;
    if (was === want) continue;
    const rec = loadRecord(db, l.key);
    if (rec.fields.origin === 'promote') {
      reports.push({ workstream: ws(l.wsKey), line: l.name, text: named(db, l.key) + ' is promoted from ' + label(db, was) + ': its junction left' });
      continue;
    }
    if (was) db.stmt(`DELETE FROM links WHERE "from" = ? AND "to" = ? AND type = 'junction'`).run(l.key, was);
    if (want) db.stmt(`INSERT OR IGNORE INTO links ("from", "to", type, added) VALUES (?, ?, 'junction', ?)`).run(l.key, want, c.at);
    bumpVersion(db, l.key);
    const where = want ? 'at ' + labelOf(db, want) : 'from its parent alone';
    logLine(db, { at: c.at, verb: 'edit', kind: 'track', rec: headOf(rec), changes: { junction: [was, want] }, by: c.by, pc: c.pc, note: CAUSE + 'branches ' + where });
    add('branch', l.wsKey, l.name, named(db, l.key) + ' branches ' + where + (was ? ' (was ' + labelOf(db, was) + ')' : ''));
  }

  /* each side line's first open tasks wait on its junction; a tie that rule no longer
     wants (the task moved off, or now after another of its line) goes */
  const scope = new Set([...homes.keys(), ...order.flatMap((l) => tasksOn(db, l.key))]);
  const wants = new Map();
  const keepsTie = (task, on) => {
    const side = trackOf(db, task);
    if (ENDED_TASK.includes(loadRecord(db, task).fields.status)) return true;
    if (!side || atOf(db, side) !== on) return false;
    if (!wants.has(side)) wants.set(side, junctionWants(db, side).want);
    const w = wants.get(side);
    return !w || w.includes(task);
  };
  for (const e of db.stmt('SELECT task, "on" FROM depends WHERE substr(reason, 1, ?) = ?').all(TIE.length, TIE)) {
    if (scope.has(e.task) && !wanted.has(pairOf(e.task, e.on)) && !keepsTie(e.task, e.on)) unlink(e, 'its line no longer branches there');
  }
  for (const l of order) {
    if (l.kind !== 'side' || !l.junctionKey) continue;
    try {
      for (const id of tieToJunction(db, l.key, c, CAUSE + 'waits on its junction')) add('junction', l.wsKey, l.name, id + ' waits on its junction ' + labelOf(db, l.junctionKey));
    } catch (e) { refused(e); }
  }

  /* 7. workstreams and tracks close last, so a task the files move out has left first; a
     close the picture made opens again on "stay open" */
  for (const v of pic.wsVerdicts) {
    for (const r of v.records) {
      const rec = loadRecord(db, r.key);
      const st = rec.fields.status;
      const wsKey = r.kind === 'workstream' ? r.key : rec.fields.workstream;
      const line = r.kind === 'track' ? rec.fields.name : '';
      const id = named(db, r.key);
      if (v.kind === 'close' && r.kind === 'workstream' && st !== 'closed') {
        closeRecord(db, { id: r.key, kind: 'workstream', outcome: CAUSE + v.why }, inner);
        add('close', wsKey, line, id + ' closed: ' + v.why);
      } else if ((v.kind === 'done' || v.kind === 'close') && r.kind === 'track' && OPEN_TRACK.includes(st)) {
        try {
          finishTrack(db, { track: r.key, outcome: CAUSE + v.why }, inner);
          add('finish', wsKey, line, id + ' done: ' + v.why);
        } catch (e) { refused(e); }
      } else if (v.kind === 'stay open' && !OPEN_TRACK.includes(st) && ours(rec.fields.outcome)) {
        if (r.kind === 'workstream') reopenRecord(db, { id: r.key }, inner);
        else setStatus(db, rec, 'open', { outcome: undefined, closed: undefined }, c, 'edit', CAUSE + 'stay open: ' + v.why);
        add('reopen', wsKey, line, id + ' open again: ' + v.why);
      } else if (v.kind === 'stay open' && !OPEN_TRACK.includes(st)) {
        reports.push({ workstream: ws(wsKey), line, text: id + ' is ' + st + ' and the file says stay open: left ' + st });
      } else if (v.kind === 'closed' && OPEN_TRACK.includes(st)) {
        reports.push({ workstream: ws(wsKey), line, text: id + ' is ' + st + ' and the file says closed: left ' + st });
      }
    }
  }

  /* a line the picture made that the files no longer draw goes, its open tasks placed elsewhere */
  for (const r of pic.orphans) {
    const lease = leaseOn(db, r.key);
    if (lease) {
      reports.push({ workstream: ws(r.fields.workstream), line: r.fields.name, text: named(db, r.key) + ' is held by ' + holderPlain(db, r.key, lease, { now: c.date.getTime(), pc: c.pc }) + ': left open (no file draws it)' });
      continue;
    }
    try {
      dropTrack(db, { track: r.key, reason: CAUSE + 'no longer a line of ' + r.fields.pictureFile }, inner);
      add('drop line', r.fields.workstream, r.fields.name, named(db, r.key) + ' dropped: no longer a line of ' + r.fields.pictureFile);
    } catch (e) { refused(e); }
  }

  if (late.length) throw new TrackRefusal('the board picture was refused, nothing written:\n' + late.map((p) => '- ' + p).join('\n'), { problems: late });
  const counts = {};
  for (const ch of changes) counts[ch.kind] = (counts[ch.kind] || 0) + 1;
  return { changes, reports, counts };
}

/* A dry run writes inside a transaction it always rolls back. */
function rolledBack(db, fn) {
  const outer = db.isTransaction;
  db.exec(outer ? 'SAVEPOINT apply_picture' : 'BEGIN IMMEDIATE');
  try {
    return fn();
  } finally {
    if (outer) db.exec('ROLLBACK TO apply_picture; RELEASE apply_picture');
    else if (db.isTransaction) db.exec('ROLLBACK');
  }
}

/* applyPicture { files: { "<name>.json": <its JSON> }, dryRun }: dry unless dryRun is false. */
export function applyPicture(db, input, actor) {
  const files = filesOf(input);
  const dryRun = !(input && input.dryRun === false);
  const run = () => writePicture(db, readPicture(db, files), actor);
  return { dryRun, ...(dryRun ? rolledBack(db, run) : tx(db, run)) };
}
