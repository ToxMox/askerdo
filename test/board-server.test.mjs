/* Posture, lifetime and ensure tests for the AskerDo board server.
   Every case runs against a throwaway --root with identity written by hand, so
   no test ever touches the real store or squats the shipped default port. */
import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import {
  appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs';
/* aliased: `resolve` is already a promise settler in more than one closure
   below, and one name meaning two things in one file reads badly */
import { dirname, join, resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer, request as httpRequest } from 'node:http';
import { hostname } from 'node:os';
import { LEGACY_TASK_NAME, ensureBoardServer, isLiveRoot, whoamiCommand } from '../lib/board-ensure.mjs';
import { TASK_NAME, parseAction, taskXml, wantedAction } from '../lib/board-task.mjs';
import { pluginRoot, pluginVersion, storeRoot } from '../lib/node-helpers.mjs';
import { ASSETS } from '../lib/board-assets.mjs';
import { sampleAlert, sampleShape } from '../lib/notify-page.mjs';
import {
  CATEGORY_KEYS, SOUNDS,
} from '../lib/notify.mjs';
import { NOTIFY_ROWS } from '../lib/notify-page.mjs';
/* the frame builder's own list and its own encoder: a case that spelled either
   again would be pinning its own arithmetic rather than the server's */
import { OPEN_KINDS, enc } from '../lib/open-in.mjs';
import { boardJoin, boardRequest, startBoard } from '../lib/board-call.mjs';
import { childEnv, tempDir } from './helpers/sandbox.mjs';
import { slicer } from './helpers/shard.mjs';
import { FULL_STAMP, stampFor } from './helpers/stamps.mjs';

/* run as four files: this file takes cases 1, 5, 9 and on, and
   board-server-2 to -4 the rest, so the server starts are spread across processes */
const mine = slicer(4);
const test = (...args) => (mine() ? nodeTest(...args) : undefined);

const boardScript = join(pluginRoot, 'hooks', 'board-server.mjs');
const cli = join(pluginRoot, 'bin', 'askerdo.mjs');
const version = pluginVersion();

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer(() => {});
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/* The notification channel, off in every sandbox: a server never overwrites an
   existing settings file, so this is how a suite run on a Windows desktop stays
   free of real alerts and real tray processes. */
const CHANNEL_OFF = JSON.stringify({
  enabled: false, woken: false, closed: false, sound: false, tray: false,
});

/* The identity the store would have minted, written directly, into a home that
   already exists: only the no-flag fallback case needs a SECOND store under the
   one home, and `slug` is which of the two roots it lands in. */
async function seedStore(home, slug) {
  const root = join(home, '.claude', slug);
  const secret = randomBytes(16).toString('hex');
  const port = await freePort();
  mkdirSync(join(root, 'board'), { recursive: true });
  writeFileSync(join(root, 'board', 'secret'), secret + '\n');
  writeFileSync(join(root, 'board', 'port'), String(port) + '\n');
  writeFileSync(join(root, 'board', 'notify.json'), CHANNEL_OFF + '\n');
  return { home, root, secret, port, base: 'http://127.0.0.1:' + port + '/' + secret };
}

/* Tests hand the server a root, and only the fallback case hands it a home. The root
   sits under a throwaway home because the server refuses a root outside ~/.claude. */
async function mint(prefix = 'nd-board-', slug = 'askerdo') {
  return seedStore(tempDir(prefix), slug);
}

/* `script` is the tree seam: the manifest-bump case runs a COPY of the server so
   the manifest it resolves can be edited without touching the repo's own */
/* `args` is the flag seam: the one case that passes anything else passes
   nothing, because argRoot's no-flag fallback is what it proves. */
function start(t, sb, env = {}, nodeArgs = [], script = boardScript, args = ['--root', sb.root]) {
  const proc = spawn(process.execPath, [...nodeArgs, script, ...args], {
    env: { ...childEnv(), ...env },
    /* named rather than inherited, so a case about a RELATIVE ref can say what that
       ref would have resolved against: the repo root */
    cwd: pluginRoot,
  });
  let out = '';
  let err = '';
  proc.stdout.setEncoding('utf8');
  proc.stderr.setEncoding('utf8');
  proc.stdout.on('data', (d) => { out += d; });
  proc.stderr.on('data', (d) => { err += d; });
  const closed = new Promise((resolve) => proc.on('close', (code) => resolve(code)));
  const line = new Promise((resolve, reject) => {
    proc.on('error', reject);
    proc.stdout.on('data', () => {
      const nl = out.indexOf('\n');
      if (nl > 0) resolve(out.slice(0, nl));
    });
    proc.on('close', () => resolve(out.split('\n')[0]));
  });
  t.after(async () => {
    try { await fetch(sb.base + '/stop', { method: 'POST' }); } catch {}
    try { proc.kill(); } catch {}
  });
  return { proc, closed, line, stdout: () => out, stderr: () => err };
}

/* fetch refuses to set Host and normalizes the path, so posture cases that
   need either go out over a raw request. */
function raw(port, path, { method = 'GET', host } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      host: '127.0.0.1', port, path, method,
      headers: host === undefined ? {} : { Host: host },
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* A SETUP write retried past EPERM: Windows refuses a rename onto a file the
   server holds open, and the store's writes are temp-plus-rename. Only for a
   write a case makes to set itself up, never for anything a case asserts. */
async function writeWhileServing(fn, tries = 20) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= tries || !e || e.code !== 'EPERM') throw e;
      await sleep(100);
    }
  }
}

/* Poll until every condition holds AT ONCE: autoWake renames the question file
   before it rebuilds index.md. 100ms is deliberate and must not be lowered, or
   the store's atomic renames fail with EPERM on Windows; the cap is a deadline. */
async function pollUntil(check, capMs = 15000) {
  const deadline = Date.now() + capMs;
  for (;;) {
    if (await check()) return true;
    if (Date.now() >= deadline) return false;
    await sleep(100);
  }
}

/* A test board (lib/board-call.mjs startBoard), the env that points a spawned
   server at it, and `verb(name, input, body)` writing it as another PC would. */
async function onBoard(t) {
  const b = await startBoard();
  t.after(() => b.close());
  const verb = (name, input, body = {}) => boardRequest('POST', '/api/v1/verbs/' + name,
    { input, ...body, opts: { strict: false, inherit: false } }, { url: b.url, token: b.token });
  return { b, verb, env: { ASKERDO_BOARD_URL: b.url, ASKERDO_BOARD_TOKEN: b.token } };
}

/* a question as a session registers it on the board */
const asked = (over = {}) => ({
  name: 'store shape', gist: 'One file or a server?', projectDir: 'C:/repos/my-app', session: 'sess-a',
  blocking: true, ask: 'One file (a, my pick) or a server (b)?', pick: 'a',
  options: [
    { type: 'a', option: 'single file', getsYou: 'simple', costsYou: 'contention' },
    { type: 'b', option: 'a server', getsYou: 'one writer', costsYou: 'a box to run' },
  ],
  ...over,
});

/* until the server's local board holds the board's working set, so a row after
   this is a live one (it raises its alert) */
const boardLoaded = (sb) => pollUntil(async () => {
  try { return (await (await fetch(sb.base + '/local/state')).json()).result.loaded === true; } catch { return false; }
});

/* a server on `board` (onBoard's), up and its cache loaded */
async function startOn(t, sb, board, env = {}, nodeArgs = []) {
  const srv = start(t, sb, { ...board.env, ...env }, nodeArgs);
  await srv.line;
  assert.ok(await boardLoaded(sb), 'the local board loaded');
  return srv;
}

/* A listener that is emphatically not a board. */
function stranger(t, port) {
  const srv = createServer((req, res) => { res.writeHead(200); res.end('someone else\n'); });
  t.after(() => { try { srv.close(); } catch {} });
  return new Promise((resolve) => srv.listen(port, '127.0.0.1', () => resolve(srv)));
}

/* An injected hub whose boardSnapshot NEVER resolves, through a module
   resolution hook: the ping is the liveness signal the tray reaps against and
   the handshake probes, so a store must never get a vote on it. */
function shimLib(name, replacement) {
  const dir = tempDir('nd-shim-');
  const real = pathToFileURL(join(pluginRoot, 'lib', name)).href;
  const shim = join(dir, 'shim-' + name);
  /* the star carries every export the shim does not replace, and REAL is what
     a replacement wraps when it needs the original rather than a stand-in */
  writeFileSync(shim, 'export * from ' + JSON.stringify(real) + ';\n'
    + 'import * as REAL from ' + JSON.stringify(real) + ';\n' + replacement);
  const hooks = join(dir, 'hooks.mjs');
  writeFileSync(hooks, 'const SHIM = ' + JSON.stringify(pathToFileURL(shim).href) + ';\n'
    + 'const SPEC = ' + JSON.stringify('../lib/' + name) + ';\n'
    + 'export async function resolve(spec, context, next) {\n'
    + '  const parent = String((context && context.parentURL) || "");\n'
    + "  if (spec === SPEC && parent.endsWith('/hooks/board-server.mjs')) {\n"
    + '    return next(SHIM, context);\n'
    + '  }\n'
    + '  return next(spec, context);\n'
    + '}\n');
  const entry = join(dir, 'register.mjs');
  writeFileSync(entry, "import { register } from 'node:module';\n"
    + 'register(' + JSON.stringify(pathToFileURL(hooks).href) + ');\n');
  return ['--import', pathToFileURL(entry).href];
}

/* THE NOTIFICATION CHANNEL forced for a spawned server: the test route
   is the only one that asks the notifier whether it exists, so a case about it
   would pass on a Windows desktop and 503 on the runner. ON is win32. */
const channelOn = () => shimLib('notify.mjs',
  'export function createNotifier(deps) {\n'
  + "  return REAL.createNotifier({ ...deps, platform: 'win32' });\n"
  + '}\n');

const channelOff = () => shimLib('notify.mjs',
  "export function createNotifier(deps) { return REAL.createNotifier({ ...deps, platform: 'nope' }); }\n");

/* ---- the launcher's scheduled task, through the injected runner ---- */

/* NO CASE IN THIS SUITE REGISTERS, RUNS OR DELETES A REAL SCHEDULED TASK: the
   ensure takes its schtasks runner and its SID reader through the options bag,
   so every case hands in fakes and `whoami` is never spawned. */
const FAKE_SID = 'S-1-5-21-4242-4242-4242-1001';

function taskRunner({ current = null, create = null, ran = null, onRun = null, drop = null, legacy = !!drop } = {}) {
  const calls = [];
  const xmlFiles = [];
  const docs = [];
  const run = (args) => {
    calls.push(args);
    /* the old task name's cleanup: the default is what schtasks says on a machine
       that never had a task under the old name, which is every sandbox and every
       machine whose first ensure already removed it */
    if (args[0] === '/delete') {
      return drop || { code: 1, stdout: '', stderr: 'ERROR: The system cannot find the file specified.' };
    }
    if (args[0] === '/query' && args[2] === LEGACY_TASK_NAME) {
      return legacy ? { code: 0, stdout: LEGACY_TASK_NAME, stderr: '' } : { code: 1, stdout: '', stderr: 'ERROR: The system cannot find the file specified.' };
    }
    if (args[0] === '/query') {
      if (!current) {
        return { code: 1, stdout: '', stderr: 'ERROR: The system cannot find the file specified.' };
      }
      return { code: 0, stderr: '', stdout: taskXml({ sid: FAKE_SID, command: current.command, args: current.args }) };
    }
    if (args[0] === '/create') {
      const file = args[4];
      xmlFiles.push(file);
      /* read while it still exists: the ensure deletes it in a finally, and
         the document is what the register is actually made of */
      const text = readFileSync(file).toString('utf16le');
      const bom = text.charCodeAt(0) === 0xfeff;
      docs.push({ file, bom, text: bom ? text.slice(1) : text });
      return create || { code: 0, stdout: 'SUCCESS: the task has been created.', stderr: '' };
    }
    if (args[0] === '/run') {
      if (onRun) onRun();
      return ran || { code: 0, stdout: 'SUCCESS: Attempted to run the scheduled task.', stderr: '' };
    }
    throw new Error('the ensure ran an unexpected schtasks verb: ' + args.join(' '));
  };
  return { run, calls, xmlFiles, docs, sid: () => FAKE_SID, verbs: () => calls.map((c) => c[0]) };
}

/* A throwaway COPY of the plugin tree at the SAME relative layout: pluginVersion
   resolves the manifest from lib/node-helpers.mjs's own module location, so a
   copied lib/ is what gives the copied server a copied manifest to read. */
function copyTree(ver) {
  const dir = tempDir('nd-tree-');
  /* server/: lib/board-call.mjs and lib/local-board.mjs import it */
  for (const name of ['lib', 'hooks', 'server']) {
    cpSync(join(pluginRoot, name), join(dir, name), { recursive: true });
  }
  writeManifest(dir, ver);
  return dir;
}

/* The real manifest's shape with a plainly synthetic version in it, so neither
   number a case asserts on can be confused with a build that ever shipped. */
function writeManifest(dir, ver) {
  const real = JSON.parse(readFileSync(join(pluginRoot, '.claude-plugin', 'plugin.json'), 'utf8'));
  mkdirSync(join(dir, '.claude-plugin'), { recursive: true });
  writeFileSync(join(dir, '.claude-plugin', 'plugin.json'),
    JSON.stringify({ ...real, version: ver }, null, 2) + '\n');
}

test('the first stdout line is the permanent board URL at the identity port', async (t) => {
  const sb = await mint();
  const srv = start(t, sb);
  assert.equal(await srv.line, 'http://askerdo.localhost:' + sb.port + '/' + sb.secret + '/');
});

/* With no flag the root comes from argRoot's fallback, which is storeRoot(), so a
   board started by hand serves the machine's own store. */
test('with no --root the server serves the resolved root', { timeout: 30000 }, async (t) => {
  /* homedir() reads USERPROFILE on Windows and HOME elsewhere, so the child
     resolves the sandbox and never this machine's own store. */
  const sb = await mint();
  const srv = start(t, sb, { HOME: sb.home, USERPROFILE: sb.home }, [], boardScript, []);
  assert.equal(await srv.line, 'http://askerdo.localhost:' + sb.port + '/' + sb.secret + '/');
});

/* with no flag the seam reaches argRoot through storeRoot(), so a rig
   board serves the copy; the home is seeded too, so the case cannot pass by
   resolving the candidates instead. */
test('with no --root a seam root is served, over the home the candidates would answer',
  { timeout: 30000 }, async (t) => {
    const live = await mint();
    const copy = await mint('nd-board-cli-');
    const srv = start(t, copy,
      { HOME: live.home, USERPROFILE: live.home, ASKERDO_ROOT: copy.root },
      [], boardScript, []);
    assert.equal(await srv.line,
      'http://askerdo.localhost:' + copy.port + '/' + copy.secret + '/');
  });

/* The flag returns before storeRoot() is ever called, so the precedence is
   structural; this pins it, because a sandboxed rig relies on it. */
test('an explicit --root wins over a seam naming another store', { timeout: 30000 }, async (t) => {
  const flagged = await mint();
  const other = await mint('nd-board-cli-');
  const srv = start(t, flagged,
    { HOME: other.home, USERPROFILE: other.home, ASKERDO_ROOT: other.root });
  assert.equal(await srv.line,
    'http://askerdo.localhost:' + flagged.port + '/' + flagged.secret + '/');
});

/* a rig server silently serving the LIVE store is rootValue's own
   trap in the other half of the product, so the no-flag path refuses. */
test('a seam the resolver could not take refuses the no-flag start', { timeout: 30000 }, async (t) => {
  const live = await mint();
  const missing = join(live.home, 'never-made');
  const srv = start(t, live,
    { HOME: live.home, USERPROFILE: live.home, ASKERDO_ROOT: missing },
    [], boardScript, []);
  assert.equal(await srv.closed, 1);
  assert.match(srv.stderr(), /^AskerDo board: ASKERDO_ROOT/);
  assert.match(srv.stderr(), /a path that does not exist/);
  assert.equal(srv.stdout(), '', 'a URL was printed for a root it could not take');
  assert.equal(existsSync(missing), false);
  await assert.rejects(raw(live.port, '/'), 'the live store was served instead');
});

test('every response carries the sniffing and referrer guards', async (t) => {
  const sb = await mint();
  const srv = start(t, sb);
  await srv.line;
  const html = await fetch(sb.base + '/');
  /* the whole credential is the URL path, so Referer is the one channel that
     could hand it to a third party */
  assert.equal(html.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(html.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await fetch(sb.base + '/assets/house.css')).headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await fetch(sb.base + '/nope')).headers.get('x-content-type-options'), 'nosniff');
  const ping = await raw(sb.port, '/' + sb.secret + '/ping', { method: 'POST' });
  assert.equal(ping.headers['x-content-type-options'], 'nosniff');
  /* the whitelist, not Object.prototype, decides what is an asset name */
  for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
    assert.equal((await fetch(sb.base + '/assets/' + name)).status, 404, name);
  }
});

test('the Host check accepts exactly three names and refuses everything else', async (t) => {
  const sb = await mint();
  const srv = start(t, sb);
  await srv.line;
  const path = '/' + sb.secret + '/';
  const ok = async (host) => assert.equal((await raw(sb.port, path, { host })).status, 200, host);
  const no = async (host) => assert.equal((await raw(sb.port, path, { host })).status, 404, host);
  await ok('askerdo.localhost:' + sb.port);
  await ok('localhost:' + sb.port);
  await ok('127.0.0.1:' + sb.port);
  await ok('ASKERDO.LOCALHOST:' + sb.port);
  /* the deliberate divergence from the edit server: this one never binds v6 */
  await no('[::1]:' + sb.port);
  await no('attacker.example');
  /* a fourth name, and any accepted name on any other port */
  await no('askerdo.localhost.example:' + sb.port);
  await no('askerdo.localhost:' + (sb.port + 1));
  await no('askerdo.localhost');
});

test('a wrong secret is a flat 404 on every route, and the server stays up', async (t) => {
  const sb = await mint();
  const srv = start(t, sb);
  await srv.line;
  const wrong = 'http://127.0.0.1:' + sb.port + '/deadbeefdeadbeefdeadbeefdeadbeef';
  for (const [route, method] of [['/', 'GET'], ['/q/Q1', 'GET'], ['/assets/house.css', 'GET'],
    ['/ping', 'POST'], ['/stop', 'POST']]) {
    const res = await fetch(wrong + route, { method });
    assert.equal(res.status, 404, route);
    assert.match(res.headers.get('content-type'), /text\/plain/);
    assert.equal(await res.text(), 'not found\n');
  }
  /* near-misses of the REAL secret: a prefix compare or a truncated compare
     would pass all of these, and a wholly different secret cannot show it */
  for (const near of [sb.secret + 'x', sb.secret.slice(0, 8),
    sb.secret.slice(0, 31) + (sb.secret[31] === 'a' ? 'b' : 'a')]) {
    const r = await raw(sb.port, '/' + near + '/', { host: '127.0.0.1:' + sb.port });
    assert.equal(r.status, 404, near);
  }
  assert.equal((await fetch(sb.base + '/')).status, 200, 'the server survived every refusal');
  assert.equal(srv.proc.exitCode, null);
});

test('the root and record links open the board pages through a login link, and with no board set say so; Add a PC mints a code that joins', async (t) => {
  const no = { redirect: 'manual' };
  const sb = await mint();
  await start(t, sb).line;
  for (const route of ['/', '/q/Q4']) {
    const none = await fetch(sb.base + route, no);
    assert.equal(none.status, 200, route + ': no board set, and the link says so');
    assert.match(none.headers.get('content-type'), /text\/plain/);
    assert.equal(none.headers.get('access-control-allow-origin'), null);
  }
  assert.equal((await fetch(sb.base + '/api/join-code', { method: 'POST' })).status, 409, 'no board, no join code');
  const { b, env } = await onBoard(t);
  const sb2 = await mint();
  await start(t, sb2, env).line;
  assert.equal((await fetch(sb2.base + '/add-pc')).status, 200);
  const minted = await (await fetch(sb2.base + '/api/join-code', { method: 'POST' })).json();
  assert.ok(minted.line.includes(minted.code) && minted.until, JSON.stringify(minted));
  /* a board reached on loopback is named by this PC's network name, which another PC can reach */
  const at = new URL(minted.board);
  assert.equal(at.hostname, hostname().toLowerCase());
  assert.equal(at.port, new URL(b.url).port);
  assert.ok(minted.line.includes(minted.board), minted.line);
  assert.equal((await boardJoin(b.url, minted.code, 'pc-two')).device, 'pc-two', 'the code the page shows joins');
  for (const [route, page] of [['/', '/'], ['/r/Q4', '/r/Q4'], ['/needs-you?project=proj', '/needs-you?project=proj'], ['/override/3', '/override/3']]) {
    const login = await fetch(sb2.base + route, no);
    assert.match(String(login.headers.get('location')), /\/login\//, route);
    const landed = await fetch(login.headers.get('location'), no);
    assert.equal(landed.headers.get('location'), page, route);
    assert.match(String(landed.headers.get('set-cookie')), /askerdo_web=/, route);
  }
});

test('the eleven shared assets serve from the whitelist and nothing else does', async (t) => {
  const sb = await mint();
  const srv = start(t, sb);
  await srv.line;
  const types = {
    'house.css': /text\/css/,
    /* the file viewer's vendored client stack, pinned and committed by
       scripts/build-viewer.mjs and loaded by the f/ page alone */
    'markdown-it.min.js': /text\/javascript/,
    'purify.min.js': /text\/javascript/,
    'highlight.min.js': /text\/javascript/,
    /* the tab's own mark in its three live faces, served like every other shared
       asset: the page links one and swaps by href. */
    'favicon.svg': /image\/svg\+xml/,
    'favicon-quiet.svg': /image\/svg\+xml/,
    'favicon-blocking.svg': /image\/svg\+xml/,
    /* the same three faces as 32 px rasters, delivered with them and
       served as BYTES: nothing links them yet, and the register is what makes
       a link one href away rather than a route change */
    'favicon-32.png': /^image\/png$/,
    'favicon-quiet-32.png': /^image\/png$/,
    'favicon-blocking-32.png': /^image\/png$/,
    /* the UI face, which the house sheet asks for by a RELATIVE url, so every
       served page that loads the sheet resolves it from this same route */
    'geist.woff2': /^font\/woff2$/,
  };
  assert.equal(Object.keys(types).length, 11);
  /* the register and this list are checked against each other, so a name added
     to one and not the other fails here rather than shipping unserved */
  assert.deepEqual(Object.keys(ASSETS).filter((name) => !types[name]), []);
  for (const name of Object.keys(types)) {
    const res = await fetch(sb.base + '/assets/' + name);
    assert.equal(res.status, 200, name);
    assert.match(res.headers.get('content-type'), types[name], name);
    assert.equal(res.headers.get('cache-control'), 'no-cache', name);
    /* per file, not once for the route: a served asset that could be sniffed
       into another type is the one thing a whitelist alone does not prevent */
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff', name);
    assert.ok((await res.text()).length > 100, name);
  }
  /* every vendored bundle ships its notice beside it, and the notices are not
     served: they travel with the repo, not with the page */
  for (const notice of ['markdown-it.txt', 'dompurify.txt', 'highlight.js.txt']) {
    assert.ok(existsSync(join(pluginRoot, 'assets', 'licenses', notice)), notice);
    assert.equal((await fetch(sb.base + '/assets/licenses/' + notice)).status, 404, notice);
  }
  /* the font goes out as BYTES, not as decoded text: a served woff2 that lost
     its magic is a font the browser silently declines to use */
  const font = Buffer.from(await (await fetch(sb.base + '/assets/geist.woff2')).arrayBuffer());
  assert.equal(font.subarray(0, 4).toString('latin1'), 'wOF2');
  assert.deepEqual(font, readFileSync(join(pluginRoot, 'assets', 'geist.woff2')));

  /* and so do the favicon rasters: a PNG served as decoded text is a
     tab icon the browser silently declines */
  for (const name of ['favicon-32.png', 'favicon-quiet-32.png', 'favicon-blocking-32.png']) {
    const png = Buffer.from(await (await fetch(sb.base + '/assets/' + name)).arrayBuffer());
    assert.deepEqual([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], name);
    assert.deepEqual(png, readFileSync(join(pluginRoot, 'assets', name)), name);
  }

  assert.equal((await fetch(sb.base + '/assets/nope.js')).status, 404);
  /* the .ico files the tray wears are NOT served: the tray helper reads them off
     disk and the whitelist is not a directory listing. The native tray exe
     and its licence notices join them: neither is a page asset. */
  for (const name of ['tray-waiting.ico', 'tray-quiet.ico', 'tray-blocking.ico',
    'tray-light-waiting.ico', 'tray-light-quiet.ico', 'tray-light-blocking.ico', 'app.ico',
    'askerdo-tray.exe', 'licenses/askerdo-tray.txt']) {
    assert.equal((await fetch(sb.base + '/assets/' + name)).status, 404, name);
  }
  /* nor the icon package's own paperwork under assets/icons/, which is provenance
     and not a page asset. The app rasters are on that list too: nothing
     reads them, so the board serves nothing. */
  for (const name of ['icons/README.md', 'icons/manifest.json', 'icons/validation-report.json',
    'icons/export.mjs', 'icons/package.json', 'icons/app-mark-dark.svg',
    'icons/app-48.png', 'icons/app-64.png', 'icons/app-96.png', 'icons/app-128.png',
    'icons/app-256.png']) {
    assert.equal((await fetch(sb.base + '/assets/' + name)).status, 404, name);
  }
  assert.deepEqual(Object.keys(ASSETS).filter((n) => /app-|icons/.test(n)), [],
    'the app mark joins no register');
  /* nor is the font's notice, which lives beside it and is not a page asset */
  assert.equal((await fetch(sb.base + '/assets/geist-license.txt')).status, 404);
  assert.equal((await fetch(sb.base + '/assets/')).status, 404);
  /* the whitelist, not the filesystem, decides: this file exists and still 404s */
  assert.equal((await fetch(sb.base + '/assets/licenses/README.md')).status, 404);
  /* raw, so the traversal reaches the server unnormalized by the client */
  const esc = await raw(sb.port, '/' + sb.secret + '/assets/../board/secret');
  assert.equal(esc.status, 404);
  assert.ok(!esc.body.includes(sb.secret));
});

/* an explicit bound on every case that awaits a child process exit: a
   lifecycle regression must report a failure, not stall node:test forever */
test('there is no idle timer and no heartbeat: only /stop ends it', { timeout: 20000 }, async (t) => {
  const sb = await mint();
  const srv = start(t, sb);
  await srv.line;
  await sleep(2000);
  assert.equal(srv.proc.exitCode, null, 'two silent seconds did not kill it');
  const wrong = 'http://127.0.0.1:' + sb.port + '/deadbeefdeadbeefdeadbeefdeadbeef/ping';
  const until = Date.now() + 2000;
  while (Date.now() < until) {
    await fetch(wrong, { method: 'POST' });
    await sleep(50);
  }
  assert.equal(srv.proc.exitCode, null, 'unauthorized traffic changed nothing either');
  assert.equal((await fetch(sb.base + '/')).status, 200);

  const res = await fetch(sb.base + '/stop', { method: 'POST' });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, stopped: true });
  assert.equal(await srv.closed, 0);
});

