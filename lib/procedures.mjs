/* Procedures, this PC's half: a repo's docs/procedures/<slug>.md
   holds the steps, the board's PR-n card the living part. This file parses the
   steps file (docs/procedures/README.md is the contract) and reads its staleness
   and the repo's checkouts here; the board makes, follows and retires the cards. */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFile, spawnSync } from 'node:child_process';
import { normPath, relativeTo } from './proc-match.mjs';
import { normRemote, sharedName } from './project-id.mjs';
import { folderHere, readMap, unmappedLine } from './project-map.mjs';
import { dataDir, pluginRoot, pluginVersion } from './node-helpers.mjs';
import { UsageError } from '../server/verbs/labels.mjs';
import { cardForFile, cardsAt as boardCardsAt, cardsOfProject, findCardIn } from '../server/verbs/proc-cards.mjs';

export const PROC_DIR = 'docs/procedures';
export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const HEADINGS = ['Trigger', 'Preconditions', 'Steps', 'Verify', 'References'];
const FRONT_KEYS = ['name', 'title', 'summary', 'triggers', 'repos', 'everywhere', 'live'];
const RUN_FENCES = ['sh', 'powershell'];
const RECORD_TARGET = /^(?:Q\d+|(?:WS|PR|P|T|TH|K)-\d+(?:\.\d+)?)$/;
const REPO_NAME = /^[a-z0-9][a-z0-9-]*$/;
/* commands on PATH, taken as present (README staleness rule 3) */
const INTERPRETERS = ['node', 'python', 'pwsh', 'bash', 'sh', 'deno', 'bun', 'npx', 'tsx'];

/* ---- the frontmatter: the YAML subset the contract uses ----------------- */

