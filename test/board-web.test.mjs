/* The board's web views over a real socket on 127.0.0.1: a page by
   an old label, the drawn pages and the task page, and the page's long poll answered by a write. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { tempDir } from './helpers/sandbox.mjs';

process.removeAllListeners('warning');
const { boardCall, boardLoginLink, startBoard } = await import('../lib/board-call.mjs');
const w = await import('../server/verbs/work.mjs');
const t = await import('../server/verbs/tracks.mjs');
const gr = await import('../server/verbs/graph.mjs');
const q = await import('../server/verbs/questions.mjs');
const { lineWords } = await import('../server/web/draw.mjs');
const { detail } = await import('../server/web/picture-draw.mjs');
const o = await import('../server/verbs/override.mjs');
const pf = await import('../server/verbs/profiles.mjs');
const u = await import('../server/verbs/upkeep.mjs');
const { writeHandoff } = await import('../server/verbs/handoffs.mjs');
const { needsYouModel, overviewModel, workstreamKey, workstreamModel } = await import('../server/web/data.mjs');
const { freshBoard } = await import('./helpers/board-db.mjs');
const { addActivity } = await import('../server/records.mjs');

process.env.ASKERDO_SANDBOX_HOME = tempDir('askerdo-store-');

/* noon on a day, as a session acting then */
const on = (day) => {
  const [y, m, d] = day.split('-').map(Number);
  return { session: 's1', now: new Date(y, m - 1, d, 12, 0, 0) };
};

async function signIn(b) {
  const link = await boardLoginLink('/', { url: b.url, token: b.token });
  const res = await fetch(link.url, { redirect: 'manual' });
  return res.headers.get('set-cookie').split(';')[0];
}

const heading = (html) => (/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html) || [])[1] || '';
/* the picture's data a page carries, P, which the page's script draws */
function pictureIn(html) {
  const m = /<script type="application\/json" id="gdata">([\s\S]*?)<\/script>/.exec(html);
  return m ? JSON.parse(m[1]).P : null;
}
/* a station's page and the words of its strip, as a press on it shows them */
function station(P, id) {
  const t = P && P.tasks[id];
  if (!t) return null;
  const V = { level: 2, ws: t.ws, tr: t.tr, sel: 'stn:' + id };
  return { href: t.url, words: JSON.stringify(detail(P, V, V.sel).facts) };
}

