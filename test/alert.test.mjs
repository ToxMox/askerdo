/* the alert entry point's pure half, the request shape, the card rule,
 * the gates and the frame the tray popup reads. */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ALERT_FILES_MAX, ALERT_KINDS, DEFAULTS, alertCard, alertCategory, alertFrame, alertGate,
  alertPlace, enrichEvents, questionAlert, questionWhereNames, validateAlert, workAlertTitle, workWhereNames,
} from '../lib/notify.mjs';

const BASE = 'http://127.0.0.1:4321/0123456789abcdef0123456789abcdef/';

test('the request shape: kind and title are required, the rest has defaults', () => {
  const ok = validateAlert({ kind: 'blocker', title: '  Q12 needs you\nnow ' });
  assert.deepEqual(ok.value, {
    kind: 'blocker', title: 'Q12 needs you now', where: '', blocking: true,
    card: '', files: [], sound: '', whereNames: {}, pick: '',
  });
  assert.equal(validateAlert({ kind: 'done', title: 'x' }).value.blocking, false,
    'only a blocker blocks by default');
  assert.equal(validateAlert({ kind: 'done', title: 'x', blocking: true }).value.blocking, true);
  for (const bad of [
    null, [], 'x', {}, { kind: 'nope', title: 'x' }, { kind: 'info' }, { kind: 'info', title: '   ' },
    { kind: 'info', title: 'x', where: 3 }, { kind: 'info', title: 'x', blocking: 'yes' },
    { kind: 'info', title: 'x', card: 12 }, { kind: 'info', title: 'x', files: 'all' },
    { kind: 'info', title: 'x', files: [-1] }, { kind: 'info', title: 'x', files: [1.5] },
    { kind: 'info', title: 'x', sound: 'Beep' },
    { kind: 'info', title: 'x', pick: 2 }, { kind: 'info', title: 'x', whereNames: 'WS-11' },
    { kind: 'info', title: 'x', whereNames: [] }, { kind: 'info', title: 'x', whereNames: { track: 3 } },
  ]) {
    assert.ok(validateAlert(bad).error, JSON.stringify(bad));
  }
  assert.equal(validateAlert({ kind: 'info', title: 'x'.repeat(300) }).value.title.length, 120);
  assert.equal(validateAlert({ kind: 'info', title: 'x', where: 'w'.repeat(300) }).value.where.length, 80);
  const files = validateAlert({ kind: 'info', title: 'x', files: [3, 3, 0, 1, 2, 4, 5, 6] }).value.files;
  assert.deepEqual(files, [3, 0, 1, 2, 4], 'deduped and capped at five');
  assert.equal(files.length, ALERT_FILES_MAX);
  assert.equal(validateAlert({ kind: 'info', title: 'x', files: true }).value.files, true);
  assert.deepEqual(validateAlert({ kind: 'info', title: 'x', files: false }).value.files, []);
  assert.equal(ALERT_KINDS.length, 10);
});

test('the card is a record id, a path under the board, or a URL on this board, and nothing else', () => {
  assert.deepEqual(alertCard('', BASE), { url: '', id: '' });
  assert.deepEqual(alertCard('Q12', BASE), { url: BASE + 'r/Q12', id: 'Q12' });
  assert.deepEqual(alertCard('T-307', BASE), { url: BASE + 'r/T-307', id: 'T-307' });
  assert.deepEqual(alertCard('WS-11', BASE), { url: BASE + 'r/WS-11', id: 'WS-11' });
  assert.deepEqual(alertCard('w/P-10', BASE), { url: BASE + 'w/P-10', id: 'P-10' });
  assert.deepEqual(alertCard('work', BASE), { url: BASE + 'work', id: '' });
  /* the browser name and localhost come back as the loopback form the exe trusts */
  assert.deepEqual(alertCard('http://askerdo.localhost:4321/0123456789abcdef0123456789abcdef/q/Q3', BASE),
    { url: BASE + 'q/Q3', id: 'Q3' });
  assert.deepEqual(alertCard(BASE + 'w/T-1', BASE), { url: BASE + 'w/T-1', id: 'T-1' });
  for (const bad of [
    'https://example.com/', 'http://example.com:4321/0123456789abcdef0123456789abcdef/q/Q1',
    'http://127.0.0.1:9999/0123456789abcdef0123456789abcdef/q/Q1',
    'http://127.0.0.1:4321/other/q/Q1', '/etc/passwd', '../x', 'C:\\x', 'file:///C:/x',
    'q/Q1 "x"', 'vscode://file/C:/x',
  ]) {
    assert.equal(alertCard(bad, BASE), null, bad);
  }
});

test('the gates are the notifier halves own, in their order', () => {
  const now = new Date(2026, 9, 19, 12, 0);
  assert.equal(alertGate(DEFAULTS, now, 'info'), '');
  assert.equal(alertGate({ ...DEFAULTS, enabled: false }, now, 'info'), 'notifications are off');
  assert.equal(alertGate({ ...DEFAULTS, pausedUntil: 'until-resume' }, now, 'blocker'), 'paused');
  assert.equal(alertGate({ ...DEFAULTS, quietFrom: '11:00', quietTo: '13:00' }, now, 'info'), 'quiet hours');
  const off = { ...DEFAULTS, categories: { ...DEFAULTS.categories, blocking: { show: false, sound: 'Default' } } };
  assert.equal(alertGate(off, now, 'blocker'), 'this kind is switched off');
  assert.equal(alertGate(off, now, 'track'), '', 'a kind with no row is never switched off');
  assert.equal(alertCategory('done'), 'task-completed');
  assert.equal(alertCategory('handoff'), '');
});

