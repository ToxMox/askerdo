/* The board's web views, mounted on the API
   server's web hook: plain HTML per page, the login cookie checked first, and one
   long poll the page's script holds open until the board changes. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DAY_RE, STAMP_RE, clockOf } from '../records.mjs';
import { UsageError, canonLabel } from '../verbs/labels.mjs';
import { activityModel, rulingsModel } from './browse.mjs';
import { activityPage, rulingsPage } from './browse-pages.mjs';
import {
  faceNow, findRecord, lastSeq, needsYouModel, overviewModel, recordModel, searchModel, trackModel, workstreamKey, workstreamModel,
} from './data.mjs';
import {
  graphData, needsYouPage, notFoundPage, overridePage, overviewPage, pageKit, recordPage, searchPage, shell, signInPage, trackPage, workstreamPage,
} from './pages.mjs';
import { overrideView } from '../verbs/override.mjs';
import { boardVersion } from '../version.mjs';
import { settingsModel, settingsWrite } from './settings.mjs';
import { SIGNED_OUT_LINE, settingsPage } from './settings-page.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
/* A held poll answers empty after this long, under common proxy idle limits. */
export const WAIT_MS = 25000;

const STATIC = {
  'board.css': 'text/css; charset=utf-8',
  'client.mjs': 'text/javascript; charset=utf-8',
  'draw.mjs': 'text/javascript; charset=utf-8',
  'geist.woff2': 'font/woff2',
  /* Unraid's Docker tab fetches the app's icon from here */
  'icon.png': 'image/png',
};

/* The files once, each with its content hash, so a page names a version and the
   browser keeps it for a year. */
function loadAssets() {
  const files = {};
  const hash = (b) => createHash('sha256').update(b).digest('hex').slice(0, 10);
  for (const name of Object.keys(STATIC)) {
    const path = ['geist.woff2', 'icon.png'].includes(name) ? join(HERE, 'assets', name) : join(HERE, name);
    files[name] = { body: readFileSync(path), type: STATIC[name] };
    files[name].v = hash(files[name].body);
  }
  /* the client imports the drawing at its own version */
  const client = files['client.mjs'];
  client.body = Buffer.from(client.body.toString('utf8').replace("'./draw.mjs'", "'./draw.mjs?v=" + files['draw.mjs'].v + "'"));
  client.v = hash(client.body);
  const css = files['board.css'];
  css.body = Buffer.from(css.body.toString('utf8').replace('/web/geist.woff2', '/web/geist.woff2?v=' + files['geist.woff2'].v));
  css.v = hash(css.body);
  /* the real marks, byte for byte, as data URLs */
  const svg = (f) => 'data:image/svg+xml;base64,' + readFileSync(join(HERE, 'assets', f)).toString('base64');
  const marks = { app: svg('app-mark-dark.svg'), waiting: svg('favicon.svg'), quiet: svg('favicon-quiet.svg'), blocking: svg('favicon-blocking.svg') };
  return { files, kit: pageKit({ marks, assets: { css: '/web/board.css?v=' + css.v, client: '/web/client.mjs?v=' + client.v }, version: boardVersion() }) };
}

/* A path segment decoded, or null when it is not valid percent-encoding. */
const decoded = (s) => { try { return decodeURIComponent(s); } catch { return null; } };

const html = (res, { status, html: body }, extra = {}) => {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store', ...extra });
  res.end(body);
};

/* The nav's Workstream and Track: the page's own, else the line a session is on. */
function navLinks(db, ws, track) {
  if (!ws || !track) {
    const r = db.stmt(`SELECT t.label AS track, w.label AS ws FROM leases l JOIN records t ON t.key = l.track
      LEFT JOIN records w ON w.key = t.workstream ORDER BY l.seen DESC LIMIT 1`).get()
      || db.stmt(`SELECT t.label AS track, w.label AS ws FROM records t LEFT JOIN records w ON w.key = t.workstream
        WHERE t.kind = 'track' AND coalesce(t.status, '') NOT IN ('done', 'dropped', 'folded') ORDER BY t.updated DESC LIMIT 1`).get();
    if (r) { ws = ws || r.ws; track = track || r.track; }
  }
  return { ws: ws ? '/ws/' + encodeURIComponent(ws) : null, track: track ? '/r/' + encodeURIComponent(track) : null };
}

