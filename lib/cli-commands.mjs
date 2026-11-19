/* The AskerDo CLI's commands: runCommand({ argv, cwd,
 * env, stdin, tty }) parses argv, reads creation payloads as JSON on stdin, runs
 * each command on the one board the board URL names (lib/board-call.mjs), maps
 * errors to the exit contract and hands back { code, stdout, stderr }. The local
 * server runs it for every caller at once, so nothing here reads process.cwd(),
 * process.env or process.stdin, or changes directory: the caller's are arguments.
 * bin/askerdo.mjs is the launcher.
 *
 *   exit 0  success
 *   exit 1  bad input, a board refusal, or no board set (UsageError)
 *   exit 2  any other failure
 *
 * stdout carries results only; stderr carries diagnostics only. --json on
 * every verb prints one JSON object (or array, for list).
 */
import { UsageError, canonLabel, parseLegacyToken } from '../server/verbs/labels.mjs';
import { API, WEB } from '../server/paths.mjs';
import { timingRow, timingSummary } from '../server/timings.mjs';
import { atWords, holderWords, wordLine } from '../server/web/feed.mjs';
/* the ONE authority on an answer token: the brief prints what the user
   types, composed, and never spells the composition out here */
import { answerToken, answeredPick } from './answer-token.mjs';
import { KIND_WORDS, runsInCaller } from './caller-runs.mjs';
import { DEFAULT_CONFIG, dataDir, loadConfig, pluginRoot, pluginVersion, seamRootProblem, shippedCommits, storeRoot } from './node-helpers.mjs';
import { appendLog, writeAtomic } from './store-io.mjs';
import { setPluginUpdates } from './plugin-updates.mjs';
import { compareStamps } from './stamps.mjs';
import { boardIdentity, ensureBoardServer, isLiveRoot, pingBoard } from './board-ensure.mjs';
import { HOST_ONLY, boardAnswers, heldBy, holdBoard, hostDir, hostEnv, hostLog, hostProblem, hostedHere, prepareHost, readHost, releaseBoard, retireHost, stopHostedBoard, waitForBoard } from './board-host.mjs';
import { backupNow, backupsFolderProblem, copyDirs, listCopies, moveCopy, restoreHere } from './board-backup.mjs';
import { effectiveText, heldText, rulesBlock, rulesText, settingsText } from './profiles.mjs';
import { CONTRACT_KEYS, checkSetting, contractOf, listCopy, settingRows, settingsListText, tabsOf, withPcRows, wordsOf } from '../server/verbs/profile-rules.mjs';
import { checkoutOf, repoOf, sharedName, shortName } from './project-id.mjs';
import { entryDrift, forgetInMap, learnProjects, readMap, renameInMap, scanProjects, unmappedLine } from './project-map.mjs';
import { handoffDirOf, seedHandoffDir } from './handoff-check.mjs';
import { stepProblems } from './handoff-payload.mjs';
import { commitWords, dueFilesLine, editWords, filedWords, handoffCheckLine, leftAskLine, openWordsWarning, removedLine, statusProblem, tellBlock, untakenMark, verifyLines, versionWords } from './mod-core.mjs';
import { boardVersion } from '../server/version.mjs';
import { cardsHere, cardsMapped, checkProcedures, placeOf, ranOnBoard, scanOnBoard } from './procedures.mjs';
import { checkText, draftsText, findCards, outcomeWords } from './proc-match.mjs';
import { rewriteOffer, droppedTexts, droppedWords, amendedWords, titleLine } from './note-scope.mjs';

/* a rewrite the board dropped is a failed rewrite: said on stderr, the exit not 0 */
function tellDropped(cx, id, fields) {
  if (!fields.length) return;
  cx.err(droppedWords(id, fields) + '\n');
  cx.exit = 2;
}
import { OPTION_KEYS, saveContract, saveToBoard } from './contract-save.mjs';
import { QrCode } from './qr-code.mjs';
import { mkdirSync, readFileSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import {
  boardCall, boardHealth, boardJoin, boardJoinCode, boardLoginLink, boardRequest, joinLine, loginUrl, phoneUrl, protocolProblem, reachableUrl, boardToken, boardUrl, deviceName, localServerUrl, localSetUrl as boardHome, openSetUrl as boardSetUrl, pageUrl, signedPage, webBase,
} from './board-call.mjs';
import { hereLines, kickoffHere, launcherHere, pcName, placesHere, resumeTrackSession, scanCommits, trackShelf, updateTrackHandoff, writeTrackHandoff } from './tracks-session.mjs';
import { runSweep, sweepText, transcriptsDir } from './sweep.mjs';
import { CLI, aimLines, inboxLines } from '../server/handoff-text.mjs';
import { citedWords } from '../server/verbs/proc-cards.mjs';

/* ---- helpers the board paths share ---------- */

/* the board's search cap (server/verbs/search.mjs), here so a CLI run never loads SQLite */
const HITS_MAX = 50;

const isQuestionToken = (id) => /^[Qq]\d{1,15}$/.test(String(id).trim());

/* A project as the board keeps it: an absolute directory, forward slashes. */
function normProject(v) {
  if (typeof v !== 'string' || !v.trim()) throw new UsageError('a project is a directory path');
  const dir = v.trim().replace(/\\/g, '/').replace(/(.)\/+$/, '$1');
  if (/^[A-Za-z]:\//.test(dir) || dir.startsWith('/')) return dir;
  throw new UsageError('a project is an absolute directory: ' + v);
}

/* A journal's notes: each starts with its stamp on a line after a blank one. */
const ENTRY_RE = /^(\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2})?): /;

function journalEntries(text) {
  const lines = String(text || '').split('\n');
  const out = [];
  let cur = null;
  lines.forEach((line, i) => {
    const m = (i === 0 || lines[i - 1].trim() === '') ? ENTRY_RE.exec(line) : null;
    if (m || !cur) { cur = { stamp: m ? m[1] : '', lines: [] }; out.push(cur); }
    cur.lines.push(line);
  });
  return out.map((e) => ({ stamp: e.stamp, text: e.lines.join('\n').trim() })).filter((e) => e.text);
}

function sliceJournal(text, { tail, since } = {}) {
  const all = journalEntries(text);
  let kept = all;
  if (since) kept = kept.filter((e) => e.stamp && compareStamps(e.stamp, since) >= 0);
  if (tail !== undefined) kept = tail === 0 ? [] : kept.slice(-tail);
  return { text: kept.map((e) => e.text).join('\n\n'), kept: kept.length, total: all.length };
}

/* a workstream's outcomes in the user's words, by id. */
const outcomeList = (r) => Object.entries(r && r.outcomes && typeof r.outcomes === 'object' && !Array.isArray(r.outcomes) ? r.outcomes : {})
  .map(([id, t]) => ({ id, text: String(t) }));

/* An old brain id's mapping, the line show prints above its target. */
const mappingLine = (key, entry) => key + ' is ' + (entry.to ? entry.label || entry.to : 'archived at ' + entry.archive);

