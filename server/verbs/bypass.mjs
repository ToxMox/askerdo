/* The placement bypass: whether a switch covers a filing, and the user's presses on the tray's switches. */
import { tx } from '../db.mjs';
import { actorOf, clockOf, getMeta, logVerb, sessionWords, setMeta, stampNow } from '../records.mjs';
import { loadRecord } from './graph.mjs';
import { UsageError, resolveRecord } from './labels.mjs';
import { effective, resolveSession, rulesFor } from './profiles.mjs';
import { goFrees } from './questions.mjs';
import { IDLED_HOURS, endWords, rowLapsed } from './bypass-rows.mjs';

export { IDLED_HOURS };

const STORE = 'placement.bypass';
const MAX_MINUTES = 10080;
const isUser = (c) => /^user(?::|$)/.test(String((c && c.by) || ''));
const nowOf = (c) => (c && c.date ? c.date.getTime() : Date.now());

function readStore(db) {
  let v = null;
  try { v = JSON.parse(getMeta(db, STORE) || 'null'); } catch { v = null; }
  const rows = v && Array.isArray(v.rows) ? v.rows.filter((r) => r && typeof r === 'object') : [];
  const top = rows.reduce((m, r) => Math.max(m, Number(r.n) || 0), 0);
  return { next: Math.max(Number(v && v.next) || 1, top + 1), rows };
}

const liveRows = (db, now) => readStore(db).rows.filter((r) => !rowLapsed(r, now));

/* A tray row as the resolver's answer: `span` for the rules line. */
function switchOf(row, now) {
  const span = row.until === 'time' ? 'until ' + endWords(row.ends, now) : row.until === 'ended' ? 'until it ends' : 'until the user turns it off';
  return { how: row.scope, span, ...(row.until === 'time' ? { ends: row.ends } : {}) };
}

const modeOf = (db, heldRec) => resolveSession(db, { track: heldRec.fields.id }).settings['placement.mode'].value;

/* { how, words, span, ends? } or null. Tray first, so any tray switch outranks the Settings layers. */
export function bypassFor(db, c, heldRec) {
  if (!c || !c.session || isUser(c)) return null;
  const now = nowOf(c);
  const rows = liveRows(db, now);
  const row = rows.find((r) => r.scope === 'every') || rows.find((r) => r.scope === 'session' && r.session === c.session);
  if (row) return switchOf(row, now);
  const go = goFrees(db, c.session);
  if (go) {
    return { how: 'go', span: 'until ' + go.task + " closes, by the user's answer on " + go.question };
  }
  if (heldRec && modeOf(db, heldRec) === 'model') {
    return { how: 'setting', span: "by the user's Task placement setting" };
  }
  return null;
}

/* The session's own rules, with the switch covering it. */
export function rulesWithBypass(db, input = {}, actor, opts) {
  const r = rulesFor(db, input);
  const session = typeof input.session === 'string' ? input.session.trim() : '';
  const track = input.track ? resolveRecord(db, String(input.track).trim(), { kinds: ['track'] }) : null;
  if (!session || !track) return r;
  const sw = bypassFor(db, { session, by: 'session:' + session, date: clockOf(actor, opts) }, loadRecord(db, track.key));
  return sw ? { ...r, bypass: { words: sw.span, ...(sw.ends ? { ends: sw.ends } : {}) } } : r;
}

const timesOf = (db) => [].concat(effective(db, { record: 'default' }).settings['placement.times'].value || [])
  .map(Number).filter((m) => Number.isInteger(m) && m >= 1 && m <= MAX_MINUTES);

const holders = (db) => db.stmt(`SELECT l.session, l.pc, r.label AS track, json_extract(r.fields, '$.name') AS trackName
  FROM leases l JOIN records r ON r.key = l.track ORDER BY r.id`).all();

function readOf(db, now) {
  const sessions = holders(db).map((h) => ({ session: h.session, pc: h.pc || null, track: h.track, trackName: h.trackName || '' }));
  const rows = liveRows(db, now).map((r) => {
    if (r.scope !== 'session') return r;
    const held = sessions.find((s) => s.session === r.session);
    return { ...r, where: held ? { track: held.track, trackName: held.trackName, pc: held.pc } : { words: sessionWords(db, r.session) } };
  });
  return { rows, sessions, times: timesOf(db) };
}

export const bypassRead = (db, _input, actor, opts) => readOf(db, clockOf(actor, opts).getTime());

