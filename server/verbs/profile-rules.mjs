/* Profiles and the rules in force, the pure half (from lib/profiles.mjs):
   the settings, the chain a record resolves through, narrowest wins, and the
   rules block. No database here, so each PC's local server resolves the same
   way from its cache; server/verbs/profiles.mjs holds the verbs. */
import { UsageError } from './labels.mjs';
import { isKey } from '../records.mjs';

/* The working-rule line each value writes into the rules in force; the settings'
   examples read these same lines. */
const RULE_TEXT = {
  'tests.policy': {
    few: 'Few tests: one only for a failure someone would actually hit or a standing ruling, one per behaviour at the cheapest layer, extending an existing test first; never a test per item; report tests added and removed.',
    standard: 'Tests as the change needs, extending existing test files first.',
    off: 'Write no new tests.',
  },
  'tests.fullRun': {
    end: 'While working, run only the test files you touch; run the full suite once, at the end, before the last commit; take the starting count from the brief, never a before run.',
    merge: 'While working, run only the test files you touch; skip the full suite, it runs after the merge.',
    never: 'Run only the test files you touch; never the full suite.',
  },
  'tests.pinWording': { false: 'Never pin exact wording or bytes of output in a test; check the meaningful part.' },
  'dispatch.stateNote': { true: 'When the brief names a -state.md note, keep it current: done with commit hashes, next, and a CONTINUE: line (CONTINUE: none when the brief is done, else the next step).' },
  'dispatch.outputRule': { true: 'Final response under 2000 characters: outcomes, not process.' },
};

/* The settings, with the built-in defaults (the agent guard is off). Each one
   carries what the user reads: label, line, changes, an example whose
   {value} and the like are filled from the rows, and its TAKES_EFFECT family. */
export const SETTINGS = Object.freeze({
  'main.on': {
    kind: 'bool', def: true, label: 'Depth meter', takes: 'depth',
    line: 'The session watches how full its context is and says when to hand off.',
    changes: 'Turns on the meter in the band and its two notes, at the handoff window and at the wrap line. Off, the session never says when to hand off.',
    example: { kind: 'pair', a: ['Off', 'No meter and no notes: the session never says when to hand off.'], b: ['On', 'At the handoff window: "The user\'s {window} percent mark: pick the handoff boundary; running work continues."'] },
  },
  'main.window': {
    kind: 'percent', def: 30, label: 'Handoff window', takes: 'depth',
    line: 'How full the context gets before the session plans its handoff.',
    changes: 'The percent of the context window where the session starts looking for a clean point to hand off. Running work continues. It sits below the wrap line.',
    example: { kind: 'at', text: 'At {value}%: on a 200k context window the session starts planning its handoff near {k200} tokens; on a 1M window, near {k1m}.' },
  },
  'main.wrap': {
    kind: 'percent', def: 40, label: 'Wrap line', takes: 'depth',
    line: 'How full it gets before the session starts nothing new.',
    changes: 'The percent where the session finishes what is in flight, starts nothing new and writes its handoff. Nothing forces a cut but your word.',
    example: { kind: 'at', text: 'At {value}%: past {k200} tokens of a 200k window the session starts nothing new and hands off at its next clean point.' },
  },
  'agent.on': {
    kind: 'bool', def: false, label: 'Agent guard', takes: 'depth',
    line: 'Agents get a note to hand back when their context runs deep.',
    changes: "Watches every agent's context: a hand-off note past the soft limit, an urgent one past the hard floor. Off as built.",
    example: { kind: 'pair', a: ['Off', 'Agents run to the end of their context with no note.'], b: ['On', 'Past {soft}: "CONTEXT DEPTH, past the soft limit of {soft}", and the agent hands back.'] },
  },
  'agent.soft': {
    kind: 'tokens', def: 350000, label: 'Soft limit', takes: 'depth',
    line: 'Past this, an agent finishes its step and hands back.',
    changes: 'Where an agent hears it should finish the step in hand, write its state note and hand back. Briefs are sized by it too.',
    example: { kind: 'at', text: 'At {value}: an agent past {value} tokens of context gets the note: finish the step, write the state note, hand back.' },
  },
  'agent.hard': {
    kind: 'tokens', def: 450000, label: 'Hard floor', takes: 'depth',
    line: 'Past this, the note turns urgent and the agent stops.',
    changes: 'Where the note turns urgent: finish only the edit in hand, open nothing new. It sits above the soft limit.',
    example: { kind: 'at', text: 'At {value}: past {value} the note turns urgent: finish only the edit in hand and stop.' },
  },
  'agent.remind': {
    kind: 'tokens', def: 25000, label: 'Reminder step', takes: 'depth',
    line: 'How often the note repeats past the soft limit.',
    changes: 'After the first note, the note comes again every this many tokens until the hard floor.',
    example: { kind: 'at', text: 'At {value}: after the first note, it comes again every {value} tokens until the hard floor.' },
  },
  'agent.hardDeny': {
    kind: 'bool', def: false, label: 'Lock at the hard floor', takes: 'depth',
    line: 'Past the hard floor, the agent may write only its state note.',
    changes: "Refuses every tool past the hard floor but a write to the agent's state note, so it has to hand back.",
    example: { kind: 'pair', a: ['Off', 'Past the hard floor the note turns urgent; every tool still works.'], b: ['On', 'Past the hard floor every tool is refused but a write to the state note.'] },
  },
  /* the working rules; the built-in values are the built-in rules */
  'tests.policy': {
    kind: 'choice', values: ['few', 'standard', 'off'], def: 'few', rule: true, label: 'How many tests', takes: 'rules',
    line: 'How many tests a change gets: few, as needed, or none.',
    changes: 'Writes the matching line into the rules in force, which every session and agent reads.',
    choices: { few: 'few', standard: 'as needed', off: 'none' },
    example: { kind: 'values', values: RULE_TEXT['tests.policy'] },
  },
  'tests.fullRun': {
    kind: 'choice', values: ['end', 'merge', 'never'], def: 'end', rule: true, label: 'Full test suite', takes: 'rules',
    line: 'When the whole suite runs: at the end, after a merge, or never.',
    changes: 'Writes the matching line into the rules in force: when an agent runs the full suite, and what it runs while it works.',
    choices: { end: 'at the end', merge: 'after a merge', never: 'never' },
    example: { kind: 'values', values: RULE_TEXT['tests.fullRun'] },
  },
  'tests.pinWording': {
    kind: 'bool', def: false, rule: true, label: 'Exact wording in tests', takes: 'rules',
    line: 'Whether a test may check exact words or bytes of output.',
    changes: 'Off writes the rule that a test checks the meaningful part, never exact words. On, there is no such line.',
    example: { kind: 'pair', a: ['Off', RULE_TEXT['tests.pinWording'].false], b: ['On', 'No line: a test may check exact words.'] },
  },
  'dispatch.stateNote': {
    kind: 'bool', def: true, rule: true, label: 'State notes', takes: 'rules',
    line: 'Each agent keeps a note of what is done and what is next.',
    changes: 'Adds the rule that an agent keeps the state note its brief names current: done with commit hashes, next, and a CONTINUE line.',
    example: { kind: 'pair', a: ['Off', 'No line about state notes.'], b: ['On', RULE_TEXT['dispatch.stateNote'].true] },
  },
  'dispatch.outputRule': {
    kind: 'bool', def: true, rule: true, label: 'Short reports', takes: 'rules',
    line: "Each agent's final report stays under 2000 characters.",
    changes: "Adds the rule that an agent's final report stays short: outcomes, not process.",
    example: { kind: 'pair', a: ['Off', 'No line about report size.'], b: ['On', RULE_TEXT['dispatch.outputRule'].true] },
  },
  'dispatch.inject': {
    kind: 'bool', def: true, rule: true, label: 'Rules ride every brief', takes: 'rules',
    line: 'The rules in force go with every agent you dispatch.',
    changes: "Appends the rules in force to each agent's prompt as it starts. A workflow's prompt is fixed and goes as written.",
    example: { kind: 'pair', a: ['Off', 'Briefs go out as written; the rules reach the session alone.'], b: ['On', 'Every brief ends with the rules in force for agents.'] },
  },
  'rules.add': {
    kind: 'lines', def: [], rule: true, list: true, label: 'Rule lines', takes: 'rules',
    line: 'Working rules of your own, one line each, for sessions, agents or both.',
    changes: 'Each line rides the rules in force wherever its profile reaches: the session alone, its agents alone, or both.',
    example: { kind: 'text', text: 'few-tests, for agents: Few tests: one only for a failure someone would actually hit or a standing ruling.' },
  },
  'rules.drop': {
    kind: 'slugs', def: [], rule: true, list: true, label: 'Dropped lines', takes: 'rules',
    line: 'A built-in or wider line you switch off here and below.',
    changes: 'Switches a line off by its name at this layer and every narrower one; the line comes back when you drop the drop.',
    example: { kind: 'text', text: 'Drop opus-workers on a track, and its agents no longer hear the built-in line about Opus workers.' },
  },
  /* review coverage, read by the board wherever it totals a track's code */
  'review.depth': {
    kind: 'choice', values: ['off', 'light', 'full'], def: 'light', label: 'Review coverage', takes: 'review',
    line: 'How closely the board tracks which finished code a review has read.',
    changes: "Off computes and shows nothing. Light nudges on the band and the Tracks tab once a track's unreviewed code tasks reach the review size. Full also reopens a completed review when work it read changes, so what waits on it waits again, and holds a track's finish until a review covers its finished code.",
    choices: { off: 'off', light: 'a nudge', full: 'nudge and gates' },
    example: { kind: 'values', values: {
      off: 'Nothing about reviews on the band, the Tracks tab or a kickoff.',
      light: 'Five code tasks on TR-4 since its last review: the band shows review due and the Tracks tab marks the track.',
      full: 'T-12 gains a commit after its review T-14 completed: T-14 reopens and the tasks after it wait again; TR-4 finishes only once a review covers its code, or with a waiver.',
    } },
  },
  'review.tasks': {
    kind: 'count', def: 5, label: 'Review size', takes: 'review',
    line: 'How many unreviewed code tasks on a track make a review due.',
    changes: 'Once this many finished code tasks on a track wait for a review, a review reads as due.',
    example: { kind: 'at', text: 'At {value}: once {value} finished code tasks on a track wait for a review, a review is due.' },
  },
  'review.ignore': {
    kind: 'texts', def: [], label: 'Not counted', takes: 'review',
    line: 'Files a review never needs to read, as globs.',
    changes: 'A commit that changes only these files counts as no code, so its task needs no review. Lockfiles, generated files, docs and Markdown are never counted.',
    example: { kind: 'text', text: 'build/generated/** and schema/*.gen.ts: a commit that only regenerates these needs no review.' },
  },
  /* a board user's options (config.json less the board keys and the queue,
     which the join sets per PC), read from the profiles held on default */
  ...contractFamily(),
});
/* the depth settings the markers carry; ALL_KEYS resolves every scalar setting of a record */
export const KEYS = Object.keys(SETTINGS).filter((k) => SETTINGS[k].takes === 'depth');
const ALL_KEYS = Object.keys(SETTINGS).filter((k) => !SETTINGS[k].list && !SETTINGS[k].contract);

