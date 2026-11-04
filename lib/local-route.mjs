/* The local server's one route for the mod and the CLI, under
   <secret>/local/: the band in one call, a long poll answered the moment a change
   lands, reads from the cache, verbs passed through to the board. */
import { createWriteStream, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';

const BODY_MAX = 2 * 1024 * 1024;
const TIMINGS_MAX = 5 * 1024 * 1024;

/* The server's timings shape with this tier's name, so `cli.mjs timings --file` reads it. */
export function localTimings(file) {
  if (!file) return () => {};
  try {
    mkdirSync(dirname(file), { recursive: true });
    try { if (statSync(file).size > TIMINGS_MAX) renameSync(file, file + '.1'); } catch {}
  } catch { return () => {}; }
  const out = createWriteStream(file, { flags: 'a' });
  out.on('error', () => {});
  return (verb, ms, status) => out.write(JSON.stringify({ at: new Date().toISOString(), tier: 'local', verb, ms: Math.round(ms * 1000) / 1000, status }) + '\n');
}

function readBody(req) {
  return new Promise((ok, fail) => {
    const chunks = [];
    let n = 0;
    /* an oversized body is read to its end and dropped, so the caller gets the 413 and runs it itself */
    req.on('data', (c) => {
      n += c.length;
      if (n <= BODY_MAX) chunks.push(c);
    });
    req.on('end', () => {
      if (n > BODY_MAX) return fail(Object.assign(new Error('the request body is over ' + BODY_MAX + ' bytes'), { status: 413 }));
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text.trim()) return ok({});
      try { ok(JSON.parse(text)); } catch { fail(Object.assign(new Error('the request body is not JSON'), { status: 400 })); }
    });
    req.on('error', fail);
  });
}

function send(res, status, body, stale) {
  const text = JSON.stringify(body) + '\n';
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text), 'cache-control': 'no-store',
    ...(stale ? { 'x-askerdo-stale': '1' } : {}),
  });
  res.end(text);
}

/* A refusal keeps the board's own plain message and status; unreachable is 503. */
function statusOf(e) {
  const s = e && e.status;
  if (s === 0) return 503;
  if (Number.isInteger(s) && s >= 400) return s;
  return e instanceof TypeError ? 400 : 500;
}

/* POST local/cli, the CLI's one call, board or none (and local/mod, the mod's scripts,
   `kind` naming it in the timings): { argv, cwd, env, stdin, tty, version } in, { code, stdout, stderr } out with a 200 whatever the code, or
   { needStdin: true } to send it again with stdin. Any other status means nothing
   ran, so the launcher runs the command itself; `refuse(body)` names why not here. */
export async function handleCli(req, res, { run, refuse, timing = () => {}, kind = 'cli' }) {
  const t0 = performance.now();
  let label = kind;
  let status = 200;
  let ran = false;
  try {
    if (req.method !== 'POST') throw Object.assign(new Error('the CLI route takes POST'), { status: 405 });
    const body = await readBody(req);
    const { argv, cwd, env } = body;
    if (!Array.isArray(argv) || argv.some((a) => typeof a !== 'string')) throw Object.assign(new Error('argv must be a list of strings'), { status: 400 });
    if (typeof cwd !== 'string' || !isAbsolute(cwd)) throw Object.assign(new Error('cwd must be an absolute path'), { status: 400 });
    const why = await refuse(body);
    if (why) throw Object.assign(new Error(why), { status: 409 });
    /* the verb and a subcommand word, never an id or a flag's value */
    label = kind + ' ' + argv.slice(0, 2).filter((a, i) => i === 0 || /^[a-z][a-z-]*$/.test(a)).join(' ');
    ran = true;
    const out = await run({ argv, cwd, env, stdin: typeof body.stdin === 'string' ? body.stdin : undefined, tty: body.tty === true });
    send(res, 200, out);
  } catch (e) {
    /* only a failure after the command started is a 500: the launcher must not run it twice */
    status = ran ? 500 : (e && Number.isInteger(e.status) && e.status !== 500 ? e.status : 400);
    if (!res.headersSent) send(res, status, { ok: false, error: e && e.message ? e.message : String(e) });
  } finally {
    timing(label, performance.now() - t0, status);
  }
}

/* handleLocal(lb, req, res, rest, timing): `rest` is the path after local/. */
export async function handleLocal(lb, req, res, rest, timing = () => {}) {
  const t0 = performance.now();
  const url = new URL(req.url, 'http://local');
  const q = (k) => url.searchParams.get(k) || '';
  let label = req.method + ' ' + rest.split('/')[0];
  let status = 200;
  try {
    if (!lb) throw Object.assign(new Error('this PC has no board server configured (boardUrl)'), { status: 404 });
    let out;
    let stale = false;
    if (req.method === 'GET' && rest === 'wait') {
      /* the long poll: held until the cache moves past `after`, never timed */
      const w = await lb.wait(q('after'), Number(q('ms')) || undefined);
      return send(res, 200, { ok: true, result: w });
    }
    /* the flag is the cache's own status or a cached read's, never a field of a verb's result */
    if (req.method === 'GET' && (rest === 'state' || rest === 'band')) {
      out = rest === 'state' ? lb.status() : await lb.band({ session: q('session'), project: q('project'), lineage: q('lineage'), redraw: q('redraw') });
      stale = out.stale === true || out.offline === true;
    } else if (req.method === 'GET' && rest === 'tray') out = lb.tray();
    else if (req.method === 'GET' && rest === 'questions') out = [...lb.cache.questions.values()];
    else if (req.method === 'GET' && rest.startsWith('graph/')) {
      out = lb.graph(decodeURIComponent(rest.slice(6)));
      if (!out) throw Object.assign(new Error('no open workstream ' + rest.slice(6) + ' in the cache'), { status: 404 });
    } else if (req.method === 'GET' && rest.startsWith('record/')) {
      const id = decodeURIComponent(rest.slice(7));
      out = lb.record(id);
      if (!out) ({ result: out, stale } = await lb.read(/^Q\d/.test(id) ? 'show' : 'readRecord', id));
    } else if (req.method === 'GET' && rest === 'procedures/triggers') out = await lb.triggers(q('project'));
    else if (req.method === 'GET' && rest === 'procedures/find') out = await lb.findProcedures(q('words'), { project: q('project') });
    else if (req.method === 'POST' && rest === 'procedures/match') out = await lb.matchProcedures(await readBody(req));
    else if (req.method === 'POST' && rest.startsWith('verbs/')) {
      const name = decodeURIComponent(rest.slice(6));
      label = name;
      const body = await readBody(req);
      if (lb.isRead(name)) ({ result: out, stale } = await lb.read(name, body.input));
      else out = await lb.call(name, body);
    } else throw Object.assign(new Error('no local route ' + req.method + ' ' + rest), { status: 404 });
    send(res, 200, { ok: true, result: out === undefined ? null : out, ...(stale ? { stale: true } : {}) }, stale);
  } catch (e) {
    status = statusOf(e);
    if (!res.headersSent) send(res, status, { ok: false, error: e && e.message ? e.message : String(e), ...(e && e.data ? { data: e.data } : {}) });
  } finally {
    timing(label, performance.now() - t0, status);
  }
  return undefined;
}
