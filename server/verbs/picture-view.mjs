/* The redrawn workstream picture's reads: what one workstream's picture needs beyond
   workstreamView, and the Overview's inputs. server/web/picture-model.mjs builds P from them;
   the board's pages and the local board call these. */
import { readTx } from '../db.mjs';
import { WEB } from '../paths.mjs';
import { clockOf, dayOf } from '../records.mjs';
import { UsageError, resolveRecord } from './labels.mjs';
import { loadRecord } from './graph.mjs';
import { parseOptions, questionSections } from './questions.mjs';
import { NEWEST_FIRST, listTracks, projectInbox, trackMoved, trackView } from './tracks.mjs';
import { runByWords } from './kickoff.mjs';
import { critOf } from '../web/picture-model.mjs';
/* the one reading of what waits on the user, which the Overview page counts too */
import { waitingItems } from '../web/data.mjs';
import { endedOf, nowCounts } from '../web/draw.mjs';

const DAY = 86400000;
const MOVE_DAYS = 30;
const DONE_LIST = 20;
const ENDED = "('completed', 'dropped')";
const CLOSED_TRACK = "('done', 'dropped', 'folded')";
const IN = 'SELECT value FROM json_each(?)';
const J = (xs) => JSON.stringify(xs);
const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };

function wsOf(db, ref) {
  const e = resolveRecord(db, String(ref ?? '').trim(), { kinds: ['workstream'] });
  if (!e) throw new UsageError('unknown workstream: ' + ref);
  return { key: e.key, id: e.label, name: e.front.name || '' };
}

/* [[T-n, 'new' | 'started' | 'done', at]] of each workstream's tasks (on its tracks or in its
   inbox) in the last 30 days, by workstream key; one of each kind per task, its latest. One read
   for all the workstreams asked, from their tasks' rows rather than a scan of the month per workstream. */
function movesOf(db, wsKeys, nowMs) {
  const from = new Date(nowMs - MOVE_DAYS * DAY).toISOString().slice(0, 10);
  const rows = db.stmt(`WITH t AS (
      SELECT ti.task AS key, tr.label AS track, tr.workstream AS ws FROM records tr JOIN track_items ti ON ti.track = tr.key
        WHERE tr.workstream IN (${IN})
      UNION ALL
      SELECT r.key, tr.label, r.workstream FROM records r LEFT JOIN track_items ti ON ti.task = r.key LEFT JOIN records tr ON tr.key = ti.track
        WHERE r.kind = 'task' AND r.workstream IN (${IN}) AND tr.workstream IS NULL)
    SELECT t.ws, a.label, a.at, a.verb, json_extract(a.line, '$.changes.status[1]') AS st, t.track
    FROM t JOIN activity a ON a.record = t.key
    WHERE a.at >= ? AND a.kind = 'task' AND (a.verb = 'create' OR json_extract(a.line, '$.changes.status[1]') IN ('in_progress', 'completed'))
    ORDER BY a.seq`).all(J(wsKeys), J(wsKeys), from);
  const last = new Map(wsKeys.map((k) => [k, new Map()]));
  for (const r of rows) {
    const kind = r.verb === 'create' ? 'new' : r.st === 'in_progress' ? 'started' : 'done';
    last.get(r.ws).set(r.label + ' ' + kind, { move: [r.label, kind, r.at], track: r.track || null });
  }
  return new Map([...last].map(([k, m]) => [k, [...m.values()].sort((a, b) => String(a.move[2]).localeCompare(String(b.move[2])))]));
}

/* The answers behind tasks and tracks: a decision that governs one and names its question,
   newest first; else an answered question that gated the task. */
function answersFor(db, taskKeys, trackKeys) {
  const rows = db.stmt(`SELECT fields FROM records WHERE kind = 'knowledge' AND status = 'active'
    AND json_extract(fields, '$.type') = 'decision' AND json_extract(fields, '$.question') IS NOT NULL`).all()
    .map((r) => parse(r.fields)).filter(Boolean)
    .sort((a, b) => String(b.created || '').localeCompare(String(a.created || '')));
  const task = new Map();
  const track = new Map();
  const tk = new Set(taskKeys);
  const rk = new Set(trackKeys);
  for (const f of rows) {
    for (const k of f.tasks || []) if (tk.has(k) && !task.has(k)) task.set(k, { q: f.question, settles: f.name || '' });
    for (const k of f.tracks || []) if (rk.has(k) && !track.has(k)) track.set(k, { q: f.question, settles: f.name || '' });
  }
  if (taskKeys.length) {
    for (const r of db.stmt(`SELECT l."to" AS task, q.key FROM links l JOIN records q ON q.key = l."from" AND q.kind = 'question'
        WHERE l.type = 'gates' AND q.status = 'answered' AND l."to" IN (${IN}) ORDER BY q.id DESC`).all(J(taskKeys))) {
      if (!task.has(r.task)) task.set(r.task, { q: r.key, settles: '' });
    }
  }
  return { task, track };
}

