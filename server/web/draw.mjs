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
// a started task no live hand backs, in one wording on every surface
export var LEFT_WORDS = 'in progress, nobody on it';
// a task whose dispatched agent ended is not running: 'finished' (landing) or 'stopped' (its next leg due)
export var ENDED_NEXT = { finished: 'landing', stopped: 'next leg due' };
export function endedOf(n) { var h = n && n.agent && n.agentEnd ? n.agentEnd.how : null; return h === 'finished' || h === 'stopped' ? h : null; }
// a running row's who: its agent with its end once it ended ("auditor, stopped, next leg due"), else `other`
export function whoWords(n, other) { var e = endedOf(n); return n && n.agent ? n.agent + (e ? ', ' + e + ', ' + ENDED_NEXT[e] : '') : other; }
// the started rows split: those running, and those whose agent ended (landing, stopped)
export function nowCounts(rows) {
  var c = { running: 0, landing: 0, stopped: 0 };
  (rows || []).forEach(function (n) { var e = endedOf(n); if (e === 'stopped') c.stopped++; else if (e) c.landing++; else c.running++; });
  return c;
}
export function endedParts(c) { var n = []; if (c.landing) n.push(c.landing + ' landing'); if (c.stopped) n.push(c.stopped + ' stopped'); return n; }
// the open tasks split into parts that add up, the longest chain apart, so no count reads as a sum of
// the others; the one wording of a track's counts, the kickoff's too
export function countsText(c) {
  var n = [], open = c.open || 0;
  if (c.running) n.push(c.running + ' running');
  n = n.concat(endedParts(c));
  if (c.left) n.push(c.left + ' in progress with nobody on ' + (c.left === 1 ? 'it' : 'them'));
  if (c.ready) n.push(c.ready + ' ready');
  var waiting = open - (c.running || 0) - (c.landing || 0) - (c.stopped || 0) - (c.left || 0) - (c.ready || 0);
  if (waiting > 0) n.push(waiting + ' waiting');
  return open ? open + ' open: ' + n.join(', ') + (c.chain ? ', longest chain ' + c.chain : '') : 'nothing open';
}
export function lineCounts(tr, D, doneN) {
  var t = D.tracks[tr.id];
  return countsText({ open: t.open, running: t.running, landing: t.landing, stopped: t.stopped, left: t.left, ready: t.ready, chain: t.toGo }) + (doneN ? '; ' + doneN + ' done' : '');
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
  else if (kind === 'pointer') s += '<rect x="' + (c - 8) + '" y="' + (c - 5) + '" width="16" height="10" rx="5" fill="' + C.bg + '" stroke="' + C.crit + '" stroke-width="1.8"/>';
  else if (kind === 'junction') s += '<circle cx="' + c + '" cy="' + c + '" r="' + (r - 1) + '" fill="' + C.bg + '" stroke="' + C.wait + '" stroke-width="2"/><circle cx="' + c + '" cy="' + c + '" r="' + (r + 2.5) + '" fill="none" stroke="' + C.crit + '" stroke-width="1.3"/>';
  else if (kind === 'done') s += '<circle cx="' + c + '" cy="' + c + '" r="' + (r - 1) + '" fill="' + C.line + '"/>';
  else if (kind === 'reviewed') s += '<path d="' + diamondD(c, c, r + 2) + '" fill="' + C.cross + '"/>';
  return s + '</svg>';
}
