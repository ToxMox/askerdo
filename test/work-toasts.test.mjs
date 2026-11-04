/* The TRAY channel's work half (spec section 8): the local board hands each
 * session-authored ending to createWorkNotifier (the polarity is local-board.test's),
 * and this file checks what the notifier does with it. Nothing here raises a real alert. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { DEFAULTS, WORK_ENDINGS, createNotifier, createWorkNotifier } from '../lib/notify.mjs';
import { pluginRoot } from '../lib/node-helpers.mjs';
import { tempDir } from './helpers/sandbox.mjs';

function fakeLog() {
  const lines = [];
  const fn = (line) => lines.push(line);
  fn.lines = lines;
  return fn;
}

const settings = (root, cfg) => {
  mkdirSync(join(root, 'board'), { recursive: true });
  writeFileSync(join(root, 'board', 'notify.json'),
    (typeof cfg === 'string' ? cfg : JSON.stringify(cfg)) + '\n');
};

const SECRET = 'a1b2c3d4'.repeat(4);

/* Every root starts with the channel OFF, so a case that never says otherwise
   can raise nothing. */
function freshRoot(prefix = 'askerdo-toasts-') {
  const root = join(tempDir(prefix), 'askerdo');
  settings(root, { enabled: false });
  return root;
}

const channelOn = (root) => settings(root, DEFAULTS);

/* AN AVAILABLE CHANNEL AND THE BOARD IT RELAYS TO on any platform: win32 is
 * injected and the notifier pointed at a fake board. THE ENSURE IS A FAKE, or a
 * refused relay would start a real board per sandbox. `raise` is the local
 * server's call (hooks/board-server.mjs localAlerts). */
async function quietPort() {
  for (;;) {
    const p = 20000 + Math.floor(Math.random() * 12000);
    const free = await new Promise((resolve) => {
      const s = createServer();
      s.once('error', () => resolve(false));
      s.listen(p, '127.0.0.1', () => s.close(() => resolve(true)));
    });
    if (free) return p;
  }
}

async function channel(root, over = {}) {
  const log = over.log || fakeLog();
  const pending = [];
  const ensured = [];
  const posted = [];
  const state = { code: over.code === undefined ? 204 : over.code };
  const srv = createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      posted.push({ method: req.method, url: req.url, body });
      res.writeHead(state.code);
      res.end();
    });
  });
  /* THE PORT IS CLAIMED FIRST AND LISTENED ON SECOND, so a case that needs a
     port with nothing on it yet (the refused relay, and the ensure behind it)
     can hold the address and put the board there when the ensure runs. It sits
     below the ephemeral ranges, so another file's listen(0) cannot take it meanwhile. */
  const port = await quietPort();
  const listen = () => new Promise((resolve) => {
    srv.listen(port, '127.0.0.1', () => {
      srv.unref();
      resolve(true);
    });
  });
  if (over.listen !== false) await listen();
  const notify = {
    log,
    platform: over.platform || 'win32',
    ensure: over.ensure || ((dir) => { ensured.push(dir); }),
    ping: over.ping || (() => false),
    ensureWaitMs: 1,
    ensureStepMs: 1,
    relayMs: over.relayMs,
    settled: (p) => pending.push(p),
  };
  const raise = (ev) => createWorkNotifier({ root, port, secret: SECRET, ...notify }).raise(ev);
  const settle = async () => {
    while (pending.length) await pending.shift();
  };
  return { notify, raise, log, settle, posted, ensured, state, port, listen };
}

/* The board root URL the notifier was handed, in the loopback form. */
const boardBase = (port) => 'http://127.0.0.1:' + port + '/' + SECRET + '/';

/* The alert that landed on the fake board, the one field the relay route carries. */
function alertOf(hit) {
  const sent = JSON.parse(hit.body);
  assert.deepEqual(Object.keys(sent), ['alert'], 'the relay body is the alert alone');
  assert.equal(sent.alert.blocking, false, 'a work ending never blocks');
  assert.equal(sent.alert.files, true);
  return sent.alert;
}

