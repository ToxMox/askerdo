/* Decisions: a ruling is a knowledge record of type
   decision with optional links to what it governs. decide records one in one
   call; the reads find the ones in force for a task, a track or a workstream,
   and the triggers hand the mod the files and commands a ruling governs. */
import { readTx, tx } from '../db.mjs';
import { actorOf, labelOf, logRow } from '../records.mjs';
import { UsageError, loadEntry, resolveRecord, shownFront } from './labels.mjs';
import { knowledgePayload, markSuperseded, mintKnowledge, projectName } from './work.mjs';

const ACTIVE = `SELECT key, fields FROM records WHERE kind = 'knowledge' AND status = 'active'
  AND json_extract(fields, '$.type') = 'decision'`;

/* A bare day is local midnight, as a session reads a date. */
function timeOf(s) {
  const t = String(s ?? '').trim();
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (d) return new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3])).getTime();
  const n = Date.parse(t);
  return Number.isFinite(n) ? n : null;
}

function need(db, token, kind) {
  const e = resolveRecord(db, String(token ?? '').trim(), { kinds: [kind] });
  if (!e) throw new UsageError('unknown ' + kind + ' id: ' + token);
  return e;
}

const listOf = (f, k) => (Array.isArray(f[k]) ? f[k] : []);

/* A decision as the reads hand it out: links as labels, empty ones as []. */
function viewOf(db, f, memo) {
  const s = shownFront(db, f, memo);
  return {
    id: s.id, key: s.key, name: s.name, created: s.created || null, ...(s.amended ? { amended: s.amended } : {}),
    ...(s.words ? { words: s.words } : {}), ...(s.question ? { question: s.question } : {}),
    workstreams: listOf(s, 'workstreams'), tracks: listOf(s, 'tracks'), tasks: listOf(s, 'tasks'),
    files: listOf(s, 'files'), commands: listOf(s, 'commands'), labels: listOf(s, 'labels'),
  };
}

/* The track the session holds names the workstream and track a ruling governs when the payload names neither. */
function heldLinks(db, session) {
  const lease = session ? db.stmt('SELECT track FROM leases WHERE session = ?').get(session) : null;
  const t = lease ? loadEntry(db, lease.track) : null;
  if (!t) return {};
  return { tracks: [t.key], ...(t.front.workstream ? { workstreams: [t.front.workstream] } : {}) };
}

/* decide(db, { title, words, body, workstreams, tracks, tasks, files, commands, question,
   supersedes, projects | projectRepos | global, ... }, actor): mints the decision and
   supersedes the old ones in one transaction. */
export function decide(db, input = {}, actor) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new UsageError('decide takes a JSON object');
  const { supersedes, ...raw } = input;
  if (raw.type !== undefined && raw.type !== 'decision') throw new UsageError('decide records a decision; a gotcha is knowledge new --type gotcha');
  const olds = supersedes === undefined || supersedes === null ? [] : Array.isArray(supersedes) ? supersedes : [supersedes];
  if (olds.some((s) => typeof s !== 'string' || !s.trim())) throw new UsageError('supersedes takes a K-n or a list of them');
  const ctx = actorOf(actor);
  return tx(db, () => {
    const named = raw.workstreams !== undefined || raw.tracks !== undefined;
    const p = knowledgePayload({
      ...raw, type: 'decision', ...(named ? {} : heldLinks(db, ctx.session)), ...(raw.session === undefined && ctx.session ? { session: ctx.session } : {}),
    });
    /* the label WS-n rides with its workstream, so a read by label finds it too */
    for (const w of p.workstreams) {
      const e = resolveRecord(db, w, { kinds: ['workstream'], day: ctx.day });
      if (e && e.label && !p.labels.includes(e.label)) p.labels.push(e.label);
    }
    const old = [];
    for (const s of olds) {
      const e = resolveRecord(db, s.trim(), { kinds: ['knowledge'], day: ctx.day });
      if (!e) throw new UsageError('unknown knowledge id: ' + s.trim());
      if (e.front.type !== 'decision') throw new UsageError(e.label + ' is a ' + e.front.type + '; decide supersedes decisions (knowledge supersede replaces a gotcha)');
      if (e.front.status === 'superseded') {
        throw new UsageError(e.label + ' is already superseded' + (e.front.supersededBy ? ' by ' + labelOf(db, e.front.supersededBy) : ''));
      }
      if (e.front.status === 'withdrawn') throw new UsageError(e.label + ' is withdrawn: never ruled, so nothing supersedes it');
      if (!old.some((o) => o.key === e.key)) old.push(e);
    }
    const m = mintKnowledge(db, p, ctx);
    logRow(db, ctx, m.line);
    for (const e of old) logRow(db, ctx, markSuperseded(db, e, m.fields.key, ctx).line);
    return { ...viewOf(db, m.fields), kind: 'knowledge', type: 'decision', superseded: old.map((e) => e.label) };
  });
}

