/* Tracks in the session, the PC half:
   the handoff payload check, the verify-first git checks on the PC that owns the
   repos, and the loose-file, worktree and branch lists kept here in the data dir, one file per
   handoff label; only each repo's summary goes to the board through boardCall.
   No process start-up and no argv, so the local server can run it as it is; git
   runs off its event loop. */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { boardCall } from './board-call.mjs';
import { pcName } from './pc-name.mjs';
import { dataDir, pluginRoot, pluginVersion, replacedCopy, sandboxHome, storeRoot } from './node-helpers.mjs';
import { handoffProblems, leavesLine, reviewLine, updateProblems, wrapLines, wrapHandoff, wrappedLine } from './handoff-payload.mjs';
import { staleToolsLine, unpushedLine } from '../server/handoff-text.mjs';
import { checkHandoffDir } from './handoff-check.mjs';
import { backfillCommits, baselineOf, handoffRepoGrowth } from './growth.mjs';
import { LINK_VERB } from './commit-capture.mjs';
import { UsageError } from '../server/verbs/labels.mjs';
/* the board's own heading guard, so every reader's unguard gives the where-we-were text back exactly */
import { guardHeadings } from '../server/records.mjs';
import { edgeTrim } from '../server/verbs/handoffs.mjs';
import { CLI, readLine, untakenLine } from '../server/verbs/kickoff.mjs';
import { folderHere, readMap, unmappedLine } from './project-map.mjs';
import { isPathName, rebasePath, sharedName } from './project-id.mjs';
import {
  checkPlace, checkSnapshotAsync, gitAsync as git, placeName, isDue, keptKickoff, newFilesText, readKept as keptDispositions, readKeptWorktrees, agentRemovals, keptPlan, removeAgentPlans,
  settleFiles, settleWorktrees, snapshotRepoAsync, storeHandoffFiles, under, validateFiles, validateWorktrees, worktreeLines,
} from './loose-files.mjs';

const PAYLOAD_KEYS = ['focus', 'state', 'whereWeWere', 'waitingOnUser', 'rulings', 'verifyFirst', 'fromSession', 'session',
  'depthAtHandoff', 'status', 'parkReason', 'created', 'leftovers', 'taskNotes', 'nextPc', 'goal'];
const VERIFY_KEYS = ['path', 'branch', 'worktree', 'commit', 'expectedDirty', 'ownedByOthers', 'files', 'worktrees'];
const LIVE = ['waiting', 'parked'];
const STAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/;
export const HANDOFF_DIR = 'handoffs';
export { pcName };

const text = (v) => typeof v === 'string' && v.trim() !== '';
const slashed = (p) => String(p || '').replace(/\\/g, '/').replace(/(.)\/+$/, '$1');

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
export function validateHandoffPayload(given) {
  if (!given || typeof given !== 'object' || Array.isArray(given)) throw new UsageError('handoff payload must be a JSON object');
  refuseUnknown(given, PAYLOAD_KEYS, 'handoff write');
  const { payload: raw, wrapped } = wrapHandoff(given);
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
  const where = text(raw.whereWeWere) ? edgeTrim(raw.whereWeWere) : undefined;
  return {
    focus: raw.focus.trim(), state: raw.state.trim(),
    /* the export writes it under its own heading, so a heading inside it is guarded */
    whereWeWere: where ? guardHeadings(where) : undefined,
    waitingOnUser: (raw.waitingOnUser || []).map((w) => (typeof w === 'string' ? w.trim() : { drop: w.drop.trim() })),
    rulings: (raw.rulings || []).map((r) => (typeof r === 'string' ? r.trim()
      : { ...(r.id ? { id: r.id.trim() } : { text: r.text.trim() }), registered: r.registered.trim() })),
    taskNotes: Array.isArray(raw.taskNotes) && raw.taskNotes.length ? raw.taskNotes.map((t) => ({ ...t, id: t.id.trim().toUpperCase() })) : undefined,
    verifyFirst: validateVerify(raw.verifyFirst),
    fromSession: text(raw.fromSession ?? raw.session) ? String(raw.fromSession ?? raw.session).trim() : undefined,
    status, parkReason, depth, created: raw.created,
    /* the steps left, laid out on the track by the board */
    leftovers: Array.isArray(raw.leftovers) && raw.leftovers.length ? raw.leftovers : undefined,
    nextPc: text(raw.nextPc) ? raw.nextPc.trim() : undefined,
    goal: text(raw.goal) ? raw.goal.trim() : undefined,
    ...(wrapped ? { wrapped } : {}),
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
    const worktrees = validateWorktrees(e.worktrees, at + '.worktrees', (m) => new UsageError(m));
    if (worktrees) out.worktrees = worktrees;
    return out;
  });
}