function contractFamily() {
  const out = {
    'contract.weather': {
      kind: 'bool', def: true, label: 'Weather icon', takes: 'reply',
      line: 'Line one says how the work is going: on plan, minor bumps or off plan.',
      changes: 'Adds a second icon to line one: ☀️ on plan, 🌤️ minor bumps handled without you, ⛈️ off plan and worth a look. Off, line one keeps its other icons.',
      example: { kind: 'pair', a: ['Off', '🚀 🙋 Started the build in the background. One answer below.'], b: ['On', '🚀 ☀️ 🙋 Started the build in the background. One answer below.'] },
    },
    'contract.forecast': {
      kind: 'bool', def: true, label: 'Forecast icon', takes: 'reply',
      line: 'Line one says whether you are needed: walk away, soon, or now.',
      changes: 'Adds the icon that says whether you are needed, and the footer always agrees with it: 🟢 walk away, 🔜 soon, 🙋 now, 🏁 finished. Off, the footer keeps its plain words.',
      example: { kind: 'pair', a: ['Off', '✅ ☀️ Tests pass and the fix is committed.\nNext up: the release notes.'], b: ['On', '✅ ☀️ 🟢 Tests pass and the fix is committed.\n🟢 Next up: the release notes.'] },
    },
    'contract.tasks': {
      kind: 'bool', def: true, label: 'Progress lists', takes: 'reply',
      line: 'Long jobs report as a list led by done, running and failed icons.',
      changes: 'A job of three or more steps reports as a list led by ✅ done, ⏳ running and ❌ failed, with small bars for a trend. Off, plain counts.',
      example: { kind: 'pair', a: ['Off', '2 of 4 lanes done.'], b: ['On', '✅ settings verb\n✅ the mock\n⏳ the pane tab\n⏳ the board page'] },
    },
    'contract.docs': {
      kind: 'bool', def: true, label: 'Capability docs', takes: 'reply',
      line: 'Replies use only what your surface can really draw.',
      changes: "Points the contract at the plugin's two measured docs on what the desktop app and the terminal draw. Off, the contract stands alone and depends on no other file.",
      example: { kind: 'pair', a: ['Off', 'A reply guesses what the app can draw.'], b: ['On', 'A reply draws only what the measured docs say the surface shows.'] },
    },
    'contract.fold': {
      kind: 'bool', def: true, label: 'The fold', takes: 'reply',
      line: 'Long replies put what you must read first, the detail below a line.',
      changes: 'Keeps the fold rule and the fixed order of a wrap-up: line one, counts, what changed, checks, the fold and its detail, then the footer. Off, the order is free.',
      example: { kind: 'pair', a: ['Off', 'Done, files, logs and the next step, in any order.'], b: ['On', 'Done and tests first; files and logs under the fold; the footer last.'] },
    },
    'contract.decision': {
      kind: 'bool', def: true, label: 'Decision tables', takes: 'reply',
      line: 'A question with options comes as a small table with a token to answer.',
      changes: 'Each option gets a row: what it gets you, what it costs, and a short token you answer with. Off, the options come as prose.',
      example: { kind: 'pair', a: ['Off', 'Either put the tab first, near Home, or last, keeping the order.'], b: ['On', 'a  first  near Home\nb  last  keeps the order\nAnswer with a or b.'] },
    },
    'contract.diff': {
      kind: 'bool', def: true, label: 'Diff blocks', takes: 'reply',
      line: 'Code changes show as a diff, with red and green lines.',
      changes: 'Code changes come in a diff block, and a readout may borrow one only when a red line must catch the eye. Off, code blocks still name their language.',
      example: { kind: 'pair', a: ['Off', 'Changed the handoff window from 30 to 25.'], b: ['On', '-  main.window: 30\n+  main.window: 25'] },
    },
    'contract.emdash': {
      kind: 'bool', def: true, label: 'Dash ban', takes: 'reply',
      line: 'Claude writes no em or en dashes, anywhere.',
      changes: 'Bans em and en dashes in replies, code, docs, commits and issues. Off, the contract says nothing about them.',
      example: { kind: 'pair', a: ['Off', 'Long dashes may join two clauses.'], b: ['On', 'Clauses join with a colon, a comma or a new sentence.'] },
    },
    'contract.visual': {
      kind: 'bool', def: true, label: 'Diagrams and charts', takes: 'reply',
      line: 'Structures come as diagrams and comparisons as charts.',
      changes: 'Flows, states and architectures render as inline diagrams, and comparisons as real charts, where the surface draws them. Off, replies stay text.',
      example: { kind: 'pair', a: ['Off', 'The save goes to the board, then the PC copy, then the sync.'], b: ['On', 'An inline diagram: board, then PC copy, then sync, with the arrows drawn.'] },
    },
    'contract.interactive': {
      kind: 'bool', def: true, label: 'Widgets and forms', takes: 'reply',
      line: 'Sliders, forms and option buttons where they beat plain text.',
      changes: 'Live controls for teaching, clickable forms for structured input, and buttons for decisions rich enough to want icons. Off, every exchange is plain text.',
      example: { kind: 'pair', a: ['Off', 'Pick a width: 238, 438, 900 or 1400.'], b: ['On', 'Four buttons in the reply; press one to pick.'] },
    },
    'contract.ids': {
      kind: 'bool', def: true, label: 'Numbers carry names', takes: 'reply',
      line: 'A question, task or issue number always comes with its short name.',
      changes: 'A number never appears bare: every mention carries its short name, with a plain gloss the first time, so you never scroll back to decode it. Off, a one-line baseline stays.',
      example: { kind: 'pair', a: ['Off', 'Fixed #212.'], b: ['On', 'Fixed #212 (fold head cuts a long title).'] },
    },
    'contract.dlg': {
      kind: 'choice', values: ['blockers', 'free', 'ban'], def: 'blockers', label: 'Pop-up questions', takes: 'reply',
      line: 'When Claude may ask through the pop-up question dialog.',
      changes: 'Sets when the AskUserQuestion pop-up may appear: only for a blocking decision, whenever a small set of options fits, or never. A hook enforces a ban live.',
      choices: { blockers: 'blockers only', free: 'allow freely', ban: 'banned' },
      example: { kind: 'values', values: { blockers: 'The pop-up opens only for a decision that stops the work.', free: 'The pop-up may open whenever a small set of options fits.', ban: 'Never: a hook refuses the pop-up, and questions come in the reply.' } },
    },
    'contract.custom': {
      kind: 'texts', def: [], label: 'Your own rules', takes: 'reply',
      line: 'Rules of your own, added to the contract word for word.',
      changes: 'Each line joins the numbered rules as a rule of yours, kept word for word; plugin updates never touch them. On a board your own rules are rule lines, so every PC carries them.',
      example: { kind: 'text', text: 'Each line joins the numbered rules as your own, for example: Name the branch in every commit report.' },
    },
    'contract.alias': {
      kind: 'text', def: '', max: 16, pattern: /^([a-z0-9][a-z0-9-]*)?$/, label: 'Command alias', takes: 'alias',
      line: 'A second, shorter name for /askerdo, such as /ad.',
      changes: 'The mod registers the word as a second name doing exactly what /askerdo does: lowercase letters, digits and hyphens, at most 16. Empty means none. Not part of the contract.',
      example: { kind: 'text', text: 'At {value}: /{value} 2b answers as /askerdo 2b does, and /{value} home opens Home.', sample: 'ad' },
    },
  };
  for (const v of Object.values(out)) v.contract = true;
  return out;
}