/* The active decisions linked to any of task, track or workstream (a track's tasks and
   its workstream count, and so does the workstream's label), made at or after `since`,
   newest first. Named none, every active decision. */
export function decisionsFor(db, input = {}) {
  const { task, track, workstream, since } = input || {};
  const t0 = since === undefined || since === null || since === '' ? null : timeOf(since);
  if (t0 === null && since !== undefined && since !== null && since !== '') throw new UsageError('--since takes YYYY-MM-DD or a full stamp: ' + since);
  return readTx(db, () => {
    const want = { tasks: new Set(), tracks: new Set(), workstreams: new Set(), labels: new Set() };
    const addWs = (key) => {
      want.workstreams.add(key);
      const l = labelOf(db, key);
      if (l !== key) want.labels.add(l);
    };
    if (task) want.tasks.add(need(db, task, 'task').key);
    if (track) {
      const e = need(db, track, 'track');
      want.tracks.add(e.key);
      for (const r of db.stmt('SELECT task FROM track_items WHERE track = ?').all(e.key)) want.tasks.add(r.task);
      if (e.front.workstream) addWs(e.front.workstream);
    }
    if (workstream) addWs(need(db, workstream, 'workstream').key);
    const any = Boolean(task || track || workstream);
    const hit = (f) => !any || ['tasks', 'tracks', 'workstreams', 'labels'].some((k) => listOf(f, k).some((v) => want[k].has(v)));
    const memo = new Map();
    return db.stmt(ACTIVE).all().map((r) => JSON.parse(r.fields))
      .filter((f) => hit(f) && (t0 === null || (timeOf(f.created) ?? -Infinity) >= t0))
      .sort((a, b) => (timeOf(b.created) ?? 0) - (timeOf(a.created) ?? 0) || Number(String(b.id).slice(2)) - Number(String(a.id).slice(2)))
      .map((f) => viewOf(db, f, memo));
  });
}

/* The kickoff's slice: the decisions on a track since its last leg began, which is the
   newest resume of any handoff but the one being carried (else the track's start). */
export function decisionsSince(db, input = {}) {
  return readTx(db, () => {
    const t = need(db, input.track, 'track');
    let since = null;
    const rows = db.stmt("SELECT key, label, json_extract(fields, '$.resumed') AS at FROM handoffs WHERE track = ? AND json_extract(fields, '$.resumed') IS NOT NULL").all(t.key);
    for (const h of rows) {
      if (input.handoff && (h.key === input.handoff || h.label === input.handoff)) continue;
      if (timeOf(h.at) !== null && (since === null || timeOf(h.at) > timeOf(since))) since = h.at;
    }
    since = since || t.front.created || null;
    return { since, decisions: decisionsFor(db, { track: t.key, since }) };
  });
}

/* Every active decision with files or commands, for the mod's watcher: a project's own
   (by its shared name) and the global ones; named no project, all of them. */
export function decisionTriggers(db, input = {}) {
  const project = input && typeof input.project === 'string' && input.project.trim() ? projectName(input.project) : null;
  return readTx(db, () => {
    const memo = new Map();
    return db.stmt(ACTIVE).all().map((r) => JSON.parse(r.fields))
      .filter((f) => (listOf(f, 'files').length || listOf(f, 'commands').length)
        && (!project || f.scope === 'global' || listOf(f, 'projectRepos').some((n) => projectName(n) === project)))
      .sort((a, b) => Number(String(a.id).slice(2)) - Number(String(b.id).slice(2)))
      .map((f) => ({
        id: f.id, key: f.key, name: f.name, ...(f.words ? { words: f.words } : {}), files: listOf(f, 'files'), commands: listOf(f, 'commands'),
        scope: f.scope, projectRepos: listOf(f, 'projectRepos'), tasks: listOf(shownFront(db, f, memo), 'tasks'),
      }));
  });
}
