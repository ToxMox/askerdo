/* The channel lives in the board server, which already computes the digest a
 * browser would. Every alert goes to the tray exe's popup over the event
 * stream, and one that finds no tray is dropped. */
import { existsSync, readFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { join } from 'node:path';
import { appendLog, writeAtomic } from './store-io.mjs';
import { ensureBoardServer, pingBoard } from './board-ensure.mjs';
import { formatStamp, parseStamp } from './stamps.mjs';

/* Windows' notification sound names, so a person reading notify.json sees the
 * name Windows uses; the popup plays each as its system sound alias. Closed and
 * case-sensitive: one audible cue per event. */
export const SOUNDS = Object.freeze([
  'Default', 'IM', 'Mail', 'Reminder', 'SMS',
  'Looping.Alarm', 'Looping.Alarm2', 'Looping.Alarm3', 'Looping.Alarm4', 'Looping.Alarm5',
  'Looping.Alarm6', 'Looping.Alarm7', 'Looping.Alarm8', 'Looping.Alarm9', 'Looping.Alarm10',
  'Looping.Call', 'Looping.Call2', 'Looping.Call3', 'Looping.Call4', 'Looping.Call5',
  'Looping.Call6', 'Looping.Call7', 'Looping.Call8', 'Looping.Call9', 'Looping.Call10',
]);

/* The category rows, in the notifications page's order; plan-closed is the one
 * row for a plan and a workstream. */
export const CATEGORY_KEYS = Object.freeze([
  'blocking', 'open', 'closed', 'woken',
  'task-completed', 'task-dropped', 'plan-closed', 'collapse',
]);

/* Fresh every call: Object.freeze is shallow, so a shared row would let a
 * caller mutate the defaults for the life of the process. */
function defaultRow() {
  return { show: true, sound: 'Default' };
}

export function defaultCategories() {
  const out = {};
  for (const key of CATEGORY_KEYS) out[key] = defaultRow(key);
  return out;
}

/* Frozen row by row: a shallow freeze would leave every row writable, the
 * hazard defaultRow avoids. */
function frozenCategories() {
  const out = defaultCategories();
  for (const key of CATEGORY_KEYS) Object.freeze(out[key]);
  return Object.freeze(out);
}

/* THE ONE EDITOR TARGET, two templates and no more: a scheme or a
 * command line, VS Code by default. The exe runs it and the server never does,
 * which is what lets a template ride to the page at all. */
export const EDITOR_KEYS = Object.freeze(['file', 'folder']);

/* A wire and a file bound, not a display one: a pathological template would ride
 * every notify read and every open frame. */
export const EDITOR_MAX = 2048;

const EDITOR_FILE = 'vscode://file/{path}:{line}:{col}';
const EDITOR_FOLDER = 'vscode://file/{path}/';

export function defaultEditor() {
  return { file: EDITOR_FILE, folder: EDITOR_FOLDER };
}

/* Frozen on its own: Object.freeze is shallow, so a live editor object inside a
 * frozen DEFAULTS would let one caller mutate the defaults for the life of the
 * process, the hazard frozenCategories avoids. */
function frozenEditor() {
  return Object.freeze(defaultEditor());
}

/* One file the page writes and a hand edit may touch, re-read per tick and per
 * verb. `editor` names a program the EXE runs, which is why it may be edited on
 * a page where openCommand never could be. */
export const DEFAULTS = Object.freeze({
  enabled: true, tray: true,
  quietFrom: '', quietTo: '',
  categories: frozenCategories(),
  editor: frozenEditor(),
  /* Three shapes and no fourth: '' is no pause, the token is a pause
   * with no end, and a stamp lapses on its own. */
  pausedUntil: '',
});

/* THE PAUSE'S ONE TOKEN, so the three places that compare against it (the
   merge, the resolver and the label) cannot spell it three ways. */
export const PAUSE_FOREVER = 'until-resume';

/* THE FOUR VALUES THE `pause` VERB TAKES, in the order the menu and the page
   both show them. `''` is Resume, which is the only one that clears. */
export const PAUSE_TOKENS = Object.freeze(['hour', 'tomorrow', PAUSE_FOREVER, '']);

/* WHAT THE MORNING IS, made exact: the "until tomorrow morning" is 07:00
   local on the NEXT calendar day, an HH:MM the same way the quiet hours are. */
const MORNING_H = 7;
const MORNING_M = 0;

/* One tick raises at most this many alerts, the last of them a collapse
   summary when there were more events than that. A store that changed forty
   times between two ticks must not stack forty cards. */
export const CAP = 5;

const TITLE_MAX = 120;

/* the `where` line's wire bound */
const ATTR_MAX = 80;

export function settingsPath(root) {
  return join(root, 'board', 'notify.json');
}

function fileExists(p) {
  try { return existsSync(p); } catch { return false; }
}

/* Typed against each key's own default, so a config written before a key
 * existed stays valid and a wrong type falls back; typeof null is 'object', so
 * a null falls back too. */
export function mergeSettings(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
  /* the map is built FIRST and always, so the answer never carries a reference
     into DEFAULTS: a caller mutating a row it was handed would otherwise be
     mutating the defaults for the life of the process */
  const out = { ...DEFAULTS, categories: mergeCategories(src), editor: mergeEditor(src) };
  if (!src) return out;
  for (const key of Object.keys(DEFAULTS)) {
    /* the two objects have their own branches above and need them: `typeof []`
       is 'object', so the typed loop would take an array whole */
    if (key === 'categories' || key === 'editor') continue;
    if (typeof src[key] === typeof DEFAULTS[key]) out[key] = src[key];
  }
  /* A vocabulary, not just a type: anything but the empty string, the
   * token or a parseable stamp is junk. A past stamp stays, since a lapsed
   * pause is already off. */
  out.pausedUntil = cleanPause(out.pausedUntil);
  return out;
}

/* '' , the token, or a parseable store stamp; anything else is ''. */
function cleanPause(v) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (s === '' || s === PAUSE_FOREVER) return s;
  return parseStamp(s) ? s : '';
}

