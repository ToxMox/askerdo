/* The one handoff payload check: the CLI's writeHandoff and the mod's
   handoff_write tool both call it, so a payload one accepts the other does too.
   Pure: mod-core imports it, and its text checks are the board's own. */
import { LEAD, RUN_BY_HINT, WHERE_HEAD, cutAt, isFence, leavesLine, passesWhole, opsProblems, proseOrder, reviewLine, runByOf, staleToolsLine, stateProblems, stepAt, whereProblems } from '../server/handoff-text.mjs';

export { WHERE_HEAD, leavesLine, proseOrder, reviewLine, staleToolsLine };

export const FOCUS_MAX = 400;
export const LINE_MAX = 400;
export const STATE_BYTES = 10240;
/* the previous session's own words, beside the state */
export const WHERE_BYTES = 4096;
/* what the track is doing now, a sentence or two */
export const GOAL_MAX = 600;

/* An absolute path on either platform: a link may name a project directory. */
export const isAbsolutePath = (s) => typeof s === 'string' && (/^[A-Za-z]:[\\/]/.test(s) || s.startsWith('/'));

/* where a ruling was registered: a Q id or a decisions row, kept short */
export const REGISTERED_MAX = 200;
const RULING_ID = /^R[1-9]\d{0,5}$/;
const RULING_KEYS = ['id', 'text', 'registered'];

const isText = (v) => typeof v === 'string' && v.trim() !== '';
const oneLine = (v) => !/[\r\n]/.test(v);

/* a line over LINE_MAX goes on two-space indented continuation lines, so a long
   handoff line is never refused; what passesWhole names (the board's own rule) passes whole. */
export function wrapLines(text, max = LINE_MAX) {
  let fenced = false;
  let wrapped = 0;
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    if (isFence(line)) fenced = !fenced;
    if (line.length <= max || passesWhole(line, fenced, max)) { out.push(line); continue; }
    const cont = LEAD.exec(line)[1] + '  ';
    let s = line;
    let from = LEAD.exec(line)[0].length;
    let cut = cutAt(s, from, max);
    wrapped++;
    while (cut) {
      out.push(s.slice(0, cut[0]).trimEnd());
      s = cont + s.slice(cut[1]).trimStart();
      from = cont.length;
      cut = s.length > max ? cutAt(s, from, max) : null;
    }
    out.push(s);
  }
  return { text: out.join('\n'), wrapped };
}

/* The payload with state and whereWeWere wrapped, as both writers send it; wrapped counts the lines cut. */
export function wrapHandoff(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return { payload: p, wrapped: 0 };
  const payload = { ...p };
  let wrapped = 0;
  for (const k of ['state', 'whereWeWere']) {
    if (!isText(p[k])) continue;
    const w = wrapLines(p[k]);
    payload[k] = w.text;
    wrapped += w.wrapped;
  }
  return { payload, wrapped };
}
export const wrappedLine = (n) => (n ? 'Wrapped ' + n + ' line' + (n === 1 ? '' : 's') + ' over ' + LINE_MAX + ' characters onto indented continuation lines.' : '');

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
  /* the budgets hold for the wrapped text, the one sent; a line the wrap leaves long passes */
  else e.push(...stateProblems(wrapLines(p.state).text, { state: STATE_BYTES, line: Infinity }));
  if (p.whereWeWere !== undefined) {
    if (!isText(p.whereWeWere)) e.push('whereWeWere is text: where the conversation stood, in your own words');
    else e.push(...whereProblems(wrapLines(p.whereWeWere).text, { where: WHERE_BYTES }));
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
      /* the latest handoff's waits carry; { drop } settles one */
      const drop = x && typeof x === 'object' && !Array.isArray(x) && Object.keys(x).length === 1 ? x.drop : undefined;
      const l = typeof x === 'string' ? x : drop;
      if (!isText(l) || !oneLine(l) || l.trim().length > LINE_MAX) e.push('waitingOnUser[' + i + '] is one line of at most ' + LINE_MAX + ', or { drop: a carried line }');
    });
  }
  if (p.rulings !== undefined) e.push(...rulingProblems(p.rulings));
  if (p.goal !== undefined && (!isText(p.goal) || p.goal.trim().length > GOAL_MAX)) e.push('goal is what the track is doing now, a sentence or two of at most ' + GOAL_MAX + ' characters');
  /* the PC the next leg runs on, by the board's device name, which the board checks */
  if (p.nextPc !== undefined && (!isText(p.nextPc) || !oneLine(p.nextPc) || p.nextPc.trim().length > 100)) e.push('nextPc is the board\'s device name of the PC the next leg runs on, as status prints it');
  /* a task in hand's note, and its new description or intent, ride the handoff's call */
  if (p.taskNotes !== undefined) {
    if (!Array.isArray(p.taskNotes)) e.push('taskNotes is a list of { id: T-n, note, description?, intent? }');
    else p.taskNotes.forEach((t, i) => {
      const at = 'taskNotes[' + i + ']';
      if (!t || typeof t !== 'object' || Array.isArray(t)) { e.push(at + ' is { id, note, description?, intent? }'); return; }
      for (const k of Object.keys(t)) if (!['id', 'note', 'description', 'intent'].includes(k)) e.push(at + ' has unknown field "' + k + '"');
      if (!(typeof t.id === 'string' && /^T-[0-9]+$/i.test(t.id.trim()))) e.push(at + '.id is a T-n id');
      if (!isText(t.note)) e.push(at + '.note is what this leg did and learned on the task');
      for (const k of ['description', 'intent']) if (t[k] !== undefined && !isText(t[k])) e.push(at + '.' + k + ' is text');
    });
  }
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
   names who runs it (runBy), a layout's step may. Before holds T-n ids alone. A
   closing task's leftover (`inbox`) may go to the inbox instead, unplaced with its wake. */
