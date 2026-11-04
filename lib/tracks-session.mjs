/* Tracks in the session, the PC half:
   the handoff payload check, the verify-first git checks on the PC that owns the
   repos, and the loose-file lists kept here in the data dir, one file per
   handoff label; only each repo's summary goes to the board through boardCall.
   No process start-up and no argv, so the local server can run it as it is; git
   runs off its event loop. */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { boardCall, boardUrl } from './board-call.mjs';
import { dataDir, pluginRoot, pluginVersion, replacedCopy, sandboxHome, storeRoot } from './node-helpers.mjs';
import { handoffProblems, leavesLine, reviewLine, updateProblems } from './handoff-payload.mjs';
import { staleToolsLine } from '../server/handoff-text.mjs';
import { checkHandoffDir } from './handoff-check.mjs';
import { backfillCommits, baselineOf, handoffRepoGrowth } from './growth.mjs';
import { LINK_VERB } from './commit-capture.mjs';
import { UsageError } from '../server/verbs/labels.mjs';
import { CLI, readLine } from '../server/verbs/kickoff.mjs';
import { folderHere, unmappedLine } from './project-map.mjs';
import {
  checkSnapshotAsync, filesKickoff, gitAsync as git, newFilesText, readKept as keptDispositions, settleFiles,
  snapshotRepoAsync, storeHandoffFiles, under, validateFiles,
} from './loose-files.mjs';

const PAYLOAD_KEYS = ['focus', 'state', 'whereWeWere', 'waitingOnUser', 'rulings', 'verifyFirst', 'fromSession', 'session',
  'depthAtHandoff', 'status', 'parkReason', 'created', 'leftovers'];
const VERIFY_KEYS = ['path', 'branch', 'worktree', 'commit', 'expectedDirty', 'ownedByOthers', 'files'];
const LIVE = ['waiting', 'parked'];
const STAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/;
export const HANDOFF_DIR = 'handoffs';

/* this PC as the board names it, the device its token carries, which the
   local board learns from its own sessions' rows; the hostname until one is known */
export function pcName(env = process.env) {
  try {
    const p = JSON.parse(readFileSync(join(storeRoot(undefined, env), 'board', 'sessions.json'), 'utf8'));
    const url = boardUrl(env).replace(/\/+$/, '');
    if (p && typeof p.pc === 'string' && p.pc && url && String(p.board).replace(/\/+$/, '') === url) return p.pc;
  } catch {}
  return hostname();
}