test('the frame carries the resolved card and the files, and no toast document', () => {
  const { value } = validateAlert({ kind: 'blocker', title: 'Q12 needs you', where: 'WS-11', card: 'Q12' });
  const files = [{ id: 'Q12', index: 0, name: 'design.md' }];
  const frame = alertFrame(value, { base: BASE, settings: DEFAULTS, card: alertCard('Q12', BASE), files });
  assert.deepEqual(Object.keys(frame), ['kind', 'title', 'where', 'blocking', 'card', 'files', 'sound', 'question']);
  assert.equal(frame.card, BASE + 'r/Q12');
  assert.equal(frame.question, 'Q12', 'a question card names its question, so a retract can take it');
  assert.deepEqual(frame.files, files);
  assert.equal(frame.sound, 'Default', 'the row sound when the request names none');
  assert.equal(frame.blocking, true, 'a blocker stands until dismissed');
  const quiet = alertFrame(validateAlert({ kind: 'info', title: 'x', sound: 'silent' }).value,
    { base: BASE, settings: DEFAULTS, card: alertCard('', BASE), files: [] });
  assert.equal(quiet.card, '');
  assert.equal(quiet.sound, 'silent');
  assert.equal(quiet.question, undefined);
  assert.ok(!/[\u2013\u2014]/.test(JSON.stringify(frame)));
});

test('the context line in names and the pick, both optional and both cut', () => {
  const { value } = validateAlert({
    kind: 'blocker', title: 'Which carrier for the band?', where: 'Q512, blocks work, WS-11',
    card: 'Q12', pick: '  the output style\n carrier ',
    whereNames: { project: 'Tidewatch', workstream: 'the board', track: ' mod core ', holds: 'the tray cards', extra: 'x' },
  });
  assert.equal(value.pick, 'the output style carrier');
  assert.deepEqual(value.whereNames,
    { project: 'Tidewatch', workstream: 'the board', track: 'mod core', holds: 'the tray cards' },
    'the four parts, flattened; an unknown key is ignored');
  assert.equal(alertPlace(value.whereNames),
    'Tidewatch \u00B7 the board \u00B7 track mod core \u00B7 holds up the tray cards');
  assert.equal(alertPlace({ workstream: 'the board' }), 'the board');
  assert.equal(alertPlace({}), '');
  assert.equal(alertPlace({ project: 'p'.repeat(60), workstream: 'w'.repeat(60), track: 't' }).length, 120);
  assert.deepEqual(validateAlert({ kind: 'info', title: 'x', whereNames: { project: '  ' } }).value.whereNames, {});
  assert.equal(validateAlert({ kind: 'info', title: 'x', pick: 'p'.repeat(200) }).value.pick.length, 80);

  const frame = alertFrame(value, { base: BASE, settings: DEFAULTS, card: alertCard('Q12', BASE), files: [] });
  assert.deepEqual(Object.keys(frame),
    ['kind', 'title', 'where', 'blocking', 'card', 'files', 'sound', 'place', 'pick', 'question']);
  assert.equal(frame.where, 'Q512, blocks work, WS-11', 'an older exe still reads where');
  assert.equal(frame.place, alertPlace(value.whereNames));
  assert.equal(frame.pick, 'the output style carrier');

  const plain = alertFrame(validateAlert({ kind: 'done', title: 'x', where: 'WS-11' }).value,
    { base: BASE, settings: DEFAULTS, card: alertCard('', BASE), files: [] });
  assert.ok(!('place' in plain) && !('pick' in plain), 'unset names and pick add no keys');
  assert.ok(!/[\u2013\u2014]/.test(JSON.stringify(frame)));
});

/* What each sender builds passes the request gate whole, names and all. */
test('the question and work senders build names the request keeps', () => {
  const q = { kind: 'open', blocking: true, projectName: 'Tidewatch', workstreamName: 'the board',
    holdsName: 'tray cards' };
  const ask = validateAlert({ kind: 'blocker', title: 'store shape', where: 'Q7, blocks work, WS-11',
    whereNames: questionWhereNames(q), pick: 'Names on the card' });
  assert.equal(alertPlace(ask.value.whereNames), 'Tidewatch \u00B7 the board \u00B7 holds up tray cards');
  assert.equal(ask.value.pick, 'Names on the card');
  const e = { id: 'T-1', name: 'counter rebuild', ending: 'completed', workstreamName: 'the board' };
  const done = validateAlert({ kind: 'done', title: workAlertTitle(e), whereNames: workWhereNames(e) });
  assert.equal(done.value.title, 'counter rebuild completed');
  assert.equal(alertPlace(done.value.whereNames), 'the board');
  /* a woken question's card says what woke it, by name */
  const [woken] = enrichEvents([{ kind: 'open', id: 'Q8', name: 'x', woken: true, wokeBy: 'T-75 completed' }],
    [{ id: 'Q8', workstream: 'WS-11' }], { 'T-75': 'counter rebuild', 'WS-11': 'the board' });
  const wv = validateAlert(questionAlert(woken, 'Default')).value;
  const place = alertFrame(wv, { base: BASE, settings: DEFAULTS, card: alertCard('Q8', BASE), files: [] }).place;
  assert.ok(place.startsWith('woken by counter rebuild') && place.includes('the board') && !place.includes('T-75'), place);
});
