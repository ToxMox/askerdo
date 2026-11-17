/* A stand-in read thread for the pool's tests: `hang` (or any read whose input says hang) never
   answers, anything else at once with its name; the file missing.db
   throws before it is ready. */
import { isMainThread, parentPort, workerData } from 'node:worker_threads';

/* the suite's runner loads every file here; only a thread runs */
if (!isMainThread) {
  if (workerData.file === 'missing.db') throw new Error('no board file');
  parentPort.postMessage({ ready: true });
  parentPort.on('message', ({ id, name, input }) => {
    if (name === 'hang' || (input && input.hang)) return;
    parentPort.postMessage({ id, text: name });
  });
}
