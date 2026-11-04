/* The board server's HTTP API and event stream.
   Verbs are POST /api/v1/verbs/<name>; reads are GET routes; every
   commit's activity rows go out at once on GET /api/v1/events. */
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream, mkdirSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, relative, sep } from 'node:path';
import { backup, check, exportTo } from './maint.mjs';
import { lastCheck, timingSummary } from './timings.mjs';
import { ADMIN_HEADER, ADMIN_SECRET_FILE, API, COOKIE, PROTOCOL, PROTOCOL_HEADER, WEB, protocolMessage } from './paths.mjs';
import { tx } from './db.mjs';
import { clockOf, labelOf, logVerb, stampNow } from './records.mjs';
import { loadRecord } from './verbs/graph.mjs';
import { VERBS, runVerb } from './verbs/index.mjs';
import { resolveRecord } from './verbs/labels.mjs';
import { lastSeq } from './verbs/snapshot.mjs';
import { stateOf } from './verbs/tracks.mjs';
import { boardVersion } from './version.mjs';
import { createWeb } from './web/index.mjs';

const BODY_MAX = 2 * 1024 * 1024;
const KEEPALIVE_MS = 20000;
/* Past this many rows behind, a reconnecting PC gets the working set instead of
   a replay: about two days of work, 0.34 MB and 42 ms on a real board. */
export const GAP_MAX = 500;
/* WAL pages are folded back after the reply, every this many writes, so no
   write pays for a checkpoint (measured on the register path). */
export const CHECKPOINT_EVERY = 64;
const LINK_MS = 5 * 60000;
const JOIN_MS = 10 * 60000;
/* the board is on the LAN: the cap stops a script guessing, not a person mistyping twice */
const JOIN_TRIES = 5;
const JOIN_LOCK_MS = 60000;
const WEB_SESSION_MS = 90 * 86400000;
const CHANGES_MAX = 2048;
const TIMINGS_MAX = 5 * 1024 * 1024;

export class HttpError extends Error {
  constructor(status, message, data) {
    super(message);
    this.status = status;
    if (data) this.data = data;
  }
}

/* ---- tokens, login links and web sessions ---------------------------------- */

export const hashSecret = (s) => createHash('sha256').update(String(s)).digest('hex');
const secret = () => randomBytes(32).toString('base64url');
const iso = (ms) => new Date(ms).toISOString();

