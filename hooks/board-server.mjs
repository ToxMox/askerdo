#!/usr/bin/env node
/* The AskerDo local server: the tray's stream and alerts off the board's cache,
   the file openers, the notifications page and the links to the board's pages, on
   the permanent identity URL, loopback bound and secret prefixed. */
import { createServer, request as httpRequest } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { dataDir, envSeam, pluginRoot, pluginVersion, seamRootProblem, storeRoot } from '../lib/node-helpers.mjs';
import { renderRefView } from '../lib/viewer-page.mjs';
import {
  ALERT_FILES_MAX, alertCard, alertFrame, alertGate, validateAlert,
  CATEGORY_KEYS, createNotifier, createWorkNotifier,
  EDITOR_KEYS, EDITOR_MAX, loadSettings, PAUSE_TOKENS,
  pauseLabel, pauseUntil, saveSettings, SOUNDS,
} from '../lib/notify.mjs';
import { renderNotify, sampleAlert, sampleShape } from '../lib/notify-page.mjs';
import { renderAddPc } from '../lib/add-pc-page.mjs';
import { atWords } from '../server/web/feed.mjs';
import { OPEN_KINDS, checkTemplate, openFrame } from '../lib/open-in.mjs';
import { rebasePath, sharedName } from '../lib/project-id.mjs';
import { folderHere, readMap } from '../lib/project-map.mjs';
import {
  RECENT_MENU, RECENT_NAME_MAX, loadRecent, noteOpen,
} from '../lib/recent-opens.mjs';
import { createTray } from '../lib/tray.mjs';
import { ASSETS } from '../lib/board-assets.mjs';
import { CARD_ID, REC_ID, evidenceOf, filesOf, normDir, refShape } from '../lib/record-refs.mjs';
import { isFullStamp, stampNow } from '../lib/stamps.mjs';
import { isKey } from '../lib/record-ids.mjs';
import { answerToken } from '../lib/answer-token.mjs';
import { BoardCallError, boardJoinCode, boardLoginLink, boardToken, boardUrl as boardServerUrl, joinLine, reachableUrl } from '../lib/board-call.mjs';
import { boardIdentity, boardUrl, ensureRoot, probe } from '../lib/board-ensure.mjs';
import { HOST_ONLY, hostedHere, readHost, superviseHost } from '../lib/board-host.mjs';
import { WEB } from '../server/paths.mjs';
import { BoardOffline, createLocalBoard } from '../lib/local-board.mjs';
import { handleCli, handleLocal, localTimings } from '../lib/local-route.mjs';
import { appendLog, writeAtomic } from '../lib/store-io.mjs';

/* A whitelist map rather than a directory read: there is no path to traverse
   when the only reachable names are these. The register lives in
   lib/board-assets.mjs so the served set and the linted set cannot drift. */

/* The api takes a decision, not a document: a body past this is refused
   before it is parsed. */
const MAX_BODY = 64 * 1024;

/* The viewer's two limits (docs/file-refs-spec.md section 3). The NUL sniff is
   what makes "text only" a check instead of a hope, and neither limit parses:
   the server never learns what any of these files mean. */
const MAX_REF_BYTES = 1048576;
const NUL_SNIFF = 8192;

/* Generous against what a person opens and small enough that a runaway client
   cannot pile sockets up: past it the OLDEST stream is dropped, because the
   newest is the one somebody is looking at. */
const STREAM_CAP = 64;

const WATCH_MS = watchMs();
const BEAT_MS = beatMs();
const root = argRoot();

/* Minted per start and named in the secret ping, which is what tells a
   REPLACEMENT from the instance that was already there. */
const instance = randomBytes(8).toString('hex');

/* Resolved ONCE and never re-read: the live wire spawns this server out of the
   working tree, so a version bump edits that file under a running process and a
   per-call read would let a stale instance survive every takeover compare. */
const BOARD_VERSION = envSeam('BOARD_VERSION') || pluginVersion();

let secret = '';
let port = 0;
let server = null;
let watchTimer = null;
let configTimer = null;
let notifier = null;
let tray = null;
/* announce() runs at most once per process, and one watch tick at a time: a
   slow snapshot must not overlap the next tick and raise a change twice. */
let announced = false;
let watchBusy = false;
/* set by shutdown(), read by the deferred tray spawn: a server told to stop
   inside that first read must not be outlived by its tray. */
let stopping = false;
/* CACHED rather than read per request: the ping is the tray's liveness wire and
   a plugin update decides adopt or replace on a 1500ms probe, so the board gets no
   vote on it. syncTray sets these off the local board's cache. */
let dotCache = 'quiet';
/* the tooltip's number beside the corner's word, set with it so the pair cannot disagree */
let blockingCache = 0;
/* the notification channel switched off, read each tick, so the ping can say off rather than down */
let trayOff = false;
/* the menu's counts, set at that same place */
let waitingCache = 0;
let cardsCache = [];
let waitingCardsCache = [];
/* the recent files' own cache, set by the one builder that re-resolves
   them, so a board gone offline answers the hello with the last list. */
let recentCache = [];
/* the last tray digest sent, so a notify.json write and a pause lapse are
   reasons to send that no record digest and no activity line can be */
let lastTrayDigest = null;
/* every open api/events stream, in connect order so the cap drops the oldest */
const streams = new Set();
/* the one stream that arrived carrying this server's own instance. It
   reads one thing no page does (`event: alert`), and there is at most one: a
   newer attach replaces the older, which is ended. */
let trayStream = null;
let beatTimer = null;
/* the board's live rows since the last fan-out, in the console's line shape */
let rows = [];
let rowsMore = false;
let rowAt = '';
/* the schedule the board's OWN writes run the watch tick through: one timer at
   a time, so a burst of POSTs is one read and one event (see kickTick) */
let kickTimer = null;
/* one run OWED, set when a tick was asked for while another was in flight and
   paid off the moment that one settles */
let kickAgain = false;
/* the board half (lib/local-board.mjs), only when boardUrl names a board
   server; every read this server makes goes through it. */
let localBoard = null;
let localTiming = () => {};
/* the board this PC hosts, this server's child while it runs */
let hostBoard = null;

main();

async function main() {
  try {
    await ensureRoot(root);
    const id = boardIdentity(root);
    secret = id.secret;
    port = id.port;
  } catch (e) {
    process.stderr.write('AskerDo board: ' + ((e && e.message) || e) + '\n');
    process.exit(1);
  }
  server = createServer(handle);
  process.on('SIGINT', () => shutdown('interrupted'));
  process.on('SIGTERM', () => shutdown('terminated'));
  listenWithHandshake();
}

function argRoot() {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') return rootValue(argv[i + 1]);
    if (argv[i].startsWith('--root=')) return rootValue(argv[i].slice('--root='.length));
  }
  /* only the no-flag path asks, because a rig server silently serving
     the LIVE store is rootValue's own trap in the other half of the product; an
     explicit flag returned above and never consults the seam. */
  const seamBad = seamRootProblem(process.env);
  if (seamBad) {
    process.stderr.write('AskerDo board: ' + seamBad + '\n');
    process.exit(1);
  }
  return storeRoot();
}

/* The flag is what keeps tests and the ensure path OFF the real store, so a
   missing or flag-shaped value is fatal rather than silently the current
   directory, where it would materialize a whole live store. */
function rootValue(v) {
  if (typeof v !== 'string' || v === '' || v.startsWith('-')) {
    process.stderr.write('AskerDo board: --root needs a directory\n');
    process.exit(1);
  }
  return v;
}

/* The tick reads no board: it re-sends the tray's fields when they moved, so a
   pause lapsing or an open reaches the menu within one period. */
function watchMs() {
  const n = Number(envSeam('WATCH_MS'));
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1000;
}

/* The keepalive holds a stream open through anything that times an idle
   connection out; env is a test seam, because a test that had to wait a real
   period would be a timed pass. */
function beatMs() {
  const n = Number(envSeam('BEAT_MS'));
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 20000;
}

/* Answers the value baked at boot rather than the manifest on disk (see
   BOARD_VERSION for why re-reading would make this compare lie), and every
   server-side consumer goes through here, so there is one answer per process. */
function version() {
  return BOARD_VERSION;
}

/* One board per store, at the address every minted link already carries:
   adopted when the port holds our own current build, replaced when it holds our
   own stale one, refused otherwise. Moving port would orphan every link. */
function listenWithHandshake() {
  server.once('error', (e) => {
    if (!e || e.code !== 'EADDRINUSE') return fatal(e);
    probeBoard(port).then(async (p) => {
      /* a newer build is adopted too, never replaced; no header reads as older.
         Loaded here only: the takeover is rare and mod-core is large */
      const newer = p.mine && p.version !== version() && (await import('../lib/mod-core.mjs')).versionBehind(version(), p.version);
      if (p.mine && (p.version === version() || newer)) {
        if (newer) appendLog(root, 'board: a newer server (' + p.version + ') runs on port ' + port + '; this one (' + version() + ') left it running');
        process.stdout.write(boardUrl(root, 'root') + '\n');
        process.stdout.write('AskerDo board: adopted the instance already running on port ' + port + '\n');
        process.exit(0);
      }
      if (p.mine) {
        /* our own older build: stop it and take the port, which is the only
           way a plugin update ever reaches a running board */
        await postStop(port);
        await waitForFree(port, 3000);
        server.once('error', fatal);
        /* NO callback here on purpose: the first listen's announce is still armed as a
           once('listening') listener, so passing it again would register it twice and
           start two trays and two watch timers on the replace path. */
        server.listen(port, '127.0.0.1');
        return;
      }
      if (p.busy) {
        process.stderr.write('AskerDo board: port ' + port + ' did not answer within the wait (a busy server or another program); the board did not start\n');
        process.exit(1);
      }
      process.stderr.write('AskerDo board: port ' + port + ' is held by another process; '
        + 'the board did not start (the port is permanent; free it, or remove board/ to '
        + 're-mint at the cost of every old link)\n');
      process.exit(1);
    });
  });
  server.listen(port, '127.0.0.1', announce);
}

/* The one place the server declares itself up. Idempotent by construction:
   node leaves the first listen's callback armed after an EADDRINUSE and the
   replace path listens again, so a second run is a shape this must survive. */