/* Where the board serves an archived brain path (the archive sits beside its database), or null. */
function archiveUrl(entry, env) {
  const base = webBase(env);
  return base && entry && entry.archive ? base + WEB.archive(String(entry.archive).replace(/^archive\//, '')) : null;
}

/* One row per subcommand: the kinds take kind-scoped subcommands ('ws create',
   'task edit') and the kind-neutral verbs route by id. 'multi' names the value
   flags that accumulate across repeats; every other value flag keeps the last. */
const EDIT_LISTS = ['add-label', 'remove-label', 'add-ref', 'remove-ref'];
const WS_EDIT_LISTS = EDIT_LISTS.concat(['add-project', 'remove-project', 'add-outcome', 'remove-outcome']);
const HANDOFF_FLAG = 'its handoff folder (rules.md, map.md), absolute or under its first project; a new one is made from templates/handoff/';
const KNOWLEDGE_VALUES = ['type', 'title', 'project', 'label', 'ref', 'file', 'body-file', 'legacy', 'created', 'session'];
const KNOWLEDGE_LISTS = ['project', 'label', 'ref', 'file'];
/* a session editing a file one of these globs takes is pointed at the record */
const FILE_FLAG = 'a file glob relative to the repo root, as a procedure card takes; an edit of a matching file points the session at the record; a leading (read), (search) or (edit read) names the calls that point instead';
const SCOPE_FLAG = 'a review task reads track (its own track, the default) or project (every code task in the project since the last project-wide review)';
const LEFTOVER_WAKE = 'with --leftovers inbox: the wake each open task takes into the inbox ("track-ends TR-n", "task-completes T-n", "question-answered Q-n" or a date YYYY-MM-DD)';
/* a close's leftovers, read on stdin as handoff write and track layout read theirs */
const LEFTOVERS_STDIN = 'with --leftovers: a JSON list of steps [{ "name", "tier", "track", "workstream", "runBy", "task", "after", "before", "description", "priority", "newTrack", "unparkWhen", "unplaced", "wake", "whyElsewhere", "last", "here", "check" }]; each names its tier (2, 3 with track or unparkWhen, 4 with workstream and a track there or a wake); a step at a real place on the track the session holds (before an open task there) files at once, while a step last on that track (last, with why nothing there needs it sooner) or off it (tier 3 or 4, with whyElsewhere) is asked of the user first and carries here ({ "before": ["T-n"], "after": ["T-n"] }), the real place on the held track it would otherwise take, left out when nothing there waits on it; every step carries its description (the job the new task holds and what done looks like) unless it names an existing task, and check names an open checklist step by its number in place of a name and description';
const LEFTOVERS_FLAG = 'with --status done or dropped: read the steps this close leaves from stdin, each a task filed with the close: on its track, on a new track parked until its unparkWhen (newTrack), or in the inbox with its wake (unplaced); a refused step closes nothing';
const MOVES_STDIN = 'a JSON list of moves, each naming an open step by its number (check) and one destination: { "check", "onto": "T-n" } adds it to that open task\'s steps, { "check", "question": "Q-n" } names a question already asked, and { "check", "runBy", "tier", ...the leftover fields } files it as a new task as a leftover is (its description left out, the step\'s number, task and text)';
const MOVES_FLAG = 'read the moves of open steps this task\'s worker will not do from stdin: each step is struck with where it went; a refused move writes nothing, and a close with --leftovers goes in its own call';
const PLACE_FLAGS = {
  track: 'TR-n: the track it goes on', before: 'a T-n on that track that waits on it (repeatable)', after: 'a T-n on that track it waits on (repeatable)',
  unplaced: 'why no plan reaches it, so it waits in the inbox (the found list shows it); work that starts later goes on a parked track instead',
  wake: 'what brings an inbox task back, "track-ends TR-n", "task-completes T-n", "question-answered Q-n" or a date YYYY-MM-DD after today; every filing to the inbox names one, and alone it wakes an inbox task again (a third wake in one inbox stay asks the user instead); next-session keeps a task on its track waiting until a session other than the one that files it takes the track (with --tier 2 on the track you hold, --tier 3 with --track on another, --tier 4 with --track in another workstream, or alone on a task on a track)',
  tier: "where the work goes, which a session's filing names: 2 the track the session holds (--before what must not finish without it files at once; --last with why nothing there needs it sooner is asked of the user first, with --here-before when a task there waits on it), 3 another track in its workstream (--track) or work that starts after an event (--unpark-when), 4 another workstream (--workstream, with --track there or --wake); the board refuses a tier that does not fit and names the call that does",
  'new-track': 'with --tier 3 and --unpark-when: the name of the parked track the event opens (left out, the task\'s name)',
  'unpark-when': 'with --tier 3: the event that opens the new parked track, "track-ends TR-n", "task-completes T-n" or "question-answered Q-n"',
  'why-elsewhere': "with --tier 3 or 4 from a session that holds a track: one line on why that track does not cover the work, the reason the placement question shows the user; one parked on, or woken by, that track's own end, task or question adds after a semicolon why it cannot start sooner",
  last: "with --tier 2 and no --before: one line on why nothing on the track you hold needs the task sooner, the reason the placement question shows the user; a tier 2 filing with neither --before nor --last is refused",
  'here-before': "with a filing the user is asked about (last, or off the track you hold): a T-n on that track that would wait on the work, the real place it takes if the user says do it here; left out when nothing there waits on it, and the question then has no do-it-here press (repeatable)",
  'here-after': 'with --here-before: a T-n the work would wait on at that place (repeatable)',
  question: "a placement question answered with let's talk (Q-n): this filing is the place the talk settled, let through once, with --words",
  words: "with --question: the user's words that settled the place, quoted whole",
  user: "the mark of {user}'s own command, which the board never asks about: the plugin sends it for a command {user} ran, and a session never does",
};
/* a filing past a real place on the held track creates nothing and asks the user; the CLI says so */
const askedLine = (a) => 'nothing filed: ' + a.id + ' asks the user where it goes, and its answer files it (`' + CLI + ' show ' + a.id + '`)';
/* a third wake's ask carries the wake it did not store; a placement's does not */
const placeAsked = (r) => (r && r.asked && typeof r.asked === 'object' && !('wake' in r) ? askedLine(r.asked) : '');
/* the --here-before and --here-after pair as the board's here */
const hereOf = (flags) => (flags['here-before'] === undefined && flags['here-after'] === undefined ? undefined
  : { before: [].concat(flags['here-before'] || []), after: [].concat(flags['here-after'] || []) });
/* the place, the talk and the user's own mark a filing verb sends beside its fields */
const placeExtra = (flags) => ({ ...(hereOf(flags) ? { here: hereOf(flags) } : {}), ...(flags.question !== undefined ? { question: flags.question, words: flags.words } : {}),
  ...Object.fromEntries(['before', 'after'].filter((k) => flags[k] !== undefined).map((k) => [k, [].concat(flags[k])])) });
/* a filing's tier as a number */
const tierOf = (v) => (v === undefined ? undefined : /^\s*\d+\s*$/.test(String(v)) ? Number(v) : v);
/* where the ladder put it */
function ladderWords(r) {
  if (!r || r.tier === undefined) return '';
  const l = r.ladder || {};
  return '\ntier ' + r.tier + (l.derived ? ' (derived from where it landed)' : '') + ': ' + (l.where || '') + (l.filled ? '; the board filled ' + l.filled.join(', ') : '')
    + (l.stations ? '; nearer stations: ' + l.stations.join(', ') : '') + (l.told ? '; a note on ' + l.told + ' tells its holder' : '')
    + (l.lookAlikes ? '\nopen tasks sharing its words (one that covers it takes a note, and this one is dropped): ' + l.lookAlikes.map((x) => x.id + ' ' + oneLine(x.name)).join('; ') : '');
}

/* `help` and `<verb> --help` print from this table, so help cannot drift
   from what the parser takes: each row's flags list is its values and bools,
   and `flags` only words them. */
const VERBS = {
  register: {
    values: [], bools: ['json'], id: false, stdin: 'JSON payload (docs/question-hub.md, "Registration")',
    help: 'register a question; left out, the track is the one the session holds and the workstream is that track\'s'
      + ' (else the workstream of the tasks it works, else the subscribed one)',
  },
  /* `amend` is a FLAG on answer and not a verb of its own, so a
     correction is one store function. */
  answer: {
    values: ['pick', 'note', 'session', 'user', 'version'], bools: ['json', 'amend'], id: true,
    help: 'record an answer: flip the question to answered and tell its subscribers',
    flags: { pick: 'the option: 106b, or the bare letter b', note: 'why, in words', amend: 'correct an answered question',
      version: 'the version the card showed: one before a rewording is refused; it never amends (--amend does)',
      user: 'the session {user} pressed a chip in: their act, told to that session too' },
  },
  drop: {
    values: ['note', 'session', 'user'], bools: ['json'], id: true, help: 'record a decline',
    flags: { note: 'why', user: 'the session {user} pressed drop in: their act, told to that session too' },
  },
  /* 'wake-on' is the flag parser's own spelling: a value flag is named by the
     text after '--', so the row carries the hyphenated word and the dispatch
     reads flags['wake-on'] (beside 'clear-workstream' below) */
  snooze: {
    values: ['until', 'trigger', 'wake-on', 'user', 'session'], bools: ['json'], id: true,
    help: 'hide a question until a wake condition (at least one flag; the first to fire wakes it)',
    flags: { until: 'YYYY-MM-DD', trigger: 'words that wake it', 'wake-on': '<record id>[:<ending status>]',
      user: 'the session {user} pressed snooze in: their act, told to that session too' },
  },
  wake: { values: ['user'], bools: ['json'], id: true, help: 'a snoozed question back to open',
    flags: { user: 'the session {user} pressed Wake in: their act' } },
  surface: { values: ['session'], bools: ['json'], id: true, help: 'bump asked, print the payload, subscribe the session' },
  list: {
    values: ['project', 'session', 'kind', 'workstream', 'track', 'status', 'priority', 'label'],
    bools: ['json', 'open', 'all', 'snoozed', 'blocking', 'names-line'], id: false,
    help: 'the open questions (or --kind work records), blockers first then oldest, one head line each',
    flags: {
      project: 'the project directory (scopes questions)', kind: 'workstream, task or knowledge',
      track: 'TR-n: the questions on that track',
      json: 'questions: { questions, openSetUrl }; work kinds: an array',
      'names-line': "the reply's names line for --project (default: the current directory), scoped by --session and --blocking; nothing when none is open",
    },
  },
  /* one readout of what is wrong with AskerDo on this PC, each problem with its fix */
  status: {
    values: [], bools: ['json'], id: false,
    help: "check AskerDo on this PC: the store, the settings and board join, the board, this PC's local server and tray, a copy an update replaced,"
      + ' and a git checkout install behind its upstream branch (after a fetch of a few seconds at most); one line each, every problem with the one command or step that fixes it',
    flags: { json: '{ ok, checks: [{ key, ok, says }], problems: [{ key, says, fix, command?, copy? }] }, command being the askerdo verb that fixes it here, copy a command to run in a shell or on another PC' },
  },
  board: {
    values: ['port'], bools: ['json', 'restart'], id: false,
    help: "start or adopt this PC's local server and print its URL, the board's address and database folder when this PC hosts the board, and this PC's AskerDo version and the board's with its server commit, with a line when the board runs an older version or a commit older than the one last shipped to it",
    flags: { restart: 'stop the running local server (through its own stop route, else by its process id) and start a fresh one on the same port' },
  },
  /* the board on a one-PC setup, with no container and no hand edits */
  'board here': {
    values: [], bools: ['json', 'seed'], id: false,
    help: "host the board on this PC: creates its database under the AskerDo store folder, has this PC's local server start it on 127.0.0.1 and keep it running,"
      + " and saves its address, this PC's token and hub mode in the AskerDo config, as join does; refused on a PC already on a board",
    flags: { seed: "put this PC's saved reply options on the new board's profile, which every PC that joins takes" },
  },
  /* growing to a board server is a move, not a rebuild */
  'board move': {
    values: [], bools: ['json', 'cancel'], id: false, optionalId: true, idWord: 'new board address',
    help: "move the board this PC hosts onto a board server (Docker or Node). The first run stops the board here, so nothing is written after the copy,"
      + " makes a fresh copy and prints the restore line to run on the new host; run again once the new board runs on that copy, it checks the board answers"
      + " with this PC's token, points this PC at it, and retires the board here, leaving its folder in place",
    flags: { cancel: 'drop a move begun on this PC and start the board here again' },
  },
  backup: {
    values: [], bools: ['json'], id: false,
    help: 'copy the board this PC hosts now, into its backups folder (the boardBackups setting, else beside its database), keeping the newest 30;'
      + " the first session start of each day makes one on its own. A board hosted elsewhere keeps its own: this names its host's command",
  },
  restore: {
    values: [], bools: ['json'], id: false, optionalId: true, idWord: 'copy (a date, YYYY-MM-DD, or a file)',
    help: "with no copy named, list the board's dated copies and those taken before a schema change, with dates and sizes; with one, stop the board this PC hosts,"
      + ' move its database and its -wal and -shm files aside into before-restore/ beside it, copy the copy in, run the integrity check and start the board again.'
      + ' A copy that fails the check is taken out and the old files put back',
  },
  timings: {
    values: [], bools: ['json'], id: false,
    help: "p50 and p95 per verb from this PC's local server log and the board's, and the board's last check",
  },
  /* the kickoff read: below --full a read prints a set, and its last line names what it cut */
  show: {
    values: ['journal-tail', 'project', 'section', 'session'], bools: ['json', 'brief', 'journal', 'since-resume', 'head', 'full', 'history'], id: true, idWord: 'record id',
    manyIds: true,
    help: 'one record (several with any level but --full) at a read level: the brief form by default, a task\'s block for a task (its typed notes since its'
      + ' last rewrite, the board\'s own lines counted), and the last line names what it left out and the flag that brings it back',
    flags: {
      brief: 'each text once, as plain text (the default but for a task)', journal: 'the brief form with the journal too',
      'journal-tail': 'keep the last N journal notes', 'since-resume': 'journal notes since the latest resume',
      head: 'one line each: label, name, status and what it waits on',
      section: 'one section by name, such as Intent, Answer or Journal', full: 'the whole record, nothing left out',
      history: 'its old texts, each change with who, when and why (a profile by its name)', session: 'the session reading it (a read by another session makes it used)',
      json: 'print JSON: alone, the whole record (what scripts and the mod read), an array of them for several ids; with a level, that level',
      project: 'the project slug an old brain id belongs to',
    },
  },
  read: {
    values: ['site', 'session'], bools: ['json'], id: true, manyIds: 'any', idWord: 'record id',
    help: 'log that this session read records outside show and the kickoff, so the board knows they are used',
    flags: { site: 'toast or brief: the decision-applies toast or an agent brief' },
  },
  shelf: {
    values: [], bools: ['json', 'no-git'], id: false, help: 'tracks waiting or parked across workstreams, oldest first, then tracks with ready work that no session ever held',
    flags: { 'no-git': 'no git calls, so no "code moved" flag: the cheap read a poll makes' },
  },
  /* which record a label named */
  resolve: {
    values: ['at'], bools: ['json'], id: true, idWord: 'label',
    help: 'the record a label names now and every earlier holder, or the holder on a day',
    flags: { at: 'YYYY-MM-DD or a full stamp: the record that held the label then' },
  },
  activity: {
    values: ['month', 'search', 'kind', 'id', 'limit', 'before', 'project', 'workstream'], bools: ['json', 'places'], id: false,
    help: 'the activity log, newest first',
    flags: {
      month: 'YYYY-MM', limit: 'lines (50; 0 for all)', before: 'a stamp or the cursor a page printed',
      project: "only this project's lines, by the board's rule", workstream: "WS-n: only its lines, its records' and its tracks' handoffs'", places: "each line's workstream, project and link, as the tray's console shows them",
    },
  },
  /* `text` is the free positional every other verb here refuses: the words to look for */
  search: {
    values: ['tab', 'ws', 'limit'], bools: ['json'], id: false, text: true,
    help: "the board's search over every record's title, text and notes and every handoff: each hit's head and the lines that matched, not the records",
    flags: { tab: 'questions, work or both', ws: 'WS-n', limit: 'hits (20; at most 50)' },
  },
  sweep: {
    values: ['track', 'since'], bools: ['json', 'since-last'], id: false,
    help: "gather what earlier sessions left behind for one reader agent: this PC's transcripts of the sessions in scope digested (turns copied from another session left out),"
      + ' the lines naming something left, the board scan (closed tasks whose last note names something left, inbox tasks woken with no home) and the reader\'s brief,'
      + " written under this PC's data folder, never in the repo or on the board; it prints the folder, the counts and the next step",
    flags: {
      track: 'TR-n: the sessions that held it or wrote its handoffs', since: "YYYY-MM-DD: the project's sessions from that day",
      'since-last': "the project's sessions since this PC's last sweep of it",
    },
  },

  'ws create': {
    values: ['handoff'], bools: ['json'], id: false, stdin: 'JSON payload', help: 'create a workstream',
    flags: { handoff: HANDOFF_FLAG },
  },
  'ws edit': {
    values: ['name', 'session', 'handoff'].concat(WS_EDIT_LISTS), multi: WS_EDIT_LISTS, bools: ['json', 'clear-handoff', 'no-seed'], id: true, idWord: 'WS-n id',
    help: "flip a workstream's name, labels, refs, projects, outcomes or handoff folder",
    flags: {
      'add-outcome': 'one of your outcomes, in your words; mints the next id (o1, o2...)', 'remove-outcome': 'an outcome id: o3',
      handoff: HANDOFF_FLAG, 'clear-handoff': 'it names no handoff folder (its tracks hand off on the board)',
      'no-seed': 'with --handoff: only the field is set, and an absent folder is not made from the template (an undo puts back a folder git restores)',
    },
  },
  'ws close': { values: ['outcome', 'session'], bools: ['json'], id: true, idWord: 'WS-n id', help: 'close a workstream' },
  /* a session's task names its place, a track or unplaced with a reason */
  'task create': {
    values: ['tier', 'track', 'workstream', 'before', 'after', 'unplaced', 'wake', 'new-track', 'unpark-when', 'why-elsewhere', 'last', 'review-scope', 'session', 'here-before', 'here-after', 'question', 'words', 'user'], multi: ['before', 'after', 'here-before', 'here-after'], bools: ['json'], id: false, stdin: 'JSON payload',
    help: "create a task; a session's names its tier and that tier's answer (--tier 2 on the track it holds, 3 another track or a parked one, 4 another workstream); a real place on the track the session holds files at once, and last or off that track creates nothing and asks the user where it goes",
    flags: { ...PLACE_FLAGS, workstream: 'WS-n: the workstream it goes in (tier 4 names it, with --track there or --wake)', 'review-scope': SCOPE_FLAG },
  },
  'task edit': {
    values: ['name', 'status', 'priority', 'ordinal', 'workstream', 'plan', 'serves', 'run-by', 'review-scope', 'close', 'session', 'intent', 'description', 'tier', 'track', 'before', 'after', 'unplaced', 'wake', 'new-track', 'unpark-when', 'why-elsewhere', 'last', 'here-before', 'here-after', 'question', 'words', 'user'].concat(EDIT_LISTS),
    multi: EDIT_LISTS.concat(['before', 'after', 'here-before', 'here-after']), bools: ['json', 'clear-workstream', 'clear-plan', 'clear-serves', 'clear-run-by', 'clear-close', 'in-hand', 'let-go', 'take-over', 'leftovers'], id: true, idWord: 'T-n id',
    help: "flip a task's fields", stdin: LEFTOVERS_STDIN,
    flags: {
      leftovers: LEFTOVERS_FLAG, 'why-elsewhere': PLACE_FLAGS['why-elsewhere'], last: PLACE_FLAGS.last,
      status: 'open, dropped or done; a start is --in-hand with --session', priority: 'high, medium or low',
      'in-hand': 'with --session: this session takes it in hand (it may hold several)', 'let-go': 'nobody has it in hand',
      'take-over': 'with --in-hand, or --status done or dropped: take it from the session whose run holds it, which is told; only on the word of {user}',
      serves: "o1,o2: the outcomes of its workstream it serves", 'clear-serves': 'it serves none',
      'run-by': 'who runs it: orchestrator, fork or agent:<model>', 'clear-run-by': 'nobody is named to run it',
      'review-scope': SCOPE_FLAG,
      close: '"with T-n": it closes when T-n is done, while automatic upkeep is on, and never with a step open (a look is a task labelled look ending in one question, and a fact to check is the done clause of its description)',
      'clear-close': 'it closes by hand (an old look close takes its landed mark with it)', ...PLACE_FLAGS,
      intent: 'rewrite its Intent in place, before its work starts (no session held it, no agent ran it); after that note T-n --intent with --body saying why amends it',
      description: 'rewrite its Description in place, on the same terms as --intent',
    },
  },
  /* THE QUESTION'S EDIT: scoping, plus the pick and the gated
     tasks. Its status, name and prose keep their own verbs. */
  'question edit': {
    values: ['workstream', 'track', 'session', 'pick', 'add-gate', 'remove-gate'], multi: ['add-gate', 'remove-gate'],
    bools: ['json', 'clear-workstream', 'clear-track', 'clear-pick'], id: true,
    stdin: 'with no field flag: the reworded question, a whole register payload, keeping its id (open or snoozed questions)',
    help: "reword an open question in place, move it between lanes, set or fix its pick, or name the tasks it gates",
    flags: {
      track: 'TR-n (an old P-n or TH-n names the track it became)',
      pick: 'the recommended option letter (open or snoozed questions)', 'add-gate': 'T-n', 'remove-gate': 'T-n',
    },
  },
  /* --session on `note` names who wrote it, so the activity line carries the session. A note on
     a track tells the session holding it; other notes mint nothing. */
  note: {
    values: ['session', 'body', 'name', 'description', 'intent', 'goal'], bools: ['json'], id: true, idWord: 'record id', stdin: 'note body, when --body is absent',
    help: "append a stamped paragraph to the journal of a workstream, task, track or knowledge record (WS-n, T-n, TR-n, K-n; never a question); with a new text it amends a task's or a track's text, the note being the why",
    flags: {
      body: 'the note text (else stdin)', name: "a task's new title, the old kept in its history", description: "a task's new description, likewise", intent: "a task's new intent, likewise",
      goal: "a track's new goal, likewise",
    },
  },
  reopen: {
    values: ['session', 'until', 'trigger', 'wake-on'], bools: ['json'], id: true, idWord: 'record id',
    help: 'reopen a closed workstream, or a dropped question: open, or snoozed again with --until, --trigger or --wake-on',
    flags: { until: 'a question: YYYY-MM-DD', trigger: 'a question: words that wake it', 'wake-on': 'a question: <record id>[:<ending status>]' },
  },
  subscribe: { values: ['session'], bools: ['json'], id: true, idWord: 'record id', help: 'subscribe a session to a record' },

  /* tracks on the board, through lib/board-call.mjs and lib/tracks-session.mjs */
  'handoff write': {
    values: ['session'], bools: ['json'], id: true, idWord: 'TR-n id',
    stdin: 'JSON payload (focus, state, whereWeWere, verifyFirst, waitingOnUser, rulings, created ...); the last handoff\'s waits carry, { drop: line } in waitingOnUser settles one; a focus, state or whereWeWere over its budget is stored and the result names the handoff update patch that shortens it',
    help: 'write the next handoff on a track (on the board; the loose-file, worktree and branch lists stay on this PC)',
  },
  /* a patch, never a rewrite; refused once the track is resumed */
  'handoff update': {
    values: ['session'], bools: ['json'], id: true, idWord: 'TR-n or TR-n.m id',
    stdin: 'JSON ops, a list or { ops }: { op: "focus", text }, { op: "state", heading: "## ...", text }, { op: "whereWeWere", line or text }, { op: "waitingOnUser", add or drop }, { op: "verifyFirst", path }, { op: "nextPc", pc }',
    help: "patch a track's live handoff in place, keeping its id: the focus replaced, a state section replaced or added, a whereWeWere line added or the whole replaced, a waitingOnUser line added or dropped, a repo's verify-first snapshot refreshed, the PC its next leg runs on set or cleared",
  },
  resume: {
    values: ['session', 'splinter', 'goal', 'reason', 'continues'], bools: ['json', 'take-over', 'read-only', 'here'], id: true, idWord: 'TR-n id',
    help: 'take a track and its live handoff, with the kickoff; a track another session holds names the holder and three moves',
    flags: {
      splinter: 'a held track: start a side track of this name from it', 'take-over': 'a held track: take it, the other session is told',
      continues: 'with --take-over: the earlier id of this same session (after a /clear); when that id holds the track, its hold made before keeps counting',
      'read-only': 'the kickoff without taking it', here: 'take it on this PC although its handoff names another PC for its next leg',
    },
  },
  'track list': {
    values: ['workstream'], bools: ['json', 'all', 'open'], id: false, help: "a workstream's tracks with their state and its inbox count, or with --open every open track",
    flags: { workstream: 'WS-n', all: 'closed tracks too', open: "the new, active and waiting tracks of every workstream (or the one named), each with its newest handoff's verify-first entries" },
  },
  'track show': { values: [], bools: ['json'], id: true, idWord: 'TR-n or TR-n.m id', help: "a track's kickoff and handoffs without taking it, or one handoff in full" },
  'track mine': {
    values: ['session'], bools: ['json'], id: false,
    help: "the track this session holds (its lease renewed), and its workstream's tracks, each with its summary and last handoff",
  },
  'track new': {
    values: ['workstream', 'name', 'goal', 'task', 'label', 'ref', 'session', 'user'], multi: ['task', 'label', 'ref'], bools: ['json'], id: false,
    help: "start a track in a workstream; with --session the session takes it, and a session's --task never carries a task off the track it holds (place it, which asks the user)",
    flags: { task: 'a T-n to put on it (repeatable)', label: 'a label it carries from birth (repeatable)', ref: 'a ref it carries from birth (repeatable)' },
  },
  'track park': {
    values: ['reason', 'unpark-when', 'session'], bools: ['json'], id: true, idWord: 'TR-n id', help: 'park a track with a reason; its session lets go',
    flags: { 'unpark-when': '"track-ends TR-m", "task-completes T-m" or "question-answered Q-m": it unparks on its own then' },
  },
  'track finish': {
    values: ['outcome', 'leftovers', 'wake', 'waive', 'session', 'user'], bools: ['json'], id: true, idWord: 'TR-n id', help: 'finish a track; its junction comes back; refused while a placement question of the track is open',
    flags: { leftovers: "inbox (the user's own command, which the plugin sends with --user and a session never does) or drop, for tasks still open", wake: LEFTOVER_WAKE, waive: 'finish with finished code no review read (full review depth), and why; the reason goes to its journal and the activity log' },
  },
  'track drop': {
    values: ['reason', 'leftovers', 'wake', 'session', 'user'], bools: ['json'], id: true, idWord: 'TR-n id', help: 'drop a track with a reason; its junction comes back; refused while a placement question of the track is open',
    flags: { leftovers: "inbox (the user's own command, which the plugin sends with --user and a session never does) or drop, for tasks still open", wake: LEFTOVER_WAKE },
  },
  'track splinter': {
    values: ['name', 'at', 'goal', 'task', 'workstream', 'session', 'user'], multi: ['task'], bools: ['json', 'no-park'], id: true, idWord: 'TR-n id (the parent)',
    help: 'start a side track now: the parent parks with the junction and the session moves onto it',
    flags: {
      at: 'the T-n it leaves from (default: the one running)', task: "a T-n of the parent that moves with it (repeatable; a session's call never carries one off the track it holds)",
      'no-park': 'a branch: the parent stays open and keeps its session, and the first tasks of the side wait on --at',
    },
  },
  'track capture': {
    values: ['tier', 'track', 'workstream', 'name', 'task', 'description', 'priority', 'unplaced', 'wake', 'why-elsewhere', 'last', 'before', 'after', 'session', 'here-before', 'here-after', 'question', 'words', 'user'], multi: ['before', 'after', 'here-before', 'here-after'], bools: ['json'], id: false,
    help: "a new idea, or an existing task, onto a track or the workstream's inbox; the session carries on; a session that holds a track names the tier, and last or off that track asks the user",
    flags: { tier: PLACE_FLAGS.tier, track: 'TR-n', workstream: 'WS-n: its inbox', task: 'an existing T-n to move', unplaced: "into the inbox: why no plan reaches it (a session's capture says)", wake: PLACE_FLAGS.wake, 'why-elsewhere': PLACE_FLAGS['why-elsewhere'], last: PLACE_FLAGS.last,
      before: PLACE_FLAGS.before, after: PLACE_FLAGS.after, 'here-before': PLACE_FLAGS['here-before'], 'here-after': PLACE_FLAGS['here-after'], question: PLACE_FLAGS.question, words: PLACE_FLAGS.words, user: PLACE_FLAGS.user },
  },
  'track found': {
    values: ['since'], bools: ['json'], id: true, idWord: 'TR-n id',
    help: "the tasks a track's arc filed, on it or anywhere by its sessions, each with where it went and the command that moves it",
    flags: { since: 'handoff: since its last handoff (default: since the track began)' },
  },
  'track layout': {
    values: ['session', 'user'], bools: ['json'], id: true, idWord: 'TR-n id',
    stdin: 'JSON payload { "steps": [{ "name", "task", "after", "before", "last", "description", "priority", "runBy", "reviewScope", "here", "whyElsewhere" }] }',
    help: 'lay a line of work out on its track: each step a task; after (T-n ids and earlier step numbers) and before (T-n ids alone, the tasks that wait on the step) are "depends on" edges, so the next task comes from the ready set; on the track you hold with nothing else open it is laid whole, with work open there a step at a real place files and one last (last with its line, and here { after, before }) asks the user; onto a track you do not hold each step asks the user (whyElsewhere and here)',
    flags: { user: PLACE_FLAGS.user },
  },
  'track reorder': {
    values: ['before', 'after', 'position', 'reason', 'session'], bools: ['json'], id: true, idWord: 'T-n id',
    help: "move a task to another place in its track's order; the reason goes to the activity log",
    flags: { before: 'the T-n it goes before', after: 'the T-n it goes after', position: 'its place, 1 first', reason: 'why it moves (needed)' },
  },
  'edge add': {
    values: ['reason', 'session'], bools: ['json'], id: false, pair: ['T-n that waits', 'T-n it waits on'],
    help: '"depends on": the first task waits on the second; a loop is refused', flags: { reason: 'why it waits, for the activity log (needed)' },
  },
  'edge remove': {
    values: ['reason', 'session'], bools: ['json'], id: false, pair: ['T-n that waits', 'T-n it waits on'],
    help: 'take a "depends on" edge away', flags: { reason: 'why it no longer waits, for the activity log (needed)' },
  },
  'check add': { values: ['text', 'at', 'session'], bools: ['json'], id: true, idWord: 'T-n id', help: "add a step to a task's checklist", flags: { at: 'its position, 1 first' } },
  'check done': { values: ['session'], bools: ['json', 'undo'], id: false, pair: ['T-n id', 'item'], help: 'check a checklist step off (or back on with --undo)' },
  'check strike': {
    values: ['why', 'session'], bools: ['json'], id: false, pair: ['T-n id', 'item'],
    help: 'strike a checklist step that will not be done, with a word why; it stays settled, never open (check done lifts it)', flags: { why: 'why it will not be done (needed)' },
  },
  'check move': {
    values: ['to', 'version', 'session'], bools: ['json'], id: false, pair: ['T-n id', 'item'], help: 'move a checklist step',
    flags: { to: 'the position, 1 first', version: "the task's version you read" },
  },
  'task update': {
    values: ['reason', 'status', 'priority', 'name', 'session', 'add-label', 'remove-label', 'note', 'description', 'intent', 'check-add', 'check-done', 'check-strike', 'continues', 'user'],
    multi: ['add-label', 'remove-label', 'check-add', 'check-done', 'check-strike'],
    bools: ['json', 'in-hand', 'let-go', 'take-over', 'leftovers', 'move-steps'], id: true, idWord: 'T-n id',
    help: "a task on the board; --in-hand with --session starts it for the session that takes it (an agent's run opens at its dispatch); closing it carries its leftovers, so nothing found while doing it is left in the closing note",
    stdin: LEFTOVERS_STDIN + '; with --move-steps: ' + MOVES_STDIN,
    flags: {
      leftovers: LEFTOVERS_FLAG, 'move-steps': MOVES_FLAG,
      'check-add': 'a step for its checklist (repeatable)', 'check-done': '"<number>" or "<number>: word", a step done, with a word on it if you like (repeatable)',
      'check-strike': '"<number>: why", a step that will not be done (repeatable); a close is refused while a step stays open, and a leftover naming check <number> files that step as a task',
      reason: 'why it starts or is taken in hand before it is ready', note: "a paragraph for the task's journal",
      name: 'its new title, the old kept in its history (with --note, the note is why)',
      description: 'with --note: the new description, the note being why (an amend; the old text stays in its history)', intent: 'with --note: the new intent, likewise',
      status: 'open, dropped or done; a start is --in-hand with --session', 'in-hand': 'with --session: this session takes it in hand and starts it (it may hold several)', 'let-go': 'nobody has it in hand',
      'take-over': 'with --in-hand or --status done or dropped: take it from the session whose run holds it, which is told; only on the user\'s word',
      continues: 'with --in-hand and --take-over: the earlier id of this same session (after a /clear), which the mod sends; its agents\' runs stay open under it',
    },
  },
  'task block': {
    values: ['session'], bools: ['json'], id: true, manyIds: 'any', idWord: 'T-n id',
    help: 'what a task holds now (several tasks with several ids; --json gives an array for several): its word with who and since when, intent, description, open steps, answered gates, decisions in force and the notes since its text was last set, with the count of earlier notes left out',
    flags: { session: "the session reading it, whose own run reads \"this session\"; without it every session's run reads \"a session\"" },
  },

  /* knowledge records and old brain ids, on the board */
  'knowledge new': {
    values: KNOWLEDGE_VALUES, multi: KNOWLEDGE_LISTS, bools: ['json', 'global'], id: false, stdin: 'body, when --body-file is absent',
    help: "record a gotcha or decision; the project left out is this folder's, and one in a project linked to no workstream or track takes the workstream of the track --session holds when that workstream is in the same project",
    flags: { file: FILE_FLAG },
  },
  'knowledge supersede': {
    values: KNOWLEDGE_VALUES.concat(['by']), multi: KNOWLEDGE_LISTS, bools: ['json', 'global'], id: true, idWord: 'K-n id',
    help: 'replace a knowledge record, or link it to one with --by', flags: { file: FILE_FLAG },
  },
  /* once another session has used a record it changes only by amend or supersede */
  'knowledge amend': {
    values: ['body', 'body-file', 'session', 'version'], bools: ['json'], id: true, idWord: 'K-n id', stdin: 'the amendment, when --body and --body-file are absent',
    help: 'add a dated clarification to a knowledge record, keeping its number; its old text stays in the history',
  },
  'knowledge edit': {
    values: ['name', 'body', 'body-file', 'session', 'version', 'add-ref', 'remove-ref', 'add-project', 'remove-project', 'add-file', 'remove-file', 'add-command', 'remove-command'],
    multi: ['add-ref', 'remove-ref', 'add-project', 'remove-project', 'add-file', 'remove-file', 'add-command', 'remove-command'], bools: ['json', 'confirmed'], id: true, idWord: 'K-n id',
    help: 'rewrite a knowledge record\'s name or body in place while no other session has used it (once used, amend or supersede it);'
      + ' its refs, projects, files and commands change at any time',
    flags: { 'add-file': FILE_FLAG, 'remove-file': 'a file glob to take off it', 'add-command': 'a command fragment a decision governs', 'remove-command': 'a command fragment to take off it',
      confirmed: "a decision: {user} confirmed its title as worded, so it is carried by title and K-n" },
  },
  /* a fact that stops being true ends with a reason and no replacement, and can come back */
  'knowledge retire': {
    values: ['reason', 'session', 'version'], bools: ['json'], id: true, idWord: 'K-n id',
    help: 'end a knowledge record that is not a ruling, with a reason and no replacement: it stops being shown to sessions and keeps its history; knowledge reinstate brings it back',
    flags: { reason: 'why it stopped being true (required; it goes in the history)' },
  },
  'knowledge reinstate': {
    values: ['reason', 'session', 'version'], bools: ['json'], id: true, idWord: 'K-n id',
    help: 'make a retired knowledge record active again; one retired past its archive day (14 days) takes a fresh K-n',
    flags: { reason: 'why it holds again (required; it goes in the history)' },
  },
  /* a ruling in one call, and the ones in force */
  decide: {
    values: ['session'], bools: ['json', 'confirmed'], id: false, flags: { confirmed: '{user} said yes to the title as worded, so the ruling is carried by its title and K-n' },
    stdin: 'JSON payload { title, words, body, tasks, tracks, workstreams, files, commands, question, supersedes, projects or global }',
    help: "record a ruling the user made: a title stating only what they chose, the session's own picks in the body each named as the session's pick,"
      + " their words quoted whole, and what it governs; left out, the track and workstream are the ones the session holds"
      + " and the project is this folder's; the question it answers is answered too when the words carry its token (167a), else the reply says it is still open;"
      + " words ending in a question back or a hedge (thoughts?, perhaps) still record, and the reply warns that they leave the choice open",
  },
  decisions: {
    values: ['task', 'track', 'workstream', 'since'], bools: ['json'], id: false,
    help: 'the decisions in force for a task, a track (its tasks and workstream too) or a workstream, newest first',
    flags: { task: 'T-n', track: 'TR-n', workstream: 'WS-n (its label too)', since: 'YYYY-MM-DD or a full stamp: only the ones made or amended since' },
  },
  'decisions triggers': {
    values: ['project'], bools: ['json'], id: false,
    help: "every decision in force with files or commands, and every other knowledge record in force with files, at this PC's checkout, for the mod's watcher",
    flags: { project: 'the project directory (default: the current one)' },
  },
  /* the code a task finished with, and the reviews that read it */
  'commit link': {
    values: ['session'], bools: ['json'], id: false,
    stdin: 'JSON { repo, sha, task, via, session, agent_job, at, files: [{ path, added, removed, counted }], added, removed }',
    help: "link one commit to the task it belongs to (task empty: no task owns it); the mod's own write, and linking the same commit and task again updates it",
  },
  'commit move': {
    values: ['repo', 'from', 'to', 'reason', 'session'], bools: ['json'], id: true, idWord: 'commit sha',
    help: 'link a commit to another task by hand; the reason goes to the activity log',
    flags: { repo: 'the repo, when the sha is in more than one', from: 'the T-n it is linked to now, when it is linked to two', to: 'the T-n it belongs to', reason: 'why, one line' },
  },
  'review covers': {
    values: ['session'], bools: ['json', 'none'], id: true, manyIds: 'any', idWord: 'review T-n id, then the T-n ids it covers',
    help: "set a review task's covers list: the code tasks it read, each through its newest commit now. A list sets it, and the review reads only those tasks; no list takes the default, every uncovered code task on its track finished before the review started; --none clears it",
    flags: { none: 'clear the list: the review covers nothing (not with ids)' },
  },
  coverage: {
    values: ['session'], bools: ['json', 'scan'], id: true, idWord: 'TR-n or WS-n id',
    help: "a track's or workstream's code tasks with the review that covers each, its reviews, the commits no task owns in its repos, and whether a review is due",
    flags: { scan: 'first link the commits here whose subjects lead with a task id, in each repo its handoffs name, from the first baseline to HEAD' },
  },
  /* each project's conversion map, which onboard and the doctor read and write */
  conversion: {
    values: ['project'], bools: ['json'], id: false,
    help: "a project's conversion map: each source an onboard or doctor run converted with its hash and the records it became, each folder's end, each call's answer and each run",
    flags: { project: 'the project directory (default: the current one)' },
  },
  'conversion put': {
    values: ['project', 'session'], bools: ['json'], id: false, stdin: 'JSON { run, rows: [{ source, kind, hash, sha, records, fate, why, answer, detail }] }',
    help: "put rows on a project's conversion map, each whole under its source (a repo file, a folder/ , call:<id> or run:<id>); the onboard write's own call",
    flags: { project: 'the project directory (default: the current one)' },
  },
  'conversion drop': {
    values: ['project', 'run', 'keep', 'session'], bools: ['json'], id: false,
    help: "take one run's rows off a project's conversion map, giving back each earlier run's row it replaced; the onboard undo's own call",
    flags: { project: 'the project directory (default: the current one)', run: 'the run, as its rows name it', keep: 'sources to leave on the map, comma-separated' },
  },
  /* what an import's cut leaves is deleted; a dry run counts it first */
  purge: {
    values: ['id', 'item', 'session'], multi: ['id', 'item'], bools: ['json', 'yes'], id: true, idWord: 'import label (import:<slug>)',
    help: "delete the records an import wrote (its import:<slug> label and an onboard: ref): its decisions, knowledge records, tasks, tracks with their handoffs, questions and workstream,"
      + " with their journals, history and activity. Without --yes it counts them by kind and writes nothing; a decision or knowledge record goes only once withdrawn, and work someone holds stays",
    flags: { id: 'only these records (repeatable, or comma-separated)', item: 'only the records of these onboard items, as their onboard: refs name them (repeatable, or comma-separated)',
      yes: "delete them, once {user} said yes to the dry run's counts" },
  },
  /* the board keeps itself current once switched on */
  upkeep: {
    values: [], bools: ['json', 'dry-run'], id: false,
    help: 'with --dry-run: what switching automatic upkeep on would unpark, close and put on Home, writing nothing',
  },
  'upkeep on': { values: [], bools: ['json'], id: false, help: 'apply the catch-up the dry run lists, once, and switch automatic upkeep on' },
  'upkeep off': { values: [], bools: ['json'], id: false, help: 'switch automatic upkeep off' },
  /* the user's override of a record in use; a session asks, the user's press decides */
  'override request': {
    values: ['kind', 'reason', 'summary', 'name', 'description', 'intent', 'close', 'body', 'words', 'text', 'session'], bools: ['json', 'dry-run'],
    id: false, optionalId: true, idWord: 'record id (T-n or K-n)', stdin: 'a batch as JSON { kind, reason, summary, items: [{ record, ... }] }, when no record id is given',
    help: 'ask {user} once to fix (text a bug or an import wrote), withdraw (a ruling never made, or the rulings and knowledge records of an undone import, in one request) or scrub (a secret) a record already in use;'
      + ' never for wording, scope or a change of mind (amend or supersede those); a subagent reports to its session instead',
    flags: {
      kind: 'fix, withdraw or scrub', reason: 'why it qualifies: the bug, the ruling never made, the undone import, or the secret', summary: 'what {user} decides, at most 200 characters',
      name: 'fix: the corrected name', description: "fix: a task's corrected Description", intent: "fix: a task's corrected Intent", close: 'fix: a task\'s close, as task edit --close takes it',
      body: "fix: a knowledge record's corrected Body", words: "fix: a decision's corrected quoted words", text: 'scrub: the exact text to remove (never in the summary or the reason)', 'dry-run': 'check and measure it, asking nothing',
    },
  },
  'override decide': {
    values: ['user'], bools: ['json'], id: false, pair: ['request', 'act-or-keep'],
    help: "{user}'s press on an override request (its number, or a record it holds): its act (withdraw, fix or scrub; allow for any) or keep; only their press, so it needs --user",
    flags: { user: 'the session {user} pressed in, or typed their answer in' },
  },
  'override unscrub': {
    values: ['user'], bools: ['json'], id: true, idWord: 'record id',
    help: "put back the text a scrub removed, within 7 days of it; {user}'s act, so it needs --user",
    flags: { user: 'the session {user} asked in' },
  },
  legacy: {
    values: ['project'], bools: ['json'], id: true, idWord: 'old brain id', help: 'what an old brain id maps to',
    flags: { project: 'the project slug it belongs to' },
  },

  /* depth-setting profiles on the board; `subscribe` stays the answer fan-out */
  'profile add': {
    values: ['session', 'project'], bools: ['json'], id: false, pair: ['record', 'profile'],
    help: 'subscribe a record (default, a project dir, WS-n, TR-n, T-n, P-n or TH-n) to a profile',
  },
  'profile remove': {
    values: ['session', 'project'], bools: ['json'], id: false, pair: ['record', 'profile'],
    help: 'take a profile off a record, or drop an inherited one there',
    flags: { project: 'the project an inherited profile comes through' },
  },
  'profile show-effective': {
    values: ['project'], bools: ['json', 'rules'], id: true, idWord: 'record (default, a project dir, WS-n, TR-n, T-n, P-n or TH-n)',
    help: 'each setting in force for a record, with the profile and record it came from',
    flags: { project: 'the project dir to resolve through', rules: 'the rules in force, as an agent brief gets them' },
  },
  /* rule lines on a profile, by slug; `profile add` stays the subscribe verb */
  'profile rule-add': {
    values: ['text', 'for', 'session', 'from', 'ruling'], bools: ['json'], id: false, pair: ['profile', 'slug'],
    help: 'add a rule line to a profile, or replace the one with that slug',
    flags: {
      text: 'the rule in plain words, at most 400 characters', for: 'session, agents, agents:<role> or both (the default): whose block carries it; a role is a subagent type or a label on the task an agent is dispatched on, and its line rides only the briefs of those agents',
      from: 'the ruling it came from (K-n or Q-n); the line then changes only with a newer one', ruling: 'a newer ruling that changes a line from a ruling',
    },
  },
  'profile rule-drop': {
    values: ['session', 'ruling'], bools: ['json'], id: false, pair: ['profile', 'slug'],
    help: 'drop a wider rule line by its slug wherever the profile applies', flags: { ruling: 'a newer ruling, when the line came from one' },
  },
  'profile rule-clear': {
    values: ['session', 'ruling'], bools: ['json'], id: false, pair: ['profile', 'slug'],
    help: 'take a slug off a profile, its line or its drop', flags: { ruling: 'a newer ruling, when the line came from one' },
  },
  'profile define': {
    values: ['set', 'unset', 'description', 'session'], multi: ['set', 'unset'], bools: ['json'], id: true, idWord: 'profile name',
    help: 'make or edit a profile', flags: { set: 'key=value (repeatable)', unset: 'a key (repeatable)' },
  },
  'profile delete': {
    values: ['session'], bools: ['json'], id: true, idWord: 'profile name',
    help: "delete a profile's definition; refused while a record holds it (profile remove takes it off), and a built-in one cannot be deleted",
  },
  'profile list': { values: [], bools: ['json'], id: false, help: 'every profile and the records holding it' },
  'profile guard': {
    values: ['project', 'session'], bools: ['json'], id: true, idWord: 'on or off',
    help: 'the subagent depth guard for a project, through the guard-on and guard-off profiles',
    flags: { project: 'the project directory' },
  },
  /* one list of every setting for the CLI, the pane and the board page */
  settings: {
    values: ['track', 'project', 'session'], bools: ['json'], id: false,
    help: 'every setting with its value, where it comes from and the values it takes; works with no board',
    flags: {
      track: 'resolve for this track (TR-n)', project: 'resolve for this project dir (default: the current folder)',
      json: 'print { record, chain, held, home, board, rows, tabs, lists }; a row is { key, family, tab, label, line, changes, example, takes, kind,'
        + ' values and choices or min and max, builtIn, value, layer (built-in, default, project, workstream, track, task or pc), scope, record, profile,'
        + ' editable, why, changed, overridden, places }, a rule line adds slug, words, audience and, for the agents of one role, role; a tab is { tab, name, summary, changed };'
        + ' lists holds the copy of rules.add and rules.drop; home names the profile a rule line goes to; the board token shows as set or not set',
    },
  },
  'settings set': {
    values: ['at', 'track', 'project', 'profile', 'session'], bools: ['json'], id: false, pair: ['key', 'value'], pairPlus: 'record',
    help: 'set one setting: by default in the profile that sets it now (the default profile when it is built in); a contract key or the queue'
      + " with no board in this PC's config.json",
    flags: {
      at: 'default, project, workstream, track or task, with the record after the value (a project dir defaults to the current folder):'
        + ' the profile held there that sets it, else the one held there, else a new settings-<record> profile; the contract family is set at default only',
      profile: 'the profile to write when the record holds several', track: 'the track whose chain names the profile that sets it now',
      project: 'the project whose chain names the profile that sets it now',
      json: 'print { key, value, profile, created, added, reaches: [{ record, level, note }] }, or { key, value, layer: pc, sync } with no board',
    },
  },
  /* the reset, the value off the layer that sets it */
  'settings unset': {
    values: ['at', 'track', 'project', 'session'], bools: ['json'], id: false, pair: ['key'], pairPlus: 'record',
    help: 'take one setting off the layer that sets it now, so the next layer down applies; a contract key goes back to its built-in value,'
      + " and with no board a contract key or the queue goes back to its built-in value in this PC's config.json",
    flags: {
      at: 'default, project, workstream, track or task, with the record after the key (a project dir defaults to the current folder):'
        + ' the profile held there that sets it', track: 'the track whose chain names the profile that sets it now',
      project: 'the project whose chain names the profile that sets it now',
      json: 'print { key, profile, removed, from, dropped, now: { value, layer, record, profile } }, or { key, value, layer: pc, sync } with no board',
    },
  },
  /* the settings surfaces' rule write */
  'settings rule': {
    values: ['text', 'for', 'profile', 'session'], bools: ['json'], id: false, pair: ['add, drop or clear', 'slug'],
    help: 'add a rule line, or drop a built-in one, on your default profile, held on default so it reaches every session; clear takes a slug off a profile',
    flags: {
      text: 'the rule in plain words, at most 400 characters, on add', for: 'session, agents, agents:<role> (a subagent type or a task label: only those agents) or both (the default), on add',
      profile: 'on clear, the profile the slug is on (default: your default profile)',
      json: 'print { profile, op, slug, settings, added, dropped }',
    },
  },
  /* procedure cards over docs/procedures/<name>.md, on the board */
  'proc scan': {
    values: ['project', 'vouch', 'since', 'unvouch', 'session'], bools: ['json', 'check'], id: false,
    help: "make or update the procedure cards of a project from its docs/procedures files, which it reads from the main checkout",
    flags: {
      project: 'the project directory (default: the current repo)',
      vouch: "a conversion's handover: its last commit, recorded as the verified commit of each card it wrote and of each that read current at --since",
      since: 'with --vouch: the commit before the handover\'s first',
      unvouch: "the undo of a conversion: the handover's last commit, whose verified record on each card gives back what the card held before",
      check: "parse, judge and lint the docs/procedures files of this checkout (a worktree's branch included) and write nothing to the board; exit 1 when a file has errors",
    },
  },
  'proc ran': {
    values: ['note', 'project', 'session', 'fixed', 'one-off', 'filed'], bools: ['json'], id: false, pair: ['name', 'clean or deviated'],
    help: 'record a run of a procedure: clean moves its verified commit to HEAD; deviated says what happens next with one outcome, and the board files nothing',
    flags: {
      note: 'what differed, its first sentence naming the step and how (required for deviated)', project: 'the project the name is in (default: the current repo)',
      fixed: "with deviated: the commit that fixed the card's steps file", 'one-off': 'with deviated: why the run was a one-off and the steps stand',
      filed: 'with deviated: the open task you filed for the work, on a track or in an inbox (it holds the flag until it closes)',
    },
  },
  /* a card's deviated runs by step with their outcomes, and the old draft tasks still open */
  'proc drafts': {
    values: ['project', 'session'], bools: ['json'], id: false, pair: ['name'],
    help: "a procedure's deviated runs by the step each names, with the outcome each recorded, and the draft tasks filed before outcomes were said that are still open",
    flags: { project: 'the project the name is in (default: the current repo)' },
  },
  'proc find': {
    values: ['project'], bools: ['json'], id: false, text: true,
    help: 'the procedures whose trigger words or title hold every word given',
  },
  'proc triggers': {
    values: ['project'], bools: ['json', 'no-scan'], id: false,
    help: "every procedure card's triggers, the plugin's cards for every project among them, for the mod's watcher",
    flags: { project: "scan this project first (fail-open); its repo's cards show at its checkout", 'no-scan': 'list only, no scan' },
  },
  /* this PC's map from a project's shared name to its folder */
  projects: { values: [], bools: ['json'], id: false, help: "this PC's project map: each project's shared name and its folder here" },
  'projects scan': {
    values: [], bools: ['json'], id: false, rest: 'folder',
    help: 'map the repos in the named folders: a folder inside a checkout maps that checkout, any other the checkouts up to three folders down (never inside a checkout, node_modules or a hidden folder)',
  },
  /* a stale entry; nothing is dropped on its own */
  'projects forget': {
    values: [], bools: ['json'], id: false, pair: ['name'],
    help: "drop one project from this PC's map: the listing marks an entry whose folder is gone or is now another project",
  },
  /* on the board, unlike the ones above; this PC's map follows */
  'projects rename': {
    values: ['folder', 'session'], multi: ['folder'], bools: ['json', 'dry-run'], id: false, pair: ['old name', 'new name'],
    help: "move a project's records on the board from its old shared name to its new one, then this PC's map",
    flags: { folder: '<old dir>=<new dir>: a folder the records and profile holdings name moves with them', 'dry-run': 'print the counts, write nothing' },
  },
  /* the web views' sign-in page names this */
  login: {
    values: ['next'], bools: ['json', 'print', 'qr'], id: false,
    help: "open a single-use login link to the board's web views in the browser",
    flags: {
      next: 'the page to land on (default: the overview)', print: 'print the link, do not open it',
      qr: "print the link as a QR code for a phone's camera, with the link and its expiry under it; do not open it",
    },
  },
  /* a second PC onto the board with no ssh and no token copied between machines */
  'join-code': {
    values: ['device'], bools: ['json'], id: false,
    help: 'mint a code that lets one new PC onto this board, once, within ten minutes; minting another replaces it',
    flags: { device: 'the only device name the code takes, and the one way to rejoin a device already on the board (a code without it refuses such a name)' },
  },
  join: {
    values: ['device', 'token'], bools: ['json', 'seed'], id: false, pair: ['board url'], pairPlus: 'code',
    help: "put this PC on the board with a code: the setup code a new board prints at its start for the first PC, or a join code from a PC already on it for every later one;"
      + " saves the board's address, this PC's token and hub mode in the AskerDo config",
    flags: {
      device: "this PC's name on the board (default: its hostname)",
      token: 'in place of a code, the fallback for the first PC on a new board: the device token printed by token new on the board box',
      seed: "when the board holds no reply options yet, put this PC's saved ones on the profile every PC reads (a board holding options keeps them)",
    },
  },
  help: { values: [], bools: [], id: false, text: true, optionalText: true, help: 'every verb, or one verb in full: help <verb>' },
};

/* the two ways a note body arrives, named by every no-body error. */
const NOTE_WAYS = 'pass --body "text", or pipe it on stdin (echo text | askerdo note T-n)';

/* where a verb takes its text, read off its row, for words typed after the id */
function textWays(spec) {
  const flag = ['body', 'text', 'note', 'reason'].find((f) => (spec.values || []).includes(f));
  /* a word after an answer's id is most often the letter: a note alone records no pick */
  if ((spec.values || []).includes('pick')) return 'the option letter goes in --pick (--pick b)' + (flag ? ', and words in --' + flag + ' "text"' : '');
  if (!flag) return null;
  const ways = ['--' + flag + ' "text"'];
  if (spec.values.includes(flag + '-file')) ways.push('--' + flag + '-file <path>');
  if (spec.stdin && !/JSON/.test(spec.stdin)) ways.push('stdin');
  return 'pass them in ' + (ways.length > 1 ? ways.slice(0, -1).join(', ') + ' or ' + (ways.at(-1) === 'stdin' ? 'on stdin' : ways.at(-1)) : ways[0]);
}

/* Words for the flags most verbs share. */
const COMMON_FLAGS = { json: 'print JSON', session: 'your own session id' };

/* One verb's help, from its row alone. */
function verbHelp(name, who = 'the user') {
  const s = VERBS[name];
  const head = 'askerdo ' + name + (s.id ? ' <' + (s.idWord || 'question id') + '>' : '') + (s.text ? ' <words>' : '')
    + (s.pair ? s.pair.map((w) => ' <' + w + '>').join('') : '') + (s.pairPlus ? ' [<' + s.pairPlus + '>]' : '') + (s.rest ? ' [<' + s.rest + '>...]' : '');
  const named = (t) => t.split('{user}').join(who);
  const lines = [head, '  ' + named(s.help)];
  if (s.stdin) lines.push('  stdin: ' + s.stdin);
  const words = { ...COMMON_FLAGS, ...(s.flags || {}) };
  for (const f of s.values.concat(s.bools)) {
    const shape = '--' + f + (s.values.includes(f) ? ' <value>' : '') + (s.multi && s.multi.includes(f) ? ' (repeatable)' : '');
    lines.push('  ' + shape + (words[f] ? ': ' + named(words[f]) : ''));
  }
  return lines.join('\n');
}

/* Every verb on one line each. */
function helpIndex(who = 'the user') {
  return ['askerdo <verb> --help prints one verb in full; askerdo --version prints this PC\'s AskerDo version and the board\'s.', '']
    .concat(Object.keys(VERBS).map((v) => '  ' + v + ': ' + VERBS[v].help.split('{user}').join(who))).join('\n');
}

/* Asked for by a command when the caller sent no stdin: the route answers
   { needStdin: true } and the launcher sends the call again with it. */
class NeedStdin extends Error {}

const noBom = (data) => (data.charCodeAt(0) === 0xfeff ? data.slice(1) : data);

/* One call's world: the caller's directory, stdin and output, and the board
   through the caller's own settings. */
function callContext({ cwd, env, stdin, tty, near = true }) {
  const out = [];
  const err = [];
  let stale = null;
  let signed = '';
  const cx = {
    cwd, env, tty: tty === true, near: near !== false,
    /* this PC's store root: the local server's files and the error log */
    root: () => storeRoot(undefined, env),
    out: (s) => { out.push(s); return true; },
    err: (s) => { err.push(s); return true; },
    /* a redirect from a Windows shell commonly prepends a UTF-8 byte order
       mark, which JSON.parse refuses */
    stdin: async () => {
      if (typeof stdin === 'function') return noBom(String(await stdin()));
      if (typeof stdin === 'string') return noBom(stdin);
      throw new NeedStdin('stdin');
    },
    /* a path flag as the caller meant it: relative to the caller's directory */
    path: (p) => (typeof p === 'string' && p !== '' && !isAbsolute(p) ? resolve(cwd, p) : p),
    /* a read served from the offline cache says so once per command */
    call: (name, input, opts = {}) => boardCall(name, input, {
      ...opts, env, onStale: (n) => { if (stale === null) { stale = n; err.push('AskerDo: ' + n + '\n'); } },
      onLocal: (root) => { signed = root; },
    }),
    /* the signed root of the local server that answered this command, else '' */
    signed: () => signed,
    dataDir: () => dataDir(env),
    text: () => ({ stdout: out.join(''), stderr: err.join('') }),
    /* shipped text says "the user" */
    who: () => 'the user',
  };
  /* a JSON envelope served from the offline cache carries `stale`, the note;
     under `staleNote` when the verb's own result has a `stale` of its own */
  const envelope = (obj) => (stale !== null && obj && typeof obj === 'object' && !Array.isArray(obj)
    ? { ...obj, [Object.hasOwn(obj, 'stale') ? 'staleNote' : 'stale']: stale } : obj);
  cx.emit = (flags, obj, human) => cx.out((flags.json ? JSON.stringify(envelope(obj)) : human) + '\n');
  /* a verb's flags (register's, the serves-none), on stderr so stdout stays the result */
  cx.warn = (r) => { for (const w of (r && r.warnings) || []) cx.err('AskerDo: ' + w + '\n'); };
  cx.board = (name, input, who) => onBoard(() => cx.call(name, input, who && typeof who === 'object' ? who : { session: who || undefined, pc: pcName(env) }));
  return cx;
}

function parseArgs(argv, spec, verb) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { positional.push(a); continue; }
    const eq = a.indexOf('=');
    const name = (eq < 0 ? a : a.slice(0, eq)).slice(2);
    if (spec.bools.includes(name)) {
      if (eq >= 0) throw new UsageError('--' + name + ' takes no value');
      flags[name] = true;
    } else if (spec.values.includes(name)) {
      let value;
      if (eq >= 0) value = a.slice(eq + 1);
      else {
        i++;
        if (i >= argv.length) throw new UsageError('--' + name + ' needs a value');
        value = argv[i];
      }
      /* a repeatable flag accumulates, so one invocation adds two labels */
      if (spec.multi && spec.multi.includes(name)) {
        if (!Array.isArray(flags[name])) flags[name] = [];
        flags[name].push(value);
      } else flags[name] = value;
    } else {
      throw new UsageError(verb + ' does not take --' + name);
    }
  }
  return { flags, positional };
}

