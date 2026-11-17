/* Runs: one worker's go at one task or several, the record a
   task's word is computed from. A run is opened, renewed and ended here and nowhere else;
   who opens one (the mod for an agent, a take in hand for a session) is the caller's. */
import { readTx, tx } from '../db.mjs';
import { ENDED_TASK, TrackRefusal, headOf, keyOf, loadRecord, logLine } from './graph.mjs';
import { actorOf } from '../records.mjs';
import { holderWords } from '../web/feed.mjs';

export const RUN_ENDS = Object.freeze(['finished', 'handed_on', 'failed', 'taken_over', 'closed_idle']);
/* closed_idle stays a stored end that readers word; no new run ends that way */
const STORED_ONLY = 'closed_idle';
const WORKERS = ['agent', 'session'];

const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const list = (v) => (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v]);

/* True for a task with an open run; `session` binds one `?` for the session that started it. */
export function openRunSql(task = 'key', { session = false, worker } = {}) {
  if (worker !== undefined && !WORKERS.includes(worker)) throw new TypeError('a run\'s worker is agent or session');
  return `EXISTS (SELECT 1 FROM run_tasks rt JOIN runs r ON r.id = rt.run AND r.ended IS NULL WHERE rt.task = ${task}`
    + (session ? ' AND r.session = ?' : '') + (worker ? ` AND r.worker = '${worker}'` : '') + ')';
}

const COLS ='id, worker, agent_id, job, session, pc, repo, branch, start_commit, state_note, started, heard, ended, how, report, continue_line, landed, handoff';

function shape(db, r) {
  const tasks = db.stmt(`SELECT k.key, k.fields FROM run_tasks rt JOIN records k ON k.key = rt.task WHERE rt.run = ? ORDER BY k.id`).all(r.id)
    .map((t) => { const f = JSON.parse(t.fields); return { id: f.id, key: t.key, name: f.name }; });
  return {
    run: r.id, worker: r.worker, agentId: r.agent_id, job: r.job, session: r.session, pc: r.pc, repo: r.repo, branch: r.branch,
    startCommit: r.start_commit, stateNote: r.state_note, started: r.started, heard: r.heard, ended: r.ended, how: r.how,
    report: r.report, continueLine: r.continue_line, landed: r.landed, handoff: r.handoff, tasks,
  };
}

const runRow = (db, id) => db.stmt(`SELECT ${COLS} FROM runs WHERE id = ?`).get(id);
const openOnTask = (db, task) => db.stmt(`SELECT ${COLS} FROM runs r JOIN run_tasks rt ON rt.run = r.id
  WHERE rt.task = ? AND r.ended IS NULL ORDER BY r.started DESC, r.id DESC`).all(task);
const servedKeys = (db, id) => db.stmt('SELECT task FROM run_tasks WHERE run = ?').all(id).map((x) => x.task);

/* One line on each task served: an open names the run, its worker and job; an end adds how,
   and a take-over's end the session it was taken from, which hears it from this line. */
function logRun(db, c, r, how, note, continues) {
  const was = how ? [r.id, null] : [null, r.id];
  const pair = (v) => (how ? [v ?? null, null] : [null, v ?? null]);
  const changes = { run: was, worker: pair(r.worker), ...(r.job ? { job: pair(r.job) } : {}), ...(how ? { how: [null, how] } : {}),
    ...(how === 'taken_over' && r.session ? { session: [r.session, null] } : {}), ...(continues ? { continues: [null, continues] } : {}) };
  for (const key of servedKeys(db, r.id)) {
    const t = loadRecord(db, key);
    if (t) logLine(db, { at: c.at, verb: 'run', kind: 'task', rec: headOf(t), changes, by: c.by, pc: c.pc, note });
  }
}

function closeRun(db, r, c, { how, report, continueLine, landed, handoff, continues }, note) {
  db.stmt(`UPDATE runs SET ended = ?, how = ?, heard = max(heard, ?), report = coalesce(?, report), continue_line = coalesce(?, continue_line),
    landed = coalesce(?, landed), handoff = coalesce(?, handoff) WHERE id = ?`)
    .run(c.at, how, c.at, text(report), text(continueLine), text(landed), text(handoff), r.id);
  logRun(db, c, r, how, note, continues);
  return shape(db, runRow(db, r.id));
}

