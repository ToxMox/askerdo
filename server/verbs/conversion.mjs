/* a project's conversion map, keyed by source: what each onboard or doctor run read,
   at which hash, the records it became, each folder's end and each call's answer. A table of its own,
   so it stays out of search, lists, labels and the history rows. */
import { tx } from '../db.mjs';
import { actorOf } from '../records.mjs';
import { UsageError, heldSpans, resolveRecord } from './labels.mjs';
import { loadProfiles } from './profiles.mjs';
import { settingsOf } from './profile-rules.mjs';

export const MAP_KINDS = Object.freeze(['file', 'folder', 'call', 'run']);
const FATES = ['delete', 'move', 'keep'];
const LABEL = /^(?:[A-Z]{1,3}-\d+(?:\.\d+)?|Q\d+)$/;
const LINE = /^([a-z0-9][a-z0-9-]*)\/([a-z0-9][a-z0-9-]*)$/;
/* the runs a put keeps under a row, so an undo of a later run gives an earlier run's row back */
const PREV_MAX = 10;

/* a shared name as sharedName writes it: forward slashes, no trailing slash, lowercase */
export const projectName = (v) => String(v ?? '').trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const json = (s, d) => { try { return JSON.parse(s); } catch { return d; } };

function needProject(input) {
  const p = projectName(input && input.project);
  if (!p) throw new UsageError('the conversion map needs the project (its shared name)');
  return p;
}

function rowOf(r, gone) {
  const records = json(r.records, []);
  const lost = records.filter((id) => gone(id, String(r.at || '').slice(0, 10)));
  return {
    source: r.source, kind: r.kind, ...(r.hash ? { hash: r.hash } : {}), ...(r.sha ? { sha: r.sha } : {}), records,
    ...(r.fate ? { fate: r.fate } : {}), ...(r.why ? { why: r.why } : {}), ...(r.answer ? { answer: r.answer } : {}),
    detail: hidden(json(r.detail, {})), run: r.run, at: r.at, ...(lost.length ? { gone: lost } : {}),
  };
}
const hidden = ({ prev, ...d }) => d;

/* conversionMap { project }: every row, the newest run's row as last, and per row the record ids the board
   no longer holds (gone), which the doctor's check reads. */
export function conversionMap(db, input = {}) {
  const project = needProject(input);
  const seen = new Map();
  let lines = null;
  const lineGone = (name, slug) => {
    lines = lines || loadProfiles(db).profiles;
    return !(settingsOf(lines[name])['rules.add'] || []).some((l) => l && l.slug === slug);
  };
  /* a record id, a handoff (TR-n.m) or a rule line (profile/slug) the board no longer holds; a label
     a new record took after the row was written names a record gone, never the new one */
  const reusedSince = (e, id, day) => (heldSpans(e.kind, e.front).filter((s) => s.label === id).pop() || {}).from > day;
  const gone = (id, day) => {
    const line = LINE.exec(id);
    if (!LABEL.test(id) && !line) return false;
    const at = id + ' ' + day;
    if (!seen.has(at)) {
      const e = line ? null : resolveRecord(db, id);
      seen.set(at, line ? lineGone(line[1], line[2]) : !e || Boolean(day && reusedSince(e, id, day)));
    }
    return seen.get(at);
  };
  const rows = db.stmt('SELECT source, kind, hash, sha, records, fate, why, answer, detail, run, at FROM conversion WHERE project = ? ORDER BY source').all(project).map((r) => rowOf(r, gone));
  const runs = rows.filter((r) => r.kind === 'run').sort((a, b) => (Date.parse(a.at) || 0) - (Date.parse(b.at) || 0));
  return { project, last: runs.length ? runs[runs.length - 1] : null, rows };
}

function checkRow(x) {
  if (!x || typeof x !== 'object') throw new UsageError('each map row is an object { source, kind, ... }');
  const source = text(x.source);
  if (!source) throw new UsageError('each map row names its source');
  if (!MAP_KINDS.includes(x.kind)) throw new UsageError('a map row\'s kind is one of ' + MAP_KINDS.join(', ') + ' (' + source + ')');
  if (x.fate !== undefined && x.fate !== null && !FATES.includes(x.fate)) throw new UsageError('a folder\'s end is one of ' + FATES.join(', ') + ' (' + source + ')');
  const records = Array.isArray(x.records) ? [...new Set(x.records.map((r) => String(r).trim()).filter(Boolean))] : [];
  const detail = x.detail && typeof x.detail === 'object' && !Array.isArray(x.detail) ? x.detail : {};
  return { source, kind: x.kind, hash: text(x.hash), sha: text(x.sha), records, fate: text(x.fate), why: text(x.why), answer: text(x.answer), detail };
}

