# The work system: workstreams, tracks, tasks, and the CLI that writes them

Read this at the session's first work-system touch (the first record you
create, edit, or read), not before, and only for what
[askerdo-quick.md](askerdo-quick.md) does not cover. It is the
operational contract for the work kinds that live beside questions on
the one AskerDo board; `question-hub.md` beside this file is the
question half and says where the board lives, and the two share the
board, the CLI, and the activity log.

This file is written to be handed to ANY session, including a delegated
one that never sees a presentation contract. The next section is the
whole working set: an orchestrator can point a subagent at it and the
subagent will hold the discipline without reading further.

## The short version (hand this to any session)

The records live on AskerDo's board, one server for every machine, and
the CLI (or the mod's tools, which make the same calls) is the only way
to change one:

```bash
node ~/.claude/askerdo/cli.mjs <verb> [args] [--json]
```

Exit 0 success; 1 bad input, a board refusal, or a board that could not
be reached; 2 a failure in the CLI or the local server. `--json` works
on every verb. A message that a write may have run means read before
trying again. The rules that bind every session, without exception:

- **The CLI is the only writer.** Every change is one verb, one
  transaction on the board and one activity row; nothing on a PC holds a
  record except the local server's cache.
- **Ids are labels the board issues.** `WS-1`, `T-1`, `TR-1` (a track),
  `TR-1.3` (a handoff on it), `K-1`, `Q1` hold while the record is live
  (open, or closed under 14 days); then the label rests 30 days and may
  be reused. A cited id resolves with `resolve <id> --at <day>`. Never
  mint one yourself.
- **A record's key never changes.** A rename touches its name only, so
  every link ever handed out keeps resolving.
- **Journals are note-only.** `note <id>` is the ONLY way anything is
  ever added to a record's journal, and it only ever appends.
- **A task's Intent is WRITE-ONCE.** It is captured at create time,
  while the context exists, and no verb can reach it afterwards. A
  re-plan delta goes to the journal; a new direction is new tasks and
  edges on the track, or a side track.
- **The status ladder.** `open` means nobody is on it. `in_progress`
  from the moment a session, or an agent it dispatches, starts the work:
  the flip rides the first dispatch (`task update T-n --status
  in_progress --session <own-id>`, or `--agent "<job name>"`, which tags
  the agent working it and starts it), and it holds through reviews,
  fixes, and the person's look. `completed` when the work has landed
  where the Intent says it lands: a merge, a release, a delivery.
  `dropped` when it is abandoned. `blocked` and `deferred` still parse
  and go unused: what a task waits on is a "depends on" edge or a
  question's gate, never a status. A session flips the status; the board
  never guesses it.
- **Order is edges.** `edge add T-14 T-13 --reason "..."` says T-14 waits
  on T-13; list position only breaks ties.
- **Everything else changes through a verb**, one change per verb.

The verbs, in one table:

| Verb | Does |
|-|-|
| `ws create` | payload on stdin; issues `WS-n`; `--handoff <dir>` names its handoff folder |
| `ws edit <id>` | `--name`, `--add-label`/`--remove-label`, `--add-ref`/`--remove-ref`, `--add-project`/`--remove-project`, `--add-outcome`/`--remove-outcome`, `--handoff` |
| `ws close <id>` | status closed plus the date; `--outcome <text>` |
| `reopen <WS-n>` | a prematurely closed workstream back to open |
| `task create` | payload on stdin; issues `T-n` |
| `task update <id>` | `--status open\|in_progress\|dropped\|completed`, `--agent "<job name>"`, `--reason` (starting a task that is not ready), `--note` (a journal paragraph in the same call), `--priority`, `--name`, `--add-label`/`--remove-label`, `--in-hand`/`--let-go`, `--take-over`; the mod's `task_update` tool |
| `task edit <id>` | the field flips: `--status`, `--priority`, `--name`, `--workstream`, `--clear-workstream`, `--serves`, `--clear-serves`, the label and ref flags, `--in-hand`, `--let-go`, `--take-over`. A task has no plan or ordinal on the board (`--plan` and `--ordinal` are refused): its track and place are the track verbs |
| `note <id>` | `--body "text"`, or the body on stdin; appends one stamped journal paragraph to a workstream, task, track or knowledge record |
| `track new`, `list`, `show`, `mine`, `park`, `finish`, `drop`, `splinter`, `capture`, `promote`, `fold` | tracks (Tracks and handoffs, below) |
| `resume <TR-n>` | take a track with its kickoff |
| `handoff write <TR-n>` | payload on stdin; issues `TR-n.m` |
| `shelf` | waiting and parked tracks everywhere, oldest first |
| `edge add`, `edge remove` | "depends on" edges, each with `--reason` |
| `check add`, `check done`, `check move` | a task's checklist |
| `knowledge new`, `knowledge supersede` | gotchas and decisions (Knowledge, below) |
| `projects`, `projects scan [<folder>...]` | this PC's project map: each project's shared name and its folder here (Q89 89a), marking an entry whose folder is gone or is now another project; a scan maps the checkouts it finds, never a desktop-app scratch workspace |
| `projects forget <name>` | drops one entry from this PC's map; nothing is dropped on its own, since a folder on an unplugged drive comes back |
| `projects rename <old name> <new name>` | on the board, in one transaction: every question, workstream, knowledge record, procedure card and profile holding of the old shared name moves to the new one; `--folder <old dir>=<new dir>` (repeatable) moves the folders they name; `--dry-run` prints the counts; a new name that holds records is refused; this PC's map then drops the old name |
| `profile ...` | depth settings and rules in force (Profiles, below) |
| `list --kind workstream\|task\|knowledge` | the open set of one kind; `--workstream`, `--status`, `--priority`, `--label`, `--open`, `--all` |
| `show <id>` | one record at a read level (Listing and showing, below) |
| `resolve`, `activity`, `search` | as in question-hub.md |

The writes take `--session <own-id>`, and a create payload carries a
`session` key instead: pass your own session id so your own work stays
quiet in other sessions' inboxes (Events, below), and so the activity
row says which session made the change rather than `cli`.

Working a task, end to end:

```bash
node ~/.claude/askerdo/cli.mjs task update T-13 --status in_progress --session <own-id>
node ~/.claude/askerdo/cli.mjs note T-13 --session <own-id> < note.txt
node ~/.claude/askerdo/cli.mjs task update T-13 --status completed --session <own-id>
```

If the CLI is missing, errors, or cannot reach the board, say so plainly
in the reply and keep the content there: work is never silently lost to
tooling.

## The kinds

Five kinds on one board. Every record's first body section is a 1 to 3
line plain-prose summary (`## Description`, or a question's gist), which
is what a listing and the record's page lead with.

- **Workstream (`WS-n`)**: the named unit of intent that tracks, tasks
  and questions reference. It carries a name, a status of open or
  closed, member projects, the user's outcomes in their own words (`o1`, `o2`),
  an optional handoff folder, labels, and refs. Small unscoped work never
  mints one. A question is never unscoped: one registered with no
  workstream it can inherit lands in the project's inbox workstream
  (`<project>: inbox`, label `inbox`), see question-hub.md
  "Registration".
- **Track (`TR-n`)**: a named line of work in a workstream: its tasks,
  ordered by "depends on" edges, and its handoffs (`TR-n.m`) as
  checkpoints. Tracks are the only nesting (Tracks and handoffs, below).
- **Task (`T-n`)**: a unit of work. `## Description` (what and why,
  never live status), `## Intent` (write-once: the goal and its
  acceptance), `## Journal`. Priority is `high`, `medium`, or `low`. A
  task sits on at most one track; one on none sits in its workstream's
  inbox until it is captured onto a track. It may carry a checklist and
  name the outcomes it `serves`.
- **Question (`Qn`)**: documented in `question-hub.md`. It names its
  `workstream` and the tasks it `gates`, and `question edit` moves them
  after the fact.
- **Knowledge (`K-n`)**: a gotcha or a decision, a fact rather than work
  (Knowledge, below).

Timestamps are written by the board: `created` once, `updated` at every
change, `closed` on a workstream. Every stamp is a FULL LOCAL TIME in the
board's zone with its offset, to the second (`2026-09-04T13:02:45+00:00`),
and every reader accepts the older DATE-ONLY form (`2026-09-04`) that
records written before that format carry; question-hub.md, Timestamps,
has the rule. A snooze's `--until` stays a bare day.

## Creating

Creation payloads are JSON on stdin, the same shape `register` uses for
questions (write the payload to a temp file and redirect when shell
quoting gets awkward):

```bash
node ~/.claude/askerdo/cli.mjs task create --json < payload.json
```

| Kind | Required | Optional |
|-|-|-|
| `ws create` | `name`, `description` | `projects` (array), `outcomes` (array of lines), `handoff`, `labels`, `refs`, `session`, `created` |
| `task create` | `name`, `description` | `intent`, `workstream`, `track` (a TR-n id: the task lands on that track), `priority`, `status`, `serves` (outcome ids), `labels`, `refs`, `origin`, `session`, `created` |
| `track new` | `--workstream`, `--name` | `--goal`, `--task T-n`, `--label`, `--ref` (each repeatable; labels and refs come at birth only), `--session` (the session takes it) |

`session` is your own session id, read from the scratchpad path the
harness announces. `created` carries a converted record's real age, in
either stamp form, and is stored exactly as given; `origin` records
where a converted record came from. A referenced workstream MUST already
exist: a dangling reference is refused (exit 1), never created on the
fly. A task created without `serves` in a workstream with outcomes is
flagged with a warning, never refused. `create --json` returns `{id,
key, kind, name}`. Use the returned id from then on. A new task lands in
its workstream's inbox; `track capture --task T-n --track TR-n` puts it
on a track, or create it there in one step with `track capture --track
TR-n --name "..."`.

## Editing

Field flips only, one flag per field:

```bash
node ~/.claude/askerdo/cli.mjs task edit T-13 --priority high --add-label store --session <own-id>
```

- Scalars take a value flag: `--name`, `--status`, `--priority`,
  `--workstream`. A workstream has no `--status`: it moves through
  `close` and `reopen`.
- List membership is add and remove, never replace: `--add-label`,
  `--remove-label`, `--add-ref`, `--remove-ref`, and, on a workstream,
  `--add-project`, `--remove-project`, `--add-outcome` and
  `--remove-outcome`. They repeat, so one invocation can add two labels.
- `--clear-workstream` unsets a scoping field explicitly; a cleared
  field reads back exactly like one never set.
- `--in-hand` (with `--session`) takes a task in hand; a session may
  hold several, tasks of another track included (Q99 99a), the newest
  shown on the status line. A task another session holds is refused
  naming the holder (session, PC, since) and moves only with
  `--take-over`, which that session hears at its next prompt. `--let-go`
  clears it; an ended task is never in hand. A handoff carries every
  task in hand and lets each go; the resume gives back each still open
  and in no other session's hand, and its kickoff names any taken
  meanwhile.

An edit flips the fields it names plus `updated`, and nothing else. An
edit whose named fields already hold those values writes nothing at all.
A task moves through its statuses this way and only this way: there is
no task close verb, and a task reopens by setting its status back. A
promoted task's done follows its side track, never a status edit.

A question edits through `question edit` with a narrower row of flags
(`--workstream`, `--clear-workstream`, `--pick`, `--clear-pick`,
`--add-gate`, `--remove-gate`); its status moves through `answer`,
`drop`, `snooze` and `wake`, and its name and prose were written where
it was registered.

## Journaling

`note` is the only journal write path, for a workstream, a task, a track
or a knowledge record (a question records its resolution through
`answer` instead):

```bash
node ~/.claude/askerdo/cli.mjs note T-13 --session <own-id> --body "picked this up after the counter rebuild"
node ~/.claude/askerdo/cli.mjs note T-13 --session <own-id> < note.txt
```

The body lands as one time-stamped paragraph at the end of the journal
(`2026-08-25T14:30:00+00:00: picked this up after the counter
rebuild`). Paragraphs written before this format carry the day alone
(`2026-08-25: ...`) and are read exactly the same way. It appends and
never rewrites, it gives a workstream a `## Journal` section if it has
none yet, and it flips `updated`. Progress, findings, re-plan deltas,
and the reason a status moved all belong here. A note tells no other
session; `--session` names the writer on the activity row.

## Closing, reopening, and endings

```bash
node ~/.claude/askerdo/cli.mjs ws close WS-1 --outcome completed --session <own-id>
```

`ws close` sets the status to closed, stamps the close date, and takes
an optional `--outcome` (free text; nothing branches on it, it is a
badge a person reads). Closing a closed workstream is an error, not a
second stamp. Closed work stays browsable forever at its key's link, and
its label is freed 14 days after the close. `reopen <WS-n>` is for a
PREMATURE close only: it returns the workstream to open and clears the
close date and the outcome; one reopened past its archive day takes a
fresh label. A task ends by `task update --status completed` or
`dropped`; a track by `track finish`, `track drop` or `track fold`.

AN ENDING ALSO WAKES WHAT WAITS ON IT, T-78 (linked wake triggers). A
question snoozed with `--wake-on <ref>` names the record it waits on,
and every ending wakes the snoozed questions whose link names that
record: a task completed or dropped, a track done, dropped or folded, a
workstream closed with any outcome, and a question answered or dropped.
ANY ending fires a link, whether or not the link named a status:
`--wake-on T-13:completed` records the ending somebody expected, and a
drop of T-13 wakes the question just the same, because a dropped record
can never reach the status that was named (Q95 (linked wakes: which
endings wake) = 1a). The wake rides the ENDING VERB'S OWN TRANSACTION,
with one activity row for each question it woke (`woken by T-13
completed`); nothing polls and no read wakes a link. `reopen` is not an
ending and wakes nothing, and a link survives a reopen to fire at the
next ending. `question-hub.md`'s Snoozing section owns the flag, its
refusals, and what a woken question tells.

## Events

Work has no subscriptions: a session follows work through the track it
holds and the tasks it has in hand, and `subscribe` takes a question
only. Each PC's local server writes a line into a session's inbox for:

- a change to a task, for the session that has it in hand and the
  session holding its track; a take-over, for the session that had it;
- a change to a workstream (an edit, a close, a reopen), for the
  sessions holding its tracks;
- a take-over of a held track, for the session that held it;
- a blocking question registered on a task's gate, for the same two
  sessions as a task change.

Each arrives as ONE terse line where the mod runs, at the next prompt or
mid-turn at the next step: a pointer plus what changed (`T-13 (counter
rebuild) was reprioritized in another session: high`), never a payload
dump; the full detail is a `show` away.

**Pass your own session id on your own writes.** It is the one thing
that classifies the change:

- WITH it, the change is SESSION-AUTHORED and stays quiet: a session
  working a task does not spam the others with its own progress.
- WITHOUT it, the change is told to the sessions above.

Notes and reads tell no one; an edge or a checklist step is a task edit
like any other.

## Listing and showing

```bash
node ~/.claude/askerdo/cli.mjs list --kind task --workstream WS-1
node ~/.claude/askerdo/cli.mjs show T-13
node ~/.claude/askerdo/cli.mjs show T-13 --json
```

`list` without `--kind` is the question list. `--kind workstream`,
`task` or `knowledge` picks a kind, and the filters are `--workstream`,
`--status`, `--priority`, and `--label`. The default is OPEN WORK,
which `--open` says out loud: terminal records (a closed workstream, a
dropped or completed task, a superseded knowledge record) come back with
`--all` or by naming their status with `--status`. A listing prints one
head line per record and a last line saying the records themselves were
not shown; `--json` is an array of the records. Tracks list through
`track list --workstream WS-n`.

`show <id>` routes on the id and prints one record at a READ LEVEL. Its
default is the brief form, NOT the full record, and its last line names
what it left out and the flag that brings it back:

- `--head`: one line (label, name, status, what it waits on).
- the brief form (the default; `--brief` says it out loud): a head line
  (the id, the kind, the status, a task's priority, the workstream, the
  labels and refs, the stamps, a closed record's outcome), then the name
  on its own line, then each text ONCE under a short label, the journal
  cut. `--journal` adds the whole journal, `--journal-tail N` the last N
  notes, and `--since-resume` the notes since the latest resume of the
  record's track (a track's own, a task's track, any of a workstream's
  tracks).
- `--section <name>`: one section by name (`Intent`, `Answer`,
  `Journal`, any the record has).
- `--full`: the whole record, nothing left out. `--json` alone is the
  whole record too, which is what scripts and the mod read; with a level
  it is that level as JSON.

Several ids in one call print in the order asked for, at any level
below `--full`. Neither verb changes a work record;
the one exception rides the question route, where a `list` or a question
`show` wakes a date snooze whose day has passed (`question-hub.md` owns
that rule).

## Tracks and handoffs

A **track** (`TR-n`) is a named line of work in a workstream: its tasks,
its "depends on" edges, its handoffs (`TR-n.m`, the m-th checkpoint) and,
when it splintered off another track or was promoted from a task, a
junction naming where it left. Tracks replace threads and plans, and they
are the only nesting: no subtasks, a task carries a checklist instead.

THE STATE. Written, by a verb: `open`, `parked` (with a reason), `done`,
`dropped`, `folded`. Derived when read, so it cannot drift:

- **active**: a session holds its lease;
- **waiting**: no session holds it and its last handoff is live, or a
  session held it and let go with no handoff (the views and the kickoff
  say "no handoff yet");
- **new**: no session has held it yet;
- **stalled**, a display rule: an active, waiting or parked track with
  open tasks and no activity for three days (the board setting
  `tracks.stallDays`).

WHAT CAN MOVE is derived from the edges and gates, never from a
handoff's prose:

- **now**: the track's in_progress tasks, each tagged with the agent
  working it (`task update --agent "<job name>"`), or with the session
  when no agent is named;
- **ready**: open tasks whose dependencies are all done or dropped and
  that no open question gates, ordered by position: what can fan out now;
- **waits on**: a task that is not ready names what holds it, in plain
  words ("after T-41 on TR-5", "after Q93");
- **critical path**: the longest chain of open tasks through the track,
  following edges into other tracks; its length is the least that
  remains ("5 to go").

Starting a task that is not ready takes `--reason` on `task update`,
logged; when the edge was simply wrong, remove it instead (`edge remove
T-14 T-13 --reason "..."`). An edge that would close a loop is refused.

ONE SESSION PER TRACK. A track has one live lease and a session holds
one track. Parallel work inside a track is the session's own agents,
which is what now shows; parallel sessions mean parallel tracks. A
`resume` of a track another session holds names the holder and offers
three moves: `--take-over` (the other session hears so at its next
prompt), `--splinter "<name>"` (a side track from it), or `--read-only`
(the kickoff without taking it).

```bash
node ~/.claude/askerdo/cli.mjs track new --workstream WS-3 --name "board wording" --task T-13 --session <own-id>
node ~/.claude/askerdo/cli.mjs resume TR-4 --session <own-id>
node ~/.claude/askerdo/cli.mjs handoff write TR-4 --session <own-id> --json < handoff.json
node ~/.claude/askerdo/cli.mjs track park TR-4 --reason "waits on the install" --session <own-id>
node ~/.claude/askerdo/cli.mjs shelf
```

- **Find one.** `shelf` lists waiting and parked tracks everywhere,
  oldest handoff first, each with its focus and age, stalled and no
  handoff yet marked, and "code moved since" from git on this PC
  (`--no-git` skips it). `track list --workstream WS-3` lists one
  workstream's tracks with their state and its inbox count (`--all` adds
  closed ones). `track show TR-4` prints its kickoff and handoffs without
  taking it; `track show TR-4.2` one handoff in full. `track mine
  --session <own-id>` prints the held track (renewing its lease) and its
  workstream's tracks.
- **A new idea.** `track capture --track TR-4 --name "..."` adds a task
  to a track (`--workstream WS-3` to its inbox, `--task T-20` to move an
  existing task) and the session carries on. `track splinter TR-4 --name
  "..."` starts a side track now: the parent parks with "splintered to
  TR-7 at T-41" as its reason (`--at T-n` names the task it leaves from,
  `--task T-n` moves tasks with it) and the lease moves. From then on the
  chain is in view ("TR-7 under TR-5 under TR-2"), in the status row,
  the splinter's reply and each handoff.
