/* The store's timestamp seam, pure module and pure tests. Every case
 * that needs an offset builds a Date whose LOCAL offset is known by
 * construction, so the file passes in any timezone. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DAY_RE, STAMP_RE, compareStamps, formatStamp, isFullStamp, isStamp, parseStamp, stampDay, stampNow,
} from '../lib/stamps.mjs';

/* The machine's own offset for a given instant, in minutes east of UTC. */
const offsetOf = (d) => -d.getTimezoneOffset();

/* A Date whose local offset differs from another's exists on any machine that
   keeps daylight time; on one that does not, the sign cases are covered by the
   format assertions instead. */
const JAN = new Date(2026, 0, 15, 13, 2, 45);
const JUL = new Date(2026, 6, 15, 13, 2, 45);

test('formatStamp writes an instant in the offset it is handed', () => {
  /* one instant, three offsets: fixed values, so nothing here depends on where
     the test runs */
  const t = Date.UTC(2026, 8, 4, 17, 2, 45);
  assert.equal(formatStamp(t, -240), '2026-09-04T13:02:45-04:00');
  assert.equal(formatStamp(t, 330), '2026-09-04T22:32:45+05:30');
  assert.equal(formatStamp(t, 0), '2026-09-04T17:02:45+00:00');
  /* git records an unknown timezone as '-0000', and a stamp built from such a
     commit keeps the sign the commit carried */
  assert.equal(formatStamp(t, -0), '2026-09-04T17:02:45-00:00');
  for (const off of [-240, 330, 0, -0]) {
    const s = formatStamp(t, off);
    assert.match(s, STAMP_RE, s);
    assert.equal(parseStamp(s).ms, t, s + ' names the instant it was given');
  }
});

test('stampNow writes the one format: local time, numeric offset, no Z', () => {
  for (const d of [JAN, JUL, new Date(2026, 8, 4, 0, 0, 0), new Date(2026, 11, 31, 23, 59, 59)]) {
    const s = stampNow(d);
    assert.match(s, STAMP_RE, s);
    assert.ok(!s.includes('Z'), s);
    assert.ok(!s.includes('.'), 'no fractional seconds: ' + s);
    /* the local wall clock it was handed, digit for digit */
    assert.equal(s.slice(0, 19), d.getFullYear() + '-'
      + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
      + 'T' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
      + ':' + String(d.getSeconds()).padStart(2, '0'), s);
    /* and the offset that instant actually had, sign and all */
    const off = offsetOf(d);
    const want = (off < 0 ? '-' : '+') + String(Math.floor(Math.abs(off) / 60)).padStart(2, '0')
      + ':' + String(Math.abs(off) % 60).padStart(2, '0');
    assert.equal(s.slice(19), want, s);
  }
});

test('stampNow round-trips through parseStamp to the same instant', () => {
  for (const d of [JAN, JUL]) {
    const p = parseStamp(stampNow(d));
    assert.ok(p, 'parses');
    assert.equal(p.precise, true);
    /* to the second: the format carries no milliseconds */
    assert.equal(p.ms, Math.floor(d.getTime() / 1000) * 1000);
  }
});

test('both offset signs parse to the instant they name', () => {
  /* fixed strings, so the assertion does not depend on where this runs */
  assert.equal(parseStamp('2026-09-04T13:02:45-04:00').ms, Date.UTC(2026, 8, 4, 17, 2, 45));
  assert.equal(parseStamp('2026-09-04T13:02:45+05:30').ms, Date.UTC(2026, 8, 4, 7, 32, 45));
  assert.equal(parseStamp('2026-09-04T13:02:45+00:00').ms, Date.UTC(2026, 8, 4, 13, 2, 45));
  for (const s of ['2026-09-04T13:02:45-04:00', '2026-09-04T13:02:45+05:30', '2026-09-04T13:02:45+00:00']) {
    assert.equal(parseStamp(s).day, '2026-09-04');
    assert.equal(parseStamp(s).precise, true);
    assert.equal(stampDay(s), '2026-09-04');
  }
});

test('a date-only stamp parses to LOCAL midnight and says it is not precise', () => {
  const p = parseStamp('2026-09-04');
  assert.deepEqual({ day: p.day, precise: p.precise }, { day: '2026-09-04', precise: false });
  assert.equal(p.ms, new Date(2026, 8, 4).getTime());
  assert.equal(stampDay('2026-09-04'), '2026-09-04');
  /* surrounding whitespace is trimmed, since a hand-edited record can carry it */
  assert.equal(stampDay('  2026-09-04  '), '2026-09-04');
});

test('junk returns null, and stampDay answers with an empty string', () => {
  const junk = [
    undefined, null, '', '   ', 42, {}, [],
    '2026-8-14', '20260814', 'yesterday', '2026-09-04 13:02:45',
    '2026-09-04T13:02:45', '2026-09-04T13:02:45Z', '2026-09-04T13:02:45.123-04:00',
    '2026-09-04T13:02:45-0400', '2026-09-04T13:02-04:00',
    /* three groups of digits that name no day */
    '2026-13-01', '2026-02-30', '2026-00-10',
    '2026-13-01T00:00:00+00:00',
  ];
  for (const s of junk) {
    assert.equal(parseStamp(s), null, JSON.stringify(s));
    assert.equal(stampDay(s), '', JSON.stringify(s));
    assert.equal(isStamp(s), false, JSON.stringify(s));
  }
  /* edge whitespace is trimmed on both forms rather than being junk: a
     hand-edited record can carry it and still name a day */
  assert.equal(stampDay('2026-09-04T13:02:45-04:00 '), '2026-09-04');
  assert.equal(parseStamp(' 2026-09-04T13:02:45-04:00').precise, true);
});

test('isFullStamp separates the two forms', () => {
  assert.equal(isFullStamp('2026-09-04T13:02:45-04:00'), true);
  assert.equal(isFullStamp('2026-09-04'), false);
  assert.equal(isFullStamp(''), false);
  assert.equal(isFullStamp(undefined), false);
  assert.equal(DAY_RE.test('2026-09-04'), true);
  assert.equal(STAMP_RE.test('2026-09-04'), false);
});

test('compareStamps orders by instant across both forms', () => {
  const day = '2026-09-04';
  const morning = stampNow(new Date(2026, 8, 4, 9, 0, 0));
  const evening = stampNow(new Date(2026, 8, 4, 21, 0, 0));
  assert.equal(compareStamps(morning, evening), -1);
  assert.equal(compareStamps(evening, morning), 1);
  assert.equal(compareStamps(morning, morning), 0);
  /* a date-only stamp sits at its own local midnight, so it precedes every
     full stamp of the same day and follows every one of the day before */
  assert.equal(compareStamps(day, morning), -1);
  assert.equal(compareStamps(day, stampNow(new Date(2026, 8, 3, 23, 59, 59))), 1);
  assert.equal(compareStamps('2026-09-03', day), -1);
  /* junk sorts before every real stamp, as the empty string does in a plain string
     compare */
  assert.equal(compareStamps('nonsense', day), -1);
  assert.equal(compareStamps(day, 'nonsense'), 1);
  assert.equal(compareStamps('', undefined), 0);
  const sorted = [evening, day, morning, ''].slice().sort(compareStamps);
  assert.deepEqual(sorted, ['', day, morning, evening]);
});

test('stampNow refuses a Date that is not one', () => {
  assert.throws(() => stampNow(new Date('nonsense')), TypeError);
  assert.throws(() => stampNow('nonsense'), TypeError);
});
