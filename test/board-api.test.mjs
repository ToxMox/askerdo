/* The board server's API and event stream, over a real socket on
   127.0.0.1: what a PC hits when it writes, reconnects or signs in the phone. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { request } from 'node:http';
import { join } from 'node:path';
import { childEnv, tempDir } from './helpers/sandbox.mjs';
import { runCli } from './helpers/cli.mjs';

process.removeAllListeners('warning');
const { boardCall, boardEvents, boardJoin, boardJoinCode, boardLoginLink, boardRequest, startBoard } = await import('../lib/board-call.mjs');
const { newToken, revokeToken } = await import('../server/api.mjs');
const { dataDir, storeRoot } = await import('../lib/node-helpers.mjs');
const { hostDir } = await import('../lib/board-host.mjs');

process.env.ASKERDO_SANDBOX_HOME = tempDir('askerdo-store-');

function useBoard(b) {
  process.env.ASKERDO_BOARD_URL = b.url;
  process.env.ASKERDO_BOARD_TOKEN = b.token;
}

function raw(url, headers = {}) {
  return new Promise((ok, fail) => {
    request(url, { headers }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => ok({ status: res.statusCode, headers: res.headers, body }));
    }).on('error', fail).end();
  });
}

async function until(fn, ms = 2000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 5));
  }
}

const lastSeq = (db) => db.prepare('SELECT max(seq) AS s FROM activity').get().s;

test('a verb over HTTP with a device token writes and reads back; no token or a revoked one is refused', async () => {
  const b = await startBoard();
  try {
    useBoard(b);
    const ws = await boardCall('createRecord', { kind: 'workstream', name: 'Board', description: 'One board.' }, { session: 's1' });
    assert.equal((await boardCall('readRecord', ws.id)).name, 'Board');
    const row = b.db.prepare('SELECT pc, actor FROM activity ORDER BY seq DESC LIMIT 1').get();
    assert.deepEqual([row.pc, row.actor], ['test', 'session:s1'], 'the PC comes from the token, the session from the body');

    /* the workstream view in one read, each task with its position for the layout */
    const tr = await boardCall('newTrack', { name: 'Line', workstream: ws.id });
    await boardCall('capture', { track: tr.id, name: 'First' });
    await boardCall('capture', { track: tr.id, name: 'Second' });
    const view = await boardRequest('GET', '/api/v1/workstreams/' + ws.id);
    const pos = view.tracks[0].tasks.map((t) => t.position);
    assert.ok(pos.length === 2 && pos[0] < pos[1]);

    const verb = '/api/v1/verbs/listWork';
    await assert.rejects(boardRequest('POST', verb, { input: { kind: 'task' } }, { url: b.url, token: '' }), { status: 401 });
    const other = newToken(b.db, 'pc2');
    assert.ok(Array.isArray(await boardRequest('POST', verb, { input: { kind: 'task' } }, { url: b.url, token: other.token })));
    revokeToken(b.db, 'pc2');
    await assert.rejects(boardRequest('POST', verb, { input: { kind: 'task' } }, { url: b.url, token: other.token }), { status: 401 });
  } finally { await b.close(); }
});

test('a PC on another protocol version gets a plain message naming both', async () => {
  const b = await startBoard();
  try {
    const r = await raw(b.url + '/api/v1/snapshot', { authorization: 'Bearer ' + b.token, 'x-askerdo-protocol': '99' });
    assert.equal(r.status, 426);
    const msg = JSON.parse(r.body).error;
    assert.match(msg, /99/);
    assert.match(msg, /speaks (protocol )?1\b/);
    assert.doesNotMatch(r.body, /at .*\.mjs/, 'never a stack');
  } finally { await b.close(); }
});