function logPress(db, c, n, name, changes) {
  logVerb(db, { ts: c.at, verb: 'bypass', kind: 'bypass', id: '#' + n, name, changes, by: c.by, pc: c.pc });
}

const save = (db, store) => setMeta(db, STORE, JSON.stringify({ next: store.next, rows: store.rows }));

/* The tray's press. It has no CLI verb, and anything but the user's actor is refused. */
export function bypassPress(db, input = {}, actor) {
  const c = actorOf(actor);
  if (!isUser(c)) throw new UsageError("a placement bypass is switched only by the user's press in the tray");
  const p = input && typeof input === 'object' ? input : {};
  return tx(db, () => {
    const now = nowOf(c);
    const store = readStore(db);
    store.rows = store.rows.filter((r) => !rowLapsed(r, now));
    if (p.act === 'off') {
      const gone = p.all === true ? store.rows : store.rows.filter((r) => r.n === Number(p.n));
      if (p.all !== true && !gone.length) throw new UsageError('no bypass switch #' + p.n + ' is on');
      store.rows = store.rows.filter((r) => !gone.includes(r));
      save(db, store);
      for (const r of gone) logPress(db, c, r.n, 'task placement bypass off', { act: [r.scope, 'off'] });
      return readOf(db, now);
    }
    if (p.act !== 'on') throw new UsageError('a bypass press is on or off');
    if (!['every', 'session'].includes(p.scope)) throw new UsageError('a bypass covers every session or one session');
    const session = typeof p.session === 'string' ? p.session.trim() : '';
    if (p.scope === 'session' && !session) throw new UsageError('a one-session bypass names its session');
    if (!['time', 'ended', 'off'].includes(p.until)) throw new UsageError('a bypass runs until a time, until its session ends, or until it is turned off');
    if (p.until === 'ended' && p.scope !== 'session') throw new UsageError('until it ends is for one session');
    if (p.until === 'off' && p.scope !== 'every') throw new UsageError('until turned off is for every session');
    const minutes = Number(p.minutes);
    if (p.until === 'time' && !(Number.isInteger(minutes) && minutes >= 1 && minutes <= MAX_MINUTES)) throw new UsageError('a bypass time is a whole number of minutes from 1 to ' + MAX_MINUTES);
    /* one switch per scope: a new press replaces the old one */
    store.rows = store.rows.filter((r) => !(r.scope === p.scope && (p.scope === 'every' || r.session === session)));
    const row = {
      n: store.next++, scope: p.scope, ...(p.scope === 'session' ? { session } : {}), until: p.until,
      ...(p.until === 'time' ? { ends: stampNow(new Date(now + minutes * 60000)) } : {}), set: c.at, by: c.by,
    };
    store.rows.push(row);
    save(db, store);
    const sw = switchOf(row, now);
    logPress(db, c, row.n, 'task placement bypass: ' + (p.scope === 'every' ? 'every session' : 'one session') + ' ' + sw.span, { act: [null, 'on'], scope: [null, p.scope], until: [null, p.until] });
    return readOf(db, now);
  });
}

/* A session's end or start, from the mod: `reason` is the end's, or 'start'. An idle end
   (`other`) keeps an until-it-ends row with a stamp, since a reopen is a new process under the same id. */
export function bypassEnded(db, { session, reason } = {}, actor) {
  const c = actorOf(actor);
  const s = typeof session === 'string' ? session.trim() : '';
  if (!s || c.session !== s) throw new UsageError("bypassEnded takes only the caller's own session");
  return tx(db, () => {
    const store = readStore(db);
    const row = store.rows.find((r) => r.scope === 'session' && r.session === s && r.until === 'ended');
    if (!row) return { changed: false };
    const now = nowOf(c);
    /* a lapsed row stays gone, so a later idle end cannot stamp it back on */
    const keep = !rowLapsed(row, now) && (reason === 'start' ? Boolean(row.idled) : reason === 'other');
    if (keep && reason === 'start') delete row.idled;
    else if (keep) row.idled = c.at;
    else store.rows = store.rows.filter((r) => r !== row);
    save(db, store);
    logPress(db, c, row.n, 'task placement bypass: one session ' + (keep ? (reason === 'start' ? 'back' : 'idle') : 'ended'), { act: [null, keep ? (reason === 'start' ? 'back' : 'idled') : 'ended'] });
    return { changed: true, kept: keep };
  });
}
