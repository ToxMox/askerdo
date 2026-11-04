/* Stamp assertions for the suite.
 *
 * The FORMAT is written out here as a literal, not imported from
 * lib/stamps.mjs: a test that checked a writer's output against the writer's
 * own regex would agree with any format either of them drifted to.
 * test/stamps.test.mjs pins the module's own behavior digit by digit; this
 * file is what every other test file uses to say "that is a stamp this run
 * wrote", and both would have to be edited for a format change to pass.
 *
 * Nothing here reads a store, a clock seam, or an environment variable: the
 * day comparison is against the machine's own local day, which is the day a
 * verb running in the same process stamped with. */
import assert from 'node:assert/strict';

/* The full form, spelled out: RFC 3339 local time with a numeric offset, to
   the second, no fractional part, never a Z. */
export const FULL_STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/;

/* The day form older records carry, and the one shape --until still takes. */
export const DAY_STAMP = /^\d{4}-\d{2}-\d{2}$/;

/* The machine's local day, the way the store spells one. */
export function localDay(d = new Date()) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
    + '-' + String(d.getDate()).padStart(2, '0');
}

/* The exact stamp the store writes for a given instant, spelled out here from
   the format rather than imported from lib/stamps.mjs, for the reason the
   regex above is: a byte-for-byte skeleton compared against the writer's own
   formatter would agree with whatever that formatter did. Paired with a fixed
   clock through the store's `opts.now` seam, this is what makes a skeleton
   comparable byte for byte on a machine in any timezone. */
export function stampFor(d) {
  const p = (n, w = 2) => String(Math.abs(n)).padStart(w, '0');
  const off = -d.getTimezoneOffset();
  return localDay(d) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds())
    + (off < 0 ? '-' : '+') + p(Math.floor(Math.abs(off) / 60)) + ':' + p(Math.abs(off) % 60);
}

/* A store options bag carrying a FIXED clock, the one seam a test moves the
   store's stamps through. Never an environment variable: the store's clock is
   not user API. */
export const fixedClock = (d) => ({ now: () => d });

/* A stamp this run just wrote: the full shape, and today's day in front of it.
   The day is compared rather than the clock, so a case that straddles a second
   boundary is not flaky; a case that straddles MIDNIGHT would be, and no case
   in this suite runs long enough to. */
export function assertFreshStamp(value, message) {
  const label = message ? message + ': ' : '';
  assert.match(String(value), FULL_STAMP, label + 'a full local timestamp');
  assert.equal(String(value).slice(0, 10), localDay(), label + "today's day in front");
}
