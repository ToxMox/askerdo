/* The board's drawn graph: one
   picture from server/layout.mjs's layout, in the web skin and the phone skin. Pure and plain
   script, so the server writes its list marks and the browser draws the picture with it. */
export var SKIN_WEB = {
  pitch: 150, rowH: 92, capH: 46, bandPad: 6, gap: 12, padX: 14, padTop: 10, minW: 380, r: 8, lineW: 4, critW: 7, labelW: 134, labelLines: 3, capLines: 2, from: true,
  tagH: 20, lh: 15, font: 'Geist, "Segoe UI", system-ui, sans-serif', chw: 0.555,
  fs: { cap: 14.5, sub: 12.5, id: 11.5, title: 12.5, extra: 11.5, tag: 11 },
  c: { bg: '#141428', band: 'rgba(255,255,255,0.035)', bandLine: 'rgba(255,255,255,0.09)', bandLive: 'rgba(38,195,255,0.42)',
       text: '#EAEDF5', sec: '#9BA3B5', dim: '#737C92', id: '#9BA3B5', line: '#59637E', live: '#26C3FF', sky: '#26C3FF', ready: '#4CC9FF',
       wait: '#7E89A6', cross: '#9BB0D3', crit: '#F4F6FB', amber: '#FFD966', lav: '#C4B5FD', tagBg: 'rgba(38,195,255,0.14)', tagLine: 'rgba(38,195,255,0.5)' }
};
// phones: the pane's spacing in the web's face and colours, so three columns show before a swipe
export var SKIN_NARROW = {
  pitch: 120, rowH: 82, capH: 62, bandPad: 4, gap: 10, padX: 8, padTop: 6, minW: 340, r: 7, lineW: 3.5, critW: 6, labelW: 108,
  labelLines: 3, capLines: 3, from: false, tagH: 18, lh: 14, font: 'Geist, "Segoe UI", system-ui, sans-serif', chw: 0.55,
  fs: { cap: 14, sub: 12, id: 10.5, title: 11.5, extra: 10.5, tag: 10.5 }, c: null
};

SKIN_NARROW.c = SKIN_WEB.c;
/* the AskerDo pane (mod-core homeGraph): its own spacing, the system stack an Svg
   draws in, and colours as tokens a style resolves per theme (paneStyle) */
var PANE_DARK = { bg: '#1a1a19', band: 'rgba(255,255,255,0.035)', bandLine: 'rgba(255,255,255,0.08)', bandLive: 'rgba(38,195,255,0.40)',
  text: '#f0efec', sec: '#c3c2b7', dim: '#898781', id: '#c3c2b7', line: '#5f5e5a', live: '#26c3ff', sky: '#26c3ff', ready: '#26c3ff',
  wait: '#898781', cross: '#a3a29b', crit: '#f6f5f2', amber: '#db9300', lav: '#b9aef0', tagBg: 'rgba(38,195,255,0.14)', tagLine: 'rgba(38,195,255,0.5)' };
var PANE_LIGHT = { bg: '#ffffff', band: 'rgba(11,11,11,0.03)', bandLine: 'rgba(11,11,11,0.10)', bandLive: 'rgba(2,132,199,0.45)',
  text: '#0b0b0b', sec: '#52514e', dim: '#898781', id: '#52514e', line: '#b5b3ad', live: '#0284c7', sky: '#0284c7', ready: '#0284c7',
  wait: '#898781', cross: '#7d7b75', crit: '#1f1e1d', amber: '#a66a00', lav: '#6d5bd0', tagBg: 'rgba(2,132,199,0.10)', tagLine: 'rgba(2,132,199,0.5)' };
