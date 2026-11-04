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
export const RUN_BY_HINT = 'orchestrator, fork, or agent:<model> such as agent:opus or agent:sonnet';
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

/* The inbox and the three ways to place each item, said alike by the kickoff, track finish
   and handoff write, the mod's results too; an empty inbox says nothing. */
export function inboxLines(inbox, cli = CLI) {
  if (!inbox || !inbox.length) return [];
  return ['Inbox (' + inbox.length + '): ' + listWords(inbox, (t) => t.id + ' ' + flat(t.name) + ' (' + t.workstream.id + ' ' + flat(t.workstream.name) + ')') + '.',
    'Place each: put it on a track (`' + cli + ' track capture --track <TR-n> --task <T-n>`), move it to the workstream it belongs in (`'
      + cli + ' task edit <T-n> --workstream <WS-n>`), or ask the user.'];
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