test('a reused label: a page by it and a day shows the holder then; an old row or note opens its own record', async () => {
  const b = await startBoard();
  try {
    const old = w.createRecord(b.db, { kind: 'workstream', name: 'Lighthouse rebuild', description: 'd' }, on('2026-01-01'));
    const ws = w.createRecord(b.db, { kind: 'workstream', name: 'Harbour', description: 'd' }, on('2026-01-01'));
    const lamp = w.createRecord(b.db, { kind: 'task', name: 'Paint the lamp room', description: 'd', workstream: ws.id }, on('2026-01-01'));
    const hang = w.createRecord(b.db, { kind: 'task', name: 'Hang the lamp', description: 'd\n## Lamp notes\n\n```\n# a shell comment\n```', workstream: ws.id }, on('2026-01-01'));
    const tr = t.newTrack(b.db, { name: 'Lamp line', workstream: ws.id, tasks: [lamp.id] }, on('2026-01-01'));
    w.editRecord(b.db, { id: lamp.id, status: 'done' }, on('2026-01-02'));
    w.noteRecord(b.db, { id: hang.id, text: 'Waits on ' + lamp.id + ' drying.' }, on('2026-01-02'));
    w.taskUpdate(b.db, { id: hang.id, inHand: true }, on('2026-01-02'));
    w.closeRecord(b.db, { id: old.id, outcome: 'done' }, on('2026-01-02'));
    const now = w.createRecord(b.db, { kind: 'workstream', name: 'Harbour survey', description: 'd' }, on('2026-02-15'));
    const rope = w.createRecord(b.db, { kind: 'task', name: 'Order rope', description: 'd', workstream: ws.id }, on('2026-02-20'));
    assert.deepEqual([now.id, rope.id], [old.id, lamp.id], 'both labels rested and were reused');
    const cookie = await signIn(b);
    const get = async (p) => (await fetch(b.url + p, { headers: { cookie } })).text();
    /* a gate link from before keys holds the label; it gates the task that held it then, never the reuser */
    const glass = q.register(b.db, { name: 'lamp glass', gist: 'Which glass?', projectDir: 'C:/repos/harbour', session: 's1', blocking: false, ask: 'Clear (a) or red (b)?',
      gates: [lamp.id], options: [{ type: 'a', option: 'clear' }, { type: 'b', option: 'red' }] }, null, { now: on('2026-01-01').now });
    const gk = b.db.prepare('SELECT key FROM records WHERE label = ?').get(glass.id).key;
    b.db.prepare(`UPDATE links SET "to" = ? WHERE "from" = ? AND type = 'gates'`).run(lamp.id, gk);
    assert.ok(!(await get('/r/' + rope.id)).includes('lamp glass'), 'the reused label brings no gate');
    assert.ok((await get('/r/' + lamp.id + '?at=2026-01-10')).includes('lamp glass'), 'the old link gates the task it meant');
    const then = await fetch(b.url + '/r/' + old.id + '?at=2026-01-10', { headers: { cookie } });
    assert.equal(then.status, 200);
    assert.match(heading(await then.text()), /Lighthouse rebuild/);
    const today = await fetch(b.url + '/r/' + old.id, { headers: { cookie } });
    assert.match(heading(await today.text()), /Harbour survey/);

    /* the track's done row and a note's prose name the task that held the label then */
    const trPage = await get('/r/' + tr.id);
    const done = /<details class="done-f"[^>]*>[\s\S]*?<a class="id" href="([^"]+)"/.exec(trPage);
    assert.match(heading(await get(done[1])), /Paint the lamp room/);
    /* s1's lease, unseen since January, reads quiet and offers a new session the take over */
    assert.ok(trPage.includes('/askerdo resume ' + tr.id + ' --take-over'), 'a quiet lease offers the take over');
    const hangPage = await get('/r/' + hang.id);
    const note = /<ul class="notes">[\s\S]*?<a href="([^"]+)"/.exec(hangPage);
    assert.match(heading(await get(note[1])), /Paint the lamp room/);
    /* the holder reads as a session, never its raw id, and an empty Intent draws no heading */
    assert.match(hangPage, /<dt>inHand<\/dt><dd>a session<\/dd>/);
    assert.ok(!/>Intent</.test(hangPage), 'no heading over an empty Intent');
    /* the writer's own ## line is kept, empty, and drawn below the record's sections, never as one */
    assert.ok(/<h4 class="uh">Lamp notes</.test(hangPage) && !/<h3>Lamp notes/.test(hangPage), hangPage);
    assert.ok(/<code># a shell comment/.test(hangPage), 'a fenced # line reads as written');
  } finally { await b.close(); }
});

