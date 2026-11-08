/* The redrawn workstream picture: the approved mock's drawing
    at three zoom levels, every idea on, for
   the board page and the pane. Pure: P is picture-model.mjs's data, text widths come from the caller. */
import { ENDED_NEXT, PANE_DARK, PANE_FONT, PANE_LIGHT, esc } from './draw.mjs';

/* ================= skins: the web board's and the pane's colours and type ================= */
var WEB = { font: 'Geist, "Segoe UI", system-ui, sans-serif', title: 16, name: 15, small: 12.5, idfs: 11.5, lh: 19.5, slh: 17,
  c: { bg: '#141428', text: '#EAEDF5', sec: '#9BA3B5', dim: '#737C92', line: '#59637E', sky: '#26C3FF', ready: '#4CC9FF', wait: '#7E89A6', cross: '#9BB0D3', crit: '#F4F6FB',
    amber: '#FFD966', lav: '#C4B5FD', card: 'rgba(255,255,255,0.045)', card2: 'rgba(255,255,255,0.075)', skyBg: 'rgba(38,195,255,0.10)', lavBg: 'rgba(196,181,253,0.07)',
    amberBg: 'rgba(255,217,102,0.08)', edge: 'rgba(255,255,255,0.13)', edge2: 'rgba(255,255,255,0.24)', link: '#4CC9FF' } };
// the pane's colours are p-<name> tokens its own style resolves per theme; an img's Svg loads no web font
var PANE_KEYS = ['bg', 'text', 'sec', 'dim', 'line', 'sky', 'ready', 'wait', 'cross', 'crit', 'amber', 'lav'];
var PANE_MORE = {
  dark: { card: 'rgba(255,255,255,0.035)', card2: 'rgba(255,255,255,0.07)', skyBg: 'rgba(38,195,255,0.10)', lavBg: 'rgba(185,174,240,0.07)', amberBg: 'rgba(219,147,0,0.10)',
    edge: 'rgba(255,255,255,0.12)', edge2: 'rgba(255,255,255,0.22)', link: '#6da7ec' },
  light: { card: 'rgba(11,11,11,0.03)', card2: 'rgba(11,11,11,0.06)', skyBg: 'rgba(2,132,199,0.08)', lavBg: 'rgba(109,91,208,0.07)', amberBg: 'rgba(166,106,0,0.08)',
    edge: 'rgba(11,11,11,0.12)', edge2: 'rgba(11,11,11,0.24)', link: '#184f95' }
};
var PANE = { font: PANE_FONT, title: 15, name: 14, small: 12, idfs: 11, lh: 19, slh: 16.5, c: {} };
PANE_KEYS.concat(Object.keys(PANE_MORE.dark)).forEach(function (k) { PANE.c[k] = 'p-' + k; });
function paneColours(dark) {
  var o = {}, base = dark ? PANE_DARK : PANE_LIGHT;
  PANE_KEYS.forEach(function (k) { o[k] = base[k]; });
  return Object.assign(o, PANE_MORE[dark ? 'dark' : 'light']);
}
// a skin's type and colours: 'web' and 'narrow' (the phone) share the board's face
export function skinOf(skin) { return skin === 'pane' ? PANE : WEB; }

// a press zone's hover tint lies behind what it holds, as the pane's press lights; a press inside another lights alone
var CLS = '.apic .hit{cursor:pointer}.apic .hz{transition:fill .12s}.apic .hit:hover>.hz{fill:rgba(160,170,200,.2)}.apic .hit:has(.hit:hover)>.hz{fill:transparent}.apic .lit,.apic .dimmed{transition:opacity .15s}.apic .dimmed{opacity:.22}.apic .pk{opacity:.62}.apic .pk.lit,.apic .pk.selg{opacity:1}.apic .pk.dimmed{opacity:.16}';
// the picture's own rules: an img's Svg sees no page style; the pane's only for the tokens it uses
function styleOf(skin, inner) {
  if (skin !== 'pane') return '<style>' + CLS + '</style>';
  var used = {}, re = /"p-(\w+)"/g, m;
  while ((m = re.exec(inner))) used[m[1]] = 1;
  var rules = function (C) { return Object.keys(used).filter(function (k) { return C[k]; }).map(function (k) { return '.apic [fill="p-' + k + '"]{fill:' + C[k] + '}.apic [stroke="p-' + k + '"]{stroke:' + C[k] + '}'; }).join(''); };
  return '<style>' + CLS + rules(paneColours(false)) + '@media (prefers-color-scheme: dark){' + rules(paneColours(true)) + '}</style>';
}

/* ================= lookups ================= */
function trackOf(P, id) {
  for (var w in P.ws || {}) { var ts = P.ws[w].tracks || []; for (var i = 0; i < ts.length; i++) if (ts[i].id === id) return ts[i]; }
  return null;
}
function shortName(tr) { return tr.short || tr.name; }
function wsShort(P, id) {
  var o = (P.ov || []).filter(function (x) { return x.id === id; })[0], w = P.ws && P.ws[id];
  return (w && (w.short || w.name)) || (o && (o.short || o.name)) || '';
}
function taskOf(P, id) { return (P.tasks || {})[id] || null; }
function list(v) { return Array.isArray(v) ? v : []; }
function waitsOf(t) { return list(t.waits).concat(list(t.cross)); }
// a track's name on a chip: its chip name, its short name, else its id when another workstream's
// a track's name on a chip drops a lead it shares with its workstream's name, so its chips read apart from its siblings'
function trName(P, trId) {
  var tr = trackOf(P, trId); if (!tr) return trId;
  var s = shortName(tr), w = P.ws && P.ws[tr.ws], lead = w ? [w.name, w.short] : [];
  for (var i = 0; !tr.chip && i < lead.length; i++) if (lead[i] && s.indexOf(lead[i] + ' ') === 0 && s.length - lead[i].length > 6) return s.slice(lead[i].length + 1);
  return tr.chip || s;
}
// what a park waits on: a task it opens on, or the track before it ending
function orderWhen(P, l, nm) { return l.on ? l.on + ' completes' : (nm || trName(P, l.from)) + ' ends'; }
function shortOfTask(P, id) { var t = taskOf(P, id); return t ? trName(P, t.tr) : id; }
function wsOfTrack(P, trId) { var tr = trackOf(P, trId); return tr ? tr.ws : null; }
function joinAnd(a) { return a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]; }
var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function two(n) { return (n < 10 ? '0' : '') + n; }
function lookWords(P) { if (!P.look) return ''; var d = new Date(P.look); return MON[d.getMonth()] + ' ' + d.getDate() + ', ' + two(d.getHours()) + ':' + two(d.getMinutes()); }
function sinceCount(v) { return Array.isArray(v) ? v.length : v || 0; }
// the critical path's steps, each a task and the one after it on the counted chain
function critSteps(Wd) {
  var p = (Wd.crit && Wd.crit.path) || [], s = {};
  for (var i = 1; i < p.length; i++) s[p[i - 1] + '>' + p[i]] = 1;
  return s;
}
function linkCrit(P, Wd, l) {
  var p = (Wd.crit && Wd.crit.path) || [];
  for (var i = 1; i < p.length; i++) { var a = taskOf(P, p[i - 1]), b = taskOf(P, p[i]); if (a && b && a.tr === l.from && b.tr === l.to) return true; }
  return false;
}
function onCrit(P, Wd, trId) { return list(Wd.crit && Wd.crit.path).some(function (x) { var t = taskOf(P, x); return t && t.tr === trId; }); }

/* ================= text ================= */
// a no-break space keeps a count with its word; it measures and draws as a space (the pane's table has none)
function plain(t) { return t.replace(/ /g, ' '); }
function wrap(X, s, maxW, px, wt, maxLines) {
  var fits = function (t) { return X.tw(plain(t), px, wt) <= maxW; };
  // the pieces: words, a long word split after a slash or a hyphen between letters, a piece wider than the room cut
  var segs = [];
  String(s).split(' ').forEach(function (w) {
    w.replace(/(\/)(?=.)|([A-Za-z]-)(?=[A-Za-z])/g, '$1$2|').split('|').forEach(function (p, n) {
      var g = n > 0;
      while (!fits(p) && p.length > 1) { var c = p.length - 1; while (c > 1 && !fits(p.slice(0, c))) c--; segs.push({ t: p.slice(0, c), g: g }); p = p.slice(c); g = true; }
      segs.push({ t: p, g: g });
    });
  });
  segs.forEach(function (x, i) { x.i = i; });
  var join = function (a) { return a.map(function (x, i) { return (i && !x.g ? ' ' : '') + x.t; }).join(''); };
  var lines = [], cur = null;
  segs.forEach(function (x) { if (cur && fits(join(cur.concat([x])))) cur.push(x); else { if (cur) lines.push(cur); cur = [x]; } });
  if (cur) lines.push(cur);
  var out = lines.map(join);
  if (maxLines && lines.length > maxLines) {
    // the last line ends on a whole word and an ellipsis
    var last = lines[maxLines - 1].slice();
    var more = function () { var nx = segs[last[last.length - 1].i + 1]; return nx && nx.g; };
    var mk = function () { return join(last).replace(/[\s,;:.\/-]+$/, '') + '…'; };
    while (last.length > 1 && (!fits(mk()) || more())) last.pop();
    var t = mk(); while (!fits(t) && t.length > 2) t = t.slice(0, -2) + '…';
    out = out.slice(0, maxLines); out[maxLines - 1] = t;
  }
  return out.map(plain);
}
// a name inside a line gives way with an ellipsis, its other words kept; null when under 40 px would be left for it
function giveWay(X, s, nm, maxW, px, wt) {
  var i = nm ? s.indexOf(nm) : -1;
  if (i < 0 || X.tw(s, px, wt) <= maxW) return s;
  var room = maxW - X.tw(s.slice(0, i) + s.slice(i + nm.length), px, wt);
  return room < 40 ? null : s.slice(0, i) + wrap(X, nm, room, px, wt, 1)[0] + s.slice(i + nm.length);
}
function n1(v) { return Math.round(v * 10) / 10; }
function txt(x, y, s, px, fill, o) {
  o = o || {};
  return '<text x="' + n1(x) + '" y="' + n1(y) + '" font-size="' + px + '"' + (o.wt ? ' font-weight="' + o.wt + '"' : '') + ' fill="' + fill + '"' +
    (o.anchor ? ' text-anchor="' + o.anchor + '"' : '') + (o.ls ? ' letter-spacing="' + o.ls + '"' : '') + (o.deco ? ' text-decoration="' + o.deco + '"' : '') + '>' + esc(plain(String(s))) + '</text>';
}
// a press over the thing's whole footprint; on the board its zone, 4 px past each side, also takes the hover (the pane lays its own)
function hitG(X, k, x, y, w, h, extra, rx) {
  X.hits.push({ k: k, x: n1(x), y: n1(y), w: n1(w), h: n1(h) });
  var g = '<g class="hit' + (extra ? ' ' + extra : '') + '" data-k="' + esc(k) + '">';
  if (X.skin === 'pane') return g;
  var x0 = Math.max(0, x - 4), x1 = Math.min(X.W, x + w + 4);
  return g + '<rect class="hz" x="' + n1(x0) + '" y="' + n1(y - 4) + '" width="' + n1(x1 - x0) + '" height="' + n1(h + 8) + '" rx="' + n1((rx || 6) + 4) + '" fill="transparent"/>';
}

/* ================= marks ================= */
function stationMark(t, x, y, C, sel) {
  var s = '';
  if (sel) s += '<circle cx="' + x + '" cy="' + y + '" r="14" fill="none" stroke="' + C.sky + '" stroke-width="2" opacity="0.9"/>';
  if (t.review) {
    var h = 9.5, d = 'M' + x + ' ' + (y - h) + 'L' + (x + h) + ' ' + y + 'L' + x + ' ' + (y + h) + 'L' + (x - h) + ' ' + y + 'Z';
    if (t.st === 'now') return s + '<path d="' + d + '" fill="' + C.sky + '" stroke="' + C.sky + '" stroke-width="2" stroke-linejoin="round"/>';
    return s + '<path d="' + d + '" fill="' + C.bg + '" stroke="' + (t.st === 'ready' ? C.ready : t.st === 'gated' ? C.amber : C.wait) + '" stroke-width="2.4" stroke-linejoin="round"/>';
  }
  if (t.st === 'now') return s + '<circle cx="' + x + '" cy="' + y + '" r="11" fill="' + C.sky + '" opacity="0.22"/><circle cx="' + x + '" cy="' + y + '" r="7.5" fill="' + C.sky + '"/>';
  if (t.st === 'held' || t.st === 'left') return s + '<circle cx="' + x + '" cy="' + y + '" r="7.5" fill="' + C.bg + '" stroke="' + C.sky + '" stroke-width="2.2"/><path d="M' + x + ' ' + (y - 5.5) + 'A5.5 5.5 0 0 0 ' + x + ' ' + (y + 5.5) + 'Z" fill="' + C.sky + '"/>';
  if (t.st === 'ready') return s + '<circle cx="' + x + '" cy="' + y + '" r="7.5" fill="' + C.bg + '" stroke="' + C.ready + '" stroke-width="2.6"/>';
  // waiting on an answer of yours: amber, as today's map draws it
  if (t.st === 'gated') return s + '<circle cx="' + x + '" cy="' + y + '" r="7.5" fill="' + C.bg + '" stroke="' + C.amber + '" stroke-width="2.6"/><circle cx="' + x + '" cy="' + y + '" r="2.2" fill="' + C.amber + '"/>';
  if (t.st === 'done') return s + '<circle cx="' + x + '" cy="' + y + '" r="6.5" fill="' + C.bg + '" stroke="' + C.wait + '" stroke-width="2"/><circle cx="' + x + '" cy="' + y + '" r="10" fill="none" stroke="' + C.crit + '" stroke-width="1.3"/>';
  return s + '<circle cx="' + x + '" cy="' + y + '" r="6.5" fill="' + C.bg + '" stroke="' + C.wait + '" stroke-width="2.2"/>';
}
// a mark drawn at k of its size about its anchor: the rails draw them at two thirds
function scaled(s, x, y, k) { return k === 1 ? s : '<g transform="matrix(' + k + ' 0 0 ' + k + ' ' + n1((1 - k) * x) + ' ' + n1((1 - k) * y) + ')">' + s + '</g>'; }
// a session is the engine; each agent it runs is a car
function engine(x, y, C) {
  return '<g><rect x="' + x + '" y="' + (y - 6) + '" width="22" height="12" rx="4" fill="' + C.sky + '"/><rect x="' + (x + 13) + '" y="' + (y - 3.5) + '" width="6" height="4" rx="1" fill="#04131d"/>' +
    '<path d="M' + (x + 22) + ' ' + (y - 4) + 'L' + (x + 26) + ' ' + y + 'L' + (x + 22) + ' ' + (y + 4) + 'Z" fill="' + C.sky + '"/></g>';
}
function car(x, y, C) { return '<g><rect x="' + x + '" y="' + (y - 5) + '" width="15" height="10" rx="3" fill="' + C.sky + '" opacity="0.85"/><rect x="' + (x + 4) + '" y="' + (y - 2.5) + '" width="7" height="3.5" rx="1" fill="#04131d"/></g>'; }
function trainSvg(x, y, agents, C) {
  var s = '', cx = x;
  for (var i = 0; i < agents; i++) { s += car(cx, y, C); cx += 18; }
  return s + engine(cx, y, C);
}
function ansChip(X, x, y, a, k) {
  var C = X.C, sk = X.sk, w = X.tw(a.tok, sk.small, 650) + 26;
  return (k ? hitG(X, k, x, y - 11, w, 22, '', 11) : '<g>') + '<rect x="' + n1(x) + '" y="' + n1(y - 11) + '" width="' + n1(w) + '" height="22" rx="11" fill="' + C.bg + '" stroke="' + C.edge2 + '"/>' +
    '<path d="M' + n1(x + 8) + ' ' + n1(y - 4) + 'h9a2 2 0 0 1 2 2v4a2 2 0 0 1 -2 2h-5l-3 2.5v-2.5h-1a2 2 0 0 1 -2 -2v-4a2 2 0 0 1 2 -2z" fill="none" stroke="' + C.sec + '" stroke-width="1.3" stroke-linejoin="round"/>' +
    txt(x + 22, y + 4.3, a.tok, sk.small, C.sec, { wt: 650 }) + '</g>';
}
function ansW(X, a) { return X.tw(a.tok, X.sk.small, 650) + 26; }
function badge(X, x, y, s, o) {
  o = o || {};
  var C = X.C, sk = X.sk, w = X.tw(s, sk.small, 650) + 16;
  return (o.k ? hitG(X, o.k, x - w / 2, y - 11, w, 22, '', 11) : '<g>') + '<rect x="' + n1(x - w / 2) + '" y="' + n1(y - 11) + '" width="' + n1(w) + '" height="22" rx="11" fill="' + C.bg + '" stroke="' + (o.stroke || C.cross) + '" stroke-width="1.3"/>' +
    txt(x, y + 4.3, s, sk.small, o.fill || C.text, { wt: 650, anchor: 'middle' }) + '</g>';
}
function freshTag(X, x, y, s) {
  var C = X.C, sk = X.sk, w = X.tw(s, sk.idfs, 700) + 12;
  // the see-through tint lies on the ground's colour, so a pill's edge under the tag never strikes its words
  return '<g><rect x="' + n1(x) + '" y="' + n1(y - 9) + '" width="' + n1(w) + '" height="16" rx="8" fill="' + C.bg + '"/><rect x="' + n1(x) + '" y="' + n1(y - 9) + '" width="' + n1(w) + '" height="16" rx="8" fill="' + C.skyBg + '" stroke="' + C.sky + '" stroke-width="1"/>' + txt(x + 6, y + 3, s, sk.idfs, C.sky, { wt: 700 }) + '</g>';
}
// a real assets/ face nested as an svg window: an img-drawn Svg loads no outside href
function iconSvg(X, name, x, y, size) {
  var src = X.icons && X.icons[name];
  if (!src) return '';
  var pre = 'pic' + (++X.nIcon) + '-';
  var body = String(src).replace(/<!--[\s\S]*?-->/g, '').replace(/<\?xml[\s\S]*?\?>/g, '').replace(/<title>[\s\S]*?<\/title>/g, '');
  body = body.replace(/\bid="([^"]+)"/g, 'id="' + pre + '$1"').replace(/url\(#([^)]+)\)/g, 'url(#' + pre + '$1)').replace(/href="#([^"]+)"/g, 'href="#' + pre + '$1"');
  return body.replace(/<svg\b[^>]*>/, function (tag) {
    var vb = (tag.match(/viewBox="([^"]+)"/) || [])[1] || '0 0 64 64';
    return '<svg x="' + n1(x) + '" y="' + n1(y) + '" width="' + size + '" height="' + size + '" viewBox="' + vb + '"' + (/\sfill="none"/.test(tag) ? ' fill="none"' : '') + '>';
  }).trim();
}

