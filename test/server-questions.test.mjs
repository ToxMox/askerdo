/* The board server's question verbs, over an in-memory board. The rendered files are
   read as the old reader split them, their fronts against the key order frozen from
   the old writers (test/helpers/old-store.mjs). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { freshBoard } from './helpers/board-db.mjs';
import { frontText } from '../server/frontmatter.mjs';
import { fileParts, inTodaysOrder } from './helpers/old-store.mjs';

const q = await import('../server/verbs/questions.mjs');
const w = await import('../server/verbs/work.mjs');
const { renderRecord } = await import('../server/render.mjs');
const { putRecord } = await import('../server/records.mjs');
const tracks = await import('../server/verbs/tracks.mjs');
const verbs = await import('../server/verbs/index.mjs');

/* a clock at a local time, `more` for register's strict path */
const at = (stamp, more = {}) => ({ now: () => new Date(stamp), ...more });
const noonAfter = (start, n) => {
  const [y, m, d] = start.split('-').map(Number);
  return { now: () => new Date(y, m - 1, d + n, 12, 0, 0) };
};

const OPTIONS = [
  { type: 'a', option: 'one file', getsYou: 'simple reads', costsYou: 'every edit touches everything' },
  { type: 'b', option: 'file per question', getsYou: 'isolation', costsYou: 'more files' },
];
const payload = (over = {}) => ({
  name: 'store shape', gist: 'One file or many?', projectDir: 'C:/repos/my-app', session: 's-a', blocking: false,
  ask: 'One file (a) or a file per question (b, my pick)?', pick: 'b', options: OPTIONS, ...over,
});

/* The record's file as the export writes it. */
function fileOf(db, key) {
  const r = db.prepare('SELECT kind, fields, body, layout FROM records WHERE key = ?').get(key);
  const notes = db.prepare('SELECT at, body FROM notes WHERE record = ? ORDER BY position').all(key);
  return renderRecord({ kind: r.kind, fields: JSON.parse(r.fields), body: r.body, layout: r.layout ? JSON.parse(r.layout) : null }, notes);
}

const lines = (db) => db.prepare('SELECT line FROM activity ORDER BY seq').all().map((r) => JSON.parse(r.line));
const questionCount = (db) => db.prepare("SELECT count(*) AS n FROM records WHERE kind = 'question'").get().n;
const refused = (re) => (e) => e instanceof q.UsageError && re.test(e.message);
const ids = (rows) => rows.map((e) => e.id);

/* An answer flips status, fills Answer and fans out to subscribers minus the caller,
   told alone. */