/* conversionPut { project, run, rows }: one batch, each row put whole under its source, stamped with the run;
   the row it replaces from another run rides under it as prev, for the undo. */
export function conversionPut(db, input = {}, actor) {
  const project = needProject(input);
  const run = text(input.run);
  if (!run) throw new UsageError('a map write names its run');
  if (!Array.isArray(input.rows)) throw new UsageError('rows is a list of map rows');
  const rows = input.rows.map(checkRow);
  const { at } = actorOf(actor);
  return tx(db, () => {
    const put = db.stmt(`INSERT INTO conversion (project, source, kind, hash, sha, records, fate, why, answer, detail, run, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (project, source) DO UPDATE SET kind = excluded.kind, hash = excluded.hash, sha = excluded.sha, records = excluded.records, fate = excluded.fate,
      why = excluded.why, answer = excluded.answer, detail = excluded.detail, run = excluded.run, at = excluded.at`);
    const old = db.stmt('SELECT kind, hash, sha, records, fate, why, answer, detail, run, at FROM conversion WHERE project = ? AND source = ?');
    for (const r of rows) {
      const was = old.get(project, r.source);
      const prev = !was ? null : was.run === run ? json(was.detail, {}).prev || null : capped(stored(was));
      put.run(project, r.source, r.kind, r.hash, r.sha, JSON.stringify(r.records), r.fate, r.why, r.answer, JSON.stringify(prev ? { ...r.detail, prev } : r.detail), run, at);
    }
    return { project, run, put: rows.length };
  });
}

const stored = (r) => ({ kind: r.kind, hash: r.hash, sha: r.sha, records: json(r.records, []), fate: r.fate, why: r.why, answer: r.answer, detail: json(r.detail, {}), run: r.run, at: r.at });
function capped(row, n = PREV_MAX) {
  const { prev, ...d } = row.detail || {};
  return { ...row, detail: prev && n > 1 ? { ...d, prev: capped(prev, n - 1) } : d };
}
/* the row with the run's own versions taken out of its chain: an earlier run's row, or null when none is left */
function without(row, run) {
  if (!row) return null;
  const { prev, ...d } = row.detail || {};
  if (row.run === run) return without(prev, run);
  const back = without(prev, run);
  return { ...row, detail: back ? { ...d, prev: back } : d };
}

/* conversionDrop { project, run, keep }: the undo takes its run's rows off the map, giving back each earlier
   run's row it replaced; keep names sources to leave (one whose records the undo left standing). */
export function conversionDrop(db, input = {}) {
  const project = needProject(input);
  const run = text(input.run);
  if (!run) throw new UsageError('a map drop names its run');
  const keep = new Set((Array.isArray(input.keep) ? input.keep : String(input.keep || '').split(',')).map((s) => String(s).trim()).filter(Boolean));
  return tx(db, () => {
    let dropped = 0;
    let restored = 0;
    const rows = db.stmt("SELECT source, kind, hash, sha, records, fate, why, answer, detail, run, at FROM conversion WHERE project = ? AND (run = ? OR detail LIKE '%\"prev\"%')").all(project, run);
    const del = db.stmt('DELETE FROM conversion WHERE project = ? AND source = ?');
    const set = db.stmt('UPDATE conversion SET kind = ?, hash = ?, sha = ?, records = ?, fate = ?, why = ?, answer = ?, detail = ?, run = ?, at = ? WHERE project = ? AND source = ?');
    for (const r of rows) {
      if (keep.has(r.source)) continue;
      const was = stored(r);
      const back = without(was, run);
      if (JSON.stringify(back) === JSON.stringify(was)) continue;
      if (!back) { del.run(project, r.source); dropped++; continue; }
      set.run(back.kind, back.hash, back.sha, JSON.stringify(back.records), back.fate, back.why, back.answer, JSON.stringify(back.detail), back.run, back.at, project, r.source);
      if (r.run === run) restored++;
    }
    return { project, run, dropped, restored };
  });
}

/* projectsRename's part: the map moves with the project; { moved, held } */
export function conversionRename(db, from, to, { dryRun = false } = {}) {
  const moved = db.stmt('SELECT count(*) AS n FROM conversion WHERE project = ?').get(from).n;
  const held = db.stmt('SELECT count(*) AS n FROM conversion WHERE project = ?').get(to).n;
  if (moved && !held && !dryRun) db.stmt('UPDATE conversion SET project = ? WHERE project = ?').run(to, from);
  return { moved, held };
}