/* WHAT A SNOOZE WAITS FOR, all of it: the three conditions combine and
   whichever fires first wakes the question, so the printed line lists every one
   the verb stored rather than picking between two. The link's words are the
   board chip's, so the line and the card say the same thing. */
function snoozeWords(s) {
  const out = [];
  if (s && s.until) out.push('until ' + s.until);
  if (s && s.trigger) out.push('on trigger: ' + s.trigger);
  if (s && s.wakeOn) out.push('waits on ' + s.wakeOn + (s.wakeStatus ? ': ' + s.wakeStatus : ''));
  return out.join(', ');
}

function oneLine(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

/* Reads the whole of stdin as the verb's body, with the same guard register
   keeps: an interactive terminal never sends EOF on its
   own, so a bare `askerdo note T-1` would just hang. */
async function readBody(cx, verb, what) {
  if (cx.tty) throw new UsageError(verb + ' reads its ' + what + ' from stdin; pipe it in');
  return cx.stdin();
}

async function readPayload(cx, verb) {
  try {
    return JSON.parse(await readBody(cx, verb, 'JSON payload'));
  } catch (e) {
    if (e instanceof UsageError || e instanceof NeedStdin) throw e;
    throw new UsageError(verb + ' payload on stdin is not JSON');
  }
}

/* A close's leftovers, a JSON list on stdin, checked here as a handoff's are before the board sees them. */
async function leftoversIn(cx, verb, flags) {
  if (!flags.leftovers) return undefined;
  if (!['done', 'dropped'].includes(flags.status)) throw new UsageError('--leftovers goes with --status done or dropped: the steps this close leaves');
  const list = await readPayload(cx, verb);
  if (!Array.isArray(list) || !list.length) throw new UsageError(verb + ' --leftovers reads a JSON list of steps on stdin: [{ "name": "the step", "runBy": "orchestrator" }]');
  const problems = stepProblems(list, 'leftovers', true, true);
  if (problems.length) throw new UsageError(problems.join('; '));
  return list;
}

/* The edit flags, one shape for all three kinds; the VERBS row is what decides
   which of them a given verb accepts at all. `session` is not a field flip: it
   is the acting identity that classifies the mutation user-authored or
   session-authored. */
function editChanges(flags) {
  return {
    session: flags.session,
    name: flags.name, status: flags.status, priority: flags.priority,
    intent: flags.intent, description: flags.description,
    ordinal: flags.ordinal, workstream: flags.workstream, plan: flags.plan,
    clearWorkstream: flags['clear-workstream'], clearPlan: flags['clear-plan'],
    track: flags.track, clearTrack: flags['clear-track'],
    addLabel: flags['add-label'], removeLabel: flags['remove-label'],
    addRef: flags['add-ref'], removeRef: flags['remove-ref'],
    addProject: flags['add-project'], removeProject: flags['remove-project'],
    addOutcome: flags['add-outcome'], removeOutcome: flags['remove-outcome'], handoff: flags.handoff, clearHandoff: flags['clear-handoff'],
    serves: flags.serves, clearServes: flags['clear-serves'], runBy: flags['run-by'], clearRunBy: flags['clear-run-by'], reviewScope: flags['review-scope'],
    close: flags.close, clearClose: flags['clear-close'],
    pick: flags.pick, clearPick: flags['clear-pick'],
    addGate: flags['add-gate'], removeGate: flags['remove-gate'],
    inHand: flags['in-hand'], letGo: flags['let-go'], takeOver: flags['take-over'],
  };
}

/* An activity line's changes as words: 'status open -> in_progress', a create's
   fields with no arrow (they came from nothing), and a cleared field said so.
   The store's own editDetail spells an event's tail the same way. */
function changeText(changes, id) {
  return Object.entries(changes || {}).map(([key, pair]) => {
    const [rawFrom, rawTo] = Array.isArray(pair) ? pair : [null, pair];
    /* `chosen` is logged as the option's own type, the letter, because
       that is what the record holds. A reader is owed the token, so the row is
       composed here, where it is shaped for printing, and never in the log. A
       legacy value composes to itself and reads exactly as it was written.
       BOTH ENDS: an answer's pair is [null, letter] and only its
       `to` has ever been a token, while a correction's pair is two letters and
       "chosen a -> 105b" would be half composed. */
    const compose = (v) => (key === 'chosen' && typeof v === 'string' ? answerToken(id, v) : v);
    const from = compose(rawFrom);
    const to = compose(rawTo);
    const val = (v) => (Array.isArray(v) ? v.join(', ') : oneLine(v));
    if (to === null || to === undefined || to === '') return key + ' cleared';
    if (from === null || from === undefined || from === '') return key + ' ' + val(to);
    return key + ' ' + val(from) + ' -> ' + val(to);
  }).join('; ');
}

/* ONE LINE PER EVENT, and a corruption row named for what it is, exactly as the
   list verbs name an unreadable record rather than dropping it. */
function activityText(l) {
  if (l.unreadable) {
    return 'activity/' + l.month + '.jsonl line ' + l.line + ' UNREADABLE: ' + oneLine(l.error);
  }
  const parts = [];
  const what = changeText(l.changes, l.id);
  if (what) parts.push(what);
  if (l.note) parts.push('"' + oneLine(l.note) + '"');
  return l.ts + ' ' + l.verb + ' ' + (l.id ? l.id + ' ' : '') + oneLine(l.name)
    + (parts.length ? ': ' + parts.join('; ') : '') + ' (' + l.by + ')';
}

/* ---- show --brief: a record ONCE -------------------------------- */

/* A record carries its texts twice (the fields and a `sections` map): the brief
   prints the head, the name and each text once; --journal puts the journal back last. */

/* The section names the record's own fields already carry: skipped in the section walk. */
const REPEATED_SECTIONS = ['Description', 'Intent', 'Journal'];

/* The statuses in which a question's decision is still to be made, and so the
   only ones where its options, stakes and while-this-waits still bind. */
const QUESTION_OPEN = ['open', 'snoozed'];

/* Two spaces between head fields, so a head reads as columns rather than as a
   sentence, and ONE blank line between records, which is what tells two of
   them apart in a `show T-71 T-72 --brief` read. */
const HEAD_SEP = '  ';
const RECORD_SEP = '\n\n';

/* One head field. `key` and `value` are what the --json form carries; `text`
   is the token the plain form prints, and an empty one prints nothing, which
   is how a question's workstream and track share one 'WS-4 / TR-3' token while
   the json keeps the two fields apart. */
const headField = (key, value, text) => ({ key, value, text: text === undefined ? String(value) : text });

/* an answered question's head names the answer; the stored pick is the
   asking session's recommendation, so it prints labelled, and only while undecided. */
const chosenOf = (r) => (r.status === 'answered' ? answeredPick(r) : null);
const pickWords = (r) => (r.pick && r.status !== 'answered' ?"session's pick " + answerToken(r.id, r.pick) : '');

/* `reader` the session reading it, so its own run reads "this session" */
function briefHead(r, kind, reader) {
  const chose = kind === 'question' ? chosenOf(r) : null;
  /* a task says its word as track show does; the stored status stays the json's */
  const said = kind === 'task' ? wordLine(r.word, Date.now(), reader) : '';
  const out = [headField('id', r.id), headField('kind', kind), headField('status', r.status, chose ? 'answered ' + answerToken(r.id, chose) : said || undefined)];
  if (said) out.push(headField('word', r.word, ''));
  if (kind === 'question') {
    if (chose) out.push(headField('chosen', chose, ''));
    if (r.blocking === true) out.push(headField('blocking', true, 'blocking'));
    /* the json keeps the STORED type, which is what the record holds; the
       plain form prints the composed token, which is what the user types */
    if (r.pick) out.push(headField('pick', r.pick, pickWords(r)));
    if (r.project) out.push(headField('project', r.project));
    if (Array.isArray(r.gates) && r.gates.length) out.push(headField('gates', r.gates, 'gates ' + r.gates.join(', ')));
  } else if (kind === 'handoff') {
    out.push(headField('track', r.track));
    if (r.fromSession) out.push(headField('fromSession', r.fromSession, 'from ' + r.fromSession));
    const d = r.depthAtHandoff;
    if (d && typeof d === 'object') {
      out.push(headField('depthAtHandoff', d, 'depth ' + [d.tokens !== undefined ? d.tokens + ' tokens' : '',
        d.percent !== undefined ? d.percent + '%' : ''].filter(Boolean).join(' ')));
    }
    if (r.inHand && r.inHand.length) out.push(headField('inHand', r.inHand, 'in hand ' + [].concat(r.inHand).join(', ')));
    if (r.resumedBy) out.push(headField('resumedBy', r.resumedBy, 'resumed by ' + r.resumedBy));
    if (r.supersededBy) out.push(headField('supersededBy', r.supersededBy, 'superseded by ' + r.supersededBy));
  } else {
    if (kind === 'knowledge') {
      out.push(headField('type', r.type));
      if (r.scope) out.push(headField('scope', r.scope));
      if (r.supersededBy) out.push(headField('supersededBy', r.supersededBy, 'superseded by ' + r.supersededBy));
      if (r.amended) out.push(headField('amended', r.amended, 'amended ' + String(r.amended).slice(0, 10)));
      if (r.legacy) out.push(headField('legacy', r.legacy, 'was ' + r.legacy));
      /* a decision's links, as labels */
      if (r.question) out.push(headField('question', r.question, 'answers ' + r.question));
      for (const key of ['workstreams', 'tracks', 'tasks', 'files', 'commands']) {
        if (Array.isArray(r[key]) && r[key].length) out.push(headField(key, r[key], key + ' ' + r[key].join(', ')));
      }
      if (r.words) out.push(headField('words', r.words, 'words "' + oneLine(r.words) + '"'));
      /* a confirmed ruling is carried by its title alone, so show says which */
      if (r.type === 'decision') out.push(headField('confirmed', r.confirmed === true, r.confirmed === true ? 'confirmed: the title is the user\'s' : 'not confirmed: the words carry it'));
    }
    if (r.corrected) out.push(headField('corrected', r.corrected, 'corrected ' + String(r.corrected).slice(0, 10)));
    if (kind === 'workstream' && r.handoff) out.push(headField('handoff', r.handoff, 'handoff ' + r.handoff));
    if (r.priority) out.push(headField('priority', r.priority));
    if (r.serving) out.push(headField('serves', Array.isArray(r.serves) ? r.serves : [], 'serves ' + r.serving));
    if (Array.isArray(r.waitsOn) && r.waitsOn.length) {
      /* a waiting word already names the gate */
      out.push(headField('waitsOn', r.waitsOn.map((q) => q.id), said.startsWith('waiting') ? '' : 'waits on ' + r.waitsOn.map((q) => q.id).join(', ')));
    }
    if (r.ordinal !== undefined && r.ordinal !== '') out.push(headField('ordinal', r.ordinal, 'ordinal ' + r.ordinal));
  }
  const track = kind === 'question' ? r.track : '';
  const where = [r.workstream, track].filter(Boolean).join(' / ');
  if (r.workstream) out.push(headField('workstream', r.workstream, where));
  if (track) out.push(headField('track', track, r.workstream ? '' : where));
  /* the PC a question was asked from, beside its track */
  if (kind === 'question' && r.pc) out.push(headField('pc', r.pc, 'on ' + r.pc));
  /* an empty list is no field at all, exactly as the store serializes one */
  for (const key of ['projectRepos', 'projects', 'links', 'labels', 'refs']) {
    const v = r[key];
    if (Array.isArray(v) && v.length) out.push(headField(key, v, key + ' ' + v.join(', ')));
  }
  for (const key of ['created', 'updated', 'closed', 'answered', 'resumed']) {
    if (r[key]) out.push(headField(key, r[key], key + ' ' + r[key]));
  }
  if (r.outcome) out.push(headField('outcome', r.outcome, 'outcome ' + oneLine(r.outcome)));
  return out;
}

/* One option per line, in the table's own column order, led by the COMPOSED
   answer token: the brief is read to answer from, so the first thing on
   the line is the word that gets typed back. */
const optionLine = (id, o) => [answerToken(id, o.type), o.option,
  o.getsYou ? 'what happens: ' + o.getsYou : '', o.costsYou ? 'catch: ' + o.costsYou : '']
  .filter(Boolean).join(HEAD_SEP);

function briefSections(r, kind, wantJournal, who = 'the user') {
  const out = [];
  const add = (label, text) => {
    const t = String(text === undefined || text === null ? '' : text).trim();
    if (t) out.push({ label, text: t });
  };
  if (kind === 'question') {
    add('Gist', r.gist);
    /* an OPEN question still has its decision to make, so the alternatives,
       what is at stake and what runs meanwhile all bind; once it is answered
       or dropped the pick is made and the gist, the context and the answer are
       what still say anything. Evidence and subscribers are the board's and
       are in neither form. */
    if (QUESTION_OPEN.includes(r.status)) {
      if (Array.isArray(r.options) && r.options.length) {
        add('Options', r.options.map((o) => optionLine(r.id, o)).join('\n'));
      }
      add('Stakes', r.stakes);
      add('While this waits', r.whileThisWaits);
    }
    add('Context', r.context);
    /* an unanswered question's Answer section is the skeleton's own
       placeholder line, which is not an answer and is not printed */
    if (!QUESTION_OPEN.includes(r.status)) add('Answer', r.answer);
  } else if (kind === 'handoff') {
    add('Waiting on ' + who, (r.waitingOnUser || []).length ? r.waitingOnUser.join('\n') : 'nothing');
    /* the chat rulings it carries, registered or not */
    add('Rulings', (r.rulings || []).map((x) => x.id + (x.registered ? ' (registered ' + x.registered + ')' : ' (not yet registered)') + ': ' + x.text).join('\n'));
    add('Park reason', r.parkReason);
    add('State', r.state);
    add('Where we were', r.whereWeWere);
    add('Verify first', (r.verifyFirst || []).map(verifyLine).join('\n'));
  } else {
    /* a knowledge record made without a description carries its title there; say it once */
    if (!(kind === 'knowledge' && r.description === r.name)) add('Description', r.description);
    add('Intent', r.intent);
    /* the filer's line on why the track it held does not cover this work */
    if (kind === 'task') add('Filed past the held track', r.whyElsewhere);
    if (kind === 'task') add('Filed last', r.filedLast);
    if (Array.isArray(r.procedures)) add('Procedures', r.procedures.map((c) => citedWords(c)).join('\n'));
    /* each step with its index and done mark, as check done and check move name them */
    if (Array.isArray(r.checklist)) add('Checklist', r.checklist.map((c) => c.n + ' ' + stepMark(c) + ' ' + oneLine(c.text) + struckWhy(c)).join('\n'));
    /* the user's outcomes, headed apart from `outcome`, the close text */
    if (kind === 'workstream') add('Your outcomes', outcomeList(r).map((o) => o.id + ' ' + oneLine(o.text)).join('\n'));
    for (const [name, text] of Object.entries(r.sections || {})) {
      if (REPEATED_SECTIONS.includes(name)) continue;
      add(name, text);
    }
  }
  if (wantJournal && kind !== 'handoff') add('Journal', r.journal);
  return out;
}

/* One verify-first repo on one line, the order a resume checks them in. */
function verifyLine(e) {
  const files = Array.isArray(e.files) ? e.files : [];
  return [e.path, e.branch ? 'branch ' + e.branch : '', e.worktree ? 'worktree ' + e.worktree : '',
    e.commit ? 'at ' + String(e.commit).slice(0, 12) : '',
    e.expectedDirty && e.expectedDirty.length ? 'expected dirty: ' + e.expectedDirty.join(', ') : '',
    e.ownedByOthers && e.ownedByOthers.length ? 'owned by other work: ' + e.ownedByOthers.join(', ') : '',
    files.length ? 'loose files: ' + files.map((f) => f.path + ' ' + f.disposition + (f.review ? ' (review ' + f.review + ')' : '')).join(', ') : '']
    .filter(Boolean).join(HEAD_SEP);
}

/* ONE model, two renderings, so the plain form and the --json form can never
   select differently. A question payload carries no kind field, and the id
   prefix that routed the read is what says it is one. */
function briefModel(r, wantJournal, who, reader) {
  const kind = r.kind || 'question';
  return { head: briefHead(r, kind, reader), name: kind === 'handoff' ? r.focus : r.name, sections: briefSections(r, kind, wantJournal, who) };
}

function briefText(m) {
  const lines = [m.head.map((f) => f.text).filter(Boolean).join(HEAD_SEP), oneLine(m.name)];
  for (const s of m.sections) lines.push('', s.label, s.text);
  return lines.join('\n');
}

function briefJson(m) {
  const out = {};
  for (const f of m.head) out[f.key] = f.value;
  out.name = m.name;
  out.sections = {};
  for (const s of m.sections) out.sections[s.label] = s.text;
  return out;
}

/* One procedure card on one line: its badge and the file holding the steps. */
function procLine(c) {
  return c.id + ' ' + c.slug + ' [' + c.badge + ']: ' + oneLine(c.name) + ' -> ' + c.path
    + (c.reasons.length ? '\n  ' + c.reasons.slice(0, 3).join('; ') : '');
}

function procScanText(r) {
  const parts = [r.project + ':'];
  for (const k of ['created', 'updated', 'retired', 'unchanged']) if (r[k].length) parts.push(k + ' ' + r[k].join(', '));
  if (parts.length === 1 && !r.unparseable.length) parts.push('no procedure files in docs/procedures');
  const lines = [parts.join(' ')];
  const ew = ['created', 'updated', 'retired'].filter((k) => r.everywhere && r.everywhere[k].length).map((k) => k + ' ' + r.everywhere[k].join(', '));
  if (ew.length) lines.push('cards for every project: ' + ew.join(' '));
  for (const u of r.unparseable) lines.push('unparseable ' + u.file + ': ' + u.errors.join('; '));
  for (const w of r.warnings) lines.push('lint ' + w.file + ': ' + w.warnings.join('; '));
  if (r.here) lines.push('read the main checkout ' + r.project + ', not ' + r.here + ': proc scan --check checks the files of this worktree');
  return lines.join('\n');
}

/* The repo the CLI runs in, the default --project of knowledge new. */
function repoRootOf(cwd) {
  const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', windowsHide: true });
  const top = r.status === 0 ? String(r.stdout || '').trim() : '';
  if (!top) throw new UsageError('knowledge new needs --project <dir> or --global outside a git repo');
  return normProject(top);
}

function readBodyFile(path) {
  try { return readFileSync(path, 'utf8'); } catch { throw new UsageError('cannot read --body-file ' + path); }
}

/* Every tier's timings in one summary: this PC's local server log
   (the mod's band redraws log there too) and the board's, over its GET route. */
async function timingsCommand(cx, flags) {
  const file = join(cx.root(), 'board', 'timings-local.log');
  const local = timingSummary(file);
  const url = boardUrl(cx.env);
  let board = null;
  let boardError = null;
  if (/^https?:/i.test(url || '')) {
    try { board = await boardRequest('GET', API + '/timings', undefined, { url, token: boardToken(cx.env) }); } catch (e) { boardError = (e && e.message) || String(e); }
  } else boardError = url ? 'the board at ' + url + ' runs in this process and keeps no log' : 'no board is set';
  const rows = (list) => (list.length ? list.map((r) => '  ' + timingRow(r)).join('\n') : '  nothing logged yet');
  const c = board && board.lastCheck;
  return cx.emit(flags, { local: { file, rows: local }, board, ...(boardError ? { boardError } : {}) },
    'This PC (' + file + '):\n' + rows(local) + '\nThe board:\n' + (board ? rows(board.rows) : '  ' + boardError)
    + (board ? '\nLast check: ' + (c ? (c.ok ? 'ok' : 'FAILED (' + (c.integrity || []).join('; ') + ', ' + c.foreignKeys + ' foreign key problems)') + ' at ' + c.at : 'none kept yet') : ''));
}

/* The verbs that read only this PC, so they need no board. */
const PC_ONLY = ['board', 'board here', 'board move', 'backup', 'restore', 'timings', 'projects', 'projects scan', 'projects forget', 'join'];
/* these use the board when there is one and this PC's config.json when not */
const NO_BOARD_TOO = ['settings', 'settings set', 'settings unset', 'settings rule'];

/* list this PC's project map, learn the repos in the named folders, or forget one entry. */
function projectsCommand(cx, verb, flags, dirs) {
  const dir = cx.dataDir();
  if (!dir) throw new UsageError('this PC has no AskerDo data folder, so it keeps no project map');
  const r = verb === 'projects scan' ? scanProjects(dir, dirs && dirs.length ? dirs : [cx.cwd]) : null;
  const f = verb === 'projects forget' ? forgetInMap(dir, dirs[0]) : null;
  if (f && !f.dropped) throw new UsageError("this PC's map has no " + dirs[0] + ' (askerdo projects lists it)');
  const map = readMap(dir);
  const rows = Object.keys(map).sort().map((name) => ({ name, dir: map[name], ...entryDrift(name, map[name]) }));
  const said = r ? r.added.map((a) => 'mapped ' + a.name + ' to ' + a.dir + (a.was ? ' (was ' + a.was + ')' : ''))
    .concat(r.others.map((o) => 'also found ' + o.name + ' at ' + o.dir + ', kept ' + o.kept + ': pass the folder to pick it'))
    .concat(r.missing.map((m) => 'no folder ' + m)).concat(r.added.length ? [] : ['nothing new to map'])
    : f ? ['forgot ' + dirs[0] + ' (was ' + f.dir + ')'] : [];
  const forget = (name) => 'askerdo projects forget ' + (/\s/.test(name) ? '"' + name + '"' : name);
  const line = (x) => x.name + '  ' + x.dir + (x.gone ? '  (folder gone: ' + forget(x.name) + ')'
    : x.now ? '  (that folder is now ' + x.now + ': ' + forget(x.name) + ')' : '');
  const text = said.concat(rows.length ? rows.map(line) : ['no projects mapped on this PC yet']).join('\n');
  return cx.emit(flags, { file: r ? r.file : f ? f.file : null, ...(r ? { added: r.added, others: r.others, missing: r.missing } : {}),
    ...(f ? { forgot: { name: dirs[0], dir: f.dir } } : {}), projects: rows }, text);
}

/* the board moves the records, then this PC's map drops the old name for the new one. */
async function projectsRename(cx, flags, [from, to]) {
  const folders = (flags.folder || []).map((f) => {
    const i = String(f).indexOf('=');
    if (i <= 0 || i === f.length - 1) throw new UsageError('--folder takes <old dir>=<new dir>: ' + f);
    return { from: cx.path(f.slice(0, i).trim()), to: cx.path(f.slice(i + 1).trim()) };
  });
  const r = await onBoard(() => cx.call('projectsRename', { from, to, folders, dryRun: flags['dry-run'] === true }, boardActor({}, flags.session)));
  const dir = cx.dataDir();
  const map = dir ? renameInMap(dir, r.from, r.to, folders, { dryRun: r.dryRun }) : null;
  const word = { question: 'question', workstream: 'workstream', knowledge: 'knowledge record', procedure: 'procedure card', profile: 'profile holding', conversion: 'conversion map row' };
  const counts = Object.entries(r.moved).map(([k, n]) => n + ' ' + (word[k] || k) + (n === 1 ? '' : 's')).join(', ');
  const total = Object.values(r.moved).reduce((a, b) => a + b, 0);
  const lines = [(r.dryRun ? 'dry run, nothing written: ' : '') + (total ? (r.dryRun ? 'would move ' : 'moved ') + r.from + ' to ' + r.to + ': ' + counts
    : 'nothing on the board names ' + r.from)];
  if (r.retired.length) lines.push((r.dryRun ? 'would retire ' : 'retired ') + r.retired.join(', ') + ': cards a scan made under ' + r.to + ' for the same files');
  if (r.unmapped.length) lines.push('the profile holding keeps these folders as they are (a --folder for each moves it): ' + r.unmapped.join(', '));
  if (!map) lines.push("this PC has no AskerDo data folder, so no project map to follow");
  else if (map.changed) lines.push((r.dryRun ? "this PC's map would name " : "this PC's map names ") + (map.dir ? r.to + ' ' + map.dir : 'no folder for ' + r.to) + (map.dropped ? (r.dryRun ? ' and drop ' : ' and drops ') + r.from : ''));
  return cx.emit(flags, { ...r, map }, lines.join('\n'));
}

/* the config is read before the code is spent, so a broken file costs no code; the
   board's three keys go over it and every other option stays, written as the contract save writes it,
   atomically: the code is spent by then and the token is never printed. */
function savedConfig(cx) {
  const dir = cx.dataDir();
  if (!dir) throw new UsageError('this PC has no AskerDo data folder to save the board into (the sandbox seam was refused)');
  const file = join(dir, 'config.json');
  let saved = {};
  try { saved = JSON.parse(noBom(readFileSync(file, 'utf8'))); } catch (e) {
    if (e.code !== 'ENOENT') saved = null;
  }
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) {
    throw new UsageError('the AskerDo config at ' + file + ' is not a JSON object, so joining would lose its options: fix or remove it first');
  }
  return { dir, file, saved };
}

