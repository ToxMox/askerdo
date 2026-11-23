#!/usr/bin/env node
/* the onboarding survey gathers facts and judges nothing.
   It reads one project and never writes it: git history and status in one pass each, the folders with their file
   counts and last touch, the instruction files and their ledgers, the rule files and what loads them, the routines in
   use, Claude's memory files and the board. --depth adds each folder's cites and readers, the entry points'
   texts, the rule files' citers and the map's judgments. It writes facts.json; the session writes proposal.json.
   node survey.mjs <project dir> [--work <dir>] [--cli <path>] [--no-board] [--manifest <file>] [--depth] */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataDir } from '../../lib/node-helpers.mjs';
import { sharedName } from '../../lib/project-id.mjs';
import { blobsOf, boardRecords, clauseId, earlierImport, folderSig, isFolder, markMap, parseTree, seedsOf } from './map.mjs';
import { instructionFiles, instructionSetting, managedDir, ruleFiles } from './instructions.mjs';
import { rootRe } from './cites.mjs';

export const DEFAULT_CLI = join(homedir(), '.claude', 'askerdo', 'cli.mjs');
const slashed = (p) => String(p).replace(/\\/g, '/');

/* ---- small readers ---- */

function git(ctx, args, ok = [0]) {
  ctx.spawns++;
  const r = spawnSync('git', args, { cwd: ctx.root, encoding: 'utf8', windowsHide: true, maxBuffer: 1 << 30 });
  return ok.includes(r.status) ? r.stdout : null;
}
const readText = (p) => { try { return readFileSync(p, 'utf8').replace(/\r\n/g, '\n'); } catch { return null; } };
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
/* a project file read whole, counted */
function open(ctx, f) {
  if (ctx.texts.has(f)) return ctx.texts.get(f);
  const t = readText(join(ctx.root, f));
  ctx.texts.set(f, t);
  if (t !== null) ctx.opened.push(f);
  return t;
}
const dayOf = (d) => { const x = new Date(d); return Number.isFinite(x.getTime()) ? x.toISOString().slice(0, 10) : null; };
const mtimeDay = (p) => { try { return dayOf(statSync(p).mtime); } catch { return null; } };
const oneLine = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const clip = (s, n) => { const t = oneLine(s); return t.length > n ? t.slice(0, n - 3) + '...' : t; };
const kebab = (s, n = 40) => oneLine(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, n).replace(/-+$/, '') || 'item';

