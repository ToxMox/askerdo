/* The web views' reads: each page's model in one read transaction,
   from the track verbs' views plus the few rows only a page shows. Read only. */
import { readTx } from '../db.mjs';
import { layoutGraph, layoutInput, linesTouching } from '../layout.mjs';
import { graphOf, shortTitle } from './graph.mjs';
import { clockOf, isKey, labelOf } from '../records.mjs';
import {
  canonLabel, loadEntry, parseLegacyToken, resolveLabel, resolveLegacy, resolveRecord, shownFront,
} from '../verbs/labels.mjs';
import { readiness } from '../verbs/graph.mjs';
import { growthLines } from '../verbs/kickoff.mjs';
import { waitingOf } from '../handoff-text.mjs';
import { procedureCards } from '../verbs/procedures.mjs';
import { answeredPick, parseOptions, questionSections } from '../verbs/questions.mjs';
import { lastSeq } from '../verbs/snapshot.mjs';
import { NEWEST_FIRST, listTracks, stallDays, trackView, workstreamView } from '../verbs/tracks.mjs';
import { bandCalls, closeText, unparkWords, whenText } from '../verbs/upkeep.mjs';

const DAY = 86400000;
const LIVE_HANDOFF = ['waiting', 'parked'];
const IN = 'SELECT value FROM json_each(?)';

export { lastSeq, shortTitle };

const nowOf = (opts) => clockOf(opts).getTime();
const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };

/* The track's last movement, as the stall rule reads it (tracks.mjs isStalled). */
function lastMoved(db, key, fields) {
  const last = db.stmt(`SELECT at FROM activity WHERE record IN (SELECT ? UNION ALL SELECT task FROM track_items WHERE track = ?)
    AND json_extract(line, '$.changes.kept') IS NULL AND actor IS NOT 'board:upkeep' ORDER BY seq DESC LIMIT 1`).get(key, key);
  const lease = db.stmt('SELECT seen FROM leases WHERE track = ?').get(key);
  const cands = [last && last.at, lease && lease.seen, fields && fields.updated].filter(Boolean);
  let best = null;
  for (const c of cands) if (!best || Date.parse(c) > Date.parse(best)) best = c;
  return best;
}

/* Open questions gating each task, by task key. */
function gatesOf(db, keys) {
  const out = new Map();
  if (!keys.length) return out;
  for (const q of db.stmt(`SELECT t.value AS task, q.label FROM json_each(?) t
      JOIN links l ON l.type = 'gates' AND (l."to" = t.value OR l."to" IN (SELECT label FROM labels WHERE key = t.value))
      JOIN records q ON q.key = l."from" AND q.kind = 'question'
      WHERE coalesce(q.status, '') NOT IN ('answered', 'dropped')`).all(JSON.stringify(keys))) {
    const list = out.get(q.task) || [];
    if (!list.includes(q.label)) list.push(q.label);
    out.set(q.task, list);
  }
  return out;
}

/* Where an open task sits: its track (or the inbox), and its workstream when that is not `home`. */
const PLACE = `LEFT JOIN track_items ti ON ti.task = t.key LEFT JOIN records tr ON tr.key = ti.track
  LEFT JOIN records w ON w.key = coalesce(tr.workstream, t.workstream)`;
const placeOf = (r, home) => ({ track: r.track || 'the inbox', ws: r.wsKey && r.wsKey !== home ? r.ws : '' });
function openPlace(db, id, home) {
  const r = db.stmt(`SELECT tr.label AS track, w.key AS wsKey, w.label AS ws FROM records t ${PLACE}
    WHERE t.kind = 'task' AND t.label = ? AND coalesce(t.status, '') NOT IN ('completed', 'dropped')`).get(id);
  return r ? placeOf(r, home) : { track: 'the inbox', ws: '' };
}

/* The open tasks waiting on each of `keys`, by key, each with its place. CROSS JOIN keeps the
   order, so the read starts at the depends_on index instead of scanning every task. */
