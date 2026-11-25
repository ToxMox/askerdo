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

/* where the wrap cuts a long line, and what it passes whole (a fenced line or a fence,
   a table row, a line with no space to cut at), shared so the board refuses only what the wrap cuts */
export const LEAD = /^(\s*)(?:(?:[-*+]|\d+[.)])\s+)?/;
export const isFence = (line) => /^(```|~~~)/.test(line.trim());
export function cutAt(s, from, max) {
  for (let i = Math.min(max, s.length - 1) - 1; i > from; i--) if (/[.;:,!?]/.test(s[i]) && s[i + 1] === ' ') return [i + 1, i + 2];
  for (let i = Math.min(max, s.length - 1); i > from; i--) if (s[i] === ' ') return [i, i + 1];
  return null;
}
/* `fenced`: the line sits inside a fence, counting its own fence line */
export const passesWhole = (line, fenced, max) => fenced || isFence(line) || line.trim().startsWith('|') || !cutAt(line, LEAD.exec(line)[0].length, max);

/* the lines over `max` the wrap would cut, [[number from 1, line]] */
export function cutLines(text, max) {
  let fenced = false;
  const out = [];
  String(text).trim().split(/\r?\n/).forEach((l, i) => {
    if (isFence(l)) fenced = !fenced;
    if (l.length > max && !passesWhole(l, fenced, max)) out.push([i + 1, l]);
  });
  return out;
}

/* The state's own checks past "is it text": its budget, its line length, no
   whereWeWere heading, no order in prose. `max`: { state, line }; `held`: long lines
   already stored, which a patch only moves, so they are not refused again */
export function stateProblems(state, max, held) {
  const s = String(state).trim();
  const e = [];
  const n = bytes(s);
  if (n > max.state) e.push('state is ' + n + ' bytes; the budget is ' + max.state + ' (10 KB)');
  const lines = s.split(/\r?\n/);
  const long = cutLines(s, max.line).filter(([, l]) => !(held && held.has(l))).map(([i, l]) => [i, l.length]);
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

/* A closed task's note naming where its leftovers went; a step's own description or a moved
   task carries no mark of the close, so the sweep reads this note to pass a close as filed. */
export const leftAtClose = (items) => 'Left ' + items.join(', ') + ' as it closed.';
export const LEFT_AT_CLOSE = /(?:^|: )Left T-\d+\b[^\n]* as it closed\./m;

/* Work a note hands to another task by name ("left for T-n", "handed to T-n", "rides T-n"):
   each such sentence with the ids it names, [{ ids, sentence }]. */
const ROUTED = /\b(?:left for|handed (?:on )?to|rides)\s+(T-\d+)\b/gi;
export function routedTo(text) {
  const out = [];
  for (const raw of String(text ?? '').split(/(?<=[.!?])\s+|\n+/)) {
    const sentence = raw.trim();
    const ids = [...new Set([...sentence.matchAll(ROUTED)].map((m) => m[1].toUpperCase()))];
    if (ids.length) out.push({ ids, sentence });
  }
  return out;
}
/* a copied sentence's lead, so a copy is never copied again */
export const copiedFrom = (id, sentence) => 'From ' + id + ': ' + sentence;

export const CLI = 'node ~/.claude/askerdo/cli.mjs';

/* A decision as a task's block names it: a confirmed statement by its title alone, else with
   the user's words; and a task's intent and decisions as coverage and a review's block print them. */
const clip = (s, max) => (s.length > max ? s.slice(0, max - 3).trimEnd() + '...' : s);
export const decisionWords = (d) => d.id + ' ' + flat(d.name).replace(/[.\s]+$/, '') + (d.words && d.confirmed !== true ? ': "' + clip(flat(d.words), 300) + '"' : '');
/* A ruling's body under its line: the first sentence and each amend, one line each. */
export const bodyLines = (d, indent = '  ') => [...(d.gist ? [indent + 'body: ' + d.gist] : []), ...(Array.isArray(d.amends) ? d.amends.map((a) => indent + a) : [])];
export function aimLines(a, indent = '  ') {
  return [indent + 'intent: ' + (a.intent ? clip(flat(a.intent), 300) : 'none written'),
    ...(Array.isArray(a.decisions) && a.decisions.length ? [indent + 'decisions: ' + a.decisions.map(decisionWords).join('; ')] : [])];
}
/* a list a kickoff or a result names in one line, past this counted */
export const LIST_MAX = 10;
export const listWords = (items, word) => items.slice(0, LIST_MAX).map(word).join('; ')
  + (items.length > LIST_MAX ? '; and ' + (items.length - LIST_MAX) + ' more' : '');

/* a track's open tasks nothing waits on, its longest chain's end aside: each an
   end on purpose or a missing edge, so the session says which. It asks, never refuses.
   `cli`: the launcher the session runs, a sandbox's own rather than the live one. */
/* `written`: the handoff write's answer, whose write let the track go, so the place call waits for the next resume */
export function leavesLine(leaves, track, cli = CLI, written = false) {
  if (!Array.isArray(leaves) || !leaves.length) return '';
  const one = leaves.length === 1;
  return 'Nothing waits on ' + (one ? 'this open task' : 'these ' + leaves.length + ' open tasks') + ' of ' + track
    + ', and its longest chain ends elsewhere: ' + listWords(leaves, (t) => t.id + ' ' + flat(t.name))
    + '. Wire ' + (one ? 'it' : 'each') + ' to the task that needs it (`' + cli + ' edge add <the later task> <this one> --reason "<why>"`), or, as a last resort when nothing on '
    + track + ' needs it sooner, place it last, before the track\'s closing review' + (written ? ', once the next session resumes ' + track : '') + ' (`' + cli + ' task edit '
    + (one ? leaves[0].id : '<T-n>') + ' --tier 2 --last "<why nothing needs it sooner>" --session <own-id>`).';
}