function needDevice(device) {
  const d = String(device ?? '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(d)) throw new HttpError(400, 'a device name is letters, digits, dot, dash or underscore: ' + JSON.stringify(d));
  return d;
}

/* A revoked or replaced token takes the device's browsers, unused login links and
   live join code with it: what the token granted dies with it. */
function dropGrants(db, device) {
  db.stmt('DELETE FROM web_sessions WHERE device = ?').run(device);
  db.stmt('DELETE FROM login_links WHERE device = ?').run(device);
  db.stmt('DELETE FROM join_codes WHERE minted_by = ?').run(device);
}

/* One live token per device: a new one revokes the old. The secret is shown once. */
export function newToken(db, device) {
  const d = needDevice(device);
  const token = secret();
  const at = stampNow();
  /* tx joins a join's transaction, so the code and the token commit together */
  tx(db, () => {
    db.stmt('UPDATE tokens SET revoked = ? WHERE device = ? AND revoked IS NULL').run(at, d);
    dropGrants(db, d);
    db.stmt('INSERT INTO tokens (device, hash, created) VALUES (?, ?, ?)').run(d, hashSecret(token), at);
    /* a device on the board ends the setup code, however it got its token */
    db.stmt('DELETE FROM join_codes WHERE minted_by = ?').run(SETUP_MINTER);
  });
  return { device: d, token };
}

export const listTokens = (db) => db.stmt('SELECT device, created, revoked FROM tokens ORDER BY id').all()
  .map((r) => ({ device: r.device, created: r.created, ...(r.revoked ? { revoked: r.revoked } : {}) }));

export function revokeToken(db, device) {
  const d = needDevice(device);
  db.exec('BEGIN IMMEDIATE');
  try {
    const n = Number(db.stmt('UPDATE tokens SET revoked = ? WHERE device = ? AND revoked IS NULL').run(stampNow(), d).changes);
    dropGrants(db, d);
    db.exec('COMMIT');
    return { device: d, revoked: n };
  } catch (e) { if (db.isTransaction) db.exec('ROLLBACK'); throw e; }
}

const tokenDevice = (db, token) => (db.stmt('SELECT device FROM tokens WHERE hash = ? AND revoked IS NULL').get(hashSecret(token)) || {}).device;

/* A path on the board only: browsers read a backslash as a slash and drop tabs and
   newlines, so either could turn the path into another host. */
export const boardPath = (next) => (typeof next === 'string' && /^\/(?![/\\])[\x21-\x7e]*$/.test(next) && !next.includes('\\') ? next : '/');

function newLoginLink(db, device, next, nowMs = Date.now()) {
  const n = boardPath(next);
  const nonce = secret();
  db.stmt('DELETE FROM login_links WHERE expires < ?').run(iso(nowMs));
  db.stmt('INSERT INTO login_links (hash, device, next, expires) VALUES (?, ?, ?, ?)').run(hashSecret(nonce), device, n, iso(nowMs + LINK_MS));
  return { path: '/login/' + nonce, expires: iso(nowMs + LINK_MS) };
}

/* Single use: the row is gone the moment it is read. */
function useLoginLink(db, nonce, nowMs = Date.now()) {
  const r = db.stmt('DELETE FROM login_links WHERE hash = ? RETURNING device, next, expires').get(hashSecret(nonce));
  if (!r || r.expires < iso(nowMs)) return null;
  const cookie = secret();
  db.stmt('DELETE FROM web_sessions WHERE expires < ?').run(iso(nowMs));
  db.stmt('INSERT INTO web_sessions (hash, device, created, expires) VALUES (?, ?, ?, ?)').run(hashSecret(cookie), r.device, iso(nowMs), iso(nowMs + WEB_SESSION_MS));
  return { cookie, next: r.next, device: r.device };
}

/* ---- join codes ---------------------------------------------------- */

/* No 0/O or 1/l/I: a code is read off one screen and typed on another. */
const JOIN_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const JOIN_LEN = 12;

/* 12 of 31 characters is about 59 bits; a byte past 247 is drawn again, so each is even. */
function joinCode() {
  let s = '';
  while (s.length < JOIN_LEN) {
    for (const b of randomBytes(16)) if (b < 248 && s.length < JOIN_LEN) s += JOIN_ALPHABET[b % 31];
  }
  return s.match(/.{4}/g).join('-');
}

/* Case, spaces and dashes are the typist's: the hash is of the characters alone. */
const joinHash = (code) => hashSecret(String(code ?? '').toUpperCase().replace(/[^0-9A-Z]/g, ''));

export function newJoinCode(db, minter, device, nowMs = Date.now()) {
  const named = device === undefined || device === null || device === '' ? null : needDevice(device);
  const code = joinCode();
  const expires = iso(nowMs + JOIN_MS);
  tx(db, () => {
    db.stmt('DELETE FROM join_codes WHERE minted_by = ? OR expires < ?').run(minter, iso(nowMs));
    db.stmt('INSERT INTO join_codes (hash, minted_by, device, created, expires) VALUES (?, ?, ?, ?, ?)')
      .run(joinHash(code), minter, named, iso(nowMs), expires);
  });
  return { code, expires, ...(named ? { device: named } : {}) };
}

/* the board's own code for its first PC, printed only to its console. The colon
   keeps the name out of every device's reach; it lives until a device holds a token. */
export const SETUP_MINTER = 'board:setup';
const SETUP_EXPIRES = '9999-12-31T23:59:59.999Z';
const hasDevice = (db) => Boolean(db.stmt('SELECT 1 FROM tokens WHERE revoked IS NULL LIMIT 1').get());

/* A fresh setup code, replacing the last, or null once any device is on the board. */
export function newSetupCode(db, nowMs = Date.now()) {
  return tx(db, () => {
    if (hasDevice(db)) {
      db.stmt('DELETE FROM join_codes WHERE minted_by = ?').run(SETUP_MINTER);
      return null;
    }
    const code = joinCode();
    db.stmt('DELETE FROM join_codes WHERE minted_by = ? OR expires < ?').run(SETUP_MINTER, iso(nowMs));
    db.stmt('INSERT INTO join_codes (hash, minted_by, device, created, expires) VALUES (?, ?, NULL, ?, ?)')
      .run(joinHash(code), SETUP_MINTER, iso(nowMs), SETUP_EXPIRES);
    return { code };
  });
}

/* What the console shows a person setting the board up; the code goes nowhere else. */
export const setupCodeText = (code, port) => 'setup code: ' + code + '\n'
  + 'no PC is on this board yet. On the first PC, run /askerdo:configure and give it this code and the board address,'
  + ' http://<this host>:' + port + ' (or run join http://<this host>:' + port + ' ' + code + ' --seed in the AskerDo CLI there).'
  + ' The code works until a PC joins; a restart replaces it.\n';

const SETUP_REFUSED = 'this setup code is unknown or was replaced: the board prints its current one in its log at each start'
  + ' (docker logs askerdo on a Docker board), and setup-code on the board prints a fresh one';

const JOIN_REFUSED = "this join code is unknown, used or expired: mint a new one on a PC already on the board (join-code, or its tray's Add a PC)";

/* The code is used, the device's token minted and the join logged in one transaction;
   a failed try counts against every live code. Only a code minted for a device's name
   replaces that device's live token (a rejoin): an unnamed one never cuts a PC off. */
export function joinBoard(db, { code, device } = {}, nowMs = Date.now()) {
  const d = needDevice(device);
  const now = iso(nowMs);
  if (db.stmt('SELECT 1 FROM join_codes WHERE used IS NULL AND expires > ? AND tries >= ? AND tried > ?').get(now, JOIN_TRIES, iso(nowMs - JOIN_LOCK_MS))) {
    throw new HttpError(429, 'too many wrong join codes: wait a minute, or mint a fresh code (join-code), which starts the count again');
  }
  const hash = joinHash(code);
  const out = tx(db, () => {
    const r = db.stmt('SELECT minted_by, device FROM join_codes WHERE hash = ? AND used IS NULL AND expires > ?').get(hash, now);
    if (!r || (r.minted_by === SETUP_MINTER && hasDevice(db))) return null;
    if (r.device && r.device !== d) return { named: r.device };
    if (!r.device && db.stmt('SELECT 1 FROM tokens WHERE device = ? AND revoked IS NULL').get(d)) return { taken: d };
    db.stmt('UPDATE join_codes SET used = ? WHERE hash = ?').run(now, hash);
    const t = newToken(db, d);
    logVerb(db, { ts: stampNow(new Date(nowMs)), verb: 'join', kind: 'device', id: d, name: d, by: 'board:join', pc: d,
      changes: { device: [null, d], mintedBy: [null, r.minted_by] }, note: r.minted_by === SETUP_MINTER ? "joined with the board's setup code" : 'joined with a code from ' + r.minted_by });
    return t;
  });
  if (!out) {
    db.stmt('UPDATE join_codes SET tries = tries + 1, tried = ? WHERE used IS NULL AND expires > ?').run(now, now);
    throw new HttpError(403, hasDevice(db) ? JOIN_REFUSED : SETUP_REFUSED);
  }
  if (out.named) throw new HttpError(403, 'this join code is for the device ' + out.named + ': join with --device ' + out.named);
  if (out.taken) {
    throw new HttpError(403, 'the device ' + out.taken + ' is already on the board: join under another name with --device <name>,'
      + ' or, to replace that device (a rejoin), mint the code with join-code --device ' + out.taken);
  }
  return out;
}

function cookieOf(req) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === COOKIE) return part.slice(i + 1).trim();
  }
  return '';
}