test('a PC resuming from its cursor gets exactly the missing events, in order, once, then each commit live', async () => {
  const b = await startBoard();
  const streams = [];
  try {
    useBoard(b);
    const ws = await boardCall('createRecord', { kind: 'workstream', name: 'Board', description: 'One board.' });
    const cursor = lastSeq(b.db);
    await boardCall('createRecord', { kind: 'task', name: 'One', description: 'A step.', workstream: ws.id });
    await boardCall('createRecord', { kind: 'task', name: 'Two', description: 'A step.', workstream: ws.id });
    const missed = b.db.prepare('SELECT seq FROM activity WHERE seq > ? ORDER BY seq').all(cursor).map((r) => r.seq);

    const got = [];
    streams.push(boardEvents({ after: cursor, onEvent: (name, data, id) => { if (name !== 'ping' && name !== 'board') got.push({ name, id, data }); } }));
    await until(() => got.length >= missed.length);
    await boardCall('createRecord', { kind: 'task', name: 'Three', description: 'A step.', workstream: ws.id });
    const all = b.db.prepare('SELECT seq FROM activity WHERE seq > ? ORDER BY seq').all(cursor).map((r) => r.seq);
    await until(() => got.length >= all.length);
    await new Promise((r) => setTimeout(r, 30));
    assert.deepEqual(got.map((e) => e.id), all, 'each missing row once, in order, then the live one');
    assert.ok(got.every((e) => e.name === 'activity'));
    const three = got[got.length - 1].data.head;
    assert.deepEqual([three.kind, three.title, three.status], ['task', 'Three', 'open']);
    assert.equal(three.body, undefined);

    /* no cursor: the working set first, stamped with the sequence to resume from */
    const fresh = [];
    streams.push(boardEvents({ onEvent: (name, data, id) => fresh.push({ name, id, data }) }));
    await until(() => fresh.length >= 2);
    /* each connection names the board's version first, the plugin's it was built from */
    const version = JSON.parse(readFileSync(join(import.meta.dirname, '..', '.claude-plugin', 'plugin.json'), 'utf8')).version;
    assert.deepEqual([fresh[0].name, fresh[0].data.version, fresh[0].id], ['board', version, undefined]);
    assert.equal(fresh[1].name, 'snapshot');
    assert.equal(fresh[1].id, lastSeq(b.db));
    assert.equal(JSON.parse((await raw(b.url + '/health')).body).version, version, '/health says it too');
    const both = await runCli(['--version', '--json'], { env: { ...childEnv(), ASKERDO_BOARD_URL: b.url } });
    assert.deepEqual([both.code, JSON.parse(both.out).pc, JSON.parse(both.out).board.version], [0, version, version]);
    /* a board that does not answer is said, and the command still succeeds */
    const gone = await runCli(['--version', '--json'], { env: { ...childEnv(), ASKERDO_BOARD_URL: 'http://127.0.0.1:9' } });
    assert.deepEqual([gone.code, JSON.parse(gone.out).board.answering], [0, false]);
  } finally {
    for (const s of streams) s.close();
    await b.close();
  }
});

test('a login link sets the web cookie once and never again; a page without it, or after a revoke, is the sign-in page', async () => {
  const b = await startBoard();
  try {
    useBoard(b);
    const ws = await boardCall('createRecord', { kind: 'workstream', name: 'Lighthouse rebuild', description: 'One board.' });
    const out = await raw(b.url + '/r/' + ws.id);
    assert.equal(out.status, 401);
    assert.match(out.headers['content-type'], /html/);
    assert.doesNotMatch(out.body, /Lighthouse rebuild/, 'no board data before sign-in');
    const link = await boardLoginLink('/r/T-1', { url: b.url, token: b.token });
    const first = await raw(link.url);
    assert.equal(first.status, 302);
    assert.equal(first.headers.location, '/r/T-1');
    const cookie = String(first.headers['set-cookie']).split(';')[0];
    const read = await raw(b.url + '/api/v1/snapshot', { cookie, 'x-askerdo-protocol': '1' });
    assert.equal(read.status, 200);
    assert.match((await raw(b.url + '/r/' + ws.id, { cookie })).body, /Lighthouse rebuild/);
    assert.equal((await raw(link.url)).status, 410);

    /* a revoked device's browser (a lost phone) is signed out with it */
    revokeToken(b.db, 'test');
    assert.equal((await raw(b.url + '/r/' + ws.id, { cookie })).status, 401);
    assert.equal((await raw(b.url + '/api/v1/snapshot', { cookie, 'x-askerdo-protocol': '1' })).status, 401);
  } finally { await b.close(); }
});