function neededOf(db, keys, home) {
  const out = new Map();
  if (!keys.length) return out;
  for (const r of db.stmt(`SELECT d."on" AS onKey, t.key, t.label AS id, t.title AS name, t.status, tr.label AS track, w.key AS wsKey, w.label AS ws
      FROM json_each(?) j CROSS JOIN depends d ON d."on" = j.value CROSS JOIN records t ON t.key = d.task ${PLACE}
      WHERE t.kind = 'task' AND coalesce(t.status, '') NOT IN ('completed', 'dropped') ORDER BY t.label`).all(JSON.stringify(keys))) {
    const list = out.get(r.onKey) || [];
    list.push({ id: r.id, key: r.key, name: r.name, status: r.status, ...placeOf(r, home) });
    out.set(r.onKey, list);
  }
  return out;
}

const wsOfRecord = (db, key) => (db.stmt('SELECT workstream FROM records WHERE key = ?').get(key) || {}).workstream || null;

/* The drawn graph's three inputs from the track views: g and D (server/web/graph.mjs, its
   look read from the tables) and L (server/layout.mjs). */
export function graphFrom(db, views, now, { layout = true } = {}) {
  const keyOf = new Map();
  for (const tv of views) for (const t of tv.tasks) keyOf.set(t.id, t.key);
  const gates = gatesOf(db, [...keyOf.values()]);
  const home = views.length ? wsOfRecord(db, views[0].key) : null;
  const far = new Map();
  const farOf = (id) => { if (!far.has(id)) far.set(id, openPlace(db, id, home)); return far.get(id); };
  const needed = neededOf(db, [...keyOf.values()], home);
  const G = graphOf(views, now, {
    gates: (t) => gates.get(t.key) || [],
    trackOf: (on) => farOf(on).track,
    wsOf: (on) => farOf(on).ws,
    neededBy: (t) => needed.get(t.key) || [],
    front: (tv) => { const rec = loadEntry(db, tv.key); return rec ? rec.front : null; },
    moved: (tv, front) => {
      const last = lastMoved(db, tv.key, front);
      return { last, days: last ? Math.floor((now - Date.parse(last)) / DAY) : 0 };
    },
    /* waiting since its handoff, not its last movement */
    since: (tv) => (tv.state === 'waiting' ? (liveHandoff(db, tv.key) || {}).created || null : null),
  });
  return { ...G, L: layout ? layoutGraph(layoutInput(views)) : null };
}

/* ---- what waits on the user: one reading every view counts from ------------- */

function openQuestions(db) {
  return db.stmt(`SELECT key, label, title, json_extract(fields, '$.blocking') AS blocking, workstream,
      json_extract(fields, '$.project') AS project, json_extract(fields, '$.projectRepo') AS projectRepo,
      json_extract(fields, '$.projectDir') AS projectDir, json_extract(fields, '$.created') AS created
      FROM records WHERE kind = 'question' AND status = 'open' ORDER BY id`).all()
    .map((q) => ({ ...q, blocking: q.blocking === 1 || q.blocking === true || q.blocking === 'true' }));
}

const gatedBy = (db, qKey) => db.stmt(`SELECT coalesce(r.label, l."to") AS label FROM links l LEFT JOIN records r ON r.key = l."to"
  WHERE l."from" = ? AND l.type = 'gates'`).all(qKey).map((r) => r.label);

/* The live handoff of each track and what it says waits on the user. */
function liveHandoff(db, trackKey) {
  const h = db.stmt('SELECT key, label, fields, status, created FROM handoffs WHERE track = ? ORDER BY ' + NEWEST_FIRST + ' LIMIT 1').get(trackKey);
  if (!h || !LIVE_HANDOFF.includes(h.status)) return null;
  const f = parse(h.fields) || {};
  return { id: h.label, key: h.key, status: h.status, created: h.created, focus: f.focus || '', waitingOnUser: waitingOf(f) };
}

/* The workstream a record sits in: a workstream itself, else its own or its track's. */
function wsOfKey(db, key) {
  const r = db.stmt(`SELECT r.kind, coalesce(r.workstream, tr.workstream) AS ws FROM records r LEFT JOIN track_items ti ON ti.task = r.key
    LEFT JOIN records tr ON tr.key = ti.track WHERE r.key = ?`).get(key);
  if (r) return r.kind === 'workstream' ? key : r.ws || null;
  const h = db.stmt('SELECT t.workstream FROM handoffs h JOIN records t ON t.key = h.track WHERE h.key = ?').get(key);
  return h ? h.workstream : null;
}