async function joinCommand(cx, flags, [address, code], here = null) {
  const url = String(address).trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^/]/i.test(url)) throw new UsageError('join needs the board address first, http://<host>:<port>: ' + address);
  const { dir, file, saved } = savedConfig(cx);
  const byToken = typeof flags.token === 'string';
  if (byToken === (code !== undefined)) throw new UsageError('join takes a join code or --token <the token printed by token new>, one of the two: ' + JOIN_WAYS);
  if (byToken && flags.device) throw new UsageError('--device goes with a join code: a token from token new already names its device');
  const verb = (token) => (name, input) => boardRequest('POST', API + '/verbs/' + name, { input }, { url, token });
  /* the first PC, with no PC to mint a code: a refused token saves nothing */
  let list;
  if (byToken) {
    if (!flags.token.trim()) throw new UsageError('--token needs the device token printed by token new');
    list = await onBoard(() => verb(flags.token.trim())('profileList', {}));
  }
  const r = byToken ? { token: flags.token.trim() } : await onBoard(() => boardJoin(url, code, flags.device || deviceName(hostname())));
  mkdirSync(dir, { recursive: true });
  const joined = { ...saved, boardUrl: url, boardToken: r.token, queue: 'hub' };
  writeAtomic(file, JSON.stringify(joined, null, 2) + '\n', 0o600);
  /* the options on the user's profile, so a new PC matches at once; the token is saved first */
  let pulled;
  let seeded;
  try {
    const { profile, values } = contractOf(list || await verb(r.token)('profileList', {}));
    if (Object.keys(values).length) {
      writeAtomic(file, JSON.stringify({ ...joined, ...values }, null, 2) + '\n', 0o600);
      pulled = 'your options came from your profile ' + profile + ' on the board' + (flags.seed ? ', which already held them, so --seed left them as they are' : '');
    } else if (flags.seed) {
      ({ seeded, pulled } = await seedBoard(saved, verb(r.token)));
    } else {
      /* board here takes no second run, so its line names the steps that work after it */
      pulled = 'the board holds no options yet: ' + (here ? 'askerdo settings set <option> <value> on this PC, or '
        : byToken ? 'this join again with --seed puts the options saved on this PC there, or ' : '')
        + 'a save in /askerdo:configure on a PC on the board puts them there';
    }
  } catch (e) {
    pulled = 'your options could not be read from the board (' + e.message + '): a later session start brings them';
  }
  const who = r.device ? ' as ' + r.device : " with the device token printed by token new";
  if (here) {
    return cx.emit(flags, { device: here.device, board: url, host: here.dir, config: file, ...(seeded ? { seeded } : {}) }, 'this PC hosts the board at ' + url + ' as ' + here.device
      + '; ' + here.where + "\nits address, this PC's token and hub mode are saved in " + file + '\n' + pulled
      + "\nthis PC's local server keeps it running; it answers this PC alone, so another PC joins once askerdo board move puts it on a server");
  }
  /* the local server follows the config each second, so a running one needs no restart */
  let up = false;
  try { const id = boardIdentity(cx.root()); up = await pingBoard(id.port, id.secret); } catch {}
  const host = new URL(url).hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const remote = !(host === 'localhost' || host.endsWith('.localhost') || host === '::1' || /^127\./.test(host));
  const after = (remote ? 'this PC now reads and writes that board through its local server, which ' : "this PC's local server ")
    + (up ? 'is running and picks the board up at once' : 'picks the board up at the next session start');
  return cx.emit(flags, { ...(r.device ? { device: r.device } : {}), board: url, config: file, localServer: up, ...(seeded ? { seeded } : {}) }, 'joined the board at ' + url + who
    + "; its address, this PC's token and hub mode are saved in " + file + '\n' + pulled + '\n' + after);
}

/* the board on this PC. Every refusal lands before anything is written;
   a run that stopped part way picks up the database and port it left. */
async function boardHere(cx, flags) {
  const { saved } = savedConfig(cx);
  const on = String(saved.boardUrl || cx.env.ASKERDO_BOARD_URL || '').trim();
  const file = fileBoardHere(cx, saved);
  if (on && !file) throw new UsageError('this PC is already on the board at ' + on + ', so it hosts no second one');
  const problem = await hostProblem();
  if (problem) throw new UsageError(problem + ': the board cannot run here, and the text queue stays as it is');
  const root = cx.root();
  const device = deviceName(hostname());
  /* a running local server starts the board the moment host.json lands; held, it waits
     for the token, so two processes never create the schema at once */
  mkdirSync(hostDir(root), { recursive: true });
  holdBoard(root, 'its setup (board here)');
  let host;
  let minted;
  try {
    host = await prepareHost(root, file);
    /* token new opens the file itself when no board is up, the admin route when one is */
    minted = spawnSync(process.execPath, [join(pluginRoot, 'server', 'cli.mjs'), 'token', 'new', device, '--db', host.db, '--port', String(host.port)],
      { encoding: 'utf8', windowsHide: true, env: hostEnv() });
  } finally {
    releaseBoard(root);
  }
  let token = '';
  try { token = JSON.parse(minted.stdout).token; } catch {}
  if (minted.status !== 0 || !token) throw new Error('the board database at ' + host.db + ' did not take a token: ' + (String(minted.stderr || minted.stdout).trim().split(/\r?\n/)[0] || 'no reason given'));
  const r = await ensureBoardServer(root);
  if (r.status === 'foreign' || r.status === 'failed') {
    throw new Error("the board's database is in " + host.dir + ", but this PC's local server, which starts the board, did not come up: "
      + (r.detail || 'port ' + r.port + ' is held by another process') + '; askerdo board here again once it runs');
  }
  if (!await waitForBoard(host.port, 15000)) {
    throw new Error('the board did not answer on ' + host.url + ' within 15s: its log is ' + hostLog(root) + '; askerdo board here again picks up where this stopped');
  }
  const out = await joinCommand(cx, { json: flags.json, seed: flags.seed, token }, [host.url], { device, dir: host.dir, where: hostWhere(host) });
  /* the local server started on the file board and follows the config within seconds: the mod's
     next call, which ran this verb, finds the verbs route ready */
  for (let i = 0; file && i < 40; i++) {
    try { if (JSON.parse(readFileSync(join(root, 'board', 'local.json'), 'utf8')).board === host.url) break; } catch {}
    await new Promise((ok) => setTimeout(ok, 250));
  }
  return out;
}

/* a hosted file: board keeps its database where it was; the backups stay under board-host/ */
const hostWhere = (h) => (resolve(dirname(h.db)).toLowerCase() === resolve(h.dir).toLowerCase()
  ? 'its database and backups are in ' + h.dir : 'its database is ' + h.db + ' and its backups are in ' + h.dir);

/* a sandbox store on a file: board saved in its config hosts that file through its
   local server, as board here does, since the verbs route and the band need a board server.
   The database path, or '' for any other board, the env's or the live store's. */
function fileBoardHere(cx, saved = null) {
  if (!saved) { try { saved = savedConfig(cx).saved; } catch { return ''; } }
  const url = String((saved && saved.boardUrl) || '').trim();
  if (!/^file:./i.test(url) || String(cx.env.ASKERDO_BOARD_URL || '').trim() || isLiveRoot(cx.root(), homedir)) return '';
  const rest = url.slice(5);
  return rest.startsWith('//') ? fileURLToPath(url) : resolve(rest);
}

const sizeWords = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');

/* a PC on a board hosted elsewhere names the host's own command */
function hostedElsewhere(cx, what) {
  const url = boardUrl(cx.env);
  if (!url) return new UsageError('this PC hosts no board: askerdo board here sets one up');
  return new UsageError('the board at ' + url + ' is hosted elsewhere, and its host keeps its copies: there, ' + what);
}

async function copiesCommand(cx, verb, flags, which) {
  const root = cx.root();
  const host = readHost(root);
  const cfg = loadConfig(cx.env) || { ...DEFAULT_CONFIG };
  if (verb === 'backup') {
    if (!host) throw hostedElsewhere(cx, 'docker exec askerdo node /app/server/cli.mjs backup (node server/cli.mjs backup without Docker)');
    const r = await backupNow(root, { cfg });
    return cx.emit(flags, r, 'copied the board to ' + r.file + ' (' + sizeWords(r.bytes) + '); the newest 30 are kept in ' + r.dir);
  }
  if (!host) {
    throw hostedElsewhere(cx, 'with the board stopped, node /app/server/cli.mjs restore <date or file> in a throwaway container on its volumes'
      + ' (node server/cli.mjs restore without Docker); with no copy named it lists them');
  }
  if (which === undefined) {
    const copies = await listCopies(root, cfg);
    const dirs = copyDirs(root, cfg);
    const line = (c) => c.day + '  ' + sizeWords(c.bytes).padStart(9) + '  ' + c.file + (c.kind === 'pre-schema' ? '  (taken before a schema change)' : '');
    return cx.emit(flags, { copies, dirs }, copies.length ? copies.map(line).join('\n') + '\naskerdo restore <date or file> puts one back'
      : 'no copies yet in ' + dirs.join(' or ') + ': askerdo backup makes one');
  }
  const r = await restoreHere(root, which, { cfg, ensure: () => ensureBoardServer(root) });
  const up = r.answering ? '; the board answers again at ' + r.url : '; the board has not answered yet: its log is ' + hostLog(root);
  if (!r.ok) {
    throw new Error(r.from + ' failed the integrity check (' + r.check.integrity.join('; ') + (r.check.foreignKeys ? ', ' + r.check.foreignKeys + ' foreign key problems' : '')
      + '), so the board kept its own files' + up);
  }
  return cx.emit(flags, r, 'restored ' + r.from + ' as ' + r.db + '; it passed the integrity check'
    + (r.aside ? ', and the files it replaced are kept in ' + r.aside : '') + up
    + "\nevery PC on the board starts over from it on its own; changes made after the copy are gone");
}

/* the move in two runs, so the copy the new host restores is the board's last word */
async function boardMove(cx, flags, address) {
  const root = cx.root();
  const host = readHost(root);
  if (flags.cancel) {
    const h = heldBy(root);
    if (!h || !h.url) throw new UsageError('no move is under way on this PC');
    releaseBoard(root);
    const up = host ? await waitForBoard(host.port, 15000) : false;
    return cx.emit(flags, { cancelled: h.url, answering: up }, 'the move to ' + h.url + ' is dropped; the board on this PC '
      + (up ? 'answers again at ' + host.url : 'starts again with its local server (its log is ' + hostLog(root) + ')'));
  }
  const url = String(address || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^/]/i.test(url)) throw new UsageError('board move needs the new board address, http://<host>:<port>' + (address ? ': ' + address : ''));
  if (!host) throw new UsageError('this PC hosts no board to move: askerdo board names the board it is on');
  if (url.toLowerCase() === host.url) throw new UsageError(url + ' is the board on this PC itself');
  const { file, saved } = savedConfig(cx);
  const token = String(saved.boardToken || '').trim();
  if (!token) throw new UsageError("this PC's config holds no board token for the new board to check: askerdo board here saves it");
  const cfg = loadConfig(cx.env) || { ...DEFAULT_CONFIG };
  let theirs = null;
  try {
    await boardRequest('POST', API + '/verbs/profileList', { input: {} }, { url, token, timeoutMs: 5000 });
    theirs = await boardHealth(url);
  } catch (e) {
    /* a board on another protocol would refuse this PC after the move too */
    if (protocolProblem(e)) throw new UsageError('the board at ' + url + ' would refuse this PC, so nothing moved: ' + e.message);
  }
  const held = heldBy(root);
  if (!theirs) {
    const h = await moveCopy(root, url, { cfg });
    const name = h.file.replace(/^.*[\\/]/, '');
    return cx.emit(flags, { url, moved: false, file: h.file, seq: h.seq }, [
      'the board on this PC is stopped, so nothing is written after this copy: ' + h.file,
      '1. copy it to the new board\'s server',
      '2. there, with that board stopped, restore it into the board\'s data folder:',
      '   docker stop askerdo',
      '   docker run --rm -v askerdo-data:/data -v <the folder holding the copy>:/from askerdo-board node /app/server/cli.mjs restore /from/' + name,
      '   docker start askerdo',
      "   (askerdo-board is the image compose and the kit build; on a kit host, the kit's ./data folder in place of askerdo-data;"
        + ' without Docker: node server/cli.mjs restore <the copy>, with the ASKERDO_DB the board runs on)',
      '3. askerdo board move ' + url + ' again: once that board answers with this PC\'s token, this PC moves onto it',
      'askerdo board move --cancel starts the board on this PC again instead',
    ].join('\n'));
  }
  if (held && held.url === url && Number.isInteger(held.seq) && Number(theirs.seq) < held.seq) {
    throw new UsageError('the board at ' + url + " answers with this PC's token but holds an older copy (its last change is " + theirs.seq
      + ', the move\'s copy reaches ' + held.seq + '): restore ' + held.file + ' there, then run this again');
  }
  /* a board restored there by hand, with no first run: hold it so nothing restarts it */
  if (!held) holdBoard(root, 'a move to ' + url, { pid: null, url });
  if (!await stopHostedBoard(root)) throw new Error('the board on ' + host.url + ' did not stop, so this PC stays on it');
  writeAtomic(file, JSON.stringify({ ...saved, boardUrl: url, boardToken: token, queue: 'hub' }, null, 2) + '\n', 0o600);
  const kept = retireHost(root, url);
  return cx.emit(flags, { url, moved: true, dir: host.dir, record: kept }, 'this PC is on the board at ' + url + ' now, with its own token;'
    + ' the board that ran here is stopped and no longer starts, and its folder stays at ' + host.dir
    + '\nanother PC joins it with a code from askerdo join-code');
}

const JOIN_WAYS = 'join <board url> <code>, with the setup code a new board prints at its start on the first PC or a code from join-code on every later one;'
  + ' join <board url> --token <token> on the first PC when its setup code is gone';

/* a board holding no options takes this PC's saved ones, only on the join's --seed */
async function seedBoard(saved, call) {
  const cfg = {};
  for (const k of CONTRACT_KEYS) {
    if (saved[k] === undefined) continue;
    try { cfg[k] = checkSetting('contract.' + k, saved[k]); } catch {}
  }
  if (!Object.keys(cfg).length) return { pulled: 'the board holds no options yet and this PC has none saved to put there: the interview in /askerdo:configure sets them on the board' };
  try {
    const seeded = await saveToBoard(cfg, call);
    return { seeded, pulled: "this PC's options are on the board now, on your profile " + seeded + ', and every PC that joins takes them' };
  } catch (e) {
    return { pulled: "the board did not take this PC's options (" + e.message + '): /askerdo:configure on this PC puts them there' };
  }
}

/* this PC's version and the board's, one line each and the behind line; a board that does not answer is said, never an error */
async function versionsOf(env) {
  const pc = pluginVersion();
  const url = boardUrl(env) || '';
  const http = /^https?:/i.test(url);
  const h = http ? await boardHealth(url) : null;
  const board = http ? (h && typeof h.version === 'string' ? h.version : null) : url ? boardVersion() : null;
  const where = http ? 'the board at ' + url.replace(/\/+$/, '') : 'the board';
  const line = !url ? 'no board is set on this PC'
    : http && !h ? where + ' does not answer'
      : board && board !== 'unknown' ? where + ' runs ' + board + (http ? '' : ' (in this process)') : where + ' does not say its version';
  /* a board server names its server commit; one in this process runs this plugin's code */
  const c = http && h ? commitWords(h.commit, shippedCommits()) : null;
  const behind = [versionWords(pc, board).behind, c ? c.behind : ''].filter(Boolean).join('\n');
  return { pc, board: { url, answering: http ? !!h : !!url, version: board, ...(c ? { commit: typeof h.commit === 'string' ? h.commit : null, commitState: c.state } : {}) }, behind,
    lines: ['AskerDo ' + pc + ' on this PC', line + (c ? ', ' + c.commit : ''), ...(behind ? [behind] : [])] };
}

/* No board set: every command but help and board (this PC's local server) refuses with this line. */
const NO_BOARD = 'board not configured: join this PC with a code from join-code on a PC on the board (/askerdo:configure, the join-a-pc card), or set ASKERDO_BOARD_URL';

