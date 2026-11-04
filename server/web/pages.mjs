/* The board's web pages: the three views, written
   on the server as plain HTML, plus record pages, search, the open set and sign in.
   The drawn graph alone is painted by the page's script, which knows the box's width. */
import { esc, farText, legendHtml, lineCounts, lineWords, mark, parkedWords, reviewPlan, shortDate } from './draw.mjs';
import { shortTitle } from './data.mjs';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FACE_WORDS = {
  app: 'AskerDo', waiting: 'AskerDo mark, a question waits on you', quiet: 'AskerDo mark, nothing waiting on you',
  blocking: 'AskerDo mark, something blocks on you',
};
const STATE_CLASS = { live: 'sky', lav: 'lav', amber: 'amber', text: '', sec: 'dim' };

/* The page kit: the marks as data URLs and the asset paths with their versions. */
export function pageKit({ marks, assets, version = '' }) {
  const face = (kind, size = 20) => '<img class="face" src="' + marks[kind] + '" width="' + size + '" height="' + size + '" alt="' + FACE_WORDS[kind] + '" title="' + FACE_WORDS[kind] + '">';
  return { marks, assets, face, version };
}

const r = (label) => '/r/' + encodeURIComponent(label);
/* A record by its key when the row knows it: labels rest and are reused. */
const idLink = (label, cls = 'id', key = null) => '<a class="' + cls + '" href="' + (key ? r(key) : r(label)) + '">' + esc(label) + '</a>';
const dayOf = (iso) => (/^\d{4}-\d{2}-\d{2}/.test(String(iso || '')) ? String(iso).slice(0, 10) : '');
const pad2 = (n) => String(n).padStart(2, '0');
const clock = (iso) => { const d = new Date(iso); return d.getHours() + ':' + pad2(d.getMinutes()); };
// "today" by the calendar day in the board's zone, so last evening is never today
const when = (iso, now) => (iso ? (new Date(iso).toDateString() === new Date(now).toDateString() ? 'today ' + clock(iso) : shortDate(iso)) : '');
const dateOf = (iso) => { const d = new Date(iso); return Number.isFinite(d.getTime()) ? MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear() : String(iso || ''); };
function ago(iso, now) {
  const m = Math.round((now - Date.parse(iso)) / 60000);
  if (!Number.isFinite(m)) return '';
  if (m < 60) return Math.max(0, m) + 'm ago';
  if (m < 60 * 24) return Math.round(m / 60) + 'h ago';
  return Math.round(m / 1440) + 'd ago';
}
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

/* Labels in prose become links: `Q12`, `T-5`, `WS-3`, `TR-7`, `TH-4.2`. Each names its holder on
   the day the words were written (`at`), or the key a field holds; text inside a tag or
   an existing link is left alone, so a link never nests another. */
const LABEL_RE = /\b(Q\d+|(?:WS|TR|TH|PR|T|P|K)-\d+(?:\.\d+)?)\b/g;
const linkLabels = (escaped, at = '', keys = null) => escaped.split(/(<a\b[^>]*>[\s\S]*?<\/a>|<[^>]*>)/).map((part, i) => (i % 2 ? part
  : part.replace(LABEL_RE, (m) => '<a href="' + (keys && keys[m] ? r(keys[m]) : r(m) + (at ? '?at=' + at : '')) + '">' + m + '</a>'))).join('');

/* ---- the shell ------------------------------------------------------------------ */

const NAV = [['overview', 'Overview'], ['ws', 'Workstream'], ['track', 'Track'], ['needs', 'Needs you'], ['activity', 'Activity'], ['rulings', 'Rulings'], ['settings', 'Settings']];
const FIXED = { overview: '/', needs: '/needs-you', activity: '/activity', rulings: '/rulings', settings: '/settings' };

export function shell(kit, { title, view, main, seq, face = 'app', links = {}, data = null, status = 200, script = true }) {
  const nav = NAV.map(([v, name]) => {
    const href = FIXED[v] || links[v];
    if (!href) return '';
    return '<a href="' + esc(href) + '"' + (view === v ? ' class="on" aria-current="page"' : '') + '>' + name + '</a>';
  }).join('');
  const json = data ? '<script type="application/json" id="gdata">' + JSON.stringify(data).replace(/</g, '\\u003c') + '</script>' : '';
  return {
    status,
    html: '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n'
      + '<title>' + esc(title) + '</title>\n<link rel="icon" id="favicon" href="' + kit.marks[face] + '">\n'
      + '<link rel="stylesheet" href="' + kit.assets.css + '">\n</head>\n<body data-seq="' + (seq || 0) + '">\n<div class="wrap">\n'
      + '<header class="top"><a class="brand" href="/"><img width="20" height="20" alt="AskerDo" src="' + kit.marks.app + '"><span>AskerDo board</span></a>'
      + '<nav class="nav" id="nav">' + nav + '</nav>'
      + '<form class="find" action="/search" role="search"><input type="search" name="q" placeholder="Search, or a label" aria-label="Search the board"></form></header>\n'
      + '<main id="view" data-face="' + face + '">' + main + json + '</main>\n'
      + (kit.version ? '<footer class="foot">AskerDo board ' + esc(kit.version) + '</footer>\n' : '') + '</div>\n'
      + (script ? '<script type="module" src="' + kit.assets.client + '"></script>\n' : '') + '</body>\n</html>\n',
  };
}

/* ---- the graph's words ------------------------------------------------------------ */

/* a record's status in words, the one wording every page row uses */
const statusWords = (s) => String(s || '').replace(/_/g, ' ');
const stateChip = (T) => '<span class="chip ' + T.state + '">' + T.state + '</span>' + (T.stalled ? '<span class="chip stalled">stalled ' + T.days + ' days</span>' : '');
const dotFor = (T) => (T.stalled ? 'stalled' : T.state);
const wordsHtml = (tr, D) => lineWords(tr, D).map((b) => '<span class="' + STATE_CLASS[b[0]] + '">' + esc(b[1]) + '</span>').join(' &middot; ');

/* The inbox turns amber once its open tasks sit unmoved past the stall setting; its count opens the list. */
const inboxHref = (ws) => '/ws/' + encodeURIComponent(ws.id) + '#inbox';
const inboxWords = (ws, days) => '<span' + (ws.inboxStalled ? ' class="amber"' : '') + '>'
  + (ws.inbox ? '<a class="link" href="' + inboxHref(ws) + '">Inbox ' + ws.inbox + '</a>' : 'Inbox 0')
  + (ws.inboxStalled ? ', stalled: nothing moved for over ' + plural(days, 'day', 'days') : '')
  + (ws.inbox ? ', waiting for a triage pass with you' : '') + '</span>';

/* Tracks parent first, each side line under it, with its depth (the overview's tree);
   roots for which `last` holds (the parked) go after the others. */
function treeOrder(tracks, last = () => false) {
  const ids = new Set(tracks.map((tr) => tr.id));
  const kids = {};
  let roots = [];
  for (const tr of tracks) (tr.parent && ids.has(tr.parent) && tr.parent !== tr.id ? (kids[tr.parent] = kids[tr.parent] || []) : roots).push(tr);
  roots = roots.filter((tr) => !last(tr)).concat(roots.filter(last));
  const out = [];
  const seen = new Set();
  const walk = (list, level) => list.forEach((tr) => { if (seen.has(tr.id)) return; seen.add(tr.id); out.push([tr, level]); walk(kids[tr.id] || [], level + 1); });
  walk(roots, 0);
  return out;
}

