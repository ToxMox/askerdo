/* Each PC's local server, its board half:
   one event-stream connection to the board, its cursor on disk, the working set in
   memory, inbox lines and alerts by sequence, reads from the cache, writes passed
   through. hooks/board-server.mjs mounts it; lib/local-route.mjs serves it. */
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { boardEvents, boardRequest, protocolProblem, refusalOf, signedPage } from './board-call.mjs';
import { loopStep } from './local-route.mjs';
import { API, HEARD_MS, WEB } from '../server/paths.mjs';
import { foreign, sameDir } from '../server/verbs/proc-cards.mjs';
import { findCards, matchCall } from './proc-match.mjs';
import { bandModel } from './mod-core.mjs';
import { asleepCards, blockingCount, dotState, trayCards, trayWaitingCards, waitingCount } from './board-state.mjs';
import { appendInbox, peekInbox, seqsIn, tellingsOf, withLock } from './local-inbox.mjs';
import { enrichEvents } from './notify.mjs';
import { writeAtomic } from './store-io.mjs';
import { readMap } from './project-map.mjs';
import { checkoutOfLater, normDir, repoOf, shortName } from './project-id.mjs';
import { dataDir, loadConfig } from './node-helpers.mjs';

export const KEEPALIVE_MS = 20000;
const BACKOFF_MS = [250, 500, 1000, 2000, 5000];
const CLOSED_KEEP = 50;
/* the question verbs that take it out of the open set */
const SETTLES = ['answer', 'drop', 'snooze'];
/* the most a woken question's alert waits on the board for its waker's name */
const NAME_READ_MS = 300;
/* a band scope nobody asked for in this long is not refetched on a change */
const SCOPE_IDLE_MS = 30 * 60000;
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
/* the surfaces and causes a redraw's log names, so a timings verb is never the caller's free text */
const RING_SURFACES = ['band', 'hint', 'pane', 'card', 'reply'];
const REDRAW_CAUSES = ['board', 'answer', 'tab', 'zoom', 'strip', 'fold'];
/* the parts of the mod's band load, each its own timing row beside the whole load's */
const LOAD_PARTS = ['id', 'local', 'closed', 'dir', 'band', 'near', 'graph', 'draw', 'marker', 'usage', 'inbox', 'follow', 'redraw'];
const LOOK_MS = 30 * 86400000;
/* the Overview reads every open track on the board, so it is read only for a pane that draws it,
   at most once a gap: this, or ten reads' time on a slow board */
const OV_GAP_MS = 5000;
const OV_GAP_READS = 10;
/* a passive update at most once a second, a workstream's picture read too */
const PICTURE_GAP_MS = 1000;
const OPEN_Q = ['open', 'snoozed'];
const ENDED_TASK = ['done', 'dropped'];
/* `run`: a run's open or end line, which moves the hand (the board's runs) */
const SCOPE_TASK = ['run', 'subscribers', 'workstream', 'status', 'track'];

/* writes that change no read the memo keeps; the mod's run timer renews every minute */
const QUIET_WRITES = ['pcMap', 'renewLease', 'renewRuns'];
/* The reads a caller may get from memory: the memo is cleared by every change. */
export const READ_VERBS = new Set(['show', 'list', 'peekOpenQuestions', 'peekSessionScope', 'namesLine', 'readRecord', 'listWork',
  'waitsOn', 'trackSummary', 'trackView', 'listTracks', 'workstreamView', 'trackFound', 'effective', 'resolveSession', 'rulesFor', 'profileList', 'settings',
  'procedureCards', 'triggerCards', 'resolveLabel', 'boardSnapshot', 'workingSet', 'heldTask', 'resumeCutoff', 'search', 'activity',
  'shelf', 'trackKickoff', 'trackHandoffs', 'decisionsFor', 'decisionsSince', 'decisionTriggers', 'recordHistory', 'overrideView', 'coverage', 'conversionMap',
  'pictureView', 'pictureOverview', 'taskBlock', 'sessionRuns', 'taskRuns']);
/* Reads that hang on the clock as well as the board (stall days, purge dates): never kept, never clearing the memo. */
export const LIVE_READS = new Set(['bandCalls', 'upkeepDryRun']);
const isRead = (name) => READ_VERBS.has(name) || LIVE_READS.has(name);

/* when the first running word in a read turns unconfirmed (ms, Infinity for none): the
   turn is no change on the board and renewals are quiet, so nothing else would end its keep */