/* who runs it, as the session tells the user: the worker, the PC, since when, last heard. */
function runWords(r, c) {
  const who = r.worker === 'agent' ? 'agent ' + (r.job || 'with no job name') + ' of ' : '';
  return 'run ' + r.id + ' (' + who + holderWords({ pc: r.pc, since: r.started, seen: r.heard }, { now: c.date.getTime(), pc: c.pc }) + ')';
}

const howOf = (v) => {
  const s = String(v ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!RUN_ENDS.includes(s) || s === STORED_ONLY) throw new TrackRefusal('a run ends as one of: ' + RUN_ENDS.filter((x) => x !== STORED_ONLY).join(', '));
  return s;
};

/* Opens a run on one task or several for the actor's session. Another session's open run on
   any of them refuses it, naming that run; takeOver (the user's word, given to the caller)
   ends that run as taken over first. A session's second session run on a task gives back
   the one open; an agent id already open gives back its run. An agent id with no tasks serves the open tasks of this
   session's newest run with that id (an agent resumed under its id). A take-over that `continues` an earlier id of
   this session (a /clear) ends only that id's session run and leaves its agents' runs open under it. */
export function openRun(db, input = {}, actor) {
  return tx(db, () => {
    const c = actorOf(actor);
    let refs = [...new Set(list(input.tasks).map((x) => String(x ?? '').trim()).filter(Boolean))];
    if (!c.session) throw new TrackRefusal('a run is opened by a session: name the session');
    const agentId = text(input.agentId);
    let job = text(input.job);
    if (agentId) {
      const same = db.stmt(`SELECT ${COLS} FROM runs WHERE agent_id = ? AND ended IS NULL`).get(agentId);
      if (same) return { run: shape(db, same), opened: false, ended: [] };
    }
    if (!refs.length && agentId) {
      const last = db.stmt(`SELECT ${COLS} FROM runs WHERE agent_id = ? AND session = ? ORDER BY started DESC, id DESC LIMIT 1`).get(agentId, c.session);
      refs = last ? servedKeys(db, last.id).filter((k) => !ENDED_TASK.includes(loadRecord(db, k).fields.status)) : [];
      if (!refs.length) throw new TrackRefusal('no open task of a run of this session with agent id ' + agentId + ': name the tasks it serves');
      job = job || last.job;
    }
    if (!refs.length) throw new TrackRefusal('a run needs the task or tasks it serves');
    const worker = input.worker === undefined ? (agentId || job ? 'agent' : 'session') : input.worker;
    if (!WORKERS.includes(worker)) throw new TrackRefusal('a run\'s worker is agent or session');
    if (worker === 'agent' && !job) throw new TrackRefusal('an agent\'s run needs its job name');
    const tasks = [...new Set(refs.map((ref) => keyOf(db, ref, 'task')))].map((k) => loadRecord(db, k));
    for (const t of tasks) if (ENDED_TASK.includes(t.fields.status)) throw new TrackRefusal(t.fields.id + ' is ' + t.fields.status + '; an ended task takes no run');
    const goesOn = input.takeOver === true ? text(input.continues) : null;
    const others = new Map();
    for (const t of tasks) for (const r of openOnTask(db, t.key)) {
      if (r.session === c.session || (goesOn && r.session === goesOn && r.worker === 'agent')) continue;
      others.set(r.id, r);
    }
    if (others.size && input.takeOver !== true) {
      const named = [...others.values()];
      const ids = tasks.filter((t) => named.some((r) => servedKeys(db, r.id).includes(t.key))).map((t) => t.fields.id);
      throw new TrackRefusal(ids.join(', ') + (ids.length > 1 ? ' have' : ' has') + ' another session\'s open ' + named.map((r) => runWords(r, c)).join('; ')
        + ': tell the user who runs it; it moves only by a take-over, which needs the user\'s word', { runs: named.map((r) => shape(db, r)) });
    }
    let serve = tasks;
    if (worker === 'session') {
      const mine = new Map();
      for (const t of tasks) {
        const r = openOnTask(db, t.key).find((x) => x.session === c.session && x.worker === 'session');
        if (r) mine.set(t.key, r);
      }
      serve = tasks.filter((t) => !mine.has(t.key));
      if (!serve.length) return { run: shape(db, mine.get(tasks[0].key)), opened: false, ended: [] };
    }
    const ended = [...others.values()].map((r) => (goesOn && r.session === goesOn
      ? closeRun(db, r, c, { how: 'taken_over', continues: goesOn }, 'the same session goes on from its earlier id')
      : closeRun(db, r, c, { how: 'taken_over' }, 'taken over by ' + (c.pc ? 'a session on ' + c.pc : 'another session'))));
    const id = Number(db.stmt(`INSERT INTO runs (worker, agent_id, job, session, pc, repo, branch, start_commit, state_note, started, heard)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(worker, worker === 'agent' ? agentId : null, job, c.session, c.pc,
      text(input.repo), text(input.branch), text(input.startCommit), text(input.stateNote), c.at, c.at).lastInsertRowid);
    const join = db.stmt('INSERT INTO run_tasks (run, task) VALUES (?, ?)');
    for (const t of serve) join.run(id, t.key);
    const r = runRow(db, id);
    /* the open carries `continues` too, so the earlier id is told of neither row */
    logRun(db, c, r, null, text(input.note) || undefined, goesOn || undefined);
    return { run: shape(db, r), opened: true, ended };
  });
}

/* The open runs on one task, newest first: a refusal names one, a let go ends one. */
export const openRunsOn = (db, key) => openOnTask(db, key);

/* Ends the open runs of `session` (else the actor's) on `tasks` (else all of them) of one
   worker, as `how`; the line carries `note`. Gives back the keys of the tasks served. */
export function endSessionRuns(db, { session, tasks, worker = 'session', how = 'handed_on', handoff, note } = {}, actor) {
  const c = actorOf(actor);
  const s = text(session) || c.session;
  if (!s) return [];
  const want = tasks ? new Set(list(tasks)) : null;
  const rows = db.stmt(`SELECT ${COLS} FROM runs WHERE session = ? AND worker = ? AND ended IS NULL ORDER BY started DESC, id DESC`).all(s, worker)
    .filter((r) => !want || servedKeys(db, r.id).some((k) => want.has(k)));
  const keys = [];
  for (const r of rows) {
    for (const k of servedKeys(db, r.id)) if (!keys.includes(k)) keys.push(k);
    closeRun(db, r, c, { how: howOf(how), handoff }, text(note) || undefined);
  }
  return keys;
}

/* The open runs on a task that a session other than `session` started (every one for none). */
export const othersRuns = (db, key, session) => openOnTask(db, key).filter((r) => r.session !== session);

/* a close over another session's open run takes it over, which needs the user's word. */
export const heldWords = (id, runs, actor) => {
  const c = actor && actor.date instanceof Date ? actor : actorOf(actor);
  return id + ' has another session\'s open ' + runs.map((r) => runWords(r, c)).join('; ');
};

export function closeHeldRefusal(db, id, runs, actor) {
  return new TrackRefusal(heldWords(id, runs, actor) + ', which a close would end: tell the user who runs it. It closes over that run only by a take-over'
    + ' with the user\'s word (takeOver true with the status on task_update, or --take-over with --status on the CLI), which that session hears at its next prompt',
  { runs: runs.map((r) => shape(db, r)) });
}

/* A task's ending ends its open runs, finished at a done and handed on at a drop; another
   session's run ends taken over only with `takeOver`, so that session hears it. A closer
   with no session (the user's own press) ends them as its own. */
export function endTaskRuns(db, key, ending, actor, { takeOver = false } = {}) {
  const c = actorOf(actor);
  const t = loadRecord(db, key);
  const held = c.session ? othersRuns(db, key, c.session) : [];
  if (held.length && !takeOver) throw closeHeldRefusal(db, t.fields.id, held, c);
  for (const r of openOnTask(db, key)) {
    const other = c.session && r.session !== c.session;
    closeRun(db, r, c, { how: other ? 'taken_over' : ending === 'done' ? 'finished' : 'handed_on' },
      other ? ending + ' by ' + (c.pc ? 'a session on ' + c.pc : 'another session') : undefined);
  }
}

export { HEARD_MS } from '../paths.mjs';

const msOf = (s) => { const t = Date.parse(s || ''); return Number.isFinite(t) ? t : -Infinity; };

/* Who is on each task, read from its runs, the one read behind the graph's node and a shown
   record: the open session run's session and start; the newest open agent run's job, else the
   newest run's when it is an agent's; its open runs and its last ended run, which the word reads. */
export function workersOf(db, keys) {
  const out = new Map();
  const want = [...new Set(list(keys))].filter(Boolean);
  for (const k of want) out.set(k, { inHand: null, inHandSince: null, agent: null, open: [], last: null });
  if (!want.length) return out;
  const rows = db.stmt(`SELECT rt.task, r.id, r.worker, r.agent_id, r.job, r.session, r.pc, r.started, r.heard, r.ended, r.how FROM run_tasks rt
    JOIN runs r ON r.id = rt.run WHERE rt.task IN (SELECT value FROM json_each(?)) ORDER BY r.started DESC, r.id DESC`).all(JSON.stringify(want));
  const newest = new Map();
  const agentSeen = new Set();
  for (const r of rows) {
    const w = out.get(r.task);
    if (!newest.has(r.task)) newest.set(r.task, r);
    const run = { run: r.id, worker: r.worker, job: r.job || null, agentId: r.agent_id || null, session: r.session, pc: r.pc || null };
    if (!r.ended) w.open.push({ ...run, started: r.started, heard: r.heard || r.started });
    else if (!w.last || msOf(r.ended) > msOf(w.last.ended)) w.last = { ...run, ended: r.ended, how: r.how };
    if (!r.ended && r.worker === 'session' && !w.inHand) { w.inHand = r.session; w.inHandSince = r.started; }
    /* the newest open agent run, wherever an ended one sits before it */
    if (r.worker !== 'agent' || r.ended || agentSeen.has(r.task)) continue;
    agentSeen.add(r.task);
    w.agent = r.job;
  }
  for (const [task, r] of newest) if (!agentSeen.has(task) && r.worker === 'agent') out.get(task).agent = r.job;
  return out;
}

/* Of a task's open runs, the one its word names: heard last, an agent's before the session's on a tie. */
export function leadRun(open) {
  let best = null;
  for (const r of open || []) {
    const d = best ? msOf(r.heard) - msOf(best.heard) : 1;
    if (d > 0 || (d === 0 && r.worker === 'agent' && best.worker !== 'agent')) best = r;
  }
  return best;
}

/* A task's front as shown or sent: its stored status, its word (graph.mjs wordOf) and who is
   on it from runs; never stored. */
export function withWorkers(front, w) {
  if (!front || !w) return front;
  const out = { ...front };
  for (const k of ['inHand', 'inHandSince', 'agent', 'word']) { if (w[k]) out[k] = w[k]; else delete out[k]; }
  return out;
}

/* Last heard is now on the named open runs of the actor's session (with `sessionRuns`, its
   session-worker runs too), or on all of them; one statement and no activity row, as a
   lease's renewal. Gives back the session's open runs. */
export function renewRuns(db, input = {}, actor) {
  const c = actorOf(actor);
  if (!c.session) throw new TrackRefusal('renewing runs needs the session');
  const runs = list(input.runs).map(Number).filter(Number.isSafeInteger);
  const agents = list(input.agentIds).map(text).filter(Boolean);
  const own = input.sessionRuns === true;
  return tx(db, () => {
    const all = !runs.length && !agents.length && !own;
    db.stmt(`UPDATE runs SET heard = ? WHERE ended IS NULL AND session = ? AND (? OR (? AND worker = 'session') OR id IN (SELECT value FROM json_each(?))
      OR agent_id IN (SELECT value FROM json_each(?)))`).run(c.at, c.session, all ? 1 : 0, own ? 1 : 0, JSON.stringify(runs), JSON.stringify(agents));
    /* `at` is the stamp written, so a reader can tell the runs this renewal heard from the ones it left */
    return { runs: openOfSession(db, c.session), at: c.at };
  });
}

/* Ends one of the actor's session's runs: by its number, else its open run with that agent id
   or job name. Ending an ended run never reopens it or moves its end: it fills only the
   report, CONTINUE line, landing commit and handoff it still lacks, with no activity row.
   `place` ({ repo, branch, startCommit }) sets where an agent's run worked, open or ended,
   since an isolated agent's worktree is known only from its result; with it, `how` may go. */
export function endRun(db, input = {}, actor) {
  const c = actorOf(actor);
  if (!c.session) throw new TrackRefusal('ending a run needs the session');
  const p = input.place && typeof input.place === 'object' ? input.place : null;
  const place = p ? { repo: text(p.repo), branch: text(p.branch), startCommit: text(p.startCommit) } : null;
  if (p && !place.repo && !place.branch && !place.startCommit) throw new TrackRefusal('place names repo, branch or startCommit');
  const how = place && (input.how === undefined || input.how === null) ? null : howOf(input.how);
  return tx(db, () => {
    const n = Number(input.run);
    const agentId = text(input.agentId);
    const job = text(input.job);
    const r = Number.isSafeInteger(n) && n > 0 ? runRow(db, n)
      : agentId ? db.stmt(`SELECT ${COLS} FROM runs WHERE agent_id = ? AND session = ? ORDER BY ended IS NOT NULL, id DESC LIMIT 1`).get(agentId, c.session)
        : job ? db.stmt(`SELECT ${COLS} FROM runs WHERE job = ? AND session = ? ORDER BY ended IS NOT NULL, id DESC LIMIT 1`).get(job, c.session) : null;
    if (!r) throw new TrackRefusal('no run of this session ' + (n ? 'numbered ' + n : agentId ? 'with agent id ' + agentId : job ? 'with job ' + job : 'named: give run, agentId or job'));
    if (r.session !== c.session) throw new TrackRefusal('run ' + r.id + ' is another session\'s; it ends only by a take-over');
    if (place) {
      if (r.worker !== 'agent') throw new TrackRefusal('run ' + r.id + ' is a session\'s own; only an agent\'s run takes a place');
      db.stmt('UPDATE runs SET repo = coalesce(?, repo), branch = coalesce(?, branch), start_commit = coalesce(?, start_commit) WHERE id = ?')
        .run(place.repo, place.branch, place.startCommit, r.id);
      if (!how) return { run: shape(db, runRow(db, r.id)), ended: false };
    }
    if (r.ended) {
      db.stmt(`UPDATE runs SET report = coalesce(report, ?), continue_line = coalesce(continue_line, ?), landed = coalesce(landed, ?),
        handoff = coalesce(handoff, ?) WHERE id = ?`).run(text(input.report), text(input.continueLine), text(input.landed), text(input.handoff), r.id);
      return { run: shape(db, runRow(db, r.id)), ended: false };
    }
    return { run: closeRun(db, r, c, { ...input, how }), ended: true };
  });
}

function openOfSession(db, session) {
  return db.stmt(`SELECT ${COLS} FROM runs WHERE session = ? AND ended IS NULL ORDER BY started DESC, id DESC`).all(session).map((r) => shape(db, r));
}

/* A session's open runs, newest first: the input's session, else the actor's. */
export function sessionRuns(db, input = {}, actor) {
  const session = text(input && input.session) || actorOf(actor).session;
  if (!session) throw new TrackRefusal('name the session whose runs to read');
  return readTx(db, () => ({ session, runs: openOfSession(db, session) }));
}

/* Every run that served a task, newest first. */
export function taskRuns(db, input = {}) {
  return readTx(db, () => {
    const key = keyOf(db, input && input.task, 'task');
    const runs = db.stmt(`SELECT ${COLS} FROM runs r JOIN run_tasks rt ON rt.run = r.id WHERE rt.task = ? ORDER BY r.started DESC, r.id DESC`).all(key);
    return { task: loadRecord(db, key).fields.id, key, runs: runs.map((r) => shape(db, r)) };
  });
}