/* ================= the trace: what a selection waits on and frees ================= */
export function traceSet(P, V, key) {
  var lit = {}, T = P.tasks || {};
  if (!key) return null;
  var i = key.indexOf(':'), kind = key.slice(0, i), id = key.slice(i + 1);
  lit[key] = 1;
  if (kind === 'stn') {
    var up = [id], dn = [id];
    while (up.length) { var u = T[up.pop()]; if (u) waitsOf(u).forEach(function (w) { if (!lit['stn:' + w]) { lit['stn:' + w] = 1; up.push(w); } }); }
    while (dn.length) { var d = T[dn.pop()]; if (d) list(d.frees).forEach(function (f) { if (!lit['stn:' + f]) { lit['stn:' + f] = 1; dn.push(f); } }); }
    Object.keys(lit).forEach(function (k) { var tt = T[k.slice(4)]; if (tt) lit['tr:' + tt.tr] = 1; });
  } else if (kind === 'pill') {
    var W = P.ws[V.ws] || { links: [] }, seen = {}; seen[id] = 1;
    var walk = function (dir) {
      var st = [id];
      while (st.length) { var c = st.pop(); list(W.links).forEach(function (l) { var a = dir ? l.from : l.to, b = dir ? l.to : l.from; if (a === c && !seen[b]) { seen[b] = 1; st.push(b); } }); }
    };
    walk(true); walk(false);
    Object.keys(seen).forEach(function (t) { lit['pill:' + t] = 1; });
    list(W.links).forEach(function (l) { if (seen[l.from] && seen[l.to]) lit['link:' + l.from + '>' + l.to] = 1; });
  } else if (kind === 'link') {
    var ab = id.split('>'); lit['pill:' + ab[0]] = 1; lit['pill:' + ab[1]] = 1;
  } else if (kind === 'wlink') {
    var wb = id.split('>'); lit['ws:' + wb[0]] = 1; lit['ws:' + wb[1]] = 1; lit['wl:' + id] = 1;
  } else if (kind === 'ws') {
    lit['ws:' + id] = 1;
    list(P.ovLinks).forEach(function (l) { if (l.from === id || l.to === id) { lit['ws:' + l.from] = 1; lit['ws:' + l.to] = 1; lit['wl:' + l.from + '>' + l.to] = 1; } });
  }
  return lit;
}
// the class an item draws with: lit, dimmed, or plain
function cls(key, lit, extra) {
  var c = extra ? [extra] : [];
  if (lit) c.push(lit[key] ? 'lit' : 'dimmed');
  return c.length ? ' class="' + c.join(' ') + '"' : '';
}

/* ================= level 0: the Overview, one pill per workstream ================= */
// chains of waits between workstreams sit together, the waited-on first, on one row where they fit
function ovOrder(P, cols) {
  var ov = list(P.ov), idx = {}, root = {};
  ov.forEach(function (o, i) { idx[o.id] = i; root[o.id] = o.id; });
  var find = function (a) { while (root[a] !== a) a = root[a] = root[root[a]]; return a; };
  var links = list(P.ovLinks).filter(function (l) { return idx[l.from] !== undefined && idx[l.to] !== undefined && l.from !== l.to; });
  links.forEach(function (l) { root[find(l.from)] = find(l.to); });
  var comp = {};
  ov.forEach(function (o) { (comp[find(o.id)] = comp[find(o.id)] || []).push(o.id); });
  var chainOf = function (id) {
    var m = comp[find(id)], done = {}, out = [];
    // the one joined to the last placed comes next, so a chain's waits join neighbours
    var apart = function (x) { var p = out[out.length - 1]; return links.some(function (l) { return (l.from === p && l.to === x) || (l.to === p && l.from === x); }) ? 0 : 1; };
    while (out.length < m.length) {
      var next = m.filter(function (x) { return !done[x] && !links.some(function (l) { return l.to === x && !done[l.from] && m.indexOf(l.from) >= 0; }); });
      if (!next.length) next = m.filter(function (x) { return !done[x]; });
      next.sort(function (a, b) { return apart(a) - apart(b) || idx[a] - idx[b]; });
      done[next[0]] = 1; out.push(next[0]);
    }
    return out;
  };
  var placed = {}, order = [];
  var single = function (o) { return comp[find(o.id)].length === 1; };
  ov.forEach(function (o) {
    if (placed[o.id]) return;
    if (single(o)) { placed[o.id] = 1; order.push(o); return; }
    var ch = chainOf(o.id);
    // a row with too little room left for the chain is filled first
    while (cols > 1 && ch.length <= cols && (order.length % cols) + ch.length > cols) {
      var f = ov.filter(function (x) { return !placed[x.id] && single(x); })[0];
      if (!f) break;
      placed[f.id] = 1; order.push(f);
    }
    ch.forEach(function (id) { placed[id] = 1; order.push(ov[idx[id]]); });
  });
  return order;
}
/* the waits between workstreams: s is a link's upper (or left) end; h joins neighbours on a row straight, u runs
   from the pills' bottom and top edges through lanes in the gaps between rows, and past a row down a gap between
   columns (in one column, a lane kept at the right); a pair waiting both ways is two lines, each with its count */
function ovLinks(X, order, cols, gap) {
  var f = X.tw, sk = X.sk, has = {}, cell = {}, chans = 0;
  order.forEach(function (o, i) { has[o.id] = 1; cell[o.id] = { r: Math.floor(i / cols), c: i % cols }; });
  var lk = list(X.P.ovLinks).filter(function (l) { return has[l.from] && has[l.to] && l.from !== l.to; }).map(function (l) {
    var n = l.n || list(l.pairs).length || 1, s = n + (n === 1 ? ' wait' : ' waits'), a = cell[l.from], b = cell[l.to];
    var fwd = a.r < b.r || (a.r === b.r && a.c < b.c);
    return { l: l, txt: s, bw: f(s, sk.small, 650) + 16, s: fwd ? l.from : l.to, t: fwd ? l.to : l.from };
  });
  lk.forEach(function (k) {
    var s = cell[k.s], t = cell[k.t], m = lk.filter(function (o) { return o.s === k.s && o.t === k.t; });
    k.rank = m.indexOf(k); k.nm = m.length;
    k.kind = s.r === t.r && t.c - s.c === 1 ? 'h' : 'u';
    if (k.kind === 'u' && t.r - s.r > 1) k.ch = cols === 1 ? chans++ : -1;
  });
  return { lk: lk, cell: cell, reserve: chans ? 14 * chans + 6 : 0, bwMax: Math.max.apply(null, [0].concat(lk.map(function (k) { return k.bw; }))) };
}
// each u link's ports on its pills' edges and its runs in the gaps; returns the lanes each gap holds
function ovRoute(R, cols, rows, pw, gap, x0) {
  var lk = R.lk, cell = R.cell, X0 = function (id) { return x0 + cell[id].c * (pw + gap); }, mid = function (id) { return X0(id) + pw / 2; };
  // past a row a line takes the gap between columns nearest its ends where no count of a row in between stands
  var inGap = {};
  lk.forEach(function (k) {
    if (k.ch === -1) {
      var s = cell[k.s], t = cell[k.t], want = (mid(k.s) + mid(k.t)) / 2, best = null;
      for (var j = 0; j < cols - 1; j++) {
        var gx = x0 + (j + 1) * pw + j * gap + gap / 2;
        var busy = lk.some(function (h) { return h.kind === 'h' && cell[h.s].c === j && cell[h.s].r > s.r && cell[h.s].r < t.r; });
        var score = Math.abs(gx - want) + (busy ? 1e4 : 0);
        if (!best || score < best.score) best = { j: j, gx: gx, score: score };
      }
      (inGap[best.j] = inGap[best.j] || []).push(k); k.cx = best.gx;
    } else if (k.ch >= 0) k.cx = x0 + pw + 10 + 14 * k.ch;
  });
  Object.keys(inGap).forEach(function (j) { var g = inGap[j]; g.forEach(function (k, i) { k.cx += (i - (g.length - 1) / 2) * 10; }); });
  // ports spread along an edge in the order their lines leave; a pair's two lines keep one order at both ends, so they never cross
  var ports = {};
  lk.forEach(function (k) {
    if (k.kind === 'h') return;
    var same = cell[k.s].r === cell[k.t].r, key = same ? null : mid(k.t) > mid(k.s) ? -k.rank : k.rank;
    (ports[k.s + 'b'] = ports[k.s + 'b'] || []).push({ k: k, end: 'ps', ox: k.cx !== undefined ? k.cx : mid(k.t), key: same ? -k.rank : key });
    (ports[k.t + (same ? 'b' : 't')] = ports[k.t + (same ? 'b' : 't')] || []).push({ k: k, end: 'pt', ox: k.cx !== undefined ? k.cx : mid(k.s), key: same ? k.rank : key });
  });
  Object.keys(ports).forEach(function (pk) {
    var es = ports[pk].sort(function (p, q) { return p.ox - q.ox || p.key - q.key; }), c = mid(pk.slice(0, -1)), n = es.length;
    // lines straight down to the pill under keep a count's width apart, each count on its own line
    var sp = es.some(function (e) { return Math.abs(e.ox - c) < 1; }) ? R.bwMax + 10 : 26;
    sp = Math.min(sp, (pw - 60) / Math.max(1, n - 1));
    es.forEach(function (e, i) { e.k[e.end] = c + (i - (n - 1) / 2) * sp; });
  });
  // the runs; the count rides the longest, and runs sharing a gap take lanes apart where they or their counts meet
  var gaps = []; for (var g = 0; g < rows; g++) gaps.push([]);
  lk.forEach(function (k) {
    if (k.kind === 'h') return;
    var s = cell[k.s], t = cell[k.t];
    k.runs = k.cx === undefined ? [{ g: s.r, a: k.ps, b: k.pt }] : [{ g: s.r, a: k.ps, b: k.cx }, { g: t.r - 1, a: k.cx, b: k.pt }];
    k.runs.reduce(function (m, u) { return Math.abs(u.b - u.a) > Math.abs(m.b - m.a) ? u : m; }).count = true;
    k.runs.forEach(function (u) {
      var m = (u.a + u.b) / 2;
      u.lo = Math.min(u.a, u.b, u.count ? m - k.bw / 2 : Infinity); u.hi = Math.max(u.a, u.b, u.count ? m + k.bw / 2 : -Infinity);
      u.k = k; gaps[u.g].push(u);
    });
  });
  return gaps.map(function (us) {
    var lanes = [];
    us.sort(function (p, q) { return (p.hi - p.lo) - (q.hi - q.lo) || p.k.rank - q.k.rank; }).forEach(function (u) {
      var i = 0;
      while (lanes[i] && lanes[i].some(function (v) { return u.lo < v.hi + 8 && v.lo < u.hi + 8; })) i++;
      (lanes[i] = lanes[i] || []).push(u); u.i = i;
    });
    return lanes.length;
  });
}
function drawOverview(X) {
  var P = X.P, V = X.V, sk = X.sk, C = X.C, W = X.W, f = X.tw;
  var pad = W < 420 ? 10 : 18, top = X.top + 2, gap = W < 420 ? 30 : 46, rowGap = 40;
  var pw = Math.min(250, W - 2 * pad), cols = Math.max(1, Math.floor((W - 2 * pad + gap) / (pw + gap)));
  var order = ovOrder(P, cols), R = ovLinks(X, order, cols, gap);
  // a count between two pills of a row stands clear of both: the gap widens, the pills narrow
  if (R.bwMax) gap = Math.max(gap, R.bwMax + 16);
  if (cols > 1 && (W - 2 * pad - (cols - 1) * gap) / cols < 220) { cols--; order = ovOrder(P, cols); R = ovLinks(X, order, cols, gap); }
  // one column takes the whole width, less a lane for each wait that skips a pill
  pw = cols > 1 ? Math.min(260, (W - 2 * pad - (cols - 1) * gap) / cols) : W - 2 * pad - R.reserve;
  var inner = pw - 40, lit = X.lit;
  var blocks = order.map(function (o) {
    var title = wrap(X, o.name, inner, sk.title, 600, 2), extra = [];
    if (o.gated) extra = wrap(X, 'Waits on your answer: ' + o.gated, inner - 22, sk.small, 600, 2);
    else if (o.needs) extra = wrap(X, 'Needs you: ' + o.needs, inner - 22, sk.small, 600, 2);
    // the state words take their own line when they do not fit beside the id
    var own = f(o.id, sk.idfs, 700) + 8 + f(o.words, sk.small, 500) > pw - 48;
    // the inbox's due count reads amber, as the workstream page's: after the counts where it fits, else on its own row
    var due = o.due && o.counts.slice(-(o.due.length + 2)) === ', ' + o.due ? o.due : '';
    var counts = wrap(X, due ? o.counts.slice(0, -(due.length + 2)) : o.counts, inner, sk.small, 400, 2);
    var dueOwn = !!due && f(counts[counts.length - 1] + ', ' + due, sk.small, 400) > inner;
    return { o: o, title: title, extra: extra, own: own, counts: counts, due: due, dueOwn: dueOwn };
  });
  var ph = 0, bh = function (b) { return 18 + 16 + (b.own ? sk.slh : 0) + b.title.length * sk.lh + sk.slh * (b.counts.length + 1 + (b.dueOwn ? 1 : 0)) + (b.extra.length ? 8 + b.extra.length * sk.slh : 0) + 14; };
  blocks.forEach(function (b) { b.h = bh(b); ph = Math.max(ph, b.h); });
  // pills of a row share the tallest's height, a title taking the rows it leaves; in one column each pill keeps its own
  if (cols > 1) blocks.forEach(function (b) { var spare = Math.floor((ph - b.h) / sk.lh); if (spare > 0 && b.title.length === 2) b.title = wrap(X, b.o.name, inner, sk.title, 600, 2 + spare); });
  var rowH = function (r) { return cols === 1 ? blocks[r].h : ph; };
  var pos = {}, rows = Math.ceil(order.length / cols), out = [], links = [], counts = [];
  var used = cols * pw + (cols - 1) * gap, x0 = Math.max(pad, (W - used - R.reserve) / 2);
  // a gap between rows grows with the lanes its lines take
  var nL = ovRoute(R, cols, rows, pw, gap, x0), hG = nL.map(function (n) { return Math.max(rowGap, n * 28 + 12); }), rowY = [top];
  for (var r = 1; r < rows; r++) rowY.push(rowY[r - 1] + rowH(r - 1) + hG[r - 1]);
  blocks.forEach(function (b) { var c = R.cell[b.o.id]; pos[b.o.id] = { x: x0 + c.c * (pw + gap), y: rowY[c.r], w: pw, h: rowH(c.r) }; });
  R.lk.forEach(function (k) {
    var a = pos[k.s], b = pos[k.t];
    if (k.kind === 'h') { var y = a.y + a.h / 2 + (k.rank - (k.nm - 1) / 2) * 28; k.pts = [[a.x + a.w, y], [b.x, y]]; k.at = [(a.x + a.w + b.x) / 2, y]; return; }
    var pts = [[k.ps, a.y + a.h]];
    k.runs.forEach(function (u) { u.y = rowY[u.g] + rowH(u.g) + (hG[u.g] - nL[u.g] * 28) / 2 + 14 + u.i * 28; pts.push([u.a, u.y], [u.b, u.y]); });
    pts.push([k.pt, R.cell[k.t].r > R.cell[k.s].r ? b.y : b.y + b.h]);
    k.pts = pts.filter(function (p, i) { return !i || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1]; });
  });
  R.lk.forEach(function (k) {
    if (k.kind === 'h') return;
    // a count on its run where no other line passes under it
    var u = k.runs.filter(function (x) { return x.count; })[0], others = [];
    R.lk.forEach(function (o) { if (o !== k) for (var i = 1; i < o.pts.length; i++) others.push(o.pts[i - 1].concat(o.pts[i])); });
    k.at = [(u.a + u.b) / 2, u.y];
    [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8].some(function (t) {
      var x = u.a + t * (u.b - u.a), box = { x: x - k.bw / 2, y: u.y - 11, w: k.bw, h: 22 };
      if (others.some(function (s) { return crosses(s, box); })) return false;
      k.at = [x, u.y]; return true;
    });
  });
  R.lk.forEach(function (k) {
    var key = 'wl:' + k.l.from + '>' + k.l.to;
    links.push('<g' + cls(key, lit) + '><path d="' + k.pts.map(function (p, i) { return (i ? 'L' : 'M') + n1(p[0]) + ' ' + n1(p[1]); }).join('') + '" fill="none" stroke="' + C.cross + '" stroke-width="2.4" stroke-linejoin="round"/></g>');
    counts.push('<g' + cls(key, lit) + '>' + badge(X, k.at[0], k.at[1], k.txt, { k: 'wlink:' + k.l.from + '>' + k.l.to }) + '</g>');
  });
  blocks.forEach(function (b) {
    var o = b.o, p = pos[o.id], k = 'ws:' + o.id, sel = V.sel === k;
    var stroke = o.state === 'active' ? C.sky : o.state === 'parked' ? C.lav : o.state === 'new' ? C.text : C.cross;
    var fill = o.state === 'active' ? C.skyBg : o.state === 'parked' ? C.lavBg : C.card;
    var rx = Math.min(26, p.h / 2);
    var g = '<g' + cls(k, lit, o.state === 'parked' ? 'pk' + (sel ? ' selg' : '') : '') + '>' + hitG(X, k, p.x, p.y, p.w, p.h, '', rx);
    g += '<rect x="' + n1(p.x) + '" y="' + n1(p.y) + '" width="' + n1(p.w) + '" height="' + n1(p.h) + '" rx="' + rx + '" fill="' + fill + '" stroke="' + (sel ? C.sky : stroke) + '" stroke-width="' + (sel ? 2.6 : 1.6) + '"' + (o.state === 'new' ? ' stroke-dasharray="6 4"' : '') + '/>';
    if (o.state === 'active') g += '<rect x="' + n1(p.x) + '" y="' + n1(p.y) + '" width="' + n1(p.w) + '" height="' + n1(p.h) + '" rx="' + rx + '" fill="none" stroke="' + C.sky + '" stroke-width="6" opacity="0.12"/>';
    var tx = p.x + 20, ty = p.y + 26;
    var sw = { active: C.sky, parked: C.lav, new: C.text, waiting: C.sec }[o.state] || C.sec;
    g += txt(tx, ty, o.id, sk.idfs, C.sec, { wt: 700, ls: 0.3 });
    var wx = tx + f(o.id, sk.idfs, 700) + 8;
    if (b.own) { ty += sk.slh; wx = tx; }
    g += txt(wx, ty, wrap(X, o.words, p.x + p.w - 20 - wx, sk.small, 500, 1)[0], sk.small, sw);
    ty += 8;
    b.title.forEach(function (l) { ty += sk.lh; g += txt(tx, ty, l, sk.title, C.text, { wt: 600 }); });
    ty += sk.slh;
    b.counts.forEach(function (l, n) { if (n) ty += sk.slh; g += txt(tx, ty, l, sk.small, C.sec); });
    if (b.dueOwn) { ty += sk.slh; g += txt(tx, ty, b.due, sk.small, C.amber); }
    else if (b.due) g += txt(tx + f(b.counts[b.counts.length - 1], sk.small, 400), ty, ', ' + b.due, sk.small, C.amber);
    if (o.stalled) { ty += sk.slh; g += txt(tx, ty, o.stalled, sk.small, C.amber, { wt: 600 }); }
    if (b.extra.length) {
      ty += 8;
      g += iconSvg(X, 'fav', tx, ty + 3, 16);
      b.extra.forEach(function (l) { ty += sk.slh; g += txt(tx + 22, ty, l, sk.small, C.amber, { wt: 600 }); });
    }
    g += '</g>';
    if (o.train) g += trainSvg(p.x + 22, p.y, o.train.agents || 0, C);
    // the pill's tag counts what is new; the since line and the strip carry the rest
    if (o.changed) { var ct = o.changed.split(',')[0]; g += freshTag(X, p.x + p.w - f(ct, sk.idfs, 700) - 30, p.y, ct); }
    out.push(g + '</g>');
  });
  var H = rows ? rowY[rows - 1] + rowH(rows - 1) + (nL[rows - 1] ? hG[rows - 1] : 0) + 24 : top + 24;
  return finish(X, W, H, links.join('') + counts.join('') + out.join(''), pos);
}

