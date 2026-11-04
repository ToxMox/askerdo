/* Record IDs on the surfaces: the told-question guard's pure half. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { clashText, toldClash } from '../lib/mod-core.mjs';

test('toldClash finds a question told in this session under the label with another key', () => {
  const told = [
    { id: 'Q12', key: 'aaaaaaaa', name: 'one', session: 's1' },
    { id: 'Q12', key: 'bbbbbbbb', name: 'two', session: 's2' },
  ];
  assert.equal(toldClash(told, 's1', 'Q12', 'aaaaaaaa'), null);
  assert.equal(toldClash(told, 's1', 'Q12', 'cccccccc').name, 'one');
  assert.equal(toldClash(told, 's1', 'Q13', 'cccccccc'), null);
  assert.equal(toldClash(told, 's3', 'Q12', 'cccccccc'), null);
  /* no live key (an unmigrated store) is never a clash, nor a told entry without one */
  assert.equal(toldClash(told, 's1', 'Q12', ''), null);
  assert.equal(toldClash([{ id: 'Q12', name: 'old', session: 's1' }], 's1', 'Q12', 'aaaaaaaa'), null);
});

test('clashText names both records by label and name and the token for each', () => {
  const was = { id: 'Q12', key: 'bbbbbbbb', name: 'tray spacing' };
  assert.equal(clashText({ label: 'Q12', letter: 'b', liveName: 'two PCs', was, wasNow: 'Q14' }),
    'Not answered yet: this session was told Q12 (tray spacing), now Q14, but Q12 is now (two PCs). '
    + 'Type 12b again to answer Q12 (two PCs), or 14b for Q14 (tray spacing).');
  assert.equal(clashText({ label: 'Q12', letter: 'a', liveName: 'two PCs', was, wasNow: '' }),
    'Not answered yet: this session was told Q12 (tray spacing), but Q12 is now (two PCs). '
    + 'Type 12a again to answer Q12 (two PCs).');
});

/* ---- the board, tray and alert halves ---------------------------------- */

import { trayCards } from '../lib/board-state.mjs';
import { alertCard } from '../lib/notify.mjs';

const KEY = 'k7m2q9xa';
const snap = (entries) => ({ entries, unreadable: [] });

test('the tray cards carry the key where the record has one', () => {
  const s = snap([{ id: 'Q1', key: KEY, name: 'one', status: 'open', blocking: true }, { id: 'Q2', name: 'two', status: 'open', blocking: true }]);
  assert.deepEqual(trayCards(s), [{ id: 'Q1', name: 'one', key: KEY }, { id: 'Q2', name: 'two' }]);
});

test('an alert card names r/, and a parsed r/ path keeps its record', () => {
  const base = 'http://127.0.0.1:1/s/';
  assert.deepEqual(alertCard('Q12', base), { url: base + 'r/Q12', id: 'Q12' });
  assert.deepEqual(alertCard('r/T-3', base), { url: base + 'r/T-3', id: 'T-3' });
  assert.deepEqual(alertCard('r/' + KEY, base), { url: base + 'r/' + KEY, id: '' });
});
