/* A bypass switch's row, read with no database, so the board and each PC judge a lapse alike. */

// The longest default time in the list.
export const IDLED_HOURS = 8;
const HOUR = 3600000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const two = (n) => String(n).padStart(2, '0');

/* Judged when read, so a crash leaves nothing on. */
export function rowLapsed(row, nowMs) {
  if (!row || typeof row !== 'object') return true;
  if (row.until === 'time' && !(Date.parse(row.ends) > nowMs)) return true;
  return Boolean(row.idled) && !(nowMs - Date.parse(row.idled) <= IDLED_HOURS * HOUR);
}

/* An end on the reader's clock, with its day once that is not today. */
export function endWords(ends, nowMs) {
  const d = new Date(Date.parse(ends));
  const clock = two(d.getHours()) + ':' + two(d.getMinutes());
  return d.toDateString() === new Date(nowMs).toDateString() ? clock : MONTHS[d.getMonth()] + ' ' + d.getDate() + ' ' + clock;
}