/* Out of the whole file, because the three superseded booleans seed the
 * map where no categories key exists. Two gates for one behaviour is a page
 * that can lie, so a map present is the whole truth. */
export function mergeCategories(raw) {
  const out = defaultCategories();
  const file = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
  if (!file) return out;
  const map = file.categories;
  if (!map || typeof map !== 'object' || Array.isArray(map)) {
    if (file.woken === false) {
      out.open.show = false;
      out.blocking.show = false;
      out.woken.show = false;
    }
    if (file.closed === false) out.closed.show = false;
    if (file.sound === false) for (const key of CATEGORY_KEYS) out[key].sound = 'silent';
    return out;
  }
  for (const key of CATEGORY_KEYS) {
    const row = map[key];
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    if (typeof row.show === 'boolean') out[key].show = row.show;
    if (row.sound === 'silent' || SOUNDS.includes(row.sound)) out[key].sound = row.sound;
  }
  return out;
}

/* Out of the whole file, mergeCategories' own shape: a fresh object every call,
 * and each template a string of its own or that template's default. The key
 * absent, null, an array or the wrong type is the whole default. */
export function mergeEditor(raw) {
  const out = defaultEditor();
  const file = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
  if (!file) return out;
  const map = file.editor;
  if (!map || typeof map !== 'object' || Array.isArray(map)) return out;
  for (const key of EDITOR_KEYS) {
    if (typeof map[key] !== 'string') continue;
    if (map[key].length > EDITOR_MAX) continue;
    out[key] = map[key];
  }
  return out;
}

/* The typed merge lets any string through, so this is where a hand-typed 'half
 * past nine' becomes off rather than an error nobody sees. */
function minutesOf(v) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(v === undefined || v === null ? '' : v));
  return m ? (Number(m[1]) * 60) + Number(m[2]) : null;
}

/* A window may wrap midnight, and equal ends are off rather than always-on: a
 * person who set both the same meant nothing, and an always-on window looks
 * broken. */
export function inQuietHours(at, from, to) {
  const a = minutesOf(from);
  const b = minutesOf(to);
  if (a === null || b === null || a === b) return false;
  const d = at instanceof Date ? at : new Date();
  const now = (d.getHours() * 60) + d.getMinutes();
  return a < b ? (now >= a && now < b) : (now >= a || now < b);
}

/* ---- the pause (the tray menu) ------------------------------------ */

/* Server-side only: a stamp a client computed is a clock the server cannot
 * check, and the exe would need a DST-safe next-day roll with no test seam.
 * 'tomorrow' is 07:00 the next day, even from 02:00. */
export function pauseUntil(now, token) {
  const t = String(token === undefined || token === null ? '' : token);
  if (t === '' || t === PAUSE_FOREVER) return t;
  const at = now instanceof Date ? now : new Date();
  if (!Number.isFinite(at.getTime())) return '';
  if (t === 'hour') return atStamp(new Date(at.getTime() + 3600000));
  if (t === 'tomorrow') {
    const d = new Date(at.getTime());
    d.setDate(d.getDate() + 1);
    d.setHours(MORNING_H, MORNING_M, 0, 0);
    return atStamp(d);
  }
  return '';
}

/* Not a second formatter: stampNow is the same call with the same offset rule,
 * reached with a computed Date. */
function atStamp(d) {
  const tz = d.getTimezoneOffset();
  return formatStamp(d.getTime(), tz === 0 ? 0 : -tz);
}

/* The token always, a stamp until the clock passes it, and nothing else; a
 * lapsed stamp stops suppressing and is never rewritten. */
export function paused(now, pausedUntilValue) {
  const v = cleanPause(pausedUntilValue);
  if (v === '') return false;
  if (v === PAUSE_FOREVER) return true;
  const p = parseStamp(v);
  if (!p) return false;
  const at = now instanceof Date ? now : new Date();
  return at.getTime() < p.ms;
}

/* Built once here because the exe has no local clock and must not grow one: the
 * menu and the page print this verbatim. A stamp further out than tomorrow
 * still reads as tomorrow. */
export function pauseLabel(now, pausedUntilValue) {
  const v = cleanPause(pausedUntilValue);
  if (!paused(now, v)) return '';
  if (v === PAUSE_FOREVER) return 'until I resume';
  const p = parseStamp(v);
  const end = new Date(p.ms);
  const at = now instanceof Date ? now : new Date();
  const sameDay = end.getFullYear() === at.getFullYear()
    && end.getMonth() === at.getMonth()
    && end.getDate() === at.getDate();
  const hh = String(end.getHours()).padStart(2, '0');
  const mm = String(end.getMinutes()).padStart(2, '0');
  return 'until ' + hh + ':' + mm + (sameDay ? '' : ' tomorrow');
}

/* An absent file is not a failure: the defaults are its contents until the
 * first server start writes them. Both halves read through here, so a hand edit
 * means the same to a verb's alert and the watcher's. */
