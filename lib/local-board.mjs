/* Each PC's local server, its board half:
   one event-stream connection to the board, its cursor on disk, the working set in
   memory, inbox lines and alerts by sequence, reads from the cache, writes passed
   through. hooks/board-server.mjs mounts it; lib/local-route.mjs serves it. */
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { boardEvents, boardRequest, refusalOf, signedPage } from './board-call.mjs';
import { API, WEB } from '../server/paths.mjs';
import { layoutGraph, layoutInput } from '../server/layout.mjs';
import { foreign, sameDir } from '../server/verbs/proc-cards.mjs';
import { findCards, matchCall } from './proc-match.mjs';
import { bandModel } from './mod-core.mjs';
import { blockingCount, dotState, trayCards, trayWaitingCards, waitingCount } from './board-state.mjs';
import { appendInbox, seqsIn, tellingsOf, withLock } from './local-inbox.mjs';
import { enrichEvents } from './notify.mjs';
import { writeAtomic } from './store-io.mjs';
import { readMap } from './project-map.mjs';
import { checkoutOf, normDir, sharedName, shortName } from './project-id.mjs';
import { dataDir } from './node-helpers.mjs';

export const KEEPALIVE_MS = 20000;
const BACKOFF_MS = [250, 500, 1000, 2000, 5000];
const CLOSED_KEEP = 50;
/* the question verbs that take it out of the open set */
const SETTLES = ['answer', 'drop', 'snooze'];
/* the most a woken question's alert waits on the board for its waker's name */
const NAME_READ_MS = 300;
/* a band scope nobody asked for in this long is not refetched on a change */
const SCOPE_IDLE_MS = 30 * 60000;
/* a held lease's last seen, renewed by the band at most this often (the quiet rule reads hours) */
const RENEW_MS = 60000;
const WAIT_MAX_MS = 60000;
/* a lease goes quiet with time alone (no row), so a held line's view and the shelf are read again this often */
const QUIET_READ_MS = 60 * 60000;
const PC_READ_MS = 60000;
/* a shelf track's due loose files are counted from this PC's lists at most this often */
const LOOSE_READ_MS = 60000;
/* a call in the first moments after start waits this long for the first connect */
const FIRST_CONNECT_MS = 5000;
const NOT_YET = 'not connected yet';
const PLACES_KEEP = 500;
const OPEN_Q = ['open', 'snoozed'];
const ENDED_TASK = ['completed', 'dropped'];
const SCOPE_TASK = ['inHand', 'subscribers', 'workstream', 'status', 'track'];

/* The reads a caller may get from memory: the memo is cleared by every change. */
export const READ_VERBS = new Set(['show', 'list', 'peekOpenQuestions', 'peekSessionScope', 'namesLine', 'readRecord', 'listWork',
  'waitsOn', 'trackSummary', 'trackView', 'listTracks', 'workstreamView', 'trackFound', 'effective', 'resolveSession', 'rulesFor', 'profileList', 'settings',
  'procedureCards', 'triggerCards', 'resolveLabel', 'boardSnapshot', 'workingSet', 'heldTask', 'resumeCutoff', 'search', 'activity',
  'shelf', 'trackKickoff', 'trackHandoffs', 'decisionsFor', 'decisionsSince', 'decisionTriggers', 'recordHistory', 'overrideView', 'coverage']);
/* Reads that hang on the clock as well as the board (stall days, purge dates): never kept, never clearing the memo. */
export const LIVE_READS = new Set(['bandCalls', 'upkeepDryRun']);
const isRead = (name) => READ_VERBS.has(name) || LIVE_READS.has(name);

export class BoardOffline extends Error {
  constructor(message) { super(message); this.status = 503; }
}

const dayOf = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

/* a journal's newest note as { at, text }, split as journalEntries splits (lib/cli-commands.mjs):
   a note starts with its stamp on a line after a blank one */
const STAMP = /^(\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2})?): /;
function newestNote(journal) {
  const lines = String(journal || '').split('\n');
  let start = 0;
  lines.forEach((l, i) => { if ((i === 0 || lines[i - 1].trim() === '') && STAMP.test(l)) start = i; });
  const m = STAMP.exec(lines[start] || '');
  const text = lines.slice(start).join('\n').slice(m ? m[0].length : 0).trim();
  return text ? { at: m ? m[1] : null, text } : null;
}

/* createLocalBoard({ url, token, stateDir, inboxDir, alert, retract, log, keepaliveMs, local, now, timing, env }):
   inbox appends take the root's lock (inboxDir's parent), as the drains do; `alert({ questions, work })`
   gets each live row's alert events; `retract(id)` each question answered, dropped or snoozed, a
   catch-up's too, ahead of its alert; `local` is this server's own base URL; `timing(verb, ms, status)`
   is the local timings log (localTimings in lib/local-route.mjs); `env` finds the inbox the band peeks. */
