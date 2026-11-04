/* Each PC's local server, its board half: the event client, the
   cache, the inbox lines by sequence, the long poll and offline, over a test
   board on 127.0.0.1. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createServer, request } from 'node:http';
import { join } from 'node:path';
import { tempDir } from './helpers/sandbox.mjs';

process.removeAllListeners('warning');
process.env.ASKERDO_SANDBOX_HOME = tempDir('askerdo-store-');
const { boardCall, boardRequest, startBoard } = await import('../lib/board-call.mjs');
const { createLocalBoard } = await import('../lib/local-board.mjs');
const { handleLocal } = await import('../lib/local-route.mjs');
const { lineFor } = await import('../lib/local-inbox.mjs');
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
    const t = JSON.parse((await cli(['task', 'create', '--json'], JSON.stringify({ name: 'wire the board', description: 'd' }))).stdout);
    await cli(['note', t.id, '--body', 'noted from the CLI', '--session', 's1']);
    assert.ok(b.db.prepare('SELECT body FROM notes WHERE record = ?').all(t.key).some((n) => n.body.includes('noted from the CLI')));
    const top = JSON.parse((await cli(['activity', '--limit', '1', '--json'])).stdout).lines[0];
    assert.equal(top.at, String(b.db.prepare('SELECT max(seq) AS s FROM activity').get().s));
    assert.equal(top.id, t.id);
    /* a session ending a task raises its alert; the same ending made by hand raises none */
    const t2 = JSON.parse((await cli(['task', 'create', '--json'], JSON.stringify({ name: 'by hand', description: 'd' }))).stdout);
    await cli(['task', 'edit', t2.id, '--status', 'dropped']);
    await cli(['task', 'edit', t.id, '--status', 'completed', '--session', 's1']);
    await caught(lb, b);
    const ended = lb.alerts.flatMap((x) => x.work).find((w) => w.id === t.id);
    assert.equal(ended && ended.ending, 'completed', 'the tray hears the task end');
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
    assert.ok(g.layout && g.layout.stations[task.id], 'and its layout, computed once per change');
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
  const b = await startBoard();
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
  const lb = local(b, dir);
  const r = await route(lb);
  try {
    await caught(lb, b);
    const first = (await r.call('GET', 'band?session=s1&project=' + encodeURIComponent(repo))).body.result;
    assert.equal(first.model.total, 1, 'the band scopes by the shared name register wrote');
    assert.deepEqual(first.scope, { repo: 'github.com/acme/app', name: 'app' });
    /* the cached question keeps show's shape, the board link and who asked */
    const q = first.questions[0];
    assert.deepEqual([q.pick, q.asker, q.boardUrl.endsWith(q.key)], ['b', 's1', true]);
    assert.ok(q.stakes, 'the stakes survive a fresh fill');
    /* a refusal the board gave keeps its reason; a network failure reads offline alone */
    const stranger = local({ url: b.url, token: 'not-a-token' }, tempDir('askerdo-store-'));
    try {
      await stranger.wait(stranger.status().seq, 3000);
      assert.match((await stranger.band()).board, /token/, 'the board\'s own refusal');
    } finally { await stranger.stop(); }
    /* online, a verb whose own result lists stale tasks is no read from the cache */
    const ws = await on(b)('createRecord', { kind: 'workstream', name: 'Board', description: 'One board.' });
    const t = await on(b)('newTrack', { name: 'Line', workstream: ws.id });
    const up = await r.call('POST', 'verbs/trackSummary', { input: { track: t.id } });
    assert.deepEqual([up.body.result.stale, up.body.stale], [[], undefined]);
    await caught(lb, b);
    await b.close();
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
  } finally { await r.close(); await lb.stop(); }
});

