/* the forms a workflow file is cited by, in one pure module (no fs, no git) for the survey's grep, the
   plan's rule pend, the handover's repoint (on SESSION_READS by default) and the doctor. A piece is { file, bare?, heads?, entries? }: bare
   false when another file shares its name, heads its headings ({ name, line } or strings), entries its log ids.
   citesIn(text, file, pieces, { root }) -> [{ of, line, form, text, anchor, tool, at, match }] */

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
export const kebab = (s, n = 40) => oneLine(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, n).replace(/-+$/, '') || 'item';
const plainMd = (s) => oneLine(String(s).replace(/\*\*|__|`/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1'));
export const CODE_EXT = /\.(m?[jt]sx?|cjs|cs|py|rs|go|java|c|cpp|h|hpp|ps1|psm1|sh|rb|kt|swift|lua)$/i;
const TOOL_LINE = /console\.log|\bprint|\becho\b|Write-Host|stderr/i;
const ID_SHAPE = /^([A-Za-z]{1,4})(-?)\d+$/;
/* left of a path or a name: no path character, so a longer path never counts */
const LEFT = '(?<![\\w/\\\\.-])';
/* the files a session reads (instruction files, cards, skills, commands, agents and rule files), the
   only ones the handover's repoint edits by default; cites in code and other documents stay as written */
export const SESSION_READS = /(?:^|\/)(?:CLAUDE(?:\.local)?\.md|AGENTS\.md)$|^docs\/procedures\/[^/]+\.md$|^\.(?:claude|agents)\/(?:skills|commands|agents|rules)\//i;
/* the forms in the order they win where two cover the same words */
export const FORMS = ['path', 'entry', 'section', 'name', 'possessive', 'article'];

/* The project root as a cite writes it before a root path ("C:/repo/docs/a.md"): either slash, a Windows root in
   either case; its trailing slash included. null for no root. */
export function rootRe(root) {
  const segs = String(root || '').replace(/[/\\]+$/, '').split(/[/\\]+/);
  if (!segs.join('')) return null;
  const win = /^[A-Za-z]:$/.test(segs[0]);
  const ci = (s) => (win ? s.replace(/[A-Za-z]/g, (c) => '[' + c.toUpperCase() + c.toLowerCase() + ']') : s);
  return '(?<![\\w.-])' + segs.map((s) => ci(esc(s))).join('[/\\\\]') + '[/\\\\]';
}
/* a path written from the project root: the root as written and the root path after it, or null */
export function fromRoot(path, root) {
  const re = rootRe(root);
  const m = re ? new RegExp('^' + re).exec(String(path)) : null;
  return m && String(path).length > m[0].length ? { lead: m[0], path: String(path).slice(m[0].length) } : null;
}
/* left of a path: LEFT, or the project root right before it (the match leaves the root out, so a rewrite keeps it) */
const leftOf = (root) => { const re = rootRe(root); return re ? '(?:(?<=' + re + ')|' + LEFT + ')' : LEFT; };

/* The patterns of one piece; `root` reads a path written from the project root too. */
export function formsOf(piece, { root = null } = {}) {
  const file = String(piece.file);
  const base = file.split('/').pop();
  const stem = base.replace(/\.[^.]+$/, '');
  /* a lowercase stem (notes, try-list) is a word in prose: only its path or name cite it */
  const cap = /[A-Z]/.test(stem) ? stem : null;
  const shapes = [...new Set((piece.entries || []).map((e) => (ID_SHAPE.exec(String(e)) || []).slice(1, 3).join('\0')).filter((x) => x && x !== '\0'))];
  const id = shapes.length ? '(?:' + shapes.map((x) => { const [p, d] = x.split('\0'); return esc(p) + d; }).join('|') + ')\\d+' : null;
  const heads = [];
  for (const h of piece.heads || []) {
    const name = plainMd(typeof h === 'string' ? h : h.name);
    if (!name) continue;
    const key = kebab(name);
    heads.push({ say: name, key });
    const lead = name.split(/:\s|\s[-(]\s?|\s\(/)[0].trim();
    if (lead && lead.length >= 2 && lead !== name) heads.push({ say: lead, key });
  }
  heads.sort((a, b) => b.say.length - a.say.length);
  return {
    file, base, stem: cap, heads,
    path: new RegExp(leftOf(root) + '(?:\\./)?' + esc(file).replace(/\//g, '[/\\\\]') + '(?![\\w/-]|\\.\\w)', 'g'),
    name: piece.bare === false ? null : new RegExp(LEFT + esc(base) + '(?![\\w/-]|\\.\\w)', 'g'),
    entry: cap && id ? new RegExp(LEFT + esc(cap) + '[,:]?\\s+(?:entry\\s+)?(' + id + ')(?![\\w-])', 'g') : null,
    bareId: id ? new RegExp('(?<![\\w/.-])(' + id + ')(?![\\w-])', 'g') : null,
    stemAt: cap ? new RegExp(LEFT + esc(cap) + '(,\\s+|[\'’]s\\s+|\\s+entry\\s+)', 'g') : null,
    possessive: cap ? new RegExp(LEFT + esc(cap) + '[\'’]s(?![\\w])', 'g') : null,
    article: cap ? new RegExp('\\b(?:the|in)\\s+(' + esc(cap) + ')(?![\\w.\'’-])', 'g') : null,
  };
}

/* the spans of a line's string literals, so a hit a tool prints is told from one in a comment */
function literals(line) {
  const out = [];
  let q = null;
  let from = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '\\') i++; else if (c === q) { out.push([from, i]); q = null; } } else if (c === '"' || c === '\'' || c === '`') { q = c; from = i; }
  }
  return out;
}