/* "from T-79 on Main line": where a side line leaves, its parent by name. */
function fromWords(tr, byId) {
  if (!tr.parent) return '';
  const p = byId[tr.parent];
  return 'from ' + (tr.junction ? tr.junction + ' on ' : '') + (p ? p.name : tr.parent);
}

/* A lease unseen past the quiet setting: still held, and open to a take over. */
const quietOf = (tr) => (tr && tr.lease && tr.lease.quiet) || null;
const quietWords = (tr, now) => '<span class="amber">held, quiet since ' + esc(when(quietOf(tr), now)) + '</span>';

/* A verify-first repo with the check the handoff write ran on it. */
const vfRow = (v) => '<span>' + (v.ok === true ? '<span class="ok">ok</span> ' : v.ok === false ? '<span class="bad">fails</span> ' : '')
  + '<code>' + esc(v.repo) + '</code>' + (v.branch ? ' on <code>' + esc(v.branch) + '</code>' : '') + (v.commit ? ' at <code>' + esc(v.commit) + '</code>' : '')
  + (v.problems && v.problems.length ? ': <span class="bad">' + esc(v.problems.join('; ')) + '</span>' : '') + '</span>';
const growthHtml = (lines) => (lines && lines.length ? '<div class="vf">' + lines.map((l) => '<span>' + linkLabels(esc(l)) + '</span>').join('') + '</div>' : '');

/* ---- Overview --------------------------------------------------------------------- */

/* ---- what waits on you: one list, read by every view ---- */

/* The band's presses as words, a press that opens a page as its link. */
const pressWords = (i) => i.presses.map((p) => (p.url ? '<a class="link sky" href="' + esc(p.url) + '">' + esc(p.label) + '</a>' : esc(p.label))).join(' or ') + ' on the band in the app';

/* An item's own line: the question, the handoff's words, the request, the call. */
function needLine(i) {
  if (i.kind === 'question') return idLink(i.id, 'id', i.key) + ' ' + esc(i.text);
  if (i.kind === 'handoff') return linkLabels(esc(i.text));
  if (i.kind === 'override') return '<a class="id" href="/override/' + i.request + '">Override #' + i.request + '</a> ' + esc(i.text);
  return (i.id && !i.text.startsWith(i.id) ? idLink(i.id, 'id', i.key) + ' ' : '') + linkLabels(esc(i.text));
}

/* What it is beside its line, in a list short enough for a card. */
function needAside(i) {
  if (i.kind === 'question') return i.gates.length ? 'holds ' + linkLabels(esc(i.gates.join(', '))) : '';
  if (i.kind === 'handoff') return idLink(i.handoff, '', i.handoffKey) + ' on ' + idLink(i.id, '', i.key);
  return pressWords(i);
}

function needsRows(needs) {
  return needs.items.map((i) => { const a = needAside(i); return needLine(i) + (a ? ' <span class="dim3">(' + a + ')</span>' : ''); });
}

export function overviewPage(kit, m) {
  let agents = 0; let stalled = 0; let parked = 0; let live = 0;
  const cards = m.cards.map((c) => {
    const { g, D, ws } = c;
    const needs = needsRows(c.needs);
    for (const tr of g.tracks) {
      const T = D.tracks[tr.id];
      agents += T.running;
      if (T.stalled) stalled += 1;
      if (T.state === 'parked') parked += 1;
      if (T.state === 'active') live += 1;
    }
    const byId = Object.fromEntries(g.tracks.map((tr) => [tr.id, tr]));
    const isParked = (tr) => D.tracks[tr.id].state === 'parked';
    const tree = treeOrder(g.tracks, isParked);
    const head = (tr, T, level) => '<li' + (level ? ' class="side" style="margin-left:' + Math.min(level, 3) * 18 + 'px"' : '') + '><span class="dot ' + dotFor(T) + '"></span><div><div>'
      + idLink(tr.id, 'id', tr.key) + ' <a class="tn link" href="' + r(tr.key || tr.id) + '">' + esc(tr.name) + '</a></div>'
      + (tr.parent ? '<div class="tl dim">' + linkLabels(esc(fromWords(tr, byId))) + '</div>' : '');
    /* a line nobody holds shows what the next session does first, with its resume command */
    const next = (tr, T) => {
      const h = c.handoffs && c.handoffs[tr.id];
      if (T.state !== 'waiting' && T.state !== 'new') return '';
      return (h && h.focus ? '<div class="tl next">Handed off ' + ago(h.created, m.now) + ': ' + esc(h.focus) + '</div>' : '') + copyCmd(tr.id);
    };
    const trl = tree.map(([tr, level]) => {
      const T = D.tracks[tr.id];
      if (isParked(tr)) {
        return head(tr, T, level)
          + '<div class="tl"><span class="lav">' + esc(parkedWords(tr)) + '</span>' + (T.stalled ? ' &middot; <span class="amber">stalled ' + T.days + ' days</span>' : '') + '</div></div></li>';
      }
      const ag = g.tasks.filter((x) => x.track === tr.id && D.tasks[x.id].kind === 'now').map((x) => x.agent || 'the session');
      return head(tr, T, level)
        + '<div class="tl">' + wordsHtml(tr, D) + '</div>'
        + (quietOf(tr) ? '<div class="tl">' + quietWords(tr, m.now) + ': take it over from its page</div>' : '')
        + (ag.length ? '<div class="tl"><span class="ag">' + esc(ag.join(', ')) + '</span></div>' : '')
        + '<div class="tl num">' + esc(lineCounts(tr, D, 0)) + '</div>' + next(tr, T) + '</div></li>';
    }).join('');
    const ho = c.lastHandoff;
    const isLive = g.tracks.some((tr) => D.tracks[tr.id].state === 'active');
    const fk = c.needs.face;
    return '<article class="wsc' + (isLive ? ' live' : '') + '" data-href="/ws/' + encodeURIComponent(ws.id) + '">'
      + '<div class="wsc-h"><span class="id">' + esc(ws.id) + '</span><h2><a href="/ws/' + encodeURIComponent(ws.id) + '">' + esc(ws.name) + '</a></h2></div>'
      + (needs.length ? '<div class="needs' + (fk === 'blocking' ? ' blocking' : '') + '">' + kit.face(fk) + '<span class="lbl">' + (fk === 'blocking' ? 'Blocks on you' : 'Needs you') + '</span><span>' + needs.join('<br>') + '</span></div>' : '')
      + '<ul class="trl">' + trl + '</ul>'
      + '<div class="wsc-f">' + inboxWords(ws, m.stallDays)
      + (ho ? '<span class="ho">Last handoff ' + idLink(ho.label, 'id', ho.key) + ' ' + ago(ho.created, m.now) + ': ' + esc(ho.focus || '') + '</span>' : '') + '</div></article>';
  }).join('');
  const quiet = m.quiet.map((q) => '<a class="link" href="/ws/' + encodeURIComponent(q.id) + '"><b>' + esc(q.id) + '</b> ' + esc(q.name) + '</a>'
    + (q.inbox ? ', <a class="link' + (q.inboxStalled ? ' amber' : '') + '" href="' + inboxHref(q) + '">inbox ' + q.inbox + (q.inboxStalled ? ', stalled' : '') + '</a>' : '')
    + (q.needs ? ', <a class="link amber" href="/needs-you">' + (q.needs === 1 ? '1 thing needs you' : q.needs + ' things need you') + '</a>' : '')).join(' &middot; ');
  return '<h1>Where every line of work stands</h1><p class="lede">Every workstream with open work, the one a session is on first. Press a card for its map, a track for its page.</p>'
    + '<div class="strip">'
    + '<div class="stat sky"><b>' + live + '</b><span>' + (live === 1 ? 'session on a track' : 'sessions on a track') + '</span></div>'
    + '<div class="stat sky"><b>' + agents + '</b><span>' + (agents === 1 ? 'agent running' : 'agents running') + '</span></div>'
    + '<a class="stat amber" href="/needs-you"><b>' + m.needs.count + '</b><span>' + (m.needs.count === 1 ? 'thing needs you' : 'things need you') + '</span></a>'
    + '<div class="stat amber"><b>' + stalled + '</b><span>' + (stalled === 1 ? 'line stalled' : 'lines stalled') + '</span></div>'
    + '<div class="stat lav"><b>' + parked + '</b><span>' + (parked === 1 ? 'line parked' : 'lines parked') + '</span></div></div>'
    + (cards ? '<div class="cards">' + cards + '</div>' : '<p class="empty">No workstream has a track yet.</p>')
    + (quiet ? '<p class="quiet">No tracks yet: ' + quiet + '</p>' : '')
    + proceduresHtml(m.procedures);
}