test('a join code puts a new PC on the board once, within its ten minutes, under the name it was minted for, and never cuts off a PC already on it', async () => {
  const b = await startBoard();
  try {
    const minted = await boardJoinCode(undefined, { url: b.url, token: b.token });
    assert.doesNotMatch(minted.code, /[01OIL]/, 'nothing read two ways off a screen');
    /* an unnamed code refuses a name holding a live token, the minter's own included, and stays unspent */
    await assert.rejects(boardJoin(b.url, minted.code, 'test'), (e) => e.status === 403 && /--device test/.test(e.message));

    /* the first PC saves the token token new printed, and its --seed puts its options on an empty board */
    const firstEnv = { ...childEnv(), ASKERDO_SANDBOX_HOME: tempDir('askerdo-store-') };
    const firstFile = join(dataDir(firstEnv), 'config.json');
    mkdirSync(dataDir(firstEnv), { recursive: true });
    writeFileSync(firstFile, JSON.stringify({ name: 'Robin', weather: false, queue: 'text' }));
    const first = await runCli(['join', b.url, '--token', b.token, '--seed'], { env: firstEnv });
    assert.equal(first.code, 0, first.err);
    assert.ok(!first.out.includes(b.token), 'the token stays in the config');
    /* a PC already on a board hosts no second one, and the refusal writes nothing */
    const before = readFileSync(firstFile, 'utf8');
    const here = await runCli(['board', 'here', '--seed'], { env: firstEnv });
    assert.notEqual(here.code, 0);
    assert.ok(here.err.includes(b.url), here.err);
    assert.equal(readFileSync(firstFile, 'utf8'), before);
    assert.equal(existsSync(hostDir(storeRoot(undefined, firstEnv))), false);
    /* a board holding options keeps them: the seed pulls instead */
    writeFileSync(firstFile, JSON.stringify({ name: 'Someone', queue: 'text' }));
    assert.equal((await runCli(['join', b.url, '--token', b.token, '--seed'], { env: firstEnv })).code, 0);
    const firstCfg = JSON.parse(readFileSync(firstFile, 'utf8'));
    assert.deepEqual([firstCfg.weather, firstCfg.boardToken], [false, b.token]);

    /* the new PC's join pulls the options the first PC seeded, adds the board's three keys and prints no token */
    const home = tempDir('askerdo-store-');
    const env = { ...childEnv(), ASKERDO_SANDBOX_HOME: home };
    const dir = dataDir(env);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ name: 'Ada', queue: 'text' }));
    const r = await runCli(['join', b.url + '/', minted.code.toLowerCase(), '--device', 'pc2'], { env });
    assert.equal(r.code, 0, r.err);
    const cfg = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'));
    assert.deepEqual([cfg.weather, cfg.queue, cfg.boardUrl], [false, 'hub', b.url]);
    assert.ok(!r.out.includes(cfg.boardToken), 'the token stays in the config');
    assert.ok(Array.isArray(await boardRequest('POST', '/api/v1/verbs/listWork', { input: { kind: 'task' } }, { url: b.url, token: cfg.boardToken })));
    const line = b.db.prepare("SELECT line, pc FROM activity WHERE verb = 'join'").get();
    assert.equal(line.pc, 'pc2');
    assert.match(line.line, /"test"/, 'the line names the PC that minted the code');

    await assert.rejects(boardJoin(b.url, minted.code, 'pc3'), { status: 403 }, 'used once');
    const late = await boardJoinCode(undefined, { url: b.url, token: b.token });
    await assert.rejects(boardRequest('POST', '/api/v1/join', { code: late.code, device: 'pc3', opts: { now: Date.now() + 11 * 60000 } }, { url: b.url, token: '' }),
      { status: 403 }, 'expired');
    /* a rejoin: only a code minted for pc2's name replaces it, and its old token goes */
    const named = await boardJoinCode('pc2', { url: b.url, token: b.token });
    await assert.rejects(boardJoin(b.url, named.code, 'pc5'), { status: 403 });
    assert.equal((await boardJoin(b.url, named.code, 'pc2')).device, 'pc2');
    await assert.rejects(boardRequest('POST', '/api/v1/verbs/listWork', { input: { kind: 'task' } }, { url: b.url, token: cfg.boardToken }), { status: 401 });

    /* a code dies with its minter's token */
    const orphan = await boardJoinCode(undefined, { url: b.url, token: b.token });
    revokeToken(b.db, 'test');
    await assert.rejects(boardJoin(b.url, orphan.code, 'pc6'), { status: 403 });
  } finally { await b.close(); }
});