export function frontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text || '');
  if (!m) return { front: {}, body: text || '' };
  const front = {};
  const unq = (v) => v.replace(/^["']|["']$/g, '').trim();
  /* one level of nesting: Claude Code's memory files keep their type under metadata: */
  let parent = null;
  for (const l of m[1].split('\n')) {
    const k = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(l);
    if (k) { front[k[1]] = unq(k[2]); parent = k[2].trim() ? null : k[1]; continue; }
    const c = parent && /^[ \t]+([A-Za-z][\w-]*):\s*(.*)$/.exec(l);
    if (c) { if (typeof front[parent] !== 'object') front[parent] = {}; front[parent][c[1]] = unq(c[2]); }
  }
  return { front, body: text.slice(m[0].length) };
}

/* ---- the project's files: one listing, one status pass ---- */

const SKIP_DIR = /(^|\/)(\.git|node_modules|\.claude\/worktrees|Library|Temp|obj|bin|dist|build|out|target|\.venv|venv|__pycache__|vendor)(\/|$)/;
const TEXT_EXT = /\.(md|markdown|txt)$/i;
const PROSE_EXT = /\.(md|markdown|txt|rst|adoc|org)$/i;
const CODE_EXT = /\.(m?[jt]sx?|cjs|cs|py|rs|go|java|c|cpp|h|hpp|ps1|psm1|sh|bash|rb|kt|swift|lua|cmd|bat)$/i;
/* a data or config file naming a folder reads it as code does (a path value a tool loads) */
const DATA_EXT = /\.(json|ya?ml|toml|ini|cfg)$/i;
const reads = (f) => CODE_EXT.test(f) || DATA_EXT.test(f);
/* JSON the grep leaves out, read under the cap the outside readers use */
const DATA_MAX = 512 << 10;
/* the files a cite or a code reader can sit in: prose, code, config and Claude's settings; JSON elsewhere is data
   (on Tidewatch a 6 MB inventory took 70 of the grep's 78 s) */
const CITE_SPECS = [...['md', 'markdown', 'txt', 'rst', 'adoc', 'org', 'yml', 'yaml', 'toml', 'ini', 'cfg', 'mjs', 'js', 'cjs', 'jsx', 'ts', 'tsx', 'mts',
  'cs', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'h', 'hpp', 'ps1', 'psm1', 'sh', 'bash', 'rb', 'kt', 'swift', 'lua', 'cmd', 'bat'].map((e) => '*.' + e), '.claude/*.json', 'package.json'];

/* Tracked files from ls-files, untracked and modified ones from one status, and the root handoff files git ignores
   (Tidewatch's handoff-*.md). Outside git every file counts as untracked: there is no copy to delete from. */
function listing(ctx) {
  const out = { files: [], untracked: new Set(), dirty: new Set(), ignored: new Set(), mtime: new Map(), mtimeMs: new Map() };
  if (!ctx.isGit) {
    const walk = (rel) => {
      let ents = [];
      try { ents = readdirSync(join(ctx.root, rel), { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        const p = rel ? rel + '/' + e.name : e.name;
        if (SKIP_DIR.test(p)) continue;
        if (e.isDirectory()) walk(p); else { out.files.push(p); out.untracked.add(p); }
      }
    };
    walk('');
  } else {
    const tracked = (git(ctx, ['ls-files', '-z']) || '').split('\0').filter(Boolean).map(slashed);
    const gone = new Set();
    const st = (git(ctx, ['--no-optional-locks', 'status', '--porcelain=v1', '-z', '-uall']) || '').split('\0');
    for (let k = 0; k < st.length; k++) {
      const e = st[k];
      if (e.length < 4) continue;
      const xy = e.slice(0, 2);
      const p = slashed(e.slice(3));
      if (/[RC]/.test(xy)) k++;
      if (xy === '??') out.untracked.add(p);
      else if (xy.includes('D')) gone.add(p);
      else out.dirty.add(p);
    }
    for (const f of (git(ctx, ['ls-files', '-o', '-i', '--exclude-standard', '-z', '--', 'handoff*']) || '').split('\0')) if (f && !f.includes('/') && TEXT_EXT.test(f)) out.ignored.add(f);
    out.files = [...tracked.filter((f) => !gone.has(f)), ...out.untracked, ...out.ignored];
  }
  for (const f of [...out.untracked, ...out.dirty, ...out.ignored]) {
    try { const st = statSync(join(ctx.root, f)); out.mtime.set(f, dayOf(st.mtime)); out.mtimeMs.set(f, st.mtimeMs); } catch { /* gone since the status */ }
  }
  return out;
}
const noCopy = (ctx, f) => ctx.list.untracked.has(f) || ctx.list.ignored.has(f);

/* ---- the history pass: one git log, paths and subjects only ---- */

const SUBJECTS_NEW = 10;
const SUBJECTS_OLD = 2;
const SUBJECT_MAX = 120;

/* Per file and per folder (every ancestor, '' the root): commits, first and last touch; per folder a sample of its
   commit subjects, the newest ten and the oldest two. A rename shows as a delete and an add, so the folder it left
   counts it too. */
function historyPass(ctx) {
  const per = new Map();
  /* each commit's day and subject line, and per path the commits on it (idx), for the rule files' since */
  const h = { commits: 0, first: null, latest: null, head: null, per, days: [], lines: [] };
  if (!ctx.isGit) return h;
  const out = git(ctx, ['-c', 'core.quotepath=false', 'log', '--name-only', '--no-renames', '--format=%x1e%H%x09%aI%x09%s']) || '';
  const bump = (key, i, day, line) => {
    let s = per.get(key);
    if (!s) per.set(key, (s = { commits: 0, first: day, last: day, seen: -1, idx: [], ...(line ? { newest: [], oldest: [] } : {}) }));
    if (s.seen === i) return false;
    s.seen = i;
    s.idx.push(i);
    s.commits++;
    if (day < s.first) s.first = day;
    if (day > s.last) s.last = day;
    /* the log runs newest first: the first ten seen are the newest, the last two the oldest */
    if (line) { if (s.newest.length < SUBJECTS_NEW) s.newest.push(line); else { s.oldest.push(line); if (s.oldest.length > SUBJECTS_OLD) s.oldest.shift(); } }
    return true;
  };
  for (const rec of out.split('\x1e')) {
    if (!rec) continue;
    const lines = rec.split('\n');
    const [hash = '', at = '', ...subject] = lines[0].split('\t');
    const day = at.slice(0, 10);
    const line = day + ' ' + clip(subject.join('\t'), SUBJECT_MAX);
    const i = h.commits++;
    h.days.push(day);
    h.lines.push(line);
    if (!h.head) h.head = hash;
    if (!h.latest || day > h.latest) h.latest = day;
    if (!h.first || day < h.first) h.first = day;
    bump('', i, day, line);
    for (let k = 1; k < lines.length; k++) {
      const p = slashed(lines[k].trim());
      if (!p) continue;
      bump(p, i, day, null);
      for (let d = p, j = d.lastIndexOf('/'); j > 0; j = d.lastIndexOf('/')) { d = d.slice(0, j); if (!bump(d, i, day, line)) break; }
    }
  }
  for (const s of per.values()) delete s.seen;
  return h;
}
const subjectsOf = (s, k = SUBJECTS_NEW + SUBJECTS_OLD) => {
  const all = s ? [...(s.newest || []), ...(s.oldest || [])] : [];
  if (all.length <= k) return all;
  const old = k >= 4 ? SUBJECTS_OLD : 1;
  return [...all.slice(0, k - old), ...all.slice(-old)];
};

/* A file's last touch: its newest commit, or its mtime when it is untracked or changed since (a fresh clone stamps
   every file with the day it was made, so the mtime of a clean file says nothing). */
function touchOf(ctx, f) {
  const m = ctx.list.mtime.get(f);
  const c = ctx.history.per.get(f);
  if (m && (!c || m > c.last)) return { day: m, how: 'mtime' };
  return c ? { day: c.last, how: 'commit' } : { day: m || null, how: 'mtime' };
}

/* ---- the folders ---- */

const dirOf = (f) => (f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '');
/* the doctor's recent-activity window back from the latest commit */
export const DORMANT_DAYS = 60;
/* folders listed to this depth, and one level deeper under a folder at it holding more than BIG_FOLDER files */
const FOLDER_DEPTH = 3;
const BIG_FOLDER = 200;

function folderTree(ctx) {
  const nodes = new Map();
  const nodeOf = (d) => {
    let n = nodes.get(d);
    if (!n) { n = { path: d, files: [], dirs: [] }; nodes.set(d, n); if (d) nodeOf(dirOf(d)).dirs.push(n); }
    return n;
  };
  nodeOf('');
  for (const f of ctx.list.files) nodeOf(dirOf(f)).files.push(f);
  const sum = (n) => {
    const s = { count: 0, untracked: 0, modified: 0, prose: 0, code: 0, touched: null, touchedMs: 0 };
    for (const f of n.files) {
      s.count++;
      if (PROSE_EXT.test(f)) s.prose++;
      if (CODE_EXT.test(f)) s.code++;
      if (noCopy(ctx, f)) s.untracked++;
      else if (ctx.list.dirty.has(f)) s.modified++;
      const m = ctx.list.mtime.get(f);
      if (m && (!s.touched || m > s.touched)) s.touched = m;
      s.touchedMs = Math.max(s.touchedMs, ctx.list.mtimeMs.get(f) || 0);
    }
    for (const c of n.dirs) {
      sum(c);
      for (const k of ['count', 'untracked', 'modified', 'prose', 'code']) s[k] += c[k];
      if (c.touched && (!s.touched || c.touched > s.touched)) s.touched = c.touched;
      s.touchedMs = Math.max(s.touchedMs, c.touchedMs);
    }
    const hi = ctx.history.per.get(n.path) || { commits: 0, first: null, last: null };
    Object.assign(n, s, { commits: hi.commits, first: hi.first, lastCommit: hi.last, last: [s.touched, hi.last].filter(Boolean).sort().pop() || null, history: hi });
  };
  sum(nodes.get(''));
  return nodes;
}

function listedFolders(nodes) {
  const out = [];
  const walk = (n, depth) => {
    for (const c of [...n.dirs].sort((a, b) => (a.path < b.path ? -1 : 1))) {
      out.push(c);
      if (depth + 1 < FOLDER_DEPTH || (depth + 1 === FOLDER_DEPTH && c.count > BIG_FOLDER)) walk(c, depth + 1);
    }
  };
  walk(nodes.get(''), 0);
  for (const n of out) Object.assign(n, { hits: 0, citing: new Set(), codeReaders: new Set(), direct: new Map(), outsideReaders: [] });
  return out;
}

/* One git grep over the prose, code and config for the listed folders' first segments, each folder's path then
   matched per hit line: a hit from a file outside the folder is a cite into it, and from code or data a reader too.
   Every folder a line names counts it; only the deepest keeps the citing file, so parents do not repeat it. */
function citesOf(ctx, folders, workDir) {
  if (!ctx.isGit || !folders.length) return;
  /* a one-segment folder needs its slash, or "notes" matches every line saying notes */
  const pat = (n) => (n.path.includes('/') ? n.path : n.path + '/');
  const bySeg = new Map();
  for (const n of folders) {
    const seg = n.path.split('/')[0] + '/';
    if (!bySeg.has(seg)) bySeg.set(seg, []);
    bySeg.get(seg).push({ n, p: pat(n), inside: n.path + '/' });
  }
  /* git grep tries every pattern on every line: grep the few first segments, never every folder (on Tidewatch
     400 folder patterns ran past ten minutes) */
  const file = join(workDir, 'cite-patterns.txt');
  mkdirSync(workDir, { recursive: true });
  /* '../' too, since a relative value names its folder only once resolved from its own file's folder */
  writeFileSync(file, [...bySeg.keys(), '../'].join('\n') + '\n');
  const out = git(ctx, ['-c', 'core.quotepath=false', 'grep', '--untracked', '-I', '-n', '-z', '-F', '-f', file, '--', ...CITE_SPECS], [0, 1]) || '';
  rmSync(file, { force: true });
  const listed = new Set(folders.map((n) => n.path));
  /* each ./ or ../ value rewritten as the root path it reaches; one past the root names nothing here */
  const resolveRel = (f, text) => text.replace(/(?<![\w./-])(?:\.\.?\/)+[\w./-]*/g, (rel) => {
    const p = posix.normalize(posix.join(dirOf(f), rel)).replace(/\/$/, '');
    if (p === '.' || p.startsWith('../')) return '';
    return p + (listed.has(p) || rel.endsWith('/') ? '/' : '');
  });
  /* a path written from the project root ("C:/repo/docs/x") is that root path */
  const rootAt = rootRe(ctx.root) && new RegExp(rootRe(ctx.root), 'g');
  const fromRoot = (s) => (rootAt ? s.replace(rootAt, '') : s);
  const scan = (f, line, at) => {
    const raw = fromRoot(at);
    const text = raw.includes('./') ? resolveRel(f, raw) : raw;
    const hit = [];
    for (const [seg, pats] of bySeg) {
      if (!text.includes(seg)) continue;
      for (const { n, p, inside } of pats) {
        if (f.startsWith(inside)) continue;
        const i = text.indexOf(p);
        if (i < 0) continue;
        const before = text[i - 1] || '';
        const after = text[i + p.length] || '';
        /* a slash after a name means a deeper folder of the same name (its value resolved above); a leading slash is the root */
        const deeper = before === '/' && /[\w.-]/.test(text[i - 2] || '');
        if (/[\w.-]/.test(before) || deeper || (!p.endsWith('/') && (/[\w-]/.test(after) || (after === '.' && /\w/.test(text[i + p.length + 1] || ''))))) continue;
        hit.push({ n, inside });
        n.hits++;
        n.citing.add(f);
        if (reads(f)) n.codeReaders.add(f);
      }
    }
    for (const { n, inside } of hit) {
      if (!hit.some((x) => x.inside !== inside && x.inside.startsWith(inside)) && !n.direct.has(f)) n.direct.set(f, Number(line));
    }
  };
  /* a JSON string holds a folder only when, past a leading slash or resolved from its file's folder, it starts with a
     folder's path, never a mention in prose; the strings go on as written, so scan resolves a relative one */
  const segs = [...bySeg.keys()];
  const jsonValues = (f, t) => (t.match(/"(?:[^"\\]|\\.)*"/g) || []).map((v) => v.slice(1, -1)).filter((v) => {
    const at = /^\.\.?\//.test(v) ? resolveRel(f, v) : fromRoot(v).replace(/^\//, '');
    return segs.some((g) => at.startsWith(g));
  });
  const scanJson = (f, i, t) => { const v = jsonValues(f, t); if (v.length) scan(f, i, v.join(' ')); };
  const grepped = new Set();
  for (const l of out.split('\n')) {
    const [f, line, text] = l.split('\0');
    if (!text) continue;
    grepped.add(f);
    /* the grepped JSON (.claude/*.json, package.json) holds commands, where a path inside a string is a real read */
    scan(f, line, text);
  }
  for (const f of ctx.list.files) {
    if (!/\.json$/i.test(f) || grepped.has(f) || SKIP_DIR.test(f)) continue;
    let text;
    try { if (statSync(join(ctx.root, f)).size > DATA_MAX) continue; text = readFileSync(join(ctx.root, f), 'utf8'); } catch { continue; }
    if (segs.concat('../').some((g) => text.includes(g))) text.split('\n').forEach((t, i) => scanJson(f, i + 1, t));
  }
}

/* the lines of prose, code and config holding any of the names, for the rule files' citers */
function grepLines(ctx, patterns, workDir) {
  if (!ctx.isGit || !patterns.length) return [];
  const file = join(workDir, 'rule-patterns.txt');
  mkdirSync(workDir, { recursive: true });
  writeFileSync(file, patterns.join('\n') + '\n');
  const out = git(ctx, ['-c', 'core.quotepath=false', 'grep', '--untracked', '-I', '-n', '-z', '-F', '-f', file, '--', ...CITE_SPECS], [0, 1]) || '';
  rmSync(file, { force: true });
  return out.split('\n').map((l) => l.split('\0')).filter((x) => x.length >= 3).map(([f, line, text]) => ({ file: slashed(f), line: Number(line), text }));
}

/* ---- the entry points and the files they name ---- */

const PATH_IN = /`([^`\s]+)`|\]\(([^)\s]+)\)|((?:[\w.-]+\/)*[\w.-]+\.(?:md|markdown|txt))\b/gi;
const GUIDE_FILE = /(^|\/)(CLAUDE|AGENTS)(\.local)?\.md$/;
const ENTRY_MAX = 20000;

/* Files a text names by path, resolved from its own folder or the root, that exist and are text. */
function pathsIn(text, from, have) {
  const out = new Set();
  for (const m of String(text || '').matchAll(PATH_IN)) {
    const p = (m[1] || m[2] || m[3]).replace(/[#?].*$/, '').replace(/^\.\//, '');
    const hit = [posix.normalize(posix.join(posix.dirname(from), p)), posix.normalize(p)].find((x) => have.has(x));
    if (hit && TEXT_EXT.test(hit)) out.add(hit);
  }
  return out;
}

/* The guides Claude Code loads (CLAUDE.md and AGENTS.md anywhere, .claude/rules), the root README, and the files
   each names. */
function entryPoints(ctx) {
  const have = new Set(ctx.list.files);
  const entries = new Map();
  for (const f of ['CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md', 'README.md']) if (have.has(f)) entries.set(f, 'root');
  for (const f of ctx.list.files) {
    if (entries.has(f) || SKIP_DIR.test(f)) continue;
    if (/^\.claude\/rules\/.+\.md$/.test(f)) entries.set(f, '.claude/rules');
    else if (GUIDE_FILE.test(f)) entries.set(f, 'nested');
  }
  const named = new Map();
  for (const e of entries.keys()) named.set(e, [...pathsIn(open(ctx, e), e, have)].filter((f) => f !== e));
  return { entries, named };
}

/* ---- outside readers, Claude's memory, the CLAUDE.md clauses ---- */

/* a folder's git common dir read from its .git entry, never by running git there: on Windows git takes
   about 19 s and starts WSL in a repo another account owns (seen beside Tidewatch). Lowercase, forward slashes. */
export function commonDirOf(d) {
  const dotGit = join(d, '.git');
  let st;
  try { st = statSync(dotGit); } catch { return null; }
  let gitDir = dotGit;
  if (st.isFile()) {
    const m = /^gitdir:\s*(.+?)\s*$/m.exec(readText(dotGit) || '');
    if (!m) return null;
    gitDir = resolve(d, m[1]);
    const c = (readText(join(gitDir, 'commondir')) || '').trim();
    if (c) gitDir = resolve(gitDir, c);
  }
  return slashed(gitDir).replace(/\/+$/, '').toLowerCase();
}

/* Files outside the repo that name a folder (this PC's Claude settings and hooks, the guides of the projects beside
   it). A worktree of the project itself is the project. */
export function readersOf(ctx, folders, projects = []) {
  if (!folders.length) return;
  const low = (s) => slashed(s).toLowerCase();
  const home = ctx.claudeHome;
  const files = [join(home, 'settings.json'), join(home, 'settings.local.json'), join(home, 'CLAUDE.md')];
  const walk = (d, depth) => {
    let ents = [];
    try { ents = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (files.length > 400) return;
      if (e.isDirectory() && depth < 3 && e.name !== 'node_modules') walk(join(d, e.name), depth + 1);
      else if (e.isFile()) files.push(join(d, e.name));
    }
  };
  walk(join(home, 'hooks'), 0);
  const me = low(ctx.root);
  const up = dirname(ctx.root);
  let sibs = [];
  try { sibs = readdirSync(up, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => join(up, e.name)); } catch { /* none */ }
  const mine = ctx.isGit ? commonDirOf(ctx.root) : null;
  const worktrees = [];
  for (const d of new Set([...projects.map((p) => p.dir).filter(Boolean), ...sibs].map(slashed))) {
    if (low(d) === me) continue;
    if (mine && commonDirOf(d) === mine) { worktrees.push(d); continue; }
    files.push(join(d, 'CLAUDE.md'), join(d, 'AGENTS.md'));
  }
  ctx.readers = { scanned: files.length, worktrees };
  const name = low(basename(ctx.root));
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const needles = folders.map((n) => { const p = low(n.path); return { n, abs: me + '/' + p, rel: new RegExp('(?<![\\w.-])' + esc(name + '/' + p) + '(?![\\w.-])') }; });
  for (const file of files) {
    let text;
    try { if (statSync(file).size > 512 << 10) continue; text = readFileSync(file, 'utf8'); } catch { continue; }
    /* both slash forms, and a JSON string's doubled backslash */
    const lines = text.replace(/\\+/g, '/').toLowerCase().split('\n');
    if (!lines.some((l) => l.includes(name))) continue;
    for (const n of needles) {
      const i = lines.findIndex((l) => l.includes(n.abs) || n.rel.test(l));
      if (i >= 0) n.n.outsideReaders.push(slashed(file) + ':' + (i + 1));
    }
  }
}

/* ~/.claude/projects/<slug>/memory for the project and its subfolders, never a worktree's: path and frontmatter. */
function memoryFiles(ctx) {
  const base = join(ctx.claudeHome, 'projects');
  const slug = slashed(ctx.root).replace(/[^A-Za-z0-9]/g, '-');
  let dirs = [];
  try { dirs = readdirSync(base).filter((d) => (d === slug || d.startsWith(slug + '-')) && !/-claude-worktrees-/.test(d)); } catch { return []; }
  const out = [];
  for (const d of dirs) {
    const mem = join(base, d, 'memory');
    let names = [];
    try { names = readdirSync(mem).filter((n) => n.endsWith('.md')); } catch { continue; }
    for (const n of names) {
      const p = join(mem, n);
      /* read whole, so counted as opened like the project's own files */
      const text = readText(p);
      if (text !== null) ctx.opened.push(slashed(p));
      out.push({ path: slashed(p), front: frontmatter(text).front, last: mtimeDay(p) });
    }
  }
  return out;
}

/* The bullet or paragraph starting at line index i: where it ends (exclusive) and its clauses, a bullet whole and a
   paragraph by sentence; the ledger cuts by it and the rewrite puts a clause back by it. A table is one clause, so a
   menu of rule folders gets a fate like any other block (a skipped table outlived its rules). */
export function blockAt(lines, i) {
  const bullet = /^(\s*)(?:[-*+]|\d+[.)])\s+\S/.exec(lines[i]);
  let j = i + 1;
  if (/^\s*\|/.test(lines[i])) {
    while (j < lines.length && /^\s*\|/.test(lines[j])) j++;
    return { end: j, clauses: [oneLine(lines.slice(i, j).join(' '))] };
  }
  if (bullet) {
    while (j < lines.length && /^\s+\S/.test(lines[j]) && !/^\s*(?:[-*+]|\d+[.)])\s/.test(lines[j]) && lines[j].search(/\S/) > bullet[1].length) j++;
    return { end: j, clauses: [oneLine(lines.slice(i, j).join(' ')).replace(/^(?:[-*+]|\d+[.)])\s+/, '')] };
  }
  while (j < lines.length && lines[j].trim() && !/^(#{1,6}\s|\s*(?:[-*+]|\d+[.)])\s|\s*```|\s*~~~|\s*\|)/.test(lines[j])) j++;
  return { end: j, clauses: oneLine(lines.slice(i, j).join(' ')).split(/(?<=[.!?])\s+(?=[A-Z`*(\[])/) };
}

/* Every clause of an instruction file (each bullet, each sentence of a paragraph) with its line, past AskerDo's own
   section; every instruction file gets its own, the root CLAUDE.md by default. */
export function claudeLedger(ctx, file = 'CLAUDE.md') {
  const text = open(ctx, file);
  if (text === null) return [];
  const lines = text.split('\n');
  const out = [];
  let fence = false;
  let ours = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^#{1,2}\s/.test(l)) ours = /^##\s+AskerDo\s*$/.test(l);
    if (ours) continue;
    if (/^\s*(```|~~~)/.test(l)) { fence = !fence; continue; }
    if (fence || !l.trim() || /^#{1,6}\s/.test(l) || /^\s*<!--/.test(l)) continue;
    const b = blockAt(lines, i);
    for (const s of b.clauses) out.push({ file, line: i + 1, clause: s });
    i = b.end - 1;
  }
  return out;
}

/* ---- the board read ---- */

/* A read with no session in its env, so a bulk show marks nothing read; okExit names a non-zero exit that still
   carries the report (proc scan --check exits 1 on a card's errors). */
export function cliJson(cli, args, env, { okExit = [] } = {}) {
  const { CLAUDE_CODE_SESSION_ID, ...bare } = env || process.env;
  const r = spawnSync(process.execPath, [cli, ...args, '--json'], { encoding: 'utf8', windowsHide: true, env: bare, maxBuffer: 64 << 20 });
  if (r.status !== 0 && !(okExit.includes(r.status) && String(r.stdout || '').trim())) return { error: oneLine(r.stderr || r.stdout || 'exit ' + r.status) };
  try { return { value: JSON.parse(r.stdout) }; } catch { return { error: 'not JSON: ' + clip(r.stdout, 120) }; }
}

export function boardState(cli, { shared, slug, dir, env = process.env, projects = true }) {
  const out = { read: new Date().toISOString(), errors: [] };
  const get = (args) => { const r = cliJson(cli, args, env); if (r.error) out.errors.push(args.join(' ') + ': ' + r.error); return r.value; };
  const mine = (x) => (x.projectRepos || []).includes(shared);
  const label = 'import:' + slug;
  out.workstreams = (get(['list', '--kind', 'workstream', '--all']) || []).filter(mine)
    .map((w) => ({ id: w.id, name: w.name, status: w.status, labels: w.labels || [] }));
  const imported = [];
  for (const kind of ['workstream', 'task', 'knowledge']) {
    for (const r of get(['list', '--kind', kind, '--all', '--label', label]) || []) imported.push({ id: r.id, kind, name: r.name, status: r.status || null, refs: r.refs || [] });
  }
  /* the onboard refs a reconcile added and the file globs, which the plan reads so a rerun never amends a record
     twice or adds a glob it holds */
  out.knowledge = (get(['list', '--kind', 'knowledge', '--all']) || []).filter(mine).map((k) => ({ id: k.id, name: k.name, type: k.type, status: k.status,
    ...((k.files || []).length ? { files: k.files } : {}),
    ...((k.refs || []).some((x) => String(x).startsWith('onboard:')) ? { refs: k.refs.filter((x) => String(x).startsWith('onboard:')) } : {}) }));
  /* a profile is this project's when every record holding it is the project or one of its workstreams */
  const ws = new Set(out.workstreams.map((w) => w.id));
  const low = (s) => slashed(s).toLowerCase();
  const here = (h) => h.repo === shared || [dir, shared].some((d) => d && low(h.record) === low(d)) || ws.has(h.record);
  const profiles = get(['profile', 'list']);
  out.profiles = profiles ? profiles.profiles.map((p) => ({
    profile: p.profile, builtIn: p.builtIn === true, records: p.records || [], rules: ((p.settings || {})['rules.add'] || []).map((x) => x.slug),
    /* the doctor's read: a line from a ruling (from) changes only with a newer one */
    lines: ((p.settings || {})['rules.add'] || []).map((x) => ({ slug: x.slug, text: x.text, for: x.for || null, from: x.from || null })),
    here: (p.held || []).some(here), elsewhere: (p.held || []).some((h) => !here(h)),
  })) : [];
  out.tracks = out.workstreams.flatMap((w) => ((get(['track', 'list', '--workstream', w.id, '--all']) || {}).tracks || [])
    .map((t) => ({ id: t.id, name: t.name, state: t.state, workstream: w.id, labels: t.labels || [], refs: t.refs || [], parkReason: t.parkReason || null, handoff: t.handoff || null, ...(t.unpark ? { unpark: t.unpark } : {}) })));
  for (const t of out.tracks) if (t.labels.includes(label)) imported.push({ id: t.id, kind: 'track', name: t.name, status: t.state || null, refs: t.refs });
  const listed = (get(['list', '--all', '--project', dir]) || {}).questions || [];
  for (const q of listed) {
    if ((q.labels || []).includes(label)) imported.push({ id: q.id, kind: 'question', name: q.name, status: q.status || null, refs: q.refs || [] });
  }
  for (const t of out.tracks) if (!t.labels.includes(label) && earlierImport(t, label)) imported.push({ id: t.id, kind: 'track', name: t.name, status: t.state || null, refs: t.refs, earlier: true });
  out.imported = imported;
  /* the project's answered questions with their answers, shown by key in batches */
  const keys = listed.filter((q) => q.status === 'answered').map((q) => q.key || q.id);
  out.questions = [];
  for (let i = 0; i < keys.length; i += 500) {
    const shown = get(['show', ...keys.slice(i, i + 500)]);
    for (const q of shown ? [].concat(shown) : []) out.questions.push({ id: q.id, key: q.key, name: q.name, status: q.status, answer: q.answer || null, gist: q.gist || null });
  }
  /* every rule in force on the project with its source, and the decisions of its workstreams */
  const eff = get(['profile', 'show-effective', dir, '--rules']);
  out.rules = ((eff && eff.rows) || []).map((r) => ({ rule: r.rule, text: r.text, source: r.source, ...(r.for ? { for: r.role ? 'agents:' + r.role : r.for } : {}) }));
  const decided = new Map();
  for (const w of out.workstreams) {
    for (const d of get(['decisions', '--workstream', w.id]) || []) if (!decided.has(d.id)) decided.set(d.id, { id: d.id, key: d.key || null, name: d.name, words: d.words, created: d.created, workstream: w.id, question: d.question || null });
  }
  out.decisions = [...decided.values()];
  out.tasks = out.workstreams.flatMap((w) => (get(['list', '--kind', 'task', '--all', '--workstream', w.id]) || []).map((t) => ({ id: t.id, ...(t.key ? { key: t.key } : {}), name: t.name, status: t.status, workstream: w.id, updated: t.updated || null, inHand: t.inHand || null, refs: t.refs || [], unplaced: t.unplaced || null,
    /* what the doctor's task checks read from the list row as stored */
    word: t.word || null, labels: t.labels || [], created: t.created || null, ...(t.close ? { close: t.close } : {}), ...(t.landed ? { landed: t.landed } : {}),
    ...(t.wake ? { wake: t.wake } : {}), ...(t.runBy ? { runBy: t.runBy } : {}) })));
  /* what readersOf reads beside this PC's Claude folder: the project folders this PC maps */
  out.projects = projects ? ((get(['projects']) || {}).projects || []).map((x) => ({ name: x.name, dir: x.dir })) : [];
  /* the conversion map; a board without the verb yet reads as no map, never as a failed read */
  const map = cliJson(cli, ['conversion', '--project', dir], env);
  out.map = map.value || null;
  if (map.error) out.mapError = map.error;
  return out;
}

/* ---- rules against the board (the doctor's check) ---- */

const STOP = new Set('that this with from have will when what which they them then than into only also each more must should would could does about there their where while after before answer chosen question because these those were been being your over just like some such'.split(' '));
export const words = (s) => String(s || '').toLowerCase().match(/[a-z0-9]+/g) || [];
export const tokens = (s) => new Set(words(s).filter((w) => w.length >= 4 && !STOP.has(w)));
/* two titles on one subject: the words they share (at least three, most of the shorter one's), else 0 */
export function sameSubject(a, b) {
  const ta = tokens(a);
  const tb = tokens(b);
  let n = 0;
  for (const w of ta) if (tb.has(w)) n++;
  return n >= 3 && n / Math.min(ta.size, tb.size) >= 0.6 ? n : 0;
}
export const grams = (ws, n = 6) => { const g = new Set(); for (let i = 0; i + n <= ws.length; i++) g.add(ws.slice(i, i + n).join(' ')); return g; };

/* numbers with their units and flags: what a rule that says the same in other numbers differs in */
const NUM_UNIT = /(?<![\w.-])\d+(?:\.\d+)?\s?(?:k|kb|mb|gb|ms|s|secs?|seconds?|mins?|minutes?|h|hours?|days?|%|khz|hz|tokens?|characters?|chars|words?|lines?|tool calls|calls?|files?|times)?(?![\w]|\.\d)/gi;
/* section numbers of an outside document (terms 3.2 and 3.4.2) are no quantity of the rule's */
const SECTION_REF = /(?:§+\s*|\b(?:sections?|clauses?|terms?|articles?|paragraphs?)\s+)\d+(?:\.\d+)*(?:(?:,\s*|\s+(?:and|or|to)\s+)\d+(?:\.\d+)*)*/gi;
const unitOf = (m) => m.replace(/^[\d.\s]+/, '');
const marksOf = (s) => {
  const t = String(s || '').replace(/20\d\d-\d\d-\d\d/g, ' ').replace(SECTION_REF, ' ');
  return new Set([...t.matchAll(NUM_UNIT), ...t.matchAll(/(?<![\w-])--[a-z][\w-]*/gi)].map((m) => m[0].toLowerCase().replace(/\s+/g, ' ').trim()));
};

/* Each rule row against the board's rules in force and its decisions, by tokens and 6-grams (the doctor's probe): a sure
   match the same in its numbers and flags sets fields.coveredBy, one that differs in them fields.conflict. */
export function matchRules(rows, board) {
  const entries = [
    ...((board && board.rules) || []).map((r) => ({ key: r.rule, text: r.text })),
    /* the board's shape (name, words) or the facts' (title, ruling) */
    ...((board && board.decisions) || []).map((d) => ({ key: d.id, text: [d.title || d.name, d.ruling || d.words].filter(Boolean).join('\n') })),
  ].filter((e) => e.key && e.text).map((e) => ({ ...e, tok: tokens(e.text), grams: grams(words(e.text)), marks: marksOf(e.text) }));
  if (!entries.length) return rows;
  for (const r of rows.filter((x) => x.home === 'rule')) {
    const f = r.fields || (r.fields = {});
    const src = f.sourceText || f.text || r.title || '';
    const tok = tokens(src);
    const g = grams(words(src));
    let best = null;
    for (const e of entries) {
      let shared = 0;
      for (const w of tok) if (e.tok.has(w)) shared++;
      const ov = shared >= 3 ? shared / Math.min(tok.size, e.tok.size) : 0;
      let quote = false;
      for (const x of g) if (e.grams.has(x)) { quote = true; break; }
      if (!quote && ov < 0.5) continue;
      const score = (quote ? 3 : 0) + ov * 2;
      /* a cover holds both ways: a short line sharing three words with a long rule only names the same subject */
      const sure = quote || (shared >= 3 && shared / Math.max(tok.size, e.tok.size) >= 0.5);
      if (!best || score > best.score) best = { e, score, sure };
    }
    if (!best) continue;
    const { e, sure } = best;
    const ours = marksOf(src);
    const differs = [...[...ours].filter((m) => !e.marks.has(m)), ...[...e.marks].filter((m) => !ours.has(m))];
    /* short of a sure match, a difference needs one quantity both state in the same unit */
    const sameQuantity = [...ours].some((a) => !e.marks.has(a) && unitOf(a) && !a.startsWith('--') && [...e.marks].some((b) => b !== a && unitOf(b) === unitOf(a)));
    if (!sure && !sameQuantity) continue;
    if (!differs.length) f.coveredBy = e.key;
    else f.conflict = { with: e.key, theirs: e.text, ours: src, differs };
  }
  return rows;
}

/* ---- the facts ---- */

/* the size a session reads whole; past it the board's rulings and knowledge titles, then the folders' samples, move
   to files beside it */
const FACTS_TARGET = 150 << 10;
const RULING_MAX = 200;
/* the samples each folder shows inline (subjects, then citing files and code readers each), one step down at a time
   past the target; the whole samples then sit in facts-folders.json */
const SAMPLE_STEPS = [[12, 5], [6, 3], [2, 2], [0, 0]];
const SAMPLES_WHOLE = 10;
const ROOT_FILES_SHOWN = 100;

/* one line per record in each list, so the file stays small and greps by line */
function render(facts) {
  const val = (v, pad) => {
    if (Array.isArray(v)) return v.length ? '[\n' + v.map((x) => pad + '  ' + JSON.stringify(x)).join(',\n') + '\n' + pad + ']' : '[]';
    if (v && typeof v === 'object' && pad.length < 4) return '{\n' + Object.entries(v).map(([k, x]) => pad + '  ' + JSON.stringify(k) + ': ' + val(x, pad + '  ')).join(',\n') + '\n' + pad + '}';
    return JSON.stringify(v);
  };
  return val(facts, '') + '\n';
}

/* the files citing this folder and no deeper listed one, newest touched first, as file:line */
function directOf(ctx, n, k) {
  const direct = [...n.direct].map(([f, line]) => ({ f, line, day: touchOf(ctx, f).day || '' }))
    .sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : a.f < b.f ? -1 : 1));
  const shown = (xs) => xs.slice(0, k).map((c) => c.f + ':' + c.line);
  return { prose: shown(direct.filter((c) => !reads(c.f))), code: shown(direct.filter((c) => reads(c.f))) };
}

