// the onboarding review page's controls. render.mjs inlines this file into review.html.
// Marks save to serve.mjs (POST /choices) and to this browser as a fallback.
(function () {
  'use strict';
  var KEY = 'askerdo-onboard-' + (document.body.dataset.project || 'project');
  var SERVED = location.protocol === 'http:' || location.protocol === 'https:';
  // serve.mjs writes its per-run token into the page; a post without it is refused
  var POST = '/choices?t=' + encodeURIComponent(document.body.dataset.token || '');
  var state = { version: 1, savedAt: null, done: false, items: {} };
  var els = Array.prototype.slice.call(document.querySelectorAll('.item'));
  var timer = null;
  var chain = Promise.resolve();
  var $ = function (id) { return document.getElementById(id); };

  function lsGet() { try { var s = window.localStorage.getItem(KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; } }
  function lsSet() { try { window.localStorage.setItem(KEY, JSON.stringify(state)); return true; } catch (e) { return false; } }

  function rec(id) { return state.items[id] || null; }
  function setRec(id, patch) {
    var r = state.items[id] || { choice: null, note: '' };
    for (var k in patch) r[k] = patch[k];
    if (!r.choice && !r.note) delete state.items[id]; else state.items[id] = r;
  }
  function current(el) { var r = rec(el.dataset.id); return (r && r.choice) || el.dataset.def || ''; }

  function grow(ta) { if (!ta || !ta.offsetParent) return; ta.style.height = 'auto'; ta.style.height = (ta.scrollHeight + 2) + 'px'; }

  function paint(el) {
    var r = rec(el.dataset.id);
    var v = current(el);
    var bs = el.querySelectorAll('button[data-v]');
    for (var i = 0; i < bs.length; i++) bs[i].setAttribute('aria-pressed', String(bs[i].dataset.v === v));
    el.dataset.state = v || 'none';
    el.classList.toggle('changed', v !== el.dataset.def);
    var ta = el.querySelector('textarea.note');
    if (!ta) return;
    var n = (r && r.note) || '';
    if (ta.value !== n && document.activeElement !== ta) ta.value = n;
    ta.placeholder = v === 'convert' ? 'How should it come in instead? (another home, other words, another track)' : (ta.dataset.ph || '');
    if (n || v === 'convert') el.classList.add('open');
    grow(ta);
  }

  function progress() {
    var changed = 0, convert = 0, groups = {};
    els.forEach(function (el) {
      if (!el.dataset.def) return;
      var v = current(el), off = v !== el.dataset.def;
      if (off) changed++;
      if (v === 'convert') convert++;
      var g = el.dataset.group;
      if (g && off) groups[g] = (groups[g] || 0) + 1;
    });
    $('p-changed').textContent = changed + ' changed from the proposal';
    $('p-convert').textContent = convert ? convert + ' to convert' : '';
    var gs = document.querySelectorAll('[data-gc]');
    for (var i = 0; i < gs.length; i++) { var n = groups[gs[i].dataset.gc] || 0; gs[i].textContent = n ? n + ' changed' : ''; }
  }

  function status(kind, code) {
    var s = $('save');
    s.dataset.k = kind;
    s.textContent = kind === 'ok' ? 'Saved' : kind === 'busy' ? 'Saving'
      : kind === 'fail' ? (code === 'HTTP 403' ? 'Not saved: the page server was restarted, so reload the page' : 'Not saved: the page server refused it (' + code + ')')
      : 'Not saved: the page server is not running';
    $('copy').hidden = kind === 'ok' || kind === 'busy';
  }

  function save() {
    state.savedAt = new Date().toISOString();
    lsSet();
    if (!SERVED) { status('down'); return Promise.resolve(false); }
    var body = JSON.stringify(state);
    chain = chain.then(function () {
      return fetch(POST, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, cache: 'no-store' })
        .then(function (r) { if (!r.ok) { status('fail', 'HTTP ' + r.status); return false; } status('ok'); return true; })
        .catch(function () { status('down'); return false; });
    });
    return chain;
  }
  function schedule() { status('busy'); clearTimeout(timer); timer = setTimeout(function () { timer = null; save(); }, 500); }
  function changed() { if (state.done) { state.done = false; doneMsg(); } progress(); schedule(); }

  function doneMsg(ok) {
    var m = $('donemsg');
    if (!state.done) { m.textContent = ''; return; }
    m.textContent = ok === false ? 'Not saved: the page server is not running. Press Copy my choices and paste them to Claude.' : 'Saved. Tell Claude you\'re done.';
  }
  function finish() { state.done = true; clearTimeout(timer); timer = null; save().then(function (ok) { doneMsg(ok); }); }

  function copy() {
    var text = JSON.stringify(state, null, 1);
    var box = $('copybox'), ok = false;
    box.value = text;
    try { box.focus(); box.select(); ok = document.execCommand('copy'); } catch (e) { ok = false; }
    var show = $('copyshow');
    if (ok) { $('copymsg').textContent = 'Copied. Paste it to Claude.'; show.hidden = true; return; }
    show.hidden = false; show.value = text; show.focus(); show.select();
    $('copymsg').textContent = 'Copy did not work here: select the text and copy it by hand.';
  }

  function adopt(d) {
    state.items = d && d.items && typeof d.items === 'object' ? d.items : {};
    state.done = !!(d && d.done);
    state.savedAt = (d && d.savedAt) || null;
    els.forEach(paint);
    progress();
    doneMsg();
    window.requestAnimationFrame(function () { els.forEach(function (el) { grow(el.querySelector('textarea.note')); }); });
  }
  function load() {
    var local = lsGet();
    if (!SERVED) { adopt(local); status('down'); return; }
    fetch('/choices', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (d) {
        var localNewer = local && local.savedAt && (!d || !d.savedAt || local.savedAt > d.savedAt);
        if (localNewer) { adopt(local); save(); } else { adopt(d); status('ok'); }
      })
      .catch(function () { adopt(local); status('down'); });
  }

  function mark(el, v) {
    setRec(el.dataset.id, { choice: v === el.dataset.def ? null : v });
    paint(el);
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('button') : null;
    if (!b) return;
    var el = b.closest('.item');
    if (el && b.dataset.v) {
      mark(el, b.dataset.v);
      changed();
      if (b.dataset.v === 'convert') { el.classList.add('open'); var ta = el.querySelector('textarea.note'); if (ta) { grow(ta); ta.focus(); } }
      return;
    }
    if (el && b.classList.contains('addnote')) { el.classList.add('open'); var t = el.querySelector('textarea.note'); if (t) { grow(t); t.focus(); } return; }
    if (b.dataset.gset) {
      var box = b.closest('details') || b.closest('section');
      var its = box ? box.querySelectorAll('.item[data-def]') : [];
      for (var i = 0; i < its.length; i++) mark(its[i], b.dataset.gset === 'proposal' ? its[i].dataset.def : b.dataset.gset);
      changed();
      return;
    }
    if (b.id === 'only') { var on = document.body.classList.toggle('only-changed'); b.setAttribute('aria-pressed', String(on)); return; }
    if (b.id === 'copy') { copy(); return; }
    if (b.id === 'done') finish();
  });

  document.addEventListener('input', function (e) {
    var ta = e.target;
    if (!ta.classList || !ta.classList.contains('note')) return;
    var el = ta.closest('.item');
    if (!el) return;
    setRec(el.dataset.id, { note: ta.value });
    grow(ta);
    changed();
  });

  document.addEventListener('toggle', function (e) {
    if (e.target.tagName !== 'DETAILS' || !e.target.open) return;
    var ts = e.target.querySelectorAll('textarea.note');
    for (var i = 0; i < ts.length; i++) grow(ts[i]);
  }, true);

  // a page loaded while its pane was still opening measured its notes at no width
  var regrowing = null;
  window.addEventListener('resize', function () {
    clearTimeout(regrowing);
    regrowing = setTimeout(function () { var ts = document.querySelectorAll('textarea.note'); for (var i = 0; i < ts.length; i++) grow(ts[i]); }, 100);
  });

  // a save still waiting on its debounce goes out as a beacon when the page closes
  window.addEventListener('pagehide', function () {
    if (!timer) return;
    clearTimeout(timer); timer = null;
    state.savedAt = new Date().toISOString();
    lsSet();
    try { if (SERVED && navigator.sendBeacon) navigator.sendBeacon(POST, new Blob([JSON.stringify(state)], { type: 'application/json' })); } catch (e) { /* the local copy stands */ }
  });

  load();
})();
