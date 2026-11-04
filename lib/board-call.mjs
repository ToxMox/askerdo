/* The PC side's one way to the board: boardCall(name, input, opts) runs a
   board verb over the transport the board URL names, ASKERDO_BOARD_URL over
   `boardUrl` in the data dir's config.json. memory: and file: run the verbs in
   process, http(s): calls a board server; with no setting it refuses, so nothing
   reaches a real board by default. */
import { readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { Agent as HttpAgent, request as httpRequest } from 'node:http';
import { Agent as HttpsAgent, request as httpsRequest } from 'node:https';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataDir, storeRoot } from './node-helpers.mjs';
import { sharedName } from './project-id.mjs';
import { API, PROTOCOL, PROTOCOL_HEADER, WEB } from '../server/paths.mjs';

export class BoardCallError extends Error {
  constructor(message, { status, data } = {}) {
    super(message);
    if (status !== undefined) this.status = status;
    if (data) this.data = data;
  }
}

function setting(env, envName, key) {
  const named = typeof env[envName] === 'string' ? env[envName].trim() : '';
  if (named) return named;
  const dir = dataDir(env);
  if (!dir) return '';
  try {
    const v = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'))[key];
    return typeof v === 'string' ? v.trim() : '';
  } catch { return ''; }
}

/* The board URL in force, or '' when none is set. */
export const boardUrl = (env = process.env) => setting(env, 'ASKERDO_BOARD_URL', 'boardUrl');
/* This PC's device token for an http(s) board, or ''. */
export const boardToken = (env = process.env) => setting(env, 'ASKERDO_BOARD_TOKEN', 'boardToken');

const schemeOf = (url) => ((/^([a-z][a-z0-9+.-]*):/i.exec(url) || [])[1] || '').toLowerCase();
const isHttp = (url) => ['http', 'https'].includes(schemeOf(url));

/* The caller as the verbs read it: the session and its PC, the user's chip, else the
   CLI; strict and inherit are the question verbs' options. */
const ACTOR_KEYS = ['session', 'pc', 'user', 'by', 'now'];
const OPT_KEYS = ['strict', 'inherit', 'now'];
function pick(opts, keys) {
  const a = {};
  for (const k of keys) if (opts && opts[k] !== undefined && opts[k] !== null && opts[k] !== '') a[k] = opts[k];
  return a;
}

/* One database per URL per process, migrated on first open; the server modules
   load only when a local board is named, so a plain CLI run never opens SQLite. */
const boards = new Map();
function localBoard(url, scheme) {
  if (!boards.has(url)) {
    boards.set(url, (async () => {
      const [{ openDb }, { migrate }, { runVerb }] = await Promise.all([
        import('../server/db.mjs'), import('../server/migrate.mjs'), import('../server/verbs/index.mjs'),
      ]);
      const rest = url.slice(scheme.length + 1);
      if (scheme === 'file' && !rest) throw new BoardCallError('the board URL file: names no file');
      const path = scheme === 'memory' ? ':memory:' : rest.startsWith('//') ? fileURLToPath(url) : resolve(rest);
      const db = openDb(path);
      migrate(db);
      return { db, runVerb };
    })());
  }
  return boards.get(url);
}

/* ---- the http(s) transport ------------------------------------------------- */

const agents = { http: new HttpAgent({ keepAlive: true }), https: new HttpsAgent({ keepAlive: true }) };

function target(url, path) {
  const t = new URL(url.replace(/\/+$/, '') + path);
  const https = t.protocol === 'https:';
  return { t, send: https ? httpsRequest : httpRequest, agent: agents[https ? 'https' : 'http'] };
}

/* the board's own refusal (it answered with a status) in its words; '' for a network failure */
export const refusalOf = (e) => (e && Number(e.status) > 0 && e.message ? e.message : '');

const unreachable = (t, e) => new BoardCallError('the board at ' + t.origin + ' is unreachable (' + (e.code || e.message) + ')', { status: 0 });

/* A write that left this PC and got no reply may have run: never sent again. */
const mayHaveRun = (who, e) => Object.assign(new BoardCallError(who + ' dropped the call after it was sent ('
  + (e.code || e.message) + '): it may have run, so it was not sent again; check before trying again', { status: 0 }), { mayHaveRun: true });

/* well under the host's 30 s fetch limit, so a half-open connection frees its callers */
export const REQUEST_TIMEOUT_MS = 10000;

