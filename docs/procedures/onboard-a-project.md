---
name: onboard-a-project
title: Onboard a project onto the AskerDo board
summary: Convert a project's old workflow with the onboard skill, small by default (live state by group, history out whole, a rehearsal that proves the undo, one go, one commit), then record the run.
everywhere: true
triggers:
  words: [onboard a project, onboard this project, move a project onto the board, import a project, askerdo onboard, convert a project]
  commands:
    - skills/onboard/survey.mjs
    - skills/onboard/plan.mjs
    - skills/onboard/apply.mjs
---

# Onboard a project onto the AskerDo board

## Trigger

The helpers are in `${CLAUDE_PLUGIN_ROOT}/skills/onboard/` (`$H` below). A session opened on a project that kept its own way of working (rules in CLAUDE.md or AGENTS.md, `.claude/` rules and loaders, handoff and state files, plans, decision logs, Claude memory) runs `/askerdo:onboard` to convert it. The skill (`skills/onboard/SKILL.md`) holds the run's order and commands; this card holds the judgment each step needs and is the run's record, so each run reports how it went and the next starts from what it learned.

## Preconditions

- The PC is on the board and the CLI answers. check: `node ~/.claude/askerdo/cli.mjs board`
- The session is a desktop session opened in the project, with the user engaged for the run.
- This card is on the board, so the last step's `proc ran onboard-a-project` resolves: the orchestrator's `proc scan` in the AskerDo checkout after the release puts it there. check: `node ~/.claude/askerdo/cli.mjs proc find onboard a project`

## Steps

### 1. Say the run's shape up front

Before the survey, tell the user the aim in one line (after the go, a session here learns its rules, its open work, the user's rulings and its routines from AskerDo alone), what moves (the old system's live state, each to its home), what goes (each old workflow folder and the machinery that loaded it, in one commit, its history kept by git behind a pointer record), and what it asks of them: one band question per group or call only they can make, then one go after the rehearsal that covers the live write and the commit, with "ask me per file" open to them. Say that depth is theirs to ask for (step 8). Skill step 1.

### 2. Gather the facts, read only

```sh
node "$H/survey.mjs" <project dir>
```

The facts the judgment leans on: `project` (its `head` is the commit that holds the history that leaves); `instructions` (the Project instructions setting and each instruction file Claude reads by it, at the start or nested); a ledger per instruction file, clause by clause (`claude`, AGENTS.md's too whether Claude reads it or not); `ruleFiles` (every file under `.claude/` and `.agents/`, every file an instruction file names or imports, every script a hook or a `.mcp.json` server runs, a handoff protocol's files by `role`), each with what loads it and its cites as `ok`, `gone` or `moved`; `routines` (each skill and command with its scripts, its commits and `recent`, the commits in the last 60 days, so a routine in use tells itself from one no one runs); every folder as a list with its file count and last touch; the memory files; the board's records for the project; and `conversion`, the map of earlier runs. All of it sits in one `facts.json`. `--depth` adds each folder's cites, code readers and commit subjects, the entry points' texts, the rule files' citers and the commits since on what they cite, and each earlier keep or drop re-checked as `holds` or `rejudge`. Skill step 2.

### 3. Judge the project

Read the facts, then open only what a judgment needs. Judge each thing as a person who knows the project would.

#### What moves

Only what is live: the instruction files' rules, the rule files a session loads and what loads them, the routines in use, open work (a handoff's next steps, a plan's open items still wanted), the user's rulings in their own words, and memory feedback. A system that works and was built with care is the reason to convert it, not to keep it. Two statements of one rule in two systems become one record, the later wording winning.

- A rule that holds everywhere is a line on the project's profile; one scoped to paths or to one of the project's own commands is a decision governing them, or a card with those triggers.
- A ruling of the user's is a decision with their words and date.
- A routine in use (its skill or command, with its scripts touched in recent history) becomes a card; one nobody runs leaves with its folder.
- A handoff protocol's state becomes the track's handoff, its next steps tasks in order, and its standing rulings decisions; its resume files go with their folder.
- Claude's memory for the project: feedback entries (the user's taste) become rule lines; entries about the user are private. The folder is moved aside on the user's yes, never deleted.

