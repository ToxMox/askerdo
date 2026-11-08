#!/usr/bin/env node
/* the doctor's checks, for a project already on the board. Gathers onboarding's facts, then runs
   the record checks and the reconcile on the board's records, and writes checkup.json: each finding as an item
   of kind fix with its proposed fix, and a call where only the user can settle it. The session judges them and
   writes the fixes it agrees with into proposal.json, for plan.mjs and apply.mjs.
   node checks.mjs <project dir> [--work <dir>] [--cli <path>] */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataDir } from '../../lib/node-helpers.mjs';
import { sharedName } from '../../lib/project-id.mjs';
import { DEFAULT_CLI, DORMANT_DAYS, cliJson, matchRules, sameSubject, survey, surveyLines, tokens } from '../onboard/survey.mjs';
import { clausesOf, covers } from '../onboard/coverage.mjs';
import { kebab } from '../onboard/cites.mjs';
import { folderKey, readFacts } from '../onboard/plan.mjs';
import { projectRoots, resolver } from '../onboard/instructions.mjs';
import { coveredBy, linesHold, seedCovers } from '../onboard/map.mjs';

export const CHECKS = ['rules', 'shape', 'knowledge', 'cards', 'repo', 'kept', 'earlier', 'source', 'gone', 'reconcile'];
const LINE_MAX = 400;
const SHOW_BATCH = 50;
const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const clip = (s, n) => { const t = oneLine(s); return t.length > n ? t.slice(0, n - 3) + '...' : t; };
const slashed = (p) => String(p).replace(/\\/g, '/');
const readText = (p) => { try { return readFileSync(p, 'utf8').replace(/\r\n/g, '\n'); } catch { return null; } };
const readJsonFile = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const day = (s) => String(s || '').slice(0, 10);
const UNPARK_ID = /\b(TR|T|Q)-(\d+)\b/;

/* One finding as a proposal item of kind fix; `call` marks one only the user can settle (callOf makes its call). */
export function checkRow(check, target, { title, where, record, evidence, fix = null, sourceText, call = false, def = 'keep', why, extra = {} }) {
  return {
    id: 'checkup:' + check + ':' + target, kind: 'fix', title: clip(title, 160), text: sourceText || '',
    fields: { check, record: record || null, evidence, fix, ...extra },
    source: where && where.file ? { file: where.file, line: where.line || null, end: null, commit: null } : null,
    cut: def === 'leave', why, covered: null, ...(call ? { call: true } : {}),
  };
}

/* A finding's call: run the fix or leave it. A track pick offers each live track, the option adding the fix
   with that track; a fix with no args waits on the session's words after a keep. */
export function callOf(x) {
  const f = x.fields || {};
  const fx = f.fix || {};
  const options = [];
  const letter = (k) => String.fromCharCode(97 + Math.min(k, 25));
  const tracks = fx.pick === '--track' ? f.tracks || [] : [];
  for (const t of tracks.slice(0, 24)) {
    options.push({ letter: letter(options.length), label: 'put it on ' + t.id + ' ' + t.name,
      effect: { keep: [], drop: [x.id], folders: {}, add: [{ ...x, id: x.id + '@' + t.id, cut: false, fields: { ...f, fix: { ...fx, pick: undefined, args: ['task', 'edit', fx.target, '--track', t.id] } } }] } });
  }
  if (!tracks.length) {
    const ready = fx.args || fx.after || (fx.op === 'profile rule-add' && fx.text);
    options.push({ letter: 'a', label: ready ? 'run the fix as shown' : 'act on it: the session writes the fix from the answer', effect: { keep: [x.id], drop: [], folders: {} } });
  }
  const leave = letter(options.length);
  options.push({ letter: leave, label: 'leave it', effect: { keep: [], drop: [x.id], folders: {} } });
  return { id: x.id, ask: x.title + ' (' + oneLine(f.evidence) + '): ' + oneLine(x.why), options, pick: x.cut || tracks.length ? leave : 'a', answer: null };
}

/* Files a line names, under a folder or a bare name with an extension the repo would hold; a folder
   alone (`config/` in a rule) names a place, never a file that could be gone. */