test('the secret ping answers 204 and names the version it serves', async (t) => {
  const sb = await mint();
  const srv = start(t, sb);
  await srv.line;
  const res = await raw(sb.port, '/' + sb.secret + '/ping', { method: 'POST' });
  assert.equal(res.status, 204);
  assert.equal(res.headers['x-askerdo-board'], version);
  assert.equal(res.headers['cache-control'], 'no-store');
  /* additive beside the version header and never instead of it: the whole
     adopt/replace/stranger handshake still keys on the 204 plus a string
     x-askerdo-board. This one lets the tray tell its own server from a stranger. */
  assert.match(res.headers['x-askerdo-instance'], /^[0-9a-f]{16}$/);
  /* and the third additive header, the live dot the tray wears: an empty
     store is quiet, and this sandbox has the whole notification channel
     switched off, which is exactly the independence the header promises */
  assert.equal(res.headers['x-askerdo-dot'], 'quiet');

  /* the right secret on the wrong method is still a flat 404: a GET-able /stop
     would be reachable from any page the secret leaks into, since an <img src> is
     a GET, which is why the route table pins the method as well as the path */
  for (const [m, p] of [['GET', '/ping'], ['GET', '/stop'], ['POST', '/'],
    ['POST', '/q/Q1'], ['POST', '/assets/house.css'], ['DELETE', '/']]) {
    const r = await raw(sb.port, '/' + sb.secret + p, { method: m });
    assert.equal(r.status, 404, m + ' ' + p);
  }
  assert.equal(srv.proc.exitCode, null, 'no wrong-method request acted');
});

test('a second start on the identity port adopts the running instance', { timeout: 20000 }, async (t) => {
  const sb = await mint();
  const first = start(t, sb);
  await first.line;
  const second = start(t, sb);
  assert.equal(await second.closed, 0);
  const lines = second.stdout().split('\n');
  assert.equal(lines[0], 'http://askerdo.localhost:' + sb.port + '/' + sb.secret + '/');
  assert.match(lines[1], /adopted the instance already running on port /);
  assert.equal((await fetch(sb.base + '/')).status, 200, 'the first instance still serves');
  assert.equal(first.proc.exitCode, null);
});

test('a stranger on the identity port is refused, and the port is never moved off', { timeout: 20000 }, async (t) => {
  const sb = await mint();
  await stranger(t, sb.port);
  const srv = start(t, sb);
  assert.equal(await srv.closed, 1);
  assert.match(srv.stderr(), new RegExp('port ' + sb.port + ' is held by another process'));
  assert.match(srv.stderr(), /the port is permanent/);
  const still = await raw(sb.port, '/');
  assert.equal(still.body, 'someone else\n', 'the stranger kept the port');
});

test('a stale-version instance is replaced through the secret stop route', { timeout: 20000 }, async (t) => {
  const sb = await mint();
  const old = start(t, sb, { ASKERDO_BOARD_VERSION: '0.0.1' });
  await old.line;
  const before = await raw(sb.port, '/' + sb.secret + '/ping', { method: 'POST' });
  assert.equal(before.headers['x-askerdo-board'], '0.0.1');

  /* THE REPLACE PATH GOES THROUGH THE TASK like every other start. The
     fake runner answers a CURRENT action, so only /query and /run are issued,
     and the fake /run spawns what the scheduler would have spawned. */
  let fresh = null;
  const task = taskRunner({ current: wantedAction(sb.root), onRun: () => { fresh = start(t, sb); } });
  const r = await ensureBoardServer(sb.root, { run: task.run, sid: task.sid, home: () => sb.home });
  t.after(async () => { try { await fetch(sb.base + '/stop', { method: 'POST' }); } catch {} });
  assert.equal(r.status, 'replaced');
  assert.equal(await old.closed, 0, 'the stale instance stopped itself');
  assert.deepEqual(task.verbs(), ['/query', '/run'], 'a current action is never re-registered');
  /* AND THE STOP CAME FIRST: a replacement started while the stale instance still
     held the port would have ADOPTED it and said so, so a server that BOUND the
     port proves the secret /stop landed before the task was run. */
  await fresh.line;
  assert.ok(!fresh.stdout().includes('adopted'),
    'the identity port was free when the task ran: ' + JSON.stringify(fresh.stdout()));
  const after = await raw(sb.port, '/' + sb.secret + '/ping', { method: 'POST' });
  assert.equal(after.status, 204);
  assert.equal(after.headers['x-askerdo-board'], version);
  assert.equal((await fetch(sb.base + '/')).status, 200);
});

/* The other replace path. lib/board-ensure.mjs has its own, covered above; this is
   the one a hand-run board-server.mjs takes after a plugin update, and the two can
   mask each other. */
test('a second SERVER start replaces its own stale build', { timeout: 20000 }, async (t) => {
  const sb = await mint();
  const old = start(t, sb, { ASKERDO_BOARD_VERSION: '0.0.1' });
  await old.line;
  const before = await raw(sb.port, '/' + sb.secret + '/ping', { method: 'POST' });
  const fresh = start(t, sb);
  assert.equal(await fresh.line, 'http://askerdo.localhost:' + sb.port + '/' + sb.secret + '/');
  assert.ok(!fresh.stdout().includes('adopted'), 'a stale twin is replaced, not adopted');
  assert.equal(await old.closed, 0, 'the stale instance stopped itself');
  const ping = await raw(sb.port, '/' + sb.secret + '/ping', { method: 'POST' });
  assert.equal(ping.status, 204);
  assert.equal(ping.headers['x-askerdo-board'], version);
  /* a REPLACEMENT is a new instance at the same address, which is exactly what
     the tray helper reaps against */
  assert.match(before.headers['x-askerdo-instance'], /^[0-9a-f]{16}$/);
  assert.notEqual(ping.headers['x-askerdo-instance'], before.headers['x-askerdo-instance']);

  /* ONE banner is how this says one tray and one watch timer: announce() writes
     the banner and starts the notification channel, and the replace path listens a
     second time on a socket whose first listen left its callback armed. */
  const banner = 'http://askerdo.localhost:' + sb.port + '/' + sb.secret + '/';
  assert.equal(fresh.stdout().split(banner).length - 1, 1,
    'announce() ran more than once: ' + JSON.stringify(fresh.stdout()));
});

/* The takeover hole, and the reason the version is baked at boot: a version bump
   edits plugin.json UNDER a running process, so a per-call read would answer the
   handshake with the new number and survive every session start. */
test('a manifest edited under a running server does not move the version it reports',
  { timeout: 20000 }, async (t) => {
    const sb = await mint();
    const tree = copyTree('9.9.1');
    const srv = start(t, sb, {}, [], join(tree, 'hooks', 'board-server.mjs'));
    await srv.line;

    const before = await raw(sb.port, '/' + sb.secret + '/ping', { method: 'POST' });
    assert.equal(before.headers['x-askerdo-board'], '9.9.1', 'the copied manifest is what it serves');

    /* imported BEFORE the bump on purpose: an ensure that ever baked its own
       version at module scope would read 9.9.1 here, see no mismatch below,
       and fail this case, which is the guard on the fresh-read staying. */
    const { ensureBoardServer: ensureFromTree } = await import(
      pathToFileURL(join(tree, 'lib', 'board-ensure.mjs')).href);

    writeManifest(tree, '9.9.2');
    const after = await raw(sb.port, '/' + sb.secret + '/ping', { method: 'POST' });
    assert.equal(after.headers['x-askerdo-board'], '9.9.1',
      'a running process reports the version its code was started with');
    /* the same baked value on the served notifications page, read through the
       very same accessor the ping header does */
    assert.match(await (await fetch(sb.base + '/notifications')).text(), /9\.9\.1/);

    /* and the mismatch is what the takeover acts on. The ensure runs in a FRESH
       process, where fresh-reading the manifest is right: it reads 9.9.2, the
       server says 9.9.1, and the stale instance is stopped and replaced. */
    /* the injected runner again, and its /run starts the COPIED tree's server: an
       ensure driven from a copied tree that reached the real schtasks would register
       a task pointing into a temp directory */
    const task = taskRunner({ onRun: () => start(t, sb, {}, [], join(tree, 'hooks', 'board-server.mjs')) });
    const r = await ensureFromTree(sb.root, { run: task.run, sid: task.sid, home: () => sb.home });
    t.after(async () => { try { await fetch(sb.base + '/stop', { method: 'POST' }); } catch {} });
    assert.equal(r.status, 'replaced');
    assert.equal(await srv.closed, 0, 'the stale instance stopped itself');

    const now = await raw(sb.port, '/' + sb.secret + '/ping', { method: 'POST' });
    assert.equal(now.status, 204);
    assert.equal(now.headers['x-askerdo-board'], '9.9.2', 'the replacement serves the new manifest');
    assert.notEqual(now.headers['x-askerdo-instance'], before.headers['x-askerdo-instance']);

    /* a copy Claude Code marked replaced (an old session after the update) adopts
       the board whatever its version, and leaves the task alone */
    const old = copyTree('9.9.1');
    writeFileSync(join(old, '.orphaned_at'), String(Date.now()));
    const { ensureBoardServer: ensureFromOld } = await import(pathToFileURL(join(old, 'lib', 'board-ensure.mjs')).href);
    const idle = taskRunner();
    const kept = await ensureFromOld(sb.root, { run: idle.run, sid: idle.sid, home: () => sb.home });
    assert.equal(kept.status, 'running');
    assert.deepEqual(idle.verbs(), [], 'a replaced copy plans, registers and runs nothing');
    const still = await raw(sb.port, '/' + sb.secret + '/ping', { method: 'POST' });
    assert.equal(still.headers['x-askerdo-instance'], now.headers['x-askerdo-instance'], 'the newer board kept serving');
  });

test('ensureBoardServer starts, adopts, and refuses', async (t) => {
  const cold = await mint();
  /* `starts` is the TASK: the argv is what this half asserts, and the fake /run
     stands in for the task instance, so `adopts` below is still a real second call
     against a real running server. */
  const task = taskRunner({ onRun: () => start(t, cold) });
  const started = await ensureBoardServer(cold.root, { run: task.run, sid: task.sid, home: () => cold.home });
  t.after(async () => { try { await fetch(cold.base + '/stop', { method: 'POST' }); } catch {} });
  assert.equal(started.status, 'started');
  assert.equal(started.port, cold.port);
  assert.equal(started.url, 'http://askerdo.localhost:' + cold.port + '/' + cold.secret + '/');
  assert.equal(started.altUrl, 'http://127.0.0.1:' + cold.port + '/' + cold.secret + '/');
  assert.equal((await fetch(cold.base + '/')).status, 200);
  assert.deepEqual(task.verbs(), ['/query', '/query', '/create', '/run']);

  const again = await ensureBoardServer(cold.root, { run: task.run, sid: task.sid, home: () => cold.home });
  assert.equal(again.status, 'running');
  assert.equal(again.url, started.url);
  assert.deepEqual(task.verbs(), ['/query', '/query', '/create', '/run'],
    'a board that already answers is not a task worth touching');

  const held = await mint();
  await stranger(t, held.port);
  const other = taskRunner();
  const foreign = await ensureBoardServer(held.root, { waitMs: 500, run: other.run, sid: other.sid, home: () => held.home });
  assert.equal(foreign.status, 'foreign');
  assert.equal(foreign.port, held.port);
  assert.deepEqual(other.verbs(), [],
    'a stranger on the identity port is refused before anything is registered or run');
});

/* ---- the decision sequence, the document, and the refusals -------- */

test('a cold ensure registers the task, runs it, and waits for the ping', { timeout: 20000 }, async (t) => {
  const sb = await mint();
  const task = taskRunner({ onRun: () => start(t, sb) });
  const r = await ensureBoardServer(sb.root, { run: task.run, sid: task.sid, home: () => sb.home });
  t.after(async () => { try { await fetch(sb.base + '/stop', { method: 'POST' }); } catch {} });
  assert.equal(r.status, 'started');

  /* THE ARGV, in order and whole */
  assert.deepEqual(task.verbs(), ['/query', '/query', '/create', '/run']);
  assert.deepEqual(task.calls[0], ['/query', '/tn', TASK_NAME, '/xml']);
  /* the old task is looked for immediately before the register; a PC
     that never had it deletes nothing and logs nothing about it */
  assert.deepEqual(task.calls[1], ['/query', '/tn', LEGACY_TASK_NAME]);
  assert.ok(!existsSync(join(sb.root, 'log')) || !readFileSync(join(sb.root, 'log'), 'utf8').includes(LEGACY_TASK_NAME));
  assert.deepEqual(task.calls[2].slice(0, 4), ['/create', '/tn', TASK_NAME, '/xml']);
  assert.equal(task.calls[2][5], '/f', 'the create overwrites a task of the same name');
  assert.deepEqual(task.calls[3], ['/run', '/tn', TASK_NAME]);
  assert.equal(TASK_NAME, 'AskerDo board', 'the brand goes to schtasks as one argument');

  /* THE DOCUMENT the create was made of: UTF-16 with a BOM, the wanted action,
     and the SID it was handed */
  assert.equal(task.docs.length, 1);
  assert.equal(task.docs[0].bom, true, 'schtasks reads the file as Unicode');
  assert.deepEqual(parseAction(task.docs[0].text), wantedAction(sb.root));
  assert.ok(task.docs[0].text.includes('<UserId>' + FAKE_SID + '</UserId>'));

  /* AND IT IS GONE: the file carried an identity, so it does not outlive the
     register even by a tick */
  assert.equal(existsSync(task.xmlFiles[0]), false, 'the temp XML is deleted in a finally');
  assert.equal((await fetch(sb.base + '/')).status, 200);
});

/* THE OLD TASK GOES WITH THE RENAME. Two logon tasks on one port is a race,
   and the register is the one moment both names are known, so the ensure that
   registers deletes the old name first, through the same injected schtasks. */
test('the ensure deletes the old task once, immediately before the register, and logs it',
  { timeout: 20000 }, async (t) => {
    const sb = await mint();
    const task = taskRunner({
      drop: { code: 0, stdout: 'SUCCESS: The scheduled task was successfully deleted.', stderr: '' },
      onRun: () => start(t, sb),
    });
    const r = await ensureBoardServer(sb.root, { run: task.run, sid: task.sid, home: () => sb.home });
    t.after(async () => { try { await fetch(sb.base + '/stop', { method: 'POST' }); } catch {} });
    assert.equal(r.status, 'started');
    assert.deepEqual(task.verbs(), ['/query', '/query', '/delete', '/create', '/run']);
    assert.deepEqual(task.calls[2], ['/delete', '/tn', LEGACY_TASK_NAME, '/f']);
    assert.equal(LEGACY_TASK_NAME, 't.ask&ding board', 'the name every release before AskerDo registered');
    /* and the removal is LOGGED, so a task that went is readable a month later */
    assert.match(readFileSync(join(sb.root, 'log'), 'utf8'),
      /the scheduled task "t\.ask&ding board" was removed/);

    /* ONCE: a board that already answers is not a task worth touching, so the
       next ensure deletes nothing either */
    const again = await ensureBoardServer(sb.root, { run: task.run, sid: task.sid, home: () => sb.home });
    assert.equal(again.status, 'running');
    assert.equal(task.verbs().filter((v) => v === '/delete').length, 1);
  });

/* AND IT IS BEST EFFORT: the removal is housekeeping, so the harshest failure
   there is (the runner throwing) costs one log line and not the board. */
test('a delete that fails does not fail the ensure', { timeout: 20000 }, async (t) => {
  const sb = await mint();
  const task = taskRunner({ legacy: true, onRun: () => start(t, sb) });
  const run = (args) => {
    if (args[0] === '/delete') { task.calls.push(args); throw new Error('schtasks is not on the PATH'); }
    return task.run(args);
  };
  const r = await ensureBoardServer(sb.root, { run, sid: task.sid, home: () => sb.home });
  t.after(async () => { try { await fetch(sb.base + '/stop', { method: 'POST' }); } catch {} });
  assert.equal(r.status, 'started');
  assert.deepEqual(task.verbs(), ['/query', '/query', '/delete', '/create', '/run'],
    'the register and the run came after it all the same');
  assert.match(readFileSync(join(sb.root, 'log'), 'utf8'),
    /the scheduled task "t\.ask&ding board" was not removed: schtasks is not on the PATH/);
  assert.equal((await fetch(sb.base + '/')).status, 200);
});

test('a current task is not re-registered, and the SID is never read', { timeout: 20000 }, async (t) => {
  const sb = await mint();
  const task = taskRunner({ current: wantedAction(sb.root), onRun: () => start(t, sb) });
  /* the read-compare-first rule refreshLauncher keeps: an ordinary session start
     neither rewrites the task nor spawns `whoami` */
  const r = await ensureBoardServer(sb.root, {
    run: task.run,
    sid: () => { throw new Error('the SID was read for a task that was already current'); },
    home: () => sb.home,
  });
  t.after(async () => { try { await fetch(sb.base + '/stop', { method: 'POST' }); } catch {} });
  assert.equal(r.status, 'started');
  assert.deepEqual(task.verbs(), ['/query', '/run']);
  assert.deepEqual(task.docs, []);
});

test('a stale action is re-registered at the new checkout', { timeout: 20000 }, async (t) => {
  const sb = await mint();
  const older = {
    command: 'C:\\cache\\askerdo-0.0.1\\assets\\askerdo-tray.exe',
    args: ['--serve', '--root', sb.root],
  };
  const task = taskRunner({ current: older, onRun: () => start(t, sb) });
  const r = await ensureBoardServer(sb.root, { run: task.run, sid: task.sid, home: () => sb.home });
  t.after(async () => { try { await fetch(sb.base + '/stop', { method: 'POST' }); } catch {} });
  assert.equal(r.status, 'started');
  assert.deepEqual(task.verbs(), ['/query', '/query', '/create', '/run']);
  assert.deepEqual(parseAction(task.docs[0].text), wantedAction(sb.root),
    'the new action names this checkout, not the one the task carried');
});

test('a register that fails is reported plainly and nothing is started', async () => {
  const sb = await mint();
  const task = taskRunner({ create: { code: 1, stdout: '', stderr: 'ERROR: Access is denied.' } });
  const r = await ensureBoardServer(sb.root, { run: task.run, sid: task.sid, waitMs: 300, home: () => sb.home });
  assert.equal(r.status, 'failed');
  assert.match(r.detail, /could not be registered/);
  assert.match(r.detail, /schtasks \/create exited 1/);
  assert.match(r.detail, /Access is denied/);
  assert.deepEqual(task.verbs(), ['/query', '/query', '/create'], 'the run is never reached');
  assert.equal(existsSync(task.xmlFiles[0]), false, 'and the temp XML still does not survive');
  /* THERE IS NO FALLBACK: nothing came up on the identity port */
  await assert.rejects(raw(sb.port, '/'), 'a board was started anyway');
});

test('a run that fails is reported plainly', async () => {
  const sb = await mint();
  const task = taskRunner({
    ran: { code: 1, stdout: '', stderr: 'ERROR: The system cannot find the file specified.' },
  });
  const r = await ensureBoardServer(sb.root, { run: task.run, sid: task.sid, waitMs: 300, home: () => sb.home });
  assert.equal(r.status, 'failed');
  assert.match(r.detail, /could not be run/);
  assert.match(r.detail, /schtasks \/run exited 1/);
  assert.deepEqual(task.verbs(), ['/query', '/query', '/create', '/run']);
  await assert.rejects(raw(sb.port, '/'), 'a board was started anyway');
});

/* A SID THAT CANNOT BE READ is the third way the register fails, and the one
   that never reaches schtasks at all. */
test('a SID that will not read is a plain refusal too', async () => {
  const sb = await mint();
  const task = taskRunner();
  const r = await ensureBoardServer(sb.root, { run: task.run, sid: () => null, waitMs: 300, home: () => sb.home });
  assert.equal(r.status, 'failed');
  assert.match(r.detail, /the user SID could not be read/);
  assert.deepEqual(task.verbs(), ['/query']);
});

/* THE SID SEAM: no suite run asks the machine who it is. This case deliberately
   injects no `sid`, so the DEFAULT reader runs and ASKERDO_SID is what it
   must find first; the document is what says which branch ran. */
test('the SID is read from the environment, and whoami is never spawned',
  { timeout: 20000 }, async (t) => {
    const sb = await mint();
    const task = taskRunner({ onRun: () => start(t, sb) });
    process.env.ASKERDO_SID = FAKE_SID;
    t.after(() => { delete process.env.ASKERDO_SID; });

    const r = await ensureBoardServer(sb.root, { run: task.run, home: () => sb.home });
    t.after(async () => { try { await fetch(sb.base + '/stop', { method: 'POST' }); } catch {} });
    assert.equal(r.status, 'started');
    assert.deepEqual(task.verbs(), ['/query', '/query', '/create', '/run']);
    /* the ONLY identity anywhere in the document is the injected one, in both
       places the document carries one */
    const ids = [...new Set(task.docs[0].text.match(/S-1-[0-9-]*[0-9]/g))];
    assert.deepEqual(ids, [FAKE_SID], 'a SID that is not the injected one means whoami ran');
    assert.equal(task.docs[0].text.split('<UserId>' + FAKE_SID + '</UserId>').length - 1, 2);
  });

/* ONLY THE LIVE STORE MAY REGISTER: there is one task on the machine, so a
   throwaway root reaching the register would point it at a directory that is
   about to be deleted. Both sides run through the injected seams. */
test('a store that is not the live one is refused the register, and the live one is not',
  { timeout: 20000 }, async (t) => {
    const live = await mint();
    const copy = await mint();

    /* the copy: the live home is `live.home`, and `copy.root` is not the store
       under it, so the register is refused by name before anything is written */
    const refused = taskRunner();
    const no = await ensureBoardServer(copy.root, {
      run: refused.run, sid: refused.sid, waitMs: 300, home: () => live.home,
    });
    assert.equal(no.status, 'failed');
    assert.match(no.detail, /not the live store root/);
    assert.match(no.detail, /AskerDo board/, 'the task is named so a person can look for it');
    assert.deepEqual(refused.verbs(), ['/query'], 'nothing was written and nothing was run');
    assert.deepEqual(refused.docs, [], 'no document was ever made');
    await assert.rejects(raw(copy.port, '/'), 'a board was started for the copy anyway');

    /* and the SAME runner and SID against the live root register and run: the
       refusal is about the root, not about the seams */
    const task = taskRunner({ onRun: () => start(t, live) });
    const yes = await ensureBoardServer(live.root, {
      run: task.run, sid: task.sid, home: () => live.home,
    });
    t.after(async () => { try { await fetch(live.base + '/stop', { method: 'POST' }); } catch {} });
    assert.equal(yes.status, 'started');
    assert.deepEqual(task.verbs(), ['/query', '/query', '/create', '/run']);
    assert.deepEqual(parseAction(task.docs[0].text), wantedAction(live.root));
  });

/* a seam naming the live store is simply not setting it, and the
   dangerous direction is the one already fenced. This is that fence read
   through the seam: the root a rig session holds is refused the register, and
   the refusal lands before anything is stopped (the order). */
test('a copy addressed through the seam is refused the register, and nothing is stopped',
  { timeout: 20000 }, async () => {
    const live = await mint();
    const copy = await mint();
    const seamed = storeRoot(live.home, { ASKERDO_ROOT: copy.root });
    assert.equal(seamed, copy.root, 'the seam is what resolved this root');

    const refused = taskRunner();
    const no = await ensureBoardServer(seamed, {
      run: refused.run, sid: refused.sid, waitMs: 300, home: () => live.home,
    });
    assert.equal(no.status, 'failed');
    assert.match(no.detail, /not the live store root/);
    assert.deepEqual(refused.verbs(), ['/query'], 'nothing was written and nothing was run');
    assert.deepEqual(refused.docs, [], 'no document was ever made');
    await assert.rejects(raw(copy.port, '/'), 'a board was started for the copy anyway');
    await assert.rejects(raw(live.port, '/'), 'the live board was touched');
  });