const text = (v) => typeof v === 'string' && v.trim() !== '';
const slashed = (p) => String(p || '').replace(/\\/g, '/').replace(/(.)\/+$/, '$1');
const guardHeadings = (t) => String(t).split('\n').map((l) => (/^#/.test(l) ? ' ' + l : l)).join('\n');

function strList(raw, key) {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.some((s) => !text(s))) throw new UsageError(key + ' must be an array of non-empty strings');
  return raw.map((s) => s.trim());
}

function refuseUnknown(raw, keys, what) {
  /* a replaced copy is not the installed one, so its own version is not named as such */
  const installed = () => { if (replacedCopy()) return ''; try { return pluginVersion(); } catch { return ''; } };
  for (const k of Object.keys(raw)) {
    if (!keys.includes(k)) throw new UsageError(what + ' does not take ' + k + ' (it takes ' + keys.join(', ') + '); ' + staleToolsLine(installed()));
  }
}

/* A handoff payload checked and normalised, with no plan step and no task in
   hand: the track's tasks carry where it stands. */
export function validateHandoffPayload(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new UsageError('handoff payload must be a JSON object');
  refuseUnknown(raw, PAYLOAD_KEYS, 'handoff write');
  const problems = handoffProblems(raw);
  if (problems.length) throw new UsageError(problems.join('; '));
  if (raw.fromSession !== undefined && raw.session !== undefined && raw.fromSession !== raw.session) throw new UsageError('fromSession and session disagree; pass one');
  const status = raw.status === undefined ? 'waiting' : raw.status;
  if (!LIVE.includes(status)) throw new UsageError('a new handoff is waiting or parked');
  const parkReason = text(raw.parkReason) ? raw.parkReason.trim() : undefined;
  if (status === 'parked' && !parkReason) throw new UsageError('a parked handoff needs a parkReason');
  if (status === 'waiting' && parkReason) throw new UsageError('parkReason belongs to a parked handoff');
  if (raw.created !== undefined && !STAMP_RE.test(String(raw.created))) throw new UsageError('created must be a full local timestamp (YYYY-MM-DDTHH:MM:SS+HH:MM)');
  const d = raw.depthAtHandoff;
  let depth;
  if (d !== undefined) {
    if (!d || typeof d !== 'object' || Array.isArray(d)) throw new UsageError('depthAtHandoff must be an object');
    refuseUnknown(d, ['tokens', 'percent'], 'depthAtHandoff');
    if (d.tokens !== undefined && !(Number.isSafeInteger(d.tokens) && d.tokens >= 0)) throw new UsageError('depthAtHandoff.tokens must be a whole number of at least 0');
    if (d.percent !== undefined && !(typeof d.percent === 'number' && d.percent >= 0 && d.percent <= 100)) throw new UsageError('depthAtHandoff.percent must be a number from 0 to 100');
    depth = { ...(d.tokens !== undefined ? { tokens: d.tokens } : {}), ...(d.percent !== undefined ? { percent: Math.round(d.percent) } : {}) };
  }
  const where = text(raw.whereWeWere) ? raw.whereWeWere.trim() : undefined;
  return {
    focus: raw.focus.trim(), state: raw.state.trim(),
    /* the export writes it under its own heading, so a heading inside it is guarded */
    whereWeWere: where ? guardHeadings(where) : undefined,
    waitingOnUser: strList(raw.waitingOnUser, 'waitingOnUser'),
    rulings: (raw.rulings || []).map((r) => (typeof r === 'string' ? r.trim()
      : { ...(r.id ? { id: r.id.trim() } : { text: r.text.trim() }), registered: r.registered.trim() })),
    verifyFirst: validateVerify(raw.verifyFirst),
    fromSession: text(raw.fromSession ?? raw.session) ? String(raw.fromSession ?? raw.session).trim() : undefined,
    status, parkReason, depth, created: raw.created,
    /* the steps left, laid out on the track by the board */
    leftovers: Array.isArray(raw.leftovers) && raw.leftovers.length ? raw.leftovers : undefined,
  };
}

function validateVerify(raw) {
  return raw.map((e, i) => {
    const at = 'verifyFirst[' + i + ']';
    refuseUnknown(e, VERIFY_KEYS, at);
    const out = { path: slashed(e.path.trim()) };
    for (const k of ['branch', 'worktree']) {
      if (e[k] === undefined) continue;
      if (!text(e[k])) throw new UsageError(at + '.' + k + ' must be a non-empty string when present');
      out[k] = k === 'worktree' ? slashed(e[k].trim()) : e[k].trim();
    }
    if (e.commit !== undefined) {
      if (!text(e.commit) || !/^[0-9a-f]{7,64}$/i.test(e.commit.trim())) throw new UsageError(at + '.commit must be a commit hash');
      out.commit = e.commit.trim();
    }
    out.expectedDirty = strList(e.expectedDirty, at + '.expectedDirty');
    out.ownedByOthers = strList(e.ownedByOthers, at + '.ownedByOthers');
    const files = validateFiles(e.files, at + '.files', (m) => new UsageError(m));
    if (files) out.files = files;
    return out;
  });
}

/* ---- git, on the PC that owns the repos ------------------------------------ */

/* The checks verify-first makes without the lists: the repo reads, the branch
   and the worktree are where the handoff says. `top` is the checkout's root
   when the caller read it already. */
async function placeProblems(e, top) {
  if ((top === undefined ? await git(e.path, ['rev-parse', '--show-toplevel']) : top) === null) return ['not a readable git repo'];
  const problems = [];
  if (e.branch) {
    const b = await git(e.path, ['rev-parse', '--abbrev-ref', 'HEAD']);
    if (b !== e.branch) problems.push('on branch ' + (b || 'unknown') + ', the handoff says ' + e.branch);
  }
  if (e.worktree && /^([A-Za-z]:)?\//.test(e.worktree) && !existsSync(e.worktree)) problems.push('worktree ' + e.worktree + ' is missing');
  return problems;
}

const dayOf = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const clockOf = (opts) => {
  const v = typeof opts.now === 'function' ? opts.now() : opts.now;
  return v === undefined || v === null ? new Date() : v instanceof Date ? v : new Date(v);
};

/* a path other work owns is theirs to decide, so it is no loose file of this handoff */
const ownedOf = (e) => (Array.isArray(e.ownedByOthers) ? e.ownedByOthers : []).map((d) => String(d).split(String.fromCharCode(92)).join('/'));

/* Each repo filled in and snapshotted, its untracked entries given dispositions
   (the payload's, else the ones kept here for that repo, else undecided); the
   board gets the summary alone. */
export async function runVerifyFirst(entries, { dir, now = new Date() } = {}) {
  const day = dayOf(now);
  const summary = [];
  const unmatched = [];
  for (const e of entries) {
    const top = await git(e.path, ['rev-parse', '--show-toplevel']);
    if (top !== null && !e.commit) { const c = await git(e.path, ['rev-parse', 'HEAD']); if (c) e.commit = c; }
    if (top !== null && !e.branch) { const b = await git(e.path, ['rev-parse', '--abbrev-ref', 'HEAD']); if (b) e.branch = b; }
    const problems = await placeProblems(e, top);
    const snap = top === null ? null : await snapshotRepoAsync(e.path);
    if (snap) {
      e.snapshot = snap;
      const r = settleFiles(e, e.files, dir ? keptDispositions(dir, e.path) : [], day, now.getTime(), top);
      e.files = r.files.filter((f) => !under(f.path, ownedOf(e)));
      unmatched.push(...r.unmatched.map((f) => e.path + ': ' + f));
    } else delete e.files;
    summary.push({ path: e.path, ...(e.branch ? { branch: e.branch } : {}), ...(e.worktree ? { worktree: e.worktree } : {}),
      ...(e.commit ? { commit: e.commit } : {}), ok: !problems.length, ...(problems.length ? { problems } : {}) });
  }
  const undecided = entries.flatMap((e) => (e.files || []).filter((f) => f.disposition === 'undecided').map((f) => ({ repo: e.path, path: f.path, note: f.note })));
  return { entries, summary, unmatched, undecided };
}

/* ---- the lists kept on this PC, one file per handoff label -------------------- */

const handoffsDir = (dir) => join(dir, HANDOFF_DIR);
export const keptPath = (dir, label) => join(handoffsDir(dir), String(label).replace(/[^A-Za-z0-9.-]/g, '_') + '.json');

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

/* A label rests and is reused, so the file must name the handoff's key too. */
export function readKept(dir, label, key) {
  if (!dir) return null;
  const j = readJson(keptPath(dir, label));
  return j && Array.isArray(j.repos) && (!key || j.key === key) ? j : null;
}

export function saveKept(dir, rec) {
  if (!dir) throw new Error('no data dir on this PC, so the loose-file lists were not kept');
  mkdirSync(handoffsDir(dir), { recursive: true });
  const path = keptPath(dir, rec.label);
  const tmp = path + '.' + process.pid + '.tmp';
  writeFileSync(tmp, JSON.stringify(rec, null, 2) + '\n');
  renameSync(tmp, path);
  return path;
}

/* ---- the session's moves ------------------------------------------------------ */

const callOf = (opts) => opts.call || boardCall;
const dirOf = (opts) => (opts.dir !== undefined ? opts.dir : dataDir());

/* Validate, run the git checks here, send the summary, keep the lists here.
   The result carries `resume`, the line the reply hands the user in its copy block. */
export async function writeTrackHandoff(track, payload, opts = {}) {
  const p = validateHandoffPayload(payload);
  const session = p.fromSession || opts.session || undefined;
  const pc = opts.pc || pcName(opts.env);
  const dir = dirOf(opts);
  const now = clockOf(opts);
  const v = await runVerifyFirst(p.verifyFirst, { dir, now });
  /* each repo's growth since the track's previous handoff, counted here; a failed read sends none */
  let growth;
  let chain = [];
  try {
    const prior = await callOf(opts)('trackHandoffs', { track }, { session, pc, now: opts.now });
    chain = prior.handoffs || [];
    growth = await handoffRepoGrowth(v.summary, chain);
  } catch { growth = undefined; }
  /* the backfill links first, so the handoff's review readout counts those commits */
  await linkNamed(v.summary.map((e) => ({ path: e.path, from: baselineOf(chain, e.path), to: e.commit })), opts, { session, pc, now: opts.now }, dir);
  const r = await callOf(opts)('writeHandoff', {
    track, focus: p.focus, state: p.state, whereWeWere: p.whereWeWere, rulings: p.rulings, waitingOnUser: p.waitingOnUser,
    verify: v.summary, depth: p.depth, session, pc, status: p.status, parkReason: p.parkReason, created: p.created, growth, leftovers: p.leftovers,
  }, { session, pc, now: opts.now });
  const out = { ...r, ...(v.undecided.length ? { undecided: v.undecided } : {}), ...(v.unmatched.length ? { unmatched: v.unmatched } : {}) };
  /* the leaves ask names this session's launcher, as the kickoff's does; the CLI and the mod print it */
  const leaves = leavesLine(r.leaves, r.track, launcherHere(opts.env) || undefined);
  if (leaves) out.leavesLine = leaves;
  /* the track's review readout, worded once for the CLI and the mod */
  const review = reviewLine(r.review, r.track);
  if (review) out.reviewLine = review;
  /* the folder check resume runs, so the write flags the same gap */
  const placed = placedHere(r.workstream, opts.cwd, dir);
  if (placed) out.workstream = placed;
  const checks = folderChecks(placed);
  if (checks) out.handoffChecks = checks;
  return keepHere(out, { label: r.id, key: r.key, track: r.track, pc, created: r.created, repos: v.entries }, { dir, entries: v.entries, now });
}

/* the commits whose messages name a task, linked at each handoff and resume
   (lib/growth.mjs backfillCommits); a failure is logged in the data dir, never thrown. */
async function linkNamed(ranges, opts, at, dir) {
  const call = callOf(opts);
  const send = async (input) => {
    try { await call(LINK_VERB, input, at); return { ok: true }; } catch (e) { return { ok: false, error: (e && e.message) || String(e) }; }
  };
  try {
    return await backfillCommits(ranges, send, { session: at.session || '' });
  } catch (e) {
    try { if (dir) appendFileSync(join(dir, 'commit-links.log'), new Date().toISOString() + ' ' + ((e && e.message) || String(e)) + '\n'); } catch {}
    return null;
  }
}

/* coverage --scan, the backfill for tracks: each repo their handoffs name, from its
   first baseline to HEAD here, linking the commits whose messages name a task. */
export async function scanCommits(tracks, opts = {}, at = {}) {
  const ranges = [];
  for (const track of tracks || []) {
    let chain = [];
    try { chain = (await callOf(opts)('trackHandoffs', { track }, at)).handoffs || []; } catch { continue; }
    const paths = [...new Set(chain.flatMap((h) => (h.verify || []).map((e) => e && e.path)).filter(Boolean))];
    for (const path of paths) ranges.push({ path, from: baselineOf(chain, path), to: 'HEAD' });
  }
  const r = await linkNamed(ranges, opts, at, dirOf(opts));
  return { repos: ranges.length, linked: r ? r.linked : 0, failed: !r };
}

/* The loose-file lists kept here, each repo's files; fail-open. No question is raised, the next kickoff lists what is due. */
function keepHere(out, rec, { dir, entries, now }) {
  try {
    out.kept = saveKept(dir, rec);
    storeHandoffFiles(dir, entries, rec.key, dayOf(now));
  } catch (e) {
    out.keptError = (e && e.message) || String(e);
  }
  return out;
}

const samePath = (a, b) => slashed(a).toLowerCase() === slashed(b).toLowerCase();
/* a refreshed repo keeps the kept entry's settings the op leaves out; the branch and commit are read anew */
const KEPT_SETTINGS = ['worktree', 'expectedDirty', 'ownedByOthers'];

/* a track's live handoff patched in place, keeping its id. A verifyFirst op runs
   its repo's checks here as a write does: the board gets the summary, this PC its lists. */
export async function updateTrackHandoff(id, payload, opts = {}) {
  const raw = Array.isArray(payload) ? { ops: payload } : payload;
  if (!raw || typeof raw !== 'object') throw new UsageError('handoff update takes JSON: a list of ops, or { ops }');
  refuseUnknown(raw, ['ops', 'session'], 'handoff update');
  const problems = updateProblems(raw);
  if (problems.length) throw new UsageError(problems.join('; '));
  const session = (text(raw.session) && raw.session.trim()) || opts.session || undefined;
  const pc = opts.pc || pcName(opts.env);
  const dir = dirOf(opts);
  const now = clockOf(opts);
  const call = callOf(opts);
  const at = { session, pc, now: opts.now };
  /* the export writes whereWeWere under its own heading, as on a write */
  const ops = raw.ops.map((o) => (o.op === 'whereWeWere' ? { ...o, line: guardHeadings(o.line.trim()) } : o));
  const repos = ops.filter((o) => o.op === 'verifyFirst');
  let v = null;
  if (repos.length) {
    const hs = (await call('trackHandoffs', { track: String(id).replace(/\.\d+$/, '') }, at)).handoffs;
    const last = hs.length ? hs[hs.length - 1] : null;
    if (last && last.pc && last.pc !== pc) throw new UsageError('the loose-file lists of ' + last.id + ' stay on ' + last.pc + ', so its verifyFirst is refreshed there');
    const kept = last ? readKept(dir, last.id, last.key) : null;
    const entries = validateVerify(repos.map(({ op, ...e }) => e)).map((e, i) => {
      const was = kept && kept.repos.find((k) => samePath(k.path, e.path));
      if (was) for (const k of KEPT_SETTINGS) if (repos[i][k] === undefined && was[k] !== undefined) e[k] = was[k];
      return e;
    });
    v = await runVerifyFirst(entries, { dir, now });
  }
  let n = 0;
  const sent = v ? ops.map((o) => (o.op === 'verifyFirst' ? { op: o.op, ...v.summary[n++] } : o)) : ops;
  const r = await call('updateHandoff', { id, session, pc, ops: sent }, at);
  if (!v) return r;
  const out = { ...r, ...(v.undecided.length ? { undecided: v.undecided } : {}), ...(v.unmatched.length ? { unmatched: v.unmatched } : {}) };
  const rec = readKept(dir, r.id, r.key) || { label: r.id, key: r.key, track: r.track, pc, created: r.created, repos: [] };
  for (const e of v.entries) {
    const i = rec.repos.findIndex((k) => samePath(k.path, e.path));
    if (i < 0) rec.repos.push(e); else rec.repos[i] = e;
  }
  return keepHere(out, rec, { dir, entries: v.entries, now });
}

/* the kickoff names what other work owns, so the next session leaves it alone */
function ownedKickoff(repos) {
  const owning = repos.filter((e) => ownedOf(e).length);
  const all = owning.flatMap((e) => ownedOf(e).map((d) => (owning.length > 1 ? e.path + ': ' : '') + d));
  return all.length ? ['Owned by other work, left alone: ' + all.join(', ') + '.'] : [];
}

/* A handoff's verify-first, checked on this PC: against the kept snapshot when
   the lists are here ("a tracked file changed since"), else the place alone. */
export async function verifyHere(dir, h, pc = pcName(), now = new Date()) {
  const kept = readKept(dir, h.id, h.key);
  if (kept) {
    const repos = [];
    for (const e of kept.repos) {
      const { problems, newFiles } = e.snapshot ? await checkSnapshotAsync(e) : { problems: await placeProblems(e), newFiles: [] };
      repos.push({ path: e.path, ok: !problems.length, problems, ...(newFiles.length ? { newFiles } : {}) });
    }
    const report = newFilesText(repos);
    return { id: h.id, lists: 'here', ok: repos.every((x) => x.ok), repos, ...(report ? { report } : {}), files: [...filesKickoff(kept.repos, dayOf(now)), ...ownedKickoff(kept.repos)] };
  }
  const repos = [];
  for (const e of h.verify || []) {
    const problems = await placeProblems(e);
    repos.push({ path: e.path, ok: !problems.length, problems });
  }
  const elsewhere = h.pc && h.pc !== pc;
  return {
    id: h.id, lists: elsewhere ? 'elsewhere' : 'missing', ok: repos.every((x) => x.ok), repos, files: [],
    note: elsewhere ? 'the loose-file lists of ' + h.id + ' stay on ' + h.pc + ', so only the branch and worktree were checked here'
      : 'no loose-file lists of ' + h.id + ' are kept on this PC, so only the branch and worktree were checked',
  };
}

/* ---- the kickoff as this PC reads it -------------------------------------------- */

/* Through the project map: the workstream's handoff folder on this PC,
   in the session's own checkout when it is one of the project's, else in the
   map's folder; null when this PC has no folder for the name. */
export function handoffDirHere(ws, cwd, dir) {
  if (!ws) return null;
  const at = ws.handoffAt;
  if (!at || !at.project) return ws.handoffDir || null;
  const base = folderHere(at.project, { cwd, dir });
  return base ? (slashed(base) + '/' + at.rel).replace(/\/\.\//g, '/') : null;
}

/* with a sandbox seam set, the session's own launcher (the one the sync
   writes at its store root), else null and the kickoff keeps the live one.
   before the sync has written it, this copy's own CLI. */
export function launcherHere(env = process.env) {
  const s = sandboxHome(env);
  if (!s || s.problem) return null;
  const cli = slashed(storeRoot(undefined, env)) + '/cli.mjs';
  const file = existsSync(cli) ? cli : slashed(join(pluginRoot, 'bin', 'askerdo.mjs'));
  return 'node ' + (/\s/.test(file) ? '"' + file + '"' : file);
}

/* A board kickoff read here: its Read line at this PC's folder (or saying this PC
   has none for the project), its commands naming this session's launcher. */
export async function kickoffHere(r, { cwd, env, dir: data } = {}) {
  const ws = r && r.workstream;
  const placed = placedHere(ws, cwd, data !== undefined ? data : dataDir(env));
  const was = ws ? readLine(ws) : null;
  const now = !ws ? null : placed.unmapped
    ? 'Read: ' + ws.id + ' keeps ' + (ws.ruleProfiles ? 'map.md' : 'rules.md and map.md') + ' in ' + ws.handoffAt.rel + ' of its project, and ' + unmappedLine(placed.unmapped) + '.'
    : readLine(placed);
  const launcher = launcherHere(env);
  const fix = (t) => {
    if (typeof t !== 'string') return t;
    let out = t;
    if (was && now !== was) {
      const lines = out.split('\n');
      const i = lines.indexOf(was);
      if (i >= 0) lines[i] = now;
      out = lines.join('\n');
    }
    return launcher ? out.split(CLI).join(launcher) : out;
  };
  return { ...r, kickoff: fix(r.kickoff), next: fix(r.next), ...(ws ? { workstream: placed } : {}) };
}

/* /askerdo resume: the board takes the lease and hands back the kickoff; this
   PC checks verify-first and the workstream's handoff folder. A held track
   comes back with its holder and the three moves, untouched. */
export async function resumeTrackSession(track, { session, pc, move, name, goal, reason } = {}, opts = {}) {
  const who = session || opts.session || undefined;
  const at = pc || opts.pc || pcName(opts.env);
  const r = await kickoffHere(await callOf(opts)('resumeTrack', { track, session: who, pc: at, move, name, goal, reason }, { session: who, pc: at, now: opts.now }),
    { cwd: opts.cwd, env: opts.env, dir: dirOf(opts) });
  if (!r.acquired && !r.readOnly) return r;
  const out = { ...r };
  if (r.handoff) {
    /* the board names this PC as it stored the handoff's */
    try { out.verify = await verifyHere(dirOf(opts), r.handoff, r.pc || at, clockOf(opts)); } catch (e) { out.verify = { error: (e && e.message) || String(e) }; }
    if (out.verify.files && out.verify.files.length) out.kickoff = r.kickoff + '\n\n' + out.verify.files.join('\n');
    if (r.acquired) await linkNamed((r.handoff.verify || []).map((e) => ({ path: e && e.path, from: e && e.commit, to: 'HEAD' })), opts, { session: who, pc: at, now: opts.now }, dirOf(opts));
  }
  const checks = folderChecks(r.workstream);
  if (checks) out.handoffChecks = checks;
  return out;
}

/* The workstream's handoff folder checked here, with handoffDir (or unmapped) as
   this PC places it; null when there is nothing to say. */
function folderChecks(ws) {
  if (ws && ws.handoffDir) {
    const c = checkHandoffDir(ws.handoffDir, { onThread: true });
    /* the gap shows rather than a kickoff that silently reads nothing */
    const missing = c.missing.concat(['rules.md', 'map.md'].filter((n) => !c.present.includes(n)).map((n) => n + ' is missing'));
    return missing.length || c.warnings.length ? [{ workstream: ws.id, ...c, ok: !missing.length, missing }] : null;
  }
  if (ws && ws.unmapped) return [{ workstream: ws.id, ok: false, missing: [unmappedLine(ws.unmapped)], warnings: [] }];
  return null;
}

/* A board workstream head placed on this PC, as kickoffHere places it. */
function placedHere(ws, cwd, data) {
  if (!ws) return null;
  const dir = handoffDirHere(ws, cwd, data);
  const unmapped = ws.handoffAt && !dir ? ws.handoffAt.project : null;
  return { ...ws, handoffDir: dir, ...(unmapped ? { unmapped } : {}) };
}

/* Commits on a repo's branch (else HEAD) since its verify-first commit; null when unreadable. */
async function moved(e) {
  if (!e || !e.path || !e.commit) return null;
  let n = e.branch ? await git(e.path, ['rev-list', '--count', e.commit + '..' + e.branch]) : null;
  if (n === null) n = await git(e.path, ['rev-list', '--count', e.commit + '..HEAD']);
  return n !== null && /^\d+$/.test(n) ? Number(n) : null;
}

/* The board's shelf, with "code moved since" read here unless `git` is false. */
export async function trackShelf({ git: withGit = true } = {}, opts = {}) {
  const r = await callOf(opts)('shelf', {}, { now: opts.now });
  if (withGit) {
    await Promise.all(r.rows.map(async (row) => {
      const counts = (await Promise.all((row.verify || []).map(moved))).filter((n) => n !== null);
      row.codeMoved = counts.length ? counts.some((n) => n > 0) : null;
    }));
  }
  return r;
}