test('a ruling is cited or revisited with a reversal, a reversal is stored blocking and quotes it, and the next question of its minute is flagged beside it', () => {
  const db = freshBoard();
  const first = q.register(db, payload(), null, at('2026-10-25T12:00:00'));
  /* the registered ask comes back with its tokens numbered, for the card's head */
  assert.deepEqual([first.id, /\(1b, my pick\)/.test(first.ask)], ['Q1', true]);
  assert.equal(q.answer(db, { id: 'Q1', pick: '1b', note: 'isolation wins' }, { session: 's-b' }, at('2026-10-25T12:01:00')).status, 'answered');
  const ruling = q.show(db, 'Q1', null, at('2026-10-25T12:01:00'));
  assert.equal(ruling.status, 'answered');
  assert.match(ruling.answered, /^2026-10-25T12:01:00/, 'the answer stamps the close at the clock');
  assert.match(ruling.answer, /isolation wins/);
  assert.throws(() => q.answer(db, { id: 'Q1', pick: 'a' }, null, at('2026-10-25T12:02:00')), refused(/Q1/));
  /* a pressed answer run again with its stored pick stands, named, and writes nothing */
  const rows = lines(db).length;
  const again = q.answer(db, { id: 'Q1', pick: '1b' }, null, at('2026-10-25T12:02:00'));
  assert.deepEqual([again.status, again.pick, lines(db).length], ['answered', '1b', rows]);

  /* the model's path names a ruling in cites or revisits, never bare */
  const strict = (stamp) => at(stamp, { strict: true });
  const before = questionCount(db);
  const oldFile = 'the old queue file .claude/questions/s-a/Q1-whole-app-take.md';
  assert.throws(() => q.register(db, payload({ gist: 'Q1 settled the store, beside ' + oldFile }), null, strict('2026-10-25T12:03:00')), refused(/Q1/));
  assert.equal(questionCount(db), before, 'a refused register writes nothing');
  /* a label inside a file name names no board record */
  assert.ok(q.register(db, payload({ gist: 'Carried from ' + oldFile }), null, strict('2026-10-25T12:03:00')).id);
  assert.deepEqual(q.register(db, payload({ gist: 'Q1 settled the store.', cites: ['Q1'] }), null, strict('2026-10-25T12:03:00')).cites, ['Q1']);
  assert.throws(() => q.register(db, payload({ session: 's-c', revisits: ['Q1'] }), null, strict('2026-10-25T12:05:00')), refused(/reversal/));

  const rev = q.register(db, payload({ session: 's-c', revisits: ['Q1'], reversal: 'Two writers now share the store.' }), null, strict('2026-10-25T12:05:00'));
  assert.deepEqual(rev.revisits, ['Q1']);
  assert.equal(q.show(db, rev.id, null, at('2026-10-25T12:05:00')).blocking, true, 'registered not blocking, stored blocking');
  assert.ok(rev.warnings.some((x) => x.includes(rev.id) && /blocking/.test(x)));
  /* the hub quotes the ruling's answer and the option it turned down with its catch */
  const [quoted] = rev.reverses;
  assert.deepEqual([quoted.id, quoted.quote, quoted.declined.length], ['Q1', ruling.answer, 1]);
  assert.match(quoted.declined[0], /1a.*every edit touches everything/);

  /* the session's next question within the minute is flagged on both cards, never refused */
  assert.equal(rev.beside, undefined, 'the first of the minute had nothing beside it');
  const next = q.register(db, payload({ session: 's-c' }), null, strict('2026-10-25T12:05:30'));
  assert.deepEqual(next.beside, [rev.id]);
  const later = at('2026-10-25T12:06:00');
  assert.deepEqual(q.show(db, rev.id, null, later).beside, [next.id]);
  assert.deepEqual(q.show(db, next.id, null, later).beside, [rev.id]);
  const listed = Object.fromEntries(q.list(db, {}, null, later).map((e) => [e.id, e.beside]));
  assert.deepEqual([listed[rev.id], listed[next.id]], [[next.id], [rev.id]]);
});

/* --amend replaces the pick and the note and keeps the first answer beneath; an
   amendment that changes nothing writes nothing, a blank line in the note included. */
