/* Whole-board reads, each one snapshot stamped with the activity
   sequence it was read at, so a reader resumes the event stream from there. */
import { readTx } from '../db.mjs';
import { list, shownByKey } from './questions.mjs';
import { workstreamView } from './tracks.mjs';
import { listWork } from './work.mjs';

export const lastSeq = (db) => db.stmt('SELECT coalesce(max(seq), 0) AS seq FROM activity').get().seq;

/* What today's `list --all` reads: every question and every work record. */
export function boardSnapshot(db, input, actor, opts = {}) {
  return readTx(db, () => {
    const questions = list(db, { all: true }, actor, opts);
    const work = {};
    for (const kind of ['workstream', 'task', 'knowledge']) work[kind] = listWork(db, { kind, all: true });
    return { seq: lastSeq(db), questions, work };
  });
}

/* The working set a PC caches: open and snoozed questions,
   open workstreams and tasks, each open workstream's tracks as drawn. A question
   takes show's whole shape, as a refresh after a change does. */
export function workingSet(db, input, actor, opts = {}) {
  return readTx(db, () => {
    const questions = list(db, {}, actor, opts).concat(list(db, { snoozed: true }, actor, opts)).map((q) => shownByKey(db, q.key, opts));
    const workstreams = listWork(db, { kind: 'workstream' });
    const tasks = listWork(db, { kind: 'task' });
    const views = workstreams.map((w) => workstreamView(db, { workstream: w.key || w.id }, actor));
    return { seq: lastSeq(db), questions, workstreams, tasks, views };
  });
}