export function createLocalBoard({
  url, token, stateDir, inboxDir, alert = null, retract = null, log = () => {},
  keepaliveMs = KEEPALIVE_MS, local = null, now = () => new Date(), timing = () => {}, env = process.env,
} = {}) {
  if (!url) throw new TypeError('the local board needs the board URL');
  const lock = (fn) => withLock(dirname(inboxDir), {}, fn);
  const cursorFile = join(stateDir, 'cursor.json');
  const base = String(url).replace(/\/+$/, '');
  /* a record's page through this server's signed path, so a browser lands signed in */
  const pageOf = (key) => (local ? signedPage(local, key) : base + WEB.record(key));
  let cursor = readCursor();
  const placesFile = join(stateDir, 'sessions.json');
  const places = readPlaces();
  /* sessions that called this local server: their rows name this PC's device */
  const ours = new Set();
  let seq = 0;
  let loaded = false;
  let online = false;
  /* the board's own word on its version, said first on each stream; null until then */
  let boardVersion = null;
  let why = NOT_YET;
  let refused = '';
  let live = false;
  let stopping = false;
  let conn = null;
  let retry = 0;
  let retryTimer = null;
  let lastData = 0;
  let resync = false;
  let gen = 0;
  let halted = false;
  let pokedDay = '';
  let quietRead = Date.now();
  let memoDay = dayOf(now());
  /* handoffs: each track's last handoff by label, read when the band first needs it */
  const cache = { questions: new Map(), workstreams: new Map(), tasks: new Map(), views: new Map(), profiles: null, cards: [], closed: [], shelf: [], handoffs: new Map() };
  /* handoff rows seen per track, so a read that a newer row overtook is not kept */
  const handoffRows = new Map();
  const renewed = new Map();
  /* the seq of the last profiles read, so the mod reads its guard again after an edit */
  let profilesAt = 0;
  const memo = new Map();
  const scopes = new Map();
  /* each session's band calls by session and project, read again once per change that can move them */
  const calls = new Map();
  let callsAt = Date.now();
  const fetched = new Map();
  const waiters = new Set();
  const listeners = new Set();
  /* the live rows, for the local server's stream */
  const rowListeners = new Set();
  let dirty = fresh();
  let queue = Promise.resolve();
  let pending = 0;

  function fresh() { return { questions: new Set(), tasks: new Set(), workstreams: new Set(), views: new Set(), cards: false, profiles: false, scopes: false, shelf: false, calls: false }; }

  /* ---- the cursor on disk -------------------------------------------------- */

  function readCursor() {
    try {
      const c = JSON.parse(readFileSync(cursorFile, 'utf8'));
      return c && String(c.board).replace(/\/+$/, '') === base && Number.isInteger(c.seq) ? c.seq : null;
    } catch { return null; }
  }

  /* `reset` is a restored board only: every other path never moves the cursor back */
  function saveCursor(n, reset = false) {
    if (!reset && cursor !== null && n <= cursor) return;
    cursor = n;
    try {
      mkdirSync(stateDir, { recursive: true });
      writeAtomic(cursorFile, JSON.stringify({ board: base, seq: n }) + '\n');
    } catch (e) { log('local board: the cursor did not save: ' + e.message); }
  }

  /* ---- which PC each session acts from ------------------------ */

  /* { pc: this PC's device or null, of: session -> the device its rows came from } */
  function readPlaces() {
    try {
      const p = JSON.parse(readFileSync(placesFile, 'utf8'));
      if (p && String(p.board).replace(/\/+$/, '') === base) return { pc: typeof p.pc === 'string' ? p.pc : null, of: new Map(Object.entries(p.sessions || {})) };
    } catch {}
    return { pc: null, of: new Map() };
  }

  function learn(ev) {
    const m = /^session:(.+)$/.exec(String(ev.by || ''));
    if (!m || typeof ev.pc !== 'string' || !ev.pc) return;
    const s = m[1];
    let moved = false;
    if (places.of.get(s) !== ev.pc) { places.of.delete(s); places.of.set(s, ev.pc); moved = true; }
    if (ours.has(s) && places.pc !== ev.pc) { places.pc = ev.pc; moved = true; }
    if (!moved) return;
    for (const k of places.of.keys()) { if (places.of.size <= PLACES_KEEP) break; places.of.delete(k); }
    try {
      mkdirSync(stateDir, { recursive: true });
      writeAtomic(placesFile, JSON.stringify({ board: base, pc: places.pc, sessions: Object.fromEntries(places.of) }) + '\n');
    } catch (e) { log('local board: the session places did not save: ' + e.message); }
  }

  /* a session seen acting from another device gets no inbox here; unsure writes */
  const elsewhere = (session) => !!places.pc && places.of.has(session) && places.of.get(session) !== places.pc;

  /* ---- the board over HTTP ---------------------------------------------------- */

  const get = (path) => boardRequest('GET', path, undefined, { url, token });
  const verb = (name, input, body = {}) => boardRequest('POST', API + '/verbs/' + encodeURIComponent(name), { ...body, input }, { url, token });
  const record = (ref) => get(API + '/records/' + encodeURIComponent(ref));

  /* ---- the connection ---------------------------------------------------------- */

  function connect() {
    retryTimer = null;
    if (stopping) return;
    /* events of an older connection are skipped: the new one resumes from the cursor */
    const mine = ++gen;
    halted = false;
    boardVersion = null;
    let opened = false;
    let done = false;
    const end = (e) => {
      if (done) return;
      done = true;
      conn = null;
      if (stopping) return;
      if (e) setOnline(false, e.message, refusalOf(e));
      else if (!opened) setOnline(false, 'the board closed the stream');
      /* a clean close after a working stream reconnects at once (a restart);
         a refused one backs off, and that refusal is what marks it offline */
      const wait = opened && !e && !halted ? 0 : BACKOFF_MS[Math.min(retry++, BACKOFF_MS.length - 1)];
      retryTimer = setTimeout(connect, wait);
      if (retryTimer.unref) retryTimer.unref();
    };
    try {
      conn = boardEvents({
        url,
        token,
        /* a cold cache starts from the working set; a warm one resumes by sequence */
        after: loaded && cursor !== null ? cursor : undefined,
        onOpen: () => { opened = true; retry = 0; lastData = Date.now(); if (loaded) setOnline(true); },
        onEvent: (name, data) => {
          lastData = Date.now();
          if (name === 'board') boardVersion = data && typeof data.version === 'string' ? data.version : null;
          else if (name === 'snapshot') enqueue(mine, () => onSnapshot(data));
          else if (name === 'activity') enqueue(mine, () => onActivity(data));
        },
        onError: (e) => end(e),
        onClose: () => end(null),
      });
    } catch (e) { end(e); }
  }

  /* Two missed keepalives mark the board offline and drop the stream. */
  const watchdog = setInterval(() => {
    if (!conn || !lastData || Date.now() - lastData <= 2 * keepaliveMs) return;
    setOnline(false, 'no keepalive from the board in ' + Math.round((2 * keepaliveMs) / 1000) + ' s');
    lastData = 0;
    conn.close();
  }, Math.max(50, Math.floor(keepaliveMs / 2)));
  if (watchdog.unref) watchdog.unref();

  /* `said`: the board's own refusal, which the band shows; a network failure shows none */
  function setOnline(on, reason, said = '') {
    if (on === online && (on || reason === why)) return;
    online = on;
    refused = on ? '' : said;
    if (!on) { why = reason || 'the board is unreachable'; resync = true; } else why = '';
    log('local board: ' + (on ? 'online' : 'offline: ' + why));
    for (const w of [...waiters]) w.done(true);
    for (const f of listeners) f();
  }

  /* ---- the event queue, one event at a time --------------------------------- */

  /* A row that fails stops the queue there and drops the stream, so the reconnect
     replays it from the saved cursor: no later row can move the cursor past it. */
  function enqueue(g, fn) {
    pending += 1;
    queue = queue.then(() => (g === gen && !halted ? fn() : undefined)).catch((e) => {
      log('local board: ' + ((e && e.stack) || e));
      halted = true;
      resync = true;
      if (conn) conn.close();
    }).finally(() => {
      pending -= 1;
      if (!pending) kick();
    });
  }

  /* the one refresh after a burst, or after a mark made outside a row */
  function kick() {
    if (!loaded) return;
    pending += 1;
    queue = queue.then(flush).catch((e) => { log('local board: refresh: ' + e.message); resync = true; }).finally(() => { pending -= 1; });
  }

  async function onSnapshot(ws) {
    const from = cursor;
    /* a board behind the saved cursor was restored: its rows from here on are new */
    if (from !== null && ws.seq < from) {
      log('local board: the board is at ' + ws.seq + ', behind this PC\'s cursor ' + from + ' (restored): starting over from it');
      saveCursor(ws.seq, true);
      seq = ws.seq;
    }
    fill(ws);
    await Promise.all([cards(), profiles(), shelfRead()]);
    loaded = true;
    resync = false;
    /* the working set skipped rows: their inbox lines come from the activity pages */
    if (from !== null && from < ws.seq) await catchUp(from, ws.seq);
    saveCursor(ws.seq);
    if (!online) setOnline(true);
    live = true;
    dirty.scopes = true;
    dirty.calls = true;
  }

  async function catchUp(from, until) {
    const seen = new Map();
    let after = from;
    while (after < until) {
      const rows = await get(API + '/activity?after=' + after + '&limit=1000');
      if (!rows || !rows.length) break;
      for (const ev of rows) {
        if (ev.seq > until) return;
        await deliver(ev, { seen, alerts: false });
        saveCursor(ev.seq);
        after = ev.seq;
      }
    }
  }

  async function onActivity(ev) {
    if (cursor !== null && ev.seq <= cursor) return;
    await deliver(ev, { alerts: live });
    saveCursor(ev.seq);
    touched(ev);
    for (const f of rowListeners) { try { f(ev); } catch (e) { log('local board: a row listener failed: ' + e.message); } }
  }

  /* ---- inbox lines and alerts ---------------------------------------------------- */

  const ctx = {
    question: async (ev) => {
      const key = (ev.head && ev.head.key) || ev.id;
      if (!fetched.has(key)) fetched.set(key, await record(key).catch(() => null));
      return fetched.get(key);
    },
    holder: (label) => {
      for (const { view } of cache.views.values()) {
        const t = (view.tracks || []).find((x) => x.id === label);
        if (t) return t.holder ? t.holder.session : null;
      }
      return null;
    },
    task: (label) => {
      for (const t of cache.tasks.values()) if (t.id === label) return { inHand: t.inHand, track: trackOfTask(label) };
      return null;
    },
    tracksOf: (ws) => ((cache.views.get(ws) || {}).view?.tracks || []).map((t) => t.id),
    /* a record's journal, read live for a track note the row cut */
    journal: async (ref) => (await verb('readRecord', ref)).journal,
    /* a row from this PC: its device once known, else a session that called this local server */
    here: (session, pc) => (places.pc && pc ? pc === places.pc : ours.has(session)),
  };

  function trackOfTask(label) {
    for (const { view } of cache.views.values()) {
      for (const tr of view.tracks || []) if ((tr.tasks || []).some((t) => t.id === label)) return tr.id;
    }
    return null;
  }

  async function deliver(ev, { seen, alerts }) {
    learn(ev);
    const t = await tellingsOf(ev, ctx);
    const lines = t.lines.filter((l) => !elsewhere(l.session));
    if (lines.length) {
      await lock(() => {
        for (const { session, line } of lines) {
          /* a replay after a restart skips a line the inbox already holds */
          if (seen) {
            if (!seen.has(session)) seen.set(session, seqsIn(inboxDir, session));
            if (seen.get(session).has(ev.seq)) continue;
          }
          try { appendInbox(inboxDir, session, line); } catch (e) { log('local board: inbox line for ' + session + ' failed: ' + e.message); }
        }
      });
    }
    const h = ev.head || {};
    /* a settled question's popup cards leave, sent before its own alert so that one stays */
    if (retract && ev.kind === 'question' && SETTLES.includes(ev.verb)) {
      try { retract(h.label || ev.id); } catch (e) { log('local board: retract failed: ' + e.message); }
    }
    if (!alerts || !alert || (!t.questions.length && !t.work.length)) return;
    const q = t.questions.length ? await ctx.question(ev) : null;
    const wsName = (label) => { for (const w of cache.workstreams.values()) if (w.id === label) return w.name; return ''; };
    /* the card's context in names (project, workstream, held task, pick) off the cache */
    const names = Object.create(null);
    for (const m of [cache.workstreams, cache.tasks]) for (const r of m.values()) if (r.id && r.name) names[r.id] = r.name;
    /* a question's track, by key or label */
    for (const { view } of cache.views.values()) for (const t of view.tracks || []) if (t.name) { if (t.id) names[t.id] = t.name; if (t.key) names[t.key] = t.name; }
    /* the record that woke a question, often just ended and off the cache, else one
       read capped short, so a stalled board never holds the alert for a name */
    for (const r of [...cache.questions.values(), ...cache.closed]) if (r.id && r.name && !names[r.id]) names[r.id] = r.name;
    for (const x of t.questions) {
      const ref = String(x.wokeBy || '').split(' ')[0];
      if (ref && !names[ref]) {
        let timer;
        const cap = new Promise((resolve) => { timer = setTimeout(resolve, NAME_READ_MS, null); });
        const r = await Promise.race([record(ref).catch(() => null), cap]);
        clearTimeout(timer);
        if (r && r.name) names[ref] = r.name;
      }
    }
    const id = h.label || ev.id;
    const questions = enrichEvents(t.questions.map((x) => ({
      ...x, id, key: h.key, name: (q && q.name) || h.title || '', blocking: (q ? q.blocking : h.blocking) === true,
    })), q ? [{ ...q, id }] : [], names, null);
    const work = t.work.map((x) => ({
      ...x, id: h.label || ev.id, key: h.key, name: h.title || '',
      ...(h.workstream ? { workstream: h.workstream, workstreamName: wsName(h.workstream) } : {}),
    }));
    try { await alert({ questions, work }); } catch (e) { log('local board: alert failed: ' + e.message); }
  }

  /* ---- the cache --------------------------------------------------------------- */

  function fill(ws) {
    cache.questions = new Map((ws.questions || []).map((q) => [q.key, normQ(q)]));
    cache.workstreams = new Map((ws.workstreams || []).map((w) => [w.key, w]));
    cache.tasks = new Map((ws.tasks || []).map((t) => [t.key, t]));
    cache.views = new Map();
    for (const v of ws.views || []) setView(v);
    cache.handoffs = new Map();
    memo.clear();
  }

  const normQ = (q) => ({ ...q, blocking: q.blocking === true });

  /* the layout runs once per change to a workstream, never per draw; Home's, so no finished review */
  function setView(v) {
    let layout = null;
    try { layout = layoutGraph(layoutInput(v, { keepReview: false })); } catch (e) { log('local board: layout of ' + v.workstream + ' failed: ' + e.message); }
    cache.views.set(v.workstream, { view: v, layout });
  }

  function closed(r, kind) {
    cache.closed.unshift({ id: r.id, key: r.key, kind, status: r.status, name: r.name });
    if (cache.closed.length > CLOSED_KEEP) cache.closed.length = CLOSED_KEEP;
  }

  function viewOfTrack(label) {
    for (const [ws, { view }] of cache.views) if ((view.tracks || []).some((t) => t.id === label)) return ws;
    return null;
  }

  /* What a row changed, marked for the one refresh after the burst. */
  function touched(ev) {
    const h = ev.head || {};
    const key = h.key || null;
    memo.clear();
    /* a project row re-keys records of every kind in one line, so the cache is read again whole */
    if (ev.kind === 'project') { resync = true; return; }
    if (ev.kind === 'question') { if (key) dirty.questions.add(key); dirty.scopes = true; return; }
    /* a band scope moves only with what engages a session: in hand, a lease, a status */
    const moved = (keys) => Object.keys(ev.changes || {}).some((k) => keys.includes(k)) || ev.verb === 'create';
    /* any work, line, handoff, record text or override row can raise or settle a band call */
    if (!['question', 'profile', 'procedure'].includes(ev.kind)) dirty.calls = true;
    if (ev.kind === 'task') {
      if (key) dirty.tasks.add(key);
      if (h.workstream) dirty.views.add(h.workstream);
      /* a task moved onto another workstream's track leaves the view that listed it too */
      for (const [ws, { view }] of cache.views) if ((view.tracks || []).some((t) => (t.tasks || []).some((x) => (key && x.key ? x.key === key : x.id === h.label)))) dirty.views.add(ws);
      if (moved(SCOPE_TASK)) dirty.scopes = true;
    }
    if (ev.kind === 'track') { if (h.workstream) dirty.views.add(h.workstream); if (moved(['session', 'workstream'])) dirty.scopes = true; dirty.shelf = true; }
    if (ev.kind === 'workstream') { if (key) dirty.workstreams.add(key); if (h.label) dirty.views.add(h.label); }
    if (ev.kind === 'handoff' && h.track) { const ws = viewOfTrack(h.track); if (ws) dirty.views.add(ws); }
    if (ev.kind === 'handoff') dirty.shelf = true;
    if (ev.kind === 'handoff' && h.track) { cache.handoffs.delete(h.track); handoffRows.set(h.track, (handoffRows.get(h.track) || 0) + 1); }
    if (ev.kind === 'procedure') dirty.cards = true;
    if (ev.kind === 'profile' || Object.keys(ev.changes || {}).some((k) => k === 'profiles' || k === 'profileDrops')) dirty.profiles = true;
  }

  async function refresh(key, put) {
    try { put(await record(key)); } catch (e) { if (e.status === 404) put(null); else throw e; }
  }

  async function flush() {
    if (resync && online) {
      /* a refresh that failed, or a gap while offline: one working-set read rebuilds it */
      const ws = await get(API + '/working-set');
      fill(ws);
      await Promise.all([cards(), profiles(), shelfRead()]);
      resync = false;
      dirty = fresh();
      dirty.scopes = true;
      dirty.calls = true;
    }
    const d = dirty;
    dirty = fresh();
    /* every read of the refresh in one round, so a change costs one wait on the board */
    const jobs = [];
    const gone = [];
    for (const key of d.questions) {
      const put = (q) => {
        if (q && OPEN_Q.includes(q.status)) cache.questions.set(key, normQ(q));
        else { const was = cache.questions.get(key); cache.questions.delete(key); if (q || was) closed(q || was, 'question'); }
      };
      jobs.push(fetched.has(key) ? Promise.resolve(put(fetched.get(key))) : refresh(key, put));
    }
    for (const key of d.tasks) {
      jobs.push(refresh(key, (t) => {
        if (t && !ENDED_TASK.includes(t.status)) cache.tasks.set(key, slim(t));
        else { const was = cache.tasks.get(key); cache.tasks.delete(key); if (t || was) closed(t || was, 'task'); }
      }));
    }
    for (const key of d.workstreams) {
      jobs.push(refresh(key, (w) => {
        if (w && w.status !== 'closed') cache.workstreams.set(key, slim(w));
        else { cache.workstreams.delete(key); if (w) { closed(w, 'workstream'); gone.push(w.id); } }
      }));
    }
    for (const ws of d.views) {
      jobs.push(get(API + '/workstreams/' + encodeURIComponent(ws)).then(setView, (e) => { if (e.status !== 404 && e.status !== 400) throw e; cache.views.delete(ws); }));
    }
    if (d.cards) jobs.push(cards());
    if (d.profiles) jobs.push(profiles());
    if (d.scopes) jobs.push(rescope());
    if (d.shelf) jobs.push(shelfRead());
    if (d.calls) jobs.push(recall());
    await Promise.all(jobs);
    for (const ws of gone) cache.views.delete(ws);
    fetched.clear();
    seq = Math.max(seq, cursor ?? 0);
    /* a poll ahead of the cache (a restored board) is answered too */
    for (const w of [...waiters]) if (seq !== w.after) w.done(true);
    for (const f of listeners) f();
  }

  /* the journal goes, its newest note stays for the task's tooltip; a record without
     `note` came from the working set, which carries no journal */
  const slim = ({ journal, sections, ...r }) => (journal === undefined ? r : { ...r, note: newestNote(journal) });

  const cards = () => verb('procedureCards', {}).then((c) => { cache.cards = Array.isArray(c) ? c : []; });
  const profiles = () => verb('profileList', {}).then((p) => { cache.profiles = p; profilesAt = Math.max(seq, cursor ?? 0); });
  /* the waiting and parked tracks the band's toasts and the Tracks tab read */
  /* an answer with no rows keeps the last ones, so the mod announces no track that waited all along */
  const shelfRead = () => verb('shelf', {}).then((r) => { if (r && Array.isArray(r.rows)) cache.shelf = r.rows; });

  /* each band scope asked for lately, read again once per change */
  async function rescope() {
    const cut = Date.now() - SCOPE_IDLE_MS;
    const keys = [...scopes].filter(([, s]) => s.used >= cut).map(([k]) => k);
    for (const [k, s] of scopes) if (s.used < cut) scopes.delete(k);
    await Promise.all([...keys.map((k) => scope(k, true)), ...(openRows ? [openWhere(true)] : [])]);
  }

  /* the board's open rows with each question's track name and PC, which the cached
     records leave out; read when a band first asks, again once per change */
  let openRows = null;
  async function openWhere(force) {
    if (openRows && !force) return openRows;
    if (!online) return openRows || new Map();
    const rows = await verb('peekOpenQuestions', {});
    openRows = new Map((Array.isArray(rows) ? rows : []).map((r) => [r.id, r]));
    return openRows;
  }

  async function scope(k, force) {
    const s = scopes.get(k);
    if (s && !force) { s.used = Date.now(); return s.list; }
    if (!online) return s ? s.list : null;
    const [session, projectRepo] = JSON.parse(k);
    const list = await verb('peekSessionScope', { session, ...(projectRepo ? { projectRepo } : {}) });
    scopes.set(k, { list, used: s ? s.used : Date.now() });
    return list;
  }

  /* each session's band calls asked for lately, read again once per change */
  async function recall() {
    const cut = Date.now() - SCOPE_IDLE_MS;
    for (const [k, c] of calls) if (c.used < cut) calls.delete(k);
    callsAt = Date.now();
    await Promise.all([...calls.keys()].map((k) => callsOf(k, true)));
  }

  /* the rows and the live handoffs' asks in scope, as { rows, asks } */
  async function callsOf(k, force) {
    const c = calls.get(k);
    if (c && !force) { c.used = Date.now(); return c; }
    if (!online) return c || { rows: [], asks: [] };
    const [session, projectRepo] = JSON.parse(k);
    const r = await verb('bandCalls', { session, ...(projectRepo ? { projectRepo } : {}) });
    const got = { rows: r && Array.isArray(r.rows) ? r.rows : [], asks: r && Array.isArray(r.asks) ? r.asks : [] };
    calls.set(k, { ...got, used: c ? c.used : Date.now() });
    return got;
  }

  /* ---- what the routes read --------------------------------------------------- */

  const byLabel = (map, label) => { for (const v of map.values()) if (v.id === label) return v; return null; };

  /* the track a session holds, with its workstream's label */
  function heldOf(session) {
    for (const [ws, { view }] of cache.views) {
      const t = (view.tracks || []).find((x) => x.holder && x.holder.session === session);
      if (t) {
        const { tasks, edges, sideTracks, ...summary } = t;
        return { ws, summary };
      }
    }
    return null;
  }

  /* with no track held, Home draws the project's open workstream with the most open
     tasks (one with a line before one without) and names the others; `paged` adds each track's page */
  function projectHome(repo, paged) {
    if (!repo) return null;
    const want = String(repo).toLowerCase();
    const inIt = (w) => (Array.isArray(w.projectRepos) ? w.projectRepos : []).some((n) => String(n).toLowerCase() === want)
      || (Array.isArray(w.projects) ? w.projects : []).some((d) => normDir(d) === want);
    const open = new Map();
    for (const t of cache.tasks.values()) if (t.workstream && !ENDED_TASK.includes(t.status)) open.set(t.workstream, (open.get(t.workstream) || 0) + 1);
    const lines = (w) => ((cache.views.get(w.id) || {}).view?.tracks || []).length > 0;
    const num = (id) => Number(String(id).split('-')[1]) || 0;
    const ws = [...cache.workstreams.values()].filter((w) => w.id && w.status !== 'closed' && inIt(w))
      .sort((a, b) => lines(b) - lines(a) || (open.get(b.id) || 0) - (open.get(a.id) || 0) || num(b.id) - num(a.id));
    const top = ws[0] && cache.views.get(ws[0].id);
    if (!top) return null;
    return { workstream: ws[0].id, name: ws[0].name || '', view: { ...top.view, tracks: (top.view.tracks || []).map(paged) }, layout: top.layout,
      unheld: true, others: ws.slice(1).map((w) => ({ id: w.id, name: w.name || '' })) };
  }

  /* the session's tasks in hand from the cache, newest taken first; offline no page
     link, since a press would open an unreachable page */
  function handOf(session) {
    const n = (id) => Number(String(id).split('-')[1]) || 0;
    /* the track each task is on, from any workstream's view */
    const on = new Map();
    for (const { view } of cache.views.values()) for (const tr of view.tracks || []) for (const x of tr.tasks || []) on.set(x.id, { id: tr.id, name: tr.name });
    return [...cache.tasks.values()].filter((t) => t.inHand === session && !ENDED_TASK.includes(t.status))
      .sort((a, b) => (Date.parse(b.inHandSince) || 0) - (Date.parse(a.inHandSince) || 0) || n(b.id) - n(a.id))
      .map((t) => ({
        id: t.id, name: t.name, status: t.status, since: t.inHandSince || null, priority: t.priority || null, intent: t.intent || '',
        note: t.note || null, track: on.get(t.id) || null, ...(online ? { url: pageOf(t.key || t.id) } : {}),
      }));
  }

  /* a task the working set filled has no intent or journal; each in hand is read whole once */
  async function wholeHand(session) {
    if (!online) return;
    const thin = [...cache.tasks].filter(([, t]) => t.inHand === session && !ENDED_TASK.includes(t.status) && !('note' in t));
    await Promise.all(thin.map(([key]) => refresh(key, (t) => { if (t && !ENDED_TASK.includes(t.status)) cache.tasks.set(key, slim(t)); })
      .catch((e) => log('local board: the task ' + key + ' read whole: ' + e.message))));
  }

  /* the lease's last seen, as `track mine` renewed it; it writes no activity row, so no change */
  function renew(session) {
    const t = now().getTime();
    if (!online || t - (renewed.get(session) || 0) < RENEW_MS) return;
    renewed.set(session, t);
    for (const [k, at] of renewed) if (t - at > SCOPE_IDLE_MS) renewed.delete(k);
    verb('renewLease', { session }, { session }).catch((e) => { renewed.delete(session); log('local board: the lease renewal for ' + session + ': ' + e.message); });
  }

  /* each line's last handoff for the band's graph: read once, again after a handoff row names it */
  async function lastHandoffs(tracks) {
    if (online) {
      await Promise.all(tracks.filter((t) => !cache.handoffs.has(t.id)).map((t) => {
        const rows = handoffRows.get(t.id) || 0;
        return verb('trackHandoffs', { track: t.key }).then((r) => {
          const hs = (r && r.handoffs) || [];
          const h = hs[hs.length - 1];
          if ((handoffRows.get(t.id) || 0) === rows) {
            cache.handoffs.set(t.id, h ? { id: h.id, status: h.status, focus: h.focus, created: h.created, resumed: h.resumed || null, waitingOnUser: h.waitingOnUser || [] } : null);
          }
        }, (e) => log('local board: the handoffs of ' + t.id + ': ' + e.message));
      }));
    }
    const out = {};
    for (const t of tracks) { const h = cache.handoffs.get(t.id); if (h) out[t.id] = h; }
    return out;
  }

  /* every open question by its track (the band's own list is this session's scope alone);
     the trackless under '', so a handoff line naming one still reads as open; a snoozed one
     still waits, as the kickoff reads it, and is marked so the tile does not list it */
  function asksOf() {
    const out = {};
    const n = (id) => Number(String(id).replace(/\D/g, '')) || 0;
    for (const q of cache.questions.values()) {
      if (!OPEN_Q.includes(q.status)) continue;
      const k = q.track || '';
      (out[k] || (out[k] = [])).push({ id: q.id, name: q.name || '', blocking: q.blocking === true, ...(q.status === 'snoozed' ? { snoozed: true } : {}) });
    }
    for (const k of Object.keys(out)) out[k].sort((a, b) => n(a.id) - n(b.id));
    return out;
  }

  /* the session's inbox as scripts/mod-inbox.mjs peek reads it, naming the boxes read, so a
     caller with more of its lineage than the band was told reads the rest itself */
  async function peek(session, lineage) {
    const old = String(lineage || '').split(',').map((s) => s.trim()).filter((s) => s && s !== session);
    try {
      const { runScript } = await import('./mod-scripts.mjs');
      const r = await runScript({ argv: ['mod-inbox', 'peek', '--session', session, ...(old.length ? ['--lineage', old.join(',')] : []), '--json'], env });
      const j = r.code === 0 ? JSON.parse(r.stdout) : null;
      return j && Array.isArray(j.events) ? { boxes: [session, ...old], events: j.events } : null;
    } catch (e) {
      log('local board: the inbox peek for ' + session + ': ' + e.message);
      return null;
    }
  }

  function status() {
    return { seq, online, offline: !online, stale: !online, why: online ? null : why, loaded, cursor, profilesAt, boardVersion };
  }

  /* while a held line is not yet quiet, its view and the shelf are read again hourly */
  function quietCheck() {
    if (!online || !loaded || Date.now() - quietRead < QUIET_READ_MS) return;
    quietRead = Date.now();
    let any = false;
    for (const [ws, { view }] of cache.views) if ((view.tracks || []).some((t) => t.holder && !t.quietSince)) { dirty.views.add(ws); any = true; }
    if (!any) return;
    dirty.shelf = true;
    kick();
  }

  /* a token saved while this runs; the stream reconnects with it and resumes from the cursor */
  function retoken(next) {
    if (!next || next === token) return;
    token = next;
    retry = 0;
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; connect(); } else if (conn) conn.close();
  }

  /* a shelf track's due loose files, from its live handoff's lists on this PC (none for a
     handoff written elsewhere); the Tracks tab counts them, and its next kickoff lists them */
  const looseSeen = new Map();
  let looseDay = '';
  async function looseDue(r) {
    if (!r || !r.handoff || !['waiting', 'parked'].includes(r.handoffStatus)) return 0;
    const day = dayOf(now());
    if (day !== looseDay) { looseSeen.clear(); looseDay = day; }
    const k = r.handoff + '|' + (r.created || '');
    const was = looseSeen.get(k);
    if (was && Date.now() - was.at < LOOSE_READ_MS) return was.n;
    let n = 0;
    try {
      const [{ readKept }, { dueFiles }] = await Promise.all([import('./tracks-session.mjs'), import('./loose-files.mjs')]);
      const kept = readKept(dataDir(env), r.handoff);
      /* a label rests and is reused: the lists must be this handoff's */
      if (kept && (!kept.created || !r.created || kept.created === r.created)) n = dueFiles(kept.repos, day).length;
    } catch (e) { log('local board: loose files of ' + r.handoff + ': ' + ((e && e.message) || e)); }
    looseSeen.set(k, { at: Date.now(), n });
    return n;
  }

  /* the name this PC goes by on the board, which the Questions tab reads as "this PC"; read
     again each minute, since joining a board names it */
  let pcAt = 0, pcNow = '';
  async function herePc() {
    if (pcAt && Date.now() - pcAt < PC_READ_MS) return pcNow;
    try { pcNow = (await import('./tracks-session.mjs')).pcName(env); } catch (e) { log('local board: pc name: ' + ((e && e.message) || e)); }
    pcAt = Date.now();
    return pcNow;
  }

  /* The band in one call, from memory: this session's questions (the board's own
     scope rule), its track's now, ready and critical path, that workstream's graph with
     each line's last handoff, the inbox peek and the links. `redraw`: the caller's last
     redraw's wall time in ms, for the local timings. */
  async function band({ session = '', project = '', lineage = '', redraw = '' } = {}) {
    if (session) ours.add(session);
    const drew = Number(redraw);
    if (drew > 0) timing('band redraw', drew, 200);
    const today = dayOf(now());
    if (online && pokedDay !== today) {
      /* a date snooze wakes when read: the first band of a day reads the board once */
      pokedDay = today;
      verb('list', {}).catch(() => {});
    }
    quietCheck();
    /* stall days and purge dates pass with no row: the calls are read again hourly too */
    if (online && loaded && calls.size && Date.now() - callsAt >= QUIET_READ_MS) { callsAt = Date.now(); dirty.calls = true; kick(); }
    /* the project as register names it: its shared name and its short name; the mod builds neither */
    const where = { repo: project ? sharedName(project) : '', name: project ? shortName(checkoutOf(project)) : '' };
    /* the scope and the calls in one wait, the first band of a session only */
    const [list, callList] = session ? await Promise.all([
      scope(JSON.stringify([session, where.repo])).then((l) => l || [], (e) => { log('local board: band scope: ' + e.message); return []; }),
      callsOf(JSON.stringify([session, where.repo])).catch((e) => { log('local board: band calls: ' + e.message); return { rows: [], asks: [] }; }),
    ]) : [[], { rows: [], asks: [] }];
    /* show's shape from the cache; `session` is this session when the question is its own, `asker` who registered it */
    const qs = list.map((s) => {
      const q = byLabel(cache.questions, s.id) || s;
      /* the scope row's track name and PC, which the cached record leaves out (the Questions tab) */
      const where = { ...(s.track ? { track: s.track } : {}), ...(s.trackName ? { trackName: s.trackName } : {}), ...(s.pc ? { pc: s.pc } : {}) };
      return { ...q, ...where, session: s.own ? session : null, asker: q.session || s.session || null, ...(online ? { boardUrl: pageOf(q.key || s.id) } : {}), subscribers: [] };
    });
    /* a call's pages through this server's signed root; offline none */
    const at = (path) => (online && path ? (local ? String(local).replace(/\/+$/, '') : base) + path : undefined);
    const linked = callList.rows.map((c) => ({
      ...c, url: at(c.url), presses: (c.presses || []).map((p) => (p.url ? { ...p, url: at(p.url) } : p)).filter((p) => p.verb || p.url),
    }));
    const waitingRows = [];
    for (const { view } of cache.views.values()) for (const t of view.tracks || []) if (t.state === 'waiting') waitingRows.push({ status: 'waiting', track: t.id });
    const snap = { entries: [...cache.questions.values()] };
    /* every open question this session does not own, for the mark, its count and its hover */
    const ownIds = new Set(list.filter((s) => s.own).map((s) => s.id));
    const rowsAt = await openWhere().catch((e) => { log('local board: open rows: ' + e.message); return openRows || new Map(); });
    const away = snap.entries.filter((q) => q.status === 'open' && !ownIds.has(q.id)).map((q) => {
      const r = rowsAt.get(q.id) || {};
      /* what an index row of the Questions tab answers with; its pinned card reads the record whole */
      const options = (Array.isArray(q.options) ? q.options : []).filter((o) => o && o.type).map((o) => ({ type: o.type, option: o.option || '' }));
      return { id: q.id, name: q.name, blocking: q.blocking === true, track: r.track || '', trackName: r.trackName || '', pc: r.pc || q.pc || '', created: q.created || '',
        ask: q.ask || '', options, ...(q.pick ? { pick: q.pick } : {}), ...(Number.isInteger(q.version) ? { version: q.version } : {}), ...(q.key ? { key: q.key } : {}) };
    }).sort((a, b) => (b.blocking ? 1 : 0) - (a.blocking ? 1 : 0) || (Date.parse(a.created) || 0) - (Date.parse(b.created) || 0));
    const elsewhere = { questions: away, blocking: away.filter((q) => q.blocking).length, waiting: away.filter((q) => !q.blocking).length };
    const held = session ? heldOf(session) : null;
    if (held) renew(session);
    const v = held ? cache.views.get(held.ws) : null;
    const [handoffs, inbox] = await Promise.all([v ? lastHandoffs(v.view.tracks || []) : {}, session ? peek(session, lineage) : null, session ? wholeHand(session) : null]);
    /* each track's page while online (the localhost form), as the held one has */
    const paged = (r) => (online && (r.key || r.id || r.track) ? { ...r, url: pageOf(r.key || r.id || r.track) } : r);
    /* a view's stations, finished tasks, reviews and what each covered link the same way */
    const pagedView = (tv) => {
      if (!online) return tv;
      const one = (x) => (x && (x.key || x.id) ? { ...x, url: pageOf(x.key || x.id) } : x);
      return { ...paged(tv), tasks: (tv.tasks || []).map(one),
        finished: (tv.finished || []).map((f) => ({ ...one(f), ...(Array.isArray(f.covers) ? { covers: f.covers.map(one) } : {}) })) };
    };
    const shelf = await Promise.all(cache.shelf.map(async (r) => { const n = await looseDue(r); return paged(n ? { ...r, looseDue: n } : r); }));
    const pc = await herePc();
    return {
      ...status(),
      here: { pc },
      /* the refusal's own reason (a revoked token says so); a network failure, offline alone */
      board: online ? null : 'board offline' + (refused ? ': ' + refused : ''),
      scope: where,
      model: bandModel({ questions: qs, shelfRows: waitingRows, sid: session, calls: linked }),
      /* what the mod's pane, toasts and mark read with the model, so it reads nothing else */
      questions: qs, elsewhere, shelf, profilesAt,
      asks: asksOf(),
      /* what the live handoffs in this session's scope say waits on the user (bandCalls) */
      handoffAsks: callList.asks.map(({ track, name, handoff, text, at }) => ({ track, name, handoff, text, at })),
      /* the track's and each task's page, which the status row's presses open */
      track: held ? {
        ...held.summary, workstream: held.ws, workstreamName: (byLabel(cache.workstreams, held.ws) || {}).name || '',
        ...(online ? { url: pageOf(held.summary.key || held.summary.id) } : {}),
      } : null, hand: session ? handOf(session) : [],
      graph: v ? { workstream: held.ws, view: { ...v.view, tracks: (v.view.tracks || []).map(pagedView) }, layout: v.layout }
        : session && !held ? projectHome(where.repo, pagedView) : null,
      handoffs, inbox,
      links: {
        overview: base + WEB.root(), needsYou: base + WEB.needsYou(where.repo),
        ...(local ? { local, alert: local + 'api/alert' } : {}),
      },
    };
  }

  /* Answers once the cache is past `after`, or when the board goes on or off line. */
  function wait(after, ms = 25000) {
    const a = Number(after);
    return new Promise((ok) => {
      if (Number.isFinite(a) && (seq > a || (loaded && a > Math.max(seq, cursor ?? 0)))) return ok({ ...status(), changed: true });
      const w = {
        after: Number.isFinite(a) ? a : seq,
        done: (changed) => { clearTimeout(w.timer); waiters.delete(w); ok({ ...status(), changed }); },
      };
      w.timer = setTimeout(() => w.done(false), Math.min(Math.max(Number(ms) || 0, 0), WAIT_MAX_MS));
      waiters.add(w);
    });
  }

  /* Settles once the first connect after start succeeds or fails, or after FIRST_CONNECT_MS. */
  function firstConnect() {
    const settled = () => online || why !== NOT_YET || stopping;
    if (settled()) return Promise.resolve();
    return new Promise((ok) => {
      const check = () => { if (settled()) done(); };
      const done = () => { clearTimeout(timer); listeners.delete(check); ok(); };
      const timer = setTimeout(done, FIRST_CONNECT_MS);
      listeners.add(check);
    });
  }

  /* as the band's row: a network failure reads offline alone, a refusal the board gave keeps its reason */
  const offlineWords = () => 'the board is offline' + (refused ? ' (' + refused + ')' : '');

  /* A read: the cache's own sets first, then the memo, then the board. */
  async function read(name, input = {}) {
    if (!isRead(name)) throw new TypeError(name + ' is not a read');
    if (LIVE_READS.has(name)) {
      if (!online) await firstConnect();
      if (!online) throw new BoardOffline(offlineWords() + ' and ' + name + ' is read live');
      return { result: await verb(name, input), stale: false };
    }
    if (name === 'profileList' && cache.profiles) return { result: cache.profiles, stale: !online };
    if (name === 'procedureCards' && loaded) return { result: cache.cards, stale: !online };
    if (name === 'triggerCards' && loaded) return { result: cache.cards.filter((c) => c.status !== 'retired'), stale: !online };
    const today = dayOf(now());
    if (today !== memoDay) { memo.clear(); memoDay = today; }
    const k = name + ' ' + JSON.stringify(input ?? null);
    if (memo.has(k)) return { result: memo.get(k), stale: !online };
    if (!online) await firstConnect();
    if (!online) throw new BoardOffline(offlineWords() + ' and this PC has no copy of that yet');
    const result = await verb(name, input);
    memo.set(k, result);
    return { result, stale: false };
  }

  /* A record's whole body by label or key (the board's records route), kept like a
     read until the next change; null for a record the board does not know. */
  async function body(ref) {
    const today = dayOf(now());
    if (today !== memoDay) { memo.clear(); memoDay = today; }
    const k = 'body ' + ref;
    if (memo.has(k)) return memo.get(k);
    if (!online) await firstConnect();
    if (!online) throw new BoardOffline(offlineWords() + ' and ' + ref + ' is not in this PC\'s cache');
    let r = null;
    try { r = await record(ref); } catch (e) { if (e.status !== 404) throw e; }
    memo.set(k, r);
    return r;
  }

  /* A write goes to the board; offline it fails plainly, nothing is queued. */
  async function call(name, body = {}) {
    if (isRead(name)) return (await read(name, body.input)).result;
    if (typeof body.session === 'string' && body.session) ours.add(body.session);
    /* the user's press names the session it came through, which is on this PC too */
    if (typeof body.user === 'string' && body.user) ours.add(body.user);
    if (!online) await firstConnect();
    if (!online) throw new BoardOffline(offlineWords() + ': nothing was saved; try again when it is back');
    const out = await boardRequest('POST', API + '/verbs/' + encodeURIComponent(name), body, { url, token });
    memo.clear();
    return out;
  }

  /* ---- procedures from the cache (lib/proc-match.mjs, proc-cards.mjs) ------------ */

  /* git off the loop and kept 30 s, so a new worktree or remote is seen */
  async function gitOf(dir) {
    const { placeOf } = await import('./procedures.mjs');
    return placeOf(dir);
  }
  /* each card at this PC's folder for its project */
  async function mapped(list) {
    const { cardsMapped } = await import('./procedures.mjs');
    return cardsMapped(list, readMap(dataDir(env)));
  }

  const atHome = (list, home, repo) => list.map((c) => (foreign(c, repo) ? { ...c, project: home, path: home + '/' + c.doc } : c));
  const exists = (p) => { try { statSync(p); return true; } catch { return false; } };

  /* `proc triggers --project D`: the live cards shown at D's own checkout. */
  async function triggers(dir) {
    const live = await mapped(cache.cards.filter((c) => c.status !== 'retired'));
    if (!dir) return live;
    const g = await gitOf(dir);
    const rows = atHome(live, g.project, g.repo);
    if (sameDir(g.project, g.here)) return rows;
    return rows.map((c) => (sameDir(c.project, g.project) && exists(join(g.here, c.doc)) ? { ...c, project: g.here, path: g.here + '/' + c.doc } : c));
  }

  /* `proc find <words>` (findProcedures), this project's cards first. */
  async function findProcedures(words, { project } = {}) {
    const cards = await mapped(cache.cards);
    if (!project) return findCards(cards, words, {});
    const g = await gitOf(project);
    return findCards(atHome(cards, g.project, g.repo), words, { project: g.project });
  }

  const matchProcedures = async ({ tool, input, cwd } = {}) => matchCall(await triggers(cwd), { tool, input, cwd });

  /* The tray's readings off the cached open questions. */
  function tray() {
    const snap = { entries: [...cache.questions.values()] };
    return { dot: dotState(snap), blocking: blockingCount(snap), waiting: waitingCount(snap), cards: trayCards(snap), waitingCards: trayWaitingCards(snap) };
  }

  function start() { if (!stopping && !conn && !retryTimer) connect(); }

  async function stop() {
    stopping = true;
    clearInterval(watchdog);
    if (retryTimer) clearTimeout(retryTimer);
    if (conn) conn.close();
    for (const w of [...waiters]) w.done(false);
    await queue.catch(() => {});
  }

  return {
    start, stop, status, band, wait, read, body, call, triggers, findProcedures, matchProcedures, tray, retoken,
    isRead,
    /* the cache itself, read only, for the routes and the tests */
    cache,
    graph: (ws) => cache.views.get(ws) || null,
    record: (label) => byLabel(cache.questions, label) || byLabel(cache.tasks, label) || byLabel(cache.workstreams, label),
    onChange: (f) => { listeners.add(f); return () => listeners.delete(f); },
    onRow: (f) => { rowListeners.add(f); return () => rowListeners.delete(f); },
    idle: () => queue,
  };
}