async function main(cx, argv) {
  const { emit } = cx;
  /* a seam the resolver could not take would fall through to the real home */
  const seamBad = seamRootProblem(cx.env);
  if (seamBad) throw new UsageError(seamBad);
  let [verb, ...rest] = argv;
  if (verb === 'board' && (rest[0] === 'here' || rest[0] === 'move')) { verb = 'board ' + rest[0]; rest = rest.slice(1); }
  if (verb === 'projects' && (rest[0] === 'scan' || rest[0] === 'rename' || rest[0] === 'forget')) { verb = 'projects ' + rest[0]; rest = rest.slice(1); }
  if (verb === 'decisions' && rest[0] === 'triggers') { verb = 'decisions triggers'; rest = rest.slice(1); }
  if (verb === 'conversion' && (rest[0] === 'put' || rest[0] === 'drop')) { verb = 'conversion ' + rest[0]; rest = rest.slice(1); }
  if (verb === 'upkeep' && (rest[0] === 'on' || rest[0] === 'off')) { verb = 'upkeep ' + rest[0]; rest = rest.slice(1); }
  if (verb === 'settings' && (rest[0] === 'set' || rest[0] === 'unset' || rest[0] === 'rule')) { verb = 'settings ' + rest[0]; rest = rest.slice(1); }
  if (!verb) throw new UsageError('a verb is required: ' + Object.keys(VERBS).join(', ') + ' (help lists them)');
  if (verb === '--help') verb = 'help';
  if (verb === '--version') {
    const v = await versionsOf(cx.env);
    return emit({ json: rest.includes('--json') }, { pc: v.pc, board: v.board, behind: v.behind || null }, v.lines.join('\n'));
  }
  /* threads and plans have no board counterpart: the refusal names what replaces them */
  if (verb === 'plan' || verb === 'thread') {
    const two = rest[0] && !rest[0].startsWith('--') ? verb + ' ' + rest[0] : verb;
    throw new UsageError(trackInstead(two, TRACK_INSTEAD[two] || 'track --help'));
  }
  /* 'ws create' and its siblings are one verb spelled in two words */
  if (KIND_WORDS.includes(verb)) {
    const sub = rest[0];
    const subs = Object.keys(VERBS).filter((v) => v.startsWith(verb + ' '));
    if (sub === '--help') return cx.out(subs.map((v) => verbHelp(v, cx.who())).join('\n\n') + '\n');
    if (!sub || sub.startsWith('--')) throw new UsageError(verb + ' needs a subcommand: ' + subs.map((v) => v.split(' ')[1]).join(', '));
    verb += ' ' + sub;
    rest = rest.slice(1);
  }
  if (TRACK_INSTEAD[verb]) throw new UsageError(trackInstead(verb, TRACK_INSTEAD[verb]));
  const spec = VERBS[verb];
  if (!spec) throw new UsageError('unknown verb: ' + verb + ' (try ' + Object.keys(VERBS).join(', ') + ')');
  /* --help anywhere after the verb prints its help and runs nothing */
  if (rest.includes('--help')) return cx.out(verbHelp(verb, cx.who()) + '\n');
  if (verb === 'help') {
    const want = rest.join(' ').trim();
    if (!want) return cx.out(helpIndex(cx.who()) + '\n');
    if (VERBS[want]) return cx.out(verbHelp(want, cx.who()) + '\n');
    const subs = Object.keys(VERBS).filter((v) => v.startsWith(want + ' '));
    if (subs.length) return cx.out(subs.map((v) => verbHelp(v, cx.who())).join('\n\n') + '\n');
    throw new UsageError('no verb ' + want + ' (help lists them)');
  }
  /* it reads a PC with no board too, so it runs before the board gate */
  if (verb === 'status') {
    const { flags } = parseArgs(rest, spec, verb);
    const { healthText, pcHealth } = await import('./pc-health.mjs');
    const r = await pcHealth({ env: cx.env });
    /* a script or a check can read the verdict: 1 when any problem is listed */
    if (r.problems && r.problems.length) cx.exit = 1;
    return emit(flags, r, healthText(r));
  }
  /* a check of a branch's cards reads only files, so it needs no board */
  const fileCheck = verb === 'proc scan' && rest.includes('--check');
  if (!PC_ONLY.includes(verb) && !NO_BOARD_TOO.includes(verb) && !fileCheck && !boardUrl(cx.env)) throw new UsageError(NO_BOARD);
  const { flags, positional } = parseArgs(rest, spec, verb);
  /* a path flag names the caller's folder, wherever this runs; show's and legacy's --project is an old brain slug */
  for (const k of ['project', 'body-file']) {
    if (k === 'project' && (verb === 'show' || verb === 'legacy')) continue;
    if (typeof flags[k] === 'string') flags[k] = cx.path(flags[k]);
    else if (Array.isArray(flags[k])) flags[k] = flags[k].map(cx.path);
  }
  let id;
  let ids;
  let text;
  if (spec.id) {
    /* a verb whose row says manyIds takes a rest of ids only in a form that prints
       a set: --full keeps the exactly-one shape; --json alone prints one record, or an array for several */
    const many = spec.manyIds === 'any' || (spec.manyIds === true && (flags.brief === true || flags.head === true || flags.section !== undefined || !flags.full));
    if (verb === 'note' && positional.length > 1) {
      throw new UsageError('note takes one record id, and the text is not a second one: ' + NOTE_WAYS);
    }
    if (many ? positional.length < 1 : positional.length !== 1) {
      const ways = !many && canonLabel(positional[0]) && positional.slice(1).some((p) => !canonLabel(p)) ? textWays(spec) : null;
      throw new UsageError(verb + ' needs ' + (many ? 'at least one ' : 'exactly one ') + (spec.idWord || 'question id')
        + (ways ? ', and the words after it are not ids: ' + ways : ''));
    }
    id = positional[0];
    ids = positional;
  } else if (spec.text) {
    /* the words a person typed, however many of them: a shell splits them and
       a search box would not have */
    text = positional.join(' ').trim();
    if (!text) throw new UsageError(verb + ' needs some words to look for');
  } else if (spec.pair) {
    const n = spec.pair.length;
    if (positional.length !== n && !(spec.pairPlus && positional.length === n + 1)) {
      throw new UsageError(verb + ' needs ' + spec.pair.map((w) => '<' + w + '>').join(' ') + (spec.pairPlus ? ' [<' + spec.pairPlus + '>]' : ''));
    }
    ids = positional;
  } else if (spec.rest) {
    ids = positional.map(cx.path);
  } else if (spec.optionalId) {
    if (positional.length > 1) throw new UsageError(verb + ' takes at most one ' + spec.idWord);
    id = positional[0];
  } else if (positional.length) {
    throw new UsageError(verb + ' takes no positional arguments');
  }

  if (verb === 'board') {
    if (flags.port !== undefined) {
      throw new UsageError('the board port is minted at store initialization and is permanent '
        + '(every link carries it); remove ~/.claude/askerdo/board/ to re-mint, which breaks old links');
    }
    if (!flags.restart && fileBoardHere(cx)) return boardHere(cx, flags);
    const r = await ensureBoardServer(cx.root(), { restart: !!flags.restart });
    if (r.status === 'refused') throw new UsageError(r.detail);
    if (r.status === 'foreign' && r.busy) throw new Error('port ' + r.port + ' did not answer within the wait: the local server is busy, or another program holds it; run askerdo board again shortly');
    if (r.status === 'foreign') {
      throw new Error('port ' + r.port + ' is held by another process; the board cannot start '
        + '(the port is permanent; free it, or remove board/ to re-mint, breaking old links)');
    }
    if (r.status === 'failed') throw new Error('the board server did not come up: ' + (r.detail || 'unknown'));
    const host = readHost(cx.root());
    /* a local server that just started or was replaced starts the board after it, as board here waits for */
    const up = host ? await (r.status === 'running' ? boardAnswers(host.port) : waitForBoard(host.port, 15000)) : false;
    const v = await versionsOf(cx.env);
    return emit(flags, { ...r, ...(host ? { host: { url: host.url, dir: host.dir, db: host.db, answering: up } } : {}), versions: { pc: v.pc, board: v.board, behind: v.behind || null } }, 'board ' + r.status + ' at ' + r.url + '\n'
      + 'loopback form (for the OS resolver): ' + r.altUrl
      + (host ? '\nthis PC hosts the board at ' + host.url + (up ? '' : ' (not answering: its log is ' + hostLog(cx.root()) + ')')
        + '; ' + hostWhere(host) : '') + '\n' + v.lines.join('\n'));
  }
  if (verb === 'board here') return boardHere(cx, flags);
  if (verb === 'board move') return boardMove(cx, flags, id);
  if (verb === 'backup' || verb === 'restore') return copiesCommand(cx, verb, flags, id);
  if (verb === 'timings') return timingsCommand(cx, flags);
  if (verb === 'projects' || verb === 'projects scan' || verb === 'projects forget') return projectsCommand(cx, verb, flags, ids);
  if (verb === 'projects rename') return projectsRename(cx, flags, ids);
  if (verb === 'login') {
    const url = boardUrl(cx.env);
    if (flags.qr && hostedHere(cx.root(), url)) throw new UsageError(PHONE_HOST_ONLY);
    /* the phone's address is settled before a link is minted, so none is spent on a code no phone opens */
    const phone = flags.qr ? await phoneUrl(url) : null;
    if (flags.qr && !phone) throw new UsageError(phoneNowhere(url));
    const r = await onBoard(() => boardLoginLink(flags.next || '/', { url, token: boardToken(cx.env) }));
    if (flags.qr) {
      const link = loginUrl(phone, r.url);
      const rows = qrRows(link);
      return emit(flags, { ...r, url: link, qr: rows, opened: false }, qrText(rows) + '\n' + link
        + '\nit works once, until ' + atWords(r.expires, Date.now()));
    }
    const link = loginUrl(url, r.url);
    if (!flags.print) openInBrowser(link);
    return emit(flags, { ...r, url: link, opened: !flags.print }, (flags.print ? '' : 'opened in the browser: ') + link
      + '\nit works once, until ' + r.expires);
  }
  if (verb === 'join-code') {
    const url = boardUrl(cx.env);
    if (hostedHere(cx.root(), url)) throw new UsageError(HOST_ONLY);
    const r = await onBoard(() => boardJoinCode(flags.device, { url, token: boardToken(cx.env) }));
    const board = await reachableUrl(url);
    const line = joinLine(board, r);
    return emit(flags, { ...r, board, line }, 'join code ' + r.code + ': it works once' + (r.device ? ', for the device ' + r.device + ' only' : '')
      + ', until ' + atWords(r.expires, Date.now()) + '\nboard address ' + board
      + "\non the new PC, /askerdo:configure's join asks for the address and the code" + (r.device ? ' (and the name ' + r.device + ')' : '')
      + '; or, once AskerDo is installed there, run:\n' + line);
  }
  if (verb === 'join') return joinCommand(cx, flags, ids);
  if (verb === 'shelf') {
    const r = await onBoard(() => trackShelf({ git: !flags['no-git'] }, { call: cx.call }));
    if (flags.json) return emit(flags, r, '');
    if (!r.rows.length) return cx.out('the shelf is empty\n');
    for (const row of r.rows) cx.out(trackShelfLine(row, cx.who()) + '\n');
    return;
  }
  if (verb === 'handoff write') {
    if (!/^tr-/i.test(id)) throw new UsageError(trackInstead('handoff write ' + String(id).toUpperCase(), 'handoff write TR-n'));
    const payload = await readPayload(cx, verb);
    const sent = payload && typeof payload === 'object' ? payload : {};
    const by = callerSession(cx, flags, [flags.session, sent.fromSession, sent.session]);
    const r = await onBoard(() => writeTrackHandoff(id, payload, { session: by, call: cx.call, dir: cx.dataDir(), cwd: cx.cwd, env: cx.env }));
    return emit(flags, r, trackHandoffText(r, cx.who(), cx.env));
  }
  if (verb === 'handoff update') {
    if (!/^tr-/i.test(id)) throw new UsageError(trackInstead('handoff update ' + String(id).toUpperCase(), 'handoff update TR-n'));
    const payload = await readPayload(cx, verb);
    const by = callerSession(cx, flags, [flags.session, payload && typeof payload === 'object' && !Array.isArray(payload) ? payload.session : undefined]);
    const r = await onBoard(() => updateTrackHandoff(id, payload, { session: by, call: cx.call, dir: cx.dataDir(), env: cx.env }));
    return emit(flags, r, handoffUpdateText(r));
  }
  if (verb === 'resume' || /^(track|edge|check) /.test(verb) || verb === 'task update' || verb === 'task block') return trackVerb(cx, verb, flags, id, ids);
  if (verb.startsWith('profile ')) return boardProfile(cx, verb, flags, id, ids);
  if (verb === 'settings' || verb === 'settings set' || verb === 'settings unset' || verb === 'settings rule') return settingsCommand(cx, verb, flags, ids);
  if (verb === 'decide' || verb === 'decisions' || verb === 'decisions triggers') return boardDecisions(cx, verb, flags);
  if (verb.startsWith('upkeep')) return upkeepCommand(cx, verb, flags);
  if (verb.startsWith('override ')) return overrideCommand(cx, verb, flags, id, ids);
  if (verb.startsWith('commit ') || verb === 'review covers' || verb === 'coverage') return coverageCommand(cx, verb, flags, id, ids);
  if (verb === 'conversion' || verb.startsWith('conversion ')) return conversionCommand(cx, verb, flags);
  if (verb === 'purge') return purgeCommand(cx, flags, id);
  if (verb === 'activity' || verb === 'resolve' || verb === 'legacy' || verb.startsWith('proc ')) return boardRead(cx, verb, flags, { id, ids, text });
  if (verb === 'sweep') return sweepCommand(cx, flags);
  return boardCommand(cx, verb, flags, { id, ids, text });
}

/* The session sweep reads this PC's transcripts and the board; it writes under the data folder alone. */
async function sweepCommand(cx, flags) {
  const named = [flags.track !== undefined, flags.since !== undefined, flags['since-last'] === true].filter(Boolean).length;
  if (named !== 1) throw new UsageError('sweep takes one scope: --track TR-n, --since YYYY-MM-DD or --since-last');
  const data = cx.dataDir();
  if (!data) throw new UsageError('this PC has no AskerDo data folder, so the sweep has nowhere to write');
  const scope = flags.track !== undefined ? { track: flags.track } : flags.since !== undefined ? { since: flags.since } : { sinceLast: true };
  try {
    const r = await onBoard(() => runSweep({ scope, call: (name, input) => cx.call(name, input), cwd: cx.cwd, data, transcripts: transcriptsDir(cx.env) }));
    return cx.emit(flags, r, sweepText(r));
  } catch (e) {
    if (e && e.usage) throw new UsageError(e.message);
    throw e;
  }
}

/* ---- tracks on the board ---------------------------------- */

/* A board refusal or an unreachable board is the caller's to act on: exit 1. */
async function onBoard(fn) {
  try { return await fn(); } catch (e) {
    const n = e && e.constructor && e.constructor.name;
    if (e && !(e instanceof UsageError) && (e.name === 'TrackRefusal' || n === 'UsageError' || n === 'BoardCallError')) {
      const u = new UsageError(e.message);
      if (e.data && Array.isArray(e.data.offers)) u.data = { offer: e.data.offer, offers: e.data.offers };
      throw u;
    }
    throw e;
  }
}

/* A side track's way back, said the same way by park, finish and drop. */
function junctionText(j, who = 'the user') {
  if (!j || !j.track) return '';
  /* a closed parent takes no resume; the board names the open tracks, or the inbox count */
  if (j.closed) {
    return '\n' + j.track.id + ' is ' + j.track.state + ', so there is no going back on track there. '
      + (j.open.length ? 'Ask ' + who + ' which open track in ' + j.workstream + ' comes next: '
        + j.open.map((t) => t.id + ' ' + oneLine(t.name) + ' (' + t.state + ')').join('; ') + ' (/askerdo resume TR-n).'
        : j.workstream + ' has no open track' + (j.inbox ? '; ' + j.inbox + (j.inbox === 1 ? ' task waits' : ' tasks wait') + ' in its inbox' : '') + '.');
  }
  return '\nAsk ' + who + ' whether to go back on track at ' + j.track.id + (j.task ? ' (' + j.task.id + ')' : '') + ': /askerdo resume ' + j.track.id;
}

/* a third wake in one inbox stay goes to the user; the task waits on the answer */
const askedWords = (id, p) => (p.waits ? id + ' already waits on the answer to ' + p.asked.id + ', which went to the user: no new wake until it comes'
  : id + ' was woken twice in this inbox stay, so the board stored no third wake and asked the user ' + p.asked.id
    + ' (put it on a track, keep it with a reason and a new wake, or drop it); it waits on that answer, which reaches this session')
  + (p.wake ? '. Its wake stays ' + p.wake : '') + '.';

/* the inbox a close leaves, worded as the kickoff words it, with this launcher */
const inboxText = (inbox, env, ws) => inboxLines(inbox, launcherHere(env) || undefined, ws).map((l) => '\n' + l).join('');

/* numbered by place: an added or moved item's own `n` is missing or stale */
function checklistText(r) {
  return r.id + ' checklist: ' + (r.progress || (r.items.length ? 'every step struck' : 'empty')) + r.items.map((it) => '\n  ' + it.n + '. ' + stepMark(it) + ' ' + oneLine(it.text) + struckWhy(it)).join('');
}
/* task update's checks from its flags: --check-done is "<number>" or "<number>: word", --check-strike "<number>: why" */
function checksOf(flags) {
  const list = (k) => (flags[k] === undefined ? [] : [].concat(flags[k]));
  const done = list('check-done').map((v) => {
    const m = /^\s*(\d+)\s*(?::\s*(\S[\s\S]*))?$/.exec(String(v));
    if (!m) throw new UsageError('--check-done takes a step\'s number, or "<number>: word" for a word on it');
    return m[2] ? { step: Number(m[1]), word: m[2].trim() } : Number(m[1]);
  });
  const strike = list('check-strike').map((v) => {
    const m = /^\s*(\d+)\s*:\s*(\S[\s\S]*)$/.exec(String(v));
    if (!m) throw new UsageError('--check-strike takes "<number>: why", the step and a word why it will not be done');
    return { step: Number(m[1]), why: m[2].trim() };
  });
  const add = list('check-add');
  return done.length || strike.length || add.length ? { ...(add.length ? { add } : {}), ...(done.length ? { done } : {}), ...(strike.length ? { strike } : {}) } : undefined;
}
/* where a note's "left for T-n" sentences were copied */
function copiedWords(r) {
  if (!r || !Array.isArray(r.copied)) return '';
  return (r.copied.length ? '; copied onto ' + r.copied.join(', ') : '')
    + (r.notCopied ? '\nnot copied: ' + r.notCopied.map((n) => n.id + ' (' + n.why + ')').join('; ') : '');
}
/* a struck step is settled but was never done, so it prints as struck with its why */
const stepMark = (it) => (it.struck ? '[~]' : it.done ? '[x]' : '[ ]');
const struckWhy = (it) => (it.struck ? ' (struck: ' + oneLine(it.struck) + ')' : it.word ? ' (' + oneLine(it.word) + ')' : '');

/* each step laid out, new or already there, and what it waits on. */
function laidOutLines(steps) {
  return (steps || []).map((t) => (t.asked && !t.id ? '\nstep ' + t.step + ' ' + oneLine(t.name) + ': ' + askedLine(t.asked) : '\n' + t.id + ' ' + oneLine(t.name) + (t.created ? '' : ' (already there)') + (t.track ? ', on ' + t.track : '')
    + (t.edges.length ? ', waits on ' + t.edges.map((e) => e.on).join(', ') : '')
    + (t.before && t.before.length ? ', before ' + t.before.map((e) => e.task).join(', ') : '')
    + (t.default && t.default.after ? ', after ' + t.default.after.join(', ') + " (filed last: the chain's end)" : '')
    + (t.default && t.default.before ? ', before ' + t.default.before + ' (' + (t.default.last ? 'filed last: ' : 'the default: ') + (t.default.before === t.default.closing ? 'the closing review' : 'the first step after the closing review') + ')'
      : t.default && t.default.end ? ', an end (nothing open waits on it)' : ''))).join('');
}
/* a close's or handoff's steps asked of the user, each by its question */
const askedSteps = (list) => (Array.isArray(list) ? list.filter((t) => t && t.asked && !t.id && typeof t.asked === 'object').map((t) => '; "' + oneLine(t.name) + '": ' + askedLine(t.asked)).join('') : '');

function trackHandoffText(r, who = 'the user', env) {
  const open = (r.rulings || []).filter((x) => !x.registered).length;
  return r.id + ' written (' + r.status + ') on ' + r.track + ', which reads ' + r.trackState
    + (r.warning ? '\nWARNING: ' + r.warning : '')
    + (r.laidOut && r.laidOut.length ? '\nlaid out on ' + r.track + ':' + laidOutLines(r.laidOut) : '')
    + (r.wrappedLine ? '\n' + r.wrappedLine : '')
    + (r.overLine ? '\n' + r.overLine : '')
    + (r.parkedTracks || []).map((p) => '\nnew track ' + p.id + ' ' + oneLine(p.name) + ' parked' + (p.unpark ? ', opens ' + p.unpark : '')).join('')
    + (r.leavesLine ? '\n' + r.leavesLine : '')
    + (r.reviewLine ? '\n' + r.reviewLine : '')
    + (r.waitsLine ? '\n' + r.waitsLine : '')
    + (r.silentLine ? '\n' + r.silentLine : '')
    + (r.unpushedLine ? '\n' + r.unpushedLine : '')
    + (r.superseded.length ? '\nsuperseded ' + r.superseded.join(', ') : '')
    + (r.rulings.length ? '\nrulings: ' + open + ' not yet registered, ' + (r.rulings.length - open) + ' marked registered' : '')
    + r.verify.map((v) => '\nverify first: ' + v.path + (v.ok ? ' passes' : ' FAILS: ' + (v.problems || []).join('; '))).join('')
    + (r.growthLines || []).map((l) => '\n' + l).join('')
    + (r.undecided ? '\nundecided loose files (no disposition given):\n' + r.undecided.map((u) => '  ' + oneLine(u.note || u.path)).join('\n') : '')
    + (dueFilesLine(r.dueFiles) ? '\n' + dueFilesLine(r.dueFiles) : '')
    + (r.unmatched ? '\nnot untracked, so not recorded: ' + r.unmatched.join(', ') : '')
    + (r.worktreeLines || []).map((l) => '\n' + l).join('')
    + (removedLine(r.removed) ? '\n' + removedLine(r.removed) : '')
    + (leftAskLine(r) ? '\n' + leftAskLine(r) : '')
    + (r.keptError ? '\nthe loose-file, worktree and branch lists were not kept on this PC: ' + oneLine(r.keptError) : '')
    + (handoffCheckLine(r.handoffChecks) ? '\n' + handoffCheckLine(r.handoffChecks) : '')
    + junctionText(r.junction, who)
    + inboxText(r.inbox, env, r.workstream)
    + (r.untakenLine ? '\n' + r.untakenLine : '')
    + '\n\nHand ' + who + ' this line in a copy block' + (r.nextPc ? ', to run on ' + r.nextPc : '') + ':\n' + r.resume;
}

function handoffUpdateText(r) {
  const ch = r.changed || {};
  const said = Object.entries(ch).map(([k, v]) => k + ': ' + v);
  const touched = (r.verify || []).filter((v) => String(ch.verifyFirst || '').includes(v.path));
  return r.id + ' updated in place (' + r.status + ') on ' + r.track + ', keeping its id: ' + (said.join('; ') || 'nothing changed')
    + touched.map((v) => '\nverify first: ' + v.path + (v.ok ? ' passes' : ' FAILS: ' + (v.problems || []).join('; '))).join('')
    + (r.overLine ? '\n' + r.overLine : '')
    + (r.undecided ? '\nundecided loose files (no disposition given):\n' + r.undecided.map((u) => '  ' + oneLine(u.note || u.path)).join('\n') : '')
    + (dueFilesLine(r.dueFiles) ? '\n' + dueFilesLine(r.dueFiles) : '')
    + (r.unmatched ? '\nnot untracked, so not recorded: ' + r.unmatched.join(', ') : '')
    + (r.worktreeLines || []).map((l) => '\n' + l).join('')
    + (r.keptError ? '\nthe loose-file, worktree and branch lists were not kept on this PC: ' + oneLine(r.keptError) : '');
}

function trackShelfLine(r, who = 'the user') {
  const marks = [r.state === 'parked' && r.parkReason ? 'parked: ' + oneLine(r.parkReason) : '', r.stalled ? 'stalled' : '',
    r.quietSince ? 'held by ' + holderWords({ ...r.holder, quietSince: r.quietSince }, { now: Date.now(), pc: pcName() }) + ': take over with ' + r.resume : '',
    r.noHandoff ? 'no handoff yet' : '', r.waitingOnUser.length ? r.waitingOnUser.length + ' waiting on ' + who : '',
    r.codeMoved === true ? 'code moved since' : '', untakenMark(r)].filter(Boolean);
  return r.track + ' ' + r.state + (r.age ? ' ' + r.age : '') + ' ' + (r.workstream ? r.workstream + ' ' : '') + oneLine(r.name)
    + (r.focus ? ': ' + oneLine(r.focus) : '') + (marks.length ? ' [' + marks.join('; ') + ']' : '');
}

function handoffFullText(h, who = 'the user') {
  return h.id + ' (' + h.status + ') on ' + h.track + (h.fromSession ? ', from session ' + h.fromSession : '') + (h.pc ? ' on ' + h.pc : '')
    + ', ' + h.created + (h.chain ? '\nchain: ' + h.chain : '') + '\nFocus: ' + oneLine(h.focus)
    + (h.parkReason ? '\nParked because: ' + oneLine(h.parkReason) : '')
    + (h.growthLines || []).map((l) => '\n' + l).join('')
    + (h.waitingOnUser.length ? '\nWaiting on ' + who + ': ' + h.waitingOnUser.join('; ') : '')
    + h.rulings.map((x) => '\n' + x.id + (x.registered ? ' (registered ' + x.registered + ')' : '') + ': ' + x.text).join('')
    + '\n\n' + h.state + (h.whereWeWere ? '\n\nWhere we were:\n\n' + h.whereWeWere : '')
    + '\n\nVerify first:' + h.verify.map((v) => '\n' + [v.path, v.branch ? 'branch ' + v.branch : '', v.commit ? 'at ' + String(v.commit).slice(0, 12) : '',
      v.ok === false ? 'FAILED: ' + (v.problems || []).join('; ') : 'passed'].filter(Boolean).join(HEAD_SEP)).join('');
}

/* The mod's one read of its track: the lease renewed, and the workstream's tracks with summary and last handoff. */
async function trackMine(cx, s) {
  const { board } = cx;
  const lease = await board('renewLease', { session: s }, s);
  if (!lease.held) return { held: false, track: null, workstream: null, tracks: [] };
  const [view, rec] = [await board('trackView', { track: lease.track }, s), await board('readRecord', lease.track, s)];
  const ws = rec.workstream || null;
  const all = ws ? await board('workstreamView', { workstream: ws }, s) : { tracks: [view] };
  const tracks = [];
  for (const t of all.tracks) {
    const hs = (await board('trackHandoffs', { track: t.key }, s)).handoffs;
    const h = hs.length ? hs[hs.length - 1] : null;
    /* what the Tracks tab draws, so the path without a local band draws the same */
    tracks.push({ id: t.id, key: t.key, name: t.name, goal: t.goal || null, state: t.state, stalled: t.stalled, noHandoff: t.noHandoff, parkReason: t.parkReason,
      text: t.text, now: t.now, chain: t.chain, holder: t.holder, quietSince: t.quietSince || null, readySet: t.readySet, critical: t.critical,
      toGo: t.toGo, done: t.done, total: t.total, tasks: t.tasks, found: t.found || null,
      handoff: h && { id: h.id, status: h.status, focus: h.focus, created: h.created, resumed: h.resumed || null, waitingOnUser: h.waitingOnUser || [] } });
  }
  return { held: true, track: view.id, key: view.key, name: view.name, workstream: ws, state: view.state, text: view.text, chain: view.chain,
    running: view.running, ready: view.ready, toGo: view.toGo, now: view.now, readySet: view.readySet, junction: view.junction, tracks };
}