export function createWeb({ db, clock = null } = {}) {
  if (!db) throw new TypeError('the web views need the database');
  const { files, kit } = loadAssets();
  const waiters = new Set();
  const opts = () => (clock ? { now: clock() } : {});

  function page(view, title, main, { seq, ws, track, data, face, status } = {}) {
    return shell(kit, { title, view, main, seq: seq ?? lastSeq(db), face: face || faceNow(db, opts()), links: navLinks(db, ws, track), data, status });
  }

  function wsPage(key) {
    const m = workstreamModel(db, key, opts());
    return page('ws', m.ws.id + ' ' + m.ws.name, workstreamPage(kit, m), { seq: m.seq, ws: m.ws.id, data: graphData(m) });
  }

  function trackPageOf(key) {
    const m = trackModel(db, key, opts());
    return page('track', m.track.id + ' ' + m.track.name, trackPage(kit, m), { seq: m.seq, ws: m.ws.id, track: m.track.id, data: m.L.lines.length ? graphData(m) : null });
  }

  function recordRoute(label, at) {
    const found = findRecord(db, label, { at });
    if (!found) return page('', 'Not found', notFoundPage(kit, 'No record is or was labelled ' + label + '.'), { status: 404 });
    if (found.kind === 'track') return trackPageOf(found.key);
    if (found.kind === 'workstream' && !found.holders.length) {
      const st = db.stmt('SELECT status FROM records WHERE key = ?').get(found.key);
      if (st && st.status === 'open') return wsPage(found.key);
    }
    const m = recordModel(db, found.key);
    return page('', m.label + ' ' + (m.title || m.kind), recordPage(kit, m, found));
  }

  /* Held until the board moves past `after`, or WAIT_MS passes; a page ahead of the
     board (a restore) is answered at once, so it redraws. */
  function wait(req, res, url) {
    const after = Number(url.searchParams.get('after'));
    const reply = (seq) => {
      const text = JSON.stringify({ seq }) + '\n';
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text), 'cache-control': 'no-store' });
      res.end(text);
    };
    const now = lastSeq(db);
    if (!Number.isInteger(after) || now !== after) return reply(now);
    const waiter = { after, done: (seq) => { waiters.delete(waiter); clearTimeout(timer); if (!res.writableEnded) reply(seq); } };
    const timer = setTimeout(() => waiter.done(lastSeq(db)), WAIT_MS);
    waiters.add(waiter);
    req.on('close', () => { waiters.delete(waiter); clearTimeout(timer); });
    return undefined;
  }

  /* The settings page for a query, with a save's or a refusal's line. */
  function settingsView(req, ctx, params, st = {}, status = 200) {
    const q = {};
    for (const k of ['scope', 'record', 'ws', 'tab', 'edit', 'place']) q[k] = String(params.get(k) || '').trim();
    let m;
    try {
      m = settingsModel(db, q, { device: ctx.device, origin: 'http://' + (req.headers.host || 'board'), tokens: ctx.tokens ? ctx.tokens() : [] });
    } catch (e) {
      if (!(e instanceof UsageError)) throw e;
      return page('settings', 'Not found', notFoundPage(kit, e.message + '.'), { status: 404 });
    }
    return page('settings', 'Settings', settingsPage(kit, m, st), { status, ws: m.ws ? m.ws.id : null, track: m.scope.kind === 'track' ? m.scope.record : null });
  }

  /* A form back to the page it came from, or the page itself. */
  const settingsBack = (b) => new URL(typeof b === 'string' && /^\/settings(\?[^#\s\\]*)?$/.test(b) ? b : '/settings', 'http://board');
  /* A browser names the page a post came from; only the board's own host may write. */
  const sameOrigin = (req) => !!req.headers.host && ['http://', 'https://'].some((p) => req.headers.origin === p + req.headers.host);

  /* a settings form, written as the user from the device this browser signed in through;
     a save answers 303 to its page, a refusal draws the page again with the verb's words. */
  async function settingsPost(req, res, ctx, what) {
    const device = ctx.session ? ctx.session() : null;
    if (!device) {
      html(res, shell(kit, { title: 'Sign in', view: '', main: signInPage(kit).replace('</ol></div>', '</ol>' + SIGNED_OUT_LINE + '</div>'), seq: 0, status: 401, script: false }));
      return true;
    }
    if (!sameOrigin(req)) {
      html(res, page('settings', 'Not saved', notFoundPage(kit, 'Not saved: settings change only from a page this board served.'), { status: 403 }));
      return true;
    }
    const form = await ctx.readForm();
    const back = settingsBack(form.back);
    const key = what === 'rule' ? 'rules' : String(form.key || '');
    try {
      settingsWrite(db, what, form, device);
    } catch (e) {
      if (!(e instanceof UsageError)) throw e;
      html(res, settingsView(req, { ...ctx, device }, back.searchParams, { refused: { key, why: e.message, form } }, 400));
      return true;
    }
    if (ctx.wrote) ctx.wrote();
    back.searchParams.delete('edit');
    back.searchParams.delete('place');
    back.searchParams.set('saved', key);
    res.writeHead(303, { location: back.pathname + '?' + back.searchParams.toString() + '#s-' + key, 'cache-control': 'no-store' });
    res.end();
    return true;
  }

  function serveStatic(res, name) {
    const f = files[name];
    res.writeHead(200, { 'content-type': f.type, 'content-length': f.body.length, 'cache-control': 'public, max-age=31536000, immutable' });
    res.end(f.body);
  }

  async function web(req, res, ctx) {
    const { url } = ctx;
    const path = url.pathname;
    if (req.method === 'POST' && ['/settings/set', '/settings/unset', '/settings/rule'].includes(path)) return settingsPost(req, res, ctx, path.slice(10));
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    if (path.startsWith('/web/') && Object.hasOwn(files, path.slice(5))) { serveStatic(res, path.slice(5)); return true; }
    if (path === '/favicon.ico') { res.writeHead(204); res.end(); return true; }
    if (!ctx.device) {
      if (path === '/web/wait') { res.writeHead(401, { 'content-type': 'application/json; charset=utf-8' }); res.end('{"ok":false,"error":"sign in"}\n'); return true; }
      const main = signInPage(kit);
      html(res, shell(kit, { title: 'Sign in', view: '', main: path === '/settings' ? main.replace('</ol></div>', '</ol>' + SIGNED_OUT_LINE + '</div>') : main, seq: 0, status: 401, script: false }));
      return true;
    }
    if (path === '/web/wait') { wait(req, res, url); return true; }
    let out;
    if (path === '/' || path === '') {
      const m = overviewModel(db, opts());
      out = page('overview', 'AskerDo board', overviewPage(kit, m), { seq: m.seq, face: m.face });
    } else if (path.startsWith('/ws/')) {
      const label = decoded(path.slice(4));
      const key = label === null ? null : workstreamKey(db, label);
      out = key ? wsPage(key) : page('ws', 'Not found', notFoundPage(kit, 'No workstream is labelled ' + (label ?? path.slice(4)) + '.'), { status: 404 });
    } else if (path.startsWith('/r/')) {
      const label = decoded(path.slice(3));
      const at = url.searchParams.get('at') || undefined;
      if (label === null) out = page('', 'Not found', notFoundPage(kit, 'No record is or was labelled ' + path.slice(3) + '.'), { status: 404 });
      else if (at !== undefined && !DAY_RE.test(at) && !STAMP_RE.test(at)) out = page('', 'Not a day', notFoundPage(kit, 'A day reads YYYY-MM-DD, not ' + at + '.'), { status: 400 });
      else out = recordRoute(label, at);
    } else if (path.startsWith('/override/')) {
      const n = decoded(path.slice(10));
      const m = n === null ? null : overrideView(db, { request: n }, opts());
      out = m ? page('', 'Override #' + m.request, overridePage(kit, m))
        : page('', 'Not found', notFoundPage(kit, 'No override request ' + (n ?? path.slice(10)) + ' is waiting: it was decided, or never asked. Each record keeps its history.'), { status: 404 });
    } else if (path === '/needs-you') {
      const m = needsYouModel(db, { repo: url.searchParams.get('repo'), project: url.searchParams.get('project') }, opts());
      out = page('needs', 'Needs you', needsYouPage(kit, m), { seq: m.seq, face: m.face });
    } else if (path === '/activity') {
      const q = (k) => String(url.searchParams.get(k) || '').trim();
      try {
        const m = activityModel(db, { ws: q('ws'), before: q('before'), now: clockOf(opts()).getTime() });
        out = page('activity', m.ws ? 'Activity in ' + m.ws.id : 'Activity', activityPage(kit, m), { seq: m.seq, ws: m.ws ? m.ws.id : null });
      } catch (e) {
        if (!(e instanceof UsageError)) throw e;
        out = page('activity', 'Not found', notFoundPage(kit, e.message + '.'), { status: 404 });
      }
    } else if (path === '/rulings') {
      const q = (k) => String(url.searchParams.get(k) || '').trim();
      const m = rulingsModel(db, { ws: q('ws'), project: q('project'), kind: q('kind'), page: q('page') });
      out = m ? page('rulings', m.group ? 'Rulings in ' + (m.group.id || m.group.name) : 'Rulings', rulingsPage(kit, m, clockOf(opts()).getTime()), { seq: m.seq, ws: m.group && m.group.kind === 'ws' ? m.group.id : null })
        : page('rulings', 'Not found', notFoundPage(kit, 'No group of rulings is named ' + (q('ws') || q('project')) + '.'), { status: 404 });
    } else if (path === '/settings') {
      const saved = String(url.searchParams.get('saved') || '');
      out = settingsView(req, ctx, url.searchParams, saved ? { saved } : {});
    } else if (path === '/search') {
      const q = String(url.searchParams.get('q') || '').trim();
      /* a label typed into search opens its page */
      if (canonLabel(q) && findRecord(db, q)) {
        res.writeHead(302, { location: '/r/' + encodeURIComponent(q) });
        res.end();
        return true;
      }
      out = page('', 'Search', searchPage(kit, searchModel(db, q)));
    } else {
      out = page('', 'Not found', notFoundPage(kit, 'The board has no page at ' + path + '.'), { status: 404 });
    }
    html(res, out);
    return true;
  }

  /* The API calls this after each commit's activity rows are pushed. */
  web.changed = (seq) => { for (const w of [...waiters]) if (seq > w.after) w.done(seq); };
  web.close = () => { for (const w of [...waiters]) w.done(lastSeq(db)); };
  return web;
}