- **Ending one.** `track finish TR-4 --outcome "..."` (done) and `track
  drop TR-4 --reason "..."` end it, `--leftovers inbox` or `drop` for
  tasks still open. When a side track finishes or parks, the result hands
  back its junction and the reply asks the user whether to go back on track
  there; nothing moves on its own.
- **Big tasks.** Any task may carry a checklist: `check add T-13 --text
  "..."` (`--at` a position), `check done T-13 1` (`--undo`), `check move
  T-13 2 --to 1`; its progress shows as 3 of 7 wherever the task does. A
  task that outgrows it is promoted: `track promote T-13 --name "..."`
  makes a side track of its checklist items, in order and with no edges,
  and the task stays on its track as a pointer whose done follows the
  side track (`--move` moves the session onto it, parking the parent).
  A promoted track that turns out small, with no side tracks of its own
  and no lease, folds back: `track fold TR-9` checks its done tasks into
  the pointer's checklist, moves their notes to the task and closes it as
  folded, so its label still resolves.

THE HANDOFF. Where the mod runs, its `handoff_write` tool writes one;
elsewhere `handoff write TR-n` takes the payload on stdin. The CLI and
the tool share one check (`lib/handoff-payload.mjs`):

- `focus` (required): the one next action, one line of at most 400
  characters.
