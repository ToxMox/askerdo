/* What waits on the user: one reading every view counts from, the web pages and the
   picture's Overview alike, so it lives with the verbs and server/web imports it. */
import { labelOf } from '../records.mjs';
import { resolveRecord } from './labels.mjs';
import { bandCalls } from './upkeep.mjs';

function openQuestions(db) {
  return db.stmt(`SELECT key, label, title, json_extract(fields, '$.blocking') AS blocking, workstream,
      json_extract(fields, '$.project') AS project, json_extract(fields, '$.projectRepo') AS projectRepo,
      json_extract(fields, '$.projectDir') AS projectDir, json_extract(fields, '$.created') AS created
      FROM records WHERE kind = 'question' AND status = 'open' ORDER BY id`).all()
    .map((q) => ({ ...q, blocking: q.blocking === 1 || q.blocking === true || q.blocking === 'true' }));
}

/* the snoozed questions, apart from what waits on the user, so no view counts them;
   the waking record by label for the words and by key for its link */
export function asleepQuestions(db) {
  return db.stmt(`SELECT key, label, title, json_extract(fields, '$.snooze') AS snooze, json_extract(fields, '$.project') AS project,
      json_extract(fields, '$.projectRepo') AS projectRepo, json_extract(fields, '$.projectDir') AS projectDir
      FROM records WHERE kind = 'question' AND status = 'snoozed' ORDER BY id`).all().map((q) => {
    let s = {};
    try { s = JSON.parse(q.snooze || '{}') || {}; } catch { s = {}; }
    const on = typeof s.wakeOn === 'string' ? s.wakeOn : '';
    const label = on ? labelOf(db, on) : '';
    return {
      kind: 'question', id: q.label, key: q.key, text: q.title, project: q.project || '', projectRepo: q.projectRepo || '', projectDir: q.projectDir || '',
      snooze: on ? { ...s, wakeOn: label } : s, wakeKey: on && label !== on ? on : '',
    };
  });
}

export const gatedBy = (db, qKey) => db.stmt(`SELECT coalesce(r.label, l."to") AS label FROM links l LEFT JOIN records r ON r.key = l."to"
  WHERE l."from" = ? AND l.type = 'gates'`).all(qKey).map((r) => r.label);

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
const withoutSessionIds = (s) => String(s || '').replace(SESSION_ID, 'a session');

/* Everything waiting on the user, each item with the workstreams it belongs to (wss): open
   questions, blocking first; the live handoffs' waiting-on-user lines; then the band's
   calls as bandCalls reads them, override requests apart from upkeep's own. */
export function waitingItems(db, now) {
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