function readSettings(file, onMalformed) {
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return { ...DEFAULTS };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    onMalformed();
    return { ...DEFAULTS };
  }
  return mergeSettings(parsed);
}

/* For a reader that is not a notifier: the open keys are needed on every
 * platform. Re-read per call, and silent on a malformed file, since a
 * per-request reader would log one line per click. */
export function loadSettings(root, onMalformed) {
  return readSettings(settingsPath(root), onMalformed || (() => {}));
}

/* A patch over the file's own parsed contents, so a key a person hand-added
 * survives a page write. It validates nothing: notifyApi checks every value
 * first and mergeSettings sanitises on read. */
export function saveSettings(root, patch, onMalformed) {
  const file = settingsPath(root);
  let raw = null;
  try { raw = readFileSync(file, 'utf8'); } catch { raw = null; }
  let parsed = null;
  if (raw !== null) {
    try { parsed = JSON.parse(raw); } catch { parsed = null; }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      parsed = null;
      if (onMalformed) onMalformed();
    }
  }
  const next = { ...(parsed || {}) };
  const cats = mergeCategories(parsed);
  const ed = mergeEditor(parsed);
  delete next.woken;
  delete next.closed;
  delete next.sound;
  /* The three retired open keys, in the idiom the three superseded
   * booleans already use: nothing generic drops a key here, so a key left out of
   * this list survives every write. */
  delete next.openPreset;
  delete next.openScheme;
  delete next.openCommand;
  const p = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {};
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  /* The one thing a new writable key has to join: a key in DEFAULTS but not
   * here lands on disk at its default and never moves, so the file looks right
   * and the value never changes. */
  for (const key of ['enabled', 'tray', 'quietFrom', 'quietTo', 'pausedUntil']) {
    if (own(p, key)) next[key] = p[key];
  }
  if (p.categories && typeof p.categories === 'object' && !Array.isArray(p.categories)) {
    for (const key of CATEGORY_KEYS) {
      const row = p.categories[key];
      if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
      for (const field of ['show', 'sound']) {
        if (own(row, field)) cats[key][field] = row[field];
      }
    }
  }
  next.categories = cats;
  /* the object branch the explicit list above cannot take: a flat push would
     write the patch's half-object over the file's whole one */
  if (p.editor && typeof p.editor === 'object' && !Array.isArray(p.editor)) {
    for (const field of EDITOR_KEYS) {
      if (own(p.editor, field)) ed[field] = p.editor[field];
    }
  }
  next.editor = ed;
  /* whatever the file never named arrives at its default, so what lands on disk
     is whole and a person reading it by hand sees every switch there is; the two
     objects are excluded, or the frozen DEFAULTS one lands here by reference */
  for (const key of Object.keys(DEFAULTS)) {
    if (key !== 'categories' && key !== 'editor' && !own(next, key)) next[key] = DEFAULTS[key];
  }
  writeAtomic(file, JSON.stringify(next, null, 2) + '\n', 0o600);
  return mergeSettings(next);
}

/* Blocking beats woken, because a blocking question off a snooze blocks work as
 * a new one does. An event this cannot place answers '' and is ungated: a row
 * that does not exist cannot have said no. */
export function categoryOf(ev) {
  const e = ev || {};
  if (e.kind === 'closed') return 'closed';
  if (e.kind === 'open') {
    if (e.blocking === true) return 'blocking';
    if (e.woken === true) return 'woken';
    return 'open';
  }
  if (e.kind === 'collapse') return 'collapse';
  const ending = String(e.ending === undefined || e.ending === null ? '' : e.ending);
  if (ending === 'completed') return 'task-completed';
  if (ending === 'dropped') return 'task-dropped';
  if (ending === 'closed') return 'plan-closed';
  return '';
}

/* The row a settings object holds for a category, never a reference into
   DEFAULTS that a caller could mutate, and never undefined: an unplaceable
   event reads the default row and is therefore shown. */
export function rowFor(settings, category) {
  const map = (settings && settings.categories) || null;
  const row = map && map[category];
  if (row && typeof row === 'object') return row;
  return defaultRow(category);
}

/* The question's card: the name leads, the id rides the
 * `where` line, and the names and the pick ride only when known. */
export function questionAlert(ev, sound) {
  const e = ev || {};
  const blocks = e.kind === 'open' && e.blocking === true;
  const alert = {
    kind: e.kind === 'closed' ? (e.status === 'dropped' ? 'dropped' : 'answer')
      : (blocks ? 'blocker' : 'question'),
    title: flat(e.name) || flat(e.id),
    where: attributionOf(e),
    blocking: blocks,
    card: flat(e.id),
    files: true,
    sound,
  };
  const names = questionWhereNames(e);
  if (Object.keys(names).length) alert.whereNames = names;
  /* an answer shows no pick */
  if (e.kind === 'open' && flat(e.pick)) alert.pick = flat(e.pick);
  return alert;
}

/* The card's `where` line, shared with the Test button so the line a burst puts
 * up cannot drift from the line a button does. The collapse attributes nothing. */
export function attributionOf(ev) {
  const e = ev || {};
  const id = flat(e.id);
  if (!id) return '';
  const parts = [id];
  if (e.kind === 'closed') parts.push('closed as ' + flat(e.status));
  else if (e.kind === 'open') parts.push(e.blocking === true ? 'blocks work' : 'a preference');
  else if (WORK_ENDINGS.includes(flat(e.ending))) parts.push(flat(e.ending));
  const ws = flat(e.workstream);
  if (ws) {
    const name = flat(e.workstreamName);
    parts.push(name ? ws + ' ' + name : ws);
  }
  return parts.join(', ');
}