test('the drawn pages and the task page: a station opens its own task, a track page draws its lines, a wait across workstreams shows both ways', async () => {
  const b = await startBoard();
  try {
    const day = on('2026-03-02');
    const harbour = w.createRecord(b.db, { kind: 'workstream', name: 'Harbour', description: 'd' }, day);
    const docks = w.createRecord(b.db, { kind: 'workstream', name: 'Docks', description: 'd' }, day);
    const task = (ws, name) => w.createRecord(b.db, { kind: 'task', name, description: 'd', workstream: ws.id }, day);
    const [paint, hang] = [task(harbour, 'Paint the lamp room'), task(harbour, 'Hang the lamp')];
    const rope = task(docks, 'Order rope');
    const lamp = t.newTrack(b.db, { name: 'Lamp line', workstream: harbour.id, tasks: [paint.id, hang.id] }, 'cli');
    t.newTrack(b.db, { name: 'Rope line', workstream: docks.id, tasks: [rope.id] }, 'cli');
    gr.addEdge(b.db, { task: hang.id, on: paint.id, reason: 'order' }, 'cli');
    gr.addEdge(b.db, { task: hang.id, on: rope.id, reason: 'needs the rope' }, 'cli');
    const cookie = await signIn(b);
    const get = async (p) => (await fetch(b.url + p, { headers: { cookie } })).text();

    const lampP = pictureIn(await get('/r/' + lamp.id));
    assert.ok(lampP && lampP.ws[harbour.id], 'the track page carries its picture');
    const h = station(lampP, hang.id);
    assert.match(heading(await get(h.href)), /Hang the lamp/, 'the station opens its own task');
    assert.ok(h.words.includes(rope.id) && h.words.includes(docks.id), 'the far wait in the waiting station\'s strip: ' + h.words);
    const r = station(pictureIn(await get('/ws/' + docks.id)), rope.id);
    assert.ok(r.words.includes(hang.id) && r.words.includes(harbour.id), 'and in the strip of the station it waits on: ' + r.words);
    /* every module the page's script imports is served, or the picture never draws */
    const seen = new Set();
    const follow = async (src) => {
      if (seen.has(src)) return;
      seen.add(src);
      const res = await fetch(b.url + src, { headers: { cookie } });
      assert.equal(res.status, 200, src);
      for (const m of (await res.text()).matchAll(/from '\.\/([^']+)'/g)) await follow('/web/' + m[1]);
    };
    await follow(/<script type="module" src="([^"]+)"/.exec(await get('/'))[1]);
    assert.ok(seen.size >= 4, 'the client and the picture modules: ' + [...seen].join(' '));
    /* a workstream with only an inbox shows once on the Overview, as its pill */
    const pier = w.createRecord(b.db, { kind: 'workstream', name: 'Pier', description: 'd' }, day);
    task(pier, 'Count the planks');
    const home = await get('/');
    const listed = (/<p class="quiet">([\s\S]*?)<\/p>/.exec(home) || ['', ''])[1];
    assert.ok(pictureIn(home).ov.some((o) => o.id === pier.id) && !listed.includes(pier.id), 'once, as a pill: ' + listed);
    /* its inbox panel names a waiting task's wake by its track's name; the task filed in March is due, marked amber */
    const lit = w.createRecord(b.db, { kind: 'task', name: 'Light the pier', description: 'd', workstream: pier.id, unplaced: 'after the lamp is hung', wake: 'track-ends ' + lamp.id }, day);
    const rows = (/<section class="panel" id="inbox">([\s\S]*?)<\/section>/.exec(await get('/ws/' + pier.id)) || ['', ''])[1].split('<li>').slice(1);
    const row = (id) => rows.find((x) => x.includes('>' + id + '<')) || '';
    assert.ok(row(lit.id).includes('Lamp line') && !/amber/.test(row(lit.id)), 'the wake names the track: ' + row(lit.id));
    assert.ok(/class="amber">due\b/.test(rows[0]) && rows[0].includes('Count the planks'), 'the due task first, marked due: ' + rows[0]);
    /* and the Overview's pill for it counts the due as its page does */
    const pill = pictureIn(await get('/')).ov.find((x) => x.id === pier.id);
    assert.ok(/\b1 due\b/.test(pill.counts) && pill.due, 'the pill counts the due: ' + pill.counts);

    /* the page a station opens says what holds it, what waits on it and the question gating it */
    const ask = q.register(b.db, { name: 'lamp colour', gist: '**The glass:** clear or red\n**Why now:** the lamp is hung next', projectDir: 'C:/repos/harbour', session: 's1', blocking: false,
      stakes: '**Ships:** see the light\n**Night:** red reads as a warning', ask: 'Clear (a, my pick) or red (b)?', pick: 'a', gates: [hang.id],
      options: [{ type: 'a', option: 'clear', getsYou: 'light' }, { type: 'b', option: 'red', getsYou: 'warning' }] }, null);
    w.editRecord(b.db, { id: hang.id, close: 'with ' + paint.id }, day);
    const hangPage = await get(h.href);
    /* its close reads in words, the task it names a link with its name beside it */
    const close = /<dt>close<\/dt><dd>([\s\S]*?)<\/dd>/.exec(hangPage)[1];
    assert.ok(close.includes('/r/' + paint.key) && close.includes('Paint the lamp room') && !close.includes('{'), close);
    const qKey = b.db.prepare('SELECT key FROM records WHERE label = ?').get(ask.id).key;
    assert.ok(hangPage.includes('/r/' + qKey) || hangPage.includes('/r/' + ask.id), 'the gating question is named');
    /* its page reads like its card: no old store header, the gist and the stakes a bullet per line */
    const qBody = /<section class="panel"><div class="md">([\s\S]*?)<\/div><\/section>/.exec(await get('/r/' + qKey))[1];
    assert.ok(!/all open questions/.test(qBody) && !qBody.includes(ask.id), 'no index link and no id heading: ' + qBody);
    const items = (qBody.match(/<li><b>/g) || []).length;
    assert.ok(items === 4 && !/<p><b>/.test(qBody), 'two gist and two stakes items, never a paragraph: ' + qBody);
    assert.ok(!/ready to start/i.test(hangPage) && /ready to start/i.test(await get('/r/' + paint.id)), 'held, and the task before it ready');
    assert.ok((await get('/r/' + rope.id)).includes('/r/' + hang.key), 'the far task waiting on it is named on its page');
    /* a writer's own "## Options" line stays theirs; the page draws the real section once */
    q.answer(b.db, { id: ask.id, pick: 'a' }, { user: true }, day);
    const again = q.register(b.db, { name: 'lamp colour again', gist: 'Red after all?', projectDir: 'C:/repos/harbour', session: 's1', blocking: false,
      ask: 'Red (a, my pick) or clear (b)?', pick: 'a', revisits: [ask.id], reversal: 'Ships asked for red\n## Options', options: [{ type: 'a', option: 'red' }, { type: 'b', option: 'clear' }] }, null);
    const againPage = await get('/r/' + again.key);
    assert.ok(/<h4 class="uh">Options</.test(againPage) && !/<table>/.test(againPage) && !/<h3>Options/.test(againPage), againPage);
  } finally { await b.close(); }
});