/* One answered question as the picture names it: its token, the picked option's words, what it settles. */
function answerRecord(db, qKey, settles) {
  const q = db.stmt("SELECT key, label, title, body, fields FROM records WHERE key = ? AND kind = 'question'").get(qKey);
  if (!q) return null;
  const f = parse(q.fields) || {};
  const options = parseOptions(questionSections(q.body || '', '').sections['Options']);
  const said = db.stmt('SELECT body FROM notes WHERE record = ? ORDER BY position').all(q.key).map((n) => n.body).join('\n\n');
  const m = /^\s*([A-Za-z0-9][\w-]*)\s*[.:,]/.exec(said);
  const num = String(q.label).replace(/^Q/, '');
  const tok = m ? m[1].toLowerCase() : '';
  const hit = options.find((o) => { const t = String(o.type || '').toLowerCase(); return t && (tok === t || tok === num + t || tok === 'q' + num + t); });
  return {
    id: q.label, key: q.key, url: WEB.record(q.label), tok: hit ? num + String(hit.type).toLowerCase() : tok, name: f.name || q.title || '',
    at: f.answered || f.updated || null, said: hit ? hit.option : '', settles: settles || (hit ? hit.getsYou : '') || '',
  };
}

/* A question its park reason names (its label or an answer token), when no decision on the track names one. */
function parkQuestion(db, reason) {
  const m = /\bQ(\d+)\b/.exec(String(reason || '')) || /\b(\d+)[a-z]\b/.exec(String(reason || ''));
  if (!m) return null;
  const q = db.stmt("SELECT key FROM records WHERE kind = 'question' AND label = ? AND status = 'answered'").get('Q' + m[1]);
  return q ? q.key : null;
}

/* What opens a parked track, by label, with what it names: its name and workstream. */
function unparkOf(db, fields) {
  const u = fields.unparkWhen;
  if (!u || typeof u !== 'object' || !u.on) return null;
  const r = db.stmt(`SELECT r.label, r.title, w.label AS ws FROM records r LEFT JOIN track_items ti ON ti.task = r.key
    LEFT JOIN records tr ON tr.key = ti.track LEFT JOIN records w ON w.key = coalesce(r.workstream, tr.workstream) WHERE r.key = ?`).get(u.on);
  return r ? { kind: u.kind, on: r.label, onKey: u.on, onName: r.title || '', onWs: r.ws || null } : null;
}

const FAR = `SELECT o.key, o.label, o.title, o.status, json_extract(o.fields, '$.created') AS created, tr.label AS track, tr.title AS trName,
  w.label AS ws, w.title AS wsName FROM records o LEFT JOIN track_items ti ON ti.task = o.key LEFT JOIN records tr ON tr.key = ti.track
  LEFT JOIN records w ON w.key = coalesce(tr.workstream, o.workstream) WHERE o.key = ?`;