/* Pure, and the digest did not grow instead: a gist in board-state's questions
 * array would move rev for an edit that changes no board and ship prose to
 * every page. */
/* `names` maps any work token (WS, T, TR) to its name and `projectNames`
 * a normalized project dir to its name, so the card's context line is names. */
export function enrichEvents(events, entries, names, projectNames) {
  const by = Object.create(null);
  for (const entry of entries || []) {
    const id = String((entry && entry.id) || '');
    if (id) by[id] = entry;
  }
  const lookup = (m, key) => {
    if (!m || typeof m !== 'object') return '';
    const v = typeof m.get === 'function' ? m.get(key) : m[key];
    return typeof v === 'string' ? flat(v) : '';
  };
  const nameOf = (token) => lookup(names, token);
  return (events || []).map((ev) => {
    const out = { ...(ev || {}) };
    /* "T-75 completed" as the ended record's name and ending; left out when unnamed */
    const woke = flat(out.wokeBy).split(' ');
    const wokeName = woke[0] ? nameOf(woke[0]) : '';
    if (wokeName) out.wokenName = wokeName + (woke.length > 1 ? ', ' + woke.slice(1).join(' ') : '');
    const entry = by[String(out.id === undefined || out.id === null ? '' : out.id)];
    if (!entry) return out;
    if (typeof entry.gist === 'string' && entry.gist) out.gist = entry.gist;
    if (typeof entry.workstream === 'string' && entry.workstream) {
      out.workstream = entry.workstream;
      const name = nameOf(entry.workstream);
      if (name) out.workstreamName = name;
    }
    const project = flat(entry.project) || lookup(projectNames, dirKey(entry.projectDir))
      || dirBase(entry.projectDir);
    if (project) out.projectName = project;
    if (typeof entry.track === 'string' && entry.track) {
      const name = nameOf(entry.track);
      if (name) out.trackName = name;
    }
    const holds = holdsName(entry.gates, nameOf);
    if (holds) out.holdsName = holds;
    const pick = pickName(entry);
    if (pick) out.pick = pick;
    return out;
  });
}

/* lib/record-refs.mjs's normDir, restated so this module imports nothing for it. */
export function dirKey(d) {
  return String(d || '').replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
}

/* The last segment in its own casing, the name a project with no stored name wears. */
function dirBase(d) {
  const parts = String(d || '').replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.length ? flat(parts[parts.length - 1]) : '';
}

/* The first gated task with a name, and how many more it holds up. */
function holdsName(gates, nameOf) {
  const list = Array.isArray(gates) ? gates.map((g) => String(g)) : [];
  const named = list.map(nameOf).filter(Boolean);
  if (!named.length) return '';
  const more = list.length - 1;
  return more ? named[0] + ' and ' + more + ' more' : named[0];
}

/* The pick as the option's name; a bare option code is never shown. */
function pickName(entry) {
  const pick = flat(entry.pick);
  if (!pick) return '';
  const opts = Array.isArray(entry.options) ? entry.options : [];
  const hit = opts.find((o) => o && flat(o.type).toLowerCase() === pick.toLowerCase());
  const name = hit ? flat(hit.option) : '';
  if (name) return name;
  return /^\d*[a-z]$/i.test(pick) ? '' : pick;
}

/* The question card's context in names: a blocker with no gated task holds up
 * its workstream, which is then not said twice. */
export function questionWhereNames(ev) {
  const e = ev || {};
  const blocks = e.kind === 'open' && e.blocking === true;
  const ws = flat(e.workstreamName);
  const holds = blocks ? (flat(e.holdsName) || ws) : '';
  const out = {};
  /* what woke it leads the line */
  const woken = flat(e.wokenName) || (e.wokeOnDate === true ? 'its snooze date' : '');
  if (e.kind === 'open' && woken) out.woken = woken;
  const project = flat(e.projectName);
  if (project) out.project = project;
  if (ws && holds !== ws) out.workstream = ws;
  const track = flat(e.trackName);
  if (track) out.track = track;
  if (holds) out.holds = holds;
  return out;
}

/* The summary card that closes a burst over the cap, shared with the Test
 * button so the two summaries cannot drift; it names no record. */
export function collapseAlert(more, sound) {
  return { kind: 'info', title: more + ' more changes on the board', blocking: false, sound };
}

/* The gate order both halves honour: enabled, the pause, the quiet
 * hours, the category's show, the cap of five and the collapse row. The test
 * button applies none. */