test('an answer to a question that moved amends it with the first answer beneath, the same answer again writes nothing, an open one is reworded keeping its id, and an answered or dropped one refuses', () => {
  const db = freshBoard();
  const pressed = { user: true };
  q.register(db, payload(), null, at('2026-10-25T09:00:00'));
  const seen = q.show(db, 'Q1', null, at('2026-10-25T09:00:00')).version;
  q.answer(db, { id: 'Q1', pick: 'a', note: 'simple first' }, pressed, at('2026-10-25T10:00:00'));
  /* a second chip pressed on the version it saw: the question moved and now stands answered */
  const note = 'isolation wins\n\nafter all';
  assert.equal(q.answer(db, { id: 'Q1', pick: '1b', note, version: seen }, pressed, at('2026-10-25T11:00:00')).amended, true);
  const amended = q.show(db, 'Q1', null, at('2026-10-25T11:00:00'));
  assert.equal(amended.status, 'answered');
  const paras = amended.answer.split('\n\n');
  assert.match(paras[0], /isolation wins/);
  assert.match(paras.at(-1), /simple first/, 'the first answer stays, beneath');
  assert.equal(paras.filter((p) => /simple first/.test(p)).length, 1);
  const line = lines(db).at(-1);
  assert.deepEqual([line.verb, line.changes.chosen], ['amend', ['a', 'b']]);

  const rows = lines(db).length;
  /* a card's press names the version it showed, which never amends: the answer that stands is said */
  assert.throws(() => q.answer(db, { id: 'Q1', pick: 'a', shown: seen }, pressed, at('2026-10-25T11:30:00')), refused(/already answered/));
  assert.equal(q.answer(db, { id: 'Q1', pick: 'b', note, amend: true }, pressed, at('2026-10-25T12:00:00')).amended, false);
  assert.equal(lines(db).length, rows, 'a no-op leaves no activity row');
  const after = q.show(db, 'Q1', null, at('2026-10-25T12:00:00'));
  assert.equal(after.version, amended.version, 'and no new version');
  assert.equal(after.answer, amended.answer);

  /* an answered question is not reworded; ask a new one */
  const reworded = (over) => payload({ name: 'second', ask: 'One file (a), a file per question (b) or a table (c, my pick)?', pick: 'c',
    options: [...OPTIONS, { type: 'c', option: 'a table', getsYou: 'queries', costsYou: 'a server' }], ...over });
  assert.throws(() => q.editQuestion(db, { id: 'Q1', payload: reworded({ name: 'store shape' }) }, null, at('2026-10-25T12:30:00')), refused(/answered/));

  const second = q.register(db, payload({ name: 'second' }), null, at('2026-10-25T13:00:00'));
  const v2 = q.show(db, 'Q2', null, at('2026-10-25T13:00:00')).version;
  /* an open question's ask and options change in place, keeping its id and key */
  const count = questionCount(db);
  const edit = q.editQuestion(db, { id: 'Q2', payload: reworded() }, null, at('2026-10-25T13:05:00'));
  assert.ok(edit.reworded.includes('options') && edit.reworded.includes('ask'), JSON.stringify(edit));
  const now = q.show(db, 'Q2', null, at('2026-10-25T13:05:00'));
  assert.deepEqual([now.key, edit.key, edit.ask, now.status, now.options.length, now.pick, questionCount(db)], [second.key, second.key, now.ask, 'open', 3, 'c', count]);
  assert.ok(now.version > v2 && now.reworded.version === now.version, 'the rewording moves the version and stamps it');
  /* the backstop: a press on the card drawn before the rewording is refused and writes nothing */
  const rowsBefore = lines(db).length;
  assert.throws(() => q.answer(db, { id: 'Q2', pick: 'a', shown: v2 }, pressed, at('2026-10-25T13:06:00')), refused(/reworded/));
  assert.equal(lines(db).length, rowsBefore);
  q.drop(db, { id: 'Q2', note: 'moot' }, pressed, at('2026-10-25T13:10:00'));
  const dropped = lines(db).length;
  assert.throws(() => q.answer(db, { id: 'Q2', pick: 'a', version: v2 }, pressed, at('2026-10-25T13:20:00')), refused(/dropped/));
  assert.throws(() => q.answer(db, { id: 'Q2', pick: 'a', amend: true }, pressed, at('2026-10-25T13:20:00')), refused(/dropped/));
  assert.equal(q.show(db, 'Q2', null, at('2026-10-25T13:20:00')).status, 'dropped');
  assert.equal(lines(db).length, dropped);
});

/* An archived question label is reused after its rest, and a reopen after archive
   relabels. */