/* A gate names its task by key, or by a label from before the cutover. */
function gatedKeys(db, qKey) {
  return db.stmt(`SELECT l."to" AS t, r.key FROM links l LEFT JOIN records r ON r.key = l."to" WHERE l."from" = ? AND l.type = 'gates'`).all(qKey)
    .map((x) => x.key || (resolveRecord(db, x.t, { kinds: ['task'] }) || {}).key).filter(Boolean);
}

const SESSION_ID = /\bsession [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
/* the web names a session as "a session", never by its raw id */
export const withoutSessionIds = (s) => String(s || '').replace(SESSION_ID, 'a session');

/* Everything waiting on the user, each item with the workstreams it belongs to (wss): open
   questions, blocking first; the live handoffs' waiting-on-user lines; then the band's
   calls as bandCalls reads them, override requests apart from upkeep's own. */
function waitingItems(db, now) {
  const uniq = (xs) => [...new Set(xs.filter(Boolean))];
  const qs = openQuestions(db).map((q) => ({
    kind: 'question', id: q.label, key: q.key, text: q.title, blocking: q.blocking, created: q.created,
    project: q.project || '', projectRepo: q.projectRepo || '', projectDir: q.projectDir || '', ws: q.workstream ? labelOf(db, q.workstream) : '',
    gates: gatedBy(db, q.key), wss: uniq([q.workstream, ...gatedKeys(db, q.key).map((k) => wsOfKey(db, k))]),
  }));
  qs.sort((a, b) => (b.blocking - a.blocking) || String(a.created).localeCompare(String(b.created)));
  const read = bandCalls(db, {}, null, { now });
  const asks = read.asks.map((a) => ({ kind: 'handoff', id: a.track, key: a.trackKey, handoff: a.handoff, handoffKey: a.handoffKey, text: a.text, at: a.at, wss: uniq([a.workstream]) }));
  const calls = [];
  for (const row of read.rows) {
    const presses = row.presses.map((p) => ({ label: p.label, url: p.url || '' }));
    if (row.kind === 'override') {
      const keys = db.stmt('SELECT record FROM override_items WHERE request = ?').all(row.request).map((x) => x.record);
      calls.push({ kind: 'override', request: row.request, count: row.count, text: row.text, presses, at: row.since, wss: uniq(keys.map((k) => wsOfKey(db, k))) });
    } else {
      calls.push({ kind: 'call', call: row.kind, id: row.id || '', key: row.record, text: withoutSessionIds(row.text), presses, at: row.since, wss: uniq([row.record && wsOfKey(db, row.record)]) });
    }
  }
  calls.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'override' ? -1 : 1));
  return qs.concat(asks, calls).map((i) => ({ ...i, wsIds: i.wss.map((k) => labelOf(db, k)) }));
}

const faceOfItems = (items) => (items.some((i) => i.blocking) ? 'blocking' : items.length ? 'waiting' : 'quiet');
const needsFrom = (items) => ({ items, face: faceOfItems(items), count: items.length });
const needsIn = (items, wsKey) => needsFrom(items.filter((i) => i.wss.includes(wsKey)));

/* The tab icon's face, from the same reading. */
export const faceNow = (db, opts = {}) => readTx(db, () => faceOfItems(waitingItems(db, nowOf(opts))));

const wsRow = (db, key) => db.stmt("SELECT key, label, title, status FROM records WHERE key = ? AND kind = 'workstream'").get(key);

/* ---- the three views ---------------------------------------------------------- */

