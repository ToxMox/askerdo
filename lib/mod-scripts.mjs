/* The mod's scripts as functions: the local server runs them in
   process on its `local/mod` route, and scripts/<name>.mjs runs the same function
   when the mod has to start a process. Each takes { argv, env, stdin } and answers
   { code, stdout, stderr }; its modules load only when it runs. */
import { statSync } from 'node:fs';

const ok = (text) => ({ code: 0, stdout: text + '\n', stderr: '' });
const fail = (who, msg) => ({ code: 1, stdout: '', stderr: who + ': ' + msg + '\n' });
const flagOf = (argv) => (name) => {
  const i = argv.indexOf('--' + name);
  return i < 0 ? undefined : argv[i + 1];
};
const stdinOf = (stdin) => (typeof stdin === 'function' ? stdin() : stdin === undefined ? '' : String(stdin));

/* The personal alias for /askerdo: { alias } or { error }, with the cards' press setting. */
async function modAlias({ argv, env }) {
  const [{ loadConfig }, { checkAlias }] = await Promise.all([import('./node-helpers.mjs'), import('./mod-core.mjs')]);
  const cfg = loadConfig(env);
  /* the cards' press setting rides the same read */
  const r = { ...checkAlias(cfg ? cfg.alias : undefined), presses: cfg && cfg.answerPresses === 'once' ? 'once' : 'confirm' };
  return ok(argv.includes('--json') ? JSON.stringify(r) : r.error ? 'error: ' + r.error : r.alias || '(no alias)');
}

/* builder.js read again when it changes: the live wire (CLAUDE.md) reaches a long-lived server too */
async function builder() {
  const url = new URL('./builder.js', import.meta.url);
  let v = '';
  try { v = String(statSync(url).mtimeMs); } catch {}
  return import(url.href + (v ? '?v=' + v : ''));
}

/* The mod's contract section, both surfaces' sections and the reply checks' switches. */
async function modContract({ argv, env }) {
  const [{ buildModSection, buildSurfaceSection, queueMode }, { loadConfig }] = await Promise.all([builder(), import('./node-helpers.mjs')]);
  const cfg = loadConfig(env);
  let out = { section: null, checks: null };
  if (cfg) {
    out = {
      section: buildModSection(cfg),
      checks: { emdash: !!cfg.emdash, forecast: !!cfg.forecast, weather: !!cfg.weather, hub: queueMode(cfg) === 'hub' },
      /* both surfaces' sections, with the mod's own lines; the mod picks the session's one */
      surfaces: { desktop: buildSurfaceSection(cfg, 'desktop', true), terminal: buildSurfaceSection(cfg, 'terminal', true) },
    };
  }
  return ok(argv.includes('--json') ? JSON.stringify(out) : out.section || '(no saved options: no contract section)');
}

/* The PC's half of a board read for a project: its remote and dir map (the board cannot read git). */
async function placeOf(cwd) {
  const [{ normProjectDir }, { repoOf }] = await Promise.all([import('./profiles.mjs'), import('./project-id.mjs')]);
  const dir = normProjectDir(cwd);
  const repo = repoOf(dir) || undefined;
  return { dir, where: { cwd: dir, repo, repos: repo ? { [dir]: repo } : {} } };
}

/* The rules in force, resolved on the board: the held track's, else the task's in hand, else the project's. */
async function rules({ argv, env }) {
  const flag = flagOf(argv);
  const cwd = flag('cwd');
  const session = flag('session');
  const track = flag('track');
  const no = (m) => fail('rules', m);
  if (!cwd) return no('--cwd takes the project directory');
  if (session !== undefined && !/^[A-Za-z0-9._-]+$/.test(session)) return no('--session takes a session id');
  if (track !== undefined && !/^(TR-\d+|[0-9a-hjkmnp-tv-z]{8})$/.test(track)) return no('--track takes a TR-n id or a track key');
  const [{ boardCall }, { sandboxHome }, { rulesBlock, rulesText }] = await Promise.all([
    import('./board-call.mjs'), import('./node-helpers.mjs'), import('./profiles.mjs')]);
  const seam = sandboxHome(env);
  if (seam && seam.problem) return no(seam.problem);
  const { where } = await placeOf(cwd);
  /* both blocks, the session's and its agents' */
  const b = rulesBlock(await boardCall('rulesFor', { ...where, track, session }, { session, env }));
  return ok(argv.includes('--json') ? JSON.stringify(b) : rulesText(b));
}