function announce() {
  if (announced) return;
  announced = true;
  server.on('error', fatal);
  process.stdout.write(boardUrl(root, 'root') + '\n');
  appendLog(root, 'board: listening on ' + port);
  /* THE ONE WATCHER, started UNCONDITIONALLY: it fans the tray's fields out
     on every host, a machine with no alert channel included. */
  watchTimer = setInterval(watchTick, WATCH_MS);
  if (watchTimer.unref) watchTimer.unref();
  /* the tray digest's baseline, so a first tick sends nothing */
  fanOut();
  localTiming = localTimings(join(root, 'board', 'timings-local.log'));
  /* the CLI's commands load once, warm before the first call */
  cliCommands().catch((e) => { cliModule = null; appendLog(root, 'board: the CLI commands did not load: ' + ((e && e.message) || e)); });
  const board = startLocalBoard();
  startChannel();
  boardReady(board);
  followHost();
  configTimer = setInterval(followConfig, WATCH_MS);
  if (configTimer.unref) configTimer.unref();
}

/* local.json, the file the launcher and boardCall find the local route by, board or none. */
function boardReady(board) {
  try {
    writeAtomic(localFile(), JSON.stringify({ board: board || null, url: localBase() + 'local', pid: process.pid }) + String.fromCharCode(10));
  } catch (e) { appendLog(root, 'board: local.json not written: ' + e.message); }
}

/* a board address or token saved while this runs reaches it: a new address
   starts the local board over, a new token reconnects its stream from the saved cursor */
let boardOn = { url: '', token: '' };
let restarting = null;
function followConfig() {
  followHost();
  if (stopping || restarting) return;
  const url = boardServerUrl();
  const token = boardToken();
  const trim = (u) => String(u || '').replace(/\/+$/, '');
  if (trim(url) !== trim(boardOn.url)) {
    restarting = (async () => {
      const old = localBoard;
      localBoard = null;
      if (old) await old.stop();
      appendLog(root, 'board: the board address in the config changed: ' + (/^https?:/i.test(url) ? url : 'none'));
      boardReady(startLocalBoard());
      kickTick();
    })().catch((e) => appendLog(root, 'board: the local board did not restart: ' + ((e && e.message) || e))).finally(() => { restarting = null; });
    return;
  }
  if (localBoard && token !== boardOn.token) {
    boardOn.token = token;
    appendLog(root, 'board: the board token in the config changed: reconnecting');
    localBoard.retoken(token);
  }
}

/* a board set up here while this runs (board here) starts within one tick */
function followHost() {
  /* a board moved away (board move) leaves its supervisor idle; a later board here gets a new one */
  if (hostBoard && !hostBoard.running() && !readHost(root)) { hostBoard.stop(); hostBoard = null; }
  if (stopping || hostBoard || !readHost(root)) return;
  hostBoard = superviseHost(root, { log: (s) => appendLog(root, s) });
  hostBoard.start().catch((e) => appendLog(root, 'board host: ' + ((e && e.message) || e)));
}

const localBase = () => 'http://127.0.0.1:' + port + '/' + secret + '/';
const localFile = () => join(root, 'board', 'local.json');

let cliModule = null;
const cliCommands = () => (cliModule ||= import('../lib/cli-commands.mjs'));

/* every caller's CLI command runs here; a refusal sends it back to run in
   the caller's own process. */
function cliRoute(req, res) {
  return handleCli(req, res, {
    run: async (call) => (await cliCommands()).runCommand(call),
    refuse: async (b) => (await cliCommands()).routeRefusal(b, { root, own: process.env, version: version() }),
    timing: localTiming,
  });
}

/* the mod's scripts (lib/mod-scripts.mjs) in process here; a caller whose
   environment is not this server's gets a refusal (409) and runs one itself. */
let scriptsModule = null;
const modScripts = () => (scriptsModule ||= import('../lib/mod-scripts.mjs'));
function modRoute(req, res) {
  return handleCli(req, res, {
    kind: 'mod',
    run: async (call) => (await modScripts()).runScript(call),
    refuse: async (b) => {
      if (b.version !== version()) return 'this local server runs ' + version() + ' and the caller ' + (b.version || 'no version');
      return (await cliCommands()).callerProblem(b.env, { root, own: process.env });
    },
    timing: localTiming,
  });
}

/* One stream to the board and the cache, when boardUrl names a board server;
   answers that URL, or '' when there is none. */
function startLocalBoard() {
  const url = boardServerUrl();
  const token = boardToken();
  boardOn = { url, token };
  if (!/^https?:/i.test(url)) return '';
  const base = localBase();
  localBoard = createLocalBoard({
    url,
    token,
    stateDir: join(root, 'board'),
    inboxDir: join(root, 'inbox'),
    alert: localAlerts,
    retract: retractTray,
    log: (s) => appendLog(root, s),
    timing: (...a) => localTiming(...a),
    local: base,
  });
  /* the tray's readings follow the cache: one tick per change */
  localBoard.onChange(() => kickTick());
  localBoard.onRow((ev) => {
    rows.push(streamLine(ev));
    if (rows.length > STREAM_LINES_MAX) { rows = rows.slice(-STREAM_LINES_MAX); rowsMore = true; }
    rowAt = ev.at || rowAt;
    kickTick();
  });
  localBoard.start();
  return url;
}

/* A live row in the console's line shape (server/verbs/activity.mjs): `at` is the
   row's sequence, as the board's own activity pages give it. */
function streamLine(ev) {
  const h = ev.head || {};
  const out = {
    ts: ev.at, verb: ev.verb, kind: ev.kind, id: h.label || ev.id, name: h.title || '',
    changes: ev.changes || {}, by: ev.by, at: String(ev.seq), seq: ev.seq,
    ws: h.kind === 'workstream' ? h.label || null : h.workstream || null,
    /* as the activity pages place a row: a question's project name, so the console keeps it */
    project: h.project || h.projectRepo || null,
  };
  if (h.key) out.key = h.key;
  if (ev.note) out.note = ev.note;
  return out;
}
const STREAM_LINES_MAX = 200;

/* Alerts from the board's rows, through the same gates as the store's watcher. */
async function localAlerts({ questions, work }) {
  if (!notifier || !notifier.available) return;
  const settings = notifier.loadSettings();
  if (!settings.enabled) return;
  if (questions.length) await notifier.raise(questions, settings);
  for (const ev of work) createWorkNotifier({ root, port, secret }).raise(ev);
}

/* The tray's dot, counts and cards off the board's cache once it is loaded; before
   that, and with no board set, the last values (quiet at start). */
function syncTray() {
  if (!localBoard || !localBoard.status().loaded) return;
  const t = localBoard.tray();
  dotCache = t.dot;
  blockingCache = t.blocking;
  waitingCache = t.waiting;
  cardsCache = t.cards;
  waitingCardsCache = t.waitingCards;
}

/* Started only from announce(): an ADOPTED start exits long before this, which
   is what makes a second tray icon impossible. */
function startChannel() {
  /* the relay is handed in rather than reached for, so lib/notify.mjs
     knows nothing about streams. */
  notifier = createNotifier({ root, port, secret, instance, pushAlert });
  if (!notifier.available) return;
  notifier.ensureSettings();
  const settings = notifier.loadSettings();
  trayOff = !settings.enabled;
  /* The faces are compiled into the exe, so this half resolves no icon path. */
  tray = createTray({
    root,
    port,
    secret,
    instance,
    /* the version the exe wears is the one THIS process serves, baked at boot */
    version: version(),
  });
  /* Unconditionally, synchronously, and before the spawn: a record another instance
     left behind is diagnosis, and it must be read, logged and deleted whether or
     not this server goes on to run a tray of its own. */
  tray.sweep();
  /* the face the board's cache holds now; a later change reaches it on the stream */
  syncTray();
  spawnTray(settings, dotCache);
}

function spawnTray(settings, dot) {
  if (stopping || !tray) return;
  /* the count rides the same snapshot the face did: the tray is handed one
     reading of the store, never two */
  tray.start(settings, dot, { blocking: blockingCache });
}

/* a store folder deleted or re-minted under this server would leave it serving a
   secret no link knows beside the next ensure's server; { why, deleted }, or null to stay.
   Only a missing file or another valid secret counts, never a read that failed. */
function storeGone() {
  let now;
  try { now = readFileSync(join(root, 'board', 'secret'), 'utf8').trim(); } catch (e) {
    return e && e.code === 'ENOENT' ? { why: 'the store folder ' + root + ' or its board/secret is gone', deleted: true } : null;
  }
  return /^[0-9a-f]{32}$/.test(now) && now !== secret ? { why: 'board/secret in ' + root + ' was minted again' } : null;
}

/* One watcher. The settings are re-read every tick, so a hand edit takes effect
   within one period; the FIRST fan-out records the baseline and sends nothing. */
function watchTick() {
  if (stopping) return;
  const gone = storeGone();
  if (gone) {
    process.stderr.write('AskerDo board: ' + gone.why + '\n');
    return shutdown(gone.why, { log: !gone.deleted });
  }
  /* A DROPPED TICK IS A QUEUED ONE: the flag says one more run is owed and the
     finally below pays it, so a change inside a tick fans out at once. */
  if (watchBusy) { kickAgain = true; return; }
  watchBusy = true;
  syncTray();
  recentCards().catch(() => recentCache).then(() => fanOut()).catch((e) => {
    /* once per distinct message: a tick that stays broken must not log every period */
    if (notifier && notifier.available) notifier.logOnce('board watch: ' + ((e && e.message) || e));
  }).finally(() => {
    watchBusy = false;
    if (kickAgain) {
      kickAgain = false;
      kickTick();
    }
  });
}

/* THE TICK, AT ONCE, AFTER THE BOARD'S OWN WRITE. ONE helper and the ONE
   watchTick behind it: a zero-delay schedule coalesces a burst into one read
   and one event, and a tick already in flight is queued rather than dropped. */
function kickTick() {
  if (kickTimer) return;
  kickTimer = setTimeout(() => {
    kickTimer = null;
    watchTick();
  }, 0);
  if (kickTimer.unref) kickTimer.unref();
}

/* ---- the events channel ------------------------------------------------ */

/* WHAT AN EVENT SAYS, in ONE builder: the same payload answers the `hello` a
   stream opens with and every `change` the watcher fans out. */
/* Lifted out of eventPayload so the FAN-OUT's digest reads exactly the frame
   that would be sent. The two pause fields come off notify.json, because a
   pause is not a fact about the store: it lapses on a clock. */
function trayPayload() {
  const settings = loadSettings(root);
  trayOff = !settings.enabled;
  const at = notifyNow();
  return {
    instance,
    dot: dotCache,
    blocking: blockingCache,
    waiting: waitingCache,
    questions: cardsCache,
    waitingQuestions: waitingCardsCache,
    /* THE FILES THE OPENER TOUCHED, and NO ABSOLUTE PATH RIDES HERE:
       this payload goes to every consumer on every change, and a menu line needs
       a label and a way to ask, not a path. */
    recent: recentCache,
    pausedUntil: settings.pausedUntil,
    pauseLabel: pauseLabel(at, settings.pausedUntil),
    beatMs: BEAT_MS,
  };
}