/* A cookie counts only while its device still holds a live token. */
const webDevice = (db, c) => (c ? (db.stmt(`SELECT s.device FROM web_sessions s WHERE s.hash = ? AND s.expires > ?
  AND EXISTS (SELECT 1 FROM tokens t WHERE t.device = s.device AND t.revoked IS NULL)`).get(hashSecret(c), iso(Date.now())) || {}).device : undefined);

/* ---- the event stream's rows ---------------------------------------------- */

/* What the band shows of a record, by kind; never its body. */
const HEAD_FIELDS = {
  question: ['blocking', 'session', 'project', 'projectRepo', 'workstream', 'topic', 'asked'],
  task: ['workstream', 'inHand', 'agent', 'priority'],
  track: ['workstream', 'parkReason', 'origin'],
};

export function recordHead(db, key, line = {}) {
  const r = key ? db.stmt('SELECT key, kind, label, status, title, fields, version, updated FROM records WHERE key = ?').get(key) : null;
  if (!r) {
    const h = key ? db.stmt('SELECT key, label, status, focus, track FROM handoffs WHERE key = ?').get(key) : null;
    if (h) return { key: h.key, label: h.label, kind: 'handoff', status: h.status, title: h.focus, ...(h.track ? { track: labelOf(db, h.track) } : {}) };
    return { key: key || null, label: line.id || null, kind: line.kind || null, gone: true };
  }
  const f = JSON.parse(r.fields);
  const head = { key: r.key, label: r.label, kind: r.kind, status: r.status, title: r.title, version: r.version, updated: r.updated };
  for (const k of HEAD_FIELDS[r.kind] || []) {
    if (f[k] === undefined || f[k] === null || f[k] === '') continue;
    head[k] = k === 'workstream' ? labelOf(db, f[k]) : f[k];
  }
  if (r.kind === 'task') {
    const t = db.stmt('SELECT r.label FROM track_items ti JOIN records r ON r.key = ti.track WHERE ti.task = ?').get(r.key);
    if (t) head.track = t.label;
  }
  if (r.kind === 'track') head.state = stateOf(db, loadRecord(db, r.key));
  return head;
}