const STEP_KEYS = ['name', 'task', 'after', 'before', 'last', 'description', 'priority', 'runBy', 'reviewScope', 'here', 'whyElsewhere'];
const LATER_KEYS = ['newTrack', 'unparkWhen'];
const INBOX_KEYS = ['unplaced', 'wake'];
/* a close's leftover may name an open checklist step by its number in place of a name */
const CLOSE_KEYS = [...INBOX_KEYS, 'check'];
/* a leftover names its tier and that tier's answer, as the place tool does */
const LADDER_KEYS = ['tier', 'track', 'workstream', 'whyElsewhere'];
export const TIERS = [2, 3, 4];
const TIER_OTHER = 'tier is 2 (the track this session holds), 3 (another track, or a parked one an event opens) or 4 (another workstream); '
  + 'work for a task\'s own worker is a step on that task, and what only the user can decide or do is a question';
const UNPARK_WHEN = /^\s*(?:track-ends\s+TR-\d+|task-completes\s+(?:T-\d+|\d+)|question-answered\s+Q-?\d+)\s*$/i;
const TASK_ID = /^T-\d+$/;
/* the board's own list (server/verbs/work.mjs PRIORITIES) */
const PRIORITIES = ['high', 'medium', 'low'];
export function stepProblems(list, field = 'steps', needRunBy = false, inbox = false) {
  if (!Array.isArray(list)) return [field + ' is a list of steps: { name, after }'];
  const e = [];
  list.forEach((s, i) => {
    /* the step by its number from 1 and its name, as the board's refusal names it */
    const at = stepAt(field, i, s) + ': ';
    if (!s || typeof s !== 'object' || Array.isArray(s)) { e.push(at + 'is an object: { name, task, after }'); return; }
    const left = field === 'leftovers';
    const tiered = left && s.tier !== undefined;
    /* a named tier lets the board place a handoff's step in an inbox too (tier 2 with a date, tier 4 with an event) */
    const toInbox = inbox || tiered;
    for (const k of Object.keys(s)) {
      if (!STEP_KEYS.includes(k) && !(left && (LATER_KEYS.includes(k) || LADDER_KEYS.includes(k))) && !(inbox && CLOSE_KEYS.includes(k)) && !(tiered && INBOX_KEYS.includes(k))) e.push(at + 'has unknown field "' + k + '"');
    }
    if (tiered && !TIERS.includes(s.tier)) e.push(at + TIER_OTHER);
    if (left && s.track !== undefined && !(typeof s.track === 'string' && /^TR-\d+$/.test(s.track.trim()))) e.push(at + 'track is a TR-n id');
    if (left && s.workstream !== undefined && !(typeof s.workstream === 'string' && /^WS-\d+$/.test(s.workstream.trim()))) e.push(at + 'workstream is a WS-n id');
    if (left && !tiered && (s.track !== undefined || s.workstream !== undefined)) e.push(at + 'track and workstream answer a tier: name tier 3 or 4 with them');
    if (s.whyElsewhere !== undefined && (!isText(s.whyElsewhere) || !oneLine(s.whyElsewhere))) e.push(at + 'whyElsewhere is why the track this session holds does not cover the work, one line');
    /* a step asked of the user names here, the real place on the held track it would otherwise take */
    if (s.here !== undefined && !(s.here && typeof s.here === 'object' && !Array.isArray(s.here) && Object.keys(s.here).every((k) => k === 'after' || k === 'before')
      && ['after', 'before'].every((k) => s.here[k] === undefined || (Array.isArray(s.here[k]) && s.here[k].every((x) => typeof x === 'string' && TASK_ID.test(x.trim())))))) {
      e.push(at + 'here is { after, before }, each a list of T-n ids: the real place on the track you hold the step would otherwise take');
    }
    if (s.last !== undefined && (!isText(s.last) || !oneLine(s.last))) e.push(at + 'last is why nothing on the track needs the step sooner, one line');
    if (s.last !== undefined && s.before !== undefined) e.push(at + 'names before or last, not both');
    if (toInbox && s.unplaced !== undefined && (!isText(s.unplaced) || !oneLine(s.unplaced))) e.push(at + 'unplaced is why no plan reaches the work, one line');
    if (toInbox && s.wake !== undefined && !isText(s.wake)) e.push(at + 'wake is the event that brings it back: "track-ends TR-n", "task-completes T-n", "question-answered Q-n" or a date YYYY-MM-DD');
    if (toInbox && (s.unplaced !== undefined || s.wake !== undefined) && (s.newTrack !== undefined || s.after !== undefined || s.before !== undefined)) {
      e.push(at + 'goes into the inbox (unplaced with its wake) or on a track (after, before, newTrack), not both');
    }
    /* a leftover for later work goes on a new track, parked until its event */
    if (left && s.newTrack !== undefined && (!isText(s.newTrack) || !oneLine(s.newTrack) || s.newTrack.trim().length > LINE_MAX)) e.push(at + 'newTrack is the new track\'s name, one line');
    if (left && s.unparkWhen !== undefined && ((s.newTrack === undefined && !tiered) || !isText(s.unparkWhen) || !UNPARK_WHEN.test(s.unparkWhen))) {
      e.push(at + 'unparkWhen ' + (tiered ? 'is' : 'goes with newTrack, or with tier 3:') + ' "track-ends TR-n", "task-completes T-n" (or a leftover\'s number) or "question-answered Q-n"');
    }
    if (s.task !== undefined && !(typeof s.task === 'string' && TASK_ID.test(s.task.trim()))) e.push(at + 'task is a T-n id');
    if (s.name !== undefined && (!isText(s.name) || !oneLine(s.name) || s.name.trim().length > LINE_MAX)) e.push(at + 'name is one line of at most ' + LINE_MAX);
    if (inbox && s.check !== undefined && !(Number.isInteger(s.check) && s.check >= 1)) e.push(at + 'check is the number of an open checklist step on the closing task, 1 first');
    if (s.check !== undefined && s.task !== undefined) e.push(at + 'check files the step as a new task, so it takes no task');
    if (s.name === undefined && s.task === undefined && s.check === undefined) e.push(at + 'names the task: a name of one line, or task T-n' + (inbox ? ", or check with a checklist step's number" : ''));
    if (s.description !== undefined && !isText(s.description)) e.push(at + 'description is text');
    if (s.priority !== undefined && !PRIORITIES.includes(s.priority)) e.push(at + 'priority is one of ' + PRIORITIES.join(', '));
    if (s.reviewScope !== undefined && !['track', 'project'].includes(s.reviewScope)) e.push(at + 'reviewScope is track or project (a review step)');
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