test('an answered question\'s label rests until 44 days after its answer and is then reused, and its key still names the old question', () => {
  const db = freshBoard();
  const first = q.register(db, payload({ name: 'first' }), null, noonAfter('2026-01-01', 0));
  q.register(db, payload({ name: 'second' }), null, noonAfter('2026-01-01', 0));
  q.answer(db, { id: 'Q1', pick: 'a' }, null, noonAfter('2026-01-01', 0));
  /* answered 01-01: archived 01-15, resting until 02-14 */
  assert.equal(q.register(db, payload({ name: 'third' }), null, noonAfter('2026-01-01', 43)).id, 'Q3');
  const fourth = q.register(db, payload({ name: 'fourth' }), null, noonAfter('2026-01-01', 44));
  assert.equal(fourth.id, 'Q1');
  assert.notEqual(fourth.key, first.key);
  assert.equal(q.show(db, 'Q1', null, noonAfter('2026-01-01', 44)).name, 'fourth', 'the label names its live holder');
  assert.equal(q.show(db, first.key, null, noonAfter('2026-01-01', 44)).name, 'first', 'the key still names the old question');
});

/* A date snooze auto-wakes on read and a trigger snooze needs an explicit wake; every
   ending wakes what waits on it, and a reopen wakes nothing. */
test('a due snooze date wakes on a read, a trigger stays until woken by hand, and a question waiting on another wakes when that one is answered', () => {
  const db = freshBoard();
  const on = (day) => at(day + 'T12:00:00');
  for (const name of ['dated', 'triggered', 'waiting', 'awaited']) q.register(db, payload({ name }), null, on('2026-10-25'));
  q.snooze(db, { id: 'Q1', until: '2026-10-27' }, null, on('2026-10-25'));
  q.snooze(db, { id: 'Q2', trigger: 'the build lands' }, null, on('2026-10-25'));
  assert.equal(q.snooze(db, { id: 'Q3', wakeOn: 'Q4' }, null, on('2026-10-25')).snooze.wakeOn, 'Q4', 'shown by its label');

  assert.deepEqual(ids(q.list(db, {}, null, on('2026-10-26'))), ['Q4'], 'not due yet');
  assert.deepEqual(ids(q.list(db, {}, null, on('2026-10-27'))), ['Q1', 'Q4']);
  const woke = lines(db).at(-1);
  assert.deepEqual([woke.verb, woke.id], ['wake', 'Q1']);
  assert.ok(woke.note, 'the wake row says why');

  q.answer(db, { id: 'Q4', pick: 'a' }, null, on('2026-10-27'));
  const waited = q.show(db, 'Q3', null, on('2026-10-27'));
  assert.equal(waited.status, 'open');
  assert.equal(waited.snooze, undefined);
  assert.match(waited.wokeBy, /Q4/, 'the echo names the ending that woke it');

  assert.deepEqual(ids(q.list(db, { snoozed: true }, null, on('2026-11-30'))), ['Q2'], 'a trigger never wakes by date');
  q.wake(db, { id: 'Q2' }, null, on('2026-11-30'));
  assert.equal(q.show(db, 'Q2', null, on('2026-11-30')).status, 'open');

  /* a question waits on a track and wakes when it finishes */
  putRecord(db, { key: 'ws000001', kind: 'workstream', fields: { id: 'WS-1', key: 'ws000001', name: 'Board', status: 'open', labelHistory: ['WS-1 2026-10-25'] }, body: '' });
  const tr = tracks.newTrack(db, { name: 'Board line', workstream: 'WS-1' }, 'cli');
  const later = q.register(db, payload({ name: 'after the line' }), null, on('2026-11-30')).id;
  q.snooze(db, { id: later, wakeOn: tr.id }, null, on('2026-11-30'));
  tracks.finishTrack(db, { track: tr.id }, 'cli');
  const woken = q.show(db, later, null, on('2026-11-30'));
  assert.equal(woken.status, 'open');
  assert.match(woken.wokeBy, new RegExp(tr.id));
});

/* list --names-line takes --session and --blocking, and a session's line names only
   the questions it owns. */