async function trackVerb(cx, verb, flags, id, ids) {
  const { emit, board } = cx;
  const s = flags.session;
  /* the session the verbs that take, let go or file work act as */
  const me = () => callerSession(cx, flags);
  /* --user marks the user's own command, which the plugin sends and a session never does: it files as the user, never asked */
  const as = (session) => (flags.user ? boardActor(flags) : session);
  if (verb === 'resume') {
    const moves = [flags['take-over'] && 'take over', flags.splinter !== undefined && 'splinter', flags['read-only'] && 'read only'].filter(Boolean);
    if (moves.length > 1) throw new UsageError('pick one of --take-over, --splinter and --read-only');
    const own = flags['read-only'] ? s : me();
    if (!own && !flags['read-only']) throw new UsageError('resume needs --session <own-id>');
    if (flags.continues !== undefined && !flags['take-over']) throw new UsageError('--continues goes with --take-over');
    const r = await onBoard(() => resumeTrackSession(id, { session: own, move: moves[0], name: flags.splinter, goal: flags.goal, reason: flags.reason, here: flags.here === true, continues: flags.continues },
      { call: cx.call, dir: cx.dataDir(), cwd: cx.cwd, env: cx.env }));
    if (!r.acquired && !r.readOnly) return emit(flags, r, r.next);
    /* a session is named plainly, never by its id */
    const by = ' by ' + (r.session === own ? 'this session' : holderWords({ pc: r.pc }, { now: Date.now(), pc: pcName(cx.env) }));
    const head = r.readOnly ? r.track + ', read only' : r.splintered ? r.track + ' splintered from ' + r.parent + by
      : r.track + (r.handoff ? ' resumed from ' + r.handoff.id : ' taken with no handoff yet') + by;
    const v = r.verify && !r.verify.error ? r.verify : null;
    return emit(flags, r, head + (r.next ? '\n' + r.next : '')
      + verifyLines(r.verify).map((l) => '\n' + l).join('') + (v && v.note ? '\n' + v.note : '')
      + (handoffCheckLine(r.handoffChecks) ? '\n' + handoffCheckLine(r.handoffChecks) : '')
      + '\n\n' + r.kickoff);
  }
  if (verb === 'track list') {
    if (flags.open) {
      if (flags.all) throw new UsageError('--open lists open tracks alone; --all adds closed ones to a workstream\'s list');
      const r = await board('listTracks', { open: true, ...(flags.workstream ? { workstream: flags.workstream } : {}) }, s);
      /* a server without the open read ignores the flag and answers with a workstream's list */
      if (!r.open) throw new UsageError('the board server is older than this CLI and does not read track list --open; drop --open, or run it again after the board server\'s update');
      return emit(flags, r, 'Open tracks:' + (r.tracks.length ? '' : ' none') + r.tracks.map((t) => '\n' + t.id + ' ' + t.state + ' ' + (t.workstream || '') + ' ' + oneLine(t.name)
        + (t.handoff ? ' [' + t.handoff + ', ' + t.verify.length + ' verify-first ' + (t.verify.length === 1 ? 'entry' : 'entries') + ']' : ' [no handoff yet]')).join(''));
    }
    if (!flags.workstream) throw new UsageError('track list needs --workstream WS-n for a workstream\'s tracks, or --open for every open track (askerdo shelf lists waiting and parked tracks everywhere)');
    const r = await board('listTracks', { workstream: flags.workstream, all: flags.all === true }, s);
    return emit(flags, r, r.workstream + ' tracks, ' + r.inbox + ' in the inbox' + (r.inboxStalled ? ' (stalled)' : '') + ':' + (r.tracks.length ? '' : ' none')
      + r.tracks.map((t) => '\n' + t.id + ' ' + t.state + ' ' + oneLine(t.name)
        + [t.stalled ? ' [stalled]' : '', t.quietSince ? ' [held, quiet since ' + atWords(t.quietSince, Date.now()) + ']' : '', t.noHandoff ? ' [no handoff yet]' : '', t.parkReason || t.unpark ? ' [parked' + (t.parkReason ? ': ' + oneLine(t.parkReason) : '') + (t.unpark ? '; opens again ' + t.unpark : '') + ']' : ''].join('')).join(''));
  }
  if (verb === 'track show') {
    if (/\.\d+$/.test(id)) {
      const read = await board('readHandoff', { id }, s);
      const h = { ...read, growthLines: hereLines(read.growthLines || [], launcherHere(cx.env)) };
      return emit(flags, h, handoffFullText(h, cx.who()));
    }
    /* the session rides the input, so a cached read through the local server is its own */
    const k = await kickoffHere(await board('trackKickoff', { track: id, ...(s ? { session: s } : {}) }, s),
      { cwd: cx.cwd, env: cx.env, dir: cx.dataDir(), places: await placesHere({ call: cx.call, dir: cx.dataDir() }, { session: s }) });
    const hs = await board('trackHandoffs', { track: id }, s);
    return emit(flags, { ...k, handoffs: hs.handoffs }, k.kickoff + '\n\nHandoffs:' + (hs.handoffs.length ? '' : ' none yet')
      + hs.handoffs.map((h) => '\n' + h.id + ' ' + h.status + ' ' + h.created + ' ' + oneLine(h.focus)).join(''));
  }
  if (verb === 'track mine') {
    if (!s) throw new UsageError('track mine needs --session <own-id>');
    const r = await trackMine(cx, s);
    return emit(flags, r, r.held ? r.track + ' ' + oneLine(r.name) + ' (' + r.state + '): ' + r.text
      + r.tracks.filter((t) => t.id !== r.track).map((t) => '\n' + t.id + ' ' + t.state + ' ' + oneLine(t.name) + ': ' + t.text).join('')
      : 'this session holds no track');
  }
  if (verb === 'track new') {
    /* the board polices the shell's session too; only --session takes the new track */
    const r = await board('newTrack', { workstream: flags.workstream, name: flags.name, goal: flags.goal, tasks: flags.task, labels: flags.label, refs: flags.ref, session: s, ...(s ? {} : { hold: false }) },
      as(me()));
    return emit(flags, r, r.id + ' created (' + r.state + ')' + (s ? '; this session holds it, and hands off with `askerdo handoff write ' + r.id + '`' : ''));
  }
  if (verb === 'track park') {
    const r = await board('parkTrack', { track: id, reason: flags.reason, unparkWhen: flags['unpark-when'] }, me());
    return emit(flags, r, r.id + ' parked' + (r.unpark ? '; it opens again on its own ' + r.unpark : r.unparkWhen ? '; it unparks on its own at ' + r.unparkWhen : '') + junctionText(r.junction, cx.who()));
  }
  if (verb === 'track finish' || verb === 'track drop') {
    const r = await board(verb === 'track finish' ? 'finishTrack' : 'dropTrack', { track: id, outcome: flags.outcome, reason: flags.reason, leftovers: flags.leftovers, wake: flags.wake, ...(flags.waive !== undefined ? { waive: flags.waive } : {}) }, as(me()));
    return emit(flags, r, r.id + ' ' + r.state + (r.leftovers.length ? '; ' + r.leftovers.join(', ') + (flags.leftovers === 'drop' ? ' dropped' : ' to the inbox') : '')
      + (r.waived ? '\n' + r.waived : '') + junctionText(r.junction, cx.who()) + inboxText(r.inbox, cx.env, r.workstream) + (r.sweep ? '\n' + r.sweep : ''));
  }
  if (verb === 'track splinter') {
    const branch = Boolean(flags['no-park']);
    const r = await board('splinter', { from: id, name: flags.name, at: flags.at, goal: flags.goal, tasks: flags.task, workstream: flags.workstream, session: s,
      ...(branch ? { park: false } : {}), ...(s ? {} : { hold: false }) }, as(me()));
    if (branch) {
      return emit(flags, r, r.id + ' branched from ' + r.parent + (r.at ? ' at ' + r.at : '') + '; ' + r.parent + ' stays open'
        + (r.tied.length ? '; ' + r.tied.join(', ') + ' wait' + (r.tied.length > 1 ? '' : 's') + ' on ' + r.at : ''));
    }
    return emit(flags, r, r.id + ' splintered from ' + r.parent + (r.at ? ' at ' + r.at : '') + (r.session ? '; this session holds it' : '')
      + '\nTell ' + cx.who() + ': ' + r.chain + (r.parked ? '. ' + r.parent + ' is parked behind it; /askerdo resume ' + r.parent + ' goes back.' : '.'));
  }
  if (verb === 'track capture') {
    const tier = tierOf(flags.tier);
    const r = await board('capture', { track: flags.track, workstream: flags.workstream, name: flags.name, task: flags.task, description: flags.description,
      priority: flags.priority, unplaced: flags.unplaced, wake: flags.wake, whyElsewhere: flags['why-elsewhere'], last: flags.last, ...(tier !== undefined ? { tier } : {}), ...placeExtra(flags) },
    as(me()));
    if (placeAsked(r)) return emit(flags, r, placeAsked(r));
    if (r.asked) return emit(flags, r, askedWords(r.id, r));
    return emit(flags, r, r.id + (r.created ? ' captured' : ' moved') + (r.track ? ' onto ' + r.track : ' into the inbox' + (r.unplaced ? ', unplaced: ' + r.unplaced : '') + (r.wake ? '; wakes ' + r.wake : ''))
      + '; carry on with the work in hand' + ladderWords(r));
  }
  if (verb === 'track layout') {
    const payload = await readPayload(cx, verb);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !Array.isArray(payload.steps) || !payload.steps.length) {
      throw new UsageError('track layout reads { "steps": [{ "name": "...", "after": [1], "before": ["T-n"] }] } on stdin: after names T-n ids and earlier step numbers, before the T-n ids that wait on the step');
    }
    const extra = Object.keys(payload).filter((k) => k !== 'steps');
    if (extra.length) throw new UsageError('track layout takes steps alone, not ' + extra.join(', '));
    const problems = stepProblems(payload.steps, 'steps');
    if (problems.length) throw new UsageError(problems.join('; '));
    const by = me();
    const r = await board('layOut', { track: id, steps: payload.steps, session: by }, as(by));
    return emit(flags, r, 'Laid out on ' + r.track + ':' + laidOutLines(r.steps));
  }
  if (verb === 'track found') {
    const since = flags.since;
    if (since !== undefined && since !== 'handoff') throw new UsageError('track found takes --since handoff, or no --since for the whole arc');
    const r = await board('trackFound', { track: id, ...(since ? { since } : {}) }, s);
    const c = r.counts;
    return emit(flags, r, r.track + ' ' + oneLine(r.name) + ', found since ' + (since ? 'its last handoff' : 'it began') + ': ' + c.total + (c.total === 1 ? ' task' : ' tasks')
      + (c.total ? ' (' + c.unplaced + ' unplaced, ' + c.here + ' on it, ' + c.elsewhere + ' on other tracks)' : '') + hereLines(r.lines, launcherHere(cx.env)).map((l) => '\n' + l).join(''));
  }
  if (verb === 'edge add' || verb === 'edge remove') {
    if (typeof flags.reason !== 'string' || !flags.reason.trim()) {
      throw new UsageError(verb + ' needs --reason "' + (verb === 'edge add' ? 'why it waits' : 'why it no longer waits') + '"');
    }
    const r = await board(verb === 'edge add' ? 'addEdge' : 'removeEdge', { task: ids[0], on: ids[1], reason: flags.reason }, s);
    return emit(flags, r, verb === 'edge add' ? r.task + (r.added ? ' now waits on ' : ' already waits on ') + r.on : r.task + ' no longer waits on ' + r.on);
  }
  if (verb === 'check add') {
    const r = await board('addItem', { task: id, text: flags.text, at: flags.at === undefined ? undefined : Number(flags.at) }, s);
    return emit(flags, r, checklistText(r));
  }
  if (verb === 'check done') {
    const r = await board('checkItem', { task: ids[0], item: Number(ids[1]), done: flags.undo !== true }, s);
    return emit(flags, r, checklistText(r));
  }
  if (verb === 'check strike') {
    if (typeof flags.why !== 'string' || !flags.why.trim()) throw new UsageError('check strike needs --why "why it will not be done"');
    const r = await board('strikeItem', { task: ids[0], item: Number(ids[1]), why: flags.why }, s);
    return emit(flags, r, checklistText(r));
  }
  if (verb === 'check move') {
    const r = await board('moveItem', { task: ids[0], item: Number(ids[1]), to: Number(flags.to), version: flags.version }, s);
    return emit(flags, r, checklistText(r));
  }
  if (verb === 'track reorder') {
    const places = ['before', 'after', 'position'].filter((k) => flags[k] !== undefined);
    if (places.length !== 1) throw new UsageError('track reorder needs one of --before T-n, --after T-n or --position N');
    if (typeof flags.reason !== 'string' || !flags.reason.trim()) throw new UsageError('track reorder needs --reason "why it moves"');
    const r = await board('reorder', { task: id, before: flags.before, after: flags.after,
      position: flags.position === undefined ? undefined : Number(flags.position), reason: flags.reason }, s);
    return emit(flags, r, r.task + ' moved on ' + r.track + ' from ' + r.from + ' to ' + r.to);
  }
  if (verb === 'task update') {
    if (statusProblem(flags.status, 'cli')) throw new UsageError(statusProblem(flags.status, 'cli'));
    if (flags.continues !== undefined && !(flags['in-hand'] && flags['take-over'])) throw new UsageError('--continues goes with --in-hand and --take-over');
    const lists = (k) => (flags[k] === undefined ? undefined : [].concat(flags[k]));
    if (flags['move-steps'] && flags.leftovers) throw new UsageError('--move-steps and --leftovers each read stdin: move the steps first, then close with its leftovers');
    const leftovers = await leftoversIn(cx, verb, flags);
    const moveSteps = flags['move-steps'] ? await readPayload(cx, verb) : undefined;
    if (moveSteps !== undefined && (!Array.isArray(moveSteps) || !moveSteps.length)) throw new UsageError(verb + ' --move-steps reads ' + MOVES_STDIN);
    const checks = checksOf(flags);
    /* the leftovers and a move into a new task are filings, so they name the session as the filing verbs do */
    const files = Boolean(leftovers || moveSteps);
    const out = await board('taskUpdate', { id, reason: flags.reason, status: flags.status, note: flags.note,
      description: flags.description, intent: flags.intent, name: flags.name, priority: flags.priority, inHand: flags['in-hand'] === true, letGo: flags['let-go'] === true, takeOver: flags['take-over'] === true,
      ...(flags.continues !== undefined ? { continues: flags.continues } : {}), addLabel: lists('add-label'), removeLabel: lists('remove-label'), ...(leftovers ? { leftovers } : {}), ...(moveSteps ? { moveSteps } : {}), ...(checks ? { checks } : {}) },
    flags.user ? boardActor(flags) : files ? me() : s && me());
    const words = [out.moves ? 'moved ' + out.moves.map((m) => (m.asked ? 'step ' + m.check + ': ' + askedLine(m.asked) : 'step ' + m.check + ' to ' + m.to + (m.step ? ' step ' + m.step : '') + (m.track ? ' on ' + m.track : '') + (m.inbox ? ' in the inbox' : ''))).join(', ') : '',
      out.edit ? editWords(out.edit, ' unchanged') + (out.leftovers ? '; ' + filedWords(out.leftovers) : '') + askedSteps(out.leftovers) : '',
      out.checks ? checklistText(out.checks) : '',
      out.note ? id + ' noted' + amendedWords(out.note) + copiedWords(out.note) : '',
      out.note ? titleLine(out.note) : '', out.note ? rewriteOffer(out.note, flags.note) : ''].filter(Boolean);
    if (out.note) tellDropped(cx, id, droppedTexts(out.note, flags));
    /* the block carries the rulings with their words */
    if (out.block) words.push(out.block);
    return emit(flags, out, words.join('\n'));
  }
  if (verb === 'task block') {
    const rs = [];
    /* only an explicit --session reads as "this session": a dispatched agent's block names its holder */
    for (const one of ids && ids.length ? ids : [id]) rs.push(await board('taskBlock', { id: one, ...(s ? { session: s } : {}) }));
    const texts = hereLines(rs.map((r) => r.text), launcherHere(cx.env));
    return rs.length === 1 ? emit(flags, rs[0], texts[0]) : emit(flags, rs, texts.join('\n\n'));
  }
  throw new UsageError('unknown verb: ' + verb);
}

/* ---- questions and reads on the board ---------------------- */

/* Threads, plans and steps have no board counterpart: each
   names the track command that replaces it. */
const TRACK_INSTEAD = {
  'plan create': 'track new --workstream WS-n --name <name>', 'plan edit': 'track capture --task T-n --track TR-n',
  'plan close': 'track finish TR-n', 'plan steps': 'track show TR-n', 'plan step-add': 'track capture --track TR-n --name <task>',
  'plan step-edit': 'check add T-n --text <step>', 'plan step-move': 'edge add <T-n that waits> <T-n it waits on>',
  'plan step-remove': 'track capture --task T-n --workstream WS-n --unplaced "<why>" --wake <event or YYYY-MM-DD>', 'thread new': 'track new --workstream WS-n --name <name>',
  'thread edit': 'resume TR-n --session <id>', 'handoff park': 'track park TR-n --reason <why>',
  'handoff resume': 'resume TR-n --session <id>', 'handoff kickoff': 'track show TR-n', 'handoff verify': 'resume TR-n --read-only',
};
const trackInstead = (what, cmd) => what + ' has no board counterpart: tracks replace threads and plans; askerdo ' + cmd;

/* The caller as the board's activity row names it: the user's chip, else the session. */
/* The session whose shell runs the command: Claude Code sets CLAUDE_CODE_SESSION_ID for
   a session's commands (2.1.309, measured), so a read or a rule line names it unasked. */
const envSession = (env) => String((env && env.CLAUDE_CODE_SESSION_ID) || '').trim() || undefined;

/* The session a verb that files or moves work, takes or lets go a track, or writes a handoff acts as:
   the shell's when it carries one, so a flag or payload naming another is refused; else the first named.
   A take-over whose --continues is the shell's session is that session going on under a new id. */
function callerSession(cx, flags, named = [flags.session]) {
  const given = named.map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean);
  const shell = envSession(cx.env);
  /* --user never lets a session's shell name another session (a track new or splinter holds for the one named) */
  if (!shell) return given[0];
  if (flags.continues !== undefined && String(flags.continues).trim() === shell && given.length) return given[0];
  const other = given.find((v) => v !== shell);
  if (other) {
    throw new UsageError('this shell is session ' + shell + ' and the call names session ' + other
      + ': a session files, moves and hands off work only as itself, so leave the other session out');
  }
  return shell;
}

function boardActor(flags, session) {
  if (flags.user) return { user: String(flags.user).trim(), pc: pcName() };
  const s = typeof session === 'string' ? session.trim() : '';
  return { ...(s ? { session: s } : {}), pc: pcName() };
}

/* The cut line (with the user's condition): a read below full ends by naming
   what it left out and the flag that brings it back. */
function leftOutLine(level, { sections = [], journal } = {}) {
  const parts = [];
  if (sections.length) parts.push((sections.length === 1 ? 'the section ' : 'the sections ') + sections.join(', '));
  const cutJournal = journal && journal.total > journal.kept;
  if (cutJournal) {
    parts.push(journal.kept ? (journal.total - journal.kept) + ' of ' + journal.total + ' journal entries'
      : 'the journal (' + journal.total + (journal.total === 1 ? ' entry)' : ' entries)'));
  }
  const hints = [];
  if (cutJournal && level === 'brief') hints.push('--journal or --journal-tail N brings the journal back');
  if (sections.length && level !== 'head') hints.push('--section <name> prints one');
  if (level === 'block') hints.push('--journal prints the brief form with the whole journal');
  if (level !== 'brief') hints.push('--brief prints the brief form');
  hints.push('--full prints the whole record');
  return 'Not shown: ' + (parts.length ? parts.join('; ') : 'only the stored fields (key, version, label history)') + '. ' + hints.join(', ') + '.';
}

const LIST_CUT = 'Not shown: each record past its head. askerdo show <id> prints the brief form, --full the whole record.';

/* Every section the whole record has, in reading order: the --full form. */
function fullSections(r, kind, who) {
  if (kind !== 'question') return briefSections(r, kind, true, who);
  const out = [];
  const add = (label, text) => { const t = String(text ?? '').trim(); if (t) out.push({ label, text: t }); };
  add('Gist', r.gist);
  if (Array.isArray(r.options) && r.options.length) add('Options', r.options.map((o) => optionLine(r.id, o)).join('\n'));
  add('Stakes', r.stakes);
  add('While this waits', r.whileThisWaits);
  add('Context', r.context);
  add('Reversal', r.reversal);
  add('Reverses', (r.reverses || []).map((x) => x.id + ' (' + x.name + '): ' + x.quote + (x.declined.length ? '; turned down: ' + x.declined.join('; ') : '')).join('\n'));
  if (!QUESTION_OPEN.includes(r.status)) add('Answer', r.answer);
  add('Evidence', (r.evidence || []).join('\n'));
  add('Subscribers', (r.subscribers || []).join(', '));
  return out;
}

/* One line: label, kind, status, name and what it waits on. */
function headLine(r, kind, who = 'the user', reader) {
  /* a task's word holds its own colon, so it rides in brackets before the name's */
  const said = kind === 'task' ? wordLine(r.word, Date.now(), reader) : '';
  /* a waiting word already names the gate */
  const waits = kind === 'question'
    ? (r.status === 'snoozed' && r.snooze ? 'snoozed ' + snoozeWords(r.snooze) : r.status === 'open' ? 'waits on ' + who : '')
    : Array.isArray(r.waitsOn) && r.waitsOn.length && !said.startsWith('waiting') ? 'waits on ' + r.waitsOn.map((q) => q.id).join(', ') : '';
  /* a question's track beside its workstream and its pick, as the full form names them */
  const q = kind === 'question';
  const where = kind === 'handoff' ? r.track : [r.workstream, q ? r.track : ''].filter(Boolean).join(' / ');
  const chose = q ? chosenOf(r) : null;
  const bits = [r.id, q ? '' : kind, r.project ? '[' + r.project + ']' : '', chose ? 'answered ' + answerToken(r.id, chose) : said ? '(' + said + ')' : r.status, r.amended ? 'amended ' + String(r.amended).slice(0, 10) : '', r.blocking === true ? 'blocking' : '',
    r.priority || '', where || '', q && r.pc ? 'on ' + r.pc : '', q ? pickWords(r) : ''].filter(Boolean);
  return bits.join(' ') + ': ' + oneLine(kind === 'handoff' ? r.focus : r.name) + (waits ? ' (' + waits + ')' : '');
}

async function boardCommand(cx, verb, flags, { id, ids, text }) {
  const { emit, warn } = cx;
  const call = (name, input, actor = {}, opts = {}) => onBoard(() => cx.call(name, input, { ...actor, ...opts }));
  /* through the local server when it answered the call, so the link opens signed in */
  const urlOf = (r) => {
    const u = r && (cx.signed() ? signedPage(cx.signed(), r.key || r.id) : pageUrl('r', r.key || r.id, cx.env));
    return u ? { ...r, boardUrl: u } : r;
  };
  if (verb === 'register') {
    const payload = await readPayload(cx, 'register');
    /* the board cannot read git, so the project's shared name rides the payload and the folder stays here */
    if (payload && typeof payload === 'object' && typeof payload.projectDir === 'string') {
      const dir = cx.path(payload.projectDir);
      if (payload.projectRepo === undefined) payload.projectRepo = sharedName(dir) || undefined;
      if (payload.project === undefined) payload.project = shortName(checkoutOf(dir)) || undefined;
      learnHere(cx, [dir]);
      delete payload.projectDir;
    }
    const r = urlOf(await call('register', payload, boardActor({}, payload && payload.session), { strict: true, inherit: true }));
    warn(r);
    return emit(flags, r, r.id + ' registered' + (r.boardUrl ? ' -> ' + r.boardUrl : '') + '. Paste this block in the reply\'s footer, under its label, exactly, once:\n\n' + tellBlock({ ...payload, ...r }));
  }
  /* an answer or drop from a session's shell is that session's, which a placement question refuses */
  if (verb === 'answer') {
    if (flags.version !== undefined && !/^\d+$/.test(flags.version)) throw new UsageError('--version takes the version number the answer was read from');
    /* `shown`, not the API's `version`, which amends an answered question */
    const r = await call('answer', { id, pick: flags.pick, note: flags.note, amend: flags.amend, shown: flags.version }, boardActor(flags, flags.session || envSession(cx.env)));
    return emit(flags, r, r.id + (r.already ? ' already answered ' + r.pick + ', recorded as it was' : r.amended === true ? ' amended' : r.amended === false ? ' unchanged' : ' answered'));
  }
  if (verb === 'drop') {
    const r = await call('drop', { id, note: flags.note }, boardActor(flags, flags.session || envSession(cx.env)));
    return emit(flags, r, r.id + ' dropped');
  }
  if (verb === 'snooze') {
    const r = await call('snooze', { id, until: flags.until, trigger: flags.trigger, wakeOn: flags['wake-on'] }, boardActor(flags, flags.session));
    return emit(flags, r, r.id + ' snoozed ' + snoozeWords(r.snooze));
  }
  if (verb === 'wake') {
    const r = await call('wake', { id }, boardActor(flags));
    return emit(flags, r, r.id + ' open');
  }
  if (verb === 'surface') {
    const r = urlOf(await call('surface', { id, session: flags.session }, boardActor(flags, flags.session)));
    return emit(flags, r, JSON.stringify(r, null, 2));
  }
  if (verb === 'subscribe') {
    if (!isQuestionToken(id) && !/^[0-9a-z]{8}$/.test(String(id).trim())) {
      throw new UsageError('on the board a session follows work through its track or its task in hand; subscribe takes a question');
    }
    const r = await call('subscribe', { id, session: flags.session }, boardActor(flags, flags.session));
    return emit(flags, r, r.id + (r.added ? ' subscribed: ' : ' already subscribed: ') + r.session);
  }
  if (verb === 'reopen') {
    const r = await call('reopenRecord', { id, until: flags.until, trigger: flags.trigger, wakeOn: flags['wake-on'] }, boardActor(flags, flags.session));
    const s = r.stands || {};
    const left = [s.woken && s.woken.length ? 'woke ' + s.woken.join(', ') : '', s.unparked && s.unparked.length ? 'unparked ' + s.unparked.join(', ') : '',
      s.noted && s.noted.length ? 'noted it on ' + s.noted.join(', ') : ''].filter(Boolean);
    return emit(flags, r, r.id + (r.status === 'snoozed' ? ' snoozed ' + snoozeWords(r.snooze) : ' open')
      + (left.length ? '\nIts drop ' + left.join('; ') + ': the reopen takes none of it back' : ''));
  }
  if (verb === 'question edit') {
    const { session, ...changes } = editChanges(flags);
    /* no field flag means a reworded payload on stdin; a flag alone never waits on stdin */
    const flagged = Object.values(changes).some((v) => v !== undefined && v !== false && !(Array.isArray(v) && !v.length));
    let payload;
    if (!flagged && !cx.tty) {
      const text = await cx.stdin();
      if (text.trim()) {
        try { payload = JSON.parse(text); } catch { throw new UsageError('question edit payload on stdin is not JSON'); }
      }
    }
    const done = await call('editQuestion', { id, ...changes, payload }, boardActor(flags, session || (payload && payload.session)));
    const r = done.reworded ? urlOf(done) : done;
    warn(r);
    const moved = r.changed.length ? 'updated: ' + r.changed.join(', ') : '';
    const human = r.reworded && r.reworded.length
      ? r.id + ' reworded, keeping its id: ' + r.reworded.join(', ') + (moved ? '; ' + moved : '')
      : moved ? r.id + ' ' + moved : r.id + ' unchanged (' + (r.reworded ? 'the payload matches its wording' : 'every named field already held that value') + ')';
    return emit(flags, r, human);
  }
  if (verb === 'show') return boardShow(cx, flags, ids, { call, urlOf });
  if (verb === 'read') {
    const r = await call('read', { ids, site: flags.site, session: flags.session }, boardActor(flags, flags.session));
    return emit(flags, r, (r.marked.length ? 'read by ' + r.session + ': ' + r.marked.join(', ') : 'nothing new read by ' + r.session)
      + (r.skipped.length ? '\nnot on the board: ' + r.skipped.join(', ') : ''));
  }
  if (verb === 'list') return boardList(cx, flags, { call, urlOf });
  if (verb === 'search') return boardSearch(cx, flags, text, { call });
  if (verb === 'note') {
    const body = flags.body !== undefined ? flags.body : cx.tty ? '' : await cx.stdin();
    if (!String(body).trim()) throw new UsageError('note needs a body: ' + NOTE_WAYS);
    const r = await call('noteRecord', { id, text: body, name: flags.name, description: flags.description, intent: flags.intent, goal: flags.goal }, boardActor(flags, flags.session));
    const offer = rewriteOffer(r, body);
    const title = titleLine(r);
    tellDropped(cx, r.id || id, droppedTexts(r, flags));
    return emit(flags, r, (r.id || id) + ' noted' + amendedWords(r) + copiedWords(r) + (title ? '\n' + title : '') + (offer ? '\n' + offer : ''));
  }
  if (verb.startsWith('knowledge ')) return boardKnowledge(cx, verb, flags, id, { call, urlOf });
  return boardWork(cx, verb, flags, id, { call, urlOf });
}

/* the shared names of folders named on this PC, each learned into its project map. */
function namesOf(cx, dirs) {
  const list = (Array.isArray(dirs) ? dirs : [dirs]).filter((d) => typeof d === 'string' && d.trim()).map(cx.path);
  learnHere(cx, list);
  return [...new Set(list.map((d) => sharedName(d)).filter(Boolean))];
}

/* The map learns as a side effect; a write that fails never fails the command. */
function learnHere(cx, dirs) {
  try { return learnProjects(cx.dataDir(), dirs); } catch { return null; }
}

/* ws create/edit/close and task create/edit on the board. */
async function boardWork(cx, verb, flags, id, { call, urlOf }) {
  const { emit, warn } = cx;
  const [kindWord, sub] = verb.split(' ');
  const kind = kindWord === 'ws' ? 'workstream' : 'task';
  /* a folder the board makes nothing of: this PC seeds it from the template */
  const folder = async (r) => {
    if (flags.handoff === undefined || flags['no-seed']) return '';
    const ws = await call('readRecord', r.key || r.id);
    const { dir, unmapped } = handoffDirOf(ws, { cwd: cx.cwd, dir: cx.dataDir() });
    r.handoffDir = dir;
    if (unmapped) return '\nhandoff folder ' + ws.handoff + ' was not made: ' + unmappedLine(unmapped);
    if (!dir) return '\nhandoff folder ' + ws.handoff + ' is relative and ' + r.id + ' names no project, so it resolves nowhere yet';
    if (!seedHandoffDir(dir, ws)) return '';
    r.handoffMade = true;
    return '\nhandoff folder made from the template: ' + dir;
  };
  if (sub === 'create') {
    const payload = await readPayload(cx, verb);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new UsageError(kind + ' payload must be a JSON object');
    if (flags.handoff !== undefined) payload.handoff = flags.handoff;
    if (kind === 'workstream' && payload.projects !== undefined) {
      if (payload.projectRepos === undefined) payload.projectRepos = namesOf(cx, payload.projects);
      delete payload.projects;
    }
    if (kind === 'task') {
      for (const k of ['track', 'workstream', 'unplaced', 'wake']) if (flags[k] !== undefined) payload[k] = flags[k];
      if (flags['review-scope'] !== undefined) payload.reviewScope = flags['review-scope'];
      if (flags.tier !== undefined) payload.tier = flags.tier;
      if (flags['new-track'] !== undefined) payload.newTrack = flags['new-track'];
      if (flags['unpark-when'] !== undefined) payload.unparkWhen = flags['unpark-when'];
      if (flags['why-elsewhere'] !== undefined) payload.whyElsewhere = flags['why-elsewhere'];
      if (flags.last !== undefined) payload.last = flags.last;
      payload.tier = tierOf(payload.tier);
      Object.assign(payload, placeExtra(flags));
    }
    const { session, ...given } = payload;
    const by = kind === 'task' ? callerSession(cx, flags, [session, flags.session]) : session || flags.session || envSession(cx.env);
    const r = urlOf(await call('createRecord', { ...given, kind }, boardActor(flags.user ? flags : {}, by)));
    if (placeAsked(r)) return emit(flags, r, placeAsked(r));
    warn(r);
    const made = await folder(r);
    const place = r.track ? ' on ' + r.track + (r.parked ? ' (parked' + (r.unpark ? ', opens ' + r.unpark : '') + ')' : '') : r.unplaced ? ', unplaced: ' + r.unplaced + (r.wake ? '; wakes ' + r.wake : '') : '';
    const hint = r.suggested ? "\nthe board's hint, one input beside your own judgment: " + r.suggested.track + ' ' + oneLine(r.suggested.name) + ' (' + r.suggested.why + ')' : '';
    return emit(flags, r, r.id + ' created' + place + (r.boardUrl ? ' -> ' + r.boardUrl : '') + made + hint + (kind === 'task' ? ladderWords(r) : ''));
  }
  if (sub === 'edit') {
    const { session, ...changes } = editChanges(flags);
    /* the board edits the shared names; a folder flag is named here */
    if (changes.addProject) changes.addProject = namesOf(cx, changes.addProject);
    if (changes.removeProject) changes.removeProject = changes.removeProject.map((d) => sharedName(cx.path(d)) || d);
    const tier = kind === 'task' ? tierOf(flags.tier) : undefined;
    if (kind === 'task') {
      if (statusProblem(flags.status, 'cli')) throw new UsageError(statusProblem(flags.status, 'cli'));
      Object.assign(changes, { unplaced: flags.unplaced, wake: flags.wake,
        tier, newTrack: flags['new-track'], unparkWhen: flags['unpark-when'], whyElsewhere: flags['why-elsewhere'], last: flags.last, leftovers: await leftoversIn(cx, verb, flags), ...placeExtra(flags) });
    }
    /* an edit that moves the task to a new home is a filing, and says where it went; a wake alone wakes it again */
    const moves = kind === 'task' && [flags.track, tier, flags['new-track'], flags['unpark-when'], flags.workstream].some((v) => v !== undefined);
    const r = await call('editRecord', { id, kind, ...changes }, boardActor(flags, kind === 'task' ? callerSession(cx, flags, [session]) : session));
    if (placeAsked(r)) return emit(flags, r, r.id + ' stays where it is; ' + placeAsked(r) + (r.leftovers ? '; ' + filedWords(r.leftovers) : '') + askedSteps(r.leftovers));
    warn(r);
    const made = await folder(r);
    const asked = r.placed && r.placed.asked ? ': ' + askedWords(r.id, r.placed) : '';
    return emit(flags, r, editWords(r, asked ? ' took no new wake' : ' unchanged (every named field already held that value)') + (r.leftovers ? '; ' + filedWords(r.leftovers) : '') + askedSteps(r.leftovers) + made + asked
      + (moves && !asked ? ladderWords(r) : ''));
  }
  if (verb === 'ws close') {
    const r = await call('closeRecord', { id, kind, outcome: flags.outcome }, boardActor(flags, flags.session));
    return emit(flags, r, r.id + ' closed' + (r.outcome ? ': ' + oneLine(r.outcome) : ''));
  }
  throw new UsageError('unknown verb: ' + verb);
}