export function overviewModel(db, opts = {}) {
  return readTx(db, () => {
    const now = nowOf(opts);
    const all = waitingItems(db, now);
    const cards = [];
    const quiet = [];
    for (const w of db.stmt("SELECT key, label, title FROM records WHERE kind = 'workstream' AND status = 'open' ORDER BY id").all()) {
      const ls = listTracks(db, { workstream: w.key }, { now });
      if (!ls.tracks.length) { quiet.push({ id: w.label, name: w.title, inbox: ls.inbox, inboxStalled: ls.inboxStalled, needs: needsIn(all, w.key).count }); continue; }
      const views = ls.tracks.map((t) => trackView(db, { track: t.key }, { now }));
      const G = graphFrom(db, views, now, { layout: false });
      const needs = needsIn(all, w.key);
      /* each track's newest by chain, then the latest of those */
      const last = G.g.tracks
        .map((t) => db.stmt('SELECT key, label, created, focus FROM handoffs WHERE track = ? ORDER BY ' + NEWEST_FIRST + ' LIMIT 1').get(t.key))
        .filter(Boolean).sort((x, y) => String(y.created).localeCompare(String(x.created)))[0];
      const moved = G.g.tracks.map((t) => Date.parse(t.last) || 0).reduce((a, b) => Math.max(a, b), 0);
      /* each track's next step, as the Tracks tab shows it */
      const handoffs = Object.fromEntries(G.g.tracks.map((t) => [t.id, liveHandoff(db, t.key)]));
      cards.push({ ws: { id: w.label, key: w.key, name: w.title, inbox: ls.inbox, inboxStalled: ls.inboxStalled }, ...G, needs, lastHandoff: last || null, moved, handoffs });
    }
    const live = (c) => c.g.tracks.some((t) => c.D.tracks[t.id].state === 'active');
    cards.sort((a, b) => (live(b) - live(a)) || (b.needs.count - a.needs.count) || (b.moved - a.moved));
    const needs = needsFrom(all);
    return { now, seq: lastSeq(db), cards, quiet, stallDays: stallDays(db), procedures: proceduresOf(db), needs, face: needs.face };
  });
}

/* every live card with its staleness, the ones to look at first; retired ones only counted. */
const BADGE_ORDER = ['flagged', 'stale', 'never run', 'fresh'];
const lastPart = (p) => String(p || '').replace(/\\/g, '/').split('/').filter(Boolean).pop() || '';
function proceduresOf(db) {
  const all = procedureCards(db);
  const live = all.filter((c) => c.status !== 'retired').map((c) => ({
    id: c.id, key: c.key, name: c.name, badge: c.badge, reasons: c.reasons, verifiedAt: c.verifiedAt, runs: c.runs,
    /* a mapped card leaves project empty: its shared name's last part */
    project: lastPart(c.project) || lastPart(c.projectRepo),
  }));
  live.sort((a, b) => BADGE_ORDER.indexOf(a.badge) - BADGE_ORDER.indexOf(b.badge) || Number(a.id.slice(3)) - Number(b.id.slice(3)));
  return { cards: live, retired: all.length - live.length };
}

/* Every open workstream, for the switcher (one with no track yet too). */
function openWorkstreams(db) {
  return db.stmt("SELECT label, title FROM records WHERE kind = 'workstream' AND status = 'open' ORDER BY id").all()
    .map((w) => ({ id: w.label, name: w.title }));
}

/* The workstream's inbox: its open tasks on no track, oldest first (tracks.mjs INBOX). */
const inboxOf = (db, wsKey) => db.stmt(`SELECT r.key, r.label AS id, r.title AS name, r.status, r.created FROM records r
  WHERE r.kind = 'task' AND r.workstream = ? AND coalesce(r.status, '') NOT IN ('completed', 'dropped')
    AND NOT EXISTS (SELECT 1 FROM track_items ti WHERE ti.task = r.key) ORDER BY r.created, r.label`).all(wsKey);

export function workstreamModel(db, wsKey, opts = {}) {
  return readTx(db, () => {
    const now = nowOf(opts);
    const w = wsRow(db, wsKey);
    const view = workstreamView(db, { workstream: w.key }, { now });
    const G = graphFrom(db, view.tracks, now);
    return { now, seq: lastSeq(db), stallDays: stallDays(db), ws: { id: w.label, key: w.key, name: w.title, status: w.status, inbox: view.inbox, inboxStalled: view.inboxStalled }, ...G,
      needs: needsIn(waitingItems(db, now), w.key), switcher: openWorkstreams(db), inboxList: inboxOf(db, w.key) };
  });
}

/* Questions asked on a track: by a session while it held the track, gating its tasks,
   or naming it. Lease spans come from the activity rows the lease verbs write. */