/* pictureView({ workstream }): the extras one workstream's picture needs beyond workstreamView. */
export function pictureView(db, input, actor, opts) {
  return readTx(db, () => {
    const w = wsOf(db, input && input.workstream);
    const nowMs = clockOf(actor, opts).getTime();
    const ls = listTracks(db, { workstream: w.key }, { now: nowMs });
    const trackKeys = ls.tracks.map((t) => t.key);
    const onTracks = new Set(trackKeys);
    const recs = new Map(ls.tracks.map((t) => [t.id, loadRecord(db, t.key)]));
    /* the open tasks on its tracks, and the finished stations a side track leaves from */
    const open = db.stmt(`SELECT r.key, r.label, ti.track FROM track_items ti JOIN records r ON r.key = ti.task
      WHERE ti.track IN (${IN}) AND coalesce(r.status, '') NOT IN ${ENDED}`).all(J(trackKeys));
    const openKeys = open.map((r) => r.key);
    const junctions = db.stmt(`SELECT DISTINCT r.key FROM links l JOIN records r ON r.key = l."to" AND r.kind = 'task'
      WHERE l.type = 'junction' AND l."from" IN (${IN})`).all(J(trackKeys)).map((r) => r.key);
    const moves = movesOf(db, [w.key], nowMs).get(w.key);
    const tracks = {};
    for (const t of ls.tracks) {
      const rec = recs.get(t.id);
      const moved = trackMoved(db, rec);
      const h = t.state === 'waiting' ? db.stmt('SELECT created FROM handoffs WHERE track = ? ORDER BY ' + NEWEST_FIRST + ' LIMIT 1').get(t.key) : null;
      const doneList = db.stmt(`SELECT r.label AS id, r.title AS name, coalesce(nullif(json_extract(r.fields, '$.closed'), ''), json_extract(r.fields, '$.updated')) AS closed
        FROM track_items ti JOIN records r ON r.key = ti.task WHERE ti.track = ? AND r.status = 'completed' ORDER BY closed DESC, r.id DESC LIMIT ?`).all(t.key, DONE_LIST);
      tracks[t.id] = {
        unpark: t.state === 'parked' ? unparkOf(db, rec.fields) : null,
        stalledDays: t.stalled && moved !== null ? Math.floor((nowMs - moved) / DAY) : null,
        since: h ? h.created : null, doneList,
        moves: moves.filter((m) => m.track === t.id).map((m) => m.move),
      };
    }
    const ans = answersFor(db, [...openKeys, ...junctions], trackKeys);
    const answers = {};
    const named = (qKey, settles) => {
      const a = answers[qKey] || answerRecord(db, qKey, settles);
      if (a) answers[qKey] = a;
      return a ? a.id : null;
    };
    const taskAns = {};
    const tasks = {};
    const rowOf = db.stmt(`SELECT r.label, r.fields FROM records r WHERE r.key = ?`);
    const started = db.stmt(`SELECT at FROM activity WHERE record = ? AND json_extract(line, '$.changes.status[1]') = 'in_progress' ORDER BY seq DESC LIMIT 1`);
    for (const k of [...openKeys, ...junctions]) {
      const r = rowOf.get(k);
      const f = parse(r.fields) || {};
      const s = f.status === 'in_progress' ? (started.get(k) || {}).at : null;
      tasks[r.label] = {
        created: f.created || null, ...(s ? { started: s } : {}), ...(f.closed ? { closed: f.closed } : {}),
        ...(f.runBy ? { by: runByWords(f.runBy) } : {}), ...(f.priority === 'low' ? { low: true } : {}),
      };
      const a = ans.task.get(k);
      if (a && !['completed', 'dropped'].includes(f.status)) { const q = named(a.q, a.settles); if (q) taskAns[r.label] = q; }
    }
    const trackAns = {};
    for (const t of ls.tracks) {
      const a = ans.track.get(t.key);
      const pq = !a && t.state === 'parked' ? parkQuestion(db, t.parkReason) : null;
      const q = a ? named(a.q, a.settles) : pq ? named(pq, '') : null;
      if (q) { trackAns[t.id] = q; tracks[t.id].parkAns = q; }
    }
    /* tasks off its tracks a drawn task waits on, or that wait on one; another workstream's are its in and out */
    const far = {};
    const inn = [];
    const out = [];
    const farOf = (row) => {
      if (!far[row.label]) {
        far[row.label] = {
          id: row.label, key: row.key, url: WEB.record(row.label), name: row.title || '', tr: row.track || null, trName: row.trName || '',
          ws: row.ws || null, wsName: row.wsName || '', st: row.status === 'in_progress' ? 'now' : 'waits', created: row.created || null, waits: [],
        };
      }
      return far[row.label];
    };
    const trOfKey = new Map(open.map((r) => [r.key, labelOfTrack(ls.tracks, r.track)]));
    const farRow = db.stmt(FAR);
    if (openKeys.length) {
      for (const d of db.stmt(`SELECT d.task, d."on", t.label AS waiter FROM depends d JOIN records t ON t.key = d.task JOIN records o ON o.key = d."on"
          LEFT JOIN track_items ti ON ti.task = o.key
          WHERE d.task IN (${IN}) AND coalesce(o.status, '') NOT IN ${ENDED} AND (ti.track IS NULL OR ti.track NOT IN (${IN}))`).all(J(openKeys), J(trackKeys))) {
        const o = farOf(farRow.get(d.on));
        if (o.ws && o.ws !== w.id) {
          inn.push({ to: trOfKey.get(d.task), task: d.waiter, ws: o.ws, on: o.id, text: 'waits on ' + o.ws + ' ' + o.id,
            words: d.waiter + ' waits on ' + o.ws + ' ' + o.id + ' ' + o.name + (o.tr ? ' (on ' + o.tr + ' ' + o.trName + ')' : '') });
        }
      }
      for (const d of db.stmt(`SELECT d.task, d."on", o.label AS on_label FROM depends d JOIN records t ON t.key = d.task JOIN records o ON o.key = d."on"
          LEFT JOIN track_items ti ON ti.task = t.key
          WHERE d."on" IN (${IN}) AND coalesce(t.status, '') NOT IN ${ENDED} AND (ti.track IS NULL OR ti.track NOT IN (${IN}))`).all(J(openKeys), J(trackKeys))) {
        const t = farOf(farRow.get(d.task));
        if (!t.waits.includes(d.on_label)) t.waits.push(d.on_label);
        if (t.ws && t.ws !== w.id) {
          out.push({ from: trOfKey.get(d.on), task: d.on_label, ws: t.ws, text: t.ws + ' waits on ' + d.on_label,
            words: t.ws + ' ' + t.id + ' ' + t.name + (t.tr ? ' (on ' + t.tr + ' ' + t.trName + ')' : '') + ' waits on ' + d.on_label });
        }
      }
    }
    /* another workstream's parked track that opens when a task or track here ends */
    const here = [...openKeys, ...trackKeys];
    if (here.length) {
      for (const r of db.stmt(`SELECT t.label, t.title, t.fields, w.label AS ws FROM records t JOIN records w ON w.key = t.workstream
          WHERE t.kind = 'track' AND t.status = 'parked' AND t.workstream <> ? AND json_extract(t.fields, '$.unparkWhen.on') IN (${IN})`).all(w.key, J(here))) {
        const u = unparkOf(db, parse(r.fields) || {});
        if (!u) continue;
        const isTask = u.kind === 'task-completes';
        out.push({ from: isTask ? trOfKey.get(u.onKey) : u.on, task: isTask ? u.on : null, ws: r.ws, waiter: r.label, text: r.ws + ' waits on ' + u.on,
          words: r.ws + ' ' + r.label + ' ' + r.title + ' opens when ' + u.on + (isTask ? ' completes' : ' ends') });
      }
    }
    /* a parked track here that opens when another workstream's task or track ends */
    for (const t of ls.tracks) {
      const u = tracks[t.id].unpark;
      if (!u || !u.onWs || u.onWs === w.id || u.kind === 'question-answered') continue;
      inn.push({ to: t.id, task: null, ws: u.onWs, on: u.on, text: 'waits on ' + u.onWs + ' ' + u.on,
        words: 'opens when ' + u.onWs + ' ' + u.on + ' ' + u.onName + (u.kind === 'task-completes' ? ' completes' : ' ends') });
    }
    for (const t of Object.values(tracks)) if (t.unpark) delete t.unpark.onKey;
    return { workstream: w.id, key: w.key, name: w.name, url: WEB.workstream(w.id), tracks, tasks, far, answers: byLabel(answers), taskAns, trackAns, out, in: inn };
  });
}