const cards = (posted) => posted.map((hit) => alertOf(hit).card);

/* The events the local board hands over (lib/local-board.mjs deliver). */
const TASK = { id: 'T-1', name: 'counter rebuild', workstream: 'WS-1' };
const WS = { id: 'WS-1', name: 'work system build' };
const done = (over = {}) => ({ ...TASK, ending: 'completed', ...over });
const closed = (over = {}) => ({ ...WS, ending: 'closed', ...over });

/* ---- the card ---------------------------------------------------------- */

test('the card names the ended record, its ending and its workstream, with the row sound', async () => {
  const root = freshRoot();
  channelOn(root);
  const { raise, posted, settle } = await channel(root);
  raise({ id: 'T-2', name: 'unscoped', ending: 'dropped' });
  raise(done({ workstreamName: 'work system build' }));
  raise(closed({ outcome: 'completed' }));
  await settle();

  const sent = posted.map(alertOf);
  /* the record's own card: a click lands on the thing that ended */
  assert.deepEqual(sent.map((a) => a.card), ['T-2', 'T-1', 'WS-1']);
  assert.deepEqual(sent.map((a) => a.kind), ['dropped', 'done', 'closed']);
  assert.ok(sent[1].title.includes('counter rebuild'), sent[1].title);
  assert.ok(sent[2].title.includes('completed'), 'a close carries its outcome');
  /* the workstream rides the where line; a record without one loses the clause,
     and a workstream's own close names no workstream: it IS one */
  assert.ok(!sent[0].where.includes('WS-'), sent[0].where);
  assert.ok(sent[1].where.includes('WS-1'), sent[1].where);
  assert.ok(sent.every((a) => a.sound === 'Default'));
});

test('a silent row silences the card without changing anything else', async () => {
  const root = freshRoot();
  const { raise, posted, settle } = await channel(root);
  /* a key the file never names still merges over the defaults, so the channel
     is on here; a close is the `plan-closed` row whatever the id's prefix */
  settings(root, { enabled: true, categories: { 'plan-closed': { sound: 'silent' } } });

  raise(closed());
  await settle();
  const alert = alertOf(posted[0]);
  assert.equal(alert.sound, 'silent');
  assert.equal(alert.card, 'WS-1');
});

/* THE LEGACY BOOLEAN STILL MEANS WHAT IT MEANT: a notify.json written
   before the rows existed seeds the map on read. */
test('the superseded sound boolean still silences every work card, seeded once on read', async () => {
  const root = freshRoot();
  const { raise, posted, settle } = await channel(root);
  settings(root, { enabled: true, woken: true, closed: true, sound: false, tray: true });

  raise(done());
  await settle();
  assert.equal(posted.length, 1, 'the card still goes up: the boolean was about the SOUND');
  assert.equal(alertOf(posted[0]).sound, 'silent');
});

/* THE ROW'S OWN SHOW, in the gate order the question half keeps: after the
   master switch, after the quiet hours, before the card is built. */
test('a work row switched off drops its own ending and no other', async () => {
  const root = freshRoot();
  const { raise, posted, settle } = await channel(root);
  settings(root, { enabled: true, categories: { 'task-completed': { show: false } } });

  assert.equal(raise(done()), 0);
  await settle();
  assert.equal(posted.length, 0, 'the row said no before the card was built');

  raise(closed());
  await settle();
  assert.deepEqual(cards(posted), ['WS-1'], 'the row beside it is untouched');
});

test('the channel master gate silences the work half too', async () => {
  const root = freshRoot();
  const { raise, posted } = await channel(root);
  /* said out loud rather than left to the default, since the switch IS what
     this case is about */
  settings(root, { ...DEFAULTS, enabled: false });

  raise(done());
  raise(closed());
  assert.equal(posted.length, 0, 'one switch turns the whole channel off');
});