/* the gate that decides who may point the one machine-wide task takes
   the store root by exact compare. */
test('the live-root gate accepts the store root and refuses any other path', () => {
  const home = () => 'C:/Users/nobody';
  assert.equal(isLiveRoot('C:/Users/nobody/.claude/askerdo', home), true);
  /* a Windows path is case-insensitive and takes either separator */
  assert.equal(isLiveRoot('C:\\Users\\nobody\\.claude\\AskerDo', home), true);
  assert.equal(isLiveRoot('C:/Users/nobody/.claude/somewhere-else', home), false);
  assert.equal(isLiveRoot('C:/Users/someone-else/.claude/askerdo', home), false);
});

/* ---- the SID's command, and prove before stop --------------------- */

/* WINDOWS' OWN whoami, BY ITS PATH: Git Bash puts /usr/bin first, so a bare
   `whoami` there is MSYS coreutils' and prints no SID. The command
   is PINNED RATHER THAN RUN, off a sandbox SystemRoot. */
test('the SID reader names Windows own whoami under SystemRoot, and the bare name only without one', () => {
  const fake = join(tempDir('nd-board-'), 'Windows');
  const had = Object.prototype.hasOwnProperty.call(process.env, 'SystemRoot');
  const before = process.env.SystemRoot;
  try {
    process.env.SystemRoot = fake;
    assert.equal(whoamiCommand(), join(fake, 'System32', 'whoami.exe'));
    delete process.env.SystemRoot;
    assert.equal(whoamiCommand(), 'whoami', 'the bare name is the fallback and only that');
  } finally {
    if (had) process.env.SystemRoot = before;
    else delete process.env.SystemRoot;
  }
});

/* AND THE READER NEVER FALLS BACK TO THE PATH, which is the bug itself: with
   SystemRoot pointed at a directory holding no whoami.exe the read comes back
   empty and the register is refused, rather than finding this machine's own. */
test('a whoami that is not under SystemRoot is a failed read, never a PATH fallback', async () => {
  const sb = await mint();
  const task = taskRunner();
  const fake = join(tempDir('nd-board-'), 'Windows');
  const hadSid = Object.prototype.hasOwnProperty.call(process.env, 'ASKERDO_SID');
  const sidBefore = process.env.ASKERDO_SID;
  const hadRoot = Object.prototype.hasOwnProperty.call(process.env, 'SystemRoot');
  const rootBefore = process.env.SystemRoot;
  let r = null;
  try {
    process.env.SystemRoot = fake;
    delete process.env.ASKERDO_SID;
    r = await ensureBoardServer(sb.root, { run: task.run, waitMs: 300, home: () => sb.home });
  } finally {
    if (hadRoot) process.env.SystemRoot = rootBefore;
    else delete process.env.SystemRoot;
    if (hadSid) process.env.ASKERDO_SID = sidBefore;
  }
  assert.equal(r.status, 'failed');
  assert.match(r.detail, /the user SID could not be read/);
  assert.deepEqual(task.verbs(), ['/query'], 'nothing was written and nothing was run');
  assert.deepEqual(task.docs, []);
  await assert.rejects(raw(sb.port, '/'), 'a board was started anyway');
});

/* THE ORDER: READ AND PROVE, THEN STOP. A verb that stopped the running board and
   only then found the register could not proceed would leave the machine with no
   board at all until it was run again from another shell. */
test('a register that cannot proceed leaves the running board alone', { timeout: 20000 }, async (t) => {
  const sb = await mint();
  /* a STALE instance, so the ensure is on the replace path and the stop is the
     next thing it would have done */
  const old = start(t, sb, { ASKERDO_BOARD_VERSION: '0.0.1' });
  await old.line;
  const task = taskRunner();
  const r = await ensureBoardServer(sb.root, {
    run: task.run, sid: () => null, waitMs: 300, home: () => sb.home,
  });
  assert.equal(r.status, 'failed');
  assert.match(r.detail, /the user SID could not be read/);
  assert.deepEqual(task.verbs(), ['/query'], 'the read-compare is all that ran');

  /* THE STOP NEVER LANDED: the old instance is alive, still holds the port,
     and still answers with the version it booted with */
  assert.equal(old.proc.exitCode, null, 'the running board was stopped for a register that failed');
  const ping = await raw(sb.port, '/' + sb.secret + '/ping', { method: 'POST' });
  assert.equal(ping.status, 204);
  assert.equal(ping.headers['x-askerdo-board'], '0.0.1');
  assert.equal((await fetch(sb.base + '/')).status, 200);
});

/* And the same order on the arm that is NOT about the SID: a root that may not
   write the register is refused with the old board still serving. */
test('a store that may not register is refused before the running board is stopped',
  { timeout: 20000 }, async (t) => {
    const live = await mint();
    const copy = await mint();
    const old = start(t, copy, { ASKERDO_BOARD_VERSION: '0.0.1' });
    await old.line;
    const task = taskRunner();
    const r = await ensureBoardServer(copy.root, {
      run: task.run, sid: task.sid, waitMs: 300, home: () => live.home,
    });
    assert.equal(r.status, 'failed');
    assert.match(r.detail, /not the live store root/);
    assert.deepEqual(task.verbs(), ['/query']);
    assert.equal(old.proc.exitCode, null, 'the copy stopped a board it could not replace');
    const ping = await raw(copy.port, '/' + copy.secret + '/ping', { method: 'POST' });
    assert.equal(ping.headers['x-askerdo-board'], '0.0.1');
  });

/* AND THE WRITE ITSELF IS AHEAD OF THE STOP: `schtasks /create` rewrites the register
   alone, so the create is free to fail with that board still up. Registered after the
   stop, a denied create would leave the machine with no board. */
test('a create that fails on the replace path leaves the stale board serving',
  { timeout: 20000 }, async (t) => {
    const sb = await mint();
    const old = start(t, sb, { ASKERDO_BOARD_VERSION: '0.0.1' });
    await old.line;
    const task = taskRunner({ create: { code: 1, stdout: '', stderr: 'ERROR: Access is denied.' } });
    const r = await ensureBoardServer(sb.root, {
      run: task.run, sid: task.sid, waitMs: 300, home: () => sb.home,
    });
    assert.equal(r.status, 'failed');
    assert.match(r.detail, /could not be registered/);
    assert.match(r.detail, /schtasks \/create exited 1/);
    assert.match(r.detail, /Access is denied/, 'the scheduler\'s own first line');

    /* THE ARGV: the create was issued, and it was issued before anything was
       stopped, because the run was never reached at all */
    assert.deepEqual(task.verbs(), ['/query', '/query', '/create'], 'the run is never reached');
    assert.equal(existsSync(task.xmlFiles[0]), false, 'and the temp XML still does not survive');

    /* AND THE STOP NEVER LANDED: the stale instance is alive, still holds the
       port, and still answers with the build it booted with */
    assert.equal(old.proc.exitCode, null, 'a board was stopped for a register that failed');
    const ping = await raw(sb.port, '/' + sb.secret + '/ping', { method: 'POST' });
    assert.equal(ping.status, 204);
    assert.equal(ping.headers['x-askerdo-board'], '0.0.1');
    assert.equal((await fetch(sb.base + '/')).status, 200);
  });

/* THE WHOLE ORDER ON THE ARM THAT SUCCEEDS: query, create, stop, run. The stop
   is an HTTP call and never an argv entry, so the two halves are pinned from
   opposite sides: the schtasks calls, and the replacement's banner. */
test('a successful replace writes the register before the stop and runs the task after',
  { timeout: 20000 }, async (t) => {
    const sb = await mint();
    const old = start(t, sb, { ASKERDO_BOARD_VERSION: '0.0.1' });
    await old.line;
    /* a STALE action, so the plan really carries a document and the replace
       path really issues a /create */
    const older = {
      command: 'C:\\cache\\askerdo-0.0.1\\assets\\askerdo-tray.exe',
      args: ['--serve', '--root', sb.root],
    };
    let fresh = null;
    const task = taskRunner({ current: older, onRun: () => { fresh = start(t, sb); } });
    const alive = [];
    const run = (args) => {
      alive.push([args[0], old.proc.exitCode === null]);
      return task.run(args);
    };
    const r = await ensureBoardServer(sb.root, { run, sid: task.sid, home: () => sb.home });
    t.after(async () => { try { await fetch(sb.base + '/stop', { method: 'POST' }); } catch {} });
    assert.equal(r.status, 'replaced');
    assert.deepEqual(task.verbs(), ['/query', '/query', '/create', '/run']);
    assert.deepEqual(alive.slice(0, 3), [['/query', true], ['/query', true], ['/create', true]],
      'the register was read and written while the stale instance was still serving');
    assert.deepEqual(parseAction(task.docs[0].text), wantedAction(sb.root),
      'the new action names this checkout, not the one the task carried');
    assert.equal(await old.closed, 0, 'the stale instance stopped itself');

    /* AND THE RUN CAME AFTER THE STOP: a task run while the stale instance
       still held the port would have ADOPTED it and said so, so a replacement
       that BOUND the port is the proof the secret /stop landed first. */
    await fresh.line;
    assert.ok(!fresh.stdout().includes('adopted'),
      'the identity port was free when the task ran: ' + JSON.stringify(fresh.stdout()));
    const after = await raw(sb.port, '/' + sb.secret + '/ping', { method: 'POST' });
    assert.equal(after.status, 204);
    assert.equal(after.headers['x-askerdo-board'], version);
    assert.equal((await fetch(sb.base + '/')).status, 200);
  });

/* THE MECHANICAL GUARD ON NO FALLBACK SPAWN, in the shape test/tray.test.mjs uses for
   PowerShell: the scan is over CODE with comments stripped, because the header names
   the retired spawn on purpose. */
