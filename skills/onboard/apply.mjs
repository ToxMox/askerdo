#!/usr/bin/env node
/* runs plan.json through the AskerDo CLI, in order. Without --board it is a dry run
   that prints each command. --board file:<db> rehearses on a scratch board (it keeps going
   and lists every refusal); --board live writes the board the CLI's config names, stops at
   the first refusal and resumes from its results. Every id written goes in the manifest,
   which --undo walks backwards.
   node apply.mjs <work dir> [--board file:<db> | --board live] [--cli <path>] [--undo [--all] [--session <own id>]] */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { storeRoot } from '../../lib/node-helpers.mjs';

const DEFAULT_CLI = join(homedir(), '.claude', 'askerdo', 'cli.mjs');
const REF = /@\{([^}]+)\}/g;
const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const clip = (s, n = 90) => { const t = oneLine(s); return t.length > n ? t.slice(0, n - 3) + '...' : t; };
const shq = (a) => (/^[A-Za-z0-9_./:@~=+,{}-]+$/.test(a) ? a : '"' + String(a).replace(/(["\\$`])/g, '\\$1') + '"');
const readJson = (p, d) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return d; } };
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

/* the record each verb makes, and the call that takes it back (null: no verb can) */
const KIND = {
  'ws create': 'workstream', 'task create': 'task', 'track new': 'track', 'handoff write': 'handoff', 'track finish': 'track state', 'track park': 'track state',
  'track layout': 'track order', 'edge add': 'task order', 'task edit': 'run-by', 'question edit': 'question scope',
  decide: 'decision', 'knowledge new': 'knowledge', register: 'question', 'profile rule-add': 'rule line', 'profile add': 'profile hold', 'proc scan': 'procedure cards',
};
/* A scratch board lacks the real board's tracks and tasks: a rehearsal leaves their ids out of a step,
   flag and value together, and skips a step that names one in place or has nothing left to set. */
const REAL_ID = /^(?:TR|T)-\d+$/;
export function scratchStep(s) {
  const dropped = [];
  const args = [];
  let skip = false;
  const raw = s.args || [];
  for (let i = 0; i < raw.length; i++) {
    if (/^--/.test(raw[i]) && REAL_ID.test(String(raw[i + 1]))) { dropped.push(raw[++i]); continue; }
    if (REAL_ID.test(raw[i])) { dropped.push(raw[i]); skip = true; }
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
  return { args, stdin, dropped, skip };
}

export function undoArgs(step, id, label) {
  const why = 'undo of the ' + label + ' import';
  switch (step.op) {
    case 'ws create': return ['ws', 'close', id, '--outcome', why];
    case 'task create': return ['task', 'edit', id, '--status', 'dropped'];
    case 'track new': return ['track', 'drop', id, '--reason', why, '--leftovers', 'drop'];
    case 'register': return ['drop', id, '--note', why];
    case 'profile rule-add': return ['profile', 'rule-clear', step.args[2], step.args[3]];
    case 'profile add': return ['profile', 'remove', step.args[2], step.args[3]];
    default: return null;
  }
}
const idOf = (step, out) => {
  if (step.op === 'profile rule-add') return step.args[2] + '/' + step.args[3];
  if (step.op === 'profile add') return step.args[3] + ' on ' + step.args[2];
  if (['proc scan', 'track finish', 'track park', 'track layout', 'edge add', 'task edit', 'question edit'].includes(step.op)) return 'ok';
  return out && typeof out.id === 'string' ? out.id : null;
};

function run(cli, args, { stdin, env }) {
  const r = spawnSync(process.execPath, [cli, ...args, '--json'], { input: stdin ?? '', encoding: 'utf8', windowsHide: true, env, maxBuffer: 64 << 20 });
  let out;
  try { out = JSON.parse(String(r.stdout || '').trim()); } catch { out = undefined; }
  return { ok: !r.error && r.status === 0, out, why: oneLine(r.error ? r.error.message : (r.stderr || r.stdout || 'exit ' + r.status)) };
}

function target(work, board) {
  if (!board) return null;
  if (board === 'live') return { name: 'live', env: null, results: join(work, 'apply-results.json'), manifest: join(work, 'manifest.json'), bodies: join(work, 'bodies') };
  if (!/^file:.+/.test(board)) throw new Error('--board takes file:<db> (a scratch board) or live');
  const tag = basename(board.slice(5)).replace(/[^A-Za-z0-9.-]+/g, '_');
  const dir = join(work, 'rehearsal');
  /* the CLI keeps handoff lists and a log beside its data: a rehearsal's go to a home of its own (outside ~/.claude, as the seam asks) */
  const home = process.env.ASKERDO_SANDBOX_HOME || join(tmpdir(), 'askerdo-onboard', basename(resolve(work)) + '-' + tag);
  mkdirSync(home, { recursive: true });
  const env = { ASKERDO_BOARD_URL: board, ASKERDO_SANDBOX_HOME: home };
  return { name: board, env, rehearsal: true, results: join(dir, tag + '-results.json'), manifest: join(dir, tag + '-manifest.json'), bodies: join(dir, 'bodies') };
}

export function applyPlan(work, { board, cli = DEFAULT_CLI, log = console.log } = {}) {
  const plan = readJson(join(work, 'plan.json'));
  if (!plan) throw new Error('no plan.json in ' + work + ': run plan.mjs first');
  const t = target(work, board);
  if (t && !t.rehearsal && plan.pending.length) throw new Error(plan.pending.length + ' rows still wait on the session (plan.mjs lists them); the live write takes none of them half done');
  if (t && !t.rehearsal && !plan.marked) throw new Error('the review page is not marked done: nothing goes to the live board before the user marks it, or, with no calls, gives the go in chat (plan.mjs --chat-go)');
  const env = { ...process.env, ...(t && t.env) };
  const results = t ? readJson(t.results, {}) : {};
  const manifest = t ? readJson(t.manifest, null) || { project: plan.project, label: plan.label, store: t.name, imports: [], left: [] } : null;
  const entry = (s, id) => ({ n: s.n, step: s.id, row: s.row, rows: s.rows, op: s.op, kind: KIND[s.op] || s.op, id, undo: undoArgs(s, id, plan.label), ...(s.files ? { files: s.files } : {}) });
  let imp = manifest && manifest.imports.find((i) => i.plan === plan.made && !i.undone);
  if (manifest && !imp) { imp = { plan: plan.made, at: new Date().toISOString(), steps: [] }; manifest.imports.push(imp); }
  const known = new Map(Object.entries(results).filter(([, r]) => r.id).map(([k, r]) => [k, r.id]));
  const tally = {};
  const refusals = [];
  const skipped = [];
  const scratch = [];
  log((t ? (t.rehearsal ? 'Rehearsal on ' + t.name : 'LIVE write to the board') : 'Dry run, nothing is written') + ': ' + plan.steps.length + ' steps for ' + plan.project.dir);
  /* a scratch board lacks the workstreams the plan names on the real one: a stand-in each */
  const standIn = new Map(Object.entries((results['stand-ins'] || {}).map || {}));
  if (t && t.rehearsal) {
    const named = new Set(JSON.stringify(plan.steps.map((s) => [s.args, s.stdin])).match(/"WS-\d+"/g) || []);
    for (const q of named) {
      const id = q.slice(1, -1);
      if (standIn.has(id)) continue;
      const r = run(cli, ['ws', 'create'], { stdin: JSON.stringify({ name: 'Rehearsal stand-in for ' + id, description: id + ' on the real board', projects: [plan.project.dir] }), env });
      if (!r.ok || !r.out) throw new Error('the rehearsal could not make a stand-in for ' + id + ': ' + r.why);
      standIn.set(id, r.out.id);
      log('stand-in ' + r.out.id + ' for ' + id);
    }
    results['stand-ins'] = { map: Object.fromEntries(standIn) };
  }
  const swap = (v) => (standIn.size ? JSON.parse(JSON.stringify(v ?? null).replace(/"(WS-\d+)"/g, (m, id) => (standIn.has(id) ? '"' + standIn.get(id) + '"' : m))) : v);
  for (const s of plan.steps) {
    const tag = '[' + s.n + '] ' + s.op + (s.row ? ' (' + clip(s.row, 70) + ')' : '');
    if (results[s.id] && results[s.id].id) {
      /* a step whose manifest line was lost to a crash after it landed is put back, so the undo still finds it */
      if (manifest && !manifest.imports.some((i) => i.steps.some((x) => x.step === s.id))) imp.steps.push(entry(s, results[s.id].id));
      tally[s.op] = (tally[s.op] || 0) + 1;
      continue;
    }
    /* started and never recorded: it may have landed, so it is never sent twice */
    if (t && results[s.id] && results[s.id].started) {
      const why = tag + ': an earlier run started it and recorded no id, so it may be on the board. Look for it (list --all --label ' + plan.label
        + ', its refs carry onboard:' + s.row + '), then put its id in ' + t.results + ' as "id", or delete its line if it is not there';
      refusals.push(why);
      if (!t.rehearsal) { writePointers(work, manifest, plan); log('\nStopped at step ' + s.n + '. ' + why); return { tally, refusals, skipped, stopped: s.n }; }
      continue;
    }
    let step = s;
    if (t && t.rehearsal) {
      const sc = scratchStep(s);
      if (sc.dropped.length) {
        scratch.push(tag + ': ' + sc.dropped.join(', ') + (sc.skip ? ', so the step is skipped' : ' left out'));
        if (sc.skip) continue;
        step = { ...s, args: sc.args, stdin: sc.stdin };
      }
    }
    const missing = [...JSON.stringify([s.args, s.stdin, s.body]).matchAll(REF)].map((m) => m[1]).filter((id) => !known.has(id));
    const sub = (v) => swap(JSON.parse(JSON.stringify(v ?? null).replace(REF, (_, id) => known.get(id) || '<the id step ' + (plan.steps.find((x) => x.id === id) || {}).n + ' makes>')));
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
    const r = run(cli, argv, { stdin: step.stdin ? JSON.stringify(sub(step.stdin)) : '', env });
    const id = r.ok ? idOf(s, r.out) : null;
    if (!r.ok || !id) {
      refusals.push(tag + ': ' + clip(r.ok ? 'it landed but gave no id: ' + JSON.stringify(r.out) : r.why, 400));
      /* a refusal wrote nothing, so the step can run again; one that landed with no id keeps its started mark */
      if (r.ok || /may have run/i.test(r.why)) results[s.id] = { started: results[s.id].started, raw: r.ok ? r.out : r.why }; else delete results[s.id];
      writeJson(t.results, results);
      if (!t.rehearsal) {
        writeJson(t.manifest, manifest);
        writePointers(work, manifest, plan);
        log('\nStopped at step ' + s.n + '. ' + refusals[refusals.length - 1] + '\nFix it and run again: the steps done are kept and skipped.');
        return { tally, refusals, skipped, stopped: s.n };
      }
      continue;
    }
    known.set(s.id, id);
    results[s.id] = { id, at: new Date().toISOString() };
    imp.steps.push(entry(s, id));
    writeJson(t.results, results);
    writeJson(t.manifest, manifest);
    tally[s.op] = (tally[s.op] || 0) + 1;
  }
  if (t) {
    imp.done = new Date().toISOString();
    manifest.left = [...new Set([...(manifest.left || []), ...plan.left])];
    writeJson(t.manifest, manifest);
    if (!t.rehearsal) writePointers(work, manifest, plan);
  }
  log('\n' + (t ? 'Written' : 'Would write') + ': ' + Object.entries(tally).map(([k, v]) => k + ' ' + v).join(', '));
  if (skipped.length) log('Skipped (' + skipped.length + '):\n  ' + skipped.join('\n  '));
  if (scratch.length) log('Named on the real board, which a scratch board lacks (' + scratch.length + '):\n  ' + scratch.join('\n  '));
  if (refusals.length) log('Refused (' + refusals.length + '):\n  ' + refusals.join('\n  '));
  if (plan.after.length) log('For the session after the write, with the user\'s OK:\n  ' + plan.after.map((a) => a.what).join('\n  '));
  if (plan.pending.length) log('Not in this plan, waiting on the session: ' + plan.pending.length + ' rows (plan.mjs lists them)');
  return { tally, refusals, skipped, scratch };
}

/* the short text each old handoff file becomes, last, with the user's OK: every import's
   tracks, so a write resumed after a stop still names the files the stopped run made tracks for */
export function pointers(manifest, plan) {
  const live = manifest.imports.filter((i) => !i.undone).flatMap((i) => i.steps);
  const ws = live.find((s) => s.kind === 'workstream');
  const holds = (file, id) => { try { return readFileSync(join(plan.project.dir, file), 'utf8').includes('track ' + id + ' on the AskerDo board'); } catch { return false; } };
  return live.filter((s) => s.op === 'track new').flatMap((s) => (s.files || []).filter((file) => !holds(file, s.id)).map((file) => ({
    file, track: s.id,
    text: '# Moved to the AskerDo board\n\nThis line of work is track ' + s.id + ' on the AskerDo board' + (ws ? ', in ' + ws.id : '') + '. Its old handoffs are the track\'s history there, each with its original date.\n\n'
      + 'Resume it in a session with `/askerdo resume ' + s.id + '`.\n\nThe text this file held stays in git history.\n',
  })));
}
const writePointers = (work, manifest, plan) => writeJson(join(work, 'pointers.json'), pointers(manifest, plan));

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
export async function quietWrite(f, { log = console.log, call = notifyCall, retryMs = 1000 } = {}) {
  const was = await call(null);
  const set = was && !was.pauseLabel ? await call({ pause: 'hour' }) : null;
  const ours = set && set.pausedUntil ? set.pausedUntil : null;
  log(ours ? 'Notifications paused for the write (an hour at most; lifted when it ends or stops).'
    : was && was.pauseLabel ? 'Notifications were already paused; the write leaves that pause as it is.' : 'The local server did not answer: notifications are not paused for the write.');
  try { return await f(); } finally {
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

/* a decision leaves only by a withdraw the user allows, one request each: the board asks rulings alone */
export function withdrawArgs(id, label, session) {
  return ['override', 'request', id, '--kind', 'withdraw', '--summary', 'Withdraw ' + id + ': the ' + label + ' import that wrote it was undone',
    '--reason', 'written by the ' + label + ' import, which was undone: the board never ruled it; the project\'s old record still holds it', '--session', session];
}

export function undoImport(work, { board, cli = DEFAULT_CLI, all = false, session, log = console.log } = {}) {
  const t = target(work, board || 'live');
  const manifest = readJson(t.manifest, null);
  if (!manifest || !manifest.imports.length) throw new Error('no manifest at ' + t.manifest + ': nothing was written there');
  const imps = manifest.imports.filter((i) => !i.undone);
  const pick = all ? imps : imps.slice(-1);
  const env = { ...process.env, ...t.env };
  const dry = !board;
  const rulings = pick.flatMap((i) => i.steps).filter((s) => s.kind === 'decision' && !s.undoneAt);
  if (!dry && rulings.length && !session) throw new Error('the undo files a withdraw request for each of its ' + rulings.length + ' decisions, which takes --session <own id>');
  log((dry ? 'Dry run of the undo' : 'Undo on ' + t.name) + ': ' + pick.length + ' import(s) of ' + manifest.label);
  const kept = [];
  const lines = [];
  const finished = [];
  const filed = [];
  const failed = [];
  for (const imp of pick.reverse()) {
    let clean = true;
    for (const s of imp.steps.slice().reverse()) {
      if (s.undoneAt) continue;
      if (s.kind === 'knowledge') { kept.push(s.id); continue; }
      /* every undo verb takes --session only to name who undid it */
      const args = s.kind === 'decision' ? withdrawArgs(s.id, manifest.label, session || '<own id>') : s.undo && [...s.undo, ...(session ? ['--session', session] : [])];
      if (!args) continue;
      if (dry) { log('  askerdo ' + args.map(shq).join(' ')); continue; }
      const r = run(cli, args, { env });
      /* a profile has to set something, so the board keeps its last line; its hold is already off */
      if (!r.ok && s.kind === 'rule line' && /would set nothing/.test(r.why)) { lines.push(s.id); s.undoneAt = new Date().toISOString(); continue; }
      /* no verb takes back a finished track: it stays finished, its tasks dropped above */
      if (!r.ok && s.kind === 'track' && /is already (done|dropped)/.test(r.why)) { if (/done/.test(r.why)) finished.push(s.id); s.undoneAt = new Date().toISOString(); continue; }
      if (!r.ok) { clean = false; failed.push(s.kind + ' ' + s.id + ': ' + clip(r.why, 200)); continue; }
      s.undoneAt = new Date().toISOString();
      if (s.kind === 'decision') { s.withdrawRequest = r.out && r.out.request; filed.push('#' + (r.out && r.out.request) + ' ' + s.id); }
    }
    if (!dry && clean) imp.undone = new Date().toISOString();
  }
  if (!dry) {
    const gone = new Set(pick.filter((i) => i.undone).flatMap((i) => i.steps.map((s) => s.row)));
    manifest.left = (manifest.left || []).filter((r) => !gone.has(r));
    writeJson(t.manifest, manifest);
  }
  if (failed.length) log('Refused (' + failed.length + '), run the undo again once each is fixed:\n  ' + failed.join('\n  '));
  if (filed.length) log('Withdraw requests filed (' + filed.length + '), each waiting on the user\'s Allow or Keep: ' + filed.join(', '));
  else if (dry && rulings.length) log('The ' + rulings.length + ' decisions leave only by a withdraw request the user allows: the undo files one each (--session <own id>).');
  if (lines.length) log('The board keeps a profile\'s last line, so these stay, on a profile no project holds now: ' + lines.join(', '));
  if (finished.length) log('Finished tracks stay finished, with their handoffs (no verb takes one back; their tasks are dropped): ' + finished.join(', '));
  if (kept.length) log('Knowledge records stay (' + kept.length + '): a withdraw takes only decisions and no verb removes one: ' + kept.join(', '));
  log('Handoffs go with their dropped tracks. Procedure cards stay: they follow their docs/procedures files, so they go when those files do.');
  return { failed, kept, lines, finished, filed };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const a = process.argv.slice(2);
  const flag = (n) => { const i = a.indexOf('--' + n); return i >= 0 ? a.splice(i, 2)[1] : undefined; };
  const bool = (n) => { const i = a.indexOf('--' + n); if (i >= 0) a.splice(i, 1); return i >= 0; };
  const board = flag('board'); const cli = flag('cli') || DEFAULT_CLI; const session = flag('session'); const undo = bool('undo'); const all = bool('all');
  if (!a[0] || a[0] === '--help') { console.log('node apply.mjs <work dir> [--board file:<db> | --board live] [--cli <path>] [--undo [--all] [--session <own id>]]'); process.exit(a[0] ? 0 : 1); }
  if (!existsSync(cli)) { console.error('apply: no CLI at ' + cli); process.exit(1); }
  try {
    const r = undo ? undoImport(a[0], { board, cli, all, session })
      : board === 'live' ? await quietWrite(() => applyPlan(a[0], { board, cli })) : applyPlan(a[0], { board, cli });
    process.exit(r.stopped || (r.failed && r.failed.length) ? 1 : 0);
  } catch (e) { console.error('apply: ' + e.message); process.exit(1); }
}
