/* The bypass switches in the server's words, for the tray and the band: pure, and each label
   carries end clock times, never a countdown, so a menu moves only when something changes. */
import { endWords, rowLapsed } from '../server/verbs/bypass-rows.mjs';

const msOf = (now) => (now instanceof Date ? now.getTime() : Number(now));
const cut = (s, n) => (s.length > n ? s.slice(0, n - 3).trimEnd() + '...' : s);
const plural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');

export function timeLabel(minutes) {
  if (minutes % 1440 === 0) return plural(minutes / 1440, 'day');
  if (minutes % 60 === 0) return plural(minutes / 60, 'hour');
  return plural(minutes, 'minute');
}

/* The tray's menu cuts a line at this many characters. */
const TRAY_LINE = 40;

/* A session by its track and PC, never its id. The track's name gives way first, so the
   PC and the end time survive the tray's cut. */
const placeLabel = (w, span = '') => {
  const end = span ? ' ' + span : '';
  if (!w || w.words) return cut(w ? w.words : 'a session', TRAY_LINE - end.length) + end;
  const tail = (w.pc ? ' on ' + w.pc : '') + end;
  const room = TRAY_LINE - String(w.track || '').length - 1 - tail.length;
  const line = [w.track, w.trackName && room >= 8 ? cut(String(w.trackName), room) : ''].filter(Boolean).join(' ') + tail;
  return line.length <= TRAY_LINE || !w.pc ? line : cut(w.pc, TRAY_LINE - end.length) + end;
};

const spanOf = (row, now, you) => (row.until === 'time' ? 'until ' + endWords(row.ends, now)
  : row.until === 'ended' ? 'until it ends' : 'until ' + you + ' turn' + (you === 'you' ? '' : 's') + ' it off');

/* The tray's block, null when the board has answered no read (an older board has no verb). */
export function bypassTray(read, now) {
  if (!read) return null;
  const at = msOf(now);
  const rows = (read.rows || []).filter((r) => !rowLapsed(r, at));
  return {
    on: rows.map((r) => ({ n: r.n, label: r.scope === 'every' ? 'every session ' + spanOf(r, at, 'you') : placeLabel(r.where, spanOf(r, at, 'you')) })),
    times: (read.times || []).map(Number).filter((m) => Number.isInteger(m) && m > 0).map((minutes) => ({ minutes, label: timeLabel(minutes) })),
    sessions: (read.sessions || []).map((s) => ({ session: s.session, label: placeLabel(s) })),
  };
}

/* The tray switch covering this session for the band, or null. The master switch is quiet, so
   any other switch is the one drawn; `master` says it is on whichever row that is. */
export function bypassBand(read, session, now) {
  if (!read || !session) return null;
  const at = msOf(now);
  const rows = (read.rows || []).filter((r) => !rowLapsed(r, at));
  const master = rows.find((r) => r.scope === 'every' && r.until === 'off');
  const row = rows.find((r) => r.scope === 'every' && r.until !== 'off')
    || rows.find((r) => r.scope === 'session' && r.session === session) || master;
  if (!row) return null;
  return {
    label: (row.scope === 'every' ? 'every session' : 'this session') + ' ' + spanOf(row, at, 'you'),
    ...(row.until === 'time' ? { ends: row.ends } : {}), ...(row === master ? { quiet: true } : {}),
    ...(master ? { master: true } : {}),
  };
}
