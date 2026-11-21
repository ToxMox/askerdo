#!/usr/bin/env node
/* runs plan.json through the AskerDo CLI's own command code, in order and in this one process.
   Without --board it is a dry run that prints each command. --board file:<db> rehearses on a scratch board: it
   writes (keeping going and listing every refusal), runs coverage, then runs the undo with its one press and
   reports both counts. --board live writes the board the CLI's config names, takes the go
   plan.mjs --go recorded, stops at the first refusal and resumes from its results. Every id written goes in the
   manifest, which --undo walks backwards (--group <call> takes back one group a later answer dropped). --coverage
   proves each converted source against its records; --handover then makes the repo edits in one commit, named
   in the manifest; --reader writes the file one fresh reader pass reads, on the user's ask.
   node apply.mjs <work dir> [--board file:<db> | --board live] [--cli <path>]
     [--coverage | --handover [--file <path>] | --reader | --undo [--all | --group <call>] [--session <own id>] [--dry]] */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dataDir, storeRoot } from '../../lib/node-helpers.mjs';
import { keepFromConversion } from '../../lib/loose-files.mjs';
import { stateProblems, wakeIn } from '../../server/handoff-text.mjs';
import { cardRow, cardText, writeCard } from './cards.mjs';
import { WAKE_REF, citeJudge, editLines, folderKey, lineEditTakes, readFacts, under } from './plan.mjs';
import { coverage, lineEditHeld, recordReader, repointGaps, table } from './coverage.mjs';
import { SESSION_READS, citer, fencedLines, folderRe, fromRoot, inText, isGlob, linksIn, MD, nearestOf, printed, relFrom, resolveFrom, UP_PATH, wrapLead } from './cites.mjs';
import { CALL, NONE, RUN, blobsOf, boardRecords, folderSig, isFolder, parseTree } from './map.mjs';
import { blockAt } from './survey.mjs';
import { DEFAULT_MODE, instructionFiles, kindOf as fileKind, pathsFront } from './instructions.mjs';
import { refreshAgentsOverride } from '../../lib/agents-override.mjs';

const DEFAULT_CLI = join(homedir(), '.claude', 'askerdo', 'cli.mjs');
const USAGE = 'node apply.mjs <work dir> [--board file:<db> | --board live] [--cli <path>]\n'
  + '  [--coverage | --handover [--file <path>] | --reader | --undo [--all | --group <call>] [--session <own id>] [--dry]]';