test('a write on the board answers a page held on its long poll', async () => {
  const b = await startBoard();
  try {
    process.env.ASKERDO_BOARD_URL = b.url;
    process.env.ASKERDO_BOARD_TOKEN = b.token;
    const ws = await boardCall('createRecord', { kind: 'workstream', name: 'Board', description: 'One board.' });
    const cookie = await signIn(b);
    const seq = b.db.prepare('SELECT max(seq) AS s FROM activity').get().s;
    const held = fetch(b.url + '/web/wait?after=' + seq, { headers: { cookie }, signal: AbortSignal.timeout(3000) }).then((r) => r.json());
    const early = await Promise.race([held, new Promise((ok) => setTimeout(() => ok('held'), 150))]);
    assert.equal(early, 'held', 'nothing new yet, so the poll waits');
    await boardCall('createRecord', { kind: 'task', name: 'One', description: 'A step.', workstream: ws.id, wake: '2099-01-01' });
    assert.ok((await held).seq > seq, 'the write answered the held poll');
    const ahead = await fetch(b.url + '/web/wait?after=' + (seq + 1000), { headers: { cookie }, signal: AbortSignal.timeout(2000) });
    assert.ok((await ahead.json()).seq > seq, 'a page ahead of a restored board is answered at once');
  } finally { await b.close(); }
});

/* the settings page's form, posted as a browser posts it */
const settingsPost = (b, headers, value, back = '/settings?tab=sessions') => fetch(b.url + '/settings/set', {
  method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
  body: new URLSearchParams({ key: 'main.window', value, back }).toString(),
});
const windowNow = (b) => pf.settings(b.db, {}).rows.find((r) => r.key === 'main.window').value;