/* The depth settings, resolved on the board: what is in force,
   the session's marker kept current. --project on|off is /askerdo guard, the board's profileGuard. */
async function depthMarker({ argv, env }) {
  const flag = flagOf(argv);
  const cwd = flag('cwd');
  const session = flag('session');
  const track = flag('track');
  const project = flag('project');
  const ID = /^[A-Za-z0-9._-]+$/;
  const no = (m) => fail('depth-marker', m);
  if (!cwd) return no('--cwd takes the project directory');
  if (session !== undefined && !ID.test(session)) return no('--session takes a session id');
  if (track !== undefined && !/^[0-9a-hjkmnp-tv-z]{8}$/.test(track)) return no('--track takes a track key');
  if (project !== undefined && project !== 'on' && project !== 'off') return no('--project takes on or off');
  const [{ boardCall }, { claudeHome, sandboxHome }, P] = await Promise.all([
    import('./board-call.mjs'), import('./node-helpers.mjs'), import('./profiles.mjs')]);
  const seam = sandboxHome(env);
  if (seam && seam.problem) return no(seam.problem + '; nothing was written');
  const { dir, where } = await placeOf(cwd);
  const home = claudeHome(env);
  const call = (name, input) => boardCall(name, input, { session, env });
  const written = [];
  const removed = [];
  const note = (r) => { if (r.did === 'written') written.push(r.path); if (r.did === 'removed') removed.push(r.path); };
  let problem = '';
  let eff;
  try {
    if (project) {
      await call('profileGuard', { project: dir, repo: where.repo, want: project });
      /* a held track's marker follows below; the project's own marker follows the guard here */
      if (track) note(P.syncMarker(home, dir, undefined, await call('resolveSession', where)));
    }
    /* a held track's folder is its key */
    eff = await call('resolveSession', { ...where, track });
  } catch (e) { problem = 'the board: ' + e.message; }
  /* a board that could not be read leaves the marker as it is and
     reports what that marker holds, never the built-ins it would have synced */
  if (!eff) eff = P.builtIns();
  const kept = problem ? P.readMarker(home, dir, track) : null;
  const m = problem ? { path: P.markerPath(home, dir, track), did: kept ? 'kept' : 'none' } : P.syncMarker(home, dir, track, eff);
  note(m);
  const v = P.valuesOf(eff);
  if (kept) {
    const a = kept.agent && typeof kept.agent === 'object' ? kept.agent : {};
    const mt = kept.meter && typeof kept.meter === 'object' ? kept.meter : {};
    const pick = (k, x) => { if (x !== undefined) v[k] = x; };
    pick('agent.on', a.on === true); pick('agent.soft', a.soft); pick('agent.hard', a.hard); pick('agent.remind', a.remind);
    pick('agent.hardDeny', a.hardDeny); pick('main.on', mt.on); pick('main.window', mt.window); pick('main.wrap', mt.wrap);
  }
  const on = eff.settings['agent.on'];
  const r = {
    on: v['agent.on'],
    source: kept ? { level: 'marker', record: m.path } : on.profile ? { profile: on.profile, record: on.record, level: on.level } : null,
    guard: { soft: v['agent.soft'], hard: v['agent.hard'], remind: v['agent.remind'], hardDeny: v['agent.hardDeny'] },
    main: { on: v['main.on'], window: v['main.window'], wrap: v['main.wrap'] },
    sources: kept ? {} : Object.fromEntries(Object.keys(P.SETTINGS).filter((k) => eff.settings[k] && eff.settings[k].profile)
      .map((k) => [k, eff.settings[k].profile + ' on ' + eff.settings[k].record])),
    path: m.did === 'none' || m.did === 'removed' ? null : m.path,
    written: [...new Set(written)], removed: [...new Set(removed)],
    ...(problem ? { problem } : {}),
  };
  return ok(argv.includes('--json') ? JSON.stringify(r)
    : 'agent guard ' + (r.on ? 'on' : 'off') + (r.source ? ' (' + r.source.profile + ' on ' + r.source.record + ')' : '') + (r.path ? ': ' + r.path : ''));
}

/* One key per event, so a leftover read twice is told once; a board line keys by
   its activity sequence. */