test('nothing on the board path spawns a server any more', () => {
  const src = readFileSync(join(pluginRoot, 'lib', 'board-ensure.mjs'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!code.includes('board-server'), 'the ensure still names the server script');
  assert.ok(!/[^A-Za-z]spawn\s*\(/.test(code), 'the ensure still spawns something itself');
  assert.ok(!code.includes('detached'), 'nothing here is detached any more: the task is');
  assert.ok(code.includes('spawnSync('), 'the one runner it does have is synchronous');
  /* and the module it delegates the document to runs nothing at all */
  const pure = readFileSync(join(pluginRoot, 'lib', 'board-task.mjs'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const forbidden of ['child_process', 'spawn', 'node:fs', 'node:os', 'process.env']) {
    assert.ok(!pure.includes(forbidden), 'lib/board-task.mjs names ' + forbidden);
  }
});

/* The tray's readings end to end off the board's cache: the dot on the ping
   header the tray reads, the counts and both lists on the stream. */
test('the tray dot, counts and both lists follow the board', async (t) => {
  const { verb, env } = await onBoard(t);
  const sb = await mint();
  await start(t, sb, { ...env, ASKERDO_WATCH_MS: '100', ASKERDO_BEAT_MS: '4000' }).line;
  const dot = async (want) => {
    let last = null;
    await pollUntil(async () => {
      last = (await raw(sb.port, '/' + sb.secret + '/ping', { method: 'POST' })).headers['x-askerdo-dot'];
      return last === want;
    });
    return last;
  };
  assert.ok(await boardLoaded(sb));
  assert.equal(await dot('quiet'), 'quiet', 'nothing open: no dot at all');
  const es = stream(t, sb);
  assert.ok(await es.waitFor(() => es.of('hello')[0]));

  const q1 = await verb('register', asked({ name: 'the blocker' }), { session: 'sess-a' });
  assert.equal(await dot('blocking'), 'blocking');
  const one = await es.waitFor(() => es.of('change').find((e) => e.tray.blocking === 1));
  assert.deepEqual(one.tray.questions.map((q) => q.id), [q1.id]);
  assert.deepEqual(Object.keys(one.tray.questions[0]).sort(), ['id', 'key', 'name']);
  assert.deepEqual(one.tray.waitingQuestions, [], 'nothing waiting is an empty second list');

  const q2 = await verb('register', asked({ name: 'a waiting one', blocking: false }), { session: 'sess-a' });
  const two = await es.waitFor(() => es.of('change').find((e) => e.tray.waiting === 1));
  assert.deepEqual(two.tray.waitingQuestions.map((q) => q.id), [q2.id]);
  assert.deepEqual(two.tray.questions.map((q) => q.id), [q1.id], 'and the first list did not move');

  /* answered leaves the corner: only OPEN questions count */
  await verb('answer', { id: q1.id, pick: 'a' }, { user: true });
  assert.equal(await dot('waiting'), 'waiting');
});

/* The ping is the liveness wire the tray's self-reap and the handshake key on,
   so a board that never answers gets no vote on it. */
test('the ping answers 204 from the cache even when the board never answers', { timeout: 20000 }, async (t) => {
  const hung = createServer(() => {});
  await new Promise((ok) => hung.listen(0, '127.0.0.1', ok));
  t.after(() => { try { hung.closeAllConnections(); hung.close(); } catch {} });
  const sb = await mint();
  const srv = start(t, sb, { ASKERDO_BOARD_URL: 'http://127.0.0.1:' + hung.address().port, ASKERDO_BOARD_TOKEN: 'x' });
  assert.equal(await srv.line, 'http://askerdo.localhost:' + sb.port + '/' + sb.secret + '/');
  for (let i = 0; i < 3; i++) {
    const ping = await raw(sb.port, '/' + sb.secret + '/ping', { method: 'POST' });
    assert.equal(ping.status, 204, 'ping ' + i);
    assert.equal(ping.headers['x-askerdo-board'], version, 'the handshake is untouched');
    assert.equal(ping.headers['x-askerdo-dot'], 'quiet', 'the seeded cache, and nothing else');
  }
  assert.equal(srv.proc.exitCode, null);
});

/* Pinned in the source, the standing pattern for wiring with no seam of its own:
   the ping reads nothing, and the corner and its count are set together. */
test('the ping reads nothing, and the tray readings are set together off the board cache', () => {
  const src = readFileSync(boardScript, 'utf8');
  const body = (name) => {
    const at = src.indexOf('\nfunction ' + name + '(');
    assert.ok(at > 0, name + ' is not a function here any more');
    const end = src.indexOf('\n}\n', at);
    assert.ok(end > at, name);
    return src.slice(at, end);
  };
  assert.ok(/\nlet dotCache = 'quiet';/.test(src), 'the cache starts on the quiet face');
  const ping = body('ping');
  assert.ok(ping.includes("'x-askerdo-dot': dotCache"), 'the header IS the cache');
  assert.ok(!/cache\.read|localBoard|Snapshot/.test(ping), 'and the ping waits on no read');
  const sync = body('syncTray');
  assert.ok(sync.includes('localBoard.tray()'), 'the readings come off the board cache');
  assert.ok(sync.includes('dotCache = t.dot;') && sync.includes('blockingCache = t.blocking;'),
    'the corner and its count are set together (Gate B observation 6)');
  /* the sweep: unconditional, synchronous, ahead of the spawn */
  const channel = body('startChannel');
  assert.ok(channel.includes('tray.sweep();'));
  assert.ok(channel.indexOf('tray.sweep();') < channel.indexOf('spawnTray'), 'the sweep runs before the spawn');
  assert.ok(!/if \(stopping[\s\S]*tray\.sweep\(\)/.test(channel), 'and never behind the stopping gate');
  assert.ok(body('spawnTray').includes('if (stopping || !tray) return;'), 'which the spawn keeps');
  /* THE ONE WATCHER is started by announce, on every host */
  assert.ok(body('announce').includes('watchTimer = setInterval(watchTick, WATCH_MS);'));
  assert.ok(!channel.includes('setInterval(watchTick'), 'and the alert channel does not own the timer');
});

/* A rename or a typo in one of these six names would fall back to another face in
   silence, which is exactly the failure these pins exist to catch: the corner would
   simply stop telling the truth. */
/* SIX FACES, COMPILED INTO THE EXE: the server names none, so the pin is on where
   they live: three for a dark taskbar, three for a light one, plus app.ico. */
test('the server names no icon face, the exe carries all six, and each is committed', () => {
  const src = readFileSync(boardScript, 'utf8');
  assert.deepEqual(src.match(/[a-z][a-z0-9-]*\.ico/g) || [], [],
    'the board server still resolves an icon path for a tray to load');
  const rust = readFileSync(join(pluginRoot, 'tray', 'src', 'tray.rs'), 'utf8');
  const named = (rust.match(/tray-[a-z-]*\.ico/g) || []);
  assert.deepEqual([...named].sort(), [
    'tray-blocking.ico', 'tray-light-blocking.ico', 'tray-light-quiet.ico',
    'tray-light-waiting.ico', 'tray-quiet.ico', 'tray-waiting.ico',
  ]);
  /* each set in the Dot order (waiting, quiet, blocking) and each face wired to
     its OWN file, not two faces to one: the arrays are read in order, so the
     order in the source IS the order the states index into */
  const arrayOf = (name) => {
    const from = rust.indexOf('pub const ' + name);
    assert.ok(from >= 0, name);
    const to = rust.indexOf('\n];', from);
    return (rust.slice(from, to).match(/tray-[a-z-]*\.ico/g) || []);
  };
  assert.deepEqual(arrayOf('ART_DARK'),
    ['tray-waiting.ico', 'tray-quiet.ico', 'tray-blocking.ico']);
  assert.deepEqual(arrayOf('ART_LIGHT'),
    ['tray-light-waiting.ico', 'tray-light-quiet.ico', 'tray-light-blocking.ico']);
  for (const name of named) {
    assert.ok(existsSync(join(pluginRoot, 'assets', name)), 'assets/' + name + ' is not committed');
  }

  /* the identity's own mark, named once in main.rs and embedded once by the
     build script, and both of them the same committed file */
  const main = readFileSync(join(pluginRoot, 'tray', 'src', 'main.rs'), 'utf8');
  assert.match(main, /ICON_FILE: &str = "app\.ico"/);
  const build = readFileSync(join(pluginRoot, 'tray', 'build.rs'), 'utf8');
  assert.match(build, /set_icon\("\.\.\/assets\/app\.ico"\)/);
  assert.ok(existsSync(join(pluginRoot, 'assets', 'app.ico')));
});

/* The taskbar theme is the ONE thing that picks a face set, read from the
   system's own setting and not from the board: a single .ico does not recolour
   itself. Pinned here because the rule is a design decision, not a detail. */
test('the tray reads the SYSTEM theme for its faces, never the apps one and never the board', () => {
  const registry = readFileSync(join(pluginRoot, 'tray', 'src', 'registry.rs'), 'utf8');
  assert.match(registry,
    /Software\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Themes\\\\Personalize/);
  assert.match(registry, /read_dword\(guard\.0, "SystemUsesLightTheme"\)/);
  const code = registry.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/AppsUseLightTheme/.test(code), 'the apps theme is not the taskbar theme');

  const rust = readFileSync(join(pluginRoot, 'tray', 'src', 'tray.rs'), 'utf8');
  assert.match(rust, /icon::taskbar_from\(registry::system_uses_light_theme\(\)\)/);
  /* and the re-read is on the shell's colour broadcast, not on a timer */
  assert.match(rust, /names_the_colour_set/);
  assert.ok(!/setInterval|Duration::from_/.test(rust), 'no timer polls the theme');
});

/* ---- the work surface ------------------------------------ */

/* ---- the answer-bar api ----------------------------------------- */

const post = (url, body) => fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

/* fetch cannot report a response that arrives while the server is hanging up
   on an oversized upload; a raw request can. */
function rawPost(port, path, body) {
  return new Promise((resolve) => {
    const req = httpRequest({
      host: '127.0.0.1', port, path, method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { text += d; });
      res.on('end', () => resolve({ status: res.statusCode, body: text }));
    });
    req.on('error', () => resolve({ status: 0, body: '' }));
    req.end(body);
  });
}

/* ---- the file viewer (docs/file-refs-spec.md section 3) ---------------- */

/* TWO records whose refs cover the shapes the f/ routes must tell apart, over
   five REAL files: the sibling makes authority a reachability question, and the
   second record makes it a per-record one. Real temp paths on either platform. */
async function seedRefs(t, verb) {
  const docs = tempDir('nd-refs-', t);
  const named = join(docs, 'spec.md');
  const sibling = join(docs, 'sibling.md');
  const binary = join(docs, 'blob.dat');
  const big = join(docs, 'big.txt');
  const other = join(docs, 'other.md');
  /* CRLF and multi-byte text on purpose, written as escapes so this file stays
     ASCII: the raw route promises EXACT bytes and a byte COUNT, and both are
     what a decode-and-re-encode or a character count would quietly change */
  writeFileSync(named, '# spec\n\ntwo lines and a trailing newline\r\n'
    + 'caf\u00e9 \u65e5\u672c\u8a9e \ud83d\ude00\n');
  writeFileSync(sibling, 'the sibling nothing refs\n');
  writeFileSync(binary, Buffer.from([0x41, 0x00, 0x42]));
  writeFileSync(big, 'x'.repeat(1048577));
  writeFileSync(other, 'the file the second record names\n');
  /* index 0 is the file, 1 a work id, 2 the binary, 3 the oversize one, and 4
     a plainly synthetic path on a drive letter no machine has */
  const rec = await verb('createRecord', {
    kind: 'task', name: 'refs demo', description: 'A record with refs.',
    refs: [named, 'WS-9', binary, big, 'X:/no-such-root/missing.md'],
  });
  /* a NON-TASK kind, so the routes are exercised on more than one prefix, and
     the three shapes that are not openable: a UNC path, a slash-rooted one, and
     a relative one naming a file that really does exist under the server's cwd */
  const ws = await verb('createRecord', {
    kind: 'workstream', name: 'refs demo scope', description: 'A second record, naming a file of its own.',
    refs: [other, '\\\\synthetic-host\\share\\notes.md', '//synthetic-host/share/notes.md',
      'assets/house.css'],
  });
  return { docs, named, sibling, binary, big, other, rec, ws };
}

test('the file viewer page carries metadata and never one byte of the file', async (t) => {
  const board = await onBoard(t);
  const sb = await mint();
  const { named, rec } = await seedRefs(t, board.verb);
  const srv = await startOn(t, sb, board);

  const res = await fetch(sb.base + '/f/' + rec.id + '/0');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(res.headers.get('access-control-allow-origin'), null);
  const body = await res.text();
  /* the path the record named, said once, and the record it belongs to */
  assert.ok(body.includes('<p class="rv-path">' + named.replace(/&/g, '&amp;') + '</p>'), body.slice(0, 400));
  assert.ok(body.includes('href="/' + sb.secret + '/r/' + (rec.key || rec.id) + '"'), 'the way back');
  assert.ok(body.includes('ref 1 of 5'));
  /* the raw URL the page script fetches, minted by the server off the record
     and the index and never off the path */
  assert.ok(body.includes('"raw":"/' + sb.secret + '/f/' + rec.id + '/0/raw"'));
  /* the client stack, from the shared asset routes rather than from anywhere
     else: a viewer that reached a CDN would be a remote fetch this page has
     promised never to make */
  for (const asset of ['markdown-it.min.js', 'purify.min.js', 'highlight.min.js']) {
    assert.ok(body.includes('src="/' + sb.secret + '/assets/' + asset + '"'), asset);
  }
  /* and the whole point: the file's own text is nowhere on the page */
  assert.ok(!body.includes('two lines and a trailing newline'), 'no file content is baked in');

  /* a ref whose file is GONE still renders a page: the client's own 404 is
     what turns it into the named-here-not-found-now block */
  assert.equal((await fetch(sb.base + '/f/' + rec.id + '/4')).status, 200);
});

test('the raw route serves exact bytes and refuses everything that is not a served file', async (t) => {
  const board = await onBoard(t);
  const sb = await mint();
  const { named, rec } = await seedRefs(t, board.verb);
  const srv = await startOn(t, sb, board);
  const at = (n, tail = '/raw') => sb.base + '/f/' + rec.id + '/' + n + tail;

  const ok = await fetch(at(0));
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('content-type'), /^text\/plain; charset=utf-8$/);
  assert.equal(ok.headers.get('cache-control'), 'no-store');
  assert.equal(ok.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(ok.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(ok.headers.get('access-control-allow-origin'), null);
  const bytes = readFileSync(named);
  assert.deepEqual(Buffer.from(await ok.arrayBuffer()), bytes, 'byte for byte');
  /* CRLF survived the round trip, and so did every multi-byte character: this
     route ships a file, it does not normalize one */
  assert.ok(bytes.includes('\r\n'), 'the fixture really carries a CRLF');
  assert.ok(bytes.length > bytes.toString('utf8').length, 'and really is multi-byte');
  /* the length header is the BYTE count, which is the number the viewer's
     rich-render cap measures against; a character count would under-report this
     very file */
  assert.equal(Number(ok.headers.get('content-length')), bytes.length);

  /* a ref that is not a path is not a file: a work id holds its position in
     the list and resolves to nothing */
  assert.equal((await fetch(at(1))).status, 404);
  /* text only, and size-capped, each with its own status so the page can say
     which one happened rather than "something went wrong" */
  assert.equal((await fetch(at(2))).status, 415);
  const capped = await fetch(at(3));
  assert.equal(capped.status, 413);
  /* a refusal keeps the posture every other answer here keeps */
  assert.match(capped.headers.get('content-type'), /^text\/plain; charset=utf-8$/);
  assert.equal(capped.headers.get('cache-control'), 'no-store');
  assert.equal(capped.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(capped.headers.get('referrer-policy'), 'no-referrer');
  /* named here, not there now */
  assert.equal((await fetch(at(4))).status, 404);
  /* past the end of the list */
  assert.equal((await fetch(at(5))).status, 404);
  /* the two closed shapes: a work token and a small non-negative integer in its
     ONE spelling, so 0 is an index and 00 is not a URL */
  for (const bad of ['-1', '1.0', '0x0', '00', '01', '00000', 'a', '']) {
    assert.equal((await fetch(at(bad))).status, 404, 'index ' + JSON.stringify(bad));
  }
  for (const bad of ['T-', 'Q', 'Q-1', 'Q1x', 'WS-9x', '..']) {
    assert.equal((await fetch(sb.base + '/f/' + bad + '/0/raw')).status, 404, bad);
  }
  /* two segments is the page and three ending in raw is the bytes; there is no
     fourth shape, so a deeper URL is not a deeper read */
  assert.equal((await fetch(at(0, ''))).status, 200);
  assert.equal((await fetch(at(0, '/raw/more'))).status, 404);
  assert.equal((await fetch(at(0, '/bytes'))).status, 404);
  assert.equal((await fetch(sb.base + '/f/' + rec.id)).status, 404);
  assert.equal((await fetch(sb.base + '/f/')).status, 404);
  /* and the route is GET, like every other read here */
  assert.equal((await raw(sb.port, '/' + sb.secret + '/f/' + rec.id + '/0/raw', { method: 'POST' })).status, 404);
});

/* The redline said out loud (spec section 6): the refs list is the ONLY path
   authority. There is no path parameter to traverse out of, so this proves both
   sides: a file beside a served one is unreachable until the record names it. */
test('the refs list is the only path authority, and a sibling file is unreachable', async (t) => {
  const board = await onBoard(t);
  const sb = await mint();
  const { named, sibling, other, rec, ws } = await seedRefs(t, board.verb);
  const srv = await startOn(t, sb, board);
  const secretText = readFileSync(sibling, 'utf8');

  /* the posture first: a stranger's secret and a wrong Host are flat 404s on
     both shapes, exactly as on every other route */
  const wrong = 'http://127.0.0.1:' + sb.port + '/deadbeefdeadbeefdeadbeefdeadbeef';
  for (const tail of ['/f/' + rec.id + '/0', '/f/' + rec.id + '/0/raw']) {
    const bad = await fetch(wrong + tail);
    assert.equal(bad.status, 404, tail);
    assert.equal(await bad.text(), 'not found\n');
    assert.equal((await raw(sb.port, '/' + sb.secret + tail, { host: 'attacker.example' })).status, 404, tail);
  }

  /* every crafted shape that tries to name a path, raw so the client never
     normalizes it away. None of them is even a route: the index segment is a
     closed integer and the id segment a closed token. */
  const crafted = [
    '/f/' + rec.id + '/0/../sibling.md/raw',
    '/f/' + rec.id + '/0%2f..%2fsibling.md/raw',
    '/f/' + rec.id + '/..%2fsibling.md/raw',
    '/f/' + rec.id + '/' + encodeURIComponent(sibling) + '/raw',
    '/f/' + encodeURIComponent(sibling) + '/0/raw',
    '/f/' + rec.id + '/0/raw?path=' + encodeURIComponent(sibling),
  ];
  for (const path of crafted) {
    const r = await raw(sb.port, path);
    assert.notEqual(r.status, 200, path);
    assert.ok(!r.body.includes(secretText.trim()), path);
  }
  /* and no index of this record reaches it either: five refs, and the sibling
     is in none of them. The COUNT is asserted too, so this loop can never pass
     by finding nothing to check. */
  const namedText = readFileSync(named, 'utf8');
  let served = 0;
  for (let i = 0; i < 8; i++) {
    const r = await fetch(sb.base + '/f/' + rec.id + '/' + i + '/raw');
    if (r.status !== 200) continue;
    served += 1;
    assert.equal(await r.text(), namedText, 'index ' + i);
  }
  assert.equal(served, 1, 'exactly one index of this record serves bytes');

  /* the authority is THIS record's list and not the store's. A second record
     names a file of its own, and each record serves its own file at its own
     URL: an index is a position in one list, never a key into every list. */
  const otherText = readFileSync(other, 'utf8');
  assert.notEqual(otherText, namedText, 'the two files differ, so serving one is not serving the other');
  const second = await fetch(sb.base + '/f/' + ws.id + '/0/raw');
  assert.equal(second.status, 200, 'the workstream serves its own ref');
  assert.equal(await second.text(), otherText);
  const first = await fetch(sb.base + '/f/' + rec.id + '/0/raw');
  assert.equal(await first.text(), namedText, 'and the task still serves its own');
  /* the workstream names ONE openable file, so the task's longer list does not
     extend it: every position past its own is a 404, not another record's ref */
  for (const i of [4, 5, 6]) {
    assert.equal((await fetch(sb.base + '/f/' + ws.id + '/' + i + '/raw')).status, 404, 'ws index ' + i);
  }

  /* the positive control, which is what makes the negative mean something: the
     check is the LIST, so the sibling serves the moment the record names it,
     and nothing else about the server changed to allow it */
  await board.verb('editRecord', { id: rec.id, addRef: [sibling] });
  let nowServed = null;
  assert.ok(await pollUntil(async () => (nowServed = await fetch(sb.base + '/f/' + rec.id + '/5/raw')).status === 200));
  assert.equal(await nowServed.text(), secretText);
});

/* The shapes lib/record-refs.mjs refuses to call paths, checked at the route. A
   UNC ref is the reason the rule exists: opening one has this synchronous server
   reach a remote host. A slash-rooted ref is left out: its reading is platform. */
test('a UNC ref and a relative ref are shapes this board never opens', async (t) => {
  const board = await onBoard(t);
  const sb = await mint();
  const { ws } = await seedRefs(t, board.verb);
  const srv = await startOn(t, sb, board);

  /* index 0 of this same record IS served, so a refusal at 1, 2, and 3 is about
     the shape of those refs and not about the record or the route */
  assert.equal((await fetch(sb.base + '/f/' + ws.id + '/0/raw')).status, 200);
  for (const n of [1, 2, 3]) {
    assert.equal((await fetch(sb.base + '/f/' + ws.id + '/' + n)).status, 404, 'page ' + n);
    assert.equal((await fetch(sb.base + '/f/' + ws.id + '/' + n + '/raw')).status, 404, 'raw ' + n);
  }
  /* the relative one is a REAL file: it exists under the cwd the server was
     started in, which is what makes its refusal a decision rather than a miss */
  assert.ok(existsSync(join(pluginRoot, 'assets', 'house.css')));
  assert.equal(srv.proc.exitCode, null);
});

/* A board gone offline: the tray menu keeps the recent list it knew (open work
   resolves off the cache), and a record the cache cannot answer answers both f/
   shapes in text, never in a page the viewer script would render AS the file. */
test('a board gone offline keeps the recent list, and an uncached f/ answers in text', async (t) => {
  const board = await onBoard(t);
  const sb = await mint();
  const { rec } = await seedRefs(t, board.verb);
  const { q } = await seedEvidence(t, board.verb);
  const tools = openEnv(t, { ASKERDO_WATCH_MS: '100', ASKERDO_BEAT_MS: '4000' });
  await startOn(t, sb, board, tools.env, [...trayNoOpen(), ...openOnWin()]);
  const warm = await trayOn(t, sb);
  assert.equal((await post(sb.base + '/f/' + rec.id + '/0/open', { kind: 'open' })).status, 200);
  assert.ok(await warm.waitFor(() => warm.of('change').find((e) => e.tray.recent.length === 1)));

  await board.b.close();
  assert.ok(await pollUntil(async () => {
    try { return (await (await fetch(sb.base + '/local/state')).json()).result.offline === true; } catch { return false; }
  }), 'the local board saw the board go');
  const cold = stream(t, sb);
  const held = await cold.waitFor(() => cold.of('hello')[0]);
  assert.deepEqual(held.tray.recent, [{ id: rec.id, index: 0, name: 'spec.md' }], 'the last list it knew');

  const bytes = await fetch(sb.base + '/f/' + q.id + '/0/raw');
  assert.equal(bytes.status, 503, 'a board that would not answer is not a served file');
  assert.match(bytes.headers.get('content-type'), /^text\/plain; charset=utf-8$/);
  assert.equal(bytes.headers.get('cache-control'), 'no-store');
  assert.ok(!(await bytes.text()).includes('<!doctype html'), 'never a document');
  const page = await fetch(sb.base + '/f/' + q.id + '/0');
  assert.equal(page.status, 503);
  assert.match(page.headers.get('content-type'), /^text\/plain; charset=utf-8$/);
});

/* ---- the snapshot cache, the fragment route, the events channel --- */

/* One HELD event stream, read frame by frame. The route never ends, so nothing
   here awaits the response: `frames` is what has arrived so far and `waitFor` is
   a deadline over it. */
function stream(t, sb, path = '/api/events', headers = {}) {
  const frames = [];
  let raw = '';
  const req = httpRequest({
    host: '127.0.0.1', port: sb.port, path: '/' + sb.secret + path, method: 'GET', headers,
  });
  const head = new Promise((resolve, reject) => {
    req.on('response', (res) => {
      res.setEncoding('utf8');
      res.on('data', (d) => {
        raw += d;
        let cut = raw.indexOf('\n\n');
        while (cut >= 0) {
          frames.push(raw.slice(0, cut));
          raw = raw.slice(cut + 2);
          cut = raw.indexOf('\n\n');
        }
      });
      resolve(res);
    });
    req.on('error', reject);
  });
  req.end();
  t.after(() => { try { req.destroy(); } catch { /* already gone */ } });
  const of = (name) => frames.filter((f) => f.startsWith('event: ' + name + '\n'))
    .map((f) => JSON.parse(f.slice(f.indexOf('\ndata: ') + '\ndata: '.length)));
  return {
    head,
    frames,
    of,
    beats: () => frames.filter((f) => f.startsWith(': ')),
    close: () => req.destroy(),
    async waitFor(check, capMs = 15000) {
      const deadline = Date.now() + capMs;
      for (;;) {
        const hit = check();
        if (hit) return hit;
        if (Date.now() >= deadline) return null;
        await sleep(50);
      }
    },
  };
}

/* THE WIRE ITSELF, with nothing decoding it on the way in: node's own fetch
   asks for gzip and silently inflates what comes back, which is exactly the
   thing these cases are about, so they speak http by hand and keep the bytes. */
function wire(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      host: '127.0.0.1', port, path, method: 'GET', headers,
    }, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => resolve({
        status: res.statusCode, headers: res.headers, buf: Buffer.concat(chunks),
      }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('an asset carries a validator and answers 304', async (t) => {
  const sb = await mint();
  const srv = start(t, sb);
  await srv.line;

  /* A VALIDATOR ON EVERY ASSET: `no-cache` alone tells the browser to revalidate and
     gives it nothing to revalidate with, so every navigation would download every
     asset again. A strong tag and a Last-Modified ride with each. */
  for (const name of ['house.css', 'geist.woff2']) {
    const first = await fetch(sb.base + '/assets/' + name);
    assert.equal(first.status, 200, name);
    const tag = first.headers.get('etag');
    assert.match(tag, /^"[0-9a-f]{16}"$/, name);
    assert.ok(Date.parse(first.headers.get('last-modified')) > 0, name);
    assert.equal(first.headers.get('cache-control'), 'no-cache', name);

    /* the tag is over the CONTENT, so it is the same on the next request */
    const again = await fetch(sb.base + '/assets/' + name);
    assert.equal(again.headers.get('etag'), tag, name);

    const asked = await fetch(sb.base + '/assets/' + name, { headers: { 'If-None-Match': tag } });
    assert.equal(asked.status, 304, name);
    assert.equal(asked.headers.get('etag'), tag, name);
    assert.equal(asked.headers.get('cache-control'), 'no-cache', name);
    assert.equal(asked.headers.get('x-content-type-options'), 'nosniff', name);
    assert.ok(Date.parse(asked.headers.get('last-modified')) > 0, name);
    assert.equal((await asked.text()).length, 0, name + ': a 304 carries no body');
    /* a list is honoured and somebody else's tag is not */
    assert.equal((await fetch(sb.base + '/assets/' + name,
      { headers: { 'If-None-Match': '"deadbeefdeadbeef", ' + tag } })).status, 304, name);
    assert.equal((await fetch(sb.base + '/assets/' + name,
      { headers: { 'If-None-Match': '"deadbeefdeadbeef"' } })).status, 200, name);
  }
});

test('the events stream says hello at once, in the one payload shape', async (t) => {
  const sb = await mint();
  const srv = start(t, sb, { ASKERDO_WATCH_MS: '100' });
  await srv.line;

  const es = stream(t, sb);
  const head = await es.head;
  assert.equal(head.statusCode, 200);
  assert.equal(head.headers['content-type'], 'text/event-stream; charset=utf-8');
  assert.equal(head.headers['cache-control'], 'no-cache');
  assert.equal(head.headers['x-accel-buffering'], 'no');
  assert.equal(head.headers['x-content-type-options'], 'nosniff');
  assert.equal(head.headers['access-control-allow-origin'], undefined);

  const hello = await es.waitFor(() => es.of('hello')[0]);
  assert.ok(hello, 'the hello goes out at once');
  assert.deepEqual(Object.keys(hello).sort(), ['activity', 'activityAt', 'rev', 'tray', 'version']);
  assert.equal(hello.version, version);
});

test('the stream heartbeats, drops a client that left, and is ended by the stop route', async (t) => {
  const { verb, env } = await onBoard(t);
  const sb = await mint();
  const srv = start(t, sb, { ...env, ASKERDO_WATCH_MS: '100', ASKERDO_BEAT_MS: '120' });
  await srv.line;
  assert.ok(await boardLoaded(sb));

  const src = readFileSync(boardScript, 'utf8');
  assert.match(src, /envSeam\('BEAT_MS'\)[\s\S]{0,220}: 20000;/,
    'the shipped heartbeat is one comment line every 20 seconds');
  assert.match(src, /\nconst STREAM_CAP = 64;/, 'and the bounded number of streams');

  const a = stream(t, sb);
  const b = stream(t, sb);
  assert.ok(await a.waitFor(() => a.of('hello')[0]));
  assert.ok(await b.waitFor(() => b.of('hello')[0]));

  /* THE HEARTBEAT: a comment line, which no client parses as an event, so an
     idle stream stays open through anything that times one out */
  assert.ok(await a.waitFor(() => a.beats().length >= 2), 'an idle stream is kept alive');
  assert.ok(a.beats().every((f) => f.startsWith(': ')), 'and it carries no event');
  assert.equal(a.of('change').length, 0, 'a beat is not a change');

  /* one client leaves; the other still hears the next change */
  b.close();
  await sleep(200);
  await verb('register', asked({ name: 'after the drop' }), { session: 'sess-a' });
  assert.ok(await a.waitFor(() => a.of('change')[0]), 'the surviving stream still hears');
  assert.equal(b.of('change').length, 0, 'and the dropped one hears nothing');

  /* the stop route ends every stream before the server goes */
  const ended = new Promise((resolve) => { a.head.then((res) => res.on('end', resolve)); });
  await fetch(sb.base + '/stop', { method: 'POST' });
  await ended;
  assert.equal(await pollUntil(async () => srv.proc.exitCode !== null), true);
});

/* ---- one document, and the timeline on demand -------------------------- */

/* ---- the board surfaces of the opener ---------------------------------- */

test('a folder ref is a refusal and not a missing file, and the viewer page knows it',
  async (t) => {
    const board = await onBoard(t);
    const sb = await mint();
    const { docs } = await seedRefs(t, board.verb);
    const folder = await board.verb('createRecord', {
      kind: 'task', name: 'folder ref', description: 'A record naming a directory.', refs: [docs],
    });
    const srv = await startOn(t, sb, board);

    /* A FOLDER IS A REFUSAL, NOT A 404: a 404 would make the viewer say "it is not
       there now", which is never true of a folder. The record and the ref are both
       real, so it is a refusal. */
    const raw = await fetch(sb.base + '/f/' + folder.id + '/0/raw');
    assert.equal(raw.status, 409);
    assert.match(await raw.text(), /names a folder/);
    assert.match(raw.headers.get('content-type'), /^text\/plain; charset=utf-8$/);
    assert.equal(raw.headers.get('cache-control'), 'no-store');
    assert.equal(raw.headers.get('x-content-type-options'), 'nosniff');
    /* the page is metadata only and never stats, so it renders the same for a folder,
       and the client is what maps the 409 to a folder state */
    const page = await fetch(sb.base + '/f/' + folder.id + '/0');
    assert.equal(page.status, 200);
    const body = await page.text();
    assert.ok(body.includes('if (res.status === 409) {'), 'the viewer knows the state');
    assert.ok(body.includes('names a folder, not a file'), body.slice(0, 200));
    assert.ok(body.includes('data-open-kind="open"'), 'and the row still acts on it');
    /* a file that really is gone keeps its 404 and its red sentence */
    assert.equal((await fetch(sb.base + '/f/' + folder.id + '/9/raw')).status, 404);
    assert.equal(srv.proc.exitCode, null);
  });

/* ---- question evidence on the same routes ------------------------------ */

/* A QUESTION whose EVIDENCE covers the shapes the routes must tell apart, plus a
   second question with none and a sibling nothing names. Evidence entries are
   free strings, which is why the route classifies them rather than trusts them. */
async function seedEvidence(t, verb) {
  const docs = tempDir('nd-ev-', t);
  const named = join(docs, 'proof.md');
  const sibling = join(docs, 'unnamed.md');
  const binary = join(docs, 'blob.dat');
  writeFileSync(named, '# proof\n\nthe lines a cite chip quotes\n');
  writeFileSync(sibling, 'the sibling no question names\n');
  writeFileSync(binary, Buffer.from([0x41, 0x00, 0x42]));
  const q = await verb('register', asked({
    name: 'evidence demo', gist: 'Which file backs the claim?',
    evidence: [named, 'not a path at all', binary, 'X:/no-such-root/missing.md'],
  }), { session: 'sess-a' });
  const bare = await verb('register', asked({
    name: 'nothing cited', gist: 'A question with no evidence at all.',
  }), { session: 'sess-a' });
  return { docs, named, sibling, binary, q, bare };
}

test('a question serves its own evidence on the same f/ page and raw routes', async (t) => {
  const board = await onBoard(t);
  const sb = await mint();
  const { named, q } = await seedEvidence(t, board.verb);
  const srv = await startOn(t, sb, board);

  const res = await fetch(sb.base + '/f/' + q.id + '/0');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('access-control-allow-origin'), null);
  const body = await res.text();
  assert.ok(body.includes('<p class="rv-path">' + named.replace(/&/g, '&amp;') + '</p>'), body.slice(0, 400));
  /* the way back is the QUESTION card, because that is the surface this id
     belongs to: the work surface never renders a question's card */
  assert.ok(body.includes('href="/' + sb.secret + '/r/' + q.key + '"'), 'the way back');
  assert.ok(!body.includes('/w/' + q.id), 'and never the work surface');
  assert.ok(body.includes('ref 1 of 4'), 'the position, in the evidence list as stored');
  assert.ok(body.includes('"raw":"/' + sb.secret + '/f/' + q.id + '/0/raw"'));
  /* the page rule is the page rule whichever list named the file */
  assert.ok(!body.includes('the lines a cite chip quotes'), 'no file content is baked in');

  const bytes = await fetch(sb.base + '/f/' + q.id + '/0/raw');
  assert.equal(bytes.status, 200);
  assert.match(bytes.headers.get('content-type'), /^text\/plain; charset=utf-8$/);
  assert.equal(bytes.headers.get('cache-control'), 'no-store');
  assert.equal(bytes.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(bytes.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(bytes.headers.get('access-control-allow-origin'), null);
  const want = readFileSync(named);
  assert.deepEqual(Buffer.from(await bytes.arrayBuffer()), want, 'byte for byte');
  assert.equal(Number(bytes.headers.get('content-length')), want.length);
  assert.equal(srv.proc.exitCode, null);
});

/* Older evidence lists spell "path (a note)", and looking the whole string up on disk
   would say "named here, not there now" of a file that is there. The retry is in the
   ONE resolution, so the viewer, the raw route, the open route and the allowlist all
   take it. */
test('an annotated evidence entry resolves by its path, and a name in brackets is itself',
  async (t) => {
    const board = await onBoard(t);
    const sb = await mint();
    const docs = tempDir('nd-ev-', t);
    const named = join(docs, 'proof.md');
    const kept = join(docs, 'kept (as is)');
    writeFileSync(named, '# proof\n');
    writeFileSync(kept, 'a file whose own name closes on a bracket\n');
    writeOpenSettings(sb, { editor: SCHEME_EDITOR });
    const q = await board.verb('register', asked({
      name: 'annotated evidence', gist: 'Entries closing on a parenthesis.',
      evidence: [named + ' (the measured run)', kept, named + ':42:7 (a note)',
        join(docs, 'gone.md') + ' (and it is not there)'],
    }), { session: 'sess-a' });
    const tools = openEnv(t);
    const srv = await startOn(t, sb, board, tools.env, [...trayNoOpen(), ...openOnWin()]);
    const es = await trayOn(t, sb);

    /* THE VIEWER shows the path the note was hung on, and the line tail survives
       the strip because the retry runs BEFORE the cut */
    const page = await (await fetch(sb.base + '/f/' + q.id + '/0')).text();
    assert.ok(page.includes('<p class="rv-path">' + named + '</p>'), page.slice(0, 400));
    const spot = await (await fetch(sb.base + '/f/' + q.id + '/2')).text();
    assert.ok(spot.includes('<p class="rv-path">' + named + ':42:7</p>'), spot.slice(0, 400));
    assert.ok(spot.includes('"line":"42"') && spot.includes('"col":"7"'), 'and the two numbers');

    /* THE RAW ROUTE serves the bytes where the whole string would have been a 404 */
    const want = readFileSync(named);
    for (const n of [0, 2]) {
      const bytes = await fetch(sb.base + '/f/' + q.id + '/' + n + '/raw');
      assert.equal(bytes.status, 200, 'position ' + n);
      assert.deepEqual(Buffer.from(await bytes.arrayBuffer()), want, 'position ' + n);
    }
    /* A NAME THAT REALLY CLOSES ON A BRACKET IS ITSELF: the whole spelling is
       stat-ed first, so only a string that cannot be what it says is retried. */
    const asIs = await fetch(sb.base + '/f/' + q.id + '/1/raw');
    assert.equal(asIs.status, 200);
    assert.deepEqual(Buffer.from(await asIs.arrayBuffer()), readFileSync(kept));
    /* and an annotation over a file that is not there is still not there */
    assert.equal((await fetch(sb.base + '/f/' + q.id + '/3/raw')).status, 404);

    /* THE OPEN ROUTE takes the same reading, so the frame names the file and not
       the note, and the allowlist admitted it by the same spelling */
    assert.equal((await post(sb.base + '/f/' + q.id + '/0/open', { kind: 'open' })).status, 200);
    assert.ok(await es.waitFor(() => es.of('open').length > 0));
    assert.deepEqual(es.of('open')[0], { kind: 'open', verb: 'open', path: resolvePath(named) });
    assert.equal(demandCount(tools.demands), 0);
    assert.equal(srv.proc.exitCode, null);
  });

test('every way a question evidence position can miss is the same 404', async (t) => {
  const board = await onBoard(t);
  const sb = await mint();
  const { named, q, bare } = await seedEvidence(t, board.verb);
  const srv = await startOn(t, sb, board);
  const at = (id, n, tail = '/raw') => sb.base + '/f/' + id + '/' + n + tail;

  /* a position holding a string that is no path holds its place and resolves
     to nothing, exactly as a work id sitting in a refs list does */
  assert.equal((await fetch(at(q.id, 1))).status, 404);
  assert.equal((await fetch(at(q.id, 1, ''))).status, 404);
  /* text only, and named here but not found now: both caps are the work path's,
     byte for byte, because there is only one of each */
  assert.equal((await fetch(at(q.id, 2))).status, 415);
  assert.equal((await fetch(at(q.id, 3))).status, 404);
  /* past the end of the evidence list */
  assert.equal((await fetch(at(q.id, 4))).status, 404);
  /* a question carrying NO evidence has no position at all, page or raw */
  for (const n of [0, 1, 2]) {
    assert.equal((await fetch(at(bare.id, n, ''))).status, 404, 'empty page ' + n);
    assert.equal((await fetch(at(bare.id, n))).status, 404, 'empty raw ' + n);
  }
  /* and a question that is not in the store answers exactly as one that is,
     which is what keeps the route from telling a caller which ids exist */
  assert.equal((await fetch(at('Q404', 0))).status, 404);
  assert.equal((await fetch(at('Q404', 0, ''))).status, 404);

  /* the OPEN route runs the same resolution and keeps the same discipline: a
     kind off the list is refused at the door, a page may never name a path, and
     a real evidence position that is not there now is the 409 saying so */
  const open = (id, n, b) => post(sb.base + '/f/' + id + '/' + n + '/open', b);
  assert.equal((await open(q.id, 0, { kind: 'obsidian' })).status, 400);
  assert.equal((await open(q.id, 0, { kind: 'open', path: named })).status, 400);
  assert.equal((await open(q.id, 1, { kind: 'open' })).status, 404);
  assert.equal((await open(q.id, 4, { kind: 'open' })).status, 404);
  assert.equal((await open(bare.id, 0, { kind: 'open' })).status, 404);
  assert.equal((await open('Q404', 0, { kind: 'open' })).status, 404);
  /* the evidence entry naming a drive no machine has: the question and the
     position are both real, so the stat's refusal is a 409 and never a 404 */
  const reached = await open(q.id, 3, { kind: 'open' });
  assert.equal(reached.status, 409, 'the position resolved and the file is not there');
  assert.deepEqual(await reached.json(), { error: 'this was named here, and it is not there now' });
  assert.equal(srv.proc.exitCode, null);
});

/* The redline again, on the second id shape: the named list is the ONLY path
   authority, and the two lists never lend each other a position. */
test('a Q id reaches its own evidence and nothing else', async (t) => {
  const board = await onBoard(t);
  const sb = await mint();
  const { named: qFile, sibling: qSibling, q } = await seedEvidence(t, board.verb);
  const { named: recFile, rec } = await seedRefs(t, board.verb);
  const srv = await startOn(t, sb, board);
  const qText = readFileSync(qFile, 'utf8');
  const recText = readFileSync(recFile, 'utf8');
  const secretText = readFileSync(qSibling, 'utf8');
  assert.notEqual(qText, recText, 'the two files differ, so serving one is not serving the other');

  /* the posture first, on both shapes, exactly as on every other route */
  const wrong = 'http://127.0.0.1:' + sb.port + '/deadbeefdeadbeefdeadbeefdeadbeef';
  for (const tail of ['/f/' + q.id + '/0', '/f/' + q.id + '/0/raw']) {
    const bad = await fetch(wrong + tail);
    assert.equal(bad.status, 404, tail);
    assert.equal(await bad.text(), 'not found\n');
    assert.equal((await raw(sb.port, '/' + sb.secret + tail, { host: 'attacker.example' })).status, 404, tail);
  }

  /* every crafted shape that tries to name a path, sent raw so the client never
     normalizes it away and WITH the secret, so each one fails on being no route
     rather than on the prefix */
  const crafted = [
    '/f/' + q.id + '/0/../unnamed.md/raw',
    '/f/' + q.id + '/0%2f..%2funnamed.md/raw',
    '/f/' + q.id + '/..%2funnamed.md/raw',
    '/f/' + q.id + '/' + encodeURIComponent(qSibling) + '/raw',
    '/f/' + encodeURIComponent(qSibling) + '/0/raw',
    '/f/' + q.id + '/0/raw/../../../../etc/passwd',
  ];
  for (const tail of crafted) {
    const r = await raw(sb.port, '/' + sb.secret + tail);
    assert.notEqual(r.status, 200, tail);
    assert.ok(!r.body.includes(secretText.trim()), tail);
  }
  /* a query string is not a parameter here and never was: it is ignored, and
     the POSITION still decides which file goes out */
  const ignored = await raw(sb.port, '/' + sb.secret + '/f/' + q.id + '/0/raw?path='
    + encodeURIComponent(qSibling));
  assert.equal(ignored.status, 200);
  assert.equal(ignored.body, qText);

  /* no position of this question reaches the sibling either: four entries, and
     the sibling is in none of them. The COUNT is asserted too, so this loop can
     never pass by finding nothing to check. */
  let served = 0;
  for (let i = 0; i < 8; i++) {
    const r = await fetch(sb.base + '/f/' + q.id + '/' + i + '/raw');
    if (r.status !== 200) continue;
    served += 1;
    assert.equal(await r.text(), qText, 'evidence position ' + i);
  }
  assert.equal(served, 1, 'exactly one evidence position serves bytes');

  /* and the two id shapes never lend each other a list: the record's file is at
     no position of the question, and the question's file at no position of the
     record */
  for (let i = 0; i < 8; i++) {
    const fromQ = await fetch(sb.base + '/f/' + q.id + '/' + i + '/raw');
    if (fromQ.status === 200) assert.notEqual(await fromQ.text(), recText, 'q position ' + i);
    const fromRec = await fetch(sb.base + '/f/' + rec.id + '/' + i + '/raw');
    if (fromRec.status === 200) assert.notEqual(await fromRec.text(), qText, 'record position ' + i);
  }
  assert.equal(srv.proc.exitCode, null);
});

/* The parity case: one file named by BOTH lists, which is the shape a cite chip
   and a work ref really do take on the same document. Nothing about the work
   record's routes may move because a question now names its file. */
test('a question naming a record file leaves the work routes byte for byte', async (t) => {
  const board = await onBoard(t);
  const sb = await mint();
  const { named, rec } = await seedRefs(t, board.verb);
  const srv = await startOn(t, sb, board);
  const before = await (await fetch(sb.base + '/f/' + rec.id + '/0')).text();
  const beforeBytes = Buffer.from(await (await fetch(sb.base + '/f/' + rec.id + '/0/raw')).arrayBuffer());
  assert.ok(before.includes('href="/' + sb.secret + '/r/' + (rec.key || rec.id) + '"'), 'the work way back');
  assert.ok(before.includes('ref 1 of 5'));

  const q = await board.verb('register', asked({
    name: 'same file, other list', gist: 'One document, two lists.',
    evidence: ['not a path at all', named],
  }), { session: 'sess-a' });

  assert.equal(await (await fetch(sb.base + '/f/' + rec.id + '/0')).text(), before,
    'the record page is byte for byte what it was');
  assert.deepEqual(Buffer.from(await (await fetch(sb.base + '/f/' + rec.id + '/0/raw')).arrayBuffer()),
    beforeBytes);

  /* and the question serves that same file at ITS OWN position, which is 1 here
     and 0 there: a position is a place in one list, never a key into every list */
  assert.equal((await fetch(sb.base + '/f/' + q.id + '/0/raw')).status, 404);
  const shared = await fetch(sb.base + '/f/' + q.id + '/1/raw');
  assert.equal(shared.status, 200);
  assert.deepEqual(Buffer.from(await shared.arrayBuffer()), beforeBytes);
  const page = await (await fetch(sb.base + '/f/' + q.id + '/1')).text();
  assert.ok(page.includes('ref 2 of 2'), 'the question counts its own list');
  assert.ok(page.includes('href="/' + sb.secret + '/r/' + q.key + '"'));
  assert.equal(srv.proc.exitCode, null);
});

/* ---- open-in (docs/file-refs-spec.md section 4) ----------------- */

/* THE SERVER SPAWNS NOTHING: it writes a FRAME to the tray stream and the exe is the
   one opener, so every case below attaches the stream the exe would hold and reads
   the frames off it. */
async function trayOn(t, sb) {
  const es = stream(t, sb, '/api/events', { 'x-askerdo-tray': await instanceOf(sb) });
  assert.ok(await es.waitFor(() => es.of('hello')[0]), 'the tray stream attached');
  return es;
}

/* THE TRAY THAT CANNOT BE STARTED, AND COUNTS WHAT IT WAS ASKED: the open's own
   demand has no `enabled` gate, so a case with nothing attached would start the
   COMMITTED EXE on a Windows desktop, and no case in this suite may. */
const trayNoOpen = () => shimLib('tray.mjs',
  "import { appendFileSync } from 'node:fs';\n"
  + 'export function createTray(deps) {\n'
  + '  const real = REAL.createTray(deps);\n'
  + '  const out = process.env.ASKERDO_SHIM_DEMANDS;\n'
  + '  return { ...real, start: () => {}, ensureRunning: () => Promise.resolve(false),\n'
  + '    ensureForOpen: () => {\n'
  + '      try { appendFileSync(out, "open\\n"); } catch {}\n'
  + '      return Promise.resolve(false);\n'
  + '    } };\n'
  + '}\n');

/* THE WIN32 BRANCH, forced for a spawned server as channelOn forces the
   notifier's platform: the exe is a Windows binary, so the frame builder answers
   a sentence anywhere else and every shape below dies on a Linux runner. */
const openOnWin = () => shimLib('open-in.mjs',
  'export function openFrame(kind, target, isDir, settings) {\n'
  + "  return REAL.openFrame(kind, target, isDir, settings, 'win32');\n"
  + '}\n');

const demandCount = (file) => {
  try { return readFileSync(file, 'utf8').split('open\n').length - 1; } catch { return 0; }
};

/* A tools file per case, so the demand count and the shim env are one call. */
function openEnv(t, extra = {}) {
  const demands = join(tempDir('nd-shim-', t), 'demands.log');
  writeFileSync(demands, '');
  return { demands, env: { ASKERDO_SHIM_DEMANDS: demands, ...extra } };
}

/* The channel OFF exactly as mint() writes it, plus whatever editor templates
   the case needs: the five booleans stay false so a suite run on a Windows
   desktop raises no alert, and the shims above mean no case starts the exe. */
function writeOpenSettings(sb, extra) {
  writeFileSync(join(sb.root, 'board', 'notify.json'), JSON.stringify({
    enabled: false, woken: false, closed: false, sound: false, tray: false, ...extra,
  }) + '\n');
}

/* A scheme template and a command template, so both halves of the editor kind
   are exercised from one settings file shape. */
const SCHEME_EDITOR = { file: 'editor://open/{path}:{line}:{col}', folder: 'editor://open/{path}/' };
const CMD_EDITOR = { file: '"X:/synthetic/apps/ed.exe" --wait {path}:{line}', folder: '"X:/synthetic/apps/ed.exe" {path}' };

/* A record naming ONE spaced file and ONE folder, which is every shape the
   kind-to-target table needs. The space is deliberate: a command template
   tokenized before the path existed in it cannot split that path in two. */
async function seedOpen(t, verb) {
  const docs = tempDir('nd-open-', t);
  const named = join(docs, 'a spaced name.md');
  const folder = join(docs, 'a folder');
  writeFileSync(named, '# spaced\n');
  mkdirSync(folder, { recursive: true });
  const rec = await verb('createRecord', {
    kind: 'task', name: 'open in demo', description: 'A record naming a file and a folder.', refs: [named, folder],
  });
  return { docs, named: resolvePath(named), folder: resolvePath(folder), rec };
}

test('every kind on a FILE writes its own frame to the tray stream, byte for byte',
  async (t) => {
    const board = await onBoard(t);
    const sb = await mint();
    const { named, rec } = await seedOpen(t, board.verb);
    writeOpenSettings(sb, { editor: SCHEME_EDITOR });
    const tools = openEnv(t);
    const srv = await startOn(t, sb, board, tools.env, [...trayNoOpen(), ...openOnWin()]);
    const es = await trayOn(t, sb);
    const open = (kind) => post(sb.base + '/f/' + rec.id + '/0/open', { kind });
    const up = dirname(named);

    /* THE THREE SHAPES AND NO FOURTH, one row per kind: a verb and a path,
       a scheme url, or a program and an argv ARRAY. */
    const want = [
      ['open', { kind: 'open', verb: 'open', path: named }],
      ['openwith', { kind: 'openwith', verb: 'openas', path: named }],
      /* the reveal opens the PARENT FOLDER through the system handler,
         with no selection, which is the one thing the exe can do everywhere */
      ['reveal', { kind: 'reveal', verb: 'open', path: up }],
      ['editor', { kind: 'editor', url: 'editor://open/' + enc(named) }],
      ['project', { kind: 'project', url: 'editor://open/' + enc(up) + '/' }],
      /* the ONE program name the server puts on the wire, and the store never
         named it: Windows Terminal at the folder */
      ['terminal', { kind: 'terminal', exe: 'wt.exe', args: ['-d', up] }],
      /* the folder and no q=, because a prefilled first message is one the
         board wrote into a session the person did not type */
      ['claude', { kind: 'claude', url: 'claude://code/new?folder=' + encodeURIComponent(up) }],
    ];
    for (let n = 0; n < want.length; n++) {
      const [kind, frame] = want[n];
      const res = await open(kind);
      assert.equal(res.status, 200, kind);
      assert.equal(res.headers.get('cache-control'), 'no-store');
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(res.headers.get('access-control-allow-origin'), null);
      assert.deepEqual(await res.json(), { ok: true }, kind);
      assert.ok(await es.waitFor(() => es.of('open').length > n), kind + ' reached the tray');
      assert.deepEqual(es.of('open')[n], frame, kind);
    }
    assert.deepEqual(OPEN_KINDS.slice(), want.map((r) => r[0]), 'every kind, and no eighth');
    /* the frame is written to the TRAY STREAM ALONE, exactly as an alert is: a
       page holding the same route gets nothing */
    const page = stream(t, sb);
    assert.ok(await page.waitFor(() => page.of('hello')[0]));
    await open('open');
    assert.ok(await es.waitFor(() => es.of('open').length === want.length + 1));
    assert.equal(page.of('open').length, 0, 'a page is never handed an open frame');
    /* and nothing was ever demanded, because a tray was on the stream throughout */
    assert.equal(demandCount(tools.demands), 0);
    assert.equal(srv.proc.exitCode, null, 'and the board is still serving');
  });

test('the folder half of the table, and the two 409s that write no frame at all',
  async (t) => {
    const board = await onBoard(t);
    const sb = await mint();
    const { named, folder, rec } = await seedOpen(t, board.verb);
    writeOpenSettings(sb, { editor: SCHEME_EDITOR });
    const tools = openEnv(t);
    const srv = await startOn(t, sb, board, tools.env, [...trayNoOpen(), ...openOnWin()]);
    const es = await trayOn(t, sb);
    const open = (n, kind) => post(sb.base + '/f/' + rec.id + '/' + n + '/open', { kind });

    /* THE FOLDER COLUMN: the folder gestures act on the folder ITSELF where a file
       sends them to its parent. */
    const want = [
      ['open', { kind: 'open', verb: 'open', path: folder }],
      ['editor', { kind: 'editor', url: 'editor://open/' + enc(folder) + '/' }],
      ['terminal', { kind: 'terminal', exe: 'wt.exe', args: ['-d', folder] }],
      ['claude', { kind: 'claude', url: 'claude://code/new?folder=' + encodeURIComponent(folder) }],
    ];
    for (let n = 0; n < want.length; n++) {
      const [kind, frame] = want[n];
      assert.equal((await open(1, kind)).status, 200, kind);
      assert.ok(await es.waitFor(() => es.of('open').length > n), kind);
      assert.deepEqual(es.of('open')[n], frame, kind);
    }

    /* a folder's own open already shows it and its editor already
       opens the folder, so neither control is drawn and the route is the belt. */
    for (const kind of ['reveal', 'project']) {
      const said = await open(1, kind);
      assert.equal(said.status, 409, kind);
      assert.deepEqual(await said.json(),
        { error: 'this ref names a folder, so ' + kind + ' is not offered on it' });
    }

    /* the picker is for a FILE, and the shell has no openas for a
       folder to reach. The record and the ref are both real, so it is a 409. */
    const wrong = await open(1, 'openwith');
    assert.equal(wrong.status, 409);
    assert.deepEqual(await wrong.json(), { error: 'open with is for files' });

    /* THE ONE STAT, between the resolve and the frame: a file the record still
       names and the disk no longer holds is the viewer page's own words */
    rmSync(named);
    const gone = await open(0, 'open');
    assert.equal(gone.status, 409);
    assert.deepEqual(await gone.json(), { error: 'this was named here, and it is not there now' });

    /* NO REFUSAL WROTE A FRAME, and a folder ref stamps nothing on any kind, so four
       dispatched opens left the recent file unwritten. */
    await sleep(200);
    assert.equal(es.of('open').length, want.length, 'no frame rode any 409');
    assert.equal(existsSync(join(sb.root, 'board', 'recent.json')), false,
      'a folder is not a recent file');
    assert.equal(demandCount(tools.demands), 0);
    assert.equal(srv.proc.exitCode, null);
  });

/* "recent files" are files. The four controls a FILE's row draws
   stamp it, the folder gestures never do, and a folder ref stamps on no kind at
   all, so the tray's list and the card's carry files by construction. */
test('the touch stamp is a file own, on its four kinds and on no folder gesture',
  async (t) => {
    const board = await onBoard(t);
    const sb = await mint();
    const { named, folder, rec } = await seedOpen(t, board.verb);
    writeOpenSettings(sb, { editor: SCHEME_EDITOR });
    const tools = openEnv(t);
    const srv = await startOn(t, sb, board, tools.env, [...trayNoOpen(), ...openOnWin()]);
    const es = await trayOn(t, sb);
    const open = (n, kind) => post(sb.base + '/f/' + rec.id + '/' + n + '/open', { kind });
    const stamped = () => (existsSync(join(sb.root, 'board', 'recent.json'))
      ? JSON.parse(readFileSync(join(sb.root, 'board', 'recent.json'), 'utf8')).opens
      : []);

    for (const kind of ['open', 'openwith', 'editor', 'reveal']) {
      assert.equal((await open(0, kind)).status, 200, kind);
      assert.ok(await es.waitFor(() => es.of('open').length > 0), kind);
      assert.deepEqual(stamped().map((e) => [e.index, e.kind, e.path]), [[0, kind, named]], kind);
    }

    /* the three folder gestures on a FILE ref act on its parent folder, so they
       are a folder's open under another name and write nothing either */
    for (const kind of ['terminal', 'claude', 'project']) {
      assert.equal((await open(0, kind)).status, 200, kind);
      assert.deepEqual(stamped().map((e) => e.kind), ['reveal'], kind + ' left the list alone');
    }
    /* and the folder ref itself, on every kind its row draws */
    for (const kind of ['open', 'editor', 'terminal', 'claude']) {
      assert.equal((await open(1, kind)).status, 200, kind);
      assert.deepEqual(stamped().map((e) => e.path), [named], kind + ' on a folder');
    }
    assert.ok(!JSON.stringify(stamped()).includes(folder), 'no folder reached the list');
    assert.equal(demandCount(tools.demands), 0);
    assert.equal(srv.proc.exitCode, null);
  });

test('the open route validates its body, its record, and its ref before anything runs',
  async (t) => {
    const board = await onBoard(t);
    const sb = await mint();
    const { rec, ws } = await seedRefs(t, board.verb);
    /* both templates empty, so every kind that reads one refuses in words and
       nothing in this case can reach the push */
    writeOpenSettings(sb, { editor: { file: '', folder: '' } });
    const tools = openEnv(t);
    const srv = await startOn(t, sb, board, tools.env, [...trayNoOpen(), ...openOnWin()]);
    const at = (id, n) => sb.base + '/f/' + id + '/' + n + '/open';

    /* the body first, refused before the store is read */
    const cases = [
      ['not json at all', 400, /not JSON/],
      ['[1,2,3]', 400, /must be a JSON object/],
      ['"a string"', 400, /must be a JSON object/],
      ['42', 400, /must be a JSON object/],
      [{}, 400, /kind must be a string/],
      [{ kind: 1 }, 400, /kind must be a string/],
      /* THE OLD KEY IS REFUSED BY NAME, the read-only keys' own idiom: a stale page
         learns what happened rather than being ignored */
      [{ preset: 'command' }, 400,
        /^preset was renamed kind; the kinds are open, openwith, reveal, editor, project, terminal, claude$/],
      [{ preset: 'reveal', kind: 'open' }, 400, /preset was renamed kind/],
      /* a page may name a kind and may never supply a path or a program (spec
         section 6), so both are unknown keys at the door */
      [{ kind: 'open', path: 'X:/synthetic/elsewhere/x.md' }, 400, /unknown key: path/],
      [{ kind: 'editor', editor: 'anything' }, 400, /unknown key: editor/],
      [{ kind: 'open', shove: 1 }, 400, /unknown key: shove/],
      /* the old preset ids are values off the list, and the sentence names every kind
         there is */
      [{ kind: 'vscode' }, 400,
        /^kind must be one of open, openwith, reveal, editor, project, terminal, claude$/],
      [{ kind: 'obsidian' }, 400, /kind must be one of/],
      [{ kind: 'scheme' }, 400, /kind must be one of/],
      [{ kind: 'command' }, 400, /kind must be one of/],
      /* a prototype name is a value like any other and is refused like one */
      [{ kind: 'constructor' }, 400, /kind must be one of/],
      [{ kind: '' }, 400, /kind must be one of/],
    ];
    for (const body of cases) {
      const res = await post(at(rec.id, 0), body[0]);
      assert.equal(res.status, body[1], JSON.stringify(body[0]).slice(0, 60));
      assert.match((await res.json()).error, body[2]);
    }

    /* then the SAME resolution the raw route runs, and every refusal it makes is a
       404 here for the same reason it is one there. `reveal` is the kind
       throughout, so nothing can be blamed on the settings. */
    assert.equal((await post(at('T-999', 0), { kind: 'reveal' })).status, 404, 'unknown record');
    assert.equal((await post(at(rec.id, 9), { kind: 'reveal' })).status, 404, 'past the end');
    assert.equal((await post(at(rec.id, 1), { kind: 'reveal' })).status, 404, 'a work id is not a file');
    assert.equal((await post(at(ws.id, 1), { kind: 'reveal' })).status, 404, 'a UNC ref');
    assert.equal((await post(at(ws.id, 2), { kind: 'reveal' })).status, 404, 'a slash-rooted ref');
    assert.equal((await post(at(ws.id, 3), { kind: 'reveal' })).status, 404, 'a relative ref');
    for (const bad of ['T-', 'Q', 'Q-1', 'Q1x', 'WS-9x', '..']) {
      assert.equal((await post(at(bad, 0), { kind: 'reveal' })).status, 404, bad);
    }
    for (const bad of ['-1', '00', '01', '1.0', 'a', '']) {
      assert.equal((await post(at(rec.id, bad), { kind: 'reveal' })).status, 404, 'index ' + bad);
    }

    /* and only THEN the settings. The record and the ref are both real here, so
       an unset template is a 409 that names which one is missing rather than a
       404 that would say the ref was not there. */
    const unset = await post(at(rec.id, 0), { kind: 'editor' });
    assert.equal(unset.status, 409);
    assert.match((await unset.json()).error,
      /^no editor file template is set; set one on the notifications page$/);
    const noFolder = await post(at(rec.id, 0), { kind: 'project' });
    assert.equal(noFolder.status, 409);
    assert.match((await noFolder.json()).error, /^no editor folder template is set/);

    /* the 64KB cap, the answer bar's own: it answers and hangs up mid-upload,
       which fetch reports as a network failure, so this one goes out raw */
    const big = await rawPost(sb.port, '/' + sb.secret + '/f/' + rec.id + '/0/open',
      JSON.stringify({ kind: 'open', pad: 'x'.repeat(70000) }));
    assert.equal(big.status, 400);
    assert.match(big.body, /body too large/);

    /* the METHOD is part of each shape: GET on /open and POST on /raw are both
       the flat 404, not each other's route */
    assert.equal((await fetch(at(rec.id, 0))).status, 404, 'GET on open');
    assert.equal((await raw(sb.port, '/' + sb.secret + '/f/' + rec.id + '/0/raw',
      { method: 'POST' })).status, 404, 'POST on raw');
    /* and a deeper URL is still not a deeper anything */
    assert.equal((await post(sb.base + '/f/' + rec.id + '/0/open/more', { kind: 'reveal' })).status, 404);

    /* the posture every other route keeps: a stranger's secret and a wrong Host
       are flat 404s here too */
    const wrong = 'http://127.0.0.1:' + sb.port + '/deadbeefdeadbeefdeadbeefdeadbeef';
    assert.equal((await post(wrong + '/f/' + rec.id + '/0/open', { kind: 'reveal' })).status, 404);
    assert.equal((await raw(sb.port, '/' + sb.secret + '/f/' + rec.id + '/0/open',
      { method: 'POST', host: 'attacker.example' })).status, 404);
    /* NOT ONE OF THOSE REACHED THE PUSH: no frame was built, so no tray was ever
       demanded and board/recent.json was never written */
    assert.equal(demandCount(tools.demands), 0);
    assert.equal(existsSync(join(sb.root, 'board', 'recent.json')), false);
    assert.equal(srv.proc.exitCode, null);
  });

/* The redline (spec section 6) on the route that DISPATCHES something: the refs
   list is the only path authority. The frames on the stream make the negative
   provable, since a crafted shape that reached the exe would be one here. */
test('a path the record never named is unreachable through open, exactly as through raw',
  async (t) => {
    const board = await onBoard(t);
    const sb = await mint();
    const { named, sibling, rec } = await seedRefs(t, board.verb);
    const tools = openEnv(t);
    const srv = await startOn(t, sb, board, tools.env, [...trayNoOpen(), ...openOnWin()]);
    const es = await trayOn(t, sb);

    /* every crafted shape that tries to name the sibling, WITH the secret so
       each refusal is about the shape rather than about the prefix, and raw so
       the client never normalizes one away */
    const crafted = [
      '/f/' + rec.id + '/0/../sibling.md/open',
      '/f/' + rec.id + '/0%2f..%2fsibling.md/open',
      '/f/' + rec.id + '/..%2fsibling.md/open',
      '/f/' + rec.id + '/' + encodeURIComponent(sibling) + '/open',
      '/f/' + encodeURIComponent(sibling) + '/0/open',
      '/f/' + rec.id + '/0/open/' + encodeURIComponent(sibling),
    ];
    for (const path of crafted) {
      const r = await rawPost(sb.port, '/' + sb.secret + path, JSON.stringify({ kind: 'open' }));
      assert.notEqual(r.status, 200, path);
      assert.ok(!r.body.includes('sibling'), path);
    }
    /* nothing was dispatched by any of them, which is the strongest form of the
       rule: a frame naming that file would be sitting on the stream */
    await sleep(300);
    assert.deepEqual(es.of('open'), [], 'no frame was ever written');

    /* a query string is not a path parameter either: this one IS a route, and
       what it opens is the record's own ref at index 0 and never the sibling
       the query names */
    const ignored = await rawPost(sb.port, '/' + sb.secret + '/f/' + rec.id + '/0/open?path='
      + encodeURIComponent(sibling), JSON.stringify({ kind: 'open' }));
    assert.equal(ignored.status, 200);
    assert.ok(await es.waitFor(() => es.of('open').length === 1));
    assert.deepEqual(es.of('open')[0],
      { kind: 'open', verb: 'open', path: resolvePath(named) });

    /* the positive control, which is what makes the negative mean something:
       the check is the LIST, so the sibling opens the moment the record names
       it, and nothing else about the server changed to allow it */
    await board.verb('editRecord', { id: rec.id, addRef: [sibling] });
    assert.ok(await pollUntil(async () => (await post(sb.base + '/f/' + rec.id + '/5/open', { kind: 'open' })).status === 200));
    assert.ok(await es.waitFor(() => es.of('open').length === 2));
    assert.deepEqual(es.of('open')[1],
      { kind: 'open', verb: 'open', path: resolvePath(sibling) });
    assert.equal(demandCount(tools.demands), 0, 'a tray was attached throughout');
    assert.equal(srv.proc.exitCode, null);
  });

/* A ref may name a LINE and a COLUMN as trailing colon-digits suffixes, cut
   ONCE server-side inside the resolution all three f/ routes share, so this case
   is one record and three routes: the bytes, the frame and the page must agree. */
test('a lined ref serves its file, opens the clean path, and hands the page the line and the column',
  async (t) => {
    const board = await onBoard(t);
    const sb = await mint();
    const docs = tempDir('nd-line-', t);
    const named = join(docs, 'spec.md');
    const plain = join(docs, 'plain.md');
    writeFileSync(named, '# spec\nthe line the ref points at\n');
    writeFileSync(plain, '# plain\n');
    writeOpenSettings(sb, { editor: CMD_EDITOR });
    const rec = await board.verb('createRecord', {
      kind: 'task', name: 'lined ref demo', description: 'A record naming a line in a file.',
      refs: [named + ':42:7', named + ':42', plain],
    });
    const tools = openEnv(t);
    const srv = await startOn(t, sb, board, tools.env, [...trayNoOpen(), ...openOnWin()]);
    const es = await trayOn(t, sb);

    /* the BYTES: the suffixes are a line and a column, never part of a filename,
       so the raw route serves the file the ref names and serves it whole */
    for (const n of [0, 1]) {
      const bytes = await fetch(sb.base + '/f/' + rec.id + '/' + n + '/raw');
      assert.equal(bytes.status, 200, 'index ' + n);
      assert.equal(await bytes.text(), readFileSync(named, 'utf8'));
    }

    /* the PAGE: three fields, cut apart once and upstream. The extension is read
       off the clean path (md, never md:42), and the reader still sees the
       spelling the record actually wrote. */
    const refOf = async (n) => {
      const page = await (await fetch(sb.base + '/f/' + rec.id + '/' + n)).text();
      return { REF: JSON.parse(/var REF = (\{[\s\S]*?\});\n/.exec(page)[1]), page };
    };
    const both = await refOf(0);
    assert.equal(both.REF.path, named);
    assert.equal(both.REF.line, '42');
    assert.equal(both.REF.col, '7');
    assert.equal(both.REF.ext, 'md');
    assert.ok(both.page.includes('<p class="rv-path">' + named.replace(/&/g, '&amp;') + ':42:7</p>'),
      'the spelling the record wrote');
    const lined = await refOf(1);
    assert.deepEqual([lined.REF.line, lined.REF.col], ['42', ''], 'one cut, and no column');
    const bare = await refOf(2);
    assert.deepEqual([bare.REF.line, bare.REF.col], ['', ''], 'and neither on a plain ref');

    /* THE FRAME: what reaches a program is the file with no suffix on it, and the
       template's own {line} carries the number. A tail whose number is missing
       leaves with its colon rather than leaving a bare one behind. */
    const open = (n) => post(sb.base + '/f/' + rec.id + '/' + n + '/open', { kind: 'editor' });
    assert.equal((await open(0)).status, 200);
    assert.ok(await es.waitFor(() => es.of('open').length === 1));
    assert.deepEqual(es.of('open')[0], {
      kind: 'editor', exe: 'X:/synthetic/apps/ed.exe',
      args: ['--wait', resolvePath(named) + ':42'],
    });
    assert.equal((await open(2)).status, 200);
    assert.ok(await es.waitFor(() => es.of('open').length === 2));
    assert.deepEqual(es.of('open')[1], {
      kind: 'editor', exe: 'X:/synthetic/apps/ed.exe', args: ['--wait', resolvePath(plain)],
    });
    assert.equal(demandCount(tools.demands), 0);
    assert.equal(srv.proc.exitCode, null);
  });

/* A 200 says the frame was WRITTEN TO THE TRAY and nothing more. The failure that
   matters is having nobody to write to: a 503 CARRYING THE REASON, because the row's
   error span prints the server's own sentence. */
test('no tray to take the open is a 503 with its reason, and the demand is made at most once',
  async (t) => {
    const board = await onBoard(t);
    const sb = await mint();
    const { rec } = await seedRefs(t, board.verb);
    writeOpenSettings(sb, { editor: SCHEME_EDITOR });
    const tools = openEnv(t);
    /* the shim can never attach, so this is the whole of the no-tray path: the
       committed exe is never started by any case in this suite. THE CHANNEL IS FORCED
       ON or a non-Windows runner has no tray object to demand. */
    const srv = await startOn(t, sb, board, tools.env, [...channelOn(), ...trayNoOpen(), ...openOnWin()]);

    const res = await post(sb.base + '/f/' + rec.id + '/0/open', { kind: 'open' });
    assert.equal(res.status, 503);
    assert.match(res.headers.get('content-type'), /^application\/json/);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await res.json(),
      { error: 'the tray did not attach, so the open was not sent' });

    /* ONE DEMAND PER OPEN AND NEVER TWO: the loop makes it at most once, whether
       it was there to be made at the start or only after a dead stream dropped */
    assert.equal(demandCount(tools.demands), 1);
    assert.equal((await post(sb.base + '/f/' + rec.id + '/0/open', { kind: 'open' })).status, 503);
    assert.equal(demandCount(tools.demands), 2, 'one each, never two for one');

    /* NOTHING WAS TOUCHED EITHER: the stamp is written on a dispatched open and
       a refusal is not one, so reading a file is still not touching it */
    assert.equal(existsSync(join(sb.root, 'board', 'recent.json')), false);

    /* THE assert that says the board is still serving: a 503 is an answer, not a
       server that fell over on the way to one */
    const ping = await raw(sb.port, '/' + sb.secret + '/ping', { method: 'POST' });
    assert.equal(ping.status, 204);
    assert.equal(srv.proc.exitCode, null);

    /* and the attach is what turns the same post into a 200, with nothing else
       about the server changed */
    const es = await trayOn(t, sb);
    assert.equal((await post(sb.base + '/f/' + rec.id + '/0/open', { kind: 'open' })).status, 200);
    assert.ok(await es.waitFor(() => es.of('open').length === 1));
    assert.equal(demandCount(tools.demands), 2, 'a stream on the wire demands nothing');
  });

/* THE OTHER 503 SENTENCE: with the channel off there is no tray OBJECT at all,
   so the loop has nothing to demand and says so rather than waiting on a start
   that could never come (the shape a non-Windows runner sees for every open). */
test('an open with no tray object at all answers the second sentence and demands nothing',
  async (t) => {
    const board = await onBoard(t);
    const sb = await mint();
    const { rec } = await seedRefs(t, board.verb);
    const tools = openEnv(t);
    const srv = await startOn(t, sb, board, tools.env, [...channelOff(), ...trayNoOpen(), ...openOnWin()]);

    const res = await post(sb.base + '/f/' + rec.id + '/0/open', { kind: 'open' });
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { error: 'no tray is attached to take the open' });
    assert.equal(demandCount(tools.demands), 0, 'there was nothing to demand');
    assert.equal(existsSync(join(sb.root, 'board', 'recent.json')), false);
    assert.equal(srv.proc.exitCode, null);
  });

/* NOTHING IS MINTED IN THE BROWSER: the row is four buttons that post a KIND, and no
   template and no program name rides to the page at all, however the settings file is
   edited. */
test('the viewer page carries the open route and a kind per control, and never a template',
  async (t) => {
    const board = await onBoard(t);
    const sb = await mint();
    const { rec } = await seedRefs(t, board.verb);
    const srv = await startOn(t, sb, board);

    /* the default settings file, five booleans and nothing else: the row is the
       same four controls whatever the editor target is, because the page chooses nothing */
    const row = ['data-open-kind="open"', 'data-open-kind="openwith"',
      'data-open-kind="editor"', 'data-open-kind="reveal"'];
    const bare = await (await fetch(sb.base + '/f/' + rec.id + '/0')).text();
    assert.ok(bare.includes('"open":"/' + sb.secret + '/f/' + rec.id + '/0/open"'));
    assert.deepEqual((bare.match(/data-open-kind="([a-z]+)"/g) || []), row);
    /* the page carries no picker payload and mints nothing */
    for (const never of ['"preset"', '"scheme"', 'data-open="', 'vscode://', 'obsidian://']) {
      assert.ok(!bare.includes(never), never);
    }

    /* a hand edit, read on the next request, and it changes NOTHING on the page:
       the template is the exe's business and the page never sees one */
    writeOpenSettings(sb, {
      editor: {
        file: 'editor://open?f={path}&l={line}',
        folder: '"X:/synthetic/apps/editor.exe" --wait {path}',
      },
    });
    const set = await (await fetch(sb.base + '/f/' + rec.id + '/0')).text();
    assert.deepEqual((set.match(/data-open-kind="([a-z]+)"/g) || []), row);
    assert.ok(!set.includes('editor://open'), 'the scheme template stays server-side');
    assert.ok(!set.includes('editor.exe'), 'and so does the program name');
    assert.ok(!set.includes('--wait'));

    /* a settings file that will not parse falls back to the defaults and still
       serves a page, and the row is the row either way */
    writeFileSync(join(sb.root, 'board', 'notify.json'), 'not json at all\n');
    const broken = await fetch(sb.base + '/f/' + rec.id + '/0');
    assert.equal(broken.status, 200);
    const text = await broken.text();
    assert.deepEqual((text.match(/data-open-kind="([a-z]+)"/g) || []), row);
    assert.ok(!text.includes('vscode://'), 'not even the shipped default template');
  });

test('the board verb prints both URL forms and refuses --port', async (t) => {
  const home = tempDir('nd-board-cli-');
  const root = join(home, '.claude', 'askerdo');
  const secret = randomBytes(16).toString('hex');
  const port = await freePort();
  mkdirSync(join(root, 'board'), { recursive: true });
  writeFileSync(join(root, 'board', 'secret'), secret + '\n');
  writeFileSync(join(root, 'board', 'port'), String(port) + '\n');
  writeFileSync(join(root, 'board', 'notify.json'), CHANNEL_OFF + '\n');
  const base = 'http://127.0.0.1:' + port + '/' + secret;
  t.after(async () => { try { await fetch(base + '/stop', { method: 'POST' }); } catch {} });

  const run = (args, env = {}) => new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, ...args], {
      env: { ...childEnv(), HOME: home, USERPROFILE: home, ...env },
    });
    let out = '';
    let err = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.stdin.end();
    child.on('close', (code) => resolve({ code, out, err }));
  });

  /* THE BOARD IS PUT UP HERE, not by the verb: the CLI's start goes through the
     scheduled task, and no case in this suite registers a real one. What the verb
     owes a person is what it PRINTS, which is what this asserts. */
  const srv = spawn(process.execPath, [boardScript, '--root', root], {
    env: { ...childEnv(), HOME: home, USERPROFILE: home }, cwd: pluginRoot,
  });
  t.after(() => { try { srv.kill(); } catch {} });
  srv.stdout.setEncoding('utf8');
  await new Promise((resolve, reject) => {
    let seen = '';
    srv.on('error', reject);
    srv.stdout.on('data', (d) => { seen += d; if (seen.includes('\n')) resolve(seen); });
  });

  const json = await run(['board', '--json']);
  assert.equal(json.code, 0, json.err);
  const r = JSON.parse(json.out);
  assert.deepEqual(Object.keys(r).sort(), ['altUrl', 'port', 'status', 'url', 'versions']);
  assert.equal(r.versions.pc, version);
  assert.equal(r.status, 'running');
  assert.equal(r.port, port);
  assert.equal(r.url, 'http://askerdo.localhost:' + port + '/' + secret + '/');
  assert.equal(r.altUrl, 'http://127.0.0.1:' + port + '/' + secret + '/');
  assert.equal((await fetch(base + '/')).status, 200);

  const human = await run(['board']);
  assert.equal(human.code, 0, human.err);
  assert.match(human.out, /^board running at http:\/\/askerdo\.localhost:/);
  assert.match(human.out, /loopback form \(for the OS resolver\): http:\/\/127\.0\.0\.1:/);

  const refused = await run(['board', '--port', '9']);
  assert.equal(refused.code, 1);
  assert.match(refused.err, /the board port is minted at store initialization and is permanent/);
  assert.match(refused.err, /breaks old links/);
});