function folderFacts(ctx, n, [subjectsShown, citesShown] = SAMPLE_STEPS[0]) {
  const some = (k, v) => (v ? { [k]: v } : {});
  const since = ctx.markOf && ctx.markOf(n.path + '/') ? { since: ctx.markOf(n.path + '/') } : {};
  /* the default: a folder list, each with its file counts and last touch */
  if (!ctx.depth) return { path: n.path, ...since, files: n.count, ...some('untracked', n.untracked), ...some('modified', n.modified), last: n.last };
  const { prose, code } = directOf(ctx, n, citesShown);
  const subjects = subjectsShown ? subjectsOf(n.history, subjectsShown) : [];
  return {
    path: n.path, ...since, tracked: n.count - n.untracked, ...some('untracked', n.untracked), ...some('modified', n.modified), ...some('prose', n.prose), ...some('code', n.code),
    commits: n.commits, first: n.first, last: n.last, ...(n.lastCommit && n.lastCommit !== n.last ? { lastCommit: n.lastCommit } : {}),
    ...(subjects.length ? { subjects } : {}),
    ...(n.hits ? { cites: { hits: n.hits, files: n.citing.size, ...(prose.length ? { from: prose } : {}) } } : {}),
    ...(n.codeReaders.size ? { codeReaders: { files: n.codeReaders.size, ...(code.length ? { from: code } : {}) } } : {}),
    ...(n.outsideReaders.length ? { outsideReaders: n.outsideReaders } : {}),
  };
}

