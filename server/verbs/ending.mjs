/* The one close: every way a task ends goes through here. A close is
   refused while a step is open, naming each and the calls that settle it; what follows an
   ending (the review check for a done, the waits on it) runs here once. */
import { ENDED_TASK, TASK_KEYS, TrackRefusal, headOf, itemsOf, logLine, writeFront } from './graph.mjs';
import { afterTask } from './coverage.mjs';
import { wakeLinked } from './questions.mjs';
import { closeHeldRefusal, endTaskRuns, othersRuns } from './runs.mjs';

/* Steps that count as settled by the call itself: a leftover filing a step by `check`
   strikes it once its task exists. A symbol, so no caller can send it over the wire. */
export const SETTLED = Symbol('steps the close settles');

export const openSteps = (db, key, settled = []) => itemsOf(db, key).filter((s) => !s.done && !settled.includes(s.n)).map(({ n, text }) => ({ n, text }));

export function stepsRefusal(id, open) {
  const ns = open.map((s) => s.n);
  return new TrackRefusal(id + ' has ' + open.length + ' open step' + (open.length > 1 ? 's' : '') + ', which a close would lose: '
    + open.map((s) => s.n + '. ' + s.text).join('; ') + '. Settle each in the same call: checks.done [' + ns.join(', ') + '] for one that is done, '
    + 'checks.strike [{ step: ' + ns[0] + ', why: "<a word why>" }] for one that will not be done, or a leftover { check: ' + ns[0] + ', runBy, tier: 2, before: ["T-n"] } that files it as a task, naming its tier as any filing does; '
    + 'or first, in its own call, move a step someone else does (moveSteps [{ check: ' + ns[0] + ', onto: "T-n" }], or to a question, or filed as a task). '
    + 'On the CLI: task update ' + id + ' --status <done or dropped> with --check-done ' + ns[0] + ', --check-strike "' + ns[0] + ': why" or --leftovers ([{ "check": ' + ns[0] + ', "runBy": ..., "tier": 2, "before": ["T-n"] }] on stdin); '
    + 'or first task update ' + id + ' --move-steps ([{ "check": ' + ns[0] + ', "onto": "T-n" }] on stdin).', { openSteps: open });
}

/* Throws the refusal when the task has an open step the call does not settle. */
export function gateEnding(db, key, id, settled = []) {
  const open = openSteps(db, key, settled);
  if (open.length) throw stepsRefusal(id, open);
}

/* What follows an ending, for a caller that wrote the ending in its own line (an edit). */
export function afterEnding(db, key, fields, ending, ctx, actor) {
  const covers = ending === 'done' ? afterTask(db, key, { done: true }, actor).covers : null;
  wakeLinked(db, { ...fields, key }, ending, ctx);
  return covers;
}

/* The open runs a board's own close leaves the task open for: any but the closer session's. */
export const runsHolding = (db, key, session) => othersRuns(db, key, session || null);

/* Ends `rec` as `ending` ('done' or 'dropped') in one write and its line: refused while a step
   is open or another session's run is (the board's own closes check both first and say so).
   `opts`: note, verb, by (the line's actor), extra front changes, settled steps. */
export function endTask(db, rec, ending, ctx, opts = {}) {
  if (!ENDED_TASK.includes(ending)) throw new TrackRefusal('a task ends done or dropped, not ' + ending);
  gateEnding(db, rec.key, rec.fields.id, opts.settled);
  const held = runsHolding(db, rec.key, ctx.session);
  if (held.length) throw closeHeldRefusal(db, rec.fields.id, held, ctx);
  const by = opts.by || ctx.by;
  const diff = writeFront(db, rec, { status: ending, closed: ctx.at, ...(opts.changes || {}) }, TASK_KEYS);
  logLine(db, { at: ctx.at, verb: opts.verb || (ending === 'dropped' ? 'drop' : 'edit'), kind: 'task', rec: headOf(rec), changes: diff, by, pc: ctx.pc, note: opts.note });
  endTaskRuns(db, rec.key, ending, { by, session: ctx.session, pc: ctx.pc, now: ctx.date });
  return afterEnding(db, rec.key, rec.fields, ending, { ...ctx, by }, opts.actor || { by, pc: ctx.pc, now: ctx.date });
}
