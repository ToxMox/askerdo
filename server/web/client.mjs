/* The board page's one script: draws the picture and answers its
   presses, wires Copy and the cards, and holds a long poll that swaps the page in place when the
   board changes. */
import { esc } from './draw.mjs';
import { crumbs, detail, drawPicture, legend, pressView, sinceWords, skinOf, viewOf, viewPath } from './picture-draw.mjs';
import { sinceLook } from './picture-model.mjs';

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

/* labels wrap on measured widths, since bold Geist runs wider than any estimate */
const pen = document.createElement('canvas').getContext('2d');
const widths = new Map();
const FONT = skinOf('web').font;
function measure(text, px, weight) {
  const key = weight + ' ' + px + ' ' + text;
  let w = widths.get(key);
  if (w === undefined) {
    pen.font = weight + ' ' + px + 'px ' + FONT;
    w = pen.measureText(text).width;
    widths.set(key, w);
  }
  return w;
}

/* ---- the picture: three levels with a zoom between them; a press selects and traces, a second opens ----
   G is the page's data ({ P, page, icons }), V the view its address names. A zoom plays in the box,
   then the address and the page's other sections follow, so Back steps a level. */
let G = null;
let V = null;
let HOV = null;
let lastPic = null;
let drawn = null;
let navSeq = 0;
const phone = () => window.matchMedia('(max-width: 640px)').matches;
const canHover = window.matchMedia('(hover: hover)');

function readData(root) {
  const n = (root || document).querySelector('#gdata');
  try { return n ? JSON.parse(n.textContent) : null; } catch { return null; }
}

/* the last look: one moment per workstream and one for the Overview, read once a page and kept as it goes */
const LOOK = 'askerdo.look.';
const looks = {};
const seenAt = {};
function lookFor(k) {
  if (!(k in looks)) {
    let v = null;
    try { v = localStorage.getItem(LOOK + k); } catch {}
    looks[k] = v;
  }
  return looks[k];
}
function keepLooks() { for (const [k, at] of Object.entries(seenAt)) try { localStorage.setItem(LOOK + k, at); } catch {} }
const lookKey = (v) => (v.level === 0 ? 'overview' : 'ws:' + ((G.P.ws[v.ws] || {}).key || v.ws));
function shown() {
  const k = lookKey(V);
  if (!drawn || drawn.src !== G.P || drawn.k !== k) drawn = { src: G.P, k, P: sinceLook(G.P, lookFor(k)) };
  seenAt[k] = G.P.at;
  return drawn.P;
}

function viewHere() {
  const u = new URL(location.href);
  const page = G.page || {};
  const v = page.kind === 'track' ? viewOf('/r/' + page.tr, u.search, G.P) : viewOf(u.pathname, u.search, G.P);
  if (v) return v;
  return page.kind === 'overview' ? { level: 0, ws: null, tr: null, sel: null } : { level: 1, ws: page.ws || null, tr: null, sel: null };
}
/* a view's address; a track's own page keeps its own */
function addressOf(v) {
  const p = viewPath(v);
  if (G.page.kind !== 'track' || v.level !== 2 || v.tr !== G.page.tr) return p;
  const q = p.indexOf('sel=');
  return G.page.path + (q > 0 ? '?' + p.slice(q) : '');
}
function canDraw(P, v) {
  if (v.level === 0) return P.ov.length > 0;
  const W = P.ws[v.ws];
  return !!W && (v.level === 1 || W.tracks.some((t) => t.id === v.tr));
}
function urlOf(id) {
  const P = G.P;
  const t = P.tasks[id] || P.ans[id];
  if (t && t.url) return t.url;
  for (const w of Object.values(P.ws)) {
    if (w.id === id && w.url) return w.url;
    const tr = w.tracks.find((x) => x.id === id);
    if (tr && tr.url) return tr.url;
  }
  const o = P.ov.find((x) => x.id === id);
  if (o && o.url) return o.url;
  return (/^WS-\d+$/.test(id) ? '/ws/' : '/r/') + encodeURIComponent(id);
}