const labelOfTrack = (rows, key) => (rows.find((t) => t.key === key) || {}).id || null;
const byLabel = (answers) => Object.fromEntries(Object.values(answers).map((a) => [a.id, a]));

/* OvLinks: task waits and unpark conditions from one workstream to another, `to` waiting on `from`. */
function ovLinks(db, wsKeys) {
  const pairs = new Map();
  const add = (from, to, pair, text) => {
    const k = from + '>' + to;
    if (!pairs.has(k)) pairs.set(k, { from, to, n: 0, pairs: [], texts: [] });
    const l = pairs.get(k);
    l.n += 1;
    l.pairs.push(pair);
    l.texts.push(text);
  };
  const WS = `LEFT JOIN track_items ti_X ON ti_X.task = X.key LEFT JOIN records tr_X ON tr_X.key = ti_X.track
    LEFT JOIN records w_X ON w_X.key = coalesce(tr_X.workstream, X.workstream)`;
  for (const r of db.stmt(`SELECT t.label AS t, t.title AS tn, o.label AS o, o.title AS oName, w_t.label AS tw, w_o.label AS ow
      FROM depends d JOIN records t ON t.key = d.task JOIN records o ON o.key = d."on" ${WS.replace(/X/g, 't')} ${WS.replace(/X/g, 'o')}
      WHERE t.kind = 'task' AND coalesce(t.status, '') NOT IN ${ENDED} AND coalesce(o.status, '') NOT IN ${ENDED}
        AND w_t.key <> w_o.key AND w_t.key IN (${IN}) AND w_o.key IN (${IN})`).all(J(wsKeys), J(wsKeys))) {
    add(r.ow, r.tw, [r.t, r.o], r.tw + ' ' + r.t + ' ' + r.tn + ' waits on ' + r.o + ' ' + r.oName);
  }
  for (const r of db.stmt(`SELECT t.label, t.title, t.fields, w.label AS ws FROM records t JOIN records w ON w.key = t.workstream
      WHERE t.kind = 'track' AND t.status = 'parked' AND t.workstream IN (${IN}) AND json_extract(t.fields, '$.unparkWhen.on') IS NOT NULL`).all(J(wsKeys))) {
    const u = unparkOf(db, parse(r.fields) || {});
    if (!u || !u.onWs || u.onWs === r.ws || u.kind === 'question-answered') continue;
    add(u.onWs, r.ws, [r.label, u.on], r.ws + ' ' + r.label + ' ' + r.title + ' opens when ' + u.on + ' ' + u.onName + (u.kind === 'task-completes' ? ' completes' : ' ends'));
  }
  return [...pairs.values()].map(({ texts, ...l }) => ({ ...l, text: texts.join('; ') }));
}