function eventOf(db, row) {
  const l = JSON.parse(row.line);
  const ev = { seq: row.seq, at: l.ts, verb: l.verb, kind: l.kind, id: l.id, by: l.by, ...(row.pc ? { pc: row.pc } : {}) };
  const ch = JSON.stringify(l.changes || {});
  ev.changes = ch.length <= CHANGES_MAX ? l.changes || {} : Object.keys(l.changes || {});
  if (l.note) ev.note = l.note;
  if (l.for) ev.for = l.for;
  ev.head = recordHead(db, l.key, l);
  return ev;
}

const frame = (event, data, id) => (id !== undefined ? 'id: ' + id + '\n' : '') + 'event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n';

/* ---- timings ---------------------------------------------------------------- */

function timingsLog(file) {
  if (!file) return () => {};
  mkdirSync(dirname(file), { recursive: true });
  try { if (statSync(file).size > TIMINGS_MAX) renameSync(file, file + '.1'); } catch {}
  const out = createWriteStream(file, { flags: 'a' });
  out.on('error', () => {});
  return (verb, ms, status) => out.write(JSON.stringify({ at: new Date().toISOString(), tier: 'server', verb, ms: Math.round(ms * 1000) / 1000, status }) + '\n');
}

/* ---- the archive ----------------------------------------------------------- */

const TYPES = { '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.json': 'application/json; charset=utf-8', '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.pdf': 'application/pdf' };

/* A path inside the archive or nothing: no dot segments, no escape by a link. */
export function archivePath(root, rel) {
  if (!root) return null;
  const parts = String(rel || '').split('/').filter(Boolean).map((p) => { try { return decodeURIComponent(p); } catch { return '\0'; } });
  if (parts.some((p) => p === '.' || p === '..' || /[\0\\:]/.test(p))) return null;
  let base;
  try { base = realpathSync(root); } catch { return null; }
  let full;
  try { full = realpathSync(join(base, ...parts)); } catch { return null; }
  const r = relative(base, full);
  return r === '' || (!r.startsWith('..') && !r.startsWith(sep) && !/^[a-zA-Z]:/.test(r)) ? full : null;
}