function trackQuestions(db, trackKey, taskKeys) {
  const spans = [];
  const open = {};
  for (const r of db.stmt(`SELECT at, json_extract(line, '$.changes.session') AS s FROM activity
      WHERE record = ? AND json_extract(line, '$.changes.session') IS NOT NULL ORDER BY seq`).all(trackKey)) {
    const s = parse(r.s);
    if (!Array.isArray(s)) continue;
    if (s[0] && open[s[0]]) { spans.push({ session: s[0], from: open[s[0]], to: r.at }); delete open[s[0]]; }
    if (s[1]) open[s[1]] = r.at;
  }
  for (const [session, from] of Object.entries(open)) spans.push({ session, from, to: null });
  const keys = new Set();
  for (const sp of spans) {
    for (const q of db.stmt(`SELECT key, json_extract(fields, '$.created') AS created FROM records
        WHERE kind = 'question' AND json_extract(fields, '$.session') = ?`).all(sp.session)) {
      const t = Date.parse(q.created);
      if (t >= Date.parse(sp.from) && (!sp.to || t <= Date.parse(sp.to))) keys.add(q.key);
    }
  }
  if (taskKeys.length) {
    for (const r of db.stmt(`SELECT l."from" AS key FROM links l JOIN records q ON q.key = l."from" AND q.kind = 'question'
        WHERE l.type = 'gates' AND l."to" IN (${IN})`).all(JSON.stringify(taskKeys))) keys.add(r.key);
  }
  for (const r of db.stmt("SELECT key FROM records WHERE kind = 'question' AND (track = ? OR json_extract(fields, '$.track') = ?)").all(trackKey, trackKey)) keys.add(r.key);
  return [...keys].map((k) => loadEntry(db, k)).filter(Boolean)
    .map((e) => ({ id: e.label, key: e.key, name: e.front.name, status: e.front.status, pick: e.front.pick || '', created: e.front.created,
      gates: gatedBy(db, e.key) }))
    .sort((a, b) => (b.status === 'open') - (a.status === 'open') || String(b.created).localeCompare(String(a.created)));
}

function handoffsOf(db, trackKey, before) {
  const rows = before
    ? db.stmt('SELECT key, label, fields, status, verify, created FROM handoffs WHERE track = ? AND created < ? ORDER BY ' + NEWEST_FIRST + ' LIMIT 2').all(trackKey, before)
    : db.stmt('SELECT key, label, fields, status, verify, created FROM handoffs WHERE track = ? ORDER BY ' + NEWEST_FIRST).all(trackKey);
  return rows.map((h) => {
    const f = parse(h.fields) || {};
    return { id: h.label, key: h.key, status: h.status, live: LIVE_HANDOFF.includes(h.status), created: h.created, focus: f.focus || '',
      waitingOnUser: waitingOf(f), verify: verifyRows(h.verify), growth: growthOf(db, f.growth) };
  });
}

/* When each running task started: its last move to in progress. */
const startedAt = (db, key) => (db.stmt(`SELECT at FROM activity WHERE record = ?
  AND json_extract(line, '$.changes.status[1]') = 'in_progress' ORDER BY seq DESC LIMIT 1`).get(key) || {}).at || null;