/* ================= level 1: a workstream, one pill per track on its line ================= */
function trackDepths(Wd) {
  var d = {}; Wd.tracks.forEach(function (t) { d[t.id] = 0; });
  var links = list(Wd.links).filter(function (l) { return d[l.from] !== undefined && d[l.to] !== undefined && l.from !== l.to; });
  // a link closing a loop (two tracks waiting on each other) sets no depth, the order and the heavier kept, so the depths stay one column apart
  var kept = [], reach = function (a, b) {
    var st = [a], seen = {};
    while (st.length) { var c = st.pop(); if (c === b) return true; if (seen[c]) continue; seen[c] = 1; kept.forEach(function (l) { if (l.from === c) st.push(l.to); }); }
    return false;
  };
  links.slice().sort(function (a, b) { return (b.kind === 'order') - (a.kind === 'order') || list(b.pairs).length - list(a.pairs).length; })
    .forEach(function (l) { if (!reach(l.to, l.from)) kept.push(l); });
  for (var i = 0; i < Wd.tracks.length; i++) kept.forEach(function (l) { d[l.to] = Math.max(d[l.to], d[l.from] + 1); });
  return d;
}
// a track's running count, then its tasks whose agent ended ("1 running, 1 landing, ")
function runParts(t, sp) {
  return [[t.running, 'running'], [t.landing, 'landing'], [t.stopped, 'stopped']].filter(function (p) { return p[0]; })
    .map(function (p) { return p[0] + (sp || ' ') + p[1] + ', '; }).join('');
}
function pillText(X, t, inner) {
  var sk = X.sk, words = t.words, title = wrap(X, t.name, inner, sk.title, 600, 2);
  var counts = t.open + ' open: ' + runParts(t) + (t.ready ? t.ready + ' ready, ' : '') + (t.waiting || 0) + ' waiting';
  var prog = t.done + ' of ' + (t.done + t.open) + ' done';
  // the head stays on the id's row, the track a park waits on giving way; else the words take their own rows
  var room = inner - 6 - X.tw(t.id, sk.idfs, 700), after = /^parked: after (.+)$/.exec(words || ''), head = [words], own = false;
  if (X.tw(words, sk.small, 500) > room) {
    var cut = after ? giveWay(X, words, after[1], room, sk.small, 500) : null;
    if (cut) head = [cut]; else { own = true; head = wrap(X, words, inner, sk.small, 500, 2); }
  }
  // the stall stands beside the progress where it fits, else on a row of its own
  var stallOwn = !!t.stalled && X.tw(prog, sk.small, 400) + 10 + X.tw(t.stalled, sk.small, 600) > inner;
  return { title: title, head: head, own: own, counts: wrap(X, counts, inner, sk.small, 400), prog: prog, stallOwn: stallOwn };
}
// the rows of a pill's text, without the lines of words under it
function pillRows(X, pt) { var sk = X.sk; return 25 + 8 + (pt.own ? pt.head.length * sk.slh : 0) + pt.title.length * sk.lh + sk.slh * (pt.counts.length + 1 + (pt.stallOwn ? 1 : 0)) + 18; }
function pillSvg(X, Wd, t, p, extraLines) {
  var C = X.C, sk = X.sk, k = 'pill:' + t.id, sel = X.V.sel === k, lit = X.lit;
  var stroke = t.state === 'active' ? C.sky : t.state === 'parked' ? C.lav : t.state === 'new' ? C.text : C.cross;
  var fill = t.state === 'active' ? C.skyBg : t.state === 'parked' ? C.lavBg : C.card;
  var rx = Math.min(30, p.h / 2);
  var g = '<g' + cls(k, lit, t.state === 'parked' ? 'pk' + (sel ? ' selg' : '') : '') + '>' + hitG(X, k, p.x, p.y, p.w, p.h, '', rx);
  g += '<rect x="' + n1(p.x) + '" y="' + n1(p.y) + '" width="' + n1(p.w) + '" height="' + n1(p.h) + '" rx="' + rx + '" fill="' + fill + '" stroke="' + (sel ? C.sky : stroke) + '" stroke-width="' + (sel ? 2.6 : 1.6) + '"' + (t.state === 'new' && !sel ? ' stroke-dasharray="6 4"' : '') + '/>';
  // in one column the links between pills are words, so a ring marks the pills the counted chain runs through (the mock's)
  if (onCrit(X.P, Wd, t.id) && !sel && p.narrow) g += '<rect x="' + n1(p.x - 3.5) + '" y="' + n1(p.y - 3.5) + '" width="' + n1(p.w + 7) + '" height="' + n1(p.h + 7) + '" rx="' + (rx + 3.5) + '" fill="none" stroke="' + C.crit + '" stroke-width="1.4" opacity="0.55"/>';
  if (t.state === 'active') g += '<rect x="' + n1(p.x) + '" y="' + n1(p.y) + '" width="' + n1(p.w) + '" height="' + n1(p.h) + '" rx="' + rx + '" fill="none" stroke="' + C.sky + '" stroke-width="6" opacity="0.12"/>';
  var pt = pillText(X, t, p.w - 44), tx = p.x + 22, more = (extraLines || []).length * sk.slh;
  // a pill sharing a taller one's height gives its title the rows it leaves
  var spare = Math.floor((p.h - pillRows(X, pt) - more) / sk.lh);
  if (spare > 0 && pt.title.length === 2) pt.title = wrap(X, t.name, p.w - 44, sk.title, 600, 2 + spare);
  var contentH = pillRows(X, pt) + more, ty = p.y + 25 + Math.max(0, (p.h - contentH) / 2);
  var sw = { active: C.sky, parked: C.lav, new: C.text, waiting: C.sec }[t.state] || C.sec;
  g += txt(tx, ty, t.id, sk.idfs, C.sec, { wt: 700, ls: 0.3 });
  var wx = tx + X.tw(t.id, sk.idfs, 700) + 8;
  if (pt.own) wx = tx;
  pt.head.forEach(function (l) { if (pt.own) ty += sk.slh; g += txt(wx, ty, l, sk.small, sw); });
  ty += 8;
  pt.title.forEach(function (l) { ty += sk.lh; g += txt(tx, ty, l, sk.title, C.text, { wt: 600 }); });
  pt.counts.forEach(function (l) { ty += sk.slh; g += txt(tx, ty, l, sk.small, C.sec); });
  ty += sk.slh;
  g += txt(tx, ty, pt.prog, sk.small, C.sec);
  if (pt.stallOwn) { ty += sk.slh; g += txt(tx, ty, t.stalled, sk.small, C.amber, { wt: 600 }); }
  else if (t.stalled) g += txt(tx + X.tw(pt.prog, sk.small, 400) + 10, ty, t.stalled, sk.small, C.amber, { wt: 600 });
  (extraLines || []).forEach(function (e) { ty += sk.slh; g += txt(tx, ty, e.s, sk.small, e.c || C.cross, { wt: 600 }); });
  g += '</g>';
  if (t.train) g += trainSvg(p.x + 24, p.y, t.train.agents || 0, C);
  if (t.changed) { var s = t.changed.split(',')[0]; g += freshTag(X, p.x + p.w - X.tw(s, sk.idfs, 700) - 30, p.y, s); }
  return g + '</g>';
}
function pillHeight(X, Wd, pw, extra) {
  var sk = X.sk, h = 0;
  Wd.tracks.forEach(function (t) { h = Math.max(h, pillRows(X, pillText(X, t, pw - 44)) + ((extra && extra[t.id]) || 0) * sk.slh); });
  return h;
}
// one chip per task waited on and workstream waiting, never one per waiting task: the entries of a group and its count's words
function waitGroups(arr, keyOf, isTrack) {
  var by = {}, out = [];
  list(arr).forEach(function (o) {
    var k = keyOf(o);
    if (!by[k]) out.push(by[k] = { o: o, all: [], tasks: 0, tracks: 0 });
    by[k].all.push(o);
    if (isTrack(o)) by[k].tracks++; else by[k].tasks++;
  });
  return out;
}
function countWords(g) { var c = countLine(g); return c ? ' (' + c + ')' : ''; }
function countLine(g) {
  if (g.tasks + g.tracks < 2) return '';
  var p = [];
  if (g.tasks) p.push(g.tasks + ' task' + (g.tasks === 1 ? '' : 's'));
  if (g.tracks) p.push(g.tracks + ' track' + (g.tracks === 1 ? '' : 's'));
  return p.join(', ');
}
var outGroups = function (Wd) { return waitGroups(Wd.out, function (o) { return o.from + '|' + o.ws + '|' + (o.task || o.text); }, function (o) { return !!o.waiter; }); };
// a link to another workstream under a pill: Out on its right, In on its left; the mock's words, their count on a line of its own
function edgeLinks(Wd) {
  var e = [];
  outGroups(Wd).forEach(function (g) { e.push({ tr: g.o.from, ws: g.o.ws, text: g.o.text, more: countLine(g), right: true }); });
  waitGroups(Wd.in, function (o) { return o.to + '|' + o.ws + '|' + o.on; }, function (o) { return !o.task; })
    .forEach(function (g) { e.push({ tr: g.o.to, ws: g.o.ws, text: g.o.text, more: countLine(g), right: false }); });
  return e;
}
// an edge chip from its top: its words in the link's blue, the count under them
function edgeChip(X, o, L, x, y, w, h) {
  var C = X.C, sk = X.sk, s = hitG(X, 'ws:' + o.ws, x, y, w, h, '', 12) + '<rect x="' + n1(x) + '" y="' + n1(y) + '" width="' + n1(w) + '" height="' + h + '" rx="12" fill="' + C.bg + '" stroke="' + C.cross + '"/>';
  L.forEach(function (l, i) {
    var count = o.more && i === L.length - 1;
    s += txt(x + 14, y + 16.5 + i * 16, l, sk.small, count ? C.sec : C.link, count ? { wt: 500 } : { wt: 600, deco: 'underline' });
  });
  return s + '</g>';
}
// its lines: the words (two at most where the room is short) and the count
function edgeLines(X, o, room) { return wrap(X, o.text, room, X.sk.small, 600, 2).concat(o.more ? wrap(X, o.more, room, X.sk.small, 500, 1) : []); }
// an edge chip at most w wide: its lines, width and height
function chipSize(X, o, w) {
  var L = edgeLines(X, o, w - 30);
  return { o: o, L: L, w: Math.min(w, Math.max.apply(null, L.map(function (l) { return X.tw(l, X.sk.small, 600); })) + 30), h: 24 + 16 * (L.length - 1) };
}
// a pill's bottom edge at x, round at its corners, where a line leaving it starts
function edgeY(p, x) {
  var rx = Math.min(30, p.h / 2), d = Math.min(rx, Math.max(0, p.x + rx - x, x - (p.x + p.w - rx)));
  return p.y + p.h - rx + Math.sqrt(rx * rx - d * d);
}
/* the chips under a pill between ax0 and ax1: In on the left, Out on the right, side by side where they fit, else the left
   above the right, narrowed to clear the right's line; a side's one chip hangs on a straight stub, more on a trunk with a branch each */