export function createNotifier(deps = {}) {
  const root = deps.root;
  const port = deps.port;
  const secret = deps.secret;
  const instance = deps.instance;
  const platform = deps.platform || process.platform;
  /* shared with the tray so both halves of the channel read one clock */
  const now = deps.now || (() => new Date());
  const log = deps.log || ((line) => appendLog(root, line));
  const file = settingsPath(root);
  /* The only way out of this module: a caller with no stream to
   * offer has no channel, and every alert is logged and dropped. */
  const pushAlert = typeof deps.pushAlert === 'function' ? deps.pushAlert : null;

  /* A store that stays broken must not write a log line every 5 seconds, so
     repeated failures are recorded once per distinct message text. */
  const said = new Set();
  const logOnce = (line) => {
    if (said.has(line)) return;
    said.add(line);
    log(line);
  };

  /* The platform and nothing else: whether the exe is on disk is
   * lib/tray.mjs's question. False means the channel is inert, with one log
   * line and no settings file. */
  const available = platform === 'win32';
  if (!available) logOnce('notify: unavailable on this platform');

  function ensureSettings() {
    if (!available) return false;
    if (fileExists(file)) return false;
    try {
      writeAtomic(file, JSON.stringify(DEFAULTS, null, 2) + '\n', 0o600);
      return true;
    } catch (e) {
      logOnce('notify: could not write the settings file: ' + ((e && e.message) || e));
      return false;
    }
  }

  function loadSettings() {
    return readSettings(file, () => logOnce('notify: settings file is malformed; using defaults'));
  }

  /* The relay starts the exe and waits for the attach, so 'none' means it could
   * not. A word rather than a boolean because the Test route returns it, and a relay
   * that throws is a 'none' with a line. `alert` is the popup's request. */
  async function show(alert) {
    if (!pushAlert) {
      log('notify: no tray channel: the alert was dropped');
      return 'none';
    }
    let answer = false;
    try {
      answer = await pushAlert(alert);
    } catch (e) {
      logOnce('notify: the tray relay failed: ' + ((e && e.message) || e));
      answer = false;
    }
    if (answer === true) return 'tray';
    /* Conditional because the refusal says whether the server already wrote the
     * line: a decision worth naming once is not named twice. */
    if (!(answer && answer.logged === true)) log('notify: no tray took the alert: it was dropped');
    return 'none';
  }

  /* The id is re-validated before it reaches the card. One at a time and
   * awaited, so five alerts with no tray attached become one demand to start
   * the exe and not five. */
  async function raise(events, settings) {
    if (!available) return 0;
    const s = settings || DEFAULTS;
    /* Gate 2: first here because gate 1, 'enabled', is the tick's own.
     * Read against this notifier's injected clock. */
    if (paused(now(), s.pausedUntil)) return 0;
    /* GATE 3, before a single card is built: the quiet-hours window,
       read against the same clock. */
    if (inQuietHours(now(), s.quietFrom, s.quietTo)) return 0;
    const list = [];
    for (const ev of events || []) {
      if (!ev || !/^Q\d+$/.test(String(ev.id))) {
        logOnce('notify: dropped an event whose id was not well formed');
        continue;
      }
      /* GATE 4: the category's own `show`, before the cap,
         so a hidden category never eats one of the five */
      if (rowFor(s, categoryOf(ev)).show === false) continue;
      list.push(ev);
    }
    if (!list.length) return 0;
    const collapsed = list.length > CAP ? list.length - (CAP - 1) : 0;
    const shown = collapsed ? list.slice(0, CAP - 1) : list;
    for (const ev of shown) {
      await show(questionAlert(ev, rowFor(s, categoryOf(ev)).sound));
      log('notify: ' + ev.kind + ' ' + ev.id);
    }
    /* GATE 5: the collapse row's own `show`. False means the summary is not
       raised while the five that survived the filter still are, and the number
       in its words is the same arithmetic it always was. */
    const summary = collapsed && rowFor(s, 'collapse').show !== false;
    if (summary) {
      await show(collapseAlert(collapsed, rowFor(s, 'collapse').sound));
      log('notify: collapsed ' + collapsed + ' more');
    }
    return shown.length + (summary ? 1 : 0);
  }

  return {
    available, instance, now, file,
    /* `show` is on the surface for the Test route: the watcher never calls
     * it directly, it calls raise. */
    ensureSettings, loadSettings, raise, show, log, logOnce,
  };
}

/* ---- the work half: terminal endings ----------------------------------- */

/* The polarity is inverted: a session-authored ending alerts
 * and a user-authored mutation stays silent, since the board never alerts back
 * what you just clicked. */

/* The three endings, and the whole vocabulary a work alert has: a task
   arriving at one of its two terminal statuses, or a workstream or plan
   closing. */
export const WORK_ENDINGS = Object.freeze(['completed', 'dropped', 'closed']);

/* A store write is never slowed for a notification, so the loopback request is
 * bounded here rather than by the OS connect timeout, which is measured in
 * seconds. */
export const RELAY_MS = 300;

/* The cap above is armed on the connect (measured: 495 ms of blocked loop after
 * the POST ate a timer armed at creation), so this ceiling from creation bounds
 * a connect that never lands. */
export const RELAY_CEIL_MS = 1000;

/* Four answers, and only 'refused' leads anywhere. The socket holds the verb's
 * process until the answer or the cap, and the cap arms on the connect: a
 * synchronous git write blocks the loop after the POST. */

/* The refusal body is a sentence, not a payload: read no more than this and
   keep no more than one line of it. */
const REASON_MAX = 400;

/* A body that is not the shape this expects is not an error to report: it is an
 * answer with no reason in it, and the caller's own wording stands. */
function reasonOf(body) {
  let parsed = null;
  try { parsed = JSON.parse(body); } catch { return ''; }
  if (!parsed || typeof parsed !== 'object' || typeof parsed.error !== 'string') return '';
  return flat(parsed.error).slice(0, 120);
}

