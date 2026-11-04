/* Procedure triggers and finding (docs/procedures/README.md): pure, no
   imports, so the mod's tool-call watcher and the CLI match one way. A card
   here is the shape `askerdo proc triggers --json` prints. */

export const COMMAND_TOOLS = ['Bash', 'PowerShell'];
export const FILE_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'];

/* Forward slashes, no trailing slash. */
export function normPath(p) {
  return String(p || '').trim().replace(/\\/g, '/').replace(/(.)\/+$/, '$1');
}

/* a drive path compares without case */
const caseless = (p) => (/^[A-Za-z]:\//.test(p) ? p.toLowerCase() : p);
export const isAbsolute = (p) => /^[A-Za-z]:[\\/]/.test(String(p)) || String(p).startsWith('/');

/* The path inside `dir`, repo-relative, or null when it lies outside. */
export function relativeTo(dir, path) {
  const d = caseless(normPath(dir));
  const p = normPath(path);
  const lp = caseless(p);
  if (!d) return null;
  if (lp === d) return '';
  return lp.startsWith(d + '/') ? p.slice(d.length + 1) : null;
}

/* `*` within a segment, `**` across them, `?` one character. */
export function globRe(glob) {
  let out = '';
  const g = String(glob);
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*' && g[i + 1] === '*') {
      if (g[i + 2] === '/') { out += '(?:.*/)?'; i += 2; } else { out += '.*'; i += 1; }
    } else if (c === '*') out += '[^/]*';
    else if (c === '?') out += '[^/]';
    else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + out + '$', 'i');
}

/* A stored file trigger: `<glob>` or `<glob> | <contains>`, the glob maybe `<repo>:`. */
export function fileTrigger(s) {
  const raw = String(s || '');
  const bar = raw.indexOf(' | ');
  const glob = bar < 0 ? raw : raw.slice(0, bar);
  const contains = bar < 0 ? '' : raw.slice(bar + 3);
  const m = /^([a-z0-9][a-z0-9-]*):(?!\/)(.+)$/.exec(glob);
  return m ? { repo: m[1], glob: m[2], contains } : { repo: 'self', glob, contains };
}

export const fileTriggerText = (t) => (t.repo && t.repo !== 'self' ? t.repo + ':' : '') + t.glob + (t.contains ? ' | ' + t.contains : '');

/* The owning repo first, then the others the steps touch. */
export function coveredRepos(card) {
  const out = [{ name: 'self', root: String(card.project || '') }];
  for (const [name, root] of Object.entries(card.repos || {})) out.push({ name, root: String(root) });
  return out.filter((r) => r.root);
}

function editText(tool, input) {
  if (tool === 'Write') return String(input.content || '');
  if (tool === 'NotebookEdit') return String(input.new_source || '');
  if (tool === 'MultiEdit') return (Array.isArray(input.edits) ? input.edits : []).map((e) => String((e && e.new_string) || '')).join('\n');
  return String(input.new_string || '');
}

/* Command text as commands of words, lowercased: split at && || ; | & ( ) and line
   ends outside quotes, a word opening with # comments out the line, quotes removed,
   a backslash literal (PowerShell paths). A heredoc's body and a PowerShell here-string
   are data, never commands. `open`: the text ends inside a quote. */
