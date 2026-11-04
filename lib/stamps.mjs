/* The store's one timestamp seam: RFC 3339 local time with a numeric
 * offset, never Z, so a stamp says the clock its writer saw and stays honest
 * later. The first ten characters are the day in both accepted forms. */

/* Deliberately narrow: no fractional seconds, no Z, no space separator, no
 * missing colon. One shape written, two shapes read. */
export const STAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/;
export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const pad = (n, width = 2) => String(Math.abs(n)).padStart(width, '0');

export const isStamp = (s) => parseStamp(s) !== null;

/* The full form only: the frontmatter serializer leaves such a stamp unquoted. */
export const isFullStamp = (s) => STAMP_RE.test(String(s ?? ''));

/* '2026-13-45' matches the shape and names no day, so the day is checked by
 * round trip through the local Date. */
function localMidnight(day) {
  const y = Number(day.slice(0, 4));
  const m = Number(day.slice(5, 7));
  const d = Number(day.slice(8, 10));
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return date.getTime();
}

/* The one formatter, so no caller assembles a stamp out of parts. offsetMinutes
 * is minutes east of UTC, and a negative zero is kept: git records an unknown
 * timezone as -0000. */
export function formatStamp(ms, offsetMinutes) {
  const t = Number(ms);
  const off = Number(offsetMinutes);
  if (!Number.isFinite(t) || !Number.isFinite(off)) {
    throw new TypeError('formatStamp needs an instant and an offset in minutes');
  }
  /* The UTC fields of the shifted instant are the wall clock that offset was
   * showing. */
  const d = new Date(t + off * 60000);
  if (!Number.isFinite(d.getTime())) throw new TypeError('formatStamp needs an instant in range');
  const west = off < 0 || Object.is(off, -0);
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate())
    + 'T' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds())
    + (west ? '-' : '+') + pad(Math.floor(Math.abs(off) / 60)) + ':' + pad(Math.abs(off) % 60);
}

/* The Date is an argument so the caller owns the clock: the store passes
 * opts.now() when a test gave it one. */
export function stampNow(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const t = d.getTime();
  if (!Number.isFinite(t)) throw new TypeError('stampNow needs a valid Date');
  /* getTimezoneOffset's sign is the opposite of the one the format prints, and
   * a machine on UTC negates to a plain zero rather than the negative zero that
   * prints '-00:00'. */
  const tz = d.getTimezoneOffset();
  return formatStamp(t, tz === 0 ? 0 : -tz);
}

/* A date-only stamp gets ms at its own local midnight, which is where the day
 * it names starts for the person reading it. */
export function parseStamp(s) {
  const raw = String(s ?? '').trim();
  if (DAY_RE.test(raw)) {
    const ms = localMidnight(raw);
    return ms === null ? null : { day: raw, ms, precise: false };
  }
  if (!STAMP_RE.test(raw)) return null;
  const day = raw.slice(0, 10);
  if (localMidnight(day) === null) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? { day, ms, precise: true } : null;
}

export function stampDay(s) {
  const p = parseStamp(s);
  return p ? p.day : '';
}

/* An unparseable stamp sorts before every real one, as the empty string does
 * in a string compare. */
export function compareStamps(a, b) {
  const pa = parseStamp(a);
  const pb = parseStamp(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;
  return pa.ms < pb.ms ? -1 : pa.ms > pb.ms ? 1 : 0;
}