/* the strip: the selection in words, its acts as buttons, an open as a link */
function hrefOf(k) {
  const i = k.indexOf(':');
  const kind = k.slice(0, i);
  const id = k.slice(i + 1);
  if (kind === 'open' || kind === 'answer') return urlOf(id);
  if (kind === 'list') return urlOf(id) + '#done';
  return null;
}
function stripHtml(d) {
  if (!d) return '<div class="pstrip empty">Press a ' + (V.level === 0 ? 'workstream' : V.level === 1 ? 'track or a wait' : 'station') + ' to see what it waits on and what it frees.</div>';
  const fav = G.icons && G.icons.fav ? '<img class="face" width="16" height="16" alt="" src="data:image/svg+xml,' + encodeURIComponent(G.icons.fav) + '">' : '';
  // a track nobody holds offers its resume command, as the Overview's cards did
  const val = (f) => (f[0] === 'Resume' ? '<div class="cmd"><code>' + esc(f[1]) + '</code><button class="copy" type="button" data-copy="' + esc(f[1]) + '">Copy</button></div>'
    : Array.isArray(f[1]) ? f[1].map(esc).join('<br>') : esc(f[1]));
  const act = (a) => {
    const href = hrefOf(a.k);
    const inner = (a.answer ? fav : '') + esc(a.label);
    const cls = a.answer ? 'ans' : 'copy';
    return href ? '<a class="' + cls + '" href="' + esc(href) + '">' + inner + '</a>' : '<button type="button" class="' + cls + '" data-k="' + esc(a.k) + '">' + inner + '</button>';
  };
  return '<div class="pstrip"><div class="sh">' + (d.id ? '<span class="id">' + esc(d.id) + '</span>' : '') + '<span class="nm">' + esc(d.name) + '</span>'
    + d.chips.map((c) => '<span class="chip ' + c[1] + '">' + esc(c[0]) + '</span>').join('') + '</div>'
    + '<dl class="facts">' + d.facts.map((f) => '<dt>' + esc(f[0]) + '</dt><dd>' + val(f) + '</dd>').join('') + '</dl>'
    + '<div class="acts">' + d.acts.map(act).join('') + (d.hint ? '<span class="hint">' + esc(d.hint) + '</span>' : '') + '</div></div>';
}

/* the Overview's pills, for a workstream page's press on another workstream: read once from the Overview page */
const ovTried = new WeakSet();
function needOverview() {
  const src = G.P;
  if (ovTried.has(src) || src.ov.length) return;
  ovTried.add(src);
  pageAt('/').then((doc) => {
    const d = doc && doc !== 'reload' ? readData(doc) : null;
    if (!d || !d.P || !G || G.P !== src) return;
    src.ov = d.P.ov;
    src.ovLinks = d.P.ovLinks;
    drawn = null;
    render();
  }).catch(() => {});
}

function drawNow(P) {
  const gv = document.querySelector('#pic .gview');
  return drawPicture(P, V, { skin: phone() ? 'narrow' : 'web', width: gv.clientWidth, measure, icons: G.icons, hover: HOV, top: 50 });
}
function originOf(key) {
  if (!key || !lastPic) return null;
  const p = lastPic.pos[key.slice(key.indexOf(':') + 1)];
  return p ? { x: p.x + (p.w || 0) / 2, y: p.y + (p.h || 0) / 2 } : null;
}
/* the mock's zoom: the old picture grows past you (or shrinks away) as the new one comes in about the pressed pill */
function zoomPlay(gv, oldSvg, anim, W) {
  const o = anim.origin || { x: W / 2, y: 120 };
  const inward = anim.dir > 0;
  const at = (s) => 'translate(' + o.x + 'px,' + o.y + 'px) scale(' + s + ') translate(' + -o.x + 'px,' + -o.y + 'px)';
  const ghost = document.createElement('div');
  ghost.className = 'layer ghost';
  ghost.style.top = gv.style.paddingTop;
  ghost.innerHTML = oldSvg;
  gv.appendChild(ghost);
  const layer = gv.querySelector('.layer');
  layer.style.transition = 'none';
  layer.style.opacity = '0';
  layer.style.transform = at(inward ? 0.35 : 2.2);
  void layer.offsetWidth;
  layer.style.transition = '';
  layer.style.opacity = '1';
  layer.style.transform = 'none';
  ghost.style.opacity = '0';
  ghost.style.transform = at(inward ? 2.6 : 0.4);
  setTimeout(() => ghost.remove(), 380);
}