- `state` (required): at most 10 KB, no line over 400 characters, and no
  `## Where we were` heading of its own.
- `whereWeWere`: the previous session's own words, at most 4 KB.
- `waitingOnUser`: a list of one-line items.
- `rulings`: rulings made in chat and not yet registered. A string is a
  new ruling; each carries to every next handoff as R1, R2 until the
  writer marks it `{ "id": "R2", "registered": "Q61" }`.
- `verifyFirst`: one entry per repo (`path`, `branch`, `worktree`,
  `commit`, `ownedByOthers`, `files`); a missing `commit` or `branch` is
  read from the repo at write time, and the write takes a snapshot of its
  dirty and untracked files. `files` gives each untracked file a
  disposition (Loose files, below).
- `status` (`waiting` by default, or `parked` with `parkReason`),
  `depthAtHandoff`, and `created` (a full stamp, for an import). Unknown
  keys are refused.

The write issues the label one past the track's chain, supersedes the
live handoff, and lets the writer's lease go (a parked handoff parks the
track). The board keeps each repo's summary, `{ path, branch, worktree,
commit, ok, problems }`; the snapshot and the loose-file lists stay on
this PC, in `<data>/handoffs/<TR-n.m>.json`. The result carries the
resume line, `/askerdo resume TR-n`, which the reply hands the user alone in
a copy block, and, read after the leftovers are laid, the track's open
tasks no open task waits on (one on another track counts) but the end of
its longest chain: the reply confirms each as an end on purpose or wires
it with `edge add`. A handoff the board could not take comes back whole in the
tool's result, and the reply carries it in a fenced block.

THE RESUME. `resume TR-n --session <own-id>` takes the lease, marks the
live handoff resumed (the mark `--since-resume` cuts at) and prints the
kickoff. This PC then checks verify-first: against the snapshot it kept
when the handoff was written here (the wrong branch, a missing worktree,
the commit gone from the branch, or a tracked file changed since fails
it; new untracked files only list, each with a suggested disposition),
or, for a handoff written on another PC, the branch and worktree alone,
with a note naming the PC that holds the lists. A failure never blocks
the resume. It also checks the workstream's handoff folder and prints
any file missing or over budget.

THE KICKOFF is printed from the board, never stored: line one names the
track and the resume command, then the chain, the junction, the focus
(or "no handoff yet"), now with its agents, the ready set, the critical
path and its length, the rest of the tasks in dependency order with
their checklist progress; to the track's holder, its open tasks nothing
waits on with the same confirm or wire ask as the handoff's result; side
tracks, stalls in the workstream; to the holder, the inbox of every open
workstream in the project (each open task on no track, oldest first,
with its workstream), asking it to put each on a track, move it to the
workstream it belongs in, or ask the user; what
waits on the user (less what was answered since), the answers since, the
unregistered rulings with their count, one `Read:` line for the
workstream's handoff folder (rules.md whole, map.md by grep, each with
its budget or long-line warning; read through this PC's project map, and
when this PC has no folder for the project the line says so and names
`projects scan`), and then the handoff's state, where we
were and the session that wrote it; a resume on this PC adds the loose
files below. The task list never comes from the handoff's prose.

THE HANDOFF FOLDER is a workstream's `handoff` field (`ws create
--handoff <dir>`, `ws edit WS-n --handoff <dir>`; absolute or under its
first project). The board keeps a project by its shared name only (Q89
89a), so each PC finds the folder through its project map: the
session's own checkout when it is one of the project's (a worktree
too), else the map's folder; a project this PC has no folder for is
said so, never guessed. A folder that does not exist yet is made from the
plugin's `templates/handoff/` (README.md, now.md, rules.md, map.md;
budgets 5, 10, 11 and 16 KB, no line over 400 characters); an existing
one is only recorded.

### Loose files (T-310)

Every untracked file in a listed repo gets a disposition in that repo's
`files` list: `{ path, disposition, reason, review, suggest, note }`,
disposition one of `commit`, `ignore`, `delete`, `keep` (needs a
`reason`; `review` is a day, default 7 days on) or `undecided` (the verb
writes the `note`: name, size, age, first lines). `suggest` (`commit`,
`ignore` or `delete`) is what a kept or undecided file should become. A
`commit`, `ignore` or `delete` is a proposal, never an instruction: it
waits on the user's answer (below), and the kickoff says so.

How a session judges them, in order: what it already knows from its own
context; then a quick look at each file it does not know; past about
five files still unknown, one Sonnet agent looks at those; what is left
is `undecided`. A file the payload leaves out carries what this PC kept
for it, else it is `undecided`; the verb prints the undecided files and
the kickoff names them first. A disposition for a path that is not
untracked is not recorded and is printed as such.

- Every disposition lives on this PC, per repo, in
  `<data>/kept/<repo slug>.json` (path, disposition, reason, note,
  suggestion, review day, the handoff that set it), never on the board.
  A proposal is due the day it is made; a kept or undecided file is due
  on its review day. Keeping a kept file again keeps its review day
  unless the handoff gives a new one, and a proposal restated keeps its
  own.
- Due files go back to the track whose handoff listed them (K-651):
  nothing raises a question on the board for them. The track's next
  kickoff lists the files to judge first, the undecided ones and then
  the due ones, each marked; a file that is gone is left out. That
  session judges each due file and asks the user in its own reply, a
  proposal per file through the ask tool; a file the user keeps takes a
  new review day in the next handoff.
- A track nobody has resumed shows its due files as a count on its tile
  in the AskerDo pane's Tracks tab (a track to pick up or a parked one),
  read from this PC's lists, so a handoff written on another PC shows
  none here. The count is never a question.
- Answers act, nothing else does: on the user's yes the session carries
  out the commit, ignore or delete for that file only. No verb deletes,
  commits or edits an ignore list.

## Knowledge

A **knowledge record** (`K-n`) is a gotcha or a decision: a fact, not
work. It is private and cross-project.

- Fields: `name` (the title), `type` (`gotcha` or `decision`), `status`
  (`active`, or `superseded`, which is terminal) with `supersededBy`,
  `scope` (`project` with `projects`, repo roots, or `global`),
  `labels`, `refs`, `legacy` (the old `<slug>:<id>`, empty for new
  records), `source`. Body: `## Description` (the title), `## Body` (the
  text), `## Journal`.