export function commandsOf(text) {
  const s = String(text || '').toLowerCase();
  const cmds = [];
  let words = [];
  let word = null;
  let quote = null;
  let comment = false;
  const bodies = [];
  const end = () => { if (word !== null) words.push(word); word = null; };
  const next = () => { end(); if (words.length) cmds.push(words); words = []; };
  /* at a line end: skip each pending heredoc body through its delimiter line */
  const skipBodies = (i) => {
    while (bodies.length) {
      const d = bodies.shift();
      for (let j = i + 1; ; ) {
        const e = s.indexOf('\n', j);
        const line = s.slice(j, e < 0 ? s.length : e).replace(/\r$/, '');
        if (e < 0 || line.trim() === d) { i = e < 0 ? s.length : e; break; }
        j = e + 1;
      }
    }
    return i;
  };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (comment) { if (c === '\n') { comment = false; next(); i = skipBodies(i); } continue; }
    if (quote) {
      if (c === quote) quote = null;
      else if (c === '\\' && quote === '"' && s[i + 1] === '"') { word += '"'; i++; } else word += c;
      continue;
    }
    const here = c === '@' && word === null ? /^@(['"])\r?\n/.exec(s.slice(i, i + 4)) : null;
    if (here) {
      const close = s.indexOf('\n' + here[1] + '@', i + 2);
      word = s.slice(i + here[0].length, close < 0 ? s.length : close);
      i = close < 0 ? s.length : close + 2;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; if (word === null) word = ''; } else if (c === '\n') { next(); i = skipBodies(i); } else if (';|&()'.includes(c)) next();
    else if (c === '<' && s[i + 1] === '<' && s[i + 2] !== '<') {
      end();
      const m = /^<<-?[ \t]*(['"]?)([^\s'"<>;|&()]+)\1/.exec(s.slice(i));
      if (m) { bodies.push(m[2]); i += m[0].length - 1; } else i++;
    } else if (/\s/.test(c) || c === '<' || c === '>') end();
    else if (c === '#' && word === null) comment = true;
    else word = (word ?? '') + c;
  }
  const open = quote !== null;
  next();
  return { cmds, open };
}

/* a program compares by its file name: node takes C:/nodejs/node.exe */
const programName = (w) => w.split(/[\\/]/).pop().replace(/\.(?:exe|cmd|bat)$/, '');

/* The index of the command's program: past VAR=x assignments and sudo, env and the like. */
const WRAPPERS = ['sudo', 'env', 'exec', 'nohup', 'time', 'command'];
function programAt(words) {
  let i = 0;
  while (i < words.length) {
    if (/^[a-z_][a-z0-9_]*=/.test(words[i])) i++;
    else if (WRAPPERS.includes(words[i])) {
      i++;
      while (i < words.length && words[i].startsWith('-')) i += words[i] === '-u' ? 2 : 1;
    } else break;
  }
  return i;
}

/* a command that only reads or prints text runs no procedure, whatever it names */
const READERS = ['grep', 'egrep', 'fgrep', 'rg', 'ag', 'findstr', 'select-string', 'sls', 'cat', 'type', 'get-content', 'gc',
  'head', 'tail', 'less', 'more', 'wc', 'diff', 'ls', 'dir', 'get-childitem', 'gci', 'find', 'test-path',
  'echo', 'printf', 'write-output', 'write-host'];
const GIT_READERS = ['grep', 'log', 'show', 'diff', 'blame', 'status'];
function readsOnly(words) {
  const p = programAt(words);
  const name = programName(words[p] || '');
  if (READERS.includes(name)) return true;
  if (name === 'sed') return !words.slice(p + 1).some((w) => /^-[a-z]*i/.test(w) || w.startsWith('--in-place'));
  if (name !== 'git') return false;
  let i = p + 1;
  while (i < words.length && words[i].startsWith('-')) i += words[i] === '-c' ? 2 : 1;
  return GIT_READERS.includes(words[i]);
}

/* the command a launcher runs is matched as that command: xargs, find -exec,
   wsl, a shell's -c, PowerShell's -Command, node -e (its strings only when it spawns) */
const SHELLS = ['bash', 'sh', 'zsh', 'dash', 'ksh'];
const XARGS_VALUE = ['-i', '-n', '-p', '-l', '-d', '-e', '-s', '-a'];
const WSL_VALUE = ['-d', '--distribution', '-u', '--user', '--cd'];
function innerOf(words) {
  const p = programAt(words);
  const name = programName(words[p] || '');
  const rest = words.slice(p + 1);
  const script = (text) => commandsOf(text).cmds;
  if (name === 'xargs' || name === 'wsl') {
    const value = name === 'xargs' ? XARGS_VALUE : WSL_VALUE;
    let i = 0;
    while (i < rest.length && rest[i].startsWith('-')) i += value.includes(rest[i]) ? 2 : 1;
    return [rest.slice(i)];
  }
  if (name === 'find') {
    return rest.flatMap((w, i) => {
      if (!['-exec', '-execdir', '-ok', '-okdir'].includes(w)) return [];
      const tail = rest.slice(i + 1);
      const end = tail.findIndex((x) => ['\\', '+', ';'].includes(x));
      return [tail.slice(0, end < 0 ? tail.length : end)];
    });
  }
  if (SHELLS.includes(name)) {
    const i = rest.findIndex((w) => /^-[a-z]*c[a-z]*$/.test(w));
    return i < 0 || i + 1 >= rest.length ? [] : script(rest[i + 1]);
  }
  if (name === 'pwsh' || name === 'powershell') {
    const i = rest.findIndex((w) => /^-c(?:o(?:m(?:m(?:a(?:n(?:d)?)?)?)?)?)?$/.test(w));
    return i < 0 ? [] : script(rest.slice(i + 1).join(' '));
  }
  if (name === 'node') {
    const i = rest.findIndex((w) => ['-e', '--eval', '-p', '--print', '-pe'].includes(w));
    if (i < 0 || i + 1 >= rest.length) return [];
    const code = script(rest[i + 1]);
    if (!/\b(?:exec|spawn)/.test(rest[i + 1])) return code;
    return code.concat(code.flatMap((ws) => ws.filter((w) => /\s/.test(w)).flatMap(script)));
  }
  return [];
}
const withInner = (cmds, depth = 0) => (depth > 3 ? cmds : cmds.concat(withInner(cmds.flatMap(innerOf), depth + 1)));

/* A trigger of one bare word names a program: the command runs it (or a script of that
   name). A word with a dot or slash names a file, found inside one argument, never inside
   a quoted phrase. Several words are a program and its arguments, matched word for word
   in one command. A command that only reads text (grep, cat, echo) never matches. */
export function commandMatches(command, trigger) {
  const t = commandsOf(trigger);
  const tw = t.cmds.length === 1 ? t.cmds[0] : null;
  if (!tw) return false;
  const cmds = withInner(commandsOf(command).cmds).filter((words) => !readsOnly(words));
  if (tw.length === 1 && !t.open) {
    const want = tw[0];
    if (/[./\\]/.test(want)) return cmds.some((words) => words.some((w) => !/\s/.test(w) && w.includes(want)));
    const script = (w) => !/\s/.test(w) && /\.[a-z0-9]+$/.test(w) && programName(w).replace(/\.[a-z0-9]+$/, '') === want;
    return cmds.some((words) => { const p = programAt(words); return programName(words[p] || '') === want || words.slice(p).some(script); });
  }
  const last = tw.length - 1;
  const at = (words, j) => {
    const eq = (i) => (i === 0 ? programName(words[j]) === programName(tw[0]) : words[j + i] === tw[i]);
    for (let i = 0; i < last; i++) if (!eq(i)) return false;
    /* a trigger ending inside a quote takes the start of that argument */
    return t.open ? words[j + last].startsWith(tw[last]) : eq(last);
  };
  return cmds.some((words) => words.some((_, j) => j + last < words.length && at(words, j)));
}

/* How a pointer names its trigger: a file name is contained, a program or command line runs. */
export function triggerWhy(frag) {
  const f = String(frag).trim();
  return (/[./\\]/.test(f) && !/\s/.test(f) ? 'the command contains ' : 'the command runs ') + f;
}

/* a command that sets AskerDo's seam runs against a sandbox store and data dir */
export const sandboxed = (command) => /(?:^|[\s;&|(])(?:export\s+|\$env:)?(?:askerdo_root|askerdo_sandbox_home)\s*=\s*(?![\s;]|\$null\b|''|""|$)/i.test(String(command || ''));

/* Which cards a tool call matches, and why: a command trigger while the working
   directory is in a covered repo, or an edited path a file glob takes. */
export function matchCall(cards, { tool, input, cwd } = {}) {
  const inp = input && typeof input === 'object' ? input : {};
  const hits = [];
  for (const card of Array.isArray(cards) ? cards : []) {
    if (!card || card.status === 'retired') continue;
    /* an everywhere card matches as the session project's own */
    const repos = card.everywhere ? (cwd ? [{ name: 'self', root: normPath(cwd) }] : []) : coveredRepos(card);
    if (COMMAND_TOOLS.includes(tool)) {
      const cmd = String(inp.command || '');
      if (!cmd.trim() || !repos.some((r) => relativeTo(r.root, cwd || '') !== null)) continue;
      /* a card for the live install never points at a sandboxed run */
      if (card.live && sandboxed(cmd)) continue;
      const frag = (card.commands || []).find((c) => c && commandMatches(cmd, String(c)));
      if (frag) hits.push({ card, why: triggerWhy(frag) });
    } else if (FILE_TOOLS.includes(tool)) {
      let path = String(inp.file_path || inp.notebook_path || '');
      if (!path) continue;
      if (!isAbsolute(path) && cwd) path = normPath(cwd) + '/' + path;
      const text = editText(tool, inp);
      for (const t of (card.files || []).map(fileTrigger)) {
        const r = repos.find((x) => x.name === t.repo);
        const rel = r ? relativeTo(r.root, path) : null;
        if (rel === null || !rel || !globRe(t.glob).test(rel)) continue;
        if (t.contains && !text.includes(t.contains)) continue;
        hits.push({ card, why: 'the edit of ' + rel + ' matches ' + fileTriggerText(t) });
        break;
      }
    }
  }
  return hits;
}

/* README: a procedure matches when every query word occurs in one phrase or in
   the title. Cards of `project` come first. */
export function findCards(cards, words, { project } = {}) {
  const want = String(words || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!want.length) return [];
  const out = [];
  for (const card of Array.isArray(cards) ? cards : []) {
    if (!card) continue;
    const phrases = [String(card.name || ''), String(card.slug || '')].concat(card.words || []).map((p) => String(p).toLowerCase());
    if (phrases.some((p) => want.every((w) => p.includes(w)))) out.push(card);
  }
  const home = (c) => (project && relativeTo(c.project, project) !== null ? 0 : 1);
  const retired = (c) => (c.status === 'retired' ? 1 : 0);
  return out.sort((a, b) => retired(a) - retired(b) || home(a) - home(b));
}

/* The card's state in a word and its reasons: flagged, stale, never run or fresh. */
export function badgeOf(card) {
  const c = card || {};
  if (c.status === 'retired') return { badge: 'retired', reasons: ['the file is gone from ' + String(c.project || 'its repo')] };
  if (c.flag) return { badge: 'flagged', reasons: ['the last run deviated: ' + c.flag] };
  if (Array.isArray(c.stale) && c.stale.length) return { badge: 'stale', reasons: c.stale.slice() };
  if (!c.verifiedAt) return { badge: 'never run', reasons: [] };
  return { badge: 'fresh', reasons: [] };
}

export const procPath = (card) => normPath(card.project) + '/' + String(card.doc || '');

/* The note the model reads when a call matches (a pointer, never a block). A
   subagent's call (`agent`) is never asked to write the board: its caller records. */
export function procNote(card, why, { agent = false } = {}) {
  const b = badgeOf(card);
  const state = b.badge === 'stale' || b.badge === 'flagged'
    ? ' The card is ' + b.badge + ' (' + b.reasons.slice(0, 3).join('; ') + '), so check each step against the code as you go.'
    : '';
  const record = agent
    ? ' Do not record the run yourself: say in your report whether you followed it, and the session that dispatched you records it.'
    : ' When done, record the run: askerdo proc ran ' + card.slug + ' clean, or deviated --note "what differed".';
  return 'AskerDo procedure pointer (nothing was blocked): ' + why + ', which is procedure '
    + card.id + ' ' + card.name + '. Its steps are in ' + procPath(card) + ': read the file and follow it.' + state + record;
}

export const procToast = (card) => 'Procedure ' + card.id + ' ' + card.name + ' applies: ' + card.doc;

/* What `/askerdo proc` answers, from the CLI's JSON. */
export function findText(rows, words) {
  if (!Array.isArray(rows) || !rows.length) return 'No procedure matches "' + words + '". /askerdo proc scan reads this project\'s docs/procedures.'
  return rows.slice(0, 6).map((c) => c.id + ' ' + c.slug + ' [' + c.badge + ']: ' + c.name + '\n  ' + c.path
    + (c.reasons && c.reasons.length ? '\n  ' + c.reasons.slice(0, 2).join('; ') : '')).join('\n')
    + (rows.length > 6 ? '\n' + (rows.length - 6) + ' more.' : '');
}

export function ranText(r) {
  return 'Recorded a ' + r.result + ' run of ' + r.id + ' ' + r.slug + ' (' + r.runs + (r.runs === 1 ? ' run, ' : ' runs, ')
    + r.cleanRuns + ' clean in a row).'
    + (r.stale && r.stale.length ? '\nStill stale: ' + r.stale.slice(0, 3).join('; ') + '.' : '')
    + (r.draft ? '\n' + r.draft : '') + (r.suggestScript ? '\n' + r.suggestScript : '');
}

export function scanText(r) {
  const parts = ['created', 'updated', 'retired', 'unchanged'].filter((k) => r[k] && r[k].length).map((k) => k + ' ' + r[k].join(', '));
  const ew = ['created', 'updated', 'retired'].filter((k) => r.everywhere && r.everywhere[k] && r.everywhere[k].length).map((k) => k + ' ' + r.everywhere[k].join(', '));
  return 'Procedures of ' + r.project + ': ' + (parts.length ? parts.join('; ') : 'none in docs/procedures') + '.'
    + (ew.length ? '\nThe AskerDo plugin\'s cards for every project: ' + ew.join('; ') + '.' : '')
    + (r.unparseable || []).map((u) => '\nUnparseable ' + u.file + ': ' + u.errors.slice(0, 2).join('; ')).join('')
    + (r.warnings || []).map((w) => '\nLint ' + w.file + ': ' + w.warnings.slice(0, 2).join('; ')).join('');
}

/* `/askerdo proc ran <name> clean|deviated ["note"]`, `proc scan`, or words to find. */
export function parseProc(args) {
  const s = String(args || '').trim();
  const usage = 'Usage: /askerdo proc <words> | proc ran <name> clean | proc ran <name> deviated "what differed" | proc scan';
  if (!s) return { error: usage };
  const m = /^ran\s+(\S+)\s+(clean|deviated)\b\s*([\s\S]*)$/i.exec(s);
  if (m) {
    const t = m[3].trim();
    const q = t.match(/^"([\s\S]*)"$/) || t.match(/^'([\s\S]*)'$/);
    const note = (q ? q[1] : t).trim();
    if (m[2].toLowerCase() === 'deviated' && !note) return { error: 'A deviated run needs a note: /askerdo proc ran ' + m[1] + ' deviated "what differed"' };
    return { sub: 'ran', name: m[1], result: m[2].toLowerCase(), note };
  }
  if (/^ran\b/i.test(s)) return { error: usage };
  if (/^scan$/i.test(s)) return { sub: 'scan' };
  return { sub: 'find', words: s };
}
