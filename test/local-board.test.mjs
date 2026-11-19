/* Each PC's local server, its board half: the event client, the
   cache, the inbox lines by sequence, the long poll and offline, over a test
   board on 127.0.0.1. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createServer, request } from 'node:http';
import { join } from 'node:path';
import { quietPort, tempDir } from './helpers/sandbox.mjs';

process.removeAllListeners('warning');
process.env.ASKERDO_SANDBOX_HOME = tempDir('askerdo-store-');
const { boardCall, boardRequest, startBoard } = await import('../lib/board-call.mjs');
const { createLocalBoard } = await import('../lib/local-board.mjs');
const { newToken } = await import('../server/api.mjs');
const { handleLocal } = await import('../lib/local-route.mjs');
const { lineFor, tellingsOf } = await import('../lib/local-inbox.mjs');
const { dataDir, storeRoot } = await import('../lib/node-helpers.mjs');
const { runCommand } = await import('../lib/cli-commands.mjs');

const OPTIONS = [
  { type: 'a', option: 'one file', getsYou: 'simple', costsYou: 'contention' },
  { type: 'b', option: 'a server', getsYou: 'one writer', costsYou: 'a box to run' },
];

/* a verb on the board as another PC's session or the user would call it */
const on = (b) => (name, input, body = {}) => boardRequest('POST', '/api/v1/verbs/' + name,
  { input, ...body, opts: { strict: false, inherit: false } }, { url: b.url, token: b.token });
const ask = (post, name, session) => post('register', {
  name, gist: name + '?', projectDir: 'C:/repos/app', session, blocking: false, ask: 'One (a) or a server (b, my pick)?', pick: 'b', options: OPTIONS,
}, { session });

function local(b, dir, extra = {}) {
  const alerts = [];
  const retracts = [];
  const lb = createLocalBoard({
    url: b.url, token: b.token, stateDir: join(dir, 'state'), inboxDir: join(dir, 'inbox'), alert: (t) => alerts.push(t),
    retract: (id) => retracts.push(id), ...extra,
  });
  lb.alerts = alerts;
  lb.retracts = retracts;
  lb.start();
  return lb;
}

/* settled: every row the board wrote is in the cache */
async function caught(lb, b) {
  const top = b.db.prepare('SELECT coalesce(max(seq), 0) AS s FROM activity').get().s;
  const end = Date.now() + 3000;
  while (!(lb.status().loaded && lb.status().seq >= top)) {
    if (Date.now() > end) throw new Error('the cache never reached ' + top + ': ' + JSON.stringify(lb.status()));
    await lb.wait(lb.status().seq, 200);
  }
  await lb.idle();
}

/* the board's next n record reads answer 500, as a board that stumbles does: stumble(n) */
function failReads(b) {
  const srv = b.api.server;
  const [handle] = srv.listeners('request');
  let left = 0;
  srv.removeAllListeners('request');
  srv.on('request', (req, res) => {
    if (left > 0 && req.method === 'GET' && req.url.includes('/records/')) {
      left -= 1;
      res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'the board stumbled' }));
      return;
    }
    handle(req, res);
  });
  return (n) => { left = n; };
}

