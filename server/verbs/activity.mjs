/* The activity log as a read: the board's rows newest first in
   today's line shape, `at` the row's sequence (the mod's change marker and the
   next page's cursor), with `places` each row's workstream and project. */
import { UsageError, loadEntry, resolveRecord } from './labels.mjs';
import { isKey } from '../records.mjs';

const DEFAULT_LIMIT = 50;
const PAGE = 500;
const MONTH_RE = /^\d{4}-\d{2}$/;
const STAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/;
const normDir = (d) => String(d || '').replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
const listOf = (v) => (Array.isArray(v) ? v : []);

/* A line's record as the places read it: its workstream's label, its folder and remote. */
function placer(db) {
  const memo = new Map();
  const ws = new Map();
  const wsOf = (key) => {
    if (!isKey(key)) return null;
    if (!ws.has(key)) {
      const e = loadEntry(db, key);
      ws.set(key, e && e.kind === 'workstream'
        ? { id: e.label, name: String(e.front.name || ''), names: listOf(e.front.projectRepos).concat(listOf(e.front.projects).map(normDir)) } : null);
    }
    return ws.get(key);
  };
  return (line) => {
    const key = line.key;
    if (!isKey(key)) return { ws: null, name: '', shown: null };
    if (!memo.has(key)) {
      let e = loadEntry(db, key);
      /* a handoff is placed by its track */
      const h = e ? null : db.stmt('SELECT track FROM handoffs WHERE key = ?').get(key);
      if (h && h.track) e = loadEntry(db, h.track);
      const f = (e && e.front) || {};
      const w = e && e.kind === 'workstream' ? wsOf(key) : wsOf(f.workstream);
      /* a record's shared name; one written before the map is named by its folder */
      const name = String(f.projectRepo || '') || normDir(f.projectDir);
      memo.set(key, { ws: w, name, shown: (typeof f.project === 'string' && f.project) || name || null });
    }
    return memo.get(key);
  };
}

/* `input`: { limit (50; 0 for all), before (a sequence or a full stamp), month, id,
   kind, search, places, project, projectRepo, workstream }. A project keeps the lines of the
   workstreams that name it and of records with no workstream asked from it; a workstream
   keeps its own lines, its records' and its tracks' handoffs', through the record index. */
export function activity(db, input = {}) {
  const { month, before, search, kind, id, places, project, projectRepo, workstream } = input || {};
  const cap = input && input.limit !== undefined ? Number(input.limit) : DEFAULT_LIMIT;
  if (!Number.isInteger(cap) || cap < 0) throw new UsageError('--limit takes a whole number of lines, or 0 for every one');
  const bound = cap === 0 ? Infinity : cap;
  if (month !== undefined && !MONTH_RE.test(String(month))) throw new UsageError('--month takes YYYY-MM: ' + month);
  const where = [];
  const args = [];
  if (before !== undefined && before !== null && before !== '') {
    const b = String(before).trim();
    if (/^\d+$/.test(b)) { where.push('seq < ?'); args.push(Number(b)); }
    else if (STAMP_RE.test(b)) { where.push('at < ?'); args.push(b); }
    else throw new UsageError('--before takes the cursor a page printed or a full stamp: ' + b);
  }
  if (month !== undefined) { where.push('substr(at, 1, 7) = ?'); args.push(String(month)); }
  if (kind !== undefined) { where.push('kind = ?'); args.push(String(kind)); }
  if (id !== undefined) {
    const e = resolveRecord(db, String(id));
    /* by key, so a recycled label's old lines stay out; a keyless line by its label */
    if (e) { where.push('(record = ? OR (record IS NULL AND lower(label) = lower(?)))'); args.push(e.key, String(id).trim()); }
    else { where.push('lower(label) = lower(?)'); args.push(String(id).trim()); }
  }
  if (workstream !== undefined && workstream !== null && workstream !== '') {
    const w = resolveRecord(db, String(workstream).trim(), { kinds: ['workstream'] });
    if (!w) throw new UsageError('unknown workstream id: ' + workstream);
    where.push(`record IN (SELECT ? UNION ALL SELECT key FROM records WHERE workstream = ?
      UNION ALL SELECT h.key FROM handoffs h JOIN records t ON t.key = h.track WHERE t.workstream = ?)`);
    args.push(w.key, w.key, w.key);
  }
  const needle = search === undefined || search === null || search === '' ? null : String(search).toLowerCase();
  if (needle !== null) { where.push('instr(lower(line), ?) > 0'); args.push(needle); }
  const want = (typeof projectRepo === 'string' && projectRepo) || (project ? normDir(project) : '');
  const place = places || want ? placer(db) : null;
  const sql = 'SELECT seq, line, pc FROM activity' + (where.length ? ' WHERE ' + where.join(' AND ') : '');
  const lines = [];
  const wsNames = {};
  let cursor = null;
  let more = false;
  for (;;) {
    const page = db.stmt(sql + (cursor === null ? '' : (where.length ? ' AND' : ' WHERE') + ' seq < ?') + ' ORDER BY seq DESC LIMIT ?')
      .all(...args, ...(cursor === null ? [] : [cursor]), PAGE);
    for (const r of page) {
      cursor = r.seq;
      const l = JSON.parse(r.line);
      const p = place ? place(l) : null;
      if (want) {
        const ok = p.ws ? p.ws.names.includes(want) : p.name === want;
        if (!ok) continue;
      }
      if (lines.length >= bound) { more = true; break; }
      const out = { ...l, at: String(r.seq), seq: r.seq, ...(r.pc ? { pc: r.pc } : {}) };
      if (places) {
        out.ws = p.ws ? p.ws.id : null;
        out.project = p.shown;
        if (p.ws) wsNames[p.ws.id] = p.ws.name;
      }
      lines.push(out);
    }
    if (more || page.length < PAGE) break;
  }
  return { lines, nextBefore: more ? String(lines[lines.length - 1].seq) : null, ...(places ? { wsNames } : {}) };
}