/* How many of a workstream's inbox tasks are due, by the wake reading its own page counts with. */
export const inboxDueOf = (db, w, nowMs) => projectInbox(db, w.key, dayOf(new Date(nowMs))).filter((t) => t.workstream.id === w.label && t.due).length;

/* pictureOverview({}): every workstream with open work, in the Overview page's order, and the waits between them. */
export function pictureOverview(db, input, actor, opts) {
  return readTx(db, () => {
    const nowMs = clockOf(actor, opts).getTime();
    const items = waitingItems(db, nowMs);
    const rows = [];
    const keys = [];
    const wss = db.stmt("SELECT key, label, title FROM records WHERE kind = 'workstream' AND status = 'open' ORDER BY id").all();
    const moves = movesOf(db, wss.map((w) => w.key), nowMs);
    for (const w of wss) {
      const ls = listTracks(db, { workstream: w.key }, { now: nowMs });
      if (!ls.tracks.length && !ls.inbox) continue;
      keys.push(w.key);
      const views = ls.tracks.map((t) => trackView(db, { track: t.key }, { now: nowMs }));
      const tracks = ls.tracks.map((t) => {
        const u = t.state === 'parked' ? unparkOf(db, loadRecord(db, t.key).fields) : null;
        return { id: t.id, name: t.name, state: t.state, stalled: t.stalled, ...(u ? { unpark: { kind: u.kind, on: u.on } } : {}) };
      });
      const parks = tracks.filter((t) => t.unpark).map((t) => ({ tr: t.id, kind: t.unpark.kind, on: t.unpark.on }));
      const mine = items.filter((i) => i.wss.includes(w.key));
      const gated = mine.filter((i) => i.kind === 'question' && i.gates.length);
      const agents = views.flatMap((v) => (v.now || []).filter((n) => n.agent && !endedOf(n)).map((n) => n.agent));
      const c = nowCounts(views.flatMap((v) => v.now || []));
      /* stalled when every line that can stall (held, waiting or parked) has */
      const can = ls.tracks.filter((t) => ['active', 'waiting', 'parked'].includes(t.state));
      const moved = can.map((t) => trackMoved(db, loadRecord(db, t.key))).filter((m) => m !== null);
      const allStalled = can.length > 0 && can.every((t) => t.stalled);
      rows.push({
        id: w.label, key: w.key, url: WEB.workstream(w.label), name: w.title || '', tracks,
        open: views.reduce((n, v) => n + v.tasks.length, 0), running: c.running, ...(c.landing ? { landing: c.landing } : {}), ...(c.stopped ? { stopped: c.stopped } : {}),
        ready: views.reduce((n, v) => n + (v.readySet || []).length, 0), inbox: ls.inbox, ...(ls.inbox ? { inboxDue: inboxDueOf(db, w, nowMs) } : {}), crit: critOf({ views, parks }).n,
        held: views.some((v) => v.holder), agents,
        ...(mine.length ? { needs: mine[0].text } : {}), needCount: mine.length,
        gatedQ: gated.map((i) => i.id), gatedNames: gated.map((i) => i.text),
        ...(allStalled && moved.length ? { stalledDays: Math.floor((nowMs - Math.max(...moved)) / DAY) } : {}),
        moved: moved.length ? Math.max(...moved) : 0,
        moves: moves.get(w.key).map((m) => m.move),
      });
    }
    /* the Overview's order: a session on it, then needs, then movement; no track last */
    const live = (r) => r.tracks.some((t) => t.state === 'active');
    rows.sort((a, b) => (b.tracks.length > 0) - (a.tracks.length > 0) || live(b) - live(a) || b.needCount - a.needCount || b.moved - a.moved);
    return { at: new Date(nowMs).toISOString(), ws: rows.map(({ needCount, moved, ...r }) => r), links: ovLinks(db, keys) };
  });
}
