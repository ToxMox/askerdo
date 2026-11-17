/* the board's dear reads off its one thread. A call waits on the board only for its own
   work: a picture, the Overview, a workstream view or a board page runs on a read thread, while
   writes and light reads go on answering on the board's thread. */
import { Worker } from 'node:worker_threads';

/* the reads that cost the board's thread tens to hundreds of ms on a live board (askerdo timings) */
export const OFF_THREAD = new Set(['pictureOverview', 'pictureView', 'workstreamView', 'workingSet', 'bandCalls', 'shelf', 'trackView', 'coverage', 'listWork']);
/* the activity log is light by sequence and dear by project or search, as the pane's feed reads it */
export const dearRead = (name, input) => OFF_THREAD.has(name)
  || (name === 'activity' && !!input && typeof input === 'object' && ['places', 'project', 'projectRepo', 'search', 'workstream'].some((k) => input[k]));
/* computed once per board change for every PC that asks: their answer hangs on the board and the day alone */
export const ONCE_PER_CHANGE = new Set(['pictureOverview', 'pictureView', 'workstreamView']);
/* the band's reads, a few ms each, have a thread of their own and go first on any idle
   one, so a band never waits behind the Overview, a workstream view, the shelf or a page */
export const BAND_READS = new Set(['bandCalls', 'pictureView']);
const SIZE = 2;
/* a kept answer is read again after this long with no change, since stall days move with the clock */
const KEEP_MS = 60000;
/* a read a thread has not answered by then is refused as busy, and that thread is ended; it never
   runs again on the board's thread, which a slow or hung read would hold for every PC */
const CAP_MS = 5000;
/* after a thread fails to start, reads run on the board's thread this long before another try */
const BACKOFF_MS = 60000;

/* createReadPool(file): run(name, input, actor, opts) resolves to the reply's text; null file, null pool.
   `size` general threads plus one band thread, each running one read at a time from the pool's queues */
export function createReadPool(file, { size = SIZE, cap = CAP_MS, backoff = BACKOFF_MS, worker = new URL('./read-worker.mjs', import.meta.url) } = {}) {
  if (!file) return null;
  /* slot 0 runs the band's reads alone; the rest run any read, the band's first */
  const slots = new Array(size + 1).fill(null);
  const queues = { band: [], any: [] };
  let n = 0;
  let closed = false;
  let downUntil = 0;
  const counts = { ran: 0, kept: 0, spawned: 0 };

  function spawn(i) {
    counts.spawned += 1;
    const w = new Worker(worker, { workerData: { file } });
    w.unref();
    const slot = { w, job: null, ready: false, timer: null };
    const end = (e) => {
      if (slots[i] !== slot) return;
      slots[i] = null;
      if (!slot.ready) {
        downUntil = Date.now() + backoff;
        for (const q of Object.values(queues)) for (const j of q.splice(0)) j.fail(e);
      }
      if (slot.job) { clearTimeout(slot.timer); const j = slot.job; slot.job = null; j.fail(e); }
      drain();
    };
    w.on('message', (m) => {
      if (m && m.ready) { slot.ready = true; return; }
      const j = slot.job;
      if (!j || j.id !== m.id) return;
      clearTimeout(slot.timer);
      slot.job = null;
      if (m.error !== undefined) j.fail(new Error(m.error)); else j.ok(m.page !== undefined ? m.page : m.text);
      drain();
    });
    w.on('error', end);
    w.on('exit', () => end(new Error('the read thread stopped')));
    slots[i] = slot;
    return slot;
  }

  function start(i, j) {
    const slot = slots[i] || spawn(i);
    slot.job = j;
    slot.timer = setTimeout(() => {
      if (slot.job !== j) return;
      slot.job = null;
      j.fail(Object.assign(new Error('the read thread took over ' + cap + ' ms'), { capped: true }));
      if (slots[i] === slot) slots[i] = null;
      slot.w.terminate().catch(() => {});
      drain();
    }, cap);
    slot.timer.unref();
    slot.w.postMessage({ id: j.id, ...j.msg });
  }

  /* each idle thread takes the next read it may run: the band thread the band's, the others the band's first */
  function drain() {
    if (closed || Date.now() < downUntil) return;
    for (let i = 0; i < slots.length; i++) {
      if (slots[i] && slots[i].job) continue;
      const j = queues.band.shift() || (i > 0 ? queues.any.shift() : undefined);
      if (j) start(i, j);
    }
  }

  function post(msg, lane) {
    if (closed) return Promise.reject(new Error('the read threads are closed'));
    if (Date.now() < downUntil) return Promise.reject(new Error('the read threads failed to start a moment ago'));
    const id = ++n;
    return new Promise((ok, fail) => {
      queues[lane].push({ id, msg, ok, fail });
      drain();
    });
  }

  function run(name, input, actor, opts) {
    counts.ran += 1;
    return post({ name, input, actor, opts }, BAND_READS.has(name) ? 'band' : 'any');
  }

  /* a board page for a signed in device: { status, headers, body }, or null when no page answers there */
  const page = (href, device) => post({ href, device }, 'any');

  /* one computation per key while the board stands at `seq` */
  const kept = new Map();
  function once(key, seq, compute) {
    const k = kept.get(key);
    if (k && k.seq === seq && Date.now() - k.at < KEEP_MS) { counts.kept += 1; return k.text; }
    const text = compute();
    kept.set(key, { seq, at: Date.now(), text });
    /* a failed one is not kept */
    text.catch(() => { if (kept.get(key) && kept.get(key).text === text) kept.delete(key); });
    for (const [x, v] of kept) if (v.seq !== seq) kept.delete(x);
    return text;
  }

  /* started with the board, so no call pays for a thread's start */
  for (let i = 0; i < slots.length; i++) spawn(i);

  function close() {
    closed = true;
    kept.clear();
    for (const q of Object.values(queues)) for (const j of q.splice(0)) j.fail(new Error('the read threads are closed'));
    return Promise.all(slots.map((s) => (s ? (clearTimeout(s.timer), s.w.terminate().catch(() => {})) : null)));
  }

  return { run, once, page, close, counts };
}