test('a session\'s names line holds only its own questions, blockers first, and nothing of the rest', () => {
  const db = freshBoard();
  const ctx = { session: 's-x', now: new Date('2026-10-25T09:00:00') };
  w.createRecord(db, { kind: 'workstream', name: 'near', description: 'd' }, ctx);
  w.createRecord(db, { kind: 'workstream', name: 'far', description: 'd' }, ctx);
  const reg = (minute, over) => q.register(db, payload(over), null, at('2026-10-25T10:0' + minute + ':00'));
  reg(0, { name: 'own ask', session: 's-a', workstream: 'WS-1' });
  reg(1, { name: 'near blocker', session: 's-b', blocking: true, workstream: 'WS-1' });
  reg(2, { name: 'far blocker', session: 's-b', blocking: true, workstream: 'WS-2' });
  reg(3, { name: 'near aside', session: 's-b', workstream: 'WS-1' });

  const project = 'C:/repos/my-app';
  const line = (extra) => q.namesLine(db, { project, ...extra }, null, at('2026-10-25T11:00:00'));
  const names = (extra) => line(extra).match(/Q\d+ (?:own ask|near blocker|far blocker|near aside|on the line|other blocker)/g) || [];
  assert.deepEqual(names({}), ['Q2 near blocker', 'Q3 far blocker', 'Q1 own ask'], 'unscoped: the whole project, at most three');
  assert.deepEqual(names({ session: 's-a' }), ['Q1 own ask'], 'a blocker in its workstream asked elsewhere is not named');
  assert.deepEqual(names({ session: 's-b' }), ['Q2 near blocker', 'Q3 far blocker', 'Q4 near aside']);
  assert.deepEqual(names({ session: 's-b', blocking: true }), ['Q2 near blocker', 'Q3 far blocker']);
  /* the rest of the project is neither named nor counted */
  assert.doesNotMatch(line({ session: 's-a' }), /elsewhere/, 'no count of the rest');
  assert.equal(line({ session: 's-c' }), '', 'a session owning none gets no line');
  assert.equal(q.namesLine(db, { project: 'C:/repos/other' }, null, at('2026-10-25T11:00:00')), '', 'an empty project gets no line');

  /* a session holding a track files its question under the track; another track's blocker is not its own */
  const tr = tracks.newTrack(db, { name: 'far line', workstream: 'WS-2', session: 's-t' }, 'cli');
  tracks.newTrack(db, { name: 'other line', workstream: 'WS-2', session: 's-o' }, 'cli');
  const other = q.register(db, payload({ name: 'other blocker', session: 's-o', blocking: true }), null, at('2026-10-25T10:04:00', { inherit: true })).id;
  const held = q.register(db, payload({ name: 'on the line', session: 's-t', blocking: true }), null, at('2026-10-25T10:05:00', { inherit: true }));
  assert.deepEqual([held.workstream, held.track], ['WS-2', tr.id]);
  assert.deepEqual(ids(q.list(db, { track: tr.id }, null, at('2026-10-25T11:00:00'))), [held.id]);
  assert.deepEqual(names({ session: 's-t' }), [held.id + ' on the line']);
  assert.deepEqual(names({ session: 's-o' }), [other + ' other blocker']);
  /* a resume takes the track's questions over: the old leg owns nothing and prints no line */
  const aside = q.register(db, payload({ name: 'on the line', session: 's-t' }), null, at('2026-10-25T10:05:30', { inherit: true })).id;
  tracks.takeOver(db, { track: tr.id, session: 's-r' }, { session: 's-r' });
  assert.ok(names({ session: 's-r' }).includes(aside + ' on the line'));
  assert.equal(line({ session: 's-t' }), '', 'the old leg prints nothing');
  tracks.takeOver(db, { track: tr.id, session: 's-t' }, { session: 's-t' });

  /* a session that only started a task follows it: its question files under the task's workstream, not the inbox */
  w.createRecord(db, { name: 'near work', description: 'd', workstream: 'WS-1' }, ctx);
  w.taskUpdate(db, { id: 'T-1', status: 'in_progress' }, { session: 's-u' });
  const started = q.register(db, payload({ name: 'from a start', session: 's-u' }), null, at('2026-10-25T10:06:00', { inherit: true }));
  assert.equal(started.workstream, 'WS-1');
  assert.ok(!w.readRecord(db, 'T-1').inHand, 'a start never takes the task in hand');

  /* tasks in hand across two workstreams; the held track's comes first, and with no track the refusal names them */
  w.createRecord(db, { name: 'far work', description: 'd', workstream: 'WS-2' }, ctx);
  for (const id of ['T-1', 'T-2']) w.taskUpdate(db, { id, inHand: true }, { session: 's-t' });
  const first = q.register(db, payload({ name: 'track first', session: 's-t' }), null, at('2026-10-25T10:07:00', { inherit: true }));
  assert.deepEqual([first.workstream, first.track], ['WS-2', tr.id]);
  for (const id of ['T-1', 'T-2']) w.taskUpdate(db, { id, inHand: true, takeOver: true }, { session: 's-v' });
  assert.throws(() => q.register(db, payload({ name: 'no track', session: 's-v' }), null, at('2026-10-25T10:08:00', { inherit: true })), /T-1, T-2/);
});