/* At most three reasons, each cut short: the card's own page has them whole. */
const SHOWN_REASONS = 3;
const reasonsText = (list) => list.slice(0, SHOWN_REASONS).map((x) => (x.length > 180 ? x.slice(0, 177).trimEnd() + '...' : x)).join('; ')
  + (list.length > SHOWN_REASONS ? '; and ' + (list.length - SHOWN_REASONS) + ' more on its page' : '');

/* the procedure cards, read only, the stale and flagged first with the reasons why. */
function proceduresHtml(p) {
  if (!p || !p.cards.length) return '';
  const rows = p.cards.map((c) => '<div class="r"><span class="chip ' + c.badge.replace(/\s+/g, '-') + '">' + esc(c.badge) + '</span><span>' + idLink(c.id, 'id', c.key) + ' ' + esc(c.name)
    + (c.project ? ' <span class="dim3">' + esc(c.project) + '</span>' : '')
    + (c.reasons.length ? '<br><span class="amber">' + esc(reasonsText(c.reasons)) + '</span>'
      : c.verifiedAt ? '<br><span class="dim">verified ' + esc(shortDate(c.verifiedAt)) + ', ' + plural(c.runs, 'run', 'runs') + '</span>' : '')
    + '</span></div>').join('');
  return '<section class="panel procs"><h2>Procedures</h2><div class="rows">' + rows + '</div>'
    + (p.retired ? '<p class="dim3 procs-f">' + plural(p.retired, 'retired card', 'retired cards') + ' not listed</p>' : '') + '</section>';
}

/* ---- Workstream ------------------------------------------------------------------- */

/* A switcher's chips in a row; on a phone (board.css, under 640 px) the current one and
   the rest one press away, so the page's own title stays on the first screen. */
function switcher(cls, chips, current, [one, many]) {
  const row = '<div class="' + cls + ' sw-wide">' + chips.join('') + '</div>';
  if (chips.length < 2) return row;
  return row + '<details class="sw-narrow"><summary><span class="cur">' + current + '</span><span class="more">'
    + plural(chips.length - 1, one, many) + '</span></summary><div class="' + cls + '">' + chips.join('') + '</div></details>';
}

export function graphData(m) {
  return { L: m.L, D: m.D, g: { tracks: m.g.tracks, tasks: m.g.tasks, edges: m.g.edges } };
}

export function workstreamPage(kit, m) {
  const { g, D, ws } = m;
  const bar = switcher('wsbar', m.switcher.map((x) => '<a href="/ws/' + encodeURIComponent(x.id) + '"' + (x.id === ws.id ? ' class="on"' : '') + ' title="' + esc(x.name) + '">' + esc(x.id) + '</a>'),
    esc(ws.id), ['other workstream', 'other workstreams']);
  const cp = D.critical;
  const needs = m.needs.items.map((i) => { const a = needAside(i); return '<div class="r">' + mark('gated') + '<span>' + needLine(i) + (a ? ' <span class="dim">(' + a + ')</span>' : '') + '</span></div>'; });
  const held = g.tracks.filter((tr) => D.tracks[tr.id].state === 'parked' || D.tracks[tr.id].stalled || quietOf(tr)).map((tr) => {
    const T = D.tracks[tr.id];
    return '<div class="r"><span class="dot ' + dotFor(T) + '" style="margin-top:5px"></span><a class="link" href="' + r(tr.id) + '"><span class="id">' + esc(tr.id) + '</span> ' + esc(tr.name) + ': '
      + (T.state === 'parked' ? '<span class="lav">' + esc(parkedWords(tr)) + '</span>' : quietOf(tr) ? quietWords(tr, m.now) + ', open to a take over' : '<span class="dim">' + T.state + '</span>')
      + (T.stalled ? ', <span class="amber">nothing moved for ' + T.days + ' days</span>' : '') + '</a></div>';
  });
  const graph = g.tracks.length && m.L.lines.length
    ? '<div class="gbox" id="gbox" data-graph="' + esc(ws.id) + '"></div>' + legendHtml(reviewPlan(g).marks)
    : '<p class="empty">' + (g.tracks.length ? 'Every line here is finished: nothing left to draw.' : 'No tracks in this workstream yet.') + '</p>';
  return bar + '<h1>' + esc(ws.name) + '</h1>'
    + '<p class="chain"><a class="link sky" href="/rulings?ws=' + encodeURIComponent(ws.id) + '">Rulings</a><a class="link sky" href="/activity?ws=' + encodeURIComponent(ws.id) + '">Activity</a></p>'
    + '<p class="lede"><span class="id">' + esc(ws.id) + '</span> &middot; where we stand: each line is a track, each station a task, columns by what waits on what. '
    + (cp.len ? 'The longest chain left, the critical path, is <b style="color:var(--ink)">' + plural(cp.len, 'task', 'tasks') + '</b>' + (cp.path.length ? ', from ' + esc(cp.path[0]) + ' to ' + esc(cp.path[cp.path.length - 1]) : '') + '. ' : '')
    + inboxWords(ws, m.stallDays) + '.</p>'
    + graph
    + '<div class="below">'
    + '<section class="panel"><h2 class="fh">' + kit.face(m.needs.face) + 'Needs you</h2><div class="rows">' + (needs.length ? needs.join('') : '<span class="empty">Nothing waits on you here.</span>') + '</div></section>'
    + '<section class="panel"><h2>Parked, stalled or quiet</h2><div class="rows">' + (held.length ? held.join('') : '<span class="empty">Every line is moving.</span>') + '</div></section>'
    + '<section class="panel" id="inbox"><h2>Inbox, ' + plural(m.inboxList.length, 'task', 'tasks') + ' on no track</h2>' + (m.inboxList.length
      ? '<ul class="tl-list">' + m.inboxList.map((t) => '<li><span class="mk">' + mark('waits') + '</span><div><div class="t1">' + idLink(t.id, 'id', t.key) + ' ' + esc(t.name) + '</div>'
        + '<div class="t2">' + esc(statusWords(t.status || 'open')) + '</div></div><span class="side num">' + esc(t.created ? ago(t.created, m.now) : '') + '</span></li>').join('') + '</ul>'
      : '<p class="empty">Nothing waits for a triage pass.</p>') + '</section></div>';
}