function render(anim) {
  const pic = document.getElementById('pic');
  if (!pic || !G || !V) return;
  const gv = pic.querySelector('.gview');
  const W = gv.clientWidth;
  if (W < 40) return;
  const narrow = phone();
  const old = gv.querySelector('.layer:not(.ghost)');
  const oldSvg = anim && old ? old.innerHTML : '';
  if (V.sel && V.sel.startsWith('ws:') && !G.P.ov.some((o) => 'ws:' + o.id === V.sel)) needOverview();
  let P = shown();
  pic.querySelector('.crumbs').innerHTML = crumbs(P, V, { pane: narrow }).map((c) => {
    if (!c.k) return '<span class="cur">' + esc(c.words) + '</span>';
    const r = pressView(G.P, V, c.k);
    return '<a href="' + esc(r.view ? addressOf(r.view) : '/') + '" data-k="' + esc(c.k) + '">' + esc(c.words) + '</a>';
  }).join('<span class="sep">›</span>');
  pic.querySelector('[data-k="out"]').disabled = V.level === 0;
  pic.querySelector('[data-k="in"]').disabled = V.level === 2 || (V.level === 0 && !G.P.ov.some((o) => o.opens));
  // the picture starts below the crumbs, however many lines they wrap to
  gv.style.paddingTop = Math.max(0, pic.querySelector('.gbar').offsetHeight + 8 - 46) + 'px';
  let out = drawNow(P);
  // a selection the picture no longer draws (a task finished since, an old link) lets go
  if (V.sel && !out.hits.some((h) => h.k === V.sel)) {
    V = { ...V, sel: null };
    history.replaceState(null, '', addressOf(V));
    P = shown();
    out = drawNow(P);
  }
  gv.innerHTML = '<div class="layer">' + out.svg + '</div>';
  pic.querySelector('.pslot').innerHTML = stripHtml(V.sel ? detail(P, V, V.sel) : null);
  pic.querySelector('.legend').innerHTML = legend(P, V, narrow ? 'narrow' : 'web', { measure, sideFold: out.sideFold }).map((e) => '<span>' + e.svg + esc(e.words) + '</span>').join('');
  const s = sinceWords(P, V);
  const since = pic.querySelector('.since');
  since.hidden = !s;
  since.innerHTML = s ? '<span class="cdot' + (s.moved ? '' : ' still') + '"></span><span>Since your last look, <b>' + esc(s.when) + '</b>: ' + esc(s.words) + '</span>' : '';
  pic.querySelector('.urlline').textContent = addressOf(V);
  if (oldSvg) zoomPlay(gv, oldSvg, anim, W);
  lastPic = out;
}

/* a page fetched to swap in, 'reload' when the browser's login has gone */
async function pageAt(addr) {
  const res = await fetch(addr, { cache: 'no-store' });
  if (res.status === 401) { location.reload(); return 'reload'; }
  const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
  return doc.getElementById('view') ? doc : null;
}

/* the page's sections around the picture swapped in place; the picture's box stays, so a zoom in it plays on */
function applyDoc(doc, addr, keepOpen) {
  const next = doc.getElementById('view');
  const view = document.getElementById('view');
  const pic = document.getElementById('pic');
  const npic = next.querySelector(':scope > #pic');
  const open = keepOpen ? [...view.querySelectorAll('details')].map((d) => d.open) : [];
  if (pic && npic && pic.parentNode === view) {
    const before = [];
    const after = [];
    let past = false;
    for (const n of [...next.childNodes]) { if (n === npic) past = true; else (past ? after : before).push(n); }
    for (const n of [...view.childNodes]) if (n !== pic) n.remove();
    pic.before(...before);
    pic.after(...after);
    for (const a of [...next.attributes]) view.setAttribute(a.name, a.value);
  } else view.replaceWith(next);
  document.querySelectorAll('#view details').forEach((d, i) => { if (open[i]) d.open = true; });
  document.title = doc.title;
  document.body.dataset.seq = doc.body.dataset.seq;
  const icon = doc.getElementById('favicon');
  if (icon) document.getElementById('favicon').href = icon.href;
  const nav = doc.getElementById('nav');
  if (nav) document.getElementById('nav').innerHTML = nav.innerHTML;
  G = readData();
  if (G && G.P) G.page.path = new URL(addr, location.href).pathname;
  else G = null;
  drawn = null;
  settingsApply();
}