/* ---- the server ----------------------------------------------------------- */

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function readBody(req) {
  return new Promise((ok, fail) => {
    const chunks = [];
    let n = 0;
    req.on('data', (c) => {
      n += c.length;
      if (n > BODY_MAX) { fail(new HttpError(413, 'the request body is over ' + BODY_MAX + ' bytes')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text.trim()) return ok({});
      let v;
      try { v = JSON.parse(text); } catch { return fail(new HttpError(400, 'the request body is not JSON')); }
      /* every route reads fields: null, an array or a scalar is an empty body, never a 500 */
      ok(v && typeof v === 'object' && !Array.isArray(v) ? v : {});
    });
    req.on('error', fail);
  });
}

/* A form's fields, under the same cap as a JSON body; a repeated name keeps its first value. */
function readForm(req) {
  return new Promise((ok, fail) => {
    const chunks = [];
    let n = 0;
    req.on('data', (c) => {
      n += c.length;
      if (n > BODY_MAX) { fail(new HttpError(413, 'the request body is over ' + BODY_MAX + ' bytes')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const out = {};
      for (const [k, v] of new URLSearchParams(Buffer.concat(chunks).toString('utf8'))) if (!Object.hasOwn(out, k)) out[k] = v;
      ok(out);
    });
    req.on('error', fail);
  });
}

/* Plain messages by kind of failure; a stack never leaves the server. */
function statusOf(e) {
  if (e instanceof HttpError) return e.status;
  const name = e && e.constructor ? e.constructor.name : '';
  if (name === 'ConflictError') return 409;
  if (name === 'TrackRefusal') return e.data && e.data.version !== undefined ? 409 : 400;
  if (name === 'UsageError' || name === 'ImportError') return 400;
  if (name === 'SchemaError') return 503;
  return 500;
}

function send(res, status, body, headers = {}) {
  const text = JSON.stringify(body) + '\n';
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text), ...headers });
  res.end(text);
}

/* createApi({ db, dataDir, archiveDir, timingsFile, backupsDir, clock, web }):
   `backupsDir` is a folder or a function read at each backup;
   `clock` lets a request set the verbs' clock (test boards only); `web(req, res,
   ctx)` serves the pages and returns true when it answered: the board's own web
   views (server/web) unless a caller passes another, or null for none. */
