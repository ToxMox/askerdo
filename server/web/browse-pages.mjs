/* The browse pages: the activity feed in the app's words, and the rulings by
   workstream, then by project for those with none. Plain HTML, the board's panels and type. */
import { esc } from './draw.mjs';
import { RULINGS_PAGE } from './browse.mjs';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const r = (keyOrLabel) => '/r/' + encodeURIComponent(keyOrLabel);
const idLink = (label, key) => '<a class="id" href="' + r(key || label) + '">' + esc(label) + '</a>';
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
const qs = (pairs) => {
  const s = pairs.filter(([, v]) => v !== '' && v !== null && v !== undefined).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
  return s ? '?' + s : '';
};

/* A day-only stamp is that local day, not UTC midnight; the year shows when it is not this one. */
function dayText(at, now) {
  const s = String(at || '');
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return '';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(s);
  if (!Number.isFinite(d.getTime())) return m[0];
  return MON[d.getMonth()] + ' ' + d.getDate() + (d.getFullYear() === new Date(now).getFullYear() ? '' : ', ' + d.getFullYear());
}

/* ---- the activity feed ------------------------------------------------------------- */

export function activityPage(kit, m) {
  const ws = m.ws ? m.ws.id : '';
  const bar = '<div class="wsbar"><a href="/activity"' + (ws ? '' : ' class="on"') + '>Every workstream</a>'
    + m.bar.map((w) => '<a href="/activity' + qs([['ws', w.id]]) + '"' + (w.id === ws ? ' class="on"' : '') + ' title="' + esc(w.name) + '">' + esc(w.id) + '</a>').join('') + '</div>';
  const days = [];
  for (const row of m.rows) {
    if (row.heading) { days.push({ heading: row.heading, items: [] }); continue; }
    const id = row.key ? idLink(row.id, row.key) : '<span class="id">' + esc(row.id) + '</span>';
    days[days.length - 1].items.push('<li><div><span class="dim num">' + esc(row.time) + '</span> ' + id + ' ' + esc(row.name) + '</div>'
      + '<div class="dim" style="font-size:13.5px">' + esc(row.what) + '</div></li>');
  }
  const feed = days.length
    ? '<div class="col">' + days.map((d) => '<section class="panel"><h2>' + esc(d.heading) + '</h2><ul class="hits">' + d.items.join('') + '</ul></section>').join('') + '</div>'
    : '<section class="panel"><p class="empty">' + (m.before ? 'Nothing older.' : 'Nothing has happened here yet.') + '</p></section>';
  const pager = [m.before ? '<a class="link sky" href="/activity' + qs([['ws', ws]]) + '">Newest</a>' : '',
    m.older ? '<a class="link sky" href="/activity' + qs([['ws', ws], ['before', m.older]]) + '">Older</a>' : ''].filter(Boolean);
  return bar + '<h1>Activity' + (m.ws ? ' in ' + esc(m.ws.name || m.ws.id) : '') + '</h1>'
    + '<p class="lede">What changed on the board, newest first, in the words the app\'s Home uses.'
    + (m.ws ? ' <a class="link sky" href="/ws/' + encodeURIComponent(ws) + '">' + esc(ws) + '\'s map</a> &middot; <a class="link sky" href="/rulings' + qs([['ws', ws]]) + '">its rulings</a>.' : '') + '</p>'
    + feed + (pager.length ? '<p style="display:flex;gap:18px;margin-top:16px">' + pager.join('') + '</p>' : '');
}

/* ---- the rulings ------------------------------------------------------------------- */

const KIND_TABS = [['', 'Everything'], ['question', 'Answered questions'], ['decision', 'Decisions'], ['knowledge', 'Knowledge']];

function kindBar(m, param) {
  return '<div class="wsbar">' + KIND_TABS.map(([k, name]) => '<a href="/rulings' + qs([param || ['', ''], ['kind', k]]) + '"'
    + (k === m.kind ? ' class="on"' : '') + '>' + name + '</a>').join('') + '</div>';
}

function countsText(c) {
  return [c.question ? plural(c.question, 'answered question', 'answered questions') : '', c.decision ? plural(c.decision, 'decision', 'decisions') : '',
    c.knowledge ? plural(c.knowledge, 'knowledge record', 'knowledge records') : ''].filter(Boolean).join(', ');
}

