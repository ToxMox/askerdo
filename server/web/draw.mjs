/* The board's words and list marks: a track's state and counts in one wording for
   every view, and the small marks the pages list with. Pure and plain script, so the browser
   reads it too; the picture itself is picture-draw.mjs. */
// the web's colours the list marks draw in
var WEB_C = { bg: '#141428', sky: '#26C3FF', ready: '#4CC9FF', wait: '#7E89A6', line: '#59637E', cross: '#9BB0D3', crit: '#F4F6FB', amber: '#FFD966' };
/* the AskerDo pane's colours, which picture-draw.mjs resolves per theme, and the system stack an Svg draws in */
export var PANE_DARK = { bg: '#1a1a19', band: 'rgba(255,255,255,0.035)', bandLine: 'rgba(255,255,255,0.08)', bandLive: 'rgba(38,195,255,0.40)',
  text: '#f0efec', sec: '#c3c2b7', dim: '#898781', id: '#c3c2b7', line: '#5f5e5a', live: '#26c3ff', sky: '#26c3ff', ready: '#26c3ff',
  wait: '#898781', cross: '#a3a29b', crit: '#f6f5f2', amber: '#db9300', lav: '#b9aef0', tagBg: 'rgba(38,195,255,0.14)', tagLine: 'rgba(38,195,255,0.5)' };
export var PANE_LIGHT = { bg: '#ffffff', band: 'rgba(11,11,11,0.03)', bandLine: 'rgba(11,11,11,0.10)', bandLive: 'rgba(2,132,199,0.45)',
  text: '#0b0b0b', sec: '#52514e', dim: '#898781', id: '#52514e', line: '#b5b3ad', live: '#0284c7', sky: '#0284c7', ready: '#0284c7',
  wait: '#898781', cross: '#7d7b75', crit: '#1f1e1d', amber: '#a66a00', lav: '#6d5bd0', tagBg: 'rgba(2,132,199,0.10)', tagLine: 'rgba(2,132,199,0.5)' };
export var PANE_FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "PingFang SC", "PingFang TC", "Hiragino Sans", "Apple SD Gothic Neo", sans-serif';
export function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
/* a tunnel mouth seen front on in 16 units at stroke 1.4: an arch outline over a dark opening and a light
   arrow on one shaft through the opening past the base, its head under the arch at the dive (dn), inside it at the exit (up) */
export var PORTAL_ICON = '<path class="hole" d="M2 12.6V8.2A6 6 0 0 1 14 8.2V12.6Z"/><path d="M2 12.6V8.2A6 6 0 0 1 14 8.2V12.6"/><path class="dn" d="M7.25 4.6H8.75V12.9H11.1L8 16L4.9 12.9H7.25Z"/><path class="up" d="M8 3.9L11.1 7H8.75V15.2H7.25V7H4.9Z"/>';
export function shortDate(iso) { var d = new Date(iso); return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()] + ' ' + d.getDate(); }
// a parked line's reason and what opens it again, one wording for every view
export function parkedWords(tr) {
  return 'parked' + (tr.parked ? ': ' + tr.parked : '') + (tr.unpark ? '; opens again ' + tr.unpark : '');
}
// an inbox task's wake, one wording for the board and the pane: its day, or the record it
// waits on by label and name; once due, what came; a record gone reads as gone
var WAKE_ON = { 'track-ends': ['track', 'ends', 'ended'], 'task-completes': ['task', 'is done', 'is done'], 'question-answered': ['question', 'is answered', 'is answered'] };
export function wakeText(w, due) {
  if (!w) return due ? 'due' : '';
  if (w.date) {
    var p = String(w.date).split('-');
    return (due ? 'due since ' : 'wakes ') + ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][Number(p[1]) - 1] + ' ' + Number(p[2]);
  }
  var on = WAKE_ON[w.kind] || ['record', 'ends', 'ended'];
  if (w.gone) return 'due: the ' + on[0] + ' it waited for is gone';
  if (!due) return 'wakes when ' + w.named + ' ' + on[1];
  return 'due: ' + w.named + ' ' + (w.status === 'dropped' ? 'was dropped' : on[2]);
}
/* a snoozed question's wake, one wording for the pane, the tooltip, the tray and the board: each
   condition "until ...", joined with " or "; pieces mark the waking record's label so a row can link it.
   A day reached reads "due now": the board wakes it at its next read. today is YYYY-MM-DD */