/* End to end through the real CLI: a register that will not go through is a plain
   message on stderr and exit 2, with no fallback spawn behind it. The runner's exe
   name is an env seam, pointed at nothing. */
test('the board verb exits 2 when the task cannot be registered', async () => {
  const home = tempDir('nd-board-cli-');
  const root = join(home, '.claude', 'askerdo');
  const port = await freePort();
  const secret = randomBytes(16).toString('hex');
  mkdirSync(join(root, 'board'), { recursive: true });
  writeFileSync(join(root, 'board', 'secret'), secret + '\n');
  writeFileSync(join(root, 'board', 'port'), String(port) + '\n');
  writeFileSync(join(root, 'board', 'notify.json'), CHANNEL_OFF + '\n');

  const r = await new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, 'board'], {
      env: {
        ...childEnv(),
        HOME: home,
        USERPROFILE: home,
        ASKERDO_SCHTASKS: join(home, 'no-such-scheduler.exe'),
        /* and the SID comes from here, so the register this case makes fail
           never asks the machine who it is */
        ASKERDO_SID: FAKE_SID,
      },
    });
    let out = '';
    let err = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.stdin.end();
    child.on('close', (code) => resolve({ code, out, err }));
  });

  assert.equal(r.code, 2, r.err);
  assert.match(r.err, /the board server did not come up/);
  assert.match(r.err, /could not be registered/);
  assert.match(r.err, /AskerDo board/, 'the task is named so a person can look for it');
  assert.equal(r.out, '', 'nothing is printed as though a board came up');
  await assert.rejects(raw(port, '/'), 'a board was started anyway');
});