export function trackModel(db, trackKey, opts = {}) {
  return readTx(db, () => {
    const now = nowOf(opts);
    const rec = loadEntry(db, trackKey);
    const ws = wsRow(db, rec.front.workstream);
    const all = workstreamView(db, { workstream: rec.front.workstream }, { now }).tracks;
    const tv = all.find((v) => v.key === trackKey) || trackView(db, { track: trackKey }, { now });
    if (!all.includes(tv)) all.push(tv);
    /* the page draws this line with its parents, side lines and the lines it waits on or holds */
    const keep = linesTouching(layoutInput(all), tv.id);
    const G = graphFrom(db, all.filter((v) => keep.has(v.id)), now);
    const done = db.stmt(`SELECT r.key, r.label AS id, r.title AS name, r.status FROM track_items ti JOIN records r ON r.key = ti.task
      WHERE ti.track = ? AND r.status IN ('completed', 'dropped') ORDER BY ti.position`).all(trackKey);
    const since = {};
    for (const t of tv.tasks) if (t.status === 'in_progress') since[t.id] = startedAt(db, t.key);
    const j = tv.junction || {};
    const parent = j.track ? { id: j.track.id, key: j.track.key, name: (loadEntry(db, j.track.key) || { front: {} }).front.name, state: j.track.state } : null;
    const jtask = j.task ? { id: j.task.id, key: j.task.key, name: (loadEntry(db, j.task.key) || { front: {} }).front.name } : null;
    const sides = tv.sideTracks.map((s) => {
      const e = loadEntry(db, s.key);
      const c = db.stmt(`SELECT count(*) AS total, sum(r.status = 'completed') AS done FROM track_items ti JOIN records r ON r.key = ti.task
        WHERE ti.track = ? AND r.status <> 'dropped'`).get(s.key);
      const at = db.stmt(`SELECT r.key, r.label FROM links l JOIN records r ON r.key = l."to" AND r.kind = 'task' WHERE l."from" = ? AND l.type = 'junction'`).get(s.key);
      return { id: s.id, key: s.key, name: e.front.name, state: s.state, promoted: e.front.origin === 'promote', at: at ? at.label : '', atKey: at ? at.key : null, done: c.done || 0, total: c.total };
    });
    const pickList = db.stmt(`SELECT t.key, t.label AS id, t.title AS name, w.label AS ws FROM records t LEFT JOIN records w ON w.key = t.workstream
      WHERE t.kind = 'track' AND (coalesce(t.status, '') NOT IN ('done', 'dropped', 'folded') OR t.key = ?) ORDER BY w.id, t.id`).all(trackKey);
    return {
      now, seq: lastSeq(db), ws: { id: ws ? ws.label : '', name: ws ? ws.title : '' }, track: tv, record: rec.front, ...G,
      done, since, handoffs: handoffsOf(db, trackKey),
      before: parent ? handoffsOf(db, parent.key, rec.front.created) : [],
      questions: trackQuestions(db, trackKey, tv.tasks.map((t) => t.key)),
      parent, jtask, promoted: rec.front.origin === 'promote', sides, pickList,
    };
  });
}

/* ---- records by label ----------------------------------------------------------- */

/* A label today, on a day (`at`), a key, or a legacy brain id, to its record; with
   every other record that held the label, so an old reference finds its own. */
export function findRecord(db, token, { at } = {}) {
  return readTx(db, () => {
    const t = String(token || '').trim();
    let e = null;
    if (at && canonLabel(t)) {
      const hit = resolveLabel(db, t, { at }).record;
      if (hit) e = resolveRecord(db, hit.key);
      else {
        /* a day after one holder left and before the next came: the one that had it last */
        const day = String(at).slice(0, 10);
        const r = resolveLabel(db, t);
        const last = [r.live, ...r.earlier].filter((h) => h && h.from && h.from <= day).sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0)).pop();
        if (last) e = resolveRecord(db, last.key);
      }
    }
    if (!e) e = resolveRecord(db, t);
    if (!e && parseLegacyToken(t)) {
      try {
        const r = resolveLegacy(db, t);
        const to = r.entry && (r.entry.to || r.entry.label);
        if (to) e = resolveRecord(db, to);
      } catch { e = null; }
    }
    if (!e) return null;
    let holders = [];
    const label = canonLabel(t);
    if (label && !/\.\d+$/.test(label)) {
      try {
        const r = resolveLabel(db, label);
        holders = [r.live, ...r.earlier].filter(Boolean).filter((h) => h.key !== e.key)
          .map((h) => ({ key: h.key, kind: h.kind, name: h.name, now: h.now, from: h.from, to: h.to }));
      } catch { holders = []; }
    }
    return { key: e.key, kind: e.kind, label: e.label, holders };
  });
}