export var SKIN_PANE = {
  pitch: 118, rowH: 78, capH: 58, bandPad: 4, gap: 8, padX: 8, padTop: 4, minW: 200, r: 6.5, lineW: 3, critW: 5.5, labelW: 106, labelLines: 3, capLines: 3, from: false,
  tagH: 17, lh: 13, font: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "PingFang SC", "PingFang TC", "Hiragino Sans", "Apple SD Gothic Neo", sans-serif', chw: 0.53,
  fs: { cap: 13, sub: 11.5, id: 10.5, title: 11.5, extra: 10.5, tag: 10.5 }, c: {}
};
Object.keys(PANE_DARK).forEach(function (k) { SKIN_PANE.c[k] = 'p-' + k; });
export function paneStyle() {
  var rules = function (C) { return Object.keys(C).map(function (k) { return '[fill="p-' + k + '"]{fill:' + C[k] + '}[stroke="p-' + k + '"]{stroke:' + C[k] + '}'; }).join(''); };
  return '<style>' + rules(PANE_LIGHT) + '@media (prefers-color-scheme: dark){' + rules(PANE_DARK) + '}</style>';
}
export function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
export function shortDate(iso) { var d = new Date(iso); return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()] + ' ' + d.getDate(); }
// wd gives a string's drawn width, measured in the browser or estimated from its length
function wrapText(s, maxW, wd, maxLines) {
  var words = String(s).split(' '), lines = [], cur = '';
  words.forEach(function (w) {
    var next = cur ? cur + ' ' + w : w;
    if (!cur || wd(next) <= maxW) cur = next; else { lines.push(cur); cur = w; }
  });
  if (cur) lines.push(cur);
  if (lines.length > maxLines) lines = lines.slice(0, maxLines - 1).concat([clip(lines.slice(maxLines - 1).join(' '), maxW, wd, true)]);
  return lines.map(function (l) { return wd(l) > maxW ? clip(l, maxW, wd, false) : l; });
}
// the longest head that fits with its ellipsis; a cut name ends on a whole word
function clip(s, maxW, wd, word) {
  var n = s.length;
  while (n > 1 && wd(s.slice(0, n) + '\u2026') > maxW) n--;
  var cut = s.slice(0, n), sp = cut.lastIndexOf(' ');
  if (word && sp > 2) cut = cut.slice(0, sp);
  return cut.replace(/\s+$/, '') + '\u2026';
}
// a parked line's reason and what opens it again, one wording for every view
export function parkedWords(tr) {
  return 'parked' + (tr.parked ? ': ' + tr.parked : '') + (tr.unpark ? '; opens again ' + tr.unpark : '');
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
// a started task no live hand backs, in one wording on every surface (the legend's below)
export var LEFT_WORDS = 'in progress, nobody on it';
// the open tasks split into parts that add up, the longest chain apart, so no count reads as a sum of
// the others; the one wording of a track's counts, the kickoff's too
// `short`: the clamped caption's form, its unheld part in one word
export function countsText(c, short) {
  var n = [], open = c.open || 0;
  if (c.running) n.push(c.running + ' running');
  if (c.left) n.push(c.left + (short ? ' unheld' : ' in progress with nobody on ' + (c.left === 1 ? 'it' : 'them')));
  if (c.ready) n.push(c.ready + ' ready');
  var waiting = open - (c.running || 0) - (c.left || 0) - (c.ready || 0);
  if (waiting > 0) n.push(waiting + ' waiting');
  return open ? open + ' open: ' + n.join(', ') + (c.chain ? ', longest chain ' + c.chain : '') : 'nothing open';
}
export function lineCounts(tr, D, doneN) {
  var t = D.tracks[tr.id];
  return countsText({ open: t.open, running: t.running, left: t.left, ready: t.ready, chain: t.toGo }) + (doneN ? '; ' + doneN + ' done' : '');
}
// counts that `fit` (two lines) cannot hold whole keep the done count and the chain:
// the parts shortened first, then those two lead, so the clamp cuts only the split of the open
export function lineCountsFit(tr, D, doneN, fit) {
  var full = lineCounts(tr, D, doneN);
  if (fit(full)) return full;
  var t = D.tracks[tr.id], c = { open: t.open, running: t.running, left: t.left, ready: t.ready };
  var short = countsText({ open: c.open, running: c.running, left: c.left, ready: c.ready, chain: t.toGo }, true) + (doneN ? '; ' + doneN + ' done' : '');
  if (fit(short) || !c.open) return short;
  var lead = [doneN ? doneN + ' done' : '', t.toGo ? 'longest chain ' + t.toGo : ''].filter(Boolean).join(', ');
  return lead ? lead + '; ' + countsText(c, true) : short;
}
// a wait or a need on another line: its track, and its workstream when that is another
export function farText(w) {
  if (w.track === 'the inbox') return w.id + ' in ' + (w.ws ? w.ws + "'s inbox" : 'the inbox');
  return w.id + (w.track ? ' on ' + w.track : '') + (w.ws ? ' in ' + w.ws : '');
}

// a picture wider than its box shows whole columns, so the box edge never cuts a station's words;
// the gap after the last one sits 6 px inside the edge: its rails show, the next words do not
export function viewCols(S, cols, view) {
  return !view || S.padX * 2 + cols * S.pitch <= view ? 0 : Math.max(2, Math.round((view - S.padX - 6) / S.pitch));
}
function fitSkin(S, cols, view) {
  var n = viewCols(S, cols, view);
  if (!n) return S;
  var room = view - S.padX - 6, o = {};
  for (var k in S) o[k] = S[k];
  o.pitch = room / n; o.labelW = Math.min(S.labelW * 1.15, o.pitch - 14);
  return o;
}

export function drawGraph(L, D, g, S, opt) {
  opt = opt || {};
  S = fitSkin(S, L.cols, opt.view);
  var C = S.c, P = S.pitch, task = {}, trk = {};
  // in strips each strip draws its own card, so the bands and the links between lines leave the shared body
  var split = !!(opt.parts && opt.strip && opt.strip < L.cols), between = [], rails = [], needBy = {};
  g.tasks.forEach(function (t) { task[t.id] = t; });
  g.tracks.forEach(function (tr) { trk[tr.id] = tr; });
  var crit = {}, critEdge = {};
  D.critical.path.forEach(function (id, i, a) { crit[id] = 1; if (i) critEdge[a[i - 1] + '>' + id] = 1; });
  var X = function (c) { return S.padX + c * P + P / 2; };
  var gut = function (c) { return S.padX + (c + 1) * P; }; // the gap right of column c
  // opt.measure(text, size, weight) is the browser's measured width; without it, an estimate
  var tw = function (s, fs, wt) { return opt.measure ? opt.measure(String(s), fs, wt) : String(s).length * fs * S.chw; };
  var capW = function (s) { return tw(s, S.fs.cap, 700); };
  var subW = function (s, wt) { return tw(s, S.fs.sub, wt || 550); };
  var bitsW = function (l) { return l.reduce(function (a, w, i) { return a + subW((i ? '· ' : '') + w[1]) + (i ? 4 : 0); }, 0); };
  var fits = function (fs, wt) { return function (s) { return tw(s, fs, wt); }; };
  function dimLine(id) { var t = D.tracks[id]; return t.state === 'parked' || t.stalled; }
  function lineColor(id) { return D.tracks[id].state === 'active' ? C.live : C.line; }
  function dash(id) { var t = D.tracks[id]; return t.state === 'parked' ? '7 6' : t.state === 'new' ? '2 7' : ''; }

  // a band is as wide as its work; its caption takes two lines on the web when they fit, else three,
  // and a name or state wider than the box wraps, so a long real name still reads without a swipe
  // in strips, a caption stays clear of the 6 px of gap the strips beside it also show
  var band = {}, idx = {}, y = S.padTop, room = opt.view ? opt.view - (opt.strip ? 44 : 25) : Infinity;
  L.lines.forEach(function (ln, i) {
    var tr = trk[ln.id], words = lineWords(tr, D), counts = lineCounts(tr, D, ln.done);
    // a side line names its parent line by name; with no junction task, the line alone
    var pname = trk[tr.parent] ? trk[tr.parent].name : tr.parent;
    var from = tr.parent && S.from ? 'from ' + (tr.junction ? tr.junction + ' on ' : '') + pname : '';
    // widths as drawn: the id, a 7 px gap, the name; state bits with 4 px gaps; counts in the lighter weight
    var idW = capW(ln.id) + 7, nameW = idW + capW(tr.name), wordsW = bitsW(words), countsW = subW(counts, 450);
    var w2 = Math.max(nameW + (from ? 8 + tw(from, S.fs.sub, 500) : 0), wordsW + 4 + subW('· ' + counts, 450));
    var w3 = Math.max(nameW, wordsW, countsW);
    var x1 = ln.firstCol === 0 ? 3 : X(ln.firstCol) - P / 2 + 6, xr = X(ln.lastCol) + P / 2 - 6;
    var three = S.capLines === 3 || (ln.level > 0 && x1 + 24 + w2 > xr) || w2 > room;
    var nameL = [tr.name], wordL = [words], countL = [counts];
    if (three && w3 > room) {
      if (nameW > room) nameL = wrapText(tr.name, room - idW, fits(S.fs.cap, 700), 2);
      if (wordsW > room) {
        wordL = [];
        words.forEach(function (w) { wrapText(w[1], room, fits(S.fs.sub, 550), 2).forEach(function (t) { wordL.push([[w[0], t]]); }); });
      }
      if (countsW > room) {
        var cw = fits(S.fs.sub, 450);
        countL = wrapText(lineCountsFit(tr, D, ln.done, function (s) { return wrapText(s, room, cw, 3).length <= 2; }), room, cw, 2);
      }
      w3 = idW + capW(nameL[0]);
      nameL.slice(1).forEach(function (t) { w3 = Math.max(w3, capW(t)); });
      wordL.forEach(function (l) { w3 = Math.max(w3, bitsW(l)); });
      countL.forEach(function (t) { w3 = Math.max(w3, subW(t, 450)); });
    }
    var more = (nameL.length - 1) * (S.fs.cap + 4) + (wordL.length - 1 + (three ? countL.length - 1 : 0)) * (S.fs.sub + 5);
    var capH = S.capH + (three && S.capLines !== 3 ? S.fs.sub + 6 : 0) + more, h = capH + ln.rows * S.rowH + S.bandPad;
    band[ln.id] = { top: y, h: h, rows: y + capH, x1: x1, xr: xr, capW: three ? w3 : w2, three: three, from: from, nameL: nameL, wordL: wordL, countL: countL, floor: 3 };
    idx[ln.id] = i;
    y += h + S.gap;
  });
  var H = y - S.gap + S.padTop;
  // a junction connector runs down a gap; the bands it passes stay right of it
  L.links.forEach(function (lk) {
    if (lk.kind !== 'junction') return;
    var a = L.stations[lk.from], b = L.stations[lk.to];
    for (var k = Math.min(idx[a.line], idx[b.line]) + 1; k < Math.max(idx[a.line], idx[b.line]); k++) {
      var bd = band[L.lines[k].id]; bd.floor = Math.max(bd.floor, gut(a.col) + 10);
    }
  });
  // a line's name and state stay in the box's first view: a caption that would run past its edge moves left;
  // drawn in strips of opt.strip columns (the pane), in the view of the strip its line starts in
  var edge = opt.view ? opt.view - 10 : Infinity, W = Math.max(S.minW, S.padX * 2 + L.cols * P);
  L.lines.forEach(function (ln) {
    var b = band[ln.id], cx = b.x1 + 12;
    if (opt.strip) edge = opt.view - 18 + Math.floor(ln.firstCol / opt.strip) * opt.strip * P;
    if (cx + b.capW > edge) cx = Math.max(b.floor + 12, edge - b.capW);
    b.cx = cx; b.x1 = Math.min(b.x1, cx - 12); b.x2 = Math.max(b.xr, cx + b.capW + 12);
    W = Math.max(W, b.x2 + 3);
  });

  var Ys = function (st) { return band[st.line].rows + st.sub * S.rowH + S.tagH + S.r + 4; };
  var occ = {}, farInto = {};
  Object.keys(L.stations).forEach(function (id) { var s = L.stations[id]; occ[s.row + ':' + s.col] = id; });
  L.links.forEach(function (lk) { if (lk.far && !critEdge[lk.from + '>' + lk.to]) farInto[lk.to] = 1; });
  function clear(row, c0, c1) { for (var c = c0; c <= c1; c++) if (occ[row + ':' + c]) return false; return true; }

  // does a vertical at xv from ya to yb run through line k's caption
  function capHit(k, xv, ya, yb) {
    var bd = band[L.lines[k].id];
    return xv > bd.cx - 8 && xv < bd.cx + bd.capW + 8 && Math.min(ya, yb) < bd.rows && Math.max(ya, yb) > bd.top;
  }
  // between lines: one vertical, in a gap between columns that no other line's band covers; through a caption
  // scores worst, and one no gap clears skips it: the line ends at the card's top and resumes under the words
  function across(a, b, lk, geo) {
    var x1 = X(a.col), y1 = Ys(a), x2 = X(b.col), y2 = Ys(b);
    if (geo) { geo.x1 = x1; geo.y1 = y1; geo.x2 = x2; geo.y2 = y2; geo.xv = x2; }
    if (Math.abs(y1 - y2) < 0.5) return 'M' + x1 + ' ' + y1 + 'H' + x2;
    var lo = Math.min(idx[a.line], idx[b.line]), hi = Math.max(idx[a.line], idx[b.line]), cands = [], pick = a.col, best = Infinity;
    for (var c = a.col; c < b.col; c++) cands.push(c);
    if (lk.kind === 'cross') cands.reverse(); // a wait on another line turns in just before the station that waits
    cands.forEach(function (c) {
      var xv = gut(c), hits = 0;
      for (var k = lo; k <= hi; k++) {
        var bd = band[L.lines[k].id];
        if (capHit(k, xv, y1, y2)) hits += 25;
        else if (k > lo && k < hi && xv > bd.x1 - 6 && xv < bd.x2 + 6) hits++;
      }
      var score = hits * 4 + (clear(a.row, a.col + 1, c) ? 0 : 1) + (clear(b.row, c + 1, b.col - 1) ? 0 : 1);
      if (score < best) { best = score; pick = c; }
    });
    var xv = gut(pick), s = y2 > y1 ? 1 : -1, r = Math.min(12, Math.abs(y2 - y1) / 2, Math.abs(xv - x1), Math.abs(x2 - xv));
    if (geo) geo.xv = xv;
    // a gap in the path, not a backing, so it holds on any ground the picture is drawn on
    var cuts = [], v = '';
    for (var k = lo; k <= hi; k++) if (capHit(k, xv, y1, y2)) cuts.push([band[L.lines[k].id].top + 1, band[L.lines[k].id].rows - 1]);
    cuts.sort(function (p, q) { return s * (p[0] - q[0]); }).forEach(function (c) { v += 'V' + (s > 0 ? c[0] : c[1]) + 'M' + xv + ' ' + (s > 0 ? c[1] : c[0]); });
    return 'M' + x1 + ' ' + y1 + 'H' + (xv - r) + 'Q' + xv + ' ' + y1 + ' ' + xv + ' ' + (y1 + s * r) + v +
      'V' + (y2 - s * r) + 'Q' + xv + ' ' + y2 + ' ' + (xv + r) + ' ' + y2 + 'H' + x2;
  }
  // within a line: one S-bend in one gap, a branch bending right after the station it depends on,
  // a second wait bending just before the station that waits, each on rails clear of other stations
  function bend(a, b, lk, geo) {
    var x1 = X(a.col), y1 = Ys(a), x2 = X(b.col), y2 = Ys(b);
    if (geo) { geo.x1 = x1; geo.y1 = y1; geo.x2 = x2; geo.y2 = y2; geo.xs = geo.xe = x2; }
    if (Math.abs(y1 - y2) < 0.5) return 'M' + x1 + ' ' + y1 + 'H' + x2;
    var cands = [], gp = null;
    for (var c = a.col; c < b.col; c++) cands.push(c);
    if (lk.kind === 'merge') cands.reverse();
    cands.forEach(function (c) { if (gp === null && clear(a.row, a.col + 1, c) && clear(b.row, c + 1, b.col - 1)) gp = c; });
    if (gp === null) gp = cands[0];
    // the bend sits mid-gap, flat under the stations' words and steep between them; one leaving the stretch
    // that far waits join peels off at its station, so they meet the row past it (strip cuts keep mid-gap)
    var nx = occ[a.row + ':' + (gp + 1)], peel = gp === a.col && nx && nx !== lk.to && farInto[nx] && !(opt.strip && (gp + 1) % opt.strip === 0);
    var xs = peel ? x1 + S.r + 2 : Math.max(gut(gp) - 0.22 * P, x1 + S.r + 2), xe = Math.min(xs + (peel ? 0.44 * P : gut(gp) + 0.22 * P - xs), x2 - S.r - 2), k = (xe - xs) * 0.5;
    if (geo) { geo.xs = xs; geo.xe = xe; }
    return 'M' + x1 + ' ' + y1 + 'H' + xs + 'C' + (xs + k) + ' ' + y1 + ' ' + (xe - k) + ' ' + y2 + ' ' + xe + ' ' + y2 + 'H' + x2;
  }

  var under = [], dimL = [], liveL = [], top = [], caps = [];
  // rails in their line's colour: a thick bend is a branch, a thin one a second wait; other lines thin and dashed
  var thinL = { dim: [], live: [] }, thickL = { dim: [], live: [] };
  // also: a far wait no route reaches, named under its station; after: one met by ports across strips
  var also = {}, after = {}, far = [], hs = [], vs = [], bends = [];
  var note = function (m, k, v) { (m[k] = m[k] || []).push(v); };
  function paint(lk, a, b, d) {
    var cross = lk.kind === 'cross', lineId = cross ? null : b.line, dim = lineId ? dimLine(lineId) : dimLine(a.line) && dimLine(b.line);
    var dashA = lineId && dash(lineId) ? ' stroke-dasharray="' + dash(lineId) + '"' : '';
    if (cross) thinL[dim ? 'dim' : 'live'].push('<path d="' + d + '" fill="none" stroke="' + C.cross + '" stroke-width="2.2" stroke-dasharray="5 4" stroke-linecap="round"/>');
    else if (lk.kind === 'merge') thinL[dim ? 'dim' : 'live'].push('<path d="' + d + '" fill="none" stroke="' + lineColor(lineId) + '" stroke-width="' + Math.max(1.8, S.lineW * 0.5) + '" stroke-linecap="round"' + dashA + ' opacity="0.85"/>');
    else thickL[dim ? 'dim' : 'live'].push('<path d="' + d + '" fill="none" stroke="' + lineColor(lineId) + '" stroke-width="' + S.lineW + '" stroke-linecap="round" stroke-linejoin="round"' + dashA + (lk.kind === 'junction' ? ' opacity="0.9"' : '') + '/>');
    if (critEdge[lk.from + '>' + lk.to]) top.push('<path d="' + d + '" fill="none" stroke="' + C.crit + '" stroke-width="' + S.critW + '" stroke-linecap="round" stroke-linejoin="round" opacity="0.92"/>');
  }
  L.links.forEach(function (lk) {
    if (lk.far && !critEdge[lk.from + '>' + lk.to]) return far.push(lk); // the critical path keeps its bend
    var a = L.stations[lk.from], b = L.stations[lk.to], apart = lk.kind === 'cross' || lk.kind === 'junction', geo = {};
    if (split && apart) return cutLink(a, b, lk);
    var d = apart ? across(a, b, lk, geo) : bend(a, b, lk, geo);
    if (split && !apart) rails.push({ line: b.line, x1: geo.x1, y1: geo.y1, x2: geo.x2, y2: geo.y2, xs: geo.xs, xe: geo.xe });
    // what a far wait's rail must not run along or through
    var xm = apart ? geo.xv : geo.xs, xn = apart ? geo.xv : geo.xe;
    hs.push({ y: geo.y1, x0: geo.x1, x1: xm }, { y: geo.y2, x0: xn, x1: geo.x2 });
    if (Math.abs(geo.y1 - geo.y2) >= 0.5) (apart ? vs : bends).push({ x: xm, x0: xm, x1: xn, y0: Math.min(geo.y1, geo.y2), y1: Math.max(geo.y1, geo.y2), ya: geo.y1, yb: geo.y2, to: lk.to });
    paint(lk, a, b, d);
  });
  // the ports of links between lines take their lanes first; a far wait's own vertical keeps clear of theirs
  fan();
  between.forEach(function (p) { if (!p.side) vs.push({ x: p.xv, y0: Math.min(p.sy, edgeY(p.line, p.down)), y1: Math.max(p.sy, edgeY(p.line, p.down)), port: true, ya: p.src ? p.sy : undefined }); });
  // a far second wait climbs a gap as a thin rail; in strips, ends in different strips meet by ports,
  // each end naming the other; with no clear route, it is named under its station
  var ported = [], toRoute = far.filter(function (lk) {
    var a = L.stations[lk.from], b = L.stations[lk.to];
    if (split && Math.floor(a.col / opt.strip) !== Math.floor(b.col / opt.strip)) return ported.push(lk), note(needBy, lk.from, lk.to), note(after, lk.to, lk.from), false;
    if (lk.via === undefined) return note(also, lk.to, lk.from), false;
    return true;
  });
  // every station's ring and words, which no rail crosses
  var boxes = [], wordAt = {};
  // a station's words, measured again in place when a wait comes to be named under it
  function words(id, into) {
    var s = L.stations[id], x = X(s.col), yy = Ys(s), w = wordsOf(id), wide = 0, b = into || { id: id };
    w.lines.forEach(function (l) { wide = Math.max(wide, tw(l, S.fs.title, 550)); });
    w.ex.forEach(function (e) { wide = Math.max(wide, tw(e[1], S.fs.extra, 550)); });
    b.x0 = x - wide / 2 - 5; b.x1 = x + wide / 2 + 5; b.y0 = yy + S.r + 2; b.y1 = yy + S.r + 6 + (w.lines.length + w.ex.length) * S.lh;
    return b;
  }
  var remeasure = function (id) { words(id, wordAt[id]); };
  Object.keys(L.stations).forEach(function (id) {
    var s = L.stations[id], t = task[id], k = D.tasks[id], x = X(s.col), yy = Ys(s), ring = k.kind === 'pointer' ? 17 : S.r + 6;
    boxes.push({ id: id, ring: true, x0: x - ring, x1: x + ring, y0: yy - ring, y1: yy + ring }, wordAt[id] = words(id));
    if (k.kind === 'now' && t.agent) { var tg = tw(t.agent, S.fs.tag, 650) / 2 + 12; boxes.push({ id: id, x0: x - tg, x1: x + tg, y0: yy - S.r - S.tagH - 2, y1: yy }); }
  });
  // the longest first, so a shorter one into the same station nests inside it without a crossing
  var span = function (lk) { return Math.abs(L.stations[lk.from].row - L.stations[lk.to].row); };
  var longest = function (p, q) { return span(q) - span(p); };
  ported.sort(longest).forEach(function (lk) {
    if (farPort(L.stations[lk.from], L.stations[lk.to], lk)) return;
    needBy[lk.from].splice(needBy[lk.from].indexOf(lk.to), 1);
    after[lk.to].splice(after[lk.to].indexOf(lk.from), 1);
    note(also, lk.to, lk.from);
    remeasure(lk.from); remeasure(lk.to);
  });
  // the waits into one station route together, again with another one first when one finds no route,
  // so the first never takes the only join the other has
  var groups = [];
  toRoute.sort(longest).forEach(function (lk) {
    var grp = groups.filter(function (q) { return q[0].to === lk.to; })[0];
    if (grp) grp.push(lk); else groups.push([lk]);
  });
  groups.forEach(function (grp) {
    var h0 = hs.length, v0 = vs.length, best = null;
    [grp].concat(grp.slice(1).map(function (lk) { return [lk].concat(grp.filter(function (q) { return q !== lk; })); })).some(function (ord) {
      hs.length = h0; vs.length = v0;
      var ds = ord.map(function (lk) { return farRail(L.stations[lk.from], L.stations[lk.to], lk.to); });
      var miss = ds.filter(function (d) { return !d; }).length;
      if (!best || miss < best.miss) best = { miss: miss, ord: ord, ds: ds, hs: hs.slice(h0), vs: vs.slice(v0) };
      return !miss;
    });
    hs.length = h0; vs.length = v0; hs.push.apply(hs, best.hs); vs.push.apply(vs, best.vs);
    best.ord.forEach(function (lk, i) {
      var m = best.ds[i];
      if (!m) return note(also, lk.to, lk.from);
      var fork = best.ds.some(function (o) { return o && o !== m && Math.abs(o.xv - m.xv) < 0.5 && (o.y1 - o.y2) * (m.y1 - m.y2) < 0; });
      paint(lk, L.stations[lk.from], L.stations[lk.to], railD(m, fork));
    });
    // the remaining groups route around the "also after" line this one added
    if (best.miss) remeasure(grp[0].to);
  });
  dimL = thinL.dim.concat(thickL.dim); liveL = thinL.live.concat(thickL.live);

  // what a vertical at x from lo to hi runs through: a station's ring or words, another vertical (two ends
  // meeting count) or the steep middle of a bend to another station leave no route (500 and up); across a
  // rail or a bend's flat end it is a plain crossing
  function vcost(x, lo, hi, to, port, skip) {
    var cost = 0, i;
    for (i = 0; i < boxes.length; i++) { var bx = boxes[i]; if (!(bx.ring && bx.id === skip) && x > bx.x0 && x < bx.x1 && hi > bx.y0 && lo < bx.y1) cost += 1000; }
    for (i = 0; i < vs.length; i++) {
      var v = vs[i], o = Math.min(hi, v.y1) - Math.max(lo, v.y0);
      if (port && v.st === skip && Math.abs(x - v.x) < 0.5) continue; // a second wait shares its station's port
      // two far waits meeting their station's row at one point from either side turn in together, a fork
      if (!port && v.far && v.to === to && o > -2 && o <= 2 && Math.abs(x - v.x) < 0.5) { cost += 4; continue; }
      if (o > -2 && Math.abs(x - v.x) < (o <= 2 ? 16 : port && v.port ? 9 : 6)) cost += 1000;
    }
    for (i = 0; i < bends.length; i++) {
      var bn = bends[i], w = (bn.x1 - bn.x0) * 0.15, ov = Math.min(hi, bn.y1) - Math.max(lo, bn.y0);
      if (bn.to === to) { if (x > bn.x0 - 2 && x < bn.x1 + 2 && ov > -2) cost += 3; continue; } // it joins the same station
      if (ov > 4 && x > bn.x0 + w && x < bn.x1 - w) cost += 500; // along its steep middle
      else if (ov > 4 && x > bn.x0 - 2 && x < bn.x1 + 2) cost += 6;
      // an end turning where the bend leaves or meets that row reads as running on into it
      [[bn.ya, bn.x0, 1], [bn.yb, bn.x1, -1]].forEach(function (e) {
        if (Math.abs(e[0] - lo) >= 1 && Math.abs(e[0] - hi) >= 1) return;
        var d = (x - e[1]) * e[2];
        cost += d > -14 && d < (bn.x1 - bn.x0) * 0.35 ? 40 : Math.abs(d) < 24 ? 12 - Math.abs(d) / 2 : 0;
      });
    }
    for (i = 0; i < hs.length; i++) { var h = hs[i]; if (h.y > lo + 3 && h.y < hi - 3 && x > Math.min(h.x0, h.x1) + 1 && x < Math.max(h.x0, h.x1) - 1) cost += 6; }
    return cost;
  }
  // a rail along a row at y from xa to xb, across another vertical
  function hcost(y, xa, xb) {
    var cost = 0;
    vs.forEach(function (v) { if (v.y0 + 3 < y && y < v.y1 - 3 && v.x > Math.min(xa, xb) + 1 && v.x < Math.max(xa, xb) - 1) cost += 6; });
    return cost;
  }
  // a wait meets its station's row only past where any other line leaves that stretch, past a bend's steep
  // middle, so the join can only mean its station; it may cross that bend's flat end on the way
  function joinFloor(b, to) {
    var y = Ys(b), x2 = X(b.col), c = b.col - 1, floor = -Infinity;
    while (c >= 0 && !occ[b.row + ':' + c]) c--;
    var xp = c >= 0 ? X(c) : -Infinity;
    bends.forEach(function (bn) { if (bn.to !== to && Math.abs(bn.ya - y) < 1 && bn.x0 >= xp && bn.x0 < x2) floor = Math.max(floor, bn.x1 - (bn.x1 - bn.x0) * 0.15); });
    vs.forEach(function (v) { if (v.ya !== undefined && v.to !== to && Math.abs(v.ya - y) < 1 && v.x > xp && v.x < x2) floor = Math.max(floor, v.x + 12); });
    return floor;
  }
  // a far wait's vertical: in a gap with both rows clear, turning in just before the station that waits
  function farRail(a, b, to) {
    var x1 = X(a.col), y1 = Ys(a), x2 = X(b.col), y2 = Ys(b), lo = Math.min(y1, y2), hi = Math.max(y1, y2), best = null, floor = joinFloor(b, to);
    for (var gp = b.col - 1; gp >= a.col; gp--) {
      if (!clear(a.row, a.col + 1, gp) || !clear(b.row, gp + 1, b.col - 1)) continue;
      for (var x = X(gp) + S.r + 6; x <= X(gp + 1) - S.r - 16; x += 2) {
        if (x < floor) continue;
        var cost = (b.col - 1 - gp) * 4 + (x2 - x) / P * 2 + vcost(x, lo, hi, to) + hcost(y1, x1, x) + hcost(y2, x, x2);
        if (!best || cost < best.cost) best = { cost: cost, x: x };
      }
    }
    if (!best || best.cost >= 500) return null;
    hs.push({ y: y1, x0: x1, x1: best.x }, { y: y2, x0: best.x, x1: x2 });
    vs.push({ x: best.x, y0: lo, y1: hi, ya: y1, to: to, far: true });
    return { x1: x1, y1: y1, x2: x2, y2: y2, xv: best.x };
  }
  // two waits meeting their row at one point from either side sweep in wider, so the pair reads as a fork
  function railD(m, fork) {
    var xv = m.xv, s = m.y2 > m.y1 ? 1 : -1, h = Math.abs(m.y2 - m.y1) / 2, r = Math.max(0, Math.min(10, h, xv - m.x1 - S.r - 2, m.x2 - xv - S.r - 2));
    var rt = fork ? Math.max(0, Math.min(18, h, m.x2 - xv - S.r - 2)) : r;
    return 'M' + m.x1 + ' ' + m.y1 + 'H' + (xv - r) + 'Q' + xv + ' ' + m.y1 + ' ' + xv + ' ' + (m.y1 + s * r) +
      'V' + (m.y2 - s * rt) + 'Q' + xv + ' ' + m.y2 + ' ' + (xv + rt) + ' ' + m.y2 + 'H' + m.x2;
  }
  // in strips, each end of a far wait leaves for its strip's frame, the later strip below: by a clear lane of
  // a gap beside it, else straight from the station, else by the card's side; a port there (stripSvg)
  function farPort(a, b, lk) {
    var ink = lineColor(b.line), ends = [];
    var paint = ' stroke="' + ink + '" stroke-width="' + Math.max(1.8, S.lineW * 0.5) + '" stroke-linecap="round"' + (dash(b.line) ? ' stroke-dasharray="' + dash(b.line) + '"' : '') + ' opacity="0.85"';
    [[a, lk.from, true], [b, lk.to, false]].forEach(function (e) {
      var st = e[0], down = e[2], bd = band[st.line], ln = L.lines[idx[st.line]], sx = X(st.col), sy = Ys(st), lim = portLimits(st, down);
      var ey = edgeY(st.line, down), lo = Math.min(sy, ey), hi = Math.max(sy, ey), best = null, floor = down ? -Infinity : joinFloor(st, lk.to);
      var pick = function (cost, xv, side) { if (!best || cost < best.cost) best = { cost: cost, xv: xv, side: side }; };
      // a wait meets its row in the stretch it ends, a need leaves after its station; the other gap only with no station beyond it
      var own = function (c) { return down ? c >= st.col || clear(st.row, 0, st.col - 1) : c < st.col || clear(st.row, st.col + 1, L.cols - 1); };
      (down ? [st.col, st.col - 1] : [st.col - 1, st.col]).forEach(function (c, n) {
        [0, -4.5, 4.5, -9, 9].forEach(function (off) {
          var x = gut(c) + off;
          if (own(c) && !lim.bad(c, x) && x >= floor) pick(n * 2 + Math.abs(off) / 9 + vcost(x, lo, hi, lk.to, true, e[1]) + hcost(sy, sx, x), x, 0);
        });
      });
      // straight from the station, as a link between lines takes when no gap is clear: under its strip's name only
      // when nothing else is clear, the name's halo cutting the line as across() cuts a caption
      pick(3 + (lim.lid(sx) ? 20 : 0) + vcost(sx, lo, hi, lk.to, true, e[1]), sx, 0);
      if (st.col === ln.firstCol || st.col === ln.lastCol) pick(8 + hcost(sy, sx, st.col === ln.firstCol ? bd.x1 : bd.x2), null, st.col === ln.firstCol ? bd.x1 : bd.x2);
      ends.push({ st: st, id: e[1], best: best, down: down, sx: sx, sy: sy, lo: lo, hi: hi });
    });
    if (ends.some(function (e) { return !e.best || e.best.cost >= 500; })) return false;
    ends.forEach(function (e) {
      between.push({ line: e.st.line, at: e.sx, sx: e.sx, sy: e.sy, side: e.best.side, xv: e.best.xv, down: e.down, paint: paint, ink: ink, crit: false, dim: dimLine(b.line) });
      if (!e.best.side) { vs.push({ x: e.best.xv, y0: e.lo, y1: e.hi, port: true, st: e.id, ya: e.down ? e.sy : undefined, to: lk.to }); hs.push({ y: e.sy, x0: e.sx, x1: e.best.xv }); }
    });
    return true;
  }
  // words keep a halo of the ground, so a connector passing behind them never cuts a letter
  var halo = ' stroke="' + C.bg + '" stroke-width="5" stroke-linejoin="round" paint-order="stroke"';
  L.lines.forEach(function (ln) {
    var b = band[ln.id], tr = trk[ln.id], live = D.tracks[ln.id].state === 'active';
    b.look = ' fill="' + C.band + '" stroke="' + (live ? C.bandLive : C.bandLine) + '"' + (dimLine(ln.id) ? ' stroke-dasharray="5 5"' : '');
    under.push('<rect x="' + b.x1 + '" y="' + b.top + '" width="' + (b.x2 - b.x1) + '" height="' + b.h + '" rx="12"' + b.look + '/>');
    var bits = function (l) { return l.map(function (w, i) { return '<tspan fill="' + C[w[0]] + '"' + (i ? ' dx="4"' : '') + '>' + esc((i ? '\u00b7 ' : '') + w[1]) + '</tspan>'; }).join(''); };
    var nameY = b.top + S.fs.cap + 7, capLH = S.fs.cap + 4, subLH = S.fs.sub + 5;
    var y2 = nameY + (b.nameL.length - 1) * capLH + 1 + S.fs.sub + 6;
    var subText = function (yy, inner) { return '<text x="' + b.cx + '" y="' + yy + '" font-size="' + S.fs.sub + '" font-weight="550"' + halo + '>' + inner + '</text>'; };
    var moreNames = b.nameL.slice(1).map(function (t, i) { return '<text x="' + b.cx + '" y="' + (nameY + (i + 1) * capLH) + '" font-size="' + S.fs.cap + '" font-weight="700"' + halo + '><tspan class="capname" fill="' + C.text + '">' + esc(t) + '</tspan></text>'; }).join('');
    var wordsHtml = b.wordL.map(function (l, i) {
      var tail = !b.three && i === b.wordL.length - 1 ? '<tspan dx="4" fill="' + C.sec + '" font-weight="450">' + esc('\u00b7 ' + b.countL[0]) + '</tspan>' : '';
      return subText(y2 + i * subLH, bits(l) + tail);
    }).join('');
    var countsHtml = b.three ? b.countL.map(function (t, i) { return subText(y2 + (b.wordL.length + i) * subLH, '<tspan fill="' + C.sec + '" font-weight="450">' + esc(t) + '</tspan>'); }).join('') : '';
    var cap = (opt.interactive ? '<a href="' + esc(pageOf(tr.key || ln.id)) + '">' : '') + '<g class="cap" data-track="' + ln.id + '"><title>' + esc(ln.id + ' ' + (tr.full || tr.name) + (opt.interactive ? '. Press to open the track.' : '')) + '</title>' +
      '<text x="' + b.cx + '" y="' + (b.top + S.fs.cap + 7) + '" font-size="' + S.fs.cap + '" font-weight="700"' + halo + '>' +
      '<tspan fill="' + (live ? C.live : C.id) + '">' + ln.id + '</tspan><tspan class="capname" dx="7" fill="' + C.text + '">' + esc(b.nameL[0]) + '</tspan>' +
      (b.from && !b.three ? '<tspan dx="8" font-size="' + S.fs.sub + '" font-weight="500" fill="' + C.dim + '">' + esc(b.from) + '</tspan>' : '') + '</text>' +
      moreNames + wordsHtml + countsHtml + '</g>' + (opt.interactive ? '</a>' : '');
    caps.push(cap);
  });

  // in strips a link between lines runs from each end's station, by the gap beside it (never a
  // cut), to its own card's edge, a port there; the station it leaves names the far end as the one waiting does
  function cutLink(a, b, lk) {
    var cross = lk.kind === 'cross', lineId = cross ? null : b.line, crit = critEdge[lk.from + '>' + lk.to];
    var dim = lineId ? dimLine(lineId) : dimLine(a.line) && dimLine(b.line), ink = cross ? C.cross : lineColor(lineId);
    var paint = cross ? ' stroke="' + ink + '" stroke-width="2.2" stroke-dasharray="5 4" stroke-linecap="round"'
      : ' stroke="' + ink + '" stroke-width="' + S.lineW + '" stroke-linecap="round" stroke-linejoin="round"' + (dash(lineId) ? ' stroke-dasharray="' + dash(lineId) + '"' : '') + ' opacity="0.9"';
    function end(st, other, right) {
      var bd = band[st.line], ln = L.lines[idx[st.line]], sx = X(st.col), sy = Ys(st), down = idx[other.line] > idx[st.line], bad = portLimits(st, down).bad;
      var c = right ? st.col : st.col - 1;
      if (bad(c)) c = right ? st.col - 1 : st.col;
      var side = !bad(c) ? 0 : st.col === ln.firstCol ? bd.x1 : st.col === ln.lastCol ? bd.x2 : 0;
      // out by the card's own left or right edge, else by the gap to the strip's frame, which stripSvg knows
      var gapped = !side && !bad(c);
      between.push({ line: st.line, at: sx, sx: sx, sy: sy, side: side, xv: side ? null : gapped ? gut(c) : sx, gap: gapped ? c : undefined, down: down, src: right, paint: paint, ink: ink, crit: !!crit, dim: dim });
    }
    end(a, b, true);
    end(b, a, false);
    // a side line's tie to its junction is the junction's own link, so it names nothing
    if (cross && !L.links.some(function (j) { return j.kind === 'junction' && j.from === lk.from && j.to === lk.to; })) note(needBy, lk.from, lk.to + ' on ' + b.line);
  }
  // a port's way out of its strip: never by the gap a strip is cut at, one outside the card, or up through
  // the caption or the name on its strip
  function portLimits(st, down) {
    var bd = band[st.line], ln = L.lines[idx[st.line]], k = Math.floor(st.col / opt.strip), s0 = Math.max(bd.x1, S.padX + k * opt.strip * P - 3), s1 = S.padX + (k + 1) * opt.strip * P + 3;
    var lid = bd.cx >= s0 - 6 && bd.cx < s1 ? [bd.cx - 8, bd.cx + bd.capW + 8] : [s0 + 4, s0 + 20 + Math.min(tw(ln.id + ' ' + trk[ln.id].name, S.fs.sub, 600), s1 - s0 - 24)];
    var capped = function (x) { return !down && x > lid[0] && x < lid[1]; };
    return { lid: capped, bad: function (c, x) { x = x === undefined ? gut(c) : x; return (c + 1) % opt.strip === 0 || x < bd.x1 + 8 || x > bd.x2 - 8 || capped(x); } };
  }
  // a port's frame edge, as far as the card's: the strip's own frame (stripWindows) sits inside it
  function edgeY(line, down) { var bd = band[line]; return down ? bd.top + bd.h : bd.rows; }
  // ports leaving by one gap fan out 4 px apart: those whose station is left of the gap on the left, the longest
  // furthest from its station, so none stacks on another and no stub crosses another's vertical
  function fan() {
    var groups = {};
    between.forEach(function (p) { if (p.gap !== undefined) note(groups, p.line + ' ' + p.gap + ' ' + p.down, p); });
    Object.keys(groups).forEach(function (key) {
      var ends = [], len = function (p) { return p.down ? -p.sy : p.sy; };
      groups[key].forEach(function (p) { p.who = p.sx + ' ' + p.sy + p.paint + p.crit; if (!ends.some(function (e) { return e.who === p.who; })) ends.push(p); });
      if (ends.length < 2) return;
      var left = ends.filter(function (p) { return p.sx < p.xv; }).sort(function (p, q) { return len(p) - len(q); });
      ends = left.concat(ends.filter(function (p) { return p.sx >= p.xv; }).sort(function (p, q) { return len(q) - len(p); }));
      groups[key].forEach(function (p) {
        var rank = ends.findIndex(function (e) { return e.who === p.who; });
        p.xv += (rank - (ends.length - 1) / 2) * 4;
      });
    });
  }


  // the label: id and title, then one line of what holds it or how far it is
  // what holds it wraps to the label's width too, so no line of words runs into the next column
  function wordsOf(id) {
    var t = task[id], ex = [], named = function (m, w) { return m[id] && m[id].length ? [['sec', w + m[id].join(', ')]] : []; };
    var extra = extraLines(t, D.tasks[id]).concat(named(also, 'also after '), named(after, 'after '), named(needBy, 'needed by '));
    extra.forEach(function (e) { wrapText(e[1], S.labelW, fits(S.fs.extra, 550), 2).forEach(function (l) { ex.push([e[0], l]); }); });
    ex = ex.slice(0, 4); // the hover lists every wait whole
    return { ex: ex, lines: wrapText(id + ' ' + t.title, S.labelW, fits(S.fs.title, 550), Math.max(2, S.labelLines - ex.length)) };
  }

  var stn = [], dimS = [], marks = []; // marks: each station's drawn extent, for the pane's strips
  Object.keys(L.stations).forEach(function (id) {
    var s = L.stations[id], t = task[id], k = D.tasks[id], x = X(s.col), yy = Ys(s), r = S.r, out = [];
    var junctionOf = g.tracks.filter(function (tr) { return tr.junction === id; });
    // a station opens its own task's page
    if (opt.interactive) out.push('<a href="' + esc(pageOf(t.key || id)) + '">');
    out.push('<g class="stn" data-task="' + id + '"><title>' + esc(id + ' ' + (t.full || t.title) + stationWords(t, k, g)) + '</title>');
    if (k.kind === 'done') {
      out.push('<circle cx="' + x + '" cy="' + yy + '" r="' + (r - 1.5) + '" fill="' + C.line + '" stroke="' + C.bg + '" stroke-width="2"/>');
    } else if (k.kind === 'now') {
      out.push('<circle cx="' + x + '" cy="' + yy + '" r="' + (r + 6) + '" fill="' + C.sky + '" opacity="0.2"/>');
      out.push('<circle cx="' + x + '" cy="' + yy + '" r="' + r + '" fill="' + C.sky + '" stroke="' + C.bg + '" stroke-width="2"/>');
    } else if (k.kind === 'left') {
      out.push('<circle cx="' + x + '" cy="' + yy + '" r="' + r + '" fill="' + C.bg + '" stroke="' + C.sky + '" stroke-width="2.5"/>');
      out.push('<path d="M' + x + ' ' + (yy - r + 2) + 'A' + (r - 2) + ' ' + (r - 2) + ' 0 0 0 ' + x + ' ' + (yy + r - 2) + 'Z" fill="' + C.sky + '"/>');
    } else if (k.kind === 'ready') {
      out.push('<circle cx="' + x + '" cy="' + yy + '" r="' + r + '" fill="' + C.bg + '" stroke="' + C.ready + '" stroke-width="3.2"/>');
    } else if (k.kind === 'gated') {
      out.push('<circle cx="' + x + '" cy="' + yy + '" r="' + r + '" fill="' + C.bg + '" stroke="' + C.amber + '" stroke-width="3"/><circle cx="' + x + '" cy="' + yy + '" r="2.4" fill="' + C.amber + '"/>');
    } else if (k.kind === 'pointer') {
      out.push('<rect x="' + (x - 15) + '" y="' + (yy - r - 2) + '" width="30" height="' + (2 * r + 4) + '" rx="' + (r + 2) + '" fill="' + C.bg + '" stroke="' + C.crit + '" stroke-width="2.4"/>');
      out.push('<path d="M' + (x - 5) + ' ' + (yy - 3.5) + 'L' + (x + 1) + ' ' + yy + 'L' + (x - 5) + ' ' + (yy + 3.5) + 'M' + (x + 1) + ' ' + (yy - 3.5) + 'L' + (x + 7) + ' ' + yy + 'L' + (x + 1) + ' ' + (yy + 3.5) + '" fill="none" stroke="' + C.crit + '" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>');
    } else {
      out.push('<circle cx="' + x + '" cy="' + yy + '" r="' + (r - 1.5) + '" fill="' + C.bg + '" stroke="' + C.wait + '" stroke-width="2.6"/>');
    }
    if (junctionOf.length && k.kind !== 'pointer') out.push('<circle cx="' + x + '" cy="' + yy + '" r="' + (r + 4.5) + '" fill="none" stroke="' + C.crit + '" stroke-width="1.6"/>');
    if (k.kind === 'now' && t.agent) {
      // the agent's tag stays inside its band, off centre when the station sits near the band's edge
      var bd = band[s.line], tgw = tw(t.agent, S.fs.tag, 650) + 16, ty = yy - r - 6 - S.tagH + 4;
      var tx = Math.max(bd.x1 + 6 + tgw / 2, Math.min(x, bd.x2 - 6 - tgw / 2));
      out.push('<rect x="' + (tx - tgw / 2) + '" y="' + ty + '" width="' + tgw + '" height="' + (S.tagH - 3) + '" rx="' + ((S.tagH - 3) / 2) + '" fill="' + C.bg + '"/>');
      out.push('<rect x="' + (tx - tgw / 2) + '" y="' + ty + '" width="' + tgw + '" height="' + (S.tagH - 3) + '" rx="' + ((S.tagH - 3) / 2) + '" fill="' + C.tagBg + '" stroke="' + C.tagLine + '"/>');
      out.push('<text x="' + tx + '" y="' + (ty + S.tagH - 7.5) + '" text-anchor="middle" font-size="' + S.fs.tag + '" font-weight="650" fill="' + C.sky + '">' + esc(t.agent) + '</text>');
    }
    var w = wordsOf(id), ex = w.ex, lines = w.lines, ly = yy + r + 4 + S.fs.title;
    var txt = '<text x="' + x + '" text-anchor="middle" font-size="' + S.fs.title + '" stroke="' + C.bg + '" stroke-width="3.5" stroke-linejoin="round" paint-order="stroke">';
    lines.forEach(function (ln, i) {
      var m = i === 0 ? ln.match(/^(\S+)\s?(.*)$/) : null;
      txt += '<tspan x="' + x + '" y="' + (ly + i * S.lh) + '">' + (m ? '<tspan font-weight="700" font-size="' + S.fs.id + '" fill="' + C.id + '">' + esc(m[1]) + '</tspan> <tspan fill="' + C.text + '" font-weight="550">' + esc(m[2]) + '</tspan>' : '<tspan fill="' + C.text + '" font-weight="550">' + esc(ln) + '</tspan>') + '</tspan>';
    });
    ex.forEach(function (e, i) { txt += '<tspan x="' + x + '" y="' + (ly + (lines.length + i) * S.lh + 1) + '" font-size="' + S.fs.extra + '" fill="' + C[e[0]] + '" font-weight="550">' + esc(e[1]) + '</tspan>'; });
    out.push(txt + '</text></g>' + (opt.interactive ? '</a>' : ''));
    marks.push({ line: s.line, x: x, top: k.kind === 'now' && t.agent ? yy - r - S.tagH - 2 : yy - r - 7, bottom: ly + (lines.length + ex.length - 1) * S.lh + 5 });
    ((dimLine(s.line) && !crit[id]) || k.kind === 'done' ? dimS : stn).push(out.join(''));
  });

  var body = (split ? '' : under.join('')) + '<g opacity="0.42">' + dimL.join('') + dimS.join('') + '</g>' + liveL.join('') + top.join('') + stn.join('') + caps.join('');
  if (opt.parts) {
    return { w: W, h: H, body: body, pitch: P, padX: S.padX, cols: L.cols, marks: marks, split: split, between: between, rails: rails, skin: S, nameW: fits(S.fs.sub, 600),
      bands: L.lines.map(function (ln) { var b = band[ln.id]; return { id: ln.id, top: b.top, h: b.h, rows: b.rows, x1: b.x1, x2: b.x2, cx: b.cx, look: b.look, more: ln.id + ' ' + trk[ln.id].name }; }) };
  }
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" font-family=\'' + S.font + '\'' + (opt.label ? ' role="img" aria-label="' + esc(opt.label) + '"' : '') + '>' +
    (opt.fill ? '<rect width="100%" height="100%" fill="' + C.bg + '"/>' : '') +
    body + '</svg>';
}
// strips of n whole columns, each a window on one drawing (opt.parts and opt.strip n), line by line
// : each line's windows left to right, columns kn to kn+n-1 with 6 px of gap either side, cut to
// its band and its stations, so a line reads whole before the next and one with nothing there leaves no
// gap; one window, cut to the view, when every column fits
export function stripWindows(P, n, view) {
  var OW = Math.floor(view), wins = [];
  if (n >= P.cols) return [{ x: 0, y: 0, w: Math.min(Math.ceil(P.w), OW), h: Math.ceil(P.h) }];
  P.bands.forEach(function (b) {
    for (var k = 0; k * n < P.cols; k++) {
      var x = k ? P.padX + k * n * P.pitch - 6 : 0, w = k ? Math.min(OW, n * P.pitch + 12) : OW;
      // a station or caption counts in the window of its own columns only, so no line gets a window of its edge alone
      var end = P.padX + (k + 1) * n * P.pitch - 6;
      var ms = P.marks.filter(function (m) { return m.line === b.id && m.x > x && m.x < end; });
      if (!ms.length && !(b.x1 >= x && b.x1 < end)) continue;
      var y = Math.max(0, Math.min.apply(null, ms.map(function (m) { return m.top; }).concat([b.top])) - 2);
      var h = Math.min(P.h, Math.max.apply(null, ms.map(function (m) { return m.bottom; }).concat([b.top + b.h])) + 2) - y;
      var f = { x: x, y: y, w: w, h: h };
      if (P.split) {
        // a cut closes the card's frame 3 px inside the old edge and the strip ends on it; 3 px more
        // above and below for a port's ring on the frame
        var cl = b.x1 < x + 3, cr = b.x2 > x + w - 3;
        f.line = b.id; f.cap = b.cx >= x && b.cx < x + w;
        f.fx1 = cl ? x + 3 : b.x1; f.fx2 = cr ? x + w - 3 : b.x2; f.cutL = cl ? x + 6 : null; f.cutR = cr ? x + w - 6 : null;
        f.x = cl ? f.fx1 - 0.5 : x; f.w = (cr ? f.fx2 + 0.5 : x + w) - f.x;
        // a strip is as tall as what it holds, its stations, its rails and the first one's caption;
        // past the first, room above for its small name
        var ys = ms.map(function (m) { return [m.top, m.bottom]; });
        P.rails.forEach(function (r) {
          var a = Math.max(Math.min(r.x1, r.x2), x), z = Math.min(Math.max(r.x1, r.x2), x + w);
          if (r.line === b.id && a < z) { var ya = railY(r, a), yz = railY(r, z); ys.push([Math.min(ya, yz) - 10, Math.max(ya, yz) + 10]); }
        });
        if (f.cap) ys.push([b.top, b.rows + 4]);
        var lo = Math.min.apply(null, ys.map(function (v) { return v[0]; })), hi = Math.max.apply(null, ys.map(function (v) { return v[1]; }));
        f.fy1 = !ys.length ? b.top : f.cap ? b.top : lo - P.skin.fs.sub - 11;
        f.fy2 = !ys.length ? b.top + b.h : hi + 2;
        f.y = f.fy1 - 5; f.h = f.fy2 - f.fy1 + 10;
        // set this far in, a strip's frame starts where the first strip's does
        f.dx = cl ? 2.5 : 0;
      }
      wins.push(f);
    }
  });
  return wins;
}
// the y of a rail at x: flat, or on its bend's curve (bend's C: x = xs + dx(1.5t - 1.5t^2 + t^3), y = y1 + dy(3t^2 - 2t^3))
function railY(r, x) {
  if (x <= r.xs) return r.y1;
  if (x >= r.xe) return r.y2;
  var lo = 0, hi = 1, t = 0.5;
  for (var i = 0; i < 24; i++) { t = (lo + hi) / 2; if (r.xs + (r.xe - r.xs) * (1.5 * t - 1.5 * t * t + t * t * t) < x) lo = t; else hi = t; }
  return r.y1 + (r.y2 - r.y1) * (3 * t * t - 2 * t * t * t);
}
// a link between lines leaving a strip's station: by the card's side, or by its gap to the frame's edge at ey, a port there
function linkEnd(p, ey, S) {
  var C = S.c, d, px, py;
  if (p.side) {
    d = 'M' + p.sx + ' ' + p.sy + 'H' + p.side; px = p.side; py = p.sy;
  } else {
    var vd = p.down ? 1 : -1, r = Math.min(12, Math.abs(p.xv - p.sx), Math.abs(ey - p.sy) / 2), hd = p.xv > p.sx ? 1 : -1;
    d = 'M' + p.sx + ' ' + p.sy + 'H' + (p.xv - hd * r) + 'Q' + p.xv + ' ' + p.sy + ' ' + p.xv + ' ' + (p.sy + vd * r) + 'V' + ey; px = p.xv; py = ey;
  }
  return { under: (p.dim ? '<g opacity="0.42">' : '') + '<path d="' + d + '" fill="none"' + p.paint + '/>' + (p.crit ? '<path d="' + d + '" fill="none" stroke="' + C.crit +
      '" stroke-width="' + S.critW + '" stroke-linecap="round" stroke-linejoin="round" opacity="0.92"/>' : '') + (p.dim ? '</g>' : ''),
    port: '<circle cx="' + px + '" cy="' + py + '" r="3.4" fill="' + C.bg + '" stroke="' + (p.crit ? C.crit : p.ink) + '" stroke-width="1.8"/>' };
}
// a strip as its own card around the shared drawing (inner): the frame, closed at a cut; the links
// to other lines under the drawing and their ports on it; a chevron where a rail meets a cut, at both ends; past
// the card's first strip its name, small
export function stripSvg(P, f, inner) {
  if (!P.split || !f.line) return inner;
  var b = P.bands.filter(function (x) { return x.id === f.line; })[0], S = P.skin, C = S.c;
  var seen = {}, mine = P.between.filter(function (p) {
    var k = [p.sx, p.sy, p.side, p.xv, p.down, p.paint, p.crit].join(' '), keep = p.line === f.line && p.at >= f.fx1 && p.at <= f.fx2 && !seen[k];
    seen[k] = 1;
    return keep;
  });
  var out = ['<rect x="' + f.fx1 + '" y="' + f.fy1 + '" width="' + (f.fx2 - f.fx1) + '" height="' + (f.fy2 - f.fy1) + '" rx="12"' + b.look + '/>'];
  var ends = mine.map(function (p) { return linkEnd(p, p.down ? f.fy2 : f.fy1, S); });
  ends.forEach(function (e) { out.push(e.under); });
  // the shared drawing shows inside the frame only, so no other line's words reach a strip's margin;
  // the id is unique per drawing, since the web puts every strip's svg in one page
  var cid = 'sk' + Math.round(P.pitch * 10) + '-' + f.line + '-' + Math.round(f.fx1) + '-' + Math.round(f.fy1);
  out.push('<clipPath id="' + cid + '"><rect x="' + (f.fx1 - 0.5) + '" y="' + (f.fy1 + 0.5) + '" width="' + (f.fx2 - f.fx1 + 1) + '" height="' + (f.fy2 - f.fy1 - 1) + '"/></clipPath>' +
    '<g clip-path="url(#' + cid + ')">' + inner + '</g>');
  ends.forEach(function (e) { out.push(e.port); });
  [[f.cutL, f.fx1 + 6], [f.cutR, f.fx2 - 6]].forEach(function (c) {
    if (c[0] === null) return;
    var seen = {};
    P.rails.forEach(function (r) {
      if (r.line !== f.line || Math.min(r.x1, r.x2) >= c[0] || Math.max(r.x1, r.x2) <= c[0]) return;
      var y = Math.round(railY(r, c[0]) * 10) / 10;
      if (seen[y]) return;
      seen[y] = 1;
      var x = c[1], back = '<rect x="' + (x - 6) + '" y="' + (y - 7) + '" width="12" height="14" fill="';
      out.push(back + C.bg + '"/>' + back + C.band + '"/><path d="M' + (x - 2.5) + ' ' + (y - 4.5) + 'L' + (x + 2) + ' ' + y + 'L' + (x - 2.5) + ' ' + (y + 4.5) +
        '" fill="none" stroke="' + C.sec + '" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>');
    });
  });
  var m = f.fx2 - f.fx1 - 24, more = P.nameW(b.more) > m ? clip(b.more, m, P.nameW, false) : b.more, sp = more.indexOf(' ');
  if (!f.cap && m > 20) {
    out.push('<text x="' + (f.fx1 + 12) + '" y="' + (f.fy1 + S.fs.sub + 6) + '" font-size="' + S.fs.sub + '" font-weight="600" stroke="' + C.bg + '" stroke-width="4" stroke-linejoin="round" paint-order="stroke">' +
      '<tspan fill="' + C.id + '">' + esc(sp < 0 ? more : more.slice(0, sp)) + '</tspan>' + (sp < 0 ? '' : '<tspan dx="5" fill="' + C.dim + '">' + esc(more.slice(sp + 1)) + '</tspan>') + '</text>');
  }
  return out.join('');
}
// the web's picture at its box's width: whole when its columns fit, else the pane's strips
// stacked, each its own svg, so every line's stations show and nothing scrolls sideways
export function drawFit(L, D, g, S, opt) {
  var n = viewCols(S, L.cols, opt.view);
  var o = {};
  for (var k in opt) o[k] = opt[k];
  o.parts = true; o.strip = n || undefined;
  // whole, a caption pulled to the edge keeps its band's last few px past it: cut to the view
  var P = drawGraph(L, D, g, S, o), wins = stripWindows(P, n || L.cols, opt.view);
  var r = function (v) { return Math.round(v * 100) / 100; };
  return wins.map(function (f, i) {
    var label = opt.label ? opt.label + (wins.length > 1 ? ', part ' + (i + 1) + ' of ' + wins.length : '') : '';
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + r(f.w) + '" height="' + r(f.h) + '" viewBox="' + r(f.x) + ' ' + r(f.y) + ' ' + r(f.w) + ' ' + r(f.h) + '" font-family=\'' + S.font + '\'' +
      (label ? ' role="img" aria-label="' + esc(label) + '"' : '') + '>' + stripSvg(P, f, P.body) + '</svg>';
  }).join('');
}
// the station's words under its title: what holds it, then every far wait and what waits on it from afar
function extraLines(t, k) {
  if (k.kind === 'done') return [['dim', 'done']];
  if (k.kind === 'pointer') {
    return [['text', t.promotedTo + (t.progress ? ': ' + t.progress.done + ' of ' + t.progress.total + ' done' : '')]];
  }
  var out = [], far = k.waits.filter(function (w) { return w.track; }), need = k.needed || [];
  if (k.gates.length) out.push(['amber', 'waits on ' + k.gates.join(', ')]);
  if (far.length) out.push(['sec', 'after ' + far.map(farText).join(', ')]);
  if (need.length) out.push(['sec', 'needed by ' + need.map(farText).join(', ')]);
  if (out.length) return out;
  if (t.checklist) return [['sec', t.checklist.done + ' of ' + t.checklist.total + ' steps']];
  if (k.kind === 'left') return [['sec', 'nobody on it']];
  return [];
}
function stationWords(t, k, g) {
  var w = { now: 'running now' + (t.agent ? ', ' + t.agent : ''), left: 'in progress, nobody on it', ready: 'ready to start', gated: 'waits on your answer', waits: 'waits', pointer: 'promoted to ' + t.promotedTo, done: 'done' }[k.kind];
  var on = k.waits.map(farText).concat(k.gates), need = (k.needed || []).map(farText);
  return ': ' + w + (on.length && k.kind !== 'pointer' ? ', after ' + on.join(', ') : '') + (need.length ? '; needed by ' + need.join(', ') : '');
}
function pageOf(ref) { return '/r/' + encodeURIComponent(ref); }
/* small marks for lists and the legend, the same shapes the picture draws */
export function mark(kind, size) {
  size = size || 18; var c = size / 2, r = size * 0.3, s = '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" aria-hidden="true">';
  var C = SKIN_WEB.c;
  if (kind === 'now') s += '<circle cx="' + c + '" cy="' + c + '" r="' + (r + 3) + '" fill="' + C.sky + '" opacity="0.22"/><circle cx="' + c + '" cy="' + c + '" r="' + r + '" fill="' + C.sky + '"/>';
  else if (kind === 'left') s += '<circle cx="' + c + '" cy="' + c + '" r="' + r + '" fill="' + C.bg + '" stroke="' + C.sky + '" stroke-width="2"/><path d="M' + c + ' ' + (c - r + 1.5) + 'A' + (r - 1.5) + ' ' + (r - 1.5) + ' 0 0 0 ' + c + ' ' + (c + r - 1.5) + 'Z" fill="' + C.sky + '"/>';
  else if (kind === 'ready') s += '<circle cx="' + c + '" cy="' + c + '" r="' + r + '" fill="' + C.bg + '" stroke="' + C.ready + '" stroke-width="2.6"/>';
  else if (kind === 'gated') s += '<circle cx="' + c + '" cy="' + c + '" r="' + r + '" fill="' + C.bg + '" stroke="' + C.amber + '" stroke-width="2.4"/><circle cx="' + c + '" cy="' + c + '" r="1.8" fill="' + C.amber + '"/>';
  else if (kind === 'you') s += '<circle cx="' + c + '" cy="' + c + '" r="' + (r - 1) + '" fill="' + C.bg + '" stroke="' + C.amber + '" stroke-width="2.2"/>';
  else if (kind === 'waits') s += '<circle cx="' + c + '" cy="' + c + '" r="' + (r - 1) + '" fill="' + C.bg + '" stroke="' + C.wait + '" stroke-width="2.2"/>';
  else if (kind === 'pointer') s += '<rect x="' + (c - 8) + '" y="' + (c - 5) + '" width="16" height="10" rx="5" fill="' + C.bg + '" stroke="' + C.crit + '" stroke-width="1.8"/>';
  else if (kind === 'junction') s += '<circle cx="' + c + '" cy="' + c + '" r="' + (r - 1) + '" fill="' + C.bg + '" stroke="' + C.wait + '" stroke-width="2"/><circle cx="' + c + '" cy="' + c + '" r="' + (r + 2.5) + '" fill="none" stroke="' + C.crit + '" stroke-width="1.3"/>';
  else if (kind === 'done') s += '<circle cx="' + c + '" cy="' + c + '" r="' + (r - 1) + '" fill="' + C.line + '"/>';
  return s + '</svg>';
}
export function legendHtml() {
  var rail = function (col, w, dashA, op) { return '<svg width="30" height="12" aria-hidden="true"><path d="M2 6H28" stroke="' + col + '" stroke-width="' + w + '" stroke-linecap="round"' + (dashA ? ' stroke-dasharray="' + dashA + '"' : '') + (op ? ' opacity="' + op + '"' : '') + '/></svg>'; };
  var C = SKIN_WEB.c;
  return '<div class="legend">' +
    '<span>' + mark('now') + 'running now, with its agent</span>' +
    '<span>' + mark('ready') + 'ready to start</span>' +
    '<span>' + mark('waits') + 'waits on the tasks before it</span>' +
    '<span>' + mark('gated') + 'waits on your answer</span>' +
    '<span>' + mark('left') + 'in progress, nobody on it</span>' +
    '<span>' + mark('pointer') + 'promoted: its side track carries it</span>' +
    '<span>' + mark('junction') + 'a side track leaves here</span>' +
    '<span>' + mark('done') + 'done, kept where a side track leaves</span>' +
    '<span>' + rail(C.crit, 5) + 'critical path, the longest chain left</span>' +
    '<span>' + rail(C.live, 4) + 'the line a session is on</span>' +
    '<span>' + rail(C.live, 2, '', 0.85) + 'thin: a second thing it waits on</span>' +
    '<span>' + rail(C.cross, 2.2, '5 4') + 'waits on another line</span>' +
    '<span>' + rail(C.line, 4, '7 6', 0.5) + 'parked or stalled, dimmed</span></div>';
}