/* The board's call for one listed item (found.mjs withOffers): its wake, unplaced reason, description's
   first line and each offer as the command that sends it, on a line of its own below the list, since an
   Inbox line's items keep the form lib/mod-core.mjs closedInbox parses. */
const clipTo = (s, max) => { const t = flat(s); return t.length > max ? t.slice(0, max - 3).trimEnd() + '...' : t; };
export function offerLine(t, cli = CLI) {
  const parts = [];
  if (t.due) parts.push('due' + (t.wake ? ' (its wake: ' + flat(t.wake) + ')' : ''));
  else if (t.wake) parts.push('wakes ' + flat(t.wake));
  if (t.reason) parts.push('unplaced: ' + clipTo(t.reason, 200));
  if (t.line) parts.push('"' + clipTo(t.line, 200) + '"');
  const calls = (Array.isArray(t.offers) ? t.offers : []).map((o) => (o.call === 'ask' ? 'ask the user (ask, with gates ' + t.id + ')'
    : o.call === 'place' ? '`' + cli + ' task edit ' + t.id + ' ' + o.flags + ' --session <own-id>`' + (o.last ? ' (a last resort)' : '') + (o.hint ? ' (' + o.hint.track + ' ' + clipTo(o.hint.name, 60) + ')' : '') : o.call));
  return '- ' + t.id + ' ' + clipTo(t.name, 80) + (parts.length ? ': ' + parts.join('; ') : '') + (calls.length ? ". The board's call: " + calls.join(', or ') : '') + '.';
}
export const offerLines = (items, cli = CLI) => (Array.isArray(items) ? items : []).filter((t) => t && Array.isArray(t.offers)).slice(0, LIST_MAX).map((t) => offerLine(t, cli));

/* a track's review readout in one line, for the kickoff and the handoff:
   due names the count and the tasks, not due one quiet count, none nothing; then the
   reviews the board's old reopen left open, for the session to close.
   `lay` false, a reader of a track it does not hold: the readout, with no step asked for. */
export function reviewLine(review, track, opts = {}) {
  const left = review && Array.isArray(review.leftOpen) ? review.leftOpen : [];
  const close = left.length ? 'Reopened by the board before reviews stayed completed, with nothing new to read: '
    + listWords(left, (t) => t.id + ' ' + flat(t.name)) + (opts.lay === false ? '.' : '; close ' + (left.length === 1 ? 'it' : 'each') + ' with `'
    + (opts.cli || CLI) + ' task edit ' + left[0].id + ' --status done --session <own-id>`.') : '';
  return [uncoveredLine(review, track, opts), close].filter(Boolean).join(' ');
}