const PATHISH = /(?<![\w/.:@~-])((?:[\w.-]+\/)+[\w-]+(?:\.[\w-]+)*\.[A-Za-z0-9]{1,8}|[\w-]+(?:\.[\w-]+)*\.(?:md|markdown|txt|json|ya?ml|toml|mjs|cjs|py|ps1|sh))(?![\w/-])/g;
export const pathsIn = (text) => [...new Set([...String(text || '').matchAll(PATHISH)].map((m) => m[1]))];
/* the repo holds a path: tracked, a folder of tracked files, or a bare file name anywhere */
export function holder(root, files) {
  const set = new Set(files);
  return (p) => {
    const q = p.replace(/^\.\//, '').replace(/\/$/, '');
    if (set.has(q) || files.some((f) => f.startsWith(q + '/'))) return true;
    if (!q.includes('/') && files.some((f) => f.endsWith('/' + q))) return true;
    return existsSync(join(root, q));
  };
}

/* ---- the reads beyond the survey's (split from the checks, so a test stubs them) ---- */

/* What ties a record with no project to this repo: a top-level folder as a path (`tools/`), a path the repo
   holds, or the project's own name; a bare word never (Tidewatch's `tools` and `docs` named general records). */
const reEsc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function scopeHit(text, { top = [], has = () => false, names = [] } = {}) {
  const s = String(text || '');
  for (const n of top) if (new RegExp('(?<![\\w/.:@~-])(?:\\./)?' + reEsc(n) + '/').test(s)) return n + '/';
  for (const p of pathsIn(s)) if (p.includes('/') && has(p)) return p;
  for (const n of names) if (n && new RegExp('(?<![\\w-])' + reEsc(n) + '(?![\\w-])', 'i').test(s)) return n;
  return null;
}

/* a failed read leaves the checks it feeds unread (`unread`), so none of them prints a clean count */
export function readDoctor(cli, doc, env = process.env, { knowledge, spawns } = {}) {
  const errors = [];
  const unread = new Set();
  const count = spawns || { n: 0 };
  const get = (args, opts, feeds = []) => {
    count.n++;
    const r = cliJson(cli, args, env, opts);
    if (r.error) { errors.push(args.join(' ') + ': ' + r.error); for (const c of feeds) unread.add(c); }
    return r.value;
  };
  const bs = doc.board || { workstreams: [], tracks: [], tasks: [], knowledge: [], profiles: [], rules: [], decisions: [], imported: [] };
  const root = doc.project.dir;
  const shared = doc.project.shared;
  /* tasks on no track: one track show per workstream with tracks gives the project's inbox; a workstream with none holds only unplaced tasks */
  const inbox = new Map();
  let spanned = false;
  for (const w of bs.workstreams) {
    const t = bs.tracks.find((x) => x.workstream === w.id);
    if (!t) { for (const x of bs.tasks.filter((k) => k.workstream === w.id)) inbox.set(x.id, x); continue; }
    /* the inbox a track show carries spans every workstream sharing the project: one read covers them */
    if (spanned) continue;
    const s = get(['track', 'show', t.id], {}, ['shape']);
    if (s) { spanned = true; for (const x of s.inbox || []) inbox.set(x.id, bs.tasks.find((k) => k.id === x.id) || { id: x.id, name: x.name, status: 'open', workstream: x.workstream && x.workstream.id }); }
  }
  let files = [];
  const g = spawnSync('git', ['ls-files'], { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 64 << 20 });
  if (g.status === 0) files = g.stdout.split('\n').filter(Boolean);
  /* knowledge whole: the project's, and a record with no project whose text names this repo (scopeHit) */
  const all = knowledge || get(['list', '--kind', 'knowledge', '--all'], {}, ['knowledge', 'reconcile']) || [];
  /* a dot folder (`.claude/`) is every repo's tool config, so it names no one project */
  const top = (() => { try { return readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules').map((e) => e.name); } catch { return []; } })();
  const names = [...new Map([String(shared || '').split('/').pop(), basename(root)].filter(Boolean).map((n) => [n.toLowerCase(), n])).values()];
  const has = holder(root, files);
  const mine = (k) => (k.projectRepos || []).includes(shared);
  const scopes = new Map();
  for (const k of all.filter((x) => !(x.projectRepos || []).length && !x.global)) {
    const hit = scopeHit(k.name + ' ' + (k.description || ''), { top, has, names });
    if (hit) scopes.set(k.id, hit);
  }
  const judged = all.filter((k) => k.status !== 'withdrawn' && (mine(k) || scopes.has(k.id)));
  const records = new Map();
  const uniq = [...new Set(judged.map((k) => k.id))];
  for (let i = 0; i < uniq.length; i += SHOW_BATCH) {
    const part = uniq.slice(i, i + SHOW_BATCH);
    const v = get(['show', ...part], {}, ['knowledge', 'reconcile']);
    for (const r of v ? (Array.isArray(v) ? v : [v]) : []) if (r && r.id) records.set(r.id, r);
  }
  const snoozed = ((get(['list', '--project', root, '--snoozed'], {}, ['shape']) || {}).questions || []);
  /* proc scan --check exits 1 when a card has errors, which is when its report matters */
  const cards = get(['proc', 'scan', '--check', '--project', root], { okExit: [1] }, ['cards']) || null;
  /* a park condition on a record already ended is refused: the parked tracks' named records, read for their state */
  const known = new Set([...bs.tasks.map((x) => x.id), ...bs.tracks.map((x) => x.id)]);
  const named = [...new Set(bs.tracks.filter((t) => t.state === 'parked' && !t.unpark).map((t) => (UNPARK_ID.exec(t.parkReason || '') || [])[0]).filter((id) => id && !known.has(id)))];
  const states = new Map();
  for (const r of [].concat(named.length ? get(['show', ...named], {}, ['shape']) || [] : [])) if (r && r.id) states.set(r.id, r.status);
  const runOf = (name) => {
    const found = get(['proc', 'find', name], {}, ['earlier']);
    const card = Array.isArray(found) && found[0] && found[0].id;
    const rec = card ? get(['show', card], {}, ['earlier']) : null;
    const notes = String((rec && (rec.journal || (rec.sections || {}).Journal)) || '').split(/\n(?=\d{4}-\d\d-\d\d)/).filter((n) => n.includes(root) || n.includes(basename(root)));
    return notes.length ? notes[notes.length - 1] : null;
  };
  return {
    inbox: [...inbox.values()], knowledge: all, records, scopes, snoozed, cards, files, states,
    lastRun: { doctor: runOf('doctor-a-project'), onboard: runOf('onboard-a-project') },
    errors, unread: [...unread], spawns: count,
  };
}

/* ---- what earlier runs did, from the project's conversion map, so any PC reads the same ---- */

/* each folder an earlier run deleted or moved, with its commit and new place */
export const endsOf = (conversion) => ((conversion && conversion.folders) || []).filter((f) => f.fate === 'delete' || f.fate === 'move')
  .map((f) => ({ path: folderKey(f.folder), fate: f.fate, at: f.at || null, to: f.to ? folderKey(f.to) : null })).filter((e) => e.path);
/* the end a path went with, and its new place when it moved */
export function endOf(ends, path) {
  const p = folderKey(path);
  const e = ends.find((x) => p === x.path || p.startsWith(x.path + '/'));
  return e ? { ...e, place: e.to ? e.to + p.slice(e.path.length) : null } : null;
}
/* the one record a mapped source became: where a line citing it points now */
const recordOf = (conversion, path) => {
  const s = ((conversion && conversion.sources) || []).find((x) => x.source === path);
  return s && (s.records || []).length === 1 ? s.records[0] : null;
};

/* ---- check 1: rule lines in force ---- */

const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;
const ownerOf = (source) => String(source || '').split(' on ')[0];
export function checkRules(doc, extra) {
  const bs = doc.board || {};
  const rows = [];
  const root = doc.project.dir;
  const has = holder(root, extra.files || []);
  /* a folder an earlier run retired, named by its path in a line */
  const ends = endsOf(doc.conversion);
  const owned = new Set((bs.profiles || []).filter((p) => p.here && !p.elsewhere && !p.builtIn).map((p) => p.profile));
  const builtIns = (bs.rules || []).filter((r) => r.source === 'built in');
  const lineOf = (profile, slug) => (((bs.profiles || []).find((p) => p.profile === profile) || {}).lines || []).find((l) => l.slug === slug) || {};
  /* a setting's row (tests.policy) is no rule line: only a slug takes rule-add or rule-clear */
  const lines = (bs.rules || []).filter((x) => x.source && x.source !== 'built in' && SLUG.test(x.rule));
  /* each line against the built-in lines and, apart, the decisions: a decision reaches sessions only through a line,
     so a line in its words is that ruling in force, never a cover to clear */
  const probe = (board) => matchRules(lines.map((r) => ({ id: r.rule, home: 'rule', fields: { sourceText: String(r.text || ''), slug: r.rule } })), board).map((p) => p.fields);
  const byLine = probe({ rules: builtIns });
  const byRuling = probe({ decisions: bs.decisions || [] });
  for (const [i, r] of lines.entries()) {
    const profile = ownerOf(r.source);
    const meta = lineOf(profile, r.rule);
    const was = { text: r.text, ...(r.for ? { for: r.for } : {}) };
    const target = profile + '/' + r.rule;
    const finds = [];
    const text = String(r.text || '');
    if (text.length > LINE_MAX || /(\.\.\.|…)$/.test(text.trim())) finds.push({ kind: 'long', evidence: text.length + ' characters' + (text.length <= LINE_MAX ? ', ending in a cut' : ''), fix: { op: 'profile rule-add', profile, slug: r.rule, for: r.for || null, sourceText: text, target, was } });
    /* one finding per line; a gone file under a retired folder is that folder's */
    const cited = new Map();
    for (const p of pathsIn(text).filter((x) => !has(x))) { const e = endOf(ends, p); cited.set(e ? e.path : p, e); }
    for (const e of ends.filter((x) => text.includes(x.path + '/') || (x.path.includes('/') && text.includes(x.path)))) cited.set(e.path, e);
    if (cited.size) {
      let words = text;
      for (const [p, e] of cited) { const place = e ? e.to : recordOf(doc.conversion, p); words = place && words ? words.split(p).join(place) : null; }
      finds.push({ kind: 'cites', evidence: 'cites ' + [...cited].map(([p, e]) => p + (e ? ', which an earlier run ' + (e.fate === 'move' ? 'moved to ' + e.to : 'deleted') + (e.at ? ' at ' + e.at.slice(0, 8) : '') : ', which the repo no longer has')).join('; '),
        fix: { op: 'profile rule-add', profile, slug: r.rule, for: r.for || null, sourceText: text, target, was, ...(words ? { text: words } : {}) } });
    }
    const conflict = byRuling[i].conflict;
    if (byLine[i].coveredBy) finds.push({ kind: 'covered', evidence: 'covered by the built-in line ' + byLine[i].coveredBy, fix: { op: 'profile rule-clear', args: ['profile', 'rule-clear', profile, r.rule], target, was } });
    else if (conflict) {
      const d = (bs.decisions || []).find((x) => x.id === conflict.with) || {};
      const words = oneLine(d.words || d.ruling || d.name || d.title);
      finds.push({ kind: 'conflict', call: true, evidence: 'differs from ' + conflict.with + ' in ' + conflict.differs.join(', '),
        fix: { op: 'profile rule-add', profile, slug: r.rule, for: r.for || null, from: conflict.with, sourceText: text, target, was, ...(words.length <= LINE_MAX ? { text: words } : {}) } });
    }
    for (const f of finds) {
      const base = { title: r.rule + ' on ' + profile + ': ' + f.evidence, where: { record: target }, record: target, evidence: f.evidence, sourceText: text };
      if (meta.from) rows.push(checkRow('rules', target + ':' + f.kind, { ...base, call: true, def: 'leave', why: 'it came from a ruling: it changes only with a newer one, so the fix is a ruling first' }));
      else if (!owned.has(profile)) rows.push(checkRow('rules', target + ':' + f.kind, { ...base, call: true, def: 'leave', why: 'this profile holds beyond this project: change it where it is held' }));
      else rows.push(checkRow('rules', target + ':' + f.kind, { ...base, fix: f.fix, call: Boolean(f.call),
        why: f.kind === 'covered' ? 'a built-in line says the same: the profile line goes' : f.fix.op === 'profile rule-add' && !f.fix.text ? 'it needs shorter or new words, which the session gives' : 'reworded as the fix shows', extra: f.fix.op === 'profile rule-add' && !f.fix.text ? { needsWords: true } : {} }));
    }
  }
  return rows;
}

/* ---- check 2: board shape ---- */

const shareTokens = (a, b) => { const ta = tokens(a); let n = 0; for (const w of tokens(b)) if (ta.has(w)) n++; return n; };
const UNPARK = { T: 'task-completes', TR: 'track-ends', Q: 'question-answered' };
const ENDED = ['completed', 'dropped', 'done', 'folded', 'answered', 'finished'];
export function checkShape(doc, extra) {
  const bs = doc.board || {};
  const rows = [];
  /* recent activity: the survey's dormant window back from the latest commit */
  const latest = doc.history && doc.history.latest;
  const since = (doc.activity && doc.activity.since) || (latest ? new Date(Date.parse(latest) - DORMANT_DAYS * 864e5).toISOString().slice(0, 10) : null);
  const live = (bs.tracks || []).filter((t) => !['finished', 'dropped', 'done'].includes(t.state));
  for (const t of (extra.inbox || []).filter((x) => ['open', 'in_progress', undefined].includes(x.status))) {
    const best = live.map((tr) => ({ tr, n: shareTokens(t.name, tr.name) })).filter((x) => x.n >= 2).sort((a, b) => b.n - a.n)[0];
    /* a track moves the task to its own workstream, so the undo needs the one it left */
    const was = { unplaced: t.unplaced || null, ...(t.workstream ? { workstream: t.workstream } : {}) };
    const base = { title: t.name + ' is on no track', record: t.id, evidence: t.id + ' sits in the inbox', sourceText: t.name };
    if (best) rows.push(checkRow('shape', t.id, { ...base, fix: { op: 'task edit', args: ['task', 'edit', t.id, '--track', best.tr.id], target: t.id, was }, why: 'its name shares words with ' + best.tr.id + ' ' + best.tr.name }));
    else rows.push(checkRow('shape', t.id, { ...base, call: true, fix: { op: 'task edit', target: t.id, was, pick: '--track' }, extra: { tracks: live.map((x) => ({ id: x.id, name: x.name })) },
      why: 'no track shares its words: pick one of ' + (live.map((x) => x.id + ' ' + x.name).join(', ') || 'no live track') + ', or leave it in the inbox' }));
  }
  for (const t of (bs.tasks || []).filter((x) => x.status === 'in_progress' && !x.inHand && since && x.updated && day(x.updated) < day(since))) {
    rows.push(checkRow('shape', t.id + ':stalled', { title: t.name + ' is in progress with nobody on it', record: t.id, evidence: 'last changed ' + day(t.updated) + ', before the project\'s recent activity (' + day(since) + ')', sourceText: t.name,
      fix: { op: 'task update', args: ['task', 'update', t.id, '--status', 'open', '--note', 'Back to open by the doctor: in progress since ' + day(t.updated) + ' with no session holding it.'], target: t.id, was: { status: 'in_progress' } },
      why: 'no session holds it: back to open with a note, so the ready set shows it' }));
  }
  /* the import parks its own plan-section tracks with no condition: its output, not drift */
  const own = (t) => (t.labels || []).includes('import:' + doc.project.slug) || (t.refs || []).some((x) => String(x).startsWith('onboard:'));
  const stateOf = new Map([...(bs.tasks || []).map((x) => [x.id, x.status]), ...(bs.tracks || []).map((x) => [x.id, x.state]), ...(extra.states || new Map())]);
  for (const t of (bs.tracks || []).filter((x) => x.state === 'parked' && !x.unpark && !own(x))) {
    const m = UNPARK_ID.exec(t.parkReason || '');
    const base = { title: t.name + ' is parked with no unpark condition', record: t.id, evidence: 'parked: ' + (t.parkReason || 'no reason'), sourceText: t.parkReason || '' };
    /* the board refuses a condition on a record already ended, or one it does not hold */
    const st = m && stateOf.get(m[0]);
    if (m && (!st || ENDED.includes(st))) rows.push(checkRow('shape', t.id, { ...base, call: true, def: 'leave', fix: { op: 'track park', target: t.id, was: { reason: t.parkReason }, pick: '--unpark-when' },
      why: 'its reason names ' + m[0] + ', which ' + (st ? 'is already ' + st : 'the board does not hold') + ': unpark it, say what reopens it, or leave it' }));
    else if (m) rows.push(checkRow('shape', t.id, { ...base, fix: { op: 'track park', args: ['track', 'park', t.id, '--reason', t.parkReason, '--unpark-when', UNPARK[m[1]] + ' ' + m[1] + '-' + m[2]], target: t.id, was: { reason: t.parkReason } },
      why: 'its reason names ' + m[0] + ': it unparks on its own then' }));
    else rows.push(checkRow('shape', t.id, { ...base, call: true, def: 'leave', fix: { op: 'track park', target: t.id, was: { reason: t.parkReason }, pick: '--unpark-when' }, why: 'its reason names nothing the board can watch: say what reopens it, or leave it' }));
  }
  const ws = bs.workstreams || [];
  if (ws.length && ws.every((w) => /inbox$/i.test(w.name))) {
    const tasks = (bs.tasks || []).filter((t) => !['completed', 'dropped'].includes(t.status));
    if (tasks.length >= 5 || tasks.some((t) => t.status === 'in_progress')) {
      rows.push(checkRow('shape', 'inbox-only', { title: 'The project has only an inbox workstream, holding ' + tasks.length + ' open tasks', record: ws[0].id, evidence: ws.map((w) => w.id + ' ' + w.name).join(', '),
        call: true, def: 'leave', why: 'real work in an inbox: make a workstream for the project (ws create) and move each task (task edit --workstream), or leave it' }));
    }
  }
  const ruled = ((doc.proposal && doc.proposal.items) || []).filter((x) => x.kind === 'rule' && !x.covered);
  if (!(bs.profiles || []).some((p) => p.here) && ruled.length) {
    rows.push(checkRow('shape', 'no-profile', { title: 'No profile holds this project, while ' + ruled.length + ' rule items wait in the repo', evidence: ruled.length + ' rule items', extra: { info: true, items: ruled.map((r) => r.id) },
      why: 'the conversion\'s rule items make the project\'s profile and hold it: counted here, written once there' }));
  }
  for (const q of (extra.snoozed || []).filter((x) => !(x.snooze && (x.snooze.until || x.snooze.wakeOn || x.snooze['wake-on'])) && since && day(x.created) < day(since))) {
    rows.push(checkRow('shape', q.id + ':asleep', { title: q.name + ' has slept since ' + day(q.created), record: q.id, evidence: 'snoozed' + (q.snooze && q.snooze.trigger ? ' until the words "' + q.snooze.trigger + '"' : '') + ', nothing set to wake it',
      call: true, def: 'leave', sourceText: q.ask || q.name, why: 'long asleep: wake it (wake), drop it (drop with a note), or leave it' }));
  }
  return rows;
}

/* ---- check 3: knowledge records ---- */

/* the path ends where the from line goes on (a line, a commit, a date, the sentence's end), never at its extension's dot */
const FROM = /From the old system: (\S+?)(?= line \d| \(commit |[,;]|\.(?:\s|$))(?: line (\d+))?(?: \(commit ([0-9a-f]{6,40})\))?/;
const bodyOf = (r) => String(((r && r.sections) || {}).Body || (r && r.description) || '');
const blockAt = (text, line) => {
  const ls = text.split('\n');
  let i = line - 1;
  if (i < 0 || i >= ls.length) return '';
  const out = [ls[i]];
  for (let j = i + 1; j < ls.length && j < i + 40 && ls[j].trim() && !/^\s*(?:[-*+]|\d+[.)]|#)\s/.test(ls[j]); j++) out.push(ls[j]);
  return out.join('\n');
};
export function checkKnowledge(doc, extra) {
  const rows = [];
  const root = doc.project.dir;
  const shared = doc.project.shared;
  const has = holder(root, extra.files || []);
  const recs = [...(extra.records || new Map()).values()].filter((r) => r.kind === 'knowledge' && r.status === 'active');
  /* the conversion's own output: the plan judged its coverage and duplicates, the map says where its source went */
  const label = 'import:' + doc.project.slug;
  const own = (r) => (r.labels || []).includes(label) && (r.refs || []).some((x) => String(x).startsWith('onboard:'));
  const ends = endsOf(doc.conversion);
  const parents = new Map();
  const parentOf = (c) => {
    if (!parents.has(c)) { const p = spawnSync('git', ['rev-parse', c + '^'], { cwd: root, encoding: 'utf8', windowsHide: true }); parents.set(c, p.status === 0 ? p.stdout.trim() : c + '^'); }
    return parents.get(c);
  };
  /* read by the run's summary and checkup.json: each own record whose source left, and where it went */
  const judged = { moved: [], inGit: [], retired: [] };
  extra.own = judged;
  for (const r of recs) {
    const body = bodyOf(r);
    const m = FROM.exec(body);
    if (!m) continue;
    const [, file, line, commit] = m;
    const end = has(file) ? null : endOf(ends, file);
    if (own(r)) {
      if (!end) { if (!has(file)) judged.retired.push({ id: r.id, file }); continue; }
      if (end.place) judged.moved.push({ id: r.id, file, to: end.place });
      else if (end.at) judged.inGit.push({ id: r.id, file, at: parentOf(end.at) });
      else judged.retired.push({ id: r.id, file });
      continue;
    }
    /* an earlier run's amend placed it already; the from line itself stays as written */
    if (body.includes('The source ' + file + (line ? ' line ' + line : '') + ' is ')) continue;
    if (!has(file)) {
      const sha = commit || (end && end.at && parentOf(end.at));
      const place = end && end.place ? 'moved to ' + end.place : 'retired: it is in git' + (sha ? ' at ' + sha : '');
      rows.push(checkRow('knowledge', r.id + ':from', { title: r.name, record: r.id, evidence: 'its from line names ' + file + ', which the repo no longer has', sourceText: body,
        fix: { op: 'knowledge amend', args: ['knowledge', 'amend', r.id], body: 'The source ' + file + (line ? ' line ' + line : '') + ' is ' + place + '.', target: r.id }, why: 'the amend says where its source is now' }));
      continue;
    }
    if (!line) continue;
    const src = blockAt(readText(join(root, file)) || '', Number(line));
    const missing = clausesOf(src).filter((c) => covers(body, c).length);
    if (missing.length) {
      rows.push(checkRow('knowledge', r.id + ':drift', { title: r.name, record: r.id, evidence: missing.length + ' clauses of ' + file + ' line ' + line + ' are not in it', sourceText: src,
        fix: { op: 'knowledge amend', args: ['knowledge', 'amend', r.id], body: 'From ' + file + ' line ' + line + ': ' + missing.join(' '), target: r.id }, extra: { gaps: missing }, why: 'its source says more than it does: the missing clauses as an amend' }));
    }
  }
  /* duplicates by title tokens, the older against the newer */
  const mine = recs.filter((r) => (r.projectRepos || []).includes(shared));
  const num = (id) => Number(String(id).replace(/\D/g, ''));
  const seen = new Set();
  const itemsOf = (r) => (r.refs || []).filter((x) => String(x).startsWith('onboard:'));
  for (const a of mine) {
    for (const b of mine) {
      if (num(a.id) >= num(b.id) || seen.has(a.id)) continue;
      /* the plan judged a new record against the board before the go; one item written twice (a redo after an undo) it could not */
      const twice = itemsOf(a).some((x) => itemsOf(b).includes(x));
      if (own(b) && !twice) continue;
      const n = sameSubject(a.name, b.name);
      if (!n) continue;
      seen.add(a.id);
      const holds = clausesOf(bodyOf(a)).every((c) => !covers(bodyOf(b), c).length);
      const base = { title: a.name + ' and ' + b.id, record: a.id, evidence: 'titles share ' + n + ' words with ' + b.id + ' ' + b.name, sourceText: bodyOf(a) };
      if (holds) rows.push(checkRow('knowledge', a.id + ':dup', { ...base, fix: { op: 'knowledge supersede', args: ['knowledge', 'supersede', a.id, '--by', b.id], target: a.id }, why: b.id + ' holds every clause of it: it supersedes it' }));
      else rows.push(checkRow('knowledge', a.id + ':dup', { ...base, call: true, def: 'leave', why: 'the same subject as ' + b.id + ', each with clauses the other lacks: merge them by hand, or leave both' }));
    }
  }
  const scopes = extra.scopes || new Map();
  for (const r of recs.filter((x) => !(x.projectRepos || []).length && !x.global && scopes.has(x.id))) {
    rows.push(checkRow('knowledge', r.id + ':project', { title: r.name, record: r.id, evidence: 'no project, and its text names ' + scopes.get(r.id), sourceText: r.name,
      fix: { op: 'knowledge edit', args: ['knowledge', 'edit', r.id, '--add-project', root], target: r.id }, why: 'scoped to this project, so its sessions find it' }));
  }
  return rows;
}

/* ---- check 4: procedure cards ---- */

/* a card's path changed only by a conversion's own commits (its handover, their reverts) still says what it said */
const CHANGED = /^changed since ([0-9a-f]{7,40}): ([^\s:]+) \(\d+ commits?\)$/;
function importsOnly(root, label, msg) {
  const m = CHANGED.exec(msg);
  if (!m) return false;
  const r = spawnSync('git', ['log', '--format=%s', m[1] + '..HEAD', '--', m[2]], { cwd: root, encoding: 'utf8', windowsHide: true });
  const subjects = r.status === 0 ? r.stdout.split('\n').filter(Boolean) : [];
  return subjects.length > 0 && subjects.every((s) => s.includes(label + ':'));
}
export function checkCards(doc, extra) {
  const rows = [];
  const label = 'import:' + doc.project.slug;
  for (const f of ((extra.cards || {}).files || [])) {
    for (const [i, e] of [...(f.errors || []), ...(f.warnings || []), ...(f.lints || [])].entries()) {
      const msg = typeof e === 'string' ? e : e.message || e.text || JSON.stringify(e);
      if (importsOnly(doc.project.dir, label, msg)) continue;
      /* proc scan --check names each card by its file name under the procedures folder */
      const file = f.file || f.path || 'docs/procedures/' + f.name;
      rows.push(checkRow('cards', file + '#' + (i + 1), { title: file + ': ' + msg, where: { file, line: (e && e.line) || undefined }, evidence: msg, sourceText: msg,
        fix: { after: { home: 'fix', path: file, edit: 'edit ' + file, what: 'fix ' + file + ': ' + clip(msg, 200) + ' (the session edits it on the go)' } }, why: 'proc scan --check reports it' }));
    }
  }
  return rows;
}

/* ---- check 5: the repo ---- */

/* each instruction file's clauses (every one the facts list, AGENTS.md as CLAUDE.md, the
   override AskerDo writes aside) against the repo: a gone path is a repoint, a clause whose every cite is gone one
   finding; and a Project instructions setting that changed since the last run */
const OVERRIDE = /(^|\/)AGENTS\.override\.md$/;
/* a cite resolved as the survey resolves a rule file's: from its file's folder, its nested project,
   the root, another nested project, then on disk in its real case */
function liveCite(root, files) {
  const folders = new Set();
  const byName = new Map();
  for (const f of files) {
    for (let d = f, j = d.lastIndexOf('/'); j > 0; j = d.lastIndexOf('/')) { d = d.slice(0, j); folders.add(d); }
    const b = posix.basename(f);
    if (!byName.has(b)) byName.set(b, []);
    byName.get(b).push(f);
  }
  const find = resolver({ have: new Set(files), folders, history: new Map(), byName, roots: projectRoots(files, folders), root });
  return (p, from) => { const r = find(p.replace(/^\.\//, ''), from); return Boolean(r && r.state === 'ok'); };
}
export function checkRepo(doc, extra) {
  const rows = [];
  const root = doc.project.dir;
  const live = liveCite(root, extra.files || []);
  const ins = doc.instructions;
  const guides = ins && Array.isArray(ins.files) ? ins.files.map((x) => x.file).filter((f) => !OVERRIDE.test(f)) : ['CLAUDE.md', 'AGENTS.md'];
  const seen = new Set();
  const push = (id, row) => { if (!seen.has(id)) { seen.add(id); rows.push(checkRow('repo', id, row)); } };
  for (const g of guides) {
    const text = readText(join(root, g));
    if (text === null) continue;
    const listed = (doc.claude || []).filter((c) => c.file === g);
    /* facts from before the instruction files had ledgers: every line is a clause */
    const clauses = ins ? listed : text.split('\n').map((l, i) => ({ line: i + 1, clause: l })).filter((c) => c.clause.trim());
    const lines = text.split('\n');
    for (const c of clauses) {
      const cited = pathsIn(c.clause);
      const gone = cited.filter((p) => !live(p, g));
      if (!gone.length) continue;
      const src = lines[c.line - 1] || c.clause;
      if (gone.length === cited.length && ins) {
        push(g + '#L' + c.line + ':' + kebab(c.clause, 30), { title: g + ' line ' + c.line + ' cites nothing live', where: { file: g, line: c.line }, evidence: gone.join(', ') + (gone.length > 1 ? ' are' : ' is') + ' not in the repo', sourceText: c.clause,
          fix: { after: { home: 'fix', path: g, edit: 'edit ' + g, what: 'the clause at ' + g + ' line ' + c.line + ' cites only paths the repo no longer has (' + gone.join(', ') + '): repoint it where its subject moved, or drop it when the subject is gone (the session edits it on the go)' } },
          why: 'a kept clause that cites nothing live' });
        continue;
      }
      for (const p of gone) {
        push(g + '#L' + c.line + ':' + kebab(p), { title: g + ' line ' + c.line + ' cites ' + p, where: { file: g, line: c.line }, evidence: p + ' is not in the repo', sourceText: src,
          fix: { after: { home: 'fix', path: g, edit: 'edit ' + g, what: 'repoint ' + g + ' line ' + c.line + ': it cites ' + p + ', which the repo no longer has (the session edits it on the go)' } }, why: 'a guide citing a file that is gone' });
      }
    }
  }
  /* the setting against the one the last run saw: what Claude reads changed, so the ledgers are judged again */
  const was = doc.conversion && doc.conversion.instructions;
  if (ins && ins.setting && was && was.mode) {
    const now = ins.files.filter((x) => x.read).map((x) => x.file).sort();
    const then = [...(was.read || [])].sort();
    if (was.mode !== ins.setting.mode || now.join('\n') !== then.join('\n')) {
      const said = (mode, read) => mode + ', reading ' + (read.join(', ') || 'no project instruction file');
      push('instructions', { title: 'The Project instructions setting changed since the last run: ' + said(ins.setting.mode, now), evidence: 'the last run' + (was.run ? ' (' + String(was.run).slice(0, 10) + ')' : '') + ' saw ' + said(was.mode, then),
        why: 'Claude reads other instruction files: a file it reads converts as CLAUDE.md does, and a CLAUDE.md never hides an AGENTS.md it read', extra: { needsWords: true, instructions: { now: { mode: ins.setting.mode, read: now }, was: { mode: was.mode, read: then } } } });
    }
  }
  return rows;
}

/* ---- check 5b: what earlier runs kept ---- */

/* a judgment whose evidence no longer holds is judged again, never left; a rule file
   citing a path that is gone or moved is repointed, and one that cites nothing live may be stale */
export function checkKept(doc) {
  const rows = [];
  for (const j of ((doc.conversion && doc.conversion.judgments) || []).filter((x) => x.state === 'rejudge')) {
    rows.push(checkRow('kept', j.key, { title: j.subject + (j.clause ? ' "' + clip(j.clause, 80) + '"' : '') + ' was ' + (j.fate === 'drop' ? 'dropped' : 'kept') + (j.why ? ': ' + j.why : ''),
      where: j.kind === 'folder' ? undefined : { file: j.subject }, evidence: (j.because || []).join('; '), sourceText: j.clause || j.why || '',
      why: 'its evidence no longer holds: judge it again (convert, drop, or keep with a reason of a named shape and fresh evidence)', extra: { needsWords: true, judgment: j.key } }));
  }
  for (const f of doc.ruleFiles || []) {
    const c = f.cites || {};
    const gone = c.gone || [];
    const moved = c.moved || [];
    if (!gone.length && !moved.length) continue;
    const dead = !c.ok && !moved.length;
    const said = [...gone.map((x) => x.path + ' (gone' + (x.since ? ' since ' + x.since : '') + ')'), ...moved.map((x) => x.path + ' (moved to ' + [].concat(x.to || []).join(' or ') + ')')];
    rows.push(checkRow('kept', f.file, { title: f.file + (dead ? ' cites nothing live' : ' cites ' + said.length + ' path' + (said.length > 1 ? 's' : '') + ' gone or moved'), where: { file: f.file }, evidence: said.join('; '), sourceText: said.join('\n'),
      fix: { after: { home: 'fix', path: f.file, edit: 'edit ' + f.file, what: (dead ? f.file + ' cites only paths the repo no longer has: convert or drop it when its subject is gone, else repoint it' : 'repoint ' + f.file + ': ' + said.join('; ')) + ' (the session edits it on the go)' } },
      why: dead ? 'a rule file whose every cite is gone: its subject may be gone' : 'a rule file citing paths that moved or left' }));
  }
  return rows;
}

/* ---- check 6: earlier runs ---- */

export function checkEarlier(doc, extra) {
  const rows = [];
  for (const [which, note] of Object.entries(extra.lastRun || {})) {
    if (!note) continue;
    for (const l of note.split('\n').filter((x) => /^\s*(?:[-*]\s*)?(Fixed by hand|Deviated)\b/i.test(x))) {
      rows.push(checkRow('earlier', which + ':' + kebab(l, 30), { title: 'The last ' + which + ' run: ' + oneLine(l), where: { record: which + '-a-project' }, evidence: oneLine(l), call: true, def: 'leave', sourceText: l,
        why: 'hand work the last run reported: is it on the board? Leave it when it is' }));
    }
  }
  return rows;
}

/* ---- checks 7 and 8: the records against their sources, from the conversion map ---- */

/* A mapped record whose source changed since the run that read it: the session reads the source again and amends. */
export function checkSource(doc) {
  const rows = [];
  for (const s of ((doc.conversion && doc.conversion.sources) || []).filter((x) => x.state === 'changed' && (x.records || []).length)) {
    rows.push(checkRow('source', s.source, { title: s.source + ' changed since it became ' + s.records.join(', '), where: { file: s.source }, record: s.records[0],
      evidence: 'its hash differs from the one the last run read' + (doc.conversion.last ? ' (' + String(doc.conversion.last.at).slice(0, 10) + ')' : ''),
      why: 'its records may no longer say what it says: read it against them and amend what moved', extra: { records: s.records, needsWords: true } }));
  }
  return rows;
}

/* A mapped record the board no longer holds while its source stays in the repo: write it again, or leave it. */
export function checkGone(doc) {
  const rows = [];
  for (const s of ((doc.conversion && doc.conversion.sources) || []).filter((x) => x.state !== 'removed' && (x.gone || []).length)) {
    rows.push(checkRow('gone', s.source, { title: s.source + ' became ' + s.gone.join(', ') + ', which the board no longer holds', where: { file: s.source }, record: s.gone[0],
      evidence: s.gone.join(', ') + ' gone from the board; ' + s.source + ' is still in the repo', call: true, def: 'leave',
      why: 'the source still says it: convert it again, or leave it gone', extra: { records: s.gone } }));
  }
  return rows;
}

/* ---- reconcile before create ---- */

/* An item the board holds by its title (the survey's covered, a record id) gains a ref to the item, so the next
   run skips it, and the clauses the record lacks as an amend; an item an earlier write made is skipped. */
export function reconcile(doc, items, extra) {
  const out = [];
  const recs = extra.records || new Map();
  const tasks = new Map(((doc.board && doc.board.tasks) || []).map((t) => [t.id, t]));
  /* a record carrying onboard:<item id> holds that item already, and so does the map for a source unchanged since its run */
  const held = new Set();
  for (const r of [...(extra.knowledge || []), ...tasks.values()]) for (const ref of r.refs || []) if (String(ref).startsWith('onboard:')) held.add(String(ref).slice(8));
  const mapped = coveredBy(doc.conversion);
  /* a file row holds only the lines its coverage passed */
  const spanIn = (r, f) => (r.source && r.source.line && String(r.source.file).replace(/\\/g, '/') === f ? [Number(r.source.line), Number(r.source.end || r.source.line)] : [1, Infinity]);
  const onMap = (f, r) => [...mapped.values()].some((m) => (m.source === f || (m.source.endsWith('/') && f.startsWith(m.source))) && seedCovers(m, r.kind) && linesHold(m, spanIn(r, f), r.kind));
  for (const r of items) {
    const fs = r.kind === 'track' && ((r.fields || {}).files || []).length ? r.fields.files : r.source && r.source.file ? [r.source.file] : [];
    if (fs.length && fs.map((f) => String(f).replace(/\\/g, '/')).every((f) => onMap(f, r))) held.add(r.id);
  }
  /* an amend is permanent: one source text amends one record once, however many items repeat it */
  const amended = new Map();
  for (const r of items) {
    const id = String(r.covered || '');
    if (!/^[KT]-\d+$/.test(id) || held.has(r.id) || r.kind === 'fix') continue;
    const rec = recs.get(id) || tasks.get(id);
    const src = (r.fields && (r.fields.sourceText || r.fields.body)) || r.text || r.title || '';
    const key = id + '\0' + oneLine(src).toLowerCase();
    const twin = amended.get(key);
    if (!twin) amended.set(key, r.id);
    const gaps = rec && !twin ? clausesOf(src).filter((c) => covers(bodyOf(rec) + '\n' + rec.name, c).length) : [];
    const task = /^T-\d+$/.test(id);
    out.push(checkRow('reconcile', r.id, { title: r.title, record: id, where: r.source || undefined, evidence: 'already on the board as ' + id + (gaps.length ? ', missing ' + gaps.length + ' clauses' : '') + (twin ? ', the same text as ' + twin : ''), sourceText: src,
      fix: { op: task ? 'task edit' : 'knowledge edit', args: [task ? 'task' : 'knowledge', 'edit', id, '--add-ref', 'onboard:' + r.id], target: id },
      extra: { already: id, gaps, kind: task ? 'task' : 'knowledge', item: r.id },
      why: (gaps.length ? 'the record gains the clauses it lacks as ' + (task ? 'a note' : 'an amend') + ', and ' : '') + 'a ref to this item, so the next run skips it' }));
  }
  return { checkup: out, held: held.size };
}

/* ---- the run ---- */

/* not on the board yet: no workstream, knowledge or imported record names the project, and its conversion map is empty */
export function onBoard({ workstreams = [], knowledge = [], imported = 0, mapped = false }, shared) {
  const mine = (x) => (x.projectRepos || []).includes(shared);
  return workstreams.some(mine) || knowledge.some(mine) || imported > 0 || mapped;
}

/* board false runs the checks on the gathered facts alone, with no board read (the tests' seam) */
export function doctor(dir, { work, cli = DEFAULT_CLI, board = true, env = process.env, spawns = { n: 0 }, gather = survey } = {}) {
  const top = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, encoding: 'utf8', windowsHide: true });
  const root = slashed(top.status === 0 ? top.stdout.trim() : resolve(dir));
  const slug = kebab(basename(root), 30);
  const shared = (top.status === 0 && sharedName(root)) || root.toLowerCase();
  const workDir = slashed(work || join(dataDir(env) || join(homedir(), '.claude', 'askerdo-onboard'), 'onboard', slug));
  let knowledge;
  if (board) {
    const failed = [];
    const get = (args) => { spawns.n++; const r = cliJson(cli, args, env); if (r.error) failed.push(args.join(' ') + ': ' + r.error); return r.value; };
    const ws = get(['list', '--kind', 'workstream', '--all']) || [];
    knowledge = get(['list', '--kind', 'knowledge', '--all']);
    const imported = (get(['list', '--kind', 'knowledge', '--all', '--label', 'import:' + slug]) || []).length;
    let on = onBoard({ workstreams: ws, knowledge: knowledge || [], imported }, shared);
    /* the map is read here only when nothing else names the project: a run on another PC may have left only rows there */
    if (!on) on = onBoard({ mapped: ((get(['conversion', '--project', root]) || {}).rows || []).length > 0 }, shared);
    /* a failed entry read never sends a project to onboarding: the run stops on the failure */
    if (!on) return failed.length ? { entry: 'unread', errors: failed } : { entry: 'onboard' };
  }
  /* the facts the session judges with; the checks read the board's records from them, never the repo whole */
  const gathered = gather(root, { work: workDir, cli, board, env }) || {};
  const facts = readFacts(workDir) || gathered.facts || {};
  const head = spawnSync('git', ['log', '-1', '--format=%cI'], { cwd: root, encoding: 'utf8', windowsHide: true });
  /* the proposal at hand, if any: its items may be on the board already */
  const proposal = readJsonFile(join(workDir, 'proposal.json')) || { items: [], folders: [], calls: [] };
  /* the rule files and nested ledgers, from facts-rules.json when the survey spilled them there */
  const spilled = facts.ruleFiles && !Array.isArray(facts.ruleFiles) && facts.ruleFiles.file ? readJsonFile(facts.ruleFiles.file) || {} : {};
  const ruleFiles = Array.isArray(facts.ruleFiles) ? facts.ruleFiles : spilled.ruleFiles || [];
  const claude = [...(facts.claude || []), ...(facts.claudeNested ? spilled.claude || [] : [])];
  /* the facts carry only the open tasks, under openTasks; the checks read them as tasks, and the decisions whole from
     the board read (the facts clip a ruling's words) */
  const whole = gathered.board && gathered.board.decisions;
  const fb = facts.board ? { ...facts.board, tasks: facts.board.tasks || facts.board.openTasks || [], ...(whole ? { decisions: whole } : {}) } : null;
  const doc = { project: { dir: root, slug, shared }, board: fb, conversion: facts.conversion || null, history: { latest: head.status === 0 ? head.stdout.trim() || null : null }, proposal,
    instructions: facts.instructions || null, claude, ruleFiles };
  const extra = board ? readDoctor(cli, doc, env, { knowledge, spawns }) : { inbox: [], records: new Map(), files: [], errors: [], unread: [] };
  /* the survey's board reads feed the checks that read its board state */
  const surveyErrors = (doc.board && doc.board.errors) || [];
  const unread = new Set([...(extra.unread || []), ...(surveyErrors.length || !doc.board ? ['rules', 'shape', 'reconcile'] : [])]);
  /* a finding the user left stays left while its subjects are unchanged: the map holds its call answered with leave */
  const answered = new Map(((doc.conversion && doc.conversion.calls) || []).filter((c) => c.state === 'unchanged' && c.answer).map((c) => [c.call, c.answer]));
  /* or the run row lists it as left with no call, its source unchanged */
  const leftIds = new Set(((doc.conversion && doc.conversion.left) || []).filter((l) => l.state === 'unchanged').map((l) => l.item));
  const leftBefore = (x) => { if (leftIds.has(x.id)) return true; if (!x.call || !answered.has(x.id)) return false; const o = callOf(x).options; return answered.get(x.id) === o[o.length - 1].letter; };
  /* a judgment to make again is never left: its evidence changed since */
  const markLeft = (xs) => { for (const x of xs.filter((y) => !y.covered && !y.fields.judgment && leftBefore(y))) { Object.assign(x, { cut: true, dropped: 'left last time', leftLast: true, why: 'left last time: ' + (x.why || '') }); delete x.call; } };
  const found = {
    rules: checkRules(doc, extra), shape: checkShape(doc, extra), knowledge: checkKnowledge(doc, extra),
    cards: checkCards(doc, extra), repo: checkRepo(doc, extra), kept: checkKept(doc), earlier: checkEarlier(doc, extra), source: checkSource(doc), gone: checkGone(doc),
  };
  const rec = reconcile(doc, proposal.items || [], extra);
  found.reconcile = rec.checkup;
  const items = Object.values(found).flat();
  markLeft(items);
  const calls = items.filter((x) => x.call).map(callOf);
  for (const x of items) delete x.call;
  /* a check whose reads failed has no count: 0 would read as clean */
  const counts = Object.fromEntries(CHECKS.map((c) => [c, unread.has(c) ? { found: null, unread: true } : { found: found[c].filter((r) => !r.leftLast).length }]));
  const checkup = { made: new Date().toISOString(), project: doc.project, counts, unread: CHECKS.filter((c) => unread.has(c)), leftLast: items.filter((r) => r.leftLast).length,
    heldByRef: rec.held, words: items.filter((x) => x.fields.needsWords && !x.cut).length, errors: [...surveyErrors, ...(extra.errors || [])], own: extra.own || null, reads: spawns.n, items, calls };
  mkdirSync(workDir, { recursive: true });
  const checkupFile = join(workDir, 'checkup.json');
  writeFileSync(checkupFile, JSON.stringify(checkup, null, 2) + '\n');
  return { entry: 'doctor', project: doc.project, board: doc.board, work: workDir, checkup, checkupFile, gathered };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const a = process.argv.slice(2);
  const flag = (n) => { const i = a.indexOf('--' + n); return i >= 0 ? a.splice(i, 2)[1] : undefined; };
  const work = flag('work'); const cli = flag('cli');
  if (!a[0] || a[0] === '--help') { console.log('node checks.mjs <project dir> [--work <dir>] [--cli <path>]'); process.exit(a[0] ? 0 : 1); }
  if (!existsSync(a[0])) { console.error('checks: no folder ' + a[0]); process.exit(1); }
  const started = Date.now();
  const d = doctor(a[0], { work, cli: cli || DEFAULT_CLI });
  if (d.entry === 'onboard') { console.log('not on the board yet: run askerdo:onboard'); process.exit(1); }
  if (d.entry === 'unread') { console.error('checks: the board reads failed, so the doctor cannot tell whether the project is on the board: ' + d.errors.join('; ')); process.exit(2); }
  console.log('Doctor of ' + d.project.dir + ' (' + d.project.shared + ')');
  const lines = surveyLines(d.gathered);
  for (const l of Array.isArray(lines) ? lines : [...((lines && lines.before) || []), ...((lines && lines.after) || [])]) console.log(l);
  const c = d.checkup;
  const calls = c.calls.filter((x) => !x.answer).length;
  console.log((c.unread.length ? 'Checkup incomplete (' + c.unread.join(', ') + ' not read): ' : 'Checkup: ')
    + CHECKS.map((k) => k + ' ' + (c.counts[k].unread ? 'not read' : c.counts[k].found)).join(', ') + '; calls for the user ' + calls + (c.leftLast ? '; left last time ' + c.leftLast : ''));
  if (c.errors.length) console.log('Reads that failed: ' + c.errors.join('; '));
  const own = c.own;
  const ownN = own ? Object.values(own).reduce((n, l) => n + l.length, 0) : 0;
  if (ownN) console.log('The import\'s own records whose source left (no finding; checkup.json own lists them): ' + own.moved.length + ' moved, ' + own.inGit.length + ' in git at their delete, '
    + own.retired.length + ' retired by the import');
  if (c.words) console.log('Fixes waiting on the session\'s words: ' + c.words);
  console.log('Reads: ' + c.reads + ' CLI calls beyond the survey, ' + ((Date.now() - started) / 1000).toFixed(1) + ' s in all');
  console.log('checkup.json: ' + d.checkupFile + ' (each finding with its fix, and the calls); facts.json: ' + d.work + '/facts.json. Judge each finding with the facts and write the fixes you agree with into proposal.json.');
  if (c.unread.length) { console.log('Stop: a check that was not read is not clean. Fix the failed reads and run the checks again.'); process.exitCode = 2; }
}
