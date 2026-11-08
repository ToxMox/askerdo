#!/usr/bin/env node
/* the proposal turned into the apply plan. Each step is one CLI call (args, plus
   stdin JSON or a body file); `@{id}` names the id an earlier step made. Folders and the CLAUDE.md ledger
   give the repo side, which the handover makes after the write.
   node plan.mjs <work dir> [--go --session <own id>]   (reads proposal.json, facts.json and manifest.json, writes plan.json) */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { globRe } from '../../lib/proc-match.mjs';
import { stateProblems } from '../../server/handoff-text.mjs';
import { RULE_TEXT, SETTINGS } from '../../server/verbs/profile-rules.mjs';
import { citer, fencedLines, folderRe, inText, isGlob, kebab, linksIn, MD, printed, resolveFrom, UP_PATH, wrapLead } from './cites.mjs';
import { clauseId, coveredBy, evidenceOf, linesHold, seedCovers } from './map.mjs';
import { sameSubject } from './survey.mjs';

const STATE_BYTES = 10240;
const LINE_MAX = 400;
const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const clip = (s, n) => { const t = oneLine(s); return t.length > n ? t.slice(0, n - 3) + '...' : t; };
const bytes = (s) => Buffer.byteLength(s, 'utf8');
const ref = (id) => '@{' + id + '}';
/* an import's inbox task names its wake; apply fills this with a day 14 days from the write */
export const WAKE_REF = 'wake';
const list = (v) => (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v]);
const ownerOf = (source) => String(source || '').split(' on ')[0];
/* a board line's slug a kept rule can take (a setting such as tests.policy is no slug) */
const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;
const DETAIL = / ?[(]detail: [A-Z]+-[0-9]+[)]/g;
/* the root instruction files Claude reads at the start, in the order the AskerDo section takes one (never CLAUDE.local.md, which is private) */
const ROOT_FILES = ['CLAUDE.md', '.claude/CLAUDE.md', 'AGENTS.md', '.claude/AGENTS.md'];
/* a folder path as the handover and the repoint compare it: forward slashes, no trailing slash */
export const folderKey = (p) => String(p || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
export const under = (file, folder) => { const f = folderKey(folder); const x = folderKey(file); return x === f || x.startsWith(f + '/'); };

/* Where an item came from and its date, said in the record's own text (the CLI keeps created, not updated or closed). */
export function fromLine(item) {
  const s = item.source || {};
  const f = item.fields || {};
  const at = (s.file || 'the old system') + (s.line ? ' line ' + s.line : '') + (s.commit ? ' (commit ' + s.commit + ')' : '');
  const date = f.date || f.created;
  return 'From the old system: ' + at + (date ? ', ' + date : '') + (f.closed ? '; done there by ' + f.closed : '') + '.';
}

function wrap(line) {
  if (line.length <= LINE_MAX) return [line];
  const out = [];
  let rest = line;
  while (rest.length > LINE_MAX) {
    let cut = rest.lastIndexOf(' ', LINE_MAX);
    if (cut < LINE_MAX / 2) cut = LINE_MAX;
    out.push(rest.slice(0, cut).trimEnd());
    rest = '  ' + rest.slice(cut).trimStart();
  }
  out.push(rest);
  return out;
}

/* An old handoff's text as a handoff state: long lines wrapped, a "Next" list and a
   "Where we were" heading renamed so the board reads them as history, cut at 10 KB. */
export function historyState(text, where) {
  const tail = '(cut at 10 KB: the whole text is ' + where + ')';
  let lines = String(text || '').replace(/\r\n/g, '\n').trim().split('\n').flatMap(wrap).map((l) => {
    const bare = l.replace(/^#{1,6}\s*/, '').replace(/[*_:]/g, '').trim();
    if (l.trim() === '## Where we were') return '## Where we were (old handoff)';
    return bare.length <= 40 && /\bnext\b/i.test(bare) ? l.replace(/\s*$/, ' (as the old handoff had it)') : l;
  });
  if (!lines.join('').trim()) lines = ['(empty at this version)'];
  let state = lines.join('\n');
  if (bytes(state) > STATE_BYTES) {
    const keep = [];
    let n = bytes(tail) + 2;
    for (const l of lines) { if (n + bytes(l) + 1 > STATE_BYTES) break; keep.push(l); n += bytes(l) + 1; }
    state = keep.join('\n') + '\n' + tail;
  }
  const left = stateProblems(state, { state: STATE_BYTES, line: LINE_MAX });
  return left.length ? '(this version did not fit a handoff: ' + clip(left.join('; '), 300) + '; read ' + where + ')' : state;
}

/* the board reads a bare Q-and-number token in a question's prose as one of its own
   records, so an old queue's labels become the old question's title; one in a file name passes. */
const bareTitle = (s) => String(s || '').replace(/^Q\d+(-|\s+)/, '').replace(/\.md$/, '').replace(/-/g, ' ').trim();
export function oldTitles(items) {
  const out = new Map();
  for (const r of items) {
    const m = /^(\.claude\/questions\/[^/]+)\/Q(\d+)-/.exec((r.source && r.source.file) || '');
    if (m) out.set(m[1] + '#' + m[2], bareTitle((r.fields && r.fields.name) || r.title) || 'old question ' + m[2]);
  }
  return out;
}
/* a label heading a file name (`Q1-take.md`) is left as it is, as the board's inPath reads it */
export function unlabel(text, titles, folder) {
  const named = (dir, n) => '"' + (titles.get(dir + '#' + n) || 'old question ' + n) + '"';
  return String(text ?? '').replace(/(^|[^\\/.\w])Q(\d+)\b(?!-[a-z]|\.[A-Za-z0-9])/g, (m, pre, n) => pre + (folder ? named(folder, n) : 'old question ' + n));
}

export function gitReader(dir) {
  return (v) => {
    if (!v.commit) { try { return readFileSync(join(dir, v.path), 'utf8'); } catch { return ''; } }
    const r = spawnSync('git', ['show', v.commit + ':' + v.path], { cwd: dir, encoding: 'utf8', windowsHide: true, maxBuffer: 64 << 20 });
    return r.status === 0 ? r.stdout : '';
  };
}

/* What a call is about, for the map: its own subjects, else the sources of the items and the folders its options name. */
function subjectsOf(c, byId) {
  const out = new Set(list(c.subjects).map((p) => String(p).replace(/\\/g, '/')));
  if (!out.size) {
    for (const o of c.options || []) {
      const e = o.effect || {};
      for (const id of [...list(e.keep), ...list(e.drop)]) { const f = byId.get(id) && byId.get(id).source && byId.get(id).source.file; if (f) out.add(f); }
      for (const x of list(e.add)) if (x && x.source && x.source.file) out.add(x.source.file);
      for (const path of Object.keys(e.folders || {})) out.add(folderKey(path) + '/');
    }
  }
  return [...out].sort();
}

/* The option a call's answer names: a letter, or { letter } / { pick } / { option }. */
const answerLetter = (a) => (typeof a === 'string' ? a.trim() : a && typeof a === 'object' ? String(a.letter || a.pick || a.option || '').trim() : '');

/* a call with one option keeping a folder and another converting what it holds asks whether the old way
   converts, which the card settles; a private source's call keeps or drops its items and ends no folder */
export function keepOrConvert(c, byId, privateFiles = new Set()) {
  const own = (p) => /^[A-Za-z]:[\\/]|^[\\/~]/.test(String(p)) || privateFiles.has(folderKey(p)) || /(^|\/)CLAUDE\.local\.md$/i.test(folderKey(p));
  const opts = c.options || [];
  for (const o of opts) {
    for (const [path, end] of Object.entries((o.effect || {}).folders || {})) {
      if (end !== 'keep' || own(path)) continue;
      for (const p of opts) {
        if (p === o) continue;
        const e = p.effect || {};
        const from = [...list(e.add), ...list(e.keep).map((id) => byId.get(id))].filter((x) => x && x.source && x.source.file && under(x.source.file, path));
        if (from.length) return { folder: path, keeps: o.letter, converts: p.letter, items: from.length };
      }
    }
  }
  return null;
}

/* Each answered call's effect on the items and folders, and the calls still waiting:
   { items, folders, waiting, answers }. The proposal itself is never changed. */
export function answerCalls(proposal) {
  const items = (proposal.items || []).map((x) => ({ ...x, fields: { ...(x.fields || {}) } }));
  const folders = (proposal.folders || []).map((x) => ({ ...x, evidence: { ...(x.evidence || {}) } }));
  const byId = new Map(items.map((x) => [x.id, x]));
  const privateFiles = new Set(((proposal.instructions && proposal.instructions.files) || []).filter((x) => x.private).map((x) => folderKey(x.file)));
  const waiting = [];
  const answers = [];
  for (const c of proposal.calls || []) {
    const kc = keepOrConvert(c, byId, privateFiles);
    if (kc) {
      waiting.push({ call: c.id, ask: c.ask, pick: c.pick || null, notACall: true, why: 'not the user\'s call: option ' + kc.keeps + ' keeps ' + kc.folder + ' while option ' + kc.converts + ' converts '
        + kc.items + ' item' + (kc.items > 1 ? 's' : '') + ' from it; whether a piece of the old workflow converts is never a call (the onboard card, step 4, `calls`): convert it, or keep it with a reason of a named shape and its evidence, and take the call out' });
      continue;
    }
    if (c.answer === null || c.answer === undefined || c.answer === '') { waiting.push({ call: c.id, ask: c.ask, pick: c.pick || null, why: 'no answer yet' }); continue; }
    const letter = answerLetter(c.answer);
    const opt = (c.options || []).find((o) => o.letter === letter);
    if (!opt) { waiting.push({ call: c.id, ask: c.ask, pick: c.pick || null, why: 'its answer names no option (' + clip(JSON.stringify(c.answer), 60) + ')' }); continue; }
    answers.push({ call: c.id, ask: c.ask, letter, label: opt.label, subjects: subjectsOf(c, byId), ...(c.answeredBefore ? { before: true } : {}) });
    const e = opt.effect || {};
    for (const id of list(e.keep)) { const x = byId.get(id); if (x) { x.cut = false; x.answeredBy = c.id; } }
    for (const id of list(e.drop)) { const x = byId.get(id); if (x) { x.cut = true; x.dropped = c.id; } }
    /* an option's own items (a dormant plan kept, a doctor fix with its pick) join the proposal's */
    for (const x of list(e.add)) if (x && x.id && !byId.has(x.id)) { const y = { ...x, fields: { ...(x.fields || {}) }, answeredBy: c.id }; items.push(y); byId.set(y.id, y); }
    for (const [path, end] of Object.entries(e.folders || {})) {
      let f = folders.find((x) => folderKey(x.path) === folderKey(path));
      if (!f) folders.push(f = { path, role: 'machinery', why: 'named by the answer to ' + c.id, evidence: {} });
      f.end = end;
      f.answeredBy = c.id;
    }
    /* an answer about the items of a folder (kept, dropped or added) answers the dormant-work call for that folder */
    for (const id of [...list(e.keep), ...list(e.drop), ...list(e.add).map((x) => x && x.id)]) {
      const file = byId.get(id) && byId.get(id).source && byId.get(id).source.file;
      for (const f of folders) if (file && under(file, f.path) && !f.answeredBy) f.answeredBy = c.id;
    }
  }
  return { items, folders, waiting, answers };
}

export class WaitingError extends Error {
  constructor(waiting) {
    super(waiting.length + ' calls still wait on the user: ' + waiting.map((w) => w.call + ' (' + w.why + ')').join('; '));
    this.waiting = waiting;
  }
}

/* the globs a `.claude/rules` file's `paths:` menu loads it on, by file, from the facts' rule files. In
   a menu whose lines narrow its globs, a body takes those of the lines naming it, and one whose lines name only an
   intent takes none, left to the session's scopes; a menu whose lines narrow none, or one `dir` cannot read, gives its
   bodies its own `paths:` */
export function scopesOf(ruleFiles, dir = null) {
  const out = {};
  const put = (file, globs) => { if (globs.length) out[file] = [...new Set([...(out[file] || []), ...globs.map(String)])]; };
  const menus = new Map();
  for (const e of ruleFiles || []) for (const l of e.loads || []) {
    if (l.by === 'rules') put(e.file, list(l.paths));
    else if (l.by === 'menu') { const at = String(l.from || '').lastIndexOf(':'); const m = String(l.from).slice(0, at); menus.set(m, [...(menus.get(m) || []), { file: e.file, n: Number(String(l.from).slice(at + 1)), paths: list(l.paths).map(String) }]); }
  }
  for (const [m, rows] of menus) {
    const paths = rows[0].paths;
    let lines = null;
    try { if (dir) lines = readFileSync(join(dir, m), 'utf8').split(/\r?\n/); } catch { lines = null; }
    const said = lines ? rows.map((r) => lineGlobs(lines[r.n - 1] || '', paths, dir)) : [];
    const narrows = said.some((s) => s.globs.length && !(s.globs.length === paths.length && s.globs.every((g) => paths.includes(g))));
    if (!narrows) { for (const r of rows) put(r.file, paths); continue; }
    /* an entry no line names goes to no body: a line naming only an intent says nothing of files */
    rows.forEach((r, i) => put(r.file, said[i].globs));
  }
  return out;
}
/* a menu line's globs: those written on it (a relative one rooted under the one menu folder holding it, one naming no
   folder here dropped) and the menu's entries whose literal part it names (`.shader`, `DocsService`, `src/api/`), less
   one a written glob narrows */
const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/* an entry's name as the words it ends in: a glob on ChartAPIHub ends in hub, apihub and chartapihub */
const nameEnds = (p) => {
  const segs = String(p).split('/').map((s) => s.split(/[*?[{]/).map((x) => x.replace(/\.[a-z][a-z0-9]{0,5}$/, '')).filter((x) => /[A-Za-z]/.test(x)));
  return (segs.filter((s) => s.length).pop() || []).flatMap((x) => {
    const w = x.match(/[A-Z]+(?![a-z])|[A-Z]?[a-z]+|\d+/g) || [];
    return w.map((_, i) => w.slice(i).join('').toLowerCase());
  });
};
function lineGlobs(line, paths, dir) {
  const text = String(line).replace(/(^|[\s([])\*\*([^*\s/][^*/]*?)\*\*/g, '$1$2');
  /* a slash list outside code ("Tide hub/updater") names each word's entry, so read it word by word; a path
     ("rule-bodies/sql.md", "src/api/") is no list */
  const words = new Set((text.replace(/`[^`]*`/g, ' ').match(/(?<![\w./-])[A-Za-z][\w-]*(?:\/[A-Za-z][\w-]*)+(?![\w/-]|\.\w)/g) || [])
    .flatMap((s) => s.split('/')).map((w) => w.toLowerCase().replace(/[^a-z0-9]/g, '')).filter((w) => w.length >= 3));
  const rooted = (g) => !/^[*?]/.test(g);
  const lit = (g) => g.split(/[*?[{]/)[0];
  const written = [...new Set((text.match(/[^\s`'"()[\]{},;|<>]*\*[^\s`'"()[\]{},;|<>]*/g) || []).map((g) => g.replace(/^\.\//, '').replace(/[.:]+$/, '')).filter((g) => /[/.]/.test(g)))]
    .map((g) => {
      const at = lit(g).replace(/[^/]*$/, '');
      if (!dir || !rooted(g) || !at || paths.some((p) => globRe(p).test(g)) || existsSync(join(dir, at))) return g;
      const under = paths.filter((p) => rooted(p) && lit(p).endsWith('/') && existsSync(join(dir, lit(p), at)));
      return under.length === 1 ? lit(under[0]) + g : null;
    }).filter(Boolean);
  const names = paths.filter((p) => {
    if (written.includes(p) || nameEnds(p).some((e) => words.has(e))) return true;
    const say = rooted(p) ? lit(p) : p.split(/[*?[{]/).map((s) => s.replace(/^\/+|\/+$/g, '')).sort((a, b) => b.length - a.length)[0];
    if (!say || say.length < 3) return false;
    const left = rooted(p) ? '(?<![\\w/.%-])' : /^\w/.test(say) ? '(?<![\\w-])' : '';
    return new RegExp(left + escRe(say) + (/\w$/.test(say) ? '(?!\\w)' : '')).test(text);
  });
  return { globs: [...new Set([...written, ...names.filter((p) => !written.some((w) => w !== p && globRe(p).test(w)))])] };
}

/* the session's word on a cite outside running text, by file, then `of` and `line` when given:
   { file, line, of, do: 'note' | 'leave' | 'point', to } */
export const citeJudge = (cites) => (file, line, of) => list(cites).find((c) => c && folderKey(c.file) === file && (!c.of || c.of === of) && (!c.line || Number(c.line) === line)
  && (c.do === 'note' || c.do === 'leave' || (c.do === 'point' && c.to))) || null;
/* the cites in files that stay that the repoint would give a git note outside running text, as it reads them: a
   file or folder that goes with git keeping it, never a track's file, a glob, a fence, or a script the unhook takes out */
function bareCites(dir, folders, idmap, items, headsOf, runs, rewritten = () => false) {
  const going = folders.filter((f) => f.end === 'delete' || f.end === 'retire').map((f) => folderKey(f.path)).filter(Boolean);
  const git = (args, input) => spawnSync('git', ['-c', 'core.quotepath=false', ...args], { cwd: dir, encoding: 'utf8', windowsHide: true, maxBuffer: 256 << 20, ...(input === undefined ? {} : { input }) });
  const ls = going.length ? git(['ls-files', '-z']) : null;
  if (!ls || ls.status !== 0) return [];
  const tracked = ls.stdout.split('\0').filter(Boolean);
  const goes = (f) => going.some((g) => under(f, g));
  const gone = tracked.filter(goes);
  const bases = new Map();
  for (const f of tracked) { const b = f.split('/').pop(); bases.set(b, (bases.get(b) || 0) + 1); }
  const own = (f) => items.filter((x) => x.source && x.source.file === f);
  const pieces = gone.map((f) => ({ file: f, bare: bases.get(f.split('/').pop()) === 1, ...(own(f).length ? { heads: headsOf(f), entries: own(f).map((x) => x.fields && x.fields.entry).filter(Boolean) } : {}) }));
  /* a `../` path into a going folder names the folder's last segment after a slash */
  const hit = git(['grep', '-l', '-I', '-z', '-F', '-f', '-'], [...new Set([...going, ...going.map((g) => '/' + g.split('/').pop()), ...gone.map((f) => f.split('/').pop())])].join('\n') + '\n');
  const cites = citer(pieces);
  const folderRes = going.map((p) => ({ p, re: folderRe(p) }));
  const out = new Map();
  for (const f of String(hit.stdout || '').split('\0').filter((x) => x && !goes(x))) {
    let raw;
    try { raw = readFileSync(join(dir, f), 'utf8'); } catch { continue; }
    const lines = raw.split('\n').map((l) => l.replace(/\r$/, ''));
    const fenced = MD.test(f) ? fencedLines(lines) : new Set();
    const bare = (n, at, len, of, tool) => {
      const line = lines[n - 1] || '';
      if (runs.includes(of) || rewritten(f, n) || fenced.has(n - 1) || line[at - 1] === '!' || isGlob(line.slice(at, at + len), line.slice(at + len)) || line.slice(at + len).startsWith(' (in git at ')) return;
      if (!inText(line, at, len, tool || printed(line, at, f), MD.test(f) ? wrapLead(lines, n - 1) : '')) out.set(f + '#' + n + '#' + at, { file: f, line: n, of, text: line.trim() });
    };
    for (const h of cites(raw, f)) if (['path', 'name'].includes(h.form) || (h.form === 'section' && !h.anchor)) if (!(idmap[h.of] && idmap[h.of].kind === 'track')) bare(h.line, h.at, h.match.length, h.of, h.tool);
    lines.forEach((l, i) => { for (const { p, re } of folderRes) if (l.includes(p)) for (const m of l.matchAll(re)) { const q = m[0].replace(/^\.\//, '').replace(/[.]+$/, ''); bare(i + 1, m.index, m[0].indexOf(q) + q.length, q, false); } });
    /* a path climbing out of its file's folder, read from there as the repoint reads it; a link's target is running
       text to the repoint, never a value */
    lines.forEach((l, i) => {
      if (!l.includes('../')) return;
      const links = MD.test(f) ? linksIn(l) : [];
      for (const m of l.matchAll(UP_PATH)) {
        const r = links.some((k) => m.index >= k.at && m.index < k.tEnd) ? null : resolveFrom(f, m[0]);
        if (r && goes(r)) bare(i + 1, m.index, m[0].length, r, false);
      }
    });
  }
  return [...out.values()];
}
/* a nested instruction file's clauses hold in its folder, whether Claude reads it there or another
   agent does */
export function nestedScopes(instructions, ruleFiles = []) {
  const out = {};
  for (const x of (instructions && instructions.files) || []) {
    const at = String(x.file || '').replace(/\\/g, '/').replace(/\/?(?:\.claude\/)?[^/]+$/, '');
    if (at) out[x.file] = [at + '/**'];
  }
  /* a file only nested instruction files point at or import holds where they do */
  for (const e of ruleFiles || []) {
    const by = (e.loads || []).map((l) => (l.by === 'pointer' || l.by === 'import') && out[String(l.from || '').replace(/:\d+$/, '')]);
    if (by.length && by.every(Boolean) && !out[e.file]) out[e.file] = [...new Set(by.flat())];
  }
  return out;
}

/* the hooks, commands, skills, servers and rules menus that load each rule file, by file; a
   settings file's hook entry or an .mcp.json server entry is the unhook's, never a loader here */
const LOADERS = ['hook', 'command', 'skill', 'server', 'menu'];
const ownLoad = (l) => !l.from || l.event || l.server;
export function loadersOf(ruleFiles) {
  const out = {};
  for (const e of ruleFiles || []) {
    const by = [...new Set((e.loads || []).filter((l) => LOADERS.includes(l.by) && !ownLoad(l)).map((l) => String(l.from).replace(/:\d+$/, '')))];
    if (by.length) out[e.file] = by;
  }
  return out;
}
/* the other ways each file reaches a session, which outlive its loaders: the harness's own load ('harness': a rules
   file, skill, command, agent, settings, a script the settings run) and each instruction file's pointer or import */
export function reachOf(ruleFiles) {
  const out = {};
  for (const e of ruleFiles || []) {
    const by = [...new Set((e.loads || []).flatMap((l) => (ownLoad(l) ? ['harness'] : l.by === 'pointer' || l.by === 'import' ? [String(l.from)] : [])))];
    if (by.length) out[e.file] = by;
  }
  return out;
}
/* the scripts the settings and .mcp.json run, each with what runs it */
export function runsOf(ruleFiles) {
  const out = {};
  for (const e of ruleFiles || []) {
    const r = (e.loads || []).filter((l) => l.event || l.server).map((l) => (l.event ? l.event + ' hook' : 'server ' + l.server));
    if (r.length) out[e.file] = [...new Set(r)];
  }
  return out;
}

/* The project and the board's records come from the survey's facts, so the session's proposal need not copy them;
   so do the instruction files Claude reads (where the AskerDo section goes) and the rule files' path menus. */
export function withFacts(proposal, facts) {
  if (!facts) return proposal;
  const p = facts.project || {};
  const dir = p.dir || p.path;
  const project = proposal.project || (dir ? { dir, slug: p.slug || kebab(basename(dir), 30), ...(p.remote ? { remote: p.remote } : {}), ...(p.shared ? { shared: p.shared } : {}) } : undefined);
  const conversion = proposal.map || facts.conversion || null;
  const before = new Map(((conversion && conversion.calls) || []).filter((c) => c.state === 'unchanged' && c.answer).map((c) => [c.call, c.answer]));
  const calls = proposal.calls && before.size ? proposal.calls.map((c) => (c.answer === null || c.answer === undefined || c.answer === '') && before.has(c.id)
    ? { ...c, answer: before.get(c.id), answeredBefore: true } : c) : proposal.calls;
  /* a large project's rule files and nested ledgers are in facts-rules.json */
  const split = facts.ruleFiles && !Array.isArray(facts.ruleFiles) && facts.ruleFiles.file ? readJsonFile(facts.ruleFiles.file) || {} : null;
  const rf = Array.isArray(facts.ruleFiles) ? facts.ruleFiles : split ? split.ruleFiles : null;
  const instructions = proposal.instructions || facts.instructions || null;
  const scopes = proposal.scopes || { ...nestedScopes(instructions, rf), ...(rf ? scopesOf(rf, dir) : {}) };
  const loaders = proposal.loaders || (rf ? loadersOf(rf) : null);
  /* every clause of every instruction file, and the rule files a session reads as text, loaded or
     not, since a load the survey misses still carries rules */
  const ledgerFacts = [...(Array.isArray(facts.claude) ? facts.claude : []), ...((split && Array.isArray(split.claude) && split.claude) || [])];
  const more = { ...(rf ? { reach: reachOf(rf), runs: runsOf(rf), textFiles: rf.filter((e) => TEXT.test(e.file)).map((e) => e.file) } : {}),
    ...(ledgerFacts.length ? { ledgerFacts } : {}) };
  return { ...proposal, ...(project ? { project } : {}), board: proposal.board || facts.board || {}, ...(conversion ? { map: conversion } : {}), ...(calls ? { calls } : {}),
    ...(instructions ? { instructions } : {}), ...(scopes && Object.keys(scopes).length ? { scopes } : {}), ...(loaders && Object.keys(loaders).length ? { loaders } : {}), ...more };
}
const readJsonFile = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
const TEXT = /\.(md|markdown|txt)$/i;
/* facts.json, with facts-board.json's records joined to its board when this survey split them out (an older
   survey's file would put stale rulings over the inline ones) */
export function readFacts(work) {
  const facts = readJsonFile(join(work, 'facts.json'));
  const split = facts && facts.board && facts.board.rulings;
  const more = split && existsSync(join(work, 'facts-board.json')) ? readJsonFile(join(work, 'facts-board.json')) : null;
  if (facts && more) facts.board = { ...(facts.board || {}), ...more };
  return facts;
}

/* facts.json against the work folder's newest write, undo or handover: facts made before it miss what that run
   made or took back, so a plan on them would write it again. A reason, or null. */
export function staleFacts(facts, manifest) {
  const made = facts && facts.made;
  if (!made || !manifest) return null;
  const times = (manifest.imports || []).flatMap((i) => [i.at, i.done, i.undone, ...(i.steps || []).map((s) => s.undoneAt), ...(i.repo || []).map((e) => e.at)]).filter(Boolean).sort();
  const last = times.pop();
  return last && last > made ? 'facts.json was made ' + made + ', before the write, undo or handover of ' + last + ' in manifest.json: run the survey (or the doctor) again' : null;
}
/* an undo part way (its withdraw request waiting on the press, or a refused step) leaves its import open with its map
   rows, which still hold the sources of the records it dropped, and a later undo would take the redo's import. A reason, or null. */
export function undoWaits(manifest) {
  const open = ((manifest && manifest.imports) || []).filter((i) => !i.undone && (i.steps || []).some((s) => s.undoneAt));
  return open.length ? 'the undo of ' + open.map((i) => i.plan || i.at).join(', ') + ' is part way (its withdraw request waits on the user\'s press, or a step was refused): run the undo again after the press, then the survey' : null;
}

/* proposal.json to the plan: { steps, cards, folders, claude, pending, left, covered, counts, idmap }.
   Refuses (WaitingError) while a call has no answer. `readVersion(v)` gives an old handoff's text at a
   version (git show by default); `readFile(path)` a source file's text (for its headings). An item whose source the
   conversion map (proposal.map, from the facts) holds unchanged is covered by the records it became. */
export function buildPlan(proposal, { readVersion, readFile, session } = {}) {
  const { waiting, items, folders, answers } = answerCalls(proposal);
  if (waiting.length) throw new WaitingError(waiting);
  const { dir, slug, remote } = proposal.project;
  const shared = remote || proposal.project.shared;
  const label = 'import:' + slug;
  const read = readVersion || gitReader(dir);
  const readSrc = readFile || ((p) => { try { return readFileSync(join(dir, p), 'utf8'); } catch { return null; } });
  const board = proposal.board || {};
  const steps = [];
  const pending = [];
  const left = [];
  const covered = [];
  const unlinked = [];
  const add = (s) => { steps.push({ n: steps.length + 1, ...s }); return s; };
  /* the session on the writes that use it only to name who wrote them; never on track new
     (the session would hold every imported track) or handoff write (it lets go of the session's tasks in hand) */
  const by = session ? ['--session', session] : [];
  const bySession = session ? { session } : {};
  const pend = (r, why) => pending.push({ item: r.id, title: r.title, why });
  const dateOf = (r) => (r.fields && (r.fields.date || r.fields.created)) || null;
  const textOf = (r) => String(r.text || r.title || '');
  const goneFolders = folders.filter((f) => f.end === 'delete' || f.end === 'move' || f.end === 'retire').map((f) => folderKey(f.path)).filter(Boolean);
  /* a hook, command or skill that loads what goes retires in the same run, or it stays to load nothing */
  const leaving = folders.filter((f) => f.end === 'delete' || f.end === 'retire');
  const leaves = (p) => leaving.some((f) => under(p, f.path));
  const stranded = new Map();
  /* a loader kept with `repoint: true` stays, and the handover points its cites at what the files became */
  const repointed = new Map();
  const repoints = (l) => folders.some((f) => (f.end || 'keep') === 'keep' && f.repoint && under(l, f.path));
  for (const [file, by] of Object.entries(proposal.loaders || {})) if (leaves(file)) for (const l of by.filter((x) => !leaves(x))) { const m = repoints(l) ? repointed : stranded; m.set(l, [...(m.get(l) || []), file]); }
  const some = (files) => files.slice(0, 3).join(', ') + (files.length > 3 ? ' and ' + (files.length - 3) + ' more' : '');
  for (const [l, files] of stranded) pending.push({ item: 'loader:' + l, title: l, why: 'it loads ' + some(files)
    + (files.length > 1 ? ', which go' : ', which goes') + ' in this run: give it the end retire in the same run, keep what it loads, or keep it with `repoint: true` so the handover points its cite at the record or card the rule became' });
  /* a script the settings run that loads nothing may enforce (a formatter, a guard): it never leaves unseen with its folder */
  const loading = new Set(Object.values(proposal.loaders || {}).flat());
  for (const [script, how] of Object.entries(proposal.runs || {})) {
    const unit = leaving.find((f) => under(script, f.path));
    if (!unit || leaving.some((f) => folderKey(f.path) === script) || loading.has(script)) continue;
    pending.push({ item: 'hook:' + script, title: script, why: 'it runs as ' + how.join(', ') + ' and loads no file the facts list, so it may enforce (a formatter, a guard), and it would go with '
      + folderKey(unit.path) + '/ and its settings entry with it: keep it (shape tool) and retire the loaders beside it file by file, give it an end of its own when it goes too, or name what it loads in `loaders`' });
  }
  /* a rerun never writes an item twice: a board record's onboard: ref holds its item, and the map holds a source
     unchanged since its run (or seeded by an earlier import) with the records it became */
  const heldBy = new Map();
  /* a record an undo took back (dropped, closed, withdrawn) holds nothing, so the rerun writes its item again */
  const undone = (r) => ['dropped', 'closed', 'withdrawn'].includes(r.status);
  for (const r of board.imported || []) if (!undone(r)) for (const x of r.refs || []) if (String(x).startsWith('onboard:')) heldBy.set(String(x).slice(8), r.id);
  const mapped = coveredBy(proposal.map);
  /* the AskerDo section goes in the instruction file Claude reads at the root, AGENTS.md when it reads that
     alone; none when it reads none there; older facts name no files, so CLAUDE.md */
  const instr = proposal.instructions;
  const section = !instr ? 'CLAUDE.md' : ROOT_FILES.find((f) => (instr.files || []).some((x) => x.file === f && x.read === 'start')) || null;
  const ledgerOf = (c) => String(c.file || section || 'CLAUDE.md').replace(/\\/g, '/');
  /* every clause of every instruction file takes a fate; one the proposal leaves out waits and joins its
     ledger with none, so coverage holds the rewrite too, unless an earlier run kept it on evidence that still holds */
  const foldW = (s) => oneLine(s).replace(/[`*_]/g, '').toLowerCase();
  const sameWords = (a, b) => { const x = foldW(a); const y = foldW(b); return x.includes(y.slice(0, 40)) || y.includes(x.slice(0, 40)); };
  const keptHolds = new Set(((proposal.map && proposal.map.judgments) || []).filter((j) => j.kind === 'clause' && j.fate === 'keep' && j.state === 'holds').map((j) => j.key));
  /* a private file's clauses ride its private source call, never a wait each; a file the map holds unchanged since
     an earlier run was converted then and is never opened again */
  const privateFiles = new Set(((instr && instr.files) || []).filter((x) => x.private).map((x) => String(x.file).replace(/\\/g, '/')));
  const settled = (f) => privateFiles.has(f) || (mapped.get(f) || {}).state === 'unchanged';
  const unfated = (proposal.ledgerFacts || []).map((fc) => ({ ...fc, file: String(fc.file || '').replace(/\\/g, '/') })).filter((fc) => fc.file && !settled(fc.file) && !keptHolds.has(clauseId(fc.file, fc.clause))
    && !(proposal.claude || []).some((c) => ledgerOf(c) === fc.file && Number(c.line) <= Number(fc.line) && Number(fc.line) <= Number(c.end || c.line) && sameWords(c.clause, fc.clause)));
  for (const fc of unfated) pending.push({ item: 'clause:' + fc.file + '#L' + fc.line, title: clip(fc.clause, 80), why: 'no fate in `claude`: keep it with its shape and evidence, carry it as a rule, split it, or drop it with its evidence' });
  /* the rule files that leave (deleted or retired: a moved file keeps its text), read whole by coverage so a
     block no item names is a gap. The `loaders` keys count too. A mapped one too, the lines its row's
     coverage passed named by the row; an older row (or a seed) was read by its own run */
  const proved = (f) => (mapped.get(f) || {}).lines;
  const readWhole = [...new Set([...(proposal.textFiles || []), ...Object.keys(proposal.loaders || {}).filter((f) => TEXT.test(f))])]
    .filter((f) => leaves(f) && (!mapped.has(f) || Array.isArray(proved(f))));
  const readNamed = Object.fromEntries(readWhole.filter((f) => (proved(f) || []).length).map((f) => [f, proved(f)]));
  /* the other way, a loader that goes while what it loads stays leaves that text behind without its load, unless
     the file still reaches a session (the harness loads it, a pointer whose clause stays, a loader that stays) or the
     proposal keeps it with its shape: then the file stays and its load goes */
  const clauseGoes = (at) => {
    const i = at.lastIndexOf(':');
    const n = Number(at.slice(i + 1));
    return (proposal.claude || []).some((c) => ledgerOf(c) === at.slice(0, i) && Number(c.line) <= n && n <= Number(c.end || c.line) && (c.fate === 'rule' || c.fate === 'drop'));
  };
  const reach = proposal.reach || {};
  const stillLoaded = (file) => (reach[file] || []).find((w) => w === 'harness' || !clauseGoes(w)) || (proposal.loaders[file] || []).find((l) => !leaves(l));
  const keptAs = (file) => folders.find((f) => (f.end || 'keep') === 'keep' && f.shape && under(file, f.path));
  const orphaned = new Map();
  const unloaded = [];
  for (const [file, by] of Object.entries(proposal.loaders || {})) {
    const going = by.filter(leaves);
    if (!going.length || goneFolders.some((g) => under(file, g))) continue;
    const still = stillLoaded(file);
    const kept = !still && keptAs(file);
    if (still || kept) unloaded.push({ file, loaders: going, why: kept ? 'kept (' + kept.shape + ')' : still === 'harness' ? 'the harness loads it' : 'still loaded by ' + still });
    else for (const l of going) orphaned.set(l, [...(orphaned.get(l) || []), file]);
  }
  for (const [l, files] of orphaned) pending.push({ item: 'retire:' + l, title: l, why: 'it goes in this run, but it loads ' + some(files) + (files.length > 1 ? ', which stay' : ', which stays')
    + ' with no other load: give ' + (files.length > 1 ? 'each' : 'it') + ' an end in the same run, or keep ' + (files.length > 1 ? 'each' : 'it') + ' with its shape (the file stays, its load goes)' });
  /* an instruction file's hash never holds its items: after the rewrite it holds only kept clauses, and one
     re-judged must be written */
  const ledgerFiles = new Set((proposal.claude || []).map(ledgerOf));
  const filesOf = (r) => (r.kind === 'track' && list(r.fields && r.fields.files).length ? list(r.fields.files) : r.source && r.source.file ? [r.source.file] : []).map((f) => String(f).replace(/\\/g, '/'));
  const mapHeld = (r) => {
    const fs = r.kind === 'fix' ? [] : filesOf(r);
    /* a file under a folder an earlier import's ref names is that folder's */
    const fits = (m) => m && seedCovers(m, r.kind) ? m : null;
    const rowOf = (f) => fits(mapped.get(f)) || [...mapped.values()].find((m) => m.source.endsWith('/') && f.startsWith(m.source) && seedCovers(m, r.kind));
    if (!fs.length || fs.some((f) => ledgerFiles.has(f)) || !fs.every(rowOf)) return null;
    /* only on the lines the row's coverage passed, so an item added for a gap, or one never written, is written */
    const s = r.source || {};
    const span = (f) => (s.line && String(s.file || '').replace(/\\/g, '/') === f ? [Number(s.line), Number(s.end || s.line)] : [1, Infinity]);
    if (!fs.every((f) => linesHold(rowOf(f), span(f), r.kind))) return null;
    const ids = [...new Set(fs.flatMap((f) => rowOf(f).records || []))];
    return ids.length ? ids.join(', ') : 'the map (' + fs.join(', ') + ')';
  };

  const onSubject = [...new Map([...(board.knowledge || []).filter((k) => !k.status || k.status === 'active').map((k) => [k.id, k.name]),
    ...(board.decisions || []).map((d) => [d.id, d.title])].filter(([id, title]) => id && title)).entries()].map(([id, title]) => ({ id, title }))
    /* the import's own records are its output, never a subject to judge against (a redo after the undo kept them) */
    .filter((x) => ![...heldBy.values()].includes(x.id));
  const workstreams = new Set((board.workstreams || []).map((w) => w.id));
  /* a fact's file triggers: the globs it names, and those of the `paths:` menu it came from, as written */
  const scopes = proposal.scopes || {};
  const globsOf = (r) => [...new Set([...list(r.fields && r.fields.files), ...(scopes[String((r.source && r.source.file) || '').replace(/\\/g, '/')] || [])].map(String))];
  /* a rule's scope is the files and commands it governs; its home keeps them */
  const commandsOf = (r) => [...new Set(list(r.fields && r.fields.commands).map(String))];
  const scopeSaid = (r) => [...globsOf(r), ...commandsOf(r).map((c) => '`' + c + '`')].slice(0, 4).join(', ');
  /* a rule's detail, when it has one, goes to a record made first, which its line or decision points at */
  const heldDetail = new Map();
  const detailStep = (r, title, globs = []) => {
    /* the undo keeps knowledge records, so a redo points at the detail the first write made, and coverage reads it */
    const had = heldBy.get(r.id + '@detail');
    if (had) { heldDetail.set(r.id, had); return had; }
    add({ id: r.id + '@detail', item: r.id, op: 'knowledge new', args: ['knowledge', 'new', '--type', 'gotcha', '--title', clip('Rule ' + title + ': the detail', 200),
      '--project', dir, '--label', label, '--label', 'rule-detail', '--ref', 'onboard:' + r.id + '@detail', ...globs.flatMap((g) => ['--file', g]), ...(dateOf(r) ? ['--created', dateOf(r)] : []), ...by],
    body: String(r.fields.detail).trim() + '\n\n' + fromLine(r) });
    return ref(r.id + '@detail');
  };
  /* a reconcile fix whose ref its record carries ran already (the undo keeps the ref while the amend stands), so its
     amend never lands twice */
  const refsOn = new Map([...(board.knowledge || []), ...(board.tasks || [])].map((x) => [x.id, (x.refs || []).map(String)]));
  const refDone = (r) => {
    const fx = (r.fields && r.fields.fix) || {};
    const a = list(fx.args);
    const i = a.indexOf('--add-ref');
    return i >= 0 && (refsOn.get(fx.target) || []).includes(String(a[i + 1])) ? fx.target : null;
  };
  const retrigger = [];
  const kept = [];
  const ids = new Set();
  for (const r of items) {
    /* the session writes the ids: steps, refs and reruns key on them, so each is there and once */
    if (!r.id || ids.has(r.id)) { pending.push({ item: r.id || null, title: r.title, why: r.id ? 'a second item with this id' : 'an item needs an id' }); continue; }
    ids.add(r.id);
    /* a handoff went with its track; a rule line already in force in the same words is that line */
    const along = r.kind === 'handoff' && r.fields.track && heldBy.get(r.fields.track);
    const words = r.kind === 'rule' ? oneLine(r.fields.text || r.text) : null;
    /* a written line carries its detail's pointer, which the item's words lack */
    const line = words && (board.rules || []).find((x) => x.source && x.source !== 'built in' && x.rule === (r.fields.slug || kebab(r.title || words)) && oneLine(String(x.text).replace(DETAIL, '')) === words);
    const byRecord = heldBy.get(r.id) || along || (line && ownerOf(line.source) + '/' + line.rule) || (r.kind === 'fix' && refDone(r));
    /* an item the session leaves out stays left out on a rerun, never counted as written by the map */
    const held = byRecord || (r.cut ? null : mapHeld(r));
    if (!r.covered && held) Object.assign(r, { covered: held, rerun: true, ...(byRecord ? {} : { viaMap: true }) });
    /* the map already holds a map-held item's source; one held by its record goes back on the map */
    if (r.covered) {
      covered.push({ item: r.id, by: r.covered, ...(r.rerun ? { rerun: true } : {}), ...(r.viaMap ? { map: true } : {}) });
      if (r.kind === 'knowledge' && !r.rerun && /^K-\d+$/.test(String(r.covered)) && globsOf(r).length) retrigger.push(r);
      continue;
    }
    if (r.cut) { left.push(r.id); continue; }
    const f = r.fields;
    if (r.kind === 'rule') {
      const words = oneLine(f.text || r.text);
      if (!words || words.length > LINE_MAX) { pend(r, 'a rule line needs words of at most 400 characters'); continue; }
      if (f.detail && words.length + 20 > LINE_MAX) { pend(r, 'its words and the pointer to its detail record pass 400 characters: shorter words'); continue; }
      const cites = goneFolders.find((p) => words.includes(p));
      if (cites) { pend(r, 'cites ' + cites + ', which this conversion retires: reword it'); continue; }
      /* a flat line rides every session and agent brief, so a scoped rule written as one loses its scope */
      if ((globsOf(r).length || commandsOf(r).length) && !oneLine(f.everywhere)) {
        pend(r, 'it holds only for ' + scopeSaid(r) + ': write it as a decision governing them or a card with those triggers (its detail a knowledge record), or give fields.everywhere the reason it holds everywhere');
        continue;
      }
    }
    if (r.kind === 'fix') {
      const fx = f.fix;
      if (f.info) continue;
      if (fx && fx.op === 'profile rule-add' && !fx.text) { pend(r, 'a rule line needs words of at most 400 characters'); continue; }
      if (!fx || !(fx.after || fx.args || fx.op === 'profile rule-add')) { pend(r, 'a fix needs words or a pick'); continue; }
    }
    if (!['rule', 'track', 'task', 'handoff', 'decision', 'question', 'knowledge', 'card', 'fix'].includes(r.kind)) { pend(r, 'its kind ' + JSON.stringify(r.kind) + ' has no home on the board'); continue; }
    /* a new record on the subject of one the board holds is judged before the go, never left for the next doctor run */
    if (r.kind === 'decision' || r.kind === 'knowledge') {
      const apart = [...list(f.apart), ...list(f.supersedes)].map(String);
      const near = onSubject.filter((x) => !apart.includes(x.id) && sameSubject(f.title || r.title, x.title));
      if (near.length) { pend(r, 'the board holds ' + near.map((x) => x.id + ' "' + clip(x.title, 80) + '"').join(', ') + ' on the same subject: covered by it, or name it in fields.apart'); continue; }
    }
    const named = r.kind === 'fix' ? null : f.workstream;
    if (named && workstreams.size && !workstreams.has(named)) { pend(r, 'its workstream ' + named + ' is none of the project\'s (' + [...workstreams].join(', ') + ')'); continue; }
    kept.push(r);
  }
  const keptIds = new Set(kept.map((r) => r.id));
  const of = (kind) => kept.filter((r) => r.kind === kind);

  /* the workstream: one already on the board is used as it is; else one is made for the project */
  let ws = (proposal.workstream && proposal.workstream.use) || heldBy.get('workstream');
  if (!ws) {
    const w = proposal.workstream || {};
    add({ id: 'workstream', item: null, op: 'ws create', args: ['ws', 'create'], stdin: {
      name: w.name || slug, description: oneLine(w.description || 'The ' + slug + ' project, converted from its old workflow.'), projects: [dir],
      labels: [label], refs: ['onboard:workstream'], ...bySession,
    } });
    ws = ref('workstream');
  }
  /* each item in its own workstream: the one it names, else its track's (a board track's or one this plan writes) */
  const boardTracks = new Map((board.tracks || []).map((t) => [t.id, t]));
  const BOARD_TRACK = /^TR-\d+$/;
  const wsOf = (r) => {
    const f = r.fields || {};
    if (f.workstream) return f.workstream;
    const t = f.track && (boardTracks.get(f.track) || kept.find((x) => x.kind === 'track' && x.id === f.track && x !== r));
    return (t && (t.workstream || (t.fields && t.fields.workstream))) || ws;
  };

  /* tasks, each dated by its line in the old list */
  const taskRefs = new Map();
  const made = [];
  for (const r of of('task')) {
    const f = r.fields;
    made.push(r);
    const t = f.track && keptIds.has(f.track) ? f.track : null;
    const onBoardTrack = !t && BOARD_TRACK.test(String(f.track || '')) && f.status !== 'completed' && f.status !== 'dropped' ? f.track : null;
    /* an import's task says where it goes; a later layout or edit places the ones on a track */
    add({ id: r.id, item: r.id, op: 'task create', args: ['task', 'create'], stdin: {
      unplaced: t || onBoardTrack ? 'imported; this plan lays it on its track next' : 'imported from a list that put it on no track', wake: ref(WAKE_REF),
      name: clip(f.name || r.title, 200), description: textOf(r) + '\n\n' + fromLine(r), ...(f.intent ? { intent: f.intent } : {}),
      workstream: wsOf(r), status: f.status === 'completed' ? 'completed' : f.status === 'dropped' ? 'dropped' : 'open', priority: f.priority || 'medium',
      labels: [label], refs: ['onboard:' + r.id], ...(dateOf(r) ? { created: dateOf(r) } : {}), ...bySession,
    } });
    if (onBoardTrack) add({ id: r.id + '@place', item: r.id, op: 'task edit', args: ['task', 'edit', ref(r.id), '--track', onBoardTrack, ...by] });
    if (t) { if (!taskRefs.has(t)) taskRefs.set(t, []); taskRefs.get(t).push({ ref: ref(r.id), open: f.status !== 'completed' && f.status !== 'dropped' }); }
  }

  /* a task's after (item ids, T-n ids, or a number naming the n-th task on its track, 1 first),
     before and runBy; an edge to an item this plan does not write is reported */
  const madeIds = new Set(made.map((r) => r.id));
  const ended = (r) => ['completed', 'dropped'].includes(r.fields.status);
  const groupOf = (r) => { const t = r.fields.track; return t && keptIds.has(t) ? t : null; };
  const edgeTo = (r, a) => {
    const grp = made.filter((x) => groupOf(x) === groupOf(r));
    const n = /^\d+$/.test(String(a).trim()) ? Number(a) : 0;
    const row = n ? grp[n - 1] : null;
    const s = row ? row.id : String(a).trim();
    if (/^T-\d+$/.test(s)) return s;
    if (madeIds.has(s) && s !== r.id) return ref(s);
    unlinked.push({ item: r.id, names: a, why: 'is no task this plan writes' });
    return null;
  };
  const orders = new Map();
  const order = (r) => {
    if (orders.has(r.id)) return orders.get(r.id);
    const f = r.fields;
    const o = { after: list(f.after).map((a) => edgeTo(r, a)).filter(Boolean), before: list(f.before).map((b) => edgeTo(r, b)).filter(Boolean), runBy: f.runBy ? String(f.runBy) : null };
    orders.set(r.id, o);
    return o;
  };
  const laid = new Set();
  const ordered = (r) => { const o = order(r); return o.after.length || o.before.length || o.runBy; };

  /* tracks: old handoff versions become its history, oldest first, then the live handoff */
  const madeTracks = new Set();
  const trackIds = new Set(of('track').map((r) => r.id));
  const handoffsOf = (t) => of('handoff').filter((h) => h.fields.track === t);
  for (const h of of('handoff').filter((x) => !trackIds.has(x.fields.track))) pend(h, 'its track ' + JSON.stringify(h.fields.track || null) + ' is no track this plan writes');
  const parks = [];
  const unparkArg = (r, w) => {
    const s = String(w).trim();
    if (/^T-\d+$/.test(s)) return 'task-completes ' + s;
    if (/^TR-\d+$/.test(s)) return 'track-ends ' + s;
    if (/^Q-\d+$/.test(s)) return 'question-answered ' + s;
    if (madeIds.has(s)) return 'task-completes ' + ref(s);
    if (trackIds.has(s) && s !== r.id) return 'track-ends ' + ref(s);
    unlinked.push({ item: r.id, names: s, why: 'is no task or track this plan writes', kind: 'Unpark' });
    return null;
  };
  for (const r of of('track')) {
    const f = r.fields;
    const tasks = taskRefs.get(r.id) || [];
    const hist = f.history || [];
    madeTracks.add(r.id);
    const files = f.files || (r.source && r.source.file ? [r.source.file] : []);
    const span = hist.length ? hist[0].at.slice(0, 10) + ' to ' + hist[hist.length - 1].at.slice(0, 10) : dateOf(r);
    const goal = f.goal || r.text;
    add({ id: r.id, item: r.id, op: 'track new', files, args: ['track', 'new', '--workstream', wsOf(r), '--name', clip(f.name || r.title, 120),
      '--goal', clip((goal ? goal + ' ' : '') + 'From the old system: ' + (files.join(', ') || 'its notes') + (span ? ', ' + span : '') + '.', 400),
      '--label', label, '--ref', 'onboard:' + r.id, ...tasks.flatMap((t) => ['--task', t.ref])] });
    /* the old list's order onto the track, so the ready set holds only what nothing waits on */
    const open = made.filter((x) => groupOf(x) === r.id && !ended(x));
    if (open.some(ordered)) {
      add({ id: r.id + '@layout', item: r.id, op: 'track layout', args: ['track', 'layout', ref(r.id)], stdin: { steps: open.map((x) => {
        const o = order(x);
        laid.add(x.id);
        return { task: ref(x.id), ...(o.after.length ? { after: o.after } : {}), ...(o.before.length ? { before: o.before } : {}), ...(o.runBy ? { runBy: o.runBy } : {}) };
      }) } });
    }
    const state = f.state || 'waiting';
    const reason = clip(f.parkReason || 'imported: parked in the old system', 300);
    const live = handoffsOf(r.id);
    hist.forEach((v, i) => {
      const parked = i === hist.length - 1 && !live.length && state === 'parked';
      const where = v.path + (v.commit ? ' at commit ' + v.commit : ' (uncommitted)');
      add({ id: r.id + '@' + (i + 1), item: r.id, op: 'handoff write', args: ['handoff', 'write', ref(r.id)], stdin: {
        focus: clip('From the old system: ' + v.path + ' as of ' + v.at.slice(0, 10) + (v.subject ? ' (' + v.subject + ')' : ''), 400),
        state: historyState(read(v), where), verifyFirst: [{ path: dir, ...(v.commit ? { commit: v.commit } : {}) }], created: v.at,
        ...(parked ? { status: 'parked', parkReason: reason } : {}),
      } });
    });
    /* the live handoff: where the work stands now, the track's newest handoff */
    live.forEach((h, i) => {
      const parked = i === live.length - 1 && state === 'parked';
      const where = (h.source && h.source.file) || 'the old system';
      add({ id: h.id, item: h.id, op: 'handoff write', args: ['handoff', 'write', ref(r.id)], stdin: {
        focus: clip(h.title || 'From the old system: where ' + (f.name || r.title) + ' stands, from ' + where, 400),
        state: historyState(textOf(h), where), verifyFirst: [{ path: dir }],
        ...(parked ? { status: 'parked', parkReason: reason } : {}),
      } });
    });
    if (state === 'finished') {
      add({ id: r.id + '@finish', item: r.id, op: 'track finish', args: ['track', 'finish', ref(r.id), '--outcome', 'imported: finished in the old system',
        ...(tasks.some((t) => t.open) ? ['--leftovers', 'inbox', '--wake', ref(WAKE_REF)] : []), ...by] });
    } else if (state === 'parked' && !hist.length && !live.length) {
      const when = f.unparkWhen ? unparkArg(r, f.unparkWhen) : null;
      parks.push({ id: r.id + '@park', item: r.id, op: 'track park', args: ['track', 'park', ref(r.id), '--reason', reason, ...(when ? ['--unpark-when', when] : []), ...by] });
    }
  }
  for (const p of parks) add(p);

  /* an ordered task no layout carried (it is on no track): its run-by and edges one by one */
  for (const r of made.filter((x) => !ended(x) && !laid.has(x.id) && ordered(x))) {
    const o = order(r);
    if (o.runBy) add({ id: r.id + '@runby', item: r.id, op: 'task edit', args: ['task', 'edit', ref(r.id), '--run-by', o.runBy, ...by] });
    o.after.forEach((on, i) => add({ id: r.id + '@after' + (i + 1), item: r.id, op: 'edge add', args: ['edge', 'add', ref(r.id), on, '--reason', 'the order of the old list', ...by] }));
    o.before.forEach((t, i) => add({ id: r.id + '@before' + (i + 1), item: r.id, op: 'edge add', args: ['edge', 'add', t, ref(r.id), '--reason', 'the order of the old list', ...by] }));
  }

  /* decide marks the ids in supersedes, so an entry is written after the ones it supersedes; a chain
     goes oldest first. One the plan does not write is passed as it is when it is a K-n, else reported. */
  const decisions = of('decision');
  const decIds = new Set(decisions.map((r) => r.id));
  const decided = new Set();
  const decideStep = (r) => {
    if (decided.has(r.id)) return;
    decided.add(r.id);
    const f = r.fields;
    const olds = list(f.supersedes).filter((x) => decIds.has(x) && x !== r.id);
    olds.forEach((x) => decideStep(decisions.find((d) => d.id === x)));
    const sup = [...olds.map(ref), ...list(f.supersedes).filter((x) => /^K-\d+$/.test(x))];
    for (const x of list(f.supersedes).filter((y) => !decIds.has(y) && !/^K-\d+$/.test(y))) unlinked.push({ item: r.id, names: x, why: 'is no decision this plan writes', kind: 'Supersedes' });
    /* a scoped rule's decision governs its files and commands, and its detail record triggers on the same files */
    const files = globsOf(r);
    const commands = commandsOf(r);
    const detail = f.detail ? detailStep(r, f.title || r.title, files) : null;
    /* workstreams always named, so decide never links the track the session holds */
    add({ id: r.id, item: r.id, op: 'decide', args: ['decide', ...by], stdin: {
      title: clip(f.title || r.title, 200), body: textOf(r).trim() + (detail ? '\n\nIts detail: ' + detail + '.' : '') + '\n\n' + fromLine(r),
      ...(f.words ? { words: f.words } : {}), ...(sup.length ? { supersedes: sup } : {}), ...(files.length ? { files } : {}), ...(commands.length ? { commands } : {}),
      projects: [dir], labels: [label], refs: ['onboard:' + r.id], ...(dateOf(r) ? { created: dateOf(r) } : {}), workstreams: [wsOf(r)],
    } });
  };
  decisions.forEach(decideStep);
  for (const r of of('knowledge')) {
    const f = r.fields;
    add({ id: r.id, item: r.id, op: 'knowledge new', args: ['knowledge', 'new', '--type', f.type === 'decision' ? 'decision' : 'gotcha', '--title', clip(f.title || r.title, 200),
      '--project', dir, '--label', label, ...list(f.labels).flatMap((l) => ['--label', l]), '--ref', 'onboard:' + r.id, ...globsOf(r).flatMap((g) => ['--file', g]),
      ...(dateOf(r) ? ['--created', dateOf(r)] : []), ...by],
    body: textOf(r).trim() + '\n\n' + fromLine(r) });
  }
  /* a fact the board already holds gains the triggers of the menu it came from it lacks (a rerun finds them there);
     it changes a real record, so a fix */
  const globKey = (g) => String(g).replace(/\\/g, '/').replace(/^(\.\/)+/, '');
  const filesOn = new Map((board.knowledge || []).map((k) => [k.id, new Set(list(k.files).map(globKey))]));
  for (const r of retrigger) {
    const lacks = globsOf(r).filter((g) => !(filesOn.get(r.covered) || new Set()).has(globKey(g)));
    if (lacks.length) add({ id: r.id + '@files', item: r.id, op: 'knowledge edit', fix: true, target: r.covered, args: ['knowledge', 'edit', r.covered, ...lacks.flatMap((g) => ['--add-file', g]), ...by] });
  }
  const titles = oldTitles(items);
  for (const r of of('question')) {
    const f = r.fields;
    const file = (r.source && r.source.file) || '';
    /* the ref keeps the item id: a rerun from another PC matches by it, and the board never reads a ref's text as an id */
    const folder = (/^(\.claude\/questions\/[^/]+)\//.exec(file) || [])[1];
    const un = (t) => unlabel(t, titles, folder);
    const ask = un(oneLine(f.ask || r.text || r.title));
    const options = (f.options || []).map((o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, k === 'type' || typeof v !== 'string' ? v : un(v)])));
    add({ id: r.id, item: r.id, op: 'register', args: ['register'], stdin: {
      name: clip(un(folder ? bareTitle(f.name || r.title) : f.name || r.title), 80), ask: /\?$/.test(ask) ? ask : ask + '?',
      gist: un((f.gist || '**From the old system:** ' + (file || 'its notes')) + '\n' + fromLine(r)),
      projectDir: dir, session: session || 'onboard-' + slug, blocking: f.blocking === true, ...(options.length ? { options } : {}),
      pick: f.pick || null, ...(dateOf(r) ? { created: dateOf(r) } : {}), workstream: wsOf(r),
      labels: [label], refs: ['onboard:' + r.id],
    } });
    /* the track it belongs to and the tasks it blocks (item ids, or TR-n and T-n), once they exist */
    const tr = f.track ? (madeTracks.has(f.track) ? ref(f.track) : /^TR-\d+$/.test(f.track) ? f.track : null) : null;
    if (f.track && !tr) unlinked.push({ item: r.id, names: f.track, why: 'is no track this plan writes', kind: 'Track' });
    const gates = list(f.gates).map((g) => String(g).trim()).filter((g) => {
      if (/^T-\d+$/.test(g) || madeIds.has(g)) return true;
      unlinked.push({ item: r.id, names: g, why: 'is no task this plan writes', kind: 'Gate' });
      return false;
    }).map((g) => (madeIds.has(g) ? ref(g) : g));
    if (tr || gates.length) {
      add({ id: r.id + '@scope', item: r.id, op: 'question edit', args: ['question', 'edit', ref(r.id), ...(tr ? ['--track', tr] : []), ...gates.flatMap((g) => ['--add-gate', g]), ...by] });
    }
  }

  /* rule lines, then each profile held on the project unless it already is; the project's own
     profile (named by its slug) never goes into one built in or held by anything else */
  const onBoard = (p) => (board.profiles || []).find((x) => x.profile === p);
  const renamed = [];
  const nameFor = (p) => {
    const x = p === slug && onBoard(p);
    if (!x || !(x.builtIn || x.elsewhere)) return p;
    let n = p;
    for (let k = 2; onBoard(n); k++) n = p.slice(0, 36) + '-' + k;
    renamed.push({ asked: p, profile: n, why: p + (x.builtIn ? ' is built in' : ' is held by ' + (x.records || []).join(', ')) });
    return n;
  };
  const ruleArgs = (r, { profile, slug: s, text, for: aud, detail, from, title }) => {
    const t = text + (detail ? ' (detail: ' + detailStep({ ...r, fields: { ...r.fields, detail } }, title || s) + ')' : '');
    return ['profile', 'rule-add', profile, s, '--text', t, ...(aud && aud !== 'both' ? ['--for', aud] : []), ...(from ? ['--from', from] : []), ...by];
  };
  const profiles = new Map();
  const same = (a, b) => Boolean(a && b) && String(a).toLowerCase() === String(b).toLowerCase();
  const onlyHere = (p) => {
    const x = onBoard(p);
    const recs = (x && x.records) || [];
    return Boolean(x && !x.builtIn && !x.elsewhere && recs.length && recs.every((rec) => same(rec, dir) || same(rec, shared)));
  };
  for (const r of of('rule')) {
    const f = r.fields;
    const want = f.profile || slug;
    const own = () => { if (!profiles.has(want)) profiles.set(want, nameFor(want)); return profiles.get(want); };
    const text = oneLine(f.text || r.text);
    /* a rule kept over a differing board line leaves one line in force: it takes a profile line's or
       a built-in line's slug where its own line wins by slug, and switches a setting's line off */
    const against = f.replaces ? String(f.replaces) : null;
    const was = against && (board.rules || []).find((x) => x.rule === against);
    const [wasProfile, wasRecord] = was && was.source && was.source !== 'built in' ? String(was.source).split(' on ') : [null, null];
    const old = was ? { text: was.text, ...(was.for ? { for: was.for } : {}) } : null;
    let profile;
    let lineSlug = f.slug || kebab(r.title || text);
    let replaces = null;
    let onReal = null;
    const extra = [];
    if (against && SLUG.test(against)) {
      lineSlug = against;
      /* a profile only this project holds takes the kept words in place; one others hold keeps its line for them */
      if (wasProfile && wasProfile !== want && onlyHere(wasProfile)) profile = onReal = wasProfile;
      else profile = own();
      if (wasProfile && wasProfile !== profile && wasRecord !== 'default') {
        /* same level, so the profiles' order would pick the line: the old one comes off its profile */
        extra.push({ id: r.id + '@clear', item: null, op: 'profile rule-clear', args: ['profile', 'rule-clear', wasProfile, against, ...by], restore: old, onReal: wasProfile });
        replaces = { with: against, how: 'clear', profile: wasProfile, holders: ((onBoard(wasProfile) || {}).records || []).length };
      } else replaces = { with: against, how: 'slug', profile };
    } else if (against && SETTINGS[against]) {
      profile = own();
      const offs = SETTINGS[against].kind === 'bool' ? [true, false].filter((v) => !(RULE_TEXT[against] || {})[String(v)]) : [];
      if (offs.length === 1) {
        extra.push({ id: r.id + '@setting', item: null, op: 'profile define', args: ['profile', 'define', profile, '--set', against + '=' + offs[0], ...by], unset: against });
        replaces = { with: against, how: 'setting', profile };
      } else replaces = { with: against, how: 'beside', profile };
    } else profile = own();
    const restore = replaces && wasProfile === profile ? old : null;
    add({ id: r.id, item: r.id, op: 'profile rule-add', args: ruleArgs(r, { profile, slug: lineSlug, text, for: f.for, detail: f.detail, title: f.slug }),
      ...(restore ? { restore } : {}), ...(replaces ? { replaces } : {}), ...(onReal ? { onReal } : {}) });
    for (const x of extra) add(x);
  }
  const held = (p) => { const x = onBoard(p); return Boolean(x && (x.here || (x.records || []).some((rec) => [dir, shared].some((d) => same(rec, d))))); };
  for (const p of profiles.values()) if (!held(p)) add({ id: 'hold:' + p, item: null, op: 'profile add', args: ['profile', 'add', dir, p, ...by] });

  /* procedure cards: one already under docs/procedures is read by a scan; any other the handover writes first */
  const cards = [];
  const scanned = of('card').filter((r) => /^docs\/procedures\//.test((r.source && r.source.file) || ''));
  if (scanned.length) add({ id: 'proc-scan', item: null, items: scanned.map((r) => r.id), op: 'proc scan', args: ['proc', 'scan', '--project', dir] });
  for (const r of of('card').filter((x) => !scanned.includes(x))) cards.push({ item: r.id, target: 'docs/procedures/' + kebab(r.fields.slug || r.title) + '.md' });

  /* the doctor's fixes, after every create, since a fix may name what the conversion makes; a
     reconciled record with gaps gains them as an amend (a note on a task), never a second record */
  const edits = [];
  for (const r of of('fix')) {
    const f = r.fields;
    const fx = f.fix;
    if (fx.after && fx.after.home === 'history') folders.push({ path: fx.after.path, role: 'machinery', end: 'delete', why: fx.after.what, evidence: {}, fix: r.id });
    else if (fx.after) edits.push({ item: r.id, ...fx.after });
    else {
      const args = fx.op === 'profile rule-add' ? ruleArgs(r, fx) : fx.args;
      add({ id: r.id, item: r.id, op: fx.op, args, ...(fx.stdin ? { stdin: fx.stdin } : {}), ...(fx.body !== undefined ? { body: fx.body } : {}), fix: true, target: fx.target, ...(fx.was ? { was: fx.was } : {}) });
    }
    const gaps = list(f.gaps);
    if (f.already && gaps.length) {
      const task = f.kind === 'task';
      const said = 'From the old system, missing here: ' + gaps.join(' ');
      add({ id: r.id + '@amend', item: r.id, op: task ? 'task update' : 'knowledge amend', fix: true, target: f.already,
        args: task ? ['task', 'update', f.already, '--note', said] : ['knowledge', 'amend', f.already], ...(task ? {} : { body: said + '\n\n' + fromLine(r) }) });
    }
  }

  /* the record each written item became, keyed as a cite names it: a log entry by its id, a whole-file
     track by its file, a section by its heading, anything else by its line. applyPlan fills the ids. */
  const stepIds = new Set(steps.map((s) => s.id));
  const idmap = {};
  const heads = new Map();
  const headsOf = (file) => {
    if (!heads.has(file)) {
      const t = readSrc(file);
      heads.set(file, typeof t === 'string' ? t.replace(/\r\n/g, '\n').split('\n').flatMap((l, i) => (/^#{1,6}\s+\S/.test(l) ? [{ name: l.replace(/^#+\s+/, '').trim(), line: i + 1 }] : [])) : []);
    }
    return heads.get(file);
  };
  const sections = new Map();
  for (const r of kept) {
    const s = r.source || {};
    if (!s.file || r.kind === 'fix') continue;
    const card = cards.find((c) => c.item === r.id);
    const v = card ? { kind: 'procedure', path: card.target, item: r.id } : stepIds.has(r.id) ? { kind: r.kind, step: r.id, item: r.id, id: null } : null;
    if (!v) continue;
    if (r.kind === 'track' && !s.line) { for (const x of r.fields.files || [s.file]) idmap[x] = v; continue; }
    if (r.fields.entry) idmap[s.file + '#' + r.fields.entry] = v;
    else if (s.line) idmap[s.file + '#L' + s.line] = v;
    const head = s.line ? headsOf(s.file).filter((h) => h.line <= s.line).pop() : null;
    if (!head) continue;
    const key = s.file + '#' + kebab(head.name);
    if (!sections.has(key)) sections.set(key, { kind: v.kind, steps: [], ids: [], paths: [] });
    const sec = sections.get(key);
    if (sec.kind !== v.kind) sec.kind = 'mixed';
    if (v.step) sec.steps.push(v.step);
    if (v.path) sec.paths.push(v.path);
  }
  /* a section a track came from is that track */
  for (const [key, sec] of sections) if (!idmap[key]) idmap[key] = sec.paths.length ? sec : { kind: sec.kind, steps: sec.steps, ids: [] };
  /* a file a repointed loader cites whole is the records and cards its items became */
  for (const file of new Set([...repointed.values()].flat())) {
    if (idmap[file]) continue;
    const mine = kept.filter((r) => r.source && r.source.file === file && r.kind !== 'fix');
    idmap[file] = { kind: 'file', steps: mine.filter((r) => stepIds.has(r.id) && !cards.some((c) => c.item === r.id)).map((r) => r.id), ids: [], paths: cards.filter((c) => mine.some((r) => r.id === c.item)).map((c) => c.target) };
  }
  /* a cite the repoint would give a git note outside running text (a value a tool may read) waits on the session */
  const judge = citeJudge(proposal.cites);
  /* a line the ledger carries or drops leaves with the rewrite, before the repoint reads its file */
  for (const c of bareCites(dir, folders, idmap, kept, headsOf, Object.keys(proposal.runs || {}), (f, n) => clauseGoes(f + ':' + n))) if (!judge(c.file, c.line, c.of)) pending.push({ item: 'cite:' + c.file + '#L' + c.line, title: clip(c.text, 80),
    why: 'it names ' + c.of + ', which goes, outside running text (a value a tool may read): say in `cites` ({ file, line, of, do }) whether to note it with git (do: note), leave it (leave), or point it at another path (point, with to)' });

  /* each instruction file's ledger, by file. A split clause keeps its fact in rewritten words in its file and
     carries its rule, so it needs both */
  const FATE = { keep: 'kept', rule: 'carried', drop: 'dropped', split: 'split' };
  const ledger = new Map();
  for (const c of proposal.claude || []) {
    const path = ledgerOf(c);
    if (c.fate === 'split' && (!oneLine(c.kept) || !c.item)) {
      pending.push({ item: c.item || 'clause:' + path + '#L' + c.line, title: clip(c.clause, 80), why: 'a split clause needs its kept words (the fact, rewritten) in `kept` and the rule it carries in `item`' });
      continue;
    }
    if (!ledger.has(path)) ledger.set(path, []);
    ledger.get(path).push(c);
  }
  for (const fc of unfated) { if (!ledger.has(fc.file)) ledger.set(fc.file, []); ledger.get(fc.file).push({ file: fc.file, line: fc.line, clause: fc.clause, fate: null }); }
  /* the section's file is rewritten even with nothing to move, so it gains the section; never one Claude lacks */
  if (section && instr && !ledger.has(section)) ledger.set(section, []);
  /* the files a dropped pointer or import loads, so the handover keeps it while one of them is held */
  const loadsAt = (path, from, to) => Object.keys(reach).filter((f) => reach[f].some((w) => { const i = w.lastIndexOf(':'); const n = Number(w.slice(i + 1)); return w.slice(0, i) === path && from <= n && n <= to; }));
  const claude = [...ledger].map(([path, cs]) => ({ path, clauses: cs.map((c) => {
    const step = c.item && steps.find((s) => s.id === c.item);
    const loads = c.fate === 'drop' ? loadsAt(path, Number(c.line), Number(c.end || c.line)) : [];
    return { text: c.clause, line: c.line, end: c.end || c.line, fate: FATE[c.fate] || c.fate || null, ...(c.item ? { item: c.item } : {}), ...(loads.length ? { loads } : {}),
      ...(c.fate === 'split' ? { kept: oneLine(c.kept) } : {}), ...(step && step.op === 'profile rule-add' ? { by: step.args[3] } : {}), ...(c.why ? { why: c.why } : {}) };
  }) }));

  /* a step naming an item an earlier write made names its record */
  if (heldBy.size) {
    const swap = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v).replace(/@\{([^}]+)\}/g, (m, id) => heldBy.get(id) || m)));
    for (const s of steps) Object.assign(s, { args: swap(s.args), ...(s.stdin ? { stdin: swap(s.stdin) } : {}) });
  }
  /* this run's judgments with the evidence each rests on, which the next run re-checks rather
     than copies: kept folders, kept and dropped clauses, items the session left out */
  const trackOn = new Map((board.tracks || []).map((t) => [t.id, t]));
  const evidence = (ev, call) => {
    const e = evidenceOf(ev);
    if (call) e.call = call;
    if (e.until && e.until.track && !('seen' in e.until)) e.until = { ...e.until, seen: (trackOn.get(e.until.track) || {}).handoff || null };
    return e;
  };
  const judgment = (key, kind, subject, fate, x, ev, more = {}) => ({ key, kind, subject, ...more, fate, ...(x.why ? { why: clip(x.why, 300) } : {}),
    ...(x.shape ? { shape: String(x.shape) } : {}), ...(Object.keys(ev).length ? { evidence: ev } : {}) });
  const judged = [];
  /* a kept path that is a file is judged as a file */
  const isFile = (p) => { if (/\/$/.test(String(p))) return false; try { return statSync(join(dir, folderKey(p))).isFile(); } catch { return /\.[A-Za-z0-9]{1,8}$/.test(folderKey(p)); } };
  for (const f of folders) {
    if ((f.end || 'keep') !== 'keep' || !folderKey(f.path)) continue;
    const file = isFile(f.path);
    const at = folderKey(f.path) + (file ? '' : '/');
    judged.push(judgment((file ? 'file:' : 'folder:') + at, file ? 'file' : 'folder', at, 'keep', f, evidence(f.evidence, f.answeredBy)));
  }
  for (const c of proposal.claude || []) {
    /* a split clause's kept words are what its file holds after the rewrite, so they are the kept clause judged */
    const words = c.fate === 'split' ? oneLine(c.kept) : c.clause;
    if (!['keep', 'drop', 'split'].includes(c.fate) || !words) continue;
    const file = ledgerOf(c);
    judged.push(judgment(clauseId(file, words), 'clause', file, c.fate === 'drop' ? 'drop' : 'keep', c, evidence(c.evidence), { clause: clip(words, 300) }));
  }
  for (const id of left) {
    const r = items.find((x) => x.id === id);
    const file = r && r.source && r.source.file ? String(r.source.file).replace(/\\/g, '/') : null;
    if (!file || r.dropped || String(id).startsWith('checkup:') || ledgerFiles.has(file)) continue;
    judged.push(judgment('item:' + id, 'item', file, 'drop', r, evidence(r.evidence)));
  }
  const counts = {};
  for (const s of steps) counts[s.op] = (counts[s.op] || 0) + 1;
  const map = { seeds: ((proposal.map && proposal.map.sources) || []).filter((x) => x.state === 'seeded').map((x) => ({ source: x.source, records: x.records, ...(x.kinds ? { kinds: x.kinds } : {}) })) };
  return { made: new Date().toISOString(), ...(proposal.go ? { go: proposal.go } : {}), project: { dir, slug, ...(shared ? { shared } : {}) }, label, steps, cards, edits, map,
    folders: folders.map((f) => ({ ...f, end: f.end || 'keep' })), claude, section, ...(instr && instr.setting ? { instructions: { mode: instr.setting.mode, ...(instr.above ? { above: instr.above } : {}) } } : {}), judged, answers, pending, left, covered, counts, profiles: renamed, unlinked, idmap,
    /* the handover holds a loader while what it loads is held (apply.mjs gatesOf) */
    ...(proposal.loaders && Object.keys(proposal.loaders).length ? { loaders: proposal.loaders } : {}), unloaded, ...(readWhole.length ? { readWhole } : {}),
    ...(Object.keys(readNamed).length ? { readNamed } : {}),
    ...(repointed.size ? { repointed: [...repointed].map(([loader, files]) => ({ loader, files })) } : {}), ...(list(proposal.cites).length ? { cites: list(proposal.cites) } : {}),
    /* a card's file triggers are its scope's globs, the menu's included */
    items: items.map((x) => ({ id: x.id, kind: x.kind, title: x.title, text: x.text, fields: x.kind === 'card' && globsOf(x).length ? { ...x.fields, files: globsOf(x) } : x.fields, source: x.source || null, cut: Boolean(x.cut),
      ...(x.dropped ? { dropped: x.dropped } : {}), ...(x.covered ? { covered: x.covered } : {}), ...(heldDetail.has(x.id) ? { heldDetail: heldDetail.get(x.id) } : {}) })) };
}

/* The go in chat, recorded in the proposal; the live write refuses a plan without it. */
export function recordGo(proposal, { session, at = new Date().toISOString() } = {}) {
  if (!session) throw new Error('the go takes --session <own id>: the session that heard it');
  return { ...proposal, go: { at, from: 'chat', session } };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const work = process.argv[2];
  if (!work || work === '--help') { console.log('node plan.mjs <work dir> [--go --session <own id>]'); process.exit(work ? 0 : 1); }
  const si = process.argv.indexOf('--session');
  const session = si > 0 ? process.argv[si + 1] : undefined;
  const file = join(work, 'proposal.json');
  let proposal;
  try { proposal = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { console.error('plan: no proposal.json in ' + work + ' (' + e.message + ')'); process.exit(1); }
  const facts = readFacts(work);
  const manifest = readJsonFile(join(work, 'manifest.json'));
  const stale = undoWaits(manifest) || staleFacts(facts, manifest);
  if (stale) { console.error('plan: ' + stale); process.exit(1); }
  const full = withFacts(proposal, facts);
  if (!full.project || !full.project.dir) { console.error('plan: no project: neither proposal.json nor facts.json in ' + work + ' names it'); process.exit(1); }
  let plan;
  try { plan = buildPlan(full, { session }); } catch (e) {
    if (!(e instanceof WaitingError)) throw e;
    const own = e.waiting.filter((w) => w.notACall);
    const theirs = e.waiting.filter((w) => !w.notACall);
    if (own.length) console.error('plan: no plan while calls ask the user what the card settles (' + own.length + '):');
    for (const w of own) console.error('  ' + w.call + ': ' + w.ask + ' (' + w.why + ')');
    if (theirs.length) console.error('plan: no plan while calls wait on the user (' + theirs.length + '):');
    for (const w of theirs) console.error('  ' + w.call + ': ' + w.ask + ' (' + w.why + (w.pick ? '; the pick is ' + w.pick : '') + ')');
    process.exit(1);
  }
  if (process.argv.includes('--go')) {
    if (plan.pending.length) { console.error('plan: ' + plan.pending.length + ' items still wait on the session, so the go waits too'); process.exit(1); }
    try { proposal = recordGo(proposal, { session }); } catch (e) { console.error('plan: ' + e.message); process.exit(1); }
    writeFileSync(file + '.tmp', JSON.stringify(proposal, null, 2) + '\n');
    renameSync(file + '.tmp', file);
    plan.go = proposal.go;
    console.log('proposal.json: the go in chat recorded at ' + proposal.go.at);
  }
  writeFileSync(join(work, 'plan.json'), JSON.stringify(plan, null, 2) + '\n');
  const ends = {};
  for (const f of plan.folders) ends[f.end] = (ends[f.end] || 0) + 1;
  console.log('plan.json: ' + plan.steps.length + ' steps (' + Object.entries(plan.counts).map(([k, v]) => k + ' ' + v).join(', ') + '); left out ' + plan.left.length
    + '; already on the board ' + plan.covered.length + '; folders ' + (Object.entries(ends).map(([k, v]) => k + ' ' + v).join(', ') || 'none') + '; cards ' + plan.cards.length
    + (plan.go ? '' : '; no go yet'));
  const bare0 = plan.judged.filter((j) => !j.evidence);
  if (plan.judged.length) console.log('Judgments recorded with their evidence: ' + plan.judged.length + (bare0.length ? '; with none, so judged again next run (' + bare0.length + '): ' + bare0.map((j) => j.subject + (j.clause ? ' "' + clip(j.clause, 60) + '"' : '')).join(', ') : ''));
  const before = plan.answers.filter((a) => a.before);
  if (before.length) console.log('Answered on an earlier run, its subjects unchanged, so not asked again (' + before.length + '): ' + before.map((a) => a.call + ' ' + a.letter).join(', '));
  const reruns = plan.covered.filter((c) => c.rerun);
  if (reruns.length) console.log('Written by an earlier run, so not again (' + reruns.length + '): ' + reruns.map((c) => c.item + ' as ' + c.by).join(', '));
  /* the source keys each item for the later runs that read only what changed */
  const bare = plan.items.filter((x) => !x.source && x.kind !== 'fix' && !x.cut);
  if (bare.length) console.log('Items with no source (' + bare.length + '), which a later run cannot match: ' + bare.map((x) => x.id).join(', '));
  for (const u of plan.unlinked) console.log((u.kind || 'Edge') + ' dropped: ' + u.item + ' names ' + JSON.stringify(u.names) + ', which ' + u.why + '.');
  if (plan.unloaded.length) console.log('The file stays, its load goes (' + plan.unloaded.length + '): ' + plan.unloaded.map((u) => u.file + ' (' + u.why + '), loaded by ' + u.loaders.join(', ')).join('; '));
  if (plan.repointed) console.log('Kept, its cites repointed at the handover to what the files became (' + plan.repointed.length + '): ' + plan.repointed.map((x) => x.loader + ' (' + x.files.join(', ') + ')').join('; '));
  for (const p of plan.profiles) console.log('Rule lines go to profile ' + p.profile + ', not ' + p.asked + ': ' + p.why + '.');
  if (plan.pending.length) {
    console.log('Waiting on the session (' + plan.pending.length + '):');
    for (const p of plan.pending) console.log('  ' + p.item + ': ' + p.why);
  }
}