test('a board with no PC takes its setup code once, days later too, a restart replaces it, and a board with a PC mints none', async () => {
  const { newSetupCode } = await import('../server/api.mjs');
  const b = await startBoard();
  const join = (code, device, later = 0) => boardRequest('POST', '/api/v1/join', { code, device, opts: { now: Date.now() + later } }, { url: b.url, token: '' });
  try {
    assert.equal(newSetupCode(b.db), null, 'a board with a device mints none');
    revokeToken(b.db, 'test');
    const old = newSetupCode(b.db);
    const setup = newSetupCode(b.db);
    await assert.rejects(join(old.code, 'first'), { status: 403 }, 'a restart replaced it');
    assert.equal((await join(setup.code, 'first', 3 * 86400000)).device, 'first', 'it outlives the ten minutes of a join code');
    await assert.rejects(join(setup.code, 'second'), { status: 403 }, 'used once');
    assert.equal(newSetupCode(b.db), null, 'none once a PC is on the board');
  } finally { await b.close(); }
});

/* another Windows account on the PC reaches loopback too, so the route takes the secret file */
test('the admin route takes the secret the board wrote beside its database, and backup writes its own folder alone', async () => {
  const dataDir = tempDir('askerdo-store-');
  const elsewhere = tempDir('askerdo-store-');
  const b = await startBoard({ dataDir });
  const call = (headers) => fetch(b.url + '/admin/backup', { method: 'POST', headers, body: JSON.stringify({ dir: elsewhere }) });
  try {
    assert.equal((await call({})).status, 403);
    assert.equal((await call({ 'x-askerdo-admin': 'guess' })).status, 403);
    const r = await call({ 'x-askerdo-admin': readFileSync(join(dataDir, 'admin-secret'), 'utf8') });
    assert.equal(r.status, 200);
    assert.ok(existsSync((await r.json()).result.file) && readdirSync(elsewhere).length === 0, 'the folder in the body is never written');
  } finally { await b.close(); }
});

test('the kit holds the Dockerfile and a compose file with the chosen port and zone on host folders, and refuses a folder in use', async () => {
  const { writeKit } = await import('../server/kit.mjs');
  const dir = join(tempDir('askerdo-store-'), 'kit');
  writeKit(dir, { port: 18999, tz: 'Europe/Berlin' });
  assert.ok(existsSync(join(dir, 'server', 'Dockerfile')));
  const compose = readFileSync(join(dir, 'compose.yaml'), 'utf8');
  assert.match(compose, /"18999:18999"/);
  assert.match(compose, /TZ: Europe\/Berlin/);
  assert.doesNotMatch(compose, /\$\{/, 'the port and zone are written in, never read from the shell');
  assert.match(compose, /\.\/data:\/data/);
  assert.doesNotMatch(compose, /^volumes:/m, 'no named volumes in a kit');
  assert.throws(() => writeKit(dir, { port: 17480 }));
  assert.match(readFileSync(join(dir, 'compose.yaml'), 'utf8'), /"18999:18999"/, 'the refused write left the kit alone');
  // configure runs the kit on PCs whose Node cannot host a board
  const bare = join(tempDir('askerdo-store-'), 'kit');
  const r = spawnSync(process.execPath, ['--no-experimental-sqlite', join(import.meta.dirname, '..', 'server', 'cli.mjs'), 'kit', bare], { env: childEnv(), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(join(bare, 'compose.yaml')));
});
