/* Search as a read level: FTS5 over titles, bodies, notes and
   handoffs, each hit with its record's head and the lines that matched. The
   index is contentless, so the lines are found in each hit's own text. */
import { readTx } from '../db.mjs';
import { unguardHeadings } from '../records.mjs';
import { UsageError, resolveRecord } from './labels.mjs';
import { inProject, knowledgeInProject, knowledgeInWs, wsInProject } from './questions.mjs';

export const HITS_MAX = 50;
const HITS_DEFAULT = 20;
const LINES_MAX = 3;
const LINE_CUT = 200;
const TERMS_MAX = 12;
const TABS = ['questions', 'work', 'both'];
const KINDS = ['question', 'workstream', 'track', 'task', 'knowledge', 'procedure', 'handoff'];

/* A record kept when it passes the tab (?2), the scope (?3, the keys a record or its
   workstream is one of) and the kind (?4). */
const KEPT = `FROM %s m
  LEFT JOIN records r ON r.key = m.key
  LEFT JOIN handoffs h ON r.key IS NULL AND h.key = m.key
  WHERE (r.key IS NOT NULL OR h.key IS NOT NULL)
    AND (?2 = 'both' OR (?2 = 'questions') = (coalesce(r.kind, 'handoff') = 'question'))
    AND (?3 IS NULL OR r.key IN (SELECT value FROM json_each(?3))
      OR coalesce(r.workstream, (SELECT t.workstream FROM records t WHERE t.key = h.track)) IN (SELECT value FROM json_each(?3)))
    AND (?4 IS NULL OR coalesce(r.kind, 'handoff') = ?4)`;
/* Each record's best-ranked row (its title and body, a note or a handoff) holding every term
   (?1); behind those, at the rank no match reaches, a record whose terms (?6 on) sit in several.
   src is the best row's own (SQLite reads a bare column beside min() from that row). */
const ROWS = '(SELECT key, min(rank) AS rank, src FROM search WHERE search MATCH ?1 GROUP BY key)';
const rowsSql = (n) => (n < 2 ? ROWS : '(SELECT key, min(rank) AS rank, src FROM (SELECT key, rank, src FROM search WHERE search MATCH ?1 UNION ALL SELECT key, 1, NULL FROM ('
  + Array.from({ length: n }, (_, i) => 'SELECT key FROM search WHERE search MATCH ?' + (i + 6)).join(' INTERSECT ') + ')) GROUP BY key)');
/* the best `limit` (?5) and the count of all */
const topSql = (n) => 'SELECT m.key, m.src, count(*) OVER () AS total ' + KEPT.replace('%s', rowsSql(n)) + ' ORDER BY m.rank LIMIT ?5';
const KEEP_SQL = 'SELECT 1 AS kept ' + KEPT.replace('%s', '(SELECT ?1 AS key)');

const clip = (s) => (s.length > LINE_CUT ? s.slice(0, LINE_CUT - 3) + '...' : s);