#### What the code tells is not recorded

A fact the code, its tests or its own documents already tell (a port, a file's layout, what a module does) is not a record: a clause that says only that is dropped from the instruction file (its `why`: the code tells it) or stays in its account of what the project is. A record earns its place only where the code cannot tell: something that looks wrong but is deliberate, a trap in the tooling. Such a decision or knowledge item carries `oddity: true`, and the plan labels its record `oddity`, so a later session keeps or drops those as one group.

#### History leaves whole

Logs, state notes, findings, maps, briefs and finished plans go with their folder and git keeps them. They are never read clause by clause for what they once said. The plan writes one knowledge record per workstream that points at them, with the import, so the undo takes it back; the proposal carries no item for it. It names each folder that leaves (end `delete` or `retire`) and the commit that holds them (the facts' `project.head`), with `git show <head>:<path>` to read them, and a read of a path under one points the session at it. A folder goes under the import's workstream (`history:<slug>`) unless its `workstream` names another of the project's (`history:<WS-n>`). A group answer that keeps every folder a pointer stood for drops the pointer with the group. On a later run, a workstream whose pointer is on the board gets an amend of it instead: the lines of the folders it does not name yet, with the commit that now holds them, and their read triggers. The undo puts its old text and triggers back, by a fix request the user presses Fix on once a session has read the pointer. A dormant plan whose work later commits show landed is history; the plans history cannot settle go to the user as one group.

#### The user rules by group

What is alike goes to the user as one group: a history folder, the rules of one rule file, a set of skills, a plan's open tasks. A group call carries its count, three examples and one answer: `keep` (it stays as it is, nothing written), `drop` (its folders go, its items with them) or `convert` (its items written, its folders go). A folder a group answer ends is backed by that answer whole: coverage reads none of its blocks. Only a choice the user's wants settle is a call: a private source, a rule of theirs that spans projects, a reader only they know of, work only they know is still wanted. Check each call's premise first on the repo, the machine and the board (something reads the setting it weighs, the task a keep waits on is still open); a call whose premise fails is settled from what you found.

#### Things that read as one kind and are another

- A hook, command, menu or server that informs (prints rule files at session start, loads a rule body on a slash command, a `paths:` menu) is a loader: it retires in the same run as what it loads. One that enforces (refuses a push, runs a formatter) is the project's tool and stays, and the rule it enforces still gets its line.
- An agent definition under `.claude/agents/` is harness tooling and stays; the rules in it that hold for every agent become lines for agents.
- `.claude/settings.json`'s permissions, env and model stay; its hook entries go or stay with their hooks.
- A generated file is the project: its fact, if any, is the command that regenerates it.
- A decision log written for sessions converts its rulings in force and goes. An ADR or design document written for people stays, and its rulings in force are still written as decisions that point at it.

#### What each home carries

- A rule line: at most 400 characters, in every session of the project and, by its audience (`session`, `agents`, `agents:<role>` or `both`), in every agent brief. What does not fit goes in a detail record the line names.
- A decision: the user's words and date, what it supersedes, and the files and commands it governs; a session that edits those files or runs those commands is pointed at it.
- A procedure card: its steps in order, each with the command it runs, a verify, and triggers on its words, commands and file globs. A routine with no command to run is a rule's detail, not a card.
- A knowledge record: a body found by search, and with file globs a session editing a matching file is pointed at it. A `paths:` rule's glob carries `(edit read)`, so it points on reads too.
- A track with its handoff and its tasks in order; a question on the band. A step the user owes (their look, a sighting in real use) is a question item gating the task, never a step.

#### A rule that stops

A rule left out of the conversion is an item with `cut` and, unless a group answer dropped it, its shape (`stale`, `superseded`, `history` or `loader`), a `why` and evidence: `gone` paths absent or leaving in this run, or `records` (a task that closed, a later decision in force). For a `stale` or `superseded` cut, the rule's own file is never its evidence. Coverage backs a cut while its evidence holds.

#### A gap is named and filed

Where the old system does something no AskerDo home does, convert what has a home, keep only the mechanism, name the capability in one line, and file it once per capability where the session's rules send AskerDo field reports, labelled `conversion-gap` (check the open ones first). The gaps known today: a rule enforced by refusing an act; a project's own fields in the kickoff; views of the board for one project; memory captured without a session asking; readers that cannot reach the board (teammates without AskerDo, agents other than Claude, with Codex reading the rules, decisions and cards through `AGENTS.override.md`); a card's pointer on a read or a search, and a search fed through a pipe.

#### Out of scope

Named in the report, never touched: files the user or the organization supply (`~/.claude/CLAUDE.md`, managed settings, output styles, plugins); third-party files; an external tracker, while a rule that points at it converts; and AskerDo's own homes (the `## AskerDo` section, `docs/procedures/`, `.claude/questions/`, an `AGENTS.override.md` AskerDo wrote).

#### Instruction files, other agents, private sources

Claude reads CLAUDE.md, AGENTS.md or both by the Project instructions setting; an AGENTS.md Claude reads is an instruction file like CLAUDE.md. Every clause of each takes a fate in the ledger, since a session loads it whole. The rewrite keeps what the project is (a paragraph or two: its purpose, parts and stack) and the AskerDo section, in the file the plan names; the handover never creates an instruction file. AGENTS.md's working rules convert whether Claude reads it or not, since Codex reads the board's through the git-ignored `AGENTS.override.md`. A user's own `AGENTS.override.md` is left alone and named. Private sources (CLAUDE.local.md, anything git ignores, memory entries about the user) are one call per source, its options keeping or dropping what in it would convert, the pick leaving them.

#### On a rerun

Judge fresh. A source the map holds `unchanged` is converted on the lines its coverage passed and never opened again for them; a call it holds answered with its subjects unchanged is not asked again.

### 4. Write the proposal

`<work>/proposal.json` holds the session's judgment; the plan reads these fields. An earlier run's that was written and handed over is renamed `proposal.<its go date>.json` first. Skill step 4.

- `items`, one per live thing that moves: `kind` (rule, track, task, handoff, decision, question, knowledge, card), `source` (`file` and `line`, or `commit`; later runs key on it) and `text`. The plan derives `id` (kind and source) and `title` (the text's first sentence) when they are left out. `oddity: true` on a decision or knowledge item the code cannot tell. What the board already holds gets `covered` with that record's id. An item left out takes `cut` with its shape and evidence (step 3).
- `fields` by kind. A rule: `text` (at most 400 characters), `slug`, `for`, `detail`, `replaces`; a scoped rule is a decision or card, or carries `fields.everywhere` saying why it holds everywhere. A decision: `title`, `words`, `date`, `supersedes`, `files`, `commands`, `detail`, `workstreams`. A card: `slug`, `steps` (`text`, and `run`, the shell line it runs), `verify`, `summary`, `words`, `preconditions`, `files` and `commands` as triggers. Knowledge: `files` as globs, `detail`. A track: `name`, `goal`, `state`; a handoff: `track` and its state as `text`; a task: `name`, `status`, `track`, `after`, `runBy`, `wake`, `steps`; a question: `ask`, `options`, `pick`, `gates`. On any item, `workstream` names the board workstream it goes to, and a private value its text leaves out (an address, a key, a host) stands as a marker such as `[address left out]`, one marker per value.
- `folders`: each machinery folder or file with `path`, `end` (`delete`; `retire` for a loader, which takes its settings and `.mcp.json` entries with it; `move` with `to`; `point` with `to`, the card, for a skill folder kept as a pointer at its card; or `keep`) and `why`, and `workstream` when what it holds belongs to another of the project's board workstreams than the import's. The `why` of a folder that leaves is its line in the history pointer. An untracked folder is never deleted. A kept entry may carry `lineEdits`, each `{ file, kind, line, why }` on the file as it stands before the handover: `delete` (to `end`, naming `head`, the words the line starts with), `strike` (`words`), `replace` (`words` with `with`), `empty` (naming `head`); the plan checks each against the file.
- `claude`: every clause of each instruction file's ledger, with `file`, `line`, `clause` and `fate`: `keep`, `rule` with the `item` it became, `drop` with a `why`, or `split` with `kept` (the fact in rewritten words) and `item`.
- `calls`: group calls first, each `{ id, ask, count, examples, items, folders, pick }` with `answer` one of `keep`, `drop` or `convert` once the user answers; a plain call has `options` (each `letter`, `label`, `effect`: `keep` and `drop` item ids, `add` items, `folders` path to end), `pick` and `answer`. Each call is one band question with its gist (what it is, who reads it, what each answer changes); the report and `rehearsal.md` list the calls and never stand in for them.

### 5. Plan and rehearse

```sh
node "$H/plan.mjs" <work> --session <own id>
node "$H/apply.mjs" <work> --board file:<scratchpad>/onboard-<slug>-1.db
```

The plan waits only on what would do damage, each named with its way out: a rule with no words or over 400 characters; an item with no id, a second item with one id, a kind with no home; `clause:<file>#L<n>` (a clause of an instruction file with no fate in `claude`) and a split clause missing its kept words or its item; `retire:<path>` (a loader goes while a file it loads stays with no other load: give the file an end, or keep it); `lineEdit:<file>#L<n>` (a line edit its file does not hold as named, on a file that goes or that git does not track, or overlapping another); a task whose `wake` names no question item; a handoff on no track the plan writes; an item or folder naming a workstream that is not the project's; a history pointer with no commit (facts with no `project.head`); a fix with no words. The rest it prints as warnings, written as they stand: a rule citing a folder that goes, a flat line from a scoped source, a step the task's worker may not do, a decision whose text is numbered steps, words naming a proposal item id, a record sending a session to a path that goes, a loader or hook left loading what goes. The rehearsal writes on the scratch board, reads the write back with coverage, runs the undo with its one press (a stand-in for the user's Withdraw) and reports both counts and the history pointers in `rehearsal.md`, so the undo is proven, not checked by hand. A refusal or a record the undo left is fixed and rehearsed again under a new file name. Skill steps 6 and 7.

### 6. What the user sees, and the go

Give the user the path of `rehearsal.md` and, in chat: the counts by kind and by group, the group answers, the instruction file's clauses that move and where, one line per rule file, hook and server (its home or end), the folders that go and those that stay with why, the line edits of kept files, the history pointer per workstream, the gaps filed, any refusal, the undo's proof (how many of the records the write made it took back with its one press) and what it cannot take back, and one paragraph on what a session here stops seeing and where it finds it. Ask for one go: it covers the live write and the handover commit; "ask me per file" stays open. Skill step 8.

```sh
node "$H/plan.mjs" <work> --go --session <own id>
```

### 7. The live write, coverage and the handover

```sh
node "$H/apply.mjs" <work> --board live
node "$H/apply.mjs" <work> --coverage
node "$H/apply.mjs" <work> --handover
```

Coverage reads each converted source against what it became (a clause against every record its line became, a card against the steps it was given), each file a session loads that goes (unless a group answer ended its folder) and the words each line edit takes out; a block or struck words no item names is a gap, which holds back its folder or edit until fixed where it lies. The handover lands one commit: the cards, the line edits of kept files, each instruction file from its ledger with the AskerDo section, the repoint of cites in the files a session reads, then each folder that passes its gate, with its settings entries and un-ignore lines; then `proc scan` vouches the cards at that commit. Anything refused puts every edit back and commits nothing; a file with uncommitted changes is skipped and named. It writes `<work>/report.md`, and one `git revert` takes the commit back. With "ask me per file", `--handover --file <path>` after each OK. On the user's yes, move Claude's memory folder for the project aside (`memory.retired-<date>`), never delete it. A group the user drops after the write leaves by `--undo --group <call id>` once the drop answer is in the proposal and the plan ran again. Skill steps 9 to 12.

### 8. Depth, on the user's ask

Depth is one flag: `node "$H/survey.mjs" <project dir> --depth`, and the plan and the handover follow the facts it made (or pass `--depth` to every plan run, the go's included). It brings back:

- folder evidence: each folder's cites, code readers and commit subjects, the entry points' texts, the rule files' citers, and each earlier keep or drop re-checked as `holds` or `rejudge`;
- keep reasons: each keep carries a shape (`project`, `product`, `third-party`, `for-people`, `tool`, `outside-reader`, `until`, `no-git`, `gap`) and evidence (`readers`, `cites`, `gone`, `until`, `records`, `call`) the next run re-checks, and one marked `rejudge` is judged again from the facts;
- the warnings as waits, a new decision or knowledge item on the subject of a board record held until it is `covered` or names it in `apart`, `loaders` corrections read, and a call keeping a folder in one option while converting what it holds in another refused;
- the full repoint: cites in every file that stays, code and documents included, each cite outside running text a wait (`cite:<file>#L<n>`) answered in `cites` as `{ file, line, of, do }` (`note`, `leave`, or `point` with `to`);
- a fresh reader pass: `node "$H/apply.mjs" <work> --reader` writes `<work>/reader.md` from the real tree after the handover; one agent on the session model gets only `${CLAUDE_PLUGIN_ROOT}/skills/onboard/fresh-reader.md` and that file, never the proposal, and answers once, by group. Each group goes to the user as one call; it never runs again to empty its list.

### 9. Record the run

At the end, or at any stop, record the run with the report as its note; a deviated run opens the note with one sentence naming the step that differed and how, and says its outcome in the same call: `--fixed <commit>` (this card fixed in that commit), `--one-off "<why>"` (the steps stand) or `--filed T-n` (the work, filed through the ladder). The report: `report.md`'s parts (the counts by kind and by group, the group answers, the commit, the undo command, the deviations), the rehearsal's undo count, the gaps filed, field bugs filed (each AskerDo trip-up, filed where the session's rules say field bugs go, else on the deviated note only) or "none", and the fresh reader's groups when one ran. Skill step 13.

```sh
node ~/.claude/askerdo/cli.mjs proc ran onboard-a-project clean --note "<report>"
node ~/.claude/askerdo/cli.mjs proc ran onboard-a-project deviated --note "<step-that-differed-and-how>. <report>" --one-off "<why-the-steps-stand>"
```

## Verify

```sh
node ~/.claude/askerdo/cli.mjs track show <the imported TR-n>
node ~/.claude/askerdo/cli.mjs proc find onboard a project
```

- expect: the imported track's ready set holds only the tasks nothing waits on, and the card shows this run.

## References

- `skills/onboard/SKILL.md`: the run's order and commands.
- `skills/onboard/fresh-reader.md`: the brief the one fresh reader pass gets with the reader file, on the user's ask.
- `skills/onboard/survey.mjs`: the facts: the board's records for the project, the instruction files and their ledgers, the rule files with their loaders and cites, the routines in use, the folders with their counts and last touch; with `--depth`, the folder evidence and the judgments re-checked.
- `skills/onboard/instructions.mjs`: which instruction files Claude reads by the Project instructions setting, and the rule files with what loads each.
- `skills/onboard/plan.mjs`: the plan from the proposal and its answers: the group calls, the waits and the warnings, scoped rules and their homes, the `oddity` label, the section's file, the kept files' line edits checked against them, the go.
- `skills/onboard/map.mjs`: the conversion map and, at depth, each judgment re-checked against its evidence.
- `skills/onboard/apply.mjs`: the rehearsal that writes, covers and undoes, the quiet live write, the manifest, the coverage pass, the one-commit handover and its report, the reader file, and the undo with its group form.
- `skills/onboard/coverage.mjs`: each converted source read against its record, clause by clause, the words each line edit takes out, and the coverage table.
- `skills/onboard/cards.mjs`: the procedure card a routine item becomes, its triggers from the item's files and commands.
- `hooks/board-server.mjs`: the notification pause route the live write sets.