function boardFacts(bs) {
  if (!bs) return null;
  const done = new Set(['done', 'dropped']);
  return {
    read: bs.read, errors: bs.errors,
    workstreams: bs.workstreams,
    /* the doctor reads its board from these: a park's condition, refs and placing are what its checks judge */
    tracks: bs.tracks.map((t) => ({ id: t.id, name: t.name, state: t.state, workstream: t.workstream, ...(t.handoff ? { handoff: t.handoff } : {}), ...(t.parkReason ? { parkReason: t.parkReason } : {}), ...(t.unpark ? { unpark: t.unpark } : {}),
      ...(t.labels.length ? { labels: t.labels } : {}), ...(t.refs.length ? { refs: t.refs } : {}) })),
    openTasks: bs.tasks.filter((t) => !done.has(t.status)).map((t) => ({ id: t.id, name: t.name, status: t.status, workstream: t.workstream, ...(t.updated ? { updated: t.updated } : {}), ...(t.inHand ? { inHand: t.inHand } : {}),
      ...(t.unplaced ? { unplaced: t.unplaced } : {}), ...(t.refs.length ? { refs: t.refs } : {}), ...(t.word ? { word: t.word } : {}), ...(t.labels.length ? { labels: t.labels } : {}),
      ...(t.created ? { created: t.created } : {}), ...(t.close ? { close: t.close } : {}), ...(t.landed ? { landed: t.landed } : {}), ...(t.wake ? { wake: t.wake } : {}), ...(t.runBy ? { runBy: t.runBy } : {}) })),
    /* a cut's evidence may name a closed task, which coverage reads here by its status */
    closedTasks: bs.tasks.filter((t) => done.has(t.status)).map((t) => ({ id: t.id, ...(t.key ? { key: t.key } : {}), status: t.status })),
    questions: bs.questions.map((q) => ({ id: q.id, title: q.name, answer: clip(q.answer, RULING_MAX) })),
    decisions: bs.decisions.map((d) => ({ id: d.id, ...(d.key ? { key: d.key } : {}), title: d.name, ruling: clip(d.words, RULING_MAX), ...(d.question ? { question: d.question } : {}), ...(d.created ? { created: String(d.created).slice(0, 10) } : {}) })),
    knowledge: bs.knowledge,
    profiles: bs.profiles.map((p) => ({ profile: p.profile, builtIn: p.builtIn, here: p.here, elsewhere: p.elsewhere, records: p.records,
      /* each line's text is under rules; from marks a line a ruling made */
      lines: p.lines.map((l) => ({ slug: l.slug, ...(l.for ? { for: l.for } : {}), ...(l.from ? { from: l.from } : {}) })) })),
    rules: bs.rules,
    /* an earlier import's records, whole with their onboard: refs, so a rerun sees what it already did */
    imported: bs.imported,
  };
}