/* The words typed, a "quoted phrase" one term. */
export const termsOf = (text) => [...String(text ?? '').matchAll(/"([^"]+)"|\S+/g)].map((m) => (m[1] ?? m[0]).replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, TERMS_MAX);
/* every term quoted, so nothing typed is FTS syntax */
const quoted = (t) => '"' + t.replace(/"/g, '""') + '"';

/* Lines holding every term first, then those holding the most of them. `texts` as stored: a
   section heading starts its line, a written # line carries the guard's space */
function matchingLines(texts, terms) {
  const low = terms.map((t) => t.toLowerCase());
  const found = new Map();
  let whole = 0;
  for (const text of texts) {
    for (const raw of String(text || '').split('\n')) {
      if (/^#+ /.test(raw)) continue;
      const line = unguardHeadings(raw).replace(/\s+/g, ' ').trim();
      if (!line || found.has(clip(line))) continue;
      const n = low.filter((t) => line.toLowerCase().includes(t)).length;
      if (n) found.set(clip(line), n);
      if (n === low.length && ++whole >= LINES_MAX) return linesOf(found);
    }
  }
  return linesOf(found);
}
const linesOf = (found) => [...found].sort((a, b) => b[1] - a[1]).slice(0, LINES_MAX).map(([line]) => line);

/* The keys a project's search keeps: its workstreams (whose work carries no project of its
   own) and its own questions, knowledge and procedure cards. */
function projectKeys(db, scope) {
  const holds = {
    workstream: (f) => wsInProject(f, scope), knowledge: (f) => knowledgeInProject(f, scope),
    question: (f) => inProject(scope, f.projectDir, f.projectRepo), procedure: (f) => f.everywhere === true || inProject(scope, f.project, f.projectRepo),
  };
  return db.stmt("SELECT key, kind, fields FROM records WHERE kind IN ('workstream', 'knowledge', 'question', 'procedure')").all()
    .filter((r) => holds[r.kind](JSON.parse(r.fields))).map((r) => r.key);
}

/* The workstream itself, which its records carry, and its knowledge. */
const wsKeys = (db, w) => [w.key].concat(db.stmt("SELECT key, fields FROM records WHERE kind = 'knowledge'").all()
  .filter((r) => knowledgeInWs(JSON.parse(r.fields), w.front)).map((r) => r.key));

/* search(db, { text, limit, tab, kind, workstream, projectRepo, count }): { text, hits, total }, best
   match first, every word or quoted phrase somewhere in the record, note true where its best row is a journal note; count false leaves the total null and stops at the limit (a write's near check). */
export function search(db, input = {}) {
  const terms = termsOf(input.text);
  if (!terms.length) throw new UsageError('search needs some words to look for');
  const limit = input.limit === undefined || input.limit === null ? HITS_DEFAULT : Number(input.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > HITS_MAX) throw new UsageError('--limit takes a whole number of hits, 1 to ' + HITS_MAX);
  const tab = input.tab === undefined || input.tab === null ? 'both' : input.tab;
  if (!TABS.includes(tab)) throw new UsageError('--tab is one of ' + TABS.join(', '));
  const kind = input.kind === undefined || input.kind === null ? null : input.kind;
  if (kind !== null && !KINDS.includes(kind)) throw new UsageError('--kind is one of ' + KINDS.join(', '));
  const wsNamed = input.workstream !== undefined && input.workstream !== null;
  const project = typeof input.projectRepo === 'string' ? input.projectRepo.trim() : '';
  if (wsNamed && project) throw new UsageError('--ws and --project name different sets; pick one');
  const match = terms.map(quoted).join(' ');
  /* a term of marks alone holds no word the index splits out */
  const words = terms.filter((t) => /[\p{L}\p{N}]/u.test(t)).map(quoted);
  const apart = words.length > 1 ? words : [];
  return readTx(db, () => {
    let scope = null;
    if (project) scope = JSON.stringify(projectKeys(db, project));
    if (wsNamed) {
      const w = resolveRecord(db, String(input.workstream), { kinds: ['workstream'] });
      if (!w) throw new UsageError('--ws names ' + input.workstream + ', which no workstream holds');
      scope = JSON.stringify(wsKeys(db, w));
    }
    /* the count reads every match, so a knowledge write's near check (three of
       these) walks the ranked rows only until it has its hits */
    let top, total = null;
    if (input.count === false) {
      top = [];
      const seen = new Set();
      const walk = apart.length ? db.stmt('SELECT key FROM ' + rowsSql(apart.length) + ' ORDER BY rank').iterate(match, null, null, null, null, ...apart)
        : db.stmt('SELECT key FROM search WHERE search MATCH ? ORDER BY rank').iterate(match);
      for (const { key } of walk) {
        if (seen.has(key)) continue;
        seen.add(key);
        if (db.stmt(KEEP_SQL).get(key, tab, scope, kind)) top.push({ key });
        if (top.length >= limit) break;
      }
    } else {
      top = db.stmt(topSql(apart.length)).all(match, tab, scope, kind, limit, ...apart);
      total = top.length ? top[0].total : 0;
    }
    const hits = [];
    for (const { key, src } of top) {
      const rec = db.stmt('SELECT key, kind, label, title, status, body, json_extract(fields, \'$.scope\') AS scope FROM records WHERE key = ?').get(key);
      const h = rec ? null : db.stmt('SELECT key, label, status, track, state, where_we_were, json_extract(fields, \'$.focus\') AS focus FROM handoffs WHERE key = ?').get(key);
      const texts = rec
        ? [rec.title, rec.body, ...db.stmt('SELECT body FROM notes WHERE record = ? ORDER BY position').all(key).map((n) => n.body)]
        : [h.focus, h.state, h.where_we_were];
      hits.push({
        id: (rec ? rec.label : h.label) || key, key, kind: rec ? rec.kind : 'handoff', name: (rec ? rec.title : h.focus) || '', status: (rec ? rec.status : h.status) || '',
        ...(rec && rec.kind === 'knowledge' && rec.scope === 'global' ? { scope: 'global' } : {}),
        ...(src === 'note' ? { note: true } : {}),
        lines: matchingLines(texts, terms),
      });
    }
    return { text: terms.map((t) => (/\s/.test(t) ? '"' + t + '"' : t)).join(' '), hits, total };
  });
}