function chipPlan(X, es, ax0, ax1) {
  var room = ax1 - ax0, sides = [es.filter(function (o) { return !o.right; }), es.filter(function (o) { return o.right; })].filter(function (g) { return g.length; });
  var size = function (g, w) {
    var inset = g.length > 1 ? 24 : 0, cs = g.map(function (o) { return chipSize(X, o, w - inset); });
    return { cs: cs, inset: inset, right: !!g[0].right, w: inset + Math.max.apply(null, cs.map(function (c) { return c.w; })), h: cs.reduce(function (a, c) { return a + c.h + 8; }, -8) };
  };
  var G = sides.map(function (g) { return size(g, room); }), apart = G.length < 2 || G[0].w + G[1].w + 16 <= room;
  if (!apart) G[0] = size(sides[0], room - (G[1].inset ? 20 : 32));
  return { G: G, apart: apart, ax0: ax0, ax1: ax1, h: apart ? Math.max.apply(null, G.map(function (g) { return g.h; })) : G[0].h + 8 + G[1].h };
}
// each chip's box and its line from the pill's edge
function chipBoxes(p, plan, y0) {
  var out = [];
  plan.G.forEach(function (g, i) {
    var yy = plan.apart || !i ? y0 : y0 + plan.G[0].h + 8, vx = g.right ? plan.ax1 - (g.inset ? 12 : 24) : plan.ax0 + (g.inset ? 12 : 24), top = edgeY(p, vx);
    g.cs.forEach(function (c) {
      var x = g.right ? plan.ax1 - g.inset - c.w : plan.ax0 + g.inset, ey = g.inset ? yy + c.h / 2 : yy, ex = g.right ? x + c.w : x;
      // its line as thin boxes, so a link or a count can be kept off it
      var line = [{ x: vx - 2, y: top, w: 4, h: ey - top }].concat(g.inset ? [{ x: Math.min(vx, ex), y: ey - 2, w: Math.abs(ex - vx), h: 4 }] : []);
      out.push({ c: c, x: x, y: yy, w: c.w, h: c.h, line: line, d: 'M' + n1(vx) + ' ' + n1(top) + 'V' + n1(ey) + (g.inset ? 'H' + n1(ex) : '') });
      yy += c.h + 8;
    });
  });
  return out;
}
function chipDraw(X, p, plan, y0) {
  return chipBoxes(p, plan, y0).map(function (b) {
    return '<g' + cls('pill:' + b.c.o.tr, X.lit) + '><path d="' + b.d + '" fill="none" stroke="' + X.C.cross + '" stroke-width="2" stroke-dasharray="5 4"/>' + edgeChip(X, b.c.o, b.c.L, b.x, b.y, b.w, b.h) + '</g>';
  }).join('');
}
// a straight segment through a box's inside
function crosses(s, b) {
  var t0 = 0, t1 = 1, dx = s[2] - s[0], dy = s[3] - s[1];
  var pq = [[-dx, s[0] - b.x], [dx, b.x + b.w - s[0]], [-dy, s[1] - b.y], [dy, b.y + b.h - s[1]]];
  for (var i = 0; i < 4; i++) {
    var p = pq[i][0], q = pq[i][1];
    if (p === 0) { if (q < 0) return false; continue; }
    var t = q / p;
    if (p < 0) { if (t > t1) return false; t0 = Math.max(t0, t); } else { if (t < t0) return false; t1 = Math.min(t1, t); }
  }
  return t1 - t0 > 1e-6;
}
function meets(a, b) { return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h; }
// where a straight segment runs between heights ya and yb: its x span, or null
function spanAt(s, ya, yb) {
  var lo = Math.min(s[1], s[3]), hi = Math.max(s[1], s[3]);
  if (hi < ya || lo > yb) return null;
  if (hi === lo) return [Math.min(s[0], s[2]), Math.max(s[0], s[2])];
  var at = function (y) { var t = Math.max(0, Math.min(1, (y - s[1]) / (s[3] - s[1]))); return s[0] + t * (s[2] - s[0]); }, a = at(ya), b = at(yb);
  return [Math.min(a, b), Math.max(a, b)];
}
function drawWorkstream(X) {
  var P = X.P, V = X.V, Wd = P.ws[V.ws], C = X.C, sk = X.sk, W = X.W, f = X.tw;
  if (!Wd || !list(Wd.tracks).length) return finish(X, W, 40, txt(16, 26, 'Nothing open here.', sk.small, C.sec), {});
  var d = trackDepths(Wd), lit = X.lit, links = list(Wd.links).filter(function (l) { return d[l.from] !== undefined && d[l.to] !== undefined; });
  var ncol = 0; Object.keys(d).forEach(function (k) { ncol = Math.max(ncol, d[k] + 1); });
  var pad = W < 420 ? 8 : 24, top = X.top + 2, gapMin = 54, pwMin = 168;
  // a column per depth holds one pill a row: two tracks of one row at one depth (three parks opening on one track) take the per-row columns
  var byRow = [[], []]; Wd.tracks.forEach(function (t) { byRow[t.state === 'parked' ? 1 : 0].push(t); });
  // a count between two neighbours on a row stands clear of both pills: the gap holds the widest and 16 px
  var rowOf = function (id) { return byRow[0].some(function (t) { return t.id === id; }) ? 0 : 1; };
  var clear = function (at) {
    var w = 0;
    links.forEach(function (l) { var n = list(l.pairs).length; if (l.kind !== 'order' && rowOf(l.from) === rowOf(l.to) && Math.abs(at(l.to) - at(l.from)) === 1) w = Math.max(w, f(n + (n === 1 ? ' wait' : ' waits'), sk.small, 650) + 32); });
    return w;
  };
  gapMin = Math.max(gapMin, clear(function (id) { return d[id]; }));
  var shared = byRow.some(function (r) { return r.some(function (t, i) { return r.some(function (u, j) { return j < i && d[u.id] === d[t.id]; }); }); });
  var wide = !shared && (ncol * pwMin + (ncol - 1) * gapMin + 2 * pad <= W && ncol > 1 || (ncol === 1 && W >= 420));
  // a mid width: each row keeps its own columns, so three pills fit where five depths do not; a link out of the workstream takes the column after the spine row
  byRow.forEach(function (r) { r.sort(function (a, b) { return d[a.id] - d[b.id]; }); });
  var outSide = list(Wd.out).length && byRow[0].length >= byRow[1].length ? 1 : 0, ncolC = Math.max(byRow[0].length + outSide, byRow[1].length);
  var gapC = Math.max(70, clear(function (id) { var r = byRow[rowOf(id)]; for (var i = 0; i < r.length; i++) if (r[i].id === id) return i; return -9; }));
  var compact = !wide && ncolC > 1 && ncolC * pwMin + (ncolC - 1) * gapC + 2 * pad <= W;
  var parts = [], pos = {}, edges = edgeLinks(Wd), segs = [];
  var linkSvg = function (l, dd) {
    var k = 'link:' + l.from + '>' + l.to, crit = linkCrit(P, Wd, l);
    var col = crit ? C.crit : l.kind === 'order' ? C.lav : C.cross, wdt = crit ? 5 : l.kind === 'order' ? 2.2 : 2.4;
    var g = '<g' + cls(k, lit) + '><path d="' + dd + '"' + (/V/.test(dd) ? ' fill="none"' : '') + ' stroke="' + col + '" stroke-width="' + wdt + '" stroke-linecap="round"' + (l.kind === 'order' ? ' stroke-dasharray="7 6"' : '') + '/>';
    return { g: g, crit: crit, k: k };
  };
  if (wide || compact) {
    if (compact) ncol = ncolC;
    var gap = compact ? gapC : gapMin, pw = Math.min(250, (W - 2 * pad - (ncol - 1) * gap) / ncol);
    if (ncol === 1) pw = Math.min(320, W - 2 * pad);
    var ph = pillHeight(X, Wd, pw), y0 = top + 26;
    var used = ncol * pw + (ncol - 1) * gap, x0 = Math.max(pad, (W - used) / 2);
    var hasRow1 = byRow[1].length > 0;
    Wd.tracks.forEach(function (t) { var r = t.state === 'parked' ? 1 : 0, c = compact ? byRow[r].indexOf(t) : d[t.id]; pos[t.id] = { x: x0 + c * (pw + gap), y: y0, w: pw, h: ph, r: r }; });
    /* on one row a wait joins neighbours straight, a pair both ways two lines; one that skips a pill runs in a lane under the row
       (as the Overview's do), from the left pill's bottom edge near its right end to the right pill's near its left end */
    var same = links.map(function (l) {
      var a = pos[l.from], b = pos[l.to];
      if (a.r !== b.r) return null;
      var s = { l: l, r: a.r, L: a.x < b.x ? l.from : l.to, R: a.x < b.x ? l.to : l.from };
      s.lo = pos[s.L].x + pos[s.L].w; s.hi = pos[s.R].x;
      s.kind = Wd.tracks.some(function (t) { var p = pos[t.id]; return p.r === a.r && p.x > pos[s.L].x && p.x < pos[s.R].x; }) ? 'u' : 'h';
      return s;
    });
    var pairs = {}, skR = {}, skL = {}, skRows = [0, 0];
    same.forEach(function (s) { if (s && s.kind === 'h') (pairs[s.L + '>' + s.R] = pairs[s.L + '>' + s.R] || []).push(s); });
    Object.keys(pairs).forEach(function (k) { pairs[k].forEach(function (s, j) { s.rank = j; s.nm = pairs[k].length; }); });
    [0, 1].forEach(function (r) {
      var ln = [];
      same.filter(function (s) { return s && s.kind === 'u' && s.r === r; }).sort(function (p, q) { return (p.hi - p.lo) - (q.hi - q.lo); }).forEach(function (s) {
        var i = 0;
        while (ln[i] && ln[i].some(function (v) { return s.lo < v.hi + 8 && v.lo < s.hi + 8; })) i++;
        (ln[i] = ln[i] || []).push(s); s.lane = i;
      });
      skRows[r] = ln.length;
    });
    // a nearer lane leaves and lands at the outer port, so no line down to a further lane crosses it
    same.forEach(function (s) { if (s && s.kind === 'u') { (skR[s.L] = skR[s.L] || []).push(s); (skL[s.R] = skL[s.R] || []).push(s); } });
    [skR, skL].forEach(function (m) { Object.keys(m).forEach(function (k) { m[k].sort(function (p, q) { return p.lane - q.lane; }); }); });
    var nR = function (id) { return list(skR[id]).length; }, nL = function (id) { return list(skL[id]).length; };
    same.forEach(function (s) { if (s && s.kind === 'u') { s.px1 = pos[s.L].x + pos[s.L].w - 22 - 14 * skR[s.L].indexOf(s); s.px2 = pos[s.R].x + 22 + 14 * skL[s.R].indexOf(s); } });
    // into a pill's bottom or top edge, ports spread left to right in the order their sources stand, so a park and a wait between one pair stay two lines
    var inPorts = {}, topPorts = {}, downs = {};
    links.forEach(function (l) {
      var a = pos[l.from], b = pos[l.to];
      if (a.r > b.r) (inPorts[l.to] = inPorts[l.to] || []).push(l);
      else if (a.r < b.r) { (topPorts[l.to] = topPorts[l.to] || []).push(l); (downs[l.from] = downs[l.from] || []).push(l); }
    });
    Object.keys(topPorts).forEach(function (k) { topPorts[k].sort(function (p, q) { return pos[p.from].x - pos[q.from].x; }); });
    var landX = function (l) { return pos[l.to].x + 34 + topPorts[l.to].indexOf(l) * 26; };
    Object.keys(downs).forEach(function (k) { downs[k].sort(function (p, q) { return landX(p) - landX(q); }); });
    // a wait from outside the workstream: chips under the pill; in compact the room beside the spine row's last pill holds its first Out chip
    var mine = {}, side = null, plans = {};
    edges.forEach(function (o) { if (pos[o.tr]) (mine[o.tr] = mine[o.tr] || []).push(o); });
    var lastT = compact && byRow[0][byRow[0].length - 1], lo = lastT && list(mine[lastT.id]).filter(function (o) { return o.right; })[0];
    if (lo) {
      var lp = pos[lastT.id], lc = chipSize(X, lo, W);
      if (lp.x + lp.w + gap + lc.w <= W - pad) { side = { c: lc, p: lp }; mine[lastT.id] = mine[lastT.id].filter(function (o) { return o !== lo; }); }
    }
    // routed, a spine pill with chips keeps a lane at its right end for each link through its bottom edge
    var routed = false, zone = 0, zone1 = 0, rowGap = 92;
    var lanes = function (id) { return routed && pos[id].r === 0 && list(mine[id]).length ? list(downs[id]).length + list(inPorts[id]).length : 0; };
    // the routed lanes stand inside a pill's skip ports
    var laneX = function (id, k) { var p = pos[id]; return p.x + p.w - 22 - 14 * (k + nR(id)); };
    // a row's skip lanes run under its chips; their room
    var skRoom = function (r) { return skRows[r] ? skRows[r] * 28 + 4 : 0; };
    var skTop = function (r) { var z = r ? zone1 : zone, yr = r ? pos[byRow[1][0].id].y : y0; return yr + ph + (z ? 32 + z + 10 : 12); };
    var skY = function (s) { return skTop(s.r) + 12 + s.lane * 28; };
    var skFoot = function (r) { return skRows[r] ? skTop(r) + 12 + (skRows[r] - 1) * 28 + 11 : 0; };
    // a link between the rows drawn straight, each at its own port at both ends: the ports out of a pill spread about the mock's
    var ends = function (l) {
      var a = pos[l.from], b = pos[l.to];
      if (a.r > b.r) return [a.x + a.w * 0.6, a.y, b.x + 30 + 14 * nL(l.to) + inPorts[l.to].indexOf(l) * 26, b.y + b.h];
      var n = downs[l.from].length, j = downs[l.from].indexOf(l), sp = Math.min(26, (a.w - 68) / Math.max(1, n - 1));
      var c = Math.min(a.w * 0.72, a.w - 34 - 14 * nR(l.from) - (n - 1) * sp / 2);
      return [a.x + c + (j - (n - 1) / 2) * sp, a.y + a.h, landX(l), b.y];
    };
    var place = function () {
      plans = {}; zone = 0; zone1 = 0;
      Object.keys(mine).forEach(function (id) {
        if (!mine[id].length) return;
        var p = pos[id], n = lanes(id), nl = nL(id);
        plans[id] = chipPlan(X, mine[id], nl ? p.x + 22 + 14 * (nl - 1) + 16 : p.x, n + nR(id) ? laneX(id, n - 1) - 16 : p.x + p.w);
        if (p.r === 0) zone = Math.max(zone, plans[id].h); else zone1 = Math.max(zone1, plans[id].h);
      });
      // the gap under the spine row holds its chips and skip lanes; routed, then room for the links' slope and their counts
      rowGap = (routed ? zone + 108 : Math.max(92, zone + 52)) + skRoom(0);
      // with no track on the spine row the parked row takes its place
      byRow[1].forEach(function (t) { pos[t.id].y = byRow[0].length ? y0 + ph + rowGap : y0; });
    };
    place();
    if (hasRow1 && zone) {
      // a link drawn straight across a spine pill's chip or its line, or its count set on one, routes them all past the chips instead
      var boxes = [];
      byRow[0].forEach(function (t) { if (plans[t.id]) chipBoxes(pos[t.id], plans[t.id], y0 + ph + 32).forEach(function (c) { boxes = boxes.concat([c], c.line); }); });
      routed = links.some(function (l) {
        if (pos[l.from].r === pos[l.to].r) return false;
        var s = ends(l), n = list(l.pairs).length, bw = l.kind === 'order' ? 70 : f(n + ' waits', sk.small, 650) + 16;
        var mid = { x: (s[0] + s[2]) / 2 - bw / 2, y: (s[1] + s[3]) / 2 - 11, w: bw, h: 22 };
        return boxes.some(function (c) { return crosses(s, c) || meets(mid, c); });
      });
      if (routed) place();
    }
    var yz = y0 + ph + 44 + zone + skRoom(0);
    // the caption rides a step of the chain on one row with room (the mock's place); where only a wait off the chain has the room, it stands beside the chain
    var cr0 = Wd.crit || {}, cap = 'critical path, ' + cr0.n + ' tasks: ' + cr0.from + ' to ' + cr0.to, capW = f(cap, sk.small, 600);
    var hosts = links.filter(function (l, i) { var s = same[i]; return l.kind !== 'order' && s && s.kind === 'h' && s.nm === 1 && onCrit(P, Wd, l.from) && onCrit(P, Wd, l.to) && capW < s.hi - s.lo - 220; });
    var capHost = hosts.filter(function (l) { return linkCrit(P, Wd, l); })[0], capFree = !capHost && hosts.length > 0;
    var drawn = links.map(function (l, li) {
      var a = pos[l.from], b = pos[l.to], s = same[li], x1, y1, x2, y2, pre = '', post = '', own = [];
      if (s && s.kind === 'h') { x1 = s.lo; x2 = s.hi; y1 = y2 = a.y + a.h / 2 + (s.rank - (s.nm - 1) / 2) * 28; }
      else if (s) {
        var pa = pos[s.L], pb = pos[s.R], ly = skY(s);
        x1 = s.px1; x2 = s.px2; y1 = y2 = ly;
        pre = 'M' + n1(x1) + ' ' + n1(edgeY(pa, x1)) + 'V' + n1(ly); post = 'V' + n1(edgeY(pb, x2));
        own.push([x1, edgeY(pa, x1), x1, ly], [x2, ly, x2, edgeY(pb, x2)]);
      } else {
        var e = ends(l); x1 = e[0]; y1 = e[1]; x2 = e[2]; y2 = e[3];
        // past the spine row's chips a link drops straight, then runs to its pill
        if (a.r < b.r && routed) {
          if (lanes(l.from)) x1 = laneX(l.from, downs[l.from].length - 1 - downs[l.from].indexOf(l));
          pre = 'M' + n1(x1) + ' ' + n1(edgeY(a, x1)) + 'V' + n1(yz); own.push([x1, y1, x1, yz]); y1 = yz;
        }
        if (a.r > b.r && routed) {
          if (lanes(l.to)) x2 = laneX(l.to, list(downs[l.to]).length + inPorts[l.to].indexOf(l));
          post = 'V' + n1(edgeY(b, x2)); own.push([x2, yz, x2, y2]); y2 = yz;
        }
      }
      own.push([x1, y1, x2, y2]);
      segs = segs.concat(own);
      return { l: l, a: a, b: b, s: s, x1: x1, y1: y1, x2: x2, y2: y2, own: own, d: (pre || 'M' + n1(x1) + ' ' + n1(y1)) + 'L' + n1(x2) + ' ' + n1(y2) + post };
    });
    // a count lies over every line, on its own line where no other link crosses it, the middle first
    var tops = [];
    drawn.forEach(function (k) {
      var l = k.l, L = linkSvg(l, k.d), x1 = k.x1, y1 = k.y1, x2 = k.x2, y2 = k.y2, g = '';
      parts.push(L.g + '</g>');
      var others = []; drawn.forEach(function (o) { if (o !== k) others = others.concat(o.own); });
      var spot = function (w, left) {
        var ts = [0.5, 0.4, 0.6, 0.3, 0.7];
        for (var i = 0; i < ts.length; i++) {
          var x = x1 + ts[i] * (x2 - x1), y = y1 + ts[i] * (y2 - y1), box = { x: x - left, y: y - 11, w: w, h: 22 };
          if (!others.some(function (s) { return crosses(s, box); })) return [x, y];
        }
        return [(x1 + x2) / 2, (y1 + y2) / 2];
      };
      var ans = l.ans && P.ans && P.ans[l.ans];
      if (l.kind === 'order') { if (ans && Math.hypot(x2 - x1, y2 - y1) > 70) { var at = spot(ansW(X, ans), 24); g += ansChip(X, at[0] - 24, at[1], ans, 'ans:' + l.ans); } }
      else {
        var n = list(l.pairs).length, label = n + (n === 1 ? ' wait' : ' waits'), span = x2 - x1, capOn = l === capHost;
        if (k.s && k.s.kind === 'h' && (L.crit || capOn)) {
          g += badge(X, x1 + (span < 200 ? span / 2 : Math.min(90, span * 0.2)), y1, label, { k: L.k, stroke: L.crit ? C.crit : null });
          if (capOn) g += txt(x1 + span * 0.58, y1 - 12, cap, sk.small, C.text, { wt: 600, anchor: 'middle' });
        } else { var bw = f(label, sk.small, 650) + 16, bt = spot(bw, bw / 2); g += badge(X, bt[0], bt[1], label, { k: L.k, stroke: L.crit ? C.crit : null }); }
      }
      if (g) tops.push('<g' + cls(L.k, lit) + '>' + g + '</g>');
    });
    parts = parts.concat(tops);
    Wd.tracks.forEach(function (t) { parts.push(pillSvg(X, Wd, t, pos[t.id])); });
    var H = Math.max((hasRow1 ? pos[byRow[1][0].id].y : y0) + ph + 30, skFoot(hasRow1 ? 1 : 0) + 16);
    Object.keys(plans).forEach(function (id) {
      var p = pos[id], yc = p.y + p.h + 32;
      parts.push(chipDraw(X, p, plans[id], yc));
      H = Math.max(H, yc + plans[id].h + 14);
    });
    if (side) {
      var sc = side.c, sp = side.p, sx = sp.x + sp.w + gap, sy = sp.y + (sp.h - sc.h) / 2;
      parts.push('<g' + cls('pill:' + sc.o.tr, lit) + '><path d="M' + n1(sp.x + sp.w) + ' ' + n1(sp.y + sp.h / 2) + 'H' + n1(sx) + '" stroke="' + C.cross + '" stroke-width="2" stroke-dasharray="5 4"/>' + edgeChip(X, sc.o, sc.L, sx, sy, sc.w, sc.h) + '</g>');
      H = Math.max(H, sy + sc.h + 14);
    }
    if (capFree) {
      // under the chain's pills on the lowest row, below any chips hanging there
      var lr = hasRow1 ? 1 : 0, cp = byRow[lr].filter(function (t) { return onCrit(P, Wd, t.id); });
      if (cp.length) {
        var cl = Math.min.apply(null, cp.map(function (t) { return pos[t.id].x; })), cr = Math.max.apply(null, cp.map(function (t) { return pos[t.id].x + pos[t.id].w; }));
        var cm = Math.max(pad + capW / 2, Math.min(W - pad - capW / 2, (cl + cr) / 2)), cb = pos[cp[0].id].y + ph + 24;
        byRow[lr].forEach(function (t) { var p = pos[t.id]; if (plans[t.id] && p.x < cm + capW / 2 && p.x + p.w > cm - capW / 2) cb = Math.max(cb, p.y + p.h + 32 + plans[t.id].h + 22); });
        if (skRows[lr]) cb = Math.max(cb, skFoot(lr) + 22);
        parts.push(txt(cm, cb, cap, sk.small, C.text, { wt: 600, anchor: 'middle' }));
        H = Math.max(H, cb + 16);
      }
    }
    if (hasRow1 && W > 900) {
      // the parked row's caption takes the first stretch above it that no link, count or chip crosses
      var pc = 'Parked, in the order they open', cy = pos[byRow[1][0].id].y - 18, ya = cy - 11, yb = cy + 4, cw = f(pc, sk.idfs, 700) + 1.2 * pc.length, cx = x0;
      segs.map(function (s) { return spanAt(s, ya, yb); }).concat(X.hits.filter(function (h) { return h.y < yb && h.y + h.h > ya; }).map(function (h) { return [h.x, h.x + h.w]; }))
        .filter(Boolean).sort(function (a, b) { return a[0] - b[0]; })
        .forEach(function (s) { if (s[0] - 10 < cx + cw && s[1] + 10 > cx) cx = s[1] + 10; });
      if (cx + cw <= W - pad) parts.push(txt(cx, cy, pc, sk.idfs, C.dim, { wt: 700, ls: 1.2 }));
    }
    return finish(X, W, H, parts.join(''), pos);
  }
  // one column: the pills in wait order; a wait that skips a pill is a line of words in its pill
  var order = Wd.tracks.slice().sort(function (a, b) { return d[a.id] - d[b.id] || (a.state === 'parked') - (b.state === 'parked'); });
  var at = function (id) { for (var i = 0; i < order.length; i++) if (order[i].id === id) return i; return -1; };
  var pw1 = W - 2 * pad, gapV = 40, extra = {}, words = {};
  links.forEach(function (l) {
    if (at(l.to) === at(l.from) + 1) return;
    var n = list(l.pairs).length, crit = l.kind !== 'order' && linkCrit(P, Wd, l);
    var to = trackOf(P, l.to), what = l.kind === 'order' ? (l.on ? 'opens when ' + orderWhen(P, l) : 'opens after this') : n + (n === 1 ? '\u00a0wait' : '\u00a0waits');
    (words[l.from] = words[l.from] || []).push({ s: '→ ' + (to ? shortName(to) : l.to) + ': ' + what + (crit ? ', critical' : ''), c: crit ? C.crit : l.kind === 'order' ? C.lav : C.cross });
  });
  // the lines of words wrap inside their pill, a count kept with its word
  Object.keys(words).forEach(function (k) {
    var out = []; words[k].forEach(function (e) { wrap(X, e.s, pw1 - 44, sk.small, 600).forEach(function (l) { out.push({ s: l, c: e.c }); }); });
    words[k] = out; extra[k] = out.length;
  });
  var y = top + 22, plans1 = {}, down = {};
  links.forEach(function (l) { if (at(l.to) === at(l.from) + 1) down[l.from] = 1; });
  // a pill's chips stand right of the line down to the next pill, its count under them; each pill its own height, as nothing stands beside it
  order.forEach(function (t) {
    var es = edges.filter(function (o) { return o.tr === t.id; }), h1 = pillRows(X, pillText(X, t, pw1 - 44)) + (extra[t.id] || 0) * sk.slh;
    pos[t.id] = { x: pad, y: y, w: pw1, h: h1, narrow: true };
    if (es.length) plans1[t.id] = chipPlan(X, es, pad + (down[t.id] ? 58 : 0), pad + pw1);
    y += h1 + (plans1[t.id] ? 24 + plans1[t.id].h : 0) + gapV;
  });
  links.forEach(function (l) {
    var a = pos[l.from], b = pos[l.to];
    if (at(l.to) !== at(l.from) + 1) return;
    var x = a.x + 46, L = linkSvg(l, 'M' + n1(x) + ' ' + n1(a.y + a.h) + 'L' + n1(x) + ' ' + n1(b.y));
    var g = L.g.replace(/ stroke-linecap="round"/, ''), my = b.y - gapV / 2, ans = l.ans && P.ans && P.ans[l.ans];
    if (l.kind === 'order') { if (ans) g += ansChip(X, x + 14, my, ans, 'ans:' + l.ans); }
    else { var n = list(l.pairs).length; g += badge(X, x + 46, my, n + (n === 1 ? ' wait' : ' waits'), { k: L.k, stroke: L.crit ? C.crit : null }); }
    parts.push(g + '</g>');
  });
  order.forEach(function (t) { parts.push(pillSvg(X, Wd, t, pos[t.id], words[t.id])); });
  Object.keys(plans1).forEach(function (id) { var p = pos[id]; parts.push(chipDraw(X, p, plans1[id], p.y + p.h + 24)); });
  return finish(X, W, y - gapV + 16, parts.join(''), pos);
}