function uncoveredLine(review, track, { before = null, cli = CLI, lay = true } = {}) {
  if (!review || !Array.isArray(review.uncovered) || !review.uncovered.length) return '';
  const n = review.uncovered.length;
  const tasks = n + ' finished code task' + (n === 1 ? '' : 's');
  const ids = listWords(review.uncovered, (t) => t.id + ' ' + flat(t.name));
  if (review.due) {
    const head = 'Review due on ' + track + ': ' + tasks + ' no review read (' + ids + '), ' + review.lines + ' counted lines. ';
    const locked = review.locked ? ', and the track finishes only after one.' : '.';
    /* running reviews whose lists hold some are named; a step is planned or laid out only for the rest */
    const reading = Array.isArray(review.reading) ? review.reading : [];
    const read = new Set(reading.flatMap((r) => r.tasks));
    const rest = review.uncovered.filter((t) => !read.has(t.id));
    const them = reading.length ? (rest.length === 1 ? 'the other' : 'the others') + ' (' + rest.map((t) => t.id).join(', ') + ')' : 'them';
    const now = reading.length ? listWords(reading, (r) => r.id + ' is reading ' + r.tasks.join(', ')) + '; ' : '';
    if (!rest.length) return head + now + (reading.length === 1 ? 'it covers them when it completes' : 'they cover them as each completes') + locked;
    if (review.planned) return head + now + review.planned + ' covers ' + them + ' when it completes' + locked;
    if (!lay) return (head + now.replace(/; $/, '. ') + (review.locked ? 'The track finishes only after one.' : '')).trim();
    /* the step itself, so accepting it is one call in the turn it is reported */
    return head + now + (now ? 'lay' : 'Lay') + ' the review step out now, which covers ' + them + ' when it completes' + locked + ' Run: `' + reviewStepCommand(rest, track, before, cli) + '`';
  }
  return 'Unreviewed on ' + track + ': ' + tasks + ' (' + ids + '); a review is due at ' + review.size
    + (review.locked ? ', and the track finishes only after one.' : '.');
}

/* One review step after the uncovered tasks and before the track's next checkpoint, run as printed: with no --session
   it files as the shell's own session, in Bash and PowerShell alike. */
export function reviewStepCommand(uncovered, track, before, cli = CLI) {
  const all = uncovered.map((t) => t.id);
  const named = all.length > 5 ? all.slice(0, 5).join(', ') + ' and ' + (all.length - 5) + ' more' : all.slice(0, -1).join(', ') + (all.length > 1 ? ' and ' : '') + all.at(-1);
  const step = { name: 'Review ' + named, reviewScope: 'track', after: all, ...(before ? { before: [before] } : {}), runBy: 'agent:opus' };
  return "echo '" + JSON.stringify({ steps: [step] }) + "' | " + cli + ' track layout ' + track;
}