/* a question records its track and the asking PC, and belongs to whichever
   session holds that track, so a resume takes it over. */
test('a question stores its track and PC, and the session that takes the track over owns it and hears its answer', () => {
  const db = freshBoard();
  const { runVerb } = verbs;
  w.createRecord(db, { kind: 'workstream', name: 'near', description: 'd' }, { session: 's-x', now: new Date('2026-10-25T09:00:00') });
  const tr = tracks.newTrack(db, { name: 'the line', workstream: 'WS-1', session: 's-t' }, 'cli');
  /* the board's own name for the caller's PC wins over one the payload names */
  const r = runVerb(db, 'register', payload({ session: 's-t', pc: 'laptop' }), { session: 's-t', pc: 'desk-pc' }, at('2026-10-25T10:00:00'));
  const front = fileParts(fileOf(db, r.key)).front;
  assert.deepEqual([front.pc, front.track], ['desk-pc', tr.key]);
  const scope = (session) => q.peekSessionScope(db, { project: 'C:/repos/my-app', session }, at('2026-10-25T11:00:00')).find((x) => x.id === r.id);
  assert.deepEqual([scope('s-t').own, scope('s-t').track, scope('s-t').pc], [true, tr.id, 'desk-pc']);

  assert.equal(scope('s-t').trackName, 'the line');

  tracks.takeOver(db, { track: tr.id, session: 's-r' }, { session: 's-r', pc: 'laptop' });
  assert.equal(scope('s-r').own, true, 'the resumed track\'s session owns it');
  assert.ok(!scope('s-t') || !scope('s-t').own, 'the old leg no longer does');
  assert.ok(q.show(db, r.id, null, at('2026-10-25T11:00:00')).subscribers.includes('s-r'));
  /* an answer pressed elsewhere names whose it reached, for the presser's toast */
  const { owner } = q.answer(db, { id: r.id, pick: 'a' }, { session: 's-other' }, at('2026-10-25T12:00:00'));
  assert.deepEqual([owner.session, owner.track, owner.pc], ['s-r', tr.id, 'laptop']);
});

/* This pins the server's writer to the files' key order, as the key-order check in
   test/server-work.test.mjs does for work. */
