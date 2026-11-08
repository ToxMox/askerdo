---
name: onboard-a-project
title: Onboard a project onto the AskerDo board
summary: Convert a project's old workflow with the onboard skill (its live state onto the board, its history out of the tree by folder), then record the run with its report.
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

Before the survey, tell the user the aim in one line (after the go, a session here learns its rules, its work, its rulings, its routines and the facts written for sessions from AskerDo alone), what moves (the old system's live state, each to its home), what goes (each old workflow folder and the machinery that loaded it, deleted in its own commit, kept with a reason, or moved), and what it asks of them: a band question for each call only they can make, then one go after the rehearsal that covers the live write and every repo edit, with "ask me per file" open to them. Skill step 1.

### 2. Gather the facts, read only

```sh
node "$H/survey.mjs" <project dir>
```

The facts the judgment leans on: `instructions` (the Project instructions setting and each instruction file Claude reads by it, at the start or nested, with the folders each names, which load none of their files); a ledger per instruction file, clause by clause (`claude`, AGENTS.md's too whether Claude reads it or not); `ruleFiles` (every file under `.claude/` and `.agents/`, every file an instruction file names or imports, every script a hook or a `.mcp.json` server runs, a handoff protocol's files (kind `handoff`, by `role`: its `entry`, a README whose resume section says what each next session reads; each file that section names; its standing `rules`), each with what loads it, its cites as `ok`, `gone` or `moved`, who cites it and the commits since on what it cites; a cite resolves from its file's folder, the nested project holding it and the root, then on disk and in the other nested projects); each folder's evidence; the memory files; the board's records; and `conversion`, the map of earlier runs, whose `judgments` hold each earlier keep or drop re-checked against its evidence as `holds` or `rejudge`. On a large project the rule files and nested ledgers sit in `facts-rules.json`. Skill step 2.

### 3. Judge the project

Read the facts, then open what a judgment needs. These are the questions and the facts behind them, not a table of what goes where: judge each thing as a person who knows the project would.

#### The aim, as a listing

List what a fresh session here would load or be pointed at: each instruction file Claude reads and what it names or imports, every rule file, skill, command, agent definition, hook and server the facts list, the project's Claude memory. Beside each, write which system hands it over after the go. The old way is the channels the old machinery used to tell a session how to work: the rules it loaded, the work it was handed, the rulings it was told, the routines it was pointed at, and the facts written for sessions (a KNOWLEDGE.md, a gotchas file, a rule body's background). The project's code and its product documents are the project, never the old way, and are not on the list. An entry still handed over the old way after the go is work left, unless it carries a reason of a named shape with its evidence. Write the listing before the proposal; the fresh reader writes it again against the rehearsal copy (step 6).

#### Place everything

Every folder of the old machinery and every file a session loads from the project gets a home, an end or a reason. One question per thing: is it how the project works (it goes to AskerDo), the project itself or what it ships (it stays), someone else's (named, left alone), or history (it goes with its folder; git keeps it)? A system that works, is elaborate or was built with care is the reason to convert it, not to keep it: its quality goes into the records, and what it does that AskerDo cannot goes on the gap list.

The folder is the unit of the end; the clause is the unit of what moves. Before a folder goes, harvest its live content clause by clause (a rule file's rules, a log's rows still in force, an open plan's steps), a folder that is history as a whole included, since an abandoned system's log may hold the only statement of a ruling still in force. Two statements of one rule in two systems become one record, the later wording winning.

The instruction file keeps what the project is and the AskerDo section: what someone opening the repo needs in a paragraph or two (its purpose, its parts and how they fit, its stack). A fact a session needs only for some work (a port, a gotcha, where a deep-dive document lives) is a knowledge record, on that work's files when it has them; a rule goes to its home. A clause can be two things at once: "The Viewer is frontend-only: it never executes node logic, and it hosts the WebSocket server on port 5000" is a fact and a rule. Split it: the fact stays in the file in rewritten words, the rule is carried, and each half says only its own part (a rule line never carries the description around it). A clause may become two or more records (a rule and its fact, a rule and its detail), each saying only its own part: coverage reads the clause against every record its line became. The rewrite takes out a heading that says rules (rules, conventions, guidelines, policy) once it took clauses from under it, so the kept words join the section above; write them to read right there, and make any other heading that no longer fits a one-line edit you name before the go and make on it.

Things that read as one kind and are another:

- A hook, command, menu or server that informs (prints rule files at session start, loads a rule body on a slash command, a `paths:` menu pointing at bodies, a server serving rules) is the loader: it retires in the same run as what it loads. A loader reads a file into a session or tells the session to read it; a script that only names a file (a README, a product document, `.claude/settings.json`) does not load it. A body a `paths:` menu names loads on the menu's globs. One that enforces (refuses a push, runs a formatter, rejects a commit without a task id) is the project's tool and stays, and the rule it enforces still gets its line or decision, since an agent brief carries lines and not hooks.
- A skill or command that is a routine becomes a card; its scripts move to the project's tools folder and the card's command triggers name them; the folder goes. A command that only loads a rule file is a loader.
- An agent definition under `.claude/agents/` is harness tooling and stays; the rules in it that hold for every agent become lines for agents, and rules for that one role are the per-role gap.
- `.claude/settings.json`'s permissions, env and model are the project's harness configuration and stay; its hook entries go or stay with their hooks.
- Claude's memory for the project: feedback entries (the user's taste) become rule lines, project and reference entries knowledge records, entries about the user are private. The folder is moved aside on the user's yes, never deleted.
- A generated file (a header says so, a script writes it) is the project: its fact is the pointer and the command that regenerates it, never its content.
- A TODO or notes file at the top level or in a docs folder is a plan, judged as dormant plans are; a comment in code is code and stays.
- A decision log written for sessions converts and goes. An ADR or design document written for people stays, and its rulings in force are still written as decisions that point at it.
- A handoff protocol (a README whose resume section lists what each next session reads, its now or next files, a `rules.md` of standing rulings each handoff carries) is the old way: its state becomes the track's handoff and its next steps tasks, each ruling in its rules file a decision with the user's words and date (or a line, when it holds for every session), and its resume files go at the track's next handoff (`until`).

#### What each home carries

- A rule line: at most 400 characters, in every session of the project and, by its audience (`session`, `agents` or `both`), in every agent brief. What does not fit goes in a detail record the line names. `session` suits how the main session talks to the user or runs the board, `agents` what only a dispatched agent needs, `both` the rest.
- A decision: the user's words and date, what it supersedes, and the files and commands it governs; a session that edits those files or runs those commands is pointed at it. It links tasks, so a rule tied to work on a track retires with that work. Its detail is a knowledge record on the same files.
- A procedure card: its steps in order, each with the command it runs (a step with no command stays a step, in prose), a verify, and triggers on its words, commands and file globs; each run is recorded and drift is linted. A routine with no command to run at all is not a card: its steps are a rule's detail.
- A knowledge record: a body found by search, and with file globs a session editing a matching file is pointed at it. A long reference written for people stays a document, and a short record points at it.
- A track with its handoff and its tasks in order; a question on the band.

A rule scoped to paths or commands keeps its scope in its home: a decision governing them, or a card with those triggers, its detail a knowledge record on the same globs. A rule from a `paths:` file, a body such a file names, or a nested CLAUDE.md or AGENTS.md (whoever reads it) is scoped by where it came from. Only a rule that holds everywhere is a flat line. A standing rule about acts every session does (committing, pushing, dispatching agents, talking to the user) holds everywhere and is a line even when it names a command; a command scope is for a rule that matters only when a session runs one of this project's own commands (its release script, a deploy, a generator). Length is never a reason to keep a file: a three-page rule body is cut into the rule (a line or a decision), its why and detail (a knowledge record the rule names) and its steps (a card).

#### Staleness from evidence

A rule is dropped only on evidence that its subject is gone (the path, tool or system removed; the task that carried it closed) or that a later ruling replaced it, and the drop names that evidence. A rule with a live subject converts. An obeyed prohibition leaves no trace and is never stale for that; a rule of taste has no subject in the repo and always converts, unless a line in force says it already. An unresolved cite is first a moved path (a repoint); only a subject gone from the tree, the machine and the board makes a drop. The facts' rule files give each file's cites and the commits since; without history, the evidence is whether the cited paths, tools and commands exist and whether the board holds a later ruling. A stale rule is history: an instruction file's clause takes the fate drop with its evidence; a rule in a rule file is an item with `cut`, its shape (`stale`, `superseded`, `history`) and its evidence, which coverage backs while that evidence holds, and the report names it. Every block of a rule file that goes is read, so one no item names is a gap.

#### The reasons a keep may carry

A keep stands only with one of these shapes and evidence the next run can check:

- `project`: the project itself, as an instruction file's account of what the project is; its evidence is the paths it describes, as `cites`.
- `product`: the project ships or installs it (a plugin's skills, a starter kit's rules, a package's files). What its developers use to work on it is judged apart.
- `third-party`: someone else's file (vendored code, a package, a submodule), named and never converted or deleted.
- `for-people`: a document written for human readers (an ADR, a design spec, a user guide, a public roadmap); its rulings and open work still go to the board.
- `tool`: the project's own tooling or harness configuration (an enforcing hook, a formatter, settings permissions, an agent definition).
- `outside-reader`: a reader the user named who cannot reach the board reads it (a teammate without AskerDo, an agent other than Claude).
- `until`: switching at a named event still ahead (a track's next handoff, a task, a question, a date): the track or task open on the board, the question unanswered, the date to come; a session mid-leg on an old handoff protocol switches at its own next handoff.
- `no-git`: no git copy would remain (untracked, or the project outside git).
- `gap`: a capability AskerDo lacks, named and filed; only the mechanism stays, and what it carries converts.

Never a reason: the harness loads it; it is long; it is scoped; it saves context; it works; it is elaborate or well built; it is recent; it was kept last run; code reads it, when that reader goes in the same run; "project knowledge" said of a rule. A keep whose reason fits no shape converts, or drops with its evidence: it is never kept quietly and never sent to the user as a call. A drop carries `history`, `stale`, `superseded`, or `loader` (a pointer or load instruction for machinery that goes in the same run, its evidence the paths that go, as `gone`).

#### A gap is named and filed, never kept quietly

Where the old system does something no AskerDo home does, convert everything that has a home, keep only the mechanism with the shape `gap`, name the capability in one line in the proposal and the report, and file it once per capability where the session's rules send AskerDo field reports, labelled `conversion-gap` (check the open ones first; with no such rule the report carries it). The gaps known today:

- rules for one agent role: a line's audience is the session, agents or both, never one named agent type;
- a rule enforced by refusing an act: a line is prose, and a hook enforces;
- a project's own fields in the kickoff, which has a fixed shape;
- views of the board for one project (a burn-down per phase, a count per area);
- memory captured without a session asking: AskerDo records what a session writes;
- readers that cannot reach the board: teammates without AskerDo, agents other than Claude (Codex reads the rule lines for agents and the decisions on the project's files and commands, through `AGENTS.override.md`);
- a pointer when a session only reads a file: AskerDo points on edits and commands, where a `paths:` rule loads on a read too.

#### Out of scope by class

Named in the report, never touched: files the user or the organization supply (the user's `~/.claude/CLAUDE.md`, managed settings, the user's output style and plugins); third-party files; an external tracker (Linear, GitHub issues), while a rule that points at it ("check Linear before starting") converts; and AskerDo's own homes (the `## AskerDo` section, `docs/procedures/`, `.claude/questions/`, an `AGENTS.override.md` AskerDo wrote).

#### Instruction files and other agents

Claude reads CLAUDE.md, AGENTS.md or both by the Project instructions setting; an AGENTS.md Claude reads is an instruction file like CLAUDE.md. AGENTS.md's working rules convert whether Claude reads it or not, since Codex reads the board's rules through the git-ignored `AGENTS.override.md` AskerDo writes beside an AGENTS.md: AGENTS.md's text, the rule lines for agents, and each decision on the project's files or commands as "When editing <globs>: <ruling>". Each Claude session start in a repo with an AGENTS.md at its top rewrites it, so an AGENTS.md edit reaches Codex at the next Claude session there. The AskerDo section goes in the file the plan names, and the handover never creates an instruction file. A user's own `AGENTS.override.md` is left alone and named. Files only another agent reads (`.agents/`, `.cursorrules`, Copilot instructions): their working rules convert, and the file stays for that agent (`outside-reader`, and the reader filed as a gap) only while the user runs that agent here, which is a call when the history does not say.

#### Private sources and teammates

Private sources (CLAUDE.local.md, anything git ignores, memory entries about the user, a folder whose name or README says private) are listed apart: one call per source naming what in it would convert, its options keeping or dropping those items and ending no folder, the pick leaving them. Nothing private converts without that answer. When the history shows other authors (`git shortlog -sn`), one call per project asks whether the instruction file keeps a short pointer for people who work without AskerDo.

#### On a rerun

Judge fresh, never from an earlier run's view of what is workflow. A source the map holds `unchanged` is converted on the lines its coverage passed and never opened again for them (an item on another line is written, and a rule file that goes is still read whole); a call it holds answered with its subjects unchanged is not asked again. A judgment the facts mark `holds` stands as it was; one marked `rejudge` (its reader gone, its cite unresolved, its event come, its file changed, or no evidence recorded) is judged again from the facts and written with fresh evidence.

### 4. Write the proposal

`<work>/proposal.json` holds the session's judgment; the plan reads these fields. An earlier run's that was written and handed over is renamed `proposal.<its go date>.json` first. Skill step 4.

- `items`, one per live thing that moves: `id` named plainly by its source (`rule:CLAUDE.md#L12`, `track:plans/search`), `kind` (rule, track, task, handoff, decision, question, knowledge, card), `title`, `text`, `fields`, `source` (`file` and `line`, or `commit`, on every item: later runs key on it), `why` it is live. What the board already holds gets `covered` with that record's id. An item left out takes `cut`: a log row its source marks superseded or retired, which coverage backs by that mark; one a call's answer drops; or a rule dropped with the shape `stale`, `superseded`, `history` or `loader`, a `why` and evidence (its `gone` paths absent or leaving in this run, its `cites` resolving), which coverage backs while that holds. Any other cut is a coverage gap and holds its folder, and so is a block of a rule file that goes with no item naming it (from `source.line` to `source.end`, or the whole file with no line).
- A rule: `fields.text` of at most 400 characters, `slug`, `for` (its audience), `detail` (what does not fit), `replaces` (a line or setting it supersedes); for a scoped rule, write it as a decision or a card instead, or give `fields.everywhere` the reason it holds everywhere.
- A decision: `title`, `words`, `date`, `supersedes`, `files` (globs it governs), `commands` (command fragments it governs), `detail`. A card: `slug`, `steps` (`text` and `run`), `verify` (`expect`, and `run` only for a check that changes nothing; with none the card reruns no step), `files` and `commands` as triggers. Knowledge: its body as `text`, `files` as globs (the globs of the `paths:` menu it came from, or of the menu naming the body it came from, are added by the plan). A track: `name`, `goal`, `state` (waiting, parked, finished), `parkReason`, `history` (old handoff versions: `path`, `commit`, `at`); a handoff: `track` and its state as `text`; a task: `name`, `status`, `track`, `after`, `runBy` (`orchestrator`, `fork` or `agent:<model>`), the live handoff's next steps as tasks in order; a question: `ask`, `options`, `pick`. On a decision or knowledge item, `apart` lists board records on the same subject judged apart; on any item, `workstream` names the board workstream it goes to.
- `folders`: each machinery folder or file with `path`, `end` (`delete`; `retire` for a loader, which takes its settings and `.mcp.json` entries with it; `move` with `to`; or `keep`), `why`, and the facts' evidence. An untracked folder is never deleted. A file a loader loads that stays as the project (a product document) is kept here with its shape, which lets the loader go: the file stays, its load goes. A loader kept with its shape (a Codex skill for `outside-reader`) may carry `repoint: true`: it stays, and the handover points its cite of each file that goes at the record or card that file became.
- `loaders`, only to correct the facts: each file with the hooks, commands, skills, servers and menus that load it, which the plan reads in place of the facts' map. Write it when the survey took a mention for a load or missed a load, and name each correction in the report.
- `claude`: every clause of each instruction file's ledger in the facts, with `file`, `line`, `clause`, `fate` (`keep`, `rule` with the `item` it became, `drop` with a `why`, or `split` with `kept`, the fact in rewritten words, and `item`, the rule it carries). A clause it leaves out waits on the plan and holds its file's rewrite, unless an earlier run kept it on evidence the facts mark `holds`.
- `calls`: only what the user alone can decide, a choice their wants settle: their private or harness files (a private source, their own settings file), a rule of theirs that spans projects (which profile it goes on), a reader only they know of (a teammate without AskerDo, another agent they run here), work only they know is still wanted (the dormant plans history cannot settle), a trade-off between values. Whether a piece of the old workflow converts is never a call, and the size of the conversion is never a reason for one: a keep with no shape, or one the last fresh reader still challenges, converts or drops with its evidence. Each call has `id`, `ask`, `options` (each `letter`, `label`, `effect`: `keep` and `drop` item ids, `add` items, `folders` path to end), `pick`, `answer`, `subjects`. The plan refuses a call with one option keeping a folder and another converting what it holds.
- Check each call's premise before asking, on the repo, the machine and the board: something reads the setting it weighs (an env var nothing on the machine reads changes nothing), the track or task a keep waits on is still open, and the two things it weighs really conflict (a harness permission only removes a prompt, so it conflicts with no rule). A call whose premise fails is no call: settle it from what you found.
- Each call is one band question, through the session's `ask` tool (else the CLI's `register`), the pick marked. Its gist says what the thing is (its path, what it holds, a short quote), who reads it, and what each answer changes in the repo and on the board, so the user answers from the card alone. The report and `rehearsal.md` list the calls with their answers and never stand in for them.
- Each kept folder, kept or dropped clause and cut item carries `shape` (from the list above) and `evidence` the next run re-checks: `readers` (files that read or name it), `cites` (paths that must resolve), `gone` (paths that must stay gone), `until` (`{ task }`, `{ track }`, `{ question }` or `{ date }`), `call` (the call that settled it). One with none is judged again each run; a dropped clause's evidence is re-checked after it leaves its file.

Dormant plans (open items no commit has touched in months): judge from history whether each plan's work landed; a landed plan is history and goes with its folder. Only the plans history cannot settle go to the user, as one call listing each plan, its real open count and its last touch. Skill steps 3 to 6.

### 5. Plan and rehearse

```sh
node "$H/plan.mjs" <work> --session <own id>
node "$H/apply.mjs" <work> --board file:<scratchpad>/onboard-<slug>-1.db
```

Settle every wait the plan lists and run it again until none is left: a rule with no words or over 400 characters; a rule citing a folder that goes; a flat line from a scoped source (write it as a decision or card, or give `fields.everywhere`); a split clause missing its kept words or its item; `clause:<file>#L<n>` (a clause of the facts' ledger with no fate in `claude`); `loader:<path>` (it loads what goes: retire it in the same run, keep what it loads, or keep it with `repoint: true`); `cite:<file>#L<n>` (a cite of what goes outside running text, such as a path value a tool reads, a `../` one read from its file's folder, where a git note would change the value: say in `cites`, as `{ file, line, of, do }`, whether to note it with git (`note`), leave it (`leave`), or point it at another path (`point` with `to`); without `of` and `line` one entry covers the file; a `point` entry also reaches a cite in running text, such as a kept card's cite of a rule body that goes, which otherwise names the card a going skill became or takes a git note); `retire:<path>` (it goes while a file it loads stays with no other load: give the file an end in the same run, or keep it with its shape); `hook:<path>` (a hook or server inside a folder that goes loads no file, so it may enforce: keep it with the shape `tool` and retire the loaders beside it file by file, give it an end of its own when it goes too, or correct `loaders`); a decision or knowledge item on the subject of a board record (`covered` or `apart`). A loader may go while a file it loads stays, when the file still reaches a session (the harness loads it, an instruction file's pointer whose clause stays, a loader that stays) or `folders` keeps it with its shape; the plan lists each as "the file stays, its load goes". The rehearsal writes `<work>/rehearsal.md`, hands the plan over on a copy of the repo against the scratch board, and writes `rehearsal/<tag>-reader.md` for the fresh reader; a write that refused a step gets no copy and no reader file until it rehearses clean. Skill steps 7 and 8.

### 6. The fresh reader

Dispatch one agent on the session model that has seen nothing of the run, with only two paths: its brief, `${CLAUDE_PLUGIN_ROOT}/skills/onboard/fresh-reader.md`, and the rehearsal's `<tag>-reader.md`. It reads the copy as a new session would start in it and searches the scratch board, and returns two lists: what of the old way is still there, and records of the wrong kind. Judge each entry: a challenged keep stands only with a reason of a named shape and its evidence, else it converts, or drops with its evidence; a kind it calls wrong moves to its home; only an entry the user's wants settle (step 4's `calls`) goes to them as a call. In doubt, convert. When its list changed the proposal, rehearse again and run one more fresh reader on the new copy, judged the same way: a keep it still challenges converts or drops with its evidence and is rehearsed once more, never made a call for being last. Its last list, each entry with what became of it, is the check against the aim. Skill step 8.

### 7. What the user sees, and the go

Give the user the path of `rehearsal.md` and, in chat: the fresh reader's list as the check against the aim (the goal is an empty list; an entry is work left, not a failure); the rewritten instruction file whole, read from the copy; one line per rule file, hook and server (its home or end and its reason's shape); the stale rules dropped, each with its evidence; the gaps filed; the counts per kind; the folders that go and those that stay with why; the line on what an undo cannot take back; any refusal; and one paragraph on what a session here stops seeing and where it finds it. Ask for one go: it covers the live write and every repo edit the report lists; "ask me per file" stays open. Skill step 9.

```sh
node "$H/plan.mjs" <work> --go --session <own id>
```

### 8. The live write, coverage and the handover

```sh
node "$H/apply.mjs" <work> --board live
node "$H/apply.mjs" <work> --coverage
node "$H/apply.mjs" <work> --handover
```

Coverage reads each converted source against what it became (a clause against every record its line became, a card against the steps it was given) and every block of a rule file that goes, so a block no item names is a gap; fix each gap where it lies and run it again, since a gap holds back its folder's delete (a block no item names gets its item, then the survey, plan, write and coverage again). Coverage puts on each source's map row the lines it read with no gap; a later run takes only those as written. The handover writes the cards and runs `proc scan`, rewrites each instruction file from its ledger with one AskerDo section in the file the plan names, retires each loader with its settings entries (a loader, and a dropped pointer or import, stays while a file it loads sits in a folder its gate holds, so held rules still reach sessions), repoints cites from files that stay (a relative link or `../` path read from its file's folder, a git note after a markdown link rather than inside it, a file name labelling a link to that file kept as the label, and a path git never held listed rather than noted), then deletes or moves each folder that passes its gate in a commit of its own, with the `.gitignore` lines that un-ignore only that folder; it never creates an instruction file. It then compares the real tree with the rehearsal copy: when they differ (`handover-diff.json` says `rerun`), the fresh reader runs again on the real tree before the run is recorded. Per file, on the user's ask: `--handover --file <path>` and `--repoint --file <path>`, each after an OK. On the user's yes, move Claude's memory folder for the project aside (`memory.retired-<date>`), never delete it. Skill steps 10 and 11.

### 9. Record the run

At the end, or at any stop, record the run with the report as its note; a deviated run opens the note with one sentence naming the step that differed and how. The report: the fresh reader's last list as the check against the aim, with the handover's diff against the copy; counts (items by kind, folders by end, calls and who settled them, files opened, steps written, refused, left); the stale rules dropped with their evidence; the keeps with their shapes; the gaps filed; the coverage table; the handover's commits by hash; ran clean; deviated; fixed by hand; field bugs filed (each AskerDo trip-up, filed where the session's rules say field bugs go, else on the deviated note only), or "none"; the undo command. Skill step 13.

```sh
node ~/.claude/askerdo/cli.mjs proc ran onboard-a-project clean --note "<report>"
node ~/.claude/askerdo/cli.mjs proc ran onboard-a-project deviated --note "<step-that-differed-and-how>. <report>"
```

## Verify

```sh
node ~/.claude/askerdo/cli.mjs track show <the imported TR-n>
node ~/.claude/askerdo/cli.mjs proc find onboard a project
```

- expect: the imported track's ready set holds only the tasks nothing waits on, and the card shows this run.

## References

- `skills/onboard/SKILL.md`: the run's order and commands.
- `skills/onboard/fresh-reader.md`: the brief the fresh reader gets with the reader file.
- `skills/onboard/survey.mjs`: the facts: the board's records for the project, the instruction files and their ledgers, the rule files with their loaders and cites (a handoff protocol's entry, resume files and standing rules among them), each folder's evidence, the judgments re-checked.
- `skills/onboard/instructions.mjs`: which instruction files Claude reads by the Project instructions setting, and the rule files with what loads each.
- `skills/onboard/plan.mjs`: the plan from the proposal and its answers (a call keeping a folder in one option and converting what it holds in another refused), the waits, scoped rules and their homes, the section's file, the judgments with their evidence, the go.
- `skills/onboard/map.mjs`: the conversion map and each judgment re-checked against its evidence.
- `skills/onboard/apply.mjs`: the rehearsal and its report, the handover on a copy and the reader file, the quiet live write, the manifest, the coverage pass, the per-folder handover with loaders retiring, the diff against the copy, and the undo.
- `skills/onboard/coverage.mjs`: each converted source read against its record, clause by clause, and the coverage table.
- `skills/onboard/cards.mjs`: the procedure card a routine item becomes, its triggers from the item's files and commands.
- `hooks/board-server.mjs`: the notification pause route the live write sets.