test('a settings form posted from the signed-in board saves as the user from that device; a refusal draws the stored value again with the refusal line', async () => {
  const b = await startBoard();
  try {
    const cookie = await signIn(b);
    /* the page opens on Replies, and the row's form still names its own tab, so the save comes back there */
    const drawn = await (await fetch(b.url + '/settings', { headers: { cookie } })).text();
    const form = drawn.split('<form').find((f) => f.includes('name="key" value="main.window"')) || '';
    const back = (/name="back" value="([^"]*)"/.exec(form) || [])[1] || '';
    const res = await settingsPost(b, { cookie, origin: b.url }, '25', back.replace(/&amp;/g, '&'));
    assert.equal(res.status, 303);
    const to = new URL(res.headers.get('location'), b.url);
    assert.deepEqual([to.pathname, to.searchParams.get('tab'), to.searchParams.get('saved'), to.hash], ['/settings', 'sessions', 'main.window', '#s-main.window']);
    assert.equal(windowNow(b), 25);
    const row = b.db.prepare('SELECT actor, pc FROM activity ORDER BY seq DESC LIMIT 1').get();
    assert.deepEqual([row.actor, row.pc], ['user', 'test'], 'the activity row names the user and the signed-in device');
    const bad = await settingsPost(b, { cookie, origin: b.url }, '120');
    assert.equal(bad.status, 400);
    const page = await bad.text();
    const field = page.split('<form').find((f) => f.includes('name="key" value="main.window"')) || '';
    assert.deepEqual([/name="value" value="([^"]*)"/.exec(field)?.[1], /Not saved/.test(page), windowNow(b)], ['25', true, 25]);
  } finally { await b.close(); }
});

test('a settings post from another origin, with no origin, or with no web session changes nothing', async () => {
  const b = await startBoard();
  try {
    const cookie = await signIn(b);
    const before = windowNow(b);
    const seq = b.db.prepare('SELECT max(seq) AS s FROM activity').get().s;
    assert.equal((await settingsPost(b, { cookie, origin: 'http://evil.example' }, '25')).status, 403);
    assert.equal((await settingsPost(b, { cookie }, '25')).status, 403);
    assert.equal((await settingsPost(b, { origin: b.url }, '25')).status, 401);
    /* a device token is no web session: only the cookie writes from a page */
    assert.equal((await settingsPost(b, { authorization: 'Bearer ' + b.token, origin: b.url }, '25')).status, 401);
    assert.equal(windowNow(b), before);
    assert.equal(b.db.prepare('SELECT max(seq) AS s FROM activity').get().s, seq);
  } finally { await b.close(); }
});

