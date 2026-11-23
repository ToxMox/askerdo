/* The activity feed's words (the tray console's lines), for the app's
   Home and the board's activity page alike. The server image ships only server/, so
   they live here and lib/mod-core.mjs imports them back. */
import { leftWords } from './draw.mjs';

const MID = ' · ';
const flat = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const lastPart = (dir) => String(dir || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || '';
const two = (n) => String(n).padStart(2, '0');

/* the console's past tense for a verb (tray/src/console_view.rs), with the store's other verbs */
const VERB_WORDS = {
  create: 'created', update: 'updated', edit: 'edited', answer: 'answered', amend: 'amended', close: 'closed',
  reopen: 'reopened', note: 'noted', drop: 'dropped', snooze: 'snoozed', wake: 'woke', surface: 'surfaced',
  subscribe: 'subscribed', link: 'linked', unlink: 'unlinked', delete: 'deleted', bind: 'bound', handoff: 'handed off', join: 'joined', bypass: 'switched',
  /* a profile line's kind is profile, so its verb words only the act */
  'profile-define': 'defined', 'profile-edit': 'edited', 'profile-add': 'added', 'profile-remove': 'removed',
};
const verbWord = (v) => VERB_WORDS[v] || String(v || '');
/* an override line's verb is its kind, so its act is worded from its changes */
const OVERRIDE_DONE = { withdraw: 'withdrawn', fix: 'fixed', scrub: 'scrubbed' };
const OVERRIDE_ACTS = [['asked', () => 'asked'], ['decided', (v, act) => (v === 'allow' ? OVERRIDE_DONE[act] || 'allowed' : 'kept as written')],
  ['changed', () => 'refused, changed since asked'], ['dropped', () => 'closed unanswered']];
function overrideWord(changes) {
  const now = (v) => (Array.isArray(v) ? v[1] : v);
  for (const [k, word] of OVERRIDE_ACTS) {
    const v = now(changes && changes[k]);
    if (v !== undefined && v !== null) return word(v, now(changes.act));
  }
  return 'changed';
}
/* an edit's inHand move in the hand's words, as the relay says it; a let-go
   an ending carries is no hand move, as work.mjs answers it */
function handWord(changes, status) {
  const pair = changes && changes.inHand;
  if (!Array.isArray(pair)) return '';
  if (pair[1]) return pair[0] ? 'taken over' : 'taken in hand';
  return pair[0] && !['done', 'completed', 'dropped'].includes(status) ? 'let go' : '';
}
/* A session run's line (runs.mjs) in the hand's words: its open a take, its end handed on a
   let go, taken over a take-over; a close's end is no hand move */
function runWord(changes) {
  const run = changes && changes.run;
  const worker = changes && Array.isArray(changes.worker) ? changes.worker[0] || changes.worker[1] : null;
  if (!Array.isArray(run) || worker !== 'session') return '';
  if (run[1]) return 'taken in hand';
  const how = Array.isArray(changes.how) ? changes.how[1] : null;
  return how === 'taken_over' ? 'taken over' : how === 'handed_on' ? 'let go' : how === 'closed_idle' ? 'let go, closed by the app' : '';
}
/* the status a hand move brings with it, which its row leaves unsaid */
const HAND_STATUS = { 'taken in hand': 'in progress', 'taken over': 'in progress', 'let go': 'open', 'let go, closed by the app': 'open' };
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const localDay = (ms) => { const d = new Date(ms); return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()); };

/* The console's day heading: Today, Yesterday, else the weekday and date. */
export function dayLabel(day, now) {
  const [y, m, d] = String(day).split('-').map(Number);
  const at = new Date(y, m - 1, d);
  if (!Number.isFinite(at.getTime()) || !Number.isFinite(now)) return String(day);
  if (day === localDay(now)) return 'Today';
  if (day === localDay(now - 86400000)) return 'Yesterday';
  return WEEKDAYS[at.getDay()] + ' ' + d + ' ' + MONTHS[m - 1] + (y === new Date(now).getFullYear() ? '' : ' ' + y);
}

/* a stamp to the minute on its writer's wall clock, as the board words dates:
   "today 15:18", "yesterday 9:04", else "Oct 26 15:18"; an unreadable one stays as is. */
