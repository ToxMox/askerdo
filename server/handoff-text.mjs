/* A handoff's text checks and its patch, pure and import-free: the
   board runs them on a patched handoff and lib/handoff-payload.mjs re-exports
   them for the PC, so both sides check the same. Budgets come from the caller. */

export const WHERE_HEAD = '## Where we were';

const bytes = (s) => new TextEncoder().encode(s).length;
const isText = (v) => typeof v === 'string' && v.trim() !== '';
const oneLine = (v) => isText(v) && !/[\r\n]/.test(v);
const flat = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/* a handoff orders nothing in prose. A list of two or more steps under a
   Next (next steps, next up, what's next, next session) line is refused, quoting the
   steps, so they go in leftovers. One lead-in line may sit before the list; sub-items
   detail a step and are not steps. */
const NEXT_HEAD = /^(?:#{1,6}\s+)?[*_]*\s*(?:next(?:\s+(?:steps?|up|session|leg))?|up\s+next|what(?:'s|’s|\s+is|\s+comes)\s+next)\s*[*_]*\s*:?\s*[*_]*$/i;
const LIST_ITEM = /^(\s*)(?:[-*+]|\d{1,3}[.)])\s+(\S.*)$/;
const HEADING = /^\s*#{1,6}\s/;

export function proseOrder(text, field) {
  const lines = String(text).split(/\r?\n/);
  const e = [];
  for (let i = 0; i < lines.length; i++) {
    if (!NEXT_HEAD.test(lines[i].trim())) continue;
    const steps = [];
    let base = -1;
    let lead = false;
    let j = i + 1;
    for (; j < lines.length; j++) {
      const l = lines[j];
      const m = LIST_ITEM.exec(l);
      if (m) {
        if (base < 0) base = m[1].length;
        if (m[1].length <= base) steps.push(m[2].trim());
        continue;
      }
      if (!l.trim() || (steps.length && /^\s/.test(l))) continue;
      if (!steps.length && !lead && !HEADING.test(l) && !NEXT_HEAD.test(l.trim())) { lead = true; continue; }
      break;
    }
    if (steps.length >= 2) {
      const quoted = steps.slice(0, 5).map((t) => '"' + (t.length > 60 ? t.slice(0, 57) + '...' : t) + '"').join(', ') + (steps.length > 5 ? ' and ' + (steps.length - 5) + ' more' : '');
      e.push(field + ' orders work in prose under "' + lines[i].trim() + '": ' + quoted
        + '; move each step into leftovers, with its after, so the track carries the order and ' + field + ' keeps the thinking');
    }
    i = j - 1;
  }
  return e;
}

/* The state's own checks past "is it text": its budget, its line length, no
   whereWeWere heading, no order in prose. `max`: { state, line } */
export function stateProblems(state, max) {
  const s = String(state).trim();
  const e = [];
  const n = bytes(s);
  if (n > max.state) e.push('state is ' + n + ' bytes; the budget is ' + max.state + ' (10 KB)');
  const lines = s.split(/\r?\n/);
  const long = lines.map((l, i) => [i + 1, l.length]).filter(([, len]) => len > max.line);
  if (long.length) e.push('state lines over ' + max.line + ' characters: ' + long.map(([i, len]) => 'line ' + i + ' (' + len + ')').join(', '));
  if (lines.some((l) => l.trim() === WHERE_HEAD)) e.push('state holds a "' + WHERE_HEAD + '" heading; that section goes in whereWeWere');
  e.push(...proseOrder(s, 'state'));
  return e;
}

/* `max`: { where } */
export function whereProblems(where, max) {
  const w = String(where).trim();
  const e = [];
  if (bytes(w) > max.where) e.push('whereWeWere is ' + bytes(w) + ' bytes; the budget is ' + max.where + ' (4 KB)');
  e.push(...proseOrder(w, 'whereWeWere'));
  return e;
}

/* who runs a step, so a resumed session hands on what the writer
   meant to hand on; null when it names none of these. */
export const RUN_BY_HINT = 'orchestrator, fork, or agent:<model>';
export function runByOf(v) {
  const t = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return /^(?:orchestrator|fork|agent:[a-z][a-z0-9.-]{0,39})$/.test(t) ? t : null;
}