/* One request to a board server: JSON in, the reply's result out, a refusal as a
   BoardCallError carrying the board's own plain message and status. */
export function boardRequest(method, path, body, { url = boardUrl(), token = boardToken(), timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  if (!isHttp(url)) return Promise.reject(new BoardCallError('the board URL ' + (url || '(none)') + ' is not a board server'));
  const { t, send, agent } = target(url, path);
  const text = body === undefined ? '' : JSON.stringify(body);
  return new Promise((ok, fail) => {
    /* 'finish' is the whole request handed to the OS: before it, the board cannot have run anything */
    let sent = false;
    const broke = (e) => {
      clearTimeout(timer);
      fail(sent && method !== 'GET' ? mayHaveRun('the board at ' + t.origin, e) : unreachable(t, e));
    };
    const req = send(t, {
      method,
      agent,
      headers: {
        [PROTOCOL_HEADER]: String(PROTOCOL), accept: 'application/json',
        ...(token ? { authorization: 'Bearer ' + token } : {}),
        ...(text ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) } : {}),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        clearTimeout(timer);
        let reply;
        try { reply = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { reply = null; }
        if (res.statusCode >= 200 && res.statusCode < 300 && reply) return ok(reply.result ?? null);
        const msg = reply && reply.error ? reply.error : 'the board answered ' + res.statusCode;
        fail(new BoardCallError(msg, { status: res.statusCode, data: reply && reply.data }));
      });
      res.on('error', broke);
    });
    const timer = setTimeout(() => {
      broke({ code: 'no reply in ' + (timeoutMs >= 1000 ? Math.round(timeoutMs / 1000) + ' s' : timeoutMs + ' ms') });
      req.destroy();
    }, timeoutMs);
    req.on('finish', () => { sent = true; });
    req.on('error', broke);
    req.end(text || undefined);
  });
}

/* ---- the local route ---------------------------------------------- */

const trimUrl = (u) => String(u || '').replace(/\/+$/, '');

/* The PC's local server for this board, from the file it writes while it runs
   (<store>/board/local.json), or null: on a PC every caller goes through it. */
export function localRoute(url = boardUrl(), env = process.env) {
  let root;
  try { root = storeRoot(undefined, env); } catch { return null; }
  try {
    const l = JSON.parse(readFileSync(join(root, 'board', 'local.json'), 'utf8'));
    return l && typeof l.url === 'string' && trimUrl(l.board) === trimUrl(url) ? l : null;
  } catch { return null; }
}

/* The local server's own address, for the tray's alert route (`<base>api/alert`):
   the board URL now names the board's overview, not this PC. */
export function localServerUrl(env = process.env) {
  try {
    const dir = join(storeRoot(undefined, env), 'board');
    const secret = readFileSync(join(dir, 'secret'), 'utf8').trim();
    const port = Number(readFileSync(join(dir, 'port'), 'utf8').trim());
    return /^[0-9a-f]{32}$/.test(secret) && Number.isInteger(port) ? 'http://askerdo.localhost:' + port + '/' + secret + '/' : null;
  } catch { return null; }
}

/* `{ result, stale }`; an error marked `local` means nothing reached the local server */
function postLocal(local, name, body) {
  const t = new URL(local.url + '/verbs/' + encodeURIComponent(name));
  const text = JSON.stringify(body);
  return new Promise((ok, fail) => {
    let sent = false;
    /* only a call that never left falls through to the board; one that left may have run */
    const broke = (e) => fail(sent ? mayHaveRun('the local server', e)
      : Object.assign(new BoardCallError('the local server is not running (' + (e.code || e.message) + ')', { status: 0 }), { local: true }));
    const req = httpRequest(t, {
      method: 'POST', agent: agents.http,
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        let reply;
        try { reply = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { reply = null; }
        if (res.statusCode >= 200 && res.statusCode < 300 && reply) return ok({ result: reply.result ?? null, stale: reply.stale === true });
        fail(new BoardCallError(reply && reply.error ? reply.error : 'the local server answered ' + res.statusCode, { status: res.statusCode, data: reply && reply.data }));
      });
      res.on('error', broke);
    });
    req.on('finish', () => { sent = true; });
    req.on('error', broke);
    req.end(text);
  });
}

export const STALE_NOTE = 'the board is offline: this read came from this PC\'s cache';