/* ---- Track ------------------------------------------------------------------------ */

function waitsText(k) {
  return k.waits.map(farText).concat(k.gates);
}

function trackRow(t, k, crit, side) {
  const sub = [];
  // the second line carries only what the short title left out
  if (t.full && t.full !== t.title) sub.push(esc(t.full.startsWith(t.title + ': ') ? t.full.slice(t.title.length + 2) : t.full));
  const on = waitsText(k);
  if (k.kind !== 'pointer' && on.length) sub.push('<span class="' + (k.gates.length ? 'amber' : 'dim') + '">after ' + linkLabels(esc(on.join(', '))) + '</span>');
  if (k.needed && k.needed.length) sub.push('<span class="dim">needed by ' + linkLabels(esc(k.needed.map(farText).join(', '))) + '</span>');
  let right = side || '';
  if (t.checklist && t.checklist.total) {
    right = '<span class="meter"><i style="width:' + Math.round((100 * t.checklist.done) / t.checklist.total) + '%"></i></span>' + t.checklist.done + ' of ' + t.checklist.total;
  }
  return '<li class="' + (crit ? 'crit' : '') + '"><span class="mk">' + mark(k.kind) + '</span><div><div class="t1">' + idLink(t.id) + ' ' + esc(t.title) + '</div>'
    + (sub.length ? '<div class="t2">' + sub.join(' &middot; ') + '</div>' : '') + '</div><span class="side num">' + right + '</span></li>';
}

function copyCmd(id, move = '') {
  const cmd = '/askerdo resume ' + id + (move ? ' ' + move : '');
  return '<div class="cmd"><code>' + esc(cmd) + '</code><button class="copy" type="button" data-copy="' + esc(cmd) + '">Copy</button></div>';
}

function handoffLi(h, isHere, trackId, now) {
  const live = h.live && isHere;
  const vf = h.verify.length ? '<div class="vf">' + h.verify.map(vfRow).join('') + '</div>' : '';
  const waiting = live && h.waitingOnUser.length ? '<div class="vf">' + h.waitingOnUser.map((w) => '<span class="amber">waits on you: ' + esc(w) + '</span>').join('') + '</div>' : '';
  return '<li class="' + (live ? 'live' : '') + '"><div class="hh">' + idLink(h.id, 'id', h.key) + '<span class="dim num">' + when(h.created, now) + '</span>'
    + (live ? '<span class="chip active">live</span>' : '<span class="dim3" style="font-size:13px">' + esc(h.status || '') + '</span>') + '</div>'
    + '<div class="hf">' + esc(h.focus) + '</div>' + waiting + growthHtml(h.growth) + vf + (live ? copyCmd(trackId) : '') + '</li>';
}

const HANDOFFS_SHOWN = 6;