function relayAlert(port, secret, alert, capMs, ceilMs) {
  return new Promise((resolve) => {
    let done = false;
    const timers = [];
    /* every timer is unrefed: they hold nothing themselves and still fire while
       the socket holds the process */
    const arm = (ms, fn) => {
      const t = setTimeout(fn, ms);
      if (t && t.unref) t.unref();
      timers.push(t);
      return t;
    };
    /* The reason is what makes the one dropped line say why, rather than
     * repeat the shape of the answer. */
    const settle = (word, reason) => {
      if (done) return;
      done = true;
      while (timers.length) {
        try { clearTimeout(timers.pop()); } catch {}
      }
      resolve({ answer: word, reason: reason || '' });
    };
    let req;
    const body = Buffer.from(JSON.stringify({ alert }), 'utf8');
    try {
      req = httpRequest({
        host: '127.0.0.1',
        port,
        path: '/' + secret + '/api/relay',
        method: 'POST',
        agent: false,
        headers: { 'Content-Type': 'application/json', 'Content-Length': body.length },
      }, (res) => {
        if (res.statusCode === 204) {
          res.resume();
          return settle('ok');
        }
        /* One dropped alert is one log line, and the 503's reason is what makes
         * that line useful. Drained either way: a socket with unread bytes does
         * not close. */
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (d) => { if (body.length < REASON_MAX) body += d; });
        res.on('error', () => settle('no'));
        res.on('end', () => settle('no', reasonOf(body)));
        return undefined;
      });
    } catch {
      return settle('failed');
    }
    /* ECONNREFUSED IS THE ONE ERROR WITH A NEXT STEP: nothing is listening on
       the board's permanent port, which is a board server that is not running
       rather than a board server that said no. Every other error is 'failed'. */
    req.on('error', (e) => settle(e && e.code === 'ECONNREFUSED' ? 'refused' : 'failed'));
    const giveUp = () => {
      try { req.destroy(); } catch {}
      settle('failed');
    };
    /* the answer's own budget, started where the answer becomes possible */
    const capFromConnect = () => arm(capMs, giveUp);
    req.on('socket', (socket) => {
      if (!socket) return capFromConnect();
      if (socket.connecting === false) return capFromConnect();
      return socket.once('connect', capFromConnect);
    });
    /* the belt, from here: a connect that never lands (a blocked loop, a host
       that swallows the SYN) is answered inside this whatever happens */
    arm(Math.max(capMs, Number.isFinite(ceilMs) && ceilMs > 0 ? ceilMs : RELAY_CEIL_MS), giveUp);
    try {
      req.end(body);
    } catch {
      settle('failed');
    }
    return undefined;
  });
}

/* Terse and FLAT, the event detail's own rule: every line break a name or an
   outcome carries collapses to a space, so one terse line cannot become a
   paragraph on a card that has room for neither. */
const flat = (s) => String(s === undefined || s === null ? '' : s).replace(/\s+/g, ' ').trim();

/* the popup card leads with the name, the id rides the card link. */
export function workAlertTitle(ev) {
  const e = ev || {};
  const name = flat(e.name);
  if (!name) return '';
  const ending = flat(e.ending);
  const outcome = flat(e.outcome);
  return name + ' ' + ending + (ending === 'closed' && outcome ? ': ' + outcome : '');
}

/* The work ending's card: the name and the ending, the id where no name is known. */
export function workAlert(ev, sound) {
  const e = ev || {};
  const alert = {
    kind: e.ending === 'completed' ? 'done' : flat(e.ending),
    title: workAlertTitle(e) || flat(e.id) + ' ' + flat(e.ending),
    where: attributionOf(e),
    blocking: false,
    card: flat(e.id),
    files: true,
    sound,
  };
  const names = workWhereNames(e);
  if (Object.keys(names).length) alert.whereNames = names;
  return alert;
}

/* The names the verb already holds; it never reads the store again for them. */
export function workWhereNames(ev) {
  const e = ev || {};
  const out = {};
  const project = flat(e.projectName);
  if (project) out.project = project;
  const ws = flat(e.workstreamName);
  if (ws) out.workstream = ws;
  return out;
}

/* 700 so the verb's worst case on the refused path, this wait plus the second
 * relay's 300 ms cap, stays inside one second. Past it the alert is dropped
 * rather than queued. */
export const ENSURE_WAIT_MS = 700;

/* And the poll's own step. Seven tries inside the wait above: fine enough that
   a server that came up in 200 ms is not made to wait out a coarse tick, coarse
   enough that the wait is a handful of loopback pings and not a hundred. */
export const ENSURE_STEP_MS = 100;

/* Fail-open at every step, and silent where the server's half logs once, since
 * a verb cannot de-duplicate across runs. The relay is the whole path
 * and only 'refused' ensures and relays again. */
