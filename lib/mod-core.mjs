/* The mod's pure half: validation, argument parsing and the
 * text the commands answer. No host access and no import but the pure handoff
 * check and the board's pure drawing, so the hooks module (no Node) and node --test
 * load the same files. */
import { FOCUS_MAX, LINE_MAX, STATE_BYTES, WHERE_BYTES, handoffProblems, isAbsolutePath, staleToolsLine } from './handoff-payload.mjs';
import { layoutGraph, layoutInput, linesTouching } from '../server/layout.mjs';
import { LEFT_WORDS, SKIN_PANE, diamondD, drawGraph, lineCounts, lineWords, padlock, paneStyle, reviewLegend, stripHead, stripSvg, stripWindows, viewCols } from '../server/web/draw.mjs';
import { graphOf, shortName, viewLook, viewNameOf } from '../server/web/graph.mjs';
import { MONTHS, atWords, cardHref, dayLabel, recordHref, signedRoot, feedEntry, feedMatches, feedRows, holderWords } from '../server/web/feed.mjs';

export { FOCUS_MAX, LINE_MAX, STATE_BYTES, WHERE_BYTES, isAbsolutePath };
export const DEPTH_MARKER = { soft: 350000, hard: 450000, remind: 25000 };
export const TASK_STATUSES = ['open', 'in_progress', 'blocked', 'deferred', 'dropped', 'completed'];
export const PRIORITIES = ['high', 'medium', 'low'];

const RECORD_ID = /^(Q\d+|WS-\d+|P-\d+|T-\d+|TH-\d+|TR-\d+|K-\d+)$/;

export const isRecordId = (s) => typeof s === 'string' && RECORD_ID.test(s);
export const isTrackId = (s) => typeof s === 'string' && /^TR-\d+$/.test(s);

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

/* a reversal is told alone, but one beside another ask of the turn is
 * flagged, never refused; the ids of `earlier` (this turn's told cards) it shares the turn with. */
export function aloneInTurn(payload, earlier) {
  /* an override that fixes or withdraws a ruling is a reversal too */
  const idOf = (c) => (c && c.override ? 'override #' + c.request : c && c.id);
  const reopens = (c) => (Array.isArray(c && c.revisits) && c.revisits.length > 0) || Boolean(c && c.override && c.reversal);
  /* a rewording names its own question, whose earlier telling is the same question */
  const self = payload && payload.edits;
  const asks = (earlier || []).filter((c) => idOf(c) && idOf(c) !== self);
  return [...new Set((reopens(payload) ? asks : asks.filter(reopens)).map(idOf))];
}

/* The turn-end note's slip for a reversal told beside another question. */
export function besideSlip(id, beside) {
  return { say: id + ' and ' + beside.join(', ') + ' were asked in one reply though a reversal is told alone;'
    + ' say so in the reply, and ask the next reversal in a reply of its own' };
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
const HANDOFF_KEYS = ['track', 'workstream', 'askedInChat', 'focus', 'state', 'whereWeWere', 'verifyFirst', 'waitingOnUser', 'rulings', 'status', 'parkReason', 'leftovers'];
const VERIFY_KEYS = ['path', 'branch', 'worktree', 'commit', 'expectedDirty', 'ownedByOthers', 'files'];
export const DISPOSITIONS = Object.freeze(['commit', 'ignore', 'delete', 'keep', 'undecided']);

/* The handoff budget is the CLI's own check (handoffProblems),
 * so tool and CLI refuse alike; the tool adds its keys, the track and status. */
/* `version`: the installed AskerDo's, named when a field is unknown */
export function validateHandoff(input, { name, version } = {}) {
  let p = input && typeof input === 'object' && !Array.isArray(input) ? input : null;
  if (!p) return { error: 'handoff_write takes an object: focus, state, verifyFirst' };
  const e = [];
  /* the user's ask in chat opens the gate and rides whereWeWere, so it stays visible */
  const said = typeof p.askedInChat === 'string' ? p.askedInChat.trim().replace(/^["“](.*)["”]$/s, '$1').trim() : '';
  if (p.askedInChat !== undefined && (!said || !oneLine(said) || said.length > 400)) e.push('askedInChat is ' + nameOf(name) + "'s words, quoted, one line of at most 400 characters");
  else if (said) {
    const line = capFirst(nameOf(name)) + ' asked for this handoff in chat: "' + said + '"';
    p = { ...p, whereWeWere: line + (isText(p.whereWeWere) ? '\n\n' + p.whereWeWere : '') };
  }
  for (const k of Object.keys(p)) if (!HANDOFF_KEYS.includes(k)) e.push('unknown field "' + k + '"');
  if (p.track !== undefined && !isTrackId(p.track)) e.push('track is a TR-n id');
  if (p.workstream !== undefined && !/^WS-\d+$/.test(p.workstream)) e.push('workstream is a WS-n id');
  e.push(...handoffProblems(p));
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
    });
  }
  if (p.status !== undefined && p.status !== 'waiting' && p.status !== 'parked') e.push('status is waiting or parked');
  if (p.status === 'parked' && !isText(p.parkReason)) e.push('a parked handoff needs parkReason');
  if (p.parkReason !== undefined && p.status !== 'parked') e.push('parkReason goes with status parked');
  if (e.some((x) => x.includes('unknown field'))) e.push(staleToolsLine(version));
  if (e.length) return { error: e.join('; ') };
  const { track, workstream, askedInChat, ...payload } = p;
  return { track, workstream, payload, ...(said ? { asked: true } : {}) };
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

/* blocked and deferred go unused on the board; waiting on a question is a gate */
export const BOARD_TASK_STATUSES = ['open', 'in_progress', 'dropped', 'completed'];