export function turnOf(x) {
  let at = Infinity;
  const walk = (v) => {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) { for (const e of v) walk(e); return; }
    if (v.is === 'running' && typeof v.heard === 'string') { const t = Date.parse(v.heard); if (Number.isFinite(t)) at = Math.min(at, t + HEARD_MS); }
    for (const k in v) walk(v[k]);
  };
  walk(x);
  return at;
}
/* whether a read holds an unconfirmed word for one of the runs in `open` (a set of run numbers) */
function unconfirmedOf(x, open) {
  const walk = (v) => {
    if (!v || typeof v !== 'object') return false;
    if (Array.isArray(v)) return v.some(walk);
    if (v.is === 'unconfirmed' && open.has(v.run)) return true;
    for (const k in v) if (walk(v[k])) return true;
    return false;
  };
  return walk(x);
}
/* a cached copy that still reads running past its turn is read again this long after it */
const TURN_PAD_MS = 2000;

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
   is the local timings log (localTimings in lib/local-route.mjs); `env` finds this PC's files;
   `config()` the saved options as last read (the server's own copy, so a band reads no file). */
export function createLocalBoard({
  url, token, stateDir, inboxDir, alert = null, retract = null, log = () => {},
  keepaliveMs = KEEPALIVE_MS, local = null, now = () => new Date(), timing = () => {}, env = process.env, config = () => loadConfig(env),
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
  /* the board refused this PC's protocol: the problem the band's health row draws in place of the offline line */
  let protocol = null;
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
  /* pictures, each cached view's pictureView extras; overview, pictureOverview's, read when a pane asks */
  const cache = { questions: new Map(), workstreams: new Map(), tasks: new Map(), views: new Map(), profiles: null, cards: [], closed: [], shelf: [], handoffs: new Map(),
    pictures: new Map(), overview: null };
  /* the Overview's last read: when, how long it took, whether a change came since, the read in flight */
  const ov = { at: 0, ms: 0, dirty: true, reading: null };
  /* handoff rows seen per track, so a read that a newer row overtook is not kept */
  const handoffRows = new Map();
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

  function fresh() { return { questions: new Set(), tasks: new Set(), workstreams: new Set(), views: new Set(), pictures: new Set(), decisions: new Set(), cards: false, profiles: false, scopes: false, shelf: false, calls: false }; }

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
    if (ours.has(s) && places.pc !== ev.pc) { renamed(ev.pc); moved = true; }
    if (!moved) return;
    for (const k of places.of.keys()) { if (places.of.size <= PLACES_KEEP) break; places.of.delete(k); }
    savePlaces();
  }

  /* this PC under a new device name: the sessions placed at its old name are still its own */
  function renamed(device) {
    const was = places.pc;
    places.pc = device;
    if (was) for (const [s, pc] of places.of) if (pc === was) places.of.set(s, device);
  }

  /* the board's own word on this PC's device, said as the stream opens */
  function deviceSaid(device) {
    if (typeof device !== 'string' || !device || places.pc === device) return;
    renamed(device);
    savePlaces();
  }

  function savePlaces() {
    try {
      mkdirSync(stateDir, { recursive: true });
      writeAtomic(placesFile, JSON.stringify({ board: base, pc: places.pc, sessions: Object.fromEntries(places.of) }) + '\n');
    } catch (e) { log('local board: the session places did not save: ' + e.message); }
  }

  /* a session seen acting from another device gets no inbox here; unsure writes */
  const elsewhere = (session) => !!places.pc && places.of.has(session) && places.of.get(session) !== places.pc;

  /* ---- the board over HTTP ---------------------------------------------------- */

  /* the board request alone, a `board call` row: beside a call's whole time it says whose the wait was */
  const timed = (p) => {
    const t0 = performance.now();
    return p.then((out) => { timing('board call', performance.now() - t0, 200); return out; },
      (e) => { timing('board call', performance.now() - t0, (e && Number.isInteger(e.status) && e.status) || 500); throw e; });
  };
  const get = (path) => timed(boardRequest('GET', path, undefined, { url, token, step: loopStep }));
  const verb = (name, input, body = {}) => timed(boardRequest('POST', API + '/verbs/' + encodeURIComponent(name), { ...body, input }, { url, token, step: loopStep }));
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
      if (e) setOnline(false, e.message, refusalOf(e), protocolProblem(e));
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
          if (name === 'board') {
            boardVersion = data && typeof data.version === 'string' ? data.version : null;
            deviceSaid(data && data.device);
          }
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
  function setOnline(on, reason, said = '', proto = null) {
    if (on === online && (on || reason === why)) return;
    online = on;
    refused = on ? '' : said;
    protocol = on ? null : proto;
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
    await Promise.all([cards(), profiles(), shelfRead(), allPictures()]);
    loaded = true;
    resync = false;
    armTurn();
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
    /* fresh: read past this burst's copy, for a row that tells what the record holds after it */
    question: async (ev, fresh = false) => {
      const key = (ev.head && ev.head.key) || ev.id;
      if (fresh || !fetched.has(key)) {
        /* only a 404 is a record gone; a failed read keeps no copy, so the flush reads it again as refresh does */
        try { fetched.set(key, await record(key)); } catch (e) {
          if (e.status !== 404) { fetched.delete(key); return null; }
          fetched.set(key, null);
        }
      }
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
    /* a copy read for an earlier row of this record predates this one; the flush keeps the newest */
    const head = ev.head || {};
    for (const k of [head.key, head.label, ev.id]) if (k) fetched.delete(k);
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

  function setView(v) { cache.views.set(v.workstream, { view: v }); }

  /* a cached view, task or picture holding a running word is read again at its turn, so
     the band and Home never keep "running" for a run nobody renews */
  let turnTimer = null;
  function armTurn() {
    if (turnTimer) clearTimeout(turnTimer);
    turnTimer = null;
    if (stopping) return;
    let at = Infinity;
    for (const { view } of cache.views.values()) at = Math.min(at, turnOf(view));
    for (const t of cache.tasks.values()) at = Math.min(at, turnOf(t));
    for (const p of cache.pictures.values()) at = Math.min(at, turnOf(p));
    if (at === Infinity) return;
    turnTimer = setTimeout(turned, Math.min(Math.max(0, at - now().getTime()), 3600000) + TURN_PAD_MS);
    if (turnTimer.unref) turnTimer.unref();
  }
  /* offline nothing is read; the next fill arms it again */
  function turned() {
    turnTimer = null;
    if (!online || !loaded) return;
    const t = now().getTime();
    for (const [ws, { view }] of cache.views) if (turnOf(view) <= t) dirty.views.add(ws);
    for (const [key, x] of cache.tasks) if (turnOf(x) <= t) dirty.tasks.add(key);
    for (const [ws, x] of cache.pictures) if (turnOf(x) <= t) pic.dirty.add(ws);
    kick();
  }

  function closed(r, kind) {
    cache.closed.unshift({ id: r.id, key: r.key, kind, status: r.status, name: r.name });
    if (cache.closed.length > CLOSED_KEEP) cache.closed.length = CLOSED_KEEP;
  }

  function viewOfTrack(label) {
    for (const [ws, { view }] of cache.views) if ((view.tracks || []).some((t) => t.id === label)) return ws;
    return null;
  }

  /* a track's state as its cached view drew it, by label or key; null when no view holds it */
  function trackStateOf(ref) {
    for (const { view } of cache.views.values()) for (const t of view.tracks || []) if (t.id === ref || t.key === ref) return t.state || null;
    return null;
  }
  const newTracks = () => [...cache.views.values()].flatMap(({ view }) => (view.tracks || []).filter((t) => t.state === 'new'));

  /* What a row changed, marked for the one refresh after the burst. */
  function touched(ev) {
    const h = ev.head || {};
    const key = h.key || null;
    memo.clear();
    /* a project row re-keys records of every kind in one line, so the cache is read again whole */
    if (ev.kind === 'project') { resync = true; return; }
    /* a record an inbox task wakes on moved, so the inbox listing it reads its due again */
    for (const [ws, { view }] of cache.views) if (key && (view.inboxList || []).some((x) => x.wake && x.wake.key === key)) dirty.views.add(ws);
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
      /* and one moved to another workstream leaves the inbox that listed it */
      for (const [ws, { view }] of cache.views) if (key && (view.inboxList || []).some((x) => x.key === key)) dirty.views.add(ws);
      if (moved(SCOPE_TASK)) dirty.scopes = true;
      /* a task filed or moved on a track, its status or its waits can give a never-held track its
         first ready work, and a close readies what waits on it wherever it sits; a held track's work moves no shelf row */
      if (moved(['track', 'status', 'dependsOn'])) {
        const was = Array.isArray((ev.changes || {}).track) ? ev.changes.track[0] : null;
        const fresh = (ref) => { const st = ref ? trackStateOf(ref) : 'none'; return st === null || st === 'new'; };
        const waited = ENDED_TASK.includes(h.status) && newTracks().some((t) => (t.edges || []).some((e) => e.on === h.label));
        if (fresh(h.track) || (was && fresh(was)) || waited) dirty.shelf = true;
      }
    }
    if (ev.kind === 'track') { if (h.workstream) dirty.views.add(h.workstream); if (moved(['session', 'workstream'])) dirty.scopes = true; dirty.shelf = true; }
    if (ev.kind === 'workstream') { if (key) dirty.workstreams.add(key); if (h.label) dirty.views.add(h.label); }
    if (ev.kind === 'handoff' && h.track) { const ws = viewOfTrack(h.track); if (ws) dirty.views.add(ws); }
    if (ev.kind === 'handoff') dirty.shelf = true;
    if (ev.kind === 'handoff' && h.track) { cache.handoffs.delete(h.track); handoffRows.set(h.track, (handoffRows.get(h.track) || 0) + 1); }
    if (ev.kind === 'procedure') dirty.cards = true;
    /* a picture names records off its own rows (its answers, far tasks, Out and In),
       so a row naming one reads that picture again */
    const named = namedBy(ev, h);
    /* a decision its row does not place is placed by its record in the refresh */
    if (named === null && key) dirty.decisions.add(key);
    else for (const ws of named === null ? cache.pictures.keys() : picturesNaming(named)) dirty.pictures.add(ws);
    /* a track's view carries the user's hold, so a decision naming the track reads its view again */
    if (ev.kind === 'knowledge' && named) for (const ws of viewsNaming(named)) dirty.views.add(ws);
    if (ev.kind === 'profile' || Object.keys(ev.changes || {}).some((k) => k === 'profiles' || k === 'profileDrops')) dirty.profiles = true;
  }

  /* the labels a row names that a picture may show: a task and both ends of a wait; a decision's
     tasks and tracks; null when a decision changed and its rows do not say which it governs */
  function namedBy(ev, h) {
    const ch = ev.changes || {};
    const flat = (pair) => (Array.isArray(pair) ? pair : []).flatMap((x) => (Array.isArray(x) ? x : x ? [x] : []));
    if (ev.kind === 'task') return [h.label, ...(Array.isArray(ch) ? [] : flat(ch.dependsOn))].filter(Boolean);
    if (ev.kind !== 'knowledge') return [];
    if (Array.isArray(ch)) return null;
    const labels = [...flat(ch.tasks), ...flat(ch.tracks)];
    return labels.length || ev.verb === 'create' || !['question', 'status', 'name'].some((k) => k in ch) ? labels : null;
  }

  function picturesNaming(labels) {
    const want = new Set(labels);
    const out = new Set();
    if (!want.size) return out;
    for (const [ws, { view }] of cache.views) {
      if ((view.tracks || []).some((t) => want.has(t.id) || (t.tasks || []).some((x) => want.has(x.id)))) out.add(ws);
    }
    for (const [ws, x] of cache.pictures) if (Object.keys((x && x.far) || {}).some((id) => want.has(id))) out.add(ws);
    return out;
  }

  async function refresh(key, put) {
    try { put(await record(key)); } catch (e) { if (e.status === 404) put(null); else throw e; }
  }

  async function flush() {
    if (resync && online) {
      /* a refresh that failed, or a gap while offline: one working-set read rebuilds it */
      const ws = await get(API + '/working-set');
      fill(ws);
      await Promise.all([cards(), profiles(), shelfRead(), allPictures()]);
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
      pic.dirty.add(ws);
    }
    for (const ws of d.pictures) if (cache.views.has(ws)) pic.dirty.add(ws);
    if (d.decisions.size) jobs.push(decisionsNaming(d.decisions));
    /* the Overview counts every workstream's work and what waits on the user */
    if (d.views.size || d.questions.size) ov.dirty = true;
    if (d.cards) jobs.push(cards());
    if (d.profiles) jobs.push(profiles());
    if (d.scopes) jobs.push(rescope());
    if (d.shelf) jobs.push(shelfRead());
    if (d.calls) jobs.push(recall());
    await Promise.all(jobs);
    for (const ws of gone) { cache.views.delete(ws); cache.pictures.delete(ws); }
    fetched.clear();
    seq = Math.max(seq, cursor ?? 0);
    /* a poll ahead of the cache (a restored board) is answered too */
    for (const w of [...waiters]) if (seq !== w.after) w.done(true);
    for (const f of listeners) f();
    armTurn();
  }

  /* the journal goes, its newest note stays for the task's tooltip; a record without
     `note` came from the working set, which carries no journal */
  const slim = ({ journal, sections, ...r }) => (journal === undefined ? r : { ...r, note: newestNote(journal) });

  const cards = () => verb('procedureCards', {}).then((c) => { cache.cards = Array.isArray(c) ? c : []; });
  const profiles = () => verb('profileList', {}).then((p) => { cache.profiles = p; profilesAt = Math.max(seq, cursor ?? 0); });
  /* the waiting and parked tracks the band's toasts and the Tracks tab read */
  /* an answer with no rows keeps the last ones, so the mod announces no track that waited all along */
  const shelfRead = () => verb('shelf', {}).then((r) => { if (r && Array.isArray(r.rows)) cache.shelf = r.rows; });
  /* the picture's extras beside each view; both picture reads fail open, so a board older
     than the plugin or a failed read only drops the extras */
  const pictureRead = (ws) => verb('pictureView', { workstream: ws }).then((x) => { cache.pictures.set(ws, x); return true; },
    (e) => { cache.pictures.delete(ws); return !!e && (e.status === 404 || e.status === 400); });
  /* every picture marked, each read when a surface asks; one of a gone workstream goes */
  const allPictures = () => {
    for (const ws of cache.pictures.keys()) if (!cache.views.has(ws)) cache.pictures.delete(ws);
    for (const ws of cache.views.keys()) pic.dirty.add(ws);
    ov.dirty = true;
    return Promise.resolve();
  };

  /* a picture is read when a surface that shows it asks, once per change, at most once a
     second: inside the second the last one stands and is read at its end, and the surfaces are told */
  const pic = { dirty: new Set(), reading: new Map(), at: new Map(), timers: new Map() };
  /* `open`: an interaction skips the second's floor and waits out a read begun before
     the change; the band's passive draws keep the floor */
  function pictureFor(ws, open = false) {
    if (!ws || !online || !loaded || !cache.views.has(ws)) return Promise.resolve();
    if (pic.reading.has(ws)) {
      const p = pic.reading.get(ws);
      return open && pic.dirty.has(ws) ? p.then(() => (pic.dirty.has(ws) && !pic.reading.has(ws) ? pictureNow(ws) : pic.reading.get(ws))) : p;
    }
    if (!pic.dirty.has(ws) && pic.at.has(ws)) return Promise.resolve();
    const gap = (pic.at.get(ws) || 0) + PICTURE_GAP_MS - Date.now();
    /* inside the second the last read stands, a failed one too: tried again at its end */
    if (gap > 0 && !open) { pictureLater(ws, gap); return Promise.resolve(); }
    return pictureNow(ws);
  }
  function pictureNow(ws) {
    pic.dirty.delete(ws);
    pic.at.set(ws, Date.now());
    const p = pictureRead(ws).then((ok) => {
      pic.reading.delete(ws);
      /* a change that landed while it was read: the read it asked for comes at the second's end */
      if (pic.dirty.has(ws)) pictureLater(ws, Math.max(0, pic.at.get(ws) + PICTURE_GAP_MS - Date.now()));
      /* a failed read (not a 404 or 400, which settles) is marked again for the next ask; no timer polls a failing board */
      else if (!ok) pic.dirty.add(ws);
      return ok;
    });
    pic.reading.set(ws, p);
    return p;
  }
  function pictureLater(ws, ms) {
    if (pic.timers.has(ws)) return;
    const t = setTimeout(() => {
      pic.timers.delete(ws);
      if (stopping || !pic.dirty.has(ws)) return;
      /* only a read that worked tells the surfaces: a failing one would wake, redraw and ask again each second */
      pictureNow(ws).then((ok) => { if (!ok) return; for (const w of [...waiters]) w.done(true); for (const f of listeners) f(); });
    }, ms);
    if (t.unref) t.unref();
    pic.timers.set(ws, t);
  }

  /* a decision whose row names no task or track: its record says which pictures show it;
     one that cannot be read marks them all, as before */
  async function decisionsNaming(keys) {
    const found = await Promise.all([...keys].map((key) => record(key).then((r) => {
      const labels = r ? [...(Array.isArray(r.tasks) ? r.tasks : []), ...(Array.isArray(r.tracks) ? r.tracks : [])] : [];
      for (const ws of picturesNaming(labels)) if (cache.views.has(ws)) pic.dirty.add(ws);
      return viewsNaming(labels);
    }, () => { for (const ws of cache.pictures.keys()) pic.dirty.add(ws); return []; })));
    /* the views of the tracks such a decision names read again, for the hold they carry */
    const ws = [...new Set(found.flat())];
    await Promise.all(ws.map((w) => get(API + '/workstreams/' + encodeURIComponent(w)).then(setView, () => {})));
  }
  /* the cached views that list a track among the labels */
  function viewsNaming(labels) {
    const want = new Set(labels);
    return [...cache.views].filter(([, { view }]) => (view.tracks || []).some((t) => want.has(t.id))).map(([ws]) => ws);
  }
  const overviewRead = () => {
    if (ov.reading) return ov.reading;
    const t0 = Date.now();
    ov.dirty = false;
    ov.reading = verb('pictureOverview', {}).then((o) => { cache.overview = o; }, (e) => {
      /* a refused read (404 or 400) settles it empty; any other failure keeps the last and reads again at the next ask */
      if (e.status === 404 || e.status === 400) cache.overview = null;
      else { ov.dirty = true; log('local board: the Overview read failed: ' + e.message); }
    }).finally(() => { ov.at = Date.now(); ov.ms = ov.at - t0; ov.reading = null; });
    return ov.reading;
  };
  const ovGap = () => Math.max(OV_GAP_MS, OV_GAP_READS * ov.ms);

  /* The Overview for a pane that draws it, each row's url the board's workstream page while
     online; read again after a change, at most once a gap. `due`: an answer older than the last
     change says in how many ms a fresh one can be read. */
  async function overview() {
    if (online && loaded && (ov.dirty || !ov.at) && (!ov.at || Date.now() - ov.at >= ovGap())) await overviewRead();
    else if (ov.reading) await ov.reading;
    const o = cache.overview;
    if (!o) return null;
    const t0 = performance.now();
    const due = online && ov.dirty ? Math.max(1, ov.at + ovGap() - Date.now()) : 0;
    const out = { ...o, ws: online ? (o.ws || []).map((w) => ({ ...w, url: base + WEB.workstream(w.id) })) : o.ws, ...(due ? { due } : {}) };
    loopStep('overview build', t0);
    return out;
  }

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
     tasks (one with a line before one without) and names the others, each track with its page */
  function projectHome(repo) {
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
    return { workstream: ws[0].id, name: ws[0].name || '', view: pagedWs(top.view),
      unheld: true, others: ws.slice(1).map((w) => ({ id: w.id, name: w.name || '' })) };
  }

  /* each track's page while online (the localhost form), as the held one has */
  const paged = (r) => (online && (r.key || r.id || r.track) ? { ...r, url: pageOf(r.key || r.id || r.track) } : r);
  /* a view's stations, finished tasks, reviews and what each covered link the same way */
  const pagedView = (tv) => {
    if (!online) return tv;
    const one = (x) => (x && (x.key || x.id) ? { ...x, url: pageOf(x.key || x.id) } : x);
    return { ...paged(tv), tasks: (tv.tasks || []).map(one),
      finished: (tv.finished || []).map((f) => ({ ...one(f), ...(Array.isArray(f.covers) ? { covers: f.covers.map(one) } : {}) })) };
  };
  /* the inbox's tasks too, which the pane lists under the picture */
  const pagedWs = (v) => ({ ...v, tracks: (v.tracks || []).map(pagedView), ...(Array.isArray(v.inboxList) ? { inboxList: v.inboxList.map(paged) } : {}) });
  /* the picture's far tasks and answers open their pages the same way; a workstream's is the board's */
  const pagedPicture = (x) => {
    if (!x || !online) return x || null;
    const map = (o) => Object.fromEntries(Object.entries(o || {}).map(([k, r]) => [k, paged(r)]));
    return { ...x, url: base + WEB.workstream(x.workstream), far: map(x.far), answers: map(x.answers) };
  };
  /* a workstream's graph as Home draws it, the same from the band and from a read apart */
  function wsGraph(ws) {
    const v = cache.views.get(ws);
    return v ? { workstream: ws, view: pagedWs(v.view), picture: pagedPicture(cache.pictures.get(ws)) } : null;
  }
  const withPicture = (home) => (home ? { ...home, picture: pagedPicture(cache.pictures.get(home.workstream)) } : home);

  /* one look moment per workstream (and the Overview) for this PC; a session's first
     draw reads the previous one, kept for that session's life, and records its own */
  const looksFile = join(stateDir, 'looks.json');
  const sessionLooks = new Map();
  function look({ session = '', ws = '' } = {}) {
    const k = String(ws || 'overview');
    const mine = JSON.stringify([String(session), k]);
    if (sessionLooks.has(mine)) return { ws: k, look: sessionLooks.get(mine) };
    let all = {};
    /* a file damaged into something other than a map starts over */
    try { const x = JSON.parse(readFileSync(looksFile, 'utf8')); if (x && typeof x === 'object' && !Array.isArray(x)) all = x; } catch {}
    const t = now();
    /* a moment past the 30 days the moves cover counts as none */
    const prev = typeof all[k] === 'string' && t.getTime() - Date.parse(all[k]) <= LOOK_MS ? all[k] : null;
    all[k] = t.toISOString();
    try { mkdirSync(stateDir, { recursive: true }); writeAtomic(looksFile, JSON.stringify(all) + '\n'); } catch (e) { log('local board: the look did not save: ' + e.message); }
    sessionLooks.set(mine, prev);
    for (const x of sessionLooks.keys()) { if (sessionLooks.size <= PLACES_KEEP) break; sessionLooks.delete(x); }
    return { ws: k, look: prev };
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
      const cfg = config();
      return { boxes: [session, ...old], events: cfg && cfg.queue === 'hub' ? await peekInbox(dirname(inboxDir), [session, ...old], await herePc()) : [] };
    } catch (e) {
      log('local board: the inbox peek for ' + session + ': ' + e.message);
      return null;
    }
  }

  function status() {
    return { seq, online, offline: !online, stale: !online, why: online ? null : why, loaded, cursor, profilesAt, boardVersion, ...(protocol ? { protocol } : {}) };
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

  /* a shelf track's due loose files (`looseDue`) and due groups and worktrees holding work
     (`worktreesDue`), from its live handoff's lists on this PC (none for a handoff written
     elsewhere); the Tracks tab counts them, and its next kickoff lists them */
  const looseSeen = new Map();
  const looseReading = new Map();
  let looseDay = '';
  async function looseDue(r) {
    if (!r || !r.handoff || !['waiting', 'parked'].includes(r.handoffStatus)) return null;
    const day = dayOf(now());
    if (day !== looseDay) { looseSeen.clear(); looseDay = day; }
    const k = r.handoff + '|' + (r.created || '');
    const was = looseSeen.get(k);
    if (was && Date.now() - was.at < LOOSE_READ_MS) return was.n;
    const reading = looseReading.get(k) || looseRead(r, k, day);
    /* a band never waits on a count read again: the last one answers while it is read */
    return was ? was.n : reading;
  }
  function looseRead(r, k, day) {
    const p = (async () => {
      let n = null;
      try {
        const [{ readKept }, { dueLater }] = await Promise.all([import('./tracks-session.mjs'), import('./loose-files.mjs')]);
        const kept = readKept(dataDir(env), r.handoff);
        /* a label rests and is reused: the lists must be this handoff's */
        if (kept && (!kept.created || !r.created || kept.created === r.created)) {
          const { files, worktrees: w } = await dueLater(kept.repos, day);
          const of = (pick) => w.filter(pick).length;
          n = { ...(files.length ? { looseDue: files.length } : {}),
            ...(w.length ? { worktreesDue: { groups: of((d) => d.group === 'merged'), branches: of((d) => d.group === 'branches'), worktrees: of((d) => !!d.path) } } : {}) };
        }
      } catch (e) { log('local board: loose files of ' + r.handoff + ': ' + ((e && e.message) || e)); }
      looseSeen.set(k, { at: Date.now(), n });
      return n;
    })().finally(() => looseReading.delete(k));
    looseReading.set(k, p);
    return p;
  }

  /* the name this PC goes by on the board, which the Questions tab reads as "this PC": the
     device the board named this PC by, else the saved one or the hostname, read again each minute */
  let pcAt = 0, pcNow = '';
  async function herePc() {
    if (places.pc) return places.pc;
    if (pcAt && Date.now() - pcAt < PC_READ_MS) return pcNow;
    try { pcNow = (await import('./tracks-session.mjs')).pcName(env); } catch (e) { log('local board: pc name: ' + ((e && e.message) || e)); }
    pcAt = Date.now();
    return pcNow;
  }

  /* A ring press: when its last surface was drawn again after it, its key (stale: not the key
     drawn) and toggles; a row with a cause (`c`) is that redraw's, by its cause. Then each
     surface's draws, the ms the last one ended after the press or the cause */
  function ringTimings(text, timing) {
    let list;
    try { list = JSON.parse(text); } catch { return; }
    if (!Array.isArray(list)) return;
    for (const r of list.slice(0, 40)) {
      if (r && typeof r === 'object' && r.x) { lagTiming(r, timing); continue; }
      if (!r || typeof r !== 'object' || (r.c && !REDRAW_CAUSES.includes(r.c))) continue;
      const d = r.d && typeof r.d === 'object' ? Object.entries(r.d).filter(([s, x]) => RING_SURFACES.includes(s) && Array.isArray(x)) : [];
      const n = Number(r.n) || 0;
      const last = Math.max(0, ...d.map(([, x]) => Number(x[3]) || 0));
      /* a press's handler start against the mod's lag tick: the hooks thread block the press sat in */
      const l = typeof r.l === 'number' && r.l >= 0 ? ', the block it sat in ' + Math.round(r.l) + ' ms (a bound either way)' : '';
      /* the row's ms runs to the window's last draw of any cause; where the press showed is its own surface's first */
      const lead = RING_SURFACES.includes(r.f) ? d.find(([s]) => s === r.f) : undefined;
      const f = !RING_SURFACES.includes(r.f) ? '' : ', shown on ' + r.f + (lead ? ' at ' + (Number(lead[1][2]) || 0) + ' ms' : ' by no draw in the window');
      /* the cause's own time, since the row's stamp is the read that carried it */
      const z = Number(r.z) > 0 ? ', at ' + new Date(Number(r.z)).toISOString() : '';
      if (r.c) timing('redraw ' + r.c, last, String(r.k || r.c).slice(0, 80) + f + (Number(r.i) > 0 ? ', ' + Number(r.i) + ' redraws of every surface' : '') + l + z);
      else timing('ring press', last, String(r.k || '').slice(0, 80) + (r.s ? ' stale' : '') + ', ' + n + ' toggles' + (n ? ', ' + (r.o ? 'open' : 'shut') : '') + l + z);
      /* a board change's cooldown wait, logged apart: its draw rows count from the release */
      if (r.c && Number.isFinite(r.w)) timing('redraw ' + r.c + ' wait', Number(r.w), 'the cooldown held the draw');
      /* asked: the writes the mod made for that surface; draws past them the app started itself */
      /* the first ask's ms: a first draw well after it is the app's wait, not the mod's */
      const asked = (s) => (r.a && typeof r.a === 'object' && Number.isFinite(Number(r.a[s])) ? ', ' + Number(r.a[s]) + ' asked'
        + (r.q && typeof r.q === 'object' && Number.isFinite(Number(r.q[s])) ? ', the first asked at ' + Math.round(Number(r.q[s])) + ' ms' : '') : '');
      for (const [s, x] of d) timing((r.c ? 'redraw ' + r.c + ' ' : 'ring redraw ') + s, Number(x[3]) || 0, (Number(x[0]) || 0) + ' draws, ' + (Number(x[1]) || 0) + ' ms drawing, the first done at ' + (Number(x[2]) || 0) + ' ms' + asked(s)
        + (Number(x[5]) > 0 ? ', ' + Math.round(x[5]) + ' at new columns' : '')
        + (Number.isFinite(x[4]) && x[4] > 0 ? ', ' + Math.round(x[4]) + ' columns' : '')
        /* the largest drawing sent in the window and the ms writing them out took; the pane's tab */
        + (Number(x[6]) > 0 ? ', the largest ' + Math.round(x[6]) + ' characters, ' + (Math.max(0, Number(x[7]) || 0)).toFixed(1) + ' ms writing out' : '')
        /* the largest drawing as the desktop page counts it (bounds 2000 nodes, 262,144 characters) */
        + (Number(x[8]) > 0 ? ', the page counts ' + Math.round(x[8]) + ' nodes and ' + Math.round(Number(x[9]) || 0) + ' characters' : '')
        + (s === 'pane' && /^[a-z]{1,12}$/.test(String(r.v || '')) ? ', on ' + r.v : ''));
    }
    /* a cut read leaves its count, so a reader tells a quiet read from a clipped one */
    if (list.length > 40) timing('ring rows cut', 0, (list.length - 40) + ' more ring rows past the 40 the local server logs per read');
  }

  /* the mod's hooks thread lag (its 250 ms tick's largest lateness), its draw check's hidden draws
     and a Send's laps per answer, riding the ring rows */
  function lagTiming(r, timing) {
    const n = (v) => Math.max(0, Math.round(Number(v) || 0));
    const at = (z) => (Number(z) > 0 ? ', at ' + new Date(Number(z)).toISOString() : '');
    /* from 250 ms, the worst tick placed: its due time, the worker's beat and what ran at due */
    if (r.x === 'lag') timing('mod thread lag', n(r.m), n(r.n) + ' ticks, ' + n(r.o) + ' late by 50 ms or more'
      + (Number(r.d) > 0 ? '; the worst due ' + new Date(Number(r.d)).toISOString() + (r.w ? ', worker ' + String(r.w).slice(0, 12) + ' (its beat\'s gap ' + n(r.g) + ' ms)' : '')
        + (r.r ? ', running at due: ' + String(r.r).slice(0, 160) : '') : ''));
    else if (r.x === 'check') {
      /* the window the checks fell in, the gate releases in it and what opened each check */
      const k = r.k && typeof r.k === 'object' ? Object.entries(r.k).slice(0, 12).map(([w, c]) => String(w).slice(0, 24) + ' ' + n(c)).join(', ') : '';
      timing('redraw check', n(r.p) + n(r.b), n(r.n) + ' checks, pane ' + n(r.p) + ' ms, band ' + n(r.b) + ' ms, ' + n(r.v) + ' surfaces moved'
        + (Number.isFinite(r.s) ? ', in ' + n(r.s / 1000) + ' s with ' + n(r.g) + ' gate releases' : '') + (k ? ', causes ' + k : ''));
    }
    /* one drawing's asks in a second apart from the lone first asks of pieces not yet named, so one ask a second per drawing reads off the row */
    else if (r.x === 'live') timing('live lines', n(r.t), n(r.n) + ' asks in ' + n(r.s) + ' s, at most ' + n(r.m) + ' in one second'
      + (r.d !== undefined ? ', at most ' + n(r.d) + ' from any one drawing in one second, ' + n(r.o) + ' lone first asks of new pieces' : '')
      + ', answers up to ' + n(r.g) + ' ms apart within a second, ' + n(r.t) + ' ms answering');
    else if (r.x === 'send') timing('send lap', n(r.a) + n(r.c) + n(r.r), 'answer call ' + n(r.a) + ' ms' + (r.l ? ' (ran out of time)' : '') + ', card told ' + n(r.c) + ' ms, the rest ' + n(r.r) + ' ms');
    else if (r.x === 'stuck') timing('mod draw stuck', n(r.n), n(r.n) + ' refused writes forced after 500 ms with no draw ending, ' + n(r.d) + ' draws open at the read');
    /* the decision matcher's ms, the main loop's and the agents' calls apart */
    else if (r.x === 'match') {
      const f = (v) => Math.max(0, Number(v) || 0).toFixed(1);
      timing('mod decision match', Number(f(Number(r.t) + Number(r.u))), n(r.n) + ' main calls ' + f(r.t) + ' ms, ' + n(r.a) + ' agent calls ' + f(r.u) + ' ms, worst ' + f(r.w) + ' ms');
    }
    /* a tick late by a second, with the entries before the hold began (ms before) and queued inside it */
    else if (r.x === 'held') {
      const list = (v) => (Array.isArray(v) ? v.slice(0, 5).map((s) => String(s).slice(0, 48)).join(', ') : '') || 'none';
      /* the worker busy or idle by its own beat, what ran at the due time, and the due time itself */
      const due = Number(r.d) > 0 ? new Date(Number(r.d)).toISOString() : '';
      timing('mod thread held', n(r.l), 'entered before: ' + list(r.b) + '; inside: ' + list(r.i)
        + (r.w ? '; worker: ' + String(r.w).slice(0, 12) + (Number(r.g) >= 0 ? ' (its own beat\'s gap ' + n(r.g) + ' ms)' : '') : '')
        + (r.r ? '; running at due: ' + String(r.r).slice(0, 160) : '') + (due ? '; due ' + due : ''));
    }
    /* an agent's turn end, sweep or stop: its id, what the engine's list said and what the mod did; a background task's end and the path that told it */
    else if (r.x === 'end' && /^[\w-]{1,64}$/.test(String(r.a || ''))) timing('agent end', 0, 'agent ' + r.a + ' at ' + (/^[a-z]{1,8}$/.test(String(r.p || '')) ? r.p : 'unknown')
      + ', the engine listed ' + (/^[a-z]{1,12}$/.test(String(r.e || '')) ? r.e : 'unknown') + ', ' + (/^[a-z]{1,12}$/.test(String(r.o || '')) ? r.o : 'unknown') + at(r.z));
    else if (r.x === 'bgend' && /^[\w-]{1,64}$/.test(String(r.i || ''))) timing('background end', Number(r.r) >= 0 ? n(r.r) : 0, 'task ' + r.i + ' of ' + (r.o === 'agent' ? 'an agent' : 'the session')
      + ', told by ' + (/^[a-z ]{1,12}$/.test(String(r.p || '')) ? r.p : 'unknown') + at(r.z));
    /* an agent's resume, read as the session's message or the engine's wake, and the head of its prompt */
    else if (r.x === 'resume' && /^[\w-]{1,64}$/.test(String(r.a || ''))) timing('agent resume', 0, 'agent ' + r.a + ' read as ' + (r.k === 'message' ? 'a message' : r.k === 'wake' ? 'a wake' : 'neither')
      + ', its prompt: ' + (String(r.h || '').replace(/\s+/g, ' ').slice(0, 120) || '(empty)') + at(r.z));
    /* the mod's count of the end rows its bound dropped between two reads */
    else if (r.x === 'ends' && n(r.n)) timing('agent end', 0, n(r.n) + ' more agent and background end rows dropped past 20');
    /* a depth read before the first depth note, with the session's reason */
    else if (r.x === 'depth') timing('depth read before the note', Number(r.p) >= 0 ? n(r.p) : 0, 'why: ' + String(r.w || '').replace(/\s+/g, ' ').slice(0, 80));
    /* a drawing past 80 percent of the page's bounds or the engine's text room, or one the mod's ceiling made give way (g: the step) */
    else if (r.x === 'size' && /^[a-z]{1,12}$/.test(String(r.w || ''))) timing('drawing near the page bound', n(r.c), r.w + (/^[a-z]{1,12}$/.test(String(r.v || '')) ? ', on ' + r.v : '')
      + ', ' + n(r.n) + ' nodes, ' + n(r.l) + ' levels, ' + n(r.c) + ' characters' + (Number(r.t) > 0 ? ', ' + n(r.t) + ' of text' : '') + (n(r.g) ? ', gave way at step ' + n(r.g) : ''));
  }

  /* a draw or a handler of the mod that threw: where and its words, so a session can read why a surface stood still;
     640 holds the mod's prefix, an engine reason of up to 200 and a live piece's last sets */
  function faultTimings(text, timing, max = 8) {
    let list = text;
    if (typeof text === 'string') try { list = JSON.parse(text); } catch { return; }
    list = Array.isArray(list) ? list : [];
    for (const f of list.slice(0, max)) timing('mod fault', 0, String(f).replace(/\s+/g, ' ').slice(0, 640));
    /* a clipped list leaves its count, so a reader tells a quiet log from a clipped one */
    if (list.length > max) timing('mod fault', 0, (list.length - max) + ' more fault rows past the ' + max + ' the local server logs per call');
  }

  /* the mod's fault book flushed soon after a burst, apart from the band read; 250 holds the mod's bound of 200 and its dropped row */
  function faults({ session = '', faults: list = [] } = {}) {
    faultTimings(list, (verb, ms, status) => timing(verb, ms, status, String(session)), 250);
    return { logged: Array.isArray(list) ? Math.min(list.length, 250) : 0 };
  }

  function partTimings(text, timing) {
    let o;
    try { o = JSON.parse(text); } catch { return; }
    if (!o || typeof o !== 'object') return;
    for (const k of LOAD_PARTS) if (Number.isFinite(Number(o[k]))) timing('band load ' + k, Number(o[k]), 200);
  }

  /* The band in one call, from memory: this session's questions (the board's own
     scope rule), its track's now, ready and critical path, that workstream's graph with
     each line's last handoff, the inbox peek and the links. `redraw`: the caller's last
     redraw's wall time in ms, `rings` its fold ring presses (JSON), for the local timings; `start`: the
     count of the caller's module starts in its session, a row when past the first (the engine replaced its
     hooks worker or loaded the mod again), `load` its thread's clock at its first line and at this
     read, `faults` its draws that threw (JSON), each a row. */
  async function band({ session = '', project = '', lineage = '', redraw = '', rings = '', parts = '', start = '', load = '', faults = '' } = {}) {
    if (session) ours.add(session);
    /* the log is one per PC: each row of this read names its session */
    const rowTiming = (verb, ms, status) => timing(verb, ms, status, session);
    const drew = Number(redraw);
    if (Number(start) > 1) rowTiming('mod start', 0, 'start ' + Math.floor(Number(start)) + ' of the mod in this session');
    const [first, read] = String(load).split(',').map(Number);
    if (load && Number.isFinite(first) && Number.isFinite(read)) {
      rowTiming('mod load', first, 'start ' + (Math.floor(Number(start)) || 1) + ': the first line ran at ' + first + ' ms on its thread\'s clock, the first band read at ' + read + ' ms');
    }
    if (faults) faultTimings(faults, rowTiming);
    if (drew > 0) rowTiming('band redraw', drew, 200);
    if (drew > 0 && parts) partTimings(parts, rowTiming);
    if (rings) ringTimings(rings, rowTiming);
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
    /* the checkout's git stats in the thread pool; the remote is read at most every 30 s */
    const top = project ? await checkoutOfLater(project) : '';
    const where = { repo: project ? repoOf(project) || normDir(top) : '', name: shortName(top) };
    /* the scope and the calls in one wait, the first band of a session only */
    const [list, callList] = session ? await Promise.all([
      scope(JSON.stringify([session, where.repo])).then((l) => l || [], (e) => { log('local board: band scope: ' + e.message); return []; }),
      callsOf(JSON.stringify([session, where.repo])).catch((e) => { log('local board: band calls: ' + e.message); return { rows: [], asks: [] }; }),
    ]) : [[], { rows: [], asks: [] }];
    /* show's shape from the cache; `session` is this session when the question is its own, `asker` who registered it */
    const qs = list.map((s) => {
      /* register stores the asking folder's name on every question; only another project's is named */
      const { project: _project, ...q } = byLabel(cache.questions, s.id) || s;
      const from = q.projectRepo || normDir(q.projectDir);
      /* the scope row's track name and PC, which the cached record leaves out (the Questions tab) */
      const row = { ...(s.track ? { track: s.track } : {}), ...(s.trackName ? { trackName: s.trackName } : {}), ...(s.pc ? { pc: s.pc } : {}) };
      return { ...q, ...row, ...(where.repo && from && from !== where.repo ? { project: shortName(from) } : {}),
        session: s.own ? session : null, asker: q.session || s.session || null, ...(online ? { boardUrl: pageOf(q.key || s.id) } : {}), subscribers: [] };
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
      /* another project's question names that project by its short name */
      const from = q.projectRepo || normDir(q.projectDir);
      return { id: q.id, name: q.name, blocking: q.blocking === true, track: r.track || '', trackName: r.trackName || '', pc: r.pc || q.pc || '', created: q.created || '',
        ...(where.repo && from && from !== where.repo ? { project: shortName(from) } : {}),
        ask: q.ask || '', options, ...(q.pick ? { pick: q.pick } : {}), ...(Number.isInteger(q.version) ? { version: q.version } : {}), ...(q.key ? { key: q.key } : {}) };
    }).sort((a, b) => (b.blocking ? 1 : 0) - (a.blocking ? 1 : 0) || (Date.parse(a.created) || 0) - (Date.parse(b.created) || 0));
    const elsewhere = { questions: away, blocking: away.filter((q) => q.blocking).length, waiting: away.filter((q) => !q.blocking).length };
    /* every snoozed question, this session's own too, for the mark's asleep face and its card */
    const asleep = asleepCards(snap, today).map(({ projectRepo, projectDir, ...q }) => {
      const from = projectRepo || normDir(projectDir);
      return { ...q, ...(where.repo && from && from !== where.repo ? { project: shortName(from) } : {}) };
    });
    const held = session ? heldOf(session) : null;
    const v = held ? cache.views.get(held.ws) : null;
    const home = !v && session && !held ? projectHome(where.repo) : null;
    const [handoffs, inbox] = await Promise.all([v ? lastHandoffs(v.view.tracks || []) : {}, session ? peek(session, lineage) : null, session ? wholeHand(session) : null,
      pictureFor(v ? held.ws : home && home.workstream)]);
    const shelf = await Promise.all(cache.shelf.map(async (r) => paged({ ...r, ...(await looseDue(r)) })));
    const pc = await herePc();
    const t0 = performance.now();
    const out = {
      ...status(),
      here: { pc },
      /* the refusal's own reason (a revoked token says so); a network failure, offline alone */
      board: online ? null : 'board offline' + (refused ? ': ' + refused : ''),
      scope: where,
      model: bandModel({ questions: qs, shelfRows: waitingRows, sid: session, calls: linked }),
      /* what the mod's pane, toasts and mark read with the model, so it reads nothing else */
      questions: qs, elsewhere, asleep, shelf, profilesAt,
      asks: asksOf(),
      /* what the live handoffs in this session's scope say waits on the user (bandCalls) */
      handoffAsks: callList.asks.map(({ track, name, handoff, text, at }) => ({ track, name, handoff, text, at })),
      /* the track's and each task's page, which the status row's presses open */
      track: held ? {
        ...held.summary, workstream: held.ws, workstreamName: (byLabel(cache.workstreams, held.ws) || {}).name || '',
        ...(online ? { url: pageOf(held.summary.key || held.summary.id) } : {}),
      } : null, hand: session ? handOf(session) : [],
      graph: v ? wsGraph(held.ws) : withPicture(home),
      handoffs, inbox,
      links: {
        overview: base + WEB.root(), needsYou: base + WEB.needsYou(where.repo),
        ...(local ? { local, alert: local + 'api/alert' } : {}),
      },
    };
    loopStep('band build', t0);
    return out;
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

  /* as the band's row: a network failure reads offline alone, a refusal the board gave keeps its reason;
     a refused protocol is its update alone, since no wait brings that board back */
  const offlineWords = (then, plain = ' and ' + then) => (protocol ? refused + '; ' + then
    : 'the board is offline' + (refused ? ' (' + refused + ')' : '') + plain);

  /* A read: the cache's own sets first, then the memo, then the board. */
  async function read(name, input = {}) {
    if (!isRead(name)) throw new TypeError(name + ' is not a read');
    if (LIVE_READS.has(name)) {
      if (!online) await firstConnect();
      if (!online) throw new BoardOffline(offlineWords(name + ' is read live'));
      return { result: await verb(name, input), stale: false };
    }
    if (name === 'profileList' && cache.profiles) return { result: cache.profiles, stale: !online };
    if (name === 'procedureCards' && loaded) return { result: cache.cards, stale: !online };
    if (name === 'triggerCards' && loaded) return { result: cache.cards.filter((c) => c.status !== 'retired'), stale: !online };
    const today = dayOf(now());
    if (today !== memoDay) { memo.clear(); memoDay = today; }
    const k = name + ' ' + JSON.stringify(input ?? null);
    const kept = memo.get(k);
    /* offline a turned copy still answers, marked stale */
    if (kept && (!online || now().getTime() < kept.until)) return { result: kept.v, stale: !online };
    if (!online) await firstConnect();
    if (!online) throw new BoardOffline(offlineWords('this PC has no copy of that yet'));
    const result = await verb(name, input);
    memo.set(k, { v: result, until: turnOf(result) });
    return { result, stale: false };
  }

  /* A record's whole body by label or key (the board's records route), kept like a
     read until the next change; null for a record the board does not know. */
  async function body(ref) {
    const today = dayOf(now());
    if (today !== memoDay) { memo.clear(); memoDay = today; }
    const k = 'body ' + ref;
    const kept = memo.get(k);
    if (kept && (!online || now().getTime() < kept.until)) return kept.v;
    if (!online) await firstConnect();
    if (!online) throw new BoardOffline(offlineWords(ref + ' is not in this PC\'s cache'));
    let r = null;
    try { r = await record(ref); } catch (e) { if (e.status !== 404) throw e; }
    memo.set(k, { v: r, until: turnOf(r) });
    return r;
  }

  /* A write goes to the board; offline it fails plainly, nothing is queued. */
  async function call(name, body = {}) {
    if (isRead(name)) return (await read(name, body.input)).result;
    if (typeof body.session === 'string' && body.session) ours.add(body.session);
    /* the user's press names the session it came through, which is on this PC too */
    if (typeof body.user === 'string' && body.user) ours.add(body.user);
    if (!online) await firstConnect();
    if (!online) throw new BoardOffline(offlineWords('nothing was saved', ': nothing was saved; try again when it is back'));
    const out = await timed(boardRequest('POST', API + '/verbs/' + encodeURIComponent(name), body, { url, token, step: loopStep }));
    /* a project map and a renewal (no activity row) change no read this memo keeps, and both come every minute or few */
    if (!QUIET_WRITES.includes(name)) memo.clear();
    else if (name === 'renewRuns' || name === 'renewLease') renewed(out);
    return out;
  }

  /* a renewal writes no row, so only the copies calling one of its open runs unconfirmed are read again,
     never the whole memo each minute */
  function renewed(out) {
    /* only the runs this renewal heard: one left unrenewed on purpose (a dead agent's) stays unconfirmed */
    const heard = ((out && out.runs) || []).filter((r) => r && r.heard === out.at);
    const open = new Set(heard.map((r) => r.run).filter((n) => n != null));
    if (!open.size) return;
    const stale = (x) => unconfirmedOf(x, open);
    for (const [k, kept] of memo) if (stale(kept.v)) memo.delete(k);
    let any = false;
    for (const [ws, { view }] of cache.views) if (stale(view)) { dirty.views.add(ws); any = true; }
    for (const [key, x] of cache.tasks) if (stale(x)) { dirty.tasks.add(key); any = true; }
    for (const [ws, x] of cache.pictures) if (stale(x)) { pic.dirty.add(ws); any = true; }
    if (any) kick();
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
    /* the hover counts every snoozed question and names the first two; the dot keeps its three values */
    const asleep = asleepCards(snap, dayOf(now()));
    return { dot: dotState(snap), blocking: blockingCount(snap), waiting: waitingCount(snap), cards: trayCards(snap), waitingCards: trayWaitingCards(snap),
      asleep: asleep.length, asleepCards: asleep.slice(0, 2).map((q) => ({ id: q.id, name: q.name, wake: q.wake })) };
  }

  function start() { if (!stopping && !conn && !retryTimer) connect(); }

  async function stop() {
    stopping = true;
    clearInterval(watchdog);
    if (retryTimer) clearTimeout(retryTimer);
    for (const t of pic.timers.values()) clearTimeout(t);
    if (turnTimer) clearTimeout(turnTimer);
    if (conn) conn.close();
    for (const w of [...waiters]) w.done(false);
    await queue.catch(() => {});
  }

  return {
    start, stop, status, band, faults, wait, read, body, call, triggers, findProcedures, matchProcedures, tray, retoken, look, overview,
    isRead,
    /* the cache itself, read only, for the routes and the tests */
    cache,
    /* a workstream's graph with its picture fresh: a press opens it, so no floor;
       `picture` false is a read for the view alone, which costs no board read */
    graph: async (ws, picture = true) => { if (picture) await pictureFor(ws, true); return wsGraph(ws); },
    record: (label) => byLabel(cache.questions, label) || byLabel(cache.tasks, label) || byLabel(cache.workstreams, label),
    onChange: (f) => { listeners.add(f); return () => listeners.delete(f); },
    onRow: (f) => { rowListeners.add(f); return () => rowListeners.delete(f); },
    idle: () => queue,
  };
}
