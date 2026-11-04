/* The browse views' reads: the activity feed and the rulings, each one read
   transaction over indexed rows. Read only. */
import { readTx } from '../db.mjs';
import { isKey } from '../records.mjs';
import { activity } from '../verbs/activity.mjs';
import { resolveRecord } from '../verbs/labels.mjs';
import { lastSeq } from '../verbs/snapshot.mjs';
import { feedRows } from './feed.mjs';

export const FEED_PAGE = 100;
export const RULINGS_PAGE = 50;
/* rows each group shows on the rulings index; the group's own page has the rest */
const INDEX_ROWS = 3;
export const RULING_KINDS = ['question', 'decision', 'knowledge'];

const normDir = (d) => String(d || '').replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
const lastPart = (n) => String(n || '').split('/').filter(Boolean).pop() || '';
const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };
const listOf = (v) => (Array.isArray(v) ? v : []);

const openWorkstreams = (db) => db.stmt("SELECT key, label, title FROM records WHERE kind = 'workstream' AND status = 'open' ORDER BY id").all()
  .map((w) => ({ key: w.key, id: w.label, name: w.title || '' }));

const wsOf = (db, token) => {
  const e = token ? resolveRecord(db, String(token).trim(), { kinds: ['workstream'] }) : null;
  return e ? { key: e.key, id: e.label, name: String(e.front.name || ''), status: String(e.front.status || '') } : null;
};

/* ---- the activity feed ---- */

/* One page of the log, newest first, as the app's feed words it; `ws` keeps one
   workstream's lines, `before` the cursor the last page printed. Throws UsageError on
   an unknown workstream or a cursor that is not one. */
export function activityModel(db, { ws = '', before = '', now = Date.now() } = {}) {
  return readTx(db, () => {
    const w = ws ? wsOf(db, ws) : null;
    const read = activity(db, { limit: FEED_PAGE, places: true, ...(before ? { before } : {}), ...(ws ? { workstream: ws } : {}) });
    const bar = openWorkstreams(db);
    if (w && !bar.some((x) => x.key === w.key)) bar.push(w);
    return { seq: lastSeq(db), now, ws: w, before: before || '', older: read.nextBefore, rows: feedRows(read.lines, { now, wsNames: read.wsNames }), bar };
  });
}

/* ---- the rulings ---- */

/* Every answered question and every decision or knowledge record, light: what groups and
   orders them. A decision files under each workstream it links; the rest by project. */
function rulingRows(db, kind) {
  const rows = [];
  if (!kind || kind === 'question') {
    for (const q of db.stmt(`SELECT key, label, title, closed, created, workstream, json_extract(fields, '$.projectRepo') AS repo,
        json_extract(fields, '$.projectDir') AS dir FROM records WHERE kind = 'question' AND status = 'answered'`).all()) {
      const project = (typeof q.repo === 'string' && q.repo) || normDir(q.dir);
      rows.push({ key: q.key, id: q.label, name: q.title || '', kind: 'question', at: String(q.closed || q.created || ''),
        wss: q.workstream ? [q.workstream] : [], projects: project ? [project] : [], global: false });
    }
  }
  if (!kind || kind === 'decision' || kind === 'knowledge') {
    for (const k of db.stmt(`SELECT key, label, title, created, status, json_extract(fields, '$.type') AS type, json_extract(fields, '$.workstreams') AS wss,
        json_extract(fields, '$.projectRepos') AS repos, json_extract(fields, '$.scope') AS scope FROM records WHERE kind = 'knowledge'`).all()) {
      const type = k.type === 'decision' ? 'decision' : 'knowledge';
      if (kind && kind !== type) continue;
      rows.push({ key: k.key, id: k.label, name: k.title || '', kind: type, type: k.type || '', status: k.status || '', at: String(k.created || ''),
        wss: listOf(parse(k.wss)), projects: listOf(parse(k.repos)).map(String), global: k.scope === 'global' });
    }
  }
  return rows;
}

const newestFirst = (a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0) || (Number(String(b.id).replace(/\D/g, '')) - Number(String(a.id).replace(/\D/g, '')));

/* The groups: a workstream's by its key; a row with none under each project it names, else
   every project (a global record) or no project. */