export function atWords(iso, now) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return String(iso || '');
  const z = /([+-])(\d{2}):(\d{2})$/.exec(String(iso));
  const off = z ? (z[1] === '-' ? -1 : 1) * (Number(z[2]) * 60 + Number(z[3])) : -new Date(t).getTimezoneOffset();
  const wall = (ms) => new Date(ms + off * 60000);
  const dayOf = (d) => d.getUTCFullYear() + '-' + d.getUTCMonth() + '-' + d.getUTCDate();
  const at = wall(t);
  const clock = at.getUTCHours() + ':' + two(at.getUTCMinutes());
  if (Number.isFinite(now)) {
    if (dayOf(at) === dayOf(wall(now))) return 'today ' + clock;
    if (dayOf(at) === dayOf(wall(now - 86400000))) return 'yesterday ' + clock;
  }
  const year = Number.isFinite(now) && at.getUTCFullYear() !== wall(now).getUTCFullYear() ? ', ' + at.getUTCFullYear() : '';
  return MONTHS[at.getUTCMonth()].slice(0, 3) + ' ' + at.getUTCDate() + year + ' ' + clock;
}

/* An age as the shelf and the kickoff say it: "40m", "3h", "2d". */
export const ageText = (msAgo) => {
  const m = Math.max(0, Math.floor(msAgo / 60000));
  if (m < 60) return m + 'm';
  const hrs = Math.floor(m / 60);
  return hrs < 48 ? hrs + 'h' : Math.floor(hrs / 24) + 'd';
};

/* Who a task's word names, where and since when, one wording for track show's rows
   and a task's own head; a session as this one or a session, never its id. */
export const runnerWords = (w, reader) => (w.worker === 'agent' ? 'agent ' + (w.job || 'with no job name') : w.session && w.session === reader ? 'this session' : 'a session');
export function whoWords(w, now, reader) {
  const who = runnerWords(w, reader);
  if (w.is === 'unconfirmed') return who + (w.pc ? ' on ' + w.pc : '') + (w.since ? ', not heard since ' + atWords(w.since, now) : '');
  if (w.is === 'running') return who;
  if (w.is !== 'ready') return '';
  return w.next === 'settle' ? who + ' finished' : w.next === 'continue' ? leftWords(who, w.how) : '';
}

/* A task's word on one line, for its show head and its block: "running for 40m: agent x",
   "ready to continue for 2h: a session handed on", "waiting: after T-4". */
export function wordLine(w, now, reader) {
  if (!w || !w.is) return '';
  const t = Date.parse(w.since || '');
  const age = (w.is === 'running' || w.is === 'ready') && Number.isFinite(t) && Number.isFinite(now) ? ageText(now - t) : '';
  const rest = w.is === 'waiting' ? (Array.isArray(w.on) ? w.on.join('; ') : '') : whoWords(w, now, reader);
  return (w.is === 'ready' ? 'ready to ' + (w.next || 'start') : w.is) + (age ? ' for ' + age : '') + (rest ? ': ' + rest : '');
}

/* who holds a track, plainly: its PC ("this PC" for the asker's), when it took the
   track, when last active or quiet since; never the session's id. */
export function holderWords(h, { now, pc } = {}) {
  const x = h || {};
  const here = x.pc && pc && String(x.pc).toLowerCase() === String(pc).toLowerCase();
  const quiet = x.quietSince || '';
  const seen = quiet || (x.seen && atWords(x.seen, now) !== atWords(x.since, now) ? x.seen : '');
  const took = x.since ? atWords(x.since, now) : '';
  /* the second time on the same day says its clock alone ("today" twice) */
  const dayOf = (w) => w.slice(0, w.lastIndexOf(' '));
  const then = seen ? atWords(seen, now) : '';
  const last = took && then && dayOf(took) === dayOf(then) ? then.slice(then.lastIndexOf(' ') + 1) : then;
  const parts = [took ? 'took it ' + took : '', seen ? (quiet ? 'quiet since ' : 'last active ') + last : ''].filter(Boolean);
  return 'a session' + (x.pc ? ' on ' + (here ? 'this PC' : x.pc) : '') + (parts.length ? ' (' + parts.join(', ') + ')' : '');
}

/* The desktop opens a Link only for https: or http://localhost (kit, 2.1.299), so a local
 * address takes the plain localhost name the host guard answers; any other plain http:
 * address gives '', so no dead press draws. */