/* The two the /askerdo guard shortcut uses; never edited or stored. */
export const BUILTIN = Object.freeze({
  'guard-on': { description: 'the subagent depth guard on, at the limits in force', settings: { 'agent.on': true } },
  'guard-off': { description: 'the subagent depth guard off', settings: { 'agent.on': false } },
});

/* Widest first. A track holds tasks, so it sits between the workstream and the task. */
export const LEVELS = Object.freeze(['default', 'project', 'workstream', 'track', 'task']);
export const KIND_LEVEL = Object.freeze({ workstream: 'workstream', task: 'task', track: 'track' });
/* an old P-n or TH-n resolves to the track it became */
const PREFIX_WORD = { WS: 'workstream', P: 'plan', T: 'task', TH: 'thread', TR: 'track' };

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

export function checkName(name) {
  const s = String(name ?? '').trim();
  if (!NAME_RE.test(s)) throw new UsageError('a profile name is lowercase letters, digits and dashes, at most 40: ' + name);
  return s;
}

/* the settings that live in this PC's config.json alone, never on a profile;
   the join sets the board pair, and a board PC's queue is hub. */
export const PC_SETTINGS = Object.freeze({
  queue: {
    kind: 'choice', values: ['hub', 'text', 'off'], def: 'text', pc: true, label: 'Question queue', takes: 'reply',
    line: 'Where open questions wait: the board, a file per project, or nowhere.',
    changes: 'A question is asked in full once; one still open waits in the queue, and later replies carry a linked names line instead of asking again.',
    choices: { hub: 'the board', text: 'file per project', off: 'off' },
    example: { kind: 'values', values: { hub: 'Questions register on the board as they are asked; an answer on a board card reaches the session at its next prompt.', text: 'A question that outlives its message waits in a file in the project; replies link it and you type the answer.', off: 'No queue: every reply restates everything still open, with how long it has waited.' } },
  },
  boardUrl: {
    kind: 'text', def: '', max: 2048, pc: true, label: 'Board link', takes: 'join',
    line: 'The board this PC is joined to.',
    changes: "Where this PC's local server reaches your board. The join sets it.",
    example: { kind: 'text', text: 'http://<server>:17480 for the Unraid install.' },
  },
  boardToken: {
    kind: 'secret', def: '', max: 512, pc: true, label: 'Board token', takes: 'join',
    line: "This PC's key to the board, never shown.",
    changes: "This PC's own device token. The join sets it, and it never leaves this PC's config.json.",
    example: { kind: 'text', text: 'Shown only as set or not set.' },
  },
  /* only a PC hosting the board (board here) makes copies */
  boardBackups: {
    kind: 'text', def: '', max: 1024, pc: true, label: 'Board backups folder', takes: 'backups',
    line: 'Where the board on this PC keeps its daily copies.',
    changes: 'The first session start of each day copies the board here and keeps the newest 30. Empty keeps them beside the database; a folder in OneDrive, Dropbox or on a NAS share keeps them off this PC.',
    example: { kind: 'text', text: 'C:/Users/you/OneDrive/AskerDo backups' },
  },
  /* a Docker board configure set up on this PC gets the same daily copy */
  boardContainer: {
    kind: 'text', def: '', max: 128, pc: true, label: 'Docker board container', takes: 'backups',
    line: 'The Docker container of a board on this PC, which it backs up daily.',
    changes: "The first session start of each day runs the board's own backup inside this container, into its backups volume, keeping the newest 30. Configure sets it when it starts a Docker board here; empty backs up no container.",
    example: { kind: 'text', text: 'askerdo' },
  },
  /* a card press confirms under the pressed option, or records at once as it always did */
  answerPresses: {
    kind: 'choice', values: ['confirm', 'once'], def: 'confirm', pc: true, label: 'Answer presses', takes: 'presses',
    line: 'Whether pressing an option on a question card asks first or answers at once.',
    changes: "Confirm opens a strip under the pressed option with your note, Answer now, Queue answer and Cancel; a queued answer stays off the board until Send. At once records the press straight away, as the band's chips always do.",
    choices: { confirm: 'confirm first', once: 'at once' },
    example: { kind: 'values', values: { confirm: 'Press b: the strip opens under b; Answer now records it, Queue answer keeps it on this PC until Send.', once: 'Press b: 12b is recorded and the asking session hears it at once.' } },
  },
  /* configure asks once; on and off also set the app's own switch */
  pluginUpdates: {
    kind: 'choice', values: ['ask', 'on', 'off'], def: 'ask', pc: true, label: 'Plugin auto-update', takes: 'updates',
    line: 'Whether the Claude app updates AskerDo on its own when a new version is out.',
    changes: "On turns on the app's auto-update for the AskerDo marketplace, the switch /plugin shows under Marketplaces, and off turns it off. Ask means configure has not asked yet, and leaves the switch as it is.",
    choices: { ask: 'not asked yet', on: 'on', off: 'off' },
    example: { kind: 'values', values: { ask: '/askerdo:configure offers it once.', on: 'A new AskerDo installs itself as a session starts; the session after that runs it.', off: 'A new AskerDo waits until you update the plugin yourself.' } },
  },
});
/* when a saved value takes effect, by the settings' `takes` family; replyPc is a reply option with no board */
export const TAKES_EFFECT = Object.freeze({
  reply: 'Your next session, or this one after /clear: the save rewrites the output style at once, and Claude reads it as a session starts. Your other PCs take it at their next session start.',
  replyPc: 'Your next session, or this one after /clear: the save rewrites the output style at once, and Claude reads it as a session starts.',
  /* a board page save runs no PC's sync */
  replyBoard: 'Each PC at its next session start, a /clear included: the PC takes it from the board and rewrites its output style, and Claude reads it as the session starts.',
  alias: 'Your next session, or this one after /clear: the mod registers the name as a session starts.',
  review: "At once, on any PC: the board reads it each time it totals a track's code.",
  depth: 'Within seconds in every open session: each one reads the board again when a profile changes, and again before every agent it dispatches.',
  rules: 'From your next prompt in every open session, and in every agent dispatched after it.',
  join: 'Set when this PC joins a board; /askerdo:configure joins or rejoins.',
  backups: 'The next copy: askerdo backup, or the first session start of the next day.',
  presses: "This session's cards at once when saved from its Settings tab; other open sessions at their next start.",
  updates: "The app's switch at once; the app looks for a new AskerDo as each session starts.",
});
/* settings that are gone; a stored value is ignored, a new set refused in these words */
export const RETIRED = Object.freeze({ 'contract.name': 'The name setting is retired: the contract always says "the user" (contract.name)' });
const retired = (key) => { if (Object.hasOwn(RETIRED, key)) throw new UsageError(RETIRED[key]); };
const specOf = (key) => (Object.hasOwn(SETTINGS, key) ? SETTINGS[key] : Object.hasOwn(PC_SETTINGS, key) ? PC_SETTINGS[key] : null);

