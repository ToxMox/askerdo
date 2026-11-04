#!/usr/bin/env node
/* the onboarding survey. Reads one project (never writes it), the Claude memory
   files for it and what the board already holds, and writes rows.json: every old thing
   found, where it is, its date from the old system and a proposed home on the board.
   node survey.mjs <project dir> [--work <dir>] [--cli <path>] [--no-board] [--manifest <file>] */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataDir } from '../../lib/node-helpers.mjs';
import { sharedName } from '../../lib/project-id.mjs';

export const DEFAULT_CLI = join(homedir(), '.claude', 'askerdo', 'cli.mjs');
const slashed = (p) => String(p).replace(/\\/g, '/');

/* ---- small readers ---- */

function git(dir, args, opts = {}) {
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8', windowsHide: true, maxBuffer: 256 << 20, ...opts });
  return r.status === 0 ? r.stdout : null;
}
const readText = (p) => { try { return readFileSync(p, 'utf8').replace(/\r\n/g, '\n'); } catch { return null; } };
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const dayOf = (d) => { const x = new Date(d); return Number.isFinite(x.getTime()) ? x.toISOString().slice(0, 10) : null; };
const mtimeDay = (p) => { try { return dayOf(statSync(p).mtime); } catch { return null; } };
const oneLine = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const clip = (s, n) => { const t = oneLine(s); return t.length > n ? t.slice(0, n - 3) + '...' : t; };
const kebab = (s, n = 40) => oneLine(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, n).replace(/-+$/, '') || 'item';
const hash = (s) => { let h = 2166136261; for (const c of String(s)) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; } return h.toString(36).slice(0, 6); };
const plainMd = (s) => oneLine(String(s).replace(/\*\*|__|`/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1'));
const DATE_IN = /\b(20\d\d-[01]\d-[0-3]\d)\b/;

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
const str = (v) => (typeof v === 'string' ? v : '');

/* ---- the project's files ---- */

const SKIP_DIR = /(^|\/)(\.git|node_modules|\.claude\/worktrees|Library|Temp|obj|bin|dist|build|out|target|\.venv|venv|__pycache__|vendor)(\/|$)/;
const TEXT_EXT = /\.(md|markdown|txt)$/i;

function listFiles(root, isGit) {
  if (isGit) {
    const out = git(root, ['ls-files', '-co', '--exclude-standard', '-z']);
    if (out !== null) return out.split('\0').filter(Boolean).map(slashed).filter((f) => !SKIP_DIR.test(f));
  }
  const files = [];
  const walk = (rel) => {
    let ents = [];
    try { ents = readdirSync(join(root, rel), { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = rel ? rel + '/' + e.name : e.name;
      if (SKIP_DIR.test(p)) continue;
      if (e.isDirectory()) walk(p); else files.push(p);
    }
  };
  walk('');
  return files;
}

/* Each line's last-change day and commit, from git blame; uncommitted lines read as the file's mtime. */
function blameOf(root, file, isGit) {
  const out = isGit ? git(root, ['blame', '--line-porcelain', '--', file]) : null;
  const lines = [];
  if (out) {
    let cur = {};
    for (const l of out.split('\n')) {
      const h = /^([0-9a-f]{40}) \d+ (\d+)/.exec(l);
      if (h) { cur = { commit: h[1], line: Number(h[2]) }; continue; }
      if (l.startsWith('author-time ')) cur.time = Number(l.slice(12));
      else if (l.startsWith('author-tz ')) cur.tz = l.slice(10);
      else if (l.startsWith('\t')) {
        const committed = !/^0+$/.test(cur.commit || '');
        const off = /^([+-])(\d\d)(\d\d)$/.exec(cur.tz || '');
        const ms = (cur.time || 0) * 1000 + (off ? (off[1] === '-' ? -1 : 1) * (Number(off[2]) * 60 + Number(off[3])) * 60000 : 0);
        lines[cur.line] = committed ? { day: new Date(ms).toISOString().slice(0, 10), commit: cur.commit.slice(0, 10) } : null;
      }
    }
  }
  const fallback = mtimeDay(join(root, file));
  return (n) => lines[n] || { day: fallback, commit: null };
}

/* Every committed version of a file, oldest first, with the path it had then. */
function versionsOf(root, file, isGit) {
  const out = isGit ? git(root, ['log', '--follow', '--name-only', '--format=%x1e%H%x09%aI%x09%s', '--', file]) : null;
  const list = [];
  for (const rec of (out || '').split('\x1e').slice(1)) {
    const [head, ...names] = rec.split('\n');
    const [commit, at, subject] = head.split('\t');
    const path = names.map((s) => s.trim()).filter(Boolean).pop() || file;
    list.push({ commit: commit.slice(0, 12), at: at.replace(/Z$/, '+00:00'), subject: clip(subject, 120), path: slashed(path) });
  }
  list.reverse();
  const dirty = isGit && git(root, ['status', '--porcelain', '--', file]);
  if (!list.length || (dirty && dirty.trim())) {
    try { list.push({ commit: null, at: localStamp(statSync(join(root, file)).mtime), subject: list.length ? 'uncommitted edits' : 'never committed', path: file }); } catch { /* gone */ }
  }
  return list;
}

export function localStamp(d) {
  const off = -d.getTimezoneOffset();
  const pad = (n) => String(Math.floor(Math.abs(n))).padStart(2, '0');
  const local = new Date(d.getTime() + off * 60000).toISOString().slice(0, 19);
  return local + (off >= 0 ? '+' : '-') + pad(off / 60) + ':' + pad(off % 60);
}

/* ---- the detectors: each returns rows ---- */

const HANDOFF_NAME = /(hand[-_ ]?off|kick[-_ ]?off|working[-_ ]?state|(^|[-_.])state([-_.]|$)|status|progress|session[-_ ]?notes|next[-_ ]?steps|resume|recap|wip)/i;
const LIST_NAME = /(^|[^a-z])(todo|backlog|roadmap|plans?|planning)([^a-z]|$)/i;
const DECISION_NAME = /(decision|^adr|rulings?)/i;
const ARCHIVED = /(^|\/)(archive|archived|old|done|history)(\/|$)/i;
const STEPS_HEAD = /(how to|steps|procedure|runbook|release|deploy|setup|install|checklist|recipe)/i;
const CHECK = /^(\s*)[-*+] \[([ xX])\]\s+(.+)$/;

const seriesKey = (f) => {
  const d = dirname(f) === '.' ? '' : dirname(f) + '/';
  const stem = basename(f).replace(/\.[^.]+$/, '').replace(/(19|20)\d\d-?[01]\d-?[0-3]\d/g, '').replace(/^[-_ .]+|[-_ .]+$/g, '').replace(/[-_ .]{2,}/g, '-');
  return d + (stem || 'notes');
};
const humanName = (key) => {
  const parts = key.split('/');
  const stem = parts.pop().replace(/[-_]+/g, ' ');
  return parts.length ? parts[parts.length - 1] + ': ' + stem : stem;
};

/* The file a project's own guides (AGENTS.md, CLAUDE.md, READMEs at the root and under docs/) tell a
   reader to read first or keep current: its state file, whatever it is called. Reference docs are not. */
const GUIDE = /^(AGENTS|CLAUDE|README)(\.local)?\.md$/i;
const POINT_CUE = /\bread\b.{0,120}?\bfirst\b|\bfirst,? read\b|\b(start|begin) (here|with|by reading)\b|\bkeep\b.{0,120}?\b(current|up[- ]to[- ]date|updated)\b|\bupdate\b.{0,120}?\b(at the end|before (you )?(stop|end|leave)|after each|after every|each session|every session)\b/i;
const NOT_STATE = /(^|[^a-z])(architecture|design|overview|contributing|conventions|style|guide|glossary|setup|install|license|conduct|specs?|readme|agents|claude|changelog)([^a-z]|$)/i;
const PATH_IN = /`([^`\s]+)`|\]\(([^)\s]+)\)|((?:[\w.-]+\/)*[\w.-]+\.(?:md|markdown|txt))\b/gi;
function pointedFiles(ctx, files) {
  const have = new Set(files);
  const out = new Map();
  const guides = files.filter((f) => GUIDE.test(basename(f)) && /^(\.|\.claude|docs(\/[^/]+){0,2})$/i.test(posix.dirname(f))).slice(0, 20);
  for (const g of guides) {
    const lines = (readText(join(ctx.root, g)) || '').split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (!POINT_CUE.test(lines[i])) continue;
      /* "Read these first:" names its files on the lines below */
      let text = lines[i];
      for (let k = i + 1; /:\s*$/.test(lines[i]) && k < lines.length && k <= i + 3 && lines[k].trim(); k++) text += '\n' + lines[k];
      for (const m of text.matchAll(PATH_IN)) {
        const p = (m[1] || m[2] || m[3]).replace(/[#?].*$/, '').replace(/^\.\//, '');
        const hit = [posix.normalize(posix.join(posix.dirname(g), p)), posix.normalize(p)].find((x) => have.has(x));
        if (!hit || !TEXT_EXT.test(hit) || NOT_STATE.test(basename(hit)) || DECISION_NAME.test(basename(hit)) || LIST_NAME.test(basename(hit))) continue;
        const forced = ctx.include.get(hit);
        if (forced && forced !== 'handoff') continue;
        if (!out.has(hit)) out.set(hit, []);
        if (!out.get(hit).includes(g)) out.get(hit).push(g);
      }
    }
  }
  return out;
}

function handoffRows(ctx, files) {
  const pointed = pointedFiles(ctx, files);
  const groups = new Map();
  for (const f of files) {
    if (!TEXT_EXT.test(f) || /changelog/i.test(f)) continue;
    const forced = ctx.include.get(f);
    if (forced ? forced !== 'handoff' : !HANDOFF_NAME.test(basename(f)) && !pointed.has(f)) continue;
    const k = seriesKey(f);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(f);
  }
  const rows = [];
  for (const [key, list] of groups) {
    const history = list.flatMap((f) => versionsOf(ctx.root, f, ctx.isGit).map((v) => ({ ...v, file: f })))
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    if (!history.length) continue;
    const last = history[history.length - 1];
    const archived = list.every((f) => ARCHIVED.test(f));
    const latest = readText(join(ctx.root, last.file)) || '';
    const by = [...new Set(list.flatMap((f) => pointed.get(f) || []))];
    rows.push({
      id: 'track:' + key, find: 'handoff', home: 'track', def: 'keep', group: 'tracks',
      title: humanName(key), where: { file: list.join(', ') }, date: last.at.slice(0, 10), dateHow: 'commit',
      excerpt: clip(latest, 600),
      fields: {
        name: humanName(key), workstream: 'main', state: archived ? 'finished' : 'parked', files: list,
        history: history.map((v) => ({ commit: v.commit, at: v.at, subject: v.subject, path: v.path, file: v.file })),
      },
      pointedBy: by.length ? by : undefined,
      why: history.length + ' old version' + (history.length === 1 ? '' : 's') + ' from ' + history[0].at.slice(0, 10) + ' to ' + last.at.slice(0, 10)
        + ' become the track\'s handoffs, oldest first' + (archived ? '; it sits in an archive folder, so the track is finished' : '')
        + (by.length ? '; ' + by.join(' and ') + ' tell' + (by.length === 1 ? 's' : '') + ' a reader to read it first or keep it current' : ''),
    });
  }
  ctx.trackOfFile = new Map(rows.flatMap((r) => r.fields.files.map((f) => [f, r.id])));
  return rows;
}

function taskRows(ctx, files) {
  const rows = [];
  for (const f of files) {
    if (!TEXT_EXT.test(f)) continue;
    const text = readText(join(ctx.root, f));
    if (!text || !/\[[ xX]\]|^\s*(TODO|FIXME)\b/m.test(text)) continue;
    const lines = text.split('\n');
    const found = [];
    lines.forEach((l, i) => {
      const m = CHECK.exec(l);
      if (m && m[1].length <= 2) {
        let text = m[3];
        for (let j = i + 1; j < lines.length && /^\s{2,}\S/.test(lines[j]) && !CHECK.test(lines[j]) && !/^\s*[-*+]\s/.test(lines[j]); j++) text += ' ' + lines[j].trim();
        found.push({ n: i + 1, done: m[2] !== ' ', text });
      }
      const t = /^\s*(?:[-*+]\s+)?(?:TODO|FIXME)[:\s]+(.+)$/.exec(l);
      if (!m && t) found.push({ n: i + 1, done: false, text: t[1] });
    });
    if (!found.length) continue;
    const blame = blameOf(ctx.root, f, ctx.isGit);
    let track = ctx.trackOfFile.get(f) || null;
    if (!track && found.length >= 3) {
      track = 'track:' + seriesKey(f);
      rows.push({
        id: track, find: 'list', home: 'track', def: 'keep', group: 'tracks', title: humanName(seriesKey(f)), where: { file: f },
        date: blame(found[0].n).day, dateHow: 'blame', excerpt: clip(text, 600),
        fields: { name: humanName(seriesKey(f)), workstream: 'main', state: found.every((x) => x.done) ? 'finished' : 'parked', files: [f], history: [],
          parkReason: 'imported: a list from the old system, ' + f },
        why: 'a list of ' + found.length + ' items is a line of work: its items become the track\'s tasks',
      });
    }
    for (const x of found) {
      const b = blame(x.n);
      const title = clip(plainMd(x.text), 120);
      if (!title) continue;
      rows.push({
        id: 'task:' + f + '#' + hash(plainMd(x.text)), find: 'task', home: 'task', def: 'keep', group: 'tasks:' + (track || f),
        title, where: { file: f, line: x.n, commit: b.commit }, date: b.day, dateHow: b.commit ? 'blame' : 'mtime',
        closed: x.done ? b.day : undefined, excerpt: clip(x.text, 600),
        fields: { name: title, status: x.done ? 'completed' : 'open', track, workstream: 'main', text: oneLine(x.text) },
        why: x.done ? 'checked off in the old list, so it comes in done' : 'an open item in the old list',
      });
    }
  }
  return rows;
}

function sections(text, level) {
  const lines = text.split('\n');
  const out = [];
  const re = new RegExp('^#{' + level + '}\\s+(.+)$');
  lines.forEach((l, i) => { const m = re.exec(l); if (m) out.push({ head: m[1].trim(), n: i + 1 }); });
  return out.map((s, j) => ({ ...s, body: lines.slice(s.n, j + 1 < out.length ? out[j + 1].n - 1 : lines.length).join('\n').trim() }));
}

/* A log written one entry per top-level bullet ("- D12. ...", "- **R1:** ..."), each with its wrapped lines. */
const ENTRY_BULLET = /^[-*+]\s+(?:\*\*)?([A-Z]{1,4}-?\d+)(?:\*\*)?[.:)]/;
function bulletEntries(text) {
  const lines = text.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = ENTRY_BULLET.exec(lines[i]);
    if (!m) continue;
    let j = i + 1;
    while (j < lines.length && !/^([-*+]\s|#{1,6}\s)/.test(lines[j]) && !(lines[j].trim() === '' && !/^\s+\S/.test(lines[j + 1] || ''))) j++;
    const body = lines.slice(i, j).map((l) => l.trim()).join('\n').replace(/^[-*+]\s+/, '').trim();
    out.push({ head: lines[i].replace(/^[-*+]\s+/, ''), n: i + 1, body, key: m[1], bullet: true });
    i = j - 1;
  }
  return out;
}

/* A log of plain top-level bullets under section headings, no entry ids: one entry per bullet,
   its wrapped lines and nested bullets kept, named by the heading above it. */
function plainBullets(text) {
  const lines = text.split('\n');
  const out = [];
  let section = '';
  for (let i = 0; i < lines.length; i++) {
    const h = /^#{2,6}\s+(.+)$/.exec(lines[i]);
    if (h) { section = h[1].trim(); continue; }
    if (!/^[-*+]\s+\S/.test(lines[i])) continue;
    let j = i + 1;
    while (j < lines.length && !/^([-*+]\s|#{1,6}\s)/.test(lines[j]) && !(lines[j].trim() === '' && !/^\s+\S/.test(lines[j + 1] || ''))) j++;
    const body = lines.slice(i, j).map((l) => l.trimEnd()).join('\n').replace(/^[-*+]\s+/, '').trim();
    out.push({ head: lines[i].replace(/^[-*+]\s+/, ''), n: i + 1, body, bullet: true, section });
    i = j - 1;
  }
  /* a single record with a few reasons in bullets stays one record: the bullets must carry the file */
  const prose = lines.filter((l) => l.trim() && !/^#{1,6}\s/.test(l)).join('').length;
  return out.length >= 3 && out.reduce((n, s) => n + s.body.length, 0) * 2 >= prose ? out : [];
}

/* A log kept as markdown tables: one entry per body row, titled by its first cell, the other cells
   labelled by their header, named by the heading above it. Header and separator rows are never entries. */
const TABLE_RULE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;
const cellsOf = (l) => l.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
function tableEntries(text) {
  const lines = text.split('\n');
  const out = [];
  let section = '';
  for (let i = 0; i < lines.length; i++) {
    const h = /^#{2,6}\s+(.+)$/.exec(lines[i]);
    if (h) { section = h[1].trim(); continue; }
    /* the outer pipes of a markdown table are optional */
    if (!/\|/.test(lines[i]) || !/\|/.test(lines[i + 1] || '') || !TABLE_RULE.test(lines[i + 1] || '')) continue;
    const header = cellsOf(lines[i]);
    let j = i + 2;
    for (; j < lines.length && lines[j].trim() && /\|/.test(lines[j]); j++) {
      const cells = cellsOf(lines[j]);
      if (!cells[0] || TABLE_RULE.test(lines[j])) continue;
      /* a first column of entry ids ("D12"), row numbers or dates is not the title: the next cell is */
      const first = plainMd(cells[0]);
      const id = /^[A-Z]{1,4}-?\d+$/.test(first);
      const dated = /^20\d\d-[01]\d-[0-3]\d$/.test(first);
      const at = (id || dated || /^\d+\.?$/.test(first)) && cells[1] ? 1 : 0;
      const body = cells.map((c, k) => (!c || k === at || (at && k === 0 && !dated) ? '' : header[k] ? header[k] + ': ' + c : c)).filter(Boolean).join('\n');
      out.push({ head: cells[at], n: j + 1, body, table: true, section, key: id && at ? first : undefined });
    }
    i = j - 1;
  }
  return out;
}

function decisionRows(ctx, files) {
  const rows = [];
  for (const f of files) {
    if (!TEXT_EXT.test(f)) continue;
    const forced = ctx.include.get(f);
    if (forced ? forced !== 'decisions' : !(DECISION_NAME.test(basename(f)) || /(^|\/)(adr|decisions)\//i.test(f))) continue;
    const text = readText(join(ctx.root, f)) || '';
    /* a log has entries (D-001, ADR-2, a date, "Decision"); any other decision file is one record */
    const strong = (s) => /^(?:[A-Z]{1,4}-?\d+\b|\d+[.:)]\s)|20\d\d-\d\d-\d\d/i.test(s.head);
    const entry = (s) => strong(s) || /decision/i.test(s.head);
    let secs = sections(text, 2).filter(entry);
    if (secs.length < 2) secs = sections(text, 3).filter(entry);
    /* sections that are entries only by the word ("## Workspace decisions") split by row when tables carry the file */
    const tabled = tableEntries(text);
    const prose = text.split('\n').filter((l) => l.trim() && !/^#{1,6}\s/.test(l));
    const carried = prose.filter((l) => l.includes('|')).join('').length * 2 >= prose.join('').length;
    if (secs.length && tabled.length > secs.length && !secs.some(strong) && carried) secs = tabled;
    if (secs.length < 2) secs = bulletEntries(text);
    if (secs.length < 2) secs = tabled;
    /* an ADR is one record even when it is written in bullets */
    if (secs.length < 2 && !/(^|\/)adr/i.test(f)) secs = plainBullets(text);
    if (secs.length < 2) secs = [{ head: (/^#\s+(.+)$/m.exec(text) || [])[1] || basename(f, '.md'), n: 1, body: text }];
    const blame = blameOf(ctx.root, f, ctx.isGit);
    for (const s of secs) {
      const dated = DATE_IN.exec(s.head) || DATE_IN.exec(s.bullet || s.table ? s.body : s.body.split('\n').slice(0, 4).join(' '));
      const b = blame(s.n);
      const title = clip(plainMd(s.bullet ? s.body : s.head), 160);
      const sec = s.section ? ': ' + plainMd(s.section) : '';
      rows.push({
        id: 'decision:' + f + '#' + (s.section === undefined ? kebab(s.head, 60) : kebab(s.section || 'top', 30) + '-' + hash(s.table ? s.head + '\n' + s.body : s.body)),
        find: 'decision', home: 'decision', def: 'keep', group: 'decisions:' + f + sec,
        title, where: { file: f, line: s.n, commit: b.commit }, date: dated ? dated[1] : b.day,
        dateHow: dated ? 'text' : 'blame', excerpt: clip((sec ? plainMd(s.section) + ': ' : '') + (s.table ? plainMd(s.head) + ': ' : '') + s.body, 600), entry: s.key,
        fields: { title, body: s.body.slice(0, 6000), ...(s.section ? { section: plainMd(s.section) } : {}) },
        why: 'an entry of the old decision log becomes a decision record',
      });
    }
  }
  return rows;
}

function ruleRows(ctx, files) {
  const rows = [];
  const slugs = new Set();
  for (const f of files.filter((x) => /(^|\/)(CLAUDE|AGENTS)\.md$/.test(x))) {
    const lines = (readText(join(ctx.root, f)) || '').split('\n');
    const blame = blameOf(ctx.root, f, ctx.isGit);
    let head = '';
    for (let i = 0; i < lines.length; i++) {
      const h = /^#{1,4}\s+(.+)$/.exec(lines[i]);
      if (h) { head = h[1].trim(); continue; }
      if (!/^[-*]\s+\S/.test(lines[i])) continue;
      let text = lines[i].replace(/^[-*]\s+/, '');
      let j = i + 1;
      while (j < lines.length && /^\s+\S/.test(lines[j]) && !/^\s*[-*]\s/.test(lines[j])) { text += ' ' + lines[j].trim(); j++; }
      text = oneLine(text);
      const b = blame(i + 1);
      let slug = kebab(text.split(/\s+/).slice(0, 5).join(' '), 40);
      for (let k = 2; slugs.has(slug); k++) slug = kebab(slug, 36) + '-' + k;
      slugs.add(slug);
      const ruling = /\((?:[A-Z][a-z]+), 20\d\d-\d\d-\d\d/.test(text);
      rows.push({
        id: 'rule:' + f + '#' + hash(text), find: 'rule', home: 'rule', def: 'leave', group: 'rules:' + f,
        title: clip(plainMd(text), 120), where: { file: f, line: i + 1, commit: b.commit }, date: b.day, dateHow: 'blame',
        excerpt: (head ? head + ': ' : '') + clip(text, 600),
        fields: { profile: ctx.slug, slug, text: text.length <= 400 ? text : undefined, for: 'both', ruling },
        why: text.length > 400 ? 'over 400 characters, so a rule line needs shorter words: choose convert and say how'
          : 'already in ' + f + ', which every session in this project reads; keep copies it to the ' + ctx.slug + ' profile so agent briefs carry it too',
        needsWords: text.length > 400 || undefined,
      });
      i = j - 1;
    }
  }
  return rows;
}

/* ~/.claude/projects/<slug>/memory for the project and its subfolders, never a worktree's. */
function memoryRows(ctx) {
  const base = join(ctx.claudeHome, 'projects');
  const slug = slashed(ctx.root).replace(/[^A-Za-z0-9]/g, '-');
  let dirs = [];
  try { dirs = readdirSync(base).filter((d) => (d === slug || d.startsWith(slug + '-')) && !/-claude-worktrees-/.test(d)); } catch { return []; }
  const rows = [];
  for (const d of dirs) {
    const mem = join(base, d, 'memory');
    let names = [];
    try { names = readdirSync(mem).filter((n) => n.endsWith('.md') && n !== 'MEMORY.md'); } catch { continue; }
    for (const n of names) {
      const p = join(mem, n);
      const { front, body } = frontmatter(readText(p));
      const type = (str(front.type) || str((front.metadata || {}).type)).toLowerCase();
      const title = clip(str(front.description) || str(front.name) || n.replace(/\.md$/, ''), 160);
      const home = type === 'feedback' ? 'rule' : type === 'user' ? '?' : 'knowledge';
      const text = oneLine(body);
      rows.push({
        id: 'memory:' + d + '/' + n, find: 'memory', home, def: home === '?' ? 'leave' : 'keep', group: 'memory',
        title, where: { file: slashed(p) }, date: DATE_IN.exec(body)?.[1] || mtimeDay(p), dateHow: DATE_IN.test(body) ? 'text' : 'mtime',
        excerpt: clip(body, 600),
        fields: home === 'rule' ? { profile: ctx.slug, slug: kebab(str(front.name) || n.replace(/\.md$/, ''), 40), text: text.length <= 400 ? text : undefined, for: 'both' }
          : { type: 'gotcha', title, body: body.trim().slice(0, 6000) },
        why: home === 'rule' ? 'a feedback memory is a working rule' : home === '?' ? 'a memory about the person: whose profile it belongs on is the user\'s call'
          : 'a project or reference memory is a fact: a knowledge record',
        needsWords: home === 'rule' && text.length > 400 ? true : undefined,
      });
    }
  }
  return rows;
}

function procedureRows(ctx, files) {
  const rows = [];
  for (const f of files) {
    if (!TEXT_EXT.test(f)) continue;
    if (/^docs\/procedures\/[^/]+\.md$/.test(f)) {
      rows.push({ id: 'proc:' + f, find: 'procedure', home: 'procedure', def: 'keep', group: 'procedures', title: basename(f, '.md'), where: { file: f },
        date: mtimeDay(join(ctx.root, f)), dateHow: 'mtime', excerpt: clip(readText(join(ctx.root, f)), 400), fields: { scan: true },
        why: 'a procedure file: proc scan makes its card' });
      continue;
    }
    if (ctx.trackOfFile.has(f)) continue;
    const text = readText(join(ctx.root, f)) || '';
    for (const s of [...sections(text, 2), ...sections(text, 3)]) {
      if (!STEPS_HEAD.test(s.head)) continue;
      const steps = s.body.split('\n').filter((l) => /^\s{0,3}\d{1,2}[.)]\s+\S/.test(l)).length;
      if (steps < 4) continue;
      rows.push({ id: 'steps:' + f + '#' + kebab(s.head, 50), find: 'steps', home: 'procedure', def: 'leave', group: 'procedures',
        title: clip(basename(f, '.md') + ': ' + plainMd(s.head), 140), where: { file: f, line: s.n }, date: mtimeDay(join(ctx.root, f)), dateHow: 'mtime',
        excerpt: clip(s.body, 600), fields: { scan: false, target: 'docs/procedures/' + kebab(s.head, 40) + '.md' },
        why: steps + ' numbered steps: a procedure card needs them in docs/procedures/, a repo edit the session makes after the write' });
    }
  }
  return rows;
}

/* The old file question queue (.claude/questions/<session>/Qn-*.md): open ones stay questions, answered ones are rulings.
   A row names an old question by its name and folder, never its per-session label, which reads as a board id. */
function questionRows(ctx) {
  const base = join(ctx.root, '.claude', 'questions');
  let sessions = [];
  try { sessions = readdirSync(base, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { return []; }
  const rows = [];
  for (const s of sessions) {
    let names = [];
    try { names = readdirSync(join(base, s)).filter((n) => /^Q\d+.*\.md$/.test(n)); } catch { continue; }
    const read = names.map((n) => ({ n, rel: '.claude/questions/' + s + '/' + n, ...frontmatter(readText(join(base, s, n))) }));
    const nameOf = (x) => oneLine(str(x.front.name) || x.n.replace(/^Q\d+-?/, '').replace(/\.md$/, '').replace(/-/g, ' ')) || 'untitled';
    const byLabel = new Map(read.map((x) => [/^Q(\d+)/.exec(x.n)[1], nameOf(x)]));
    const deQ = (t) => String(t || '').replace(/\bQ(\d+)\b/g, (_, d) => (byLabel.has(d) ? 'the old question "' + byLabel.get(d) + '"' : 'old question ' + d));
    for (const { n, rel, front, body } of read) {
      const status = (str(front.status) || 'open').toLowerCase();
      const paras = body.replace(/^\[.*\]\(.*\)\s*$/m, '').split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p && !p.startsWith('#') && !p.startsWith('|'));
      const ask = str(front.ask) || paras.find((p) => p.includes('?')) || paras[0] || nameOf({ front, n });
      const answer = (/^## Answer\s*\n([\s\S]*)$/m.exec(body) || [])[1] || '';
      const options = body.split('\n').map((l) => /^\|\s*(\d+[a-z])\s*\*?\s*\|\s*([^|]+)\|\s*([^|]*)\|/.exec(l)).filter(Boolean)
        .map((m) => ({ type: m[1].replace(/^\d+/, ''), option: deQ(m[2].trim()), getsYou: deQ(m[3].trim()) }));
      const name = nameOf({ front, n });
      const date = DATE_IN.exec(str(front.created))?.[1] || mtimeDay(join(ctx.root, rel));
      const live = status === 'open' || status === 'snoozed';
      const id = 'question:' + rel;
      ctx.oldQuestions.set(id, { label: /^Q(\d+)/.exec(n)[1], dates: [date, mtimeDay(join(ctx.root, rel))].filter(Boolean), text: name + ' ' + answer, answer });
      rows.push({
        id, find: 'question', home: live ? 'question' : status === 'answered' ? 'decision' : 'none', def: status === 'dropped' ? 'leave' : 'keep',
        group: 'questions', title: clip(name, 140), where: { file: rel }, date, dateHow: 'text', excerpt: clip(deQ(body), 600),
        fields: live ? { name: clip(name, 80), ask: clip(deQ(ask).replace(/\n/g, ' '), 600), gist: '**From the old queue:** "' + clip(name, 80) + '" in .claude/questions/' + s + '/, asked ' + date,
          blocking: str(front.blocking) === 'true', options, pick: str(front.pick).replace(/^\d+/, '') || undefined }
          : { title: clip('Ruling: ' + name, 160), words: clip(answer, 400), body: (body.trim()).slice(0, 6000) },
        why: live ? 'an open question in the old queue goes on the board unanswered' : status === 'answered' ? 'an answered question is a ruling: a decision record with the answer in its words' : 'dropped in the old queue',
      });
    }
  }
  return rows;
}

/* Folders of another homemade system the survey cannot read: one row each, for the session to place or ask about. */
function otherRows(ctx, files) {
  const dirs = new Map();
  for (const f of files) {
    const m = /^(\.[A-Za-z][\w-]*)\//.exec(f);
    if (!m || /^\.(git|github|vscode|idea|claude|gitea|husky)$/.test(m[1])) continue;
    dirs.set(m[1], (dirs.get(m[1]) || 0) + 1);
  }
  for (const d of ['.claude']) {
    let ents = [];
    try { ents = readdirSync(join(ctx.root, d), { withFileTypes: true }); } catch { continue; }
    for (const e of ents) if (e.isDirectory() && !/^(questions|worktrees|commands|agents|skills|hooks)$/.test(e.name)) dirs.set(d + '/' + e.name, 0);
  }
  return [...dirs].map(([d, n]) => ({
    id: 'other:' + d, find: 'other', home: '?', def: 'leave', group: 'unplaced', title: d + '/', where: { file: d + '/' },
    date: mtimeDay(join(ctx.root, d)), dateHow: 'mtime', excerpt: n ? n + ' files' : 'a folder', fields: {},
    why: 'a folder of another tool or homemade system: read it and place what it holds, or ask',
  }));
}

/* ---- staleness, against the project's own pace ---- */

const ACTIVE_DAYS = 7;
const DONE = '(?:done|complete|completed|finished|closed|superseded|obsolete)';
const STATUS_DONE = new RegExp('^\\W*(?:status|state)\\W*:?\\W*' + DONE + '\\b', 'i');
const WHOLE_DONE = new RegExp('\\bthis (?:handoff|file) (?:is|was) (?:now )?' + DONE + '\\b', 'i');
const HEAD_DONE = new RegExp('\\bthe handoff (?:is|was) (?:now )?' + DONE + '\\b', 'i');

/* Finished only from a statement about the whole handoff: its frontmatter status, a status line,
   "superseded by" or "the handoff is done" before its first section, or "this handoff is done"
   anywhere. A section's status (a step done, "Parked work: None") says nothing about the file. */
function saysDone(text) {
  const { front, body } = frontmatter(text || '');
  if (new RegExp('^' + DONE + '\\b', 'i').test(str(front.status) || str(front.state))) return true;
  const lines = body.split('\n');
  const first = lines.findIndex((l) => /^#{2,6}\s/.test(l));
  const head = lines.slice(0, first < 0 ? lines.length : first);
  if (head.some((l) => STATUS_DONE.test(l) || HEAD_DONE.test(l) || /\bsuperseded by\b/i.test(l))) return true;
  return lines.some((l) => WHOLE_DONE.test(l));
}

/* Recent means on or after the project's seventh newest day with a commit (file times outside git),
   so a quiet project's window reaches back to its own last work and a young one judges nothing stale. */
function activityOf(ctx, files) {
  let days = ctx.isGit ? (git(ctx.root, ['log', '-n', '20000', '--format=%aI']) || '').split('\n').filter(Boolean).map((s) => s.slice(0, 10)) : [];
  if (!days.length) days = files.map((f) => mtimeDay(join(ctx.root, f))).filter(Boolean);
  const distinct = [...new Set(days)].sort().reverse();
  return { days, since: distinct.length >= ACTIVE_DAYS ? distinct[ACTIVE_DAYS - 1] : null, unit: ctx.isGit ? 'commit' : 'file change' };
}

/* Sets each live-work row's proposal (tracks, tasks, open questions) from its last change and the current
   state file (picked below); a row it cannot settle gets call: true. Rulings and facts do not age. */
function judgeStaleness(ctx, rows, files) {
  const act = activityOf(ctx, files);
  const recent = (day) => !act.since || (day && day >= act.since);
  const quiet = (day) => { const n = act.days.filter((d) => d > day).length; return 'last changed ' + day + ', with ' + n + ' ' + act.unit + (n === 1 ? '' : 's') + ' in the project since'; };
  const lastOf = (r) => r.fields.history[r.fields.history.length - 1];
  /* the state file: one the project's guides point at, else a file kept over many recent versions
     before a one-version note, else the newest */
  const kept = (r) => r.fields.history.filter((v) => v.commit).length > 1 && recent(lastOf(r).at.slice(0, 10));
  const rank = (r) => (r.pointedBy ? 2 : 0) + (kept(r) ? 1 : 0);
  const hand = rows.filter((r) => r.find === 'handoff').sort((a, b) => rank(b) - rank(a) || Date.parse(lastOf(b).at) - Date.parse(lastOf(a).at));
  const current = hand.find((r) => r.fields.state !== 'finished');
  const stateFile = current ? lastOf(current).file : null;
  const stateText = ((stateFile && readText(join(ctx.root, stateFile))) || '').toLowerCase();
  const names = (r) => r !== current && Boolean(stateText) && [...(r.fields.files || [r.where.file]).map((f) => basename(f).toLowerCase()),
    r.title.length >= 12 ? r.title.toLowerCase() : null].filter(Boolean).some((s) => stateText.includes(s));
  const unnamed = stateFile ? stateFile + ' (the state file) does not name it' : 'no live handoff names it';

  for (const r of hand) {
    if (r.fields.state === 'finished') continue;
    const h = r.fields.history;
    const day = lastOf(r).at.slice(0, 10);
    const set = (state, def, why, call) => {
      Object.assign(r.fields, { state, parkReason: state === 'parked' ? 'imported: the old handoff was last changed ' + day : undefined });
      r.def = def; r.why += '; ' + why;
      if (call) r.call = true;
    };
    const done = saysDone(readText(join(ctx.root, lastOf(r).file)));
    /* the state file's own word is not enough to close the live line: the user judges it */
    if (done && r === current) set(recent(day) ? 'waiting' : 'parked', 'keep', 'its own text says it is done, yet it is the state file: finished, or still the live line?', true);
    else if (done) set('finished', 'keep', 'its own text says it is done or superseded, so the track comes in finished');
    else if (r === current && recent(day)) set('waiting', 'keep', 'the state file, changed within the project\'s recent activity, so it waits to be resumed');
    else if (r === current) set('parked', 'keep', 'the state file, but ' + quiet(day) + ': is it still the live line?', true);
    else if (names(r)) set('parked', 'keep', stateFile + ', the state file, still names it, so the track is parked');
    /* the project named its state file, so a one-version note that file never names is a checkpoint, not a live line */
    else if (recent(day) && current && current.pointedBy && h.filter((v) => v.commit).length <= 1) {
      set('parked', 'leave', 'one version, and ' + stateFile + ', which ' + current.pointedBy.join(' and ') + ' name' + (current.pointedBy.length === 1 ? 's' : '') + ' as the state file, does not name it: a parked lane checkpoint, left in its file; Keep brings it in as a parked track');
    } else if (recent(day)) set('parked', 'keep', 'changed within the project\'s recent activity but not the state file: a second live line, or done?', true);
    else if (h.every((v) => v.at.slice(0, 10) === h[0].at.slice(0, 10))) set('finished', 'leave', quiet(day) + ', all on one day, and ' + unnamed + ': a one-off brief long past');
    else set('finished', 'keep', quiet(day) + ' and ' + unnamed + ', so the track comes in finished, as history');
  }

  const byId = new Map(rows.map((r) => [r.id, r]));
  const tasks = rows.filter((r) => r.find === 'task');
  for (const r of rows.filter((x) => x.find === 'list')) {
    const day = tasks.filter((t) => t.fields.track === r.id).map((t) => t.date).filter(Boolean).sort().pop() || r.date;
    if (r.fields.state === 'finished' || recent(day) || names(r)) continue;
    r.def = 'leave';
    r.why += '; but ' + quiet(day) + ' and ' + unnamed + ', so it stays in the old file';
  }
  for (const t of tasks) {
    const tr = t.fields.track && byId.get(t.fields.track);
    if (tr && tr.def === 'leave') { t.def = 'leave'; t.why += '; its list stays in the old file'; }
    else if (tr && tr.fields.state === 'finished' && t.fields.status === 'open') { t.def = 'leave'; t.why += '; its track comes in finished, so an item still open there stays in the old file'; }
    else if (!tr && !recent(t.date) && !names(t)) { t.def = 'leave'; t.why += '; but ' + quiet(t.date) + ' and ' + unnamed; }
  }
  for (const q of rows.filter((x) => x.find === 'question' && x.home === 'question')) {
    if (recent(q.date) || names(q)) continue;
    q.def = 'leave'; q.call = true;
    q.why += '; but it was asked ' + q.date + ', before the project\'s recent activity, and ' + unnamed + ': it may be settled or moot';
  }
  return { since: act.since, stateFile, stateNamedBy: current && current.pointedBy || undefined };
}

/* ---- old answers that repeat a decision log entry ---- */

const STOP = new Set('that this with from have will when what which they them then than into only also each more must should would could does about there their where while after before answer chosen question because these those were been being your over just like some such'.split(' '));
const words = (s) => String(s || '').toLowerCase().match(/[a-z0-9]+/g) || [];
const tokens = (s) => new Set(words(s).filter((w) => w.length >= 4 && !STOP.has(w)));
const grams = (ws, n = 6) => { const g = new Set(); for (let i = 0; i + n <= ws.length; i++) g.add(ws.slice(i, i + n).join(' ')); return g; };

/* A sure match (a quoted run of the answer, or the label or date with shared words) leaves the question's copy;
   a weaker one becomes a call shown beside its entry. */
function matchRulings(ctx, rows) {
  const entries = rows.filter((r) => r.find === 'decision').map((r) => {
    const text = r.title + '\n' + (r.fields.body || '');
    return { r, text, tok: tokens(text), grams: grams(words(text)) };
  });
  if (!entries.length) return;
  for (const q of rows.filter((x) => x.find === 'question' && x.home === 'decision')) {
    const m = ctx.oldQuestions.get(q.id);
    if (!m) continue;
    const qt = tokens(m.text);
    const qg = grams(words(m.answer));
    const cites = new RegExp('\\bQ' + m.label + '\\b|\\b' + m.label + '[a-z]\\b');
    let best = null;
    for (const e of entries) {
      const label = cites.test(e.text);
      const date = m.dates.some((d) => e.text.includes(d));
      let shared = 0;
      for (const w of qt) if (e.tok.has(w)) shared++;
      const ov = shared >= 3 ? shared / Math.min(qt.size, e.tok.size) : 0;
      let quote = false;
      for (const g of qg) if (e.grams.has(g)) { quote = true; break; }
      const sure = quote || (label && (date || ov >= 0.3)) || (date && ov >= 0.5);
      if (!(sure || label || (date && ov >= 0.25) || ov >= 0.5)) continue;
      const score = (quote ? 3 : 0) + (label ? 2 : 0) + (date ? 1 : 0) + ov * 2;
      if (!best || score > best.score) best = { e: e.r, sure, score };
    }
    if (!best) continue;
    const entry = (best.e.entry ? best.e.entry + ' ' : '') + 'in ' + best.e.where.file + ' line ' + best.e.where.line;
    if (best.sure) Object.assign(q, { def: 'leave', repeats: best.e.id, why: 'the decision log entry ' + entry + ' holds this ruling and comes in as the ruling in force, so this copy stays out' });
    else Object.assign(q, { call: true, pair: best.e.id, why: 'it may hold the same ruling as the decision log entry ' + entry + ', shown beside it: if it does, leave this copy' });
  }
}

/* ---- git history: subjects and file paths only, never diffs, over the newest HISTORY_CAP commits ---- */

export const HISTORY_CAP = 3000;
/* modest on purpose: a commit message is a claim, so each hit is a call or evidence, never a ruling */
const RULING_WORD = /\b(?:chose|decided|settled on|going with|superseded by|revert(?:ed|ing)? to)\b/i;
const RULING_NAME = /\b[A-Z][a-z]{2,} (?:asked for|wants|wanted|chose|approved|ruled|decided|picked)\b|\b[A-Z][a-z]{2,}'s (?:call|pick|ruling|choice)\b/;
/* a commit that writes a note, brief or mock about a ruling is not where the ruling lives */
const ABOUT_A_NOTE = /\b(?:(?:state|wave|lane)(?:'s)? note|briefs?|mocks?|sheet)\b/i;
/* read on the branch name alone: a subject's words say what a commit did, not what the branch was */
const TRIED = /\b(?:wip|spike|experiment|trial|poc|prototype|scratch|abandon(?:ed)?)\b/i;
const areaOf = (p) => (p.includes('/') ? p.split('/')[0] + '/' : '(top level)');
const planningKind = (ctx, p) => {
  if (!TEXT_EXT.test(p) || /changelog/i.test(p)) return null;
  const forced = ctx.include.get(p);
  if (forced) return forced;
  const b = basename(p);
  return HANDOFF_NAME.test(b) ? 'handoff' : DECISION_NAME.test(b) || /(^|\/)(adr|decisions)\//i.test(p) ? 'decisions' : LIST_NAME.test(b) ? 'list' : null;
};

function readHistory(root) {
  const out = git(root, ['-c', 'core.quotepath=false', 'log', '-n', String(HISTORY_CAP), '-M', '--name-status', '--format=%x1e%H%x09%aI%x09%s']);
  const commits = [];
  for (const rec of (out || '').split('\x1e').slice(1)) {
    const [head, ...rest] = rec.split('\n');
    const [commit, at, subject = ''] = head.split('\t');
    const files = rest.filter(Boolean).map((l) => { const p = l.split('\t'); return { status: p[0][0], path: slashed(p[p.length - 1]), from: p.length > 2 ? slashed(p[1]) : null }; });
    commits.push({ commit, short: commit.slice(0, 10), day: at.slice(0, 10), subject: oneLine(subject), files });
  }
  const total = Number((git(root, ['rev-list', '--count', 'HEAD']) || '').trim()) || commits.length;
  return { commits, total };
}

/* Rows from the history: rulings told only in commit messages, deleted planning files, the project arc,
   reverts and branches left unmerged. Newest commit first throughout. */
function historyRows(ctx, rows, files, since) {
  const { commits, total } = readHistory(ctx.root);
  if (!commits.length) return null;
  const out = [];
  const present = new Set(files);
  const quoted = (s) => '"' + clip(s, 100) + '"';

  /* 1. rulings: evidence on a log entry that says the same, else the user's call */
  const known = rows.filter((r) => r.home === 'decision').map((r) => ({ r, tok: tokens(r.title + '\n' + ((r.fields && r.fields.body) || '')) }));
  let rulings = 0;
  for (const c of commits) {
    /* a merge's subject retells its branch's commits */
    if (/^(?:[\w-]+(?:, [\w-]+)*: )?(?:merge|revert ")/i.test(c.subject)) continue;
    if (!(RULING_WORD.test(c.subject) || RULING_NAME.test(c.subject)) || ABOUT_A_NOTE.test(c.subject)) continue;
    const tok = tokens(c.subject);
    let best = null;
    for (const e of known) {
      let n = 0;
      for (const w of tok) if (e.tok.has(w)) n++;
      const ov = n >= 3 ? n / Math.min(tok.size, e.tok.size) : 0;
      if (ov >= 0.6 && (!best || ov > best.ov)) best = { r: e.r, ov };
    }
    rulings++;
    const row = {
      id: 'history:ruling:' + c.short, find: 'history', home: 'decision', def: 'leave', group: 'history: rulings in commit messages',
      title: clip(c.subject, 160), where: { file: 'commit message', commit: c.short }, date: c.day, dateHow: 'commit',
      excerpt: clip(c.subject + ' (' + c.files.length + ' files, ' + [...new Set(c.files.map((f) => areaOf(f.path)))].slice(0, 5).join(', ') + ')', 600),
      fields: { title: clip(c.subject, 160), body: c.subject + '\n\nRecorded only in the subject of commit ' + c.short + ', ' + c.day + '.' },
    };
    if (best) {
      Object.assign(row, { evidence: best.r.id, why: 'a commit message that tells the same ruling as ' + best.r.title + ' (' + best.r.where.file + '): evidence for that row, so this copy stays out' });
      /* a field, not the why: the discovery pass rewrites a row's why */
      (best.r.evidenceFrom = best.r.evidenceFrom || []).push({ commit: c.short, day: c.day, subject: clip(c.subject, 160) });
    } else {
      Object.assign(row, { call: true, why: 'a ruling told only in a commit message: a commit message is a claim, so whether it is a ruling in force is the user\'s call' });
    }
    out.push(row);
  }

  /* 2. planning files deleted from the repo, one row per series: the newest deletion of each path */
  const gone = new Map();
  commits.forEach((c, i) => {
    for (const f of c.files) {
      if (f.status !== 'D' || gone.has(f.path) || present.has(f.path) || ctx.exclude.some((re) => re.test(f.path))) continue;
      const kind = planningKind(ctx, f.path);
      if (!kind) continue;
      const prev = commits.slice(i + 1).find((o) => o.files.some((x) => x.path === f.path && x.status !== 'D'));
      gone.set(f.path, { path: f.path, kind, deletedIn: c.short, day: c.day, subject: c.subject, lastVersion: prev ? prev.short : c.short + '^' });
    }
  });
  const series = new Map();
  for (const g of gone.values()) { const k = seriesKey(g.path); if (!series.has(k)) series.set(k, []); series.get(k).push(g); }
  for (const [key, list] of series) {
    const g = list[0];
    out.push({
      id: 'history:deleted:' + key, find: 'history', home: '?', def: 'leave', call: true, group: 'history: deleted planning files',
      title: list.length === 1 ? g.path : humanName(key) + ' (' + list.length + ' files)', where: { file: g.path, commit: g.deletedIn }, date: g.day, dateHow: 'commit',
      excerpt: clip(list.map((x) => x.path + ' deleted in ' + x.deletedIn + ' (' + x.day + '), last version at ' + x.lastVersion).join('; '), 600),
      fields: { kind: g.kind, files: list.map((x) => ({ path: x.path, deletedIn: x.deletedIn, day: x.day, subject: x.subject, lastVersion: x.lastVersion, read: 'git show ' + x.lastVersion + ':' + x.path })) },
      why: 'a ' + g.kind + ' file deleted from the repo: read its last version and say whether anything in it still holds (a ruling, a step, a fact), else leave it',
    });
  }

  /* 3. the project arc: commits per top-level area and month */
  const months = new Map();
  const totals = new Map();
  for (const c of commits) {
    const m = c.day.slice(0, 7);
    if (!months.has(m)) months.set(m, { n: 0, areas: new Map() });
    const mo = months.get(m);
    mo.n++;
    for (const a of new Set(c.files.map((f) => areaOf(f.path)))) { mo.areas.set(a, (mo.areas.get(a) || 0) + 1); totals.set(a, (totals.get(a) || 0) + 1); }
  }
  const top = (map, n) => [...map].sort((a, b) => b[1] - a[1]).slice(0, n).map(([a, k]) => a + ' ' + k).join(', ');
  const first = commits[commits.length - 1].day;
  const last = commits[0].day;
  const arcBody = ['Commits per top-level area (a commit counts once per area it touches), from ' + first + ' to ' + last + ', ' + commits.length + ' commits'
    + (total > commits.length ? ' (the newest ' + commits.length + ' of ' + total + ')' : '') + '.', '', 'Whole span: ' + top(totals, 10) + '.', '',
  ...[...months].map(([m, mo]) => m + ': ' + mo.n + ' commits; ' + top(mo.areas, 6) + '.')].join('\n');
  out.push({
    id: 'history:arc', find: 'history', home: 'knowledge', def: 'keep', group: 'history: project arc', title: 'Project arc: where the commits went, by area and month',
    where: { file: 'git history', commit: commits[0].short }, date: last, dateHow: 'commit', excerpt: clip(arcBody, 600),
    fields: { type: 'gotcha', title: 'Project arc: where the commits went, by area and month', body: arcBody.slice(0, 6000) },
    why: 'where the work actually went, from the commits: a fact for staleness verdicts and for later sessions',
  });

  /* 4. tried and dropped: reverts, and branches with commits not on HEAD and none recent */
  let reverts = 0;
  commits.forEach((c, i) => {
    const m = /^Revert "(.*?)"?$/.exec(c.subject);
    if (!m) return;
    reverts++;
    const was = m[1];
    const again = /^Revert "/.test(was) || commits.slice(0, i).some((o) => o.subject === was);
    const title = clip('Tried and reverted: ' + was, 160);
    out.push({
      id: 'history:revert:' + c.short, find: 'history', home: 'knowledge', def: again ? 'leave' : 'keep', ...(again ? { call: true } : {}), group: 'history: tried and dropped',
      title, where: { file: 'commit message', commit: c.short }, date: c.day, dateHow: 'commit', excerpt: clip(c.subject, 600),
      fields: { type: 'gotcha', title, body: quoted(was) + ' was reverted in commit ' + c.short + ' on ' + c.day + '.' },
      why: again ? 'a revert of a revert, or the change landed again later: whether it stays dropped is the user\'s call' : 'a change tried and taken back: a note so no session tries it again blind',
    });
  });
  const head = (git(ctx.root, ['rev-parse', '--abbrev-ref', 'HEAD']) || '').trim();
  const refsOf = (extra) => (git(ctx.root, ['for-each-ref', '--sort=-committerdate', ...extra, '--format=%(refname)%09%(refname:short)%09%(committerdate:iso-strict)%09%(subject)', 'refs/heads', 'refs/remotes']) || '').split('\n').filter(Boolean)
    .map((l) => { const [ref, name, at, subject = ''] = l.split('\t'); return { ref, name, day: (at || '').slice(0, 10), subject }; });
  const locals = new Set(refsOf([]).filter((r) => r.ref.startsWith('refs/heads/')).map((r) => r.name));
  let branches = 0;
  /* only refs with commits HEAD lacks, so merged branches never use up the cap */
  for (const b of refsOf(['--no-merged=HEAD']).filter((r) => since && r.day && r.day < since && r.name !== head && !/\/HEAD$/.test(r.ref)
    && !(r.ref.startsWith('refs/remotes/') && locals.has(r.name.replace(/^[^/]+\//, '')))).slice(0, 50)) {
    const ahead = Number((git(ctx.root, ['rev-list', '--count', 'HEAD..' + b.ref]) || '0').trim());
    if (!ahead) continue;
    branches++;
    const tried = TRIED.test(b.name);
    const title = clip('Branch never merged: ' + b.name, 160);
    out.push({
      id: 'history:branch:' + b.name, find: 'history', home: 'knowledge', def: tried ? 'keep' : 'leave', ...(tried ? {} : { call: true }), group: 'history: tried and dropped',
      title, where: { file: 'branch ' + b.name }, date: b.day, dateHow: 'commit', excerpt: clip(ahead + ' commits not on ' + head + ', the last on ' + b.day + ': ' + b.subject, 600),
      fields: { type: 'gotcha', title, body: 'Branch ' + b.name + ' holds ' + ahead + ' commits not on ' + head + '; its last, on ' + b.day + ': ' + quoted(b.subject) + '.' },
      why: tried ? 'an experiment left unmerged with nothing since the project\'s recent activity: a tried-and-dropped note'
        : 'left unmerged with nothing since the project\'s recent activity: dropped, or parked work to resume, is the user\'s call',
    });
  }
  return { rows: out, cap: HISTORY_CAP, read: commits.length, total, rulings, deleted: series.size, reverts, branches, months: months.size };
}

/* ---- what the board already holds (reads only) ---- */

function cliJson(cli, args, env) {
  const r = spawnSync(process.execPath, [cli, ...args, '--json'], { encoding: 'utf8', windowsHide: true, env, maxBuffer: 64 << 20 });
  if (r.status !== 0) return { error: oneLine(r.stderr || r.stdout || 'exit ' + r.status) };
  try { return { value: JSON.parse(r.stdout) }; } catch { return { error: 'not JSON: ' + clip(r.stdout, 120) }; }
}

export function boardState(cli, { shared, slug, dir, env = process.env }) {
  const out = { read: new Date().toISOString(), errors: [] };
  const get = (args) => { const r = cliJson(cli, args, env); if (r.error) out.errors.push(args.join(' ') + ': ' + r.error); return r.value; };
  const mine = (x) => (x.projectRepos || []).includes(shared);
  const label = 'import:' + slug;
  out.workstreams = (get(['list', '--kind', 'workstream', '--all']) || []).filter(mine)
    .map((w) => ({ id: w.id, name: w.name, status: w.status, labels: w.labels || [] }));
  const imported = [];
  for (const kind of ['workstream', 'task', 'knowledge']) {
    for (const r of get(['list', '--kind', kind, '--all', '--label', label]) || []) imported.push({ id: r.id, kind, name: r.name, refs: r.refs || [] });
  }
  out.knowledge = (get(['list', '--kind', 'knowledge', '--all']) || []).filter(mine).map((k) => ({ id: k.id, name: k.name, type: k.type, status: k.status }));
  /* a profile is this project's when every record holding it is the project or one of its workstreams */
  const ws = new Set(out.workstreams.map((w) => w.id));
  const low = (s) => slashed(s).toLowerCase();
  const here = (h) => h.repo === shared || [dir, shared].some((d) => d && low(h.record) === low(d)) || ws.has(h.record);
  const profiles = get(['profile', 'list']);
  out.profiles = profiles ? profiles.profiles.map((p) => ({
    profile: p.profile, builtIn: p.builtIn === true, records: p.records || [], rules: ((p.settings || {})['rules.add'] || []).map((x) => x.slug),
    here: (p.held || []).some(here), elsewhere: (p.held || []).some((h) => !here(h)),
  })) : [];
  out.tracks = out.workstreams.flatMap((w) => ((get(['track', 'list', '--workstream', w.id, '--all']) || {}).tracks || [])
    .map((t) => ({ id: t.id, name: t.name, state: t.state, workstream: w.id, labels: t.labels || [], refs: t.refs || [] })));
  for (const t of out.tracks) if (t.labels.includes(label)) imported.push({ id: t.id, kind: 'track', name: t.name, refs: t.refs });
  for (const q of (get(['list', '--all', '--project', dir]) || {}).questions || []) {
    if ((q.labels || []).includes(label)) imported.push({ id: q.id, kind: 'question', name: q.name, refs: q.refs || [] });
  }
  out.imported = imported;
  return out;
}

/* ---- the survey ---- */

export function survey(dir, { work, cli = DEFAULT_CLI, board = true, manifestFile, env = process.env } = {}) {
  const top = git(dir, ['rev-parse', '--show-toplevel']);
  const root = slashed(top ? top.trim() : resolve(dir));
  const isGit = Boolean(top);
  const slug = kebab(basename(root), 30);
  const shared = (isGit && sharedName(root)) || root.toLowerCase();
  const workDir = work || join(dataDir(env) || join(homedir(), '.claude', 'askerdo-onboard'), 'onboard', slug);
  const over = readJson(join(workDir, 'overrides.json')) || {};
  const ctx = {
    root, isGit, slug,
    /* the user's own Claude memory, wherever the AskerDo data dir is */
    claudeHome: env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'),
    include: new Map((over.include || []).map((x) => [slashed(x.path), x.as])), trackOfFile: new Map(), oldQuestions: new Map(),
  };
  const exclude = ctx.exclude = (over.exclude || []).map((g) => new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\0').replace(/\*/g, '[^/]*').replace(/\0/g, '.*') + '$'));
  const files = listFiles(root, isGit).filter((f) => !exclude.some((re) => re.test(f)));

  let rows = [
    ...handoffRows(ctx, files), ...decisionRows(ctx, files), ...questionRows(ctx), ...ruleRows(ctx, files),
    ...memoryRows(ctx), ...procedureRows(ctx, files), ...otherRows(ctx, files),
  ];
  const decisionFiles = new Set(rows.filter((r) => r.find === 'decision').map((r) => r.where.file));
  rows.push(...taskRows(ctx, files.filter((f) => !decisionFiles.has(f))));
  const activity = judgeStaleness(ctx, rows, files);
  matchRulings(ctx, rows);
  /* after the log rows, so a commit that repeats an entry lands as evidence on it */
  const history = isGit ? historyRows(ctx, rows, files, activity.since) : null;
  if (history) rows.push(...history.rows);
  const codeTodos = files.filter((f) => /\.(m?[jt]sx?|cs|py|rs|go|java|c|cpp|h)$/.test(f))
    .reduce((n, f) => n + ((readText(join(root, f)) || '').match(/\b(TODO|FIXME)\b/g) || []).length, 0);

  const bs = board ? boardState(cli, { shared, slug, dir: root, env }) : null;
  const ws = bs && bs.workstreams.find((w) => w.status === 'open' && !/inbox$/i.test(w.name));
  const readme = (readText(join(root, 'README.md')) || '').split(/\n\s*\n/).map((p) => p.trim()).find((p) => p && !p.startsWith('#') && !p.startsWith('!['));
  rows.unshift(ws
    ? { id: 'ws:main', find: 'board', home: 'workstream', def: 'keep', group: 'workstreams', title: ws.name, where: { file: 'the board' }, date: null,
      excerpt: ws.id + ' already holds this project', fields: { use: ws.id, key: 'main' }, why: 'the board already has a workstream for this project: the import goes into it' }
    : { id: 'ws:main', find: 'project', home: 'workstream', def: 'keep', group: 'workstreams', title: basename(root), where: { file: 'README.md' },
      date: isGit ? (git(root, ['log', '--reverse', '--format=%aI']) || '').split('\n')[0].slice(0, 10) || null : null, dateHow: 'commit',
      excerpt: clip(readme || '', 600), fields: { key: 'main', name: basename(root), description: clip(readme || 'The ' + basename(root) + ' project.', 1000) },
      why: 'no workstream on the board holds this project yet: one for the project, dated by its first commit' });

  /* the session's own layer: rows it adds, then patches by row id (reaching added rows too), workstreams it names */
  rows.push(...(over.add || []));
  const warnings = [];
  for (const [id, p] of Object.entries(over.rows || {})) {
    const hit = rows.filter((r) => r.id === id);
    if (!hit.length) warnings.push('overrides.json rows names ' + id + ', and no row has that id');
    for (const r of hit) Object.assign(r, { ...p, fields: { ...r.fields, ...(p.fields || {}) } });
  }
  const seen = new Map();
  for (const r of rows) { const n = (seen.get(r.id) || 0) + 1; seen.set(r.id, n); if (n > 1) r.id += '~' + n; }
  for (const w of over.workstreams || []) {
    const i = rows.findIndex((r) => r.id === 'ws:' + w.key);
    const row = { id: 'ws:' + w.key, find: 'session', home: 'workstream', def: 'keep', group: 'workstreams', title: w.name || w.use, where: { file: 'the session' },
      date: w.created || null, excerpt: w.description || '', fields: { ...w }, why: w.why || 'named by the session' };
    if (i >= 0) rows[i] = { ...rows[i], ...row, fields: { ...rows[i].fields, ...w } }; else rows.push(row);
  }

  /* a rerun proposes only what is new: rows the manifest or the board's refs already hold drop out */
  const manifest = readJson(manifestFile || join(workDir, 'manifest.json'));
  const done = new Set([...(manifest ? manifest.imports.flatMap((i) => i.steps.map((s) => s.row)) : []), ...(manifest ? manifest.left || [] : [])]);
  for (const r of bs ? bs.imported : []) for (const ref of r.refs) if (ref.startsWith('onboard:')) done.add(ref.slice(8));
  /* with no manifest on this PC: a track with no row ref (made by hand, or before tracks carried one) matches by
     name, and a rule line by its slug on a profile only this project holds, or on its own profile when nothing holds it */
  const named = (name) => String(name || '').trim().toLowerCase();
  const refless = bs ? bs.tracks.filter((t) => !(t.refs || []).some((x) => String(x).startsWith('onboard:'))) : [];
  for (const r of rows) {
    if (r.home === 'track' && refless.some((t) => named(t.name) === named(r.fields.name))) done.add(r.id);
    if (r.home === 'rule' && bs && bs.profiles.some((p) => !p.elsewhere && !p.builtIn && (p.here || p.profile === r.fields.profile) && p.rules.includes(r.fields.slug))) done.add(r.id);
  }
  const already = rows.filter((r) => done.has(r.id) && r.id !== 'ws:main');
  const wsDone = manifest && manifest.imports.flatMap((i) => i.steps).find((s) => s.row === 'ws:main' && s.kind === 'workstream');
  if (wsDone) Object.assign(rows[0], { fields: { use: wsDone.id, key: 'main' }, excerpt: wsDone.id + ' was made by the last import', why: 'the last import made it' });
  rows = rows.filter((r) => !already.includes(r));

  const finds = {};
  for (const r of rows) finds[r.find] = (finds[r.find] || 0) + 1;
  const homes = {};
  for (const r of rows) homes[r.home] = (homes[r.home] || 0) + 1;
  const doc = {
    made: new Date().toISOString(), project: { dir: root, slug, shared, name: basename(root), git: isGit },
    work: slashed(workDir), board: bs, finds, homes, already: already.length, codeTodos, activity, history: history && { ...history, rows: undefined }, warnings,
    unplaced: rows.filter((r) => r.home === '?').map((r) => r.id), rows,
  };
  mkdirSync(workDir, { recursive: true });
  writeFileSync(join(workDir, 'rows.json'), JSON.stringify(doc, null, 2) + '\n');
  return doc;
}

/* ---- run ---- */

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const a = process.argv.slice(2);
  const flag = (n) => { const i = a.indexOf('--' + n); return i >= 0 ? a.splice(i, 2)[1] : undefined; };
  const work = flag('work'); const cli = flag('cli'); const manifestFile = flag('manifest');
  const noBoard = a.includes('--no-board'); if (noBoard) a.splice(a.indexOf('--no-board'), 1);
  if (!a[0] || a[0] === '--help') { console.log('node survey.mjs <project dir> [--work <dir>] [--cli <path>] [--no-board] [--manifest <file>]'); process.exit(a[0] ? 0 : 1); }
  if (!existsSync(a[0])) { console.error('survey: no folder ' + a[0]); process.exit(1); }
  const d = survey(a[0], { work, cli: cli || DEFAULT_CLI, board: !noBoard, manifestFile });
  console.log('Survey of ' + d.project.dir + ' (' + d.project.shared + ')' + (d.project.git ? '' : ', not a git repo: dates are file times'));
  console.log('Found: ' + Object.entries(d.finds).map(([k, v]) => k + ' ' + v).join(', ') + (d.codeTodos ? '; ' + d.codeTodos + ' TODO comments in code stay in the code' : ''));
  console.log('Proposed homes: ' + Object.entries(d.homes).map(([k, v]) => (k === '?' ? 'unplaced' : k) + ' ' + v).join(', '));
  if (d.board) console.log('On the board already: ' + d.board.workstreams.map((w) => w.id + ' ' + w.name).join(', ') + (d.board.workstreams.length ? '; ' : '')
    + d.board.imported.length + ' records from an earlier import, ' + d.board.knowledge.length + ' knowledge records for the project'
    + (d.board.errors.length ? '\nBoard reads that failed: ' + d.board.errors.join('; ') : ''));
  const h = d.history;
  const st = d.activity;
  if (st.stateFile) console.log('State file: ' + st.stateFile + (st.stateNamedBy ? ' (' + st.stateNamedBy.join(' and ') + ' name' + (st.stateNamedBy.length === 1 ? 's' : '') + ' it)' : ' (no guide names one: picked by its history; include the right one if it is wrong)'));
  if (h) console.log('Git history: the newest ' + h.read + ' of ' + h.total + ' commits (cap ' + h.cap + '), subjects and file paths only: ' + h.rulings + ' rulings in commit messages, '
    + h.deleted + ' deleted planning files, ' + h.reverts + ' reverts, ' + h.branches + ' branches left unmerged, the arc over ' + h.months + ' months');
  if (d.already) console.log('Left out as done by an earlier run: ' + d.already + ' rows');
  for (const w of d.warnings) console.log('Warning: ' + w);
  const calls = d.rows.filter((r) => r.call).length;
  if (calls) console.log('Calls the survey could not settle: ' + calls + ' rows, first on the page');
  if (d.unplaced.length) console.log('Unplaced (place them or ask): ' + d.unplaced.join(', '));
  console.log('rows.json: ' + d.work + '/rows.json');
}
