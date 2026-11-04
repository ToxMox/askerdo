/* The one handoff payload check: the CLI's writeHandoff and the mod's
   handoff_write tool both call it, so a payload one accepts the other does too.
   Pure: mod-core imports it, and its text checks are the board's own. */
import { RUN_BY_HINT, WHERE_HEAD, leavesLine, opsProblems, proseOrder, runByOf, stateProblems, stepAt, whereProblems } from '../server/handoff-text.mjs';

export { WHERE_HEAD, leavesLine, proseOrder };

export const FOCUS_MAX = 400;
export const LINE_MAX = 400;
export const STATE_BYTES = 10240;
/* the previous session's own words, beside the state */
export const WHERE_BYTES = 4096;

/* An absolute path on either platform: a link may name a project directory. */
export const isAbsolutePath = (s) => typeof s === 'string' && (/^[A-Za-z]:[\\/]/.test(s) || s.startsWith('/'));

/* where a ruling was registered: a Q id or a decisions row, kept short */
export const REGISTERED_MAX = 200;
const RULING_ID = /^R[1-9]\d{0,5}$/;
const RULING_KEYS = ['id', 'text', 'registered'];

const isText = (v) => typeof v === 'string' && v.trim() !== '';
const oneLine = (v) => !/[\r\n]/.test(v);

/* Problems with a handoff payload's shared fields, as sentences; [] when it passes.
   Each tool keeps its own unknown-key and status checks. */
export function handoffProblems(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return ['handoff payload must be an object: focus, state, verifyFirst'];
  const e = [];
  if (!isText(p.focus)) e.push('handoff payload needs a focus: the one next action, in a sentence');
  else {
    if (!oneLine(p.focus)) e.push('focus is one sentence on one line');
    if (p.focus.trim().length > FOCUS_MAX) e.push('focus is ' + p.focus.trim().length + ' characters; at most ' + FOCUS_MAX);
  }
  if (!isText(p.state)) e.push('handoff payload needs a state string: what is done and what to watch; the steps left go in leftovers');
  else e.push(...stateProblems(p.state, { state: STATE_BYTES, line: LINE_MAX }));
  if (p.whereWeWere !== undefined) {
    if (!isText(p.whereWeWere)) e.push('whereWeWere is text: where the conversation stood, in your own words');
    else e.push(...whereProblems(p.whereWeWere, { where: WHERE_BYTES }));
  }
  if (p.leftovers !== undefined) {
    if (!Array.isArray(p.leftovers)) e.push('leftovers is a list of steps: { name, after, runBy }');
    else e.push(...stepProblems(p.leftovers, 'leftovers', true));
  }
  if (!Array.isArray(p.verifyFirst) || !p.verifyFirst.length) e.push('verifyFirst is required: one entry per repo, each with an absolute path');
  else {
    p.verifyFirst.forEach((v, i) => {
      if (!v || typeof v !== 'object' || Array.isArray(v)) e.push('verifyFirst[' + i + '] must be an object');
      else if (!isAbsolutePath(v.path)) e.push('verifyFirst[' + i + '].path is required: the repo directory, absolute');
    });
  }
  if (p.waitingOnUser !== undefined) {
    if (!Array.isArray(p.waitingOnUser)) e.push('waitingOnUser is a list of strings');
    else p.waitingOnUser.forEach((x, i) => {
      if (!isText(x) || !oneLine(x) || x.trim().length > LINE_MAX) e.push('waitingOnUser[' + i + '] is one line of at most ' + LINE_MAX);
    });
  }
  if (p.rulings !== undefined) e.push(...rulingProblems(p.rulings));
  return e;
}

/* a live handoff's patch, { ops } or the list alone, checked before any board
   call; the board checks the patched text against the budgets above. */
export function updateProblems(p) {
  const ops = Array.isArray(p) ? p : p && typeof p === 'object' ? p.ops : undefined;
  const e = opsProblems(ops, { line: LINE_MAX });
  if (Array.isArray(ops)) ops.forEach((o, i) => {
    if (o && o.op === 'verifyFirst' && typeof o.path === 'string' && o.path.trim() && !isAbsolutePath(o.path.trim())) e.push('ops[' + i + '].path is the repo directory, absolute');
  });
  return e;
}

/* a layout's steps (handoff leftovers, track layout): each names one line or
   a task; after holds T-n ids and the numbers of earlier steps. A leftover
   names who runs it (runBy), a layout's step may. Before holds T-n ids alone. */