export function recordModel(db, key) {
  return readTx(db, () => {
    const e = resolveRecord(db, key);
    if (!e) return null;
    if (e.kind === 'handoff') {
      const h = db.stmt('SELECT label, fields, state, where_we_were, verify, track, created FROM handoffs WHERE key = ?').get(e.key);
      const f = parse(h.fields) || {};
      /* one the merge left off a track (its thread was gone) still names that thread */
      const holder = h.track || f.thread;
      return {
        kind: 'handoff', key: e.key, label: h.label, status: f.status, title: f.focus || '', created: h.created,
        facts: [['on', holder && isKey(holder) ? labelOf(db, holder) : ''], ['written by', f.fromSession ? 'a session' + (f.pc ? ' on ' + f.pc : '') : ''], ['written', h.created]],
        waitingOnUser: waitingOf(f), body: (h.state || '') + (h.where_we_were ? '\n\n## Where we were\n\n' + h.where_we_were : ''),
        verify: verifyRows(h.verify), growth: growthOf(db, f.growth), notes: [],
      };
    }
    const front = shownFront(db, e.front);
    /* a close or unpark condition reads in words, its record a link */
    if (e.front.close) front.close = closeText(db, e.front.close);
    if (e.front.unparkWhen) front.unparkWhen = unparkWords(db, e.front.unparkWhen) || whenText(db, e.front.unparkWhen);
    const notes = db.stmt('SELECT at, actor, body FROM notes WHERE record = ? ORDER BY position').all(e.key);
    /* each field's reference by the key it holds, so an ended one opens its own record */
    const refs = {};
    for (const v of Object.values(e.front)) for (const x of [].concat(v && typeof v === 'object' && !Array.isArray(v) ? v.on : v)) if (isKey(x)) refs[labelOf(db, x)] = x;
    const out = { kind: e.kind, key: e.key, label: e.label, status: front.status || '', title: front.name || front.focus || '', front, refs, body: e.body || '', notes };
    /* the record's old texts, and an override waiting on it */
    out.history = db.stmt('SELECT id, at, actor, field, old, new, why FROM history WHERE record = ? ORDER BY id').all(e.key);
    const pending = db.stmt('SELECT request FROM override_items WHERE record = ?').get(e.key);
    if (pending) out.override = pending.request;
    if (e.kind === 'task') {
      const tr = db.stmt('SELECT r.key, r.label FROM track_items ti JOIN records r ON r.key = ti.track WHERE ti.task = ?').get(e.key);
      out.track = tr ? tr.label : '';
      out.trackKey = tr ? tr.key : null;
      out.checklist = db.stmt('SELECT text, done FROM checklist WHERE task = ? ORDER BY position').all(e.key);
      /* a claimant shows only while a live hand backs it, the task in its hand or its track's lease */
      if (Array.isArray(front.claimants)) {
        const lease = out.trackKey ? db.stmt('SELECT session FROM leases WHERE track = ?').get(out.trackKey) : null;
        out.front = { ...front, claimants: front.claimants.filter((s) => s === e.front.inHand || (lease && lease.session === s)) };
      }
      /* where it stands: ready or what holds it, what waits on it, the questions gating it */
      const home = (out.trackKey && wsOfRecord(db, out.trackKey)) || wsOfRecord(db, e.key);
      out.dependsOn = db.stmt(`SELECT t.key, t.label, t.title, t.status, tr.label AS track, w.key AS wsKey, w.label AS ws
        FROM depends d CROSS JOIN records t ON t.key = d."on" ${PLACE} WHERE d.task = ? ORDER BY t.label`).all(e.key)
        .map((d) => ({ key: d.key, label: d.label, title: d.title, status: d.status, ...placeOf(d, home) }));
      out.neededBy = neededOf(db, [e.key], home).get(e.key) || [];
      /* a gate names the task by key, or by a label from before the cutover: two index lookups */
      out.gatedBy = db.stmt(`SELECT DISTINCT q.key, q.label, q.title, json_extract(q.fields, '$.blocking') AS blocking FROM
        (SELECT "from" AS f FROM links WHERE "to" = ? AND type = 'gates'
          UNION SELECT l."from" FROM labels lb CROSS JOIN links l ON l."to" = lb.label AND l.type = 'gates' WHERE lb.key = ?) x
        CROSS JOIN records q ON q.key = x.f WHERE q.kind = 'question' AND coalesce(q.status, '') NOT IN ('answered', 'dropped') ORDER BY q.label`).all(e.key, e.key)
        .map((q) => ({ ...q, blocking: q.blocking === 1 || q.blocking === true || q.blocking === 'true' }));
      if (!['completed', 'dropped'].includes(front.status)) {
        const r = readiness(db, e.key);
        out.readiness = { ready: r.ready, side: r.pointer };
      }
    }
    if (e.kind === 'question') {
      /* the option slots (headline, why pick, why not, undo), read from the stored table */
      out.options = parseOptions(questionSections(e.body || '', '').sections['Options']);
      out.chosen = front.status === 'answered' ? answeredPick({ id: e.label, answer: notes.map((n) => n.body).join('\n\n'), options: out.options }) : null;
      out.gates = db.stmt(`SELECT r.key, coalesce(r.label, l."to") AS label FROM links l LEFT JOIN records r ON r.key = l."to"
        WHERE l."from" = ? AND l.type = 'gates'`).all(e.key);
    }
    return out;
  });
}

