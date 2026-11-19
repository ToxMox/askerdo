/* the coverage pass over converted sources. Before the handover retires a source, each
   item's source lines are read against the record it became, clause by clause: numbers with their units, flags,
   backticked tokens, conditions, entry ids and check phrases must all be there. A cut item is a gap unless its
   source marks it out of force, an answer dropped it, or its judgment's evidence holds; every block of a rule file
   that goes is named by an item. Folders carry no rows: their gate is their evidence (apply.mjs).
   coverage(items, { manifest, readRecord, readFile, ledger, repoint, judged, whole, proved, exists, going, lineEdits, records, backed }) -> coverage.json */

const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/* the words a condition or check phrase is followed by that carry nothing */
const FILLER = new Set(['the', 'a', 'an', 'it', 'its', 'this', 'that', 'is', 'are', 'be', 'to']);
const UNIT = '(?:ms|s|secs?|seconds?|mins?|minutes?|h|hrs?|hours?|days?|weeks?|k|kb|mb|gb|tb|khz|hz|%|px|x|bytes?|chars?|characters?|lines?|tokens?|fps|times)';
const NUMBER = new RegExp('(?<![\\w.-])(\\d+(?:\\.\\d+)?)(?:\\s?(' + UNIT + '))?(?![\\w])', 'gi');
const FLAG = /(?<![\w-])--[a-z][\w-]*/gi;
const TICKED = /`([^`\n]+)`/g;
const ENTRY = /\b[A-Z]{1,4}-?\d+\b/g;
/* a condition or check phrase, then the next three words, of which the first that carries something counts */
/* a whole word, never a piece of an identifier (`Config.ExpectedKeys`) */
const CONDITION = /(?<![\w.$])(when|unless|only|never|at most|at least|within)(?![\w])(?=((?:\s+\S+){0,3}))/gi;
const CHECK = /(?<![\w.$])(check:|expect(?:s|ed)?|exits|prints)(?![\w])(?=((?:\s+\S+){0,3}))/gi;
const VERDICT = /\b(PASS|FAILED)\b/g;

/* A source text's clauses: each line a bullet starts is one, and each sentence within. */
export function clausesOf(text) {
  const out = [];
  let cur = '';
  for (const line of String(text ?? '').split(/\r?\n/)) {
    /* a table row's cells are its clauses: a pipe is no part of the words beside it */
    if (/^\s*\|/.test(line)) {
      if (cur.trim()) out.push(cur);
      cur = '';
      out.push(...line.split(/(?<!\\)\|/).map((c) => c.trim()).filter((c) => /[\w`]/.test(c)));
      continue;
    }
    if (/^\s*(?:[-*+]|\d+[.)])\s+/.test(line) || /^\s*#/.test(line) || !line.trim()) { if (cur.trim()) out.push(cur); cur = ''; }
    cur += ' ' + line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').replace(/^\s*#+\s*/, '');
  }
  if (cur.trim()) out.push(cur);
  /* a heading's number stays with its words ("3. Hard stops"), never a clause of its own */
  return out.flatMap((c) => oneLine(c).split(/(?<=[.!?])(?<!^\d+[a-z]?\.)\s+(?=[A-Z`*(])/)).map((c) => c.trim()).filter(Boolean);
}

/* The tokens of a clause that carry meaning, each with the test a record's text must pass. */
export function tokensOf(clause) {
  const c = String(clause ?? '');
  const out = new Map();
  const add = (t, re) => { if (!out.has(t.toLowerCase())) out.set(t.toLowerCase(), { t, re }); };
  /* a number after a hyphen belongs to an id or a range, never stands for the number itself */
  const num = (n, u) => add(n + (u ? ' ' + u : ''), new RegExp('(?<![\\w.-])' + esc(n) + (u ? '\\s?' + esc(u) : '') + '(?![\\w])', 'i'));
  for (const m of c.matchAll(TICKED)) {
    const inner = m[1].trim();
    /* a backticked command is checked by its flags, numbers and paths, a single token whole */
    if (!/\s/.test(inner)) { add(inner, new RegExp(esc(inner), 'i')); continue; }
    for (const w of inner.split(/\s+/)) if (/^--?[a-z]/i.test(w) || /[/\\]|\.[a-z]{1,4}$/i.test(w)) add(w, new RegExp('(?<![\\w-])' + esc(w) + '(?![\\w-])', 'i'));
  }
  for (const m of c.matchAll(FLAG)) add(m[0], new RegExp('(?<![\\w-])' + esc(m[0]) + '(?![\\w-])', 'i'));
  for (const m of c.matchAll(NUMBER)) num(m[1], m[2]);
  for (const m of c.matchAll(ENTRY)) add(m[0], new RegExp('\\b' + esc(m[0]) + '\\b'));
  const phrase = (head, after) => {
    const h = esc(head).replace(/\s+/g, '\\s+');
    const w = String(after || '').trim().split(/\s+/).map((x) => x.replace(/^[`*("']+|[`*)"'.,;:!?]+$/g, '')).find((x) => x && !FILLER.has(x.toLowerCase()));
    if (!w) return add(head, new RegExp('\\b' + h + '(?![\\w])', 'i'));
    /* a number may run into its unit ("30s"); the word may open a bracket or a code span ("only (idle", "never `+=`") */
    add(head + ' ' + w, new RegExp('\\b' + h + '\\s+(?:\\S+\\s+){0,2}?[`*("\']*' + esc(w) + (/\d$/.test(w) ? '(?!\\d)' : '(?![\\w])'), 'i'));
  };
  for (const m of c.matchAll(CONDITION)) phrase(m[1], m[2]);
  for (const m of c.matchAll(CHECK)) phrase(m[1], m[2]);
  for (const m of c.matchAll(VERDICT)) add(m[1], new RegExp('\\b' + m[1] + '\\b'));
  return [...out.values()];
}

/* The tokens of a clause a record's text lacks (whitespace and case folded). */
export function covers(record, clause) {
  const text = oneLine(record);
  const words = leftOut(text, oneLine(clause));
  /* a clause copied word for word loses nothing */
  if (text.toLowerCase().includes(words.toLowerCase())) return [];
  return tokensOf(words).filter((k) => !k.re.test(text)).map((k) => k.t);
}

/* A private value the record replaced with a marker ("[address left out]") is no loss: where the words around a
   marker in the record frame a span of the clause, that span reads as the marker. A marker stands for one value (an
   address, a key, a host, an id, a handle): a span of one token, so a phrase behind a marker stays a gap */
const MARKER = /\[[a-z][a-z ]{0,30} left out\]/gi;
const IS_MARKER = new RegExp(MARKER.source, 'i');
const CONTEXT = [24, 12, 6, 3];
export const ONE_VALUE = /^\S{1,256}$/;
function leftOut(text, clause) {
  const marks = [...text.matchAll(MARKER)];
  let out = clause;
  marks.forEach((m, k) => {
    const from = k ? marks[k - 1].index + marks[k - 1][0].length : 0;
    const to = k + 1 < marks.length ? marks[k + 1].index : text.length;
    const after = m.index + m[0].length;
    for (const n of CONTEXT) {
      const l = text.slice(Math.max(from, m.index - n), m.index).toLowerCase();
      const r = text.slice(after, Math.min(to, after + n)).toLowerCase();
      if (!l.trim() && !r.trim()) return;
      const lo = out.toLowerCase();
      /* framed on both sides, or at the clause's own start or end when the record's words run past it */
      for (let a = l ? lo.indexOf(l) : 0; a >= 0; a = l ? lo.indexOf(l, a + 1) : -1) {
        const s = a + l.length;
        const b = r ? lo.indexOf(r, s) : lo.length;
        if (b > s && ONE_VALUE.test(out.slice(s, b).trim()) && !IS_MARKER.test(out.slice(s, b))) { out = out.slice(0, s) + m[0] + out.slice(b); return; }
        if (!l) break;
      }
    }
  });
  return out;
}

/* an item's own lines in its file: line to end, the line alone, or the whole file; null with no file to read */
const spanOf = (item, readFile) => {
  const s = item.source || {};
  if (!readFile || !s.file) return null;
  const raw = readFile(s.file);
  if (typeof raw !== 'string') return null;
  const text = raw.replace(/\r\n/g, '\n');
  return s.line ? text.split('\n').slice(s.line - 1, s.end || s.line).join('\n') : text;
};
/* a track's old versions are written whole as its handoffs, so a whole-file track source is covered by where it goes */
const WHOLE = new Set(['track']);

/* where the source itself says a cut entry is out of force, the cut loses nothing: its own line saying so,
   or any line of the run's sources about that entry (opening with its id) saying so, or one superseding it by id.
   The status word counts only as the entry's marker, never as a word of a live entry's text: a table cell or a
   bracket opening with it, a Status label, the word with by and an id or a name, or the word standing as a sentence. */
const WORD = '[*_~]*(?<!\\w)(?:superseded|retired|withdrawn|revoked|obsolete)\\b[*_~]*';
const TAIL = '(?:\\s*(?:(?:by|in|on|since)\\s|[:;,]|\\d)[^|)\\]\\n]*)?\\.?\\s*';
const OFF = new RegExp(['\\|\\s*' + WORD + TAIL + '(?:\\||$)', '[([]\\s*' + WORD + TAIL + '[)\\]]', '\\bstatus\\b[*_\\s]*[:=-][*_~\\s]*' + WORD,
  WORD + '\\s+by\\s+(?:[A-Z]{1,4}-?\\d+\\b|["\'`])', '(?:^|[.;:]\\s+|\\s-\\s)' + WORD + '\\.?\\s*$', '^[\\s>*+#-]*(?:[A-Z]{1,4}-?\\d+\\b\\W*)?' + WORD + '\\s*:'].join('|'), 'im');
const linesOf = (readFile, cache) => (file) => {
  if (!cache.has(file)) { const raw = readFile ? readFile(file) : null; cache.set(file, typeof raw === 'string' ? raw.split(/\r?\n/) : []); }
  return cache.get(file);
};
function notInForce(item, readFile, files, lines = linesOf(readFile, new Map())) {
  const own = item.source && item.source.line ? spanOf(item, readFile) : null;
  if (OFF.test(own ?? item.title ?? '')) return 'its source marks it so';
  const key = own && (own.match(ENTRY) || [])[0];
  if (!key) return null;
  const by = new RegExp('\\bsupersed(?:es|ing)\\s+' + esc(key) + '\\b|\\bretires\\s+' + esc(key) + '\\b', 'i');
  for (const file of files) {
    const at = lines(file).findIndex((l, i) => !(file === item.source.file && i + 1 === item.source.line)
      && ((l.match(ENTRY) || [])[0] === key && OFF.test(l) || by.test(l)));
    if (at >= 0) return file + ' line ' + (at + 1) + ' marks ' + key + ' so';
  }
  return null;
}

/* gaps decide what blocks, in one place, so gaps a later pass adds block too */
export function settle(cov) {
  for (const s of cov.sources) s.blocked = s.gaps.length > 0;
  for (const c of cov.claude || []) c.blocked = c.gaps.length > 0;
  return cov;
}

/* a cut stale, superseded or history rule, or a pointer to machinery that goes, is backed by the judgment
   the plan records while its evidence holds: each gone path absent or leaving in this run, each cite resolving */
const DROP_SHAPES = new Set(['stale', 'superseded', 'history', 'loader']);
const bareKey = (p) => String(p || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/:\d+$/, '').replace(/\/+$/, '');
const inside = (p, folder) => { const f = bareKey(folder); const x = bareKey(p); return x === f || x.startsWith(f + '/'); };
const listOf = (v) => (Array.isArray(v) ? v : v ? [v] : []).map(String).filter((x) => x.trim());
/* for a stale or superseded cut, its own file (or a folder holding it) says only that the file goes, never that
   its subject did, so it is no evidence; a history or loader cut is judged by its own text. A board record holds by status */
const OWN_FILE_NO_EVIDENCE = new Set(['stale', 'superseded']);
function evidenceBacks(j, own, { exists, going, records }) {
  if (!j || !DROP_SHAPES.has(String(j.shape)) || !oneLine(j.why) || !exists) return null;
  const ev = j.evidence || {};
  const mine = (p) => Boolean(own) && OWN_FILE_NO_EVIDENCE.has(String(j.shape)) && inside(own, p);
  const gone = listOf(ev.gone).filter((p) => !mine(p));
  const cites = listOf(ev.cites).filter((p) => !mine(p));
  const named = listOf(ev.records);
  if (!gone.length && !cites.length && !named.length) return null;
  if (gone.some((p) => exists(bareKey(p)) && !going.some((g) => inside(p, g))) || cites.some((p) => !exists(bareKey(p)))) return null;
  const held = named.map((id) => (records ? records(id) : null));
  if (held.some((h) => !h)) return null;
  return j.shape + ': ' + oneLine(j.why) + ' (' + [gone.length ? 'gone: ' + gone.join(', ') : '', cites.length ? 'cites: ' + cites.join(', ') : '',
    held.length ? 'records: ' + held.join(', ') : ''].filter(Boolean).join('; ') + ')';
}
/* the map's re-check reads the same test, so a judgment coverage refuses never reads holds later */
export const OWN_ONLY = 'its evidence names only its own file, which says the file goes, not that the rule is stale: name what made it stale, a path or a board record';
export const ownOnly = (j, own) => {
  const ev = (j && j.evidence) || {};
  const paths = [...listOf(ev.gone), ...listOf(ev.cites)];
  return OWN_FILE_NO_EVIDENCE.has(String(j && j.shape)) && paths.length > 0 && !listOf(ev.records).length && paths.every((p) => inside(own, p));
};

/* the blocks of a rule file a session reads, past its frontmatter: each bullet with its run-on lines, each
   paragraph, table row and fence; headings, comments and rules carry none */
export function blocksOf(text) {
  const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  if (/^---\s*$/.test(lines[0] || '')) { const e = lines.findIndex((l, k) => k > 0 && /^---\s*$/.test(l)); if (e > 0) i = e + 1; }
  let cur = null;
  const close = () => { if (cur) out.push(cur); cur = null; };
  for (; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*(```|~~~)/.test(l)) {
      close();
      const mark = l.trim().slice(0, 3);
      let j = i + 1;
      while (j < lines.length && !lines[j].trim().startsWith(mark)) j++;
      out.push({ line: i + 1, end: Math.min(j + 1, lines.length), text: lines.slice(i + 1, j).join(' ') });
      i = j;
      continue;
    }
    if (!l.trim() || /^\s*#{1,6}\s/.test(l) || /^\s*<!--.*-->\s*$/.test(l) || (/^[\s|:-]+$/.test(l) && /---/.test(l))) { close(); continue; }
    if (/^\s*\|/.test(l)) { close(); out.push({ line: i + 1, end: i + 1, text: l }); continue; }
    if (/^\s*(?:[-*+]|\d+[.)])\s+/.test(l)) { close(); cur = { line: i + 1, end: i + 1, text: l }; continue; }
    if (cur) { cur.end = i + 1; cur.text += ' ' + l; } else cur = { line: i + 1, end: i + 1, text: l };
  }
  close();
  return out.map((b) => ({ ...b, text: oneLine(b.text) })).filter((b) => /\w/.test(b.text));
}

/* an item's lines in its file, whole when it names no line */
const rangeOf = (r) => { const s = r.source || {}; return s.line ? [Number(s.line), Number(s.end || s.line)] : [1, Infinity]; };
const meets = (a, [from, to]) => a[0] <= to && from <= a[1];
/* a card step as the item gave it: its words, and its command */
const stepParts = (s) => (typeof s === 'string' ? [s] : s && typeof s === 'object' ? [s.text || s.title || '', s.run || s.command || s.cmd || ''] : []).map(oneLine).filter(Boolean);

export const lineEditKey = (e) => 'lineEdit:' + e.file + '#L' + e.line;
/* a line edit waits while coverage has a gap on its words or on an item that names them */
export function lineEditHeld(e, cov, items = []) {
  const s = ((cov && cov.sources) || []).find((x) => bareKey(x.file) === bareKey(e.file));
  if (!s) return null;
  const at = [Number(e.line), Number(e.end || e.line)];
  const naming = new Set(items.filter((x) => x.source && bareKey(x.source.file) === bareKey(e.file) && meets(rangeOf(x), at)).map((x) => x.id));
  const g = s.gaps.find((x) => x.item === lineEditKey(e) || naming.has(x.item));
  return g ? g.item + ': ' + g.why : null;
}

export function coverage(items, { manifest, readRecord, readFile = null, ledger = [], repoint = null, judged = [], whole = [], proved = {}, exists = null, going = [], lineEdits = [], records = null, backed = [] } = {}) {
  const steps = ((manifest && manifest.imports) || []).filter((i) => !i.undone).flatMap((i) => i.steps || []);
  /* an item's record is what its own step made; a later step on it (a task's checklist) answers "ok" */
  const written = new Map();
  for (const s of steps) if (s.id && s.row && (!written.has(s.row) || s.step === s.row)) written.set(s.row, s.id);
  const sources = new Map();
  const runFiles = [...new Set(items.map((x) => x.source && x.source.file).filter(Boolean))];
  const lines = linesOf(readFile, new Map());
  const judgedItem = new Map((judged || []).filter((j) => j && String(j.key || '').startsWith('item:')).map((j) => [j.key.slice(5), j]));
  /* a split clause's fact stays in its file in kept words, so they cover its clause beside the rule's record */
  const keptFor = new Map();
  for (const l of ledger || []) for (const c of l.clauses || []) if (c.fate === 'split' && c.item) keptFor.set(c.item, (keptFor.get(c.item) || '') + '\n' + oneLine(c.kept));
  const src = (file) => {
    if (!sources.has(file)) sources.set(file, { file, items: 0, covered: 0, backed: 0, gaps: [], drops: [] });
    return sources.get(file);
  };
  /* first what each item is: held, backed, a gap, or written with the record it became */
  const accounted = new Map();
  const toRead = [];
  for (const r of items) {
    const file = r.source && r.source.file;
    if (!file || r.kind === 'fix') continue;
    const s = src(file);
    s.items++;
    const back = (why) => { s.backed++; s.drops.push({ item: r.id, why }); accounted.set(r.id, r.text || r.title || ''); };
    if (r.covered) { s.covered++; s.drops.push({ item: r.id, why: 'already on the board: ' + r.covered }); accounted.set(r.id, r.text || r.title || ''); continue; }
    if (r.dropped) { back('dropped by the answer to ' + r.dropped); continue; }
    if (r.cut) {
      const off = notInForce(r, readFile, runFiles, lines);
      if (off) { back('not in force: ' + off); continue; }
      const ev = evidenceBacks(judgedItem.get(r.id), file, { exists, going, records });
      if (ev) { back('dropped as ' + ev); continue; }
      s.gaps.push({ item: r.id, why: 'cut: it reaches no record, no answer of the user dropped it, and it carries no drop shape with evidence that holds'
        + (ownOnly(judgedItem.get(r.id), file) ? ' (' + OWN_ONLY + ')' : '') });
      continue;
    }
    const id = written.get(r.id) || (r.kind === 'card' ? r.target || 'its card' : null);
    if (!id) { s.gaps.push({ item: r.id, why: 'not on the board: the write did not take it' }); continue; }
    if (WHOLE.has(r.kind) && !(r.source && r.source.line)) { s.covered++; continue; }
    const text = readRecord ? readRecord(r) : null;
    if (text === null || text === undefined) { s.gaps.push({ item: r.id, why: 'its record ' + id + ' could not be read' }); continue; }
    accounted.set(r.id, (r.fields && r.fields.entry ? text + '\n' + r.fields.entry : text) + (keptFor.get(r.id) || ''));
    toRead.push({ r, s, id, text });
  }
  /* a clause that became several records (a rule and its fact, a rule and its detail) is read against all of them */
  const sameFile = new Map();
  for (const x of items) if (x.source && x.source.file && accounted.has(x.id)) { const f = x.source.file; if (!sameFile.has(f)) sameFile.set(f, []); sameFile.get(f).push(x); }
  /* an instruction file's clause may make records whose items sit in other files (the rule it names), so each is
     read against every record that clause made */
  const kin = new Map();
  for (const l of ledger || []) for (const c of l.clauses || []) {
    if (c.fate !== 'split' && c.fate !== 'carried') continue;
    const at = [Number(c.line), Number(c.end || c.line)];
    const made = [...new Set([...(c.item ? [c.item] : []), ...items.filter((x) => x.source && bareKey(x.source.file) === bareKey(l.path) && meets(rangeOf(x), at)).map((x) => x.id)])];
    if (made.length > 1) for (const id of made) kin.set(id, [...new Set([...(kin.get(id) || []), ...made])]);
  }
  for (const { r, s, id, text } of toRead) {
    /* a card holds every step it was given, read from the card as written */
    const lostSteps = r.kind === 'card' ? (r.fields && Array.isArray(r.fields.steps) ? r.fields.steps : []).map((st, n) => ({ n: n + 1, parts: stepParts(st) }))
      .filter((st) => st.parts.some((p) => !oneLine(text).toLowerCase().includes(p.toLowerCase()))) : [];
    for (const st of lostSteps) s.gaps.push({ item: r.id, clause: st.parts.join(': '), why: id + ' lost step ' + st.n });
    /* the file is the source; the item's own text adds what the session wrote past its lines */
    const span = spanOf(r, readFile);
    const clauses = [...new Set([...(span === null ? [] : clausesOf(span)), ...clausesOf(r.text || '')])];
    const mine = rangeOf(r);
    const ids = [...(sameFile.get(r.source.file) || []).filter((x) => x.id === r.id || meets(mine, rangeOf(x))).map((x) => x.id), ...(kin.get(r.id) || [])];
    const has = [...new Set(ids)].filter((id) => accounted.has(id)).map((id) => accounted.get(id)).join('\n');
    const lost = clauses.map((clause) => ({ clause, missing: covers(has, clause) })).filter((x) => x.missing.length);
    if (!lost.length && !lostSteps.length) { s.covered++; continue; }
    for (const x of lost) s.gaps.push({ item: r.id, clause: x.clause, missing: x.missing, why: id + ' lost ' + x.missing.join(', ') });
  }
  /* a folder a group answer ended (plan.backed) goes whole on that answer, so none of its blocks is read */
  for (const b of backed || []) { const s = src(bareKey(b.path) + '/'); s.backed++; s.drops.push({ item: 'folder:' + bareKey(b.path), why: 'ended whole by the answer to ' + b.call }); }
  /* every block of a rule file that goes is named by an item, so an omitted rule is a gap, not a silent loss */
  for (const file of whole || []) {
    if ((backed || []).some((b) => inside(file, b.path))) continue;
    const raw = readFile ? readFile(file) : null;
    if (typeof raw !== 'string') continue;
    /* the lines an earlier run's coverage passed, from the source's map row, are named too */
    const named = [...items.filter((x) => x.kind !== 'fix' && x.source && bareKey(x.source.file) === bareKey(file)).map(rangeOf),
      ...(proved[file] || []).map(([a, b]) => [Number(a), b == null ? Infinity : Number(b)])];
    for (const b of blocksOf(raw)) {
      if (named.some((rg) => meets(rg, [b.line, b.end]))) continue;
      src(file).gaps.push({ item: 'line ' + b.line, line: b.line, clause: b.text, why: 'no item names it: convert it, or cut it with its shape and evidence' });
    }
  }
  /* the words a kept file's line edit takes out read like a block of a rule file that goes: an item names them, or
     the gap holds the edit; a replace whose new words carry them all takes out nothing */
  for (const e of lineEdits || []) {
    if (!/\w/.test(e.struck || '') || (e.kind === 'replace' && !covers(e.with || '', e.struck).length)) continue;
    const at = [Number(e.line), Number(e.end || e.line)];
    if (items.some((x) => x.kind !== 'fix' && x.source && bareKey(x.source.file) === bareKey(e.file) && meets(rangeOf(x), at))) continue;
    src(e.file).gaps.push({ item: lineEditKey(e), line: e.line, clause: oneLine(e.struck), edit: true, why: 'the line edit takes it out and no item names it: convert it, or cut it with its shape and evidence' });
  }
  /* each instruction file's ledger: a carried clause needs its record, a split one its kept words too, a dropped one its reason */
  const claude = (ledger || []).map((l) => {
    const gaps = [];
    for (const c of l.clauses || []) {
      if (c.fate === 'kept') continue;
      if (c.fate === 'split' && !oneLine(c.kept)) gaps.push({ clause: c.text, line: c.line, why: 'split with no kept words' });
      if (c.fate === 'carried' || c.fate === 'split') {
        if (!c.item && !c.by) gaps.push({ clause: c.text, line: c.line, why: 'carried by nothing named' });
        /* a card is written by the handover, after this pass: its own item reads the card as written */
        else if (c.item && !written.has(c.item) && !items.some((x) => x.id === c.item && (x.covered || (x.kind === 'card' && !x.cut)))) gaps.push({ clause: c.text, line: c.line, why: 'carried by ' + c.item + ', which has no record on the board' });
        continue;
      }
      if (c.fate === 'dropped') { if (!oneLine(c.why)) gaps.push({ clause: c.text, line: c.line, why: 'dropped with no reason' }); continue; }
      gaps.push({ clause: c.text, line: c.line, why: 'no fate: keep, rule, split or drop' });
    }
    return { path: l.path, clauses: (l.clauses || []).length, gaps };
  });
  const cov = { made: new Date().toISOString(), sources: [...sources.values()], claude };
  return repoint ? repointGaps(cov, repoint) : settle(cov);
}

/* a cite the repoint left unresolved that a tool prints blocks the file it names, since a person would
   read a dead path. Reads repoint.json's shape; one helper for coverage and the handover. */
export function repointGaps(cov, rep) {
  /* the latest repoint's gaps replace an earlier one's */
  for (const s of cov.sources) s.gaps = s.gaps.filter((g) => !String(g.item || '').startsWith('citations:'));
  for (const h of (rep && rep.unresolved) || []) {
    /* a bare name several going files share holds each of them until the session says which */
    if (!h.tool && !h.among) continue;
    for (const of of h.among || [h.of]) {
      let s = cov.sources.find((x) => x.file === of);
      if (!s) cov.sources.push(s = { file: of, items: 0, covered: 0, backed: 0, gaps: [], drops: [] });
      s.gaps.push({ item: 'citations:' + of, why: (h.among ? 'a bare name at ' + h.file + ' line ' + h.line + ' may mean it or ' + (h.among.length - 1) + ' other going files of that name, and nothing settles which'
        : 'a tool prints it at ' + h.file + ' line ' + h.line + ' (' + h.form + '), and the repoint could not resolve it'), file: h.file, line: h.line, form: h.form });
    }
  }
  return settle(cov);
}

/* One row per converted source, then each gap. */
export function table(cov) {
  const out = ['| Source | Items | Covered | Backed drops | Gaps |', '| --- | --- | --- | --- | --- |'];
  for (const s of cov.sources) out.push('| ' + s.file + ' | ' + s.items + ' | ' + s.covered + ' | ' + s.backed + ' | ' + s.gaps.length + (s.blocked ? ', blocked' : '') + ' |');
  const gaps = cov.sources.flatMap((s) => s.gaps.map((g) => '- ' + s.file + ': ' + (g.item || '') + ': ' + g.why + (g.clause ? ' (in "' + oneLine(g.clause).slice(0, 160) + '")' : '')));
  for (const c of cov.claude || []) {
    out.push('', c.path + ' ledger: ' + c.clauses + ' clauses, ' + c.gaps.length + ' gaps' + (c.blocked ? ', so its rewrite waits' : ''));
    gaps.push(...c.gaps.map((g) => '- ' + c.path + ' line ' + g.line + ': ' + g.why + ' ("' + oneLine(g.clause).slice(0, 160) + '")'));
  }
  if (gaps.length) out.push('', 'Gaps (each blocks its source):', ...gaps);
  return out.join('\n');
}

/* The record an item became, as text: the board records its manifest steps name (a rule's line from the
   profile, plus its detail record), or its card, read from what prefetch(items) fetched: `show(ids)` reads
   many records in one call, so the pass makes one call per batch, never one per record. */
const BOARD_REC = /^(?:[A-Z]{1,3}-\d+(?:\.\d+)?|Q\d+)$/;
export function recordReader({ manifest, show, rules = [], readFile, cardText }) {
  const steps = ((manifest && manifest.imports) || []).filter((i) => !i.undone).flatMap((i) => i.steps || []);
  const strings = (v) => (typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(strings) : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : []);
  const cache = new Map();
  const board = (id) => {
    const rec = cache.get(id);
    return rec ? strings(rec).join('\n') : null;
  };
  const read = (item) => {
    const own = steps.filter((s) => s.row === item.id && s.id);
    if (item.kind === 'card') {
      const text = (item.target && readFile && readFile(item.target)) || (cardText ? cardText(item) : null);
      if (text) return text;
    }
    if (item.kind === 'rule') {
      /* a kept rule may take the slug of the board line it replaces: the step's id names it */
      const step = own.find((s) => s.step === item.id);
      const slug = step && String(step.id).includes('/') ? String(step.id).split('/').pop() : item.fields && item.fields.slug;
      const line = rules.find((x) => x.rule === slug);
      const detail = own.find((s) => s.step === item.id + '@detail');
      const detailId = detail ? detail.id : item.heldDetail;
      const parts = [line ? line.text : null, detailId ? board(detailId) : null].filter(Boolean);
      return parts.length ? parts.join('\n') : null;
    }
    /* a redo's detail is the one an earlier write made, which the undo kept */
    const ids = [...own.map((s) => s.id), ...(item.heldDetail ? [item.heldDetail] : [])].filter((id) => BOARD_REC.test(id));
    if (!ids.length) return null;
    const texts = ids.map(board).filter(Boolean);
    return texts.length ? texts.join('\n') : null;
  };
  read.prefetch = async (items, batch = 100) => {
    const want = [...new Set(items.flatMap((x) => [...steps.filter((s) => s.row === x.id && s.id && BOARD_REC.test(s.id)).map((s) => s.id), ...(x.heldDetail ? [x.heldDetail] : [])]))].filter((id) => !cache.has(id));
    for (let i = 0; i < want.length; i += batch) {
      const ids = want.slice(i, i + batch);
      const recs = (await show(ids)) || [];
      ids.forEach((id) => cache.set(id, recs.find((r) => r && r.id === id) || null));
    }
    return want.length;
  };
  return read;
}