const REF = /@\{([^}]+)\}/g;
const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const clip = (s, n = 90) => { const t = oneLine(s); return t.length > n ? t.slice(0, n - 3) + '...' : t; };
const shq = (a) => (/^[A-Za-z0-9_./:@~=+,{}-]+$/.test(a) ? a : '"' + String(a).replace(/(["\\$`])/g, '\\$1') + '"');
const readText = (p) => { try { return readFileSync(p, 'utf8').replace(/\r\n/g, '\n'); } catch { return null; } };
const readJson = (p, d) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return d; } };
/* text written over a file keeps that file's line endings (a CRLF working copy stays CRLF) */
const eolLike = (abs, text) => { let raw = ''; try { raw = readFileSync(abs, 'utf8'); } catch { /* a new file */ } return raw.includes('\r\n') ? text.replace(/\r?\n/g, '\r\n') : text; };
/* rename can hit EPERM on Windows while a scanner holds the target open: retry briefly */
function renameRetry(from, to) {
  for (let i = 0; ; i++) {
    try { renameSync(from, to); return; } catch (e) {
      if (i >= 20 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e;
      const until = Date.now() + 50; while (Date.now() < until) { /* short spin */ }
    }
  }
}
const writeJson = (p, v) => { mkdirSync(dirname(p), { recursive: true }); const t = p + '.' + process.pid + '.tmp'; writeFileSync(t, JSON.stringify(v, null, 2) + '\n'); renameRetry(t, p); };

/* git's own words for a refusal, or the spawn's error when git never ran (ENAMETOOLONG prints nothing) */
const gitWhy = (r) => oneLine((r.error && r.error.message) || String(r.stderr || '').split('\n').filter((l) => !/^warning:/.test(l)).join('\n') || r.stdout) || 'exit ' + r.status;
/* git in the project, every pathspec literal (a path may hold * or [) */
const gitIn = (dir) => (args, input) => spawnSync('git', ['--literal-pathspecs', ...args], { cwd: dir, encoding: 'utf8', windowsHide: true, maxBuffer: 256 << 20, ...(input === undefined ? {} : { input }) });
/* a handover's git, each lookup of refs, commits or the index run once until its next write; a command outside
   READS (add, commit, rm, mv, reset, checkout) clears them. Status and the other work-tree reads are never kept: the
   handover writes files between its git calls */
const KEPT = ['rev-parse', 'ls-tree', 'cat-file', 'merge-base', 'diff-tree'];
const READS = [...KEPT, 'status', 'ls-files', 'show', 'diff', 'log', 'hash-object', 'config'];
const verbOf = (args) => { for (let i = 0; i < args.length; i++) { if (args[i] === '-c') i++; else if (!args[i].startsWith('-')) return args[i]; } return ''; };
function gitCall(dir) {
  const run = gitIn(dir);
  const kept = new Map();
  return (args, input) => {
    const verb = verbOf(args);
    const keep = input === undefined && (KEPT.includes(verb) || args.join(' ') === 'ls-files -z');
    const k = args.join('\0');
    if (keep && kept.has(k)) return kept.get(k);
    const r = run(args, input);
    if (keep) kept.set(k, r);
    else if (!READS.includes(verb)) kept.clear();
    return r;
  };
}
/* a call over a batch's paths reads them from a file in the work folder, never the command line, so no batch
   is too long for Windows' 32767 characters */
function gitBatch(git, work, args, paths) {
  mkdirSync(work, { recursive: true });
  const file = join(work, 'pathspec-' + process.pid + '.txt');
  writeFileSync(file, paths.map((p) => p + '\0').join(''));
  try { return git([...args, '--pathspec-from-file=' + file, '--pathspec-file-nul']); } finally { rmSync(file, { force: true }); }
}
/* the paths git tracks, or null outside a repo */
export function trackedIn(dir, git = gitIn(dir)) {
  const r = git(['ls-files', '-z']);
  return r.status === 0 ? new Set(String(r.stdout || '').split('\0').filter(Boolean)) : null;
}
/* what the repo holds now: the tracked paths, the untracked ones, and the ones with uncommitted changes */
export function repoState(dir, git = gitIn(dir)) {
  const tracked = trackedIn(dir, git) || new Set();
  const untracked = [];
  const changed = new Set();
  const st = String(git(['status', '--porcelain=v1', '-z', '-uall']).stdout || '').split('\0');
  for (let i = 0; i < st.length; i++) {
    if (!st[i]) continue;
    if (st[i].startsWith('??')) { untracked.push(st[i].slice(3)); continue; }
    changed.add(st[i].slice(3));
    if (/^[RC]/.test(st[i])) changed.add(st[++i]);
  }
  return { tracked, untracked, changed, runs: runsOf(dir, tracked) };
}
/* the commands the project's settings run (hooks, MCP servers), so a unit that goes takes its entries along */
const RUNNERS = ['.claude/settings.json', '.claude/settings.local.json', '.mcp.json'];
const hooksIn = (j) => Object.entries((j && j.hooks) || {}).flatMap(([event, groups]) => (Array.isArray(groups) ? groups : [])
  .flatMap((g) => (g && Array.isArray(g.hooks) ? g.hooks : []).filter((h) => h && typeof h.command === 'string').map((h) => ({ what: event, command: h.command }))));
const serverLine = (s) => [s.command, ...(Array.isArray(s.args) ? s.args : [])].filter((x) => typeof x === 'string').join(' ');
export function runsOf(dir, tracked = new Set()) {
  const out = [];
  for (const file of RUNNERS) {
    const j = readJson(join(dir, file), null);
    if (!j || typeof j !== 'object') continue;
    for (const h of hooksIn(j)) out.push({ file, ...h, tracked: tracked.has(file) });
    for (const [name, sv] of Object.entries(j.mcpServers || {})) if (sv && typeof sv === 'object') out.push({ file, what: 'server ' + name, command: serverLine(sv), tracked: tracked.has(file) });
  }
  return out;
}
/* a command naming the unit: a file by its whole path, a folder by its path and a slash */
const runsIt = (command, path, file) => new RegExp('(?<![\\w.-])' + esc(folderKey(path)) + (file ? '(?![\\w./-])' : '/')).test(String(command).replace(/\\/g, '/'));

/* the record each verb makes, and the call that takes it back (null: no verb can) */
const KIND = {
  'ws create': 'workstream', 'task create': 'task', 'track new': 'track', 'handoff write': 'handoff', 'track finish': 'track state', 'track park': 'track state',
  'track layout': 'track order', 'edge add': 'task order', 'task update': 'task steps', 'task edit': 'run-by', 'question edit': 'question scope',
  decide: 'decision', 'knowledge new': 'knowledge', register: 'question', 'profile rule-add': 'rule line', 'profile add': 'profile hold', 'proc scan': 'procedure cards',
  'profile rule-clear': 'rule clear', 'profile define': 'profile setting',
};
/* a doctor's fix step changes a record already on the board; its kind is never 'knowledge',
   which the undo reads as a record that stays */
const FIX_KIND = {
  'profile rule-add': 'rule line', 'profile rule-clear': 'rule clear', 'knowledge amend': 'knowledge amend', 'knowledge edit': 'knowledge ref',
  'knowledge supersede': 'knowledge supersede', 'track park': 'park condition', 'edge add': 'task edge', 'question edit': 'question gate',
  wake: 'question wake', drop: 'question drop',
};
/* a task fix is named by what it changes */
const taskFixKind = (s) => {
  const a = s.args || [];
  if (s.op === 'task update') return a.includes('--move-steps') ? 'task steps' : a.includes('--description') ? 'task text' : 'task note';
  return a.includes('--add-ref') ? 'task ref' : a.includes('--add-label') ? 'task label' : a.includes('--clear-close') ? 'task close'
    : a.includes('--wake') && !a.includes('--track') ? 'task wake' : 'task place';
};
export const kindOf = (s) => (s.fix ? (s.op === 'task update' || s.op === 'task edit' ? taskFixKind(s) : FIX_KIND[s.op] || s.op) : KIND[s.op] || s.op);
/* A scratch board lacks the real board's tracks and tasks: a rehearsal leaves their ids out of a step,
   flag and value together, and skips a step that names one in place or has nothing left to set. */
const REAL_ID = /^(?:TR|T)-\d+$/;
export function scratchStep(s, standIns = new Map()) {
  const dropped = [];
  const args = [];
  let skip = false;
  const raw = s.args || [];
  for (let i = 0; i < raw.length; i++) {
    /* a track with a stand-in stays, swapped for it at the run */
    if (/^--/.test(raw[i]) && REAL_ID.test(String(raw[i + 1])) && !standIns.has(String(raw[i + 1]))) { dropped.push(raw[++i]); continue; }
    if (REAL_ID.test(raw[i]) && !standIns.has(raw[i])) { dropped.push(raw[i]); skip = true; }
    args.push(raw[i]);
  }
  let stdin = s.stdin;
  if (stdin && Array.isArray(stdin.steps)) {
    stdin = { ...stdin, steps: stdin.steps.map((x) => {
      const y = { ...x };
      for (const k of ['after', 'before']) {
        if (!Array.isArray(y[k])) continue;
        dropped.push(...y[k].filter((v) => REAL_ID.test(v)));
        y[k] = y[k].filter((v) => !REAL_ID.test(v));
        if (!y[k].length) delete y[k];
      }
      return y;
    }) };
  }
  /* a tier goes with the place it names: a dropped track takes its tier with it */
  const ti = args.indexOf('--tier');
  if (s.op === 'task edit' && ti >= 0 && !args.some((a) => ['--track', '--unplaced', '--wake'].includes(a))) args.splice(ti, 2);
  if (s.op === 'question edit' && dropped.length && !args.some((a) => a === '--track' || a === '--add-gate')) skip = true;
  /* a task edit left with nothing to set would come back unchanged and prove nothing */
  if (s.op === 'task edit' && dropped.length && !args.some((a) => /^--/.test(a) && a !== '--session')) skip = true;
  return { args, stdin, dropped, skip };
}

/* a fix's reverse, from what it changed (`was`); null where no verb takes it back */
function undoFix(step) {
  const a = step.args || [];
  const was = step.was || {};
  const flag = (f) => { const i = a.indexOf(f); return i >= 0 ? a[i + 1] : undefined; };
  const line = (p, s) => (was.text ? ['profile', 'rule-add', p, s, '--text', was.text, ...(was.for ? ['--for', was.for] : [])] : null);
  switch (step.op) {
    /* a line from a ruling changes only with a newer one, so the old words never come back: it stays */
    case 'profile rule-add': return a.includes('--from') ? null : line(a[2], a[3]) || ['profile', 'rule-clear', a[2], a[3]];
    case 'profile rule-clear': return line(a[2], a[3]);
    /* a pointer's amend goes back to the text apply read before it (was.body); any other amend stands */
    case 'knowledge amend': return typeof was.body === 'string' ? ['knowledge', 'edit', a[2], '--body', was.body] : null;
    case 'task edit':
    case 'knowledge edit': {
      const back = [];
      for (const [add, rm] of [['--add-ref', '--remove-ref'], ['--add-project', '--remove-project'], ['--add-label', '--remove-label']]) if (flag(add) !== undefined) back.push(rm, flag(add));
      a.forEach((x, i) => { if (a[i - 1] === '--add-file') back.push('--remove-file', x); });
      /* the track took the task into its workstream: back unplaced in the one it left */
      if (flag('--track') !== undefined) back.push(...(was.track ? ['--track', was.track] : ['--unplaced', was.unplaced || 'undo of the doctor', '--wake', '@{' + WAKE_REF + '}', ...(was.workstream ? ['--workstream', was.workstream] : [])]));
      return back.length ? [a[0], 'edit', a[2], ...back] : null;
    }
    case 'edge add': return ['edge', 'remove', a[2], a[3], '--reason', 'undo of the doctor'];
    case 'question edit': return flag('--add-gate') !== undefined ? ['question', 'edit', a[2], '--remove-gate', flag('--add-gate')] : null;
    /* a woken or dropped question goes back asleep on the conditions it had; a snooze that stored none takes a trigger,
       since the board snoozes on at least one */
    case 'wake':
    case 'drop': {
      const z = was.snooze;
      if (!z) return null;
      const on = [...(z.until ? ['--until', z.until] : []), ...(z.trigger ? ['--trigger', z.trigger] : []), ...(z.wakeOn ? ['--wake-on', z.wakeOn + (z.wakeStatus ? ':' + z.wakeStatus : '')] : [])];
      return [step.op === 'wake' ? 'snooze' : 'reopen', a[1], ...(on.length ? on : ['--trigger', 'the user wakes it'])];
    }
    /* a cleared handoff folder goes back to the one the workstream named, with no seed: the printed git revert
       restores a folder the handover deleted, and seeded files would block it */
    case 'ws edit': return a.includes('--clear-handoff') && was.handoff ? ['ws', 'edit', a[2], '--handoff', was.handoff, '--no-seed'] : null;
    /* a move of steps, a description amend and a cleared close stand: no verb takes them back */
    /* a park again keeps the condition it had (checked on a scratch board), so no verb takes one back */
    default: return null;
  }
}

/* a task edit that moves a task names its tier: onto a track 3, into an inbox 4 (a doctor's fix and an undo name none) */
export const withTier = (args) => (args[0] !== 'task' || args[1] !== 'edit' || args.includes('--tier') ? args
  : args.includes('--track') ? [...args, '--tier', '3'] : args.includes('--unplaced') || args.includes('--wake') ? [...args, '--tier', '4'] : args);
/* the plan the user approved files whole, as the board picture does, so each filing step carries the user's
   mark (--user, the session the go was given in) and the board asks nothing of a session holding a track */
const FILES = (a) => (a[0] === 'task' && (a[1] === 'create' || (a[1] === 'edit' && a.includes('--tier')))) || (a[0] === 'track' && (a[1] === 'capture' || a[1] === 'layout'));
export function asApproved(args, goSession) {
  if (!Array.isArray(args) || !FILES(args) || args.includes('--user')) return args;
  const si = args.indexOf('--session');
  const user = goSession || (si >= 0 ? args[si + 1] : null);
  return user ? [...args, '--user', user] : args;
}

export function undoArgs(step, id, label) {
  if (step.fix) return undoFix(step);
  const why = 'undo of the ' + label + ' import';
  switch (step.op) {
    case 'ws create': return ['ws', 'close', id, '--outcome', why];
    /* the undo adds a strike for each open step the import's own @steps step added (importDrop) */
    case 'task create': return ['task', 'update', id, '--status', 'dropped'];
    case 'track new': return ['track', 'drop', id, '--reason', why, '--leftovers', 'drop'];
    case 'register': return ['drop', id, '--note', why];
    /* a line that replaced one on the same profile gets its old words back */
    case 'profile rule-add': return step.restore ? ['profile', 'rule-add', step.args[2], step.args[3], '--text', step.restore.text, ...(step.restore.for ? ['--for', step.restore.for] : [])]
      : ['profile', 'rule-clear', step.args[2], step.args[3]];
    case 'profile add': return ['profile', 'remove', step.args[2], step.args[3]];
    /* the line a kept rule took off its profile, and the setting it switched off */
    case 'profile rule-clear': return step.restore ? ['profile', 'rule-add', step.args[2], step.args[3], '--text', step.restore.text, ...(step.restore.for ? ['--for', step.restore.for] : [])] : null;
    case 'profile define': return step.unset ? ['profile', 'define', step.args[2], '--unset', step.unset] : null;
    default: return null;
  }
}
const addsOf = (args) => (args || []).filter((a, i) => args[i - 1] === '--check-add');
const addedSteps = (args, out) => {
  const texts = addsOf(args);
  return ((out && out.checks && out.checks.items) || []).filter((x) => texts.includes(x.text)).map((x) => x.n);
};
/* An imported task's drop, read against its checklist: it strikes the open steps its import added, done ones stay done.
   An open step that is not the import's leaves the task open and named (null). A manifest from before the strikes
   names no numbers: the plan's step texts are the import's when its plan is that import's, else nothing is struck. */
export function importDrop(entry, imp, rec, { plan = null, label = 'the', session = null } = {}) {
  const adds = imp.steps.find((x) => x.step === entry.step + '@steps');
  const planned = plan && plan.made === imp.plan ? (plan.steps || []).find((x) => adds && x.id === adds.step) : null;
  const own = (x) => (adds && Array.isArray(adds.checks) ? adds.checks.includes(x.n) : planned ? addsOf(planned.args).includes(x.text) : false);
  const open = rec ? (rec.checklist || []).filter((x) => !x.done) : (adds && adds.checks ? adds.checks.map((n) => ({ n })) : []);
  const theirs = open.filter((x) => !own(x));
  if (theirs.length) return { left: theirs };
  return { args: ['task', 'update', entry.id, '--status', 'dropped', ...open.flatMap((x) => ['--check-strike', x.n + ': undo of the ' + label + ' import']), ...(session ? ['--session', session] : [])] };
}
const idOf = (step, out) => {
  if (step.fix) return step.target;
  if (step.op === 'profile rule-add') return step.args[2] + '/' + step.args[3];
  if (step.op === 'profile add') return step.args[3] + ' on ' + step.args[2];
  if (step.op === 'profile rule-clear') return step.args[2] + '/' + step.args[3] + ' cleared';
  if (step.op === 'profile define') return step.args[2] + ' ' + step.args[4];
  /* a task's steps go with its create's undo, which drops the task */
  if (['proc scan', 'track finish', 'track park', 'track layout', 'edge add', 'task edit', 'question edit', 'task update'].includes(step.op)) return 'ok';
  return out && typeof out.id === 'string' ? out.id : null;
};

/* what the write puts on the project's conversion map. A file source's blob at HEAD (its text's hash when
   it is untracked or changed, as the survey takes it), the records its items became or were covered by, each
   card's source with its card, each answered call with its subjects' hashes, each folder (or file) kept, and the run
   with the folders' state and instruction files the survey saw (facts-map.json) and its judgments. One row list per kind. */
const RECORD_ID = /^(?:[A-Z]{1,3}-\d+(?:\.\d+)?|Q\d+|[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*)$/;
export function mapRows(plan, imp, { tree = new Map(), dirty = () => false, blobs = () => new Map(), folders = {}, head = null, cards = [], isFile = () => false, instructions = null, restamp = [], cov = null } = {}) {
  const loose = (f) => dirty(f) || !tree.has(f);
  const slashed = (f) => String(f || '').replace(/\\/g, '/');
  const sigOf = (f) => (f in folders ? folders[f] : folderSig(tree.get(f.replace(/\/+$/, ''))));
  const byFile = new Map();
  const add = (f, id, any = false) => {
    const k = String(f).replace(/\\/g, '/');
    if (!byFile.has(k)) byFile.set(k, new Set());
    if (id && (any || RECORD_ID.test(id))) byFile.get(k).add(id);
  };
  const items = new Map((plan.items || []).map((x) => [x.id, x]));
  const filesOf = (x) => (x && x.kind === 'track' && (x.fields || {}).files && x.fields.files.length ? x.fields.files : x && x.source && x.source.file ? [x.source.file] : []);
  for (const s of (imp && imp.steps) || []) if (!s.fix && s.row) for (const f of filesOf(items.get(s.row))) add(f, s.id);
  for (const c of plan.covered || []) if (!c.map) for (const f of filesOf(items.get(c.item))) for (const id of String(c.by).split(/,\s*/)) add(f, id);
  for (const c of cards) add(c.source, c.record, true);
  /* a map-held item keeps its records on a row this run puts again */
  for (const c of plan.covered || []) if (c.map) for (const f of filesOf(items.get(c.item))) if (byFile.has(slashed(f))) for (const id of String(c.by).split(/,\s*/)) add(f, id);
  /* each row's lines, which alone a later run reads as written: a map-held item's, a seed's kinds over its file,
     and with `cov` each item written or held by its record that coverage read with no gap ([from, to or null, kind]) */
  const gapped = new Set(((cov && cov.sources) || []).flatMap((s) => s.gaps.map((g) => g.item)));
  const made = new Set([...((imp && imp.steps) || []).filter((s) => !s.fix && s.row && s.id).map((s) => s.row), ...(plan.covered || []).filter((c) => !c.map).map((c) => c.item), ...cards.map((c) => c.item)]);
  const onMap = new Set((plan.covered || []).filter((c) => c.map).map((c) => c.item));
  const lines = new Map();
  const put = (f, span) => { const k = slashed(f); lines.set(k, [...(lines.get(k) || []), span]); };
  for (const x of plan.items || []) {
    if (!x || x.kind === 'fix' || x.cut || !(onMap.has(x.id) || (cov && made.has(x.id) && !gapped.has(x.id)))) continue;
    const s = x.source || {};
    for (const f of filesOf(x)) { const on = s.line && slashed(s.file) === slashed(f); put(f, [on ? Number(s.line) : 1, on ? Number(s.end || s.line) : null, x.kind]); }
  }
  for (const sd of (plan.map && plan.map.seeds) || []) for (const k of sd.kinds || []) put(sd.source, [1, null, k]);
  const subjects = (plan.answers || []).flatMap((a) => a.subjects || []);
  /* what the run left out, counted per group answer (the call that dropped it, or none), never by item */
  const leftBy = new Map();
  for (const id of plan.left || []) { const by = (items.get(id) || {}).dropped || null; leftBy.set(by, (leftBy.get(by) || 0) + 1); }
  const left = [...leftBy].map(([call, count]) => ({ ...(call ? { call } : {}), count }));
  /* a kept path that is a file is judged and mapped as a file, its hash re-checked */
  const bareOf = (p) => String(p || '').replace(/\/+$/, '');
  const judged = (plan.judged || []).map((j) => (j.kind === 'folder' && isFile(bareOf(j.subject)) ? { ...j, key: 'file:' + bareOf(j.subject), kind: 'file', subject: bareOf(j.subject) } : j));
  const hashed = judged.filter((j) => j.kind === 'item' || j.kind === 'file').map((j) => j.subject);
  const texts = blobs([...byFile.keys(), ...((plan.map && plan.map.seeds) || []).map((sd) => sd.source), ...restamp.map((r) => r.source), ...subjects, ...hashed].filter((f) => f && !isFolder(f) && loose(f)));
  const hashOf = (f) => (loose(f) ? texts.get(f) || null : tree.get(f) || null);
  const file = [...byFile].map(([f, ids]) => ({ source: f, kind: 'file', hash: hashOf(f), sha: head, records: [...ids], detail: { lines: lines.get(f) || [] } }));
  for (const sd of (plan.map && plan.map.seeds) || []) if (!byFile.has(sd.source)) file.push({ source: sd.source, kind: isFolder(sd.source) ? 'folder' : 'file', hash: isFolder(sd.source) ? sigOf(sd.source) : hashOf(sd.source), sha: head, records: sd.records, why: 'an earlier import', ...(lines.has(sd.source) ? { detail: { lines: lines.get(sd.source) } } : {}) });
  /* an earlier run's row for a file the handover edited takes the new hash with its records, so a rerun reads it unchanged */
  for (const r of restamp) if (!file.some((x) => x.source === r.source)) file.push({ source: r.source, kind: 'file', hash: hashOf(r.source), sha: head, records: r.records || [], ...(r.fate ? { fate: r.fate } : {}), ...(r.why ? { why: r.why } : {}), ...(lines.has(r.source) ? { detail: { lines: lines.get(r.source) } } : r.detail ? { detail: r.detail } : {}) });
  const call = (plan.answers || []).map((a) => ({ source: CALL + a.call, kind: 'call', answer: a.letter, sha: head,
    detail: { ask: a.ask, label: a.label, subjects: Object.fromEntries((a.subjects || []).map((p) => [p, isFolder(p) ? sigOf(p) || NONE : hashOf(p) || NONE])) } }));
  const folder = [];
  /* a kept file that is also a source keeps one row, its records, hash and lines with the keep */
  for (const f of (plan.folders || []).filter((x) => x.end === 'keep')) {
    const k = { source: isFile(bareOf(f.path)) ? bareOf(f.path) : f.path.replace(/\/*$/, '/'), kind: 'folder', fate: 'keep', why: f.why || null, sha: head };
    const src = file.find((x) => x.kind === 'file' && x.source === k.source);
    if (src) Object.assign(src, { fate: 'keep', why: k.why }); else folder.push(k);
  }
  const run = [{ source: RUN + plan.made, kind: 'run', sha: head, detail: { folders,
    ...(left.length ? { left } : {}),
    ...(judged.length ? { judged: judged.map((j) => ((j.kind === 'item' || j.kind === 'file') && hashOf(j.subject) ? { ...j, hash: hashOf(j.subject) } : j)) } : {}),
    ...(instructions ? { instructions } : {}) } }];
  return { file, call, folder, run };
}
/* the repo's blobs and trees at HEAD, what is uncommitted and its text's hashes, for the map */
export function mapState(dir, work, git = gitIn(dir)) {
  const top = git(['rev-parse', 'HEAD']);
  const blobs = (paths) => blobsOf(dir, paths.filter((f) => existsSync(join(dir, f))));
  const seen = readJson(join(work, 'facts-map.json'), {}) || {};
  const isFile = (f) => { try { return statSync(join(dir, f)).isFile(); } catch { return false; } };
  const more = { isFile, instructions: seen.instructions || null };
  if (top.status !== 0) return { tree: new Map(), dirty: () => true, blobs, folders: {}, head: null, ...more };
  const tree = parseTree(git(['-c', 'core.quotepath=false', 'ls-tree', '-r', '-t', '-z', '--full-tree', 'HEAD']).stdout);
  const repo = repoState(dir, git);
  const loose = new Set([...repo.untracked, ...repo.changed]);
  return { tree, dirty: (f) => loose.has(f), loose, blobs, folders: seen.folders || {}, head: String(top.stdout).trim(), ...more };
}
/* one put per kind; a refusal is reported, never a stop: the records are written either way */
async function putMap(run, env, project, runId, groups, log) {
  const failed = [];
  for (const [kind, rows] of Object.entries(groups)) {
    if (!rows.length) continue;
    let r;
    try { r = await run(['conversion', 'put', '--project', project], { stdin: JSON.stringify({ run: runId, rows }), env }); } catch (e) { r = { ok: false, why: oneLine(e && e.message) }; }
    if (!r.ok) failed.push(kind + ': ' + clip(r.why, 200));
  }
  if (failed.length) log('The conversion map was not written (' + failed.join('; ') + '): the next run reads these sources again');
  return failed;
}
/* the map's keeps reach this PC's loose-file list too, so no handoff offers a kept folder's files for deletion */
function keepOnPc(env, project, folders, gone, log) {
  try { keepFromConversion(dataDir(env), project, folders, new Date().toISOString().slice(0, 10), gone); } catch (e) { log('The kept folders did not reach this PC\'s loose-file list: ' + oneLine(e && e.message)); }
}

/* The CLI's own command code behind a launcher path: the launcher's lib, or the one a sync shim imports. */
export function commandsOf(cli) {
  let launcher = resolve(cli);
  if (!/[\\/]bin[\\/]askerdo\.mjs$/.test(launcher)) {
    const m = /import\(\s*["']([^"']+)["']\s*\)/.exec(readText(cli) || '');
    if (m) launcher = m[1].startsWith('file:') ? fileURLToPath(m[1]) : resolve(dirname(cli), m[1]);
  }
  return join(dirname(launcher), '..', 'lib', 'cli-commands.mjs');
}
/* every call runs through runCommand in this process (the launcher's own fallback, never one node
   process per call): { ok, out, why } as the spawned CLI gave them */
export function cliRunner(cli, { near = true } = {}) {
  let mod = null;
  return async (args, { stdin, env }) => {
    mod = mod || await import(pathToFileURL(commandsOf(cli)).href);
    let r;
    try { r = await mod.runCommand({ argv: [...args, '--json'], cwd: process.cwd(), env, stdin: stdin ?? '', tty: false, near }); } catch (e) { return { ok: false, out: undefined, why: 'the command threw: ' + oneLine(e && e.message) + '; it may have run' }; }
    if (r.needStdin) return { ok: false, out: undefined, why: 'the command asked for stdin the step did not give' };
    let out;
    try { out = JSON.parse(String(r.stdout || '').trim()); } catch { out = undefined; }
    return { ok: r.code === 0, out, why: oneLine(r.stderr || r.stdout || 'exit ' + r.code) };
  };
}
/* many records in one show call; a batch the board refuses (one id it lacks) splits until each part reads */
async function showMany(run, ids, env) {
  if (!ids.length) return [];
  const r = await run(['show', ...ids], { env });
  if (r.ok) return Array.isArray(r.out) ? r.out : [r.out];
  if (ids.length === 1) return [null];
  const h = Math.ceil(ids.length / 2);
  return [...await showMany(run, ids.slice(0, h), env), ...await showMany(run, ids.slice(h), env)];
}

/* a bulk read marks nothing read: show marks a record read for the session its env names */
const unread = (env) => { const e = { ...env }; delete e.CLAUDE_CODE_SESSION_ID; return e; };

function target(work, board) {
  if (!board) return null;
  if (board === 'live') return { name: 'live', env: null, results: join(work, 'apply-results.json'), manifest: join(work, 'manifest.json'), bodies: join(work, 'bodies'), coverage: join(work, 'coverage.json'),
    idmap: join(work, 'idmap.json'), repoint: join(work, 'repoint.json') };
  if (!/^file:.+/.test(board)) throw new Error('--board takes file:<db> (a scratch board) or live');
  const tag = basename(board.slice(5)).replace(/[^A-Za-z0-9.-]+/g, '_');
  const dir = join(work, 'rehearsal');
  /* the CLI keeps handoff lists and a log beside its data: a rehearsal's go to a home of its own (outside ~/.claude, as the seam asks) */
  const home = process.env.ASKERDO_SANDBOX_HOME || join(tmpdir(), 'askerdo-onboard', basename(resolve(work)) + '-' + tag);
  mkdirSync(home, { recursive: true });
  const env = { ASKERDO_BOARD_URL: board, ASKERDO_SANDBOX_HOME: home };
  return { name: board, env, rehearsal: true, results: join(dir, tag + '-results.json'), manifest: join(dir, tag + '-manifest.json'), bodies: join(dir, 'bodies'), coverage: join(dir, tag + '-coverage.json'),
    idmap: join(dir, tag + '-idmap.json'), repoint: join(dir, tag + '-repoint.json') };
}
const loadPlan = (work) => {
  const plan = readJson(join(work, 'plan.json'));
  if (!plan) throw new Error('no plan.json in ' + work + ': run plan.mjs first');
  return plan;
};

export async function applyPlan(work, { board, cli = DEFAULT_CLI, log = console.log } = {}) {
  const plan = loadPlan(work);
  const t = target(work, board);
  if (t && !t.rehearsal && plan.pending.length) throw new Error(plan.pending.length + ' items still wait on the session (plan.mjs lists them); the live write takes none of them half done');
  if (t && !t.rehearsal && !plan.go) throw new Error('no go recorded: nothing goes to the live board before the user\'s go in chat, which plan.mjs ' + work + ' --go --session <own id> records');
  const run = cliRunner(cli, { near: false });
  const env = { ...process.env, ...(t && t.env) };
  const results = t ? readJson(t.results, {}) : {};
  const manifest = t ? readJson(t.manifest, null) || { project: plan.project, label: plan.label, store: t.name, imports: [], left: [] } : null;
  /* each step keeps its item's source and the import the calls' answers, which later runs key on */
  const sources = new Map((plan.items || []).filter((x) => x.source).map((x) => [x.id, x.source]));
  /* a fix may name a record this write made by its plan ref: the manifest keeps the id it became, which the undo takes */
  const real = (v) => JSON.parse(JSON.stringify(v ?? null).replace(REF, (m, ref) => known.get(ref) || m));
  const settled = (s) => (s.fix ? { ...s, args: real(s.args), target: real(s.target), ...(s.was ? { was: real(s.was) } : {}) } : s);
  const entry = (raw, given) => {
    const s = settled(raw);
    const id = s.fix ? s.target : given;
    return { n: s.n, step: s.id, row: s.item, rows: s.items, op: s.op, kind: kindOf(s), id, ...(s.fix ? { fix: true } : {}), undo: undoArgs(s, id, plan.label), ...(s.files ? { files: s.files } : {}),
      ...(sources.has(s.item) ? { source: sources.get(s.item) } : {}) };
  };
  let imp = manifest && manifest.imports.find((i) => i.plan === plan.made && !i.undone);
  if (manifest && !imp) { imp = { plan: plan.made, at: new Date().toISOString(), steps: [] }; manifest.imports.push(imp); }
  if (imp) imp.answers = (plan.answers || []).map((a) => ({ call: a.call, answer: a.letter, label: a.label }));
  const known = new Map(Object.entries(results).filter(([, r]) => r.id).map(([k, r]) => [k, r.id]));
  known.set(WAKE_REF, wakeIn());
  /* the id map with the ids the steps made, merged by key so a second import keeps the first's;
     a rehearsal writes its own, never the live file */
  const saveIdmap = () => {
    if (!t || !plan.idmap) return;
    const prev = readJson(t.idmap, {}) || {};
    const out = { ...prev };
    for (const [k, v] of Object.entries(plan.idmap)) {
      const p = prev[k] || {};
      out[k] = { ...v, ...(v.step ? { id: known.get(v.step) || p.id || null } : {}), ...(v.steps ? { ids: [...new Set(v.steps.map((s) => known.get(s)).filter(Boolean))] } : {}) };
    }
    writeJson(t.idmap, out);
  };
  const tally = {};
  const refusals = [];
  const skipped = [];
  const scratch = [];
  const wouldRun = [];
  const triggers = [];
  log((t ? (t.rehearsal ? 'Rehearsal on ' + t.name : 'LIVE write to the board') : 'Dry run, nothing is written') + ': ' + plan.steps.length + ' steps for ' + plan.project.dir);
  /* a scratch board lacks the workstreams the plan names on the real one: a stand-in each */
  const standIn = new Map(Object.entries((results['stand-ins'] || {}).map || {}));
  if (t && t.rehearsal) {
    const named = new Set(JSON.stringify(plan.steps.map((s) => [s.args, s.stdin])).match(/"WS-\d+"/g) || []);
    for (const q of named) {
      const id = q.slice(1, -1);
      if (standIn.has(id)) continue;
      const r = await run(['ws', 'create'], { stdin: JSON.stringify({ name: 'Rehearsal stand-in for ' + id, description: id + ' on the real board', projects: [plan.project.dir] }), env });
      if (!r.ok || !r.out) throw new Error('the rehearsal could not make a stand-in for ' + id + ': ' + r.why);
      standIn.set(id, r.out.id);
      log('stand-in ' + r.out.id + ' for ' + id);
    }
    /* and a track a step places a task or a question on, so the rehearsal runs the placement */
    const tracks = new Set(plan.steps.filter((s) => !s.fix && (s.op === 'task edit' || s.op === 'question edit')).flatMap((s) => (s.args || []).filter((a, i) => s.args[i - 1] === '--track' && /^TR-\d+$/.test(a))));
    for (const id of tracks) {
      if (standIn.has(id)) continue;
      let home = [...standIn.entries()].find(([k]) => k.startsWith('WS-'));
      if (!home) {
        const w = await run(['ws', 'create'], { stdin: JSON.stringify({ name: 'Rehearsal stand-in for the real board\'s tracks', description: 'holds stand-in tracks', projects: [plan.project.dir] }), env });
        if (!w.ok || !w.out) throw new Error('the rehearsal could not make a stand-in workstream for ' + id + ': ' + w.why);
        home = ['', w.out.id];
        standIn.set('stand-in workstream', w.out.id);
      }
      const r = await run(['track', 'new', '--workstream', home[1], '--name', 'Rehearsal stand-in for ' + id, '--goal', id + ' on the real board'], { env });
      if (!r.ok || !r.out) throw new Error('the rehearsal could not make a stand-in for ' + id + ': ' + r.why);
      standIn.set(id, r.out.id);
      log('stand-in ' + r.out.id + ' for ' + id);
    }
    results['stand-ins'] = { map: Object.fromEntries(standIn) };
  }
  const swap = (v) => (standIn.size ? JSON.parse(JSON.stringify(v ?? null).replace(/"((?:WS|TR)-\d+)"/g, (m, id) => (standIn.has(id) ? '"' + standIn.get(id) + '"' : m))) : v);
  const started = Date.now();
  let ran = 0;
  const timing = () => { const ms = Date.now() - started; return { steps: ran, ms, perSecond: ms ? Math.round((ran / (ms / 1000)) * 10) / 10 : null }; };
  for (const s of plan.steps) {
    const tag = '[' + s.n + '] ' + s.op + (s.item ? ' (' + clip(s.item, 70) + ')' : '');
    if (results[s.id] && results[s.id].id) {
      /* a step whose manifest line was lost to a crash after it landed is put back, so the undo still finds it */
      if (manifest && !manifest.imports.some((i) => i.steps.some((x) => x.step === s.id))) imp.steps.push(entry(results[s.id].was ? { ...s, was: results[s.id].was } : s, results[s.id].id));
      tally[s.op] = (tally[s.op] || 0) + 1;
      continue;
    }
    /* started and never recorded: it may have landed, so it is never sent twice */
    if (t && results[s.id] && results[s.id].started) {
      const why = tag + ': an earlier run started it and recorded no id, so it may be on the board. Look for it (list --all --label ' + plan.label
        + ', its refs carry onboard:' + s.item + '), then put its id in ' + t.results + ' as "id", or delete its line if it is not there';
      refusals.push(why);
      if (!t.rehearsal) { saveIdmap(); log('\nStopped at step ' + s.n + '. ' + why); return { tally, refusals, skipped, stopped: s.n, timing: timing() }; }
      continue;
    }
    let step = s;
    /* a fix changes a record of the real board, which a scratch board lacks: listed, never run */
    if (t && t.rehearsal && s.fix) { (String(s.id).endsWith('@files') ? triggers : wouldRun).push('would run: ' + s.op + ' ' + s.target + ' (askerdo ' + (s.args || []).map(shq).join(' ') + ')' + (s.body !== undefined ? ', with the text: ' + oneLine(s.body) : '')); continue; }
    if (t && t.rehearsal) {
      const sc = scratchStep(s, standIn);
      if (sc.dropped.length) {
        scratch.push(tag + ': ' + sc.dropped.join(', ') + (sc.skip ? ', so the step is skipped' : ' left out'));
        if (sc.skip) continue;
        step = { ...s, args: sc.args, stdin: sc.stdin };
      }
    }
    const missing = [...JSON.stringify([s.args, s.stdin, s.body]).matchAll(REF)].map((m) => m[1]).filter((id) => !known.has(id));
    /* stand-ins swap before the refs resolve: a scratch id the run makes may equal a real id a stand-in holds */
    const sub = (v) => JSON.parse(JSON.stringify(swap(v) ?? null).replace(REF, (_, id) => known.get(id) || '<the id step ' + (plan.steps.find((x) => x.id === id) || {}).n + ' makes>'));
    const args = asApproved(withTier(sub(step.args)), plan.go && plan.go.session);
    if (t && missing.length) {
      skipped.push(tag + ': skipped, it needs ' + missing.map((id) => 'step ' + (plan.steps.find((x) => x.id === id) || {}).n).join(', ') + ', which did not land');
      continue;
    }
    let bodyFile = null;
    if (s.body !== undefined) bodyFile = join(t ? t.bodies : join(work, 'bodies'), s.n + '.md');
    const argv = bodyFile ? [...args, '--body-file', bodyFile] : args;
    if (!t) {
      log(tag + '\n  askerdo ' + argv.map(shq).join(' ') + (s.stdin ? '\n  stdin: ' + clip(JSON.stringify(sub(s.stdin)), 160) : '') + (s.body ? '\n  body: ' + clip(s.body, 120) : ''));
      tally[s.op] = (tally[s.op] || 0) + 1;
      continue;
    }
    if (bodyFile) { mkdirSync(t.bodies, { recursive: true }); writeFileSync(bodyFile, sub(s.body).replace(/\r\n/g, '\n') + '\n'); }
    /* the text an amend's undo puts back, read before the amend lands */
    let was = null;
    if (s.undoText) {
      const [rec] = await showMany(run, [real(s.target)], unread(env));
      const body = rec && rec.sections && rec.sections.Body;
      if (typeof body !== 'string') {
        refusals.push(tag + ': ' + real(s.target) + ' could not be read, so its undo would have no text to put back');
        if (!t.rehearsal) { writeJson(t.manifest, manifest); saveIdmap(); log('\nStopped at step ' + s.n + '. ' + refusals[refusals.length - 1] + '\nRun again once the board shows it.'); return { tally, refusals, skipped, stopped: s.n, timing: timing() }; }
        continue;
      }
      was = { ...(s.was || {}), body };
    }
    results[s.id] = { started: new Date().toISOString(), ...(was ? { was } : {}) };
    writeJson(t.results, results);
    const r = await run(argv, { stdin: step.stdin ? JSON.stringify(sub(step.stdin)) : '', env });
    ran++;
    const id = r.ok ? idOf(settled(s), r.out) : null;
    if (!r.ok && t.rehearsal && s.onReal) { scratch.push(tag + ': ' + s.onReal + ' is a profile of the real board, which this scratch board lacks'); delete results[s.id]; writeJson(t.results, results); continue; }
    if (!r.ok || !id) {
      refusals.push(tag + ': ' + clip(r.ok ? 'it landed but gave no id: ' + JSON.stringify(r.out) : r.why, 400));
      /* a refusal wrote nothing, so the step can run again; one that landed with no id keeps its started mark */
      if (r.ok || /may have run/i.test(r.why)) results[s.id] = { started: results[s.id].started, raw: r.ok ? r.out : r.why }; else delete results[s.id];
      writeJson(t.results, results);
      if (!t.rehearsal) {
        writeJson(t.manifest, manifest);
        saveIdmap();
        log('\nStopped at step ' + s.n + '. ' + refusals[refusals.length - 1] + '\nFix it and run again: the steps done are kept and skipped.');
        return { tally, refusals, skipped, stopped: s.n, timing: timing() };
      }
      continue;
    }
    /* the real board holds that profile on the project (or the plan's hold step will): the scratch board holds it too,
       so the read-back sees the line */
    if (t.rehearsal && s.op === 'profile rule-add') await run(['profile', 'add', plan.project.dir, s.onReal || s.args[2]], { env });
    known.set(s.id, id);
    results[s.id] = { id, at: new Date().toISOString(), ...(was ? { was } : {}) };
    imp.steps.push(entry(was ? { ...s, was } : s, id));
    /* the numbers of the steps the import added, which its undo strikes; a step added later is never the import's */
    if (s.op === 'task update' && String(s.id).endsWith('@steps')) imp.steps[imp.steps.length - 1].checks = addedSteps(s.args, r.out);
    writeJson(t.results, results);
    writeJson(t.manifest, manifest);
    tally[s.op] = (tally[s.op] || 0) + 1;
  }
  const took = timing();
  let refused = 0;
  if (t) {
    imp.done = new Date().toISOString();
    imp.write = took;
    manifest.left = [...new Set([...(manifest.left || []), ...plan.left])];
    writeJson(t.manifest, manifest);
    saveIdmap();
    refused = refusals.length;
    const failed = await putMap(run, env, plan.project.dir, plan.made, mapRows(plan, imp, mapState(plan.project.dir, work)), log);
    for (const f of failed) refusals.push('the conversion map: ' + f);
    keepOnPc(env, plan.project.dir, (plan.folders || []).filter((f) => f.end === 'keep'), [], log);
  }
  log('\n' + (t ? 'Written' : 'Would write') + ': ' + Object.entries(tally).map(([k, v]) => k + ' ' + v).join(', '));
  if (t) log('The write: ' + took.steps + ' calls in ' + (took.ms / 1000).toFixed(1) + ' s, ' + took.perSecond + ' a second, in one process.');
  if (skipped.length) log('Skipped (' + skipped.length + '):\n  ' + skipped.join('\n  '));
  if (triggers.length) log('Files added to facts the board holds, run on the go against the real board (' + triggers.length + '):\n  ' + triggers.join('\n  '));
  if (wouldRun.length) log('The doctor\'s fixes, run on the go against the real board (' + wouldRun.length + '):\n  ' + wouldRun.join('\n  '));
  if (scratch.length) log('Named on the real board, which a scratch board lacks (' + scratch.length + '):\n  ' + scratch.join('\n  '));
  if (refusals.length) log('Refused (' + refusals.length + '):\n  ' + refusals.join('\n  '));
  const goes = (plan.folders || []).filter((f) => f.end !== 'keep');
  if (goes.length || (plan.cards || []).length || (plan.claude || []).length || (plan.lineEdits || []).length) log('The handover makes the repo edits on the go in one commit, each folder once its gate clears it (--coverage, then --handover): '
    + (plan.cards || []).length + ' cards, ' + (plan.lineEdits || []).length + ' line edits of kept files, ' + (plan.claude || []).length + ' ledger rewrites, ' + goes.length + ' folders deleted, retired or moved');
  if (plan.pending.length) log('Not in this plan, waiting on the session: ' + plan.pending.length + ' items (plan.mjs lists them)');
  return { tally, refusals, skipped, scratch, wouldRun, triggers, refused, timing: took };
}

/* one rehearsal on a scratch board: the write, coverage, then the undo with its one press (a stand-in
   on the scratch board for the user's Withdraw), so the undo is proven, not checked by hand; both counts in the report */
const STAND_IN = 'rehearsal';
export async function rehearse(work, { board, cli = DEFAULT_CLI, log = console.log } = {}) {
  const t = target(work, board);
  if (!t || !t.rehearsal) throw new Error('a rehearsal runs on a scratch board: --board file:<db>');
  const w = await applyPlan(work, { board, cli, log });
  const plan = loadPlan(work);
  const cov = await runCoverage(work, { board, cli, log: () => {} });
  const imp = () => readJson(t.manifest, { imports: [] }).imports.filter((i) => i.plan === plan.made).pop() || { steps: [] };
  /* a record or a rule line the write made; a step on one (its checklist, its order) goes with it */
  const made = (s) => s.id && s.id !== 'ok' && !s.fix;
  const written = imp().steps.filter(made);
  const undo = await proveUndo(work, { board, cli, log });
  const after = imp().steps.filter(made);
  const back = after.filter((s) => s.undoneAt && !s.stays);
  const left = after.filter((s) => !(s.undoneAt && !s.stays));
  const file = join(work, 'rehearsal.md');
  writeFileSync(file, rehearsalReport(work, { plan, manifest: readJson(t.manifest, null), cov, written, undo: { back, left, failed: undo.failed, waiting: undo.waiting }, wouldRun: w.wouldRun, refusals: w.refusals }));
  log('The undo took back ' + back.length + ' of the ' + written.length + ' records the write made' + (left.length ? '; ' + left.length + ' stay: ' + left.map((s) => s.kind + ' ' + s.id).join(', ') : '') + '.');
  log('The rehearsal report: ' + file);
  return { ...w, cov, written: written.length, undone: back.length, left: left.map((s) => s.id), undo };
}
/* the undo as the go's would run, on the scratch board: its request, the stand-in press, the undo again */
async function proveUndo(work, { board, cli, log }) {
  const t = target(work, board);
  const quiet = () => {};
  let u = await undoImport(work, { board, cli, session: STAND_IN, log: quiet });
  for (const n of u.requests || []) {
    const r = await cliRunner(cli)(['override', 'decide', String(n), 'allow', '--user', STAND_IN], { env: { ...process.env, ...t.env } });
    if (!r.ok) { log('The stand-in press on request #' + n + ' was refused: ' + clip(r.why, 200)); return u; }
  }
  if ((u.requests || []).length) u = await undoImport(work, { board, cli, session: STAND_IN, log: quiet });
  return u;
}

/* a folder's end on the go. A delete needs nothing live in it: no code reader, a dormant plan's
   open items answered by the dormant-work call, every converted source in it covered, no untracked file (git has
   no copy) and no uncommitted change. A move needs no code reader, its sources covered and no uncommitted change.
   A live cite never holds it: the repoint rewrites it, and one a tool prints that it cannot resolve is a gap.
   { path, end, go, hold: 'kept' | 'skipped', why } */
/* readers as a list, or as the facts give them ({ files, from }), so a block copied whole still holds the folder */
const readersIn = (v) => (Array.isArray(v) ? v : v && typeof v === 'object' ? ((v.from || []).length ? v.from : v.files ? [v.files + ' files'] : []) : []);
/* a reader that goes in this run, or has left the tree, holds nothing; readers the facts only
   count stay unknown, so they hold */
function readersLeft(v, gone) {
  const all = readersIn(v);
  const listed = Array.isArray(v) ? v.length : ((v && v.from) || []).length;
  if (!listed) return all;
  const left = all.filter((r) => !gone(String(r).replace(/:\d+$/, '')));
  const more = Array.isArray(v) ? 0 : Math.max(0, (Number(v.files) || 0) - listed);
  return more ? [...left, more + ' more files'] : left;
}
export const GONE = ['delete', 'retire'];
/* a skill folder that stays as a pointer at its card (`to`): its SKILL.md keeps only its name and
   description, and its other files go */
export const POINT = 'point';
export function folderGate(f, { cov = null, tracked = new Set(), untracked = [], changed = new Set(), runs = [], going = new Set(), keeps = [] } = {}) {
  const path = folderKey(f.path);
  const end = f.end;
  if (end !== 'move' && end !== POINT && !GONE.includes(end)) return { path, end: 'keep', go: false, why: f.why || 'kept' };
  const ev = f.evidence || {};
  const stay = (why) => ({ path, end, go: false, hold: 'kept', why });
  if (end === 'move' && !f.to) return stay('a move with no folder to go to');
  if (end === POINT && !f.to) return stay('a pointer with no card to name');
  const gone = (r) => [...going].some((g) => under(r, g)) || (tracked.size > 0 && !tracked.has(r) && !untracked.includes(r));
  const readers = readersLeft(ev.codeReaders, gone);
  if (readers.length) return stay('read by ' + readers.join(', '));
  const blocked = cov ? cov.sources.filter((s) => s.blocked && under(s.file, path)) : [];
  if (blocked.length) return stay(blocked.reduce((n, s) => n + s.gaps.length, 0) + ' coverage gaps in ' + blocked.map((s) => s.file).join(', '));
  const dirty = [...changed].filter((x) => under(x, path));
  if (dirty.length) return { path, end, go: false, hold: 'skipped', why: 'uncommitted changes in ' + dirty.length + ' files (' + dirty.slice(0, 3).join(', ') + ')' };
  let hooked = [];
  let left = [];
  if (GONE.includes(end) || end === POINT) {
    if (ev.openItems > 0 && f.dormant && !f.answeredBy) return stay(ev.openItems + ' open items, and no answer to the dormant-work call names it');
    /* an untracked file a keep entry of its own names stays on disk, since git rm takes tracked files only */
    const inside = untracked.filter((x) => under(x, path));
    left = inside.filter((x) => keeps.some((k) => k !== path && under(k, path) && under(x, k)));
    const loose = inside.filter((x) => !left.includes(x));
    if (loose.length || (!inside.length && ev.untracked > 0)) return stay('it holds ' + (loose.length || ev.untracked) + ' untracked files: git has no copy of them');
  }
  if (GONE.includes(end)) {
    /* the settings entries that run it leave in its commit; one in a file git does not keep is the user's to take out */
    hooked = runs.filter((x) => runsIt(x.command, path, tracked.has(path)));
    const local = hooked.find((x) => !x.tracked);
    if (local) return stay(local.file + ' runs it (' + local.what + ') and git keeps no copy of that file: take the entry out there by hand');
    const busy = hooked.find((x) => changed.has(x.file));
    if (busy) return { path, end, go: false, hold: 'skipped', why: 'uncommitted changes in ' + busy.file + ', which its unhook would commit' };
  }
  let files = 0;
  for (const x of tracked) if (under(x, path)) files++;
  if (!files) return stay('nothing of it is in git');
  return { path, end, go: true, files, ...(tracked.has(path) ? { file: true } : {}), ...(end === 'move' || end === POINT ? { to: folderKey(f.to) } : {}), ...(end === POINT && f.description ? { description: String(f.description) } : {}),
    ...(hooked.length ? { unhook: hooked.map((x) => ({ file: x.file, what: x.what })) } : {}), ...(left.length ? { stays: left } : {}), why: f.why || '' };
}
/* a folder as its commit names it; a file unit keeps its own name */
const unit = (g) => g.path + (g.file ? '' : '/');
/* a skill's SKILL.md as a pointer: its frontmatter name and description, then a line naming the card, so the
   agent keeps a skill it can call while the card holds the one copy of the steps; `description` replaces a stale one */
export function pointerSkill(text, to, description = null) {
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(text || ''));
  let key = null;
  const keep = [];
  for (const l of front ? front[1].split(/\r?\n/) : []) {
    const k = /^([A-Za-z][\w-]*):/.exec(l);
    if (k) key = k[1];
    if (key === 'name' || (key === 'description' && !description)) keep.push(l);
  }
  if (description) keep.push('description: ' + JSON.stringify(String(description).replace(/\s+/g, ' ').trim()));
  const name = (/^name:\s*(.+)$/m.exec(keep.join('\n')) || [])[1];
  if (!name) return null;
  return '---\n' + keep.join('\n') + '\n---\n\n# ' + name.trim().replace(/^["']|["']$/g, '') + '\n\nThe steps of this routine live in the procedure card `' + to + '`: read it and follow its steps.\n';
}
/* the gates with the readers that go in the same run discounted: a unit leaves the going set when its
   own gate holds it, until none does; `goes` limits the units this call takes (--file) */
export function gatesOf(plan, cov, repo, { goes = () => true } = {}) {
  const fs = plan.folders || [];
  const loads = Object.entries(plan.loaders || {});
  let going = new Set(fs.filter((f) => GONE.includes(f.end) && goes(f.path)).map((f) => folderKey(f.path)));
  const keeps = fs.filter((f) => f.end === 'keep').map((f) => folderKey(f.path));
  for (;;) {
    const gates = fs.map((f) => folderGate(f, { cov, ...repo, going, keeps }));
    /* a loader stays while a file it loads stays held, so the rules a gap holds back still reach sessions */
    const heldAt = (file) => gates.find((g) => g.end !== 'keep' && !g.go && under(file, g.path));
    for (const g of gates.filter((x) => x.go && GONE.includes(x.end))) {
      const hit = loads.find(([file, by]) => !under(file, g.path) && by.some((l) => under(l, g.path)) && heldAt(file));
      if (hit) Object.assign(g, { go: false, hold: 'kept', why: 'it loads ' + hit[0] + ', which stays while ' + heldAt(hit[0]).path + ' is held (' + heldAt(hit[0]).why + ')' });
    }
    const next = new Set(gates.filter((g) => g.go && going.has(g.path)).map((g) => g.path));
    if (next.size === going.size) return gates;
    going = next;
  }
}
/* an instruction file's ledger with each dropped pointer or import kept while a file it loads sits in a
   held unit, as gatesOf keeps a loader, so the rules a gap holds still reach sessions */
export function keptBack(ledger, gates) {
  const heldAt = (file) => gates.find((g) => g.end !== 'keep' && !g.go && under(file, g.path));
  const back = [];
  const clauses = (ledger.clauses || []).map((c) => {
    const at = c.fate === 'dropped' && (c.loads || []).find(heldAt);
    if (!at) return c;
    back.push({ path: ledger.path + ':' + c.line, why: 'it loads ' + at + ', which stays while ' + heldAt(at).path + ' is held (' + heldAt(at).why + ')' });
    return { ...c, fate: 'kept' };
  });
  return { ledger: { ...ledger, clauses }, back };
}
/* the settings entries that run a unit taken out, each file rewritten whole in its own indent and line ends */
function unhook(dir, g) {
  const files = [...new Set((g.unhook || []).map((u) => u.file))];
  const it = (c) => runsIt(c, g.path, g.file);
  for (const file of files) {
    const abs = join(dir, file);
    const raw = readText(abs);
    const j = JSON.parse(raw);
    for (const [event, groups] of Object.entries(j.hooks || {})) {
      const left = (Array.isArray(groups) ? groups : []).map((x) => (x && Array.isArray(x.hooks) ? { ...x, hooks: x.hooks.filter((h) => !(h && typeof h.command === 'string' && it(h.command))) } : x))
        .filter((x) => !(x && Array.isArray(x.hooks) && !x.hooks.length));
      if (left.length) j.hooks[event] = left; else delete j.hooks[event];
    }
    if (j.hooks && !Object.keys(j.hooks).length) delete j.hooks;
    for (const [name, sv] of Object.entries(j.mcpServers || {})) if (sv && typeof sv === 'object' && it(serverLine(sv))) delete j.mcpServers[name];
    const indent = (/\n([ \t]+)"/.exec(raw) || [])[1] || '  ';
    writeFileSync(abs, eolLike(abs, JSON.stringify(j, null, indent) + (raw.endsWith('\n') ? '\n' : '')));
  }
  return files;
}

/* a .gitignore line un-ignoring only `path` (it, or a path under it, anchored to the file's folder); a
   pattern with no inner slash matches at any depth, so it may name other folders and stays */
export function negates(file, line, path) {
  if (!/(?:^|\/)\.gitignore$/.test(file)) return false;
  const m = /^!(\/?)(\S(?:.*\S)?)\s*$/.exec(String(line).replace(/\r$/, ''));
  if (!m || (!m[1] && !m[2].replace(/\/+$/, '').includes('/'))) return false;
  return under(file.replace(/[^/]*$/, '') + m[2].replace(/^\/+/, ''), path);
}
/* the tracked .gitignore lines that un-ignore only a unit taken out, dropped from each file in its line ends; a file
   with uncommitted changes keeps its lines, since a commit of its path would carry them */
function unignore(dir, g, tracked, dirty) {
  const files = [];
  const left = [];
  for (const file of [...tracked].filter((x) => /(?:^|\/)\.gitignore$/.test(x) && !under(x, g.path))) {
    const abs = join(dir, file);
    const raw = readText(abs);
    if (raw === null) continue;
    const lines = raw.split('\n');
    const keep = lines.filter((l) => !negates(file, l, g.path));
    if (keep.length === lines.length) continue;
    if (dirty(file)) { left.push(file); continue; }
    writeFileSync(abs, keep.join('\n'));
    files.push(file);
  }
  return { files, left };
}

/* the reports are counts by kind and by group, the group answers, and what the user acts on */
const kindsSaid = (steps) => { const n = {}; for (const s of steps) n[s.kind || s.op] = (n[s.kind || s.op] || 0) + 1; return Object.entries(n).map(([k, c]) => counted(c, KIND_WORD[k] || k)).join(', ') || 'none'; };
function groupLines(plan) {
  const out = [];
  for (const a of plan.answers || []) {
    const items = (plan.items || []).filter((x) => x.dropped === a.call || x.answeredBy === a.call).length;
    const folders = (plan.folders || []).filter((f) => f.group === a.call || f.answeredBy === a.call).map((f) => f.path + ' (' + f.end + ')');
    out.push('- ' + a.call + ': ' + oneLine(a.ask) + ' Answered ' + a.letter + ', ' + a.label + (a.count !== undefined ? ' (' + counted(a.count, 'item') + ')' : '')
      + (items ? '; ' + counted(items, 'item') + ' follow it' : '') + (folders.length ? '; folders ' + folders.join(', ') : '') + '.');
  }
  return out.length ? out : ['None.'];
}
function countLines(plan, written) {
  const dropped = new Map();
  for (const x of (plan.items || []).filter((y) => y.dropped)) dropped.set(x.dropped, (dropped.get(x.dropped) || 0) + 1);
  const cut = (plan.items || []).filter((x) => x.cut && !x.dropped).length;
  return ['- Written: ' + kindsSaid(written) + '.', '- Dropped by group: ' + ([...dropped].map(([c, n]) => c + ' ' + n).join(', ') || 'none') + '.',
    ...(cut ? ['- Cut with no group answer: ' + cut + '.'] : []), ...((plan.covered || []).length ? ['- Already on the board: ' + plan.covered.length + '.'] : [])];
}
export function rehearsalReport(work, { plan, manifest, cov, written = [], undo = null, wouldRun = [], refusals = [] }) {
  const out = ['# Rehearsal of the ' + plan.label + ' conversion', '', 'On the scratch board ' + ((manifest && manifest.store) || 'given') + ': written, read back by coverage, then undone. Nothing is on the live board or changed in the repo.', ''];
  out.push('## Counts', '', ...countLines(plan, written), '');
  out.push('## The group answers', '', ...groupLines(plan), '');
  if ((plan.history || []).length) out.push('## History pointers', '', ...plan.history.map((h) => '- ' + h.item + (h.amends ? ', an amend of ' + h.amends + ' the go runs on the real board' : '') + ': ' + h.folders.join(', ') + ', in git at ' + h.commit + '.'), '');
  if (undo) {
    out.push('## The undo', '', 'The undo ran with its one press (a stand-in for the user\'s Withdraw on the scratch board): it took back ' + undo.back.length + ' of the ' + written.length + ' records the write made'
      + (undo.back.length ? ' (' + kindsSaid(undo.back) + ')' : '') + '.');
    if (undo.left.length) out.push('Stay: ' + undo.left.map((s) => s.kind + ' ' + s.id).join(', ') + '.');
    for (const f of undo.failed || []) out.push('- refused: ' + f);
    for (const w of undo.waiting || []) out.push('- still waiting: ' + w);
    out.push('');
  }
  out.push('## Coverage', '', table(cov), '');
  const gates = gatesOf(plan, cov, repoState(plan.project.dir));
  const go = gates.filter((g) => g.go);
  out.push('## The handover, one commit on the go', '', '- ' + (plan.cards || []).length + ' cards, ' + (plan.lineEdits || []).length + ' line edits of kept files, ' + (plan.claude || []).length + ' instruction files from their ledgers.');
  out.push(...go.map((g) => '- ' + g.path + ': ' + (g.end === 'move' ? 'moves to ' + g.to : g.end === POINT ? 'a pointer at ' + g.to : g.end === 'retire' ? 'retires' : 'goes') + ' (' + counted(g.files, 'file') + ')'));
  out.push(...gates.filter((g) => g.hold).map((g) => '- ' + g.path + ' stays: ' + g.why), '');
  if ((plan.unlinked || []).length) out.push('## Links the plan dropped', '', ...plan.unlinked.map((u) => '- ' + (u.kind || 'Edge') + ': ' + u.item + ' names ' + u.names + ', which ' + u.why + '.'), '');
  if (refusals.length) out.push('## Refused', '', ...refusals.map((r) => '- ' + r), '');
  if (wouldRun.length) out.push('## The doctor\'s fixes the go runs', '', ...wouldRun.map((w) => '- ' + w), '');
  return out.join('\n');
}
/* the run report after the handover: counts written and dropped by group, the group answers, the commit,
   the undo command and the deviations; the session adds the field bugs it filed */
export function runReport(work, { plan, manifest, commit = null, skipped = [], held = [], stopped = null }) {
  const steps = ((manifest && manifest.imports) || []).filter((i) => i.plan === plan.made && !i.undone).flatMap((i) => i.steps).filter((s) => s.id && !s.fix && s.op !== 'proc scan');
  const out = ['# The ' + plan.label + ' conversion', '', '## Counts', '', ...countLines(plan, steps), '', '## The group answers', '', ...groupLines(plan), ''];
  out.push('## The commit', '', commit ? '`' + commit + '`, one commit; `git revert ' + commit + '` takes it back.' : 'None.', '');
  out.push('## The undo', '', '`node apply.mjs ' + work + ' --undo --board live --session <own id>`, then `git revert ' + (commit || '<the handover commit>') + '` on the user\'s word.', '');
  const dev = [...(stopped ? ['stopped at the ' + stopped.batch + ' step: ' + stopped.why] : []), ...held.map((h) => h.path + ' stays: ' + h.why), ...skipped.map((s) => s.path + ' skipped: ' + s.why)];
  out.push('## Deviations', '', ...(dev.length ? dev.map((d) => '- ' + d) : ['None.']), '', '## Field bugs', '', 'The session names each it filed, or none.', '');
  return out.join('\n');
}

/* the plan's items as coverage reads them: a card with the path the handover writes it at */
const coverItems = (plan) => (plan.items || []).map((x) => (x.kind === 'card' ? { ...x, target: ((plan.cards || []).find((c) => c.item === x.id) || {}).target } : x));

/* the coverage pass against the board a manifest names, for converted sources only: every record
   read back in batches of show in this process, rule lines from the profile, cards from their files */
export async function runCoverage(work, { board = 'live', cli = DEFAULT_CLI, log = console.log } = {}) {
  const t = target(work, board);
  const plan = loadPlan(work);
  const manifest = readJson(t.manifest, null);
  if (!manifest) throw new Error('no manifest at ' + t.manifest + ': coverage reads what the write made, so write first');
  const run = cliRunner(cli);
  const env = { ...process.env, ...(t.env || {}) };
  const dir = plan.project.dir;
  const eff = await run(['profile', 'show-effective', dir, '--rules'], { env });
  /* a file the handover's line edits changed reads as before them, the text the items' lines name */
  const edited = new Map(manifest.imports.filter((i) => i.plan === plan.made && !i.undone).flatMap((i) => i.repo || []).filter((e) => e.op === LINES && e.commit).map((e) => [e.path, e.commit]));
  const readFile = (p) => {
    if (edited.has(p)) { const r = gitIn(dir)(['show', edited.get(p) + '^:' + p]); if (r.status === 0) return r.stdout; }
    try { return readFileSync(join(dir, p), 'utf8'); } catch { return null; }
  };
  const items = coverItems(plan);
  const readRecord = recordReader({ manifest, show: (ids) => showMany(run, ids, unread(env)), rules: (eff.ok && eff.out && eff.out.rows) || [], readFile,
    cardText: (item) => cardText(cardRow(item, item.target)).text });
  await readRecord.prefetch(items);
  const cov = coverage(items, { manifest, readRecord, readFile, ledger: plan.claude || [], repoint: readJson(t.repoint, null), judged: plan.judged || [], whole: plan.readWhole || [], proved: plan.readNamed || {},
    exists: (p) => existsSync(join(dir, p)), going: (plan.folders || []).filter((f) => f.end === 'move' || f.end === POINT || GONE.includes(f.end)).map((f) => f.path), lineEdits: plan.lineEdits || [], backed: plan.backed || [],
    /* a cut's board records are read from the survey's facts, which a scratch board lacks */
    records: boardRecords((readFacts(work) || {}).board || plan.board) });
  cov.board = t.name;
  writeJson(t.coverage, cov);
  log('Coverage against ' + t.name + ' (' + t.coverage + '):\n' + table(cov));
  /* each source's map row takes the lines this pass read with no gap, which alone a later run reads as written;
     a source the handover took out keeps its end */
  const imp = manifest.imports.find((i) => i.plan === plan.made && !i.undone);
  const rows = imp ? mapRows(plan, imp, { ...mapState(dir, work), cov }).file.filter((r) => r.kind === 'file' && existsSync(join(dir, r.source))) : [];
  if (rows.length) await putMap(run, env, dir, plan.made, { file: rows }, log);
  return cov;
}

/* an instruction file rebuilt from its ledger: every line that is no carried, split or dropped clause stays
   as it was, a split clause's kept words take its place in its bullet or paragraph, a dropped sentence leaves
   its paragraph, a heading left with nothing under it goes, and with `board` one AskerDo section pointing at the
   board goes at the end (replacing one an earlier run wrote). */
const fold = (s) => oneLine(s).replace(/[`*_]/g, '').toLowerCase();
const RULES_HEAD = /\b(?:rules?|conventions?|guidelines?|polic(?:y|ies)|dos and don'?ts)\b/i;
export function claudeText(text, claude, board) {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  const out = lines.slice();
  const gone = (c) => c.fate === 'carried' || c.fate === 'dropped';
  /* each block (a bullet, or a paragraph's sentences) once, its clauses matched to the ledger's by their words */
  const blocks = new Map();
  for (const c of claude.clauses) { if (!blocks.has(c.line)) blocks.set(c.line, []); blocks.get(c.line).push(c); }
  for (const [line, cs] of blocks) {
    if (!cs.some((c) => gone(c) || c.fate === 'split')) continue;
    const { end, clauses: parts } = blockAt(lines, line - 1);
    const now = parts.slice();
    const used = new Set();
    /* a table is one clause: its kept words keep their rows */
    const table = /^\s*\|/.test(lines[line - 1]);
    for (const c of cs) {
      const k = parts.findIndex((p, n) => !used.has(n) && fold(p).includes(fold(c.text).slice(0, 40)));
      if (k < 0) throw new Error(claude.path + ' changed since the survey: line ' + line + ' no longer holds "' + clip(c.text, 60) + '"; run the survey again');
      used.add(k);
      if (gone(c)) now[k] = null;
      else if (c.fate === 'split') now[k] = table ? String(c.kept).trim() : oneLine(c.kept);
    }
    for (let i = line - 1; i < end; i++) out[i] = null;
    const left = now.filter(Boolean).join(' ');
    if (left) out[line - 1] = (/^\s*(?:[-*+]|\d+[.)])\s+/.exec(lines[line - 1]) || [''])[0] + left;
  }
  /* a heading whose section had text and now has none goes; deepest first, so a parent left empty goes too */
  const level = (l) => { const m = /^(#{1,6})\s/.exec(l || ''); return m ? m[1].length : 0; };
  const bodyEmpty = (arr, i) => { for (let j = i + 1; j < arr.length; j++) { if (arr[j] === null) continue; if (level(arr[j]) && level(arr[j]) <= level(arr[i])) return true; if (arr[j].trim()) return false; } return true; };
  const hadBody = lines.map((l, i) => level(l) > 0 && !bodyEmpty(lines, i));
  /* the file's title heading stays, so the AskerDo section never opens the file */
  const title = lines.findIndex((l) => l.trim());
  /* a heading that says rules goes once the rewrite took clauses from its own lines, so the kept facts
     under it join the section above */
  const moved = new Set([...blocks].filter(([, cs]) => cs.some((c) => gone(c) || c.fate === 'split')).map(([l]) => Number(l)));
  for (let i = 0; i < lines.length; i++) {
    if (i === title || out[i] === null || !level(lines[i]) || !RULES_HEAD.test(lines[i])) continue;
    let touched = false;
    for (let j = i + 1; j < lines.length && !level(lines[j]); j++) if (moved.has(j + 1)) touched = true;
    if (touched) out[i] = null;
  }
  for (let pass = 0; pass < 6; pass++) for (let i = out.length - 1; i >= 0; i--) if (i !== title && out[i] !== null && level(out[i]) && hadBody[i] && bodyEmpty(out, i)) out[i] = null;
  let kept = out.filter((l) => l !== null);
  /* an earlier run's AskerDo section is replaced */
  const s = kept.findIndex((l) => /^##\s+AskerDo\s*$/.test(l));
  if (s >= 0) { let e = s + 1; while (e < kept.length && !(level(kept[e]) && level(kept[e]) <= 2)) e++; kept.splice(s, e - s); }
  const body = kept.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '');
  return board ? body + '\n\n## AskerDo\n\n' + boardParagraph(board) + '\n' : body + '\n';
}
export function boardParagraph({ workstream, track, profile, label } = {}) {
  const names = [].concat(profile || []);
  const ws = [].concat(workstream || []);
  const and = (xs) => (xs.length < 3 ? xs.join(' and ') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]);
  return [
    '- This project\'s work is on the AskerDo board' + (ws.length ? ', in workstream' + (ws.length > 1 ? 's ' : ' ') + and(ws) : '') + (label ? ', its imported records labelled `' + label + '`' : '') + '.',
    ...(track ? ['- Resume the line of work with `/askerdo resume ' + track + '`.'] : []),
    '- Rulings are decision records on the board, and working rules are rule lines' + (names.length ? ' on the ' + names.map((n) => '`' + n + '`').join(' and ') + ' profile' + (names.length > 1 ? 's' : '') : ' on the project\'s profile') + ', which every session and agent brief here carries.',
    '- Routines are procedure cards under `docs/procedures/`.',
  ].join('\n');
}
/* the ids an earlier AskerDo section names (boardParagraph's lines) */
export function sectionIds(text) {
  const lines = String(text || '').split('\n');
  const s = lines.findIndex((l) => /^##\s+AskerDo\s*$/.test(l));
  const body = [];
  if (s >= 0) for (let i = s + 1; i < lines.length && !/^#{1,2}\s/.test(lines[i]); i++) body.push(lines[i]);
  const line = (re) => body.find((l) => re.test(l)) || '';
  const resume = /\/askerdo resume (TR-\d+)/.exec(line(/\/askerdo resume /));
  return { workstream: line(/on the AskerDo board/).match(/WS-\d+/g) || [], track: resume ? resume[1] : null,
    profile: [...line(/rule lines on the `/).matchAll(/`([^`]+)`/g)].map((m) => m[1]) };
}
/* the ids the board paragraph names, from the manifest; what it names none of (a run in another work folder, as a
   doctor run on another PC) keeps the earlier section's */
function boardIds(manifest, plan, standIns = {}, earlier = '') {
  const live = manifest.imports.filter((i) => !i.undone).flatMap((i) => i.steps);
  const swap = (id) => standIns[id] || id;
  /* every workstream the plan wrote into, the one it made first; a fix's `was` names where a record left;
     a rehearsal names each real one's stand-in, whose scratch id the one it made may share */
  const named = (JSON.stringify(plan.steps.map((s) => [s.args, s.stdin])).match(/"WS-\d+"/g) || []).map((x) => swap(x.slice(1, -1)));
  const ws = [...new Set([(live.find((s) => s.kind === 'workstream') || {}).id, ...named].filter(Boolean))];
  const ended = new Set(live.filter((s) => s.op === 'track finish' || s.op === 'track park').map((s) => s.row));
  const track = (live.filter((s) => s.op === 'track new').find((s) => !ended.has(s.row)) || {}).id || null;
  const profiles = [...new Set(live.filter((s) => s.op === 'profile rule-add').map((s) => String(s.id).split('/')[0]))];
  const was = sectionIds(earlier);
  return { workstream: ws.length ? ws : was.workstream.map(swap), track: track || (was.track && swap(was.track)), profile: profiles.length ? profiles : was.profile.length ? was.profile : null, label: plan.label };
}

/* a file's syntax after its rewrite: null when it parses (or nothing checks its kind), else why */
let NO_PS = false;
const PS_CHECK = '$e = $null; [void][System.Management.Automation.Language.Parser]::ParseFile($env:ASKERDO_CHECK_FILE, [ref]$null, [ref]$e); if ($e.Count) { $e | ForEach-Object { $_.Message }; exit 1 }';
export function syntaxOf(abs) {
  if (/\.(m?js|cjs)$/i.test(abs)) {
    const r = spawnSync(process.execPath, ['--check', abs], { encoding: 'utf8', windowsHide: true });
    return r.status === 0 ? null : clip(r.stderr || r.stdout || 'node --check failed', 300);
  }
  if (!/\.psm?1$/i.test(abs) || NO_PS) return null;
  for (const exe of ['pwsh', 'powershell.exe']) {
    const r = spawnSync(exe, ['-NoProfile', '-NonInteractive', '-Command', PS_CHECK], { encoding: 'utf8', windowsHide: true, env: { ...process.env, ASKERDO_CHECK_FILE: abs } });
    if (r.error && r.error.code === 'ENOENT') continue;
    return r.status === 0 ? null : clip(r.stdout || r.stderr || 'the PowerShell parser refused it', 300);
  }
  NO_PS = true;
  return null;
}

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const IN_GIT = /^ \(in git at [0-9a-f]+\)/;
/* the index past the closing backticks of the code span holding `at`, else -1 */
function spanEnd(line, at) {
  for (let i = 0; i < line.length;) {
    if (line[i] !== '`') { i++; continue; }
    let k = i;
    while (line[k] === '`') k++;
    let j = k;
    let close = -1;
    while (j < line.length) {
      if (line[j] !== '`') { j++; continue; }
      let e = j;
      while (line[e] === '`') e++;
      if (e - j === k - i) { close = e; break; }
      j = e;
    }
    if (close < 0) { i = k; continue; }
    if (at >= k && at < close) return close;
    i = close;
  }
  return -1;
}
/* A rewrite of the cite at [at, at + len) to `to`, with a git note after it or null where none is due; null leaves
   the line as it is. A note never goes inside code, which it would change: after a markdown code span's closing
   backticks, and never on a fenced line or beside a glob's wildcard. Nor inside a markdown link, whose
   target it breaks: after the link's closing parenthesis. */
export function placeCite(line, at, len, to, { note = null, md = false, fenced = false } = {}) {
  const end = at + len;
  if (!note) return line.slice(0, at) + to + line.slice(end);
  if (line[at - 1] === '!' || isGlob(line.slice(at, end), line.slice(end)) || (md && fenced)) return null;
  const link = md ? linksIn(line).find((k) => at >= k.start && at < k.end) : null;
  const close = md ? Math.max(spanEnd(line, at), link ? link.end : -1) : -1;
  const after = close >= 0 ? close : end;
  const head = line.slice(0, at) + to + line.slice(end, after);
  return head + (IN_GIT.test(line.slice(after)) ? '' : note) + line.slice(after);
}
/* the files proc scan reads as procedure cards */
const CARD = /^docs\/procedures\/(?!_|README\.md$)[^/]+\.md$/;
/* a card's parsed spots by line index: its frontmatter, and in References each bullet's target span */
function cardSpots(lines, fenced) {
  const front = new Set();
  if (lines[0] === '---') for (let i = 0; i < lines.length; i++) { front.add(i); if (i && lines[i] === '---') break; }
  const targets = new Map();
  let refs = false;
  lines.forEach((l, i) => {
    if (front.has(i) || fenced.has(i)) return;
    if (/^## /.test(l)) { refs = l.slice(3).trim() === 'References'; return; }
    const m = refs ? /^- `([^`]+)`: /.exec(l) : null;
    if (m) targets.set(i, [3, 3 + m[1].length]);
  });
  return { front, targets };
}
/* a References bullet keeps its target then ": " first, so the note follows the bullet's words; a note there already
   (the last token before it no path) is this cite's */
function noteAtEnd(line, at, len, to, note) {
  const next = line.slice(0, at) + to + line.slice(at + len);
  const body = next.replace(/\s+$/, '');
  const was = /^(.*?) \(in git at [0-9a-f]+\)$/.exec(body);
  if (was && !/[`/]/.test(was[1].split(/\s+/).pop())) return next;
  return body + note + next.slice(body.length);
}
/* the parent of this plan's import's first handover commit, else HEAD (no batch has landed yet) */
function handoverBase(git, manifest, plan) {
  const imps = ((manifest && manifest.imports) || []).filter((i) => !i.undone);
  const imp = imps.find((i) => i.plan === plan.made) || imps[imps.length - 1];
  const first = ((imp && imp.repo) || []).find((e) => e.commit);
  const up = first ? git(['rev-parse', '--verify', '--quiet', first.commit + '^']) : null;
  return String((up && up.status === 0 ? up : git(['rev-parse', 'HEAD'])).stdout || '').trim();
}
/* the repoint, in the handover before any move or delete, its edits left for the handover's one commit.
   Only cites in files that stay of files or folders that go are rewritten: a converted source's entry or section to
   its record, a moved path to its new one, a deleted one to `<path> (in git at <sha>)`. `gone` names the folders
   that pass their gate ({ path, end, to }); `repo` is the tree as the handover found it; `edited` the files this
   handover's line edits changed. By default only the files a session reads (SESSION_READS and the plan's sessionReads);
   the whole tree at depth. */
function repoint(work, { log = console.log, manifest, gone, at: t, git, repo, edited = [] }) {
  const plan = loadPlan(work);
  const dir = plan.project.dir;
  const folders = gone.filter((g) => g.go);
  /* a note names the commit before the handover's first batch: it holds every going file and stays the parent of a
     squash of the conversion's commits, where a commit inside the handover would be orphaned */
  const sha = handoverBase(git, manifest, plan);
  const idmap = readJson(t.idmap, {}) || {};
  /* a pointer skill's folder and SKILL.md stay: only its other files go */
  const stays = (r) => folders.some((g) => (g.end === POINT && (folderKey(r) === g.path || folderKey(r) === g.path + '/SKILL.md')) || (g.stays || []).includes(folderKey(r)));
  for (const g of folders) if (g.end !== POINT) idmap[g.path + '/'] = g.end === 'move' ? { kind: 'docs', path: g.to + '/', folder: true } : { kind: 'history', sha, folder: true };
  writeJson(t.idmap, idmap);
  const goneOf = (f) => (stays(f) ? undefined : folders.find((g) => under(f, g.path)));
  const tracked = [...repo.tracked];
  const retired = tracked.filter(goneOf);
  /* file-level ends, in memory: the id map keeps the folder's */
  const ends = new Map(retired.map((f) => { const g = goneOf(f); return [f, g.end === 'move' ? { kind: 'docs', path: g.to + f.slice(g.path.length) } : { kind: 'history', sha }]; }));
  const bases = new Map();
  for (const f of tracked) { const b = f.split('/').pop(); bases.set(b, (bases.get(b) || 0) + 1); }
  /* a converted source's headings and entries resolve its sections and entries to records */
  const srcOf = new Map();
  for (const x of plan.items || []) if (x.source && x.source.file && ends.has(x.source.file)) { if (!srcOf.has(x.source.file)) srcOf.set(x.source.file, []); srcOf.get(x.source.file).push(x); }
  const pieces = retired.map((f) => {
    const own = srcOf.get(f);
    const text = own ? readText(join(dir, f)) || '' : '';
    return { file: f, bare: bases.get(f.split('/').pop()) === 1, ...(own ? { heads: text.split('\n').flatMap((l, i) => (/^#{1,6}\s+\S/.test(l) ? [{ name: l.replace(/^#+\s+/, ''), line: i + 1 }] : [])),
      entries: own.map((x) => x.fields && x.fields.entry).filter(Boolean) } : {}) };
  });
  const stemOf = (f) => f.split('/').pop().replace(/\.[^.]+$/, '');
  const note = ' (in git at ' + sha.slice(0, 10) + ')';
  /* a note names a commit that holds the path, a file or a folder of files */
  let heldSet = null;
  const inGit = (p) => {
    if (!heldSet) {
      heldSet = new Set();
      for (const x of String(git(['ls-tree', '-r', '--name-only', '-z', sha]).stdout || '').split('\0').filter(Boolean)) {
        heldSet.add(x);
        for (let k = x.lastIndexOf('/'); k > 0; k = x.lastIndexOf('/', k - 1)) heldSet.add(x.slice(0, k));
      }
    }
    return heldSet.has(folderKey(p));
  };
  /* the words a hit becomes: { to, len, note? } to rewrite, { done } when an earlier run did, { ids } or null to list */
  const via = new Map((plan.repointed || []).map((x) => [x.loader, new Set(x.files)]));
  /* a going skill (its SKILL.md, or its folder) that became one card, which a cite of it whole names */
  const skillCard = new Map();
  for (const c of plan.cards || []) {
    const s = ((plan.items || []).find((x) => x.id === c.item) || {}).source || {};
    if (!s.file || !/(?:^|\/)SKILL\.md$/.test(s.file) || !ends.has(s.file) || !existsSync(join(dir, c.target))) continue;
    skillCard.set(s.file, skillCard.has(s.file) ? null : c.target);
  }
  const cardOf = (of) => skillCard.get(of) || skillCard.get(folderKey(of) + '/SKILL.md') || null;
  const resolveHit = (h, rest, f, line, lead) => {
    if (h.form === 'possessive' || h.form === 'article') return null;
    const v = h.anchor ? idmap[h.of + '#' + h.anchor] : null;
    const ids = v ? (v.id ? [v.id] : v.ids || []) : [];
    if (h.form === 'entry') {
      if (ids.length !== 1) return null;
      return rest.startsWith(' (' + ids[0] + ')') ? { done: true } : { to: h.anchor + ' (' + ids[0] + ')', len: h.match.length };
    }
    if (h.form === 'section' && v) {
      const paths = v.path ? [v.path] : v.paths || [];
      if (v.kind === 'procedure' && paths.length === 1) return { to: paths[0], len: h.match.length };
      if (ids.length === 1) return { to: (v.kind === 'track' ? 'track ' : '') + ids[0], len: h.match.length };
      return ids.length > 1 || paths.length > 1 ? { ids: [...ids, ...paths] } : null;
    }
    /* a repointed loader's cite of a whole file, in running text, names the one record or card it became */
    const w = idmap[h.of];
    if (w && w.kind === 'file' && via.has(f) && via.get(f).has(h.of) && inText(line, h.at, h.match.length, h.tool, lead)) {
      const all = [...(w.ids || []), ...(w.paths || [])];
      return all.length === 1 ? { to: all[0], len: h.match.length } : { ids: all };
    }
    /* a file-level cite: the track it became, the new path, or git; a section's name stays after it */
    const m = idmap[h.of] && idmap[h.of].kind === 'track' && idmap[h.of].id ? idmap[h.of] : ends.get(h.of);
    if (rest.startsWith(' (in git at ')) return { done: true };
    /* a path git keeps stays as written (its slashes too), the note after it */
    const to = !m ? null : m.kind === 'track' ? 'track ' + m.id : m.kind === 'docs' ? m.path : h.form === 'path' ? h.match.replace(/^\.\//, '') : h.of;
    return to ? { to, len: h.form === 'section' ? stemOf(h.of).length : h.match.length, ...(m.kind === 'history' ? { note } : {}) } : null;
  };
  /* a cite of a folder that goes, or of a path inside it no file holds, by its path */
  /* the real project's root, which a cite on a rehearsal copy writes too */
  const projectRoot = plan.project.dir;
  const folderRes = folders.map((g) => ({ g, re: folderRe(g.path, projectRoot) }));
  const reads = new Set(plan.sessionReads || []);
  const list = tracked.filter((f) => !goneOf(f) && (plan.depth || SESSION_READS.test(f) || reads.has(f)));
  const rewritten = [];
  const unresolved = [];
  const failed = [];
  let psSkipped = false;
  /* a cite no note may go beside (a fence, a glob, a `!`) stays as it was: named, never blocking, since the code still reads it */
  const asCode = new Set();
  /* a .gitignore negation of a unit that goes leaves in that unit's commit, so it is not listed */
  const keptAsCode = (f, line, of, text) => {
    if (asCode.has(f + '\n' + line) || folders.some((g) => GONE.includes(g.end) && negates(f, text, g.path))) return;
    asCode.add(f + '\n' + line);
    unresolved.push({ of, file: f, line, form: 'code', text: clip(text, 200), code: true });
  };
  /* a git note goes only where the cite sits in running text; elsewhere the session's word in `cites` (note,
     leave, point) decides, and with none the value stays as it is, listed. In running text the session's
     point wins, then the card a going skill became, then git */
  /* the session's words name lines as the plan read them, before the line edits took any out */
  const judgedAt = citeJudge(plan.cites);
  const lined = new Set([...linedFiles(manifest, plan), ...edited]);
  const was = lineWas(plan, lined);
  const judged = (f, n, of) => judgedAt(f, was(f, n), of);
  /* a cite a waiting line edit takes out is left for it, so its line still holds what the plan checked */
  const waitTakes = lineEditTakes((plan.lineEdits || []).filter((e) => !lined.has(e.file)));
  const asValue = new Set();
  const bareWord = (f, n, of, line, at, len, isFenced, tool, lead = '', link = false) => {
    if (line[at - 1] === '!' || isGlob(line.slice(at, at + len), line.slice(at + len)) || isFenced) return { do: 'note' };
    const j = judged(f, n, of);
    /* a link's target keeps its value, since its note goes after the link: the session's word, else as text */
    if (link) return j || (cardOf(of) ? { do: 'point', to: cardOf(of) } : { do: 'note' });
    if (inText(line, at, len, tool, lead)) return j && j.do === 'point' ? j : cardOf(of) ? { do: 'point', to: cardOf(of) } : { do: 'note' };
    if (!j && !asValue.has(f + '\n' + n + '\n' + of)) { asValue.add(f + '\n' + n + '\n' + of); unresolved.push({ of, file: f, line: n, form: 'value', text: clip(line.trim(), 200), value: true }); }
    return j || { do: 'leave' };
  };
  /* a path git never held at `sha` gets no note naming it: listed, left as it is */
  const missing = new Set();
  const notInGit = (f, n, of, text) => {
    if (missing.has(f + '\n' + n + '\n' + of)) return;
    missing.add(f + '\n' + n + '\n' + of);
    unresolved.push({ of, file: f, line: n, form: 'missing', text: clip(text, 200), missing: true });
  };
  const goingAt = (r) => (r && !stays(r) ? folders.find((g) => under(r, g.path)) : null);
  const citesIn = citer(pieces, { root: projectRoot });
  /* a settings file the unhook rewrites is no prose: its entries leave whole with their unit */
  const unhooked = new Set(folders.flatMap((g) => (g.unhook || []).map((u) => u.file)));
  for (const f of list) {
    if (goneOf(f) || unhooked.has(f)) continue;
    const abs = join(dir, f);
    let raw;
    try { if (statSync(abs).size > 2 << 20) continue; raw = readFileSync(abs, 'utf8'); } catch { continue; }
    if (raw.includes('\0')) continue;
    const hits = citesIn(raw, f);
    const near = folderRes.filter((x) => raw.includes(x.g.path));
    const md = MD.test(f);
    /* a path climbing out of the file's folder, and in markdown a link's target, read from that folder */
    const rel = folders.length > 0 && (raw.includes('../') || (md && raw.includes('](')));
    if (!hits.length && !near.length && !rel) continue;
    const lines = raw.split('\n');
    const fenced = md ? fencedLines(lines) : new Set();
    /* a wrapped sentence's start, read from the text as it was */
    const was = raw.split('\n');
    const lead = (i) => (md ? wrapLead(was, i) : '');
    const touched = new Set();
    /* a link's target is left to the pass that reads it from the file's folder */
    const inTarget = (line, at) => md && linksIn(line).some((k) => at >= k.at && at < k.tEnd);
    /* the going path a link's target names: from its folder first; one that misses there may name a root path, as the
       prose here does */
    const linkGoes = (k) => {
      /* a target written from the project root keeps its root as written */
      const abs = k.len ? fromRoot(k.path, projectRoot) : null;
      if (abs) return goingAt(abs.path) ? { r: abs.path, own: null, lead: abs.lead } : null;
      if (!k.len || /^(?:[a-z][\w+.-]*:|\/\/)/i.test(k.path)) return null;
      const own = k.path.startsWith('/') ? k.path.slice(1) : resolveFrom(f, k.path);
      const root = /^(?:\/|\.\.\/)/.test(k.path) ? null : k.path.replace(/^\.\//, '');
      const r = goingAt(own) ? own : goingAt(root) ? root : null;
      return r ? { r, own } : null;
    };
    /* a name labelling a link to the same going file stays its label, since the link pass moves or notes the target */
    const labels = (line, at, of) => md && linksIn(line).some((k) => at >= k.start && at < k.at && (linkGoes(k) || {}).r === of);
    const card = CARD.test(f) ? cardSpots(lines, fenced) : null;
    /* the rewrite placed: kept as code where no note may go, listed where git never held what the note would name */
    const place = (line, n, at, len, to, of, noted) => {
      /* a card's frontmatter takes no note, which would change a trigger or the summary its parser checks */
      if (noted && card && card.front.has(n - 1)) {
        if (!asValue.has(f + '\n' + n + '\n' + of)) { asValue.add(f + '\n' + n + '\n' + of); unresolved.push({ of, file: f, line: n, form: 'value', text: clip(line.trim(), 200), value: true, card: true }); }
        return line;
      }
      const span = card && card.targets.get(n - 1);
      const next = noted && span && at >= span[0] && at + len <= span[1] ? noteAtEnd(line, at, len, to, note)
        : placeCite(line, at, len, to, { note: noted ? note : null, md, fenced: fenced.has(n - 1) });
      if (next === null) { keptAsCode(f, n, of, line); return line; }
      if (noted && !inGit(of)) { notInGit(f, n, of, line); return line; }
      return next;
    };
    /* a bare name several going files share is one cite: the session's `of`, else the nearest file, else listed */
    const spot = new Map();
    for (const h of hits) if (h.form === 'name' || (h.form === 'section' && !h.anchor)) { const k = h.line + ':' + h.at; spot.set(k, [...(spot.get(k) || []), h]); }
    const means = new Map();
    for (const [k, hs] of spot) {
      const cands = [...new Set(hs.map((h) => h.of))];
      if (cands.length < 2) continue;
      const said = cands.filter((of) => (judged(f, hs[0].line, of) || {}).of === of);
      const pick = said.length === 1 ? said[0] : nearestOf(f, cands);
      /* the session's leave keeps the words, listed nowhere */
      if (said.length === 1 && judged(f, hs[0].line, pick).do === 'leave') { means.set(k, ''); continue; }
      means.set(k, pick);
      if (!pick) unresolved.push({ of: cands[0], file: f, line: hs[0].line, form: 'ambiguous', text: clip(hs[0].text, 200), among: cands, ...(hs.some((h) => h.tool) ? { tool: true } : {}) });
    }
    /* a span already rewritten on this line is never rewritten again */
    const wrote = new Map();
    for (const h of hits.slice().sort((a, b) => b.line - a.line || b.at - a.at)) {
      const line = lines[h.line - 1];
      const k = h.line + ':' + h.at;
      if (means.has(k) && means.get(k) !== h.of) continue;
      if ((wrote.get(h.line) || []).some(([a, b]) => h.at < b && h.at + h.match.length > a)) continue;
      if (inTarget(line, h.at) || waitTakes(f, h.line, h.at, h.match.length, line)) continue;
      const r = resolveHit(h, line.slice(h.at + h.match.length), f, line, lead(h.line - 1));
      if (r && r.done) continue;
      if (r && h.form === 'name' && (r.note || r.to === (ends.get(h.of) || {}).path) && labels(line, h.at, h.of)) continue;
      if (!r || r.ids) { unresolved.push({ of: h.of, file: f, line: h.line, form: h.form, text: clip(h.text, 200), tool: h.tool, ...(r && r.ids ? { ids: r.ids } : {}) }); continue; }
      const j = r.note ? bareWord(f, h.line, h.of, line, h.at, r.len, fenced.has(h.line - 1), h.tool, lead(h.line - 1)) : null;
      if (j && j.do === 'leave') continue;
      if (j && j.do === 'point') Object.assign(r, { to: j.to, note: null });
      const next = place(line, h.line, h.at, r.len, r.to, h.of, Boolean(r.note));
      if (next === line) continue;
      lines[h.line - 1] = next;
      touched.add(h.line);
      wrote.set(h.line, [...(wrote.get(h.line) || []), [h.at, h.at + h.match.length]]);
    }
    for (const { g, re } of near) {
      lines.forEach((line, i) => {
        if (!line.includes(g.path)) return;
        let next = line;
        /* right to left, so a rewrite never moves a match still to come */
        for (const m of [...line.matchAll(re)].reverse()) {
          if (inTarget(next, m.index)) continue;
          const p = m[0].replace(/^\.\//, '').replace(/[.]+$/, '');
          const len = m[0].indexOf(p) + p.length;
          if (stays(p) || waitTakes(f, i + 1, m.index, len, next)) continue;
          let to = g.end === 'move' ? g.to + p.slice(g.path.length) : p;
          const j = g.end === 'move' || next.slice(m.index + len).startsWith(' (in git at ') ? null : bareWord(f, i + 1, p, next, m.index, len, fenced.has(i), printed(next, m.index, f), lead(i));
          if (j && j.do === 'leave') continue;
          if (j && j.do === 'point') to = j.to;
          next = place(next, i + 1, m.index, len, to, p, !(g.end === 'move' || (j && j.do === 'point')));
        }
        if (next !== line) { lines[i] = next; touched.add(i + 1); }
      });
    }
    if (rel) {
      lines.forEach((line, i) => {
        if (!line.includes('../') && !(md && line.includes(']('))) return;
        const links = md ? linksIn(line) : [];
        const cands = [];
        for (const k of links) {
          const { r, own, lead } = linkGoes(k) || {};
          const dot = (s) => (k.path.startsWith('./') && !/^\.\.?\//.test(s) ? './' + s : s);
          if (r) cands.push({ at: k.at, len: k.len, r, link: true, write: (to) => (lead ? lead + to : k.path.startsWith('/') ? '/' + to : dot(r === own ? relFrom(f, to) : to)) });
        }
        for (const m of line.matchAll(UP_PATH)) {
          if (links.some((k) => m.index >= k.at && m.index < k.tEnd)) continue;
          const r = resolveFrom(f, m[0]);
          if (goingAt(r)) cands.push({ at: m.index, len: m[0].length, r, link: false, write: (to) => relFrom(f, to) });
        }
        let next = line;
        for (const c of cands.sort((a, b) => b.at - a.at)) {
          if (waitTakes(f, i + 1, c.at, c.len, next)) continue;
          const g = goingAt(c.r);
          let to = next.slice(c.at, c.at + c.len);
          let noted = false;
          if (g.end === 'move') to = c.write(g.to + folderKey(c.r).slice(g.path.length) + (c.r.endsWith('/') ? '/' : ''));
          else {
            const j = bareWord(f, i + 1, c.r, next, c.at, c.len, fenced.has(i), printed(next, c.at, f), lead(i), c.link);
            if (j.do === 'leave') continue;
            if (j.do === 'point') to = c.write(j.to); else noted = true;
          }
          next = place(next, i + 1, c.at, c.len, to, c.r, noted);
        }
        if (next !== line) { lines[i] = next; touched.add(i + 1); }
      });
    }
    if (!touched.size) continue;
    if (repo.changed.has(f)) { failed.push({ file: f, why: 'it has uncommitted changes, which a commit of its path would carry' }); continue; }
    /* a script its checker cannot parse as it stands (a workflow's top-level return) is judged by nothing */
    const parsed = !syntaxOf(abs);
    writeFileSync(abs, lines.join('\n'));
    const bad = parsed && syntaxOf(abs);
    if (/\.psm?1$/i.test(f) && NO_PS) psSkipped = true;
    if (bad) { writeFileSync(abs, raw); failed.push({ file: f, why: bad }); continue; }
    rewritten.push({ file: f, lines: touched.size });
  }
  unresolved.sort((a, b) => Number(Boolean(b.tool)) - Number(Boolean(a.tool)));
  const out = { sha, rewritten, unresolved, failed };
  writeJson(t.repoint, out);
  for (const x of rewritten) log('  ' + x.file + ': ' + x.lines + ' lines repointed');
  if (unresolved.length) log('Not resolved (' + unresolved.length + '), for the session to reword or leave with the user:\n  '
    + unresolved.map((u) => u.file + ' line ' + u.line + ' (' + (u.code ? 'kept as code: a fence, a glob or a negation' : u.card ? 'a card\'s frontmatter, which takes no note, left as it is: the proposal\'s `cites` says leave or point' : u.value ? 'a value outside running text, left as it is: the proposal\'s `cites` says note, leave or point'
      : u.missing ? 'git never held it at ' + sha.slice(0, 10) + ', so no note names that commit: left as it is'
      : u.among ? 'a bare name ' + u.among.length + ' going files share and no nearer folder settles, left as it is: the proposal\'s `cites` names which (of): ' + u.among.join(', ') : u.form)
      + (u.tool ? ', printed by a tool' : '') + '): ' + u.of + (u.ids ? ', it became ' + (u.ids.join(', ') || 'no record') : '')).join('\n  '));
  if (failed.length) log('Left as they were (' + failed.length + '):\n  ' + failed.map((x) => x.file + ': ' + x.why).join('\n  '));
  if (psSkipped) log('PowerShell files: not checked: no PowerShell');
  return out;
}

/* the map's run for the hashes the handover stamps after its commits, under the write's run id */
export const RESTAMPED = '@handover';
/* the map's rows; a failed read stamps none and says so */
async function mapNow(run, env, dir, log = () => {}, failed = null) {
  let r;
  try { r = await run(['conversion', '--project', dir], { env: unread(env) }); } catch (e) { r = { ok: false, why: oneLine(e && e.message) }; }
  if (!r.ok) { log('The conversion map was not read (' + clip(r.why, 200) + '): no row on it is restamped; run the step again'); if (failed) failed.push('map read'); }
  return (r.ok && r.out && r.out.rows) || [];
}
/* the map's file rows on these paths, whichever run put them */
const mappedFiles = (rows, paths, holds = () => false) => rows.filter((x) => x.kind === 'file' && (!x.fate || x.fate === 'keep') && (paths.has(x.source) || holds(x.source)));
/* the write's run row with each item or file judgment on a path the handover changed at its new hash, or null */
function restampedRun(rows, made, fresh, edited) {
  const was = rows.find((x) => x.kind === 'run' && x.source === RUN + made);
  const judged = (was && was.detail && was.detail.judged) || [];
  const now = new Map(judged.filter((j) => (j.kind === 'item' || j.kind === 'file') && j.hash && edited(j.subject) && fresh.get(j.key) && fresh.get(j.key) !== j.hash).map((j) => [j.key, fresh.get(j.key)]));
  if (!now.size) return null;
  return { source: was.source, kind: 'run', ...(was.sha ? { sha: was.sha } : {}), records: was.records || [], detail: { ...was.detail, judged: judged.map((j) => (now.has(j.key) ? { ...j, hash: now.get(j.key) } : j)) } };
}

/* the handover, on the go after the rehearsal, in one commit so one git revert takes it
   back: the cards, the kept files' line edits, the instruction files from their ledgers, the repoint, then each unit
   that passes its gate pointed, moved or deleted (its settings entries and un-ignore lines with it); last the card
   scan. Anything refused puts every edit back and stops. --file runs only the edits on that path or the folder
   holding it ("ask me per file"). */
export const LINES = 'lines';
/* a line edit stands when its file's line still holds what the plan checked */
const lineHolds = (e, lines) => {
  const t = lines[e.line - 1];
  if (t === undefined || (e.end && e.end > lines.length)) return false;
  if (e.kind === 'delete' || e.kind === 'empty') return e.head === '' ? !t.trim() : typeof e.head === 'string' ? t.startsWith(e.head) : true;
  return typeof e.words === 'string' && t.includes(e.words);
};
/* the files this plan's live import's line edits landed in, which the lines step, lineWas and the repoint read alike;
   another plan's import in the same manifest edited other text, as coverage's file reader keys it */
const linedFiles = (manifest, plan) => new Set(((manifest && manifest.imports) || []).filter((i) => i.plan === plan.made && !i.undone).flatMap((i) => i.repo || []).filter((e) => e.op === LINES).map((e) => e.path));
/* a file's line now, back to its line as the plan read it, across the deletes the line edits in `edited` made */
function lineWas(plan, edited) {
  const cuts = new Map();
  for (const e of (plan.lineEdits || []).filter((x) => x.kind === 'delete' && edited.has(x.file))) cuts.set(e.file, [...(cuts.get(e.file) || []), e].sort((a, b) => a.line - b.line));
  return (f, n) => { let old = n; for (const e of cuts.get(f) || []) { if (old < e.line) break; old += e.end - e.line + 1; } return old; };
}
export async function handover(work, { board = 'live', cli = DEFAULT_CLI, file = null, log = console.log } = {}) {
  const t = target(work, board);
  const plan = loadPlan(work);
  const dir = plan.project.dir;
  const git = gitCall(dir);
  if (git(['rev-parse', '--show-toplevel']).status !== 0) throw new Error(dir + ' is not a git repo: the handover deletes old folders only where git keeps their text, so it makes no edits here');
  const manifest = readJson(t.manifest, null);
  if (!manifest) throw new Error('no manifest at ' + t.manifest + ': the handover follows the write');
  const cov = readJson(t.coverage, null);
  if (!cov) throw new Error('no coverage file at ' + t.coverage + ': run apply.mjs ' + work + ' --coverage' + (board === 'live' ? '' : ' --board ' + board) + ' first');
  const last = manifest.imports.filter((i) => !i.undone).map((i) => i.done || i.at).sort().pop();
  if (last && cov.made < last) throw new Error('the coverage file is older than the last write (' + last + '): run --coverage again');
  const imp = manifest.imports.filter((i) => !i.undone).pop();
  if (!imp) throw new Error('every import in ' + t.manifest + ' was undone, so there is no write to hand over: run the write again first');
  imp.repo = imp.repo || [];
  const env = { ...process.env, ...(t.env || {}) };
  const done = (op, path) => imp.repo.some((e) => e.op === op && e.path === path);
  const mine = (p) => !file || folderKey(file) === folderKey(p) || under(file, p);
  /* the tree as the handover found it: its own edits are never the user's uncommitted changes */
  const repo = repoState(dir, git);
  const dirty = (p) => repo.changed.has(p) || repo.untracked.includes(p);
  const skipped = [];
  const held = [];
  const lined = [];
  /* every path the one commit names, and the manifest's entries for it, which take its sha once it lands */
  const touched = new Set();
  const entries = [];
  let stopped = null;
  /* staged as each step makes them, one add a step */
  const add = (es, paths) => {
    entries.push(...es);
    for (const p of paths) touched.add(p);
    const here = paths.filter((p) => existsSync(join(dir, p)));
    const r = here.length ? gitBatch(git, work, ['add'], here) : { status: 0 };
    if (r.status !== 0) stop(es[0].op, 'git add refused: ' + clip(gitWhy(r), 300));
  };
  let override = null;
  let stays = [];
  /* the instruction file the AskerDo section goes in; an older plan names none, so CLAUDE.md */
  const section = 'section' in plan ? plan.section : 'CLAUDE.md';
  /* a path HEAD holds (a file, or a folder of tracked files) comes back; one the handover made goes */
  const putBack = () => {
    const paths = [...touched];
    if (!paths.length) return null;
    const a = gitBatch(git, work, ['reset', '-q'], paths);
    const kept = paths.filter((p) => repo.tracked.has(p) || [...repo.tracked].some((x) => under(x, p)));
    for (const p of paths.filter((x) => !kept.includes(x))) rmSync(join(dir, p), { recursive: true, force: true });
    const c = kept.length ? gitBatch(git, work, ['checkout', '-q'], kept) : { status: 0 };
    return [a, c].filter((x) => x.status !== 0).map(gitWhy).join('; ') || null;
  };
  const stop = (step, why) => { stopped = { batch: step, files: touched.size, why }; };
  const since = String(git(['rev-parse', 'HEAD']).stdout || '').trim();
  let gates = gatesOf(plan, cov, repo, { goes: mine });

  /* the cards */
  const cards = [];
  for (const c of (plan.cards || []).filter((x) => mine(x.target) && !done('write', x.target))) {
    const item = (plan.items || []).find((x) => x.id === c.item);
    if (!item) { skipped.push({ path: c.target, why: 'its item ' + c.item + ' is not in the plan' }); continue; }
    if (existsSync(join(dir, c.target)) && dirty(c.target)) { skipped.push({ path: c.target, why: 'it has uncommitted changes' }); continue; }
    const was = readText(join(dir, c.target));
    const w = writeCard(dir, cardRow(item, c.target));
    /* a card already in the repo as written needs no commit */
    if (was !== null && was === readText(join(dir, w.path))) continue;
    cards.push({ op: 'write', path: w.path, row: c.item });
  }
  if (cards.length) add(cards, cards.map((e) => e.path));
  /* the kept files' line edits, before the repoint, so each meets the words the plan checked and a cite it takes out is
     never repointed; a file's edits land together or wait together */
  const byFile = new Map();
  const waits = new Map();
  const landed = linedFiles(manifest, plan);
  for (const e of (plan.lineEdits || []).filter((x) => mine(x.file) && !landed.has(x.file))) {
    const why = lineEditHeld(e, cov, plan.items || []);
    if (why) waits.set(e.file, [...(waits.get(e.file) || []), 'line ' + e.line + ': ' + why]);
    byFile.set(e.file, [...(byFile.get(e.file) || []), e]);
  }
  for (const [f, w] of waits) { byFile.delete(f); skipped.push({ path: f, why: 'its line edits wait on coverage (' + w.join('; ') + ')' }); }
  const edits = [];
  for (const [f, es] of byFile) {
    if (dirty(f)) { skipped.push({ path: f, why: 'it has uncommitted changes, which a commit of its path would carry' }); continue; }
    const raw = readText(join(dir, f));
    const lines = raw === null ? [] : raw.split('\n');
    const bad = es.find((e) => !lineHolds(e, lines));
    if (bad) { stop(LINES, f + ' line ' + bad.line + ' no longer holds what the plan checked (' + bad.kind + '); run the plan again'); break; }
    edits.push({ f, text: editLines(lines, es).join('\n'), es });
  }
  if (!stopped && edits.length) {
    for (const x of edits) {
      writeFileSync(join(dir, x.f), eolLike(join(dir, x.f), x.text));
      lined.push(...x.es.map((e) => ({ file: e.file, line: e.line, kind: e.kind, why: e.why })));
    }
    add(edits.map((x) => ({ op: LINES, path: x.f })), edits.map((x) => x.f));
  }
  /* each instruction file from its ledger, with the AskerDo section in the file the plan names */
  const ledgers = (plan.claude || []).map((x) => keptBack(x, gates));
  const rewrites = [];
  if (!stopped) {
    stays = ledgers.filter((x) => mine(x.ledger.path)).flatMap((x) => x.back);
    if (stays.length) log('Clauses that stay while what they load is held (' + stays.length + '):\n  ' + stays.map((s) => s.path + ': ' + s.why).join('\n  '));
    for (const l of ledgers.map((x) => x.ledger).filter((x) => mine(x.path) && !done('rewrite', x.path))) {
      if (!l.clauses.some((c) => c.fate === 'carried' || c.fate === 'dropped' || c.fate === 'split') && l.path !== section) continue;
      const c = (cov.claude || []).find((x) => x.path === l.path);
      if (c && c.blocked) { skipped.push({ path: l.path, why: c.gaps.length + ' clauses with no fate or backing (apply.mjs --coverage lists them)' }); continue; }
      if (repo.changed.has(l.path)) { skipped.push({ path: l.path, why: 'it has uncommitted changes, which a commit of its path would carry' }); continue; }
      /* never a new instruction file (a CLAUDE.md would hide an AGENTS.md Claude reads), and only one git keeps */
      const was = readText(join(dir, l.path));
      if (was === null) { skipped.push({ path: l.path, why: 'it is not in the repo, and the handover makes no instruction file' }); continue; }
      /* a private file (CLAUDE.local.md, or one git ignores) is never committed: its skip is expected, not a failure */
      const priv = /(^|\/)CLAUDE\.local\.md$/i.test(l.path) || !repo.untracked.includes(l.path);
      if (!repo.tracked.has(l.path)) { skipped.push({ path: l.path, why: 'git does not track it, so its words would have no copy: edit it by hand on the user\'s word', ...(priv ? { expected: true } : {}) }); continue; }
      let text;
      try { text = eolLike(join(dir, l.path), claudeText(was, l, l.path === section ? boardIds(manifest, plan, undefined, was) : null)); } catch (e) { skipped.push({ path: l.path, why: e.message }); continue; }
      const left = l.path === section ? stateProblems(text.slice(text.lastIndexOf('## AskerDo')), { state: 10240, line: 400 }) : [];
      if (left.length) { skipped.push({ path: l.path, why: 'the board paragraph does not fit: ' + left.join('; ') }); continue; }
      /* a rewrite that changes nothing (a doctor run that moves no clause) has nothing to commit */
      if (text === readFileSync(join(dir, l.path), 'utf8')) continue;
      writeFileSync(join(dir, l.path), text);
      rewrites.push({ op: 'rewrite', path: l.path, row: 'claude' });
    }
    if (rewrites.length) add(rewrites, rewrites.map((e) => e.path));
  }
  /* the repoint, after the rewrite and before any move or delete; a tool's cite it leaves holds its folder */
  if (!stopped && gates.some((g) => g.go)) {
    const rep = repoint(work, { log, manifest, gone: gates, at: t, git, repo, edited: edits.map((x) => x.f) });
    if (rep.rewritten.length) add(rep.rewritten.map((x) => ({ op: 'repoint', path: x.file })), rep.rewritten.map((x) => x.file));
    for (const x of rep.failed) skipped.push({ path: x.file, why: 'repoint: ' + x.why });
    repointGaps(cov, rep);
    gates = gatesOf(plan, cov, repo, { goes: mine });
  }
  /* each unit that passes its gate: a loader retires before the folders it reads */
  const units = gates.filter((x) => (x.end === 'move' || GONE.includes(x.end) || x.end === POINT) && mine(x.path)).sort((a, b) => Number(b.end === 'retire') - Number(a.end === 'retire'));
  for (const g of stopped ? [] : units) {
    if (stopped) break;
    if (done(g.end === POINT ? POINT : g.end === 'move' ? 'move' : 'delete', g.path)) continue;
    if (!g.go) { (g.hold === 'kept' ? held : skipped).push({ path: g.path, why: g.why }); continue; }
    if (g.end === POINT) {
      /* after the cards, so the card it names is in the tree */
      const skill = g.path + '/SKILL.md';
      const text = existsSync(join(dir, g.to)) ? pointerSkill(readText(join(dir, skill)), g.to, g.description) : null;
      if (!text) { skipped.push({ path: g.path, why: existsSync(join(dir, g.to)) ? skill + ' has no frontmatter name' : 'its card ' + g.to + ' is not in the tree' }); continue; }
      const others = [...repo.tracked].filter((x) => under(x, g.path) && x !== skill);
      writeFileSync(join(dir, skill), eolLike(join(dir, skill), text));
      add([{ op: POINT, path: g.path, to: g.to, files: g.files }], [skill, ...others]);
      const r = stopped || !others.length ? { status: 0 } : gitBatch(git, work, ['rm', '-q'], others);
      if (r.status !== 0) stop(POINT, 'git rm refused: ' + clip(gitWhy(r), 300));
    } else if (g.end === 'move') {
      mkdirSync(dirname(join(dir, g.to)), { recursive: true });
      const r = git(['mv', '--', g.path, g.to]);
      if (r.status !== 0) { skipped.push({ path: g.path, why: 'git mv refused: ' + gitWhy(r) }); continue; }
      add([{ op: 'move', path: g.path, to: g.to, files: g.files }], [g.path, g.to]);
    } else {
      /* the settings entries that run it leave with it; so do the .gitignore lines that un-ignore only it */
      let set = [];
      let ign = { files: [], left: [] };
      try { set = unhook(dir, g); ign = unignore(dir, g, repo.tracked, (f) => repo.changed.has(f)); } catch (e) { stop('deletes', g.path + ': its settings entries could not be taken out: ' + oneLine(e.message)); for (const f of (g.unhook || []).map((u) => u.file)) touched.add(f); break; }
      for (const f of ign.left) skipped.push({ path: f, why: 'its lines un-ignoring ' + unit(g) + ' stay: it has uncommitted changes' });
      add([{ op: 'delete', path: g.path, files: g.files, ...(set.length ? { unhook: set } : {}) }], [...set, ...ign.files]);
      touched.add(g.path);
      const r = stopped ? { status: 0 } : gitBatch(git, work, ['rm', '-r', '-q'], [g.path]);
      if (r.status !== 0) stop('deletes', 'git rm refused: ' + clip(gitWhy(r), 300));
    }
  }
  /* the one commit, its subject the counts and its body each change */
  let commit = null;
  if (!stopped && entries.length) {
    const paths = [...touched];
    const n = (op) => entries.filter((e) => e.op === op).length;
    const subject = plan.label + ': hand over to the board (' + [n('write') && counted(n('write'), 'card'), n(LINES) && counted(n(LINES), 'file') + ' line-edited', n('rewrite') && counted(n('rewrite'), 'instruction file') + ' rewritten',
      n('repoint') && counted(n('repoint'), 'file') + ' repointed', n(POINT) && counted(n(POINT), 'pointer skill'), n('move') && counted(n('move'), 'move'), n('delete') && counted(n('delete'), 'unit') + ' gone'].filter(Boolean).join(', ') + ')';
    const body = entries.map((e) => '- ' + (e.op === 'delete' ? unit({ path: e.path, file: repo.tracked.has(e.path) }) + ' goes, git keeps it (' + counted(e.files, 'file') + ')' + (e.unhook ? ', its entries out of ' + e.unhook.join(', ') : '')
      : e.op === 'move' ? e.path + ' moves to ' + e.to : e.op === POINT ? e.path + ' points at its card ' + e.to : e.op === 'write' ? 'card ' + e.path : e.op === 'rewrite' ? e.path + ' from its ledger' : e.path + ' (' + e.op + ')')).join('\n');
    const r = gitBatch(git, work, ['commit', '-q', '-m', subject, '-m', body], paths);
    if (r.status !== 0) stop('commit', 'git commit refused: ' + clip(gitWhy(r), 300));
    else {
      commit = String(git(['rev-parse', 'HEAD']).stdout).trim();
      const at = new Date().toISOString();
      for (const e of entries) imp.repo.push({ kind: 'repo', ...e, batch: 'handover', commit, at });
      writeJson(t.manifest, manifest);
      log(commit.slice(0, 8) + ' ' + subject);
    }
  }
  if (stopped) { const left = putBack(); if (left) stopped.why += '; putting it back failed too: ' + left; }
  /* Codex reads the converted AGENTS.md and the rules the write made at once, not at the next session start */
  if (commit && mine('AGENTS.md')) {
    try { override = await refreshAgentsOverride(dir, { env }); } catch (e) { override = { did: 'failed', why: oneLine(e && e.message) }; }
    if (override.did === 'wrote') log((override.created ? 'created ' : 'rewrote ') + override.path + ' for Codex: AGENTS.md\'s text, the rules for agents, the procedure cards and the decisions on its files and commands' + (override.left ? ', with ' + override.leftBy + ' in ' + override.rest + ' for its size limit' : ''));
    else if (override.did === 'left' || override.did === 'failed') skipped.push({ path: 'AGENTS.override.md', why: override.did === 'left' ? 'AskerDo did not write it, so it stays as it is' : 'the rules read failed: ' + override.why });
  }
  /* the cards are scanned as the handover left them; the conversion vouches for those it wrote and for each that
     read current before its commit, so its own commit never reads as a change */
  if (commit && existsSync(join(dir, 'docs', 'procedures'))) {
    let r;
    try { r = await cliRunner(cli)(['proc', 'scan', '--project', dir, '--vouch', commit, '--since', since], { env }); } catch (e) { r = { ok: false, why: oneLine(e && e.message) }; }
    imp.steps.push({ step: 'proc-scan@handover', op: 'proc scan', kind: KIND['proc scan'], id: r.ok ? 'ok' : null,
      ...(r.ok ? { undo: ['proc', 'scan', '--project', dir, '--unvouch', commit] } : { why: clip(r.why, 200) }) });
    writeJson(t.manifest, manifest);
    log(r.ok ? 'proc scan --project ' + dir + ': the cards are on the board, verified at ' + commit.slice(0, 8) : 'proc scan refused: ' + clip(r.why, 200));
  }
  if (commit) await mapHandover(cliRunner(cli), env, dir, work, { plan, imp, cov, repo, held, git, manifest, log });
  if (!stopped) keepOnPc(env, dir, [...(plan.folders || []).filter((f) => f.end === 'keep'), ...held], imp.repo.filter((e) => e.op === 'move' || e.op === 'delete').map((e) => e.path), log);
  if (skipped.length) log('Skipped (' + skipped.length + '), each left as it is:\n  ' + skipped.map((s) => s.path + ': ' + s.why).join('\n  '));
  if (held.length) log('Folders that stay (' + held.length + '); tell the user:\n  ' + held.map((s) => s.path + ': ' + s.why).join('\n  '));
  if (stopped) log('Stopped at the ' + stopped.batch + ' step: ' + stopped.why + '. Every edit is put back as it was; nothing is committed. Fix the cause and run --handover again.');
  else if (!commit && !skipped.length && !held.length) log('Nothing left to hand over' + (file ? ' on ' + file : '') + '.');
  if (commit || stopped) {
    const report = join(work, 'report.md');
    writeFileSync(report, runReport(work, { plan, manifest, commit: commit || (imp.repo.find((e) => e.commit) || {}).commit || null, skipped, held, stopped }));
    log('The run report: ' + report + (commit ? '. The undo: git revert ' + commit + ', with apply.mjs ' + work + ' --undo for the board' : ''));
  }
  return { commit, skipped, held, lined, ...(stays.length ? { stays } : {}), ...(override ? { override } : {}), ...(stopped ? { stopped } : {}) };
}
/* each file the handover rewrote at its new blob and each card's source with its card, so the next run reads
   none of the conversion's own edits as a change; then each folder's end, anchored at the commit before the handover */
async function mapHandover(run, env, dir, work, { plan, imp, cov, repo, held, git, manifest, log }) {
  const cards = (plan.cards || []).filter((c) => existsSync(join(dir, c.target)))
    .map((c) => ({ source: ((((plan.items || []).find((x) => x.id === c.item) || {}).source) || {}).file, record: c.target, item: c.item })).filter((c) => c.source);
  const own = new Set([...imp.repo.filter((e) => e.op === 'rewrite' || e.op === 'repoint' || e.op === LINES).map((e) => e.path), ...imp.repo.filter((e) => e.op === POINT).map((e) => e.path + '/SKILL.md'), ...cards.map((c) => c.source)]);
  /* a file row naming a whole folder reads its tree, which any handover edit inside it changes */
  const handed = [...new Set(imp.repo.flatMap((e) => [e.path, e.to]).filter(Boolean).map(folderKey))];
  const holds = (src) => handed.some((p) => p.startsWith(folderKey(src) + '/'));
  const edited = (p) => own.has(p) || holds(p);
  const onMap = own.size || handed.length ? await mapNow(run, env, dir, log) : [];
  const restamp = mappedFiles(onMap, own, holds);
  const st = mapState(dir, work, git);
  const rows = mapRows(plan, imp, { ...st, cards, restamp, cov });
  const fresh = new Map(((rows.run[0].detail || {}).judged || []).filter((j) => j.hash).map((j) => [j.key, j.hash]));
  const rerun = restampedRun(onMap, plan.made, fresh, edited);
  const base = handoverBase(git, manifest, plan);
  /* an answered call's file subjects the handover edited take their new hashes, so the call is not asked again */
  const hashNow = (p) => (st.dirty(p) || !st.tree.has(p) ? st.blobs([p]).get(p) || NONE : st.tree.get(p));
  /* a folder subject's sig counts its uncommitted files, so it takes its new tree only while it has none */
  const sigNow = (p, h) => { const k = folderKey(p); return [...(st.loose || [])].some((f) => f.startsWith(k + '/')) ? h : folderSig(st.tree.get(k)) || h; };
  const recalls = onMap.filter((x) => x.kind === 'call' && Object.keys((x.detail && x.detail.subjects) || {}).some(edited))
    .map((x) => ({ source: x.source, kind: 'call', answer: x.answer, sha: base, records: x.records || [],
      detail: { ...x.detail, subjects: Object.fromEntries(Object.entries(x.detail.subjects).map(([p, h]) => [p, !edited(p) ? h : isFolder(p) ? sigNow(p, h) : hashNow(p)])) } }));
  /* a single file's end keeps its source row's records, hash and lines, since it takes that row's place */
  const fileRow = (p) => { const r = rows.file.find((x) => x.source === folderKey(p)); return r ? { records: r.records, ...(r.hash ? { hash: r.hash } : {}), ...(r.detail ? { detail: r.detail } : {}) } : {}; };
  const asFile = (p) => repo.tracked.has(folderKey(p));
  const ends = imp.repo.filter((e) => e.op === 'move' || e.op === 'delete').map((e) => ({ source: asFile(e.path) ? folderKey(e.path) : e.path.replace(/\/*$/, '/'), kind: asFile(e.path) ? 'file' : 'folder', fate: e.op, sha: base,
    ...(asFile(e.path) ? fileRow(e.path) : {}),
    why: ((plan.folders || []).find((f) => folderKey(f.path) === folderKey(e.path)) || {}).why || null, ...(e.to ? { detail: { to: e.to } } : {}) }))
    .concat(held.map((h) => ({ source: asFile(h.path) ? folderKey(h.path) : h.path.replace(/\/*$/, '/'), kind: asFile(h.path) ? 'file' : 'folder', fate: 'keep', why: h.why, ...(asFile(h.path) ? fileRow(h.path) : {}) })))
    /* a pointer skill's folder stays, so each file its commit deleted under it gets a row of its own, which the doctor's cite check reads */
    .concat(imp.repo.filter((e) => e.op === POINT && e.commit).flatMap((e) => String(git(['diff-tree', '--no-commit-id', '--name-only', '--diff-filter=D', '-r', '-z', e.commit]).stdout || '').split('\0').filter((f) => f && under(f, e.path))
      .map((f) => ({ source: f, kind: 'file', fate: 'delete', sha: base, ...fileRow(f), why: 'the pointer skill ' + e.path + ' keeps its SKILL.md and names its card ' + e.to + '; its other files go' }))));
  const files = rows.file.filter((r) => (own.has(r.source) || (holds(r.source) && r.hash)) && !ends.some((e) => e.source === r.source)).map((r) => ({ ...r, sha: base }));
  /* the new hashes ride a run of their own, so the undo gives back each row as the write or an earlier run left it */
  if (files.length || rerun || recalls.length) await putMap(run, env, dir, plan.made + RESTAMPED, { file: files, call: recalls, run: rerun ? [rerun] : [] }, log);
  if (ends.length) await putMap(run, env, dir, plan.made, { folder: ends }, log);
}

/* what one fresh reader pass reads, on the user's ask after the handover: the project as a new session
   starts in it, the board, what a session there loads (the instruction files Claude reads, what is left under .claude/,
   what the settings run), the top folders, and each kept folder with its why and README. */
const README = /^(?:readme|index|_index)\.(?:md|markdown|txt)$/i;
const n = (k, w) => k + ' ' + w + (k === 1 ? '' : 's');
/* a board id a line names: a question (with its answer token), a record, a task, track or workstream */
const CITED_ID = /(?<![\w-])(Q\d+|[KT]-\d+|TR-\d+|WS-\d+)(?![\w-])/g;
/* what an id stands for in the plan's board snapshot, or null when the snapshot does not hold it */
function statementOf(id, snap) {
  const find = (k) => ((snap && snap[k]) || []).find((x) => x && x.id === id);
  const q = find('questions');
  if (q) return '"' + oneLine(q.title) + '"' + (q.answer ? ', answered "' + clip(q.answer, 200) + '"' : ', open');
  const d = find('decisions');
  if (d) return 'decision: "' + oneLine(d.title) + '"';
  const k = find('knowledge');
  return k ? 'knowledge (' + (k.type || 'fact') + '): "' + oneLine(k.name || k.title) + '"' : null;
}
export function readerView(dir, plan, { cli = DEFAULT_CLI, snapshot = null } = {}) {
  const r = gitIn(dir)(['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
  const files = String(r.stdout || '').split('\0').filter((f) => f && existsSync(join(dir, f)));
  const have = new Set(files);
  const dirs = new Set(['']);
  for (const f of files) for (let d = f, j = d.lastIndexOf('/'); j > 0; j = d.lastIndexOf('/')) { d = d.slice(0, j); dirs.add(d); }
  const setting = { mode: (plan.instructions && plan.instructions.mode) || DEFAULT_MODE };
  const instr = instructionFiles(dir, [...dirs], have, setting, { above: (plan.instructions && plan.instructions.above) || [] });
  const claude = files.filter((f) => f.startsWith('.claude/') && !/^\.claude\/(questions|worktrees)\//.test(f) && !instr.files.some((x) => x.file === f) && !/^\.claude\/settings(\.local)?\.json$/.test(f));
  const loads = {
    instructions: instr.files.map((x) => ({ file: x.file, read: x.read, ...(x.why ? { why: x.why } : {}) })),
    claude: claude.map((f) => { const p = /\.md$/i.test(f) && fileKind(f) === 'rules' ? pathsFront(readText(join(dir, f))) : null; return { file: f, kind: fileKind(f), ...(p && p.length ? { paths: p } : {}) }; }),
    runs: runsOf(dir, have).map((x) => ({ file: x.file, what: x.what, command: x.command })),
  };
  const counts = new Map();
  for (const f of files) { const k = f.includes('/') ? f.slice(0, f.indexOf('/') + 1) : f; counts.set(k, (counts.get(k) || 0) + 1); }
  const top = [...counts].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([path, k]) => ({ path, ...(path.endsWith('/') ? { files: k } : {}) }));
  /* a unit the plan ended that is still in the tree stayed: its gate held it */
  const kept = (plan.folders || []).filter((f) => f.end === 'keep' || (f.end !== POINT && files.some((x) => under(x, folderKey(f.path))))).map((f) => {
    const p = folderKey(f.path);
    const readme = files.find((x) => x.startsWith(p + '/') && !x.slice(p.length + 1).includes('/') && README.test(x.slice(p.length + 1)));
    return { path: f.path, end: f.end, why: f.end === 'keep' ? f.why || '' : 'it stays: its gate held it', ...(f.shape ? { shape: f.shape } : {}), files: files.filter((x) => under(x, p)).length, ...(readme ? { readme } : {}) };
  });
  const body = ['# What the fresh reader reads: ' + (plan.label || 'the conversion'), '',
    'The project as a new session starts in it after the handover. Read the project and search the board; nothing else (never the proposal or rehearsal.md).', '',
    '- Your brief: ' + join(dirname(fileURLToPath(import.meta.url)), 'fresh-reader.md').replace(/\\/g, '/'),
    '- The project: ' + dir, '- The board: `node ' + cli + ' <verb>`', '',
    '## What a session here loads', '',
    ...loads.instructions.map((x) => '- ' + x.file + ': ' + (x.read === 'start' ? 'read at the start' : x.read === 'nested' ? 'read when a session works in its folder' : 'not read (' + (x.why || 'no') + ')')),
    ...loads.claude.map((x) => '- ' + x.file + ' (' + x.kind + (x.paths ? ', on paths ' + x.paths.join(', ') : '') + ')'),
    ...loads.runs.map((x) => '- ' + x.file + ' runs `' + x.command + '` (' + x.what + ')'),
    ...(loads.instructions.length + loads.claude.length + loads.runs.length ? [] : ['Nothing.']), '',
    '## The top folders', '', ...top.map((x) => '- ' + x.path + (x.files ? ' (' + n(x.files, 'file') + ')' : '')), '',
    '## Kept folders, with why', '', ...kept.map((k) => '- ' + k.path + ': ' + k.why + (k.shape ? ' (' + k.shape + ')' : '') + '; ' + n(k.files, 'file') + (k.readme ? '; read ' + k.readme : '')),
    ...(kept.length ? [] : ['None.']), ''].join('\n');
  /* every id the lines above name, with what it stands for on the board */
  const ids = [...new Set([...body.matchAll(CITED_ID)].map((m) => m[1]))].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  const cited = ids.map((id) => ({ id, statement: statementOf(id, snapshot) })).filter((c) => c.statement);
  const text = body + (cited.length ? ['## The board records named above', '', ...cited.map((c) => '- ' + c.id + ': ' + c.statement), ''].join('\n') : '');
  return { text, loads, top, kept, cited };
}
/* the one reader pass's file, in the work folder */
export function readerFile(work, { cli = DEFAULT_CLI, log = console.log } = {}) {
  const plan = loadPlan(work);
  const view = readerView(plan.project.dir, plan, { cli, snapshot: (readFacts(work) || {}).board || plan.board || null });
  const file = join(work, 'reader.md');
  writeFileSync(file, view.text);
  log('What the fresh reader reads: ' + file);
  return { file, ...view };
}

/* The live write runs quiet: the local server's own notification pause (the tray menu's and the
   notifications page's), an hour as the fallback end, lifted after unless the user had paused. */
const serverBase = () => {
  try {
    const root = storeRoot();
    return 'http://127.0.0.1:' + readFileSync(join(root, 'board', 'port'), 'utf8').trim() + '/' + readFileSync(join(root, 'board', 'secret'), 'utf8').trim() + '/';
  } catch { return null; }
};
async function notifyCall(body) {
  try {
    const base = serverBase();
    if (!base) return null;
    const r = await fetch(base + 'api/notify', {
      method: body ? 'POST' : 'GET', ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(5000),
    });
    const out = await r.json();
    return r.ok ? out.settings || out : null;
  } catch { return null; }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/* the write blocks the loop for minutes, so fetch's pooled socket is one the server
   closed (its 5 s keep-alive) and the first call after it resets: yield first, retry once.
   Only the pause this write set is lifted; one the user changed meanwhile stays. */
export async function quietWrite(f, { log = console.log, call = notifyCall, retryMs = 1000, renewMs = 45 * 60000 } = {}) {
  const was = await call(null);
  const set = was && !was.pauseLabel ? await call({ pause: 'hour' }) : null;
  let ours = set && set.pausedUntil ? set.pausedUntil : null;
  log(ours ? 'Notifications paused for the write (an hour at a time, renewed while it runs; lifted when it ends or stops).'
    : was && was.pauseLabel ? 'Notifications were already paused; the write leaves that pause as it is.' : 'The local server did not answer: notifications are not paused for the write.');
  /* a write past the hour renews its own pause before it ends; once the user changes it, it is theirs */
  let timer = null;
  let renewing = Promise.resolve();
  const renew = async () => {
    const now = await call(null);
    if (!now || !timer) return;
    if (now.pausedUntil !== ours) { clearInterval(timer); timer = null; return; }
    const next = await call({ pause: 'hour' });
    if (next && next.pausedUntil) ours = next.pausedUntil;
  };
  if (ours) timer = setInterval(() => { renewing = renewing.then(renew, renew); }, renewMs);
  try { return await f(); } finally {
    if (timer) { clearInterval(timer); timer = null; }
    await renewing.catch(() => {});
    if (ours) {
      let said = null;
      for (let i = 0; i < 2 && !said; i++) {
        await sleep(i ? retryMs : 50);
        const now = await call(null);
        if (now && now.pausedUntil !== ours) said = 'Notifications: the pause was changed during the write, so it stays as it is now.';
        else if (now && await call({ pause: '' })) said = 'Notifications resumed.';
      }
      const base = serverBase();
      log(said || 'Notifications could not be resumed, so they stay paused until ' + ours + '. Lift it now with Resume now on the AskerDo tray menu'
        + (base ? ', or Resume on the notifications page: ' + base + 'notifications' : '') + '.');
    }
  }
}

const PAUSE_HELD = 'ASKERDO_ONBOARD_PAUSE_HELD';
/* the live write itself, in one child that inherits the terminal; its exit code is the write's */
const writeInChild = () => new Promise((done) => {
  const c = spawn(process.execPath, process.argv.slice(1), { stdio: 'inherit', windowsHide: true, env: { ...process.env, [PAUSE_HELD]: '1' } });
  c.on('error', (e) => { console.error('apply: ' + e.message); done(1); });
  c.on('exit', (code) => done(code === null ? 1 : code));
});

/* an import's decisions and knowledge records leave only by a withdraw the user allows, all in one request, so one press */
const counted = (n, one) => n + ' ' + one + (n === 1 ? '' : 's');
/* a ruling is what the board's measure calls one, a record of type decision, when the board was read; else the step's kind */
const byKind = (s) => s.kind === 'decision';
const recordsSaid = (steps, ruling = byKind) => {
  const r = steps.filter(ruling).length;
  return [r ? counted(r, 'decision') : '', steps.length - r ? counted(steps.length - r, 'knowledge record') : ''].filter(Boolean).join(' and ');
};
/* group: the answer a group drop came from, which leaves the import standing */
export function withdrawInput(steps, label, ruling = byKind, group = null) {
  const why = group ? 'the answer to ' + group + ' dropped ' + (steps.length === 1 ? 'it' : 'them') : 'the import was undone';
  const reason = group ? 'written by the ' + label + ' import from items the answer to ' + group + ' dropped since; the rest of the import stays'
    : 'written by the ' + label + ' import, which was undone; the project\'s old record still holds what they say';
  return { kind: 'withdraw', summary: 'Withdraw the ' + recordsSaid(steps, ruling) + ' the ' + label + ' import wrote: ' + why, reason, items: steps.map((s) => ({ record: s.id })) };
}

/* what an undo takes back is deleted by the board's purge, not left under an ended status;
   a fix and a rule line still go back by their own verbs */
const PURGED = ['task create', 'track new', 'register', 'ws create'];
const KIND_WORD = { knowledge: 'knowledge record' };
const purgedKinds = (steps) => {
  const n = {};
  for (const s of steps) { const k = s.kind || s.op; n[k] = (n[k] || 0) + 1; }
  return Object.entries(n).map(([k, c]) => counted(c, KIND_WORD[k] || k)).join(', ');
};

export async function undoImport(work, { board, cli = DEFAULT_CLI, all = false, group = null, session, dry: asked = false, log = console.log } = {}) {
  const t = target(work, board || 'live');
  const manifest = readJson(t.manifest, null);
  if (!manifest || !manifest.imports.length) throw new Error('no manifest at ' + t.manifest + ': nothing was written there');
  const imps = manifest.imports.filter((i) => !i.undone);
  /* a group a later answer dropped takes back only its items' records, from every live import; the import stays */
  const rows = group ? new Set((loadPlan(work).items || []).filter((x) => x.dropped === group).map((x) => x.id)) : null;
  if (rows && !rows.size) throw new Error('the plan drops no item by ' + group + ': write the drop answer into the proposal and run plan.mjs again');
  const pick = all || group ? imps : imps.slice(-1);
  const inGroup = (s) => !rows || rows.has(s.row);
  const env = { ...process.env, ...t.env };
  /* --dry reads the manifest of the board it is given, a rehearsal's included */
  const dry = !board || asked;
  const withdrawn = (s) => s.kind === 'decision' || s.kind === 'knowledge';
  const records = pick.flatMap((i) => i.steps).filter((s) => withdrawn(s) && !s.undoneAt && inGroup(s));
  if (!dry && records.length && !session) throw new Error('the undo files a withdraw request for its ' + recordsSaid(records) + ', which takes --session <own id>');
  const run = dry ? null : cliRunner(cli);
  log((dry ? 'Dry run of the undo' : 'Undo on ' + t.name) + ': ' + pick.length + ' import(s) of ' + manifest.label);
  const filed = [];
  const requests = [];
  const failed = [];
  const stays = [];
  const waiting = [];
  const held = [];
  /* the amended pointers a session read, and the fix request that puts their text back */
  const inUse = [];
  const fixes = [];
  /* the steps that keep their import open: refused, held back from the purge, or a task left open */
  const bad = new Set();
  /* an undone run's rows leave the map, so the next run reads those sources again */
  const mapDir = manifest.project && manifest.project.dir;
  const typed = new Map();
  const ruling = (s) => (typed.has(s.id) ? typed.get(s.id) === 'decision' : byKind(s));
  const word = (s) => (ruling(s) ? 'decision ' : 'knowledge record ') + s.id;
  /* the records the purge deletes, once no record waits on the user's press */
  const purge = [];
  let unsettled = 0;
  if (records.length && dry) log('  askerdo override request --kind withdraw --session <own id>, its ' + recordsSaid(records) + ' on stdin: ' + records.map((s) => s.id).join(', '));
  else if (records.length) {
    /* one withdrawn goes to the purge; one a record outside the import superseded is no longer in force, so it stays.
       A retired fact goes too: the undo takes back every record the write made */
    const recs = await showMany(run, records.map((s) => s.id), unread(env));
    const ids = new Set(records.map((s) => s.id));
    const now = new Date().toISOString();
    const ask = [];
    records.forEach((s, i) => {
      const r = recs[i];
      if (!r) { failed.push(word(s) + ': the board could not show it'); unsettled++; return; }
      if (r.type) typed.set(s.id, r.type);
      if (r.status === 'withdrawn') { purge.push(s); return; }
      if (r.status === 'superseded' && !ids.has(r.supersededBy)) { stays.push(word(s) + ' (superseded by ' + r.supersededBy + ')'); Object.assign(s, { undoneAt: now, stays: true }); return; }
      ask.push(s);
    });
    if (ask.length) {
      /* these leave only on the user's Withdraw, so a filed request leaves the import open; asked again, the
         board refuses while it waits (naming it) or once the user kept them, and files an expired one anew */
      const before = [...new Set(ask.map((s) => s.withdrawRequest).filter(Boolean))];
      const r = await run(['override', 'request', '--session', session], { stdin: JSON.stringify(withdrawInput(ask, manifest.label, ruling, group)), env });
      if (r.ok) {
        for (const s of ask) s.withdrawRequest = r.out && r.out.request;
        requests.push(r.out && r.out.request);
        filed.push('#' + (r.out && r.out.request) + ' (' + recordsSaid(ask, ruling) + ')');
        unsettled += ask.length;
      } else if (before.length && /\bkept\b/i.test(r.why)) {
        for (const s of ask) Object.assign(s, { undoneAt: now, stays: true, kept: true });
        stays.push(...ask.map((s) => word(s) + ' (the user kept it)'));
      } else {
        if (before.some((n) => r.why.includes('#' + n))) waiting.push('#' + before.join(', #') + ' (' + recordsSaid(ask, ruling) + ')');
        else failed.push('the withdraw request for ' + recordsSaid(ask, ruling) + ': ' + clip(r.why, 300));
        unsettled += ask.length;
      }
    }
  }
  /* each imported task's checklist: one holding an open step added since the import stays open, named */
  const creates = pick.flatMap((i) => i.steps).filter((s) => s.op === 'task create' && !s.fix && !s.undoneAt && s.id && inGroup(s));
  const lists = new Map(dry || !creates.length ? [] : (await showMany(run, creates.map((s) => s.id), unread(env))).map((r, i) => [creates[i].id, r]));
  const plan = readJson(join(work, 'plan.json'), null);
  const left = [];
  const back = [];
  for (const imp of pick.slice().reverse()) {
    for (const s of imp.steps.slice().reverse()) {
      if (s.undoneAt || withdrawn(s) || !inGroup(s)) continue;
      if (PURGED.includes(s.op) && !s.fix && s.id) {
        const drop = s.op === 'task create' ? importDrop(s, imp, lists.get(s.id), { plan, label: manifest.label }) : null;
        if (drop && drop.left) { bad.add(s); left.push(s.id + ' (' + drop.left.map((x) => x.n + '. ' + clip(x.text, 60)).join('; ') + ')'); continue; }
        purge.push(s);
        continue;
      }
      back.push({ imp, s });
    }
  }
  const going = new Set(purge.map((s) => s.id));
  /* an undo back to the inbox wakes 14 days from the undo; every undo verb takes --session only to name who undid it */
  const argsOf = (s) => s.undo && asApproved(withTier([...s.undo.map((a) => (a === '@{' + WAKE_REF + '}' ? wakeIn() : a)), ...(session ? ['--session', session] : [])]), session);
  if (dry) {
    for (const { s } of back) { const args = s.fix && going.has(s.id) ? null : argsOf(s); if (args) log('  askerdo ' + args.map(shq).join(' ')); }
    const all = [...purge, ...records];
    if (all.length) log('  askerdo purge ' + manifest.label + ' --id ' + all.map((s) => s.id).join(',') + ' --yes --session <own id>: deletes ' + purgedKinds(all) + ', once the user\'s Withdraw lands');
    if (mapDir && !group) for (const imp of pick) for (const id of [imp.plan + RESTAMPED, imp.plan]) log('  askerdo conversion drop --project ' + shq(mapDir) + ' --run ' + id);
  } else {
    const ours = new Set([...purge, ...records].map((s) => s.id));
    for (const { imp, s } of back) {
      /* a fix on a record of the import waits with the purge, and goes with the record it deletes */
      if (s.fix && ours.has(s.id) && (unsettled || going.has(s.id))) { if (!unsettled) s.undoneAt = new Date().toISOString(); continue; }
      /* a reconcile's ref stays while its amend does (no verb takes one back): the redo's plan reads it as done */
      const amended = s.fix && imp.steps.some((x) => x.step === s.step + '@amend' && x.fix && !x.undo);
      if (s.fix && (!s.undo || amended)) { stays.push(s.kind + ' ' + s.id); continue; }
      const args = argsOf(s);
      if (!args) continue;
      const r = await run(args, { env });
      /* a session read the amended pointer, so its old text goes back only by the user's Fix */
      if (!r.ok && s.op === 'knowledge amend' && /\bis in use\b/.test(r.why)) { bad.add(s); inUse.push(s); continue; }
      if (!r.ok) { bad.add(s); failed.push(s.kind + ' ' + s.id + ': ' + clip(r.why, 200)); continue; }
      s.undoneAt = new Date().toISOString();
    }
    if (inUse.length) {
      const items = inUse.map((s) => ({ record: s.id, body: s.undo[s.undo.indexOf('--body') + 1] }));
      const said = counted(inUse.length, 'history pointer') + ' (' + inUse.map((s) => s.id).join(', ') + ')';
      const r = session ? await run(['override', 'request', '--session', session], { env, stdin: JSON.stringify({ kind: 'fix', items,
        summary: 'Put back the text of the ' + said + ' the ' + manifest.label + ' import amended: the import was undone',
        reason: 'the ' + manifest.label + ' import amended them with folders it took out of the tree, and that import was undone' }) }) : { ok: false, why: 'the fix request takes --session <own id>' };
      if (r.ok) { requests.push(r.out && r.out.request); fixes.push('#' + (r.out && r.out.request) + ' (' + said + ')'); }
      else if (/already reads as proposed/.test(r.why)) for (const s of inUse) { bad.delete(s); s.undoneAt = new Date().toISOString(); }
      else if (/\bkept\b/i.test(r.why)) for (const s of inUse) { bad.delete(s); Object.assign(s, { undoneAt: new Date().toISOString(), stays: true, kept: true }); stays.push(s.kind + ' ' + s.id + ' (the user kept it)'); }
      else if (/already has override #\d+ waiting/.test(r.why)) fixes.push('still ' + said);
      else failed.push('the fix request for ' + said + ': ' + clip(r.why, 300));
    }
    if (purge.length && !unsettled) {
      const r = await run(['purge', manifest.label, '--id', purge.map((s) => s.id).join(','), '--yes', ...(session ? ['--session', session] : [])], { env });
      if (!r.ok) failed.push('the purge of ' + purgedKinds(purge) + ': ' + clip(r.why, 300));
      else {
        const now = new Date().toISOString();
        const stopped = new Map((r.out.held || []).map((h) => [h.id, h.why]));
        for (const s of purge) {
          if (!stopped.has(s.id)) { s.undoneAt = now; continue; }
          /* a workstream holding records the import did not write is closed instead */
          const ws = s.op === 'ws create' && s.undo ? await run(argsOf(s), { env }) : null;
          if (ws && (ws.ok || /already closed/.test(ws.why))) { Object.assign(s, { undoneAt: now, stays: true }); stays.push('workstream ' + s.id + ' (closed: it ' + stopped.get(s.id) + ')'); continue; }
          bad.add(s);
          held.push(s.id + ' ' + stopped.get(s.id));
        }
        const gone = purge.filter((s) => s.undoneAt === now && !s.stays);
        if (gone.length) log('Deleted ' + purgedKinds(gone) + ' the import wrote, with their journals, history and activity');
      }
    }
  }
  for (const imp of pick.slice().reverse()) {
    if (dry || group || unsettled || imp.steps.some((s) => bad.has(s) || ((withdrawn(s) || (PURGED.includes(s.op) && !s.fix && s.id)) && !s.undoneAt))) continue;
    imp.undone = new Date().toISOString();
    /* its folder ends go with the run: the reverts it prints bring the folders back, and a redo's handover sets them again.
       a source whose records all stand (ones the user kept, another record's) stays converted, so a rerun reads it unchanged */
    const keep = mapDir ? await standing(run, env, mapDir, imp, manifest.imports.filter((o) => o !== imp)) : [];
    /* the handover's new hashes first, which the reverts take back, then the write's rows */
    for (const [id, k] of [[imp.plan + RESTAMPED, []], [imp.plan, keep]]) {
      const r = mapDir ? await run(['conversion', 'drop', '--project', mapDir, '--run', id, ...(k.length ? ['--keep', k.join(',')] : [])], { env }) : { ok: true };
      if (!r.ok) failed.push('the conversion map rows of ' + id + ': ' + clip(r.why, 200));
    }
  }
  if (!dry) {
    const gone = new Set(pick.filter((i) => i.undone).flatMap((i) => i.steps.map((s) => s.row)));
    manifest.left = (manifest.left || []).filter((r) => !gone.has(r));
    writeJson(t.manifest, manifest);
    /* an undone import's step results go too, or the next write would skip its steps as landed */
    const results = readJson(t.results, null);
    if (results) {
      for (const s of pick.filter((i) => i.undone).flatMap((i) => i.steps)) delete results[s.step];
      writeJson(t.results, results);
    }
  }
  /* Codex reads what the undo took back at once, not at the next Claude session start; a rehearsal's
     board never writes the real repo's file */
  let override = null;
  if (!dry && !t.rehearsal && mapDir) {
    /* a group undo prints no revert, so AGENTS.md stays as the handover left it */
    try { override = await refreshAgentsOverride(mapDir, { env, agents: group ? null : agentsBefore(mapDir, pick) }); } catch (e) { override = { did: 'failed', why: oneLine(e && e.message) }; }
    if (override.did === 'wrote') log('Rewrote ' + override.path + ' for Codex from the rules and decisions left on the board');
    else if (override.did === 'failed') log('AGENTS.override.md was not rewritten (the rules read failed: ' + override.why + '); a Claude session started in the project rewrites it');
  }
  if (failed.length) log('Refused (' + failed.length + '), run the undo again once each is fixed:\n  ' + failed.join('\n  '));
  if (fixes.length) log('Fix request for the text of the records the import amended, waiting on the user\'s Fix or Keep: ' + fixes.join(', ') + '. Run the undo again after the press.');
  if (left.length) log('Tasks left open (' + left.length + '): each holds an open step added after the import, which the undo never strikes; settle those steps, then run the undo again:\n  ' + left.join('\n  '));
  if (filed.length || waiting.length) log('Withdraw request ' + (filed.length ? 'filed, waiting' : 'still waiting') + ' on the user\'s one Withdraw or Keep: ' + [...filed, ...waiting].join(', ')
    + '. The import reads undone only once it is decided: run the undo again after the press.');
  else if (dry && records.length) log('The ' + recordsSaid(records) + ' leave only by a withdraw request the user presses Withdraw on: the undo files one request for them all (--session <own id>).');
  if (held.length) log('Held back from the purge (' + held.length + '), run the undo again once each is settled:\n  ' + held.join('\n  '));
  if (stays.length) log('Stay as they are (' + stays.length + '), fixes no verb takes back and records the user kept or a later record superseded: ' + stays.join(', '));
  /* the handover's commit, one a run (one per --file run): named, newest first, never reverted without the user's word */
  const repo = group ? [] : pick.flatMap((i) => (i.repo || []).map((e, k) => ({ ...e, k }))).filter((e) => e.commit);
  const shas = [...new Set(repo.sort((a, b) => String(b.at).localeCompare(String(a.at)) || b.k - a.k).map((e) => e.commit))];
  /* a commit a squash or rebase replaced is no revert to print: the user reverts the commit that holds it */
  const git = mapDir ? gitIn(mapDir) : null;
  const lost = git ? shas.filter((c) => git(['merge-base', '--is-ancestor', c, 'HEAD']).status !== 0) : [];
  const kept = shas.filter((c) => !lost.includes(c));
  if (kept.length) log('The handover\'s repo commits, newest first: revert each with git once the user says so (the undo runs none):\n  ' + kept.map((c) => 'git revert ' + c).join('\n  '));
  if (lost.length) log('Not in the branch\'s history (' + lost.length + ', squashed or rebased): revert the commit that holds them once the user says so: ' + lost.map((c) => c.slice(0, 10)).join(', '));
  log('Handoffs go with their dropped tracks. Procedure cards stay: they follow their docs/procedures files, so they go when those files do; the verified commit the handover recorded on them is withdrawn.');
  return { failed, filed, requests, waiting, stays, left, held, ...(override ? { override } : {}) };
}
/* AGENTS.md as the printed reverts leave it, when a handover commit changed it: the override is git-ignored, so the
   reverts never touch it and Codex would read the converted text the undo takes back */
function agentsBefore(dir, imps) {
  const shas = imps.flatMap((i) => i.repo || []).filter((e) => e.commit).sort((a, b) => String(a.at).localeCompare(String(b.at))).map((e) => e.commit);
  if (!shas.length) return null;
  const git = gitIn(dir);
  if (!String(git(['diff', '--name-only', shas[0] + '^', shas[shas.length - 1], '--', 'AGENTS.md']).stdout || '').trim()) return null;
  const r = git(['show', shas[0] + '^:./AGENTS.md']);
  return r.status === 0 ? r.stdout : null;
}

/* the sources of an import's map rows whose records still stand and are its own or no import's. A row holding another
   import's record goes, so the drop gives back that import's row for its own undo. The board tells, as that import
   may be in another work folder: a record by its onboard: ref; a rule line or card, which carry no mark, by not being ours */
const BOARD_ID = /^(?:[A-Z]{1,3}-\d+(?:\.\d+)?|Q\d+)$/;
async function standing(run, env, dir, imp, others = []) {
  const own = new Set(imp.steps.map((s) => s.id).filter(Boolean));
  const back = new Set(imp.steps.filter((s) => s.undoneAt && !s.stays && s.id).map((s) => s.id));
  /* a card the handover wrote goes with the printed reverts, so the source it came from is read again */
  for (const e of imp.repo || []) if (e.op === 'write') back.add(e.path);
  const theirs = new Set(others.flatMap((o) => [...o.steps.map((s) => s.id), ...(o.repo || []).filter((e) => e.op === 'write').map((e) => e.path)]).filter(Boolean));
  const r = await run(['conversion', '--project', dir], { env: unread(env) });
  const rows = ((r.ok && r.out && r.out.rows) || []).filter((x) => (x.run === imp.plan || x.run === imp.plan + RESTAMPED) && (x.kind === 'file' || x.kind === 'folder') && (!x.fate || x.fate === 'keep')
    && (x.records || []).length && !(x.gone || []).length && x.records.every((id) => !back.has(id) && !theirs.has(id)));
  const ids = [...new Set(rows.flatMap((x) => x.records).filter((id) => BOARD_ID.test(id)))];
  const shown = new Map((await showMany(run, ids, unread(env))).map((rec, i) => [ids[i], rec]));
  const stands = (id) => {
    if (!BOARD_ID.test(id)) return own.has(id);
    const rec = shown.get(id);
    return Boolean(rec) && !['dropped', 'closed', 'withdrawn'].includes(rec.status) && (own.has(id) || !(rec.refs || []).some((x) => String(x).startsWith('onboard:')));
  };
  return rows.filter((x) => x.records.every(stands)).map((x) => x.source);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const a = process.argv.slice(2);
  const flag = (n) => { const i = a.indexOf('--' + n); return i >= 0 ? a.splice(i, 2)[1] : undefined; };
  const bool = (n) => { const i = a.indexOf('--' + n); if (i >= 0) a.splice(i, 1); return i >= 0; };
  const board = flag('board'); const cli = flag('cli') || DEFAULT_CLI; const session = flag('session'); const undo = bool('undo'); const all = bool('all'); const group = flag('group');
  const cover = bool('coverage'); const hand = bool('handover'); const only = flag('file'); const reader = bool('reader'); const dry = bool('dry');
  if (!a[0] || a[0] === '--help') { console.log(USAGE); process.exit(a[0] ? 0 : 1); }
  try {
    if (reader) { readerFile(a[0], { cli }); process.exit(0); }
  } catch (e) { console.error('apply: ' + e.message); process.exit(1); }
  if (!existsSync(cli)) { console.error('apply: no CLI at ' + cli); process.exit(1); }
  try {
    if (cover) { const c = await runCoverage(a[0], { board: board || 'live', cli }); process.exit(c.sources.some((s) => s.blocked) || (c.claude || []).some((x) => x.blocked) ? 2 : 0); }
    if (hand) { const h = await handover(a[0], { board: board || 'live', cli, file: only || null }); process.exit(h.stopped ? 1 : h.skipped.some((s) => !s.expected) ? 2 : 0); }
    /* the live write runs in one child, so this process's loop is free to renew the pause while it runs */
    if (!undo && board === 'live' && !process.env[PAUSE_HELD]) process.exit(await quietWrite(writeInChild));
    const r = undo ? await undoImport(a[0], { board, cli, all, group: group || null, session, dry })
      : board && board.startsWith('file:') ? await rehearse(a[0], { board, cli }) : await applyPlan(a[0], { board, cli });
    process.exit(r.stopped || (r.failed && r.failed.length) || (r.undo && r.undo.failed.length) ? 1 : 0);
  } catch (e) { console.error('apply: ' + e.message); process.exit(1); }
}