/* a step as the board names it, by its number from 1 and its name or task:
   'leftovers step 2 ("Fix the seam")', a plan's 'step 3' */
export function stepAt(field, i, s) {
  const o = s && typeof s === 'object' ? s : {};
  const named = typeof o.name === 'string' && o.name.trim() ? ' ("' + o.name.trim().slice(0, 60) + '")' : typeof o.task === 'string' && o.task.trim() ? ' (' + o.task.trim() + ')' : '';
  return (field && field !== 'steps' ? field + ' ' : '') + 'step ' + (i + 1) + named;
}

export const CLI = 'node ~/.claude/askerdo/cli.mjs';
/* a list a kickoff or a result names in one line, past this counted */
export const LIST_MAX = 10;
export const listWords = (items, word) => items.slice(0, LIST_MAX).map(word).join('; ')
  + (items.length > LIST_MAX ? '; and ' + (items.length - LIST_MAX) + ' more' : '');

/* a track's open tasks nothing waits on, its longest chain's end aside: each an
   end on purpose or a missing edge, so the session says which. It asks, never refuses.
   `cli`: the launcher the session runs, a sandbox's own rather than the live one. */
export function leavesLine(leaves, track, cli = CLI) {
  if (!Array.isArray(leaves) || !leaves.length) return '';
  const one = leaves.length === 1;
  return 'Nothing waits on ' + (one ? 'this open task' : 'these ' + leaves.length + ' open tasks') + ' of ' + track
    + ', and its longest chain ends elsewhere: ' + listWords(leaves, (t) => t.id + ' ' + flat(t.name))
    + '. In your reply, confirm ' + (one ? 'it' : 'each') + ' as an end on purpose, or wire it to the task that needs it (`'
    + cli + ' edge add <the later task> <this one> --reason "<why>"`).';
}

/* a track's review readout in one line, for the kickoff and the handoff:
   due names the count and the tasks, not due one quiet count, none nothing. */
export function reviewLine(review, track) {
  if (!review || !Array.isArray(review.uncovered) || !review.uncovered.length) return '';
  const n = review.uncovered.length;
  const tasks = n + ' finished code task' + (n === 1 ? '' : 's');
  const ids = listWords(review.uncovered, (t) => t.id + ' ' + flat(t.name));
  if (review.due) {
    return 'Review due on ' + track + ': ' + tasks + ' no review read (' + ids + '), ' + review.lines + ' counted lines. '
      + (review.planned ? review.planned + ' covers them when it completes'
        : 'Put a review task on the track after them (labelled review, or named "Review ..."); it covers them when it completes')
      + (review.locked ? ', and the track finishes only after one.' : '.');
  }
  return 'Unreviewed on ' + track + ': ' + tasks + ' (' + ids + '); a review is due at ' + review.size
    + (review.locked ? ', and the track finishes only after one.' : '.');
}