test('what waits on you reads the same on every view: a question, a live handoff\'s line, an override and an upkeep call; a waiting line dates from its handoff', () => {
  const db = freshBoard();
  const ws = w.createRecord(db, { kind: 'workstream', name: 'Harbour', description: 'd' }, on('2026-03-01'));
  const task = (name) => w.createRecord(db, { kind: 'task', name, description: 'd', workstream: ws.id }, on('2026-03-01'));
  const [paint, hang, lens] = [task('Paint the lamp room'), task('Hang the lamp'), task('Fit the lens')];
  const line = t.newTrack(db, { name: 'Lamp line', workstream: ws.id, tasks: [paint.id, hang.id] }, on('2026-03-01'));
  q.register(db, { name: 'lamp colour', gist: 'Which glass?', projectDir: 'C:/repos/harbour', session: 's1', blocking: true,
    ask: 'Clear (a, my pick) or red (b)?', pick: 'a', gates: [hang.id], options: [{ type: 'a', option: 'clear' }, { type: 'b', option: 'red' }] }, null, on('2026-03-02'));
  w.editRecord(db, { id: paint.id, inHand: true }, on('2026-03-02'));
  w.readRecord(db, { id: paint.id, session: 's2' });
  o.overrideRequest(db, { kind: 'fix', items: [{ record: paint.id, intent: 'White walls' }], reason: 'an audit', summary: 'Rewrite the intent' }, on('2026-03-02'));
  const h = writeHandoff(db, { track: line.id, focus: 'Paint next.', state: 'Half done.', verify: [{ path: 'C:/repos/harbour' }], waitingOnUser: ['Pick the glass'], session: 's1' }, on('2026-03-02'));
  w.noteRecord(db, { id: hang.id, text: 'a later note moves the line' }, on('2026-03-05'));
  /* a snoozed question sits in the page's asleep list, in no view's count */
  const nap = q.register(db, { name: 'lens maker', gist: 'Who?', projectDir: 'C:/repos/harbour', session: 's1', blocking: true,
    ask: 'Ana (a, my pick) or Bo (b)?', pick: 'a', options: [{ type: 'a', option: 'Ana' }, { type: 'b', option: 'Bo' }] }, null, on('2026-03-03'));
  q.snooze(db, { id: nap.id, wakeOn: lens.id }, null, on('2026-03-03'));

  const opts = { now: new Date(2026, 2, 6, 12) };
  const all = needsYouModel(db, {}, opts);
  assert.deepEqual([all.asleep.map((x) => x.id), all.asleep[0].snooze.wakeOn, all.items.some((i) => i.id === nap.id)], [[nap.id], lens.id, false]);
  const kinds = [...new Set(all.items.map((i) => i.kind))];
  assert.deepEqual(kinds, ['question', 'handoff', 'override', 'call'], 'each kind, the question first: ' + all.items.map((i) => i.text).join(' | '));
  const over = overviewModel(db, opts);
  const wsm = workstreamModel(db, workstreamKey(db, ws.id), opts);
  assert.deepEqual([over.needs.count, over.cards[0].needs.count, wsm.needs.count], [all.count, all.count, all.count], 'the strip, the card and the panel count what the page lists');
  assert.equal(all.face, 'blocking');
  const tr = wsm.g.tracks[0];
  assert.equal(tr.since, h.created, 'waiting since its handoff');
  assert.ok(lineWords(tr, wsm.D).some((b) => b[1].includes('Mar 2')), 'not the later note: ' + JSON.stringify(lineWords(tr, wsm.D)));
  /* the pages carry the redrawn picture's data, the same reading of what holds the line */
  const pill = over.picture.ov.find((x) => x.id === ws.id);
  assert.ok(pill && pill.opens && pill.gatedQ.length === 1 && pill.needs, JSON.stringify(pill));
  const P = wsm.picture.ws[ws.id];
  assert.deepEqual([P.tracks.map((x) => x.id), P.crit.n, wsm.picture.tasks[hang.id].st], [[line.id], 1, 'gated']);
});