const sizeOf = (s) => Buffer.byteLength(s, 'utf8');

/* Each skill and command with the commits on it and on the scripts it names (a routine converts when
   history shows it in use); `recent` counts the commits in the doctor's window back from the latest commit. */
export function routinesOf(ctx, rules) {
  const latest = ctx.history.latest;
  const from = latest ? new Date(Date.parse(latest) - DORMANT_DAYS * 864e5).toISOString().slice(0, 10) : null;
  const out = [];
  for (const e of rules) {
    const skill = e.kind === 'skills' && /\/SKILL\.md$/.test(e.file);
    if (!skill && !(e.kind === 'commands' && /\.md$/i.test(e.file))) continue;
    const unit = skill ? dirOf(e.file) : e.file;
    const idx = new Set();
    for (const p of [unit, ...(e.scripts || [])]) for (const i of (ctx.history.per.get(p) || {}).idx || []) idx.add(i);
    const days = [...idx].map((i) => ctx.history.days[i]).sort();
    out.push({ file: e.file, kind: skill ? 'skill' : 'command', ...(e.scripts ? { scripts: e.scripts } : {}), commits: days.length, last: days.at(-1) || touchOf(ctx, e.file).day,
      recent: from ? days.filter((d) => d >= from).length : 0 });
  }
  return out;
}