/* ================= level 2: one track, its stations ================= */
function trackModel(P, Wd, tr) {
  var T = P.tasks || {}, ins = list(Wd.in);
  var ids = Object.keys(T).filter(function (k) { return T[k].tr === tr.id && T[k].st !== 'done'; });
  var inT = function (x) { return ids.indexOf(x) >= 0; };
  var preds = {}, succs = {};
  ids.forEach(function (i) { preds[i] = list(T[i].waits).filter(inT); succs[i] = []; });
  ids.forEach(function (i) { preds[i].forEach(function (p) { succs[p].push(i); }); });
  var depth = {}, spine = list(tr.spine).filter(inT);
  // a spine station stands past the one before it, even one it waits on only through another track, so the line never steps back
  var dep = function (i) {
    if (depth[i] !== undefined) return depth[i];
    depth[i] = 0; var m = 0, k = spine.indexOf(i);
    preds[i].concat(k > 0 ? [spine[k - 1]] : []).forEach(function (p) { m = Math.max(m, dep(p) + 1); });
    return (depth[i] = m);
  };
  ids.forEach(dep);
  // stations with no waits inside the track move as late as their first follower allows, so links stay short
  var col = {};
  ids.forEach(function (i) { col[i] = depth[i]; });
  for (var pass = 0; pass < 4; pass++) ids.forEach(function (i) {
    if (spine.indexOf(i) >= 0 || !succs[i].length) return;
    var m = Infinity; succs[i].forEach(function (s) { m = Math.min(m, col[s] - 1); });
    if (m !== Infinity && m > col[i]) col[i] = m;
  });
  var loose = ids.filter(function (i) {
    return !preds[i].length && !succs[i].length && spine.indexOf(i) < 0 && !list(T[i].cross).length && !list(T[i].frees).length && !T[i].out &&
      !ins.some(function (o) { return o.task === i; });
  });
  var rows = {}, taken = {}, room = {}, resv = {};
  // a spine station with waits on other tracks keeps the room above it for their chips
  spine.forEach(function (i) { if (!inT(i)) return; rows[i] = 0; taken[col[i] + ':0'] = 1; if (list(T[i].cross).length) { room[col[i] + ':-1'] = 1; room[col[i] + ':-2'] = 1; } });
  // a run of stations off the spine shares one row, so its waits stay one straight line
  var off = ids.filter(function (i) { return spine.indexOf(i) < 0 && loose.indexOf(i) < 0; });
  var isOff = function (x) { return off.indexOf(x) >= 0; };
  var nextOff = function (i) { var n = succs[i].filter(isOff); return n.length === 1 && preds[n[0]].filter(isOff).length === 1 ? n[0] : null; };
  var heads = off.filter(function (i) { return !preds[i].some(function (q) { return isOff(q) && nextOff(q) === i; }); });
  var chains = heads.map(function (h) { var c = [h], n = nextOff(h); while (n && c.indexOf(n) < 0) { c.push(n); n = nextOff(n); } return c; });
  chains.sort(function (x, y) { return y.length - x.length || col[x[0]] - col[y[0]]; });
  chains.forEach(function (c) {
    // where a chain turns to another row, the column beside the turn holds no other station of its row, so no line seems to run on into it
    var h = c[0], tl = c[c.length - 1], keep = [];
    preds[h].forEach(function (p) { for (var x = Math.min(col[p] + 1, col[h] - 1); x < col[h]; x++) keep.push(x); });
    if (succs[tl].length) keep.push(col[tl] + 1);
    var tries = [-1, 1, -2, 2, 3, -3, 4, -4, 5, -5];
    for (var k = 0; k < tries.length; k++) {
      var r = tries[k];
      var free = c.every(function (i) { var q = col[i] + ':' + r; return !taken[q] && !room[q] && !resv[q]; }) && keep.every(function (x) { return !taken[x + ':' + r]; });
      if (free) { c.forEach(function (i) { rows[i] = r; taken[col[i] + ':' + r] = 1; }); keep.forEach(function (x) { resv[x + ':' + r] = 1; }); break; }
    }
  });
  var ncol = 0; ids.forEach(function (i) { if (loose.indexOf(i) < 0) ncol = Math.max(ncol, col[i] + 1); });
  return { ids: ids, preds: preds, succs: succs, col: col, rows: rows, loose: loose, ncol: ncol };
}
function stateWords(t) {
  if (t.st === 'now' && t.ended) return t.ended + ': ' + t.agent + ', ' + ENDED_NEXT[t.ended];
  if (t.st === 'now') return 'running: ' + (t.agent || 'the session');
  if (t.st === 'held') return 'in progress: the session';
  if (t.st === 'left') return 'in progress, nobody on it';
  if (t.st === 'ready') return 'ready';
  if (t.st === 'gated') return 'waits on your answer';
  if (t.st === 'done') return 'done';
  return 'waits on ' + waitsOf(t).length;
}
function drawTrack(X) {
  var P = X.P, V = X.V, T = P.tasks || {}, tr = trackOf(P, V.tr), C = X.C, sk = X.sk, W = X.W, f = X.tw;
  var Wd = tr && P.ws[tr.ws];
  if (!tr || !Wd) return finish(X, W, 40, txt(16, 26, 'Nothing open here.', sk.small, C.sec), {});
  var M = trackModel(P, Wd, tr), lit = X.lit, steps = critSteps(Wd), sel = V.sel;
  var parts = [], under = [], pos = {}, railMode = false, RK = 1, spine = list(tr.spine);
  var pad = W < 420 ? 6 : 20, top = X.top;
  var inWs = function (id) { var t = T[id]; return !!(t && Wd.tracks.some(function (x) { return x.id === t.tr; })); };
  var lin = function (a, b) { return lit ? (lit['stn:' + a] && lit['stn:' + b] ? 'lit' : 'dimmed') : ''; };
  var lineCol = function (a, b) { return steps[a + '>' + b] ? [C.crit, 5] : [C.line, 3.5]; };
  // a station and its words are one press: lab places its words, idOnly a finished junction's id alone
  var stn = function (t, x, y, lab) {
    var k = 'stn:' + t.id, on = sel === k, n0 = X.hits.length, b = { x: x - 14, y: y - 14, r: x + 14, b: y + 14 }, L = null;
    if (lab) {
      L = lab.idOnly ? { s: txt(lab.x, lab.y, t.id, sk.idfs, C.sec, { wt: 700 }), r: lab.x + f(t.id, sk.idfs, 700), b: lab.y + 5 } : label(t, lab.x, lab.y, lab.w);
      b = { x: Math.min(b.x, lab.x - 4), y: Math.min(b.y, lab.y - 15), r: Math.max(b.r, L.r + 4), b: Math.max(b.b, L.b) };
    }
    var s = '<g' + cls(k, lit) + '>' + hitG(X, k, b.x, b.y, b.r - b.x, b.b - b.y, '', 8) + '<rect x="' + (x - 14) + '" y="' + (y - 14) + '" width="28" height="28" fill="transparent"/>' + scaled(stationMark(t, x, y, C, on), x, y, RK) + (L ? L.s : '') + '</g>';
    // its zone goes under the answer chip's in its words, so it is laid first
    if (X.hits.length - 1 > n0) X.hits.splice(n0, 0, X.hits.pop());
    if (!railMode && !t.ended && (t.st === 'now' || t.st === 'held')) s += t.session ? engine(x - 44, y, C) : car(x - 36, y, C);
    return s + '</g>';
  };
  // the words beside a station: id and its tags, the name, its state
  // measured at the selected weight, so a selection never rewraps or overruns the gap
  // on the rails the train rides in the words, ahead of the state line
  var trainW = function (t) { return railMode && !t.ended && (t.st === 'now' || t.st === 'held') ? (t.session ? 26 : 15) * RK + 5 : 0; };
  var labLines = function (t, w) { return { name: wrap(X, t.name, w, sk.name, 600, w < 150 ? 4 : 3), st: wrap(X, stateWords(t), w - trainW(t), sk.small, 500, 2) }; };
  var labH = function (t, w) { var L = labLines(t, w); return 15 + L.name.length * sk.lh + L.st.length * sk.slh + 4; };
  // the words drawn, their right edge and their foot
  var label = function (t, x, y, w) {
    var L = labLines(t, w), s = '', yy = y, r = x + f(t.id, sk.idfs, 700) + 2;
    s += txt(x, yy, t.id, sk.idfs, C.sec, { wt: 700, ls: 0.3 });
    var tx = x + f(t.id, sk.idfs, 700) + 8;
    if (t.fresh) { s += freshTag(X, tx, yy - 4, t.fresh); r = tx + f(t.fresh, sk.idfs, 700) + 12; tx += f(t.fresh, sk.idfs, 700) + 18; }
    var a = t.ans && P.ans && P.ans[t.ans];
    if (a) { s += ansChip(X, tx, yy - 4, a, 'ans:' + t.ans); r = tx + ansW(X, a); }
    L.name.forEach(function (l) { yy += sk.lh; s += txt(x, yy, l, sk.name, C.text, { wt: sel === 'stn:' + t.id ? 600 : 450 }); r = Math.max(r, x + f(l, sk.name, 600)); });
    var sc = t.st === 'now' || t.st === 'held' || t.st === 'left' ? C.sky : t.st === 'ready' ? C.ready : t.st === 'gated' ? C.amber : C.sec;
    var ti = trainW(t);
    L.st.forEach(function (l, n) { yy += n ? sk.slh - 2 : sk.slh; if (!n && ti) s += scaled(t.session ? engine(x, yy - 4, C) : car(x, yy - 4, C), x, yy - 4, RK); s += txt(x + ti, yy, l, sk.small, sc, { wt: 500 }); r = Math.max(r, x + ti + f(l, sk.small, 500)); });
    return { s: s, r: r, b: yy + 5 };
  };
  // links to other tracks
  var leftChips = [], rightChips = [], topChips = {}, inline = {};
  if (tr.from) leftChips.push({ a: 'from ' + tr.from + ' on', b: shortOfTask(P, tr.from), nm: shortOfTask(P, tr.from), k: 'jump:' + tr.from });
  else {
    // a side track with no junction starts at the start of the track the others leave from
    var trunk = Wd.tracks.filter(function (x) { return x.id !== tr.id && list(x.junctions).length; }).sort(function (a, b) { return list(b.junctions).length - list(a.junctions).length; })[0];
    if (trunk && !list(tr.junctions).length) leftChips.push({ a: 'from the start of', b: shortName(trunk), nm: shortName(trunk), k: 'trk:' + trunk.id });
  }
  // a park on a task opens when that task completes, as its pill says; on this line its chip stands at that station
  var atStn = function (l) { return l.on && M.ids.indexOf(l.on) >= 0; };
  list(Wd.links).forEach(function (l) {
    if (l.kind !== 'order') return;
    if (l.to === tr.id) leftChips.push({ a: 'opens when', b: orderWhen(P, l), nm: l.on ? '' : trName(P, l.from), k: l.on ? 'jump:' + l.on : 'trk:' + l.from, order: true, ans: l.ans });
    if (l.from === tr.id && !atStn(l)) rightChips.push({ a: trName(P, l.to) + ' opens', b: 'when ' + (l.on ? orderWhen(P, l) : 'this ends'), nm: trName(P, l.to), k: 'trk:' + l.to, order: true, ans: l.ans });
  });
  list(Wd.in).forEach(function (o) {
    if (o.to === tr.id && !o.task) leftChips.push({ a: 'opens when', b: o.ws + ' ' + o.on + (/^TR-/.test(o.on) ? ' ends' : ' completes'), k: 'ws:' + o.ws, order: true });
  });
  var ansOf = function (ch) { return ch.ans && P.ans && P.ans[ch.ans]; };
  M.ids.forEach(function (i) {
    var t = T[i]; inline[i] = [];
    // waits across workstreams come from in and out, the ones inside it from cross and frees
    list(t.cross).forEach(function (c) { if (!inWs(c)) return; (topChips[i] = topChips[i] || []).push({ s: c + ' (' + shortOfTask(P, c) + ')', k: 'jump:' + c }); inline[i].push({ s: 'waits on ' + c + ' (' + shortOfTask(P, c) + ')', k: 'jump:' + c }); });
    list(Wd.in).forEach(function (o) { if (o.task !== i) return; var s = 'waits on ' + o.on + ' (' + o.ws + ')'; (topChips[i] = topChips[i] || []).push({ s: s, k: 'ws:' + o.ws }); inline[i].push({ s: s, k: 'ws:' + o.ws }); });
    // what waits on it elsewhere: one chip a waiting track or workstream, the press going to the first task
    var freed = {};
    list(t.frees).forEach(function (x) { if (T[x] && T[x].tr !== tr.id && inWs(x)) (freed[T[x].tr] = freed[T[x].tr] || []).push(x); });
    Object.keys(freed).forEach(function (on) {
      var xs = freed[on], x = xs[0], nm = shortOfTask(P, x), who = xs.length > 1 ? xs.length + ' tasks' : x;
      if (M.col[i] === M.ncol - 1 && spine.indexOf(i) >= 0) rightChips.push({ a: 'frees ' + who + ' on', b: nm, nm: nm, k: 'jump:' + x, from: i });
      else (topChips[i] = topChips[i] || []).push({ s: 'frees ' + who + ' (' + nm + ')', k: 'jump:' + x });
      inline[i].push({ s: 'frees ' + who + ' (' + nm + ')', k: 'jump:' + x });
    });
    // a park opening on it: a right chip from the line's last station, else a chip right above it, so no line runs along the spine
    list(Wd.links).forEach(function (l) {
      if (l.kind !== 'order' || l.from !== tr.id || l.on !== i) return;
      var nm = trName(P, l.to), ch = { k: 'trk:' + l.to, order: true, ans: l.ans };
      if (M.col[i] === M.ncol - 1 && spine.indexOf(i) >= 0) rightChips.push(Object.assign({ a: nm + ' opens', b: 'when this completes', nm: nm, from: i }, ch));
      else (topChips[i] = topChips[i] || []).push(Object.assign({ s: 'opens ' + nm }, ch));
      inline[i].push(Object.assign({ s: nm + ' opens when this completes' }, ch));
    });
    outGroups(Wd).forEach(function (g) {
      if (g.o.task !== i) return;
      // as a park's chip: at the line's end a right chip, else right above its station, so its line never runs along the spine
      var b = i + countWords(g);
      if (M.col[i] === M.ncol - 1 && spine.indexOf(i) >= 0) rightChips.push({ a: g.o.ws + ' waits on', b: b, k: 'ws:' + g.o.ws, from: i });
      else (topChips[i] = topChips[i] || []).push({ s: g.o.ws + ' waits on ' + b, k: 'ws:' + g.o.ws });
      inline[i].push({ s: g.o.ws + ' waits on ' + b, k: 'ws:' + g.o.ws });
    });
  });
  // a track's name in an edge chip gives way with an ellipsis past 140 px, its words kept, so a long name never drops the line to one column
  var fitLine = function (s, nm, wt) { return giveWay(X, s, nm, 140, sk.small, wt) || s; };
  var lineA = function (ch) { return fitLine(ch.a, ch.nm, 500); };
  var lineB = function (ch) { return fitLine(ch.b, ch.nm, 650); };
  var chip2W = function (ch) { return Math.max(f(lineA(ch), sk.small, 500), f(lineB(ch), sk.small, 650)) + 28; };
  // an edge chip lights with the trace when its station and the task it names are both on it
  var edgeLit = function (ch) { return !!(lit && ch.from && lit['stn:' + ch.from] && (ch.k.indexOf('jump:') !== 0 || lit['stn:' + ch.k.slice(5)])); };
  var edgeCls = function (ch) { return lit ? (edgeLit(ch) ? ' class="lit"' : ' class="dimmed"') : ''; };
  var chip2 = function (ch, x, yc) {
    var w = chip2W(ch), col = ch.order ? C.lav : C.cross;
    return hitG(X, ch.k, x, yc - 20, w, 40, lit ? (edgeLit(ch) ? 'lit' : 'dimmed') : '', 12) + '<rect x="' + n1(x) + '" y="' + n1(yc - 20) + '" width="' + n1(w) + '" height="40" rx="12" fill="' + C.bg + '" stroke="' + col + '" stroke-width="1.2"' + (ch.order ? ' stroke-dasharray="4 3"' : '') + '/>' +
      txt(x + 14, yc - 4, lineA(ch), sk.small, C.sec, { wt: 500 }) + txt(x + 14, yc + 12, lineB(ch), sk.small, ch.order ? C.lav : C.link, { wt: 650 }) + '</g>';
  };
  // a park's chip is the order's dashed lavender, its answer beside it
  var chip1 = function (ch, x, yc, maxW, lk) {
    var a = ch.order && ansOf(ch), aw = a ? ansW(X, a) + 6 : 0, w = Math.min(maxW - aw, f(ch.s, sk.small, 600) + 26), lc = lit ? (lk ? 'lit' : 'dimmed') : '';
    return hitG(X, ch.k, x, yc - 11, w, 22, lc, 11) + '<rect x="' + n1(x) + '" y="' + n1(yc - 11) + '" width="' + n1(w) + '" height="22" rx="11" fill="' + C.bg + '" stroke="' + (ch.order ? C.lav : C.cross) + '" stroke-width="1.2"' + (ch.order ? ' stroke-dasharray="4 3"' : '') + '/>' +
      txt(x + 13, yc + 4.3, wrap(X, ch.s, w - 22, sk.small, 600, 1)[0], sk.small, ch.order ? C.lav : C.link, { wt: 600 }) + '</g>' +
      (a ? '<g' + (lc ? ' class="' + lc + '"' : '') + '>' + ansChip(X, x + w + 6, yc, a, 'ans:' + ch.ans) + '</g>' : '');
  };
  var chipLit = function (i, ch) { return !!(lit && lit['stn:' + i] && (ch.k.indexOf('jump:') !== 0 || lit['stn:' + ch.k.slice(5)])); };
  var leaves = function (t) { return t.leaves ? trName(P, t.leaves) : ''; };
  var doneSince = sinceCount(tr.doneSince);
  var prefix = [];
  if (tr.doneRun) prefix.push({ kind: 'bead', w: 96 });
  list(tr.junctions).forEach(function (j) { if (T[j]) prefix.push({ kind: 'junction', id: j, w: 92 }); });
  var preW = prefix.reduce(function (s, p) { return s + p.w; }, 0);
  var edgeL = leftChips.length ? Math.max.apply(null, leftChips.map(chip2W)) + 40 : 0;
  // a right chip's answer stands beside it, so its room counts in
  var edgeR = rightChips.length ? Math.max.apply(null, rightChips.map(function (ch) { var a = ansOf(ch); return chip2W(ch) + (ch.order && a ? 6 + ansW(X, a) : 0); })) + 40 : 0;
  var avail = W - 2 * pad - preW - edgeL - edgeR, per = Math.max(1, M.ncol), foldL = 0, conns = [];
  var colW = Math.min(250, avail / per);
  var bandOf = function (i) { return Math.floor(M.col[i] / per); }, lcOf = function (i) { return M.col[i] % per; };
  var onSpine = function (i) { return spine.indexOf(i) >= 0; };
  // at a board's width a line too long for its columns folds into bands; a line on to a later band takes a lane of its own (the spine's the first)
  var connsOf = function () {
    var c = [], sp0 = spine.filter(function (i) { return M.ids.indexOf(i) >= 0 && M.loose.indexOf(i) < 0; });
    for (var s = 1; s < sp0.length; s++) if (bandOf(sp0[s - 1]) !== bandOf(sp0[s])) c.push({ p: sp0[s - 1], i: sp0[s], k: 0 });
    M.ids.forEach(function (i) { M.preds[i].forEach(function (p) { if (bandOf(p) !== bandOf(i) && !(onSpine(p) && onSpine(i))) c.push({ p: p, i: i, k: 1 + c.filter(function (x) { return x.k; }).length }); }); });
    return c;
  };
  if (colW < 150 && W >= 700) {
    for (var pass = 0; pass < 2; pass++) {
      per = Math.ceil(M.ncol / Math.ceil(M.ncol / Math.max(1, Math.floor((avail - foldL) / 165))));
      conns = connsOf(); foldL = 24 + 10 * conns.reduce(function (m, c) { return Math.max(m, c.k); }, 0);
    }
    colW = Math.min(250, (avail - foldL) / per);
    // a band holds four columns at least, else the rail reads better
    if (per < 4) { per = M.ncol; conns = []; foldL = 0; colW = 0; }
  }
  if (colW >= 150 && W >= 700) {
    var labW = colW - 30, nB = Math.ceil(Math.max(1, M.ncol) / per), nK = conns.reduce(function (m, c) { return Math.max(m, c.k + 1); }, 0);
    var rowIds = {}, rlo = [], rhi = [];
    for (var b0 = 0; b0 < nB; b0++) { rlo.push(0); rhi.push(0); }
    M.ids.forEach(function (i) { if (M.loose.indexOf(i) >= 0) return; var r = M.rows[i] || 0, b = bandOf(i); (rowIds[b + ':' + r] = rowIds[b + ':' + r] || []).push(i); rlo[b] = Math.min(rlo[b], r); rhi[b] = Math.max(rhi[b], r); });
    var x0 = pad + edgeL + preW + foldL, xOf = function (i) { return x0 + lcOf(i) * colW + 16; };
    // a top chip stops short of the turn a wait takes in its column's gap, so the line never runs behind it
    var turns = {}; M.ids.forEach(function (i) { M.preds[i].forEach(function (p) { if ((M.rows[p] || 0) !== (M.rows[i] || 0)) turns[M.col[p]] = 1; }); });
    // a line on to a later band runs down its column's gap in each band it passes, and lands down the gap before its station's column
    conns.forEach(function (c) { for (var b = bandOf(c.p); b < bandOf(c.i); b++) turns[b * per + lcOf(c.p)] = 1; if (lcOf(c.i)) turns[M.col[c.i] - 1] = 1; });
    var chipMax = function (i) { return colW - (turns[M.col[i]] ? 34 : 6); };
    var chipW = function (ch, i) { var a = ch.order && ansOf(ch); return Math.min(chipMax(i), f(ch.s, sk.small, 600) + 26 + (a ? ansW(X, a) + 6 : 0)); };
    // a station's chips stand right above it, so a row starts low enough for them to clear what stands above in their column
    var y = top + 18, rowY = {}, gapAt = [], laneY = function (b, k) { return gapAt[b] + 6 + k * 10; };
    for (var b = 0; b < nB; b++) {
      // a band starts under the lanes between it and the band before
      var floor0 = top + 4;
      if (b) { gapAt[b] = y - 16; floor0 = laneY(b, nK - 1) + 10; y = floor0 + 14; }
      for (var r = rlo[b]; r <= rhi[b]; r++) {
        var ids = rowIds[b + ':' + r] || [], h = 0, yr = y;
        ids.forEach(function (i) { h = Math.max(h, labH(T[i], labW)); });
        if (b === 0 && r === 0 && prefix.length) h = Math.max(h, doneSince || prefix.some(function (p) { return p.kind === 'junction'; }) ? 64 : 22);
        // the edge chips stand 48 apart, centred on the line, so a stack of them starts the row low enough to clear the crumb bar
        if (r === 0) {
          var nl = b === 0 ? leftChips.length : 0, nr = b === nB - 1 ? rightChips.length : 0;
          h = Math.max(h, nr * 22, nl * 22); yr = Math.max(yr, floor0 + 14 + (Math.max(nr, nl) - 1) * 24);
        }
        ids.forEach(function (i) {
          if (!topChips[i]) return;
          var a = xOf(i) - 12, bx = a + Math.max.apply(null, topChips[i].map(function (ch) { return chipW(ch, i); })), floor = floor0;
          for (var q = rlo[b]; q < r; q++) (rowIds[b + ':' + q] || []).forEach(function (j) { if (xOf(j) - 10 + labW > a && xOf(j) - 14 < bx) floor = Math.max(floor, rowY[b + ':' + q] + 30 + labH(T[j], labW)); });
          yr = Math.max(yr, floor + 8 + (topChips[i].length - 1) * 28 + 45);
        });
        rowY[b + ':' + r] = yr; y = yr + 30 + h + 24;
      }
    }
    M.ids.forEach(function (i) { if (M.loose.indexOf(i) < 0) pos[i] = { x: xOf(i), y: rowY[bandOf(i) + ':' + (M.rows[i] || 0)], w: 0, h: 0 }; });
    var y0 = rowY['0:0'], yL = rowY[(nB - 1) + ':0'], px = pad + edgeL, lineStart = null;
    // a line on to a later band: down its column's gap, along its lane between the bands, down the margin or the gap before its station, in
    var foldPath = function (c) {
      var a = pos[c.p], b = pos[c.i], ly = laneY(bandOf(c.i), c.k), q = 10;
      var j = conns.filter(function (o) { return o !== c && bandOf(o.p) === bandOf(c.p) && lcOf(o.p) === lcOf(c.p) && conns.indexOf(o) < conns.indexOf(c); }).length;
      var gx = a.x + colW - 17 + 6 * Math.min(j, 2), xl = lcOf(c.i) ? b.x - 31 - 4 * Math.min(c.k, 2) : x0 - 9 - 10 * c.k;
      return 'M' + a.x + ' ' + a.y + 'H' + n1(gx - q) + 'Q' + n1(gx) + ' ' + a.y + ' ' + n1(gx) + ' ' + (a.y + q) + 'V' + n1(ly - q) + 'Q' + n1(gx) + ' ' + n1(ly) + ' ' + n1(gx - q) + ' ' + n1(ly) +
        'H' + n1(xl + q) + 'Q' + n1(xl) + ' ' + n1(ly) + ' ' + n1(xl) + ' ' + n1(ly + q) + 'V' + (b.y - q) + 'Q' + n1(xl) + ' ' + b.y + ' ' + n1(xl + q) + ' ' + b.y + 'H' + b.x;
    };
    var connOf = function (p, i) { return conns.filter(function (c) { return c.p === p && c.i === i; })[0]; };
    prefix.forEach(function (p) {
      if (p.kind === 'bead') {
        var sw = doneSince ? Math.max(f(doneSince + ' since', sk.idfs, 650), f('you looked', sk.idfs, 650)) : 0;
        under.push(hitG(X, 'bead:' + tr.id, px, y0 - 11, Math.max(72, sw), doneSince ? 61 : 22, '', 11) + '<rect x="' + px + '" y="' + (y0 - 11) + '" width="72" height="22" rx="11" fill="' + C.card2 + '" stroke="' + C.line + '" stroke-width="2"/>' +
          txt(px + 36, y0 + 4.5, tr.doneRun + ' done', sk.small, C.sec, { wt: 650, anchor: 'middle' }) +
          (doneSince ? txt(px, y0 + 32, doneSince + ' since', sk.idfs, C.sky, { wt: 650 }) + txt(px, y0 + 46, 'you looked', sk.idfs, C.sky, { wt: 650 }) : '') + '</g>');
        // a track with every task done says so beside its bead
        if (!M.ids.length && !rightChips.length) parts.push(txt(px + 88, y0 + 4.5, 'Nothing open', sk.small, C.sec));
        lineStart = px + 72;
      } else {
        // the side track's name keeps to its junction's column, so it never runs into the next one's
        var t = T[p.id], cx = px + 12, lv = leaves(t) && wrap(X, leaves(t), p.w - 6, sk.small, 650, 1)[0];
        pos[p.id] = { x: cx, y: y0, w: 0, h: 0 };
        parts.push(stn(t, cx, y0, { x: cx - 10, y: y0 + 32, idOnly: true }));
        if (lv) parts.push(hitG(X, 'trk:' + t.leaves, cx - 10, y0 + 32 + sk.slh - 13, Math.max(f(lv, sk.small, 650), f('leaves here', sk.small, 400)), 2 * sk.slh, '', 4) +
          txt(cx - 10, y0 + 32 + sk.slh, lv, sk.small, C.link, { wt: 650, deco: 'underline' }) + txt(cx - 10, y0 + 32 + 2 * sk.slh, 'leaves here', sk.small, C.sec) + '</g>');
        if (lineStart === null) lineStart = cx;
      }
      px += p.w;
    });
    var sp = spine.filter(function (i) { return pos[i]; });
    if (lineStart !== null && sp.length) under.unshift('<path d="M' + lineStart + ' ' + y0 + 'H' + pos[sp[0]].x + '" stroke="' + C.line + '" stroke-width="3.5"/>');
    // the waits go under the spine, so one running along it never hollows the critical path
    var s0 = under.length;
    for (var s = 1; s < sp.length; s++) {
      var lc = lineCol(sp[s - 1], sp[s]), sc = connOf(sp[s - 1], sp[s]);
      under.push('<path class="' + lin(sp[s - 1], sp[s]) + '" d="' + (sc ? foldPath(sc) : 'M' + pos[sp[s - 1]].x + ' ' + pos[sp[s - 1]].y + 'H' + pos[sp[s]].x) + '"' + (sc ? ' fill="none"' : '') + ' stroke="' + lc[0] + '" stroke-width="' + lc[1] + '"/>');
    }
    // a wait off the spine travels along its own row and turns in the gap beside the station off the spine
    M.ids.forEach(function (i) {
      M.preds[i].forEach(function (p) {
        var a = pos[p], b = pos[i]; if (!a || !b) return;
        if (onSpine(p) && onSpine(i) && a.y === rowY[bandOf(p) + ':0'] && b.y === rowY[bandOf(i) + ':0']) return;
        var lc = lineCol(p, i), wdt = lc[1] === 5 ? 5 : 3, dd, fc = connOf(p, i);
        if (fc) dd = foldPath(fc);
        else if (a.y === b.y) dd = 'M' + a.x + ' ' + a.y + 'H' + b.x;
        else {
          // the turn sits in the first gap after the station waited on, so a branch and a join never share a gap
          var gx = a.x + colW - 25, dy = b.y > a.y ? 12 : -12;
          dd = 'M' + a.x + ' ' + a.y + 'H' + (gx - 12) + 'Q' + gx + ' ' + a.y + ' ' + gx + ' ' + (a.y + dy) + 'V' + (b.y - dy) + 'Q' + gx + ' ' + b.y + ' ' + (gx + 12) + ' ' + b.y + 'H' + b.x;
        }
        under.splice(s0++, 0, '<path class="' + lin(p, i) + '" d="' + dd + '" fill="none" stroke="' + lc[0] + '" stroke-width="' + wdt + '" stroke-linejoin="round"/>');
      });
    });
    // chips stacked right above their station, a short stub down to it
    Object.keys(topChips).forEach(function (i) {
      var p = pos[i]; if (!p) return;
      var lst = topChips[i], cy = p.y - 34 - (lst.length - 1) * 28;
      lst.forEach(function (ch, n) { parts.push(chip1(ch, p.x - 12, cy + n * 28, chipMax(i), chipLit(i, ch))); });
      under.push('<path' + cls('stn:' + i, lit) + ' d="M' + p.x + ' ' + (p.y - 23) + 'V' + (p.y - 10) + '" stroke="' + C.cross + '" stroke-width="2" stroke-dasharray="3 3"/>');
    });
    // chips at the line's two ends
    // the right chips stand at the end of the last band's line
    var lastX = 0; M.ids.forEach(function (i) { if (pos[i] && pos[i].y === yL && M.loose.indexOf(i) < 0 && bandOf(i) === nB - 1) lastX = Math.max(lastX, pos[i].x); });
    var rx = x0 + Math.min(per, M.ncol) * colW + 14;
    rightChips.forEach(function (ch, n) {
      var yc = yL + (n - (rightChips.length - 1) / 2) * 48, fx = ch.from && pos[ch.from] ? pos[ch.from].x : lastX, a = ansOf(ch);
      under.push('<path' + edgeCls(ch) + ' d="M' + (fx + 10) + ' ' + yL + 'C' + (fx + 34) + ' ' + yL + ' ' + (rx - 26) + ' ' + yc + ' ' + rx + ' ' + yc + '" fill="none" stroke="' + (ch.order ? C.lav : C.cross) + '" stroke-width="2" stroke-dasharray="4 4"/>');
      parts.push(chip2(ch, rx, yc));
      if (ch.order && a) parts.push('<g' + edgeCls(ch) + '>' + ansChip(X, rx + chip2W(ch) + 6, yc, a, 'ans:' + ch.ans) + '</g>');
    });
    var firstX = prefix.length ? pad + edgeL : (sp.length ? pos[sp[0]].x : x0);
    leftChips.forEach(function (ch, n) {
      var yc = y0 + (n - (leftChips.length - 1) / 2) * 48, w = chip2W(ch), x = pad, a = ansOf(ch);
      under.push('<path' + edgeCls(ch) + ' d="M' + (x + w) + ' ' + yc + 'C' + (x + w + 22) + ' ' + yc + ' ' + (firstX - 30) + ' ' + y0 + ' ' + (firstX - 10) + ' ' + y0 + '" fill="none" stroke="' + (ch.order ? C.lav : C.cross) + '" stroke-width="2" stroke-dasharray="4 4"/>');
      parts.push(chip2(ch, x, yc));
      if (ch.order && a) parts.push('<g' + edgeCls(ch) + '>' + ansChip(X, x + 6, yc + 34, a, 'ans:' + ch.ans) + '</g>');
    });
    M.ids.forEach(function (i) { if (pos[i]) parts.push(stn(T[i], pos[i].x, pos[i].y, { x: pos[i].x - 10, y: pos[i].y + 30, w: labW })); });
    var H = y;
    if (M.loose.length) {
      parts.push(txt(x0 + 6, H + 2, 'ON THEIR OWN: NOTHING WAITS ON THEM', sk.idfs, C.dim, { wt: 700, ls: 1.1 }));
      var lx = x0 + 16, ly = H + 34, maxH = 0;
      M.loose.forEach(function (i, n) {
        var t = T[i]; if (lx + colW > W - pad + 10 && n) { lx = x0 + 16; ly += maxH + 54; maxH = 0; }
        pos[i] = { x: lx, y: ly, w: 0, h: 0 };
        parts.push(stn(t, lx, ly, { x: lx - 10, y: ly + 30, w: labW }));
        maxH = Math.max(maxH, labH(t, labW)); lx += colW;
      });
      H = ly + 30 + maxH + 16;
    }
    return finish(X, W, H, under.join('') + parts.join(''), pos);
  }
  // narrow: one station a row; the spine a straight rail, other waits on rails beside it, the words to the right
  // the marks two thirds of the line's, the rails closer, so the words start further left
  railMode = true; RK = W < 300 ? 0.62 : 0.68;
  var railX = {}, rowsUsed = [0], RS = W < 300 ? 9 : 11;
  M.ids.forEach(function (i) { var r = M.rows[i]; if (r !== undefined && rowsUsed.indexOf(r) < 0) rowsUsed.push(r); });
  rowsUsed.sort(function (a, b) { return Math.abs(a) - Math.abs(b) || a - b; }).forEach(function (r, n) { railX[r] = pad + 10 + n * RS; });
  var x0n = railX[0], nameX = pad + 10 + (rowsUsed.length - 1) * RS + (W < 300 ? 12 : 15), lw = W - nameX - pad;
  var seq = M.ids.filter(function (i) { return M.loose.indexOf(i) < 0; }).sort(function (a, b) {
    var ra = M.rows[a] || 0, rb = M.rows[b] || 0;
    return M.col[a] - M.col[b] || (ra === 0 ? 0 : 1) - (rb === 0 ? 0 : 1) || ra - rb;
  });
  var yN = top + 12, firstY = null;
  // a chip on the rails, from its top edge; two lines when one does not fit, its answer beside it or under it
  var chipRow = function (ch, y1, x, lk) {
    var room = W - x - pad, L = wrap(X, ch.s, room - 26, sk.small, 600, 2), h = L.length > 1 ? 38 : 22, col = ch.order ? C.lav : C.cross, lc = lit ? (lk ? 'lit' : 'dimmed') : '';
    var w = Math.min(room, Math.max.apply(null, L.map(function (l) { return f(l, sk.small, 600); })) + 26), a = ansOf(ch);
    var s = hitG(X, ch.k, x, y1, w, h, lc, 11) + '<rect x="' + n1(x) + '" y="' + n1(y1) + '" width="' + n1(w) + '" height="' + h + '" rx="11" fill="' + C.bg + '" stroke="' + col + '" stroke-width="1.2"' + (ch.order ? ' stroke-dasharray="4 3"' : '') + '/>';
    L.forEach(function (l, n) { s += txt(x + 13, y1 + 15.3 + n * 16, l, sk.small, ch.order ? C.lav : C.link, { wt: 600 }); });
    s += '</g>';
    if (ch.order && a) {
      var aw = ansW(X, a), beside = x + w + 6 + aw <= W - pad;
      s += '<g' + (lc ? ' class="' + lc + '"' : '') + '>' + ansChip(X, beside ? x + w + 6 : x, beside ? y1 + h / 2 : y1 + h + 15, a, 'ans:' + ch.ans) + '</g>';
      if (!beside) h += 26;
    }
    return { s: s, h: h };
  };
  var addChip = function (ch, y1, x, lk) { var c = chipRow(ch, y1, x, lk); parts.push(c.s); return c.h; };
  leftChips.forEach(function (ch) { yN += addChip({ s: ch.a + ' ' + ch.b, k: ch.k, order: ch.order, ans: ch.ans }, yN - 11, pad) + 8; });
  if (leftChips.length) yN += 8;
  if (tr.doneRun) {
    // the bead and its words are one press
    var bw = Math.max(f(tr.doneRun + ' done', sk.small, 650), doneSince ? f(doneSince + ' since you looked', sk.small, 600) : 0);
    var bx = n1(11 * RK), bh = n1(34 * RK);
    parts.push(hitG(X, 'bead:' + tr.id, x0n - bx, yN - 4, nameX + bw - x0n + bx, 34, '', 11) + '<rect x="' + n1(x0n - bx) + '" y="' + (yN - 4) + '" width="' + 2 * bx + '" height="' + bh + '" rx="' + bx + '" fill="' + C.card2 + '" stroke="' + C.line + '" stroke-width="' + n1(2 * RK) + '"/>' +
      txt(nameX, yN + 9, tr.doneRun + ' done', sk.small, C.sec, { wt: 650 }) + (doneSince ? txt(nameX, yN + 9 + sk.slh, doneSince + ' since you looked', sk.small, C.sky, { wt: 600 }) : '') + '</g>');
    firstY = yN - 4 + bh; yN += 52;
  }
  list(tr.junctions).forEach(function (j) {
    var t = T[j]; if (!t) return;
    // the side track's name gives way so "leaves here" keeps the line
    var lv = leaves(t) && wrap(X, leaves(t), lw - f('leaves here', sk.small, 400) - 6, sk.small, 650, 1)[0]; pos[j] = { x: x0n, y: yN + 8, w: 0, h: 0 };
    parts.push(stn(t, x0n, yN + 8, { x: nameX, y: yN + 4, idOnly: true }));
    if (lv) parts.push(hitG(X, 'trk:' + t.leaves, nameX, yN + 4 + sk.slh - 13, f(lv, sk.small, 650) + 6 + f('leaves here', sk.small, 400), sk.slh, '', 4) +
      txt(nameX, yN + 4 + sk.slh, lv, sk.small, C.link, { wt: 650, deco: 'underline' }) + txt(nameX + f(lv, sk.small, 650) + 6, yN + 4 + sk.slh, 'leaves here', sk.small, C.sec) + '</g>');
    if (firstY === null) firstY = yN + 8;
    yN += 48;
  });
  seq.forEach(function (i) {
    var t = T[i], x = railX[M.rows[i]] !== undefined ? railX[M.rows[i]] : x0n;
    pos[i] = { x: x, y: yN + 8, w: 0, h: 0 };
    parts.push(stn(t, x, yN + 8, { x: nameX, y: yN + 4, w: lw }));
    yN += labH(t, lw) + 4;
    inline[i].forEach(function (ch) { yN += addChip(ch, yN + 1, nameX, chipLit(i, ch)) + 4; });
    yN += 18;
  });
  rightChips.filter(function (ch) { return ch.order && !ch.from; }).forEach(function (ch) { yN += addChip({ s: ch.a + ' ' + ch.b, k: ch.k, order: true, ans: ch.ans }, yN - 11, pad) + 8; });
  var sp2 = spine.filter(function (i) { return pos[i]; });
  if (firstY !== null && sp2.length) under.push('<path d="M' + x0n + ' ' + firstY + 'V' + pos[sp2[0]].y + '" stroke="' + C.line + '" stroke-width="' + n1(3.5 * RK) + '"/>');
  for (var s2 = 1; s2 < sp2.length; s2++) { var lc2 = lineCol(sp2[s2 - 1], sp2[s2]); under.push('<path class="' + lin(sp2[s2 - 1], sp2[s2]) + '" d="M' + x0n + ' ' + pos[sp2[s2 - 1]].y + 'V' + pos[sp2[s2]].y + '" stroke="' + lc2[0] + '" stroke-width="' + n1(lc2[1] * RK) + '"/>'); }
  M.ids.forEach(function (i) {
    M.preds[i].forEach(function (p) {
      if (spine.indexOf(i) >= 0 && spine.indexOf(p) >= 0) return;
      var a = pos[p], b = pos[i]; if (!a || !b) return;
      // a turn no wider than the rails are apart
      var q = Math.min(10, Math.abs(a.x - b.x));
      var dd = a.x === b.x ? 'M' + a.x + ' ' + a.y + 'V' + b.y
        : b.x < a.x ? 'M' + a.x + ' ' + a.y + 'V' + (b.y - q - 2) + 'Q' + a.x + ' ' + b.y + ' ' + (a.x - q) + ' ' + b.y + 'H' + b.x
        : 'M' + a.x + ' ' + a.y + 'H' + (b.x - q) + 'Q' + b.x + ' ' + a.y + ' ' + b.x + ' ' + (a.y + q + 2) + 'V' + b.y;
      under.push('<path class="' + lin(p, i) + '" d="' + dd + '" fill="none" stroke="' + C.line + '" stroke-width="' + n1(3 * RK) + '"/>');
    });
  });
  if (M.loose.length) {
    yN += 14;
    var hd = 'ON THEIR OWN: NOTHING WAITS ON THEM', hdL = f(hd, sk.idfs, 700) + hd.length * 1.1 > W - 2 * pad - 4 ? ['ON THEIR OWN:', 'NOTHING WAITS ON THEM'] : [hd];
    hdL.forEach(function (l, n) { parts.push(txt(pad + 2, yN + n * 15, l, sk.idfs, C.dim, { wt: 700, ls: 1.1 })); });
    yN += 24 + (hdL.length - 1) * 15;
    M.loose.forEach(function (i) {
      var t = T[i]; pos[i] = { x: x0n, y: yN + 8, w: 0, h: 0 };
      parts.push(stn(t, x0n, yN + 8, { x: nameX, y: yN + 4, w: lw }));
      yN += labH(t, lw) + 22;
    });
  }
  return finish(X, W, yN + 8, under.join('') + parts.join(''), pos);
}