export function asleepWake(snooze, today) {
  var s = snooze || {}, pieces = [], record = '';
  var or = function () { if (pieces.length) pieces.push({ text: ' or ' }); };
  if (s.until) {
    var p = String(s.until).split('-');
    var day = p.length === 3 ? ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][Number(p[1]) - 1] + ' ' + Number(p[2]) : String(s.until);
    pieces.push({ text: 'until ' + day + (today && String(s.until) <= String(today) ? ', due now' : '') });
  }
  if (s.wakeOn) {
    record = String(s.wakeOn);
    or();
    pieces.push({ text: 'until ' }, { text: record, record: true }, { text: s.wakeStatus ? ' is ' + s.wakeStatus : ' ends' });
  }
  if (s.trigger) { or(); pieces.push({ text: 'until ' + String(s.trigger).replace(/\s+/g, ' ').trim() }); }
  return { text: pieces.map(function (x) { return x.text; }).join(''), record: record, pieces: pieces };
}
export function lineWords(tr, D) {
  var t = D.tracks[tr.id], bits = [];
  if (t.state === 'active') bits.push(['live', 'active, ' + (tr.lease ? tr.lease.who : 'held')]);
  else if (t.state === 'parked') bits.push(['lav', parkedWords(tr)]);
  else if (t.state === 'new') bits.push(['text', 'new, nobody on it yet']);
  else if (t.state === 'waiting') bits.push(['sec', t.noHandoff ? 'waiting, no handoff yet' : tr.since || tr.last ? 'waiting since ' + shortDate(tr.since || tr.last) : 'waiting']);
  // the pane reads no stall days
  if (t.stalled) bits.push(['amber', t.days === null || t.days === undefined ? 'stalled' : 'stalled ' + t.days + ' days']);
  return bits;
}
// how a ready task's last run ended, after who ran it: "s1 handed on", "s1, closed by the app" (the app tells no cause)
export function leftWords(who, how) { return how === 'closed_idle' ? who + ', closed by the app' : who + ' ' + String(how || 'handed_on').replace(/_/g, ' '); }
// a task's own open checklist steps, what holds a built task open
// (a view's row carries progress, the drawn graph's checklist)
function ownList(n) { return !n ? null : n.checklist !== undefined ? n.checklist : n.progress; }
export function openSteps(n) { var p = ownList(n), o = p ? Number(p.total) - Number(p.done) : 0; return o > 0 ? o : 0; }
export function stepsWords(o) { return o + (o === 1 ? ' step open' : ' steps open'); }
// ready to settle, by the word
export function settles(n) { return !!(n && n.word) && n.word.is === 'ready' && n.word.next === 'settle'; }
// a ready task with open steps says how many, of how many once some are done
export function readyWords(n) {
  var o = openSteps(n), p = ownList(n), d = o ? Number(p.done) : 0;
  return o ? 'ready, ' + (d > 0 ? o + ' of ' + p.total + ' steps open' : stepsWords(o)) : 'ready';
}
var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function two(n) { return (n < 10 ? '0' : '') + n; }
function msOf(t) { return typeof t === 'number' ? t : Date.parse(t); }
// how long since a stamp by the clock `at` (ISO or ms): "12 min", "3 h", "2 days"
export function longWords(at, since) {
  var ms = msOf(at) - Date.parse(since); if (!(ms >= 0)) return '';
  var m = Math.round(ms / 60000), h = Math.round(ms / 3600000), d = Math.round(ms / 86400000);
  return m < 60 ? Math.max(1, m) + ' min' : h < 24 ? h + ' h' : d + (d === 1 ? ' day' : ' days');
}
// when a stamp was, by the clock's day: the clock time that day, else the day
export function whenWords(at, stamp) {
  var d = new Date(stamp), n = new Date(msOf(at)); if (!Number.isFinite(d.getTime())) return '';
  return d.toDateString() === n.toDateString() ? two(d.getHours()) + ':' + two(d.getMinutes()) : MON[d.getMonth()] + ' ' + d.getDate();
}
// who a word's run names: its agent's job, else the session, "this session" for the one reading
export function runnerOf(t, self) {
  var w = t.word || {};
  if (w.worker === 'agent') return w.job || t.agent || 'an agent';
  if (!w.worker && t.agent) return t.agent;
  var s = w.session || t.session;
  return self && s ? (s === self ? 'this session' : 'another session') : 'the session';
}
/* a task's word with who, where and since or for how long, one wording for the PC's rows
   and the picture; `is` the word (the picture passes its station's), `at` the clock, `self` the reading session */
export function wordWords(t, at, self, is) {
  var w = t.word || {}, k = is || w.is, has = at !== undefined && at !== null;
  var d = w.since && has ? longWords(at, w.since) : '', fr = d ? ' for ' + d : '';
  if (k === 'running') return 'running: ' + runnerOf(t, self) + fr + (!t.agent && w.worker !== 'agent' && openSteps(t) ? ', ' + stepsWords(openSteps(t)) : '');
  if (k === 'unconfirmed') { var h = w.since && has ? whenWords(at, w.since) : ''; return 'unconfirmed: ' + runnerOf(t, self) + (w.pc ? ' on ' + w.pc : '') + (h ? ', not heard since ' + h : ''); }
  if (k !== 'ready') return k || '';
  var steps = readyWords(t).replace(/^ready(, )?/, '');
  if (w.next === 'settle') return 'ready to settle' + fr + ': ' + runnerOf(t, self) + ' finished' + (steps ? ', ' + steps : '');
  if (w.next === 'continue') return 'ready to continue' + fr + ': ' + leftWords(runnerOf(t, self), w.how) + (steps ? ', ' + steps : '');
  return (w.next ? 'ready to start' : 'ready') + fr + (steps ? ', ' + steps : '');
}
/* the user's hold, a decision labelled hold naming the track, made since its holder took it
   (`since`; none, any); the board's track view sends it and the stop check reads its own fresh copy */