test('every question the verbs wrote reads back with today\'s parser, its front in today\'s key order', () => {
  const db = freshBoard();
  const ctx = { session: 's-a', now: new Date('2026-10-25T08:00:00') };
  w.createRecord(db, { kind: 'workstream', name: 'Board', description: 'd' }, ctx);
  w.createRecord(db, { name: 'Counter', description: 'd' }, ctx);
  const t = (hm) => at('2026-10-25T' + hm + ':00');
  q.register(db, payload({
    name: 'store shape: one file or "many"', crux: 'two writers', workstream: 'WS-1', gates: ['T-1'], evidence: ['docs/a.md'],
    labels: ['import:my-app'], refs: ['onboard:question:q1'],
    stakes: '- **Two writers** share it', whileThisWaits: 'the reader', context: '# not a heading\nmore',
    options: [{ ...OPTIONS[0], headline: 'Keep it plain', whyPick: 'fewest moving parts' }, OPTIONS[1]],
  }), null, t('09:00'));
  q.answer(db, { id: 'Q1', pick: 'b', note: 'isolation wins\n\nand reads stay cheap' }, null, t('09:05'));
  q.answer(db, { id: 'Q1', pick: 'a', amend: true }, null, t('09:10'));
  q.register(db, payload({ name: 'revisit', revisits: ['Q1'], reversal: 'Two writers now.' }), null, t('09:20'));
  q.register(db, payload({ name: 'cites it', cites: ['Q1'], pick: null }), null, t('09:30'));
  q.register(db, payload({ name: 'snoozed' }), null, t('09:40'));
  q.snooze(db, { id: 'Q4', until: '2026-11-01', trigger: 'the build lands', wakeOn: 'T-1' }, null, t('09:45'));
  q.surface(db, { id: 'Q3', session: 's-b' }, null, t('09:50'));
  q.editQuestion(db, { id: 'Q3', pick: 'a', addGate: ['T-1'] }, null, t('09:55'));
  /* a row without its columns files with them empty; one without its option is refused */
  assert.throws(() => q.register(db, payload({ name: 'bare', options: [{ type: 'a', getsYou: 'x' }] }), null, t('10:05')), refused(/option/));
  q.register(db, payload({ name: 'dropped', options: [{ type: 'a', option: 'one file' }, OPTIONS[1]] }), null, t('10:05'));
  q.drop(db, { id: 'Q5', note: 'moot' }, null, t('10:10'));
  q.register(db, payload({ name: 'woken', session: 's-b' }), null, t('10:15'));
  q.snooze(db, { id: 'Q6', wakeOn: 'Q3' }, null, t('10:16'));
  q.answer(db, { id: 'Q3', pick: 'a', note: 'fine' }, null, t('10:20'));

  const keys = db.prepare("SELECT key FROM records WHERE kind = 'question' ORDER BY id").all().map((r) => r.key);
  assert.equal(keys.length, 6);
  const fronts = [];
  for (const key of keys) {
    const text = fileOf(db, key);
    const rec = fileParts(text);
    assert.ok(text.startsWith('---\n' + frontText(rec.front) + '---\n'), 'the front reads back:\n' + text);
    assert.ok(inTodaysOrder('question', Object.keys(rec.front)), 'today\'s key order:\n' + text);
    const shown = q.show(db, key, null, t('11:00'));
    assert.equal(rec.front.status, shown.status);
    assert.equal(rec.gist, shown.gist);
    for (const o of shown.options) assert.ok(rec.sections.Options.includes('| ' + o.type + ' | ' + o.option + ' | ' + o.getsYou + ' |'), o.type);
    assert.equal(rec.sections.Answer, shown.answer);
    fronts.push(rec.front);
  }
  /* the shapes this test exists for were all written */
  assert.ok(fronts.some((f) => f.snooze && f.snooze.until && f.snooze.trigger && f.snooze.wakeOn), 'a combined snooze');
  assert.ok(fronts.some((f) => f.wokeBy), 'a linked wake');
  assert.ok(fronts.some((f) => Array.isArray(f.revisits) && f.revisits.length), 'a reversal');
  assert.ok(fronts.some((f) => f.status === 'dropped'), 'a drop');
  /* an import's label and row ref kept from register, and listed */
  assert.deepEqual([fronts[0].labels, fronts[0].refs], [['import:my-app'], ['onboard:question:q1']]);
  assert.deepEqual(q.list(db, { all: true }, null, t('11:00')).find((r) => r.id === 'Q1').refs, ['onboard:question:q1']);
});