const inbox = (dir, session) => {
  try { return readFileSync(join(dir, 'inbox', session + '.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; }
};

test('a question asked and answered through the CLI lands on the board; its answer reaches the asking and subscribed sessions and an alert, not the answering one, and a task ending alerts', async () => {
  const b = await startBoard();
  const dir = tempDir('askerdo-store-');
  const lb = local(b, dir);
  /* through the CLI: the commands write the board, the local board tells the inboxes */
  const env = { ...process.env, ASKERDO_BOARD_URL: b.url, ASKERDO_BOARD_TOKEN: b.token };
  const cli = async (argv, stdin) => {
    const r = await runCommand({ argv, cwd: dir, env, stdin });
    assert.equal(r.code, 0, argv.join(' ') + ': ' + r.stderr);
    return r;
  };
  try {
    const q = JSON.parse((await cli(['register', '--json'], JSON.stringify({
      name: 'where the board lives', gist: 'Where?', projectDir: 'C:/repos/app', session: 's1', blocking: false,
      ask: 'One (a) or a server (b, my pick)?', pick: 'b', options: OPTIONS,
    }))).stdout);
    assert.equal(b.db.prepare('SELECT status FROM records WHERE key = ?').get(q.key).status, 'open', 'the question is on the board');
    await cli(['subscribe', q.id, '--session', 's3']);
    await caught(lb, b);
    /* a letter typed after the id is pointed at --pick, never recorded as a pickless note */
    const slip = await runCommand({ argv: ['answer', q.id, 'b'], cwd: dir, env, stdin: '' });
    assert.notEqual(slip.code, 0);
    assert.match(slip.stderr, /--pick/);
    await cli(['answer', q.id, '--pick', 'b', '--note', 'one writer', '--session', 's2']);
    await caught(lb, b);
    const lines = inbox(dir, 's1');
    assert.equal(lines.length, 1);
    assert.equal(lines[0].kind, 'answer');
    assert.equal(lines[0].id, q.id);
    assert.equal(lines[0].pick, 'b');
    assert.ok(Number.isInteger(lines[0].seq), 'the line carries its activity sequence');
    assert.deepEqual(inbox(dir, 's3').map((l) => l.id), [q.id], 'a subscribed session hears it too');
    assert.deepEqual(inbox(dir, 's2'), [], 'the session that answered is not told its own answer');
    const closed = lb.alerts.flatMap((t) => t.questions).find((t) => t.kind === 'closed');
    assert.ok(closed && closed.id === q.id && closed.status === 'answered', 'the tray hears the answer');
    /* a corrected answer raises no second closed alert */
    await cli(['answer', q.id, '--pick', 'a', '--amend', '--session', 's2']);
    await caught(lb, b);
    assert.equal(lb.alerts.flatMap((t) => t.questions).filter((t) => t.kind === 'closed').length, 1);
    assert.equal(lb.record(q.id), null, 'an answered question leaves the open set');
    /* answering a snoozed question raises no closed alert */
    const later = JSON.parse((await cli(['register', '--json'], JSON.stringify({
      name: 'later', gist: 'Later?', projectDir: 'C:/repos/app', session: 's1', blocking: false,
      ask: 'One (a) or a server (b, my pick)?', pick: 'b', options: OPTIONS,
    }))).stdout);
    await cli(['snooze', later.id, '--trigger', 'after the move', '--user', 's1']);
    await cli(['answer', later.id, '--pick', 'a', '--session', 's2']);
    await caught(lb, b);
    /* --user is the user's own press, told to the session as theirs */
    assert.match(lineFor(inbox(dir, 's1').find((l) => l.kind === 'snooze') || {}) || '', /by the user/);
    /* the board's own change is told as the board's, never another session's */
    assert.match(lineFor({ kind: 'task-edit', id: 'T-9', name: 'A review', by: 'board:upkeep', detail: 'status open' }), /by the board/);
    /* migration 015's blocked line reaches the holder with its note, saying where to read on what */
    const blocked = await tellingsOf({ kind: 'task', verb: 'edit', id: 'T-9', head: { label: 'T-9', inHand: 's1' }, changes: { status: ['blocked', 'open'] },
      by: 'board:migration', note: 'it was blocked, which is no stored status now: its last note says on what', seq: 1 }, { holder: () => null });
    assert.match(lineFor(blocked.lines[0].line), /blocked.*last note/);
    /* the app's close of another session's run names the app alone as who acted */
    const appClose = await tellingsOf({ kind: 'task', verb: 'run', id: 'T-9', head: { label: 'T-9', track: 'TR-1' }, by: 'session:s1', seq: 2,
      changes: { run: [1, null], worker: ['session', null], how: [null, 'closed_idle'] } }, { holder: () => 's2' });
    assert.ok(/closed by the app/.test(lineFor(appClose.lines[0].line)) && !/app by another session/.test(lineFor(appClose.lines[0].line)), lineFor(appClose.lines[0].line));
    /* a placement answer's inbox event carries the task it created, for the mod's relayed line */
    const made = { id: 'T-5', track: 'TR-1', before: ['T-1'], after: [] };
    const placed = await tellingsOf({ kind: 'question', verb: 'answer', id: 'Q7', head: { label: 'Q7', session: 's1' }, by: 'user:s9', seq: 3,
      changes: { chosen: [null, 'a'], outcome: [null, 'here'], created: [null, made] } }, { question: async () => ({ session: 's1' }), holder: () => null });
    assert.deepEqual([placed.lines[0].line.outcome, placed.lines[0].line.created], ['here', made]);
    assert.equal(inbox(dir, 's1').at(-1).id, later.id, 'the asker still hears the answer');
    assert.ok(!lb.alerts.flatMap((t) => t.questions).some((t) => t.kind === 'closed' && t.id === later.id), 'no closed alert from snoozed');
    /* the user's press in a session on this PC draws no tray popup (the mod toasted it); a web answer does */
    const post = on(b);
    const pressed = await ask(post, 'pressed on the band', 's1');
    const web = await ask(post, 'answered on the web', 's1');
    await lb.call('answer', { input: { id: pressed.id, pick: 'a' }, user: 's4' });
    await post('answer', { id: web.id, pick: 'a' }, { user: true });
    await caught(lb, b);
    const popped = lb.alerts.flatMap((t) => t.questions).filter((t) => t.kind === 'closed').map((t) => t.id);
    assert.ok(!popped.includes(pressed.id), 'a press through a session here pops nothing');
    assert.ok(popped.includes(web.id), 'a web answer still pops up');
    /* every settled question takes its popup cards, a press here and a snooze included */
    for (const id of [q.id, later.id, pressed.id, web.id]) assert.ok(lb.retracts.includes(id), id + ' is retracted');
    /* a note on a task reaches the board's journal; activity's newest row is the mod's change marker */
    const t = JSON.parse((await cli(['task', 'create', '--json'], JSON.stringify({ name: 'wire the board', description: 'd', wake: '2099-01-01' }))).stdout);
    await cli(['note', t.id, '--body', 'noted from the CLI', '--session', 's1']);
    assert.ok(b.db.prepare('SELECT body FROM notes WHERE record = ?').all(t.key).some((n) => n.body.includes('noted from the CLI')));
    const top = JSON.parse((await cli(['activity', '--limit', '1', '--json'])).stdout).lines[0];
    assert.equal(top.at, String(b.db.prepare('SELECT max(seq) AS s FROM activity').get().s));
    assert.equal(top.id, t.id);
    /* a session ending a task raises its alert; the same ending made by hand raises none */
    const t2 = JSON.parse((await cli(['task', 'create', '--json'], JSON.stringify({ name: 'by hand', description: 'd', wake: '2099-01-01' }))).stdout);
    /* in a session's shell a filing is that session's; a payload or flag naming another is refused */
    const shell = { ...env, CLAUDE_CODE_SESSION_ID: 's1' };
    const filed = (more, flags = []) => runCommand({ argv: ['task', 'create', ...flags, '--json'], cwd: dir, env: shell, stdin: JSON.stringify({ name: 'shell', description: 'd', wake: '2099-01-01', ...more }) });
    for (const r of [await filed({ session: 's9' }), await filed({}, ['--session', 's9']), await filed({}, ['--session', 's9', '--user', 's1'])]) assert.ok(r.code !== 0 && r.stderr.includes('s9'), r.stderr);
    const own = await filed({ session: 's1', unplaced: 'no plan reaches it yet' });
    assert.equal(own.code, 0, own.stderr);
    /* a tier 2 capture from the CLI files at the real place its --before names */
    const run = async (argv) => { const r = await runCommand({ argv: [...argv, '--json'], cwd: dir, env: shell, stdin: '' }); assert.equal(r.code, 0, r.stderr); return JSON.parse(r.stdout); };
    const ws = b.db.prepare("SELECT label FROM records WHERE kind = 'workstream'").get().label;
    const line = await run(['track', 'new', '--workstream', ws, '--name', 'held', '--session', 's1']);
    const first = await run(['track', 'capture', '--tier', '2', '--track', line.id, '--name', 'first']);
    const found = await run(['track', 'capture', '--tier', '2', '--track', line.id, '--name', 'found', '--before', first.id]);
    assert.ok(b.db.prepare('SELECT 1 FROM depends WHERE task = ? AND "on" = ?').get(first.key, found.key), 'the task --before names waits on it');
    await cli(['task', 'edit', t2.id, '--status', 'dropped']);
    await cli(['task', 'edit', t.id, '--status', 'done', '--session', 's1']);
    await caught(lb, b);
    const ended = lb.alerts.flatMap((x) => x.work).find((w) => w.id === t.id);
    assert.equal(ended && ended.ending, 'done', 'the tray hears the task end');
    assert.ok(!lb.alerts.flatMap((x) => x.work).some((w) => w.id === t2.id), 'an ending made by hand is not news');
    /* a rename re-keys the project in one row; the cache reads it again whole and this PC's map follows */
    const box = b.db.prepare("SELECT key FROM records WHERE kind = 'workstream' AND json_extract(fields, '$.projectRepos[0]') = 'c:/repos/app'").get().key;
    const file = join(dataDir(env), 'local', 'projects.json');
    mkdirSync(join(dataDir(env), 'local'), { recursive: true });
    writeFileSync(file, JSON.stringify({ 'c:/repos/app': 'C:/repos/app' }));
    await cli(['projects', 'rename', 'c:/repos/app', 'github.com/example/app']);
    await caught(lb, b);
    assert.deepEqual(lb.cache.workstreams.get(box).projectRepos, ['github.com/example/app']);
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { 'github.com/example/app': 'C:/repos/app' });
  } finally { await lb.stop(); await b.close(); }
});

test('a restart resumes from the saved cursor and writes each inbox line once', async () => {
  const b = await startBoard();
  const dir = tempDir('askerdo-store-');
  const post = on(b);
  let lb = local(b, dir);
  const q1 = await ask(post, 'first', 's1');
  const q2 = await ask(post, 'second', 's1');
  const q3 = await ask(post, 'third', 's1');
  await caught(lb, b);
  await post('answer', { id: q1.id, pick: 'a' }, { user: true });
  await caught(lb, b);
  await lb.stop();

  /* the crash window: the line for the last row landed, the cursor did not move */
  const cursorFile = join(dir, 'state', 'cursor.json');
  const c = JSON.parse(readFileSync(cursorFile, 'utf8'));
  writeFileSync(cursorFile, JSON.stringify({ ...c, seq: c.seq - 1 }));
  /* while this PC is down, the user answers and drops on another */
  await post('answer', { id: q2.id, pick: 'b', note: 'later' }, { user: true });
  await post('drop', { id: q3.id, note: 'moot' }, { user: true });

  lb = local(b, dir);
  try {
    await caught(lb, b);
    const told = () => inbox(dir, 's1').map((l) => l.id + ' ' + l.kind);
    assert.deepEqual(told(), [q1.id + ' answer', q2.id + ' answer', q3.id + ' drop']);
    const seqs = inbox(dir, 's1').map((l) => l.seq);
    assert.equal(new Set(seqs).size, seqs.length, 'no sequence is told twice');
    assert.deepEqual(lb.alerts, [], 'a restart replays no alerts');
    assert.ok(lb.retracts.includes(q3.id), 'a catch-up still takes the cards of a settled question');
    await lb.stop();
    lb = local(b, dir);
    await caught(lb, b);
    assert.deepEqual(told(), [q1.id + ' answer', q2.id + ' answer', q3.id + ' drop'], 'a second restart tells nothing again');

    /* the board restored from an older copy: this PC's cursor is ahead of it */
    await lb.stop();
    const ahead = b.db.prepare('SELECT max(seq) AS s FROM activity').get().s + 40;
    writeFileSync(cursorFile, JSON.stringify({ ...c, seq: ahead }));
    lb = local(b, dir);
    await caught(lb, b);
    assert.equal((await lb.wait(ahead, 5000)).changed, true, 'a poll from before the restore is answered');
    const q4 = await ask(post, 'fourth', 's1');
    await caught(lb, b);
    assert.ok(lb.record(q4.id), 'a question asked after the restore reaches the cache');
    await post('answer', { id: q4.id, pick: 'b' }, { user: true });
    await caught(lb, b);
    assert.equal(told().at(-1), q4.id + ' answer', 'and its answer reaches the inbox');
    assert.ok(lb.status().seq < ahead, 'the status seq follows the board');

    /* this PC rejoins under a new device name: a session still waiting under the old one is still this PC's */
    const q5 = await ask(post, 'fifth', 's1');
    await caught(lb, b);
    await lb.stop();
    await post('answer', { id: q5.id, pick: 'a' }, { user: true });
    lb = local({ url: b.url, token: newToken(b.db, 'renamed').token }, dir);
    await caught(lb, b);
    assert.equal(told().at(-1), q5.id + ' answer');
  } finally { await lb.stop(); await b.close(); }
});

/* the local route as the mod reaches it: a real socket under <secret>/local/ */
async function route(lb, timing) {
  const srv = createServer((req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    if (path.startsWith('/s/local/')) return handleLocal(lb, req, res, path.slice(9), timing);
    res.writeHead(404).end();
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  const base = 'http://127.0.0.1:' + srv.address().port + '/s/local/';
  const call = (method, path, body) => new Promise((ok, fail) => {
    const text = body === undefined ? '' : JSON.stringify(body);
    const req = request(base + path, { method, headers: text ? { 'content-type': 'application/json' } : {} }, (res) => {
      let s = '';
      res.on('data', (c) => { s += c; });
      res.on('end', () => ok({ status: res.statusCode, body: JSON.parse(s) }));
    });
    req.on('error', fail);
    req.end(text || undefined);
  });
  return { base, call, close: () => new Promise((ok) => { srv.closeAllConnections(); srv.close(ok); }) };
}

/* a board a release older than the plugin, in front of `b`: no picture verbs */
async function older(b, status = 404) {
  const srv = createServer((req, res) => {
    if (/\/verbs\/picture(View|Overview)$/.test(req.url)) return res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: false, error: 'no such verb' }));
    const { host, ...headers } = req.headers;
    const up = request(b.url + req.url, { method: req.method, headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    up.on('error', () => res.destroy());
    req.pipe(up);
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  return { url: 'http://127.0.0.1:' + srv.address().port, token: b.token, close: () => new Promise((ok) => { srv.closeAllConnections(); srv.close(ok); }) };
}

test('a change on the board answers a held long poll; the CLI\'s boardCall goes through the local route', async () => {
  const b = await startBoard();
  const dir = tempDir('askerdo-store-');
  const lb = local(b, dir);
  const seen = [];
  const r = await route(lb, (verb) => seen.push(verb));
  try {
    await caught(lb, b);
    const ws = await on(b)('createRecord', { kind: 'workstream', name: 'Board', description: 'One board.' });
    await caught(lb, b);
    const at = lb.status().seq;
    const held = r.call('GET', 'wait?after=' + at + '&ms=5000');
    let answered = false;
    held.then(() => { answered = true; });
    await new Promise((ok) => setTimeout(ok, 50));
    assert.equal(answered, false, 'nothing changed, so the poll is held');

    /* the PC default: boardCall reaches the board through this PC's local server */
    process.env.ASKERDO_BOARD_URL = b.url;
    process.env.ASKERDO_BOARD_TOKEN = b.token;
    const boardDir = join(storeRoot(), 'board');
    mkdirSync(boardDir, { recursive: true });
    writeFileSync(join(boardDir, 'local.json'), JSON.stringify({ board: b.url, url: r.base.replace(/\/$/, '') }));
    const t = await boardCall('newTrack', { name: 'Line', workstream: ws.id }, { session: 's1' });
    assert.ok(seen.includes('newTrack'), 'the write went through the local route');
    /* a command the local server answered links through its signed root */
    const reg = await runCommand({ argv: ['register', '--json'], cwd: dir, env: process.env, stdin: JSON.stringify({
      name: 'via the route', gist: 'Route?', projectDir: 'C:/repos/app', session: 's1', blocking: false, ask: 'One (a) or a server (b, my pick)?', pick: 'b', options: OPTIONS,
    }) });
    assert.ok(JSON.parse(reg.stdout).boardUrl.startsWith(r.base.replace(/local\/$/, 'r/')), reg.stderr);

    const w = (await held).body.result;
    assert.ok(w.changed && w.seq > at, 'the held poll answers once the change is in the cache');
    const task = await boardCall('capture', { track: t.id, name: 'First' }, { session: 's1' });
    await caught(lb, b);
    const g = (await r.call('GET', 'graph/' + ws.id)).body.result;
    assert.equal(g.view.tracks[0].id, t.id, 'the workstream view in the cache carries the new track');
    assert.ok(g.view.tracks[0].tasks.some((x) => x.id === task.id) && g.picture && g.picture.workstream === ws.id, 'and its picture, as the band carries it');
    assert.equal((await r.call('GET', 'graph/' + ws.id + '?picture=0')).body.result.view.tracks[0].id, t.id, 'the view alone, for a shelf card');
    /* a never-held track is on the shelf at its first ready task, with no track or handoff event between */
    const nobody = await on(b)('newTrack', { name: 'Untaken', workstream: ws.id });
    await caught(lb, b);
    await on(b)('capture', { track: nobody.id, name: 'Its first' });
    await caught(lb, b);
    const untaken = (await r.call('GET', 'band?session=s1')).body.result;
    assert.ok(untaken.shelf.some((row) => row.track === nobody.id && row.ready === 1), 'the new track is on the shelf: ' + JSON.stringify(untaken.shelf));
    /* the mod's band read carries the shelf, so a parked or waiting line needs no other read */
    await boardCall('parkTrack', { track: t.id, reason: 'later' }, { session: 's1' });
    await caught(lb, b);
    const band = (await r.call('GET', 'band?session=s1')).body.result;
    assert.ok(band.shelf.some((row) => row.track === t.id && row.state === 'parked'), 'the parked track is on the band\'s shelf');
  } finally {
    delete process.env.ASKERDO_BOARD_URL;
    delete process.env.ASKERDO_BOARD_TOKEN;
    await r.close(); await lb.stop(); await b.close();
  }
});

test('a question asked from a repo is in that folder\'s band whole after a fresh fill; with the board down, reads come back stale, the band says why and a write fails plainly', async () => {
  /* a quiet port: once the board closes, nothing else takes it */
  const b = await startBoard({ port: await quietPort() });
  const stumble = failReads(b);
  const dir = tempDir('askerdo-store-');
  /* a real checkout with a remote, registered through the CLI, before this PC's cache fills */
  const repo = join(dir, 'app');
  execFileSync('git', ['init', '-q', repo]);
  execFileSync('git', ['-C', repo, 'remote', 'add', 'origin', 'https://github.com/acme/app.git']);
  const env = { ...process.env, ASKERDO_BOARD_URL: b.url, ASKERDO_BOARD_TOKEN: b.token };
  const reg = await runCommand({ argv: ['register', '--json'], cwd: repo, env, stdin: JSON.stringify({
    name: 'still open', gist: 'Open?', projectDir: repo, session: 's1', blocking: false, stakes: '**Cost:** one box', ask: 'One (a) or a server (b, my pick)?', pick: 'b', options: OPTIONS,
  }) });
  assert.equal(reg.code, 0, reg.stderr);
  /* two from elsewhere: another session's in this repo, another project's */
  const near = await runCommand({ argv: ['register', '--json'], cwd: repo, env, stdin: JSON.stringify({
    name: 'next door', gist: 'Near?', projectDir: repo, session: 's2', blocking: false, ask: 'One (a) or two (b)?', options: OPTIONS }) });
  assert.equal(near.code, 0, near.stderr);
  await on(b)('register', { name: 'from tides', gist: 'Far?', projectDir: 'C:/repos/tides', session: 's2', blocking: false, ask: 'One (a) or two (b)?', options: OPTIONS }, { session: 's2' });
  /* a snoozed one is asleep, in no open count */
  const nap = await on(b)('register', { name: 'asleep in tides', gist: 'Later?', projectDir: 'C:/repos/tides', session: 's2', blocking: true, ask: 'One (a) or two (b)?', options: OPTIONS }, { session: 's2' });
  await on(b)('snooze', { id: nap.id, until: '2099-01-02', trigger: 'the move lands' }, { session: 's2' });
  /* the alert runs after the register row's record read, so a snooze sent from it lands in the same burst after that read */
  let napNow = null;
  let live = true;
  const lb = local(b, dir, { alert: async (t) => { if (napNow) await napNow(t); } });
  const r = await route(lb);
  try {
    await caught(lb, b);
    const first = (await r.call('GET', 'band?session=s1&project=' + encodeURIComponent(repo))).body.result;
    assert.equal(first.model.total, 1, 'the band scopes by the shared name register wrote');
    assert.deepEqual(first.scope, { repo: 'github.com/acme/app', name: 'app' });
    /* another project's row names it; this PC is the device the board knows it by, from the first band */
    assert.deepEqual(first.elsewhere.questions.map((x) => [x.name, x.project]), [['next door', undefined], ['from tides', 'tides']]);
    assert.deepEqual([first.elsewhere.blocking, first.elsewhere.waiting], [0, 2]);
    assert.deepEqual(first.asleep.map((x) => [x.name, x.project]), [['asleep in tides', 'tides']]);
    assert.match(first.asleep[0].wake, /Jan 2.* or .*the move lands/);
    /* registered and snoozed back to back while live, the burst's later row is not answered from the earlier read */
    const snoozed = new Promise((ok) => {
      napNow = async (t) => {
        const q = t.questions.find((x) => x.name === 'snoozed at once');
        if (!q) return;
        napNow = null;
        /* the queue's tail moves only when a row joins it, so this row ends with the snooze row queued behind it */
        const tail = lb.idle();
        await on(b)('snooze', { id: q.id, until: '2099-01-02' }, { session: 's2' });
        for (const end = Date.now() + 3000; lb.idle() === tail;) {
          if (Date.now() > end) throw new Error('the snooze row never reached the queue');
          await new Promise((w) => setTimeout(w, 5));
        }
        ok();
      };
    });
    const quick = await on(b)('register', { name: 'snoozed at once', gist: 'Now?', projectDir: 'C:/repos/tides', session: 's2', blocking: true, ask: 'One (a) or two (b)?', options: OPTIONS }, { session: 's2' });
    await snoozed;
    await caught(lb, b);
    const nap2 = (await r.call('GET', 'band?session=s1&project=' + encodeURIComponent(repo))).body.result;
    assert.ok(nap2.asleep.some((x) => x.id === quick.id), 'asleep: ' + JSON.stringify(nap2.asleep));
    assert.deepEqual([nap2.elsewhere.blocking, nap2.elsewhere.waiting, lb.tray().blocking], [0, 2, 0]);
    assert.equal(lb.tray().asleep, 2);
    /* a record read the board fails is no record gone: the question stays and is read again */
    const far = nap2.elsewhere.questions.find((x) => x.name === 'from tides');
    stumble(1);
    await on(b)('snooze', { id: far.id, until: '2099-01-03' }, { session: 's2' });
    await caught(lb, b);
    const nap3 = (await r.call('GET', 'band?session=s1&project=' + encodeURIComponent(repo))).body.result;
    assert.ok(nap3.asleep.some((x) => x.id === far.id), 'asleep: ' + JSON.stringify(nap3.asleep));
    assert.deepEqual([nap3.elsewhere.waiting, lb.tray().asleep], [1, 3]);
    assert.equal(first.here.pc, 'test');
    /* the cached question keeps show's shape, the board link and who asked; this project's own names no project */
    const q = first.questions[0];
    assert.deepEqual([q.pick, q.asker, q.boardUrl.endsWith(q.key), q.project], ['b', 's1', true, undefined]);
    assert.ok(q.stakes, 'the stakes survive a fresh fill');
    /* a refusal the board gave keeps its reason; a network failure reads offline alone */
    const stranger = local({ url: b.url, token: 'not-a-token' }, tempDir('askerdo-store-'));
    try {
      await stranger.wait(stranger.status().seq, 3000);
      assert.match((await stranger.band()).board, /token/, 'the board\'s own refusal');
    } finally { await stranger.stop(); }
    /* online, a verb's own result is no read from the cache, so the envelope says no stale */
    const ws = await on(b)('createRecord', { kind: 'workstream', name: 'Board', description: 'One board.' });
    const t = await on(b)('newTrack', { name: 'Line', workstream: ws.id });
    const up = await r.call('POST', 'verbs/trackSummary', { input: { track: t.id } });
    assert.deepEqual([up.body.result.now, up.body.stale], [[], undefined]);
    await caught(lb, b);
    await b.close();
    live = false;
    await lb.wait(lb.status().seq, 3000);
    const band = (await r.call('GET', 'band?session=s1&project=' + encodeURIComponent(repo))).body.result;
    assert.equal(band.offline, true);
    assert.ok(!band.board.includes(new URL(b.url).host) && !/E[A-Z]{4,}/.test(band.board), 'no address or error code: ' + band.board);
    assert.equal(band.model.total, 1, 'the band still draws from the cache');
    assert.equal(band.questions[0].boardUrl, undefined, 'seams S37: offline the card carries no link out');
    const rd = await r.call('POST', 'verbs/profileList', { input: {} });
    assert.equal(rd.status, 200);
    assert.equal(rd.body.stale, true, 'a cached read is marked stale');
    const wr = await r.call('POST', 'verbs/createRecord', { input: { kind: 'task', name: 'x' } });
    assert.equal(wr.status, 503);
    assert.match(wr.body.error, /offline/, 'the write fails with a plain message and nothing is queued');
    assert.ok(!/E[A-Z]{4,}/.test(wr.body.error), 'the write refusal carries no error code either: ' + wr.body.error);
  } finally { await r.close(); await lb.stop(); if (live) await b.close(); }
});

test('an answer reaches the session holding the question\'s track, and gates added to a blocker reach the gated task\'s holder', async () => {
  const b = await startBoard();
  const dir = tempDir('askerdo-store-');
  const lb = local(b, dir);
  const post = on(b);
  try {
    const ws = await post('createRecord', { kind: 'workstream', name: 'Board', description: 'One board.' });
    /* h1 holds the track (a resumed leg is a new session on the same track) */
    const task = await post('createRecord', { kind: 'task', name: 'wire it', description: 'd', workstream: ws.id, wake: '2099-01-01' });
    const tr = await post('newTrack', { name: 'Line', workstream: ws.id, tasks: [task.id] }, { session: 'h1' });
    await post('upkeepSwitch', { on: true });
    await post('editRecord', { id: task.id, inHand: true }, { session: 'h2' });
    const q = await post('register', {
      name: 'which port', gist: 'Port?', projectDir: 'C:/repos/app', session: 's1', blocking: true, workstream: ws.id, track: tr.id,
      ask: 'One (a) or a server (b, my pick)?', pick: 'b', options: OPTIONS,
    }, { session: 's1' });
    await caught(lb, b);
    await post('editQuestion', { id: q.id, addGate: [task.id] }, { user: true });
    await caught(lb, b);
    /* the board starts the task for h2, and h2 is not told its own change back */
    assert.ok(!inbox(dir, 'h2').some((l) => l.id === task.id), 'h2 hears nothing of taking it in hand');
    const gated = inbox(dir, 'h2').find((l) => l.id === q.id);
    assert.ok(gated && gated.kind === 'question-edit' && gated.detail.includes(task.id), 'T-5: the gated task\'s holder hears the new blocker');
    /* an open question reworded to blocking reaches the holder of the task it gates */
    const later = { name: 'which host', gist: 'Host?', projectDir: 'C:/repos/app', session: 's1', blocking: false, workstream: ws.id, track: tr.id,
      gates: [task.id], ask: 'Here (a) or there (b, my pick)?', pick: 'b', options: OPTIONS };
    const q2 = await post('register', later, { session: 's1' });
    await caught(lb, b);
    assert.ok(!inbox(dir, 'h2').some((l) => l.id === q2.id), 'a question that does not block tells no holder');
    await post('editQuestion', { id: q2.id, payload: { ...later, blocking: true } }, { session: 's1' });
    await caught(lb, b);
    assert.ok(inbox(dir, 'h2').some((l) => l.id === q2.id && l.kind === 'question-edit' && l.detail.includes(task.id)), 'the gated task\'s holder hears it blocks now');
    await post('answer', { id: q2.id, pick: 'a' }, { user: 'p2' });
    await post('answer', { id: q.id, pick: 'a' }, { user: 'p2' });
    await caught(lb, b);
    assert.ok(inbox(dir, 'h1').some((l) => l.id === q.id && l.kind === 'answer'), 'the track holder hears the answer');
    /* the note the answer writes on the gated task reaches its holder, not a session the answer itself reached */
    const gateNote = (s) => inbox(dir, s).some((l) => l.kind === 'task-note' && String(l.detail).startsWith(q.id + ' ('));
    assert.deepEqual([gateNote('h2'), gateNote('h1')], [true, false]);
    assert.deepEqual(inbox(dir, 'p2'), [], 'pressed in a session that does not own it, the answer is not told there');
    /* a task taken over: the session that had it in hand hears it */
    await post('taskUpdate', { id: task.id, inHand: true, takeOver: true }, { session: 'h3' });
    await caught(lb, b);
    assert.ok(inbox(dir, 'h2').some((l) => l.id === task.id && /taken over/.test(l.detail)), 'the old holder hears the take-over');
    /* a let-go reaches the line's holder as a let-go, from the run's line */
    await post('taskUpdate', { id: task.id, letGo: true }, { session: 'h3' });
    await caught(lb, b);
    const lines = inbox(dir, 'h1').filter((l) => l.id === task.id);
    assert.ok(lines.some((l) => /let go/.test(l.detail)), JSON.stringify(lines));
    /* a note on the track by another session reaches the session holding it */
    await post('noteRecord', { id: tr.id, text: 'The API moved to v2.' }, { session: 'h4' });
    await caught(lb, b);
    assert.ok(inbox(dir, 'h1').some((l) => l.id === tr.id && l.kind === 'track-note' && /v2/.test(l.detail)), 'the track holder hears the note');
    /* a note past the row's cut, and the line's, reaches the holder whole */
    const long = 'Handoff weight.\n\n' + 'step '.repeat(150) + 'the last word';
    await post('noteRecord', { id: tr.id, text: long }, { session: 'h4' });
    await caught(lb, b);
    const whole = inbox(dir, 'h1').filter((l) => l.kind === 'track-note').at(-1);
    assert.ok(whole.detail.endsWith('the last word') && lineFor(whole).includes('step '.repeat(150) + 'the last word'), JSON.stringify(whole).slice(-200));
    /* a note on a task reaches its holder and its track's holder, never its author */
    await post('taskUpdate', { id: task.id, inHand: true }, { session: 'h5' });
    await post('noteRecord', { id: task.id, text: 'Use the v2 route.' }, { session: 'h4' });
    await caught(lb, b);
    /* the line names the PC the note came from, which the band says */
    const heard = (s) => inbox(dir, s).some((l) => l.id === task.id && l.kind === 'task-note' && /v2 route/.test(lineFor(l)) && l.pc === 'test');
    assert.deepEqual([heard('h5'), heard('h1'), heard('h4')], [true, true, false]);
    /* the relayed line the model reads names the sender's PC as the band does; a line from before the PC was stored reads on */
    const relayed = inbox(dir, 'h5').find((l) => l.id === task.id && l.kind === 'task-note');
    const onPc = (l, here) => / on test\b/.test(lineFor(l, here));
    assert.deepEqual([onPc(relayed, 'other-pc'), onPc(relayed, 'test'), onPc({ ...relayed, pc: undefined }, 'other-pc')], [true, false, false]);
    /* an amend to a ruling on the task tells its holder the clause it adds, never its author */
    const d = await post('decide', { title: 'Routes first', tasks: [task.id], global: true }, { session: 'h4' });
    await post('amendKnowledge', { id: d.id, body: 'Only the v2 routes.' }, { session: 'h4' });
    await caught(lb, b);
    const amended = (s) => inbox(dir, s).some((l) => l.id === d.id && /Only the v2 routes/.test(lineFor(l) || ''));
    assert.deepEqual([amended('h5'), amended('h4')], [true, false]);
    /* an edit that moves the stamp back to an earlier amend (an undo) tells no amend */
    const rec = { type: 'decision', tracks: ['TR-1'], sections: { Body: 'Routes.\n\nAmended 2026-11-01 by s1: first.' } };
    const edited = (stamps) => tellingsOf({ kind: 'knowledge', verb: 'edit', id: 'K-1', head: { label: 'K-1' }, by: 'session:s1', seq: 4, changes: { amended: stamps } },
      { question: async () => rec, holder: () => 's2' }).then((t) => t.lines.length);
    assert.deepEqual(await Promise.all([edited(['2026-11-01T10:00:00Z', '2026-11-02T10:00:00Z']), edited(['2026-11-02T10:00:00Z', '2026-11-01T10:00:00Z'])]), [1, 0]);
    /* the band carries an override's row; its Allow, pressed in another session, reaches the asking one once */
    const k = await post('createKnowledge', { type: 'gotcha', title: 'The port', body: 'The port is 1748.', global: true, session: 'a1' }, { session: 'a1' });
    await post('readRecord', { id: k.id, session: 's2' });
    const req = await post('overrideRequest', { kind: 'fix', items: [{ record: k.id, body: 'The port is 17480.' }], reason: 'an import wrote it wrong', summary: 'Fix the port', session: 'a1' }, { session: 'a1' });
    await caught(lb, b);
    const row = (await lb.band({ session: 'a1' })).model.calls.find((c) => c.kind === 'override');
    assert.deepEqual([row.mine, row.presses.map((p) => p.label), row.url.endsWith('/override/' + req.request)], [true, ['Fix', 'Keep'], true]);
    /* the press names its act: another act's word applies nothing */
    await assert.rejects(post('overrideDecide', { request: req.request, decision: 'withdraw' }, { user: 'p1' }), /is a fix/);
    await post(row.presses[0].verb, row.presses[0].input, { user: 'p1' });
    await caught(lb, b);
    const told = inbox(dir, 'a1').filter((l) => l.kind === 'override');
    assert.deepEqual(told.map((l) => [l.decided, l.records]), [['allow', [k.id]]], 'the asking session hears it once, naming the record');
    assert.match(lineFor(told[0]), /was fixed/);
    assert.deepEqual(inbox(dir, 'p1'), [], 'the session it was pressed in did not ask it');
    assert.equal(((await lb.band({ session: 'a1' })).model || {}).calls, undefined, 'decided, the row leaves the band');
    /* an Allow refused as changed since asked reaches the asking session too */
    const k2 = await post('createKnowledge', { type: 'gotcha', title: 'The host', body: 'The host is box1.', global: true, session: 'a1' }, { session: 'a1' });
    await post('readRecord', { id: k2.id, session: 's2' });
    const req2 = await post('overrideRequest', { kind: 'fix', items: [{ record: k2.id, body: 'The host is box2.' }], reason: 'an import wrote it wrong', summary: 'Fix the host', session: 'a1' }, { session: 'a1' });
    await post('amendKnowledge', { id: k2.id, body: 'Seen on box3 too.' }, { session: 'a1' });
    await assert.rejects(post('overrideDecide', { request: req2.request, decision: 'allow' }, { user: 'p1' }), /changed since asked/);
    await caught(lb, b);
    const changed = inbox(dir, 'a1').filter((l) => l.kind === 'override' && l.decided === 'changed');
    assert.deepEqual(changed.map((l) => l.records), [[k2.id]], 'the asking session hears the refusal');
    assert.match(lineFor(changed[0]), /changed since asked/);
  } finally { await lb.stop(); await b.close(); }
});

test('the band carries the held track, its graph with each line\'s last handoff, renews the lease and logs the redraw it is told', async () => {
  /* a quiet port, since the case ends offline: once the board closes, nothing else takes it */
  const b = await startBoard({ port: await quietPort() });
  const dir = tempDir('askerdo-store-');
  const timed = [];
  /* this PC's local server root: the band's page links go through it, signed in */
  const signed = 'http://127.0.0.1:9/' + 'a'.repeat(32) + '/';
  let lb = null;
  let up = true;
  try {
    const post = on(b);
    const ws = await post('createRecord', { kind: 'workstream', name: 'Band', description: 'One read.', projectRepos: ['c:/repos/band'] });
    const quiet = await post('createRecord', { kind: 'workstream', name: 'Band inbox', description: 'No lines.', projectRepos: ['c:/repos/band'] });
    const t = await post('newTrack', { name: 'Line', workstream: ws.id, session: 's1' }, { session: 's1' });
    const h = await post('writeHandoff', { track: t.id, focus: 'Go on.', state: 'The state.', verify: [{ path: 'C:/repo' }], session: 's1' }, { session: 's1' });
    await post('resumeTrack', { track: t.id, session: 's1' }, { session: 's1' });
    const task = await post('capture', { track: t.id, name: 'First', intent: 'Shows on the row.' }, { session: 's1' });
    await post('taskUpdate', { id: task.id, inHand: true, priority: 'high' }, { session: 's1' });
    await post('noteRecord', { id: task.id, text: 'An older note.' }, { session: 's1' });
    await post('noteRecord', { id: task.id, text: 'The newest note.' }, { session: 's1' });
    /* a question on the track, asked by another session, so outside s1's own scope */
    const q = await post('register', {
      name: 'which port', gist: 'Port?', projectDir: 'C:/repos/other', session: 'o1', blocking: true, track: t.id,
      ask: 'One (a) or a server (b, my pick)?', pick: 'b', options: OPTIONS,
    }, { session: 'o1' });
    /* started after the writes, so the hand comes from the working set, which holds no journal */
    lb = local(b, dir, { timing: (verb, ms, status) => timed.push([verb, ms, status]), local: signed });
    await caught(lb, b);
    const band = await lb.band({ session: 's1', redraw: '42', rings: JSON.stringify([{ k: 'unfold-7b~', s: 0, t: '7b', n: 1, o: 1, l: 7, v: 'questions', d: { reply: [2, 30, 40, 55], pane: [1, 20, 25, 25, null, null, 407000, 3.2, 1790, 230000] } },
      { k: '', c: 'board', s: 0, t: '', n: 0, o: -1, d: { band: [1, 3, 4, 4, 51], card: [1, 2, 9, 9] } }, { k: 'x', c: 'free text', d: { band: [1, 1, 1, 1] } },
      { x: 'lag', m: 320, n: 40, o: 2, d: Date.UTC(2026, 10, 12, 15, 16, 33, 85), w: 'idle', g: 251, r: 'none' }, { x: 'check', n: 3, p: 60, b: 15, v: 1, s: 9000, g: 9, k: { flights: 2, load: 1 } }, { x: 'live', s: 9, n: 72, m: 8, g: 40, t: 6, d: 1, o: 12 },
      { x: 'send', a: 12, c: 300, r: 5, l: 1 }, { x: 'stuck', n: 2, d: 1 }, { x: 'match', n: 3, t: 1.5, a: 40, u: 22.4, w: 4.1 },
      { x: 'held', l: 2130, b: ['ui.render pane 12'], i: ['tool.call Read agent +2130'], d: Date.UTC(2026, 10, 11, 19, 3, 24, 640), w: 'busy', g: 2130, r: 'cooldown timer, 20 ms in, 2150 ms long' },
      { k: 'Q1a', c: 'strip', s: 0, t: '', n: 0, o: -1, f: 'card', a: { card: 2, band: 1 }, q: { card: 3, band: 1200 }, z: Date.UTC(2026, 10, 12, 15, 2, 33, 500),
        d: { card: [2, 12, 40, 1177, 0, 1], band: [2, 17, 1352, 1893] } },
      { x: 'size', w: 'pane', v: 'home', n: 1700, l: 21, c: 228000, t: 85000, g: 3 }, { x: 'end', a: 'a1b2c3', e: 'waiting', o: 'running', p: 'turn', z: Date.UTC(2026, 10, 12, 23, 9, 26, 0) }]) });
    assert.deepEqual([band.track.id, band.track.workstream, band.graph.workstream], [t.id, ws.id, ws.id]);
    assert.match(band.track.url, /\/r\/[^/]+$/, 'the track\'s page, which its segment opens');
    assert.deepEqual([band.track.url, band.hand[0].url].map((u) => u.startsWith(signed + 'r/')), [true, true]);
    assert.ok(band.graph.view.tracks.some((x) => x.id === t.id), 'the graph Home draws rides the band');
    assert.deepEqual([band.handoffs[t.id].id, band.handoffs[t.id].status], [h.id, 'resumed']);
    /* the Tracks tab's tiles: each track's open questions, its page */
    assert.deepEqual(band.asks[t.id], [{ id: q.id, name: 'which port', blocking: true }]);
    /* a question on the held track asked from another project names that project */
    const scoped = await lb.band({ session: 's1', project: 'C:/repos/band' });
    assert.deepEqual(scoped.questions.map((x) => [x.id, x.project]), [[q.id, 'other']]);
    assert.ok(band.graph.view.tracks.find((x) => x.id === t.id).url.startsWith(signed + 'r/'));
    /* the track's tooltip names its workstream; the task's says its priority, intent and newest note */
    const hand = band.hand[0];
    assert.deepEqual([band.track.workstreamName, hand.priority, hand.intent, hand.note.text, hand.track.id], ['Band', 'high', 'Shows on the row.', 'The newest note.', t.id]);
    assert.ok(Date.parse(hand.note.at) > 0, 'the note keeps its stamp');
    /* the user's hold, a decision naming the track, reads its view again, so the band's track says it */
    await post('decide', { title: 'Hold the line', words: 'hold', labels: ['hold'], tracks: [t.id], global: true }, { session: 's1' });
    await caught(lb, b);
    assert.ok((await lb.band({ session: 's1' })).track.hold, 'the held track carries the hold');
    /* a session holding no track gets its project's workstream with a line, the other named */
    const free = await lb.band({ session: 's9', project: 'C:/repos/band' });
    assert.deepEqual([free.track, free.graph.workstream, free.graph.unheld, free.graph.others.map((o) => o.id)], [null, ws.id, true, [quiet.id]]);
    /* the picture's extras ride the graph, the Overview comes apart for a pane that draws it; a session's first look reads the moment before it */
    assert.deepEqual([band.graph.picture.workstream, free.graph.picture.workstream, (await lb.overview()).ws.some((x) => x.id === ws.id)], [ws.id, ws.id, true]);
    const first = lb.look({ session: 's1', ws: ws.id });
    assert.deepEqual([first.look, lb.look({ session: 's1', ws: ws.id }).look], [null, null], 'kept for the session');
    assert.ok(Date.parse(lb.look({ session: 's2', ws: ws.id }).look) > 0, 'the next session reads the moment s1 left');
    /* the mod's ring presses and redraws by cause: each at its slowest surface, each surface's last draw after it; an unknown cause is dropped */
    /* each request to the board logs its own time apart from the call's */
    assert.ok(timed.some(([verb, ms]) => verb === 'board call' && ms >= 0));
    timed.splice(0, timed.length, ...timed.filter(([verb]) => verb !== 'board call'));
    assert.deepEqual(timed.map(([verb, ms]) => [verb, ms]), [['band redraw', 42], ['ring press', 55], ['ring redraw reply', 55], ['ring redraw pane', 25],
      ['redraw board', 9], ['redraw board band', 4], ['redraw board card', 9], ['mod thread lag', 320], ['redraw check', 75], ['live lines', 6], ['send lap', 317],
      ['mod draw stuck', 2], ['mod decision match', 23.9], ['mod thread held', 2130], ['redraw strip', 1893], ['redraw strip card', 1177], ['redraw strip band', 1893], ['drawing near the page bound', 228000], ['agent end', 0]]);
    /* an agent's turn end names the agent, what the engine listed and what the mod did, at its own time */
    assert.deepEqual([/a1b2c3/.test(timed[18][2]), /waiting/.test(timed[18][2]), /running/.test(timed[18][2]), timed[18][2].includes('23:09:26')], [true, true, true, true]);
    /* the draw row's page counts, and the row a drawing near the page's bounds writes with its tab and step */
    assert.deepEqual([/1790 nodes.*230000 char/.test(timed[3][2]), /pane, on home, 1700 nodes, 21 levels.*85000 of text.*step 3/.test(timed[17][2])], [true, true]);
    /* a press's row names the surface it showed on and that surface's first draw, beside the window's last; each surface its asked writes */
    assert.match(timed[14][2], /\bcard\b.*\b40 ms/);
    assert.match(timed[16][2], /\b1 asked/);
    /* the press's own time, each surface's first ask and its draws at new columns, and the worst lag tick placed */
    assert.ok(timed[14][2].includes('15:02:33.500'));
    assert.deepEqual([/\b3 ms/.test(timed[15][2]), /\b1 at new col/.test(timed[15][2]), /1200 ms/.test(timed[16][2])], [true, true, true]);
    assert.deepEqual([timed[7][2].includes('15:16:33.085'), /idle/.test(timed[7][2])], [true, true]);
    /* a press's wait before its handler rides its row; the check and a Send's lap split their parts */
    assert.match(timed[1][2], /unfold-7b~.*open.*7 ms/);
    assert.match(timed[8][2], /pane 60 ms.*band 15 ms/);
    /* the band's draw row carries the columns the engine gave it */
    assert.deepEqual([/, 51 columns$/.test(timed[5][2]), /columns/.test(timed[6][2])], [true, false]);
    /* a draw row carries its window's largest drawing in characters and the pane's tab; none sent, none said */
    assert.deepEqual([/407000 char.*3\.2 ms.*questions/.test(timed[3][2]), /char/.test(timed[2][2])], [true, false]);
    /* the check row says what opened each check; the live lines' asks per second */
    assert.match(timed[8][2], /9 gate.*flights 2.*load 1/);
    assert.match(timed[9][2], /72 .*8 .*40 ms/);
    /* the busiest drawing's asks in a second apart from the lone first asks */
    assert.match(timed[9][2], /\b1 [a-z ]*drawing.*\b12 lone/);
    /* a call that ran into the route's limit says so */
    assert.match(timed[10][2], /12 ms \(ran out of time\).*300 ms.*5 ms/);
    /* the matcher's agent calls apart from the main loop's; the held tick names what entered before it */
    assert.match(timed[12][2], /3 main.*40 agent.*22\.4/);
    assert.match(timed[13][2], /ui\.render pane.*Read agent/);
    /* busy or idle, the body running at the due time and the due time to the ms, after the fields readers parse */
    assert.match(timed[13][2], /entered before: .*; inside: .*busy.*cooldown timer.*2026-11-11T19:03:24\.640Z/);
    /* the mod's flushed fault book becomes one row each; a list past the call's bound leaves its count */
    timed.length = 0;
    lb.faults({ session: 's1', faults: Array.from({ length: 260 }, (_, i) => 'ui.fault Pane desktop, burst-' + i) });
    const faultRows = timed.filter(([verb]) => verb === 'mod fault').map(([, , words]) => words);
    assert.deepEqual([faultRows.length, new Set(faultRows.slice(0, -1)).size, /\b10 more\b/.test(faultRows.at(-1))], [251, 250, true]);
    /* the mod's count of end rows it dropped is a row, and a read past the 40 ring rows logged leaves its count */
    timed.length = 0;
    await lb.band({ session: 's1', rings: JSON.stringify([...Array.from({ length: 44 }, (_, i) => ({ x: 'end', a: 'ag-' + i, e: 'none', o: 'ended', p: 'turn' })), { x: 'ends', n: 7 }]) });
    const endWords = timed.filter(([verb]) => verb === 'agent end' || verb === 'ring rows cut').map(([verb, , words]) => verb + ': ' + words);
    assert.deepEqual([endWords.length, /\b5 more ring rows\b/.test(endWords.at(-1))], [41, true]);
    await lb.band({ session: 's1', rings: JSON.stringify([{ x: 'ends', n: 7 }, { x: 'resume', a: 'ag-9', k: 'message', h: 'Check the port too.' }]) });
    assert.match(timed.filter(([verb]) => verb === 'agent end').at(-1)[2], /\b7 more agent and background end rows dropped/);
    /* a resume's row says what it read as and its prompt's head */
    assert.match(timed.filter(([verb]) => verb === 'agent resume').at(-1)[2], /ag-9 read as a message.*Check the port too\./);
    /* a board older than the plugin still loads; its band keeps the track and the questions, with no picture */
    const old = await older(b);
    const lo = local(old, tempDir('askerdo-store-'));
    try {
      await caught(lo, b);
      const ob = await lo.band({ session: 's1' });
      assert.deepEqual([ob.offline, ob.track.id, ob.asks[t.id].map((x) => x.id), ob.graph.picture, await lo.overview()], [false, t.id, [q.id], null, null]);
    } finally { await lo.stop(); await old.close(); }
    /* a picture read that keeps failing wakes no waiter, so the mod does not redraw and ask again each second */
    const sick = await older(b, 500);
    const ls = local(sick, tempDir('askerdo-store-'));
    try {
      await caught(ls, b);
      await ls.band({ session: 's1' });
      await ls.band({ session: 's1' });
      assert.equal((await ls.wait(ls.status().seq, 1800)).changed, false);
    } finally { await ls.stop(); await sick.close(); }
    /* another workstream's task that starts waiting on one here reaches this picture's Out */
    const there = await post('createRecord', { kind: 'workstream', name: 'Elsewhere', description: 'Waits on the band.' });
    const waiter = await post('createRecord', { kind: 'task', name: 'Waits here', description: 'd', workstream: there.id, wake: '2099-01-01' });
    await post('addEdge', { task: waiter.id, on: task.id, reason: 'needs it' });
    await caught(lb, b);
    /* a picture is read again at most once a second, so it lands within the second */
    const outBy = Date.now() + 2500;
    while (!(await lb.band({ session: 's1' })).graph.picture.out.some((o) => o.ws === there.id && o.task === task.id)) {
      if (Date.now() > outBy) throw new Error('the picture never read the new wait');
      await lb.wait(lb.status().seq, 300);
    }
    /* the graph a press opens skips the second's floor the band just set */
    const later = await post('createRecord', { kind: 'task', name: 'Waits too', description: 'd', workstream: there.id, wake: '2099-01-01' });
    await post('addEdge', { task: later.id, on: task.id, reason: 'needs it' });
    await caught(lb, b);
    assert.ok((await lb.graph(ws.id)).picture.out.some((o) => o.words.includes(later.id + ' ')), 'the open reads the picture after the change');
    /* a read for the view alone, as the shelf's cards ask, costs no board read; the next open reads it */
    const third = await post('createRecord', { kind: 'task', name: 'Waits third', description: 'd', workstream: there.id, wake: '2099-01-01' });
    await post('addEdge', { task: third.id, on: task.id, reason: 'needs it' });
    await caught(lb, b);
    const has = (g) => g.picture.out.some((o) => o.words.includes(third.id + ' '));
    assert.deepEqual([has(await lb.graph(ws.id, false)), has(await lb.graph(ws.id))], [false, true]);
    /* offline the track and the hand stay, with no press into an unreachable page */
    await b.close();
    up = false;
    await lb.wait(lb.status().seq, 3000);
    const away = await lb.band({ session: 's1' });
    assert.deepEqual([away.offline, away.track.id, away.hand[0].id], [true, t.id, task.id]);
    assert.deepEqual([away.track.url, away.hand[0].url], [undefined, undefined]);
  } finally { if (lb) await lb.stop(); if (up) await b.close(); }
});

test('a run nobody renews turns unconfirmed through the local server past three minutes, on a kept read and on the band\'s view', async () => {
  const b = await startBoard();
  const dir = tempDir('askerdo-store-');
  let lb = null;
  try {
    const post = on(b);
    const ws = await post('createRecord', { kind: 'workstream', name: 'Quiet', description: 'A run goes quiet.', projectRepos: ['c:/repos/quiet'] });
    const t = await post('newTrack', { name: 'Line', workstream: ws.id, session: 's1' }, { session: 's1' });
    const task = await post('capture', { track: t.id, name: 'Left running', intent: 'Its session went away.' }, { session: 's1' });
    await post('taskUpdate', { id: task.id, inHand: true }, { session: 's1' });
    /* last heard 150 s ago on the board's clock, and this PC's clock a minute ahead: the board still says running */
    const heard = (ms) => b.db.prepare('UPDATE runs SET heard = ? WHERE ended IS NULL').run(new Date(Date.now() - ms).toISOString());
    heard(150000);
    lb = local(b, dir, { now: () => new Date(Date.now() + 60000) });
    await caught(lb, b);
    const word = async () => (await lb.read('readRecord', { id: task.id })).result.word.is;
    assert.equal(await word(), 'running');
    /* the board's clock passes the turn with no row: no renewal, nothing else changes */
    heard(600000);
    assert.equal(await word(), 'unconfirmed', 'a kept read is not served past its word\'s turn');
    const by = Date.now() + 8000;
    while ((await lb.band({ session: 's1' })).graph.view.tracks.find((x) => x.id === t.id).unconfirmed !== 1) {
      if (Date.now() > by) throw new Error('the band\'s view never read the turned word');
      await lb.wait(lb.status().seq, 500);
    }
    /* the turn back: a renewal through this PC writes no row, yet the kept read and the band say running again */
    await lb.call('renewRuns', { input: {}, session: 's1' });
    assert.equal(await word(), 'running', 'a renewal drops the kept read calling its run unconfirmed');
    const back = Date.now() + 8000;
    while ((await lb.band({ session: 's1' })).graph.view.tracks.find((x) => x.id === t.id).unconfirmed !== 0) {
      if (Date.now() > back) throw new Error('the band\'s view kept the unconfirmed word after the renewal');
      await lb.wait(lb.status().seq, 500);
    }
  } finally { if (lb) await lb.stop(); await b.close(); }
});