export function survey(dir, { work, cli = DEFAULT_CLI, board = true, manifestFile, env = process.env, managed, depth = false } = {}) {
  const t0 = Date.now();
  const timings = {};
  let t = t0;
  const lap = (k) => { const now = Date.now(); timings[k] = now - t; t = now; };
  const top = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, encoding: 'utf8', windowsHide: true });
  const root = slashed(top.status === 0 ? top.stdout.trim() : resolve(dir));
  const isGit = top.status === 0;
  const slug = kebab(basename(root), 30);
  const shared = (isGit && sharedName(root)) || root.toLowerCase();
  const workDir = slashed(work || join(dataDir(env) || join(homedir(), '.claude', 'askerdo-onboard'), 'onboard', slug));
  const ctx = { root, isGit, slug, depth: Boolean(depth), claudeHome: env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), spawns: 1, opened: [], texts: new Map() };

  ctx.list = listing(ctx);
  lap('listing');
  ctx.history = historyPass(ctx);
  lap('history');
  const nodes = folderTree(ctx);
  const folders = listedFolders(nodes);
  if (ctx.depth) citesOf(ctx, folders, workDir);
  lap('cites');
  const ep = ctx.depth ? entryPoints(ctx) : null;
  const fileSet = new Set(ctx.list.files);
  /* the instruction files Claude reads here, each with its own ledger (AGENTS.md's working rules
     convert like CLAUDE.md's), and the rule files around them */
  const setting = instructionSetting({ home: ctx.claudeHome, ...(managed ? { managed } : {}) });
  const instr = instructionFiles(root, [...nodes.keys()], fileSet, setting, { ignored: ctx.list.ignored, memory: [join(ctx.claudeHome, 'CLAUDE.md'), join(managed || managedDir(), 'CLAUDE.md')] });
  const claude = instr.files.filter((x) => !x.file.endsWith('AGENTS.override.md')).flatMap((x) => claudeLedger(ctx, x.file));
  const rules = ruleFiles({ root, files: ctx.list.files, history: ctx.history.per, days: ctx.history.days, lines: ctx.history.lines,
    touch: (f) => touchOf(ctx, f), open: (f) => open(ctx, f), grep: (pats) => grepLines(ctx, pats, workDir), ...(ctx.depth ? {} : { citers: false, since: false }) }, instr);
  const routines = routinesOf(ctx, rules);
  const memory = memoryFiles(ctx);
  lap('entries');
  const bs = board ? boardState(cli, { shared, slug, dir: root, env, projects: ctx.depth }) : null;
  lap('board');
  if (ctx.depth) readersOf(ctx, folders, bs ? bs.projects : []);
  lap('readers');
  /* blob and tree hashes in one ls-tree pass, no file opened; the map marked against them */
  const tree = ctx.isGit ? parseTree(git(ctx, ['-c', 'core.quotepath=false', 'ls-tree', '-r', '-t', '-z', '--full-tree', 'HEAD'])) : new Map();
  const loose = (f) => noCopy(ctx, f) || ctx.list.dirty.has(f) || !tree.has(f);
  /* a private instruction file git ignores (CLAUDE.local.md) is on disk though no listing holds it, and the write
     stamped its text's hash, so the map reads it as there */
  const privates = new Set(instr.files.filter((x) => x.private && !fileSet.has(x.file)).map((x) => x.file));
  const present = (f) => fileSet.has(f) || privates.has(f);
  const mapped = ((bs && bs.map && bs.map.rows) || []).flatMap((r) => (r.kind === 'file' ? [r.source] : r.kind === 'call' ? Object.keys((r.detail && r.detail.subjects) || {})
    : r.kind === 'run' ? ((r.detail && r.detail.judged) || []).filter((j) => j.hash).map((j) => j.subject) : []));
  const need = mapped.filter((f) => !isFolder(f) && present(f) && loose(f));
  const texts = blobsOf(root, need);
  if (need.length) ctx.spawns++;
  const hashOf = (f) => (loose(f) ? texts.get(f) || null : tree.get(f) || null);
  const sigOf = (folder) => { const n = nodes.get(folder.replace(/\/+$/, '')); return n ? folderSig(tree.get(n.path), n.untracked + n.modified, n.touchedMs) : null; };
  const has = (p) => (p.endsWith('/') ? nodes.has(p.slice(0, -1)) : present(p));
  const seeds = bs ? seedsOf(bs.imported.filter((r) => r.earlier), root, has) : [];
  /* a judgment's evidence re-checked: its readers still there and naming it, its clause still in its file, its event */
  const reads = (r, p) => {
    const abs = /^[A-Za-z]:\/|^\//.test(r);
    const text = abs ? readText(r) : present(r) ? open(ctx, r) : null;
    return text === null ? 'gone' : text.replace(/\\+/g, '/').includes(p);
  };
  const clauses = new Map();
  const clauseHere = (key) => {
    const file = key.slice('clause:'.length, key.lastIndexOf('#'));
    if (!clauses.has(file)) clauses.set(file, new Set((instr.files.some((x) => x.file === file) ? claude.filter((c) => c.file === file) : claudeLedger(ctx, file)).map((c) => clauseId(file, c.clause))));
    return clauses.get(file).has(key);
  };
  const events = bs ? { tasks: new Map(bs.tasks.map((x) => [x.id, x.status])), tracks: new Map(bs.tracks.map((x) => [x.id, x])), answered: new Set(bs.questions.map((q) => q.id)),
    records: boardRecords({ openTasks: bs.tasks, decisions: bs.decisions, knowledge: bs.knowledge, questions: bs.questions }) } : {};
  const marked = bs ? markMap(bs.map, { hashOf, sigOf, exists: present, seeds, reads, clauseHere, board: events, judge: ctx.depth }) : null;
  ctx.markOf = marked && marked.markOf;
  lap('map');

  const manifestPath = slashed(manifestFile || join(workDir, 'manifest.json'));
  const manifest = readJson(manifestPath);
  const h = ctx.history;
  const rootNode = nodes.get('');
  const stateOf = (f) => (ctx.list.ignored.has(f) ? 'ignored' : ctx.list.untracked.has(f) ? 'untracked' : ctx.list.dirty.has(f) ? 'modified' : null);
  const rootFiles = rootNode.files.map((f) => ({ file: f, last: touchOf(ctx, f).day, ...(stateOf(f) ? { state: stateOf(f) } : {}) }));
  const facts = {
    version: 1,
    made: new Date().toISOString(),
    /* what the plan and the write read too, so all three run at one depth */
    depth: ctx.depth,
    project: {
      dir: root, name: basename(root), slug, shared, remote: isGit ? sharedName(root) || null : null, git: isGit, head: h.head,
      commits: h.commits, first: h.first, latest: h.latest, files: ctx.list.files.length, untracked: ctx.list.untracked.size, modified: ctx.list.dirty.size,
      ignoredHandoffs: [...ctx.list.ignored], recent: subjectsOf(rootNode.history),
      rootFiles: rootFiles.slice(0, ROOT_FILES_SHOWN), ...(rootFiles.length > ROOT_FILES_SHOWN ? { rootFilesMore: rootFiles.length - ROOT_FILES_SHOWN } : {}),
    },
    survey: { folders: 'to depth ' + FOLDER_DEPTH + ', one deeper under a folder there holding over ' + BIG_FOLDER + ' files', ...(ctx.depth ? { samples: { subjects: SAMPLE_STEPS[0][0], cites: SAMPLE_STEPS[0][1] } } : {}) },
    ...(ep ? { entryPoints: [...ep.entries].map(([file, from]) => {
      const text = ctx.texts.get(file) || '';
      return { file, from, last: touchOf(ctx, file).day, names: ep.named.get(file).map((f) => ({ file: f, last: touchOf(ctx, f).day, ...(stateOf(f) ? { state: stateOf(f) } : {}) })),
        text: text.slice(0, ENTRY_MAX), ...(text.length > ENTRY_MAX ? { cut: text.length } : {}) };
    }) } : {}),
    instructions: instr,
    claude,
    ruleFiles: rules,
    routines,
    memory,
    folders: folders.map((n) => folderFacts(ctx, n)),
    ...(ctx.depth ? { readers: ctx.readers || null } : {}),
    manifest: manifest ? { file: manifestPath, imports: (manifest.imports || []).length } : null,
    board: boardFacts(bs),
    conversion: marked ? { last: marked.last, counts: marked.counts, sources: marked.sources, folders: marked.folders, calls: marked.calls, left: marked.left,
      ...(marked.judgments ? { judgments: marked.judgments } : {}), ...(marked.instructions ? { instructions: marked.instructions } : {}), ...(bs.mapError ? { error: bs.mapError } : {}) } : null,
  };

  /* with --depth, sized for a session to read: the rulings, then the knowledge titles, go to facts-board.json; then the
     folders' inline samples shrink, the whole samples kept in facts-folders.json. The default writes one file */
  mkdirSync(workDir, { recursive: true });
  const factsFile = slashed(join(workDir, 'facts.json'));
  let boardFile = null;
  let samplesFile = null;
  let text = render(facts);
  const target = ctx.depth ? FACTS_TARGET : Infinity;
  if (sizeOf(text) > target && facts.board && (facts.board.questions.length || facts.board.decisions.length)) {
    boardFile = slashed(join(workDir, 'facts-board.json'));
    writeFileSync(boardFile, render({ questions: facts.board.questions, decisions: facts.board.decisions, closedTasks: facts.board.closedTasks || [] }));
    facts.board.rulings = { file: boardFile, questions: facts.board.questions.length, decisions: facts.board.decisions.length, closedTasks: (facts.board.closedTasks || []).length, search: 'by id or words; one record per line' };
    delete facts.board.questions;
    delete facts.board.decisions;
    delete facts.board.closedTasks;
    text = render(facts);
  }
  if (sizeOf(text) > target && facts.board && facts.board.knowledge.length) {
    const ruled = boardFile ? JSON.parse(readFileSync(boardFile, 'utf8')) : {};
    boardFile = slashed(join(workDir, 'facts-board.json'));
    writeFileSync(boardFile, render({ ...ruled, knowledge: facts.board.knowledge }));
    facts.board.rulings = { file: boardFile, search: 'by id or words; one record per line', ...facts.board.rulings, knowledge: facts.board.knowledge.length };
    delete facts.board.knowledge;
    text = render(facts);
  }
  for (const step of SAMPLE_STEPS.slice(1)) {
    if (sizeOf(text) <= target) break;
    if (!samplesFile) {
      samplesFile = slashed(join(workDir, 'facts-folders.json'));
      writeFileSync(samplesFile, render({ folders: folders.map((n) => {
        const { prose, code } = directOf(ctx, n, SAMPLES_WHOLE);
        return { path: n.path, subjects: subjectsOf(n.history), cites: prose, codeReaders: code };
      }) }));
    }
    facts.folders = folders.map((n) => folderFacts(ctx, n, step));
    facts.survey.samples = { subjects: step[0], cites: step[1], whole: samplesFile, search: 'by folder path; one folder per line' };
    text = render(facts);
  }
  /* last, the rule files and the nested instruction files' ledgers go to facts-rules.json */
  let rulesFile = null;
  const nested = claude.filter((c) => c.file.includes('/') && !c.file.startsWith('.claude/'));
  if (sizeOf(text) > target && (rules.length || nested.length)) {
    rulesFile = slashed(join(workDir, 'facts-rules.json'));
    writeFileSync(rulesFile, render({ ruleFiles: rules, claude: nested }));
    facts.ruleFiles = { file: rulesFile, count: rules.length, search: 'by file path; one file or clause per line' };
    facts.claude = claude.filter((c) => !nested.includes(c));
    if (nested.length) facts.claudeNested = { file: rulesFile, clauses: nested.length, files: [...new Set(nested.map((c) => c.file))] };
    text = render(facts);
  }
  timings.total = Date.now() - t0;
  facts.survey = { ...facts.survey, ms: timings.total, timings, gitSpawns: ctx.spawns, filesOpened: ctx.opened.length, opened: ctx.opened };
  text = render(facts);
  writeFileSync(factsFile, text);
  /* the folders' state the write records with its run, so the next survey marks what changed since */
  writeFileSync(join(workDir, 'facts-map.json'), JSON.stringify({ made: facts.made, head: h.head, folders: Object.fromEntries(folders.map((n) => [n.path + '/', sigOf(n.path + '/')])),
    instructions: { mode: setting.mode, read: instr.files.filter((x) => x.read).map((x) => x.file) } }) + '\n');
  const sizes = { facts: sizeOf(text), ...(boardFile ? { board: statSync(boardFile).size } : {}), ...(samplesFile ? { samples: statSync(samplesFile).size } : {}), ...(rulesFile ? { rules: statSync(rulesFile).size } : {}) };
  const b = facts.board;
  return {
    facts, factsFile, boardFile, samplesFile, rulesFile, sizes, work: workDir, project: facts.project, board: bs,
    history: { commits: h.commits, first: h.first, latest: h.latest },
    counts: {
      folders: folders.length, files: ctx.list.files.length, untracked: ctx.list.untracked.size, modified: ctx.list.dirty.size, commits: h.commits, ...(ep ? { entryPoints: ep.entries.size } : {}),
      routines: routines.length, routinesInUse: routines.filter((r) => r.recent).length, depth: ctx.depth, memory: memory.length, clauses: claude.length, ruleFiles: rules.length, handoffFiles: rules.filter((r) => r.kind === 'handoff' || r.role).length, gitSpawns: ctx.spawns, filesOpened: ctx.opened.length, ms: timings.total,
      ...(b ? { workstreams: b.workstreams.length, tracks: b.tracks.length, openTasks: b.openTasks.length, questions: bs.questions.length, decisions: bs.decisions.length,
        /* decisions are knowledge records too: the line counts the facts in force apart from them */
        knowledge: bs.knowledge.filter((k) => k.type !== 'decision' && (!k.status || k.status === 'active')).length, rules: b.rules.length, imported: b.imported.length } : {}),
      ...(marked ? { map: marked.counts, mapLast: marked.last } : {}),
    },
  };
}