- `knowledge new` warns when two of the title's longest words reach an
  existing record. Search before writing one.
- No inbox line and no subscribers. `note`, `show`, `list --kind
  knowledge` (`--all` brings back superseded records) and `search` serve
  it; the generic `edit`, `close` and `reopen` refuse it.
- Migration only: `--legacy <slug>:<id>` (refused when that id already
  has a record) and `--created <date>`.

```bash
node ~/.claude/askerdo/cli.mjs knowledge new --type gotcha --title "..." --project C:/Demo/tidewatch < body.md
node ~/.claude/askerdo/cli.mjs knowledge supersede K-12 --title "..." < body.md
node ~/.claude/askerdo/cli.mjs search cleartype
```

Old brain ids (`G-0071`, `D-0002`, `T-0013`, qualified as
`tidewatch:G-0071`) map through `legacy <old id>` (`--project <slug>`).

## Profiles

Depth settings and the rules an agent brief carries come from named
profiles that a record subscribes to, the narrowest winning per setting:
built-in < `default` < a project < a workstream < a track < a task. A
session's settings come from the track it holds, else its project; its
rules from the track it holds, else its newest task in hand, else its project.

- `profile define <name> --set key=value` (repeatable), `--unset key`,
  `--description`; keys `main.on`, `main.window`, `main.wrap` (percent),
  `agent.on`, `agent.soft`, `agent.hard`, `agent.remind` (tokens, `350k`
  reads as 350000), `agent.hardDeny`, and the test and dispatch rules
  (`tests.policy`, `tests.fullRun`, `tests.pinWording`,
  `dispatch.stateNote`, `dispatch.outputRule`, `dispatch.inject`). The
  rules block's lane size line is `agent.soft`, the guard's own soft
  limit (Q100 100a), so moving the guard moves it. The built-in level
  also carries a few rule lines (`--rules` lists each with its slug),
  which a profile drops with `rule-drop`. The block reaches every
  session's prompt and each agent it dispatches, a plain session's
  included (Q102 102a).