test('an answer reaches the session holding the question\'s track, and gates added to a blocker reach the gated task\'s holder', async () => {
  const b = await startBoard();
  const dir = tempDir('askerdo-store-');
  const lb = local(b, dir);
  const post = on(b);
  try {
    const ws = await post('createRecord', { kind: 'workstream', name: 'Board', description: 'One board.' });
    /* h1 holds the track (a resumed leg is a new session on the same track) */
    const task = await post('createRecord', { kind: 'task', name: 'wire it', description: 'd', workstream: ws.id });
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
    await post('answer', { id: q.id, pick: 'a' }, { user: 'p2' });
    await caught(lb, b);
    assert.ok(inbox(dir, 'h1').some((l) => l.id === q.id && l.kind === 'answer'), 'T-41: the track holder hears the answer');
    assert.deepEqual(inbox(dir, 'p2'), [], 'Q590 590a: pressed in a session that does not own it, the answer is not told there');
    /* a task taken over: the session that had it in hand hears it */
    await post('taskUpdate', { id: task.id, inHand: true, takeOver: true }, { session: 'h3' });
    await caught(lb, b);
    assert.ok(inbox(dir, 'h2').some((l) => l.id === task.id && /taken over/.test(l.detail)), 'the old holder hears the take-over');
    /* a let-go reaches the line's holder as a let-go, not as the status that followed it */
    await post('taskUpdate', { id: task.id, letGo: true }, { session: 'h3' });
    await caught(lb, b);
    const gone = inbox(dir, 'h1').filter((l) => l.id === task.id).at(-1);
    assert.ok(gone && /let go/.test(gone.detail) && !/status/.test(gone.detail), JSON.stringify(gone));
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
    /* the band carries an override's row; its Allow, pressed in another session, reaches the asking one once */
    const k = await post('createKnowledge', { type: 'gotcha', title: 'The port', body: 'The port is 1748.', global: true, session: 'a1' }, { session: 'a1' });
    await post('readRecord', { id: k.id, session: 's2' });
    const req = await post('overrideRequest', { kind: 'fix', items: [{ record: k.id, body: 'The port is 17480.' }], reason: 'an import wrote it wrong', summary: 'Fix the port', session: 'a1' }, { session: 'a1' });
    await caught(lb, b);
    const row = (await lb.band({ session: 'a1' })).model.calls.find((c) => c.kind === 'override');
    assert.deepEqual([row.mine, row.presses.map((p) => p.label), row.url.endsWith('/override/' + req.request)], [true, ['Allow', 'Keep'], true]);
    await post(row.presses[0].verb, row.presses[0].input, { user: 'p1' });
    await caught(lb, b);
    const told = inbox(dir, 'a1').filter((l) => l.kind === 'override');
    assert.deepEqual(told.map((l) => [l.decided, l.records]), [['allow', [k.id]]], 'the asking session hears it once, naming the record');
    assert.match(lineFor(told[0]), /allowed/);
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
  const b = await startBoard();
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
    b.db.prepare("UPDATE leases SET seen = '2020-01-01T00:00:00+00:00'").run();
    const band = await lb.band({ session: 's1', redraw: '42' });
    assert.deepEqual([band.track.id, band.track.workstream, band.graph.workstream], [t.id, ws.id, ws.id]);
    assert.match(band.track.url, /\/r\/[^/]+$/, 'T-63: the track\'s page, which its segment opens');
    assert.deepEqual([band.track.url, band.hand[0].url].map((u) => u.startsWith(signed + 'r/')), [true, true]);
    assert.ok(band.graph.view.tracks.some((x) => x.id === t.id) && band.graph.layout, 'the graph Home draws rides the band');
    assert.deepEqual([band.handoffs[t.id].id, band.handoffs[t.id].status], [h.id, 'resumed']);
    /* the Tracks tab's tiles: each track's open questions, its page */
    assert.deepEqual(band.asks[t.id], [{ id: q.id, name: 'which port', blocking: true }]);
    assert.ok(band.graph.view.tracks.find((x) => x.id === t.id).url.startsWith(signed + 'r/'));
    /* the track's tooltip names its workstream; the task's says its priority, intent and newest note */
    const hand = band.hand[0];
    assert.deepEqual([band.track.workstreamName, hand.priority, hand.intent, hand.note.text, hand.track.id], ['Band', 'high', 'Shows on the row.', 'The newest note.', t.id]);
    assert.ok(Date.parse(hand.note.at) > 0, 'the note keeps its stamp');
    /* a session holding no track gets its project's workstream with a line, the other named */
    const free = await lb.band({ session: 's9', project: 'C:/repos/band' });
    assert.deepEqual([free.track, free.graph.workstream, free.graph.unheld, free.graph.others.map((o) => o.id)], [null, ws.id, true, [quiet.id]]);
    assert.deepEqual(timed, [['band redraw', 42, 200]]);
    const end = Date.now() + 3000;
    while (b.db.prepare('SELECT seen FROM leases').get().seen.startsWith('2020')) {
      if (Date.now() > end) throw new Error('the band never renewed the lease');
      await new Promise((ok) => setTimeout(ok, 20));
    }
    /* offline the track and the hand stay, with no press into an unreachable page */
    await b.close();
    up = false;
    await lb.wait(lb.status().seq, 3000);
    const away = await lb.band({ session: 's1' });
    assert.deepEqual([away.offline, away.track.id, away.hand[0].id], [true, t.id, task.id]);
    assert.deepEqual([away.track.url, away.hand[0].url], [undefined, undefined]);
  } finally { if (lb) await lb.stop(); if (up) await b.close(); }
});