export function createWorkNotifier(deps = {}) {
  const root = deps.root;
  const platform = deps.platform || process.platform;
  const log = deps.log || ((line) => appendLog(root, line));
  /* this half's own clock, for the quiet-hours gate and for nothing else,
     injectable for the same reason every other seam here is */
  const now = deps.now || (() => new Date());
  /* the relay's budget, injectable so a case can exercise the timeout branch
     without sitting through the real one; the ceiling beside it is injectable
     for the same reason and is never below the budget */
  const relayMs = Number.isFinite(deps.relayMs) && deps.relayMs > 0 ? deps.relayMs : RELAY_MS;
  const relayCeilMs = Number.isFinite(deps.relayCeilMs) && deps.relayCeilMs > 0
    ? deps.relayCeilMs : RELAY_CEIL_MS;
  /* the ensure's own two clocks, injectable for the same reason: a case pins
     the branch without waiting a real second for it */
  const ensureWaitMs = Number.isFinite(deps.ensureWaitMs) && deps.ensureWaitMs > 0
    ? deps.ensureWaitMs : ENSURE_WAIT_MS;
  const ensureStepMs = Number.isFinite(deps.ensureStepMs) && deps.ensureStepMs > 0
    ? deps.ensureStepMs : ENSURE_STEP_MS;
  /* Injectable and the SessionStart hook's own by default, so a test spawns no
   * server and production shares one implementation rather than a second copy
   * that can drift. */
  const ensure = typeof deps.ensure === 'function'
    ? deps.ensure
    : (dir) => ensureBoardServer(dir, { waitMs: ensureWaitMs });
  const ping = typeof deps.ping === 'function' ? deps.ping : pingBoard;
  /* The verb never passes one: it does not wait and must not. A test does,
   * because the branch it checks is on the far side of a loopback round
   * trip. */
  const settled = typeof deps.settled === 'function' ? deps.settled : null;
  const available = platform === 'win32';
  const relay = (alert) => relayAlert(deps.port, deps.secret, alert, relayMs, relayCeilMs);

  /* The ensure's own promise is never awaited: it polls on its own schedule and
   * this half has a tighter budget. A rejection is swallowed, because an alert
   * is decoration. */
  async function ensureBoard() {
    try {
      const p = ensure(root);
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch { /* an ensure that throws costs the alert and nothing else */ }
    const deadline = Date.now() + ensureWaitMs;
    for (;;) {
      let up = false;
      try {
        up = (await ping(deps.port, deps.secret)) === true;
      } catch { up = false; }
      if (up) return true;
      if (Date.now() >= deadline) return false;
      await new Promise((r) => {
        const t = setTimeout(r, ensureStepMs);
        if (t && t.unref) t.unref();
      });
    }
  }

  /* Both validated before either reaches the alert, and the two halves keep
   * separate gates, so a work id can never ride the question path. The gate is
   * what lets the id into the card. */
  function raise(ev) {
    if (!available) return 0;
    const e = ev || {};
    if (!/^(?:WS|P|T)-\d+$/.test(String(e.id)) || !WORK_ENDINGS.includes(String(e.ending))) {
      log('notify: dropped a work event that was not well formed');
      return 0;
    }
    /* the channel master gate, re-read per verb so a hand edit takes effect at
       the next mutation with nothing to restart */
    const s = readSettings(settingsPath(root), () => log('notify: settings file is malformed; using defaults'));
    if (!s.enabled) return 0;
    /* the same gate order the question half keeps, in the same words: the
       PAUSE, then the quiet-hours window, then this ending's own row */
    if (paused(now(), s.pausedUntil)) return 0;
    if (inQuietHours(now(), s.quietFrom, s.quietTo)) return 0;
    const row = rowFor(s, categoryOf(e));
    if (row.show === false) return 0;
    const alert = workAlert(e, row.sound);
    const went = () => {
      /* The ending and the id only, never the URL, and only for an alert that
       * went: this line rides the tail rather than the return. */
      log('notify: work ' + e.ending + ' ' + e.id);
      return true;
    };
    const dropped = (why) => {
      log('notify: the work alert for ' + e.id + ' was dropped: ' + why);
      return false;
    };
    /* the one line a dropped alert gets, in the server's own words where it
       gave any: 'no tray took it' is this half's wording for a refusal that
       carried none */
    const why = (r) => (r.answer === 'no' ? (r.reason || 'no tray took it') : 'the board did not answer');
    const tail = relay(alert).then(async (first) => {
      if (first.answer === 'ok') return went();
      if (first.answer !== 'refused') return dropped(why(first));
      /* nothing was listening: start the board the way a session start does,
         wait for its ping, and offer the alert once more */
      if (!(await ensureBoard())) return dropped('no board server answered');
      const again = await relay(alert);
      return again.answer === 'ok' ? went() : dropped(why(again));
    });
    if (settled) settled(tail);
    /* ONE alert is on its way, which is what this half can answer without
       waiting: the round trip and the ensure behind it are the tail's. */
    return 1;
  }

  return { available, raise };
}

/* ---- the alert entry point ------------------------------------- */

/* The mod's one native channel on the desktop: a loopback POST to
 * api/alert, drawn by the tray popup. A closed vocabulary, since each kind is a
 * glyph the exe draws. */
export const ALERT_KINDS = Object.freeze([
  'question', 'blocker', 'answer', 'track', 'handoff',
  'done', 'dropped', 'closed', 'depth', 'info',
]);

/* the popup's file list, the tray menu's own five */
export const ALERT_FILES_MAX = 5;

/* The notify.json row each kind answers to, for its show switch and its sound;
 * a kind with no row reads the default row. */
const ALERT_ROWS = Object.freeze({
  blocker: 'blocking', question: 'open', answer: 'closed',
  done: 'task-completed', dropped: 'task-dropped', closed: 'plan-closed',
});

export function alertCategory(kind) {
  return ALERT_ROWS[kind] || '';
}

/* tracks, handoffs and knowledge records have card pages and files too; TH is a track's old label */
const RECORD_ID = /^(?:Q\d+|(?:WS|P|T|TR|TH|K)-\d+|T[RH]-\d+\.\d+)$/;

/* the context line in names. Each part is a name, never a code; the
 * popup draws them joined and falls back to `where` when none is given. */
export const ALERT_NAME_PARTS = Object.freeze(['woken', 'project', 'workstream', 'track', 'holds']);
const NAME_MAX = 60;
const PLACE_MAX = 120;
const PICK_MAX = 80;
const DOT = ' \u00B7 ';

/* The names joined in reading order, '' when none is set. */
export function alertPlace(names) {
  const n = names || {};
  const parts = [];
  if (n.woken) parts.push('woken by ' + n.woken);
  if (n.project) parts.push(n.project);
  if (n.workstream) parts.push(n.workstream);
  if (n.track) parts.push('track ' + n.track);
  if (n.holds) parts.push('holds up ' + n.holds);
  return Array.from(parts.join(DOT)).slice(0, PLACE_MAX).join('');
}

function cutFlat(s, max) {
  return Array.from(flat(s)).slice(0, max).join('');
}

/* The request's shape and nothing else; the card and the files are resolved by
 * the server, which holds the board. */
export function validateAlert(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'the body must be an object' };
  if (!ALERT_KINDS.includes(body.kind)) return { error: 'kind must be one of ' + ALERT_KINDS.join(', ') };
  const title = Array.from(flat(body.title)).slice(0, TITLE_MAX).join('');
  if (typeof body.title !== 'string' || !title) return { error: 'title is required' };
  if (body.where !== undefined && typeof body.where !== 'string') return { error: 'where must be a string' };
  if (body.blocking !== undefined && typeof body.blocking !== 'boolean') return { error: 'blocking must be true or false' };
  if (body.card !== undefined && typeof body.card !== 'string') return { error: 'card must be a record id or a board URL' };
  let files = [];
  if (body.files === true) files = true;
  else if (Array.isArray(body.files)) {
    if (!body.files.every((n) => Number.isInteger(n) && n >= 0 && n <= 9999)) {
      return { error: 'files must be true or a list of ref positions' };
    }
    files = [...new Set(body.files)].slice(0, ALERT_FILES_MAX);
  } else if (body.files !== undefined && body.files !== false) {
    return { error: 'files must be true or a list of ref positions' };
  }
  if (body.sound !== undefined && body.sound !== 'silent' && !SOUNDS.includes(body.sound)) {
    return { error: 'sound must be silent or a Windows notification sound name' };
  }
  if (body.pick !== undefined && typeof body.pick !== 'string') return { error: 'pick must be a string' };
  const names = {};
  const raw = body.whereNames;
  if (raw !== undefined) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { error: 'whereNames must be an object of ' + ALERT_NAME_PARTS.join(', ') };
    }
    for (const key of ALERT_NAME_PARTS) {
      if (raw[key] === undefined) continue;
      if (typeof raw[key] !== 'string') return { error: 'whereNames.' + key + ' must be a string' };
      const v = cutFlat(raw[key], NAME_MAX);
      if (v) names[key] = v;
    }
  }
  return {
    value: {
      kind: body.kind,
      title,
      where: cutFlat(body.where, ATTR_MAX),
      blocking: body.blocking === undefined ? body.kind === 'blocker' : body.blocking,
      card: flat(body.card),
      files,
      sound: body.sound === undefined ? '' : body.sound,
      whereNames: names,
      pick: cutFlat(body.pick, PICK_MAX),
    },
  };
}

