#!/usr/bin/env node
/* serves the work folder's review page and keeps the user's marks in choices.json.
   node serve.mjs <work dir> [port]   (127.0.0.1 only; default port 8767) */
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.resolve(process.argv[2] || '.');
const PORT = Number(process.argv[3]) || 8767;
const FILE = path.join(DIR, 'choices.json');
const MAX = 2 * 1024 * 1024;
/* written into the page as served: another site's page cannot read it, so its posts are refused */
const TOKEN = randomBytes(16).toString('hex');
const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

const send = (res, code, body, type = 'text/plain; charset=utf-8') => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
};

/* rename can hit EPERM on Windows while a reader holds the target open: retry briefly */
const renameRetry = (from, to, tries = 10) => {
  for (let i = 0; ; i++) {
    try { fs.renameSync(from, to); return; } catch (e) {
      if (i >= tries || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e;
      const until = Date.now() + 30; while (Date.now() < until) { /* short spin */ }
    }
  }
};

const saveChoices = (req, res) => {
  const chunks = []; let size = 0; let over = false;
  req.on('data', (c) => { if (over) return; size += c.length; if (size > MAX) { over = true; chunks.length = 0; return; } chunks.push(c); });
  req.on('end', () => {
    if (over) return send(res, 413, 'body over 2 MB\n');
    let data;
    try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return send(res, 400, 'not JSON\n'); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return send(res, 400, 'not a JSON object\n');
    const tmp = FILE + '.' + process.pid + '.' + Date.now() + '.tmp';
    try { fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n'); renameRetry(tmp, FILE); } catch (e) {
      try { fs.unlinkSync(tmp); } catch { /* already gone */ }
      console.error(new Date().toISOString(), 'save failed:', e.message);
      return send(res, 500, 'save failed\n');
    }
    const n = data.items && typeof data.items === 'object' ? Object.keys(data.items).length : 0;
    console.log(`${new Date().toISOString()} saved choices.json: ${n} rows marked${data.done ? ', done' : ''}`);
    send(res, 200, JSON.stringify({ ok: true, savedAt: data.savedAt || null }) + '\n', TYPES['.json']);
  });
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/choices') {
    if (req.method === 'GET') {
      let body = '{}\n';
      try { body = fs.readFileSync(FILE, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') return send(res, 500, 'read failed\n'); }
      return send(res, 200, body, TYPES['.json']);
    }
    if (req.method === 'POST') return url.searchParams.get('t') === TOKEN ? saveChoices(req, res) : send(res, 403, 'no page token: reload the review page\n');
    return send(res, 405, 'GET or POST\n');
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'GET only\n');
  /* only the page itself is served: the work folder also holds the plan and the manifest */
  if (url.pathname !== '/' && url.pathname !== '/review.html') return send(res, 404, 'not found\n');
  fs.readFile(path.join(DIR, 'review.html'), (err, buf) => {
    if (err) return send(res, 404, 'no review.html yet: run render.mjs\n');
    const page = buf.toString('utf8').replace('data-token=""', 'data-token="' + TOKEN + '"');
    res.writeHead(200, { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : page);
  });
});
server.on('error', (e) => { console.error('serve.mjs:', e.code === 'EADDRINUSE' ? `port ${PORT} is in use; pass another: node serve.mjs <work dir> <port>` : e.message); process.exit(1); });
server.listen(PORT, '127.0.0.1', () => console.log(`review page: http://127.0.0.1:${PORT}/  (marks in ${FILE})`));