/* EVERY READER RE-RESOLVES BEFORE IT RENDERS, which keeps the refs list the
   only path authority even for a list of paths. The name is the basename, cut at
   120 code points. A board this PC cannot read throws, and the last list stands. */
async function recentCards() {
  if (!localBoard || !localBoard.status().loaded) return recentCache;
  const out = [];
  for (const e of loadRecent(root)) {
    const hit = await resolveRef(e.id, String(e.index));
    if (!hit || hit.target !== e.path) continue;
    out.push({
      id: e.id,
      index: e.index,
      name: Array.from(basename(e.path)).slice(0, RECENT_NAME_MAX).join(''),
    });
    if (out.length === RECENT_MENU) break;
  }
  recentCache = out;
  return out;
}

/* THE ONE CLOCK the pause is resolved and rendered against, and it is the
   NOTIFIER's, which is the clock the tray already shares. */
function notifyNow() {
  return notifier && typeof notifier.now === 'function' ? notifier.now() : new Date();
}

/* `tray` is the payload the FAN-OUT already built, handed back in so one tick
   is ONE read of notify.json: the digest and the frame that follows it describe
   the same file by construction. `rev` is the board's sequence this PC has read. */
function eventPayload(acts, tray) {
  const payload = {
    rev: localBoard ? String(localBoard.status().seq) : '',
    version: version(),
    activity: (acts && acts.lines) || [],
    activityAt: rowAt,
    /* THE TRAY'S AND THE MENU'S OWN FIELDS: one builder answers the
       hello and every change. Names travel cut at 120 code points. */
    tray,
  };
  if (acts && acts.more) payload.activityMore = true;
  return payload;
}

/* A write to a socket the client already dropped throws, and there is nothing
   to do about it here: the close handler takes that stream out of the set. */
function sseSend(res, event, data) {
  try {
    res.write('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n');
  } catch { /* the close handler drops it */ }
}

/* ONE timer for every stream rather than one per stream. It is what holds a
   stream open through anything that times an idle connection out, and it runs
   only while somebody is listening. */
function startBeat() {
  if (beatTimer || !streams.size) return;
  beatTimer = setInterval(() => {
    for (const st of streams) {
      try { st.res.write(': beat\n\n'); } catch { /* the close handler drops it */ }
    }
  }, BEAT_MS);
  if (beatTimer.unref) beatTimer.unref();
}

function stopBeat() {
  if (beatTimer && !streams.size) {
    clearInterval(beatTimer);
    beatTimer = null;
  }
}

function dropStream(st) {
  streams.delete(st);
  if (trayStream === st) trayStream = null;
  try { st.res.end(); } catch { /* already gone */ }
  stopBeat();
}

/* THE ALERT RELAY, on the tray stream and nowhere else, and it
   STARTS the exe on demand. res.write does NOT throw on a socket already gone,
   so the STATE of the response is what says the stream is dead. */
const refused = (reason, logged) => ({ reason, logged: logged === true });

/* The request resolved once here; true when the tray took it, else the refusal. */
async function pushAlert(alert) {
  const frame = await alertWire(alert);
  if (!frame) return refused('the alert carried no title', true);
  const via = await relayTray(frame);
  return typeof via === 'string' ? true : via;
}

/* 'popup' when the tray took it, else the refusal. A tray that never announced
   the popup gets nothing (no toast fallback). */
async function relayTray(frame) {
  /* the demand is made AT MOST ONCE per alert, whether it was there to be made
     at the start or only after a dead stream was dropped: no alert is worth a
     second exe start */
  let demanded = false;
  for (;;) {
    if (!trayStream) {
      if (!tray || demanded) return refused('no tray attached');
      demanded = true;
      if (tray.exited() === 'byPerson') {
        appendLog(root, 'tray: the tray was exited by the person; alerts wait for the next session start');
        return refused('the tray was exited by the person', true);
      }
      const up = await tray.ensureRunning(notifier ? notifier.loadSettings() : null);
      if (!up || !trayStream) return refused('no tray attached');
    }
    const st = trayStream;
    if (st.res.destroyed || st.res.writableEnded) {
      dropStream(st);
      continue;
    }
    if (!st.popup) {
      appendLog(root, 'tray: the attached tray draws no popup; the alert was dropped');
      return refused('the attached tray draws no popup', true);
    }
    try {
      st.res.write('event: alert\ndata: ' + JSON.stringify(frame) + '\n\n');
      /* a question alerting again is live, so a later attach must not retract it */
      if (frame.question) recentRetracts.delete(frame.question);
      return 'popup';
    } catch {
      dropStream(st);
      continue;
    }
  }
}

/* a settled question's cards leave the popup. Never a demand: an exe that
   is not up holds no card, and an older one ignores the event. */
function retractTray(id) {
  if (!/^Q\d+$/.test(String(id))) return;
  /* kept, so a popup that attaches later (a catch-up before the tray is back) drops it too */
  recentRetracts.delete(id);
  recentRetracts.add(id);
  if (recentRetracts.size > RETRACT_CAP) recentRetracts.delete(recentRetracts.values().next().value);
  writeRetracts(trayStream, [id]);
}
const RETRACT_CAP = 64;
const recentRetracts = new Set();
function writeRetracts(st, ids) {
  if (!st || !st.popup || st.res.destroyed || st.res.writableEnded) return;
  try {
    for (const id of ids) st.res.write('event: retract\ndata: ' + JSON.stringify({ question: id }) + '\n\n');
  } catch {
    dropStream(st);
  }
}

function boardBase() {
  return 'http://127.0.0.1:' + port + '/' + secret + '/';
}

/* The record's openable refs as the popup lists them: id, position and basename,
   never a path, through the one resolution every f/ route takes. */
async function alertFiles(id, which) {
  if (!id || !(which === true || (Array.isArray(which) && which.length))) return [];
  const addr = refAddress(id, '0');
  let rec = null;
  try { rec = addr ? await recordAt(addr) : null; } catch { rec = null; }
  if (!rec) return [];
  const count = pathsOf(rec).length;
  const picks = which === true ? [...Array(count).keys()] : which.filter((n) => Number.isInteger(n) && n >= 0 && n < count);
  const out = [];
  for (const n of picks) {
    /* only a ref that resolves and is on disk now, a file or a folder */
    const hit = resolveAt(rec, n);
    let st = null;
    try { st = hit ? statSync(hit.target) : null; } catch { st = null; }
    if (!st || (!st.isFile() && !st.isDirectory())) continue;
    out.push({ id, index: n, name: Array.from(basename(hit.target)).slice(0, RECENT_NAME_MAX).join('') });
    if (out.length === ALERT_FILES_MAX) break;
  }
  return out;
}

/* A work record's project and workstream names off the local board's cache, a
   body read for one it does not hold (a task that just ended); whatever cannot be
   read is left out, never guessed. */
async function cachedWhereNames(id) {
  if (!localBoard) return {};
  const rec = async (x) => {
    const hit = localBoard.record(x);
    if (hit) return hit;
    try { return await localBoard.body(x); } catch { return null; }
  };
  const r = await rec(id);
  if (!r) return {};
  const links = Array.isArray(r.links) ? r.links : [];
  const wsId = /^WS-/.test(id) ? null : (r.workstream || links.find((l) => /^WS-\d+$/.test(l)) || null);
  const ws = wsId ? await rec(wsId) : /^WS-/.test(id) ? r : null;
  const out = {};
  if (wsId && ws && typeof ws.name === 'string' && ws.name.trim()) out.workstream = ws.name;
  /* the workstream's shared name (an old record's folder is named by its path) */
  const first = (k) => (ws && Array.isArray(ws[k]) ? ws[k].find((x) => typeof x === 'string' && x.trim()) : '') || '';
  const raw = String(first('projectRepos') || first('projects') || links.find((l) => /^([A-Za-z]:)?[\\/]/.test(l)) || '');
  const key = /^([A-Za-z]:)?[\\/]/.test(raw) ? normDir(raw) : raw;
  if (key) {
    const q = [...localBoard.cache.questions.values()].find((e) => e && (e.projectRepo === key || (!!e.projectDir && normDir(e.projectDir) === key))
      && typeof e.project === 'string' && e.project.trim());
    /* the name a question in it was asked under, in its own casing, else the name's last part */
    const name = q ? q.project : raw.replace(/\\/g, '/').split('/').filter(Boolean).pop();
    if (name) out.project = name;
  }
  return out;
}

/* A request into the wire frame. One that fails validation or names a card off
   this board is drawn as the plain card off its own title, with one log line;
   null only when it carries no title at all. */
async function alertWire(request) {
  const base = boardBase();
  let v = validateAlert(request);
  const card = v.error ? null : alertCard(v.value.card, base);
  if (!card) {
    appendLog(root, 'alert: drawn plain: ' + (v.error || 'the card is not on this board'));
    v = validateAlert(plainAlert(request));
    if (v.error) return null;
    return alertFrame(v.value, { base, settings: loadSettings(root), card: alertCard('', base), files: [] });
  }
  const files = await alertFiles(card.id, v.value.files);
  /* a work ending sends no names (no store read on the verb's exit
     path), so they come off the local board's cache */
  if (!Object.keys(v.value.whereNames).length && /^(?:WS|P|T|TH|TR)-\d+(?:\.\d+)?$/.test(card.id)) {
    v.value.whereNames = await cachedWhereNames(card.id);
  }
  return alertFrame(v.value, { base, settings: loadSettings(root), card, files });
}

/* The plain card a broken request still makes: its title and its `where` line,
   the info glyph, no card and no files. */
function plainAlert(request) {
  const r = request && typeof request === 'object' ? request : {};
  const text = (k) => (typeof r[k] === 'string' ? r[k] : '');
  const out = { kind: 'info', title: text('title'), where: text('where'), blocking: false };
  if (r.sound === 'silent' || SOUNDS.includes(r.sound)) out.sound = r.sound;
  return out;
}

/* THE OPEN RELAY, relayTray's body with three differences: the event
   name, any tray rather than a popup one, and ensureForOpen as the demand seam.
   Written to the tray stream alone, exactly as an alert is. */