/* One row: the label and name, then what it is, when, and the pick's or the ruling's words. */
function rulingRow(x, now) {
  const what = x.kind === 'question' ? 'answered ' + dayText(x.at, now) : (x.kind === 'decision' ? 'decision' : x.type || 'knowledge') + (x.at ? ', ' + dayText(x.at, now) : '');
  const words = x.words ? ': ' + esc(x.words.length > 220 ? x.words.slice(0, 217).replace(/\s+\S*$/, '') + '...' : x.words) : '';
  return '<li><div>' + idLink(x.id, x.key) + ' ' + esc(x.name) + (x.status === 'superseded' ? ' <span class="chip">superseded</span>' : '') + '</div>'
    + '<div class="dim" style="font-size:13.5px">' + esc(what) + words + '</div></li>';
}

const groupHref = (g, kind) => '/rulings' + qs([g.param, ['kind', kind]]);
const groupTitle = (g) => (g.kind === 'ws' ? esc(g.name) : g.kind === 'project' ? esc(g.name) + ', with no workstream' : esc(g.name) + (g.kind === 'global' ? ', with no workstream' : ''));

function groupCard(g, m, now) {
  return '<article class="wsc" data-href="' + esc(groupHref(g, m.kind)) + '"><div class="wsc-h">' + (g.id ? '<span class="id">' + esc(g.id) + '</span>' : '')
    + '<h2><a href="' + esc(groupHref(g, m.kind)) + '">' + esc(g.name) + '</a>' + (g.kind === 'ws' && !g.open ? ' <span class="chip">closed</span>' : '') + '</h2></div>'
    + '<ul class="hits">' + g.rows.map((x) => rulingRow(x, now)).join('') + '</ul>'
    + '<div class="wsc-f"><span>' + esc(countsText(g.counts)) + (g.total > g.rows.length ? ' &middot; <a class="link sky" href="' + esc(groupHref(g, m.kind)) + '">all ' + g.total + '</a>' : '') + '</span></div></article>';
}

export function rulingsPage(kit, m, now = Date.now()) {
  if (m.group) {
    const g = m.group;
    const pager = [m.page > 1 ? '<a class="link sky" href="/rulings' + qs([g.param, ['kind', m.kind], ['page', m.page > 2 ? m.page - 1 : '']]) + '">Newer</a>' : '',
      m.page < m.pages ? '<a class="link sky" href="/rulings' + qs([g.param, ['kind', m.kind], ['page', m.page + 1]]) + '">Older</a>' : ''].filter(Boolean);
    return kindBar(m, g.param) + '<h1>Rulings' + (g.kind === 'ws' ? ' in <span class="id">' + esc(g.id) + '</span> ' : ' in ') + groupTitle(g) + '</h1>'
      + '<p class="lede">' + (g.total ? esc(countsText(g.counts)) + ', newest first' + (m.pages > 1 ? ', page ' + m.page + ' of ' + m.pages + ' (' + RULINGS_PAGE + ' a page)' : '') + '.' : 'Nothing here yet.')
      + ' <a class="link sky" href="/rulings' + qs([['kind', m.kind]]) + '">Every group</a>'
      + (g.kind === 'ws' ? ' &middot; <a class="link sky" href="/ws/' + encodeURIComponent(g.id) + '">' + esc(g.id) + '\'s map</a> &middot; <a class="link sky" href="/activity' + qs([['ws', g.id]]) + '">its activity</a>' : '') + '</p>'
      + (m.rows.length ? '<section class="panel"><ul class="hits">' + m.rows.map((x) => rulingRow(x, now)).join('') + '</ul></section>' : '')
      + (pager.length ? '<p style="display:flex;gap:18px;margin-top:16px">' + pager.join('') + '</p>' : '');
  }
  const ws = m.groups.filter((g) => g.kind === 'ws');
  const rest = m.groups.filter((g) => g.kind !== 'ws');
  return kindBar(m) + '<h1>Rulings</h1>'
    + '<p class="lede">What was settled: answered questions with the pick\'s words, decisions and knowledge, by workstream and newest first; then the ones with no workstream, by project. Press a group for all of it.</p>'
    + (ws.length ? '<div class="cards">' + ws.map((g) => groupCard(g, m, now)).join('') + '</div>' : '<p class="empty">No workstream has a ruling yet.</p>')
    + (rest.length ? '<h2 class="eyebrow" style="margin:26px 0 12px">No workstream</h2><div class="cards">' + rest.map((g) => groupCard(g, m, now)).join('') + '</div>' : '');
}