/* One setting's value from the CLI's words; 350k and 350000 are the same. */
export function parseValue(key, raw) {
  retired(key);
  const spec = Object.hasOwn(SETTINGS, key) ? SETTINGS[key] : null;
  if (!spec) throw new UsageError('unknown setting ' + key + ' (one of ' + Object.keys(SETTINGS).join(', ') + ')');
  return wordsValue(key, spec, raw);
}

/* a refusal says it in the setting's own words first, the key after it for CLI users. */
const refuse = (key, spec, rule, raw) => new UsageError(spec.label + ' ' + rule + (raw === undefined ? '' : ': ' + raw) + ' (' + key + ')');

function wordsValue(key, spec, raw) {
  if (spec.list) throw refuse(key, spec, 'are set with profile rule-add, rule-drop and rule-clear');
  if (spec.kind === 'text' || spec.kind === 'secret') {
    const t = String(raw ?? '').trim();
    if (/[\r\n]/.test(t) || t.length > spec.max || (spec.pattern && !spec.pattern.test(t))) {
      throw refuse(key, spec, 'is one line of at most ' + spec.max + ' characters' + (spec.pattern ? ', lowercase letters, digits and hyphens' : ''), raw);
    }
    return t;
  }
  if (spec.kind === 'texts') {
    let v;
    try { v = JSON.parse(String(raw ?? '').trim() || '[]'); } catch { v = null; }
    if (!Array.isArray(v) || v.some((x) => typeof x !== 'string') || JSON.stringify(v).length > 64 * 1024) {
      throw refuse(key, spec, 'is a JSON list of strings, at most 64 KB', raw);
    }
    return v;
  }
  const s = String(raw ?? '').trim().toLowerCase();
  if (spec.kind === 'choice') {
    if (spec.values.includes(s)) return s;
    throw refuse(key, spec, 'is one of ' + spec.values.join(', '), raw);
  }
  if (spec.kind === 'bool') {
    if (['true', 'on', 'yes'].includes(s)) return true;
    if (['false', 'off', 'no'].includes(s)) return false;
    throw refuse(key, spec, 'is on or off', raw);
  }
  const m = /^(\d{1,7})(k?)$/.exec(s);
  const n = m ? Number(m[1]) * (m[2] ? 1000 : 1) : NaN;
  if (spec.kind === 'percent') {
    if (!m || m[2] || n < 1 || n > 99) throw refuse(key, spec, 'is a whole percent from 1 to 99', raw);
    return n;
  }
  if (spec.kind === 'count') {
    if (!m || m[2] || n < 1 || n > 1000) throw refuse(key, spec, 'is a whole number from 1 to 1000', raw);
    return n;
  }
  if (!m || n < 1000 || n > 2000000) throw refuse(key, spec, 'is a token count from 1k to 2000k', raw);
  return n;
}

/* the one check every surface runs. `value` is typed, as JSON carries it, or
   the CLI's words (any string); `neighbours` are the values it must sit beside for
   checkPairs. Returns the stored value or throws a UsageError. */
export function checkSetting(key, value, neighbours = {}) {
  retired(key);
  const spec = specOf(key);
  if (!spec) throw new UsageError('unknown setting ' + key + ' (one of ' + Object.keys(SETTINGS).concat(Object.keys(PC_SETTINGS)).join(', ') + ')');
  let words = value;
  if (typeof value !== 'string') {
    const k = spec.kind;
    const fits = k === 'bool' ? typeof value === 'boolean' : k === 'percent' || k === 'tokens' || k === 'count' ? Number.isInteger(value) : k === 'texts' ? Array.isArray(value) : false;
    if (!fits) throw refuse(key, spec, 'takes ' + kindWords(spec), JSON.stringify(value));
    words = k === 'bool' ? (value ? 'on' : 'off') : k === 'texts' ? JSON.stringify(value) : String(value);
  }
  const v = wordsValue(key, spec, words);
  checkPairs({ ...neighbours, [key]: v }, key);
  return v;
}

const kindWords = (spec) => ({
  bool: 'on or off', percent: 'a whole percent from 1 to 99', tokens: 'a token count from 1k to 2000k', count: 'a whole number from 1 to 1000', choice: 'one of ' + (spec.values || []).join(', '),
  texts: 'a list of strings', lines: 'rule lines', slugs: 'rule slugs',
})[spec.kind] || 'one line of text';

/* Pairs inside one profile that cannot both hold. */
export function checkPairs(settings, what) {
  const s = settings;
  if (s['main.window'] !== undefined && s['main.wrap'] !== undefined && s['main.window'] >= s['main.wrap']) {
    const say = what === 'main.window' ? 'The handoff window must sit below the wrap line' : 'The wrap line must sit above the handoff window';
    throw new UsageError(say + ' (' + what + ': main.window must be below main.wrap)');
  }
  if (s['agent.soft'] !== undefined && s['agent.hard'] !== undefined && s['agent.soft'] >= s['agent.hard']) {
    const say = what === 'agent.soft' ? 'The soft limit must sit below the hard floor' : 'The hard floor must sit above the soft limit';
    throw new UsageError(say + ' (' + what + ': agent.soft must be below agent.hard)');
  }
}

export function normProjectDir(v) {
  const dir = String(v ?? '').trim().replace(/\\/g, '/').replace(/(.)\/+$/, '$1');
  if (/^[A-Za-z]:\//.test(dir) || dir.startsWith('/')) return dir;
  throw new UsageError('a project is an absolute directory: ' + v);
}
export const sameDir = (a, b) => String(a).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() === String(b).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

/* a project with a git remote is held under that remote; the
   board cannot read a checkout, so the caller names the remote, or a remote
   entry already listing the dir supplies it. */
export const REPO_KEY = 'repo:';
export const isRepoKey = (k) => String(k).startsWith(REPO_KEY);
export const isDirKey = (k) => !isRepoKey(k) && String(k).includes('/');

export const noSub = () => ({ add: [], drop: [] });
const listOf = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x) : []);
/* A work record's own holding, from its fields. */
export const heldOf = (front) => ({ add: listOf(front && front.profiles), drop: listOf(front && front.profileDrops) });

/* Two holdings as one; where they disagree on a name, `over` wins. */
export function mergeSub(under, over) {
  const add = new Set([...over.add, ...under.add.filter((n) => !over.drop.includes(n))]);
  const drop = new Set([...over.drop, ...under.drop.filter((n) => !over.add.includes(n))]);
  return { add: [...add], drop: [...drop] };
}

/* The caller's project map (dir to remote, each PC's own): the remote of a
   project dir the chain reaches through a record's links or workstream. */
export function remoteOf(repos, dir) {
  for (const [d, r] of Object.entries(repos || {})) if (r && sameDir(d, dir)) return r;
  return '';
}

export function projectKeys(data, dir, repo) {
  let r = repo || '';
  if (!r) {
    for (const [k, v] of Object.entries(data.subscriptions)) {
      if (isRepoKey(k) && (v.dirs || []).some((d) => sameDir(d, dir))) { r = k.slice(REPO_KEY.length); break; }
    }
  }
  const dirs = Object.keys(data.subscriptions).filter((k) => isDirKey(k) && sameDir(k, dir));
  const own = dirs[0];
  return { repo: r, dirs, key: r ? REPO_KEY + r : own || dir, shown: own || dir };
}

export function projectSub(data, dir, repo) {
  const { repo: r, dirs, key } = projectKeys(data, dir, repo);
  let sub = noSub();
  for (const k of dirs) sub = mergeSub(sub, data.subscriptions[k]);
  return r && data.subscriptions[key] ? mergeSub(sub, data.subscriptions[key]) : sub;
}

export function profileOf(data, name) {
  if (BUILTIN[name]) return BUILTIN[name];
  return data.profiles[name] || null;
}
export const settingsOf = (p) => (p && p.settings && typeof p.settings === 'object' ? p.settings : {});

/* A record word: default, a WS-n, T-n or TR-n label (an old P-n or TH-n too) or a
   key, or an absolute project dir. `lookup(ref)` gives { key, kind, label, fields } or null. */