/* ================= the picture ================= */
function finish(X, W, H, inner, pos) {
  var w = Math.round(W), h = Math.round(H), font = X.sk.font.replace(/'/g, '');
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" class="apic" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" font-family=\'' + font + '\' role="img" aria-label="Where we stand">' +
    styleOf(X.skin, inner) + inner + '</svg>';
  return { svg: svg, w: w, h: h, pos: pos, hits: X.hits };
}
/* opt: { skin: 'web' | 'narrow' | 'pane', width, measure(text, px, weight), icons: { fav, quiet, block }, hover, top }.
   hits list every press zone in picture px, the later ones drawn over the earlier. */
export function drawPicture(P, V, opt) {
  opt = opt || {};
  var skin = opt.skin || 'web', sk = skinOf(skin), m = opt.measure;
  var X = {
    P: P, V: V, skin: skin, sk: sk, C: sk.c, W: opt.width || 600, icons: opt.icons || {}, hits: [], nIcon: 0,
    top: opt.top === undefined || opt.top === null ? (skin === 'pane' ? 8 : 50) : opt.top,
    tw: function (s, px, wt) { s = plain(String(s)); return m ? m(s, px, wt || 400) : s.length * px * 0.55; },
    lit: traceSet(P, V, V.sel || opt.hover || null)
  };
  if (V.level === 0) return drawOverview(X);
  if (V.level === 1) return drawWorkstream(X);
  return drawTrack(X);
}

/* ================= the detail strip: words in place of tooltips ================= */
// the line naming another workstream's wait on a task: the Overview link's words, else the Out's
function outText(P, ws, task, fallback) {
  var l = list(P.ovLinks).filter(function (x) { return x.from === ws && list(x.pairs).some(function (q) { return q[1] === task; }); })[0];
  return l ? l.text : fallback;
}
// the track page's review readout in the strip's words: code finished that no review covers yet
// a line said once, however many waits it stands for
function uniq(a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); }
function reviewWords(n) { return n + ' finished code task' + (n === 1 ? ' waits' : 's wait') + ' for a review'; }
export function detail(P, V, key) {
  if (!key) return null;
  var T = P.tasks || {}, i = key.indexOf(':'), kind = key.slice(0, i), id = key.slice(i + 1), when = lookWords(P);
  var onTrack = function (x) { var tt = T[x]; return tt ? ' (on ' + trName(P, tt.tr) + ')' : ''; };
  var named = function (x) { return x + (T[x] ? ' ' + T[x].name : ''); };
  if (kind === 'stn') {
    var t = T[id]; if (!t) return null;
    var tr = trackOf(P, t.tr), Wd = (tr && P.ws[tr.ws]) || { links: [], out: [], in: [] }, d = { id: id, name: t.name, chips: [], facts: [], acts: [] };
    var st = { now: ['running', 'active'], held: ['in progress', 'active'], left: ['in progress, nobody on it', ''], ready: ['ready', 'active'], gated: ['waits on your answer', 'gated'], done: ['done', ''] }[t.st] || ['waiting', ''];
    if (t.st === 'now' && t.ended) st = [t.ended === 'stopped' ? 'stopped, next leg due' : 'finished, landing', 'active'];
    d.chips.push(st);
    if (list(Wd.crit && Wd.crit.path).indexOf(id) >= 0) d.chips.push(['critical path', 'crit']);
    if (t.review) d.chips.push(['review', '']);
    d.facts.push(['On', t.tr + ' ' + (tr ? shortName(tr) + ', ' + tr.ws : '')]);
    if (t.st === 'now') d.facts.push(['Who', t.agent ? 'the ' + t.agent + ' agent, sent by the session' + (t.ended ? ', ' + (t.ended === 'stopped' ? 'stopped before its end' : 'finished') : '') : 'the session']);
    else if (t.by) d.facts.push(['Run by', t.by]);
    var w = list(t.waits).map(named).concat(list(t.cross).map(function (x) { return named(x) + onTrack(x); }));
    list(Wd.in).forEach(function (o) { if (o.task === id) w.push(o.text); });
    d.facts.push(['Waits on', w.length ? w : ['nothing: it can start']]);
    var fr = list(t.frees).map(function (x) { return named(x) + (T[x] && T[x].tr !== t.tr ? onTrack(x) : ''); });
    list(Wd.out).forEach(function (o) { if (o.task === id) fr.push(outText(P, tr ? tr.ws : '', id, o.text)); });
    d.facts.push(['Frees', fr.length ? uniq(fr) : ['nothing waits on it']]);
    if (t.leaves) { var lv = trackOf(P, t.leaves); d.facts.push(['Side track', (lv ? lv.name : t.leaves) + ' leaves here']); }
    var a = t.ans && P.ans && P.ans[t.ans];
    if (a) d.facts.push(['Your answer', t.ans + ' (' + a.name + '): ' + a.tok + ', ' + a.said + '.']);
    if (t.fresh && when) d.facts.push(['Since ' + when, t.fresh === 'new' ? (t.st === 'now' ? 'filed and started after your last look' : 'filed after your last look') : t.fresh === 'started' ? 'started after your last look' : 'finished after your last look']);
    d.acts.push({ label: 'Open ' + id, k: 'open:' + id });
    d.hint = 'Press the station again to open it. Press the ground to clear.';
    return d;
  }
  if (kind === 'pill') {
    var tr2 = trackOf(P, id); if (!tr2) return null;
    var W2 = P.ws[tr2.ws], d2 = { id: id, name: tr2.name, chips: [], facts: [], acts: [] };
    d2.chips.push([tr2.state, tr2.state === 'parked' ? 'parked' : tr2.state === 'active' ? 'active' : '']);
    if (tr2.stalled) d2.chips.push([tr2.stalled, 'stalled']);
    d2.facts.push(['Where it stands', tr2.open + ' open: ' + runParts(tr2, ' ') + (tr2.ready ? tr2.ready + ' ready, ' : '') + (tr2.waiting || 0) + ' waiting; longest chain ' + tr2.chain + '; ' + tr2.done + ' of ' + (tr2.done + tr2.open) + ' done']);
    var ins = [], outs = [];
    var orderWhy = function (l) { var a2 = l.ans && P.ans && P.ans[l.ans]; return '(' + (a2 ? a2.tok + ', ' : '') + 'the track order)'; };
    list(W2.links).forEach(function (l) {
      var lf = trackOf(P, l.from), lt = trackOf(P, l.to);
      if (l.to === id) ins.push(l.kind === 'order' ? 'opens when ' + orderWhen(P, l, lf ? lf.name : l.from) + ' ' + orderWhy(l) : list(l.pairs).map(function (q) { return q[0] + ' waits on ' + named(q[1]) + ' (on ' + trName(P, l.from) + ')'; }).join('; '));
      if (l.from === id) outs.push(l.kind === 'order' ? (lt ? lt.name : l.to) + ' opens when ' + (l.on ? orderWhen(P, l) : 'this ends') : list(l.pairs).map(function (q) { return named(q[0]) + ' (on ' + trName(P, l.to) + ') waits on ' + q[1]; }).join('; '));
    });
    list(W2.in).forEach(function (o) { if (o.to === id) ins.push(o.text); });
    list(W2.out).forEach(function (o) { if (o.from === id) outs.push(outText(P, tr2.ws, o.task, o.text)); });
    if (tr2.from) d2.facts.push(['Branched from', named(tr2.from) + onTrack(tr2.from)]);
    d2.facts.push(['Waits on', ins.length ? uniq(ins) : ['nothing']]);
    d2.facts.push(['Frees', outs.length ? uniq(outs) : ['nothing outside it']]);
    if (tr2.train) { var nm = list(tr2.train.names); d2.facts.push(['On it', 'the session' + (nm.length ? ', with the ' + joinAnd(nm) + ' agent' + (nm.length > 1 ? 's' : '') : '')]); }
    if (tr2.reviewDue) d2.facts.push(['Review due', reviewWords(tr2.reviewDue)]);
    if (tr2.resume) d2.facts.push(['Resume', tr2.resume]);
    if (tr2.changed && when) d2.facts.push(['Since ' + when, tr2.changed]);
    d2.acts.push({ label: 'Open ' + id, k: 'zoom:' + id });
    d2.hint = 'Press the pill again to open the track. Press the ground to clear.';
    return d2;
  }
  if (kind === 'link') {
    var ab = id.split('>'), W3 = P.ws[V.ws] || { links: [] }, l = list(W3.links).filter(function (x) { return x.from === ab[0] && x.to === ab[1]; })[0];
    if (!l) return null;
    var ta = trackOf(P, ab[0]), tb = trackOf(P, ab[1]), d3 = { id: '', name: trName(P, ab[1]) + ' waits on ' + trName(P, ab[0]), chips: [], facts: [], acts: [] };
    var la = l.ans && P.ans && P.ans[l.ans];
    if (l.kind === 'order') d3.facts.push(['Why', (tb ? tb.name : ab[1]) + ' opens when ' + orderWhen(P, l, ta ? ta.name : ab[0]) + ': the track order' + (la ? ', ' + la.tok : '')]);
    else { var pn = list(l.pairs).length; d3.facts.push([pn + (pn === 1 ? ' wait' : ' waits'), list(l.pairs).map(function (q) { return named(q[0]) + ' waits on ' + named(q[1]); })]); }
    d3.acts.push({ label: 'Open ' + trName(P, ab[0]), k: 'zoom:' + ab[0] }, { label: 'Open ' + trName(P, ab[1]), k: 'zoom:' + ab[1] });
    return d3;
  }
  if (kind === 'ans') {
    var a3 = P.ans && P.ans[id]; if (!a3) return null;
    return { id: id, name: a3.name, chips: [['answered ' + a3.on, '']], facts: [['Your answer', a3.tok + ', ' + a3.said + '.'], ['What it settles', a3.settles]], acts: [{ label: 'Open ' + id, k: 'open:' + id }] };
  }
  if (kind === 'ws') {
    var o = list(P.ov).filter(function (x) { return x.id === id; })[0]; if (!o) return null;
    var d4 = { id: id, name: o.name, chips: [[o.state, o.state === 'parked' ? 'parked' : o.state === 'active' ? 'active' : '']], facts: [], acts: [] };
    if (o.stalled) d4.chips.push([o.stalled, 'stalled']);
    if (o.gated) d4.chips.push(['waits on your answer', 'gated']);
    d4.facts.push(['Tracks', o.words], ['Where it stands', o.counts]);
    list(P.ovLinks).forEach(function (l) { if (l.to === id) d4.facts.push(['Waits on', l.text]); if (l.from === id) d4.facts.push(['Frees', l.text]); });
    if (o.gated) d4.facts.push(['Waits on you', o.gated]);
    else if (o.needs) d4.facts.push(['Needs you', o.needs]);
    if (o.changed && when) d4.facts.push(['Since ' + when, o.changed]);
    d4.acts.push({ label: 'Open ' + id, k: o.opens ? 'zoomws:' + id : 'open:' + id });
    if (o.gated && list(o.gatedQ).length) d4.acts.push({ label: 'Answer', k: 'answer:' + o.gatedQ[0], answer: true });
    d4.hint = o.opens ? 'Press the pill again to open the workstream.' : '';
    return d4;
  }
  if (kind === 'wlink') {
    var wb = id.split('>'), wl = list(P.ovLinks).filter(function (x) { return x.from === wb[0] && x.to === wb[1]; })[0];
    if (!wl) return null;
    var wn = wl.n || list(wl.pairs).length || 1, of = list(P.ov).filter(function (x) { return x.id === wb[0]; })[0];
    return { id: '', name: wb[1] + ' waits on ' + wb[0], chips: [], facts: [[wn + (wn === 1 ? ' wait' : ' waits'), wl.text]], acts: [{ label: 'Open ' + wb[0], k: of && of.opens ? 'zoomws:' + wb[0] : 'open:' + wb[0] }] };
  }
  if (kind === 'bead') {
    var trb = trackOf(P, id); if (!trb) return null;
    var since = Array.isArray(trb.doneSince) ? trb.doneSince : [], dl = list(trb.doneList);
    var nameOf = function (x) { var e = dl.filter(function (q) { return q.id === x; })[0]; return e ? x + ' ' + e.name : x; };
    var facts = [['What', 'The finished run of ' + shortName(trb) + ', one bead; the stations a side track leaves from stay drawn.']];
    if (trb.reviewDue) facts.push(['Review due', reviewWords(trb.reviewDue)]);
    if (sinceCount(trb.doneSince) && when) facts.push(['Since ' + when, since.length ? [since.length + ' finished:'].concat(since.map(nameOf)) : sinceCount(trb.doneSince) + ' finished']);
    return { id: id, name: trb.doneRun + ' finished tasks, folded', chips: [], facts: facts, acts: [{ label: 'List them', k: 'list:' + id }] };
  }
  return null;
}