export function createApi({ db, dataDir = null, archiveDir, timingsFile, backupsDir, clock = false, web, adminSecret = secret() } = {}) {
  if (!db) throw new TypeError('createApi needs the database');
  if (web === undefined) web = createWeb({ db });
  const archive = archiveDir !== undefined ? archiveDir : dataDir ? join(dataDir, 'archive') : null;
  const timingsPath = timingsFile !== undefined ? timingsFile : dataDir ? join(dataDir, 'timings.log') : null;
  const checksPath = dataDir ? join(dataDir, 'checks.log') : null;
  const timing = timingsLog(timingsPath);
  const backupsAt = typeof backupsDir === 'function' ? backupsDir : () => backupsDir || (dataDir ? join(dataDir, 'backups') : null);
  const adminHash = hashSecret(adminSecret);
  db.exec('PRAGMA wal_autocheckpoint = 0');
  const clients = new Set();
  /* read once: the files under a running board are replaced only with a restart */
  const version = boardVersion();
  let sent = lastSeq(db);
  let writes = 0;

  const checkpoint = () => { try { db.exec('PRAGMA wal_checkpoint(PASSIVE)'); } catch {} };

  /* New activity rows since the last push, to every stream, each once. */
  function pump() {
    const rows = db.stmt('SELECT seq, line, pc FROM activity WHERE seq > ? ORDER BY seq').all(sent);
    if (!rows.length) return 0;
    sent = rows[rows.length - 1].seq;
    if (web && web.changed) web.changed(sent);
    if (clients.size) {
      const frames = rows.map((r) => ({ seq: r.seq, text: frame('activity', eventOf(db, r), r.seq) }));
      for (const c of clients) {
        for (const f of frames) if (f.seq > c.cursor) { c.res.write(f.text); c.cursor = f.seq; }
      }
    }
    return rows.length;
  }

  function afterWrite(res, n) {
    if (!n) return;
    writes += n;
    if (writes < CHECKPOINT_EVERY) return;
    writes = 0;
    res.once('finish', () => setImmediate(checkpoint));
  }

  function authOf(req, { cookieOk }) {
    const m = /^Bearer\s+(\S+)$/i.exec(String(req.headers.authorization || ''));
    if (m) {
      const device = tokenDevice(db, m[1]);
      if (!device) throw new HttpError(401, 'the board does not know this token (revoked or never issued): rejoin this PC with a code from join-code on a PC on the board (the join-a-pc card); token new on the board box is the fallback');
      return device;
    }
    if (cookieOk) {
      const device = webDevice(db, cookieOf(req));
      if (device) return device;
    }
    throw new HttpError(401, 'sign in: send Authorization: Bearer <device token>' + (cookieOk ? ', or open a login link' : ''));
  }

  function protocolOf(req, url) {
    const v = req.headers[PROTOCOL_HEADER] ?? url.searchParams.get('protocol');
    if (v === undefined || v === null || Number(v) !== PROTOCOL) throw new HttpError(426, protocolMessage(v === undefined || v === null ? NaN : v, PROTOCOL), { protocol: PROTOCOL });
  }

  /* a test board's request may set the clock, as it does the verbs' */
  const nowOf = (body) => (clock && body.opts && typeof body.opts === 'object' && body.opts.now !== undefined
    ? clockOf({ now: body.opts.now }).getTime() : Date.now());

  /* The actor is the token's device plus the session the body names. */
  function call(name, body, device) {
    const actor = { pc: device };
    for (const k of ['session', 'by']) if (typeof body[k] === 'string' && body[k].trim()) actor[k] = body[k].trim();
    /* the user's press */
    if (typeof body.user === 'string' && body.user.trim()) actor.user = body.user.trim();
    else if (body.user === true) actor.user = true;
    const o = body.opts && typeof body.opts === 'object' ? body.opts : {};
    const opts = {};
    for (const k of ['strict', 'inherit']) if (typeof o[k] === 'boolean') opts[k] = o[k];
    if (clock && o.now !== undefined) { opts.now = o.now; actor.now = o.now; }
    return runVerb(db, name, body.input, actor, opts);
  }

  function timed(label, res, fn) {
    const t = performance.now();
    let status = 200;
    try {
      const out = fn();
      send(res, 200, { ok: true, result: out === undefined ? null : out });
    } catch (e) {
      status = statusOf(e);
      send(res, status, { ok: false, error: e && e.message ? e.message : String(e), ...(e && e.data ? { data: e.data } : {}) });
    }
    timing(label, performance.now() - t, status);
    afterWrite(res, pump());
  }

  function record(label) {
    const e = resolveRecord(db, label);
    if (!e) throw new HttpError(404, 'no record ' + label);
    if (e.kind === 'question') return runVerb(db, 'show', e.key, {});
    if (e.kind === 'track') return runVerb(db, 'trackView', { track: e.key }, {});
    if (e.kind === 'handoff' || e.kind === 'profile') return { kind: e.kind, key: e.key, front: e.front };
    return runVerb(db, 'readRecord', e.key, {});
  }

  /* Rows after a cursor, a page at a time: a PC handed the working set still
     reads the answers it missed by sequence, so its inbox lines stay exact. */
  function activityAfter(url) {
    const after = Number(url.searchParams.get('after') || 0);
    const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get('limit')) || 1000));
    if (!Number.isInteger(after) || after < 0) throw new HttpError(400, 'after is an activity sequence number');
    return db.stmt('SELECT seq, line, pc FROM activity WHERE seq > ? ORDER BY seq LIMIT ?').all(after, limit).map((r) => eventOf(db, r));
  }

  function events(req, res, url, device) {
    const raw = req.headers['last-event-id'] ?? url.searchParams.get('after');
    const after = raw === undefined || raw === null || raw === '' ? NaN : Number(raw);
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    res.write('retry: 2000\n\n');
    /* no id, so it moves no cursor: each connection says the board's version first */
    res.write(frame('board', { version }));
    const top = lastSeq(db);
    const client = { res, cursor: top, device };
    if (!Number.isInteger(after) || after < 0 || after > top || top - after > GAP_MAX) {
      const ws = runVerb(db, 'workingSet', {}, {});
      client.cursor = ws.seq;
      res.write(frame('snapshot', ws, ws.seq));
    } else {
      for (const r of db.stmt('SELECT seq, line, pc FROM activity WHERE seq > ? AND seq <= ? ORDER BY seq').all(after, top)) {
        res.write(frame('activity', eventOf(db, r), r.seq));
      }
    }
    clients.add(client);
    req.on('close', () => clients.delete(client));
    res.on('error', () => clients.delete(client));
    pump();
  }

  function serveArchive(res, rel) {
    const full = archivePath(archive, rel);
    if (!full) throw new HttpError(404, 'no such archive entry');
    const st = statSync(full);
    if (st.isDirectory()) {
      const names = readdirSync(full, { withFileTypes: true }).filter((d) => d.isFile() || d.isDirectory())
        .map((d) => d.name + (d.isDirectory() ? '/' : '')).sort();
      return send(res, 200, { ok: true, result: names });
    }
    res.writeHead(200, { 'content-type': TYPES[extname(full).toLowerCase()] || 'application/octet-stream', 'content-length': st.size });
    createReadStream(full).pipe(res);
  }

  /* A device whose token went also loses the streams it holds open. */
  function dropStreams(out) {
    for (const c of clients) if (c.device === out.device) { clients.delete(c); c.res.end(); }
    return out;
  }

  function admin(req, res, path, body) {
    if (!LOOPBACK.has(req.socket.remoteAddress)) throw new HttpError(404, 'not found');
    const given = req.headers[ADMIN_HEADER];
    if (!given || hashSecret(given) !== adminHash) throw new HttpError(403, "the admin route takes the secret in the board's " + ADMIN_SECRET_FILE + ' file, beside its database');
    const out = (() => {
      switch (path) {
        case 'token/new': return dropStreams(newToken(db, body.device));
        case 'token/list': return listTokens(db);
        case 'token/revoke': return dropStreams(revokeToken(db, body.device));
        case 'setup-code': return { setup: newSetupCode(db) };
        case 'backup': {
          /* the caller names its own day; the folder is the board's configured one alone */
          const dir = backupsAt();
          if (!dir) throw new HttpError(400, 'this board has no backups folder');
          const at = body.at ? new Date(body.at) : null;
          return backup(db, dir, Number(body.keep) || undefined, at && !Number.isNaN(at.getTime()) ? at : undefined);
        }
        case 'export':
          if (!body.dir && !dataDir) throw new HttpError(400, 'export needs a folder');
          return exportTo(db, body.dir || join(dataDir, 'export'));
        case 'check': return check(db, { log: checksPath });
        default: throw new HttpError(404, 'no admin command ' + path);
      }
    })();
    send(res, 200, { ok: true, result: out });
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://board');
    const path = url.pathname;
    try {
      if (path === '/health' && req.method === 'GET') {
        return send(res, 200, { ok: true, protocol: PROTOCOL, seq: lastSeq(db), version });
      }
      if (path.startsWith('/admin/')) {
        const body = req.method === 'POST' ? await readBody(req) : {};
        return admin(req, res, path.slice(7), body);
      }
      if (path.startsWith('/login/') && req.method === 'GET') {
        const r = useLoginLink(db, path.slice(7));
        if (!r) throw new HttpError(410, 'this login link was used or has expired: ask the tray or the CLI for a new one');
        res.writeHead(302, {
          location: r.next,
          'set-cookie': COOKIE + '=' + r.cookie + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + Math.floor(WEB_SESSION_MS / 1000),
        });
        return res.end();
      }
      if (path.startsWith('/archive')) {
        authOf(req, { cookieOk: true });
        return serveArchive(res, path.slice(8));
      }
      if (path.startsWith(API + '/')) {
        protocolOf(req, url);
        const rest = path.slice(API.length + 1);
        /* the one route a device with no token calls: the join code stands in for one */
        if (rest === 'join' && req.method === 'POST') {
          const body = await readBody(req);
          const { device, token } = dropStreams(joinBoard(db, body, nowOf(body)));
          send(res, 200, { ok: true, result: { device, token } });
          return afterWrite(res, pump());
        }
        if (req.method === 'POST') {
          const device = authOf(req, { cookieOk: false });
          const body = await readBody(req);
          if (rest.startsWith('verbs/')) {
            const name = decodeURIComponent(rest.slice(6));
            if (!Object.hasOwn(VERBS, name)) throw new HttpError(404, 'the board has no verb named ' + JSON.stringify(name));
            return timed(name, res, () => call(name, body, device));
          }
          if (rest === 'login-link') {
            const l = newLoginLink(db, device, body.next);
            return send(res, 200, { ok: true, result: { url: 'http://' + (req.headers.host || 'board') + l.path, expires: l.expires } });
          }
          if (rest === 'join-code') return send(res, 200, { ok: true, result: newJoinCode(db, device, body.device, nowOf(body)) });
        }
        if (req.method === 'GET') {
          const device = authOf(req, { cookieOk: true });
          if (rest === 'events') return events(req, res, url, device);
          if (rest === 'snapshot') return timed('GET snapshot', res, () => runVerb(db, 'boardSnapshot', {}, {}));
          if (rest === 'working-set') return timed('GET working-set', res, () => runVerb(db, 'workingSet', {}, {}));
          if (rest === 'activity') return timed('GET activity', res, () => activityAfter(url));
          /* one command on a PC prints every tier's summary */
          if (rest === 'timings') return send(res, 200, { ok: true, result: { rows: timingSummary(timingsPath), lastCheck: lastCheck(checksPath) } });
          if (rest.startsWith('records/')) return timed('GET record', res, () => record(decodeURIComponent(rest.slice(8))));
          if (rest.startsWith('workstreams/')) {
            const ws = decodeURIComponent(rest.slice(12));
            return timed('GET workstream', res, () => runVerb(db, 'workstreamView', { workstream: ws, all: url.searchParams.get('all') === '1' }, {}));
          }
        }
        throw new HttpError(404, 'no route ' + req.method + ' ' + path);
      }
      if (web) {
        let device;
        try { device = authOf(req, { cookieOk: true }); } catch { device = null; }
        /* a write from a page counts the web session alone, never a bearer token */
        const ctx = { db, device, url, WEB, session: () => webDevice(db, cookieOf(req)), readForm: () => readForm(req), tokens: () => listTokens(db), wrote: () => afterWrite(res, pump()) };
        if (await web(req, res, ctx)) return undefined;
      }
      throw new HttpError(404, 'not found');
    } catch (e) {
      if (res.headersSent) { res.destroy(); return undefined; }
      return send(res, statusOf(e), { ok: false, error: e && e.message ? e.message : String(e), ...(e && e.data ? { data: e.data } : {}) });
    }
  }

  const server = createServer((req, res) => { handle(req, res); });
  server.keepAliveTimeout = 65000;
  const beat = setInterval(() => {
    pump();
    const ping = frame('ping', { seq: sent });
    for (const c of clients) c.res.write(ping);
  }, KEEPALIVE_MS);
  beat.unref();

  return {
    server,
    pump,
    clients,
    adminSecret,
    listen(port = 0, host = '127.0.0.1') {
      return new Promise((ok, fail) => {
        server.once('error', fail);
        server.listen(port, host, () => {
          server.off('error', fail);
          if (dataDir) {
            /* replaced at each start; 0600 where the file system keeps modes */
            const file = join(dataDir, ADMIN_SECRET_FILE);
            mkdirSync(dataDir, { recursive: true });
            rmSync(file, { force: true });
            writeFileSync(file, adminSecret, { mode: 0o600 });
          }
          ok({ port: server.address().port, host });
        });
      });
    },
    close() {
      clearInterval(beat);
      if (web && web.close) web.close();
      for (const c of clients) c.res.end();
      clients.clear();
      checkpoint();
      return new Promise((ok) => { server.close(() => ok()); server.closeAllConnections(); });
    },
  };
}