/* the user's own captures wake 14 days out; a task stored with no wake reads so too */
export const WAKE_DAYS = 14;
export const WAKE_FORMS = 'track-ends TR-n | task-completes T-n | question-answered Q-n | YYYY-MM-DD';
const pad2 = (n) => String(n).padStart(2, '0');
export function wakeIn(days = WAKE_DAYS, now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

/* the one refusal an inbox filing meets, whatever it lacks: the cause, the inbox's rule, and both
   ways out as commands. `via`: create, capture, edit (a task id), or finish and drop (a track id). */
export function inboxRefusal({ cause, via = 'create', task, track, workstream, hint } = {}, cli = CLI) {
  const ws = workstream || 'WS-n';
  const forms = '<' + WAKE_FORMS + '>';
  const closing = via === 'finish' || via === 'drop';
  const close = 'track ' + via + ' ' + (track || 'TR-n');
  const place = task ? '`' + cli + ' task edit ' + task + ' --track TR-n`' : via === 'capture' ? '`' + cli + ' track capture --track TR-n --name "<the work>"`'
    : closing ? '`' + cli + ' task edit <T-n> --track TR-n` for each before the close, or drop them with it: `' + cli + ' ' + close + ' --leftovers drop`'
      : '`' + cli + ' task create --track TR-n`';
  const wake = task ? 'task edit ' + task + ' --unplaced "<why no plan reaches it>" --wake ' + forms
    : via === 'capture' ? 'track capture --workstream ' + ws + ' --name "<the work>" --unplaced "<why no plan reaches it>" --wake ' + forms
      : closing ? close + ' --leftovers inbox --wake ' + forms
        : 'task create --unplaced "<why no plan reaches it>" --wake ' + forms;
  /* task create takes its workstream in the payload, not as a flag */
  const same = !task && via !== 'capture' && !closing ? ', with the same payload' : '';
  return cause + '. The inbox holds only work no plan reaches yet, and each inbox task names the event that brings it back.'
    + ' Put ' + (closing ? 'them' : 'it') + ' on a track (' + place + '); work that starts later goes on a new parked track first (`' + cli + ' track new --workstream ' + ws
    + ' --name "<the work>" --goal "<what done is>"`, then `' + cli + ' track park TR-n --reason "<why it waits>" --unpark-when "<track-ends TR-n | task-completes T-n | question-answered Q-n>"`).'
    + (closing ? ' Or send them to the inbox with their wake (`' : ' Or file it again with its wake (`') + cli + ' ' + wake + '`' + same + ').' + (hint ? ' ' + hint : '');
}

/* an inbox row with the user's question about its home open says so, beside its wake */
const askedTag = (t) => (t.asked ? ', with the user as ' + t.asked : '');

/* The due tasks not with the user, split into those `ws` (an id or its head) owes and
   another workstream's, which are only named; with no `ws` every one is owed. */
function dueSplit(inbox, ws) {
  const due = inbox.filter((t) => t && t.due && !t.asked);
  const own = typeof ws === 'string' ? ws : ws && ws.id;
  const away = own ? due.filter((t) => t.workstream && t.workstream.id && t.workstream.id !== own) : [];
  return { owed: due.filter((t) => !away.includes(t)), away };
}
const each = (l) => (l.length === 1 ? 'it' : 'each');
/* lib/mod-core.mjs closedInbox reads the away ids back from this, as "T-n (WS-n)" */
const awayWords = (away) => 'Due in another workstream: ' + listWords(away, (t) => t.id + ' (' + t.workstream.id + ')')
  + (away.length === 1 ? '; name it in the reply, since its own workstream places it' : '; name each in the reply, since their own workstreams place them');

/* The inbox and the ways to settle each item, said alike by the kickoff, track finish
   and handoff write, the mod's results too; an empty inbox says nothing.
   `ws`: the track's workstream (an id or its head), whose due tasks the close owes. */
export function inboxLines(inbox, cli = CLI, ws) {
  if (!inbox || !inbox.length) return [];
  /* each row says its wake, or that it is due, which naming no longer settles */
  const { owed, away } = dueSplit(inbox, ws);
  const tag = (t) => (t.due ? ', due' : t.wake ? ', wakes ' + flat(t.wake) : '') + askedTag(t);
  return ['Inbox (' + inbox.length + '): ' + listWords(inbox, (t) => t.id + ' ' + flat(t.name) + ' (' + t.workstream.id + ' ' + flat(t.workstream.name) + tag(t) + ')') + '.',
    'Place each: put it on a track (`' + cli + ' track capture --track <TR-n> --task <T-n>`; work that starts later goes on a parked track), move it to the workstream it belongs in (`'
      + cli + ' task edit <T-n> --workstream <WS-n>`), give it a new wake (`' + cli + ' task edit <T-n> --wake <event or YYYY-MM-DD>`), or ask the user'
      + (owed.length ? '. Due: ' + listWords(owed, (t) => t.id) + '; place ' + each(owed) + ' or wake ' + each(owed)
        + ' again before this turn ends, since naming a due task does not settle it' : '')
      + (away.length ? '. ' + awayWords(away) : '') + '.'];
}

/* the due inbox tasks lead the kickoff, with the place command; every
   kickoff on the project (the inbox projectInbox reads), each naming its workstream and any open question.
   `ws`: the kickoff's workstream; another's due task is only named, as the inbox line says. */
export function dueLine(inbox, cli = CLI, ws) {
  const due = (Array.isArray(inbox) ? inbox : []).filter((t) => t && t.due);
  if (!due.length) return '';
  const { owed, away } = dueSplit(due, ws);
  const which = owed.length === due.length ? 'each' : listWords(owed, (t) => t.id);
  return 'Due for a home (' + due.length + '): ' + listWords(due, (t) => t.id + ' ' + flat(t.name) + ' (' + (t.workstream && t.workstream.id ? t.workstream.id + ', ' : '')
    + 'its wake: ' + flat(t.wake) + askedTag(t) + ')') + '.'
    + (owed.length ? ' Place ' + which + ' on a track (`' + cli + ' task edit <T-n> --track <TR-n>`; work that starts later goes on a new parked track: `' + cli
      + ' track new --workstream <WS-n> --name <name> --goal <goal>`, then `' + cli + ' track park <TR-n> --reason <why> --unpark-when <event>`), or wake ' + each(owed) + ' again (`'
      + cli + ' task edit <T-n> --wake <event or YYYY-MM-DD>`); a third wake in one inbox stay goes to the user as a question.' : '')
    + (away.length ? ' ' + awayWords(away) + '.' : '')
    + (due.some((t) => t.asked) ? ' One with the user waits on its answer: act on it once it comes.' : '');
}

/* ---- the patch: a live handoff changed in place, keeping its id ---- */

/* each op's own fields; verifyFirst's are the repo entry, checked by each side */
const OP_FIELDS = Object.freeze({ state: ['heading', 'text'], whereWeWere: ['line'], waitingOnUser: ['add', 'drop'], verifyFirst: null });
export const UPDATE_OPS = Object.freeze(Object.keys(OP_FIELDS));
export const OPS_HINT = '{ op: "state", heading: "## ...", text }, { op: "whereWeWere", line }, { op: "waitingOnUser", add or drop }, { op: "verifyFirst", path }';
/* A handoff's waiting lines; [] when none. */
export function waitingOf(f) {
  const w = f ? f.waitingOnUser : undefined;
  return Array.isArray(w) ? w : [];
}
const SECTION = /^## /;

/* a name the tools do not take is most often a session whose tool list is from an
   older AskerDo than the installed one (no refusing path knows the session's own version).
   `before`, the release that stopped sending the name, says the caller is older than that. */
export function staleToolsLine(installed, before) {
  if (before) {
    return 'that name comes from an AskerDo older than ' + before + (installed ? ', and the board runs ' + installed : '')
      + ': update AskerDo on this PC (claude plugin update askerdo@askerdo) and start a new session';
  }
  return 'a name ' + (installed ? 'AskerDo ' + installed : 'AskerDo') + ' does not take usually means this session began before an update'
    + ' and keeps the older tool names: start a new session, which takes the installed tools';
}

/* The ops' shape, as sentences; [] when they pass. `max`: { line } */
export function opsProblems(ops, max) {
  if (!Array.isArray(ops) || !ops.length) return ['ops is a list of one or more changes: ' + OPS_HINT];
  const e = [];
  let unknown = false;
  ops.forEach((o, i) => {
    const at = 'ops[' + i + ']';
    if (!o || typeof o !== 'object' || Array.isArray(o)) { e.push(at + ' is an object: ' + OPS_HINT); return; }
    if (typeof o.op !== 'string' || !Object.hasOwn(OP_FIELDS, o.op)) { if (typeof o.op === 'string') unknown = true; e.push(at + '.op is one of ' + UPDATE_OPS.join(', ')); return; }
    const { op } = o;
    const fields = OP_FIELDS[op];
    if (fields) for (const k of Object.keys(o)) if (k !== 'op' && !fields.includes(k)) { unknown = true; e.push(at + ' (' + o.op + ') has unknown field "' + k + '"'); }
    if (op === 'state') {
      if (!oneLine(o.heading) || !SECTION.test(o.heading.trim()) || o.heading.trim().length > max.line) e.push(at + '.heading is one line starting "## ", at most ' + max.line + ' characters');
      else if (flat(o.heading).toLowerCase() === WHERE_HEAD.toLowerCase()) e.push(at + ': that section is whereWeWere; add a line with op whereWeWere');
      if (!isText(o.text)) e.push(at + '.text is the section\'s body under its heading');
      else if (o.text.split(/\r?\n/).some((l) => SECTION.test(l))) e.push(at + '.text holds a "## " heading; each section is an op of its own');
    } else if (op === 'whereWeWere') {
      if (!oneLine(o.line)) e.push(at + '.line is one line, added to whereWeWere');
    } else if (op === 'waitingOnUser') {
      if ((o.add === undefined) === (o.drop === undefined)) e.push(at + ' names one of add and drop');
      const l = o.add !== undefined ? o.add : o.drop;
      if (l !== undefined && (!oneLine(l) || l.trim().length > max.line)) e.push(at + '.' + (o.add !== undefined ? 'add' : 'drop') + ' is one line of at most ' + max.line);
    } else if (!isText(o.path)) e.push(at + '.path is required: the repo directory');
  });
  if (unknown) e.push(staleToolsLine(max.installed));
  return e;
}

const headKey = (h) => flat(h).toLowerCase();
const samePath = (a, b) => String(a).replace(/\\/g, '/').replace(/(.)\/+$/, '$1').toLowerCase() === String(b).replace(/\\/g, '/').replace(/(.)\/+$/, '$1').toLowerCase();

/* A section is a "## " heading and what follows it up to the next: one already
   there is replaced, a new one appended. */
export function patchSection(state, heading, text) {
  const lines = String(state || '').split(/\r?\n/);
  const want = headKey(heading);
  const start = lines.findIndex((l) => SECTION.test(l) && headKey(l) === want);
  const block = [heading.trim(), ...String(text).replace(/^\s*\n/, '').replace(/\s+$/, '').split(/\r?\n/)];
  if (start < 0) {
    const base = String(state || '').replace(/\s+$/, '');
    return { state: (base ? base + '\n\n' : '') + block.join('\n'), replaced: false };
  }
  let end = start + 1;
  while (end < lines.length && !SECTION.test(lines[end])) end++;
  const tail = lines.slice(end);
  return { state: [...lines.slice(0, start), ...block, ...(tail.length ? ['', ...tail] : [])].join('\n'), replaced: true };
}

/* The ops on a handoff's text: { state, whereWeWere, waitingOnUser, verify,
   changes (per field, what moved), problems (a line to drop that is not there) }.
   A verifyFirst op is the repo's entry as the caller's side stores it. */
export function applyOps(h, ops) {
  let state = String(h.state || '');
  let where = String(h.whereWeWere || '');
  const waiting = [...waitingOf(h)];
  const verify = (h.verify || []).map((v) => ({ ...v }));
  const said = { state: [], whereWeWere: [], waitingOnUser: [], verifyFirst: [] };
  const problems = [];
  for (const o of ops) {
    const { op } = o;
    if (op === 'state') {
      const r = patchSection(state, o.heading, o.text);
      state = r.state;
      said.state.push((r.replaced ? 'replaced ' : 'added ') + flat(o.heading));
    } else if (op === 'whereWeWere') {
      const base = where.replace(/\s+$/, '');
      /* trimmed at the end only: the PC's guard on a "#" line is a leading space */
      where = (base ? base + '\n' : '') + o.line.replace(/\s+$/, '');
      said.whereWeWere.push('a line added');
    } else if (op === 'waitingOnUser') {
      const l = flat(o.add !== undefined ? o.add : o.drop);
      const i = waiting.findIndex((w) => flat(w) === l);
      if (o.add !== undefined) {
        if (i < 0) { waiting.push(l); said.waitingOnUser.push('added "' + l + '"'); }
      } else if (i < 0) {
        problems.push('waitingOnUser has no line "' + l + '"' + (waiting.length ? '; its lines: ' + waiting.map((w) => '"' + flat(w) + '"').join(', ') : '; it is empty'));
      } else { waiting.splice(i, 1); said.waitingOnUser.push('dropped "' + l + '"'); }
    } else if (op === 'verifyFirst') {
      const entry = { ...o };
      delete entry.op;
      const i = verify.findIndex((v) => samePath(v.path, entry.path));
      if (i < 0) verify.push(entry); else verify[i] = entry;
      said.verifyFirst.push((i < 0 ? 'added ' : 'refreshed ') + entry.path);
    }
  }
  const changes = {};
  for (const [k, v] of Object.entries(said)) if (v.length) changes[k] = v.join(', ');
  return { state, whereWeWere: where, waitingOnUser: waiting, verify, changes, problems };
}