/* `opts.env` is the caller's environment when the local server runs a command for it;
   `opts.onStale(note)` hears a read the local server served from its offline cache;
   `opts.onLocal(root)` hears the signed root of a local server that just answered. */
export async function boardCall(name, input, opts = {}) {
  const env = opts.env || process.env;
  const url = boardUrl(env);
  if (!url) throw new BoardCallError('board not configured: join this PC with a code from join-code on a PC on the board (/askerdo:configure, the join-a-pc card), or set ASKERDO_BOARD_URL');
  const scheme = schemeOf(url);
  if (isHttp(url)) {
    const body = { input, ...pick(opts, ['session', 'user', 'by']), opts: pick(opts, OPT_KEYS) };
    /* one hop per PC: the local server talks to the board; a stale file falls through */
    const local = opts.direct ? null : localRoute(url, env);
    if (local) {
      let r;
      try { r = await postLocal(local, name, body); } catch (e) { if (!e.local) throw e; }
      if (r) {
        if (r.stale && typeof opts.onStale === 'function') opts.onStale(STALE_NOTE);
        /* local.json names <root>local: the server answering is the proof it is up */
        if (typeof opts.onLocal === 'function') opts.onLocal(new URL('.', local.url).href);
        return r.result;
      }
    }
    return boardRequest('POST', API + '/verbs/' + encodeURIComponent(name), body, { url, token: boardToken(env) });
  }
  if (scheme !== 'memory' && scheme !== 'file') {
    throw new BoardCallError('the board URL ' + url + ' names a transport this build cannot reach; use http:, https:, memory: or file:');
  }
  let board;
  try { board = await localBoard(url, scheme); } catch (e) { boards.delete(url); throw e; }
  const out = board.runVerb(board.db, name, input, pick(opts, ACTOR_KEYS), pick(opts, OPT_KEYS));
  /* handed back as plain JSON, as a board server would hand it */
  return out === undefined ? undefined : JSON.parse(JSON.stringify(out));
}

/* A single-use login link for the web views: the tray or the CLI opens it, and
   the phone gets one the same way. */
export const boardLoginLink = (next = '/', o) => boardRequest('POST', API + '/login-link', { next }, o);

/* a single-use join code for a new PC, { code, expires, device? }; a
   `device` given is the only name the code takes. */
export const boardJoinCode = (device, o) => boardRequest('POST', API + '/join-code', device ? { device } : {}, o);

/* The address another PC joins at: a board this PC reaches on loopback (a Docker board here)
   is published beyond it, so another PC needs this PC's network name instead. */
export function reachableUrl(url, host = hostname()) {
  try {
    const u = new URL(url);
    const name = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (!(name === 'localhost' || name === '::1' || /^127\./.test(name)) || !host) return trimUrl(url);
    u.hostname = host;
    return trimUrl(u.href);
  } catch { return trimUrl(url); }
}

/* The line a new PC can run with a minted code, the CLI's join-code and the tray's Add a PC
   page both print it: a fresh PC has no launcher, only the marketplace clone the install made. */
export const joinLine = (url, { code, device } = {}) => 'node "$HOME/.claude/plugins/marketplaces/askerdo/bin/askerdo.mjs" join '
  + trimUrl(url) + ' ' + code + (device ? ' --device ' + device : '');

/* A new PC's way onto the board: the code stands in for a token, so none is sent.
   Returns { device, token }. */
export const boardJoin = (url, code, device) => boardRequest('POST', API + '/join', { code, device }, { url, token: '' });

/* A hostname as a device name: the board takes letters, digits, dot, dash or underscore. */
export const deviceName = (raw) => String(raw || '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[^A-Za-z0-9]+/, '').slice(0, 64) || 'pc';

/* The event stream. `after` is the saved cursor (omit it and a snapshot comes
   first); onEvent(name, data, id) gets activity, snapshot and ping, and the
   caller keeps the cursor (the local board saves it on disk). Returns { close }. */
/* the board's /health ({ ok, protocol, seq, version }), or null when it does not answer in time */
export function boardHealth(url = boardUrl(), timeoutMs = 3000) {
  if (!isHttp(url)) return Promise.resolve(null);
  const { t, send, agent } = target(url, '/health');
  return new Promise((done) => {
    const req = send(t, { agent, timeout: timeoutMs }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { try { done(res.statusCode === 200 ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null); } catch { done(null); } });
      res.on('error', () => done(null));
    });
    req.on('timeout', () => { req.destroy(); done(null); });
    req.on('error', () => done(null));
    req.end();
  });
}