/* Each verify-first repo with the check the handoff write ran: ok true or false,
   or null for one written before the check was kept. */
function verifyRows(verify) {
  return (parse(verify) || []).map((v) => ({
    repo: String(v.path || '').replace(/\\/g, '/').split('/').filter(Boolean).pop() || String(v.path || ''),
    branch: v.branch || '', commit: String(v.commit || '').slice(0, 7),
    ok: v.ok === true || v.ok === false ? v.ok : null, problems: Array.isArray(v.problems) ? v.problems.map(String) : [],
  }));
}

/* the growth line and the tasks added with their outcomes, its `since` as a label. */
function growthOf(db, g) {
  if (!g || typeof g !== 'object') return [];
  const since = g.since ? (db.stmt('SELECT label FROM handoffs WHERE key = ?').get(g.since) || {}).label : undefined;
  return growthLines(db, { ...g, since });
}

/* The open set, one project's when named: `repo` its shared name (every link mints it), `project` the short
   name an older link carries. A question from before the map is named by its folder, as the scope rule reads
   it; anything else by the projects of the workstreams it sits in (upkeep scopeOf's reading). */
export function needsYouModel(db, { repo, project } = {}, opts = {}) {
  return readTx(db, () => {
    const r = String(repo || '').trim().toLowerCase();
    const p = r ? '' : String(project || '').trim().toLowerCase();
    const norm = (s) => String(s || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    const last = (s) => norm(s).split('/').filter(Boolean).pop() || '';
    const nameOf = (q) => norm(q.projectRepo || q.projectDir);
    const wsNames = new Map();
    const namesOf = (k) => {
      if (!wsNames.has(k)) {
        const w = db.stmt("SELECT json_extract(fields, '$.projectRepos') AS repos, json_extract(fields, '$.projects') AS dirs FROM records WHERE key = ?").get(k) || {};
        wsNames.set(k, [].concat(parse(w.repos) || [], parse(w.dirs) || []).map(String));
      }
      return wsNames.get(k);
    };
    const mine = (i) => {
      if (!r && !p) return true;
      if (i.kind === 'question') return r ? nameOf(i) === r : String(i.project || '').toLowerCase() === p;
      return i.wss.some((k) => namesOf(k).some((n) => (r ? norm(n) === r : last(n) === p)));
    };
    const needs = needsFrom(waitingItems(db, nowOf(opts)).filter(mine));
    return { seq: lastSeq(db), project: r ? r.split('/').filter(Boolean).pop() : p, ...needs };
  });
}

/* FTS5 over titles, bodies, notes and handoffs; every word a quoted term, so nothing the user types is syntax. */
export function searchModel(db, text, limit = 60) {
  const terms = String(text || '').split(/\s+/).filter(Boolean).slice(0, 12);
  if (!terms.length) return { text: '', hits: [] };
  const match = terms.map((t) => '"' + t.replace(/"/g, '""') + '"').join(' ');
  return readTx(db, () => {
    const seen = new Set();
    const hits = [];
    for (const r of db.stmt('SELECT key, src FROM search WHERE search MATCH ? ORDER BY rank LIMIT ?').all(match, limit * 2)) {
      if (seen.has(r.key)) continue;
      seen.add(r.key);
      const rec = db.stmt('SELECT label, kind, title, status FROM records WHERE key = ?').get(r.key);
      const h = rec ? null : db.stmt('SELECT label, focus, status FROM handoffs WHERE key = ?').get(r.key);
      if (rec) hits.push({ id: rec.label, key: r.key, kind: rec.kind, name: rec.title || '', status: rec.status || '', note: r.src === 'note' });
      else if (h) hits.push({ id: h.label, key: r.key, kind: 'handoff', name: h.focus || '', status: h.status || '' });
      if (hits.length >= limit) break;
    }
    return { text: terms.join(' '), hits };
  });
}

export const workstreamKey = (db, label) => {
  const e = resolveRecord(db, label, { kinds: ['workstream'] });
  return e ? e.key : null;
};