export const cardHref = (url) => {
  const s = String(url || '').replace(/^http:\/\/(?:[a-z0-9-]+\.localhost|127\.0\.0\.1)(?=[:/?#]|$)/i, 'http://localhost');
  return /^(?:https:\/\/|http:\/\/localhost(?:[:/?#]|$))/i.test(s) ? s : '';
};

/* The local server's browser root (its 32-hex segment signs the browser in), '' for none. */
export const signedRoot = (local) => (String(local || '').match(/^https?:\/\/[^/]+\/[0-9a-f]{32}\//) || [''])[0];

/* A record's page as the desktop opens it: through the local server's signed route by key or
 * label when one is known, since a plain-http LAN board opens nowhere; else `url` as is. */
export const recordHref = (local, ref, url) => {
  const root = signedRoot(local);
  const r = String(ref || '');
  return root && /^[\w.-]+$/.test(r) ? cardHref(root + 'r/' + r) : cardHref(url);
};

/* One log line as the feed shows it (the console's two lines), or null where it has no
   stamp, kind or id. `what`: the kind, the verb, the status it moved to, the project, the workstream. */
export function feedEntry(l, wsNames = {}) {
  if (!l || typeof l !== 'object' || l.unreadable) return null;
  const ts = String(l.ts || '');
  if (ts.length < 16 || !l.kind || !l.id) return null;
  const pair = l.changes && l.changes.status;
  const status = String((Array.isArray(pair) ? pair[1] : '') || '').replace(/_/g, ' ');
  const hand = l.verb === 'edit' ? handWord(l.changes, status) : l.verb === 'run' ? runWord(l.changes) : '';
  const word = hand || (l.kind === 'override' && l.verb === 'override' ? overrideWord(l.changes) : verbWord(l.verb));
  const project = lastPart(String(l.project || '').replace(/\\/g, '/'));
  const ws = l.ws ? (wsNames && wsNames[l.ws]) || l.ws : '';
  const said = status && l.verb !== 'create' && !word.includes(status) && status !== HAND_STATUS[hand];
  const act = l.kind + ' ' + word + (said ? ', now ' + status : '');
  /* a name that only repeats the id (a profile's) draws once */
  const name = flat(l.name) === String(l.id) ? '' : flat(l.name);
  return { at: String(l.at || ts + ' ' + l.id + ' ' + l.verb), ts, day: ts.slice(0, 10), time: ts.slice(11, 16),
    kind: String(l.kind), verb: String(l.verb || ''), id: String(l.id), key: typeof l.key === 'string' ? l.key : '', name, status, hand, project, ws,
    act, what: whatOf(act, project, ws), href: l.href ? cardHref(l.href) : '' };
}
const whatOf = (act, project, ws) => [act, project, ws].filter(Boolean).join(MID);

/* one row per change: a record's lines for one verb in one minute merge,
   repeats count and an echo gives way; hand moves stay apart, upkeep's status folds into one. */
const echo = (plain, told) => !plain.status && !!told.status && told.act.startsWith(plain.act);
const follows = (plain, hand) => !plain.hand && !!plain.status && plain.status === HAND_STATUS[hand.hand];
function merged(entries) {
  const out = [];
  const last = new Map();
  for (const e of entries) {
    /* a take-over is two run lines, the old run's end and the new one's open: one row */
    const prev = out[out.length - 1];
    const pair = prev && !prev.folded && prev.key === e.key && prev.id === e.id && prev.ts.slice(0, 16) === e.ts.slice(0, 16) ? [prev.hand, e.hand].sort().join() : '';
    if (pair === 'taken in hand,taken over') {
      out[out.length - 1] = { ...(e.hand === 'taken over' ? e : prev), name: e.name || prev.name, href: e.href || prev.href, count: 1, folded: true };
      continue;
    }
    /* a run's hand move merges with the upkeep status that follows it, as an edit's did */
    const k = [e.key || e.kind, e.id, e.hand ? 'edit' : e.verb, e.ts.slice(0, 16)].join('\n');
    const p = last.has(k) && !(e.hand && out[last.get(k)].hand) ? out[last.get(k)] : null;
    if (p && follows(e, p)) continue;
    if (p && follows(p, e)) { out[last.get(k)] = { ...e, name: e.name || p.name, href: e.href || p.href, count: 1 }; continue; }
    if (p && p.act === e.act) { p.count += 1; continue; }
    if (p && echo(e, p)) continue;
    if (p && echo(p, e)) { out[last.get(k)] = { ...e, name: e.name || p.name, href: e.href || p.href, count: 1 }; continue; }
    last.set(k, out.length);
    out.push({ ...e, count: 1 });
  }
  for (const e of out) if (e.count > 1) e.what = whatOf(e.act + ', ' + e.count + ' times', e.project, e.ws);
  return out;
}

/* The console's filter: every word of the box in the line's project, workstream, kind, verb,
   status, id or name, case aside. */
export function feedMatches(e, filter) {
  const hay = [e.project, e.ws, e.kind, e.verb, verbWord(e.verb), e.hand, e.status, e.id, e.name].join(' ').toLowerCase();
  return String(filter || '').toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}

/* The feed's rows in the log's own order (newest first), a day heading before each day's first line. */
export function feedRows(lines, { filter = '', now, wsNames } = {}) {
  const entries = merged((lines || []).map((l) => feedEntry(l, wsNames)).filter((e) => e && feedMatches(e, filter)));
  const rows = [];
  let day = '';
  for (const e of entries) {
    if (e.day !== day) { day = e.day; rows.push({ heading: dayLabel(day, now) }); }
    rows.push(e);
  }
  return rows;
}