/* knowledge new and supersede on the board; the body and the project come from this PC. */
async function boardKnowledge(cx, verb, flags, id, { call, urlOf }) {
  const { emit } = cx;
  const actor = boardActor(flags, flags.session);
  if (verb === 'knowledge supersede' && flags.by !== undefined) {
    const extra = KNOWLEDGE_VALUES.filter((k) => k !== 'session' && flags[k] !== undefined).concat(flags.global ? ['global'] : []);
    if (extra.length) throw new UsageError('--by links an existing record; it takes no --' + extra.join(', --'));
    const r = await call('supersedeKnowledge', { id, by: flags.by }, actor);
    return emit(flags, r, r.id + ' superseded by ' + r.supersededBy);
  }
  if (verb === 'knowledge retire' || verb === 'knowledge reinstate') {
    const r = await call(verb === 'knowledge retire' ? 'retireKnowledge' : 'reinstateKnowledge', { id, reason: flags.reason, version: flags.version }, actor);
    return emit(flags, r, (r.was ? r.was + ' is now ' + r.id + ', ' : r.id + ' ') + r.status + ' (history #' + r.history + ')');
  }
  if (verb === 'knowledge amend' || verb === 'knowledge edit') {
    const text = flags.body !== undefined ? flags.body : flags['body-file'] !== undefined ? readBodyFile(flags['body-file'])
      : verb === 'knowledge amend' ? await readBody(cx, verb, 'amendment') : undefined;
    if (verb === 'knowledge amend') {
      const r = await call('amendKnowledge', { id, body: text, version: flags.version }, actor);
      return emit(flags, r, r.id + ' amended, keeping its number (history #' + r.history + ')');
    }
    const r = await call('editKnowledge', { id, name: flags.name, body: text, version: flags.version, addRef: flags['add-ref'], removeRef: flags['remove-ref'],
      addProject: flags['add-project'] && namesOf(cx, flags['add-project']), removeProject: flags['remove-project'] && flags['remove-project'].map((d) => sharedName(cx.path(d)) || d),
      addFile: flags['add-file'], removeFile: flags['remove-file'], addCommand: flags['add-command'], removeCommand: flags['remove-command'], ...(flags.confirmed ? { confirmed: true } : {}) }, actor);
    return emit(flags, r, r.changed.length ? r.id + ' rewritten in place: ' + r.changed.join(', ') + (r.history.length ? ' (history ' + r.history.map((n) => '#' + n).join(', ') + ')' : '')
      : r.id + ' unchanged (it already reads that way)');
  }
  if (flags.title === undefined) throw new UsageError(verb + ' needs --title');
  const payload = {
    type: flags.type, title: flags.title, labels: flags.label, refs: flags.ref, files: flags.file, legacy: flags.legacy, created: flags.created, session: flags.session,
  };
  if (flags.global) payload.global = true;
  if (flags.project) payload.projectRepos = namesOf(cx, flags.project);
  else if (!flags.global && verb === 'knowledge new') payload.projectRepos = namesOf(cx, [repoRootOf(cx.cwd)]);
  payload.body = flags['body-file'] !== undefined ? readBodyFile(flags['body-file']) : await readBody(cx, verb, 'body');
  if (!payload.body.trim()) throw new UsageError(verb + ' needs a body (--body-file or stdin)');
  for (const k of Object.keys(payload)) if (payload[k] === undefined) delete payload[k];
  if (!flags.legacy && cx.near) await boardNear(cx, call, flags.title);
  if (verb === 'knowledge new') {
    const r = urlOf(await call('createKnowledge', payload, actor));
    return emit(flags, r, r.id + ' created' + (r.boardUrl ? ' -> ' + r.boardUrl : '') + (r.legacy ? ' (was ' + r.legacy + ')' : ''));
  }
  const r = await call('supersedeKnowledge', { id, ...payload }, actor);
  return emit(flags, r, r.created.id + ' created\n' + r.id + ' superseded by ' + r.supersededBy);
}

/* decide, decisions and decisions triggers; the project's shared name and folder come from this PC. */
/* one change per line, the record and its cause. */
const upkeepLine = (c) => '  ' + c.act + ' ' + c.id + ' ' + oneLine(c.name) + (c.cause ? ': ' + oneLine(c.cause) : '');

async function upkeepCommand(cx, verb, flags) {
  const call = (name, input) => onBoard(() => cx.call(name, input, boardActor(flags)));
  const list = (changes) => (changes.length ? ':\n' + changes.map(upkeepLine).join('\n') : '');
  const count = (n) => n + ' change' + (n === 1 ? '' : 's');
  if (verb === 'upkeep') {
    if (!flags['dry-run']) throw new UsageError('upkeep takes --dry-run, on or off');
    const r = await call('upkeepDryRun', {});
    const rows = r.bandCalls.map((b) => '  ' + oneLine(b.text) + ' (' + b.presses.map((p) => p.label).join(', ') + ')');
    return cx.emit(flags, r, 'upkeep is ' + (r.on ? 'on' : 'off') + '; switching it on would make ' + count(r.changes.length) + list(r.changes)
      + '\ncalls for Home it would raise:' + (rows.length ? '\n' + rows.join('\n') : ' none'));
  }
  const r = await call('upkeepSwitch', { on: verb === 'upkeep on' });
  if (r.on === r.was) return cx.emit(flags, r, 'upkeep was already ' + (r.on ? 'on' : 'off'));
  return cx.emit(flags, r, r.on ? 'upkeep is on; the catch-up made ' + count(r.changes.length) + list(r.changes)
    : 'upkeep is off; the board no longer keeps itself current');
}

/* the request, the user's press, and unscrub. */
/* the press that carries a request out names its act */
const OVERRIDE_ACT_WORD = { withdraw: 'Withdraw', fix: 'Fix', scrub: 'Scrub' };
const OVERRIDE_DONE_WORD = { withdraw: 'withdrawn', fix: 'fixed', scrub: 'scrubbed' };
async function overrideCommand(cx, verb, flags, id, ids) {
  const call = (name, input, actor) => onBoard(() => cx.call(name, input, actor));
  const page = (path) => (/^https?:/i.test(boardUrl(cx.env) || '') ? boardUrl(cx.env).replace(/\/+$/, '') + path : path);
  if (verb === 'override request') {
    const fields = ['name', 'description', 'intent', 'close', 'body', 'words', 'text'].filter((k) => flags[k] !== undefined);
    let input;
    if (id) {
      input = { kind: flags.kind, reason: flags.reason, summary: flags.summary, items: [{ record: id, ...Object.fromEntries(fields.map((k) => [k, flags[k]])) }] };
    } else {
      if (fields.length) throw new UsageError('a batch names its fields per item in the JSON on stdin; --' + fields.join(', --') + ' go with one record id');
      input = await readPayload(cx, verb);
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new UsageError(verb + ' reads a JSON object on stdin');
      for (const k of ['kind', 'reason', 'summary']) if (flags[k] !== undefined) input[k] = flags[k];
    }
    input.session = flags.session;
    if (flags['dry-run']) input.dryRun = true;
    const r = await call('overrideRequest', input, boardActor({}, flags.session));
    return cx.emit(flags, r, (r.dryRun ? 'dry run, nothing asked: ' : 'override #' + r.request + ' waits on ' + cx.who() + "'s " + (OVERRIDE_ACT_WORD[r.kind] || 'press') + ' or Keep: ')
      + r.text + (r.reversal ? '\na reversal of a ruling' : '') + (r.dryRun ? '' : '\n' + page(r.page))
      + (r.unreached ? '\na scrub cannot reach ' + r.unreached.join('; ') : ''));
  }
  if (!flags.user) throw new UsageError(verb + " is " + cx.who() + "'s act: --user <the session they pressed or asked in>");
  if (verb === 'override decide') {
    const r = await call('overrideDecide', { request: ids[0], decision: ids[1] }, boardActor(flags));
    return cx.emit(flags, r, 'override #' + r.request + (r.decision === 'allow' ? ' ' + (OVERRIDE_DONE_WORD[r.kind] || 'allowed') + ': ' : ' kept as written: ') + r.records.join(', ')
      + (r.unreached ? '\nthe scrub could not reach ' + r.unreached.join('; ') + '; if it was a secret, rotate it' : ''));
  }
  const r = await call('overrideUnscrub', { id }, boardActor(flags));
  return cx.emit(flags, r, r.id + ': the scrubbed text is back' + (r.left ? '; left as they are, since they changed after the scrub: ' + r.left.join(', ') : ''));
}

/* commit link (the mod's write), commit move, review covers and the coverage read. */
async function coverageCommand(cx, verb, flags, id, ids) {
  const call = (name, input) => onBoard(() => cx.call(name, input, boardActor({}, flags.session)));
  if (verb === 'commit link') {
    const input = await readPayload(cx, verb);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new UsageError(verb + ' reads a JSON object on stdin');
    const r = await call('commitLink', input);
    return cx.emit(flags, r, r.sha.slice(0, 7) + (r.task ? ' linked to ' + r.task : ' linked to no task') + (r.created ? '' : ' (already linked)'));
  }
  if (verb === 'commit move') {
    const r = await call('commitMove', { sha: id, repo: flags.repo, from: flags.from, to: flags.to, reason: flags.reason });
    return cx.emit(flags, r, r.sha.slice(0, 7) + (r.moved ? ' moved from ' + (r.from || 'no task') + ' to ' + r.to : ' is already on ' + r.to));
  }
  if (verb === 'review covers') {
    if (flags.none && ids.length > 1) throw new UsageError('review covers takes the T-n ids it covers or --none, not both');
    const r = await call('reviewCovers', { review: id, ...(flags.none ? { none: true } : ids.length > 1 ? { tasks: ids.slice(1) } : {}) });
    return cx.emit(flags, r, r.review + (r.covers.length ? ' covers ' + r.covers.map((c) => c.id).join(', ') : ' covers nothing') + (r.default ? ' (the default)' : ''));
  }
  let scanned = null;
  if (flags.scan) {
    const head = await call('coverage', { scope: id });
    const tracks = head.scope.kind === 'track' ? [head.scope.id] : head.tracks.map((t) => t.id);
    scanned = await scanCommits(tracks, { call: cx.call, dir: cx.dataDir(), cwd: cx.cwd, env: cx.env }, boardActor({}, flags.session));
  }
  const r = await call('coverage', { scope: id });
  if (scanned) r.scanned = scanned;
  const due = r.tracks.filter((t) => t.due).map((t) => t.id + ' (' + t.uncovered.length + ' unreviewed, due at ' + t.size + ')');
  const lines = r.tasks.map((t) => '  ' + t.id + ' ' + oneLine(t.name) + (t.track && r.scope.kind !== 'track' ? ' (' + t.track + ')' : '') + ': ' + t.status
    + ', ' + (t.added + t.removed) + ' lines in ' + t.commits + ' commit' + (t.commits === 1 ? '' : 's')
    + (t.covered ? ', covered by ' + t.by : ', not covered') + (t.guess ? ', ' + t.guess + ' linked by guess' : '')
    /* a review judges the diff against what the task was for; a board without them sends neither */
    + (t.intent !== undefined ? '\n' + aimLines(t, '    ').join('\n') : ''));
  const revs = r.reviews.map((v) => '  ' + v.id + ' ' + oneLine(v.name) + ': ' + v.status + (v.covers.length ? ', covers ' + v.covers.map((c) => c.id).join(', ') + (v.given ? ' (given)' : '') : ''));
  return cx.emit(flags, r, (scanned ? (scanned.failed ? 'scan failed (the data dir\'s commit-links.log says why)\n' : 'scanned ' + scanned.repos + ' repo range' + (scanned.repos === 1 ? '' : 's') + ', ' + scanned.linked + ' linked\n') : '')
    + r.scope.id + ': ' + r.tasks.length + ' code task' + (r.tasks.length === 1 ? '' : 's') + ', review depth ' + r.depth
    + (due.length ? '\nreview due: ' + due.join('; ') : '')
    + (lines.length ? '\n' + lines.join('\n') : '') + (revs.length ? '\nreviews:\n' + revs.join('\n') : '')
    + (r.unowned.length ? '\n' + r.unowned.length + ' commit' + (r.unowned.length === 1 ? '' : 's') + ' no task owns'
      + (r.unowned.some((u) => u.covered) ? ', ' + r.unowned.filter((u) => u.covered).length + ' read by a project-wide review' : '') : ''));
}

/* the conversion map read, the write's batch put and the undo's drop, by the project's shared name */
async function conversionCommand(cx, verb, flags) {
  const dir = cx.path(flags.project || cx.cwd);
  const project = sharedName(dir) || dir.replace(/\\/g, '/').toLowerCase();
  const call = (name, input) => onBoard(() => cx.call(name, { project, ...input }, boardActor({}, flags.session)));
  if (verb === 'conversion put') {
    const input = await readPayload(cx, verb);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new UsageError(verb + ' reads a JSON object on stdin');
    const r = await call('conversionPut', { run: input.run, rows: input.rows });
    return cx.emit(flags, r, r.put + ' map row' + (r.put === 1 ? '' : 's') + ' put for ' + r.project);
  }
  if (verb === 'conversion drop') {
    const r = await call('conversionDrop', { run: flags.run, keep: flags.keep });
    return cx.emit(flags, r, r.dropped + ' map row' + (r.dropped === 1 ? '' : 's') + ' of ' + r.run + ' dropped' + (r.restored ? ', ' + r.restored + ' given back to an earlier run' : '') + ' for ' + r.project);
  }
  const r = await call('conversionMap', {});
  const n = (k) => r.rows.filter((x) => x.kind === k).length;
  return cx.emit(flags, r, r.project + ': ' + n('file') + ' sources, ' + n('folder') + ' folders, ' + n('call') + ' answered calls, ' + n('run') + ' runs'
    + (r.last ? '; the last run ' + r.last.at.slice(0, 10) + (r.last.sha ? ' at ' + r.last.sha.slice(0, 8) : '') : '; no run yet'));
}

/* an import's records counted by kind, deleted only with --yes */
async function purgeCommand(cx, flags, label) {
  const r = await onBoard(() => cx.call('importPurge', { label, ids: flags.id, items: flags.item, yes: flags.yes === true }, boardActor({}, flags.session)));
  const kinds = Object.entries(r.counts).map(([k, n]) => n + ' ' + k + (k === 'knowledge' ? ' record' + (n === 1 ? '' : 's') : n === 1 ? '' : 's'));
  const what = (kinds.join(', ') || 'no records') + (r.handoffs ? ', with ' + r.handoffs + ' handoff' + (r.handoffs === 1 ? '' : 's') : '');
  const lines = [(r.dryRun ? 'Dry run: the purge of ' + r.label + ' would delete ' + what + '; --yes deletes them once the user says yes' : 'Deleted ' + what + ' of ' + r.label)];
  if (r.held.length) lines.push('Held back (' + r.held.length + '): ' + r.held.map((h) => h.id + ' ' + h.why).join('; '));
  if (r.gone.length) lines.push('Not on the board: ' + r.gone.join(', '));
  return cx.emit(flags, r, lines.join('\n'));
}

async function boardDecisions(cx, verb, flags) {
  const call = (name, input, actor = {}) => onBoard(() => cx.call(name, input, actor));
  const line = (d) => d.id + ' ' + oneLine(d.name) + (d.created ? ' (' + String(d.created).slice(0, 10) + ')' : '');
  if (verb === 'decide') {
    const payload = await readPayload(cx, verb);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new UsageError('decide reads a JSON object on stdin');
    if (payload.projects !== undefined) {
      if (payload.projectRepos === undefined) payload.projectRepos = namesOf(cx, payload.projects);
      delete payload.projects;
    } else if (payload.projectRepos === undefined && payload.global !== true) payload.projectRepos = namesOf(cx, [cx.cwd]);
    const session = flags.session || (typeof payload.session === 'string' ? payload.session : undefined);
    if (flags.confirmed) payload.confirmed = true;
    const r = await call('decide', payload, boardActor(flags, session));
    const u = cx.signed() ? signedPage(cx.signed(), r.key) : pageUrl('r', r.key, cx.env);
    if (u) r.boardUrl = u;
    /* checked here, not on the board, so the mod's tool and the CLI get it with the plugin */
    const open = openWordsWarning(payload.words, r.id, cx.who());
    if (open) r.wordsWarning = open;
    const on = r.tasks.concat(r.tracks, r.workstreams);
    return cx.emit(flags, r, r.id + ' recorded' + (on.length ? ' on ' + on.join(', ') : '')
      + (r.superseded.length ? '; it supersedes ' + r.superseded.join(', ') : '') + (r.boardUrl ? ' -> ' + r.boardUrl : '')
      + (r.answered ? '\n' + r.answered + ' answered' : '') + (r.warning ? '\n' + r.warning : '') + (open ? '\n' + open : ''));
  }
  if (verb === 'decisions') {
    const r = await call('decisionsFor', { task: flags.task, track: flags.track, workstream: flags.workstream, since: flags.since });
    return cx.emit(flags, r, r.length ? r.map(line).join('\n') : 'no decisions in force there');
  }
  /* the rows match as procedure cards do (lib/proc-match.mjs): `project` is this PC's checkout */
  const g = await placeOf(flags.project || cx.cwd);
  const rows = (await call('decisionTriggers', { project: g.repo })).map((d) => ({ ...d, project: g.here }));
  return cx.emit(flags, rows, rows.length ? rows.map((d) => d.id + ' ' + oneLine(d.name) + ': ' + d.files.concat(d.commands).join(', ')).join('\n')
    : 'no decision or knowledge record in force names files or commands here');
}

/* The near-match warning over the board's search: a knowledge record two of the title's longest words reach. Fail-open. */
async function boardNear(cx, call, title) {
  try {
    const words = [...new Set(String(title).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4))]
      .sort((a, b) => b.length - a.length).slice(0, 3);
    const seen = new Map();
    for (const w of words) {
      for (const h of (await call('search', { text: w, limit: 20, tab: 'work', count: false })).hits) {
        if (h.kind !== 'knowledge') continue;
        const e = seen.get(h.id) || { h, n: 0 };
        e.n++;
        seen.set(h.id, e);
      }
    }
    const need = Math.min(2, words.length);
    for (const { h } of [...seen.values()].filter((e) => e.n >= need).sort((x, y) => y.n - x.n).slice(0, 3)) {
      cx.err('AskerDo: close to ' + h.id + ' ' + oneLine(h.name) + '\n');
    }
  } catch {}
}

/* `resolve`'s words: the holder on a day, or the live one and every earlier one. */
function resolveText(r, flags) {
  const one = (x) => x.label + ' ' + (x.key || '(no key)') + ' ' + x.kind + ' (' + oneLine(x.name) + ')'
    + (x.from || x.to ? ' held ' + (x.from || 'before the cutover') + ' to ' + (x.to || 'now') : '')
    + (x.now && x.now !== x.label ? ', now ' + x.now : '');
  if (flags.at !== undefined) return r.record ? one(r.record) : r.label + ': no record held it on ' + r.at;
  return [r.live ? 'live: ' + one(r.live) : r.label + ': no live record holds it'].concat(r.earlier.map((x) => 'earlier: ' + one(x))).join('\n');
}

/* The activity page, one line per row; the human form names its own next page. */
function activityOut(cx, flags, r) {
  if (flags.json) return cx.emit(flags, r, '');
  if (!r.lines.length) return cx.out('nothing to show\n');
  for (const l of r.lines) cx.out(activityText(l) + '\n');
  if (r.nextBefore) cx.out('next page: --before ' + r.nextBefore + '\n');
}

/* activity, resolve, old brain ids and the procedure cards on the board. */
async function boardRead(cx, verb, flags, { id, ids, text }) {
  const call = (name, input, actor = {}) => onBoard(() => cx.call(name, input, actor));
  if (verb === 'legacy') {
    const r = await call('resolveLegacy', { id, project: flags.project, cwd: cx.cwd });
    const url = archiveUrl(r.entry, cx.env);
    return cx.emit(flags, { key: r.key, ...r.entry, ...(url ? { archiveUrl: url } : {}) }, mappingLine(r.key, r.entry)
      + (r.entry.to && r.entry.archive ? '\narchived at ' + r.entry.archive : '') + (url ? '\n' + url : ''));
  }
  if (verb === 'activity') {
    const limit = flags.limit === undefined ? undefined : Number(flags.limit);
    const project = flags.project;
    const r = await call('activity', {
      month: flags.month, before: flags.before, search: flags.search, kind: flags.kind, id: flags.id, limit, workstream: flags.workstream,
      places: flags.places === true || project !== undefined, projectRepo: project ? sharedName(project) || undefined : undefined,
    });
    if (r.wsNames) for (const l of r.lines) { const u = pageUrl('r', l.key || l.id, cx.env); if (u) l.href = u; }
    return activityOut(cx, flags, r);
  }
  if (verb === 'resolve') {
    const r = await call('resolveLabel', { label: id, at: flags.at });
    return cx.emit(flags, r, resolveText(r, flags));
  }
  /* the session the CLI runs in, so a run is recorded as that session's */
  const actor = boardActor(flags, flags.session || envSession(cx.env));
  const dir = flags.project || cx.cwd;
  if (verb === 'proc find') {
    const rows = findCards(await cardsHere(await call('procedureCards', {}), dir, { checkout: false }), text, { project: (await placeOf(dir)).project });
    return cx.emit(flags, rows, rows.length ? rows.map(procLine).join('\n') : 'no procedure matches: ' + text);
  }
  if (verb === 'proc triggers') {
    if (flags.project && !flags['no-scan']) {
      try { await scanOnBoard(flags.project, call, actor); } catch (e) { cx.err('AskerDo: proc scan: ' + ((e && e.message) || e) + '\n'); }
    }
    const cards = await call('triggerCards', {});
    const rows = flags.project ? await cardsHere(cards, flags.project) : cardsMapped(cards);
    return cx.emit(flags, rows, rows.map(procLine).join('\n'));
  }
  if (verb === 'proc scan' && flags.check) {
    const r = await checkProcedures(dir);
    if (r.counts.errors) cx.exit = 1;
    return cx.emit(flags, r, checkText(r));
  }
  if (verb === 'proc scan') {
    const r = await scanOnBoard(dir, call, actor, { vouch: flags.vouch, since: flags.since, unvouch: flags.unvouch });
    return cx.emit(flags, r, procScanText(r));
  }
  if (verb === 'proc ran') {
    const [name, result] = ids;
    const r = await ranOnBoard(dir, name, String(result).toLowerCase(), flags.note, call, actor, { fixed: flags.fixed, oneOff: flags['one-off'], filed: flags.filed });
    return cx.emit(flags, r, r.id + ' ' + r.slug + ': ' + r.result + ' run recorded (' + r.runs + (r.runs === 1 ? ' run, ' : ' runs, ') + r.cleanRuns + ' clean in a row)'
      + (r.stale.length ? '\nstill stale: ' + r.stale.join('; ') : '') + outcomeWords(r) + (r.suggestScript ? '\n' + r.suggestScript : ''));
  }
  if (verb === 'proc drafts') {
    const g = await placeOf(dir);
    const r = await call('procDrafts', { name: ids[0], project: g.project, repo: g.repo }, actor);
    return cx.emit(flags, r, draftsText(r));
  }
  throw new UsageError('unknown verb: ' + verb);
}

/* A record word's remote and the PC's project map for it: the board cannot read git. */
function profileWhere(word, project) {
  const dirs = [word, project].filter((d) => typeof d === 'string' && /[\\/]/.test(d));
  const repos = {};
  for (const d of dirs) { const r = repoOf(d); if (r) repos[d] = r; }
  return { repo: dirs.length ? repos[dirs[0]] || undefined : undefined, repos };
}

/* The profile verbs on the board; the depth markers follow through scripts/depth-marker.mjs. */
async function boardProfile(cx, verb, flags, id, ids) {
  const { emit } = cx;
  const actor = boardActor(flags, flags.session || envSession(cx.env));
  const call = (name, input) => onBoard(() => cx.call(name, input, actor));
  if (verb === 'profile list') {
    const r = await call('profileList', {});
    return emit(flags, r, r.profiles.map((p) => p.profile + (p.builtIn ? ' (built in)' : '') + ': '
      + (settingsText(p.settings) || 'nothing') + (p.description ? ' (' + oneLine(p.description) + ')' : '')
      + (p.held.length ? '\n  on ' + heldText(p) : '')).join('\n'));
  }
  if (verb === 'profile show-effective') {
    const r = await call('effective', { record: id, project: flags.project, ...profileWhere(id, flags.project) });
    if (flags.rules) {
      const b = rulesBlock(r);
      return emit(flags, b, rulesText(b) + (b.inject ? '' : '\n(dispatch.inject is off: agent briefs do not get this block)'));
    }
    return emit(flags, r, effectiveText(r));
  }
  if (verb.startsWith('profile rule-')) {
    const op = verb.slice('profile rule-'.length);
    const r = await call('profileRule', { name: ids[0], op, slug: ids[1], text: flags.text, for: flags.for, from: flags.from, ruling: flags.ruling });
    return emit(flags, r, 'rule ' + r.slug + (op === 'add' ? ' added to ' : op === 'drop' ? ' dropped by ' : ' cleared from ') + r.profile
      + (r.history ? ' (history #' + r.history + ')' : ''));
  }
  if (verb === 'profile define') {
    const r = await call('profileDefine', { name: id, set: flags.set || [], unset: flags.unset || [], description: flags.description });
    return emit(flags, r, r.profile + (r.created ? ' defined: ' : ' updated: ') + settingsText(r.settings));
  }
  if (verb === 'profile delete') {
    const r = await call('profileDelete', { name: id });
    return emit(flags, r, r.profile + ' deleted');
  }
  if (verb === 'profile add') {
    const r = await call('profileAdd', { record: ids[0], name: ids[1], ...profileWhere(ids[0]) });
    return emit(flags, r, (r.added ? r.profile + ' added to ' : r.record + ' already holds ') + (r.added ? r.record : r.profile));
  }
  if (verb === 'profile remove') {
    const r = await call('profileRemove', { record: ids[0], name: ids[1], project: flags.project, ...profileWhere(ids[0], flags.project) });
    return emit(flags, r, r.profile + ' ' + r.how + (r.how === 'dropped' ? ' at ' : ' from ') + r.record);
  }
  if (verb === 'profile guard') {
    if (!flags.project) throw new UsageError('profile guard needs --project <dir>');
    const r = await call('profileGuard', { project: flags.project, repo: repoOf(flags.project) || undefined, want: id });
    const on = r.effective.settings['agent.on'];
    return emit(flags, r, 'agent guard ' + (on.value ? 'on' : 'off') + ' for ' + r.record + (r.steps.length ? ' (' + r.steps.join(', ') + ')' : ' (no change)'));
  }
  throw new UsageError('unknown verb: ' + verb);
}

/* ---- settings: one list and one write for every surface ---------- */

/* The sync with the caller's environment, synchronous on purpose: the caller's process
   only, never the server; the open-path guard in test/tray.test.mjs keeps openInBrowser
   the one async spawn */