function yamlScalar(raw, where) {
  const s = raw.trim();
  if (s.startsWith("'")) {
    if (!/^'(?:[^']|'')*'$/.test(s)) throw new Error(where + ': unterminated single-quoted value');
    return s.slice(1, -1).replace(/''/g, "'");
  }
  if (s.startsWith('"')) {
    try { return JSON.parse(s); } catch { throw new Error(where + ': bad double-quoted value'); }
  }
  if (s.startsWith('[')) {
    if (!s.endsWith(']')) throw new Error(where + ': unterminated list');
    const inner = s.slice(1, -1).trim();
    if (!inner) return [];
    const items = [];
    let cur = '';
    let q = '';
    for (const c of inner) {
      if (q) { cur += c; if (c === q) q = ''; continue; }
      if (c === "'" || c === '"') { q = c; cur += c; continue; }
      if (c === ',') { items.push(cur); cur = ''; continue; }
      cur += c;
    }
    items.push(cur);
    return items.map((x) => yamlScalar(x, where));
  }
  if (s.startsWith('{')) {
    if (s === '{}') return {};
    throw new Error(where + ': write a map as indented lines, not {...}');
  }
  if (/^[`*&!|>%@]/.test(s)) throw new Error(where + ': quote a value that starts with ' + s[0]);
  const plain = s.replace(/\s+#.*$/, '');
  if (/:\s/.test(plain)) throw new Error(where + ': quote a value that contains ": "');
  return plain;
}

export function parseYaml(text) {
  const lines = String(text).split('\n').map((raw, i) => ({ raw: raw.replace(/\r$/, ''), n: i + 1 }))
    .filter((l) => l.raw.trim() && !/^\s*#/.test(l.raw));
  for (const l of lines) if (/^\s*\t/.test(l.raw)) throw new Error('line ' + l.n + ': a tab in the indentation');
  let i = 0;
  const ind = (l) => /^ */.exec(l.raw)[0].length;
  const isItem = (l, at) => ind(l) === at && /^-(?:\s|$)/.test(l.raw.slice(at));
  function node(at) {
    return isItem(lines[i], at) ? list(at) : map(at);
  }
  function map(at) {
    const out = {};
    while (i < lines.length && ind(lines[i]) >= at) {
      const l = lines[i];
      if (ind(l) > at) throw new Error('line ' + l.n + ': unexpected indentation');
      if (isItem(l, at)) throw new Error('line ' + l.n + ': a list item where a key belongs');
      const m = /^([A-Za-z_][\w-]*):(?:\s+(.*))?$/.exec(l.raw.slice(at));
      if (!m) throw new Error('line ' + l.n + ': expected "key: value"');
      if (Object.hasOwn(out, m[1])) throw new Error('line ' + l.n + ': ' + m[1] + ' appears twice');
      i++;
      if (m[2] !== undefined && m[2].trim() !== '') out[m[1]] = yamlScalar(m[2], 'line ' + l.n);
      else if (i < lines.length && (ind(lines[i]) > at || isItem(lines[i], at))) out[m[1]] = node(ind(lines[i]));
      else out[m[1]] = null;
    }
    return out;
  }
  function list(at) {
    const out = [];
    while (i < lines.length && isItem(lines[i], at)) {
      const l = lines[i];
      const rest = l.raw.slice(at + 1).replace(/^\s+/, '');
      if (/^[A-Za-z_][\w-]*:(?:\s|$)/.test(rest)) {
        lines[i] = { raw: ' '.repeat(at + 2) + rest, n: l.n };
        out.push(map(at + 2));
      } else {
        i++;
        out.push(rest ? yamlScalar(rest, 'line ' + l.n) : null);
      }
    }
    return out;
  }
  if (!lines.length) return {};
  if (ind(lines[0]) !== 0) throw new Error('line ' + lines[0].n + ': the frontmatter starts indented');
  const out = map(0);
  if (i < lines.length) throw new Error('line ' + lines[i].n + ': unexpected indentation');
  return out;
}

/* ---- the file ----------------------------------------------------------- */

const strList = (v, key, errors) => {
  if (v === null || v === undefined) return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || !x.trim())) {
    errors.push(key + ' must be a list of non-empty text');
    return [];
  }
  return v.map((x) => x.trim());
};

/* `target` of a References bullet: a URL, a store record, or a repo path with
   an optional `::symbol`, maybe in another covered repo (`<repo>:<path>`). */
export function refTarget(target, repos = {}) {
  const t = String(target).trim();
  if (/^https?:\/\//i.test(t)) return { kind: 'url', target: t };
  if (RECORD_TARGET.test(t)) return { kind: 'record', target: t };
  const cut = t.indexOf('::');
  let path = cut < 0 ? t : t.slice(0, cut);
  const symbol = cut < 0 ? '' : t.slice(cut + 2);
  let repo = 'self';
  const m = /^([a-z0-9][a-z0-9-]*):(?!\/)(.+)$/.exec(path);
  if (m && !/^[a-z]$/i.test(m[1])) {
    if (!Object.hasOwn(repos, m[1])) return { kind: 'error', target: t, error: 'names repo ' + m[1] + ', which repos does not list' };
    repo = m[1];
    path = m[2];
  }
  if (/^[A-Za-z]:[\\/]/.test(path) || path.startsWith('/')) return { kind: 'error', target: t, error: 'is absolute; references are repo-relative' };
  if (!path) return { kind: 'error', target: t, error: 'names no path' };
  return { kind: 'path', target: t, repo, path, symbol };
}

/* The body, split by H2 into items: text lines, fences with their tag, H3s. */
function bodySections(body, errors) {
  const lines = body.split('\n');
  const h1 = [];
  const sections = [];
  let cur = null;
  let fence = null;
  lines.forEach((raw, idx) => {
    const line = raw.replace(/\r$/, '');
    const fm = /^(`{3,}|~{3,})\s*([A-Za-z0-9_-]*)/.exec(line);
    if (fence) {
      if (fm && line.trim().startsWith(fence.mark) && !fm[2]) { fence = null; return; }
      fence.lines.push(line);
      return;
    }
    if (fm) {
      fence = { type: 'fence', mark: fm[1], tag: fm[2].toLowerCase(), lines: [] };
      if (cur) cur.items.push(fence);
      return;
    }
    if (/^# /.test(line)) { h1.push({ text: line.slice(2).trim(), before: sections.length }); return; }
    if (/^## /.test(line)) { cur = { name: line.slice(3).trim(), items: [], line: idx + 1 }; sections.push(cur); return; }
    if (/^#### /.test(line)) { if (cur) cur.items.push({ type: 'text', line }); return; }
    if (/^### /.test(line)) { if (cur) cur.items.push({ type: 'h3', text: line.slice(4).trim() }); else errors.push('an H3 before any H2'); return; }
    if (cur) cur.items.push({ type: 'text', line });
    else if (line.trim() && !h1.length) errors.push('text before the title');
  });
  if (fence) errors.push('an unterminated code fence');
  return { h1, sections };
}

const textLines = (sec) => sec.items.filter((x) => x.type === 'text').map((x) => x.line);

/* Bullets of a section: `- ` lines with their indented continuations. */
function bullets(sec, what, errors) {
  const out = [];
  for (const it of sec.items) {
    if (it.type !== 'text') { errors.push(what + ' holds only bullets'); continue; }
    if (!it.line.trim()) continue;
    if (/^- /.test(it.line)) out.push(it.line.slice(2).trim());
    else if (/^\s+\S/.test(it.line) && out.length) out[out.length - 1] += ' ' + it.line.trim();
    else errors.push(what + ' holds only bullets: ' + it.line.trim().slice(0, 60));
  }
  return out;
}

/* One file against the contract. `fileName` is `<slug>.md`. Errors are MUSTs
   (no card); the lint for paths missing from References is a warning. */
export function parseProcedure(text, fileName) {
  const errors = [];
  const src = String(text).replace(/\r\n/g, '\n');
  const slug = String(fileName || '').replace(/\.md$/, '');
  if (!src.startsWith('---\n')) return { ok: false, errors: ['no frontmatter: the file starts with ---'] };
  const end = src.indexOf('\n---\n', 3);
  if (end < 0) return { ok: false, errors: ['the frontmatter is not closed with ---'] };
  let fm;
  try { fm = parseYaml(src.slice(4, end + 1)); } catch (e) { return { ok: false, errors: ['frontmatter ' + e.message] }; }
  for (const k of Object.keys(fm)) if (!FRONT_KEYS.includes(k)) errors.push('unknown frontmatter key: ' + k);
  if (!SLUG_RE.test(slug)) errors.push('the file name ' + fileName + ' is not a procedure name');
  if (fm.name !== slug) errors.push('name must equal the file name (' + slug + ')');
  const title = typeof fm.title === 'string' ? fm.title.trim() : '';
  if (!title) errors.push('title is required');
  const summary = typeof fm.summary === 'string' ? fm.summary.trim() : '';
  if (!summary) errors.push('summary is required');
  else if (summary.length > 200) errors.push('summary is over 200 characters');
  /* a card for every project; its steps run wherever the session is, so it names no other repo */
  const ew = fm.everywhere === undefined || fm.everywhere === null ? 'false' : String(fm.everywhere);
  if (!['true', 'false'].includes(ew)) errors.push('everywhere is true or false');
  const everywhere = ew === 'true';
  /* a card for the live install, which a sandboxed command never draws */
  const lv = fm.live === undefined || fm.live === null ? 'false' : String(fm.live);
  if (!['true', 'false'].includes(lv)) errors.push('live is true or false');
  const live = lv === 'true';
  const repos = {};
  if (everywhere && fm.repos && typeof fm.repos === 'object' && Object.keys(fm.repos).length) errors.push('an everywhere card takes no repos');
  if (fm.repos !== undefined && fm.repos !== null) {
    if (typeof fm.repos !== 'object' || Array.isArray(fm.repos)) errors.push('repos is a map of <short name>: <absolute root>');
    else {
      for (const [k, v] of Object.entries(fm.repos)) {
        if (!REPO_NAME.test(k) || k === 'self') errors.push('repos: ' + k + ' is not a short repo name');
        else if (typeof v !== 'string' || !(/^[A-Za-z]:\//.test(v) || v.startsWith('/')) || v.includes('\\')) {
          errors.push('repos: ' + k + ' needs an absolute root with forward slashes');
        } else repos[k] = normPath(v);
      }
    }
  }
  const trig = fm.triggers;
  const triggers = { words: [], commands: [], files: [] };
  if (!trig || typeof trig !== 'object' || Array.isArray(trig)) errors.push('triggers is required: a map of words, commands, files');
  else {
    for (const k of Object.keys(trig)) if (!['words', 'commands', 'files'].includes(k)) errors.push('unknown trigger list: ' + k);
    triggers.words = strList(trig.words, 'triggers.words', errors).map((w) => w.toLowerCase());
    triggers.commands = strList(trig.commands, 'triggers.commands', errors);
    const files = trig.files === null || trig.files === undefined ? [] : trig.files;
    if (!Array.isArray(files)) errors.push('triggers.files must be a list');
    else {
      for (const f of files) {
        let glob;
        let contains = '';
        if (typeof f === 'string') glob = f.trim();
        else if (f && typeof f === 'object' && !Array.isArray(f)) {
          for (const k of Object.keys(f)) if (!['glob', 'contains'].includes(k)) errors.push('triggers.files takes glob and contains, not ' + k);
          glob = typeof f.glob === 'string' ? f.glob.trim() : '';
          if (f.contains !== undefined && (typeof f.contains !== 'string' || !f.contains)) errors.push('triggers.files contains must be text');
          else contains = f.contains || '';
        }
        if (!glob) { errors.push('a triggers.files entry needs a glob'); continue; }
        const t = refTarget(glob, repos);
        if (t.kind === 'error') { errors.push('triggers.files ' + glob + ' ' + t.error); continue; }
        if (glob.includes(' | ')) { errors.push('triggers.files ' + glob + ' holds " | "'); continue; }
        triggers.files.push({ repo: t.kind === 'path' ? t.repo : 'self', glob: t.kind === 'path' ? t.path : glob, contains });
      }
    }
    if (!triggers.words.length && !triggers.commands.length && !triggers.files.length) errors.push('triggers needs at least one non-empty list');
  }

  const { h1, sections } = bodySections(src.slice(end + 5), errors);
  if (h1.length !== 1) errors.push('the body needs exactly one H1, found ' + h1.length);
  else {
    if (title && h1[0].text !== title) errors.push('the H1 must equal the title');
    if (h1[0].before > 0) errors.push('the H1 comes before the first H2');
  }
  const names = sections.map((s) => s.name);
  if (names.join('|') !== HEADINGS.join('|')) errors.push('the H2 headings must be ' + HEADINGS.map((h) => '## ' + h).join(', ') + ', in order, once each');
  const sec = Object.fromEntries(sections.map((s) => [s.name, s]));
  const commands = [];
  const backticks = [];
  const refs = [];
  if (sec.Trigger) {
    if (!textLines(sec.Trigger).some((l) => l.trim())) errors.push('## Trigger is empty');
    if (sec.Trigger.items.some((x) => x.type === 'h3')) errors.push('an H3 outside ## Steps');
  }
  if (sec.Preconditions) {
    const list = bullets(sec.Preconditions, '## Preconditions', errors);
    if (!list.length) errors.push('## Preconditions needs at least one bullet (- None.)');
    for (const b of list) {
      const m = / check: `([^`]+)`/.exec(b);
      if (m) commands.push({ section: 'Preconditions', line: m[1].trim() });
    }
  }
  if (sec.Steps) {
    let n = 0;
    let seenText = false;
    for (const it of sec.Steps.items) {
      if (it.type === 'h3') {
        const m = /^(\d+)\.\s+\S/.exec(it.text);
        if (!m) errors.push('a step heading is "### <n>. <title>": ' + it.text.slice(0, 60));
        else if (Number(m[1]) !== n + 1) errors.push('steps are numbered from 1 with no gaps (found ' + m[1] + ' after ' + n + ')');
        n = m ? Number(m[1]) : n + 1;
      } else if (!n && (it.type === 'fence' || it.line.trim())) seenText = true;
    }
    if (seenText) errors.push('## Steps holds only H3 steps');
    if (!n) errors.push('## Steps needs at least one step');
  }
  if (sec.Verify) {
    if (sec.Verify.items.some((x) => x.type === 'h3')) errors.push('an H3 outside ## Steps');
    if (!sec.Verify.items.some((x) => x.type === 'fence' && RUN_FENCES.includes(x.tag))) errors.push('## Verify needs an sh or powershell fence');
    if (!textLines(sec.Verify).some((l) => /^- expect: \S/.test(l))) errors.push('## Verify needs a "- expect: " bullet');
  }
  for (const name of ['Steps', 'Verify']) {
    if (!sec[name]) continue;
    for (const it of sec[name].items) {
      if (it.type === 'fence' && RUN_FENCES.includes(it.tag)) {
        for (const l of it.lines) if (l.trim() && !l.trim().startsWith('#')) commands.push({ section: name, line: l.trim() });
      } else if (it.type === 'text') {
        for (const m of it.line.matchAll(/`([^`]+)`/g)) backticks.push({ section: name, token: m[1] });
      }
    }
  }
  if (sec.References) {
    if (sec.References.items.some((x) => x.type === 'h3')) errors.push('an H3 outside ## Steps');
    for (const b of bullets(sec.References, '## References', errors)) {
      const m = /^`([^`]+)`: \S/.exec(b);
      if (!m) { errors.push('a References bullet starts with one backticked target, then ": ": ' + b.slice(0, 60)); continue; }
      const t = refTarget(m[1], repos);
      if (t.kind === 'error') errors.push('reference ' + m[1] + ' ' + t.error);
      else refs.push(t);
    }
    if (!refs.length && !errors.some((e) => e.startsWith('a References'))) errors.push('## References needs at least one bullet');
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, errors: [], proc: { slug, title, summary, triggers, repos, commands, backticks, refs, ...(everywhere ? { everywhere } : {}), ...(live ? { live } : {}) } };
}

/* ---- git and the file system ---------------------------------------------- */

/* status null: git did not answer (missing, timed out, refused to start) */
function gitRun(dir, args) {
  try {
    const r = spawnSync('git', ['-C', dir, ...args], {
      encoding: 'utf8', timeout: 10000, windowsHide: true, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    });
    return { status: r.error ? null : r.status, out: String(r.stdout || '').trim() };
  } catch {
    return { status: null, out: '' };
  }
}

function git(dir, args) {
  const r = gitRun(dir, args);
  return r.status === 0 ? r.out : null;
}

/* The same read off the event loop, for the local server. */
function gitAsync(dir, args) {
  return new Promise((ok) => {
    try {
      execFile('git', ['-C', dir, ...args], { encoding: 'utf8', timeout: 10000, windowsHide: true, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } },
        (err, stdout) => ok(err ? null : String(stdout || '').trim()));
    } catch { ok(null); }
  });
}

const COMMON_DIR = ['rev-parse', '--path-format=absolute', '--git-common-dir'];
const WORKTREES = ['worktree', 'list', '--porcelain'];

/* The main checkout from git's common dir, else the checkout itself. */
function mainOf(here, commonDir) {
  const common = normPath(commonDir || '');
  if (!/\/\.git$/i.test(common)) return here;
  const main = common.slice(0, -'/.git'.length);
  return exists(main) ? main : here;
}

const listedOf = (out, project) => {
  const listed = out ? out.split('\n').filter((l) => l.startsWith('worktree ')).map((l) => normPath(l.slice(9))) : [];
  return listed.length ? listed : [project];
};

const headOf = (dir) => git(dir, ['rev-parse', 'HEAD']);
const readText = (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } };
const exists = (p) => { try { statSync(p); return true; } catch { return false; } };

/* Shell words with quotes taken off; a word holding `$` or a placeholder is ''. */
function words(line) {
  const out = [];
  for (const m of line.matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g)) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

const looksLikePath = (w) => !!w && !/[<>$*?]/.test(w) && !w.startsWith('-') && !/^[A-Za-z]:|^\/|^~|^https?:/.test(w)
  && (w.includes('/') || /\.(?:mjs|cjs|js|ts|ps1|sh|py|exe|cmd|bat)$/i.test(w));

/* A command line's segments, split on && || ; | outside quotes and backticks,
   so a quoted regex alternation stays one word. */
function segments(line) {
  const out = [];
  let cur = '';
  let quote = '';
  const s = String(line);
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      cur += ch;
      if (ch === '\\' && quote === '"' && i + 1 < s.length) cur += s[++i];
      else if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      cur += ch;
    } else if (ch === ';' || ch === '|' || (ch === '&' && s[i + 1] === '&')) {
      out.push(cur);
      cur = '';
      if ((ch === '|' || ch === '&') && s[i + 1] === ch) i++;
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/* The repo scripts a command line runs: the first word, or an interpreter's
   script; with the --flags each passes. A bare first word may be on PATH. */
export function commandScripts(line) {
  const out = [];
  for (const seg of segments(line)) {
    let w = words(seg.trim());
    while (w.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0])) w = w.slice(1);
    if (w[0] === 'env') {
      w = w.slice(1);
      while (w.length && (w[0].startsWith('-') || /^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0]))) w = w.slice(w[0] === '-u' ? 2 : 1);
    }
    if (!w.length) continue;
    let script = '';
    let rest = [];
    let bare = false;
    if (looksLikePath(w[0])) { script = w[0]; rest = w.slice(1); bare = !script.includes('/'); }
    else if (INTERPRETERS.includes(w[0].toLowerCase()) && looksLikePath(w[1])) { script = w[1]; rest = w.slice(2); }
    if (!script) continue;
    out.push({
      script: script.replace(/^\.\//, ''), flags: rest.filter((x) => /^--[A-Za-z0-9]/.test(x)).map((x) => x.split('=')[0]),
      ...(bare ? { bare } : {}),
    });
  }
  return out;
}

/* The roots of the covered repos on this machine, by short name. */
function rootsOf(project, proc) {
  return { self: normPath(project), ...(proc ? proc.repos : {}) };
}

/* The commits since base touching each path, from one log of the repo (a log per path made a scan 44 git processes). A merge's combined diff names
   what differs from every parent, as a log of that one path counts it. */
function commitsTouching(dir, base, paths) {
  const out = git(dir, ['-c', 'core.quotePath=false', 'log', '-c', '--no-renames', '--name-only', '--format=%x01%H', base + '..HEAD', '--', ...paths]);
  const counts = new Map(paths.map((p) => [p, 0]));
  if (out === null) return counts;
  for (const c of out.split('\x01').slice(1)) {
    const names = c.split('\n').slice(1).filter(Boolean);
    for (const p of paths) {
      const key = p.replace(/^(?:\.\/)+/, '').replace(/\/+$/, '');
      if (names.some((n) => !key || key === '.' || n === key || n.startsWith(key + '/'))) counts.set(p, counts.get(p) + 1);
    }
  }
  return counts;
}

/* README "How the card judges staleness", rules 1 to 3; age is the card's to show. */
export function judge(project, proc, verified = {}) {
  const reasons = [];
  const roots = rootsOf(project, proc);
  const base = {};
  for (const [name, dir] of Object.entries(roots)) {
    let b = verified[name] || '';
    /* a base read from the repo's own log is there; only a verified one is checked */
    if (!b && name === 'self') { base[name] = git(dir, ['log', '-1', '--format=%H', '--', PROC_DIR + '/' + proc.slug + '.md']) || ''; continue; }
    if (b) {
      /* exit 1 is a missing object; anything else is git failing, not a verdict */
      const st = /^[0-9a-f]{40,64}$/.test(b) ? gitRun(dir, ['cat-file', '-e', b]).status : 1;
      if (st === 1) reasons.push('the verified commit ' + b.slice(0, 7) + ' is not in ' + (name === 'self' ? 'the repo' : name));
      else if (st !== 0) reasons.push('not judged: git did not answer in ' + (name === 'self' ? 'the repo' : name));
      if (st !== 0) b = '';
    }
    base[name] = b;
  }
  const paths = proc.refs.filter((r) => r.kind === 'path');
  const touched = {};
  for (const name of Object.keys(roots)) {
    const mine = [...new Set(paths.filter((r) => r.repo === name && exists(join(roots[name], r.path))).map((r) => r.path))];
    if (base[name] && mine.length) touched[name] = commitsTouching(roots[name], base[name], mine);
  }
  const done = new Set();
  for (const r of paths) {
    const dir = roots[r.repo];
    const at = join(dir, r.path);
    const shown = (r.repo === 'self' ? '' : r.repo + ':') + r.path;
    const once = !done.has(shown);
    done.add(shown);
    if (!exists(at)) { if (once) reasons.push('gone: ' + shown); continue; }
    if (base[r.repo] && once) {
      const n = touched[r.repo] ? touched[r.repo].get(r.path) || 0 : 0;
      if (n) reasons.push('changed since ' + base[r.repo].slice(0, 7) + ': ' + shown + ' (' + n + (n === 1 ? ' commit)' : ' commits)'));
    }
    if (r.symbol) {
      const src = readText(at);
      if (src !== null && !src.includes(r.symbol)) reasons.push('symbol gone: ' + shown + '::' + r.symbol);
    }
  }
  const seen = new Set();
  for (const c of proc.commands) {
    for (const s of commandScripts(c.line)) {
      const at = join(roots.self, s.script);
      if (!exists(at)) {
        /* a bare first word that is no repo file is a command on PATH, such as curl.exe */
        if (!s.bare && !seen.has(s.script)) reasons.push('command gone: ' + s.script);
        seen.add(s.script);
        continue;
      }
      const src = readText(at);
      if (src === null) continue;
      for (const f of s.flags) {
        const k = s.script + ' ' + f;
        if (!seen.has(k) && !src.includes(f)) reasons.push('flag gone: ' + f + ' in ' + s.script);
        seen.add(k);
      }
    }
  }
  return reasons;
}

/* README lint: a repo path in Steps or Verify that exists and is missing from References. */
export function lint(project, proc) {
  const roots = rootsOf(project, proc);
  const covered = proc.refs.filter((r) => r.kind === 'path').map((r) => ({ repo: r.repo, path: r.path }));
  const has = (repo, p) => covered.some((c) => c.repo === repo
    && (c.path === p || c.path === p + '/' || (c.path.endsWith('/') && p.startsWith(c.path))));
  const out = [];
  const seen = new Set();
  const tokens = proc.backticks.flatMap((b) => b.token.split(/\s+/).map((t) => ({ section: b.section, t })))
    .concat(proc.commands.flatMap((c) => words(c.line).map((t) => ({ section: c.section, t }))));
  for (const { section, t } of tokens) {
    const tok = t.replace(/[.,;:)]+$/, '').replace(/^\.\//, '');
    if (!tok || /[<>$*?`]/.test(tok) || tok.startsWith('-') || /^https?:/.test(tok)) continue;
    if (!(tok.includes('/') || /\.[A-Za-z0-9]{1,6}$/.test(tok))) continue;
    const t2 = refTarget(tok, proc.repos);
    if (t2.kind !== 'path' || !roots[t2.repo] || !exists(join(roots[t2.repo], t2.path))) continue;
    if (has(t2.repo, t2.path) || seen.has(tok)) continue;
    seen.add(tok);
    out.push(tok + ' (in ' + section + ') is not in References');
  }
  return out;
}