async function pushOpen(frame) {
  /* the demand is made AT MOST ONCE per open, whether it was there to be made at
     the start or only after a dead stream was dropped */
  let demanded = false;
  for (;;) {
    if (!trayStream) {
      if (!tray || demanded) return { reason: 'no tray is attached to take the open' };
      demanded = true;
      /* A CLICK IS A DEMAND FROM THE PERSON: neither the notification master
         switch nor an earlier Exit refuses it. */
      const up = await tray.ensureForOpen(notifier ? notifier.loadSettings() : loadSettings(root));
      if (!up || !trayStream) return { reason: 'the tray did not attach, so the open was not sent' };
    }
    const st = trayStream;
    /* res.write does NOT throw on a socket already gone, so the STATE of the
       response is what says the stream is dead. */
    if (st.res.destroyed || st.res.writableEnded) {
      dropStream(st);
      continue;
    }
    try {
      st.res.write('event: open\ndata: ' + JSON.stringify(frame) + '\n\n');
      return true;
    } catch {
      dropStream(st);
      continue;
    }
  }
}

/* GET only, never cached, and it adds NO second watcher: the one watch tick
   fans out to whatever is in this set. */
function events(req, res) {
  /* THE TRAY ATTACH. The instance in the header is the whole check: a tray
     whose server was replaced on the port would otherwise wear the
     replacement's dot while its own --board URL named a server that is gone. */
  const claim = String(req.headers['x-askerdo-tray'] || '');
  if (claim && claim !== instance) {
    res.writeHead(409, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    return res.end('another instance\n');
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    /* the SSE spelling, deliberately not the no-store every other route here
       sends: a stream is revalidated by being reopened */
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    /* nothing between this process and the browser buffers today (loopback, no
       proxy), and this is what says so to anything that ever sits in between */
    'X-Accel-Buffering': 'no',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  if (res.flushHeaders) res.flushHeaders();
  /* an idle stream is the NORMAL state of this route: no socket timeout, and no
     Nagle delay in front of a frame the reader is waiting on */
  if (req.socket) {
    try {
      req.socket.setTimeout(0);
      req.socket.setNoDelay(true);
      req.socket.setKeepAlive(true);
    } catch { /* a socket that will not take these still carries the stream */ }
  }
  /* the cap drops the oldest stream that is NOT the tray. The tray is the oldest
     stream in the normal case, so a plain cap would have evicted it and left
     every alert with nowhere to go whenever a sixty-fifth page opened. */
  while (streams.size >= STREAM_CAP) {
    let victim = null;
    for (const s of streams) {
      if (s !== trayStream) { victim = s; break; }
    }
    if (!victim) break;
    dropStream(victim);
  }
  const st = { res };
  streams.add(st);
  /* THE NEWEST ATTACH IS THE TRAY and the older one is ended: an exe that
     reconnected must not leave the alerts going to a socket nobody reads. This
     sits after the add, so the replaced stream is dropped, not the new one. */
  if (claim) {
    if (trayStream && trayStream !== st) dropStream(trayStream);
    st.tray = true;
    /* an exe that draws the popup says so, and only it is sent alerts */
    st.popup = String(req.headers['x-askerdo-popup'] || '') === '1';
    trayStream = st;
    /* the module that spawned the exe learns it arrived, which is what answers
       every alert waiting on an on-demand start */
    if (tray) tray.attached();
  }
  startBeat();
  res.on('close', () => {
    streams.delete(st);
    if (trayStream === st) trayStream = null;
    stopBeat();
  });
  /* the hello goes out AT ONCE, so a reader that reconnected after a gap can ask
     api/activity for the lines it missed. */
  syncTray();
  recentCards().catch(() => recentCache).then(() => {
    sseSend(res, 'hello', eventPayload(null, trayPayload()));
    if (st.popup) writeRetracts(st, [...recentRetracts]);
  });
}

/* Called by the ONE watch tick: a change goes out when the tray's own fields
   moved or a board row landed, and never on the first reading. */
function fanOut() {
  const lines = rows;
  const more = rowsMore;
  rows = [];
  rowsMore = false;
  /* a notify.json write and a pause LAPSING move no record, so the menu's own
     digest is a reason to send of its own */
  const t = trayPayload();
  const digest = trayDigest(t);
  const first = lastTrayDigest === null;
  const trayMoved = digest !== lastTrayDigest;
  lastTrayDigest = digest;
  if (first || (!trayMoved && !lines.length) || !streams.size) return;
  const payload = eventPayload({ lines, more }, t);
  for (const open of [...streams]) sseSend(open.res, 'change', payload);
}

/* Everything the MENU draws, in one string. `pauseLabel` has to be in it: a
   lapsed stamp is never rewritten, so a digest over the stored value cannot
   move and the exe, which holds no clock, would keep drawing a dead pause. */
function trayDigest(t) {
  return [
    t.dot,
    t.blocking,
    t.waiting,
    t.questions.map((q) => q.id).join(','),
    t.waitingQuestions.map((q) => q.id).join(','),
    /* the eighth part: an open writes board/recent.json, which moves no
       record and no activity line, exactly as a notify.json write does not. */
    t.recent.map((r) => r.id + ':' + r.index).join(','),
    t.pausedUntil,
    t.pauseLabel,
  ].join('|');
}

function endStreams() {
  for (const open of [...streams]) dropStream(open);
}

function fatal(e) {
  process.stderr.write('AskerDo board failed to start: ' + ((e && e.message) || e) + '\n');
  process.exit(1);
}

/* the ensure's rule: a 204 on the secret ping is ours, of any version */
const probeBoard = (p) => probe(p, secret);

function postStop(p) {
  return new Promise((done) => {
    const req = httpRequest({
      host: '127.0.0.1', port: p, method: 'POST', path: '/' + secret + '/stop', timeout: 1500,
    }, (res) => { res.resume(); res.on('end', done); });
    req.on('timeout', () => { req.destroy(); done(); });
    req.on('error', () => done());
    req.end();
  });
}

/* Connection-refused is the only honest signal that the old listener is gone;
   a closing server keeps accepting until its last socket drains. */
function waitForFree(p, capMs) {
  const deadline = Date.now() + capMs;
  const step = () => new Promise((done) => {
    let settled = false;
    const finish = (free) => { if (!settled) { settled = true; done(free); } };
    const req = httpRequest({
      host: '127.0.0.1', port: p, method: 'POST', path: '/' + secret + '/ping', timeout: 500,
    }, (res) => { res.resume(); finish(false); });
    req.on('timeout', () => { req.destroy(); finish(false); });
    req.on('error', () => finish(true));
    req.end();
  });
  const loop = async () => {
    for (;;) {
      if (await step()) return true;
      if (Date.now() >= deadline) return false;
      await new Promise((r) => setTimeout(r, 150));
    }
  };
  return loop();
}

/* Bound to loopback already; this adds the rebinding guard. Exactly three
   names, all with the bound port. [::1] is deliberately absent: the server
   never binds v6. */
function hostOk(req) {
  const bound = server.address().port;
  const host = String(req.headers.host || '').toLowerCase();
  return host === 'askerdo.localhost:' + bound
    || host === 'localhost:' + bound
    || host === '127.0.0.1:' + bound;
}

function handle(req, res) {
  if (!hostOk(req)) return notFound(res);
  let pathname;
  try {
    pathname = new URL(req.url, 'http://127.0.0.1').pathname;
  } catch {
    return notFound(res);
  }
  const base = '/' + secret;
  if (pathname !== base && !pathname.startsWith(base + '/')) return notFound(res);
  const rest = pathname === base ? '' : pathname.slice(base.length + 1);

  /* the tray's links open the board's web pages, signed in */
  const web = req.method === 'GET' ? webPage(rest, req.url) : null;
  if (web) return toWeb(res, web);
  if (req.method === 'GET' && (rest === '' || rest === 'needs-you' || /^[qwr]\//.test(rest) || /^override\/\d+$/.test(rest))) {
    return sendText(res, 200, 'AskerDo: this PC is not on a board yet: join it with a code from join-code on a PC on the board (/askerdo:configure, the join-a-pc card).\n');
  }
  /* Keyed on a RECORD OR QUESTION id plus a LIST POSITION and never on a path
     (docs/file-refs-spec.md section 6). Three shapes and no fourth, the method
     part of each, so a deeper URL is not a deeper read. */
  if (rest.startsWith('f/')) {
    const parts = rest.slice(2).split('/');
    if (req.method === 'GET' && parts.length === 2) return fileRef(res, parts[0], parts[1], false);
    if (req.method === 'GET' && parts.length === 3 && parts[2] === 'raw') {
      return fileRef(res, parts[0], parts[1], true);
    }
    if (req.method === 'POST' && parts.length === 3 && parts[2] === 'open') {
      return fileOpen(req, res, parts[0], parts[1]);
    }
    return notFound(res);
  }
  /* THE EVENT STREAM: the tray's state and the activity lines. */
  if (req.method === 'GET' && rest === 'api/events') return events(req, res);
  /* THE ACTIVITY LOG'S PAGES: the live rows arrive on the stream above,
     and this is how a reader gets the older ones (kept for a tray console). */
  if (req.method === 'GET' && rest === 'api/activity') return activityApi(req, res);
  /* THE WORK ENDINGS' ALERT RELAY. Unlike every other api route here it writes
     NOTHING: no record, no board file, no activity line. */
  if (req.method === 'POST' && rest === 'api/relay') return relayApi(req, res);
  /* THE ALERT ENTRY POINT, the mod's native channel: writes nothing either */
  if (req.method === 'POST' && rest === 'api/alert') return alertApi(req, res);
  /* THE NOTIFICATIONS PAGE and its three routes: the two settings routes
     write board/notify.json and nothing else, and the test route writes nothing
     at all. */
  if (req.method === 'GET' && rest === 'notifications') return notifyPage(res);
  if (req.method === 'GET' && rest === 'api/notify') return notifyGet(res);
  if (req.method === 'POST' && rest === 'api/notify') return notifyApi(req, res);
  if (req.method === 'POST' && rest === 'api/notify/test') return notifyTest(req, res);
  /* the tray's Add a PC page and the route its script mints a join code through */
  if (req.method === 'GET' && rest === 'add-pc') return addPcPage(res);
  if (req.method === 'POST' && rest === 'api/join-code') return joinCodeApi(res);
  if (req.method === 'GET' && rest.startsWith('assets/')) return sendAsset(req, res, rest.slice('assets/'.length));
  /* the mod's and the CLI's one route to the board's cache */
  if (rest === 'local/cli') return cliRoute(req, res);
  if (rest === 'local/mod') return modRoute(req, res);
  if (rest.startsWith('local/')) return handleLocal(localBoard, req, res, rest.slice('local/'.length), localTiming);
  if (req.method === 'POST' && rest === 'ping') return ping(res);
  /* the ensure's call at a session start, which brings back a tray the person closed */
  if (req.method === 'POST' && rest === 'api/tray') return trayApi(res);
  if (req.method === 'POST' && rest === 'stop') {
    /* an ensure replacing the version it saw stops only that one, so a session
       start racing another never stops the server the other just started */
    const seen = req.headers['x-askerdo-if-version'];
    if (typeof seen === 'string' && seen !== version()) return sendJson(res, 409, { error: 'this server runs ' + version() + ', not ' + seen });
    /* THE TRAY GOES FIRST, before the stream it is reading is closed: stdin
       EOF is what makes the exe remove its own icon, and a tray told to stop by the
       closing of its stream would exit through the reconnect path instead. */
    if (tray) tray.stop();
    /* every open stream ends BEFORE the answer goes out, so a client watching
       one learns the server is going down rather than waiting on a socket that
       is about to be closed under it */
    endStreams();
    /* shut down only once the answer is on the wire, so the caller sees it */
    res.on('finish', () => shutdown('stopped'));
    return sendJson(res, 200, { ok: true, stopped: true });
  }
  return notFound(res);
}

function assetBase() {
  return '/' + secret + '/assets';
}

/* The secret ping, and the wire the tray swaps its face on. SYNCHRONOUS
   deliberately: two mechanisms key their liveness on it, so it answers out of
   memory and the store gets no vote on whether this server looks alive. */
function ping(res) {
  /* the tray exe's wire: its instance check and dot read these */
  res.writeHead(204, {
    'x-askerdo-board': version(),
    'x-askerdo-instance': instance,
    'x-askerdo-dot': dotCache,
    'x-askerdo-tray-state': trayState(),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end();
}

/* up: a tray is on the stream; closed: the person chose Exit; off: the channel is
   switched off; down: no tray */
function trayState() {
  if (trayStream) return 'up';
  if (tray && tray.exited() === 'byPerson') return 'closed';
  return tray && trayOff ? 'off' : 'down';
}

/* A tray already running is left alone; enabled false in the settings still spawns none. */
function trayApi(res) {
  if (!tray || !notifier) return sendJson(res, 200, { tray: trayState(), started: false });
  const was = trayState();
  const running = !!tray.running();
  if (!running) spawnTray(notifier.loadSettings(), dotCache);
  const started = !running && !!tray.running();
  if (started && was === 'closed') appendLog(root, 'tray: started again by a session start after the person chose Exit');
  return sendJson(res, 200, { tray: trayState(), started });
}

/* ---- the links to the board's pages ------------------------------------ */

function sendText(res, code, text) {
  res.writeHead(code, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  res.end(text);
}

function redirect(res, to) {
  res.writeHead(302, { location: to, 'cache-control': 'no-store' });
  return res.end();
}

/* the board's page a tray link names (the root the overview, q/, w/ and r/ a
   record by label or key, needs-you the open set, override/n a request), or null with no board server set. */
function webPage(rest, rawUrl) {
  if (!/^https?:/i.test(boardServerUrl())) return null;
  if (rest === '') return WEB.root();
  if (rest === 'needs-you') {
    let q = null;
    try { q = new URL(rawUrl, 'http://127.0.0.1').searchParams; } catch {}
    const repo = ((q && q.get('repo')) || '').slice(0, 260);
    /* a link minted before the shared name still opens its project's set */
    const project = ((q && q.get('project')) || '').slice(0, 200);
    return repo || !project ? WEB.needsYou(repo) : '/needs-you?project=' + encodeURIComponent(project);
  }
  if (/^override\/\d+$/.test(rest)) return WEB.override(rest.slice('override/'.length));
  if (!/^[qwr]\/./.test(rest)) return null;
  let id = rest.slice(2);
  try { id = decodeURIComponent(id); } catch {}
  return WEB.record(String(id).trim().slice(0, 40));
}

/* Through a single-use login link, so the browser lands signed in; with the link
   refused or the board away, the page itself (a browser signed in before still reads it). */
async function toWeb(res, page) {
  const url = boardServerUrl();
  let timer;
  try {
    /* a click waits 3 s at most, under boardRequest's own 10 s */
    const late = new Promise((_, fail) => { timer = setTimeout(() => fail(new Error('no answer in 3 s')), WEB_LINK_MS); });
    const l = await Promise.race([boardLoginLink(page, { url, token: boardToken() }), late]);
    if (l && typeof l.url === 'string' && /^https?:\/\//i.test(l.url)) return redirect(res, l.url);
  } catch (e) {
    appendLog(root, 'board: no login link for ' + page + ': ' + ((e && e.message) || e));
  } finally { clearTimeout(timer); }
  return redirect(res, url.replace(/\/+$/, '') + page);
}
const WEB_LINK_MS = 3000;

/* ---- the activity sheet's pages ---------------------------------------- */

/* The page size this route answers, the tray console's own page. A `limit`
   above it is refused, never clamped: a short answer would read as the end. */
const ACTIVITY_CAP = 200;
const ACTIVITY_SEARCH_MAX = 200;
const ACTIVITY_KEYS = Object.freeze(['month', 'before', 'limit', 'search', 'kind', 'id', 'project']);
const PROJECT_MAX = 260;

/* The query, validated whole before the board is asked and refused with the
   reason: a key this route does not know is a typo, not a filter to ignore. */
function activityQuery(req) {
  let params;
  try {
    params = new URL(req.url, 'http://127.0.0.1').searchParams;
  } catch {
    return { error: 'the query string could not be read' };
  }
  const cut = (v) => String(v).slice(0, 40);
  for (const key of params.keys()) {
    if (!ACTIVITY_KEYS.includes(key)) return { error: 'unknown query key: ' + cut(key) };
    if (params.getAll(key).length > 1) return { error: key + ' takes one value' };
  }
  const input = { places: true };
  const month = params.get('month');
  if (month !== null) {
    if (!/^\d{4}-\d{2}$/.test(month)) return { error: 'month takes YYYY-MM: ' + cut(month) };
    input.month = month;
  }
  const before = params.get('before');
  if (before !== null) {
    /* a page's nextBefore is the board's row sequence */
    if (!/^\d{1,15}$/.test(before) && !isFullStamp(before)) return { error: 'before takes a page cursor or a full local stamp: ' + cut(before) };
    input.before = before;
  }
  const limit = params.get('limit');
  if (limit !== null) {
    if (!/^\d{1,4}$/.test(limit)) return { error: 'limit takes a whole number: ' + cut(limit) };
    const n = Number(limit);
    if (n < 1 || n > ACTIVITY_CAP) return { error: 'limit is 1 to ' + ACTIVITY_CAP };
    input.limit = n;
  }
  const search = params.get('search');
  if (search !== null) {
    if (search.length > ACTIVITY_SEARCH_MAX) return { error: 'search is at most ' + ACTIVITY_SEARCH_MAX + ' characters' };
    if (search.trim()) input.search = search;
  }
  const kind = params.get('kind');
  if (kind !== null) {
    if (!/^[a-z]{1,20}$/.test(kind)) return { error: 'kind takes a record kind: ' + cut(kind) };
    input.kind = kind;
  }
  const id = params.get('id');
  if (id !== null) {
    if (!REC_ID.test(id) && !CARD_ID.test(id) && !isKey(id)) return { error: 'id takes a record id: ' + cut(id) };
    input.id = id;
  }
  if (params.has('project')) {
    const dir = normDir(params.get('project'));
    if (!dir) return { error: 'project takes a directory' };
    if (dir.length > PROJECT_MAX) return { error: 'project is at most ' + PROJECT_MAX + ' characters' };
    input.project = dir;
    /* rows carry the project's shared name; the folder matches only a record from before the map */
    const repo = sharedName(params.get('project').trim());
    if (repo) input.projectRepo = repo;
  }
  return { input };
}

/* THE COMPOSED TOKEN ON EVERY ACTIVITY ROW: the log stores the bare
   letter the record holds and nothing rewrites a written line, so the token a
   reader is owed is composed where the row is shaped, never in the log. */
function composeChosen(lines) {
  return (lines || []).map((line) => {
    const pair = line && line.changes && line.changes.chosen;
    if (!Array.isArray(pair)) return line;
    /* BOTH ENDS: an answer's pair is [null, letter] and a correction's is
       [letter, letter]; copied, since the page is the local board's memo */
    const tok = (v) => (typeof v === 'string' ? answerToken(line.id, v) : v);
    return { ...line, changes: { ...line.changes, chosen: [tok(pair[0]), tok(pair[1])] } };
  });
}

/* GET api/activity: the board's `activity` rows newest first, each with its `ws`
   and `project`, `at` the row sequence the stream's lines carry, and `wsNames`.
   With no board set there are no rows, as there is no record behind an f/ link. */
function activityApi(req, res) {
  const q = activityQuery(req);
  if (q.error) return sendJson(res, 400, { error: q.error });
  if (!localBoard) return sendJson(res, 200, { lines: [], nextBefore: null, wsNames: {} });
  return localBoard.read('activity', q.input).then(({ result }) => {
    const page = { ...result, lines: composeChosen(result.lines) };
    return sendJsonText(res, 200, JSON.stringify(page) + '\n');
  }, (e) => {
    if (res.headersSent) return undefined;
    if (e instanceof BoardOffline) return sendJson(res, 503, { error: e.message });
    if (e instanceof BoardCallError && e.status >= 400 && e.status < 500) return sendJson(res, 400, { error: e.message });
    appendLog(root, 'board activity failed: ' + ((e && e.stack) || e));
    return sendJson(res, 500, { error: 'the activity log could not be read' });
  });
}

/* ---- the file viewer --------------------------------------------------- */

/* Every path this server will ever open for one record, by position in the
   list lib/record-refs.mjs names for its kind. */
function refPaths(rec) {
  /* a procedure card names its project only; its files sit in this PC's folder for it */
  const card = rec && rec.kind === 'procedure' && !rec.project && rec.projectRepo
    ? { ...rec, project: folderHere(rec.projectRepo, { dir: dataDir() }) || '' } : rec;
  return openable(filesOf(card, (n) => folderHere(n, { dir: dataDir() })));
}

/* The QUESTION side of the very same allowlist: a question's evidence is
   to a Q id what a record's refs are to a work token, and it is imported from
   the card's own builder so position n cannot mean two things. */
function evidencePaths(q) {
  return openable(evidenceOf(q && q.evidence));
}

/* The one reading both lists take, position for position: the classifier's
   answer, with everything it does not call a path holding its place as an empty
   string, so an index still lines up and still resolves to nothing. */
function openable(list) {
  return list
    .map((ref) => (refShape(ref, process.platform) === 'path' ? String(ref).trim() : ''));
}

/* AN ANNOTATED ENTRY RESOLVES BY ITS PATH: the older evidence
   lists spell "path (a note)", so a string that is not on disk as written and
   closes on a parenthesis is retried once without its last " (...)" tail.
   BEFORE lineCut, so "path:42 (a note)" still keeps its line. */
function refPath(ref) {
  const s = String(ref === undefined || ref === null ? '' : ref).trim();
  const cut = s.lastIndexOf(' (');
  if (cut <= 0 || !s.endsWith(')')) return s;
  /* one stat, and only for a string that cannot be what it says: an entry whose
     whole spelling exists is that file, annotation and all */
  if (existsSync(resolve(s))) return s;
  return s.slice(0, cut).trim() || s;
}

/* A ref's :line and :col tails are cut HERE, server-side and exactly once, so the
   page, the raw route, the open route and the allowlist agree on the file
   (file-refs-spec section 4; the widening is safe, since a cut ref would only 404 otherwise). */
function lineCut(ref) {
  const s = String(ref === undefined || ref === null ? '' : ref).trim();
  const both = /^(.+):(\d+):(\d+)$/.exec(s);
  if (both) return { path: both[1], line: both[2], col: both[3] };
  const one = /^(.+):(\d+)$/.exec(s);
  return one ? { path: one[1], line: one[2], col: '' } : { path: s, line: '', col: '' };
}

/* One canonical spelling to compare by. Getting the platform's case rule
   backwards can only ever refuse a file the record really names, never admit
   one it does not. SYMLINKS ARE FOLLOWED, deliberately. */
function canonPath(p) {
  const r = resolve(p);
  return process.platform === 'win32' ? r.toLowerCase() : r;
}

/* THE ADDRESS, decoded and shape-checked before the board is asked: closed
   shapes, checked AFTER percent-decoding, so a dot segment, an encoded
   separator, a negative or a float never reaches the board. */
function refAddress(rawId, rawIndex) {
  let id;
  let index;
  try {
    id = decodeURIComponent(rawId);
    index = decodeURIComponent(rawIndex);
  } catch {
    return null;
  }
  /* f/<key>/<n>: a key names one record where a label may name two */
  const key = isKey(id) ? id : '';
  if (!key && !labelShape(id)) return null;
  if (!/^(?:0|[1-9]\d{0,3})$/.test(index)) return null;
  return { id, key, n: Number(index) };
}

const labelShape = (id) => REC_ID.test(id) || CARD_ID.test(id);
const isQuestion = (rec) => /^Q\d+$/.test(String(rec.id || ''));

/* The list position n indexes: a question's evidence, any other kind's refs. */
const pathsOf = (rec) => (isQuestion(rec) ? evidencePaths(rec) : refPaths(rec));

/* THE RECORD AN ADDRESS NAMES, read the one way by every f/ route, the popup's
   files and the recent list: open work off the local board's cache, anything else
   a body read through the board; null for one the board does not know. */
async function recordAt(addr) {
  if (!localBoard) return null;
  const c = localBoard.cache;
  const held = addr.key ? c.tasks.get(addr.key) || c.workstreams.get(addr.key)
    : /^(?:WS|T)-\d+$/.test(addr.id) ? localBoard.record(addr.id) : null;
  let rec = held && (held.kind === 'task' || held.kind === 'workstream') ? held : null;
  if (!rec) {
    const r = await localBoard.body(addr.key || addr.id);
    if (!r) return null;
    /* a handoff comes back as its front, which carries verifyFirst */
    rec = r.kind === 'handoff' && r.front ? { ...r.front, kind: 'handoff', key: r.key, name: r.front.focus } : r;
  }
  const label = String(rec.id || '');
  /* a key naming a kind with no f/ list (a track, a profile) is no record here */
  if (!labelShape(label) || (!addr.key && label !== addr.id)) return null;
  return rec;
}

/* THE resolution, and every f/ route runs exactly this one: a second spelling
   of it would be a second place for the allowlist to be got wrong. One more
   ID SHAPE goes into it rather than a second resolution, for the same reason. */
function resolveAt(rec, n) {
  const paths = pathsOf(rec);
  const spot = lineCut(refPath(paths[n] || ''));
  const named = spot.path;
  if (!named) return null;
  const target = resolve(named);
  /* Belt, and refShape is the brace: a UNC ref is not a path shape there on any
     platform, so neither spelling can arrive here today. If a later change widens
     that shape, this line is what keeps this server off an SMB host. */
  if (/^(?:\\\\|\/\/)/.test(named) || /^(?:\\\\|\/\/)/.test(target)) return null;
  /* Redundant today by construction and kept deliberately: this is the line that
     has to keep passing if a later change ever puts anything between the refs list
     and the open. The set is built from THIS record's own list alone. */
  const allowed = new Set(paths.filter(Boolean).map((p) => canonPath(lineCut(refPath(p)).path)));
  if (!allowed.has(canonPath(target))) return null;
  /* `back` is the surface this id belongs to, and the only thing downstream
     reads off the id shape */
  return {
    rec, index: n, named, line: spot.line, col: spot.col, target: rebasePath(target, placesOf()),
    total: paths.length, back: isQuestion(rec) ? 'q' : 'w',
  };
}

/* This PC's project map and the folders older questions named beside their
   remote: a path named on another machine opens in this PC's checkout of it. */
function placesOf() {
  const here = Object.entries(readMap(dataDir())).map(([repo, dir]) => ({ dir, repo }));
  return here.concat([...localBoard.cache.questions.values()]
    .filter((e) => e && typeof e.projectRepo === 'string' && e.projectRepo && typeof e.projectDir === 'string')
    .map((e) => ({ dir: e.projectDir, repo: e.projectRepo })));
}

/* The file an f/ id and position name, or null; a board this PC cannot read throws. */
async function resolveRef(rawId, rawIndex) {
  const addr = refAddress(rawId, rawIndex);
  if (!addr) return null;
  const rec = await recordAt(addr);
  return rec ? resolveAt(rec, addr.n) : null;
}

/* A failure of the board read itself, as opposed to a fault in this server. */
const boardDown = (e) => e instanceof BoardOffline || e instanceof BoardCallError;

/* The viewer page and the bytes it fetches, on the one resolution above so the
   two can never disagree about which file a URL names. */
function fileRef(res, rawId, rawIndex, raw) {
  return resolveRef(rawId, rawIndex).then(
    (hit) => {
      if (!hit) return notFound(res);
      if (raw) return sendRefBytes(res, hit.target);
      /* the page is metadata only and never stats the file: a ref whose file
         has moved still renders, and the client's own 404 is what turns it
         into the "named here, not found now" block */
      return sendHtml(res, 200, renderRefView({
        assetBase: assetBase(),
        recordId: hit.rec.id,
        recordName: hit.rec.name,
        /* the three halves of the ref, split once above: the page renders the
           path and reads its extension off it, and the line and column are the
           reader's, since nothing is minted client-side */
        ref: hit.named,
        line: hit.line,
        col: hit.col,
        index: hit.index,
        total: hit.total,
        rawUrl: '/' + secret + '/f/' + hit.rec.id + '/' + hit.index + '/raw',
        backUrl: '/' + secret + '/r/' + (hit.rec.key || hit.rec.id),
        cap: MAX_REF_BYTES,
        version: version(),
        /* THE WHOLE OPEN-IN PAYLOAD NOW: one route the row posts a
           KIND to. No template and no program name rides to the page, because
           nothing is minted in the browser. */
        openUrl: '/' + secret + '/f/' + hit.rec.id + '/' + hit.index + '/open',
      }));
    },
    (e) => {
      if (boardDown(e)) {
        /* text on both shapes: an HTML banner sent to the raw shape would reach the
           viewer script as the FILE */
        return refuseRef(res, 503, 'the board could not be read: ' + ((e && e.message) || String(e)));
      }
      appendLog(root, 'file ref failed: ' + ((e && e.stack) || e));
      res.writeHead(500, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end('the file ref could not be resolved\n');
    },
  );
}

/* Bytes, and nothing read out of them: a stat and one byte VALUE decide
   everything here. text/plain for every extension, because guessing a richer
   one would be the server having an opinion about content it never parses. */
function sendRefBytes(res, file) {
  let st;
  try {
    st = statSync(file);
  } catch {
    return notFound(res);
  }
  /* A FOLDER IS NOT A MISSING FILE: a 404 here would make the viewer say the
     file had been deleted, which is never true of a directory.
     The record and the ref are both real, so this is a refusal and not a 404. */
  if (st.isDirectory()) {
    return refuseRef(res, 409, 'this ref names a folder, so there are no bytes to serve');
  }
  if (!st.isFile()) return notFound(res);
  if (st.size > MAX_REF_BYTES) {
    return refuseRef(res, 413, 'this file is larger than the ' + MAX_REF_BYTES + ' byte viewer cap');
  }
  let body;
  try {
    body = readFileSync(file);
  } catch {
    return notFound(res);
  }
  /* the cap again, on what was actually read: a file being appended to between
     the stat and the read would otherwise slip past the first check */
  if (body.length > MAX_REF_BYTES) {
    return refuseRef(res, 413, 'this file is larger than the ' + MAX_REF_BYTES + ' byte viewer cap');
  }
  /* "text only", made a check rather than a hope. The head alone, because a
     text file does not grow a NUL halfway down and reading further would buy
     nothing a reader could act on. */
  if (body.subarray(0, NUL_SNIFF).includes(0)) {
    return refuseRef(res, 415, 'this file carries NUL bytes; the viewer serves text only');
  }
  res.writeHead(200, {
    'Content-Type': 'text/plain; charset=utf-8',
    /* the BYTE count, said out loud, because the viewer page's rich-render cap
       measures bytes and its fallback is the character count of the decoded
       text, which under-reports every multi-byte file */
    'Content-Length': String(body.length),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  res.end(body);
}

/* A refusal that is NOT a 404: the record and the ref are both real and the
   bytes still did not go out. text/plain in every case, because this is what a
   fetch() waiting for file bytes receives. */
function refuseRef(res, code, why) {
  res.writeHead(code, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  res.end(why + '\n');
}

/* ---- open-in: the frame the server writes (spec section 4) ------------- */

/* The body a page may post here, entire: one key, and a value from OPEN_KINDS.
   Neither a path nor a command can be named, because neither is something a page
   is allowed to say (spec section 6). */
function validateOpen(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'body must be a JSON object' };
  for (const key of Object.keys(raw)) {
    /* refused BY NAME for one release, the read-only keys' own idiom: a stale
       page learns what happened rather than being quietly ignored. */
    if (key === 'preset') {
      return { error: 'preset was renamed kind; the kinds are ' + OPEN_KINDS.join(', ') };
    }
    if (key !== 'kind') return { error: 'unknown key: ' + key };
  }
  if (typeof raw.kind !== 'string') return { error: 'kind must be a string' };
  if (!OPEN_KINDS.includes(raw.kind)) {
    return { error: 'kind must be one of ' + OPEN_KINDS.join(', ') };
  }
  return { kind: raw.kind };
}

/* THE KINDS A FOLDER REF WILL NOT TAKE: a folder's open already
   shows it, and its editor already opens the folder. `openwith` answers its own
   sentence from openFrame, the shell having no openas for a folder. */
const FOLDER_REFUSED = Object.freeze(['reveal', 'project']);

/* THE KINDS THAT STAMP: the tray's list and the card's are
   "recent files", so only a FILE ref's own four controls write one, and the
   folder gestures (terminal, claude, project) write nothing on any ref. */
const TOUCH_KINDS = Object.freeze(['open', 'openwith', 'editor', 'reveal']);

/* WHICH PATH EACH KIND ACTS ON. A reveal opens the parent folder (the system folder handler, no selection), and the three folder gestures act on
   the folder itself. A drive root reveals to itself, harmlessly. */
function openTarget(kind, target, isDir) {
  if (kind === 'reveal') return { path: dirname(target), isDir: true };
  if (kind === 'project' || kind === 'terminal' || kind === 'claude') {
    return { path: isDir ? target : dirname(target), isDir: true };
  }
  return { path: target, isDir };
}

/* THE TOUCH STAMP'S SWEEP: keepResolved compares the ANSWER to the stored
   path, so each entry is resolved first and handed back as a target, and a board
   that will not read hands back the stored path, so the sweep drops nothing. */
async function stillNamed() {
  const seen = new Map();
  for (const e of loadRecent(root)) {
    let v;
    try {
      const hit = await resolveRef(e.id, String(e.index));
      v = hit ? hit.target : '';
    } catch {
      v = e.path;
    }
    seen.set(e.id + '/' + e.index, v);
  }
  return (e) => (seen.has(e.id + '/' + e.index) ? seen.get(e.id + '/' + e.index) : e.path);
}

/* POST f/<id>/<n>/open. The order is deliberate: a body this route will not
   take is refused before the board is read, then the file is resolved, then it
   is stat-ed once, and only then is a frame built. */
function fileOpen(req, res, rawId, rawIndex) {
  readBody(req, res, (parsed) => {
    const v = validateOpen(parsed);
    if (v.error) return sendJson(res, 400, { error: v.error });
    return openResolved(res, v.kind, rawId, rawIndex).catch((e) => apiFail(res, e));
  });
}

async function openResolved(res, kind, rawId, rawIndex) {
  let hit;
  try {
    hit = await resolveRef(rawId, rawIndex);
  } catch (e) {
    if (boardDown(e)) return sendJson(res, 503, { error: 'the board could not be read: ' + e.message });
    throw e;
  }
  if (!hit) return notFound(res);
  /* THE ONE STAT, at click time and never at render: the page is metadata
     only, so a stat per ref would be a stat per ref on the whole board. */
  let st = null;
  try { st = statSync(hit.target); } catch { st = null; }
  if (!st || (!st.isFile() && !st.isDirectory())) {
    return sendJson(res, 409, {
      error: 'this was named here, and it is not there now',
    });
  }
  /* A BELT UNDER THE PAGE: a folder's row draws neither control, so
     only a stale page can ask, and the route answers a sentence rather
     than revealing a folder's parent or opening it twice. */
  if (st.isDirectory() && FOLDER_REFUSED.includes(kind)) {
    return sendJson(res, 409, {
      error: 'this ref names a folder, so ' + kind + ' is not offered on it',
    });
  }
  const spot = openTarget(kind, hit.target, st.isDirectory());
  const built = openFrame(
    kind,
    { path: spot.path, line: hit.line, col: hit.col },
    spot.isDir,
    loadSettings(root),
    process.platform,
  );
  /* the user's own template is missing or unusable, or the kind does not
     fit what is there: the record and the ref are both real, so this is a
     409 in the api's own register rather than a 404 */
  if (built.error) return sendJson(res, 409, { error: built.error });
  const sent = await pushOpen(built);
  if (sent !== true) return sendJson(res, 503, { error: sent.reason });
  /* 200 means the frame was WRITTEN to the tray and nothing more, the
     same promise the spawn's 200 made about a dispatched process. */
  /* a FILE's four controls alone: a folder ref writes nothing, so
     the recent lists carry files by construction */
  if (!st.isDirectory() && TOUCH_KINDS.includes(kind)) {
    try {
      noteOpen(root, {
        id: hit.rec.id,
        index: hit.index,
        path: hit.target,
        kind,
        at: stampNow(notifyNow()),
      }, await stillNamed());
    } catch (e) {
      appendLog(root, 'board recent opens: ' + ((e && e.message) || e));
    }
  }
  kickTick();
  return sendJson(res, 200, { ok: true });
}

/* THE ASSET VALIDATOR CACHE: one entry per asset per server lifetime,
   and a file whose mtime or size has moved is hashed again on the next request.
   The hash is over the bytes actually sent, so it is a STRONG tag. */
const assetTags = new Map();

function assetTag(name, body, st) {
  /* A FILE WHOSE STAMP CANNOT BE READ IS HASHED EVERY TIME, and remembers
     nothing: a held entry keyed on an unknown stamp would answer for a file
     that had moved underneath it. */
  const stamp = st ? String(st.mtimeMs) + '|' + String(st.size) : null;
  const held = stamp === null ? null : assetTags.get(name);
  if (held && held.stamp === stamp) return held.tag;
  const tag = '"' + createHash('sha256').update(body).digest('hex').slice(0, 16) + '"';
  if (stamp !== null) assetTags.set(name, { stamp, tag });
  return tag;
}

/* Read per request rather than cached: the house sheet may be edited under a
   running server and a loopback refetch costs nothing. It carries a VALIDATOR
   too, since `no-cache` alone gives the browser nothing to revalidate with. */
function sendAsset(req, res, name) {
  const type = ASSETS[name];
  if (!type) return notFound(res);
  const file = join(pluginRoot, 'assets', name);
  let body;
  let st = null;
  try {
    body = readFileSync(file);
    try { st = statSync(file); } catch { st = null; }
  } catch {
    return notFound(res);
  }
  const tag = assetTag(name, body, st);
  const headers = {
    'Content-Type': type,
    'Cache-Control': 'no-cache',
    ETag: tag,
    'X-Content-Type-Options': 'nosniff',
  };
  if (st) headers['Last-Modified'] = new Date(st.mtimeMs).toUTCString();
  const asked = String((req && req.headers && req.headers['if-none-match']) || '');
  if (asked && asked.split(',').some((t) => t.trim() === tag)) {
    res.writeHead(304, headers);
    return res.end();
  }
  res.writeHead(200, headers);
  res.end(body);
}

/* ---- the answer-bar api ------------------------------------------------ */

/* The body posture, in ONE place because every POST here keeps it: refuse
   anything over the cap before it is parsed, answering once behind a latch,
   then parse or refuse. The viewer's open route rides this too. */
function readBody(req, res, done) {
  let body = '';
  let dead = false;
  req.setEncoding('utf8');
  req.on('data', (chunk) => {
    if (dead) return;
    body += chunk;
    if (body.length > MAX_BODY) {
      dead = true;
      sendJson(res, 400, { error: 'body too large' });
      req.destroy();
    }
  });
  req.on('end', () => {
    if (dead) return;
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      return sendJson(res, 400, { error: 'body is not JSON' });
    }
    return done(parsed);
  });
}

/* THE RELAY ROUTE: this server's work half raises a work-ending alert
   through the work notifier, which posts it here with the gates applied, and
   the tray stream writes it out. A request with no title is refused as a shape error. */
function relayApi(req, res) {
  readBody(req, res, (parsed) => {
    const alert = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed.alert : null;
    if (!alert || typeof alert !== 'object' || Array.isArray(alert)) {
      return sendJson(res, 400, { error: 'alert is required' });
    }
    if (!String(alert.title || '').trim()) return sendJson(res, 400, { error: 'the alert carried no title' });
    return pushAlert(alert).then((sent) => {
      /* the refusal's own reason rides the body, so the notifier's one dropped
         line says why (the person chose Exit, no tray, no popup) */
      if (sent !== true) {
        return sendJson(res, 503, { error: (sent && sent.reason) || 'no tray attached' });
      }
      res.writeHead(204, {
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      return res.end();
    }, (e) => apiFail(res, e));
  });
}

/* THE ALERT ROUTE: the notify gates, then the popup. tray/README.md pins
   the request shape. */
function alertApi(req, res) {
  readBody(req, res, (parsed) => {
    const v = validateAlert(parsed);
    if (v.error) return sendJson(res, 400, { error: v.error });
    const base = boardBase();
    const card = alertCard(v.value.card, base);
    if (!card) return sendJson(res, 400, { error: 'card must be a record id or a URL on this board' });
    const askFiles = v.value.files === true || v.value.files.length > 0;
    if (askFiles && !card.id) return sendJson(res, 400, { error: 'files need a card that names a record' });
    const settings = loadSettings(root);
    const held = alertGate(settings, notifyNow(), v.value.kind);
    if (held) return sendJson(res, 200, { ok: true, via: 'held', reason: held });
    return alertFiles(card.id, v.value.files)
      .then((files) => {
        const frame = alertFrame(v.value, { base, settings, card, files });
        return relayTray(frame).then((via) => {
          if (typeof via !== 'string') return sendJson(res, 503, { error: via.reason || 'no tray attached' });
          return sendJson(res, 200, { ok: true, via, files: files.length });
        });
      })
      .catch((e) => apiFail(res, e));
  });
}

/* ---- the notifications page -------------------------------------- */

/* a house page off the shell's own head and theme, with its styles and its
   script inline, so nothing here joins the asset
   register. It reads no store and no settings. */
function notifyPage(res) {
  return sendHtml(res, 200, renderNotify({
    assetBase: assetBase(),
    boardBase: '/' + secret + '/',
    getUrl: '/' + secret + '/api/notify',
    postUrl: '/' + secret + '/api/notify',
    testUrl: '/' + secret + '/api/notify/test',
    version: version(),
  }));
}

/* ---- the Add a PC page ------------------------------------------ */

function addPcPage(res) {
  return sendHtml(res, 200, renderAddPc({
    assetBase: assetBase(),
    boardBase: '/' + secret + '/',
    mintUrl: '/' + secret + '/api/join-code',
    version: version(),
  }));
}

/* The code is minted here with this PC's token, never by the page; the answer
   carries the words the page shows, the expiry in this PC's local time. */
function joinCodeApi(res) {
  const url = boardServerUrl();
  if (!/^https?:/i.test(url)) {
    return sendJson(res, 409, { error: 'this PC is not on a board, so it has no join code to give: mint one on a PC that is' });
  }
  if (hostedHere(root, url)) return sendJson(res, 409, { error: HOST_ONLY });
  return boardJoinCode(undefined, { url, token: boardToken() }).then((r) => sendJson(res, 200, {
    code: r.code,
    expires: r.expires,
    until: atWords(r.expires, Date.now()),
    board: reachableUrl(url),
    line: joinLine(reachableUrl(url), r),
  }), (e) => sendJson(res, e && e.status >= 400 && e.status < 500 ? e.status : 502, { error: (e && e.message) || String(e) }));
}

/* WHAT A PAGE MAY EVER SEE OF notify.json, a WHITELIST so a key added to the file
   later is invisible here until somebody decides otherwise. THE EDITOR TEMPLATE
   RIDES: the SERVER NEVER RUNS IT, the exe does, off a frame. */
function notifyView(s) {
  return {
    enabled: s.enabled,
    tray: s.tray,
    quietFrom: s.quietFrom,
    quietTo: s.quietTo,
    categories: s.categories,
    editor: s.editor,
    /* THE PAUSE, both halves: the label is built here rather than in the
       page, so the page and the menu can never be two vocabularies for one state. */
    pausedUntil: s.pausedUntil,
    pauseLabel: pauseLabel(notifyNow(), s.pausedUntil),
  };
}

function notifyGet(res) {
  return sendJson(res, 200, notifyView(loadSettings(root)));
}

/* THE KEY A PAGE IS REFUSED BY NAME, rather than ignored: a stale page learns
   what happened instead of quietly writing nothing. */
const NOTIFY_NEVER = Object.freeze([
  /* a stamp a client computed is a clock the server cannot check, so the
     VALUE is refused by name and the VERB below is the only way to a pause. */
  'pausedUntil',
]);

const HHMM = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

/* Validate WHOLE, then merge and write: a body that is not exactly this shape
   is refused rather than coerced, and nothing is written on the way to the
   refusal. Every refusal names its reason, and an unknown key names itself. */
function validateNotify(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: 'body must be a JSON object' };
  }
  const patch = {};
  for (const key of Object.keys(raw)) {
    if (NOTIFY_NEVER.includes(key)) {
      return { error: key + ' is read by the server and is never written from a page' };
    }
    if (key === 'enabled' || key === 'tray') {
      if (typeof raw[key] !== 'boolean') return { error: key + ' must be true or false' };
      patch[key] = raw[key];
    } else if (key === 'quietFrom' || key === 'quietTo') {
      if (typeof raw[key] !== 'string' || (raw[key] !== '' && !HHMM.test(raw[key]))) {
        return { error: key + ' must be empty or HH:MM' };
      }
      patch[key] = raw[key];
    } else if (key === 'pause') {
      /* THE VERB, the one key here whose value is not what lands on disk: the
         server resolves it off its own clock. `{ pause: '' }` is RESUME and has to
         leave a non-empty patch, or the empty-patch refusal unclicks Resume. */
      if (typeof raw.pause !== 'string' || !PAUSE_TOKENS.includes(raw.pause)) {
        return { error: 'pause must be one of ' + PAUSE_TOKENS.map((t) => (t === '' ? "''" : t)).join(', ') };
      }
      patch.pausedUntil = pauseUntil(notifyNow(), raw.pause);
    } else if (key === 'categories') {
      const map = raw.categories;
      if (!map || typeof map !== 'object' || Array.isArray(map)) {
        return { error: 'categories must be an object' };
      }
      const cats = {};
      for (const cat of Object.keys(map)) {
        if (!CATEGORY_KEYS.includes(cat)) return { error: 'unknown category: ' + cat };
        const row = map[cat];
        if (!row || typeof row !== 'object' || Array.isArray(row)) {
          return { error: 'categories.' + cat + ' must be an object' };
        }
        const out = {};
        for (const field of Object.keys(row)) {
          if (field === 'show') {
            if (typeof row.show !== 'boolean') {
              return { error: 'categories.' + cat + '.show must be true or false' };
            }
            out.show = row.show;
          } else if (field === 'sound') {
            if (row.sound !== 'silent' && !SOUNDS.includes(row.sound)) {
              return { error: 'categories.' + cat + '.sound is not a sound this build knows' };
            }
            out.sound = row.sound;
          } else {
            return { error: 'unknown key: categories.' + cat + '.' + field };
          }
        }
        cats[cat] = out;
      }
      patch.categories = cats;
    } else if (key === 'editor') {
      /* two templates and no third key, each a string this file will
         hold. The exe runs it, so the length is the only other thing to say. */
      const map = raw.editor;
      if (!map || typeof map !== 'object' || Array.isArray(map)) {
        return { error: 'editor must be an object' };
      }
      const ed = {};
      for (const field of Object.keys(map)) {
        if (!EDITOR_KEYS.includes(field)) return { error: 'unknown key: editor.' + field };
        if (typeof map[field] !== 'string') {
          return { error: 'editor.' + field + ' must be a string' };
        }
        if (map[field].length > EDITOR_MAX) {
          return { error: 'editor.' + field + ' must be at most ' + EDITOR_MAX + ' characters' };
        }
        /* the frame builder's own refusal, at the write: the click-time
           gate stays as the belt, and this is the courtesy */
        const bad = checkTemplate(map[field]);
        if (bad) return { error: bad };
        ed[field] = map[field];
      }
      patch.editor = ed;
    } else {
      return { error: 'unknown key: ' + key };
    }
  }
  if (!Object.keys(patch).length) return { error: 'nothing to write' };
  return { patch };
}

/* THE SETTINGS WRITE, the view route's own posture over the server's OWN
   board/notify.json: the patch goes over the FILE's parsed contents, so a key a
   person hand-added survives. No push is needed; every reader re-reads it. */
function notifyApi(req, res) {
  readBody(req, res, (parsed) => {
    const v = validateNotify(parsed);
    if (v.error) return sendJson(res, 400, { error: v.error });
    try {
      const settings = saveSettings(root, v.patch,
        () => appendLog(root, 'board notify: the settings file was malformed; it was replaced'));
      /* THE IDIOM EVERY WRITING API ROUTE KEEPS: the tick goes on the next turn
         rather than at the watcher's next period, which is what puts a pause on the
         tray menu and on every open page in the same breath as the click. */
      kickTick();
      return sendJson(res, 200, { ok: true, settings: notifyView(settings) });
    } catch (e) {
      appendLog(root, 'board notify failed: ' + ((e && e.message) || e));
      return sendJson(res, 500, { error: 'the notification setting could not be written' });
    }
  });
}

/* THE TEST BUTTON AND THE PLAY ARROW: the row's sound comes INLINE, because
   what it tests is what is on screen rather than what is on disk. */
function notifyTest(req, res) {
  readBody(req, res, (parsed) => {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return sendJson(res, 400, { error: 'a category or a sound is required' });
    }
    for (const key of Object.keys(parsed)) {
      if (key !== 'category' && key !== 'sound') {
        return sendJson(res, 400, { error: 'unknown key: ' + key });
      }
    }
    const has = (k) => Object.prototype.hasOwnProperty.call(parsed, k);
    /* the sound is what BOTH shapes are about, so it is required in both */
    if (!has('sound')) return sendJson(res, 400, { error: 'a sound is required' });
    if (parsed.sound !== 'silent' && !SOUNDS.includes(parsed.sound)) {
      return sendJson(res, 400, { error: 'sound is not a sound this build knows' });
    }
    if (has('category') && !CATEGORY_KEYS.includes(parsed.category)) {
      return sendJson(res, 400, { error: 'unknown category: ' + parsed.category });
    }
    if (!notifier || !notifier.available) {
      return sendJson(res, 503, { error: 'the notification channel is off on this platform' });
    }
    /* the row's card through its production builder; the play arrow's card
       names the sound and nothing else */
    const shape = has('category') ? sampleShape(parsed.category) : null;
    const alert = shape
      ? sampleAlert(shape, parsed.sound)
      : { kind: 'info', title: 'AskerDo', where: parsed.sound, blocking: false, sound: parsed.sound };
    const started = Date.now();
    return notifier.show(alert).then((path) => {
      /* a press that drew nothing says why on the page's error line */
      if (path === 'none') return sendJson(res, 503, { error: 'no tray with the popup took the alert' });
      return sendJson(res, 200, { ok: true, path, raised: 1, ms: Date.now() - started });
    }, (e) => apiFail(res, e));
  });
}

/* The board's own refusal keeps its status (a 4xx is about the request or the
   record, a 503 is the board offline); anything else is a fault in this server. */
function apiFail(res, e) {
  const msg = (e && e.message) || String(e);
  if (e instanceof BoardOffline) return sendJson(res, 503, { error: msg });
  if (e instanceof BoardCallError && e.status >= 400 && e.status < 500) return sendJson(res, e.status, { error: msg });
  appendLog(root, 'board api failed: ' + ((e && e.stack) || e));
  return sendJson(res, 500, { error: msg });
}

function notFound(res) {
  res.writeHead(404, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end('not found\n');
}

/* ---- what goes on the wire --------------------------------------------- */

function sendJson(res, code, body) {
  return sendJsonText(res, code, JSON.stringify(body) + '\n');
}

/* the same answer from a string that is already serialized */
function sendJsonText(res, code, text) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(text);
}

/* Referrer-Policy is not decoration here: the whole credential is the URL path,
   so Referer is the one channel that can hand it to a third party. The page's
   own rel="noreferrer" is per-link; this is structural. */
function sendHtml(res, code, html) {
  res.writeHead(code, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  res.end(html);
}

/* `log: false` for a store being deleted: a line there would land in a folder half gone */
function shutdown(why, { log = true } = {}) {
  stopping = true;
  if (watchTimer) clearInterval(watchTimer);
  if (configTimer) clearInterval(configTimer);
  if (localBoard) localBoard.stop();
  if (hostBoard) hostBoard.stop();
  /* only this server's file: a replacement may already have written its own */
  try { if (JSON.parse(readFileSync(localFile(), 'utf8')).pid === process.pid) rmSync(localFile(), { force: true }); } catch {}
  /* BEFORE THE STREAMS CLOSE, on every path that routes here: the tray is this
     server's child, and the native one is asked through the stdin EOF that makes
     it remove its icon rather than through the closing of the stream it reads. */
  if (tray) tray.stop();
  /* no stream outlives a --root: they are ended here as well as on the stop
     route, because SIGINT and SIGTERM reach this without going through it */
  endStreams();
  if (log) appendLog(root, 'board: shutting down (' + why + ')');
  if (server.closeAllConnections) server.closeAllConnections();
  server.close(() => process.exit(0));
  /* a socket that somehow outlives close() must not keep this alive */
  setTimeout(() => process.exit(0), 500).unref();
}
