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
   are data, never commands. `open`: the text ends inside a quote. `keepCase` keeps the
   words as written, for a caller that quotes them back. */
export function commandsOf(text, { keepCase = false } = {}) {
  const s = keepCase ? String(text || '') : String(text || '').toLowerCase();
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
export const programName = (w) => w.split(/[\\/]/).pop().replace(/\.(?:exe|cmd|bat)$/, '');

/* The index of the command's program: past VAR=x assignments and sudo, env and the like. */
const WRAPPERS = ['sudo', 'env', 'exec', 'nohup', 'time', 'command'];
export function programAt(words) {
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
export function readsOnly(words) {
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
   wsl, a shell's -c, PowerShell's -Command and Start-Process, cmd /c, node -e (its strings only when it spawns) */
const SHELLS = ['bash', 'sh', 'zsh', 'dash', 'ksh'];
const SHELL_C = /^-[a-z]*c[a-z]*$/;
const PS_COMMAND = /^-c(?:o(?:m(?:m(?:a(?:n(?:d)?)?)?)?)?)?$/;
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
    const i = rest.findIndex((w) => SHELL_C.test(w));
    return i < 0 || i + 1 >= rest.length ? [] : script(rest[i + 1]);
  }
  if (name === 'pwsh' || name === 'powershell') {
    const i = rest.findIndex((w) => PS_COMMAND.test(w));
    return i < 0 ? [] : script(rest.slice(i + 1).join(' '));
  }
  if (name === 'cmd') {
    const i = rest.findIndex((w) => /^\/[ck]$/.test(w));
    return i < 0 ? [] : script(rest.slice(i + 1).join(' '));
  }
  if (name === 'start-process' || name === 'saps') return startProcess(rest);
  if (name === 'node') {
    const i = rest.findIndex((w) => ['-e', '--eval', '-p', '--print', '-pe'].includes(w));
    if (i < 0 || i + 1 >= rest.length) return [];
    const code = script(rest[i + 1]);
    if (!/\b(?:exec|spawn)/.test(rest[i + 1])) return code;
    return code.concat(code.flatMap((ws) => ws.filter((w) => /\s/.test(w)).flatMap(script)));
  }
  return [];
}
/* Start-Process runs its -FilePath (else its first positional) with its -ArgumentList
   (else its second), a comma list of strings PowerShell joins with spaces */
const SP_VALUE = ['workingdirectory', 'credential', 'redirectstandarderror', 'redirectstandardinput', 'redirectstandardoutput',
  'verb', 'windowstyle', 'environment', 'erroraction', 'ea', 'warningaction', 'wa'];
const commaList = (words, i) => {
  const parts = [words[i]];
  while (i + 1 < words.length && (parts[parts.length - 1].endsWith(',') || words[i + 1].startsWith(','))) parts.push(words[++i]);
  return { items: parts.join('').split(',').filter((x) => x.trim()), next: i };
};
function startProcess(rest) {
  let file = null;
  let args = null;
  for (let i = 0; i < rest.length; i++) {
    const m = /^-([a-z]+)(?::(.*))?$/.exec(rest[i]);
    const name = m ? m[1] : '';
    if (m && name.length && ('filepath'.startsWith(name) || name === 'path' || name === 'pspath')) {
      if (m[2] !== undefined) file = m[2]; else if (i + 1 < rest.length) file = rest[++i];
    } else if (m && name.length > 1 && ('argumentlist'.startsWith(name) || name === 'args')) {
      if (m[2] !== undefined) args = m[2].split(',');
      else if (i + 1 < rest.length) { const l = commaList(rest, i + 1); args = l.items; i = l.next; }
    } else if (m && SP_VALUE.some((v) => v === name || (name.length > 2 && v.startsWith(name)))) {
      if (m[2] === undefined) i++;
    } else if (m) continue;
    else if (file === null) file = rest[i];
    else if (args === null) { const l = commaList(rest, i); args = l.items; i = l.next; }
  }
  if (!file) return [];
  return [[file, ...(args || []).flatMap((a) => commandsOf(a).cmds.flat())]];
}
const withInner = (cmds, depth = 0) => (depth > 3 ? cmds : cmds.concat(withInner(cmds.flatMap(innerOf), depth + 1)));

/* The files a command runs: its program, and the unquoted arguments of a program that runs
   scripts (a shell or PowerShell outside -c, gh only as workflow run). git, cp, rm and the
   like only name a file, so a commit of a procedure's script is never a run of it. */
const RUNNERS = ['node', 'npx', 'bunx', 'tsx', 'ts-node', 'deno', 'bun', 'python', 'python3', 'py', 'pytest', 'flutter', 'dart',
  'ruby', 'perl', 'php', 'rscript', '.', 'source'];
/* these run a file only through their run subcommand: `go build` or `uv pip` runs none */
const RUN_SUB = ['uv', 'go', 'poetry', 'pipenv'];
function ranFiles(words) {
  const p = programAt(words);
  const name = programName(words[p] || '');
  const args = words.slice(p + 1);
  let runs = RUNNERS.includes(name) || (RUN_SUB.includes(name) && args.find((w) => !w.startsWith('-')) === 'run');
  if (SHELLS.includes(name)) runs = !args.some((w) => SHELL_C.test(w));
  if (name === 'pwsh' || name === 'powershell') runs = !args.some((w) => PS_COMMAND.test(w));
  if (name === 'gh') runs = args[0] === 'workflow' && args[1] === 'run';
  return [words[p] || ''].concat(runs ? args.filter((w) => !/\s/.test(w)) : []);
}

/* One trigger word that is a flag (--counter-tone) or an environment setting (NAME=value,
   or a NAME in capitals with an underscore) names a setting a run carries, never a program. */
function settingOf(raw) {
  const w = String(raw || '').trim();
  if (/^--?[a-z0-9]/i.test(w)) return { flag: w.toLowerCase() };
  const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(w);
  if (m) return { name: m[1].toLowerCase(), value: m[2].toLowerCase() };
  return /^[A-Z][A-Z0-9]*_[A-Z0-9_]*$/.test(w) ? { name: w.toLowerCase(), value: null } : null;
}

/* The NAME=value words a command sets: before its program (X=1 node a.js), or the whole
   command when it only sets (export X=1, set X=1, $env:X = '1'), which sets for the rest. */
const ASSIGN = /^[a-z_][a-z0-9_]*=/;
function envOf(words) {
  const p = programAt(words);
  const sets = words.slice(0, p).filter((w) => ASSIGN.test(w));
  const name = words[p] || '';
  if (name === 'export' || name === 'set') return { sets: sets.concat(words.slice(p + 1).filter((w) => ASSIGN.test(w))), runs: false };
  const ps = /^\$env:([a-z_][a-z0-9_]*)(?:=(.*))?$/.exec(name);
  if (ps) return { sets: sets.concat(ps[1] + '=' + (ps[2] ?? (words[p + 1] === '=' ? words[p + 2] ?? '' : ''))), runs: false };
  return { sets, runs: p < words.length };
}

/* A setting matches a command, git aside (its flags are git's), that runs with it: a flag among
   its arguments, the setting before it or earlier in the call, or as a flag's value
   (--dart-define=NAME=value). */
function runsWith(cmds, s) {
  const isSet = (a) => {
    const i = a.indexOf('=');
    const v = a.slice(i + 1);
    return !s.flag && i > 0 && a.slice(0, i) === s.name && (s.value === null ? v !== '' && v !== '$null' : v === s.value);
  };
  const arg = (w) => (s.flag ? w === s.flag || w.startsWith(s.flag + '=') : isSet(w) || (w.includes('=') && isSet(w.slice(w.indexOf('=') + 1))));
  const git = (words) => programName(words[programAt(words)] || '') === 'git';
  const each = cmds.map((words) => ({ words, ...envOf(words) }));
  return each.some((c, i) => {
    if (git(c.words)) return false;
    if (c.runs && c.words.slice(programAt(c.words) + 1).some(arg)) return true;
    return c.sets.some(isSet) && (c.runs || each.slice(i + 1).some((x) => x.runs && !git(x.words)));
  });
}

/* a run file is the trigger's file when its path ends at that file on a path
   boundary, never a longer name or a folder of the same text (~/.claude/askerdo/cli.mjs) */
const slashed = (p) => p.replace(/\\/g, '/').replace(/^\.\//, '');
function fileIs(word, want) {
  const w = slashed(word);
  const t = slashed(want);
  return w === t || w.endsWith(t.startsWith('/') ? t : '/' + t);
}

/* A trigger of one bare word names a program: the command runs it (or a script of that
   name). A word with a dot or slash names a file the command runs (ranFiles). A flag or an
   environment setting matches a run carrying it (runsWith). Several words are a program and
   its arguments, matched word for word in one command. A command that only reads text
   (grep, cat, echo) never matches. */
export function commandMatches(command, trigger) {
  const t = commandsOf(trigger);
  const tw = t.cmds.length === 1 ? t.cmds[0] : null;
  if (!tw) return false;
  const cmds = withInner(commandsOf(command).cmds).filter((words) => !readsOnly(words));
  const setting = tw.length === 1 && !t.open ? settingOf(commandsOf(trigger, { keepCase: true }).cmds[0][0]) : null;
  if (setting) return runsWith(cmds, setting);
  if (tw.length === 1 && !t.open) {
    const want = tw[0];
    /* /name is a slash command, which only a prompt word carries (claude -p "/name ..."), never a path's last segment */
    if (/^\/[a-z0-9][a-z0-9:_-]*$/.test(want)) return cmds.some((words) => words.some((w) => w === want || w.startsWith(want + ' ')));
    if (/[./\\]/.test(want)) return cmds.some((words) => ranFiles(words).some((w) => fileIs(w, want)));
    const script = (w) => !/\s/.test(w) && /\.[a-z0-9]+$/.test(w) && programName(w).replace(/\.[a-z0-9]+$/, '') === want;
    return cmds.some((words) => programName(words[programAt(words)] || '') === want || ranFiles(words).some(script));
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

/* How a pointer names its trigger: a file, a program or a command line the command runs. */
export function triggerWhy(frag) {
  const f = String(frag).trim();
  return (/\s/.test(f) || !settingOf(f) ? 'the command runs ' : 'the command runs with ') + f;
}

/* a command that sets AskerDo's seam runs against a sandbox store and data dir */
/* PowerShell allows spaces around =; in sh a space after = means the value is empty */
export const sandboxed = (command) => /(?:^|[\s;&|(])(?:\$env:(?:askerdo_root|askerdo_sandbox_home)\s*=\s*(?![\s;]|\$null\b|''|""|$)|(?:export\s+)?(?:askerdo_root|askerdo_sandbox_home)=(?![\s;]|''|""|$))/i.test(String(command || ''));

/* a test run says nothing about a procedure being followed: it sets the seam, or it runs
   in an agent's worktree (a cd or path in the command, or a folder the caller knows it runs in) */
const AGENT_TREE = /(?:^|[\s"'=/\\])\.claude[\\/]+worktrees[\\/]+agent-[^\\/\s"']+/i;
export const testRun = (command, dirs = []) => sandboxed(command) || AGENT_TREE.test(String(command || ''))
  || (dirs || []).some((d) => d && AGENT_TREE.test(String(d)));

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
  if (c.flag) return { badge: 'flagged', reasons: [(c.openTasks && c.openTasks.length ? 'a run deviated and its work waits in ' + c.openTasks.join(', ') + ': ' : 'the last run deviated: ') + c.flag] };
  if (Array.isArray(c.stale) && c.stale.length) return { badge: 'stale', reasons: c.stale.slice() };
  if (!c.verifiedAt) return { badge: 'never run', reasons: [] };
  return { badge: 'fresh', reasons: [] };
}

export const procPath = (card) => normPath(card.project) + '/' + String(card.doc || '');

/* A deviated run's three outcomes, one of which rides the call that records it. */
export const OUTCOME_FLAGS = '--fixed <commit> (you fixed the steps file in that commit), --one-off "why" (the steps stand) or --filed T-n (real work you filed through the ladder)';

/* the mod records a clean run itself only for a card that opts in (`record: command`,
   its one command is the whole run); a multi-step card's run is the session's to record. */
export const recordsRun = (card, tool) => COMMAND_TOOLS.includes(tool) && !!card && card.record === 'command';

/* The note the model reads when a call matches (a pointer, never a block). A run the mod
   records (`recorded`, see recordsRun) asks only for a deviation. A subagent's call
   (`agent`) is never asked to write the board: its caller records. A run the mod would record
   that is a test run (`test`, see testRun) is recorded by no one. */
export function procNote(card, why, { agent = false, recorded = false, test = false } = {}) {
  const b = badgeOf(card);
  const state = b.badge === 'stale' || b.badge === 'flagged'
    ? ' The card is ' + b.badge + ' (' + b.reasons.slice(0, 3).join('; ') + '), so check each step against the code as you go.'
    : '';
  const deviated = 'askerdo proc ran ' + card.slug + ' deviated --note "the step that differed and how" with one outcome: ' + OUTCOME_FLAGS + '.';
  const record = recorded && test
    ? ' This command is a test run (it sets the sandbox seam or runs in an agent\'s worktree), so AskerDo records no run of it; do not record one.'
    : agent
    ? (recorded ? ' AskerDo records the run clean when this command exits 0. Do not record a deviation yourself: say in your report which step you left and why, and the session that dispatched you records it.'
      : ' Do not record the run yourself: say in your report whether you followed it, and the session that dispatched you records it.')
    : recorded ? ' AskerDo records the run clean when this command exits 0. Only if the run left the written steps, record it: ' + deviated
      : ' When done, record the run: askerdo proc ran ' + card.slug + ' clean, or if it left the written steps, ' + deviated;
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
    + outcomeWords(r) + (r.suggestScript ? '\n' + r.suggestScript : '');
}

/* An outcome as a deviated run recorded it; none for the runs from before outcomes were said. */
const outcomeSaid = (o) => !o || o.kind === 'none' ? 'no outcome said' : o.kind === 'fixed' ? 'the steps fixed in ' + String(o.ref).slice(0, 7)
  : o.kind === 'one-off' ? 'a one-off, the steps stand: ' + o.ref : 'filed as ' + o.ref;

/* proc drafts: each step's deviated runs with their outcomes, then the old draft tasks still open. */
export function draftsText(r) {
  const drafts = r.drafts || [];
  if (!r.steps.length && !drafts.length) return r.id + ' ' + r.slug + ': no deviated run in its journal.';
  const lines = r.steps.map((s) => (s.step || 'no step named') + ': ' + s.runs + (s.runs === 1 ? ' deviated run, ' : ' deviated runs, ') + s.from + ' to ' + s.to
    + '; the last ' + outcomeSaid(s.last));
  return r.id + ' ' + r.slug + ':\n' + lines.join('\n')
    + (drafts.length ? '\nDraft tasks the board filed before a run said its outcome, still open: ' + drafts.map((d) => d.task + ' (' + (d.step || 'no step named') + ')').join(', ')
      + '. Settle each: complete it once the card is fixed, or drop it with why the steps stand.' : '');
}

/* A deviated run's outcome, and the open tasks holding the card's flag. */
export const outcomeWords = (r) => (r.outcome ? '\nOutcome' + (r.outcome.step ? ' at ' + r.outcome.step : '') + ': ' + outcomeSaid(r.outcome) + '.' : '')
  + (r.openTasks && r.openTasks.length ? '\nThe flag holds while ' + r.openTasks.join(', ') + ' waits.' : '');

export function scanText(r) {
  const parts = ['created', 'updated', 'retired', 'unchanged'].filter((k) => r[k] && r[k].length).map((k) => k + ' ' + r[k].join(', '));
  const ew = ['created', 'updated', 'retired'].filter((k) => r.everywhere && r.everywhere[k] && r.everywhere[k].length).map((k) => k + ' ' + r.everywhere[k].join(', '));
  return 'Procedures of ' + r.project + ': ' + (parts.length ? parts.join('; ') : 'none in docs/procedures') + '.'
    + (ew.length ? '\nThe AskerDo plugin\'s cards for every project: ' + ew.join('; ') + '.' : '')
    + (r.unparseable || []).map((u) => '\nUnparseable ' + u.file + ': ' + u.errors.slice(0, 2).join('; ')).join('')
    + (r.warnings || []).map((w) => '\nLint ' + w.file + ': ' + w.warnings.slice(0, 2).join('; ')).join('')
    + (r.here ? '\nRead from the main checkout, not ' + r.here + ': proc scan --check checks the files of this worktree.' : '');
}

/* proc scan --check: each file with its errors and warnings, then the counts. */
export function checkText(r) {
  const lines = [r.checked + ':' + (r.files.length ? '' : ' no procedure files in docs/procedures')];
  for (const f of r.files) {
    lines.push(f.name + (f.errors.length || f.warnings.length ? '' : ': clean'));
    for (const e of f.errors) lines.push('  error: ' + e);
    for (const w of f.warnings) lines.push('  warning: ' + w);
  }
  const c = r.counts;
  lines.push(c.files + (c.files === 1 ? ' file, ' : ' files, ') + c.clean + ' clean, ' + c.errors + ' with errors, ' + c.warnings + ' with warnings');
  return lines.join('\n');
}

/* `/askerdo proc ran <name> clean|deviated ["note"] [--fixed sha | --one-off "why" | --filed T-n]`,
   `proc scan [--check]`, or words to find. */
export function parseProc(args) {
  const s = String(args || '').trim();
  const usage = 'Usage: /askerdo proc <words> | proc ran <name> clean | proc ran <name> deviated "what differed" --fixed <commit> | --one-off "why" | --filed T-n | proc scan [--check]';
  if (!s) return { error: usage };
  const m = /^ran\s+(\S+)\s+(clean|deviated)\b\s*([\s\S]*)$/i.exec(s);
  if (m) {
    const said = {};
    const KEY = { fixed: 'fixed', 'one-off': 'oneOff', filed: 'filed' };
    const t = m[3].replace(/(^|\s)--(fixed|one-off|filed)\s+(?:"([^"]*)"|'([^']*)'|(\S+))/gi, (_x, _s, k, a, b, c) => {
      said[KEY[k.toLowerCase()]] = String(a ?? b ?? c).trim();
      return ' ';
    }).trim();
    const q = t.match(/^"([\s\S]*)"$/) || t.match(/^'([\s\S]*)'$/);
    const note = (q ? q[1] : t).trim();
    if (m[2].toLowerCase() === 'deviated' && !note) return { error: 'A deviated run needs a note and one outcome: /askerdo proc ran ' + m[1] + ' deviated "what differed" with ' + OUTCOME_FLAGS };
    return { sub: 'ran', name: m[1], result: m[2].toLowerCase(), note, ...said };
  }
  if (/^ran\b/i.test(s)) return { error: usage };
  if (/^scan$/i.test(s)) return { sub: 'scan' };
  if (/^scan\s+--check$/i.test(s)) return { sub: 'scan', check: true };
  return { sub: 'find', words: s };
}