export function holdOn(decisions, track, since) {
  var from = Date.parse(since || ''), list = Array.isArray(decisions) ? decisions : [];
  var arr = function (x) { return Array.isArray(x) ? x : []; };
  return list.some(function (d) {
    return !!d && arr(d.labels).indexOf('hold') >= 0 && arr(d.tracks).indexOf(track) >= 0
      && (!Number.isFinite(from) || Date.parse(d.created || d.amended || '') >= from);
  });
}
export var HOLD_WORDS = 'on hold, your word';
// the open tasks split into parts that add up, the longest chain apart, so no count reads as a sum of
// the others; the one wording of a track's counts, the kickoff's too
// the one waiting arithmetic, so the track page's tiles add up the way the pill does
export function waitingCount(c) {
  return Math.max(0, (c.open || 0) - (c.running || 0) - (c.unconfirmed || 0) - (c.ready || 0));
}
export function countsText(c) {
  var n = [], open = c.open || 0;
  if (c.running) n.push(c.running + ' running');
  if (c.unconfirmed) n.push(c.unconfirmed + ' unconfirmed');
  if (c.ready) n.push(c.ready + ' ready');
  var waiting = waitingCount(c);
  if (waiting > 0) n.push(waiting + ' waiting');
  return open ? open + ' open: ' + n.join(', ') + (c.chain ? ', longest chain ' + c.chain : '') : 'nothing open';
}
export function lineCounts(tr, D, doneN) {
  var t = D.tracks[tr.id];
  return countsText({ open: t.open, running: t.running, unconfirmed: t.left, ready: t.ready, chain: t.toGo }) + (doneN ? '; ' + doneN + ' done' : '');
}
// a wait or a need on another line: its track, and its workstream when that is another
export function farText(w) {
  if (w.track === 'the inbox') return w.id + ' in ' + (w.ws ? w.ws + "'s inbox" : 'the inbox');
  return w.id + (w.track ? ' on ' + w.track : '') + (w.ws ? ' in ' + w.ws : '');
}
// a diamond at x, y of half-size h
function diamondD(x, y, h) { return 'M' + x + ' ' + (y - h) + 'L' + (x + h) + ' ' + y + 'L' + x + ' ' + (y + h) + 'L' + (x - h) + ' ' + y + 'Z'; }
/* small marks for the pages' lists */
export function mark(kind, size) {
  size = size || 18; var c = size / 2, r = size * 0.3, s = '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" aria-hidden="true">';
  var C = WEB_C;
  if (kind === 'now') s += '<circle cx="' + c + '" cy="' + c + '" r="' + (r + 3) + '" fill="' + C.sky + '" opacity="0.22"/><circle cx="' + c + '" cy="' + c + '" r="' + r + '" fill="' + C.sky + '"/>';
  else if (kind === 'left') s += '<circle cx="' + c + '" cy="' + c + '" r="' + r + '" fill="' + C.bg + '" stroke="' + C.sky + '" stroke-width="2"/><path d="M' + c + ' ' + (c - r + 1.5) + 'A' + (r - 1.5) + ' ' + (r - 1.5) + ' 0 0 0 ' + c + ' ' + (c + r - 1.5) + 'Z" fill="' + C.sky + '"/>';
  else if (kind === 'ready') s += '<circle cx="' + c + '" cy="' + c + '" r="' + r + '" fill="' + C.bg + '" stroke="' + C.ready + '" stroke-width="2.6"/>';
  else if (kind === 'gated') s += '<circle cx="' + c + '" cy="' + c + '" r="' + r + '" fill="' + C.bg + '" stroke="' + C.amber + '" stroke-width="2.4"/><circle cx="' + c + '" cy="' + c + '" r="1.8" fill="' + C.amber + '"/>';
  else if (kind === 'waits') s += '<circle cx="' + c + '" cy="' + c + '" r="' + (r - 1) + '" fill="' + C.bg + '" stroke="' + C.wait + '" stroke-width="2.2"/>';
  else if (kind === 'junction') s += '<circle cx="' + c + '" cy="' + c + '" r="' + (r - 1) + '" fill="' + C.bg + '" stroke="' + C.wait + '" stroke-width="2"/><circle cx="' + c + '" cy="' + c + '" r="' + (r + 2.5) + '" fill="none" stroke="' + C.crit + '" stroke-width="1.3"/>';
  else if (kind === 'done') s += '<circle cx="' + c + '" cy="' + c + '" r="' + (r - 1) + '" fill="' + C.line + '"/>';
  else if (kind === 'reviewed') s += '<path d="' + diamondD(c, c, r + 2) + '" fill="' + C.cross + '"/>';
  return s + '</svg>';
}