const STEP_KEYS = ['name', 'task', 'after', 'before', 'description', 'priority', 'runBy'];
const TASK_ID = /^T-\d+$/;
/* the board's own list (server/verbs/work.mjs PRIORITIES) */
const PRIORITIES = ['high', 'medium', 'low'];
export function stepProblems(list, field = 'steps', needRunBy = false) {
  if (!Array.isArray(list)) return [field + ' is a list of steps: { name, after }'];
  const e = [];
  list.forEach((s, i) => {
    /* the step by its number from 1 and its name, as the board's refusal names it */
    const at = stepAt(field, i, s) + ': ';
    if (!s || typeof s !== 'object' || Array.isArray(s)) { e.push(at + 'is an object: { name, task, after }'); return; }
    for (const k of Object.keys(s)) if (!STEP_KEYS.includes(k)) e.push(at + 'has unknown field "' + k + '"');
    if (s.task !== undefined && !(typeof s.task === 'string' && TASK_ID.test(s.task.trim()))) e.push(at + 'task is a T-n id');
    if (s.name !== undefined && (!isText(s.name) || !oneLine(s.name) || s.name.trim().length > LINE_MAX)) e.push(at + 'name is one line of at most ' + LINE_MAX);
    if (s.name === undefined && s.task === undefined) e.push(at + 'names the task: a name of one line, or task T-n');
    if (s.description !== undefined && !isText(s.description)) e.push(at + 'description is text');
    if (s.priority !== undefined && !PRIORITIES.includes(s.priority)) e.push(at + 'priority is one of ' + PRIORITIES.join(', '));
    if ((needRunBy || s.runBy !== undefined) && !runByOf(s.runBy)) e.push(at + 'runBy names who runs it: ' + RUN_BY_HINT);
    if (s.after !== undefined) {
      if (!Array.isArray(s.after)) e.push(at + 'after is a list of T-n ids and earlier step numbers');
      else s.after.forEach((a) => {
        const ok = (typeof a === 'string' && TASK_ID.test(a.trim())) || (Number.isInteger(a) && a >= 1 && a <= i);
        if (!ok) e.push(at + 'after names ' + JSON.stringify(a) + ': a T-n id, or the number of an earlier step' + (i ? ' (1 to ' + i + ')' : ', and this is the first'));
      });
    }
    if (s.before !== undefined) {
      if (!Array.isArray(s.before)) e.push(at + 'before is a list of T-n ids: the tasks that wait on this step');
      else s.before.forEach((b) => {
        if (!(typeof b === 'string' && TASK_ID.test(b.trim()))) e.push(at + 'before names ' + JSON.stringify(b) + ': a T-n id (a later step waits on this one through its own after)');
      });
    }
  });
  return e;
}

/* rulings: a string is a new ruling made in chat; { id, registered } marks a
   carried one registered; { text, registered } records one registered at once. */
function rulingProblems(list) {
  if (!Array.isArray(list)) return ['rulings is a list: new rulings as strings, { id, registered } to mark one registered'];
  const e = [];
  list.forEach((r, i) => {
    const at = 'rulings[' + i + ']';
    if (typeof r === 'string') {
      if (!isText(r) || !oneLine(r) || r.trim().length > LINE_MAX) e.push(at + ' is one line of at most ' + LINE_MAX);
      return;
    }
    if (!r || typeof r !== 'object' || Array.isArray(r)) { e.push(at + ' is a string or { id, registered }'); return; }
    for (const k of Object.keys(r)) if (!RULING_KEYS.includes(k)) e.push(at + ' has unknown field "' + k + '"');
    if ((r.id === undefined) === (r.text === undefined)) e.push(at + ' names one of id (a carried ruling) and text (a new one)');
    if (r.id !== undefined && !(typeof r.id === 'string' && RULING_ID.test(r.id.trim()))) e.push(at + '.id is a ruling id, R1 for example');
    if (r.text !== undefined && (!isText(r.text) || !oneLine(r.text) || r.text.trim().length > LINE_MAX)) e.push(at + '.text is one line of at most ' + LINE_MAX);
    if (!isText(r.registered) || !oneLine(r.registered) || r.registered.length > REGISTERED_MAX || /[()]/.test(r.registered)) {
      e.push(at + '.registered names where it was registered (a Q id or a decisions row), one line of at most ' + REGISTERED_MAX + ' without parentheses');
    }
  });
  return e;
}

/* A stored ruling line, "R3: text" or "R3 (registered Q61): text", and back. */
export function rulingLine(r) {
  return r.id + (r.registered ? ' (registered ' + r.registered + ')' : '') + ': ' + r.text;
}

export function parseRuling(line) {
  const m = /^(R[1-9]\d{0,5})(?: \(registered ([^()]*)\))?: ([\s\S]*)$/.exec(String(line || ''));
  return m ? { id: m[1], text: m[3], ...(m[2] ? { registered: m[2] } : {}) } : null;
}