/* ---- git, on the PC that owns the repos ------------------------------------ */

/* The checks verify-first makes without the lists: the repo reads, the branch
   and the worktree are where the handoff says. `top` is the checkout's root
   when the caller read it already. */
async function placeProblems(e, top) {
  const at = checkPlace(e);
  if (at !== e.path && !existsSync(at)) return ['worktree ' + at + ' is missing'];
  if ((top === undefined ? await git(at, ['rev-parse', '--show-toplevel']) : top) === null) return [placeName(e) + 'not a readable git repo'];
  const problems = [];
  if (e.branch) {
    const b = await git(at, ['rev-parse', '--abbrev-ref', 'HEAD']);
    if (b !== e.branch) problems.push(placeName(e) + 'on branch ' + (b || 'unknown') + ', the handoff says ' + e.branch);
  }
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
export async function runVerifyFirst(entries, { dir, now = new Date(), skip = [] } = {}) {
  const day = dayOf(now);
  const summary = [];
  const unmatched = [];
  for (const e of entries) {
    const at = checkPlace(e);
    const top = at !== e.path && !existsSync(at) ? null : await git(at, ['rev-parse', '--show-toplevel']);
    if (top !== null && !e.commit) { const c = await git(at, ['rev-parse', 'HEAD']); if (c) e.commit = c; }
    if (top !== null && !e.branch) { const b = await git(at, ['rev-parse', '--abbrev-ref', 'HEAD']); if (b) e.branch = b; }
    const problems = await placeProblems(e, top);
    /* the worktrees and branches are judged at the entry's path, and only when it is a checkout's top */
    const pathTop = top === null ? null : await repoTop(e.path);
    const plan = pathTop ? skip.find((k) => k.top.toLowerCase() === pathTop.toLowerCase()) : undefined;
    const snap = top === null ? null : await snapshotRepoAsync(at, { owned: ownedOf(e), nowMs: now.getTime(), skip: plan, groupsAt: pathTop ? e.path : null });
    if (snap) {
      e.snapshot = snap;
      const r = settleFiles(e, e.files, dir ? keptDispositions(dir, e.path) : [], day, now.getTime(), top);
      e.files = r.files.filter((f) => !under(f.path, ownedOf(e)));
      unmatched.push(...r.unmatched.map((f) => e.path + ': ' + f));
      /* the repo's worktrees and merged branches, settled as its loose files are */
      const w = settleWorktrees(e, e.worktrees, dir ? readKeptWorktrees(dir, e.path) : [], day, pathTop || top);
      if (w.worktrees) e.worktrees = w.worktrees; else delete e.worktrees;
      unmatched.push(...w.unmatched.map((x) => e.path + ': ' + x + ' (no such group, nor a worktree holding work)'));
    } else { delete e.files; delete e.worktrees; }
    /* the repo's shared name rides the summary, so another PC finds its own checkout */
    const name = top === null ? '' : sharedName(top);
    summary.push({ path: e.path, ...(name && !isPathName(name) ? { remote: name } : {}), ...(e.branch ? { branch: e.branch } : {}), ...(e.worktree ? { worktree: e.worktree } : {}),
      ...(e.commit ? { commit: e.commit } : {}), ok: !problems.length, ...(problems.length ? { problems } : {}) });
  }
  const undecided = entries.flatMap((e) => (e.files || []).filter((f) => f.disposition === 'undecided').map((f) => ({ repo: e.path, path: f.path, note: f.note })));
  /* the rest carry unasked: only a proposal and a keep past its review day are named */
  const due = entries.flatMap((e) => (e.files || []).filter((f) => f.disposition !== 'undecided' && isDue(f, day))
    .map((f) => ({ repo: e.path, path: f.path, disposition: f.disposition, ...(f.reason ? { reason: f.reason } : {}), ...(f.review ? { review: f.review } : {}) })));
  return { entries, summary, unmatched, undecided, due, worktreeLines: worktreeLines(entries, day, true) };
}

/* a checkout's top (a repo's or a worktree's own), else null: a folder inside a repo is no
   repo's place, so a write naming one removes and groups nothing of the repo around it */
async function repoTop(path) {
  const [top, inside] = await Promise.all([git(path, ['rev-parse', '--show-toplevel']), git(path, ['rev-parse', '--show-prefix'])]);
  return top !== null && inside === '' ? top : null;
}

/* each repo's merged, clean agent worktrees and merged agent branches, judged before the snapshot
   and removed after the board write; never the worktree this session runs in nor one other work owns; each repo once. */
async function agentPlans(entries, cwd, now, dir) {
  const self = await git(cwd, ['rev-parse', '--show-toplevel']);
  const out = [];
  const seen = new Set();
  for (const e of entries || []) {
    const top = await repoTop(e.path);
    if (!top || seen.has(top.toLowerCase())) continue;
    seen.add(top.toLowerCase());
    /* the worktree the handoff names is the next session's to verify, never removed */
    const r = await agentRemovals(e.path, { self: [self, e.worktree].filter(Boolean), owned: ownedOf(e), nowMs: now.getTime() });
    if (r) out.push(keptPlan(r, e.worktrees, dir ? readKeptWorktrees(dir, e.path) : []));
  }
  return out;
}

/* the write answers inside the route's 25 s and the CLI's 60 s limits: no removal starts
   past REMOVE_START into the call and its result is in by REMOVE_WAIT, what is left named there */
export const REMOVE_START = 10000;
export const REMOVE_WAIT = 18000;
/* only the local server outlives its call; a CLI's own exit can end the git it started (measured: a job
   object kill left half a folder), so there the removal in flight is awaited, under the 60 s limit */
const OUTLIVES = /[\\/]board-server\.mjs$/.test(process.argv[1] || '');

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
  if (!dir) throw new Error('no data dir on this PC, so the loose-file, worktree and branch lists were not kept');
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

/* Whether a run's branch is on the remote as this PC last saw it: its upstream, else
   origin's, holds the branch's tip. Remote tracking refs only, so a handoff never waits on the network. */
async function remoteOf(r, pc) {
  if (!r.repo || (r.pc && pc && String(r.pc).toLowerCase() !== String(pc).toLowerCase()) || !existsSync(r.repo)) return 'unchecked';
  const tip = await git(r.repo, ['rev-parse', '--verify', '--quiet', 'refs/heads/' + r.branch]);
  if (!tip) return 'unchecked';
  const up = await git(r.repo, ['for-each-ref', '--format=%(upstream)', 'refs/heads/' + r.branch]);
  const ref = up || 'refs/remotes/origin/' + r.branch;
  if (!(await git(r.repo, ['rev-parse', '--verify', '--quiet', ref]))) return 'unpushed';
  return (await git(r.repo, ['merge-base', '--is-ancestor', tip, ref])) === null ? 'unpushed' : 'pushed';
}

/* Validate, run the git checks here, send the summary, keep the lists here.
   The result carries `resume`, the line the reply hands the user in its copy block. */
export async function writeTrackHandoff(track, payload, opts = {}) {
  const p = validateHandoffPayload(payload);
  const session = p.fromSession || opts.session || undefined;
  const pc = opts.pc || pcName(opts.env);
  const dir = dirOf(opts);
  const now = clockOf(opts);
  const began = Date.now();
  const plans = await agentPlans(p.verifyFirst, opts.cwd || process.cwd(), now, dir);
  const v = await runVerifyFirst(p.verifyFirst, { dir, now, skip: plans });
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
  const sent = {
    track, focus: p.focus, state: p.state, whereWeWere: p.whereWeWere, rulings: p.rulings, waitingOnUser: p.waitingOnUser,
    verify: v.summary, depth: p.depth, session, pc, status: p.status, parkReason: p.parkReason, created: p.created, growth, leftovers: p.leftovers,
    ...(p.taskNotes ? { taskNotes: p.taskNotes } : {}), ...(p.nextPc ? { nextPc: p.nextPc } : {}), ...(p.goal ? { goal: p.goal } : {}),
  };
  /* the board places each leftover by the session's held track, or asks the user, with no mark from here */
  const r = await callOf(opts)('writeHandoff', sent, { session, pc, now: opts.now });
  /* the board names the session's runs with a branch; only this PC can ask git where each sits */
  if (Array.isArray(r.runs) && r.runs.length) {
    r.runs = await Promise.all(r.runs.map(async (x) => ({ ...x, remote: await remoteOf(x, pc).catch(() => 'unchecked') })));
  }
  const { start = REMOVE_START, wait = OUTLIVES ? REMOVE_WAIT : Infinity } = opts.removal || {};
  const removed = await removeAgentPlans(plans, { startBy: began + start, waitTo: began + wait });
  const out = { ...r, ...(v.undecided.length ? { undecided: v.undecided } : {}), ...(v.due.length ? { dueFiles: v.due } : {}), ...(v.unmatched.length ? { unmatched: v.unmatched } : {}),
    ...(v.worktreeLines.length ? { worktreeLines: v.worktreeLines } : {}), ...(removed.length ? { removed } : {}) };
  /* the leaves ask and the growth lines name this session's launcher, as the kickoff's do; the CLI and the mod print them */
  if (p.wrapped) out.wrappedLine = wrappedLine(p.wrapped);
  const launcher = launcherHere(opts.env);
  const leaves = leavesLine(r.leaves, r.track, launcher || undefined, true);
  if (leaves) out.leavesLine = leaves;
  if (launcher && Array.isArray(r.growthLines)) out.growthLines = hereLines(r.growthLines, launcher);
  /* the track's review readout, worded once for the CLI and the mod */
  /* the ready step, before the track's next checkpoint, in this session's launcher, as the kickoff's */
  const review = reviewLine(r.review, r.track, { before: r.checkpoint || null, cli: launcher || undefined });
  if (review) out.reviewLine = review;
  /* the workstream's tracks with ready work and no session, worded as the kickoff's */
  const untaken = untakenLine(r.untaken, r.workstream);
  if (untaken) out.untakenLine = hereLines([untaken], launcher)[0];
  /* a task in hand handed off with nothing written on it this leg is named, with the call that writes it */
  if (Array.isArray(r.silentInHand) && r.silentInHand.length) {
    out.silentLine = 'Handed off with nothing written on ' + (r.silentInHand.length === 1 ? 'it' : 'them') + ' this session: ' + r.silentInHand.map((t) => t.id + ' ' + t.name).join('; ')
      + '. What this leg knew of ' + (r.silentInHand.length === 1 ? 'it' : 'each') + ' is lost unless written: write it now with the note tool (id T-n, and a new description or intent when the work changed),'
      + ' or next time in the handoff\'s taskNotes. The next kickoff names ' + (r.silentInHand.length === 1 ? 'it' : 'them') + ' too.';
  }
  const unpushed = unpushedLine(r.runs);
  if (unpushed) out.unpushedLine = unpushed;
  /* the waits carried from the last handoff, so a settled one is dropped by the next */
  if (Array.isArray(r.carriedWaits) && r.carriedWaits.length) {
    out.waitsLine = 'Carried from the last handoff, still waiting on the user: ' + r.carriedWaits.map((w) => '"' + w + '"').join('; ')
      + '. Each stays until a handoff drops it: waitingOnUser { drop: the line as written } once it is settled.';
  }
  /* a carried wait whose question the board shows answered or dropped is left out, and said so */
  if (Array.isArray(r.settledWaits) && r.settledWaits.length) {
    out.waitsLine = (out.waitsLine ? out.waitsLine + '\n' : '') + 'Settled, so no longer carried (its question is answered or dropped): '
      + r.settledWaits.map((w) => '"' + w + '"').join('; ') + '.';
  }
  /* the folder check resume runs, so the write flags the same gap */
  const placed = placedHere(r.workstream, opts.cwd, dir);
  if (placed) out.workstream = placed;
  const checks = folderChecks(placed);
  if (checks) out.handoffChecks = checks;
  return keepHere(out, { label: r.id, key: r.key, track: r.track, pc, created: r.created, repos: v.entries }, { dir, entries: v.entries, now });
}

/* the commits whose subjects lead with a task id, linked at each handoff and resume
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
   first baseline to HEAD here, linking the commits whose subjects lead with a task id. */
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

/* The loose-file, worktree and branch lists kept here, each repo's; fail-open. No question is raised here; the write's reply asks. */
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
  /* a state section's long line wraps as on a write */
  const ops = raw.ops.map((o) => (o.op === 'whereWeWere' ? { ...o, line: guardHeadings(o.line.trimEnd()) }
    : o.op === 'state' ? { ...o, text: wrapLines(o.text).text } : o));
  const repos = ops.filter((o) => o.op === 'verifyFirst');
  let v = null;
  if (repos.length) {
    const hs = (await call('trackHandoffs', { track: String(id).replace(/\.\d+$/, '') }, at)).handoffs;
    const last = hs.length ? hs[hs.length - 1] : null;
    if (last && last.pc && last.pc !== pc) throw new UsageError('the loose-file, worktree and branch lists of ' + last.id + ' stay on ' + last.pc + ', so its verifyFirst is refreshed there');
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
  const out = { ...r, ...(v.undecided.length ? { undecided: v.undecided } : {}), ...(v.due.length ? { dueFiles: v.due } : {}), ...(v.unmatched.length ? { unmatched: v.unmatched } : {}),
    ...(v.worktreeLines.length ? { worktreeLines: v.worktreeLines } : {}) };
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

/* where a handoff's repo sits on this PC: its own path when readable here, else the
   checkout of its shared name, else (a bare path written before the name rode along) the
   path moved through every PC's map, else the workstream's or the map's checkout that holds
   its commit; null when this PC has none. */
async function repoHere(e, { cwd, dir, projects, places }) {
  if (await git(e.path, ['rev-parse', '--show-toplevel']) !== null) return e.path;
  if (e.remote) return folderHere(e.remote, { cwd, dir }) || null;
  const moved = places ? rebasePath(e.path, places) : e.path;
  if (moved !== e.path && await git(moved, ['rev-parse', '--show-toplevel']) !== null) return moved;
  if (!e.commit) return null;
  const map = readMap(dir);
  const names = [...new Set([...(projects || []), ...Object.keys(map)])];
  for (const name of names) {
    const f = folderHere(name, { cwd, dir, map });
    if (f && await git(f, ['cat-file', '-e', e.commit + '^{commit}']) !== null) return f;
  }
  return null;
}

/* A handoff's verify-first, checked on this PC: against the kept snapshot when
   the lists are here ("a tracked file changed since"), else the place alone. */
export async function verifyHere(dir, h, pc = pcName(), now = new Date(), { cwd, projects = [], places } = {}) {
  const kept = readKept(dir, h.id, h.key);
  if (kept) {
    const repos = [];
    for (const e of kept.repos) {
      const { problems, newFiles } = e.snapshot ? await checkSnapshotAsync(e) : { problems: await placeProblems(e), newFiles: [] };
      repos.push({ path: e.path, ok: !problems.length, problems, ...(newFiles.length ? { newFiles } : {}) });
    }
    const report = newFilesText(repos);
    return { id: h.id, lists: 'here', ok: repos.every((x) => x.ok), repos, ...(report ? { report } : {}), files: [...keptKickoff(kept.repos, dayOf(now)), ...ownedKickoff(kept.repos)] };
  }
  const repos = [];
  for (const e of h.verify || []) {
    const at = await repoHere(e, { cwd, dir, projects, places });
    if (!at) { repos.push({ path: e.path, ok: true, problems: [], absent: true, ...(e.remote ? { remote: e.remote } : {}) }); continue; }
    /* a worktree named on the writing PC is that PC's, so only the branch is checked at another path */
    const problems = await placeProblems(at === e.path ? e : { path: at, branch: e.branch });
    repos.push({ path: e.path, ...(at !== e.path ? { here: at } : {}), ok: !problems.length, problems });
  }
  const elsewhere = h.pc && h.pc !== pc;
  return {
    id: h.id, lists: elsewhere ? 'elsewhere' : 'missing', ok: repos.every((x) => x.ok), repos, files: [],
    note: elsewhere ? 'the loose-file, worktree and branch lists of ' + h.id + ' stay on ' + h.pc + ', so only each repo\'s current branch and worktree were checked here'
      : 'no loose-file, worktree or branch lists of ' + h.id + ' are kept on this PC, so only each repo\'s current branch and worktree were checked',
  };
}

/* ---- the kickoff as this PC reads it -------------------------------------------- */

/* Through the project map: the workstream's handoff folder on this PC,
   in the session's own checkout when it is one of the project's, else in the
   map's folder; null when this PC has no folder for the name. */
export function handoffDirHere(ws, cwd, dir, places) {
  if (!ws) return null;
  const at = ws.handoffAt;
  if (!at || !at.project) return ws.handoffDir ? sameDirHere(ws.handoffDir, ws.projectRepos, cwd, dir, places) : null;
  const base = folderHere(at.project, { cwd, dir });
  return base ? (slashed(base) + '/' + at.rel).replace(/\/\.\//g, '/') : null;
}

/* an absolute folder another PC wrote, missing here, moved through every PC's map
   (rebasePath), else found under this PC's checkout of one of the workstream's projects
   by its longest tail that exists there; else as written. */
function sameDirHere(abs, projects, cwd, dir, places) {
  const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
  if (isDir(abs)) return abs;
  const moved = places ? rebasePath(abs, places) : abs;
  if (moved !== abs && isDir(moved)) return moved;
  const segs = slashed(abs).split('/').filter(Boolean);
  for (const name of Array.isArray(projects) ? projects : []) {
    const base = folderHere(name, { cwd, dir });
    if (!base) continue;
    /* a tail of two segments at least: a lone last name would match any folder of that name */
    for (let i = 1; i < segs.length - 1; i++) {
      const p = slashed(base) + '/' + segs.slice(i).join('/');
      if (isDir(p)) return p;
    }
  }
  return abs;
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

/* Board-worded lines with the live launcher swapped for this session's (launcherHere). */
export const hereLines = (lines, launcher) => (launcher ? lines.map((l) => (typeof l === 'string' ? l.split(CLI).join(launcher) : l)) : lines);

/* A board kickoff read here: its Read line at this PC's folder (or saying this PC
   has none for the project), its commands naming this session's launcher. */
export async function kickoffHere(r, { cwd, env, dir: data, places } = {}) {
  const ws = r && r.workstream;
  const placed = placedHere(ws, cwd, data !== undefined ? data : dataDir(env), places);
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

/* this PC's map and every PC's map the board keeps, as rebasePath takes them;
   a board without the maps leaves this PC's alone. */
export async function placesHere(opts = {}, at = {}) {
  const mine = Object.entries(readMap(dirOf(opts))).map(([repo, dir]) => ({ dir, repo }));
  let theirs = [];
  try {
    const r = await callOf(opts)('pcMap', {}, at);
    theirs = (r && Array.isArray(r.maps) ? r.maps : []).flatMap((m) => Object.entries((m && m.map) || {}).map(([repo, dir]) => ({ dir, repo })));
  } catch {}
  return mine.concat(theirs);
}

/* /askerdo resume: the board takes the lease and hands back the kickoff; this
   PC checks verify-first and the workstream's handoff folder. A held track
   comes back with its holder and the three moves, untouched. */
export async function resumeTrackSession(track, { session, pc, move, name, goal, reason, here, continues } = {}, opts = {}) {
  const who = session || opts.session || undefined;
  const at = pc || opts.pc || pcName(opts.env);
  const answer = await callOf(opts)('resumeTrack', { track, session: who, pc: at, move, name, goal, reason, ...(here ? { here: true } : {}), ...(continues ? { continues } : {}) }, { session: who, pc: at, now: opts.now });
  const places = (answer.acquired || answer.readOnly) ? await placesHere(opts, { session: who, pc: at }) : undefined;
  const r = await kickoffHere(answer, { cwd: opts.cwd, env: opts.env, dir: dirOf(opts), places });
  if (!r.acquired && !r.readOnly) return r;
  const out = { ...r };
  if (r.handoff) {
    /* the board names this PC as it stored the handoff's */
    try { out.verify = await verifyHere(dirOf(opts), r.handoff, r.pc || at, clockOf(opts), { cwd: opts.cwd, projects: r.workstream ? r.workstream.projectRepos : [], places }); } catch (e) { out.verify = { error: (e && e.message) || String(e) }; }
    if (out.verify.files && out.verify.files.length) out.kickoff = r.kickoff + '\n\n' + out.verify.files.join('\n');
    /* each repo at its path here, so a handoff written on another PC links here too */
    const hereOf = (e) => { const v = ((out.verify && out.verify.repos) || []).find((x) => x.path === (e && e.path)); return v && v.here ? v.here : e && e.path; };
    if (r.acquired) await linkNamed((r.handoff.verify || []).map((e) => ({ path: hereOf(e), from: e && e.commit, to: 'HEAD' })), opts, { session: who, pc: at, now: opts.now }, dirOf(opts));
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
function placedHere(ws, cwd, data, places) {
  if (!ws) return null;
  const dir = handoffDirHere(ws, cwd, data, places);
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
