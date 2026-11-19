/* Which decisions a tool call touches: pure, so the mod's watcher and
   node --test match one way. A row is the shape `askerdo decisions triggers --json`
   prints: files are globs relative to `project` (this PC's checkout), commands are
   fragments in the procedure card's syntax. */
import { COMMAND_TOOLS, FILE_TOOLS, commandMatches, commandsOf, globRe, programAt, programName, readsOnly, triggerWhy } from './proc-match.mjs';

/* a read or a search points only at a glob that opts in, since a session reads far more than it edits */
export const READ_TOOLS = ['Read'];
export const SEARCH_TOOLS = ['Grep', 'Glob'];
export const OCCASIONS = ['edit', 'read', 'search'];

const norm = (p) => String(p || '').trim().replace(/\\/g, '/').replace(/(.)\/+$/, '$1');
const caseless = (p) => (/^[A-Za-z]:\//.test(p) ? p.toLowerCase() : p);
const absolute = (p) => /^[A-Za-z]:\//.test(p) || p.startsWith('/');

/* A stored file link: `[(<occasions>)] <glob> [| <contains>]`; no marker means (edit). */
export function fileLink(s) {
  const raw = String(s || '').trim();
  const m = /^\(([^)]*)\)\s*(.*)$/.exec(raw);
  const on = m ? m[1].toLowerCase().split(/[\s,]+/).filter(Boolean) : ['edit'];
  const rest = m ? m[2] : raw;
  const bar = rest.indexOf(' | ');
  return { on, glob: bar < 0 ? rest : rest.slice(0, bar), contains: bar < 0 ? '' : rest.slice(bar + 3) };
}

/* The path inside `root`, or null when it lies outside. */
function inside(root, path) {
  const r = caseless(norm(root));
  const p = norm(path);
  if (!r) return null;
  if (caseless(p) === r) return '';
  return caseless(p).startsWith(r + '/') ? p.slice(r.length + 1) : null;
}

function editText(tool, input) {
  if (tool === 'Write') return String(input.content || '');
  if (tool === 'NotebookEdit') return String(input.new_source || '');
  if (tool === 'MultiEdit') return (Array.isArray(input.edits) ? input.edits : []).map((e) => String((e && e.new_string) || '')).join('\n');
  return String(input.new_string || '');
}

/* Whether a file the glob takes can lie at or under `rel` ('' is the whole repo). */
function couldHold(glob, rel) {
  if (!rel) return true;
  const gs = glob.split('/');
  const rs = rel.split('/');
  for (let i = 0; i < rs.length; i++) {
    if (i >= gs.length) return false;
    if (gs[i].includes('**')) return true;
    if (!globRe(gs[i]).test(rs[i])) return false;
  }
  return true;
}

/* The leading segments of a search glob with no wildcard: a Glob pattern is anchored at its
   path, a Grep glob only when it has a slash (else it takes a name at any depth). */
