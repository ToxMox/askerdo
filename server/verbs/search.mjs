/* Search as a read level: FTS5 over titles, bodies, notes and
   handoffs, each hit with its record's head and the lines that matched. The
   index is contentless, so the lines are found in each hit's own text. */
import { readTx } from '../db.mjs';
import { unguardHeadings } from '../records.mjs';
import { UsageError, resolveRecord } from './labels.mjs';

export const HITS_MAX = 50;
const HITS_DEFAULT = 20;
const LINES_MAX = 3;
const LINE_CUT = 200;
const TABS = ['questions', 'work', 'both'];

/* Each record's best-ranked row (its title and body, a note or a handoff) kept when it
   passes the tab (?2) and the workstream key (?3). */
const KEPT = `FROM %s m
  LEFT JOIN records r ON r.key = m.key
  LEFT JOIN handoffs h ON r.key IS NULL AND h.key = m.key
  WHERE (r.key IS NOT NULL OR h.key IS NOT NULL)
    AND (?2 = 'both' OR (?2 = 'questions') = (coalesce(r.kind, 'handoff') = 'question'))
    AND (?3 IS NULL OR coalesce(r.workstream, (SELECT t.workstream FROM records t WHERE t.key = h.track)) = ?3)`;
/* the best `limit` (?4) and the count of all */
const TOP_SQL = 'SELECT m.key, count(*) OVER () AS total ' + KEPT.replace('%s', '(SELECT key, min(rank) AS rank FROM search WHERE search MATCH ?1 GROUP BY key)')
  + ' ORDER BY m.rank LIMIT ?4';
const KEEP_SQL = 'SELECT 1 AS kept ' + KEPT.replace('%s', '(SELECT ?1 AS key)');

const clip = (s) => (s.length > LINE_CUT ? s.slice(0, LINE_CUT - 3) + '...' : s);

/* `texts` as stored: a section heading starts its line, a written # line carries the guard's space */
function matchingLines(texts, terms) {
  const low = terms.map((t) => t.toLowerCase());
  const out = [];
  for (const text of texts) {
    for (const raw of String(text || '').split('\n')) {
      if (/^#+ /.test(raw)) continue;
      const line = unguardHeadings(raw).replace(/\s+/g, ' ').trim();
      if (!line || out.includes(clip(line))) continue;
      if (low.some((t) => line.toLowerCase().includes(t))) out.push(clip(line));
      if (out.length >= LINES_MAX) return out;
    }
  }
  return out;
}

/* search(db, { text, limit, tab, workstream, count }): { text, hits, total }, best match first;
   count false leaves the total null and stops at the limit (a write's near check). */
export function search(db, input = {}) {
  const terms = String(input.text ?? '').split(/\s+/).filter(Boolean).slice(0, 12);
  if (!terms.length) throw new UsageError('search needs some words to look for');
  const limit = input.limit === undefined || input.limit === null ? HITS_DEFAULT : Number(input.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > HITS_MAX) throw new UsageError('--limit takes a whole number of hits, 1 to ' + HITS_MAX);
  const tab = input.tab === undefined || input.tab === null ? 'both' : input.tab;
  if (!TABS.includes(tab)) throw new UsageError('--tab is one of ' + TABS.join(', '));
  /* every word a quoted term, so nothing typed is FTS syntax */
  const match = terms.map((t) => '"' + t.replace(/"/g, '""') + '"').join(' ');
  return readTx(db, () => {
    let ws = null;
    if (input.workstream !== undefined && input.workstream !== null) {
      const w = resolveRecord(db, String(input.workstream), { kinds: ['workstream'] });
      if (!w) throw new UsageError('--ws names ' + input.workstream + ', which no workstream holds');
      ws = w.key;
    }
    /* the count reads every match, so a knowledge write's near check (three of
       these) walks the ranked rows only until it has its hits */
    let top, total = null;
    if (input.count === false) {
      top = [];
      const seen = new Set();
      for (const { key } of db.stmt('SELECT key FROM search WHERE search MATCH ? ORDER BY rank').iterate(match)) {
        if (seen.has(key)) continue;
        seen.add(key);
        if (db.stmt(KEEP_SQL).get(key, tab, ws)) top.push({ key });
        if (top.length >= limit) break;
      }
    } else {
      top = db.stmt(TOP_SQL).all(match, tab, ws, limit);
      total = top.length ? top[0].total : 0;
    }
    const hits = [];
    for (const { key } of top) {
      const rec = db.stmt('SELECT key, kind, label, title, status, workstream, body FROM records WHERE key = ?').get(key);
      const h = rec ? null : db.stmt('SELECT key, label, status, track, state, where_we_were, json_extract(fields, \'$.focus\') AS focus FROM handoffs WHERE key = ?').get(key);
      const kind = rec ? rec.kind : 'handoff';
      const texts = rec
        ? [rec.title, rec.body, ...db.stmt('SELECT body FROM notes WHERE record = ? ORDER BY position').all(key).map((n) => n.body)]
        : [h.focus, h.state, h.where_we_were];
      hits.push({
        id: (rec ? rec.label : h.label) || key, key, kind, name: (rec ? rec.title : h.focus) || '', status: (rec ? rec.status : h.status) || '',
        lines: matchingLines(texts, terms),
      });
    }
    return { text: terms.join(' '), hits, total };
  });
}