/* ---- the PC half of the board's procedure verbs ------------ */

const sameDir = (a, b) => relativeTo(a, b) === '';
/* A card is this repo's by its remote when both carry one, else by its path. */
const ofRepo = (front, repo) => !!repo && front.projectRepo === repo;

/* A folder's checkouts and remote, read off the event loop and kept a short
   while, so a new worktree or a remote added later is seen. */
const PLACE_MS = 30000;
const places = new Map();
export function placeOf(dir) {
  const k = normPath(dir).toLowerCase();
  const hit = places.get(k);
  if (hit && Date.now() - hit.at < PLACE_MS) return hit.place;
  const place = (async () => {
    const [top, common] = await Promise.all([gitAsync(dir, ['rev-parse', '--show-toplevel']), gitAsync(dir, COMMON_DIR)]);
    const here = normPath(top || dir);
    const project = mainOf(here, common);
    return { project, here, repo: sharedName(project), homes: listedOf(await gitAsync(project, WORKTREES), project) };
  })();
  if (places.size > 200) places.clear();
  places.set(k, { at: Date.now(), place });
  return place;
}

/* the plugin's own cards for every project, read from the CLI's own root and
   judged against no project's git; null when that folder cannot be read, so nothing retires. */
export function everywhereFiles(root = pluginRoot) {
  let names;
  try { names = readdirSync(join(root, PROC_DIR)).filter((n) => n.endsWith('.md') && n !== 'README.md' && !n.startsWith('_')).sort(); } catch { return null; }
  return names.map((n) => ({ name: n, r: parseProcedure(readText(join(root, PROC_DIR, n)) || '', n) }))
    .filter((x) => x.r.ok && x.r.proc.everywhere).map((x) => ({ name: x.name, proc: x.r.proc, stale: [], warnings: [] }));
}

