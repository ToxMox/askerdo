#!/usr/bin/env node
/* runs plan.json through the AskerDo CLI's own command code, in order and in this one process.
   Without --board it is a dry run that prints each command. --board file:<db> rehearses on a scratch board
   (it keeps going and lists every refusal); --board live writes the board the CLI's config names, takes the
   go plan.mjs --go recorded, stops at the first refusal and resumes from its results. Every id written goes
   in the manifest, which --undo walks backwards. --coverage proves each converted source against its records,
   and --handover then makes the repo edits, one commit per folder, each named in the manifest; --repoint runs
   its citation step alone.
   node apply.mjs <work dir> [--board file:<db> | --board live] [--cli <path>]
     [--coverage | --handover [--file <path>] | --repoint [--file <path>] | --undo [--all] [--session <own id>] [--dry]] */
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { storeRoot } from '../../lib/node-helpers.mjs';
import { stateProblems, wakeIn } from '../../server/handoff-text.mjs';
import { cardRow, cardText, writeCard } from './cards.mjs';
import { WAKE_REF, citeJudge, folderKey, under } from './plan.mjs';
import { coverage, recordReader, repointGaps, table } from './coverage.mjs';
import { citer, fencedLines, folderRe, inText, isGlob, linksIn, MD, printed, relFrom, resolveFrom, UP_PATH, wrapLead } from './cites.mjs';
import { CALL, NONE, RUN, blobsOf, folderSig, isFolder, parseTree } from './map.mjs';
import { blockAt } from './survey.mjs';
import { DEFAULT_MODE, instructionFiles, kindOf as fileKind, pathsFront } from './instructions.mjs';
import { refreshAgentsOverride } from '../../lib/agents-override.mjs';

const DEFAULT_CLI = join(homedir(), '.claude', 'askerdo', 'cli.mjs');
const USAGE = 'node apply.mjs <work dir> [--board file:<db> | --board live] [--cli <path>]\n'
  + '  [--coverage | --handover [--file <path>] | --repoint [--file <path>] | --undo [--all] [--session <own id>] [--dry]]';
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
const gitWhy = (r) => oneLine((r.error && r.error.message) || r.stderr || r.stdout) || 'exit ' + r.status;
/* git in the project, every pathspec literal (a path may hold * or [) */
const gitIn = (dir) => (args, input) => spawnSync('git', ['--literal-pathspecs', ...args], { cwd: dir, encoding: 'utf8', windowsHide: true, maxBuffer: 256 << 20, ...(input === undefined ? {} : { input }) });
/* a call over a batch's paths reads them from a file in the work folder, never the command line, so no batch
   is too long for Windows' 32767 characters */
function gitBatch(git, work, args, paths) {
  mkdirSync(work, { recursive: true });
  const file = join(work, 'pathspec-' + process.pid + '.txt');
  writeFileSync(file, paths.map((p) => p + '\0').join(''));
  try { return git([...args, '--pathspec-from-file=' + file, '--pathspec-file-nul']); } finally { rmSync(file, { force: true }); }
}
/* the paths git tracks, or null outside a repo */
export function trackedIn(dir) {
  const r = gitIn(dir)(['ls-files', '-z']);
  return r.status === 0 ? new Set(String(r.stdout || '').split('\0').filter(Boolean)) : null;
}
/* what the repo holds now: the tracked paths, the untracked ones, and the ones with uncommitted changes */
export function repoState(dir) {
  const git = gitIn(dir);
  const tracked = trackedIn(dir) || new Set();
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
  'track layout': 'track order', 'edge add': 'task order', 'task edit': 'run-by', 'question edit': 'question scope',
  decide: 'decision', 'knowledge new': 'knowledge', register: 'question', 'profile rule-add': 'rule line', 'profile add': 'profile hold', 'proc scan': 'procedure cards',
  'profile rule-clear': 'rule clear', 'profile define': 'profile setting',
};
/* a doctor's fix step changes a record already on the board; its kind is never 'knowledge',
   which the undo reads as a record that stays */
const FIX_KIND = {
  'profile rule-add': 'rule line', 'profile rule-clear': 'rule clear', 'knowledge amend': 'knowledge amend', 'knowledge edit': 'knowledge ref',
  'knowledge supersede': 'knowledge supersede', 'task update': 'task status', 'task edit': 'task place', 'track park': 'park condition',
};
export const kindOf = (s) => (s.fix ? (s.op === 'task edit' && (s.args || []).includes('--add-ref') ? 'task ref' : FIX_KIND[s.op] || s.op) : KIND[s.op] || s.op);
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
    case 'task edit':
    case 'knowledge edit': {
      const back = [];
      for (const [add, rm] of [['--add-ref', '--remove-ref'], ['--add-project', '--remove-project']]) if (flag(add) !== undefined) back.push(rm, flag(add));
      /* the track took the task into its workstream: back unplaced in the one it left */
      if (flag('--track') !== undefined) back.push(...(was.track ? ['--track', was.track] : ['--unplaced', was.unplaced || 'undo of the doctor', '--wake', '@{' + WAKE_REF + '}', ...(was.workstream ? ['--workstream', was.workstream] : [])]));
      return back.length ? [a[0], 'edit', a[2], ...back] : null;
    }
    /* task update takes a reason, which a task waiting on open ones needs to start again */
    case 'task update': return flag('--status') && was.status ? ['task', 'update', a[2], '--status', was.status, '--reason', 'undo of the doctor'] : null;
    /* a park again keeps the condition it had (checked on a scratch board), so no verb takes one back */
    default: return null;
  }
}

