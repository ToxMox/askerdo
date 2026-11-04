/* Search as a read level: FTS5 over titles, bodies, notes and
   handoffs, each hit with its record's head and the lines that matched. The
   index is contentless, so the lines are found in each hit's own text. */
import { readTx } from '../db.mjs';
import { UsageError, resolveRecord } from './labels.mjs';

export const HITS_MAX = 50;
const HITS_DEFAULT = 20;
const LINES_MAX = 3;
const LINE_CUT = 200;
const TABS = ['questions', 'work', 'both'];

const clip = (s) => (s.length > LINE_CUT ? s.slice(0, LINE_CUT - 3) + '...' : s);

function matchingLines(texts, terms) {
  const low = terms.map((t) => t.toLowerCase());
  const out = [];
  for (const text of texts) {
    for (const raw of String(text || '').split('\n')) {
      const line = raw.replace(/\s+/g, ' ').trim();
      if (!line || /^#+ /.test(line) || out.includes(clip(line))) continue;
      if (low.some((t) => line.toLowerCase().includes(t))) out.push(clip(line));
      if (out.length >= LINES_MAX) return out;
    }
  }
  return out;
}

/* search(db, { text, limit, tab, workstream }): { text, hits, total }, best match first. */
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
    const keys = [];
    for (const r of db.stmt('SELECT key FROM search WHERE search MATCH ? ORDER BY rank').all(match)) if (!keys.includes(r.key)) keys.push(r.key);
    const hits = [];
    let total = 0;
    for (const key of keys) {
      const rec = db.stmt('SELECT key, kind, label, title, status, workstream, body FROM records WHERE key = ?').get(key);
      const h = rec ? null : db.stmt('SELECT key, label, status, track, state, where_we_were, json_extract(fields, \'$.focus\') AS focus FROM handoffs WHERE key = ?').get(key);
      if (!rec && !h) continue;
      const kind = rec ? rec.kind : 'handoff';
      if (tab === 'questions' ? kind !== 'question' : tab === 'work' ? kind === 'question' : false) continue;
      const home = rec ? rec.workstream : db.stmt('SELECT workstream FROM records WHERE key = ?').get(h.track)?.workstream;
      if (ws && home !== ws) continue;
      total += 1;
      if (hits.length >= limit) continue;
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