/* a card the board names only by its project, at this PC's folder for it;
   a name this PC has no folder for keeps none. An everywhere card is at the plugin's root. */
export function cardsMapped(cards, map = readMap(dataDir()), root = pluginRoot) {
  return (Array.isArray(cards) ? cards : []).map((c) => {
    if (c && c.everywhere) return { ...c, project: normPath(root), path: normPath(root) + '/' + c.doc };
    if (!c || c.project || !c.projectRepo) return c;
    const dir = folderHere(c.projectRepo, { map });
    return dir ? { ...c, project: dir, path: normPath(dir) + '/' + c.doc } : c;
  });
}

/* The board's cards as this folder sees them; `checkout: false` keeps the main checkout's paths. */
export async function cardsHere(cards, dir, { checkout = true } = {}) {
  const g = await placeOf(dir);
  return boardCardsAt(cardsMapped(cards), { ...g, here: checkout ? g.here : g.project, hasDoc: (doc) => exists(join(g.here, doc)) });
}

/* proc scan: this PC reads and judges the files, the board makes, follows and retires the cards. */
export async function scanOnBoard(dir, call, actor) {
  const g = await placeOf(dir);
  const mine = cardsOfProject(await call('procedureCards', {}), g);
  let names = [];
  try { names = readdirSync(join(g.project, PROC_DIR)).filter((n) => n.endsWith('.md') && n !== 'README.md' && !n.startsWith('_')).sort(); } catch {}
  /* the plugin's own checkouts leave their everywhere files to the plugin root's read below */
  const plugin = sameDir(g.project, pluginRoot) || g.repo === sharedName(pluginRoot);
  const files = names.map((n) => {
    const r = parseProcedure(readText(join(g.project, PROC_DIR, n)) || '', n);
    if (!r.ok) return { name: n, errors: r.errors };
    if (r.proc.everywhere) return plugin ? null : { name: n, errors: ['everywhere: true is read only from the AskerDo plugin\'s own ' + PROC_DIR + ', so this file has no card'] };
    const card = cardForFile(mine, r.proc.slug, n);
    return { name: n, proc: r.proc, stale: judge(g.project, r.proc, (card && card.verified) || {}), warnings: lint(g.project, r.proc) };
  }).filter(Boolean);
  const everywhere = everywhereFiles();
  return call('scanProject', {
    project: g.project, repo: g.repo, homes: g.homes, head: headOf(g.project) || '', files, ...(everywhere ? { everywhere, pluginVersion: pluginVersion() } : {}),
  }, actor);
}