/* ================= the legend, the crumbs, the since line ================= */
export function legend(P, V, skin, opt) {
  opt = opt || {};
  var sk = skinOf(skin), C = sk.c, m = opt.measure;
  var X = { sk: sk, C: C, hits: [], tw: function (s, px, wt) { s = String(s); return m ? m(s, px, wt || 400) : s.length * px * 0.55; } };
  var box = function (w, h, inner) { return '<svg xmlns="http://www.w3.org/2000/svg" class="apic" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" aria-hidden="true">' + (skin === 'pane' ? styleOf(skin, inner) : '') + inner + '</svg>'; };
  var mk = function (kind) { var t = { st: kind, waits: [], cross: [] }; if (kind === 'review') { t.review = true; t.st = 'waits'; } return box(18, 18, stationMark(t, 9, 9, C)); };
  var rail = function (col, w, dash) { return box(30, 12, '<path d="M2 6H28" stroke="' + col + '" stroke-width="' + w + '" stroke-linecap="round"' + (dash ? ' stroke-dasharray="' + dash + '"' : '') + '/>'); };
  var pillMk = function (fill, stroke, dash) { return box(30, 16, '<rect x="1" y="2" width="28" height="12" rx="6" fill="' + fill + '" stroke="' + stroke + '" stroke-width="1.4"' + (dash ? ' stroke-dasharray="4 3"' : '') + '/>'); };
  var it = [];
  if (V.level === 2) {
    it.push([mk('now'), 'running now'], [mk('ready'), 'ready to start'], [mk('waits'), 'waits on the tasks before it']);
    var T = P.tasks || {};
    if (Object.keys(T).some(function (k) { return T[k].tr === V.tr && T[k].st === 'gated'; })) it.push([mk('gated'), 'waits on your answer']);
    it.push([mk('review'), 'a review'], [mk('done'), 'done, kept where a side track leaves']);
    it.push([box(34, 18, '<rect x="2" y="3" width="30" height="12" rx="6" fill="' + C.card2 + '" stroke="' + C.line + '" stroke-width="2"/>'), 'a finished run, folded']);
  } else {
    it.push([pillMk(C.skyBg, C.sky), 'active'], [pillMk(C.card, C.cross), 'waiting for a session'], [pillMk('none', C.text, true), 'new'], [pillMk(C.lavBg, C.lav), 'parked, dimmed']);
    it.push([rail(C.cross, 2.4), 'a wait, with its count'], [rail(C.lav, 2.2, '6 5'), 'opens when the one before ends']);
  }
  it.push([rail(C.crit, 5), 'critical path, the longest chain left']);
  it.push([box(48, 14, trainSvg(1, 7, 1, C)), 'a session, its agents as cars']);
  it.push([box(40, 18, freshTag(X, 2, 9, 'new')), 'changed since your last look']);
  var ak = Object.keys(P.ans || {})[0], tok = ak ? P.ans[ak].tok : '1a';
  it.push([box(Math.ceil(ansW(X, { tok: tok }) + 6), 24, ansChip(X, 2, 12, { tok: tok }, '')), 'your answer']);
  // opt.wrap { width, gap, px, measure }: the words in lines that fit the width beside the mark
  var wr = opt.wrap, lines = function (svg, words) {
    if (!wr || !(wr.width > 0)) return [words];
    var room = wr.width - Number((/width="([\d.]+)"/.exec(svg) || [])[1] || 0) - (wr.gap || 0), out = [], cur = '';
    var fit = function (s) { return (wr.measure || X.tw)(s, wr.px || 14, 400) <= room; };
    words.split(' ').forEach(function (w) { var t = cur ? cur + ' ' + w : w; if (cur && !fit(t)) { out.push(cur); cur = w; } else cur = t; });
    return out.concat(cur);
  };
  return it.map(function (e) { return { svg: e[0], words: e[1], lines: lines(e[0], e[1]) }; });
}
// the crumbs over the picture: a short form drops the workstream's long name (the pane, a phone)
export function crumbs(P, V, opt) {
  var short = opt && opt.pane, out = [];
  out.push({ words: 'Overview', k: V.level === 0 ? null : 'lvl:0' });
  if (V.level >= 1) out.push({ words: V.ws + (short ? '' : ' ' + wsShort(P, V.ws)).replace(/\s+$/, ''), k: V.level === 1 ? null : 'lvl:1' });
  if (V.level === 2) { var tr = trackOf(P, V.tr); out.push({ words: V.tr + (tr ? ' ' + shortName(tr) : ''), k: null }); }
  return out;
}
// the since line: null with no last look; moved says whether anything here changed
export function sinceWords(P, V, opt) {
  if (!P.look) return null;
  var pane = opt && opt.pane, when = lookWords(P), words, moved;
  if (V.level === 0) {
    var ch = list(P.ov).filter(function (o) { return o.changed; });
    moved = ch.length > 0;
    words = moved ? ch.map(function (o) { return o.id + ' changed: ' + o.changed; }).join('; ') + '.' + (!pane && ch.length < list(P.ov).length ? ' Nothing else moved.' : '')
      : (pane ? 'nothing moved.' : 'Nothing moved.');
  } else {
    var c = P.ws[V.ws] && P.ws[V.ws].changed;
    moved = !!c; words = c ? c.n + '.' : (pane ? 'nothing changed here.' : 'Nothing changed here.');
  }
  return { when: when, words: words, moved: moved };
}