/* a step to another view: drawn at once when this page's data holds it, else after its page arrives */
async function go(nv, dir, from, { push = true, addr = null } = {}) {
  const mine = ++navSeq;
  const to = addr || addressOf(nv);
  const anim = dir ? { dir, origin: dir > 0 ? originOf(from) : lastPic ? { x: lastPic.w / 2, y: 140 } : null } : null;
  HOV = null;
  if (nv && canDraw(G.P, nv)) {
    V = nv;
    if (push) history.pushState(null, '', to);
    render(anim);
    const t0 = Date.now();
    const doc = await pageAt(to).catch(() => null);
    // the zoom plays out before the page's sections move under it
    await sleep(380 - (Date.now() - t0));
    if (mine !== navSeq || !doc || doc === 'reload') return;
    applyDoc(doc, to);
    if (G) { V = viewHere(); render(); }
    return;
  }
  const doc = await pageAt(to).catch(() => null);
  if (mine !== navSeq || doc === 'reload') return;
  if (!doc) { location.href = to; return; }
  if (push) history.pushState(null, '', to);
  applyDoc(doc, to);
  if (G) { V = viewHere(); render(anim); }
}
function select(v) {
  V = v;
  HOV = null;
  history.replaceState(null, '', addressOf(V));
  render();
}