/* ---- the board's rows on the stream, and api/activity ------------- */

test('a board row reaches the stream as a line with its author, changes, sequence and workstream; a token saved meanwhile reaches the server', async (t) => {
  const { b, verb } = await onBoard(t);
  const sb = await mint();
  /* the board from the config, as a PC sets it up, so a saved change can reach the running server */
  const data = join(tempDir('nd-board-'), 'askerdo-data');
  mkdirSync(data, { recursive: true });
  const newPcToken = async () => (await (await fetch(b.url + '/admin/token/new', { method: 'POST', headers: { 'x-askerdo-admin': b.api.adminSecret }, body: JSON.stringify({ device: 'pc-one' }) })).json()).result.token;
  const config = (token) => writeFileSync(join(data, 'config.json'), JSON.stringify({ queue: 'hub', boardUrl: b.url, boardToken: token }));
  config(await newPcToken());
  await start(t, sb, { CLAUDE_PLUGIN_DATA: data, ASKERDO_WATCH_MS: '100' }).line;
  assert.ok(await boardLoaded(sb));
  const es = stream(t, sb);
  const hello = await es.waitFor(() => es.of('hello')[0]);
  assert.deepEqual(hello.activity, [], 'the hello carries no lines of its own');

  const ws = await verb('createRecord', { kind: 'workstream', name: 'work system build', description: 'One board.' }, { session: 'sess-a' });
  const task = await verb('createRecord', { kind: 'task', name: 'counter rebuild', description: 'A step.', workstream: ws.id }, { session: 'sess-a' });
  await verb('editRecord', { kind: 'task', id: task.id, priority: 'high' }, { session: 'sess-a' });
  const line = await es.waitFor(() => es.of('change').flatMap((e) => e.activity)
    .find((l) => l.verb === 'edit' && l.id === task.id));
  assert.ok(line, 'the row reached the stream within a tick');
  assert.equal(line.kind, 'task');
  assert.equal(line.by, 'session:sess-a');
  assert.equal(line.changes.priority[1], 'high');
  assert.equal(line.ws, ws.id, 'placed under its workstream');
  assert.match(line.at, /^\d+$/, 'at is the row sequence, as the board pages give it');
  assert.ok(line.ts);
  assert.equal(es.of('change').at(-1).version, version, 'the served version rides the change too');

  /* a new token cuts the old one's stream; an answer given before it is saved still reaches the asker */
  const next = await newPcToken();
  const q = await verb('register', asked({ session: 'sess-z' }), { session: 'sess-z' });
  await verb('answer', { id: q.id, pick: 'a' }, { user: true });
  config(next);
  const told = () => { try { return readFileSync(join(sb.root, 'inbox', 'sess-z.jsonl'), 'utf8').includes('"' + q.id + '"'); } catch { return false; } };
  assert.ok(await pollUntil(told), 'the saved token reached the running server and it caught up from its cursor');
});

/* THE TRAY CONSOLE'S PAGE off the board's own rows: `at` is the row sequence the
   stream's lines carry, so the console's merge by `at` agrees, and each row names
   its place (its workstream, or the directory a question was asked from). */
test('api/activity pages the board rows with their place, follows the board, and refuses a bad query', async (t) => {
  const board = await onBoard(t);
  const { verb } = board;
  const ws = await verb('createRecord', { kind: 'workstream', name: 'work system build', description: 'One board.', projects: ['C:/repos/my-app'] }, { session: 'sess-a' });
  const task = await verb('createRecord', { kind: 'task', name: 'counter rebuild', description: 'A step.', workstream: ws.id }, { session: 'sess-a' });
  await verb('noteRecord', { id: task.id, text: 'a note the search can find' }, { session: 'sess-a' });
  const q = await verb('register', asked({ projectDir: 'C:/repos/other-app' }), { session: 'sess-a' });
  const sb = await mint();
  await startOn(t, sb, board);
  const get = async (query) => {
    const res = await fetch(sb.base + '/api/activity' + query);
    return { status: res.status, body: await res.json() };
  };

  const all = await get('?limit=200');
  assert.equal(all.status, 200);
  const place = (id) => {
    const l = all.body.lines.find((row) => row.id === id);
    return [l.ws, l.project];
  };
  assert.deepEqual(place(task.id), [ws.id, null], 'a task takes its workstream');
  assert.deepEqual(place(q.id), [null, 'other-app'], 'a question takes the project it was asked from (Q89: its name, never a folder)');
  assert.equal(all.body.wsNames[ws.id], 'work system build', 'the console names a workstream');
  for (const l of all.body.lines) assert.match(l.at, /^\d+$/, 'at is the row sequence');

  /* PAGING by the cursor the answer hands back */
  const first = await get('?limit=2');
  assert.equal(first.body.lines.length, 2);
  assert.equal(first.body.nextBefore, first.body.lines[1].at);
  const second = await get('?limit=2&before=' + first.body.nextBefore);
  assert.deepEqual(second.body.lines.map((l) => l.at), all.body.lines.slice(2, 4).map((l) => l.at));

  /* the filters the board's verb takes, and a project in either spelling */
  assert.ok((await get('?id=' + task.id)).body.lines.every((l) => l.id === task.id));
  assert.deepEqual((await get('?search=' + encodeURIComponent('the search can find'))).body.lines.map((l) => l.id), [task.id]);
  const bs = String.fromCharCode(92);
  const scoped = await get('?project=' + encodeURIComponent('C:' + bs + 'repos' + bs + 'my-app' + bs));
  assert.deepEqual([...new Set(scoped.body.lines.map((l) => l.id))].sort(), [task.id, ws.id].sort());

  /* A ROW THE BOARD WRITES AFTER A PAGE is on the next page */
  await verb('editRecord', { kind: 'task', id: task.id, priority: 'high' }, { session: 'sess-a' });
  assert.ok(await pollUntil(async () => (await get('?limit=1')).body.lines[0].verb === 'edit'));

  /* A BAD QUERY IS A 400 NAMING ITS KEY, never a coerced answer */
  for (const [query, key] of [['?limit=201', /limit/], ['?limit=0', /limit/], ['?before=yesterday', /before/],
    ['?month=september', /month/], ['?id=' + encodeURIComponent('../etc'), /id/], ['?since=today', /since/],
    ['?kind=task&kind=question', /kind/], ['?project=', /project/]]) {
    const r = await get(query);
    assert.equal(r.status, 400, query);
    assert.match(r.body.error, key, query);
  }

  /* GET ONLY, and under the secret like every route */
  assert.equal((await post(sb.base + '/api/activity', {})).status, 404);
  assert.equal((await fetch('http://127.0.0.1:' + sb.port + '/' + 'f'.repeat(32) + '/api/activity')).status, 404);
});

/* ---- the tray stream, its identity gate, and the alert relay ------ */

/* The instance this server minted, off the route that already carries it. */
async function instanceOf(sb) {
  const ping = await raw(sb.port, '/' + sb.secret + '/ping', { method: 'POST' });
  assert.equal(ping.status, 204);
  return ping.headers['x-askerdo-instance'];
}

/* The relay body the CLI's work half posts (lib/notify.mjs relayAlert): an
   alert with no card, so no relay case reads the store. */
const RELAY_ALERT = { kind: 'done', title: 'counter rebuild completed' };
const RELAY = JSON.stringify({ alert: RELAY_ALERT });
/* the headers of a tray that draws the popup (tray/src/net.rs) */
const popupTray = (inst) => ({ 'x-askerdo-tray': inst, 'x-askerdo-popup': '1' });

test('the tray attaches with the server own instance, and a stranger is refused', async (t) => {
  const { verb, env } = await onBoard(t);
  const q1 = await verb('register', asked(), { session: 'sess-a' });
  const sb = await mint();
  const srv = start(t, sb, { ...env, ASKERDO_WATCH_MS: '100', ASKERDO_BEAT_MS: '4000' });
  await srv.line;
  assert.ok(await boardLoaded(sb));
  const inst = await instanceOf(sb);

  /* the instance in the header IS the check, and it is made before any stream
     exists: a tray whose server was replaced on the port would otherwise wear
     the replacement's dot while its own board URL named a server that is gone */
  const stranger = await fetch(sb.base + '/api/events',
    { headers: { 'x-askerdo-tray': 'deadbeefdeadbeef' } });
  assert.equal(stranger.status, 409);
  assert.match(stranger.headers.get('content-type'), /^text\/plain/);
  assert.equal(stranger.headers.get('cache-control'), 'no-store');
  assert.equal(await stranger.text(), 'another instance\n');

  const es = stream(t, sb, '/api/events', { 'x-askerdo-tray': inst });
  const head = await es.head;
  assert.equal(head.statusCode, 200, 'the tray reads the very stream a page does');
  assert.equal(head.headers['content-type'], 'text/event-stream; charset=utf-8');

  /* THE ADDITIVE FIELD, on the hello: the instance to compare against, the
     corner, the blocking count, and the cadence the tray times its own
     liveness window against */
  const hello = await es.waitFor(() => es.of('hello')[0]);
  assert.deepEqual(hello.tray, {
    instance: inst, dot: 'blocking', blocking: 1, beatMs: 4000,
    /* THE MENU'S FIVE, additive beside the four above and ignored by the page
       exactly as those are. THE NAMES ARE THE LITERAL ONES THE FIXTURES REGISTERED:
       a clause reading the value out of the frame it pins can never fail. */
    waiting: 0,
    /* and the key the tray opens it by */
    questions: [{ id: q1.id, name: 'store shape', key: q1.key }],
    waitingQuestions: [],
    /* the TENTH field, additive beside the other nine and empty until the
       opener has touched something: nothing has been opened on this board */
    recent: [],
    pausedUntil: '',
    pauseLabel: '',
  });

  /* and on the change, off the same reading the ping headers come from */
  const q2 = await verb('register', asked({ name: 'second shape' }), { session: 'sess-a' });
  const change = await es.waitFor(() => es.of('change').find((e) => e.tray.blocking === 2));
  assert.deepEqual(change.tray.questions.map((q) => q.id), [q1.id, q2.id],
    'oldest first, which is what decides the five when more than five block');
  const ping = await raw(sb.port, '/' + sb.secret + '/ping', { method: 'POST' });
  assert.equal(ping.headers['x-askerdo-dot'], change.tray.dot, 'one dot, two wires');

  /* a PAGE gets the same field and ignores it: one payload builder, one shape */
  const page = stream(t, sb);
  const seen = await page.waitFor(() => page.of('hello')[0]);
  assert.deepEqual(seen.tray, change.tray);
});

test('a newer tray attach replaces the older, which is ended', async (t) => {
  const sb = await mint();
  const srv = start(t, sb, { ASKERDO_BEAT_MS: '4000' });
  await srv.line;
  const inst = await instanceOf(sb);
  const header = popupTray(inst);

  const first = stream(t, sb, '/api/events', header);
  assert.ok(await first.waitFor(() => first.of('hello')[0]));
  const ended = new Promise((resolve) => { first.head.then((res) => res.on('end', resolve)); });

  /* an exe that reconnected after a dropped stream must not leave the alerts
     going to a socket nobody is reading */
  const second = stream(t, sb, '/api/events', header);
  assert.ok(await second.waitFor(() => second.of('hello')[0]));
  await ended;

  const res = await fetch(sb.base + '/api/relay', { method: 'POST', body: RELAY });
  assert.equal(res.status, 204);
  assert.equal((await second.waitFor(() => second.of('alert')[0])).title, RELAY_ALERT.title);
  assert.equal(first.of('alert').length, 0, 'the replaced stream got nothing');
});