/* review_covers and coverage as the CLI's words, so the tool refuses what the board would. */
export function reviewCoversArgs(input) {
  const p = input && typeof input === 'object' && !Array.isArray(input) ? input : null;
  if (!p) return { error: 'review_covers takes an object: review, and tasks' };
  const e = [];
  for (const k of Object.keys(p)) if (!['review', 'tasks'].includes(k)) e.push('unknown field "' + k + '"');
  if (!(typeof p.review === 'string' && /^T-\d+$/.test(p.review.trim()))) e.push('review is the review task\'s T-n id');
  if (p.tasks !== undefined && !(Array.isArray(p.tasks) && p.tasks.every((t) => typeof t === 'string' && /^T-\d+$/.test(t.trim())))) e.push('tasks is a list of T-n ids');
  if (e.length) return { error: e.join('; ') };
  return { args: ['review', 'covers', p.review.trim(), ...(p.tasks || []).map((t) => t.trim())] };
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

/* task_update as `task update`'s flags, so the tool refuses what the board would. */
export function taskEditArgs(input) {
  const p = input && typeof input === 'object' && !Array.isArray(input) ? input : null;
  if (!p) return { error: 'task_update takes an object: id, and status, agent, priority, name or note' };
  const e = [];
  const known = ['id', 'status', 'agent', 'reason', 'priority', 'name', 'note', 'addLabels', 'removeLabels', 'inHand', 'takeOver'];
  for (const k of Object.keys(p)) if (!known.includes(k)) e.push('unknown field "' + k + '"');
  if (!(typeof p.id === 'string' && /^T-\d+$/.test(p.id))) e.push('id is a T-n id');
  if (p.status !== undefined && !BOARD_TASK_STATUSES.includes(p.status)) e.push('status is one of ' + BOARD_TASK_STATUSES.join(', '));
  if (p.agent !== undefined && (!isText(p.agent) || !oneLine(p.agent))) e.push('agent is the job name the dispatch carries, one line');
  if (p.agent !== undefined && p.status !== undefined && p.status !== 'in_progress') e.push('an agent works a running task: leave status out or give in_progress');
  if (p.reason !== undefined && !isText(p.reason)) e.push('reason is text');
  if (p.priority !== undefined && !PRIORITIES.includes(p.priority)) e.push('priority is one of ' + PRIORITIES.join(', '));
  if (p.name !== undefined && (!isText(p.name) || !oneLine(p.name))) e.push('name is one line of text');
  if (p.note !== undefined && !isText(p.note)) e.push('note is text');
  for (const f of ['addLabels', 'removeLabels']) {
    if (p[f] !== undefined && !(Array.isArray(p[f]) && p[f].every(isText))) e.push(f + ' is a list of labels');
  }
  if (p.inHand !== undefined && typeof p.inHand !== 'boolean') e.push('inHand is true or false');
  if (p.takeOver !== undefined && typeof p.takeOver !== 'boolean') e.push('takeOver is true or false');
  if (p.takeOver === true && p.inHand !== true) e.push('takeOver goes with inHand true');
  const args = [];
  /* true takes the task in hand for this session (it may hold several), false lets it go;
     one another session holds moves only with takeOver */
  if (p.inHand !== undefined) args.push(p.inHand ? '--in-hand' : '--let-go');
  if (p.takeOver === true) args.push('--take-over');
  if (p.agent !== undefined) args.push('--agent', p.agent.trim());
  if (p.status !== undefined) args.push('--status', p.status);
  if (p.reason !== undefined) args.push('--reason', p.reason);
  if (p.priority !== undefined) args.push('--priority', p.priority);
  if (p.name !== undefined) args.push('--name', p.name);
  for (const l of p.addLabels || []) args.push('--add-label', l);
  for (const l of p.removeLabels || []) args.push('--remove-label', l);
  if (p.note !== undefined && isText(p.note)) args.push('--note', p.note);
  if (!e.length && !args.length) e.push('nothing to change: give status, agent, priority, name, labels, inHand or a note');
  if (e.length) return { error: e.join('; ') };
  return { id: p.id, args, starts: p.agent !== undefined || p.status === 'in_progress' };
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
  '/askerdo proc <words> | proc ran <name> clean | proc ran <name> deviated "note" | proc scan: procedures (T-239)',
  '/askerdo allow K-n: your Allow on the override request holding that record',
  '/askerdo keep K-n: your Keep on the override request holding that record, left as written',
  '/askerdo unscrub K-n: put back the text a scrub removed, within 7 days',
  '/askerdo help: this list; the Guide tab (/askerdo guide) explains each part',
].join('\n');

const VERBS = ['home', 'questions', 'board', 'track', 'park', 'handoff', 'resume', 'pane', 'guard', 'proc', 'allow', 'keep', 'unscrub', 'guide', 'help'];
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
  if (VERBS.includes(verb)) return { verb, args: s.slice(word.length).trim() };
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

/* `/askerdo allow K-n`, `keep K-n`, `unscrub K-n`: the word, then a record (or a request's #n). */
export function parseOverride(verb, args) {
  const m = String(args || '').trim().match(/^(#?\d+|[A-Za-z]+-\d+)$/);
  if (!m) return { error: 'Usage: ' + USAGE.split('\n').find((l) => l.startsWith('/' + COMMAND + ' ' + verb + ' ')) };
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
  const usage = 'Usage: /askerdo resume TR-n | WS-n [your words], TR-n --take-over | --read-only | --splinter <name>, or nothing to see the shelf';
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

/* One question as a decision table, the shape the reply contract draws. */
export function questionTable(q) {
  const head = '**' + q.id + ' ' + cell(q.name) + '**' + (q.blocking ? ' (blocking)' : '')
    + (q.workstream ? ', ' + q.workstream : '');
  const out = [head];
  /* the ask is the question line; the gist, the why, follows it */
  if (q.ask) out.push(cell(q.ask));
  if (q.gist) out.push(cell(q.gist));
  if (q.crux) out.push('Crux: ' + cell(q.crux));
  const opts = Array.isArray(q.options) ? q.options.filter((o) => o && o.option) : [];
  const slots = [];
  if (opts.length) {
    out.push('', '|Type|Option|What happens|Catch|', '|-|-|-|-|');
    for (const o of opts) {
      const t = o.type && /^[a-z]$/.test(o.type) ? token(q.id, o.type) : cell(o.type);
      const mark = o.type && q.pick === o.type ? ' *' : '';
      out.push('|' + t + mark + '|' + cell(o.option) + '|' + cell(o.getsYou) + '|' + cell(catchOf(o.costsYou, o.undo)) + '|');
      // one line per slot: run together on one bullet they read as one sentence
      const lines = [o.whyPick && 'Why pick it: ' + cell(o.whyPick), o.whyNot && 'Why not: ' + cell(o.whyNot),
        o.undo && 'Undo: ' + cell(o.undo)].filter(Boolean);
      if (o.headline || lines.length) slots.push('- ' + t + (o.headline ? ': ' + cell(o.headline) : ''), ...lines.map((l) => '  - ' + l));
    }
  }
  if (slots.length) out.push('', ...slots);
  if (q.stakes) out.push('', 'Stakes: ' + cell(q.stakes));
  return out.join('\n');
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
    for (const q of shown) parts.push(questionTable(q));
    if (qs.length > shown.length) {
      parts.push('And ' + (qs.length - shown.length) + ' more: ' + qs.slice(shown.length).map((q) => q.id + ' ' + q.name).join(', ') + '.');
    }
    parts.push('Answer with /askerdo <token> [note], for example /askerdo ' + exampleToken(shown) + '.');
  } else parts.push('No open questions for this project.');
  if (calls.length) {
    parts.push((calls.length === 1 ? 'One thing waits' : calls.length + ' things wait') + ' on your press on the band:\n'
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

/* An override's presses typed: /askerdo allow or keep, unscrub for a scrub */
function typedPress(c) {
  const on = c.id || (c.request != null ? '#' + c.request : '');
  if (!on) return '';
  if (c.kind === 'scrub') return ', or type /askerdo unscrub ' + on;
  if (c.kind !== 'override') return '';
  const verbs = c.presses.map((p) => p.input && p.input.decision).filter(Boolean);
  return verbs.length ? ', or type ' + verbs.map((v) => '/askerdo ' + v + ' ' + on).join(' or ') : '';
}

function exampleToken(qs) {
  for (const q of qs) {
    const o = (q.options || []).find((x) => x && /^[a-z]$/.test(x.type || ''));
    if (o) return token(q.id, q.pick || o.type);
  }
  return '106b';
}

/* The board's shelf: waiting and parked tracks everywhere, each with its resume command;
   a held track whose lease went quiet reads so, its resume a take-over. */
export function shelfText(rows, now = Date.now()) {
  const list = (rows || []).filter((r) => r && r.track);
  if (!list.length) return 'The shelf is empty: no track is waiting or parked.';
  const lines = ['Tracks waiting or parked, oldest first:'];
  for (const r of list) {
    /* what opens it again, the board's words (unpark), after the reason */
    const parked = r.state === 'parked' && (r.parkReason || r.unpark)
      ? 'parked' + (r.parkReason ? ': ' + cell(r.parkReason) : '') + (r.unpark ? '; opens again ' + cell(r.unpark) : '') : '';
    const marks = [r.quietSince ? 'held, quiet since ' + atWords(r.quietSince, now) : '', parked,
      r.stalled ? 'stalled' : '', r.noHandoff ? 'no handoff yet' : '', r.codeMoved ? 'code moved since' : ''].filter(Boolean);
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

/* "T-41 (api-builder)": the now set, each task with its agent, or the session's own. */
export const nowText = (now) => (now || []).map((n) => n.id + (n.agent ? ' (' + flatLine(n.agent) + ')' : '')).join(', ');

/* What /askerdo track says of the held track (`track mine`'s read). */
export function trackText(m) {
  if (!m || !m.held) return NEEDS_TRACK;
  const now = nowText(m.now);
  return 'This session holds ' + m.track + ' ' + flatLine(m.name) + (m.workstream ? ' in ' + m.workstream : '') + ': ' + m.text + '.'
    + (m.chain && m.chain !== m.track ? '\nChain: ' + m.chain : '')
    + (now ? '\nNow: ' + now : '')
    + ((m.readySet || []).length ? '\nReady: ' + m.readySet.map((t) => t.id).join(', ') : '');
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
export function rewoundNote({ track, name, tasks, cli } = {}) {
  const held = [track ? track + (name ? ' (' + flatLine(name) + ')' : '') : '', (tasks || []).length ? tasks.join(', ') + ' in hand' : ''].filter(Boolean);
  if (!held.length) return '';
  return 'AskerDo: this session came back under a new id (a rewind or a restart), and the mod took back what its earlier id held, so it still holds '
    + held.join(' and ') + '.' + (track ? ' Before going on, read where the track stands: node ' + (cli || 'bin/askerdo.mjs') + ' track show ' + track + '.' : '');
}

/* The one line the transcript shows in the user's name; handoffPrompt rides it as context.
   No leading slash, so the engine never reads it as a command again. */
export const handoffAsk = (track, parkReason) => parkReason
  ? 'Park ' + track + ' with its parked handoff: ' + flatLine(parkReason) + ' (/askerdo park).'
  : 'Write the handoff for ' + track + ' (/askerdo handoff).';

/* What /askerdo handoff asks the model, as a prompt of its own; with a reason,
   /askerdo park's parked handoff, so the parking leg's mind is kept. */
export function handoffPrompt(track, parkReason, name) {
  const n = nameOf(name);
  return (parkReason ? capFirst(n) + ' is parking ' + track + '. ' : '') + STOP_FIRST + ' '
    + (parkReason
      ? 'Then write its parked handoff with the handoff_write tool, status parked and parkReason ' + JSON.stringify(parkReason) + ': '
      : 'Then write the handoff for ' + track + ' with the handoff_write tool: ')
    + 'focus (one line, the next step), '
    + 'state (at most 10 KB, no line over 400 characters: the picture, what is done with commit hashes and what to watch; it never orders work), '
    + 'leftovers (the steps left, in order: each { name } with its after, the numbers of earlier steps or T-n ids, becomes a task on the track, so the next session takes the next step from the ready set; '
    + 'each names its runBy: orchestrator, fork for the briefs, or agent:opus or agent:sonnet for mechanical work), '
    + 'whereWeWere (at most 4 KB, in your own words: ' + n + '\'s last exchange in their words, what was mid-thought, what was tried and dropped and what not to repeat, preferences learned this sitting), '
    + 'rulings (each ruling ' + n + ' made in chat that was never registered, one line each; one the kickoff carried comes back as { id, registered } once registered), '
    + 'verifyFirst (one entry per repo: path, branch, worktree, files; the verb snapshots the repo itself). '
    + 'In files, each untracked file gets a disposition: commit, ignore, delete, keep (with a reason; reviewed in 7 days unless you give a review day) or undecided. Judge from your own context first, then a quick look at the file, then one Sonnet agent when about five or more are still unknown; whatever is left is undecided. Commit, ignore and delete are proposals: ' + n + ' is asked, and nobody acts on them before that answer. '
    + 'Then waitingOnUser if anything waits on ' + n + '. '
    + 'Then close your reply with the resume block the tool\'s result gives, just above the footer.';
}

/* no server outlives its session; nor a side session
   left attached, whose turn notes would wake the old session after a resume */
export const STOP_FIRST = 'Before the handoff, stop what this session started (servers, background commands, agents), or name each in the handoff\'s state with how to stop it. '
  + 'Detach any side session it started (a test, display or helper session) and say so in one line: a side session\'s turn notes reach only the session that started it, so after the handoff they would wake this one instead of the resumed one.';

/* ---- the handoff kept current ----------------------------------- */

/* the steps that keep a handoff current, or leave it as it was */
const QUIET_STEPS = ['handoff_update', 'note'];
const toolName = (s) => String(s || '').replace(/^mcp__.+?__/, '');
const trackPart = (id) => String(id || '').trim().replace(/\.\d+$/, '').toUpperCase();

/* what changes state after a handoff; a plain answer or a read leaves it true */
const BOARD_STEPS = ['task_update', 'decide', 'ask', 'override_request', 'handoff_write'];
const WRITE_STEPS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Agent', 'Task', 'Workflow', 'TaskStop'];
/* the hub verbs that only read; every other verb, a flag before it skipped, counts */
const HUB_READS = ['list', 'show', 'read', 'search', 'activity', 'resolve', 'shelf', 'legacy', 'help', 'timings', 'decisions', 'projects',
  'track show', 'track list', 'profile show-effective', 'profile list', 'decisions triggers', 'proc find', 'proc triggers'];
const HUB_PAIRS = ['track', 'profile', 'proc', 'decisions', 'projects', 'handoff'];
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
      + 'Before the turn ends, patch it with handoff_update with what the next leg needs (a state section, a whereWeWere line, a waitingOnUser line, or a repo\'s verify-first snapshot); it keeps its id.' } : {}),
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
/* the mod's words say "the user"; a name a caller still passes is ignored */
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

/* What the band draws from, or null with no question and no thread waiting on the
 * shelf; the shelf alone draws no band. */
export function bandModel({ questions, shelfRows, sid, calls } = {}) {
  const ownOf = (q) => q.session === sid || (Array.isArray(q.subscribers) && q.subscribers.includes(sid));
  /* a session draws rows only for its own questions; the mark counts the rest */
  const qs = (questions || []).filter((q) => q && (!sid || ownOf(q))).map((q) => {
    const opts = Array.isArray(q.options) ? q.options : [];
    const born = Date.parse(q.created || '');
    return {
      /* the row's hover card: the ask, then the crux, the gist where there is none */
      id: q.id, name: flatLine(q.name), ask: flatLine(q.ask), blocking: q.blocking === true,
      reverses: reversesLine(q.reverses),
      crux: flatLine(q.crux) || flatLine(q.gist),
      mine: ownOf(q),
      pick: q.pick || null, born: Number.isFinite(born) ? born : 0, ...drawnVersion(q),
      answers: opts.filter((o) => o && /^[a-z]$/.test(o.type || '')).map((o) => ({
        letter: o.type, token: token(q.id, o.type), option: flatLine(o.option),
        gets: flatLine(o.getsYou), catch: catchOf(o.costsYou, o.undo), ...(flatLine(o.undo) ? { undo: flatLine(o.undo) } : {}),
      })),
    };
  });
  const waiting = waitingRows(shelfRows).length;
  const cs = callRows(calls);
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

/* The band's model with the PC's first problem leading its calls; a band with nothing else draws it alone. */
export function withHealth(model, problem) {
  const c = healthCall(problem);
  if (!c) return model;
  const base = model || { questions: [], more: 0, total: 0, blocking: 0, waiting: 0 };
  return { ...base, calls: [c, ...(Array.isArray(base.calls) ? base.calls : [])] };
}

/* A call's page as a path, so the tooltip names it short (the local server's signed root left out) */
const pagePath = (url) => (String(url || '').match(/\/(?:override|workstream|track|task)\/[^/?#]+/) || [''])[0];
const PRESS_LEAD = { Allow: 'ldDone', Close: 'ldDone', 'Close it': 'ldDone', 'Park it': 'ldDone', Unscrub: 'ldDone' };

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
      [tipRow(leadIcon('ldDone'), [quiet('Unfold them to Allow or Keep each')])]],
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
  return {
    head: { icon: 'ldHandoff', title: waitingLabel(w), state: null },
    groups: [(w.lines || []).map((l) => tipRow(leadIcon('ldNote'), [flatLine(l)])), [tipRow(leadIcon('ldDone'), [quiet(submitTip(w))])]].filter((g) => g.length),
  };
}

/* A call's press said back in a toast: an override's decision by what it did, else the press's word. */
export function callPressText(c, p, r, error) {
  const on = (c && c.id) || 'the call';
  if (error) return p.label + ' on ' + on + ' failed: ' + error;
  const recs = r && Array.isArray(r.records) && r.records.length ? ' (' + r.records.join(', ') + ')' : '';
  if (p.verb === 'overrideDecide' && r && r.dropped) return 'Cleared override #' + r.request + recs + ': it ' + r.dropped + ' unanswered, so nothing was applied.';
  if (p.verb === 'overrideDecide' && r && r.decision) {
    return r.decision === 'allow'
      ? 'Allowed override #' + r.request + recs + '.' + (Array.isArray(r.unreached) ? ' The scrub could not reach ' + r.unreached.join('; ') + '; if it was a secret, rotate it.' : '')
      : 'Kept as written: override #' + r.request + recs + '.';
  }
  if (p.verb === 'overrideUnscrub' && r) {
    return (r.id || on) + ': the scrubbed text is back.' + (Array.isArray(r.left) ? ' Left as they are, since they changed after the scrub: ' + r.left.join(', ') + '.' : '');
  }
  return p.label + ' on ' + on + ': recorded.';
}

/* the local band's word that the board stopped answering (two missed beats),
 * '' while it answers; withOffline puts it on the model, a band of its own when nothing else draws. */
export function offlineLine(near) {
  if (!near || !(near.offline || near.stale || near.board)) return '';
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
export function countTip(m) {
  const qs = (m && m.questions) || [];
  const more = (m && m.more) || 0;
  return qs.map((q) => q.id + ' ' + q.name + (q.blocking ? ' (blocking)' : '')).join('; ') + (more ? '; and ' + more + ' more' : '');
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
    chain: flatLine(src.chain || mine.chain), now: Array.isArray(src.now) ? src.now : [], stale: Array.isArray(src.stale) ? src.stale : [],
    running: count(src.running, src.now), ready: count(src.ready, src.readySet), toGo: Number.isFinite(src.toGo) ? src.toGo : null,
    url: String(src.url || mine.url || ''),
    /* what the track's tooltip says beside the counts */
    stalled: src.stalled === true, readySet: Array.isArray(src.readySet) ? src.readySet : [],
    critical: src.critical && Array.isArray(src.critical.path) ? src.critical.path : [], done: num(src.done), total: num(src.total),
    since: (src.holder && src.holder.since) || null, session: (src.holder && src.holder.session) || null,
    workstream: src.workstream || mine.workstream || '', workstreamName: flatLine(src.workstreamName),
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
  const row = (v) => ({ id: v.id, key: v.key, name: v.name, state: v.state, stalled: v.stalled, noHandoff: v.noHandoff, parkReason: v.parkReason, unpark: v.unpark,
    text: v.text, now: v.now, stale: v.stale, names: v.names, chain: v.chain, holder: v.holder, handoff: hs[v.id] || null, goal: v.goal || null, url: v.url,
    quietSince: v.quietSince || null, readySet: v.readySet, critical: v.critical, toGo: v.toGo, done: v.done, total: v.total, tasks: v.tasks });
  return { held: true, track: t.id, key: t.key, url: t.url, name: t.name, workstream: t.workstream || null, workstreamName: t.workstreamName || '',
    state: t.state, text: t.text, chain: t.chain,
    running: t.running, ready: t.ready, toGo: t.toGo, now: t.now, stale: t.stale, readySet: t.readySet, junction: t.junction, tracks: views.map(row) };
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

/* the picture's limits in the pane's Svg (desktop-capabilities 2f): past them it is dropped */
const SVG_CHARS = 131072;
const SVG_PX = 4096;
const r2 = (x) => Math.round(x * 100) / 100;

/* Home's "Where we stand" from the local board's graph of the held track's
 * workstream. scope 'mine' draws the held track's lines (linesTouching, laid out again on that
 * set), 'all' every line. Drawn for the width the pane reports: one picture when the columns
 * fit, else strips of whole columns stacked. Nothing drawn: `why` says so plainly. With
 * no track held, the band's graph is the project's workstream (`unheld`), drawn whole with
 * `why` the one line that says so and names the project's other open workstreams. */
export function homeGraph({ graph, mine, shelf, local, scope: asked = 'mine', columns, cell = 8.453, draw = true, now = Date.now() } = {}) {
  const held = mine && mine.held ? mine.track : null;
  const unheld = !held && !!(graph && graph.unheld);
  const scope = unheld ? 'all' : asked;
  const ws = (graph && graph.workstream) || (mine && mine.workstream) || '';
  /* the workstream's short name, from what the band carries (the held track's, the map's, a shelf row's) */
  const row = (Array.isArray(shelf) ? shelf : []).find((r) => r && r.workstream === ws && r.workstreamName);
  const workstreamName = shortName(flatLine((mine && mine.workstream === ws && mine.workstreamName) || (graph && graph.name) || (row && row.workstreamName) || ''), 28);
  const out = { scope, workstream: ws, workstreamName, lines: [], off: [], picture: null, why: '', unheld, marks: {} };
  if (!local) return { ...out, why: 'The local board is not answering, so nothing is drawn.' };
  if (!held && !unheld) return { ...out, why: 'This session holds no track, so there is no line to draw.' };
  if (!graph || !graph.view || !Array.isArray(graph.view.tracks)) return { ...out, why: 'The local board has no picture of ' + (ws || 'this workstream') + ' yet.' };
  const views = graph.view.tracks;
  const handoffs = new Map(((mine && mine.tracks) || []).map((t) => [t.id, t.handoff && t.handoff.created]));
  const look = viewLook((tv) => handoffs.get(tv.id));
  /* a finished review leaves the map like any finished station; the web's track page keeps it */
  const bare = { keepReview: false };
  const whole = graphOf(views, now, look, bare);
  /* an older local server's cached layout may still hold a finished review this map no longer draws */
  const cached = graph.layout && Array.isArray(graph.layout.lines) && Object.keys(graph.layout.stations || {}).every((id) => whole.D.tasks[id]) ? graph.layout : null;
  const wholeL = cached || layoutGraph(layoutInput(views, bare));
  const keep = scope === 'all' ? null : linesTouching(layoutInput(views, bare), held);
  const shown = keep ? views.filter((tv) => keep.has(tv.id)) : views;
  const G = keep ? { ...graphOf(shown, now, look, bare), L: layoutGraph(layoutInput(shown, bare)) } : { ...whole, L: wholeL };
  const trk = new Map(G.g.tracks.map((t) => [t.id, t]));
  const words = (tr, D) => lineWords(tr, D).map((b) => b[1]).join(', ');
  const page = (x) => (x ? recordHref(local, x.key || x.id, x.url) || '' : '');
  /* each line's track page, and the workstream's, for the names drawn as words */
  const urlOf = (id) => page(views.find((tv) => tv.id === id) || { id });
  out.workstreamUrl = ws ? page({ id: ws }) : '';
  out.lines = G.L.lines.map((ln) => {
    const tr = trk.get(ln.id);
    return { id: ln.id, name: flatLine(tr.name), words: words(tr, G.D), counts: lineCounts(tr, G.D, ln.done), url: urlOf(ln.id) };
  });
  const drawn = new Set(out.lines.map((l) => l.id));
  out.off = wholeL.lines.filter((ln) => !drawn.has(ln.id)).map((ln) => {
    const tr = whole.g.tracks.find((t) => t.id === ln.id);
    return { id: ln.id, name: flatLine(tr.name), words: words(tr, whole.D), url: urlOf(ln.id) };
  });
  if (!out.lines.length) return { ...out, why: 'Every line in ' + ws + ' is finished: nothing left to draw.' };
  if (unheld) {
    const list = (Array.isArray(graph.others) ? graph.others : []).filter((o) => o && o.id);
    const others = list.map((o) => flatLine(o.id + ' ' + (o.name || '')));
    out.why = 'This session holds no track, so this is all of ' + flatLine(ws + ' ' + (graph.name || '')) + '.'
      + (others.length ? ' Also open in this project: ' + others.join(', ') + '.' : '');
    /* the same words, each workstream named a link to its page */
    const link = (text, id) => { const href = page({ id }); return href ? { text, href } : { text }; };
    out.whyParts = [{ text: 'This session holds no track, so this is all of ' }, link(flatLine(ws + ' ' + (graph.name || '')), ws), { text: '.' },
      ...(others.length ? [{ text: ' Also open in this project: ' }, ...others.flatMap((o, i) => [link(o, list[i].id), { text: i < others.length - 1 ? ', ' : '.' }])] : [])];
  }
  if (!draw) return out;
  /* the 480 px tile's width when the pane reports none; never past the Svg's 4096 px */
  const view = Math.min(SVG_PX, Number(columns) > 0 ? Number(columns) * cell : 438);
  const n = viewCols(SKIN_PANE, G.L.cols, view);
  const P = drawGraph(G.L, G.D, G.g, SKIN_PANE, { view, measure: paneMeasure, parts: true, strip: n || undefined });
  out.marks = P.reviews.marks;
  const OW = Math.floor(view);
  /* draw.mjs stripWindows: the web's picture stacks the same strips */
  const wins = stripWindows(P, n || P.cols, view);
  let Y = 0;
  const hits = [];
  const frames = wins.map((f) => {
    /* each press zone in the picture's own px, in the strip that shows it */
    for (const h of P.hits) {
      if (f.line && (h.line !== f.line || (h.kind === 'track' ? !f.cap : h.x <= f.x || h.x >= f.x + f.w))) continue;
      const box = h.kind === 'track' ? [h.x, h.y, h.w, h.h] : [Math.min(h.x - h.r, h.wx), h.y - h.r, Math.max(2 * h.r, h.ww), h.wy + h.wh - h.y + h.r];
      const x0 = Math.max(0, box[0] - f.x), x1 = Math.min(f.w, box[0] + box[2] - f.x), y0 = Math.max(0, box[1] - f.y), y1 = Math.min(f.h, box[1] + box[3] - f.y);
      const href = page(h);
      if (x1 - x0 < 4 || y1 - y0 < 4 || !href) continue;
      hits.push({ id: h.id, kind: h.kind, href, x: r2(x0 + (f.dx || 0)), y: r2(y0 + Y), w: r2(x1 - x0), h: r2(y1 - y0) });
    }
    /* a strip past the line's first draws its small name, which opens the track too */
    const hd = stripHead(P, f), tk = hd && P.hits.find((h) => h.kind === 'track' && h.id === f.line), thref = tk ? page(tk) : '';
    if (hd && thref) hits.push({ id: f.line, kind: 'track', href: thref, x: r2(hd.x - f.x + (f.dx || 0)), y: r2(hd.y - f.y + Y), w: r2(hd.w), h: r2(hd.h) });
    const s = '<svg x="' + (f.dx || 0) + '" y="' + Y + '" width="' + r2(f.w) + '" height="' + r2(f.h) + '" viewBox="' + r2(f.x) + ' ' + r2(f.y) + ' ' + r2(f.w) + ' ' + r2(f.h) + '">' + stripSvg(P, f, '<use href="#hg"/>') + '</svg>';
    Y = r2(Y + f.h + 8);
    return s;
  });
  const W = wins.length > 1 ? OW : wins[0].w;
  const H = Math.ceil(Y - 8);
  const source = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" font-family=\'' + SKIN_PANE.font + '\'>'
    + paneStyle() + '<defs><g id="hg">' + P.body + '</g></defs>' + frames.join('') + '</svg>';
  if (source.length > SVG_CHARS || H > SVG_PX) return { ...out, why: 'The picture of ' + ws + ' is too big for the pane; the board draws it whole.' };
  out.picture = { source, width: W, height: H, strips: wins.length, hits,
    alt: 'Where we stand in ' + ws + (keep ? ', ' + held + '\'s lines' : '') + ', as a drawn graph' };
  return out;
}

/* the legend's marks are the icons themselves, each a window on a sample
   drawGraph draws in the pane's skin, so a mark is the picture's own drawing at its own scale */
const LEGEND = [
  ['run', 'running', 'A filled station'], ['ready', 'ready', 'A ringed station'], ['amber', 'waits on you', 'An amber station'],
  ['crit', 'the critical path', 'The bold rail'], ['dim', 'parked or stalled', 'A dimmed station on a dashed rail'],
];
let legendMarks = null;
/* the review marks, each listed only where its map draws it (marks: homeGraph's) */
const REVIEW_MARKS = {
  bead: [28, 'Amber beads on the rail', '<path d="M1 13H27" stroke="p-line" stroke-width="3" stroke-linecap="round"/><circle cx="8.5" cy="13" r="3.2" fill="p-amber" stroke="p-bg" stroke-width="1.6"/><circle cx="19.5" cy="13" r="3.2" fill="p-amber" stroke="p-bg" stroke-width="1.6"/>'],
  review: [26, 'An outlined diamond', '<path d="' + diamondD(13, 13, 8) + '" fill="p-bg" stroke="p-ready" stroke-width="2.8" stroke-linejoin="round"/>'],
  reopened: [26, 'An amber outlined diamond', '<path d="' + diamondD(13, 13, 8) + '" fill="p-bg" stroke="p-amber" stroke-width="2.8" stroke-linejoin="round"/>'],
  lock: [26, 'An amber padlock', padlock(9, 12, 'p-amber', 'p-bg')],
};
export function graphLegend(marks) {
  const extra = reviewLegend(marks).map(([key, words]) => {
    const [w, alt, body] = REVIEW_MARKS[key];
    const source = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="26" viewBox="0 0 ' + w + ' 26">' + paneStyle() + body + '</svg>';
    return { key, words, source, alt: alt + ', as the graph draws it', width: w, height: 26 };
  });
  return baseLegend().concat(extra);
}
function baseLegend() {
  if (legendMarks) return legendMarks;
  const task = (id, status, more) => ({ id, key: id, name: id, status, ...more });
  const chain = (ids) => ids.slice(1).map((id, i) => ({ task: id, on: ids[i] }));
  const line = (id, state, tasks, edges, path) => ({ id, key: id, name: id, state, done: 0, tasks, edges, critical: { length: path.length, path }, now: state === 'active' ? [{ id: 'run' }] : [] });
  const views = [
    line('on', 'active', [task('run', 'in_progress'), task('ready', 'open', { ready: true }), task('amber', 'open', { gated: true }), task('c1', 'open'), task('c2', 'open')], chain(['c1', 'c2']), ['c1', 'c2']),
    line('off', 'parked', [task('d1', 'open'), task('dim', 'open'), task('d3', 'open')], chain(['d1', 'dim', 'd3']), []),
  ];
  const look = { gates: (t) => (t.gated ? ['you'] : []), trackOf: () => '', front: () => null, moved: () => ({ last: null, days: null }) };
  const { g, D } = graphOf(views, 0, look);
  const L = layoutGraph(layoutInput(views));
  /* strips leave the bands out of the body, so a mark has no band behind it; words never show */
  const P = drawGraph(L, D, g, SKIN_PANE, { view: SVG_PX, measure: paneMeasure, parts: true, strip: 1 });
  const body = P.body.replace(/<text[\s\S]*?<\/text>/g, '').replace(/<title>[^<]*<\/title>/g, '');
  const at = (id) => (P.body.match(new RegExp('data-task="' + id + '"><title>[^<]*</title><circle cx="([-\\d.]+)" cy="([-\\d.]+)"')) || []).slice(1).map(Number);
  const [c1, c2] = [at('c1'), at('c2')];
  const half = P.skin.r + 6.5;
  legendMarks = LEGEND.map(([key, words, alt]) => {
    const [x, y] = key === 'crit' ? [(c1[0] + c2[0]) / 2, c1[1]] : at(key);
    const w = key === 'crit' ? 28 : 2 * half, h = 2 * half;
    const source = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="' + r2(x - w / 2) + ' ' + r2(y - half) + ' ' + w + ' ' + h + '">'
      + paneStyle() + body + '</svg>';
    return { key, words, source, alt: alt + ', as the graph draws it', width: w, height: h };
  });
  return legendMarks;
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
export const bandSection = (name) => 'The AskerDo mod draws a Needs-you band above ' + nameOf(name) + '\'s prompt: this project\'s open questions '
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
export const noBandSection = (name) => '**Where no band draws.** ' + capFirst(nameOf(name)) + ' reads this session where no Needs-you band draws '
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
  const holder = firstSet(v.holder, r.holder, sh.holder) || null;
  const quietSince = firstSet(v.quietSince, r.quietSince, sh.quietSince) || '';
  const workstream = firstSet(row ? ctx.heldWs : '', sh.workstream) || '';
  const workstreamName = ctx.names[workstream] || flatLine(sh.workstreamName);
  const held = ctx.holding && id === ctx.heldId;
  const isQuiet = !held && state === 'active' && !!quietSince;
  const section = held ? 'held' : state === 'parked' ? 'parked' : state === 'active' ? 'elsewhere' : 'pickup';
  const h = r.handoff || ctx.handoffs[id] || (sh.handoff ? { id: sh.handoff, status: sh.handoffStatus, focus: sh.focus, created: sh.created } : null);
  /* a handoff's waits count while it is live, as the band's needs-you reads them; a resumed one handed them on */
  const liveH = h && (!h.status || LIVE_HANDOFF.includes(h.status));
  const lines = !liveH ? [] : Array.isArray(h.waitingOnUser) ? h.waitingOnUser : sh.handoff === h.id ? sh.waitingOnUser : [];
  const asks = blockingFirst(((ctx.asked && ctx.asked[id]) || []).filter((q) => q && q.id && !q.snoozed).map((q) => ({ id: q.id, name: flatLine(q.name), blocking: q.blocking === true })));
  const waits = stillWaiting(lines, new Set(asks.map((q) => qLabel(q.id))), ctx.open);
  const age = h && h.created ? ageOf(h.created, now) : flatLine(sh.age);
  const nowList = Array.isArray(firstSet(v.now, r.now)) ? firstSet(v.now, r.now) : [];
  const staleList = Array.isArray(firstSet(v.stale, r.stale)) ? firstSet(v.stale, r.stale) : [];
  const readySet = Array.isArray(firstSet(v.readySet, r.readySet)) ? firstSet(v.readySet, r.readySet) : [];
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

  const st = held ? { text: 'active' + MID + 'this session', tone: 'sky' }
    : isQuiet ? { text: 'quiet' + (ageOf(quietSince, now) ? ' ' + ageOf(quietSince, now) : ''), tone: 'amber' }
      : state === 'active' ? { text: 'active' + MID + 'another session', tone: 'sky' }
        : state === 'new' ? { text: 'new' + MID + 'not started', tone: 'dim' }
          : { text: (stalled && state === 'waiting' ? 'stalled' : state) + (age ? MID + age : ''), tone: stalled ? 'amber' : 'dim' };
  const shown = rv && rv.due && !isQuiet ? { text: 'review due' + (st.text.includes(MID) ? MID + st.text.split(MID).slice(1).join(MID) : ''), tone: 'amber' } : st;
  const rails = held || (state === 'active' && !isQuiet) ? 'sky' : isQuiet || stalled ? 'amber' : 'dim';
  const head = { icon: 'thread', tone: rails, id, name, title: id + ' ' + name, state: shown };

  /* the workstream's id and name open its page */
  const wsHref = workstream ? recordHref(ctx.local, workstream) || '' : '';
  const wsLink = wsHref ? { href: wsHref } : {};
  const wsRow = tipRow(leadIcon('ldFolder'), workstream ? [{ ...quiet(workstream + ' '), ...wsLink }, workstreamName ? { text: workstreamName, clamp: 1, ...wsLink } : ''] : [quiet('Workstream not read yet')]);
  const stepOf = (tid) => {
    const p = ((v.tasks || []).find((x) => x.id === tid) || {}).progress;
    return p && Number(p.total) > 0 ? ', step ' + Math.min(Number(p.done) + 1, Number(p.total)) + ' of ' + p.total : '';
  };
  const nowRow = (n) => tipRow({ kind: 'station', state: 'now' }, [named(n), quiet(n.agent ? ', ' + flatLine(n.agent)
    : held && ctx.hand.has(n.id) ? ', in hand' + stepOf(n.id)
      : n.session ? (held && holder && n.session === holder.session ? ', this session' : ', another session') : '')]);
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
    const ready = readySet.slice(0, READY_MAX).map((t) => tipRow({ kind: 'station', state: 'ready' }, [named(t), quiet(', ready next')]));
    if (readySet.length > READY_MAX) {
      const last = ready[READY_MAX - 1];
      ready[READY_MAX - 1] = { ...last, lines: [...last.lines, tipLine([quiet('and ' + (readySet.length - READY_MAX) + ' more ready')])] };
    }
    const far = !progress && !nowList.length && !readySet.length ? [tipRow(leadIcon('ldDone'), [quiet('No tasks on this track yet')])]
      : [progress ? barRow(progress) : null, ...nowList.map(nowRow), ...staleList.map((t) => leftRow(t, named(t))), ...ready, flagRow(toGo, critical, nameOf, (id) => urlOf({ id }))].filter(Boolean);
    groups = [[wsRow, tipRow(leadIcon('ldClock'), heldFor('Held here', holder && holder.since, now))], far, [...youRows(0), handoffRow()]];
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
      ...(section === 'elsewhere' ? [...nowList.map(nowRow), ...staleList.map((t) => leftRow(t, named(t)))] : []),
      seenRow,
      state === 'new' ? tipRow(leadIcon('ldIntent'), goal ? [quiet('Goal: '), { text: goal, clamp: 2 }] : [quiet('No goal written yet')]) : null,
      state === 'new' && !h ? null : section === 'elsewhere' && !isQuiet ? null : handoffRow(),
      looseRow(sh, section),
      progress ? barRow(progress) : null,
    ].filter(Boolean)];
  }
  return {
    id, key: firstSet(r.key, v.key, sh.key) || null, name, url: recordHref(ctx.local, firstSet(r.key, v.key, sh.key) || id, firstSet(v.url, r.url, sh.url)), section, state, stalled, quiet: isQuiet,
    quietSince, noHandoff: !!firstSet(v.noHandoff, r.noHandoff, sh.noHandoff), parkReason: flatLine(firstSet(v.parkReason, r.parkReason, sh.parkReason)),
    goal: flatLine(firstSet(v.goal, r.goal, sh.goal)), workstream, workstreamName, holder, head, asks, waits,
    handoff: h ? { id: h.id, status: h.status, focus: flatLine(h.focus), created: h.created || null, age } : null,
    progress, now: nowList, stale: staleList, readySet, toGo, critical, groups,
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

/* a track nobody resumes counts its due loose files (the local board reads them from this
   PC's lists), which its next kickoff lists to judge; a count, never a question */
function looseRow(sh, section) {
  const n = Number(sh.looseDue);
  if (!(n > 0) || (section !== 'pickup' && section !== 'parked')) return null;
  return tipRow(leadIcon('ldLoose'), [String(n), quiet(n === 1 ? ' loose file due' : ' loose files due')]);
}

/* Tracks waiting on the user lead (a blocking question, an open one, then only handoff lines),
   then the oldest handoff first, new tracks last */
const needRank = (t) => (t.asks.some((q) => q.blocking) ? 0 : t.asks.length ? 1 : t.waits.length ? 2 : t.state === 'new' ? 4 : 3);
const bornOf = (t) => { const x = Date.parse((t.handoff && t.handoff.created) || ''); return Number.isFinite(x) ? x : Infinity; };
const oldestFirst = (a, b) => bornOf(a) - bornOf(b) || idNum(a.id) - idNum(b.id);

/* The Tracks tab: the track this session holds as the card, the tracks nobody holds to
 * pick up, the ones other sessions hold (the quiet ones marked), the parked; each one shape
 * (trackShape). `mine` is mineOf's or `track mine`'s, `graph` the band's workstream map,
 * `handoffs` each line's last, `asks` every open question by its track, `hand` this session's
 * tasks in hand, `offline` the band's offline line. `others`: other workstreams' maps
 * (`{ workstream, view }`), whose tracks other sessions hold run elsewhere and whose shelf
 * rows draw their bar from the map. */
export function tracksView({ mine, graph, shelfRows, handoffs, asks, hand, now, offline, others, local } = {}) {
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
    hand: new Set((Array.isArray(hand) ? hand : []).map((t) => t && t.id).filter(Boolean)),
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
export function questionsModel({ questions, more, sid, now, local, here } = {}) {
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
      /* the questions a reversal was told beside in one reply */
      beside: Array.isArray(q.beside) ? q.beside.filter((b) => typeof b === 'string' && b) : [],
      /* `asker` registered it; `session` is set only on this session's own */
      origin: sid && (q.asker || q.session) ? ((q.asker || q.session) === sid ? 'this session' : 'another session') : '',
      age: Number.isFinite(born) && now ? ageText(now - born) : '', born: Number.isFinite(born) ? born : 0,
      /* whose track it is and the PC it was asked from, each only when the read carries it */
      ...(q.track ? { track: flatLine(q.track) } : {}), ...(q.track && q.trackName ? { trackName: flatLine(q.trackName) } : {}),
      ...(q.pc ? { pc: flatLine(q.pc) } : {}), ...(q.away === true ? { away: true } : {}),
      options: opts.filter((o) => o && /^[a-z]$/.test(o.type || '')).map((o) => ({
        letter: o.type, token: token(q.id, o.type), option: flatLine(o.option),
        gets: flatLine(o.getsYou), catch: catchOf(o.costsYou, o.undo), pick: pick === o.type,
        slots: SLOTS.filter(([f]) => flatLine(o[f])).map(([f, label]) => ({ id: f, label, text: flatLine(o[f]) })),
      })),
    };
  });
  /* where the pane runs, its PC and held track, for the chips; null on a telling */
  const at = here ? { pc: flatLine(here.pc), track: flatLine(here.track) } : null;
  return { cards, more: more || 0, blocking: cards.filter((c) => c.blocking).length, here: at };
}

export function questionsHeader(m) {
  const n = m.cards.length + m.more;
  if (!n) return 'No open questions for this session or blocking this project.';
  return n + ' open question' + (n === 1 ? '' : 's') + (m.blocking ? ', ' + m.blocking + ' blocking' : '');
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

/* ---- a question's track and PC as chips, grouped, and its row ---- */

export const THIS_PC = 'this PC';
const samePc = (a, b) => !!flatLine(a) && flatLine(a).toLowerCase() === flatLine(b).toLowerCase();
/* the two chips of a question, either null when the read has none; `here` is where the pane runs */
export function chipOf(card, here) {
  const h = here || {};
  const at = samePc(card.pc, h.pc);
  return {
    track: card.track ? { text: card.track, own: !!h.track && card.track === h.track } : null,
    pc: card.pc ? { text: at ? THIS_PC : card.pc, here: at } : null,
  };
}
/* one group per track and PC, where its first question falls; a question with neither stands alone */
export function chipGroups(cards, here) {
  const out = [], by = new Map();
  for (const c of cards || []) {
    const key = c.track || c.pc ? (c.track || '') + '|' + flatLine(c.pc).toLowerCase() : null;
    let g = key === null ? null : by.get(key);
    if (!g) {
      g = { track: c.track || '', trackName: c.trackName || '', pc: c.pc || '', chips: chipOf(c, here), rows: [] };
      out.push(g);
      if (key !== null) by.set(key, g);
    }
    g.rows.push(c);
  }
  return out;
}
const CHIP_ICONS = { track: 'thread', pc: 'monitor' };
/* a desktop's words in cells, as the pane's Segoe UI draws them */
const deskCells = (s, weight = 400) => paneMeasure(s, 14, weight) / DESK_CELL;
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
/* A group's header in `room` cells: the chips that fit (the track's drops first, the PC's last), and the
   track's name dim beside them when it fits whole, else under them, ellipsized only when that line is short */
export function chipHeader(group, room, opts = {}) {
  const desk = opts.surface === 'desktop';
  const w = widthFor(desk);
  const fit = Number(room) > 0 ? Number(room) : Infinity;
  const chips = ['track', 'pc'].filter((k) => group.chips && group.chips[k])
    .map((k) => ({ kind: k, icon: CHIP_ICONS[k], ...group.chips[k], accent: !!(group.chips[k].own || group.chips[k].here) }));
  const need = () => chips.reduce((n, c) => n + chipCells(c.kind, c.text, desk), 0) + Math.max(0, chips.length - 1);
  while (chips.length && need() > fit) chips.shift();
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

/* The grid: the terminal's option, what happens and catch at 30, 40 and
 * 30 percent of what the card's frame, padding and gaps leave; under 60 cells two columns,
 * the catch a dim line in the what-happens cell. A desktop shares the row by `weights`. */
export const GRID_TWO_UNDER = 60;
export function gridWidths(columns, surface, options) {
  const cols = Number.isFinite(columns) && columns > 0 ? Math.floor(columns) : 80;
  const desk = surface === 'desktop';
  if (cols < GRID_TWO_UNDER) {
    const room = Math.max(12, cols - 9);
    const option = Math.max(8, Math.round((room * 3) / 7));
    return { two: true, option, happens: Math.max(4, room - option), catch: 0, ...(desk ? { weights: gridWeights(options, true, room) } : {}) };
  }
  const room = cols - 10;
  const option = Math.max(12, Math.round(room * 0.3));
  const happens = Math.max(12, Math.round(room * 0.4));
  return { two: false, option, happens, catch: Math.max(8, room - option - happens), ...(desk ? { weights: gridWeights(options, false, room) } : {}) };
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
  /* never under the chip and the longest word, so a narrow pane wraps a title at its spaces;
   * the pick's star draws only where it fits beside its first word */
  const word = Math.max(0, ...list.flatMap((o) => String(o.option || '').split(' ').map(cellWidth)));
  const option = Math.max(Math.min(GRID_OPTION_MAX, Math.ceil((longest('Option', title) / room) * 100)),
    Math.min(GRID_WORD_MAX, Math.ceil(((GRID_CHIP + word) / room) * 100))) / 100;
  const pick = list.find((o) => o.pick);
  const first = pick ? cellWidth(String(pick.option || '').split(' ').find(Boolean) || '') : 0;
  const star = option * room >= GRID_CHIP + cellWidth(STAR + ' ') + first;
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
      return { option: Math.round(option * 100), happens: pct[0], catch: two ? 0 : pct[1], star };
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

/* this session's agents in flight, running first, then the finished ones dimmed
   while another still runs; each its job, model, running time, calls, the tool in use and
   its depth against the guard's hard limit, amber from the warning point. Null when none run. */
export function agentsModel(list, guard, now) {
  const all = (Array.isArray(list) ? list : []).filter((a) => a && a.id);
  const running = all.filter((a) => !a.done);
  if (!running.length) return null;
  const lim = agentLimits(guard);
  const warn = Math.max(0, lim.soft - lim.remind);
  const row = (a) => {
    const tokens = Number(a.tokens) || 0;
    const calls = Number(a.calls) || 0;
    const tone = a.done ? 'dim' : tokens >= lim.hard ? 'red' : tokens >= warn ? 'amber' : 'sky';
    const pct = clampPct((tokens / lim.hard) * 100);
    const ran = ranFor(a, now);
    const state = a.done ? 'done' + (ran === null ? '' : ' in ' + runTime(ran)) : ran === null ? '' : 'running ' + runTime(ran);
    const detail = [modelName(a.model), state, calls + (calls === 1 ? ' tool call' : ' tool calls'),
      !a.done && a.tool ? 'in ' + toolShort(a.tool) : '', tokens ? kTok(tokens) + ' of ' + kTok(lim.hard) : ''].filter(Boolean).join(', ');
    return { id: a.id, job: flatLine(a.job) || 'an agent', detail, tone, done: !!a.done, pct, ran,
      depth: tokens ? kTok(tokens) + ' of ' + kTok(lim.hard) : '',
      meter: meterPicture(pct, tone, (warn / lim.hard) * 100, flatLine(a.job)) };
  };
  const rows = [...running, ...all.filter((a) => a.done)].map(row);
  const live = rows.filter((r) => !r.done);
  const tone = live.reduce((t, r) => (TONE_RANK[r.tone] > TONE_RANK[t] ? r.tone : t), 'sky');
  const done = all.length - running.length;
  /* shut, Home's line is the counts and the deepest running agent's depth; `timed` adds the
     longest running time, for a line with the room */
  const deepest = live.reduce((d, r) => (r.pct > d.pct ? r : d));
  const longest = live.reduce((t, r) => (r.ran !== null && (t === null || r.ran > t) ? r.ran : t), null);
  const tail = (done ? ', ' + done + ' done' : '') + (deepest.depth ? '; deepest ' + deepest.depth : '');
  const summary = running.length + ' running' + tail;
  const timed = longest === null ? summary : running.length + ' running' + (running.length === 1 ? ' for ' : ', longest ') + runTime(longest) + tail;
  return { running: running.length, done, rows, tone, summary, timed, deepest };
}

/* an agent's depth as a short bar, filled to the hard limit, a tick at the warning point */
export function meterPicture(pct, tone, tick, job = '') {
  const W = 28, len = 26;
  const fill = (len * clampPct(pct)) / 100;
  const x = f2(1 + (len * clampPct(tick)) / 100);
  const body = '<rect x="1" y="8" width="' + len + '" height="4" rx="2" class="f-track"/>'
    + (fill > 0 ? '<rect x="1" y="8" width="' + f2(Math.max(fill, 4)) + '" height="4" rx="2" class="f-' + tone + '"/>' : '')
    + '<line x1="' + x + '" y1="6" x2="' + x + '" y2="14" stroke-width="1" stroke-linecap="round" class="s-dim"/>';
  return { source: svgOf(W, 20, body), alt: 'Depth bar' + (job ? ' of ' + job : '') + ', ' + Math.round(pct) + ' percent of the hard limit', width: W, height: 20 };
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

/* the tray's face rule (tray/src/tray.rs), on the counts of what waits elsewhere */
export function markFace(counts) {
  const b = Number(counts && counts.blocking) || 0;
  const w = Number(counts && counts.waiting) || 0;
  return b > 0 ? 'blocking' : w > 0 ? 'waiting' : 'quiet';
}
/* the mark counts the open questions this session does not own; its card groups them
   under chip headers, and its press opens them in the Questions tab (Home when none wait) */
function markSeg(elsewhere, now, here, version) {
  /* the card names this PC's plugin version in both shapes */
  const name = 'AskerDo' + (versionParts(version) ? ' ' + version : '');
  const known = !!elsewhere && Number.isFinite(Number(elsewhere.blocking)) && Number.isFinite(Number(elsewhere.waiting));
  const b = known ? Number(elsewhere.blocking) : 0, w = known ? Number(elsewhere.waiting) : 0;
  const pic = { kind: 'mark', face: markFace(known ? elsewhere : null), blocking: b, waiting: w };
  if (!known || !(b + w)) {
    const c = cardOf(name, [known ? 'nothing waits elsewhere' : 'the board\'s counts are not read yet'], 'Press to open the AskerDo pane on Home');
    return { key: 'mark', text: '', tone: 'dim', press: 'home', ...c, pic };
  }
  const n = b + w;
  const title = n + ' question' + (n === 1 ? '' : 's') + ' from elsewhere';
  const questions = (Array.isArray(elsewhere.questions) ? elsewhere.questions : []).filter((q) => q && q.id).map((q) => {
    const born = Date.parse(q.created || '');
    return { id: q.id, name: flatLine(q.name), blocking: q.blocking === true, track: flatLine(q.track), trackName: flatLine(q.trackName), pc: flatLine(q.pc),
      age: Number.isFinite(born) && Number.isFinite(now) ? ageText(now - born) : '' };
  });
  const c = cardOf(title, [b ? { text: b + ' blocking', tone: 'amber' } : '', b && w ? ', ' : '', w ? { text: w + ' waiting', tone: 'sky' } : ''], 'Press to open them in the Questions tab');
  c.card.head = { icon: 'mark', title, state: b ? { text: b + ' blocking', tone: 'amber' } : null };
  c.card.questions = questions;
  /* only the PC: none of them is this session's track */
  c.card.here = { pc: flatLine(here && here.pc) };
  c.card.foot = name;
  return { key: 'mark', text: '', tone: 'dim', press: 'questions', ...c, pic: { ...pic, label: String(n), labelTone: b ? 'amber' : 'sky' } };
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
const TASK_STATUS = { open: { text: 'open' }, in_progress: { text: 'in progress', tone: 'sky' }, blocked: { text: 'blocked', tone: 'amber' }, deferred: { text: 'deferred', tone: 'dim' } };
const trackStateOf = (f) => (f.stalled ? { text: 'stalled', tone: 'amber' } : f.state === 'active' ? { text: 'active', tone: 'sky' } : { text: f.state || 'held', tone: 'dim' });

/* the open tasks of a track view in the board map's order, each with the map's kind */
function stationsOf(view, now) {
  if (!view || !Array.isArray(view.tasks) || !view.tasks.length) return [];
  let D = null;
  try { D = graphOf([{ edges: [], critical: { length: 0, path: [] }, ...view }], now, viewLook()).D; } catch { D = null; }
  return view.tasks.slice().sort((a, b) => (a.column || 0) - (b.column || 0) || (a.position || 0) - (b.position || 0))
    .map((t) => ({ ...t, kind: (D && D.tasks[t.id] && D.tasks[t.id].kind) || (t.status === 'in_progress' ? 'now' : t.ready ? 'ready' : 'waits') }));
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

/* the bar's cells: the map's stations after the done, else from the counts (done, running, ready, the rest) */
function progressOf(stations, { done, total, now, readySet, unreviewed = 0, locked = false }) {
  /* the done not yet reviewed lead into the open work, amber */
  const u = Math.min(done, Math.max(0, unreviewed));
  const past = [...Array(done - u).fill('done'), ...Array(u).fill('review')];
  const cells = stations.length ? [...past, ...stations.map((t) => t.kind)]
    : [...past, ...now.map(() => 'now'), ...readySet.map(() => 'ready'), ...Array(Math.max(0, (total || 0) - done - now.length - readySet.length)).fill('waits')];
  /* a held finish's cell, the last, is its padlock */
  if (locked && cells.length > done) cells[cells.length - 1] = 'lock';
  const count = (k) => cells.filter((x) => x === k).length;
  return { done, total, cells, unreviewed: u, alt: 'One cell per task: ' + done + ' done, ' + count('now') + ' running, ' + count('ready') + ' ready' + (u ? ', ' + u + ' to review' : '') + (locked ? ', the finish waits on a review' : '') };
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
/* a started task no live hand backs, not a running dot */
const leftRow = (t, name = nameItem(t)) => tipRow({ kind: 'station', state: 'left' }, [name, quiet(', ' + LEFT_WORDS)]);
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

function trackTip(f, { graph, handoffs, questions, now, local }) {
  const view = viewOfTrack(graph, f.id);
  const inView = (t) => linkedName(local, ((view && view.tasks) || []).find((x) => x.id === t.id) || t, nameItem(t));
  const stations = stationsOf(view, now);
  const done = Number.isFinite(f.done) ? f.done : view && Number.isFinite(view.done) ? view.done : 0;
  const total = Number.isFinite(f.total) ? f.total : view && Number.isFinite(view.total) ? view.total : null;
  const ws = f.workstream ? [linkedName(local, { id: f.workstream }, f.workstream + (f.workstreamName ? ' ' + f.workstreamName : ''))] : [quiet('Workstream not read yet')];
  const g1 = [tipRow(leadIcon('ldFolder'), ws),
    tipRow(leadIcon('ldClock'), heldFor('Held here', f.since, now))];
  let g2;
  if (!(total > 0) && !f.now.length && !f.readySet.length) g2 = [tipRow(leadIcon('ldDone'), [quiet('No tasks on this track yet')])];
  else {
    const p = progressOf(stations, { done, total, now: f.now, readySet: f.readySet });
    const toGo = Number.isFinite(f.toGo) ? f.toGo : f.critical.length;
    g2 = [total > 0 ? barRow(p) : null,
      ...f.now.map((t) => tipRow({ kind: 'station', state: 'now' }, [inView(t), quiet(t.agent ? ', ' + flatLine(t.agent) : t.session && t.session === f.session ? ', this session' : '')])),
      ...(f.stale || []).map((t) => leftRow(t, inView(t))),
      ...f.readySet.map((t) => tipRow({ kind: 'station', state: 'ready' }, [inView(t), quiet(', ready next')])),
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
  return { head: { icon: 'step', title: nameItem(t), state: TASK_STATUS[t.status] || (t.status ? { text: t.status, tone: 'dim' } : null) }, groups: [g1, g2, g3] };
}

/* a structured card and its terminal line, as cardOf makes a flat one */
function tipCard(title, tip, press) {
  const card = { title, parts: [], press, ...tip };
  return { card, tip: title + ': ' + cardText(card) + (press ? '. ' + press : '') };
}

/* the status row's word for a problem's part of the PC */
const HEALTH_WORDS = { copy: 'old copy', store: 'store', config: 'board join', board: 'board', server: 'local server', tray: 'tray' };

/* The line's segments, shortest horizon first; each carries its hover card (`card` for the
 * desktop, `tip` for the terminal) and `pic`, the desktop's picture; `mark`, the
 * AskerDo mark the desktop's row opens with. Tones: dim, bright, warning, error,
 * success. Null when there is nothing to draw. */
export function statusModel({ reading, main, rates, guard, thread, hand, shelf, elsewhere, here, now, agents, graph, handoffs, questions, local, version, health } = {}) {
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
  /* drawn only while this session's agents run, its card a row each */
  const am = agentsModel(agents, guard, now);
  if (am) {
    const c = cardOf(am.running === 1 ? 'Agent running' : 'Agents running', [{ text: String(am.running), tone: am.tone },
      ' running in this session' + (am.done ? ', ' + am.done + ' done' : '')], 'Press to open Home with the agents unfolded', am.rows);
    segs.push({ key: 'agents', text: STATUS_GLYPHS.agents + ' ' + am.running, tone: am.tone === 'red' ? 'error' : am.tone === 'amber' ? 'warning' : 'bright',
      press: 'agents', ...c, pic: { kind: 'icon', icon: 'agents', tone: 'dim', label: String(am.running), labelTone: am.tone } });
  }
  /* the first problem `askerdo status` lists, leading the right group; its press runs or copies the fix */
  const hc = healthCall(health);
  if (hc) {
    const label = HEALTH_WORDS[health.key] || 'this PC';
    const verb = hc.presses[0];
    const c = cardOf('AskerDo on this PC', [{ text: 'Needs a fix', tone: 'amber' }, ': ' + hc.says + (hc.fix ? '. Fix: ' + hc.fix : '')],
      verb ? 'Press to ' + verb.does.replace(/^runs/, 'run').replace(/^copies/, 'copy') : 'Press to open Home in the AskerDo pane');
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
  return segs.some((s) => !s.empty) ? { segments: segs, mark: markSeg(elsewhere, now, here, version) } : null;
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
/* A ring letter's baseline that centers its ink on y 10: Segoe UI ink above and below the
   baseline in em, measured in Edge 2026-10-23; the font's middle line drew capitals 1 px low. */
const INK = { cap: [0.71, 0.016], asc: [0.75, 0.016], desc: [0.516, 0.234], x: [0.516, 0.016] };
function inkBaseline(ch, size) {
  const [up, down] = INK[/[A-Z0-9]/.test(ch) ? 'cap' : 'bdfhiklt'.includes(ch) ? 'asc' : 'gjpqy'.includes(ch) ? 'desc' : 'x'];
  return Math.round((10 + ((up - down) * size) / 2) * 100) / 100;
}
const RING_FONT = 11;
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
  /* the tuned letters for the bigger hole, C half a px left; the hinted
     letter moves in whole pixels, and at 11 its clear rows measured equal at 1x, 1.5x, 1.75x and 2x */
  return out + '<text x="' + (pic.letter === 'C' ? 9.5 : 10) + '" y="' + inkBaseline(pic.letter, RING_FONT) + '" font-family="Segoe UI, system-ui, sans-serif" font-size="' + RING_FONT + '" font-weight="800" text-anchor="middle"'
    + ' class="f-' + (pic.blank ? 'dim' : 'rest') + '">' + pic.letter + '</text>';
}
/* half a unit below the box's middle: the shield's weight sits at its top */
const SHIELD = 'M8 2.1L13.2 4.1V8.1C13.2 11.4 11 13.8 8 15.1C5 13.8 2.8 11.4 2.8 8.1V4.1Z';
/* the band's speech bubble, the questions' marks and the tooltips' question leads */
const BUBBLE = 'M4 2H12A2.5 2.5 0 0 1 14.5 4.5V8.5A2.5 2.5 0 0 1 12 11H8.2L4.6 14.2V11H4A2.5 2.5 0 0 1 1.5 8.5V4.5A2.5 2.5 0 0 1 4 2Z';
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
  ldFolder: ['<path d="M2 4.6A1.1 1.1 0 0 1 3.1 3.5H6.1L7.6 5.1H12.9A1.1 1.1 0 0 1 14 6.2V12.4A1.1 1.1 0 0 1 12.9 13.5H3.1A1.1 1.1 0 0 1 2 12.4Z"/>', 'Folder, the workstream', [2, 2.4, 14, 14.6]],
  /* Home's folder and branch line, and the AskerDo button's tooltip */
  ldDir: ['<path d="M2 4.6A1.1 1.1 0 0 1 3.1 3.5H6.1L7.6 5.1H12.9A1.1 1.1 0 0 1 14 6.2V12.4A1.1 1.1 0 0 1 12.9 13.5H3.1A1.1 1.1 0 0 1 2 12.4Z"/>', 'Folder, the session folder', [2, 2.4, 14, 14.6]],
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
  ldLoose: [PAGE, 'A page, the loose files due', [3.2, 2.2, 12.4, 13.8]],
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
};
function markSource(face, gap = 0) {
  const ring = face === 'quiet';
  const rule = (i) => '.g0{stop-color:' + MARK_INK.g0[i] + '}.g1{stop-color:' + MARK_INK.g1[i] + '}.g2{stop-color:' + MARK_INK.g2[i] + '}'
    + '.k{stroke:' + MARK_INK.check[i] + '}.m{' + (ring ? 'stroke' : 'fill') + ':' + MARK_INK[face][i] + '}';
  const marker = ring ? '<circle cx="50.6" cy="14.5" r="6.5" stroke-width="5.7" fill="none" class="m"/>' : '<circle cx="50.6" cy="14.5" r="9.35" class="m"/>';
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

/* a band question card's picture, the mark's tray face for its state */
export function facePicture(blocking) {
  return { source: markSource(blocking ? 'blocking' : 'waiting'), alt: 'AskerDo mark, ' + (blocking ? 'a blocking question' : 'a waiting question'), width: 20, height: 20 };
}

/* A segment's picture as the renderer's Svg takes it; `gap` leaves room before a label. */
export function statusPicture(pic, gap = 0) {
  if (pic.kind === 'mark') {
    const alt = 'AskerDo mark, ' + (pic.face === 'quiet' ? 'nothing waiting' : pic.blocking + ' blocking, ' + pic.waiting + ' waiting') + ' elsewhere';
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
const STATION_ALT = { now: 'A filled station, running', left: 'A half-filled station, in progress with nobody on it', ready: 'A ringed station, ready to start', gated: 'An amber station, held by a question', waits: 'A grey station, waiting' };
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
function barBody(cells, max = BAR_MAX) {
  const cap = Number(max) > 0 ? Math.min(BAR_MAX, Number(max)) : BAR_MAX;
  const n = Math.max(1, cells.length);
  let cw = 14, gap = 2;
  if (n * (cw + gap) - gap + 2 > cap) { gap = n > 24 ? 1 : 2; cw = Math.max(1, (cap - 2 - (n - 1) * gap) / n); }
  const body = cells.map((k, i) => {
    const x = 1 + i * (cw + gap);
    const ring = (k === 'ready' || k === 'gated') && cw >= 4;
    /* a held finish, an amber padlock as tall as the cells and their room */
    if (k === 'lock') {
      const m = x + cw / 2;
      return '<path d="M' + f2(m - 2.4) + ' 9V7.2A2.4 2.4 0 0 1 ' + f2(m + 2.4) + ' 7.2V9" fill="none" stroke-width="1.4" class="s-amber"/><rect x="' + f2(m - 3.6) + '" y="9" width="7.2" height="5.4" rx="1.2" class="f-amber"/>';
    }
    if (ring) return '<rect x="' + f2(x + 0.7) + '" y="7.7" width="' + f2(cw - 1.4) + '" height="4.6" rx="1.6" fill="none" stroke-width="1.4" class="s-' + (k === 'ready' ? 'sky' : 'amber') + '"/>';
    const cls = k === 'done' ? 'rest' : k === 'now' || k === 'ready' ? 'sky' : k === 'gated' || k === 'review' ? 'amber' : 'track';
    return '<rect x="' + f2(x) + '" y="7" width="' + f2(cw) + '" height="6" rx="' + (cw >= 4 ? 2 : 0.5) + '" class="f-' + cls + '"/>';
  }).join('');
  return { w: Math.ceil(n * (cw + gap) - gap + 2), body };
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
/* a desktop cell is 8.453 px (14 px Anthropic Sans, desktop-capabilities); its words are measured
   in the pane's Segoe UI widths. A chip past its words: the 18 px badge, a 1 px border each side,
   then its padding and gap, 2.1 cells with words (status.tsx CHIP) */
const DESK_CELL = 8.453;
/* Home's fold ring ending the row, 24 px and a cell before it (fold.tsx FOLD_CELLS) */
const FOLD_ROOM = 4;
/* the cells the row needs: its chips with their words (named) or the letters alone, the name up to nameCells;
   band.tsx asks it whether Home's row holds the whole name */
export function rowNeed(q, o, named, nameCells, gap) {
  const desk = o.surface === 'desktop';
  const w = desk ? (s) => paneMeasure(s, 14, 400) / DESK_CELL : cellWidth;
  const star = (a) => (q.pick === a.letter ? STAR + ' ' : '');
  const words = (a) => (named && a.option ? a.option : '');
  /* a desktop chip with no star or words is the badge in half a cell each side; a terminal chip
     its label, the letter's sky cell each side and the button's two */
  const said = (a) => star(a) + words(a);
  const chip = (a) => (desk ? 20 / DESK_CELL + (said(a) ? 2.1 + w(said(a)) : 1.2) : cellWidth(star(a) + a.letter + (words(a) ? ' ' + words(a) : '')) + 6);
  const tail = [o.age, o.closed].filter(Boolean).reduce((n, s) => n + gap + w(s), 0);
  /* the name sits one cell from its chips; the gap parts the chips from what follows */
  return (desk ? 3 : 2) + Math.min(w(q.name), nameCells) + (o.unfold ? FOLD_ROOM : 0) + 1 + tail + q.answers.reduce((n, a) => n + chip(a) + 1, 0);
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
  /* the user's Allow or Keep on an override the session asked */
  if (r.kind === 'override' && /^user:/.test(String(r.by || ''))) {
    const recs = Array.isArray(r.records) && r.records.length ? ' (' + r.records.map(flatLine).join(', ') + ')' : '';
    if (r.decided === 'changed') return 'I pressed Allow on override ' + flatLine(r.request || r.id) + recs + ', but it changed since you asked, so nothing was applied: ask again from the text as it stands.';
    if (r.decided === 'dropped') return 'I pressed on override ' + flatLine(r.request || r.id) + recs + ', but it had expired unanswered, so nothing was applied: ask again if it is still needed.';
    return 'I ' + (r.decided === 'allow' ? 'allowed' : 'kept as written') + ' override ' + flatLine(r.request || r.id) + recs
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

/* What waits as one text: the user's lines bare, then the relayed ones under their header. */
export function deliveryText(events, options = {}) {
  const evs = (events || []).map((e) => (typeof e === 'string' ? { line: e } : e)).filter((e) => e && e.line);
  const mine = [];
  const relayed = [];
  for (const e of evs) {
    const d = userLine(e, options);
    if (d) mine.push(d); else relayed.push('- ' + flatLine(e.line));
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
 * its options, so an answer's hover line names the option. */
export function inboxWaiting(events, options = {}) {
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
  const here = (e) => !!e.box && e.raw.by === 'user:' + e.box;
  const answered = evs.filter((e) => isAnswer(e) && e.raw.pick && e.raw.id && !here(e)).map((e) => ({ key: e.key, text: answerToast(line(e)) }));
  /* a woken question's toast, raised once per wake by the same key */
  const woke = evs.filter((e) => e.raw && e.raw.kind === 'wake').map((e) => ({ key: e.key, text: flatLine(e.line) }));
  const arrived = [...answered, ...woke];
  return { n: evs.length, answers: evs.every(isAnswer), lines: evs.map(line), keys: evs.map((e) => e.key), arrived };
}

/* "Q106 store shape: 106b, many files" as a toast; it wakes nothing. */
export const answerToast = (line) => 'Answered elsewhere: ' + line + '.';

const waitWord = (w) => (w.answers ? 'answer' : 'update') + (w.n === 1 ? '' : 's');
export const waitingLabel = (w) => w.n + ' ' + waitWord(w) + ' waiting';
export const submitTip = (w) => 'Starts one turn with the ' + w.n + ' ' + waitWord(w) + ' waiting for this session. Nothing starts a turn by itself.';

/* The band's waiting row and frozen mark on its model; the waiting row keeps the band drawn. */
const EMPTY_BAND = { questions: [], more: 0, total: 0, blocking: 0, waiting: 0 };
/* saved: the closed line is a receipt, which draws even where the pressed row has gone;
   queued: the user's answers queued on this PC until Send */
export function withWaiting(model, { inbox, closed, saved, queued } = {}) {
  const has = !!inbox && inbox.n > 0;
  const q = Number.isInteger(queued) && queued > 0 ? queued : 0;
  if (!model && !has && !q) return model;
  return { ...(model || EMPTY_BAND), inbox: has ? inbox : null, closed: closed || '', saved: !!saved, queued: q };
}

/* the band's and every open strip's count beside Send */
export const queuedLabel = (n) => n + (n === 1 ? ' answer queued' : ' answers queued');

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
export function marksFor(main, name, docs) {
  const n = nameOf(name);
  const w = main && Number.isInteger(main.window) && main.window > 0 && main.window < 100 ? main.window : 30;
  const x = main && Number.isInteger(main.wrap) && main.wrap > w && main.wrap < 100 ? main.wrap : Math.max(40, w + 1);
  /* the states and where each hands off, read once at the mark like the quick reference */
  const doc = (docs ? String(docs).replace(/[\\/]*$/, '/') : 'AskerDo\'s docs/') + 'handoff-timing.md';
  return [
    { kind: 'window', percent: w, note: capFirst(n) + '\'s ' + w + ' percent mark: pick the handoff boundary; running work continues. '
      + 'A handoff lands at a point it does not cut through: nothing the next session would have to piece back together, and nothing whose result would come back to this session after it is gone. '
      + 'From here finish what is in flight, start nothing that cannot finish by ' + x + ' percent, and hand off at the first such point; while ' + n + ' is actively engaged (a conversation, a sitting, a live look), never pick the point alone: finish with them, or ask where to break. '
      + 'Read ' + doc + ' once now: where each state hands off. ' + STOP_FIRST + ' '
      + 'Write the handoff\'s whereWeWere in your own words: ' + n + '\'s last exchange in their words, what was mid-thought, what was tried and dropped, rulings and preferences from this sitting never registered. handoff_write writes it on the track this session holds; with none held, name a workstream (workstream: WS-n) and it starts a track there named from the focus.' },
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
export function mainDepthNote(r, won, track) {
  const top = won[won.length - 1];
  const size = r.tokens ? kTok(r.tokens) + ' tokens (' + r.tokens + '), ' : '';
  let text = 'CONTEXT DEPTH (main session): ' + size + wholePercent(r) + ' percent of the '
    + (r.window ? kTok(r.window) + ' ' : '') + 'window, as the engine measures it. ' + top.note.replace(/[.\s]+$/, '') + '.';
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
export function depthText({ reading, main, told, name } = {}) {
  const [w, x] = marksFor(main, name);
  const from = main && main.profile ? 'set by the profile ' + main.profile : 'AskerDo\'s defaults; no profile sets them';
  const mark = (m, what) => what + ' at ' + m.percent + ' percent (' + (markTold(m, told) ? 'told this session' : 'not told yet') + ')';
  const marks = main && main.on === false ? 'The handoff marks are off (' + from + ').'
    : 'Marks: ' + mark(w, 'the handoff window') + ', ' + mark(x, 'the wrap line') + '; ' + from + '.';
  if (!reading || typeof reading.percent !== 'number') return 'No depth reading yet: the engine has not measured this session\'s context. ' + marks;
  const size = reading.tokens ? reading.tokens + ' tokens' + (reading.window ? ' of the ' + kTok(reading.window) + ' window' : '') : reading.window ? 'of the ' + kTok(reading.window) + ' window' : '';
  return 'Context: ' + wholePercent(reading) + ' percent' + (size ? ' (' + size + ')' : '') + ', as the band\'s C ring shows it. ' + marks;
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
    + kTok(g.soft) + ' and an urgent one past ' + kTok(g.hard) + (g.hardDeny ? ', where only the state note can be written' : '') + '.';
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
    + (guard.hardDeny ? ', after which only the state note can be written. ' : ', after which this reminder turns urgent. ')
    + 'Write your state note to the path your contract names (a file whose name ends '
    + 'in -state.md): what is done (commits, files, results), the exact next step, and the open '
    + 'points.' + noteHint(note) + ' ' + HANDOFF_ENDING + ' Only if finishing this step completes the whole job, end as '
    + 'your brief says instead.';
}

export function agentDenyReason({ tokens, guard, note }) {
  return 'CONTEXT DEPTH ' + kTok(tokens) + ' tokens, past the hard floor of ' + kTok(guard.hard) + WHY
    + 'a fresh agent continues this job from your state note and the files on disk. Only a Write or Edit to your '
    + 'state note (a file whose name ends in -state.md, at the path your contract names) passes now. '
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

/* a handoff has two triggers, the meter's window and the user's ask.
 * No reading yet counts as below the window. */
export function pastWindow({ percent, main, told }) {
  return (Array.isArray(told) && told.length > 0) || (typeof percent === 'number' && percent >= marksFor(main)[0].percent);
}
export function handoffGate({ percent, main, told, asked, name }) {
  const n = nameOf(name);
  if (asked || pastWindow({ percent, main, told })) return { open: true };
  const at = typeof percent === 'number' ? 'the context is at ' + percent + ' percent' : 'the context meter has no reading yet';
  return { open: false, deny: 'handoff_write refused: ' + at + ', below the ' + marksFor(main)[0].percent
    + ' percent handoff window, and ' + n + ' did not ask for a handoff. A step that waits on ' + n + ' is asked here and run here. '
    + 'When ' + n + ' asked for one in chat, call again with askedInChat: ' + n + "'s words, quoted; "
    + n + ' also opens one with /askerdo handoff (or /askerdo park).' };
}

/* what a handoff write left undecided. */
export function handoffFilesNote(r) {
  const u = r && Array.isArray(r.undecided) ? r.undecided : [];
  return u.length ? 'Left undecided (no disposition given): ' + u.map((x) => flatLine(x.path)).join(', ') + '.' : '';
}

/* a handoff close hands the user the resume command alone, ready to copy;
   a plain fence, since a shell tag would draw a Run button for a prompt command. */
export const resumeBlock = (thread) => '\u2b07\ufe0f Resume ' + thread + ' in a new session:\n```text\n/askerdo resume ' + thread + '\n```';
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
  return repos.map((r) => 'Verify first: ' + flatLine(r.path) + (r.ok ? ' passes' : ' FAILS: ' + (r.problems || []).map(flatLine).join('; ')))
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
  lines.forEach((l, i) => {
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
  const body = at < 0 ? '' : hideTold(lines.slice(0, at).join('\n'), questions).replace(/\s+$/, '');
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
export const namesBoardId = (text) => ID_WORD.test(String(text || ''));
export const isHubShell = (cmd) => /askerdo[\\/]cli\.mjs|bin[\\/]askerdo\.mjs/.test(String(cmd || ''));
export const isHubRegister = (cmd) => isHubShell(cmd) && /(?:cli|askerdo)\.mjs["']?\s+register\b/.test(String(cmd || ''));
/* a hub command that asks or decides an override, which an agent never runs */
export const isHubOverride = (cmd) => isHubShell(cmd) && /(?:cli|askerdo)\.mjs["']?\s+override\s+(?:request|decide|unscrub)\b/.test(String(cmd || ''));

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
const reversalLead = (o) => 'Reversal of ' + overrideOn(o) + ': ' + (o.kind === 'withdraw' ? 'withdraws a ruling as never made' : 'fixes the text of a ruling') + ', asked alone';

/* The block the reply carries whole (the stored message, the phone); one paragraph, so the
   desktop finds it by its head and its two typed answers and draws the card instead. */
export function overrideBlock(o) {
  const on = overrideOn(o);
  const lines = [o.reversal ? '**' + reversalLead(o) + ' (override #' + o.request + ')**' : '**Override #' + o.request + ': ' + overrideWhat(o) + '**'];
  lines.push('- ' + o.summary);
  if (o.measured) lines.push('- Measured by the board: ' + o.measured);
  if (o.records.length > 1) lines.push('- Records: ' + o.records.join(', '));
  if (o.url) lines.push('- Before and after: ' + o.url);
  lines.push('- Your answer: allow ' + on + ' or keep ' + on);
  return lines.join('\n');
}

/* The tool's answer: the block and how its answers come back. */
export function overrideResult(o, name) {
  const n = nameOf(name);
  const on = overrideOn(o);
  return 'Override #' + o.request + ' waits on ' + n + '\'s Allow or Keep. Put this block in your reply as written'
    + (o.reversal ? ', in a reply with no other question (a reversal is told alone)' : '') + '; where the mod draws, it is the card under the reply:\n\n'
    + overrideBlock(o) + '\n\n'
    + n + '\'s press, anywhere, reaches this session. If ' + n + ' types allow ' + on + ' or keep ' + on + ' in chat, record it: `override decide '
    + on + ' allow` (or keep) `--user <own-id>`, their act.';
}

/* The card's model: the reversal lead, the head, what the board measured, the page, and the
   presses while it waits; saving: the decision a press is saving. */
export function overrideCard(o, saving, now = Date.now()) {
  /* judged on read, as the board does: past its date it waits only for Keep to clear it */
  const expired = o.expires && Date.parse(o.expires) <= now;
  const state = saving ? 'saving' : o.decided || (expired ? 'expired' : 'open');
  const count = o.records.length;
  const LINES = {
    saving: GLYPHS.pending + ' Saving your ' + (saving === 'allow' ? 'Allow' : 'Keep'),
    allow: 'Allowed: the change is applied.',
    keep: 'Kept as written: nothing was changed.',
    changed: 'Changed since asked: Allow is refused. Keep clears it, and the session asks again from the text as it stands.',
    expired: 'Expired unanswered: Allow is refused. Keep clears it, and the session asks again if it is still needed.',
    dropped: 'Closed unanswered: nothing was applied.',
  };
  const press = (decision) => ({ decision, label: decision === 'allow' ? 'Allow' : 'Keep' });
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
  const answers = (u) => u.kind === 'para' && typed('allow').test(u.text) && typed('keep').test(u.text);
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

export function localResult(label, payload, notes = []) {
  const letters = (payload.options || []).map((o) => o && o.type).filter((t) => /^[a-z]$/.test(t || ''));
  const parts = ['Kept ' + label + ' (' + flatLine(payload.name) + ') with this session'];
  if (letters.length) parts.push('answer tokens ' + letters.map((l) => token(label, l)).join(', '));
  if (payload.pick) parts.push('pick ' + token(label, payload.pick));
  return parts.join('; ') + '. It stays with this session and reaches the board only if the session uses AskerDo;'
    + ' the band and the card answer it, and its answer reaches you as the usual note.'
    + notes.map((n) => '\nNote: ' + n).join('') + pasteLine(tellBlock({ ...payload, id: label }, letters));
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

/* The checks on one reply: each flags, never rewrites. `all` is every
 * text block of the turn, `answer` the final reply; `checks` the saved options,
 * `band` whether the band draws here, `windowTold` whether the meter reached the
 * handoff window, `handoffAsked` the user's ask, `receipts` the answers delivered
 * before this reply (receiptsOf), `resume` the thread a handoff of this turn wrote, `carry`
 * the block of a handoff the board did not take this turn (carryBlock), `held` the track the session holds. */
export function replyChecks({ answer, all, checks = {}, band = false, windowTold = true, handoffAsked = false, receipts = [], resume = '', carry = '', held = '', inbox = [], name } = {}) {
  const slips = [];
  const reply = String(answer || '');
  const every = all == null ? reply : String(all);
  if (checks.emdash && /[\u2013\u2014]/.test(every)) slips.push({ id: 'dash', say: 'em or en dashes' });
  /* each delivered token named somewhere in the turn's text */
  const owed = [...new Set((receipts || []).map((x) => String((x && x.token) || x || '')).filter(Boolean))];
  const missed = owed.filter((t) => !new RegExp('\\b' + t.replace(/[^\w]/g, '\\$&') + '\\b', 'i').test(every));
  if (missed.length) slips.push({ id: 'receipt', say: 'no receipt line for ' + missed.join(', ') });
  /* a turn that wrote a handoff hands the user the resume command in a copy block */
  if (resume && !resumeFence(resume).test(reply)) slips.push({ id: 'resume', say: 'a handoff close without `/askerdo resume ' + resume + '` alone in a fenced copy block above the footer' });
  /* a handoff the board did not take rides the reply whole, so the leg is not lost */
  if (carry && !carried(every, carry)) slips.push({ id: 'carry', say: 'a handoff the board did not take, not carried whole: the reply holds the fenced block its failed result handed you, exactly as written' });
  /* a close's inbox items still unplaced at the turn's end, each named in the reply (carried or asked about) */
  const unnamed = [...new Set((inbox || []).map(String).filter(Boolean))].filter((t) => !new RegExp('\\b' + t.replace(/[^\w]/g, '\\$&') + '\\b').test(every));
  if (unnamed.length) slips.push({ id: 'inbox', say: 'a close that skipped its inbox: ' + unnamed.join(', ') + (unnamed.length === 1 ? ' is' : ' are')
    + ' still unplaced and the reply never names ' + (unnamed.length === 1 ? 'it' : 'them') + '; put each on a track, move it to its workstream, or carry or ask about it in the reply' });
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
    /* a close by handoff: the finished flag or a fenced kickoff, with handoff words in
       prose; a footer that only names a kickoff fix is a mid-arc status */
    const byHandoff = (foot && foot.glyph === FLAG) || ownKickoff(reply, [resume, held]);
    if (byHandoff && HANDOFF_WORDS.test(prose(reply)) && !windowTold && !handoffAsked) {
      slips.push({ id: 'handoff', say: 'an early handoff: the context meter never reached the window and ' + nameOf(name) + ' did not ask (in chat or through /askerdo handoff); a step that waits on ' + nameOf(name) + ' is asked here and run here' });
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
export function offTrackSlip({ dispatched = 0, commits = 0, holding = false, track = '', onboarding = false } = {}) {
  /* an onboarding run writes nothing to the board before the user's go, so it has no task to hold */
  if (holding || onboarding || !(dispatched > 0 || commits > 0)) return null;
  const ran = [dispatched > 0 ? counted(dispatched, 'agent dispatch', 'agent dispatches') : '', commits > 0 ? counted(commits, 'commit', 'commits') : '']
    .filter(Boolean).join(' and ');
  const fix = track ? 'take the step\'s task in hand (task_update with inHand) or lay it out on ' + track + ' first'
    : 'start or resume the track the work belongs to';
  return { id: 'off-track', say: ran + ' with no task in hand, so the track never shows the work: ' + fix };
}

/* the inbox a hub shell close (track finish or drop, handoff write) printed, its ids and
   the closed track; the JSON form or the kickoff's Inbox line. Null for any other command. */
const CLOSES = ['track finish', 'track drop', 'handoff write'];
export function closedInbox(command, stdout) {
  const cmd = String(command || '');
  if (!isHubShell(cmd) || !CLOSES.includes(hubVerb(cmd).verb)) return null;
  const out = String(stdout || '');
  let j = null;
  try { j = JSON.parse(out); } catch {}
  const at = (s) => { const m = /\bTR-\d+\b/.exec(String(s || '')); return m ? m[0] : ''; };
  if (j && typeof j === 'object' && Array.isArray(j.inbox)) {
    return { track: at(j.track) || at(j.id) || at(cmd), ids: j.inbox.map((t) => String((t && t.id) || '')).filter(Boolean) };
  }
  const line = /^Inbox \((\d+)\): (.*)$/m.exec(out);
  const ids = line ? line[2].split('; ').map((x) => (/^T-\d+\b/.exec(x) || [''])[0]).filter(Boolean) : [];
  /* the line names at most ten; `more` sends the turn-end check to the board's whole list */
  return { track: at(cmd) || at(out), ids, ...(line && Number(line[1]) > ids.length ? { more: true } : {}) };
}

/* the reply closed finished, the flag the handoff check above reads. */
export function closedFinished(answer) {
  const reply = String(answer || '');
  const foot = footerOf(reply);
  return foot ? foot.glyph === FLAG : forecastOf(firstLine(reply)) === FLAG;
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
    slips.push({ id: 'tests', say: 'the brief runs tests without the testing rule (targeted files while working, one full run at the end; docs/procedures/run-tests.md)' });
  }
  return slips;
}

/* A brief that runs tests carries the rule, or points at the procedure or a brief
 * file that does (docs/procedures/run-tests.md). */
const TESTS_NAMED = /\b(?:tests?|suite|node --test)\b/i;
const TARGETED = /\b(?:targeted|only the (?:test )?files? (?:you|it|they) (?:touch|change|break)|test files you touch)/i;
const ONE_FULL = /\b(?:one full (?:run|suite)|full (?:run|suite) once|(?:skip|no) (?:the )?full (?:run|suite)|full (?:run|suite) (?:only )?at the end)/i;
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

/* the tasks a dispatch serves: the T-n ids in its description, its
   prompt's first line and each brief file's first heading, never a passing mention. */
export function tasksOfDispatch(input, briefs = []) {
  const p = input && typeof input === 'object' ? input : {};
  const heads = (briefs || []).map((b) => String(b || '').split(/\r?\n/).find((l) => /^#{1,6}\s/.test(l)) || '');
  const out = [];
  for (const s of [p.description, firstLine(p.prompt), ...heads]) {
    for (const m of String(s || '').matchAll(/\bT-\d+\b/g)) if (!out.includes(m[0])) out.push(m[0]);
  }
  return out;
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

/* The rules block appended once per revision; the brief's own words stay as written. */
export function withRules(prompt, r) {
  const p = String(prompt || '');
  if (!r || !r.inject || !r.text || !r.revision || p.includes('Rules in force (AskerDo rev ' + r.revision)) return p;
  return p + '\n\n' + r.text;
}

/* ---- decisions ---- */

const DECIDE_LISTS = ['tasks', 'tracks', 'workstreams', 'files', 'commands', 'labels'];
const DECIDE_KEYS = ['title', 'words', 'body', 'question', 'supersedes', 'global', ...DECIDE_LISTS];

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
  if (e.length) return { error: e.join('; ') };
  const payload = {};
  for (const k of DECIDE_KEYS) if (p[k] !== undefined && k !== 'supersedes') payload[k] = typeof p[k] === 'string' ? p[k].trim() : p[k];
  if (sup.length) payload.supersedes = sup.map((s) => s.trim());
  return { payload };
}

const ruling = (d) => String(d.id) + ' ' + flatLine(d.name).replace(/[.\s]+$/, '');
const quoted = (w, max) => { const s = flatLine(w); return s.length > max ? s.slice(0, max - 3).trimEnd() + '...' : s; };

/* What the decide tool answers, from the CLI's JSON. */
export function decidedText(r) {
  const on = [...(r.tasks || []), ...(r.tracks || []), ...(r.workstreams || [])];
  const gov = [...(r.files || []), ...(r.commands || [])];
  return ruling(r) + ' recorded' + (on.length ? ' on ' + on.join(', ') : '')
    + ((r.superseded || []).length ? '; it supersedes ' + r.superseded.join(', ') : '') + '.'
    + (gov.length ? ' A call touching ' + gov.join(', ') + ' now gets its pointer.' : '');
}

/* The one line a call touching a ruling gets, once a loop. */
export function decisionNote(d, why, name) {
  const words = d.words ? quoted(d.words, 300) : '';
  return 'AskerDo decision pointer (nothing was blocked): ' + why + ': decision ' + d.id + ' (' + ruling(d).slice(String(d.id).length + 1) + ') governs it.'
    + (words ? ' ' + capFirst(nameOf(name)) + ' said: "' + words + '"' + (/[.!?]$/.test(words) ? '' : '.') : '')
    + ' Hold to it; going against it needs ' + nameOf(name) + "'s say first.";
}

/* an edit's answer, one wording for the CLI and the tool: a hand that moved
 * leads in its own words, the other changes after it. */
export function editWords(r, unchanged) {
  const hand = r.hand === 'taken' ? ' taken in hand' : r.hand === 'let go' ? ' let go' : '';
  const rest = (r.changed || []).filter((k) => !(hand && k === 'inHand'));
  return r.id + hand + (rest.length ? (hand ? ', ' : ' ') + 'updated: ' + rest.join(', ') : hand ? '' : unchanged);
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
/* the decisions a brief shows, which count as read by its session */
export const briefDecisionIds = (decisions, max = 10) => decisionList(decisions).slice(0, max).map((d) => d.id);

export function decisionsBlock(tasks, decisions, max = 10) {
  const list = decisionList(decisions);
  if (!list.length) return '';
  const lines = list.slice(0, max).map((d) => '- ' + ruling(d) + (d.words ? ': "' + quoted(d.words, 200) + '"' : ''));
  if (list.length > max) lines.push('- and ' + (list.length - max) + ' more: askerdo decisions --task T-n reads them');
  return 'Decisions in force on ' + tasks.join(', ') + ' (AskerDo; hold to them, and say in your report before going against one):\n' + lines.join('\n');
}

export function withDecisions(prompt, block) {
  const p = String(prompt || '');
  return !block || p.includes(block.split('\n')[0]) ? p : p + '\n\n' + block;
}

export const flagLine =(what, slips) => 'AskerDo: ' + what + ': ' + slips.map((s) => s.say).join('; ') + '. Flagged, not rewritten.';

export function flagNote(items, name) {
  return 'AskerDo contract check (a flag; nothing was rewritten): '
    + items.map((x) => x.what + ': ' + x.slips.map((s) => s.say).join('; ')).join('. ')
    + '. Take it into the next reply without remarking on it unless ' + nameOf(name) + ' asks.';
}

