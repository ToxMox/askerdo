/* the instruction files Claude reads in a project and the rule files around them, as
   facts. The setting is Claude Code's Project instructions option (the built-in agents-md plugin); the rule files
   are every file under .claude/ and .agents/, every file an instruction file names or imports, and every hook script
   the settings run, each with its last touch, its cites and their resolve state, who cites it, the commits on what it
   cites since it was touched, and what loads it. Judges nothing. */
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';

const slashed = (p) => String(p).replace(/\\/g, '/');
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

export const CLAUDE_NAMES = ['CLAUDE.md', '.claude/CLAUDE.md', 'CLAUDE.local.md'];
export const AGENTS_NAMES = ['AGENTS.md', '.claude/AGENTS.md'];
export const MODES = ['claude-md', 'claude-md-or-agents-md', 'claude-md-and-agents-md', 'managed-only'];
export const DEFAULT_MODE = 'claude-md-or-agents-md';
const LEGACY = { none: 'managed-only', claude: 'claude-md', 'agents-fallback': 'claude-md-or-agents-md', both: 'claude-md-and-agents-md' };
/* the plugin's id in settings; the short name as an alias */
const PLUGIN_KEYS = ['cc-plugin-agents-md@builtin', 'agents-md@builtin'];

export const managedDir = (platform = process.platform) => (platform === 'win32' ? 'C:/Program Files/ClaudeCode' : platform === 'darwin' ? '/Library/Application Support/ClaudeCode' : '/etc/claude-code');

/* The setting as Claude Code 2.1.304 reads it: the options under pluginConfigs from the user's settings file
   (where /config saves it) with managed settings over it; project settings are never read. A projectInstructions
   option still counts while instructionFiles is left at its default. */
export function instructionSetting({ home, managed = managedDir() } = {}) {
  const files = [join(home, 'settings.json'), join(managed, 'managed-settings.json')];
  try { for (const n of readdirSync(join(managed, 'managed-settings.d')).filter((x) => x.endsWith('.json')).sort()) files.push(join(managed, 'managed-settings.d', n)); } catch { /* none */ }
  const opts = {};
  const from = {};
  let off = null;
  for (const f of files) {
    const s = readJson(f);
    if (!s || typeof s !== 'object') continue;
    for (const key of PLUGIN_KEYS) {
      if (s.enabledPlugins && s.enabledPlugins[key] === false) off = slashed(f);
      const o = s.pluginConfigs && s.pluginConfigs[key] && s.pluginConfigs[key].options;
      if (!o || typeof o !== 'object') continue;
      for (const k of ['instructionFiles', 'projectInstructions']) if (o[k] !== undefined) { opts[k] = o[k]; from[k] = slashed(f); }
    }
  }
  const chosen = MODES.includes(opts.instructionFiles) ? opts.instructionFiles : DEFAULT_MODE;
  const legacy = opts.projectInstructions === undefined ? undefined : typeof opts.projectInstructions === 'string' && LEGACY[opts.projectInstructions] || 'claude-md';
  const byLegacy = legacy !== undefined && chosen === DEFAULT_MODE;
  const mode = off ? 'claude-md' : byLegacy ? legacy : chosen;
  return { mode, from: off || (byLegacy ? from.projectInstructions : MODES.includes(opts.instructionFiles) ? from.instructionFiles : 'default'), ...(off ? { plugin: 'off' } : {}),
    ...(byLegacy ? { legacy: opts.projectInstructions } : {}) };
}

/* Every instruction file in the project's folders (a .claude folder belongs to the folder holding it; .agents is
   never read) and which Claude reads: at the start (the root's), when a session works in its folder (a nested one),
   or not, with why. An ancestor's CLAUDE.md makes a project Claude's as the root's does; the user's and the managed
   CLAUDE.md (memory) never count as an ancestor's, as Claude Code skips them on its walk. */