/* ================= the address: a link keeps the view ================= */
export function viewPath(V) {
  var sel = V.sel ? V.sel.slice(V.sel.indexOf(':') + 1).replace('>', '-') : '';
  if (V.level === 0) return '/' + (sel ? '?sel=' + sel : '');
  var q = [];
  if (V.level === 2) q.push('at=' + V.tr);
  if (sel) q.push('sel=' + sel);
  return '/ws/' + V.ws + (q.length ? '?' + q.join('&') : '');
}
function queryOf(query) {
  if (!query) return {};
  if (typeof query !== 'string') { if (typeof query.get === 'function') return { at: query.get('at'), sel: query.get('sel') }; return query; }
  var q = {};
  query.replace(/^\?/, '').split('&').forEach(function (kv) { var a = kv.split('='); if (a[0]) q[decodeURIComponent(a[0])] = decodeURIComponent(a[1] || ''); });
  return q;
}
// the view an address names, or null; P, when given, finds a record page's workstream
export function viewOf(path, query, P) {
  var q = queryOf(query), V = { level: 0, ws: null, tr: null, sel: null }, m;
  path = String(path || '/');
  if ((m = path.match(/^\/r\/(TR-\d+)\/?$/))) { V.level = 2; V.tr = m[1]; V.ws = P ? wsOfTrack(P, m[1]) : null; }
  else if ((m = path.match(/^\/ws\/(WS-\d+)\/?$/))) { V.ws = m[1]; V.level = q.at ? 2 : 1; V.tr = q.at || null; }
  else if (path !== '/') return null;
  var s = q.sel || '';
  if (/^T-\d+$/.test(s)) V.sel = 'stn:' + s;
  else if (/^TR-\d+-TR-\d+$/.test(s)) V.sel = 'link:' + s.replace(/^(TR-\d+)-/, '$1>');
  else if (/^WS-\d+-WS-\d+$/.test(s)) V.sel = 'wlink:' + s.replace(/^(WS-\d+)-/, '$1>');
  else if (/^TR-\d+$/.test(s)) V.sel = (V.level === 2 && s === V.tr ? 'bead:' : 'pill:') + s;
  else if (/^Q\d+$/.test(s)) V.sel = 'ans:' + s;
  else if (/^WS-\d+$/.test(s)) V.sel = 'ws:' + s;
  return V;
}

/* ================= a press: the mock's zoom and selection, for both surfaces ================= */
/* returns { view, dir, from } with dir 1 zooming in from the key from, -1 out, 0 in place,
   or one of { open: id, list: TR-n, answer: Qn, copy: path } for the surface to carry out */
export function pressView(P, V, k) {
  var cur = { level: V.level, ws: V.ws, tr: V.tr, sel: V.sel };
  if (!k) return { view: Object.assign(cur, { sel: null }), dir: 0, from: null };
  var i = k.indexOf(':'), kind = i < 0 ? k : k.slice(0, i), id = i < 0 ? '' : k.slice(i + 1);
  var zoom = function (level, ws, tr, fromKey) {
    var dir = level > V.level ? 1 : -1, nv = { level: level, ws: ws || V.ws, tr: tr || null, sel: null };
    if (dir < 0 && level === 1 && V.tr) nv.ws = wsOfTrack(P, V.tr) || nv.ws;
    // zooming out keeps where you came from selected
    if (dir < 0 && fromKey && (level !== 1 || fromKey.indexOf('pill:') === 0)) nv.sel = fromKey;
    return { view: nv, dir: dir, from: fromKey || null };
  };
  if (kind === 'lvl') { var lv = +id; return zoom(lv, null, null, lv === 1 && V.tr ? 'pill:' + V.tr : V.level === 1 ? 'ws:' + V.ws : null); }
  if (kind === 'zoom') return zoom(2, wsOfTrack(P, id), id, 'pill:' + id);
  if (kind === 'zoomws') return P.ws[id] ? zoom(1, id, null, 'ws:' + id) : { open: id };
  if (kind === 'trk') return zoom(2, wsOfTrack(P, id), id, null);
  if (kind === 'jump') { var tj = P.tasks[id]; if (!tj) return { open: id }; return { view: { level: 2, ws: wsOfTrack(P, tj.tr) || V.ws, tr: tj.tr, sel: 'stn:' + id }, dir: 1, from: null }; }
  if (kind === 'open') return { open: id };
  if (kind === 'list') return { list: id };
  if (kind === 'answer') return { answer: id };
  if (kind === 'copy') return { copy: viewPath(V) };
  if (kind === 'out') return V.level === 2 ? zoom(1, null, null, 'pill:' + V.tr) : V.level === 1 ? zoom(0, null, null, 'ws:' + V.ws) : { view: cur, dir: 0, from: null };
  if (kind === 'in') {
    if (V.level === 0) {
      var w = V.sel && V.sel.indexOf('ws:') === 0 && P.ws[V.sel.slice(3)] ? V.sel.slice(3) : (list(P.ov).filter(function (o) { return o.opens && P.ws[o.id]; })[0] || {}).id;
      return w ? zoom(1, w, null, 'ws:' + w) : { view: cur, dir: 0, from: null };
    }
    if (V.level === 1) { var Wd = P.ws[V.ws], t1 = V.sel && V.sel.indexOf('pill:') === 0 ? V.sel.slice(5) : Wd && Wd.tracks[0] && Wd.tracks[0].id; return t1 ? zoom(2, V.ws, t1, 'pill:' + t1) : { view: cur, dir: 0, from: null }; }
    return { view: cur, dir: 0, from: null };
  }
  // a selection: the first press selects and traces, the second opens
  if (V.sel === k) {
    if (kind === 'pill') return zoom(2, V.ws, id, k);
    if (kind === 'ws') return P.ws[id] ? zoom(1, id, null, k) : { open: id };
    if (kind === 'stn') return { open: id };
  }
  cur.sel = k;
  return { view: cur, dir: 0, from: null };
}