export function parseRecordWith(lookup, raw) {
  const s = String(raw ?? '').trim();
  if (!s) throw new UsageError('a record is default, a WS-n, T-n or TR-n id, or a project directory');
  if (s.toLowerCase() === 'default') return { level: 'default', key: 'default' };
  if (/^k-\d+$/i.test(s)) throw new UsageError(s.toUpperCase() + ' is a knowledge record; profiles go on default, a project, WS-n, T-n or TR-n');
  const label = /^(ws|p|t|th|tr)-\d+$/i.test(s) ? s.toUpperCase() : null;
  if (label || isKey(s)) {
    const row = lookup(s);
    if (row && KIND_LEVEL[row.kind]) return { level: KIND_LEVEL[row.kind], key: row.label, ref: row.key, row };
    if (label) throw new UsageError('unknown ' + PREFIX_WORD[label.split('-')[0]] + ' id: ' + label);
    throw new UsageError(s + ' names no workstream, task or track');
  }
  return { level: 'project', key: normProjectDir(s) };
}

const dirOf = (v) => { try { return normProjectDir(v); } catch { return null; } };

/* The chain a record resolves through, widest first. A task fills in its track
   (`onTrack`) and its workstream, a track its workstream; the project is
   `project`, else the workstream's first. */
export function chainOver(lookup, rec, { project, repo, repos } = {}) {
  const at = { default: { key: 'default' } };
  const put = (level, row) => { if (!at[level]) at[level] = { key: row.label, ref: row.key, row }; };
  const follow = (ref, level) => {
    if (!ref || at[level]) return;
    const r = lookup(ref);
    if (r && KIND_LEVEL[r.kind] === level) put(level, r);
  };
  if (rec.level === 'project') at.project = { key: rec.key, repo: rec.repo || '' };
  else if (rec.level !== 'default') {
    at[rec.level] = { key: rec.key, ref: rec.ref || rec.key, row: rec.row || null };
    if (at.task && at.task.row) {
      follow(at.task.row.onTrack, 'track');
      follow(at.task.row.fields.workstream, 'workstream');
    }
    if (at.track && at.track.row) follow(at.track.row.fields.workstream, 'workstream');
    if (!at.project && at.workstream && at.workstream.row) {
      const w = at.workstream.row.fields;
      /* its first project by shared name; a name with no remote is its folder */
      const name = listOf(w.projectRepos)[0];
      const remote = !!name && !/^([A-Za-z]:)?\//.test(name);
      const d = remote ? name : dirOf(name || listOf(w.projects)[0] || '');
      if (d) at.project = { key: d, repo: remote ? name : '' };
    }
  }
  if (project) at.project = { key: normProjectDir(project), repo: repo || '' };
  return LEVELS.filter((l) => at[l]).map((level) => {
    const a = at[level];
    const c = { level, key: a.key, ref: a.ref || a.key };
    if (level === 'project' && (a.repo || remoteOf(repos, a.key))) c.repo = a.repo || remoteOf(repos, a.key);
    if (KIND_LEVEL[level] && a.row) c.held = heldOf(a.row.fields);
    return c;
  });
}

/* What one chain level holds: a work record its own lines, a project by remote or dir. */
export function subAt(data, c) {
  if (c.level === 'project') return projectSub(data, c.key, c.repo);
  if (c.level === 'default') return data.subscriptions.default || noSub();
  return c.held || noSub();
}

/* Each level's profiles in force: its own, less any a narrower level dropped. */
export function activeAt(data, chain) {
  const dropped = new Set();
  const out = [];
  for (let i = chain.length - 1; i >= 0; i--) {
    const sub = subAt(data, chain[i]);
    out[i] = sub.add.filter((n) => !dropped.has(n)).sort();
    for (const n of sub.drop) dropped.add(n);
  }
  return out;
}

/* Per setting: the narrowest record whose profiles set it, else the built-in. */
export function resolveChain(data, chain) {
  const active = activeAt(data, chain);
  const settings = {};
  for (const key of ALL_KEYS) {
    settings[key] = { value: SETTINGS[key].def, profile: null, record: null, level: 'built-in' };
    for (let i = chain.length - 1; i >= 0; i--) {
      const name = active[i].find((n) => settingsOf(profileOf(data, n))[key] !== undefined);
      if (name) {
        settings[key] = { value: settingsOf(profileOf(data, name))[key], profile: name, record: chain[i].key, level: chain[i].level };
        break;
      }
    }
  }
  return { chain, settings, lines: linesOf(data, chain, active) };
}

/* Where a holding lives, with one board serving every machine: on its record,
   on the board (the default), by a project's remote, or at one directory. */
export function travelsOf(level, repo) {
  if (KIND_LEVEL[level]) return 'record';
  if (level === 'default') return 'board';
  return repo ? 'remote' : 'here';
}

export function travelText(h) {
  if (h.travels === 'record') return 'travels with the record';
  if (h.travels === 'board') return 'held on the board for every machine';
  if (h.travels === 'remote') return 'travels by its remote ' + h.repo;
  return 'only at this directory';
}

/* The chain's levels that hold or drop a profile, and where each holding lives. */
export function heldIn(data, chain) {
  const out = [];
  for (const c of chain) {
    const sub = subAt(data, c);
    if (!sub.add.length && !sub.drop.length) continue;
    const repo = c.level === 'project' ? projectKeys(data, c.key, c.repo).repo : '';
    const h = { record: c.key, level: c.level, profiles: sub.add, drops: sub.drop, travels: travelsOf(c.level, repo) };
    if (repo) h.repo = repo;
    out.push({ ...h, note: travelText(h) });
  }
  return out;
}

/* Flat values, for the marker and the mod. */
export function valuesOf(eff) {
  const v = {};
  for (const k of KEYS) v[k] = eff.settings[k].value;
  if (v['main.window'] >= v['main.wrap']) v['main.wrap'] = Math.min(99, v['main.window'] + 1);
  if (v['agent.soft'] >= v['agent.hard']) v['agent.hard'] = v['agent.soft'] + 1000;
  return v;
}

/* The keys two profiles on one record both set (refused at subscribe time). */
export function clashes(data, names) {
  const seen = {};
  const out = [];
  for (const n of names) {
    /* rule lines add up across profiles and retired keys are ignored, so neither clashes */
    for (const k of Object.keys(settingsOf(profileOf(data, n))).filter((x) => SETTINGS[x] && !SETTINGS[x].list)) {
      if (seen[k] && seen[k] !== n) out.push(k + ' (' + seen[k] + ' and ' + n + ')');
      else seen[k] = n;
    }
  }
  return out;
}

const KIND_ORDER = (label) => ['WS', 'P', 'T', 'TH', 'TR'].indexOf(String(label).split('-')[0]);
export const byLabel = (a, b) => KIND_ORDER(a) - KIND_ORDER(b) || String(a).localeCompare(String(b), 'en', { numeric: true });

/* ---- words -------------------------------------------------------------- */

const fmt = (key, v) => {
  const kind = SETTINGS[key].kind;
  if (kind === 'tokens') return Math.floor(v / 1000) + 'k';
  if (kind === 'bool') return v ? 'on' : 'off';
  if (kind === 'choice') return String(v);
  if (kind === 'text') return JSON.stringify(v);
  if (kind === 'texts') return (Array.isArray(v) ? v.length : 0) + ' rules';
  if (kind === 'lines' || kind === 'slugs') return (Array.isArray(v) ? v : []).map((x) => (x && x.slug) || x).join(' ') || 'none';
  return v + ' percent';
};

export function effectiveText(eff) {
  const lines = ['Effective settings for ' + eff.record + ' (' + eff.chain.map((c) => c.key).join(' < ') + '):'];
  for (const k of ALL_KEYS) {
    const s = eff.settings[k];
    lines.push('  ' + k.padEnd(20) + fmt(k, s.value).padEnd(12) + (s.profile ? s.profile + ' on ' + s.record : 'built-in'));
  }
  for (const h of eff.held || []) lines.push('  ' + h.record + ' holds ' + (h.profiles.join(', ') || 'none') + (h.drops.length ? ', drops ' + h.drops.join(', ') : '') + ': ' + h.note);
  return lines.join('\n');
}

/* the settings list as text, by family, one line per setting: key, value,
   where it comes from, and the values it takes (or why it is read only). */