test('the activity page lists newest first and a workstream keeps its own; the rulings file a question with no workstream under its project', async () => {
  const b = await startBoard();
  try {
    /* on before any task, so its sweep moves nothing below */
    u.upkeepSwitch(b.db, { on: true }, on('2026-01-01'));
    const harbour = w.createRecord(b.db, { kind: 'workstream', name: 'Harbour', description: 'd' }, on('2026-01-01'));
    const orchard = w.createRecord(b.db, { kind: 'workstream', name: 'Orchard', description: 'd' }, on('2026-01-02'));
    const lamp = w.createRecord(b.db, { kind: 'task', name: 'Paint the lamp room', description: 'd', workstream: harbour.id }, on('2026-01-03'));
    /* an imported line from before records had keys names its record by label alone */
    addActivity(b.db, { ts: '2026-01-03T09:00:00-05:00', verb: 'note', kind: 'task', id: lamp.id, name: 'Sand the lamp room', by: 'cli' });
    const pears = w.createRecord(b.db, { kind: 'task', name: 'Pick the pears', description: 'd', workstream: orchard.id }, on('2026-01-04'));
    for (const n of [1, 2, 3]) w.noteRecord(b.db, { id: pears.id, text: 'basket ' + n }, on('2026-01-04'));
    /* a take and a plain edit after it in the same minute: the take is its run's line */
    w.editRecord(b.db, { id: pears.id, inHand: true }, on('2026-01-04'));
    w.editRecord(b.db, { id: pears.id, priority: 'high' }, on('2026-01-04'));
    const asked = q.register(b.db, {
      name: 'which rope', gist: 'Rope?', projectDir: 'C:/repos/harbour-app', session: 's2', blocking: false,
      ask: 'Hemp (a, my pick) or nylon (b)?', pick: 'a', options: [{ type: 'a', option: 'hemp rope' }, { type: 'b', option: 'nylon rope' }],
    }, null, on('2026-01-05'));
    q.answer(b.db, { id: asked.id, pick: 'a' }, { user: true }, on('2026-01-06'));
    /* a profile defined and added; a take, a take-over and a let-go in one minute */
    pf.profileDefine(b.db, { name: 'lean-marks', set: ['tests.policy=standard'] }, on('2026-01-07'));
    pf.profileAdd(b.db, { record: harbour.id, name: 'lean-marks' }, on('2026-01-07'));
    const nets = w.createRecord(b.db, { kind: 'task', name: 'Mend the nets', description: 'd', workstream: harbour.id }, on('2026-01-08'));
    const s2 = { ...on('2026-01-08'), session: 's2' };
    w.editRecord(b.db, { id: nets.id, kind: 'task', inHand: true }, on('2026-01-08'));
    w.editRecord(b.db, { id: nets.id, kind: 'task', inHand: true, takeOver: true }, s2);
    w.editRecord(b.db, { id: nets.id, kind: 'task', letGo: true }, s2);
    const cookie = await signIn(b);
    const get = async (p) => (await fetch(b.url + p, { headers: { cookie } })).text();
    const all = await get('/activity');
    assert.ok(all.indexOf('Pick the pears') > 0 && all.indexOf('Pick the pears') < all.indexOf('Paint the lamp room'), 'the newer line first');
    const notes = all.split('<li>').filter((li) => li.includes('Pick the pears') && /noted/.test(li));
    assert.ok(notes.length === 1 && / 3 times/.test(notes[0]), 'three notes in one minute fold into one line with its count');
    const edits = all.split('<li>').filter((li) => li.includes('Pick the pears') && /edited/.test(li));
    assert.ok(edits.length === 1 && !/times/.test(edits[0]), 'the plain edit is one line of its own: ' + edits.join(' | '));
    const lis = all.split('<li>').map((li) => li.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
    const prof = lis.filter((li) => /lean-marks/.test(li));
    assert.ok(prof.length === 2 && prof.every((li) => !/profile profile/.test(li) && li.split('lean-marks').length === 2)
      && prof.some((li) => /profile defined/.test(li)) && prof.some((li) => /profile added/.test(li) && li.includes(harbour.id)),
    'a profile row in words, its name once, an add naming its record: ' + prof.join(' | '));
    const hands = lis.filter((li) => li.includes('Mend the nets') && !/created/.test(li));
    assert.deepEqual(hands.map((li) => ['let go', 'taken over', 'taken in hand'].filter((h) => li.includes(h)).join()), ['let go', 'taken over', 'taken in hand'],
      'three hand rows, upkeep folded in: ' + hands.join(' | '));
    assert.ok(hands.every((li) => !/ now |times/.test(li)), hands.join(' | '));
    /* a task's chip says its word: taken in hand in January and never renewed since */
    const page = await get('/r/' + pears.id);
    assert.ok(/>unconfirmed</.test(page), 'the chip says unconfirmed');
    const mine = await get('/activity?ws=' + harbour.id);
    assert.ok(mine.includes('Paint the lamp room') && mine.includes('Sand the lamp room') && !mine.includes('Pick the pears'), "the filter keeps that workstream's lines");
    const card = (await get('/rulings')).split('<article').find((c) => c.includes('>' + asked.id + '<'));
    assert.ok(card && card.includes('harbour-app') && card.includes('hemp rope'), "its project names the group, its row the pick's words");
  } finally { await b.close(); }
});