export function trackPage(kit, m) {
  const { g, D, L, track: tv, ws } = m;
  const tr = g.tracks.find((x) => x.id === tv.id);
  const T = D.tracks[tv.id];
  // short names keep the switcher to a row or two on a phone; the full name is the hover
  const pick = switcher('trpick', m.pickList.map((x) => '<a href="' + r(x.key || x.id) + '" title="' + esc(x.name) + '"' + (x.id === tv.id ? ' class="on"' : '') + '>' + esc(x.id) + ' ' + esc(shortTitle(x.name)) + '</a>'),
    esc(tv.id) + ' ' + esc(shortTitle(tv.name)), ['other track', 'other tracks']);
  const mine = g.tasks.filter((t) => t.track === tv.id && D.tasks[t.id].kind !== 'done');
  const crit = new Set(T.path);
  const col = (t) => (L.stations[t.id] ? L.stations[t.id].col : 0);
  const now = mine.filter((t) => D.tasks[t.id].kind === 'now' || D.tasks[t.id].kind === 'left');
  const ready = mine.filter((t) => D.tasks[t.id].kind === 'ready');
  const rest = mine.filter((t) => !['now', 'left', 'ready'].includes(D.tasks[t.id].kind)).sort((a, b) => (col(a) - col(b)) || (a.pos - b.pos));

  const nowHtml = now.length ? '<ul class="tl-list">' + now.map((t) => {
    const k = D.tasks[t.id];
    const who = k.kind === 'now' ? '<span class="agent">' + esc(t.agent || 'the session') + '</span>' : '<span class="dim">nobody on it</span>';
    const li = trackRow(t, k, crit.has(t.id), m.since[t.id] ? 'since ' + when(m.since[t.id], m.now) : '');
    return li.replace('<div class="t1">', '<div class="t2" style="margin:0 0 1px">' + who + '</div><div class="t1">');
  }).join('') + '</ul>' : '<p class="empty">Nothing running.</p>';
  const readyHtml = ready.length ? '<ul class="tl-list">' + ready.map((t) => trackRow(t, D.tasks[t.id], crit.has(t.id))).join('') + '</ul>'
    : '<p class="empty">Nothing ready: everything left waits on something.</p>';
  const restHtml = rest.length ? '<ul class="tl-list">' + rest.map((t) => {
    const k = D.tasks[t.id];
    let side = '';
    if (k.kind === 'pointer' && t.progress) {
      side = '<span class="meter"><i style="width:' + Math.round((100 * t.progress.done) / Math.max(1, t.progress.total)) + '%"></i></span>' + esc(t.promotedTo) + ' ' + t.progress.done + ' of ' + t.progress.total;
    }
    return trackRow(t, k, crit.has(t.id), side);
  }).join('') + '</ul>' : '<p class="empty">Nothing else on this line.</p>';
  const doneHtml = m.done.length ? '<details class="done-f"><summary>' + m.done.length + ' done</summary><ul class="tl-list" style="margin-top:6px">'
    + m.done.map((t) => '<li><span class="mk">' + mark('done') + '</span><div><div class="t1 dim">' + idLink(t.id, 'id', t.key) + ' ' + esc(t.name) + (t.status === 'dropped' ? ' <span class="dim3">(dropped)</span>' : '') + '</div></div><span class="side"></span></li>').join('')
    + '</ul></details>' : '';

  const shown = m.handoffs.slice(0, HANDOFFS_SHOWN);
  const older = m.handoffs.slice(HANDOFFS_SHOWN);
  const olderHtml = older.length ? '<li class="before-li" style="list-style:none"><details class="done-f"><summary>' + plural(older.length, 'earlier handoff', 'earlier handoffs') + '</summary><div class="rows" style="margin-top:8px">'
    + older.map((h) => '<div class="r"><span class="dim num">' + esc(shortDate(h.created)) + '</span><span>' + idLink(h.id, 'id', h.key) + ' ' + esc(h.focus) + '</span></div>').join('') + '</div></details></li>' : '';
  const hoHtml = shown.length || m.before.length
    ? '<ul class="hand">' + shown.map((h) => handoffLi(h, true, tv.id, m.now)).join('') + olderHtml
      + (m.before.length ? '<li style="list-style:none" class="before-li"><div class="before">ON ' + esc(m.parent.id) + ', BEFORE THE JUNCTION</div></li>' + m.before.map((h) => handoffLi(h, false, tv.id, m.now)).join('') : '') + '</ul>'
    : '<p class="empty">No handoffs yet. A new track\'s kickoff is printed from its tasks and its junction alone.</p>' + copyCmd(tv.id);

  const qHtml = m.questions.length ? '<div class="rows">' + m.questions.map((q) => '<div class="r">' + mark(q.status === 'open' ? 'gated' : 'done') + '<span>' + idLink(q.id, 'id', q.key) + ' ' + esc(q.name) + ' '
    + (q.status === 'open' ? '<span class="amber">needs your answer' + (q.gates.length ? ', holds ' + esc(q.gates.join(', ')) : '') + '</span>'
      : '<span class="dim">' + esc(statusWords(q.status)) + (q.pick ? ' ' + esc(q.pick) : '') + '</span>') + '</span></div>').join('') + '</div>'
    : '<p class="empty">No questions asked on this line.</p>';

  const promoted = m.promoted;
  const jHtml = '<div class="rows">'
    + (m.parent ? '<div class="r">' + mark(promoted ? 'pointer' : 'junction') + '<span>' + (promoted ? 'Promoted from' : 'Splintered from')
      + (m.jtask ? ' ' + idLink(m.jtask.id, 'id', m.jtask.key) + ' ' + esc(m.jtask.name || '') : '') + ' on <a class="link" href="' + r(m.parent.key || m.parent.id) + '"><span class="id">' + esc(m.parent.id) + '</span> ' + esc(m.parent.name || '') + '</a>'
      + (m.parent.state === 'parked' ? ', which is <span class="lav">parked behind this</span>' : '')
      /* a closed parent takes no resume, as the finish and park results say */
      + (['done', 'dropped', 'folded'].includes(m.parent.state) ? ', which is <span class="dim">' + esc(m.parent.state) + '</span>. When this line finishes or parks, the board points you at the open tracks instead.</span></div>'
        : '. When this line finishes or parks, the board hands you that junction to go back on track.</span></div>')
      : '<div class="r">' + mark('waits') + '<span>A root line: no junction above it.</span></div>')
    + m.sides.map((k) => '<div class="r">' + mark(k.promoted ? 'pointer' : 'junction') + '<span>Side track <a class="link" href="' + r(k.key || k.id) + '"><span class="id">' + esc(k.id) + '</span> ' + esc(k.name) + '</a>'
      + (k.at ? ' leaves at ' + idLink(k.at, 'id', k.atKey) : '') + ': <span class="' + (k.state === 'active' ? 'sky' : '') + '">' + esc(k.state) + '</span>, ' + k.done + ' of ' + k.total + ' done</span></div>').join('')
    + '</div>';

  const lease = tr.lease;
  const quiet = T.state === 'active' && quietOf(tr);
  const stateLine = quiet ? quietWords(tr, m.now) + ' (a session' + (lease.pc ? ' on ' + esc(lease.pc) : '') + (lease.since ? ', since ' + esc(when(lease.since, m.now)) : '') + ')'
    : T.state === 'active' ? '<span class="sky">held by a session' + (lease && lease.pc ? ' on ' + esc(lease.pc) : '') + (lease && lease.since ? ' since ' + when(lease.since, m.now) : '') + '</span>'
    : T.state === 'parked' ? '<span class="lav">' + esc(parkedWords(tr)) + '</span>'
      : T.state === 'new' ? 'nobody has taken it up yet'
        : T.state === 'waiting' ? (T.noHandoff ? 'waiting, no handoff yet' : 'waiting since ' + esc(shortDate(tr.since || tr.last)) + ', no session on it') : esc(T.state);
  const trackOf = new Map(g.tasks.map((t) => [t.id, t.track]));
  const cp = T.path.map((id) => idLink(id) + (trackOf.has(id) && trackOf.get(id) !== tv.id ? ' <span class="dim">on ' + esc(trackOf.get(id)) + '</span>' : '')).join(' &rarr; ');
  const doneN = tv.done;
  // this line, its parents, its side lines and the lines it waits on or holds
  // under the map, what the drawn review covered, each a link to its page
  const covered = g.tasks.filter((t) => t.track === tv.id && t.review && t.kept).map((t) => '<div class="r">' + mark('reviewed') + '<span>' + idLink(t.id, 'id', t.key) + ' ' + esc(shortTitle(t.full || t.title))
    + ' covered ' + ((t.covers || []).map((c) => idLink(c.id, 'id', c.key) + ' ' + esc(shortTitle(c.name))).join(', ') || 'nothing') + '</span></div>').join('');
  const graph = L.lines.length ? '<div class="gbox" id="gbox" data-graph="' + esc(tv.id) + '"></div>' + covered + legendHtml(reviewPlan(g).marks) : '';

  return pick
    + '<div class="thead"><span class="id" style="font-size:15px">' + esc(tv.id) + '</span><h1 style="margin:0">' + esc(tv.name) + '</h1>' + stateChip(T) + '</div>'
    + '<div class="chain"><span>' + stateLine + '</span>'
    + (tv.chain && tv.chain.includes(' under ') ? '<span>' + linkLabels(esc(tv.chain)) + '</span>' : '')
    + (m.record.goal && m.record.goal !== tv.name ? '<span class="dim3">' + esc(m.record.goal) + '</span>' : '')
    + '<a class="dim3" href="/ws/' + encodeURIComponent(ws.id) + '">' + esc(ws.id) + '</a></div>'
    + (quiet ? '<div class="quiet-to">Its session has gone quiet: a new session can take the track over.' + copyCmd(tv.id, '--take-over') + '</div>' : '')
    + '<div class="stats">'
    + '<div class="stat"><b>' + T.open + '</b><span>open</span></div>'
    + '<div class="stat sky"><b>' + (T.running || T.left) + '</b><span>' + (T.running || !T.left ? 'running' : 'in progress') + '</span></div>'
    + '<div class="stat sky"><b>' + T.ready + '</b><span>ready</span></div>'
    + '<div class="stat"><b>' + T.toGo + '</b><span>longest chain</span></div>'
    + '<div class="stat"><b>' + doneN + '</b><span>done</span></div></div>'
    + (T.path.length ? '<p class="critline"><b>Critical path, the longest chain left, ' + plural(T.toGo, 'task', 'tasks') + ':</b> ' + cp + '</p>' : '')
    + graph
    + '<div class="tgrid"><div class="col">'
    + '<section class="panel"><h2>Now</h2>' + nowHtml + '</section>'
    + '<section class="panel"><h2>Ready</h2>' + readyHtml + '</section>'
    + '<section class="panel"><h2>Then, in dependency order</h2>' + restHtml + doneHtml + '</section></div>'
    + '<div class="col">'
    + '<section class="panel"><h2>Handoffs</h2>' + hoHtml + '</section>'
    + '<section class="panel"><h2>Questions</h2>' + qHtml + '</section>'
    + '<section class="panel"><h2>Junction and side tracks</h2>' + jHtml + '</section></div></div>';
}