/* the user's own captures wake 14 days out; a task stored with no wake reads so too */
export const WAKE_DAYS = 14;
export const WAKE_FORMS = 'track-ends TR-n | task-completes T-n | question-answered Q-n | YYYY-MM-DD';
/* the one wake that keeps a task on its track: it waits for a session other than its filer to take the track */
export const NEXT_WAKE = 'next-session';
const pad2 = (n) => String(n).padStart(2, '0');
export function wakeIn(days = WAKE_DAYS, now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

/* the one refusal an inbox filing meets, whatever it lacks: the cause, the inbox's rule, and both
   ways out as commands. `via`: create, capture, edit (a task id), or finish and drop (a track id). */
export function inboxRefusal({ cause, via = 'create', task, track, workstream, hint, tier } = {}, cli = CLI) {
  const ws = workstream || 'WS-n';
  const forms = '<' + WAKE_FORMS + '>';
  /* a filing that named its tier gets only the cause here: the ladder's calls ride as offers (tracks.mjs inboxWays) */
  if (tier !== undefined) return cause + '. The inbox holds only work no plan reaches yet, and each inbox task names the event that brings it back';
  /* a closing task's leftover: the ways out are the step's own fields */
  if (via === 'leftover') {
    return cause + '. The inbox holds only work no plan reaches yet, and each inbox task names the event that brings it back.'
      + (track ? ' Leave out unplaced and wake and the step goes on ' + track + ' (with wake ' + NEXT_WAKE + ' alone it waits there for the next session); work' : ' Work') + ' that starts later names newTrack and unparkWhen in their place,'
      + ' and goes on a new track parked until that event. Or keep unplaced and give it its wake (' + WAKE_FORMS + ').';
  }
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

const WAKE_AGAIN = (cli) => '`' + cli + ' task edit <T-n> --wake <event or YYYY-MM-DD> --session <own-id>`';
/* rows from a board that offers no call get the ladder's forms */
const callsWord = (owed, cli, where = 'below') => (owed.some((t) => Array.isArray(t.offers)) ? "by the board's call " + where
  : 'by the ladder (`' + cli + ' task edit <T-n> --tier 2 --before <the task that needs it> --session <own-id>`, or --tier 2 --last "<why nothing on the track needs it sooner>" as a last resort,'
    + ' or --tier 3 --track <TR-n>, or --tier 4 --workstream <WS-n> --track <TR-n>)');

/* The inbox and what each item owes, said alike by the kickoff, track finish and handoff write,
   the mod's results too; an empty inbox says nothing. Only a due task owes a placement,
   a new wake or a question; one whose wake has not come is listed and owes nothing.
   `ws`: the track's workstream (an id or its head), whose due tasks the close owes.
   `opts.calls` false leaves out the per-item calls (the kickoff's due line already printed them). */
export function inboxLines(inbox, cli = CLI, ws, { calls = true } = {}) {
  if (!inbox || !inbox.length) return [];
  const { owed, away } = dueSplit(inbox, ws);
  const tag = (t) => (t.due ? ', due' : t.wake ? ', wakes ' + flat(t.wake) : '') + askedTag(t);
  return ['Inbox (' + inbox.length + '): ' + listWords(inbox, (t) => t.id + ' ' + flat(t.name) + ' (' + t.workstream.id + ' ' + flat(t.workstream.name) + tag(t) + ')') + '.',
    'Place each: ' + (owed.length
      ? 'due here: ' + listWords(owed, (t) => t.id) + '; before this turn ends place ' + each(owed) + ' ' + callsWord(owed, cli, calls ? 'below' : 'under the due line') + ', wake ' + each(owed) + ' again ('
        + WAKE_AGAIN(cli) + '), or ask the user, since naming a due task does not settle it; a task not yet due owes nothing, its wake brings it back'
      : 'none is due here, so none owes anything now; each comes back at its wake')
      + (away.length ? '. ' + awayWords(away) : '') + '.',
    ...(calls ? offerLines(owed, cli) : [])];
}

/* the due inbox tasks lead the kickoff, with the place command; every
   kickoff on the project (the inbox projectInbox reads), each naming its workstream and any open question.
   `ws`: the kickoff's workstream; another's due task is only named, as the inbox line says. */
export function dueLine(inbox, cli = CLI, ws) {
  const due = (Array.isArray(inbox) ? inbox : []).filter((t) => t && t.due);
  if (!due.length) return '';
  const { owed, away } = dueSplit(due, ws);
  const which = owed.length === due.length ? 'each' : listWords(owed, (t) => t.id);
  return ['Due for a home (' + due.length + '): ' + listWords(due, (t) => t.id + ' ' + flat(t.name) + ' (' + (t.workstream && t.workstream.id ? t.workstream.id + ', ' : '')
    + 'its wake: ' + flat(t.wake) + askedTag(t) + ')') + '.'
    + (owed.length ? ' Place ' + which + ' ' + callsWord(owed, cli) + ', wake ' + each(owed) + ' again (' + WAKE_AGAIN(cli)
      + '), or ask the user; a third wake in one inbox stay goes to the user as a question.' : '')
    + (away.length ? ' ' + awayWords(away) + '.' : '')
    + (due.some((t) => t.asked) ? ' One with the user waits on its answer: act on it once it comes.' : ''),
  ...offerLines(owed, cli)].join('\n');
}

/* ---- the patch: a live handoff changed in place, keeping its id ---- */

/* each op's own fields; verifyFirst's are the repo entry, checked by each side */
const OP_FIELDS = Object.freeze({ focus: ['text'], state: ['heading', 'text'], whereWeWere: ['line', 'text'], waitingOnUser: ['add', 'drop'], verifyFirst: null, nextPc: ['pc'] });
export const UPDATE_OPS = Object.freeze(Object.keys(OP_FIELDS));
export const OPS_HINT = '{ op: "focus", text }, { op: "state", heading: "## ...", text }, { op: "whereWeWere", line or text }, { op: "waitingOnUser", add or drop }, { op: "verifyFirst", path }, { op: "nextPc", pc }';
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

/* The ops' shape, as sentences; [] when they pass. `max`: { line, focus } */
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
    if (op === 'focus') {
      /* the patch that brings a long focus under its budget */
      if (!oneLine(o.text) || o.text.trim().length > max.focus) e.push(at + '.text is the focus, one line of at most ' + max.focus + ' characters');
    } else if (op === 'state') {
      if (!oneLine(o.heading) || !SECTION.test(o.heading.trim()) || o.heading.trim().length > max.line) e.push(at + '.heading is one line starting "## ", at most ' + max.line + ' characters');
      else if (flat(o.heading).toLowerCase() === WHERE_HEAD.toLowerCase()) e.push(at + ': that section is whereWeWere; add a line with op whereWeWere');
      if (!isText(o.text)) e.push(at + '.text is the section\'s body under its heading');
      else if (o.text.split(/\r?\n/).some((l) => SECTION.test(l))) e.push(at + '.text holds a "## " heading; each section is an op of its own');
    } else if (op === 'whereWeWere') {
      /* text replaces it whole, so a long one is shortened without a new handoff */
      if ((o.line === undefined) === (o.text === undefined)) e.push(at + ' names one of line (added) and text (replaces whereWeWere)');
      else if (o.line !== undefined && !oneLine(o.line)) e.push(at + '.line is one line, added to whereWeWere');
      else if (o.text !== undefined && !isText(o.text)) e.push(at + '.text is whereWeWere in your own words, replacing it');
    } else if (op === 'waitingOnUser') {
      if ((o.add === undefined) === (o.drop === undefined)) e.push(at + ' names one of add and drop');
      const l = o.add !== undefined ? o.add : o.drop;
      if (l !== undefined && (!oneLine(l) || l.trim().length > max.line)) e.push(at + '.' + (o.add !== undefined ? 'add' : 'drop') + ' is one line of at most ' + max.line);
    } else if (op === 'nextPc') {
      /* '' clears it */
      if (typeof o.pc !== 'string' || /[\r\n]/.test(o.pc) || o.pc.trim().length > 100) e.push(at + '.pc is the board\'s device name of the PC the next leg runs on, or "" to clear it');
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

/* The ops on a handoff's text: { focus, state, whereWeWere, waitingOnUser, verify,
   changes (per field, what moved), problems (a line to drop that is not there) }.
   A verifyFirst op is the repo's entry as the caller's side stores it. */
export function applyOps(h, ops) {
  let focus = String(h.focus || '');
  let state = String(h.state || '');
  let where = String(h.whereWeWere || '');
  const waiting = [...waitingOf(h)];
  const verify = (h.verify || []).map((v) => ({ ...v }));
  const said = { focus: [], state: [], whereWeWere: [], waitingOnUser: [], verifyFirst: [], nextPc: [] };
  const problems = [];
  for (const o of ops) {
    const { op } = o;
    if (op === 'focus') {
      focus = o.text.trim();
      said.focus.push('replaced');
    } else if (op === 'state') {
      const r = patchSection(state, o.heading, o.text);
      state = r.state;
      said.state.push((r.replaced ? 'replaced ' : 'added ') + flat(o.heading));
    } else if (op === 'whereWeWere' && o.text !== undefined) {
      where = o.text.replace(/\s+$/, '');
      said.whereWeWere.push('replaced');
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
    } else if (op === 'nextPc') said.nextPc.push(o.pc.trim() ? 'set to ' + o.pc.trim() : 'cleared');
  }
  const changes = {};
  for (const [k, v] of Object.entries(said)) if (v.length) changes[k] = v.join(', ');
  return { focus, state, whereWeWere: where, waitingOnUser: waiting, verify, changes, problems };
}

/* A handoff's runs whose branch sits only on one PC. Each run of the write's result carries
   `remote` from the PC's check: 'pushed', 'unpushed' (not on the remote as that PC last saw it) or
   'unchecked' (its repo is not on that PC, or git failed). '' when nothing is left to say. */
export function unpushedLine(runs) {
  const list = Array.isArray(runs) ? runs : [];
  const words = (r) => 'run ' + r.run + ' (' + (r.worker === 'agent' ? 'agent ' + (r.job || 'with no job name') : 'this session') + ', branch ' + r.branch
    + (r.repo ? ' in ' + r.repo : '') + (r.remote === 'unchecked' && r.pc ? ', on ' + r.pc : '') + ')';
  const off = list.filter((r) => r.remote === 'unpushed');
  const unknown = list.filter((r) => r.remote === 'unchecked');
  const parts = [];
  if (off.length) parts.push('Not on the remote, as this PC last saw it: ' + off.map(words).join('; ') + '. Push each branch, or say in the handoff why it waits, since the next leg may run on another PC.');
  if (unknown.length) parts.push('Not checked here for the remote: ' + unknown.map(words).join('; ') + '.');
  return parts.join(' ');
}