const rowValue = (r) => (r.kind === 'tokens' ? Math.floor(r.value / 1000) + 'k' : r.kind === 'bool' ? (r.value ? 'on' : 'off')
  : r.kind === 'percent' ? r.value + ' percent' : r.kind === 'text' ? JSON.stringify(r.value)
    : r.kind === 'texts' ? (Array.isArray(r.value) ? r.value.length : 0) + (r.key === 'review.ignore' ? ' globs' : ' rules') : String(r.value));
const rowFrom = (r) => (r.layer === 'built-in' ? 'built in' : r.layer === 'pc' ? 'this PC'
  : (r.layer === 'default' ? 'default' : r.layer + ' ' + r.record) + (r.profile ? ' (' + r.profile + ')' : ''));
const rowTakes = (r) => (r.values ? r.values.join(', ') : r.kind === 'bool' ? 'on, off' : r.kind === 'percent' ? '1 to 99'
  : r.kind === 'tokens' ? '1k to 2000k' : r.kind === 'count' ? '1 to 1000' : r.kind === 'text' ? 'one line, at most ' + r.max : r.kind === 'texts' ? 'a JSON list of strings' : '');

export function settingsListText(r) {
  const lines = [r.board ? 'Settings for ' + r.record + ' (' + r.chain.map((c) => c.key).join(' < ') + '):' : 'Settings on this PC (no board):'];
  for (const family of FAMILIES) {
    const rows = r.rows.filter((x) => x.family === family);
    if (!rows.length) continue;
    lines.push(family);
    for (const x of rows) {
      /* a space before each column, so a long slug or source never runs into the next */
      if (x.kind === 'line') lines.push('  ' + x.slug.padEnd(22) + ' ' + (x.audience === 'both' ? '' : 'for ' + x.audience).padEnd(14) + ' ' + rowFrom(x));
      else lines.push('  ' + x.key.padEnd(22) + ' ' + rowValue(x).padEnd(14) + ' ' + rowFrom(x).padEnd(30) + ' ' + (x.editable ? rowTakes(x) : 'read only: ' + x.why));
    }
    if (family === 'rule lines') lines.push('  (' + RULE_VERBS + ')');
  }
  return lines.join('\n');
}

/* `profile list`'s line of where a profile sits. */
export function heldText(row) {
  return (row.held || []).map((h) => h.record + ' (' + h.note + ')').join(', ');
}

export function settingsText(settings) {
  return Object.keys(settings).filter((k) => SETTINGS[k]).map((k) => k + '=' + fmt(k, settings[k])).join(', ');
}

/* ---- the rules in force ------------------------------------------ */

/* Free-text lines the built-in level carries; a profile drops one by its slug. */
export const BUILTIN_LINES = Object.freeze([
  { slug: 'opus-workers', text: 'Dispatch workers on Opus; keep the session model for design and final judgment, and never tag fable.' },
  { slug: 'audits-and-seams', text: "An audit is intent coverage: every record in scope, open or closed, clause by clause against evidence in the repo (a journal's done is a claim), then the work no record carries; a status review is never called an audit. A review reads the seams: every reader of what each change touched, read against it, and one real call through each flow the changes touched; a fake on the other side is not evidence." },
  { slug: 'run-it-first', text: 'Ask the user to look, test or sit, or for a commit, push or release go, only once every audit, fix and open decision that could change it has landed and the related work is closed; before a look, run each step yourself on their surface and ask only for what needs their hand.' },
  { slug: 'lessons-to-profile', text: "A lasting working lesson goes into a profile rule on the board, never only into one machine's memory." },
  { slug: 'design-from-limits', text: "Settle what the code answers by reading it, not with benchmarks or surveys of today's data; design from the external limits and every viewpoint (surfaces, machines, offline, recovery, growth); measure what depends on data size or the machine, and make one real call through a flow to verify a join." },
  { slug: 'trace-the-rule', text: "Call a limit in the code a rule only when a recorded decision made it one (trace it to the decisions or the task's intent first, else say it was an implementation choice), and never read a want into the user's openness." },
  { slug: 'trust-their-eyes', text: "When the user sees a visual fault your measurement calls fine, the method is wrong: get a fresh read from their words and screenshots, measure at the app's real scales, fix what they mean, and check every icon yourself before showing a picture." },
  { slug: 'every-part', text: 'Build every part of a task the user asks for: where a part needs a design call, make it with a stated pick and ask only what the user alone can decide; never recommend the cheap part now and the rest later.' },
  { slug: 'talk-before-filing', text: 'When the user reports a problem or asks for thoughts mid-arc, talk it through first: add a task only on their word, and make no unasked inline fix.' },
  { slug: 'lay-out-first', text: "Lay a line of work out on its track before starting it, each step a task with what it depends on, including the steps a working rule implies (a wave's review waits on its lanes, its fixes on the review, the user's look or checks on the fixes). Take the next task from the ready set, and put a step found later on the track before doing it." },
  /* the session places review stations by judgement; the board keeps the ledger */
  { slug: 'review-stations', text: "Put a review station on the track after each wave of parallel lanes, where work touched code another lane or track also touched, once five finished code tasks sit unreviewed, and before anything that ships, project-wide when it ships other tracks' work. A review task (labelled review, or named Review ...) covers what finished before it started, and the tasks after it wait on it." },
  { slug: 'process', text: "Add no gate, guard, review stage or safety rule the user did not ask for unless you can name the failure it prevents; a new standing one waits for their yes, and a struck rule's code comes out with it." },
  { slug: 'naming', text: "Never coin ids in the board's namespaces (Q, T-, K-, TR-, WS-, P-) for anything else: name rows and steps plainly ('Row 1 (email)') and tell agents so in briefs that label rows. Name generated things for what they are, never with pieces of the user's name or login." },
  { slug: 'asking', for: 'session', text: "Fix and report a defect in your own task that has one right fix, never offer it as a choice; deferral is the user's call. Offer no workaround, data-losing or broken option; every menu has a none-of-these way out, a declined topic drops, and a recorded go is never re-asked. Your own cleanup is never a question; other deletes wait for a dry-run count and the user's yes." },
  { slug: 'delegate-mechanical', for: 'session', text: "Hand mechanical work (data-file edits, filing records, merging agents' output, writing briefs) to an agent or a fork and read only its summary; keep in your own context what needs your judgment: the user's words, reviewers' findings and the final call." },
]);

/* a line is for the session, its agents, or both (no `for`, every line saved before). */
export const AUDIENCES = Object.freeze(['session', 'agents']);

/* Built-in lines, then each level widest first: a profile's lines add or
   replace by slug, its drops remove a wider one. */
function linesOf(data, chain, active) {
  const at = new Map(BUILTIN_LINES.map((l) => [l.slug, { ...l, profile: null, record: null, level: 'built-in' }]));
  for (let i = 0; i < chain.length; i++) {
    for (const n of active[i]) {
      const s = settingsOf(profileOf(data, n));
      for (const slug of Array.isArray(s['rules.drop']) ? s['rules.drop'] : []) at.delete(slug);
      for (const l of Array.isArray(s['rules.add']) ? s['rules.add'] : []) {
        if (l && l.slug && l.text) {
          at.set(l.slug, { slug: l.slug, text: l.text, ...(AUDIENCES.includes(l.for) ? { for: l.for } : {}), profile: n, record: chain[i].key, level: chain[i].level });
        }
      }
    }
  }
  return [...at.values()];
}

/* a lane is sized by the agent guard's own soft limit, one number */
const sizeText = (soft, guardOn) => "Size a brief so one agent finishes it before the agent guard's soft limit, " + fmt('agent.soft', soft) + ' tokens of context'
  + (guardOn ? "; at the guard's notice, finish the step in hand, commit, and hand back where you stopped" : '')
  + '; judge a lane by whether it handed work on, and never report its token count as news.';
const ruleText = (key, v, eff) => {
  if (key === 'agent.soft') return sizeText(v, eff.settings['agent.on'].value === true);
  return (RULE_TEXT[key] && RULE_TEXT[key][String(v)]) || '';
};
const RULE_KEYS = ['tests.policy', 'tests.fullRun', 'tests.pinWording', 'dispatch.stateNote', 'dispatch.outputRule', 'agent.soft'];

/* what the mod looks for, so one revision's block is appended once */
export const RULES_HEAD = 'Rules in force (AskerDo rev ';