/* The Project instructions setting and what Claude reads by it, in one line */
export function instructionLine(ins) {
  const s = ins.setting || {};
  const read = (ins.files || []).filter((x) => x.read).map((x) => x.file + (x.read === 'nested' ? ' (nested)' : ''));
  return 'Instructions: ' + s.mode + (s.from && s.from !== 'default' ? ' (set in ' + s.from + ')' : ' (the default)') + '; Claude reads ' + (read.join(', ') || 'no project instruction file');
}

/* The survey's summary, which the doctor prints too: the facts before, the session's next step after. */
export function surveyLines(d) {
  const c = d.counts || {};
  const kb = (n) => (n / 1024).toFixed(1) + ' KB';
  const p = d.project || {};
  const before = [
    'Files: ' + c.files + ' (' + c.untracked + ' untracked, ' + c.modified + ' modified); ' + (p.git ? c.commits + ' commits from ' + p.first + ' to ' + p.latest : 'not a git repo'),
    'Folders: ' + c.folders + (c.depth ? ' listed with their counts, touches, subjects, cites and readers' : ' listed with their file counts and last touch (--depth adds subjects, cites and readers)'),
    ...(d.facts && d.facts.entryPoints ? ['Entry points: ' + d.facts.entryPoints.map((e) => e.file).join(', ')] : []),
    ...(c.routines !== undefined ? ['Routines: ' + c.routines + ' skills and commands, ' + c.routinesInUse + ' with commits on them or their scripts in the last ' + DORMANT_DAYS + ' days'] : []),
    ...(c.memory ? [c.memory + ' Claude memory files'] : []),
    ...(d.facts && d.facts.instructions ? [instructionLine(d.facts.instructions) + '; ' + (c.ruleFiles || 0) + ' rule files with their cites and loaders'
      + (c.handoffFiles ? ', ' + c.handoffFiles + ' of them from handoff protocols (an entry, the files it resumes from, standing rules)' : '')] : []),
    d.board ? 'Board: ' + c.workstreams + ' workstreams, ' + c.tracks + ' tracks, ' + c.openTasks + ' open tasks, ' + c.questions + ' answered questions, ' + c.decisions + ' decisions, '
      + c.knowledge + ' knowledge records, ' + c.rules + ' rules in force, ' + c.imported + ' records from an earlier import'
      + (d.board.errors.length ? '; reads that failed: ' + d.board.errors.join('; ') : '') : 'Board: not read',
    ...(c.map ? ['Map: ' + (c.mapLast ? 'the last run ' + String(c.mapLast.at).slice(0, 10) + '; ' : 'no run yet; ')
      + (Object.entries(c.map).map(([k, n]) => n + ' ' + k).join(', ') || 'nothing mapped') + '; read only what facts.json marks changed, new or removed'] : []),
    'Reads: ' + c.filesOpened + ' files opened, ' + c.gitSpawns + ' git spawns, ' + (c.ms / 1000).toFixed(1) + ' s',
    'Facts: ' + d.factsFile + ' (' + kb(d.sizes.facts) + ')' + (d.boardFile ? '; the board\'s rulings and knowledge: ' + d.boardFile + ' (' + kb(d.sizes.board) + ')' : '')
      + (d.samplesFile ? '; the folders\' whole samples: ' + d.samplesFile + ' (' + kb(d.sizes.samples) + ')' : '')
      + (d.rulesFile ? '; the rule files and nested ledgers: ' + d.rulesFile + ' (' + kb(d.sizes.rules) + ')' : ''),
  ];
  const after = ['Next: read facts.json, open what it needs, and write ' + d.work + '/proposal.json (items, folders, calls, claude)'];
  return { before, after };
}

/* ---- run ---- */

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const a = process.argv.slice(2);
  const flag = (n) => { const i = a.indexOf('--' + n); return i >= 0 ? a.splice(i, 2)[1] : undefined; };
  const work = flag('work'); const cli = flag('cli'); const manifestFile = flag('manifest');
  const bare = (n) => { const i = a.indexOf('--' + n); if (i >= 0) a.splice(i, 1); return i >= 0; };
  const noBoard = bare('no-board'); const depth = bare('depth');
  if (!a[0] || a[0] === '--help') { console.log('node survey.mjs <project dir> [--work <dir>] [--cli <path>] [--no-board] [--manifest <file>] [--depth]'); process.exit(a[0] ? 0 : 1); }
  if (!existsSync(a[0])) { console.error('survey: no folder ' + a[0]); process.exit(1); }
  const d = survey(a[0], { work, cli: cli || DEFAULT_CLI, board: !noBoard, manifestFile, depth });
  console.log('Survey of ' + d.project.dir + ' (' + d.project.shared + ')');
  const lines = surveyLines(d);
  for (const l of [...lines.before, ...lines.after]) console.log(l);
}