/* Every cite of a piece in a text, one per span (the earlier form wins an overlap). `file` is the citing file,
   whose own cites do not count; null checks a text that is no file (a rule line). */
export function citesIn(text, file, pieces, opts = {}) {
  return citer(pieces, opts)(text, file);
}

/* citesIn over many texts with the same pieces: each piece's patterns are built once, and a text reads only the
   pieces whose stem (else file name) it holds, on the lines that hold it, so a scan scales with the text read
   rather than files times pieces. Every form's match holds the stem whole, bounded on both sides, so each word
   of the stem is a whole word of the text: the words index the pieces. */
export function citer(pieces, { root = null } = {}) {
  const byWord = new Map();
  const always = [];
  (pieces || []).forEach((piece, order) => {
    if (!piece) return;
    const f = piece.forms || formsOf(piece, { root });
    const tests = [f.path, f.name, f.stem && new RegExp(LEFT + esc(f.stem) + '(?![\\w])')].filter(Boolean).map((re) => new RegExp(re.source));
    const key = f.stem || f.base;
    const words = key.match(/\w+/g) || [];
    const p = { piece, order, f, key, words, named: (s) => tests.some((re) => re.test(s)) };
    if (!words.length) { always.push(p); return; }
    const long = words.reduce((x, y) => (y.length > x.length ? y : x));
    if (!byWord.has(long)) byWord.set(long, []);
    byWord.get(long).push(p);
  });
  return (text, file) => {
    const src = String(text ?? '');
    const words = new Set(src.match(/\w+/g));
    const cands = [...always];
    for (const w of words) for (const p of byWord.get(w) || []) if (p.words.every((x) => words.has(x))) cands.push(p);
    if (!cands.length) return [];
    cands.sort((a, b) => a.order - b.order);
    const lines = src.replace(/\r\n/g, '\n').split('\n');
    const code = Boolean(file) && CODE_EXT.test(file);
    const out = [];
    /* a bare id is a number: where the file names the piece, the lines holding one are read too */
    const held = new Map();
    let numbered = null;
    for (const { piece, f, key, named } of cands) {
      if (piece.file === file) continue;
      if (!held.has(key)) held.set(key, src.includes(key) ? lines.flatMap((l, i) => (l.includes(key) ? [i] : [])) : []);
      if (!held.get(key).length) continue;
      const fileNames = f.bareId ? named(src) : false;
      let at = held.get(key);
      if (fileNames) {
        numbered = numbered || lines.flatMap((l, i) => (/\d/.test(l) ? [i] : []));
        at = [...new Set([...at, ...numbered])].sort((a, b) => a - b);
      }
      at.forEach((i) => {
        const line = lines[i];
        const has = line.includes(key);
        if (!has && !(f.bareId && fileNames)) return;
        const cand = [];
        /* a line without the stem can hold only a bare id */
        const each = (re, form, fn) => { if (!re || (!has && re !== f.bareId)) return; re.lastIndex = 0; for (const m of line.matchAll(re)) fn(m, form); };
        each(f.path, 'path', (m) => cand.push({ form: 'path', at: m.index, match: m[0], anchor: null }));
        each(f.name, 'name', (m) => cand.push({ form: 'name', at: m.index, match: m[0], anchor: null }));
        each(f.entry, 'entry', (m) => cand.push({ form: 'entry', at: m.index, match: m[0], anchor: m[1], stem: true }));
        if (f.bareId && (fileNames || named(line))) each(f.bareId, 'entry', (m) => cand.push({ form: 'entry', at: m.index, match: m[0], anchor: m[1] }));
        each(f.stemAt, 'section', (m) => {
          const rest = line.slice(m.index + m[0].length);
          const h = f.heads.find((x) => rest.toLowerCase().startsWith(x.say.toLowerCase()) && !/^[\w]/.test(rest.slice(x.say.length)));
          if (h) cand.push({ form: 'section', at: m.index, match: m[0] + rest.slice(0, h.say.length), anchor: h.key, stem: true });
          /* a name the piece does not hold is a cite of the file */
          else if (!/'|’/.test(m[1]) && /^[A-Z0-9]/.test(rest)) cand.push({ form: 'section', at: m.index, match: f.stem, anchor: null, stem: true });
        });
        each(f.possessive, 'possessive', (m) => cand.push({ form: 'possessive', at: m.index, match: m[0], anchor: null }));
        each(f.article, 'article', (m) => cand.push({ form: 'article', at: m.index + m[0].length - m[1].length, match: m[1], anchor: null }));
        if (!cand.length) return;
        cand.sort((a, b) => FORMS.indexOf(a.form) - FORMS.indexOf(b.form) || a.at - b.at);
        const taken = [];
        const lit = code && TOOL_LINE.test(line) ? literals(line) : [];
        for (const c of cand) {
          const end = c.at + c.match.length;
          if (taken.some(([a, b]) => c.at < b && end > a)) continue;
          taken.push([c.at, end]);
          out.push({ of: piece.file, line: i + 1, form: c.form, text: line.trim(), anchor: c.anchor, tool: lit.some(([a, b]) => c.at > a && c.at < b), at: c.at, match: c.match });
        }
      });
    }
    return out.sort((a, b) => a.line - b.line || a.at - b.at);
  };
}

/* of the going files one bare name may mean, the one the nearest folder above the citing file holds when it
   holds only one; null when that folder holds several, so nothing settles which */
export function nearestOf(file, cands) {
  const segs = String(file).split('/').slice(0, -1);
  for (let k = segs.length; k >= 0; k--) {
    const pre = segs.slice(0, k).join('/');
    const under = cands.filter((c) => !pre || c.startsWith(pre + '/'));
    if (under.length) return under.length === 1 ? under[0] : null;
  }
  return null;
}

export const MD = /\.(?:md|markdown|mdx)$/i;
/* markdown's fenced lines, by index */
export function fencedLines(lines) {
  const out = new Set();
  let fence = null;
  lines.forEach((l, i) => {
    const m = /^ {0,3}(`{3,}|~{3,})/.exec(l);
    if (fence) { out.add(i); if (m && m[1][0] === fence[0] && m[1].length >= fence.length && !l.slice(m[0].length).trim()) fence = null; } else if (m) { fence = m[1]; out.add(i); }
  });
  return out;
}
/* a wildcard after a path is a glob when it ends a folder or more path follows it; bold's `**` after a file does not */
export const isGlob = (path, rest) => {
  const w = /^(?:\*+|\?|\[[^\]\s]*\]|\{[^}\s]*\})/.exec(rest);
  return Boolean(w) && (path.endsWith('/') || /^[\w./-]/.test(rest.slice(w[0].length)));
};
/* a unit that goes, cited by its path; a one-segment name with no dot is also a word ("old"), so it counts
   only with its slash, a path after it, or backticks round it */
export function folderRe(path, root = null) {
  const p = esc(path);
  const left = leftOf(root);
  return new RegExp(/^[^/.]+$/.test(path) ? left + '(?:\\./)?' + p + '/[\\w./-]*(?![\\w-])|(?<=`)(?:\\./)?' + p + '(?=`)'
    : left + '(?:\\./)?' + p + '(?:/[\\w./-]*)?(?![\\w-])', 'g');
}
/* a markdown line's inline links and images: the link's span, and its target's path (no <>, anchor or title)
   at [at, at + len) inside the target's span [at, tEnd) */
const LINK = /!?\[(?:[^[\]]|\[[^[\]]*\])*\]\(\s*(<[^>\n]*>|[^\s()<>]*(?:\([^\s()]*\)[^\s()<>]*)*)(?:\s+(?:"[^"]*"|'[^']*'|\([^()]*\)))?\s*\)/dg;
export function linksIn(line) {
  return [...String(line).matchAll(LINK)].map((m) => {
    const [a, b] = m.indices[1];
    const angled = m[1].startsWith('<');
    const path = (angled ? m[1].slice(1, -1) : m[1]).replace(/[#?].*$/, '');
    return { start: m.index, end: m.index + m[0].length, at: a + (angled ? 1 : 0), len: path.length, tEnd: b, path };
  });
}
/* a path that climbs out of its file's folder, which only that folder resolves */
export const UP_PATH = /(?<![\w/\\.-])(?:\.\/)?(?:\.\.\/)+[\w./-]*[\w/-]/g;
/* a relative path read from its file's folder as a root path; null when it climbs out of the repo */
export function resolveFrom(file, rel) {
  const out = String(file).split('/').slice(0, -1);
  for (const s of String(rel).split('/')) {
    if (s === '..') { if (!out.length) return null; out.pop(); } else if (s && s !== '.') out.push(s);
  }
  return out.length ? out.join('/') + (String(rel).endsWith('/') ? '/' : '') : null;
}
/* the way from a file's folder to a root path, as a relative link there writes it */
export function relFrom(file, path) {
  const from = String(file).split('/').slice(0, -1);
  const to = String(path).split('/');
  let i = 0;
  while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++;
  return '../'.repeat(from.length - i) + to.slice(i).join('/') || './';
}
const BLOCK = /^\s*(?:[-*+]\s|\d+[.)]\s|[|#>]|`{3,}|~{3,})/;
/* the start of the sentence a wrapped markdown line ends, read back to a blank line, a block's first line or
   a sentence's end; '' when the line starts a block of its own */
export function wrapLead(lines, i) {
  if (BLOCK.test(lines[i] || '')) return '';
  const above = [];
  for (let k = i - 1; k >= 0; k--) {
    const l = String(lines[k]).replace(/\r$/, '');
    if (!l.trim() || /^\s*(?:[|#]|`{3,}|~{3,})/.test(l)) break;
    above.unshift(l.trim());
    if (BLOCK.test(l)) break;
  }
  const text = above.join(' ');
  let from = 0;
  for (const m of text.matchAll(/[.!?]["')\]*_`]*(?:\s|$)/g)) from = m.index + m[0].length;
  return text.slice(from);
}
/* a cite inside a string literal a tool prints */
export const printed = (line, at, file) => Boolean(file) && CODE_EXT.test(file) && TOOL_LINE.test(line) && literals(line).some(([a, b]) => at > a && at < b);
/* a cite sits in running text when a tool prints it or words stand around it in the quoted span holding it
   (the line, after the `lead` of the sentence it ends, when none does); a bare value, which a tool may read, is not,
   and never takes a note beside it */
export function inText(line, at, len, isPrinted = false, lead = '') {
  if (isPrinted) return true;
  const q = literals(line).find(([a, b]) => line[a] !== '`' && a < at && at + len <= b);
  const unit = q ? line.slice(q[0] + 1, at) + ' ' + line.slice(at + len, q[1]) : lead + ' ' + line.slice(0, at) + ' ' + line.slice(at + len);
  const words = unit.replace(/[\w.-]*\/[\w./-]*|\b[\w-]+\.[A-Za-z0-9]{1,8}\b/g, ' ').split(/\s+/).map((w) => w.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, ''));
  return words.filter((w) => /^[A-Za-z][a-z]+(?:['’-][a-z]+)*$/.test(w)).length >= 2;
}