export function boardEvents({ after, onEvent, onError, onOpen, onClose, url = boardUrl(), token = boardToken() } = {}) {
  if (!isHttp(url)) throw new BoardCallError('the board URL ' + (url || '(none)') + ' is not a board server');
  const { t, send } = target(url, API + '/events' + (after !== undefined && after !== null ? '?after=' + Number(after) : ''));
  const err = (e) => { if (onError) onError(e); };
  const req = send(t, {
    headers: { [PROTOCOL_HEADER]: String(PROTOCOL), accept: 'text/event-stream', ...(token ? { authorization: 'Bearer ' + token } : {}) },
  }, (res) => {
    res.setEncoding('utf8');
    let buf = '';
    if (res.statusCode !== 200) {
      res.on('data', (s) => { buf += s; });
      res.on('end', () => {
        let msg = 'the board answered ' + res.statusCode;
        try { msg = JSON.parse(buf).error || msg; } catch {}
        err(new BoardCallError(msg, { status: res.statusCode }));
      });
      return;
    }
    /* onOpen and onClose let a caller keep its own connection state */
    if (onOpen) onOpen();
    if (onClose) res.on('close', () => onClose());
    res.on('data', (s) => {
      buf += s;
      for (let i = buf.indexOf('\n\n'); i >= 0; i = buf.indexOf('\n\n')) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        let name = 'message';
        let id;
        let data = '';
        for (const line of block.split('\n')) {
          if (line.startsWith('event: ')) name = line.slice(7);
          else if (line.startsWith('id: ')) id = Number(line.slice(4));
          else if (line.startsWith('data: ')) data += line.slice(6);
        }
        if (!data || !onEvent) continue;
        try { onEvent(name, JSON.parse(data), id); } catch (e) { err(e); }
      }
    });
    res.on('error', err);
  });
  req.on('error', (e) => err(unreachable(t, e)));
  req.end();
  return { close: () => req.destroy() };
}

/* ---- board page URLs -------------------------------------------------------- */

/* `env` is the caller's when the local server runs a command for it */
export const webBase = (env = process.env) => { const u = boardUrl(env); return isHttp(u) ? u.replace(/\/+$/, '') : ''; };

/* A board page by kind, as boardUrl(root, kind, id) mints them: q, w and
   r are a record page by label, ws a workstream, needs-you the open set, root the
   overview. Null when the board is not a server (memory:, file:, none). */
export function pageUrl(kind, id, env) {
  const base = webBase(env);
  if (!base) return null;
  if (kind === 'root') return base + WEB.root();
  if (kind === 'q' || kind === 'w' || kind === 'r') return base + WEB.record(id);
  if (kind === 'ws') return base + WEB.workstream(id);
  if (kind === 'needs-you') return base + WEB.needsYou(id);
  throw new BoardCallError('unknown board page kind: ' + kind);
}

/* a record's page through a local server's signed root, whose /r/<key> mints a login link */
export const signedPage = (root, label) => String(root).replace(/\/+$/, '') + WEB.record(label);

/* The open set (one project's, by its shared name as register writes it, when a folder is given) and the overview. */
export const openSetUrl = ({ project } = {}, env) => pageUrl('needs-you', project ? sharedName(resolve(String(project))) : '', env);
export const localSetUrl = (env) => pageUrl('root', '', env);

/* ---- a board server for tests ------------------------------------------------ */

/* startBoard({ db }): an API server on 127.0.0.1 over `db` (a fresh in-memory
   board when none is given), its clock settable per request. Returns its URL, a
   device token, the database and close(). */
export async function startBoard({ db, device = 'test', port = 0, ...rest } = {}) {
  const [{ createApi, newToken }, { openDb }, { migrate }] = await Promise.all([
    import('../server/api.mjs'), import('../server/db.mjs'), import('../server/migrate.mjs'),
  ]);
  if (!db) { db = openDb(':memory:'); migrate(db); }
  const api = createApi({ db, clock: true, ...rest });
  const { port: p } = await api.listen(port, '127.0.0.1');
  const { token } = newToken(db, device);
  return { url: 'http://127.0.0.1:' + p, token, db, api, close: () => api.close() };
}