/* THE PAUSE GATES THE WORK HALF TOO, on one gate order honoured by both halves. */
test('a pause silences the work half, and a resume lets it through again', async () => {
  const root = freshRoot();
  const { raise, posted, settle } = await channel(root);
  settings(root, { ...DEFAULTS, pausedUntil: 'until-resume' });

  raise(done());
  raise(closed());
  await settle();
  assert.equal(posted.length, 0, 'a pause is the whole channel, both halves of it');

  /* the settings are re-read per raise, so a resume takes effect at the next
     ending with nothing to restart */
  settings(root, { ...DEFAULTS, pausedUntil: '' });
  raise(closed());
  await settle();
  assert.equal(posted.length, 1);

  /* a LAPSED stamp does not gate either: it simply stops suppressing */
  settings(root, { ...DEFAULTS, pausedUntil: '2020-01-01T00:00:00+00:00' });
  raise(done({ id: 'T-2', name: 'a second task' }));
  await settle();
  assert.equal(posted.length, 2, 'a stamp in the past is off');
});

/* ---- the relay seam and its fail-open posture -------------------------- */

test('the relay is the whole seam: one POST, no process, and the raise never waits', async () => {
  const root = freshRoot();
  channelOn(root);
  const { raise, posted, log, settle, ensured } = await channel(root);
  assert.equal(raise(closed()), 1, 'one alert on its way, answered before the round trip');
  await settle();

  assert.equal(posted.length, 1);
  assert.equal(posted[0].method, 'POST');
  assert.equal(posted[0].url, '/' + SECRET + '/api/relay', 'secret-prefixed like every api route');
  assert.deepEqual(ensured, [], 'a board that answered is not a board worth starting');
  assert.equal(log.lines.length, 1);
  assert.ok(log.lines[0].includes('WS-1'), log.lines[0]);

  /* THE SURFACE THIS HALF HAS LEFT: no spawner, no shell path, and no
     exe of its own. The board server owns the exe; this half owns one POST. */
  const w = createWorkNotifier({ root, port: 1, secret: SECRET, platform: 'win32' });
  assert.deepEqual(Object.keys(w).sort(), ['available', 'raise']);
  const src = readFileSync(join(pluginRoot, 'lib', 'notify.mjs'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/child_process|spawn/i.test(code), 'the work half can still start a process');
});

test('a board that answers 503 costs the alert one line, and nothing else', async () => {
  const root = freshRoot();
  channelOn(root);
  const { raise, posted, log, settle, ensured } = await channel(root, { code: 503 });

  assert.doesNotThrow(() => raise(done()));
  assert.doesNotThrow(() => raise(closed({ outcome: 'completed' })));
  await settle();
  assert.equal(posted.length, 2, 'both were offered');
  /* one dropped line each, and an alert that never went is not reported as one */
  assert.equal(log.lines.length, 2, log.lines.join(' | '));
  assert.ok(log.lines[0].includes('T-1') && log.lines[0].includes('dropped'), log.lines[0]);
  assert.ok(log.lines[1].includes('WS-1') && log.lines[1].includes('dropped'), log.lines[1]);
  assert.deepEqual(ensured, [], 'a 503 is an answer: the board is up');
});

/* A refused connection is nothing listening on the board's port, the one answer with
   a next step, so the raise runs the SessionStart ensure and relays once more. */
test('a refused relay runs the ensure once, and relays again when the board answers', async () => {
  const root = freshRoot();
  channelOn(root);
  const { notify, raise, posted, log, settle, ensured, listen } = await channel(root, { listen: false });
  let asked = 0;
  let up = false;
  notify.ensure = (dir) => {
    ensured.push(dir);
    /* the stand-in for a detached board coming up on the port: production
       spawns one, this listens. NOT awaited, exactly as the real ensure is not. */
    return listen().then(() => { up = true; });
  };
  notify.ping = () => { asked += 1; return up; };
  notify.ensureWaitMs = 200;
  notify.ensureStepMs = 1;

  raise(closed());
  await settle();

  assert.deepEqual(ensured, [root], 'the ensure is handed the root, once');
  assert.ok(asked >= 1, 'and the ping is what says the board is up');
  assert.deepEqual(cards(posted), ['WS-1'], 'the alert landed on the far side of the ensure');
  assert.equal(log.lines.length, 1);
  assert.ok(!log.lines[0].includes('dropped'), log.lines[0]);
});

test('a refused relay whose ensure brings nothing up is one line and a dropped alert', async () => {
  const root = freshRoot();
  channelOn(root);
  const { raise, posted, log, settle, ensured } = await channel(root, { listen: false });

  raise(closed());
  await settle();
  assert.equal(posted.length, 0, 'nothing was listening for it');
  assert.deepEqual(ensured, [root], 'the ensure was tried exactly once');
  assert.equal(log.lines.length, 1);
  assert.ok(log.lines[0].includes('WS-1') && log.lines[0].includes('no board server answered'), log.lines[0]);
});

test('a malformed settings file falls back to the defaults and still raises', async () => {
  const root = freshRoot();
  const { raise, posted, log, settle } = await channel(root);
  settings(root, 'not json at all');

  raise(closed());
  await settle();
  /* a file that will not parse is NOT a silencer: the defaults have the channel on */
  assert.equal(posted.length, 1, 'only a deliberate enabled false silences the channel');
  assert.ok(log.lines.includes('notify: settings file is malformed; using defaults'));
});

test('a platform without the channel is inert, and says nothing at all', async () => {
  const root = freshRoot();
  channelOn(root);
  const { raise, posted, log } = await channel(root, { platform: 'linux' });
  raise(done({ ending: 'dropped' }));
  raise(closed());
  assert.equal(posted.length, 0, 'nothing is ever offered off Windows');
  /* and SILENTLY: one line per ending forever is the noise logOnce exists to prevent */
  assert.deepEqual(log.lines, []);
});

/* ---- the two halves stay separate -------------------------------------- */

test('the question gate and the work gate never accept each other ids', async () => {
  const root = await freshRoot();
  channelOn(root);
  const qseen = [];
  const qlog = fakeLog();
  const n = createNotifier({
    root, port: 4321, secret: 'a1b2c3d4'.repeat(4), instance: 'inst01',
    platform: 'win32', pushAlert: (alert) => { qseen.push(alert); return true; }, log: qlog,
  });
  assert.equal(await n.raise([{ kind: 'open', id: 'T-1', name: 'counter rebuild', blocking: false }], DEFAULTS), 0);
  assert.equal(qseen.length, 0, 'a work id may not ride the question path');
  assert.ok(qlog.lines.includes('notify: dropped an event whose id was not well formed'));

  const wlog = fakeLog();
  const w = createWorkNotifier({
    root, port: 4321, secret: 'a1b2c3d4'.repeat(4), platform: 'win32', log: wlog,
    ensure: () => {}, ping: () => false, ensureWaitMs: 1, ensureStepMs: 1,
  });
  assert.equal(w.raise({ id: 'Q7', name: 'store shape', ending: 'closed' }), 0);
  assert.equal(w.raise({ id: 'T-1/../board/secret', name: 'traversal', ending: 'completed' }), 0);
  assert.equal(w.raise({ id: '', name: 'empty', ending: 'completed' }), 0);
  /* an ending outside the vocabulary is refused the same way, so no verb can
     invent a fourth one by passing a string through */
  assert.equal(w.raise({ id: 'T-1', name: 'counter rebuild', ending: 'in_progress' }), 0);
  assert.deepEqual(new Set(wlog.lines), new Set(['notify: dropped a work event that was not well formed']));
  assert.deepEqual([...WORK_ENDINGS], ['completed', 'dropped', 'closed']);
});