/* the plugin's own repo as a shared name, from its manifest */
function pluginRepo() {
  try { return normRemote(JSON.parse(readText(join(pluginRoot, '.claude-plugin', 'plugin.json')) || '{}').repository); } catch { return ''; }
}

/* proc ran: the card from the board (a scan first when it is missing), HEAD and staleness read here. */
export async function ranOnBoard(dir, name, result, note, call, actor) {
  const g = await placeOf(dir);
  const find = async () => findCardIn(cardsMapped(await call('procedureCards', {})), name, { project: g.project, repo: g.repo });
  let card = await find();
  if (!card) { await scanOnBoard(dir, call, actor); card = await find(); }
  if (!card) throw new UsageError('no procedure named ' + name + ' in ' + g.project + ': proc scan reads a project\'s ' + PROC_DIR);
  const mine = sameDir(g.project, card.project) || ofRepo(card, g.repo);
  /* a card this PC has no folder for reads no file and no heads here */
  if (!mine && !card.project) throw new UsageError(card.id + ' is a procedure of ' + unmappedLine(card.projectRepo || card.id));
  const base = mine ? g.project : card.project;
  const file = join(base, card.doc);
  const parsed = parseProcedure(readText(file) || '', card.slug + '.md');
  const verified = { ...(card.verified || {}) };
  const heads = {};
  /* an everywhere card is no project's files, so a run moves no commit and judges none */
  if (result === 'clean' && !card.everywhere) {
    for (const [k, d] of Object.entries(rootsOf(base, parsed.ok ? parsed.proc : { repos: card.repos || {} }))) {
      const h = headOf(k === 'self' ? (mine ? g.here : base) : d);
      if (h) { heads[k] = h; verified[k] = h; }
    }
  }
  const stale = !parsed.ok ? [exists(file) ? 'the file does not parse: ' + parsed.errors[0] : 'gone: ' + card.doc]
    : card.everywhere ? [] : judge(base, parsed.proc, verified);
  /* a PR-n goes as typed, so the board resolves the label's live holder */
  const sent = /^pr-\d+$/i.test(String(name || '').trim()) ? String(name).trim() : card.key || card.id;
  /* an everywhere card is read from the installed copy but fixed in this PC's
     checkout of the plugin's repo; with none here, no folder, and the board names the repo */
  const source = card.everywhere ? pluginRepo() : '';
  const fixAt = card.everywhere ? (source && folderHere(source, { cwd: dir, dir: dataDir() })) || '' : base;
  return call('recordRun', { name: sent, result, note, project: g.project, repo: g.repo, base: fixAt, heads, stale,
    ...(card.everywhere && !fixAt && source ? { source } : {}) }, actor);
}