export function instructionFiles(root, dirs, have, setting, { ignored = new Set(), memory = [], above: given = null } = {}) {
  const found = [];
  const names = [...CLAUDE_NAMES, ...AGENTS_NAMES, 'AGENTS.override.md'];
  for (const d of dirs) {
    if (/(^|\/)\.(claude|agents)(\/|$)/.test(d)) continue;
    for (const n of names) {
      const f = d ? d + '/' + n : n;
      /* CLAUDE.local.md is usually git-ignored, so the listing misses it */
      if (have.has(f) || (n === 'CLAUDE.local.md' && existsSync(join(root, f)))) found.push({ dir: d, name: n, file: f });
    }
  }
  /* a copy of the project takes the real one's ancestors */
  const above = given ? [...given] : [];
  const same = (p) => slashed(p).toLowerCase();
  const mem = new Set(memory.map(same));
  if (!given) for (let d = dirname(root); d && dirname(d) !== d; d = dirname(d)) for (const n of CLAUDE_NAMES) if (!mem.has(same(join(d, n))) && existsSync(join(d, n))) above.push(slashed(join(d, n)));
  const claudeAt = (d) => found.some((x) => x.dir === d && CLAUDE_NAMES.includes(x.name));
  const claudeProject = claudeAt('') || above.length > 0;
  const mode = setting.mode;
  const files = found.map(({ dir, name, file }) => {
    const when = dir ? 'nested' : 'start';
    const priv = name === 'CLAUDE.local.md' || ignored.has(file);
    let read = when;
    let why = null;
    if (name === 'AGENTS.override.md') { read = false; why = 'Codex reads it, Claude never does'; }
    else if (mode === 'managed-only') { read = false; why = 'the setting drops the project\'s instruction files'; }
    else if (AGENTS_NAMES.includes(name)) {
      if (mode === 'claude-md') { read = false; why = 'the setting reads CLAUDE.md only'; }
      else if (mode === DEFAULT_MODE && (claudeProject || claudeAt(dir))) { read = false; why = 'a CLAUDE.md ' + (claudeAt(dir) ? 'beside it' : 'at the root' + (above.length && !claudeAt('') ? ' or above it' : '')) + ': the default setting reads AGENTS.md only in a project with none'; }
    }
    return { file, read, ...(why ? { why } : {}), ...(priv ? { private: true } : {}) };
  });
  return { setting, claudeProject, ...(above.length ? { above } : {}), files };
}

/* ---- cites, read the way a guide or a script names a path ---- */