- `profile add <record> <profile>` (the record is `default`, a project
  directory, `WS-n`, `TR-n` or `T-n`; refused when another profile on
  that record sets the same key), `profile remove <record> <profile>`.
- `profile rule-add <profile> <slug> --text "<one sentence>"`, `profile
  rule-drop <profile> <slug>` (drops a wider rule wherever the profile
  applies), `profile rule-clear <profile> <slug>`.
- `profile show-effective <record>` (each setting with the profile and
  record it came from; `--rules` the rules in force as an agent brief
  gets them), `profile list`, and `profile guard on|off --project <dir>`,
  the `/askerdo guard` shortcut. Each change rewrites the depth-guard
  markers under `~/.claude/projects/`.
- `settings [--track TR-n] [--project <dir>] [--json]` lists every
  setting (the profile keys, the `contract.*` options, the rule lines and
  this PC's queue and board link) with its value, the layer and profile
  that set it and the values it takes; with no board it lists this PC's
  `config.json`. The pane and the board page render its `--json` rows:
  each carries the words the user reads (label, a help line, what it
  changes, an example at the value in force, when it takes effect), its
  sub-tab, whether it is changed from built-in, the places it can be set
  with whom each reaches, and the narrower records that override it; each
  sub-tab comes with a one-sentence summary and its changed count.
- `settings set <key> <value> [--at <layer> [<record>]] [--profile <name>]`
  writes one: by default into the profile that sets it now (the default
  profile when it is built in), with `--at` into the profile held at that
  record (a new `settings-<record>` one when it holds none); the
  `contract.*` family is set at `default` only, and with no board a
  contract key or the queue lands in `config.json`.
- `settings unset <key> [--at <layer> [<record>]]` takes one off the
  layer that sets it now (with `--at`, off the profile held at that
  record), so the next layer down applies; a `settings-<record>` profile
  that `settings set` made comes off its record and goes once it sets
  nothing (a profile you made stays, empty); a `contract.*` key goes back to
  its built-in value on the default profile, and with no board a contract
  key or the queue goes back to its built-in value in `config.json`. A
  refusal says it in the setting's own words, the key after it.
- `settings rule add|drop|clear <slug> [--text "<one sentence>"] [--for
  session|agents|both] [--profile <name>]` is the rule write the pane and
  the board page make: add and drop go on your default profile (the
  `home` that `settings --json` names) and hold it on `default` in the
  same write, so the line reaches every session; clear takes a slug off
  the profile named, your default one when none, and may leave it empty.

## The activity log and search

Every change writes one row in the board's activity table, in the same
transaction; `activity` reads it newest first and `search` searches the
records. Both are in question-hub.md, The activity log.

## When tooling fails

Fail toward the reply, never toward silence.

- The CLI missing, erroring, or refused: keep the content in the reply,
  say plainly that the board did not take it, and write it through the
  CLI once the cause is fixed.
- The board unreachable: reads come from this PC's cache and say so,
  and every write fails plainly with nothing queued. A write that may
  have run is read before it is tried again.
- The local server down: the CLI runs each command in its own process,
  straight to the board. question-hub.md, When tooling fails, has the
  rest.

## Alerts on endings

A task a session flips to `completed` or `dropped`, or a workstream it
closes, raises one card in the tray's popup when the session passed its
own session id, so long autonomous work announces its endings to whoever
is at the machine. Each ending reads its own row in `board/notify.json`
(`task-completed`, `task-dropped`, and `plan-closed` for a workstream):
whether it shows and which sound it rings. An ending's card names the
record and the ending (`counter rebuild completed`), with the project
and workstream under it and a link to the record's page. A woken
question raises its card too, however it woke.

The alert gates are one order, said once in `lib/notify.mjs`: the master
switch `enabled`, the pause, the quiet hours, the row's own `show`, and
the cap of five with its collapse summary and the `collapse` row's
`show`. The tray exe, its menu, the pause, the openers and the
notifications page are in question-hub.md, Alerts, the tray and the
notifications page.

Every view the board's web pages give you is also a `list`, a `show`, a
`track show` or a `shelf` away.