function runSync(cx, args) {
  const r = spawnSync(process.execPath, [join(pluginRoot, 'hooks', 'sync.mjs'), ...args], { cwd: cx.cwd, env: cx.env, windowsHide: true, encoding: 'utf8' });
  if (r.error) return { code: 2, stdout: r.stdout || '', stderr: (r.stderr || '') + r.error.message };
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

async function settingsCommand(cx, verb, flags, ids) {
  const board = !!boardUrl(cx.env);
  const config = loadConfig(cx.env) || { ...DEFAULT_CONFIG };
  const actor = boardActor(flags, flags.session || envSession(cx.env));
  const call = (name, input) => onBoard(() => cx.call(name, input, actor));
  const record = flags.track || flags.project || cx.cwd;
  if (verb === 'settings') {
    let r;
    if (board) {
      const b = await call('settings', { record, project: flags.project, ...profileWhere(record, flags.project) });
      r = { ...b, board: true, rows: withPcRows(b.rows, config, { board: true }) };
    } else r = { record: null, chain: [], held: [], board: false, rows: settingRows(null, null, config, { board: false }), lists: listCopy(false) };
    return cx.emit(flags, { ...r, tabs: tabsOf(r.rows, { board }) }, settingsListText(r));
  }
  if (verb === 'settings rule') {
    if (!board) throw new UsageError('rule lines live on a profile, which needs a board: ' + NO_BOARD);
    const [op, slug] = ids;
    const r = await call('settingsRule', { op, slug, text: flags.text, for: flags.for, profile: flags.profile });
    return cx.emit(flags, r, 'rule ' + r.slug + (op === 'add' ? ' added to ' : op === 'drop' ? ' dropped on ' : ' cleared from ') + r.profile
      + (r.added ? ' (now held on default)' : '') + (r.dropped ? '; left empty, so it is gone' : ''));
  }
  const unset = verb === 'settings unset';
  const [key, raw, word] = unset ? [ids[0], undefined, ids[1]] : ids;
  const k = String(key).trim();
  if (k === 'boardUrl' || k === 'boardToken') throw new UsageError(k + ' is set by the join (/askerdo:configure), never here');
  if (k === 'boardBackups') return backupsSetting(cx, flags, unset ? '' : raw);
  if (k === 'boardContainer') return containerSetting(cx, flags, unset ? '' : raw);
  if (k === 'answerPresses') return pressesSetting(cx, flags, unset ? undefined : raw);
  if (k === 'pluginUpdates') return updatesSetting(cx, flags, unset ? undefined : raw);
  if (k.startsWith('rules.')) throw new UsageError('rule lines are set with profile rule-add, rule-drop and rule-clear');
  if (k === 'queue' && board) throw new UsageError("a board PC's queue is hub, set by the join");
  if (word !== undefined && !flags.at) throw new UsageError('a record after the value goes with --at <layer>');
  const pc = k === 'queue' || k.startsWith('contract.');
  if (!board) {
    if (!pc) throw new UsageError(k + ' lives on a profile, which needs a board: ' + NO_BOARD);
    if (flags.at && flags.at !== 'default') throw new UsageError("with no board a setting lives in this PC's config.json, so --at takes no layer");
    /* no board: the reset is the built-in value, saved like any other */
    return settingsToConfig(cx, flags, k, unset ? checkSetting(k, DEFAULT_CONFIG[k.replace(/^contract\./, '')]) : checkSetting(k, raw), config);
  }
  const at = flags.at || undefined;
  const target = at === 'project' ? cx.path(word || cx.cwd) : word;
  if (unset) {
    const u = await call('settingsUnset', { key: k, at, record: at ? target : record, project: flags.project, ...profileWhere(at ? target : record, flags.project) });
    const sync = pc ? await settingsCopy(cx, k.slice('contract.'.length), u.now.value) : '';
    const text = !u.removed ? k + ' is built in already; nothing to remove'
      : k + ' removed from ' + u.profile + ' (on ' + u.from + (u.dropped ? '; left empty, so it is gone' : '') + '); now ' + wordsOf(k, u.now.value) + ' from ' + (u.now.profile ? u.now.profile + ' on ' + u.now.record : 'built in');
    return cx.emit(flags, { ...u, ...(sync ? { sync } : {}) }, text + (sync ? '\n' + sync : ''));
  }
  const r = await call('settingsSet', {
    key: k, value: raw, at, record: at ? target : record, profile: flags.profile, project: flags.project,
    ...profileWhere(at ? target : record, flags.project),
  });
  let sync = '';
  if (pc) sync = await settingsCopy(cx, k.slice('contract.'.length), r.value);
  const made = [r.created ? 'new' : '', r.added ? 'added to ' + (at && at !== 'default' ? target : 'default') : ''].filter(Boolean).join(', ');
  const text = k + ' set to ' + wordsOf(k, r.value) + ' on ' + r.profile + (made ? ' (' + made + ')' : '')
    + '; it reaches ' + (r.reaches.map((h) => h.record).join(', ') || 'no record yet') + (sync ? '\n' + sync : '');
  return cx.emit(flags, { ...r, ...(sync ? { sync } : {}) }, text);
}

/* this PC's own folder for the board it hosts; one it cannot write is refused here */
function backupsSetting(cx, flags, raw) {
  const v = checkSetting('boardBackups', raw === undefined ? '' : String(raw));
  const value = v ? resolve(v).replace(/\\/g, '/') : '';
  const problem = value ? backupsFolderProblem(value) : null;
  if (problem) throw new UsageError('Board backups folder ' + problem + ' (boardBackups)');
  const { dir, file, saved } = savedConfig(cx);
  mkdirSync(dir, { recursive: true });
  writeAtomic(file, JSON.stringify({ ...saved, boardBackups: value }, null, 2) + '\n', 0o600);
  const host = readHost(cx.root());
  return cx.emit(flags, { key: 'boardBackups', value, layer: 'pc' }, 'boardBackups set to ' + (value || 'the folder beside the database')
    + " in this PC's config.json" + (host ? '; the next copy goes there' : '; it takes effect once this PC hosts the board (askerdo board here)'));
}

/* the Docker board on this PC that the day's first session start backs up */
function containerSetting(cx, flags, raw) {
  const value = checkSetting('boardContainer', raw === undefined ? '' : String(raw)).trim();
  if (value && !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value)) throw new UsageError('Docker board container is a container name, such as askerdo (boardContainer): ' + value);
  const { dir, file, saved } = savedConfig(cx);
  mkdirSync(dir, { recursive: true });
  writeAtomic(file, JSON.stringify({ ...saved, boardContainer: value }, null, 2) + '\n', 0o600);
  return cx.emit(flags, { key: 'boardContainer', value, layer: 'pc' }, value
    ? 'boardContainer set to ' + value + "; the first session start of each day backs it up inside the container"
    : 'boardContainer cleared; no Docker board on this PC is backed up');
}

/* how this PC's question cards take a press; config.json alone, board or not */
function pressesSetting(cx, flags, raw) {
  const value = raw === undefined ? DEFAULT_CONFIG.answerPresses : checkSetting('answerPresses', String(raw));
  const { dir, file, saved } = savedConfig(cx);
  mkdirSync(dir, { recursive: true });
  writeAtomic(file, JSON.stringify({ ...saved, answerPresses: value }, null, 2) + '\n', 0o600);
  return cx.emit(flags, { key: 'answerPresses', value, layer: 'pc' }, 'answerPresses set to ' + wordsOf('answerPresses', value) + " in this PC's config.json");
}

/* the answer to configure's offer, in config.json alone; on and off set the app's switch
   first, and a switch that cannot be set saves nothing */
function updatesSetting(cx, flags, raw) {
  const value = raw === undefined ? DEFAULT_CONFIG.pluginUpdates : checkSetting('pluginUpdates', String(raw));
  const r = value === 'ask' ? null : setPluginUpdates(value === 'on', { env: cx.env });
  if (r && !r.ok) throw new UsageError("Plugin auto-update could not be set in the app's settings, so nothing was saved: " + r.why + ' (pluginUpdates)');
  const { dir, file, saved } = savedConfig(cx);
  mkdirSync(dir, { recursive: true });
  writeAtomic(file, JSON.stringify({ ...saved, pluginUpdates: value }, null, 2) + '\n', 0o600);
  return cx.emit(flags, { key: 'pluginUpdates', value, layer: 'pc', ...(r ? { marketplace: r.name, wrote: r.wrote } : {}) }, 'pluginUpdates set to ' + wordsOf('pluginUpdates', value)
    + " in this PC's config.json" + (r ? "; the app's auto-update for the " + r.name + ' marketplace is ' + value : ''));
}

/* No board: the contract save (validation, config.json, the sync), with one value changed. */
async function settingsToConfig(cx, flags, k, value, config) {
  const cfgKey = k.startsWith('contract.') ? k.slice('contract.'.length) : k;
  const payload = {};
  for (const x of OPTION_KEYS) payload[x] = config[x] === undefined ? DEFAULT_CONFIG[x] : config[x];
  payload[cfgKey] = value;
  const r = await saveContract(payload, { env: cx.env, runSync: (args) => runSync(cx, args) });
  if (r.error) throw new UsageError(r.error);
  return cx.emit(flags, { key: k, value, layer: 'pc', sync: r.sync }, k + ' set to ' + wordsOf(k, value) + " in this PC's config.json" + (r.sync ? '\n' + r.sync : ''));
}

/* A board user's PC copy after the board took the value, then the sync from that copy. */
async function settingsCopy(cx, cfgKey, value) {
  const dir = cx.dataDir();
  if (!dir) return '';
  const file = join(dir, 'config.json');
  let saved = {};
  try { saved = JSON.parse(readFileSync(file, 'utf8')); } catch (e) {
    if (e.code !== 'ENOENT') saved = null;
  }
  /* a config that does not read is left as it is, since a rewrite would drop the join */
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) {
    throw new UsageError('the board took ' + cfgKey + ', but this PC\'s config at ' + file + ' is not a JSON object, so its copy was not written: fix or remove it first');
  }
  if (JSON.stringify(saved[cfgKey]) !== JSON.stringify(value)) {
    mkdirSync(dir, { recursive: true });
    writeAtomic(file, JSON.stringify({ ...saved, [cfgKey]: value }, null, 2) + '\n', 0o600);
  }
  /* the board's copy may not have reached this PC's cache yet, so the sync builds from the file */
  const r = runSync(cx, ['--no-pull']);
  return r.stdout.trim();
}

/* One record by label or key: a question, a handoff (TR-n.m), else a work record;
   an old TH-n, TH-n.m or P-n resolves to the track or handoff it became. */
async function boardRecord(call, urlOf, one, session) {
  const t = String(one).trim();
  const ask = (x) => (session ? { id: x, session } : x);
  if (/^T[RH]-\d+\.\d+$/i.test(t)) {
    const h = await call('readHandoff', { id: t });
    return { ...h, verifyFirst: h.verify || [] };
  }
  if (isQuestionToken(t)) return urlOf(await call('show', { id: t, ...(session ? { session } : {}) }));
  /* a key names any kind; the mod reads questions by key, so that comes first */
  if (/^[0-9a-z]{8}$/.test(t)) {
    try { return urlOf(await call('show', { id: t, ...(session ? { session } : {}) })); } catch (e) { if (!(e instanceof UsageError)) throw e; }
  }
  const rec = await call('readRecord', ask(t));
  if (rec.kind === 'task') {
    const w = await call('waitsOn', rec.key || rec.id);
    if (w.length) rec.waitsOn = w;
    /* the procedure cards its refs name, with their badges */
    const named = (Array.isArray(rec.refs) ? rec.refs : []).map((x) => String(x).trim().toUpperCase()).filter((x) => /^PR-\d+$/.test(x));
    if (named.length) {
      const cards = (await call('procedureCards', {})).filter((c) => named.includes(c.id));
      if (cards.length) rec.procedures = cards;
    }
  }
  return urlOf(rec);
}

async function boardShow(cx, flags, ids, { call, urlOf }) {
  const named = ['head', 'brief', 'full'].filter((k) => flags[k]).concat(flags.section !== undefined ? ['section'] : []);
  if (named.length > 1) throw new UsageError('pick one read level: --head, --brief, --section or --full');
  if (flags.project !== undefined && !ids.some((x) => parseLegacyToken(x))) throw new UsageError('--project resolves an old brain id; the record ids here need none');
  /* --json alone is the whole record, the shape scripts and the mod read */
  const level = named[0] || (flags.json ? 'full' : 'brief');
  if (flags.history) {
    if (named.length || flags.journal || flags['journal-tail'] !== undefined || flags['since-resume']) throw new UsageError('--history prints the old texts alone; it takes no read level');
    const hs = [];
    for (const one of ids) hs.push(await call('recordHistory', { id: one }));
    if (flags.json) return cx.emit(flags, hs.length === 1 ? hs[0] : hs, '');
    return cx.out(hs.map(historyText).join(RECORD_SEP) + '\n');
  }
  let tail;
  if (flags['journal-tail'] !== undefined) {
    if (!/^\d{1,6}$/.test(flags['journal-tail'])) throw new UsageError('--journal-tail takes a whole number of notes');
    tail = Number(flags['journal-tail']);
  }
  const slicing = tail !== undefined || flags['since-resume'] === true;
  if (flags.journal && level !== 'brief') throw new UsageError('--journal shapes the brief form');
  if (slicing && named[0] === 'full') throw new UsageError('--full prints the whole journal; --journal-tail and --since-resume cut it in the brief form');
  if (slicing && level === 'head') throw new UsageError('--head prints no journal to cut');
  /* the session asking, so its own run reads "this session" */
  const reader = flags.session || envSession(cx.env);
  const out = [];
  for (const one of ids) {
    /* an old brain id reads as its target under its mapping line, or names where its archive is */
    const old = parseLegacyToken(one) ? await call('resolveLegacy', { id: one, project: flags.project, cwd: cx.cwd }) : null;
    if (old && !old.entry.to) {
      if (slicing) throw new UsageError(String(one).toUpperCase() + ' has no journal to slice');
      const url = archiveUrl(old.entry, cx.env);
      out.push({ text: mappingLine(old.key, old.entry) + (url ? '\n' + url : ''),
        json: { kind: 'archive', id: old.key, archive: old.entry.archive, ...(url ? { url } : {}), resolvedFrom: { key: old.key, ...old.entry } } });
      continue;
    }
    const r = await boardRecord(call, urlOf, old ? old.entry.label || old.entry.to : one, reader);
    if (old) r.resolvedFrom = { key: old.key, ...old.entry };
    const kind = r.kind || 'question';
    const all = fullSections(r, kind, cx.who());
    const journal = { total: kind === 'question' || kind === 'handoff' ? 0 : journalEntries(r.journal).length };
    journal.kept = journal.total;
    if (slicing) {
      if (kind === 'question' || kind === 'handoff') throw new UsageError(String(one).toUpperCase() + ' has no journal to slice');
      const since = flags['since-resume'] ? await call('resumeCutoff', { id: r.key || r.id }) : null;
      const cut = sliceJournal(r.journal, { tail, since: since && since.since });
      r.journal = cut.text;
      if (r.sections && 'Journal' in r.sections) r.sections.Journal = cut.text;
      r.journalSlice = { kept: cut.kept, total: cut.total, ...(tail !== undefined ? { tail } : {}), ...(since ? { since: since.since, via: since.via } : {}) };
      journal.kept = cut.kept;
    }
    /* a task's default read is its block: the typed notes since its last rewrite, the rest counted */
    const block = kind === 'task' && !named.length && !flags.journal && !slicing && !flags.json ? await blockRead(call, r, reader) : null;
    /* the block's board-worded commands name this session's launcher, as the kickoff's do */
    const o = block ? { text: hereLines([blockShow(r, block, cx.who(), reader)], launcherHere(cx.env))[0], json: r } : boardLevel(r, kind, level, { all, journal, flags, slicing, who: cx.who(), reader });
    if (old) {
      o.text = mappingLine(old.key, old.entry) + '\n' + o.text;
      if (o.json !== r) o.json.resolvedFrom = r.resolvedFrom;
    }
    out.push(o);
  }
  if (flags.json) return cx.emit(flags, out.length === 1 ? out[0].json : out.map((o) => o.json), '');
  return cx.out(out.map((o) => o.text).join(RECORD_SEP) + '\n');
}

/* The task block, or null from a board older than it, where show keeps the brief form. */
async function blockRead(call, r, reader) {
  try {
    const b = await call('taskBlock', { id: r.key || r.id, ...(reader ? { session: reader } : {}) });
    return b && typeof b.text === 'string' ? b : null;
  } catch { return null; }
}

/* The head fields, the block, and the sections the block does not carry. */
function blockShow(r, b, who, reader) {
  const m = briefModel(r, false, who, reader);
  const done = Array.isArray(r.checklist) && r.checklist.some((c) => c.done);
  const others = m.sections.map((s) => s.label).filter((l) => !['Description', 'Intent'].includes(l) && (l !== 'Filed past the held track' || !b.whyElsewhere) && (l !== 'Filed last' || !b.filedLast) && (l !== 'Checklist' || done));
  /* the block's first line says the word, so the head leaves it out */
  const head = m.head.filter((f) => !b.said || f.key !== 'status');
  return [head.map((f) => f.text).filter(Boolean).join(HEAD_SEP), b.text, leftOutLine('block', { sections: others })].join('\n');
}

/* a record's old texts, oldest first, each change with who, when and why. */
function historyText(h) {
  if (!h.rows.length) return h.id + ': no text has changed since it was made';
  return h.id + ' history (' + h.rows.length + (h.rows.length === 1 ? ' change' : ' changes') + '):' + h.rows.map((x) => '\n#' + x.id + ' ' + x.at + ' ' + x.field
    + ' by ' + x.by + (x.why ? ' (' + x.why + ')' : '') + '\n  was: ' + (x.old === null ? '(none)' : oneLine(x.old)) + '\n  now: ' + (x.new === null ? '(none)' : oneLine(x.new))).join('');
}

/* One record at one level: { text, json }. */
function boardLevel(r, kind, level, { all, journal, flags, slicing, who, reader }) {
  const others = (printed) => all.map((s) => s.label).filter((l) => l !== 'Journal' && !printed.includes(l));
  if (level === 'full') {
    const m = { head: briefHead(r, kind, reader), name: kind === 'handoff' ? r.focus : r.name, sections: slicing ? fullSections(r, kind, who) : all };
    /* the stored pick is the asking session's recommendation; chosen is the answer */
    const chose = kind === 'question' ? chosenOf(r) : null;
    return { text: briefText(m), json: chose ? { ...r, chosen: chose } : r };
  }
  if (level === 'head') {
    const line = leftOutLine('head', { sections: others([]), journal: { total: journal.total, kept: 0 } });
    return { text: headLine(r, kind, who, reader) + '\n' + line, json: { id: r.id, key: r.key, kind, status: r.status, name: kind === 'handoff' ? r.focus : r.name, head: headLine(r, kind, who, reader), leftOut: line } };
  }
  if (level === 'section') {
    const want = String(flags.section).trim().toLowerCase();
    const pool = slicing ? fullSections(r, kind, who) : all;
    const s = pool.find((x) => x.label.toLowerCase() === want);
    if (!s) throw new UsageError(r.id + ' has no section ' + flags.section + '; it has ' + (all.map((x) => x.label).join(', ') || 'none'));
    const line = leftOutLine('section', { sections: others([s.label]), journal: s.label === 'Journal' ? journal : { total: journal.total, kept: 0 } });
    return { text: headLine(r, kind, who, reader) + '\n\n' + s.label + '\n' + s.text + '\n' + line, json: { id: r.id, key: r.key, kind, section: s.label, text: s.text, leftOut: line } };
  }
  const withJournal = !!flags.journal || slicing;
  const m = briefModel(r, withJournal, who, reader);
  const printed = m.sections.map((s) => s.label);
  const line = leftOutLine('brief', { sections: others(printed), journal: withJournal ? journal : { total: journal.total, kept: 0 } });
  return { text: briefText(m) + '\n' + line, json: { ...briefJson(m), leftOut: line } };
}

async function boardList(cx, flags, { call, urlOf }) {
  if ((flags.all ? 1 : 0) + (flags.snoozed ? 1 : 0) + (flags.open ? 1 : 0) > 1) throw new UsageError('pick at most one of --open, --all, --snoozed');
  const kind = flags.kind === undefined ? 'question' : flags.kind;
  if (kind === 'plan' || kind === 'thread') throw new UsageError(trackInstead('list --kind ' + kind, 'track list --workstream WS-n, or askerdo shelf'));
  if (kind !== 'question') {
    for (const q of ['project', 'session', 'blocking', 'snoozed', 'names-line']) {
      if (flags[q] !== undefined) throw new UsageError('--' + q + ' lists questions only');
    }
    if (flags.track !== undefined) throw new UsageError('--track lists questions only; a track\'s tasks are askerdo track show TR-n');
    const rows = (await call('listWork', {
      kind, all: flags.all, open: flags.open, status: flags.status, workstream: flags.workstream, priority: flags.priority, label: flags.label,
    })).map(urlOf);
    if (flags.json) return cx.emit(flags, rows, '');
    if (!rows.length) return cx.out('nothing to list\n');
    return cx.out(rows.map((e) => headLine(e, kind, cx.who(), envSession(cx.env))).join('\n') + '\n' + LIST_CUT + '\n');
  }
  for (const w of ['status', 'priority', 'label']) {
    if (flags[w] !== undefined) throw new UsageError('--' + w + ' needs a work --kind; questions filter with --open, --all, --snoozed, --blocking');
  }
  const repo = (dir) => (dir ? sharedName(dir) || undefined : undefined);
  if (flags['names-line']) {
    for (const w of ['all', 'snoozed', 'workstream', 'track', 'json']) {
      if (flags[w] !== undefined) throw new UsageError('--names-line takes --project, --session and --blocking only');
    }
    const dir = flags.project || cx.cwd;
    const base = webBase(cx.env);
    const line = await call('namesLine', { projectRepo: repo(dir), session: flags.session, blocking: flags.blocking, ...(base ? { urls: { base } } : {}) });
    return line ? cx.out(line + '\n') : undefined;
  }
  const rows = (await call('list', {
    all: flags.all, snoozed: flags.snoozed, projectRepo: repo(flags.project),
    session: flags.session, blocking: flags.blocking, workstream: flags.workstream, track: flags.track,
  })).map(urlOf);
  if (flags.json) {
    /* the old envelope, so the mod reads the board unchanged */
    const [open, held] = await Promise.all([call('peekOpenQuestions', {}), flags.session ? call('heldTask', { session: flags.session }) : null]);
    /* the whole board's open counts by the tray's rule, for the status row's mark */
    const blocking = open.filter((q) => q.blocking === true).length;
    const home = boardHome(cx.env);
    const set = boardSetUrl({ project: flags.project }, cx.env) || home;
    return cx.emit(flags, {
      questions: rows, openSetUrl: set, localUrl: localServerUrl(cx.env) || home, recentUrl: home || set, shelfUrl: home || set,
      ...(flags.session ? { inHand: held } : {}), board: { blocking, waiting: open.length - blocking },
    }, '');
  }
  if (!rows.length) return cx.out('nothing to list\n');
  return cx.out(rows.map((e) => headLine(e, 'question', cx.who())).join('\n') + '\n' + LIST_CUT + '\n');
}

async function boardSearch(cx, flags, text, { call }) {
  const limit = flags.limit === undefined ? undefined : Number(flags.limit);
  if (flags.ws !== undefined && !/^WS-\d+$/.test(flags.ws)) throw new UsageError('--ws takes a workstream id');
  const r = await call('search', { text, limit, tab: flags.tab, workstream: flags.ws });
  if (flags.json) return cx.emit(flags, r, '');
  if (!r.hits.length) return cx.out('nothing matches ' + text + '\n');
  const lines = r.hits.map((h) => headLine({ ...h, status: h.status || '' }, h.kind, cx.who(), envSession(cx.env)) + h.lines.map((l) => '\n    ' + l).join(''));
  if (r.total > r.hits.length) lines.push(r.total + ' records match; showing ' + r.hits.length + ' (--limit up to ' + HITS_MAX + ')');
  lines.push('Not shown: each record past its head and the lines that matched. askerdo show <id> prints the brief form, --full the whole record.');
  return cx.out(lines.join('\n') + '\n');
}

/* The browser this PC opens links in, detached so nothing waits on it. */
function openInBrowser(url) {
  const [cmd, args] = process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => {});
  child.unref();
}

/* a phone reaches no board that answers this PC alone */
const PHONE_HOST_ONLY = 'the board on this PC answers this PC alone (127.0.0.1), so no phone can reach it:'
  + ' askerdo board move <address> puts it on a Docker or Node server first';
const phoneNowhere = (url) => {
  let host = url;
  try { host = new URL(url).host; } catch {}
  return 'no address a phone can open: this PC reaches the board at ' + host + ', which no phone can,'
    + " and the board answers on none of this PC's network addresses; a phone signs in once the board is published on the network";
};

/* A link as a QR code's module rows, '1' dark, at error correction M or above; the drawings add the quiet zone. */
export function qrRows(text) {
  const qr = QrCode.encodeBinary([...Buffer.from(String(text), 'utf8')], QrCode.Ecc.MEDIUM);
  return Array.from({ length: qr.size }, (_, y) => Array.from({ length: qr.size }, (_, x) => (qr.getModule(x, y) ? '1' : '0')).join(''));
}

/* Two module rows to a line in half blocks, a quiet zone of four, black on white whatever
   the terminal's own colours, so a phone reads it on a dark terminal too. */
const ESC = String.fromCharCode(27);
export function qrText(rows, quiet = 4) {
  const n = rows.length + 2 * quiet;
  const dark = (x, y) => (rows[y - quiet] || '')[x - quiet] === '1';
  const lines = [];
  for (let y = 0; y < n; y += 2) {
    let line = '';
    for (let x = 0; x < n; x++) {
      const top = dark(x, y), low = y + 1 < n && dark(x, y + 1);
      line += top ? (low ? '█' : '▀') : (low ? '▄' : ' ');
    }
    lines.push(ESC + '[30;107m' + line + ESC + '[0m');
  }
  return lines.join('\n');
}

/* docs/guide/cli.md prints from these (scripts/build-cli-ref.mjs), so the page cannot drift from help */
export function helpEntries(who = 'the user') {
  return Object.keys(VERBS).map((verb) => ({
    verb, text: verbHelp(verb, who), noBoard: verb === 'help' || PC_ONLY.includes(verb) || NO_BOARD_TOO.includes(verb),
  }));
}

/* One CLI call: { argv, cwd, env, stdin, tty } in, { code, stdout, stderr } out,
   or { needStdin: true } when a command wants stdin the caller did not send.
   `stdin` is the text, a function that reads it, or absent; `near: false` skips
   knowledge new's close-to hint, which a bulk write never reads. */
export async function runCommand({ argv = [], cwd, env = {}, stdin, tty, near = true } = {}) {
  const cx = callContext({ cwd, env, stdin, tty, near });
  let code = 0;
  /* an id or flag copied from the desktop pane carries a word joiner (U+2060) after its hyphen */
  const JOIN = String.fromCharCode(0x2060);
  argv = argv.map((a) => (typeof a === 'string' && a.includes(JOIN) ? a.split(JOIN).join('') : a));
  try {
    await main(cx, argv);
  } catch (e) {
    if (e instanceof NeedStdin) return { needStdin: true };
    /* a library's own refusal class is bad input too, whichever module threw it */
    const usage = e instanceof UsageError || (e && e.constructor && e.constructor.name === 'UsageError');
    /* a refusal's commands name this launcher, as the kickoff's do, so a sandbox never reaches the live store */
    const here = launcherHere(env);
    const said = String((e && e.message) || e);
    cx.err('AskerDo: ' + (here ? said.split(CLI).join(here) : said) + '\n');
    /* the ladder's refusal carries its offer as data, so a tool words it in its own fields */
    if (e && e.data && Array.isArray(e.data.offers) && argv.includes('--json')) cx.out(JSON.stringify({ refused: said, offer: e.data.offer, offers: e.data.offers }, null, 2) + '\n');
    if (!usage) { try { appendLog(cx.root(), 'cli error: ' + ((e && e.stack) || e)); } catch {} }
    code = usage ? 1 : 2;
  }
  return { code: code || cx.exit || 0, ...cx.text() };
}

/* ---- who the local server can stand in for -------------------------------- */

/* The keys a caller sends per call; every other seam the libraries read for
   themselves, so a caller whose seams differ runs in its own process.
   RESTART_DETACHED is read by the server alone, never by a command. */
const PER_CALL = new Set(['ASKERDO_ROOT', 'ASKERDO_MOD', 'ASKERDO_RESTART_DETACHED']);
/* the mod's engine process mark, which every process the engine starts inherits and no command reads */
const NO_SEAM = new Set(['ASKERDO_PROC']);
const HOME_VAR = process.platform === 'win32' ? 'USERPROFILE' : 'HOME';

function seamsOf(env) {
  const out = { ASKERDO_SANDBOX_HOME: String(env.ASKERDO_SANDBOX_HOME ?? ''), [HOME_VAR]: String(env[HOME_VAR] ?? '') };
  for (const k of Object.keys(env)) if (/^ASKERDO_/.test(k) && !PER_CALL.has(k) && !NO_SEAM.has(k)) out[k] = String(env[k]);
  return out;
}

/* the names of the seams that differ, never their values, for the refusal's row */
function seamsDiffer(env, own) {
  const a = seamsOf(env);
  const b = seamsOf(own);
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => (a[k] ?? '') !== (b[k] ?? '')).sort();
}

const dirKey = (p) => {
  const d = resolve(String(p || '.')).replace(/\\/g, '/').replace(/\/+$/, '');
  return process.platform === 'win32' ? d.toLowerCase() : d;
};

/* Why this server cannot run a caller's command here, or null: the same store,
   home, data dir and seams, or the launcher runs it in the caller's process. */
export function callerProblem(env, { root, own }) {
  if (!env || typeof env !== 'object' || Array.isArray(env)) return 'the call carries no environment';
  const differ = seamsDiffer(env, own);
  if (differ.length) return "the caller's settings are not this server's (" + differ.join(', ') + (differ.length === 1 ? ' differs)' : ' differ)');
  if (seamRootProblem(env)) return 'the caller names a store root this server does not take';
  if (dirKey(storeRoot(undefined, env)) !== dirKey(root)) return 'the caller works on another store';
  if (dirKey(dataDir(env) || '') !== dirKey(dataDir(own) || '')) return 'the caller has another data dir';
  return null;
}

export { runsInCaller };

/* The local route's refusal (409), or null to run the call in the server. */
export function routeRefusal(body, { root, own, version }) {
  if (body.version !== version) return 'this local server runs ' + version + ' and the caller ' + (body.version || 'no version');
  return callerProblem(body.env, { root, own }) || runsInCaller(body.argv);
}