const keyOf = (ev) => (Number.isInteger(ev.seq) ? 'seq:' + ev.seq
  : [ev.at, ev.kind, ev.id, ev.pick || '', ev.amended ? 'amended' : '', ev.by || ''].join('|'));

function parseLines(text) {
  const out = [];
  for (const raw of String(text).split('\n')) {
    if (!raw.trim()) continue;
    try { out.push(JSON.parse(raw)); } catch {}
  }
  return out;
}

/* A session's inbox for the mod's answer delivery: take, put or
   peek, under the root's lock as the local server takes it; outside hub mode nothing is touched.
   a take keeps what it answers in the processing file until a later take acks its
   keys (--ack, stdin { session: [key] }), so a reply that never arrives loses nothing.
   --lineage names the ids before a /clear, all read in this one call. */
async function modInbox({ argv, env, stdin }) {
  const flag = flagOf(argv);
  const verb = argv[0];
  const session = flag('session');
  const id = flag('id');
  if (verb !== 'take' && verb !== 'put' && verb !== 'peek') return fail('mod-inbox', 'take, put or peek');
  if (!session) return fail('mod-inbox', '--session takes a session id');
  const say = (v) => ok(JSON.stringify(v));
  const [fs, { dirname, join }, { loadConfig, storeRoot }] = await Promise.all([import('node:fs'), import('node:path'), import('./node-helpers.mjs')]);
  const cfg = loadConfig(env);
  if (!cfg || cfg.queue !== 'hub') return say({ events: [], off: 'not hub mode' });
  const root = storeRoot(undefined, env);
  const boxes = [session, ...String(flag('lineage') || '').split(',').filter((s) => s && s !== session)];
  let acks = {};
  if (verb === 'take' && argv.includes('--ack')) { try { acks = JSON.parse(stdinOf(stdin)) || {}; } catch {} }
  const { inboxFile, inboxName, lineFor, processingPrefix, withLock } = await import('./local-inbox.mjs');
  let names = [];
  try { names = fs.readdirSync(join(root, 'inbox')); } catch {}
  const has = (s) => names.some((n) => n === inboxName(s) + '.jsonl' || (n.startsWith(inboxName(s) + '.processing-') && n.endsWith('.jsonl')));
  if (verb !== 'put' && !boxes.some(has)) return say({ events: [] });
  const events = (evs) => {
    const seen = new Set();
    return evs.map((ev) => ({ key: keyOf(ev), line: lineFor(ev), raw: ev })).filter((e) => e.line && !seen.has(e.key) && seen.add(e.key));
  };
  const inbox = inboxFile(root, session);
  const dir = dirname(inbox);
  if (!fs.existsSync(dir)) return say({ events: [] });
  if (verb === 'put') {
    let evs = [];
    try { evs = JSON.parse(stdinOf(stdin)); } catch {}
    const lines = (Array.isArray(evs) ? evs : []).map((e) => (e && e.raw ? e.raw : e)).filter((e) => e && typeof e === 'object');
    if (lines.length) await withLock(root, {}, () => fs.appendFileSync(inbox, lines.map((e) => JSON.stringify(e) + '\n').join('')));
    return say({ put: lines.length });
  }
  let told;
  await withLock(root, {}, () => {
    if (id && verb === 'take') {
      let fresh = '';
      try { if (fs.statSync(inbox).isFile()) fresh = fs.readFileSync(inbox, 'utf8'); } catch {}
      const all = parseLines(fresh);
      const mine = all.filter((ev) => ev.id === id);
      told = say({ events: events(mine) });
      if (mine.length) {
        const rest = all.filter((ev) => ev.id !== id);
        if (rest.length) fs.writeFileSync(inbox, rest.map((ev) => JSON.stringify(ev) + '\n').join(''));
        else fs.rmSync(inbox, { force: true });
      }
      return;
    }
    const all = [];
    for (const box of boxes) all.push(...readBox(box).map((e) => ({ ...e, box })));
    told = say({ events: all });
  });
  return told;

  /* One inbox: the lines taken before and not acked first, then the fresh ones. */
  function readBox(box) {
    const inbox = inboxFile(root, box);
    let fresh = '';
    try { if (fs.statSync(inbox).isFile()) fresh = fs.readFileSync(inbox, 'utf8'); } catch {}
    const prefix = processingPrefix(inbox);
    const kept = join(dir, prefix + 'mod.jsonl');
    const listed = fs.readdirSync(dir).filter((n) => n.startsWith(prefix) && n.endsWith('.jsonl')).sort().map((n) => join(dir, n));
    const files = [...listed.filter((f) => f === kept), ...listed.filter((f) => f !== kept)];
    let text = '';
    for (const f of files) { try { text += fs.readFileSync(f, 'utf8') + '\n'; } catch {} }
    const drop = new Set(Array.isArray(acks[box]) ? acks[box].map(String) : []);
    const evs = events(parseLines(text + fresh).filter((ev) => !drop.has(keyOf(ev))));
    if (verb === 'peek' || (!fresh && !drop.size && files.length === 1 && files[0] === kept)) return evs;
    /* written before anything is removed: a crash tells twice, never loses */
    if (evs.length) {
      fs.writeFileSync(kept + '.tmp', evs.map((e) => JSON.stringify(e.raw) + '\n').join(''));
      fs.renameSync(kept + '.tmp', kept);
    }
    for (const f of [...files.filter((f) => f !== kept || !evs.length), ...(fresh ? [inbox] : [])]) { try { fs.rmSync(f, { force: true }); } catch {} }
    return evs;
  }
}

