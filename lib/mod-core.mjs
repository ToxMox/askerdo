/* The mod's pure half: validation, argument parsing and the
 * text the commands answer. No host access and no import but the pure handoff
 * check, the board's pure drawing, the left-undone matcher and the command splitter,
 * so the hooks module (no Node) and node --test load the same files. */
import { FOCUS_MAX, LINE_MAX, STATE_BYTES, WHERE_BYTES, handoffProblems, isAbsolutePath, staleToolsLine, stepProblems, wrapHandoff } from './handoff-payload.mjs';
import { HOLD_WORDS, PORTAL_ICON, wakeText, wordWords } from '../server/web/draw.mjs';
import { graphOf, shortName, viewLook, viewNameOf } from '../server/web/graph.mjs';
import { pictureOf, sinceLook } from '../server/web/picture-model.mjs';
import { crumbs as pictureCrumbs, detail, drawPicture, legend as pictureLegend, pressView, sinceWords } from '../server/web/picture-draw.mjs';
import { MONTHS, atWords, cardHref, dayLabel, recordHref, signedRoot, feedEntry, feedMatches, feedRows, holderWords } from '../server/web/feed.mjs';
import { leftUndone } from './left-undone.mjs';
import { commandsOf } from './proc-match.mjs';
import { senderWords } from './sender-words.mjs';

export { FOCUS_MAX, LINE_MAX, STATE_BYTES, WHERE_BYTES, isAbsolutePath };
export const DEPTH_MARKER = { soft: 350000, hard: 450000, remind: 25000 };
/* the statuses a task stores; in progress is the board's word for an open run, never sent */
export const TASK_STATUSES = ['open', 'dropped', 'done'];
export const PRIORITIES = ['high', 'medium', 'low'];

const RECORD_ID = /^(Q\d+|WS-\d+|P-\d+|T-\d+|TH-\d+|TR-\d+|K-\d+)$/;

export const isRecordId = (s) => typeof s === 'string' && RECORD_ID.test(s);
export const isTrackId = (s) => typeof s === 'string' && /^TR-\d+$/.test(s);

/* the desktop's wrap breaks after a hyphen, so an id or a flag (--restart,
   --no-verify) gets a word joiner after each of its hyphens: zero width, no break */
const JOIN = String.fromCharCode(0x2060);
const ID_HYPHEN = /\b([A-Z]{1,3})-(?=\d)/g;
const FLAG_WORD = /(^|[\s(\[`"'])(--?[A-Za-z][\w-]*)/g;
/* an askerdo command in prose (askerdo join-code --device this-pc) holds each word whole up to
   the clause's end (, ; ` or . ? ! : before a space) or another program's name; only askerdo's CLI reads past the joiner */
const COMMAND_RUN = /(^|[\s(\[`"'])(askerdo +(?:(?!\s+(?:git|node|npm|npx|claude)(?![\w-]))(?:[^,;.?!:`]|[.?!:](?=\S)))*)/g;
const LOOSE_HYPHEN = new RegExp('-(?!' + JOIN + ')', 'g');
export function keepWhole(s) {
  if (typeof s !== 'string' || !s.includes('-')) return s;
  return s.replace(ID_HYPHEN, '$1-' + JOIN).replace(FLAG_WORD, (m, pre, flag) => pre + flag.replace(/-/g, '-' + JOIN))
    .replace(COMMAND_RUN, (m, pre, run) => pre + run.replace(LOOSE_HYPHEN, '-' + JOIN));
}

const isText = (v) => typeof v === 'string' && v.trim() !== '';
const oneLine = (v) => !/[\r\n]/.test(v);

/* The folder name the harness gives a project under ~/.claude/projects. */
export const projectSlug = (dir) => String(dir).replace(/[^A-Za-z0-9]/g, '-');

const ASK_KEYS = ['name', 'ask', 'gist', 'blocking', 'options', 'pick', 'workstream', 'track', 'gates', 'topic',
  'stakes', 'whileThisWaits', 'context', 'evidence', 'project', 'mission', 'crux', 'revisits', 'cites', 'reversal', 'edits'];

/* An option's text fields: the row's two columns, then the slots it unfolds into. */
export const OPTION_TEXT = ['getsYou', 'costsYou', 'headline', 'whyPick', 'whyNot', 'undo'];

/* register takes both columns as text, so an option without a catch goes on with an empty one */
export const withColumns = (options) => (Array.isArray(options)
  ? options.map((o) => (o && typeof o === 'object' ? { ...o, getsYou: o.getsYou ?? '', costsYou: o.costsYou ?? '' } : o)) : options);

/* The ask tool's payload, checked before the CLI sees it: the CLI would only
 * warn on a missing pick, and the model reads a refusal better than a warning. */
export function validateAsk(input) {
  const e = [];
  const p = input && typeof input === 'object' && !Array.isArray(input) ? input : null;
  if (!p) return { error: 'ask takes an object: name, ask, gist, blocking, options, pick' };
  for (const k of Object.keys(p)) if (!ASK_KEYS.includes(k)) e.push('unknown field "' + k + '"');
  if (!isText(p.name) || !oneLine(p.name)) e.push('name is required: a short one-line hook');
  /* the same shape the hub checks; the number is unknown until it registers */
  const ask = isText(p.ask) ? p.ask.replace(/\s*[\r\n]+\s*/g, ' ').trim() : '';
  if (!ask.endsWith('?') || ask.length > 400) {
    e.push('ask is required: one plain question ending in "?", at most 400 characters, that names the options'
      + ' inline by letter with the pick marked, like "(a, my pick)" and "(b)"; the question number is added at registration');
  }
  if (!isText(p.gist)) e.push('gist is required: why the question came up, as short lines, one fact each, a bold lead then the fact; never the ask again');
  if (typeof p.blocking !== 'boolean') e.push('blocking is required: true or false');
  const letters = [];
  if (p.options !== undefined) {
    if (!Array.isArray(p.options)) e.push('options is a list of { type, option, getsYou, costsYou }');
    else {
      p.options.forEach((o, i) => {
        const at = 'options[' + i + ']';
        if (!o || typeof o !== 'object') { e.push(at + ' is not an object'); return; }
        if (o.type !== '' && !(typeof o.type === 'string' && /^[a-z]$/.test(o.type))) {
          e.push(at + '.type must be one lowercase letter (a to z), or "" for a plain panel');
        } else if (o.type) {
          if (letters.includes(o.type)) e.push(at + '.type "' + o.type + '" is used twice');
          letters.push(o.type);
        }
        if (!isText(o.option)) e.push(at + '.option is required');
        for (const f of OPTION_TEXT) if (o[f] !== undefined && typeof o[f] !== 'string') e.push(at + '.' + f + ' must be text');
      });
    }
  }
  if (letters.length) {
    if (p.pick === undefined) e.push('pick is required with lettered options: the letter you recommend, or null for none on purpose');
    else if (p.pick !== null) {
      const m = typeof p.pick === 'string' ? p.pick.match(/^(?:\d+)?([a-z])$/) : null;
      if (!m || !letters.includes(m[1])) e.push('pick must name one of the options by its letter (' + letters.join(', ') + '), or be null');
    }
  } else if (p.pick !== undefined && p.pick !== null) e.push('pick names an option, and there are no lettered options');
  if (p.edits !== undefined && !(typeof p.edits === 'string' && /^[QL]\d+$/.test(p.edits))) e.push('edits is the Q-n (or the L-n of a kept question) of the open question this payload rewords');
  if (p.workstream !== undefined && !/^WS-\d+$/.test(p.workstream)) e.push('workstream is a WS-n id');
  if (p.track !== undefined && !isTrackId(p.track)) e.push('track is a TR-n id');
  if (p.gates !== undefined && !(Array.isArray(p.gates) && p.gates.every((g) => /^T-\d+$/.test(g)))) e.push('gates is a list of T-n ids');
  if (p.evidence !== undefined && !(Array.isArray(p.evidence) && p.evidence.every((x) => typeof x === 'string'))) e.push('evidence is a list of strings');
  /* a reopened ruling carries what changed; a mention is only cited */
  for (const f of ['revisits', 'cites']) {
    if (p[f] !== undefined && !(Array.isArray(p[f]) && p[f].every((x) => typeof x === 'string' && /^Q\d+$/.test(x)))) e.push(f + ' is a list of Q-n ids');
  }
  const reopens = Array.isArray(p.revisits) && p.revisits.length > 0;
  if (p.reversal !== undefined && typeof p.reversal !== 'string') e.push('reversal must be text');
  else if (reopens && !isText(p.reversal)) e.push('reversal is required with revisits: what changed since the ruling, in short lines');
  else if (!reopens && isText(p.reversal)) e.push('a reversal names the ruling it reopens in revisits');
  for (const f of ['topic', 'stakes', 'whileThisWaits', 'context', 'project', 'mission', 'crux']) {
    if (p[f] !== undefined && typeof p[f] !== 'string') e.push(f + ' must be text');
  }
  if (e.length) return { error: e.join('; ') };
  const payload = { ...p };
  if (typeof payload.pick === 'string') payload.pick = payload.pick.slice(-1);
  if (Array.isArray(payload.options)) payload.options = withColumns(payload.options);
  return { payload };
}

/* The composed answer token: `Q106` option b is `106b`. */
export const token = (id, letter) => String(id).replace(/^Q/, '') + letter;

/* the question's header in one fixed form, its id and name; it opens
   the pasted block, labels it on the phone and in exports, and is where the desktop cuts from. */
export const tellMarker = (id, name) => '❓ ' + id + (flatLine(name) ? ' (' + flatLine(name) + ')' : '');
const lettersOf = (q) => (Array.isArray(q && q.options) ? q.options : []).map((o) => o && o.type).filter((t) => /^[a-z]$/.test(t || ''));
/* the ask names its options by letter; the told line names them by token */
const tellAsk = (q, letters) => String((q && q.ask) || '').replace(/\((\s*)([a-z])(?=\s*[,)])/g, (m, sp, l) => (letters.includes(l) ? '(' + sp + token(q.id, l) : m));

/* the block a reply pastes, as rule 15 lays it out: the header, the reversal line,
   the question line with its tokens, the crux, and the table last. */
export function tellBlock(q, letters = lettersOf(q)) {
  const parts = [tellMarker(q.id, q.name)];
  const revisits = Array.isArray(q.revisits) ? q.revisits.filter(Boolean) : [];
  /* the register result's `reverses` names each ruling; without it the bare id */
  const named = (r) => { const v = (Array.isArray(q.reverses) ? q.reverses : []).find((x) => x && x.id === r); return v && flatLine(v.name) ? r + ' (' + flatLine(v.name) + ')' : r; };
  if (revisits.length) parts.push('**Reversal of ' + revisits.map(named).join(', ') + '**');
  if (flatLine(q.ask)) parts.push(flatLine(tellAsk(q, letters)));
  if (flatLine(q.crux)) parts.push(flatLine(q.crux));
  const opts = (Array.isArray(q.options) ? q.options : []).filter((o) => o && o.option);
  if (opts.length) {
    const row = (o) => '|' + (/^[a-z]$/.test(o.type || '') ? token(q.id, o.type) : cell(o.type)) + (o.type && q.pick === o.type ? ' *' : '')
      + '|' + cell(o.option) + '|' + cell(o.getsYou) + '|' + cell(catchOf(o.costsYou, o.undo)) + '|';
    parts.push(['|type|option|what happens|catch|', '|-|-|-|-|', ...opts.map(row)].join('\n'));
  }
  return parts.join('\n\n');
}
const pasteLine = (block) => (block ? '\nPaste this block in the reply\'s footer, under its label, exactly, once:\n\n' + block : '');

export function askResult(r, extra = {}) {
  const parts = ['Registered ' + r.id + ' (' + r.name + ')'];
  const where = [r.workstream, r.track].filter(Boolean);
  if (where.length) parts[0] += ' under ' + where.join(', ');
  if (extra.letters && extra.letters.length) {
    parts.push('answer tokens ' + extra.letters.map((l) => token(r.id, l)).join(', '));
  }
  if (extra.pick) parts.push('pick ' + token(r.id, extra.pick));
  if (r.gates && r.gates.length) parts.push('gates ' + r.gates.join(', '));
  let text = parts.join('; ') + '.';
  if (r.boardUrl) text += ' Board: ' + r.boardUrl;
  for (const w of r.warnings || []) text += '\nNote: ' + w;
  return text + pasteLine(extra.block);
}

/* the ask tool's `edits`: what was reworded, and that this reply tells it again in full. */
export function rewordResult(r, extra = {}) {
  const head = r.id + ' (' + flatLine(r.name) + ')';
  let text;
  if (!(r.reworded || []).length) text = head + ' unchanged: the payload matches its wording, so there is nothing to tell again.';
  else {
    const parts = ['Reworded ' + head + ' in place, keeping its id: ' + r.reworded.join(', ')];
    if (extra.letters && extra.letters.length) parts.push('answer tokens ' + extra.letters.map((l) => token(r.id, l)).join(', '));
    if (extra.pick) parts.push('pick ' + token(r.id, extra.pick));
    text = parts.join('; ') + '. Tell it again in full once in this reply: its card draws under this reply,'
      + ' and the card under the reply that first told it now says it changed.';
  }
  if (r.boardUrl) text += ' Board: ' + r.boardUrl;
  for (const w of r.warnings || []) text += '\nNote: ' + w;
  return text + ((r.reworded || []).length ? pasteLine(extra.block) : '');
}

/* a track's tasks carry where it stands, so the plan step and the task in hand are gone */
const HANDOFF_KEYS = ['track', 'workstream', 'askedInChat', 'focus', 'state', 'whereWeWere', 'verifyFirst', 'waitingOnUser', 'rulings', 'status', 'parkReason', 'leftovers', 'taskNotes', 'nextPc', 'goal'];
const VERIFY_KEYS = ['path', 'branch', 'worktree', 'commit', 'expectedDirty', 'ownedByOthers', 'files', 'worktrees'];
export const DISPOSITIONS = Object.freeze(['commit', 'ignore', 'delete', 'keep', 'undecided']);
const WORKTREE_DISPOSITIONS = ['remove', 'keep', 'undecided'];

/* The handoff budget is the CLI's own check (handoffProblems),
 * so tool and CLI refuse alike; the tool adds its keys, the track and status. */
/* `version`: the installed AskerDo's, named when a field is unknown */
export function validateHandoff(input, { version } = {}) {
  let p = input && typeof input === 'object' && !Array.isArray(input) ? input : null;
  if (!p) return { error: 'handoff_write takes an object: focus, state, verifyFirst' };
  const e = [];
  /* the user's ask in chat opens the gate and rides whereWeWere, so it stays visible */
  const said = typeof p.askedInChat === 'string' ? p.askedInChat.trim().replace(/^["“](.*)["”]$/s, '$1').trim() : '';
  if (p.askedInChat !== undefined && (!said || !oneLine(said) || said.length > 400)) e.push('askedInChat is ' + nameOf() + "'s words, quoted, one line of at most 400 characters");
  else if (said) {
    const line = capFirst(nameOf()) + ' asked for this handoff in chat: "' + said + '"';
    p = { ...p, whereWeWere: line + (isText(p.whereWeWere) ? '\n\n' + p.whereWeWere : '') };
  }
  const w = wrapHandoff(p);
  p = w.payload;
  for (const k of Object.keys(p)) if (!HANDOFF_KEYS.includes(k)) e.push('unknown field "' + k + '"');
  if (p.track !== undefined && !isTrackId(p.track)) e.push('track is a TR-n id');
  if (p.workstream !== undefined && !/^WS-\d+$/.test(p.workstream)) e.push('workstream is a WS-n id');
  e.push(...handoffProblems(p));
  /* each leg restates what the track is doing; the CLI's own check takes it as optional */
  if (p.goal === undefined) e.push('goal is required: what the track is doing now, in a sentence or two');
  if (Array.isArray(p.verifyFirst)) {
    p.verifyFirst.forEach((v, i) => {
      if (!v || typeof v !== 'object' || Array.isArray(v)) return;
      const at = 'verifyFirst[' + i + ']';
      for (const k of Object.keys(v)) if (!VERIFY_KEYS.includes(k)) e.push(at + ' has unknown field "' + k + '"');
      for (const f of ['expectedDirty', 'ownedByOthers']) {
        if (v[f] !== undefined && !(Array.isArray(v[f]) && v[f].every((x) => typeof x === 'string'))) e.push(at + '.' + f + ' is a list of paths');
      }
      /* the CLI checks the rest of each disposition */
      if (v.files !== undefined && !(Array.isArray(v.files) && v.files.every((f) => f && typeof f === 'object'
        && isText(f.path) && DISPOSITIONS.includes(f.disposition)))) {
        e.push(at + '.files is a list of { path, disposition }, disposition one of ' + DISPOSITIONS.join(', '));
      }
      if (v.worktrees !== undefined && !(Array.isArray(v.worktrees) && v.worktrees.every((w) => w && typeof w === 'object'
        && (isText(w.path) || isText(w.group)) && WORKTREE_DISPOSITIONS.includes(w.disposition)))) {
        e.push(at + '.worktrees is a list of { path or group, disposition }, disposition one of ' + WORKTREE_DISPOSITIONS.join(', '));
      }
    });
  }
  if (p.status !== undefined && p.status !== 'waiting' && p.status !== 'parked') e.push('status is waiting or parked');
  if (p.status === 'parked' && !isText(p.parkReason)) e.push('a parked handoff needs parkReason');
  if (p.parkReason !== undefined && p.status !== 'parked') e.push('parkReason goes with status parked');
  if (e.some((x) => x.includes('unknown field'))) e.push(staleToolsLine(version));
  if (e.length) return { error: e.join('; ') };
  const { track, workstream, askedInChat, ...payload } = p;
  return { track, workstream, payload, ...(said ? { asked: true } : {}), ...(w.wrapped ? { wrapped: w.wrapped } : {}) };
}

/* depthAtHandoff from $.session.usage(): nothing rather than a guess while the
 * window has reported no reading yet. */
export function depthFrom(usage) {
  const c = usage && usage.context;
  if (!c || typeof c.tokens !== 'number') return undefined;
  const d = { tokens: c.tokens };
  if (typeof c.percent === 'number') d.percent = wholePercent(c);
  return d;
}

/* review_covers and coverage as the CLI's words, so the tool refuses what the board would. */
export function reviewCoversArgs(input) {
  const p = input && typeof input === 'object' && !Array.isArray(input) ? input : null;
  if (!p) return { error: 'review_covers takes an object: review, and tasks or none' };
  const e = [];
  for (const k of Object.keys(p)) if (!['review', 'tasks', 'none'].includes(k)) e.push('unknown field "' + k + '"');
  if (!(typeof p.review === 'string' && /^T-\d+$/.test(p.review.trim()))) e.push('review is the review task\'s T-n id');
  if (p.tasks !== undefined && !(Array.isArray(p.tasks) && p.tasks.every((t) => typeof t === 'string' && /^T-\d+$/.test(t.trim())))) e.push('tasks is a list of T-n ids');
  if (p.none !== undefined && typeof p.none !== 'boolean') e.push('none is true or false');
  if (p.none && p.tasks && p.tasks.length) e.push('tasks or none, not both');
  if (e.length) return { error: e.join('; ') };
  return { args: ['review', 'covers', p.review.trim(), ...(p.tasks || []).map((t) => t.trim()), ...(p.none ? ['--none'] : [])] };
}
export function coverageArgs(input) {
  const p = input && typeof input === 'object' && !Array.isArray(input) ? input : null;
  if (!p) return { error: 'coverage takes an object: scope' };
  const e = [];
  for (const k of Object.keys(p)) if (!['scope', 'scan'].includes(k)) e.push('unknown field "' + k + '"');
  if (!(typeof p.scope === 'string' && /^(TR|WS)-\d+$/i.test(p.scope.trim()))) e.push('scope is a TR-n or WS-n id');
  if (p.scan !== undefined && typeof p.scan !== 'boolean') e.push('scan is true or false');
  if (e.length) return { error: e.join('; ') };
  return { args: ['coverage', p.scope.trim().toUpperCase(), ...(p.scan ? ['--scan'] : [])] };
}

/* the old status words, each refused with the call that fits, in the tool's fields or the CLI's flags; none is kept as an alias */
const OLD_STATUS = {
  in_progress: (f) => 'a start is ' + f.hand + ' or ' + f.agent,
  blocked: (f) => 'a task that waits stays open: ' + f.note + ' says on what, and a gate, an edge or a wake holds it',
  deferred: (f) => 'a task for later stays open: ' + f.note + ' says when, and a wake brings it back',
};
const STATUS_FIELDS = {
  tool: { hand: 'inHand true (this session works it)', agent: 'a dispatch naming it (its agent\'s run opens at the spawn)', note: 'a note' },
  cli: { hand: '--in-hand with --session (that session works it)', agent: 'a dispatch naming it (its agent\'s run opens at the spawn)', note: '--note' },
};
export function statusProblem(status, how = 'tool') {
  if (status === undefined || TASK_STATUSES.includes(status)) return '';
  const old = Object.hasOwn(OLD_STATUS, status) ? OLD_STATUS[status] : null;
  return (old ? 'status ' + status + ' is not stored: ' + old(STATUS_FIELDS[how]) + '; ' : '') + 'status is one of ' + TASK_STATUSES.join(', ');
}

/* task_update as `task update`'s flags, so the tool refuses what the board would. */
export function taskEditArgs(input) {
  const p = input && typeof input === 'object' && !Array.isArray(input) ? input : null;
  if (!p) return { error: 'task_update takes an object: id, and status, priority, name or note' };
  const e = [];
  const known = ['id', 'status', 'reason', 'priority', 'name', 'note', 'description', 'intent', 'addLabels', 'removeLabels', 'inHand', 'takeOver', 'leftovers', 'moveSteps', 'checks', 'runEnded'];
  for (const k of Object.keys(p)) if (!known.includes(k)) e.push('unknown field "' + k + '"');
  if (!(typeof p.id === 'string' && /^T-\d+$/.test(p.id))) e.push('id is a T-n id');
  if (statusProblem(p.status)) e.push(statusProblem(p.status));
  /* the session ends its own silent agent run on the task; the task stays open */
  if (p.runEnded !== undefined && !RUN_ENDED.includes(p.runEnded)) e.push('runEnded is ' + RUN_ENDED.join(' or '));
  if (p.runEnded !== undefined && p.status !== undefined) e.push('runEnded leaves the task open: settle or close it in its own call');
  if (p.reason !== undefined && !isText(p.reason)) e.push('reason is text');
  if (p.priority !== undefined && !PRIORITIES.includes(p.priority)) e.push('priority is one of ' + PRIORITIES.join(', '));
  if (p.name !== undefined && (!isText(p.name) || !oneLine(p.name))) e.push('name is one line of text');
  if (p.note !== undefined && !isText(p.note)) e.push('note is text');
  for (const f of ['addLabels', 'removeLabels']) {
    if (p[f] !== undefined && !(Array.isArray(p[f]) && p[f].every(isText))) e.push(f + ' is a list of labels');
  }
  if (p.inHand !== undefined && typeof p.inHand !== 'boolean') e.push('inHand is true or false');
  if (p.takeOver !== undefined && typeof p.takeOver !== 'boolean') e.push('takeOver is true or false');
  /* a take-over rides a take in hand or a close (done or dropped) */
  if (p.takeOver === true && p.inHand !== true && !['done', 'dropped'].includes(p.status)) e.push('takeOver goes with inHand true, or status done or dropped');
  /* a close's leftovers ride stdin, as handoff_write's do */
  const left = p.leftovers !== undefined && !(Array.isArray(p.leftovers) && !p.leftovers.length);
  if (left && !['done', 'dropped'].includes(p.status)) e.push('leftovers go with status done or dropped: the steps this close leaves');
  if (left) e.push(...stepProblems(p.leftovers, 'leftovers', true, true));
  /* a move rides stdin too, so it and a close's leftovers go in two calls; the board checks each destination */
  const moves = p.moveSteps !== undefined;
  if (moves) e.push(...moveProblems(p.moveSteps));
  if (moves && left) e.push('moveSteps and leftovers each ride stdin: move the steps first, then close with its leftovers');
  const args = [];
  /* true takes the task in hand for this session (it may hold several), false lets it go;
     one another session holds moves only with takeOver */
  if (p.inHand !== undefined) args.push(p.inHand ? '--in-hand' : '--let-go');
  if (p.takeOver === true) args.push('--take-over');
  if (p.status !== undefined) args.push('--status', p.status);
  if (p.reason !== undefined) args.push('--reason', p.reason);
  if (p.priority !== undefined) args.push('--priority', p.priority);
  if (p.name !== undefined) args.push('--name', p.name);
  for (const l of p.addLabels || []) args.push('--add-label', l);
  for (const l of p.removeLabels || []) args.push('--remove-label', l);
  if (p.note !== undefined && isText(p.note)) args.push('--note', p.note);
  for (const f of ['description', 'intent']) {
    if (p[f] === undefined) continue;
    if (!isText(p[f]) || !p[f].trim()) e.push(f + ' is text');
    else if (p.note === undefined) e.push(f + ' rides a note: the note says why the work changed');
    else args.push('--' + f, p[f]);
  }
  args.push(...checkArgs(p.checks, e));
  if (left) args.push('--leftovers');
  if (moves) args.push('--move-steps');
  if (!e.length && !args.length && p.runEnded === undefined) e.push('nothing to change: give status, priority, name, labels, inHand, checks, moveSteps, runEnded or a note');
  if (e.length) return { error: e.join('; ') };
  return { id: p.id, args, starts: p.inHand === true, ...(p.runEnded !== undefined ? { runEnded: p.runEnded } : {}),
    ...(left ? { stdin: JSON.stringify(p.leftovers) } : moves ? { stdin: JSON.stringify(p.moveSteps) } : {}) };
}

export const RUN_ENDED = ['handed_on', 'failed'];

/* each move names an open step and one destination: onto a task, a question, or the place fields of a new task */
function moveProblems(list) {
  if (!Array.isArray(list) || !list.length) return ['moveSteps is a list of { check, onto }, { check, question } or { check, runBy, tier, ...the place fields }'];
  const e = [];
  list.forEach((m, i) => {
    const at = 'moveSteps[' + i + ']: ';
    if (!m || typeof m !== 'object' || Array.isArray(m)) { e.push(at + 'is an object naming its check'); return; }
    if (!(Number.isInteger(m.check) && m.check >= 1)) e.push(at + 'check is an open step\'s number, 1 first');
    if (m.onto !== undefined && !(typeof m.onto === 'string' && /^T-\d+$/.test(m.onto.trim()))) e.push(at + 'onto is a T-n id');
    if (m.question !== undefined && !(typeof m.question === 'string' && /^Q-?\d+$/.test(m.question.trim()))) e.push(at + 'question is a Q-n id');
    if (m.onto === undefined && m.question === undefined && m.tier === undefined) e.push(at + 'names onto, question, or the tier and place fields of a new task');
    /* a move the board asks of the user names here, as stepProblems takes it */
    if (hereProblem(m.here)) e.push(at + hereProblem(m.here));
  });
  return e;
}

/* place as `task create` (new work, the payload on stdin) or `task edit` (a task with no home), so the
   tool refuses what the board would; runBy rides a second edit, since a create takes none. `work` names it for the turn-end pairing. */
const PLACE_KEYS = ['task', 'name', 'description', 'intent', 'priority', 'labels', 'runBy', 'tier', 'after', 'before', 'track', 'workstream', 'newTrack', 'unparkWhen', 'unplaced', 'wake', 'whyElsewhere', 'last', 'here', 'question', 'words'];
const isIds = (v) => Array.isArray(v) && v.every((t) => typeof t === 'string' && /^T-\d+$/.test(t.trim()));
/* `here` is the real place on the held track an asked filing would otherwise take */
const hereProblem = (h) => (h === undefined || (h && typeof h === 'object' && !Array.isArray(h) && Object.keys(h).every((k) => ['after', 'before'].includes(k))
  && ['after', 'before'].every((k) => h[k] === undefined || isIds(h[k]))) ? '' : 'here is { after, before }, each a list of T-n ids on the track this session holds');
const hereOf = (h) => Object.fromEntries(['after', 'before'].filter((k) => h[k] !== undefined).map((k) => [k, h[k].map((t) => t.trim())]));
export function placeArgs(input) {
  const p = input && typeof input === 'object' && !Array.isArray(input) ? input : null;
  if (!p) return { error: 'place takes an object: task, or name and description; tier and its answer' };
  const e = [];
  for (const k of Object.keys(p)) if (!PLACE_KEYS.includes(k)) e.push('unknown field "' + k + '"');
  const fresh = p.task === undefined;
  if (!fresh && !(typeof p.task === 'string' && /^T-\d+$/.test(p.task.trim()))) e.push('task is a T-n id');
  if (fresh && !(isText(p.name) && oneLine(p.name))) e.push('new work names itself: name, one line, with its description');
  if (fresh && !isText(p.description)) e.push('new work carries a description: what the next worker needs to start');
  if (!fresh) for (const k of ['name', 'description', 'intent', 'labels', 'runBy']) if (p[k] !== undefined) e.push(k + ' goes with new work; an existing task\'s words change through note');
  if (![2, 3, 4].includes(p.tier)) e.push('tier is 2, 3 or 4; work for a task\'s own worker is a step on that task (task_update checks) and what only the user can decide or do is a question (ask)');
  if (p.intent !== undefined && !isText(p.intent)) e.push('intent is text');
  if (p.priority !== undefined && !PRIORITIES.includes(p.priority)) e.push('priority is one of ' + PRIORITIES.join(', '));
  if (p.labels !== undefined && !(Array.isArray(p.labels) && p.labels.every(isText))) e.push('labels is a list of labels');
  if (p.runBy !== undefined && !isText(p.runBy)) e.push('runBy names who runs it');
  for (const f of ['after', 'before']) {
    if (p[f] !== undefined && !(Array.isArray(p[f]) && p[f].every((t) => typeof t === 'string' && /^T-\d+$/.test(t.trim())))) e.push(f + ' is a list of T-n ids');
  }
  if (p.track !== undefined && !(typeof p.track === 'string' && /^TR-\d+$/.test(p.track.trim()))) e.push('track is a TR-n id');
  if (p.workstream !== undefined && !(typeof p.workstream === 'string' && /^WS-\d+$/.test(p.workstream.trim()))) e.push('workstream is a WS-n id');
  for (const f of ['newTrack', 'unparkWhen', 'unplaced', 'wake', 'whyElsewhere', 'last']) if (p[f] !== undefined && !(isText(p[f]) && oneLine(p[f]))) e.push(f + ' is one line');
  if (p.last !== undefined && p.before !== undefined) e.push('before or last, not both: before names the real place, last asks the user to put it after everything else');
  if (hereProblem(p.here)) e.push(hereProblem(p.here));
  if (p.question !== undefined && !(typeof p.question === 'string' && /^Q-?\d+$/.test(p.question.trim()))) e.push('question is the Q-n whose talk settled this place');
  if (p.words !== undefined && !isText(p.words)) e.push('words are the user\'s settling words');
  if ((p.question === undefined) !== (p.words === undefined)) e.push('question and words go together: the placement question talked through and the user\'s words that settled it');
  if (e.length) return { error: e.join('; ') };
  const where = { tier: p.tier, ...Object.fromEntries(['track', 'workstream', 'newTrack', 'unparkWhen', 'unplaced', 'wake', 'whyElsewhere', 'last', 'question', 'words'].filter((k) => p[k] !== undefined).map((k) => [k, p[k].trim()])),
    ...Object.fromEntries(['after', 'before'].filter((k) => p[k] !== undefined).map((k) => [k, p[k].map((t) => t.trim())])),
    ...(p.here !== undefined ? { here: hereOf(p.here) } : {}) };
  if (fresh) {
    /* runBy rides the payload too: an asked filing keeps it in the question's draft */
    const payload = { name: p.name.trim(), description: p.description, ...(p.intent !== undefined ? { intent: p.intent } : {}), ...(p.priority ? { priority: p.priority } : {}),
      ...(p.labels ? { labels: p.labels } : {}), ...(p.runBy !== undefined ? { runBy: p.runBy.trim() } : {}), ...where };
    return { argv: ['task', 'create'], stdin: JSON.stringify(payload), tier: p.tier, work: p.name.trim(), ...(p.runBy !== undefined ? { runBy: p.runBy.trim() } : {}) };
  }
  const flag = { track: '--track', workstream: '--workstream', newTrack: '--new-track', unparkWhen: '--unpark-when', unplaced: '--unplaced', wake: '--wake', whyElsewhere: '--why-elsewhere', last: '--last',
    question: '--question', words: '--words' };
  const argv = ['task', 'edit', p.task.trim(), '--tier', String(p.tier)];
  for (const k of Object.keys(flag)) if (where[k] !== undefined) argv.push(flag[k], where[k]);
  for (const k of ['after', 'before']) for (const t of where[k] || []) argv.push('--' + k, t);
  for (const k of ['after', 'before']) for (const t of (where.here && where.here[k]) || []) argv.push('--here-' + k, t);
  if (p.priority) argv.push('--priority', p.priority);
  return { argv, tier: p.tier, work: p.task.trim() };
}

/* Where the ladder put it, as the CLI's ladderWords says it. */
export function placedWords(j) {
  const r = j || {};
  const at = r.track ? ' on ' + r.track + (r.parked ? ' (parked' + (r.unpark ? ', opens ' + r.unpark : '') + ')' : '')
    : r.unplaced || r.wake ? ' into the inbox' + (r.wake ? ', wakes ' + r.wake : '') : '';
  const head = (r.created === false || r.changed ? 'Placed ' : 'Filed ') + (r.id || 'it') + at + '.';
  if (r.tier === undefined) return head;
  const l = r.ladder || {};
  const flat = (s) => String(s).replace(/\s+/g, ' ').trim();
  return head + ' Tier ' + r.tier + (l.derived ? ' (derived from where it landed)' : '') + (l.where ? ': ' + flat(l.where) : '') + '.'
    + (l.filled && l.filled.length ? ' The board filled ' + l.filled.join(', ') + '.' : '')
    + (l.stations && l.stations.length ? ' Nearer stations: ' + l.stations.join(', ') + '.' : '')
    + (l.told ? ' A note on ' + l.told + ' tells its holder.' : '')
    + (Array.isArray(l.lookAlikes) && l.lookAlikes.length ? '\nOpen tasks sharing its words (one that covers it takes a note, and this one is dropped): '
      + l.lookAlikes.map((x) => x.id + ' ' + flat(x.name)).join('; ') + '.' : '');
}

/* The board's offer in the tool's own fields, never the CLI's flags; `step`: a leftover's or layout step's own fields. */
export function offerCall(o, step = false) {
  if (!o || typeof o !== 'object') return '';
  if (o.call === 'ask') return 'ask ' + nameOf() + ' (ask, with gates naming the task when one exists)';
  if (o.call === 'check') return 'a step on the task whose worker will do it, in hand or not (task_update checks.add, or moveSteps onto it)';
  if (o.call === 'fix') return 'fix it this turn and file nothing';
  if (o.call !== 'place') return '';
  /* last, off the track or for a later session is asked of the user, never free */
  const asked = o.last !== undefined || o.whyElsewhere !== undefined || o.wake !== undefined || o.unparkWhen !== undefined || [3, 4].includes(Number(o.tier));
  const h = o.here && typeof o.here === 'object' ? o.here : null;
  const here = h ? ', here { ' + ['after', 'before'].filter((k) => h[k] !== undefined).map((k) => k + ' [' + [].concat(h[k]).join(', ') + ']').join(', ') + ' }' : '';
  return (step || o.step ? 'tier ' : 'place with tier ') + o.tier + (o.track ? ', track ' + o.track : '') + (o.workstream ? ', workstream ' + o.workstream : '')
    + (o.unparkWhen ? ', unparkWhen "' + o.unparkWhen + '"' : '') + (o.wake ? ', wake "' + o.wake + '"' : '')
    + (o.before ? ', before [' + o.before + ']' : '') + (o.last ? ', last "' + o.last + '"' : '') + (o.whyElsewhere ? ', whyElsewhere "' + o.whyElsewhere + '"' : '') + here
    + (asked ? ' (this asks ' + nameOf() + ' first, with here naming the real place on your track; nothing is created until the press)' : '');
}

/* A refusal the board sent with its offer as data ({ refused, offer, offers } on stdout under --json), worded
   in the tool's fields: { deny, call }; null when it carried none (a refusal with no offer).
   `step`: the refusal is of a leftover, so each offer is that step's own fields. */
export function placeRefusal(stdout, what = 'place', step = false) {
  let j = null;
  try { j = JSON.parse(String(stdout || '')); } catch {}
  if (!j || typeof j.refused !== 'string' || !Array.isArray(j.offers)) return null;
  const cause = j.refused.replace(/^AskerDo: /, '').split(". The board's answer: ")[0].replace(/[.\s]+$/, '');
  const calls = j.offers.map((o) => offerCall(o, step)).filter(Boolean);
  const hint = j.offers.map((o) => o && o.hint).find((h) => h && h.track);
  const said = hint ? " The board's answer: " + hint.track + (hint.name ? ' ' + String(hint.name).replace(/\s+/g, ' ').trim() : '') + (hint.why ? ' (' + hint.why + ')' : '') + '.' : '';
  return { deny: what + ' refused: ' + cause + '.' + said + (calls.length ? (step ? ' Send it again with that step as ' : ' Send it again as ') + calls.join('; or ') + '.' : ''), call: calls.join('; or ') };
}

/* a refused filing is paired with a later place, ask, note or checklist step in the turn: one placing
   the same work first, else the oldest refusal still open. Pure: the list left over. */
export function pairRefused(list, work) {
  const xs = Array.isArray(list) ? list : [];
  if (!xs.length) return xs;
  const same = work ? xs.findIndex((x) => x.work && x.work.toLowerCase() === String(work).toLowerCase()) : -1;
  const at = same >= 0 ? same : 0;
  return xs.filter((_, i) => i !== at);
}
/* One line at the turn's end for the refusals nothing replaced, naming each and the call that fits. */
export function refusedLeft(list) {
  const xs = (Array.isArray(list) ? list : []).filter((x) => x && x.work);
  if (!xs.length) return null;
  return { id: 'refused', say: 'a refused filing with nothing landed for it this turn: ' + xs.map((x) => '"' + x.work + '"' + (x.call ? ' (the call that fits: ' + x.call + ')' : '')).join('; ')
    + '; send that call (a place last or off your track asks ' + nameOf() + ' itself), or note it on the open task that covers it' };
}

/* task_update's checks as the CLI's flags: add (step texts), done (numbers or { step, word }), strike ({ step, why }) */
function checkArgs(c, e) {
  if (c === undefined) return [];
  if (!c || typeof c !== 'object' || Array.isArray(c)) { e.push('checks is { add: [step texts], done: [numbers], strike: [{ step, why }] }'); return []; }
  const args = [];
  for (const k of Object.keys(c)) if (!['add', 'done', 'strike'].includes(k)) e.push('checks has unknown field "' + k + '"');
  const step = (n) => Number.isInteger(n) && n >= 1;
  for (const t of [].concat(c.add ?? [])) {
    if (!isText(t) || !oneLine(t)) e.push('checks.add is a list of steps, one line each');
    else args.push('--check-add', t.trim());
  }
  for (const n of [].concat(c.done ?? [])) {
    /* a done step may carry a word, as the CLI's "<number>: word" */
    const worded = n && typeof n === 'object' && step(n.step) && isText(n.word) && oneLine(n.word);
    if (!step(n) && !worded) e.push('checks.done is a list of step numbers, 1 first, or { step, word } for a one-line word on one');
    else args.push('--check-done', worded ? n.step + ': ' + n.word.trim() : String(n));
  }
  for (const s of [].concat(c.strike ?? [])) {
    if (!s || !step(s.step) || !isText(s.why) || !oneLine(s.why)) e.push('checks.strike is a list of { step, why }: the number and a word why it will not be done');
    else args.push('--check-strike', s.step + ': ' + s.why.trim());
  }
  return args;
}

/* The checklist after a task_update's checks, a struck step printed as struck. */
export function checksWords(j) {
  const c = j && j.checks;
  if (!c || !Array.isArray(c.items)) return '';
  const flat = (t) => String(t).replace(/\s+/g, ' ').trim();
  return c.id + ' checklist: ' + (c.progress || (c.items.length ? 'every step struck' : 'empty')) + c.items.map((it, i) => '\n  ' + (it.n ?? i + 1) + '. ' + (it.struck ? '[~] ' : it.done ? '[x] ' : '[ ] ')
    + flat(it.text) + (it.struck ? ' (struck: ' + flat(it.struck) + ')' : it.word ? ' (' + flat(it.word) + ')' : '')).join('');
}

/* Where a note's "left for T-n" sentences were copied, and the ones that got no copy. */
export function copiedWords(j) {
  if (!j || !Array.isArray(j.copied)) return '';
  return (j.copied.length ? 'Copied onto ' + j.copied.join(', ') + '.' : '')
    + (j.notCopied ? (j.copied.length ? ' ' : '') + 'Not copied: ' + j.notCopied.map((n) => n.id + ' (' + n.why + ')').join('; ') + '.' : '');
}

/* the mod's one command. Every name it answers stays in this file. */
export const COMMAND = 'askerdo';
export const COMMAND_HINT = '[106b note | home | questions | board | track | park | handoff | resume | pane | guard | proc]';
export const COMMAND_DESCRIPTION = 'AskerDo: the open questions, answers, the board and this session\'s track';
export const SUBCOMMANDS_LINE = 'More: /askerdo home | questions | board | track | park "reason" | handoff | resume [TR-n | WS-n] | pane | guide | guard [on | off] | help';
export const USAGE = [
  'Usage: /askerdo [subcommand]',
  '/askerdo: the open questions for this project',
  '/askerdo 106b [note]: answer, the question number and the option letter; each further token (106b 107a) is its own answer',
  '/askerdo home: open the AskerDo pane on Home (the band and the activity)',
  '/askerdo questions: open the AskerDo pane on Questions',
  '/askerdo board: the link to this project\'s board',
  '/askerdo track [TR-n | new WS-n <name> | park [TR-n] "reason" | finish [TR-n] ["outcome"] | splinter [T-n] <name> | capture [inbox] <idea> | pane]',
  '/askerdo park "reason": ask the model for a parked handoff of the track this session holds',
  '/askerdo handoff: ask the model to write the handoff of the track this session holds',
  '/askerdo resume [TR-n | WS-n] [words]: take a track, your words going with the kickoff; nothing lists the shelf',
  '/askerdo pane: open the AskerDo pane on Tracks',
  '/askerdo guide: open the AskerDo pane on Guide, the README and the guide pages of this install',
  '/askerdo guard [on | off]: the agent depth guard for this project',
  '/askerdo proc <words> | proc ran <name> clean | proc ran <name> deviated "note" --fixed <commit> | --one-off "why" | --filed T-n | proc scan: the procedure cards',
  '/askerdo withdraw K-n: your Withdraw on the withdraw request holding that record',
  '/askerdo fix K-n: your Fix on the fix request holding that record',
  '/askerdo scrub K-n: your Scrub on the scrub request holding that record',
  '/askerdo keep K-n: your Keep on the override request holding that record, left as written',
  '/askerdo unscrub K-n: put back the text a scrub removed, within 7 days',
  '/askerdo help: this list; the Guide tab (/askerdo guide) explains each part',
].join('\n');

const VERBS = ['home', 'questions', 'board', 'track', 'park', 'handoff', 'resume', 'pane', 'guard', 'proc', 'withdraw', 'fix', 'scrub', 'keep', 'unscrub', 'guide', 'help'];
/* the press's word before the act words, still taken typed */
const OLD_VERBS = ['allow'];
/* threads gave way to tracks; the old word answers with where its moves went */
export const THREAD_GONE = 'Threads gave way to tracks: /askerdo track shows the one this session holds and makes its moves'
  + ' (new, park, finish, splinter, capture), and /askerdo resume lists the shelf.';

/* `/askerdo guard`, `guard on`, `guard off`. */
export function parseGuard(args) {
  const s = String(args || '').trim().toLowerCase();
  if (!s) return { sub: 'show' };
  if (s === 'on' || s === 'off') return { sub: s };
  return { error: 'Usage: /askerdo guard [on | off]: the agent depth guard for this project' };
}

/* The first word picks the subcommand; one that starts with a number is always
 * an answer, so `106b`, `106 b` and a malformed token all reach parseAnswer. */
export function parseAskerdo(args) {
  const s = String(args || '').trim();
  if (!s) return { verb: 'open', args: '' };
  const word = s.split(/\s+/)[0];
  /* L1a answers a question this session keeps under a local label */
  if (/^Q?\d/.test(word) || /^L\d/i.test(word)) return { verb: 'answer', args: s };
  const verb = word.toLowerCase();
  if (VERBS.includes(verb) || OLD_VERBS.includes(verb)) return { verb, args: s.slice(word.length).trim() };
  if (verb === 'thread') return { verb: 'usage', error: THREAD_GONE };
  return { verb: 'usage', error: 'Unknown subcommand "' + word + '".\n' + USAGE };
}

/* the typeahead's rows for the command once the engine runs: the bare
 * name, then the verbs. A typed trailing space does not stop Enter filling
 * a plugin skill; the user command file does. */
export function commandSuggestions(e, names = [COMMAND]) {
  const text = String((e && e.text) || '');
  const tok = String((e && e.token) || '');
  for (const name of names.filter(Boolean)) {
    const head = '/' + name;
    if (e.start === 0 && tok.length >= 2 && head.startsWith(tok)) {
      return [{ text: head + ' ', label: head, description: COMMAND_DESCRIPTION }];
    }
    if (e.start === head.length + 1 && text.startsWith(head + ' ') && !/^Q?\d/.test(tok)) {
      return VERBS.filter((v) => v.startsWith(tok.toLowerCase())).map((v) => {
        const line = USAGE.split('\n').find((l) => l.startsWith('/' + COMMAND + ' ' + v)) || '';
        return { text: v + ' ', label: v, description: line.slice(line.indexOf(v) + v.length).replace(/^:\s*/, '').trim() };
      });
    }
  }
  return [];
}

/* The personal alias: a bare command word, or empty for none. */
export const ALIAS_MAX = 16;

export function checkAlias(value) {
  if (value === undefined || value === null) return { alias: '' };
  if (typeof value !== 'string') return { error: 'the alias is text' };
  const s = value.trim();
  if (!s) return { alias: '' };
  if (s.includes('/')) return { error: 'the alias is the bare word, with no slash' };
  if (s.length > ALIAS_MAX) return { error: 'the alias is at most ' + ALIAS_MAX + ' characters' };
  if (!/^[a-z0-9][a-z0-9-]*$/.test(s)) return { error: 'the alias takes lowercase letters, digits and hyphens, starting with a letter or digit' };
  return { alias: s };
}

/* `/askerdo withdraw K-n` (fix, scrub, allow), `keep K-n`, `unscrub K-n`: the word, then a record (or a request's #n). */
export function parseOverride(verb, args) {
  const m = String(args || '').trim().match(/^(#?\d+|[A-Za-z]+-\d+)$/);
  if (!m) return { error: 'Usage: ' + (USAGE.split('\n').find((l) => l.startsWith('/' + COMMAND + ' ' + verb + ' ')) || '/' + COMMAND + ' ' + verb + ' K-n') };
  return { verb, id: m[1].toUpperCase() };
}

/* `/askerdo 106b [note]`, also `Q106 b` and `106 b`; L1a a local label's.
   each further token in the line, in any form the first takes, is its own answer in
   `more`, its note the words up to the next token; a token inside quotes stays note text. */
const LATER_TOKEN = /"[^"]*"|“[^”]*”|(?<=[\s,;])(?:Q?(\d+)|[Ll](\d+))\s*([a-z])(?=[\s,;.]|$)/g;
const CONNECTOR = /^(?:and|&|plus|then)$/i;
export function parseAnswer(args) {
  const s = String(args || '').trim();
  const m = s.match(/^(?:Q?(\d+)|[Ll](\d+))\s*([a-z])(?=[\s,;.]|$)/);
  if (!m) return { error: 'Usage: /askerdo 106b [note]: the question number and the option letter, then an optional note.' };
  const all = [{ id: m[1] ? 'Q' + m[1] : 'L' + m[2], letter: m[3], from: m[0].length, to: s.length }];
  for (const t of s.slice(m[0].length).matchAll(LATER_TOKEN)) {
    if (t[3] === undefined) continue;
    const at = m[0].length + t.index;
    all.at(-1).to = at;
    all.push({ id: t[1] ? 'Q' + t[1] : 'L' + t[2], letter: t[3], from: at + t[0].length, to: s.length });
  }
  /* a connector between two tokens joins them; it is no note */
  const [first, ...more] = all.map((a, i) => {
    const text = s.slice(a.from, a.to).replace(/^[\s,;:.]+|[\s,;]+$/g, '');
    return { id: a.id, letter: a.letter, note: (i < all.length - 1 && CONNECTOR.test(text) ? '' : unquote(text)) || undefined };
  });
  return more.length ? { ...first, more } : first;
}

/* the answer tool's input, an answer the user typed in chat: a board question or a
   label this session keeps, the letter, an optional note (a note alone is the answer), or a drop */
export function answerArgs(input) {
  const i = input && typeof input === 'object' ? input : {};
  const m = /^(?:Q?(\d+)|[Ll](\d+))$/.exec(String(i.id || '').trim());
  if (!m) return { error: 'id is a board question (Q106) or a label this session keeps (L1)' };
  const letter = i.pick === undefined || i.pick === null ? '' : String(i.pick).trim();
  if (letter && !/^[a-z]$/.test(letter)) return { error: 'pick is one option letter (a, b, c)' };
  const note = typeof i.note === 'string' && i.note.trim() ? i.note.trim() : undefined;
  const drop = i.drop === true;
  if (drop && letter) return { error: 'a drop takes no pick; its note carries the reason' };
  if (!drop && !letter && !note) return { error: 'give pick, note or both' };
  return { id: m[1] ? 'Q' + m[1] : 'L' + m[2], letter, note, drop };
}

/* a typed label's live holder against the questions told in this session:
   the told one that held the label under another key, or null. */
export function toldClash(told, sid, label, liveKey) {
  if (!liveKey) return null;
  for (const q of told || []) {
    if (q && q.session === sid && q.id === label && q.key && q.key !== liveKey) return q;
  }
  return null;
}

/* The ask when they differ: both records by label and name, and the token that
   answers each. `wasNow` is the told record's label today, '' when it holds none. */
export function clashText({ label, letter, liveName, was, wasNow }) {
  const tok = token(label, letter);
  const other = wasNow && wasNow !== label;
  return 'Not answered yet: this session was told ' + label + ' (' + was.name + ')'
    + (other ? ', now ' + wasNow : '') + ', but ' + label + ' is now (' + liveName + '). '
    + 'Type ' + tok + ' again to answer ' + label + ' (' + liveName + ')'
    + (other ? ', or ' + token(wasNow, letter) + ' for ' + wasNow + ' (' + was.name + ').' : '.');
}

/* Words a person typed in quotes, with the quotes taken off. */
export function unquote(s) {
  const t = String(s || '').trim();
  const m = t.match(/^"([\s\S]*)"$/) || t.match(/^'([\s\S]*)'$/);
  return m ? m[1].trim() : t;
}

/* the moves a person makes on a track. Nothing shows the one this session
 * holds; TR-n shows that one without taking it; park, finish and splinter
 * act on the held track unless one is named. */
const TRACK_USAGE = 'Usage: /askerdo track [TR-n] | new WS-n <name> | park [TR-n] "reason" | finish [TR-n] ["outcome"]'
  + ' | splinter [T-n] <name> | capture [inbox] <idea> | pane';
export function parseTrack(args) {
  const s = String(args || '').trim();
  if (!s) return { sub: 'show' };
  const [word] = s.split(/\s+/);
  let tail = s.slice(word.length).trim();
  const w = word.toLowerCase();
  if (isTrackId(word) && !tail) return { sub: 'show', track: word };
  if (w === 'pane' && !tail) return { sub: 'pane' };
  /* an optional id leads the tail */
  const lead = (re) => {
    const m = tail.match(new RegExp('^(' + re.source + ')(?:\\s+|$)'));
    if (!m) return undefined;
    tail = tail.slice(m[0].length).trim();
    return m[1];
  };
  if (w === 'new') {
    const ws = lead(/WS-\d+/);
    const name = unquote(tail);
    return ws && name ? { sub: 'new', workstream: ws, name } : { error: 'Usage: /askerdo track new WS-n <name>' };
  }
  if (w === 'park') {
    const track = lead(/TR-\d+/);
    const reason = unquote(tail);
    return reason ? { sub: 'park', ...(track ? { track } : {}), reason } : { error: 'Usage: /askerdo track park [TR-n] "reason"' };
  }
  if (w === 'finish') {
    const track = lead(/TR-\d+/);
    const outcome = unquote(tail);
    return { sub: 'finish', ...(track ? { track } : {}), ...(outcome ? { outcome } : {}) };
  }
  if (w === 'splinter') {
    const at = lead(/T-\d+/);
    const name = unquote(tail);
    return name ? { sub: 'splinter', ...(at ? { at } : {}), name } : { error: 'Usage: /askerdo track splinter [T-n] <name>' };
  }
  if (w === 'capture') {
    const inbox = !!lead(/inbox/);
    const name = unquote(tail);
    return name ? { sub: 'capture', inbox, name } : { error: 'Usage: /askerdo track capture [inbox] <idea>' };
  }
  return { error: TRACK_USAGE };
}

const MOVE_FLAGS = { '--take-over': 'take over', '--read-only': 'read only', '--splinter': 'splinter' };

/* `/askerdo resume [TR-n | WS-n] [words]`: nothing lists the shelf; words after the
 * id ride the kickoff to the model. On a held track one of the
 * three moves follows the id: --take-over, --read-only or --splinter <name>. */
export function parseResume(args) {
  const s = String(args || '').trim();
  if (!s) return { sub: 'shelf' };
  const [word] = s.split(/\s+/);
  const rest = s.slice(word.length).trim();
  /* an old thread's TH-n, or its handoff's TH-n.m, names the track it became: the board's labels resolve it */
  const old = /^TH-\d+(\.\d+)?$/.test(word);
  const id = old ? word.replace(/\.\d+$/, '') : word;
  const flag = rest.split(/\s+/)[0];
  const move = MOVE_FLAGS[flag];
  const usage = 'Usage: /askerdo resume TR-n | WS-n [your words], TR-n --take-over | --read-only | --splinter <name> | --here, or nothing to see the shelf';
  /* the user takes it on this PC although its handoff names another */
  if ((isTrackId(id) || old) && flag === '--here' && rest === flag) return { sub: 'resume', track: id, here: true };
  if ((isTrackId(id) || old) && move) {
    const name = unquote(rest.slice(flag.length).trim());
    if (move === 'splinter' && !name) return { error: 'Usage: /askerdo resume ' + id + ' --splinter <name of the side track>' };
    return { sub: 'resume', track: id, move, ...(move === 'splinter' ? { name } : {}) };
  }
  const words = rest ? { note: rest } : {};
  if (isTrackId(id) || old) return { sub: 'resume', track: id, ...words };
  if (/^WS-\d+$/.test(id)) return { sub: 'resume', workstream: id, ...words };
  return { error: usage };
}

/* the args of a whole line `/askerdo resume <id>` (or the id and --read-only) in a
 * prompt, '' for none; a mention in a sentence, words after the id, the bare shelf and a take-over
 * or splinter are none (a brief never moves a live session's lease without the user's say). */
export function resumeLine(text) {
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^\s*\/askerdo\s+resume\s+(\S.*?)\s*$/.exec(line);
    const p = m ? parseResume(m[1]) : null;
    if (p && p.sub === 'resume' && p.note === undefined && (!p.move || p.move === 'read only')) return m[1];
  }
  return '';
}

/* a peer's message as the engine wraps it (<cross-session-message ...>, the body's tag
 * openers escaped as "<\", maybe a framing line after); text with no envelope stays as it is. */
export function peerBody(text) {
  const s = String(text || '');
  const m = /<cross-session-message\b[^>]*>\n([\s\S]*?)\n<\/cross-session-message>/.exec(s);
  return m ? m[1].replace(/<\\/g, '<') : s;
}

/* the args of a prompt that is one whole `/askerdo ...` line and nothing else, null for
 * none; a resume runs only in the forms resumeLine takes, so no message moves a lease. */
export function commandLine(text) {
  const m = /^\/askerdo(?:[ \t]+([^\r\n]*?))?[ \t]*$/.exec(String(text || '').trim());
  if (!m) return null;
  const args = m[1] || '';
  if (/^resume(\s|$)/.test(args) && !resumeLine('/askerdo ' + args)) return null;
  return args;
}

const cell = (s) => String(s == null ? '' : s).replace(/\s*\r?\n\s*/g, ' ').replace(/\|/g, '\\|').trim();

/* A question in one line: its id, name and answer tokens, the pick starred. */
function questionLine(q) {
  const opts = Array.isArray(q.options) ? q.options.filter((o) => o && /^[a-z]$/.test(o.type || '')) : [];
  const toks = opts.map((o) => token(q.id, o.type) + (q.pick === o.type ? ' *' : ''));
  return '- ' + q.id + ' ' + cell(q.name) + (q.blocking ? ' (blocking)' : '') + (toks.length ? ': ' + toks.join(', ') : '');
}

/* What waits on the user in this project: the open questions, then the band's calls with their
   presses (callRows), then the live handoffs' asks; `missing` names what could not be read. */
export function openSetText(questions, opts = {}) {
  const qs = questions || [];
  const calls = Array.isArray(opts.calls) ? opts.calls : [];
  const asks = Array.isArray(opts.asks) ? opts.asks : [];
  const tail = [...(opts.missing ? [opts.missing] : []), ...(opts.url ? ['Board: ' + opts.url] : []), SUBCOMMANDS_LINE];
  if (!qs.length && !calls.length && !asks.length) return ['Nothing waits on you in this project.', ...tail].join('\n\n');
  const parts = [];
  if (qs.length) {
    const shown = qs.slice(0, opts.limit || qs.length);
    parts.push(qs.length + ' open question' + (qs.length === 1 ? '' : 's') + ' for this project, ' + qs.filter((q) => q.blocking).length + ' blocking.');
    /* one line each: the cards already carry the tables, and /askerdo questions opens them */
    parts.push(shown.map(questionLine).join('\n'));
    if (qs.length > shown.length) {
      parts.push('And ' + (qs.length - shown.length) + ' more: ' + qs.slice(shown.length).map((q) => q.id + ' ' + q.name).join(', ') + '.');
    }
    parts.push('Answer with /askerdo <token> [note], for example /askerdo ' + exampleToken(shown) + '. /askerdo questions shows the full cards.');
  } else parts.push('No open questions for this project.');
  if (calls.length) {
    parts.push((calls.length === 1 ? 'One thing waits' : calls.length + ' things wait') + ' on your press on Home in the AskerDo pane:\n'
      + calls.map((c) => '- ' + callLine(c) + ' (' + c.presses.map((p) => p.label).join(' or ') + typedPress(c) + ')').join('\n'));
  }
  if (asks.length) {
    parts.push((asks.length === 1 ? 'A live handoff says this waits' : 'The live handoffs say these ' + asks.length + ' wait') + ' on you:\n'
      + asks.map((a) => '- ' + a.track + (a.name ? ' ' + flatLine(a.name) : '') + (a.handoff ? ' (handoff ' + a.handoff + ')' : '') + ': ' + flatLine(a.text)).join('\n'));
  }
  return [...parts, ...tail].join('\n\n');
}

/* an override leads with its name, so "#1" is never read as a list position;
   its summary without the tallies (they stay on the tooltip) and its page (`link`, signed in) */
function callLine(c) {
  if (c.kind !== 'override') return c.text;
  const recs = c.records || [];
  const what = c.change === 'withdraw' ? 'a withdrawal' : c.change === 'scrub' ? 'a scrub' : 'a rewrite';
  const whom = recs.length === 1 ? recs[0] : recs.length ? recs.length + (recs.every((r) => /^T-\d/.test(r)) ? ' tasks' : ' records') : 'its records';
  const state = c.expired ? 'Expired unanswered: ' : c.changed ? 'Changed since asked: ' : '';
  return 'Override #' + c.request + ' (' + what + ' of ' + whom + '): ' + state + (c.summary || c.text) + (c.link ? ' Its page: ' + c.link : '');
}

/* An override's presses typed: /askerdo withdraw, fix or scrub (its act) or keep, unscrub for a scrub */
function typedPress(c) {
  const on = c.id || (c.request != null ? '#' + c.request : '');
  if (!on) return '';
  if (c.kind === 'scrub') return ', or type /askerdo unscrub ' + on;
  if (c.kind !== 'override') return '';
  const verbs = c.presses.filter((p) => p.input && p.input.decision).map((p) => String(p.label).toLowerCase());
  return verbs.length ? ', or type ' + verbs.map((v) => '/askerdo ' + v + ' ' + on).join(' or ') : '';
}

function exampleToken(qs) {
  for (const q of qs) {
    const o = (q.options || []).find((x) => x && /^[a-z]$/.test(x.type || ''));
    if (o) return token(q.id, q.pick || o.type);
  }
  return '106b';
}

/* A shelf row for a track no session held: its ready count and what started it. */
export const untakenMark = (r) => (r && r.state === 'new' && r.ready ? r.ready + ' ready, no session yet' + (r.from ? ', from ' + r.from : '') : '');

/* The board's shelf: waiting and parked tracks everywhere, each with its resume command;
   a held track whose lease went quiet reads so, its resume a take-over. */
export function shelfText(rows, now = Date.now()) {
  const list = (rows || []).filter((r) => r && r.track);
  if (!list.length) return 'The shelf is empty: no track is waiting or parked, and none has ready work and no session.';
  /* a track no session held yet sorts last, its ready count the mark */
  const lines = [list.some((r) => r.state === 'new') ? 'Tracks waiting or parked, oldest first, then tracks with ready work and no session yet:' : 'Tracks waiting or parked, oldest first:'];
  for (const r of list) {
    /* what opens it again, the board's words (unpark), after the reason */
    const parked = r.state === 'parked' && (r.parkReason || r.unpark)
      ? 'parked' + (r.parkReason ? ': ' + cell(r.parkReason) : '') + (r.unpark ? '; opens again ' + cell(r.unpark) : '') : '';
    const marks = [r.quietSince ? 'held, quiet since ' + atWords(r.quietSince, now) : '', parked,
      r.stalled ? 'stalled' : '', r.noHandoff ? 'no handoff yet' : '', r.codeMoved ? 'code moved since' : '', untakenMark(r)].filter(Boolean);
    lines.push('- ' + (r.resume || '/askerdo resume ' + r.track) + ': ' + cell(r.name) + ' (' + [r.state, r.age, r.workstream].filter(Boolean).join(', ') + ')'
      + (r.focus ? ', ' + cell(r.focus) : '') + (marks.length ? ' [' + marks.join('; ') + ']' : ''));
  }
  return lines.join('\n');
}

/* a thread started at the handoff takes its name from the focus, cut at a word */
export const TITLE_MAX = 59;
export function threadNameOf(focus) {
  const one = String(focus || '').replace(/\s+/g, ' ').trim();
  if (one.length <= TITLE_MAX) return one || 'handoff';
  const cut = one.slice(0, TITLE_MAX);
  const at = cut.lastIndexOf(' ');
  return (at > 20 ? cut.slice(0, at) : cut).replace(/[\s,;:.]+$/, '');
}

export const NEEDS_TRACK = 'This session holds no track. Take one with /askerdo resume TR-n (/askerdo resume lists the shelf), or start one with /askerdo track new WS-n <name>.';

/* "T-41 (running: api-builder for 12 min)": the now set, each task with its word at the clock `at` */
export const nowText = (now, at, self) => (now || []).map((n) => n.id + ' (' + flatLine(wordWords(n, at, self, (n.word && n.word.is) || 'running')) + ')').join(', ');

/* What /askerdo track says of the held track (`track mine`'s read). */
export function trackText(m, at = Date.now(), self = null) {
  if (!m || !m.held) return NEEDS_TRACK;
  /* the board lists each task once, in now or ready, by its word */
  const split = { now: Array.isArray(m.now) ? m.now : [], ready: Array.isArray(m.readySet) ? m.readySet : [] };
  const now = nowText(split.now, at, self);
  return 'This session holds ' + m.track + ' ' + flatLine(m.name) + (m.workstream ? ' in ' + m.workstream : '') + ': ' + m.text + '.'
    + (m.chain && m.chain !== m.track ? '\nChain: ' + m.chain : '')
    + (now ? '\nNow: ' + now : '')
    + (split.ready.length ? '\nReady: ' + split.ready.map((t) => t.id).join(', ') : '');
}

/* the app stores a typed /askerdo without its args, so an answer's first line names
   what it answers, the subcommand and arguments as typed; a bare /askerdo needs none */
export function commandLead(args, text) {
  const said = String(args || '').replace(/\s+/g, ' ').trim();
  return said ? (said.length > 100 ? said.slice(0, 97) + '...' : said) + ': ' + text : text;
}

/* a track another session holds, and the user's three moves as commands to run;
   the holder in plain words, `r.pc` the asking PC. */
export function heldText(r, now = Date.now()) {
  const id = r.track;
  return id + ' is held by ' + holderWords(r.holder, { now, pc: r.pc }) + '. Your three moves:\n'
    + '- /askerdo resume ' + id + ' --splinter <name>: start a side track from it and work there\n'
    + '- /askerdo resume ' + id + ' --take-over: take it; the other session hears so at its next prompt\n'
    + '- /askerdo resume ' + id + ' --read-only: its kickoff, without taking it';
}

/* a session whose track was taken over hears so at its next prompt. */
export const lostTrackNote = (id) => 'AskerDo: this session no longer holds ' + id + ': another session took it over.'
  + ' Write nothing more on it from here; /askerdo resume ' + id + ' shows who holds it now and the three moves.';

/* a rewound or restarted session, told once what the mod took back for it. */
export function rewoundNote({ track, name, tasks, lost, cli } = {}) {
  const held = [track ? track + (name ? ' (' + flatLine(name) + ')' : '') : '', (tasks || []).length ? tasks.join(', ') + ' in hand' : ''].filter(Boolean);
  const gone = (lost || []).map((x) => flatLine(String(x))).filter(Boolean);
  if (!held.length && !gone.length) return '';
  return 'AskerDo: this session came back under a new id (a rewind, a restart or a /clear), and the mod took back what its earlier id held'
    + (held.length ? ', so it still holds ' + held.join(' and ') : '') + '.'
    + (gone.length ? ' The agents its earlier process ran ended with that process, with no report, so their runs were ended handed on: '
      + gone.join('; ') + '. Dispatch again what their tasks still need.' : '')
    + (track ? ' Before going on, read where the track stands: node ' + (cli || 'bin/askerdo.mjs') + ' track show ' + track + '.' : '');
}

/* The one line the transcript shows in the user's name; handoffPrompt rides it as context.
   No leading slash, so the engine never reads it as a command again. */
export const handoffAsk = (track, parkReason) => parkReason
  ? 'Park ' + track + ' with its parked handoff: ' + flatLine(parkReason) + ' (/askerdo park).'
  : 'Write the handoff for ' + track + ' (/askerdo handoff).';

/* What /askerdo handoff asks the model, as a prompt of its own; with a reason,
   /askerdo park's parked handoff, so the parking leg's mind is kept. */
/* the five board tools load on first use, and a session's first request lists none of them */
const loadFirst = (tool) => ' (load it first with ToolSearch, query `select:mcp__askerdo__' + tool + '`)';
export function handoffPrompt(track, parkReason, running = '') {
  const n = nameOf();
  return (parkReason ? capFirst(n) + ' is parking ' + track + '. ' : '')
    + (running ? 'Running now: ' + running + '. Tell ' + n + ' in one line that the handoff waits for them; let each land and check what it left, then write. ' : '')
    + STOP_FIRST + ' '
    + (parkReason
      ? 'Then write its parked handoff with the handoff_write tool' + loadFirst('handoff_write') + ', status parked and parkReason ' + JSON.stringify(parkReason) + ': '
      : 'Then write the handoff for ' + track + ' with the handoff_write tool' + loadFirst('handoff_write') + ': ')
    + 'focus (one line, the next step), '
    + 'goal (what ' + track + ' is doing now, in a sentence or two, said again as it stands or restated when the work changed), '
    + 'state (at most 10 KB, a line over 400 characters wrapped for you: the picture, what is done with commit hashes and what to watch; it never orders work), '
    + 'leftovers (the steps left, in order: each { name } with its after, the numbers of earlier steps or T-n ids, becomes a task on the track, so the next session takes the next step from the ready set; '
    + 'each names its runBy: orchestrator, fork for work that needs the session\'s context (the briefs early in the session), or agent:<model> for mechanical work and for the briefs on a large read or past the handoff window; a step at a real place on the track names its before and lands; '
    + 'one you want last, off the track or started later (newTrack and unparkWhen) names that place, why, and here, the real place on the track it would otherwise take: it asks ' + n + ' first and nothing is created until the press), '
    + 'whereWeWere (at most 4 KB, in your own words: ' + n + '\'s last exchange in their words, what was mid-thought, what was tried and dropped and what not to repeat, preferences learned this sitting), '
    + 'rulings (each ruling ' + n + ' made in chat that was never registered, one line each; one the kickoff carried comes back as { id, registered } once registered), '
    + 'verifyFirst (one entry per repo: path (the checkout\'s top), branch, worktree (where the branch is checked out when not at path; the checks then run there), files, worktrees; the verb snapshots the repo itself, its worktrees and merged branches too). '
    + 'In files, each untracked file new since the last handoff, and each kept one whose review date has passed, gets a disposition: commit, ignore, delete, keep (with a reason; reviewed in 7 days unless you give a review day) or undecided; a file left out carries its last disposition and reason. Judge from your own context first, then a quick look at the file, then one agent when about five or more are still unknown; whatever is left is undecided. Commit, ignore and delete are proposals: ' + n + ' is asked, and nobody acts on them before that answer. '
    + 'In worktrees, a worktree holding work (by its path) and the groups merged (merged and clean worktrees with their branches) and branches (merged branches with no worktree) take remove, keep (with a reason) or undecided; left out, a group is proposed for removal and a worktree holding work is undecided. The write first removes each merged, clean agent worktree and merged agent branch still left, never a locked one, and lists them; ask ' + n + ' about the rest in this reply through the ask tool, after the handoff is written, and remove nothing before the answer; the resume asks nothing. '
    + 'Then waitingOnUser for anything new that waits on ' + n + ', and { drop } for a carried one now settled. '
    + 'Then close your reply with the resume block the tool\'s result gives, just above the footer; while work of this session runs the result gives none.';
}

/* no server outlives its session; nor a side session
   left attached, whose turn notes would wake the old session after a resume; what
   reports back to the session is waited for, never cut through */
export const STOP_FIRST = 'Before the handoff, let every agent and workflow this session started land and check what each left: while one runs, handoff_write stores nothing and gives no resume block, '
  + 'and only a Stop press on its row in the AskerDo pane ends one early. Stop the servers, background commands and monitors it started, or name each in the handoff\'s state with how to stop it. '
  + 'Detach any side session it started (a test, display or helper session) and say so in one line: a side session\'s turn notes reach only the session that started it, so after the handoff they would wake this one instead of the resumed one.';

/* ---- the handoff kept current ----------------------------------- */

/* the steps that keep a handoff current, or leave it as it was */
const QUIET_STEPS = ['handoff_update', 'note'];
const toolName = (s) => String(s || '').replace(/^mcp__.+?__/, '');
const trackPart = (id) => String(id || '').trim().replace(/\.\d+$/, '').toUpperCase();

/* what changes state after a handoff; a plain answer or a read leaves it true */
const BOARD_STEPS = ['task_update', 'place', 'decide', 'fact', 'ask', 'override_request', 'handoff_write'];
const WRITE_STEPS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Agent', 'Task', 'Workflow', 'TaskStop'];
/* the hub verbs that only read; every other verb, a flag before it skipped, counts */
const HUB_READS = ['list', 'show', 'read', 'search', 'activity', 'resolve', 'shelf', 'legacy', 'help', 'timings', 'decisions', 'projects',
  'track show', 'track list', 'profile show-effective', 'profile list', 'decisions triggers', 'proc find', 'proc triggers', 'task block'];
const HUB_PAIRS = ['track', 'profile', 'proc', 'decisions', 'projects', 'handoff', 'task'];
function hubVerb(part) {
  const m = /(?:cli|askerdo)\.mjs["']?\s+(.*)$/.exec(part);
  const words = m ? m[1].split(/\s+/).filter(Boolean) : [];
  const plain = words.filter((w) => !w.startsWith('-'));
  const a = plain[0] || '';
  return { verb: HUB_PAIRS.includes(a) && /^[a-z-]+$/.test(plain[1] || '') ? a + ' ' + plain[1] : a, rest: plain.slice(1), words };
}
const hubReads = (part) => {
  const { verb, rest, words } = hubVerb(part);
  return HUB_READS.includes(verb) || verb === 'handoff update' || (verb === 'resume' && (!rest.length || words.includes('--read-only')));
};
const PUSH_OR_STOP = /\bgit(?:\.exe)?\b[^;&|\r\n]*\spush\b|\b(?:kill|pkill|taskkill|Stop-Process)\b/i;

/* a shell step counts as a change unless every command in it reads: listing, printing, searching */
const READ_CMDS = new Set(['ls', 'cat', 'head', 'tail', 'grep', 'rg', 'wc', 'diff', 'echo', 'printf', 'pwd', 'which', 'type', 'cd', 'sort', 'uniq', 'cut', 'tr', 'nl', 'uname', 'date', 'exit', 'true',
  'get-content', 'gc', 'get-childitem', 'gci', 'dir', 'select-string', 'sls', 'test-path', 'get-item', 'get-location', 'select-object', 'where-object',
  'measure-object', 'sort-object', 'format-table', 'format-list', 'write-output', 'write-host', 'out-null', 'out-string', 'get-command']);
const GIT_READS = ['status', 'log', 'diff', 'show', 'rev-parse', 'ls-files', 'merge-base', 'blame', 'describe', 'shortlog'];
const GIT_BRANCH_WRITES = /^-(?:[dDmMcCfu]|-(?:delete|move|copy|force|set-upstream-to|unset-upstream|edit-description)\b)/;
const FIND_WRITES = /^-(?:delete|exec|execdir|ok|okdir|fprint|fprint0|fprintf|fls)$/;
function gitReads(args) {
  let i = 0;
  while (i < args.length && args[i].startsWith('-')) i += /^-[Cc]$/.test(args[i]) ? 2 : 1;
  const [sub, ...rest] = args.slice(i);
  if (GIT_READS.includes(sub)) return true;
  if (sub === 'branch') return rest.every((a) => a.startsWith('-') && !GIT_BRANCH_WRITES.test(a));
  if (sub === 'remote') return !rest.length || rest[0] === '-v' || rest[0] === 'get-url' || rest[0] === 'show';
  return (sub === 'worktree' || sub === 'stash') && rest[0] === 'list';
}
function partReads(part) {
  const toks = part.split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < toks.length && (/^\w+=/.test(toks[i]) || toks[i] === 'env')) {
    if (toks[i++] === 'env') while (i < toks.length && toks[i].startsWith('-')) i += toks[i] === '-u' ? 2 : 1;
  }
  if (i >= toks.length) return true;
  const name = toks[i].replace(/^.*[\\/]/, '').replace(/\.exe$/i, '').toLowerCase();
  const args = toks.slice(i + 1);
  if (isHubShell(part)) return hubReads(part);
  if (name === 'git') return gitReads(args);
  if (name === 'node') return args[0] === '--test' || (/build\.mjs$/.test(args[0] || '') && args.includes('--check'));
  if (name === 'sed') return !args.some((a) => /^-[a-zA-Z]*i/.test(a) || a.startsWith('--in-place'));
  if (name === 'find') return !args.some((a) => FIND_WRITES.test(a));
  return READ_CMDS.has(name);
}
/* quoted text becomes one plain token, so its pipes and spaces never split a command */
const plainQuotes = (cmd) => String(cmd).replace(QUOTED, (q) => q.slice(1, -1).replace(/[\s|&;<>()]/g, '_') || '_');
const SAFE_REDIRECT = /\d?>&\d|\d?>\s*(?:\/dev\/null|\$null|nul)(?![\w/])/gi;
export function shellReads(cmd) {
  const raw = String(cmd || '');
  if (/\$\(|`|<<|[<>]\(/.test(raw)) return false;
  const c = plainQuotes(raw).replace(SAFE_REDIRECT, ' ');
  if (/>/.test(c)) return false;
  const parts = c.split(/&&|\|\||[|;\r\n]/);
  return !parts.some((p) => p.includes('&')) && parts.every((p) => partReads(p.trim()));
}
/* a hub handoff update keeps the handoff current, as the tool does */
export const stepTool = (tool, input) => {
  const t = toolName(tool);
  const cmd = input && typeof input === 'object' ? String(input.command || '') : '';
  return (t === 'Bash' || t === 'PowerShell') && isHubShell(cmd) && hubVerb(cmd).verb === 'handoff update' ? 'handoff_update' : t;
};

/* whether one step of the turn changes state; a note on the handoff's own track keeps it */
export function stepChanges(tool, input, handoffId) {
  const t = toolName(tool);
  const i = input && typeof input === 'object' ? input : {};
  if (t === 'handoff_update') return false;
  if (t === 'note') return !handoffId || trackPart(i.id) !== trackPart(handoffId);
  if (BOARD_STEPS.includes(t) || WRITE_STEPS.includes(t)) return true;
  if (t === 'Bash' || t === 'PowerShell') {
    const cmd = String(i.command || '');
    return !!i.run_in_background || PUSH_OR_STOP.test(cmd.replace(QUOTED, '""')) || !shellReads(cmd);
  }
  return false;
}

/* whether this turn changed state after the session's own live handoff and updated it.
   live: { id, status, turn } as this session wrote it; steps: { tool, changes } (a bare name
   counts as changing unless quiet). The writing turn counts from the write. */
export function handoffCurrency(live, turn, steps) {
  if (!live || !live.id || !['waiting', 'parked'].includes(live.status)) return { followed: false, updated: false, stale: false, at: -1 };
  const list = (Array.isArray(steps) ? steps : []).map((s) => (s && typeof s === 'object'
    ? { name: toolName(s.tool), changes: !!s.changes } : { name: toolName(s), changes: !QUIET_STEPS.includes(toolName(s)) }));
  const names = list.map((s) => s.name);
  const same = live.turn !== undefined && live.turn !== null && live.turn === turn;
  const from = same ? names.lastIndexOf('handoff_write') + 1 : 0;
  const changed = list.map((s, i) => (i >= from && s.name !== 'handoff_write' && s.changes ? i : -1)).filter((i) => i >= 0);
  const at = changed.length ? changed[0] : -1;
  const followed = at >= 0;
  /* the update has to come after the last change to say where things stand */
  const updated = names.slice(from).includes('handoff_update');
  const stale = followed && names.lastIndexOf('handoff_update') < changed[changed.length - 1];
  return {
    followed, updated, stale, at,
    ...(at >= 0 ? { note: 'AskerDo: this turn changed things after ' + live.id + ', the handoff this session wrote, so it no longer says where things stand. '
      + 'Before the turn ends, patch it with handoff_update' + loadFirst('handoff_update') + ' with what the next leg needs (a state section, a whereWeWere line, a waitingOnUser line, or a repo\'s verify-first snapshot); it keeps its id.' } : {}),
    ...(stale ? { slip: { id: 'stale-handoff', say: 'it changed things after ' + live.id + ', the handoff this session wrote, and did not update it: '
      + 'patch it with handoff_update so the next session resumes from what really happened' } } : {}),
  };
}

/* ---- the Needs-you band -------------------------------- */

export const BAND_MAX = 6;
export const POLL_MS = 15000;

const idNum = (id) => Number(String(id).replace(/\D/g, '')) || 0;
/* Rule 15: a choice that is hard to undo says "one-way" in its catch. */
const ONE_WAY = ' (one-way)';
const oneWayUndo = (undo) => /^one-way\b/i.test(flatLine(undo));
const catchOf = (costs, undo) => {
  const c = flatLine(costs);
  if (!oneWayUndo(undo) || /\bone-way\b/i.test(c)) return c;
  return c ? c + ONE_WAY : 'one-way';
};

const handoffNum = (id) => Number(String(id).split('.')[1]) || 0;
const flatLine = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
/* the mod's words say "the user" */
export const nameOf = () => 'the user';
export const capFirst = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);
/* every stored line of the why and the stakes is one list
   item, so the card draws a bullet per line; a line with its own marker keeps it */
const LIST_MARK = /^(?:[-*+]\s|\d+[.)]\s)/;
function lineSet(s) {
  return String(s == null ? '' : s).split(/\r?\n/).map(flatLine).filter(Boolean)
    .map((l) => (LIST_MARK.test(l) ? l : '- ' + l)).join('\n');
}

/* the version a row was drawn from, so its press is refused once reworded (as a card's) */
const drawnVersion = (q) => (Number.isInteger(q.version) && !q.local ? { version: q.version } : {});

/* a thread's row says status, a track's says state */
export const waitingRows = (rows) => (rows || []).filter((r) => r && (r.state || r.status) === 'waiting');

/* A name far past any real one is cut, so its card never passes the cells the app
 * takes and the whole band is refused with no fault. */
const BAND_NAME_MAX = 300;
const bandName = (s) => { const t = flatLine(s); return t.length > BAND_NAME_MAX ? t.slice(0, BAND_NAME_MAX - 3).trimEnd() + '...' : t; };

/* What the band draws from, or null with no question and no thread waiting on the
 * shelf; the shelf alone draws no band. */
export function bandModel({ questions, shelfRows, sid, calls } = {}) {
  const ownOf = (q) => q.session === sid || (Array.isArray(q.subscribers) && q.subscribers.includes(sid));
  /* a session draws rows only for its own questions; the mark counts the rest */
  const qs = (questions || []).filter((q) => q && (!sid || ownOf(q))).map((q) => {
    const opts = Array.isArray(q.options) ? q.options : [];
    const born = Date.parse(q.created || '');
    return {
      /* the row's hover card: the ask, then the crux, the gist's lines where there is none */
      id: q.id, name: bandName(q.name), ask: flatLine(q.ask), blocking: q.blocking === true,
      reverses: reversesLine(q.reverses),
      crux: flatLine(q.crux), ...(!flatLine(q.crux) && flatLine(q.gist) ? { gist: lineSet(q.gist) } : {}),
      mine: ownOf(q),
      pick: q.pick || null, born: Number.isFinite(born) ? born : 0, ...drawnVersion(q),
      answers: opts.filter((o) => o && /^[a-z]$/.test(o.type || '')).map((o) => ({
        letter: o.type, token: token(q.id, o.type), option: flatLine(o.option),
        gets: flatLine(o.getsYou), catch: catchOf(o.costsYou, o.undo), ...(flatLine(o.undo) ? { undo: flatLine(o.undo) } : {}),
      })),
    };
  });
  const waiting = waitingRows(shelfRows).length;
  /* a review due shows on the Home map and the board, never as a band row */
  const cs = callRows(calls).filter((c) => c.kind !== 'review');
  if (!qs.length && !waiting && !cs.length) return null;
  return {
    questions: qs.slice(0, BAND_MAX), more: Math.max(0, qs.length - BAND_MAX),
    total: qs.length, blocking: qs.filter((q) => q.blocking).length, waiting,
    ...(cs.length ? { calls: cs } : {}),
  };
}

/* the board's band calls (bandCalls rows) as the band draws them, any kind
 * alike: a key that changes when the fact does, the text and the presses (a verb, or a page). */
export function callRows(calls) {
  return (Array.isArray(calls) ? calls : []).filter((c) => c && c.text && Array.isArray(c.presses)).map((c) => {
    const at = c.request != null ? '#' + c.request : c.seal != null ? 'seal' + c.seal : c.record || c.id || '';
    const text = flatLine(c.text);
    /* the tooltip's facts (callCard), each only where the board sent it */
    const more = {};
    /* an override row's change is the request's kind, or a one-field fix's words as an object */
    const kindOf = (k) => (k === 'change' && c.change && typeof c.change === 'object' ? 'fix' : c[k]);
    for (const k of ['name', 'why', 'change', 'summary', 'reason', 'measure']) if (flatLine(kindOf(k))) more[k] = flatLine(kindOf(k));
    if (Array.isArray(c.workstreams) && c.workstreams.length) more.workstreams = c.workstreams.filter((w) => w && w.id).map((w) => ({ id: String(w.id), name: flatLine(w.name) }));
    if (Array.isArray(c.records) && c.records.length) more.records = c.records.map(flatLine).filter(Boolean);
    if (c.request != null) more.request = c.request;
    for (const k of ['expired', 'changed']) if (c[k] === true) more[k] = true;
    return {
      key: c.kind + ':' + at + '@' + (c.since || ''), kind: String(c.kind || ''), id: c.id || null, text, short: callShort(c, text),
      since: c.since || null, until: c.until || null, url: c.url || null, mine: c.mine === true, ...more,
      presses: c.presses.filter((p) => p && p.label && (p.verb || p.url))
        .map((p) => ({ label: flatLine(p.label), verb: p.verb || null, input: p.input ?? null, ...(p.url ? { url: p.url } : {}), ...(p.pane === 'tracks' ? { pane: 'tracks' } : {}),
          ...(flatLine(p.does) ? { does: flatLine(p.does) } : {}) })),
    };
  }).filter((c) => c.presses.length);
}

/* The band row's one line: an override's first sentence; its measure and the rest on the tooltip */
function callShort(c, text) {
  if (c.kind !== 'override' || !flatLine(c.summary)) return text;
  const sum = flatLine(c.summary);
  const first = (sum.match(/^.+?[.!?](?=\s|$)/) || [sum])[0];
  return (c.expired ? 'Expired: ' : c.changed ? 'Changed since asked: ' : '') + first;
}

/* the first problem `askerdo status` lists, as a band call: its words with the fix, and a
 * press that runs the fix's verb here or copies the command to run on another PC; a fix only the
 * user can do (start a new session) has none. */
const HEALTH_PRESS = { board: 'Start', 'board --restart': 'Restart' };
export function healthCall(p) {
  if (!p || !flatLine(p.says)) return null;
  const says = capFirst(flatLine(p.says));
  const fix = flatLine(p.fix);
  const presses = p.command ? [{ label: HEALTH_PRESS[p.command] || 'Run', verb: 'health', input: { command: p.command }, does: 'runs askerdo ' + p.command }]
    : p.copy ? [{ label: 'Copy', verb: 'health', input: { copy: p.copy }, does: 'copies ' + p.copy }] : [];
  return { key: 'health:' + p.key + '@' + says.replace(/[^A-Za-z0-9]+/g, '-').slice(0, 40), kind: 'health', id: null,
    text: says + (fix ? '. Fix: ' + fix : ''), says, fix, since: null, until: null, url: null, mine: true, presses };
}
/* what a press on the problem does (healthFix), the line that ends its cards */
export function healthPressLine(hc) {
  const verb = hc && hc.presses[0];
  return verb ? 'Press to ' + verb.does.replace(/^runs/, 'run').replace(/^copies/, 'copy') : 'Press to open Home in the AskerDo pane';
}

/* the band's one-line offline row's card: its words whole, the PC's fix where they
   lack it, and the health chip's press line, which names the command on a line of its own */
export const OFFLINE_DRAWN = 'Drawn from this PC\'s last copy';
export function offlineCard(line, hc) {
  const said = flatLine(line);
  const fix = hc && hc.fix && !said.includes(hc.fix) ? hc.fix : '';
  return {
    head: { icon: 'monitor', title: 'Board offline', state: { text: 'last copy', tone: 'amber' } },
    groups: [[tipRow(leadIcon('ldNote'), [said]), fix ? tipRow(leadIcon('ldIntent'), [quiet('Fix: '), fix]) : null,
      tipRow(leadIcon('ldClock'), [quiet(OFFLINE_DRAWN)])].filter(Boolean)],
    press: healthPressLine(hc),
  };
}

/* The band's model with the PC's first problem leading its calls, which Home's copy draws; the band
 * itself draws only the status row's chip for it. */
export function withHealth(model, problem) {
  const c = healthCall(problem);
  if (!c) return model;
  const base = model || { questions: [], more: 0, total: 0, blocking: 0, waiting: 0 };
  return { ...base, calls: [c, ...(Array.isArray(base.calls) ? base.calls : [])] };
}

/* A call's page as a path, so the tooltip names it short (the local server's signed root left out) */
const pagePath = (url) => (String(url || '').match(/\/(?:override|workstream|track|task)\/[^/?#]+/) || [''])[0];
/* An override's press names its act, and its toast what it did; the stored decision stays allow */
export const OVERRIDE_ACT = { withdraw: 'Withdraw', fix: 'Fix', scrub: 'Scrub' };
const OVERRIDE_DONE = { withdraw: 'Withdrawn', fix: 'Fixed', scrub: 'Scrubbed' };
export const actLabel = (kind) => OVERRIDE_ACT[kind] || 'Allow';
const PRESS_LEAD = { Withdraw: 'ldDone', Fix: 'ldDone', Scrub: 'ldDone', Allow: 'ldDone', Close: 'ldDone', 'Close it': 'ldDone', 'Park it': 'ldDone', Unscrub: 'ldDone' };

/* a band call's tooltip as the status row's: the head, then the
   fact and why it was raised, what it touches, and what each press does */
export function callCard(c) {
  const day = (x) => String(x || '').slice(0, 10);
  const presses = c.presses.map((p) => tipRow(leadIcon(PRESS_LEAD[p.label] || (p.verb ? 'ldWaits' : 'ldNote')), [p.label, p.does ? quiet(': ' + p.does) : '']));
  const page = pagePath(c.url);
  if (c.kind === 'override') {
    const n = (c.records || []).length;
    const waits = c.expired ? { text: 'expired', tone: 'amber' } : c.changed ? { text: 'changed since asked', tone: 'amber' } : { text: 'waits on you', tone: 'sky' };
    const what = c.change === 'withdraw' ? 'a withdrawal' : c.change === 'scrub' ? 'a scrub' : 'a rewrite';
    return {
      head: { icon: 'ldFlag', title: 'Override #' + c.request + ', ' + what + ' of ' + (n === 1 ? c.records[0] : n ? n + ' records' : 'its records'), state: waits },
      groups: [
        [tipRow(leadIcon('ldNote'), [c.summary || c.text]), c.reason ? tipRow(leadIcon('ldIntent'), [quiet('Why: '), c.reason]) : null].filter(Boolean),
        [c.measure ? tipRow(leadIcon('ldDone'), [quiet('Measured: '), c.measure]) : null,
          c.workstreams ? tipRow(leadIcon('ldFolder'), [c.workstreams.map((w) => w.id + (w.name ? ' ' + w.name : '')).join(', ')]) : null,
          n > 1 ? tipRow(leadIcon('step'), [c.records.slice(0, 8).join(', ') + (n > 8 ? ' and ' + (n - 8) + ' more' : '')]) : null,
          c.since ? tipRow(leadIcon('ldClock'), [quiet('Asked on '), day(c.since)]) : null].filter(Boolean),
        [...presses, page ? tipRow(leadIcon('ldNote'), [quiet('Every before and after: '), page]) : null].filter(Boolean),
      ].filter((g) => g.length),
    };
  }
  if (c.kind === 'health') {
    return {
      head: { icon: 'monitor', title: 'AskerDo on this PC', state: { text: 'needs a fix', tone: 'amber' } },
      groups: [[tipRow(leadIcon('ldNote'), [c.says]), c.fix ? tipRow(leadIcon('ldIntent'), [quiet('Fix: '), c.fix]) : null].filter(Boolean), presses].filter((g) => g.length),
    };
  }
  /* a track whose finished code waits for a review */
  if (c.kind === 'review') {
    return {
      head: { icon: 'ldFlag', title: [c.id, c.name].filter(Boolean).join(' ') || c.text, state: { text: 'review due', tone: 'amber' } },
      groups: [
        [tipRow(leadIcon('ldNote'), [c.text]), c.why ? tipRow(leadIcon('ldIntent'), [quiet('Why: '), c.why]) : null,
          c.since ? tipRow(leadIcon('ldClock'), [quiet('Last finished '), day(c.since)]) : null].filter(Boolean),
        presses,
      ].filter((g) => g.length),
    };
  }
  const title = c.kind === 'scrub' ? (c.id || 'A record') + ': a text was scrubbed' : [c.id, c.name].filter(Boolean).join(' ') || c.text;
  return {
    head: { icon: 'ldFlag', title, state: c.kind === 'scrub' ? { text: 'sealed', tone: 'amber' } : { text: 'waits on you', tone: 'sky' } },
    groups: [
      [tipRow(leadIcon('ldNote'), [c.text]), c.why ? tipRow(leadIcon('ldIntent'), [quiet('Why: '), c.why]) : null,
        c.until ? tipRow(leadIcon('ldClock'), [quiet('Purged on '), day(c.until)]) : c.since ? tipRow(leadIcon('ldClock'), [quiet('Since '), day(c.since)]) : null].filter(Boolean),
      presses,
    ].filter((g) => g.length),
  };
}

/* Several override requests' fold line: each request a fact, the presses on their unfolded rows */
export function foldCard(list) {
  return {
    head: { icon: 'ldFlag', title: list.length + ' override requests', state: { text: 'wait on you', tone: 'sky' } },
    groups: [list.map((c) => tipRow(leadIcon('ldNote'), [c.request != null ? '#' + c.request + ' ' : '', c.short || c.text, c.measure ? quiet(' (' + c.measure + ')') : ''])),
      [tipRow(leadIcon('ldDone'), [quiet('Unfold them to press each')])]],
  };
}

/* Several open questions' count line: each question a fact, blocking first */
export function countCard(m) {
  const qs = (m && m.questions) || [];
  const more = (m && m.more) || 0;
  return {
    head: { icon: 'ldAsk', title: (m.total || qs.length) + ' open questions', state: m.blocking ? { text: m.blocking + ' blocking', tone: 'amber' } : null },
    groups: [[...blockingFirst(qs).map((q) => askRow(q)), ...(more ? [tipRow(leadIcon('ldAsk'), [quiet('and ' + more + ' more')])] : [])]],
  };
}

/* What waits for this session: each inbox line a fact, then what the submit press does */
export function inboxCard(w) {
  const items = Array.isArray(w.items) ? w.items : (w.lines || []).map((l) => ({ text: flatLine(l), detail: '' }));
  return {
    head: { icon: 'ldHandoff', title: waitingLabel(w), state: null },
    groups: [items.map((i) => tipRow(leadIcon('ldNote'), [i.text], i.detail ? [quiet(i.detail)] : null)), [tipRow(leadIcon('ldDone'), [quiet(submitTip(w))])]].filter((g) => g.length),
  };
}

/* A call's press said back in a toast: an override's decision by what it did, else the press's word. */
export function callPressText(c, p, r, error) {
  const on = (c && c.id) || 'the call';
  if (error) return p.label + ' on ' + on + ' failed: ' + error;
  const recs = r && Array.isArray(r.records) && r.records.length ? ' (' + r.records.join(', ') + ')' : '';
  if (p.verb === 'overrideDecide' && r && r.dropped) return 'Cleared override #' + r.request + recs + ': it ' + r.dropped + ' unanswered, so nothing was applied.';
  if (p.verb === 'overrideDecide' && r && r.decision) {
    const kind = r.kind || (c && typeof c.change === 'string' ? c.change : '');
    return r.decision === 'allow'
      ? (OVERRIDE_DONE[kind] || 'Applied') + ': override #' + r.request + recs + '.' + (Array.isArray(r.unreached) ? ' The scrub could not reach ' + r.unreached.join('; ') + '; if it was a secret, rotate it.' : '')
      : 'Kept as written: override #' + r.request + recs + '.';
  }
  if (p.verb === 'overrideUnscrub' && r) {
    return (r.id || on) + ': the scrubbed text is back.' + (Array.isArray(r.left) ? ' Left as they are, since they changed after the scrub: ' + r.left.join(', ') + '.' : '');
  }
  return p.label + ' on ' + on + ': recorded.';
}

/* the local band's word that the board stopped answering (two missed beats),
 * '' while it answers; withOffline puts it on the model, a band of its own when nothing else draws.
 * A board that refuses this PC's protocol draws the health row that names the update instead. */
export function offlineLine(near) {
  if (!near || near.protocol || !(near.offline || near.stale || near.board)) return '';
  return typeof near.board === 'string' && near.board.trim() ? flatLine(near.board) : 'board offline';
}
export function withOffline(model, line) {
  if (line) return { ...(model || { questions: [], more: 0, total: 0, blocking: 0, waiting: 0 }), offline: line };
  if (!model || !model.offline) return model;
  const { offline: _gone, ...rest } = model;
  return rest;
}

/* several open questions collapse to a count line; its card
 * names them, so the line still says which. */
export const COUNT_MARK = '\u2753';
/* a band read whose questions were not a list: short on the band's count row, whole in its tooltip and on Home */
export const UNREAD_SHORT = 'not read';
export const UNREAD_WORDS = 'The questions could not be read from the board\'s answer; none are drawn until the next read.';
export function countTip(m) {
  const qs = (m && m.questions) || [];
  const more = (m && m.more) || 0;
  const tip = qs.map((q) => q.id + ' ' + q.name + (q.blocking ? ' (blocking)' : '')).join('; ') + (more ? '; and ' + more + ' more' : '');
  return m && m.unreadQuestions ? UNREAD_WORDS + (tip ? ' ' + tip : '') : tip;
}

const waitKey = (r) => r.handoff || r.track;
export const waitingKeys = (rows) => new Set(waitingRows(rows).map(waitKey));

/* Shelf rows waiting since the last read; nothing on the first read, so a
 * session start does not announce the whole shelf. A row the board marks
 * history (an import wrote it, nothing moved it since) is never announced. */
export function newlyWaiting(seen, rows) {
  if (!seen) return [];
  return waitingRows(rows).filter((r) => !seen.has(waitKey(r)) && !r.history);
}

/* The board server's alert route from any board URL the CLI printed, by the
 * loopback address its host guard admits. */
function loopBase(boardUrl) {
  const m = String(boardUrl || '').match(/^https?:\/\/[^/:]+:(\d+)\/([0-9a-f]{32})(?:\/|#|$)/);
  return m ? 'http://127.0.0.1:' + m[1] + '/' + m[2] + '/' : null;
}
export function alertUrl(boardUrl) {
  const b = loopBase(boardUrl);
  return b ? b + 'api/alert' : null;
}
/* the same server's local route (lib/local-route.mjs), `band?...` or `graph/WS-n` */
export function localUrl(boardUrl, path) {
  const b = loopBase(boardUrl);
  return b ? b + 'local/' + String(path || '').replace(/^\/+/, '') : null;
}

/* the held track's facts for the band's track row and the status row:
 * the local band's track when a local board answers for it, else `track mine`'s; the
 * counts from numbers only, `toGo` null where none says it. */
export function heldTrack(mine, local) {
  if (!mine || !mine.held) return null;
  const src = local && local.id === mine.track ? local : mine;
  const count = (n, list) => (Number.isFinite(n) ? n : Array.isArray(list) ? list.length : 0);
  const num = (n) => (Number.isFinite(n) ? n : null);
  return {
    id: mine.track, name: flatLine(src.name || mine.name) || mine.track, state: src.state || mine.state || '',
    chain: flatLine(src.chain || mine.chain), now: Array.isArray(src.now) ? src.now : [],
    /* the board's counts as sent, by each task's word */
    running: num(src.running) || 0, unconfirmed: num(src.unconfirmed) || 0, ready: count(src.ready, src.readySet), toGo: Number.isFinite(src.toGo) ? src.toGo : null,
    url: String(src.url || mine.url || ''),
    /* what the track's tooltip says beside the counts */
    stalled: src.stalled === true, hold: src.hold || mine.hold || null, readySet: Array.isArray(src.readySet) ? src.readySet : [],
    critical: src.critical && Array.isArray(src.critical.path) ? src.critical.path : [], done: num(src.done), total: num(src.total),
    since: (src.holder && src.holder.since) || null, session: (src.holder && src.holder.session) || null,
    workstream: src.workstream || mine.workstream || '', workstreamName: flatLine(src.workstreamName),
    goal: flatLine(src.goal || mine.goal), goalRestated: src.goalRestated || mine.goalRestated || null,
  };
}

/* what `track mine` answered, from the local band in the same call: the held track and
 * its workstream's open tracks from the band's graph, each with its last handoff. */
export function mineOf(near) {
  const t = near && near.track;
  if (!t || !t.id) return { held: false, track: null, workstream: null, tracks: [] };
  const hs = (near && near.handoffs) || {};
  const views = near.graph && near.graph.view && Array.isArray(near.graph.view.tracks) ? near.graph.view.tracks : [t];
  /* the Tracks tab draws the view's own fields, so they stay */
  const row = (v) => ({ id: v.id, key: v.key, name: v.name, state: v.state, stalled: v.stalled, hold: v.hold || null, noHandoff: v.noHandoff, parkReason: v.parkReason, unpark: v.unpark,
    text: v.text, now: v.now, names: v.names, chain: v.chain, holder: v.holder, handoff: hs[v.id] || null, goal: v.goal || null, goalRestated: v.goalRestated || null, url: v.url,
    quietSince: v.quietSince || null, readySet: v.readySet, critical: v.critical, toGo: v.toGo, done: v.done, total: v.total, tasks: v.tasks });
  return { held: true, track: t.id, key: t.key, url: t.url, name: t.name, workstream: t.workstream || null, workstreamName: t.workstreamName || '',
    state: t.state, text: t.text, chain: t.chain, hold: t.hold || null,
    running: t.running, unconfirmed: t.unconfirmed, ready: t.ready, toGo: t.toGo, now: t.now, readySet: t.readySet, junction: t.junction, tracks: views.map(row) };
}

/* the system stack's widths in the pane's Svg (Segoe UI, measured in Edge 2026-10-25), per
 * 1 px of size, ASCII 32 to 126 then the ellipsis and the middle dot, base 36 in thousandths;
 * 450 draws as 400, 550 as 600, 650 as 700 */
const PANE_WIDTHS = {
  400: '7m7wawgfezmqm86e8e8eblj061b461auezezezezezezezezezez6161j0j0j0cgqjhxfxh7jhe2dkj2jq7e9xg4d3oykskyfkkygmerekj3h9pygefdfu8eaj8ej0bj7ge5gccugdej8pgdfq6q6qdt6qnxfqgagcgd9obs9ffqdbk3crdgck8e6n8ej0kd61',
  600: '7n8gc6gfffncjv769898c2ja6pb66pbiffb6ffffg0fffiewfffi6p6pjajajaccqjingsh9jxeedyjdkf84b0gzdlpolbl0g8l0hbf4fcjjhuquh7g1gb98b998jabj81eigrd2grer9lgrg67979el79omg7glgrgraabza1g7e3l0dxe4cw987q98jaml6p',
  700: '7o93dpggfzo3nm85a9a9cnjn7jb87jcbfzfzfzfzfzfzfzfzfzfz7j7jjnjnjnc6qijjhthckhesegjrla8tcdi1e7qllyl2h2l2i5flgak3ijrxi7gvgva9c4a9jnbj8qeyh8dch7f1anh7gq7w7wfj7wpggtgzh8h7b2c8atgtf2m5fceydba992a9jnpc7j',
};
const widthRows = {};
export function paneMeasure(text, size, weight) {
  const wt = weight < 500 ? 400 : weight < 650 ? 600 : 700;
  const row = widthRows[wt] || (widthRows[wt] = PANE_WIDTHS[wt].match(/../g).map((x) => parseInt(x, 36) / 1000));
  let w = 0;
  for (const ch of String(text)) {
    const c = ch.codePointAt(0);
    w += c >= 32 && c < 127 ? row[c - 32] : ch === '\u2026' ? row[95] : ch === '\u00b7' ? row[96] : c >= 0x2e80 ? 1 : row[46];
  }
  return w * size;
}
/* a pane Text's Anthropic Sans runs up to 9% wider than the system font paneMeasure reads
   (desktop-capabilities), so words fitted to a width measure with this */
export const textMeasure = (text, size, weight) => paneMeasure(text, size, weight) * 1.1;

/* the picture's limits in the pane's Svg (desktop-capabilities 2f): past them it is dropped */
const SVG_CHARS = 131072;
const SVG_PX = 4096;
const r2 = (x) => Math.round(x * 100) / 100;

/* Home's "Where we stand", the redrawn picture at its three levels (0 the
 * Overview, 1 the workstream, 2 a track) from the band: the held track's workstream, or with no
 * track held the project's, whose `why` says so and names the others. view: the level the
 * session is on ({ level, ws, tr, sel }), else the held track's lines; looks: the last look's
 * moment by 'overview' or workstream, `lookFor` naming the one this draw wants; far: another
 * workstream's graph the Overview zoomed into (local/graph/WS-n), drawn beside the band's; pc: this PC's name. */
export function homeGraph({ graph, overview, mine, far, local, view, looks, icons, boardUrl, columns, cell = 8.453, draw = true, now = Date.now(), pc = '' } = {}) {
  const held = mine && mine.held ? mine.track : null;
  const unheld = !held && !!(graph && graph.unheld);
  const ws = (graph && graph.workstream) || (mine && mine.workstream) || '';
  const out = { workstream: ws, held, unheld, level: null, view: null, lookFor: null, lines: [], why: '',
    views: [], crumbs: [], since: null, strip: null, picture: null, more: null, legend: [] };
  if (!local) return { ...out, why: 'The local board is not answering, so nothing is drawn.' };
  if (!held && !unheld) return { ...out, why: 'This session holds no track, so there is no line to draw.' };
  if (!graph || !graph.view || !Array.isArray(graph.view.tracks)) return { ...out, why: 'The local board has no picture of ' + (ws || 'this workstream') + ' yet.' };
  const page = pageOf(local);
  out.workstreamUrl = ws ? page({ id: ws }) : '';
  const own = { ...graph.view, workstream: ws, name: graph.name || graph.view.name || '' };
  const other = far && far.view && Array.isArray(far.view.tracks) && far.workstream && far.workstream !== ws
    ? { ...far.view, workstream: far.workstream, name: far.name || far.view.name || '' } : null;
  const base = pictureOf({ views: other ? [own, other] : own, extras: [graph.picture, other && far.picture].filter(Boolean),
    overview: overview || null, held, pc, at: new Date(now).toISOString() });
  const inboxIn = (id) => wsInbox(id === ws ? own : other && id === other.workstream ? other : null, page(base.ws[id] || { id }), page, now);
  const tracks = base.ws[ws] ? base.ws[ws].tracks : [];
  out.lines = tracks.map((t) => ({ id: t.id, name: flatLine(t.name), words: t.words, counts: t.open + ' open, ' + t.done + ' done', url: page(t) }));
  if (!tracks.length) return { ...out, why: 'Every line in ' + ws + ' is finished: nothing left to draw.', inbox: inboxIn(ws) };
  if (unheld) {
    const list = (Array.isArray(graph.others) ? graph.others : []).filter((o) => o && o.id);
    const others = list.map((o) => flatLine(o.id + ' ' + (o.name || '')));
    const name = flatLine(ws + ' ' + (graph.name || ''));
    out.why = 'This session holds no track, so this is all of ' + name + '.' + (others.length ? ' Also open in this project: ' + others.join(', ') + '.' : '');
    /* the same words, each workstream named a link to its page */
    const link = (text, id) => { const href = page({ id }); return href ? { text, href } : { text }; };
    out.whyParts = [{ text: 'This session holds no track, so this is all of ' }, link(name, ws), { text: '.' },
      ...(others.length ? [{ text: ' Also open in this project: ' }, ...others.flatMap((o, i) => [link(o, list[i].id), { text: i < others.length - 1 ? ', ' : '.' }])] : [])];
  }
  const home = held && tracks.some((t) => t.id === held) ? { level: 2, ws, tr: held, sel: null } : { level: 1, ws, tr: null, sel: null };
  const V = viewIn(base, view, home);
  out.lookFor = V.level === 0 ? 'overview' : V.ws;
  const look = looks && typeof looks[out.lookFor] === 'string' ? looks[out.lookFor] : null;
  const P = look ? sinceLook(base, look) : base;
  /* the views pair is the held track's, so another workstream draws without it */
  const drawn = panePicture(P, V, { held: V.ws === ws ? base.ws[ws].held : null, local, icons, boardUrl, columns, cell, draw });
  /* the picture's inbox at the workstream level; the terminal's lines are always the band's workstream */
  return { ...out, ...drawn, inbox: !draw ? inboxIn(ws) : V.level === 1 ? inboxIn(V.ws) : null };
}

/* a workstream's loose tasks as the board's line words them: the count, amber with the
   stall words past the stall setting; none when empty or from a board older than the inbox.
   tasks: each with its page, null from a board that sends no list, whose press opens the board's panel (panel).
   each with its wake in words, the due first and counted; a day that came since the read is due too */
function wsInbox(view, panel, page, now = Date.now()) {
  const n = view && Number.isInteger(view.inbox) ? view.inbox : 0;
  if (n <= 0) return null;
  const warn = view.inboxStalled === true;
  const days = Number.isInteger(view.stallDays) ? view.stallDays : null;
  const rest = (warn ? ', stalled' + (days !== null ? ': nothing moved for over ' + plural(days, 'day', 'days') : '') : '') + ', waiting for a triage pass with you';
  const d = new Date(now);
  const today = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const tasks = Array.isArray(view.inboxList)
    ? view.inboxList.filter((t) => t && t.id).map((t) => {
      const due = t.due === true || !!(t.wake && t.wake.date && t.wake.date <= today);
      return { id: t.id, name: flatLine(t.name), href: page(t), wake: wakeText(t.wake, due), due };
    }).sort((a, b) => b.due - a.due) : null;
  const due = tasks ? tasks.filter((t) => t.due).length : 0;
  return { count: 'Inbox ' + n, due: due ? ', ' + due + ' due' : '', rest, warn, href: panel ? panel + '#inbox' : '', tasks };
}

/* a record's page as the desktop opens it, through the local server's signed route */
const pageOf = (local) => (x) => (x ? recordHref(local, x.key || x.id, x.url) || '' : '');

/* the view asked for where the picture can draw it, else home; a selection of something gone clears */
function viewIn(P, v, home) {
  if (!v || ![0, 1, 2].includes(v.level)) return home;
  const V = { level: v.level, ws: v.ws || home.ws, tr: v.level === 2 ? v.tr || null : null, sel: v.sel || null };
  if (V.level === 0 && !P.ov.length) return home;
  if (V.level > 0 && !P.ws[V.ws]) return home;
  if (V.level === 2 && !P.ws[V.ws].tracks.some((t) => t.id === V.tr)) return home;
  if (V.sel && !detail(P, V, V.sel)) V.sel = null;
  return V;
}

const trackIn = (P, id) => Object.values(P.ws).flatMap((w) => w.tracks).find((t) => t.id === id) || null;
function recordIn(P, id) {
  return P.tasks[id] || P.ans[id] || P.ws[id] || trackIn(P, id) || P.ov.find((o) => o.id === id) || { id };
}

/* what a press does, for the pane to carry out: a view to step to (select keeps the level, zoom
   moves it), or a record to open (its href the board page), its finished list, or a question to answer */
function actOf(P, V, k, page) {
  if (!k) return null;
  const i = k.indexOf(':'), kind = k.slice(0, i), id = k.slice(i + 1);
  const open = (x) => ({ kind: 'open', id: x, href: page(recordIn(P, x)) });
  /* a second press on an answer chip opens its question, as a station's opens its task */
  if (kind === 'ans' && V.sel === k) return open(id);
  const r = pressView(P, V, k);
  if (r.view) return { kind: r.view.level === V.level && r.view.ws === V.ws && r.view.tr === V.tr ? 'select' : 'zoom', view: r.view };
  /* a workstream with tracks the band did not carry zooms too: the pane reads it first */
  const ov = r.open && /^WS-\d+$/.test(r.open) ? P.ov.find((o) => o.id === r.open) : null;
  if (ov && ov.opens && !P.ws[r.open]) return { kind: 'zoom', view: { level: 1, ws: r.open, tr: null, sel: null }, read: r.open, href: page(ov) };
  if (r.open) return open(r.open);
  /* its finished list, the details the board's track page opens at #done */
  if (r.list) { const href = page(trackIn(P, r.list) || { id: r.list }); return { kind: 'list', id: r.list, href: href ? href + '#done' : '' }; }
  if (r.answer) return { kind: 'answer', id: r.answer, href: page({ id: r.answer }) };
  /* copy: the board's own address, which the pane has no use for */
  return null;
}

const fits = (r) => r.svg.length <= SVG_CHARS && r.w <= SVG_PX && r.h <= SVG_PX;

/* what a level draws, in the order it draws them, so a cut keeps the first */
function cutOrder(P, V) {
  if (V.level === 0) return P.ov.map((o) => o.id);
  const Wd = P.ws[V.ws];
  if (V.level === 1) return [...Wd.tracks.filter((t) => t.state !== 'parked'), ...Wd.tracks.filter((t) => t.state === 'parked')].map((t) => t.id);
  const ids = Object.keys(P.tasks).filter((id) => P.tasks[id].tr === V.tr && P.tasks[id].st !== 'done');
  const own = new Set(ids), spine = (trackIn(P, V.tr) || {}).spine || [];
  const waits = (id) => (P.tasks[id].waits || []).filter((w) => own.has(w));
  const freed = new Set(ids.flatMap(waits));
  const depth = new Map();
  const at = (id, seen = new Set()) => {
    if (depth.has(id)) return depth.get(id);
    seen.add(id);
    const d = Math.max(-1, ...waits(id).filter((w) => !seen.has(w)).map((w) => at(w, seen))) + 1;
    depth.set(id, d);
    return d;
  };
  /* the drawing lists a station nothing waits on and that waits on nothing last */
  const alone = (id) => !waits(id).length && !freed.has(id) && !spine.includes(id);
  const num = (id) => Number(String(id).replace(/\D/g, '')) || 0;
  return ids.sort((a, b) => alone(a) - alone(b) || at(a) - at(b) || (spine.includes(a) ? 0 : 1) - (spine.includes(b) ? 0 : 1) || num(a) - num(b));
}
function cutOut(P, V, gone) {
  const out = new Set(gone);
  if (V.level === 0) return { ...P, ov: P.ov.filter((o) => !out.has(o.id)) };
  if (V.level === 1) return { ...P, ws: { ...P.ws, [V.ws]: { ...P.ws[V.ws], tracks: P.ws[V.ws].tracks.filter((t) => !out.has(t.id)) } } };
  return { ...P, tasks: Object.fromEntries(Object.entries(P.tasks).filter(([id]) => !out.has(id))) };
}

/* one view of P as the pane draws it, for the pane's width: the views pair under the heading
 * (a held track's lines, level 2, and the whole workstream, level 1), the crumbs, the since words,
 * the picture with a press zone per pressable thing and the ground's clear, the strip of the
 * selection, the legend's marks. Past the Svg's limits the picture keeps what fits, the rest one
 * "+N more on the board" row that opens the board's page. */
export function panePicture(P, V, { held = null, local, icons, boardUrl, columns, cell = 8.453, draw = true } = {}) {
  const page = pageOf(local);
  const act = (k) => actOf(P, V, k, page);
  const out = { level: V.level, view: V };
  out.views = held && V.level > 0 ? [
    { key: 'mine', label: "My track's lines", on: V.level === 2 && V.tr === held, act: { kind: V.level === 2 ? 'select' : 'zoom', view: { level: 2, ws: V.ws, tr: held, sel: null } } },
    { key: 'all', label: 'Whole workstream', on: V.level === 1, act: act('lvl:1') },
  ] : [];
  /* an Overview the band did not carry is no step to offer */
  out.crumbs = pictureCrumbs(P, V, { pane: true }).filter((c) => c.k !== 'lvl:0' || P.ov.length).map((c) => ({ words: c.words, act: act(c.k) }));
  /* at a track's level the user's hold rides its crumb, from the board's track view */
  const shown = V.level === 2 ? trackIn(P, V.tr) : null;
  out.hold = shown && shown.hold ? HOLD_WORDS : '';
  out.since = sinceWords(P, V, { pane: true });
  const d = V.sel ? detail(P, V, V.sel) : null;
  out.strip = d ? {
    key: V.sel, title: (d.id ? d.id + ' ' : '') + d.name,
    chips: d.chips.map(([words, kind]) => ({ words, warn: kind === 'gated' || kind === 'stalled' })),
    facts: d.facts.map(([label, v]) => ({ label, lines: Array.isArray(v) ? v : [v] })),
    acts: d.acts.map((a, i) => ({ label: a.label, primary: i === 0, ...(a.answer ? { answer: true } : {}), act: act(a.k) })),
  } : null;
  out.picture = null;
  out.more = null;
  out.legend = [];
  if (!draw) return out;
  /* the 480 px tile's width when the pane reports none; never past the Svg's 4096 px; whole px
     down, since the drawing rounds its width up and must not run past the body */
  const width = Math.min(SVG_PX, Number(columns) > 0 ? Math.floor(Number(columns) * cell) : 438);
  const opt = { skin: 'pane', width, measure: paneMeasure, icons: { ...(icons || {}), portal: ICONS.portal[0] }, top: 8 };
  let r = drawPicture(P, V, opt);
  if (!fits(r)) {
    const items = cutOrder(P, V);
    let lo = 0, hi = items.length - 1, best = null;
    while (lo <= hi) {
      const k = (lo + hi) >> 1, c = drawPicture(cutOut(P, V, items.slice(k)), V, opt);
      if (fits(c)) { best = { r: c, n: items.length - k }; lo = k + 1; } else hi = k - 1;
    }
    if (!best) return { ...out, why: 'The picture is too big for the pane; the board draws it.' };
    r = best.r;
    const href = V.level === 0 ? cardHref(boardUrl) || cardHref(signedRoot(local)) || '' : page(V.level === 1 ? P.ws[V.ws] : trackIn(P, V.tr));
    out.more = { n: best.n, words: '+' + best.n + ' more on the board', href };
  }
  const alt = V.level === 0 ? 'Where every workstream stands' : V.level === 1 ? 'Where we stand in ' + V.ws + ', each track a pill' : 'Where ' + V.tr + ' stands in ' + V.ws + ', each station a task';
  out.picture = {
    source: r.svg, width: r.w, height: r.h, alt: alt + ', as a drawn picture',
    zones: r.hits.map((h) => ({ k: h.k, x: r2(h.x), y: r2(h.y), w: r2(h.w), h: r2(h.h), act: act(h.k) })),
    /* the ground's press clears a selection */
    clear: V.sel ? { kind: 'select', view: { ...V, sel: null } } : null,
  };
  /* each meaning in lines that fit the pane beside its mark, a cell from it; cells is the entry's width */
  out.legend = pictureLegend(P, V, 'pane', { measure: paneMeasure, sideFold: r.sideFold, wrap: { width, gap: cell, px: 14, measure: textMeasure } }).map((e) => {
    const [, w, h] = e.svg.match(/width="([\d.]+)" height="([\d.]+)"/) || [];
    const cells = (Number(w) + cell + Math.max(...e.lines.map((l) => textMeasure(l, 14, 400)))) / cell;
    return { key: e.words, source: e.svg, alt: capFirst(e.words) + ', as the picture draws it', width: Number(w), height: Number(h), words: e.words, lines: e.lines, cells };
  });
  return out;
}

/* The tray's context line in names: empty names are left out. */
export function whereNames(names = {}) {
  const out = {};
  for (const k of ['project', 'workstream', 'track', 'holds']) {
    const v = flatLine(names[k]).slice(0, 60);
    if (v) out[k] = v;
  }
  return out;
}

/* A project's name for the tray: the directory's last part. */
export const projectName = (dir) => String(dir || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || '';

export function trackAlert(row, names = {}) {
  const id = row.track;
  const name = flatLine(row.name) || id;
  return {
    kind: 'track', title: (name + ' is waiting: ' + flatLine(row.focus)).slice(0, 120),
    where: name.slice(0, 80), card: row.handoff || id,
    whereNames: whereNames({ ...names, track: name }),
  };
}

/* A handoff written: the track's name leads. */
export function handoffAlert({ name, track, id, percent, focus, names = {} }) {
  const who = flatLine(name) || track;
  const title = who + ' handed off' + (typeof percent === 'number' ? ' at ' + percent + ' percent' : '') + ': ' + flatLine(focus);
  return {
    kind: 'handoff', title: title.slice(0, 120), where: who.slice(0, 80), card: id || track,
    whereNames: whereNames({ ...names, track: who }),
  };
}

export function waitingToast(row) {
  const id = row.track;
  return id + ' ' + flatLine(row.name) + ' is waiting: ' + flatLine(row.focus) + '. Resume it with /askerdo resume ' + id + '.';
}

/* where the band draws, the model writes no names line of its own. */
export const bandSection = () => 'The AskerDo mod draws a Needs-you band above ' + nameOf() + '\'s prompt: this project\'s open questions '
  + '(one as a row with answer buttons, several as a count line) and what waits for this session with a submit button, '
  + 'kept current as the board changes; the status line '
  + 'under the prompt (on the desktop app, the last row of the band) carries the meters, the guard, the track this session holds, its newest task in hand and the shelf, and ends with an AskerDo press that '
  + 'opens the AskerDo pane (Home, Questions and Tracks; also /askerdo home). In this session the '
  + 'band carries the queue: write no names line (the open-questions line) in a reply, and no remark that none are open. '
  + 'Name a question in a reply only where the reply is about it.';

export const bandSurfaces = (surfaces) => (surfaces || []).some((s) => s === 'terminal' || s === 'desktop');

/* the per-surface section a session gets: the desktop's own session server
   among its tools (the contract's tell is the tool set), or a session drawn on the
   desktop alone; anything else takes the stricter terminal section. */
const SESSION_SERVER = 'mcp__ccd_session__';
const hasSessionServer = (tools) => (tools || []).some((t) => typeof t === 'string' && t.startsWith(SESSION_SERVER));
export function surfacePick(surfaces, tools) {
  if (hasSessionServer(tools)) return 'desktop';
  const on = surfaces || [];
  return on.includes('desktop') && !on.includes('terminal') ? 'desktop' : 'terminal';
}

/* a reading that names surfaces, none drawing a band, with no desktop tools (the phone
   over Remote Control, desktop-capabilities): nothing carries the queue, so the names line stays */
export const noBandHere = (surfaces, tools) => !!(surfaces && surfaces.length) && !bandSurfaces(surfaces) && !hasSessionServer(tools);
export const noBandSection = () => '**Where no band draws.** ' + capFirst(nameOf()) + ' reads this session where no Needs-you band draws '
  + '(the phone over Remote Control shows none), so here the band does not carry the queue: a reply ends with the names line '
  + 'wherever the question queue rule asks for one, as a session without the mod does, and the band section\'s word against it gives way.';

/* ---- the AskerDo pane: every view a tab of one pane ---- */

export const PANE_ID = 'askerdo';
export const PANE_TITLE = 'AskerDo';
/* the older pane ids: one a session still has up draws this pane */
export const OLD_PANE_IDS = Object.freeze(['askerdo-threads', 'askerdo-questions']);
export const PANE_TABS = Object.freeze([['home', 'Home'], ['questions', 'Questions'], ['tracks', 'Tracks'], ['settings', 'Settings'], ['guide', 'Guide']]);

/* ---- the Tracks tab ------------------------------------- */

const CLOSED_STATES = ['done', 'dropped', 'folded'];

export function ageText(ms) {
  const m = Math.max(0, Math.floor(ms / 60000));
  if (m < 60) return m + 'm';
  const h = Math.floor(m / 60);
  return h < 48 ? h + 'h' : Math.floor(h / 24) + 'd';
}

const MID = ' \u00b7 ';
const ELLIPSIS = '\u2026';

/* ---- the Tracks tab's model ---- */

const qLabel = (id) => { const n = /^Q-?(\d+)$/i.exec(String(id || '').trim()); return n ? 'Q' + n[1] : ''; };
/* the questions a line names, read as the kickoff reads them (server/verbs/kickoff.mjs) */
const namedQuestions = (text) => [...String(text || '').matchAll(/\bQ-?(\d+)\b/gi)].map((x) => 'Q' + x[1]);
/* a line naming a question the track lists, or one no longer open, waits no more;
   with no asks read nothing says what is open, so every line stays */
const stillWaiting = (lines, listed, open) => (Array.isArray(lines) ? lines : []).map(flatLine)
  .filter((l) => l && !namedQuestions(l).some((id) => listed.has(id) || (open && !open.has(id))));
const ageOf = (iso, now) => { const t = Date.parse(iso || ''); return Number.isFinite(t) && Number.isFinite(now) ? ageText(now - t) : ''; };
const firstSet = (...xs) => xs.find((x) => x !== undefined && x !== null && x !== '');
const TILE_YOU_MAX = 2;
const LIVE_HANDOFF = ['waiting', 'parked'];
const READY_MAX = 2;
export const TRACKS_NONE_NOTE = 'A track is a line of work one session holds. Start one with /askerdo track new WS-n name.';
export const TRACKS_OFFLINE = 'Board offline: drawn from this PC\'s last copy';

/* a tile's or the card's press: copy the resume command while this session holds a track
   (one session holds one), else resume here; a quiet track's is the take-over */
function trackPress(id, name, takeOver, resume, holding) {
  const command = resume || '/askerdo resume ' + id + (takeOver ? ' --take-over' : '');
  if (!holding) return { kind: 'resume', takeOver, command, label: takeOver ? 'Take over' : 'Resume here', short: takeOver ? 'Take over' : 'Resume here', primary: false };
  return {
    kind: 'copy', takeOver, command, label: takeOver ? 'Copy take-over command' : 'Copy resume command', short: takeOver ? 'Copy take-over' : 'Copy resume',
    copied: 'Copied: paste it into a new session to ' + (takeOver ? 'take over ' : 'pick up ') + name + '.',
    failed: 'Could not copy: type ' + command + ' in a new session.',
  };
}

/* One track as the card or a tile draws it, from the band's view row, the workstream view and the
 * shelf row (any may be missing). `groups` are the tooltip's fact rows: the card's
 * where, how far, you and the handoff; a tile's one group. A part's `clamp` is its rows under
 * 80 cells (`clampWide` from 80), `ask` a question its words open, a bar's `pic.max` the draw's. */
function trackShape(row, view, s, ctx) {
  const r = row || {};
  const v = view || r;
  const sh = s || {};
  const now = ctx.now;
  const id = firstSet(r.id, sh.track);
  const name = flatLine(firstSet(r.name, v.name, sh.name)) || id;
  const state = firstSet(v.state, r.state, sh.state) || '';
  const stalled = !!firstSet(v.stalled, r.stalled, sh.stalled);
  const hold = firstSet(v.hold, r.hold, sh.hold) || null;
  const holder = firstSet(v.holder, r.holder, sh.holder) || null;
  const quietSince = firstSet(v.quietSince, r.quietSince, sh.quietSince) || '';
  const workstream = firstSet(row ? ctx.heldWs : '', sh.workstream) || '';
  const workstreamName = ctx.names[workstream] || flatLine(sh.workstreamName);
  const held = ctx.holding && id === ctx.heldId;
  const isQuiet = !held && state === 'active' && !!quietSince;
  const section = held ? 'held' : state === 'parked' ? 'parked' : state === 'active' ? 'elsewhere' : 'pickup';
  const h = r.handoff || ctx.handoffs[id] || (sh.handoff ? { id: sh.handoff, status: sh.handoffStatus, focus: sh.focus, created: sh.created } : null);
  /* a handoff's waits count while it is live, and on the track a session holds since its resume,
     until the next handoff drops them (a let-go track's resumed handoff counts none) */
  const liveH = h && (!h.status || LIVE_HANDOFF.includes(h.status) || (h.status === 'resumed' && (held || state === 'active')));
  const lines = !liveH ? [] : Array.isArray(h.waitingOnUser) ? h.waitingOnUser : sh.handoff === h.id ? sh.waitingOnUser : [];
  const asks = blockingFirst(((ctx.asked && ctx.asked[id]) || []).filter((q) => q && q.id && !q.snoozed).map((q) => ({ id: q.id, name: flatLine(q.name), blocking: q.blocking === true })));
  const waits = stillWaiting(lines, new Set(asks.map((q) => qLabel(q.id))), ctx.open);
  const age = h && h.created ? ageOf(h.created, now) : flatLine(sh.age);
  const split = { now: Array.isArray(firstSet(v.now, r.now)) ? firstSet(v.now, r.now) : [], ready: Array.isArray(firstSet(v.readySet, r.readySet)) ? firstSet(v.readySet, r.readySet) : [] };
  const nowList = split.now;
  const readySet = split.ready;
  const crit = firstSet(v.critical, r.critical);
  const critical = Array.isArray(crit) ? crit : crit && Array.isArray(crit.path) ? crit.path : [];
  const toGoN = firstSet(v.toGo, r.toGo);
  const toGo = Number.isFinite(toGoN) ? toGoN : critical.length;
  const doneN = firstSet(v.done, r.done, sh.done);
  const totalN = firstSet(v.total, r.total, sh.total);
  const done = Number.isFinite(doneN) ? doneN : 0;
  const total = Number.isFinite(totalN) ? totalN : 0;
  /* the review readout: uncovered done cells amber, a held finish a padlock, due in the state */
  const rv = firstSet(v.review, r.review) || null;
  const unreviewed = rv && Array.isArray(rv.uncovered) ? rv.uncovered.length : 0;
  const progress = total > 0 ? progressOf(stationsOf(v, now), { done, total, now: nowList, readySet, unreviewed, locked: !!(rv && rv.locked && !rv.planned) }) : null;
  /* a station row's name opens its board page */
  const urlOf = (x) => { const o = (v.tasks || []).find((y) => y.id === x.id) || x; return recordHref(ctx.local, o.key || o.id, o.url) || ''; };
  const named = (x) => { const href = urlOf(x); return href ? { text: nameItem(x), href } : nameItem(x); };

  const st = hold ? { text: HOLD_WORDS + (held ? MID + 'this session' : ''), tone: 'amber' }
    : held ? { text: 'active' + MID + 'this session', tone: 'sky' }
    : isQuiet ? { text: 'quiet' + (ageOf(quietSince, now) ? ' ' + ageOf(quietSince, now) : ''), tone: 'amber' }
      : state === 'active' ? { text: 'active' + MID + 'another session', tone: 'sky' }
        : state === 'new' ? { text: 'new' + MID + 'not started', tone: 'dim' }
          : { text: (stalled && state === 'waiting' ? 'stalled' : state) + (age ? MID + age : ''), tone: stalled ? 'amber' : 'dim' };
  const shown = rv && rv.due && !isQuiet && !hold ? { text: 'review due' + (st.text.includes(MID) ? MID + st.text.split(MID).slice(1).join(MID) : ''), tone: 'amber' } : st;
  const rails = held || (state === 'active' && !isQuiet) ? 'sky' : isQuiet || stalled ? 'amber' : 'dim';
  const head = { icon: 'thread', tone: rails, id, name, title: id + ' ' + name, state: shown };

  /* the workstream's id and name open its page */
  const wsHref = workstream ? recordHref(ctx.local, workstream) || '' : '';
  const wsLink = wsHref ? { href: wsHref } : {};
  const wsRow = tipRow(leadIcon('ldFolder'), workstream ? [{ ...quiet(workstream + ' '), ...wsLink }, workstreamName ? { text: workstreamName, clamp: 1, ...wsLink } : ''] : [quiet('Workstream not read yet')]);
  /* each row says the board's word, the session's own run "this session" */
  const look = { at: now, self: held ? (holder && holder.session) || null : ctx.self, tasks: v.tasks };
  const nowRow = (n) => wordRow(n, named(n), { ...look, fall: 'running' });
  const nameOf = viewNameOf(v.tasks ? v : r);
  const youRows = (max) => {
    const rows = [...asks.map((q) => askRow(q, true)), ...waits.map((w) => tipRow(leadIcon('ldWaits', 'amber'), idParts(w, ctx.local, { tone: 'amber', clamp: 2 })))];
    if (!max || rows.length <= max) return rows;
    const kept = rows.slice(0, max);
    const last = kept[max - 1];
    kept[max - 1] = { ...last, lines: [...last.lines, tipLine([quiet('and ' + (rows.length - max) + ' more')])] };
    return kept;
  };
  const focusClamp = section === 'parked' ? { clamp: 1, clampWide: 1 } : { clamp: 2, clampWide: 3 };
  const handoffRow = () => {
    if (!h) return tipRow(leadIcon('ldHandoff'), [quiet(state === 'new' ? 'Not started yet' : 'No handoff yet; its tasks say where it stands')]);
    const picked = h.status === 'resumed';
    const ago = ageOf(picked ? h.resumed || h.created : h.created, now);
    const words = (picked ? (held ? 'Picked up here' : 'Picked up') : 'Handed off') + (ago ? ' ' + ago + ' ago' : '') + ': ';
    return tipRow(leadIcon('ldHandoff'), [quiet(words), { text: flatLine(h.focus), ...focusClamp }]);
  };

  let groups;
  if (held) {
    const ready = readySet.slice(0, READY_MAX).map((t) => wordRow(t, named(t), { ...look, fall: 'ready' }));
    if (readySet.length > READY_MAX) {
      const last = ready[READY_MAX - 1];
      ready[READY_MAX - 1] = { ...last, lines: [...last.lines, tipLine([quiet('and ' + (readySet.length - READY_MAX) + ' more ready')])] };
    }
    const far = !progress && !nowList.length && !readySet.length ? [tipRow(leadIcon('ldDone'), [quiet('No tasks on this track yet')])]
      : [progress ? barRow(progress) : null, ...nowList.map(nowRow), ...ready, flagRow(toGo, critical, nameOf, (id) => urlOf({ id }))].filter(Boolean);
    const goalAt = goalRow(flatLine(firstSet(v.goal, r.goal, sh.goal)), firstSet(v.goalRestated, r.goalRestated), now, (x) => ({ text: x, clamp: 2, clampWide: 3 }));
    groups = [[wsRow, tipRow(leadIcon('ldClock'), heldFor('Held here', holder && holder.since, now)), goalAt].filter(Boolean), far, [...youRows(0), handoffRow()]];
  } else {
    const seen = holder ? (isQuiet ? quietSince : holder.seen || holder.since) : '';
    const seenRow = section === 'elsewhere' ? tipRow(leadIcon('ldClock', isQuiet ? 'amber' : 'dim'),
      [(isQuiet ? 'Its session went quiet' : 'Seen') + (ageOf(seen, now) ? ' ' + ageOf(seen, now) + ' ago' : ''), quiet(holder && holder.pc ? ', on ' + holder.pc : '')]) : null;
    const goal = flatLine(firstSet(v.goal, r.goal, sh.goal));
    /* what opens it again, the board's words, after the reason */
    const unpark = flatLine(firstSet(v.unpark, r.unpark, sh.unpark));
    groups = [[
      !ctx.holding || workstream !== ctx.heldWs ? (workstream ? wsRow : null) : null,
      section === 'parked' ? tipRow(leadIcon('ldWaits'), [quiet('Parked: '), flatLine(firstSet(v.parkReason, r.parkReason, sh.parkReason)) || quiet('no reason given'),
        unpark ? quiet('; opens again ') : '', unpark]) : null,
      ...youRows(TILE_YOU_MAX),
      ...(section === 'elsewhere' ? nowList.map(nowRow) : []),
      seenRow,
      state === 'new' ? tipRow(leadIcon('ldIntent'), goal ? [quiet('Goal: '), { text: goal, clamp: 2 }] : [quiet('No goal written yet')]) : null,
      state === 'new' && !h ? null : section === 'elsewhere' && !isQuiet ? null : handoffRow(),
      looseRow(sh, section),
      progress ? barRow(progress) : null,
    ].filter(Boolean)];
  }
  return {
    id, key: firstSet(r.key, v.key, sh.key) || null, name, url: recordHref(ctx.local, firstSet(r.key, v.key, sh.key) || id, firstSet(v.url, r.url, sh.url)), section, state, stalled, hold, quiet: isQuiet,
    quietSince, noHandoff: !!firstSet(v.noHandoff, r.noHandoff, sh.noHandoff), parkReason: flatLine(firstSet(v.parkReason, r.parkReason, sh.parkReason)),
    goal: flatLine(firstSet(v.goal, r.goal, sh.goal)), workstream, workstreamName, holder, head, asks, waits,
    handoff: h ? { id: h.id, status: h.status, focus: flatLine(h.focus), created: h.created || null, age } : null,
    progress, now: nowList, readySet, toGo, critical, groups,
    found: foundOf(firstSet(v.found, r.found), ctx.local),
    press: held || (section === 'elsewhere' && !isQuiet) ? null : trackPress(id, name, isQuiet, sh.resume, ctx.holding),
  };
}

/* the found row's unplaced ids with their board pages */
function foundOf(f, local) {
  if (!f) return null;
  const ids = Array.isArray(f.unplacedIds) ? f.unplacedIds : [];
  return { ...f, unplacedUrls: ids.map((id) => recordHref(local, id) || '') };
}

/* a track nobody resumes counts its due loose files, worktree groups, worktrees holding work
   and merged branches (the local board reads them from this PC's lists), which its next kickoff
   lists to judge; a count per kind, never a question */
function looseRow(sh, section) {
  if (section !== 'pickup' && section !== 'parked') return null;
  const w = sh.worktreesDue || {};
  const kinds = [[sh.looseDue, 'loose file'], [w.groups, 'worktree group'], [w.worktrees, 'worktree'], [w.branches, 'branch group']]
    .map(([n, what]) => [Number(n), what]).filter(([n]) => n > 0);
  if (!kinds.length) return null;
  const last = kinds.length - 1;
  return tipRow(leadIcon('ldLoose'), kinds.flatMap(([n, what], i) =>
    [String(n), quiet(' ' + what + (n === 1 ? '' : 's') + (i === last ? ' due' : i === last - 1 ? ' and ' : ', '))]));
}

/* Tracks waiting on the user lead (a blocking question, an open one, then only handoff lines),
   then the oldest handoff first, new tracks last */
const needRank = (t) => (t.asks.some((q) => q.blocking) ? 0 : t.asks.length ? 1 : t.waits.length ? 2 : t.state === 'new' ? 4 : 3);
const bornOf = (t) => { const x = Date.parse((t.handoff && t.handoff.created) || ''); return Number.isFinite(x) ? x : Infinity; };
const oldestFirst = (a, b) => bornOf(a) - bornOf(b) || idNum(a.id) - idNum(b.id);

/* The Tracks tab: the track this session holds as the card, the tracks nobody holds to
 * pick up, the ones other sessions hold (the quiet ones marked), the parked; each one shape
 * (trackShape). `mine` is mineOf's or `track mine`'s, `graph` the band's workstream map,
 * `handoffs` each line's last, `asks` every open question by its track, `offline` the band's offline line. `others`: other workstreams' maps
 * (`{ workstream, view }`), whose tracks other sessions hold run elsewhere and whose shelf
 * rows draw their bar from the map. */
export function tracksView({ mine, graph, shelfRows, handoffs, asks, now, offline, others, local } = {}) {
  const m = mine && mine.held ? mine : null;
  const views = graph && graph.view && Array.isArray(graph.view.tracks) ? graph.view.tracks : [];
  const shelf = (shelfRows || []).filter((r) => r && r.track);
  /* holding none, the band's own map (the project's workstream) runs elsewhere too */
  const maps = [...(!m && graph && graph.workstream ? [{ workstream: graph.workstream, view: graph.view }] : []), ...(Array.isArray(others) ? others : [])];
  const far = maps.filter((g, i) => g && g.workstream && g.view && Array.isArray(g.view.tracks) && g.workstream !== (m && m.workstream)
    && maps.findIndex((x) => x && x.workstream === g.workstream) === i)
    .flatMap((g) => g.view.tracks.filter((v) => v && v.id).map((v) => ({ v, ws: g.workstream })));
  /* a shelf track in the band's own workstream counts from the band's map, as Home does */
  const farView = (id) => views.find((v) => v && v.id === id) || (far.find((x) => x.v.id === id) || {}).v || null;
  const onShelf = new Map(shelf.map((r) => [r.track, r]));
  const asked = asks && typeof asks === 'object' ? asks : null;
  const ctx = {
    now, local, holding: !!m, heldId: m ? m.track : null, heldWs: m ? m.workstream || '' : '', handoffs: handoffs || {}, asked, names: {},
    open: asked ? new Set(Object.values(asked).flat().map((q) => q && qLabel(q.id)).filter(Boolean)) : null,
    /* the held track's holder is this session, so a tile names its runs from here */
    self: m ? ((views.find((v) => v && v.id === m.track) || {}).holder || {}).session || null : null,
  };
  for (const r of shelf) if (r.workstream && r.workstreamName) ctx.names[r.workstream] = flatLine(r.workstreamName);
  if (m && m.workstreamName) ctx.names[ctx.heldWs] = flatLine(m.workstreamName);
  const own = m ? (Array.isArray(m.tracks) ? m.tracks.filter((t) => t && t.id) : []) : [];
  if (m && !own.some((t) => t.id === m.track)) own.unshift({ ...m, id: m.track });
  const ids = new Set(own.map((t) => t.id));
  const live = far.filter((x) => x.v.state === 'active' && !ids.has(x.v.id) && !onShelf.has(x.v.id));
  const all = own.map((t) => trackShape(t, views.find((v) => v.id === t.id) || null, onShelf.get(t.id) || null, ctx))
    .concat(shelf.filter((r) => !ids.has(r.track)).map((r) => trackShape(null, farView(r.track), r, ctx)))
    .concat(live.map((x) => trackShape(null, x.v, { track: x.v.id, workstream: x.ws }, ctx)))
    .filter((t) => !CLOSED_STATES.includes(t.state));
  const of = (k) => all.filter((t) => t.section === k);
  const pickup = of('pickup').sort((a, b) => needRank(a) - needRank(b) || oldestFirst(a, b));
  if (pickup[0] && pickup[0].press && pickup[0].press.kind === 'resume') pickup[0].press.primary = true;
  const elsewhere = of('elsewhere').sort((a, b) => (a.quiet ? 1 : 0) - (b.quiet ? 1 : 0) || idNum(a.id) - idNum(b.id));
  const parked = of('parked').sort(oldestFirst);
  const held = of('held')[0] || null;
  const listed = [held, ...pickup, ...elsewhere, ...parked].filter(Boolean);
  const model = {
    holding: !!m, held, pickup, elsewhere, parked, total: listed.length,
    needsYou: listed.filter((t) => t.asks.length || t.waits.length).length,
    needsYouIds: listed.filter((t) => t.asks.length || t.waits.length).map((t) => t.id), offline: offline ? flatLine(offline === true ? 'board offline' : offline) : '',
  };
  return { ...model, bottom: bottomLine(model) };
}

/* the head names the tracks that wait, so it never claims one no card shows;
   each id with its short name */
function waitersOf(given, n, m, asParts = false) {
  const shown = [m.held, ...(m.pickup || []), ...(m.elsewhere || []), ...(m.parked || [])].filter(Boolean);
  const named = (id) => { const t = shown.find((x) => x.id === id); const s = t && t.name !== id ? shortName(t.name, 28) : ''; return s ? id + ' ' + s : id; };
  /* `asParts`, the same words as parts, each track named its tile's page */
  const urlOf = (id) => ((shown.find((x) => x.id === id) || {}).url || '');
  const part = (id) => (urlOf(id) ? { text: named(id), href: urlOf(id) } : { text: named(id) });
  if (!given.length) return asParts ? [{ text: String(n) }] : String(n);
  const head = given.slice(0, 3);
  const seps = given.length === 1 ? [''] : given.length > 3 ? [', ', ', ', ' and ' + (given.length - 3) + ' more'] : head.map((_, i) => (i === head.length - 1 ? '' : i === head.length - 2 ? ' and ' : ', '));
  const parts = head.flatMap((id, i) => [part(id), ...(seps[i] ? [{ text: seps[i] }] : [])]);
  return asParts ? parts : parts.map((p) => p.text).join('');
}

/* The tab's first rows: where this session is, then the counts (waiting on the user first, amber),
 * zero parts left out; the note with nothing at all; the offline line while the board is away. */
export function bottomLine(m) {
  const n = (k) => (Array.isArray(m[k]) ? m[k].length : 0);
  const lead = m.held ? 'You\'re on ' + (m.held.name || m.held.id) + '.' : m.total ? 'This session holds no track.' : 'No tracks yet.';
  /* the held track's name and each waiting track's id open their pages (`pieces`, the same words) */
  const leadParts = m.held && m.held.url ? [{ text: 'You\'re on ' }, { text: m.held.name || m.held.id, href: m.held.url }, { text: '.' }] : null;
  const verb = (m.needsYou === 1 ? ' waits' : ' wait') + ' on your answer';
  const parts = [
    m.needsYou ? { text: waitersOf(m.needsYouIds || [], m.needsYou, m) + verb, tone: 'amber', pieces: [...waitersOf(m.needsYouIds || [], m.needsYou, m, true), { text: verb }] } : null,
    n('pickup') ? { text: n('pickup') + ' to pick up', tone: 'dim' } : null,
    n('elsewhere') ? { text: n('elsewhere') === 1 ? '1 in another session' : n('elsewhere') + ' in other sessions', tone: 'dim' } : null,
    n('parked') ? { text: n('parked') + ' parked', tone: 'dim' } : null,
  ].filter(Boolean);
  return { lead, leadParts, parts, text: parts.map((p) => p.text).join(MID), note: m.total ? '' : TRACKS_NONE_NOTE, offline: m.offline ? TRACKS_OFFLINE : '' };
}

/* the text in at most `lines` rows of `width` cells, wrapped at spaces; past
 * them it ends on a whole word with an ellipsis, never cut mid-word. */
export function clampWords(text, width, lines = 2) {
  const w = Math.max(8, Math.floor(Number(width)) || 60);
  const rows = [];
  for (const word of flatLine(text).split(' ').filter(Boolean)) {
    const last = rows.length ? rows[rows.length - 1] : null;
    if (last !== null && last.length + 1 + word.length <= w) rows[rows.length - 1] = last + ' ' + word;
    else rows.push(word);
  }
  if (rows.length <= lines) return rows.join(' ');
  const tail = rows[lines - 1].split(' ');
  while (tail.length > 1 && tail.join(' ').length + ELLIPSIS.length > w) tail.pop();
  return rows.slice(0, lines - 1).concat([tail.join(' ') + ELLIPSIS]).join(' ');
}

/* ---- the Questions pane ---- */

/* The unfolding slots in their fixed order; the headline has no label of its own. */
export const SLOTS = [['headline', ''], ['whyPick', 'Why pick it'], ['whyNot', 'Why not'], ['undo', 'Undo']];

/* "REVERSAL of Q512 (store layout)", the loud marker that leads a card head
 * and the band hover, from the hub's parsed Reverses section; '' when none. */
export function reversesLine(reverses) {
  const list = (Array.isArray(reverses) ? reverses : []).filter((r) => r && r.id);
  return list.length ? 'REVERSAL of ' + list.map((r) => r.id + (flatLine(r.name) ? ' (' + flatLine(r.name) + ')' : '')).join(', ') : '';
}

/* the quote of each ruling, then each option it turned down with its cost. */
export function rulingLines(reverses) {
  const out = [];
  for (const r of Array.isArray(reverses) ? reverses : []) {
    if (!r || !r.id) continue;
    if (flatLine(r.quote)) out.push(r.id + ': "' + flatLine(r.quote) + '"');
    for (const d of Array.isArray(r.declined) ? r.declined : []) if (flatLine(d)) out.push('Turned down ' + flatLine(d));
  }
  return out;
}

/* The band's questions as cards, blockers first as the band orders them; only
 * lettered options get a row, as only they have a token to answer with.
 * `sid` and `now` give the head its origin and age where the record has them. */
export function questionsModel({ questions, more, sid, now, local, here, asleep } = {}) {
  /* this session's own, as the band counts them; the rest are from elsewhere, as the mark counts them */
  const ownOf = (q) => q.away !== true && (q.local === true || !sid || q.session === sid || (Array.isArray(q.subscribers) && q.subscribers.includes(sid)));
  const cards = (questions || []).filter((q) => q && q.id).map((q) => {
    const pick = q.pick || null;
    const opts = Array.isArray(q.options) ? q.options : [];
    const born = Date.parse(q.created || '');
    return {
      /* the why keeps its lines, each drawn as one fact */
      id: q.id, name: flatLine(q.name), ask: flatLine(q.ask), blocking: q.blocking === true, gist: lineSet(q.gist),
      crux: flatLine(q.crux), stakes: lineSet(q.stakes), url: q.local === true ? '' : recordHref(local, q.key || q.id, q.boardUrl),
      /* kept with this session, so no board link and no snooze */
      ...(q.local === true ? { local: true } : {}), ...drawnVersion(q),
      /* the ruling a reversal reopens, its quote and the costs the user turned down */
      reverses: reversesLine(q.reverses), ruling: rulingLines(q.reverses),
      /* `asker` registered it; `session` is set only on this session's own */
      origin: sid && (q.asker || q.session) ? ((q.asker || q.session) === sid ? 'this session' : 'another session') : '',
      age: Number.isFinite(born) && now ? ageText(now - born) : '', born: Number.isFinite(born) ? born : 0,
      /* whose track it is and the PC it was asked from, each only when the read carries it */
      ...(q.track ? { track: flatLine(q.track) } : {}), ...(q.track && q.trackName ? { trackName: flatLine(q.trackName) } : {}),
      ...(q.pc ? { pc: flatLine(q.pc) } : {}), ...(q.away === true ? { away: true } : {}),
      ...(q.project ? { project: flatLine(q.project) } : {}), own: ownOf(q),
      options: opts.filter((o) => o && /^[a-z]$/.test(o.type || '')).map((o) => ({
        letter: o.type, token: token(q.id, o.type), option: flatLine(o.option),
        gets: flatLine(o.getsYou), catch: catchOf(o.costsYou, o.undo), pick: pick === o.type,
        slots: SLOTS.filter(([f]) => flatLine(o[f])).map(([f, label]) => ({ id: f, label, text: flatLine(o[f]) })),
      })),
    };
  });
  /* where the pane runs, its PC and held track, for the chips; null on a telling */
  const at = here ? { pc: flatLine(here.pc), track: flatLine(here.track) } : null;
  const own = cards.filter((c) => c.own);
  return { cards, more: more || 0, own: own.length, elsewhere: cards.length - own.length, blocking: own.filter((c) => c.blocking).length, here: at,
    asleep: asleepRows(asleep, local) };
}

/* the snoozed questions apart from the cards, so no count above holds them; the waking
   record its own piece of the wake words, linked as a card's head links */
function asleepRows(list, local) {
  return (Array.isArray(list) ? list : []).filter((q) => q && q.id).map((q) => {
    const wake = flatLine(q.wake), rec = flatLine(q.record), at = rec ? wake.indexOf(rec) : -1;
    const pieces = at < 0 ? [{ text: wake }]
      : [{ text: wake.slice(0, at) }, { text: rec, url: recordHref(local, rec) }, { text: wake.slice(at + rec.length) }].filter((p) => p.text);
    return { id: q.id, name: flatLine(q.name), wake, pieces, ...(q.project ? { project: flatLine(q.project) } : {}) };
  });
}

/* the session's own count and blockers, then the ones from elsewhere apart */
export function questionsHeader(m) {
  const n = m.own + m.more;
  const away = m.elsewhere ? MID + m.elsewhere + ' from elsewhere' : '';
  if (!n) return 'No open questions for this session' + (away || ' or from elsewhere.');
  return n + ' open question' + (n === 1 ? '' : 's') + (m.blocking ? ', ' + m.blocking + ' blocking' : '') + away;
}

export const STAR = '\u2605';

/* The card's dim meta line under the ask, in parts: "blocking" (the warning color),
 * who asked, then its track, PC and age as one part (`where`); the id and short name lead the head. */
export function cardMeta(c, columns, chipped = false) {
  const room = Number(columns) > 0 ? Math.floor(columns) - META_FRAME : 0;
  const tail = [c.pc, c.age ? c.age + ' ago' : ''].filter(Boolean);
  const whereOf = (track) => [track, ...tail].filter(Boolean).join(MID);
  /* the narrowest pane drops "ago" before the track, PC and age leave one line */
  if (room && c.age && c.pc && cellWidth(whereOf(c.track)) > room) tail[tail.length - 1] = c.age;
  let track = c.track ? c.track + (c.trackName ? ' ' + c.trackName : '') : '';
  /* the track's name gives way first, so the track, PC and age keep one line of the card */
  if (room && c.track && c.trackName && cellWidth(whereOf(track)) > room) {
    const left = room - cellWidth(whereOf(c.track)) - 1;
    const words = c.trackName.split(' ');
    while (words.length > 1 && cellWidth(words.join(' ') + ELLIPSIS) > left) words.pop();
    const name = words.join(' ') + ELLIPSIS;
    track = left >= META_NAME_MIN && cellWidth(name) <= left ? c.track + ' ' + name : c.track;
  }
  return [
    { text: c.blocking ? 'blocking' : '', warn: true },
    /* a question on a track is placed by its track, not by who asked; chipped, its chips say where */
    { text: c.origin && !c.track ? 'asked by ' + c.origin : '' },
    { text: chipped ? '' : whereOf(track), where: true },
  ].filter((p) => p.text);
}
/* the card's border and padding (4) and the board link beside the line (2) */
const META_FRAME = 6, META_NAME_MIN = 8;

/* ---- a question's track and PC (and another project) as chips, grouped, and its row ---- */

export const THIS_PC = 'this PC';
const samePc = (a, b) => !!flatLine(a) && flatLine(a).toLowerCase() === flatLine(b).toLowerCase();
/* a question's chips, each null when the read has none; `here` is where the pane runs. The project's
   is set only on a question from another project */
export function chipOf(card, here) {
  const h = here || {};
  const at = samePc(card.pc, h.pc);
  return {
    project: card.project ? { text: card.project } : null,
    track: card.track ? { text: card.track, own: !!h.track && card.track === h.track } : null,
    pc: card.pc ? { text: at ? THIS_PC : card.pc, here: at } : null,
  };
}
/* one group per project, track and PC, where its first question falls; a question with none stands alone */
export function chipGroups(cards, here) {
  const out = [], by = new Map();
  for (const c of cards || []) {
    const key = c.track || c.pc || c.project ? [c.project || '', c.track || '', flatLine(c.pc).toLowerCase()].join('|') : null;
    let g = key === null ? null : by.get(key);
    if (!g) {
      g = { project: c.project || '', track: c.track || '', trackName: c.trackName || '', pc: c.pc || '', chips: chipOf(c, here), rows: [] };
      out.push(g);
      if (key !== null) by.set(key, g);
    }
    g.rows.push(c);
  }
  return out;
}
const CHIP_ICONS = { project: 'project', track: 'thread', pc: 'monitor' };
/* a desktop's words at the pane's 14 px in cells, as its Text draws them; every fit of pane words measures here */
export const deskCells = (s, weight = 400) => textMeasure(s, 14, weight) / DESK_CELL;
const widthFor = (desk) => (desk ? (s) => deskCells(s) : cellWidth);
/* a chip past its words: its icon, a 1 px border each side and status.tsx CHIP's padding and gap
   (2.1 cells); the terminal's brackets */
function chipCells(kind, text, desk) {
  if (!desk) return cellWidth(text) + 2;
  return (2 + statusPicture({ kind: 'icon', icon: CHIP_ICONS[kind], tone: 'rest' }).width) / DESK_CELL + 2.1 + deskCells(text);
}
/* the words in `room` cells: whole words with an ellipsis, a lone word cut */
function clipCells(text, room, w) {
  const s = flatLine(text);
  if (w(s) <= room) return s;
  const words = s.split(' ');
  while (words.length > 1 && w(words.join(' ') + ELLIPSIS) > room) words.pop();
  let t = words.join(' ');
  while (t && w(t + ELLIPSIS) > room) t = t.slice(0, -1);
  return t ? t.trimEnd() + ELLIPSIS : '';
}
/* A group's header in `room` cells: the chips that fit (the track's drops first, then the PC's, another
   project's last), and the track's name dim beside them when it fits whole, else under them, ellipsized
   only when that line is short */
export function chipHeader(group, room, opts = {}) {
  const desk = opts.surface === 'desktop';
  const w = widthFor(desk);
  const fit = Number(room) > 0 ? Number(room) : Infinity;
  let chips = ['project', 'track', 'pc'].filter((k) => group.chips && group.chips[k])
    .map((k) => ({ kind: k, icon: CHIP_ICONS[k], ...group.chips[k], accent: !!(group.chips[k].own || group.chips[k].here) }));
  const need = () => chips.reduce((n, c) => n + chipCells(c.kind, c.text, desk), 0) + Math.max(0, chips.length - 1);
  for (const k of ['track', 'pc', 'project']) if (need() > fit) chips = chips.filter((c) => c.kind !== k);
  const name = flatLine(group.trackName);
  if (!name) return { chips, name: '', under: false };
  if (!chips.length) return { chips, name: clipCells(name, fit, w), under: false };
  if (need() + 1 + w(name) <= fit) return { chips, name, under: false };
  return { chips, name: clipCells(name, fit, w), under: true };
}
/* a desktop row's answer badge (18 px) and its gap; a terminal's `[ a ]` and its gap */
const ROW_BADGE = 18 / 8.453 + 1, ROW_BUTTON = 6, ROW_NAME_MIN = 3;
/* A question's row in `room` cells: the marker, the id bold, the name (it gives way first, with an
   ellipsis), the answer chips when `opts.answers`, the age at the right */
export function rowParts(card, room, opts = {}) {
  const desk = opts.surface === 'desktop';
  const w = widthFor(desk);
  const answers = opts.answers ? card.options || [] : [];
  /* the bold id runs wider than its cells on the terminal (as home.tsx's semibold) */
  const id = desk ? deskCells(card.id, 600) + 1 : cellWidth(card.id) + 2;
  const fixed = 2 + id + 1 + answers.length * (desk ? ROW_BADGE : ROW_BUTTON) + (card.age ? 1 + w(card.age) : 0);
  /* the name keeps a few cells, since it is the row's press that pins it */
  const name = Number(room) > 0 ? clipCells(card.name, Math.max(ROW_NAME_MIN, Math.floor(room - fixed)), w) : flatLine(card.name);
  return { blocking: card.blocking === true, id: card.id, name, cut: name !== flatLine(card.name), answers, age: card.age || '' };
}

/* The grid: option, what happens and catch wherever each column's longest word fits whole
 * in it, judged on every draw from the card's columns and words; where one does not, two
 * columns, the catch a dim line in the what-happens cell. The terminal's at 30, 40 and 30 percent
 * of what the card's frame, padding and gaps leave; a desktop shares the row by `weights`. */
export function gridWidths(columns, surface, options) {
  const cols = Number.isFinite(columns) && columns > 0 ? Math.floor(columns) : 80;
  const desk = surface === 'desktop';
  const list = Array.isArray(options) ? options : [];
  const room = Math.max(3, cols - 10);
  const option = Math.round(room * 0.3), happens = Math.round(room * 0.4);
  const three = { two: false, option, happens, catch: Math.max(1, room - option - happens), ...(desk ? { weights: gridWeights(list, false, room) } : {}) };
  /* measured: a desktop tile's columns share 143 css px at 23 columns, 6 cells under the card's */
  const flex = cols - 6;
  if (gridFits(three, desk ? flex : room, list, desk)) return three;
  const fold = Math.max(12, cols - 9);
  const left = Math.max(8, Math.round((fold * 3) / 7));
  /* folded, one gap fewer */
  return { two: true, option: left, happens: Math.max(4, fold - left), catch: 0, ...(desk ? { weights: foldShare(gridWeights(list, true, fold), flex + 1, list) } : {}) };
}

const gridWidest = (texts, desk) => Math.max(0, ...texts.flatMap((t) => String(t || '').split(/\s+/).filter(Boolean)
  .map(desk ? (s) => deskCells(s) : cellWidth)));

/* folded, the option column gives way until what happens holds its longest word beside the ring,
 * never under its badge and its own longest word */
function foldShare(w, flex, list) {
  const ring = list.some((o) => o.slots && o.slots.length) ? GRID_RING : 0;
  const keep = ring + gridWidest(['What happens, catch', ...list.map((o) => o.gets), ...list.map((o) => (o.catch ? 'catch: ' + o.catch : ''))], true);
  /* the badge's 18 px, its margin and the cell's gap */
  const least = 18 / 8.453 + 2 + gridWidest(list.map((o) => o.option), true);
  const option = Math.max(least, Math.min((w.option / 100) * flex, flex - keep));
  const pct = Math.min(100, Math.round((option / flex) * 100));
  return { ...w, option: pct, happens: 100 - pct };
}

/* every column holds its longest word whole, the header's too; the option's beside its badge,
 * the pick's first word beside its star, the catch's beside the fold ring */
function gridFits(w, room, list, desk) {
  const cells = desk ? (s) => deskCells(s) : cellWidth;
  const widest = (texts) => gridWidest(texts, desk);
  const total = desk ? w.weights.option + w.weights.happens + w.weights.catch : 0;
  const share = (k) => (desk ? (w.weights[k] / total) * room : w[k]);
  const lead = desk ? GRID_CHIP : ROW_BUTTON;
  /* the terminal's fold arrow and its gap follow the title */
  const title = (o) => lead + widest([o.option]) + (!desk && o.slots && o.slots.length ? 2 : 0);
  const pick = list.find((o) => o.pick);
  const starred = pick ? lead + cells(STAR + ' ' + (String(pick.option || '').split(' ').find(Boolean) || '')) : 0;
  const ring = list.some((o) => o.slots && o.slots.length) ? GRID_RING : 0;
  return share('option') >= Math.max(widest(['Option']), starred, ...list.map(title))
    && share('happens') >= widest(['What happens', ...list.map((o) => o.gets)])
    && share('catch') >= ring + widest(['Catch', ...list.map((o) => o.catch)]);
}

/* each desktop column's share of the row, in percent, as flex-grow weights. The option column takes its longest title on one line, at most a third;
 * what happens and catch share the rest by their longest text, none under 0.6/n of the row. */
/* the chip: the answer badge (18 px) and the gap after it; the ring: the fold ring's room,
 * which ends the last column on every row once any option has slots */
const GRID_CHIP = 5, GRID_RING = 4, GRID_FLOOR = 0.6, GRID_OPTION_MAX = 33;
/* the word floor leaves what happens at least the rest of the row */
const GRID_WORD_MAX = 60;
function gridWeights(options, two, room) {
  const list = Array.isArray(options) ? options : [];
  const longest = (head, f) => Math.max(cellWidth(head), ...list.map(f));
  const title = (o) => GRID_CHIP + cellWidth((o.pick ? STAR + ' ' : '') + (o.option || ''));
  const gets = (o) => cellWidth(o.gets || '');
  /* never under the chip and the longest word, so a narrow pane wraps a title at its spaces */
  const word = Math.max(0, ...list.flatMap((o) => String(o.option || '').split(' ').map(cellWidth)));
  const option = Math.max(Math.min(GRID_OPTION_MAX, Math.ceil((longest('Option', title) / room) * 100)),
    Math.min(GRID_WORD_MAX, Math.ceil(((GRID_CHIP + word) / room) * 100))) / 100;
  const lens = two
    ? [longest('What happens, catch', (o) => Math.max(gets(o), o.catch ? cellWidth('catch: ' + o.catch) : 0))]
    : [longest('What happens', gets), longest('Catch', (o) => cellWidth(o.catch || ''))];
  if (list.some((o) => o.slots && o.slots.length)) lens[lens.length - 1] += GRID_RING;
  const floor = GRID_FLOOR / (lens.length + 1);
  /* columns under the floor are raised to it, the rest share what is left by length */
  const low = new Set();
  for (;;) {
    const rest = lens.reduce((s, l, i) => (low.has(i) ? s : s + l), 0);
    const left = 1 - option - low.size * floor;
    const under = lens.findIndex((l, i) => !low.has(i) && (l / rest) * left < floor);
    if (under < 0) {
      const pct = lens.map((l, i) => Math.round((low.has(i) ? floor : (l / rest) * left) * 100));
      return { option: Math.round(option * 100), happens: pct[0], catch: two ? 0 : pct[1] };
    }
    low.add(under);
  }
}

/* The pinned card first (the expanded one, else the band's first), the rest oldest first. */
export function pinnedSplit(cards, expanded, here) {
  const list = cards || [];
  const oldest = (a, b) => (a.born || Infinity) - (b.born || Infinity) || idNum(a.id) - idNum(b.id);
  /* given where the pane runs, the held track's and this session's own first, oldest first; the rest blockers first */
  const own = (c) => (!!here && !!here.track && c.track === here.track) || c.local === true || c.origin === 'this session';
  const blockers = (a, b) => (b.blocking ? 1 : 0) - (a.blocking ? 1 : 0);
  const order = here ? (a, b) => (own(b) ? 1 : 0) - (own(a) ? 1 : 0) || (own(a) ? 0 : blockers(a, b)) || oldest(a, b) : oldest;
  /* with no card expanded the pin is the held track's or this session's own, blockers first, then
     the rest as before: the band's before any from elsewhere, blockers first */
  const pinned = list.find((c) => c.id === expanded)
    || [...list].sort((a, b) => (own(b) ? 1 : 0) - (own(a) ? 1 : 0) || (a.away ? 1 : 0) - (b.away ? 1 : 0) || blockers(a, b))[0] || null;
  return { pinned, rest: list.filter((c) => c !== pinned).sort(order) };
}

/* The pane head's dim freshness: when the band last read a change. */
export function updatedText(at, now) {
  if (!Number.isFinite(at) || !Number.isFinite(now) || !at) return '';
  const age = ageText(now - at);
  return age === '0m' ? 'updated just now' : 'updated ' + age + ' ago';
}

/* ---- the Home tab's activity: the tray console's lines ---- */

/* the feed's words live under server/web, which the server image ships; re-exported here */
export { dayLabel, feedEntry, feedMatches, feedRows };

/* ---- the status line under the prompt ---- */

/* The fill follows the percent, a quarter a step. */
export const FILLS = Object.freeze(['○', '◔', '◑', '◕', '●']);
export const fillGlyph = (p) => FILLS[Math.max(0, Math.min(4, Math.round((Number(p) || 0) / 25)))];
/* The user's picks; the shield is an emoji of two cells, ⛨ (U+26E8) its one-cell fallback */
export const STATUS_GLYPHS = Object.freeze({ shield: '\u{1F6E1}', shelf: '▤', agents: '⁂' });

/* A text's width in cells, an emoji's two. */
export const cellWidth = (s) => [...String(s)].reduce((n, ch) => n + (ch.codePointAt(0) >= 0x1F000 ? 2 : 1), 0);

/* The context meter: dim below the handoff window, bright inside it, warning past the
 * wrap mark, error at the hard limit (the depth guard's hard mark). */
function contextTone(r, main, tokens) {
  if (main && main.on === false) return 'dim';
  const [w, x] = marksFor(main);
  if (tokens >= DEPTH_MARKER.hard) return 'error';
  const p = wholePercent(r);
  return p >= x.percent ? 'warning' : p >= w.percent ? 'bright' : 'dim';
}
/* A rate window this full leaves little room for a session's work. */
export const RATE_ROOM = 85;
/* A rate window: dim, warning from RATE_ROOM, error when spent. */
const rateTone = (p) => (p >= 100 ? 'error' : p >= RATE_ROOM ? 'warning' : 'dim');
const STATUS_RATES = [['five_hour', 'hour', 'H', 'the five-hour window'], ['seven_day', 'week', 'W', 'the weekly window']];
/* the account's usage page, the Claude Code engine's own constant (2.1.299 and 2.1.308) */
export const USAGE_URL = 'https://claude.ai/settings/usage';
const USAGE_PRESS = 'Press to open your usage page on claude.ai';

/* a desktop picture's colors, light then dark. The app hands its theme
   to Electron's nativeTheme, so prefers-color-scheme inside an Svg follows it. */
const PIC_INK = {
  track: ['rgba(11,11,11,0.15)', 'rgba(255,255,255,0.16)'], dim: ['#898781', '#898781'], rest: ['#52514e', '#c3c2b7'],
  sky: ['#0284c7', '#26c3ff'], amber: ['#a66a00', '#db9300'], amberText: ['#734500', '#db9300'],
  red: ['#d03b3b', '#e34948'], green: ['#73cb6d', '#55bf50'], greenEdge: ['#006300', '#55bf50'], off: ['#52514e', '#f0efec'],
  onAmber: ['#ffffff', '#212121'], onSky: ['#ffffff', '#0b0b0b'], text: ['#0b0b0b', '#f0efec'],
  /* the answer badge's sky, its near black letter, the user's answered green, the dim edge */
  badge: ['#00AEEF', '#26C3FF'], onBadge: ['#0b0b0b', '#0b0b0b'], chosen: ['#86EFAC', '#86EFAC'], edge: ['rgba(11,11,11,0.3)', 'rgba(255,255,255,0.32)'],
};
const clampPct = (p) => Math.max(0, Math.min(100, Number(p) || 0));

/* a ring's tip color tells urgency; context by the handoff and wrap marks
   (quiet with the guard off), a rate window amber from RATE_ROOM and red when spent */
function contextPic(reading, main, tokens) {
  const [w, x] = marksFor(main);
  const off = !!(main && main.on === false);
  const p = wholePercent(reading);
  const tone = off ? 'sky' : tokens >= DEPTH_MARKER.hard || p >= x.percent ? 'red' : p >= w.percent ? 'amber' : 'sky';
  const zones = off ? [[0, 100, 'sky']] : [[0, w.percent, 'sky'], [w.percent, x.percent, 'amber'], [x.percent, 100, 'red']];
  return { kind: 'ring', letter: 'C', name: 'Context', segments: 1, percent: clampPct(reading.percent), zones, ticks: [w.percent, x.percent],
    tone, label: p + '%', whole: p };
}
function ratePic(key, raw) {
  const five = key === 'hour';
  const ring = { kind: 'ring', letter: five ? '5' : 'W', name: five ? 'Five-hour' : 'Week', segments: five ? 5 : 7, ticks: [] };
  /* no figure yet, an empty grey ring with its letter and no percent */
  if (raw == null) return { ...ring, percent: 0, zones: [], tone: 'dim', blank: true };
  const tone = raw >= 100 ? 'red' : raw >= RATE_ROOM ? 'amber' : 'sky';
  const zones = raw >= 100 ? [[0, 100, 'red']] : [[0, RATE_ROOM, 'sky'], [RATE_ROOM, 100, 'amber']];
  return { ...ring, percent: clampPct(raw), zones, tone, label: Math.round(raw) + '%' };
}

/* a hover card as a title, one line in parts (a part's tone colors its number on the
   desktop) and the press; `tip` is the terminal's one plain line of the same words. */
function cardOf(title, parts, press = '', rows) {
  const list = parts.filter((x) => x !== '' && x != null).map((x) => (typeof x === 'string' ? { text: x } : x));
  const card = { title, parts: list, press, ...(rows ? { rows } : {}) };
  return { card, tip: title + ': ' + list.map((x) => x.text).join('') + rowsText(rows) + (press ? '. ' + press : '') };
}
/* a card's rows (the agents) on the terminal's one line */
export const rowsText = (rows) => (Array.isArray(rows) && rows.length ? '; ' + rows.map((r) => r.job + ' (' + r.detail + ')').join('; ') : '');

/* a model id as read, "claude-opus-5-5" as "Opus 5.5"; an alias as its family */
export function modelName(id) {
  const s = String(id || '').trim().replace(/\[[^\]]*\]$/, '').replace(/^.*?claude-/, '');
  const parts = s.split('-').filter((t) => t && !/^\d{8}$/.test(t));
  const family = parts.find((t) => /^[a-z]+$/i.test(t));
  if (!family) return String(id || '');
  const nums = parts.filter((t) => /^\d+$/.test(t));
  return family[0].toUpperCase() + family.slice(1).toLowerCase() + (nums.length ? ' ' + nums.join('.') : '');
}
const toolShort = (t) => (String(t).startsWith('mcp__') ? String(t).split('__').slice(2).join('__') : String(t));
/* the guard's limits; DEPTH_MARKER's with the guard off */
const agentLimits = (g) => (g && g.on && Number(g.hard) > 0
  ? { soft: Number(g.soft) || DEPTH_MARKER.soft, hard: Number(g.hard), remind: Number(g.remind) || DEPTH_MARKER.remind } : DEPTH_MARKER);
const TONE_RANK = { sky: 0, amber: 1, red: 2 };

/* a running time as a glance reads it: 45s under a minute, then 3m, then 1h 12m */
function runTime(ms) {
  const s = Math.max(0, Math.floor(Number(ms) / 1000) || 0);
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60);
  return m < 60 ? m + 'm' : Math.floor(m / 60) + 'h' + (m % 60 ? ' ' + (m % 60) + 'm' : '');
}
/* an agent's time since its start, a finished one's frozen at its end; null without the stamps */
function ranFor(a, now) {
  const end = a.done ? a.end : now;
  return Number.isFinite(a.start) && Number.isFinite(end) ? Math.max(0, end - a.start) : null;
}

/* the agents a load finds, from the copy the mod kept (`kept`) and the engine's
   `$.agent.list()` (`listed`); the engine's word on what runs wins, and one neither runs is
   done. A workflow's agents are never listed, so theirs stands. flightsKept says what stays. */
export const LIVE_AGENT = ['pending', 'running', 'waiting'];
export function flightsRebuilt(kept, listed) {
  const out = new Map();
  for (const f of Array.isArray(kept) ? kept : []) if (f && f.id) out.set(f.id, { ...f });
  const seen = new Set();
  for (const a of Array.isArray(listed) ? listed : []) {
    if (!a || !a.id) continue;
    seen.add(a.id);
    const live = LIVE_AGENT.includes(String(a.status));
    const f = out.get(a.id);
    if (f) {
      f.done = !live || undefined;
      if (!f.parent && a.parentId) f.parent = a.parentId;
    } else {
      out.set(a.id, { id: a.id, job: String(a.description || a.name || a.type || ''), model: '', calls: 0, tokens: 0,
        ...(a.parentId ? { parent: a.parentId } : {}), ...(live ? {} : { done: true }) });
    }
  }
  for (const f of out.values()) if (!f.done && !f.wf && !seen.has(f.id)) f.done = true;
  return [...out.values()];
}

/* The one keep rule for both lists: what draws under Agents, the flights and the workflows,
   stays while any of it runs, so a finished workflow keeps its agents under it as a finished dispatch
   keeps its own; Background's shells and monitors stay while one of them runs */
export function flightsKept(flights, bg) {
  const f = (Array.isArray(flights) ? flights : []).filter((x) => x && x.id);
  const b = (Array.isArray(bg) ? bg : []).filter((x) => x && x.id);
  const wf = (x) => x.kind === 'workflow';
  const agents = f.some((x) => !x.done) || b.some((x) => wf(x) && !x.done);
  const shells = b.some((x) => !wf(x) && !x.done);
  return { flights: agents ? f : [], bg: b.filter((x) => (wf(x) ? agents : shells)) };
}

/* The work a handoff waits for: agents at any depth and workflows still running (the engine's
   list says which still run, an end the mod saw stands); `under`, an agent's own write, keeps only
   its descendants; `ended`, ids the mod saw end. Each { id, kind, job, start }, oldest first. */
export function runningWork(flights, bg, listed, under, ended) {
  const engine = Array.isArray(listed) ? new Map(listed.filter((a) => a && a.id).map((a) => [a.id, a])) : null;
  const seen = new Set(ended || []);
  const parent = new Map();
  const out = [];
  for (const f of Array.isArray(flights) ? flights : []) {
    if (!f || !f.id) continue;
    seen.add(f.id);
    if (f.parent) parent.set(f.id, f.parent);
    const e = engine && !f.wf ? engine.get(f.id) : undefined;
    const live = !f.done && (!engine || f.wf || (!!e && LIVE_AGENT.includes(String(e.status))));
    if (live) out.push({ id: f.id, kind: 'agent', job: f.job || '', start: f.start });
  }
  for (const a of engine ? engine.values() : []) {
    if (a.parentId && !parent.has(a.id)) parent.set(a.id, a.parentId);
    if (LIVE_AGENT.includes(String(a.status)) && !seen.has(a.id)) out.push({ id: a.id, kind: 'agent', job: String(a.description || a.name || a.type || ''), start: undefined });
  }
  const below = (id) => { for (let p = parent.get(id), n = 0; p && n < 50; p = parent.get(p), n++) if (p === under) return true; return false; };
  const agents = under ? out.filter((x) => below(x.id)) : out;
  const wfs = under ? [] : (Array.isArray(bg) ? bg : []).filter((b) => b && b.id && b.kind === 'workflow' && !b.done)
    .map((b) => ({ id: b.id, kind: 'workflow', job: b.job || '', start: b.start }));
  return [...agents, ...wfs].sort((x, y) => (Number(x.start) || 0) - (Number(y.start) || 0));
}
/* each by job, kind and running time, for the notes and the write's answer; now null leaves the time
   out, for a note read after the work has landed */
export const runningNames = (list, now = Date.now()) => (list || []).map((x) => '"' + maskSecrets((x.job || 'an ' + x.kind).replace(/\s+/g, ' ')).slice(0, 120) + '" ('
  + x.kind + (now !== null && Number.isFinite(x.start) ? ', ' + runTime(now - x.start) : '') + ')').join(', ');

/* The engine ids whose runs the minute's renewal keeps heard: the agents the list
   shows live, else (an unread list) the ones the module runs; a workflow's call while its row runs */
export function liveRunIds(listed, flights, bg) {
  const ids = Array.isArray(listed) ? listed.filter((a) => a && a.id && LIVE_AGENT.includes(String(a.status))).map((a) => String(a.id))
    : (Array.isArray(flights) ? flights : []).filter((f) => f && f.id && !f.done && !f.wf).map((f) => String(f.id));
  /* the list never names a workflow's agents, so its run is its call's, live while its row runs */
  for (const b of Array.isArray(bg) ? bg : []) if (b && b.id && b.kind === 'workflow' && !b.done) ids.push(String(b.id));
  return [...new Set(ids)];
}

/* the agents held open on background work of their own past `wait` ms with no call and no turn since
   (`moved` false), which the list still shows live: their runs end with the held turn's words */
export const HELD_WAIT_MS = 30 * 60000;
/* a sandbox session's settings may shorten the bound for a real read; no live session can change it */
export function heldWaitOf(env) {
  const ms = Number(env && env.ASKERDO_HELD_WAIT_MS);
  return env && env.ASKERDO_SANDBOX_HOME && Number.isFinite(ms) && ms > 0 ? ms : HELD_WAIT_MS;
}
export function heldOver(held, listed, now = Date.now(), wait = HELD_WAIT_MS) {
  const live = new Map((Array.isArray(listed) ? listed : []).filter((a) => a && a.id).map((a) => [String(a.id), String(a.status)]));
  return (Array.isArray(held) ? held : []).filter((h) => h && h.id && !h.moved && LIVE_AGENT.includes(live.get(h.id)) && now - h.at >= wait).map((h) => h.id);
}

/* a spawn onto a task another session's open run holds is refused, naming each such run as
   the board does (who, which PC, since, last heard); `found` is [{ task, runs }] as taskRuns gives them */
export function heldRunsRefusal(found, session, { now = Date.now(), pc = '' } = {}) {
  const tasks = [];
  const runs = new Map();
  for (const f of Array.isArray(found) ? found : []) {
    for (const r of (f && Array.isArray(f.runs) ? f.runs : [])) {
      if (!r || r.ended || !r.session || r.session === session) continue;
      if (!tasks.includes(f.task)) tasks.push(f.task);
      runs.set(r.run, r);
    }
  }
  if (!tasks.length) return '';
  const words = [...runs.values()].map((r) => 'run ' + r.run + ' (' + (r.worker === 'agent' ? 'agent ' + (r.job || 'with no job name') + ' of ' : '')
    + holderWords({ pc: r.pc, since: r.started, seen: r.heard }, { now, pc }) + ')');
  return 'AskerDo: ' + tasks.join(', ') + (tasks.length > 1 ? ' have' : ' has') + ' another session\'s open ' + words.join('; ')
    + ', so this dispatch was not started. Tell the user who runs it: it moves only by a take-over, which needs the user\'s word'
    + ' (task_update with inHand true and takeOver true once the user says so, then dispatch again).';
}

/* An agent's row: under, how deep under the session's dispatch; ended, its dispatch is done, so it sits in the done fold */
const doneRows = new WeakMap();
function agentRowOf(a, under, ended, lim, now) {
  /* a finished agent's row never changes, so it is built once: a session keeps a day's finished
     agents while one runs, and every draw and live line asks for them all */
  if (!a.done) return agentRow(a, under, ended, lim, now);
  const key = [under, ended, lim.soft, lim.hard, lim.remind, a.tokens, a.calls, a.start, a.end, a.model, a.job, a.tasks].join('|');
  const was = doneRows.get(a);
  if (was && was.key === key) return was.row;
  const row = agentRow(a, under, ended, lim, now);
  doneRows.set(a, { key, row });
  return row;
}
function agentRow(a, under, ended, lim, now) {
  const warn = Math.max(0, lim.soft - lim.remind);
  const tokens = Number(a.tokens) || 0;
  const calls = Number(a.calls) || 0;
  const tone = a.done ? 'dim' : tokens >= lim.hard ? 'red' : tokens >= warn ? 'amber' : 'sky';
  const pct = clampPct((tokens / lim.hard) * 100);
  const ran = ranFor(a, now);
  /* a running agent's time alone: the row already says it runs */
  const state = a.done ? 'done' + (ran === null ? '' : ' in ' + runTime(ran)) : ran === null ? '' : runTime(ran);
  const depth = tokens ? kTok(tokens) + ' of ' + kTok(lim.hard) : '';
  /* the tool in use comes and goes, so it sits last and the parts before it keep their places */
  const tool = !a.done && a.tool ? 'in ' + toolShort(a.tool) : '';
  const detail = [modelName(a.model), state, calls + (calls === 1 ? ' call' : ' calls'), depth, tool].filter(Boolean).join(', ');
  /* stop: TaskStop takes a background agent by its id; a foreground one or a workflow's it cannot */
  /* stem: the detail's lead, which never ticks (home.tsx fitRow sizes a live line from it) */
  /* two agents of one job on two tasks are told apart by the tasks each serves, unless the job names them */
  const words = String(a.job || '').split(/[^A-Za-z0-9-]+/);
  const lead = (Array.isArray(a.tasks) ? a.tasks : []).filter((t) => t && !words.includes(t)).join(', ');
  const named = [lead, flatLine(a.job)].filter(Boolean).join(' ');
  return { id: a.id, job: named || 'an agent', detail, stem: modelName(a.model), tone, done: !!a.done, pct, ran, stop: !a.done && !!a.bg && !a.wf,
    depth, tool,
    meter: meterPicture(pct, tone, (warn / lim.hard) * 100, named), under, ended };
}

/* this session's agents in flight, running first, then the finished ones dimmed
   while another still runs; each its job, model, running time, calls, the tool in use and
   its depth against the guard's hard limit, amber from the warning point. Null when none run.
   an agent another agent started rides under it, counted with it, never as the session's.
   A workflow (a background task) heads a group of its own, its agents (spawned under its call) under
   it; each of them counts as an agent, the workflow itself (`idle`) only while none of them runs. */
export function agentsModel(list, guard, now, background) {
  const all = (Array.isArray(list) ? list : []).filter((a) => a && a.id);
  const wfs = (Array.isArray(background) ? background : []).filter((b) => b && b.id && b.kind === 'workflow');
  /* an agent joins its workflow by the Workflow call it spawned under, else by the run's id, as a
     resumed or server-launched run's call may be empty; a run's latest row takes it */
  const byCall = new Map(wfs.filter((b) => b.call).map((b) => [String(b.call), b.id]));
  const byRun = new Map(wfs.filter((b) => b.run).map((b) => [String(b.run), b.id]));
  const home = new Map();
  for (const a of all) {
    const w = (a.call && byCall.get(String(a.call))) || (a.run && byRun.get(String(a.run)));
    if (w) home.set(a.id, w);
  }
  const flat = all.filter((a) => !home.has(a.id));
  const byId = new Map(flat.map((a) => [a.id, a]));
  const kids = new Map();
  const tops = [];
  for (const a of flat) {
    if (a.parent && a.parent !== a.id && byId.has(a.parent)) (kids.get(a.parent) || kids.set(a.parent, []).get(a.parent)).push(a);
    else tops.push(a);
  }
  const lim = agentLimits(guard);
  /* each session dispatch with its own agents under it, depth first; a group runs while any of it does */
  const groups = tops.map((t) => {
    const members = [];
    const walk = (a, depth) => {
      if (members.length > 200 || members.some((m) => m.a === a)) return;
      members.push({ a, depth });
      for (const k of kids.get(a.id) || []) walk(k, depth + 1);
    };
    walk(t, 0);
    const live = members.some((m) => !m.a.done);
    return { live, count: 1, idle: 0, rows: () => members.map((m) => agentRowOf(m.a, m.depth, !live, lim, now)) };
  });
  for (const b of wfs) {
    const crew = all.filter((a) => home.get(a.id) === b.id);
    const busy = crew.filter((a) => !a.done).length;
    /* its row runs while it or any of its agents does, as a dispatch's group */
    const live = !b.done || busy > 0;
    groups.push({ live, count: busy || 1, idle: busy ? 0 : 1,
      rows: () => [{ ...bgRowOf(b, now), meter: kindPicture('workflow', !!b.done), under: 0, ended: !live },
        ...crew.map((a) => ({ ...agentRowOf(a, 1, !live, lim, now), stop: false }))] });
  }
  const running = groups.filter((g) => g.live);
  if (!running.length) return null;
  const rows = [...running, ...groups.filter((g) => !g.live)].flatMap((g) => g.rows());
  const live = rows.filter((r) => !r.done);
  const tone = live.reduce((t, r) => (TONE_RANK[r.tone] > TONE_RANK[t] ? r.tone : t), 'sky');
  const n = running.reduce((c, g) => c + g.count, 0);
  const idle = running.reduce((c, g) => c + g.idle, 0);
  const done = groups.length - running.length;
  /* shut, Home's line is the counts and the deepest running agent's depth; `timed` adds the
     longest running time, for a line with the room */
  const deep = live.filter((r) => !r.kind);
  const deepest = (deep.length ? deep : live).reduce((d, r) => (r.pct > d.pct ? r : d));
  const longest = live.reduce((t, r) => (r.ran !== null && (t === null || r.ran > t) ? r.ran : t), null);
  const tail = (done ? ', ' + done + ' done' : '') + (deepest.depth ? '; deepest ' + deepest.depth : '');
  const summary = n + ' running' + tail;
  const timed = longest === null ? summary : n + ' running' + (n === 1 ? ' for ' : ', longest ') + runTime(longest) + tail;
  return { running: n, idle, done, rows, tone, summary, timed, deepest };
}

/* The session's background shells, monitors and workflows, kept as the flights are: started by the
   call that backgrounds them, ended by their notification or a stop, and checked against the engine's
   own list on each Stop and SubagentStop (`background_tasks`), whose word on what runs wins. */
export const BG_KINDS = ['shell', 'monitor', 'workflow'];
const BG_ENDS = { killed: 'stopped after', failed: 'failed after' };
/* A foreground shell call (fg) is marked shown once it has run this long: the app's rail lists a long one
   among its background processes, at a threshold no session has read yet */
export const FG_SHOW_MS = 2000;
/* the engine lists a command over its limit cut, with a marker, so it matches a kept one by
   what it kept */
const CUT_MARK = /\s*\.{3}\s*\[\+\d+ chars\]$/;
const sameCommand = (listed, kept) => {
  const s = String(listed), c = s.replace(CUT_MARK, '');
  if (c === s) return s === kept;
  const n = Math.min(c.length, kept.length);
  return n > 0 && c.slice(0, n) === kept.slice(0, n);
};
export function bgRebuilt(kept, listed, now) {
  const out = new Map();
  for (const b of Array.isArray(kept) ? kept : []) if (b && b.id) out.set(b.id, { ...b });
  const seen = new Set();
  /* the engine may list a running foreground call under its own id: its command joins the call's row */
  const fgs = [...out.values()].filter((b) => b.fg && !b.reloaded && b.command).map((b) => String(b.command));
  for (const t of Array.isArray(listed) ? listed : []) {
    if (!t || !t.id) continue;
    /* a kept row runs whatever the engine types it (a remote workflow is a "cloud session"); the kind
       filter only picks which ids the mod never saw become rows */
    seen.add(t.id);
    const b = out.get(t.id);
    if (b) { b.done = undefined; b.end = undefined; b.status = undefined; b.guessed = undefined; continue; }
    if (!BG_KINDS.includes(String(t.type)) || (t.command && fgs.some((c) => sameCommand(t.command, c)))) continue;
    out.set(t.id, { id: t.id, kind: t.type, job: flatLine(t.description || t.name || t.command || ''), ...(t.command ? { command: String(t.command) } : {}) });
  }
  for (const b of [...out.values()]) {
    if (b.done || seen.has(b.id)) continue;
    /* a foreground call this module wraps ends when it returns; one kept over a reload ends unlisted, with no row */
    if (b.fg) { if (b.reloaded) out.delete(b.id); continue; }
    /* an end the list implies is a guess: the notification that follows says how and when it ended */
    b.done = true; b.end = now; b.guessed = true;
  }
  return [...out.values()];
}

/* A task notification's ends, from its prompt text: [{ id, status }] for each block whose status says it ended.
   Delivered into a running turn it draws no row the mod hears, so its prompt is the first word of the end */
const TASK_ENDS = ['completed', 'failed', 'killed', 'stopped'];
export function taskEnds(text) {
  const out = [];
  for (const m of String(text || '').matchAll(/<task-notification>([\s\S]*?)<\/task-notification>/g)) {
    const id = (/<task-id>\s*([^<\s]+)\s*<\/task-id>/.exec(m[1]) || [])[1];
    const status = String((/<status>\s*([^<]+?)\s*<\/status>/.exec(m[1]) || [])[1] || '').toLowerCase();
    /* an isolated agent's end names its worktree, which its launch never did */
    const worktreePath = (/<worktreePath>\s*([^<]+?)\s*<\/worktreePath>/.exec(m[1]) || [])[1];
    const worktreeBranch = (/<worktreeBranch>\s*([^<]+?)\s*<\/worktreeBranch>/.exec(m[1]) || [])[1];
    if (id && TASK_ENDS.includes(status)) out.push({ id, status: status === 'stopped' ? 'killed' : status, ...(worktreePath ? { worktreePath, worktreeBranch } : {}) });
  }
  return out;
}

/* The agents whose report a prompt carries: a hand-back's sender by name, and a notification by id whose
   result is the report itself, not the engine's interim word or its pointer to a hand-back message */
export function reportsIn(text) {
  const t = String(text || '');
  const names = [...t.matchAll(/<agent-message from="([^"]+)"/g)].map((m) => m[1]);
  const ids = [];
  for (const m of t.matchAll(/<task-notification>([\s\S]*?)<\/task-notification>/g)) {
    const id = (/<task-id>\s*([^<\s]+)\s*<\/task-id>/.exec(m[1]) || [])[1];
    const result = (/<result>([\s\S]*?)<\/result>/.exec(m[1]) || [])[1];
    if (id && result && result.trim() && !/has not reported yet|delivered to you as a message/i.test(result)) ids.push(id);
  }
  return { names, ids };
}

/* Home's Background fold and the chip's rows: running first, then the finished ones dimmed while
   another runs; each its description, kind and running time in the agents' line shape.
   Null when none runs. */
export function backgroundModel(list, now) {
  /* a workflow draws under Agents, its agents under it (agentsModel) */
  /* a foreground call draws once the mod marks it shown, past FG_SHOW_MS: most return before */
  const all = (Array.isArray(list) ? list : []).filter((b) => b && b.id && b.kind !== 'workflow' && !(b.fg && !b.shown));
  const running = all.filter((b) => !b.done);
  if (!running.length) return null;
  const kinds = {};
  for (const b of running) kinds[b.kind] = (kinds[b.kind] || 0) + 1;
  const rows = [...running, ...all.filter((b) => b.done)].map((b) => bgRowOf(b, now));
  const done = all.length - running.length;
  return { running: running.length, done, rows, kinds, summary: running.length + ' running' + (done ? ', ' + done + ' done' : '') };
}
function bgRowOf(b, now) {
  const ran = ranFor(b, now);
  const time = ran === null ? '' : runTime(ran);
  const end = BG_ENDS[b.status] || 'done in';
  const state = !b.done ? time : time ? end + ' ' + time : end.split(' ')[0];
  /* a foreground call says so and has no stop: TaskStop takes only what runs in the background */
  const stem = b.fg ? 'foreground command' : b.kind;
  return { id: b.id, kind: b.kind, job: bgName(b.job, b.command) || 'a ' + b.kind, detail: [stem, state].filter(Boolean).join(', '), stem,
    tone: b.done ? 'dim' : 'sky', done: !!b.done, pct: 0, ran, stop: !b.done && !b.fg, command: maskSecrets(String(b.command || b.job || '')), status: b.done ? b.status || 'completed' : 'running' };
}

/* a row's name is the call's description as given; a call that gave none (its job is its command)
   is named from the command's work, past its setup, a leading ellipsis marking the skip. A reading aid,
   not a parser: in doubt, the head as before. Either way a command's secrets are masked */
export function bgName(job, command) {
  const j = flatLine(job), c = String(command || '');
  if (!c || (j !== flatLine(c) && !sameCommand(j, flatLine(c)))) return j;
  const work = pastSetup(c);
  return maskSecrets(work === null ? j : '…' + flatLine(work));
}
const SETUP = /^(?:cd|pushd|popd|rm|rmdir|mkdir|export|unset|set|Set-Location|Remove-Item|New-Item|done|fi)$/i;
const WRAP = /^(?:for|while|until)$/;
const ASSIGN = /^(?:\$(?:env:)?)?[A-Za-z_]\w*\s*=/;
/* the command from its first clause that does work, or null when nothing was skipped or all is setup */
function pastSetup(c, deep = 0) {
  let skipped = false;
  for (const { at, text } of clauses(c)) {
    let s = text, from = at;
    const lead = /^(?:do|then|else)\s+/.exec(s);
    if (lead) { s = s.slice(lead[0].length); from += lead[0].length; }
    /* env and leading assignments wrap the work; alone they are setup */
    const wrap = /^(?:env(?:\s+-\S+)*\s+)?(?:(?:\$(?:env:)?)?[A-Za-z_]\w*=(?:"[^"]*"|'[^']*'|\S*)\s+)*/.exec(s)[0];
    const rest = s.slice(wrap.length);
    const head = rest.split(/\s+/)[0];
    if (!rest || ASSIGN.test(rest) || SETUP.test(head) || WRAP.test(head)) { skipped = true; continue; }
    const run = c.slice(from + wrap.length);
    const script = scriptOf(run, deep);
    if (script !== null) return script;
    return skipped || wrap ? run : null;
  }
  return null;
}
/* an interpreter's work is its script (or module, or inline code), named by its file name */
const INTERP = /^(?:node|nodejs|python[\d.]*|py|bash|sh|zsh|pwsh|powershell|npx|deno|bun|tsx)(?:\.exe)?$/i;
const INLINE = /^(?:-[a-z]*c|-e|--eval|-command)$/i;
function scriptOf(run, deep = 0) {
  const head = /^("[^"]*"|'[^']*'|\S+)\s*/.exec(run);
  if (!head || !INTERP.test(unquote(head[1]).split(/[\\/]/).pop())) return null;
  let rest = run.slice(head[0].length);
  for (let f; (f = /^(--?[\w-]+)(=\S*)?\s*/.exec(rest));) {
    rest = rest.slice(f[0].length);
    if (/^-m$/.test(f[1])) return rest || null;
    if (INLINE.test(f[1])) {
      const q = /^("[^"]*"|'[^']*'|\S+)/.exec(rest);
      if (!q) return null;
      const code = unquote(q[1]);
      return (deep ? null : pastSetup(code, 1)) ?? code;
    }
  }
  const t = /^("[^"]*"|'[^']*'|\S+)/.exec(rest);
  return t ? unquote(t[1]).split(/[\\/]/).pop() + rest.slice(t[1].length) : null;
}
/* top-level clauses split at && || ; and line ends outside quotes, each with where it starts */
function clauses(c) {
  const out = [];
  let q = '', start = 0;
  const push = (end, next) => { const raw = c.slice(start, end), lead = raw.length - raw.trimStart().length; if (raw.trim()) out.push({ at: start + lead, text: raw.trim() }); start = next; };
  for (let i = 0; i < c.length; i++) {
    const ch = c[i];
    if (q) { if (ch === q) q = ''; continue; }
    if (ch === '"' || ch === "'") q = ch;
    else if (ch === ';' || ch === '\n') push(i, i + 1);
    else if ((ch === '&' || ch === '|') && c[i + 1] === ch) { push(i, i + 2); i++; }
  }
  push(c.length, c.length);
  return out;
}
/* the value of anything named as a secret: an assignment, a flag or a header named token, key, secret,
   password, credential or authorization, and a URL's user and password */
const SECRET = '[\\w-]*(?:token|key|secret|passw(?:or)?d|credential|authori[sz]ation)[\\w-]*';
const VALUE = '"[^"]*"|\'[^\']*\'|[^\\s"\';&|]+';
const MASK = '***';
export function maskSecrets(s) {
  return String(s)
    .replace(/\b([a-z][\w+.-]*:\/\/)[^\s/@"']+@/gi, '$1' + MASK + '@')
    .replace(new RegExp('((?:^|[\\s"\'])' + SECRET + ':\\s*)(?:(?:Bearer|Basic|token)\\s+)?[^\\s"\']+', 'gi'), '$1' + MASK)
    .replace(new RegExp('((?:^|\\s)--?' + SECRET + ')(=|\\s+)(?:' + VALUE + ')', 'gi'), '$1$2' + MASK)
    .replace(new RegExp('((?:^|[\\s;&|(])(?:\\$(?:env:)?)?' + SECRET + '\\s*=\\s*)(?:' + VALUE + ')', 'gi'), '$1' + MASK);
}

/* "2 agents, 1 shell": what runs by kind, agents first */
export function flightWords(am, bm) {
  /* a workflow is counted by its running agents, or as itself while none runs (agentsModel's idle) */
  const idle = am ? am.idle || 0 : 0;
  const n = [[am ? am.running - idle : 0, 'agent'], ...BG_KINDS.map((k) => [k === 'workflow' ? idle : bm ? bm.kinds[k] || 0 : 0, k])];
  return n.filter(([c]) => c > 0).map(([c, k]) => c + ' ' + k + (c === 1 ? '' : 's')).join(', ');
}

/* an agent's depth as a short bar, filled to the hard limit, a tick at the warning point.
   The fill steps by whole pixels and the alt by five percent, so depth that moves no pixel draws the same */
export const METER_W = 28;
export function meterPicture(pct, tone, tick, job = '') {
  const W = METER_W, len = 26;
  const p = clampPct(pct);
  const x = f2(1 + (len * clampPct(tick)) / 100);
  const body = '<rect x="1" y="8" width="' + len + '" height="4" rx="2" class="f-track"/>'
    + (p > 0 ? '<rect x="1" y="8" width="' + Math.max(4, Math.round((len * p) / 100)) + '" height="4" rx="2" class="f-' + tone + '"/>' : '')
    + '<line x1="' + x + '" y1="6" x2="' + x + '" y2="14" stroke-width="1" stroke-linecap="round" class="s-dim"/>';
  return { source: svgOf(W, 20, body), alt: 'Depth bar' + (job ? ' of ' + job : '') + ', about ' + Math.round(p / 5) * 5 + ' percent of the hard limit', width: W, height: 20 };
}
/* a background row's lead: its kind's icon in the meter's place, so its name lines up under an agent's;
   bare, the icon at its own width. Dim as the row's detail line, dimmer once it finished */
const BG_ICON = { shell: 'bgShell', monitor: 'bgMonitor', workflow: 'bgWorkflow' };
export function kindPicture(kind, done, bare) {
  const [shape, alt, box] = ICONS[BG_ICON[kind] || 'bgShell'];
  const t = tallIcon(stroked(shape, 's-dim'), box, 1.4, 0, ROW_INK);
  const w = bare ? t.w : Math.max(METER_W, t.w);
  return { source: svgOf(w, 20, done ? '<g opacity="0.55">' + t.body + '</g>' : t.body), alt, width: w, height: 20 };
}

/* ---- versions: compared as dotted numbers; an unreadable side is never behind ---- */

const versionParts = (v) => (typeof v === 'string' && /^\d+(\.\d+)*$/.test(v) ? v.split('.').map(Number) : null);

export function versionBehind(board, pc) {
  const b = versionParts(board), p = versionParts(pc);
  if (!b || !p) return false;
  for (let i = 0; i < Math.max(b.length, p.length); i++) {
    const d = (b[i] || 0) - (p[i] || 0);
    if (d) return d < 0;
  }
  return false;
}

/* this PC's version and the board's in words, and the line that says the board is behind ('' when it is not) */
export function versionWords(pc, board) {
  const known = versionParts(board) ? board : '';
  return {
    pc: 'AskerDo ' + (versionParts(pc) ? pc : 'unknown') + ' on this PC',
    board: known ? 'the board runs ' + known : 'the board does not say its version',
    behind: versionBehind(board, pc) ? 'The board runs ' + board + ' and this PC ' + pc + ': update the board' : '',
  };
}

/* the board's server commit against the commits shipped to it, newest first. Behind only when
   the board runs an older shipped one, so a merge not yet reviewed and shipped never reads as owed. */
const sameCommit = (a, b) => !!a && !!b && (a.length < b.length ? b.startsWith(a) : a.startsWith(b));

export function commitWords(board, shipped = []) {
  const known = typeof board === 'string' && /^[0-9a-f]{7,40}$/i.test(board) ? board.toLowerCase().slice(0, 8) : '';
  const list = (Array.isArray(shipped) ? shipped : []).map((s) => String(s && s.commit || '').toLowerCase()).filter((c) => /^[0-9a-f]{7,40}$/.test(c));
  const at = known ? list.findIndex((c) => sameCommit(c, known)) : -1;
  const state = !known ? 'unknown' : at === 0 ? 'step' : at > 0 ? 'behind' : 'unrecorded';
  return {
    state,
    commit: known ? 'server commit ' + known + (state === 'step' ? ', the one last shipped' : '') : 'server commit unknown (the board does not report one)',
    behind: state === 'behind' ? 'The board runs server commit ' + known + ', older than ' + list[0].slice(0, 8) + ' that was shipped to it: update the board server again' : '',
  };
}

/* ---- the drift line: what Home says when a project's pointers drift ---- */

/* what the project's conversion map retired (a folder or file whose end was delete or move), the
   retired folders (their paths with the trailing slash), the mapped files under them, and the last run */
export function driftMap(map) {
  const rows = (map && Array.isArray(map.rows)) ? map.rows : [];
  const gone = rows.filter((r) => r && typeof r.source === 'string' && (r.fate === 'delete' || r.fate === 'move'));
  const folders = gone.filter((r) => r.source.endsWith('/')).map((r) => r.source);
  const under = (f) => folders.some((d) => f.startsWith(d));
  const retired = new Set(gone.filter((r) => !r.source.endsWith('/')).map((r) => r.source));
  for (const r of rows) if (r && r.kind === 'file' && under(r.source)) retired.add(r.source);
  const last = map && map.last ? { at: String(map.last.at || '').slice(0, 10) } : null;
  return { retired, folders, under, last };
}

const PATH_EXT = /\.(md|mdx|txt|json|jsonl|ya?ml|toml|ini|cfg|m?[jt]sx?|cjs|py|rs|go|sh|ps1|psm1|html?|css|svg|png|csv|lock|db|sql|xml|rb|java|cs|cpp|h)$/i;
/* a repo-relative path: a slash or a file extension, never absolute, home, variable, URL or template */
function pathish(s) {
  const p = String(s).replace(/^\.\//, '').replace(/[.,;:!?)\]'"]+$/, '');
  if (!p || /\s/.test(p) || /^[/~$<\\]|^[A-Za-z]:|^[a-z][a-z0-9+.-]*:/i.test(p) || /[*<>{}$|=@#]/.test(p)) return '';
  if (/^\.\.?\/?$/.test(p) || p.startsWith('../') || p.startsWith('-')) return '';
  return p.includes('/') || PATH_EXT.test(p) ? p : '';
}
/* the paths a paragraph cites: backticked spans, then bare tokens that end in a file extension */
export function citedPaths(line) {
  const out = [];
  const s = String(line);
  for (const m of s.matchAll(/`([^`\n]+)`/g)) { const p = pathish(m[1]); if (p) out.push(p); }
  for (const m of s.replace(/`[^`\n]*`/g, ' ').matchAll(/(?:^|[\s(\[])([A-Za-z0-9_][A-Za-z0-9_./-]*\.[A-Za-z][A-Za-z0-9]*)(?=$|[\s)\],;:!?'".])/g)) {
    const p = pathish(m[1]);
    if (p && PATH_EXT.test(p)) out.push(p);
  }
  return [...new Set(out)];
}

const RULE_CAP = 400;
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
/* rules: the rule rows in force; docs: [{ file, text }]; exists(path): a stat; listed: { folder: [names] }.
   null when nothing is off. A path missing at the root counts as found where a folder the same paragraph names holds it. */
export function driftOf({ rules = [], docs = [], exists = () => true, map: conv = null, listed = {} } = {}) {
  const map = driftMap(conv);
  const bare = new Map([...map.retired].map((f) => [f.slice(f.lastIndexOf('/') + 1), f]));
  const dead = [], seen = new Set();
  const look = (from, line) => {
    const paths = citedPaths(line);
    const dirs = paths.filter((p) => p.endsWith('/'));
    for (const p of paths) {
      const path = p.replace(/\/+$/, '');
      const retired = map.retired.has(path) || map.under(path + (p.endsWith('/') ? '/' : '')) || (!path.includes('/') && bare.has(path));
      if (!retired) {
        if (!path.includes('/')) continue;
        if (exists(path) || dirs.some((d) => d !== p && exists(d + path))) continue;
      }
      if (seen.has(from + '\n' + path)) continue;
      seen.add(from + '\n' + path);
      dead.push({ from, path: p, retired });
    }
    /* a retired file's bare name standing as a word, outside any path */
    for (const [name] of bare) {
      if (seen.has(from + '\n' + name) || paths.some((p) => p === name || p.endsWith('/' + name))) continue;
      if (new RegExp('(^|[^A-Za-z0-9_./-])' + reEscape(name) + '(?![A-Za-z0-9_/-])').test(line)) {
        seen.add(from + '\n' + name);
        dead.push({ from, path: name, retired: true });
      }
    }
  };
  for (const d of docs) for (const para of String(d.text || '').split(/\n\s*\n/)) look(d.file, para);
  const long = [];
  for (const r of rules) {
    look('rule ' + r.rule, r.text);
    const cut = /(\.\.\.|\u2026)\s*(\[[^\]]*\])?\s*$/.test(String(r.text));
    if (r.source && r.source !== 'built in' && (String(r.text).length > RULE_CAP || cut)) long.push({ slug: r.rule, chars: String(r.text).length });
  }
  const fresh = [];
  /* a folder the conversion retired holding files again */
  for (const folder of map.folders) {
    const names = (listed[folder] || []).slice().sort();
    if (names.length) fresh.push({ folder, names });
  }
  if (!dead.length && !long.length && !fresh.length) return null;
  const parts = [];
  const since = map.last && map.last.at ? ' since the conversion of ' + map.last.at : ' since the conversion';
  for (const f of fresh) parts.push(f.folder + ' holds ' + plural(f.names.length, 'file', 'files') + ' again' + since + (f.names.length > 1 ? ' (' + f.names[0] + ' and more)' : ' (' + f.names[0] + ')'));
  const byFrom = new Map();
  for (const d of dead) byFrom.set(d.from, [...(byFrom.get(d.from) || []), d]);
  for (const [from, ds] of byFrom) {
    /* the first retired and the first missing path each, so the doctor's case is never hidden */
    const said = [true, false].map((r) => ds.filter((d) => d.retired === r)).filter((g) => g.length)
      .map((g) => g[0].path + ' (' + (g[0].retired ? 'retired' : 'missing') + (g.length > 1 ? ', ' + (g.length - 1) + ' more' : '') + ')');
    parts.push(from + ' cites ' + said.join(' and '));
  }
  if (long.length) parts.push(plural(long.length, 'rule line', 'rule lines') + ' over ' + RULE_CAP + ' characters or cut (' + long[0].slug + ')');
  const doctor = fresh.length || dead.some((d) => d.retired);
  /* a missing path alone is the doctor's too (its check 5 repoints a CLAUDE.md line), with no run to open yet */
  return { dead, long, fresh, doctor: !!doctor, text: 'Drift: ' + parts.join('; ') + (doctor ? '; run the doctor' : dead.length ? ' (/askerdo:doctor)' : '') };
}

/* the tray's face rule (tray/src/tray.rs), on the counts of what waits elsewhere */
export function markFace(counts) {
  const b = Number(counts && counts.blocking) || 0;
  const w = Number(counts && counts.waiting) || 0;
  const nap = Number(counts && counts.asleep) > 0;
  /* blocking keeps its plain dot; waiting with something asleep wears the sky crescent */
  return b > 0 ? 'blocking' : w > 0 ? (nap ? 'waiting-asleep' : 'waiting') : nap ? 'asleep' : 'quiet';
}
/* the mark's card names at most this many asleep questions, then how many more */
const ASLEEP_ROWS = 5;
function asleepOf(list) {
  const all = (Array.isArray(list) ? list : []).filter((q) => q && q.id).map((q) => ({ id: q.id, name: flatLine(q.name), wake: flatLine(q.wake),
    ...(q.record ? { record: flatLine(q.record) } : {}), ...(q.project ? { project: flatLine(q.project) } : {}) }));
  return { rows: all.slice(0, ASLEEP_ROWS), more: Math.max(0, all.length - ASLEEP_ROWS), n: all.length };
}
/* the mark counts the open questions this session does not own; its card groups them
   under chip headers, and its press opens them in the Questions tab (Home when none wait) */
function markSeg(elsewhere, now, here, version, asleepList) {
  /* the card names this PC's plugin version in both shapes */
  const name = 'AskerDo' + (versionParts(version) ? ' ' + version : '');
  const known = !!elsewhere && Number.isFinite(Number(elsewhere.blocking)) && Number.isFinite(Number(elsewhere.waiting));
  const b = known ? Number(elsewhere.blocking) : 0, w = known ? Number(elsewhere.waiting) : 0;
  const nap = asleepOf(asleepList);
  const pic = { kind: 'mark', face: markFace({ ...(known ? elsewhere : {}), asleep: nap.n }), blocking: b, waiting: w, asleep: nap.n };
  /* the asleep rows close the card after its folder and branch, the same on both shapes */
  const withAsleep = (c) => (nap.n ? { ...c, card: { ...c.card, asleep: nap.rows, asleepMore: nap.more } } : c);
  if (!known || !(b + w)) {
    const c = cardOf(name, [known ? 'nothing waits elsewhere' : 'the board\'s counts are not read yet'], 'Press to open the AskerDo pane on Home');
    return { key: 'mark', text: '', tone: 'dim', press: 'home', ...withAsleep(c), pic };
  }
  const n = b + w;
  const title = n + ' question' + (n === 1 ? '' : 's') + ' from elsewhere';
  const questions = (Array.isArray(elsewhere.questions) ? elsewhere.questions : []).filter((q) => q && q.id).map((q) => {
    const born = Date.parse(q.created || '');
    return { id: q.id, name: flatLine(q.name), blocking: q.blocking === true, track: flatLine(q.track), trackName: flatLine(q.trackName), pc: flatLine(q.pc),
      ...(q.project ? { project: flatLine(q.project) } : {}), age: Number.isFinite(born) && Number.isFinite(now) ? ageText(now - born) : '' };
  });
  const c = cardOf(title, [b ? { text: b + ' blocking', tone: 'amber' } : '', b && w ? ', ' : '', w ? { text: w + ' waiting', tone: 'sky' } : ''], 'Press to open them in the Questions tab');
  c.card.head = { icon: 'mark', title, state: b ? { text: b + ' blocking', tone: 'amber' } : null };
  c.card.questions = questions;
  /* only the PC: none of them is this session's track */
  c.card.here = { pc: flatLine(here && here.pc) };
  c.card.foot = name;
  return { key: 'mark', text: '', tone: 'dim', press: 'questions', ...withAsleep(c), pic: { ...pic, label: String(n), labelTone: b ? 'amber' : 'sky' } };
}

/* ---- the held track's and the task in hand's tooltips ---- */

/* how long since a stamp, from `now`, never the machine's clock */
function spanOf(iso, now) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t) || !Number.isFinite(now)) return '';
  const m = Math.max(0, Math.round((now - t) / 60000));
  if (m < 60) return m + ' min';
  if (m < 1440) return Math.floor(m / 60) + ' h' + (m % 60 ? ' ' + (m % 60) + ' min' : '');
  const d = Math.floor(m / 1440);
  return d + (d === 1 ? ' day' : ' days');
}
/* a stamp's own wall clock, its writer's zone; the date too once it is most of a day old */
function clockOf(iso, now) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})/.exec(String(iso || ''));
  if (!m) return '';
  const old = Number.isFinite(now) && now - Date.parse(iso) >= 18 * 3600000;
  return old ? MONTHS[Number(m[2]) - 1] + ' ' + Number(m[3]) + ', ' + m[4] : m[4];
}
/* "Held here 25 min, since 19:55", the words alone without a stamp or a now */
const heldFor = (words, iso, now) => (spanOf(iso, now) ? [words + ' ' + spanOf(iso, now), quiet(', since ' + clockOf(iso, now))] : [words]);
const ordinal = (n) => n + (n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th');
const TIP_TEXT_MAX = 200;
const tipText = (s) => { const t = flatLine(s); return t.length > TIP_TEXT_MAX ? t.slice(0, TIP_TEXT_MAX - 1).replace(/\s+\S*$/, '') + ELLIPSIS : t; };
const quiet = (text) => ({ text, tone: 'dim' });
const nameItem = (t) => t.id + (t.name ? ' ' + flatLine(t.name) : '');
const leadIcon = (icon, tone = 'dim') => ({ kind: 'icon', icon, tone, lead: true });
/* a row: its lead and its lines, each line toned parts (a `pic` part is a bar drawn inline) */
const tipLine = (xs) => xs.filter((x) => (typeof x === 'string' ? x !== '' : x && (x.pic || x.text))).map((x) => (typeof x === 'string' ? { text: x } : x));
const tipRow = (lead, ...lines) => ({ lead, lines: lines.filter(Boolean).map(tipLine) });
const TRACK_PRESS = 'Press to open the track\'s page on the board';
/* the task's word, as the board computes it; the stored status where none came */
const TASK_STATUS = { open: { text: 'open' }, running: { text: 'running', tone: 'sky' }, unconfirmed: { text: 'unconfirmed', tone: 'amber' },
  waiting: { text: 'waiting', tone: 'dim' }, ready: { text: 'ready' } };
const STATION_OF = { running: 'now', unconfirmed: 'left', ready: 'ready' };
/* a task card's head: its word, a ready one with what it is ready for ("ready to settle") */
const wordState = (w) => (!w || !TASK_STATUS[w.is] ? null : w.is === 'ready' && w.next ? { text: 'ready to ' + w.next } : TASK_STATUS[w.is]);
/* the user's hold, from the board's view, leads the state */
const trackStateOf = (f) => (f.hold ? { text: HOLD_WORDS, tone: 'amber' } : f.stalled ? { text: 'stalled', tone: 'amber' } : f.state === 'active' ? { text: 'active', tone: 'sky' } : { text: f.state || 'held', tone: 'dim' });

/* the open tasks of a track view in the board map's order, each with the map's kind */
function stationsOf(view, now) {
  if (!view || !Array.isArray(view.tasks) || !view.tasks.length) return [];
  let D = null;
  try { D = graphOf([{ edges: [], critical: { length: 0, path: [] }, ...view }], now, viewLook()).D; } catch { D = null; }
  return view.tasks.slice().sort((a, b) => (a.column || 0) - (b.column || 0) || (a.position || 0) - (b.position || 0))
    .map((t) => ({ ...t, kind: (D && D.tasks[t.id] && D.tasks[t.id].kind) || (t.word && STATION_OF[t.word.is]) || (t.ready ? 'ready' : 'waits') }));
}
/* the track view a task sits on, from the band's workstream map */
const viewOfTask = (graph, id) => ((graph && graph.view && graph.view.tracks) || []).find((v) => (v.tasks || []).some((x) => x.id === id)) || null;
const viewOfTrack = (graph, id) => ((graph && graph.view && graph.view.tracks) || []).find((v) => v.id === id) || null;

/* a structured card's facts on the terminal's one line */
export function cardText(card) {
  const head = card.head ? card.head.title + (card.head.state ? ', ' + card.head.state.text : '') : '';
  const rows = (card.groups || []).flat().map((r) => r.lines.map((l) => l.map((p) => p.text || '').join('').trim().replace(/[.]+$/, '')).filter(Boolean).join(', '));
  return [head, ...rows].filter(Boolean).join('; ');
}

/* the bar's cells: the map's stations after the done, else from the counts (done, each now row by
   its word, ready, the rest); the alt counts the cells by kind, so an unconfirmed one is never lost */
function progressOf(stations, { done, total, now, readySet, unreviewed = 0, locked = false }) {
  /* the done not yet reviewed lead into the open work, amber */
  const u = Math.min(done, Math.max(0, unreviewed));
  const past = [...Array(done - u).fill('done'), ...Array(u).fill('review')];
  const cells = stations.length ? [...past, ...stations.map((t) => t.kind)]
    : [...past, ...now.map((n) => (n.word && n.word.is === 'unconfirmed' ? 'left' : 'now')), ...readySet.map(() => 'ready'),
      ...Array(Math.max(0, (total || 0) - done - now.length - readySet.length)).fill('waits')];
  /* a held finish's cell, the last, is its padlock */
  if (locked && cells.length > done) cells[cells.length - 1] = 'lock';
  const count = (k) => cells.filter((x) => x === k).length;
  return { done, total, cells, unreviewed: u, alt: 'One cell per task: ' + done + ' done, ' + count('now') + ' running, '
    + (count('left') ? count('left') + ' unconfirmed, ' : '') + count('ready') + ' ready' + (u ? ', ' + u + ' to review' : '') + (locked ? ', the finish waits on a review' : '') };
}
const barRow = (p) => tipRow(leadIcon('ldDone'), [{ text: '', pic: { kind: 'bar', cells: p.cells, alt: p.alt } }, p.done + ' of ' + p.total + ' done', p.unreviewed ? { text: ', ' + p.unreviewed + ' to review', tone: 'amber' } : '']);
/* the longest chain says what it is, each id with its short name; past three the rest counted.
   one part per id, its page; the pane wraps whole names in `pack` rows and counts the rest (`more`) */
const CHAIN_MAX = 3;
function chainParts(ids, nameOf, hrefOf) {
  const shown = ids.slice(0, CHAIN_MAX);
  const parts = shown.map((id, i) => {
    const n = shortName(nameOf(id), 28);
    const href = hrefOf ? hrefOf(id) : '';
    return { text: id + (n ? ' ' + n : '') + (i < ids.length - 1 ? '; ' : ''), pack: 2, ...(href ? { href } : {}) };
  });
  const left = ids.length - shown.length;
  return left > 0 ? [...parts, { text: 'and ' + left + ' more', more: left }] : parts;
}
const flagRow = (toGo, critical, nameOf, hrefOf) => tipRow(leadIcon('ldFlag'), toGo > 0
  ? [quiet('Longest chain ' + toGo + (critical.length ? ': ' : '')), ...chainParts(critical, nameOf, hrefOf)]
  : [quiet('Longest chain: nothing open')]);
/* a now or ready row by the board's word, its station and name, then who, where and since
   or for how long; the view's own row lends the steps the sent row lacks */
function wordRow(t, name, { at, self, tasks, fall }) {
  const x = { ...((tasks || []).find((y) => y.id === t.id) || {}), ...t };
  const is = (x.word && x.word.is) || fall;
  return tipRow({ kind: 'station', state: STATION_OF[is] || 'ready' }, [name, quiet(', ' + flatLine(wordWords(x, at, self, is)))]);
}
/* `press`: the words open Questions pinned at it (the Tracks tab); else with `local` its board page */
const askRow = (q, press = false, local = '') => tipRow(leadIcon(q.blocking === true ? 'ldBlock' : 'ldAsk'),
  [press ? { text: nameItem(q), ask: q.id } : q.local === true ? nameItem(q) : linkedName(local, { id: q.id, key: q.key, url: q.boardUrl || q.url }), q.blocking === true ? { text: ', blocking', tone: 'amber' } : '']);
/* free words with each board id in them ("Q5 the port", "T-41 on TR-5") as a link to its
   page, the words between in `look` (a tone, a clamp) */
const BOARD_ID = /\b(?:TR-\d+(?:\.\d+)?|WS-\d+|T-\d+|K-\d+|Q\d+)\b/g;
function idParts(words, local, look = {}) {
  const text = flatLine(words);
  const out = [];
  let at = 0;
  for (const m of text.matchAll(BOARD_ID)) {
    const href = local ? recordHref(local, m[0]) || '' : '';
    if (!href) continue;
    if (m.index > at) out.push({ ...look, text: text.slice(at, m.index) });
    out.push({ text: m[0], href, ...(look.tone ? { tone: look.tone } : {}) });
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push({ ...look, text: text.slice(at) });
  return out;
}

/* a record's name as a link to its board page, where the local server gives one */
const linkedName = (local, x, text = nameItem(x)) => {
  const href = x && local ? recordHref(local, x.key || x.id, x.url) || '' : '';
  return href ? { text, href } : text;
};
const blockingFirst = (qs) => qs.slice().sort((a, b) => (b.blocking === true ? 1 : 0) - (a.blocking === true ? 1 : 0));

/* the held track's goal, and when its last handoff restated it, what it was */
function goalRow(goal, restated, now, shown) {
  if (!goal) return null;
  const ago = restated ? spanOf(restated.at, now) : '';
  return tipRow(leadIcon('ldIntent'), [quiet(restated ? 'Goal, restated' + (ago ? ' ' + ago + ' ago' : '') + ': ' : 'Goal: '), shown(goal)],
    restated && restated.was ? [quiet('It was: '), shown(flatLine(restated.was))] : null);
}

function trackTip(f, { graph, handoffs, questions, now, local }) {
  const view = viewOfTrack(graph, f.id);
  const inView = (t) => linkedName(local, ((view && view.tasks) || []).find((x) => x.id === t.id) || t, nameItem(t));
  const stations = stationsOf(view, now);
  const done = Number.isFinite(f.done) ? f.done : view && Number.isFinite(view.done) ? view.done : 0;
  const total = Number.isFinite(f.total) ? f.total : view && Number.isFinite(view.total) ? view.total : null;
  const ws = f.workstream ? [linkedName(local, { id: f.workstream }, f.workstream + (f.workstreamName ? ' ' + f.workstreamName : ''))] : [quiet('Workstream not read yet')];
  const g1 = [tipRow(leadIcon('ldFolder'), ws),
    tipRow(leadIcon('ldClock'), heldFor('Held here', f.since, now)),
    goalRow(f.goal || flatLine(view && view.goal), f.goalRestated || (view && view.goalRestated), now, tipText)].filter(Boolean);
  let g2;
  if (!(total > 0) && !f.now.length && !f.readySet.length) g2 = [tipRow(leadIcon('ldDone'), [quiet('No tasks on this track yet')])];
  else {
    const p = progressOf(stations, { done, total, now: f.now, readySet: f.readySet });
    const toGo = Number.isFinite(f.toGo) ? f.toGo : f.critical.length;
    const look = { at: now, self: f.session, tasks: view && view.tasks };
    /* one row per task in the order the board sends them, each by its word; the ready cut as the held
       card's, so a long ready set keeps the card inside the window */
    const ready = f.readySet.slice(0, READY_MAX).map((t) => wordRow(t, inView(t), { ...look, fall: 'ready' }));
    if (f.readySet.length > READY_MAX) {
      const last = ready[READY_MAX - 1];
      ready[READY_MAX - 1] = { ...last, lines: [...last.lines, tipLine([quiet('and ' + (f.readySet.length - READY_MAX) + ' more ready')])] };
    }
    g2 = [total > 0 ? barRow(p) : null,
      ...f.now.map((t) => wordRow(t, inView(t), { ...look, fall: 'running' })),
      ...ready,
      flagRow(toGo, f.critical, viewNameOf(view), (id) => { const x = inView({ id }); return typeof x === 'string' ? '' : x.href; })].filter(Boolean);
  }
  const qs = blockingFirst((Array.isArray(questions) ? questions : []).filter((q) => q && q.track === f.id && (!q.status || q.status === 'open')));
  const h = handoffs && handoffs[f.id];
  const g3 = [...(qs.length ? qs.map((q) => askRow(q, false, local))
    : [tipRow(leadIcon('ldAsk'), [quiet('No open questions')])]),
  tipRow(leadIcon('ldHandoff'), h ? [quiet('Handoff ' + (h.created ? spanOf(h.created, now) + ' ago' : '') + ': '), tipText(h.focus)]
    : [quiet('No handoff yet; its tasks say where it stands')])];
  return { head: { icon: 'thread', title: f.id + ' ' + (flatLine(f.name) || f.id), state: trackStateOf(f) }, groups: [g1, g2, g3] };
}

/* each wait ("T-41 on TR-5", "Q93", "TR-7") with its short name, the first few named and
   the rest counted, as the kickoff names its waits; each its own part, its id's page */
const WAITS_MAX = 3;
function waitsParts(words, nameOf, hrefOf) {
  const shown = words.slice(0, WAITS_MAX);
  const parts = shown.map((w, i) => {
    const m = /^(\S+)(.*)$/.exec(w);
    const name = m ? shortName(nameOf(m[1]), 28) : '';
    const href = m ? hrefOf(m[1]) : '';
    return { text: (m ? m[1] + (name ? ' ' + name : '') + m[2] : w) + (i < words.length - 1 ? '; ' : ''), ...(href ? { href } : {}) };
  });
  return words.length > WAITS_MAX ? [...parts, { text: 'and ' + (words.length - WAITS_MAX) + ' more' }] : parts;
}

function taskTip(t, others, { graph, thread, questions, now, local }) {
  const pr = { high: ['ldHigh', 'amber'], medium: ['ldMedium', ''], low: ['ldLow', ''] }[t.priority];
  const g1 = [tipRow(leadIcon('ldIntent'), t.intent ? [tipText(t.intent)] : [quiet('No intent written yet')]),
    pr ? tipRow(leadIcon(pr[0], pr[1] || 'dim'), [{ text: capFirst(t.priority) + ' priority', ...(pr[1] ? { tone: pr[1] } : {}) }]) : null,
    tipRow(leadIcon('ldClock'), heldFor('In hand', t.since, now))].filter(Boolean);
  const v = viewOfTask(graph, t.id);
  const me = v && v.tasks.find((x) => x.id === t.id);
  let g2;
  if (me) {
    const open = (e) => e && !e.done;
    const edges = Array.isArray(v.edges) ? v.edges : [];
    const nameIn = (id) => linkedName(local, (v.tasks || []).find((x) => x.id === id) || { id });
    const first = edges.filter((e) => open(e) && e.on === t.id).map((e) => e.task);
    const then = [...new Set(edges.filter((e) => open(e) && first.includes(e.on)).map((e) => e.task))].filter((id) => !first.includes(id));
    const waits = (Array.isArray(me.waitsOn) ? me.waitsOn : []).map((w) => String(w).replace(/^after /, ''));
    const tasksIn = viewNameOf(v);
    const waitName = (id) => (/^TR-/.test(id) ? (viewOfTrack(graph, id) || {}).name
      : /^Q\d/.test(id) ? ((Array.isArray(questions) ? questions : []).find((q) => q && q.id === id) || {}).name : tasksIn(id)) || '';
    const steps = me.progress && Number(me.progress.total) > 0 ? me.progress : null;
    /* each wait's id opens its page */
    const waitHref = (id) => {
      const q = /^Q\d/.test(id) ? (Array.isArray(questions) ? questions : []).find((y) => y && y.id === id) : null;
      /* a question kept on this PC has no page */
      const x = /^TR-/.test(id) ? viewOfTrack(graph, id) || { id } : /^Q\d/.test(id) ? (q ? (q.local === true ? null : q) : { id })
        : (v.tasks || []).find((y) => y.id === id) || { id };
      const o = x ? linkedName(local, { id, key: x.key, url: x.boardUrl || x.url }, id) : id;
      return typeof o === 'string' ? '' : o.href;
    };
    g2 = [tipRow(leadIcon('thread'), [linkedName(local, v), Number.isFinite(me.position) && Number.isFinite(v.total) ? quiet(', ' + ordinal(me.position) + ' of ' + v.total) : '']),
      steps ? tipRow(leadIcon('ldDone'), [{ text: '', pic: { kind: 'bar', cells: [...Array(steps.done).fill('done'), ...Array(Math.max(0, steps.total - steps.done)).fill('waits')], alt: steps.done + ' of ' + steps.total + ' steps done' } },
        steps.done + ' of ' + steps.total + ' steps done']) : null,
      tipRow(leadIcon('ldWaits'), waits.length ? [quiet('Waits on '), ...waitsParts(waits, waitName, waitHref)] : [quiet('Waits on nothing open; '), 'free to run']),
      first.length ? tipRow(leadIcon('ldFrees'), ...first.map((id, i) => [i ? '' : quiet('Unblocks '), nameIn(id)]), then.length ? [quiet('then '), ...then.map((id, i) => { const x = nameIn(id); const text = id + (i < then.length - 1 ? ', ' : ''); return typeof x === 'string' ? text : { ...x, text }; })] : null)
        : tipRow(leadIcon('ldFrees'), [quiet('Nothing waits on it')])].filter(Boolean);
  } else if (t.track && t.track.id) g2 = [tipRow(leadIcon('thread'), [linkedName(local, t.track), quiet(', on another workstream')])];
  else g2 = [tipRow(leadIcon('thread'), thread && thread.id ? [quiet('Not on a track yet; this session holds '), linkedName(local, thread)] : [quiet('Not on a track yet')])];
  const n = t.note && t.note.text ? t.note : null;
  const g3 = [tipRow(leadIcon('ldNote'), n ? [quiet('Note ' + (n.at ? spanOf(n.at, now) + ' ago' : '') + ': '), tipText(n.text)] : [quiet('No notes yet')]),
    others.length ? tipRow(leadIcon('step'), ...others.map((o, i) => [linkedName(local, o), i ? '' : quiet(', also in hand')])) : tipRow(leadIcon('step'), [quiet('Nothing else in hand')])];
  return { head: { icon: 'step', title: nameItem(t), state: wordState(t.word) || TASK_STATUS[t.status] || (t.status ? { text: t.status, tone: 'dim' } : null) }, groups: [g1, g2, g3] };
}

/* a structured card and its terminal line, as cardOf makes a flat one */
function tipCard(title, tip, press) {
  const card = { title, parts: [], press, ...tip };
  return { card, tip: title + ': ' + cardText(card) + (press ? '. ' + press : '') };
}

/* the finished rows of each kind the agents chip's card lists */
export const CARD_DONE = 8;

/* the card's finished rows, the newest eight finished agents by their end, a dispatch kept whole
   with its own agents; Background's newest eight the same way; more is how many finished it leaves out */
function cardDone(am, bm, agents, background) {
  const ends = new Map();
  for (const x of [...(Array.isArray(agents) ? agents : []), ...(Array.isArray(background) ? background : [])]) if (x && x.id) ends.set(x.id, Number(x.end) || 0);
  const endOf = (rs) => rs.reduce((t, r) => Math.max(t, ends.get(r.id) || 0), 0);
  const keep = new Set();
  let more = 0;
  if (am) {
    const groups = [];
    for (const r of am.rows) if (r.ended) { if (r.under === 0 || !groups.length) groups.push([]); groups[groups.length - 1].push(r); }
    /* a workflow with no agents of its own counts as one */
    const count = (rs) => Math.max(rs.length ? 1 : 0, rs.filter((r) => !r.kind).length);
    let n = 0;
    /* the same end: the later dispatched first */
    const order = groups.map((g, i) => [g, i]).sort((x, y) => endOf(y[0]) - endOf(x[0]) || y[1] - x[1]).map(([g]) => g);
    for (const g of order) {
      const k = count(g);
      const take = n + k <= CARD_DONE ? g : n ? [] : g.slice(0, CARD_DONE);
      for (const r of take) keep.add(r);
      n += count(take);
      more += k - count(take);
    }
  }
  if (bm) {
    const done = bm.rows.filter((r) => r.done).map((r, i) => [r, i]).sort((x, y) => (ends.get(y[0].id) || 0) - (ends.get(x[0].id) || 0) || y[1] - x[1]).map(([r]) => r);
    for (const r of done.slice(0, CARD_DONE)) keep.add(r);
    more += Math.max(0, done.length - CARD_DONE);
  }
  const rows = [...(am ? am.rows.filter((r) => !r.ended || keep.has(r)) : []), ...(bm ? bm.rows.filter((r) => !r.done || keep.has(r)) : [])];
  return { rows, more };
}

/* the status row's word for a problem's part of the PC */
const HEALTH_WORDS = { copy: 'old copy', store: 'store', config: 'board join', board: 'board', server: 'local server', tray: 'tray', checkout: 'checkout' };

/* The line's segments, shortest horizon first; each carries its hover card (`card` for the
 * desktop, `tip` for the terminal) and `pic`, the desktop's picture; `mark`, the
 * AskerDo mark the desktop's row opens with. Tones: dim, bright, warning, error,
 * success. Null when there is nothing to draw. */
/* the status row's agents segment, drawn only while this session's agents or background
   tasks run, its card a row each; the count is all the work in flight, the card naming each kind.
   Null when none runs. Its own function so the live count lines read it alone */
export function agentsSegment(agents, guard, now, background) {
  const am = agentsModel(agents, guard, now, background);
  const bm = backgroundModel(background, now);
  if (!am && !bm) return null;
  const n = (am ? am.running : 0) + (bm ? bm.running : 0);
  const done = (am ? am.done : 0) + (bm ? bm.done : 0);
  const tone = am ? am.tone : 'sky';
  const open = am && bm ? 'the agents and background tasks' : am ? 'the agents' : 'the background tasks';
  /* the card lists what runs and the newest finished of each kind; its line counts them all and says how many
     more finished sit in Home's done folds (a day's finished agents made every band draw carry a row each) */
  const cut = cardDone(am, bm, agents, background);
  const c = cardOf(n === 1 ? 'Running' : 'In flight', [{ text: flightWords(am, bm), tone },
    ' running in this session' + (done ? ', ' + done + ' done' : '') + (cut.more ? '; ' + cut.more + ' more finished on Home' : '')], 'Press to open Home with ' + open + ' unfolded',
  cut.rows);
  return { key: 'agents', text: STATUS_GLYPHS.agents + ' ' + n, tone: tone === 'red' ? 'error' : tone === 'amber' ? 'warning' : 'bright',
    press: 'agents', ...c, pic: { kind: 'icon', icon: 'agents', tone: 'dim', label: String(n), labelTone: tone } };
}

/* segment: the agents segment built already (agentsSegment), so a caller that keeps it builds it once */
export function statusModel({ reading, main, rates, guard, thread, hand, shelf, elsewhere, asleep, here, now, agents, background, graph, handoffs, questions, local, version, health, segment } = {}) {
  const segs = [];
  if (reading && typeof reading.percent === 'number' && Number.isFinite(reading.percent)) {
    const p = wholePercent(reading);
    const tokens = typeof reading.tokens === 'number' ? reading.tokens : reading.window ? Math.round((reading.percent / 100) * reading.window) : 0;
    const [w, x] = marksFor(main);
    const pic = contextPic(reading, main, tokens);
    const c = cardOf('Context', [{ text: p + '%', tone: pic.tone }, ' of this session\'s context used' + (tokens ? ' (' + kTok(tokens) + ')' : ''),
      main && main.on === false ? '; the handoff marks are off'
        : '; handoff window from ' + w.percent + '%, wrap mark ' + x.percent + '%, hard limit ' + kTok(DEPTH_MARKER.hard)]);
    segs.push({ key: 'context', text: fillGlyph(reading.percent) + ' C ' + p + '%', tone: contextTone(reading, main, tokens), ...c, pic });
  }
  for (const [kind, key, letter, name] of STATUS_RATES) {
    const r = (Array.isArray(rates) ? rates : []).find((x) => x && x.kind === kind && typeof x.percentUsed === 'number');
    const title = key === 'hour' ? '5-hour limit' : 'Weekly limit';
    /* the engine reports none until the first model reply; the
       desktop draws the ring blank in its place, `empty` keeps it off the terminal. Some accounts have no five-hour limit, so that ring waits for its rate */
    if (!r) {
      if (kind === 'five_hour') continue;
      segs.push({ key, text: '', tone: 'dim', ...cardOf(title, ['no figures yet; they arrive after the next model reply'], USAGE_PRESS), href: USAGE_URL, empty: true, pic: ratePic(key, null) });
      continue;
    }
    const p = Math.round(r.percentUsed);
    const pic = ratePic(key, r.percentUsed);
    const c = cardOf(title, [{ text: p + '%', tone: pic.tone }, ' of ' + name + ' used' + resetText(r.resetsAt, now)], USAGE_PRESS);
    segs.push({ key, text: fillGlyph(r.percentUsed) + ' ' + letter + ' ' + p + '%', tone: rateTone(r.percentUsed), ...c, href: USAGE_URL, pic });
  }
  const ag = segment !== undefined ? segment : agentsSegment(agents, guard, now, background);
  if (ag) segs.push(ag);
  /* the first problem `askerdo status` lists, leading the right group; its press runs or copies the fix */
  const hc = healthCall(health);
  if (hc) {
    /* a refused protocol whose fix is on this PC says so, not "board" */
    const label = health.side === 'pc' ? 'update' : HEALTH_WORDS[health.key] || 'this PC';
    const c = cardOf('AskerDo on this PC', [{ text: 'Needs a fix', tone: 'amber' }, ': ' + hc.says + (hc.fix ? '. Fix: ' + hc.fix : '')], healthPressLine(hc));
    segs.push({ key: 'health', text: '! ' + label, tone: 'warning', ...c, press: 'health', pic: { kind: 'icon', icon: 'monitor', tone: 'amber', label, labelTone: 'amber' } });
  }
  if (guard) {
    const state = guard.problem ? 'unread' : guard.on ? 'on' : 'off';
    const c = cardOf('Agent guard', guard.problem
      ? [{ text: 'Board unread', tone: 'amber' }, ' (' + flatLine(guard.problem).slice(0, 160) + '), so it stays ' + (guard.on ? 'on' : 'off')
        + ' from the marker as it was']
      : guard.on ? [{ text: 'On', tone: 'green' }, ' (' + guardSource(guard.source) + '), subagents hear a hand-off note past '
        + kTok(guard.soft || DEPTH_MARKER.soft) + ' and an urgent one past ' + kTok(guard.hard || DEPTH_MARKER.hard)]
        : ['Off, so subagents hear no depth notes'], 'Press to turn it ' + (guard.on ? 'off' : 'on'));
    segs.push({ key: 'guard', text: STATUS_GLYPHS.shield + ' ' + (guard.on ? 'on' : 'off'), press: 'guard',
      tone: guard.problem ? 'warning' : guard.on ? 'success' : 'dim', ...c, pic: { kind: 'shield', state } });
  }
  if (thread && thread.id) {
    const name = flatLine(thread.name) || thread.id;
    const chain = flatLine(thread.chain);
    /* a side track says its chain, "TR-7 under TR-5 under TR-2, 2 parked behind this" */
    const label = /\bunder\b/.test(chain) ? chain : name;
    /* the tooltip groups where it is, how far along and what waits on you */
    const crit = thread.critical;
    const f = { ...thread, now: Array.isArray(thread.now) ? thread.now : [], readySet: Array.isArray(thread.readySet) ? thread.readySet : [],
      critical: Array.isArray(crit) ? crit : crit && Array.isArray(crit.path) ? crit.path : [] };
    /* the links come from the local server, never built here; a press line only with a link */
    const href = recordHref(local, thread.key || thread.id, thread.url);
    const c = tipCard('Track', trackTip(f, { graph, handoffs, questions, now, local }), href ? TRACK_PRESS : '');
    segs.push({ key: 'thread', text: label, tone: 'dim', ...c, ...(href ? { href } : {}), pic: { kind: 'icon', icon: 'thread', tone: 'dim', label } });
  }
  /* the newest task in hand and a count of the rest; the tooltip is the newest's, naming the rest */
  const held = (Array.isArray(hand) ? hand : []).filter((t) => t && t.id);
  if (held.length) {
    const label = held[0].id + ' ' + flatLine(held[0].name) + (held.length > 1 ? ' +' + (held.length - 1) : '');
    const href = recordHref(local, held[0].key || held[0].id, held[0].url);
    const c = tipCard(held.length > 1 ? 'Tasks in hand' : 'Task in hand', taskTip(held[0], held.slice(1), { graph, thread, questions, now, local }),
      href ? 'Press to open ' + held[0].id + '\'s page on the board' : '');
    segs.push({ key: 'task', text: label, tone: 'dim', ...c, ...(href ? { href } : {}), pic: { kind: 'icon', icon: 'step', tone: 'dim', label } });
  }
  const waiting = waitingRows(shelf);
  const open = 'Press to open Tracks in the AskerDo pane';
  if (waiting.length) {
    const n = waiting.length;
    const c = cardOf('Shelf', [{ text: String(n), tone: 'sky' }, (n === 1 ? ' track' : ' tracks') + ' waiting: '
      + waiting.slice(0, 3).map((r) => r.track + ' ' + flatLine(r.name)).join(', ') + (n > 3 ? ' and ' + (n - 3) + ' more' : '')], open);
    segs.push({ key: 'shelf', text: STATUS_GLYPHS.shelf + ' ' + n, tone: 'bright', ...c, press: 'shelf',
      pic: { kind: 'icon', icon: 'shelf', tone: 'dim', label: String(n), labelTone: 'sky' } });
  } else if (Array.isArray(shelf)) {
    /* the desktop draws an empty shelf as a gray 0 that still opens Threads; `empty` keeps it off the terminal */
    const c = cardOf('Shelf', ['no tracks waiting'], open);
    segs.push({ key: 'shelf', text: '', tone: 'dim', ...c, press: 'shelf', empty: true,
      pic: { kind: 'icon', icon: 'shelf', tone: 'dim', label: '0' } });
  }
  return segs.some((s) => !s.empty) ? { segments: segs, mark: markSeg(elsewhere, now, here, version, asleep) } : null;
}

/* ---- the desktop's pictures ---- */

const f2 = (n) => Math.round(n * 100) / 100;
/* rings start at 12 o'clock and run clockwise, a percent of a full turn */
const polar = (r, pct) => {
  const a = (pct / 50) * Math.PI - Math.PI / 2;
  return [f2(10 + r * Math.cos(a)), f2(10 + r * Math.sin(a))];
};
/* the ring's outer edge fills the 20 px line, as the mark's ink does */
const RING_R = 9;
function arc(p0, p1, cls) {
  if (p1 - p0 <= 0.01) return '';
  const tail = ' fill="none" stroke-width="2" class="' + cls + '"/>';
  if (p1 - p0 >= 99.99) return '<circle cx="10" cy="10" r="' + RING_R + '"' + tail;
  const [ax, ay] = polar(RING_R, p0);
  const [bx, by] = polar(RING_R, p1);
  return '<path d="M' + ax + ' ' + ay + 'A' + RING_R + ' ' + RING_R + ' 0 ' + (p1 - p0 > 50 ? 1 : 0) + ' 1 ' + bx + ' ' + by + '"' + tail;
}
/* A letter's baseline that centers its ink on y 10: Segoe UI ink above and below the
   baseline in em, measured in Edge 2026-10-23; the font's middle line drew capitals 1 px low. */
const INK = { cap: [0.71, 0.016], asc: [0.75, 0.016], desc: [0.516, 0.234], x: [0.516, 0.016] };
function inkBaseline(ch, size) {
  const [up, down] = INK[/[A-Z0-9]/.test(ch) ? 'cap' : 'bdfhiklt'.includes(ch) ? 'asc' : 'gjpqy'.includes(ch) ? 'desc' : 'x'];
  return Math.round((10 + ((up - down) * size) / 2) * 100) / 100;
}
/* the ring letters as tuned by eye: 10 px, W at 9.5, every baseline at 13.5 */
const RING_FONT = 10;
const RING_FONT_W = 9.5;
const RING_BASELINE = 13.5;
function ringBody(pic) {
  const n = pic.segments || 1;
  const gap = n === 1 ? 0 : (1.5 / (2 * Math.PI * 8)) * 100;
  let out = '';
  for (let k = 0; k < n; k++) {
    const s0 = (k * 100) / n, s1 = ((k + 1) * 100) / n, d0 = s0 + gap / 2, d1 = s1 - gap / 2;
    const at = (v) => d0 + ((v - s0) * (d1 - d0)) / (s1 - s0);
    out += arc(d0, d1, 's-track');
    for (const [z0, z1, role] of pic.zones) {
      const a = Math.max(s0, z0), b = Math.min(s1, z1, pic.percent);
      if (b > a) out += arc(at(a), at(b), 's-' + role);
    }
  }
  for (const m of pic.ticks || []) {
    const [ix, iy] = polar(7.4, m);
    const [ox, oy] = polar(10.4, m);
    out += '<line x1="' + ix + '" y1="' + iy + '" x2="' + ox + '" y2="' + oy + '" stroke-width="1" stroke-linecap="round" stroke-opacity="0.9" class="s-dim"/>';
  }
  /* C half a px left */
  const size = pic.letter === 'W' ? RING_FONT_W : RING_FONT;
  return out + '<text x="' + (pic.letter === 'C' ? 9.5 : 10) + '" y="' + RING_BASELINE + '" font-family="Segoe UI, system-ui, sans-serif" font-size="' + size + '" font-weight="800" text-anchor="middle"'
    + ' class="f-' + (pic.blank ? 'dim' : 'rest') + '">' + pic.letter + '</text>';
}
/* half a unit below the box's middle: the shield's weight sits at its top */
const SHIELD = 'M8 2.1L13.2 4.1V8.1C13.2 11.4 11 13.8 8 15.1C5 13.8 2.8 11.4 2.8 8.1V4.1Z';
/* the band's speech bubble, the questions' marks and the tooltips' question leads */
const BUBBLE = 'M4 2H12A2.5 2.5 0 0 1 14.5 4.5V8.5A2.5 2.5 0 0 1 12 11H8.2L4.6 14.2V11H4A2.5 2.5 0 0 1 1.5 8.5V4.5A2.5 2.5 0 0 1 4 2Z';
const FOLDER = '<path d="M2 4.6A1.1 1.1 0 0 1 3.1 3.5H6.1L7.6 5.1H12.9A1.1 1.1 0 0 1 14 6.2V12.4A1.1 1.1 0 0 1 12.9 13.5H3.1A1.1 1.1 0 0 1 2 12.4Z"/>';
const PAGE = '<path d="M4.2 2.2H9.4L12.4 5.2V12.8A1 1 0 0 1 11.4 13.8H4.2A1 1 0 0 1 3.2 12.8V3.2A1 1 0 0 1 4.2 2.2Z"/><path d="M9.2 2.4V5.4H12.2M5.6 8.6H10M5.6 11.2H10"/>';
/* each drawn in 16 units at stroke 1.4, with the box its strokes' middle lines span [x0, y0, x1, y1] */
const ICONS = {
  /* rails on a wider bend */
  thread: ['<path d="M3.2 14.4A11.2 11.2 0 0 1 14.4 3.2M7.2 14.4A7.2 7.2 0 0 1 14.4 7.2"/><path d="M2.01 12.08L8.7 13.33M3.9 7.44L9.57 11.2M7.44 3.9L11.2 9.57M12.08 2.01L13.33 8.7" stroke-width="1"/>', 'Rails on a wide bend, the held track', [2.01, 2.01, 14.4, 14.4]],
  /* a clipboard with a tick */
  step: ['<rect x="5.6" y="1.6" width="4.8" height="2.8" rx="0.9"/><path d="M10.4 3H11.8A1.4 1.4 0 0 1 13.2 4.4V13A1.4 1.4 0 0 1 11.8 14.4H4.2A1.4 1.4 0 0 1 2.8 13V4.4A1.4 1.4 0 0 1 4.2 3H5.6"/><path d="M5.6 9.2L7.4 11L10.6 7.6"/>', 'Clipboard with a tick, the task in hand', [2.8, 1.6, 13.2, 14.4]],
  shelf: ['<path d="M8 2.2L14 5.2L8 8.2L2 5.2Z"/><path d="M2 8.2L8 11.2L14 8.2"/><path d="M2 11.2L8 14.2L14 11.2"/>', 'Stack, the shelf', [2, 2.2, 14, 14.2]],
  agents: ['<circle cx="8" cy="3.6" r="1.7"/><circle cx="3.6" cy="12.4" r="1.7"/><circle cx="12.4" cy="12.4" r="1.7"/><path d="M8 5.3V8M3.6 10.7V8H12.4V10.7"/>', 'Branches, the agents in flight', [1.9, 1.9, 14.1, 14.1]],
  /* the tooltips' lead icons, as the generator's LEADS; ldLow is ldMedium turned down */
  ldFolder: [FOLDER, 'Folder, the workstream', [2, 2.4, 14, 14.6]],
  /* Home's folder and branch line, and the AskerDo button's tooltip */
  ldDir: [FOLDER, 'Folder, the session folder', [2, 2.4, 14, 14.6]],
  /* a question asked in another project, beside its track and PC */
  project: [FOLDER, 'Folder, the project it was asked in', [2, 2.4, 14, 14.6]],
  ldBranch: ['<circle cx="4.8" cy="3.8" r="1.6"/><circle cx="4.8" cy="12.2" r="1.6"/><circle cx="11.2" cy="5.4" r="1.6"/><path d="M4.8 5.4V10.6M11.2 7C11.2 9.4 4.8 8.2 4.8 10.6"/>', 'Branch, the git branch', [3.2, 2.2, 12.8, 13.8]],
  ldClock: ['<circle cx="8" cy="8" r="6"/><path d="M8 4.8V8L10.2 9.6"/>', 'Clock, how long it has been held', [2, 2, 14, 14]],
  ldDone: ['<circle cx="8" cy="8" r="6"/><path d="M5.4 8.2L7.2 10L10.6 6.4"/>', 'Tick in a circle, what is done', [2, 2, 14, 14]],
  ldFlag: ['<path d="M4.4 14V2.4M4.4 3H12.2L10.4 5.8L12.2 8.6H4.4"/>', 'Flag, the longest chain', [4.4, 2.4, 12.2, 14]],
  ldAsk: ['<path d="' + BUBBLE + '"/><path d="M6.5 5.1C6.5 4.3 7.2 3.8 8 3.8S9.5 4.3 9.5 5.1C9.5 6 8 6.2 8 7.3M8 9.1V9.15"/>', 'Speech bubble with a question mark, an open question', [1.5, 2, 14.5, 14.2]],
  ldBlock: ['<path d="' + BUBBLE + '" stroke-width="1.2" class="f-amber s-amber"/><path d="M8 4.1V7.1" stroke-width="1.6" class="s-onAmber"/><path d="M8 9.1V9.15" stroke-width="1.8" class="s-onAmber"/>',
    'Speech bubble with an exclamation mark, a blocking question', [1.5, 2, 14.5, 14.2]],
  ldHandoff: ['<path d="M2.6 5.4H12.4M10 3L12.4 5.4L10 7.8M13.4 10.6H3.6M6 8.2L3.6 10.6L6 13"/>', 'Two arrows passing, the handoff', [2.6, 2.4, 13.4, 13.6]],
  ldHigh: ['<path d="M4 8.6L8 4.8L12 8.6M4 12.6L8 8.8L12 12.6"/>', 'Two chevrons up, high priority', [4, 3.6, 12, 13.8]],
  ldMedium: ['<path d="M4 10.6L8 6.8L12 10.6"/>', 'One chevron up, medium priority', [4, 3.6, 12, 13.8]],
  ldLow: ['<path d="M4 6.8L8 10.6L12 6.8"/>', 'One chevron down, low priority', [4, 3.6, 12, 13.8]],
  ldIntent: ['<circle cx="8" cy="8" r="6"/><circle cx="8" cy="8" r="2.4"/>', 'Target, the intent', [2, 2, 14, 14]],
  ldWaits: ['<path d="M4.2 2.4H11.8M4.2 13.6H11.8M5.2 2.4V3.8C5.2 5.6 8 6.6 8 8S5.2 10.4 5.2 12.2V13.6M10.8 2.4V3.8C10.8 5.6 8 6.6 8 8S10.8 10.4 10.8 12.2V13.6"/>', 'Hourglass, what it waits on', [4.2, 2.4, 11.8, 13.6]],
  ldFrees: ['<rect x="3.4" y="7.2" width="9.2" height="6.6" rx="1.3"/><path d="M5.6 7.2V5.1A2.4 2.4 0 0 1 10.2 4.2"/>', 'An open lock, what it unblocks', [3.4, 2.7, 12.6, 13.8]],
  ldNote: [PAGE, 'A page, the newest note', [3.2, 2.2, 12.4, 13.8]],
  /* the PC a question was asked from, Lucide's monitor (lucide-static 0.460.0, ISC) at two thirds */
  monitor: ['<rect x="1.33" y="2" width="13.33" height="9.33" rx="1.33"/><path d="M5.33 14H10.67M8 11.33V14"/>', 'Monitor, the PC it was asked from', [1.33, 2, 14.67, 14]],
  /* a background row's kind: Lucide's square-terminal, activity and workflow (ISC) at two thirds */
  bgShell: ['<rect x="2" y="2" width="12" height="12" rx="1.33"/><path d="M4.67 7.33L6 6L4.67 4.67M7.33 8.67H10"/>', 'Terminal, a background shell', [2, 2, 14, 14]],
  bgMonitor: ['<path d="M14.67 8H12L10 14L6 2L4 8H1.33"/>', 'Pulse line, a monitor', [1.33, 2, 14.67, 14]],
  bgWorkflow: ['<rect x="2" y="2" width="5.33" height="5.33" rx="1.33"/><path d="M4.67 7.33V10A1.33 1.33 0 0 0 6 11.33H8.67"/><rect x="8.67" y="8.67" width="5.33" height="5.33" rx="1.33"/>', 'Two linked boxes, a workflow', [2, 2, 14, 14]],
  ldLoose: [PAGE, 'A page, the loose files, worktrees and branches due', [3.2, 2.2, 12.4, 13.8]],
  /* the rail's tunnel mouth, its arrow down at a dive and up at an exit, the other end's id beside it */
  portal: [PORTAL_ICON, 'Tunnel mouth, a link that runs underground to the station named beside it', [2, 2.2, 14, 16]],
};
/* a band icon's ink `ink` px tall in the 20 px line, the mark's 20 unless told: the
   16-unit shape scaled to fill it, every stroke kept at its weight (1.4 units draws 1.8 px); `edge` is its
   outer stroke in units, `box` its middle-line box; the ink centered across its own width, then the gap */
const TALL_STROKE = 1.8 / 1.4;
/* the status row's shield, thread and shelf at 15 px of ink; centered
   (top 2.5) measured best of tops 2 to 3 at 1x, 1.5x and 1.75x, within 0.12 device px */
const ROW_INK = 15;
function tallIcon(shape, [x0, y0, x1, y1], edge, gap = 0, ink = 20) {
  const top = (20 - ink) / 2;
  const e = edge * TALL_STROKE;
  const k = (ink - e) / (y1 - y0);
  const w = Math.ceil(k * (x1 - x0) + e);
  const tx = f2((w - k * (x1 - x0)) / 2 - k * x0), ty = f2(top + e / 2 - k * y0);
  const body = shape.replace(/stroke-width="([\d.]+)"/g, (m, v) => 'stroke-width="' + f2((v * TALL_STROKE) / k) + '"');
  return { w: w + gap, body: '<g transform="matrix(' + f2(k) + ' 0 0 ' + f2(k) + ' ' + tx + ' ' + ty + ')">' + body + '</g>' };
}
/* the colors a picture uses, its theme's shade by prefers-color-scheme */
function inkStyle(src) {
  const used = [...new Set(src.match(/\b[sf]-[a-zA-Z]+/g) || [])].filter((c) => c.slice(2) in PIC_INK);
  const rules = (i) => used.map((c) => '.' + c + '{' + (c[0] === 's' ? 'stroke' : 'fill') + ':' + PIC_INK[c.slice(2)][i] + '}').join('');
  return '<style>' + rules(0) + '@media (prefers-color-scheme: dark){' + rules(1) + '}</style>';
}
const svgOf = (w, h, body) => '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">'
  + inkStyle(body) + body + '</svg>';

/* the AskerDo mark, the tile-less faces in assets/ (favicon.svg, favicon-quiet.svg,
   favicon-blocking.svg, icons/app-mark-dark.svg) at the package's tray fit; a theme's shades per
   assets/icons/README.md, light then dark (orange check on light, cream on dark) */
const MARK_FIT = 'matrix(1.2403100775193798 0 0 1.2403100775193798 -11.720930232558144 -6.387596899224807)';
const MARK_BUBBLE = 'M35.6,14.5h-13.9c-5.5,0-8.3,2.8-8.3,8.3v14.5c0,5.5,2.8,8.3,8.3,8.3h2.1v8.3l11.4-8.3h7.2c5.5,0,8.3-2.8,8.3-8.3v-7.7';
const MARK_INK = {
  g0: ['#0077B8', '#3ACFFF'], g1: ['#7856CB', '#9B91FF'], g2: ['#CE238E', '#FF62C4'], check: ['#E8540B', '#FFF3DA'],
  quiet: ['#DF1989', '#FF6AC8'], waiting: ['#008AC7', '#39C9FF'], blocking: ['#E68A00', '#FFB300'],
  /* the asleep crescent in moon yellow, dark gold on light (assets/manifest.json colors.asleep) */
  asleep: ['#9E7C00', '#FFE08A'],
};
/* the waiting crescent is the asleep shape in the waiting dot's inks */
MARK_INK['waiting-asleep'] = MARK_INK.waiting;
/* a crescent: a disc less a bite at (cx + r*bx, cy + r*by, r*br) */
function crescent(cx, cy, r, [bx, by, br], id, cls) {
  return '<defs><mask id="' + id + '" maskUnits="userSpaceOnUse" x="0" y="0" width="80" height="80"><rect width="80" height="80" fill="#fff"/>'
    + '<circle cx="' + f2(cx + r * bx) + '" cy="' + f2(cy + r * by) + '" r="' + f2(r * br) + '" fill="#000"/></mask></defs>'
    + '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" mask="url(#' + id + ')" class="' + cls + '"/>';
}
/* the badge's bite, thinner than the text-size moon's so its horns stay apart at 16 px */
const BADGE_BITE = [0.5, -0.42, 0.78];
const MOON_BITE = [0.55, -0.45, 0.85];
function markSource(face, gap = 0) {
  const ring = face === 'quiet';
  const rule = (i) => '.g0{stop-color:' + MARK_INK.g0[i] + '}.g1{stop-color:' + MARK_INK.g1[i] + '}.g2{stop-color:' + MARK_INK.g2[i] + '}'
    + '.k{stroke:' + MARK_INK.check[i] + '}.m{' + (ring ? 'stroke' : 'fill') + ':' + MARK_INK[face][i] + '}';
  /* the crescent faces are the quiet one with only its badge changed, in the dots' footprint */
  const marker = ring ? '<circle cx="50.6" cy="14.5" r="6.5" stroke-width="5.7" fill="none" class="m"/>'
    : face === 'asleep' || face === 'waiting-asleep' ? crescent(50.6, 14.5, 9.35, BADGE_BITE, 'bite', 'm') : '<circle cx="50.6" cy="14.5" r="9.35" class="m"/>';
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + (20 + gap) + '" height="20" viewBox="0 0 ' + f2((64 * (20 + gap)) / 20) + ' 64">'
    + '<style>' + rule(0) + '@media (prefers-color-scheme: dark){' + rule(1) + '}</style>'
    + '<defs><linearGradient id="b" x1="-10.7" y1="75.2" x2="53.3" y2="11.2" gradientTransform="translate(7.8 78.8) scale(1 -1)" gradientUnits="userSpaceOnUse">'
    + '<stop offset="0" class="g0"/><stop offset=".5" class="g1"/><stop offset="1" class="g2"/></linearGradient></defs>'
    + '<g transform="' + MARK_FIT + '"><path d="' + MARK_BUBBLE + '" stroke-width="5.7" fill="none" stroke="url(#b)" stroke-linecap="round" stroke-linejoin="round"/>'
    + marker + '<path d="M22.8,30.6l6.2,6.2,11.4-12" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="6" class="k"/></g></svg>';
}

/* a toggle's switch, 34 by 20 on the 20 px line (sky on, an outlined track off); read only draws it dim */
export function switchPicture(on, live = true) {
  const track = on ? '<rect x="1" y="3" width="32" height="14" rx="7" class="f-' + (live ? 'sky' : 'dim') + '"/>'
    : '<rect x="1.6" y="3.6" width="30.8" height="12.8" rx="6.4" stroke-width="1.2" class="f-track s-edge"/>';
  const knob = '<circle cx="' + (on ? 25 : 9) + '" cy="10" r="' + (on ? 5 : 4.6) + '" class="f-' + (on ? 'onSky' : live ? 'rest' : 'dim') + '"/>';
  return { source: svgOf(34, 20, track + knob), alt: (on ? 'On' : 'Off') + (live ? ': press to turn ' + (on ? 'off' : 'on') : ', read only'), width: 34, height: 20 };
}
/* a setting set away from its built-in value, a dot in the badge's sky */
export const dotPicture = () => ({ source: svgOf(8, 8, '<circle cx="4" cy="4" r="3.5" class="f-sky"/>'), alt: 'Changed from built-in', width: 8, height: 8 });
/* the dim crescent, a lead in the 20 px line (an asleep row, the Asleep heading) */
export function moonPicture() {
  return { source: svgOf(LEAD_W, 20, crescent(9.4, 10.8, 6.6, MOON_BITE, 'bite', 'f-dim')), alt: 'Crescent moon, asleep', width: LEAD_W, height: 20 };
}

/* a band question card's picture, the mark's tray face for its state */
export function facePicture(blocking) {
  return { source: markSource(blocking ? 'blocking' : 'waiting'), alt: 'AskerDo mark, ' + (blocking ? 'a blocking question' : 'a waiting question'), width: 20, height: 20 };
}

/* A segment's picture as the renderer's Svg takes it; `gap` leaves room before a label. */
export function statusPicture(pic, gap = 0) {
  if (pic.kind === 'mark') {
    const nap = Number(pic.asleep) > 0 ? ', ' + pic.asleep + ' asleep' : '';
    const alt = 'AskerDo mark, ' + (pic.face === 'quiet' || pic.face === 'asleep' ? 'nothing waiting' : pic.blocking + ' blocking, ' + pic.waiting + ' waiting') + ' elsewhere' + nap;
    return { source: markSource(pic.face, gap), alt, width: 20 + gap, height: 20 };
  }
  if (pic.kind === 'ring') {
    const w = 20 + gap;
    const alt = pic.name + ' ring, ' + (pic.blank ? 'no figures yet' : (pic.whole ?? Math.round(pic.percent)) + ' percent');
    return { source: svgOf(w, 20, ringBody(pic)), alt, width: w, height: 20 };
  }
  if (pic.kind === 'shield') {
    const cls = pic.state === 'on' ? 'f-green s-greenEdge' : pic.state === 'off' ? 's-off' : 's-amber';
    const fill = pic.state === 'on' ? '' : ' fill="none"';
    const alt = 'Shield, agent guard ' + (pic.state === 'unread' ? 'unreadable' : pic.state);
    const t = tallIcon('<path d="' + SHIELD + '"' + fill + ' stroke-width="1.4" stroke-linejoin="round" class="' + cls + '"/>', [2.8, 2.1, 13.2, 15.1], 1.4, gap, ROW_INK);
    return { source: svgOf(t.w, 20, t.body), alt, width: t.w, height: 20 };
  }
  if (pic.kind === 'station') {
    return { source: svgOf(20, 20, '<g transform="matrix(0.8 0 0 0.8 2 2)">' + stationBody(pic.state) + '</g>'), alt: STATION_ALT[pic.state] || STATION_ALT.waits, width: 20, height: 20 };
  }
  if (pic.kind === 'bar') {
    const b = barBody(pic.cells || [], pic.max);
    return { source: svgOf(b.w, 20, b.body), alt: pic.alt || 'One cell per task', width: b.w, height: 20 };
  }
  const [shape, alt, box] = ICONS[pic.icon];
  const t = tallIcon(stroked(shape, 's-' + pic.tone), box, 1.4, gap, ROW_INK);
  /* a tooltip's lead centred in its 20 px column, so a column of them lines up */
  if (pic.lead && t.w < LEAD_W) {
    return { source: svgOf(LEAD_W, 20, '<g transform="translate(' + f2((LEAD_W - t.w) / 2) + ' 0)">' + t.body + '</g>'), alt, width: LEAD_W, height: 20 };
  }
  return { source: svgOf(t.w, 20, t.body), alt, width: t.w, height: 20 };
}

/* the tooltips' non-icon leads. A station as the board map draws it, at
   four fifths in the 20 px line; a bar of one cell per task: done grey, running sky, ready ringed */
const LEAD_W = 20;
const STATION_ALT = { now: 'A filled station, running', left: 'A half-filled station, unconfirmed', ready: 'A ringed station, ready to start', gated: 'An amber station, held by a question', waits: 'A grey station, waiting' };
function stationBody(kind) {
  const c = (r, cls, sw) => '<circle cx="10" cy="10" r="' + r + '" ' + (sw ? 'fill="none" stroke-width="' + sw + '" class="s-' + cls + '"' : 'class="f-' + cls + '"') + '/>';
  return kind === 'now' ? '<circle cx="10" cy="10" r="9" class="f-sky" fill-opacity="0.2"/>' + c(5, 'sky')
    : kind === 'ready' ? c(4.6, 'sky', 2.2)
      : kind === 'left' ? c(4.6, 'sky', 1.8) + '<path d="M10 6.4A3.6 3.6 0 0 0 10 13.6Z" class="f-sky"/>'
      : kind === 'gated' ? c(4.4, 'amber', 2) + c(1.6, 'amber')
        : c(3.8, 'dim', 1.8);
}
/* the bar at most BAR_MAX px wide, so its words still fit beside it in the tooltip's 360 px;
   `max` narrows it to the room a pane row leaves beside its lead */
const BAR_MAX = 168;
const BAR_RECTS = 1500;
const barFill = (k) => k === 'done' ? 'rest' : k === 'now' || k === 'ready' || k === 'left' ? 'sky' : k === 'gated' || k === 'review' ? 'amber' : 'track';
/* each pixel column takes the color most of its cells have; a held finish keeps its padlock */
function barColumns(cells, cols) {
  const state = { rest: 'done', sky: 'now', amber: 'review', track: 'waits' };
  return Array.from({ length: cols }, (_, c) => {
    const part = cells.slice(Math.floor((c * cells.length) / cols), Math.floor(((c + 1) * cells.length) / cols));
    if (part.includes('lock')) return 'lock';
    const count = {};
    for (const k of part) count[barFill(k)] = (count[barFill(k)] || 0) + 1;
    return state[Object.keys(count).sort((a, b) => count[b] - count[a])[0]];
  });
}
function barBody(cells, max = BAR_MAX) {
  const cap = Number(max) > 0 ? Math.min(BAR_MAX, Number(max)) : BAR_MAX;
  /* a rect a task passes the page's limit on an Svg's source (131,072 characters) near
     1835 tasks and the bar would draw empty, so past BAR_RECTS cells the bar draws by pixel column */
  const wide = cells.length > BAR_RECTS;
  if (wide) cells = barColumns(cells, Math.max(1, Math.floor(cap - 2)));
  const n = Math.max(1, cells.length);
  let cw = 14, gap = 2;
  if (n * (cw + gap) - gap + 2 > cap) { gap = n > 24 ? 1 : 2; cw = (cap - 2 - (n - 1) * gap) / n; }
  /* past a cell a pixel wide the gaps go and the cells narrow to fit, never past the cap */
  if (cw < 1) { gap = 0; cw = (cap - 2) / n; }
  const fill = barFill;
  const w = Math.min(Math.ceil(cap), Math.ceil(n * (cw + gap) - gap + 2));
  const isRing = (k) => (k === 'ready' || k === 'gated' || k === 'left') && cw >= 4;
  const plain = (k) => k !== undefined && k !== 'lock' && !isRing(k);
  /* a cell is its x alone, a style setting the rest (CSS geometry, the same rect drawn);
     the commonest color is the bar's group, and a run of another color shares one */
  const tally = {};
  if (!wide) for (const k of cells) if (plain(k)) tally[fill(k)] = (tally[fill(k)] || 0) + 1;
  const base = Object.keys(tally).sort((a, b) => tally[b] - tally[a])[0] || '';
  let body = '', open = '';
  const close = () => { if (open) body += '</g>'; open = ''; };
  for (let i = 0; i < cells.length; i++) {
    const k = cells[i];
    const x = 1 + i * (cw + gap);
    const ring = isRing(k);
    if (!wide && plain(k)) {
      const f = fill(k);
      if (open !== f) {
        close();
        if (f !== base) {
          if (!(plain(cells[i + 1]) && fill(cells[i + 1]) === f)) { body += '<rect x="' + f2(x) + '" class="f-' + f + '"/>'; continue; }
          body += '<g class="f-' + f + '">';
          open = f;
        }
      }
      body += '<rect x="' + f2(x) + '"/>';
      continue;
    }
    close();
    /* a held finish, an amber padlock as tall as the cells and their room */
    if (k === 'lock') {
      /* the padlock whole inside the bar where its cell is narrower than it */
      const m = Math.max(3.6, Math.min(x + cw / 2, w - 3.6));
      body += '<path d="M' + f2(m - 2.4) + ' 9V7.2A2.4 2.4 0 0 1 ' + f2(m + 2.4) + ' 7.2V9" fill="none" stroke-width="1.4" class="s-amber"/><rect x="' + f2(m - 3.6) + '" y="9" width="7.2" height="5.4" rx="1.2" class="f-amber"/>';
      continue;
    }
    if (ring) {
      body += '<rect x="' + f2(x + 0.7) + '" y="7.7" width="' + f2(cw - 1.4) + '" height="4.6" rx="1.6" fill="none" stroke-width="1.4" class="s-' + (k === 'gated' ? 'amber' : 'sky') + '"/>';
      /* an unconfirmed cell is the station's half mark: ringed, its first half filled */
      if (k === 'left') body += '<rect x="' + f2(x + 0.7) + '" y="7.7" width="' + f2((cw - 1.4) / 2) + '" height="4.6" rx="1.6" class="f-sky"/>';
      continue;
    }
    /* a run of columns of one color is one rect */
    let run = 1;
    if (wide) while (i + run < cells.length && cells[i + run] !== 'lock' && fill(cells[i + run]) === fill(k)) run++;
    body += '<rect x="' + f2(x) + '" y="7" width="' + f2(cw * run) + '" height="6" rx="' + (cw >= 4 ? 2 : 0.5) + '" class="f-' + fill(k) + '"/>';
    i += run - 1;
  }
  close();
  if (base) body = '<style>rect:not([rx]){y:7px;width:' + f2(cw) + 'px;height:6px;rx:' + (cw >= 4 ? 2 : 0.5) + 'px}</style><g class="f-' + base + '">' + body + '</g>';
  return { w, body };
}
const stroked = (shape, cls) => '<g fill="none" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" class="' + cls + '">' + shape + '</g>';

/* the band's own marks, drawn as the status row's are: a speech bubble
   (blocking: amber filled with an exclamation; open: an outline with a question mark),
   the green inbox, and the feed's kinds by the status row's icons. */
/* the tray's outline one open path: a Z closed it back across the tray */
const INBOX = '<path d="M5.2 4.6H3.4L1.8 9.4V12.4A1.2 1.2 0 0 0 3 13.6H13A1.2 1.2 0 0 0 14.2 12.4V9.4L12.6 4.6H10.8"/>'
  + '<path d="M1.8 9.4H5.1L6.1 11H9.9L10.9 9.4H14.2"/><path d="M8 1.8V7.6M5.9 5.5L8 7.6L10.1 5.5"/>';
const KIND_ICON = { task: 'step', plan: 'step', thread: 'thread', track: 'thread', handoff: 'thread', call: 'ldFlag' };
/* `tall`: the band's own row, its ink as tall as the mark's; the feed keeps 16 px */
export function markPicture(mark, tone = 'rest', tall = false) {
  const pic = (body, alt, box, edge) => {
    if (!tall || !box) return { source: svgOf(16, 16, body), alt, width: 16, height: 16 };
    const t = tallIcon(body, box, edge);
    return { source: svgOf(t.w, 20, t.body), alt, width: t.w, height: 20 };
  };
  const bubble = [1.5, 2, 14.5, 14.2];
  if (mark === 'blocking') {
    return pic('<path d="' + BUBBLE + '" stroke-width="1.2" stroke-linejoin="round" class="f-amber s-amber"/>'
      + '<path d="M8 4.1V7.1" stroke-width="1.6" stroke-linecap="round" class="s-onAmber"/><circle cx="8" cy="9.1" r="0.9" class="f-onAmber"/>',
    'Speech bubble with an exclamation mark, a blocking question', bubble, 1.2);
  }
  if (mark === 'open' || mark === 'question') {
    return pic('<path d="' + BUBBLE + '" fill="none" stroke-width="1.3" stroke-linejoin="round" class="s-' + tone + '"/>'
      + '<path d="M6.5 5.1C6.5 4.3 7.2 3.8 8 3.8S9.5 4.3 9.5 5.1C9.5 6 8 6.2 8 7.3" fill="none" stroke-width="1.3" stroke-linecap="round" class="s-' + tone + '"/>'
      + '<circle cx="8" cy="9.1" r="0.8" class="f-' + tone + '"/>', 'Speech bubble with a question mark, an open question', bubble, 1.3);
  }
  if (mark === 'inbox') return pic(stroked(INBOX, 's-greenEdge'), 'Inbox tray with an arrow, answers waiting for this session', [1.8, 1.8, 14.2, 13.6], 1.4);
  const [shape, alt] = ICONS[KIND_ICON[mark] || 'shelf'];
  return pic(stroked(shape, 's-' + tone), alt.split(',')[0] + ', a ' + (mark || 'record'));
}

/* a question card's letter as a ring in the status row's style. open: an outline
   with the letter; answer: filled with a check; other: dim, the card answered. Every
   open letter in the text color, the pick's too; blue is the pick tile's outline and the answer. */
/* a small letter's ink as tall as the status rings' capitals (about 7 px in 20) */
const CHIP_FONT = 13;
export function chipPicture(letter, state = 'open') {
  const ring = (cls, fill) => '<circle cx="10" cy="10" r="8.2" stroke-width="1.5"' + (fill ? '' : ' fill="none"') + ' class="' + cls + '"/>';
  const glyph = (cls) => '<text x="10" y="' + inkBaseline(letter, CHIP_FONT) + '" font-family="Segoe UI, system-ui, sans-serif" font-size="' + CHIP_FONT + '" font-weight="700" text-anchor="middle"'
    + ' class="' + cls + '">' + letter + '</text>';
  const pic = (body, alt) => ({ source: svgOf(20, 20, body), alt, width: 20, height: 20 });
  if (state === 'answer') {
    return pic(ring('f-sky s-sky', true) + '<path d="M6.2 10.2L8.8 12.8L13.8 7.4" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="s-onSky"/>',
      'Option ' + letter + ', your answer, a filled ring with a check');
  }
  if (state === 'other') return pic(ring('s-dim') + glyph('f-dim'), 'Option ' + letter + ', not picked');
  return pic(ring('s-text') + glyph('f-text'), 'Option ' + letter + (state === 'pick' ? ', the pick' : ''));
}

/* an option's letter in its own sky badge, a 16 px rounded square in the
   20 px line. open: the sky fill and a near black letter; answer: the user's green with a near black
   check (answered is green, not blue); other: a dim outline and letter, the card answered; queued: amber. */
const BADGE_FONT = 11.5;
export function badgePicture(letter, state = 'open') {
  const box = (cls) => '<rect x="1" y="2" width="16" height="16" rx="4.5" class="' + cls + '"/>';
  const glyph = (cls) => '<text x="9" y="' + inkBaseline(letter, BADGE_FONT) + '" font-family="Segoe UI, system-ui, sans-serif" font-size="' + BADGE_FONT
    + '" font-weight="600" text-anchor="middle" class="' + cls + '">' + letter + '</text>';
  const pic = (body, alt) => ({ source: svgOf(18, 20, body), alt, width: 18, height: 20 });
  if (state === 'answer') {
    return pic(box('f-chosen') + '<path d="M5.4 10.2L7.9 12.7L12.6 7.6" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="s-onBadge"/>',
      'Option ' + letter + ', your answer, a green badge with a check');
  }
  /* a queued answer's badge, amber, the letter on it */
  if (state === 'queued') return pic(box('f-amber') + glyph('f-onAmber'), 'Option ' + letter + ', your queued answer, an amber badge');
  if (state === 'other') {
    return pic('<rect x="1.6" y="2.6" width="14.8" height="14.8" rx="4" fill="none" stroke-width="1.2" class="s-edge"/>' + glyph('f-dim'), 'Option ' + letter + ', not picked');
  }
  return pic(box('f-badge') + glyph('f-onBadge'), 'Option ' + letter + (state === 'pick' ? ', the pick' : '') + ', its letter in a sky badge');
}

export const slotLine = (s) => (s.label ? s.label + ': ' : '') + s.text;

export const askPrompt = (tok) => 'Tell me more about ' + tok + ' before I pick.';

export { cardHref, recordHref, signedRoot };

/* The one-question row's answer labels: the letter and the option name where the
 * row fits its width, the letter alone where not; the pick's carries the star, and the token
 * lives in the chip's card. The fit counts what band.tsx questionRow draws on
 * `o.surface`: the mark, the name up to NAME_ROOM, Home's fold ring (`o.unfold`), the chips, `o.age`, `o.closed`. */
const NAME_ROOM = 24;
const ROW_GAP = 3;
/* a desktop cell is 8.453 px (14 px Anthropic Sans, desktop-capabilities); its words measure in
   deskCells. A chip past its words: the 18 px badge, a 1 px border each side,
   then its padding and gap, 2.1 cells with words (status.tsx CHIP) */
const DESK_CELL = 8.453;
/* Home's fold ring ending the row, 24 px and a cell before it (fold.tsx FOLD_CELLS) */
const FOLD_ROOM = 4;
/* the cells the row needs: its chips with their words (named) or the letters alone, the name up to nameCells;
   band.tsx asks it whether Home's row holds the whole name */
export function rowNeed(q, o, named, nameCells, gap) {
  const desk = o.surface === 'desktop';
  const w = widthFor(desk);
  const words = (a) => (named && a.option ? a.option : '');
  /* as chipFace draws it, a desktop pick's star takes its space only before words */
  const star = (a) => (q.pick !== a.letter ? '' : desk && !words(a) ? STAR : STAR + ' ');
  /* a desktop chip with no star or words is the badge in half a cell each side; a terminal chip
     its label, the letter's sky cell each side and the button's two */
  const said = (a) => star(a) + words(a);
  const chip = (a) => (desk ? 20 / DESK_CELL + (said(a) ? 2.1 + w(said(a)) : 1) : cellWidth(star(a) + a.letter + (words(a) ? ' ' + words(a) : '')) + 6);
  const tail = [o.age, o.closed].filter(Boolean).reduce((n, s) => n + gap + w(s), 0);
  /* the name sits one cell from its chips, the chips a cell apart; the gap parts the chips from
     what follows (the desktop's last chip takes no cell after it) */
  return (desk ? 3 : 2) + Math.min(w(q.name), nameCells) + (o.unfold ? FOLD_ROOM : 0) + 1 + tail + q.answers.reduce((n, a) => n + chip(a) + 1, desk ? -1 : 0);
}
export function answerLabels(q, columns, o = {}) {
  const star = (a) => (q.pick === a.letter ? STAR + ' ' : '');
  const named = q.answers.map((a) => star(a) + a.letter + (a.option ? ' ' + a.option : ''));
  const bare = q.answers.map((a) => star(a) + a.letter);
  if (!Number.isFinite(columns)) return bare;
  return rowNeed(q, o, true, NAME_ROOM, ROW_GAP) <= columns ? named : bare;
}

/* the gap between the row's name, chips and age. A row narrow enough for bare letters
   (Home's copy at about 425 px) spent six cells on its two gaps while the name cut to "l..."; there
   the gaps close to one cell before the name cuts */
export function rowGap(q, columns, o = {}) {
  if (!Number.isFinite(columns) || rowNeed(q, o, true, NAME_ROOM, ROW_GAP) <= columns) return ROW_GAP;
  return rowNeed(q, o, false, Infinity, ROW_GAP) <= columns ? ROW_GAP : 1;
}

/* A band chip's hover card: the option's row in one line; the pick's says so. */
export const chipText = (a, pick) => a.token + ' ' + a.option + (a.gets ? ': ' + a.gets : '') + (a.catch ? '; catch: ' + a.catch : '')
  + (pick ? ' (my pick)' : '');

/* a band chip's desktop card in lines; oneWay, the undo's words (or the bare
   word) when the undo or the catch says it is hard to undo, the catch then without its tag. */
export function chipCard(a, pick, confirm = false) {
  const hard = oneWayUndo(a.undo);
  const c = a.catch || '';
  const bare = !hard ? c : c === 'one-way' ? '' : c.endsWith(ONE_WAY) ? c.slice(0, -ONE_WAY.length) : c;
  const gets = a.gets ? a.gets[0].toUpperCase() + a.gets.slice(1) : '';
  return {
    title: a.token + ' ' + a.option, gets, catch: bare,
    oneWay: hard ? flatLine(a.undo) : /\bone-way\b/i.test(c) ? 'one-way' : '',
    press: (pick ? 'My pick. ' : '') + (confirm ? 'Press to answer or queue ' : 'Press to answer with ') + a.token,
  };
}

/* ---- the AskUserQuestion redraw ---------------------------------------- */

const MARK = (words) => new RegExp('(?:\\*\\*|__)?\\b(?:' + words + ')(?:\\*\\*|__)?\\s*:\\s*(?:\\*\\*|__)?', 'i');
const GETS = MARK('what happens|gets you|you get|gets|pros?|upsides?|benefits?|gains?');
const COSTS = MARK('catch|costs you|you pay|costs?|cons?|downsides?|trade-?offs?|risks?');
const trimPart = (s) => String(s).replace(/^[\s.;,|]+|[\s.;,|]+$/g, '');

/* Where an option's text names what it gets and what it costs, the two parts;
 * otherwise null, and the option is drawn as written. */
export function splitGetsCosts(text) {
  const s = String(text == null ? '' : text);
  const g = GETS.exec(s);
  const c = COSTS.exec(s);
  if (!g || !c) return null;
  const [first, second] = g.index < c.index ? [g, c] : [c, g];
  const lead = trimPart(s.slice(0, first.index));
  const one = trimPart(s.slice(first.index + first[0].length, second.index));
  const two = trimPart(s.slice(second.index + second[0].length));
  const [gets, costs] = first === g ? [one, two] : [two, one];
  return gets && costs ? { lead, gets, costs } : null;
}

export function decisionRow(description) {
  const p = splitGetsCosts(description);
  if (!p) return null;
  return (p.lead ? p.lead + '. ' : '') + 'What happens: ' + p.gets + ' | Catch: ' + p.costs;
}

/* The card's option cell as a dialog label: the letter, the star on the one the
 * tool marks "(Recommended)", the title. */
const RECOMMENDED = /\s*\(recommended\)\s*/i;
const letterOf = (i) => String.fromCharCode(97 + i);
export function dialogLabel(label, letter) {
  const s = String(label);
  return letter + ' ' + (RECOMMENDED.test(s) ? STAR + ' ' : '') + s.replace(RECOMMENDED, ' ').trim();
}

/* The tool's questions drawn as the card's rows: in a question with a split,
 * each label lettered and the descriptions as table rows; null when no option
 * carries a split, so the hook passes the props on as they came. */
export function decisionQuestions(questions) {
  if (!Array.isArray(questions)) return null;
  let changed = false;
  const out = questions.map((q) => {
    if (!q || typeof q !== 'object' || !Array.isArray(q.options)) return q;
    const rows = q.options.map((o) => (o && typeof o === 'object' && typeof o.description === 'string' ? decisionRow(o.description) : null));
    if (!rows.some(Boolean)) return q;
    /* every label already on its own letter: drawn once already */
    const lettered = q.options.every((o, i) => o && typeof o.label === 'string' && o.label.startsWith(letterOf(i) + ' '));
    const options = q.options.map((o, i) => {
      if (!o || typeof o !== 'object') return o;
      const label = typeof o.label === 'string' && !lettered ? dialogLabel(o.label, letterOf(i)) : o.label;
      const description = rows[i] || o.description;
      if (label === o.label && description === o.description) return o;
      changed = true;
      return { ...o, label, description };
    });
    return { ...q, options };
  });
  return changed ? out : null;
}

/* ---- answer delivery ------------------------------------------- */

/* the user's answers, and the drops and snoozes the user's presses made,
 * read as the user's own words; every other line sits under the plugin's relay header. */
export const RELAY_HEAD = 'AskerDo relays these updates on questions and work this session follows (not my words):';

const tokenOf = (id, pick) => (/^[a-z]$/.test(String(pick)) ? token(id, pick) : flatLine(pick));

/* One event in the user's voice, or null when the line is not theirs. */
export function userLine(e, options = {}) {
  const r = (e && e.raw) || {};
  /* the user's press on an override the session asked */
  if (r.kind === 'override' && /^user:/.test(String(r.by || ''))) {
    const recs = Array.isArray(r.records) && r.records.length ? ' (' + r.records.map(flatLine).join(', ') + ')' : '';
    if (r.decided === 'changed') return 'I pressed ' + actLabel(r.act) + ' on override ' + flatLine(r.request || r.id) + recs + ', but it changed since you asked, so nothing was applied: ask again from the text as it stands.';
    if (r.decided === 'dropped') return 'I pressed on override ' + flatLine(r.request || r.id) + recs + ', but it had expired unanswered, so nothing was applied: ask again if it is still needed.';
    return 'I ' + (r.decided === 'allow' ? ({ withdraw: 'withdrew', fix: 'fixed', scrub: 'scrubbed' }[r.act] || 'allowed') : 'kept as written') + ' override ' + flatLine(r.request || r.id) + recs
      + (r.decided === 'allow' ? ': the change is applied.' : ': nothing was changed.');
  }
  if (!r.id || !r.name) return null;
  const label = flatLine(r.id) + ' (' + flatLine(r.name) + ')';
  const note = r.note ? flatLine(r.note) : '';
  if (r.kind === 'answer') {
    const said = (r.amended === true ? 'I changed my answer to ' : 'I answered ') + label;
    if (!r.pick) return note ? said + ': ' + note : null;
    const o = (Array.isArray(options[r.id]) ? options[r.id] : []).find((x) => x && x.type === r.pick);
    return said + ': ' + tokenOf(r.id, r.pick) + (o && o.option ? ', ' + flatLine(o.option) : '') + '.' + (note ? ' My note: ' + note : '');
  }
  if (!/^user:/.test(String(r.by || ''))) return null;
  if (r.kind === 'drop') return 'I dropped ' + label + '.' + (note ? ' My reason: ' + note : '');
  if (r.kind === 'snooze') return 'I snoozed ' + label + (r.detail ? ': ' + flatLine(r.detail) : '') + '.';
  return null;
}

/* what a placement question's answer did, from its event's `created` or `outcome`; the
   plugin's words, since the board created it, never the user's. '' for any other event. */
export function placedRelay(e) {
  const r = (e && e.raw) || {};
  const c = r.created && typeof r.created === 'object' ? r.created : null;
  if (!r.id || (!c && !r.outcome)) return '';
  const label = flatLine(r.id) + (r.name ? ' (' + flatLine(r.name) + ')' : '');
  const ids = (v) => [].concat(v || []).map(flatLine).filter(Boolean);
  if (c && c.id && r.how === 'step') return 'The answer to ' + label + ' added it as a step of ' + flatLine(c.id) + (c.track ? ' on ' + flatLine(c.track) : '') + '.';
  if (c && c.id) {
    return 'The answer to ' + label + (r.how === 'moved' ? ' placed ' : ' created ') + flatLine(c.id) + (c.track ? ' on ' + flatLine(c.track) : ' in the inbox')
      + (ids(c.before).length ? ', before ' + ids(c.before).join(', ') : '') + (ids(c.after).length ? ', after ' + ids(c.after).join(', ') : '') + '.';
  }
  const n = nameOf();
  if (r.outcome === 'talk') return 'The answer to ' + label + ' created nothing: talk with ' + n + ' about where it fits, then place it at the place settled with question ' + flatLine(r.id) + ' and their words.';
  if (r.outcome === 'drop') return 'The answer to ' + label + ' dropped the work: nothing was created.';
  if (r.outcome === 'stale') return 'The answer to ' + label + ' created nothing: the place pressed is gone (its tasks closed or its track ended), so talk it through with ' + n + ' as for talk.';
  return '';
}

/* What waits as one text: the user's lines bare, then the relayed ones under their header. */
export function deliveryText(events, options = {}) {
  const evs = (events || []).map((e) => (typeof e === 'string' ? { line: e } : e)).filter((e) => e && e.line);
  const mine = [];
  const relayed = [];
  for (const e of evs) {
    const d = userLine(e, options);
    if (d) mine.push(d); else relayed.push('- ' + flatLine(e.line));
    const placed = placedRelay(e);
    if (placed) relayed.push('- ' + placed);
  }
  return [mine.join('\n'), relayed.length ? RELAY_HEAD + '\n' + relayed.join('\n') : ''].filter(Boolean).join('\n\n');
}

/* each answer a delivery carried, once: its token (the id for a note
 * alone), the question's name, and whether a note rode along. */
export function receiptsOf(events) {
  const out = [];
  for (const e of events || []) {
    const r = (e && e.raw) || {};
    if (r.kind !== 'answer' || !r.id) continue;
    const letter = /^[a-z]$/.test(String(r.pick || ''));
    const tok = letter ? token(r.id, r.pick) : flatLine(r.id);
    if (!out.some((x) => x.token === tok)) out.push({ token: tok, name: r.name ? flatLine(r.name) : '', note: r.note ? (letter ? 'with' : 'as') : '' });
  }
  return out;
}

/* the transcript row the moment a delivery reaches the model; '' for none. */
export function receiptRow(got) {
  if (!got || !got.length) return '';
  const one = (x) => x.token + (x.name ? ' (' + x.name + ')' : '') + (x.note === 'with' ? ' with your note' : x.note === 'as' ? ' as your note' : '');
  return 'AskerDo: your answer' + (got.length === 1 ? '' : 's') + ' reached the model: ' + got.map(one).join(', ') + '.';
}

/* nothing wakes a session. What waits in its inbox is
 * counted on the band and rides the next prompt; `options` maps a question id to
 * its options, so an answer's hover line names the option; `here`, this PC's name,
 * so an item says when it came from another PC. */
export function inboxWaiting(events, options = {}, here = '') {
  const evs = (events || []).filter((e) => e && e.line);
  if (!evs.length) return null;
  const line = (e) => {
    const r = e.raw || {};
    if (r.kind !== 'answer' || !r.pick || !r.id) return flatLine(e.line);
    const o = (Array.isArray(options[r.id]) ? options[r.id] : []).find((x) => x && x.type === r.pick);
    return r.id + ' ' + flatLine(r.name) + ': ' + token(r.id, r.pick) + (o && o.option ? ', ' + flatLine(o.option) : '');
  };
  const isAnswer = (e) => e.raw && e.raw.kind === 'answer';
  /* each answer's toast text, keyed so it is raised once */
  /* the user's own press in this session had its toast at the press */
  const pressed = (e) => !!e.box && e.raw.by === 'user:' + e.box;
  const answered = evs.filter((e) => isAnswer(e) && e.raw.pick && e.raw.id && !pressed(e)).map((e) => ({ key: e.key, text: answerToast(line(e)) }));
  /* a woken question's toast, raised once per wake by the same key */
  const woke = evs.filter((e) => e.raw && e.raw.kind === 'wake').map((e) => ({ key: e.key, text: flatLine(e.line) }));
  const arrived = [...answered, ...woke];
  /* the user's own press in this session draws no waiting row and adds to no count;
     it stays in the inbox, so the turn's take still hands it to the model */
  const shown = evs.filter((e) => !pressed(e));
  if (!shown.length && !arrived.length) return null;
  const items = shown.map((e) => waitItem(e, options, here));
  return { n: shown.length, answers: shown.every(isAnswer), items, lines: items.map((i) => i.text + (i.detail ? '. ' + i.detail : '')), keys: shown.map((e) => e.key), arrived };
}

/* one waiting update in the user's words: what happened, who sent it, the record with its
   name, and its words (a note, an answer's option); never the inbox's internal kind */
const WAIT_NOUN = { 'task-note': 'A note', 'track-note': 'A note', 'decision-create': 'A ruling' };
const WAIT_VERB = { drop: 'Dropped', snooze: 'Snoozed', wake: 'Woken', 'task-priority': 'Priority changed', 'decision-amend': 'Ruling amended',
  'ws-close': 'Closed', 'plan-close': 'Closed', 'ws-reopen': 'Reopened', 'plan-reopen': 'Reopened', 'ws-create': 'Created', 'plan-create': 'Created', 'task-create': 'Created' };
const OVERRIDE_DONE_WORD = { withdraw: 'withdrawn', fix: 'fixed', scrub: 'scrubbed' };
function waitWhat(r) {
  if (WAIT_NOUN[r.kind]) return { what: WAIT_NOUN[r.kind], noun: true };
  if (r.kind === 'answer') return { what: r.amended ? 'Answer corrected' : 'Answered' };
  if (r.kind === 'override') {
    return { what: r.decided === 'allow' ? 'Override ' + (OVERRIDE_DONE_WORD[r.act] || 'allowed') : r.decided === 'changed' ? 'Override refused, changed since asked'
      : r.decided === 'dropped' ? 'Override closed unanswered' : 'Override kept as written' };
  }
  if (WAIT_VERB[r.kind]) return { what: WAIT_VERB[r.kind] };
  /* an edit the detail names says it in the lead, and its detail says only what else moved */
  const d = flatLine(r.detail);
  const lead = [[/^taken over( by another session)?(, |$)/, 'Taken over'], [/^taken in hand( by another session)?(, |$)/, 'Taken in hand'],
    [/^let go( by another session)?(, |$)/, 'Let go'], [/^status (done|completed)(, |$)/, 'Closed'], [/^status dropped(, |$)/, 'Dropped']].find(([re]) => re.test(d));
  if (lead) return { what: lead[1], rest: d.replace(lead[0], '') };
  return { what: /-edit$/.test(String(r.kind)) ? 'Edited' : 'Updated' };
}
function waitItem(e, options, here) {
  const r = (e && e.raw) || {};
  if (!r.kind) return { text: flatLine(e.line), detail: '' };
  const { what, noun, rest } = waitWhat(r);
  const record = r.kind === 'override' ? 'override #' + flatLine(r.request || r.id) : [flatLine(r.id), flatLine(r.name)].filter(Boolean).join(' ');
  const o = r.kind === 'answer' && r.pick ? (Array.isArray(options[r.id]) ? options[r.id] : []).find((x) => x && x.type === r.pick) : null;
  const said = r.kind === 'answer' ? [r.pick ? tokenOf(r.id, r.pick) + (o && o.option ? ', ' + flatLine(o.option) : '') : '', r.note ? 'Why: ' + flatLine(r.note) : ''].filter(Boolean).join('. ')
    : r.kind === 'override' ? (Array.isArray(r.records) ? r.records.map(flatLine).join(', ') : '')
      : r.kind === 'task-priority' ? (r.detail ? 'now ' + flatLine(r.detail) : '') : rest !== undefined ? rest : flatLine(r.note || r.detail);
  return { text: what + ' ' + senderWords(r, here, noun) + (record ? ': ' + record : ''), detail: said ? tipText(said) : '' };
}

/* "Q106 store shape: 106b, many files" as a toast; it wakes nothing. */
export const answerToast = (line) => 'Answered elsewhere: ' + line + '.';

const waitWord = (w) => (w.answers ? 'answer' : 'update') + (w.n === 1 ? '' : 's');
export const waitingLabel = (w) => w.n + ' ' + waitWord(w) + ' waiting';
/* the row's words, one item's own or several's count */
export const waitingRow = (w) => (w.n === 1 && Array.isArray(w.items) && w.items[0] ? w.items[0].text : waitingLabel(w));
/* the press says what it does: it starts a turn with what waits */
export const submitLabel = (w) => 'Start a turn with ' + (w.n === 1 ? 'it' : 'all ' + w.n);
export const submitTip = (w) => 'Press to start a turn that hands ' + (w.n === 1 ? 'it' : 'these ' + w.n) + ' to this session now; without a press '
  + (w.n === 1 ? 'it goes' : 'they go') + ' with your next message. Nothing starts a turn by itself.';

/* The band's waiting row and frozen mark on its model; the waiting row keeps the band drawn. */
const EMPTY_BAND = { questions: [], more: 0, total: 0, blocking: 0, waiting: 0 };
/* saved: the closed line is a receipt, which draws even where the pressed row has gone;
   queued: the user's answers queued on this PC until Send */
export function withWaiting(model, { inbox, closed, saved, queued, queuedList } = {}) {
  const has = !!inbox && inbox.n > 0;
  const q = Number.isInteger(queued) && queued > 0 ? queued : 0;
  if (!model && !has && !q) return model;
  /* the queued answers themselves, so the queued card names each on any Answer presses setting */
  return { ...(model || EMPTY_BAND), inbox: has ? inbox : null, closed: closed || '', saved: !!saved, queued: q, ...(q && Array.isArray(queuedList) ? { queuedList } : {}) };
}

/* the band's and every open strip's count beside Send */
export const queuedLabel = (n) => n + (n === 1 ? ' answer queued' : ' answers queued');
export const SEND_TIP = 'Press Send to record them on the board and hand each to the session that asked; until then they stay on this PC';

/* the band's queued chip's card: each queued answer by its question and pick, then what Send does */
export function queuedCard(list, n) {
  const k = n || list.length;
  return {
    head: { icon: 'ldAsk', title: queuedLabel(k), state: { text: 'not sent', tone: 'amber' } },
    groups: [list.map((a) => tipRow(leadIcon('ldAsk'), [a.id + (a.name ? ' ' + flatLine(a.name) : '')],
      [quiet('Queued '), tokenOf(a.id, a.letter) + (a.option ? ', ' + flatLine(a.option) : '')])), [tipRow(leadIcon('ldDone'), [quiet(SEND_TIP)])]].filter((g) => g.length),
  };
}

/* what the band's one needs line had no room for, on the AskerDo mark's card */
export function bandDropFacts(d) {
  const out = [];
  const home = quiet(': on Home, past the band\'s width');
  if (d && d.inbox) out.push(tipRow(leadIcon('ldHandoff'), [waitingLabel(d.inbox), home]));
  if (d && d.queued) out.push(tipRow(leadIcon('ldAsk', 'amber'), [queuedLabel(d.queued), home]));
  if (d && d.offline) out.push(tipRow(leadIcon('monitor', 'amber'), ['Board offline', home]));
  return out;
}

/* a card's line where the band left rows out under the page's bounds, saying how many and where they show */
export const cutFact = (words) => tipRow(leadIcon('ldNote'), [quiet(words)]);

/* Keys already delivered, newest last, bounded so the record stays small. */
export const DELIVERED_MAX = 300;
export function rememberKeys(kept, keys) {
  const out = (Array.isArray(kept) ? kept : []).filter((k) => !keys.includes(k)).concat(keys);
  return out.slice(-DELIVERED_MAX);
}

/* ---- the depth meter and the agent guard ----------- */

const kTok = (n) => Math.floor(n / 1000) + 'k';

/* the handoff window and the insistence; nothing is shown or said below the
 * first. The two percents come from the resolved profiles (main.window, main.wrap). */
export function marksFor(main, docs) {
  const n = nameOf();
  const w = main && Number.isInteger(main.window) && main.window > 0 && main.window < 100 ? main.window : 30;
  const x = main && Number.isInteger(main.wrap) && main.wrap > w && main.wrap < 100 ? main.wrap : Math.max(40, w + 1);
  /* the states and where each hands off, read once at the mark like the quick reference */
  const doc = (docs ? String(docs).replace(/[\\/]*$/, '/') : 'AskerDo\'s docs/') + 'handoff-timing.md';
  return [
    { kind: 'window', percent: w, note: capFirst(n) + '\'s ' + w + ' percent mark: pick the handoff boundary; running work continues. '
      + 'A handoff lands at a point it does not cut through: nothing the next session would have to piece back together, and nothing whose result would come back to this session after it is gone. '
      + 'From here finish what is in flight, start nothing that cannot finish by ' + x + ' percent, and hand off at the first such point; while ' + n + ' is actively engaged (a conversation, a sitting, a live look), never pick the point alone: finish with them, or ask where to break. '
      + 'Tell ' + n + ' in one line in your next reply that the window is reached and where you mean to break. '
      + 'Read ' + doc + ' once now: where each state hands off. ' + STOP_FIRST + ' '
      + 'Write the handoff\'s whereWeWere in your own words: ' + n + '\'s last exchange in their words, what was mid-thought, what was tried and dropped, rulings and preferences from this sitting never registered. handoff_write' + loadFirst('handoff_write') + ' writes it on the track this session holds; with none held, name a workstream (workstream: WS-n) and it starts a track there named from the focus.' },
    { kind: 'wrap', percent: x, note: capFirst(n) + '\'s ' + x + ' percent wrap line: start nothing new and finish what is in flight, an active conversation or sitting with ' + n + ' counting as in flight; then write the handoff. '
      + 'Nothing forces a cut but ' + n + '\'s word (/askerdo handoff, park). ' + STOP_FIRST },
  ];
}
export const MAIN_MARKS = marksFor(null);

/* A reading from $.session.usage().context or session.measure; none until the
 * window has reported a fill. */
export function depthReading(context) {
  const c = context && typeof context === 'object' ? context : null;
  if (!c || typeof c.percent !== 'number' || !Number.isFinite(c.percent)) return null;
  return {
    percent: c.percent, tokens: typeof c.tokens === 'number' ? c.tokens : undefined,
    window: typeof c.window === 'number' ? c.window : undefined,
  };
}

/* An agent's context at a step: the request's input, cache read and cache written. */
export function agentTokens(u) {
  if (!u || typeof u !== 'object') return 0;
  let t = 0;
  for (const k of ['input_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens']) if (typeof u[k] === 'number') t += u[k];
  return t;
}

/* A main-loop step's own usage over the last known window. */
export function readingFrom(usage, window) {
  const tokens = agentTokens(usage);
  if (!tokens || !(window > 0)) return null;
  return { percent: (tokens / window) * 100, tokens, window };
}

/* The band's chip glyphs: one cell each, East Asian Width
 * Neutral and never emoji, so a terminal paints none double. A swap is one line. */
export const GLYPHS = Object.freeze({
  guard: '⯂', /* TURNED BLACK PENTAGON, a shield */
  pending: '◌', /* DOTTED CIRCLE, an answer chip whose CLI is running */
  done: '✓', /* CHECK MARK */
  failed: '✗', /* BALLOT X */
});

const spanText = (ms) => {
  const m = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(m / 60), d = Math.floor(h / 24);
  return d ? d + 'd ' + (h % 24) + 'h' : h ? h + 'h ' + (m % 60) + 'm' : m + 'm';
};
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const two = (n) => String(n).padStart(2, '0');

function resetText(iso, now) {
  const at = Date.parse(iso || '');
  if (!Number.isFinite(at)) return '';
  const d = new Date(at);
  return '; resets ' + DAYS[d.getDay()] + ' ' + two(d.getHours()) + ':' + two(d.getMinutes())
    + (Number.isFinite(now) && at > now ? ', in ' + spanText(at - now) : '');
}

/* the whole percent the ring, the notes and the depth tool say, floored (a mark at 13 is
 * not crossed at 12.8); tokens over the window when both are known, as a step's reading is. */
export function wholePercent(r) {
  if (!r) return 0;
  if (r.tokens > 0 && r.window > 0) return Math.floor((r.tokens * 100) / r.window);
  return Math.floor(r.percent);
}

/* a mark is told by its kind, whatever its percent now; a saved number (before) by its percent. */
export const markTold = (m, told) => Array.isArray(told) && (told.includes(m.kind) || told.includes(m.percent));

/* The marks a reading has passed that were not yet told, lowest first. */
export function marksCrossed(r, told, marks = MAIN_MARKS) {
  if (!r) return [];
  const p = wholePercent(r);
  return marks.filter((m) => p >= m.percent && !markTold(m, told));
}

/* What the main session's depth note tells the model, on percent marks. */
export function mainDepthNote(r, won, track, running = '') {
  const top = won[won.length - 1];
  const size = r.tokens ? kTok(r.tokens) + ' tokens (' + r.tokens + '), ' : '';
  let text = 'CONTEXT DEPTH (main session): ' + size + wholePercent(r) + ' percent of the '
    + (r.window ? kTok(r.window) + ' ' : '') + 'window, as the engine measures it. '
    /* what runs comes first, so the write is never the easy next step */
    + (running ? 'Running now: ' + running + '. Let each land and check what it left before the handoff; the write stores nothing and gives no resume block until they have. ' : '')
    + top.note.replace(/[.\s]+$/, '') + '.';
  /* a jump past both marks still carries the lower marks' rule and doc pointer */
  if (won.length > 1) text += ' Also first crossed now: ' + won.slice(0, -1).map((m) => m.note.replace(STOP_FIRST + ' ', '').replace(/[.\s]+$/, '')).join('. ') + '.';
  /* the note names the track the handoff goes on */
  if (track) text += ' This session holds ' + track + '; its handoff goes there.';
  return text;
}

/* The meter's settings from scripts/depth-marker.mjs: on at 30 and 40 unless a profile says otherwise. */
export function mainOf(j) {
  const m = j && typeof j === 'object' && j.main && typeof j.main === 'object' ? j.main : {};
  const [w, x] = marksFor(m);
  /* the profile that set them, for the depth tool ("deep-code on WS-3") */
  const src = j && typeof j === 'object' && j.sources && typeof j.sources === 'object' ? j.sources : {};
  const profile = ['main.window', 'main.wrap', 'main.on'].map((k) => src[k]).find(isText);
  return { on: m.on !== false, window: w.percent, wrap: x.percent, ...(profile ? { profile } : {}) };
}

/* the depth tool's answer, the reading as the band shows it and the session's two marks. */
export function depthText({ reading, main, told } = {}) {
  const [w, x] = marksFor(main);
  const from = main && main.profile ? 'set by the profile ' + main.profile : 'AskerDo\'s defaults; no profile sets them';
  const mark = (m, what) => what + ' at ' + m.percent + ' percent (' + (markTold(m, told) ? 'told this session' : 'not told yet') + ')';
  const marks = main && main.on === false ? 'The handoff marks are off (' + from + ').'
    : 'Marks: ' + mark(w, 'the handoff window') + ', ' + mark(x, 'the wrap line') + '; ' + from + '.';
  if (!reading || typeof reading.percent !== 'number') return 'No depth reading yet: the engine has not measured this session\'s context. ' + marks;
  const size = reading.tokens ? reading.tokens + ' tokens' + (reading.window ? ' of the ' + kTok(reading.window) + ' window' : '') : reading.window ? 'of the ' + kTok(reading.window) + ' window' : '';
  return 'Context: ' + wholePercent(reading) + ' percent' + (size ? ' (' + size + ')' : '') + ', as the band\'s C ring shows it. ' + marks;
}

/* before the first depth note a call without why gets no number, and one with why the percent alone */
export const DEPTH_FIRST = 'No number, on purpose. The mod sends you a note when your context is deep enough to start thinking about a handoff, and it has not sent one yet. '
  + 'Until it does, there is no need to pace or plan your work by context: carry on with the next step. '
  + 'If you do need the number (the user asked, you are writing a handoff, or another real reason), call depth again with `why` set to a few words saying what for.';
/* the context figure is the session's to read: marks off (no note will ever come), or a note told */
export const depthOpen = (main, told) => (main && main.on === false) || (Array.isArray(told) && told.length > 0);
export function depthAnswer({ reading, main, told, why } = {}) {
  if (depthOpen(main, told)) return depthText({ reading, main, told });
  if (!isText(why) || !why.trim()) return DEPTH_FIRST;
  if (!reading || typeof reading.percent !== 'number') return 'No depth reading yet: the engine has not measured this session\'s context.';
  return 'Context: ' + wholePercent(reading) + ' percent.';
}

/* ---- the drawn tool: what each part last drew, from the model its draw used ---- */

export const DRAWN_PARTS = ['pane', 'band', 'status'];
export const DRAWN_MAX = 120;
const DRAWN_NAMES = { pane: 'The AskerDo pane', band: 'The band', status: 'The status row' };
const DRAWN_ROWS = 12;
const FITTED = '(Rows as the mod fitted them to the room they drew in; where the app\'s font breaks a line is not known here.)';
const drawnClock = (t) => { const d = new Date(t); return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':'); };
const drawnHead = (name, d, now) => name + ': drawn ' + runTime(Math.max(0, now - d.at)) + ' before this read (' + drawnClock(d.at) + '), for '
  + (Number.isFinite(d.cols) ? d.cols + ' columns' : 'no column count') + ' on the ' + (d.surface || 'unknown') + ' surface.';
const listed = (rows, line, more) => [...rows.slice(0, DRAWN_ROWS).map(line), ...(rows.length > DRAWN_ROWS ? ['  (' + (rows.length - DRAWN_ROWS) + ' more ' + more + ')'] : [])];

/* drawn: each part's last draw as its draw handed it over; depth: the context figure may be shown
   (depthOpen); the text is cut at max lines, saying what it left out */
export function drawnText({ drawn = {}, part, now = Date.now(), depth = false, max = DRAWN_MAX } = {}) {
  const lines = [];
  for (const p of DRAWN_PARTS.includes(part) ? [part] : DRAWN_PARTS) {
    const d = drawn[p];
    if (lines.length) lines.push('');
    if (!d || !Number.isFinite(d.at)) { lines.push(DRAWN_NAMES[p] + ': not drawn in this session yet.'); continue; }
    lines.push(...(p === 'pane' ? drawnPane(d, now) : p === 'band' ? drawnBand(d, now) : drawnStatus(d, now, depth)));
  }
  if (lines.length <= max) return lines.join('\n');
  return [...lines.slice(0, max - 1), '(' + (lines.length - max + 1) + ' more lines left out; ask for one part: ' + DRAWN_PARTS.join(', ') + ')'].join('\n');
}

function drawnStatus(d, now, depth) {
  const out = [drawnHead(DRAWN_NAMES.status + (d.site === 'band' ? ' (the band\'s last row)' : ' (under the prompt)'), d, now)];
  const m = d.m;
  if (!m || !Array.isArray(m.segments)) return [...out, '- nothing drawn on it'];
  const desk = d.surface === 'desktop';
  const all = (desk ? [m.mark, ...m.segments] : m.segments.filter((s) => !s.empty)).filter(Boolean);
  /* the segments the row had room for, read from the keys the drawing holds */
  const keys = Array.isArray(d.keys) ? new Set(d.keys) : null;
  for (const s of all) {
    const gone = keys && !keys.has(s.key) ? ' (no room at this width)' : '';
    if (s.key === 'context' && !depth) {
      /* before the marker the segment is named with no word on why its figure is absent */
      out.push('- context: drawn' + gone);
      continue;
    }
    /* the agents card's rows as the draw fitted them to the card's width (d.fit) */
    const rows = s.card && Array.isArray(s.card.rows) && s.card.rows.length && typeof d.fit === 'function' ? s.card.rows : null;
    const tip = rows && s.tip ? s.tip.replace(rowsText(rows), rowsText(rows.map(d.fit))) + ' ' + FITTED : s.tip;
    const face = s.key === 'mark' ? 'the AskerDo mark' + (s.pic && (s.pic.blocking || s.pic.waiting) ? ', ' + (s.pic.blocking || 0) + ' blocking and ' + (s.pic.waiting || 0) + ' waiting elsewhere' : '')
      : flatLine(s.text) || (s.pic && s.pic.label ? flatLine(s.pic.label) : '') || (s.empty ? 'drawn empty' : '');
    out.push('- ' + s.key + ': ' + face + gone + (s.key === 'context' || s.key === 'mark' || !tip ? '' : '; its card: ' + flatLine(tip)));
  }
  return out;
}

function drawnBand(d, now) {
  const out = [drawnHead(DRAWN_NAMES.band, d, now) + (Array.isArray(d.parts) ? ' Rows: ' + (d.parts.length ? d.parts.join(', ') : 'none') + '.' : '')];
  out.push(...sizedLines(d));
  const m = d.model;
  if (!m) return [...out, d.loading ? '- the board was not loaded yet' : '- nothing open or waiting'];
  out.push(...bandLines(m));
  const drops = d.drops || {};
  const gone = [drops.inbox ? 'the waiting updates' : '', drops.queued ? drops.queued + ' queued answers' : '', drops.offline ? 'the offline chip' : ''].filter(Boolean);
  if (gone.length) out.push('- past the needs line\'s width (on the mark\'s card): ' + gone.join(', '));
  return out;
}
/* the band's questions and calls, as the band and Home's copy draw them */
function bandLines(m) {
  const out = [];
  const qs = Array.isArray(m.questions) ? m.questions : [];
  /* a read whose questions were not a list draws its count with "not read" and lists none */
  const unread = m.unreadQuestions === true ? ', ' + UNREAD_SHORT + ': ' + UNREAD_WORDS : '';
  if (qs.length || m.more || unread) out.push('- questions: ' + (m.total || qs.length) + (m.blocking ? ', ' + m.blocking + ' blocking' : '') + unread);
  out.push(...listed(qs, (q) => '  - ' + q.id + (q.blocking ? ' (blocking)' : '') + ': ' + flatLine(q.name), 'questions'));
  if (m.more) out.push('  (' + m.more + ' more past the band\'s rows)');
  const calls = Array.isArray(m.calls) ? m.calls : [];
  out.push(...listed(calls, (c) => '- call (' + c.kind + '): ' + flatLine(c.short || c.text), 'calls'));
  if (m.waiting) out.push('- shelf: ' + m.waiting + ' tracks waiting');
  if (m.queued) out.push('- queued answers: ' + m.queued);
  if (m.offline) out.push('- board offline');
  return out;
}

/* a running row's time as its live line draws it at the read: the model's, carried on to now */
function flightRows(fm, d, now, open, doneOpen, which) {
  /* d.fit: the draw's own fitting of the rows for its columns, so the text gives what it drew */
  const given = Array.isArray(fm.rows) ? fm.rows : [];
  const rows = typeof d.fit === 'function' ? d.fit(given, which) : given;
  const late = d.m && d.m.liveRows && Number.isFinite(d.m.now) ? Math.max(0, now - d.m.now) : 0;
  const line = (r) => {
    const detail = !r.done && late && r.ran !== null && Number.isFinite(r.ran) ? flatLine(r.detail).replace(runTime(r.ran), runTime(r.ran + late)) : flatLine(r.detail);
    return '  - ' + ' '.repeat(2 * (Number(r.under) || 0)) + flatLine(r.job) + ': ' + detail;
  };
  if (!open) return ['  (shut: ' + rows.length + ' rows not drawn)'];
  const running = rows.filter((r) => !r.done), done = rows.filter((r) => r.done);
  return [...listed(running, line, 'rows'), ...(done.length ? [doneOpen ? '  done (open):' : '  done (shut): ' + done.length, ...(doneOpen ? listed(done, line, 'rows') : [])] : [])];
}

/* what gave way so the drawing stays whole, and its counts as the page counts them */
function sizedLines(d) {
  const out = [];
  if (Array.isArray(d.gave) && d.gave.length) out.push('- left out so the drawing stays whole: ' + d.gave.join('; '));
  if (d.counts) out.push('- drawing: ' + d.counts.nodes + ' nodes, ' + d.counts.depth + ' levels, ' + d.counts.chars + ' characters, ' + (d.counts.text || 0) + ' of text'
    + (d.counts.from ? ' (' + d.counts.from.nodes + ' nodes, ' + d.counts.from.chars + ' characters and ' + (d.counts.from.text || 0) + ' of text before it gave way)' : '')
    + (d.counts.builds ? ', built ' + d.counts.builds + (d.counts.builds === 1 ? ' time' : ' times') + ' to fit' : ''));
  return out;
}

function drawnPane(d, now) {
  const m = d.m || {};
  const out = [drawnHead(DRAWN_NAMES.pane + ', ' + (m.tab || 'home') + ' tab', d, now)];
  if (m.loading) return [...out, '- still loading the board'];
  out.push(...sizedLines(d));
  if (m.counts) out.push('- tab badges: Questions ' + (m.counts.questions || 0) + ', Tracks ' + (m.counts.tracks || 0));
  const f = d.folds || {};
  if (m.tab === 'questions') {
    const cards = (m.qm && Array.isArray(m.qm.cards)) ? m.qm.cards : [];
    out.push('- cards: ' + cards.length + (m.qm && m.qm.more ? ', ' + m.qm.more + ' more' : ''));
    out.push(...listed(cards, (c) => '  - ' + c.id + (c.blocking ? ' (blocking)' : '') + ': ' + flatLine(c.name), 'cards'));
    return out;
  }
  if (m.tab === 'tracks') {
    const tm = m.tm || {}, tv = m.tview || {};
    if (tm.held) out.push('- held: ' + tm.held.id + ' ' + flatLine(tm.held.name));
    for (const k of ['pickup', 'elsewhere', 'parked']) {
      const list = Array.isArray(tm[k]) ? tm[k] : [];
      if (!list.length) continue;
      out.push('- ' + k + ' (' + (tv[k] ? 'open' : 'shut') + '): ' + list.length);
      if (tv[k]) out.push(...listed(list, (t) => '  - ' + t.id + ' ' + flatLine(t.name), 'tracks'));
    }
    if (tm.offline) out.push('- ' + flatLine(tm.offline));
    return out;
  }
  if (m.tab === 'guide') return [...out, '- the guide: ' + ((m.guide && Array.isArray(m.guide.pages)) ? m.guide.pages.length + ' pages' : flatLine(m.guide && m.guide.error) || 'no pages')];
  if (m.tab === 'settings') return [...out, '- settings' + (m.settings && m.settings.error ? ': ' + flatLine(m.settings.error) : '')];
  /* the warning Home draws when the band read's questions were not a list */
  if (m.b && m.b.model && m.b.model.unreadQuestions === true) out.push('Home\'s warning: the questions could not be read from the board\'s answer, so none are drawn.');
  if (m.b && m.b.model) out.push('Needs you (the band\'s copy):', ...bandLines(m.b.model));
  if (m.sm) out.push('The status row\'s copy: as the status part reads it.');
  if ((m.am || m.bm) && typeof d.fit === 'function') out.push(FITTED);
  if (m.am) out.push('Agents (' + (f.agents ? 'open' : 'shut') + '): ' + flatLine(m.am.timed || m.am.summary), ...flightRows(m.am, d, now, f.agents, f.agentsDone, 'agents'));
  if (m.bm) out.push('Background (' + (f.background ? 'open' : 'shut') + '): ' + flatLine(m.bm.summary), ...flightRows(m.bm, d, now, f.background, f.bgDone, 'background'));
  if (m.line) out.push('Picture: ' + flatLine(m.line) + (m.graphOpen ? '' : ' (shut)'));
  const feed = (Array.isArray(m.rows) ? m.rows : []).filter((r) => r && !r.heading);
  if (feed.length) out.push('Feed: ' + feed.length + ' rows', ...listed(feed, (r) => '  - ' + r.time + ' ' + r.id + (r.name ? ' ' + r.name : '') + ': ' + flatLine(r.act), 'rows'));
  return out;
}

/* The guard's state from scripts/depth-marker.mjs: off unless a profile turns it on. */
export function guardOf(j) {
  const main = mainOf(j);
  /* a board the marker could not read rides along to the band */
  const problem = j && typeof j === 'object' && isText(j.problem) ? { problem: flatLine(j.problem) } : {};
  if (!j || typeof j !== 'object' || !j.on) return { on: false, main, ...problem };
  const g = j.guard || {};
  const num = (v, d) => (typeof v === 'number' && v > 0 ? Math.floor(v) : d);
  return {
    on: true, source: j.source || '', soft: num(g.soft, DEPTH_MARKER.soft), hard: num(g.hard, DEPTH_MARKER.hard),
    remind: num(g.remind, DEPTH_MARKER.remind), hardDeny: g.hardDeny === true, main, ...problem,
  };
}

const guardSource = (src) => (src && typeof src === 'object' && src.profile ? src.profile
  : { project: 'this project', track: 'this track', thread: 'this thread', default: 'your default profile' }[src && typeof src === 'object' ? src.level : src]
    || 'the marker');

/* the band's shield chip, dim off and colored on, always drawn; its card
 * says the state and what a press does; a board it could not read says so instead. */
export function guardChip(g) {
  if (!g) return null;
  const state = 'Agent guard ' + (g.on ? 'on' : 'off');
  const tip = g.problem ? (state + ' from the marker as it was: ' + g.problem).slice(0, 200) + '; the board could not be read'
    : g.on ? state + ', soft ' + kTok(g.soft) + ' hard ' + kTok(g.hard) + ' from ' + guardSource(g.source) + '; press to turn off'
      : state + '; press to turn on';
  return { key: 'guard', label: GLYPHS.guard, tip, ...(g.problem ? { color: 'warning' } : g.on ? { color: 'success' } : { dim: true }) };
}

/* Where the guard's on came from: the level, or the profile and record. */
function guardFrom(src) {
  const level = src && typeof src === 'object' ? src.level : src;
  if (level === 'project') return 'for this project';
  if (level === 'track') return 'for this track';
  if (level === 'thread') return 'for this thread';
  if (level === 'default') return 'everywhere (your default profile ' + src.profile + ')';
  if (src && typeof src === 'object' && src.profile) return 'through ' + src.profile + ' on ' + src.record;
  return 'here';
}
export function guardText(g) {
  if (g && g.problem) {
    return 'The board could not be read, so the markers stay as they were and the agent guard is '
      + (g.on ? 'on' : 'off') + ' from them: ' + g.problem + '. Once the board answers, /askerdo guard on or off works again.';
  }
  if (!g || !g.on) return 'The agent guard is off for this project. Turn it on with /askerdo guard on.';
  return 'The agent guard is on ' + guardFrom(g.source) + ': subagents hear a hand-off note past '
    + kTok(g.soft) + ' and an urgent one past ' + kTok(g.hard) + (g.hardDeny ? ', where only the state note and the report\'s hand-back pass' : '') + '.';
}

/* The agent guard's stamp rule: the first past soft, then every `remind`;
 * the first past hard always. */
export function agentStage(tokens, g, last = 0) {
  if (!g || !g.on || !(tokens >= g.soft)) return null;
  const pastHard = tokens >= g.hard;
  if (last && !(pastHard && last < g.hard) && tokens - last < g.remind) return null;
  return pastHard ? 'hard' : 'soft';
}

const HANDOFF_ENDING = 'Then end your final response with this as its very last line, in plain text: '
  + 'CONTINUE: <your state note path> (the real full path of your note in place of the angle brackets). '
  + 'That line takes the place of any verdict line your brief asks for: a fresh agent on the same brief '
  + 'resumes from your note (outside a workflow, the line reports to your orchestrator, which dispatches '
  + 'that agent).';

const WHY = '. Why: the quality of work drops well before a context window fills, so ';
const noteHint = (note) => (note ? ' The state note you have been writing is ' + note + '.' : '');

export function agentNote(stage, { tokens, guard, note }) {
  const k = kTok(tokens);
  if (stage === 'hard') {
    return 'URGENT: CONTEXT DEPTH ' + k + ' tokens, past the hard floor of ' + kTok(guard.hard) + WHY
      + 'a fresh agent continues this job from your state note and the files on disk. Wrap up at your next clean '
      + 'point: finish only the edit in hand, so every file you touched parses, and open nothing new '
      + '(no new step, task, command or agent). Work already running in the background (a command, '
      + 'a build, another agent) keeps running: name it in your note so the next agent checks on it. '
      + 'Write your state note to the path your contract names (a file whose name ends in -state.md): '
      + 'what is done (commits, files, results), the exact next step, and the open points.' + noteHint(note) + ' '
      + HANDOFF_ENDING;
  }
  return 'CONTEXT DEPTH ' + k + ' tokens, past the soft limit of ' + kTok(guard.soft) + WHY
    + 'the rest of this job goes to a fresh agent that resumes from your state note and the files on disk; your part now '
    + 'is a clean hand-off. Finish the step you are on, leaving nothing half-edited and files that '
    + 'parse, and open no new step. Work already running in the background (a command, a build, '
    + 'another agent) keeps running: name it in your note so the next agent checks on it. You have '
    + 'about ' + kTok(Math.max(0, guard.hard - tokens)) + ' tokens before the hard floor at ' + kTok(guard.hard)
    + (guard.hardDeny ? ', after which only the state note and the report\'s hand-back pass. ' : ', after which this reminder turns urgent. ')
    + 'Write your state note to the path your contract names (a file whose name ends '
    + 'in -state.md): what is done (commits, files, results), the exact next step, and the open '
    + 'points.' + noteHint(note) + ' ' + HANDOFF_ENDING + ' Only if finishing this step completes the whole job, end as '
    + 'your brief says instead.';
}

export function agentDenyReason({ tokens, guard, note }) {
  return 'CONTEXT DEPTH ' + kTok(tokens) + ' tokens, past the hard floor of ' + kTok(guard.hard) + WHY
    + 'a fresh agent continues this job from your state note and the files on disk. Only a Write or Edit to your '
    + 'state note (a file whose name ends in -state.md, at the path your contract names) and a SubagentHandback call with your report pass now. '
    + 'Write it: what is done (commits, files, results), the exact next step, and the open points, '
    + 'naming anything you started that is still running in the background (it keeps running).' + noteHint(note) + ' '
    + HANDOFF_ENDING;
}

const isStateNotePath = (p) => typeof p === 'string' && p.replace(/\\/g, '/').toLowerCase().endsWith('-state.md');

export function isStateNoteCall(tool, input) {
  if (tool !== 'Write' && tool !== 'Edit') return false;
  return isStateNotePath(input && input.file_path);
}

/* The last state note an agent wrote, from $.session.messages({ agentId }). */
export function stateNoteFrom(messages) {
  let found = '';
  for (const m of Array.isArray(messages) ? messages : []) {
    for (const u of (m && Array.isArray(m.toolUses) ? m.toolUses : [])) {
      if (u && isStateNoteCall(u.tool, u.input)) found = u.input.file_path;
    }
  }
  return found;
}

/* each pressed chip's state ({ 'Q106|b': { state, error } }) onto its answer. */
export function withChipStates(model, states) {
  if (!model || !Array.isArray(model.questions) || !states || !Object.keys(states).length) return model;
  return { ...model, questions: model.questions.map((q) => ({
    ...q, answers: (q.answers || []).map((a) => (states[q.id + '|' + a.letter] ? { ...a, ...states[q.id + '|' + a.letter] } : a)),
  })) };
}

/* the question each press is answering, `{ Q106: { letter, state } }`, saving or done. */
export function answeringOf(states) {
  const out = {};
  for (const [k, v] of Object.entries(states || {})) {
    if (!v || (v.state !== 'pending' && v.state !== 'done')) continue;
    const at = k.lastIndexOf('|');
    out[k.slice(0, at)] = { letter: k.slice(at + 1), state: v.state };
  }
  return out;
}

/* a closed session's band stays as last drawn and says why, in a
 * few dim words on its row. Once a press on it saved, the receipt takes the
 * freeze words' place, so the press shows it landed. */
export const closedLine = (as, saved = []) => (!as ? ''
  : saved.length ? as + ': Saved ' + saved.join(', ') + '. The next session picks this up.' : as + ': band frozen');

/* ---- the handoff gate ---------------------------------------------------- */

/* a handoff has two triggers, the mod's depth note and the user's ask.
 * No reading yet counts as below the window. */
export function pastWindow({ percent, main, told }) {
  return (Array.isArray(told) && told.length > 0) || (typeof percent === 'number' && percent >= marksFor(main)[0].percent);
}
export function handoffGate({ percent, main, told, asked }) {
  const n = nameOf();
  if (asked || pastWindow({ percent, main, told })) return { open: true };
  return { open: false, deny: 'handoff_write refused: the mod\'s depth note has not called for a handoff, and ' + n + ' did not ask for one. A step that waits on ' + n + ' is asked here and run here. '
    + 'When ' + n + ' asked for one in chat, call again with askedInChat: ' + n + "'s words, quoted; "
    + n + ' also opens one with /askerdo handoff (or /askerdo park).' };
}

/* what a handoff write removed and left undecided; `write`: the write's own result, which asks. */
export function handoffFilesNote(r, write = false) {
  const u = r && Array.isArray(r.undecided) ? r.undecided : [];
  /* the repo's worktrees and merged branches still due */
  const wt = r && Array.isArray(r.worktreeLines) ? r.worktreeLines.map(flatLine) : [];
  const lines = [removedLine(r && r.removed), u.length ? 'Left undecided (no disposition given): ' + u.map((x) => flatLine(x.path)).join(', ') + '.' : '', dueFilesLine(r && r.dueFiles), ...wt];
  return [...lines, write ? leftAskLine(r) : ''].filter(Boolean).join('\n');
}

/* what the write removed itself, the re-check having passed */
export function removedLine(removed) {
  const all = Array.isArray(removed) ? removed : [];
  const rm = all.filter((x) => !x.left);
  const left = (how) => all.filter((x) => x.left === how).map((x) => flatLine(x.path) + (x.why ? ' (' + flatLine(x.why) + ')' : ''));
  const trees = rm.filter((x) => x.path).map((x) => flatLine(x.path) + (x.branch ? ' (branch ' + flatLine(x.branch) + ')' : ''));
  const branches = rm.filter((x) => !x.path && x.branch).map((x) => flatLine(x.branch));
  /* the removal runs after the board write inside the call's time; what it did not finish is named */
  const [running, next, refused] = [left('running'), left('next'), left('refused')];
  /* what a keep held, with the keep's reason */
  const kept = all.filter((x) => x.left === 'kept').map((x) => flatLine(x.path || x.branch) + (x.why ? ' (' + flatLine(x.why) + ')' : ''));
  return [trees.length ? 'Removed, merged and clean: ' + trees.join(', ') + '.' : '', branches.length ? 'Deleted, merged: ' + branches.join(', ') + '.' : '',
    kept.length ? 'Kept, as the handoff says: ' + kept.join(', ') + '.' : '',
    running.length ? 'Still being removed when the call returned, git finishes it on its own: ' + running.join(', ') + '.' : '',
    next.length ? 'Left for the next handoff write to remove (this one ran out of time): ' + next.join(', ') + '.' : '',
    refused.length ? 'Not removed, git refused: ' + refused.join(', ') + '; the next handoff write tries again.' : ''].filter(Boolean).join(' ');
}

/* the handing-off session asks about the rest in this reply; a resume asks nothing */
export function leftAskLine(r) {
  const left = r && ((Array.isArray(r.undecided) && r.undecided.length) || (Array.isArray(r.dueFiles) && r.dueFiles.length) || (Array.isArray(r.worktreeLines) && r.worktreeLines.length));
  if (!left) return '';
  const n = nameOf();
  return 'Ask ' + n + ' about each of these in this reply through the ask tool (one ask per worktree or group, one per file or one for the lot), with the paths and how to check each again in its context;'
    + ' the resume asks nothing. On the answer, check again, remove or keep, and patch this handoff with handoff_update' + loadFirst('handoff_update') + ', its verifyFirst op; whoever holds the track when the answer lands does that and asks nothing again.';
}

/* the loose files a handoff names besides the new ones: proposals and keeps past their review day; the rest carry unasked */
export function dueFilesLine(due) {
  if (!Array.isArray(due) || !due.length) return '';
  return 'Due now, to ask about in this reply: ' + due.map((f) => flatLine(f.path) + ' (' + (f.disposition === 'keep' ? 'kept' + (f.review ? ' to ' + f.review : '') + (f.reason ? ': ' + flatLine(f.reason) : '')
    : 'proposed ' + f.disposition) + ')').join(', ') + '. A path a handoff leaves out carries its disposition; one kept again gets a new review date.';
}

/* a handoff close hands the user the resume command alone, ready to copy;
   a plain fence, since a shell tag would draw a Run button for a prompt command. */
/* a handoff that names the PC its next leg runs on says so on the label */
export const resumeBlock = (thread, pc) => '\u2b07\ufe0f Resume ' + thread + ' in a new session' + (pc ? ' on ' + pc : '') + ':\n```text\n/askerdo resume ' + thread + '\n```';
const resumeFence = (thread) => new RegExp('```[^\\n]*\\r?\\n\\s*/askerdo resume ' + String(thread).replace(/[^\w-]/g, '\\$&') + '[ \\t]*\\r?\\n\\s*```');

/* a handoff the board did not take, whole as handoff_write takes it, for the
   reply to carry; carried() finds its body in a fenced block of the text, spacing aside. */
export const carryBlock = (input) => '```json\n' + JSON.stringify(input, null, 2) + '\n```';
const squeeze = (s) => String(s || '').replace(/\s+/g, '');
export function carried(text, block) {
  const body = squeeze(String(block || '').replace(/^```[^\n]*\n/, '').replace(/\n```$/, ''));
  return !!body && textUnits(String(text || '').split(/\r?\n/)).some((u) => u.kind === 'code' && squeeze(u.text).includes(body));
}

/* a resume's verify-first, one pass or fail line per repo naming the failing check; never a block. */
export function verifyLines(v) {
  if (!v) return [];
  if (v.error) return ['Verify first could not run: ' + flatLine(v.error)];
  const repos = Array.isArray(v.repos) ? v.repos : [];
  if (!repos.length) return ['Verify first: no repos recorded'];
  /* a repo at another path here names both; one this PC lacks is said, never a failure */
  return repos.map((r) => 'Verify first: ' + flatLine(r.path) + (r.absent ? ' is not on this PC, so it was not checked (' + (r.remote ? 'askerdo projects scan <folder> maps ' + flatLine(r.remote) + ' once it is cloned' : 'askerdo projects scan <folder> maps it if it is') + ')'
    : (r.here ? ', here at ' + flatLine(r.here) + ',' : '') + (r.ok ? ' passes' : ' FAILS: ' + (r.problems || []).map(flatLine).join('; '))))
    .concat(v.report ? [flatLine(v.report)] : []);
}

/* the handoff folders' missing steps and budget warnings on one line; flagged, never refused. */
export function handoffCheckLine(checks) {
  const bad = (Array.isArray(checks) ? checks : []).filter((c) => c && ((c.missing || []).length || (c.warnings || []).length));
  if (!bad.length) return '';
  return 'Handoff folder check: ' + bad.map((c) => flatLine(c.workstream) + ' ' + [...(c.missing || []), ...(c.warnings || [])].map(flatLine).join('; ')).join(' | ');
}

/* ---- the first telling and the contract checks ---- */

export const ASK_TOOL = 'mcp__askerdo__ask';

/* The ask tool's registered question as one Questions pane card. This session asked it,
   so its head names the session and the age as the pane's copy does. */
export function firstTellingCard(q, sid, now, local) {
  const m = questionsModel({ questions: q && q.id ? [{ asker: sid, ...q }] : [], sid, now, local });
  return m.cards[0] || null;
}

/* a telling is stale once its question was reworded after the version it showed (a telling
   with none showed the registered wording, version 1); `now` is the question as last read. */
export function rewordedSince(told, now) {
  const r = now && now.reworded;
  return !!(told && r && Number(r.version) > Number(told.version || 1));
}

export const CHANGED_LINE = 'Changed after it was asked; the current version is under a later reply';

/* the first telling's card model, or its one-line changed stub; the told record keeps the
   version it showed and the question's last rewording as read (`reworded`). */
export function changedStub(told) {
  return told && told.id && rewordedSince(told, told) ? { id: told.id, line: CHANGED_LINE } : null;
}

/* the reply drawn without each question's own block. The block opens on its
   header line (tellMarker) and runs through its table, whatever is inside; one that lost its
   header goes line by line by the registered strings. The stored text keeps it whole. */
const PICTO_LEAD = /^\s*(?:[#>*_]+\s*)*\p{Extended_Pictographic}/u;
const normWords = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
function textUnits(lines) {
  const kind = (l) => (/^\s*```/.test(l) ? 'code' : /^\s*\|/.test(l) ? 'table' : /^\s{0,3}#/.test(l) ? 'head' : 'para');
  const out = [];
  for (let i = 0; i < lines.length;) {
    if (!lines[i].trim()) { i++; continue; }
    const k = kind(lines[i]);
    let j = i + 1;
    if (k === 'code') { while (j < lines.length && !/^\s*```/.test(lines[j])) j++; j = Math.min(j + 1, lines.length); }
    else if (k !== 'head') while (j < lines.length && lines[j].trim() && kind(lines[j]) === k) j++;
    out.push({ kind: k, from: i, to: j, text: lines.slice(i, j).join('\n') });
    i = j;
  }
  return out;
}
/* a footer lead ("Needs you: ...") before the block keeps its emoji and label */
const LEAD = /^\s*(?:[#>*_]+\s*)*(?:[\p{Extended_Pictographic}\p{Emoji_Modifier}️‍]+\s*)+(?:\*{0,2}[^?:*\n]{1,40}:\*{0,2}\s*)?/u;
const isRow = (l) => /^\s*\|/.test(l);
const isRule = (l) => /^\s*\|?\s*:?-+/.test(l);
const ANY_MARKER = /❓\s*(?:[*_`]+\s*)?(?:Q|L)\d+(?![0-9a-z])/i;
const markerIn = (l, id) => new RegExp('❓\\s*(?:[*_`]+\\s*)?' + reEscape(id) + '(?![0-9a-z])', 'i').exec(l);
const rowToken = (l, tokens) => {
  const m = /^[^0-9a-z]*(l?\d+[a-z])(?![0-9a-z])/i.exec(String(l).split('|')[1] || '');
  return !!m && tokens.includes(m[1].toLowerCase());
};
const reversalOf = (l, revisits) => {
  const m = /^\s*\*\*\s*Reversal of (Q\d+)[^*]*\*\*\s*$/i.exec(l);
  return !!m && revisits.includes(m[1].toUpperCase());
};
const labelOnly = (l) => !!l && PICTO_LEAD.test(l) && (l.match(LEAD) || [''])[0].trim() === l.trim();
const detok = (ask) => String(ask || '').replace(/\((\s*)(?:l?\d+)([a-z])(?=\s*[,)])/gi, (m, sp, l) => '(' + sp + l);

/* The registered strings' hits: the ask (whole, or a line it contains when wrapped), the crux,
   the token rows with their head and rule, the reversal line. */
function lineHits(lines, q, tokens) {
  const letters = tokens.map((t) => t.slice(-1));
  const base = detok(q.ask);
  const asks = [...new Set([normWords(tellAsk({ ...q, ask: base }, letters)), normWords(base)])].filter(Boolean);
  const crux = normWords(q.crux);
  const revisits = (Array.isArray(q.revisits) ? q.revisits : []).map((r) => String(r).toUpperCase());
  const hit = new Set();
  /* a fenced line is text to copy, never a told question, though it repeats the ask */
  let fenced = false;
  lines.forEach((l, i) => {
    if (/^\s*```/.test(l)) { fenced = !fenced; return; }
    if (fenced) return;
    const n = normWords(l);
    if (!n) return;
    /* a wrapped ask's part, its footer lead and label aside; a short part only with a token */
    const part = normWords(l.replace(LEAD, '').replace(/^[\s*_]*(?:Q|L)\d+[^:\n]{0,80}:[\s*_]*/i, ''));
    const wraps = (a) => !!part && a.includes(part) && (part.length >= 12 || tokens.some((t) => part.includes(t)));
    if (asks.some((a) => n.includes(a) || wraps(a)) || (crux && n.includes(crux))
      || (isRow(l) && rowToken(l, tokens)) || reversalOf(l, revisits)) hit.add(i);
  });
  for (const i of [...hit].filter((i) => isRow(lines[i]) && !hit.has(i - 1))) {
    if (isRule(lines[i - 1] || '')) { hit.add(i - 1); if (isRow(lines[i - 2] || '')) hit.add(i - 2); }
  }
  return hit;
}

/* The hidden lines of one question and where its pointer goes, or null when nothing is found. */
const named = (q) => q.id + (flatLine(q.name) ? ' (' + flatLine(q.name) + ')' : '');
const UNDER = (q) => named(q) + ' is on the card under this reply.';
function toldCut(lines, q, say = UNDER) {
  const tokens = (q && q.id && Array.isArray(q.options) ? q.options : []).filter((o) => o && /^[a-z]$/i.test(o.type))
    .map((o) => token(q.id, o.type).toLowerCase());
  if (!q || !q.id) return null;
  const drop = new Set();
  let at = lines.findIndex((l) => markerIn(l, q.id));
  let lead = '';
  if (at >= 0) {
    lead = lines[at].slice(0, markerIn(lines[at], q.id).index);
    let end = lines.length;
    for (let i = at + 1; i < lines.length; i++) if (ANY_MARKER.test(lines[i])) { end = i; break; }
    let t = at + 1;
    while (t < end && !isRow(lines[t])) t++;
    let last = t;
    while (last + 1 < end && isRow(lines[last + 1])) last++;
    const table = t < end && lines.slice(t, last + 1).some((l) => rowToken(l, tokens));
    /* no table of its own after the header: the header goes, and the rest by the registered strings */
    if (table) for (let i = at; i <= last; i++) drop.add(i);
    else for (const i of [at, ...lineHits(lines, q, tokens)]) drop.add(i);
    let up = at - 1;
    while (up >= 0 && !lines[up].trim()) up--;
    const revisits = (Array.isArray(q.revisits) ? q.revisits : []).map((r) => String(r).toUpperCase());
    if (up >= 0 && reversalOf(lines[up], revisits)) { drop.add(up); at = up; }
  } else {
    for (const i of lineHits(lines, q, tokens)) drop.add(i);
    if (!drop.size) return null;
    at = Math.min(...drop);
    lead = lines[[...drop].sort((a, b) => a - b).find((i) => PICTO_LEAD.test(lines[i])) ?? at];
  }
  const point = say(q);
  let keep = PICTO_LEAD.test(lead) ? lead.match(LEAD)[0].trim() + ' ' + point : '';
  if (!keep) {
    /* the footer label on a line of its own ("## Needs you:") goes too, kept as the pointer's lead */
    let up = at - 1;
    while (up >= 0 && !lines[up].trim()) up--;
    if (up >= 0 && labelOnly(lines[up]) && !drop.has(up)) {
      keep = lines[up].trim() + (/^\s{0,3}#/.test(lines[up]) ? '\n' : ' ') + point;
      drop.add(up);
      at = up;
    } else keep = point;
  }
  return { drop, at, keep };
}

export function hideTold(text, questions, say = UNDER) {
  let out = String(text || '');
  for (const q of questions || []) {
    const lines = out.split('\n');
    if (q && q.override) {
      const b = overrideAt(textUnits(lines), q);
      if (!b) continue;
      const head = lines.slice(0, b.from).join('\n').replace(/\s+$/, '');
      const tail = lines.slice(b.to).join('\n').replace(/^\s*\n/, '');
      out = [head, b.keep, tail].filter((s) => s.trim()).join('\n\n');
      continue;
    }
    const c = toldCut(lines, q, say);
    if (!c) continue;
    const kept = [];
    lines.forEach((l, i) => {
      const s = i === c.at ? c.keep : c.drop.has(i) ? null : l;
      /* runs of blank lines collapse to one, as the block's own spacing goes with it */
      if (s === null || (!s.trim() && (!kept.length || !kept[kept.length - 1].trim()))) return;
      kept.push(s);
    });
    while (kept.length && !kept[kept.length - 1].trim()) kept.pop();
    out = kept.join('\n');
  }
  return out;
}

/* the desktop draws a reply's 🙋 footer, its label line to the end, under the last card, so
   it stays the last thing on screen: the reply without it, and the footer with its told blocks
   folded to one line naming each, on the card(s) above. No 🙋 footer: the whole reply, hidden. */
const FOLD = String.fromCharCode(1);
const FOLDED = new RegExp(FOLD + '([^' + FOLD + ']*)' + FOLD, 'g');
export function tellingParts(text, questions) {
  const lines = String(text || '').split('\n');
  let at = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = FOOTER_LINE.exec(lines[i]);
    if (m) { if (m[1] === HAND) at = i; break; }
  }
  /* a question whose block the footer carries is folded there alone; the body keeps its words */
  const footerText = at < 0 ? '' : lines.slice(at).join('\n');
  const above = (questions || []).filter((q) => !carriesTold(footerText, q));
  const body = at < 0 ? '' : hideTold(lines.slice(0, at).join('\n'), above).replace(/\s+$/, '');
  /* a reply that is all footer keeps it, so the engine has text to draw */
  if (!body.trim()) return { body: hideTold(text, questions), footer: '' };
  const folded = hideTold(lines.slice(at).join('\n'), questions, (q) => FOLD + named(q) + FOLD).split('\n');
  const names = [];
  for (const l of folded) for (const m of l.matchAll(FOLDED)) if (!names.includes(m[1])) names.push(m[1]);
  const said = names.length < 2 ? names.join('') + ' is on the card above.'
    : names.slice(0, -1).join(', ') + ' and ' + names.at(-1) + ' are on the cards above.';
  const out = [];
  let first = true;
  for (const l of folded) {
    if (!l.includes(FOLD)) { out.push(l); continue; }
    const rest = l.replace(FOLDED, () => (first ? (first = false, said) : '')).replace(/\s+$/, '');
    /* a later block's line, left with no words or only its label, goes */
    if (rest.trim() && !labelOnly(rest)) out.push(rest);
  }
  return { body, footer: out.join('\n').replace(/\n{3,}/g, '\n\n').trim() };
}

/* whether a reply tells this question: its block's header line, or an override's block. */
export function carriesTold(text, q) {
  if (!q) return false;
  const lines = String(text || '').split('\n');
  if (q.override) return !!overrideAt(textUnits(lines), q);
  return [q.id, q.was].some((id) => id && lines.some((l) => markerIn(l, id)));
}

/* what engages a session with the board. */
const ID_WORD = /\b(?:Q\d+|T-\d+|P-\d+|WS-\d+|TH-\d+(?:\.\d+)?|TR-\d+(?:\.\d+)?|K-\d+)\b/;
/* an id pasted from the desktop pane carries a word joiner after its hyphen */
export const namesBoardId = (text) => ID_WORD.test(String(text || '').split(JOIN).join(''));
const HUB_LAUNCHERS = /askerdo[\\/]cli\.mjs|bin[\\/]askerdo\.mjs/;
let hubLauncher = HUB_LAUNCHERS;
export const isHubShell = (cmd) => hubLauncher.test(String(cmd || ''));
/* a seam root's own launcher (<root>/cli.mjs) as a command may type it: either slash, a Windows
   root in any case or its Git Bash or WSL form, quoted text as plainQuotes leaves it, the root's variable,
   or a root under a home folder as ~ or the home variable (PowerShell and cmd names in any case) */
function rootLauncher(root, homes = []) {
  const r = String(root || '').trim().replace(/[\\/]+$/, '');
  const drive = /^([A-Za-z]):/.exec(r);
  if (!drive && !/^[\\/]/.test(r)) return '';
  const win = !!drive || r.includes('\\');
  const fold = (w) => [...w].map((c) => /[a-z]/i.test(c) ? '[' + c.toLowerCase() + c.toUpperCase() + ']' : c).join('');
  const ch = (c) => /[\s|&;<>()]/.test(c) ? '[' + c.replace(/[\\\]^-]/g, '\\$&') + '_]'
    : win && /[a-z]/i.test(c) ? fold(c) : c.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
  const segs = (p) => p.split(/[\\/]+/).filter(Boolean).map((s) => '[\\\\/]+' + [...s].map(ch).join('')).join('');
  const d = drive ? fold(drive[1]) : '';
  const head = drive ? '(?:' + d + ':|/' + d + '|/mnt/' + d + ')' : '';
  const edge = '(?<![\\w.~\\\\/-])';
  const same = (p) => (win ? p.toLowerCase() : p).replace(/\\/g, '/');
  const tails = [...new Set(homes.map((h) => String(h || '').trim().replace(/[\\/]+$/, ''))
    .filter((h) => h && same(r).startsWith(same(h) + '/')).map((h) => segs(r.slice(h.length))))];
  const ps = (v) => '\\$\\{?' + fold('env:' + v) + '\\}?|%' + fold(v) + '%';
  const homeVar = edge + '(?:~|\\$HOME|\\$\\{HOME\\}|' + ps('HOME') + '|' + ps('USERPROFILE') + ')';
  const vars = '(?:\\$ASKERDO_ROOT|\\$\\{ASKERDO_ROOT\\}|' + ps('ASKERDO_ROOT') + ')';
  const forms = [edge + head + segs(drive ? r.slice(2) : r), vars, ...tails.map((t) => homeVar + t)];
  return '(?:' + forms.join('|') + ')[\\\\/]+cli\\.mjs(?![\\w.-])';
}
/* the seam root the session runs on, or none, and the home folders a shell's ~ may stand for:
   the mod sees the shell text as typed, never expanded */
export function hubLauncherAt(root, homes) {
  const own = rootLauncher(root, Array.isArray(homes) ? homes : []);
  hubLauncher = own ? new RegExp(HUB_LAUNCHERS.source + '|' + own) : HUB_LAUNCHERS;
  CLI_SEEN = new RegExp(hubLauncher.source, 'g');
}
export const isHubRegister = (cmd) => isHubShell(cmd) && /(?:cli|askerdo)\.mjs["']?\s+register\b/.test(String(cmd || ''));
/* a hub command that asks or decides an override, which an agent never runs */
export const isHubOverride = (cmd) => isHubShell(cmd) && /(?:cli|askerdo)\.mjs["']?\s+override\s+(?:request|decide|unscrub)\b/.test(String(cmd || ''));
/* a CLI segment writes no live board when it asks for --help or names a scratch board (memory:,
   or a literal file: path) by its own prefix or an earlier export or $env:; a write the text cannot place counts */
const SCRATCH_URL = /^(?:memory:|file:(?=[^$`]))[^$`]*$/i;
let CLI_SEEN = new RegExp(HUB_LAUNCHERS.source, 'g');
/* the live-board CLI segments `test` matches; a wrapped one (bash -c, pwsh -Command) comes back as the whole command */
function liveParts(cmd, test) {
  if (!isHubShell(cmd)) return [];
  let scratch = false;
  const parts = plainQuotes(String(cmd).replace(/[\\`]\r?\n/g, ' ')).split(/&&|\|\||[|;&\r\n]/);
  /* a write quoted inside a wrapper shows in no segment, so the text cannot place it */
  if (test(String(cmd)) && !parts.some((p) => isHubShell(p) && test(p))) return [String(cmd)];
  return parts.filter((p) => {
    if (!isHubShell(p)) {
      if (/ASKERDO_BOARD_URL/i.test(p)) {
        const m = /^\s*export\s+(?:\w+=\S*\s+)*ASKERDO_BOARD_URL=(\S*)(?:\s+\w+=\S*)*\s*$/.exec(p) || /^\s*\$env:ASKERDO_BOARD_URL\s*=\s*(\S*)\s*$/i.exec(p);
        scratch = !!m && SCRATCH_URL.test(m[1]);
      }
      return false;
    }
    if (!test(p)) return false;
    if (hubVerb(p).words.includes('--help')) return false;
    if (p.match(CLI_SEEN).length > 1 || /\$\(|`|[<>]\(/.test(p)) return true;
    const pre = /^\s*(?:env\s+)?((?:\w+=\S*\s+)*)(?:\S*[\\/])?node(?:\.exe)?\s+\S*$/.exec(p.slice(0, p.search(CLI_SEEN)));
    /* anything else before node (env -u, env -i) may clear an exported scratch board */
    if (!pre) return true;
    const set = /(?:^|\s)ASKERDO_BOARD_URL=(\S*)/.exec(pre[1]);
    return !(set ? SCRATCH_URL.test(set[1]) : scratch);
  });
}
const hubWrites = (cmd, verbs) => liveParts(cmd, (s) => verbs.test(s)).length > 0;
/* a hub command that writes a task, which an agent never runs; task block and show are reads */
export const isHubTaskWrite = (cmd) => hubWrites(cmd,
  /(?:cli|askerdo)\.mjs["']?\s+(?:task\s+(?:update|edit|create)|check\s+(?:add|done|strike|move)|edge\s+(?:add|remove)|(?:reopen|note)\s+["']?T-\d+)\b/);
/* a hub command that writes a fact or records a ruling, which an agent never runs; show and decisions are reads */
export const isHubFactWrite = (cmd) => hubWrites(cmd, /(?:cli|askerdo)\.mjs["']?\s+(?:knowledge\s+(?:new|amend|edit|supersede)|decide)\b/);
/* the CLI segments that file or move work, which the board polices by the session they name */
const FILINGS = ['task create', 'task edit', 'track capture', 'track layout', 'handoff write'];
const flagOn = (words, f) => words.some((w) => w === f || w.startsWith(f + '='));
const flagValues = (words, f) => words.flatMap((w, i) => (w === f ? [words[i + 1] || ''] : w.startsWith(f + '=') ? [w.slice(f.length + 1)] : []));
function filesWork(p) {
  const { verb, words } = hubVerb(p);
  if (FILINGS.includes(verb)) return true;
  if (verb === 'task update') return flagOn(words, '--leftovers') || flagOn(words, '--move-steps');
  if (verb === 'track new' || verb === 'track splinter') return flagOn(words, '--task');
  return (verb === 'track finish' || verb === 'track drop') && flagOn(words, '--leftovers');
}
const answersQuestion = (p) => ['answer', 'drop'].includes(hubVerb(p).verb);
/* the user's press on an override, which the mod sends with their mark */
const pressesOverride = (p) => { const { verb, rest } = hubVerb(p); return verb === 'override' && ['decide', 'unscrub'].includes(rest[0]); };
const OWN_SESSION = /^\$(?:CLAUDE_CODE_SESSION_ID|\{CLAUDE_CODE_SESSION_ID\}|env:CLAUDE_CODE_SESSION_ID)$/i;
/* a command that clears or sets the session's id (env -u, env -i, VAR=, unset, $env:VAR =, Remove-Item Env:VAR) */
const SESSION_ENV = /CLAUDE_CODE_SESSION_ID\s*:?=(?!=)|(?:-u\s*|--unset[=\s]\s*|\bunset\s+(?:-v\s+)?|(?<!\$)\benv:\\?|Remove-Variable\s+(?:-Name\s+)?)CLAUDE_CODE_SESSION_ID|SetEnvironmentVariable\W+CLAUDE_CODE_SESSION_ID|\benv\s+(?:(?:-u\s+\S+|-\S+|\w+=\S*)\s+)*?(?:-i|--ignore-environment|-)\s/i;
/* the user's mark (--user), another session's id, or a cleared or set session id on a live filing passes the
   call off as the user or another session: 'user', 'session' or 'env' ('override' for an override press), else '';
   the plugin's own calls never pass here */
export function forgedFiling(cmd, sid) {
  if (!isHubShell(cmd)) return '';
  if (liveParts(cmd, (p) => pressesOverride(p) && flagOn(hubVerb(p).words, '--user')).length) return 'override';
  if ((SESSION_ENV.test(String(cmd)) || SESSION_ENV.test(plainQuotes(cmd))) && liveParts(cmd, filesWork).length) return 'env';
  if (liveParts(cmd, (p) => (filesWork(p) || answersQuestion(p)) && flagOn(hubVerb(p).words, '--user')).length) return 'user';
  const other = (v) => { const s = String(v).replace(/^["']+|["']+$/g, ''); return !(OWN_SESSION.test(s) || (sid && s === String(sid))); };
  return liveParts(cmd, (p) => filesWork(p) && flagValues(hubVerb(p).words, '--session').some(other)).length ? 'session' : '';
}
/* the questions a live-board shell answer or drop names: a bare number or q5 as the board reads it,
   anything else as written (a variable's stays as typed) */
export function hubAnswers(cmd) {
  return liveParts(cmd, answersQuestion).map((p) => {
    const words = hubVerb(p).words.slice(1);
    for (let i = 0; i < words.length; i++) {
      if (!words[i].startsWith('--')) {
        const id = words[i].replace(/^["']+|["']+$/g, '');
        const n = /^q?(\d+)$/i.exec(id);
        return n ? 'Q' + Number(n[1]) : id;
      }
      if (!words[i].includes('=') && !['--json', '--amend'].includes(words[i])) i++;
    }
    return '';
  });
}
/* whether the user's own message names a question: its Q form, a token (12b, of `letters` when
   given), or its local label; a bare number names nothing ("run the 12 tests") */
export function namesQuestion(text, id, label, letters) {
  const t = String(text || '').split(JOIN).join('');
  const named = (form) => new RegExp('(?<![\\w-])(?:' + form + ')(?![\\w-])', 'i').test(t);
  const own = (Array.isArray(letters) ? letters : []).filter((x) => /^[a-z]$/i.test(String(x))).join('');
  const pick = own ? '[' + own + ']' : '[a-z]';
  const n = /^Q?(\d+)$/i.exec(String(id || ''));
  const l = /^L(\d+)$/i.exec(String(label || ''));
  return !!(n && named('Q' + n[1] + '[a-z]?|' + n[1] + pick)) || !!(l && named('L' + l[1] + '[a-z]?'));
}
/* an /askerdo line whose run carries the user's mark: a board question's token, an override press, a capture or a finish */
export function userMarked(args) {
  const p = parseAskerdo(args);
  if (p.verb === 'answer') return /^Q?\d/i.test(String(p.args).trim());
  if (['withdraw', 'fix', 'scrub', 'allow', 'keep', 'unscrub'].includes(p.verb)) return true;
  return p.verb === 'track' && ['capture', 'finish'].includes(parseTrack(p.args).sub);
}
/* a hub command by which a session takes or leaves a track; a bare or read-only resume takes none */
const TRACK_MOVES = ['resume', 'track new', 'track splinter', 'track park', 'track finish', 'track drop', 'handoff write'];
export const movesTrack = (cmd) => isHubShell(cmd) && plainQuotes(cmd).split(/&&|\|\||[|;\r\n]/).some((p) => {
  if (!isHubShell(p)) return false;
  const { verb, rest, words } = hubVerb(p);
  return TRACK_MOVES.includes(verb) && !(verb === 'resume' && (!rest.length || words.includes('--read-only')));
});
/* the tracks a shell command's CLI `handoff write TR-n` steps write, upper-cased; a write from a
   script file or a track id built from a variable is not seen */
export const handoffWrites = (cmd) => !isHubShell(cmd) ? [] : plainQuotes(cmd).split(/&&|\|\||[|;\r\n]/).flatMap((p) => {
  if (!isHubShell(p)) return [];
  const { verb, rest } = hubVerb(p);
  const id = verb === 'handoff write' ? rest.find((w) => /^tr-\d+(?:\.\d+)?$/i.test(w)) : undefined;
  return id ? [id.toUpperCase()] : [];
});
/* whether a held handoff write shares its command with a step that changes something, which
   did not run either; a payload's heredoc or here-string and reading steps (echo, cd, exit) do not count */
const HEREDOC = /<<-?[ \t]*(['"]?)(\w+)\1([^\n]*)\n[\s\S]*?\n[ \t]*\2[ \t]*(?=\r?\n|$)/g;
const HERESTRING = /@(['"])\r?\n[\s\S]*?\r?\n\1@/g;
export const handoffOthers = (cmd) => plainQuotes(String(cmd || '').replace(HEREDOC, '$3').replace(HERESTRING, ''))
  .split(/&&|\|\||[|;\r\n]/).map((p) => p.trim()).some((p) => p
    && !(isHubShell(p) && hubVerb(p).verb === 'handoff write') && (/>/.test(p.replace(SAFE_REDIRECT, ' ')) || !partReads(p)));

/* ---- the override card ------------------------------------------- */

export const OVERRIDE_KINDS = Object.freeze(['fix', 'withdraw', 'scrub']);
const OVERRIDE_FIELDS = ['name', 'description', 'intent', 'close', 'body', 'words', 'text'];

/* The override_request tool's input as `override request` takes it on stdin: one record
   and its fields, or a batch's items; the board checks the rest. */
export function overrideArgs(input) {
  const o = input && typeof input === 'object' ? input : {};
  if (!OVERRIDE_KINDS.includes(o.kind)) return { error: 'kind is ' + OVERRIDE_KINDS.join(', ') };
  for (const k of ['summary', 'reason']) if (typeof o[k] !== 'string' || !o[k].trim()) return { error: k + ' is required' };
  const own = OVERRIDE_FIELDS.filter((k) => o[k] !== undefined);
  const head = { kind: o.kind, reason: o.reason, summary: o.summary };
  if (Array.isArray(o.items) && o.items.length) {
    if (o.record !== undefined || own.length) return { error: 'a batch names each record and its fields in items; record and ' + OVERRIDE_FIELDS.join(', ') + ' go with one record' };
    if (o.items.some((it) => !it || typeof it.record !== 'string' || !it.record.trim())) return { error: 'each item names its record' };
    return { payload: { ...head, items: o.items } };
  }
  if (typeof o.record !== 'string' || !o.record.trim()) return { error: 'record (T-n or K-n), or items for a batch, is required' };
  return { payload: { ...head, items: [{ record: o.record.trim(), ...Object.fromEntries(own.map((k) => [k, o[k]])) }] } };
}

/* The request as the reply's card keeps it (the told record); url: its page through the local server. */
export function overrideTold(r, url) {
  const j = r || {};
  /* a one-field fix's words now and as proposed, cut to what two card lines can show */
  const ch = j.change && typeof j.change === 'object' ? j.change : null;
  const keep = (s) => flatLine(s).slice(0, CHANGE_KEEP);
  return {
    override: true, request: Number(j.request), kind: String(j.kind || ''), records: Array.isArray(j.records) ? j.records.map(flatLine) : [], expires: String(j.expires || ''),
    summary: flatLine(j.summary || j.text), measured: flatLine(j.measured), reversal: j.reversal === true, url: cardHref(url) || '',
    ...(ch ? { change: { field: flatLine(ch.field), before: keep(ch.before), after: keep(ch.after) } } : {}),
  };
}
const CHANGE_KEEP = 600;

/* What the typed answers name: the one record, or the batch's number. */
export const overrideOn = (o) => (o.records.length === 1 ? o.records[0] : '#' + o.request);
const overrideWhat = (o) => o.kind + ' ' + (o.records.length === 1 ? o.records[0] : o.records.length + ' records');
const reversalLead = (o) => {
  const n = o.records.length;
  return 'Reversal of ' + overrideOn(o) + ': ' + (o.kind === 'withdraw' ? 'withdraws ' + (n === 1 ? 'a ruling' : n + ' rulings') + ' as never made'
    : 'fixes the text of ' + (n === 1 ? 'a ruling' : n + ' records, rulings among them'));
};

/* The block the reply carries whole (the stored message, the phone); one paragraph, so the
   desktop finds it by its head and its two typed answers and draws the card instead. */
export function overrideBlock(o) {
  const on = overrideOn(o);
  const lines = [o.reversal ? '**' + reversalLead(o) + ' (override #' + o.request + ')**' : '**Override #' + o.request + ': ' + overrideWhat(o) + '**'];
  lines.push('- ' + o.summary);
  if (o.measured) lines.push('- Measured by the board: ' + o.measured);
  if (o.records.length > 1) lines.push('- Records: ' + o.records.join(', '));
  if (o.url) lines.push('- Before and after: ' + o.url);
  lines.push('- Your answer: ' + o.kind + ' ' + on + ' or keep ' + on);
  return lines.join('\n');
}

/* The tool's answer: the block and how its answers come back. */
export function overrideResult(o) {
  const n = nameOf();
  const on = overrideOn(o);
  return 'Override #' + o.request + ' waits on ' + n + '\'s ' + actLabel(o.kind) + ' or Keep. Put this block in your reply as written'
    + '; where the mod draws, it is the card under the reply:\n\n'
    + overrideBlock(o) + '\n\n'
    + n + '\'s press, anywhere, reaches this session. If ' + n + ' types ' + o.kind + ' ' + on + ' or keep ' + on + ' in chat, record it: `override decide '
    + on + ' ' + o.kind + '` (or keep) `--user <own-id>`, their act.';
}

/* The card's model: the reversal lead, the head, what the board measured, the page, and the
   presses while it waits; saving: the decision a press is saving. */
export function overrideCard(o, saving, now = Date.now()) {
  /* judged on read, as the board does: past its date it waits only for Keep to clear it */
  const expired = o.expires && Date.parse(o.expires) <= now;
  const state = saving ? 'saving' : o.decided || (expired ? 'expired' : 'open');
  const count = o.records.length;
  const act = actLabel(o.kind);
  const LINES = {
    saving: GLYPHS.pending + ' Saving your ' + (saving === 'allow' ? act : 'Keep'),
    allow: (OVERRIDE_DONE[o.kind] || 'Applied') + ': the change is applied.',
    keep: 'Kept as written: nothing was changed.',
    changed: 'Changed since asked: ' + act + ' is refused. Keep clears it, and the session asks again from the text as it stands.',
    expired: 'Expired unanswered: ' + act + ' is refused. Keep clears it, and the session asks again if it is still needed.',
    dropped: 'Closed unanswered: nothing was applied.',
  };
  const press = (decision) => ({ decision, label: decision === 'allow' ? act : 'Keep' });
  return {
    request: o.request, state, lead: o.reversal ? reversalLead(o) : '', title: 'Override #' + o.request, what: overrideWhat(o),
    records: count > 1 ? o.records.slice(0, 8).join(', ') + (count > 8 ? ' and ' + (count - 8) + ' more' : '') : '',
    summary: o.summary, measured: o.measured, url: o.url || '', line: LINES[state] || '',
    /* the field's words now and what they become, drawn under the summary */
    change: o.change && typeof o.change === 'object' ? { now: String(o.change.before || ''), becomes: String(o.change.after || '') } : null,
    presses: state === 'open' ? [press('allow'), press('keep')] : state === 'changed' || state === 'expired' ? [press('keep')] : [],
  };
}

/* The reply's override block: the paragraph holding both typed answers, back to its head's
   paragraph a few on; null leaves the text whole. */
const reEscape = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function overrideAt(units, o) {
  if (!o || !Number.isFinite(o.request) || !Array.isArray(o.records)) return null;
  const on = reEscape(overrideOn(o));
  const typed = (w) => new RegExp('(?<![0-9a-z])' + w + '\\s+' + on + '(?![0-9])', 'i');
  /* allow: the typed answer a reply carried before the act words */
  const answers = (u) => u.kind === 'para' && (typed(reEscape(o.kind || 'allow')).test(u.text) || typed('allow').test(u.text)) && typed('keep').test(u.text);
  const prose = (u) => u && (u.kind === 'para' || u.kind === 'head');
  const head = (u) => prose(u) && new RegExp('override #' + o.request + '(?![0-9])', 'i').test(u.text);
  const end = units.findIndex(answers);
  if (end < 0) return null;
  let first = end;
  while (first > 0 && end - first < 4 && !head(units[first])) first--;
  if (!head(units[first]) || !units.slice(first, end + 1).every(prose)) return null;
  return { from: units[first].from, to: units[end].to, keep: '' };
}

/* ---- a plain session's own questions --------------- */

/* the labels a session not engaged keeps its questions under, counted per session */
export const isLocalId = (s) => typeof s === 'string' && /^L\d+$/.test(s);
export const LOCAL_KEEP_MS = 7 * 24 * 3600 * 1000;

/* A kept question as the band, the pane and the first telling read a board one. */
export const localCard = (q, sid) => ({ ...q.payload, id: q.label, session: sid, asker: sid, created: q.created, local: true });

export function localResult(label, payload) {
  const letters = (payload.options || []).map((o) => o && o.type).filter((t) => /^[a-z]$/.test(t || ''));
  const parts = ['Kept ' + label + ' (' + flatLine(payload.name) + ') with this session'];
  if (letters.length) parts.push('answer tokens ' + letters.map((l) => token(label, l)).join(', '));
  if (payload.pick) parts.push('pick ' + token(label, payload.pick));
  return parts.join('; ') + '. It stays with this session and reaches the board only if the session uses AskerDo;'
    + ' the band and the card answer it, and its answer reaches you as the usual note.'
    + pasteLine(tellBlock({ ...payload, id: label }, letters));
}

/* The band's model with the session's kept questions ahead of the board's. */
export function withLocal(model, cards, sid) {
  const mine = bandModel({ questions: cards, sid });
  if (!mine) return model;
  const base = model || EMPTY_BAND;
  const all = [...mine.questions, ...(base.questions || [])];
  return { ...base, questions: all.slice(0, BAND_MAX), more: (base.more || 0) + Math.max(0, all.length - BAND_MAX),
    total: (base.total || 0) + mine.total, blocking: (base.blocking || 0) + mine.blocking };
}

/* A kept question's answer or drop as an inbox event, read in the user's voice by userLine. */
export function localEvent(q, sid, at) {
  const name = flatLine(q.payload && q.payload.name);
  const drop = q.status === 'dropped';
  const raw = { at, kind: drop ? 'drop' : 'answer', id: q.label, name, pick: drop ? null : q.pick || null, note: q.note || null, by: 'user:' + sid };
  return { key: ['local', q.label, raw.kind, at].join('|'), raw,
    line: q.label + ' (' + name + ') was ' + (drop ? 'dropped' : 'answered') + ' here' + (raw.pick ? ': ' + token(q.label, raw.pick) : '') + '.' };
}

/* Entries untouched for a week go at a session start; the session starting keeps its own. */
export function pruneLocal(all, keep, now) {
  const out = {};
  for (const [k, v] of Object.entries(all || {})) if (k === keep || (v && Number(v.at) >= now - LOCAL_KEEP_MS)) out[k] = v;
  return out;
}

const HAND = '\u{1F64B}', SOON = '\u{1F51C}', GREEN = '\u{1F7E2}', FLAG = '\u{1F3C1}';
const FORECASTS = [HAND, SOON, GREEN, FLAG];
const FOOTER_LINE = new RegExp('^\\s*(?:[#>*_]+\\s*)*(' + FORECASTS.join('|') + ')\\s*\\**\\s*(?:Needs you|Nothing needed yet|Next up|Done)\\b', 'u');
const NAMES_LINE = /^\s*\u2753\s*\**\s*\[?\s*\d+ open questions?/mu;
const EMPTY_SET = /\b(?:no|zero|0) open questions\b|\bnothing (?:is )?open on the board\b|\bthe (?:question )?queue is empty\b|\bnames line is empty\b|\bno questions (?:are )?open\b/i;

const KICKOFF_BLOCK = /```[^\n]*\r?\n\s*(?:Resume |\/askerdo resume )([^\n]*)/g;
/* a fenced resume closes this session only when it names a track the session holds or handed off */
const ownKickoff = (reply, own) => {
  const ids = own.filter(Boolean).map((t) => String(t).toUpperCase().replace(/\.\d+$/, ''));
  return [...reply.matchAll(KICKOFF_BLOCK)].some((m) => (m[1].match(/\bTR-\d+/gi) || []).some((t) => ids.includes(t.toUpperCase())));
};
const HANDOFF_WORDS = /\bhand-?offs?\b|\bhanded off\b|\bkick-?offs?\b/i;

/* Code is not prose: fences and spans go before any reading of the words. */
const prose = (text) => String(text || '').replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ');

/* line 1's cluster is its leading run of emoji, each read without its selector,
   modifier or joined tail; the slots are status, weather when on, then forecast. */
const STATUSES = ['✅', '\u{1F680}', '\u{1F50E}', '⚠', '❌'];
const WEATHERS = ['☀', '\u{1F324}', '⛈'];
const GLYPH = /^(\p{Extended_Pictographic})(?:️|\p{Emoji_Modifier})*(?:‍\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})*)*\s*/u;
function clusterOf(line) {
  let rest = String(line || '').replace(/^[\s#>*_]+/, '');
  const out = [];
  for (let m = GLYPH.exec(rest); m; m = GLYPH.exec(rest)) { out.push(m[1]); rest = rest.slice(m[0].length); }
  return out;
}
const kindOf = (g) => (STATUSES.includes(g) ? 'status' : WEATHERS.includes(g) ? 'weather' : FORECASTS.includes(g) ? 'forecast' : '');
const slotsOf = (weather) => ['status', ...(weather ? ['weather'] : []), 'forecast'];

/* The forecast slot only, never a forecast glyph further along line 1; with the weather
   option unknown, a weather glyph second says the forecast is third. */
function forecastOf(line, weather) {
  const c = clusterOf(line);
  const w = weather === undefined ? kindOf(c[1]) === 'weather' : !!weather;
  const g = c[slotsOf(w).length - 1];
  return FORECASTS.includes(g) ? g : null;
}

/* The last footer section of a reply: its glyph and its body. */
export function footerOf(text) {
  const lines = String(text || '').split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = FOOTER_LINE.exec(lines[i]);
    if (m) return { glyph: m[1], body: lines.slice(i).join('\n') };
  }
  return null;
}

export const firstLine = (text) => (String(text || '').split(/\r?\n/).find((l) => l.trim()) || '');

/* The contract drops the cluster only on a tier-1 one-liner or a plain conversational turn, so a
   footer, a heading, a list, a table, the fold or more than five lines of prose call for it.
   What shows that, '' for a short plain reply. */
function shapeOf(reply, foot) {
  if (foot) return 'a footer';
  const text = prose(reply);
  if (/^\s*#{1,6}\s/m.test(text)) return 'a heading';
  if (/^\s*(?:[-*+]|\d+[.)])\s+\S/m.test(text)) return 'a list';
  if (/^\s*\|.*\|\s*$/m.test(text)) return 'a table';
  if (/^\s*---\s*$/m.test(text)) return 'the fold';
  const n = text.split(/\r?\n/).filter((l) => l.trim()).length;
  return n > 5 ? n + ' lines' : '';
}

/* The checks on one reply: each flags, never rewrites. `all` is every
 * text block of the turn, `answer` the final reply; `checks` the saved options,
 * `band` whether the band draws here, `windowTold` whether the meter reached the
 * handoff window, `handoffAsked` the user's ask, `receipts` the answers delivered
 * before this reply (receiptsOf; `after` the text written after one that arrived mid-turn), `resume` the thread a handoff of this turn wrote, `carry`
 * the block of a handoff the board did not take this turn (carryBlock), `held` the track the session holds,
 * `running` the session's work still running (runningNames), `left` tracks its own shell calls let go this turn. */
export function replyChecks({ answer, all, checks = {}, band = false, windowTold = true, handoffAsked = false, receipts = [], resume = '', carry = '', held = '', inbox = [], due = [], running = '', left = [] } = {}) {
  const slips = [];
  const reply = String(answer || '');
  const every = all == null ? reply : String(all);
  if (checks.emdash && /[\u2013\u2014]/.test(every)) slips.push({ id: 'dash', say: 'em or en dashes' });
  /* each delivered token named on the turn's line 1 or the line after it,
     so the receipt and line 1's cluster never both claim the first line. One that
     arrived mid-turn (`after`, the first text written after it) is read there or in the final reply */
  const twoLines = (s) => prose(s).split(/\r?\n/).filter((l) => l.trim()).slice(0, 2).join('\n');
  const names = (t, s) => new RegExp('\\b' + t.replace(/[^\w]/g, '\\$&') + '\\b', 'i').test(s);
  const owed = [];
  for (const x of receipts || []) {
    const t = String((x && x.token) || x || '');
    if (t && !owed.some((o) => o.token === t)) owed.push({ token: t, after: x && typeof x.after === 'string' ? x.after : null });
  }
  const head = twoLines(every);
  const missed = owed.filter((o) => o.after == null ? !names(o.token, head) : !names(o.token, twoLines(o.after)) && !names(o.token, twoLines(reply)));
  if (missed.length) slips.push({ id: 'receipt', say: 'no receipt for ' + missed.map((o) => o.token).join(', ') + ': name each answer on line 1 after its opening, or on the line straight after it'
    + (missed.some((o) => o.after != null) ? ', in the first text written after it arrived or in the final reply' : '') });
  /* a turn that wrote a handoff hands the user the resume command in a copy block */
  if (resume && !resumeFence(resume).test(reply)) slips.push({ id: 'resume', say: 'a handoff close without `/askerdo resume ' + resume + '` alone in a fenced copy block above the footer' });
  /* a resume command handed over while this session's work runs, however the handoff was written */
  if (running && (Array.isArray(left) ? left : []).concat(held || []).some((t) => t && resumeFence(t).test(reply))) slips.push({ id: 'resume-early', say: 'a resume command while this session\'s work still runs (' + running + '): the handoff waits for each to land and its result to be checked' });
  /* a handoff the board did not take rides the reply whole, so the leg is not lost */
  if (carry && !carried(every, carry)) slips.push({ id: 'carry', say: 'a handoff the board did not take, not carried whole: the reply holds the fenced block its failed result handed you, exactly as written' });
  /* a close's inbox items still unplaced at the turn's end, each named in the reply (carried or asked about) */
  const unnamed = [...new Set((inbox || []).map(String).filter(Boolean))].filter((t) => !new RegExp('\\b' + t.replace(/[^\w]/g, '\\$&') + '\\b').test(every));
  if (unnamed.length) slips.push({ id: 'inbox', say: 'a close that skipped its inbox: ' + unnamed.join(', ') + (unnamed.length === 1 ? ' is' : ' are')
    + ' still unplaced and the reply never names ' + (unnamed.length === 1 ? 'it' : 'them') + '; put each on a track, move it to its workstream, give it a new wake (task edit T-n --wake <event or YYYY-MM-DD>), or carry or ask about it in the reply' });
  /* a due inbox task is placed or woken again by the turn's end; naming it does not settle it */
  const owedDue = [...new Set((due || []).map(String).filter(Boolean))];
  if (owedDue.length) slips.push({ id: 'inbox-due', say: 'a close that left ' + owedDue.join(', ') + ' due for a home: naming ' + (owedDue.length === 1 ? 'it' : 'them')
    + ' does not settle ' + (owedDue.length === 1 ? 'it' : 'them') + '; put each on a track (a new parked one when it starts later) or give it a new wake (task edit T-n --wake <event or YYYY-MM-DD>) before the turn ends' });
  if (band && (NAMES_LINE.test(reply) || EMPTY_SET.test(prose(reply)))) {
    slips.push({ id: 'names', say: 'a names line or a remark about open questions, which the band carries here' });
  }
  if (checks.forecast) {
    const foot = footerOf(reply);
    const line = firstLine(reply);
    const top = forecastOf(line, !!checks.weather);
    if (foot && top && foot.glyph !== top) slips.push({ id: 'footer', say: 'a footer state (' + foot.glyph + ') that disagrees with line 1 (' + top + ')' });
    /* a line 1 that promises a footer with none under it */
    const cluster = clusterOf(line);
    const promise = top && top !== GREEN ? top : cluster.includes(HAND) ? HAND : '';
    if (!foot && promise) slips.push({ id: 'no-footer', say: 'line 1 (' + promise + ') promises a labeled footer and none came: the ask or the state sits unlabeled' });
    const slots = slotsOf(!!checks.weather);
    const wrong = cluster.slice(0, slots.length).map((g, i) => [g, kindOf(g), slots[i]]).filter(([, k, s]) => k && k !== s);
    if (wrong.length) slips.push({ id: 'slot', say: 'a palette glyph in the wrong slot of line 1: ' + wrong.map(([g, , s]) => g + ' in the ' + s + ' slot').join(', ') + ' (the cluster reads ' + slots.join(', ') + ')' });
    const shape = !cluster.some(kindOf) && shapeOf(reply, foot);
    if (shape) slips.push({ id: 'no-cluster', say: 'no cluster on line 1 of a reply with ' + shape + ': past a one-liner or a plain conversational turn, line 1 opens with the cluster (' + slots.join(', ') + ')' });
    /* a close by handoff: the finished flag or a fenced kickoff, with handoff words in
       prose; a footer that only names a kickoff fix is a mid-arc status */
    const byHandoff = (foot && foot.glyph === FLAG) || ownKickoff(reply, [resume, held]);
    if (byHandoff && HANDOFF_WORDS.test(prose(reply)) && !windowTold && !handoffAsked) {
      slips.push({ id: 'handoff', say: 'an early handoff: the mod\'s depth note had not called for one and ' + nameOf() + ' did not ask (in chat or through /askerdo handoff); a step that waits on ' + nameOf() + ' is asked here and run here' });
    }
  }
  return slips;
}

/* a shell command that makes a commit; a dry run, an abort, a squash or a no-commit
   pick or revert makes none, nor a read such as git log or git merge-base. Flags are read
   outside quoted text, so a message is never a flag; a single & separates commands too. */
const GIT_COMMIT = /^\s*(?:[&(]\s*)?(?:\w+=\S*\s+)*git(?:\.exe)?(?:\s+(?:-[Cc]\s+(?:"[^"]*"|'[^']*'|\S+)|--?[\w-]+(?:=\S+)?))*\s+(commit|merge|cherry-pick|revert|am)(?=\s|$)(.*)$/;
const QUOTED = /"(?:[^"\\]|\\.)*"|'[^']*'/g;
const NO_COMMIT = /(?:^|\s)--(?:dry-run|abort|quit|no-commit)(?=\s|$)/;
const NO_COMMIT_BY = {
  commit: /(?:^|\s)--(?:porcelain|short|long)(?=[\s=]|$)/,
  merge: /(?:^|\s)--squash(?=\s|$)/,
  'cherry-pick': /(?:^|\s)-n(?=\s|$)/,
  revert: /(?:^|\s)-n(?=\s|$)/,
};
export function commitsIn(command) {
  return String(command || '').replace(QUOTED, '""').split(/&&|\|\||[;|&\r\n]/).some((part) => {
    const m = GIT_COMMIT.exec(part);
    return !!m && !NO_COMMIT.test(m[2]) && !(NO_COMMIT_BY[m[1]] && NO_COMMIT_BY[m[1]].test(m[2]));
  });
}

/* work the main loop ran with no task in hand never reaches the track, so the next
   session cannot see it; one slip at the turn's end, or none while a task was held. */
const counted = (n, one, many) => (n === 1 ? (/^[aeiou]/.test(one) ? 'an ' : 'a ') + one : n + ' ' + many);
export function offTrackSlip({ dispatched = 0, commits = 0, holding = false, track = '', onboarding = false, sweep = false, agentTasks = [] } = {}) {
  /* an onboarding run writes nothing to the board before the user's go, so it has no task to hold */
  if (holding || onboarding) return null;
  /* a sweep's reader only reads and its homes are filed as tasks, so a sweep turn's dispatch is the sweep's own */
  if (sweep) dispatched = 0;
  if (!(dispatched > 0 || commits > 0)) return null;
  const ran = [dispatched > 0 ? counted(dispatched, 'agent dispatch', 'agent dispatches') : '', commits > 0 ? counted(commits, 'commit', 'commits') : '']
    .filter(Boolean).join(' and ');
  /* a commit may land an agent task running on the held track; say what is true and name it */
  const open = (agentTasks || []).filter(Boolean);
  if (open.length && commits > 0 && !dispatched) {
    return { id: 'off-track', say: ran + ' with no task held when it landed: if it lands ' + open.join(' or ')
      + ' (an agent task' + (track ? ' on ' + track : '') + '), lead the commit subject with that task id or take it in hand first, so the commit links to it' };
  }
  const fix = track ? 'take the step\'s task in hand (task_update with inHand) or lay it out on ' + track + ' first'
    : 'start or resume the track the work belongs to';
  return { id: 'off-track', say: ran + ' with no task in hand, so the track never shows the work: ' + fix };
}

/* A program run of the AskerDo CLI with this verb. A quoted CLI path is kept; any other quoted
   text (a message, a pattern) is blanked, so a mention of the verb never counts. */
const CLI_PATH = /(?:askerdo[\\/]cli|bin[\\/]askerdo)\.mjs$/;
/* the program may be node by a quoted or bare path, as PowerShell's `& "C:\Program Files\nodejs\node.exe"` */
const NODE_PATH = /^(?:.*[\\/])?node(?:\.exe)?$/;
const CLI_RUN = /^\s*(?:[&(]\s*)?(?:\w+=\S*\s+)*(?:(?:"(?:[^"]*[\\/])?node(?:\.exe)?"|'(?:[^']*[\\/])?node(?:\.exe)?'|(?:\S*[\\/])?node(?:\.exe)?)\s+)?("[^"]*"|'[^']*'|\S+)(?:\s+--?[\w-]+)*\s+([\w-]+)/;
export function hubRan(command, verb) {
  const plain = String(command || '').replace(QUOTED, (q) => (CLI_PATH.test(q.slice(1, -1)) || NODE_PATH.test(q.slice(1, -1)) ? q : '""'));
  return plain.split(/&&|\|\||[;|&\r\n]/).some((part) => {
    const m = CLI_RUN.exec(part);
    return !!m && CLI_PATH.test(m[1].replace(/^["']|["']$/g, '')) && m[2] === verb;
  });
}

/* the inbox a hub shell close (track finish or drop, handoff write) printed, its ids and
   the closed track; the JSON form or the kickoff's Inbox line. Null for any other command. */
const CLOSES = ['track finish', 'track drop', 'handoff write'];
/* the due rows of a workstream other than the closing track's (`ws`, an id or its head), which the close only names */
export function dueAway(rows, ws) {
  const own = typeof ws === 'string' ? ws : ws && ws.id;
  if (!own || !Array.isArray(rows)) return [];
  return rows.filter((t) => t && t.due && !t.asked && t.workstream && t.workstream.id && t.workstream.id !== own).map((t) => String(t.id || '')).filter(Boolean);
}
export function closedInbox(command, stdout) {
  const cmd = String(command || '');
  if (!isHubShell(cmd) || !CLOSES.includes(hubVerb(cmd).verb)) return null;
  const out = String(stdout || '');
  let j = null;
  try { j = JSON.parse(out); } catch {}
  const at = (s) => { const m = /\bTR-\d+\b/.exec(String(s || '')); return m ? m[0] : ''; };
  if (j && typeof j === 'object' && Array.isArray(j.inbox)) {
    /* a due task with the user's question open waits on the answer, so it is only named */
    const due = j.inbox.filter((t) => t && t.due && !t.asked).map((t) => String(t.id || '')).filter(Boolean);
    const away = dueAway(j.inbox, j.workstream);
    return { track: at(j.track) || at(j.id) || at(cmd), ids: j.inbox.map((t) => String((t && t.id) || '')).filter(Boolean), ...(due.length ? { due } : {}), ...(away.length ? { away } : {}) };
  }
  const line = /^Inbox \((\d+)\): (.*)$/m.exec(out);
  const parts = line ? line[2].split('; ') : [];
  const ids = parts.map((x) => (/^T-\d+\b/.exec(x) || [''])[0]).filter(Boolean);
  /* a due row reads "(WS-n name, due)"; inboxLines names another workstream's as "T-n (WS-n)" */
  const due = parts.filter((x) => /, due\)\.?\s*$/.test(x)).map((x) => (/^T-\d+\b/.exec(x) || [''])[0]).filter(Boolean);
  const place = /^Place each: .*$/m.exec(out);
  const away = place ? [...place[0].matchAll(/\b(T-\d+) \(WS-\d+\)/g)].map((m) => m[1]) : [];
  /* the line names at most ten; `more` sends the turn-end check to the board's whole list */
  return { track: at(cmd) || at(out), ids, ...(due.length ? { due } : {}), ...(away.length ? { away } : {}), ...(line && Number(line[1]) > ids.length ? { more: true } : {}) };
}

/* what a close's inbox still owes at the turn's end, read against the board's
   list now (`now`, null when the read failed): a task still due is placed or woken again, never
   just named; one due at the close and woken since passes; the rest are named in the reply.
   only the closing track's workstream (`ws`) owes its due tasks; another's, and one the
   user is asked about, are named, so one workstream's backlog never blocks another's close.
   With the read failed, the close's own `away` list stands in for the workstream test.
   one not yet due owes nothing; a due one passes placed, woken by its event, or gated by an
   open question (the board's `asked`, or `gated`: the tasks this turn's ask calls gate). */
export function inboxLeft(closed, now, ws, gated = []) {
  const ids = closed && Array.isArray(closed.ids) ? closed.ids : [];
  const wasDue = closed && Array.isArray(closed.due) ? closed.due : [];
  if (!ids.length) return { name: [], due: [] };
  const open = (id) => !(gated || []).includes(id);
  if (!Array.isArray(now)) {
    const away = Array.isArray(closed.away) ? closed.away : [];
    return { name: wasDue.filter((id) => away.includes(id) && open(id)), due: wasDue.filter((id) => !away.includes(id) && open(id)) };
  }
  const rows = new Map(now.map((t) => [String((t && t.id) || ''), t]).filter(([id]) => id));
  const kept = ids.filter((id) => rows.has(id));
  const all = closed.more ? [...new Set([...kept, ...rows.keys()])] : kept;
  const mine = (t) => !ws || !t.workstream || !t.workstream.id || t.workstream.id === ws;
  const owes = all.filter((id) => { const t = rows.get(id); return t.due && !t.asked && open(id); });
  return { name: owes.filter((id) => !mine(rows.get(id))), due: owes.filter((id) => mine(rows.get(id))) };
}

/* a call that closes something, or notes a task, in words naming something left (leftUndone)
   with no leftover filed in it. Each hit is { id, said, kind }: 'close' a task's, 'track' a track's
   finish or drop (`field` its outcome or reason), 'note' a note on any record (it asks for nothing). */
const CLOSING = ['done', 'dropped'];
const hubScript = (w) => /(?:^|[\\/])askerdo[\\/]cli\.mjs$|(?:^|[\\/])bin[\\/]askerdo\.mjs$/i.test(w);
const leftGiven = (v) => (Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null && v !== false);
/* with no status the call only notes, so its note alone is read; one that starts or reopens leaves nothing.
   A task update's note flags only on a closed task (`closedOnly`): the call that adds a step is in hand. */
function taskLeft(id, status, note, reason, given, copied, noteCall = false) {
  const said = leftUndone([note, status === undefined ? undefined : reason].filter((x) => typeof x === 'string').join('\n'), copied);
  if (!said) return null;
  if (status === undefined && noteCall) return isRecordId(id) && !/^Q\d/.test(id) ? { id, said, kind: 'note' } : null;
  if (!/^T-\d+$/.test(id)) return null;
  if (status === undefined) return { id, said, kind: 'note', closedOnly: true };
  return CLOSING.includes(status) && !given ? { id, said, kind: 'close' } : null;
}
/* one hub command's words: its verb, the record, the flags that matter; a note's body on stdin
   is in the command text (a heredoc or a here-string), so the whole text stands in for it */
function hubLeft(words, text) {
  const at = words.findIndex(hubScript);
  if (at < 0) return null;
  const args = words.slice(at + 1);
  const flag = (name) => {
    const i = args.findIndex((a) => a === '--' + name || a.startsWith('--' + name + '='));
    if (i < 0) return undefined;
    return args[i].includes('=') ? args[i].slice(args[i].indexOf('=') + 1) : args[i + 1];
  };
  const pair = ['task', 'track'].includes(String(args[0]).toLowerCase());
  const verb = (pair ? args[0] + ' ' + args[1] : String(args[0] || '')).toLowerCase();
  const id = String(args[pair ? 2 : 1] || '').toUpperCase();
  if (verb === 'track finish' || verb === 'track drop') {
    const field = verb === 'track finish' ? 'outcome' : 'reason';
    const said = /^TR-\d+$/.test(id) && leftUndone(flag(field));
    return said ? { id, said, kind: 'track', field } : null;
  }
  if (verb === 'task update' || verb === 'task edit') {
    const status = flag('status');
    return taskLeft(id, status === undefined ? undefined : String(status).toLowerCase(), flag('note'), flag('reason'), args.includes('--leftovers'));
  }
  if (verb === 'note') return taskLeft(id, undefined, flag('body') ?? text, undefined, false, undefined, true);
  return null;
}
/* `copied`: the board reply's copied ids for a typed tool (null when the reply had none), as leftUndone reads it */
export function leftCalls(tool, input, copied) {
  const t = toolName(tool);
  const i = input && typeof input === 'object' ? input : {};
  const one = (hit) => (hit ? [hit] : []);
  if (t === 'task_update') return one(taskLeft(String(i.id || ''), i.status, i.note, i.reason, leftGiven(i.leftovers), copied));
  if (t === 'note') return one(taskLeft(String(i.id || ''), undefined, i.body, undefined, false, copied, true));
  if (t !== 'Bash' && t !== 'PowerShell') return [];
  const text = String(i.command || '');
  if (!isHubShell(text)) return [];
  return commandsOf(text, { keepCase: true }).cmds.map((w) => hubLeft(w, text)).filter(Boolean);
}

/* The words for a hit, the task's status after the call deciding a note's; null when it stays quiet.
   `waits` quiets an open record's note: on a task whose ended run the stop held, why it waits is what was asked. */
export function leftNote(hit, status, waits = false) {
  if (!hit) return null;
  const home = 'Give it the nearest home that comes back on its own: ';
  const unless = '; or say the user dropped it.';
  const said = '("' + hit.said + '")';
  /* a real place on the held track lands; any other place asks the user first */
  const elsewhere = 'place with the place you want and here, which asks the user first';
  if (hit.kind === 'track') {
    return 'AskerDo: ' + hit.id + ' closed with ' + (hit.field === 'reason' ? 'a reason' : 'an outcome') + ' that names something left ' + said
      + ', which nothing brings back from a closed track. ' + home + 'a task at a real place on a track you hold, else ' + elsewhere + unless;
  }
  if (hit.kind === 'note') {
    if (!CLOSING.includes(status)) {
      if (waits || hit.closedOnly) return null;
      /* never a refusal; the note stands and the answer names the calls that come back */
      const step = /^T-\d+$/.test(hit.id) ? 'a step on ' + hit.id + ' or the task in hand' : 'a step on the task in hand';
      return 'AskerDo: the note on ' + hit.id + ' names something left ' + said + ', and a note asks for nothing, so nothing brings it back. The note is written; '
        + 'give what it names a home too: ' + step + ' (task_update checks.add), place for work past that task (at a real place on your track; anywhere else asks the user first), '
        + 'ask for what only the user can decide, or fact for a fact a later session needs.';
    }
    return 'AskerDo: the note on ' + hit.id + ', which is ' + status + ', names something left ' + said + ', and a closed task\'s note never comes back. '
      + home + 'a task at a real place on your track, else ' + elsewhere + unless;
  }
  return 'AskerDo: ' + hit.id + ' closed with words that name something left ' + said + ' and no leftover filed. '
    + home + 'leftovers on this close (its status again, with the leftovers), a task at a real place on your track, else ' + elsewhere + unless;
}

/* the reply closed finished, the flag the handoff check above reads. */
export function closedFinished(answer) {
  const reply = String(answer || '');
  const foot = footerOf(reply);
  return foot ? foot.glyph === FLAG : forecastOf(firstLine(reply)) === FLAG;
}

/* The reply waits on the user. The pick: its footer needs the user or holds a question block,
   or the last paragraph outside code has a sentence ending in "?" */
export function replyAsks(answer) {
  const reply = String(answer || '');
  const foot = footerOf(reply);
  if (foot && (foot.glyph === HAND || /^\s*[*_]*\s*(?:Q\d+|L\d+)\b/m.test(foot.body))) return true;
  const paras = prose(reply).split(/\r?\n\s*\r?\n/).map((p) => p.trim()).filter(Boolean);
  return /\?["')\]*_]*(?=\s|$)/.test(paras[paras.length - 1] || '');
}

/* The dispatch checks: flagged, never blocked, and only where rules are in
 * force, each by its profile key. A brief file the prompt points at carries the state note itself. */
const SIZE_RULE = /\b(?:under|at most|max(?:imum)?|no more than|within|below|fewer than|less than)\s*(?:about\s*)?~?[\d,.]+\s*k?\s*(?:characters|chars|words|lines|tokens)\b/i;
export function agentChecks(input, { briefs = [], rules = null, inject = true, lanes = [] } = {}) {
  if (!rules) return [];
  const p = input && typeof input === 'object' ? input : {};
  const prompt = String(p.prompt || '');
  const slips = ruleConflicts([prompt, ...briefs].join('\n'), rules);
  /* a brief fits when one agent finishes it; one that handed work on to another was too big */
  for (const l of lanes || []) {
    if (l && l.handedOn === true) slips.push({ id: 'lane ' + l.task, say: 'the last lane of ' + l.task + ' handed its work on to another agent, so its brief was too big for one: size this one so one agent finishes it' });
  }
  if (rules['dispatch.stateNote'] !== false && !/-state\.md\b/.test(prompt) && !/\bbriefs?\b[^\n]*\.md\b/i.test(prompt)) slips.push({ id: 'state', say: 'the brief names no -state.md note' });
  /* the injection carries the size rule, so a brief needs its own only when it is off */
  if (inject === false && rules['dispatch.outputRule'] !== false && !SIZE_RULE.test(prompt)) slips.push({ id: 'size', say: 'the brief has no output-size rule' });
  if (TESTS_NAMED.test(prompt) && !testingRule(prompt)) {
    slips.push({ id: 'tests', say: 'the brief runs tests without the testing rule: while working, only the test files touched; one full run, at the end' });
  }
  return slips;
}

/* A brief that runs tests carries the rule, its two clauses in any words, or points at the
 * procedure or a brief file that does. */
/* a brief that runs or writes tests, never the word alone ("the desktop test session") */
const TEST_WORD = String.raw`(?:tests?|suite)\b(?!\s+(?:session|sitting|board|pc|machine|account|server|store|repo|project|user|data|env\w*|rig|harness)\b)`;
const TESTS_NAMED = new RegExp(String.raw`\bnode --test\b|\brun-tests\.mjs\b|\bnpm (?:run )?test\b|\.test\.[cm]?[jt]sx?\b`
  + String.raw`|\b(?:re)?(?:run|runs|running|write|writes|add|adds|extend|extends|update|updates|fix|fixes)\b[^.\n]{0,40}?\b` + TEST_WORD
  + String.raw`|\btests? (?:pass|passes|fail|fails|files?|suites?|counts?)\b|\b(?:the|a|its) (?:full |whole )?(?:test )?suite\b`, 'i');
const TARGETED = /\b(?:targeted|(?:test )?(?:files?|tests?) (?:you|it|they) (?:touch|change|break))/i;
const ONE_FULL = /\b(?:one (?:full|whole|entire) (?:test )?(?:run|suite|gate)|(?:(?:do not|don't|never) run|skip|no) (?:the )?(?:full|whole|entire) (?:test )?(?:run|suite|gate)|(?:full|whole|entire) (?:test )?(?:run|suite|gate)\b[^.\n]{0,40}?\b(?:once|(?:only )?at the end|before (?:your|the) (?:last|final) commit))/i;
const testingRule = (prompt) => /run-tests\.md\b/.test(prompt) || /\bbriefs?\b[^\n]*\.md\b/i.test(prompt)
  || (TARGETED.test(prompt) && ONE_FULL.test(prompt));

export const AGENT_TOOLS = ['Agent', 'Task'];

/* a brief line that contradicts a rule in force; a line that negates
 * (never, no, not, skip) states the rule rather than breaking it. */
const CONFLICTS = [
  { key: 'tests.policy', when: (v) => v === 'few', say: 'asks for a test per item while tests.policy is few',
    re: /\b(?:a|one) tests? (?:for|per) (?:each|every) (?:item|fix|change|case|step)\b|\btests? for (?:each|every) (?:item|fix)\b/i },
  { key: 'tests.policy', when: (v) => v === 'off', say: 'asks for tests while tests.policy is off', re: /\b(?:add|write) (?:a |new |more )?tests?\b/i },
  { key: 'tests.fullRun', when: (v) => v === 'never' || v === 'merge', say: 'runs the full suite while tests.fullRun is not end',
    re: /\brun the full (?:suite|node --test)\b|\bfull suite (?:once|at the end)\b/i },
  { key: 'tests.fullRun', when: (v) => v !== 'never', say: 'runs the full suite more than once',
    re: /\b(?:before|after) (?:each|every) (?:item|fix|change|commit)\b[^\n]*\bfull (?:suite|run)\b|\bfull (?:suite|run)\b[^\n]*\b(?:before|after) (?:each|every)\b/i },
  /* only a line asking for a test that pins; golden fixtures pin bytes by design */
  { key: 'tests.pinWording', when: (v) => v === false, say: 'pins exact wording while tests.pinWording is off',
    re: /\b(?:add|write|extend|assert)\w*\b[^\n]*\btests?\b[^\n]*\bpin(?:s|ning)?\s+(?:the\s+)?(?:exact\s+)?(?:wording|bytes|text|output)\b/i,
    skip: /\b(?:regenerat\w*|golden|fixtures?)\b/i },
];
const NEGATED = /\b(?:never|no|not|don't|do not|instead of|avoid|skip)\b/i;

export function ruleConflicts(text, rules) {
  const out = [];
  const lines = String(text || '').split('\n').filter((l) => !NEGATED.test(l) && !l.includes('Rules in force (AskerDo rev '));
  for (const c of CONFLICTS) {
    if (rules[c.key] === undefined || !c.when(rules[c.key]) || out.some((x) => x.id === 'rule ' + c.key)) continue;
    const hit = lines.find((l) => c.re.test(l) && !(c.skip && c.skip.test(l)));
    if (hit) out.push({ id: 'rule ' + c.key, say: 'a brief line ' + c.say + ' ("' + hit.trim().slice(0, 60) + '")' });
  }
  return out;
}

/* The first run of task ids in a line's first sentence, never the ids after it. */
const sentenceOf = (line) => String(line || '').split(/[.!?:](?:\s|$)/)[0];
function leadIds(line) {
  const s = sentenceOf(line);
  const first = /\bT-\d+\b/.exec(s);
  if (!first) return [];
  const out = [first[0]];
  const chain = /^\s*(?:,|&|\+|\/|and\b|or\b)?\s*(T-\d+)\b/i;
  for (let rest = s.slice(first.index + first[0].length), m; (m = chain.exec(rest)); rest = rest.slice(m[0].length)) out.push(m[1]);
  return out;
}

/* a heading's ids may follow its title's colon ("# Fix lane "x": T-1 and T-2"): its first part that leads with any */
function headingIds(text) {
  const head = String(text || '').split(/\r?\n/).find((l) => /^#{1,6}\s/.test(l)) || '';
  for (const part of head.split(/[.!?:](?:\s|$)/)) { const ids = leadIds(part); if (ids.length) return ids; }
  return [];
}

/* the tasks a dispatch serves: the ids leading its description, title and opening
   sentence; else a brief file's heading, all of it when the prompt names no task, and
   only the ids the opening line also names when it does; else `tagged`, the
   tasks of the session's own open agent runs of that job. Ids listed as data never count. */
export function tasksOfDispatch(input, briefs = [], tagged = []) {
  const p = input && typeof input === 'object' ? input : {};
  const lines = String(p.prompt || '').split(/\r?\n/).filter((l) => l.trim());
  const opening = lines.length && /^\s*#/.test(lines[0]) ? [lines[0], lines[1]] : [lines[0]];
  let ids = [p.description, ...opening].flatMap(leadIds);
  if (!ids.length) {
    const named = /\bT-\d+\b/.test(String(p.prompt || '') + ' ' + String(p.description || ''));
    const said = new Set(opening.join(' ').match(/\bT-\d+\b/g) || []);
    ids = (briefs || []).flatMap(headingIds).filter((id) => !named || said.has(id));
  }
  return [...new Set(ids.length ? ids : tagged || [])];
}

/* a top-level dispatch whose words hold task ids the mod reads none of opens no run; the
   session hears it with the call's own answer, not at the agent's end */
export function dispatchMissed(input, tasks) {
  const p = input && typeof input === 'object' ? input : {};
  if ((tasks || []).length || p.resume) return '';
  const ids = [...new Set((String(p.description || '') + ' ' + String(p.prompt || '')).match(/\bT-\d+\b/g) || [])];
  if (!ids.length) return '';
  return 'AskerDo: this dispatch opened no run on the board, though its words name ' + ids.slice(0, 4).join(', ') + (ids.length > 4 ? ' and more' : '')
    + ': the mod reads a dispatch\'s tasks only from the ids leading its description or its prompt\'s first sentence'
    + ' ("T-5 and T-6 are your tasks: ..."), or from the heading of the brief file it names when the opening line names them too; ids further down are data.'
    + ' Take each task this agent serves in hand (task_update with inHand) so the board reads it running, and lead the next dispatch with its ids.';
}

/* a lane met the bar when its agent finished
   the brief, and was too big when it handed work on (a CONTINUE line naming
   more than none). The journal note says which; the read parses the latest back. */
const kTokens = (n) => Math.round(n / 1000) + 'k';
export function handedOn(text) {
  const all = [...String(text || '').matchAll(/^\s*CONTINUE:\s*(.*)$/gm)];
  if (!all.length) return null;
  /* "done", "nothing left" and "lane complete" are finished lines too */
  return !/^(?:none\b|nothing left\b|lane complete\b|done\s*(?:$|[;.,:(]))/i.test(all[all.length - 1][1].replace(/^[\s*_`]+/, '').trim());
}
/* The last CONTINUE line itself, trimmed, or '' */
export function continueLineOf(text) {
  const all = [...String(text || '').matchAll(/^\s*(CONTINUE:.*)$/gm)];
  return all.length ? all[all.length - 1][1].trim().slice(0, 1000) : '';
}
/* A run's end from the engine's word: failed is failed, a stop (killed) hands on, else
   the CONTINUE line says (handedOn) */
export function runEndHow(word, handed = null) {
  const w = String(word || '');
  if (w === 'failed') return 'failed';
  /* held: the 30 minute bound ended a real wait, whose report comes later */
  if (w === 'killed' || w === 'stopped' || w === 'held') return 'handed_on';
  return handed === true ? 'handed_on' : 'finished';
}
/* The state note a dispatch names, the first -state.md path in its prompt or brief texts, as written */
export function stateNoteNamed(texts) {
  for (const t of Array.isArray(texts) ? texts : [texts]) {
    for (const m of String(t || '').matchAll(/(?:[A-Za-z]:[\\/]|\/)?[\w.~-]+(?:[\\/][\w.~-]+)*\.md\b/g)) if (isStateNotePath(m[0])) return m[0].replace(/\\/g, '/');
  }
  return '';
}
/* A task block (task block --json) read after a run of `mine` (this process's session ids) ended
   is settled once the task ended, waits (an edge, a gate, a question), another worker's run is on it, or a
   typed note is dated after that end (the session wrote why it waits); a block that did not come back is settled */
export function blockSettled(b, endedAt, mine = []) {
  if (!b || typeof b !== 'object' || !b.id) return true;
  if (['done', 'dropped'].includes(b.status)) return true;
  const w = b.word || {};
  if (['done', 'dropped', 'waiting'].includes(w.is)) return true;
  if (['running', 'unconfirmed'].includes(w.is) && (w.worker === 'agent' || !mine.includes(w.session))) return true;
  const end = Date.parse(endedAt || '');
  return Number.isFinite(end) && listOf(b.notes).some((n) => n && Date.parse(n.at) > end);
}

/* What an ended run leaves to settle, read from its tasks' blocks: each task with its open
   steps by number and the one call that settles it; `runs` the ended runs ({ run, job, how, session, tasks }),
   `older` this process's earlier session ids, whose run a close takes over (the board refuses it otherwise) */
/* a name cut at a word, with a mark, so a cut inside its own parentheses still reads as cut */
const cutAt = (s, max) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const c = t.slice(0, max - 3);
  const at = c.lastIndexOf(' ');
  const whole = t[max - 3] === ' ' || at <= max / 2;
  return (whole ? c : c.slice(0, at)).replace(/[\s,;:.(]+$/, '') + '...';
};
export function settleWords(blocks, runs = [], older = []) {
  const list = listOf(blocks).filter((b) => b && b.id);
  if (!list.length) return '';
  const flat = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const runOf = (id) => listOf(runs).find((r) => r && listOf(r.tasks).some((t) => (t && (t.id || t)) === id)) || null;
  const lines = list.map((b) => {
    const r = runOf(b.id);
    const who = r ? (r.worker === 'session' ? 'this session\'s run' : 'agent ' + (cutAt(r.job, 80) || 'with no job name')) + (r.how ? ' (' + String(r.how).replace('_', ' ') + ')' : '') : 'its last run';
    const steps = listOf(b.steps).filter((s) => s && Number.isInteger(s.n));
    const take = r && r.session && older.includes(r.session) ? ', "takeOver": true' : '';
    const open = steps.length ? ' Open steps: ' + steps.map((s) => s.n + '. ' + cutAt(s.text, 160)).join('; ') + '.' : ' No step is open.';
    if (b.word && b.word.is === 'unconfirmed') {
      return b.id + ' (' + cutAt(b.name, 100) + '): ' + who + ' went silent.' + open + ' If its agent is gone, task_update { "id": "' + b.id + '", "runEnded": "handed_on" } ends that run and leaves the task open.';
    }
    const call = 'task_update { "id": "' + b.id + '"' + (steps.length ? ', "checks": { "done": [' + steps.map((s) => s.n).join(', ') + '] }' : '') + ', "status": "done"' + take + ' }';
    /* a stopped agent leaves no report, so the words never send the session to look for one */
    const bare = r && (r.noReport === true || (Object.prototype.hasOwnProperty.call(r, 'report') && !r.report));
    const where = bare ? [r.stateNote ? 'its state note ' + flat(r.stateNote).slice(0, 300) : '', r.branch ? 'its branch ' + flat(r.branch).slice(0, 200) : ''].filter(Boolean).join(' and ') : '';
    return b.id + ' (' + cutAt(b.name, 100) + '): ' + who + ' ended.' + open
      + (bare ? ' It left no report: read ' + (where || 'what it committed') + ' for what it did, then settle it: ' : ' Settle it against the report: ') + call
      + (steps.length ? ', striking a step not done with checks.strike [{ "step", "why" }] or moving it with moveSteps' : '')
      + '; or, when the work goes on, a note on ' + b.id + ' saying why it waits, or a new dispatch naming it.';
  });
  return 'AskerDo: ' + (lines.length === 1 ? 'a run ended and its task is not settled. ' : 'runs ended and their tasks are not settled.\n') + lines.join('\n');
}

/* The stop's two refusals; the engine marks the next stop, which goes through */
const AGAIN = ' If you stop again, the stop goes through.';
export function stopSettleWords(settle) {
  return String(settle || '').replace(/^AskerDo: /, 'AskerDo held this stop: ') + '\nSettle each now, or write on the task why it waits.' + AGAIN;
}
export function stopReadyWords(ready, track) {
  const list = listOf(ready).filter((t) => t && t.id);
  return 'AskerDo held this stop: ' + (track || 'the track you hold') + ' has ready work nothing is running: '
    + list.map((t) => t.id + ' (' + cutAt(t.name, 100) + ')').join('; ') + '. Start what makes sense for this session (dispatch an agent naming it, '
    + 'or task_update { "id", "inHand": true }); leaving it is your judgment, and it stays ready on the track. Each task is named once a session. '
    + 'If the user said to hold, record it with decide, labels ["hold"], on this track with the user\'s words.' + AGAIN;
}
/* What a dispatch adds after the task blocks: the last run on each task (from taskRuns, newest
   first), the run details, and the two instructions; one block, so withDecisions appends it once */
export function dispatchRunBlock({ found = [], job = '', place = {}, stateNote = '', now = Date.now() } = {}) {
  const tasks = listOf(found).filter((f) => f && f.task);
  if (!tasks.length) return '';
  const flat = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const lastLine = (f) => {
    const r = listOf(f.runs).find((x) => x && x.ended);
    if (!r) return '- Last run on ' + f.task + ': none; this is its first.';
    const who = r.worker === 'agent' ? 'agent ' + (cutAt(r.job, 80) || 'with no job name') : 'a session';
    const ago = Date.parse(r.ended);
    /* a session the app closed is named with no cause */
    const how = r.how === 'closed_idle' ? 'closed by the app' : String(r.how || 'ended').replace('_', ' ');
    return '- Last run on ' + f.task + ': ' + who + ', ' + how
      + (Number.isFinite(ago) ? ', ' + runTime(Math.max(0, now - ago)) + ' ago' : '')
      + (r.continueLine ? '; ' + flat(r.continueLine).slice(0, 300) : '') + (r.stateNote ? '; state note ' + r.stateNote : '') + '.';
  };
  /* an isolated agent's worktree is cut after this prompt is written, so it is named by what it is */
  const own = place.isolated && !place.repo ? 'repo, branch and start commit: your own worktree, which the engine cuts as you start (git there names them)' : '';
  const details = [job ? 'job ' + flat(job).slice(0, 120) : '', own, place.repo ? 'repo ' + place.repo : '', place.branch ? 'branch ' + place.branch : '',
    place.startCommit ? 'start commit ' + String(place.startCommit).slice(0, 12) : '', stateNote ? 'state note ' + stateNote : ''].filter(Boolean);
  return 'Run details for this dispatch (AskerDo; copy them into the head of your state note):\n'
    + (details.length ? '- ' + details.join('; ') + '.\n' : '') + tasks.map(lastLine).join('\n')
    + '\nReport on each open step of your task by its number: done, with the evidence, or not done and why. The session ticks the steps; an agent\'s own task writes are refused.';
}

const FIT = { true: 'handed work on to another agent: too big for one', false: 'finished its brief', null: 'no CONTINUE line' };
export function laneNote(tokens, agent, handed = null) {
  return 'Lane size: ' + kTokens(tokens) + ' tokens of context (agent ' + String(agent || 'unnamed').slice(0, 60) + '); ' + FIT[String(handed)] + '.';
}
export function latestLane(journal) {
  let lane = null;
  for (const m of String(journal || '').matchAll(/\bLane size: (\d+)k tokens[^\n]*/g)) {
    lane = { tokens: Number(m[1]) * 1000, handedOn: m[0].includes(FIT.true) ? true : m[0].includes(FIT.false) ? false : null };
  }
  return lane;
}

/* Up to three .md files the prompt names that sit under the project. */
export function briefPaths(prompt, cwd) {
  const base = String(cwd || '').replace(/\\/g, '/').replace(/\/+$/, '');
  const out = [];
  if (!base) return out;
  for (const m of String(prompt || '').matchAll(/(?:[A-Za-z]:[\\/]|\/)?[\w.~-]+(?:[\\/][\w.~-]+)*\.md\b/g)) {
    let f = m[0].replace(/\\/g, '/');
    if (!/^[A-Za-z]:\//.test(f) && !f.startsWith('/')) f = base + '/' + f.replace(/^\.\//, '');
    if (!f.toLowerCase().startsWith(base.toLowerCase() + '/') || f.includes('/../') || out.includes(f)) continue;
    out.push(f);
    if (out.length === 3) break;
  }
  return out;
}

/* the agents' block for a dispatch's roles, built as the board builds it */
export { agentsBlockFor, dispatchRoles } from '../server/rules-block.mjs';

/* The rules block appended once per revision; the brief's own words stay as written. */
export function withRules(prompt, r) {
  const p = String(prompt || '');
  if (!r || !r.inject || !r.text || !r.revision || p.includes('Rules in force (AskerDo rev ' + r.revision)) return p;
  return p + '\n\n' + r.text;
}

/* the fact tool's call, as knowledge new's arguments (a gotcha: a ruling is decide's); the body rides stdin */
const FACT_LISTS = { files: 'file', refs: 'ref', labels: 'label' };
export function factArgs(input) {
  const p = input && typeof input === 'object' && !Array.isArray(input) ? input : null;
  if (!p) return { error: 'fact takes an object: title and body' };
  const e = [];
  for (const k of Object.keys(p)) if (!['title', 'body', ...Object.keys(FACT_LISTS)].includes(k)) e.push('unknown field "' + k + '"');
  if (!isText(p.title) || !oneLine(p.title)) e.push('title is the fact, one line');
  if (!isText(p.body)) e.push('body is the fact in full');
  for (const k of Object.keys(FACT_LISTS)) if (p[k] !== undefined && !(Array.isArray(p[k]) && p[k].every(isText))) e.push(k + ' is a list');
  if (e.length) return { error: e.join('; ') };
  const args = ['knowledge', 'new', '--type', 'gotcha', '--title', p.title.trim()];
  for (const [k, flag] of Object.entries(FACT_LISTS)) for (const v of p[k] || []) if (v.trim()) args.push('--' + flag, v.trim());
  return { args, body: p.body.trim() };
}

/* ---- decisions ---- */

const DECIDE_LISTS = ['tasks', 'tracks', 'workstreams', 'files', 'commands', 'labels'];
const DECIDE_KEYS = ['title', 'words', 'body', 'question', 'supersedes', 'global', 'confirmed', ...DECIDE_LISTS];

/* The decide tool's input as the CLI's payload; the board checks that each id exists. */
export function decideArgs(input) {
  const p = input && typeof input === 'object' && !Array.isArray(input) ? input : null;
  if (!p) return { error: 'decide takes an object: title, and words, tasks, files, commands' };
  const e = [];
  for (const k of Object.keys(p)) if (!DECIDE_KEYS.includes(k)) e.push('unknown field "' + k + '"');
  if (!isText(p.title) || !oneLine(p.title)) e.push('title is the ruling, one line');
  for (const k of ['words', 'body', 'question']) if (p[k] !== undefined && !isText(p[k])) e.push(k + ' is text');
  for (const k of DECIDE_LISTS) if (p[k] !== undefined && !(Array.isArray(p[k]) && p[k].every(isText))) e.push(k + ' is a list');
  const sup = p.supersedes === undefined ? [] : [].concat(p.supersedes);
  if (!sup.every((s) => typeof s === 'string' && /^K-\d+$/.test(s.trim()))) e.push('supersedes is a K-n or a list of them');
  if (p.global !== undefined && typeof p.global !== 'boolean') e.push('global is true or false');
  if (p.confirmed !== undefined && typeof p.confirmed !== 'boolean') e.push('confirmed is true or false');
  if (e.length) return { error: e.join('; ') };
  const payload = {};
  for (const k of DECIDE_KEYS) if (p[k] !== undefined && k !== 'supersedes') payload[k] = typeof p[k] === 'string' ? p[k].trim() : p[k];
  if (sup.length) payload.supersedes = sup.map((s) => s.trim());
  return { payload };
}

const ruling = (d) => String(d.id) + ' ' + flatLine(d.name).replace(/[.\s]+$/, '');
/* a long quote keeps its whole sentences that fit, else none; never a word cut short */
const SENTENCE_END = /[.!?]+["')\]”’]*(?=\s|$)/g;
const quoted = (w, max) => {
  const s = flatLine(w);
  if (s.length <= max) return s;
  let cut = 0;
  for (const m of s.matchAll(SENTENCE_END)) { if (m.index + m[0].length > max) break; cut = m.index + m[0].length; }
  return s.slice(0, cut);
};

/* Words ending in a question back or a hedge leave the choice open; decide records and warns
   rather than refuses, so the session takes this path instead of an easier one. */
const OPEN_TAIL = /\b(?:perhaps|maybe|or something|what do you think)\b/i;
export function openWordsWarning(words, id, who = 'the user') {
  const s = flatLine(words).replace(/[\s"'\u201c\u201d\u2018\u2019)\].\u2026]+$/, '');
  if (!s || !(/\?$/.test(s) || OPEN_TAIL.test(s.split(/(?<=[.!?])\s+/).pop()))) return '';
  return 'The words end in a question or an opening, so they leave the choice open: ' + id + "'s title states only what " + who
    + ' settled, the rest goes in its body as the session\'s picks (knowledge edit ' + id + ' --name, --body), or ask ' + who + '.';
}

/* What the decide tool answers, from the CLI's JSON. */
export function decidedText(r) {
  const on = [...(r.tasks || []), ...(r.tracks || []), ...(r.workstreams || [])];
  const gov = [...(r.files || []), ...(r.commands || [])];
  return ruling(r) + ' recorded' + (on.length ? ' on ' + on.join(', ') : '')
    + ((r.superseded || []).length ? '; it supersedes ' + r.superseded.join(', ') : '') + '.'
    + (gov.length ? ' A call touching ' + gov.join(', ') + ' now gets its pointer.' : '')
    /* links left out take the turn's commands only; a file is governed when named */
    + (r.proposed ? ' Files and commands were left out, so it governs the commands this turn ran and no file: askerdo knowledge edit '
      + r.id + ' --add-file <glob> adds a file it governs, --remove-command "<command>" takes one off.' : '')
    + (r.answered ? ' ' + r.answered + ' is answered with it.' : '') + (r.warning ? ' ' + r.warning + '.' : '')
    + (r.wordsWarning ? ' ' + r.wordsWarning : '');
}

/* The one line a call touching a ruling gets, once a loop. */
export function decisionNote(d, why) {
  const words = d.words && !d.confirmed ? quoted(d.words, 300) : '';
  return 'AskerDo decision pointer (nothing was blocked): ' + why + ': decision ' + d.id + ' (' + ruling(d).slice(String(d.id).length + 1) + ') governs it.'
    + (words ? ' ' + capFirst(nameOf()) + ' said: "' + words + '"' + (/[.!?]$/.test(words) ? '' : '.') : '')
    + ' Hold to it; going against it needs ' + nameOf() + "'s say first."
    + (d.gist || listOf(d.amends).length ? ' Its body: ' + bodyWords(d) + ' (askerdo show ' + d.id + ' reads it whole)' : '');
}

/* A ruling's body as the pointer and the brief quote it: its first sentence, then each amend. */
const bodyWords = (d) => [d.gist ? quoted(d.gist, 240) : '', ...listOf(d.amends).map((a) => quoted(a, 300))].filter(Boolean).join(' ');

/* the one line an edit touching a knowledge record's files gets, once a loop. */
export function knowledgeNote(k, why) {
  return 'AskerDo knowledge pointer (nothing was blocked): ' + why + ': knowledge ' + k.id + ' (' + ruling(k).slice(String(k.id).length + 1) + ') is about it;'
    + ' askerdo show ' + k.id + ' reads it whole.';
}

/* the records one call matched ({ decision, why, fact }), as the notes it carries:
   three or fewer each in full, more as one block of titles, since a large shared file
   matches many rulings that were never about the code being edited */
export const POINTERS_FULL = 3;
export function pointerNotes(told, subject) {
  const list = listOf(told).filter((h) => h && h.decision && h.decision.id);
  if (list.length <= POINTERS_FULL) return list.map((h) => (h.fact ? knowledgeNote(h.decision, h.why) : decisionNote(h.decision, h.why)));
  const ruled = list.some((h) => !h.fact);
  return ['AskerDo pointers (nothing was blocked): ' + list.length + ' records match ' + (subject || 'this call') + ':\n'
    + list.map((h) => '- ' + (h.fact ? 'knowledge ' : 'decision ') + ruling(h.decision)).join('\n')
    + '\n' + (ruled ? 'Hold to the decisions that bear on this change; going against one needs ' + nameOf() + "'s say first. " : '')
    + 'askerdo show K-n reads one whole.'];
}

/* one toast per call; one record names itself, several are counted */
export function pointerToast(told, subject) {
  const list = listOf(told).filter((h) => h && h.decision && h.decision.id);
  if (!list.length) return '';
  if (list.length === 1) {
    const h = list[0];
    return (h.fact ? 'Knowledge ' + h.decision.id + ' is about this file: ' : 'Decision ' + h.decision.id + ' applies: ') + h.decision.name;
  }
  const n = list.filter((h) => !h.fact).length;
  const k = list.length - n;
  const count = (c, one, many) => c + ' ' + (c === 1 ? one : many);
  return [n ? count(n, 'decision', 'decisions') : '', k ? count(k, 'knowledge record', 'knowledge records') : ''].filter(Boolean).join(' and ')
    + ' apply to ' + (subject || 'this call');
}

/* an edit's answer, one wording for the CLI and the tool: a hand that moved
 * leads in its own words, the other changes after it. */
export function editWords(r, unchanged) {
  const hand = r.hand === 'taken' ? ' taken in hand' : r.hand === 'let go' ? ' let go' : '';
  const rest = (r.changed || []).filter((k) => !(hand && k === 'inHand'));
  return r.id + hand + (rest.length ? (hand ? ', ' : ' ') + 'updated: ' + rest.join(', ') : hand ? '' : unchanged);
}

/* Where each leftover of a close went, as the CLI and task_update say it. */
export function filedWords(left) {
  const list = Array.isArray(left) ? left.filter((t) => t && t.id) : [];
  if (!list.length) return '';
  return 'filed ' + list.map((t) => t.id + ' (' + (t.tier !== undefined ? 'tier ' + t.tier + ', ' : '') + (t.inbox ? 'inbox' + (t.wake ? ', wakes ' + t.wake : '') + (t.asked ? ', with the user as ' + (typeof t.asked === 'object' ? t.asked.id : t.asked) : '')
    : 'on ' + t.track + (t.parked ? ', a new track that opens ' + t.opens : '')) + (t.created === false ? ', already there' : '') + ')').join(', ');
}

/* The rulings on a task just taken in hand, under the tool's result. */
export function heldDecisionsNote(id, decisions) {
  const list = Array.isArray(decisions) ? decisions.filter((d) => d && d.id) : [];
  if (!list.length) return '';
  return 'Decisions in force on ' + id + ' (askerdo show K-n reads one whole):\n' + list.map(ruling).join('\n');
}

/* The rulings on a dispatch's tasks, after the rules block: one line each, none, nothing. */
const decisionList = (decisions) => {
  const list = [];
  for (const d of Array.isArray(decisions) ? decisions : []) if (d && d.id && !list.some((x) => x.id === d.id)) list.push(d);
  return list;
};
/* the decisions a dispatch's briefs show, which count as read by its session: every one a
   task block tells (its own and a review's covered tasks'), and the decisions block's first `max` */
const listOf = (v) => (Array.isArray(v) ? v : []);
export const briefDecisionIds = (blocks, shown = [], max = 10) => decisionList([
  ...listOf(blocks).flatMap((b) => (b ? [...listOf(b.decisions), ...listOf(b.covers && b.covers.tasks).flatMap((a) => listOf(a && a.decisions))] : [])),
  ...decisionList(shown).slice(0, max),
]).map((d) => d.id);

export function decisionsBlock(tasks, decisions, max = 10) {
  const list = decisionList(decisions);
  if (!list.length) return '';
  /* a confirmed ruling is carried by its title and K-n; the words stay in its record */
  const lines = list.slice(0, max).map((d) => '- ' + ruling(d) + (!d.confirmed && d.words && quoted(d.words, 200) ? ': "' + quoted(d.words, 200) + '"' : '')
    + (d.gist || listOf(d.amends).length ? '\n  body: ' + bodyWords(d) : ''));
  if (list.length > max) lines.push('- and ' + (list.length - max) + ' more: askerdo decisions --task T-n reads them');
  return 'Decisions in force on ' + tasks.join(', ') + ' (AskerDo; hold to them, and say in your report before going against one; askerdo show K-n reads one whole):\n' + lines.join('\n');
}

export function withDecisions(prompt, block) {
  const p = String(prompt || '');
  return !block || p.includes(block.split('\n')[0]) ? p : p + '\n\n' + block;
}

/* The task blocks the board gave for a dispatch's tasks, under one head, so the brief is
   checked against what each task holds now, not only the orchestrator's retelling. */
export function taskBlocks(texts) {
  const list = (Array.isArray(texts) ? texts : []).filter((t) => typeof t === 'string' && t.trim());
  if (!list.length) return '';
  return 'What each task this dispatch serves holds now (AskerDo, read from the board):\n\n'
    + list.map((t) => t.trim()).join('\n\n');
}

export const flagLine = (what, slips) => 'AskerDo: ' + what + ': ' + slips.map((s) => s.say).join('; ') + '. Flagged, not rewritten.';

export function flagNote(items) {
  /* two dispatches of one name with the same flags are said once, with a count */
  const said = new Map();
  for (const x of items) {
    const text = x.slips.map((s) => s.say).join('; ');
    const key = x.what + '\n' + text;
    const had = said.get(key);
    if (had) had.n += 1; else said.set(key, { what: x.what, text, n: 1 });
  }
  return 'AskerDo contract check (a flag; nothing was rewritten): '
    + [...said.values()].map((x) => x.what + (x.n > 1 ? ' (' + x.n + ' times)' : '') + ': ' + x.text).join('. ')
    + '. Take it into the next reply without remarking on it unless ' + nameOf() + ' asks.';
}

/* a surface's drawing counted as the desktop page counts it before applying one (app 5.1231.2.0,
   read from en, dn, cn and mn in its page script). A drawing at or past any bound is dropped without a
   word and the old one stays, its Buttons dead; where the page's rule is unclear this counts the stricter way */
/* text: the engine's own room (its reference, 2.1.321): a tree draws the first 100,000 characters of its texts and past
   them cuts the text and drops a Button, Link or Client whole */
export const PAGE_BOUNDS = { nodes: 2000, depth: 32, chars: 262144, text: 100000 };
/* the mod's own ceiling, 90 percent of each, and where a timing row says a drawing came near, 80 */
export const DRAW_CEILING = { nodes: 1800, depth: 28, chars: 235929, text: 90000 };
export const DRAW_NEAR = { nodes: 1600, depth: 25, chars: 209715, text: 80000 };
export const countsUnder = (c, b) => c.nodes < b.nodes && c.depth < b.depth && c.chars < b.chars && !(c.text >= b.text);
const strLen = (v) => (typeof v === 'string' ? v.length : typeof v === 'number' ? String(v).length : 0);
/* the page's on(): each prop's name and its string value; children and closures never reach it */
function propChars(o) {
  let n = 0;
  if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) if (k !== 'children' && typeof v !== 'function') n += k.length + (typeof v === 'string' ? v.length : 0);
  return n;
}
/* nodes: elements and strings (a string under a Box counts its Text wrapper too, a null child one node);
   depth: levels; chars: the strings each element carries, by the page's rule per type */
export function pageCounts(tree, plugin = 'askerdo') {
  const pl = plugin.length;
  const out = { nodes: 0, depth: 0, chars: 0, text: 0 };
  const sum = (...v) => v.reduce((s, x) => s + strLen(x), 0);
  const walk = (n, inBox) => {
    if (Array.isArray(n)) { let d = 0; for (const c of n) d = Math.max(d, walk(c, inBox)); return d; }
    if (typeof n === 'string' || typeof n === 'number') { out.nodes += inBox ? 2 : 1; out.chars += strLen(n); out.text += strLen(n); return inBox ? 2 : 1; }
    if (!n || typeof n !== 'object') { out.nodes += 1; return 1; }
    const p = n.props || {};
    const key = n.key ?? p.key;
    const topKey = n.key !== undefined && p.key === undefined ? 3 + strLen(n.key) : 0;
    const press = n.press && typeof n.press.plugin === 'string' ? n.press.plugin.length : pl;
    let c = 0, extra = 0;
    switch (n.type) {
      case 'engine': case 'fragment': break;
      case 'Button': c = sum(key, p.label, p.hotkey, p.action) + press + propChars(n.hover); break;
      case 'Input': c = sum(key, p.label, p.placeholder, p.value, p.submitLabel) + press; break;
      case 'Select': { const o = Array.isArray(p.options) ? p.options : []; extra = o.length; c = sum(key, p.label, p.value) + press + o.reduce((s, x) => s + sum(x && x.value, x && x.label), 0); break; }
      case 'Link': c = sum(p.href, p.label); break;
      case 'Code': c = sum(p.source, p.language, p.path); break;
      case 'Markdown': { const l = Array.isArray(p.pressableLinks) ? p.pressableLinks : []; extra = l.length; c = sum(p.text, key, ...l) + press; break; }
      case 'Svg': c = sum(p.source, p.alt); break;
      case 'Client': c = sum(key, p.module) + pl + (JSON.stringify(p.props ?? null) ?? '').length; break;
      default: c = propChars(p) + topKey + propChars(n.hover) + (n.group ? pl : 0) + (n.part ? pl : 0);
    }
    out.nodes += 1 + extra;
    out.chars += c;
    /* the engine's text room: labels, alts, Code and Markdown texts, a Link's address, a Client's props */
    const props = n.type === 'Client' ? (JSON.stringify(p.props ?? null) ?? '').length : 0;
    const opts = n.type === 'Select' && Array.isArray(p.options) ? p.options.reduce((s, x) => s + sum(x && x.label), 0) : 0;
    out.text += sum(n.type === 'Button' || n.type === 'Input' || n.type === 'Select' || n.type === 'Link' ? p.label : '', n.type === 'Svg' ? p.alt : '',
      n.type === 'Code' ? p.source : '', n.type === 'Markdown' ? p.text : '', n.type === 'Link' ? p.href : '') + props + opts;
    const kids = n.children ?? p.children;
    if (n.type === 'Svg' || kids == null) return 1;
    return 1 + walk(kids, n.type === 'Box');
  };
  out.depth = walk(tree, false);
  /* the engine stamps the hook's root with its part */
  if (tree && typeof tree === 'object' && !Array.isArray(tree)) out.chars += pl;
  return out;
}

/* a Client's own tree as the desktop page takes it (app 5.11492.2.0, read from nm, tm and em in
   its page script). Past any of these, or any shape outside em, the page unmounts the instance with "returned
   a tree the page cannot draw"; the engine's own Client bounds are looser and allow Link, Code and Markdown */
export const CLIENT_PAGE = { chars: 262144, nodes: 2000, depth: 32, nesting: 66 };
const CLIENT_TAGS = new Set(['Box', 'Text', 'div', 'span', 'b']);
const primitive = (v) => typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));
const dropped = (c) => c === null || c === undefined || c === false || c === true;

/* the tree as the engine's exportTree hands it on: closures and undefined gone, a Button's children dropped */
function clientWire(n) {
  if (typeof n === 'string' || dropped(n) || typeof n !== 'object' || Array.isArray(n)) return n;
  const out = { type: n.type };
  if (n.props !== undefined) out.props = JSON.parse(JSON.stringify(n.props, (k, v) => (k === 'children' ? undefined : v)) ?? 'null');
  if (n.type !== 'Button' && Array.isArray(n.children)) out.children = n.children.filter((c) => !dropped(c)).map(clientWire);
  return out;
}

/* null when the page draws the tree, else the first reason it refuses it */
export function clientTreeProblem(tree) {
  const wire = clientWire(tree);
  const text = JSON.stringify(wire) ?? '';
  if (text.length > CLIENT_PAGE.chars) return 'a tree of ' + text.length + ' characters, past ' + CLIENT_PAGE.chars;
  /* tm: every typed object and every string in an array is a node; levels of typed objects and of all objects */
  let nodes = 0;
  const stack = [{ v: wire, depth: 0, nest: 0, child: true }];
  for (let e = stack.pop(); e; e = stack.pop()) {
    const obj = typeof e.v === 'object' && e.v !== null, typed = obj && 'type' in e.v;
    const depth = typed ? e.depth + 1 : e.depth, nest = obj ? e.nest + 1 : e.nest;
    nodes += typed || (e.child && typeof e.v === 'string') ? 1 : 0;
    if (nodes > CLIENT_PAGE.nodes) return 'a tree of more than ' + CLIENT_PAGE.nodes + ' nodes';
    if (depth > CLIENT_PAGE.depth) return 'a tree deeper than ' + CLIENT_PAGE.depth;
    if (nest > CLIENT_PAGE.nesting) return 'a tree nested past ' + CLIENT_PAGE.nesting;
    if (obj) for (const v of Object.values(e.v)) stack.push({ v, depth, nest, child: Array.isArray(e.v) });
  }
  /* em: the shapes the page draws */
  const check = (n) => {
    if (typeof n === 'string') return null;
    if (!n || typeof n !== 'object' || Array.isArray(n)) return 'a child that is not a string or an element';
    const p = n.props, t = n.type;
    if (t === 'Button' || t === 'Input' || t === 'Select') {
      if (!p || typeof p.key !== 'string' || !p.key.length || p.key.length > 256) return 'a ' + t + ' without a key of 1 to 256 characters';
      if (t === 'Button' && typeof p.label !== 'string') return 'a Button without a string label (' + p.key + ')';
      return null;
    }
    if (t === 'Svg') {
      const ok = p && typeof p.source === 'string' && p.source.length >= 1 && p.source.length <= 131072 && typeof p.alt === 'string' && p.alt.trim().length > 0
        && [p.width, p.height].every((x) => typeof x === 'number' && x > 0 && x <= 4096);
      return ok ? null : 'an Svg without its source, alt, width or height';
    }
    if (!CLIENT_TAGS.has(t)) return 'a ' + String(t) + ', which the page does not draw in a Client';
    if (p !== undefined) {
      if (!p || typeof p !== 'object' || Array.isArray(p)) return 'a ' + t + ' whose props are not an object';
      for (const [k, v] of Object.entries(p)) if (!primitive(v)) return 'a ' + t + ' prop ' + k + ' that is not a string, number or boolean';
    }
    for (const c of n.children || []) { const r = check(c); if (r) return r; }
    return null;
  };
  return check(wire);
}