function revisionOf(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

function blockOf(record, rows, who) {
  const body = rows.map((r) => '- ' + r.text + ' [' + r.source + ']');
  const revision = revisionOf(body.join('\n'));
  return { revision, text: [RULES_HEAD + revision + ', for ' + record + (who ? ', ' + who : '') + '):', ...body].join('\n') };
}

/* The one renderer: every surface (the injected block, show-effective --rules,
   the main session's section) prints this. Two blocks: the session's and its
   agents'; the top-level text is the agents', the one a brief gets. */
export function rulesBlock(eff) {
  const src = (s) => (s.profile ? s.profile + ' on ' + s.record : 'built in');
  const rows = [];
  for (const k of RULE_KEYS) {
    const t = ruleText(k, eff.settings[k].value, eff);
    if (t) rows.push({ rule: k, text: t, source: src(eff.settings[k]) });
  }
  for (const l of eff.lines || []) rows.push({ rule: l.slug, text: l.text, source: src(l), ...(l.for ? { for: l.for } : {}) });
  const split = rows.some((r) => r.for);
  const session = blockOf(eff.record, rows.filter((r) => r.for !== 'agents'), split ? 'this session' : '');
  const agents = blockOf(eff.record, rows.filter((r) => r.for !== 'session'), split ? 'its agents' : '');
  const values = {};
  for (const k of RULE_KEYS) values[k] = eff.settings[k].value;
  return { record: eff.record, inject: eff.settings['dispatch.inject'].value !== false, revision: agents.revision, text: agents.text, rows, values, session, agents };
}

/* Both blocks as the CLI prints them: one when no line names an audience. */
export const rulesText = (b) => (b.session && b.session.text !== b.text ? b.session.text + '\n\n' + b.text : b.text);

/* ---- a board user's options ------------------------------------- */

/* The config.json key each contract setting stands for. */
export const CONTRACT_KEYS = Object.freeze(Object.keys(SETTINGS).filter((k) => SETTINGS[k].contract).map((k) => k.slice('contract.'.length)));

/* From a profileList reply: the profile held on default that the options live on
   (the one setting any, else the first held there; null when default holds none)
   and the config.json values the default level sets. A board serves one person,
   so the default level is theirs. */
export function contractOf(list) {
  const held = ((list && list.subscriptions && list.subscriptions.default) || noSub()).add.slice().sort();
  const rows = new Map(((list && list.profiles) || []).filter((r) => !r.builtIn).map((r) => [r.profile, r.settings || {}]));
  const values = {};
  let profile = null;
  for (const n of held) {
    const s = rows.get(n);
    if (!s) continue;
    for (const k of CONTRACT_KEYS) {
      if (s['contract.' + k] === undefined || values[k] !== undefined) continue;
      values[k] = s['contract.' + k];
      if (!profile) profile = n;
    }
  }
  if (!profile) profile = held.find((n) => rows.has(n)) || null;
  return { profile, values };
}

/* A stored value as profile define's words. */
export function wordsOf(key, v) {
  const kind = (SETTINGS[key] || PC_SETTINGS[key] || {}).kind;
  return kind === 'bool' ? (v ? 'on' : 'off') : kind === 'texts' ? JSON.stringify(v) : String(v);
}

/* A config's options as profile define's --set pairs. */
export function contractSets(cfg) {
  return CONTRACT_KEYS.filter((k) => cfg[k] !== undefined).map((k) => 'contract.' + k + '=' + wordsOf('contract.' + k, cfg[k]));
}

/* contractOf over the stored data rather than a profileList reply. */
export const contractHome = (data) => contractOf({
  subscriptions: data.subscriptions, profiles: Object.entries(data.profiles).map(([profile, p]) => ({ profile, settings: settingsOf(p) })),
});

/* Each contract key the default level sets, with the profile setting it, in contractOf's order. */
export function contractHeld(data) {
  const out = {};
  for (const n of ((data.subscriptions && data.subscriptions.default) || noSub()).add.slice().sort()) {
    const s = settingsOf(data.profiles[n]);
    for (const k of Object.keys(s)) if (SETTINGS[k] && SETTINGS[k].contract && !out[k]) out[k] = { value: s[k], profile: n };
  }
  return out;
}

/* ---- the settings list: one row per setting for every renderer --- */

export const FAMILIES = Object.freeze(['contract', 'handoffs and context', 'agents', 'tests', 'reviews', 'dispatch', 'rule lines', 'this PC']);
const FAMILY_BY = { contract: 'contract', main: 'handoffs and context', agent: 'agents', tests: 'tests', review: 'reviews', dispatch: 'dispatch', rules: 'rule lines' };
/* the pane's sub-tabs and the board page's groups, in order */
export const TABS = Object.freeze([['replies', 'Replies'], ['sessions', 'Sessions'], ['agents', 'Agents'], ['tests', 'Tests'], ['rules', 'Rules'], ['pc', 'This PC']]);
const TAB_BY = { contract: 'replies', main: 'sessions', agent: 'agents', dispatch: 'agents', tests: 'tests', review: 'tests', rules: 'rules' };
/* the scope chip's words for a layer, and whom a value set there reaches */
const SCOPE = { 'built-in': 'built-in', default: 'everywhere', project: 'this project', workstream: 'this workstream', track: 'this track only', task: 'this task only', pc: 'this PC' };
const REACH = {
  default: 'every session on every PC', project: 'its sessions on any PC', workstream: 'every track in it', track: 'this track alone', task: 'this task alone',
  pc: 'sessions on this PC alone',
};
const NEEDS_BOARD = 'needs a board: profile settings live there';
const RULE_VERBS = 'set with profile rule-add, rule-drop and rule-clear';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const takesOf = (spec, board) => TAKES_EFFECT[spec.takes === 'reply' && !board ? 'replyPc' : spec.takes];
const copyOf = (key, spec, board) => ({ label: spec.label, line: spec.line, changes: spec.changes, example: spec.example, takes: takesOf(spec, board) });

function shapeOf(key, spec, board) {
  const head = key.split('.')[0];
  const row = { key, family: spec.pc ? 'this PC' : FAMILY_BY[head], tab: spec.pc ? 'pc' : TAB_BY[head], ...copyOf(key, spec, board), kind: spec.kind };
  if (spec.kind !== 'secret') row.builtIn = spec.def;
  if (spec.kind === 'choice') Object.assign(row, { values: spec.values.slice(), choices: { ...spec.choices } });
  if (spec.kind === 'percent') Object.assign(row, { min: 1, max: 99 });
  if (spec.kind === 'tokens') Object.assign(row, { min: 1000, max: 2000000 });
  if (spec.kind === 'count') Object.assign(row, { min: 1, max: 1000 });
  if (spec.kind === 'text') row.max = spec.max;
  if (spec.kind === 'texts') row.max = 64 * 1024;
  return row;
}

/* is a holding's chain inside a place (a chain level), so a value it sets overrides the place's */
function inside(place, chain) {
  if (place.level === 'built-in' || place.level === 'default') return true;
  return chain.some((c) => c.level === place.level && (c.level !== 'project' ? c.key === place.key
    : sameDir(c.key, place.key) || [c.key, c.repo].filter(Boolean).some((x) => x === place.repo || x === place.key)));
}

/* How many narrower records under a place hold a profile setting `key` away from
   `value`, by kind: [{ level, count }]. `under` is every holding with its chain. */
function overriddenAt(data, under, key, place, value) {
  const i = place.level === 'built-in' ? -1 : LEVELS.indexOf(place.level);
  const n = {};
  for (const h of under || []) {
    if (LEVELS.indexOf(h.level) <= i || !inside(place, h.chain || [])) continue;
    const sets = h.profiles.some((p) => { const s = settingsOf(profileOf(data, p)); return s[key] !== undefined && !same(s[key], value); });
    if (sets) n[h.level] = (n[h.level] || 0) + 1;
  }
  return LEVELS.filter((l) => n[l]).map((level) => ({ level, count: n[level] }));
}

/* The board's rows for a chain: every profile key and the contract family with
   where its value comes from, each place the picker offers, then each rule line
   in force. With no data (no board) every profile key is at its built-in and read only. */
function boardRows(data, chain, { board, under } = {}) {
  const eff = data && chain ? resolveChain(data, chain) : null;
  const active = eff ? activeAt(data, chain) : [];
  const held = data ? contractHeld(data) : {};
  const rows = [];
  const from = (value, layer, record, profile) => ({ value, layer, record: record || null, profile: profile || null });
  /* one place: who holds what there, the profile that sets the key, and its value */
  const place = (key, c, names) => {
    const setter = names.find((n) => settingsOf(profileOf(data, n))[key] !== undefined) || null;
    const p = { level: c.level, record: c.key, scope: SCOPE[c.level], reaches: REACH[c.level], profiles: names, profile: setter };
    if (!setter) return p;
    const value = settingsOf(profileOf(data, setter))[key];
    return { ...p, value, overridden: key.startsWith('contract.') ? [] : overriddenAt(data, under, key, c, value) };
  };
  for (const [key, spec] of Object.entries(SETTINGS)) {
    if (spec.list) continue;
    const row = shapeOf(key, spec, board);
    if (spec.contract) {
      Object.assign(row, held[key] ? from(held[key].value, 'default', 'default', held[key].profile) : from(spec.def, 'built-in'), { editable: true });
      /* the family is set at default only, and held there whole, so changed reads the value */
      row.changed = !same(row.value, spec.def);
      if (data) row.places = [place(key, { level: 'default', key: 'default' }, ((data.subscriptions && data.subscriptions.default) || noSub()).add.slice().sort())];
      row.overridden = [];
    } else if (eff) {
      const s = eff.settings[key];
      Object.assign(row, from(s.value, s.level, s.record, s.profile), { editable: true, changed: s.level !== 'built-in' });
      row.places = chain.map((c, i) => place(key, c, active[i]));
      const at = chain.find((c) => c.level === s.level) || { level: 'built-in' };
      row.overridden = overriddenAt(data, under, key, at, s.value);
    } else Object.assign(row, from(spec.def, 'built-in'), { editable: false, why: NEEDS_BOARD, changed: false });
    rows.push(row);
  }
  for (const l of (eff && eff.lines) || []) {
    rows.push({
      key: 'rules.add', family: 'rule lines', tab: 'rules', label: SETTINGS['rules.add'].label, takes: takesOf(SETTINGS['rules.add'], board), kind: 'line', slug: l.slug, words: l.text, audience: l.for || 'both',
      ...from(l.text, l.level, l.record, l.profile), editable: false, why: RULE_VERBS, changed: l.level !== 'built-in',
    });
  }
  return rows;
}

/* This PC's half over the board's rows: with no board a contract value is this PC's
   copy; on a board one no profile sets stays built-in, the built-in value mirrored
   into config.json. The PC rows follow. The token's value never leaves config.json. */
export function withPcRows(rows, config, { board } = {}) {
  if (!config) return rows;
  const out = rows.map((r) => {
    const k = r.key.startsWith('contract.') ? r.key.slice('contract.'.length) : null;
    if (!k || board || r.layer !== 'built-in' || config[k] === undefined) return r;
    return { ...r, value: config[k], layer: 'pc', changed: !same(config[k], SETTINGS[r.key].def) };
  });
  for (const [key, spec] of Object.entries(PC_SETTINGS)) {
    const v = config[key] === undefined ? spec.def : config[key];
    const row = { ...shapeOf(key, spec, board), value: spec.kind === 'secret' ? (v ? 'set' : 'not set') : v, layer: 'pc', record: null, profile: null };
    if ((key === 'queue' && !board) || key === 'boardBackups' || key === 'boardContainer' || key === 'answerPresses' || key === 'pluginUpdates') Object.assign(row, { editable: true, changed: !same(v, spec.def) });
    else Object.assign(row, { editable: false, why: key === 'queue' ? "a board PC's queue is hub, set by the join" : 'set by the join', changed: false });
    out.push(row);
  }
  return out;
}

const kWords = (v) => Math.round(Number(v) / 1000) + 'k';
/* An example with {value}, {k200}, {k1m}, {window} and {soft} filled from the rows. */
function filled(example, row, valueOf) {
  const { sample, ...e } = example;
  const v = row.kind === 'tokens' ? kWords(row.value) : row.value === '' && sample ? sample : String(row.value);
  const n = Number(row.value);
  const f = (t) => String(t).replace(/\{value\}/g, v).replace(/\{k200\}/g, n * 2 + 'k').replace(/\{k1m\}/g, n * 10 + 'k')
    .replace(/\{window\}/g, valueOf('main.window')).replace(/\{soft\}/g, kWords(valueOf('agent.soft')));
  if (e.a) return { ...e, a: e.a.map(f), b: e.b.map(f) };
  if (e.values) return { ...e, values: Object.fromEntries(Object.entries(e.values).map(([k, t]) => [k, f(t)])) };
  return { ...e, text: f(e.text) };
}

/* Every setting as one row: { key, family, tab, label, line, changes, example, takes,
   kind, values and choices | min, max, builtIn, value, layer, scope, record, profile, editable,
   why, changed, overridden, places }, rule lines with slug, words and audience.
   `data` and `chain` are the board's (null with no board), `config` this PC's
   config.json (null on the board itself), `under` every holding with its chain. */
export function settingRows(data, chain, config, { board = !!data, under } = {}) {
  const rows = withPcRows(boardRows(board ? data : null, board ? chain : null, { board, under }), config, { board });
  const valueOf = (k) => (rows.find((r) => r.key === k) || { value: (SETTINGS[k] || {}).def }).value;
  return rows.map((r) => {
    const out = { ...r, scope: SCOPE[r.layer] };
    if (r.example) out.example = filled(r.example, r, valueOf);
    if (r.editable && !board) out.places = [{ level: 'pc', record: null, scope: SCOPE.pc, reaches: REACH.pc }];
    return out;
  });
}

/* the copy of the two list settings, which have no row of their own: the Rules
   tab draws its add form and its dropped lines from these. */
export const listCopy = (board) => ['rules.add', 'rules.drop'].map((key) => ({ key, tab: 'rules', ...copyOf(key, SETTINGS[key], board) }));

/* each sub-tab with its name, how many of its settings are changed, and one
   sentence of what is in force there, built from the rows. */
/* `place`: the words for where a page with no session in view reads them ("everywhere", "on TR-1");
   without it the reader is a session (the CLI and the pane). */
export function tabsOf(rows, { board, place } = {}) {
  const r = (k) => rows.find((x) => x.key === k && x.kind !== 'line') || { value: (specOf(k) || {}).def };
  const lines = rows.filter((x) => x.kind === 'line');
  const mine = lines.filter((l) => l.layer !== 'built-in').length;
  const say = {
    replies() {
      const bools = rows.filter((x) => x.tab === 'replies' && x.kind === 'bool');
      const on = bools.filter((x) => x.value).length;
      const dlg = { blockers: 'opens only for blockers', free: 'opens freely', ban: 'never opens' }[r('contract.dlg').value];
      return (on === bools.length ? 'All ' + on : on + ' of ' + bools.length) + ' reply features are on, and the pop-up ' + dlg + '.';
    },
    sessions: () => (r('main.on').value ? 'Sessions hand off at ' + r('main.window').value + '% and wrap at ' + r('main.wrap').value + '%.'
      : 'The depth meter is off, so sessions never say when to hand off.'),
    agents: () => (r('agent.on').value ? 'The agent guard is on: a hand-off note at ' + kWords(r('agent.soft').value) + ' tokens, an urgent one at ' + kWords(r('agent.hard').value)
      : 'The agent guard is off') + (r('dispatch.inject').value ? '; every brief carries the rules in force.' : '; briefs go out as written.'),
    tests: () => ({ few: 'Few tests per change', standard: 'Tests as each change needs', off: 'No new tests' }[r('tests.policy').value]
      + '; ' + { end: 'the full suite runs once at the end', merge: 'the full suite runs after the merge', never: 'the full suite never runs' }[r('tests.fullRun').value]
      + '; tests ' + (r('tests.pinWording').value ? 'may pin' : 'never pin') + ' exact wording.'),
    /* the rules in force come from the board's profiles */
    rules: () => (board ? mine + ' line' + (mine === 1 ? '' : 's') + ' of yours and ' + (lines.length - mine) + ' built in ' + (place ? 'apply ' + place : 'reach this session') + '.'
      : 'Rule lines come from a board: they ride a profile there, and this PC has not joined one.'),
    pc: () => (board ? 'This PC is joined to your board, and its questions wait there.'
      : 'No board joined; questions wait ' + { hub: 'on the board', text: 'in a file per project', off: 'nowhere: replies restate them' }[r('queue').value] + '.'),
  };
  return TABS.map(([tab, name]) => ({ tab, name, summary: say[tab](), changed: rows.filter((x) => x.tab === tab && x.changed).length }));
}