test('the relay route hands the alert to the attached tray and answers 503 when there is none', async (t) => {
  const sb = await mint();
  const srv = start(t, sb, { ASKERDO_BEAT_MS: '4000' });
  await srv.line;
  const post = (body) => fetch(sb.base + '/api/relay', { method: 'POST', body });

  const none = await post(RELAY);
  assert.equal(none.status, 503, 'no tray attached');
  assert.deepEqual(await none.json(), { error: 'no tray attached' });

  /* a PAGE stream is not a tray: it never makes the route answer for one */
  const page = stream(t, sb);
  assert.ok(await page.waitFor(() => page.of('hello')[0]));
  assert.equal((await post(RELAY)).status, 503);

  const es = stream(t, sb, '/api/events', popupTray(await instanceOf(sb)));
  assert.ok(await es.waitFor(() => es.of('hello')[0]));
  const ok = await post(RELAY);
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get('cache-control'), 'no-store');
  assert.equal(ok.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(await ok.text(), '', 'a relay has nothing to say back');
  /* the alert arrives on its own event name, and on the tray stream only */
  const frame = await es.waitFor(() => es.of('alert')[0]);
  assert.equal(frame.title, RELAY_ALERT.title);
  assert.equal(page.of('alert').length, 0);

  /* 400 on a body that carries no alert */
  for (const bad of ['{}', '{"alert":null}', '{"alert":42}', '{"alert":[]}', '[]', 'null', 'not json at all']) {
    const res = await post(bad);
    assert.equal(res.status, 400, bad);
    assert.match(res.headers.get('content-type'), /^application\/json/, bad);
  }
  /* and the same 64KB cap every other POST here keeps */
  const big = await post(JSON.stringify({ alert: { ...RELAY_ALERT, pad: 'x'.repeat(70 * 1024) } }));
  assert.equal(big.status, 400);
  assert.deepEqual(await big.json(), { error: 'body too large' });

  /* secret-prefixed like every api route, POST only, and one alert per call */
  assert.equal((await raw(sb.port, '/api/relay', { method: 'POST' })).status, 404);
  assert.equal((await fetch(sb.base + '/api/relay')).status, 404, 'a GET is the flat 404');
  assert.equal(es.of('alert').length, 1, 'nothing above relayed a second one');
});

test('a tray whose socket is gone answers 503, never an alert shown nowhere', async (t) => {
  const sb = await mint();
  const srv = start(t, sb, { ASKERDO_BEAT_MS: '4000' });
  await srv.line;
  const post = () => fetch(sb.base + '/api/relay', { method: 'POST', body: RELAY });

  const es = stream(t, sb, '/api/events', popupTray(await instanceOf(sb)));
  assert.ok(await es.waitFor(() => es.of('hello')[0]));
  assert.equal((await post()).status, 204, 'attached, and the relay is live');

  /* res.write does NOT throw on a socket that is already gone (Node 24), so no catch
     sees a dropped tray: the drop falls THROUGH to the demand, and a channel switched
     off 503s. */
  es.close();
  const after = await post();
  assert.equal(after.status, 503, 'nothing to start, and nothing behind the tray to catch it');
  assert.deepEqual(await after.json(), { error: 'no tray attached' });
  /* the stream was DROPPED, not merely reported: the next one answers the same
     without a socket to look at */
  assert.equal((await post()).status, 503);
});

/* THE TRAY, SHIMMED AS ONE THAT CAN BE STARTED: no suite may
   run the committed exe, so `ensureRunning` opens the server's own events route
   from inside the process and every frame lands in ASKERDO_SHIM_FRAMES. */
const trayOnDemand = () => shimLib('tray.mjs',
  "import { request } from 'node:http';\n"
  + "import { appendFileSync } from 'node:fs';\n"
  + 'export function createTray(deps) {\n'
  + '  const real = REAL.createTray(deps);\n'
  + '  const path = "/" + deps.secret + "/api/events";\n'
  + '  const out = process.env.ASKERDO_SHIM_FRAMES;\n'
  + '  return { ...real, exited: () => "", ensureRunning: () => new Promise((done) => {\n'
  + '    const req = request({ host: "127.0.0.1", port: deps.port, path,\n'
  + '      headers: { "x-askerdo-tray": deps.instance, "x-askerdo-popup": "1" } }, (res) => {\n'
  + '      res.setEncoding("utf8");\n'
  + '      res.on("data", (d) => { try { appendFileSync(out, d); } catch {} });\n'
  + '      done(true);\n'
  + '    });\n'
  + "    req.on('error', () => done(false));\n"
  + '    req.end();\n'
  + '  }) };\n'
  + '}\n');

/* AND THE SAME MODULE WITH ITS TWO SPAWNS TAKEN OUT, for a case that turns the
   channel ON: a real exe attaching would replace the case's stream and raise a
   real popup. `start` and `ensureRunning` are the two doors, both stubbed. */
const trayNoSpawn = () => shimLib('tray.mjs',
  'export function createTray(deps) {\n'
  + '  const real = REAL.createTray(deps);\n'
  + '  return { ...real, start: () => {}, ensureRunning: () => Promise.resolve(false) };\n'
  + '}\n');

/* And the same module with the ONE state the server refuses an alert for: a
   person who chose Exit from the menu. Nothing else is replaced. */
const trayByPerson = () => shimLib('tray.mjs',
  'export function createTray(deps) {\n'
  + "  return { ...REAL.createTray(deps), exited: () => 'byPerson' };\n"
  + '}\n');

const alertCount = (file) => {
  let raw = '';
  try { raw = readFileSync(file, 'utf8'); } catch { return 0; }
  return raw.split('event: alert\n').length - 1;
};

test('an alert with no tray on the stream starts one and lands on it, in the dead-socket window too', async (t) => {
  const sb = await mint();
  const frames = join(tempDir('nd-shim-'), 'frames.log');
  writeFileSync(frames, '');
  const srv = start(t, sb, { ASKERDO_BEAT_MS: '4000', ASKERDO_SHIM_FRAMES: frames },
    [...channelOn(), ...trayOnDemand()]);
  await srv.line;
  const post = () => fetch(sb.base + '/api/relay', { method: 'POST', body: RELAY });

  /* NOTHING IS ATTACHED and the route still answers 204: the demand started a
     tray, the attach arrived inside the window, and the alert went to it */
  const cold = await post();
  assert.equal(cold.status, 204, 'the demand start is what makes this a 204');
  assert.ok(await pollUntil(() => alertCount(frames) >= 1), 'the frame reached the tray stream');
  assert.ok(readFileSync(frames, 'utf8').includes(RELAY_ALERT.title), 'the alert arrives whole');

  /* THE WINDOW: an alert landing between the tray's socket dying and the close
     handler running still makes its demand, because the drop falls THROUGH to the
     demand once. */
  const es = stream(t, sb, '/api/events', popupTray(await instanceOf(sb)));
  assert.ok(await es.waitFor(() => es.of('hello')[0]));
  const was = alertCount(frames);
  es.close();
  const inWindow = await post();
  assert.equal(inWindow.status, 204, 'an alert in that window is never lost');
  assert.ok(await pollUntil(() => alertCount(frames) > was), 'and it landed on the tray started for it');
});

test('a tray the person exited refuses the alert with its reason, in ONE line', async (t) => {
  const sb = await mint();
  const srv = start(t, sb, { ASKERDO_BEAT_MS: '4000' }, [...channelOn(), ...trayByPerson()]);
  await srv.line;

  const res = await fetch(sb.base + '/api/relay', { method: 'POST', body: RELAY });
  assert.equal(res.status, 503, 'the decision stands until this server restarts');
  /* the REASON rides the body, so the notifier's one dropped line can say why */
  assert.deepEqual(await res.json(), { error: 'the tray was exited by the person' });

  const readLog = () => { try { return readFileSync(join(sb.root, 'log'), 'utf8'); } catch { return ''; } };
  const said = () => readLog().split('\n').filter((l) => l.includes('exited by the person'));
  assert.ok(await pollUntil(() => said().length > 0), 'the server names the decision');
  /* ONE LINE PER DROPPED ALERT */
  assert.equal(said().length, 1, readLog());
  assert.ok(!readLog().includes('no tray took'), readLog());
});

test('the stream cap evicts the oldest PAGE, never the tray that attached first', async (t) => {
  const sb = await mint();
  const srv = start(t, sb, { ASKERDO_BEAT_MS: '4000' });
  await srv.line;

  /* the tray attaches at server start and stays for the life of the server, so it is
     the OLDEST stream: a cap that dropped the oldest would drop the TRAY the moment
     enough pages were open, and there is nothing behind it */
  const es = stream(t, sb, '/api/events', popupTray(await instanceOf(sb)));
  assert.ok(await es.waitFor(() => es.of('hello')[0]));

  const ended = [];
  const pages = [];
  for (let i = 0; i < 64; i += 1) {
    const p = stream(t, sb);
    const res = await p.head;
    ended.push(false);
    res.on('end', () => { ended[i] = true; });
    pages.push(p);
  }
  assert.ok(await es.waitFor(() => ended[0]), 'the oldest page went when the cap was reached');
  assert.equal(ended[63], false, 'and the newest is the tab somebody is looking at');

  const ok = await fetch(sb.base + '/api/relay', { method: 'POST', body: RELAY });
  assert.equal(ok.status, 204, 'the tray is still the tray');
  assert.equal((await es.waitFor(() => es.of('alert')[0])).title, RELAY_ALERT.title);
});

/* ---- write-nothing helpers ------------------------------------------------ */

/* The store's diagnostic log, or '' where nothing has written one yet. */
function storeLog(sb) {
  try {
    return readFileSync(join(sb.root, 'log'), 'utf8');
  } catch {
    return '';
  }
}

/* ---- the notifications page and its three routes ------------------ */

/* The board folder as it stands, notify.json apart: the settings routes write
   that ONE file, and this is what proves they wrote nothing else. */
function boardStamp(sb) {
  const dir = join(sb.root, 'board');
  return readdirSync(dir).sort().filter((name) => name !== 'notify.json')
    .map((name) => {
      let body;
      try { body = readFileSync(join(dir, name), 'utf8'); } catch { body = '<not a file>'; }
      return name + ':' + body;
    }).join('|');
}

const settingsOf = (sb) => JSON.parse(readFileSync(join(sb.root, 'board', 'notify.json'), 'utf8'));