/* a pressed portal scrolls its lit twin into view */
function twinIntoView(k) {
  setTimeout(() => {
    const t = [...document.querySelectorAll('#pic .hit.lit[data-k^="prt:"]')].find((e) => e.dataset.k !== k);
    if (t) t.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, 60);
}
function press(k) {
  if (!G || !V) return;
  let r = null;
  if (k === 'in' && V.level === 0) {
    // the Overview's data holds no workstream's tracks: + opens the selected one, else the first
    const s = V.sel && V.sel.startsWith('ws:') ? V.sel.slice(3) : null;
    const o = G.P.ov.find((x) => x.id === s && x.opens) || G.P.ov.find((x) => x.opens);
    if (o) r = { view: { level: 1, ws: o.id, tr: null, sel: null }, dir: 1, from: 'ws:' + o.id };
  } else r = pressView(G.P, V, k);
  if (!r) return;
  if (r.view) {
    // a jump to a task on another workstream opens its page
    if (r.view.level === 2 && !canDraw(G.P, r.view) && k.startsWith('jump:')) location.href = urlOf(k.slice(5));
    else if (r.dir) go(r.view, r.dir, r.from);
    else { select(r.view); if (k.startsWith('prt:')) twinIntoView(k); }
  } else if (r.open) {
    const o = G.P.ov.find((x) => x.id === r.open);
    if (/^WS-\d+$/.test(r.open) && (!o || o.opens)) go({ level: 1, ws: r.open, tr: null, sel: null }, 1, 'ws:' + r.open);
    else location.href = urlOf(r.open);
  } else if (r.list) location.href = urlOf(r.list) + '#done';
  else if (r.answer) location.href = urlOf(r.answer);
  else if (r.copy) copyText(location.origin + addressOf(V), document.querySelector('#pic [data-k="copy"]'), 'Copy link');
}

/* the board is served over plain http on a LAN, where the browser offers no navigator.clipboard */
function copyText(text, b, label) {
  const done = () => {
    if (!b) return;
    b.textContent = 'Copied';
    b.classList.add('done');
    setTimeout(() => { b.textContent = label; b.classList.remove('done'); }, 1400);
  };
  const fallback = () => {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch {}
    ta.remove();
    done();
  };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
  else fallback();
}

document.addEventListener('click', (e) => {
  const c = e.target.closest('[data-copy]');
  if (c) { copyText(c.getAttribute('data-copy'), c, 'Copy'); return; }
  const pic = document.getElementById('pic');
  if (pic && pic.contains(e.target)) {
    const el = e.target.closest('[data-k]');
    if (el && pic.contains(el)) {
      // a crumb is a link too: a modified press opens it in a new tab
      if (el.tagName === 'A' && (e.ctrlKey || e.metaKey || e.shiftKey || e.button)) return;
      e.preventDefault();
      press(el.getAttribute('data-k'));
      return;
    }
    // the ground lets the selection go
    if (e.target.closest('.gview') && V && V.sel) select({ ...V, sel: null });
    return;
  }
  const card = e.target.closest('[data-href]');
  if (card && !e.target.closest('a, button')) location.href = card.getAttribute('data-href');
});
// hover previews the trace on the board page only; a phone and the pane have no hover
document.addEventListener('mouseover', (e) => {
  // Chrome sends a mouseover at a press under a pointer that has not moved: a redraw then would swallow the press
  if (!G || !V || V.sel || e.buttons || !canHover.matches || phone()) return;
  const el = e.target.closest('#pic .gview [data-k]');
  let k = el ? el.getAttribute('data-k') : null;
  if (k && !/^(stn|pill|ws|link):/.test(k)) k = null;
  if (k === HOV) return;
  HOV = k;
  const layer = document.querySelector('#pic .gview .layer:not(.ghost)');
  if (!layer) return;
  lastPic = drawNow(shown());
  layer.innerHTML = lastPic.svg;
});
// the wheel over the picture scrolls the page and Ctrl with it zooms the page: levels change by presses, crumbs, + and - and Back
window.addEventListener('popstate', () => {
  if (!G || !V) { location.reload(); return; }
  const u = new URL(location.href);
  const nv = viewOf(u.pathname, u.search, G.P);
  const dir = nv ? Math.sign(nv.level - V.level) : 0;
  go(nv, dir, nv && dir > 0 ? (nv.level === 2 ? 'pill:' + nv.tr : 'ws:' + nv.ws) : null, { push: false, addr: u.pathname + u.search });
});

function startPicture() {
  G = readData();
  if (!G || !G.P) { G = null; return; }
  G.page.path = location.pathname;
  V = viewHere();
  render();
}

/* A wait that doubles to half a minute, so a failing reply never makes a tight loop. */
function backoff() {
  let ms = 0;
  return { wait: () => { ms = Math.min(30000, ms ? ms * 2 : 2000); return sleep(ms); }, reset: () => { ms = 0; } };
}

/* A field being typed in stops the swap: it has focus, or holds other than the value drawn. */
function typing() {
  const a = document.activeElement;
  if (a && a.closest('#view') && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return true;
  return [...document.querySelectorAll('#view [data-drawn]')].some((f) => f.value !== f.getAttribute('data-drawn'));
}

/* the page again, swapped in place: what is open stays open, the scroll and the picture's view stay put;
   false when no page came. While a field is being typed in the page stays, and the next change swaps it once the field is left. */
async function refresh() {
  if (typing()) return true;
  const mine = navSeq;
  const doc = await pageAt(location.href);
  if (doc === 'reload') return true;
  if (!doc) return false;
  if (mine !== navSeq) return true;
  applyDoc(doc, location.href, true);
  if (G) { V = viewHere(); render(); }
  return true;
}

/* ---- the settings page: live search, Changed only, sub-tabs and folds in place ---- */
const sset = { q: '', only: false, more: new Set(), pick: new Set() };
const all = (sel, root) => [...(root || document).querySelectorAll(sel)];

function settingsApply() {
  const v = document.querySelector('#view .settings');
  if (!v) return;
  all('.sfind, .tog.only', v).forEach((n) => { n.hidden = false; });
  const q = sset.q.trim().toLowerCase();
  v.classList.toggle('searching', !!q);
  const find = v.querySelector('.sfind');
  if (find && find.value !== sset.q) find.value = sset.q;
  const only = v.querySelector('.tog.only');
  if (only) { only.setAttribute('aria-pressed', String(sset.only)); only.querySelector('.sw').classList.toggle('on', sset.only); }
  const cur = new URL(location.href).searchParams.get('tab') || 'replies';
  all('.subs a', v).forEach((a) => { const on = !q && a.getAttribute('data-go') === cur; a.classList.toggle('on', on); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  all('.srow[data-key]', v).forEach((r) => {
    const k = r.getAttribute('data-key');
    r.classList.toggle('more-open', sset.more.has(k));
    r.classList.toggle('pick-open', sset.pick.has(k));
    const c = r.querySelector(':scope > .sr > .pchip');
    if (c && sset.pick.has(k)) c.classList.add('active');
  });
  let hits = 0;
  let groups = 0;
  all('.sub', v).forEach((s) => {
    let n = 0;
    all('.srow, .lrow', s).forEach((r) => {
      const keep = (!sset.only || r.hasAttribute('data-changed')) && (!q || (r.getAttribute('data-find') || '').includes(q));
      r.classList.toggle('hide', !keep);
      if (keep) n++;
    });
    all('.panel', s).forEach((p) => {
      if (!p.classList.contains('dev')) { p.classList.toggle('hide', !p.querySelector('.srow:not(.hide), .lrow:not(.hide)')); return; }
      const keep = !sset.only && (!q || (p.getAttribute('data-find') || '').includes(q));
      p.classList.toggle('hide', !keep);
      if (keep && q) n++;
    });
    all('.addline, .dropnote', s).forEach((x) => x.classList.toggle('hide', !!q || sset.only));
    /* a search opens the built-in lines while it shows their matches, and shuts them again after */
    all('.bfold', s).forEach((x) => {
      if (q) { if (!x.hasAttribute('data-was')) x.setAttribute('data-was', x.open ? '1' : ''); x.open = true; } else if (x.hasAttribute('data-was')) { x.open = !!x.getAttribute('data-was'); x.removeAttribute('data-was'); }
      x.classList.toggle('hide', sset.only || (!!q && !x.querySelector('.lrow:not(.hide)')));
    });
    s.classList.toggle('on', q ? n > 0 : s.getAttribute('data-sub') === cur);
    if (q && n) { hits += n; groups++; }
  });
  const head = v.querySelector('.sum.hits');
  if (head) {
    const t = sset.q.trim();
    head.textContent = !q ? '' : hits ? hits + (hits === 1 ? ' setting' : ' settings') + ' in ' + groups + (groups === 1 ? ' group' : ' groups') + (hits === 1 ? ' matches "' : ' match "') + t + '".' : 'No setting matches "' + t + '".';
  }
}

function settingsInit() {
  const v = document.querySelector('#view .settings');
  if (!v) return;
  const u = new URL(location.href);
  /* a refused post's page stands at its form's address, and a saved line shows once */
  if (u.pathname !== '/settings' && v.getAttribute('data-back')) history.replaceState(null, '', v.getAttribute('data-back'));
  else if (u.searchParams.has('saved')) { u.searchParams.delete('saved'); history.replaceState(null, '', u.pathname + (u.search || '') + u.hash); }
  all('.srow.pick-open[data-key]', v).forEach((r) => sset.pick.add(r.getAttribute('data-key')));
  document.addEventListener('click', (e) => {
    if (!document.querySelector('#view .settings')) return;
    const t = e.target;
    const go = t.closest('.settings [data-go]');
    if (go) {
      e.preventDefault();
      const next = new URL(location.href);
      if (go.getAttribute('data-go') === 'replies') next.searchParams.delete('tab'); else next.searchParams.set('tab', go.getAttribute('data-go'));
      history.replaceState(null, '', next.pathname + next.search);
      sset.q = '';
      settingsApply();
      return;
    }
    if (t.closest('.settings .tog.only')) { sset.only = !sset.only; settingsApply(); return; }
    const fold = t.closest('.settings .mbtn, .settings .pchip');
    if (fold) {
      e.preventDefault();
      const set = fold.classList.contains('mbtn') ? sset.more : sset.pick;
      const k = fold.closest('.srow').getAttribute('data-key');
      if (set.has(k)) set.delete(k); else set.add(k);
      settingsApply();
    }
  });
  document.addEventListener('input', (e) => { if (e.target.classList && e.target.classList.contains('sfind')) { sset.q = e.target.value; settingsApply(); } });
  settingsApply();
}

/* ---- one held poll per browser ----
   A browser keeps six connections per host, so a poll per tab stalls the seventh tab.
   One visible tab polls (a Web Lock, else a BroadcastChannel claim) and tells the others
   what it hears; while every tab is hidden nobody polls. */
const NAME = 'askerdo-board-poll';
const chan = typeof BroadcastChannel === 'function' ? new BroadcastChannel(NAME) : null;
const locks = navigator.locks && typeof navigator.locks.request === 'function' ? navigator.locks : null;
const me = Math.random().toString(36).slice(2);
const pageSeq = () => Number(document.body.dataset.seq || 0);
let heard = pageSeq();
let stale = false;
const pageWait = backoff();
const pollWait = backoff();

let refreshing = false;
let again = false;
async function refreshNow() {
  if (refreshing) { again = true; return; }
  refreshing = true;
  try {
    do {
      again = false;
      if (document.hidden) { stale = true; break; }
      let ok = false;
      try { ok = await refresh(); } catch { ok = false; }
      if (ok) { pageWait.reset(); stale = false; } else { await pageWait.wait(); again = true; }
    } while (again);
  } finally { refreshing = false; }
}

/* any seq unlike the page's, a board ahead or behind (a restore), redraws the page */
function hear(seq) {
  if (!Number.isInteger(seq)) return;
  heard = seq;
  if (seq !== pageSeq()) refreshNow();
}

let polling = null;
async function holdPoll() {
  const ctl = new AbortController();
  polling = ctl;
  try {
    while (!ctl.signal.aborted && !document.hidden) {
      let seq;
      try {
        const res = await fetch('/web/wait?after=' + heard, { cache: 'no-store', signal: ctl.signal });
        if (res.status === 401) { location.reload(); return; }
        seq = (await res.json()).seq;
      } catch { if (ctl.signal.aborted) break; }
      if (Number.isInteger(seq)) {
        pollWait.reset();
        if (chan) chan.postMessage({ t: 'seq', seq });
        hear(seq);
      } else await pollWait.wait();
    }
  } finally { if (polling === ctl) polling = null; }
}

/* `bye` tells the other tabs to claim now; a leader yielding to another says nothing */
function stepDown(bye) {
  const p = polling;
  if (!p) return;
  polling = null;
  p.abort();
  if (bye && chan && !locks) chan.postMessage({ t: 'bye', id: me });
}

/* Web Locks: the browser hands the lock to one waiting tab at a time */
let asking = null;
function askLock() {
  if (asking || polling || document.hidden) return;
  const ctl = new AbortController();
  asking = ctl;
  locks.request(NAME, { signal: ctl.signal }, () => { asking = null; return document.hidden ? null : holdPoll(); })
    .catch(() => {}).finally(() => { if (asking === ctl) asking = null; });
}

/* BroadcastChannel: the leader beats every second; a visible tab that hears none claims,
   and of two leaders the higher id steps down */
const BEAT_MS = 1000;
let beatSeen = Date.now();
let beater = 0;
function tick() {
  if (document.hidden) return;
  if (polling) chan.postMessage({ t: 'beat', id: me });
  else if (Date.now() - beatSeen > 2.5 * BEAT_MS) { holdPoll(); chan.postMessage({ t: 'beat', id: me }); }
}

if (chan) {
  chan.onmessage = ({ data }) => {
    if (!data) return;
    if (data.t === 'seq') hear(data.seq);
    else if (data.t === 'beat') {
      beatSeen = Date.now();
      if (polling && data.id < me) stepDown(false);
    } else if (data.t === 'bye' && !locks) {
      beatSeen = 0;
      setTimeout(tick, Math.random() * 150);
    }
  };
}

function lead() {
  if (document.hidden) return;
  if (locks) askLock();
  else if (chan) { if (!beater) beater = setInterval(tick, BEAT_MS); } else if (!polling) holdPoll();
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stepDown(true);
    if (asking) asking.abort();
    if (beater) { clearInterval(beater); beater = 0; }
    return;
  }
  if (stale || heard !== pageSeq()) refreshNow();
  beatSeen = Date.now();
  lead();
});
window.addEventListener('pagehide', () => stepDown(true));
window.addEventListener('pageshow', (e) => { if (e.persisted) lead(); });

let resizing = 0;
window.addEventListener('resize', () => { clearTimeout(resizing); resizing = setTimeout(() => render(), 150); });
window.addEventListener('pagehide', keepLooks);
document.addEventListener('visibilitychange', () => { if (document.hidden) keepLooks(); });
// the picture measures in Geist, so it draws once the face has come (or after a moment without it)
let started = false;
const first = () => { if (!started) { started = true; startPicture(); } };
if (document.fonts && !document.fonts.check('600 15px Geist')) {
  document.fonts.load('600 15px Geist').then(() => { if (started) { widths.clear(); render(); } else first(); }, first);
  setTimeout(first, 1500);
} else first();
// a link to a track's finished list opens it
if (location.hash === '#done') { const d = document.getElementById('done'); if (d) d.open = true; }
settingsInit();
lead();
