/* The board page's one script: paints the drawn graph at its box's
   width, wires Copy and the cards, and holds a long poll that swaps the page in
   place when the board changes. */
import { SKIN_NARROW, SKIN_WEB, drawFit } from './draw.mjs';

const narrow = () => window.innerWidth < 700;

/* captions and labels wrap on measured widths, since bold Geist runs wider than any estimate */
const pen = document.createElement('canvas').getContext('2d');
const widths = new Map();
function measure(text, size, weight) {
  const key = weight + ' ' + size + ' ' + text;
  let w = widths.get(key);
  if (w === undefined) {
    pen.font = weight + ' ' + size + 'px ' + SKIN_WEB.font;
    w = pen.measureText(text).width;
    widths.set(key, w);
  }
  return w;
}

/* the picture is drawn after its box is in the page, so it knows the box's width */
function paint() {
  const data = document.getElementById('gdata');
  const box = document.querySelector('.gbox[data-graph]');
  if (!data || !box) return;
  const G = JSON.parse(data.textContent);
  /* interactive: each station and caption is a link to its own record */
  box.innerHTML = drawFit(G.L, G.D, G.g, narrow() ? SKIN_NARROW : SKIN_WEB,
    { interactive: true, view: box.clientWidth, measure, label: 'The drawn graph of ' + box.getAttribute('data-graph') });
}

function wire() {
  document.querySelectorAll('[data-href]').forEach((n) => n.addEventListener('click', (e) => {
    if (e.target.closest('a, button')) return;
    location.href = n.getAttribute('data-href');
  }));
  document.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', () => {
    const text = b.getAttribute('data-copy');
    const done = () => { b.textContent = 'Copied'; b.classList.add('done'); setTimeout(() => { b.textContent = 'Copy'; b.classList.remove('done'); }, 1400); };
    const fallback = () => {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch {}
      ta.remove();
      done();
    };
    try { navigator.clipboard.writeText(text).then(done, fallback); } catch { fallback(); }
  }));
}

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
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

/* the page again, swapped in place: what is open stays open, the scroll stays put; false when no page came.
   While a field is being typed in the page stays, and the next change swaps it once the field is left. */
async function refresh() {
  if (typing()) return true;
  const res = await fetch(location.href, { cache: 'no-store' });
  if (res.status === 401) { location.reload(); return true; }
  const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
  const next = doc.getElementById('view');
  if (!next) return false;
  const open = [...document.querySelectorAll('#view details')].map((d) => d.open);
  document.getElementById('view').replaceWith(next);
  next.querySelectorAll('details').forEach((d, i) => { if (open[i]) d.open = true; });
  document.title = doc.title;
  document.body.dataset.seq = doc.body.dataset.seq;
  const icon = doc.getElementById('favicon');
  if (icon) document.getElementById('favicon').href = icon.href;
  paint();
  wire();
  settingsApply();
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
window.addEventListener('resize', () => { clearTimeout(resizing); resizing = setTimeout(paint, 150); });
paint();
// widths taken before Geist arrived were the fallback's: measure again once it has
if (!document.fonts.check('700 14px Geist')) document.fonts.load('700 14px Geist').then(() => { widths.clear(); paint(); }, () => {});
wire();
settingsInit();
lead();