/* ---- record pages --------------------------------------------------------------- */

/* Enough markdown for record bodies: headings, lists, tables, code, bold, links. */
export function md(text, { at = '', keys = null } = {}) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let para = [];
  let list = null;
  const inline = (s) => {
    const code = [];
    let t = esc(s).replace(/`([^`]+)`/g, (m0, c) => { code.push('<code>' + c + '</code>'); return '\u0000' + (code.length - 1) + '\u0000'; });
    t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (m0, a, u) => '<a href="' + u + '" rel="noreferrer">' + a + '</a>')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
    t = linkLabels(t, at, keys).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    return t.replace(/\u0000(\d+)\u0000/g, (m0, i) => code[Number(i)]);
  };
  const flush = () => {
    if (para.length) { out.push('<p>' + inline(para.join(' ')) + '</p>'); para = []; }
    if (list) { out.push('<' + list.tag + '>' + list.items.map((i) => '<li>' + inline(i) + '</li>').join('') + '</' + list.tag + '>'); list = null; }
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^```/.test(line)) {
      flush();
      const buf = [];
      for (i += 1; i < lines.length && !/^```/.test(lines[i]); i++) buf.push(lines[i]);
      out.push('<pre><code>' + esc(buf.join('\n')) + '</code></pre>');
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) { flush(); if (h[2].trim()) out.push('<h3>' + inline(h[2]) + '</h3>'); continue; }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      flush();
      const rows = [];
      for (; i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]); i++) rows.push(lines[i]);
      i -= 1;
      const cells = (row) => row.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const body = rows.filter((row) => !/^\s*\|[\s|:-]+\|\s*$/.test(row));
      const [head, ...rest] = body;
      out.push('<div class="tbl"><table><thead><tr>' + cells(head).map((c) => '<th>' + inline(c) + '</th>').join('') + '</tr></thead><tbody>'
        + rest.map((row) => '<tr>' + cells(row).map((c) => '<td>' + inline(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>');
      continue;
    }
    const li = /^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/.exec(line);
    if (li) {
      const tag = li[1] ? 'ul' : 'ol';
      if (para.length || (list && list.tag !== tag)) flush();
      if (!list) list = { tag, items: [] };
      list.items.push(li[3]);
      continue;
    }
    if (!line.trim()) { flush(); continue; }
    if (list && /^\s+\S/.test(line)) { list.items[list.items.length - 1] += ' ' + line.trim(); continue; }
    if (list) flush();
    para.push(line.trim());
  }
  flush();
  return '<div class="md">' + out.join('') + '</div>';
}

/* A stored section left out of the body when the page draws it itself. */
function withoutSection(body, heading) {
  const lines = String(body || '').split('\n');
  const at = lines.findIndex((l) => l.trim() === '## ' + heading);
  if (at < 0) return body;
  let end = at + 1;
  while (end < lines.length && !lines[end].startsWith('## ')) end++;
  return lines.slice(0, at).concat(lines.slice(end)).join('\n');
}

/* the card's rule (lineSet in lib/mod-core.mjs): each stored line one list item,
   a line with its own marker keeping it, so a gist never welds into one paragraph */
const LIST_MARK = /^(?:[-*+]\s|\d+[.)]\s)/;
const lineSet = (text) => String(text || '').split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean)
  .map((l) => (LIST_MARK.test(l) ? l : '- ' + l));

/* a question's body as its card reads it: the old file store's link and heading
   dropped (the page draws the id and name), the gist under Why and the stakes as items. */
function questionBody(body) {
  const lines = String(body || '').replace(/\r\n?/g, '\n').split('\n');
  const head = lines.findIndex((l) => l.startsWith('# ') || l.startsWith('## '));
  let i = head >= 0 && lines[head].startsWith('# ') ? head + 1 : 0;
  const gist = [];
  while (i < lines.length && !lines[i].startsWith('## ')) gist.push(lines[i++]);
  const out = gist.some((l) => l.trim()) ? ['## Why', ...lineSet(gist.join('\n')), ''] : [];
  while (i < lines.length) {
    const heading = lines[i++];
    const content = [];
    while (i < lines.length && !lines[i].startsWith('## ')) content.push(lines[i++]);
    out.push(heading, ...(heading.trim() === '## Stakes' ? lineSet(content.join('\n')).concat('') : content));
  }
  return out.join('\n');
}

/* a heading with nothing under it is not drawn */
function withoutEmpty(body) {
  const lines = String(body || '').split('\n');
  return lines.filter((l, i) => {
    if (!l.startsWith('## ')) return true;
    let j = i + 1;
    while (j < lines.length && !lines[j].trim()) j++;
    return j < lines.length && !lines[j].startsWith('## ');
  }).join('\n');
}

/* A question's options with their slots, read only: the pick and the answer marked. */
function optionsHtml(m) {
  if (!m.options || !m.options.length) return '';
  const pick = String((m.front && m.front.pick) || '').trim().toLowerCase();
  const cells = (o) => [['gets you', o.getsYou], ['costs you', o.costsYou], ['why pick it', o.whyPick], ['why not', o.whyNot], ['undo', o.undo]].filter(([, v]) => v);
  return '<section class="panel"><h2>Options</h2><ul class="tl-list opts">' + m.options.map((o) => {
    const t = String(o.type || '').trim().toLowerCase();
    const tags = (t && t === pick ? ' <span class="chip">my pick</span>' : '') + (t && t === m.chosen ? ' <span class="chip active">answered</span>' : '');
    return '<li><span class="mk id">' + esc(o.type) + '</span><div><div class="t1">' + linkLabels(esc(o.option)) + tags + '</div>'
      + (o.headline ? '<div class="t2">' + linkLabels(esc(o.headline)) + '</div>' : '')
      + '<dl class="facts opt">' + cells(o).map(([k, v]) => '<dt>' + k + '</dt><dd>' + linkLabels(esc(v)) + '</dd>').join('') + '</dl></div><span class="side"></span></li>';
  }).join('') + '</ul></section>';
}

/* a session reads as "a session", never its raw id, as the track page says it */
const SESSION_FACTS = new Set(['inHand', 'session', 'fromSession', 'resumedBy']);
const SKIP_FACTS = new Set(['id', 'key', 'name', 'status', 'labelHistory', 'subscribers', 'legacyId', 'focus', 'evidence', 'growth', 'depthAtHandoff']);

function factValue(k, v, at, keys) {
  if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) return '';
  if (SESSION_FACTS.has(k)) return 'a session';
  if (k === 'claimants') return [].concat(v).length === 1 ? 'a session' : [].concat(v).length + ' sessions';
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'object' ? esc(JSON.stringify(x)) : linkLabels(esc(String(x)), at, keys))).join(', ');
  if (typeof v === 'object') return esc(JSON.stringify(v));
  if (/^\d{4}-\d{2}-\d{2}T/.test(String(v))) return esc(dateOf(v) + ' ' + clock(v));
  return linkLabels(esc(String(v)), at, keys);
}

/* A task's place beside its id: its track, and its workstream when that is another. */
const placeHtml = (d) => (d.track === 'the inbox' ? ' <span class="dim">in ' + (d.ws ? linkLabels(esc(d.ws)) + "'s" : 'the') + ' inbox</span>'
  : d.track ? ' <span class="dim">on ' + linkLabels(esc(d.track)) + (d.ws ? ' in ' + linkLabels(esc(d.ws)) : '') + '</span>' : '');

/* ready, or what holds it: open tasks it depends on, its side track, the questions gating it. */
function standsRow(m) {
  const open = (m.dependsOn || []).filter((d) => !['completed', 'dropped'].includes(d.status));
  const holds = open.map((d) => idLink(d.label, 'id', d.key) + placeHtml(d))
    .concat(m.readiness.side ? ['its side track ' + linkLabels(esc(m.readiness.side))] : [])
    .concat((m.gatedBy || []).map((q) => idLink(q.label, 'id', q.key)));
  const word = m.status === 'in_progress' ? 'In progress' : m.readiness.ready ? 'Ready to start' : '';
  if (!holds.length) {
    return '<div class="r">' + mark(m.status === 'in_progress' ? 'now' : word ? 'ready' : 'waits') + (word ? '<span class="sky">' + word + ': nothing holds it.</span>'
      : '<span>Not ready: it is ' + esc(statusWords(m.status)) + '.</span>') + '</div>';
  }
  return '<div class="r">' + mark(m.gatedBy && m.gatedBy.length ? 'gated' : 'waits') + '<span>' + (word ? word + ', ' : 'Not ready: ') + 'waits on ' + holds.join(', ') + '</span></div>';
}

export function recordPage(kit, m, found) {
  const facts = m.facts || Object.entries(m.front || {}).filter(([k]) => !SKIP_FACTS.has(k));
  // labels in prose as they stood when written: a note on its day, the body on the record's first
  const at = dayOf(m.created || (m.front && m.front.created));
  const rows = facts.map(([k, v]) => [k, factValue(k, v, dayOf(m.front && m.front.updated) || at, m.refs)]).filter(([, v]) => v);
  const also = found && found.holders.length
    ? '<p class="also">' + esc(found.label) + ' also named: ' + found.holders.map((h) => '<a class="link" href="' + r(h.key) + '">' + esc(h.kind) + ' ' + esc(h.name)
      + (h.now && h.now !== found.label ? ' (now ' + esc(h.now) + ')' : '') + '</a> <span class="dim3">' + esc(h.from) + (h.to ? ' to ' + esc(h.to) : ' on') + '</span>').join(' &middot; ') + '</p>'
    : '';
  const extra = [];
  if (m.track) extra.push('<div class="r">' + mark('waits') + '<span>On ' + idLink(m.track, 'id', m.trackKey) + '</span></div>');
  if (m.readiness) extra.push(standsRow(m));
  if (m.dependsOn && m.dependsOn.length) extra.push('<div class="r">' + mark('waits') + '<span>Depends on ' + m.dependsOn.map((d) => idLink(d.label, 'id', d.key) + placeHtml(d) + ' <span class="dim">' + esc(statusWords(d.status)) + '</span>').join(', ') + '</span></div>');
  if (m.neededBy && m.neededBy.length) extra.push('<div class="r">' + mark('waits') + '<span>Needed by ' + m.neededBy.map((d) => idLink(d.id, 'id', d.key) + ' ' + esc(d.name || '') + placeHtml(d)).join(', ') + '</span></div>');
  if (m.gatedBy && m.gatedBy.length) extra.push('<div class="r">' + mark('gated') + '<span>Gated by ' + m.gatedBy.map((q) => idLink(q.label, 'id', q.key) + ' ' + esc(q.title || '')
    + ' <span class="amber">' + (q.blocking ? 'blocks on you' : 'needs your answer') + '</span>').join(', ') + '</span></div>');
  if (m.gates && m.gates.length) extra.push('<div class="r">' + mark('gated') + '<span>Holds ' + m.gates.map((g) => idLink(g.label, 'id', g.key)).join(', ') + '</span></div>');
  if (m.override) extra.push('<div class="r">' + mark('gated') + '<span><a class="link" href="/override/' + m.override + '">Override #' + m.override + '</a> <span class="amber">waits on your Allow or Keep</span></span></div>');
  const checklist = m.checklist && m.checklist.length ? '<section class="panel"><h2>Checklist, ' + m.checklist.filter((c) => c.done).length + ' of ' + m.checklist.length + '</h2><ul class="tl-list">'
    + m.checklist.map((c) => '<li><span class="mk">' + mark(c.done ? 'done' : 'waits') + '</span><div><div class="t1' + (c.done ? ' dim' : '') + '">' + esc(c.text) + '</div></div><span class="side"></span></li>').join('') + '</ul></section>' : '';
  const waiting = m.waitingOnUser && m.waitingOnUser.length ? '<section class="panel"><h2>Waits on you</h2><div class="rows">' + m.waitingOnUser.map((w) => '<div class="r">' + mark('gated') + '<span>' + linkLabels(esc(w), at) + '</span></div>').join('') + '</div></section>' : '';
  const verify = m.verify && m.verify.length ? '<section class="panel"><h2>Verify first</h2><div class="vf">' + m.verify.map(vfRow).join('') + '</div></section>' : '';
  const growth = m.growth && m.growth.length ? '<section class="panel"><h2>Growth</h2>' + growthHtml(m.growth) + '</section>' : '';
  const stored = m.kind === 'question' ? questionBody(m.body) : m.body;
  const body = withoutEmpty(m.options && m.options.length ? withoutSection(stored, 'Options') : stored);
  const notes = m.notes && m.notes.length ? '<section class="panel"><h2>Journal</h2><ul class="notes">' + m.notes.map((n) => '<li><div class="nh">' + esc(n.at ? dateOf(n.at) + ' ' + clock(n.at) : '') + (n.actor ? ' &middot; ' + esc(n.actor) : '') + '</div>' + md(n.body, { at: dayOf(n.at) }) + '</li>').join('') + '</ul></section>' : '';
  return '<div class="rec-h"><span class="id" style="font-size:15px">' + esc(m.label) + '</span><span class="chip">' + esc(m.kind) + '</span>' + (m.status ? '<span class="chip">' + esc(statusWords(m.status)) + '</span>' : '') + '</div>'
    + '<h1>' + esc(m.title || m.label) + '</h1>' + also
    + '<div class="tgrid"><div class="col">'
    + (body.trim() ? '<section class="panel">' + md(body, { at }) + '</section>' : '') + optionsHtml(m) + checklist + notes + historyHtml(m.history) + '</div>'
    + '<div class="col">' + (extra.length ? '<section class="panel"><div class="rows">' + extra.join('') + '</div></section>' : '') + waiting + growth + verify
    + (rows.length ? '<section class="panel"><h2>Fields</h2><dl class="facts">' + rows.map(([k, v]) => '<dt>' + esc(k) + '</dt><dd>' + v + '</dd>').join('') + '</dl></section>' : '')
    + '</div></div>';
}

/* the old words beside the new, for a record's history and an override's request. */
const beside = (head, text) => '<div><div class="nh">' + head + '</div>' + (text ? md(text) : '<p class="dim">(empty)</p>') + '</div>';

/* Every text change a record had, folded until opened. */
function historyHtml(rows) {
  if (!rows || !rows.length) return '';
  return '<details class="panel hist"><summary>History, ' + plural(rows.length, 'change', 'changes') + '</summary><ul class="notes">'
    + rows.map((h) => '<li><div class="nh">#' + h.id + ' &middot; ' + esc(dateOf(h.at) + ' ' + clock(h.at)) + (h.actor ? ' &middot; ' + esc(h.actor) : '') + ' &middot; ' + esc(h.field)
      + (h.why ? ' &middot; ' + esc(h.why) : '') + '</div><div class="ba">' + beside('Before', h.old) + beside('After', h.new) + '</div></li>').join('')
    + '</ul></details>';
}

/* What the request does, in its own count: a fix rewrites text, whatever found it wrong */
const OVERRIDE_CHIP = { fix: 'rewrite', withdraw: 'withdraw', scrub: 'scrub' };
function overrideWords(m) {
  const kinds = [...new Set(m.records.map((x) => x.kind).filter(Boolean))];
  const n = m.records.length;
  const what = kinds.length === 1 ? plural(n, kinds[0], kinds[0] + 's') : plural(n, 'record', 'records');
  return m.kind === 'withdraw' ? 'Withdraws ' + (n === 1 ? 'a ruling' : n + ' rulings') + ' you never made'
    : m.kind === 'scrub' ? 'Scrubs a secret or a personal detail from ' + what
      : 'Rewrites the text of ' + what + ' already in use';
}

/* An override request's whole before and after, read only: the presses live in the app.
   A scrub shows the after and never the text it removes. */
export function overridePage(kit, m) {
  const field = (x, f) => '<div class="nh" style="margin-top:8px">' + esc(f.field) + '</div>' + (x.removed
    ? '<p class="amber">The text this request removes is not shown here.</p><div class="ba one">' + beside('After', f.after) + '</div>'
    : '<div class="ba">' + beside('Before', f.before) + beside('After', f.after) + '</div>');
  const recs = m.records.map((x) => '<section class="panel"><h2 class="fh">' + idLink(x.id, 'id', x.key) + ' <span class="chip">' + esc(x.kind) + '</span></h2>'
    + '<p style="margin:0 0 10px">' + esc(x.name) + '</p>' + (x.gone ? '<p class="dim">This record is gone.</p>' : x.fields.map((f) => field(x, f)).join('')) + '</section>').join('');
  const facts = [['asked by', 'a session'], ['asked', dateOf(m.at) + ' ' + clock(m.at)], ['why', m.reason], ['measured', m.text]]
    .map(([k, v]) => '<dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd>').join('');
  return '<div class="rec-h"><span class="id" style="font-size:15px">Override #' + m.request + '</span><span class="chip">' + esc(OVERRIDE_CHIP[m.kind] || m.kind) + '</span>'
    + (m.reversal ? '<span class="chip stale">a reversal of a ruling, asked alone</span>' : '') + (m.stale ? '<span class="chip stale">' + esc(m.stale) + '</span>' : '') + '</div>'
    + '<h1>' + esc(m.summary) + '</h1>'
    + '<p class="lede">' + esc(overrideWords(m)) + '. Allow or Keep it on the card or the band in the app; this page only reads.</p>'
    + '<section class="panel" style="margin-bottom:14px"><dl class="facts">' + facts + '</dl>'
    + (m.unreached ? '<p class="dim" style="margin:10px 0 0">A scrub cannot reach ' + esc(m.unreached.join('; ')) + '. If it was a secret, rotate it.</p>' : '') + '</section>'
    + '<div style="display:flex;flex-direction:column;gap:14px">' + recs + '</div>';
}

/* ---- the open set, search, sign in, not found -------------------------------------- */

/* Each item's second line: what it waits on you for, where it sits and since when. */
function needMeta(i) {
  const where = i.kind === 'question' ? (i.ws ? [i.ws] : []) : i.wsIds;
  const head = i.kind === 'question' ? (i.blocking ? '<span class="amber">blocks on you</span>' : 'waits on you')
    : i.kind === 'handoff' ? 'waits on you, from handoff ' + idLink(i.handoff, '', i.handoffKey) + ' on ' + idLink(i.id, '', i.key)
      : pressWords(i) + (i.kind === 'override' ? ', ' + plural(i.count, 'record', 'records') : '');
  const at = i.kind === 'question' ? i.created : i.at;
  return [head, where.length ? linkLabels(esc(where.join(', '))) : '', i.kind === 'question' && i.project ? esc(i.project) : '', at ? esc(shortDate(at)) : '',
    i.kind === 'question' && i.gates.length ? 'holds ' + linkLabels(esc(i.gates.join(', '))) : ''].filter(Boolean).join(' &middot; ');
}

export function needsYouPage(kit, m) {
  const rows = m.items.map((i) => '<li><div>' + needLine(i) + '</div><div class="t2 dim">' + needMeta(i) + '</div></li>').join('');
  return '<h1 class="fh" style="display:flex;align-items:center;gap:10px">' + kit.face(m.face, 24) + 'Needs you' + (m.project ? ' in ' + esc(m.project) : '') + '</h1>'
    + '<p class="lede">Everything that waits on you' + (m.project ? ' in this project' : '') + ': open questions, the blocking ones first; what live handoffs say waits on you; '
    + 'then override requests and upkeep\'s calls, which you press on the band in the app.' + (m.project ? ' <a class="link sky" href="/needs-you">Every project</a>.' : '') + '</p>'
    + '<section class="panel">' + (rows ? '<ul class="hits">' + rows + '</ul>' : '<p class="empty">Nothing waits on you.</p>') + '</section>';
}

export function searchPage(kit, m) {
  const rows = m.hits.map((h) => '<li><div>' + idLink(h.id, 'id', h.key) + ' <span class="chip">' + esc(h.kind) + '</span> ' + esc(h.name) + '</div>'
    + (h.status || h.note ? '<div class="t2 dim">' + esc([h.status, h.note ? 'found in its journal' : ''].filter(Boolean).join(', ')) + '</div>' : '') + '</li>').join('');
  return '<h1>Search</h1><form class="find" action="/search" role="search" style="margin:0 0 16px"><input type="search" name="q" value="' + esc(m.text) + '" aria-label="Search the board" autofocus></form>'
    + '<section class="panel">' + (m.text ? (rows ? '<ul class="hits">' + rows + '</ul>' : '<p class="empty">Nothing matches ' + esc(m.text) + '.</p>') : '<p class="empty">Type words to find, or a label such as T-79.</p>') + '</section>';
}

/* The ways to a login link; one place, so the tray and CLI wording stays in step. */
export const SIGN_IN_STEPS = [
  'On a PC that has this board\'s device token, open the board from the AskerDo tray, or run askerdo login there.',
  'The link opens this page signed in, and the browser stays signed in for 90 days.',
  'For your phone, run askerdo login --print on the PC and open the link it prints on the phone within five minutes: each link works once.',
];

export function signInPage(kit) {
  return '<div class="signin"><h1 style="display:flex;align-items:center;gap:10px">' + kit.face('app', 24) + 'Sign in to the board</h1>'
    + '<p class="lede">This browser has no login yet, so the board shows nothing.</p><ol>' + SIGN_IN_STEPS.map((s) => '<li>' + esc(s) + '</li>').join('') + '</ol></div>';
}

export function notFoundPage(kit, what) {
  return '<h1>Nothing here</h1><p class="lede">' + esc(what) + '</p><p><a class="link sky" href="/">Back to the overview</a></p>';
}