function grouped(db, rows) {
  const groups = new Map();
  const memo = new Map();
  const wsKey = (v) => {
    if (!memo.has(v)) memo.set(v, isKey(v) ? v : (resolveRecord(db, String(v), { kinds: ['workstream'] }) || {}).key || null);
    return memo.get(v);
  };
  const add = (gk, r) => { if (!groups.has(gk)) groups.set(gk, []); groups.get(gk).push(r); };
  for (const r of rows) {
    const wss = [...new Set(r.wss.map(wsKey).filter(Boolean))];
    if (wss.length) { for (const k of wss) add('ws:' + k, r); continue; }
    if (r.projects.length) { for (const p of new Set(r.projects.map((x) => String(x).toLowerCase()))) add('project:' + p, r); continue; }
    add(r.global ? 'global' : 'none', r);
  }
  for (const list of groups.values()) list.sort(newestFirst);
  return groups;
}

/* What a group is called and where its own page is. */
function groupHead(db, gk) {
  if (gk.startsWith('ws:')) {
    const w = db.stmt("SELECT key, label, title, status FROM records WHERE key = ? AND kind = 'workstream'").get(gk.slice(3));
    return w ? { kind: 'ws', key: w.key, id: w.label, name: w.title || '', open: w.status === 'open', param: ['ws', w.key] } : null;
  }
  if (gk.startsWith('project:')) {
    const name = gk.slice(8);
    return { kind: 'project', key: name, id: '', name: lastPart(name) || name, open: true, param: ['project', name] };
  }
  return gk === 'global' ? { kind: 'global', key: 'global', id: '', name: 'Every project', open: true, param: ['project', 'global'] }
    : { kind: 'none', key: 'none', id: '', name: 'No project', open: true, param: ['project', 'none'] };
}

/* A shown row's words: an answered question's answer line up to its why, a decision's words. */
function detailed(db, r) {
  if (r.kind === 'question') {
    const n = db.stmt('SELECT body FROM notes WHERE record = ? ORDER BY position LIMIT 1').get(r.key);
    const first = String((n && n.body) || '').split(/\n\s*\n/)[0];
    return { ...r, words: first.split(/\.?\s+Why:\s/)[0].replace(/\s+/g, ' ').trim() };
  }
  const f = parse((db.stmt('SELECT fields FROM records WHERE key = ?').get(r.key) || {}).fields) || {};
  return { ...r, words: typeof f.words === 'string' ? f.words.replace(/\s+/g, ' ').trim() : '' };
}

const countsOf = (list) => ({
  question: list.filter((r) => r.kind === 'question').length,
  decision: list.filter((r) => r.kind === 'decision').length,
  knowledge: list.filter((r) => r.kind === 'knowledge').length,
});

/* The index (every group with its count and newest rows) or one group's page: `ws` a
   workstream's label or key, `project` a shared name, 'global' or 'none'; `kind` one of
   RULING_KINDS; `page` from 1. Null when the named group does not exist. */
export function rulingsModel(db, { ws = '', project = '', kind = '', page = 1 } = {}) {
  return readTx(db, () => {
    const k = RULING_KINDS.includes(kind) ? kind : '';
    const groups = grouped(db, rulingRows(db, k));
    const base = { seq: lastSeq(db), kind: k };
    if (ws || project) {
      let gk;
      if (ws) {
        const w = wsOf(db, ws);
        if (!w) return null;
        gk = 'ws:' + w.key;
      } else gk = project === 'global' || project === 'none' ? project : 'project:' + String(project).toLowerCase();
      const head = groupHead(db, gk);
      if (!head) return null;
      const list = groups.get(gk) || [];
      const pages = Math.max(1, Math.ceil(list.length / RULINGS_PAGE));
      const p = Math.min(Math.max(1, Math.floor(Number(page)) || 1), pages);
      return { ...base, group: { ...head, total: list.length, counts: countsOf(list) }, page: p, pages,
        rows: list.slice((p - 1) * RULINGS_PAGE, p * RULINGS_PAGE).map((r) => detailed(db, r)) };
    }
    const order = { ws: 0, project: 2, global: 3, none: 4 };
    const out = [...groups.entries()].map(([gk, list]) => {
      const head = groupHead(db, gk);
      return head && { ...head, total: list.length, counts: countsOf(list), newest: list[0].at, rows: list.slice(0, INDEX_ROWS).map((r) => detailed(db, r)) };
    }).filter(Boolean);
    const rank = (g) => order[g.kind] + (g.kind === 'ws' && !g.open ? 1 : 0);
    out.sort((a, b) => rank(a) - rank(b) || (a.newest < b.newest ? 1 : a.newest > b.newest ? -1 : 0));
    return { ...base, groups: out };
  });
}