/* a project path variable a hook or a skill puts before a path */
const VAR = /["']?\$\{?CLAUDE_(?:PROJECT_DIR|PLUGIN_ROOT)\}?["']?\//g;
const MARK = String.fromCharCode(1);
/* a path with a folder and a file, a folder with its slash, a glob in a folder, or a bare file name a project holds */
const CITE = /(?<![\w/.:@~$%-])((?:[\w.-]+\/)+(?:[\w*-]+(?:\.[\w*-]+)*\.[A-Za-z0-9*]{1,8}|\*[\w.*-]*)?|[\w-]+(?:\.[\w-]+)*\.(?:md|markdown|txt|json|ya?ml|toml|mjs|cjs|js|ts|py|ps1|sh|cs))(?![\w/-])/g;

/* the handover's repoint of a cite whose folder left: `<path> (in git at <sha>)` names history, never a live path;
   placeCite puts the note past a code span's backticks or a link's closing parenthesis */
export const IN_GIT = /^[`\])]* \(in git at [0-9a-f]+\)/;

/* Each path a text names, with its line and whether an instruction file imports it (`@path`). */
export function citesOfText(text) {
  const out = [];
  String(text || '').split('\n').forEach((raw, i) => {
    const l = raw.replace(VAR, ' ').replace(/(^|[\s(])@(?=[\w.])/g, '$1' + MARK);
    for (const m of l.matchAll(CITE)) {
      const p = m[1].replace(/^\.\//, '');
      if (!p || p === '/' || /^\.+\/?$/.test(p) || IN_GIT.test(l.slice(m.index + m[0].length))) continue;
      out.push({ raw: p, line: i + 1, ...(l[m.index - 1] === MARK ? { import: true } : {}) });
    }
  });
  return out;
}

/* the roots of the projects nested in the repo, shallowest first: a folder holding an instruction file, a
   package.json, a .csproj or .sln, or a Unity project's Assets and ProjectSettings */
export function projectRoots(files, folders) {
  const out = new Set();
  for (const f of files) {
    const i = f.lastIndexOf('/');
    if (/^(?:CLAUDE|AGENTS)\.md$|^package\.json$|\.(?:csproj|sln)$/i.test(f.slice(i + 1))) out.add(i < 0 ? '' : f.slice(0, i).replace(/(^|\/)\.claude$/, ''));
  }
  for (const d of folders) if (folders.has(d + '/Assets') && folders.has(d + '/ProjectSettings')) out.add(d);
  out.delete('');
  return [...out].sort((a, b) => a.split('/').length - b.split('/').length || (a < b ? -1 : 1));
}

/* A cite resolved from its file's folder, the nested project holding it, then the root: ok, gone (in history, not
   now), moved (a file of its name elsewhere) or none; a glob names its folder. Before gone, on disk there (a
   build output git ignores), then in the shallowest other nested project, marked `via`; `near` skips both. */
export function resolver({ have, folders, history, byName, roots = [], root = null }) {
  const isDir = (p) => folders.has(p.replace(/\/+$/, ''));
  const rootSet = new Set(roots);
  const holders = new Map();
  const holderOf = (dir) => {
    if (!holders.has(dir)) { let d = dir; while (d && d !== '.' && !rootSet.has(d)) d = d.includes('/') ? d.slice(0, d.lastIndexOf('/')) : ''; holders.set(dir, d && d !== '.' ? d : null); }
    return holders.get(dir);
  };
  const disk = new Map();
  /* a case-blind file system finds Docs/ for docs/: the real name must match */
  const onDisk = (t) => {
    if (!disk.has(t)) {
      let k = null;
      try { const abs = join(root, t); const s = statSync(abs); if (slashed(realpathSync.native(abs)).endsWith('/' + t.replace(/\/+$/, ''))) k = s.isDirectory() ? 'dir' : 'file'; } catch { /* not there */ }
      disk.set(t, k);
    }
    return disk.get(t);
  };
  return (raw, from, near = false) => {
    const glob = raw.includes('*');
    const folder = glob || raw.endsWith('/');
    const p = glob ? raw.slice(0, raw.lastIndexOf('/') + 1) : raw;
    if (!p) return null;
    const own = posix.dirname(from || '.');
    const holder = holderOf(own);
    const tries = [...new Set([posix.normalize(posix.join(own, p)), ...(holder ? [posix.normalize(posix.join(holder, p))] : []), posix.normalize(p)])].filter((x) => !x.startsWith('..'));
    const hit = (t) => (folder ? (isDir(t) ? 'dir' : null) : have.has(t) ? 'file' : isDir(t) ? 'dir' : null);
    const okAt = (t, kind, via) => ({ path: kind === 'dir' ? t.replace(/\/*$/, '/') : t, state: 'ok', folder: kind === 'dir', ...(via ? { via } : {}) });
    for (const t of tries) { const k = hit(t); if (k) return okAt(t, k); }
    if (!folder && !p.includes('/')) {
      const named = byName.get(p) || [];
      if (named.length === 1) return { path: named[0], state: 'ok', folder: false };
      if (named.length) return { path: p, state: 'ok', folder: false, ambiguous: true };
    }
    if (!near && root) for (const t of tries) { const k = onDisk(t); if (k && (k === 'dir' || !folder)) return okAt(t, k, 'disk'); }
    if (!near && p.includes('/')) {
      const found = [];
      for (const r of roots) {
        if (found.length && r.split('/').length > found[0].r.split('/').length) break;
        if (r === holder) continue;
        const t = posix.normalize(r + '/' + p);
        const k = hit(t);
        if (k) found.push({ r, t, k });
      }
      if (found.length === 1) return okAt(found[0].t, found[0].k, 'nested');
      if (found.length) return { path: p, state: 'ok', folder, ambiguous: true, via: 'nested' };
    }
    for (const t of tries) {
      const h = history.get(t.replace(/\/+$/, ''));
      if (h) return { path: folder ? t.replace(/\/*$/, '/') : t, state: 'gone', folder, since: h.last };
    }
    const base = posix.basename(p.replace(/\/+$/, ''));
    const elsewhere = folder ? [] : (byName.get(base) || []);
    if (elsewhere.length) return { path: tries[tries.length - 1], state: 'moved', folder, to: elsewhere.slice(0, 2) };
    return { path: tries[tries.length - 1] || p, state: 'none', folder };
  };
}

/* ---- the rule files ---- */

/* `paths:` in a rule file's frontmatter, as a list or inline */
export function pathsFront(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text || '');
  if (!m) return null;
  const ls = m[1].split(/\r?\n/);
  const i = ls.findIndex((l) => /^paths\s*:/.test(l));
  if (i < 0) return null;
  const unq = (s) => s.trim().replace(/^["']|["']$/g, '');
  const inline = ls[i].replace(/^paths\s*:\s*/, '').trim();
  if (inline) return inline.replace(/^\[|\]$/g, '').split(',').map(unq).filter(Boolean);
  const out = [];
  for (let j = i + 1; j < ls.length && /^\s+-\s*/.test(ls[j]); j++) out.push(unq(ls[j].replace(/^\s+-\s*/, '')));
  return out;
}

/* The scripts settings.json hooks run, per event. */
export function hooksOf(root, resolve) {
  const out = [];
  for (const s of ['.claude/settings.json', '.claude/settings.local.json']) {
    const j = readJson(join(root, s));
    for (const [event, groups] of Object.entries((j && j.hooks) || {})) {
      for (const g of Array.isArray(groups) ? groups : []) {
        for (const h of (g && Array.isArray(g.hooks) ? g.hooks : [])) {
          for (const c of citesOfText(h && h.command)) {
            const r = resolve(c.raw, '', true);
            if (r && r.state === 'ok' && !r.folder && !r.ambiguous) out.push({ script: r.path, event, settings: s });
          }
        }
      }
    }
  }
  return out;
}
/* the scripts in the repo that .mcp.json's servers run, by server name (a server serving rules is a loader) */
export function serversOf(root, resolve) {
  const out = [];
  const j = readJson(join(root, '.mcp.json'));
  for (const [server, s] of Object.entries((j && j.mcpServers) || {})) {
    const line = s && typeof s === 'object' ? [s.command, ...(Array.isArray(s.args) ? s.args : [])].filter((x) => typeof x === 'string').join(' ') : '';
    for (const c of citesOfText(line)) {
      const r = resolve(c.raw, '', true);
      if (r && r.state === 'ok' && !r.folder && !r.ambiguous) out.push({ script: r.path, server });
    }
  }
  return out;
}

const KIND_LOAD ={ rules: 'rules', skills: 'skill', commands: 'command', agents: 'agent', 'output-styles': 'output-style' };
/* .agents/ holds Codex's skills, read as .claude/'s are */
export const kindOf = (f) => (/^\.claude\/settings(\.local)?\.json$/.test(f) ? 'settings' : f.startsWith('.claude/') ? ((/^\.claude\/([^/]+)\//.exec(f) || [])[1] || 'other')
  : f.startsWith('.agents/') ? (f.startsWith('.agents/skills/') ? 'skills' : 'other') : 'named');
const LOADER = { hooks: 'hook', hook: 'hook', commands: 'command', skills: 'skill' };
/* a loader's line that reads a file or tells the session to (an @import counts too); README is a name, never a read */
const READS = /\b(?:read(?!me)\w*|load\w*|cat|get-content|source|include\w*|require|import|open\w*|fetch|follow\w*|apply|inject\w*|serv(?:e|es|ing)|glob\w*)\b/i;
/* a script that reads a path its line does not name (a list in a constant, a folder walked) reads what it names
   anywhere; a module import or a read of the hook's own input is no such read */
const CODE_READS = /\b(?:read(?!me)\w*|load\w*|cat|get-content|source|include\w*|open\w*|fetch|glob\w*|inject\w*)\b/i;
const NOT_A_READ = /^\s*(?:import\b|export\b[^=]*\bfrom\b|from\s+[\w.]+\s+import\b|(?:const|let|var)\s+[\w{},\s]+=\s*require\s*\()|\bstdin\b|readFileSync\(\s*0\b|\$\(\s*cat\s*\)|\$input\b|\[Console\]::In/i;
const readsElsewhere = (lines) => lines.some((l) => CODE_READS.test(l) && !NOT_A_READ.test(l) && !citesOfText(l).length);
const CITED_SHOWN = 5;
const SINCE_SHOWN = 2;

/* a handoff protocol's entry is a README (or a handoff file) with a resume section naming what each next
   session reads; its standing-rules file is a rules.md that section names or a handoff folder holds */
const RESUME_HEAD = /^\s*(?:#{1,6}\s+.*|\*\*[^*]*)\bresume\b/i;
const HEADING = /^\s*#{1,6}\s/;
const ENTRY_NAME = /(?:^|\/)(?:readme|handoff[\w.-]*)\.md$/i;
const RULES_NAME = /(?:^|\/)(?:standing[-_]?)?rules\.md$/i;
const HANDOFF_DIR = /(?:^|\/)hand-?offs?\//i;
const TEXT_FILE = /\.(md|markdown|txt)$/i;
export function handoffsOf(ctx, resolve, here) {
  const out = [];
  const seen = new Set();
  const put = (file, role, from) => { const k = file + '|' + (from || ''); if (!seen.has(k)) { seen.add(k); out.push({ file, role, ...(from ? { from } : {}) }); } };
  const machinery = (f) => /^\.(claude|agents)\//.test(f);
  const entries = [...new Set((ctx.grep ? ctx.grep(['resume', 'Resume', 'RESUME']) : []).filter((h) => ENTRY_NAME.test(h.file) && !machinery(h.file) && RESUME_HEAD.test(h.text)).map((h) => h.file))];
  for (const entry of entries.sort()) {
    const lines = String(ctx.open(entry) || '').split('\n');
    const named = [];
    lines.forEach((l, i) => {
      if (!RESUME_HEAD.test(l)) return;
      for (let j = i + 1; j < lines.length && !HEADING.test(lines[j]); j++) {
        for (const c of citesOfText(lines[j])) {
          const r = resolve(c.raw, entry);
          if (r && here(r) && !r.folder && r.path !== entry && TEXT_FILE.test(r.path)) named.push({ path: r.path, line: j + 1 });
        }
      }
    });
    if (!named.length) continue;
    put(entry, 'entry');
    for (const n of named) put(n.path, machinery(n.path) ? null : RULES_NAME.test(n.path) ? 'rules' : 'resume', entry + ':' + n.line);
  }
  for (const f of ctx.files) if (HANDOFF_DIR.test(f) && RULES_NAME.test(f) && !machinery(f) && !out.some((x) => x.file === f)) put(f, 'rules');
  return out;
}

/* ctx: { root, files, history (per path: commits, last, idx), lines (per commit), touch(f) -> { day, how }, open(f),
   grep(patterns) -> [{ file, line, text }], citers and since: false to skip who cites each and the commits since }; instr: instructionFiles' result, each file's entry given the folders it
   names (`folders`, folder:line), which load nothing. */
export function ruleFiles(ctx, instr) {
  const have = new Set(ctx.files);
  const folders = new Set();
  const byName = new Map();
  for (const f of ctx.files) {
    for (let d = f, j = d.lastIndexOf('/'); j > 0; j = d.lastIndexOf('/')) { d = d.slice(0, j); folders.add(d); }
    const b = posix.basename(f);
    if (!byName.has(b)) byName.set(b, []);
    byName.get(b).push(f);
  }
  const resolve = resolver({ have, folders, history: ctx.history, byName, roots: projectRoots(ctx.files, folders), root: ctx.root });
  /* a cite that names a file where its reader looks: one found on disk or in another nested project loads nothing */
  const here = (r) => r.state === 'ok' && !r.ambiguous && !r.via;
  const guides = new Set(instr.files.map((x) => x.file));
  const set = new Map();
  const add = (f, kind) => { if (!set.has(f)) set.set(f, { file: f, kind, loads: [], cited: new Map(), cites: [] }); return set.get(f); };
  for (const f of ctx.files) if ((f.startsWith('.claude/') && !/^\.claude\/(questions|worktrees)\//.test(f) || f.startsWith('.agents/')) && !guides.has(f)) add(f, kindOf(f));
  for (const h of hooksOf(ctx.root, resolve)) if (!guides.has(h.script)) add(h.script, set.has(h.script) ? set.get(h.script).kind : 'hook').loads.push({ by: 'hook', event: h.event, from: h.settings });
  for (const s of serversOf(ctx.root, resolve)) if (!guides.has(s.script)) add(s.script, set.has(s.script) ? set.get(s.script).kind : 'server').loads.push({ by: 'server', server: s.server, from: '.mcp.json' });
  /* what each instruction file names or imports is a rule file too; a folder it names is where things live */
  const guideCites = new Map();
  for (const g of instr.files) {
    const cs = citesOfText(ctx.open(g.file)).map((c) => ({ ...c, r: resolve(c.raw, g.file) })).filter((c) => c.r);
    guideCites.set(g.file, cs);
    for (const c of cs) if (here(c.r) && !c.r.folder && !guides.has(c.r.path) && (c.import || /\.(md|markdown|txt)$/i.test(c.r.path))) add(c.r.path, kindOf(c.r.path));
    const named = [...new Set(cs.filter((c) => here(c.r) && c.r.folder && !c.import).map((c) => c.r.path + ':' + c.line))];
    if (named.length) g.folders = named;
  }
  /* a handoff protocol's entry, the files its resume section names and its standing rules carry rules and work */
  for (const h of handoffsOf(ctx, resolve, here)) {
    if (guides.has(h.file) || (!set.has(h.file) && /^\.claude\/(questions|worktrees)\//.test(h.file))) continue;
    const e = add(h.file, 'handoff');
    if (h.role && !e.role) e.role = h.role;
    if (h.from && !e.loads.some((l) => l.by === 'handoff' && l.from === h.from)) e.loads.push({ by: 'handoff', from: h.from });
  }
  for (const e of set.values()) {
    const text = (() => { try { return statSync(join(ctx.root, e.file)).size > (256 << 10) ? '' : ctx.open(e.file); } catch { return ''; } })();
    const lines = String(text).split('\n');
    const seen = new Map();
    /* a menu's `paths:` frontmatter says when it loads, never what */
    const fm = e.kind === 'rules' ? /^---\r?\n[\s\S]*?\r?\n---/.exec(text || '') : null;
    const frontEnd = fm ? fm[0].split('\n').length : 0;
    const script = !/\.(md|markdown|txt)$/i.test(e.file) && Boolean(LOADER[e.kind] || e.loads.some((l) => (l.by === 'hook' && l.event) || (l.by === 'server' && l.server)));
    if (script && readsElsewhere(lines)) e.readsAll = true;
    for (const c of citesOfText(text)) {
      const r = resolve(c.raw, e.file);
      if (!r || r.path === e.file) continue;
      const reads = Boolean(c.import) || Boolean(e.readsAll) || READS.test(lines[c.line - 1] || '');
      const front = c.line <= frontEnd;
      const was = seen.get(r.path);
      if (!was) { seen.set(r.path, { ...r, line: c.line, reads, ...(front ? { front } : {}) }); e.cites.push(seen.get(r.path)); }
      else { if (reads) was.reads = true; if (was.front && !front) { was.line = c.line; delete was.front; } }
      /* every line past the frontmatter naming it, since a menu loads a body on each line's own globs */
      const at = seen.get(r.path);
      if (!front && !(at.lines || []).includes(c.line)) at.lines = [...(at.lines || []), c.line];
      /* a rules menu's bodies, and the text a script reads, are rule files wherever they sit (the map visits an entry added here) */
      if ((e.kind === 'rules' && !front || script && reads) && here(r) && !r.folder && !guides.has(r.path) && /\.(md|markdown|txt)$/i.test(r.path)) add(r.path, kindOf(r.path));
    }
    const load = KIND_LOAD[e.kind];
    if (e.kind === 'settings') e.loads.push({ by: 'harness' });
    else if (load === 'rules' && /\.md$/i.test(e.file)) { const p = pathsFront(text); e.loads.push({ by: 'rules', ...(p && p.length ? { paths: p } : {}) }); }
    else if (load && (load !== 'skill' || /\/SKILL\.md$/.test(e.file)) && /\.md$/i.test(e.file)) e.loads.push({ by: load, ...(e.file.startsWith('.agents/') ? { agent: 'codex' } : {}) });
  }
  /* an instruction file or a rules menu naming a file loads it, a folder it names never; a hook, command, skill or
     server loads only what it reads or tells the session to read (a folder's files too), never what it merely names */
  const under = (file, folder) => file.startsWith(folder);
  const loadFrom = (by, from, cites, more = {}) => {
    for (const c of cites) {
      if (!here(c)) continue;
      for (const t of set.values()) {
        if (t.file === from.split(':')[0] || !(c.folder ? under(t.file, c.path) : t.file === c.path)) continue;
        if (!t.loads.some((x) => x.by === by && x.from === from)) t.loads.push({ by, from, ...more });
      }
    }
  };
  for (const [g, cs] of guideCites) for (const c of cs) if (c.import || !c.r.folder) loadFrom(c.import ? 'import' : 'pointer', g + ':' + c.line, [c.r]);
  /* a script a hook or a server runs is a loader wherever it sits */
  const loaderOf = (x) => LOADER[x.kind] || (x.loads.some((l) => l.by === 'server' && l.server) ? 'server' : x.loads.some((l) => l.by === 'hook' && l.event) ? 'hook' : null);
  for (const e of [...set.values()].filter(loaderOf)) for (const c of e.cites.filter((x) => x.reads)) loadFrom(loaderOf(e), e.file + ':' + c.line, [c]);
  /* a rules file's names are its menu, loaded on its own `paths:` when it has them */
  for (const e of [...set.values()].filter((x) => x.kind === 'rules')) {
    const own = e.loads.find((l) => l.by === 'rules');
    if (own) for (const c of e.cites.filter((x) => !x.folder && !x.front)) for (const n of c.lines || [c.line]) loadFrom('menu', e.file + ':' + n, [c], own.paths ? { paths: own.paths } : {});
  }
  /* who cites each: one grep for their names, each hit line's cites resolved from its own file; with citers false
     (the survey's default) only the instruction files' cites count */
  const names = ctx.citers === false ? [] : [...new Set([...set.keys()].map((f) => posix.basename(f)))];
  for (const h of names.length ? ctx.grep(names) : []) {
    for (const c of citesOfText(h.text)) {
      const r = resolve(c.raw, h.file, true);
      const t = r && r.state === 'ok' && !r.folder && set.get(r.path);
      if (t && t.file !== h.file && !t.cited.has(h.file)) t.cited.set(h.file, h.line);
    }
  }
  for (const [g, cs] of guideCites) for (const c of cs) { const t = c.r.state === 'ok' && set.get(c.r.path); if (t && !t.cited.has(g)) t.cited.set(g, c.line); }
  return [...set.values()].sort((a, b) => (a.file < b.file ? -1 : 1)).map((e) => entryOf(ctx, e));
}

/* the commits on what a file cites since its own last touch: the history's per-path commit indexes, newest first */
function sinceOf(ctx, e) {
  const own = ctx.history.get(e.file);
  const touch = ctx.touch(e.file);
  const newer = own && own.idx && touch.how === 'commit' ? (i) => i < own.idx[0] : (i) => (ctx.days[i] || '') > (touch.day || '');
  const hits = new Set();
  for (const c of e.cites) {
    if (c.state !== 'ok' && c.state !== 'gone') continue;
    for (const i of (ctx.history.get(c.path.replace(/\/+$/, '')) || {}).idx || []) if (newer(i)) hits.add(i);
  }
  const all = [...hits].sort((a, b) => a - b);
  return all.length ? { commits: all.length, newest: all.slice(0, SINCE_SHOWN).map((i) => ctx.lines[i]) } : null;
}

/* a routine's own scripts: what a skill or command cites that is a file and no text */
const ROUTINE = new Set(['skills', 'commands']);
function entryOf(ctx, e) {
  const by = (s) => e.cites.filter((c) => c.state === s);
  const scripts = ROUTINE.has(e.kind) ? [...new Set(by('ok').filter((c) => !c.folder && !TEXT_FILE.test(c.path)).map((c) => c.path))] : [];
  const ok = by('ok');
  const gone = by('gone').map((c) => ({ path: c.path, line: c.line, since: c.since }));
  const moved = by('moved').map((c) => ({ path: c.path, line: c.line, to: c.to }));
  const none = by('none').map((c) => c.path);
  const cited = [...e.cited].map(([f, l]) => f + ':' + l);
  const since = ctx.since === false ? null : sinceOf(ctx, e);
  return {
    file: e.file, kind: e.kind, ...(e.role ? { role: e.role } : {}), last: ctx.touch(e.file).day, loads: e.loads,
    cites: { ok: ok.length, ...(gone.length ? { gone } : {}), ...(moved.length ? { moved } : {}), ...(none.length ? { none: none.slice(0, 5), ...(none.length > 5 ? { noneMore: none.length - 5 } : {}) } : {}) },
    ...(cited.length ? { citedBy: cited.slice(0, CITED_SHOWN), ...(cited.length > CITED_SHOWN ? { citedByMore: cited.length - CITED_SHOWN } : {}) } : {}),
    ...(since ? { since } : {}), ...(scripts.length ? { scripts } : {}),
  };
}