/* the user's queued answers, kept in this PC's data folder until Send, by session. read
   prints the session's (its /clear lineage folded in); write (stdin, a list) replaces them
   and drops the lineage's, and sessions untouched for QUEUE_DAYS go. */
const QUEUE_FILE = 'queued-answers.json';
const QUEUE_DAYS = 30;
async function modQueue({ argv, env, stdin }) {
  const flag = flagOf(argv);
  const verb = argv[0];
  const session = flag('session');
  if (verb !== 'read' && verb !== 'write') return fail('mod-queue', 'read or write');
  if (!session || !/^[A-Za-z0-9._-]+$/.test(session)) return fail('mod-queue', '--session takes a session id');
  const [fs, { join }, { dataDir }] = await Promise.all([import('node:fs'), import('node:path'), import('./node-helpers.mjs')]);
  const dir = dataDir(env);
  if (!dir) return fail('mod-queue', 'no AskerDo data folder on this PC');
  const file = join(dir, QUEUE_FILE);
  let all = {};
  try { all = JSON.parse(fs.readFileSync(file, 'utf8')).sessions || {}; } catch {}
  const lineage = String(flag('lineage') || '').split(',').filter((s) => s && s !== session);
  const listOf = (s) => (all[s] && Array.isArray(all[s].answers) ? all[s].answers : []);
  if (verb === 'read') {
    const out = [...listOf(session)];
    for (const s of lineage) for (const a of listOf(s)) if (a && !out.some((x) => x.id === a.id)) out.push(a);
    return ok(JSON.stringify({ answers: out }));
  }
  let list;
  try { list = JSON.parse(stdinOf(stdin)); } catch {}
  if (!Array.isArray(list)) return fail('mod-queue', 'stdin takes the list of queued answers as JSON');
  const now = Date.now();
  const kept = {};
  for (const [s, v] of Object.entries(all)) {
    if (s !== session && !lineage.includes(s) && v && now - Number(v.at || 0) < QUEUE_DAYS * 86400000) kept[s] = v;
  }
  if (list.length) kept[session] = { at: now, answers: list };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file + '.tmp', JSON.stringify({ sessions: kept }, null, 2) + '\n');
  fs.renameSync(file + '.tmp', file);
  return ok(JSON.stringify({ saved: list.length }));
}

export const SCRIPTS = { 'mod-alias': modAlias, 'mod-contract': modContract, rules, 'depth-marker': depthMarker, 'mod-inbox': modInbox, 'mod-queue': modQueue };

/* { argv: [script, ...args], env, stdin } in, { code, stdout, stderr } out. */
export async function runScript({ argv, env = process.env, stdin }) {
  const run = SCRIPTS[argv && argv[0]];
  if (!run) return fail('mod-scripts', 'no mod script ' + String(argv && argv[0]));
  try {
    return await run({ argv: argv.slice(1), env, stdin });
  } catch (e) {
    return fail(argv[0], (e && e.message) || String(e));
  }
}

/* A script file's whole body: run it on this process's argv and print what it answers. */
export async function runAsScript(name) {
  const { readFileSync } = await import('node:fs');
  const r = await runScript({ argv: [name, ...process.argv.slice(2)], env: process.env, stdin: () => readFileSync(0, 'utf8') });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  process.exitCode = r.code;
}
