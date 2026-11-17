/* one of the board's read threads: its own read-only connection to the board's file,
   so a dear read or a page runs here while the board's own thread keeps answering. */
import { parentPort, workerData } from 'node:worker_threads';
import { openDb } from './db.mjs';
import { runVerb } from './verbs/index.mjs';
import { WEB } from './paths.mjs';
import { createWeb } from './web/index.mjs';

const db = openDb(workerData.file);
db.exec('PRAGMA query_only = ON');
/* the pool tells a thread that failed to start from one that stopped later */
parentPort.postMessage({ ready: true });
let web = null;

/* a page as the board's thread would serve it, caught whole: { status, headers, body } */
async function page({ href, device }) {
  if (!web) web = createWeb({ db });
  const out = { status: 200, headers: {}, body: '' };
  const res = {
    headersSent: false,
    writeHead(status, headers = {}) { out.status = status; out.headers = headers; this.headersSent = true; },
    end(body) { if (body !== undefined) out.body = String(body); },
  };
  const served = await web({ method: 'GET', headers: {} }, res, { db, device, url: new URL(href), WEB });
  return served ? out : null;
}

parentPort.on('message', async ({ id, name, input, actor, opts, href, device }) => {
  const t = performance.now();
  try {
    if (href) return parentPort.postMessage({ id, page: await page({ href, device }), ms: performance.now() - t });
    const out = runVerb(db, name, input, actor, opts);
    parentPort.postMessage({ id, text: JSON.stringify({ ok: true, result: out === undefined ? null : out }) + '\n', ms: performance.now() - t });
  } catch (e) {
    /* the board's thread runs it again, so a refusal keeps its own kind and status */
    parentPort.postMessage({ id, error: (e && e.message) || String(e) });
  }
  return undefined;
});