function literalLead(pattern, anchored) {
  const p = norm(pattern).replace(/^(\.\/)+/, '');
  if (!p || (!anchored && !p.includes('/'))) return '';
  const lead = [];
  for (const seg of p.split('/')) {
    if (/[*?[{]/.test(seg)) break;
    lead.push(seg);
  }
  return lead.join('/');
}

/* The folder or file a search covers, absolute: its path (else the cwd) narrowed by its glob's literal lead. */
function searchScope(tool, input, cwd) {
  let base = norm(input.path || '') || norm(cwd);
  if (base && !absolute(base) && cwd) base = norm(cwd) + '/' + base;
  const lead = tool === 'Glob' ? literalLead(input.pattern, true) : literalLead(input.glob, false);
  return base && lead ? base + '/' + lead : base;
}

/* the files a shell command reads (cat, head, tail, sed, Get-Content) or searches (grep, rg,
   Select-String), so a (read) or (search) glob points as on the tools. A command counts only when
   each of its flags is known and a path is plain text: any doubt leaves it silent, never a wrong pointer. */

/* The text without its redirections (2>&1, > out.txt, 2>$null), so a written file is never taken for
   a read one; a heredoc and a here-string stay for commandsOf. */
function dropRedirects(text) {
  const s = String(text || '');
  let out = '';
  let quote = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) { out += c; if (c === quote) quote = null; continue; }
    const here = c === '@' ? /^@(['"])\r?\n/.exec(s.slice(i, i + 4)) : null;
    if (here) {
      const close = s.indexOf('\n' + here[1] + '@', i + 2);
      const end = close < 0 ? s.length : close + 3;
      out += s.slice(i, end);
      i = end - 1;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; out += c; continue; }
    if (c === '<' && s[i + 1] === '<' && s[i + 2] !== '<') { out += '<<'; i++; continue; }
    if (c !== '<' && c !== '>') { out += c; continue; }
    /* the stream the operator names (2>, &>, *>) goes with it */
    out = out.replace(/(^|[\s;&|(])[\d&*]$/, '$1');
    let j = i + 1;
    while (s[j] === '>' || s[j] === '<') j++;
    if (s[j] === '&') { j++; while (j < s.length && /[\d-]/.test(s[j])) j++; } else {
      while (s[j] === ' ' || s[j] === '\t') j++;
      if (s[j] === '"' || s[j] === "'") { const e = s.indexOf(s[j], j + 1); j = e < 0 ? s.length : e + 1; } else while (j < s.length && !/[\s;&|()<>]/.test(s[j])) j++;
    }
    out += ' ';
    i = j - 1;
  }
  return out;
}

/* A path word as an absolute path against `dir`, or null: a variable, a home path or a climb past the root is not known. */
function resolved(dir, word) {
  let p = String(word || '').replace(/\\/g, '/');
  if (!p || p === '-' || /^[~%]/.test(p) || /[$`]/.test(p)) return null;
  /* Git Bash spells C:/x as /c/x */
  if (/^\/[a-z]\//i.test(p) && dir && /^[A-Za-z]:\//.test(dir)) p = p[1].toUpperCase() + ':' + p.slice(2);
  if (!absolute(p)) { if (!dir) return null; p = dir + '/' + p; }
  const out = [];
  for (const seg of p.split('/')) {
    if (seg === '.' || (seg === '' && out.length)) continue;
    if (seg === '..') { if (out.length <= 1) return null; out.pop(); continue; }
    out.push(seg);
  }
  return out.join('/');
}

const wild = (seg) => /[*?[{]/.test(seg);
/* a search over a wildcard path covers the folder before its first wildcard */
function searchRoot(dir, word) {
  const p = resolved(dir, word);
  if (!p) return null;
  const segs = p.split('/');
  const at = segs.findIndex(wild);
  return at < 0 ? p : at < 1 ? null : segs.slice(0, at).join('/');
}

/* Short flags by letter: switches (sw), flags with a value (val); long ones: `long` takes a value, `longSw` none. */
const GREP = { sw: 'EFGPiyvwxcoqsbHhnTZzrRlLaIUV', digits: true, val: 'efmABCdD', search: true,
  long: { regexp: 'e', file: 'f', 'max-count': 'm', 'after-context': 'A', 'before-context': 'B', context: 'C', directories: 'd', devices: 'D',
    include: 'include', exclude: 'exclude', 'exclude-dir': 'exclude', 'exclude-from': 'exclude', label: 'label', 'binary-files': 'binary', 'group-separator': 'sep' },
  longSw: ['recursive', 'dereference-recursive', 'ignore-case', 'no-ignore-case', 'invert-match', 'word-regexp', 'line-regexp', 'count',
    'files-with-matches', 'files-without-match', 'line-number', 'no-filename', 'with-filename', 'only-matching', 'quiet', 'silent', 'no-messages',
    'extended-regexp', 'fixed-strings', 'basic-regexp', 'perl-regexp', 'text', 'null', 'null-data', 'byte-offset', 'initial-tab', 'color',
    'colour', 'line-buffered', 'no-group-separator'] };
const SHELL_LOOKS = {
  cat: { sw: 'AbeEnstTuv' },
  head: { sw: 'qvz', val: 'nc', num: true, long: { lines: 'n', bytes: 'c' }, longSw: ['quiet', 'silent', 'verbose', 'zero-terminated'] },
  tail: { sw: 'qvzfF', val: 'ncs', num: true, long: { lines: 'n', bytes: 'c', 'sleep-interval': 's', pid: 'p', 'max-unchanged-stats': 'm' },
    longSw: ['quiet', 'silent', 'verbose', 'zero-terminated', 'follow', 'retry'] },
  sed: { sw: 'nErsuz', val: 'efl', script: true, long: { expression: 'e', file: 'f', 'line-length': 'l' },
    longSw: ['quiet', 'silent', 'regexp-extended', 'separate', 'unbuffered', 'null-data', 'posix', 'debug', 'sandbox', 'follow-symlinks'] },
  grep: GREP, egrep: GREP, fgrep: GREP,
  rg: { sw: 'abcFhHiIlLnNopPqsSuUvVwxz0.', val: 'ABCdeEfgjmMrtT', search: true,
    long: { regexp: 'e', file: 'f', glob: 'g', iglob: 'g', type: 't', 'type-not': 'T', 'type-add': 'ta', 'type-clear': 'tc', 'after-context': 'A',
      'before-context': 'B', context: 'C', 'max-count': 'm', 'max-columns': 'M', 'max-depth': 'd', maxdepth: 'd', threads: 'j', encoding: 'E',
      replace: 'r', sort: 'sort', sortr: 'sort', color: 'color', colors: 'color', 'context-separator': 'sep', 'field-context-separator': 'sep',
      'field-match-separator': 'sep', 'path-separator': 'sep', pre: 'pre', 'pre-glob': 'pre', 'max-filesize': 'size', engine: 'engine',
      'ignore-file': 'ignore', 'dfa-size-limit': 'size', 'regex-size-limit': 'size', 'hyperlink-format': 'link' },
    longSw: ['files', 'hidden', 'no-ignore', 'no-ignore-vcs', 'no-ignore-parent', 'no-ignore-dot', 'no-ignore-global', 'no-ignore-exclude',
      'no-ignore-files', 'no-heading', 'heading', 'line-number', 'no-line-number', 'files-with-matches', 'files-without-match', 'count',
      'count-matches', 'json', 'multiline', 'multiline-dotall', 'ignore-case', 'smart-case', 'case-sensitive', 'fixed-strings', 'word-regexp',
      'line-regexp', 'follow', 'trim', 'vimgrep', 'no-filename', 'with-filename', 'only-matching', 'invert-match', 'text', 'null', 'null-data',
      'unrestricted', 'column', 'no-column', 'no-messages', 'stats', 'sort-files', 'pcre2', 'auto-hybrid-regex', 'crlf', 'passthru',
      'no-config', 'quiet', 'binary', 'no-binary', 'search-zip', 'one-file-system', 'max-columns-preview', 'glob-case-insensitive',
      'byte-offset', 'pretty', 'no-unicode', 'line-buffered', 'block-buffered', 'include-zero', 'no-require-git'] },
};

/* { got: { key: [values] }, pos }, or null at a flag not known */
function posixArgs(args, spec) {
  const got = {};
  const pos = [];
  const add = (k, v) => (got[k] = got[k] || []).push(v);
  let only = false;
  for (let i = 0; i < args.length; i++) {
    const w = args[i];
    if (only || w === '-' || !w.startsWith('-')) { pos.push(w); continue; }
    if (w === '--') { only = true; continue; }
    if (w.startsWith('--')) {
      const eq = w.indexOf('=');
      const name = eq < 0 ? w.slice(2) : w.slice(2, eq);
      if (spec.long && Object.hasOwn(spec.long, name)) {
        const v = eq < 0 ? args[++i] : w.slice(eq + 1);
        if (v === undefined) return null;
        add(spec.long[name], v);
      } else if ((spec.longSw || []).includes(name)) add(name, true);
      else return null;
      continue;
    }
    if (spec.num && /^-\d+$/.test(w)) continue;
    for (let j = 1; j < w.length; j++) {
      const c = w[j];
      if ((spec.val || '').includes(c)) {
        const v = j + 1 < w.length ? w.slice(j + 1) : args[++i];
        if (v === undefined) return null;
        add(c, v);
        break;
      }
      if (!spec.sw.includes(c) && !(spec.digits && /\d/.test(c))) return null;
      add(c, true);
    }
  }
  return { got, pos };
}

/* PowerShell's parameters by name, a unique prefix allowed: a path, a pattern, a value (v) or a switch (s) */
const PS_COMMON = { erroraction: 'v', ea: 'v', warningaction: 'v', wa: 'v', errorvariable: 'v', ev: 'v', outvariable: 'v', ov: 'v', verbose: 's', debug: 's' };
const GET_CONTENT = { path: 'path', literalpath: 'path', lp: 'path', pspath: 'path', totalcount: 'v', first: 'v', head: 'v', tail: 'v', last: 'v',
  readcount: 'v', encoding: 'v', delimiter: 'v', stream: 'v', credential: 'v', raw: 's', wait: 's', force: 's', asbytestream: 's', ...PS_COMMON };
const SELECT_STRING = { path: 'path', literalpath: 'path', lp: 'path', pattern: 'pattern', context: 'v', encoding: 'v', include: 'v', exclude: 'v',
  culture: 'v', simplematch: 's', casesensitive: 's', notmatch: 's', list: 's', quiet: 's', allmatches: 's', raw: 's', noemphasis: 's', ...PS_COMMON };
/* a PowerShell array written with commas: 'a.txt', 'b.txt' */
function commaItems(words, i) {
  const parts = [words[i]];
  while (i + 1 < words.length && (parts[parts.length - 1].endsWith(',') || words[i + 1].startsWith(','))) parts.push(words[++i]);
  return { items: parts.join('').split(',').filter((x) => x.trim()), next: i };
}
function psArgs(args, names) {
  const got = {};
  const pos = [];
  for (let i = 0; i < args.length; i++) {
    const m = /^-([a-z][a-z0-9]*)(?::(.*))?$/i.exec(args[i]);
    if (!m) { const l = commaItems(args, i); pos.push(l.items); i = l.next; continue; }
    const name = m[1].toLowerCase();
    const kinds = Object.hasOwn(names, name) ? [names[name]] : [...new Set(Object.keys(names).filter((k) => k.startsWith(name)).map((k) => names[k]))];
    if (kinds.length !== 1) return null;
    if (kinds[0] === 's') continue;
    let items;
    if (m[2] !== undefined) items = m[2].split(',');
    else { if (i + 1 >= args.length) return null; const l = commaItems(args, i + 1); items = l.items; i = l.next; }
    got[kinds[0]] = (got[kinds[0]] || []).concat(items);
  }
  return { got, pos };
}

/* What one command reads or searches: [{ occasion, path, pattern }] */
function looksOf(name, lower, args, dir) {
  const read = (ws) => ws.filter((w) => !wild(w)).map((w) => resolved(dir, w)).filter(Boolean).map((path) => ({ occasion: 'read', path, pattern: '' }));
  const search = (ws, pattern, narrow = '') => ws.map((w) => searchRoot(dir, w)).filter(Boolean)
    .map((p) => ({ occasion: 'search', path: narrow ? p + '/' + narrow : p, pattern }));
  if (name === 'get-content' || name === 'gc') {
    const a = psArgs(args, GET_CONTENT);
    if (!a || a.pos.length > (a.got.path ? 0 : 1)) return [];
    return read(a.got.path || a.pos[0] || []);
  }
  if (name === 'select-string' || name === 'sls') {
    const a = psArgs(args, SELECT_STRING);
    if (!a) return [];
    const pattern = a.got.pattern || a.pos.shift() || [];
    const paths = a.got.path || a.pos.shift() || [];
    return a.pos.length ? [] : search(paths, pattern.join('\n'));
  }
  const spec = SHELL_LOOKS[name];
  if (!spec || !readsOnly(lower)) return [];
  const a = posixArgs(args, spec);
  if (!a) return [];
  let pos = a.pos;
  let pattern = '';
  if (spec.search || spec.script) {
    if (a.got.e || a.got.f || (name === 'rg' && a.got.files)) pattern = (a.got.e || []).join('\n');
    else { if (!pos.length) return []; pattern = pos[0]; pos = pos.slice(1); }
  }
  if (!spec.search) return read(pos);
  /* grep searches the folder only when recursive; rg with no path may be reading a pipe */
  if (!pos.length && name !== 'rg' && (a.got.r || a.got.R || a.got.recursive || a.got['dereference-recursive'])) pos = ['.'];
  const globs = (a.got.g || []).filter((g) => !g.startsWith('!'));
  return search(pos, pattern, globs.length === 1 && !a.got.g.some((g) => g.startsWith('!')) ? literalLead(globs[0], false) : '');
}

/* the script a shell launcher runs: bash -c, pwsh -Command, cmd /c */
function scriptOf(name, lower, args) {
  if (['bash', 'sh', 'zsh', 'dash', 'ksh'].includes(name)) { const i = lower.findIndex((w) => /^-[a-z]*c[a-z]*$/.test(w)); return i < 0 ? null : args[i + 1] ?? null; }
  if (name === 'pwsh' || name === 'powershell') { const i = lower.findIndex((w) => /^-c(?:o(?:m(?:m(?:a(?:n(?:d)?)?)?)?)?)?$/.test(w)); return i < 0 ? null : args.slice(i + 1).join(' '); }
  if (name === 'cmd') { const i = lower.findIndex((w) => /^\/[ck]$/.test(w)); return i < 0 ? null : args.slice(i + 1).join(' '); }
  return null;
}

export function shellLooks(command, cwd, depth = 0) {
  const looks = [];
  let dir = cwd ? resolved(null, norm(cwd)) : null;
  for (const words of commandsOf(dropRedirects(command), { keepCase: true }).cmds) {
    const lower = words.map((w) => w.toLowerCase());
    const at = programAt(lower);
    const name = programName(lower[at] || '');
    const args = words.slice(at + 1);
    /* a move sets the folder the next commands' paths resolve against; one not known silences them */
    if (MOVES.includes(name)) {
      const to = args.filter((w) => !/^-(?:[lpe@]|path|literalpath|lp)$/i.test(w));
      dir = to.length === 1 ? resolved(dir, to[0]) : null;
      continue;
    }
    const inner = depth < 3 ? scriptOf(name, lower.slice(at + 1), args) : null;
    looks.push(...(inner !== null ? shellLooks(inner, dir, depth + 1) : looksOf(name, lower, args, dir)));
  }
  return looks;
}

/* The why of the first glob of `d` that takes `rel` on this occasion, or null (`<glob> | <contains>`
   wants the edit's text or the search's pattern to hold it; a read is decided by the glob). */
function linkWhy(d, occasion, rel, { pattern = '', text = () => '' } = {}) {
  for (const f of d.files || []) {
    const l = fileLink(f);
    if (!l.glob || !l.on.includes(occasion)) continue;
    if (occasion === 'search') {
      if (!couldHold(l.glob, rel)) continue;
      if (l.contains && !String(pattern).toLowerCase().includes(l.contains.toLowerCase())) continue;
    } else {
      if (!globRe(l.glob).test(rel)) continue;
      /* any case, as a search's word: a ruling on "Opus" bears on "agent:opus" too */
      if (l.contains && occasion === 'edit' && !text().toLowerCase().includes(l.contains.toLowerCase())) continue;
    }
    return 'the ' + occasion + ' of ' + (rel || 'the repo') + ' matches ' + String(f);
  }
  return null;
}

/* [{ decision, why }]: a command while the call runs in the decision's checkout, or a file the
   command reads or searches (resolved against `shellCwd`, the shell's folder); an edited, read or
   searched path one of its globs takes on that occasion. */
export function decisionHits(rows, { tool, input, cwd, shellCwd } = {}) {
  const inp = input && typeof input === 'object' ? input : {};
  const hits = [];
  const occasion = FILE_TOOLS.includes(tool) ? 'edit' : READ_TOOLS.includes(tool) ? 'read' : SEARCH_TOOLS.includes(tool) ? 'search' : null;
  const cmd = COMMAND_TOOLS.includes(tool) ? String(inp.command || '') : '';
  let looks = null;
  for (const d of Array.isArray(rows) ? rows : []) {
    if (!d || !d.id) continue;
    if (COMMAND_TOOLS.includes(tool)) {
      if (!cmd.trim()) continue;
      const frag = (!d.project || inside(d.project, cwd || '') !== null) && (d.commands || []).find((c) => c && commandMatches(cmd, String(c)));
      if (frag) { hits.push({ decision: d, why: triggerWhy(frag) }); continue; }
      if (!d.project || !(d.files || []).some((f) => /^\(/.test(String(f).trim()))) continue;
      if (looks === null) looks = shellLooks(cmd, shellCwd || cwd);
      for (const look of looks) {
        const rel = inside(d.project, look.path);
        const why = rel === null || (!rel && look.occasion !== 'search') ? null : linkWhy(d, look.occasion, rel, { pattern: look.pattern });
        if (why) { hits.push({ decision: d, why }); break; }
      }
    } else if (occasion) {
      if (!d.project) continue;
      let path = occasion === 'search' ? searchScope(tool, inp, cwd) : norm(inp.file_path || inp.notebook_path || '');
      if (!path) continue;
      if (!absolute(path) && cwd) path = norm(cwd) + '/' + path;
      const rel = inside(d.project, path);
      if (rel === null || (!rel && occasion !== 'search')) continue;
      const why = linkWhy(d, occasion, rel, { pattern: inp.pattern || '', text: () => editText(tool, inp) });
      if (why) hits.push({ decision: d, why });
    }
  }
  return hits;
}

/* how a pointer and its toast name the call: the file inside the cwd, or the
   command's first program and words */
export function callSubject(tool, input, cwd) {
  const inp = input && typeof input === 'object' ? input : {};
  if (COMMAND_TOOLS.includes(tool)) {
    const words = commandsOf(inp.command, { keepCase: true }).cmds.find((w) => w.length && !MOVES.includes(String(w[0]).toLowerCase())) || [];
    const cut = [];
    for (const w of words) { if (cut.length === 4 || w.length > 60 || /\s/.test(w)) break; cut.push(w); }
    return cut.join(' ') || 'this command';
  }
  const occasion = FILE_TOOLS.includes(tool) ? 'edit' : READ_TOOLS.includes(tool) ? 'read' : SEARCH_TOOLS.includes(tool) ? 'search' : '';
  /* a search is named by the folder it covers, as decisionHits reads it: a Grep pattern is a regex, not a path */
  let p = occasion === 'search' ? searchScope(tool, inp, cwd) : norm(inp.file_path || inp.notebook_path || '');
  if (p && !absolute(p) && cwd) p = norm(cwd) + '/' + p;
  const rel = p ? inside(cwd || '', p) : null;
  const name = rel || (rel === '' ? 'the repo' : p.split('/').pop());
  return occasion && name ? 'the ' + occasion + ' of ' + name : 'this call';
}

/* What a turn ran, proposed as a ruling's commands when it names no links: each command that
   runs something, cut to its program and first words; the AskerDo CLI's own calls, reads, folder
   moves and git bookkeeping are left out. Edited files are never proposed: a shared file
   drew every ruling recorded beside it. */
const LINKS_MAX = 10;
const HUB = /askerdo[\\/]cli\.mjs|bin[\\/]askerdo\.mjs/;
const MOVES = ['cd', 'set-location', 'sl', 'pushd', 'popd'];
/* the session's own version control bookkeeping, which every turn that commits runs; a forced
   or hard one stays, since a ruling is plausibly about it */
const GIT_BOOKKEEPING = ['add', 'commit', 'push', 'pull', 'fetch', 'stash', 'checkout', 'switch', 'restore', 'merge'];
function gitBookkeeping(words) {
  if (words[0] !== 'git') return false;
  let i = 1;
  while (i < words.length && words[i].startsWith('-')) i += /^-[Cc]$/.test(words[i]) ? 2 : 1;
  if (!GIT_BOOKKEEPING.includes(words[i])) return false;
  const rest = words.slice(i + 1);
  if (rest.some((w) => /^--force|^--hard$|^-f$/.test(w))) return false;
  /* a push that deletes a branch or forces one refspec is as plausible a ruling */
  return !(words[i] === 'push' && rest.some((w) => /^(-d|--delete)$|^[:+]./.test(w)));
}
export function turnCommands(calls) {
  const commands = [];
  for (const c of Array.isArray(calls) ? calls : []) {
    const inp = c && c.input && typeof c.input === 'object' ? c.input : {};
    if (!COMMAND_TOOLS.includes(c && c.tool) || HUB.test(String(inp.command || ''))) continue;
    const kept = commandsOf(inp.command, { keepCase: true }).cmds;
    commandsOf(inp.command).cmds.forEach((words, i) => {
      const at = words.findIndex((w) => !/^[a-z_][a-z0-9_]*=/.test(w));
      if (at < 0 || readsOnly(words) || MOVES.includes(words[at]) || words[at].startsWith('$') || gitBookkeeping(words.slice(at))) return;
      const cut = [];
      for (const w of kept[i].slice(at)) { if (cut.length === 4 || w.length > 60 || /\s/.test(w)) break; cut.push(w); }
      const f = cut.join(' ');
      if (f && !commands.includes(f)) commands.push(f);
    });
  }
  return commands.slice(0, LINKS_MAX);
}