test('the notifications page serves under the secret and links no asset off the register',
  async (t) => {
    const sb = await mint();
    const srv = start(t, sb, { ASKERDO_BEAT_MS: '4000' }, channelOn());
    await srv.line;

    const res = await fetch(sb.base + '/notifications');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /^text\/html/);
    const html = await res.text();
    assert.ok(html.includes('<h1>notifications</h1>'));
    /* one row per category, in the map's own order, each with its four controls */
    for (const r of NOTIFY_ROWS) {
      assert.ok(html.includes('data-cat="' + r.key + '"'), r.key);
      assert.ok(html.includes(r.label), r.label);
    }
    assert.equal((html.match(/data-cat="/g) || []).length, CATEGORY_KEYS.length);

    /* THE REGISTER IS THE WHOLE SERVED SET: this page adds no asset of its own,
       so its styles and its script are inline and every asset URL on it is a
       name lib/board-assets.mjs already carries. */
    assert.ok(!html.includes('<script src='), 'the script is inline, like the viewer page');
    const names = [...html.matchAll(/\/assets\/([A-Za-z0-9._-]+)/g)].map((m) => m[1]);
    assert.ok(names.length >= 2, names.join(','));
    for (const name of names) assert.ok(ASSETS[name], name);
    assert.ok(names.includes('house.css'), 'the house sheet is the theme');

    /* the three routes it posts to are its own, under this server's secret */
    assert.ok(html.includes('"/' + sb.secret + '/api/notify"'));
    assert.ok(html.includes('"/' + sb.secret + '/api/notify/test"'));
    /* it links the board, and names no lab page */
    assert.ok(html.includes('<a href="/' + sb.secret + '/">back to the board</a>'));
    assert.ok(!html.includes('notification lab'));
    assert.equal((await fetch(sb.base + '/lab/toasts')).status, 404);

    /* the secret and the method gate every one of the four, like every route */
    assert.equal((await raw(sb.port, '/notifications')).status, 404);
    assert.equal((await raw(sb.port, '/api/notify')).status, 404);
    assert.equal((await raw(sb.port, '/api/notify', { method: 'POST' })).status, 404);
    assert.equal((await fetch(sb.base + '/notifications', { method: 'POST' })).status, 404);
    assert.equal((await fetch(sb.base + '/api/notify/test')).status, 404);
    assert.equal((await fetch(sb.base + '/api/notify/nope')).status, 404);
  });

test('the settings route answers what a page may see, and never the key that names a program',
  async (t) => {
    const sb = await mint();
    const srv = start(t, sb, { ASKERDO_BEAT_MS: '4000' }, channelOn());
    await srv.line;

    /* EVERY SANDBOX IS SEEDED WITH THE THREE SUPERSEDED BOOLEANS, all false, so this
       route is where the derivation is read end to end: `woken:false` silenced every
       open event, `closed:false` the closed row, and `sound:false` all eight. */
    const got = await (await fetch(sb.base + '/api/notify')).json();
    assert.deepEqual(Object.keys(got).sort(),
      ['categories', 'editor', 'enabled', 'pauseLabel', 'pausedUntil', 'quietFrom', 'quietTo',
        'tray']);
    assert.equal(got.enabled, false);
    assert.equal(got.tray, false);
    assert.equal(got.quietFrom, '');
    assert.equal(got.quietTo, '');
    assert.deepEqual(Object.keys(got.categories), CATEGORY_KEYS.slice());
    assert.deepEqual(got.categories.blocking, { show: false, sound: 'silent' });
    assert.deepEqual(got.categories.open, { show: false, sound: 'silent' });
    assert.deepEqual(got.categories.closed, { show: false, sound: 'silent' });
    assert.deepEqual(got.categories['task-completed'], { show: true, sound: 'silent' });
    /* the three the map replaced are not answered either: after a page write
       they are not even in the file */
    for (const gone of ['woken', 'closed', 'sound']) {
      assert.equal(got[gone], undefined, gone);
    }
    /* THE EDITOR TARGET RIDES DELIBERATELY: it is a setting, and a setting on this
       board is edited on a page. The rule that holds whole is that the SERVER NEVER
       RUNS IT; the exe does, off a frame. */
    assert.deepEqual(Object.keys(got.editor).sort(), ['file', 'folder']);
    assert.equal(got.editor.file, 'vscode://file/{path}:{line}:{col}');
    assert.equal(got.editor.folder, 'vscode://file/{path}/');
    /* THE THREE RETIRED KEYS ARE NEVER ANSWERED: openCommand named a program the
       SERVER ran, and nothing migrates one into the editor target */
    const answered = JSON.stringify(got);
    for (const never of ['openPreset', 'openScheme', 'openCommand']) {
      assert.ok(!answered.includes(never), never);
    }
  });

test('a page write patches notify.json alone, and the answer is what was written', async (t) => {
  const sb = await mint();
  const srv = start(t, sb, { ASKERDO_BEAT_MS: '4000' }, channelOn());
  await srv.line;
  const write = (body) => post(sb.base + '/api/notify', body);

  /* a file with no legacy boolean in it, so the rows start at their defaults, plus
     a key a person hand-added and the one the page is never shown. The channel
     stays off, which is every sandbox's own posture. */
  writeFileSync(join(sb.root, 'board', 'notify.json'), JSON.stringify({
    enabled: false, tray: false, openCommand: 'code -g {path}:{line}', mine: 'keep me',
  }, null, 2) + '\n');
  /* the board's OWN lazy writes first (board/view.json lands on the first page
     render), so what this case compares is what the settings routes did and
     not what a first paint did */
  await (await fetch(sb.base + '/')).text();
  await (await fetch(sb.base + '/api/notify')).json();
  const before = boardStamp(sb);

  const one = await write({ categories: { blocking: { sound: 'Mail' } } });
  assert.equal(one.status, 200);
  const body = await one.json();
  assert.equal(body.ok, true);
  /* the settings AS THEY NOW STAND, which is what the page repaints from, and
     still without the three the page may never see */
  assert.deepEqual(Object.keys(body.settings).sort(),
    ['categories', 'editor', 'enabled', 'pauseLabel', 'pausedUntil', 'quietFrom', 'quietTo',
      'tray']);
  assert.equal(body.settings.categories.blocking.sound, 'Mail');
  assert.equal(body.settings.categories.blocking.show, true, 'the rest of the row stands');
  assert.equal(body.settings.categories.open.sound, 'Default', 'and so do the rows beside it');

  const disk = settingsOf(sb);
  assert.equal(disk.categories.blocking.sound, 'Mail');
  assert.equal(disk.mine, 'keep me', 'a hand-added key survives a page write');
  /* THE THREE RETIRED KEYS GO ON THE FIRST WRITE, in the idiom the three
     superseded booleans already use, and NOTHING MIGRATES: the old key named a
     program the SERVER ran and the new one names one the EXE runs */
  assert.equal(disk.openCommand, undefined, 'the retired key is dropped, not carried');
  assert.equal(disk.editor.file, 'vscode://file/{path}:{line}:{col}', 'and the default stands');

  /* one value at a time, each landing over the last, the editor's two templates
     included: they are the one writable key that is an object of its own */
  assert.equal((await write({ tray: true })).status, 200);
  assert.equal((await write({ quietFrom: '22:00' })).status, 200);
  assert.equal((await write({ quietTo: '07:00' })).status, 200);
  assert.equal((await write({ editor: { file: 'zed://file{path}:{line}' } })).status, 200);
  const now = await (await fetch(sb.base + '/api/notify')).json();
  assert.equal(now.tray, true);
  assert.equal(now.enabled, false);
  assert.equal(now.quietFrom, '22:00');
  assert.equal(now.quietTo, '07:00');
  assert.equal(now.editor.file, 'zed://file{path}:{line}');
  assert.equal(now.editor.folder, 'vscode://file/{path}/', 'the template beside it stands');
  assert.equal(now.categories.blocking.sound, 'Mail', 'and the first write is still there');

  /* NOTHING ELSE MOVED: no other board file */
  assert.equal(boardStamp(sb), before);
});

test('the settings route refuses every value outside its table, by name', async (t) => {
  const sb = await mint();
  const srv = start(t, sb, { ASKERDO_BEAT_MS: '4000' }, channelOn());
  await srv.line;
  const write = (body) => post(sb.base + '/api/notify', body);
  const held = JSON.stringify(settingsOf(sb));

  for (const [bad, error] of [
    ['[]', 'body must be a JSON object'],
    ['null', 'body must be a JSON object'],
    ['"x"', 'body must be a JSON object'],
    ['{}', 'nothing to write'],
    ['{"enabled":"yes"}', 'enabled must be true or false'],
    ['{"tray":1}', 'tray must be true or false'],
    ['{"quietFrom":"9:00"}', 'quietFrom must be empty or HH:MM'],
    ['{"quietFrom":"24:00"}', 'quietFrom must be empty or HH:MM'],
    ['{"quietTo":"22:60"}', 'quietTo must be empty or HH:MM'],
    ['{"quietTo":22}', 'quietTo must be empty or HH:MM'],
    ['{"categories":[]}', 'categories must be an object'],
    ['{"categories":null}', 'categories must be an object'],
    ['{"categories":{"nope":{}}}', 'unknown category: nope'],
    ['{"categories":{"ws-closed":{}}}', 'unknown category: ws-closed'],
    ['{"categories":{"open":null}}', 'categories.open must be an object'],
    ['{"categories":{"open":{"show":"yes"}}}', 'categories.open.show must be true or false'],
    /* a toast duration is no key here: a stale page that sends one is refused */
    ['{"categories":{"open":{"duration":"long"}}}', 'unknown key: categories.open.duration'],
    ['{"categories":{"open":{"sound":"Fanfare"}}}',
      'categories.open.sound is not a sound this build knows'],
    ['{"categories":{"open":{"sound":"mail"}}}',
      'categories.open.sound is not a sound this build knows'],
    ['{"categories":{"open":{"nope":1}}}', 'unknown key: categories.open.nope'],
    /* THE EDITOR TARGET is two templates and no third key, each a string this
       file will hold: the exe runs it, so the length is the only other rule */
    ['{"editor":[]}', 'editor must be an object'],
    ['{"editor":null}', 'editor must be an object'],
    ['{"editor":"vscode://file/{path}"}', 'editor must be an object'],
    ['{"editor":{"nope":"x"}}', 'unknown key: editor.nope'],
    ['{"editor":{"preset":"vscode"}}', 'unknown key: editor.preset'],
    ['{"editor":{"file":1}}', 'editor.file must be a string'],
    ['{"editor":{"folder":null}}', 'editor.folder must be a string'],
    ['{"editor":{"file":"' + 'x'.repeat(2049) + '"}}',
      'editor.file must be at most 2048 characters'],
    /* THE CLICK'S OWN FOUR REFUSALS, MADE AT THE WRITE (G2-2): a template every
       later click would answer with a sentence is refused where it is typed */
    ['{"editor":{"file":"javascript://x/{path}"}}',
      'the editor template expands to a scheme this board never opens'],
    ['{"editor":{"folder":"\\"X:/synthetic/ed.exe {path}"}}',
      'the editor template has an unclosed quote'],
    ['{"editor":{"file":"{path} --wait"}}',
      'the editor template names {path} as the program to run; the program has to be your own text'],
    ['{"editor":{"folder":"\\"\\""}}', 'the editor template names no program'],
    /* THE ONE KEY THE PAGE MAY NEVER WRITE, refused BY NAME so a stale page learns
       rather than being quietly ignored. The three old open keys are not here: they
       are dropped from the file, so they are unknown keys. */
    ['{"openPreset":"reveal"}', 'unknown key: openPreset'],
    ['{"openScheme":"x://"}', 'unknown key: openScheme'],
    ['{"openCommand":"cmd.exe /c calc"}', 'unknown key: openCommand'],
    ['{"pausedUntil":"2026-09-13 09:00 +02:00"}',
      'pausedUntil is read by the server and is never written from a page'],
    ['{"shove":1}', 'unknown key: shove'],
    ['{"enabled":true,"shove":1}', 'unknown key: shove'],
    ['not json at all', 'body is not JSON'],
  ]) {
    const res = await write(bad);
    assert.equal(res.status, 400, bad);
    assert.match(res.headers.get('content-type'), /^application\/json/, bad);
    assert.deepEqual(await res.json(), { error }, bad);
  }
  /* the same 64KB cap every other POST here keeps */
  const big = await write(JSON.stringify({ enabled: true, pad: 'x'.repeat(70 * 1024) }));
  assert.equal(big.status, 400);
  assert.deepEqual(await big.json(), { error: 'body too large' });
  /* and NOTHING was written on the way to any of those refusals */
  assert.equal(JSON.stringify(settingsOf(sb)), held);

  /* every value the table DOES accept lands */
  for (const s of [...SOUNDS, 'silent']) {
    assert.equal((await write({ categories: { collapse: { sound: s } } })).status, 200, s);
  }
  assert.equal(settingsOf(sb).categories.collapse.sound, 'silent');
  assert.equal((await write({ quietFrom: '' })).status, 200, 'empty is a real value: it is off');
  /* and an EMPTY template is a real value too: it omits the entry and refuses its
     kind with a sentence, as an absent flag does */
  assert.equal((await write({ editor: { folder: '' } })).status, 200);
  assert.equal(settingsOf(sb).editor.folder, '');
});

test('the test route draws each row card through its production builder, and writes nothing',
  async (t) => {
    const sb = await mint();
    const srv = start(t, sb, { ASKERDO_BEAT_MS: '4000' }, channelOn());
    await srv.line;
    const hit = (body) => post(sb.base + '/api/notify/test', body);
    const es = stream(t, sb, '/api/events', popupTray(await instanceOf(sb)));
    assert.ok(await es.waitFor(() => es.of('hello')[0]));
    /* the board folder apart from notify.json, which the gate writes below on
       purpose, taken once the start's own files are written: this is what proves
       the raises touched no other file */
    const boardBefore = boardStamp(sb);
    const logBefore = storeLog(sb);
    const nth = (n) => es.waitFor(() => (es.of('alert').length >= n ? es.of('alert')[n - 1] : null));

    /* ONE ROW AT A TIME, each card the one the production builder makes for
       that category, wearing the sound on screen */
    let seen = 0;
    for (const key of CATEGORY_KEYS) {
      const answer = await hit({ category: key, sound: 'Mail' });
      assert.equal(answer.status, 200, key);
      const body = await answer.json();
      assert.equal(body.ok, true, key);
      assert.equal(body.path, 'tray', key);
      assert.equal(body.raised, 1, key);
      assert.ok(Number.isInteger(body.ms) && body.ms >= 0, key);
      seen += 1;
      const frame = await nth(seen);
      const want = sampleAlert(sampleShape(key), 'Mail');
      assert.equal(frame.kind, want.kind, key);
      assert.equal(frame.title, want.title, key);
      assert.equal(frame.blocking, key === 'blocking', key + ': only the blocking card stands');
      assert.equal(frame.sound, 'Mail', key);
    }
    assert.equal(seen, 8, 'eight rows went up');
    /* a question row opens its card; the collapse summary names no record */
    assert.ok(es.of('alert')[0].card.endsWith('r/Q0'), es.of('alert')[0].card);
    assert.equal(es.of('alert')[CATEGORY_KEYS.indexOf('collapse')].card, '');

    /* THE PLAY ARROW names the sound and nothing else */
    const play = await hit({ sound: 'Reminder' });
    assert.equal(play.status, 200);
    seen += 1;
    const preview = await nth(seen);
    assert.equal(preview.kind, 'info');
    assert.equal(preview.where, 'Reminder');
    assert.equal(preview.sound, 'Reminder');
    assert.equal(preview.card, '', 'a sound preview has no card to open');

    /* NO GATE IS APPLIED, because you clicked: the channel off, the quiet hours
       covering the whole day, and the row hidden, and the card still goes up */
    assert.equal((await post(sb.base + '/api/notify', { enabled: false })).status, 200);
    assert.equal((await post(sb.base + '/api/notify', { quietFrom: '00:00' })).status, 200);
    assert.equal((await post(sb.base + '/api/notify', { quietTo: '23:59' })).status, 200);
    assert.equal((await post(sb.base + '/api/notify',
      { categories: { open: { show: false } } })).status, 200);
    const ungated = await hit({ category: 'open', sound: 'Default' });
    assert.equal(ungated.status, 200, 'the gates are the store change rules, not a click rule');
    assert.equal((await ungated.json()).raised, 1);
    seen += 1;
    assert.ok(await nth(seen));

    /* IT WRITES NOTHING: not a board file, not a log line */
    assert.equal(boardStamp(sb), boardBefore, 'not one board file besides notify.json');
    assert.equal(storeLog(sb), logBefore, 'not even a log line');
  });

test('the test route refuses what is not a row, and 503s where the channel is off', async (t) => {
  const sb = await mint();
  const srv = start(t, sb, { ASKERDO_BEAT_MS: '4000' }, channelOn());
  await srv.line;
  const hit = (body) => post(sb.base + '/api/notify/test', body);
  const es = stream(t, sb, '/api/events', popupTray(await instanceOf(sb)));
  assert.ok(await es.waitFor(() => es.of('hello')[0]));

  for (const [bad, error] of [
    ['[]', 'a category or a sound is required'],
    ['null', 'a category or a sound is required'],
    ['{}', 'a sound is required'],
    ['{"category":"open"}', 'a sound is required'],
    ['{"sound":"Fanfare"}', 'sound is not a sound this build knows'],
    ['{"category":"nope","sound":"Default"}', 'unknown category: nope'],
    ['{"category":"ws-closed","sound":"Default"}', 'unknown category: ws-closed'],
    ['{"category":"open","duration":"short","sound":"Default"}', 'unknown key: duration'],
    ['{"sound":"Default","shape":"open"}', 'unknown key: shape'],
    ['{"sound":"Default","shove":1}', 'unknown key: shove'],
    ['not json at all', 'body is not JSON'],
  ]) {
    const res = await hit(bad);
    assert.equal(res.status, 400, bad);
    assert.deepEqual(await res.json(), { error }, bad);
  }
  const big = await hit(JSON.stringify({ sound: 'Default', pad: 'x'.repeat(70 * 1024) }));
  assert.equal(big.status, 400);
  assert.deepEqual(await big.json(), { error: 'body too large' });
  await sleep(200);
  assert.equal(es.of('alert').length, 0, 'a refusal is not an alert');

  /* A PLATFORM WITHOUT THE CHANNEL answers in plain words rather than
     pretending, and the page still serves, because the page is what explains
     what is missing. */
  const off = await mint();
  const srv2 = start(t, off, { ASKERDO_BEAT_MS: '4000' }, channelOff());
  await srv2.line;
  const res = await post(off.base + '/api/notify/test', { sound: 'Default' });
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(),
    { error: 'the notification channel is off on this platform' });
  assert.equal((await fetch(off.base + '/notifications')).status, 200);
  /* the settings routes still work there: the file is the file whatever the
     platform can raise */
  assert.equal((await fetch(off.base + '/api/notify')).status, 200);
  assert.equal((await post(off.base + '/api/notify', { enabled: false })).status, 200);
  /* and a typo is still a 400 there: the shape is checked before the platform */
  const typo = await post(off.base + '/api/notify/test', { sound: 'nope' });
  assert.equal(typo.status, 400);
});

/* ---- the tray menu's five fields, the pause verb and the fan-out --- */

/* THE PAUSE IS NOT A FACT ABOUT THE STORE, so it is read off notify.json on
   every frame rather than off the reading, and this is the address it is
   written through. */
const pauseOf = (sb) => {
  try { return JSON.parse(readFileSync(join(sb.root, 'board', 'notify.json'), 'utf8')).pausedUntil; } catch { return null; }
};

test('the pause verb resolves server-side, lands in notify.json, and reaches the menu',
  async (t) => {
    const sb = await mint();
    const srv = start(t, sb, { ASKERDO_WATCH_MS: '100', ASKERDO_BEAT_MS: '4000' },
      channelOn());
    await srv.line;
    const write = (body) => post(sb.base + '/api/notify', body);
    const es = stream(t, sb, '/api/events', { 'x-askerdo-tray': await instanceOf(sb) });
    await es.waitFor(() => es.of('hello')[0]);

    /* `until-resume` is the token, carried through as itself */
    const forever = await write({ pause: 'until-resume' });
    assert.equal(forever.status, 200);
    const fbody = await forever.json();
    assert.equal(fbody.settings.pausedUntil, 'until-resume');
    assert.equal(fbody.settings.pauseLabel, 'until I resume');
    assert.equal(pauseOf(sb), 'until-resume', 'the write landed in notify.json');
    /* THE TICK IS KICKED, so the frame goes on the next turn rather than at the
       watcher's next period: this is what puts a pause on the menu at once */
    const held = await es.waitFor(() => es.of('change')
      .find((e) => e.tray.pausedUntil === 'until-resume'));
    assert.equal(held.tray.pauseLabel, 'until I resume');

    /* `hour` and `tomorrow` become STAMPS the server computed off its own clock */
    for (const [token, shape] of [
      ['hour', /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/],
      ['tomorrow', /T07:00:00[+-]\d\d:\d\d$/],
    ]) {
      const res = await write({ pause: token });
      assert.equal(res.status, 200, token);
      const body = await res.json();
      assert.match(body.settings.pausedUntil, shape, token);
      assert.match(body.settings.pauseLabel, /^until \d\d:\d\d( tomorrow)?$/, token);
      assert.equal(pauseOf(sb), body.settings.pausedUntil, token);
    }

    /* RESUME, and it must NOT hit the empty-patch refusal: a POST of
       { pause: '' } produces a pausedUntil of '' in the patch, which is a
       non-empty patch, or Resume would be unclickable */
    const resume = await write({ pause: '' });
    assert.equal(resume.status, 200);
    const rbody = await resume.json();
    assert.equal(rbody.settings.pausedUntil, '');
    assert.equal(rbody.settings.pauseLabel, '');
    assert.equal(pauseOf(sb), '');
    const back = await es.waitFor(() => es.of('change')
      .find((e) => e.tray.pausedUntil === '' && e.tray.pauseLabel === ''));
    assert.ok(back);
  });

test('the pause verb refuses a stamp by name and an unknown token by value', async (t) => {
  const sb = await mint();
  const srv = start(t, sb, { ASKERDO_BEAT_MS: '4000' }, channelOn());
  await srv.line;
  const write = (body) => post(sb.base + '/api/notify', body);
  const held = JSON.stringify(settingsOf(sb));

  /* A STAMP A CLIENT COMPUTED IS A CLOCK THE SERVER CANNOT CHECK, so the value
     is refused BY NAME, in NOTIFY_NEVER's own wording */
  for (const body of [
    '{"pausedUntil":"2026-09-09T15:40:00+00:00"}',
    '{"pausedUntil":""}',
    '{"pausedUntil":"until-resume"}',
    '{"pause":"hour","pausedUntil":"2026-09-09T15:40:00+00:00"}',
  ]) {
    const res = await write(body);
    assert.equal(res.status, 400, body);
    assert.deepEqual(await res.json(),
      { error: 'pausedUntil is read by the server and is never written from a page' }, body);
  }

  /* and an unknown token names the four values it could have been */
  const four = "pause must be one of hour, tomorrow, until-resume, ''";
  for (const body of [
    '{"pause":"week"}', '{"pause":"HOUR"}', '{"pause":"resume"}',
    '{"pause":" "}', '{"pause":true}', '{"pause":3}', '{"pause":null}', '{"pause":[]}',
  ]) {
    const res = await write(body);
    assert.equal(res.status, 400, body);
    assert.deepEqual(await res.json(), { error: four }, body);
  }
  /* nothing was written on the way to any of those refusals */
  assert.equal(JSON.stringify(settingsOf(sb)), held);
});

/* THE FAN-OUT'S THIRD REASON TO SEND. A notify.json write moves no record and writes
   no activity line, so without this a pause would fan out nothing at all and the menu
   would keep showing a pause that had ended. */
test('a change with only the tray digest moved still fans out, and nothing moved does not',
  async (t) => {
    const sb = await mint();
    const srv = start(t, sb, { ASKERDO_WATCH_MS: '60', ASKERDO_BEAT_MS: '4000' },
      channelOn());
    await srv.line;
    const es = stream(t, sb, '/api/events', { 'x-askerdo-tray': await instanceOf(sb) });
    await es.waitFor(() => es.of('hello')[0]);

    /* THE PAUSE IS THE WHOLE CHANGE: no record moved, no activity line was
       written, and the event still goes out */
    assert.equal((await post(sb.base + '/api/notify', { pause: 'until-resume' })).status, 200);
    const only = await es.waitFor(() => es.of('change')
      .find((e) => e.tray.pausedUntil === 'until-resume'));
    assert.deepEqual(only.activity, [], 'no activity line');

    /* AND NOTHING MOVING IS STILL NOTHING: several watch periods with no write
       of any kind send no further change */
    const after = es.of('change').length;
    await sleep(400);
    assert.equal(es.of('change').length, after, 'a still board sends nothing at all');

    /* a settings write that is NOT the pause moves no tray field either, so it
       is not a reason to send on its own */
    assert.equal((await post(sb.base + '/api/notify',
      { categories: { open: { sound: 'Mail' } } })).status, 200);
    await sleep(400);
    assert.equal(es.of('change').length, after, 'the tray digest did not move');
  });

/* THE DIGEST'S EIGHTH PART: an open writes board/recent.json,
   which moves no record and writes no activity line, exactly as a notify.json
   write does not, so the digest is the only thing that carries it to the menu. */
test('an open reaches the tray menu on the next tick, newest first and re-resolved',
  async (t) => {
    const board = await onBoard(t);
    const sb = await mint();
    const docs = tempDir('nd-refs-', t);
    const files = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth']
      .map((n) => join(docs, n + '.md'));
    for (const f of files) writeFileSync(f, '# a file\n');
    const rec = await board.verb('createRecord', {
      kind: 'task', name: 'recent demo', description: 'A record naming six files.', refs: files,
    });
    const tools = openEnv(t, { ASKERDO_WATCH_MS: '60', ASKERDO_BEAT_MS: '4000' });
    await startOn(t, sb, board, tools.env, [...trayNoOpen(), ...openOnWin()]);
    const es = await trayOn(t, sb);
    const open = (n) => post(sb.base + '/f/' + rec.id + '/' + n + '/open', { kind: 'open' });
    const row = (n, name) => ({ id: rec.id, index: n, name });
    assert.deepEqual(es.of('hello')[0].tray.recent, [], 'nothing opened, nothing shown');

    /* THE ROUTE KICKS THE TICK, so the open reaches the menu in the same breath
       as the click, and NO RECORD MOVED on the way: the eighth part is why the
       fan-out sent this one at all */
    assert.equal((await open(0)).status, 200);
    const one = await es.waitFor(() => es.of('change').find((e) => e.tray.recent.length === 1));
    assert.deepEqual(one.tray.recent, [row(0, 'first.md')]);
    assert.deepEqual(one.activity, [], 'no activity line');

    /* NEWEST FIRST, and NO ABSOLUTE PATH RIDES THE TRAY OBJECT: that payload goes
       to every consumer on every change, and a menu line needs a label and a way
       to ask, not a path. The paths live in the store's own untracked file. */
    assert.equal((await open(1)).status, 200);
    const two = await es.waitFor(() => es.of('change').find((e) => e.tray.recent.length === 2));
    assert.deepEqual(two.tray.recent, [row(1, 'second.md'), row(0, 'first.md')]);
    assert.ok(!JSON.stringify(two.tray).includes(JSON.stringify(docs).slice(1, -1)),
      'no path rides the tray object');
    const disk = JSON.parse(readFileSync(join(sb.root, 'board', 'recent.json'), 'utf8'));
    assert.deepEqual(disk.opens.map((e) => e.path), [resolvePath(files[1]), resolvePath(files[0])]);
    assert.equal(disk.opens[0].kind, 'open');
    assert.match(disk.opens[0].at, FULL_STAMP, 'the store has one stamp format');

    /* FIVE ON THE MENU AND NO SIXTH, whatever the file holds: the wire carries
       what a menu can draw, and the file is the longer history behind it */
    for (const n of [2, 3, 4, 5]) assert.equal((await open(n)).status, 200, 'index ' + n);
    const full = await es.waitFor(() => es.of('change')
      .find((e) => e.tray.recent.length === 5 && e.tray.recent[0].index === 5));
    assert.deepEqual(full.tray.recent.map((r) => r.name),
      ['sixth.md', 'fifth.md', 'fourth.md', 'third.md', 'second.md']);
    assert.equal(JSON.parse(readFileSync(join(sb.root, 'board', 'recent.json'), 'utf8'))
      .opens.length, 6, 'and the file kept the sixth');

    /* A REPEAT MOVES A ROW RATHER THAN ADDING ONE: an id plus an index is the one
       identity, so the menu never draws the same file twice */
    assert.equal((await open(0)).status, 200);
    const moved = await es.waitFor(() => es.of('change')
      .find((e) => e.tray.recent.length === 5 && e.tray.recent[0].index === 0));
    assert.deepEqual(moved.tray.recent.map((r) => r.name),
      ['first.md', 'sixth.md', 'fifth.md', 'fourth.md', 'third.md']);

    /* EVERY READER RE-RESOLVES BEFORE IT RENDERS: dropping the LAST ref drops
       that line from the menu and the next one moves up, which keeps the refs
       list the only path authority even for a list of paths. */
    const sent = es.of('change').length;
    await board.verb('editRecord', { id: rec.id, removeRef: [files[5]] });
    const gone = await es.waitFor(() => es.of('change').slice(sent)
      .find((e) => !e.tray.recent.some((r) => r.name === 'sixth.md')));
    assert.deepEqual(gone.tray.recent.map((r) => r.name),
      ['first.md', 'fifth.md', 'fourth.md', 'third.md', 'second.md']);
    assert.equal(demandCount(tools.demands), 0, 'a tray was attached throughout');
  });

/* THE CLOCK RUNNING OUT IS A CHANGE, and the one change that leaves no trace: a
   lapsed stamp is never rewritten, so `pauseLabel` is recomputed per tick and
   goes EMPTY on the lapse, or the exe keeps drawing a pause that has ended. */
test('a pause lapsing on the clock alone moves the tray digest and fans out', async (t) => {
  const sb = await mint();
  const srv = start(t, sb, { ASKERDO_WATCH_MS: '60', ASKERDO_BEAT_MS: '4000' },
    channelOn());
  await srv.line;
  const es = stream(t, sb, '/api/events', { 'x-askerdo-tray': await instanceOf(sb) });
  await es.waitFor(() => es.of('hello')[0]);

  /* A STAMP A FEW SECONDS OUT, WRITTEN STRAIGHT INTO notify.json: the route
     only ever takes a token an hour or a morning away, and `pausedUntil` is
     refused by name, so the file is the one seam a short pause fits through. */
  const stamp = stampFor(new Date(Date.now() + 4000));
  writeFileSync(join(sb.root, 'board', 'notify.json'),
    JSON.stringify({ ...settingsOf(sb), pausedUntil: stamp }, null, 2) + '\n');

  const on = await es.waitFor(() => es.of('change').find((e) => e.tray.pausedUntil === stamp));
  assert.ok(on, 'the stamped pause reached the stream');
  assert.match(on.tray.pauseLabel, /^until \d\d:\d\d/, 'the words the menu prints');
  const whileHeld = es.of('change').length;

  /* AND NOW NOTHING HAPPENS EXCEPT THE CLOCK PASSING THE STAMP: no record
     moves, no activity line is written, notify.json is never touched again */
  const off = await es.waitFor(() => es.of('change')
    .find((e) => e.tray.pauseLabel === '' && e.tray.pausedUntil === stamp));
  assert.ok(off, 'the lapse alone was a reason to send');
  assert.deepEqual(off.activity, [], 'no activity line');
  assert.equal(pauseOf(sb), stamp, 'and the lapsed stamp was never rewritten');
  assert.ok(es.of('change').length > whileHeld);
});

/* THE TEST BUTTON IS NEVER PAUSED: you clicked. */
test('a live pause silences the board alerts and leaves the test route raising', async (t) => {
  const { verb, env } = await onBoard(t);
  const sb = await mint();
  writeFileSync(join(sb.root, 'board', 'notify.json'), JSON.stringify({ enabled: true, tray: true }) + '\n');
  const srv = start(t, sb, { ...env, ASKERDO_WATCH_MS: '100', ASKERDO_BEAT_MS: '4000' },
    [...channelOn(), ...trayNoSpawn()]);
  await srv.line;
  assert.ok(await boardLoaded(sb));
  const es = stream(t, sb, '/api/events', popupTray(await instanceOf(sb)));
  await es.waitFor(() => es.of('hello')[0]);

  assert.equal((await post(sb.base + '/api/notify', { pause: 'until-resume' })).status, 200);
  await es.waitFor(() => es.of('change').find((e) => e.tray.pausedUntil === 'until-resume'));
  const before = es.of('alert').length;

  /* a question opening under a live pause raises nothing */
  await verb('register', asked({ name: 'under the pause' }), { session: 'sess-a' });
  await es.waitFor(() => es.of('change').find((e) => e.tray.blocking === 1));
  await sleep(300);
  assert.equal(es.of('alert').length, before, 'the pause is a gate like the others');

  /* and the Test button still goes up */
  const hit = await post(sb.base + '/api/notify/test', { category: 'open', sound: 'Default' });
  assert.equal(hit.status, 200);
  assert.equal((await hit.json()).raised, 1);
  assert.ok(await es.waitFor(() => (es.of('alert').length > before ? true : null)));
});

/* ---- the alert entry point and the popup's stream event ---------- */

test('the alert route draws the popup on a tray that announced one, and nothing on one that did not',
  async (t) => {
    const board = await onBoard(t);
    const sb = await mint();
    const { q } = await seedEvidence(t, board.verb);
    const srv = await startOn(t, sb, board, { ASKERDO_BEAT_MS: '4000' }, [...trayNoSpawn()]);
    const post = (body) => fetch(sb.base + '/api/alert',
      { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });
    const base = 'http://127.0.0.1:' + sb.port + '/' + sb.secret + '/';
    const ask = { kind: 'blocker', title: q.id + ' needs you', where: 'WS-11', card: q.id, files: true };

    /* the sandbox leaves the channel off, and the alert keeps the notify gates */
    assert.deepEqual(await (await post(ask)).json(),
      { ok: true, via: 'held', reason: 'notifications are off' });
    writeFileSync(join(sb.root, 'board', 'notify.json'), JSON.stringify({ enabled: true, tray: true }) + '\n');
    const none = await post(ask);
    assert.equal(none.status, 503, 'no tray attached, and nothing behind it');

    /* an exe that never announced the popup gets nothing, never a toast */
    const inst = await instanceOf(sb);
    const old = stream(t, sb, '/api/events', { 'x-askerdo-tray': inst });
    assert.ok(await old.waitFor(() => old.of('hello')[0]));
    const refused = await post(ask);
    assert.equal(refused.status, 503);
    assert.ok((await refused.json()).error.includes('popup'), 'the refusal names the reason');
    await sleep(200);
    assert.equal(old.of('alert').length + old.of('toast').length, 0);

    /* the popup exe gets the frame, with the files as id, position and name */
    const es = stream(t, sb, '/api/events', { 'x-askerdo-tray': inst, 'x-askerdo-popup': '1' });
    assert.ok(await es.waitFor(() => es.of('hello')[0]));
    const viaPopup = await post(ask);
    assert.deepEqual(await viaPopup.json(), { ok: true, via: 'popup', files: 2 });
    const frame = await es.waitFor(() => es.of('alert')[0]);
    assert.deepEqual(Object.keys(frame), ['kind', 'title', 'where', 'blocking', 'card', 'files', 'sound', 'question']);
    assert.equal(frame.kind, 'blocker');
    assert.equal(frame.blocking, true);
    assert.equal(frame.card, base + 'r/' + q.id);
    assert.deepEqual(frame.files, [
      { id: q.id, index: 0, name: 'proof.md' }, { id: q.id, index: 2, name: 'blob.dat' },
    ], 'no path rides the wire, and a ref not on disk is not offered');
    assert.ok(!JSON.stringify(frame).includes(sb.root), 'no store path either');
    assert.equal(es.of('toast').length + old.of('toast').length, 0, 'no toast event is ever written');
    const one = await post({ ...ask, files: [2, 3] });
    assert.deepEqual(await one.json(), { ok: true, via: 'popup', files: 1 });

    /* 400 on a shape the popup cannot draw or a link off this board */
    for (const bad of [
      '{}', 'null', 'not json', { kind: 'nope', title: 'x' }, { kind: 'info' },
      { kind: 'info', title: 'x', card: 'https://example.com/' },
      { kind: 'info', title: 'x', files: true },
      { kind: 'info', title: 'x', card: 'work', files: [0] },
    ]) {
      const res = await post(bad);
      assert.equal(res.status, 400, JSON.stringify(bad));
    }
    assert.equal((await fetch(sb.base + '/api/alert')).status, 404, 'a GET is the flat 404');

    /* the pause holds an alert like any other, and says so */
    writeFileSync(join(sb.root, 'board', 'notify.json'),
      JSON.stringify({ enabled: true, tray: true, pausedUntil: 'until-resume' }) + '\n');
    assert.deepEqual(await (await post(ask)).json(), { ok: true, via: 'held', reason: 'paused' });
    assert.equal(es.of('alert').length, 2);
  });

test('the relay and the board hand a popup tray the alert, and one it cannot resolve is the plain card',
  async (t) => {
    const { verb, env } = await onBoard(t);
    /* on the board before the server starts, so the working set names them */
    const bw = await verb('createRecord', { kind: 'workstream', name: 'work system build', description: 'One board.', projects: ['C:/repos/my-app'] });
    const bt = await verb('createRecord', { kind: 'task', name: 'counter rebuild', description: 'A step.', workstream: bw.id });
    const sb = await mint();
    writeFileSync(join(sb.root, 'board', 'notify.json'), JSON.stringify({ enabled: true, tray: true }) + '\n');
    const srv = start(t, sb, { ...env, ASKERDO_WATCH_MS: '100', ASKERDO_BEAT_MS: '4000' },
      [...channelOn(), ...trayNoSpawn()]);
    await srv.line;
    assert.ok(await boardLoaded(sb));
    const base = 'http://127.0.0.1:' + sb.port + '/' + sb.secret + '/';
    const es = stream(t, sb, '/api/events',
      { 'x-askerdo-tray': await instanceOf(sb), 'x-askerdo-popup': '1' });
    assert.ok(await es.waitFor(() => es.of('hello')[0]));

    /* the CLI's relay body: the alert alone */
    const res = await fetch(sb.base + '/api/relay', { method: 'POST', body: JSON.stringify({
      alert: { kind: 'done', title: 'counter rebuild completed', card: 'T-1' },
    }) });
    assert.equal(res.status, 204);
    const done = await es.waitFor(() => es.of('alert')[0]);
    assert.equal(done.kind, 'done');
    assert.equal(done.card, base + 'r/T-1');
    assert.equal(done.xml, undefined, 'no toast document rides the frame');
    /* the work ending sent no names, so the server fills them from its cache */
    assert.equal(done.place, ['my-app', 'work system build'].join(' · '));
    /* a request the popup cannot resolve is the plain card off its title, never nothing */
    await fetch(sb.base + '/api/relay', { method: 'POST',
      body: JSON.stringify({ alert: { kind: 'nope', title: 'a stray shape', where: 'its second line' } }) });
    const plain = await es.waitFor(() => es.of('alert').find((a) => a.title === 'a stray shape'));
    assert.equal(plain.kind, 'info');
    assert.equal(plain.where, 'its second line');
    assert.equal(plain.card, '');

    /* the board's question, as an alert */
    const qa = await verb('register', asked({ name: 'the popup shape' }), { session: 'sess-a' });
    const q = await es.waitFor(() => es.of('alert').find((a) => a.title === 'the popup shape'));
    assert.equal(q.kind, 'blocker');
    assert.equal(q.blocking, true);
    assert.equal(q.card, base + 'r/' + qa.id);
    assert.match(q.where, /blocks work/);

    /* the card names the project, workstream and held task, and the pick */
    await verb('register', asked({ name: 'the named shape', workstream: bw.id, gates: [bt.id] }), { session: 'sess-a' });
    const named = await es.waitFor(() => es.of('alert').find((a) => a.title === 'the named shape'));
    assert.equal(named.place, ['my-app', 'work system build', 'holds up counter rebuild'].join(' \u00B7 '));
    assert.equal(named.pick, 'single file', 'the option name, never its letter');
    assert.equal(es.of('toast').length, 0, 'no toast event is ever written');
  });