/* A record id, a path under the board root, or a URL on this board; anything
 * else is null, so the exe is never handed a link off the board. `id` is the
 * record the files resolve against, '' when the URL names none. */
export function alertCard(card, base) {
  const s = flat(card);
  if (!s) return { url: '', id: '' };
  /* every record's page is r/, where a label moves to its live holder */
  if (RECORD_ID.test(s)) return { url: base + 'r/' + s, id: s };
  let rest = null;
  if (/^https?:\/\//i.test(s)) {
    let u;
    let b;
    try { u = new URL(s); b = new URL(base); } catch { return null; }
    const local = ['127.0.0.1', 'localhost', 'askerdo.localhost'].includes(u.hostname);
    if (u.protocol !== 'http:' || !local || u.port !== b.port || !u.pathname.startsWith(b.pathname)) return null;
    rest = u.pathname.slice(b.pathname.length) + u.search;
  } else if (/^[\w.~%=&?-][\w.~%=&?/-]*$/.test(s) && !s.includes('..')) {
    rest = s;
  }
  if (rest === null || /[\s"<>]/.test(rest)) return null;
  const m = /^[qwr]\/([^/?#]+)$/.exec(rest);
  let id = '';
  if (m) {
    try { id = decodeURIComponent(m[1]); } catch { id = ''; }
    if (!RECORD_ID.test(id)) id = '';
  }
  return { url: base + rest, id };
}

/* '' when the alert may be raised, else the reason it is held: the same gate
 * order both notifier halves keep. */
export function alertGate(settings, now, kind) {
  const s = settings || DEFAULTS;
  if (!s.enabled) return 'notifications are off';
  if (paused(now, s.pausedUntil)) return 'paused';
  if (inQuietHours(now, s.quietFrom, s.quietTo)) return 'quiet hours';
  const cat = alertCategory(kind);
  if (cat && rowFor(s, cat).show === false) return 'this kind is switched off';
  return '';
}

/* What rides the stream to the exe: the request resolved. */
export function alertFrame(value, { settings, card, files }) {
  const row = rowFor(settings || DEFAULTS, alertCategory(value.kind));
  const sound = value.sound || row.sound;
  const link = (card && card.url) || '';
  const place = alertPlace(value.whereNames);
  const pick = value.pick || '';
  /* `where` stays for an exe built before the names; `place` and `pick` ride
     only when set, so a frame without them is the frame it always was */
  const frame = {
    kind: value.kind,
    title: value.title,
    where: value.where,
    blocking: value.blocking,
    card: link,
    files: (files || []).slice(0, ALERT_FILES_MAX),
    sound,
  };
  if (place) frame.place = place;
  if (pick) frame.pick = pick;
  /* the question a card is about, so a retract can name it */
  if (card && /^Q\d+$/.test(card.id)) frame.question = card.id;
  return frame;
}