export function undoArgs(step, id, label) {
  if (step.fix) return undoFix(step);
  const why = 'undo of the ' + label + ' import';
  switch (step.op) {
    case 'ws create': return ['ws', 'close', id, '--outcome', why];
    case 'task create': return ['task', 'edit', id, '--status', 'dropped'];
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
const idOf = (step, out) => {
  if (step.fix) return step.target;
  if (step.op === 'profile rule-add') return step.args[2] + '/' + step.args[3];
  if (step.op === 'profile add') return step.args[3] + ' on ' + step.args[2];
  if (step.op === 'profile rule-clear') return step.args[2] + '/' + step.args[3] + ' cleared';
  if (step.op === 'profile define') return step.args[2] + ' ' + step.args[4];
  if (['proc scan', 'track finish', 'track park', 'track layout', 'edge add', 'task edit', 'question edit'].includes(step.op)) return 'ok';
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
  /* an item the session left out, with its source's hash, so a later run leaves it while that source is unchanged */
  const left = (plan.left || []).map((id) => ({ item: id, source: filesOf(items.get(id))[0] || null }));
  /* a kept path that is a file is judged and mapped as a file, its hash re-checked */
  const bareOf = (p) => String(p || '').replace(/\/+$/, '');
  const judged = (plan.judged || []).map((j) => (j.kind === 'folder' && isFile(bareOf(j.subject)) ? { ...j, key: 'file:' + bareOf(j.subject), kind: 'file', subject: bareOf(j.subject) } : j));
  const hashed = judged.filter((j) => j.kind === 'item' || j.kind === 'file').map((j) => j.subject);
  const texts = blobs([...byFile.keys(), ...((plan.map && plan.map.seeds) || []).map((sd) => sd.source), ...restamp.map((r) => r.source), ...subjects, ...left.map((l) => l.source), ...hashed].filter((f) => f && !isFolder(f) && loose(f)));
  const hashOf = (f) => (loose(f) ? texts.get(f) || null : tree.get(f) || null);
  const file = [...byFile].map(([f, ids]) => ({ source: f, kind: 'file', hash: hashOf(f), sha: head, records: [...ids], detail: { lines: lines.get(f) || [] } }));
  for (const sd of (plan.map && plan.map.seeds) || []) if (!byFile.has(sd.source)) file.push({ source: sd.source, kind: isFolder(sd.source) ? 'folder' : 'file', hash: isFolder(sd.source) ? sigOf(sd.source) : hashOf(sd.source), sha: head, records: sd.records, why: 'an earlier import', ...(lines.has(sd.source) ? { detail: { lines: lines.get(sd.source) } } : {}) });
  /* an earlier run's row for a file the handover edited takes the new hash with its records, so a rerun reads it unchanged */
  for (const r of restamp) if (!file.some((x) => x.source === r.source)) file.push({ source: r.source, kind: 'file', hash: hashOf(r.source), sha: head, records: r.records || [], ...(r.why ? { why: r.why } : {}), ...(lines.has(r.source) ? { detail: { lines: lines.get(r.source) } } : r.detail ? { detail: r.detail } : {}) });
  const call = (plan.answers || []).map((a) => ({ source: CALL + a.call, kind: 'call', answer: a.letter, sha: head,
    detail: { ask: a.ask, label: a.label, subjects: Object.fromEntries((a.subjects || []).map((p) => [p, isFolder(p) ? sigOf(p) || NONE : hashOf(p) || NONE])) } }));
  const folder = (plan.folders || []).filter((f) => f.end === 'keep').map((f) => ({ source: isFile(bareOf(f.path)) ? bareOf(f.path) : f.path.replace(/\/*$/, '/'), kind: 'folder', fate: 'keep', why: f.why || null, sha: head }));
  const run = [{ source: RUN + plan.made, kind: 'run', sha: head, detail: { folders,
    ...(left.length ? { left: left.map((l) => (l.source ? { ...l, hash: hashOf(l.source) || NONE } : { item: l.item })) } : {}),
    ...(judged.length ? { judged: judged.map((j) => ((j.kind === 'item' || j.kind === 'file') && hashOf(j.subject) ? { ...j, hash: hashOf(j.subject) } : j)) } : {}),
    ...(instructions ? { instructions } : {}) } }];
  return { file, call, folder, run };
}
/* the repo's blobs and trees at HEAD, what is uncommitted and its text's hashes, for the map */
export function mapState(dir, work) {
  const git = gitIn(dir);
  const top = git(['rev-parse', 'HEAD']);
  const blobs = (paths) => blobsOf(dir, paths.filter((f) => existsSync(join(dir, f))));
  const seen = readJson(join(work, 'facts-map.json'), {}) || {};
  const isFile = (f) => { try { return statSync(join(dir, f)).isFile(); } catch { return false; } };
  const more = { isFile, instructions: seen.instructions || null };
  if (top.status !== 0) return { tree: new Map(), dirty: () => true, blobs, folders: {}, head: null, ...more };
  const tree = parseTree(git(['-c', 'core.quotepath=false', 'ls-tree', '-r', '-t', '-z', '--full-tree', 'HEAD']).stdout);
  const repo = repoState(dir);
  const loose = new Set([...repo.untracked, ...repo.changed]);
  return { tree, dirty: (f) => loose.has(f), blobs, folders: seen.folders || {}, head: String(top.stdout).trim(), ...more };
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
      if (manifest && !manifest.imports.some((i) => i.steps.some((x) => x.step === s.id))) imp.steps.push(entry(s, results[s.id].id));
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
    const args = sub(step.args);
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
    results[s.id] = { started: new Date().toISOString() };
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
    results[s.id] = { id, at: new Date().toISOString() };
    imp.steps.push(entry(s, id));
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
  }
  log('\n' + (t ? 'Written' : 'Would write') + ': ' + Object.entries(tally).map(([k, v]) => k + ' ' + v).join(', '));
  if (t) log('The write: ' + took.steps + ' calls in ' + (took.ms / 1000).toFixed(1) + ' s, ' + took.perSecond + ' a second, in one process.');
  if (skipped.length) log('Skipped (' + skipped.length + '):\n  ' + skipped.join('\n  '));
  if (triggers.length) log('Files added to facts the board holds, run on the go against the real board (' + triggers.length + '):\n  ' + triggers.join('\n  '));
  if (wouldRun.length) log('The doctor\'s fixes, run on the go against the real board (' + wouldRun.length + '):\n  ' + wouldRun.join('\n  '));
  if (scratch.length) log('Named on the real board, which a scratch board lacks (' + scratch.length + '):\n  ' + scratch.join('\n  '));
  if (refusals.length) log('Refused (' + refusals.length + '):\n  ' + refusals.join('\n  '));
  const goes = (plan.folders || []).filter((f) => f.end !== 'keep');
  if (goes.length || (plan.cards || []).length || (plan.claude || []).length) log('The handover makes the repo edits on the go, each folder once its gate clears it (--coverage, then --handover): '
    + (plan.cards || []).length + ' cards, ' + (plan.claude || []).length + ' ledger rewrites, ' + goes.length + ' folders deleted, retired or moved');
  if (plan.pending.length) log('Not in this plan, waiting on the session: ' + plan.pending.length + ' items (plan.mjs lists them)');
  let copy = null;
  if (t && t.rehearsal) {
    const cov = await runCoverage(work, { board, cli, log: () => {} });
    const sample = new Map();
    for (const s of imp.steps.filter((x) => /^(?:[A-Z]{1,3}-\d+(?:\.\d+)?|Q\d+)$/.test(String(x.id)) && !String(x.step).endsWith('@detail'))) {
      if (!sample.has(s.kind)) sample.set(s.kind, []);
      if (sample.get(s.kind).length < 3) sample.get(s.kind).push(s);
    }
    const ids = [...sample.values()].flat().map((s) => s.id);
    const recs = await showMany(run, ids, unread(env));
    const records = new Map(ids.map((id, i) => [id, recs[i]]));
    /* the handover on a copy of the repo, which the fresh reader reads before the go; a write
       with refused steps leaves the board short of the plan, so it gets no copy and no reader file */
    if (refused) { dropCopy(work, t); log('No copy for the fresh reader: the write refused ' + refused + ' steps; fix them and rehearse again'); }
    else try { copy = await rehearseHandover(work, { board, cli, log }); } catch (e) { log('No copy for the fresh reader: ' + oneLine(e && e.message)); }
    const file = join(work, 'rehearsal.md');
    writeFileSync(file, rehearsalReport(work, { plan, manifest, cov, wouldRun, triggers, copy, repo: repoState(plan.project.dir), records, timing: took }));
    log('The rehearsal report, what will land: ' + file);
  }
  return { tally, refusals, skipped, scratch, wouldRun, triggers, ...(copy ? { copy } : {}), timing: took };
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
export function folderGate(f, { cov = null, tracked = new Set(), untracked = [], changed = new Set(), runs = [], going = new Set() } = {}) {
  const path = folderKey(f.path);
  const end = f.end;
  if (end !== 'move' && !GONE.includes(end)) return { path, end: 'keep', go: false, why: f.why || 'kept' };
  const ev = f.evidence || {};
  const stay = (why) => ({ path, end, go: false, hold: 'kept', why });
  if (end === 'move' && !f.to) return stay('a move with no folder to go to');
  const gone = (r) => [...going].some((g) => under(r, g)) || (tracked.size > 0 && !tracked.has(r) && !untracked.includes(r));
  const readers = readersLeft(ev.codeReaders, gone);
  if (readers.length) return stay('code reads it: ' + readers.join(', '));
  const blocked = cov ? cov.sources.filter((s) => s.blocked && under(s.file, path)) : [];
  if (blocked.length) return stay(blocked.reduce((n, s) => n + s.gaps.length, 0) + ' coverage gaps in ' + blocked.map((s) => s.file).join(', '));
  const dirty = [...changed].filter((x) => under(x, path));
  if (dirty.length) return { path, end, go: false, hold: 'skipped', why: 'uncommitted changes in ' + dirty.length + ' files (' + dirty.slice(0, 3).join(', ') + ')' };
  let hooked = [];
  if (GONE.includes(end)) {
    if (ev.openItems > 0 && f.dormant && !f.answeredBy) return stay(ev.openItems + ' open items, and no answer to the dormant-work call names it');
    const loose = untracked.filter((x) => under(x, path));
    if (loose.length || ev.untracked > 0) return stay('it holds ' + (loose.length || ev.untracked) + ' untracked files: git has no copy of them');
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
  return { path, end, go: true, files, ...(tracked.has(path) ? { file: true } : {}), ...(end === 'move' ? { to: folderKey(f.to) } : {}),
    ...(hooked.length ? { unhook: hooked.map((x) => ({ file: x.file, what: x.what })) } : {}), why: f.why || '' };
}
/* a folder as its commit names it; a file unit keeps its own name */
const unit = (g) => g.path + (g.file ? '' : '/');
/* the gates with the readers that go in the same run discounted: a unit leaves the going set when its
   own gate holds it, until none does; `goes` limits the units this call takes (--file) */
export function gatesOf(plan, cov, repo, { goes = () => true } = {}) {
  const fs = plan.folders || [];
  const loads = Object.entries(plan.loaders || {});
  let going = new Set(fs.filter((f) => GONE.includes(f.end) && goes(f.path)).map((f) => folderKey(f.path)));
  for (;;) {
    const gates = fs.map((f) => folderGate(f, { cov, ...repo, going }));
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

/* the rehearsal shows content, not counts. It opens with the check against the aim: does the
   converted project hold the old system's live state and none of its history; then every rule line in full,
   each card, three records per other kind read back, the CLAUDE.md ledger, coverage and every folder's end. */
function keptVerdict(step) {
  const x = step.replaces || {};
  if (x.how === 'clear') return 'the rule wins: written on ' + step.args[2] + ', and the old line comes off ' + x.profile + (x.holders > 1 ? ', which ' + x.holders + ' records hold' : '');
  if (x.how === 'setting') return 'the rule wins: written on ' + step.args[2] + ', with ' + x.with + ' switched off there';
  if (x.how === 'beside') return 'both stand: ' + x.with + ' is a setting the rule cannot replace, so change it in Settings';
  return step.args[3] === x.with ? 'the rule wins, replacing it on ' + step.args[2] : 'the rule wins, written beside it';
}
const evidenceLine = (ev = {}) => [ev.lastTouch ? 'last touched ' + ev.lastTouch : null, ev.commits !== undefined ? ev.commits + ' commits' : null,
  ev.workflowShare !== undefined ? Math.round(ev.workflowShare * 100) + '% workflow commits' : null, ev.untracked ? ev.untracked + ' untracked' : null,
  ev.openItems ? ev.openItems + ' open items' : null, readersIn(ev.liveCites).length ? 'cited live at ' + readersIn(ev.liveCites).join(', ') : null,
  readersIn(ev.codeReaders).length ? 'read by ' + readersIn(ev.codeReaders).join(', ') : null].filter(Boolean).join('; ') || 'no evidence recorded';
export function rehearsalReport(work, { plan, manifest, cov, records = new Map(), wouldRun = [], triggers = [], copy = null, repo = null, timing = null }) {
  const steps = manifest.imports.filter((i) => !i.undone).flatMap((i) => i.steps);
  const idOf = (step) => (steps.find((s) => s.step === step) || {}).id || null;
  const written = new Set(steps.filter((s) => s.id).map((s) => s.row));
  const items = plan.items || [];
  const gates = gatesOf(plan, cov, repo || { tracked: new Set(), untracked: [], changed: new Set() });
  const out = ['# Rehearsal of the ' + plan.label + ' conversion', '', 'Read back from the scratch board ' + manifest.store + '. Nothing is on the live board or changed in the repo yet.', ''];
  out.push('## The check against the aim', '', 'Does the converted project hold the old system\'s live state, and none of its history?', '');
  /* the doctor's fixes change records already on the board: counted apart from the old system's live state */
  const live = items.filter((x) => x.kind !== 'fix');
  const fixes = items.filter((x) => x.kind === 'fix' && !x.cut && !(x.fields && x.fields.info));
  /* a cut coverage backs (out of force in its source) loses nothing */
  const backed = new Set(((cov && cov.sources) || []).flatMap((s) => s.drops.map((d) => d.item)));
  const gaps = live.filter((x) => x.cut && !x.dropped && !backed.has(x.id));
  const off = live.filter((x) => x.cut && !x.dropped && backed.has(x.id));
  const notWritten = live.filter((x) => !x.cut && !x.covered && !written.has(x.id) && x.kind !== 'card');
  const stays = gates.filter((g) => g.hold);
  out.push('- Live state: ' + (live.length - gaps.length - off.length - notWritten.length) + ' of ' + live.length + ' items reach the board or are already there'
    + (off.length ? '; ' + off.length + ' cut and backed (out of force in their sources, or dropped on evidence that holds)' : '')
    + (gaps.length ? '; ' + gaps.length + ' cut with no answer of the user (gaps): ' + gaps.map((x) => x.id).join(', ') : '')
    + (notWritten.length ? '; ' + notWritten.length + ' the write did not take: ' + notWritten.map((x) => x.id).join(', ') : '') + '.');
  out.push('- History: ' + gates.filter((g) => g.go).length + ' folders leave the tree on the go' + (stays.length ? '; ' + stays.length + ' stay, each named below with why' : '') + '.');
  if (fixes.length) out.push('- The doctor\'s fixes: ' + fixes.length + ' to records already on the board, run on the go (listed at the end).');
  out.push('');
  out.push('### Items by kind, with their sources\' folders', '');
  const kinds = [...new Set(items.map((x) => x.kind))];
  for (const k of kinds) {
    const of = items.filter((x) => x.kind === k);
    const folders = [...new Set(of.map((x) => (x.source && x.source.file ? (x.source.file.includes('/') ? x.source.file.replace(/\/[^/]*$/, '/') : '(top level)') : '(no file)')))];
    const writes = k === 'card' ? of.filter((x) => (plan.cards || []).some((c) => c.item === x.id)).length : of.filter((x) => written.has(x.id)).length;
    out.push('- ' + k + ': ' + writes + (k === 'card' ? ' written by the handover, ' : ' written, ') + of.filter((x) => x.covered).length + ' already on the board, '
      + of.filter((x) => x.dropped).length + ' dropped by an answer, ' + of.filter((x) => x.cut && !x.dropped).length + ' cut; from ' + folders.join(', '));
  }
  if (!kinds.length) out.push('None.');
  out.push('', '### Folders by end, with their evidence', '');
  for (const end of ['retire', 'delete', 'move', 'keep']) {
    for (const f of (plan.folders || []).filter((x) => (x.end || 'keep') === end)) {
      const g = gates.find((x) => x.path === folderKey(f.path)) || {};
      out.push('- ' + f.path + ': ' + end + (f.to ? ' to ' + f.to : '') + (g.hold ? ', but it stays: ' + g.why : '') + '. ' + (f.why || '') + ' (' + evidenceLine(f.evidence) + ')'
        + (f.answeredBy ? '; answered by ' + f.answeredBy : ''));
    }
  }
  if (!(plan.folders || []).length) out.push('None.');
  out.push('', '### The calls and their answers', '');
  for (const a of plan.answers || []) out.push('- ' + a.call + ': ' + a.ask + ' Answered ' + a.letter + ': ' + a.label);
  if (!(plan.answers || []).length) out.push('None.');
  out.push('');
  if (timing) out.push('The write: ' + timing.steps + ' calls in ' + (timing.ms / 1000).toFixed(1) + ' s, ' + timing.perSecond + ' a second, in one process.', '');
  out.push('An undo cannot take back the ' + plan.steps.filter((s) => s.op === 'knowledge new').length + ' knowledge records this write makes (no verb removes one), and its '
    + plan.steps.filter((s) => s.op === 'decide').length + ' decisions leave only by a withdraw the user allows, one each.', '');
  out.push('## Rule lines', '');
  const rules = items.filter((x) => x.kind === 'rule');
  for (const r of rules) {
    const step = plan.steps.find((s) => s.id === r.id);
    const verdict = r.covered ? 'already on the board as ' + r.covered + ', not written' : step ? (step.replaces ? 'differs from ' + step.replaces.with + ': ' + keptVerdict(step) : 'new')
      : r.dropped ? 'dropped by the answer to ' + r.dropped : r.cut ? 'cut' : 'waiting on the session';
    const text = step ? step.args[step.args.indexOf('--text') + 1] : (r.fields && r.fields.text) || r.text || r.title;
    const detail = idOf(r.id + '@detail') || r.heldDetail;
    out.push('- `' + ((r.fields && r.fields.slug) || (step && step.args[3]) || r.id) + '` (' + verdict + (detail ? '; its detail record ' + detail : '') + '): ' + oneLine(String(text).replace(REF, (m, id) => idOf(id) || m)));
  }
  if (!rules.length) out.push('None.');
  out.push('', '## Procedure cards', '');
  for (const c of plan.cards || []) {
    const item = items.find((x) => x.id === c.item);
    if (!item) continue;
    const { text } = cardText(cardRow(item, c.target));
    const front = (/^---\n([\s\S]*?)\n---/.exec(text) || [])[1] || '';
    out.push('### ' + c.target, '', '```yaml', front, '```', '', ...text.split('\n').filter((l) => /^### /.test(l)).map((l) => '- ' + l.slice(4)), '');
  }
  if (!(plan.cards || []).length) out.push('None.', '');
  out.push('## Sample records', '');
  const byKind = new Map();
  for (const s of steps.filter((x) => records.has(x.id))) { if (!byKind.has(s.kind)) byKind.set(s.kind, []); byKind.get(s.kind).push(s); }
  const textOf = (v) => (typeof v === 'string' ? v : Array.isArray(v) ? v.map(textOf).join(' ') : '');
  for (const [kind, list] of byKind) {
    out.push('### ' + kind, '');
    for (const s of list) {
      const rec = records.get(s.id) || {};
      const sec = rec.sections || {};
      const body = oneLine(textOf([sec.Body || sec.Description || rec.description, sec.Words, sec.Ask || rec.ask, sec.Gist, rec.goal, rec.state].filter(Boolean)));
      out.push('- ' + s.id + ' ' + oneLine(rec.name || rec.title || rec.focus || '') + ': ' + (body.length > 300 ? body.slice(0, 297) + '...' : body));
    }
    out.push('');
  }
  out.push('## The instruction files, clause by clause', '');
  const section = 'section' in plan ? plan.section : 'CLAUDE.md';
  out.push(section ? 'The AskerDo section goes at the end of ' + section + ', the instruction file Claude reads at the root.' : 'Claude reads no instruction file at the root here, so no AskerDo section is written.', '');
  for (const l of plan.claude || []) for (const c of l.clauses) out.push('- ' + l.path + ' line ' + c.line + ', ' + c.fate + (c.by ? ' by ' + c.by : '') + (c.why ? ' (' + c.why + ')' : '') + ': ' + c.text
    + (c.fate === 'split' ? ' Kept as: ' + oneLine(c.kept) : ''));
  if (!(plan.claude || []).length) out.push('No ledger.');
  out.push('', '## Coverage against the scratch board', '', table(cov), '');
  out.push('## Every folder\'s end state', '');
  for (const g of gates) out.push('- ' + g.path + ': ' + (g.go ? (g.end === 'move' ? 'moves to ' + g.to : g.end === 'retire' ? 'retires with what it loads, deleted, in git' : 'deleted, in git') + ', ' + g.files + ' files'
    + (g.unhook ? ', its entries out of ' + g.unhook.map((u) => u.file + ' (' + u.what + ')').join(', ') : '') + ', one commit' : g.hold ? 'stays (' + g.hold + '): ' + g.why : 'kept: ' + g.why));
  if (!gates.length) out.push('None.');
  if ((plan.edits || []).length) out.push('', 'Edits the session makes by hand on the go:', ...plan.edits.map((e) => '- ' + e.what));
  if (copy) out.push('', ...copyLines(copy));
  if (triggers.length) out.push('', '## Files added to facts the board holds', '', 'Each fact already on the board gains the globs of the `paths:` menu it came from, so a session touching those files is shown it. It changes a record on the real board, so the go runs it.', '', ...triggers.map((w) => '- ' + w));
  if (wouldRun.length) out.push('', '## The doctor\'s fixes', '', 'Each changes a record already on the real board, so the rehearsal runs none of them; the go runs them.', '', ...wouldRun.map((w) => '- ' + w));
  out.push('');
  return out.join('\n');
}

/* does a commit, or a file (with :line), exist in the project */
export function gitHasIn(dir) {
  return (ref) => {
    const r = String(ref || '');
    if (/^[0-9a-f]{7,40}$/i.test(r)) return spawnSync('git', ['cat-file', '-e', r + '^{commit}'], { cwd: dir, windowsHide: true }).status === 0;
    const m = /^(.+?)(?:[:#]L?(\d+))?$/.exec(r);
    try { const text = readFileSync(join(dir, m[1]), 'utf8'); return !m[2] || text.split('\n').length >= Number(m[2]); } catch { return false; }
  };
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
  const readFile = (p) => { try { return readFileSync(join(dir, p), 'utf8'); } catch { return null; } };
  const items = coverItems(plan);
  const readRecord = recordReader({ manifest, show: (ids) => showMany(run, ids, unread(env)), rules: (eff.ok && eff.out && eff.out.rows) || [], readFile,
    cardText: (item) => cardText(cardRow(item, item.target)).text });
  await readRecord.prefetch(items);
  const cov = coverage(items, { manifest, readRecord, readFile, ledger: plan.claude || [], repoint: readJson(t.repoint, null), judged: plan.judged || [], whole: plan.readWhole || [], proved: plan.readNamed || {},
    exists: (p) => existsSync(join(dir, p)), going: (plan.folders || []).filter((f) => f.end === 'move' || GONE.includes(f.end)).map((f) => f.path) });
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
    for (const c of cs) {
      const k = parts.findIndex((p, n) => !used.has(n) && fold(p).includes(fold(c.text).slice(0, 40)));
      if (k < 0) throw new Error(claude.path + ' changed since the survey: line ' + line + ' no longer holds "' + clip(c.text, 60) + '"; run the survey again');
      used.add(k);
      if (gone(c)) now[k] = null;
      else if (c.fate === 'split') now[k] = oneLine(c.kept);
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
/* the repoint, on the go before any move or delete. Only cites in files that stay of files or
   folders that go are rewritten: a converted source's entry or section to its record, a moved path to its new
   one, a deleted one to `<path> (in git at <sha>)`; a cite inside a folder that goes goes with it. `gone`
   names the folders that pass their gate ({ path, end, to }); without it they are read from coverage.json. */
export function repoint(work, { board = 'live', file = null, log = console.log, manifest: held = null, gone = null, dir: at = null, at: to = null } = {}) {
  const t = to || target(work, board);
  const plan = loadPlan(work);
  const dir = at || plan.project.dir;
  const git = gitIn(dir);
  if (git(['rev-parse', '--show-toplevel']).status !== 0) throw new Error(dir + ' is not a git repo: the repoint commits its edits, so it makes none here');
  const manifest = held || readJson(t.manifest, null);
  if (!manifest) throw new Error('no manifest at ' + t.manifest + ': the repoint follows the write');
  const repo = repoState(dir);
  const folders = (gone || gatesOf(plan, readJson(t.coverage, null), repo)).filter((g) => g.go);
  /* a deleted folder's text stays at the commit before its delete; HEAD holds it now, which git show needs */
  const sha = String(git(['rev-parse', 'HEAD']).stdout || '').trim();
  const idmap = readJson(t.idmap, {}) || {};
  for (const g of folders) idmap[g.path + '/'] = g.end === 'move' ? { kind: 'docs', path: g.to + '/', folder: true } : { kind: 'history', sha, folder: true };
  writeJson(t.idmap, idmap);
  const goneOf = (f) => folders.find((g) => under(f, g.path));
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
    const to = !m ? null : m.kind === 'track' ? 'track ' + m.id : m.kind === 'docs' ? m.path : h.of;
    return to ? { to, len: h.form === 'section' ? stemOf(h.of).length : h.match.length, ...(m.kind === 'history' ? { note } : {}) } : null;
  };
  /* a cite of a folder that goes, or of a path inside it no file holds, by its path */
  const folderRes = folders.map((g) => ({ g, re: folderRe(g.path) }));
  const list = file ? [file] : tracked.filter((f) => !goneOf(f));
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
  const judged = citeJudge(plan.cites);
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
  const goingAt = (r) => (r ? folders.find((g) => under(r, g.path)) : null);
  const citesIn = citer(pieces);
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
      if (!k.len || /^(?:[a-z][\w+.-]*:|\/\/)/i.test(k.path)) return null;
      const own = k.path.startsWith('/') ? k.path.slice(1) : resolveFrom(f, k.path);
      const root = /^(?:\/|\.\.\/)/.test(k.path) ? null : k.path.replace(/^\.\//, '');
      const r = goingAt(own) ? own : goingAt(root) ? root : null;
      return r ? { r, own } : null;
    };
    /* a name labelling a link to the same going file stays its label, since the link pass moves or notes the target */
    const labels = (line, at, of) => md && linksIn(line).some((k) => at >= k.start && at < k.at && (linkGoes(k) || {}).r === of);
    /* the rewrite placed: kept as code where no note may go, listed where git never held what the note would name */
    const place = (line, n, at, len, to, of, noted) => {
      const next = placeCite(line, at, len, to, { note: noted ? note : null, md, fenced: fenced.has(n - 1) });
      if (next === null) { keptAsCode(f, n, of, line); return line; }
      if (noted && !inGit(of)) { notInGit(f, n, of, line); return line; }
      return next;
    };
    for (const h of hits.slice().sort((a, b) => b.line - a.line || b.at - a.at)) {
      const line = lines[h.line - 1];
      if (inTarget(line, h.at)) continue;
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
          const { r, own } = linkGoes(k) || {};
          const dot = (s) => (k.path.startsWith('./') && !/^\.\.?\//.test(s) ? './' + s : s);
          if (r) cands.push({ at: k.at, len: k.len, r, link: true, write: (to) => (k.path.startsWith('/') ? '/' + to : dot(r === own ? relFrom(f, to) : to)) });
        }
        for (const m of line.matchAll(UP_PATH)) {
          if (links.some((k) => m.index >= k.at && m.index < k.tEnd)) continue;
          const r = resolveFrom(f, m[0]);
          if (goingAt(r)) cands.push({ at: m.index, len: m[0].length, r, link: false, write: (to) => relFrom(f, to) });
        }
        let next = line;
        for (const c of cands.sort((a, b) => b.at - a.at)) {
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
  let commit = null;
  let refused = null;
  const paths = rewritten.map((x) => x.file);
  if (paths.length) {
    const n = rewritten.reduce((k, x) => k + x.lines, 0);
    const summary = plan.label + ': repoint citations of the retired workflow to the board and to git (' + n + ' lines in ' + paths.length + ' files)';
    const added = gitBatch(git, work, ['add'], paths);
    const r = added.status !== 0 ? added : gitBatch(git, work, ['commit', '-q', '-m', summary], paths);
    if (r.status !== 0) {
      /* the batch goes back as it was (every path here is tracked), and the handover stops on it */
      const a = gitBatch(git, work, ['reset', '-q'], paths);
      const c = gitBatch(git, work, ['checkout', '-q'], paths);
      const left = [a, c].filter((x) => x.status !== 0).map(gitWhy).join('; ');
      refused = { files: paths.length, why: 'git ' + (r === added ? 'add' : 'commit') + ' refused: ' + clip(gitWhy(r), 300) + (left ? '; putting it back failed too: ' + left : '') };
      rewritten.length = 0;
    } else {
      commit = String(git(['rev-parse', 'HEAD']).stdout).trim();
      const imp = manifest.imports.filter((i) => !i.undone).pop();
      if (imp) {
        imp.repo = imp.repo || [];
        for (const p of paths) imp.repo.push({ kind: 'repo', op: 'repoint', path: p, batch: 'repoint', commit, at: new Date().toISOString() });
        writeJson(t.manifest, manifest);
      }
      log(commit.slice(0, 8) + ' ' + summary);
    }
  }
  /* a run on one file keeps what the last run found in the others */
  const prev = file ? readJson(t.repoint, null) : null;
  const keep = (xs) => ((prev && prev[xs]) || []).filter((x) => x.file !== file);
  const out = { commit, ...(refused ? { refused } : {}), sha, rewritten: [...keep('rewritten'), ...rewritten], unresolved: [...keep('unresolved'), ...unresolved], failed: [...keep('failed'), ...failed] };
  writeJson(t.repoint, out);
  for (const x of rewritten) log('  ' + x.file + ': ' + x.lines + ' lines repointed');
  if (unresolved.length) log('Not resolved (' + unresolved.length + '), for the session to reword or leave with the user:\n  '
    + unresolved.map((u) => u.file + ' line ' + u.line + ' (' + (u.code ? 'kept as code: a fence, a glob or a negation' : u.value ? 'a value outside running text, left as it is: the proposal\'s `cites` says note, leave or point'
      : u.missing ? 'git never held it at ' + sha.slice(0, 10) + ', so no note names that commit: left as it is' : u.form)
      + (u.tool ? ', printed by a tool' : '') + '): ' + u.of + (u.ids ? ', it became ' + (u.ids.join(', ') || 'no record') : '')).join('\n  '));
  if (failed.length) log('Left as they were (' + failed.length + '):\n  ' + failed.map((x) => x.file + ': ' + x.why).join('\n  '));
  if (refused) log('The repoint\'s commit: ' + refused.why + '. Its ' + refused.files + ' files are as they were before it.');
  if (psSkipped) log('PowerShell files: not checked: no PowerShell');
  if (!commit && !refused && !unresolved.length && !failed.length) log('No citation left to repoint' + (file ? ' in ' + file : '') + '.');
  return out;
}

/* the map's run for the hashes the handover stamps after its commits, under the write's run id */
export const RESTAMPED = '@handover';
/* the map's file rows on these paths, whichever run put them; a failed read stamps none, as putMap reports */
async function mappedFiles(run, env, dir, paths) {
  let r;
  try { r = await run(['conversion', '--project', dir], { env: unread(env) }); } catch { return []; }
  return ((r.ok && r.out && r.out.rows) || []).filter((x) => x.kind === 'file' && !x.fate && paths.has(x.source));
}

/* the handover, on the go after the rehearsal: the cards and their scan, the CLAUDE.md rewrite,
   the repoint, then each folder that passes its gate moved or deleted in one commit of its own (git rm -r on
   the folder). A refused commit puts its batch back and stops. --file runs only the edits on that path or the
   folder holding it ("ask me per file"). */
export const HANDOVER_BATCHES = ['cards', 'claude', 'repoint', 'moves', 'deletes'];
export async function handover(work, { board = 'live', cli = DEFAULT_CLI, file = null, log = console.log, copy = null } = {}) {
  /* on a rehearsal copy the repo edits land in the copy, with a manifest, id map and repoint file of its own,
     and nothing reaches the board (no card scan, no map rows, no Codex override) */
  const t = copy ? { ...target(work, board), manifest: copy.manifest, idmap: copy.idmap, repoint: copy.repoint } : target(work, board);
  const plan = loadPlan(work);
  const dir = copy ? copy.dir : plan.project.dir;
  const git = gitIn(dir);
  if (git(['rev-parse', '--show-toplevel']).status !== 0) throw new Error(dir + ' is not a git repo: the handover deletes old folders only where git keeps their text, so it makes no edits here');
  const manifest = readJson(t.manifest, null);
  if (!manifest) throw new Error('no manifest at ' + t.manifest + ': the handover follows the write');
  const cov = readJson(t.coverage, null);
  if (!cov) throw new Error('no coverage file at ' + t.coverage + ': run apply.mjs ' + work + ' --coverage' + (board === 'live' ? '' : ' --board ' + board) + ' first');
  const last = manifest.imports.filter((i) => !i.undone).map((i) => i.done || i.at).sort().pop();
  if (last && cov.made < last) throw new Error('the coverage file is older than the last write (' + last + '): run --coverage again');
  const imp = manifest.imports.filter((i) => !i.undone).pop();
  imp.repo = imp.repo || [];
  const env = { ...process.env, ...(t.env || {}) };
  const done = (op, path) => imp.repo.some((e) => e.op === op && e.path === path);
  const mine = (p) => !file || folderKey(file) === folderKey(p) || under(file, p);
  const repo = repoState(dir);
  const dirty = (p) => String(git(['status', '--porcelain', '--', p]).stdout || '').trim().length > 0;
  const skipped = [];
  const held = [];
  const commits = [];
  let stopped = null;
  let override = null;
  let stays = [];
  /* the instruction file the AskerDo section goes in; an older plan names none, so CLAUDE.md */
  const section = 'section' in plan ? plan.section : 'CLAUDE.md';
  const land = (batch, entries, summary, putBack) => {
    if (!entries.length) return null;
    const paths = [...new Set(entries.flatMap((e) => e.paths))];
    const r = gitBatch(git, work, ['commit', '-q', '-m', summary], paths);
    if (r.status !== 0) {
      const left = putBack ? putBack() : null;
      stopped = { batch, files: paths.length, why: 'git commit refused: ' + clip(gitWhy(r), 300) + (left ? '; putting it back failed too: ' + left : '') };
      return null;
    }
    const sha = String(git(['rev-parse', 'HEAD']).stdout).trim();
    for (const e of entries) imp.repo.push({ kind: 'repo', op: e.op, path: e.path, ...(e.item ? { row: e.item } : {}), ...(e.files ? { files: e.files } : {}), ...(e.to ? { to: e.to } : {}), batch, commit: sha, at: new Date().toISOString() });
    commits.push({ batch, commit: sha, summary, files: paths.length });
    writeJson(t.manifest, manifest);
    log(sha.slice(0, 8) + ' ' + summary);
    return sha;
  };
  const restore = (paths) => () => {
    const a = gitBatch(git, work, ['reset', '-q'], paths);
    /* a path HEAD holds (a file, or a folder of tracked files) comes back; one the batch made goes */
    const held = paths.filter((p) => repo.tracked.has(p) || [...repo.tracked].some((x) => under(x, p)));
    for (const p of paths.filter((x) => !held.includes(x))) rmSync(join(dir, p), { force: true });
    const c = held.length ? gitBatch(git, work, ['checkout', '-q'], held) : { status: 0 };
    return [a, c].filter((x) => x.status !== 0).map(gitWhy).join('; ') || null;
  };
  let gates = gatesOf(plan, cov, repo, { goes: mine });
  for (const batch of HANDOVER_BATCHES) {
    if (stopped) break;
    if (batch === 'cards') {
      const entries = [];
      for (const c of (plan.cards || []).filter((x) => mine(x.target) && !done('write', x.target))) {
        const item = (plan.items || []).find((x) => x.id === c.item);
        if (!item) { skipped.push({ path: c.target, why: 'its item ' + c.item + ' is not in the plan' }); continue; }
        if (existsSync(join(dir, c.target)) && dirty(c.target)) { skipped.push({ path: c.target, why: 'it has uncommitted changes' }); continue; }
        const w = writeCard(dir, cardRow(item, c.target));
        /* a card already in the repo as written needs no commit */
        if (!dirty(w.path)) continue;
        git(['add', '--', w.path]);
        entries.push({ op: 'write', path: w.path, item: c.item, paths: [w.path] });
      }
      if (land(batch, entries, plan.label + ': procedure cards from the old how-tos (' + entries.length + ')', restore(entries.map((e) => e.path))) && !copy) {
        const r = await cliRunner(cli)(['proc', 'scan', '--project', dir], { env });
        imp.steps.push({ step: 'proc-scan@handover', op: 'proc scan', kind: KIND['proc scan'], id: r.ok ? 'ok' : null, ...(r.ok ? {} : { why: clip(r.why, 200) }) });
        writeJson(t.manifest, manifest);
        log(r.ok ? 'proc scan --project ' + dir + ': the cards are on the board' : 'proc scan refused: ' + clip(r.why, 200));
      }
    } else if (batch === 'claude') {
      const entries = [];
      const ledgers = (plan.claude || []).map((x) => keptBack(x, gates));
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
        try { text = eolLike(join(dir, l.path), claudeText(was, l, l.path === section ? boardIds(manifest, plan, t.rehearsal ? (readJson(t.results, {})['stand-ins'] || {}).map : undefined, was) : null)); } catch (e) { skipped.push({ path: l.path, why: e.message }); continue; }
        const left = l.path === section ? stateProblems(text.slice(text.lastIndexOf('## AskerDo')), { state: 10240, line: 400 }) : [];
        if (left.length) { skipped.push({ path: l.path, why: 'the board paragraph does not fit: ' + left.join('; ') }); continue; }
        /* a rewrite that changes nothing (a doctor run that moves no clause) has nothing to commit */
        if (text === readFileSync(join(dir, l.path), 'utf8')) continue;
        writeFileSync(join(dir, l.path), text);
        git(['add', '--', l.path]);
        entries.push({ op: 'rewrite', path: l.path, item: 'claude', paths: [l.path] });
      }
      const n = (f) => ledgers.flatMap((l) => l.ledger.clauses).filter((c) => c.fate === f).length;
      land(batch, entries, plan.label + ': ' + (entries.map((e) => e.path).join(', ') || 'the instruction files') + ' point' + (entries.length === 1 ? 's' : '') + ' at the board ('
        + n('carried') + ' clauses moved to rule lines, ' + n('split') + ' split, ' + n('dropped') + ' gone, ' + n('kept') + ' kept)', restore(entries.map((e) => e.path)));
      /* Codex reads the converted AGENTS.md and the rules the write made at once, not at the next session start */
      if (!stopped && !copy && mine('AGENTS.md')) {
        try { override = await refreshAgentsOverride(dir, { env }); } catch (e) { override = { did: 'failed', why: oneLine(e && e.message) }; }
        if (override.did === 'wrote') log((override.created ? 'created ' : 'rewrote ') + override.path + ' for Codex: AGENTS.md\'s text, the rules for agents and the decisions on its files and commands' + (override.left ? ', ' + override.left + ' lines left out for its 32 KiB limit' : ''));
        else if (override.did === 'left' || override.did === 'failed') skipped.push({ path: 'AGENTS.override.md', why: override.did === 'left' ? 'AskerDo did not write it, so it stays as it is' : 'the rules read failed: ' + override.why });
      }
    } else if (batch === 'repoint') {
      /* after the CLAUDE.md rewrite, before any move or delete; a tool's cite it leaves blocks the folder of the file */
      if (!gates.some((g) => g.go)) continue;
      const before = imp.repo.length;
      const rep = repoint(work, { board, file: null, log, manifest, gone: gates, dir, at: t });
      if (rep.refused) { stopped = { batch, ...rep.refused }; break; }
      if (rep.commit && imp.repo.length > before) commits.push({ batch, commit: rep.commit, summary: 'repoint', files: imp.repo.length - before });
      for (const x of rep.failed) skipped.push({ path: x.file, why: 'repoint: ' + x.why });
      repointGaps(cov, rep);
      gates = gatesOf(plan, cov, repoState(dir), { goes: mine });
    } else {
      const end = batch === 'moves' ? 'move' : 'delete';
      /* a loader retires before the folders it reads, so a refused commit never leaves it loading nothing */
      const ours = gates.filter((x) => (end === 'move' ? x.end === 'move' : GONE.includes(x.end)) && mine(x.path)).sort((a, b) => Number(b.end === 'retire') - Number(a.end === 'retire'));
      for (const g of ours) {
        if (stopped) break;
        if (done(end, g.path)) continue;
        if (!g.go) { (g.hold === 'kept' ? held : skipped).push({ path: g.path, why: g.why }); continue; }
        if (end === 'move') {
          mkdirSync(dirname(join(dir, g.to)), { recursive: true });
          const r = git(['mv', '--', g.path, g.to]);
          if (r.status !== 0) { skipped.push({ path: g.path, why: 'git mv refused: ' + gitWhy(r) }); continue; }
          land(batch, [{ op: 'move', path: g.path, to: g.to, files: g.files, paths: [g.path, g.to] }], plan.label + ': ' + unit(g) + ' moves to ' + g.to + (g.file ? '' : '/') + ' (' + g.files + ' files): ' + clip(g.why, 160), () => {
            const a = gitBatch(git, work, ['reset', '-q'], [g.path, g.to]);
            try { renameRetry(join(dir, g.to), join(dir, g.path)); } catch (e) { return 'moving it back: ' + e.message; }
            return a.status !== 0 ? gitWhy(a) : null;
          });
        } else {
          /* the settings entries that run it leave in the same commit; so do the .gitignore lines
             that un-ignore only it */
          let set = [];
          let ign = { files: [], left: [] };
          try { set = unhook(dir, g); ign = unignore(dir, g, repo.tracked, dirty); } catch (e) { restore([...(g.unhook || []).map((u) => u.file), ...ign.files])(); skipped.push({ path: g.path, why: 'its settings entries could not be taken out: ' + oneLine(e.message) }); continue; }
          for (const f of ign.left) skipped.push({ path: f, why: 'its lines un-ignoring ' + unit(g) + ' stay: it has uncommitted changes' });
          const edits = [...set, ...ign.files];
          const added = edits.length ? gitBatch(git, work, ['add'], edits) : { status: 0 };
          const r = added.status !== 0 ? added : gitBatch(git, work, ['rm', '-r', '-q'], [g.path]);
          if (r.status !== 0) { stopped = { batch, files: g.files, why: 'git ' + (r === added ? 'add' : 'rm') + ' refused: ' + clip(gitWhy(r), 300) + ((restore([g.path, ...edits])()) ? '; putting it back failed too' : '') }; break; }
          land(batch, [{ op: 'delete', path: g.path, files: g.files, paths: [g.path, ...edits] }], plan.label + ': ' + unit(g) + (g.end === 'retire' ? ' retires with what it loads' : ' goes') + ', git keeps it (' + g.files + ' files)'
            + (set.length ? ', its entries out of ' + set.join(', ') : '') + (ign.files.length ? ', its un-ignore lines out of ' + ign.files.join(', ') : '') + ': ' + clip(g.why, 160), restore([g.path, ...edits]));
        }
      }
    }
  }
  /* each file the handover rewrote at its new blob and each card's source with its card, so the next run
     reads none of the conversion's own edits as a change; then each folder's end, at the commit that made it */
  const cards = (plan.cards || []).filter((c) => existsSync(join(dir, c.target)))
    .map((c) => ({ source: ((((plan.items || []).find((x) => x.id === c.item) || {}).source) || {}).file, record: c.target, item: c.item })).filter((c) => c.source);
  const own = new Set([...imp.repo.filter((e) => e.op === 'rewrite' || e.op === 'repoint').map((e) => e.path), ...cards.map((c) => c.source)]);
  const restamp = !copy && own.size ? await mappedFiles(cliRunner(cli), env, dir, own) : [];
  const rows = mapRows(plan, imp, { ...mapState(dir, work), cards, restamp, cov });
  /* a single file's end keeps its source row's records, hash and lines, since it takes that row's place */
  const fileRow = (p) => { const r = rows.file.find((x) => x.source === folderKey(p)); return r ? { records: r.records, ...(r.hash ? { hash: r.hash } : {}), ...(r.detail ? { detail: r.detail } : {}) } : {}; };
  const asFile = (p) => repo.tracked.has(folderKey(p));
  const ends = imp.repo.filter((e) => e.op === 'move' || e.op === 'delete').map((e) => ({ source: asFile(e.path) ? folderKey(e.path) : e.path.replace(/\/*$/, '/'), kind: asFile(e.path) ? 'file' : 'folder', fate: e.op, sha: e.commit,
    ...(asFile(e.path) ? fileRow(e.path) : {}),
    why: ((plan.folders || []).find((f) => folderKey(f.path) === folderKey(e.path)) || {}).why || null, ...(e.to ? { detail: { to: e.to } } : {}) }))
    .concat(held.map((h) => ({ source: asFile(h.path) ? folderKey(h.path) : h.path.replace(/\/*$/, '/'), kind: asFile(h.path) ? 'file' : 'folder', fate: 'keep', why: h.why, ...(asFile(h.path) ? fileRow(h.path) : {}) })));
  const files = rows.file.filter((r) => own.has(r.source) && !ends.some((e) => e.source === r.source));
  /* the new hashes ride a run of their own, so the undo gives back each row as the write or an earlier run left it */
  if (!copy && files.length) await putMap(cliRunner(cli), env, dir, plan.made + RESTAMPED, { file: files }, log);
  if (!copy && ends.length) await putMap(cliRunner(cli), env, dir, plan.made, { folder: ends }, log);
  if (skipped.length) log('Skipped (' + skipped.length + '), each left as it is:\n  ' + skipped.map((s) => s.path + ': ' + s.why).join('\n  '));
  if (held.length) log('Folders that stay (' + held.length + '); tell the user:\n  ' + held.map((s) => s.path + ': ' + s.why).join('\n  '));
  if (stopped) log('Stopped at the ' + stopped.batch + ' batch: ' + stopped.why + '. Its ' + stopped.files + ' files are as they were before it; each commit before it is in the manifest. Fix the cause and run --handover again.');
  else if (!commits.length && !skipped.length && !held.length) log('Nothing left to hand over' + (file ? ' on ' + file : '') + '.');
  /* the real tree against the copy the fresh reader read */
  const diff = copy ? null : againstCopy(work, dir, plan, log);
  return { commits, skipped, held, ...(stays.length ? { stays } : {}), ...(override ? { override } : {}), ...(stopped ? { stopped } : {}), ...(diff ? { diff } : {}) };
}

/* before the go, the handover on a copy of the repo against the scratch board, so the fresh
   reader reads the project as a new session would start in it, never the proposal. The copy is the working tree as
   it stands (uncommitted and untracked files, the ignored CLAUDE.local.md and settings.local.json) with the repo's
   line ends; its commits stay in the copy. */
/* an earlier rehearsal's copy, reader file and copy.json, so no fresh reader reads a copy the board no longer matches */
function dropCopy(work, t) {
  const base = t.manifest.replace(/-manifest[.]json$/, '');
  const before = readJson(join(dirname(base), 'copy.json'), null);
  if (!before || !before.dir || resolve(dirname(before.dir)) !== resolve(dirname(base))) return;
  rmSync(before.dir, { recursive: true, force: true, maxRetries: 3 });
  if (before.reader) rmSync(before.reader, { force: true });
  rmSync(join(dirname(base), 'copy.json'), { force: true });
}
export async function rehearseHandover(work, { board, cli = DEFAULT_CLI, log = console.log } = {}) {
  const t = target(work, board);
  if (!t || !t.rehearsal) throw new Error('the copy is a rehearsal\'s: --board file:<db>');
  const plan = loadPlan(work);
  const real = plan.project.dir;
  const git = gitIn(real);
  if (git(['rev-parse', '--show-toplevel']).status !== 0) { log('No copy for the fresh reader: ' + real + ' is not a git repo, so the handover makes no edits there'); return null; }
  const manifest = readJson(t.manifest, null);
  if (!manifest) throw new Error('no manifest at ' + t.manifest + ': the copy follows the rehearsal write');
  const base = t.manifest.replace(/-manifest\.json$/, '');
  const copy = { dir: base + '-copy', manifest: base + '-copy-manifest.json', idmap: base + '-copy-idmap.json', repoint: base + '-copy-repoint.json' };
  /* one copy at a time: an earlier rehearsal's goes with this one's */
  const before = readJson(join(dirname(base), 'copy.json'), null);
  for (const d of new Set([copy.dir, ...(before && before.dir && resolve(dirname(before.dir)) === resolve(dirname(copy.dir)) ? [before.dir] : [])])) rmSync(d, { recursive: true, force: true, maxRetries: 3 });
  const conf = (k) => String(git(['config', '--get', k]).stdout || '').trim();
  /* the copy's commits are scratch: never signed, never the project's hooks */
  const cfg = [['core.autocrlf', conf('core.autocrlf')], ['core.eol', conf('core.eol')], ['user.name', conf('user.name') || 'AskerDo rehearsal'],
    ['user.email', conf('user.email') || 'rehearsal@askerdo.invalid'], ['commit.gpgsign', 'false']].filter(([, v]) => v).flatMap(([k, v]) => ['-c', k + '=' + v]);
  const c = spawnSync('git', ['clone', '-q', '--shared', ...cfg, real, copy.dir], { encoding: 'utf8', windowsHide: true, env: { ...process.env, GIT_LFS_SKIP_SMUDGE: '1' } });
  if (c.status !== 0) { log('No copy for the fresh reader: git clone refused: ' + clip(gitWhy(c), 300)); return null; }
  const repo = repoState(real);
  const ignored = String(git(['ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--', ':(glob)**/CLAUDE.local.md', '.claude/settings.local.json']).stdout || '').split('\0').filter(Boolean);
  for (const f of [...repo.changed, ...repo.untracked, ...ignored]) {
    const from = join(real, f);
    const to = join(copy.dir, f);
    if (existsSync(from)) { mkdirSync(dirname(to), { recursive: true }); copyFileSync(from, to); } else rmSync(to, { recursive: true, force: true });
  }
  for (const i of manifest.imports) delete i.repo;
  writeJson(copy.manifest, manifest);
  writeJson(copy.idmap, readJson(t.idmap, {}) || {});
  rmSync(copy.repoint, { force: true });
  const h = await handover(work, { board, cli, log: () => {}, copy });
  const view = readerView(copy.dir, plan, { board: t.name, env: t.env, cli, handed: h });
  const reader = base + '-reader.md';
  writeFileSync(reader, view.text);
  const out = { dir: copy.dir, board: t.name, reader, made: new Date().toISOString(), commits: h.commits.map((x) => ({ batch: x.batch, summary: x.summary, files: x.files })),
    held: h.held, ...(h.stays ? { stays: h.stays } : {}), skipped: h.skipped, ...(h.stopped ? { stopped: h.stopped } : {}), loads: view.loads, top: view.top, kept: view.kept };
  writeJson(join(dirname(base), 'copy.json'), out);
  log('The handover on a copy, for the fresh reader: ' + h.commits.length + ' commits in ' + copy.dir + (h.held.length ? ', ' + h.held.length + ' folders stay' : '')
    + (h.stays ? ', ' + h.stays.length + ' instruction clauses stay with what they load' : '')
    + (h.stopped ? ', stopped at the ' + h.stopped.batch + ' batch' : '') + '; what it reads: ' + reader);
  return out;
}

/* What the fresh reader is pointed at: the copy, the scratch board, what a session starting there loads (the
   instruction files Claude reads, what is left under .claude/, what the settings run), the top folders, and each
   kept folder with its why and README. */
const README = /^(?:readme|index|_index)\.(?:md|markdown|txt)$/i;
const n = (k, w) => k + ' ' + w + (k === 1 ? '' : 's');
export function readerView(dir, plan, { board = null, env = null, cli = DEFAULT_CLI, handed = null } = {}) {
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
  const top = [...counts].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([path, n]) => ({ path, ...(path.endsWith('/') ? { files: n } : {}) }));
  const stays = [...((handed && handed.held) || []), ...((handed && handed.skipped) || [])];
  const kept = (plan.folders || []).filter((f) => f.end === 'keep' || stays.some((s) => folderKey(s.path) === folderKey(f.path))).map((f) => {
    const p = folderKey(f.path);
    const s = stays.find((x) => folderKey(x.path) === p);
    const readme = files.find((x) => x.startsWith(p + '/') && !x.slice(p.length + 1).includes('/') && README.test(x.slice(p.length + 1)));
    return { path: f.path, end: f.end, why: s ? 'it stays: ' + s.why : f.why || '', ...(f.shape ? { shape: f.shape } : {}), files: files.filter((x) => under(x, p)).length, ...(readme ? { readme } : {}) };
  });
  const seams = env ? Object.entries(env).map(([k, v]) => k + '=' + v).join(' ') + ' ' : '';
  const text = ['# What the fresh reader reads: ' + (plan.label || 'the conversion'), '',
    'The project as a new session would start in it after the handover, which ran on a copy of the repo against the scratch board. Read the copy and search the board; nothing else (never the proposal or rehearsal.md).', '',
    '- Your brief: ' + join(dirname(fileURLToPath(import.meta.url)), 'fresh-reader.md').replace(/\\/g, '/'),
    '- The copy: ' + dir, '- The board: `' + seams + 'node ' + cli + ' <verb>`' + (board && !seams ? ' (' + board + ')' : '') + '; it knows the project as ' + plan.project.dir, '',
    '## What a session here loads', '',
    ...loads.instructions.map((x) => '- ' + x.file + ': ' + (x.read === 'start' ? 'read at the start' : x.read === 'nested' ? 'read when a session works in its folder' : 'not read (' + (x.why || 'no') + ')')),
    ...loads.claude.map((x) => '- ' + x.file + ' (' + x.kind + (x.paths ? ', on paths ' + x.paths.join(', ') : '') + ')'),
    ...loads.runs.map((x) => '- ' + x.file + ' runs `' + x.command + '` (' + x.what + ')'),
    ...(loads.instructions.length + loads.claude.length + loads.runs.length ? [] : ['Nothing.']), '',
    '## The top folders', '', ...top.map((x) => '- ' + x.path + (x.files ? ' (' + n(x.files, 'file') + ')' : '')), '',
    '## Kept folders, with why', '', ...kept.map((k) => '- ' + k.path + ': ' + k.why + (k.shape ? ' (' + k.shape + ')' : '') + '; ' + n(k.files, 'file') + (k.readme ? '; read ' + k.readme : '')),
    ...(kept.length ? [] : ['None.']), ''].join('\n');
  return { text, loads, top, kept };
}

/* the report's account of the copy */
function copyLines(copy) {
  const out = ['## The handover on a copy', '', 'The handover ran on a copy of the repo against this scratch board, before any go: ' + copy.commits.length + ' commits in ' + copy.dir + '.'
    + ' The fresh reader reads that copy as a new session would start in it, pointed at it by ' + copy.reader + '; after the go, the handover compares the real tree with it.', ''];
  for (const x of copy.commits) out.push('- ' + x.batch + ': ' + x.summary);
  for (const x of copy.held || []) out.push('- stays: ' + x.path + ': ' + x.why);
  for (const x of copy.skipped || []) out.push('- skipped: ' + x.path + ': ' + x.why);
  if (copy.stopped) out.push('- stopped at the ' + copy.stopped.batch + ' batch: ' + copy.stopped.why);
  return out;
}

/* the real tree after the handover against the copy the fresh reader read. A path is the same
   when its blob is, or its text is once board ids and commit hashes are masked (the two boards and histories differ). */
function treeOf(dir) {
  const git = gitIn(dir);
  const out = new Map();
  for (const l of String(git(['ls-files', '-s', '-z']).stdout || '').split('\0')) { const m = /^\d+ ([0-9a-f]+) 0\t(.+)$/s.exec(l); if (m) out.set(m[2], m[1]); }
  const { changed, untracked } = repoState(dir);
  for (const f of changed) if (!existsSync(join(dir, f))) out.delete(f);
  const loose = [...changed, ...untracked].filter((f) => { try { return statSync(join(dir, f)).isFile(); } catch { return false; } });
  if (loose.length) {
    const h = String(git(['hash-object', '--stdin-paths'], loose.join('\n') + '\n').stdout || '').trim().split('\n');
    loose.forEach((f, i) => out.set(f, h[i]));
  }
  return out;
}
const MASK = /\b(?:WS|TR|T|K|P)-\d+(?:\.\d+)?\b|\bQ\d+\b|\b[0-9a-f]{7,40}\b/g;
const maskedText = (p) => { try { if (statSync(p).size > 2 << 20) return null; } catch { return null; } const t = readText(p); return t === null ? null : t.replace(MASK, '#'); };
export function treeDiff(real, copy) {
  const a = treeOf(real);
  const b = treeOf(copy);
  const here = [];
  const gone = [];
  const changed = [];
  for (const [f, h] of a) {
    if (!b.has(f)) { here.push(f); continue; }
    if (b.get(f) === h) continue;
    const x = maskedText(join(real, f));
    if (x === null || x !== maskedText(join(copy, f))) changed.push(f);
  }
  for (const f of b.keys()) if (!a.has(f)) gone.push(f);
  return { here, gone, changed };
}
/* paths named by the plan's folder they sit in, the rest one by one */
function byUnit(paths, units) {
  const out = [];
  let rest = paths;
  for (const u of units) {
    const of = rest.filter((p) => under(p, u));
    if (!of.length) continue;
    out.push(of.length === 1 && of[0] === u ? u : u + '/ (' + of.length + ' files)');
    rest = rest.filter((p) => !under(p, u));
  }
  return [...out, ...rest.slice(0, 8), ...(rest.length > 8 ? ['and ' + (rest.length - 8) + ' more'] : [])];
}
function againstCopy(work, dir, plan, log) {
  const rec = readJson(join(work, 'rehearsal', 'copy.json'), null);
  if (!rec || !existsSync(rec.dir)) { log('No rehearsal copy to compare with: the fresh reader reads the real tree before the run is recorded.'); return { copy: null, rerun: true }; }
  const d = treeDiff(dir, rec.dir);
  const units = (plan.folders || []).map((f) => folderKey(f.path)).filter(Boolean);
  const out = { copy: rec.dir, reader: rec.reader, here: byUnit(d.here, units), gone: byUnit(d.gone, units), changed: byUnit(d.changed, units) };
  out.rerun = Boolean(d.here.length || d.gone.length || d.changed.length);
  writeJson(join(work, 'handover-diff.json'), out);
  log(!out.rerun ? 'The real tree matches the rehearsal copy the fresh reader read (' + rec.dir + ').'
    : 'The real tree differs from the rehearsal copy the fresh reader read (' + rec.dir + '): ' + [out.here.length ? 'still here, gone in the copy: ' + out.here.join(', ') : null,
      out.gone.length ? 'gone here, still in the copy: ' + out.gone.join(', ') : null, out.changed.length ? 'not as in the copy: ' + out.changed.join(', ') : null].filter(Boolean).join('; ')
      + '. The fresh reader runs again on the real tree before the run is recorded.');
  return out;
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

/* a decision leaves only by a withdraw the user allows: an import's decisions in one request, so one press */
export function withdrawInput(ids, label) {
  return { kind: 'withdraw', summary: 'Withdraw the ' + ids.length + ' decision' + (ids.length === 1 ? '' : 's') + ' the ' + label + ' import wrote: the import was undone',
    reason: 'written by the ' + label + ' import, which was undone: the board never ruled them; the project\'s old record still holds them', items: ids.map((record) => ({ record })) };
}

export async function undoImport(work, { board, cli = DEFAULT_CLI, all = false, session, dry: asked = false, log = console.log } = {}) {
  const t = target(work, board || 'live');
  const manifest = readJson(t.manifest, null);
  if (!manifest || !manifest.imports.length) throw new Error('no manifest at ' + t.manifest + ': nothing was written there');
  const imps = manifest.imports.filter((i) => !i.undone);
  const pick = all ? imps : imps.slice(-1);
  const env = { ...process.env, ...t.env };
  /* --dry reads the manifest of the board it is given, a rehearsal's included */
  const dry = !board || asked;
  const rulings = pick.flatMap((i) => i.steps).filter((s) => s.kind === 'decision' && !s.undoneAt);
  if (!dry && rulings.length && !session) throw new Error('the undo files a withdraw request for its ' + rulings.length + ' decisions, which takes --session <own id>');
  const run = dry ? null : cliRunner(cli);
  log((dry ? 'Dry run of the undo' : 'Undo on ' + t.name) + ': ' + pick.length + ' import(s) of ' + manifest.label);
  const kept = [];
  const finished = [];
  const filed = [];
  const failed = [];
  const stays = [];
  const waiting = [];
  /* an undone run's rows leave the map, so the next run reads those sources again */
  const mapDir = manifest.project && manifest.project.dir;
  if (rulings.length && dry) log('  askerdo override request --kind withdraw --session <own id>, its ' + rulings.length + ' decisions on stdin: ' + rulings.map((s) => s.id).join(', '));
  else if (rulings.length) {
    /* one already withdrawn is done; one a record outside the import superseded is no longer in force, so it stays */
    const recs = await showMany(run, rulings.map((s) => s.id), unread(env));
    const ids = new Set(rulings.map((s) => s.id));
    const now = new Date().toISOString();
    const ask = [];
    rulings.forEach((s, i) => {
      const r = recs[i];
      if (!r) { failed.push('decision ' + s.id + ': the board could not show it'); return; }
      if (r.status === 'withdrawn') { s.undoneAt = now; return; }
      if (r.status === 'superseded' && !ids.has(r.supersededBy)) { stays.push('decision ' + s.id + ' (superseded by ' + r.supersededBy + ')'); Object.assign(s, { undoneAt: now, stays: true }); return; }
      ask.push(s);
    });
    if (ask.length) {
      /* a decision leaves only on the user's Allow, so a filed request leaves the import open; asked again, the
         board refuses while it waits (naming it) or once the user kept them, and files an expired one anew */
      const before = [...new Set(ask.map((s) => s.withdrawRequest).filter(Boolean))];
      const r = await run(['override', 'request', '--session', session], { stdin: JSON.stringify(withdrawInput(ask.map((s) => s.id), manifest.label)), env });
      if (r.ok) {
        for (const s of ask) s.withdrawRequest = r.out && r.out.request;
        filed.push('#' + (r.out && r.out.request) + ' (' + ask.length + ' decisions)');
      } else if (before.length && /\bkept\b/i.test(r.why)) {
        for (const s of ask) Object.assign(s, { undoneAt: now, stays: true, kept: true });
        stays.push(...ask.map((s) => 'decision ' + s.id + ' (the user kept it)'));
      } else if (before.some((n) => r.why.includes('#' + n))) waiting.push('#' + before.join(', #') + ' (' + ask.length + ' decisions)');
      else failed.push('the withdraw request for ' + ask.length + ' decisions: ' + clip(r.why, 300));
    }
  }
  for (const imp of pick.reverse()) {
    let clean = true;
    for (const s of imp.steps.slice().reverse()) {
      if (s.undoneAt) continue;
      if (s.kind === 'knowledge') { kept.push(s.id); continue; }
      /* settled above, in the one request */
      if (s.kind === 'decision') { if (!dry) clean = false; continue; }
      /* every undo verb takes --session only to name who undid it */
      /* a reconcile's ref stays while its amend does (no verb takes one back): the redo's plan reads it as done */
      const amended = s.fix && imp.steps.some((x) => x.step === s.step + '@amend' && x.fix && !x.undo);
      if (s.fix && (!s.undo || amended)) { stays.push(s.kind + ' ' + s.id); continue; }
      /* an undo back to the inbox wakes 14 days from the undo */
      const args = s.undo && [...s.undo.map((a) => (a === '@{' + WAKE_REF + '}' ? wakeIn() : a)), ...(session ? ['--session', session] : [])];
      if (!args) continue;
      if (dry) { log('  askerdo ' + args.map(shq).join(' ')); continue; }
      const r = await run(args, { env });
      /* no verb takes back a finished track: it stays finished, its tasks dropped above */
      if (!r.ok && s.kind === 'track' && /is already (done|dropped)/.test(r.why)) { if (/done/.test(r.why)) { finished.push(s.id); s.stays = true; } s.undoneAt = new Date().toISOString(); continue; }
      if (!r.ok) { clean = false; failed.push(s.kind + ' ' + s.id + ': ' + clip(r.why, 200)); continue; }
      s.undoneAt = new Date().toISOString();
    }
    if (!dry && clean) {
      imp.undone = new Date().toISOString();
      /* its folder ends go with the run: the reverts it prints bring the folders back, and a redo's handover sets them again.
         a source whose records all stand (knowledge, kept decisions) stays converted, so a rerun reads it unchanged */
      const keep = mapDir ? await standing(run, env, mapDir, imp, manifest.imports.filter((o) => o !== imp)) : [];
      /* the handover's new hashes first, which the reverts take back, then the write's rows */
      for (const [id, k] of [[imp.plan + RESTAMPED, []], [imp.plan, keep]]) {
        const r = mapDir ? await run(['conversion', 'drop', '--project', mapDir, '--run', id, ...(k.length ? ['--keep', k.join(',')] : [])], { env }) : { ok: true };
        if (!r.ok) failed.push('the conversion map rows of ' + id + ': ' + clip(r.why, 200));
      }
    } else if (dry && mapDir) for (const id of [imp.plan + RESTAMPED, imp.plan]) log('  askerdo conversion drop --project ' + shq(mapDir) + ' --run ' + id);
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
    try { override = await refreshAgentsOverride(mapDir, { env, agents: agentsBefore(mapDir, pick) }); } catch (e) { override = { did: 'failed', why: oneLine(e && e.message) }; }
    if (override.did === 'wrote') log('Rewrote ' + override.path + ' for Codex from the rules and decisions left on the board');
    else if (override.did === 'failed') log('AGENTS.override.md was not rewritten (the rules read failed: ' + override.why + '); a Claude session started in the project rewrites it');
  }
  if (failed.length) log('Refused (' + failed.length + '), run the undo again once each is fixed:\n  ' + failed.join('\n  '));
  if (filed.length || waiting.length) log('Withdraw request ' + (filed.length ? 'filed, waiting' : 'still waiting') + ' on the user\'s one Allow or Keep: ' + [...filed, ...waiting].join(', ')
    + '. The import reads undone only once it is decided: run the undo again after the press.');
  else if (dry && rulings.length) log('The ' + rulings.length + ' decisions leave only by a withdraw the user allows: the undo files one request for them all (--session <own id>).');
  if (finished.length) log('Finished tracks stay finished, with their handoffs (no verb takes one back; their tasks are dropped): ' + finished.join(', '));
  if (stays.length) log('Stay as they are (' + stays.length + '), fixes no verb takes back and decisions a later record superseded: ' + stays.join(', '));
  if (kept.length) log('Knowledge records stay (' + kept.length + '): a withdraw takes only decisions and no verb removes one: ' + kept.join(', '));
  /* the handover's repo commits, one per folder: named, newest first, never reverted without the user's word */
  const repo = pick.flatMap((i) => (i.repo || []).map((e, k) => ({ ...e, k }))).filter((e) => e.commit);
  const shas = [...new Set(repo.sort((a, b) => String(b.at).localeCompare(String(a.at)) || b.k - a.k).map((e) => e.commit))];
  if (shas.length) log('The handover\'s repo commits, newest first: revert each with git once the user says so (the undo runs none):\n  ' + shas.map((c) => 'git revert ' + c).join('\n  '));
  log('Handoffs go with their dropped tracks. Procedure cards stay: they follow their docs/procedures files, so they go when those files do.');
  return { failed, kept, finished, filed, waiting, stays, ...(override ? { override } : {}) };
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
  const back = new Set(imp.steps.filter((s) => s.undoneAt && !s.stays && s.kind !== 'knowledge' && s.id).map((s) => s.id));
  /* a card the handover wrote goes with the printed reverts, so the source it came from is read again */
  for (const e of imp.repo || []) if (e.op === 'write') back.add(e.path);
  const theirs = new Set(others.flatMap((o) => [...o.steps.map((s) => s.id), ...(o.repo || []).filter((e) => e.op === 'write').map((e) => e.path)]).filter(Boolean));
  const r = await run(['conversion', '--project', dir], { env: unread(env) });
  const rows = ((r.ok && r.out && r.out.rows) || []).filter((x) => (x.run === imp.plan || x.run === imp.plan + RESTAMPED) && (x.kind === 'file' || x.kind === 'folder') && !x.fate
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
  const board = flag('board'); const cli = flag('cli') || DEFAULT_CLI; const session = flag('session'); const undo = bool('undo'); const all = bool('all');
  const cover = bool('coverage'); const hand = bool('handover'); const only = flag('file'); const point = bool('repoint'); const dry = bool('dry');
  if (!a[0] || a[0] === '--help') { console.log(USAGE); process.exit(a[0] ? 0 : 1); }
  try {
    /* the repoint needs no CLI: it reads the work folder and edits the repo */
    if (point) { const r = repoint(a[0], { board: board || 'live', file: only || null }); process.exit(r.refused ? 1 : r.failed.length || r.unresolved.some((u) => u.tool) ? 2 : 0); }
  } catch (e) { console.error('apply: ' + e.message); process.exit(1); }
  if (!existsSync(cli)) { console.error('apply: no CLI at ' + cli); process.exit(1); }
  try {
    if (cover) { const c = await runCoverage(a[0], { board: board || 'live', cli }); process.exit(c.sources.some((s) => s.blocked) || (c.claude || []).some((x) => x.blocked) ? 2 : 0); }
    if (hand) { const h = await handover(a[0], { board: board || 'live', cli, file: only || null }); process.exit(h.stopped ? 1 : h.skipped.some((s) => !s.expected) ? 2 : 0); }
    /* the live write runs in one child, so this process's loop is free to renew the pause while it runs */
    if (!undo && board === 'live' && !process.env[PAUSE_HELD]) process.exit(await quietWrite(writeInChild));
    const r = undo ? await undoImport(a[0], { board, cli, all, session, dry }) : await applyPlan(a[0], { board, cli });
    process.exit(r.stopped || (r.failed && r.failed.length) ? 1 : 0);
  } catch (e) { console.error('apply: ' + e.message); process.exit(1); }
}
